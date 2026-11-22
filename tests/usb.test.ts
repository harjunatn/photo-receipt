import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BitImage } from '../src/lib/image/types';

const OPTIONS = { baudRate: 9600, usbShowAll: false };
const WRITE = { bleChunk: 100, bleChunkDelayMs: 0, bleWrite: 'auto' as const };

/** A USB receipt printer as Chrome's WebUSB shows it, with a link that can break or refuse data. */
function fakeUsbPrinter() {
  const received: number[] = [];
  const control = {
    /** The link breaks once this many bytes have arrived in total (the rest of that write is lost). */
    breakAt: Infinity,
    /** This many writes in a row are refused (stall) after taking part of their data. */
    stalls: 0,
  };
  const device = {
    productName: 'POS-58',
    manufacturerName: '',
    configuration: {
      interfaces: [{ interfaceNumber: 0, alternate: { interfaceClass: 7, endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] } }],
    },
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    selectConfiguration: vi.fn(async () => undefined),
    claimInterface: vi.fn(async () => undefined),
    releaseInterface: vi.fn(async () => undefined),
    clearHalt: vi.fn(async () => undefined),
    transferOut: vi.fn(async (_endpoint: number, data: Uint8Array) => {
      if (received.length + data.length > control.breakAt) {
        received.push(...data.subarray(0, Math.max(0, control.breakAt - received.length)));
        throw new DOMException('A transfer error has occurred.', 'NetworkError');
      }
      if (control.stalls > 0) {
        control.stalls -= 1;
        const taken = Math.floor(data.length / 3);
        received.push(...data.subarray(0, taken));
        return { status: 'stall', bytesWritten: taken };
      }
      received.push(...data);
      return { status: 'ok', bytesWritten: data.length };
    }),
  };
  const usb = {
    requestDevice: vi.fn(async () => device),
    getDevices: vi.fn(async () => [device]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(globalThis.navigator, 'usb', { configurable: true, value: usb });
  return { device, received, control };
}

/**
 * Reads a byte stream the way a cheap receipt printer does, carrying on across
 * jobs: a picture block that was cut off keeps taking bytes until it has all it
 * announced. Returns how many bytes ended up printed as text, which on these
 * printers comes out as rows of Chinese characters.
 */
function textPrinted(stream: number[]): number {
  let text = 0;
  let i = 0;
  while (i < stream.length) {
    const b = stream[i];
    if (b === 0x00) i += 1;
    else if (b === 0x1b && stream[i + 1] === 0x40) i += 2;
    else if (b === 0x1b && stream[i + 1] === 0x64) i += 3;
    else if (b === 0x1d && stream[i + 1] === 0x56) i += stream[i + 2] === 65 || stream[i + 2] === 66 ? 4 : 3;
    else if (b === 0x1d && stream[i + 1] === 0x76 && stream[i + 2] === 0x30) {
      const bytesPerRow = stream[i + 4] | (stream[i + 5] << 8);
      const rows = stream[i + 6] | (stream[i + 7] << 8);
      i += 8 + bytesPerRow * rows;
    } else {
      text += 1;
      i += 1;
    }
  }
  return text;
}

/** A 58 mm receipt, 300 rows tall, dark enough that every image byte is non-zero. */
const RECEIPT: BitImage = { width: 384, height: 300, bytesPerRow: 48, data: new Uint8Array(48 * 300).fill(0xa5) };

const memory = new Map<string, string>();

beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis.navigator, 'usb');
});

describe('USB printer link', () => {
  it('carries on after the printer refuses data for a moment', async () => {
    vi.useFakeTimers();
    try {
      const printer = fakeUsbPrinter();
      const { createTransport } = await import('../src/lib/printer/transports');
      const transport = createTransport('usb');
      await transport.connect(OPTIONS);
      printer.control.stalls = 2;
      const job = new Uint8Array(10_000).map((_, i) => i % 251);
      const done = transport.write(job, WRITE);
      await vi.runAllTimersAsync();
      await done;
      // Every byte arrives exactly once, in order.
      expect(printer.received).toEqual([...job]);
      expect(printer.device.clearHalt).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a printer that keeps refusing', async () => {
    vi.useFakeTimers();
    try {
      const printer = fakeUsbPrinter();
      const { createTransport } = await import('../src/lib/printer/transports');
      const transport = createTransport('usb');
      await transport.connect(OPTIONS);
      printer.control.stalls = 10;
      const done = transport.write(new Uint8Array(10_000), WRITE);
      const failed = expect(done).rejects.toThrow('Printer USB menolak data.');
      await vi.runAllTimersAsync();
      await failed;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a print that broke off', () => {
  it('does not turn the start of the next receipt into text', async () => {
    const printer = fakeUsbPrinter();
    const { printer: manager, owedBytes, printProblems } = await import('../src/lib/printer/manager');
    await manager.connect('usb');

    // The link breaks in the middle of the second picture block.
    printer.control.breakAt = 2 + 8 + 96 * 48 + 1000;
    await expect(manager.print(RECEIPT)).rejects.toThrow();
    expect(owedBytes()).toBeGreaterThan(0);
    const problem = printProblems.get()[0];
    expect(problem.progress).toBeGreaterThan(0);
    expect(problem.progress).toBeLessThan(1);

    // The printer comes back; staff print again.
    const cutOff = printer.received.length;
    printer.control.breakAt = Infinity;
    await manager.print(RECEIPT);
    expect(owedBytes()).toBe(0);
    expect(textPrinted(printer.received)).toBe(0);

    // Without the blank bytes in front, the printer would have printed part of the receipt as text.
    const second = printer.received.slice(cutOff);
    const catchUp = second.findIndex((b) => b !== 0);
    expect(catchUp).toBeGreaterThan(0);
    expect(textPrinted([...printer.received.slice(0, cutOff), ...second.slice(catchUp)])).toBeGreaterThan(0);
  });

  it('starts the next receipt straight away when nothing broke off', async () => {
    const printer = fakeUsbPrinter();
    const { printer: manager } = await import('../src/lib/printer/manager');
    await manager.disconnect();
    await manager.connect('usb');
    await manager.print(RECEIPT);
    // The job begins with the printer's reset command, no blank bytes first.
    expect(printer.received.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(textPrinted(printer.received)).toBe(0);
  });
});
