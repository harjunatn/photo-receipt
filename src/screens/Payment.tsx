import { useEffect, useRef, useState } from 'preact/hooks';
import { redeemCloudVoucher } from '../lib/cloud/device';
import type { PayMethod } from '../lib/log';
import type { FrameDef } from '../lib/receipt/frames';
import { useFramePreviews } from '../lib/receipt/previews';
import { formatRupiah, paymentChoices, useSettings, type PackageDef, type PaymentChoice } from '../lib/settings';
import { CodeKeyboard, PinPad, Steps, toast } from '../ui/components';
import { AutoQris } from './AutoQris';

interface Props {
  frame: FrameDef;
  /** staffConfirmed is false when cash or static QRIS was accepted without the staff PIN. */
  onPaid: (pkg: PackageDef, method: PayMethod, voucherCode?: string, paymentId?: string, staffConfirmed?: boolean) => void;
  onBack: () => void;
}

const VOUCHER_ERRORS = {
  'not-found': 'Kode tidak ditemukan. Coba periksa lagi.',
  used: 'Voucher ini sudah pernah dipakai.',
  expired: 'Voucher ini sudah kedaluwarsa.',
  offline: 'Voucher butuh internet, dan tablet ini sedang tidak tersambung. Mohon panggil petugas.',
  subscription: 'Booth ini sedang tidak menerima voucher. Mohon panggil petugas.',
};

const METHODS: Record<PaymentChoice, { icon: string; title: string; hint: string }> = {
  qris: { icon: '📱', title: 'QRIS', hint: 'Scan pakai e-wallet atau m-banking' },
  cash: { icon: '💵', title: 'Tunai', hint: 'Bayar langsung ke petugas' },
  voucher: { icon: '🎟️', title: 'Voucher', hint: 'Punya kode? Masukkan di sini' },
};

/** Step 2: the guest sees the price and picks how to pay — QRIS, cash or a voucher code. */
export function Payment({ frame, onPaid, onBack }: Props) {
  const settings = useSettings();
  const packages = settings.packages.filter((p) => p.active);
  const choices = paymentChoices(settings.payment);
  const previews = useFramePreviews([frame], settings);
  const [pkgId, setPkgId] = useState(packages[0]?.id);
  const [choice, setChoice] = useState<PaymentChoice | null>(choices.length === 1 ? choices[0] : null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [askPin, setAskPin] = useState(false);
  const [checking, setChecking] = useState(false);
  // Set by the automatic QRIS panel while a QR is waiting to be paid.
  const leaveGuard = useRef<(() => Promise<boolean>) | null>(null);
  const autoQris = settings.payment.qrisAuto;

  /** Leaves the current way of paying, unless a QR turns out to have been paid in the meantime. */
  const leave = async (then: () => void) => {
    if (leaveGuard.current && !(await leaveGuard.current())) return;
    then();
  };
  const pkg = packages.find((p) => p.id === pkgId) ?? packages[0];

  /** Puts a code copied elsewhere into the voucher field. */
  const takeCode = (text: string): boolean => {
    // Kept as printed (FOTO-AB12): the server ignores the dash, but guests recognise their code.
    const pasted = text.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
    if (!pasted) return false;
    setCode(pasted);
    setError('');
    return true;
  };

  // A code pasted with a keyboard (Ctrl+V) lands in the voucher field too.
  useEffect(() => {
    if (choice !== 'voucher') return;
    const onPaste = (event: ClipboardEvent) => {
      if (takeCode(event.clipboardData?.getData('text') ?? '')) event.preventDefault();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [choice]);

  const pasteCode = async () => {
    try {
      if (!takeCode(await navigator.clipboard.readText())) toast('Belum ada kode voucher yang disalin.');
    } catch {
      toast('Tablet tidak mengizinkan menempel. Ketik kodenya saja.');
    }
  };

  if (!pkg) return null;

  // The server hands each code out exactly once, across all tablets.
  const applyVoucher = async () => {
    setChecking(true);
    const result = await redeemCloudVoucher(code);
    setChecking(false);
    if (result.status === 'ok') onPaid(pkg, 'voucher', result.code);
    else setError(VOUCHER_ERRORS[result.status]);
  };

  return (
    <div class="screen">
      <header class="bar">
        <button class="btn quiet" onClick={() => void leave(onBack)}>
          ← Kembali
        </button>
        <Steps current={1} />
        <span class="bar-end" />
      </header>

      <div class="pay">
        <section class="card order">
          <div class="order-frame">{previews[frame.id] ? <img src={previews[frame.id]} alt="" /> : <div class="strip-loading" />}</div>
          <div class="order-info">
            <span class="pill">Frame {frame.name}</span>
            <p class="note">{frame.blurb}</p>
            {packages.length > 1 && (
              <div class="chips">
                {packages.map((option) => (
                  <button key={option.id} class={`chip ${option.id === pkg.id ? 'on' : ''}`} onClick={() => setPkgId(option.id)}>
                    {option.name} · {option.price > 0 ? formatRupiah(option.price) : 'Gratis'}
                  </button>
                ))}
              </div>
            )}
            <p class="note">{pkg.description}</p>
            <div class="amount">{pkg.price > 0 ? formatRupiah(pkg.price) : 'GRATIS'}</div>
          </div>
        </section>

        <section class="card method-panel">
          {pkg.price === 0 ? (
            <>
              <h2 class="heading small">Pilihan ini gratis</h2>
              <button class="btn primary huge" onClick={() => onPaid(pkg, 'free')}>
                Mulai sesi foto →
              </button>
            </>
          ) : choice === null ? (
            <>
              <h2 class="heading small">Mau bayar pakai apa?</h2>
              <div class="methods">
                {choices.map((option) => (
                  <button key={option} class="method" onClick={() => setChoice(option)}>
                    <span class="method-icon">{METHODS[option].icon}</span>
                    <b>{METHODS[option].title}</b>
                    <small>{METHODS[option].hint}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div class="method-head">
                <h2 class="heading small">
                  {METHODS[choice].title}
                </h2>
                {choices.length > 1 && (
                  <button
                    class="btn quiet small"
                    onClick={() =>
                      void leave(() => {
                        setChoice(null);
                        setError('');
                      })
                    }
                  >
                    Ganti cara bayar
                  </button>
                )}
              </div>

              {choice === 'qris' && autoQris && (
                // Keyed by price, so that choosing another price makes a new QR for the new amount.
                <AutoQris key={pkg.id} pkg={pkg} guard={leaveGuard} onPaid={(paymentId) => onPaid(pkg, 'qris', undefined, paymentId)} />
              )}

              {choice === 'qris' && !autoQris && (
                <>
                  <img class="qris-img" src={settings.payment.qrisImage} alt="Kode QRIS" />
                  <p class="lead">
                    Scan dan bayar <b>{formatRupiah(pkg.price)}</b>, lalu tunjukkan buktinya ke petugas.
                  </p>
                  {settings.payment.qrisConfirm ? (
                    <button class="btn primary" onClick={() => setAskPin(true)}>
                      Petugas: konfirmasi bayar
                    </button>
                  ) : (
                    <button class="btn primary" onClick={() => onPaid(pkg, 'qris', undefined, undefined, false)}>
                      Sudah bayar · mulai foto →
                    </button>
                  )}
                </>
              )}

              {choice === 'cash' && (
                <>
                  {settings.payment.cashConfirm ? (
                    <>
                      <p class="lead">
                        Serahkan <b>{formatRupiah(pkg.price)}</b> ke petugas. Setelah itu petugas akan memulai sesi fotomu.
                      </p>
                      <button class="btn primary huge" onClick={() => setAskPin(true)}>
                        Petugas: konfirmasi bayar
                      </button>
                    </>
                  ) : (
                    <>
                      <p class="lead">
                        Serahkan <b>{formatRupiah(pkg.price)}</b> ke petugas, lalu mulai sesi fotomu.
                      </p>
                      <button class="btn primary huge" onClick={() => onPaid(pkg, 'cash', undefined, undefined, false)}>
                        Sudah bayar · mulai foto →
                      </button>
                    </>
                  )}
                </>
              )}

              {choice === 'voucher' && (
                <>
                  <div class={`code-display ${code ? '' : 'empty'}`}>{code || 'Ketik kode voucher'}</div>
                  <button class="btn small quiet" onClick={() => void pasteCode()}>
                    Tempel kode yang disalin
                  </button>
                  <p class="error-text">{error}</p>
                  <CodeKeyboard
                    value={code}
                    onChange={(next) => {
                      setCode(next);
                      setError('');
                    }}
                  />
                  <button class="btn primary" disabled={code.length < 4 || checking} onClick={() => void applyVoucher()}>
                    {checking ? 'Memeriksa…' : 'Pakai voucher →'}
                  </button>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {askPin && choice !== null && choice !== 'voucher' && (
        <PinPad title="Konfirmasi pembayaran" onCancel={() => setAskPin(false)} onSuccess={() => onPaid(pkg, choice)} />
      )}
    </div>
  );
}
