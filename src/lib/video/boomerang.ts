/**
 * The boomerang: a second and a half of the camera, played forwards and
 * backwards a few times, sped up. The camera's preview is already a video, so
 * the booth only has to keep a burst of pictures from it.
 */
import { blockSize, drawCover, encodeVideo } from './encode';

export const BOOMERANG = {
  /** Pictures kept from the camera… */
  frames: 20,
  /** …one every this many milliseconds (1.6 seconds in all). */
  intervalMs: 80,
  /** Played at twice the speed they were taken. */
  fps: 25,
  /** Forwards and back this many times; the video player then loops it seamlessly. */
  loops: 3,
  /** Longer side of the video, in pixels. */
  longSide: 960,
  bitrate: 3_000_000,
};

/** Which picture each video frame shows: 0…n-1 forwards, n-2…1 back, repeated. Ends just before 0, so a looping player continues smoothly. */
export function boomerangOrder(count: number, loops: number): number[] {
  if (count <= 1) return Array.from({ length: Math.max(1, loops) }, () => 0);
  const once = [...Array.from({ length: count }, (_, i) => i), ...Array.from({ length: count - 2 }, (_, i) => count - 2 - i)];
  return Array.from({ length: loops }, () => once).flat();
}

/** The size of the boomerang for a camera picture of this size: same shape, longer side `longSide`, in whole blocks. */
export function boomerangSize(width: number, height: number, longSide = BOOMERANG.longSide): { width: number; height: number } {
  const scale = longSide / Math.max(width, height);
  return { width: blockSize(width * scale), height: blockSize(height * scale) };
}

/**
 * Keeps `frames` pictures from the live camera, `intervalMs` apart, already
 * scaled down. `onProgress` gets 0…1 as the burst goes.
 */
export async function recordBurst(video: HTMLVideoElement, onProgress?: (done: number) => void): Promise<ImageBitmap[]> {
  if (!video.videoWidth || !video.videoHeight) throw new Error('Kamera belum siap.');
  const size = boomerangSize(video.videoWidth, video.videoHeight);
  const pictures: ImageBitmap[] = [];
  const started = performance.now();
  try {
    for (let i = 0; i < BOOMERANG.frames; i++) {
      const due = started + i * BOOMERANG.intervalMs;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      pictures.push(await createImageBitmap(video, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'medium' }));
      onProgress?.((i + 1) / BOOMERANG.frames);
    }
  } catch (cause) {
    pictures.forEach((picture) => picture.close());
    throw cause;
  }
  return pictures;
}

/**
 * The boomerang as an MP4 file. `caption` is a small line at the bottom (the
 * outlet and the platform), empty for none. The pictures are released afterwards.
 */
export async function makeBoomerang(pictures: ImageBitmap[], mirror: boolean, caption: string): Promise<Blob> {
  try {
    const { width, height } = pictures[0];
    const order = boomerangOrder(pictures.length, BOOMERANG.loops);
    const fontSize = Math.round(Math.min(width, height) / 30);
    return await encodeVideo({
      width,
      height,
      fps: BOOMERANG.fps,
      frames: order.length,
      bitrate: BOOMERANG.bitrate,
      draw: (ctx, index) => {
        drawCover(ctx, pictures[order[index]], 0, 0, width, height, mirror);
        if (!caption) return;
        ctx.save();
        ctx.font = `600 ${fontSize}px 'Inter Variable', Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = fontSize / 2;
        ctx.fillText(caption, width / 2, height - fontSize * 1.2, width * 0.9);
        ctx.restore();
      },
    });
  } finally {
    pictures.forEach((picture) => picture.close());
  }
}
