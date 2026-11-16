import { useState } from 'preact/hooks';
import { download } from '../lib/kiosk';
import { toCsv } from '../lib/log';
import { composeVoucherSlip, formatDateTime, loadReceiptFonts, receiptToBits } from '../lib/receipt/compose';
import { paymentChoices, settingsStore, useSettings } from '../lib/settings';
import { useStore } from '../lib/store';
import { generateVouchers, voucherStatus, voucherStore, type Voucher, type VoucherStatus } from '../lib/vouchers';
import { toast } from '../ui/components';
import { edit, printWithFeedback } from './actions';
import { Check, ImageField, NumberField, Segmented, TextField } from './fields';

const STATUS_LABEL: Record<VoucherStatus, string> = { active: 'Aktif', used: 'Terpakai', expired: 'Kedaluwarsa' };
const STATUS_TAG: Record<VoucherStatus, string> = { active: 'ok', used: '', expired: 'warn' };
const SHOWN = 150;

/** How guests pay, and the single-use voucher codes that stand in for payment. */
export function PaymentTab() {
  const { payment } = useSettings();
  const vouchers = useStore(voucherStore);
  const [prefix, setPrefix] = useState('FOTO');
  const [count, setCount] = useState(10);
  const [validDays, setValidDays] = useState(30);
  const [filter, setFilter] = useState<VoucherStatus | 'all'>('active');
  const [printing, setPrinting] = useState(false);

  const now = Date.now();
  const counts = { active: 0, used: 0, expired: 0 };
  for (const voucher of vouchers) counts[voucherStatus(voucher, now)] += 1;
  const visible = vouchers.filter((v) => filter === 'all' || voucherStatus(v, now) === filter);

  const create = () => {
    const created = generateVouchers(vouchers, { prefix, count, validDays: validDays > 0 ? validDays : null, now: Date.now() });
    voucherStore.set([...created, ...vouchers]);
    setFilter('active');
    toast(`${created.length} voucher dibuat.`);
  };

  /** Prints one slip per voucher, each cut off on its own. */
  const printSlips = async (list: Voucher[]) => {
    setPrinting(true);
    await loadReceiptFonts();
    const { printer, brand } = settingsStore.get();
    for (const voucher of list) {
      const slip = composeVoucherSlip(printer.dots, { brand: brand.title, code: voucher.code, expiresAt: voucher.expiresAt });
      if (!(await printWithFeedback(receiptToBits(slip, printer.raster)))) break;
    }
    setPrinting(false);
  };

  const exportCsv = () => {
    const rows = [
      ['kode', 'status', 'dibuat', 'berlaku_sampai', 'dipakai'],
      ...vouchers.map((v) => [
        v.code,
        STATUS_LABEL[voucherStatus(v, now)],
        formatDateTime(new Date(v.createdAt)),
        v.expiresAt === null ? '' : formatDateTime(new Date(v.expiresAt)),
        v.usedAt === null ? '' : formatDateTime(new Date(v.usedAt)),
      ]),
    ];
    download('voucher.csv', new Blob([toCsv(rows)], { type: 'text/csv' }));
  };

  const activeVisible = visible.filter((v) => voucherStatus(v, now) === 'active');

  return (
    <div class="admin-grid">
      <section class="panel">
        <h2>Cara tamu membayar</h2>
        <p class="hint">Cara yang dinyalakan di sini muncul sebagai pilihan di langkah pembayaran tamu.</p>
        <Check
          label="QRIS"
          hint="Gambar QRIS toko kamu ditampilkan; petugas mengecek bukti bayar lalu mengonfirmasi dengan PIN."
          checked={payment.qris}
          onChange={(v) => edit((s) => void (s.payment.qris = v))}
        />
        {payment.qris && (
          <ImageField label="Gambar QRIS" value={payment.qrisImage} maxSide={720} onChange={(v) => edit((s) => void (s.payment.qrisImage = v))} />
        )}
        {payment.qris && !payment.qrisImage && <p class="banner">Unggah gambar QRIS dulu — tanpa gambar, pilihan QRIS tidak ditampilkan ke tamu.</p>}
        <Check
          label="Tunai"
          hint="Tamu membayar ke petugas, lalu petugas mengonfirmasi dengan PIN."
          checked={payment.cash}
          onChange={(v) => edit((s) => void (s.payment.cash = v))}
        />
        <Check
          label="Voucher"
          hint="Tamu mengetik kode sekali-pakai di layar; cocok untuk booth tanpa penjaga."
          checked={payment.voucher}
          onChange={(v) => edit((s) => void (s.payment.voucher = v))}
        />
        {paymentChoices(payment).length === 1 && !payment.cash && !payment.voucher && !(payment.qris && payment.qrisImage) && (
          <p class="banner">Tidak ada cara bayar yang menyala, jadi tamu ditawari Tunai supaya sesi tetap bisa dimulai.</p>
        )}
        <p class="banner">
          QRIS otomatis (sesi langsung mulai begitu pembayaran masuk, tanpa petugas) belum tersedia: fitur itu butuh akun
          payment gateway atas nama usahamu dan sebuah server kecil.
        </p>
      </section>

      <section class="panel">
        <h2>Buat voucher</h2>
        <TextField label="Awalan kode" hint="Huruf/angka, maksimal 8. Contoh: FOTO, VIP, PROMO." value={prefix} onChange={setPrefix} />
        <NumberField label="Jumlah voucher" value={count} min={1} max={200} onChange={setCount} />
        <NumberField label="Masa berlaku (hari)" hint="Isi 0 untuk berlaku sampai dipakai." value={validDays} min={0} max={730} onChange={setValidDays} />
        <button class="btn primary" onClick={create}>
          Buat {count} voucher
        </button>
      </section>

      <section class="panel span">
        <h2>Daftar voucher</h2>
        <div class="stats">
          <div class="stat">
            <b>{counts.active}</b>
            <span>aktif</span>
          </div>
          <div class="stat">
            <b>{counts.used}</b>
            <span>terpakai</span>
          </div>
          <div class="stat">
            <b>{counts.expired}</b>
            <span>kedaluwarsa</span>
          </div>
        </div>
        <Segmented
          label="Tampilkan"
          value={filter}
          options={[
            { value: 'active', label: 'Aktif' },
            { value: 'used', label: 'Terpakai' },
            { value: 'expired', label: 'Kedaluwarsa' },
            { value: 'all', label: 'Semua' },
          ]}
          onChange={setFilter}
        />
        <div class="row">
          <button class="btn small dark" disabled={printing || activeVisible.length === 0} onClick={() => void printSlips(activeVisible)}>
            {printing ? 'Mencetak…' : `Cetak ${activeVisible.length} voucher aktif`}
          </button>
          <button class="btn small" disabled={vouchers.length === 0} onClick={exportCsv}>
            Ekspor CSV
          </button>
          <button
            class="btn small danger"
            disabled={counts.used + counts.expired === 0}
            onClick={() => voucherStore.set(vouchers.filter((v) => voucherStatus(v, Date.now()) === 'active'))}
          >
            Hapus yang terpakai & kedaluwarsa
          </button>
        </div>
        <div class="list">
          {visible.length === 0 && <p class="hint">Tidak ada voucher di daftar ini.</p>}
          {visible.slice(0, SHOWN).map((voucher) => {
            const status = voucherStatus(voucher, now);
            return (
              <div class="list-item" key={voucher.code}>
                <div class="grow">
                  <b class="mono" style={{ userSelect: 'text' }}>
                    {voucher.code}
                  </b>
                  <div class="hint">
                    {voucher.usedAt !== null
                      ? `Dipakai ${formatDateTime(new Date(voucher.usedAt))}`
                      : voucher.expiresAt === null
                        ? 'Berlaku sampai dipakai'
                        : `Berlaku s/d ${formatDateTime(new Date(voucher.expiresAt)).slice(0, 10)}`}
                  </div>
                </div>
                <span class={`tag ${STATUS_TAG[status]}`}>{STATUS_LABEL[status]}</span>
                {status === 'active' && (
                  <button class="btn small" disabled={printing} onClick={() => void printSlips([voucher])}>
                    Cetak
                  </button>
                )}
                <button class="btn small danger" onClick={() => voucherStore.set(vouchers.filter((v) => v.code !== voucher.code))}>
                  Hapus
                </button>
              </div>
            );
          })}
          {visible.length > SHOWN && (
            <p class="hint">
              Menampilkan {SHOWN} dari {visible.length}. Ekspor CSV untuk daftar lengkap.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
