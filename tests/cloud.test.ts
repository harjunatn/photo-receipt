import { describe, expect, it } from 'vitest';
import { applyRemote, completeOutlet, outletFromSettings } from '../src/lib/cloud/shared';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import {
  compactRupiah,
  dayKey,
  daysBack,
  deviceState,
  groupTotals,
  niceCeiling,
  seriesByDay,
  total,
  type StatRow,
} from '../src/dashboard/stats';

function row(day: string, device: string, method: StatRow['method'], sessions: number, revenue: number): StatRow {
  return { day, device_id: device, device_name: device, method, sessions, prints: sessions, revenue };
}

describe('applyRemote', () => {
  it('changes nothing while the owner has not saved anything in the dashboard', () => {
    expect(applyRemote(DEFAULT_SETTINGS, {}, null)).toEqual(DEFAULT_SETTINGS);
    expect(applyRemote(DEFAULT_SETTINGS, null, null)).toEqual(DEFAULT_SETTINGS);
  });

  it('takes prices, payment and texts from the dashboard but leaves the tablet its own printer and PIN', () => {
    const local = structuredClone(DEFAULT_SETTINGS);
    local.printer.transport = 'bluetooth';
    local.admin.pin = '9999';
    local.receipt.logo = 'data:image/png;base64,AAAA';
    const outlet = outletFromSettings(DEFAULT_SETTINGS);
    outlet.brand.title = 'SENJA BOOTH';
    outlet.packages = [{ id: 'a', name: 'Satu', description: '', price: 20000, prints: 1, active: true }];
    outlet.payment.cash = false;
    outlet.receipt.closing = 'Sampai jumpa';

    const next = applyRemote(local, outlet, ['film', 'klasik']);
    expect(next.brand.title).toBe('SENJA BOOTH');
    expect(next.brand.accent).toBe(local.brand.accent);
    expect(next.packages).toEqual(outlet.packages);
    expect(next.payment.cash).toBe(false);
    expect(next.receipt.closing).toBe('Sampai jumpa');
    expect(next.receipt.logo).toBe(local.receipt.logo);
    expect(next.frames.active).toEqual(['film', 'klasik']);
    expect(next.printer.transport).toBe('bluetooth');
    expect(next.admin.pin).toBe('9999');
  });

  it('keeps the tablet working when the dashboard sends damaged data', () => {
    const next = applyRemote(DEFAULT_SETTINGS, { packages: [{ name: 'tanpa harga' }], payment: { cash: 'ya' }, brand: 'x' }, 'film');
    expect(next).toEqual(DEFAULT_SETTINGS);
  });

  it('does not alter the settings it was given', () => {
    const before = structuredClone(DEFAULT_SETTINGS);
    applyRemote(DEFAULT_SETTINGS, { brand: { title: 'LAIN' } }, ['film']);
    expect(DEFAULT_SETTINGS).toEqual(before);
  });
});

describe('completeOutlet', () => {
  it('falls back to the defaults for an outlet that was never saved', () => {
    const fallback = outletFromSettings(DEFAULT_SETTINGS);
    expect(completeOutlet({}, fallback)).toEqual(fallback);
    expect(completeOutlet({ brand: { title: 'X' } }, fallback).brand).toEqual({ title: 'X', subtitle: fallback.brand.subtitle });
  });

  it('leaves the logo out of what is shared between tablets', () => {
    expect('logo' in outletFromSettings(DEFAULT_SETTINGS).receipt).toBe(false);
  });
});

describe('dashboard totals', () => {
  const rows = [
    row('2026-11-16', 'A', 'cash', 3, 45000),
    row('2026-11-16', 'B', 'qris', 2, 30000),
    row('2026-11-17', 'A', 'voucher', 4, 0),
    row('2026-11-17', 'A', 'qris', 1, 15000),
  ];

  it('adds up sessions and revenue, also when the server sends numbers as text', () => {
    expect(total(rows)).toEqual({ sessions: 10, prints: 10, revenue: 90000 });
    const asText = [{ ...rows[0], sessions: '3' as unknown as number, revenue: '45000' as unknown as number }];
    expect(total(asText).revenue).toBe(45000);
  });

  it('gives every requested day an entry, including days without sales', () => {
    const series = seriesByDay(rows, ['2026-11-15', '2026-11-16', '2026-11-17']);
    expect(series.map((point) => point.revenue)).toEqual([0, 75000, 15000]);
    expect(series[0].sessions).toBe(0);
  });

  it('ranks groups by revenue, then by sessions', () => {
    expect(groupTotals(rows, (r) => r.device_name).map((g) => g.key)).toEqual(['A', 'B']);
    expect(groupTotals(rows, (r) => r.method).map((g) => g.key)).toEqual(['cash', 'qris', 'voucher']);
  });

  it('lists the last days oldest first, across a month boundary', () => {
    expect(daysBack(3, new Date(2026, 10, 1, 9))).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('rounds the chart scale up to 1, 2 or 5 times a power of ten', () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(135000)).toBe(200000);
    expect(niceCeiling(200000)).toBe(200000);
    expect(niceCeiling(420000)).toBe(500000);
    expect(niceCeiling(730000)).toBe(1000000);
  });

  it('shortens rupiah for chart labels', () => {
    expect(compactRupiah(750)).toBe('Rp750');
    expect(compactRupiah(15000)).toBe('Rp15rb');
    expect(compactRupiah(1250000)).toBe('Rp1,3jt');
  });
});

describe('deviceState', () => {
  const now = Date.parse('2026-11-17T10:00:00Z');
  const base = { active: true, paired: true, pin_fails: 0, last_seen_at: '2026-11-17T09:59:30Z' };

  it('calls a tablet online only while it keeps reporting in', () => {
    expect(deviceState(base, now).label).toBe('Online');
    expect(deviceState({ ...base, last_seen_at: '2026-11-17T09:50:00Z' }, now).label).toBe('Offline');
  });

  it('explains why a tablet is not in use', () => {
    expect(deviceState({ ...base, paired: false, last_seen_at: null }, now).label).toBe('Belum dipasangkan');
    expect(deviceState({ ...base, pin_fails: 10 }, now).label).toBe('PIN terkunci');
    expect(deviceState({ ...base, active: false }, now).label).toBe('Nonaktif');
  });
});
