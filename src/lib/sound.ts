import { settingsStore } from './settings';

let context: AudioContext | null = null;

function beep(frequency: number, durationMs: number, volume = 0.18, delayMs = 0): void {
  if (!settingsStore.get().session.sound) return;
  try {
    context ??= new AudioContext();
    const start = context.currentTime + delayMs / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + durationMs / 1000);
  } catch {
    // Sound is a nicety; never let it break a session.
  }
}

export const sound = {
  /** Browsers only allow audio after a tap, so call this from the button that starts the session. */
  unlock(): void {
    if (!settingsStore.get().session.sound) return;
    try {
      context ??= new AudioContext();
      void context.resume();
    } catch {
      // No audio available.
    }
  },
  tick: () => beep(880, 110),
  shutter: () => {
    beep(1500, 45, 0.25);
    beep(700, 90, 0.2, 55);
  },
  done: () => {
    beep(660, 120);
    beep(880, 120, 0.18, 130);
    beep(1320, 220, 0.18, 260);
  },
};
