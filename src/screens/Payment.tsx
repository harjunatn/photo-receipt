import { useState } from 'preact/hooks';
import type { PayMethod } from '../lib/log';
import type { FrameDef } from '../lib/receipt/frames';
import { useFramePreviews } from '../lib/receipt/previews';
import { formatRupiah, paymentChoices, useSettings, type PackageDef, type PaymentChoice } from '../lib/settings';
import { checkVoucher, voucherStore } from '../lib/vouchers';
import { CodeKeyboard, PinPad, Steps } from '../ui/components';

interface Props {
  frame: FrameDef;
  onPaid: (pkg: PackageDef, method: PayMethod, voucherCode?: string) => void;
  onBack: () => void;
}

const VOUCHER_ERRORS = {
  'not-found': 'Kode tidak ditemukan. Coba periksa lagi.',
  used: 'Voucher ini sudah pernah dipakai.',
  expired: 'Voucher ini sudah kedaluwarsa.',
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
  const pkg = packages.find((p) => p.id === pkgId) ?? packages[0];

  if (!pkg) return null;

  const applyVoucher = () => {
    const result = checkVoucher(voucherStore.get(), code, Date.now());
    if (result.ok) onPaid(pkg, 'voucher', result.voucher.code);
    else setError(VOUCHER_ERRORS[result.reason]);
  };

  return (
    <div class="screen">
      <header class="bar">
        <button class="btn quiet" onClick={onBack}>
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
                    onClick={() => {
                      setChoice(null);
                      setError('');
                    }}
                  >
                    Ganti cara bayar
                  </button>
                )}
              </div>

              {choice === 'qris' && (
                <>
                  <img class="qris-img" src={settings.payment.qrisImage} alt="Kode QRIS" />
                  <p class="lead">
                    Scan dan bayar <b>{formatRupiah(pkg.price)}</b>, lalu tunjukkan buktinya ke petugas.
                  </p>
                  <button class="btn primary" onClick={() => setAskPin(true)}>
                    Petugas: konfirmasi bayar
                  </button>
                </>
              )}

              {choice === 'cash' && (
                <>
                  <p class="lead">
                    Serahkan <b>{formatRupiah(pkg.price)}</b> ke petugas. Setelah itu petugas akan memulai sesi fotomu.
                  </p>
                  <button class="btn primary huge" onClick={() => setAskPin(true)}>
                    Petugas: konfirmasi bayar
                  </button>
                </>
              )}

              {choice === 'voucher' && (
                <>
                  <div class={`code-display ${code ? '' : 'empty'}`}>{code || 'Ketik kode voucher'}</div>
                  <p class="error-text">{error}</p>
                  <CodeKeyboard
                    value={code}
                    onChange={(next) => {
                      setCode(next);
                      setError('');
                    }}
                  />
                  <button class="btn primary" disabled={code.length < 4} onClick={applyVoucher}>
                    Pakai voucher →
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
