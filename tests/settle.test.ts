import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettledNote } from '../src/lib/settle';

describe('the note that settings were saved', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays away while a finger drags a slider, however long it pauses', () => {
    const shown: string[] = [];
    const note = createSettledNote((text) => shown.push(text), 1500);
    note.press();
    for (let step = 0; step < 20; step++) {
      note.changed('Tersimpan.');
      vi.advanceTimersByTime(50);
    }
    // The finger rests on the slider for a good while.
    vi.advanceTimersByTime(10_000);
    expect(shown).toEqual([]);
    // Lifted: the note comes once, after the quiet time.
    note.release();
    vi.advanceTimersByTime(1499);
    expect(shown).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual(['Tersimpan.']);
    vi.advanceTimersByTime(10_000);
    expect(shown).toHaveLength(1);
  });

  it('waits again when the next slider is touched before the note came', () => {
    const shown: string[] = [];
    const note = createSettledNote((text) => shown.push(text), 1500);
    note.press();
    note.changed('Tersimpan.');
    note.release();
    vi.advanceTimersByTime(1000);
    // On to the next slider before the note showed.
    note.press();
    note.changed('Tersimpan.');
    vi.advanceTimersByTime(5000);
    expect(shown).toEqual([]);
    note.release();
    vi.advanceTimersByTime(1500);
    expect(shown).toEqual(['Tersimpan.']);
  });

  it('comes after a tap on a switch, and after typing stops', () => {
    const shown: string[] = [];
    const note = createSettledNote((text) => shown.push(text), 1500);
    // A tap: down, up, and only then the change.
    note.press();
    note.release();
    note.changed('Tersimpan.');
    vi.advanceTimersByTime(1500);
    expect(shown).toEqual(['Tersimpan.']);
    // Typing: no finger on the screen, one change per key.
    for (let key = 0; key < 5; key++) {
      note.changed('Tersimpan.');
      vi.advanceTimersByTime(300);
    }
    expect(shown).toHaveLength(1);
    vi.advanceTimersByTime(1200);
    expect(shown).toHaveLength(2);
  });

  it('says nothing when nothing changed', () => {
    const shown: string[] = [];
    const note = createSettledNote((text) => shown.push(text), 1500);
    note.press();
    note.release();
    vi.advanceTimersByTime(5000);
    expect(shown).toEqual([]);
  });
});
