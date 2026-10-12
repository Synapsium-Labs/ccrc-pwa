// Tiny path router shared by the shell (app.tsx) and screens. Lives outside
// app.tsx so screens can navigate without importing the shell (no cycles).
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';

/** document.startViewTransition, where the platform has it. */
type DocWithVT = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/** Programmatic navigation for screens/cards: pushState + notify the router.
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
 *  of `popstate`: only the history call differs. */
export function navigate(href: string, opts?: { replace?: boolean }): void {
  const go = (): void => {
    if (opts?.replace === true) history.replaceState(null, '', href);
    else history.pushState(null, '', href);
    // flushSync so the new screen is in the DOM before the transition
    // captures its "new" snapshot (no-op for the non-transition path).
    flushSync(() => {
      dispatchEvent(new PopStateEvent('popstate'));
    });
  };
  const vt = (document as DocWithVT).startViewTransition?.bind(document);
  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (vt && !reduced) vt(go);
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
 *  object per location. `useState` + `popstate`, never
 *  `useSyncExternalStore`: `navigate`'s `flushSync` and view-transition
 *  timing, and app-pane-reset-timing.test.tsx, rely on this mechanism. */
export function useLocation(): Loc {
  const [raw, setRaw] = useState(read);
  useEffect(() => {
    const on = (): void => setRaw(read());
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
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
