import { formatRupiah, useSettings } from '../lib/settings';
import { edit } from './actions';
import { Check, NumberField, Segmented, TextField } from './fields';

/** What a session costs and how many copies it prints. */
export function PackagesTab() {
  const { packages } = useSettings();
  const activeCount = packages.filter((p) => p.active).length;

  const addOption = () =>
    edit((s) => {
      s.packages.push({
        id: crypto.randomUUID(),
        name: 'Pilihan baru',
        description: 'Satu sesi foto, dicetak 1 lembar',
        price: 15000,
        prints: 1,
        active: false,
      });
    });

  return (
    <div class="admin-grid">
      <section class="panel span">
        <h2>Harga</h2>
        <p class="hint">
          Harga berlaku untuk frame apa pun. Dengan <b>satu</b> pilihan aktif, tamu langsung melihat harga itu di langkah
          pembayaran. Kalau lebih dari satu yang aktif (misalnya 1 lembar dan 2 lembar), tamu memilihnya di langkah
          pembayaran. Harga 0 berarti gratis: sesi langsung mulai tanpa pembayaran.
        </p>
        {activeCount === 0 && <p class="banner err">Belum ada pilihan harga yang aktif — tamu tidak bisa memulai sesi.</p>}
        <div class="row">
          <button class="btn small primary" onClick={addOption}>
            + Tambah pilihan harga
          </button>
        </div>
      </section>

      {packages.map((pkg, index) => (
        <section class="panel" key={pkg.id}>
          <div class="row">
            <h2 class="grow">{pkg.name || 'Tanpa nama'}</h2>
            <span class={`tag ${pkg.active ? 'ok' : ''}`}>{pkg.active ? 'Aktif' : 'Nonaktif'}</span>
          </div>
          <TextField label="Nama (tampil untuk tamu)" value={pkg.name} onChange={(v) => edit((s) => void (s.packages[index].name = v))} />
          <TextField label="Keterangan" value={pkg.description} onChange={(v) => edit((s) => void (s.packages[index].description = v))} />
          <NumberField
            label={`Harga (Rp) — tampil sebagai ${pkg.price > 0 ? formatRupiah(pkg.price) : 'GRATIS'}`}
            value={pkg.price}
            min={0}
            max={10_000_000}
            step={1000}
            onChange={(v) => edit((s) => void (s.packages[index].price = v))}
          />
          <Segmented
            label="Jumlah lembar yang dicetak"
            value={pkg.prints}
            options={[1, 2, 3, 4].map((value) => ({ value, label: `${value}x` }))}
            onChange={(v) => edit((s) => void (s.packages[index].prints = v))}
          />
          <Check label="Aktif (ditawarkan ke tamu)" checked={pkg.active} onChange={(v) => edit((s) => void (s.packages[index].active = v))} />
          <button class="btn small danger" onClick={() => edit((s) => void s.packages.splice(index, 1))}>
            Hapus pilihan ini
          </button>
        </section>
      ))}
    </div>
  );
}
