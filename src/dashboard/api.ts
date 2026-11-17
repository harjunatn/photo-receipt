import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, type OutletConfig } from '../lib/cloud/shared';
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
}

export interface VoucherRow {
  code: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  used_by_name: string | null;
}

export interface TxFilter {
  from: Date;
  /** Exclusive. */
  to: Date;
  method: PayMethod | '';
  deviceId: string;
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

/** Everything the dashboard asks of its data source, so that a sample data set can stand in for Supabase. */
export interface OwnerApi {
  demo: boolean;
  email: string;
  signOut(): Promise<void>;
  changePassword(password: string): Promise<void>;
  listDevices(): Promise<Device[]>;
  createDevice(name: string): Promise<void>;
  updateDevice(id: string, patch: DevicePatch): Promise<void>;
  deleteDevice(id: string): Promise<void>;
  dailyStats(from: Date, to: Date): Promise<StatRow[]>;
  listTransactions(filter: TxFilter, offset: number, limit: number): Promise<Page<Tx>>;
  voucherCounts(): Promise<Record<VoucherStatus, number>>;
  listVouchers(filter: VoucherFilter, offset: number, limit: number): Promise<Page<VoucherRow>>;
  createVouchers(rows: { code: string; label: string | null; expires_at: string | null }[]): Promise<void>;
  deleteVoucher(code: string): Promise<void>;
  getOutlet(): Promise<unknown>;
  saveOutlet(config: OutletConfig): Promise<void>;
}

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

const DEVICE_COLUMNS = 'id,name,code,pin,pin_fails,frames,active,status,token_hash,paired_at,last_seen_at,created_at';

export function createSupabaseApi(db: SupabaseClient, email: string): OwnerApi {
  return {
    demo: false,
    email,
    async signOut() {
      await db.auth.signOut();
    },
    async changePassword(password) {
      const { error } = await db.auth.updateUser({ password });
      if (error) throw new Error(error.message);
    },
    async listDevices() {
      const rows = unwrap(await db.from('devices').select(DEVICE_COLUMNS).order('created_at'));
      return (rows as (Omit<Device, 'paired'> & { token_hash: string | null })[]).map(({ token_hash, ...device }) => ({
        ...device,
        status: device.status ?? {},
        paired: token_hash !== null,
      }));
    },
    async createDevice(name) {
      unwrap(await db.from('devices').insert({ name, code: newDeviceCode(), pin: newDevicePin() }).select('id'));
    },
    async updateDevice(id, patch) {
      const { unpair, ...columns } = patch;
      const change: Record<string, unknown> = { ...columns };
      // A new PIN also lifts the lock that ten wrong attempts put on the device.
      if (columns.pin !== undefined) change.pin_fails = 0;
      if (unpair) change.token_hash = null;
      unwrap(await db.from('devices').update(change).eq('id', id).select('id'));
    },
    async deleteDevice(id) {
      unwrap(await db.from('devices').delete().eq('id', id).select('id'));
    },
    async dailyStats(from, to) {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';
      return unwrap(await db.rpc('stats_daily', { p_from: from.toISOString(), p_to: to.toISOString(), p_tz: zone })) as StatRow[];
    },
    async listTransactions(filter, offset, limit) {
      let query = db
        .from('transactions')
        .select('id,device_id,device_name,at,session_no,frame,package,price,method,voucher_code,prints', { count: 'exact' })
        .gte('at', filter.from.toISOString())
        .lt('at', filter.to.toISOString());
      if (filter.method) query = query.eq('method', filter.method);
      if (filter.deviceId) query = query.eq('device_id', filter.deviceId);
      const result = await query.order('at', { ascending: false }).range(offset, offset + limit - 1);
      return { rows: unwrap(result) as Tx[], total: result.count ?? 0 };
    },
    async voucherCounts() {
      return unwrap(await db.rpc('voucher_counts')) as Record<VoucherStatus, number>;
    },
    async listVouchers(filter, offset, limit) {
      const now = new Date().toISOString();
      let query = db.from('vouchers').select('code,label,created_at,expires_at,used_at,used_by_name', { count: 'exact' });
      if (filter.status === 'used') query = query.not('used_at', 'is', null);
      if (filter.status === 'active') query = query.is('used_at', null).or(`expires_at.is.null,expires_at.gt.${now}`);
      if (filter.status === 'expired') query = query.is('used_at', null).lte('expires_at', now);
      const search = filter.search.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (search) query = query.like('norm', `%${search}%`);
      const result = await query.order('created_at', { ascending: false }).order('code').range(offset, offset + limit - 1);
      return { rows: unwrap(result) as VoucherRow[], total: result.count ?? 0 };
    },
    async createVouchers(rows) {
      unwrap(await db.from('vouchers').insert(rows).select('code'));
    },
    async deleteVoucher(code) {
      unwrap(await db.from('vouchers').delete().eq('code', code).select('code'));
    },
    async getOutlet() {
      const row = unwrap(await db.from('outlet').select('config').eq('id', 1).maybeSingle()) as { config: unknown } | null;
      return row?.config ?? {};
    },
    async saveOutlet(config) {
      unwrap(await db.from('outlet').update({ config }).eq('id', 1).select('id'));
    },
  };
}
