import { activeFrames, type FrameDef } from '../lib/receipt/frames';
import { useFramePreviews } from '../lib/receipt/previews';
import { useSettings } from '../lib/settings';
import { Steps } from '../ui/components';

interface Props {
  onPick: (frame: FrameDef) => void;
  onBack: () => void;
}

/** Step 1: the guest picks the design their photos will be printed in. */
export function Frames({ onPick, onBack }: Props) {
  const settings = useSettings();
  const frames = activeFrames(settings.frames.active);
  const previews = useFramePreviews(frames, settings);

  return (
    <div class="screen">
      <header class="bar">
        <button class="btn quiet" onClick={onBack}>
          ← Kembali
        </button>
        <Steps current={0} />
        <span class="bar-end" />
      </header>

      <div class="titles">
        <h1 class="heading">Pilih frame favoritmu</h1>
        <p class="lead">Ketuk salah satu. Fotonya masih bisa diulang dan diedit sebelum dicetak.</p>
      </div>

      <div class="frame-rail">
        {frames.map((frame) => (
          <button key={frame.id} class="frame-card" onClick={() => onPick(frame)}>
            <div class="frame-art">
              {previews[frame.id] ? <img src={previews[frame.id]} alt="" /> : <div class="strip-loading" />}
            </div>
            <b>{frame.name}</b>
            <small>{frame.blurb}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
