/**
 * The boomerang inside the frame: the guest's colour receipt, with each photo
 * replaced by the burst kept around it, played forwards and back.
 *
 * The receipt is drawn only twice for the whole video: once with every photo
 * black and once with every photo white. Where the two agree, the frame covers
 * the photo; where they differ, the photo shows through, as much as they differ.
 * That gives one picture to lay over the moving photos, whatever the frame
 * draws on top of them (a PNG design with holes, a border, a sticker, a date).
 */
import type { Rect } from '../image/types';
import { cropWindow, type Crop } from '../receipt/crop';
import { boomerangOrder } from './boomerang';
import { encodeVideo } from './encode';

export const FRAME_BOOMERANG = {
  /** Widest the video is drawn; a tall receipt is drawn narrower so it stays within `maxHeight`. */
  width: 720,
  maxHeight: 1920,
  /** Narrower than this and the photos get too small to be worth it. */
  minWidth: 320,
  /** The bursts are taken 10 a second, so this plays them twice as fast. */
  fps: 20,
  /** Forwards and back this many times; the video player then loops it seamlessly. */
  loops: 3,
};

/** Bits per second for a video of this size: most of the picture stands still and costs little. */
export function frameBoomerangBitrate(width: number, height: number): number {
  return Math.min(6_000_000, Math.max(1_500_000, Math.round(width * height * 3)));
}

/** Whole 16-pixel blocks that hold `value`; the receipt's white paper fills what is left over. */
export function blocksUp(value: number): number {
  return Math.max(16, Math.ceil(value / 16) * 16);
}

/**
 * The widths to try for a receipt that is `height` pixels tall when drawn
 * `width` wide, widest first, each a multiple of 16 that keeps it within the
 * tallest video allowed.
 */
export function frameBoomerangWidths(width: number, height: number): number[] {
  const { maxHeight, minWidth } = FRAME_BOOMERANG;
  const widest = Math.min(width, Math.floor((width * maxHeight) / height / 16) * 16);
  const widths: number[] = [];
  for (let w = widest; w >= minWidth; w = Math.floor((w * 0.85) / 16) * 16) widths.push(w);
  return widths;
}

/**
 * The picture laid over the moving photos, from the receipt drawn with black
 * photos and with white photos (RGBA, same size): the frame where it covers
 * the photos, transparent where they show, and partly see-through where a
 * design's edge is soft.
 */
export function photoOverlay(black: ArrayLike<number>, white: ArrayLike<number>): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(black.length));
  for (let i = 0; i < black.length; i += 4) {
    const difference = white[i] - black[i] + (white[i + 1] - black[i + 1]) + (white[i + 2] - black[i + 2]);
    // How much of the photo shows through here, 0…1.
    const through = Math.min(1, Math.max(0, difference / (3 * 255)));
    const alpha = 1 - through;
    out[i + 3] = Math.round(alpha * 255);
    if (alpha < 1 / 255) continue;
    // With black photos the receipt shows the frame's colour already weighed by how much it covers.
    out[i] = black[i] / alpha;
    out[i + 1] = black[i + 1] / alpha;
    out[i + 2] = black[i + 2] / alpha;
  }
  return out;
}

export interface FrameBoomerangSlot {
  /** Where the photo sits on the receipt. */
  rect: Rect;
  /** The burst, not mirrored; null shows `still` instead. */
  pictures: ImageBitmap[] | null;
  /** The photo as taken (mirrored when the booth mirrors photos). */
  still: CanvasImageSource & { width: number; height: number };
  crop?: Crop;
}

export interface FrameBoomerangInput {
  /** The receipt drawn with every photo solid black, and with every photo solid white. */
  black: HTMLCanvasElement;
  white: HTMLCanvasElement;
  slots: FrameBoomerangSlot[];
  /** True when the photos were mirrored; the bursts are not, so they are flipped to match. */
  mirror: boolean;
}

/** Draws one photo slot as it looks at `frame` of the burst, cut the way the guest cut the photo. */
function drawSlot(ctx: CanvasRenderingContext2D, slot: FrameBoomerangSlot, frame: number, mirror: boolean): void {
  const { rect } = slot;
  const aspect = rect.w / rect.h;
  if (!slot.pictures || slot.pictures.length === 0) {
    const win = cropWindow(slot.still.width, slot.still.height, aspect, slot.crop);
    ctx.drawImage(slot.still, win.sx, win.sy, win.sw, win.sh, rect.x, rect.y, rect.w, rect.h);
    return;
  }
  const picture = slot.pictures[Math.min(frame, slot.pictures.length - 1)];
  const win = cropWindow(picture.width, picture.height, aspect, slot.crop);
  if (!mirror) {
    ctx.drawImage(picture, win.sx, win.sy, win.sw, win.sh, rect.x, rect.y, rect.w, rect.h);
    return;
  }
  // The guest cut the mirrored photo: take the same part from the other side, then flip it.
  ctx.save();
  ctx.translate(rect.x + rect.w, rect.y);
  ctx.scale(-1, 1);
  ctx.drawImage(picture, picture.width - win.sx - win.sw, win.sy, win.sw, win.sh, 0, 0, rect.w, rect.h);
  ctx.restore();
}

/**
 * The boomerang inside the frame as an MP4 file. The bursts stay the caller's
 * to release.
 */
export async function makeFrameBoomerang(input: FrameBoomerangInput): Promise<Blob> {
  const { black, white, slots, mirror } = input;
  const width = black.width;
  const height = blocksUp(black.height);
  const read = (canvas: HTMLCanvasElement) => canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, black.height).data;
  const overlay = document.createElement('canvas');
  overlay.width = width;
  overlay.height = black.height;
  overlay.getContext('2d')!.putImageData(new ImageData(photoOverlay(read(black), read(white)), width, black.height), 0, 0);

  const count = Math.max(1, ...slots.map((slot) => slot.pictures?.length ?? 0));
  const order = boomerangOrder(count, FRAME_BOOMERANG.loops);
  return encodeVideo({
    width,
    height,
    fps: FRAME_BOOMERANG.fps,
    frames: order.length,
    bitrate: frameBoomerangBitrate(width, height),
    draw: (ctx, index) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      for (const slot of slots) drawSlot(ctx, slot, order[index], mirror);
      ctx.drawImage(overlay, 0, 0);
    },
  });
}
