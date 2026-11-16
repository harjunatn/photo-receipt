import { getDot, type BitImage } from '../image/types';

/**
 * How the image is sent.
 * - `gsv0`: "GS v 0" raster command, understood by practically every 58/80 mm receipt printer.
 * - `escstar`: older "ESC *" column format, for printers that garble GS v 0.
 */
export type RasterMode = 'gsv0' | 'escstar';
export type CutMode = 'none' | 'partial' | 'full';

export interface JobOptions {
  rasterMode: RasterMode;
  /** Image rows per command. Smaller bands are gentler on printers with small buffers. */
  bandRows: number;
  /** Blank lines fed after the image so it clears the tear bar. */
  feedLines: number;
  cut: CutMode;
}

/** Bytes backed by a plain ArrayBuffer, which is what the browser's USB/Bluetooth/serial APIs accept. */
export type Bytes = Uint8Array<ArrayBuffer>;

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const STRIPE_ROWS = 24;

/**
 * Encodes a 1-bit image as an ESC/POS print job. The job is returned as
 * segments (init, one per image band, then feed/cut) so the caller can pause
 * between bands and let a slow printer catch up.
 */
export function encodeJob(img: BitImage, options: JobOptions): Bytes[] {
  const segments: Bytes[] = [Uint8Array.of(ESC, 0x40)];

  if (options.rasterMode === 'escstar') segments.push(...encodeEscStar(img, options.bandRows));
  else segments.push(...encodeGsV0(img, options.bandRows));

  const tail: number[] = [];
  if (options.feedLines > 0) tail.push(ESC, 0x64, Math.min(255, Math.round(options.feedLines)));
  // "Function B" cuts feed the paper to the cutter first, so the last rows are never sliced off.
  if (options.cut === 'partial') tail.push(GS, 0x56, 0x42, 0x00);
  else if (options.cut === 'full') tail.push(GS, 0x56, 0x41, 0x00);
  if (tail.length > 0) segments.push(Uint8Array.from(tail));

  return segments;
}

function encodeGsV0(img: BitImage, bandRows: number): Bytes[] {
  const rowsPerBand = Math.min(1024, Math.max(1, Math.round(bandRows)));
  const bytesPerRow = img.bytesPerRow;
  const bands: Bytes[] = [];
  for (let y = 0; y < img.height; y += rowsPerBand) {
    const rows = Math.min(rowsPerBand, img.height - y);
    const band = new Uint8Array(8 + rows * bytesPerRow);
    band.set([GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8]);
    band.set(img.data.subarray(y * bytesPerRow, (y + rows) * bytesPerRow), 8);
    bands.push(band);
  }
  return bands;
}

function encodeEscStar(img: BitImage, bandRows: number): Bytes[] {
  const stripesPerSegment = Math.max(1, Math.floor(bandRows / STRIPE_ROWS));
  const stripeBytes = 5 + img.width * 3 + 1;
  const stripeCount = Math.ceil(img.height / STRIPE_ROWS);
  // Line spacing must equal the stripe height or the image prints with gaps.
  const segments: Bytes[] = [Uint8Array.of(ESC, 0x33, STRIPE_ROWS)];

  for (let first = 0; first < stripeCount; first += stripesPerSegment) {
    const count = Math.min(stripesPerSegment, stripeCount - first);
    const segment = new Uint8Array(count * stripeBytes);
    for (let s = 0; s < count; s++) {
      const top = (first + s) * STRIPE_ROWS;
      let p = s * stripeBytes;
      segment.set([ESC, 0x2a, 33, img.width & 0xff, img.width >> 8], p);
      p += 5;
      for (let x = 0; x < img.width; x++) {
        for (let k = 0; k < 3; k++) {
          let byte = 0;
          for (let bit = 0; bit < 8; bit++) {
            const y = top + k * 8 + bit;
            if (y < img.height && getDot(img, x, y)) byte |= 0x80 >> bit;
          }
          segment[p++] = byte;
        }
      }
      segment[p] = LF;
    }
    segments.push(segment);
  }

  segments.push(Uint8Array.of(ESC, 0x32));
  return segments;
}

export function concatBytes(parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
