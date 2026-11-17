import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { checkQris, createQris, type QrisCharge, type QrisError } from '../lib/cloud/device';
import { pokeIdle } from '../lib/kiosk';
import { qrShape } from '../lib/qr';
import { formatRupiah, type PackageDef } from '../lib/settings';
import { sound } from '../lib/sound';

interface Props {
  pkg: PackageDef;
  /** The payment went through; start the session. */
  onPaid: (paymentId: string) => void;
  /**
   * Lets the payment screen ask before the guest leaves: the answer is false
   * when the money turned out to have arrived, in which case the session starts.
   */
  guard: { current: (() => Promise<boolean>) | null };
}

const ERRORS: Record<QrisError, string> = {
  offline: 'Tidak bisa menghubungi server pembayaran. Periksa internet tablet ini.',
  unpaired: 'Tablet ini tidak lagi tersambung ke dashboard. Mohon panggil petugas.',
  disabled: 'QRIS otomatis sedang dimatikan. Pilih cara bayar lain.',
  'no-package': 'Harga ini sudah berubah. Kembali ke awal dan coba lagi.',
  'too-many': 'Terlalu banyak kode QR dibuat. Tunggu beberapa menit, lalu coba lagi.',
  'not-configured': 'QRIS otomatis belum selesai disetel. Mohon panggil petugas.',
  provider: 'Kode QR gagal dibuat. Coba lagi sebentar lagi.',
  'not-found': 'Kode QR gagal dibuat. Coba lagi sebentar lagi.',
};

const POLL_MS = 3000;

function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Shows a QR made for this one session and starts the session by itself once it is paid. */
export function AutoQris({ pkg, onPaid, guard }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [charge, setCharge] = useState<QrisCharge | null>(null);
  const [error, setError] = useState('');
  const [ended, setEnded] = useState<'expired' | 'failed' | null>(null);
  const [lost, setLost] = useState(false);
  const [now, setNow] = useState(Date.now());
  const done = useRef(false);
  const shape = useMemo(() => (charge ? qrShape(charge.qr) : null), [charge]);

  const paid = (id: string) => {
    if (done.current) return;
    done.current = true;
    sound.done();
    onPaid(id);
  };

  useEffect(() => {
    let cancelled = false;
    setCharge(null);
    setError('');
    setEnded(null);
    void createQris(pkg.id).then((result) => {
      if (cancelled) return;
      if ('error' in result) setError(ERRORS[result.error] ?? ERRORS.provider);
      else setCharge(result);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, pkg.id]);

  // Ask the server every few seconds until the QR is paid or runs out.
  useEffect(() => {
    if (!charge || ended) return;
    let stopped = false;
    const check = async () => {
      const status = await checkQris(charge.id);
      if (stopped) return;
      setLost(status === 'offline');
      if (status === 'paid') paid(charge.id);
      else if (status === 'expired' || status === 'failed') setEnded(status);
      // A guest who is paying on their phone is not touching the tablet; do not time the session out under them.
      else if (Date.now() < charge.expiresAt) pokeIdle();
    };
    const poll = setInterval(() => void check(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [charge, ended]);

  // Before the guest walks away from an unpaid QR, look once more: the money may have just arrived.
  useEffect(() => {
    guard.current = async () => {
      if (!charge || ended || done.current) return !done.current;
      if ((await checkQris(charge.id)) === 'paid') {
        paid(charge.id);
        return false;
      }
      return true;
    };
    return () => {
      guard.current = null;
    };
  }, [charge, ended]);

  if (error) {
    return (
      <>
        <p class="banner err">{error}</p>
        <button class="btn primary" onClick={() => setAttempt((n) => n + 1)}>
          Coba lagi
        </button>
      </>
    );
  }

  if (!charge) {
    return (
      <>
        <div class="spinner" />
        <p class="lead">Menyiapkan kode QR…</p>
      </>
    );
  }

  if (ended || !shape) {
    return (
      <>
        <p class="banner">
          {ended === 'expired' ? 'Kode QR ini sudah habis waktunya.' : 'Kode QR ini tidak bisa dipakai.'} Kalau kamu sudah
          membayar dan sesi tidak dimulai, mohon panggil petugas.
        </p>
        <button class="btn primary" onClick={() => setAttempt((n) => n + 1)}>
          Buat kode QR baru
        </button>
      </>
    );
  }

  const left = charge.expiresAt - now;
  return (
    <>
      <svg class="qris-live" viewBox={`0 0 ${shape.size} ${shape.size}`} role="img" aria-label="Kode QRIS untuk pembayaran ini" shape-rendering="crispEdges">
        <rect width={shape.size} height={shape.size} fill="#fff" />
        <path d={shape.path} fill="#000" />
      </svg>
      <p class="lead">
        Scan dan bayar <b>{formatRupiah(charge.amount)}</b>. Sesi foto mulai sendiri begitu pembayaran masuk.
      </p>
      <p class="note">
        {lost
          ? 'Sambungan terputus, mencoba lagi…'
          : left > 0
            ? `Menunggu pembayaran · berlaku ${clock(left)} lagi`
            : 'Memeriksa pembayaran terakhir…'}
      </p>
    </>
  );
}
