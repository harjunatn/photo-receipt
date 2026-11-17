import { rasterizeReceipt, type RasterSettings } from '../image/dither';
import type { PhotoStyle } from '../image/style';
import { bitImageToRgba, rgbaToGray, type BitImage } from '../image/types';
import type { Settings } from '../settings';
import type { FrameDef } from './frames';
import { formatDateTime, INK, pad, Page, sessionCode, type ComposedReceipt } from './page';

export { formatDateTime, sessionCode, type ComposedReceipt };

export interface ReceiptInput {
  /** Printable dots per line. */
  width: number;
  frame: FrameDef;
  /** One per slot of the frame; a missing photo prints as an empty slot. */
  photos: (CanvasImageSource | undefined)[];
  texts: Settings['receipt'];
  quote: string;
  when: Date;
  sessionNo: number;
  logo: CanvasImageSource | null;
  /** Only the title and the photos — used for the small pictures of each frame. */
  compact?: boolean;
}

/** Lays out one printed receipt: header, the frame with its photos, quote, QR code and footer. */
export function composeReceipt(input: ReceiptInput): ComposedReceipt {
  const t = input.texts;
  const tallestSlot = Math.min(...input.frame.slots);
  const page = new Page(input.width, Math.ceil(3000 + input.frame.slots.length * (input.width / tallestSlot + 80)));

  page.gap(20);
  if (input.logo) {
    page.image(input.logo, 0.62, 150);
    page.gap(12);
  }
  if (t.title.trim()) page.title(t.title.trim());
  if (t.subtitle.trim() && !input.compact) {
    page.gap(4);
    page.text(t.subtitle.trim(), 22);
  }
  page.gap(12);
  page.dashed();
  if (t.showMeta && !input.compact) {
    page.gap(10);
    page.row(formatDateTime(input.when), `No. ${pad(input.sessionNo, 3)}`, 20);
    page.gap(8);
    page.dashed();
  }
  page.gap(14);

  input.frame.draw(page, input.photos, input.when);

  if (input.compact) {
    page.gap(8);
    return page.finish();
  }

  page.gap(2);
  page.dashed();
  page.gap(14);
  if (input.quote.trim()) {
    if (t.quoteTitle.trim()) {
      page.text(t.quoteTitle.trim(), 20, { bold: true });
      page.gap(6);
    }
    page.text(`“${input.quote.trim()}”`, 22);
    page.gap(14);
  }
  if (t.closing.trim()) {
    page.text(t.closing.trim(), 20);
    page.gap(14);
  }
  if (t.qrUrl.trim()) {
    page.qr(t.qrUrl.trim(), 230);
    if (t.qrCaption.trim()) {
      page.gap(2);
      page.text(t.qrCaption.trim(), 18);
    }
    page.gap(14);
  }
  if (t.social.trim()) {
    page.text(t.social.trim(), 26, { bold: true });
    page.gap(14);
  }
  if (t.barcode) {
    page.barcode(sessionCode(input.when, input.sessionNo));
    page.gap(6);
  }
  page.gap(10);
  return page.finish();
}

/** A page for tuning the printer: width ruler, tone ramp, solid black and a sample photo. */
export function composeTestPage(width: number, sample: CanvasImageSource): ComposedReceipt {
  const page = new Page(width, 2600);
  page.gap(16);
  page.text('TES CETAK', 46, { bold: true });
  page.text(`${width} titik per baris`, 20);
  page.gap(10);
  page.ruler();
  page.gap(4);
  page.text('Garis di atas harus utuh dari tepi kiri sampai kanan.', 17);
  page.gap(12);
  page.dashed();
  page.gap(12);
  page.text('GRADASI PUTIH → HITAM', 18, { bold: true });
  page.gap(6);
  page.ramp(70);
  page.gap(12);
  page.text('HITAM PENUH', 18, { bold: true });
  page.gap(6);
  page.rect(page.margin, page.y, page.inner, page.px(44), INK);
  page.y += page.px(44);
  page.gap(14);
  page.text('CONTOH FOTO', 18, { bold: true });
  page.gap(6);
  page.y += page.photo(sample, page.margin, page.inner, 4 / 3);
  page.gap(12);
  page.text('ABCDEFGHIJKLM NOPQRSTUVWXYZ', 20);
  page.text('abcdefghijklm nopqrstuvwxyz 0123456789', 18);
  page.gap(10);
  page.dashed();
  page.gap(10);
  page.text(formatDateTime(new Date()), 18);
  page.gap(14);
  return page.finish();
}

/** Just one framed photo — used to preview the print-quality settings. */
export function composePhotoOnly(width: number, photo: CanvasImageSource, aspect: number): ComposedReceipt {
  const page = new Page(width, Math.ceil(width / aspect) + 80);
  page.gap(10);
  page.y += page.photo(photo, page.margin, page.inner, aspect);
  page.gap(10);
  return page.finish();
}

/** Converts a composed receipt into the dots the printer will actually put on paper. */
export function receiptToBits(composed: ComposedReceipt, raster: RasterSettings, style: PhotoStyle = 'normal'): BitImage {
  const { width, height } = composed.canvas;
  const ctx = composed.canvas.getContext('2d', { willReadFrequently: true })!;
  const gray = rgbaToGray(ctx.getImageData(0, 0, width, height).data, width, height);
  return rasterizeReceipt(gray, composed.photoRects, raster, style);
}

/** Draws printer dots onto a canvas, for the on-screen preview. */
export function paintBits(canvas: HTMLCanvasElement, bits: BitImage): void {
  canvas.width = bits.width;
  canvas.height = bits.height;
  if (!bits.width || !bits.height) return;
  canvas.getContext('2d')!.putImageData(new ImageData(bitImageToRgba(bits), bits.width, bits.height), 0, 0);
}

export async function loadReceiptFonts(): Promise<void> {
  // Canvas text silently falls back to another font unless the web font is loaded first.
  await Promise.all([document.fonts.load('400 20px "Space Mono"'), document.fonts.load('700 20px "Space Mono"')]);
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gambar tidak bisa dibuka.'));
    img.src = url;
  });
}
