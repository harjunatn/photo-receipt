/**
 * DOKU SNAP, QRIS merchant-presented mode: make a QR for one payment and ask
 * whether it was paid. Written against DOKU's public documentation:
 * https://developers.doku.com/accept-payments/direct-api/snap/integration-guide/qris
 *
 * Only Web APIs are used (fetch, WebCrypto), so the same file runs in Supabase
 * Edge Functions (Deno) and in the project's tests (Node).
 */

export interface DokuConfig {
  /** https://api.doku.com for production, https://api-sandbox.doku.com for the sandbox. */
  baseUrl: string;
  /** "Client ID" from the DOKU Back Office, looks like BRN-0000-0000000000000. */
  clientId: string;
  secretKey: string;
  /** The merchant's RSA private key in PEM form; its public half is uploaded to DOKU. */
  privateKeyPem: string;
  /** The QRIS merchant id DOKU assigned (not the Client ID). */
  merchantId: string;
  terminalId: string;
  postalCode: string;
  /** Whether to tell DOKU when the QR runs out. Turn off if DOKU rejects the field. */
  sendValidity: boolean;
}

export class DokuError extends Error {
  /** DOKU's responseCode, or the HTTP status when there was none. */
  code: string;
  detail: unknown;

  constructor(message: string, code: string, detail: unknown = null) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const TOKEN_PATH = '/authorization/v1/access-token/b2b';
const GENERATE_PATH = '/snap-adapter/b2b/v1.0/qr/qr-mpm-generate';
const QUERY_PATH = '/snap-adapter/b2b/v1.0/qr/qr-mpm-query';
const EXPIRE_PATH = '/snap-adapter/b2b/v1.0/qr/qr-expire';

const encoder = new TextEncoder();

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** DOKU's examples carry Jakarta time with its offset: 2024-03-26T16:01:41+07:00. */
export function jakartaTimestamp(date: Date): string {
  return `${new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 19)}+07:00`;
}

/** DER length octets for a value of the given size. */
function derLength(length: number): number[] {
  if (length < 128) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return [0x80 | bytes.length, ...bytes];
}

/** Wraps a PKCS#1 key ("BEGIN RSA PRIVATE KEY") as PKCS#8, the only form WebCrypto imports. */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = [0x02, 0x01, 0x00];
  // SEQUENCE { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL }
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const key = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [...version, ...algorithm, ...key];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

const RSA_SHA256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

/** Why a pasted key cannot be used, in words the owner can act on. Never includes the key itself. */
const WRONG_KIND: Record<string, string> = {
  'PUBLIC KEY': 'DOKU_PRIVATE_KEY berisi kunci PUBLIK. Yang dibutuhkan adalah kunci PRIVAT (pasangannya), bukan Merchant Public Key yang diunggah ke DOKU.',
  'RSA PUBLIC KEY': 'DOKU_PRIVATE_KEY berisi kunci PUBLIK. Yang dibutuhkan adalah kunci PRIVAT (pasangannya), bukan Merchant Public Key yang diunggah ke DOKU.',
  CERTIFICATE: 'DOKU_PRIVATE_KEY berisi sertifikat, bukan kunci privat.',
  'ENCRYPTED PRIVATE KEY': 'DOKU_PRIVATE_KEY masih dikunci dengan password. Buka kuncinya dulu (lihat README), lalu tempel hasilnya.',
  'OPENSSH PRIVATE KEY': 'DOKU_PRIVATE_KEY berformat OpenSSH. Ubah ke format PEM dulu (lihat README), lalu tempel hasilnya.',
  'EC PRIVATE KEY': 'DOKU_PRIVATE_KEY adalah kunci EC, sedangkan DOKU memakai kunci RSA.',
};

/**
 * Reads the merchant's RSA private key: PKCS#8 ("BEGIN PRIVATE KEY") or PKCS#1
 * ("BEGIN RSA PRIVATE KEY"), with or without its BEGIN/END lines, and also when
 * its line breaks were pasted as the two characters "\n".
 */
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const text = pem.replace(/\\n/g, '\n').trim();
  const label = /-----BEGIN ([A-Z0-9 ]+)-----/.exec(text)?.[1] ?? '';
  if (WRONG_KIND[label]) throw new DokuError(WRONG_KIND[label], 'config');
  if (/^(ssh-rsa|ssh-ed25519) /.test(text)) throw new DokuError(WRONG_KIND['PUBLIC KEY'], 'config');

  const base64 = text.replace(/-----[^-]+-----/g, '').replace(/[\s"']+/g, '');
  if (!base64) throw new DokuError('DOKU_PRIVATE_KEY kosong.', 'config');
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = fromBase64(base64);
  } catch {
    throw new DokuError('DOKU_PRIVATE_KEY bukan format PEM: ada karakter yang tidak semestinya. Tempel ulang tanpa diubah.', 'config');
  }

  // Without a label the form is unknown, so both are tried.
  const attempts = label === 'RSA PRIVATE KEY' ? [pkcs1ToPkcs8(der)] : label === 'PRIVATE KEY' ? [der] : [der, pkcs1ToPkcs8(der)];
  for (const candidate of attempts) {
    try {
      return await crypto.subtle.importKey('pkcs8', candidate, RSA_SHA256, false, ['sign']);
    } catch {
      // Try the next form.
    }
  }
  // Only the shape of the key is reported, never its content.
  const shape = label ? `berlabel "${label}"` : 'tanpa baris BEGIN/END';
  throw new DokuError(
    `DOKU_PRIVATE_KEY tidak bisa dibaca (${shape}, ${der.length} byte). Kemungkinan terpotong saat ditempel, atau bukan kunci privat RSA. Tempel ulang utuh dari berkasnya.`,
    'config',
  );
}

/** Signature of the access-token request: SHA256withRSA over "clientId|timestamp". */
export async function signTokenRequest(clientId: string, timestamp: string, privateKeyPem: string): Promise<string> {
  const key = await importPrivateKey(privateKeyPem);
  return toBase64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${clientId}|${timestamp}`)));
}

/**
 * Signature of a transaction request: HMAC-SHA512 with the secret key over
 * "METHOD:path:accessToken:lowercase(hex(sha256(body))):timestamp".
 * `body` must be the exact text that is sent.
 */
export async function signRequest(secretKey: string, method: string, path: string, accessToken: string, body: string, timestamp: string): Promise<string> {
  const digest = toHex(await crypto.subtle.digest('SHA-256', encoder.encode(body))).toLowerCase();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secretKey), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return toBase64(await crypto.subtle.sign('HMAC', key, encoder.encode(`${method}:${path}:${accessToken}:${digest}:${timestamp}`)));
}

/**
 * Checks DOKU's payment notification: HMAC-SHA256 with the secret key over the
 * request's identifying headers and a digest of the raw body.
 */
export async function verifyNotification(
  secretKey: string,
  headers: { clientId: string; requestId: string; timestamp: string; signature: string },
  targetPath: string,
  rawBody: string,
): Promise<boolean> {
  const digest = toBase64(await crypto.subtle.digest('SHA-256', encoder.encode(rawBody)));
  const text = `Client-Id:${headers.clientId}\nRequest-Id:${headers.requestId}\nRequest-Timestamp:${headers.timestamp}\nRequest-Target:${targetPath}\nDigest:${digest}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = `HMACSHA256=${toBase64(await crypto.subtle.sign('HMAC', key, encoder.encode(text)))}`;
  // Compared in full, without stopping at the first difference.
  if (expected.length !== headers.signature.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ headers.signature.charCodeAt(i);
  return difference === 0;
}

export type QrState = 'paid' | 'pending' | 'failed';

/** DOKU's latestTransactionStatus: 00 success, 05 canceled, 06 failed; everything else is still open. */
export function stateFromStatus(latestTransactionStatus: unknown): QrState {
  if (latestTransactionStatus === '00') return 'paid';
  return latestTransactionStatus === '05' || latestTransactionStatus === '06' ? 'failed' : 'pending';
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// Access tokens live for 15 minutes; one is reused for as long as this function instance stays warm.
const tokens = new Map<string, { value: string; until: number }>();

export function createDoku(config: DokuConfig, fetchFn: Fetch = fetch, now: () => Date = () => new Date()) {
  const accessToken = async (): Promise<string> => {
    const cached = tokens.get(config.clientId);
    if (cached && cached.until > now().getTime()) return cached.value;
    const timestamp = jakartaTimestamp(now());
    const response = await fetchFn(config.baseUrl + TOKEN_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CLIENT-KEY': config.clientId,
        'X-TIMESTAMP': timestamp,
        'X-SIGNATURE': await signTokenRequest(config.clientId, timestamp, config.privateKeyPem),
      },
      body: JSON.stringify({ grantType: 'client_credentials' }),
    });
    const result = (await response.json().catch(() => null)) as { accessToken?: string; expiresIn?: number; responseCode?: string; responseMessage?: string } | null;
    if (!response.ok || !result?.accessToken) {
      throw new DokuError(`DOKU menolak permintaan token: ${result?.responseMessage ?? `HTTP ${response.status}`}`, result?.responseCode ?? String(response.status), result);
    }
    // Refreshed a minute early, so a token never runs out in the middle of a request.
    tokens.set(config.clientId, { value: result.accessToken, until: now().getTime() + Math.max(60, (result.expiresIn ?? 900) - 60) * 1000 });
    return result.accessToken;
  };

  const post = async (path: string, payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> => {
    const token = await accessToken();
    const timestamp = jakartaTimestamp(now());
    const body = JSON.stringify(payload);
    // Must be digits only and unique within a day.
    const externalId = `${now().getTime()}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
    const response = await fetchFn(config.baseUrl + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-PARTNER-ID': config.clientId,
        'X-EXTERNAL-ID': externalId,
        'X-TIMESTAMP': timestamp,
        'X-SIGNATURE': await signRequest(config.secretKey, 'POST', path, token, body, timestamp),
        'CHANNEL-ID': 'H2H',
      },
      body,
    });
    // A rejected token is not kept for the next attempt.
    if (response.status === 401) tokens.delete(config.clientId);
    return { status: response.status, body: ((await response.json().catch(() => null)) as Record<string, unknown> | null) ?? {} };
  };

  return {
    /** Makes a QR that pays exactly `amount` rupiah. */
    async generateQr(input: { partnerRef: string; amount: number; expiresAt: Date }): Promise<{ providerRef: string; qr: string; detail: unknown }> {
      const { status, body } = await post(GENERATE_PATH, {
        partnerReferenceNo: input.partnerRef,
        amount: { value: `${Math.round(input.amount)}.00`, currency: 'IDR' },
        merchantId: config.merchantId,
        terminalId: config.terminalId,
        ...(config.sendValidity ? { validityPeriod: jakartaTimestamp(input.expiresAt) } : {}),
        additionalInfo: { postalCode: config.postalCode, feeType: '1' },
      });
      const qr = body.qrContent;
      if (status !== 200 || typeof qr !== 'string' || !qr) {
        throw new DokuError(`DOKU menolak pembuatan QR: ${String(body.responseMessage ?? `HTTP ${status}`)}`, String(body.responseCode ?? status), body);
      }
      const { qrContent: _qr, ...detail } = body;
      return { providerRef: String(body.referenceNo ?? ''), qr, detail };
    },

    /** Asks whether a QR made earlier has been paid. A QR DOKU does not know yet counts as still open. */
    async queryQr(input: { partnerRef: string; providerRef: string }): Promise<{ state: QrState; detail: unknown }> {
      const { status, body } = await post(QUERY_PATH, {
        originalReferenceNo: input.providerRef,
        originalPartnerReferenceNo: input.partnerRef,
        serviceCode: '47',
        merchantId: config.merchantId,
      });
      if (status === 404) return { state: 'pending', detail: body };
      if (status !== 200) {
        throw new DokuError(`DOKU menolak pengecekan status: ${String(body.responseMessage ?? `HTTP ${status}`)}`, String(body.responseCode ?? status), body);
      }
      return { state: stateFromStatus(body.latestTransactionStatus), detail: body };
    },

    /**
     * Closes a QR at DOKU before its time is up, so that nobody can still pay it.
     * Throws when DOKU did not confirm; the QR must then be treated as still open.
     */
    async expireQr(input: { partnerRef: string; providerRef: string }): Promise<unknown> {
      const { status, body } = await post(EXPIRE_PATH, {
        partnerReferenceNo: input.partnerRef,
        referenceNo: input.providerRef,
        merchantId: config.merchantId,
        reason: 'Dibatalkan di booth',
      });
      if (status !== 200) {
        throw new DokuError(`DOKU menolak pembatalan QR: ${String(body.responseMessage ?? `HTTP ${status}`)}`, String(body.responseCode ?? status), body);
      }
      return body;
    },
  };
}
