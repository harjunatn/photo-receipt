import { CardFlow } from '../ui/CardFlow';
import { useEffect, useState } from 'preact/hooks';
import { Check, NumberField, TextField } from '../admin/fields';
import { AI_EDIT_COST_RP, type PlatformConfig } from '../lib/cloud/shared';
import { formatRupiah } from '../lib/settings';
import { toast } from '../ui/components';
import type { AdminApi, AiStatus } from './api';
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

        <section class="panel span">
          <h2>Edit foto AI</h2>
          <p class="hint">
            Di halaman unduh, tamu bisa meminta satu fotonya digambar ulang oleh AI (kartun 3D, anime, komik, cat air, atau karikatur),
            gratis 1 kali per sesi. Tiap hasil dibayar dari API key Gemini milikmu, sekitar {formatRupiah(AI_EDIT_COST_RP)} per foto.
          </p>
          <Check
            label="Aktifkan edit foto AI"
            hint="Saat menyala, tablet ikut mengirim foto tanpa frame, dan tab Versi AI muncul di halaman unduh untuk sesi-sesi sesudahnya. Saat dimatikan, hasil yang sudah jadi tetap bisa diunduh."
            checked={draft.ai.enabled}
            onChange={(v) => setDraft({ ...draft, ai: { ...draft.ai, enabled: v } })}
          />
          <NumberField
            label="Batas per franchise per bulan"
            hint={`Setelah sebanyak ini dalam satu bulan kalender, tamu franchise itu tidak bisa membuat versi AI lagi sampai bulan berikutnya. Dengan batas ini, biaya terbesar per franchise sekitar ${formatRupiah(draft.ai.monthlyLimit * AI_EDIT_COST_RP)} sebulan.`}
            value={draft.ai.monthlyLimit}
            min={0}
            max={100_000}
            onChange={(v) => setDraft({ ...draft, ai: { ...draft.ai, monthlyLimit: Math.max(0, Math.round(v)) } })}
          />
          <AiPanel admin={admin} enabled={draft.ai.enabled} />
        </section>
      </CardFlow>
    </>
  );
}

/** Whether the server is ready to make AI versions (the key, checked with Google on request), and what was made this month. */
function AiPanel({ admin, enabled }: { admin: AdminApi; enabled: boolean }) {
  const status = useLoad(() => admin.aiStatus(false), [admin]);
  const usage = useLoad(() => admin.aiUsage(), [admin]);
  const [checked, setChecked] = useState<AiStatus['check'] | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      setChecked((await admin.aiStatus(true)).check ?? null);
    } catch (cause) {
      setChecked({ ok: false, message: describe(cause) });
    }
    setChecking(false);
  };

  return (
    <div class="admin-grid" style={{ margin: 0 }}>
      <div class="panel">
        <h2>API key Gemini</h2>
        {status.error ? (
          <p class="banner err">{status.error}</p>
        ) : !status.data ? (
          <div class="spinner" />
        ) : (
          <>
            {!status.data.has_key ? (
              <p class={`banner ${enabled ? 'err' : ''}`}>
                API key belum diisi{enabled ? ', jadi tamu akan melihat “Versi AI sedang tidak tersedia”' : ''}. Isi di Supabase → Edge Functions →
                Secrets dengan nama <b class="mono">GEMINI_API_KEY</b>, lalu muat ulang halaman ini. Kuncinya hanya disimpan di server dan tidak
                pernah tampil di sini.
              </p>
            ) : (
              <p class="hint">
                API key sudah terisi di server (isinya tidak ditampilkan). Model <b class="mono">{status.data.model}</b>, ukuran hasil{' '}
                <b>{status.data.image_size}</b>.
              </p>
            )}
            {!status.data.storage && <p class="banner err">Penyimpanan hasil foto (Cloudflare R2) belum disiapkan, jadi hasil AI belum punya tempat.</p>}
            {status.data.has_key && (
              <div class="row">
                <button type="button" class="btn small" disabled={checking} onClick={() => void check()}>
                  {checking ? 'Memeriksa…' : 'Periksa API key'}
                </button>
                <span class="hint">Bertanya ke Google apakah kuncinya diterima. Gratis, tidak membuat gambar.</span>
              </div>
            )}
            {checked && <p class={`banner ${checked.ok ? 'ok' : 'err'}`}>{checked.message}</p>}
          </>
        )}
      </div>
      <div class="panel">
        <h2>Pemakaian bulan ini</h2>
        {usage.error ? (
          <p class="banner err">{usage.error}</p>
        ) : !usage.data ? (
          <div class="spinner" />
        ) : (
          <>
            <p class="hint">
              <b>{usage.data.done.toLocaleString('id-ID')}</b> versi AI dibuat, sekitar <b>{formatRupiah(usage.data.done * AI_EDIT_COST_RP)}</b>.{' '}
              {usage.data.failed > 0 ? `${usage.data.failed.toLocaleString('id-ID')} percobaan gagal (tidak memakai jatah tamu).` : ''}
            </p>
            {usage.data.franchises.map((row) => (
              <div class="member" key={row.id}>
                <span>{row.name}</span>
                <span class="hint">
                  {row.done.toLocaleString('id-ID')} foto · {formatRupiah(row.done * AI_EDIT_COST_RP)}
                </span>
              </div>
            ))}
            {usage.data.last_error && (
              <p class="hint">
                Kegagalan terakhir: <span class="mono">{usage.data.last_error}</span>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
