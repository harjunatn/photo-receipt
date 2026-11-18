import type { PhotoStyle } from './image/style';
import type { BitImage } from './image/types';
import type { PayMethod } from './log';
import { composeReceipt, loadImage, loadReceiptFonts, receiptToBits } from './receipt/compose';
import type { FrameDef } from './receipt/frames';
import { SHARE_DAYS, shareUrl } from './cloud/shared';
import type { PackageDef, Settings } from './settings';

/** One captured photo: the full camera frame plus a small image URL for showing it on screen. */
export interface Shot {
  canvas: HTMLCanvasElement;
  url: string;
}

/** A guest's session while it is in progress. */
export interface Draft {
  frame: FrameDef;
  pkg: PackageDef;
  method: PayMethod;
  voucherCode?: string;
  /** The automatic QRIS payment that paid for this session, if any. */
  paymentId?: string;
  /** Code of the digital copies the guest downloads; set when that is switched on. */
  shareCode?: string;
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

/** Builds the receipt for a session as printer dots — the same picture for the on-screen preview and the print. */
export async function renderDraft(draft: Draft, sessionNo: number, settings: Settings): Promise<BitImage> {
  await loadReceiptFonts();
  const composed = composeReceipt({
    width: settings.printer.dots,
    frame: draft.frame,
    photos: draft.shots.map((shot) => shot?.canvas),
    texts: settings.receipt,
    quote: draft.quote,
    when: draft.when,
    sessionNo,
    logo: await loadLogo(settings.receipt.logo),
    share: draft.shareCode ? { url: shareUrl(draft.shareCode), days: SHARE_DAYS } : undefined,
  });
  return receiptToBits(composed, settings.printer.raster, draft.style);
}

/** Width of the digital copy: sharp on a phone, still a reasonable download. */
const DIGITAL_WIDTH = 1080;
const THUMB_WIDTH = 240;

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Foto digital gagal dibuat.'))), 'image/jpeg', quality);
  });
}

/**
 * The guest's digital copy: the same frame and texts as the print, but with the
 * photos in full colour and at phone resolution. Plus a small picture of it for
 * lists. The download QR code itself is left off.
 */
export async function renderDigital(draft: Draft, sessionNo: number, settings: Settings): Promise<{ photo: Blob; thumb: Blob }> {
  await loadReceiptFonts();
  const composed = composeReceipt({
    width: DIGITAL_WIDTH,
    frame: draft.frame,
    photos: draft.shots.map((shot) => shot?.canvas),
    texts: settings.receipt,
    quote: draft.quote,
    when: draft.when,
    sessionNo,
    logo: await loadLogo(settings.receipt.logo),
  });
  const full = composed.canvas;
  const small = document.createElement('canvas');
  small.width = THUMB_WIDTH;
  small.height = Math.max(1, Math.round((full.height * THUMB_WIDTH) / full.width));
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, small.width, small.height);
  return { photo: await toJpeg(full, 0.9), thumb: await toJpeg(small, 0.8) };
}
