import { useEffect, useRef, useState } from 'preact/hooks';
import { cropWindow, isPlainCrop, MAX_ZOOM, panCrop, zoomCrop, type Crop } from '../lib/receipt/crop';
import type { Shot } from '../lib/session';
import { Overlay } from '../ui/components';

interface Props {
  shot: Shot;
  /** Width ÷ height of the slot the photo fills. */
  aspect: number;
  /** Photo number, from 0. */
  index: number;
  onSave: (crop: Crop | undefined) => void;
  onRetake: () => void;
  onClose: () => void;
}

const PLAIN: Crop = { zoom: 1, x: 0, y: 0 };
/** Pixels drawn across the viewer; the screen scales it, so it stays sharp without redrawing on resize. */
const VIEW_PIXELS = 960;

/** Lets the guest zoom into one photo and move it within its slot, or take it again. */
export function PhotoAdjust({ shot, aspect, index, onSave, onRetake, onClose }: Props) {
  const [crop, setCrop] = useState<Crop>(shot.crop ?? PLAIN);
  const view = useRef<HTMLCanvasElement>(null);
  // Fingers on the photo, by pointer id: where each one was last seen.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const sourceW = shot.canvas.width;
  const sourceH = shot.canvas.height;

  useEffect(() => {
    const canvas = view.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const win = cropWindow(sourceW, sourceH, aspect, crop);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(shot.canvas, win.sx, win.sy, win.sw, win.sh, 0, 0, canvas.width, canvas.height);
  }, [crop, shot, aspect]);

  const zoomTo = (zoom: number) => setCrop((current) => zoomCrop(current, sourceW, sourceH, aspect, zoom));

  const onPointerDown = (event: PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const onPointerMove = (event: PointerEvent) => {
    const seen = pointers.current;
    const before = seen.get(event.pointerId);
    if (!before) return;
    const width = (event.currentTarget as HTMLElement).clientWidth || 1;
    if (seen.size === 1) {
      // One finger moves the photo.
      const dx = event.clientX - before.x;
      const dy = event.clientY - before.y;
      setCrop((current) => panCrop(current, sourceW, sourceH, aspect, width, dx, dy));
    } else if (seen.size === 2) {
      // Two fingers pinch: zoom by how much further apart they moved.
      const other = [...seen.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const was = Math.hypot(before.x - other.x, before.y - other.y);
        const now = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        if (was > 0) setCrop((current) => zoomCrop(current, sourceW, sourceH, aspect, current.zoom * (now / was)));
      }
    }
    seen.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.current.delete(event.pointerId);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    zoomTo(crop.zoom * Math.exp(-event.deltaY * 0.002));
  };

  return (
    <Overlay onClose={onClose}>
      <div class="card dialog adjust">
        <h2 class="heading small">Atur foto {index + 1}</h2>
        <p class="hint">Geser foto dengan satu jari, cubit dengan dua jari untuk memperbesar.</p>
        <div class="adjust-view" style={{ '--ratio': String(aspect) }}>
          <canvas
            ref={view}
            width={VIEW_PIXELS}
            height={Math.round(VIEW_PIXELS / aspect)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          />
        </div>
        <label class="adjust-zoom">
          <span>Perbesar</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onInput={(event) => zoomTo(Number(event.currentTarget.value))}
            aria-label="Perbesar foto"
          />
          <button class="btn small quiet" disabled={isPlainCrop(crop)} onClick={() => setCrop(PLAIN)}>
            Atur ulang
          </button>
        </label>
        <div class="row center">
          <button class="btn" onClick={onRetake}>
            ↺ Ulangi foto ini
          </button>
          <button class="btn primary" onClick={() => onSave(isPlainCrop(crop) ? undefined : crop)}>
            Simpan
          </button>
        </div>
        <button class="link" onClick={onClose}>
          Batal
        </button>
      </div>
    </Overlay>
  );
}
