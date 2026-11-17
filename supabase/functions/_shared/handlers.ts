/**
 * What the three payment functions do, kept apart from the Deno entry points so
 * that the whole flow can be run in tests against a stand-in for DOKU.
 */
import { createDoku, DokuError, verifyNotification, type DokuConfig } from './doku.ts';

export interface Env {
  supabaseUrl: string;
  /** Service role key: lets these functions call the payment_* database functions. */
  serviceKey: string;
  /** null while the DOKU keys have not been filled in. */
  doku: DokuConfig | null;
  /** How long a QR may be paid, in minutes. */
  qrMinutes: number;
  /** The path DOKU calls for notifications, as it appears in the notification URL given to DOKU. */
  notifyPath: string;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

/** Seconds a QR is still looked up after it ran out, for a payment that was already on its way. */
const GRACE_MS = 15_000;

/** Reads the functions' settings. `get` is Deno.env.get in production. */
export function readEnv(get: (name: string) => string | undefined): Env {
  const value = (name: string) => (get(name) ?? '').trim();
  const required = ['DOKU_CLIENT_ID', 'DOKU_SECRET_KEY', 'DOKU_PRIVATE_KEY', 'DOKU_MERCHANT_ID', 'DOKU_TERMINAL_ID', 'DOKU_POSTAL_CODE'];
  const complete = required.every((name) => value(name) !== '');
  const minutes = Number(value('DOKU_QR_MINUTES'));
  return {
    supabaseUrl: value('SUPABASE_URL').replace(/\/+$/, ''),
    serviceKey: value('SUPABASE_SERVICE_ROLE_KEY'),
    qrMinutes: Number.isFinite(minutes) && minutes >= 1 && minutes <= 60 ? minutes : 5,
    notifyPath: value('DOKU_NOTIFY_PATH') || '/functions/v1/doku-notify',
    doku: complete
      ? {
          baseUrl: (value('DOKU_BASE_URL') || 'https://api.doku.com').replace(/\/+$/, ''),
          clientId: value('DOKU_CLIENT_ID'),
          secretKey: value('DOKU_SECRET_KEY'),
          privateKeyPem: value('DOKU_PRIVATE_KEY'),
          merchantId: value('DOKU_MERCHANT_ID'),
          terminalId: value('DOKU_TERMINAL_ID'),
          postalCode: value('DOKU_POSTAL_CODE'),
          sendValidity: value('DOKU_SEND_VALIDITY').toLowerCase() !== 'off',
        }
      : null,
  };
}

async function rpc<T>(env: Env, fetchFn: Fetch, name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetchFn(`${env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`Database menjawab ${response.status} untuk ${name}: ${body}`);
  // A database function that returns nothing answers with an empty body, not with JSON.
  return (body.trim() === '' ? null : JSON.parse(body)) as T;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** qris-create: opens a charge for one price option and returns the QR to show. */
export async function handleCreate(input: Record<string, unknown>, env: Env, fetchFn: Fetch = fetch, now: () => Date = () => new Date()): Promise<Reply> {
  if (!env.doku) return { status: 200, body: { error: 'not-configured', message: 'Kunci DOKU belum diisi di Supabase.' } };
  const started = await rpc<{ error?: string; id?: string; amount?: number; partner_ref?: string }>(env, fetchFn, 'payment_begin', {
    p_token: text(input.token),
    p_package_id: text(input.package_id),
  });
  if (started.error || !started.id || !started.partner_ref || !started.amount) return { status: 200, body: { error: started.error ?? 'provider' } };

  const expiresAt = new Date(now().getTime() + env.qrMinutes * 60_000);
  try {
    const made = await createDoku(env.doku, fetchFn, now).generateQr({ partnerRef: started.partner_ref, amount: started.amount, expiresAt });
    await rpc(env, fetchFn, 'payment_attach', {
      p_id: started.id,
      p_provider_ref: made.providerRef,
      p_qr: made.qr,
      p_expires: expiresAt.toISOString(),
      p_detail: { generate: made.detail },
    });
    return { status: 200, body: { id: started.id, qr: made.qr, amount: started.amount, expires_at: expiresAt.toISOString() } };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Gagal membuat QR.';
    const code = cause instanceof DokuError ? cause.code : 'error';
    console.error('qris-create', code, message);
    await rpc(env, fetchFn, 'payment_settle', {
      p_id: started.id,
      p_status: 'failed',
      p_detail: { error: { code, message, detail: cause instanceof DokuError ? cause.detail : null } },
    }).catch(() => undefined);
    return { status: 200, body: { error: code === 'config' ? 'not-configured' : 'provider', message } };
  }
}

/** qris-status: tells the tablet whether its QR has been paid, asking DOKU while it is still open. */
export async function handleStatus(input: Record<string, unknown>, env: Env, fetchFn: Fetch = fetch, now: () => Date = () => new Date()): Promise<Reply> {
  const payment = await rpc<{ error?: string; id?: string; status?: string; partner_ref?: string; provider_ref?: string | null; expires_at?: string | null; created_at?: string }>(
    env,
    fetchFn,
    'payment_get',
    { p_token: text(input.token), p_id: text(input.id) },
  );
  if (payment.error || !payment.id) return { status: 200, body: { error: payment.error ?? 'not-found' } };
  if (payment.status !== 'pending') return { status: 200, body: { status: payment.status } };

  const settle = async (status: string, detail: unknown) =>
    rpc<string>(env, fetchFn, 'payment_settle', { p_id: payment.id, p_status: status, p_detail: { query: detail } });
  const ranOut = payment.expires_at ? now().getTime() > Date.parse(payment.expires_at) + GRACE_MS : now().getTime() > Date.parse(payment.created_at ?? '') + 60_000;

  // No QR was ever attached: creating it failed half-way.
  if (!payment.provider_ref || !env.doku) return { status: 200, body: { status: ranOut ? await settle('failed', null) : 'pending' } };

  try {
    const asked = await createDoku(env.doku, fetchFn, now).queryQr({ partnerRef: payment.partner_ref ?? '', providerRef: payment.provider_ref });
    if (asked.state === 'paid') return { status: 200, body: { status: await settle('paid', asked.detail) } };
    if (asked.state === 'failed') return { status: 200, body: { status: await settle('failed', asked.detail) } };
    return { status: 200, body: { status: ranOut ? await settle('expired', asked.detail) : 'pending' } };
  } catch (cause) {
    // DOKU could not be asked right now. The QR stays open; the tablet asks again in a moment.
    console.error('qris-status', cause instanceof Error ? cause.message : cause);
    return { status: 200, body: { status: 'pending', unsure: true } };
  }
}

/**
 * doku-notify: DOKU's own message that a QR was paid. A safety net for a
 * payment that arrives when no tablet is asking any more.
 */
export async function handleNotify(headers: Headers, rawBody: string, env: Env, fetchFn: Fetch = fetch): Promise<Reply> {
  if (!env.doku) return { status: 503, body: { error: 'not-configured' } };
  const genuine = await verifyNotification(
    env.doku.secretKey,
    {
      clientId: headers.get('Client-Id') ?? '',
      requestId: headers.get('Request-Id') ?? '',
      timestamp: headers.get('Request-Timestamp') ?? '',
      signature: headers.get('Signature') ?? '',
    },
    env.notifyPath,
    rawBody,
  );
  if (!genuine || headers.get('Client-Id') !== env.doku.clientId) return { status: 401, body: { error: 'bad-signature' } };

  let message: { order?: { invoice_number?: unknown; amount?: unknown }; transaction?: { status?: unknown } };
  try {
    message = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'bad-json' } };
  }
  if (message.transaction?.status === 'SUCCESS') {
    await rpc(env, fetchFn, 'payment_settle_by_ref', {
      p_partner_ref: text(message.order?.invoice_number),
      p_amount: Math.round(Number(message.order?.amount)),
      p_detail: { notification: message },
    });
  }
  return { status: 200, body: { ok: true } };
}
