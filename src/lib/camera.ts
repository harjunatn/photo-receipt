import { drawDemoScene } from './demoScene';

export interface CameraHandle {
  stream: MediaStream;
  label: string;
  /** True when this is the generated test picture, not a real camera. */
  demo: boolean;
  stop(): void;
}

export const DEMO_CAMERA_ID = 'demo';

export function demoRequested(): boolean {
  return new URLSearchParams(location.search).has('demo');
}

/**
 * Opens the chosen camera: '' picks the front camera, 'demo' a generated test
 * picture (so the whole flow can be tried on a device without a camera).
 */
export async function startCamera(cameraId: string): Promise<CameraHandle> {
  if (cameraId === DEMO_CAMERA_ID || demoRequested()) return startDemoCamera();

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Browser ini tidak mengizinkan akses kamera. Buka lewat HTTPS di Chrome.');
  }
  const base: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1440 } };
  const video: MediaTrackConstraints = cameraId
    ? { ...base, deviceId: { exact: cameraId } }
    : { ...base, facingMode: 'user' };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (error) {
    // A saved camera may have been unplugged; fall back to whatever camera exists.
    if (cameraId && error instanceof DOMException && ['OverconstrainedError', 'NotFoundError'].includes(error.name)) {
      stream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
    } else {
      throw new Error(describeCameraError(error));
    }
  }
  const track = stream.getVideoTracks()[0];
  return {
    stream,
    label: track?.label || 'Kamera',
    demo: false,
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}

function describeCameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError') return 'Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser.';
  if (name === 'NotFoundError') return 'Kamera tidak ditemukan di perangkat ini.';
  if (name === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.';
  return `Kamera gagal dibuka${error instanceof Error ? `: ${error.message}` : '.'}`;
}

export async function listCameras(): Promise<{ id: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput' && d.deviceId)
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Kamera ${i + 1}` }));
}

/**
 * Copies the whole current video frame. It is cropped to a frame's photo shape
 * only when the receipt is drawn (centered, the same way the viewfinder crops
 * it), so the guest can still switch to another frame afterwards.
 */
export function grabFrame(video: HTMLVideoElement, mirror: boolean, longSide = 1600): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error('Kamera belum siap.');

  const scale = Math.min(1, longSide / Math.max(vw, vh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext('2d')!;
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Gagal menyimpan foto.'))), 'image/jpeg', quality);
  });
}

/** A moving, photo-like test picture, so the flow and the dithering can be judged without a camera. */
function startDemoCamera(): CameraHandle {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 960;
  const ctx = canvas.getContext('2d')!;
  const started = performance.now();
  const draw = () => {
    drawDemoScene(ctx, canvas.width, canvas.height, (performance.now() - started) / 1000);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, canvas.height - 64, canvas.width, 64);
    ctx.fillStyle = '#fff';
    ctx.font = '600 30px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('KAMERA DEMO — gambar uji, bukan kamera asli', 28, canvas.height - 32);
  };
  draw();
  // A timer rather than requestAnimationFrame, so frames keep coming while the tab is in the background.
  const timer = setInterval(draw, 42);

  const stream = canvas.captureStream(24);
  return {
    stream,
    label: 'Kamera demo',
    demo: true,
    stop: () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
