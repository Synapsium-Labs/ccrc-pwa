// Router shell. Three path routes: `/` (FleetScreen), `/s/:id`
// (SessionScreen), `/archive` (ArchiveScreen — Task 19, the fleet-wide list
// every archived workspace routes to from the footer row). On phones this is
// a full-screen swap (one pane at a time); on desktop it's a two-pane
// master–detail — the fleet as a persistent sidebar beside the active detail
// pane (styles/shell.css does the responsive layout, the same DOM serves
// both). `/archive` shares the SAME detail slot and the SAME [data-view]
// swap `/s/:id` already uses — CSS never learned a third state, it only
// needed to know "fleet" vs "something else is in the detail pane".
// ToastHost mounts here so stores/screens can fire toasts from anywhere.
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { BlockScreen } from './components/BlockScreen';
import { ToastHost } from './components/Toast';
import { AccountsStrip } from './fleet/AccountsStrip';
import { navigate, usePath } from './lib/router';
import { useMediaQuery } from './lib/useMediaQuery';
import { AccountsScreen } from './screens/AccountsScreen';
import { ArchiveScreen } from './screens/ArchiveScreen';
import { FleetScreen } from './screens/FleetScreen';
import { SessionScreen } from './screens/SessionScreen';
import { useFleetStore } from './stores/fleet';
import './styles/shell.css';

export { navigate } from './lib/router';

export function App(): ReactNode {
  const path = usePath();
  useEffect(() => {
    // The fleet stream is the app's heartbeat: connect once at the shell so
    // deep links to /s/:id (or /archive) still get live names, limits and
    // dialog badges. connect() is idempotent; the socket survives navigation.
    useFleetStore.getState().connect();
  }, []);
  const sessions = useFleetStore((s) => s.sessions);
  // The dormant handshake (shared/api.ts's FLEET_PROTO_MIN): set by the fleet
  // store on an incompatible `hello`, cleared by a later compatible one.
  // BlockScreen mounts as a SIBLING before .app-shell, not inside it — a
  // banner lives in a pane; this has to cover panes, sheets and toasts alike.
  const blocked = useFleetStore((s) => s.blocked);
  const m = /^\/s\/([^/]+)\/?$/.exec(path);
  const sessionId = m ? decodeURIComponent(m[1]!) : null;
  const archive = /^\/archive\/?$/.test(path);
  const accounts = /^\/accounts\/?$/.test(path);
  // On desktop the accounts strip is a full-width top bar (rendered here, once);
  // on mobile it stays inside the fleet screen. useMediaQuery keeps it a single
  // instance either way — no duplication, no double polling.
  const desktop = useMediaQuery('(min-width: 900px)');
  return (
    <>
      {blocked && <BlockScreen />}
      <div className="app-shell" data-view={sessionId || archive || accounts ? 'session' : 'fleet'}>
        {desktop && (
          <div className="shell-accounts">
            <AccountsStrip />
          </div>
        )}
        <aside className="shell-nav">
          {/* Always mounted so it's the desktop sidebar; hidden on mobile when a
              session is open. selectedId marks the active card in the sidebar;
              showAccounts is false on desktop (they're in the top bar instead). */}
          <FleetScreen selectedId={sessionId} showAccounts={!desktop} />
        </aside>
        <section className="shell-detail">
          {sessionId ? (
            // key remounts per session so per-session UI state (terminal drawer,
            // pickers) never leaks across a sidebar switch.
            <SessionScreen key={sessionId} id={sessionId} />
          ) : archive ? (
            <ArchiveScreen sessions={sessions} onOpen={(id) => navigate(`/s/${id}`)} />
          ) : accounts ? (
            <AccountsScreen />
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
