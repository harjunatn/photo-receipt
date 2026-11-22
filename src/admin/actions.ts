import type { BitImage } from '../lib/image/types';
import { printer } from '../lib/printer/manager';
import { settingsStore, type Settings } from '../lib/settings';
import { createSettledNote } from '../lib/settle';
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

/** How long the settings must be left alone, finger off the screen, before the note that they were saved. */
const SAVED_NOTE_AFTER_MS = 1500;

const savedNote = createSettledNote(toast, SAVED_NOTE_AFTER_MS);

if (typeof window !== 'undefined') {
  // Touch is followed through touch events: the browser cancels a finger's pointer events when it
  // takes the gesture over (scrolling), but always reports when the last finger leaves the screen.
  window.addEventListener('touchstart', () => savedNote.press(), { capture: true, passive: true });
  const fingersLeft = (event: TouchEvent) => {
    if (event.touches.length === 0) savedNote.release();
  };
  window.addEventListener('touchend', fingersLeft, { capture: true, passive: true });
  window.addEventListener('touchcancel', fingersLeft, { capture: true, passive: true });
  // A mouse or pen, for settings opened on a laptop.
  window.addEventListener('pointerdown', (event) => event.pointerType !== 'touch' && savedNote.press(), true);
  window.addEventListener('pointerup', (event) => event.pointerType !== 'touch' && savedNote.release(), true);
  window.addEventListener('pointercancel', (event) => event.pointerType !== 'touch' && savedNote.release(), true);
  // A control reports "change" when the operator lets go of it or picks a value. That also covers a
  // drop-down list opened with the mouse, whose own list swallows the button coming up.
  window.addEventListener('change', () => savedNote.release(), true);
}

/**
 * Shorthand for editing one part of the settings. Every change is saved at
 * once. A short note confirms it only when the operator is done: not while a
 * finger is still on a slider, and not during a pause in the middle of
 * adjusting. Pass false for no note, e.g. when the caller shows its own.
 */
export function edit(change: (draft: Settings) => void, note: string | false = 'Pengaturan tersimpan.'): void {
  settingsStore.update(change);
  if (note) savedNote.changed(note);
}
