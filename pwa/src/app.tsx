// Router shell. The routes are `lib/routes.ts`'s table (D-5466): `/` is the
// fleet, and every other route fills the detail pane. On phones this is a
// full-screen swap (one pane at a time); on desktop it's a two-pane
// master–detail — the fleet as a persistent sidebar beside the active detail
// pane (styles/shell.css does the responsive layout, the same DOM serves
// both). Every non-fleet route shares the SAME detail slot and the SAME
// [data-view] swap — CSS never learned a third state, it only needs to know
// "fleet" vs "something else is in the detail pane".
//
// THE ONE BRANCH ON THE SKIN (D-5469): `SKIN_SETS[useSkin()]` here and nowhere
// else in shared code (`skin-identity.test.ts` (m) and (o)). The skin chooses
// the frame's parts; the frame itself, and everything mounted above it — the
// fleet chrome and its flows, the command layer (D-5467), the login and block
// screens and the toasts — is the same element in both skins, so a switch
// remounts none of it (`skin-switch.test.tsx`).
// ToastHost mounts here so stores/screens can fire toasts from anywhere.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { BlockScreen } from './components/BlockScreen';
import { LoginScreen } from './components/LoginScreen';
import { RenderBoundary, ScreenFallback } from './components/RenderBoundary';
import { ToastHost } from '@ccrc/ui';
import { CommandLayer } from './command/CommandLayer';
import { FleetChromeProvider } from './fleet/FleetChrome';
import { FleetFlows, useFleetFlows } from './fleet/FleetFlows';
import { useAuthLost } from './lib/auth';
import { navigate, useLocation } from './lib/router';
import { matchRoute } from './lib/routes';
import { useSkin } from './lib/skin';
import { AccountsScreen } from './screens/AccountsScreen';
import { ArchiveScreen } from './screens/ArchiveScreen';
import { DigestScreen } from './screens/DigestScreen';
import { DocsScreen } from './screens/DocsScreen';
import { MailScreen } from './screens/MailScreen';
import { RunsScreen } from './screens/RunsScreen';
import { SessionScreen } from './screens/SessionScreen';
import { SettingsDataProvider } from './screens/settings/SettingsDataProvider';
import { SettingsScreen } from './screens/settings/SettingsFrame';
import { ShellFrame } from './skins/frame';
import { SKIN_SETS } from './skins';
import { useFleetStore } from './stores/fleet';
import './styles/shell.css';

export { navigate } from './lib/router';

/** The command layer under the fleet chrome, so "New session" runs the fleet
 *  flows' own door (D-5468). */
function ShellCommands(): ReactNode {
  return <CommandLayer openNewSession={useFleetFlows().openNewSession} />;
}

export function App(): ReactNode {
  const { path, search } = useLocation();
  useEffect(() => {
    // The fleet stream is the app's heartbeat: connect once at the shell so
    // deep links to /s/:id (or /archive) still get live names, limits and
    // dialog badges. connect() is idempotent; the socket survives navigation.
    useFleetStore.getState().connect();
  }, []);
  const sessions = useFleetStore((s) => s.sessions);
  // T9-R2's pools wiring (the epoch and observedEpoch FleetScreen shows) moved
  // with the fleet column into `screens/FleetColumn.tsx`.
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
  // The ladder's one source of routes (D-5466): a path outside the table is
  // the fleet's placeholder, never a screen the table does not name.
  const at = matchRoute(path);
  const route = at?.route.id ?? null;
  const sessionId = route === 'session' ? at!.param : null;
  // `/settings`, a section page, or an id that names none (D-5504): every one is Settings, never the fallback.
  const settings = route === 'settings' || (route?.startsWith('settings-') ?? false);
  // `/digest?day=YYYY-MM-DD` (D-5300): the screen validates nothing about
  // `day` itself: the server answers 400 for a day that is not a UTC date.
  const digestDay = route === 'digest' ? new URLSearchParams(search).get('day') : null;
  const set = SKIN_SETS[useSkin()];
  // A ROUTE CHANGE PUTS THE DETAIL PANE BACK AT THE TOP (D-161).
  //
  // `.shell-detail` is ONE persistent DOM node (the frame's keyed `detail`
  // child, the same node in both skins) whose CHILDREN swap per route
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
  const ladder = sessionId !== null ? (
    // key remounts per session so per-session UI state (terminal drawer,
    // pickers) never leaks across a sidebar switch.
    <SessionScreen key={sessionId} id={sessionId} />
  ) : route === 'archive' ? (
    <ArchiveScreen sessions={sessions} onOpen={(id) => navigate(`/s/${id}`)} />
  ) : route === 'accounts' ? (
    <AccountsScreen />
  ) : route === 'inbox' ? (
    <MailScreen />
  ) : route === 'runs' ? (
    <RunsScreen />
  ) : settings ? (
    <SettingsScreen />
  ) : route === 'digest' ? (
    <DigestScreen day={digestDay} />
  ) : route === 'docs' ? (
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
  // The fleet's polls and sheets sit ABOVE the shell (D-5468): one health, updates and projects poll for every
  // reader, and the five fleet sheets rendered by `FleetFlows` beside `.app-shell`, so a fleet list that remounts
  // never closes a sheet it opened.
  // SETTINGS' READS, MADE ONCE (D-5504): the provider wraps the whole shell on EVERY route and reads only while
  // `active`. Mounted only on Settings routes it would change the tree above `.app-shell`, so the frame would
  // remount on each entry and exit, losing the sidebar's scroll (D-161) and the detail node (D-5466).
  return (
    <FleetChromeProvider store={useFleetStore}>
      <SettingsDataProvider active={settings}>
      {authLost && <LoginScreen />}
      {blocked && <BlockScreen />}
      <ShellFrame set={set} view={route === null || route === 'fleet' ? 'fleet' : 'session'} detailRef={detail}>
        <RenderBoundary where="detail" resetKey={path + search} fallback={() => <ScreenFallback />}>{ladder}</RenderBoundary>
      </ShellFrame>
      <FleetFlows />
      {/* The ⌘K palette, the shortcut sheet and the global keys (D-5103),
          above the frame so a skin switch keeps an open palette (D-5467). */}
      <ShellCommands />
      <ToastHost />
      </SettingsDataProvider>
    </FleetChromeProvider>
  );
}
// measurement touch
