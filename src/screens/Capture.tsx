import { useEffect, useRef, useState } from 'preact/hooks';
import { grabFrame, startCamera, type CameraHandle } from '../lib/camera';
import { pokeIdle } from '../lib/kiosk';
import type { FrameDef } from '../lib/receipt/frames';
import type { Shot } from '../lib/session';
import { useSettings } from '../lib/settings';
import { sound } from '../lib/sound';
import { sleep } from '../lib/util';
import { Overlay, Steps } from '../ui/components';

interface Props {
  frame: FrameDef;
  /** Photos taken so far, one entry per slot of the frame. */
  shots: (Shot | null)[];
  /** The slots to photograph now: all of them for a new session, a single one for a retake. */
  targets: number[];
  /** True when the guest came back from the edit step to redo photos. */
  retake: boolean;
  onDone: (shots: (Shot | null)[]) => void;
  onCancel: () => void;
}

type Phase = 'loading' | 'error' | 'ready' | 'shooting';

/** Step 3: live preview and a countdown before every photo. */
export function Capture({ frame, shots: initialShots, targets, retake, onDone, onCancel }: Props) {
  const { session } = useSettings();
  const video = useRef<HTMLVideoElement>(null);
  const unmounted = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [shots, setShots] = useState(initialShots);
  const [current, setCurrent] = useState(targets[0] ?? 0);
  const [count, setCount] = useState<number | null>(null);
  const [frozen, setFrozen] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const ratio = frame.slots[current] ?? 4 / 3;

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let handle: CameraHandle | null = null;
    setPhase('loading');
    startCamera(session.cameraId)
      .then(async (opened) => {
        if (cancelled) {
          opened.stop();
          return;
        }
        handle = opened;
        const element = video.current;
        if (!element) return;
        element.srcObject = opened.stream;
        await element.play().catch(() => undefined);
        if (!cancelled) setPhase('ready');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Kamera gagal dibuka.');
        setPhase('error');
      });
    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [attempt, session.cameraId]);

  /** Takes the target photos one after another, each after its own countdown. */
  const shoot = async () => {
    setPhase('shooting');
    const result = shots.slice();
    for (const index of targets) {
      setCurrent(index);
      for (let n = session.countdownSec; n >= 1; n--) {
        setCount(n);
        sound.tick();
        pokeIdle();
        await sleep(1000);
        if (unmounted.current) return;
      }
      setCount(null);

      let canvas: HTMLCanvasElement;
      try {
        canvas = grabFrame(video.current!, session.mirrorPhoto);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Foto gagal diambil.');
        setPhase('error');
        return;
      }
      sound.shutter();
      setFlash((n) => n + 1);
      const shot: Shot = { canvas, url: canvas.toDataURL('image/jpeg', 0.82) };
      result[index] = shot;
      setShots(result.slice());
      // Hold the photo on screen for a moment so guests see what was taken.
      setFrozen(shot.url);
      pokeIdle();
      await sleep(1300);
      if (unmounted.current) return;
      setFrozen(null);
    }
    onDone(result);
  };

  // The preview is mirrored like a selfie camera; the saved photo may not be, so flip the still to match.
  const flipStill = session.mirrorPreview !== session.mirrorPhoto;
  const one = targets.length === 1;

  return (
    <div class="screen">
      <header class="bar">
        <button class="btn quiet" disabled={phase === 'shooting'} onClick={() => (retake ? onCancel() : setConfirmCancel(true))}>
          {retake ? '← Kembali' : '✕ Batal'}
        </button>
        <Steps current={2} />
        <span class="bar-end" />
      </header>

      <div class="capture">
        <div class="viewfinder-wrap">
          <div class="viewfinder" style={{ '--ratio': String(ratio) }}>
            <video ref={video} class={session.mirrorPreview ? 'mirrored' : ''} autoplay playsinline muted />
            {frozen && <img src={frozen} class={flipStill ? 'mirrored' : ''} alt="" />}
            <span class="pill shot-label">
              Foto {current + 1} dari {frame.slots.length}
            </span>
            {count !== null && (
              <div class="countdown" key={`${current}-${count}`}>
                {count}
              </div>
            )}
            {flash > 0 && <div class="flash" key={flash} />}
            {phase === 'loading' && <div class="viewfinder-note">Menyiapkan kamera…</div>}
          </div>
        </div>

        <div class="side">
          <div class="thumbs">
            {shots.map((shot, i) => (
              <div
                key={i}
                class={`thumb ${targets.includes(i) && phase !== 'loading' && i === current ? 'active' : ''}`}
                style={{ aspectRatio: String(frame.slots[i]) }}
              >
                {shot ? <img src={shot.url} alt={`Foto ${i + 1}`} /> : i + 1}
              </div>
            ))}
          </div>
          {phase === 'ready' && (
            <>
              <button
                class="btn primary huge glow"
                onClick={() => {
                  sound.unlock();
                  void shoot();
                }}
              >
                {one ? `Ulangi foto ${targets[0] + 1}` : 'Mulai!'}
              </button>
              <p class="note">
                {one
                  ? `Hitung mundur ${session.countdownSec} detik, lalu jepret.`
                  : `Kamera memotret ${targets.length} kali. Ada hitung mundur ${session.countdownSec} detik sebelum tiap foto.`}
              </p>
            </>
          )}
          {phase === 'shooting' && <p class="lead">Lihat ke kamera, senyum! 😄</p>}
        </div>
      </div>

      {phase === 'error' && (
        <Overlay>
          <div class="card dialog">
            <span class="tag err">Kamera bermasalah</span>
            <p>{error}</p>
            <button class="btn primary" onClick={() => setAttempt((n) => n + 1)}>
              Coba lagi
            </button>
            <button class="link" onClick={onCancel}>
              {retake ? 'Kembali' : 'Batalkan sesi'}
            </button>
          </div>
        </Overlay>
      )}

      {confirmCancel && (
        <Overlay onClose={() => setConfirmCancel(false)}>
          <div class="card dialog">
            <h2 class="heading small">Batalkan sesi ini?</h2>
            <p class="lead">Sesi yang sudah dibayar tidak bisa dilanjutkan lagi.</p>
            <div class="row center">
              <button class="btn" onClick={() => setConfirmCancel(false)}>
                Lanjut foto
              </button>
              <button class="btn danger" onClick={onCancel}>
                Ya, batalkan
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
