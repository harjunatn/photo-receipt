import { useEffect, useMemo, useState } from 'preact/hooks';
import { listSessions } from '../lib/db';
import { samplePhoto } from '../lib/demoScene';
import { printer, usePrinter } from '../lib/printer/manager';
import { transportSupported } from '../lib/printer/transports';
import { composePhotoOnly, composeTestPage, loadReceiptFonts, receiptToBits } from '../lib/receipt/compose';
import { DEFAULT_SETTINGS, useSettings, type TransportKind } from '../lib/settings';
import { ReceiptPaper } from '../ui/components';
import { edit, printWithFeedback } from './actions';
import { Check, NumberField, Segmented, Slider } from './fields';

const KIND_HINTS: Record<TransportKind, string> = {
  usb: 'Sambungkan printer ke tablet dengan kabel (lewat OTG / USB hub). Tekan Hubungkan, pilih printernya di jendela Chrome, lalu izinkan.',
  bluetooth:
    'Untuk printer dengan Bluetooth Low Energy (BLE). Nyalakan printer, tekan Hubungkan, lalu pilih printernya di jendela Chrome — tidak perlu pairing lewat pengaturan Android. Printer yang halaman tes-nya mencantumkan PIN (misalnya P7A) lebih stabil lewat jenis koneksi Serial. Setelah aplikasi diperbarui, printer BLE harus dihubungkan ulang.',
  serial:
    'Untuk printer Bluetooth biasa (yang punya PIN, misalnya P7A) dan printer dengan adaptor serial. Sekali saja: pairing printernya di Pengaturan → Bluetooth tablet (PIN biasanya 0000 atau 1234), lalu tekan Hubungkan dan pilih printernya. Setelah itu aplikasi menyambung sendiri, juga setelah dimuat ulang atau diperbarui. Butuh Chrome versi 138 ke atas.',
  preview: 'Tidak mencetak ke kertas. Hasil cetak ditampilkan di layar — cocok untuk mencoba aplikasi tanpa printer.',
};

const KIND_LABEL: Record<TransportKind, string> = { usb: 'USB', bluetooth: 'Bluetooth', serial: 'Serial', preview: 'Simulasi' };

const STATUS_LABEL = {
  disconnected: 'Belum terhubung',
  connecting: 'Menghubungkan…',
  connected: 'Terhubung',
  printing: 'Sedang mencetak…',
};

export function PrinterTab() {
  const { printer: p } = useSettings();
  const state = usePrinter();
  const [sample, setSample] = useState<CanvasImageSource>(() => samplePhoto(4 / 3, 2));
  // Picking a kind only chooses what Hubungkan connects to; the printer in use stays connected until then.
  const [kind, setKind] = useState<TransportKind>(p.transport);
  useEffect(() => setKind(p.transport), [p.transport]);
  const supported = transportSupported(kind);
  const linked = state.status === 'connected' || state.status === 'printing';
  const otherLink = linked && state.kind !== kind;

  // Tune against a real guest photo when there is one; skin tones are what matters.
  useEffect(() => {
    let cancelled = false;
    listSessions()
      .then((sessions) => (sessions[0]?.photos[0] ? createImageBitmap(sessions[0].photos[0]) : null))
      .then((bitmap) => {
        if (bitmap && !cancelled) setSample(bitmap);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const preview = useMemo(
    () => receiptToBits(composePhotoOnly(p.dots, sample, 4 / 3), p.raster),
    [p.dots, p.raster, sample],
  );

  const testPrint = async () => {
    await loadReceiptFonts();
    await printWithFeedback(receiptToBits(composeTestPage(p.dots, sample), p.raster));
  };

  return (
    <div class="admin-grid">
      <section class="panel">
        <h2>Koneksi printer</h2>
        <Segmented
          label="Jenis koneksi"
          value={kind}
          options={(['usb', 'bluetooth', 'serial', 'preview'] as const).map((value) => ({ value, label: KIND_LABEL[value] }))}
          onChange={setKind}
        />
        <p class="hint">{KIND_HINTS[kind]}</p>
        {!supported && (
          <p class="banner err">
            Browser ini tidak mendukung koneksi tersebut. Pakai Google Chrome di tablet Android atau di komputer.
          </p>
        )}
        <div class="row">
          <span class={`tag ${state.status === 'connected' || state.status === 'printing' ? 'ok' : state.status === 'connecting' ? 'warn' : 'err'}`}>
            {STATUS_LABEL[state.status]}
          </span>
          {state.deviceName && <span class="mono">{state.deviceName}</span>}
        </div>
        {otherLink && (
          <p class="hint">
            Printer masih tersambung lewat {KIND_LABEL[state.kind]}. Tekan Hubungkan untuk beralih ke {KIND_LABEL[kind]}; sambungan
            lama tetap dipakai sampai yang baru berhasil.
          </p>
        )}
        {state.error && <p class="error-text">{state.error}</p>}
        <div class="row">
          {(state.status === 'disconnected' || otherLink) && (
            <button class="btn primary" disabled={!supported} onClick={() => void printer.connect(kind)}>
              Hubungkan
            </button>
          )}
          {state.status !== 'disconnected' && (
            <button class="btn" disabled={state.status === 'printing'} onClick={() => void printer.disconnect()}>
              Putuskan
            </button>
          )}
          <button class="btn dark" disabled={state.status !== 'connected'} onClick={() => void testPrint()}>
            Tes cetak
          </button>
        </div>
        {kind === 'usb' && (
          <Check
            label="Tampilkan semua perangkat USB"
            hint="Nyalakan jika printer tidak muncul di daftar saat menekan Hubungkan."
            checked={p.usbShowAll}
            onChange={(v) => edit((s) => void (s.printer.usbShowAll = v))}
          />
        )}
      </section>

      <section class="panel">
        <h2>Kertas & pemotong</h2>
        <Segmented
          label="Lebar kertas"
          value={p.paperWidth}
          options={[
            { value: 80, label: '80 mm' },
            { value: 58, label: '58 mm' },
          ]}
          onChange={(width) => {
            // Tapping the width already chosen must not undo a hand-tuned print width.
            if (width === p.paperWidth) return;
            edit((s) => {
              s.printer.paperWidth = width;
              s.printer.dots = width === 80 ? 576 : 384;
            });
          }}
        />
        <NumberField
          label="Lebar cetak (titik per baris)"
          hint="Biasanya 576 untuk 80 mm dan 384 untuk 58 mm. Kecilkan jika tepi kanan terpotong. Selalu kelipatan 8."
          value={p.dots}
          min={200}
          max={832}
          step={8}
          onChange={(v) => {
            const dots = Math.round(v / 8) * 8;
            edit((s) => void (s.printer.dots = dots), dots === v ? undefined : `Lebar cetak disimpan ${dots} titik (harus kelipatan 8).`);
          }}
        />
        <Segmented
          label="Potong kertas setelah cetak"
          value={p.cut}
          options={[
            { value: 'partial', label: 'Sebagian' },
            { value: 'full', label: 'Penuh' },
            { value: 'none', label: 'Tidak' },
          ]}
          hint="Pilih Tidak untuk printer tanpa pemotong otomatis (kertas disobek manual)."
          onChange={(cut) => edit((s) => void (s.printer.cut = cut))}
        />
        <NumberField
          label="Baris kosong di akhir"
          value={p.feedLines}
          min={0}
          max={12}
          onChange={(v) => edit((s) => void (s.printer.feedLines = v))}
        />
      </section>

      <section class="panel span">
        <h2>Kualitas cetak foto</h2>
        <p class="hint">
          Pratinjau di kanan menunjukkan titik-titik yang benar-benar dikirim ke printer. Kertas thermal mencetak lebih
          gelap daripada layar — kalau hasil asli terlalu gelap, naikkan Kecerahan/Gamma atau turunkan Kepadatan. Ubah
          satu pengaturan, lalu Tes cetak.
        </p>
        <div class="admin-grid" style={{ margin: 0 }}>
          <div class="panel" style={{ boxShadow: 'none' }}>
            <Slider label="Kecerahan" value={p.raster.brightness} min={-50} max={50} onChange={(v) => edit((s) => void (s.printer.raster.brightness = v))} />
            <Slider label="Kontras" value={p.raster.contrast} min={-50} max={50} onChange={(v) => edit((s) => void (s.printer.raster.contrast = v))} />
            <Slider
              label="Gamma (terang-gelap wajah)"
              value={p.raster.gamma}
              min={0.6}
              max={2.2}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(v) => edit((s) => void (s.printer.raster.gamma = v))}
            />
            <Slider
              label="Kepadatan hitam"
              value={p.raster.density}
              min={50}
              max={100}
              format={(v) => `${v}%`}
              hint="Turunkan jika area gelap jadi blok hitam pekat."
              onChange={(v) => edit((s) => void (s.printer.raster.density = v))}
            />
            <Slider
              label="Detail (kontras lokal + ketajaman)"
              value={p.raster.detail}
              min={0}
              max={100}
              onChange={(v) => edit((s) => void (s.printer.raster.detail = v))}
            />
            <Check
              label="Level otomatis"
              hint="Menyesuaikan foto yang terlalu gelap atau pucat sebelum dicetak."
              checked={p.raster.autoLevels}
              onChange={(v) => edit((s) => void (s.printer.raster.autoLevels = v))}
            />
            <Segmented
              label="Pola titik (dither)"
              value={p.raster.dither}
              options={[
                { value: 'atkinson', label: 'Atkinson' },
                { value: 'floyd-steinberg', label: 'Floyd–Steinberg' },
                { value: 'ordered', label: 'Pola kotak' },
                { value: 'threshold', label: 'Hitam-putih' },
              ]}
              hint="Atkinson lebih terang dan bersih; Floyd–Steinberg lebih halus tapi cenderung gelap."
              onChange={(dither) => edit((s) => void (s.printer.raster.dither = dither))}
            />
            <button class="btn small" onClick={() => edit((s) => void (s.printer.raster = structuredClone(DEFAULT_SETTINGS.printer.raster)))}>
              ↺ Kembalikan ke bawaan
            </button>
          </div>
          <div class="preview-box">
            <ReceiptPaper bits={preview} />
          </div>
        </div>
      </section>

      <section class="panel span">
        <h2>Lanjutan: kestabilan pengiriman data</h2>
        <p class="hint">
          Biarkan bawaan kecuali ada masalah. Cetakan berantakan atau berhenti di tengah (terutama Bluetooth) biasanya
          hilang dengan mode Stabil.
        </p>
        <div class="row">
          <button
            class="btn small"
            onClick={() =>
              edit((s) => Object.assign(s.printer, { bleChunk: 180, bleChunkDelayMs: 0, bleWrite: 'without-response', bandDelayMs: 0, bandRows: 128 }))
            }
          >
            Cepat
          </button>
          <button
            class="btn small"
            onClick={() => edit((s) => Object.assign(s.printer, { bleChunk: 100, bleChunkDelayMs: 0, bleWrite: 'auto', bandDelayMs: 0, bandRows: 96 }))}
          >
            Sedang (bawaan)
          </button>
          <button
            class="btn small"
            onClick={() =>
              edit((s) => Object.assign(s.printer, { bleChunk: 20, bleChunkDelayMs: 0, bleWrite: 'with-response', bandDelayMs: 30, bandRows: 48 }))
            }
          >
            Stabil
          </button>
        </div>
        <div class="admin-grid" style={{ margin: 0 }}>
          <Segmented
            label="Format gambar"
            value={p.rasterMode}
            options={[
              { value: 'gsv0', label: 'GS v 0 (umum)' },
              { value: 'escstar', label: 'ESC * (printer lama)' },
            ]}
            onChange={(mode) => edit((s) => void (s.printer.rasterMode = mode))}
          />
          <NumberField label="Baris gambar per kiriman" value={p.bandRows} min={24} max={1024} step={8} onChange={(v) => edit((s) => void (s.printer.bandRows = v))} />
          <NumberField label="Jeda antar kiriman (ms)" value={p.bandDelayMs} min={0} max={500} onChange={(v) => edit((s) => void (s.printer.bandDelayMs = v))} />
          <NumberField label="Bluetooth: byte per paket" value={p.bleChunk} min={20} max={512} onChange={(v) => edit((s) => void (s.printer.bleChunk = v))} />
          <NumberField label="Bluetooth: jeda per paket (ms)" value={p.bleChunkDelayMs} min={0} max={100} onChange={(v) => edit((s) => void (s.printer.bleChunkDelayMs = v))} />
          <Segmented
            label="Bluetooth: cara kirim"
            value={p.bleWrite}
            options={[
              { value: 'auto', label: 'Otomatis' },
              { value: 'with-response', label: 'Dengan konfirmasi' },
              { value: 'without-response', label: 'Tanpa konfirmasi' },
            ]}
            onChange={(mode) => edit((s) => void (s.printer.bleWrite = mode))}
          />
          <Segmented
            label="Serial: kecepatan (baud)"
            hint="Hanya untuk printer dengan kabel/adaptor serial; printer Bluetooth tidak terpengaruh."
            value={p.baudRate}
            options={[9600, 19200, 38400, 57600, 115200].map((value) => ({ value, label: String(value) }))}
            onChange={(baud) => edit((s) => void (s.printer.baudRate = baud))}
          />
        </div>
      </section>
    </div>
  );
}
