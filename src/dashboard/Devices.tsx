import { useState } from 'preact/hooks';
import { toast } from '../ui/components';
import { newDevicePin, type Device, type DevicePatch } from './api';
import type { PageProps } from './Dashboard';
import { deviceState } from './stats';
import { LoadState, PageHead, ago, describe, useLoad } from './ui';

const PRINTER_LABEL: Record<string, string> = {
  connected: 'terhubung',
  printing: 'sedang mencetak',
  connecting: 'menghubungkan',
  disconnected: 'belum terhubung',
};

/** The tablets: creating one gives the code and PIN to type into that tablet. */
export function Devices({ api }: PageProps) {
  const load = useLoad(() => api.listDevices(), [api]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast(done);
      load.reload();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  const add = (event: Event) => {
    event.preventDefault();
    const wanted = name.trim();
    if (!wanted) return;
    void run(() => api.createDevice(wanted), 'Perangkat dibuat. Ketik kode dan PIN-nya di tablet.').then(() => setName(''));
  };

  return (
    <>
      <PageHead title="Perangkat" lead="Satu perangkat untuk satu tablet booth. Tablet dipasangkan dari menu ⚙ → Sambungan di tablet itu.">
        <button class="btn small" onClick={load.reload}>
          {load.loading ? 'Memuat…' : 'Muat ulang'}
        </button>
      </PageHead>

      <form class="panel" onSubmit={add}>
        <h2>Tambah perangkat</h2>
        <div class="row">
          <label class="field grow">
            <span>Nama (misalnya lokasi booth)</span>
            <input type="text" maxLength={60} value={name} placeholder="Booth Kafe Senja" onInput={(event) => setName(event.currentTarget.value)} />
          </label>
          <button class="btn small primary" disabled={busy || !name.trim()} style={{ alignSelf: 'flex-end' }}>
            + Tambah
          </button>
        </div>
      </form>

      <LoadState load={load} />
      {load.data?.length === 0 && <p class="hint">Belum ada perangkat. Tambahkan satu untuk setiap tablet booth.</p>}

      <div class="admin-grid">
        {load.data?.map((device) => (
          <DeviceCard
            key={device.id}
            device={device}
            now={now}
            busy={busy}
            onPatch={(patch, done) => void run(() => api.updateDevice(device.id, patch), done)}
            onDelete={() => void run(() => api.deleteDevice(device.id), 'Perangkat dihapus.')}
          />
        ))}
      </div>
    </>
  );
}

interface CardProps {
  device: Device;
  now: number;
  busy: boolean;
  onPatch: (patch: DevicePatch, done: string) => void;
  onDelete: () => void;
}

function DeviceCard({ device, now, busy, onPatch, onDelete }: CardProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'unpair' | null>(null);
  const state = deviceState(device, now);
  const queued = device.status.queued ?? 0;

  return (
    <section class="panel">
      <div class="row">
        {renaming === null ? (
          <h2 class="grow">{device.name}</h2>
        ) : (
          <label class="field grow">
            <input type="text" maxLength={60} value={renaming} onInput={(event) => setRenaming(event.currentTarget.value)} />
          </label>
        )}
        <span class={`tag ${state.tag}`}>{state.label}</span>
      </div>

      <dl class="facts">
        <div>
          <dt>Kode perangkat</dt>
          <dd class="mono">{device.code}</dd>
        </div>
        <div>
          <dt>PIN</dt>
          <dd class="mono">{device.pin}</dd>
        </div>
        <div>
          <dt>Terakhir aktif</dt>
          <dd>{ago(device.last_seen_at, now)}</dd>
        </div>
        <div>
          <dt>Printer</dt>
          <dd>{device.paired ? (PRINTER_LABEL[device.status.printer ?? ''] ?? '—') : '—'}</dd>
        </div>
        <div>
          <dt>Pengaturan tablet</dt>
          <dd title="Printer, sesi & kamera, riwayat dan PIN petugas. Tablet pengganti dengan kode ini memakainya.">
            {device.settings_at ? `tersimpan ${ago(device.settings_at, now)}` : 'belum tersimpan'}
          </dd>
        </div>
      </dl>
      {queued > 0 && <p class="hint">{queued} transaksi masih menunggu dikirim dari tablet ini.</p>}
      {device.pin_fails >= 10 && <p class="banner err">Sepuluh kali PIN salah. Buat PIN baru untuk membuka kembali kode ini.</p>}

      {renaming !== null ? (
        <div class="row">
          <button
            class="btn small primary"
            disabled={busy || !renaming.trim()}
            onClick={() => {
              onPatch({ name: renaming.trim() }, 'Nama diganti.');
              setRenaming(null);
            }}
          >
            Simpan nama
          </button>
          <button class="btn small" onClick={() => setRenaming(null)}>
            Batal
          </button>
        </div>
      ) : confirm ? (
        <div class="row">
          <span class="hint grow">
            {confirm === 'delete'
              ? 'Hapus perangkat ini? Riwayat transaksinya tetap tersimpan.'
              : 'Lepas tablet ini? Tablet berhenti mengirim data sampai dipasangkan lagi.'}
          </span>
          <button
            class="btn small danger"
            disabled={busy}
            onClick={() => {
              if (confirm === 'delete') onDelete();
              else onPatch({ unpair: true }, 'Tablet dilepas.');
              setConfirm(null);
            }}
          >
            {confirm === 'delete' ? 'Ya, hapus' : 'Ya, lepas'}
          </button>
          <button class="btn small" onClick={() => setConfirm(null)}>
            Batal
          </button>
        </div>
      ) : (
        <div class="row">
          <button class="btn small" onClick={() => setRenaming(device.name)}>
            Ganti nama
          </button>
          <button class="btn small" disabled={busy} onClick={() => onPatch({ pin: newDevicePin() }, 'PIN baru dibuat.')}>
            PIN baru
          </button>
          {device.paired && (
            <button class="btn small" onClick={() => setConfirm('unpair')}>
              Lepas tablet
            </button>
          )}
          <button
            class="btn small"
            disabled={busy}
            onClick={() => onPatch({ active: !device.active }, device.active ? 'Perangkat dinonaktifkan.' : 'Perangkat diaktifkan.')}
          >
            {device.active ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
          <button class="btn small danger" onClick={() => setConfirm('delete')}>
            Hapus
          </button>
        </div>
      )}
    </section>
  );
}
