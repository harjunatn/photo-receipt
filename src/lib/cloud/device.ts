import type { PayMethod } from '../log';
import { printer } from '../printer/manager';
import { settingsStore } from '../settings';
import { createPersistedStore, createStore } from '../store';
import { applyRemote, cloudConfigured, SUPABASE_KEY, SUPABASE_URL } from './shared';

/** What this tablet keeps after being paired with a device from the dashboard. */
export interface Pairing {
  token: string;
  id: string;
  name: string;
  code: string;
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

/** Pairs this tablet with a device created in the dashboard. Returns an error message, or '' on success. */
export async function pairDevice(code: string, pin: string): Promise<string> {
  if (!cloudConfigured) return 'Aplikasi ini belum disambungkan ke Supabase.';
  try {
    const result = await rpc<Partial<Pairing> & { error?: string }>('device_pair', { p_code: code, p_pin: pin });
    if (result.error || !result.token || !result.id) return PAIR_ERRORS[result.error ?? ''] ?? 'Gagal memasangkan perangkat.';
    pairingStore.set({ token: result.token, id: result.id, name: result.name ?? '', code: result.code ?? code });
    localStorage.removeItem(VERSION_KEY);
    syncState.set({ lastOk: Date.now(), error: '', revoked: false });
    void syncNow();
    return '';
  } catch {
    return 'Tidak bisa menghubungi server. Periksa internet tablet ini.';
  }
}

/** Forgets the pairing on this tablet. Transactions still queued stay queued for the next pairing. */
export function unpairDevice(): void {
  pairingStore.set(null);
  localStorage.removeItem(VERSION_KEY);
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

// Settings from the dashboard wait here while a guest is using the booth.
let pending: { outlet?: unknown; frames: unknown; version: string } | null = null;
let idle = true;
let running = false;

function applyPending(): void {
  if (!pending || !idle) return;
  const before = settingsStore.get();
  const after = applyRemote(before, pending.outlet, pending.frames);
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
  outlet_version?: string;
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
    if (result.name && result.name !== pairing.name) pairingStore.set({ ...pairing, name: result.name });
    pending = {
      // An unchanged outlet is not sent again; keep one that is still waiting to be applied.
      outlet: 'outlet' in result ? result.outlet : pending?.outlet,
      frames: result.frames,
      version: result.outlet_version ?? '',
    };
    applyPending();
    syncState.set({ lastOk: Date.now(), error: '', revoked: false });
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
  void syncNow();
  setInterval(() => void syncNow(), SYNC_EVERY_MS);
  window.addEventListener('online', () => void syncNow());
}

export type CloudVoucherResult = { status: 'ok'; code: string } | { status: 'not-found' | 'used' | 'expired' | 'offline' };

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
    if (result.status === 'used' || result.status === 'expired') return { status: result.status };
    return { status: 'not-found' };
  } catch {
    return { status: 'offline' };
  }
}
