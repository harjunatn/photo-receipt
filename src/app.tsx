import { useEffect, useRef, useState } from 'preact/hooks';
import { Admin } from './admin/Admin';
import { pairingStore, refetchSettings, setBoothIdle, subscriptionStore } from './lib/cloud/device';
import { boothTitle, cloudConfigured, newShareCode, subscriptionState } from './lib/cloud/shared';
import { useIdle } from './lib/kiosk';
import type { PayMethod } from './lib/log';
import { activeFrames, customFramesStore, type FrameDef } from './lib/receipt/frames';
import type { Draft, Shot } from './lib/session';
import { boomerangMode, hasOwnAccent, includesVideos, useSettings, type PackageDef } from './lib/settings';
import { sound } from './lib/sound';
import { useStore } from './lib/store';
import { applyUpdate, updateReady } from './lib/update';
import { pick } from './lib/util';
import { releaseBurst } from './lib/video/boomerang';
import { checkVideoSupport, videoSupport } from './lib/video/encode';
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
  const canMakeVideos = useStore(videoSupport) === true;
  const [screen, setScreen] = useState<Screen>('attract');
  const [frame, setFrame] = useState<FrameDef | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** The photo slots the camera step should fill next. */
  const [targets, setTargets] = useState<number[]>([]);
  const [askPin, setAskPin] = useState(location.hash === '#admin');
  // Redraws the screens when the franchise's own frames arrive or change.
  useStore(customFramesStore);
  const frames = activeFrames(settings.frames.active);
  const packages = settings.packages.filter((p) => p.active);
  const allTaken = draft !== null && draft.shots.every((shot) => shot !== null);

  useEffect(() => {
    const style = document.documentElement.style;
    if (hasOwnAccent(settings.brand.accent)) style.setProperty('--accent', settings.brand.accent);
    else style.removeProperty('--accent');
  }, [settings.brand.accent]);

  // Whether this tablet's browser can make MP4 videos decides if guests are offered them at all.
  useEffect(() => void checkVideoSupport(), []);

  // The browser tab carries the franchise's outlet name, or the platform's while the tablet is not paired.
  const pairing = useStore(pairingStore);
  const title = boothTitle(settings, pairing ? (pairing.franchise ?? '') : null);
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

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

  /** Ends a session that will not be printed, freeing the boomerang bursts it holds. */
  const discard = () => {
    draft?.shots.forEach((shot) => releaseBurst(shot?.burst));
    reset();
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

  const begin = (chosen: FrameDef, pkg: PackageDef, method: PayMethod, voucherCode?: string, paymentId?: string, staffConfirmed = true) => {
    // Every session gets its download, whether or not its QR code is printed on the receipt.
    const shareCode = cloudConfigured ? newShareCode() : undefined;
    setDraft({
      frame: chosen,
      pkg,
      method,
      voucherCode,
      paymentId,
      staffConfirmed,
      shareCode,
      // The videos reach the guest only through the download page.
      videos: shareCode !== undefined && includesVideos(pkg) && canMakeVideos,
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
    // Nor does a booth whose franchise's subscription has run out or was stopped.
    const subscription = subscriptionState(subscriptionStore.get());
    if (subscription === 'expired' || subscription === 'suspended') return;
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
          onPaid={(pkg, method, voucherCode, paymentId, staffConfirmed) => begin(frame, pkg, method, voucherCode, paymentId, staffConfirmed)}
        />
      )}
      {screen === 'capture' && draft && (
        <Capture
          frame={draft.frame}
          shots={draft.shots}
          targets={targets}
          retake={allTaken}
          boomerang={
            draft.videos && boomerangMode(settings) === 'end' ? { caption: [title, settings.platform.receiptLine.trim()].filter(Boolean).join(' · ') } : null
          }
          bursts={draft.videos && boomerangMode(settings) === 'frame'}
          onCancel={() => (allTaken ? setScreen('edit') : discard())}
          onDone={(shots: (Shot | null)[], clip?: Promise<Blob | null>) => {
            setDraft({ ...draft, shots, boomerang: clip ?? draft.boomerang });
            setScreen('edit');
          }}
        />
      )}
      {screen === 'edit' && draft && (
        <Edit
          draft={draft}
          onStyle={(style) => setDraft({ ...draft, style })}
          onFrame={(chosen) => setDraft({ ...draft, frame: chosen })}
          onCrop={(index, crop) => setDraft({ ...draft, shots: draft.shots.map((shot, i) => (i === index && shot ? { ...shot, crop } : shot)) })}
          onRetake={(index) => {
            setTargets(index === undefined ? draft.shots.map((_, i) => i) : [index]);
            setScreen('capture');
          }}
          onPrint={() => setScreen('result')}
          onCancel={discard}
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
      {/* The platform's mark on every guest screen; staff settings are left clean. */}
      {screen !== 'admin' && settings.platform.watermark.trim() && <div class="platform-mark">{settings.platform.watermark.trim()}</div>}
      <ToastHost />
    </>
  );
}
