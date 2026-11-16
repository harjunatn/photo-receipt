import { useEffect, useState } from 'preact/hooks';
import { DEMO_CAMERA_ID, listCameras } from '../lib/camera';
import { samplePhoto } from '../lib/demoScene';
import type { BitImage } from '../lib/image/types';
import { composeReceipt, loadImage, loadReceiptFonts, receiptToBits } from '../lib/receipt/compose';
import { activeFrames } from '../lib/receipt/frames';
import { useSettings } from '../lib/settings';
import { ReceiptPaper } from '../ui/components';
import { edit } from './actions';
import { AreaField, Check, ImageField, NumberField, Segmented, TextField } from './fields';

/** Everything guests see: the welcome screen, the session rules and the text printed on the receipt. */
export function LookTab() {
  const settings = useSettings();
  const { brand, receipt, session, printer } = settings;
  // The sample receipt uses whichever frame guests are offered first.
  const frame = activeFrames(settings.frames.active)[0];
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [preview, setPreview] = useState<BitImage | null>(null);

  useEffect(() => {
    listCameras().then(setCameras).catch(() => undefined);
  }, []);

  // Rebuild the sample receipt shortly after the last change, so typing stays smooth.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      await loadReceiptFonts();
      const logo = receipt.logo ? await loadImage(receipt.logo).catch(() => null) : null;
      const composed = composeReceipt({
        width: printer.dots,
        frame,
        photos: frame.slots.map((aspect, i) => samplePhoto(aspect, i * 2.1)),
        texts: receipt,
        quote: receipt.quotes.find((q) => q.trim()) ?? '',
        when: new Date(),
        sessionNo: 12,
        logo,
      });
      if (!cancelled) setPreview(receiptToBits(composed, printer.raster));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [receipt, frame, printer.dots, printer.raster]);

  return (
    <div class="admin-grid">
      <section class="panel">
        <h2>Layar sambutan</h2>
        <TextField label="Judul besar" value={brand.title} onChange={(v) => edit((s) => void (s.brand.title = v))} />
        <TextField label="Kalimat pendek di bawahnya" value={brand.subtitle} onChange={(v) => edit((s) => void (s.brand.subtitle = v))} />
        <label class="field">
          <span>Warna aksen</span>
          <input type="color" value={brand.accent} onChange={(event) => edit((s) => void (s.brand.accent = event.currentTarget.value))} />
        </label>
      </section>

      <section class="panel">
        <h2>Sesi foto</h2>
        <Segmented
          label="Hitung mundur sebelum tiap foto"
          value={session.countdownSec}
          options={[3, 5, 8, 10].map((value) => ({ value, label: `${value} detik` }))}
          onChange={(v) => edit((s) => void (s.session.countdownSec = v))}
        />
        <Check
          label="Tamu boleh memilih gaya foto"
          hint="Di langkah edit tamu bisa memilih Normal, Cerah, Kontras, Komik, Sketsa, atau Garis."
          checked={session.guestStyles}
          onChange={(v) => edit((s) => void (s.session.guestStyles = v))}
        />
        <label class="field">
          <span>Kamera</span>
          <select value={session.cameraId} onChange={(event) => edit((s) => void (s.session.cameraId = event.currentTarget.value))}>
            <option value="">Kamera depan (otomatis)</option>
            {cameras.map((camera) => (
              <option key={camera.id} value={camera.id}>
                {camera.label}
              </option>
            ))}
            <option value={DEMO_CAMERA_ID}>Kamera demo (gambar uji, tanpa kamera)</option>
          </select>
          <small class="hint">Nama kamera baru muncul setelah izin kamera diberikan (jalankan satu sesi foto dulu).</small>
        </label>
        <Check label="Layar seperti cermin" hint="Tampilan kamera dibalik seperti kamera selfie." checked={session.mirrorPreview} onChange={(v) => edit((s) => void (s.session.mirrorPreview = v))} />
        <Check label="Cetak foto terbalik seperti cermin" hint="Biasanya dimatikan, supaya tulisan di baju tetap terbaca." checked={session.mirrorPhoto} onChange={(v) => edit((s) => void (s.session.mirrorPhoto = v))} />
        <Check label="Suara hitung mundur & jepretan" checked={session.sound} onChange={(v) => edit((s) => void (s.session.sound = v))} />
        <NumberField
          label="Batas waktu tanpa sentuhan (detik)"
          hint="Layar yang didiamkan selama ini kembali ke awal. Di langkah edit, struk langsung dicetak supaya sesi yang sudah dibayar tidak hilang."
          value={session.idleSec}
          min={20}
          max={900}
          onChange={(v) => edit((s) => void (s.session.idleSec = v))}
        />
      </section>

      <section class="panel">
        <h2>Isi struk</h2>
        <ImageField label="Logo (opsional)" hint="Paling bagus logo hitam-putih tanpa gradasi." value={receipt.logo} maxSide={480} onChange={(v) => edit((s) => void (s.receipt.logo = v))} />
        <TextField label="Judul" value={receipt.title} onChange={(v) => edit((s) => void (s.receipt.title = v))} />
        <TextField label="Sub-judul" value={receipt.subtitle} onChange={(v) => edit((s) => void (s.receipt.subtitle = v))} />
        <Check label="Cetak tanggal, jam & nomor sesi" checked={receipt.showMeta} onChange={(v) => edit((s) => void (s.receipt.showMeta = v))} />
        <TextField label="Judul kutipan" value={receipt.quoteTitle} onChange={(v) => edit((s) => void (s.receipt.quoteTitle = v))} />
        <AreaField
          label="Daftar kutipan"
          hint="Satu kutipan per baris. Tiap struk mendapat satu secara acak. Kosongkan untuk tanpa kutipan."
          value={receipt.quotes.join('\n')}
          onChange={(v) => edit((s) => void (s.receipt.quotes = v.split('\n').map((q) => q.trim()).filter(Boolean)))}
        />
        <TextField label="Kalimat penutup" value={receipt.closing} onChange={(v) => edit((s) => void (s.receipt.closing = v))} />
        <TextField label="Akun media sosial" placeholder="@namabooth" value={receipt.social} onChange={(v) => edit((s) => void (s.receipt.social = v))} />
        <TextField
          label="Tautan untuk kode QR (opsional)"
          placeholder="https://instagram.com/namabooth"
          value={receipt.qrUrl}
          onChange={(v) => edit((s) => void (s.receipt.qrUrl = v.trim()))}
        />
        <TextField label="Tulisan di bawah kode QR" value={receipt.qrCaption} onChange={(v) => edit((s) => void (s.receipt.qrCaption = v))} />
        <Check label="Hiasan barcode di bagian bawah" checked={receipt.barcode} onChange={(v) => edit((s) => void (s.receipt.barcode = v))} />
      </section>

      <section class="panel">
        <h2>Pratinjau struk</h2>
        <p class="hint">Contoh frame {frame.name} dengan foto uji. Beginilah titik-titik yang dikirim ke printer.</p>
        <div class="preview-box">
          <ReceiptPaper bits={preview} />
        </div>
      </section>
    </div>
  );
}
