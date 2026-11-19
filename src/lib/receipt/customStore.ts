import { fetchCustomFrames, framesVersionStore, pairingStore } from '../cloud/device';
import { deleteStoredFrame, listStoredFrames, putStoredFrame, type StoredFrame } from '../db';
import { loadImage } from './compose';
import { toFrameDef, validLayout } from './custom';
import { customFramesStore, type FrameDef } from './frames';

/** Reads the frames kept on this tablet and makes them ready to draw. A damaged one is skipped. */
async function publish(): Promise<void> {
  const stored = await listStoredFrames().catch(() => [] as StoredFrame[]);
  const ready: FrameDef[] = [];
  for (const frame of stored) {
    const layout = validLayout(frame.layout);
    if (!layout) continue;
    const image = await loadImage(frame.image).catch(() => null);
    if (image) ready.push(toFrameDef({ id: frame.id, name: frame.name, blurb: frame.blurb, layout, image, version: frame.updatedAt }));
  }
  customFramesStore.set(ready);
}

let syncing = false;
let again = false;

/** Brings the tablet's copies in line with the franchise's frames on the server: new and changed ones in, deleted ones out. */
async function sync(): Promise<void> {
  if (syncing) {
    again = true;
    return;
  }
  syncing = true;
  try {
    const stored = await listStoredFrames().catch(() => [] as StoredFrame[]);
    const remote = await fetchCustomFrames(Object.fromEntries(stored.map((frame) => [frame.id, frame.updatedAt])));
    // Offline or not paired: keep what is here.
    if (!remote) return;
    const wanted = new Set(remote.ids);
    for (const frame of stored) if (!wanted.has(frame.id)) await deleteStoredFrame(frame.id);
    for (const frame of remote.frames) {
      await putStoredFrame({ id: frame.id, name: frame.name, blurb: frame.blurb, layout: frame.layout, image: frame.image, updatedAt: frame.updated_at });
    }
    await publish();
  } catch {
    // Tried again at the next sync that reports a change.
  } finally {
    syncing = false;
    if (again) {
      again = false;
      void sync();
    }
  }
}

/** Offers the frames already on the tablet at once, then follows the server for as long as the page is open. */
export function startCustomFrames(): void {
  void publish();
  framesVersionStore.subscribe(() => void sync());
  // A tablet that was unpaired and paired to another franchise must not keep the first one's frames.
  let device = pairingStore.get()?.id;
  pairingStore.subscribe(() => {
    const next = pairingStore.get()?.id;
    if (next === device) return;
    device = next;
    void (async () => {
      for (const frame of await listStoredFrames().catch(() => [] as StoredFrame[])) await deleteStoredFrame(frame.id);
      await publish();
      if (next) void sync();
    })();
  });
}
