import { useEffect, useState } from 'preact/hooks';
import { pairingStore } from '../lib/cloud/device';
import { isInstalled } from '../lib/kiosk';
import { usePrinter } from '../lib/printer/manager';
import { transportSupported } from '../lib/printer/transports';
import { DEFAULT_PIN, useSettings } from '../lib/settings';
import { useStore } from '../lib/store';

/** At-a-glance health of the booth: printer, camera, connection and the things to fix before guests arrive. */
export function SummaryTab() {
  const settings = useSettings();
  const printer = usePrinter();
  const paired = useStore(pairingStore) !== null;
  const [camera, setCamera] = useState<PermissionState | null>(null);

  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((status) => setCamera(status.state))
      .catch(() => undefined);
  }, []);

  const problems: string[] = [];
  if (!paired) problems.push('Tablet ini belum disambungkan ke dashboard, jadi tamu belum bisa memulai sesi. Sambungkan di tab Sambungan.');
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
  if (settings.packages.every((p) => !p.active)) problems.push('Belum ada harga yang aktif. Atur di dashboard pemilik (menu Pengaturan).');

  return (
    <div class="admin-grid">
      <section class="panel span">
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
        <p class="hint">Penjualan dan daftar transaksi tablet ini ada di tab Dashboard dan Transaksi.</p>
      </section>

    </div>
  );
}
