import qrcode from 'qrcode-generator';
import type { Rect } from '../image/types';
import { cropWindow, type Crop } from './crop';

/** All sizes are written for an 80 mm printer (576 dots) and scaled for narrower paper. */
const BASE_WIDTH = 576;
const FONT = '"Space Mono", ui-monospace, Menlo, Consolas, monospace';
export const INK = '#000';
const PAPER = '#fff';
/** Smallest QR square: 6 dots is 0.75 mm on a 203 dpi head, big enough for a phone camera after the ink spreads. */
const MIN_QR_CELL = 6;

export interface ComposedReceipt {
  canvas: HTMLCanvasElement;
  /** Areas holding photos; these are dithered, everything else prints as solid ink. */
  photoRects: Rect[];
  /** Where each of the guest's photos landed, by photo number, so a preview can make them tappable. */
  slotRects: (Rect | undefined)[];
  /** Artwork with colours or gradients (a franchise's own frame): shaded like a photo, but without the photo's tone settings. */
  artRects: Rect[];
}

function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  const sized = src as { width: number; height: number };
  return { w: sized.width, h: sized.height };
}

export function pad(n: number, length = 2): string {
  return String(n).padStart(length, '0');
}

export function formatDateTime(when: Date): string {
  return `${pad(when.getDate())}/${pad(when.getMonth() + 1)}/${when.getFullYear()} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

export function sessionCode(when: Date, sessionNo: number): string {
  return `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-${pad(sessionNo, 3)}`;
}

/** White squares scanners expect around a QR code. */
export const QR_QUIET = 4;

/**
 * Dots per QR square for a code of `modules` squares: about `share` of the
 * printable width, never below MIN_QR_CELL, never wider than the paper.
 */
export function qrCellSize(modules: number, inner: number, width: number, share: number): number {
  const span = modules + QR_QUIET * 2;
  const wanted = Math.max(MIN_QR_CELL, Math.floor((inner * share) / span));
  return Math.max(2, Math.min(wanted, Math.floor(width / span)));
}

/** A tall white sheet that is drawn top to bottom and cropped to its content at the end. */
export class Page {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  readonly photoRects: Rect[] = [];
  readonly slotRects: (Rect | undefined)[] = [];
  readonly artRects: Rect[] = [];
  /** The guest's photos and how each was zoomed, to recognise them when a frame draws them. */
  private slotPhotos: (CanvasImageSource | undefined)[] = [];
  private slotCrops: (Crop | undefined)[] = [];
  y = 0;

  constructor(readonly width: number, maxHeight: number) {
    this.canvas.width = width;
    this.canvas.height = maxHeight;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.ctx.fillStyle = PAPER;
    this.ctx.fillRect(0, 0, width, maxHeight);
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.textBaseline = 'top';
  }

  px(n: number): number {
    return Math.round((n * this.width) / BASE_WIDTH);
  }

  get margin(): number {
    return this.px(18);
  }

  get inner(): number {
    return this.width - this.margin * 2;
  }

  gap(n: number): void {
    this.y += this.px(n);
  }

  private setFont(size: number, bold: boolean): number {
    // Below about 13 px the strokes break up on a 203 dpi print head.
    const px = Math.max(13, this.px(size));
    this.ctx.font = `${bold ? 700 : 400} ${px}px ${FONT}`;
    return px;
  }

  private wrap(text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.ctx.measureText(candidate).width <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        line = word;
        // A single word wider than the paper is broken across lines.
        while (this.ctx.measureText(line).width > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && this.ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      lines.push(line);
    }
    return lines;
  }

  text(text: string, size: number, options: { bold?: boolean; align?: 'left' | 'center' } = {}): void {
    const px = this.setFont(size, options.bold ?? false);
    const align = options.align ?? 'center';
    this.ctx.fillStyle = INK;
    this.ctx.textAlign = align;
    const x = align === 'center' ? this.width / 2 : this.margin;
    for (const line of this.wrap(text, this.inner)) {
      this.ctx.fillText(line, x, this.y);
      this.y += Math.round(px * 1.3);
    }
  }

  /** One line of text centered on a point, without moving the cursor — for labels inside a frame. */
  label(text: string, cx: number, top: number, size: number, bold = false): void {
    this.setFont(size, bold);
    this.ctx.fillStyle = INK;
    this.ctx.textAlign = 'center';
    this.ctx.fillText(text, cx, top);
  }

  /** The largest heading size at which the text fits on two lines. */
  title(text: string): void {
    let size = 28;
    for (const candidate of [58, 50, 42, 34, 28]) {
      this.setFont(candidate, true);
      size = candidate;
      if (this.wrap(text, this.inner).length <= 2) break;
    }
    this.text(text, size, { bold: true });
  }

  row(left: string, right: string, size: number, bold = false): void {
    const px = this.setFont(size, bold);
    this.ctx.fillStyle = INK;
    this.ctx.textAlign = 'left';
    this.ctx.fillText(left, this.margin, this.y);
    this.ctx.textAlign = 'right';
    this.ctx.fillText(right, this.width - this.margin, this.y);
    this.y += Math.round(px * 1.3);
  }

  dashed(): void {
    const thickness = Math.max(2, this.px(3));
    const dash = this.px(10);
    this.ctx.fillStyle = INK;
    for (let x = this.margin; x < this.width - this.margin; x += dash * 2) {
      this.ctx.fillRect(x, this.y, Math.min(dash, this.width - this.margin - x), thickness);
    }
    this.y += thickness;
  }

  solid(): void {
    const thickness = Math.max(2, this.px(3));
    this.ctx.fillStyle = INK;
    this.ctx.fillRect(this.margin, this.y, this.inner, thickness);
    this.y += thickness;
  }

  rect(x: number, y: number, w: number, h: number, color: string = INK): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  /** Line art such as a logo, centered and scaled to fit. */
  image(src: CanvasImageSource, maxWidthShare: number, maxHeight: number): void {
    const { w, h } = sourceSize(src);
    if (!w || !h) return;
    const scale = Math.min((this.inner * maxWidthShare) / w, this.px(maxHeight) / h);
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);
    this.ctx.drawImage(src, Math.round((this.width - dw) / 2), this.y, dw, dh);
    this.y += dh;
  }

  /** Tells the page which photos are the guest's, and how each is zoomed and moved in its slot. */
  usePhotos(photos: (CanvasImageSource | undefined)[], crops: (Crop | undefined)[] = []): void {
    this.slotPhotos = photos;
    this.slotCrops = crops;
  }

  /**
   * Draws a photo with a black border at an exact position, without moving
   * the cursor, and returns the height it takes up. A missing photo leaves an
   * empty grey slot, so a frame can be shown before any photo is taken.
   */
  photoAt(src: CanvasImageSource | undefined, x: number, y: number, width: number, aspect: number, border = 3): number {
    const edge = border > 0 ? Math.max(2, this.px(border)) : 0;
    const height = Math.round(width / aspect);
    if (edge > 0) this.rect(x, y, width, height);

    this.photoIn(src, { x: Math.round(x) + edge, y: Math.round(y) + edge, w: Math.round(width) - edge * 2, h: height - edge * 2 });
    return height;
  }

  /** Fills an exact rectangle with a photo, without a border. A missing photo leaves it grey. */
  photoIn(src: CanvasImageSource | undefined, rect: Rect): void {
    const { w: sw, h: sh } = src ? sourceSize(src) : { w: 0, h: 0 };
    const index = src ? this.slotPhotos.indexOf(src) : -1;
    if (index >= 0) this.slotRects[index] = rect;
    if (src && sw && sh) {
      // Cover the slot, cropping whatever overflows; the guest may have zoomed in and moved the photo.
      const win = cropWindow(sw, sh, rect.w / rect.h, index >= 0 ? this.slotCrops[index] : undefined);
      this.ctx.drawImage(src, win.sx, win.sy, win.sw, win.sh, rect.x, rect.y, rect.w, rect.h);
    } else {
      this.rect(rect.x, rect.y, rect.w, rect.h, '#d2d2d2');
    }
    this.photoRects.push(rect);
  }

  /**
   * Lays a picture over what is already drawn, e.g. a frame design whose transparent holes let the
   * photos underneath show. 'dither' prints its colours as shades; 'ink' as solid black and white.
   */
  overlay(image: CanvasImageSource, rect: Rect, print: 'ink' | 'dither'): void {
    this.ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
    if (print === 'dither') this.artRects.push(rect);
  }

  /** Draws a framed photo at the cursor and returns its height (the cursor is left where it was). */
  photo(src: CanvasImageSource | undefined, x: number, width: number, aspect: number): number {
    return this.photoAt(src, x, this.y, width, aspect);
  }

  star(cx: number, cy: number, radius: number, points = 5): void {
    this.ctx.fillStyle = INK;
    this.ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? radius : radius * 0.42;
      const angle = (Math.PI * i) / points - Math.PI / 2;
      this.ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    }
    this.ctx.closePath();
    this.ctx.fill();
  }

  heart(cx: number, cy: number, size: number): void {
    const s = size / 2;
    this.ctx.fillStyle = INK;
    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy + s);
    this.ctx.bezierCurveTo(cx - s * 2.1, cy - s * 0.3, cx - s * 0.9, cy - s * 1.5, cx, cy - s * 0.45);
    this.ctx.bezierCurveTo(cx + s * 0.9, cy - s * 1.5, cx + s * 2.1, cy - s * 0.3, cx, cy + s);
    this.ctx.fill();
  }

  /** A four-pointed twinkle. */
  sparkle(cx: number, cy: number, radius: number): void {
    this.ctx.fillStyle = INK;
    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy - radius);
    this.ctx.quadraticCurveTo(cx, cy, cx + radius, cy);
    this.ctx.quadraticCurveTo(cx, cy, cx, cy + radius);
    this.ctx.quadraticCurveTo(cx, cy, cx - radius, cy);
    this.ctx.quadraticCurveTo(cx, cy, cx, cy - radius);
    this.ctx.fill();
  }

  /**
   * A QR code centred on the paper, taking up about `share` of the printable
   * width. Thermal dots spread a little, so each square is kept at least
   * MIN_QR_CELL dots wide, and the white border around it is the full four
   * squares scanners expect.
   */
  qr(text: string, share: number): void {
    let code;
    try {
      code = qrcode(0, 'M');
      code.addData(text);
      code.make();
    } catch {
      return; // Text too long for a QR code: leave it out rather than fail the print.
    }
    const quiet = QR_QUIET;
    const modules = code.getModuleCount();
    const cell = qrCellSize(modules, this.inner, this.width, share);
    const total = cell * (modules + quiet * 2);
    const left = Math.round((this.width - total) / 2) + quiet * cell;
    this.ctx.fillStyle = INK;
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        if (code.isDark(r, c)) this.ctx.fillRect(left + c * cell, this.y + (quiet + r) * cell, cell, cell);
      }
    }
    this.y += total;
  }

  /** Decorative bars derived from the session code — receipt flavour, not a scannable barcode. */
  barcode(code: string): void {
    let seed = 0;
    for (const ch of code) seed = (seed * 31 + ch.charCodeAt(0)) & 0x7fffffff;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const unit = Math.max(2, this.px(2));
    const height = this.px(52);
    const end = Math.round(this.width * 0.86);
    this.ctx.fillStyle = INK;
    let x = Math.round(this.width * 0.14);
    while (x < end) {
      const bar = unit * (1 + Math.floor(next() * 3));
      if (x + bar > end) break;
      this.ctx.fillRect(x, this.y, bar, height);
      x += bar + unit * (1 + Math.floor(next() * 3));
    }
    this.y += height + this.px(6);
    this.text(code, 18);
  }

  /** A full-width gradient from white to black, dithered like a photo. */
  ramp(height: number): void {
    const rect: Rect = { x: this.margin, y: this.y, w: this.inner, h: this.px(height) };
    const gradient = this.ctx.createLinearGradient(rect.x, 0, rect.x + rect.w, 0);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(1, '#000');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    this.photoRects.push(rect);
    this.y += rect.h;
  }

  /** Marks both paper edges and every centimetre, to check the printable width. */
  ruler(): void {
    const dotsPerCm = 80; // 203 dpi ≈ 8 dots per millimetre
    const height = this.px(26);
    this.ctx.fillStyle = INK;
    this.ctx.fillRect(0, this.y, this.width, 2);
    for (let x = 0; x < this.width; x += dotsPerCm / 2) {
      this.ctx.fillRect(x, this.y, 2, x % dotsPerCm === 0 ? height : height / 2);
    }
    this.ctx.fillRect(this.width - 2, this.y, 2, height);
    this.y += height;
  }

  finish(): ComposedReceipt {
    const out = document.createElement('canvas');
    out.width = this.width;
    out.height = Math.min(this.canvas.height, Math.ceil(this.y));
    out.getContext('2d', { willReadFrequently: true })!.drawImage(this.canvas, 0, 0);
    return { canvas: out, photoRects: this.photoRects, slotRects: this.slotRects, artRects: this.artRects };
  }
}
