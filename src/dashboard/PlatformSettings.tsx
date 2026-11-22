import { CardFlow } from '../ui/CardFlow';
import { useEffect, useState } from 'preact/hooks';
import { NumberField, TextField } from '../admin/fields';
import type { PlatformConfig } from '../lib/cloud/shared';
import { toast } from '../ui/components';
import type { AdminPageProps } from './Dashboard';
import { LoadState, PageHead, describe, useLoad } from './ui';

/** What the platform owner sets once for every franchise: the platform's name and where it shows on booths and receipts. */
export function PlatformSettings({ admin }: AdminPageProps) {
  const load = useLoad(() => admin.getPlatform(), [admin]);
  const [draft, setDraft] = useState<PlatformConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (load.data) setDraft({ ...load.data });
  }, [load.data]);

  if (!draft) {
    return (
      <>
        <PageHead title="Pengaturan platform" lead="Berlaku untuk semua franchise." />
        <LoadState load={load} />
      </>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(load.data);
  const save = async () => {
    setBusy(true);
    try {
      await admin.savePlatform(draft);
      toast('Disimpan. Semua tablet mengikutinya dalam satu-dua menit, saat tidak ada tamu.');
      load.reload();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  return (
    <>
      <PageHead title="Pengaturan platform" lead="Berlaku untuk semua franchise. Franchise tidak bisa mengubah atau menghapusnya.">
        {dirty && (
          <button class="btn small" disabled={busy} onClick={() => setDraft({ ...load.data! })}>
            Batalkan perubahan
          </button>
        )}
        <button class="btn small primary" disabled={busy || !dirty || !draft.name.trim()} onClick={() => void save()}>
          {busy ? 'Menyimpan…' : dirty ? 'Simpan' : 'Tersimpan'}
        </button>
      </PageHead>

      <CardFlow minWidth={420}>
        <section class="panel">
          <h2>Merek platform</h2>
          <TextField label="Nama platform" hint="Tampil di dashboard ini dan di halaman unduh foto tamu." value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
          <TextField
            label="Tulisan kecil di layar tamu"
            hint="Muncul di pojok layar setiap tablet. Kosongkan kalau tidak ingin ada."
            value={draft.watermark}
            placeholder="didukung oleh jepretin"
            onChange={(v) => setDraft({ ...draft, watermark: v })}
          />
          <TextField
            label="Baris paling bawah struk"
            hint="Tercetak di setiap struk semua franchise dan ikut di foto yang diunduh, misalnya akun media sosialmu. Kosongkan kalau tidak ingin ada."
            value={draft.receiptLine}
            placeholder="@jepretin"
            onChange={(v) => setDraft({ ...draft, receiptLine: v })}
          />
        </section>

        <section class="panel">
          <h2>Langganan</h2>
          <NumberField
            label="Masa tenggang (hari)"
            hint="Berapa hari booth masih berjalan setelah tanggal langganan lewat. Selama itu dashboard franchise menampilkan peringatan; sesudahnya booth berhenti menerima tamu sampai langganan diperpanjang."
            value={draft.graceDays}
            min={0}
            max={60}
            onChange={(v) => setDraft({ ...draft, graceDays: Math.round(v) })}
          />
          <p class="hint">Tanggal langganan tiap franchise diatur di menu Franchise → Atur.</p>
        </section>
      </CardFlow>
    </>
  );
}
