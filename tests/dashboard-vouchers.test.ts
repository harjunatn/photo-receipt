import { describe, expect, it } from 'vitest';
import { createDemo } from '../src/dashboard/demo';

describe('watching vouchers being used', () => {
  const api = createDemo().apiFor({ id: 'demo-pusat', name: 'Foto Senja' });

  it('starts from the most recent use, then reports only uses after it, newest first', async () => {
    const [latest] = await api.recentVoucherUses(null);
    expect(latest.used_at).toBeTruthy();
    expect(await api.recentVoucherUses(latest.used_at)).toEqual([]);
    const all = await api.recentVoucherUses('1970-01-01T00:00:00Z');
    expect(all.length).toBeGreaterThan(1);
    expect(all[0]).toEqual(latest);
    all.forEach((use, i) => i > 0 && expect(use.used_at <= all[i - 1].used_at).toBe(true));
  });

  it('never reports a voucher that has not been used', async () => {
    const uses = await api.recentVoucherUses('1970-01-01T00:00:00Z');
    const { rows } = await api.listVouchers({ status: 'active', search: '' }, 0, 100);
    const active = new Set(rows.map((row) => row.code));
    expect(uses.some((use) => active.has(use.code))).toBe(false);
  });
});
