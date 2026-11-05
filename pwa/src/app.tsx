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
import { Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { BlockScreen } from './components/BlockScreen';
import { LoginScreen } from './components/LoginScreen';
import { RenderBoundary, ScreenFallback } from './components/RenderBoundary';
import { ToastHost } from '@ccrc/ui';
import { CommandLayer } from './command/CommandLayer';
import { FleetChromeProvider } from './fleet/FleetChrome';
import { FleetFlows, useFleetFlows } from './fleet/FleetFlows';
import { useAuthLost } from './lib/auth';
import { lazyScreen, preloadWhenIdle } from './lib/lazyScreen';
import { navigate, useLocation } from './lib/router';
import { matchRoute, sessionPath, shellViewOf } from './lib/routes';
import { useSkin } from './lib/skin';
import { AuthResumeInDetail } from './accounts/AuthResumeBanner';
import { ArchiveScreen } from './screens/ArchiveScreen';
import { DocsScreen } from './screens/DocsScreen';
import { MailScreen } from './screens/MailScreen';
import { SettingsDataProvider } from './screens/settings/SettingsDataProvider';
// THE BIG SCREENS LOAD ON DEMAND (console speed, task C1 "the link and the start"; spec 2026-11-04 §2.3): each is its
// own chunk, fetched the first time its route opens, so the fleet list starts without them. The fleet, the shell, Mail,
// Archive, Docs, the programme and the Waiting routes stay in the entry. `SettingsDataProvider` stays eager: it wraps
// the whole shell on every route (D-5504), so a lazy provider would hold the frame at start-up and defer nothing.
// `lazyScreen` (not React's `lazy`): a chunk that failed to load is asked for once more on the next navigation, which
// recovers only where the engine fetches a failed module again (Chromium does not: it rejects with no request), so
// the fallback's Reload is the recovery there (review 1473 F1).
const AccountsScreen = lazyScreen(() => import('./screens/AccountsScreen').then((m) => m.AccountsScreen));
const DigestScreen = lazyScreen(() => import('./screens/DigestScreen').then((m) => m.DigestScreen));
const HighlightMeasure = lazyScreen(() => import('./screens/HighlightMeasure').then((m) => m.HighlightMeasure));
const ReaderLab = lazyScreen(() => import('./screens/ReaderLab').then((m) => m.ReaderLab));
const RunsScreen = lazyScreen(() => import('./screens/RunsScreen').then((m) => m.RunsScreen));
const SessionScreen = lazyScreen(() => import('./screens/SessionScreen').then((m) => m.SessionScreen));
const SettingsScreen = lazyScreen(() => import('./screens/settings/SettingsFrame').then((m) => m.SettingsScreen));
import { ProgrammeScreen } from './ledgers/ProgrammeScreen';
import { ItemListColumn, ItemRouteAt, WaitingRoute } from './ledgers/WaitingRoutes';
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

/** `/archive`: the one arm of the ladder that reads the fleet's rows, so it is the one that subscribes to them (C6). */
function ArchiveRoute(): ReactNode {
  const sessions = useFleetStore((s) => s.sessions);
  return <ArchiveScreen sessions={sessions} onOpen={(id) => navigate(sessionPath(id))} />;
}

export function App(): ReactNode {
  const { path, search } = useLocation();
  // The session screen is the one most often opened next: its chunk loads once the page is idle after the first
  // paint, and once loaded the first open draws it in the first commit, with no loading line (reviews 1464 F4 and 1473
  // F3). The entry's imports are unchanged.
  useEffect(() => preloadWhenIdle(SessionScreen), []);
  useEffect(() => {
    // The fleet stream is the app's heartbeat: connect once at the shell so
    // deep links to /s/:id (or /archive) still get live names, limits and
    // dialog badges. connect() is idempotent; the socket survives navigation.
    useFleetStore.getState().connect();
  }, []);
  // The shell holds no subscription to `sessions` (C6, D-6438): a fleet frame that changes one row re-renders the
  // readers of that row, not the frame, the ladder and every sibling mounted here. `/archive` subscribes locally.
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
  const view = shellViewOf(path);
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
  // scrollable, and on every route but one its content does not swap — it is
  // the same fleet list before and after. Resetting it would throw away the
  // operator's place in that list every time they opened a session, which is a
  // regression, not a fix. The one exception is the Waiting on you item route
  // on a desk (plan PL9), whose nav slot draws the list the item was opened
  // from in place of the fleet (`ItemListColumn`, below); entering and leaving
  // that route remounts the fleet column, so its scroll is not kept across an
  // item visit (departure pl9-fleet-column-remounts).
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
  // A lazy screen's chunk loads under one Suspense, inside the boundary: while it loads the pane says so, and a chunk
  // that fails to load throws into the boundary, which draws its fallback rather than a blank pane.
  const loading = (screen: ReactNode): ReactNode => (
    <Suspense fallback={<p className="shell-placeholder-copy" role="status">Loading…</p>}>{screen}</Suspense>
  );
  const ladder = sessionId !== null ? loading(
    // key remounts per session so per-session UI state (terminal drawer,
    // pickers) never leaks across a sidebar switch.
    <SessionScreen key={sessionId} id={sessionId} />
  ) : route === 'archive' ? (
    <ArchiveRoute />
  ) : route === 'accounts' ? loading(
    <AccountsScreen />
  ) : route === 'inbox' ? (
    <MailScreen />
  ) : route === 'runs' ? loading(
    <RunsScreen />
  ) : settings ? loading(
    <SettingsScreen />
  ) : route === 'digest' ? loading(
    <DigestScreen day={digestDay} />
  ) : route === 'measure-highlighting' ? loading(
    <HighlightMeasure />
  ) : route === 'reader-lab' ? loading(
    <ReaderLab />
  ) : route === 'docs' ? (
    // NOT keyed: one mount spans one Docs visit (its listings, its auto-refresh set, its image queue), across every
    // page, ref and view the visit opens.
    <DocsScreen path={path} search={search} />
  ) : route === 'waiting' ? (
    <WaitingRoute />
  ) : route === 'item' ? (
    <ItemRouteAt param={at!.param} />
  ) : route === 'programme' ? (
    // Keyed by the slug: one programme's Goals read never shows under another's name. A slug the server would refuse
    // (`shapeProgramSlug`) matches no route (the row's `accepts`), so it is an unknown path: the placeholder below on a
    // desk, and the fleet on a phone, where `shellViewOf` answers `fleet` for it (carry C, D-7951; review 1388 F1).
    <ProgrammeScreen key={at!.param} slug={at!.param!} />
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
      <ShellFrame set={set} view={view} detailRef={detail}
                  {...(route === 'item' ? { nav: (fleet: ReactNode) => <ItemListColumn param={at!.param} fleet={fleet} /> } : {})}>
        {/* THE RESUME BANNER ON EVERY ROUTE (accounts plan Task A23, D-7871 (3); spec §6.2): a sign-in this session
            started that waits for its code. The fleet's banner stack shows it on a desk and on a phone's fleet view;
            here, the top of the detail pane, on a phone's other views, so one instance is on screen at a time. */}
        <AuthResumeInDetail view={view} />
        <RenderBoundary where="detail" resetKey={path + search} fallback={(e) => <ScreenFallback error={e} />}>{ladder}</RenderBoundary>
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
