import type { BleWriteMode, TransportKind } from '../settings';
import { sleep } from '../util';
import type { Bytes } from './escpos';

export interface ConnectOptions {
  baudRate: number;
  usbShowAll: boolean;
}

export interface WriteOptions {
  bleChunk: number;
  bleChunkDelayMs: number;
  bleWrite: BleWriteMode;
}

/** A way of getting bytes to the printer. */
export interface Transport {
  readonly kind: TransportKind;
  /** Called when the printer goes away without being asked to (unplugged, switched off, out of range). */
  onDisconnect: (() => void) | null;
  /** Shows the browser's device chooser, so it must run inside a tap handler. Resolves to the device name. */
  connect(options: ConnectOptions): Promise<string>;
  /** Tries to reach a printer the browser already has permission for, without any prompt. */
  reconnect(options: ConnectOptions): Promise<string | null>;
  disconnect(): Promise<void>;
  write(data: Bytes, options: WriteOptions): Promise<void>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function transportSupported(kind: TransportKind): boolean {
  if (kind === 'bluetooth') return 'bluetooth' in navigator;
  if (kind === 'usb') return 'usb' in navigator;
  if (kind === 'serial') return 'serial' in navigator;
  return true;
}

/**
 * Bluetooth Low Energy services that receipt printers use to accept print data.
 * The browser only lets a page talk to services listed up front.
 */
const BLE_PRINT_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
];

/** Bytes that fit in one Bluetooth LE packet on every link, however little the two sides negotiated. */
const BLE_SAFE_PACKET = 20;

class BluetoothTransport implements Transport {
  readonly kind = 'bluetooth' as const;
  onDisconnect: (() => void) | null = null;
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  /** Set once this printer has refused a larger packet, so later prints skip the failed attempt. */
  private smallPacketsOnly = false;

  private readonly handleDisconnect = () => {
    this.characteristic = null;
    this.onDisconnect?.();
  };

  async connect(): Promise<string> {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_PRINT_SERVICES,
    });
    await this.attach(device);
    return device.name || 'Printer Bluetooth';
  }

  async reconnect(): Promise<string | null> {
    // The device picked earlier stays usable until the page reloads; after a
    // reload only printers Chrome chose to remember are reachable.
    let device = this.device;
    if (!device && 'getDevices' in navigator.bluetooth) {
      device = (await navigator.bluetooth.getDevices())[0] ?? null;
    }
    if (!device) return null;
    try {
      await withTimeout(this.attach(device), 10_000, 'Printer tidak merespons.');
      return device.name || 'Printer Bluetooth';
    } catch {
      return null;
    }
  }

  private async attach(device: BluetoothDevice): Promise<void> {
    if (!device.gatt) throw new Error('Perangkat ini tidak mendukung Bluetooth Low Energy.');
    device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
    device.addEventListener('gattserverdisconnected', this.handleDisconnect);
    this.device = device;

    const server = await device.gatt.connect();
    // Throws when the device offers none of the print services, which lands in the same error below.
    const services = await server.getPrimaryServices().catch(() => []);
    for (const service of services) {
      const characteristics = await service.getCharacteristics().catch(() => []);
      const writable =
        characteristics.find((c) => c.properties.writeWithoutResponse) ?? characteristics.find((c) => c.properties.write);
      if (writable) {
        this.characteristic = writable;
        return;
      }
    }
    device.gatt.disconnect();
    throw new Error('Perangkat ini tidak dikenali sebagai printer struk Bluetooth (BLE).');
  }

  async disconnect(): Promise<void> {
    this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnect);
    this.device?.gatt?.disconnect();
    this.characteristic = null;
    this.device = null;
  }

  async write(data: Bytes, options: WriteOptions): Promise<void> {
    const characteristic = this.characteristic;
    if (!characteristic) throw new Error('Printer Bluetooth belum terhubung.');
    const { write: canConfirm, writeWithoutResponse: canSkipConfirm } = characteristic.properties;
    let size = this.smallPacketsOnly ? BLE_SAFE_PACKET : Math.min(512, Math.max(BLE_SAFE_PACKET, Math.round(options.bleChunk)));

    let offset = 0;
    while (offset < data.length) {
      // An unconfirmed packet longer than the link allows is cut short without
      // any error, which garbles the print. So in automatic mode anything above
      // the always-safe size is sent with confirmation, where the printer
      // either takes the whole packet or refuses it.
      const withoutResponse =
        options.bleWrite === 'without-response' ||
        (options.bleWrite === 'auto' && canSkipConfirm && (size <= BLE_SAFE_PACKET || !canConfirm));
      const chunk = data.subarray(offset, offset + size);
      try {
        if (withoutResponse) await characteristic.writeValueWithoutResponse(chunk);
        else await characteristic.writeValueWithResponse(chunk);
      } catch (error) {
        // A refused packet was not printed at all: drop to the safe size and send it again.
        if (withoutResponse || size <= BLE_SAFE_PACKET || !this.characteristic) throw error;
        size = BLE_SAFE_PACKET;
        this.smallPacketsOnly = true;
        continue;
      }
      offset += chunk.length;
      if (options.bleChunkDelayMs > 0) await sleep(options.bleChunkDelayMs);
    }
  }
}

const USB_PRINTER_CLASS = 7;
const USB_CHUNK = 4096;

class UsbTransport implements Transport {
  readonly kind = 'usb' as const;
  onDisconnect: (() => void) | null = null;
  private device: USBDevice | null = null;
  private interfaceNumber = 0;
  private endpoint = 0;

  private readonly handleUnplug = (event: USBConnectionEvent) => {
    if (event.device !== this.device) return;
    this.device = null;
    this.onDisconnect?.();
  };

  async connect(options: ConnectOptions): Promise<string> {
    const device = await navigator.usb.requestDevice({
      filters: options.usbShowAll ? [] : [{ classCode: USB_PRINTER_CLASS }],
    });
    await this.open(device);
    return this.describe(device);
  }

  async reconnect(): Promise<string | null> {
    for (const device of await navigator.usb.getDevices()) {
      try {
        await this.open(device);
        return this.describe(device);
      } catch {
        // Not a printer, or already claimed elsewhere: try the next remembered device.
      }
    }
    return null;
  }

  private describe(device: USBDevice): string {
    return device.productName || device.manufacturerName || 'Printer USB';
  }

  private async open(device: USBDevice): Promise<void> {
    await device.open();
    try {
      if (!device.configuration) await device.selectConfiguration(1);
      // Prefer the interface that declares itself a printer; fall back to any bulk output.
      const target = this.findOutput(device, true) ?? this.findOutput(device, false);
      if (!target) throw new Error('Perangkat USB ini tidak punya jalur untuk mencetak.');
      await device.claimInterface(target.interfaceNumber);
      this.interfaceNumber = target.interfaceNumber;
      this.endpoint = target.endpoint;
      this.device = device;
      navigator.usb.addEventListener('disconnect', this.handleUnplug);
    } catch (error) {
      await device.close().catch(() => undefined);
      throw error;
    }
  }

  private findOutput(device: USBDevice, printerOnly: boolean): { interfaceNumber: number; endpoint: number } | null {
    for (const iface of device.configuration?.interfaces ?? []) {
      const alternate = iface.alternate;
      if (printerOnly && alternate.interfaceClass !== USB_PRINTER_CLASS) continue;
      const out = alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (out) return { interfaceNumber: iface.interfaceNumber, endpoint: out.endpointNumber };
    }
    return null;
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    this.device = null;
    navigator.usb.removeEventListener('disconnect', this.handleUnplug);
    if (!device) return;
    await device.releaseInterface(this.interfaceNumber).catch(() => undefined);
    await device.close().catch(() => undefined);
  }

  async write(data: Bytes): Promise<void> {
    const device = this.device;
    if (!device) throw new Error('Printer USB belum terhubung.');
    for (let offset = 0; offset < data.length; offset += USB_CHUNK) {
      const result = await device.transferOut(this.endpoint, data.subarray(offset, offset + USB_CHUNK));
      if (result.status !== 'ok') throw new Error('Printer USB menolak data.');
    }
  }
}

const SERIAL_CHUNK = 512;

class SerialTransport implements Transport {
  readonly kind = 'serial' as const;
  onDisconnect: (() => void) | null = null;
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  private readonly handleDisconnect = () => {
    this.port = null;
    this.writer = null;
    this.onDisconnect?.();
  };

  async connect(options: ConnectOptions): Promise<string> {
    await this.open(await navigator.serial.requestPort(), options.baudRate);
    return 'Printer serial';
  }

  async reconnect(options: ConnectOptions): Promise<string | null> {
    for (const port of await navigator.serial.getPorts()) {
      try {
        await this.open(port, options.baudRate);
        return 'Printer serial';
      } catch {
        // Port busy or gone: try the next one.
      }
    }
    return null;
  }

  private async open(port: SerialPort, baudRate: number): Promise<void> {
    await port.open({ baudRate });
    if (!port.writable) {
      await port.close();
      throw new Error('Port serial ini tidak bisa ditulisi.');
    }
    port.addEventListener('disconnect', this.handleDisconnect);
    this.port = port;
    this.writer = port.writable.getWriter();
  }

  async disconnect(): Promise<void> {
    const { port, writer } = this;
    this.port = null;
    this.writer = null;
    port?.removeEventListener('disconnect', this.handleDisconnect);
    writer?.releaseLock();
    await port?.close().catch(() => undefined);
  }

  async write(data: Bytes): Promise<void> {
    const writer = this.writer;
    if (!writer) throw new Error('Printer serial belum terhubung.');
    for (let offset = 0; offset < data.length; offset += SERIAL_CHUNK) {
      await writer.write(data.subarray(offset, offset + SERIAL_CHUNK));
    }
  }
}

/** Collects the job instead of printing it, so it can be shown on screen. */
export class PreviewTransport implements Transport {
  readonly kind = 'preview' as const;
  onDisconnect: (() => void) | null = null;
  private received: Bytes[] = [];

  async connect(): Promise<string> {
    return 'Simulasi (tampil di layar)';
  }

  async reconnect(): Promise<string | null> {
    return 'Simulasi (tampil di layar)';
  }

  async disconnect(): Promise<void> {
    this.received = [];
  }

  async write(data: Bytes): Promise<void> {
    this.received.push(data.slice());
    // Take a moment per band so the progress display behaves like a real print.
    await sleep(Math.min(80, data.length / 200));
  }

  /** Hands over everything received since the last call. */
  takeJob(): Bytes[] {
    const job = this.received;
    this.received = [];
    return job;
  }
}

export function createTransport(kind: TransportKind): Transport {
  if (!transportSupported(kind)) {
    throw new Error('Browser ini tidak mendukung koneksi tersebut. Gunakan Google Chrome di Android atau komputer.');
  }
  if (kind === 'bluetooth') return new BluetoothTransport();
  if (kind === 'usb') return new UsbTransport();
  if (kind === 'serial') return new SerialTransport();
  return new PreviewTransport();
}
