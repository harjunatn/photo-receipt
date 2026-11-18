import { useMemo, useState } from 'preact/hooks';
import { SHARE_DAYS, shareUrl } from '../lib/cloud/shared';
import { qrShape } from '../lib/qr';
import { Overlay } from './components';

/** When a session's digital copies stop being downloadable. */
export function shareExpiry(sessionAt: string | number | Date): Date {
  return new Date(new Date(sessionAt).getTime() + SHARE_DAYS * 86_400_000);
}

/** Shows a session's download QR code again, e.g. for a guest who lost the receipt. */
export function ShareQrDialog({ code, sessionAt, onClose }: { code: string; sessionAt: string | number | Date; onClose: () => void }) {
  const url = shareUrl(code);
  const shape = useMemo(() => qrShape(url), [url]);
  const [copied, setCopied] = useState(false);
  const until = shareExpiry(sessionAt);
  const expired = until.getTime() < Date.now();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div class="card dialog share-qr">
        <h2 class="heading small">Scan untuk unduh foto</h2>
        {expired ? (
          <p class="banner">Masa simpan hasil foto ini sudah habis ({SHARE_DAYS} hari), jadi berkasnya sudah dihapus.</p>
        ) : (
          shape && (
            <svg viewBox={`0 0 ${shape.size} ${shape.size}`} role="img" aria-label="Kode QR hasil foto" shape-rendering="crispEdges">
              <rect width={shape.size} height={shape.size} fill="#fff" />
              <path d={shape.path} fill="#000" />
            </svg>
          )
        )}
        <p class="hint mono share-qr-url">{url}</p>
        {!expired && <p class="hint">Tersedia sampai {until.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>}
        <div class="row center">
          <button class="btn small" onClick={() => void copy()}>
            {copied ? 'Tersalin' : 'Salin tautan'}
          </button>
          <button class="btn small primary" onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
    </Overlay>
  );
}
