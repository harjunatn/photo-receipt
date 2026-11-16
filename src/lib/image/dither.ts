import { styleRaster, stylizePhoto, type PhotoStyle } from './style';
import { applyTone, type ToneSettings } from './tone';
import { createBitImage, cropGray, type BitImage, type GrayImage, type Rect } from './types';

export type DitherMethod = 'atkinson' | 'floyd-steinberg' | 'ordered' | 'threshold';

const BAYER_8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62,
  30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31,
  55, 23, 61, 29, 53, 21,
];

/**
 * Reduces a grayscale image to black/white dots.
 * Returns one byte per pixel: 1 = black dot, 0 = paper.
 */
export function ditherToDots(img: GrayImage, method: DitherMethod): Uint8Array {
  const { width: w, height: h } = img;
  const dots = new Uint8Array(w * h);

  if (method === 'threshold') {
    for (let i = 0; i < dots.length; i++) dots[i] = img.data[i] < 128 ? 1 : 0;
    return dots;
  }

  if (method === 'ordered') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const limit = ((BAYER_8[(y & 7) * 8 + (x & 7)] + 0.5) * 255) / 64;
        dots[y * w + x] = img.data[y * w + x] < limit ? 1 : 0;
      }
    }
    return dots;
  }

  const buf = Float32Array.from(img.data);

  if (method === 'atkinson') {
    // Atkinson spreads only 6/8 of the error, which keeps highlights clean and
    // shadows crisp — a good match for thermal paper.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const black = buf[i] < 128;
        dots[i] = black ? 1 : 0;
        const err = (buf[i] - (black ? 0 : 255)) / 8;
        if (x + 1 < w) buf[i + 1] += err;
        if (x + 2 < w) buf[i + 2] += err;
        if (y + 1 < h) {
          if (x > 0) buf[i + w - 1] += err;
          buf[i + w] += err;
          if (x + 1 < w) buf[i + w + 1] += err;
        }
        if (y + 2 < h) buf[i + 2 * w] += err;
      }
    }
    return dots;
  }

  // Floyd–Steinberg, alternating direction per row to avoid diagonal streaks.
  for (let y = 0; y < h; y++) {
    const dir = y % 2 === 0 ? 1 : -1;
    for (let step = 0; step < w; step++) {
      const x = dir === 1 ? step : w - 1 - step;
      const i = y * w + x;
      const black = buf[i] < 128;
      dots[i] = black ? 1 : 0;
      const err = buf[i] - (black ? 0 : 255);
      const ahead = x + dir >= 0 && x + dir < w;
      const behind = x - dir >= 0 && x - dir < w;
      if (ahead) buf[i + dir] += (err * 7) / 16;
      if (y + 1 < h) {
        if (behind) buf[i + w - dir] += (err * 3) / 16;
        buf[i + w] += (err * 5) / 16;
        if (ahead) buf[i + w + dir] += err / 16;
      }
    }
  }
  return dots;
}

export interface RasterSettings extends ToneSettings {
  dither: DitherMethod;
}

/** Gray level below which text and line art print as solid black. */
const INK_THRESHOLD = 160;

/**
 * Turns a composed receipt into printable dots. Text and line art are
 * thresholded so they stay solid; only the photo rectangles are tone-mapped
 * and dithered, each on its own so dither noise never bleeds into the text.
 * `style` is the look the guest picked for the photos.
 */
export function rasterizeReceipt(
  gray: GrayImage,
  photoRects: Rect[],
  settings: RasterSettings,
  style: PhotoStyle = 'normal',
): BitImage {
  const { width, height } = gray;
  const dots = new Uint8Array(width * height);
  for (let i = 0; i < dots.length; i++) dots[i] = gray.data[i] < INK_THRESHOLD ? 1 : 0;

  const styled = styleRaster(settings, style);
  for (const rect of photoRects) {
    const x = Math.max(0, Math.round(rect.x));
    const y = Math.max(0, Math.round(rect.y));
    const w = Math.min(width - x, Math.round(rect.w));
    const h = Math.min(height - y, Math.round(rect.h));
    if (w <= 0 || h <= 0) continue;
    const photo = applyTone(stylizePhoto(cropGray(gray, { x, y, w, h }), style), styled);
    const photoDots = ditherToDots(photo, styled.dither);
    for (let row = 0; row < h; row++) {
      dots.set(photoDots.subarray(row * w, (row + 1) * w), (y + row) * width + x);
    }
  }
  return packDots(dots, width, height);
}

/** Packs one-byte-per-pixel dots into printer rows. */
export function packDots(dots: Uint8Array, width: number, height: number): BitImage {
  const img = createBitImage(width, height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * img.bytesPerRow;
    for (let x = 0; x < width; x++) {
      if (dots[y * width + x]) img.data[rowStart + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return img;
}
