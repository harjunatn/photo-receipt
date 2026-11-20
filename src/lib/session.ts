import type { PhotoStyle } from './image/style';
import type { BitImage, Rect } from './image/types';
import type { PayMethod } from './log';
import { composeReceipt, loadImage, loadReceiptFonts, receiptToBits } from './receipt/compose';
import { cropWindow, type Crop } from './receipt/crop';
import type { FrameDef } from './receipt/frames';
import { SHARE_DAYS, shareUrl } from './cloud/shared';
import { makeSlideshow } from './video/slideshow';
import type { PackageDef, Settings } from './settings';

/** One captured photo: the full camera frame plus a small image URL for showing it on screen. */
export interface Shot {
  canvas: HTMLCanvasElement;
  url: string;
  /** How the guest zoomed and moved it in its slot; taking the photo again starts without. */
  crop?: Crop;
}

/** A guest's session while it is in progress. */
export interface Draft {
  frame: FrameDef;
  pkg: PackageDef;
  method: PayMethod;
  voucherCode?: string;
  /** The automatic QRIS payment that paid for this session, if any. */
  paymentId?: string;
  /** false when a cash or static-QRIS session started without staff confirming the payment. */
  staffConfirmed: boolean;
  /** Code of the digital copies the guest downloads; set when that is switched on. */
  shareCode?: string;
  /** true when this session also gets a boomerang and a slideshow video with its download. */
  videos: boolean;
  /** The boomerang as it is being made, from the burst taken after the last photo; null if it failed. */
  boomerang?: Promise<Blob | null>;
  /** One entry per slot of the frame; null until that photo is taken. */
  shots: (Shot | null)[];
  style: PhotoStyle;
  /** Fixed when the session starts, so the preview and the print carry the same date and quote. */
  when: Date;
  quote: string;
}

let cachedLogo: { url: string; image: HTMLImageElement | null } | null = null;

/** The logo is the same for every receipt, so it is decoded once and reused. */
async function loadLogo(url: string): Promise<HTMLImageElement | null> {
  if (!url) return null;
  if (cachedLogo?.url !== url) cachedLogo = { url, image: await loadImage(url).catch(() => null) };
  return cachedLogo.image;
}

function photosOf(draft: Draft) {
  return { photos: draft.shots.map((shot) => shot?.canvas), crops: draft.shots.map((shot) => shot?.crop) };
}

async function composePrint(draft: Draft, sessionNo: number, settings: Settings) {
  await loadReceiptFonts();
  return composeReceipt({
    width: settings.printer.dots,
    frame: draft.frame,
    ...photosOf(draft),
    texts: settings.receipt,
    quote: draft.quote,
    when: draft.when,
    sessionNo,
    logo: await loadLogo(settings.receipt.logo),
    share: draft.shareCode && settings.share.printQr ? { url: shareUrl(draft.shareCode), days: SHARE_DAYS } : undefined,
    platformLine: settings.platform.receiptLine,
  });
}

/** Builds the receipt for a session as printer dots — the same picture for the on-screen preview and the print. */
export async function renderDraft(draft: Draft, sessionNo: number, settings: Settings): Promise<BitImage> {
  const composed = await composePrint(draft, sessionNo, settings);
  return receiptToBits(composed, settings.printer.raster, draft.style);
}

/** The colour copy, as it can be downloaded: same frame and texts, without the download QR code. */
async function composeColour(draft: Draft, sessionNo: number, settings: Settings, width: number) {
  await loadReceiptFonts();
  return composeReceipt({
    width,
    frame: draft.frame,
    ...photosOf(draft),
    texts: settings.receipt,
    quote: draft.quote,
    when: draft.when,
    sessionNo,
    logo: await loadLogo(settings.receipt.logo),
    platformLine: settings.platform.receiptLine,
  });
}

/** A picture on the edit screen, with where each photo sits in it so the guest can tap one. */
export interface EditPreview {
  width: number;
  height: number;
  slots: (Rect | undefined)[];
}

/** Width of the colour picture on the edit screen: sharp enough on a tablet, quick to redraw. */
const COLOUR_PREVIEW_WIDTH = 720;

/** Both pictures the guest sees while editing: the receipt as it prints, and the colour copy. */
export async function renderPreviews(
  draft: Draft,
  sessionNo: number,
  settings: Settings,
): Promise<{ print: EditPreview & { bits: BitImage }; colour: EditPreview & { canvas: HTMLCanvasElement } }> {
  const printed = await composePrint(draft, sessionNo, settings);
  const bits = receiptToBits(printed, settings.printer.raster, draft.style);
  const colour = await composeColour(draft, sessionNo, settings, COLOUR_PREVIEW_WIDTH);
  return {
    print: { bits, width: bits.width, height: bits.height, slots: printed.slotRects },
    colour: { canvas: colour.canvas, width: colour.canvas.width, height: colour.canvas.height, slots: colour.slotRects },
  };
}

/** Width of the digital copy: sharp on a phone, still a reasonable download. */
const DIGITAL_WIDTH = 1080;
/** The dashboard's picture of a session: the first photo alone, large enough to recognise faces. */
const THUMB_WIDTH = 480;

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Foto digital gagal dibuat.'))), 'image/jpeg', quality);
  });
}

/**
 * The session's first photo on its own, cropped the way the guest framed it in
 * its slot, so sessions are easy to tell apart in the dashboard. Without a photo,
 * a small picture of the whole receipt stands in.
 */
function thumbnail(draft: Draft, fallback: HTMLCanvasElement): HTMLCanvasElement {
  const first = draft.shots.findIndex((shot) => shot);
  const shot = first >= 0 ? draft.shots[first] : null;
  const small = document.createElement('canvas');
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  if (!shot) {
    small.width = THUMB_WIDTH;
    small.height = Math.max(1, Math.round((fallback.height * THUMB_WIDTH) / fallback.width));
    ctx.drawImage(fallback, 0, 0, small.width, small.height);
    return small;
  }
  const aspect = draft.frame.slots[first] ?? 4 / 3;
  const win = cropWindow(shot.canvas.width, shot.canvas.height, aspect, shot.crop);
  small.width = THUMB_WIDTH;
  small.height = Math.max(1, Math.round(THUMB_WIDTH / aspect));
  ctx.drawImage(shot.canvas, win.sx, win.sy, win.sw, win.sh, 0, 0, small.width, small.height);
  return small;
}

/**
 * The guest's digital copy: the same frame and texts as the print, but with the
 * photos in full colour and at phone resolution. Plus the first photo on its own
 * for the dashboard's lists. The download QR code itself is left off.
 */
export async function renderDigital(draft: Draft, sessionNo: number, settings: Settings): Promise<{ photo: Blob; thumb: Blob }> {
  const composed = await composeColour(draft, sessionNo, settings, DIGITAL_WIDTH);
  const full = composed.canvas;
  return { photo: await toJpeg(full, 0.9), thumb: await toJpeg(thumbnail(draft, full), 0.82) };
}

/** Width of the colour receipt at the end of the slideshow: it shows 500 pixels wide. */
const SLIDESHOW_RECEIPT_WIDTH = 600;

/**
 * The slideshow video of a session: each photo in colour, framed the way the
 * guest chose in its slot, then the colour receipt. `title` heads every picture.
 */
export async function renderSlideshow(draft: Draft, sessionNo: number, settings: Settings, title: string): Promise<Blob> {
  const photos = draft.shots.flatMap((shot, i) =>
    shot ? [{ source: shot.canvas, window: cropWindow(shot.canvas.width, shot.canvas.height, draft.frame.slots[i] ?? 4 / 3, shot.crop) }] : [],
  );
  const receipt = await composeColour(draft, sessionNo, settings, SLIDESHOW_RECEIPT_WIDTH)
    .then((composed) => composed.canvas)
    .catch(() => null);
  return makeSlideshow({
    photos,
    receipt,
    title,
    accent: settings.brand.accent,
    when: draft.when,
    footer: settings.platform.receiptLine,
  });
}
