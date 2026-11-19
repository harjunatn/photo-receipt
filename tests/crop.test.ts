import { describe, expect, it } from 'vitest';
import { cropWindow, isPlainCrop, MAX_ZOOM, panCrop, zoomCrop } from '../src/lib/receipt/crop';

// A landscape camera frame placed in a square slot: the sides overflow.
const W = 1600;
const H = 1200;

describe('zooming and moving a photo in its slot', () => {
  it('fills the slot centred when the guest changed nothing, as before', () => {
    expect(cropWindow(W, H, 1)).toEqual({ sx: 200, sy: 0, sw: 1200, sh: 1200 });
    expect(cropWindow(W, H, 4 / 3)).toEqual({ sx: 0, sy: 0, sw: 1600, sh: 1200 });
  });

  it('shows less of the photo, larger, when zoomed in', () => {
    const win = cropWindow(W, H, 1, { zoom: 2, x: 0, y: 0 });
    expect(win.sw).toBe(600);
    expect(win.sh).toBe(600);
    // Still centred.
    expect(win.sx + win.sw / 2).toBe(W / 2);
    expect(win.sy + win.sh / 2).toBe(H / 2);
  });

  it('never shows anything outside the photo, however far it is moved or zoomed', () => {
    for (const crop of [
      { zoom: 0.2, x: -9, y: 9 },
      { zoom: 99, x: 1, y: -1 },
      { zoom: Number.NaN, x: Number.NaN, y: 0.5 },
    ]) {
      const win = cropWindow(W, H, 3 / 4, crop);
      expect(win.sx).toBeGreaterThanOrEqual(0);
      expect(win.sy).toBeGreaterThanOrEqual(0);
      expect(win.sx + win.sw).toBeLessThanOrEqual(W + 1e-6);
      expect(win.sy + win.sh).toBeLessThanOrEqual(H + 1e-6);
      expect(win.sw / win.sh).toBeCloseTo(3 / 4);
    }
    expect(cropWindow(W, H, 1, { zoom: 99, x: 0, y: 0 }).sw).toBe(1200 / MAX_ZOOM);
  });

  it('moves the photo with the finger', () => {
    const start = { zoom: 1, x: 0, y: 0 };
    // Dragging right brings more of the left side into view.
    const right = panCrop(start, W, H, 1, 300, 50, 0);
    expect(right.x).toBeLessThan(0);
    expect(cropWindow(W, H, 1, right).sx).toBeLessThan(cropWindow(W, H, 1, start).sx);
    // At zoom 1 a square slot shows the full height, so up and down cannot move.
    expect(panCrop(start, W, H, 1, 300, 0, 80).y).toBe(0);
    // Dragging far stops at the edge.
    expect(panCrop(start, W, H, 1, 300, 5000, 0).x).toBe(-1);
  });

  it('keeps the middle of the view in place while zooming', () => {
    const moved = { zoom: 2, x: 0.6, y: -0.4 };
    const before = cropWindow(W, H, 1, moved);
    const after = cropWindow(W, H, 1, zoomCrop(moved, W, H, 1, 3));
    expect(after.sx + after.sw / 2).toBeCloseTo(before.sx + before.sw / 2, 3);
    expect(after.sy + after.sh / 2).toBeCloseTo(before.sy + before.sh / 2, 3);
    expect(zoomCrop(moved, W, H, 1, 0.5).zoom).toBe(1);
  });

  it('treats an untouched photo as having no crop', () => {
    expect(isPlainCrop(undefined)).toBe(true);
    expect(isPlainCrop({ zoom: 1, x: 0, y: 0 })).toBe(true);
    expect(isPlainCrop({ zoom: 1.2, x: 0, y: 0 })).toBe(false);
  });
});
