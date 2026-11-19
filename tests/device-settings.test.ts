import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDeviceSettings, deviceSettingsOf } from '../src/lib/cloud/shared';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/settings';

/** Settings a booth has after staff set it up: Bluetooth printer on 58 mm paper, their own PIN, and so on. */
function setUpBooth(): Settings {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.printer.transport = 'serial';
  s.printer.paperWidth = 58;
  s.printer.dots = 384;
  s.printer.cut = 'none';
  s.printer.raster.gamma = 1.6;
  s.printer.raster.dither = 'floyd-steinberg';
  s.session.countdownSec = 5;
  s.session.mirrorPhoto = true;
  s.storage.maxSessions = 300;
  s.admin.pin = '4321';
  s.receipt.title = 'HELLO VIOREN';
  s.receipt.quotes = ['Booth ini punya kutipannya sendiri.'];
  s.receipt.logo = 'data:image/png;base64,AAAA';
  return s;
}

describe('tablet settings kept with the device', () => {
  it('holds only what is set on the tablet, not what the dashboard decides', () => {
    const saved = deviceSettingsOf(setUpBooth());
    expect(Object.keys(saved).sort()).toEqual(['admin', 'printer', 'receipt', 'session', 'storage']);
    expect(saved.printer.transport).toBe('serial');
    expect(saved.admin.pin).toBe('4321');
    expect(saved.receipt.title).toBe('HELLO VIOREN');
    // The logo comes from the dashboard and can be large, so it is not part of the copy.
    expect(saved.receipt).not.toHaveProperty('logo');
  });

  it('gives a replacement tablet the printer, session, receipt text, history and PIN settings, and nothing else', () => {
    const fresh = structuredClone(DEFAULT_SETTINGS);
    fresh.brand.title = 'Dari dashboard';
    fresh.frames.active = ['film'];
    fresh.receipt.logo = 'data:image/png;base64,LOGO';
    const next = applyDeviceSettings(fresh, JSON.parse(JSON.stringify(deviceSettingsOf(setUpBooth()))));
    expect(deviceSettingsOf(next)).toEqual(deviceSettingsOf(setUpBooth()));
    expect(next.receipt.title).toBe('HELLO VIOREN');
    expect(next.receipt.logo).toBe('data:image/png;base64,LOGO');
    expect(next.brand.title).toBe('Dari dashboard');
    expect(next.frames.active).toEqual(['film']);
  });

  it('keeps the tablet usable when the saved copy is damaged or from an older version', () => {
    const fresh = structuredClone(DEFAULT_SETTINGS);
    expect(applyDeviceSettings(fresh, null)).toEqual(fresh);
    expect(applyDeviceSettings(fresh, 'rusak')).toEqual(fresh);
    const next = applyDeviceSettings(fresh, {
      printer: { transport: 'serial', dots: 'banyak' },
      session: 'x',
      admin: { pin: '' },
    });
    expect(next.printer.transport).toBe('serial');
    expect(next.printer.dots).toBe(DEFAULT_SETTINGS.printer.dots);
    expect(next.printer.raster).toEqual(DEFAULT_SETTINGS.printer.raster);
    expect(next.session).toEqual(DEFAULT_SETTINGS.session);
    // An empty or malformed PIN would lock staff out, so the tablet keeps its own.
    expect(next.admin.pin).toBe(DEFAULT_SETTINGS.admin.pin);
    expect(applyDeviceSettings(fresh, { admin: { pin: '12ab' } }).admin.pin).toBe(DEFAULT_SETTINGS.admin.pin);
  });
});

type Call = { name: string; args: Record<string, unknown> };

/** The project's database as the tablet sees it: one device, which may hold settings from an earlier tablet. */
function fakeServer(initial: unknown) {
  const calls: Call[] = [];
  const device = { settings: initial };
  let saveMissing = false;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const name = String(url).split('/').pop() ?? '';
      const args = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ name, args });
      if (name === 'device_pair') return json({ token: 'tok', id: 'dev-1', name: 'Booth Pertama', code: 'ABC123', settings: device.settings });
      if (name === 'device_sync') return json({ id: 'dev-1', name: 'Booth Pertama', frames: null, outlet_version: 'v1', outlet: {} });
      if (name === 'device_save_settings') {
        // Before the new schema is run, the function does not exist yet.
        if (saveMissing) return json({ message: 'Could not find the function' }, 404);
        device.settings = args.p_settings;
        return json({ ok: true });
      }
      return json({ ok: true });
    }),
  );
  return {
    device,
    saves: () => calls.filter((call) => call.name === 'device_save_settings'),
    setSaveMissing: (missing: boolean) => {
      saveMissing = missing;
    },
  };
}

describe('a tablet backing up and taking over device settings', () => {
  beforeEach(() => {
    const memory = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, v),
      removeItem: (k: string) => memory.delete(k),
    });
    vi.stubEnv('VITE_SUPABASE_URL', 'https://contoh.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    vi.resetModules();
    // Photo uploads need IndexedDB, which these tests do not have.
    vi.doMock('../src/lib/cloud/upload', () => ({ pumpUploads: async () => undefined }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.doUnmock('../src/lib/cloud/upload');
  });

  async function freshTablet() {
    const { settingsStore } = await import('../src/lib/settings');
    const device = await import('../src/lib/cloud/device');
    /** Waits for the sync that pairing starts in the background, then runs one more. */
    const settle = async () => {
      for (let i = 0; i < 100; i++) {
        if (await device.syncNow()) return;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      throw new Error('The sync never finished.');
    };
    return { settingsStore, device, settle };
  }

  it('a replacement tablet paired with the same code works like the one before it', async () => {
    const server = fakeServer(JSON.parse(JSON.stringify(deviceSettingsOf(setUpBooth()))));
    const { settingsStore, device, settle } = await freshTablet();
    expect(settingsStore.get().admin.pin).toBe(DEFAULT_SETTINGS.admin.pin);

    await expect(device.pairDevice('ABC123', '111111')).resolves.toEqual({ error: '', restored: true });
    expect(deviceSettingsOf(settingsStore.get())).toEqual(deviceSettingsOf(setUpBooth()));
    await settle();
    // Nothing changed on the tablet, so nothing is sent back.
    expect(server.saves()).toHaveLength(0);
  });

  it('a device without saved settings gets those of the tablet paired to it', async () => {
    const server = fakeServer(null);
    const { settingsStore, device, settle } = await freshTablet();
    settingsStore.replace(setUpBooth());

    await expect(device.pairDevice('ABC123', '111111')).resolves.toEqual({ error: '', restored: false });
    expect(settingsStore.get().admin.pin).toBe('4321');
    await settle();
    expect(server.saves()).toHaveLength(1);
    expect(server.device.settings).toEqual(JSON.parse(JSON.stringify(deviceSettingsOf(setUpBooth()))));
    expect(server.device.settings).not.toHaveProperty('packages');
    expect(server.device.settings).not.toHaveProperty('receipt.logo');
  });

  it('sends a change made by staff once, at the next sync', async () => {
    const server = fakeServer(null);
    const { settingsStore, device, settle } = await freshTablet();
    await device.pairDevice('ABC123', '111111');
    await settle();
    expect(server.saves()).toHaveLength(1);

    settingsStore.update((s) => void (s.printer.transport = 'bluetooth'));
    await device.syncNow();
    await device.syncNow();
    expect(server.saves()).toHaveLength(2);
    expect(server.device.settings).toMatchObject({ printer: { transport: 'bluetooth' } });
    expect(device.settingsBackupStore.get()?.json).toContain('"transport":"bluetooth"');
  });

  it('keeps syncing sales while the database does not have the new function yet, and backs up once it does', async () => {
    const server = fakeServer(null);
    server.setSaveMissing(true);
    const { device, settle } = await freshTablet();
    await device.pairDevice('ABC123', '111111');
    await settle();
    expect(device.syncState.get().error).toBe('');
    expect(device.settingsBackupStore.get()).toBeNull();
    expect(server.device.settings).toBeNull();

    server.setSaveMissing(false);
    await expect(device.syncNow()).resolves.toBe(true);
    expect(server.device.settings).toMatchObject({ admin: { pin: DEFAULT_SETTINGS.admin.pin } });
    expect(device.settingsBackupStore.get()).not.toBeNull();
  });
});
