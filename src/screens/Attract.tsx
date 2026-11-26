import { pairingStore, subscriptionStore } from '../lib/cloud/device';
import { boothTitle, cloudConfigured, ribbonText, subscriptionState } from '../lib/cloud/shared';
import { usePrinter } from '../lib/printer/manager';
import { activeFrames } from '../lib/receipt/frames';
import { useFramePreviews } from '../lib/receipt/previews';
import { formatRupiah, useSettings } from '../lib/settings';
import { useStore } from '../lib/store';

interface Props {
  onStart: () => void;
  onAdmin: () => void;
}

/**
 * The band of the brand's own posters. On a tablet lying on its side it comes down from the top of the
 * screen and leaves through the right edge; on one standing upright it crosses the lower half from the
 * left edge to the right, below the title.
 */
const RIBBONS = [
  {
    id: 'wide',
    viewBox: '0 0 700 800',
    fit: 'xMaxYMid slice',
    path: 'M130 -70C130 110 220 150 380 150C560 150 640 220 640 310C640 410 540 440 400 440C260 440 200 500 200 570C200 660 320 684 480 684L780 684',
  },
  {
    id: 'tall',
    viewBox: '0 0 800 740',
    fit: 'xMidYMax slice',
    path: 'M-80 90C180 40 470 60 600 130C730 200 740 330 590 380C430 430 250 400 170 470C80 550 150 630 330 630L900 630',
  },
];

/** The idle screen guests see first: what this is, what it costs, and one big button. */
export function Attract({ onStart, onAdmin }: Props) {
  const settings = useSettings();
  const printer = usePrinter();
  const pairing = useStore(pairingStore);
  const paired = pairing !== null;
  const subscription = subscriptionState(useStore(subscriptionStore));
  const stopped = subscription === 'expired' || subscription === 'suspended';
  const showcase = activeFrames(settings.frames.active).slice(0, 3);
  const previews = useFramePreviews(showcase, settings);
  const prices = settings.packages.filter((p) => p.active).map((p) => p.price);
  const title = boothTitle(settings, pairing ? (pairing.franchise ?? '') : null);
  const printerDot = printer.status === 'connected' || printer.status === 'printing' ? 'on' : printer.status === 'connecting' ? 'busy' : '';

  return (
    <div class="screen attract">
      {RIBBONS.map((ribbon) => (
        <svg key={ribbon.id} class={`ribbon ${ribbon.id}`} viewBox={ribbon.viewBox} preserveAspectRatio={ribbon.fit} aria-hidden="true">
          <defs>
            <path id={`ribbon-${ribbon.id}`} d={ribbon.path} />
          </defs>
          <use href={`#ribbon-${ribbon.id}`} />
          <text dy="9">
            <textPath href={`#ribbon-${ribbon.id}`}>{ribbonText(settings.brand.subtitle || title)}</textPath>
          </text>
        </svg>
      ))}
      <div class="attract-copy">
        <span class="pill">Photobooth struk — cetak instan</span>
        <h1 class="display">{title}</h1>
        <p class="lead">{settings.brand.subtitle}</p>
        {!cloudConfigured ? (
          <p class="banner err">Aplikasi ini belum disambungkan ke Supabase. Isi alamat dan kuncinya di Vercel, lalu deploy ulang.</p>
        ) : !paired ? (
          <p class="banner">
            Tablet ini belum disambungkan ke dashboard, jadi belum bisa dipakai tamu. Petugas: ketuk ⚙ di pojok kanan
            bawah → <b>Sambungan</b>.
          </p>
        ) : stopped ? (
          <p class="banner">
            Booth ini sedang tidak menerima tamu. Petugas:{' '}
            {subscription === 'expired' ? 'langganan aplikasi sudah berakhir' : 'franchise ini sedang dihentikan'}; hubungi pemilik platform,
            lalu ketuk ⚙ → <b>Sambungan</b> → Sinkronkan sekarang.
          </p>
        ) : prices.length > 0 ? (
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
          <p class="banner">Belum ada harga yang aktif. Atur harga di dashboard pemilik (menu Pengaturan).</p>
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
