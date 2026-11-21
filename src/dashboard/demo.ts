import type { PayMethod } from '../lib/log';
import { newShareCode } from '../lib/cloud/shared';
import { normalizeCode, voucherStatus, type VoucherStatus } from '../lib/vouchers';
import { DEFAULT_PLATFORM, type PlatformConfig } from '../lib/cloud/shared';
import {
  newDeviceCode,
  newDevicePin,
  type Account,
  type AdminApi,
  type CustomFrameRow,
  type Device,
  type DokuState,
  type Franchise,
  type FranchiseRow,
  type MemberRow,
  type OwnerApi,
  type PaymentRow,
  type SubscriptionState,
  type Tx,
  type VoucherRow,
} from './api';
import { dayKey, type StatRow } from './stats';

/** A small repeatable random source, so the sample data looks the same on every visit. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const MINUTE = 60_000;
const DAY = 86_400_000;

interface DemoFranchise extends Franchise {
  active: boolean;
  paid_until: string | null;
  note: string | null;
  created_at: string;
  seed: number;
  booths: string[];
}

const today = () => new Date().toISOString().slice(0, 10);
const dayFrom = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

function stateOf(franchise: Pick<DemoFranchise, 'active' | 'paid_until'>, graceDays: number): SubscriptionState {
  if (!franchise.active) return 'suspended';
  if (!franchise.paid_until || today() <= franchise.paid_until) return 'active';
  return today() <= new Date(Date.parse(franchise.paid_until) + graceDays * DAY).toISOString().slice(0, 10) ? 'grace' : 'expired';
}

/**
 * Sample data kept in memory, for looking at the dashboard before Supabase is
 * connected: a platform owner with three franchises. Everything works, and
 * everything is forgotten on reload.
 */
export function createDemo(): { account: Account; admin: AdminApi; apiFor(franchise: Franchise): OwnerApi } {
  let platform: PlatformConfig = { ...DEFAULT_PLATFORM };
  let franchises: DemoFranchise[] = [
    { id: 'demo-pusat', name: 'Foto Senja', active: true, paid_until: null, note: 'Booth milik sendiri', created_at: new Date(Date.now() - 60 * DAY).toISOString(), seed: 7, booths: ['Booth Kafe Senja', 'Booth Mal Lantai 2', 'Booth Acara'] },
    { id: 'demo-budi', name: 'Booth Budi', active: true, paid_until: dayFrom(4), note: 'Transfer tiap tanggal 5', created_at: new Date(Date.now() - 26 * DAY).toISOString(), seed: 21, booths: ['Tablet Budi 1', 'Tablet Budi 2'] },
    { id: 'demo-citra', name: 'Citra Photo', active: true, paid_until: dayFrom(-3), note: null, created_at: new Date(Date.now() - 34 * DAY).toISOString(), seed: 33, booths: ['Tablet Citra'] },
  ];
  const members = new Map<string, MemberRow[]>([
    ['demo-budi', [{ user_id: 'demo-u1', email: 'budi@contoh.id', created_at: new Date(Date.now() - 26 * DAY).toISOString(), last_sign_in_at: new Date(Date.now() - DAY).toISOString(), must_change_password: false }]],
    ['demo-citra', [{ user_id: 'demo-u2', email: 'citra@contoh.id', created_at: new Date(Date.now() - 34 * DAY).toISOString(), last_sign_in_at: null, must_change_password: true }]],
  ]);
  const apis = new Map<string, OwnerApi>();
  const find = (id: string) => franchises.find((franchise) => franchise.id === id);

  const apiFor = (franchise: Franchise): OwnerApi => {
    const known = find(franchise.id);
    const existing = apis.get(franchise.id);
    if (existing) return { ...existing, franchise };
    const made = createDemoApi(franchise, known?.seed ?? 5, known?.booths ?? ['Tablet 1'], {
      platform: () => platform,
      subscription: () => find(franchise.id) ?? { active: true, paid_until: null },
    });
    apis.set(franchise.id, made);
    return made;
  };

  const admin: AdminApi = {
    demo: true,
    async listFranchises() {
      const rows: FranchiseRow[] = await Promise.all(
        franchises.map(async (franchise) => {
          const api = apiFor(franchise);
          const devices = await api.listDevices();
          const month = await api.dailyStats(new Date(Date.now() - 30 * DAY), new Date(Date.now() + DAY));
          const seen = devices.map((device) => device.last_seen_at).filter((at): at is string => at !== null).sort();
          return {
            id: franchise.id,
            name: franchise.name,
            active: franchise.active,
            paid_until: franchise.paid_until,
            note: franchise.note,
            state: stateOf(franchise, platform.graceDays),
            created_at: franchise.created_at,
            devices: devices.length,
            devices_online: devices.filter((device) => device.last_seen_at && Date.now() - Date.parse(device.last_seen_at) < 3 * MINUTE).length,
            last_seen_at: seen[seen.length - 1] ?? null,
            members: members.get(franchise.id)?.length ?? 0,
            sessions_30d: month.reduce((sum, row) => sum + row.sessions, 0),
            revenue_30d: month.reduce((sum, row) => sum + row.revenue, 0),
          };
        }),
      );
      return { today: today(), graceDays: platform.graceDays, franchises: rows };
    },
    async saveFranchise(input) {
      if (input.id === null) {
        const id = `demo-${crypto.randomUUID().slice(0, 8)}`;
        franchises = [...franchises, { id, name: input.name, active: input.active, paid_until: input.paid_until, note: input.note || null, created_at: new Date().toISOString(), seed: 0, booths: [] }];
        return id;
      }
      franchises = franchises.map((franchise) =>
        franchise.id === input.id ? { ...franchise, name: input.name, active: input.active, paid_until: input.paid_until, note: input.note || null } : franchise,
      );
      return input.id;
    },
    async deleteFranchise(id) {
      franchises = franchises.filter((franchise) => franchise.id !== id);
      apis.delete(id);
      members.delete(id);
    },
    async listMembers(franchiseId) {
      return structuredClone(members.get(franchiseId) ?? []);
    },
    async addMember(franchiseId, email) {
      if ([...members.values()].flat().some((member) => member.email === email)) throw new Error('Email itu sudah dipakai akun lain.');
      members.set(franchiseId, [
        ...(members.get(franchiseId) ?? []),
        { user_id: crypto.randomUUID(), email, created_at: new Date().toISOString(), last_sign_in_at: null, must_change_password: true },
      ]);
    },
    async setMemberPassword(userId) {
      for (const list of members.values()) for (const member of list) if (member.user_id === userId) member.must_change_password = true;
    },
    async removeMember(userId) {
      for (const [id, list] of members) members.set(id, list.filter((member) => member.user_id !== userId));
    },
    async getPlatform() {
      return { ...platform };
    },
    async savePlatform(config) {
      platform = { ...config };
    },
  };

  return { account: { email: 'pemilik@contoh.id', superadmin: true, franchise: null, mustChangePassword: false }, admin, apiFor };
}

/** One franchise's sample data. */
function createDemoApi(
  franchise: Franchise,
  seed: number,
  booths: string[],
  shared: { platform: () => PlatformConfig; subscription: () => { active: boolean; paid_until: string | null } },
): OwnerApi {
  const random = seeded(seed || 1);
  const now = Date.now();
  const iso = (time: number) => new Date(time).toISOString();

  let devices: Device[] = booths
    .map((name, i) => ({ name, seen: [20_000, 50_000, 3 * DAY][i % 3], printer: i === 2 ? 'disconnected' : 'connected', queued: i === 1 ? 2 : 0 }))
    .map((d, i) => ({
    id: `${franchise.id}-${i}`,
    name: d.name,
    code: newDeviceCode(),
    pin: newDevicePin(),
    pin_fails: 0,
    frames: null,
    active: true,
    status: { printer: d.printer, transport: 'usb', queued: d.queued },
    paired: true,
    paired_at: iso(now - 40 * DAY),
    last_seen_at: iso(now - d.seen),
    settings_at: iso(now - 2 * DAY),
    created_at: iso(now - 41 * DAY),
  }));

  const frameNames = ['Klasik', 'Kolase', 'Film', 'Polaroid', 'Nota'];
  const methods: PayMethod[] = ['cash', 'cash', 'qris', 'qris', 'qris', 'voucher'];
  const transactions: Tx[] = [];
  for (let back = devices.length > 0 ? 34 : -1; back >= 0; back--) {
    const date = new Date(now - back * DAY);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const count = Math.round((weekend ? 22 : 9) + random() * (weekend ? 16 : 8));
    for (let n = 0; n < count; n++) {
      const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 10, 0).getTime() + random() * 11 * 60 * MINUTE;
      if (at > now) continue;
      const device = devices[(random() < 0.5 ? 0 : random() < 0.75 ? 1 : 2) % devices.length];
      const double = random() < 0.25;
      const method = methods[Math.floor(random() * methods.length)];
      transactions.push({
        id: `${franchise.id}-tx-${back}-${n}`,
        device_id: device.id,
        device_name: device.name,
        at: iso(at),
        session_no: n + 1,
        frame: frameNames[Math.floor(random() * frameNames.length)],
        package: double ? '2 lembar' : '1 lembar',
        price: double ? 25000 : 15000,
        method,
        voucher_code: method === 'voucher' ? `FOTO-${newDeviceCode()}` : null,
        prints: double ? 2 : 1,
        share_code: back < 7 ? newShareCode() : null,
        // A few cash sessions were taken without the staff PIN, to show how they are marked.
        staff_confirmed: !(method === 'cash' && n % 5 === 0),
      });
    }
  }
  transactions.sort((a, b) => b.at.localeCompare(a.at));

  let vouchers: VoucherRow[] = Array.from({ length: 24 }, (_, i) => ({
    code: `FOTO-${newDeviceCode()}`,
    label: i < 12 ? 'Promo pembukaan' : 'Endorse',
    created_at: iso(now - (i < 12 ? 20 : 3) * DAY),
    expires_at: i < 12 ? iso(now - (i < 6 ? 2 : -10) * DAY) : null,
    used_at: i % 4 === 0 ? iso(now - (i + 1) * 3 * 60 * MINUTE) : null,
    used_by_name: i % 4 === 0 ? (devices[i % 2]?.name ?? 'Tablet') : null,
  }));
  let outlet: unknown = {};
  let frames: (CustomFrameRow & { image: string })[] = [];
  let doku: DokuState = {
    can_save: true,
    source: 'none',
    doku: { clientId: '', merchantId: '', terminalId: '', postalCode: '', sandbox: false, publicKeyPem: '' },
    has_keys: false,
    notify_url: 'https://contoh.supabase.co/functions/v1/doku-notify',
    updated_at: null,
  };

  // Every QRIS session has a paid charge; a few charges ran out unpaid, and one was paid without a session.
  const payments: PaymentRow[] = transactions
    .filter((tx) => tx.method === 'qris')
    .slice(0, 60)
    .flatMap((tx, i) => {
      const base = { device_name: tx.device_name, package_name: tx.package, amount: tx.price, partner_ref: `FS${String(100000 + i)}`, provider_ref: `DK${String(700000 + i)}` };
      const paidRow: PaymentRow = { ...base, id: `${franchise.id}-pay-${i}`, status: 'paid', created_at: tx.at, paid_at: tx.at, has_session: i !== 3 };
      const unpaid: PaymentRow = { ...base, id: `${franchise.id}-pay-x${i}`, status: 'expired', created_at: iso(Date.parse(tx.at) - 6 * MINUTE), paid_at: null, has_session: false, provider_ref: `DK${String(800000 + i)}` };
      return i % 7 === 2 ? [paidRow, unpaid] : [paidRow];
    });

  const statusOf = (v: VoucherRow, at: number): VoucherStatus =>
    voucherStatus(
      { code: v.code, createdAt: 0, expiresAt: v.expires_at ? Date.parse(v.expires_at) : null, usedAt: v.used_at ? Date.parse(v.used_at) : null },
      at,
    );

  return {
    demo: true,
    email: 'pemilik@contoh.id',
    superadmin: true,
    franchise,
    async signOut() {},
    async changePassword() {},
    async status() {
      const subscription = shared.subscription();
      const graceDays = shared.platform().graceDays;
      return { ...franchise, active: subscription.active, paid_until: subscription.paid_until, grace_days: graceDays, state: stateOf(subscription, graceDays), today: today() };
    },
    async getPlatform() {
      return { ...shared.platform() };
    },
    async dokuGet() {
      return structuredClone(doku);
    },
    async dokuSave(fields) {
      if (!doku.has_keys && (!fields.secret_key || !fields.private_key_pem)) throw new Error('Secret Key dan private key belum diisi.');
      doku = {
        ...doku,
        source: 'saved',
        has_keys: true,
        updated_at: new Date().toISOString(),
        doku: {
          clientId: fields.client_id,
          merchantId: fields.merchant_id,
          terminalId: fields.terminal_id,
          postalCode: fields.postal_code,
          sandbox: fields.sandbox,
          publicKeyPem: fields.public_key_pem || doku.doku.publicKeyPem,
        },
      };
    },
    async dokuTest() {
      return doku.has_keys
        ? { ok: true, sure: true, message: 'Contoh: DOKU menerima Client ID, private key dan Secret Key.' }
        : { ok: false, message: 'Kunci DOKU belum diisi.' };
    },
    async dokuClear() {
      doku = { ...doku, source: 'none', has_keys: false, updated_at: null, doku: { clientId: '', merchantId: '', terminalId: '', postalCode: '', sandbox: false, publicKeyPem: '' } };
    },
    async listFrames() {
      return frames.map(({ image: _image, ...row }) => structuredClone(row));
    },
    async frameImage(id) {
      const found = frames.find((frame) => frame.id === id);
      if (!found) throw new Error('Data itu tidak ditemukan.');
      return found.image;
    },
    async saveFrame(input) {
      const updated_at = new Date().toISOString();
      if (input.id === null) {
        frames = [...frames, { id: crypto.randomUUID(), name: input.name, blurb: input.blurb, layout: input.layout, image: input.image ?? '', thumb: input.thumb ?? '', active: input.active, updated_at }];
      } else {
        frames = frames.map((frame) =>
          frame.id === input.id
            ? { ...frame, name: input.name, blurb: input.blurb, layout: input.layout, active: input.active, updated_at, image: input.image ?? frame.image, thumb: input.thumb ?? frame.thumb }
            : frame,
        );
      }
    },
    async deleteFrame(id) {
      frames = frames.filter((frame) => frame.id !== id);
    },
    async listDevices() {
      return structuredClone(devices);
    },
    async createDevice(name) {
      devices.push({
        id: crypto.randomUUID(),
        name,
        code: newDeviceCode(),
        pin: newDevicePin(),
        pin_fails: 0,
        frames: null,
        active: true,
        status: {},
        paired: false,
        paired_at: null,
        last_seen_at: null,
        settings_at: null,
        created_at: iso(Date.now()),
      });
    },
    async updateDevice(id, patch) {
      const { unpair, ...columns } = patch;
      devices = devices.map((d) => (d.id === id ? { ...d, ...columns, ...(unpair ? { paired: false } : {}), ...(columns.pin ? { pin_fails: 0 } : {}) } : d));
    },
    async deleteDevice(id) {
      devices = devices.filter((d) => d.id !== id);
    },
    async dailyStats(from, to) {
      const groups = new Map<string, StatRow>();
      for (const tx of transactions) {
        const at = Date.parse(tx.at);
        if (at < from.getTime() || at >= to.getTime()) continue;
        const day = dayKey(new Date(at));
        const key = `${day}|${tx.device_id}|${tx.method}`;
        const row = groups.get(key) ?? { day, device_id: tx.device_id, device_name: tx.device_name, method: tx.method, sessions: 0, prints: 0, revenue: 0 };
        row.sessions += 1;
        row.prints += tx.prints;
        row.revenue += tx.method === 'qris' || tx.method === 'cash' ? tx.price : 0;
        groups.set(key, row);
      }
      return [...groups.values()];
    },
    async listTransactions(filter, offset, limit) {
      const rows = transactions.filter((tx) => {
        const at = Date.parse(tx.at);
        return (
          at >= filter.from.getTime() &&
          at < filter.to.getTime() &&
          (!filter.method || tx.method === filter.method) &&
          (!filter.deviceId || tx.device_id === filter.deviceId)
        );
      });
      return { rows: rows.slice(offset, offset + limit), total: rows.length };
    },
    async listPayments(status, offset, limit) {
      const rows = payments.filter((row) =>
        status === 'all' ? true : status === 'orphan' ? row.status === 'paid' && !row.has_session : row.status === status,
      );
      return { rows: rows.slice(offset, offset + limit), total: rows.length };
    },
    async shareStates(codes) {
      return Object.fromEntries(codes.map((code) => [code, { status: 'pending' as const }]));
    },
    async voucherCounts() {
      const counts = { active: 0, used: 0, expired: 0 };
      for (const v of vouchers) counts[statusOf(v, Date.now())] += 1;
      return counts;
    },
    async listVouchers(filter, offset, limit) {
      const search = normalizeCode(filter.search);
      const rows = vouchers
        .filter((v) => (filter.status === 'all' || statusOf(v, Date.now()) === filter.status) && normalizeCode(v.code).includes(search))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { rows: rows.slice(offset, offset + limit), total: rows.length };
    },
    async createVouchers(rows) {
      const created_at = iso(Date.now());
      vouchers = [...rows.map((row) => ({ ...row, created_at, used_at: null, used_by_name: null })), ...vouchers];
    },
    async deleteVoucher(code) {
      vouchers = vouchers.filter((v) => v.code !== code);
    },
    async recentVoucherUses(after) {
      const used = vouchers
        .filter((v): v is VoucherRow & { used_at: string } => v.used_at !== null && (after === null || v.used_at > after))
        .sort((a, b) => b.used_at.localeCompare(a.used_at));
      return used.slice(0, after ? 50 : 1).map(({ code, used_at, used_by_name }) => ({ code, used_at, used_by_name }));
    },
    async getOutlet() {
      return structuredClone(outlet);
    },
    async saveOutlet(config) {
      outlet = structuredClone(config);
    },
  };
}
