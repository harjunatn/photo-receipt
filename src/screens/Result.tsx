import { useEffect, useRef, useState } from 'preact/hooks';
import { canvasToBlob } from '../lib/camera';
import { saveSession } from '../lib/db';
import type { BitImage } from '../lib/image/types';
import { pokeIdle } from '../lib/kiosk';
import { addLogEntry, nextSessionNumber } from '../lib/log';
import { printer, usePrinter } from '../lib/printer/manager';
import { renderDraft, type Draft } from '../lib/session';
import { settingsStore } from '../lib/settings';
import { sound } from '../lib/sound';
import { redeemVoucher, voucherStore } from '../lib/vouchers';
import { PinPad, ReceiptPaper, Steps } from '../ui/components';

interface Props {
  draft: Draft;
  onFinish: () => void;
}

type Phase = 'preparing' | 'ready' | 'printing' | 'done' | 'no-printer' | 'error';

/** Seconds the "take your receipt" message stays up before the booth resets for the next guest. */
const RETURN_SECONDS = 15;

/** Step 5: records the session, prints the receipt and sends the guest off. */
export function Result({ draft, onFinish }: Props) {
  const printerState = usePrinter();
  const [bits, setBits] = useState<BitImage | null>(null);
  const [phase, setPhase] = useState<Phase>('preparing');
  const [message, setMessage] = useState('');
  const [askPin, setAskPin] = useState(false);
  const [staff, setStaff] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RETURN_SECONDS);
  const started = useRef(false);

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

        if (draft.voucherCode) {
          voucherStore.set(redeemVoucher(voucherStore.get(), draft.voucherCode, Date.now()));
        }
        addLogEntry({
          at: draft.when.getTime(),
          no: sessionNo,
          packageName: `${draft.frame.name} · ${draft.pkg.name}`,
          price: draft.pkg.price,
          method: draft.method,
          voucher: draft.voucherCode,
          prints: draft.pkg.prints,
        });
        if (settings.storage.keepPhotos) {
          // Saved in the background: a full disk must not stop the guest's print.
          const taken = draft.shots.flatMap((shot) => (shot ? [shot.canvas] : []));
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
                },
                settings.storage.maxSessions,
              ),
            )
            .catch(() => undefined);
        }

        if (settings.printer.autoPrint) await print(image);
        else setPhase('ready');
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
    setSecondsLeft(RETURN_SECONDS);
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

          {phase === 'ready' && (
            <>
              <h1 class="heading">Strukmu siap!</h1>
              <button class="btn primary huge glow" onClick={() => bits && void print(bits)}>
                Cetak sekarang 🖨️
              </button>
            </>
          )}

          {phase === 'printing' && (
            <>
              <h1 class="heading">Sedang mencetak…</h1>
              <div class="progress">
                <i style={{ width: `${Math.round(printerState.progress * 100)}%` }} />
              </div>
              <p class="lead">Tunggu sampai kertas berhenti keluar, ya.</p>
            </>
          )}

          {phase === 'done' && (
            <>
              <span class="tag ok">Selesai</span>
              <h1 class="heading">Ambil strukmu di bawah! 🎉</h1>
              <p class="lead">Terima kasih sudah berfoto. Sampai jumpa lagi!</p>
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
