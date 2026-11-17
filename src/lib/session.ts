import type { PhotoStyle } from './image/style';
import type { BitImage } from './image/types';
import type { PayMethod } from './log';
import { composeReceipt, loadImage, loadReceiptFonts, receiptToBits } from './receipt/compose';
import type { FrameDef } from './receipt/frames';
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
  });
  return receiptToBits(composed, settings.printer.raster, draft.style);
}
