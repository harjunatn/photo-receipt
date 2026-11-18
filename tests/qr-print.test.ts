import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { QR_QUIET, qrCellSize } from '../src/lib/receipt/page';

/** A realistic download address: about as long as the real ones. */
const URL = 'https://photo-receipt-harjunatn.vercel.app/#s/b27fa4fsxg8u';
const MARGIN = (dots: number) => Math.round((18 * dots) / 576);

/** The QR code as printer dots (true = black), with `cell` dots per square and `quiet` white squares around it. */
function printed(text: string, cell: number, quiet: number): { dots: boolean[]; size: number } {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const modules = code.getModuleCount();
  const size = (modules + quiet * 2) * cell;
  const dots = new Array<boolean>(size * size).fill(false);
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (!code.isDark(r, c)) continue;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) dots[((quiet + r) * cell + y) * size + (quiet + c) * cell + x] = true;
    }
  }
  return { dots, size };
}

/** Thermal ink spreads: every black dot also darkens the dots to its right and below. */
function inkSpread({ dots, size }: { dots: boolean[]; size: number }) {
  const out = dots.slice();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!dots[y * size + x]) continue;
      if (x + 1 < size) out[y * size + x + 1] = true;
      if (y + 1 < size) out[(y + 1) * size + x] = true;
      if (x + 1 < size && y + 1 < size) out[(y + 1) * size + x + 1] = true;
    }
  }
  return { dots: out, size };
}

/** What a phone sees: the print photographed from a distance, `scale` of its dot size, averaged. */
function photographed({ dots, size }: { dots: boolean[]; size: number }, scale: number) {
  const small = Math.max(1, Math.round(size * scale));
  const rgba = new Uint8ClampedArray(small * small * 4);
  const step = size / small;
  for (let y = 0; y < small; y++) {
    for (let x = 0; x < small; x++) {
      let black = 0;
      let count = 0;
      for (let sy = Math.floor(y * step); sy < Math.floor((y + 1) * step); sy++) {
        for (let sx = Math.floor(x * step); sx < Math.floor((x + 1) * step); sx++) {
          black += dots[sy * size + sx] ? 1 : 0;
          count += 1;
        }
      }
      const v = 255 - Math.round((255 * black) / Math.max(1, count));
      rgba.set([v, v, v, 255], (y * small + x) * 4);
    }
  }
  return { rgba, size: small };
}

function readable(cell: number, quiet: number, scale: number): boolean {
  const shot = photographed(inkSpread(printed(URL, cell, quiet)), scale);
  return jsQR(shot.rgba, shot.size, shot.size)?.data === URL;
}

function modulesOf(text: string): number {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  return code.getModuleCount();
}

describe('download QR code on the receipt', () => {
  for (const dots of [384, 576]) {
    const paper = dots === 384 ? '58 mm' : '80 mm';
    const cell = qrCellSize(modulesOf(URL), dots - MARGIN(dots) * 2, dots, 0.72);

    it(`is at least 3 cm wide with squares of 0.75 mm or more on ${paper} paper`, () => {
      expect(cell).toBeGreaterThanOrEqual(6);
      const widthMm = ((modulesOf(URL) + QR_QUIET * 2) * cell) / 8;
      expect(widthMm).toBeGreaterThanOrEqual(30);
      expect((modulesOf(URL) + QR_QUIET * 2) * cell).toBeLessThanOrEqual(dots);
    });

    it(`still reads after the ink spreads and the phone sees it small, on ${paper} paper`, () => {
      expect(readable(cell, QR_QUIET, 0.35)).toBe(true);
    });
  }

  it('was too small before: 4-dot squares and a thin border fail once the ink spreads and the photo shrinks', () => {
    expect(readable(4, 2, 0.35)).toBe(false);
  });
});
