import { createPersistedStore } from './store';

export type PayMethod = 'free' | 'voucher' | 'qris' | 'cash';

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  free: 'Gratis',
  voucher: 'Voucher',
  qris: 'QRIS',
  cash: 'Tunai',
};

/** One finished session, without photos — the basis for the sales summary. */
export interface LogEntry {
  at: number;
  no: number;
  packageName: string;
  price: number;
  method: PayMethod;
  voucher?: string;
  prints: number;
}

export interface Totals {
  sessions: number;
  prints: number;
  /** Money actually collected: voucher and free sessions count as zero. */
  revenue: number;
}

const MAX_ENTRIES = 5000;

export const logStore = createPersistedStore<LogEntry[]>('booth.log.v1', []);

export function addLogEntry(entry: LogEntry): void {
  logStore.set([entry, ...logStore.get()].slice(0, MAX_ENTRIES));
}

export function paidAmount(entry: LogEntry): number {
  return entry.method === 'qris' || entry.method === 'cash' ? entry.price : 0;
}

export function totalsSince(entries: LogEntry[], since: number): Totals {
  const totals: Totals = { sessions: 0, prints: 0, revenue: 0 };
  for (const entry of entries) {
    if (entry.at < since) continue;
    totals.sessions += 1;
    totals.prints += entry.prints;
    totals.revenue += paidAmount(entry);
  }
  return totals;
}

export function startOfToday(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

const COUNTER_KEY = 'booth.counter.v1';

/** How many sessions have been numbered on the given day. */
function sessionsNumbered(day: number): number {
  try {
    const saved = JSON.parse(localStorage.getItem(COUNTER_KEY) ?? 'null');
    if (saved && saved.day === day && Number.isInteger(saved.n)) return saved.n;
  } catch {
    // Start the count over if the saved value is unreadable.
  }
  return 0;
}

/** The number the next finished session will get, without taking it — for previews. */
export function peekSessionNumber(now = new Date()): number {
  return sessionsNumbered(startOfToday(now)) + 1;
}

/** Takes the next session number. Numbers restart at 1 every day, like a queue ticket. */
export function nextSessionNumber(now = new Date()): number {
  const day = startOfToday(now);
  const n = sessionsNumbered(day) + 1;
  localStorage.setItem(COUNTER_KEY, JSON.stringify({ day, n }));
  return n;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}
