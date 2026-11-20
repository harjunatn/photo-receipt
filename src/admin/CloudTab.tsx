import { useEffect, useState } from 'preact/hooks';
import { outboxStore, pairDevice, pairingStore, settingsBackupStore, subscriptionStore, syncNow, syncState, unpairDevice } from '../lib/cloud/device';
import { addDays, cloudConfigured, subscriptionState } from '../lib/cloud/shared';
import { pumpUploads, uploadsWaiting } from '../lib/cloud/upload';
import { formatDateTime } from '../lib/receipt/compose';
import { useStore } from '../lib/store';
import { videoSupport } from '../lib/video/encode';
import { toast } from '../ui/components';

/** Pairs this tablet with the owner's dashboard and shows whether its sales are getting through. */
export function CloudTab() {
  const pairing = useStore(pairingStore);
  const queued = useStore(outboxStore).length;
  const sync = useStore(syncState);
  const uploads = useStore(uploadsWaiting);
  const videos = useStore(videoSupport);
  const backup = useStore(settingsBackupStore);
  const subscription = useStore(subscriptionStore);
  const subscriptionNow = subscriptionState(subscription);
  const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  // Also refreshes the count of files waiting to be uploaded.
  useEffect(() => void pumpUploads(), []);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmUnpair, setConfirmUnpair] = useState(false);

  const pair = async () => {
    setBusy(true);
    const result = await pairDevice(code, pin);
    setBusy(false);
    setError(result.error);
    if (!result.error) {
      setCode('');
      setPin('');
      toast(
        result.restored
          ? 'Tablet terpasang. Pengaturan printer, sesi & kamera, teks struk, riwayat dan PIN petugas dari tablet sebelumnya dipakai di sini.'
          : 'Tablet terpasang ke dashboard.',
      );
    }
  };

  const syncAgain = async () => {
    setBusy(true);
    const ok = await syncNow();
    setBusy(false);
    toast(ok ? 'Sinkron dengan dashboard.' : 'Belum berhasil tersambung ke server.');
  };

  if (!cloudConfigured) {
    return (
      <div class="admin-grid">
        <section class="panel span">
          <h2>Dashboard belum disambungkan</h2>
          <p class="hint">
            Aplikasi ini belum diberi alamat Supabase, jadi tablet tidak bisa disambungkan dan booth belum bisa dipakai
            tamu. Isi <b class="mono">VITE_SUPABASE_URL</b> dan <b class="mono">VITE_SUPABASE_ANON_KEY</b> di Vercel lalu
            deploy ulang. Langkahnya ada di README.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div class="admin-grid">
      {pairing ? (
        <section class="panel">
          <div class="row">
            <h2 class="grow">{pairing.name || 'Tablet ini'}</h2>
            <span class={`tag ${sync.error ? 'warn' : 'ok'}`}>{sync.error ? 'Belum tersambung' : 'Terpasang'}</span>
          </div>
          <p class="hint">
            {pairing.franchise ? (
              <>
                Franchise <b>{pairing.franchise}</b>, kode perangkat{' '}
              </>
            ) : (
              'Kode perangkat '
            )}
            <b class="mono">{pairing.code}</b>. Setiap sesi yang selesai dikirim ke dashboard; harga, cara bayar, voucher, frame dan
            logo diambil dari sana.
          </p>
          {subscription?.paidUntil && subscriptionNow === 'grace' && (
            <p class="banner">
              Langganan aplikasi berakhir pada {day(subscription.paidUntil)}. Booth masih berjalan sampai{' '}
              {day(addDays(subscription.paidUntil, subscription.graceDays))}, lalu berhenti menerima tamu. Hubungi pemilik platform untuk
              memperpanjang.
            </p>
          )}
          {subscriptionNow === 'expired' && (
            <p class="banner err">
              Langganan aplikasi sudah berakhir, jadi booth tidak menerima tamu. Setelah diperpanjang, tekan Sinkronkan sekarang.
            </p>
          )}
          {subscriptionNow === 'suspended' && (
            <p class="banner err">Franchise ini sedang dihentikan oleh pemilik platform, jadi booth tidak menerima tamu.</p>
          )}
          <p class="hint">
            Pengaturan printer, sesi & kamera, teks struk, riwayat dan PIN petugas tablet ini juga disimpan di dashboard
            {backup ? <> (terakhir {formatDateTime(new Date(backup.at))})</> : ' begitu tersambung'}. Tablet pengganti yang
            dipasangkan dengan kode yang sama langsung memakai pengaturan ini; printernya cukup dihubungkan sekali lagi.
          </p>
          <div class="stats">
            <div class="stat">
              <b>{queued}</b>
              <span>transaksi menunggu dikirim</span>
            </div>
            <div class="stat">
              <b>{uploads}</b>
              <span>file foto & video tamu menunggu diunggah</span>
            </div>
            <div class="stat">
              <b style={{ fontSize: '20px', lineHeight: '1.7' }}>{sync.lastOk ? formatDateTime(new Date(sync.lastOk)) : '—'}</b>
              <span>terakhir tersambung</span>
            </div>
          </div>
          {videos === false && (
            <p class="hint">
              Browser tablet ini tidak bisa membuat video MP4, jadi tamu di tablet ini tidak mendapat boomerang dan video
              slideshow. Foto tetap berjalan seperti biasa. Perbarui Chrome untuk mencoba lagi.
            </p>
          )}
          {sync.error && (
            <p class="banner">
              {sync.error} Booth tetap bisa dipakai: transaksi disimpan dulu di tablet dan dikirim saat internet kembali.
              Voucher tidak bisa dipakai selama tidak tersambung.
            </p>
          )}
          <div class="row">
            <button class="btn small primary" disabled={busy} onClick={() => void syncAgain()}>
              Sinkronkan sekarang
            </button>
            {confirmUnpair ? (
              <>
                <button
                  class="btn small danger"
                  onClick={() => {
                    unpairDevice();
                    setConfirmUnpair(false);
                  }}
                >
                  Ya, lepas — booth berhenti menerima tamu
                </button>
                <button class="btn small" onClick={() => setConfirmUnpair(false)}>
                  Batal
                </button>
              </>
            ) : (
              <button class="btn small" onClick={() => setConfirmUnpair(true)}>
                Lepas dari dashboard
              </button>
            )}
          </div>
        </section>
      ) : (
        <section class="panel">
          <h2>Pasangkan tablet ini</h2>
          <p class="hint">
            Tablet harus tersambung ke dashboard sebelum bisa dipakai tamu, supaya setiap sesi tercatat. Buat perangkat
            baru di dashboard pemilik (menu Perangkat), lalu ketik kode perangkat dan PIN-nya di sini. Satu kode untuk
            satu tablet: memasangkan tablet lain dengan kode yang sama melepas tablet sebelumnya, dan tablet ini memakai
            pengaturan printer, sesi & kamera, teks struk, riwayat dan PIN petugas dari tablet itu.
          </p>
          {sync.revoked && <p class="banner err">Tablet ini dilepas atau dinonaktifkan dari dashboard. Pasangkan lagi untuk melanjutkan.</p>}
          <label class="field">
            <span>Kode perangkat</span>
            <input
              type="text"
              class="mono"
              autocapitalize="characters"
              autocomplete="off"
              maxLength={12}
              value={code}
              onInput={(event) => setCode(event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </label>
          <label class="field">
            <span>PIN perangkat</span>
            <input
              type="text"
              class="mono"
              inputMode="numeric"
              autocomplete="off"
              maxLength={8}
              value={pin}
              onInput={(event) => setPin(event.currentTarget.value.replace(/\D/g, ''))}
            />
          </label>
          {error && <p class="banner err">{error}</p>}
          <button class="btn small primary" disabled={busy || code.length < 4 || pin.length < 4} onClick={() => void pair()}>
            {busy ? 'Memasangkan…' : 'Pasangkan'}
          </button>
          {queued > 0 && <p class="hint">{queued} transaksi dari pemasangan sebelumnya akan ikut terkirim.</p>}
        </section>
      )}

      <section class="panel">
        <h2>Membuka dashboard</h2>
        <p class="hint">
          Dashboard dibuka dari HP atau laptop pemilik, bukan dari tablet booth: buka alamat aplikasi ini dengan akhiran{' '}
          <b class="mono">#dashboard</b>, lalu masuk dengan email dan password pemilik.
        </p>
        <p class="hint mono" style={{ overflowWrap: 'anywhere' }}>
          {location.origin + location.pathname}#dashboard
        </p>
      </section>
    </div>
  );
}
