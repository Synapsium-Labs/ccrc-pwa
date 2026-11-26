// Tiny path router shared by the shell (app.tsx) and screens. Lives outside
// app.tsx so screens can navigate without importing the shell (no cycles).
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { prefersReducedMotion } from '@ccrc/ui';
import { onPop } from './popstate';
import { reloadOnMove } from './swupdate';

/** document.startViewTransition, where the platform has it. */
type DocWithVT = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/** Programmatic navigation for screens/cards: pushState (or replaceState) + notify the router.
 *  Route changes ride a view transition when the platform supports it — the
 *  card→chat shared-element morph (the tapped card title carries
 *  `view-transition-name: session-title` into the chat header; timing lives
 *  in base.css on the ::view-transition pseudos). Reduced motion and older
 *  engines get the plain instant swap.
 *
 *  `href` is a path with an optional search (`/docs/p?ref=b`); a `#` fragment
 *  is outside this contract. `opts.replace: true` rewrites the current history
 *  entry (`replaceState`), so Back skips it; absent or `false` pushes a new
 *  one. Both ride the same view transition and the same `flushSync` dispatch
 *  of `popstate`: only the history call differs.
 *
 *  After a release, a pending reload runs here (console speed, Task C3): the gate in `swupdate.ts` is asked first,
 *  and when it loads `href` as a full page nothing is pushed, so the old build never draws the new screen.
 *
 *  `opts.from` names the address (path and search) the move leaves. With it the move lands only while the page is still
 *  there: it is checked when `navigate` is called and again when the history call runs, which a view transition defers
 *  to a later frame. So a move that waited never overwrites a navigation made meanwhile (Overlord W1 home, review 3319
 *  F1: the home's replace of `/` landed over the page a test or a tap had opened). */
export function navigate(href: string, opts?: { replace?: boolean; from?: string }): void {
  const still = (): boolean => opts?.from === undefined || read() === opts.from;
  if (!still()) return;
  if (reloadOnMove(href, opts?.replace === true)) return;
  const go = (): void => {
    if (!still()) return;
    if (opts?.replace === true) history.replaceState(null, '', href);
    else history.pushState(null, '', href);
    // flushSync so the new screen is in the DOM before the transition
    // captures its "new" snapshot (no-op for the non-transition path).
    flushSync(() => {
      dispatchEvent(new PopStateEvent('popstate'));
    });
  };
  const vt = (document as DocWithVT).startViewTransition?.bind(document);
  // `prefersReducedMotion` (@ccrc/ui), not a second spelling of the media
  // query: the design system already owns this question for its own
  // components, and the literal census found the copy that used to sit here.
  if (vt && !prefersReducedMotion()) vt(go);
  else go();
}

/** Where the app is. `path` is `location.pathname`; `search` is
 *  `location.search`: it includes its leading `?`, or is `''` when the URL has
 *  no query. */
export interface Loc { readonly path: string; readonly search: string }  // search includes '?', or ''
const read = (): string => location.pathname + location.search;

/** The current path and search, live across push, replace, back and forward
 *  (design 2026-10-01 section 4.2). One string in state, so a change of the
 *  search alone (`?ref=a` to `?ref=b`) re-renders; the memo hands out one
 *  object per location. `useState` + `popstate` (through `onPop`), never
 *  `useSyncExternalStore`: `navigate`'s `flushSync` and view-transition
 *  timing, and app-pane-reset-timing.test.tsx, rely on this mechanism. */
export function useLocation(): Loc {
  const [raw, setRaw] = useState(read);
  useEffect(() => {
    // Through the one dispatcher (`popstate.ts`), which asks the decider first: a pop that is a place's or the console's
    // own never reaches here. `navigate`'s own pop is the router's, so it still runs this before `navigate` returns.
    return onPop(() => setRaw(read()));
  }, []);
  return useMemo(() => {
    const q = raw.indexOf('?');          // a pathname cannot contain '?'
    return q < 0 ? { path: raw, search: '' } : { path: raw.slice(0, q), search: raw.slice(q) };
  }, [raw]);
}

/** Current location.pathname, live across push, replace, back and forward:
 *  the path half of `useLocation()`, so a search-only change re-renders its
 *  caller too. */
export function usePath(): string { return useLocation().path; }

/** Rewrite the current entry's fragment to `#id` without leaving the page: `history.replaceState` keeps the entry's
 *  `history.state` and its path and search, and the router is NOT notified, so the screen does not remount and the
 *  reader keeps its place (the W8a plan's refinement (n)). `id` is the frame's own anchor id, joined after `#` as it is. */
export function replaceFragment(id: string): void {
  history.replaceState(history.state, '', '#' + id);
}
