import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Check, Segmented, TextField } from '../admin/fields';
import { samplePhoto } from '../lib/demoScene';
import type { Rect } from '../lib/image/types';
import { composeReceipt, loadImage, loadReceiptFonts, receiptToBits, type ComposedReceipt } from '../lib/receipt/compose';
import { toFrameDef, type FrameLayout } from '../lib/receipt/custom';
import { detectFrame, hasSideBySide } from '../lib/receipt/detect';
import { DEFAULT_SETTINGS } from '../lib/settings';
import type { BitImage } from '../lib/image/types';
import { ReceiptPaper, toast } from '../ui/components';
import type { CustomFrameRow, OwnerApi } from './api';
import { describe } from './ui';

/** Widths tried in turn until the stored picture is small enough. 576 is the widest a booth prints; 1080 keeps the download sharp. */
const WIDTHS = [1080, 864, 720, 576];
const MAX_IMAGE_CHARS = 2_500_000;
const THUMB_WIDTH = 240;

interface Loaded {
  url: string;
  image: HTMLImageElement;
  layout: FrameLayout;
}

/** Shrinks an uploaded picture to a size the tablets can hold, and finds the photo holes in it. */
async function readFrameFile(file: File): Promise<Loaded> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Berkas itu bukan gambar yang bisa dibaca. Pakai PNG dengan latar transparan.');
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let url = '';
  for (const limit of WIDTHS) {
    const width = Math.min(bitmap.width, limit);
    canvas.width = width;
    canvas.height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // WebP keeps transparency at a fraction of PNG's size; browsers that cannot write it fall back to PNG.
    url = canvas.toDataURL('image/webp', 0.92);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/png');
    if (url.length <= MAX_IMAGE_CHARS) break;
  }
  if (url.length > MAX_IMAGE_CHARS) throw new Error('Gambarnya terlalu besar. Sederhanakan desainnya atau perkecil ukurannya.');
  if (canvas.height > canvas.width * 6) throw new Error('Gambarnya terlalu panjang. Tinggi frame paling banyak 6 kali lebarnya.');

  const found = detectFrame(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  if (found.slots.length === 0) {
    throw new Error('Tidak ada lubang foto yang ditemukan. Area foto harus benar-benar transparan (bukan putih), dan gambarnya disimpan sebagai PNG.');
  }
  return { url, image: await loadImage(url), layout: { width: canvas.width, height: canvas.height, slots: found.slots, print: found.print } };
}

interface Preview {
  colour: HTMLCanvasElement;
  bits: BitImage;
  slots: (Rect | undefined)[];
}

/** The frame with sample photos, in colour and as the printer would print it. */
async function renderPreview(loaded: { image: HTMLImageElement; layout: FrameLayout }, name: string): Promise<{ preview: Preview; composed: ComposedReceipt }> {
  await loadReceiptFonts();
  const frame = toFrameDef({ id: 'pratinjau', name, blurb: '', layout: loaded.layout, image: loaded.image });
  const composed = composeReceipt({
    width: DEFAULT_SETTINGS.printer.dots,
    frame,
    photos: frame.slots.map((aspect, i) => samplePhoto(aspect, 0.4 + i * 1.9)),
    texts: DEFAULT_SETTINGS.receipt,
    quote: '',
    when: new Date(),
    sessionNo: 1,
    logo: null,
    compact: true,
  });
  return { preview: { colour: composed.canvas, bits: receiptToBits(composed, DEFAULT_SETTINGS.printer.raster), slots: composed.slotRects }, composed };
}

function thumbOf(canvas: HTMLCanvasElement): string {
  const small = document.createElement('canvas');
  small.width = THUMB_WIDTH;
  small.height = Math.max(1, Math.round((canvas.height * THUMB_WIDTH) / canvas.width));
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/jpeg', 0.8);
}

interface Props {
  api: OwnerApi;
  /** The frame being changed, or null for a new one. */
  frame: CustomFrameRow | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Adds or changes one of the franchise's own frames: a picture with transparent holes where the photos go. */
export function FrameEditor({ api, frame, onClose, onSaved }: Props) {
  const [loaded, setLoaded] = useState<{ image: HTMLImageElement; layout: FrameLayout } | null>(null);
  // Set only when a new picture was chosen, so an unchanged one is not uploaded again.
  const [newUrl, setNewUrl] = useState('');
  const [name, setName] = useState(frame?.name ?? '');
  const [blurb, setBlurb] = useState(frame?.blurb ?? '');
  const [active, setActive] = useState(frame?.active ?? true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(frame ? 'load' : '');
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const colour = useRef<HTMLCanvasElement>(null);

  // Editing: fetch the stored picture once.
  useEffect(() => {
    if (!frame) return;
    let cancelled = false;
    void (async () => {
      try {
        const image = await loadImage(await api.frameImage(frame.id));
        if (!cancelled) setLoaded({ image, layout: frame.layout });
      } catch (cause) {
        if (!cancelled) setError(describe(cause));
      }
      if (!cancelled) setBusy('');
    })();
    return () => {
      cancelled = true;
    };
  }, [frame?.id]);

  const layoutKey = useMemo(() => JSON.stringify(loaded?.layout ?? null), [loaded?.layout]);
  useEffect(() => {
    if (!loaded) return setPreview(null);
    let cancelled = false;
    void renderPreview(loaded, name).then(({ preview: made }) => {
      if (!cancelled) setPreview(made);
    });
    return () => {
      cancelled = true;
    };
  }, [loaded?.image, layoutKey]);

  useEffect(() => {
    const target = colour.current;
    if (!target || !preview) return;
    target.width = preview.colour.width;
    target.height = preview.colour.height;
    target.getContext('2d')!.drawImage(preview.colour, 0, 0);
  }, [preview]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy('read');
    setError('');
    try {
      const read = await readFrameFile(file);
      setLoaded({ image: read.image, layout: read.layout });
      setNewUrl(read.url);
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, '').slice(0, 40));
    } catch (cause) {
      setError(describe(cause));
    }
    setBusy('');
  };

  const setLayout = (change: Partial<FrameLayout>) => loaded && setLoaded({ ...loaded, layout: { ...loaded.layout, ...change } });
  const moveSlot = (index: number, step: -1 | 1) => {
    if (!loaded) return;
    const slots = loaded.layout.slots.slice();
    const to = index + step;
    if (to < 0 || to >= slots.length) return;
    [slots[index], slots[to]] = [slots[to], slots[index]];
    setLayout({ slots });
  };

  const save = async () => {
    if (!loaded) return;
    setBusy('save');
    setError('');
    try {
      // Drawn once more so the small picture always matches what is saved.
      const { composed } = await renderPreview(loaded, name);
      await api.saveFrame({
        id: frame?.id ?? null,
        name: name.trim(),
        blurb: blurb.trim(),
        layout: loaded.layout,
        active,
        thumb: thumbOf(composed.canvas),
        ...(newUrl ? { image: newUrl } : {}),
      });
      toast(frame ? 'Frame disimpan. Tablet mengikutinya dalam satu-dua menit.' : 'Frame ditambahkan. Centang "Ditawarkan ke tamu" di bawah untuk memakainya di tablet.');
      onSaved();
    } catch (cause) {
      setError(describe(cause));
    }
    setBusy('');
  };

  const pct = (value: number, of: number) => `${(value / of) * 100}%`;
  const slots = loaded?.layout.slots ?? [];

  return (
    <section class="panel span">
      <div class="row">
        <h2 class="grow">{frame ? `Ubah frame "${frame.name}"` : 'Tambah frame'}</h2>
        <button class="btn small" onClick={onClose}>
          Tutup
        </button>
      </div>
      <p class="hint">
        Frame adalah gambar dengan <b>lubang transparan</b> tempat foto tamu. Buat di Canva, Figma atau Photoshop, lalu unduh sebagai{' '}
        <b>PNG dengan latar transparan</b>. Lebar yang pas 1080 px; kertas struk dicetak hitam-putih, jadi desain garis hitam di atas putih
        paling tajam. Lubangnya dikenali sendiri, urut dari atas ke bawah. <b>Susun satu foto per baris</b>, selebar mungkin: kertas struk
        sempit, jadi foto yang berdampingan hasilnya kecil.
      </p>
      <input ref={picker} type="file" accept="image/png,image/webp" hidden onChange={(event) => void choose(event.currentTarget.files?.[0])} />
      <div class="row">
        <button class="btn small primary" disabled={busy !== ''} onClick={() => picker.current?.click()}>
          {busy === 'read' ? 'Membaca gambar…' : loaded ? 'Ganti gambar' : 'Pilih gambar frame'}
        </button>
      </div>
      {error && <p class="banner err">{error}</p>}
      {busy === 'load' && <div class="spinner" />}
      {loaded && hasSideBySide(loaded.layout.slots) && (
        <p class="banner">
          Di frame ini ada foto yang berdampingan. Di kertas struk, terutama 58 mm, foto seperti itu tercetak kecil. Lebih baik satu foto
          per baris, turun ke bawah.
        </p>
      )}

      {loaded && (
        <div class="admin-grid" style={{ margin: 0 }}>
          <div class="panel" style={{ boxShadow: 'none' }}>
            <TextField label="Nama frame (tampil untuk tamu)" value={name} onChange={(v) => setName(v.slice(0, 40))} />
            <TextField label="Keterangan singkat" value={blurb} placeholder={`${slots.length} foto`} onChange={(v) => setBlurb(v.slice(0, 80))} />
            <Segmented
              label="Cara mencetak gambar frame"
              value={loaded.layout.print}
              options={[
                { value: 'ink', label: 'Tegas (hitam-putih)' },
                { value: 'dither', label: 'Halus (bergradasi)' },
              ]}
              hint="Tegas untuk desain garis dan tulisan. Halus untuk desain berwarna atau bergradasi; lihat mana yang lebih bagus di pratinjau cetak."
              onChange={(print) => setLayout({ print })}
            />
            <div class="field">
              <span>Lubang foto ({slots.length})</span>
              {slots.map((slot, i) => (
                <div class="member" key={`${slot.x}-${slot.y}`}>
                  <div>
                    <b>Foto {i + 1}</b>
                    <small class="hint">
                      {Math.round(slot.w)} × {Math.round(slot.h)} px
                    </small>
                  </div>
                  <div class="row">
                    <button class="btn small" disabled={i === 0} onClick={() => moveSlot(i, -1)} aria-label={`Naikkan foto ${i + 1}`}>
                      ↑
                    </button>
                    <button class="btn small" disabled={i === slots.length - 1} onClick={() => moveSlot(i, 1)} aria-label={`Turunkan foto ${i + 1}`}>
                      ↓
                    </button>
                    <button class="btn small danger" disabled={slots.length <= 1} onClick={() => setLayout({ slots: slots.filter((_, at) => at !== i) })}>
                      Bukan foto
                    </button>
                  </div>
                </div>
              ))}
              <small class="hint">Urutan ini adalah urutan foto diambil. "Bukan foto" untuk area transparan yang memang dibiarkan kosong.</small>
            </div>
            <Check label="Aktif" hint="Frame yang tidak aktif disimpan, tetapi tidak dikirim ke tablet." checked={active} onChange={setActive} />
          </div>

          <div class="panel" style={{ boxShadow: 'none' }}>
            <div class="edit-pair">
              <figure>
                <figcaption>Berwarna · untuk diunduh</figcaption>
                <div class="paper">
                  <div class="slot-host">
                    <canvas ref={colour} />
                    {preview?.slots.map(
                      (rect, i) =>
                        rect && (
                          <span
                            key={i}
                            class="slot-number"
                            style={{ left: pct(rect.x + rect.w / 2, preview.colour.width), top: pct(rect.y + rect.h / 2, preview.colour.height) }}
                          >
                            {i + 1}
                          </span>
                        ),
                    )}
                  </div>
                </div>
              </figure>
              <figure>
                <figcaption>Hasil cetak</figcaption>
                <ReceiptPaper bits={preview?.bits ?? null} />
              </figure>
            </div>
            <p class="hint">Contoh dengan foto uji. Judul di atasnya berasal dari teks struk tiap tablet.</p>
          </div>
        </div>
      )}

      {loaded && (
        <div class="row">
          <button class="btn small primary" disabled={busy !== '' || !name.trim()} onClick={() => void save()}>
            {busy === 'save' ? 'Menyimpan…' : frame ? 'Simpan perubahan' : 'Simpan frame'}
          </button>
          <button class="btn small" onClick={onClose}>
            Batal
          </button>
        </div>
      )}
    </section>
  );
}
