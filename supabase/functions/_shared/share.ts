/**
 * The guest's digital copies: tablets upload them straight to Cloudflare R2 with
 * URLs signed here, and guests (and the owner) get short-lived links to view
 * and download them. The R2 keys never leave the server.
 */
import { rpc, type Reply } from './handlers.ts';
import { presignUrl } from './s3.ts';
import { AI_STYLES, AI_TRIES, PLAIN_KINDS } from './styles.ts';

export interface ShareEnv {
  supabaseUrl: string;
  serviceKey: string;
  /** null while the R2 keys have not been filled in. */
  r2: { origin: string; bucket: string; accessKeyId: string; secretAccessKey: string } | null;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A session's photo without its frame, for the AI edit: small, one per shot. */
const PLAIN = { ext: 'jpg', type: 'image/jpeg', max: 3_000_000 } as const;

/** What a tablet may upload for one session, and how large each may be. */
export const KINDS = {
  photo: { ext: 'jpg', type: 'image/jpeg', max: 15_000_000 },
  thumb: { ext: 'jpg', type: 'image/jpeg', max: 1_000_000 },
  live: { ext: 'mp4', type: 'video/mp4', max: 40_000_000 },
  slideshow: { ext: 'mp4', type: 'video/mp4', max: 40_000_000 },
  p1: PLAIN,
  p2: PLAIN,
  p3: PLAIN,
  p4: PLAIN,
  p5: PLAIN,
  p6: PLAIN,
} as const;
export type ShareKind = keyof typeof KINDS;
/** The AI's version of one photo. Made by the share-ai function, never uploaded by a tablet. */
export const AI_KIND = 'ai';

const CODE = /^[a-z0-9]{12}$/;
const UPLOAD_SECONDS = 15 * 60;
const VIEW_SECONDS = 60 * 60;

/**
 * The account id on its own, also when the whole S3 endpoint was pasted
 * (https://<id>.r2.cloudflarestorage.com/...).
 */
export function accountIdFrom(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.r2\.cloudflarestorage\.com$/i, '')
    .replace(/\.(eu|fedramp)$/i, '');
}

/** R2 bucket names are 3–63 lower-case letters, digits and hyphens. */
export const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function readShareEnv(get: (name: string) => string | undefined): ShareEnv {
  const value = (name: string) => (get(name) ?? '').trim();
  const account = accountIdFrom(value('R2_ACCOUNT_ID'));
  const complete = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].every((name) => value(name) !== '') && (account || value('R2_ENDPOINT'));
  return {
    supabaseUrl: value('SUPABASE_URL').replace(/\/+$/, ''),
    serviceKey: value('SUPABASE_SERVICE_ROLE_KEY'),
    r2: complete
      ? {
          origin: (value('R2_ENDPOINT') || `https://${account}.r2.cloudflarestorage.com`).replace(/\/+$/, ''),
          bucket: value('R2_BUCKET').replace(/^\/+|\/+$/g, ''),
          accessKeyId: value('R2_ACCESS_KEY_ID'),
          secretAccessKey: value('R2_SECRET_ACCESS_KEY'),
        }
      : null,
  };
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const isKind = (value: unknown): value is ShareKind => typeof value === 'string' && value in KINDS;
/** The files a tablet makes after the photo; the download page waits for those it was told to expect. */
const LATER = ['live', 'slideshow'] as const;
type LaterKind = (typeof LATER)[number];
const expectedFrom = (value: unknown): LaterKind[] =>
  Array.isArray(value) ? LATER.filter((kind) => value.includes(kind)) : [];
const objectKey = (code: string, kind: ShareKind) => `s/${code}/${kind}.${KINDS[kind].ext}`;

/** A signed address for one object in the bucket. */
export function sign(env: ShareEnv, method: 'GET' | 'PUT' | 'HEAD', key: string, expiresIn: number, now: Date, query?: Record<string, string>) {
  const r2 = env.r2!;
  return presignUrl({
    method,
    origin: r2.origin,
    path: `/${r2.bucket}/${key}`,
    region: 'auto',
    accessKeyId: r2.accessKeyId,
    secretAccessKey: r2.secretAccessKey,
    expiresIn,
    now,
    query,
  });
}

/**
 * share-upload, called by a paired tablet:
 *  - action "sign": a URL to PUT one file to, valid for a quarter of an hour;
 *  - action "done": checks the file really arrived and records it.
 */
export async function handleShareUpload(input: Record<string, unknown>, env: ShareEnv, fetchFn: Fetch = fetch, now: () => Date = () => new Date()): Promise<Reply> {
  if (!env.r2) return { status: 200, body: { error: 'not-configured' } };
  if (!BUCKET_NAME.test(env.r2.bucket)) {
    return { status: 200, body: { error: 'not-configured', message: 'R2_BUCKET bukan nama bucket R2 yang sah (huruf kecil, angka, tanda hubung).' } };
  }
  const code = text(input.code);
  const kind = input.kind;
  if (!CODE.test(code) || !isKind(kind)) return { status: 200, body: { error: 'bad-request' } };
  const token = text(input.token);
  const key = objectKey(code, kind);

  if (input.action === 'sign') {
    const size = Number(input.size);
    if (!Number.isFinite(size) || size <= 0 || size > KINDS[kind].max) return { status: 200, body: { error: 'too-large' } };
    const claim = await rpc<{ ok?: boolean; error?: string }>(env, fetchFn, 'share_claim', { p_token: token, p_code: code });
    if (!claim.ok) return { status: 200, body: { error: claim.error ?? 'refused' } };
    return {
      status: 200,
      body: { url: await sign(env, 'PUT', key, UPLOAD_SECONDS, now()), method: 'PUT', headers: { 'Content-Type': KINDS[kind].type } },
    };
  }

  if (input.action === 'done') {
    // Only the tablet that owns the code gets to make this function talk to R2.
    const owner = await rpc<{ ok?: boolean; error?: string }>(env, fetchFn, 'share_claim', { p_token: token, p_code: code });
    if (!owner.ok) return { status: 200, body: { error: owner.error ?? 'refused' } };
    let head: Response;
    try {
      head = await fetchFn(await sign(env, 'HEAD', key, 60, now()), { method: 'HEAD' });
    } catch {
      // The address itself is wrong, e.g. an account id that is not one. The URL is not repeated: it carries the key id.
      return { status: 200, body: { error: 'storage', message: 'R2 tidak bisa dihubungi. Periksa R2_ACCOUNT_ID.' } };
    }
    if (head.status === 404) {
      // HEAD has no body, so ask once more to tell a missing file from a missing bucket.
      const probe = await fetchFn(await sign(env, 'GET', key, 60, now()), { method: 'GET' }).catch(() => null);
      const reason = probe ? await probe.text().catch(() => '') : '';
      if (reason.includes('NoSuchBucket')) return { status: 200, body: { error: 'storage', message: 'Bucket R2 tidak ditemukan. Periksa R2_BUCKET.' } };
      return { status: 200, body: { error: 'missing' } };
    }
    if (head.status === 401 || head.status === 403) {
      // HEAD answers without a body; a GET tells which part of the access R2 refused.
      const probe = await fetchFn(await sign(env, 'GET', key, 60, now()), { method: 'GET' }).catch(() => null);
      const reason = (probe ? await probe.text().catch(() => '') : '').match(/<Code>([^<]+)<\/Code>/)?.[1] ?? '';
      // For the owner reading the function logs: which bucket and account were tried (neither is secret).
      console.error(`R2 menolak akses (${reason || head.status}) ke bucket "${env.r2!.bucket}" di ${new URL(env.r2!.origin).host}`);
      const messages: Record<string, string> = {
        InvalidAccessKeyId: 'R2 tidak mengenal R2_ACCESS_KEY_ID. Salin ulang Access Key ID dari token R2.',
        SignatureDoesNotMatch: 'R2_SECRET_ACCESS_KEY tidak cocok dengan R2_ACCESS_KEY_ID. Salin ulang Secret Access Key (bukan Token value).',
        AccessDenied: 'Token R2 tidak punya izin ke bucket ini. Pastikan izinnya Object Read & Write dan bucket-nya termasuk.',
      };
      return {
        status: 200,
        body: {
          error: 'storage',
          code: reason || String(head.status),
          message: messages[reason] ?? 'R2 menolak kunci akses. Periksa R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, dan izin token ke bucket ini.',
        },
      };
    }
    if (!head.ok) return { status: 200, body: { error: 'storage', message: `R2 menjawab ${head.status}` } };
    const size = Number(head.headers.get('content-length') ?? 0);
    // The upload address does not limit the size, so a file larger than allowed is simply never offered to anyone.
    if (size > KINDS[kind].max) return { status: 200, body: { error: 'too-large' } };
    const expects = kind === 'photo' ? expectedFrom(input.expects) : [];
    const recorded = await rpc<{ ok?: boolean; error?: string }>(env, fetchFn, 'share_add_file', {
      p_token: token,
      p_code: code,
      p_kind: kind,
      p_file: { key, size, type: KINDS[kind].type, at: now().toISOString(), ...(expects.length ? { expects } : {}) },
    });
    return { status: 200, body: recorded.ok ? { ok: true } : { error: recorded.error ?? 'refused' } };
  }

  return { status: 200, body: { error: 'bad-request' } };
}

interface ShareRow {
  /** Name and colour of the franchise whose booth took the photo. */
  brand?: { title?: unknown; accent?: unknown } | null;
  code: string;
  files: Partial<Record<ShareKind | typeof AI_KIND, { key: string; size: number; type: string; expects?: unknown; style?: unknown }>>;
  /** How the session's AI edit stands: whether its franchise has the feature, tries that failed, and whether one is being drawn now. */
  ai?: { on?: unknown; failed?: unknown; busy?: unknown } | null;
  created_at: string;
  expires_at: string;
  device_name: string;
}

/** The file extension that goes with an image type; the AI service chooses the type of what it draws. */
export function imageExt(type: string): string {
  return type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
}

/** A file name for downloads: the outlet's name in plain letters, then the code. */
function fileName(brand: string, code: string, kind: string, ext: string): string {
  const base = brand.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'foto';
  return `${base}-${code}${kind === 'photo' ? '' : `-${kind}`}.${ext}`;
}

/**
 * share-get, public: the files behind one or more codes, as links that last an
 * hour. A code nobody has uploaded to yet answers "pending"; one past its days
 * answers "expired". Every share carries the brand of its own franchise; the
 * top-level brand is that of the first code found, for the guest page that asks for one.
 */
export async function handleShareGet(input: Record<string, unknown>, env: ShareEnv, fetchFn: Fetch = fetch, now: () => Date = () => new Date()): Promise<Reply> {
  if (!env.r2 || !BUCKET_NAME.test(env.r2.bucket)) return { status: 200, body: { error: 'not-configured' } };
  const asked = Array.isArray(input.codes) ? input.codes : [input.code];
  const codes = [...new Set(asked.map(text).filter((code) => CODE.test(code)))].slice(0, 60);
  if (codes.length === 0) return { status: 200, body: { error: 'bad-request' } };

  const found = await rpc<{ platform?: { name?: unknown; watermark?: unknown } | null; shares?: ShareRow[] }>(env, fetchFn, 'share_lookup', { p_codes: codes });
  const platform = { name: text(found.platform?.name), watermark: text(found.platform?.watermark) };
  const brandOf = (row: ShareRow | undefined) => ({ title: text(row?.brand?.title) || platform.name || 'Foto', accent: text(row?.brand?.accent) || '' });
  const rows = new Map((found.shares ?? []).map((row) => [row.code, row]));
  const brand = brandOf(codes.map((code) => rows.get(code)).find((row) => row !== undefined));
  const at = now();

  const shares = await Promise.all(
    codes.map(async (code) => {
      const row = rows.get(code);
      if (!row) return { code, status: 'pending' };
      const own = brandOf(row);
      if (Date.parse(row.expires_at) < at.getTime()) return { code, status: 'expired', expires_at: row.expires_at, brand: own };
      const files: Record<string, { view: string; download: string; size: number; type: string; style?: string }> = {};
      for (const kind of [...(Object.keys(KINDS) as ShareKind[]), AI_KIND] as const) {
        const file = row.files[kind];
        if (!file) continue;
        const ext = kind === AI_KIND ? imageExt(file.type) : KINDS[kind].ext;
        files[kind] = {
          view: await sign(env, 'GET', file.key, VIEW_SECONDS, at),
          download: await sign(env, 'GET', file.key, VIEW_SECONDS, at, {
            'response-content-disposition': `attachment; filename="${fileName(own.title, code, kind, ext)}"`,
          }),
          size: file.size,
          type: file.type,
          ...(kind === AI_KIND && text(file.style) ? { style: text(file.style) } : {}),
        };
      }
      // Videos the tablet said would follow the photo and that have not arrived yet.
      const coming = expectedFrom(row.files.photo?.expects).filter((kind) => !files[kind]);
      // The AI edit is offered while the platform owner has it switched on for this franchise and the booth sent plain
      // photos to pick from. A result made while it was on stays downloadable.
      const aiOn = row.ai?.on === true;
      const plain = PLAIN_KINDS.some((kind) => files[kind]);
      const ai =
        files[AI_KIND] || (aiOn && plain)
          ? {
              open: aiOn && plain && !files[AI_KIND],
              busy: row.ai?.busy === true,
              tries_left: Math.max(0, AI_TRIES - (Number(row.ai?.failed) || 0)),
              styles: AI_STYLES.map((style) => ({ id: style.id, label: style.label })),
            }
          : undefined;
      return {
        code,
        status: files.photo ? 'ready' : 'pending',
        created_at: row.created_at,
        expires_at: row.expires_at,
        brand: own,
        files,
        coming,
        ...(ai ? { ai } : {}),
      };
    }),
  );
  return { status: 200, body: { brand, platform, shares } };
}
