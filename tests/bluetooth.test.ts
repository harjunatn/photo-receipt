import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLE_ATTEMPT_MS, createTransport } from '../src/lib/printer/transports';

type Step = 'hang' | 'ok' | 'not-a-printer';
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
        getPrimaryServices: async () => (step === 'not-a-printer' ? [] : [{ getCharacteristics: async () => [characteristic] }]),
      });
    }),
    disconnect: vi.fn(() => {
      // Closing the link also abandons an attempt that was still waiting.
      open = 0;
      gatt.connected = false;
    }),
  };
  const device = { name: 'MPT-II', gatt, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  return { device, gatt, mostAtOnce: () => mostAtOnce };
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
    await vi.advanceTimersByTimeAsync(3 * BLE_ATTEMPT_MS + 5000);
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
    await vi.advanceTimersByTimeAsync(3 * BLE_ATTEMPT_MS + 5000);
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
    await vi.advanceTimersByTimeAsync(3 * BLE_ATTEMPT_MS + 5000);
    await expect(manual).resolves.toBe('MPT-II');
    await expect(automatic).resolves.toBe('MPT-II');
    expect(printer.mostAtOnce()).toBe(1);
  });
});
