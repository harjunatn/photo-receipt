import type { RasterSettings } from './dither';
import { boxBlur } from './tone';
import type { GrayImage } from './types';

/** A look the guest can pick for their photos before printing. */
export type PhotoStyle = 'normal' | 'bright' | 'contrast' | 'comic' | 'sketch' | 'outline';

export const PHOTO_STYLES: { id: PhotoStyle; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'bright', label: 'Cerah' },
  { id: 'contrast', label: 'Kontras' },
  { id: 'comic', label: 'Komik' },
  { id: 'sketch', label: 'Sketsa' },
  { id: 'outline', label: 'Garis' },
];

/** Tone settings for drawings: the stylized image is already final, so nothing is corrected. */
const DRAWING: Omit<RasterSettings, 'dither'> = {
  brightness: 0,
  contrast: 0,
  gamma: 1,
  density: 100,
  detail: 0,
  autoLevels: false,
};

/** The print settings for a style, starting from the operator's own tuning. */
export function styleRaster(base: RasterSettings, style: PhotoStyle): RasterSettings {
  switch (style) {
    case 'bright':
      return { ...base, brightness: base.brightness + 14, gamma: base.gamma + 0.2 };
    case 'contrast':
      return { ...base, contrast: base.contrast + 35, density: 100, detail: Math.min(100, base.detail + 25) };
    case 'comic':
      return { ...base, contrast: base.contrast + 20, detail: Math.min(100, base.detail + 20), dither: 'ordered' };
    case 'sketch':
      return { ...DRAWING, dither: 'atkinson' };
    case 'outline':
      return { ...DRAWING, dither: 'threshold' };
    default:
      return base;
  }
}

/**
 * Pencil sketch: each pixel is compared with its blurred surroundings, so flat
 * areas turn to white paper and only edges and darker details keep "graphite".
 */
function sketch(img: GrayImage): GrayImage {
  const { width, height } = img;
  const source = Float32Array.from(img.data);
  const blurred = boxBlur(source, width, height, Math.max(2, Math.round(width / 70)));
  const data = new Uint8ClampedArray(source.length);
  for (let i = 0; i < data.length; i++) {
    const dodge = Math.min(1, source[i] / Math.max(1, blurred[i]));
    // Raising to a power deepens the faint lines so they survive on thermal paper.
    data[i] = 255 * Math.pow(dodge, 2.6);
  }
  return { width, height, data };
}

/** Bold line drawing: black where brightness changes sharply, white everywhere else. */
function outline(img: GrayImage): GrayImage {
  const { width: w, height: h } = img;
  // A light blur first, so camera noise is not drawn as specks.
  const smooth = boxBlur(Float32Array.from(img.data), w, h, 1);
  const at = (x: number, y: number) => smooth[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const threshold = 44;
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      if (Math.abs(gx) + Math.abs(gy) > threshold * 4) edge[y * w + x] = 1;
    }
  }
  // Thicken every line by a pixel: single-dot lines print faint and broken.
  const data = new Uint8ClampedArray(w * h).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edge[y * w + x]) continue;
      data[y * w + x] = 0;
      if (x + 1 < w) data[y * w + x + 1] = 0;
      if (y + 1 < h) data[(y + 1) * w + x] = 0;
    }
  }
  return { width: w, height: h, data };
}

/** Redraws a photo in the given style. Styles that only change tone return the photo as it is. */
export function stylizePhoto(img: GrayImage, style: PhotoStyle): GrayImage {
  if (style === 'sketch') return sketch(img);
  if (style === 'outline') return outline(img);
  return img;
}
