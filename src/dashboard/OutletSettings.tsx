import { useEffect, useState } from 'preact/hooks';
import { Check, ImageField, NumberField, Segmented, TextField } from '../admin/fields';
import { completeOutlet, outletFromSettings, SHARE_DAYS, type OutletConfig } from '../lib/cloud/shared';
import { DEFAULT_SETTINGS, formatRupiah } from '../lib/settings';
import { toast } from '../ui/components';
import type { PageProps } from './Dashboard';
import { DokuSetup } from './DokuSetup';
import { LoadState, PageHead, describe, useLoad } from './ui';

/** What every tablet shares: the outlet's name, logo, prices and ways of paying. Receipt texts are set on each tablet. */
export function OutletSettings({ api }: PageProps) {
  const load = useLoad(async () => completeOutlet(await api.getOutlet(), outletFromSettings(DEFAULT_SETTINGS)), [api]);
  const [draft, setDraft] = useState<OutletConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (load.data) setDraft(structuredClone(load.data));
  }, [load.data]);

  if (!draft) {
    return (
      <>
        <PageHead title="Pengaturan" lead={`Berlaku untuk semua tablet ${api.franchise.name}.`} />
        <LoadState load={load} />
      </>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(load.data);
  const edit = (change: (next: OutletConfig) => void) => {
    const next = structuredClone(draft);
    change(next);
    setDraft(next);
  };
  const activePrices = draft.packages.filter((p) => p.active).length;

  const save = async () => {
    setBusy(true);
    try {
      await api.saveOutlet(draft);
      toast('Disimpan. Tablet mengikutinya dalam satu-dua menit, saat tidak ada tamu.');
      load.reload();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  const changePassword = async () => {
    setBusy(true);
    try {
      await api.changePassword(password);
      setPassword('');
      toast('Password diganti.');
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  return (
    <>
      <PageHead title="Pengaturan" lead={`Berlaku untuk semua tablet ${api.franchise.name}. Teks struk, printer, kamera, waktu sesi dan PIN petugas diatur di tiap tablet.`}>
        {dirty && (
          <button class="btn small" disabled={busy} onClick={() => setDraft(structuredClone(load.data))}>
            Batalkan perubahan
          </button>
        )}
        <button class="btn small primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Menyimpan…' : dirty ? 'Simpan' : 'Tersimpan'}
        </button>
      </PageHead>

      <div class="admin-grid">
        <section class="panel">
          <h2>Outlet</h2>
          <TextField label="Nama di layar tamu" value={draft.brand.title} onChange={(v) => edit((d) => void (d.brand.title = v))} />
          <TextField label="Kalimat di bawah nama" value={draft.brand.subtitle} onChange={(v) => edit((d) => void (d.brand.subtitle = v))} />
          <label class="field">
            <span>Warna aksen</span>
            <input type="color" value={draft.brand.accent} onInput={(event) => edit((d) => void (d.brand.accent = event.currentTarget.value))} />
          </label>
          <ImageField
            label="Logo di struk (opsional)"
            hint="Paling bagus logo hitam-putih tanpa gradasi. Teks struk (judul, kutipan, kode QR) diatur di tiap tablet: ⚙ → Struk."
            value={draft.receipt.logo}
            maxSide={480}
            onChange={(v) => edit((d) => void (d.receipt.logo = v))}
          />
        </section>

        <section class="panel">
          <h2>Cara bayar</h2>
          <Check
            label="QRIS"
            hint="Tamu membayar dengan scan kode QR dari e-wallet atau m-banking."
            checked={draft.payment.qris}
            onChange={(v) => edit((d) => void (d.payment.qris = v))}
          />
          {draft.payment.qris && (
            <div class="panel">
              <Segmented
                label="Cara kerja QRIS"
                value={draft.payment.qrisAuto ? 'auto' : 'manual'}
                options={[
                  { value: 'auto', label: 'Otomatis (DOKU)' },
                  { value: 'manual', label: 'Manual (gambar + PIN)' },
                ]}
                onChange={(v) => edit((d) => void (d.payment.qrisAuto = v === 'auto'))}
              />
              {draft.payment.qrisAuto ? (
                <p class="hint">
                  Tablet membuat kode QR khusus untuk tiap sesi dengan nominal yang sudah terisi, dan sesi foto mulai sendiri
                  begitu pembayaran masuk — tanpa petugas. Membutuhkan internet di tablet dan kunci akun DOKU franchise ini,
                  yang diisi di bagian <b>Akun DOKU</b> di bawah.
                </p>
              ) : (
                <>
                  <p class="hint">Gambar QRIS tokomu ditampilkan; petugas mengecek bukti bayar lalu mengonfirmasi dengan PIN.</p>
                  <ImageField label="Gambar QRIS" value={draft.payment.qrisImage} maxSide={720} onChange={(v) => edit((d) => void (d.payment.qrisImage = v))} />
                  {!draft.payment.qrisImage && <p class="banner">Unggah gambar QRIS dulu — tanpa gambar, pilihan QRIS tidak ditampilkan ke tamu.</p>}
                </>
              )}
            </div>
          )}
          <Check label="Tunai" hint="Tamu membayar ke petugas; petugas mengonfirmasi dengan PIN." checked={draft.payment.cash} onChange={(v) => edit((d) => void (d.payment.cash = v))} />
          <Check label="Voucher" hint="Kode sekali pakai dari menu Voucher." checked={draft.payment.voucher} onChange={(v) => edit((d) => void (d.payment.voucher = v))} />
        </section>

        <section class="panel">
          <h2>Unduh foto lewat QR</h2>
          <Check
            label="Tamu bisa mengunduh hasil fotonya"
            hint={`Struk mencetak kode QR. Tamu membuka halaman berisi foto berwarna dengan frame, bisa diunduh selama ${SHARE_DAYS} hari, lalu dihapus otomatis.`}
            checked={draft.share.enabled}
            onChange={(v) => edit((d) => void (d.share.enabled = v))}
          />
          {!draft.share.enabled && (
            <p class="banner err">
              Sedang mati: struk tidak mencetak QR unduhan, foto tamu tidak dikirim, dan kolom Hasil foto di menu Transaksi kosong. Sesi
              yang sudah lewat tidak bisa disusulkan. Centang lagi lalu Simpan untuk menyalakannya.
            </p>
          )}
          {draft.share.enabled && api.superadmin && (
            <p class="hint">
              Fotonya disimpan di Cloudflare R2 milik platform (disetel sekali di Supabase, lihat README). Kalau R2 belum siap, tablet tetap
              mencetak QR dan fotonya menunggu di tablet.
            </p>
          )}
        </section>

        {draft.payment.qris && draft.payment.qrisAuto && <DokuSetup api={api} />}

        <section class="panel span">
          <div class="row">
            <h2 class="grow">Harga</h2>
            <button
              class="btn small"
              onClick={() =>
                edit((d) => {
                  d.packages.push({ id: crypto.randomUUID(), name: 'Pilihan baru', description: 'Satu sesi foto, dicetak 1 lembar', price: 15000, prints: 1, active: false });
                })
              }
            >
              + Tambah pilihan harga
            </button>
          </div>
          <p class="hint">Dengan satu pilihan aktif, tamu langsung melihat harga itu. Lebih dari satu, tamu memilih di langkah pembayaran. Harga 0 berarti gratis.</p>
          {activePrices === 0 && <p class="banner err">Belum ada pilihan harga yang aktif — tamu tidak bisa memulai sesi.</p>}
          <div class="admin-grid">
            {draft.packages.map((pkg, index) => (
              <div class="panel" key={pkg.id}>
                <TextField label="Nama (tampil untuk tamu)" value={pkg.name} onChange={(v) => edit((d) => void (d.packages[index].name = v))} />
                <TextField label="Keterangan" value={pkg.description} onChange={(v) => edit((d) => void (d.packages[index].description = v))} />
                <NumberField
                  label={`Harga (Rp) — tampil sebagai ${pkg.price > 0 ? formatRupiah(pkg.price) : 'GRATIS'}`}
                  value={pkg.price}
                  min={0}
                  max={10_000_000}
                  step={1000}
                  onChange={(v) => edit((d) => void (d.packages[index].price = v))}
                />
                <Segmented
                  label="Jumlah lembar yang dicetak"
                  value={pkg.prints}
                  options={[1, 2, 3, 4].map((value) => ({ value, label: `${value}x` }))}
                  onChange={(v) => edit((d) => void (d.packages[index].prints = v))}
                />
                <Check label="Aktif (ditawarkan ke tamu)" checked={pkg.active} onChange={(v) => edit((d) => void (d.packages[index].active = v))} />
                {draft.packages.length > 1 && (
                  <button class="btn small danger" onClick={() => edit((d) => void d.packages.splice(index, 1))}>
                    Hapus pilihan ini
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section class="panel">
          <h2>Akun pemilik</h2>
          <p class="hint">
            Masuk sebagai <b>{api.email}</b>.
          </p>
          <label class="field">
            <span>Password baru (minimal 8 karakter)</span>
            <input type="password" autocomplete="new-password" value={password} onInput={(event) => setPassword(event.currentTarget.value)} />
          </label>
          <div class="row">
            <button class="btn small" disabled={busy || password.length < 8 || api.demo} onClick={() => void changePassword()}>
              Ganti password
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
