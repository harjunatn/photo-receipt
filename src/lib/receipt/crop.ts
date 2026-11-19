/**
 * How a guest zoomed and moved one photo inside its slot. Without one, the
 * photo fills the slot centred, cropping whatever overflows.
 */
export interface Crop {
  /** 1 fills the slot; 2 shows half as much of the photo, twice as large. */
  zoom: number;
  /** -1 shows the left edge of what overflows, 0 the middle, 1 the right edge. */
  x: number;
  /** -1 top, 0 middle, 1 bottom. */
  y: number;
}

export const MAX_ZOOM = 4;

/** The part of a source picture that fills a slot of the given shape (width ÷ height). */
export function cropWindow(
  sourceWidth: number,
  sourceHeight: number,
  slotAspect: number,
  crop?: Crop,
): { sx: number; sy: number; sw: number; sh: number } {
  const zoom = clamp(crop?.zoom ?? 1, 1, MAX_ZOOM);
  const sw = Math.min(sourceWidth, sourceHeight * slotAspect) / zoom;
  const sh = Math.min(sourceHeight, sourceWidth / slotAspect) / zoom;
  const sx = ((sourceWidth - sw) / 2) * (1 + clamp(crop?.x ?? 0, -1, 1));
  const sy = ((sourceHeight - sh) / 2) * (1 + clamp(crop?.y ?? 0, -1, 1));
  return { sx, sy, sw, sh };
}

/**
 * The crop after dragging the picture by (dx, dy) screen pixels in a viewer
 * `viewWidth` pixels wide: the picture follows the finger.
 */
export function panCrop(
  crop: Crop,
  sourceWidth: number,
  sourceHeight: number,
  slotAspect: number,
  viewWidth: number,
  dx: number,
  dy: number,
): Crop {
  const win = cropWindow(sourceWidth, sourceHeight, slotAspect, crop);
  const perPixel = win.sw / viewWidth;
  const slackX = (sourceWidth - win.sw) / 2;
  const slackY = (sourceHeight - win.sh) / 2;
  const x = slackX > 0 ? (win.sx - dx * perPixel) / slackX - 1 : 0;
  const y = slackY > 0 ? (win.sy - dy * perPixel) / slackY - 1 : 0;
  return { zoom: crop.zoom, x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
}

/** The crop after zooming to `zoom`, keeping the middle of the view where it was. */
export function zoomCrop(crop: Crop, sourceWidth: number, sourceHeight: number, slotAspect: number, zoom: number): Crop {
  const next = clamp(zoom, 1, MAX_ZOOM);
  const before = cropWindow(sourceWidth, sourceHeight, slotAspect, crop);
  const centreX = before.sx + before.sw / 2;
  const centreY = before.sy + before.sh / 2;
  const after = cropWindow(sourceWidth, sourceHeight, slotAspect, { zoom: next, x: 0, y: 0 });
  const slackX = (sourceWidth - after.sw) / 2;
  const slackY = (sourceHeight - after.sh) / 2;
  const x = slackX > 0 ? (centreX - after.sw / 2) / slackX - 1 : 0;
  const y = slackY > 0 ? (centreY - after.sh / 2) / slackY - 1 : 0;
  return { zoom: next, x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
}

/** True when a crop changes nothing, so it need not be kept. */
export function isPlainCrop(crop: Crop | undefined | null): boolean {
  return !crop || (crop.zoom <= 1.001 && Math.abs(crop.x) < 0.001 && Math.abs(crop.y) < 0.001);
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min === -1 ? 0 : min;
}
