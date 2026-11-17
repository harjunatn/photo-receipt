import { useEffect, useState } from 'preact/hooks';
import { DEMO_CAMERA_ID, listCameras } from '../lib/camera';
import { samplePhoto } from '../lib/demoScene';
import type { BitImage } from '../lib/image/types';
import { composeReceipt, loadImage, loadReceiptFonts, receiptToBits } from '../lib/receipt/compose';
import { activeFrames } from '../lib/receipt/frames';
import { useSettings } from '../lib/settings';
import { ReceiptPaper } from '../ui/components';
import { edit } from './actions';
import { Check, NumberField, Segmented } from './fields';

/**
 * How a session runs on this tablet: camera, countdown, sound. What the receipt
 * says is decided in the owner's dashboard; it is only previewed here.
 */
export function SessionTab() {
  const settings = useSettings();
  const { receipt, session, printer } = settings;
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
        <h2>Pratinjau struk</h2>
        <p class="hint">
          Contoh frame {frame.name} dengan foto uji, persis titik-titik yang dikirim ke printer. Teks, logo dan frame
          diatur di dashboard pemilik.
        </p>
        <div class="preview-box">
          <ReceiptPaper bits={preview} />
        </div>
      </section>
    </div>
  );
}
