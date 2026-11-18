import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLE_LINK_MS, BLE_SERVICES_MS, createTransport } from '../src/lib/printer/transports';

/** hang: the link never opens · slow: it opens but the print service never answers · patient: the service answers after 12 s · ok · not-a-printer */
type Step = 'hang' | 'slow' | 'patient' | 'ok' | 'not-a-printer';
const OPTIONS = { baudRate: 9600, usbShowAll: false };

/** A Bluetooth printer whose link attempts behave as scripted: hang forever, succeed, or offer no print service. */
function fakePrinter(steps: Step[], startConnected = false) {
  let calls = 0;
  let open = 0;
  let mostAtOnce = 0;
  const characteristic = {
    properties: { write: true, writeWithoutResponse: true },
    writeValueWithResponse: vi.fn(async () => undefined),
    writeValueWithoutResponse: vi.fn(async () => undefined),
  };
  const listeners = new Set<() => void>();
  // Like a real printer: whenever an open link closes, the page hears about it.
  const dropped = () => listeners.forEach((listener) => listener());
  const gatt = {
    connected: startConnected,
    connect: vi.fn(() => {
      const step = steps[calls++] ?? 'ok';
      open += 1;
      mostAtOnce = Math.max(mostAtOnce, open);
      if (step === 'hang') return new Promise(() => undefined);
      open -= 1;
      gatt.connected = true;
      return Promise.resolve({
        getPrimaryServices: () =>
          step === 'slow'
            ? new Promise(() => undefined)
            : step === 'patient'
              ? new Promise((resolve) => setTimeout(() => resolve([{ getCharacteristics: async () => [characteristic] }]), 12_000))
              : Promise.resolve(step === 'not-a-printer' ? [] : [{ getCharacteristics: async () => [characteristic] }]),
      });
    }),
    disconnect: vi.fn(() => {
      // Closing the link also abandons an attempt that was still waiting.
      open = 0;
      const was = gatt.connected;
      gatt.connected = false;
      if (was) queueMicrotask(dropped);
    }),
  };
  const device = {
    name: 'MPT-II',
    gatt,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  };
  /** The printer goes away on its own, e.g. out of range or asleep. */
  const drop = () => {
    gatt.connected = false;
    dropped();
  };
  return { device, gatt, drop, mostAtOnce: () => mostAtOnce };
}

function useBluetooth(device: unknown) {
  Object.defineProperty(globalThis.navigator, 'bluetooth', {
    configurable: true,
    value: { requestDevice: vi.fn(async () => device), getDevices: vi.fn(async () => [device]) },
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis.navigator, 'bluetooth');
});

describe('Bluetooth printer link', () => {
  it('gives up on an attempt that hangs and tries again, instead of "connecting" forever', async () => {
    const printer = fakePrinter(['hang', 'hang', 'ok']);
    useBluetooth(printer.device);
    const result = createTransport('bluetooth').connect(OPTIONS);
    await vi.advanceTimersByTimeAsync(3 * BLE_LINK_MS + 5000);
    await expect(result).resolves.toBe('MPT-II');
    expect(printer.gatt.connect).toHaveBeenCalledTimes(3);
    // Every abandoned attempt was closed before the next one.
    expect(printer.gatt.disconnect.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('stops after a few tries with a message that tells staff what to do', async () => {
    const printer = fakePrinter(['hang', 'hang', 'hang', 'hang']);
    useBluetooth(printer.device);
    const result = createTransport('bluetooth').connect(OPTIONS);
    const settled = expect(result).rejects.toThrow(/Matikan printer/);
    await vi.advanceTimersByTimeAsync(3 * BLE_LINK_MS + 5000);
    await settled;
    expect(printer.gatt.connect).toHaveBeenCalledTimes(3);
  });

  it('first closes a link the browser still holds, as after a drop the printer may not have noticed', async () => {
    const printer = fakePrinter(['ok'], true);
    useBluetooth(printer.device);
    const result = createTransport('bluetooth').connect(OPTIONS);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toBe('MPT-II');
    expect(printer.gatt.disconnect.mock.invocationCallOrder[0]).toBeLessThan(printer.gatt.connect.mock.invocationCallOrder[0]);
  });

  it('does not retry a device that is no printer at all', async () => {
    const printer = fakePrinter(['not-a-printer', 'ok']);
    useBluetooth(printer.device);
    const result = createTransport('bluetooth').connect(OPTIONS);
    const settled = expect(result).rejects.toThrow(/tidak dikenali sebagai printer/);
    await vi.advanceTimersByTimeAsync(2000);
    await settled;
    expect(printer.gatt.connect).toHaveBeenCalledTimes(1);
  });

  it('never opens the link twice at once when the automatic retry and the Connect button overlap', async () => {
    const printer = fakePrinter(['hang', 'ok', 'ok']);
    useBluetooth(printer.device);
    const transport = createTransport('bluetooth');
    const manual = transport.connect(OPTIONS);
    await vi.advanceTimersByTimeAsync(100);
    const automatic = transport.reconnect(OPTIONS);
    await vi.advanceTimersByTimeAsync(3 * BLE_LINK_MS + 5000);
    await expect(manual).resolves.toBe('MPT-II');
    await expect(automatic).resolves.toBe('MPT-II');
    expect(printer.mostAtOnce()).toBe(1);
  });
});

describe('printer manager with a Bluetooth printer', () => {
  async function freshManager() {
    // The booth's settings live in localStorage; a small stand-in is enough here.
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
    });
    vi.resetModules();
    const { settingsStore } = await import('../src/lib/settings');
    settingsStore.update((s) => void (s.printer.transport = 'bluetooth'));
    return (await import('../src/lib/printer/manager')).printer;
  }

  afterEach(() => Reflect.deleteProperty(globalThis, 'localStorage'));

  it('connects and stays connected, without tripping over its own closing of a stale link', async () => {
    const fake = fakePrinter(['ok', 'ok', 'ok'], true);
    useBluetooth(fake.device);
    const printer = await freshManager();
    const connecting = printer.connect();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await connecting).toBe(true);
    // A minute later it is still connected and nothing kept reconnecting.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(printer.state.get()).toMatchObject({ status: 'connected', error: '' });
    expect(fake.gatt.connect).toHaveBeenCalledTimes(1);
  });

  it('comes back by itself after the printer really drops, and then stays connected', async () => {
    const fake = fakePrinter(['ok', 'ok', 'ok', 'ok']);
    useBluetooth(fake.device);
    const printer = await freshManager();
    const connecting = printer.connect();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await connecting).toBe(true);

    fake.drop();
    expect(printer.state.get()).toMatchObject({ status: 'disconnected', error: 'Koneksi ke printer terputus.' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(printer.state.get()).toMatchObject({ status: 'connected', error: '' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(printer.state.get().status).toBe('connected');
    expect(fake.gatt.connect).toHaveBeenCalledTimes(2);
  });

  it('does not fall into a connect-disconnect loop when the printer answers slowly after a drop', async () => {
    // Connects, drops, then the first try after the drop half-opens and never answers; the next one works.
    const fake = fakePrinter(['ok', 'slow', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    useBluetooth(fake.device);
    const printer = await freshManager();
    const connecting = printer.connect();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await connecting).toBe(true);

    fake.drop();
    await vi.advanceTimersByTimeAsync(BLE_SERVICES_MS + 15_000);
    expect(printer.state.get()).toMatchObject({ status: 'connected', error: '' });
    const callsWhenBack = fake.gatt.connect.mock.calls.length;
    // Two minutes on, still connected, and no further reconnecting went on behind the scenes.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(printer.state.get()).toMatchObject({ status: 'connected', error: '' });
    expect(fake.gatt.connect.mock.calls.length).toBe(callsWhenBack);
    expect(callsWhenBack).toBeLessThanOrEqual(3);
  });

  it('waits for a printer that takes a while to show its print service, instead of cutting it off', async () => {
    // Android can take 10–15 s to read a Bluetooth printer's services the first time.
    const fake = fakePrinter(['patient', 'patient', 'patient', 'patient']);
    useBluetooth(fake.device);
    const printer = await freshManager();
    const connecting = printer.connect();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await connecting).toBe(true);
    expect(printer.state.get()).toMatchObject({ status: 'connected', error: '' });
    expect(fake.gatt.connect).toHaveBeenCalledTimes(1);
    expect(fake.gatt.disconnect).not.toHaveBeenCalled();
  });

  it('stays disconnected after the operator disconnects on purpose', async () => {
    const fake = fakePrinter(['ok', 'ok']);
    useBluetooth(fake.device);
    const printer = await freshManager();
    const connecting = printer.connect();
    await vi.advanceTimersByTimeAsync(2000);
    await connecting;
    await printer.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(printer.state.get().status).toBe('disconnected');
    expect(fake.gatt.connect).toHaveBeenCalledTimes(1);
  });
});
