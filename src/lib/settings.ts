import type { RasterSettings } from './image/dither';
import type { CutMode, RasterMode } from './printer/escpos';
import { useStore } from './store';

export type TransportKind = 'bluetooth' | 'usb' | 'serial' | 'preview';
export type BleWriteMode = 'auto' | 'with-response' | 'without-response';

/** A price option: what one session costs and how many copies it prints. */
export interface PackageDef {
  id: string;
  name: string;
  description: string;
  /** Rupiah. 0 means the session starts without payment. */
  price: number;
  /** Copies printed per session. */
  prints: number;
  active: boolean;
}

export interface Settings {
  brand: {
    title: string;
    subtitle: string;
    accent: string;
  };
  session: {
    countdownSec: number;
    /** Seconds without a touch before the booth moves on by itself. */
    idleSec: number;
    mirrorPreview: boolean;
    mirrorPhoto: boolean;
    /** '' = front camera, 'demo' = generated test picture, otherwise a device id. */
    cameraId: string;
    sound: boolean;
    /** Let guests pick a photo style (normal, sketch, comic…) before printing. */
    guestStyles: boolean;
  };
  frames: {
    /** Ids of the frames guests can choose, in the order they are shown. */
    active: string[];
  };
  receipt: {
    title: string;
    subtitle: string;
    /** Data URL of a logo printed above the title. */
    logo: string;
    showMeta: boolean;
    quoteTitle: string;
    quotes: string[];
    closing: string;
    social: string;
    qrUrl: string;
    qrCaption: string;
    barcode: boolean;
  };
  packages: PackageDef[];
  /** Which ways of paying the guest is offered. */
  payment: {
    /** Offer QRIS at all. */
    qris: boolean;
    /**
     * true: a QR is made for every session through the payment provider and the
     * session starts by itself once it is paid. false: the merchant's own static
     * QRIS image is shown and staff confirm the payment with their PIN.
     */
    qrisAuto: boolean;
    /** Data URL of the merchant's static QRIS image, for the manual way. */
    qrisImage: string;
    /** Pay staff in cash; staff confirm with their PIN. */
    cash: boolean;
    /** Single-use voucher codes typed by the guest. */
    voucher: boolean;
  };
  printer: {
    transport: TransportKind;
    paperWidth: 58 | 80;
    /** Printable dots per line: 384 for most 58 mm printers, 576 for 80 mm. */
    dots: number;
    cut: CutMode;
    feedLines: number;
    rasterMode: RasterMode;
    bandRows: number;
    /** Milliseconds to wait after each image band. */
    bandDelayMs: number;
    /** Bytes per Bluetooth write. */
    bleChunk: number;
    bleChunkDelayMs: number;
    bleWrite: BleWriteMode;
    baudRate: number;
    /** Offer every USB device in the chooser, for printers that do not report the printer class. */
    usbShowAll: boolean;
    raster: RasterSettings;
  };
  /** Digital copies guests download by scanning a QR code on their receipt. */
  share: {
    enabled: boolean;
  };
  storage: {
    /** Keep session photos on this device so they can be reprinted. */
    keepPhotos: boolean;
    maxSessions: number;
  };
  admin: {
    pin: string;
  };
  /** Set by the platform owner for every franchise; tablets only show it. */
  platform: {
    name: string;
    /** Small text on the guest screens. */
    watermark: string;
    /** Last line of every receipt. */
    receiptLine: string;
  };
}

export const DEFAULT_PIN = '1234';

export const DEFAULT_SETTINGS: Settings = {
  brand: {
    title: 'Hello Snaply',
    subtitle: 'Foto seru, langsung tercetak ala struk belanja',
    accent: '#c2552d',
  },
  session: {
    countdownSec: 3,
    idleSec: 90,
    mirrorPreview: true,
    mirrorPhoto: false,
    cameraId: '',
    sound: true,
    guestStyles: true,
  },
  frames: {
    active: ['klasik', 'kolase', 'film', 'polaroid', 'nota', 'pesta', 'potret'],
  },
  receipt: {
    title: 'HELLO SNAPLY',
    subtitle: 'Terima kasih sudah mampir!',
    logo: '',
    showMeta: true,
    quoteTitle: 'CATATAN HARI INI',
    quotes: [
      'Senyum hari ini, kenangan selamanya.',
      'Momen kecil, cerita besar.',
      'Bukti sah kita pernah seseru ini.',
      'Total belanja: kenangan tak ternilai.',
    ],
    closing: 'Simpan struk ini baik-baik ya.',
    social: '',
    qrUrl: '',
    qrCaption: 'Scan & follow kami',
    barcode: true,
  },
  // One active price keeps the guest flow to "frame → pay → photo". Turning on
  // a second one adds a choice at the payment step.
  packages: [
    { id: 'satu', name: '1 lembar', description: 'Satu sesi foto, dicetak 1 lembar', price: 15000, prints: 1, active: true },
    {
      id: 'berdua',
      name: '2 lembar',
      description: 'Satu sesi foto, dicetak 2 lembar — bawa pulang berdua',
      price: 25000,
      prints: 2,
      active: false,
    },
  ],
  payment: {
    qris: false,
    qrisAuto: false,
    qrisImage: '',
    cash: true,
    voucher: true,
  },
  printer: {
    transport: 'usb',
    paperWidth: 80,
    dots: 576,
    cut: 'partial',
    feedLines: 3,
    rasterMode: 'gsv0',
    bandRows: 96,
    bandDelayMs: 0,
    bleChunk: 100,
    bleChunkDelayMs: 0,
    bleWrite: 'auto',
    baudRate: 9600,
    usbShowAll: false,
    // Mid-tones are lifted because thermal dots spread; brightness and contrast
    // stay neutral so that light skin tones are not pushed to blank paper.
    raster: {
      brightness: 0,
      contrast: 0,
      gamma: 1.3,
      density: 92,
      detail: 35,
      autoLevels: true,
      dither: 'atkinson',
    },
  },
  // On unless a franchise turns it off: without it no photo reaches the dashboard, and guests get no download.
  share: {
    enabled: true,
  },
  storage: {
    keepPhotos: true,
    maxSessions: 150,
  },
  admin: {
    pin: DEFAULT_PIN,
  },
  platform: {
    name: 'jepretin',
    watermark: 'didukung oleh jepretin',
    receiptLine: '@jepretin',
  },
};

// v2: packages no longer carry a layout, and payment methods were renamed.
const STORAGE_KEY = 'booth.settings.v2';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Overlays saved values on the defaults, so settings saved by an older version
 * pick up new fields and values of the wrong type are dropped rather than trusted.
 */
export function mergeSettings<T>(defaults: T, saved: unknown): T {
  if (isPlainObject(defaults)) {
    if (!isPlainObject(saved)) return defaults;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(defaults)) out[key] = mergeSettings(defaults[key], saved[key]);
    return out as T;
  }
  // Lists (packages, quotes) are taken whole: merging them item by item would resurrect deleted entries.
  if (Array.isArray(defaults)) return Array.isArray(saved) ? (saved as T) : defaults;
  return saved !== null && typeof saved === typeof defaults ? (saved as T) : defaults;
}

function load(): Settings {
  let saved: unknown;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    // Unreadable or corrupted settings: start from defaults rather than fail to boot.
  }
  // Cloned so that editing the settings can never alter the built-in defaults.
  return structuredClone(mergeSettings(DEFAULT_SETTINGS, saved));
}

let current: Settings = load();
const listeners = new Set<() => void>();

// The booth may be open twice on one tablet (the installed app and a Chrome tab). Take over what the
// other one saves, so that a stale copy here never writes old values back over it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    current = load();
    listeners.forEach((listener) => listener());
  });
}

export const settingsStore = {
  get: (): Settings => current,
  /** Applies a change to a copy of the settings, saves it and notifies the UI. */
  update(change: (draft: Settings) => void): void {
    const draft = structuredClone(current);
    change(draft);
    current = draft;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    listeners.forEach((listener) => listener());
  },
  replace(next: unknown): void {
    current = structuredClone(mergeSettings(DEFAULT_SETTINGS, next));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useSettings(): Settings {
  return useStore(settingsStore);
}

export type PaymentChoice = 'qris' | 'cash' | 'voucher';

/**
 * The payment methods to offer. Manual QRIS needs its image; and so that a paid
 * session can always be started, cash stays available when nothing else is on.
 */
export function paymentChoices(payment: Settings['payment']): PaymentChoice[] {
  const choices: PaymentChoice[] = [];
  if (payment.qris && (payment.qrisAuto || payment.qrisImage)) choices.push('qris');
  if (payment.cash) choices.push('cash');
  if (payment.voucher) choices.push('voucher');
  return choices.length > 0 ? choices : ['cash'];
}

export function formatRupiah(amount: number): string {
  return `Rp${Math.round(amount).toLocaleString('id-ID')}`;
}
