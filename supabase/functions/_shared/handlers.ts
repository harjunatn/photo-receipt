/**
 * What the payment functions do, kept apart from the Deno entry points so
 * that the whole flow can be run in tests against a stand-in for DOKU.
 *
 * Every franchise is paid into its own DOKU account: the keys are looked up per
 * franchise, from what its admin saved on the payment setup page.
 */
import { createDoku, DokuError, verifyNotification, type DokuConfig } from './doku.ts';
import { open } from './secrets.ts';

export interface Env {
  supabaseUrl: string;
  /** Service role key: lets these functions call the payment_* database functions. */
  serviceKey: string;
  /** DOKU keys kept in the functions' own secrets, from before franchises had a setup page. null when not filled in. */
  doku: DokuConfig | null;
  /** The one franchise that uses those keys for as long as it has saved none of its own. */
  dokuEnvFranchise: string;
  /** Master key that seals the franchises' saved keys. '' while it has not been set. */
  secretsKey: string;
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
    dokuEnvFranchise: value('DOKU_ENV_FRANCHISE'),
    secretsKey: value('SECRETS_KEY'),
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

/** Calls a database function with the service role key. */
export async function rpc<T>(env: Pick<Env, 'supabaseUrl' | 'serviceKey'>, fetchFn: Fetch, name: string, args: Record<string, unknown>): Promise<T> {
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

export const DOKU_PRODUCTION = 'https://api.doku.com';
export const DOKU_SANDBOX = 'https://api-sandbox.doku.com';

/** What a franchise saved, as the database holds it. */
export interface SavedDoku {
  doku?: { clientId?: unknown; merchantId?: unknown; terminalId?: unknown; postalCode?: unknown; sandbox?: unknown; sendValidity?: unknown; publicKeyPem?: unknown };
  sealed?: string | null;
  updated_at?: string;
}

export type DokuSource = 'saved' | 'server' | 'none' | 'unreadable';

/**
 * The keys of one franchise's own DOKU account, and where they came from. A titip saldo charge
 * does not use these: it goes through the platform's account, see dokuFor.
 */
export async function resolveDoku(env: Env, fetchFn: Fetch, franchiseId: string): Promise<{ config: DokuConfig | null; source: DokuSource; saved: SavedDoku }> {
  const saved = (await rpc<SavedDoku | null>(env, fetchFn, 'svc_doku_get', { p_franchise: franchiseId })) ?? {};
  if (saved.sealed && saved.doku) {
    const opened = env.secretsKey ? await open(saved.sealed, env.secretsKey, franchiseId) : null;
    let secrets: { secretKey?: unknown; privateKeyPem?: unknown } = {};
    try {
      secrets = opened ? JSON.parse(opened) : {};
    } catch {
      secrets = {};
    }
    const config: DokuConfig = {
      baseUrl: saved.doku.sandbox === true ? DOKU_SANDBOX : DOKU_PRODUCTION,
      clientId: text(saved.doku.clientId),
      secretKey: text(secrets.secretKey),
      privateKeyPem: text(secrets.privateKeyPem),
      merchantId: text(saved.doku.merchantId),
      terminalId: text(saved.doku.terminalId),
      postalCode: text(saved.doku.postalCode),
      sendValidity: saved.doku.sendValidity !== false,
    };
    const complete = [config.clientId, config.secretKey, config.privateKeyPem, config.merchantId, config.terminalId, config.postalCode].every((part) => part !== '');
    // Saved keys that cannot be opened (another master key) are not silently replaced by the server's.
    return complete ? { config, source: 'saved', saved } : { config: null, source: 'unreadable', saved };
  }
  if (env.doku && env.dokuEnvFranchise !== '' && env.dokuEnvFranchise === franchiseId) return { config: env.doku, source: 'server', saved };
  return { config: null, source: 'none', saved };
}

// Looked up once a minute per franchise while a function instance stays warm, not on every poll of a waiting QR.
const dokuCache = new Map<string, { config: DokuConfig | null; until: number }>();
const DOKU_CACHE_MS = 60_000;

/** Makes the next payment call read a franchise's keys afresh, e.g. right after they were saved. */
export function forgetDoku(env: Pick<Env, 'supabaseUrl'>, franchiseId: string): void {
  dokuCache.delete(`${env.supabaseUrl}|${franchiseId}`);
}

/**
 * The DOKU account of one charge. A titip saldo charge (`wallet`) was made on the platform's account, the
 * one whose keys sit in these functions' own secrets, and stays there until it is settled, also when the
 * franchise has switched to its own account in the meantime. Every other charge uses the franchise's keys.
 */
async function dokuFor(env: Env, fetchFn: Fetch, franchiseId: string, wallet: boolean, now: () => Date): Promise<DokuConfig | null> {
  if (wallet) return env.doku;
  if (!franchiseId) return null;
  const key = `${env.supabaseUrl}|${franchiseId}`;
  const cached = dokuCache.get(key);
  if (cached && cached.until > now().getTime()) return cached.config;
  const { config } = await resolveDoku(env, fetchFn, franchiseId);
  dokuCache.set(key, { config, until: now().getTime() + DOKU_CACHE_MS });
  return config;
}

/** qris-create: opens a charge for one price option and returns the QR to show. */
export async function handleCreate(input: Record<string, unknown>, env: Env, fetchFn: Fetch = fetch, now: () => Date = () => new Date()): Promise<Reply> {
  const started = await rpc<{ error?: string; id?: string; amount?: number; partner_ref?: string; franchise_id?: string; wallet?: boolean }>(env, fetchFn, 'payment_begin', {
    p_token: text(input.token),
    p_package_id: text(input.package_id),
  });
  if (started.error || !started.id || !started.partner_ref || !started.amount) return { status: 200, body: { error: started.error ?? 'provider' } };

  const wallet = started.wallet === true;
  const doku = await dokuFor(env, fetchFn, text(started.franchise_id), wallet, now);
  if (!doku) {
    const message = wallet
      ? 'Akun DOKU platform belum siap untuk titip saldo. Hubungi pemilik platform.'
      : 'Kunci DOKU belum diisi. Isi di dashboard → Pengaturan → Cara bayar.';
    await rpc(env, fetchFn, 'payment_settle', { p_id: started.id, p_status: 'failed', p_detail: { error: { code: 'config', message } } }).catch(() => undefined);
    return { status: 200, body: { error: 'not-configured', message } };
  }

  const expiresAt = new Date(now().getTime() + env.qrMinutes * 60_000);
  try {
    const made = await createDoku(doku, fetchFn, now).generateQr({ partnerRef: started.partner_ref, amount: started.amount, expiresAt });
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

interface PendingPayment {
  id: string;
  franchise_id?: string;
  status?: string;
  partner_ref?: string;
  provider_ref?: string | null;
  expires_at?: string | null;
  created_at?: string;
  /** Made on the platform's DOKU account (titip saldo) rather than the franchise's own. */
  wallet?: boolean;
}

/**
 * Settles a charge that is still open, as far as DOKU's answer allows. With `cancel`, an unpaid QR
 * is closed at DOKU at once; without it, only one whose time is up. Returns the charge's status.
 */
async function resolvePending(payment: PendingPayment, env: Env, fetchFn: Fetch, now: () => Date, cancel: boolean): Promise<{ status: string; unsure?: boolean }> {
  const settle = async (status: string, detail: unknown) =>
    rpc<string>(env, fetchFn, 'payment_settle', { p_id: payment.id, p_status: status, p_detail: detail });
  const ranOut = payment.expires_at ? now().getTime() > Date.parse(payment.expires_at) + GRACE_MS : now().getTime() > Date.parse(payment.created_at ?? '') + 60_000;

  // No QR was ever attached: creating it failed half-way, so there is nothing anyone could pay.
  const config = payment.provider_ref ? await dokuFor(env, fetchFn, text(payment.franchise_id), payment.wallet === true, now) : null;
  if (!payment.provider_ref || !config) {
    return { status: ranOut || cancel ? await settle('failed', { reason: 'no-qr' }) : 'pending' };
  }

  const doku = createDoku(config, fetchFn, now);
  const refs = { partnerRef: payment.partner_ref ?? '', providerRef: payment.provider_ref };
  let asked: { state: string; detail: unknown };
  try {
    asked = await doku.queryQr(refs);
  } catch (cause) {
    // DOKU could not be asked right now. The QR stays open; it is asked about again later.
    console.error('query', cause instanceof Error ? cause.message : cause);
    return { status: 'pending', unsure: true };
  }
  if (asked.state === 'paid') return { status: await settle('paid', { query: asked.detail }) };
  if (asked.state === 'failed') return { status: await settle('failed', { query: asked.detail }) };
  if (!ranOut && !cancel) return { status: 'pending' };

  // Unpaid and no longer wanted: close it at DOKU too, so it cannot be paid and does not linger there as pending.
  try {
    const closed = await doku.expireQr(refs);
    return { status: await settle('expired', { query: asked.detail, expire: closed }) };
  } catch (cause) {
    console.error('expire', cause instanceof Error ? cause.message : cause);
    // A QR whose time is up cannot be paid any more anyway. One cancelled early stays open, to be checked again later.
    if (ranOut) return { status: await settle('expired', { query: asked.detail, expireError: cause instanceof Error ? cause.message : String(cause) }) };
    return { status: 'pending', unsure: true };
  }
}

async function ownPayment(input: Record<string, unknown>, env: Env, fetchFn: Fetch): Promise<PendingPayment & { error?: string }> {
  return rpc(env, fetchFn, 'payment_get', { p_token: text(input.token), p_id: text(input.id) });
}

/** qris-status: tells the tablet whether its QR has been paid, asking DOKU while it is still open. */
export async function handleStatus(input: Record<string, unknown>, env: Env, fetchFn: Fetch = fetch, now: () => Date = () => new Date()): Promise<Reply> {
  const payment = await ownPayment(input, env, fetchFn);
  if (payment.error || !payment.id) return { status: 200, body: { error: payment.error ?? 'not-found' } };
  if (payment.status !== 'pending') return { status: 200, body: { status: payment.status } };
  return { status: 200, body: await resolvePending(payment, env, fetchFn, now, false) };
}

/**
 * qris-cancel: the guest left the QR screen. A QR that turns out to be paid
 * after all is reported as paid, so that the tablet starts the session instead.
 */
export async function handleCancel(input: Record<string, unknown>, env: Env, fetchFn: Fetch = fetch, now: () => Date = () => new Date()): Promise<Reply> {
  const payment = await ownPayment(input, env, fetchFn);
  if (payment.error || !payment.id) return { status: 200, body: { error: payment.error ?? 'not-found' } };
  if (payment.status !== 'pending') return { status: 200, body: { status: payment.status } };
  return { status: 200, body: await resolvePending(payment, env, fetchFn, now, true) };
}

/** qris-sweep: settles this tablet's QRs that were left behind unresolved, a few at a time. */
export async function handleSweep(input: Record<string, unknown>, env: Env, fetchFn: Fetch = fetch, now: () => Date = () => new Date()): Promise<Reply> {
  const stale = await rpc<{ error?: string; franchise_id?: string; payments?: PendingPayment[] }>(env, fetchFn, 'payment_stale', { p_token: text(input.token) });
  if (stale.error) return { status: 200, body: { error: stale.error } };
  const results: { id: string; status: string }[] = [];
  for (const payment of stale.payments ?? []) {
    results.push({ id: payment.id, status: (await resolvePending({ ...payment, franchise_id: stale.franchise_id }, env, fetchFn, now, false)).status });
  }
  const open = results.filter((r) => r.status === 'pending').length;
  return { status: 200, body: { checked: results.length, open, results } };
}

/**
 * doku-notify: DOKU's own message that a QR was paid. A safety net for a
 * payment that arrives when no tablet is asking any more.
 */
export async function handleNotify(headers: Headers, rawBody: string, env: Env, fetchFn: Fetch = fetch, now: () => Date = () => new Date()): Promise<Reply> {
  let message: { order?: { invoice_number?: unknown; amount?: unknown }; transaction?: { status?: unknown } };
  try {
    message = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'bad-json' } };
  }
  // The charge named in the message tells whose keys must have signed it: the platform's for a
  // titip saldo charge, the franchise's own for every other.
  const reference = text(message.order?.invoice_number);
  const account = reference ? await rpc<{ franchise_id?: string; wallet?: boolean } | null>(env, fetchFn, 'payment_account', { p_partner_ref: reference }) : null;
  // Not one of our charges (the merchant may use the same DOKU account elsewhere): nothing to do, nothing revealed.
  if (!account?.franchise_id) return { status: 200, body: { ok: true, ignored: true } };

  const doku = await dokuFor(env, fetchFn, account.franchise_id, account.wallet === true, now);
  if (!doku) return { status: 503, body: { error: 'not-configured' } };
  const genuine = await verifyNotification(
    doku.secretKey,
    {
      clientId: headers.get('Client-Id') ?? '',
      requestId: headers.get('Request-Id') ?? '',
      timestamp: headers.get('Request-Timestamp') ?? '',
      signature: headers.get('Signature') ?? '',
    },
    env.notifyPath,
    rawBody,
  );
  if (!genuine || headers.get('Client-Id') !== doku.clientId) return { status: 401, body: { error: 'bad-signature' } };

  if (message.transaction?.status === 'SUCCESS') {
    await rpc(env, fetchFn, 'payment_settle_by_ref', {
      p_partner_ref: reference,
      p_amount: Math.round(Number(message.order?.amount)),
      p_detail: { notification: message },
    });
  }
  return { status: 200, body: { ok: true } };
}
