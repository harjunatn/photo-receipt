import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkVoucher, generateVouchers, normalizeCode, redeemVoucher, voucherStatus, type Voucher } from '../src/lib/vouchers';

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

describe('checkVoucher', () => {
  const list = [
    voucher('FOTO-ABC234'),
    voucher('FOTO-USED22', { usedAt: NOW - DAY }),
    voucher('FOTO-OLD222', { expiresAt: NOW - 1 }),
    voucher('FOTO-SOON22', { expiresAt: NOW + DAY }),
  ];

  it('accepts a code typed in lower case, with spaces or without the dash', () => {
    for (const typed of ['FOTO-ABC234', 'foto-abc234', 'FOTOABC234', ' foto abc 234 ']) {
      const result = checkVoucher(list, typed, NOW);
      expect(result).toEqual({ ok: true, voucher: list[0] });
    }
  });

  it('explains why a code is refused', () => {
    expect(checkVoucher(list, 'FOTO-NOPE22', NOW)).toEqual({ ok: false, reason: 'not-found' });
    expect(checkVoucher(list, '', NOW)).toEqual({ ok: false, reason: 'not-found' });
    expect(checkVoucher(list, '---', NOW)).toEqual({ ok: false, reason: 'not-found' });
    expect(checkVoucher(list, 'FOTO-USED22', NOW)).toEqual({ ok: false, reason: 'used' });
    expect(checkVoucher(list, 'FOTO-OLD222', NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts a code right up to its expiry', () => {
    expect(checkVoucher(list, 'FOTO-SOON22', NOW + DAY).ok).toBe(true);
    expect(checkVoucher(list, 'FOTO-SOON22', NOW + DAY + 1).ok).toBe(false);
  });
});

describe('redeemVoucher', () => {
  it('marks only the matching code as used, after which it is refused', () => {
    const list = [voucher('FOTO-ABC234'), voucher('FOTO-XYZ789')];
    const after = redeemVoucher(list, 'foto abc234', NOW);
    expect(after[0].usedAt).toBe(NOW);
    expect(after[1].usedAt).toBeNull();
    expect(list[0].usedAt).toBeNull(); // the original list is left untouched
    expect(checkVoucher(after, 'FOTO-ABC234', NOW)).toEqual({ ok: false, reason: 'used' });
    expect(voucherStatus(after[1], NOW)).toBe('active');
  });
});

describe('normalizeCode', () => {
  it('keeps only letters and digits, upper-cased', () => {
    expect(normalizeCode(' fo-to_12 3!')).toBe('FOTO123');
  });
});
