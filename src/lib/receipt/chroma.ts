/**
 * Frames without transparency (a JPG, say) mark where the photos go with one
 * solid colour, like a green screen. Those areas are cut out, turning the
 * picture into the same kind of frame a PNG with transparent holes gives.
 */
import { detectFrame, type DetectedFrame } from './detect';

export type Rgb = readonly [number, number, number];

/** Colours tried, in turn, when the frame's maker did not say which one marks the photos. */
export const KEY_COLOURS: { name: string; rgb: Rgb }[] = [
  { name: 'hijau', rgb: [0, 255, 0] },
  { name: 'magenta', rgb: [255, 0, 255] },
  { name: 'biru', rgb: [0, 0, 255] },
];

/** How far (in RGB) a pixel may be from the marking colour and still count as it: low, medium and high sensitivity. */
export const TOLERANCE = { low: 60, medium: 100, high: 150 } as const;
export type Sensitivity = keyof typeof TOLERANCE;

const distance = (rgba: ArrayLike<number>, at: number, key: Rgb) => {
  const dr = rgba[at] - key[0];
  const dg = rgba[at + 1] - key[1];
  const db = rgba[at + 2] - key[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

export const toHex = (rgb: Rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** True when the picture already has see-through areas, as a PNG frame made the usual way does. */
export function hasTransparency(rgba: ArrayLike<number>): boolean {
  for (let at = 3; at < rgba.length; at += 4) if (rgba[at] < 128) return true;
  return false;
}

/** The marking colour that covers most of the picture, if any covers at least 1 % of it. */
export function findKeyColour(rgba: ArrayLike<number>, width: number, height: number, tolerance: number = TOLERANCE.medium): Rgb | null {
  const total = width * height;
  let best: { rgb: Rgb; count: number } | null = null;
  for (const { rgb } of KEY_COLOURS) {
    let count = 0;
    for (let i = 0; i < total; i++) if (distance(rgba, i * 4, rgb) < tolerance) count++;
    if (count >= total * 0.01 && (!best || count > best.count)) best = { rgb, count };
  }
  return best?.rgb ?? null;
}

/**
 * Which pixels are the marking colour. JPG blurs the edge of a solid area, so
 * neighbours that are still roughly that colour are taken too, and then one
 * more pixel all round, so no coloured fringe is left around the photos.
 */
export function keyMask(rgba: ArrayLike<number>, width: number, height: number, key: Rgb, tolerance: number): Uint8Array {
  const total = width * height;
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) if (distance(rgba, i * 4, key) < tolerance) mask[i] = 1;

  const grow = (accept: (i: number) => boolean) => {
    const add: number[] = [];
    for (let i = 0; i < total; i++) {
      if (mask[i]) continue;
      const x = i % width;
      const touches = (x > 0 && mask[i - 1]) || (x < width - 1 && mask[i + 1]) || (i >= width && mask[i - width]) || (i + width < total && mask[i + width]);
      if (touches && accept(i)) add.push(i);
    }
    for (const i of add) mask[i] = 1;
  };
  for (let pass = 0; pass < 2; pass++) grow((i) => distance(rgba, i * 4, key) < tolerance * 1.8);
  grow(() => true);
  return mask;
}

/**
 * Cuts the photo areas out of a picture marked with `key`: returns the picture
 * with those areas transparent, and the holes found. Spots of the colour too
 * small to be a photo keep their colour, so a green detail in a design stays.
 */
export function cutKeyedFrame(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  key: Rgb,
  tolerance: number,
): { rgba: Uint8ClampedArray<ArrayBuffer>; found: DetectedFrame } {
  const mask = keyMask(rgba, width, height, key, tolerance);
  const out = new Uint8ClampedArray(new ArrayBuffer(rgba.length));
  out.set(rgba);
  for (let i = 0; i < mask.length; i++) if (mask[i]) out[i * 4 + 3] = 0;
  const found = detectFrame(out, width, height);
  // Put back what is not part of a photo hole.
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    const inside = found.slots.some((s) => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h);
    if (!inside) out[i * 4 + 3] = rgba[i * 4 + 3];
  }
  return { rgba: out, found };
}
