import type { BitImage } from '../image/types';
import { settingsStore, type TransportKind } from '../settings';
import { createStore, useStore } from '../store';
import { sleep } from '../util';
import { decodeJob } from './decode';
import { concatBytes, encodeJob } from './escpos';
import { createTransport, PreviewTransport, transportSupported, type Transport } from './transports';

export interface PrinterState {
  status: 'disconnected' | 'connecting' | 'connected' | 'printing';
  kind: TransportKind;
  deviceName: string;
  /** Last problem, in words an operator can act on. Empty when all is well. */
  error: string;
  /** 0..1 while printing. */
  progress: number;
  /** What the simulated printer produced last, shown on screen instead of paper. */
  simulated: BitImage | null;
}

const state = createStore<PrinterState>({
  status: 'disconnected',
  kind: settingsStore.get().printer.transport,
  deviceName: '',
  error: '',
  progress: 0,
  simulated: null,
});

let transport: Transport | null = null;
/**
 * Goes up when the operator disconnects on purpose, so that an attempt still
 * running from before does not connect the printer again behind their back.
 */
let generation = 0;
/** False once the operator disconnects on purpose, so the booth stops trying to reconnect. */
let wanted = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function patch(change: Partial<PrinterState>): void {
  state.set({ ...state.get(), ...change });
}

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'Tidak ada printer yang dipilih.';
  if (error instanceof DOMException && error.name === 'SecurityError') {
    return 'Browser menolak akses ke printer. Pastikan halaman dibuka lewat HTTPS.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Terjadi kesalahan pada printer.';
}

function connectOptions() {
  const { baudRate, usbShowAll } = settingsStore.get().printer;
  return { baudRate, usbShowAll };
}

function newTransport(kind: TransportKind): Transport {
  const made = createTransport(kind);
  made.onDisconnect = handleUnexpectedDisconnect;
  return made;
}

function ensureTransport(): Transport {
  const kind = settingsStore.get().printer.transport;
  if (transport?.kind !== kind) transport = newTransport(kind);
  return transport;
}

function handleUnexpectedDisconnect(): void {
  patch({ status: 'disconnected', error: 'Koneksi ke printer terputus.', progress: 0 });
  scheduleRetry(3000);
}

/** Keeps trying to get the printer back, e.g. after it was switched off and on again. */
function scheduleRetry(delayMs: number): void {
  clearTimeout(retryTimer);
  if (!wanted) return;
  retryTimer = setTimeout(async () => {
    if (!wanted || state.get().status !== 'disconnected') return;
    if (!(await printer.reconnect())) scheduleRetry(Math.min(delayMs * 2, 30_000));
  }, delayMs);
}

export const printer = {
  state,

  /**
   * Opens the browser's printer chooser. Must be called from a tap handler.
   * With another kind of link than the current one, the current printer stays
   * connected until the new one is; only then is it let go, and the new kind
   * becomes the one the booth reconnects to after a reload.
   */
  async connect(kind: TransportKind = settingsStore.get().printer.transport): Promise<boolean> {
    clearTimeout(retryTimer);
    const mine = generation;
    const before = state.get();
    const previous = transport;
    const switching = previous !== null && previous.kind !== kind;
    patch({ status: 'connecting', error: '', kind });
    try {
      // Made inside the try: a kind this browser cannot do throws, like a failed link.
      const next = previous?.kind === kind ? previous : newTransport(kind);
      const deviceName = await next.connect(connectOptions());
      if (mine !== generation) return false;
      if (switching && previous) {
        previous.onDisconnect = null;
        await previous.disconnect().catch(() => undefined);
      }
      transport = next;
      wanted = true;
      if (settingsStore.get().printer.transport !== kind) settingsStore.update((s) => void (s.printer.transport = kind));
      patch({ status: 'connected', deviceName, error: '', kind });
      return true;
    } catch (error) {
      // Another attempt may have connected meanwhile; a late failure must not undo that.
      if (mine !== generation || state.get().status === 'connected') return state.get().status === 'connected';
      if (switching && previous && before.status === 'connected') {
        // Trying another printer failed: the one that was working stays in use.
        patch({ status: 'connected', kind: previous.kind, deviceName: before.deviceName, error: describe(error) });
        return false;
      }
      patch({ status: 'disconnected', error: describe(error) });
      // The operator asked for this printer, so keep trying in the background too.
      if (wanted) scheduleRetry(5000);
      return false;
    }
  },

  /** Reconnects without prompting, when the browser still has permission for the printer. */
  async reconnect(): Promise<boolean> {
    const kind = settingsStore.get().printer.transport;
    if (!transportSupported(kind) || state.get().status !== 'disconnected') return false;
    const mine = generation;
    patch({ status: 'connecting', kind });
    try {
      const deviceName = await ensureTransport().reconnect(connectOptions());
      if (mine !== generation) return false;
      if (deviceName === null) {
        if (state.get().status !== 'connected') patch({ status: 'disconnected' });
        return state.get().status === 'connected';
      }
      wanted = true;
      patch({ status: 'connected', deviceName, error: '' });
      return true;
    } catch {
      if (mine === generation && state.get().status !== 'connected') patch({ status: 'disconnected' });
      return false;
    }
  },

  async disconnect(): Promise<void> {
    wanted = false;
    generation += 1;
    clearTimeout(retryTimer);
    await transport?.disconnect().catch(() => undefined);
    transport = null;
    patch({ status: 'disconnected', deviceName: '', error: '', progress: 0 });
  },

  /** Prints the image the given number of times. Rejects with a readable message on failure. */
  async print(bits: BitImage, copies = 1): Promise<void> {
    const active = transport;
    if (!active || state.get().status === 'disconnected' || state.get().status === 'connecting') {
      throw new Error('Printer belum terhubung.');
    }
    if (state.get().status === 'printing') throw new Error('Printer masih mencetak.');

    const p = settingsStore.get().printer;
    const segments = encodeJob(bits, {
      rasterMode: p.rasterMode,
      bandRows: p.bandRows,
      feedLines: p.feedLines,
      cut: p.cut,
    });
    const total = segments.reduce((sum, s) => sum + s.length, 0) * copies;
    let sent = 0;

    patch({ status: 'printing', progress: 0, error: '' });
    try {
      for (let copy = 0; copy < copies; copy++) {
        for (const segment of segments) {
          await active.write(segment, p);
          sent += segment.length;
          patch({ progress: sent / total });
          if (p.bandDelayMs > 0) await sleep(p.bandDelayMs);
        }
      }
      if (active instanceof PreviewTransport) {
        patch({ simulated: decodeJob(concatBytes(active.takeJob())).image });
      }
      patch({ status: 'connected', progress: 1 });
    } catch (error) {
      const message = describe(error);
      // A failed write usually means the link is gone; only the transport's own
      // disconnect event knows for sure, so stay "connected" unless it fired.
      if (state.get().status === 'printing') patch({ status: 'connected', progress: 0, error: message });
      else patch({ error: message });
      throw new Error(message);
    }
  },

  dismissSimulated(): void {
    patch({ simulated: null });
  },
};

export function usePrinter(): PrinterState {
  return useStore(state);
}
