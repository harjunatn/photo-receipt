/** 8-bit grayscale image. 0 = black, 255 = white (paper). */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * 1-bit image in the layout thermal printers expect: each row is padded to
 * whole bytes, most significant bit first, and a set bit is a printed (black) dot.
 */
export interface BitImage {
  width: number;
  height: number;
  bytesPerRow: number;
  data: Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function createBitImage(width: number, height: number): BitImage {
  const bytesPerRow = Math.ceil(width / 8);
  return { width, height, bytesPerRow, data: new Uint8Array(bytesPerRow * height) };
}

export function getDot(img: BitImage, x: number, y: number): boolean {
  return (img.data[y * img.bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
}

export function setDot(img: BitImage, x: number, y: number): void {
  img.data[y * img.bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
}

/** Converts canvas RGBA pixels to grayscale; transparent pixels become white paper. */
export function rgbaToGray(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    const alpha = rgba[p + 3] / 255;
    const luma = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    data[i] = luma * alpha + 255 * (1 - alpha);
  }
  return { width, height, data };
}

export function cropGray(img: GrayImage, rect: Rect): GrayImage {
  const data = new Uint8ClampedArray(rect.w * rect.h);
  for (let row = 0; row < rect.h; row++) {
    const start = (rect.y + row) * img.width + rect.x;
    data.set(img.data.subarray(start, start + rect.w), row * rect.w);
  }
  return { width: rect.w, height: rect.h, data };
}

/** Expands a 1-bit image to RGBA so it can be shown on a canvas as a print preview. */
export function bitImageToRgba(img: BitImage): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(img.width * img.height * 4);
  for (let y = 0, p = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++, p += 4) {
      const shade = getDot(img, x, y) ? 24 : 255;
      rgba[p] = shade;
      rgba[p + 1] = shade;
      rgba[p + 2] = shade;
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}
