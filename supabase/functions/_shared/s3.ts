/**
 * Presigned URLs for S3-compatible storage (Cloudflare R2), AWS Signature
 * Version 4 in the query string. Only Web APIs are used, so this runs in
 * Supabase Edge Functions and in the project's tests alike.
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 */

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, text: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, encoder.encode(text));
}

/** RFC 3986 encoding, as SigV4 requires: everything but A–Z a–z 0–9 - _ . ~ is escaped. */
export function uriEncode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface PresignInput {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  /** Scheme and host, e.g. https://<account>.r2.cloudflarestorage.com */
  origin: string;
  /** Path below the origin, segments not yet encoded, e.g. /bucket/s/abc/photo.jpg */
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Seconds the URL stays valid (1 to 604800). */
  expiresIn: number;
  now: Date;
  /** Extra signed query parameters, e.g. response-content-disposition. */
  query?: Record<string, string>;
}

/** Signs a request in its URL, so a browser can make it without holding any key. Only the host header is signed. */
export async function presignUrl(input: PresignInput): Promise<string> {
  const host = new URL(input.origin).host;
  const amzDate = input.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const canonicalPath = input.path
    .split('/')
    .map((segment) => uriEncode(segment))
    .join('/');

  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.max(1, Math.min(604_800, Math.round(input.expiresIn)))),
    'X-Amz-SignedHeaders': 'host',
    ...input.query,
  };
  const canonicalQuery = Object.keys(params)
    .map((name) => [uriEncode(name), uriEncode(params[name])] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');

  const canonicalRequest = [input.method, canonicalPath, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');

  let key: ArrayBuffer = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), day);
  for (const part of [input.region, 's3', 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, stringToSign));

  return `${input.origin.replace(/\/+$/, '')}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
