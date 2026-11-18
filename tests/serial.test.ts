import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTransport } from '../src/lib/printer/transports';

const OPTIONS = { baudRate: 9600, usbShowAll: false };
const SPP = '00001101-0000-1000-8000-00805f9b34fb';

/** A printer paired over classic Bluetooth, as Chrome on Android offers it through Web Serial. */
function fakeSerialPrinter() {
  const written: number[] = [];
  let open = false;
  let on = true;
  const writer = {
    write: vi.fn(async (chunk: Uint8Array) => {
      if (!on) throw new DOMException('The device has been lost.', 'NetworkError');
      written.push(...chunk);
    }),
    releaseLock: vi.fn(),
  };
  const port = {
    open: vi.fn(async () => {
      if (!on) throw new DOMException('Failed to open serial port.', 'NetworkError');
      if (open) throw new DOMException('The port is already open.', 'InvalidStateError');
      open = true;
    }),
    close: vi.fn(async () => {
      open = false;
    }),
    get writable() {
      return open ? { getWriter: () => writer } : null;
    },
    getInfo: () => ({ bluetoothServiceClassId: SPP }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const serial = { requestPort: vi.fn(async () => port), getPorts: vi.fn(async () => [port]) };
  Object.defineProperty(globalThis.navigator, 'serial', { configurable: true, value: serial });
  return {
    port,
    serial,
    written,
    switchOff: () => {
      on = false;
    },
    switchOn: () => {
      on = true;
    },
  };
}

afterEach(() => Reflect.deleteProperty(globalThis.navigator, 'serial'));

describe('Bluetooth printer over serial', () => {
  it('asks Chrome for paired Bluetooth serial printers and names the link', async () => {
    const printer = fakeSerialPrinter();
    const name = await createTransport('serial').connect(OPTIONS);
    expect(printer.serial.requestPort).toHaveBeenCalledWith({ allowedBluetoothServiceClassIds: [SPP] });
    expect(name).toBe('Printer Bluetooth (serial)');
  });

  it('sends the whole job', async () => {
    const printer = fakeSerialPrinter();
    const transport = createTransport('serial');
    await transport.connect(OPTIONS);
    const job = new Uint8Array(1300).map((_, i) => i % 256);
    await transport.write(job, { bleChunk: 100, bleChunkDelayMs: 0, bleWrite: 'auto' });
    expect(printer.written).toHaveLength(1300);
  });

  it('comes back after a reload without anyone picking the printer again', async () => {
    const printer = fakeSerialPrinter();
    await expect(createTransport('serial').reconnect(OPTIONS)).resolves.toBe('Printer Bluetooth (serial)');
    expect(printer.serial.requestPort).not.toHaveBeenCalled();
  });

  it('can pick the same printer again while it is still open', async () => {
    fakeSerialPrinter();
    const transport = createTransport('serial');
    await transport.connect(OPTIONS);
    await expect(transport.connect(OPTIONS)).resolves.toBe('Printer Bluetooth (serial)');
  });

  it('reports a printer switched off mid-print, since Android sends no disconnect event, and reopens it later', async () => {
    const printer = fakeSerialPrinter();
    const transport = createTransport('serial');
    const lost = vi.fn();
    transport.onDisconnect = lost;
    await transport.connect(OPTIONS);

    printer.switchOff();
    await expect(transport.write(new Uint8Array(10), { bleChunk: 100, bleChunkDelayMs: 0, bleWrite: 'auto' })).rejects.toThrow();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(printer.port.close).toHaveBeenCalled();

    await expect(transport.reconnect(OPTIONS)).resolves.toBeNull();
    printer.switchOn();
    await expect(transport.reconnect(OPTIONS)).resolves.toBe('Printer Bluetooth (serial)');
  });
});

describe('printer manager with a serial printer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('reconnects by itself once the printer is back on after a failed print', async () => {
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
    });
    vi.resetModules();
    const { settingsStore } = await import('../src/lib/settings');
    settingsStore.update((s) => void (s.printer.transport = 'serial'));
    const { printer } = await import('../src/lib/printer/manager');
    const fake = fakeSerialPrinter();

    expect(await printer.connect()).toBe(true);
    fake.switchOff();
    const bits = { width: 8, height: 8, bytesPerRow: 1, data: new Uint8Array(8) };
    await expect(printer.print(bits)).rejects.toThrow();
    expect(printer.state.get().status).toBe('disconnected');

    fake.switchOn();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(printer.state.get()).toMatchObject({ status: 'connected', error: '' });
  });
});
