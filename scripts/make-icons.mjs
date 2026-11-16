// Draws the app icon (a receipt with a camera lens) and writes it as PNG files
// into public/icons. Run with `npm run icons`. No image libraries needed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const PAPER = [244, 239, 230];
const INK = [23, 19, 15];
const WHITE = [255, 255, 255];
const ACCENT = [255, 75, 43];

const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x < x1 && y >= y0 && y < y1;
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;

/** The receipt outline: a rectangle whose bottom edge is a row of teeth. */
function inReceipt(x, y, x0, y0, x1, y1, tooth) {
  if (x < x0 || x >= x1 || y < y0) return false;
  if (y < y1) return true;
  const phase = ((x - x0) % tooth) / tooth;
  return y < y1 + tooth * 0.5 * (1 - Math.abs(phase * 2 - 1));
}

/** Colour of the icon at a point, with both coordinates in 0..1. */
function colorAt(x, y) {
  const b = 0.022; // outline thickness
  if (inReceipt(x, y, 0.27, 0.15, 0.73, 0.78, 0.0767)) {
    const inside = inReceipt(x, y, 0.27 + b, 0.15 + b, 0.73 - b, 0.78 - b * 0.4, 0.0767);
    if (!inside) return INK;
    if (inCircle(x, y, 0.5, 0.375, 0.045)) return ACCENT;
    if (inCircle(x, y, 0.5, 0.375, 0.085)) return WHITE;
    if (inRect(x, y, 0.335, 0.235, 0.665, 0.515)) return INK;
    if (inRect(x, y, 0.335, 0.565, 0.665, 0.598)) return INK;
    if (inRect(x, y, 0.335, 0.635, 0.575, 0.668)) return INK;
    if (inRect(x, y, 0.335, 0.705, 0.625, 0.738)) return INK;
    return WHITE;
  }
  // Hard offset shadow in the accent colour.
  if (inReceipt(x - 0.04, y - 0.04, 0.27, 0.15, 0.73, 0.78, 0.0767)) return ACCENT;
  return PAPER;
}

function render(size) {
  const samples = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const color = colorAt((px + (sx + 0.5) / samples) / size, (py + (sy + 0.5) / samples) / size);
          sum[0] += color[0];
          sum[1] += color[1];
          sum[2] += color[2];
        }
      }
      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(sum[0] / samples ** 2);
      pixels[offset + 1] = Math.round(sum[1] / samples ** 2);
      pixels[offset + 2] = Math.round(sum[2] / samples ** 2);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); // leading 0 = no row filter
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(outDir, name), encodePng(size, render(size)));
  console.log(`wrote public/icons/${name}`);
}
