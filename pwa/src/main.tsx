import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/base.css';
import { App } from './app';
import { RenderBoundary, RootFallback } from './components/RenderBoundary';
import { initTheme } from './lib/theme';
import { initSkin } from './lib/skin';
import { noteActivated, setBlockProbe, setReloadHold, setUpdater, startReloadGate } from './lib/swupdate';
import { anySendUnresolved } from './stores/session';
import { useFleetStore } from './stores/fleet';
import { onPageVisible } from './lib/pageClock';

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
      {/* The ⌘K palette and the global keys (D-5103) are mounted inside the
          app, above the skin frame (D-5467). */}
      <App />
    </RenderBoundary>
  </StrictMode>,
);

// PWA updates are automatic (registerType: 'autoUpdate', vite.config.ts): a new
// worker skip-waits and claims the page, so onNeedRefresh never fires and there
// is no toast to answer. The reload onto the fresh bundle waits for a move
// (console speed, Task C3; the operator's ruling on item 33, "Reload when you
// next move between screens, never in the first seconds back"): onNeedReload
// replaces the plugin's own `location.reload()` and only marks a reload as
// pending, and the gate started here runs it at the next move between screens
// once the page has been back for 15 s (`lib/reloadGate.ts`), never while a
// send is unresolved (a full page load would drop it), and treats the block
// screen as urgent only while the fleet store still says blocked.
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

setReloadHold(anySendUnresolved);
setBlockProbe(() => useFleetStore.getState().blocked);
startReloadGate();

registerSW({
  onNeedReload: noteActivated,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const check = (): void => void registration.update();
    setInterval(check, UPDATE_CHECK_MS);
    onPageVisible(() => {
      if (document.visibilityState === 'visible') check();
    });
    // The fleet store's other reason to ask for a check: an incompatible
    // `hello` off /ws/fleet means a deploy already landed and this tab is the
    // stale one, which is worth acting on immediately rather than waiting for
    // the timer or the next foreground.
    setUpdater(check);
  },
});
