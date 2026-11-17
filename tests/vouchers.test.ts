import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateVouchers, normalizeCode, voucherStatus, type Voucher } from '../src/lib/vouchers';

const NOW = Date.UTC(2026, 10, 16);
const DAY = 86_400_000;

function voucher(code: string, overrides: Partial<Voucher> = {}): Voucher {
  return { code, createdAt: NOW, expiresAt: null, usedAt: null, ...overrides };
}

afterEach(() => vi.restoreAllMocks());

describe('generateVouchers', () => {
  it('creates the requested number of distinct PREFIX-XXXXXX codes', () => {
    const created = generateVouchers([], { prefix: 'promo', count: 50, validDays: 30, now: NOW });
    expect(created).toHaveLength(50);
    expect(new Set(created.map((v) => v.code)).size).toBe(50);
    for (const v of created) {
      expect(v.code).toMatch(/^PROMO-[A-HJ-NP-Z2-9]{6}$/);
      expect(v.expiresAt).toBe(NOW + 30 * DAY);
      expect(v.usedAt).toBeNull();
    }
  });

  it('cleans up the prefix and falls back to FOTO when nothing usable is left', () => {
    expect(generateVouchers([], { prefix: ' ulang tahun! ', count: 1, validDays: null, now: NOW })[0].code).toMatch(/^ULANGTAH-/);
    expect(generateVouchers([], { prefix: '!!!', count: 1, validDays: null, now: NOW })[0].code).toMatch(/^FOTO-/);
  });

  it('makes codes without expiry when no validity is given', () => {
    expect(generateVouchers([], { prefix: 'A', count: 1, validDays: null, now: NOW })[0].expiresAt).toBeNull();
  });

  it('never reuses a code that already exists', () => {
    // First draw produces AAAAAA (already taken), second draw BBBBBB.
    const fills = [0, 1];
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint8Array).fill(fills.shift() ?? 2);
      return array;
    });
    const created = generateVouchers([voucher('FOTO-AAAAAA')], { prefix: 'FOTO', count: 1, validDays: null, now: NOW });
    expect(created.map((v) => v.code)).toEqual(['FOTO-BBBBBB']);
  });
});

describe('normalizeCode', () => {
  it('keeps only letters and digits, upper-cased', () => {
    expect(normalizeCode(' fo-to_12 3!')).toBe('FOTO123');
  });
});

describe('voucherStatus', () => {
  it('tells active, used and expired codes apart, with a code valid right up to its expiry', () => {
    expect(voucherStatus(voucher('FOTO-AAAAAA'), NOW)).toBe('active');
    expect(voucherStatus(voucher('FOTO-AAAAAA', { usedAt: NOW - DAY }), NOW)).toBe('used');
    expect(voucherStatus(voucher('FOTO-AAAAAA', { expiresAt: NOW }), NOW)).toBe('active');
    expect(voucherStatus(voucher('FOTO-AAAAAA', { expiresAt: NOW }), NOW + 1)).toBe('expired');
    // A code used before it ran out still counts as used, not expired.
    expect(voucherStatus(voucher('FOTO-AAAAAA', { usedAt: NOW - DAY, expiresAt: NOW - 1 }), NOW)).toBe('used');
  });
});
