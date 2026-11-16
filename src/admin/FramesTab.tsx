import { FRAMES } from '../lib/receipt/frames';
import { useFramePreviews } from '../lib/receipt/previews';
import { useSettings } from '../lib/settings';
import { edit } from './actions';
import { Check } from './fields';

/** Which frame designs guests can choose from, and in what order they are offered. */
export function FramesTab() {
  const settings = useSettings();
  const active = settings.frames.active;
  const previews = useFramePreviews(FRAMES, settings);
  // Offered frames first, in the operator's order; the rest after them.
  const ordered = [...active.flatMap((id) => FRAMES.filter((f) => f.id === id)), ...FRAMES.filter((f) => !active.includes(f.id))];

  const toggle = (id: string, on: boolean) =>
    edit((s) => {
      s.frames.active = on ? [...s.frames.active, id] : s.frames.active.filter((other) => other !== id);
    });

  const move = (id: string, step: -1 | 1) =>
    edit((s) => {
      const list = s.frames.active;
      const from = list.indexOf(id);
      const to = from + step;
      if (from < 0 || to < 0 || to >= list.length) return;
      [list[from], list[to]] = [list[to], list[from]];
    });

  return (
    <div class="admin-grid">
      <section class="panel span">
        <h2>Frame untuk tamu</h2>
        <p class="hint">
          Nyalakan frame yang boleh dipilih tamu. Urutannya di sini sama dengan urutan di layar tamu. Kalau hanya satu
          yang menyala, tamu tidak ditanya dan langsung memakai frame itu. Teks di struk (judul, kutipan, kode QR) diatur
          di tab <b>Struk & Tampilan</b> dan berlaku untuk semua frame.
        </p>
        {active.length === 0 && <p class="banner">Tidak ada frame yang menyala, jadi semua frame ditawarkan ke tamu.</p>}
      </section>

      {ordered.map((frame) => {
        const position = active.indexOf(frame.id);
        return (
          <section class="panel frame-panel" key={frame.id}>
            <div class="frame-thumb">{previews[frame.id] ? <img src={previews[frame.id]} alt="" /> : <div class="strip-loading" />}</div>
            <div class="frame-panel-info">
              <h2>{frame.name}</h2>
              <p class="hint">{frame.blurb}</p>
              <Check label="Ditawarkan ke tamu" checked={position >= 0} onChange={(on) => toggle(frame.id, on)} />
              {position >= 0 && (
                <div class="row">
                  <button class="btn small" disabled={position === 0} onClick={() => move(frame.id, -1)}>
                    ↑ Naik
                  </button>
                  <button class="btn small" disabled={position === active.length - 1} onClick={() => move(frame.id, 1)}>
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
  );
}
