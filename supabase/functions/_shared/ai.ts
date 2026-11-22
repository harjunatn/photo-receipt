/**
 * share-ai, public: redraws one of a session's plain photos in a style the
 * guest picked, with Google's Gemini image model, and keeps the result beside
 * the session's other files in R2.
 *
 * The API key lives only in this function's secrets. The database decides
 * whether a try is allowed at all (one result per session, a few tries, a
 * monthly limit per franchise, the platform owner's switch), before any
 * photo leaves for the AI service.
 */
import { callerOf } from './accounts.ts';
import { rpc, type Reply } from './handlers.ts';
import { BUCKET_NAME, imageExt, readShareEnv, sign, type ShareEnv } from './share.ts';
import { AI_STYLES, PLAIN_KINDS, promptFor } from './styles.ts';

export interface AiEnv extends ShareEnv {
  /** '' while the owner has not filled it in. */
  geminiKey: string;
  model: string;
  /** Side of the picture asked for: 1K is about 1024 pixels. */
  imageSize: string;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-nano-banana-2.1';
const SIZES = ['1K', '2K', '4K'];
/** The AI service usually answers in well under a minute; past this the guest is told to try again. */
const DRAW_TIMEOUT_MS = 110_000;
const CODE = /^[a-z0-9]{12}$/;

export function readAiEnv(get: (name: string) => string | undefined): AiEnv {
  const value = (name: string) => (get(name) ?? '').trim();
  const size = value('GEMINI_IMAGE_SIZE').toUpperCase();
  return {
    ...readShareEnv(get),
    geminiKey: value('GEMINI_API_KEY'),
    model: value('GEMINI_IMAGE_MODEL') || DEFAULT_MODEL,
    imageSize: SIZES.includes(size) ? size : '1K',
  };
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The image type a base64 picture starts with, for answers that do not name it. */
function sniff(data: string): string {
  if (data.startsWith('iVBOR')) return 'image/png';
  if (data.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * The first picture inside the AI service's answer, whichever of its two
 * spellings it uses. `sent` is the photo that went in: an answer that repeats
 * it is not a result, and the guest's own photo is never handed back as one.
 */
function findImage(node: unknown, sent: string, depth = 0): { type: string; data: string } | null {
  if (depth > 12) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findImage(item, sent, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(node)) return null;
  const mime = text(node.mime_type) || text(node.mimeType);
  if (typeof node.data === 'string' && node.data.length > 1000 && node.data !== sent && (mime.startsWith('image/') || node.type === 'image')) {
    return { type: mime.startsWith('image/') ? mime : sniff(node.data), data: node.data };
  }
  for (const value of Object.values(node)) {
    const found = findImage(value, sent, depth + 1);
    if (found) return found;
  }
  return null;
}

/** An answer cut down to what explains a failure: no pictures, no long strings. */
function summary(body: unknown): string {
  const short = JSON.stringify(body, (_key, value) => (typeof value === 'string' && value.length > 200 ? `${value.slice(0, 40)}…` : value)) ?? '';
  return short.slice(0, 400);
}

type Drawn = { ok: true; type: string; bytes: Uint8Array<ArrayBuffer> } | { ok: false; reason: 'refused' | 'failed' | 'key'; detail: string };

/** Reasons the service gives for not drawing a picture it was asked for. */
const REFUSALS = /SAFETY|PROHIBITED|BLOCKLIST|RECITATION|SPII|NO_IMAGE|IMAGE_OTHER/;

interface Attempt {
  name: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** The part of the answer to look for the picture in. */
  output: (answer: Record<string, unknown>) => unknown;
}

/**
 * Asks Gemini to redraw the photo. Google documents image editing for this
 * model through its Interactions API; the older generateContent API is tried
 * when that one does not give a picture, so a change on either side does not
 * take the feature down.
 */
export async function drawWithGemini(env: Pick<AiEnv, 'geminiKey' | 'model' | 'imageSize'>, fetchFn: Fetch, prompt: string, photo: { type: string; bytes: Uint8Array }): Promise<Drawn> {
  const data = toBase64(photo.bytes);
  const key = { 'x-goog-api-key': env.geminiKey, 'Content-Type': 'application/json' };
  const attempts: Attempt[] = [
    {
      name: 'interactions',
      url: `${GEMINI}/interactions`,
      headers: { ...key, 'Api-Revision': '2026-05-20' },
      body: {
        model: env.model,
        input: [
          { type: 'text', text: prompt },
          { type: 'image', mime_type: photo.type, data },
        ],
        response_format: { type: 'image', mime_type: 'image/jpeg', image_size: env.imageSize },
      },
      output: ({ input: _sent, ...made }) => made,
    },
    {
      name: 'generateContent',
      url: `${GEMINI}/models/${encodeURIComponent(env.model)}:generateContent`,
      headers: key,
      body: {
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: photo.type, data } }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: env.imageSize } },
      },
      output: (answer) => answer.candidates,
    },
  ];

  const notes: string[] = [];
  let refused = false;
  for (const attempt of attempts) {
    let response: Response;
    try {
      response = await fetchFn(attempt.url, {
        method: 'POST',
        headers: attempt.headers,
        body: JSON.stringify(attempt.body),
        signal: AbortSignal.timeout(DRAW_TIMEOUT_MS),
      });
    } catch (cause) {
      notes.push(`${attempt.name}: ${cause instanceof Error ? cause.message : 'tidak terhubung'}`);
      continue;
    }
    const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const error = isObject(answer?.error) ? answer.error : {};
      const message = text(error.message) || `HTTP ${response.status}`;
      // A key Google does not accept will not work on the other address either.
      if (response.status === 401 || response.status === 403 || /api key/i.test(message)) {
        return { ok: false, reason: 'key', detail: `${attempt.name}: ${message}`.slice(0, 400) };
      }
      notes.push(`${attempt.name} ${response.status}: ${message}`);
      continue;
    }
    const image = findImage(attempt.output(answer ?? {}), data);
    if (image) return { ok: true, type: image.type, bytes: fromBase64(image.data) };
    const why = summary(answer);
    if (REFUSALS.test(why)) refused = true;
    notes.push(`${attempt.name}: tidak ada gambar dalam jawaban ${why}`);
  }
  return { ok: false, reason: refused ? 'refused' : 'failed', detail: notes.join(' | ').slice(0, 480) };
}

/** Whether Google accepts the key and knows the model: one free question, no picture made. */
async function checkKey(env: AiEnv, fetchFn: Fetch): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetchFn(`${GEMINI}/models/${encodeURIComponent(env.model)}`, {
      method: 'GET',
      headers: { 'x-goog-api-key': env.geminiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) return { ok: true, message: `Google menerima API key ini dan mengenal model ${env.model}.` };
    const answer = (await response.json().catch(() => null)) as { error?: { message?: unknown } } | null;
    return { ok: false, message: (text(answer?.error?.message) || `Google menjawab ${response.status}.`).slice(0, 300) };
  } catch {
    return { ok: false, message: 'Layanan AI Google tidak bisa dihubungi dari server.' };
  }
}

export async function handleShareAi(input: Record<string, unknown>, bearer: string, env: AiEnv, fetchFn: Fetch = fetch, now: () => Date = () => new Date()): Promise<Reply> {
  // For the platform owner's settings page: is the key filled in, and does Google accept it? The key itself is never sent back.
  if (input.action === 'status') {
    const caller = await callerOf(env, fetchFn, bearer);
    if (!caller) return { status: 401, body: { error: 'signed-out' } };
    if ((await rpc<boolean>(env, fetchFn, 'svc_is_superadmin', { p_user: caller.id })) !== true) return { status: 200, body: { error: 'forbidden' } };
    const base = { has_key: env.geminiKey !== '', model: env.model, image_size: env.imageSize, storage: env.r2 !== null };
    if (!base.has_key || input.check !== true) return { status: 200, body: base };
    return { status: 200, body: { ...base, check: await checkKey(env, fetchFn) } };
  }

  if (!env.r2 || !BUCKET_NAME.test(env.r2.bucket)) return { status: 200, body: { error: 'not-configured' } };
  const code = text(input.code);
  const style = AI_STYLES.find((entry) => entry.id === input.style);
  const photo = text(input.photo);
  if (!CODE.test(code) || !style || !(PLAIN_KINDS as readonly string[]).includes(photo)) return { status: 200, body: { error: 'bad-request' } };
  if (!env.geminiKey) return { status: 200, body: { error: 'no-key' } };

  const started = await rpc<{ ok?: boolean; error?: string; id?: string; key?: string; type?: string }>(env, fetchFn, 'share_ai_begin', {
    p_code: code,
    p_style: style.id,
    p_photo: photo,
  });
  if (!started.ok || !started.id || !started.key) return { status: 200, body: { error: started.error ?? 'refused' } };

  const fail = async (error: string, detail: string): Promise<Reply> => {
    // For the owner reading the function's logs; the guest only hears that it did not work.
    console.error(`share-ai ${code} (${style.id}): ${detail}`);
    await rpc(env, fetchFn, 'share_ai_finish', { p_id: started.id, p_ok: false, p_detail: detail }).catch(() => null);
    return { status: 200, body: { error } };
  };

  try {
    const source = await fetchFn(await sign(env, 'GET', started.key, 120, now()), { method: 'GET' });
    if (!source.ok) return await fail('failed', `Foto asal tidak bisa diambil dari R2 (${source.status}).`);
    const bytes = new Uint8Array(await source.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 8_000_000) return await fail('failed', `Ukuran foto asal tidak wajar (${bytes.length} byte).`);

    const drawn = await drawWithGemini(env, fetchFn, promptFor(style), { type: text(started.type) || 'image/jpeg', bytes });
    if (!drawn.ok) return await fail(drawn.reason === 'key' ? 'no-key' : drawn.reason, drawn.detail);

    const key = `s/${code}/ai.${imageExt(drawn.type)}`;
    const stored = await fetchFn(await sign(env, 'PUT', key, 300, now()), { method: 'PUT', headers: { 'Content-Type': drawn.type }, body: drawn.bytes });
    if (!stored.ok) return await fail('failed', `R2 menolak menyimpan hasilnya (${stored.status}).`);

    const done = await rpc<{ ok?: boolean; error?: string }>(env, fetchFn, 'share_ai_finish', {
      p_id: started.id,
      p_ok: true,
      p_file: { key, size: drawn.bytes.length, type: drawn.type, at: now().toISOString() },
    });
    return { status: 200, body: done.ok ? { ok: true } : { error: 'failed' } };
  } catch (cause) {
    return await fail('failed', cause instanceof Error ? cause.message : 'Kesalahan tak terduga.');
  }
}
