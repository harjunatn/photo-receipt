import { useEffect, useState } from 'preact/hooks';
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
  own: boolean;
}

/** The franchise's own frames, and which frame designs each tablet offers its guests, in what order. */
export function FrameSets({ api }: PageProps) {
  const load = useLoad(() => api.listDevices(), [api]);
  const own = useLoad(() => api.listFrames(), [api]);
  // undefined: editor closed · null: adding a frame · a row: changing that frame.
  const [editing, setEditing] = useState<CustomFrameRow | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState('');
  const previews = useFramePreviews(FRAMES, DEFAULT_SETTINGS);
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
    ...FRAMES.map((frame) => ({ id: frame.id, name: frame.name, blurb: frame.blurb, picture: previews[frame.id], own: false })),
    ...(own.data ?? [])
      .filter((frame) => frame.active)
      .map((frame) => ({ id: customFrameId(frame.id), name: frame.name, blurb: frame.blurb || `${frame.layout.slots.length} foto`, picture: frame.thumb || undefined, own: true })),
  ];
  const ordered = [...list.flatMap((id) => choices.filter((f) => f.id === id)), ...choices.filter((f) => !list.includes(f.id))];
  // Ids of frames that no longer exist are dropped when the list is saved.
  const offered = draft.filter((id) => choices.some((choice) => choice.id === id));
  const move = (id: string, step: -1 | 1) => {
    const next = list.slice();
    const from = next.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]];
    setDraft(next);
  };

  return (
    <>
      <PageHead title="Koleksi Frame" lead="Frame buatan sendiri, dan frame mana yang ditawarkan ke tamu di tiap perangkat." />

      {editing !== undefined ? (
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
      ) : (
        <section class="panel">
          <div class="row">
            <h2 class="grow">Frame buatan sendiri</h2>
            <button class="btn small primary" onClick={() => setEditing(null)}>
              + Tambah frame
            </button>
          </div>
          <LoadState load={own} />
          {own.data?.length === 0 && (
            <p class="hint">
              Belum ada. Selain tujuh frame bawaan, kamu bisa mengunggah desain sendiri: gambar PNG dengan lubang transparan tempat foto. Frame
              buatanmu hanya terlihat oleh franchise ini.
            </p>
          )}
          <div class="own-frames">
            {own.data?.map((frame) => (
              <div class="own-frame" key={frame.id}>
                <div class="frame-thumb">{frame.thumb ? <img src={frame.thumb} alt="" /> : <div class="strip-loading" />}</div>
                <div class="frame-panel-info">
                  <b>{frame.name}</b>
                  <small class="hint">
                    {frame.layout.slots.length} foto{frame.active ? '' : ' · tidak aktif'}
                  </small>
                  <div class="row">
                    <button class="btn small" disabled={busy} onClick={() => setEditing(frame)}>
                      Edit
                    </button>
                    <button
                      class="btn small danger"
                      disabled={busy}
                      onClick={() => (confirmDelete === frame.id ? void removeFrame(frame) : setConfirmDelete(frame.id))}
                    >
                      {confirmDelete === frame.id ? 'Yakin hapus?' : 'Hapus'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <h2 class="dash-sub">Frame di tiap perangkat</h2>
      <p class="hint">Urutan di sini sama dengan urutan di layar tamu.</p>
      <LoadState load={load} />
      {load.data && devices.length === 0 && <p class="hint">Belum ada perangkat. Tambahkan dulu di menu Perangkat.</p>}

      {device && (
        <>
          <section class="panel">
            <div class="chips tight">
              {devices.map((d) => (
                <button key={d.id} class={`chip ${d.id === device.id ? 'on' : ''}`} onClick={() => setDeviceId(d.id)}>
                  {d.name}
                </button>
              ))}
            </div>
            {draft.length === 0 && <p class="banner">Tidak ada frame yang dipilih, jadi tablet menawarkan semua frame.</p>}
            <div class="row">
              <button class="btn small primary" disabled={busy || !dirty} onClick={() => void save([device.id])}>
                Simpan untuk {device.name}
              </button>
              {devices.length > 1 && (
                <button class="btn small" disabled={busy} onClick={() => void save(devices.map((d) => d.id))}>
                  Terapkan ke semua perangkat
                </button>
              )}
            </div>
          </section>

          <div class="admin-grid">
            {ordered.map((frame) => {
              const position = draft.indexOf(frame.id);
              return (
                <section class="panel frame-panel" key={frame.id}>
                  <div class="frame-thumb">{frame.picture ? <img src={frame.picture} alt="" /> : <div class="strip-loading" />}</div>
                  <div class="frame-panel-info">
                    <h2>{frame.name}</h2>
                    <p class="hint">
                      {frame.blurb}
                      {frame.own ? ' · buatan sendiri' : ''}
                    </p>
                    <Check
                      label="Ditawarkan ke tamu"
                      checked={position >= 0}
                      onChange={(on) => setDraft(on ? [...draft, frame.id] : draft.filter((id) => id !== frame.id))}
                    />
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
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
