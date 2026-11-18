import { useEffect, useRef, useState } from 'preact/hooks';
import { Admin } from './admin/Admin';
import { pairingStore, refetchSettings, setBoothIdle } from './lib/cloud/device';
import { cloudConfigured, newShareCode } from './lib/cloud/shared';
import { useIdle } from './lib/kiosk';
import type { PayMethod } from './lib/log';
import { activeFrames, type FrameDef } from './lib/receipt/frames';
import type { Draft, Shot } from './lib/session';
import { useSettings, type PackageDef } from './lib/settings';
import { sound } from './lib/sound';
import { useStore } from './lib/store';
import { applyUpdate, updateReady } from './lib/update';
import { pick } from './lib/util';
import { Attract } from './screens/Attract';
import { Capture } from './screens/Capture';
import { Edit } from './screens/Edit';
import { Frames } from './screens/Frames';
import { Payment } from './screens/Payment';
import { Result } from './screens/Result';
import { PinPad, ToastHost } from './ui/components';

/** The guest flow: welcome → frame → payment → photos → edit/retake → print. */
type Screen = 'attract' | 'frames' | 'payment' | 'capture' | 'edit' | 'result' | 'admin';

export function App() {
  const settings = useSettings();
  const hasUpdate = useStore(updateReady);
  const [screen, setScreen] = useState<Screen>('attract');
  const [frame, setFrame] = useState<FrameDef | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** The photo slots the camera step should fill next. */
  const [targets, setTargets] = useState<number[]>([]);
  const [askPin, setAskPin] = useState(location.hash === '#admin');
  const frames = activeFrames(settings.frames.active);
  const packages = settings.packages.filter((p) => p.active);
  const allTaken = draft !== null && draft.shots.every((shot) => shot !== null);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.brand.accent);
  }, [settings.brand.accent]);

  // Updates are applied only while the booth is idle, never in the middle of a guest's session.
  useEffect(() => {
    if (hasUpdate && screen === 'attract' && !askPin) applyUpdate();
  }, [hasUpdate, screen, askPin]);

  // Prices and frames set in the dashboard arrive between guests, never under one.
  useEffect(() => setBoothIdle(screen === 'attract'), [screen]);

  const reset = () => {
    setFrame(null);
    setDraft(null);
    setScreen('attract');
  };

  // A guest who walks away mid-edit has already paid and posed: print what
  // they have rather than throw it away. The camera step looks after its own
  // timeout for the same reason (see Capture). Anywhere else, start over.
  const current = useRef(screen);
  current.current = screen;
  useIdle(
    settings.session.idleSec,
    () => (current.current === 'edit' ? setScreen('result') : reset()),
    screen !== 'attract' && screen !== 'admin' && screen !== 'capture',
  );

  const begin = (chosen: FrameDef, pkg: PackageDef, method: PayMethod, voucherCode?: string, paymentId?: string) => {
    setDraft({
      frame: chosen,
      pkg,
      method,
      voucherCode,
      paymentId,
      shareCode: settings.share.enabled && cloudConfigured ? newShareCode() : undefined,
      shots: chosen.slots.map(() => null),
      style: 'normal',
      when: new Date(),
      quote: pick(settings.receipt.quotes.filter((q) => q.trim())) ?? '',
    });
    setTargets(chosen.slots.map((_, i) => i));
    setScreen('capture');
  };

  const pickFrame = (chosen: FrameDef) => {
    setFrame(chosen);
    // With a single free price there is nothing to pay or choose: go straight to the camera.
    if (packages.length === 1 && packages[0].price === 0) begin(chosen, packages[0], 'free');
    else setScreen('payment');
  };

  const start = () => {
    // Every session must be recorded in the dashboard, so an unpaired tablet takes no guests.
    if (!pairingStore.get()) return;
    sound.unlock();
    if (frames.length === 1) pickFrame(frames[0]);
    else setScreen('frames');
  };

  return (
    <>
      {screen === 'attract' && <Attract onStart={start} onAdmin={() => setAskPin(true)} />}
      {screen === 'frames' && <Frames onPick={pickFrame} onBack={reset} />}
      {screen === 'payment' && frame && (
        <Payment
          frame={frame}
          onBack={() => (frames.length > 1 ? setScreen('frames') : reset())}
          onPaid={(pkg, method, voucherCode, paymentId) => begin(frame, pkg, method, voucherCode, paymentId)}
        />
      )}
      {screen === 'capture' && draft && (
        <Capture
          frame={draft.frame}
          shots={draft.shots}
          targets={targets}
          retake={allTaken}
          onCancel={() => (allTaken ? setScreen('edit') : reset())}
          onDone={(shots: (Shot | null)[]) => {
            setDraft({ ...draft, shots });
            setScreen('edit');
          }}
        />
      )}
      {screen === 'edit' && draft && (
        <Edit
          draft={draft}
          onStyle={(style) => setDraft({ ...draft, style })}
          onFrame={(chosen) => setDraft({ ...draft, frame: chosen })}
          onRetake={(index) => {
            setTargets(index === undefined ? draft.shots.map((_, i) => i) : [index]);
            setScreen('capture');
          }}
          onPrint={() => setScreen('result')}
          onCancel={reset}
        />
      )}
      {screen === 'result' && draft && <Result draft={draft} onFinish={reset} />}
      {screen === 'admin' && (
        <Admin
          onExit={() => {
            // What the dashboard manages wins over edits made on the tablet.
            refetchSettings();
            reset();
          }}
        />
      )}
      {askPin && (
        <PinPad
          title="Masuk pengaturan"
          onCancel={() => setAskPin(false)}
          onSuccess={() => {
            setAskPin(false);
            setScreen('admin');
          }}
        />
      )}
      <ToastHost />
    </>
  );
}
