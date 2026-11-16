import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import './styles.css';
import { render } from 'preact';
import { App } from './app';
import { keepScreenAwake, persistStorage } from './lib/kiosk';
import { printer } from './lib/printer/manager';
import { registerServiceWorker } from './lib/update';

// A long press must not open the browser's context menu on a public kiosk.
document.addEventListener('contextmenu', (event) => event.preventDefault());

// Android's back gesture would otherwise leave the booth; keep one history entry in front of it.
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => history.pushState(null, '', location.href));

keepScreenAwake();
void persistStorage();
// Picks the printer back up after a reload, when the browser still has permission for it.
void printer.reconnect();

if (import.meta.env.PROD) registerServiceWorker();

render(<App />, document.getElementById('app')!);
