import type { Rect } from '../image/types';
import type { FrameDef } from './frames';

/**
 * A franchise's own frame: a picture with transparent holes where the photos
 * show through. The holes are found when the picture is uploaded.
 */
export interface FrameLayout {
  /** Size of the picture the slots are measured in, in pixels. */
  width: number;
  height: number;
  /** Where each photo goes, in the order the photos are taken. */
  slots: Rect[];
  /**
   * How the picture is turned into printer dots: 'ink' prints it as solid black
   * and white (crisp for line art), 'dither' shades it like a photo (for colours and gradients).
   */
  print: 'ink' | 'dither';
}

export interface CustomFrame {
  id: string;
  name: string;
  blurb: string;
  layout: FrameLayout;
  image: CanvasImageSource;
  /** When it was last changed, as the server reports it. */
  version?: string;
}

/** Ids of custom frames carry a prefix, so they can never collide with a built-in frame. */
export const CUSTOM_PREFIX = 'c:';
export const customFrameId = (id: string) => `${CUSTOM_PREFIX}${id}`;

function isRect(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Record<string, unknown>;
  return ['x', 'y', 'w', 'h'].every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key])) && (rect.w as number) > 0 && (rect.h as number) > 0;
}

/** Checks a layout that came from the server or a file, so a damaged one cannot break the booth. */
export function validLayout(value: unknown): FrameLayout | null {
  if (typeof value !== 'object' || value === null) return null;
  const layout = value as Record<string, unknown>;
  const { width, height, slots } = layout;
  if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0)) return null;
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 6 || !slots.every(isRect)) return null;
  return { width, height, slots: slots.map(({ x, y, w, h }) => ({ x, y, w, h })), print: layout.print === 'dither' ? 'dither' : 'ink' };
}

/** Turns a stored custom frame into a frame the booth can offer and print like the built-in ones. */
export function toFrameDef(frame: CustomFrame): FrameDef {
  const { layout } = frame;
  return {
    id: customFrameId(frame.id),
    name: frame.name,
    blurb: frame.blurb || `${layout.slots.length} foto`,
    slots: layout.slots.map((slot) => slot.w / slot.h),
    version: frame.version,
    draw(page, photos) {
      // The picture spans the full paper width; its own margins are part of the design.
      const scale = page.width / layout.width;
      const top = page.y;
      const height = Math.round(layout.height * scale);
      layout.slots.forEach((slot, i) => {
        // One pixel wider all round, so no white hairline shows at the edge of a hole.
        page.photoIn(photos[i], {
          x: Math.floor(slot.x * scale) - 1,
          y: top + Math.floor(slot.y * scale) - 1,
          w: Math.ceil(slot.w * scale) + 2,
          h: Math.ceil(slot.h * scale) + 2,
        });
      });
      page.overlay(frame.image, { x: 0, y: top, w: page.width, h: height }, layout.print);
      page.y = top + height + page.px(10);
    },
  };
}
