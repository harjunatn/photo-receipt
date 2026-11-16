import { describe, expect, it } from 'vitest';
import { ditherToDots, packDots, rasterizeReceipt, type DitherMethod, type RasterSettings } from '../src/lib/image/dither';
import { applyTone, boxBlur, buildToneLut, type ToneSettings } from '../src/lib/image/tone';
import { getDot, rgbaToGray, type GrayImage } from '../src/lib/image/types';

const NEUTRAL: ToneSettings = { brightness: 0, contrast: 0, gamma: 1, density: 100, detail: 0, autoLevels: false };
const METHODS: DitherMethod[] = ['atkinson', 'floyd-steinberg', 'ordered', 'threshold'];

function flat(width: number, height: number, value: number): GrayImage {
  return { width, height, data: new Uint8ClampedArray(width * height).fill(value) };
}

function inkShare(dots: Uint8Array): number {
  return dots.reduce((sum, d) => sum + d, 0) / dots.length;
}

describe('rgbaToGray', () => {
  it('treats transparent pixels as white paper', () => {
    const gray = rgbaToGray([0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255], 3, 1);
    expect(Array.from(gray.data)).toEqual([255, 0, 255]);
  });
});

describe('ditherToDots', () => {
  it.each(METHODS)('%s leaves white blank and black solid', (method) => {
    expect(inkShare(ditherToDots(flat(40, 40, 255), method))).toBe(0);
    expect(inkShare(ditherToDots(flat(40, 40, 0), method))).toBe(1);
  });

  it.each(['floyd-steinberg', 'ordered'] as DitherMethod[])('%s prints mid-gray as about half ink', (method) => {
    const share = inkShare(ditherToDots(flat(96, 96, 128), method));
    expect(share).toBeGreaterThan(0.44);
    expect(share).toBeLessThan(0.56);
  });

  it.each(['atkinson', 'floyd-steinberg', 'ordered'] as DitherMethod[])('%s gets darker as the tone gets darker', (method) => {
    const shares = [224, 176, 128, 80, 32].map((v) => inkShare(ditherToDots(flat(96, 96, v), method)));
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeGreaterThan(shares[i - 1]);
  });
});

describe('packDots', () => {
  it('packs most-significant-bit first and pads each row to a byte', () => {
    // 10 px wide: dots at x = 0, 7, 9 on row 0 and x = 8 on row 1.
    const dots = new Uint8Array(20);
    dots[0] = dots[7] = dots[9] = 1;
    dots[18] = 1;
    const img = packDots(dots, 10, 2);
    expect(img.bytesPerRow).toBe(2);
    expect(Array.from(img.data)).toEqual([0b10000001, 0b01000000, 0b00000000, 0b10000000]);
    expect(getDot(img, 9, 0)).toBe(true);
    expect(getDot(img, 8, 0)).toBe(false);
  });
});

describe('tone', () => {
  it('is the identity when every control is neutral', () => {
    const lut = buildToneLut(NEUTRAL);
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v);
  });

  it('brightens mid-tones with gamma above 1 but keeps the end points', () => {
    const lut = buildToneLut({ ...NEUTRAL, gamma: 1.5 });
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(lut[128]).toBeGreaterThan(150);
  });

  it('never decreases as the input gets lighter', () => {
    const lut = buildToneLut({ ...NEUTRAL, brightness: 20, contrast: 40, gamma: 1.3 });
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
  });

  it('caps how dark black can get with density', () => {
    const out = applyTone(flat(8, 8, 0), { ...NEUTRAL, density: 80 });
    expect(out.data[0]).toBe(51);
    expect(applyTone(flat(8, 8, 255), { ...NEUTRAL, density: 80 }).data[0]).toBe(255);
  });

  it('stretches a low-contrast photo with auto levels', () => {
    const img = flat(20, 20, 100);
    for (let i = 0; i < 200; i++) img.data[i] = 150;
    const out = applyTone(img, { ...NEUTRAL, autoLevels: true });
    expect(out.data[399]).toBeLessThan(40);
    expect(out.data[0]).toBeGreaterThan(210);
  });

  it('leaves a flat image flat when detail is on', () => {
    const out = applyTone(flat(32, 32, 90), { ...NEUTRAL, detail: 100 });
    expect(new Set(out.data).size).toBe(1);
    expect(out.data[0]).toBe(90);
  });

  it('box blur preserves a constant field and averages a step edge', () => {
    const constant = boxBlur(new Float32Array(25).fill(7), 5, 5, 2);
    expect(Array.from(constant).every((v) => Math.abs(v - 7) < 1e-4)).toBe(true);
    const step = new Float32Array(9);
    step[2] = step[5] = step[8] = 90;
    const blurred = boxBlur(step, 3, 3, 1);
    expect(blurred[4]).toBeCloseTo(30, 3);
  });
});

describe('rasterizeReceipt', () => {
  const settings: RasterSettings = { ...NEUTRAL, dither: 'floyd-steinberg' };

  it('thresholds text areas and dithers only inside photo rectangles', () => {
    // Left half is a "photo" of mid-gray, right half is light-gray "paper" with one black bar.
    const img = flat(64, 32, 200);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) img.data[y * 64 + x] = 128;
      img.data[y * 64 + 40] = 0;
    }
    const bits = rasterizeReceipt(img, [{ x: 0, y: 0, w: 32, h: 32 }], settings);

    let photoInk = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) if (getDot(bits, x, y)) photoInk++;
      for (let x = 32; x < 64; x++) expect(getDot(bits, x, y)).toBe(x === 40);
    }
    expect(photoInk / (32 * 32)).toBeGreaterThan(0.4);
    expect(photoInk / (32 * 32)).toBeLessThan(0.6);
  });

  it('ignores photo rectangles that fall outside the image', () => {
    const bits = rasterizeReceipt(flat(16, 16, 255), [{ x: 12, y: 12, w: 40, h: 40 }, { x: 90, y: 0, w: 5, h: 5 }], settings);
    expect(bits.data.every((b) => b === 0)).toBe(true);
  });
});
