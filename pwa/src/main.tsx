import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/base.css';
import { App } from './app';
import { initTheme } from './lib/theme';
import { setUpdater } from './lib/swupdate';

// Theme before first render (index.html pre-stamps the attribute so even the
// pre-bundle paint is right; this adds the live change listener + meta sync).
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA updates are automatic (registerType: 'autoUpdate', vite.config.ts): a new
// worker skip-waits, claims the page, and reloads it onto the fresh bundle — so
// onNeedRefresh never fires and there is no toast to answer.
//
// The gap that leaves, and the reason this block exists: a browser only
// re-fetches sw.js on NAVIGATION (or once a day). This app never navigates — it
// is one document with client-side routing, typically left open for days on a
// phone — so a deploy can sit unseen behind a running tab indefinitely, which
// presents exactly as "the feature you just shipped isn't there". Ask the
// registration to look for itself: on a timer, and whenever the app comes back
// to the foreground (the moment a phone user actually returns to it).
// In dev, registerSW is an inert stub and onRegisteredSW never runs.
const UPDATE_CHECK_MS = 15 * 60 * 1000;

registerSW({
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const check = (): void => void registration.update();
    setInterval(check, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    // The fleet store's other reason to ask for a check: an incompatible
    // `hello` off /ws/fleet means a deploy already landed and this tab is the
    // stale one, which is worth acting on immediately rather than waiting for
    // the timer or the next foreground.
    setUpdater(check);
  },
});
