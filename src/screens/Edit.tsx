import { useEffect, useState } from 'preact/hooks';
import { PHOTO_STYLES, type PhotoStyle } from '../lib/image/style';
import type { BitImage } from '../lib/image/types';
import { secondsIdle } from '../lib/kiosk';
import { peekSessionNumber } from '../lib/log';
import { activeFrames, type FrameDef } from '../lib/receipt/frames';
import { renderDraft, type Draft } from '../lib/session';
import { useSettings } from '../lib/settings';
import { Overlay, ReceiptPaper, Steps } from '../ui/components';

interface Props {
  draft: Draft;
  onStyle: (style: PhotoStyle) => void;
  onFrame: (frame: FrameDef) => void;
  /** Retake the photo in this slot, or every photo when no slot is given. */
  onRetake: (index?: number) => void;
  onPrint: () => void;
  onCancel: () => void;
}

/** The last seconds before an untouched edit screen prints by itself are counted down on screen. */
const WARN_SECONDS = 15;

/** Step 4: the guest sees the receipt exactly as it will print, and can restyle it or redo photos. */
export function Edit({ draft, onStyle, onFrame, onRetake, onPrint, onCancel }: Props) {
  const settings = useSettings();
  const [bits, setBits] = useState<BitImage | null>(null);
  const [busy, setBusy] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Only frames with the same number of photos can take over the photos already taken.
  const alternatives = activeFrames(settings.frames.active).filter((f) => f.slots.length === draft.frame.slots.length);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    renderDraft(draft, peekSessionNumber(draft.when), settings)
      .then((image) => {
        if (cancelled) return;
        setBits(image);
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
          <div class={`paper-scroll ${busy ? 'busy' : ''}`}>{bits ? <ReceiptPaper bits={bits} /> : <div class="spinner" />}</div>
        </div>

        <div class="edit-tools">
          <div class="titles left">
            <h1 class="heading">Begini hasil cetaknya</h1>
            <p class="lead">Ubah gaya atau ulangi foto sampai kamu suka.</p>
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
            <section class="tool">
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

          <section class="tool">
            <h3>Ulangi foto</h3>
            <div class="retakes">
              {draft.shots.map(
                (shot, i) =>
                  shot && (
                    <button key={i} class="retake" style={{ aspectRatio: String(draft.frame.slots[i]) }} onClick={() => onRetake(i)}>
                      <img src={shot.url} alt="" />
                      <span>↺ Foto {i + 1}</span>
                    </button>
                  ),
              )}
              {draft.shots.length > 1 && (
                <button class="btn quiet small" onClick={() => onRetake()}>
                  ↺ Ulangi semua
                </button>
              )}
            </div>
          </section>

          <div class="edit-actions">
            <button class="btn primary huge glow" disabled={!bits} onClick={onPrint}>
              Cetak sekarang 🖨️
            </button>
            <p class="note">
              {secondsLeft !== null ? `Otomatis dicetak dalam ${secondsLeft} detik…` : `${draft.pkg.prints}x cetak · ${draft.frame.name}`}
            </p>
          </div>
        </div>
      </div>

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
