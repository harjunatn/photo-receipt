import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { canvasToBlob } from '../lib/camera';
import { queueTransaction } from '../lib/cloud/device';
import { SHARE_DAYS, shareUrl } from '../lib/cloud/shared';
import { qrShape } from '../lib/qr';
import { saveSession } from '../lib/db';
import type { BitImage } from '../lib/image/types';
import { pokeIdle } from '../lib/kiosk';
import { addLogEntry, nextSessionNumber } from '../lib/log';
import { printer, usePrinter } from '../lib/printer/manager';
import { renderDigital, renderDraft, type Draft } from '../lib/session';
import { settingsStore } from '../lib/settings';
import { sound } from '../lib/sound';
import { PinPad, ReceiptPaper, Steps } from '../ui/components';

interface Props {
  draft: Draft;
  onFinish: () => void;
}

type Phase = 'preparing' | 'printing' | 'done' | 'no-printer' | 'error';

/** Seconds the "take your receipt" message stays up before the booth resets for the next guest. */
const RETURN_SECONDS = 15;
/** Longer when there is a download QR code on screen, so the guest has time to scan it. */
const RETURN_SECONDS_WITH_QR = 30;

/** Step 5: records the session, prints the receipt and sends the guest off. */
export function Result({ draft, onFinish }: Props) {
  const printerState = usePrinter();
  const [bits, setBits] = useState<BitImage | null>(null);
  const [phase, setPhase] = useState<Phase>('preparing');
  const [message, setMessage] = useState('');
  const [askPin, setAskPin] = useState(false);
  const [staff, setStaff] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RETURN_SECONDS_WITH_QR);
  const started = useRef(false);
  const returnSeconds = draft.shareCode ? RETURN_SECONDS_WITH_QR : RETURN_SECONDS;

  const print = async (image: BitImage) => {
    if (printer.state.get().status === 'disconnected') await printer.reconnect();
    if (printer.state.get().status !== 'connected') {
      setPhase('no-printer');
      return;
    }
    setPhase('printing');
    try {
      await printer.print(image, draft.pkg.prints);
      sound.done();
      setPhase('done');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Gagal mencetak.');
      setPhase('error');
    }
  };

  useEffect(() => {
    // Recording the session must happen exactly once, even if the component re-renders.
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const settings = settingsStore.get();
        const sessionNo = nextSessionNumber(draft.when);
        const image = await renderDraft(draft, sessionNo, settings);
        setBits(image);

        addLogEntry({
          at: draft.when.getTime(),
          no: sessionNo,
          packageName: `${draft.frame.name} · ${draft.pkg.name}`,
          price: draft.pkg.price,
          method: draft.method,
          voucher: draft.voucherCode,
          prints: draft.pkg.prints,
        });
        queueTransaction({
          id: crypto.randomUUID(),
          at: draft.when.toISOString(),
          session_no: sessionNo,
          frame: draft.frame.name,
          package: draft.pkg.name,
          price: draft.pkg.price,
          method: draft.method,
          voucher_code: draft.voucherCode ?? null,
          prints: draft.pkg.prints,
          payment_id: draft.paymentId ?? null,
          share_code: draft.shareCode ?? null,
        });
        if (draft.shareCode) {
          const code = draft.shareCode;
          // Made a moment later, so that building the colour copy never holds up the print.
          setTimeout(() => {
            void renderDigital(draft, sessionNo, settings)
              .then(({ photo, thumb }) =>
                import('../lib/cloud/upload').then(({ queueShareFiles }) =>
                  queueShareFiles(code, [
                    { kind: 'thumb', blob: thumb },
                    { kind: 'photo', blob: photo },
                  ]),
                ),
              )
              .catch(() => undefined);
          }, 1500);
        }
        if (settings.storage.keepPhotos) {
          // Saved in the background: a full disk must not stop the guest's print.
          const taken = draft.shots.flatMap((shot) => (shot ? [shot.canvas] : []));
          const crops = draft.shots.flatMap((shot) => (shot ? [shot.crop ?? null] : []));
          void Promise.all(taken.map((canvas) => canvasToBlob(canvas)))
            .then((photos) =>
              saveSession(
                {
                  id: crypto.randomUUID(),
                  no: sessionNo,
                  createdAt: draft.when.getTime(),
                  packageName: `${draft.frame.name} · ${draft.pkg.name}`,
                  price: draft.pkg.price,
                  method: draft.method,
                  frameId: draft.frame.id,
                  style: draft.style,
                  quote: draft.quote,
                  photos,
                  crops,
                },
                settings.storage.maxSessions,
              ),
            )
            .catch(() => undefined);
        }

        // The guest chose to print on the edit screen, so the receipt goes out right away.
        await print(image);
      } catch (cause) {
        setMessage(cause instanceof Error ? cause.message : 'Struk gagal disusun.');
        setPhase('error');
      }
    })();
  }, []);

  // A long print has no touches; keep the idle timer from ending the session mid-print.
  useEffect(() => {
    if (phase === 'printing' || phase === 'preparing') pokeIdle();
  }, [phase, printerState.progress]);

  useEffect(() => {
    if (phase !== 'done') return;
    setSecondsLeft(returnSeconds);
    const timer = setInterval(() => setSecondsLeft((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === 'done' && secondsLeft <= 0) onFinish();
  }, [phase, secondsLeft]);

  const connectAndPrint = async () => {
    if ((await printer.connect()) && bits) await print(bits);
  };

  return (
    <div class="screen">
      <header class="bar">
        <span class="bar-end" />
        <Steps current={4} />
        <span class="bar-end" />
      </header>

      <div class="result">
        <div class="result-paper">
          <div class="paper-scroll">{bits ? <ReceiptPaper bits={bits} /> : <div class="spinner" />}</div>
        </div>

        <div class="result-info">
          {printerState.kind === 'preview' && phase !== 'preparing' && (
            <span class="tag warn">Mode simulasi — tidak ada kertas yang keluar</span>
          )}

          {phase === 'preparing' && <h1 class="heading">Menyiapkan strukmu…</h1>}

          {phase === 'printing' && (
            <>
              <h1 class="heading">Sedang mencetak…</h1>
              <div class="progress">
                <i style={{ width: `${Math.round(printerState.progress * 100)}%` }} />
              </div>
              <p class="lead">Tunggu sampai kertas berhenti keluar, ya.</p>
              {/* Guests can already scan while the receipt prints. */}
              {draft.shareCode && <ShareCode code={draft.shareCode} />}
            </>
          )}

          {phase === 'done' && (
            <>
              <span class="tag ok">Selesai</span>
              <h1 class="heading">Ambil strukmu di bawah</h1>
              {draft.shareCode ? <ShareCode code={draft.shareCode} /> : <p class="lead">Terima kasih sudah berfoto. Sampai jumpa lagi!</p>}
              <button class="btn primary huge" onClick={onFinish}>
                Selesai ({Math.max(0, secondsLeft)})
              </button>
            </>
          )}

          {(phase === 'no-printer' || phase === 'error') && (
            <>
              <span class="tag err">{phase === 'no-printer' ? 'Printer belum siap' : 'Gagal mencetak'}</span>
              <h1 class="heading">Mohon panggil petugas</h1>
              <p class="lead">
                {phase === 'error' ? message : 'Printer belum terhubung.'} Fotomu aman tersimpan dan bisa dicetak ulang.
              </p>
              {draft.shareCode && <ShareCode code={draft.shareCode} />}
              {staff ? (
                <div class="row">
                  <button class="btn primary" onClick={() => void connectAndPrint()}>
                    Hubungkan printer & cetak
                  </button>
                  <button class="btn" disabled={!bits} onClick={() => bits && void print(bits)}>
                    Coba cetak lagi
                  </button>
                </div>
              ) : (
                <button class="btn primary" onClick={() => setAskPin(true)}>
                  Petugas: perbaiki printer
                </button>
              )}
              {printerState.error && staff && <p class="error-text">{printerState.error}</p>}
              <button class="link" onClick={onFinish}>
                Selesai tanpa mencetak
              </button>
            </>
          )}
        </div>
      </div>

      {askPin && (
        <PinPad
          title="Perbaiki printer"
          onCancel={() => setAskPin(false)}
          onSuccess={() => {
            setAskPin(false);
            setStaff(true);
          }}
        />
      )}
    </div>
  );
}

/** The download QR code on screen, for guests who reach for their phone before their receipt. */
function ShareCode({ code }: { code: string }) {
  const shape = useMemo(() => qrShape(shareUrl(code)), [code]);
  if (!shape) return null;
  return (
    <div class="result-share">
      <svg viewBox={`0 0 ${shape.size} ${shape.size}`} role="img" aria-label="Kode QR untuk mengunduh foto" shape-rendering="crispEdges">
        <rect width={shape.size} height={shape.size} fill="#fff" />
        <path d={shape.path} fill="#000" />
      </svg>
      <div>
        <b>Scan untuk unduh fotomu</b>
        <span class="note">Foto berwarna dengan frame, tersedia {SHARE_DAYS} hari. Kode yang sama juga tercetak di struk.</span>
      </div>
    </div>
  );
}
