export interface Voucher {
  /** Shown as PREFIX-XXXXXX. */
  code: string;
  createdAt: number;
  /** Timestamp after which the code no longer works, or null for no expiry. */
  expiresAt: number | null;
  usedAt: number | null;
}

export type VoucherStatus = 'active' | 'used' | 'expired';

/** Letters and digits that cannot be confused when read off a slip of paper (no I/1, O/0). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RANDOM_LENGTH = 6;

/** Guests may type codes in lower case or without the dash; compare on letters and digits only. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function voucherStatus(voucher: Voucher, now: number): VoucherStatus {
  if (voucher.usedAt !== null) return 'used';
  if (voucher.expiresAt !== null && voucher.expiresAt < now) return 'expired';
  return 'active';
}

function randomPart(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LENGTH));
  // 256 is a multiple of the 32-letter alphabet, so the modulo is unbiased.
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export interface BatchOptions {
  prefix: string;
  count: number;
  /** Days until the codes expire, or null for no expiry. */
  validDays: number | null;
  now: number;
}

/** Creates new single-use codes that do not collide with any existing code. */
export function generateVouchers(existing: Voucher[], options: BatchOptions): Voucher[] {
  const prefix = normalizeCode(options.prefix).slice(0, 8) || 'FOTO';
  const taken = new Set(existing.map((v) => normalizeCode(v.code)));
  const expiresAt = options.validDays === null ? null : options.now + options.validDays * 86_400_000;
  const created: Voucher[] = [];
  while (created.length < options.count) {
    const code = `${prefix}-${randomPart()}`;
    if (taken.has(normalizeCode(code))) continue;
    taken.add(normalizeCode(code));
    created.push({ code, createdAt: options.now, expiresAt, usedAt: null });
  }
  return created;
}
