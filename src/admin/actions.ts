import type { BitImage } from '../lib/image/types';
import { printer } from '../lib/printer/manager';
import { settingsStore, type Settings } from '../lib/settings';
import { toast } from '../ui/components';

/** Prints from the admin panel, reporting problems as a toast. Returns whether the print went through. */
export async function printWithFeedback(bits: BitImage, copies = 1): Promise<boolean> {
  if (printer.state.get().status === 'disconnected') {
    toast('Printer belum terhubung. Hubungkan dulu di tab Printer.');
    return false;
  }
  try {
    await printer.print(bits, copies);
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Gagal mencetak.');
    return false;
  }
}

let savedTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Shorthand for editing one part of the settings. Every change is saved at
 * once; a short note confirms it, once a burst of changes (a slider) settles.
 * Pass false for no note, e.g. when the caller shows its own.
 */
export function edit(change: (draft: Settings) => void, note: string | false = 'Pengaturan tersimpan.'): void {
  settingsStore.update(change);
  clearTimeout(savedTimer);
  if (note) savedTimer = setTimeout(() => toast(note), 400);
}
