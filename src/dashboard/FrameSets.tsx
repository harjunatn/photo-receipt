import { useEffect, useMemo, useState } from 'preact/hooks';
import { Check } from '../admin/fields';
import { customFrameId } from '../lib/receipt/custom';
import { FRAMES } from '../lib/receipt/frames';
import { useFramePreviews } from '../lib/receipt/previews';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { toast } from '../ui/components';
import type { CustomFrameRow } from './api';
import type { PageProps } from './Dashboard';
import { FrameEditor } from './FrameEditor';
import { LoadState, PageHead, describe, useLoad } from './ui';

/** A frame as the list shows it, whether built in or the franchise's own. */
interface Choice {
  id: string;
  name: string;
  blurb: string;
  picture: string | undefined;
  /** The franchise's own frame behind this choice; null for a built-in one. */
  own: CustomFrameRow | null;
  /** Switched off in its editor: kept, but sent to no tablet. */
  off: boolean;
}

/** Every frame, built in or the franchise's own, in one list: which ones each tablet offers its guests, in what order, and the franchise's own to edit. */
export function FrameSets({ api }: PageProps) {
  const load = useLoad(() => api.listDevices(), [api]);
  const own = useLoad(() => api.listFrames(), [api]);
  // undefined: editor closed · null: adding a frame · a row: changing that frame.
  const [editing, setEditing] = useState<CustomFrameRow | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState('');
  // The sample receipts carry this franchise's name.
  const previewSettings = useMemo(
    () => ({ ...DEFAULT_SETTINGS, receipt: { ...DEFAULT_SETTINGS.receipt, title: api.franchise.name.toUpperCase() } }),
    [api.franchise.name],
  );
  const previews = useFramePreviews(FRAMES, previewSettings);
  const [deviceId, setDeviceId] = useState('');
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const devices = load.data ?? [];
  const device = devices.find((d) => d.id === deviceId) ?? devices[0];
  // A device whose frames were never chosen offers the standard set.
  const saved = device?.frames ?? DEFAULT_SETTINGS.frames.active;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => setDraft(saved), [device?.id, JSON.stringify(saved)]);

  const save = async (ids: string[]) => {
    setBusy(true);
    try {
      await Promise.all(ids.map((id) => api.updateDevice(id, { frames: offered })));
      toast(ids.length > 1 ? 'Disimpan untuk semua perangkat.' : 'Disimpan. Tablet mengikutinya dalam satu-dua menit.');
      load.reload();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  const removeFrame = async (frame: CustomFrameRow) => {
    setBusy(true);
    try {
      await api.deleteFrame(frame.id);
      toast(`Frame ${frame.name} dihapus.`);
      setConfirmDelete('');
      own.reload();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  const list = draft;
  const choices: Choice[] = [
    ...FRAMES.map((frame) => ({ id: frame.id, name: frame.name, blurb: frame.blurb, picture: previews[frame.id], own: null, off: false })),
    ...(own.data ?? []).map((frame) => ({
      id: customFrameId(frame.id),
      name: frame.name,
      blurb: frame.blurb || `${frame.layout.slots.length} foto`,
      picture: frame.thumb || undefined,
      own: frame,
      off: !frame.active,
    })),
  ];
  const usable = choices.filter((choice) => !choice.off);
  // The booth's own order first, then what it does not offer, then frames that are switched off altogether.
  const ordered = [
    ...list.flatMap((id) => usable.filter((f) => f.id === id)),
    ...usable.filter((f) => !list.includes(f.id)),
    ...choices.filter((f) => f.off),
  ];
  // Ids of frames that no longer exist, or were switched off, are dropped when the list is saved.
  const offered = draft.filter((id) => usable.some((choice) => choice.id === id));
  const move = (id: string, step: -1 | 1) => {
    const next = list.slice();
    const from = next.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]];
    setDraft(next);
  };

  if (editing !== undefined) {
    return (
      <>
        <PageHead title="Galeri Frame" lead={editing ? `Mengubah frame ${editing.name}.` : 'Menambah frame buatan sendiri.'} />
        <FrameEditor
          key={editing?.id ?? 'baru'}
          api={api}
          frame={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            own.reload();
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Galeri Frame"
        lead="Frame bawaan dan frame buatanmu sendiri. Centang Aktif untuk frame yang ditawarkan ke tamu di booth yang dipilih; urutannya sama dengan urutan di layar tamu."
      >
        <button class="btn small primary" onClick={() => setEditing(null)}>
          + Tambah frame
        </button>
      </PageHead>

      <LoadState load={load} />
      <LoadState load={own} />
      {load.data && devices.length === 0 && (
        <p class="banner">Belum ada booth. Tambahkan dulu di menu Booth Saya, lalu pilih frame mana yang aktif di booth itu.</p>
      )}

      {device && (
        <section class="panel">
          <div class="chips tight">
            {devices.map((d) => (
              <button key={d.id} class={`chip ${d.id === device.id ? 'on' : ''}`} onClick={() => setDeviceId(d.id)}>
                {d.name}
              </button>
            ))}
          </div>
          {draft.length === 0 && <p class="banner">Tidak ada frame yang aktif, jadi tablet menawarkan semua frame.</p>}
          <div class="row">
            <button class="btn small primary" disabled={busy || !dirty} onClick={() => void save([device.id])}>
              Simpan untuk {device.name}
            </button>
            {devices.length > 1 && (
              <button class="btn small" disabled={busy} onClick={() => void save(devices.map((d) => d.id))}>
                Terapkan ke semua booth
              </button>
            )}
          </div>
        </section>
      )}

      {load.data && (
        <div class="admin-grid">
          {ordered.map((frame) => {
            const position = frame.off ? -1 : draft.indexOf(frame.id);
            const mine = frame.own;
            return (
              <section class="panel frame-panel" key={frame.id}>
                <div class="frame-thumb">{frame.picture ? <img src={frame.picture} alt="" /> : <div class="strip-loading" />}</div>
                <div class="frame-panel-info">
                  <h2>{frame.name}</h2>
                  <p class="hint">
                    {frame.blurb}
                    {mine ? ' · buatan sendiri' : ''}
                  </p>
                  {frame.off ? (
                    <p class="hint">
                      <span class="tag">Nonaktif</span> Dimatikan lewat Edit, jadi tidak dikirim ke tablet mana pun.
                    </p>
                  ) : (
                    device && (
                      <Check
                        label="Aktif"
                        checked={position >= 0}
                        onChange={(on) => setDraft(on ? [...draft, frame.id] : draft.filter((id) => id !== frame.id))}
                      />
                    )
                  )}
                  {position >= 0 && (
                    <div class="row">
                      <button class="btn small" disabled={position === 0} onClick={() => move(frame.id, -1)}>
                        ↑ Naik
                      </button>
                      <button class="btn small" disabled={position === draft.length - 1} onClick={() => move(frame.id, 1)}>
                        ↓ Turun
                      </button>
                      <span class="tag">Urutan {position + 1}</span>
                    </div>
                  )}
                  {mine && (
                    <div class="row">
                      <button class="btn small" disabled={busy} onClick={() => setEditing(mine)}>
                        Edit
                      </button>
                      <button
                        class="btn small danger"
                        disabled={busy}
                        onClick={() => (confirmDelete === mine.id ? void removeFrame(mine) : setConfirmDelete(mine.id))}
                      >
                        {confirmDelete === mine.id ? 'Yakin hapus?' : 'Hapus'}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
