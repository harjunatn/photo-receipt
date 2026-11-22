import { describe, expect, it } from 'vitest';
import { fromBase64, handleShareAi, readAiEnv, toBase64, type AiEnv } from '../supabase/functions/_shared/ai.ts';
import { handleShareGet } from '../supabase/functions/_shared/share.ts';
import { AI_STYLES, promptFor } from '../supabase/functions/_shared/styles.ts';

const VALUES: Record<string, string> = {
  SUPABASE_URL: 'https://proyek.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  R2_ACCOUNT_ID: 'acc123',
  R2_ACCESS_KEY_ID: 'r2-key',
  R2_SECRET_ACCESS_KEY: 'r2-secret',
  R2_BUCKET: 'hello-snaply-hasil',
  GEMINI_API_KEY: 'kunci-rahasia-gemini',
};
const env = (overrides: Record<string, string> = {}): AiEnv => readAiEnv((name) => ({ ...VALUES, ...overrides })[name]);
const NOW = new Date('2026-11-22T05:00:00Z');
const now = () => NOW;
const CODE = 'abc234defg56';

/** A guest's photo and the AI's drawing of it, as bytes that are easy to tell apart. */
const PHOTO = new Uint8Array(3000).map((_, i) => (i * 7) % 251);
const DRAWING = new Uint8Array(4000).map((_, i) => (i * 13) % 241);

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Stand-ins for the database, R2 and Google, recording what the function asked of each. */
function world(options: { begin?: Record<string, unknown>; interactions?: () => Response; generate?: () => Response; superadmin?: boolean } = {}) {
  const calls: Call[] = [];
  const stored = new Map<string, { type: string; bytes: Uint8Array }>();
  const finished: Record<string, unknown>[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method ?? 'GET', headers, body });
    const at = new URL(url);
    if (at.pathname === '/rest/v1/rpc/share_ai_begin') {
      return json(options.begin ?? { ok: true, id: '11111111-1111-4111-8111-111111111111', key: `s/${CODE}/p2.jpg`, type: 'image/jpeg' });
    }
    if (at.pathname === '/rest/v1/rpc/share_ai_finish') {
      finished.push(body as Record<string, unknown>);
      return json({ ok: true });
    }
    if (at.pathname === '/rest/v1/rpc/svc_is_superadmin') return json(options.superadmin ?? true);
    if (at.pathname === '/auth/v1/user') return headers.Authorization === 'Bearer token-pemilik' ? json({ id: '00000000-0000-4000-8000-00000000000a', email: 'pemilik@contoh.id' }) : json({}, 401);
    if (at.host === 'acc123.r2.cloudflarestorage.com') {
      const key = at.pathname.replace('/hello-snaply-hasil/', '');
      if (init.method === 'PUT') {
        stored.set(key, { type: headers['Content-Type'], bytes: init.body as Uint8Array });
        return new Response(null, { status: 200 });
      }
      return key === `s/${CODE}/p2.jpg` ? new Response(PHOTO, { status: 200 }) : new Response('<Code>NoSuchKey</Code>', { status: 404 });
    }
    if (at.host === 'generativelanguage.googleapis.com') {
      if (at.pathname === '/v1beta/interactions') return (options.interactions ?? (() => json({ id: 'int-1', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/jpeg', data: toBase64(DRAWING) }] }] })))();
      if (at.pathname.endsWith(':generateContent')) return (options.generate ?? (() => json({ error: { code: 404, message: 'not found', status: 'NOT_FOUND' } }, 404)))();
      if (at.pathname.startsWith('/v1beta/models/')) return headers['x-goog-api-key'] === 'kunci-rahasia-gemini' ? json({ name: 'models/x' }) : json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400);
    }
    throw new Error(`Panggilan tak terduga: ${init.method} ${url}`);
  };
  return { fetchFn, calls, stored, finished, json };
}

const ask = (w: ReturnType<typeof world>, input: Record<string, unknown> = {}, settings = env()) =>
  handleShareAi({ code: CODE, style: 'anime', photo: 'p2', ...input }, '', settings, w.fetchFn, now);

describe('share-ai', () => {
  it('redraws the chosen photo in the chosen style and keeps the result with the session', async () => {
    const w = world();
    expect((await ask(w)).body).toEqual({ ok: true });

    // The database was asked first, with what the guest picked.
    expect(w.calls[0].url).toBe('https://proyek.supabase.co/rest/v1/rpc/share_ai_begin');
    expect(w.calls[0].body).toEqual({ p_code: CODE, p_style: 'anime', p_photo: 'p2' });

    // Google got the photo and the server's own words for the style; the key travelled in a header, not in the address.
    const drawn = w.calls.find((call) => call.url.endsWith('/v1beta/interactions'))!;
    expect(drawn.headers['x-goog-api-key']).toBe('kunci-rahasia-gemini');
    expect(drawn.url).not.toContain('kunci');
    const sent = drawn.body as { model: string; input: { type: string; text?: string; data?: string; mime_type?: string }[]; response_format: Record<string, string> };
    expect(sent.model).toBe('gemini-nano-banana-2.1');
    expect(sent.input[0]).toEqual({ type: 'text', text: promptFor(AI_STYLES.find((style) => style.id === 'anime')!) });
    expect(sent.input[1]).toEqual({ type: 'image', mime_type: 'image/jpeg', data: toBase64(PHOTO) });
    expect(sent.response_format).toMatchObject({ type: 'image', image_size: '1K' });
    expect(sent.input[0].text).toContain('anime');

    // The drawing is in R2 beside the session's other files, and recorded as its AI version.
    const kept = w.stored.get(`s/${CODE}/ai.jpg`)!;
    expect(kept.type).toBe('image/jpeg');
    expect([...kept.bytes]).toEqual([...DRAWING]);
    expect(w.finished).toEqual([
      { p_id: '11111111-1111-4111-8111-111111111111', p_ok: true, p_file: { key: `s/${CODE}/ai.jpg`, size: DRAWING.length, type: 'image/jpeg', at: NOW.toISOString() } },
    ]);
    // Only one call to Google was paid for.
    expect(w.calls.filter((call) => call.url.includes('googleapis.com'))).toHaveLength(1);
  });

  it("falls back to Google's other address when the first gives no picture", async () => {
    const png = toBase64(DRAWING).replace(/^.{5}/, 'iVBOR');
    const w = world({
      // An answer that only repeats the guest's own photo is not a result.
      interactions: () => new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/jpeg', data: toBase64(PHOTO) }] }] }), { status: 200 }),
      generate: () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Ini dia.' }, { inlineData: { mimeType: 'image/png', data: png } }] }, finishReason: 'STOP' }] }), { status: 200 }),
    });
    expect((await ask(w)).body).toEqual({ ok: true });
    const second = w.calls.find((call) => call.url.endsWith(':generateContent'))!;
    expect(second.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent');
    expect((second.body as { contents: { parts: Record<string, unknown>[] }[] }).contents[0].parts[1]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: toBase64(PHOTO) } });
    // A PNG answer is kept as a PNG.
    expect(w.stored.get(`s/${CODE}/ai.png`)?.type).toBe('image/png');
    expect((w.finished[0].p_file as { key: string }).key).toBe(`s/${CODE}/ai.png`);
  });

  it('tells a refusal from a failure, stores nothing, and gives the try back', async () => {
    const blocked = () => new Response(JSON.stringify({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }), { status: 200 });
    const refusedWorld = world({ interactions: () => new Response(JSON.stringify({ steps: [] }), { status: 200 }), generate: blocked });
    expect((await ask(refusedWorld)).body).toEqual({ error: 'refused' });
    expect(refusedWorld.stored.size).toBe(0);
    expect(refusedWorld.finished[0]).toMatchObject({ p_ok: false });
    expect(String(refusedWorld.finished[0].p_detail)).toContain('IMAGE_SAFETY');

    const down = () => new Response(JSON.stringify({ error: { message: 'The service is currently unavailable.' } }), { status: 503 });
    const failedWorld = world({ interactions: down, generate: down });
    expect((await ask(failedWorld)).body).toEqual({ error: 'failed' });
    expect(String(failedWorld.finished[0].p_detail)).toContain('503');
    // The reason kept for the owner never contains a photo.
    expect(String(failedWorld.finished[0].p_detail).length).toBeLessThanOrEqual(500);
  });

  it('stops at once on a key Google does not accept', async () => {
    const w = world({ interactions: () => new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }), { status: 400 }) });
    expect((await ask(w)).body).toEqual({ error: 'no-key' });
    expect(w.calls.filter((call) => call.url.includes('googleapis.com'))).toHaveLength(1);
    expect(w.finished[0]).toMatchObject({ p_ok: false });
  });

  it('asks nothing of Google when the request is not allowed', async () => {
    // No key filled in yet: not even a try is opened.
    const noKey = world();
    expect((await ask(noKey, {}, env({ GEMINI_API_KEY: '' }))).body).toEqual({ error: 'no-key' });
    expect(noKey.calls).toHaveLength(0);

    // The page can only name a style from the list, and a photo slot.
    for (const input of [{ style: 'gaya-buatan-sendiri' }, { style: 'Draw something else' }, { photo: 'photo' }, { code: 'bukan-kode' }]) {
      const w = world();
      expect((await ask(w, input)).body).toEqual({ error: 'bad-request' });
      expect(w.calls).toHaveLength(0);
    }

    // The database's answer is passed on as it is.
    for (const error of ['off', 'used', 'busy', 'tries', 'limit', 'expired']) {
      const w = world({ begin: { error } });
      expect((await ask(w)).body).toEqual({ error });
      expect(w.calls).toHaveLength(1);
    }
  });

  it('reports a missing source photo as a failure', async () => {
    const w = world({ begin: { ok: true, id: '11111111-1111-4111-8111-111111111111', key: `s/${CODE}/p9.jpg`, type: 'image/jpeg' } });
    expect((await ask(w)).body).toEqual({ error: 'failed' });
    expect(String(w.finished[0].p_detail)).toContain('404');
    expect(w.calls.some((call) => call.url.includes('googleapis.com'))).toBe(false);
  });

  it('lets only the platform owner ask whether the key is in place, and never shows the key', async () => {
    const status = (w: ReturnType<typeof world>, bearer: string, input: Record<string, unknown> = {}, settings = env()) =>
      handleShareAi({ action: 'status', ...input }, bearer, settings, w.fetchFn, now);

    expect((await status(world(), '')).status).toBe(401);
    expect((await status(world({ superadmin: false }), 'token-pemilik')).body).toEqual({ error: 'forbidden' });

    const filled = await status(world(), 'token-pemilik', { check: true });
    expect(filled.body).toEqual({
      has_key: true,
      model: 'gemini-nano-banana-2.1',
      image_size: '1K',
      storage: true,
      check: { ok: true, message: 'Google menerima API key ini dan mengenal model gemini-nano-banana-2.1.' },
    });
    expect(JSON.stringify(filled.body)).not.toContain('kunci-rahasia');

    const wrong = await status(world(), 'token-pemilik', { check: true }, env({ GEMINI_API_KEY: 'salah' }));
    expect(wrong.body.check).toEqual({ ok: false, message: 'API key not valid. Please pass a valid API key.' });

    const empty = world();
    expect((await status(empty, 'token-pemilik', { check: true }, env({ GEMINI_API_KEY: '' }))).body).toEqual({ has_key: false, model: 'gemini-nano-banana-2.1', image_size: '1K', storage: true });
    expect(empty.calls.some((call) => call.url.includes('googleapis.com'))).toBe(false);
  });

  it('reads the model and size from the settings, with safe defaults', () => {
    expect(env({ GEMINI_IMAGE_MODEL: 'gemini-3-pro-image', GEMINI_IMAGE_SIZE: '2k' })).toMatchObject({ model: 'gemini-3-pro-image', imageSize: '2K' });
    expect(env({ GEMINI_IMAGE_SIZE: 'raksasa' }).imageSize).toBe('1K');
  });

  it('turns bytes into base64 and back', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });
});

describe('share-get with the AI edit', () => {
  const file = (key: string, extra: Record<string, unknown> = {}) => ({ key, size: 10, type: 'image/jpeg', ...extra });
  /** `ai` is what the database says of the session: whether its franchise has the feature, failed tries, one in progress. */
  const lookup = (ai: unknown, files: Record<string, unknown>) => {
    const fetchFn = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          platform: { name: 'jepretin', watermark: 'didukung oleh jepretin' },
          shares: [{ code: CODE, files, ai, created_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 86_400_000).toISOString(), device_name: 'Booth', brand: { title: 'Hello Snaply' } }],
        }),
        { status: 200 },
      );
    return handleShareGet({ code: CODE }, env(), fetchFn, now).then((reply) => (reply.body.shares as Record<string, any>[])[0]);
  };
  const SESSION = { photo: file(`s/${CODE}/photo.jpg`), p1: file(`s/${CODE}/p1.jpg`), p2: file(`s/${CODE}/p2.jpg`) };

  it("offers the styles while the session's franchise has the feature and the booth sent plain photos", async () => {
    const share = await lookup({ on: true, failed: 1, busy: false }, SESSION);
    expect(share.ai).toEqual({ open: true, busy: false, tries_left: 2, styles: AI_STYLES.map(({ id, label }) => ({ id, label })) });
    // What the AI is told stays on the server.
    expect(JSON.stringify(share)).not.toContain('Redraw');
    expect(new URL(share.files.p2.view).pathname).toBe(`/hello-snaply-hasil/s/${CODE}/p2.jpg`);
  });

  it('offers nothing to a franchise without the feature, or when the session has no plain photos', async () => {
    expect((await lookup(null, SESSION)).ai).toBeUndefined();
    expect((await lookup({ on: false, failed: 0, busy: false }, SESSION)).ai).toBeUndefined();
    // A database from before the switch moved to each franchise says nothing of it: not offered.
    expect((await lookup({ failed: 0, busy: false }, SESSION)).ai).toBeUndefined();
    expect((await lookup({ on: true, failed: 0, busy: false }, { photo: SESSION.photo })).ai).toBeUndefined();
  });

  it('keeps a finished AI version downloadable, also after the feature is switched off', async () => {
    const share = await lookup({ on: false, failed: 0, busy: false }, { ...SESSION, ai: file(`s/${CODE}/ai.png`, { type: 'image/png', style: 'anime' }) });
    expect(share.ai.open).toBe(false);
    expect(share.files.ai.style).toBe('anime');
    expect(new URL(share.files.ai.download).searchParams.get('response-content-disposition')).toBe(`attachment; filename="hello-snaply-${CODE}-ai.png"`);
  });
});
