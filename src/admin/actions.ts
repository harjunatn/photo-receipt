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

/** Shorthand for editing one part of the settings. */
export function edit(change: (draft: Settings) => void): void {
  settingsStore.update(change);
}
