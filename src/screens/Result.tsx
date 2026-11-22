import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { canvasToBlob } from '../lib/camera';
import { pairingStore, queueTransaction } from '../lib/cloud/device';
import { boothTitle, SHARE_DAYS, shareUrl } from '../lib/cloud/shared';
import { qrShape } from '../lib/qr';
import { saveSession } from '../lib/db';
import type { BitImage } from '../lib/image/types';
import { pokeIdle } from '../lib/kiosk';
import { addLogEntry, EXTRA_COPY_PACKAGE, nextSessionNumber } from '../lib/log';
import { printer, usePrinter } from '../lib/printer/manager';
import { renderDigital, renderDraft, renderFrameBoomerang, renderPlainPhotos, renderSlideshow, type Draft } from '../lib/session';
import { formatRupiah, settingsStore } from '../lib/settings';
import { sound } from '../lib/sound';
import { Overlay, PinPad, ReceiptPaper, Steps } from '../ui/components';

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
  // Staff unlock this screen once with their PIN, to fix the printer or print another copy.
  const [askPin, setAskPin] = useState<'fix' | 'reprint' | null>(null);
  const [staff, setStaff] = useState(false);
  // Staff choose whether one more copy is paid for or replaces a spoilt print.
  const [chooseCopy, setChooseCopy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RETURN_SECONDS_WITH_QR);
  const started = useRef(false);
  const sessionNo = useRef<number | null>(null);
  const returnSeconds = draft.shareCode ? RETURN_SECONDS_WITH_QR : RETURN_SECONDS;
  // One more copy costs what one sheet of the chosen price costs.
  const copyPrice = Math.round(draft.pkg.price / Math.max(1, draft.pkg.prints));

  /** Prints the image; false when it did not come out. */
  const print = async (image: BitImage, copies = draft.pkg.prints): Promise<boolean> => {
    if (printer.state.get().status === 'disconnected') await printer.reconnect();
    if (printer.state.get().status !== 'connected') {
      setPhase('no-printer');
      return false;
    }
    setPhase('printing');
    try {
      await printer.print(image, copies);
      sound.done();
      setPhase('done');
      return true;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Gagal mencetak.');
      setPhase('error');
      return false;
    }
  };

  useEffect(() => {
    // Recording the session must happen exactly once, even if the component re-renders.
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const settings = settingsStore.get();
        const no = nextSessionNumber(draft.when);
        sessionNo.current = no;
        const image = await renderDraft(draft, no, settings);
        setBits(image);

        addLogEntry({
          at: draft.when.getTime(),
          no,
          packageName: `${draft.frame.name} · ${draft.pkg.name}`,
          price: draft.pkg.price,
          method: draft.method,
          voucher: draft.voucherCode,
          prints: draft.pkg.prints,
        });
        queueTransaction({
          id: crypto.randomUUID(),
          at: draft.when.toISOString(),
          session_no: no,
          frame: draft.frame.name,
          package: draft.pkg.name,
          price: draft.pkg.price,
          method: draft.method,
          voucher_code: draft.voucherCode ?? null,
          prints: draft.pkg.prints,
          payment_id: draft.paymentId ?? null,
          staff_confirmed: draft.staffConfirmed,
          share_code: draft.shareCode ?? null,
        });
        if (draft.shareCode) {
          const code = draft.shareCode;
          // Made a moment later, so that building the colour copy never holds up the print.
          setTimeout(() => void sendDigital(draft, code, no), 1500);
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
                  no,
                  createdAt: draft.when.getTime(),
                  packageName: `${draft.frame.name} · ${draft.pkg.name}`,
                  price: draft.pkg.price,
                  method: draft.method,
                  frameId: draft.frame.id,
                  style: draft.style,
                  quote: draft.quote,
                  photos,
                  crops,
                  shareCode: draft.shareCode,
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

  // The countdown back to the start waits while staff type their PIN or choose, then starts over.
  useEffect(() => {
    if (phase !== 'done' || askPin || chooseCopy) return;
    setSecondsLeft(returnSeconds);
    const timer = setInterval(() => setSecondsLeft((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [phase, askPin, chooseCopy]);

  useEffect(() => {
    if (phase === 'done' && secondsLeft <= 0) onFinish();
  }, [phase, secondsLeft]);

  /**
   * One more copy of this receipt. Paid: the second guest in the photo wants their own, pays for
   * it again, and the history gets a row for that payment. Free: the first print came out spoilt.
   */
  const printCopy = async (paid: boolean) => {
    setChooseCopy(false);
    if (!bits || !(await print(bits, 1))) return;
    const no = sessionNo.current;
    if (!paid || no === null) return;
    const at = new Date();
    addLogEntry({
      at: at.getTime(),
      no,
      packageName: `${draft.frame.name} · ${EXTRA_COPY_PACKAGE}`,
      price: copyPrice,
      method: 'cash',
      prints: 1,
      extra: true,
    });
    queueTransaction({
      id: crypto.randomUUID(),
      at: at.toISOString(),
      session_no: no,
      frame: draft.frame.name,
      package: EXTRA_COPY_PACKAGE,
      price: copyPrice,
      method: 'cash',
      voucher_code: null,
      prints: 1,
      payment_id: null,
      // Only staff reach this, with their PIN.
      staff_confirmed: true,
      share_code: draft.shareCode ?? null,
      extra: true,
    });
  };

  /** Staff only, so prints stay paid for. Where a sheet costs nothing there is nothing to choose. */
  const offerCopy = () => {
    if (copyPrice > 0) setChooseCopy(true);
    else void printCopy(false);
  };

  const reprint = () => {
    if (!bits) return;
    if (staff) offerCopy();
    else setAskPin('reprint');
  };

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
              {draft.shareCode && <ShareCode code={draft.shareCode} videos={draft.videos} />}
            </>
          )}

          {phase === 'done' && (
            <>
              <span class="tag ok">Selesai</span>
              <h1 class="heading">Ambil strukmu di bawah</h1>
              {draft.shareCode ? <ShareCode code={draft.shareCode} videos={draft.videos} /> : <p class="lead">Terima kasih sudah berfoto. Sampai jumpa lagi!</p>}
              <button class="btn primary huge" onClick={onFinish}>
                Selesai ({Math.max(0, secondsLeft)})
              </button>
              <button class="btn" disabled={!bits} onClick={reprint}>
                Cetak ulang struk ini{staff ? '' : ' (petugas)'}
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
              {draft.shareCode && <ShareCode code={draft.shareCode} videos={draft.videos} />}
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
                <button class="btn primary" onClick={() => setAskPin('fix')}>
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
          title={askPin === 'reprint' ? 'Cetak ulang struk' : 'Perbaiki printer'}
          onCancel={() => setAskPin(null)}
          onSuccess={() => {
            const then = askPin;
            setAskPin(null);
            setStaff(true);
            if (then === 'reprint' && bits) offerCopy();
          }}
        />
      )}

      {chooseCopy && (
        <Overlay onClose={() => setChooseCopy(false)}>
          <div class="card dialog">
            <h2 class="heading small">Cetak 1 lembar lagi</h2>
            <p class="lead">Lembar tambahan dibayar lagi oleh tamu, dan tercatat di riwayat sebagai pembayaran tunai.</p>
            <button class="btn primary" onClick={() => void printCopy(true)}>
              Tamu bayar {formatRupiah(copyPrice)}
            </button>
            <button class="btn" onClick={() => void printCopy(false)}>
              Gratis, cetakan tadi rusak
            </button>
            <button class="link" onClick={() => setChooseCopy(false)}>
              Batal
            </button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

/**
 * Makes the guest's digital copies and queues them for upload: the colour photo first, so the
 * download page opens quickly, then the boomerang and the slideshow as each is ready. A video
 * that cannot be made is left out; the photo is never held up by one.
 */
async function sendDigital(draft: Draft, code: string, sessionNo: number): Promise<void> {
  const settings = settingsStore.get();
  const { queueShareFiles } = await import('../lib/cloud/upload');
  try {
    const { photo, thumb } = await renderDigital(draft, sessionNo, settings);
    await queueShareFiles(code, [
      { kind: 'thumb', blob: thumb },
      { kind: 'photo', blob: photo, expects: draft.videos ? ['live', 'slideshow'] : undefined },
    ]);
  } catch {
    return;
  }
  // While this franchise offers an AI version, the photos also go up without their frame, for the guest to pick one.
  if (settings.platform.ai) {
    const plain = await renderPlainPhotos(draft).catch(() => []);
    const kinds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const;
    await queueShareFiles(code, plain.map((blob, index) => ({ kind: kinds[index], blob }))).catch(() => undefined);
  }
  if (!draft.videos) return;
  // A boomerang recorded in its own step after the photos, or else the one inside the frame, made now.
  const clip = draft.boomerang
    ? await draft.boomerang.catch(() => null)
    : await renderFrameBoomerang(draft, sessionNo, settings).catch(() => null);
  if (clip) await queueShareFiles(code, [{ kind: 'live', blob: clip }]).catch(() => undefined);
  const pairing = pairingStore.get();
  const title = boothTitle(settings, pairing ? (pairing.franchise ?? '') : null);
  const slideshow = await renderSlideshow(draft, sessionNo, settings, title).catch(() => null);
  if (slideshow) await queueShareFiles(code, [{ kind: 'slideshow', blob: slideshow }]).catch(() => undefined);
}

/** The download QR code on screen, for guests who reach for their phone before their receipt. */
function ShareCode({ code, videos }: { code: string; videos: boolean }) {
  const shape = useMemo(() => qrShape(shareUrl(code)), [code]);
  const printed = settingsStore.get().share.printQr;
  if (!shape) return null;
  return (
    <div class="result-share">
      <svg viewBox={`0 0 ${shape.size} ${shape.size}`} role="img" aria-label="Kode QR untuk mengunduh foto" shape-rendering="crispEdges">
        <rect width={shape.size} height={shape.size} fill="#fff" />
        <path d={shape.path} fill="#000" />
      </svg>
      <div>
        <b>Scan untuk unduh fotomu</b>
        <span class="note">
          {videos ? 'Foto berwarna, boomerang, dan video slideshow' : 'Foto berwarna dengan frame'}, tersedia {SHARE_DAYS} hari.{' '}
          {printed ? 'Kode yang sama juga tercetak di struk.' : 'Scan sekarang: kode ini tidak ikut tercetak di struk.'}
        </span>
      </div>
    </div>
  );
}
