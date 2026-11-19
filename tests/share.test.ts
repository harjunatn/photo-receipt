import { AwsClient } from 'aws4fetch';
import { describe, expect, it } from 'vitest';
import { presignUrl } from '../supabase/functions/_shared/s3.ts';
import { accountIdFrom, handleShareGet, handleShareUpload, readShareEnv, type ShareEnv } from '../supabase/functions/_shared/share.ts';

const KEYS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };

describe('presignUrl', () => {
  it('matches the worked example in the AWS documentation', async () => {
    const url = await presignUrl({
      method: 'GET',
      origin: 'https://examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      ...KEYS,
      expiresIn: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toContain('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });

  it('signs exactly as aws4fetch does, also with special characters and extra query parameters', async () => {
    const client = new AwsClient({ ...KEYS, service: 's3', region: 'auto' });
    const when = new Date('2026-11-18T03:04:05Z');
    for (const [method, path, query] of [
      ['PUT', '/hello-snaply/s/abc234defg56/photo.jpg', {}],
      ['GET', '/hello-snaply/s/abc234defg56/photo.jpg', { 'response-content-disposition': 'attachment; filename="hello-snaply-abc234defg56.jpg"' }],
      ['HEAD', '/bucket/a key/with (brackets)!.jpg', {}],
    ] as const) {
      const origin = 'https://0123456789abcdef.r2.cloudflarestorage.com';
      const ours = await presignUrl({ method, origin, path, region: 'auto', ...KEYS, expiresIn: 900, now: when, query });
      const reference = new URL(`${origin}${path.split('/').map(encodeURIComponent).join('/')}`);
      for (const [name, value] of Object.entries(query)) reference.searchParams.set(name, value);
      reference.searchParams.set('X-Amz-Expires', '900');
      const signed = await client.sign(reference.toString(), { method, aws: { signQuery: true, datetime: when.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') } });
      expect(new URL(ours).searchParams.get('X-Amz-Signature')).toBe(new URL(signed.url).searchParams.get('X-Amz-Signature'));
    }
  });
});

const VALUES: Record<string, string> = {
  SUPABASE_URL: 'https://proyek.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  R2_ACCOUNT_ID: 'acc123',
  R2_ACCESS_KEY_ID: 'r2-key',
  R2_SECRET_ACCESS_KEY: 'r2-secret',
  R2_BUCKET: 'hello-snaply-hasil',
};
const env = (overrides: Record<string, string> = {}): ShareEnv => readShareEnv((name) => ({ ...VALUES, ...overrides })[name]);
const NOW = new Date('2026-11-18T05:00:00Z');
const now = () => NOW;

/** A stand-in for the database and for R2. */
function world() {
  const shares = new Map<string, { device: string; files: Record<string, unknown>; created_at: string; expires_at: string }>();
  const stored = new Map<string, number>();
  const calls: string[] = [];
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url.startsWith('https://proyek.supabase.co/rest/v1/rpc/')) {
      const name = url.split('/rpc/')[1];
      const args = JSON.parse(String(init.body));
      calls.push(name);
      if (name === 'share_claim') {
        if (args.p_token !== 'tablet-a' && args.p_token !== 'tablet-b') return json({ error: 'unpaired' });
        const row = shares.get(args.p_code) ?? { device: args.p_token, files: {}, created_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 3 * 86_400_000).toISOString() };
        shares.set(args.p_code, row);
        return json(row.device === args.p_token ? { ok: true, expires_at: row.expires_at } : { error: 'taken' });
      }
      if (name === 'share_add_file') {
        const row = shares.get(args.p_code);
        if (!row || row.device !== args.p_token) return json({ error: 'not-found' });
        row.files[args.p_kind] = args.p_file;
        return json({ ok: true });
      }
      if (name === 'share_lookup') {
        return json({
          platform: { name: 'jepretin', watermark: 'didukung oleh jepretin' },
          shares: args.p_codes
            .filter((c: string) => shares.has(c))
            .map((c: string) => ({ code: c, device_name: 'Booth', brand: { title: 'Hello Snaply', accent: '#ff00aa' }, ...shares.get(c) })),
        });
      }
      throw new Error(`rpc tak dikenal: ${name}`);
    }
    // R2: only the object's existence and size matter here.
    const key = new URL(url).pathname.replace('/hello-snaply-hasil/', '');
    calls.push(`r2 ${init.method} ${key}`);
    const size = stored.get(key);
    return size === undefined ? new Response(null, { status: 404 }) : new Response(null, { status: 200, headers: { 'content-length': String(size) } });
  };
  return { shares, stored, calls, fetchFn };
}

describe('share-upload', () => {
  it('signs an upload to the session folder in the R2 bucket', async () => {
    const { calls, fetchFn } = world();
    const reply = await handleShareUpload({ action: 'sign', token: 'tablet-a', code: 'abc234defg56', kind: 'photo', size: 800_000 }, env(), fetchFn, now);
    const url = new URL(String(reply.body.url));
    expect(url.host).toBe('acc123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/hello-snaply-hasil/s/abc234defg56/photo.jpg');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Credential')).toBe('r2-key/20261118/auto/s3/aws4_request');
    expect(reply.body.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(calls).toEqual(['share_claim']);
    // The secret key is never handed out.
    expect(JSON.stringify(reply.body)).not.toContain('r2-secret');
  });

  it('refuses bad codes, unknown kinds, oversized files, and a code another tablet owns', async () => {
    const { fetchFn } = world();
    const ask = (input: Record<string, unknown>) => handleShareUpload({ action: 'sign', token: 'tablet-a', code: 'abc234defg56', kind: 'photo', size: 1000, ...input }, env(), fetchFn, now);
    expect((await ask({ code: 'ABC' })).body.error).toBe('bad-request');
    expect((await ask({ code: '../../secret' })).body.error).toBe('bad-request');
    expect((await ask({ kind: 'script' })).body.error).toBe('bad-request');
    expect((await ask({ size: 99_000_000 })).body.error).toBe('too-large');
    expect((await ask({ token: 'palsu' })).body.error).toBe('unpaired');
    expect((await ask({})).body.url).toBeTruthy();
    expect((await ask({ token: 'tablet-b' })).body.error).toBe('taken');
  });

  it('records a file only once it is really in R2', async () => {
    const { shares, stored, fetchFn } = world();
    await handleShareUpload({ action: 'sign', token: 'tablet-a', code: 'abc234defg56', kind: 'photo', size: 1000 }, env(), fetchFn, now);
    const done = () => handleShareUpload({ action: 'done', token: 'tablet-a', code: 'abc234defg56', kind: 'photo' }, env(), fetchFn, now);
    expect((await done()).body).toEqual({ error: 'missing' });
    stored.set('s/abc234defg56/photo.jpg', 812_345);
    expect((await done()).body).toEqual({ ok: true });
    expect(shares.get('abc234defg56')?.files.photo).toMatchObject({ key: 's/abc234defg56/photo.jpg', size: 812_345, type: 'image/jpeg' });
  });

  it('says so while R2 is not set up', async () => {
    const { fetchFn } = world();
    const reply = await handleShareUpload({ action: 'sign', token: 'tablet-a', code: 'abc234defg56', kind: 'photo', size: 1 }, env({ R2_SECRET_ACCESS_KEY: '' }), fetchFn, now);
    expect(reply.body.error).toBe('not-configured');
  });
});

describe('R2 settings', () => {
  it('takes the account id also from a pasted endpoint address', () => {
    expect(accountIdFrom('662366accf7d11c1')).toBe('662366accf7d11c1');
    expect(accountIdFrom('https://662366accf7d11c1.r2.cloudflarestorage.com')).toBe('662366accf7d11c1');
    expect(accountIdFrom(' https://662366accf7d11c1.r2.cloudflarestorage.com/bucket/ ')).toBe('662366accf7d11c1');
    expect(readShareEnv((name) => ({ ...VALUES, R2_ACCOUNT_ID: 'https://acc123.r2.cloudflarestorage.com' })[name]).r2?.origin).toBe('https://acc123.r2.cloudflarestorage.com');
  });

  it('refuses a bucket name R2 cannot have, with a message saying which setting to fix', async () => {
    const { fetchFn } = world();
    const reply = await handleShareUpload({ action: 'sign', token: 'tablet-a', code: 'abc234defg56', kind: 'photo', size: 1 }, env({ R2_BUCKET: 'Photo Receipt' }), fetchFn, now);
    expect(reply.body).toMatchObject({ error: 'not-configured' });
    expect(String(reply.body.message)).toContain('R2_BUCKET');
  });

  it('explains an unreachable R2, a missing bucket and refused keys without exposing the key id', async () => {
    // The tablet owns the code; only what R2 answers differs from case to case.
    const ask = (r2: (url: string, init: RequestInit) => Promise<Response>) =>
      handleShareUpload(
        { action: 'done', token: 'tablet-a', code: 'abc234defg56', kind: 'photo' },
        env(),
        (url, init) => (url.includes('/rest/v1/rpc/share_claim') ? Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })) : r2(url, init)),
        now,
      );
    const unreachable = await ask(async () => {
      throw new TypeError('error sending request for url (https://acc123.r2.cloudflarestorage.com/...r2-key...)');
    });
    expect(unreachable.body.message).toContain('R2_ACCOUNT_ID');
    expect(JSON.stringify(unreachable.body)).not.toContain('r2-key');
    const noBucket = await ask(async (_url, init) =>
      init.method === 'HEAD' ? new Response(null, { status: 404 }) : new Response('<Error><Code>NoSuchBucket</Code></Error>', { status: 404 }),
    );
    expect(noBucket.body.message).toContain('R2_BUCKET');
    const refused = await ask(async () => new Response(null, { status: 403 }));
    expect(refused.body.message).toContain('R2_SECRET_ACCESS_KEY');
    const wrongSecret = await ask(async (_url, init) =>
      init.method === 'HEAD' ? new Response(null, { status: 403 }) : new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 }),
    );
    expect(wrongSecret.body).toMatchObject({ code: 'SignatureDoesNotMatch' });
    expect(wrongSecret.body.message).toContain('Secret Access Key');
  });
});

describe('share-upload, finishing', () => {
  it('asks nothing of R2 for a tablet that does not own the code, and never offers a file larger than allowed', async () => {
    const w = world();
    await handleShareUpload({ action: 'sign', token: 'tablet-a', code: 'abc234defg56', kind: 'thumb', size: 10 }, env(), w.fetchFn, now);
    const before = w.calls.filter((call) => call.startsWith('r2')).length;
    expect((await handleShareUpload({ action: 'done', token: 'tablet-b', code: 'abc234defg56', kind: 'thumb' }, env(), w.fetchFn, now)).body.error).toBe('taken');
    expect((await handleShareUpload({ action: 'done', token: 'bukan-tablet', code: 'abc234defg56', kind: 'thumb' }, env(), w.fetchFn, now)).body.error).toBe('unpaired');
    expect(w.calls.filter((call) => call.startsWith('r2'))).toHaveLength(before);
    // The upload address cannot limit the size, so the size is checked when the upload is reported.
    w.stored.set('s/abc234defg56/thumb.jpg', 5_000_000);
    expect((await handleShareUpload({ action: 'done', token: 'tablet-a', code: 'abc234defg56', kind: 'thumb' }, env(), w.fetchFn, now)).body.error).toBe('too-large');
    expect(w.shares.get('abc234defg56')?.files).toEqual({});
  });
});

describe('share-get', () => {
  async function uploaded(kinds: string[]) {
    const w = world();
    for (const kind of kinds) {
      await handleShareUpload({ action: 'sign', token: 'tablet-a', code: 'abc234defg56', kind, size: 10 }, env(), w.fetchFn, now);
      w.stored.set(`s/abc234defg56/${kind}.${kind === 'live' || kind === 'slideshow' ? 'mp4' : 'jpg'}`, 10);
      await handleShareUpload({ action: 'done', token: 'tablet-a', code: 'abc234defg56', kind }, env(), w.fetchFn, now);
    }
    return w;
  }

  it('gives hour-long links to view and to download, with a readable file name', async () => {
    const { fetchFn } = await uploaded(['photo', 'thumb']);
    const reply = await handleShareGet({ code: 'abc234defg56' }, env(), fetchFn, now);
    expect(reply.body.brand).toEqual({ title: 'Hello Snaply', accent: '#ff00aa' });
    expect(reply.body.platform).toEqual({ name: 'jepretin', watermark: 'didukung oleh jepretin' });
    const [share] = reply.body.shares as { status: string; files: Record<string, { view: string; download: string }> }[];
    expect(share.status).toBe('ready');
    const view = new URL(share.files.photo.view);
    expect(view.pathname).toBe('/hello-snaply-hasil/s/abc234defg56/photo.jpg');
    expect(view.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(new URL(share.files.photo.download).searchParams.get('response-content-disposition')).toBe('attachment; filename="hello-snaply-abc234defg56.jpg"');
    expect(share.files.thumb).toBeTruthy();
  });

  it('answers pending before the photo arrives, and expired once its days are over', async () => {
    const { fetchFn } = await uploaded(['thumb']);
    expect(((await handleShareGet({ code: 'abc234defg56' }, env(), fetchFn, now)).body.shares as { status: string }[])[0].status).toBe('pending');
    expect(((await handleShareGet({ code: 'zzzzzzzzzzzz' }, env(), fetchFn, now)).body.shares as { status: string }[])[0].status).toBe('pending');
    const later = () => new Date(NOW.getTime() + 4 * 86_400_000);
    const expired = (await handleShareGet({ code: 'abc234defg56' }, env(), fetchFn, later)).body.shares as { status: string; files?: unknown }[];
    expect(expired[0].status).toBe('expired');
    expect(expired[0].files).toBeUndefined();
  });

  it('answers many codes at once for the dashboard, ignoring malformed ones', async () => {
    const { calls, fetchFn } = await uploaded(['photo']);
    const reply = await handleShareGet({ codes: ['abc234defg56', 'bukan kode', 'zzzzzzzzzzzz', 'abc234defg56'] }, env(), fetchFn, now);
    expect((reply.body.shares as { code: string }[]).map((s) => s.code)).toEqual(['abc234defg56', 'zzzzzzzzzzzz']);
    expect(calls.filter((c) => c === 'share_lookup')).toHaveLength(1);
    expect((await handleShareGet({ codes: ['x'] }, env(), fetchFn, now)).body.error).toBe('bad-request');
  });
});
