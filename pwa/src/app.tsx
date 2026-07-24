// Router shell. Two path routes: `/` (FleetScreen) and `/s/:id`
// (SessionScreen). On phones this is a full-screen swap (one pane at a time);
// on desktop it's a two-pane master–detail — the fleet as a persistent sidebar
// beside the active session (styles/shell.css does the responsive layout, the
// same DOM serves both). ToastHost mounts here so stores/screens can fire
// toasts from anywhere.
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { ToastHost } from './components/Toast';
import { usePath } from './lib/router';
import { FleetScreen } from './screens/FleetScreen';
import { SessionScreen } from './screens/SessionScreen';
import { useFleetStore } from './stores/fleet';
import './styles/shell.css';

export { navigate } from './lib/router';

export function App(): ReactNode {
  const path = usePath();
  useEffect(() => {
    // The fleet stream is the app's heartbeat: connect once at the shell so
    // deep links to /s/:id still get live names, limits and dialog badges.
    // connect() is idempotent; the socket survives navigation.
    useFleetStore.getState().connect();
  }, []);
  const m = /^\/s\/([^/]+)\/?$/.exec(path);
  const sessionId = m ? decodeURIComponent(m[1]!) : null;
  return (
    <>
      <div className="app-shell" data-view={sessionId ? 'session' : 'fleet'}>
        <aside className="shell-nav">
          {/* Always mounted so it's the desktop sidebar; hidden on mobile when a
              session is open. selectedId marks the active card in the sidebar. */}
          <FleetScreen selectedId={sessionId} />
        </aside>
        <section className="shell-detail">
          {sessionId ? (
            // key remounts per session so per-session UI state (terminal drawer,
            // pickers) never leaks across a sidebar switch.
            <SessionScreen key={sessionId} id={sessionId} />
          ) : (
            <div className="shell-placeholder">
              <p className="shell-placeholder-mark" aria-hidden="true">
                ❯
              </p>
              <p className="shell-placeholder-copy">Select a session</p>
            </div>
          )}
        </section>
      </div>
      <ToastHost />
    </>
  );
}
