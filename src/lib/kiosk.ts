import { useEffect, useRef } from 'preact/hooks';

let lastActivity = Date.now();

/** Call while something is happening without touches (countdown, printing) so the booth does not time out. */
export function pokeIdle(): void {
  lastActivity = Date.now();
}

/** Seconds since the screen was last touched. */
export function secondsIdle(): number {
  return (Date.now() - lastActivity) / 1000;
}

/** Calls `onIdle` once nobody has touched the screen for `seconds`. */
export function useIdle(seconds: number, onIdle: () => void, enabled: boolean): void {
  const callback = useRef(onIdle);
  callback.current = onIdle;

  useEffect(() => {
    if (!enabled) return;
    pokeIdle();
    const events = ['pointerdown', 'keydown'] as const;
    events.forEach((name) => window.addEventListener(name, pokeIdle, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - lastActivity >= seconds * 1000) {
        pokeIdle();
        callback.current();
      }
    }, 1000);
    return () => {
      events.forEach((name) => window.removeEventListener(name, pokeIdle));
      clearInterval(timer);
    };
  }, [seconds, enabled]);
}

/** Keeps the screen on. The lock is dropped whenever the page is hidden, so it is re-requested on return. */
export function keepScreenAwake(): void {
  if (!('wakeLock' in navigator)) return;
  const request = () => {
    if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(() => undefined);
  };
  request();
  document.addEventListener('visibilitychange', request);
}

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null;
}

export async function toggleFullscreen(): Promise<void> {
  if (isFullscreen()) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
}

/** True when launched from the home screen as an installed app. */
export function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
}

/** Asks the browser not to evict saved photos and settings when storage runs low. */
export async function persistStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}

export function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
