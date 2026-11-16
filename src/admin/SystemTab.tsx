import { useState } from 'preact/hooks';
import { download, isFullscreen, toggleFullscreen } from '../lib/kiosk';
import { logStore } from '../lib/log';
import { DEFAULT_SETTINGS, settingsStore, useSettings } from '../lib/settings';
import { toast } from '../ui/components';
import { edit } from './actions';

/** Staff PIN, full-screen mode and backup of the configuration. */
export function SystemTab() {
  const { admin } = useSettings();
  const [newPin, setNewPin] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [, rerender] = useState(0);

  const savePin = () => {
    if (!/^\d{4,8}$/.test(newPin)) {
      toast('PIN harus 4 sampai 8 angka.');
      return;
    }
    edit((s) => void (s.admin.pin = newPin));
    setNewPin('');
    toast('PIN petugas diganti.');
  };

  const backup = () => {
    download('pengaturan-booth.json', new Blob([JSON.stringify(settingsStore.get(), null, 2)], { type: 'application/json' }));
  };

  const restore = async (file: File) => {
    try {
      settingsStore.replace(JSON.parse(await file.text()));
      toast('Pengaturan dipulihkan.');
    } catch {
      toast('Berkas itu bukan cadangan pengaturan yang valid.');
    }
  };

  return (
    <div class="admin-grid">
      <section class="panel">
        <h2>PIN petugas</h2>
        <p class="hint">
          PIN dipakai untuk masuk ke pengaturan ini dan untuk mengonfirmasi pembayaran. PIN sekarang:{' '}
          <b class="mono">{admin.pin}</b>
        </p>
        <label class="field">
          <span>PIN baru (4–8 angka)</span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={8}
            value={newPin}
            onInput={(event) => setNewPin(event.currentTarget.value.replace(/\D/g, ''))}
          />
        </label>
        <button class="btn small primary" disabled={newPin.length < 4} onClick={savePin}>
          Simpan PIN
        </button>
      </section>

      <section class="panel">
        <h2>Layar penuh</h2>
        <p class="hint">
          Untuk booth umum, kunci juga tablet di aplikasi ini lewat fitur Android “Sematkan aplikasi” (Pengaturan →
          Keamanan), supaya tamu tidak bisa keluar ke aplikasi lain.
        </p>
        <button
          class="btn small"
          onClick={async () => {
            await toggleFullscreen().catch(() => toast('Browser menolak mode layar penuh.'));
            rerender((n) => n + 1);
          }}
        >
          {isFullscreen() ? 'Keluar dari layar penuh' : 'Masuk layar penuh'}
        </button>
      </section>

      <section class="panel">
        <h2>Cadangan pengaturan</h2>
        <p class="hint">Simpan semua pengaturan (paket, teks struk, printer) ke sebuah berkas, atau pulihkan dari berkas itu — misalnya untuk menyalin ke tablet lain.</p>
        <div class="row">
          <button class="btn small" onClick={backup}>
            Unduh cadangan
          </button>
          <label class="btn small">
            Pulihkan dari berkas
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                input.value = '';
                if (file) void restore(file);
              }}
            />
          </label>
        </div>
      </section>

      <section class="panel">
        <h2>Mulai dari awal</h2>
        <p class="hint">Mengembalikan semua pengaturan ke bawaan dan mengosongkan catatan transaksi. Voucher dan foto tersimpan tidak ikut dihapus.</p>
        {confirmReset ? (
          <div class="row">
            <button
              class="btn small danger"
              onClick={() => {
                settingsStore.replace(DEFAULT_SETTINGS);
                logStore.set([]);
                setConfirmReset(false);
                toast('Pengaturan dikembalikan ke bawaan.');
              }}
            >
              Ya, kembalikan ke bawaan
            </button>
            <button class="btn small" onClick={() => setConfirmReset(false)}>
              Batal
            </button>
          </div>
        ) : (
          <button class="btn small danger" onClick={() => setConfirmReset(true)}>
            Kembalikan ke pengaturan bawaan
          </button>
        )}
      </section>
    </div>
  );
}
