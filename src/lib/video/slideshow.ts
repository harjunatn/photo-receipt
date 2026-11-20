/**
 * The slideshow: the session's photos one after another, in colour and framed
 * the way the guest chose, then the whole colour receipt scrolling past. Upright
 * 9:16, the shape of an Instagram or TikTok story.
 */
import { encodeVideo } from './encode';

export const SLIDESHOW = {
  width: 720,
  height: 1280,
  fps: 25,
  bitrate: 2_500_000,
  /** Seconds each photo shows when there are three or more; fewer photos stay longer. */
  hold: 1.6,
  holdFew: 2.2,
  /** Seconds of the closing receipt. */
  receipt: 3.4,
  /** Seconds one picture takes to fade into the next. */
  fade: 0.4,
};

export interface SlidePlan {
  /** Photos first, then (when there is one) the receipt. */
  durations: number[];
  starts: number[];
  /** Seconds in all. */
  total: number;
}

/** When each picture appears and for how long; consecutive pictures overlap by the fade. */
export function slidePlan(photos: number, withReceipt: boolean): SlidePlan {
  const hold = photos <= 2 ? SLIDESHOW.holdFew : SLIDESHOW.hold;
  const durations = [...Array.from({ length: photos }, () => hold), ...(withReceipt ? [SLIDESHOW.receipt] : [])];
  const starts: number[] = [];
  let at = 0;
  for (const duration of durations) {
    starts.push(at);
    at += duration - SLIDESHOW.fade;
  }
  return { durations, starts, total: durations.length ? at + SLIDESHOW.fade : 0 };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The pictures on screen at second `t`, oldest first, with how far along each is (0…1) and how visible. */
export function slidesAt(plan: SlidePlan, t: number): { item: number; progress: number; alpha: number }[] {
  const last = plan.durations.length - 1;
  const shown: { item: number; progress: number; alpha: number }[] = [];
  plan.durations.forEach((duration, item) => {
    const start = plan.starts[item];
    const end = item === last ? Infinity : start + duration;
    if (t < start || t >= end) return;
    const fadeIn = item === 0 ? 1 : clamp01((t - start) / SLIDESHOW.fade);
    const fadeOut = item === last ? 1 : 1 - clamp01((t - plan.starts[item + 1]) / SLIDESHOW.fade);
    shown.push({ item, progress: clamp01((t - start) / duration), alpha: fadeIn * fadeOut });
  });
  return shown;
}

export interface SlideshowInput {
  /** Each photo with the part the guest framed in its slot. */
  photos: { source: CanvasImageSource; window: { sx: number; sy: number; sw: number; sh: number } }[];
  /** The colour receipt, or null to end on the last photo. */
  receipt: HTMLCanvasElement | null;
  /** The outlet's name at the top. */
  title: string;
  /** The outlet's colour, for the full stop after the name. */
  accent: string;
  when: Date;
  /** Small line at the bottom, e.g. the platform's social account. */
  footer: string;
}

const PAGE = '#f6f3ee';
const INK = '#1b1a18';
const MUTED = '#8b867d';
const DISPLAY = "'Instrument Serif', 'Times New Roman', serif";
const MONO = "'Space Mono', ui-monospace, Menlo, monospace";
/** Where the pictures go: between the name at the top and the line at the bottom. */
const AREA = { x: 60, y: 270, w: 600, h: 860 };

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

function drawHeader(ctx: CanvasRenderingContext2D, input: SlideshowInput, date: string): void {
  const { width } = SLIDESHOW;
  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, width, SLIDESHOW.height);

  const title = input.title.trim();
  if (title) {
    let size = 84;
    ctx.font = `400 ${size}px ${DISPLAY}`;
    const fits = (width - 100) / ctx.measureText(`${title}.`).width;
    if (fits < 1) size = Math.max(36, Math.floor(size * fits));
    ctx.font = `400 ${size}px ${DISPLAY}`;
    const wordWidth = ctx.measureText(title).width;
    const dotWidth = ctx.measureText('.').width;
    const x = (width - wordWidth - dotWidth) / 2;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.fillText(title, x, 180);
    ctx.fillStyle = input.accent || '#c2552d';
    ctx.fillText('.', x + wordWidth, 180);
  }
  ctx.font = `400 20px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.fillText(date, width / 2, 226);
  if (input.footer.trim()) {
    ctx.font = `700 22px ${MONO}`;
    ctx.fillText(input.footer.trim(), width / 2, 1212);
  }
}

/** One photo as a white-bordered print, gently zooming in, tilted a little this way or that. */
function drawPhoto(ctx: CanvasRenderingContext2D, photo: SlideshowInput['photos'][number], index: number, progress: number, alpha: number): void {
  const border = 18;
  const { sx, sy, sw, sh } = photo.window;
  const aspect = sw / sh;
  const maxW = AREA.w - border * 2 - 20;
  const maxH = AREA.h - border * 2 - 20;
  const w = Math.min(maxW, maxH * aspect);
  const h = w / aspect;
  // Ken Burns: the visible part shrinks around its middle by up to 6 %.
  const zoom = 1 + 0.06 * progress;
  const zw = sw / zoom;
  const zh = sh / zoom;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(AREA.x + AREA.w / 2, AREA.y + AREA.h / 2 + (1 - alpha) * 36);
  ctx.rotate(((index % 2 === 0 ? -1.4 : 1.2) * Math.PI) / 180);
  ctx.shadowColor = 'rgba(27,26,24,0.18)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-w / 2 - border, -h / 2 - border, w + border * 2, h + border * 2);
  ctx.shadowColor = 'transparent';
  ctx.drawImage(photo.source, sx + (sw - zw) / 2, sy + (sh - zh) / 2, zw, zh, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** The whole receipt, scrolling from its top to its bottom when it is taller than the space. */
function drawReceipt(ctx: CanvasRenderingContext2D, receipt: HTMLCanvasElement, progress: number, alpha: number): void {
  const w = 500;
  const h = (receipt.height * w) / receipt.width;
  const x = (SLIDESHOW.width - w) / 2;
  const travel = Math.max(0, h - AREA.h);
  // Holds still for a moment at the top and at the bottom.
  const y = AREA.y - travel * ease(clamp01((progress - 0.15) / 0.7)) + (h < AREA.h ? (AREA.h - h) / 2 : 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.rect(0, AREA.y - 24, SLIDESHOW.width, AREA.h + 48);
  ctx.clip();
  ctx.shadowColor = 'rgba(27,26,24,0.16)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.shadowColor = 'transparent';
  ctx.drawImage(receipt, x, y, w, h);
  ctx.restore();
}

/** The slideshow as an MP4 file. */
export async function makeSlideshow(input: SlideshowInput): Promise<Blob> {
  if (input.photos.length === 0) throw new Error('Tidak ada foto untuk slideshow.');
  // Canvas text quietly falls back to another font unless the web font is loaded first.
  await Promise.all([
    document.fonts.load(`400 84px ${DISPLAY}`),
    document.fonts.load(`400 20px ${MONO}`),
    document.fonts.load(`700 22px ${MONO}`),
  ]).catch(() => undefined);
  const plan = slidePlan(input.photos.length, input.receipt !== null);
  const date = input.when.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  return encodeVideo({
    width: SLIDESHOW.width,
    height: SLIDESHOW.height,
    fps: SLIDESHOW.fps,
    frames: Math.ceil(plan.total * SLIDESHOW.fps),
    bitrate: SLIDESHOW.bitrate,
    draw: (ctx, index) => {
      drawHeader(ctx, input, date);
      for (const slide of slidesAt(plan, index / SLIDESHOW.fps)) {
        if (slide.item < input.photos.length) drawPhoto(ctx, input.photos[slide.item], slide.item, slide.progress, slide.alpha);
        else if (input.receipt) drawReceipt(ctx, input.receipt, slide.progress, slide.alpha);
      }
    },
  });
}
