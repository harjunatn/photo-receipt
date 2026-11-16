import { useEffect, useState } from 'preact/hooks';
import { download, isInstalled } from '../lib/kiosk';
import { logStore, paidAmount, PAY_METHOD_LABEL, startOfToday, toCsv, totalsSince, type Totals } from '../lib/log';
import { usePrinter } from '../lib/printer/manager';
import { transportSupported } from '../lib/printer/transports';
import { formatDateTime } from '../lib/receipt/compose';
import { DEFAULT_PIN, formatRupiah, useSettings } from '../lib/settings';
import { useStore } from '../lib/store';

function TotalsRow({ title, totals }: { title: string; totals: Totals }) {
  return (
    <>
      <h3 class="hint" style={{ fontWeight: 700 }}>
        {title}
      </h3>
      <div class="stats">
        <div class="stat">
          <b>{totals.sessions}</b>
          <span>sesi foto</span>
        </div>
        <div class="stat">
          <b>{totals.prints}</b>
          <span>lembar tercetak</span>
        </div>
        <div class="stat">
          <b>{formatRupiah(totals.revenue)}</b>
          <span>pemasukan</span>
        </div>
      </div>
    </>
  );
}

/** At-a-glance health of the booth plus sales totals. */
export function SummaryTab() {
  const settings = useSettings();
  const printer = usePrinter();
  const log = useStore(logStore);
  const now = Date.now();
  const [camera, setCamera] = useState<PermissionState | null>(null);

  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((status) => setCamera(status.state))
      .catch(() => undefined);
  }, []);

  const problems: string[] = [];
  if (camera === 'denied') {
    problems.push('Izin kamera ditolak. Ketuk ikon gembok/pengaturan di bilah alamat Chrome → Izin → Kamera → Izinkan.');
  }
  if (!window.isSecureContext) {
    problems.push('Halaman ini tidak dibuka lewat HTTPS, sehingga kamera dan printer tidak akan berfungsi.');
  }
  if (!transportSupported(settings.printer.transport)) {
    problems.push('Browser ini tidak mendukung koneksi printer yang dipilih. Gunakan Google Chrome di Android atau komputer.');
  }
  if (settings.admin.pin === DEFAULT_PIN) {
    problems.push(`PIN petugas masih bawaan (${DEFAULT_PIN}). Ganti di tab Sistem sebelum booth dipakai umum.`);
  }
  if (settings.packages.every((p) => !p.active)) problems.push('Belum ada paket yang aktif.');

  const exportCsv = () => {
    const rows = [
      ['waktu', 'no', 'paket', 'harga', 'metode', 'voucher', 'cetak', 'pemasukan'],
      ...log.map((e) => [formatDateTime(new Date(e.at)), e.no, e.packageName, e.price, PAY_METHOD_LABEL[e.method] ?? e.method, e.voucher ?? '', e.prints, paidAmount(e)]),
    ];
    download('transaksi-booth.csv', new Blob([toCsv(rows)], { type: 'text/csv' }));
  };

  return (
    <div class="admin-grid">
      <section class="panel">
        <h2>Kesiapan booth</h2>
        {problems.map((problem) => (
          <p class="banner err" key={problem}>
            {problem}
          </p>
        ))}
        <div class="row">
          <span class={`tag ${printer.status === 'disconnected' ? 'err' : 'ok'}`}>
            Printer: {printer.status === 'disconnected' ? 'belum terhubung' : printer.deviceName || 'terhubung'}
          </span>
          {printer.kind === 'preview' && <span class="tag warn">Mode simulasi</span>}
          {camera === 'granted' && <span class="tag ok">Kamera: diizinkan</span>}
          {camera === 'prompt' && <span class="tag warn">Kamera: belum diizinkan</span>}
        </div>
        {printer.status === 'disconnected' && <p class="hint">Hubungkan printer di tab Printer sebelum membuka booth.</p>}
        {camera === 'prompt' && (
          <p class="hint">
            Jalankan satu sesi foto percobaan dan pilih “Izinkan” saat Chrome bertanya soal kamera, supaya tamu tidak
            melihat pertanyaan itu.
          </p>
        )}
        {!isInstalled() && (
          <p class="hint">
            Tip: pasang aplikasi ini ke layar utama (menu ⋮ Chrome → “Tambahkan ke layar utama” / “Instal aplikasi”) supaya
            tampil layar penuh tanpa bilah alamat.
          </p>
        )}
        {problems.length === 0 && printer.status !== 'disconnected' && <p class="banner ok">Semua siap. Tekan “Keluar” untuk membuka booth.</p>}
      </section>

      <section class="panel">
        <h2>Penjualan</h2>
        <TotalsRow title="Hari ini" totals={totalsSince(log, startOfToday())} />
        <TotalsRow title="7 hari terakhir" totals={totalsSince(log, now - 7 * 86_400_000)} />
        <TotalsRow title="Sejak awal" totals={totalsSince(log, 0)} />
        <p class="hint">Pemasukan hanya menghitung sesi yang dibayar (QRIS / ke petugas). Voucher dan sesi gratis dihitung Rp0.</p>
        <button class="btn small" disabled={log.length === 0} onClick={exportCsv}>
          Ekspor transaksi (CSV)
        </button>
      </section>

      <section class="panel span">
        <h2>Sesi terakhir</h2>
        <div class="list">
          {log.length === 0 && <p class="hint">Belum ada sesi.</p>}
          {log.slice(0, 12).map((entry) => (
            <div class="list-item" key={`${entry.at}-${entry.no}`}>
              <div class="grow">
                <b>
                  No. {String(entry.no).padStart(3, '0')} · {entry.packageName}
                </b>
                <div class="hint">
                  {formatDateTime(new Date(entry.at))} · {entry.prints}x cetak{entry.voucher ? ` · ${entry.voucher}` : ''}
                </div>
              </div>
              <span class="tag">{PAY_METHOD_LABEL[entry.method] ?? entry.method}</span>
              <b class="mono">{formatRupiah(paidAmount(entry))}</b>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
