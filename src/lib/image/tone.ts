import type { GrayImage } from './types';

/**
 * Tone controls applied to photos before dithering. Thermal paper prints darker
 * than a screen shows (dots spread with heat), so the defaults lift mid-tones.
 */
export interface ToneSettings {
  /** -100..100. Shifts every tone lighter or darker. */
  brightness: number;
  /** -100..100. */
  contrast: number;
  /** 0.5..2.5. Above 1 brightens mid-tones without clipping highlights. */
  gamma: number;
  /** 40..100. Percent of full black the darkest areas may reach; lower avoids solid black blocks. */
  density: number;
  /** 0..100. Local contrast plus sharpening so faces keep detail after dithering. */
  detail: number;
  /** Stretch the darkest/brightest tones of each photo to the full range first. */
  autoLevels: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Finds the tones at the 0.5% and 99.5% points of the histogram. */
export function levelBounds(img: GrayImage): { lo: number; hi: number } {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < img.data.length; i++) histogram[img.data[i]]++;
  const cut = img.data.length * 0.005;

  let lo = 0;
  for (let sum = 0; lo < 255; lo++) {
    sum += histogram[lo];
    if (sum > cut) break;
  }
  let hi = 255;
  for (let sum = 0; hi > 0; hi--) {
    sum += histogram[hi];
    if (sum > cut) break;
  }
  // Keep the stretch moderate: a flat or very dark frame should not be blown up into noise.
  lo = Math.min(lo, 96);
  hi = Math.max(hi, 160);
  return { lo, hi };
}

/** Lookup table for levels → gamma → contrast → brightness. */
export function buildToneLut(t: ToneSettings, lo = 0, hi = 255): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const range = Math.max(1, hi - lo);
  const gain = t.contrast >= 0 ? 1 + t.contrast / 50 : 1 + t.contrast / 100;
  const offset = t.brightness / 200;
  const invGamma = 1 / Math.max(0.1, t.gamma);
  for (let v = 0; v < 256; v++) {
    let x = clamp01((v - lo) / range);
    x = Math.pow(x, invGamma);
    x = (x - 0.5) * gain + 0.5 + offset;
    lut[v] = clamp01(x) * 255;
  }
  return lut;
}

/** Separable box blur with clamped edges, O(pixels) regardless of radius. */
export function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius < 1) return src.slice();
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[row + Math.min(width - 1, Math.max(0, k))];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / span;
      sum += src[row + Math.min(width - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(height - 1, Math.max(0, k)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / span;
      sum += tmp[Math.min(height - 1, y + radius + 1) * width + x] - tmp[Math.max(0, y - radius) * width + x];
    }
  }
  return out;
}

/** Returns a new image with the tone settings applied. */
export function applyTone(img: GrayImage, t: ToneSettings): GrayImage {
  const { width, height } = img;
  const { lo, hi } = t.autoLevels ? levelBounds(img) : { lo: 0, hi: 255 };
  const lut = buildToneLut(t, lo, hi);

  let work = new Float32Array(img.data.length);
  for (let i = 0; i < work.length; i++) work[i] = lut[img.data[i]];

  if (t.detail > 0) {
    const strength = t.detail / 100;
    // Wide-radius pass restores local contrast (faces against backgrounds)…
    const wide = boxBlur(work, width, height, Math.max(4, Math.round(width / 24)));
    for (let i = 0; i < work.length; i++) work[i] += (work[i] - wide[i]) * 0.5 * strength;
    // …and a tight pass sharpens edges that dithering would otherwise soften.
    const tight = boxBlur(work, width, height, 1);
    const sharpened = new Float32Array(work.length);
    for (let i = 0; i < work.length; i++) sharpened[i] = work[i] + (work[i] - tight[i]) * 0.9 * strength;
    work = sharpened;
  }

  const density = Math.min(100, Math.max(0, t.density)) / 100;
  const data = new Uint8ClampedArray(work.length);
  for (let i = 0; i < work.length; i++) {
    const v = work[i] < 0 ? 0 : work[i] > 255 ? 255 : work[i];
    data[i] = 255 - (255 - v) * density;
  }
  return { width, height, data };
}
