import { describe, expect, it } from 'vitest';
import { addMonths, extendFrom } from '../src/dashboard/stats';
import { applyRemote, completePlatform, DEFAULT_PLATFORM, jakartaDay, subscriptionState } from '../src/lib/cloud/shared';
import { customFrameId, validLayout } from '../src/lib/receipt/custom';
import { detectFrame } from '../src/lib/receipt/detect';
import { activeFrames, customFramesStore, frameById, FRAMES, type FrameDef } from '../src/lib/receipt/frames';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

/** A frame picture: opaque everywhere (in the given colour), except the listed transparent holes. */
function picture(width: number, height: number, holes: { x: number; y: number; w: number; h: number }[], colour: [number, number, number] = [0, 0, 0]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...colour, 255], i * 4);
  for (const hole of holes) {
    for (let y = hole.y; y < hole.y + hole.h; y++) {
      for (let x = hole.x; x < hole.x + hole.w; x++) rgba[(y * width + x) * 4 + 3] = 0;
    }
  }
  return rgba;
}

describe('finding the photo holes of an uploaded frame', () => {
  it('finds each transparent hole, in the order photos are taken: top to bottom, then left to right', () => {
    const holes = [
      { x: 110, y: 150, w: 80, h: 60 }, // bottom right
      { x: 10, y: 10, w: 180, h: 120 }, // top, full width
      { x: 10, y: 152, w: 80, h: 60 }, // bottom left, two pixels lower than its neighbour
    ];
    const found = detectFrame(picture(200, 240, holes), 200, 240);
    expect(found.slots).toEqual([holes[1], holes[2], holes[0]]);
    expect(found.print).toBe('ink');
  });

  it('ignores specks, thin gaps and a transparent background around the whole design', () => {
    const width = 200;
    const height = 200;
    const rgba = picture(width, height, [
      { x: 60, y: 60, w: 80, h: 60 }, // the photo
      { x: 20, y: 30, w: 4, h: 4 }, // a speck
      { x: 20, y: 150, w: 150, h: 3 }, // a thin line
    ]);
    // A transparent band all the way round the edge, as when the design does not fill the canvas.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < 6 || y < 6 || x >= width - 6 || y >= height - 6) rgba[(y * width + x) * 4 + 3] = 0;
      }
    }
    expect(detectFrame(rgba, width, height).slots).toEqual([{ x: 60, y: 60, w: 80, h: 60 }]);
  });

  it('keeps a hole that runs to the edge of the picture, like a full-width photo', () => {
    expect(detectFrame(picture(100, 300, [{ x: 0, y: 40, w: 100, h: 80 }]), 100, 300).slots).toEqual([{ x: 0, y: 40, w: 100, h: 80 }]);
  });

  it('keeps at most six photos, the largest ones', () => {
    const holes = Array.from({ length: 8 }, (_, i) => ({ x: 10, y: 10 + i * 60, w: i < 2 ? 40 : 80, h: 50 }));
    const found = detectFrame(picture(100, 500, holes), 100, 500);
    expect(found.slots).toHaveLength(6);
    expect(found.slots.every((slot) => slot.w === 80)).toBe(true);
  });

  it('finds nothing in a picture without transparency, e.g. a JPEG with white boxes', () => {
    expect(detectFrame(picture(100, 100, [], [255, 255, 255]), 100, 100).slots).toEqual([]);
  });

  it('suggests shading for artwork in colour or grey, and solid ink for black-and-white line art', () => {
    const hole = [{ x: 20, y: 20, w: 60, h: 40 }];
    expect(detectFrame(picture(100, 100, hole, [255, 255, 255]), 100, 100).print).toBe('ink');
    expect(detectFrame(picture(100, 100, hole, [230, 60, 120]), 100, 100).print).toBe('dither');
    expect(detectFrame(picture(100, 100, hole, [128, 128, 128]), 100, 100).print).toBe('dither');
  });
});

describe('a frame layout from the server', () => {
  it('is used as it is when well formed, and refused when damaged', () => {
    const layout = { width: 1080, height: 2400, slots: [{ x: 60, y: 300, w: 960, h: 720 }], print: 'dither' };
    expect(validLayout(layout)).toEqual(layout);
    expect(validLayout({ ...layout, print: 'apa saja' })?.print).toBe('ink');
    expect(validLayout({ ...layout, slots: [] })).toBeNull();
    expect(validLayout({ ...layout, slots: Array(7).fill(layout.slots[0]) })).toBeNull();
    expect(validLayout({ ...layout, slots: [{ x: 0, y: 0, w: 0, h: 10 }] })).toBeNull();
    expect(validLayout({ ...layout, width: 'lebar' })).toBeNull();
    expect(validLayout(null)).toBeNull();
  });
});

describe('frames on a tablet', () => {
  const own: FrameDef = { id: customFrameId('abc'), name: 'Frame Sendiri', blurb: '1 foto', slots: [1], draw: () => undefined };

  it("offers the franchise's own frames alongside the built-in ones, in the dashboard's order", () => {
    customFramesStore.set([own]);
    expect(activeFrames([own.id, 'klasik']).map((frame) => frame.name)).toEqual(['Frame Sendiri', 'Klasik']);
    expect(frameById(own.id)).toBe(own);
    customFramesStore.set([]);
  });

  it('carries on with the built-in frames while its own have not arrived, or after one was deleted', () => {
    customFramesStore.set([]);
    expect(activeFrames([own.id, 'film']).map((frame) => frame.id)).toEqual(['film']);
    expect(activeFrames([own.id])).toEqual(FRAMES);
    expect(frameById(own.id)).toBe(FRAMES[0]);
  });
});

describe('subscription as a tablet counts it', () => {
  const noon = (day: string) => new Date(`${day}T05:00:00Z`);
  const paid = { active: true, paidUntil: '2026-11-20', graceDays: 7 };

  it('runs through the paid date, then the grace days, then stops', () => {
    expect(subscriptionState(paid, noon('2026-11-20'))).toBe('active');
    expect(subscriptionState(paid, noon('2026-11-21'))).toBe('grace');
    expect(subscriptionState(paid, noon('2026-11-27'))).toBe('grace');
    expect(subscriptionState(paid, noon('2026-11-28'))).toBe('expired');
    expect(subscriptionState({ ...paid, graceDays: 0 }, noon('2026-11-21'))).toBe('expired');
  });

  it('has no end without a date, is stopped at once when suspended, and runs before the first sync', () => {
    expect(subscriptionState({ active: true, paidUntil: null, graceDays: 7 }, noon('2099-01-01'))).toBe('active');
    expect(subscriptionState({ ...paid, active: false }, noon('2026-11-01'))).toBe('suspended');
    expect(subscriptionState(null)).toBe('active');
  });

  it('counts days in Jakarta, as the server does', () => {
    // 18:00 UTC is already the next day in Jakarta.
    expect(jakartaDay(new Date('2026-11-20T18:00:00Z'))).toBe('2026-11-21');
    expect(subscriptionState(paid, new Date('2026-11-20T16:59:00Z'))).toBe('active');
    expect(subscriptionState(paid, new Date('2026-11-20T17:01:00Z'))).toBe('grace');
  });
});

describe('extending a subscription', () => {
  it('counts from the current end while it has not passed, and from today when it has', () => {
    expect(extendFrom('2026-12-05', '2026-11-20', 1)).toBe('2027-01-05');
    expect(extendFrom('2026-11-01', '2026-11-20', 1)).toBe('2026-12-20');
    expect(extendFrom(null, '2026-11-20', 12)).toBe('2027-11-20');
  });

  it('keeps to the last day of a shorter month', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-10-31', 3)).toBe('2027-01-31');
  });
});

describe('platform settings', () => {
  it('fall back to the defaults for what was never saved or is unusable', () => {
    expect(completePlatform(null)).toEqual(DEFAULT_PLATFORM);
    expect(completePlatform({ name: '  ', graceDays: 'banyak' })).toMatchObject({ name: DEFAULT_PLATFORM.name, graceDays: 7 });
    expect(completePlatform({ name: 'Jepretin', watermark: '', receiptLine: '@jepretin.id', graceDays: 0 })).toEqual({
      name: 'Jepretin',
      watermark: '',
      receiptLine: '@jepretin.id',
      graceDays: 0,
    });
  });

  it('reach the tablet with the outlet settings, and stay as they were when not sent', () => {
    const next = applyRemote(DEFAULT_SETTINGS, {}, null, { name: 'Jepretin', watermark: 'oleh Jepretin', receiptLine: '@jepretin.id' });
    expect(next.platform).toEqual({ name: 'Jepretin', watermark: 'oleh Jepretin', receiptLine: '@jepretin.id' });
    expect(applyRemote(next, {}, null).platform).toEqual(next.platform);
    // A franchise's outlet settings cannot carry platform settings in with them.
    expect(applyRemote(DEFAULT_SETTINGS, { platform: { watermark: 'punyaku' } }, null).platform).toEqual(DEFAULT_SETTINGS.platform);
  });
});

describe('a new franchise', () => {
  it('prints its own name on receipts until a tablet sets a title of its own', () => {
    const fresh = applyRemote(DEFAULT_SETTINGS, { brand: { title: 'Booth Budi' } }, null);
    expect(fresh.brand.title).toBe('Booth Budi');
    expect(fresh.receipt.title).toBe('BOOTH BUDI');
    const chosen = structuredClone(DEFAULT_SETTINGS);
    chosen.receipt.title = 'HELLO VIOREN';
    expect(applyRemote(chosen, { brand: { title: 'Booth Budi' } }, null).receipt.title).toBe('HELLO VIOREN');
  });
});
