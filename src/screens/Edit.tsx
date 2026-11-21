import { useEffect, useRef, useState } from 'preact/hooks';
import { PHOTO_STYLES, type PhotoStyle } from '../lib/image/style';
import type { BitImage } from '../lib/image/types';
import { secondsIdle } from '../lib/kiosk';
import { peekSessionNumber } from '../lib/log';
import { paintBits } from '../lib/receipt/compose';
import type { Crop } from '../lib/receipt/crop';
import { activeFrames, type FrameDef } from '../lib/receipt/frames';
import { renderPreviews, type Draft, type EditPreview } from '../lib/session';
import { useSettings } from '../lib/settings';
import { Overlay, Steps } from '../ui/components';
import { PhotoAdjust } from './PhotoAdjust';

interface Props {
  draft: Draft;
  onStyle: (style: PhotoStyle) => void;
  onFrame: (frame: FrameDef) => void;
  /** Retake the photo in this slot, or every photo when no slot is given. */
  onRetake: (index?: number) => void;
  /** Keep how the guest zoomed and moved one photo; undefined puts it back as taken. */
  onCrop: (index: number, crop: Crop | undefined) => void;
  onPrint: () => void;
  onCancel: () => void;
}

/** The last seconds before an untouched edit screen prints by itself are counted down on screen. */
const WARN_SECONDS = 15;

/** Step 4: the guest sees the receipt exactly as it will print, and can restyle it or redo photos. */
export function Edit({ draft, onStyle, onFrame, onRetake, onCrop, onPrint, onCancel }: Props) {
  const settings = useSettings();
  const [previews, setPreviews] = useState<Awaited<ReturnType<typeof renderPreviews>> | null>(null);
  const [busy, setBusy] = useState(true);
  const [adjusting, setAdjusting] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Only frames with the same number of photos can take over the photos already taken.
  const alternatives = activeFrames(settings.frames.active).filter((f) => f.slots.length === draft.frame.slots.length);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    renderPreviews(draft, peekSessionNumber(draft.when), settings)
      .then((made) => {
        if (cancelled) return;
        setPreviews(made);
        setBusy(false);
      })
      .catch(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.frame, draft.style, draft.shots, settings.receipt, settings.printer.dots, settings.printer.raster]);

  useEffect(() => {
    const timer = setInterval(() => {
      const left = Math.ceil(settings.session.idleSec - secondsIdle());
      setSecondsLeft(left <= WARN_SECONDS ? Math.max(0, left) : null);
    }, 500);
    return () => clearInterval(timer);
  }, [settings.session.idleSec]);

  return (
    <div class="screen">
      <header class="bar">
        <button class="btn quiet" onClick={() => setConfirmCancel(true)}>
          ✕ Batal
        </button>
        <Steps current={3} />
        <span class="bar-end" />
      </header>

      <div class="edit">
        <div class="edit-preview">
          <div class={`paper-scroll ${busy ? 'busy' : ''}`}>
            {previews ? (
              <div class="edit-pair">
                <figure>
                  <figcaption>Berwarna{draft.shareCode ? ' · untuk diunduh' : ''}</figcaption>
                  <SlotPaper preview={previews.colour} source={previews.colour.canvas} onSlot={setAdjusting} />
                </figure>
                <figure>
                  <figcaption>Hasil cetak</figcaption>
                  <SlotPaper preview={previews.print} source={previews.print.bits} onSlot={setAdjusting} />
                </figure>
              </div>
            ) : (
              <div class="spinner" />
            )}
          </div>
        </div>

        <div class="edit-tools">
          <div class="titles left">
            <h1 class="heading">Begini hasil fotomu</h1>
            <p class="lead">Ketuk foto untuk memperbesar, menggeser, atau mengulanginya.</p>
          </div>

          {settings.session.guestStyles && (
            <section class="tool">
              <h3>Gaya foto</h3>
              <div class="chips">
                {PHOTO_STYLES.map((style) => (
                  <button key={style.id} class={`chip ${style.id === draft.style ? 'on' : ''}`} onClick={() => onStyle(style.id)}>
                    {style.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {alternatives.length > 1 && (
            <section class="tool frame-choice">
              <h3>Frame</h3>
              <div class="chips">
                {alternatives.map((frame) => (
                  <button key={frame.id} class={`chip ${frame.id === draft.frame.id ? 'on' : ''}`} onClick={() => onFrame(frame)}>
                    {frame.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          {draft.shots.length > 1 && (
            <section class="tool">
              <button class="btn quiet small" onClick={() => onRetake()}>
                ↺ Ulangi semua foto
              </button>
            </section>
          )}

          <div class="edit-actions">
            <button class="btn primary huge glow" disabled={!previews} onClick={onPrint}>
              Cetak sekarang
            </button>
            <p class="note">
              {secondsLeft !== null ? `Otomatis dicetak dalam ${secondsLeft} detik…` : `${draft.pkg.prints}x cetak · ${draft.frame.name}`}
            </p>
          </div>
        </div>
      </div>

      {adjusting !== null && draft.shots[adjusting] && (
        <PhotoAdjust
          shot={draft.shots[adjusting]!}
          aspect={draft.frame.slots[adjusting]}
          index={adjusting}
          onSave={(crop) => {
            onCrop(adjusting, crop);
            setAdjusting(null);
          }}
          onRetake={() => {
            setAdjusting(null);
            onRetake(adjusting);
          }}
          onClose={() => setAdjusting(null)}
        />
      )}

      {confirmCancel && (
        <Overlay onClose={() => setConfirmCancel(false)}>
          <div class="card dialog">
            <h2 class="heading small">Batalkan tanpa mencetak?</h2>
            <p class="lead">Fotomu akan dihapus dan sesi ini tidak bisa dilanjutkan lagi.</p>
            <div class="row center">
              <button class="btn" onClick={() => setConfirmCancel(false)}>
                Kembali mengedit
              </button>
              <button class="btn danger" onClick={onCancel}>
                Ya, batalkan
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}

/** A receipt on paper whose photos can be tapped to adjust them. */
function SlotPaper({
  preview,
  source,
  onSlot,
}: {
  preview: EditPreview;
  source: BitImage | HTMLCanvasElement;
  onSlot: (index: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    if (source instanceof HTMLCanvasElement) target.getContext('2d')!.drawImage(source, 0, 0);
    else paintBits(target, source);
  }, [source]);
  const pct = (value: number, of: number) => `${(value / of) * 100}%`;
  return (
    <div class="paper">
      <div class="slot-host">
        <canvas ref={canvas} width={preview.width} height={preview.height} />
        {preview.slots.map(
          (rect, i) =>
            rect && (
              <button
                key={i}
                class="slot-hit"
                style={{ left: pct(rect.x, preview.width), top: pct(rect.y, preview.height), width: pct(rect.w, preview.width), height: pct(rect.h, preview.height) }}
                aria-label={`Atur foto ${i + 1}`}
                onClick={() => onSlot(i)}
              >
                <span>✎ {i + 1}</span>
              </button>
            ),
        )}
      </div>
    </div>
  );
}
