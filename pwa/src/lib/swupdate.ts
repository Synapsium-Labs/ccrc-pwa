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
// loads the new path as a full page, and back and forward reload in place, at
// most once per page. Two probes beside `setUpdater`, registered by `main.tsx`,
// keep this module free of the stores: whether a send is unresolved (the move
// holds) and whether the block screen still stands.
import { onPageHidden, onPageRestored, onPageVisible, onWindowBlur, onWindowFocus } from './pageClock';
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
  /** A monotonic clock: a wall-clock step never moves the quiet window. */
  now(): number;
}

const PAGE_ACTS: ReloadActs = {
  reload: () => location.reload(),
  go: (href, replace) => (replace ? location.replace(href) : location.assign(href)),
  now: () => performance.now(),
};

let state: ReloadState = RELOAD_IDLE;
let acts: ReloadActs = PAGE_ACTS;
let stopGate: (() => void) | null = null;
let hold: (() => boolean) | null = null;
let blocked: (() => boolean) | null = null;

/** Whether a send is unresolved, so a full page load would drop it: a move holds while this answers true. */
export function setReloadHold(fn: () => boolean): void {
  hold = fn;
}

/** Whether the block screen still stands: once it answers false, the gate is no longer urgent. */
export function setBlockProbe(fn: () => boolean): void {
  blocked = fn;
}

/** Step the gate; true when the page reloads now. A block that has lifted is stepped first, as `calm`. */
function step(e: ReloadEvent): boolean {
  if (blocked !== null && !blocked()) state = reloadStep(state, { kind: 'calm' }, acts.now()).state;
  const next = reloadStep(state, e, acts.now());
  state = next.state;
  return next.reload;
}

/** A move from `from` to `to`, held while a send is unresolved. */
function stepMove(from: string, to: string): boolean {
  return step({ kind: 'move', from, to, held: hold?.() ?? false });
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
  if (!stepMove(location.pathname, to)) return false;
  acts.go(href, replace);
  return true;
}

/** Start the gate at boot, once: a page loaded visible counts its load as the return. The answer stops it, and a
 *  stopped gate never reloads. A test hands its own acts, or only some of them. */
export function startReloadGate(given: Partial<ReloadActs> = {}): () => void {
  if (stopGate !== null) return stopGate;
  acts = { ...PAGE_ACTS, ...given };
  if (document.visibilityState === 'visible') step({ kind: 'visible', at: acts.now() });
  if (!document.hasFocus()) step({ kind: 'blurred', at: acts.now() });
  const stopVisible = onPageVisible(() => {
    if (step({ kind: 'visible', at: acts.now() })) acts.reload();
  });
  const stopHidden = onPageHidden(() => { step({ kind: 'hidden' }); });
  const stopFocus = onWindowFocus(() => { step({ kind: 'focused', at: acts.now() }); });
  const stopBlur = onWindowBlur(() => { step({ kind: 'blurred', at: acts.now() }); });
  const stopRestored = onPageRestored(() => { step({ kind: 'restored', at: acts.now() }); });
  // Back and forward: the browser has already moved the path, so a reload loads the new one (the router may draw the
  // new path in this build until the page unloads). `navigate`'s own `popstate` after a push the gate allowed asks the
  // same move again; once any reload has been answered, the latch answers no, so no second reload follows.
  let lastPath = location.pathname;
  const onPop = (): void => {
    const from = lastPath;
    lastPath = location.pathname;
    if (stepMove(from, lastPath)) acts.reload();
  };
  addEventListener('popstate', onPop);
  const stop = (): void => {
    stopVisible();
    stopHidden();
    stopFocus();
    stopBlur();
    stopRestored();
    removeEventListener('popstate', onPop);
    state = { ...state, visibleSince: null };
    if (stopGate === stop) stopGate = null;
  };
  stopGate = stop;
  return stop;
}

/** Tests only: stop the gate and forget its state, acts and probes. */
export function resetReloadGateForTests(): void {
  stopGate?.();
  stopGate = null;
  state = RELOAD_IDLE;
  acts = PAGE_ACTS;
  hold = null;
  blocked = null;
}
