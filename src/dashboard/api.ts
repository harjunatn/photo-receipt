import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { completePlatform, SUPABASE_KEY, SUPABASE_URL, type OutletConfig, type PlatformConfig, type SubscriptionState } from '../lib/cloud/shared';
import type { FrameLayout } from '../lib/receipt/custom';
import type { PayMethod } from '../lib/log';
import type { VoucherStatus } from '../lib/vouchers';
import type { StatRow } from './stats';

export interface Device {
  id: string;
  name: string;
  code: string;
  pin: string;
  pin_fails: number;
  /** Frame ids offered on this tablet, or null when the tablet decides for itself. */
  frames: string[] | null;
  active: boolean;
  status: { printer?: string; transport?: string; queued?: number };
  paired: boolean;
  paired_at: string | null;
  last_seen_at: string | null;
  /** When the tablet last saved its own settings (printer, session, PIN) here; null if it never has. */
  settings_at: string | null;
  created_at: string;
}

export interface Tx {
  id: string;
  device_id: string | null;
  device_name: string;
  at: string;
  session_no: number | null;
  frame: string | null;
  package: string | null;
  price: number;
  method: PayMethod;
  voucher_code: string | null;
  prints: number;
  /** Code of the guest's digital copies, when they were made. */
  share_code: string | null;
  /** false: cash or static QRIS accepted without the staff PIN, because the franchise switched confirmation off. */
  staff_confirmed: boolean;
  /** What the payment provider last said about the automatic QRIS payment behind this session; null when there is none. */
  payment_status: PaymentStatus | null;
}

/** What the guest's download page holds for one session, as the dashboard shows it. */
export interface ShareState {
  status: 'ready' | 'pending' | 'expired';
  /** A small picture of the photo, while it is still stored. */
  thumb?: string;
  /** The full photo, while it is still stored. */
  photo?: string;
}

export interface VoucherRow {
  code: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  used_by_name: string | null;
}

export type PaymentStatus = 'pending' | 'paid' | 'expired' | 'failed';

/** One automatic QRIS charge, whether or not it was paid. */
export interface PaymentRow {
  id: string;
  device_name: string;
  package_name: string | null;
  amount: number;
  status: PaymentStatus;
  partner_ref: string;
  provider_ref: string | null;
  created_at: string;
  paid_at: string | null;
  /** Whether a finished session was recorded for this payment. */
  has_session: boolean;
}

export interface TxFilter {
  from: Date;
  /** Exclusive. */
  to: Date;
  method: PayMethod | '';
  deviceId: string;
}

/** A voucher being redeemed, as the page that lists them hears of it. */
export interface VoucherUse {
  code: string;
  used_at: string;
  used_by_name: string | null;
}

export interface VoucherFilter {
  status: VoucherStatus | 'all';
  search: string;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

export type DevicePatch = Partial<Pick<Device, 'name' | 'active' | 'frames' | 'pin'>> & { unpair?: boolean };

export interface Franchise {
  id: string;
  name: string;
}

export type { SubscriptionState };

export interface FranchiseStatus extends Franchise {
  active: boolean;
  /** Last day the subscription covers (YYYY-MM-DD), or null for no end. */
  paid_until: string | null;
  grace_days: number;
  state: SubscriptionState;
  /** Today's date as the server counts it. */
  today: string;
}

/** One franchise as the platform owner sees it. */
export interface FranchiseRow extends Franchise {
  active: boolean;
  paid_until: string | null;
  note: string | null;
  state: SubscriptionState;
  created_at: string;
  devices: number;
  devices_online: number;
  last_seen_at: string | null;
  members: number;
  sessions_30d: number;
  revenue_30d: number;
}

export interface MemberRow {
  user_id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  must_change_password: boolean;
}

/** What the payment setup page shows of a franchise's DOKU keys: never the secret parts. */
export interface DokuState {
  /** false while the platform owner has not set the master key that seals saved keys. */
  can_save: boolean;
  /** saved: this franchise's own keys · server: keys kept in the server's settings · none · unreadable: saved but cannot be opened. */
  source: 'saved' | 'server' | 'none' | 'unreadable';
  doku: { clientId: string; merchantId: string; terminalId: string; postalCode: string; sandbox: boolean; publicKeyPem: string };
  has_keys: boolean;
  /** The address to enter at DOKU as Notification URL. */
  notify_url: string;
  updated_at: string | null;
}

export interface DokuFields {
  client_id: string;
  merchant_id: string;
  terminal_id: string;
  postal_code: string;
  sandbox: boolean;
  /** Empty keeps the one already saved. */
  secret_key: string;
  private_key_pem: string;
  public_key_pem: string;
}

/** A franchise's own frame design. `image` is left out of lists; it is large. */
export interface CustomFrameRow {
  id: string;
  name: string;
  blurb: string;
  layout: FrameLayout;
  thumb: string;
  active: boolean;
  updated_at: string;
}

export interface CustomFrameInput {
  /** null creates a new frame. */
  id: string | null;
  name: string;
  blurb: string;
  layout: FrameLayout;
  /** Left out when the picture itself did not change. */
  image?: string;
  thumb?: string;
  active: boolean;
}

/** Who is signed in, and what they may open. */
export interface Account {
  email: string;
  superadmin: boolean;
  /** The franchise this account administers; null for the platform owner. */
  franchise: Franchise | null;
  mustChangePassword: boolean;
}

/**
 * Everything the dashboard asks of its data source for ONE franchise, so that a
 * sample data set can stand in for Supabase.
 */
export interface OwnerApi {
  demo: boolean;
  email: string;
  /** The platform owner, looking at this franchise. */
  superadmin: boolean;
  franchise: Franchise;
  signOut(): Promise<void>;
  changePassword(password: string): Promise<void>;
  status(): Promise<FranchiseStatus>;
  getPlatform(): Promise<PlatformConfig>;
  dokuGet(): Promise<DokuState>;
  dokuSave(fields: DokuFields): Promise<void>;
  dokuTest(): Promise<{ ok: boolean; sure?: boolean; message: string }>;
  dokuClear(): Promise<void>;
  listFrames(): Promise<CustomFrameRow[]>;
  /** The full-size picture of one frame, for editing it. */
  frameImage(id: string): Promise<string>;
  saveFrame(frame: CustomFrameInput): Promise<void>;
  deleteFrame(id: string): Promise<void>;
  listDevices(): Promise<Device[]>;
  createDevice(name: string): Promise<void>;
  updateDevice(id: string, patch: DevicePatch): Promise<void>;
  deleteDevice(id: string): Promise<void>;
  dailyStats(from: Date, to: Date): Promise<StatRow[]>;
  listTransactions(filter: TxFilter, offset: number, limit: number): Promise<Page<Tx>>;
  /** The download state of several sessions at once, keyed by share code. */
  shareStates(codes: string[]): Promise<Record<string, ShareState>>;
  listPayments(status: PaymentStatus | 'all' | 'orphan', offset: number, limit: number): Promise<Page<PaymentRow>>;
  voucherCounts(): Promise<Record<VoucherStatus, number>>;
  listVouchers(filter: VoucherFilter, offset: number, limit: number): Promise<Page<VoucherRow>>;
  createVouchers(rows: { code: string; label: string | null; expires_at: string | null }[]): Promise<void>;
  deleteVoucher(code: string): Promise<void>;
  /**
   * Vouchers used after `after` (a time the server gave earlier), newest first. With null, only
   * the most recent use, if any, as the point to watch from.
   */
  recentVoucherUses(after: string | null): Promise<VoucherUse[]>;
  /**
   * Hears of vouchers being used as it happens (Supabase Realtime). `onLive` says whether the
   * connection is up; it turns true again after a dropped connection is back. Returns the stop.
   */
  watchVoucherUses(onUse: (use: VoucherUse) => void, onLive: (live: boolean) => void): () => void;
  getOutlet(): Promise<unknown>;
  saveOutlet(config: OutletConfig): Promise<void>;
}

/** What only the platform owner can do: franchises, their subscriptions and admin accounts, platform settings. */
export interface AdminApi {
  demo: boolean;
  listFranchises(): Promise<{ today: string; graceDays: number; franchises: FranchiseRow[] }>;
  /** Creates (id null) or changes a franchise; returns its id. */
  saveFranchise(input: { id: string | null; name: string; active: boolean; paid_until: string | null; note: string }): Promise<string>;
  deleteFranchise(id: string): Promise<void>;
  listMembers(franchiseId: string): Promise<MemberRow[]>;
  addMember(franchiseId: string, email: string, password: string): Promise<void>;
  setMemberPassword(userId: string, password: string): Promise<void>;
  removeMember(userId: string): Promise<void>;
  getPlatform(): Promise<PlatformConfig>;
  savePlatform(config: PlatformConfig): Promise<void>;
}

/** A password for handing over to a new admin: easy to read out, and replaced at first sign-in. */
export const newTempPassword = () => `${randomString(CODE_ALPHABET, 4)}-${randomString(CODE_ALPHABET, 4)}-${randomString('23456789', 3)}`.toLowerCase();

/** Letters and digits that survive being read aloud or copied by hand (no I/1, O/0). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomString(alphabet: string, length: number): string {
  let out = '';
  // Bytes past the last whole multiple of the alphabet are skipped, so every character is equally likely.
  const limit = 256 - (256 % alphabet.length);
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

export const newDeviceCode = () => randomString(CODE_ALPHABET, 6);
export const newDevicePin = () => randomString('0123456789', 6);

let client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

const DEVICE_COLUMNS = 'id,name,code,pin,pin_fails,frames,active,status,token_hash,paired_at,last_seen_at,settings_at,created_at';

/** What the dashboard says when the thing asked for no longer exists, e.g. a franchise that was deleted. */
export const NOT_FOUND = 'Data itu tidak ditemukan.';

const FUNCTION_ERRORS: Record<string, string> = {
  'signed-out': 'Sesi masuk sudah habis. Masuk lagi.',
  forbidden: 'Akun ini tidak punya izin untuk itu.',
  'not-found': NOT_FOUND,
  'email-taken': 'Email itu sudah dipakai akun lain.',
  'bad-request': 'Permintaan tidak lengkap.',
  server: 'Server sedang bermasalah. Coba lagi.',
};

/** Calls an Edge Function as the signed-in account. A refusal comes back as an Error with a readable message. */
async function callFunction<T>(db: SupabaseClient, name: string, body: Record<string, unknown>): Promise<T> {
  const { data } = await db.auth.getSession();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${data.session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const reply = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  if (response.status === 404) throw new Error('Fungsi server belum dipasang (supabase functions deploy).');
  if (reply.error) throw new Error(reply.message ?? FUNCTION_ERRORS[reply.error] ?? `Ditolak: ${reply.error}`);
  if (!response.ok) throw new Error(FUNCTION_ERRORS.server);
  return reply as T;
}

/** A database function's answer; one that reports {error} is turned into an Error. */
function checked<T>(result: { data: unknown; error: { message: string } | null }): T {
  const data = unwrap(result) as { error?: string } | null;
  if (data && typeof data === 'object' && typeof data.error === 'string') throw new Error(FUNCTION_ERRORS[data.error] ?? `Ditolak: ${data.error}`);
  return data as T;
}

/** Asks the database who the signed-in account is. */
export async function loadAccount(db: SupabaseClient, email: string): Promise<Account> {
  const me = checked<{ superadmin?: boolean; must_change_password?: boolean; franchise?: Franchise | null }>(await db.rpc('whoami'));
  return { email, superadmin: me.superadmin === true, franchise: me.franchise ?? null, mustChangePassword: me.must_change_password === true };
}

/** Sets the password of the signed-in account and notes that it is no longer the one handed over. */
export async function changeOwnPassword(db: SupabaseClient, password: string): Promise<void> {
  const { error } = await db.auth.updateUser({ password });
  if (error) throw new Error(error.message);
  unwrap(await db.rpc('password_changed'));
}

async function readPlatform(db: SupabaseClient): Promise<PlatformConfig> {
  const row = unwrap(await db.from('platform').select('config').eq('id', 1).maybeSingle()) as { config: unknown } | null;
  return completePlatform(row?.config);
}

export function createSupabaseApi(db: SupabaseClient, account: Account, franchise: Franchise): OwnerApi {
  const fid = franchise.id;
  return {
    demo: false,
    email: account.email,
    superadmin: account.superadmin,
    franchise,
    async signOut() {
      await db.auth.signOut();
    },
    async changePassword(password) {
      await changeOwnPassword(db, password);
    },
    async status() {
      return checked<FranchiseStatus>(await db.rpc('franchise_status', { p_franchise: fid }));
    },
    getPlatform: () => readPlatform(db),
    dokuGet: () => callFunction<DokuState>(db, 'doku-setup', { action: 'get', franchise_id: fid }),
    async dokuSave(fields) {
      await callFunction(db, 'doku-setup', { action: 'save', franchise_id: fid, ...fields });
    },
    dokuTest: () => callFunction<{ ok: boolean; sure?: boolean; message: string }>(db, 'doku-setup', { action: 'test', franchise_id: fid }),
    async dokuClear() {
      await callFunction(db, 'doku-setup', { action: 'clear', franchise_id: fid });
    },
    async listFrames() {
      return unwrap(await db.from('frames').select('id,name,blurb,layout,thumb,active,updated_at').eq('franchise_id', fid).order('created_at')) as CustomFrameRow[];
    },
    async frameImage(id) {
      const row = unwrap(await db.from('frames').select('image').eq('franchise_id', fid).eq('id', id).maybeSingle()) as { image: string } | null;
      if (!row) throw new Error(FUNCTION_ERRORS['not-found']);
      return row.image;
    },
    async saveFrame(frame) {
      const { id, ...columns } = frame;
      if (id === null) {
        unwrap(await db.from('frames').insert({ ...columns, franchise_id: fid }).select('id'));
      } else {
        unwrap(await db.from('frames').update(columns).eq('franchise_id', fid).eq('id', id).select('id'));
      }
    },
    async deleteFrame(id) {
      unwrap(await db.from('frames').delete().eq('franchise_id', fid).eq('id', id).select('id'));
    },
    async listDevices() {
      const rows = unwrap(await db.from('devices').select(DEVICE_COLUMNS).eq('franchise_id', fid).order('created_at'));
      return (rows as (Omit<Device, 'paired'> & { token_hash: string | null })[]).map(({ token_hash, ...device }) => ({
        ...device,
        status: device.status ?? {},
        paired: token_hash !== null,
      }));
    },
    async createDevice(name) {
      // The code and PIN are made by the database.
      unwrap(await db.from('devices').insert({ franchise_id: fid, name }).select('id'));
    },
    async updateDevice(id, patch) {
      const { unpair, ...columns } = patch;
      const change: Record<string, unknown> = { ...columns };
      // A new PIN also lifts the lock that ten wrong attempts put on the device.
      if (columns.pin !== undefined) change.pin_fails = 0;
      if (Object.keys(change).length > 0) unwrap(await db.from('devices').update(change).eq('franchise_id', fid).eq('id', id).select('id'));
      if (unpair) checked(await db.rpc('device_unpair', { p_device: id }));
    },
    async deleteDevice(id) {
      unwrap(await db.from('devices').delete().eq('franchise_id', fid).eq('id', id).select('id'));
    },
    async dailyStats(from, to) {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';
      return unwrap(await db.rpc('stats_daily', { p_from: from.toISOString(), p_to: to.toISOString(), p_tz: zone, p_franchise: fid })) as StatRow[];
    },
    async listTransactions(filter, offset, limit) {
      let query = db
        .from('transactions')
        .select('id,device_id,device_name,at,session_no,frame,package,price,method,voucher_code,prints,share_code,staff_confirmed,payments(status)', {
          count: 'exact',
        })
        .eq('franchise_id', fid)
        .gte('at', filter.from.toISOString())
        .lt('at', filter.to.toISOString());
      if (filter.method) query = query.eq('method', filter.method);
      if (filter.deviceId) query = query.eq('device_id', filter.deviceId);
      const result = await query.order('at', { ascending: false }).range(offset, offset + limit - 1);
      type Linked = { status: PaymentStatus } | { status: PaymentStatus }[] | null;
      const rows = unwrap(result) as unknown as (Omit<Tx, 'payment_status'> & { payments: Linked })[];
      return {
        rows: rows.map(({ payments, ...row }) => ({ ...row, payment_status: (Array.isArray(payments) ? payments[0]?.status : payments?.status) ?? null })),
        total: result.count ?? 0,
      };
    },
    async listPayments(status, offset, limit) {
      // 'orphan': money that arrived for a session that was never recorded.
      const columns = 'id,device_name,package_name,amount,status,partner_ref,provider_ref,created_at,paid_at';
      let query =
        status === 'orphan'
          ? db.from('payments').select(`${columns},transactions!left(id)`, { count: 'exact' }).eq('status', 'paid').is('transactions', null)
          : db.from('payments').select(`${columns},transactions(id)`, { count: 'exact' });
      query = query.eq('franchise_id', fid);
      if (status !== 'all' && status !== 'orphan') query = query.eq('status', status);
      const result = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
      const rows = unwrap(result) as unknown as (Omit<PaymentRow, 'has_session'> & { transactions: unknown })[];
      return {
        rows: rows.map(({ transactions, ...row }) => ({
          ...row,
          has_session: Array.isArray(transactions) ? transactions.length > 0 : transactions !== null && transactions !== undefined,
        })),
        total: result.count ?? 0,
      };
    },
    async shareStates(codes) {
      if (codes.length === 0) return {};
      const response = await fetch(`${SUPABASE_URL}/functions/v1/share-get`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      });
      const answer = (await response.json().catch(() => ({}))) as {
        shares?: { code: string; status: ShareState['status']; files?: { thumb?: { view: string }; photo?: { view: string } } }[];
      };
      const states: Record<string, ShareState> = {};
      for (const share of answer.shares ?? []) {
        states[share.code] = { status: share.status, thumb: share.files?.thumb?.view ?? share.files?.photo?.view, photo: share.files?.photo?.view };
      }
      return states;
    },
    async voucherCounts() {
      return unwrap(await db.rpc('voucher_counts', { p_franchise: fid })) as Record<VoucherStatus, number>;
    },
    async listVouchers(filter, offset, limit) {
      const now = new Date().toISOString();
      let query = db.from('vouchers').select('code,label,created_at,expires_at,used_at,used_by_name', { count: 'exact' }).eq('franchise_id', fid);
      if (filter.status === 'used') query = query.not('used_at', 'is', null);
      if (filter.status === 'active') query = query.is('used_at', null).or(`expires_at.is.null,expires_at.gt.${now}`);
      if (filter.status === 'expired') query = query.is('used_at', null).lte('expires_at', now);
      const search = filter.search.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (search) query = query.like('norm', `%${search}%`);
      const result = await query.order('created_at', { ascending: false }).order('code').range(offset, offset + limit - 1);
      return { rows: unwrap(result) as VoucherRow[], total: result.count ?? 0 };
    },
    async createVouchers(rows) {
      unwrap(await db.from('vouchers').insert(rows.map((row) => ({ ...row, franchise_id: fid }))).select('code'));
    },
    async recentVoucherUses(after) {
      let query = db.from('vouchers').select('code,used_at,used_by_name').eq('franchise_id', fid).not('used_at', 'is', null);
      if (after) query = query.gt('used_at', after);
      return unwrap(await query.order('used_at', { ascending: false }).limit(after ? 50 : 1)) as VoucherUse[];
    },
    watchVoucherUses(onUse, onLive) {
      // Only UPDATE: a voucher is updated when, and only when, a booth redeems it. DELETE news is not
      // filtered by the access rules, so it is never asked for.
      const channel = db
        .channel(`vouchers:${fid}:${crypto.randomUUID()}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vouchers', filter: `franchise_id=eq.${fid}` }, (payload) => {
          const row = payload.new as Partial<VoucherRow>;
          if (typeof row.code === 'string' && typeof row.used_at === 'string') {
            onUse({ code: row.code, used_at: row.used_at, used_by_name: row.used_by_name ?? null });
          }
        })
        .subscribe((status) => onLive(status === 'SUBSCRIBED'));
      return () => void db.removeChannel(channel);
    },
    async deleteVoucher(code) {
      unwrap(await db.from('vouchers').delete().eq('franchise_id', fid).eq('code', code).select('code'));
    },
    async getOutlet() {
      const row = unwrap(await db.from('franchises').select('config').eq('id', fid).maybeSingle()) as { config: unknown } | null;
      return row?.config ?? {};
    },
    async saveOutlet(config) {
      checked(await db.rpc('save_outlet', { p_franchise: fid, p_config: config }));
    },
  };
}

export function createSupabaseAdminApi(db: SupabaseClient): AdminApi {
  return {
    demo: false,
    async listFranchises() {
      const reply = checked<{ today: string; grace_days: number; franchises: FranchiseRow[] }>(await db.rpc('admin_franchises'));
      return {
        today: reply.today,
        graceDays: reply.grace_days,
        franchises: reply.franchises.map((row) => ({ ...row, revenue_30d: Number(row.revenue_30d), sessions_30d: Number(row.sessions_30d) })),
      };
    },
    async saveFranchise(input) {
      const reply = checked<{ id: string }>(
        await db.rpc('admin_save_franchise', { p_id: input.id, p_name: input.name, p_active: input.active, p_paid_until: input.paid_until, p_note: input.note }),
      );
      return reply.id;
    },
    async deleteFranchise(id) {
      // Through the server function, which also deletes the logins of the franchise's admins.
      await callFunction(db, 'admin', { action: 'franchise-delete', franchise_id: id });
    },
    async listMembers(franchiseId) {
      return checked<{ members: MemberRow[] }>(await db.rpc('admin_members', { p_franchise: franchiseId })).members;
    },
    async addMember(franchiseId, email, password) {
      await callFunction(db, 'admin', { action: 'member-add', franchise_id: franchiseId, email, password });
    },
    async setMemberPassword(userId, password) {
      await callFunction(db, 'admin', { action: 'member-password', user_id: userId, password });
    },
    async removeMember(userId) {
      await callFunction(db, 'admin', { action: 'member-remove', user_id: userId });
    },
    getPlatform: () => readPlatform(db),
    async savePlatform(config) {
      unwrap(await db.from('platform').update({ config }).eq('id', 1).select('id'));
    },
  };
}
