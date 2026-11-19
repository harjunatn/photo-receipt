import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextSessionNumber, paidAmount, toCsv, totalsSince, type LogEntry } from '../src/lib/log';
import { DEFAULT_SETTINGS, mergeSettings, paymentChoices } from '../src/lib/settings';

function entry(overrides: Partial<LogEntry>): LogEntry {
  return { at: 1000, no: 1, packageName: 'Paket Struk', price: 15000, method: 'cash', prints: 1, ...overrides };
}

describe('sales totals', () => {
  it('counts money only for sessions that were actually paid', () => {
    expect(paidAmount(entry({ method: 'qris' }))).toBe(15000);
    expect(paidAmount(entry({ method: 'cash' }))).toBe(15000);
    expect(paidAmount(entry({ method: 'voucher' }))).toBe(0);
    expect(paidAmount(entry({ method: 'free', price: 0 }))).toBe(0);
  });

  it('sums sessions, prints and revenue from a point in time onward', () => {
    const log = [
      entry({ at: 3000, method: 'qris', price: 25000, prints: 2 }),
      entry({ at: 2000, method: 'voucher', prints: 1 }),
      entry({ at: 500, method: 'cash', prints: 1 }),
    ];
    expect(totalsSince(log, 1000)).toEqual({ sessions: 2, prints: 3, revenue: 25000 });
    expect(totalsSince(log, 0)).toEqual({ sessions: 3, prints: 4, revenue: 40000 });
    expect(totalsSince([], 0)).toEqual({ sessions: 0, prints: 0, revenue: 0 });
  });
});

describe('toCsv', () => {
  it('quotes every cell and doubles embedded quotes', () => {
    expect(toCsv([['kode', 'catatan'], ['A-1', 'bilang "hai", lalu pergi'], [7, '']])).toBe(
      '"kode","catatan"\n"A-1","bilang ""hai"", lalu pergi"\n"7",""',
    );
  });
});

describe('nextSessionNumber', () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('counts up through the day and starts again at 1 the next day', () => {
    const morning = new Date(2026, 10, 16, 9, 0);
    const evening = new Date(2026, 10, 16, 21, 30);
    const tomorrow = new Date(2026, 10, 17, 8, 0);
    expect(nextSessionNumber(morning)).toBe(1);
    expect(nextSessionNumber(morning)).toBe(2);
    expect(nextSessionNumber(evening)).toBe(3);
    expect(nextSessionNumber(tomorrow)).toBe(1);
  });

  it('starts over when the saved counter is unreadable', () => {
    localStorage.setItem('booth.counter.v1', '{not json');
    expect(nextSessionNumber(new Date(2026, 10, 16))).toBe(1);
  });
});

describe('mergeSettings', () => {
  it('returns the defaults when nothing usable was saved', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(DEFAULT_SETTINGS, 'garbage')).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps saved values and fills in fields added by a newer version', () => {
    const saved = { brand: { title: 'BOOTH SAYA' }, printer: { dots: 384, raster: { gamma: 1.6 } } };
    const merged = mergeSettings(DEFAULT_SETTINGS, saved);
    expect(merged.brand.title).toBe('BOOTH SAYA');
    expect(merged.brand.accent).toBe(DEFAULT_SETTINGS.brand.accent);
    expect(merged.printer.dots).toBe(384);
    expect(merged.printer.raster.gamma).toBe(1.6);
    expect(merged.printer.raster.dither).toBe(DEFAULT_SETTINGS.printer.raster.dither);
    expect(merged.session).toEqual(DEFAULT_SETTINGS.session);
  });

  it('drops values of the wrong type and keys it does not know', () => {
    const saved = { brand: { title: 42, extra: 'x' }, packages: 'none', session: { sound: 'yes' }, unknown: true };
    const merged = mergeSettings(DEFAULT_SETTINGS, saved);
    expect(merged.brand.title).toBe(DEFAULT_SETTINGS.brand.title);
    expect(merged.brand).not.toHaveProperty('extra');
    expect(merged.packages).toEqual(DEFAULT_SETTINGS.packages);
    expect(merged.session.sound).toBe(DEFAULT_SETTINGS.session.sound);
    expect(merged).not.toHaveProperty('unknown');
  });

  it('takes saved lists as they are', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { packages: [], receipt: { quotes: ['satu'] } });
    expect(merged.packages).toEqual([]);
    expect(merged.receipt.quotes).toEqual(['satu']);
  });
});

describe('paymentChoices', () => {
  const none = { qris: false, qrisAuto: false, qrisImage: '', cash: false, cashConfirm: true, qrisConfirm: true, voucher: false };

  it('offers the methods that are switched on, in a fixed order', () => {
    expect(paymentChoices({ ...none, qris: true, qrisImage: 'data:image/png;base64,AAAA', cash: true, voucher: true })).toEqual(['qris', 'cash', 'voucher']);
    expect(paymentChoices({ ...none, voucher: true })).toEqual(['voucher']);
  });

  it('leaves manual QRIS out until its image has been uploaded', () => {
    expect(paymentChoices({ ...none, qris: true, cash: true })).toEqual(['cash']);
  });

  it('offers automatic QRIS without an image, but only while QRIS itself is on', () => {
    expect(paymentChoices({ ...none, qris: true, qrisAuto: true })).toEqual(['qris']);
    expect(paymentChoices({ ...none, qrisAuto: true, cash: true })).toEqual(['cash']);
  });

  it('falls back to cash so a paid session can always be started', () => {
    expect(paymentChoices(none)).toEqual(['cash']);
    expect(paymentChoices({ ...none, qris: true })).toEqual(['cash']);
  });
});
