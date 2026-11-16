import type { BitImage } from '../image/types';

export interface DecodedJob {
  /** Everything the printer would have put on paper, top to bottom. */
  image: BitImage;
  /** Row positions where the paper is cut. */
  cuts: number[];
  /** Bytes that are not part of any command this decoder understands. */
  unknownBytes: number;
}

const DEFAULT_LINE_SPACING = 30;

/**
 * Replays an ESC/POS byte stream the way a receipt printer would, producing
 * the resulting paper image. Used by the on-screen "simulated printer" and by
 * the tests, so what the app sends can be checked without real hardware.
 * Understands the subset of commands this app emits.
 */
export function decodeJob(bytes: Uint8Array): DecodedJob {
  const rows: Uint8Array[] = [];
  const cuts: number[] = [];
  let unknownBytes = 0;
  let lineSpacing = DEFAULT_LINE_SPACING;
  let pendingStripe: Uint8Array[] | null = null;

  const feed = (count: number) => {
    for (let i = 0; i < count; i++) rows.push(new Uint8Array(0));
  };
  const flushStripe = () => {
    if (!pendingStripe) return;
    rows.push(...pendingStripe.slice(0, Math.max(lineSpacing, 1)));
    feed(lineSpacing - pendingStripe.length);
    pendingStripe = null;
  };

  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];

    if (b === 0x0a) {
      if (pendingStripe) flushStripe();
      else feed(lineSpacing);
      i += 1;
    } else if (b === 0x1b && bytes[i + 1] === 0x40) {
      lineSpacing = DEFAULT_LINE_SPACING;
      i += 2;
    } else if (b === 0x1b && bytes[i + 1] === 0x33) {
      lineSpacing = bytes[i + 2];
      i += 3;
    } else if (b === 0x1b && bytes[i + 1] === 0x32) {
      lineSpacing = DEFAULT_LINE_SPACING;
      i += 2;
    } else if (b === 0x1b && bytes[i + 1] === 0x64) {
      flushStripe();
      feed(bytes[i + 2] * lineSpacing);
      i += 3;
    } else if (b === 0x1b && bytes[i + 1] === 0x4a) {
      flushStripe();
      feed(bytes[i + 2]);
      i += 3;
    } else if (b === 0x1b && bytes[i + 1] === 0x2a) {
      flushStripe();
      const mode = bytes[i + 2];
      const columns = bytes[i + 3] | (bytes[i + 4] << 8);
      const bytesPerColumn = mode >= 32 ? 3 : 1;
      const data = bytes.subarray(i + 5, i + 5 + columns * bytesPerColumn);
      const rowBytes = Math.ceil(columns / 8);
      const stripe: Uint8Array[] = [];
      for (let r = 0; r < bytesPerColumn * 8; r++) {
        const row = new Uint8Array(rowBytes);
        for (let x = 0; x < columns; x++) {
          if (data[x * bytesPerColumn + (r >> 3)] & (0x80 >> (r & 7))) row[x >> 3] |= 0x80 >> (x & 7);
        }
        stripe.push(row);
      }
      pendingStripe = stripe;
      i += 5 + columns * bytesPerColumn;
    } else if (b === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) {
      flushStripe();
      const bytesPerRow = bytes[i + 4] | (bytes[i + 5] << 8);
      const height = bytes[i + 6] | (bytes[i + 7] << 8);
      const start = i + 8;
      for (let r = 0; r < height; r++) {
        rows.push(bytes.slice(start + r * bytesPerRow, start + (r + 1) * bytesPerRow));
      }
      i = start + bytesPerRow * height;
    } else if (b === 0x1d && bytes[i + 1] === 0x56) {
      flushStripe();
      const mode = bytes[i + 2];
      cuts.push(rows.length);
      i += mode === 65 || mode === 66 ? 4 : 3;
    } else {
      unknownBytes += 1;
      i += 1;
    }
  }
  flushStripe();

  const bytesPerRow = rows.reduce((max, row) => Math.max(max, row.length), 1);
  const data = new Uint8Array(bytesPerRow * rows.length);
  rows.forEach((row, y) => data.set(row, y * bytesPerRow));
  return { image: { width: bytesPerRow * 8, height: rows.length, bytesPerRow, data }, cuts, unknownBytes };
}
