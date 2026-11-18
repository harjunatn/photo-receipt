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

/** How long one attempt to open the Bluetooth link may take before it is abandoned. */
export const BLE_ATTEMPT_MS = 8000;
/** Attempts before giving up; a printer that still thinks it is connected often answers the second or third. */
const BLE_ATTEMPTS = 3;
/** Pause after closing a stale link, so the printer notices before the next attempt. */
const BLE_SETTLE_MS = 600;

const BLE_NOT_ANSWERING =
  'Printer Bluetooth tidak menjawab. Matikan printer, tunggu 5 detik, nyalakan lagi sampai lampunya berkedip, lalu tekan Hubungkan.';

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

  /** The attempt in progress, so a manual connect and the automatic retry never open the link at the same time. */
  private opening: Promise<void> | null = null;

  async connect(): Promise<string> {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_PRINT_SERVICES,
    });
    await this.open(device);
    return device.name || 'Printer Bluetooth';
  }

  /**
   * Opens the link, a few times if need be. Each attempt first closes whatever
   * is left of an earlier link: after a dropped connection the printer can
   * still believe it is connected (its light stays on), and a new attempt then
   * waits forever unless the old link is closed and the attempt timed out.
   */
  private open(device: BluetoothDevice): Promise<void> {
    const run = async () => {
      for (let attempt = 0; attempt < BLE_ATTEMPTS; attempt++) {
        if (device.gatt?.connected || attempt > 0) {
          device.gatt?.disconnect();
          await sleep(BLE_SETTLE_MS);
        }
        try {
          await withTimeout(this.attach(device), BLE_ATTEMPT_MS, BLE_NOT_ANSWERING);
          return;
        } catch (error) {
          // An attempt that timed out may still be pending inside the browser; close it before the next one.
          device.gatt?.disconnect();
          this.characteristic = null;
          // Not a printer at all: trying again will not change that.
          if (error instanceof Error && error.message.startsWith('Perangkat ini')) throw error;
        }
      }
      throw new Error(BLE_NOT_ANSWERING);
    };
    // Wait for any attempt already running, then make this one.
    const next = (this.opening ?? Promise.resolve()).catch(() => undefined).then(run);
    this.opening = next;
    return next.finally(() => {
      if (this.opening === next) this.opening = null;
    });
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
      await this.open(device);
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
      const candidates = this.outputs(device);
      if (candidates.length === 0) throw new Error('Perangkat USB ini tidak punya jalur untuk mencetak. Pastikan yang dipilih printernya, bukan hub.');

      // Some printers expose more than one interface and the tablet may refuse
      // the first; try each one that can take print data until one is granted.
      for (const target of candidates) {
        try {
          await device.claimInterface(target.interfaceNumber);
        } catch {
          continue;
        }
        this.interfaceNumber = target.interfaceNumber;
        this.endpoint = target.endpoint;
        this.device = device;
        navigator.usb.addEventListener('disconnect', this.handleUnplug);
        return;
      }
      const classes = candidates.map((c) => c.interfaceClass).join(', ');
      throw new Error(
        `Printer "${this.describe(device)}" terdeteksi, tapi tablet menolak memberikannya ke Chrome (kelas antarmuka: ${classes}). ` +
          'Biasanya karena aplikasi lain sedang memakai printer ini. Tutup aplikasi printer lain, cabut lalu colok lagi kabel USB-nya, ' +
          'dan saat Android bertanya aplikasi mana yang membuka perangkat USB ini, pilih Chrome. Lalu tekan Hubungkan lagi.',
      );
    } catch (error) {
      await device.close().catch(() => undefined);
      throw error;
    }
  }

  /** Interfaces that can take print data: the ones that say they are a printer first, then any other bulk output. */
  private outputs(device: USBDevice): { interfaceNumber: number; endpoint: number; interfaceClass: number }[] {
    const found = [];
    for (const iface of device.configuration?.interfaces ?? []) {
      const alternate = iface.alternate;
      const out = alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (out) found.push({ interfaceNumber: iface.interfaceNumber, endpoint: out.endpointNumber, interfaceClass: alternate.interfaceClass });
    }
    return found.sort((x, y) => Number(y.interfaceClass === USB_PRINTER_CLASS) - Number(x.interfaceClass === USB_PRINTER_CLASS));
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
