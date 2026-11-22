import { drawNewspaper, loadNewsFonts } from './newspaper';
import type { PhotoStyle } from './image/style';
import type { BitImage, Rect } from './image/types';
import type { PayMethod } from './log';
import { composeReceipt, loadImage, loadReceiptFonts, receiptToBits } from './receipt/compose';
import { cropWindow, type Crop } from './receipt/crop';
import type { FrameDef } from './receipt/frames';
import { SHARE_DAYS, shareUrl } from './cloud/shared';
import { canEncode } from './video/encode';
import { blocksUp, FRAME_BOOMERANG, frameBoomerangBitrate, frameBoomerangWidths, makeFrameBoomerang } from './video/frameBoomerang';
import { makeSlideshow } from './video/slideshow';
import type { PackageDef, Settings } from './settings';

/** One captured photo: the full camera frame plus a small image URL for showing it on screen. */
export interface Shot {
  canvas: HTMLCanvasElement;
  url: string;
  /** How the guest zoomed and moved it in its slot; taking the photo again starts without. */
  crop?: Crop;
  /**
   * The camera around the moment this photo was taken, for the boomerang inside the frame: a burst
   * of small pictures, not mirrored (the photo itself may be). null when it failed.
   */
  burst?: Promise<ImageBitmap[] | null>;
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

/**
 * The colour copy, as it can be downloaded: same frame and texts, without the download QR code.
 * `photos` stands in for the guest's photos when given.
 */
async function composeColour(draft: Draft, sessionNo: number, settings: Settings, width: number, photos = photosOf(draft)) {
  await loadReceiptFonts();
  return composeReceipt({
    width,
    frame: draft.frame,
    ...photos,
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

/**
 * The session as a newspaper front page, for the guest to download: the place
 * staff set as the headline, the photos as taken (not cut to the frame's
 * slots, so everyone stays in the picture), and the booth's name on top.
 */
export async function renderNewspaper(draft: Draft, sessionNo: number, settings: Settings, title: string): Promise<Blob> {
  await loadNewsFonts();
  const page = drawNewspaper({
    headline: settings.news.headline.trim() || title,
    brand: title,
    when: draft.when,
    sessionNo,
    photos: draft.shots.flatMap((shot) => (shot ? [shot.canvas] : [])),
    footer: settings.platform.receiptLine,
  });
  return toJpeg(page, 0.88);
}

/** Longest side of a photo sent without its frame; enough for the AI service, small enough to upload in a moment. */
const PLAIN_LONG_SIDE = 1280;
/** The download page offers at most this many photos to pick from. */
export const PLAIN_PHOTOS_MAX = 6;

/**
 * The session's photos without the frame, each cut the way the guest cut it
 * for its place in the frame. The AI version on the download page is drawn
 * from one of these: sent with the frame, the AI would redraw the frame too.
 */
export async function renderPlainPhotos(draft: Draft): Promise<Blob[]> {
  const photos: Blob[] = [];
  for (let i = 0; i < draft.shots.length && photos.length < PLAIN_PHOTOS_MAX; i++) {
    const shot = draft.shots[i];
    if (!shot) continue;
    const win = cropWindow(shot.canvas.width, shot.canvas.height, draft.frame.slots[i] ?? 4 / 3, shot.crop);
    const scale = Math.min(1, PLAIN_LONG_SIDE / Math.max(win.sw, win.sh));
    const plain = document.createElement('canvas');
    plain.width = Math.max(1, Math.round(win.sw * scale));
    plain.height = Math.max(1, Math.round(win.sh * scale));
    const ctx = plain.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(shot.canvas, win.sx, win.sy, win.sw, win.sh, 0, 0, plain.width, plain.height);
    photos.push(await toJpeg(plain, 0.86));
  }
  return photos;
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

/**
 * The boomerang inside the frame: the colour receipt with every photo moving,
 * from the bursts kept while the photos were taken. null when there are no
 * bursts, or when this tablet cannot encode a video of any useful size. The
 * bursts are released afterwards either way.
 */
export async function renderFrameBoomerang(draft: Draft, sessionNo: number, settings: Settings): Promise<Blob | null> {
  const bursts = await Promise.all(draft.shots.map((shot) => shot?.burst ?? Promise.resolve(null)));
  try {
    if (!bursts.some((burst) => burst && burst.length > 0)) return null;
    // Solid stand-ins for the photos, one canvas each: the page tells the photos apart by which canvas they are.
    const solid = (colour: string) => {
      const photos = draft.shots.map((shot) => {
        const canvas = document.createElement('canvas');
        canvas.width = shot?.canvas.width ?? 4;
        canvas.height = shot?.canvas.height ?? 3;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas;
      });
      return { photos, crops: draft.shots.map((shot) => shot?.crop) };
    };
    const black = solid('#000');
    const first = await composeColour(draft, sessionNo, settings, FRAME_BOOMERANG.width, black);
    for (const width of frameBoomerangWidths(FRAME_BOOMERANG.width, first.canvas.height)) {
      const dark = width === FRAME_BOOMERANG.width ? first : await composeColour(draft, sessionNo, settings, width, black);
      const height = blocksUp(dark.canvas.height);
      if (!(await canEncode(width, height, FRAME_BOOMERANG.fps, frameBoomerangBitrate(width, height)))) continue;
      const light = await composeColour(draft, sessionNo, settings, width, solid('#fff'));
      const slots = draft.shots.flatMap((shot, i) => {
        const rect = dark.slotRects[i];
        return shot && rect ? [{ rect, pictures: bursts[i], still: shot.canvas, crop: shot.crop }] : [];
      });
      return await makeFrameBoomerang({ black: dark.canvas, white: light.canvas, slots, mirror: settings.session.mirrorPhoto });
    }
    return null;
  } finally {
    bursts.forEach((burst) => burst?.forEach((picture) => picture.close()));
  }
}
