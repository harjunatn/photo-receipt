import type { PayMethod } from '../log';
import type { StatRow } from '../../dashboard/stats';
import { printer } from '../printer/manager';
import { settingsStore } from '../settings';
import { createPersistedStore, createStore } from '../store';
import { applyDeviceSettings, applyRemote, cloudConfigured, deviceSettingsOf, SUPABASE_KEY, SUPABASE_URL, type Subscription } from './shared';

/** What this tablet keeps after being paired with a device from the dashboard. */
export interface Pairing {
  token: string;
  id: string;
  name: string;
  code: string;
  /** Name of the franchise the device belongs to, once the server has told it. */
  franchise?: string;
}

/** One finished session on its way to the server. */
export interface CloudTx {
  id: string;
  at: string;
  session_no: number;
  frame: string;
  package: string;
  price: number;
  method: PayMethod;
  voucher_code: string | null;
  prints: number;
  /** The automatic QRIS payment behind this session, so the dashboard can match money to sessions. */
  payment_id: string | null;
  /** The code of this session's digital copies, printed as a QR code on the receipt. */
  share_code: string | null;
}

export interface SyncState {
  /** When the server last answered. */
  lastOk: number | null;
  error: string;
  /** The dashboard unpaired or deactivated this tablet. */
  revoked: boolean;
}

export const pairingStore = createPersistedStore<Pairing | null>('booth.device.v1', null);
export const outboxStore = createPersistedStore<CloudTx[]>('booth.outbox.v1', []);
export const syncState = createStore<SyncState>({ lastOk: null, error: '', revoked: false });
/** QRs this tablet made that have no final status yet, with when they were made. */
const openQrStore = createPersistedStore<Record<string, number>>('booth.qris-open.v1', {});
/** The franchise's subscription as last heard from the server; the booth stops taking guests once it has run out. */
export const subscriptionStore = createPersistedStore<Subscription | null>('booth.subscription.v1', null);
/** Tells the frame store which version of the franchise's own frames the server has; it fetches them when this changes. */
export const framesVersionStore = createStore<string>('');
/** The tablet settings the server is known to hold for this device, and when they got there. */
export const settingsBackupStore = createPersistedStore<{ json: string; at: number } | null>('booth.device-settings.v1', null);

const MAX_QUEUED = 5000;
const BATCH = 100;
const SYNC_EVERY_MS = 60_000;
const VERSION_KEY = 'booth.outlet-version.v1';

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Server menjawab ${response.status}.`);
  return (await response.json()) as T;
}

const PAIR_ERRORS: Record<string, string> = {
  invalid: 'Kode perangkat atau PIN salah.',
  inactive: 'Perangkat ini dinonaktifkan di dashboard.',
  locked: 'Terlalu banyak PIN salah. Buat PIN baru untuk perangkat ini di dashboard.',
};

function deviceSettingsJson(): string {
  return JSON.stringify(deviceSettingsOf(settingsStore.get()));
}

export interface PairResult {
  /** Why pairing failed, in words for staff; '' on success. */
  error: string;
  /** The device already had settings from an earlier tablet, and this tablet now uses them. */
  restored: boolean;
}

/** Pairs this tablet with a device created in the dashboard. */
export async function pairDevice(code: string, pin: string): Promise<PairResult> {
  if (!cloudConfigured) return { error: 'Aplikasi ini belum disambungkan ke Supabase.', restored: false };
  try {
    const result = await rpc<Partial<Pairing> & { error?: string; settings?: unknown }>('device_pair', { p_code: code, p_pin: pin });
    if (result.error || !result.token || !result.id) {
      return { error: PAIR_ERRORS[result.error ?? ''] ?? 'Gagal memasangkan perangkat.', restored: false };
    }
    pairingStore.set({ token: result.token, id: result.id, name: result.name ?? '', code: result.code ?? code });
    localStorage.removeItem(VERSION_KEY);
    // A replacement tablet takes over the printer, session and PIN settings of the one before it.
    const restored = typeof result.settings === 'object' && result.settings !== null && !Array.isArray(result.settings);
    if (restored) settingsStore.replace(applyDeviceSettings(settingsStore.get(), result.settings));
    // A device without saved settings gets this tablet's on the next sync.
    settingsBackupStore.set(restored ? { json: deviceSettingsJson(), at: Date.now() } : null);
    syncState.set({ lastOk: Date.now(), error: '', revoked: false });
    void syncNow();
    return { error: '', restored };
  } catch {
    return { error: 'Tidak bisa menghubungi server. Periksa internet tablet ini.', restored: false };
  }
}

/** Forgets the pairing on this tablet. Transactions still queued stay queued for the next pairing. */
export function unpairDevice(): void {
  pairingStore.set(null);
  settingsBackupStore.set(null);
  subscriptionStore.set(null);
  localStorage.removeItem(VERSION_KEY);
}

/** Sends this tablet's own settings to its device in the dashboard, when they changed since the last time. */
async function backUpSettings(token: string): Promise<void> {
  const json = deviceSettingsJson();
  if (settingsBackupStore.get()?.json === json) return;
  try {
    const result = await rpc<{ ok?: boolean; error?: string }>('device_save_settings', { p_token: token, p_settings: JSON.parse(json) });
    if (result.ok) settingsBackupStore.set({ json, at: Date.now() });
  } catch {
    // Tried again on the next sync; the booth works the same without the copy.
  }
}

function revoked(): void {
  unpairDevice();
  syncState.set({ ...syncState.get(), error: '', revoked: true });
}

/**
 * Records a finished session for the dashboard. It is sent now if possible,
 * later if not — also after the tablet is paired again, should the dashboard
 * have unpaired it while a guest was still in the booth.
 */
export function queueTransaction(tx: CloudTx): void {
  outboxStore.set([...outboxStore.get(), tx].slice(-MAX_QUEUED));
  void syncNow();
}

let sweepOnStart = false;

/** Forgets QRs that have a final status, and ones too old to matter. */
function closeQr(id: string): void {
  const open = { ...openQrStore.get() };
  delete open[id];
  openQrStore.set(open);
}

/**
 * Settles QRs left behind without a final status, e.g. when the guest walked
 * away or the tablet lost its connection while waiting. A QR paid after all is
 * recorded as paid; an unpaid one is closed, also at DOKU.
 */
async function sweepQris(token: string): Promise<void> {
  const open = openQrStore.get();
  const dayAgo = Date.now() - 86_400_000;
  for (const [id, made] of Object.entries(open)) if (made < dayAgo) closeQr(id);
  if (!sweepOnStart && Object.keys(openQrStore.get()).length === 0) return;
  try {
    const result = await callFunction<{ results?: { id: string; status: string }[]; open?: number; error?: string }>('qris-sweep', { token });
    if (result.error) return;
    sweepOnStart = false;
    for (const row of result.results ?? []) if (row.status !== 'pending') closeQr(row.id);
    // The server only hands back QRs whose time is up; any others still on the list are settled through their own screen.
    if (!result.open) for (const id of Object.keys(openQrStore.get())) if (openQrStore.get()[id] < Date.now() - 10 * 60_000) closeQr(id);
  } catch {
    // Tried again on the next sync.
  }
}

// Settings from the dashboard wait here while a guest is using the booth.
let pending: { outlet?: unknown; platform?: unknown; frames: unknown; version: string } | null = null;
let idle = true;
let running = false;

function applyPending(): void {
  if (!pending || !idle) return;
  const before = settingsStore.get();
  const after = applyRemote(before, pending.outlet, pending.frames, pending.platform);
  if (JSON.stringify(after) !== JSON.stringify(before)) settingsStore.replace(after);
  localStorage.setItem(VERSION_KEY, pending.version);
  pending = null;
}

/** Tells the sync whether the booth is on its welcome screen, the only time settings may change under it. */
export function setBoothIdle(next: boolean): void {
  idle = next;
  applyPending();
}

/** Makes the next sync fetch the dashboard's settings again, e.g. after they were edited on the tablet. */
export function refetchSettings(): void {
  localStorage.removeItem(VERSION_KEY);
  void syncNow();
}

interface SyncResult {
  error?: string;
  name?: string;
  frames?: unknown;
  outlet?: unknown;
  /** Sent together with the outlet, when either changed. */
  platform?: unknown;
  outlet_version?: string;
  franchise?: { id?: string; name?: string };
  subscription?: { active?: unknown; paid_until?: unknown; grace_days?: unknown };
  frames_version?: string;
}

/** Sends queued transactions, reports this tablet's state and picks up settings. */
export async function syncNow(): Promise<boolean> {
  const pairing = pairingStore.get();
  if (!cloudConfigured || !pairing || running) return false;
  running = true;
  try {
    for (;;) {
      const batch = outboxStore.get().slice(0, BATCH);
      if (batch.length === 0) break;
      const pushed = await rpc<{ ok?: boolean; error?: string }>('device_push', { p_token: pairing.token, p_rows: batch });
      if (pushed.error === 'unpaired') {
        revoked();
        return false;
      }
      if (!pushed.ok) throw new Error('Server menolak kiriman transaksi.');
      // Sessions may have finished while the batch was on its way; only the sent ones leave the queue.
      const sent = new Set(batch.map((tx) => tx.id));
      outboxStore.set(outboxStore.get().filter((tx) => !sent.has(tx.id)));
    }

    const state = printer.state.get();
    const result = await rpc<SyncResult>('device_sync', {
      p_token: pairing.token,
      p_status: { printer: state.status, transport: state.kind, queued: outboxStore.get().length },
      p_known: localStorage.getItem(VERSION_KEY),
    });
    if (result.error === 'unpaired') {
      revoked();
      return false;
    }
    const franchise = result.franchise?.name ?? pairing.franchise;
    if ((result.name && result.name !== pairing.name) || franchise !== pairing.franchise) {
      pairingStore.set({ ...pairing, name: result.name || pairing.name, franchise });
    }
    if (result.subscription) {
      const next: Subscription = {
        active: result.subscription.active !== false,
        paidUntil: typeof result.subscription.paid_until === 'string' ? result.subscription.paid_until : null,
        graceDays: typeof result.subscription.grace_days === 'number' ? result.subscription.grace_days : 7,
      };
      if (JSON.stringify(next) !== JSON.stringify(subscriptionStore.get())) subscriptionStore.set(next);
    }
    if (typeof result.frames_version === 'string' && result.frames_version !== framesVersionStore.get()) framesVersionStore.set(result.frames_version);
    pending = {
      // An unchanged outlet is not sent again; keep one that is still waiting to be applied.
      outlet: 'outlet' in result ? result.outlet : pending?.outlet,
      platform: 'platform' in result ? result.platform : pending?.platform,
      frames: result.frames,
      version: result.outlet_version ?? '',
    };
    applyPending();
    syncState.set({ lastOk: Date.now(), error: '', revoked: false });
    await backUpSettings(pairing.token);
    await sweepQris(pairing.token);
    // Loaded on demand: the upload queue is only needed once a session has files to send.
    void import('./upload').then(({ pumpUploads }) => pumpUploads());
    return true;
  } catch (cause) {
    const offline = cause instanceof TypeError || (cause instanceof DOMException && cause.name === 'TimeoutError');
    syncState.set({
      ...syncState.get(),
      error: offline ? 'Tidak ada sambungan ke server.' : cause instanceof Error ? cause.message : 'Sinkronisasi gagal.',
    });
    return false;
  } finally {
    running = false;
  }
}

/** Keeps this tablet in step with the dashboard for as long as the page is open. */
export function startCloudSync(): void {
  if (!cloudConfigured) return;
  // Once per start, also QRs left open by an earlier run of the booth.
  sweepOnStart = true;
  void syncNow();
  setInterval(() => void syncNow(), SYNC_EVERY_MS);
  window.addEventListener('online', () => void syncNow());
  // Staff changing the printer, camera or PIN reaches the dashboard within seconds, not at the next minute.
  let soon: ReturnType<typeof setTimeout> | undefined;
  settingsStore.subscribe(() => {
    if (!pairingStore.get() || settingsBackupStore.get()?.json === deviceSettingsJson()) return;
    clearTimeout(soon);
    soon = setTimeout(() => void syncNow(), 3000);
  });
}

export type CloudVoucherResult = { status: 'ok'; code: string } | { status: 'not-found' | 'used' | 'expired' | 'offline' | 'subscription' };

/** Uses up a voucher on the server, so that no other tablet can accept the same code. */
export async function redeemCloudVoucher(input: string): Promise<CloudVoucherResult> {
  const pairing = pairingStore.get();
  if (!pairing) return { status: 'offline' };
  try {
    const result = await rpc<{ status: string; code?: string }>('device_redeem_voucher', { p_token: pairing.token, p_code: input });
    if (result.status === 'ok') return { status: 'ok', code: result.code ?? input };
    if (result.status === 'unpaired') {
      revoked();
      return { status: 'offline' };
    }
    if (result.status === 'used' || result.status === 'expired' || result.status === 'subscription') return { status: result.status };
    return { status: 'not-found' };
  } catch {
    return { status: 'offline' };
  }
}

/** One of the franchise's own frames as the server sends it. */
export interface RemoteFrame {
  id: string;
  name: string;
  blurb: string;
  layout: unknown;
  image: string;
  updated_at: string;
}

/**
 * The franchise's own frames: the ids that exist now, and in full those that are new or changed
 * compared with `known` (id → updated_at). null when the tablet is not paired or the server cannot be reached.
 */
export async function fetchCustomFrames(known: Record<string, string>): Promise<{ ids: string[]; frames: RemoteFrame[] } | null> {
  const pairing = pairingStore.get();
  if (!cloudConfigured || !pairing) return null;
  try {
    const result = await rpc<{ error?: string; ids?: string[]; frames?: RemoteFrame[] }>('device_frames', { p_token: pairing.token, p_known: known });
    if (result.error || !Array.isArray(result.ids)) return null;
    return { ids: result.ids, frames: result.frames ?? [] };
  } catch {
    return null;
  }
}

/** Calls one of the project's Edge Functions, which hold the payment provider's secret keys. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  // The functions answer every outcome they know about as JSON, also with an error status.
  const result = (await response.json().catch(() => null)) as T | null;
  if (result === null) throw new Error(`Server menjawab ${response.status}.`);
  return result;
}

export type QrisError = 'offline' | 'unpaired' | 'disabled' | 'no-package' | 'too-many' | 'not-configured' | 'provider' | 'not-found';

export interface QrisCharge {
  id: string;
  /** The text to show as a QR code. */
  qr: string;
  amount: number;
  /** When the QR stops accepting payment (milliseconds since 1970). */
  expiresAt: number;
}

/** Asks the server for a QR that pays for one session of the given price option. */
export async function createQris(packageId: string): Promise<QrisCharge | { error: QrisError; message?: string }> {
  const pairing = pairingStore.get();
  if (!pairing) return { error: 'unpaired' };
  try {
    const result = await callFunction<{ id?: string; qr?: string; amount?: number; expires_at?: string; error?: QrisError; message?: string }>(
      'qris-create',
      { token: pairing.token, package_id: packageId },
    );
    if (result.error === 'unpaired') revoked();
    if (result.error || !result.id || !result.qr) return { error: result.error ?? 'provider', message: result.message };
    openQrStore.set({ ...openQrStore.get(), [result.id]: Date.now() });
    return { id: result.id, qr: result.qr, amount: result.amount ?? 0, expiresAt: Date.parse(result.expires_at ?? '') || Date.now() + 5 * 60_000 };
  } catch {
    return { error: 'offline' };
  }
}

export type QrisStatus = 'pending' | 'paid' | 'expired' | 'failed' | 'offline';

/** Whether a QR made by createQris has been paid. 'offline' means the answer is not known right now. */
export async function checkQris(id: string): Promise<QrisStatus> {
  const pairing = pairingStore.get();
  if (!pairing) return 'offline';
  try {
    const result = await callFunction<{ status?: QrisStatus; error?: string }>('qris-status', { token: pairing.token, id });
    return finalOrOpen(id, result);
  } catch {
    return 'offline';
  }
}

function finalOrOpen(id: string, result: { status?: QrisStatus; error?: string }): QrisStatus {
  if (result.status === 'paid' || result.status === 'expired' || result.status === 'failed') {
    closeQr(id);
    return result.status;
  }
  if (result.status === 'pending') return 'pending';
  return result.error === 'not-found' ? 'failed' : 'offline';
}

/**
 * The guest left the QR screen: closes the QR, also at DOKU, so it can no longer
 * be paid. Answers 'paid' when the money turned out to have arrived already.
 */
export async function cancelQris(id: string): Promise<QrisStatus> {
  const pairing = pairingStore.get();
  if (!pairing) return 'offline';
  try {
    const result = await callFunction<{ status?: QrisStatus; error?: string }>('qris-cancel', { token: pairing.token, id });
    return finalOrOpen(id, result);
  } catch {
    // Left on the open list; the background sync settles it later.
    return 'offline';
  }
}

/** One finished session as the server has it. */
export interface BoothTx {
  id: string;
  at: string;
  session_no: number | null;
  frame: string | null;
  package: string | null;
  price: number;
  method: PayMethod;
  voucher_code: string | null;
  prints: number;
  share_code: string | null;
}

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';

/** This tablet's sales per day and way of paying, from the server. Throws when it cannot be reached. */
export async function fetchBoothStats(from: Date, to: Date): Promise<StatRow[]> {
  const pairing = pairingStore.get();
  if (!pairing) throw new Error('Tablet ini belum tersambung ke dashboard.');
  const result = await rpc<{ rows?: StatRow[]; error?: string }>('device_stats', {
    p_token: pairing.token,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_tz: zone(),
  });
  if (result.error === 'unpaired') revoked();
  if (result.error || !result.rows) throw new Error('Tablet ini tidak lagi tersambung ke dashboard.');
  return result.rows;
}

/** One page of this tablet's sessions, newest first, from the server. */
export async function fetchBoothTransactions(
  from: Date,
  to: Date,
  method: PayMethod | '',
  offset: number,
  limit: number,
): Promise<{ rows: BoothTx[]; total: number }> {
  const pairing = pairingStore.get();
  if (!pairing) throw new Error('Tablet ini belum tersambung ke dashboard.');
  const result = await rpc<{ rows?: BoothTx[]; total?: number; error?: string }>('device_transactions', {
    p_token: pairing.token,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_method: method || null,
    p_offset: offset,
    p_limit: limit,
  });
  if (result.error === 'unpaired') revoked();
  if (result.error || !result.rows) throw new Error('Tablet ini tidak lagi tersambung ke dashboard.');
  return { rows: result.rows, total: result.total ?? 0 };
}
