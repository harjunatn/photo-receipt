import { usePrinter } from '../lib/printer/manager';
import { activeFrames } from '../lib/receipt/frames';
import { useFramePreviews } from '../lib/receipt/previews';
import { formatRupiah, useSettings } from '../lib/settings';

interface Props {
  onStart: () => void;
  onAdmin: () => void;
}

/** The idle screen guests see first: what this is, what it costs, and one big button. */
export function Attract({ onStart, onAdmin }: Props) {
  const settings = useSettings();
  const printer = usePrinter();
  const showcase = activeFrames(settings.frames.active).slice(0, 3);
  const previews = useFramePreviews(showcase, settings);
  const prices = settings.packages.filter((p) => p.active).map((p) => p.price);
  const printerDot = printer.status === 'connected' || printer.status === 'printing' ? 'on' : printer.status === 'connecting' ? 'busy' : '';

  return (
    <div class="screen attract">
      <div class="attract-copy">
        <span class="pill">Photobooth struk — cetak instan</span>
        <h1 class="display">{settings.brand.title}</h1>
        <p class="lead">{settings.brand.subtitle}</p>
        {prices.length > 0 ? (
          <>
            <button class="btn primary huge glow" onClick={onStart}>
              Mulai foto
            </button>
            <p class="note">
              {Math.min(...prices) > 0 ? `Mulai ${formatRupiah(Math.min(...prices))} per sesi` : 'Gratis — langsung foto!'}
              {' · '}pilih frame, foto, edit, cetak
            </p>
          </>
        ) : (
          <p class="banner">Belum ada harga yang aktif. Petugas: buka pengaturan (ikon ⚙ di pojok kanan bawah).</p>
        )}
      </div>

      <div class="attract-art" aria-hidden="true">
        {showcase.map((frame, i) => (
          <div key={frame.id} class={`strip strip-${i}`}>
            {previews[frame.id] ? <img src={previews[frame.id]} alt="" /> : <div class="strip-loading" />}
          </div>
        ))}
      </div>

      <div class="corner">
        <span>
          <i class={`dot ${printerDot}`} /> printer
        </span>
        <button class="gear" onClick={onAdmin} aria-label="Pengaturan petugas">
          ⚙
        </button>
      </div>
    </div>
  );
}
