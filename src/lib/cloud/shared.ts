import { DEFAULT_SETTINGS, mergeSettings, type PackageDef, type Settings } from '../settings';

/** The Supabase project this build talks to. Both values are public by design. */
export const SUPABASE_URL: string = (import.meta.env?.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
export const SUPABASE_KEY: string = import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '';
export const cloudConfigured = SUPABASE_URL !== '' && SUPABASE_KEY !== '';

/** The settings the owner manages once, in the dashboard, for every tablet. */
export interface OutletConfig {
  brand: Settings['brand'];
  receipt: Settings['receipt'];
  packages: PackageDef[];
  payment: Settings['payment'];
}

export function outletFromSettings(settings: Settings): OutletConfig {
  return structuredClone({
    brand: settings.brand,
    receipt: settings.receipt,
    packages: settings.packages,
    payment: settings.payment,
  });
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
  });
}

/**
 * Lays what the dashboard decides over a tablet's own settings. Only the parts
 * the owner has actually saved are taken; everything about this particular
 * tablet (printer, camera, session timing, PIN) is left alone.
 */
export function applyRemote(settings: Settings, outlet: unknown, frames: unknown): Settings {
  const next = structuredClone(settings);
  if (isObject(outlet)) {
    if (isObject(outlet.brand)) next.brand = mergeSettings(next.brand, outlet.brand);
    if (isObject(outlet.receipt)) next.receipt = mergeSettings(next.receipt, outlet.receipt);
    if (isObject(outlet.payment)) next.payment = mergeSettings(next.payment, outlet.payment);
    if (Array.isArray(outlet.packages)) {
      const packages = outlet.packages.filter(isPackage);
      if (packages.length > 0) next.packages = packages;
    }
  }
  // A device whose frames were never chosen in the dashboard offers the standard set.
  next.frames.active = Array.isArray(frames)
    ? frames.filter((id): id is string => typeof id === 'string')
    : DEFAULT_SETTINGS.frames.active.slice();
  return next;
}
