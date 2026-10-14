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
import { RenderBoundary, ScreenFallback } from './components/RenderBoundary';
import { ToastHost } from './components/Toast';
import { AccountsStrip } from './fleet/AccountsStrip';
import { useAuthLost } from './lib/auth';
import { navigate, useLocation } from './lib/router';
import { useMediaQuery } from './lib/useMediaQuery';
import { AccountsScreen } from './screens/AccountsScreen';
import { ArchiveScreen } from './screens/ArchiveScreen';
import { DocsScreen } from './screens/DocsScreen';
import { FleetScreen } from './screens/FleetScreen';
import { MailScreen } from './screens/MailScreen';
import { RunsScreen } from './screens/RunsScreen';
import { SessionScreen } from './screens/SessionScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useFleetStore } from './stores/fleet';
import './styles/shell.css';

export { navigate } from './lib/router';

export function App(): ReactNode {
  const { path, search } = useLocation();
  useEffect(() => {
    // The fleet stream is the app's heartbeat: connect once at the shell so
    // deep links to /s/:id (or /archive) still get live names, limits and
    // dialog badges. connect() is idempotent; the socket survives navigation.
    useFleetStore.getState().connect();
  }, []);
  const sessions = useFleetStore((s) => s.sessions);
  // T9-R2 (coordinator ruling closing a Task 9 review gap): FleetScreen's
  // `epoch`/`observedEpoch` props were fully tested but had no producer — this
  // was the ONE place `<FleetScreen>` renders, and it passed neither, so a
  // tested component could never actually render in production. The `pools`
  // frame is the existing carrier (no second poll, no new route call): `?.`
  // preserves THE THREE-VALUED RULE at this hop too — `pools === null` (no
  // frame has arrived yet) and a `pools` object simply missing the key both
  // read as `undefined`, exactly like an absent key on the wire itself, and
  // `pools.observedEpoch === null` (never synced) passes through unchanged.
  const pools = useFleetStore((s) => s.pools);
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
  const settings = /^\/settings\/?$/.test(path);
  // Docs (design 2026-10-01 section 4.2): `/docs` and every page under it, never `/docsearch`, so the pattern is
  // `/docs` followed by a slash or the end, not a bare prefix.
  const docs = new RegExp('^/docs(?:/|$)').test(path);
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
  // A LAYOUT effect, not a passive one: the reset runs INSIDE the commit that
  // put the new screen in the pane, before any passive effect of that commit.
  // MEASURED, in app-pane-reset-timing.test.tsx — a screen mounted into the
  // pane reads the offset from its own `useEffect` and gets 0; the moment this
  // becomes `useEffect` it reads 2517 instead, because passive effects run
  // child-before-parent. None of app.test.tsx's twelve can see that swap:
  // `navigate` wraps the path change in `flushSync`, which flushes passive
  // effects too, so the whole-commit view of the two spellings is identical
  // there. What is NOT measured is the last step — that the browser gets no
  // chance to paint between the commit and the passive flush, which is the
  // platform's definition of a layout effect. That one is REASONED: jsdom does
  // no layout and paints nothing, so no test in this package can observe a
  // frame, and a real-browser runner is not on this branch.
  // `popstate` (back/forward) goes through `useLocation`, so it is covered by
  // the same dependencies; a change of the search alone is a new page too.
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
  }, [path, search]);
  // THE DETAIL LADDER, behind its own RenderBoundary (design 2026-10-01
  // section 4.12). Rendered INSIDE `.shell-detail` below, so a screen that
  // throws while rendering shows "This screen could not be shown." in the pane
  // while `.shell-nav`, the login overlay, the block screen and the toasts,
  // all outside it, stay mounted. Its reset key is `path + search`, so any
  // navigation draws the ladder again; it is not a React `key`, so it never
  // remounts a screen and the pane reset above stays the shell's.
  const ladder = sessionId ? (
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
  ) : settings ? (
    <SettingsScreen />
  ) : docs ? (
    // NOT keyed: one mount spans one Docs visit (its listings, its auto-refresh set, its image queue), across every
    // page, ref and view the visit opens.
    <DocsScreen path={path} search={search} />
  ) : (
    <div className="shell-placeholder">
      <p className="shell-placeholder-mark" aria-hidden="true">
        ❯
      </p>
      <p className="shell-placeholder-copy">Select a session</p>
    </div>
  );
  return (
    <>
      {authLost && <LoginScreen />}
      {blocked && <BlockScreen />}
      <div className="app-shell" data-view={sessionId || archive || accounts || mail || runs || settings || docs ? 'session' : 'fleet'}>
        {desktop && (
          <div className="shell-accounts">
            <AccountsStrip />
          </div>
        )}
        <aside className="shell-nav">
          {/* Always mounted so it's the desktop sidebar; hidden on mobile when a
              session is open. selectedId marks the active card in the sidebar;
              showAccounts is false on desktop (they're in the top bar instead). */}
          <FleetScreen
            selectedId={sessionId}
            showAccounts={!desktop}
            epoch={pools?.epoch}
            observedEpoch={pools?.observedEpoch}
          />
        </aside>
        <section className="shell-detail" ref={detail}>
          <RenderBoundary where="detail" resetKey={path + search} fallback={() => <ScreenFallback />}>{ladder}</RenderBoundary>
        </section>
      </div>
      <ToastHost />
    </>
  );
}
