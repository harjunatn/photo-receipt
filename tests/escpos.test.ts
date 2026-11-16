import { describe, expect, it } from 'vitest';
import { createBitImage, getDot, setDot, type BitImage } from '../src/lib/image/types';
import { decodeJob } from '../src/lib/printer/decode';
import { concatBytes, encodeJob, type JobOptions } from '../src/lib/printer/escpos';

const BASE: JobOptions = { rasterMode: 'gsv0', bandRows: 64, feedLines: 0, cut: 'none' };

/** Deterministic noise so failures are reproducible. */
function noiseImage(width: number, height: number, seed = 7): BitImage {
  const img = createBitImage(width, height);
  let state = seed;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      if (state % 3 === 0) setDot(img, x, y);
    }
  }
  return img;
}

function expectSameDots(actual: BitImage, expected: BitImage, rows = expected.height) {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < expected.width; x++) {
      if (getDot(actual, x, y) !== getDot(expected, x, y)) {
        throw new Error(`dot mismatch at ${x},${y}`);
      }
    }
  }
}

describe('encodeJob (GS v 0)', () => {
  it('starts by resetting the printer', () => {
    const [init] = encodeJob(noiseImage(16, 4), BASE);
    expect(Array.from(init)).toEqual([0x1b, 0x40]);
  });

  it('writes the band header as bytes-per-row and row count, little-endian', () => {
    const img = noiseImage(576, 300);
    const segments = encodeJob(img, { ...BASE, bandRows: 300 });
    expect(Array.from(segments[1].subarray(0, 8))).toEqual([0x1d, 0x76, 0x30, 0x00, 72, 0, 300 & 0xff, 300 >> 8]);
    expect(segments[1].length).toBe(8 + 72 * 300);
  });

  it('splits the image into bands and survives a round trip', () => {
    const img = noiseImage(384, 150);
    const segments = encodeJob(img, { ...BASE, bandRows: 64 });
    expect(segments).toHaveLength(1 + 3); // init + bands of 64, 64, 22 rows
    const decoded = decodeJob(concatBytes(segments));
    expect(decoded.unknownBytes).toBe(0);
    expect(decoded.image.height).toBe(150);
    expectSameDots(decoded.image, img);
  });

  it('round-trips a width that is not a multiple of 8', () => {
    const img = noiseImage(203, 37);
    const decoded = decodeJob(concatBytes(encodeJob(img, BASE)));
    expect(decoded.image.width).toBe(208);
    expectSameDots(decoded.image, img);
    for (let y = 0; y < 37; y++) for (let x = 203; x < 208; x++) expect(getDot(decoded.image, x, y)).toBe(false);
  });

  it('feeds and cuts after the image', () => {
    const img = noiseImage(64, 10);
    const partial = decodeJob(concatBytes(encodeJob(img, { ...BASE, feedLines: 3, cut: 'partial' })));
    expect(partial.unknownBytes).toBe(0);
    expect(partial.image.height).toBe(10 + 3 * 30);
    expect(partial.cuts).toEqual([100]);

    const tail = encodeJob(img, { ...BASE, feedLines: 2, cut: 'full' }).at(-1)!;
    expect(Array.from(tail)).toEqual([0x1b, 0x64, 2, 0x1d, 0x56, 0x41, 0x00]);
    expect(decodeJob(concatBytes(encodeJob(img, BASE))).cuts).toEqual([]);
  });
});

describe('encodeJob (ESC *)', () => {
  it('prints seamless 24-row stripes and survives a round trip', () => {
    const img = noiseImage(200, 100);
    const segments = encodeJob(img, { ...BASE, rasterMode: 'escstar', bandRows: 48 });
    const decoded = decodeJob(concatBytes(segments));
    expect(decoded.unknownBytes).toBe(0);
    // 100 rows need 5 stripes of 24 rows; the last one is padded with blank rows.
    expect(decoded.image.height).toBe(120);
    expectSameDots(decoded.image, img);
    for (let y = 100; y < 120; y++) for (let x = 0; x < 200; x++) expect(getDot(decoded.image, x, y)).toBe(false);
  });

  it('groups stripes into segments by band size', () => {
    const segments = encodeJob(noiseImage(48, 96), { ...BASE, rasterMode: 'escstar', bandRows: 48 });
    // init, line-spacing, two segments of two stripes each, line-spacing reset
    expect(segments).toHaveLength(5);
    expect(segments[2].length).toBe(2 * (5 + 48 * 3 + 1));
  });
});

describe('decodeJob', () => {
  it('counts bytes it does not understand instead of failing', () => {
    const decoded = decodeJob(Uint8Array.of(0x1b, 0x40, 0x41, 0x42, 0x0a));
    expect(decoded.unknownBytes).toBe(2);
    expect(decoded.image.height).toBe(30);
  });
});
