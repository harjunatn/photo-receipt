import { useEffect, useState } from 'preact/hooks';
import { Check } from '../admin/fields';
import { FRAMES } from '../lib/receipt/frames';
import { useFramePreviews } from '../lib/receipt/previews';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { toast } from '../ui/components';
import type { PageProps } from './Dashboard';
import { LoadState, PageHead, describe, useLoad } from './ui';

/** Which frame designs each tablet offers its guests, and in what order. */
export function FrameSets({ api }: PageProps) {
  const load = useLoad(() => api.listDevices(), [api]);
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
      await Promise.all(ids.map((id) => api.updateDevice(id, { frames: draft })));
      toast(ids.length > 1 ? 'Disimpan untuk semua perangkat.' : 'Disimpan. Tablet mengikutinya dalam satu-dua menit.');
      load.reload();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  const list = draft;
  const ordered = [...list.flatMap((id) => FRAMES.filter((f) => f.id === id)), ...FRAMES.filter((f) => !list.includes(f.id))];
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
      <PageHead title="Koleksi Frame" lead="Frame yang ditawarkan ke tamu, diatur per perangkat. Urutan di sini sama dengan urutan di layar tamu." />
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
                  <div class="frame-thumb">{previews[frame.id] ? <img src={previews[frame.id]} alt="" /> : <div class="strip-loading" />}</div>
                  <div class="frame-panel-info">
                    <h2>{frame.name}</h2>
                    <p class="hint">{frame.blurb}</p>
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
