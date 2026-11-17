import type { PayMethod } from '../lib/log';

/** One line of the server's daily summary: a day, a tablet and a way of paying. */
export interface StatRow {
  /** YYYY-MM-DD in the owner's time zone. */
  day: string;
  device_id: string | null;
  device_name: string;
  method: PayMethod;
  sessions: number;
  prints: number;
  /** Money actually received: voucher and free sessions count as zero. */
  revenue: number;
}

export interface Totals {
  sessions: number;
  prints: number;
  revenue: number;
}

export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The last `count` days ending today, oldest first. */
export function daysBack(count: number, now: Date): string[] {
  return Array.from({ length: count }, (_, i) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (count - 1 - i))));
}

export function total(rows: StatRow[], keep: (row: StatRow) => boolean = () => true): Totals {
  const sum: Totals = { sessions: 0, prints: 0, revenue: 0 };
  for (const row of rows) {
    if (!keep(row)) continue;
    sum.sessions += Number(row.sessions);
    sum.prints += Number(row.prints);
    sum.revenue += Number(row.revenue);
  }
  return sum;
}

/** One entry per requested day, including days on which nothing was sold. */
export function seriesByDay(rows: StatRow[], days: string[]): (Totals & { day: string })[] {
  return days.map((day) => ({ day, ...total(rows, (row) => row.day === day) }));
}

/** Totals per group, biggest revenue first, then most sessions. */
export function groupTotals(rows: StatRow[], keyOf: (row: StatRow) => string): (Totals & { key: string })[] {
  const keys = [...new Set(rows.map(keyOf))];
  return keys
    .map((key) => ({ key, ...total(rows, (row) => keyOf(row) === key) }))
    .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions);
}

/** A round number at or above the value, for the top of a chart's scale: 1, 2 or 5 times a power of ten. */
export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

/** Short rupiah for chart scales: Rp750, Rp15rb, Rp1,2jt. */
export function compactRupiah(amount: number): string {
  const trim = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });
  if (amount >= 1_000_000) return `Rp${trim(amount / 1_000_000)}jt`;
  if (amount >= 1_000) return `Rp${trim(amount / 1_000)}rb`;
  return `Rp${Math.round(amount)}`;
}

export interface DeviceLike {
  active: boolean;
  paired: boolean;
  pin_fails: number;
  last_seen_at: string | null;
}

/** A tablet reports in every minute; three silent minutes mean it is off or offline. */
const ONLINE_WINDOW_MS = 3 * 60_000;

export function isOnline(device: DeviceLike, now: number): boolean {
  return device.active && device.paired && device.last_seen_at !== null && now - Date.parse(device.last_seen_at) < ONLINE_WINDOW_MS;
}

export function deviceState(device: DeviceLike, now: number): { label: string; tag: '' | 'ok' | 'warn' | 'err' } {
  if (!device.active) return { label: 'Nonaktif', tag: '' };
  if (device.pin_fails >= 10) return { label: 'PIN terkunci', tag: 'err' };
  if (!device.paired) return { label: 'Belum dipasangkan', tag: 'warn' };
  return isOnline(device, now) ? { label: 'Online', tag: 'ok' } : { label: 'Offline', tag: '' };
}
