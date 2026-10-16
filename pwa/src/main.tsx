import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/base.css';
import { App } from './app';
import { RenderBoundary, RootFallback } from './components/RenderBoundary';
import { initTheme } from './lib/theme';
import { initSkin } from './lib/skin';
import { setUpdater } from './lib/swupdate';

// Theme before first render (index.html pre-stamps the attribute so even the
// pre-bundle paint is right; this adds the live change listener + meta sync).
initTheme();
// The skin likewise (D-5093): index.html stamped the stored value verbatim;
// this resolves it against the catalogue, so an unknown one becomes Refined.
initSkin();

// The root boundary (design 2026-10-01 section 4.12): a throw anywhere in the
// app while rendering shows "ccrc could not draw this screen." and Reload
// instead of unmounting the root into a blank page. Its key is a constant, so
// it never resets: Reload is the way back.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RenderBoundary where="root" resetKey="root" fallback={() => <RootFallback />}>
      <App />
    </RenderBoundary>
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
