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
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { BlockScreen } from './components/BlockScreen';
import { LoginScreen } from './components/LoginScreen';
import { ToastHost } from './components/Toast';
import { AccountsStrip } from './fleet/AccountsStrip';
import { useAuthLost } from './lib/auth';
import { navigate, usePath } from './lib/router';
import { useMediaQuery } from './lib/useMediaQuery';
import { AccountsScreen } from './screens/AccountsScreen';
import { ArchiveScreen } from './screens/ArchiveScreen';
import { FleetScreen } from './screens/FleetScreen';
import { MailScreen } from './screens/MailScreen';
import { RunsScreen } from './screens/RunsScreen';
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
  // The session gate's signal (lib/auth.ts): set by the ONE 401 branch in the
  // api funnel, or by a websocket that asked why its upgrade was refused. Same
  // sibling mount as BlockScreen, for the same reason, and rendered BEFORE it so
  // that when both are up the block screen is the one on top — a build too old
  // to speak the fleet protocol cannot be fixed by signing in.
  //
  // With `CCRC_AUTH` off this can never be true: nothing on a dark box produces
  // an auth refusal, and `raiseAuthLostFrom` demands positive evidence of one.
  const { lost: authLost } = useAuthLost();
  const m = /^\/s\/([^/]+)\/?$/.exec(path);
  const sessionId = m ? decodeURIComponent(m[1]!) : null;
  const archive = /^\/archive\/?$/.test(path);
  const accounts = /^\/accounts\/?$/.test(path);
  const mail = /^\/mail\/?$/.test(path);
  const runs = /^\/runs\/?$/.test(path);
  // On desktop the accounts strip is a full-width top bar (rendered here, once);
  // on mobile it stays inside the fleet screen. useMediaQuery keeps it a single
  // instance either way — no duplication, no double polling.
  const desktop = useMediaQuery('(min-width: 900px)');
  // A ROUTE CHANGE PUTS THE DETAIL PANE BACK AT THE TOP (D-161).
  //
  // `.shell-detail` is ONE persistent DOM node whose CHILDREN swap per route
  // (the ternary below is inside it), so React reconciles the contents and
  // leaves the pane's own scroll offset exactly where the last screen left it.
  // Before D-161 gave the pane a scroll region that offset was always 0 and
  // this could not happen; now /mail → /runs lands mid-list, with the new
  // screen's <h1> and its Back button above the fold. Measured: scrolled to
  // 2517, children replaced, still 2517.
  //
  // A LAYOUT effect, not a passive one: this runs in the same commit that put
  // the new screen in the pane, before the browser paints, so the operator
  // never sees the new screen at the old offset. `popstate` (back/forward)
  // goes through `usePath`, so it is covered by the same dependency.
  //
  // THE SIDEBAR IS DELIBERATELY LEFT ALONE. `.shell-nav` has always been
  // scrollable, and its content does NOT swap per route — it is the same fleet
  // list before and after. Resetting it would throw away the operator's place
  // in that list every time they opened a session, which is a regression, not
  // a fix.
  const detail = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const pane = detail.current;
    // Null only if the shell has not mounted; on mobile the document scrolls
    // rather than this pane, so the write is a harmless no-op there.
    if (pane !== null) pane.scrollTop = 0;
  }, [path]);
  return (
    <>
      {authLost && <LoginScreen />}
      {blocked && <BlockScreen />}
      <div className="app-shell" data-view={sessionId || archive || accounts || mail || runs ? 'session' : 'fleet'}>
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
        <section className="shell-detail" ref={detail}>
          {sessionId ? (
            // key remounts per session so per-session UI state (terminal drawer,
            // pickers) never leaks across a sidebar switch.
            <SessionScreen key={sessionId} id={sessionId} />
          ) : archive ? (
            <ArchiveScreen sessions={sessions} onOpen={(id) => navigate(`/s/${id}`)} />
          ) : accounts ? (
            <AccountsScreen />
          ) : mail ? (
            <MailScreen />
          ) : runs ? (
            <RunsScreen />
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
