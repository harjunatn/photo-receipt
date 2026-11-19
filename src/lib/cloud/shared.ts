import { DEFAULT_SETTINGS, mergeSettings, type PackageDef, type Settings } from '../settings';

/** The Supabase project this build talks to. Both values are public by design. */
export const SUPABASE_URL: string = (import.meta.env?.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
export const SUPABASE_KEY: string = import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '';
export const cloudConfigured = SUPABASE_URL !== '' && SUPABASE_KEY !== '';

/**
 * The settings the owner manages once, in the dashboard, for every tablet. Of
 * the receipt only the logo is shared: each booth writes its own texts.
 */
export interface OutletConfig {
  brand: Settings['brand'];
  receipt: Pick<Settings['receipt'], 'logo'>;
  packages: PackageDef[];
  payment: Settings['payment'];
  share: Settings['share'];
}

export function outletFromSettings(settings: Settings): OutletConfig {
  return structuredClone({
    brand: settings.brand,
    receipt: { logo: settings.receipt.logo },
    packages: settings.packages,
    payment: settings.payment,
    share: settings.share,
  });
}

/** What the platform owner sets for every franchise: the name behind the booths and where it shows. */
export interface PlatformConfig {
  /** The platform's name, e.g. on the dashboard. */
  name: string;
  /** Small text on the guest screens of every tablet. Empty shows none. */
  watermark: string;
  /** Last line of every receipt and of the downloadable copy, e.g. the platform's social media account. Empty prints none. */
  receiptLine: string;
  /** Days a booth keeps running after its franchise's subscription ran out. */
  graceDays: number;
}

export const DEFAULT_PLATFORM: PlatformConfig = { ...DEFAULT_SETTINGS.platform, graceDays: 7 };

/** Fills the gaps of saved platform settings, e.g. before the owner has saved any. */
export function completePlatform(saved: unknown): PlatformConfig {
  const source = isObject(saved) ? saved : {};
  const line = (value: unknown, fallback: string, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : fallback);
  const days = Number(source.graceDays);
  return {
    name: line(source.name, DEFAULT_PLATFORM.name, 40) || DEFAULT_PLATFORM.name,
    watermark: line(source.watermark, DEFAULT_PLATFORM.watermark, 60),
    receiptLine: line(source.receiptLine, DEFAULT_PLATFORM.receiptLine, 40),
    graceDays: Number.isInteger(days) && days >= 0 && days <= 60 ? days : DEFAULT_PLATFORM.graceDays,
  };
}

/** What a tablet remembers of its franchise's subscription, so it still knows where it stands while offline. */
export interface Subscription {
  /** false: stopped by the platform owner, whatever the date. */
  active: boolean;
  /** Last day covered (YYYY-MM-DD), or null for no end. */
  paidUntil: string | null;
  graceDays: number;
}

/** active: running · grace: ran out, booths still run for a few days · expired: booths stopped · suspended: stopped by the platform owner. */
export type SubscriptionState = 'active' | 'grace' | 'expired' | 'suspended';

/** Today's date in Jakarta, which is how the server counts subscription days. */
export function jakartaDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Where a subscription stands on a given day. Nothing known yet (a tablet before its first sync) counts as running. */
export function subscriptionState(subscription: Subscription | null, now: Date = new Date()): SubscriptionState {
  if (!subscription) return 'active';
  if (!subscription.active) return 'suspended';
  if (!subscription.paidUntil) return 'active';
  const today = jakartaDay(now);
  if (today <= subscription.paidUntil) return 'active';
  return today <= addDays(subscription.paidUntil, Math.max(0, subscription.graceDays)) ? 'grace' : 'expired';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPackage(value: unknown): value is PackageDef {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.price === 'number' &&
    value.price >= 0 &&
    typeof value.prints === 'number' &&
    value.prints >= 1 &&
    typeof value.active === 'boolean'
  );
}

/** Fills the gaps of a saved outlet configuration, e.g. one the owner has never saved. */
export function completeOutlet(saved: unknown, fallback: OutletConfig): OutletConfig {
  const source = isObject(saved) ? saved : {};
  const packages = Array.isArray(source.packages) ? source.packages.filter(isPackage) : [];
  return structuredClone({
    brand: mergeSettings(fallback.brand, source.brand),
    receipt: mergeSettings(fallback.receipt, source.receipt),
    packages: packages.length > 0 ? packages : fallback.packages,
    payment: mergeSettings(fallback.payment, source.payment),
    share: mergeSettings(fallback.share, source.share),
  });
}

/**
 * Lays what the dashboard decides over a tablet's own settings. Only the parts
 * the owner has actually saved are taken; everything about this particular
 * tablet (printer, camera, session timing, PIN) is left alone.
 */
export function applyRemote(settings: Settings, outlet: unknown, frames: unknown, platform?: unknown): Settings {
  const next = structuredClone(settings);
  // Sent together with the outlet; absent while only the frames changed.
  if (isObject(platform)) {
    const complete = completePlatform(platform);
    next.platform = { name: complete.name, watermark: complete.watermark, receiptLine: complete.receiptLine };
  }
  if (isObject(outlet)) {
    if (isObject(outlet.brand)) next.brand = mergeSettings(next.brand, outlet.brand);
    // The receipt texts are the tablet's own; outlets saved before that still carry them and are ignored.
    if (isObject(outlet.receipt) && typeof outlet.receipt.logo === 'string') next.receipt.logo = outlet.receipt.logo;
    if (isObject(outlet.payment)) next.payment = mergeSettings(next.payment, outlet.payment);
    if (isObject(outlet.share)) next.share = mergeSettings(next.share, outlet.share);
    if (Array.isArray(outlet.packages)) {
      const packages = outlet.packages.filter(isPackage);
      if (packages.length > 0) next.packages = packages;
    }
  }
  // A tablet that never chose a receipt title prints its outlet's name rather than the app's sample one.
  if (next.receipt.title === DEFAULT_SETTINGS.receipt.title && next.brand.title.trim() && next.brand.title !== DEFAULT_SETTINGS.brand.title) {
    next.receipt.title = next.brand.title.trim().toUpperCase();
  }
  // A device whose frames were never chosen in the dashboard offers the standard set.
  next.frames.active = Array.isArray(frames)
    ? frames.filter((id): id is string => typeof id === 'string')
    : DEFAULT_SETTINGS.frames.active.slice();
  return next;
}

/**
 * The settings made on the tablet itself: printer, session and camera, receipt
 * texts, photo history and the staff PIN. A copy is kept with the device in the
 * dashboard, so that a replacement tablet paired with the same code works the same way.
 */
export type DeviceSettings = Pick<Settings, 'session' | 'printer' | 'storage' | 'admin'> & {
  /** Without the logo, which comes from the dashboard. */
  receipt: Omit<Settings['receipt'], 'logo'>;
};

export function deviceSettingsOf(settings: Settings): DeviceSettings {
  const { logo: _logo, ...texts } = settings.receipt;
  return structuredClone({
    session: settings.session,
    printer: settings.printer,
    receipt: texts,
    storage: settings.storage,
    admin: settings.admin,
  });
}

/** Lays a device's saved settings over this tablet's, leaving what the dashboard decides alone. */
export function applyDeviceSettings(settings: Settings, saved: unknown): Settings {
  const next = structuredClone(settings);
  if (!isObject(saved)) return next;
  if (isObject(saved.session)) next.session = mergeSettings(next.session, saved.session);
  if (isObject(saved.printer)) next.printer = mergeSettings(next.printer, saved.printer);
  if (isObject(saved.storage)) next.storage = mergeSettings(next.storage, saved.storage);
  if (isObject(saved.receipt)) {
    const { logo, ...texts } = next.receipt;
    next.receipt = { ...mergeSettings(texts, saved.receipt), logo };
  }
  // A damaged PIN would lock staff out of the tablet, so only a valid one is taken.
  if (isObject(saved.admin) && typeof saved.admin.pin === 'string' && /^\d{4,8}$/.test(saved.admin.pin)) {
    next.admin = { ...next.admin, pin: saved.admin.pin };
  }
  return next;
}

/**
 * Days a guest's digital copies stay downloadable. Must match the lifecycle rule
 * on the R2 bucket and the interval in share_claim (supabase/schema.sql).
 */
export const SHARE_DAYS = 3;

/** Lower-case letters and digits that cannot be confused with each other (no l/1, o/0). */
const SHARE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** A new unguessable code for one session's digital copies: 12 characters, 60 bits. */
export function newShareCode(): string {
  // 256 is a multiple of the 32-letter alphabet, so the modulo is unbiased.
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => SHARE_ALPHABET[b % SHARE_ALPHABET.length]).join('');
}

/** The page a guest opens by scanning the QR code on the receipt. */
export function shareUrl(code: string, base: { origin: string; pathname: string } = location): string {
  return `${base.origin}${base.pathname}#s/${code}`;
}
