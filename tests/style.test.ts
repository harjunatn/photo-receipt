import { describe, expect, it } from 'vitest';
import { rasterizeReceipt, type RasterSettings } from '../src/lib/image/dither';
import { PHOTO_STYLES, styleRaster, stylizePhoto } from '../src/lib/image/style';
import { getDot, type GrayImage } from '../src/lib/image/types';

const BASE: RasterSettings = {
  brightness: 0,
  contrast: 0,
  gamma: 1.3,
  density: 92,
  detail: 35,
  autoLevels: true,
  dither: 'atkinson',
};

function flat(width: number, height: number, value: number): GrayImage {
  return { width, height, data: new Uint8ClampedArray(width * height).fill(value) };
}

/** Left half dark, right half light: one vertical edge down the middle. */
function split(width: number, height: number): GrayImage {
  const img = flat(width, height, 210);
  for (let y = 0; y < height; y++) for (let x = 0; x < width / 2; x++) img.data[y * width + x] = 50;
  return img;
}

describe('styleRaster', () => {
  it('leaves the operator tuning alone for the normal style', () => {
    expect(styleRaster(BASE, 'normal')).toBe(BASE);
  });

  it('never changes the settings it was given', () => {
    const before = structuredClone(BASE);
    for (const { id } of PHOTO_STYLES) styleRaster(BASE, id);
    expect(BASE).toEqual(before);
  });

  it('builds each look on top of the operator tuning', () => {
    expect(styleRaster(BASE, 'bright').gamma).toBeGreaterThan(BASE.gamma);
    expect(styleRaster(BASE, 'bright').brightness).toBeGreaterThan(BASE.brightness);
    expect(styleRaster(BASE, 'contrast')).toMatchObject({ density: 100, dither: 'atkinson' });
    expect(styleRaster(BASE, 'contrast').contrast).toBeGreaterThan(BASE.contrast);
    expect(styleRaster(BASE, 'comic').dither).toBe('ordered');
  });

  it('prints drawings as they are, without tone correction', () => {
    for (const style of ['sketch', 'outline'] as const) {
      expect(styleRaster({ ...BASE, brightness: 30, contrast: 30 }, style)).toMatchObject({
        brightness: 0,
        contrast: 0,
        gamma: 1,
        density: 100,
        detail: 0,
        autoLevels: false,
      });
    }
    expect(styleRaster(BASE, 'outline').dither).toBe('threshold');
  });
});

describe('stylizePhoto', () => {
  it('returns tone-only styles untouched', () => {
    const img = split(16, 16);
    for (const style of ['normal', 'bright', 'contrast', 'comic'] as const) expect(stylizePhoto(img, style)).toBe(img);
  });

  it('turns flat areas into blank paper in a sketch', () => {
    for (const tone of [40, 128, 230]) {
      expect(stylizePhoto(flat(40, 40, tone), 'sketch').data.every((v) => v === 255)).toBe(true);
    }
  });

  it('keeps graphite only near an edge in a sketch', () => {
    const out = stylizePhoto(split(140, 20), 'sketch');
    const row = (x: number) => out.data[10 * 140 + x];
    expect(row(68)).toBeLessThan(200); // dark side, right at the edge
    expect(row(5)).toBe(255); // far inside the dark area
    expect(row(135)).toBe(255); // far inside the light area
  });

  it('draws an outline along an edge and nothing elsewhere', () => {
    const out = stylizePhoto(split(60, 20), 'outline');
    const row = (x: number) => out.data[10 * 60 + x];
    expect(row(30)).toBe(0);
    expect(row(8)).toBe(255);
    expect(row(52)).toBe(255);
    expect(stylizePhoto(flat(30, 30, 90), 'outline').data.every((v) => v === 255)).toBe(true);
  });

  it('does not alter the photo it was given', () => {
    const img = split(40, 20);
    const copy = img.data.slice();
    stylizePhoto(img, 'sketch');
    stylizePhoto(img, 'outline');
    expect(img.data).toEqual(copy);
  });
});

describe('rasterizeReceipt with a style', () => {
  it('applies the style inside photo areas only', () => {
    // A mid-gray "photo" on the left, and a black bar of "text" on white paper on the right.
    const img = flat(80, 40, 255);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) img.data[y * 80 + x] = 128;
      img.data[y * 80 + 60] = 0;
    }
    const photo = [{ x: 0, y: 0, w: 40, h: 40 }];
    const inkIn = (style: Parameters<typeof rasterizeReceipt>[3]) => {
      const bits = rasterizeReceipt(img, photo, { ...BASE, autoLevels: false }, style);
      let ink = 0;
      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 40; x++) if (getDot(bits, x, y)) ink++;
        for (let x = 40; x < 80; x++) expect(getDot(bits, x, y)).toBe(x === 60);
      }
      return ink;
    };
    expect(inkIn('normal')).toBeGreaterThan(200);
    // A flat photo has no edges, so as a line drawing it prints blank.
    expect(inkIn('outline')).toBe(0);
    expect(inkIn('sketch')).toBe(0);
  });
});
