import type { Rect } from '../image/types';

export interface DetectedFrame {
  /** Transparent areas large enough to hold a photo, in the order photos are taken: top to bottom, left to right. */
  slots: Rect[];
  /** 'dither' when the artwork has colours or greys that solid black-and-white would ruin. */
  print: 'ink' | 'dither';
}

export const MAX_SLOTS = 6;

/**
 * Finds the photo holes in a frame picture: connected transparent areas. Specks
 * are ignored, and so is a transparent background that runs around the whole design.
 * `rgba` is the picture's pixels as a canvas gives them (4 bytes per pixel).
 */
export function detectFrame(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): DetectedFrame {
  const total = width * height;
  // 0 = opaque, 1 = transparent and not yet visited, 2 = visited.
  const mark = new Uint8Array(total);
  let opaque = 0;
  let shaded = 0;
  for (let i = 0; i < total; i++) {
    const at = i * 4;
    if (rgba[at + 3] < 128) {
      mark[i] = 1;
      continue;
    }
    opaque += 1;
    const r = rgba[at];
    const g = rgba[at + 1];
    const b = rgba[at + 2];
    const light = 0.299 * r + 0.587 * g + 0.114 * b;
    const colourful = Math.max(r, g, b) - Math.min(r, g, b) > 48;
    if (colourful || (light > 48 && light < 208)) shaded += 1;
  }

  const found: { rect: Rect; area: number }[] = [];
  const stack = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (mark[start] !== 1) continue;
    let top = 0;
    stack[top++] = start;
    mark[start] = 2;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let area = 0;
    while (top > 0) {
      const at = stack[--top];
      const x = at % width;
      const y = (at - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mark[at - 1] === 1) {
        mark[at - 1] = 2;
        stack[top++] = at - 1;
      }
      if (x < width - 1 && mark[at + 1] === 1) {
        mark[at + 1] = 2;
        stack[top++] = at + 1;
      }
      if (y > 0 && mark[at - width] === 1) {
        mark[at - width] = 2;
        stack[top++] = at - width;
      }
      if (y < height - 1 && mark[at + width] === 1) {
        mark[at + width] = 2;
        stack[top++] = at + width;
      }
    }
    const rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    const surrounds = minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1;
    // Big enough for a face, reasonably solid (not a thin border or an L-shaped margin), and not the page background.
    if (area >= total * 0.01 && rect.w >= width * 0.08 && rect.h >= 24 && area >= rect.w * rect.h * 0.5 && !surrounds) {
      found.push({ rect, area });
    }
  }

  // Only the largest few can be photos; then into reading order, where holes that overlap vertically share a row.
  const kept = found.sort((a, b) => b.area - a.area).slice(0, MAX_SLOTS).map((entry) => entry.rect);
  kept.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Rect[][] = [];
  for (const rect of kept) {
    const row = rows.find((candidate) => {
      const first = candidate[0];
      const overlap = Math.min(first.y + first.h, rect.y + rect.h) - Math.max(first.y, rect.y);
      return overlap > Math.min(first.h, rect.h) * 0.5;
    });
    if (row) row.push(rect);
    else rows.push([rect]);
  }
  const slots = rows.flatMap((row) => row.sort((a, b) => a.x - b.x));

  return { slots, print: opaque > 0 && shaded / opaque > 0.08 ? 'dither' : 'ink' };
}

/** True when two photo holes share a row. Photos side by side come out small on receipt paper. */
export function hasSideBySide(slots: Rect[]): boolean {
  return slots.some((a, i) =>
    slots.slice(i + 1).some((b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > Math.min(a.h, b.h) * 0.5),
  );
}
