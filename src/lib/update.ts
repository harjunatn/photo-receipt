import { createStore } from './store';

/** True when a newer version of the app has been downloaded and is waiting to take over. */
export const updateReady = createStore(false);

let waiting: ServiceWorker | null = null;

/**
 * Registers the offline cache. A new version is downloaded in the background
 * but only takes over when `applyUpdate` is called — the page it replaces is
 * then reloaded at once, so it never runs against files that no longer exist.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;

  // The very first install also changes the controller; only a replacement needs a reload.
  let controlled = sw.controller !== null;
  sw.addEventListener('controllerchange', () => {
    if (controlled) location.reload();
    controlled = true;
  });

  const watch = (worker: ServiceWorker | null) => {
    if (!worker) return;
    const check = () => {
      if (worker.state === 'installed' && sw.controller) {
        waiting = worker;
        updateReady.set(true);
      }
    };
    worker.addEventListener('statechange', check);
    check();
  };

  sw.register('./sw.js')
    .then((registration) => {
      watch(registration.waiting);
      watch(registration.installing);
      registration.addEventListener('updatefound', () => watch(registration.installing));
      // A booth can stay open for days; look for a new version every half hour.
      setInterval(() => registration.update().catch(() => undefined), 30 * 60 * 1000);
    })
    .catch(() => undefined);
}

/** Switches to the downloaded version. The page reloads as soon as it has taken over. */
export function applyUpdate(): void {
  waiting?.postMessage('activate-now');
}
