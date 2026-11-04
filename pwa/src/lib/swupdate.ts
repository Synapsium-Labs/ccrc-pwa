// Tiny indirection between "something decided the build is too old" (the
// fleet store, on an incompatible `hello`) and "how to actually check for a
// new one" (the SW registration `main.tsx` holds). Neither side should know
// the other exists: the store has no business importing `virtual:pwa-register`
// just to react to a WS frame, and a store test has no service worker to
// register. `setUpdater` is called once real registration lands; before that
// (dev, tests, a registration that never resolved) `requestUpdate` asks no
// check — the block screen's manual Reload button is the fallback for exactly that.
//
// It also holds the pending reload after a release (console speed, Task C3;
// spec 2026-11-04 §2.5, D15): the operator's ruling on item 33, "Reload when
// you next move between screens, never in the first seconds back". The new
// worker's activation (`noteActivated`, handed to `registerSW` as
// `onNeedReload`) only marks a reload as pending; `lib/reloadGate.ts` decides
// when it runs, and this module acts on its answer: a move through `navigate`
// loads the new path as a full page, back and forward reload in place, and a
// failed lazy chunk while a reload is pending reloads at once.
import { onPageHidden, onPageVisible } from './pageClock';
import { RELOAD_IDLE, reloadStep, type ReloadEvent, type ReloadState } from './reloadGate';

let updater: (() => void) | null = null;

export function setUpdater(fn: () => void): void {
  updater = fn;
}

/** The block screen's ask: check for a build now, and reload as soon as a new worker is in. */
export function requestUpdate(): void {
  updater?.();
  if (step({ kind: 'urgent' })) acts.reload();
}

/** What the gate does to the page; a test hands its own, with its own clock. */
export interface ReloadActs {
  reload(): void;
  /** A full page load of `href`, replacing the current history entry when `replace`. */
  go(href: string, replace: boolean): void;
  now(): number;
}

const PAGE_ACTS: ReloadActs = {
  reload: () => location.reload(),
  go: (href, replace) => (replace ? location.replace(href) : location.assign(href)),
  now: () => Date.now(),
};

let state: ReloadState = RELOAD_IDLE;
let acts: ReloadActs = PAGE_ACTS;
let stopGate: (() => void) | null = null;

/** Step the gate; true when the page reloads now. */
function step(e: ReloadEvent): boolean {
  const next = reloadStep(state, e, acts.now());
  state = next.state;
  return next.reload;
}

/** A new worker took over this page (`registerSW`'s `onNeedReload`): a reload is pending. */
export function noteActivated(): void {
  if (step({ kind: 'activated' })) acts.reload();
}

/** `navigate`'s question before it pushes: true when the gate loaded `href` as a full page instead, so the caller
 *  pushes nothing. `href` is a path with an optional search; the move is between pathnames. */
export function reloadOnMove(href: string, replace: boolean): boolean {
  const q = href.indexOf('?');
  const to = q < 0 ? href : href.slice(0, q);
  if (!step({ kind: 'move', from: location.pathname, to })) return false;
  acts.go(href, replace);
  return true;
}

/** Start the gate at boot, once: a page loaded visible counts its load as the return. The answer stops it. */
export function startReloadGate(given: ReloadActs = PAGE_ACTS): () => void {
  if (stopGate !== null) return stopGate;
  acts = given;
  if (document.visibilityState === 'visible') step({ kind: 'visible', at: acts.now() });
  const stopVisible = onPageVisible(() => {
    if (step({ kind: 'visible', at: acts.now() })) acts.reload();
  });
  const stopHidden = onPageHidden(() => { step({ kind: 'hidden' }); });
  // Back and forward: the browser has already moved the path, so a reload loads the new one. `navigate`'s own
  // `popstate` after a push it was allowed is the same move asked again, with the same answer.
  let lastPath = location.pathname;
  const onPop = (): void => {
    const from = lastPath;
    lastPath = location.pathname;
    if (step({ kind: 'move', from, to: lastPath })) acts.reload();
  };
  // A lazy chunk that fails while a reload is pending: the new worker dropped the old build's chunks, so reload now.
  // With nothing pending the event is left alone, and the screen's boundary draws its fallback.
  const onChunkFailed = (ev: Event): void => {
    if (!step({ kind: 'chunk-failed' })) return;
    ev.preventDefault();
    acts.reload();
  };
  addEventListener('popstate', onPop);
  addEventListener('vite:preloadError', onChunkFailed);
  const stop = (): void => {
    stopVisible();
    stopHidden();
    removeEventListener('popstate', onPop);
    removeEventListener('vite:preloadError', onChunkFailed);
    if (stopGate === stop) stopGate = null;
  };
  stopGate = stop;
  return stop;
}

/** Tests only: stop the gate and forget its state and acts. */
export function resetReloadGateForTests(): void {
  stopGate?.();
  stopGate = null;
  state = RELOAD_IDLE;
  acts = PAGE_ACTS;
}
