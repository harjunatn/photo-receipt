import type { PayMethod } from '../lib/log';
import { newShareCode } from '../lib/cloud/shared';
import { normalizeCode, voucherStatus, type VoucherStatus } from '../lib/vouchers';
import { newDeviceCode, newDevicePin, type Device, type OwnerApi, type PaymentRow, type Tx, type VoucherRow } from './api';
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

/**
 * Sample data kept in memory, for looking at the dashboard before Supabase is
 * connected. Everything works, and everything is forgotten on reload.
 */
export function createDemoApi(): OwnerApi {
  const random = seeded(7);
  const now = Date.now();
  const iso = (time: number) => new Date(time).toISOString();

  let devices: Device[] = [
    { name: 'Booth Kafe Senja', seen: 20_000, printer: 'connected', queued: 0 },
    { name: 'Booth Mal Lantai 2', seen: 50_000, printer: 'connected', queued: 2 },
    { name: 'Booth Acara', seen: 3 * DAY, printer: 'disconnected', queued: 0 },
  ].map((d, i) => ({
    id: `demo-${i}`,
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
    created_at: iso(now - 41 * DAY),
  }));

  const frames = ['Klasik', 'Kolase', 'Film', 'Polaroid', 'Nota'];
  const methods: PayMethod[] = ['cash', 'cash', 'qris', 'qris', 'qris', 'voucher'];
  const transactions: Tx[] = [];
  for (let back = 34; back >= 0; back--) {
    const date = new Date(now - back * DAY);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const count = Math.round((weekend ? 22 : 9) + random() * (weekend ? 16 : 8));
    for (let n = 0; n < count; n++) {
      const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 10, 0).getTime() + random() * 11 * 60 * MINUTE;
      if (at > now) continue;
      const device = devices[random() < 0.5 ? 0 : random() < 0.75 ? 1 : 2];
      const double = random() < 0.25;
      const method = methods[Math.floor(random() * methods.length)];
      transactions.push({
        id: `demo-tx-${back}-${n}`,
        device_id: device.id,
        device_name: device.name,
        at: iso(at),
        session_no: n + 1,
        frame: frames[Math.floor(random() * frames.length)],
        package: double ? '2 lembar' : '1 lembar',
        price: double ? 25000 : 15000,
        method,
        voucher_code: method === 'voucher' ? `FOTO-${newDeviceCode()}` : null,
        prints: double ? 2 : 1,
        share_code: back < 7 ? newShareCode() : null,
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
    used_by_name: i % 4 === 0 ? devices[i % 2].name : null,
  }));
  let outlet: unknown = {};

  // Every QRIS session has a paid charge; a few charges ran out unpaid, and one was paid without a session.
  const payments: PaymentRow[] = transactions
    .filter((tx) => tx.method === 'qris')
    .slice(0, 60)
    .flatMap((tx, i) => {
      const base = { device_name: tx.device_name, package_name: tx.package, amount: tx.price, partner_ref: `FS${String(100000 + i)}`, provider_ref: `DK${String(700000 + i)}` };
      const paidRow: PaymentRow = { ...base, id: `demo-pay-${i}`, status: 'paid', created_at: tx.at, paid_at: tx.at, has_session: i !== 3 };
      const unpaid: PaymentRow = { ...base, id: `demo-pay-x${i}`, status: 'expired', created_at: iso(Date.parse(tx.at) - 6 * MINUTE), paid_at: null, has_session: false, provider_ref: `DK${String(800000 + i)}` };
      return i % 7 === 2 ? [paidRow, unpaid] : [paidRow];
    });

  const statusOf = (v: VoucherRow, at: number): VoucherStatus =>
    voucherStatus(
      { code: v.code, createdAt: 0, expiresAt: v.expires_at ? Date.parse(v.expires_at) : null, usedAt: v.used_at ? Date.parse(v.used_at) : null },
      at,
    );

  return {
    demo: true,
    email: 'contoh@hellosnaply.id',
    async signOut() {},
    async changePassword() {},
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
    async getOutlet() {
      return structuredClone(outlet);
    },
    async saveOutlet(config) {
      outlet = structuredClone(config);
    },
  };
}
