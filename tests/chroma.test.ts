import { describe, expect, it } from 'vitest';
import { cutKeyedFrame, findKeyColour, hasTransparency, keyMask, TOLERANCE, type Rgb } from '../src/lib/receipt/chroma';

const W = 200;
const H = 420;
const GREEN: Rgb = [0, 255, 0];

/** A frame saved as JPG: white paper, a black border, photo areas in a solid colour with JPG-like noise and soft edges. */
function jpgFrame(key: Rgb = GREEN) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 31) - 15;
  };
  const put = (x: number, y: number, [r, g, b]: Rgb) => rgba.set([r, g, b, 255], (y * W + x) * 4);
  const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] * t + b[i] * (1 - t))) as unknown as Rgb;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, [255, 255, 255]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 4 || y < 4 || x >= W - 4 || y >= H - 4) put(x, y, [0, 0, 0]);
  for (const [top, bottom] of [[30, 149], [200, 319]]) {
    for (let y = top; y <= bottom; y++) {
      for (let x = 20; x <= 179; x++) put(x, y, [key[0] + noise(), key[1] + noise(), key[2] + noise()].map((v) => Math.max(0, Math.min(255, v))) as unknown as Rgb);
    }
    // The soft edge JPG leaves: a row that is mostly the colour, partly the paper.
    for (let x = 20; x <= 179; x++) {
      put(x, top - 1, mix(key, [255, 255, 255], 0.6));
      put(x, bottom + 1, mix(key, [255, 255, 255], 0.6));
    }
  }
  // A thin black line just under the first photo, which must survive.
  for (let y = 152; y <= 154; y++) for (let x = 20; x <= 179; x++) put(x, y, [0, 0, 0]);
  // A small detail in the same colour, which is not a photo.
  for (let y = 380; y < 384; y++) for (let x = 100; x < 104; x++) put(x, y, key);
  return rgba;
}

const alpha = (rgba: Uint8ClampedArray, x: number, y: number) => rgba[(y * W + x) * 4 + 3];

describe('frames marked with a colour', () => {
  it('finds the colour that marks the photos, and knows a JPG has no transparent holes', () => {
    const frame = jpgFrame();
    expect(hasTransparency(frame)).toBe(false);
    expect(findKeyColour(frame, W, H)).toEqual(GREEN);
    expect(findKeyColour(jpgFrame([255, 0, 255]), W, H)).toEqual([255, 0, 255]);
  });

  it('finds nothing in a frame without a marking colour', () => {
    const plain = new Uint8ClampedArray(W * H * 4).fill(255);
    expect(findKeyColour(plain, W, H)).toBeNull();
  });

  it('cuts out the photo areas, soft edges included, top to bottom', () => {
    const { rgba, found } = cutKeyedFrame(jpgFrame(), W, H, GREEN, TOLERANCE.medium);
    expect(found.slots).toHaveLength(2);
    expect(found.slots[0].y).toBeLessThan(found.slots[1].y);
    // The photo area and its soft edge are see-through.
    expect(alpha(rgba, 100, 90)).toBe(0);
    expect(alpha(rgba, 100, 29)).toBe(0);
    expect(alpha(rgba, 100, 150)).toBe(0);
    // The slot covers the whole marked area.
    expect(found.slots[0].x).toBeLessThanOrEqual(20);
    expect(found.slots[0].x + found.slots[0].w).toBeGreaterThanOrEqual(180);
  });

  it('leaves the design alone: lines next to a photo, the paper, and small details in the same colour', () => {
    const { rgba } = cutKeyedFrame(jpgFrame(), W, H, GREEN, TOLERANCE.medium);
    expect(alpha(rgba, 100, 153)).toBe(255);
    expect(alpha(rgba, 10, 10)).toBe(255);
    expect(alpha(rgba, 101, 381)).toBe(255);
    expect(Array.from(rgba.subarray((381 * W + 101) * 4, (381 * W + 101) * 4 + 3))).toEqual([0, 255, 0]);
  });

  it('takes more of a blurred edge at a higher sensitivity', () => {
    const frame = jpgFrame();
    const count = (mask: Uint8Array) => mask.reduce((sum, v) => sum + v, 0);
    expect(count(keyMask(frame, W, H, GREEN, TOLERANCE.high))).toBeGreaterThanOrEqual(count(keyMask(frame, W, H, GREEN, TOLERANCE.low)));
  });
});
