/**
 * Turns drawn pictures into an MP4 file on the tablet itself, with the
 * browser's own H.264 encoder (WebCodecs). No server is involved, and the
 * result plays on iPhones and Android phones alike.
 */
import { createStore } from '../store';
import { writeMp4, type Mp4Sample } from './mp4';

/**
 * Baseline-profile H.264 first: it never reorders frames, which the simple file
 * writer relies on. Level 3.1 covers 720×1280 at 25 frames per second.
 */
const CODECS = ['avc1.42e01f', 'avc1.42001f', 'avc1.4d401f', 'avc1.640028'];
/** The largest picture the booth encodes, checked once at start-up. */
const LARGEST = { width: 720, height: 1280, framerate: 25 };
/** Units per second of the frame durations in the file. */
const TIMESCALE = 90_000;

/** H.264 levels by the largest picture (in 16×16 blocks) and the blocks per second each allows. */
const LEVELS = [
  { level: 0x1f, frame: 3600, rate: 108_000 }, // 3.1
  { level: 0x20, frame: 5120, rate: 216_000 }, // 3.2
  { level: 0x28, frame: 8192, rate: 245_760 }, // 4.0
  { level: 0x32, frame: 22_080, rate: 589_824 }, // 5.0
];

/**
 * The codec string with its level raised as far as a picture of this size
 * needs: a tall receipt is more than level 3.1 allows. A level already high
 * enough is kept.
 */
export function codecFor(codec: string, width: number, height: number, fps: number): string {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const need = LEVELS.find((l) => blocks <= l.frame && blocks * fps <= l.rate)?.level ?? 0x33;
  const current = parseInt(codec.slice(-2), 16);
  if (!Number.isNaN(current) && current >= need) return codec;
  return codec.slice(0, -2) + need.toString(16).padStart(2, '0');
}

/** null until checked; then whether this tablet can make videos at all. */
export const videoSupport = createStore<boolean | null>(null);

let chosen: Promise<string | null> | null = null;

/** The first codec this browser can encode with, or null when it cannot make MP4 videos. */
function codec(): Promise<string | null> {
  chosen ??= (async () => {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
    for (const candidate of CODECS) {
      try {
        const { supported } = await VideoEncoder.isConfigSupported({ codec: candidate, ...LARGEST, bitrate: 2_500_000, avc: { format: 'avc' } });
        if (supported) return candidate;
      } catch {
        // An unknown codec string: try the next one.
      }
    }
    return null;
  })();
  return chosen;
}

/** Finds out once whether this tablet can make videos; the guest flow only offers them when it can. */
export async function checkVideoSupport(): Promise<boolean> {
  const ok = (await codec().catch(() => null)) !== null;
  videoSupport.set(ok);
  return ok;
}

/** Whether this tablet can encode a video of this size; some encoders refuse very tall pictures. */
export async function canEncode(width: number, height: number, fps: number, bitrate: number): Promise<boolean> {
  const use = await codec().catch(() => null);
  if (!use) return false;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({ codec: codecFor(use, width, height, fps), width, height, framerate: fps, bitrate, avc: { format: 'avc' } });
    return supported === true;
  } catch {
    return false;
  }
}

export interface VideoJob {
  /** Even numbers; multiples of 16 are safest for hardware encoders. */
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Bits per second. */
  bitrate: number;
  /** Paints frame `index` onto the whole canvas. */
  draw(ctx: CanvasRenderingContext2D, index: number): void;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Encodes the frames one by one, pausing now and then so the screen stays responsive. */
export async function encodeVideo(job: VideoJob): Promise<Blob> {
  const use = await codec();
  if (!use) throw new Error('Tablet ini tidak bisa membuat video MP4.');
  const canvas = document.createElement('canvas');
  canvas.width = job.width;
  canvas.height = job.height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const frameUs = Math.round(1_000_000 / job.fps);

  const samples: (Mp4Sample & { at: number })[] = [];
  let description: Uint8Array | null = null;
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key', duration: Math.round(((chunk.duration ?? frameUs) * TIMESCALE) / 1_000_000), at: chunk.timestamp });
      const config = metadata?.decoderConfig?.description;
      if (config) description = new Uint8Array(ArrayBuffer.isView(config) ? config.buffer.slice(config.byteOffset, config.byteOffset + config.byteLength) : config.slice(0));
    },
    error: (cause) => {
      failure = cause;
    },
  });
  try {
    encoder.configure({ codec: codecFor(use, job.width, job.height, job.fps), width: job.width, height: job.height, framerate: job.fps, bitrate: job.bitrate, avc: { format: 'avc' } });
    for (let i = 0; i < job.frames; i++) {
      job.draw(ctx, i);
      const frame = new VideoFrame(canvas, { timestamp: i * frameUs, duration: frameUs });
      // A keyframe every two seconds keeps seeking quick.
      encoder.encode(frame, { keyFrame: i % (job.fps * 2) === 0 });
      frame.close();
      if (failure) throw failure;
      while (encoder.encodeQueueSize > 4) await pause(4);
      if (i % 5 === 4) await pause(0);
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) throw failure;
  if (!description) throw new Error('Encoder tidak memberi konfigurasi video.');
  // The file writer stores frames in the order they show; an encoder that reorders them cannot be used.
  if (samples.some((sample, i) => i > 0 && sample.at <= samples[i - 1].at)) throw new Error('Encoder menyusun ulang urutan gambar.');
  const bytes = writeMp4({ width: job.width, height: job.height, timescale: TIMESCALE, avcC: description, samples });
  return new Blob([bytes], { type: 'video/mp4' });
}

/** Rounds a size to a multiple of 16, the block size of H.264. */
export function blockSize(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16);
}

/**
 * Draws a picture so it fills the box completely, cropping what sticks out
 * equally on both sides (like CSS object-fit: cover).
 */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource & { width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
  mirror = false,
): void {
  const scale = Math.max(w / source.width, h / source.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (source.width - sw) / 2;
  const sy = (source.height - sh) / 2;
  ctx.save();
  if (mirror) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    ctx.drawImage(source, sx, sy, sw, sh, x, y, w, h);
  }
  ctx.restore();
}
