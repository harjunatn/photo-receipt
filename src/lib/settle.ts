/**
 * Says something once a burst of changes has settled: nothing while a finger
 * (or the mouse button) is still down on the screen, then after `delayMs`
 * without another change or touch. Dragging a slider and pausing mid-way
 * therefore says nothing; lifting the finger and leaving it be does, once.
 */
export function createSettledNote(show: (note: string) => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: string | null = null;
  let held = false;

  const wait = () => {
    clearTimeout(timer);
    if (pending === null || held) return;
    timer = setTimeout(() => {
      const note = pending;
      pending = null;
      if (note !== null) show(note);
    }, delayMs);
  };

  return {
    /** Something changed; `note` is what to say about it when things are quiet again. */
    changed(note: string): void {
      pending = note;
      wait();
    },
    /** A finger or the mouse button went down. */
    press(): void {
      held = true;
      clearTimeout(timer);
    },
    /** It came up again. */
    release(): void {
      held = false;
      wait();
    },
  };
}
