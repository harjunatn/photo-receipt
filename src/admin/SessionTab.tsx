import { useEffect, useState } from 'preact/hooks';
import { DEMO_CAMERA_ID, listCameras } from '../lib/camera';
import { useSettings } from '../lib/settings';
import { edit } from './actions';
import { Check, NumberField, Segmented } from './fields';
import { CardFlow } from '../ui/CardFlow';

/** How a session runs on this tablet: camera, countdown, sound. The receipt has its own tab. */
export function SessionTab() {
  const { session } = useSettings();
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    listCameras().then(setCameras).catch(() => undefined);
  }, []);

  return (
    <CardFlow>
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
    </CardFlow>
  );
}
