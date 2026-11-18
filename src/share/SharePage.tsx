import '../dashboard/dashboard.css';
import './share.css';
import { useEffect, useState } from 'preact/hooks';
import { cloudConfigured, SUPABASE_KEY, SUPABASE_URL } from '../lib/cloud/shared';

type Kind = 'photo' | 'live' | 'slideshow';
interface ShareFile {
  view: string;
  download: string;
  size: number;
  type: string;
}
interface Share {
  code: string;
  status: 'ready' | 'pending' | 'expired';
  expires_at?: string;
  files?: Partial<Record<Kind | 'thumb', ShareFile>>;
}
interface Answer {
  brand?: { title: string; accent: string };
  shares?: Share[];
  error?: string;
}

const TABS: { kind: Kind; label: string; button: string }[] = [
  { kind: 'photo', label: 'Foto', button: 'Unduh foto' },
  { kind: 'live', label: 'Live Foto', button: 'Unduh video' },
  { kind: 'slideshow', label: 'Video Slideshow', button: 'Unduh video' },
];

/** While the booth is still uploading, the page asks again by itself for this long. */
const RETRY_MS = 8000;
const GIVE_UP_MS = 15 * 60_000;

function codeFromHash(): string {
  return (location.hash.match(/^#s\/([a-z0-9]{12})$/) ?? [])[1] ?? '';
}

function longDate(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** The page a guest opens from the QR code on their receipt: their photos to view and save, for seven days. */
export function SharePage() {
  const code = codeFromHash();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Kind>('photo');
  const [turn, setTurn] = useState(0);
  const [started] = useState(Date.now());

  useEffect(() => {
    if (!code || !cloudConfigured) return;
    let cancelled = false;
    fetch(`${SUPABASE_URL}/functions/v1/share-get`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then((response) => response.json() as Promise<Answer>)
      .then((result) => {
        if (cancelled) return;
        setAnswer(result);
        setFailed(false);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [code, turn]);

  const share = answer?.shares?.[0];
  const waiting = failed || share?.status === 'pending';

  // Ask again until the photos have arrived from the booth.
  useEffect(() => {
    if (!waiting || Date.now() - started > GIVE_UP_MS) return;
    const timer = setTimeout(() => setTurn((n) => n + 1), RETRY_MS);
    return () => clearTimeout(timer);
  }, [waiting, turn]);

  useEffect(() => {
    if (answer?.brand?.accent) document.documentElement.style.setProperty('--accent', answer.brand.accent);
    if (answer?.brand?.title) document.title = `Hasil foto · ${answer.brand.title}`;
  }, [answer?.brand]);

  const available = TABS.filter((t) => share?.files?.[t.kind]);
  const current = available.find((t) => t.kind === tab) ?? available[0];
  const file = current ? share?.files?.[current.kind] : undefined;

  return (
    <main class="share">
      <header class="share-head">
        <span class="pill">{answer?.brand?.title ?? 'Hello Snaply'}</span>
        <h1 class="heading">Hasil foto kamu</h1>
      </header>

      {!code || !cloudConfigured ? (
        <p class="banner err">Tautan ini tidak lengkap. Coba scan ulang kode QR di strukmu.</p>
      ) : answer && (answer.error || !share) ? (
        <p class="banner err">Hasil foto sedang tidak bisa dibuka. Coba lagi sebentar lagi.</p>
      ) : share?.status === 'expired' ? (
        <section class="share-note">
          <p class="lead">Masa simpan fotomu sudah habis.</p>
          <p class="hint">Hasil foto digital hanya disimpan 7 hari, lalu dihapus otomatis.</p>
        </section>
      ) : waiting ? (
        <section class="share-note">
          <div class="spinner" />
          <p class="lead">Fotomu sedang dikirim dari booth.</p>
          <p class="hint">
            Halaman ini memeriksa lagi sendiri. Biasanya hanya beberapa detik, tapi bisa lebih lama kalau internet booth
            sedang lambat.
          </p>
          {Date.now() - started > GIVE_UP_MS && (
            <button class="btn small" onClick={() => setTurn((n) => n + 1)}>
              Periksa lagi
            </button>
          )}
        </section>
      ) : !answer ? (
        <div class="spinner" />
      ) : (
        <>
          {available.length > 1 && (
            <div class="chips tight share-tabs">
              {available.map((t) => (
                <button key={t.kind} class={`chip ${current?.kind === t.kind ? 'on' : ''}`} onClick={() => setTab(t.kind)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {file && current && (
            <>
              <figure class="share-media">
                {file.type.startsWith('video/') ? (
                  <video src={file.view} controls autoplay loop muted playsinline />
                ) : (
                  <img src={file.view} alt="Hasil foto dengan frame" />
                )}
              </figure>
              <a class="btn primary share-download" href={file.download}>
                {current.button}
              </a>
              <p class="hint share-hint">
                Di iPhone, kalau berkas terbuka di tab baru: tekan lama gambarnya lalu pilih <b>Simpan ke Foto</b>.
              </p>
            </>
          )}
          <p class="hint share-hint">Tersedia sampai {longDate(share?.expires_at)}, lalu dihapus otomatis.</p>
        </>
      )}

      <footer class="share-foot hint">Dibuat di photobooth {answer?.brand?.title ?? 'Hello Snaply'}</footer>
    </main>
  );
}
