import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import './styles.css';
import { render } from 'preact';
import { App } from './app';
import { startCloudSync } from './lib/cloud/device';
import { keepScreenAwake, persistStorage } from './lib/kiosk';
import { printer } from './lib/printer/manager';
import { registerServiceWorker } from './lib/update';

const root = document.getElementById('app')!;
const isDashboard = () => location.hash.startsWith('#dashboard');
const startedAsDashboard = isDashboard();

// The booth and the owner's dashboard are two different apps behind one address.
window.addEventListener('hashchange', () => {
  if (isDashboard() !== startedAsDashboard) location.reload();
});

function startBooth(): void {
  // A long press must not open the browser's context menu on a public kiosk.
  document.addEventListener('contextmenu', (event) => event.preventDefault());

  // Android's back gesture would otherwise leave the booth; keep one history entry in front of it.
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => history.pushState(null, '', location.href));

  keepScreenAwake();
  void persistStorage();
  // Picks the printer back up after a reload, when the browser still has permission for it.
  void printer.reconnect();
  startCloudSync();

  render(<App />, root);
}

if (startedAsDashboard) {
  // Loaded on demand, so the booth's tablets never run the dashboard's code.
  document.documentElement.classList.add('dash-page');
  void import('./dashboard/Dashboard').then(({ Dashboard }) => render(<Dashboard />, root));
} else {
  startBooth();
}

if (import.meta.env.PROD) registerServiceWorker();
