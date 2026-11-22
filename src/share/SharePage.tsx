import '../dashboard/dashboard.css';
import './share.css';
import { useEffect, useState } from 'preact/hooks';
import { cloudConfigured, SHARE_DAYS, SUPABASE_KEY, SUPABASE_URL } from '../lib/cloud/shared';

type Kind = 'photo' | 'news' | 'live' | 'slideshow' | 'ai';
/** The session's photos without their frame, one per shot, to pick from for the AI version. */
const PLAIN = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const;
type PlainKind = (typeof PLAIN)[number];
interface ShareFile {
  view: string;
  download: string;
  size: number;
  type: string;
}
/** How the AI version of this session stands; absent when the booth does not offer one. */
interface AiOffer {
  /** A version can be asked for now. */
  open: boolean;
  /** One is being drawn at this moment. */
  busy: boolean;
  tries_left: number;
  styles: { id: string; label: string }[];
}
interface Share {
  code: string;
  status: 'ready' | 'pending' | 'expired';
  created_at?: string;
  expires_at?: string;
  files?: Partial<Record<Kind | 'thumb' | PlainKind, ShareFile>>;
  /** Videos the booth is still making or sending. */
  coming?: Kind[];
  ai?: AiOffer;
}
interface Answer {
  brand?: { title: string; accent: string };
  /** The platform behind the booth; its mark closes the page. */
  platform?: { name: string; watermark: string };
  shares?: Share[];
  error?: string;
}

const TABS: { kind: Kind; label: string; button: string }[] = [
  { kind: 'photo', label: 'Foto', button: 'Unduh foto' },
  { kind: 'live', label: 'Boomerang', button: 'Unduh boomerang' },
  { kind: 'slideshow', label: 'Video Slideshow', button: 'Unduh video' },
  { kind: 'news', label: 'Koran', button: 'Unduh koran' },
  { kind: 'ai', label: 'Versi AI', button: 'Unduh versi AI' },
];

/** What each picture is, for someone who cannot see it. */
const ALT: Partial<Record<Kind, string>> = { ai: 'Fotomu digambar ulang oleh AI', news: 'Fotomu sebagai halaman depan koran' };

/** While a version is being drawn, the page looks for it this often. */
const AI_POLL_MS = 4000;
/** What the guest is told when the server turns a request down. */
const AI_ERRORS: Record<string, string> = {
  refused: 'AI tidak bisa menggambar ulang foto ini. Coba gaya atau foto lain.',
  failed: 'Belum berhasil. Coba sekali lagi.',
  tries: 'Sudah tiga kali gagal, jadi versi AI untuk sesi ini ditutup.',
  limit: 'Kuota versi AI bulan ini sudah habis.',
  expired: 'Masa simpan sesi ini sudah habis.',
};
const AI_UNAVAILABLE = 'Versi AI sedang tidak tersedia.';

/** While the booth is still uploading, the page asks again by itself for this long. */
const RETRY_MS = 8000;
const GIVE_UP_MS = 15 * 60_000;
/** Videos still missing this long after the session are not coming any more (e.g. the booth went offline). */
const VIDEOS_WITHIN_MS = 15 * 60_000;

function codeFromHash(): string {
  return (location.hash.match(/^#s\/([a-z0-9]{12})$/) ?? [])[1] ?? '';
}

function longDate(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** The page a guest opens from the QR code on their receipt: their photos to view and save, for a few days. */
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
  const recent = share?.created_at !== undefined && Date.now() - Date.parse(share.created_at) < VIDEOS_WITHIN_MS;
  const coming = share?.status === 'ready' && recent ? (share.coming ?? []) : [];
  // Someone asked for the AI version (here or on another phone with the same code) and it is still being drawn.
  const drawing = share?.ai?.busy === true && !share.files?.ai;

  // Ask again until the photos, and the videos that follow them, have arrived from the booth.
  useEffect(() => {
    if ((!waiting && coming.length === 0) || Date.now() - started > GIVE_UP_MS) return;
    const timer = setTimeout(() => setTurn((n) => n + 1), RETRY_MS);
    return () => clearTimeout(timer);
  }, [waiting, coming.length, turn]);

  useEffect(() => {
    if (!drawing) return;
    const timer = setTimeout(() => setTurn((n) => n + 1), AI_POLL_MS);
    return () => clearTimeout(timer);
  }, [drawing, turn]);

  useEffect(() => {
    if (answer?.brand?.accent) document.documentElement.style.setProperty('--accent', answer.brand.accent);
    if (answer?.brand?.title) document.title = `Hasil foto · ${answer.brand.title}`;
  }, [answer?.brand]);

  const available = TABS.filter((t) => (t.kind === 'ai' ? share?.ai !== undefined : share?.files?.[t.kind] || coming.includes(t.kind)));
  const current = available.find((t) => t.kind === tab) ?? available[0];
  const file = current ? share?.files?.[current.kind] : undefined;

  return (
    <main class="share">
      <header class="share-head">
        <span class="pill">{answer?.brand?.title ?? 'Photobooth'}</span>
        <h1 class="heading">Hasil foto kamu</h1>
      </header>

      {!code || !cloudConfigured ? (
        <p class="banner err">Tautan ini tidak lengkap. Coba scan ulang kode QR di strukmu.</p>
      ) : answer && (answer.error || !share) ? (
        <p class="banner err">Hasil foto sedang tidak bisa dibuka. Coba lagi sebentar lagi.</p>
      ) : share?.status === 'expired' ? (
        <section class="share-note">
          <p class="lead">Masa simpan fotomu sudah habis.</p>
          <p class="hint">Hasil foto digital hanya disimpan {SHARE_DAYS} hari, lalu dihapus otomatis.</p>
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
          {!file && current?.kind === 'ai' && share?.ai && (
            <AiMaker code={code} share={share} offer={share.ai} drawing={drawing} onChanged={() => setTurn((n) => n + 1)} />
          )}
          {!file && current && current.kind !== 'ai' && (
            <section class="share-note">
              <div class="spinner" />
              <p class="lead">{current.label} sedang dibuat di booth.</p>
              <p class="hint">Halaman ini memeriksa lagi sendiri; biasanya kurang dari satu menit.</p>
            </section>
          )}
          {file && current && (
            <>
              <figure class="share-media">
                {file.type.startsWith('video/') ? (
                  <video src={file.view} controls autoplay loop muted playsinline />
                ) : (
                  <img src={file.view} alt={ALT[current.kind] ?? 'Hasil foto dengan frame'} />
                )}
              </figure>
              <a class="btn primary share-download" href={file.download}>
                {current.button}
              </a>
              {current.kind === 'ai' && <p class="hint share-hint">Digambar ulang oleh AI dari fotomu. Jatah versi AI untuk sesi ini sudah dipakai.</p>}
              <p class="hint share-hint">
                {file.type.startsWith('video/') ? (
                  <>
                    Di iPhone, kalau video terbuka di tab baru: ketuk tombol bagikan lalu pilih <b>Simpan Video</b>.
                  </>
                ) : (
                  <>
                    Di iPhone, kalau berkas terbuka di tab baru: tekan lama gambarnya lalu pilih <b>Simpan ke Foto</b>.
                  </>
                )}
              </p>
            </>
          )}
          <p class="hint share-hint">Tersedia sampai {longDate(share?.expires_at)}, lalu dihapus otomatis.</p>
        </>
      )}

      <footer class="share-foot hint">
        {answer?.brand?.title ? `Dibuat di photobooth ${answer.brand.title}` : 'Dibuat di photobooth'}
        {answer?.platform?.watermark ? ` · ${answer.platform.watermark}` : ''}
      </footer>
    </main>
  );
}

/**
 * Where the guest asks for the AI version: one of the session's photos, one of
 * the styles on offer, one tap. The photo goes to the server, which decides
 * whether it may still be made and has it drawn.
 */
function AiMaker({ code, share, offer, drawing, onChanged }: { code: string; share: Share; offer: AiOffer; drawing: boolean; onChanged: () => void }) {
  const photos = PLAIN.flatMap((kind) => (share.files?.[kind] ? [{ kind, view: share.files[kind]!.view }] : []));
  const [photo, setPhoto] = useState<PlainKind>(photos[0]?.kind ?? 'p1');
  const [style, setStyle] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState('');
  const working = sending || drawing;

  const make = async () => {
    if (!style || working) return;
    setSending(true);
    setProblem('');
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/share-ai`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, style, photo }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      // "used" and "busy": a version exists or is on its way; the page finds it by looking again.
      if (!result.ok && result.error !== 'used' && result.error !== 'busy') setProblem(AI_ERRORS[result.error ?? ''] ?? AI_UNAVAILABLE);
    } catch {
      // The phone lost the connection while waiting; the drawing may still arrive, and looking again shows it.
      setProblem('Sambungan terputus saat menunggu. Halaman ini memeriksa lagi sendiri.');
    }
    setSending(false);
    onChanged();
  };

  if (working) {
    return (
      <section class="share-note">
        <div class="spinner" />
        <p class="lead">Fotomu sedang digambar ulang.</p>
        <p class="hint">Biasanya kurang dari satu menit. Jangan tutup halaman ini.</p>
      </section>
    );
  }

  if (!offer.open || offer.tries_left <= 0 || photos.length === 0) {
    return (
      <section class="share-note">
        <p class="lead">{offer.tries_left <= 0 ? AI_ERRORS.tries : AI_UNAVAILABLE}</p>
      </section>
    );
  }

  return (
    <section class="share-ai">
      <p class="share-ai-step">1. Pilih fotonya</p>
      <div class="share-ai-photos">
        {photos.map((entry, index) => (
          <button
            key={entry.kind}
            type="button"
            class={entry.kind === photo ? 'on' : ''}
            aria-pressed={entry.kind === photo}
            aria-label={`Foto ${index + 1}`}
            onClick={() => setPhoto(entry.kind)}
          >
            <img src={entry.view} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      <p class="share-ai-step">2. Pilih gayanya</p>
      <div class="share-ai-styles">
        {offer.styles.map((entry) => (
          <button key={entry.id} type="button" class={`chip ${entry.id === style ? 'on' : ''}`} aria-pressed={entry.id === style} onClick={() => setStyle(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>
      {problem && <p class="banner err">{problem}</p>}
      <button class="btn primary share-download" disabled={!style} onClick={() => void make()}>
        Buat versi AI
      </button>
      <p class="hint share-hint">
        Gratis 1 kali untuk sesi ini. Foto yang kamu pilih dikirim ke layanan AI Google untuk digambar ulang, jadi wajahnya bisa sedikit
        berbeda.
      </p>
    </section>
  );
}
