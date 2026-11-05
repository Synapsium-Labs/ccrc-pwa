// The reload gate (console speed, Task C3; spec 2026-11-04 §2.5, D15): WHEN the open console moves onto a release
// that a new service worker has already taken over. The operator's ruling on item 33: "Reload when you next move
// between screens, never in the first seconds back."
//
// Pure: a reducer over the pending flag, the urgent flag, the time the page last came back, and the latch.
// `lib/swupdate.ts` holds the state and acts on the answer; nothing here touches the page.
//
// - A new worker's activation only marks a reload as pending (the plugin's own `location.reload()` is replaced by
//   `onNeedReload`, `main.tsx`).
// - A pending reload runs at the next move between screens, once the page has been back for RELOAD_QUIET_MS, and
//   never while a send is unresolved (the move arrives `held`).
// - "Back" is the page turning visible, loading visible, regaining window focus after the window was away for at
//   least RELOAD_QUIET_MS, or being restored from the back-forward cache.
// - A move reload counts once the page has been back for at least RELOAD_QUIET_MS (the boundary is inclusive).
// - One case reloads at once, because the old build cannot go on: the block screen asked for a build (`urgent`), and
//   only while the block stands (`calm` lowers it). A failed lazy chunk does not reload: the screen draws its own
//   fallback with a Reload door.
// - The latch: once the gate has answered reload, every later event answers no, for the rest of the page. A restore
//   from the back-forward cache is a page again on the old build: it clears the latch, restarts the window and keeps
//   `pending`, so the first move at least RELOAD_QUIET_MS later reloads onto the new build.
import { matchRoute } from './routes';

/** "The first seconds back": a move this soon after the page came back holds the reload. By then the update check has
 *  run and the link is live or being retried, and the operator has read what they came back for (spec §2.5). The
 *  coordinator's bound inside the operator's ruling. */
export const RELOAD_QUIET_MS = 15_000;

export interface ReloadState {
  /** A new worker took over and this page has not reloaded. */
  readonly pending: boolean;
  /** The block screen asked for a build (`requestUpdate`) and the block still stands: reload as soon as a new worker
   *  is in. */
  readonly urgent: boolean;
  /** When the page last came back (turned visible, loaded visible, or regained focus after a long blur), on a
   *  monotonic clock; null only while it is hidden. */
  readonly visibleSince: number | null;
  /** When the window last lost focus; null while it has focus. */
  readonly blurredSince: number | null;
  /** The gate has answered reload once on this page: it never answers it again. */
  readonly reloading: boolean;
}

export const RELOAD_IDLE: ReloadState = {
  pending: false, urgent: false, visibleSince: null, blurredSince: null, reloading: false,
};

/** `from` and `to` of a move are pathnames, with no search: a search-only change is the same path. `held` says a send
 *  is unresolved (in flight, or failed and showing Retry), which a full page load would drop. */
export type ReloadEvent =
  | { readonly kind: 'activated' }
  | { readonly kind: 'urgent' }
  | { readonly kind: 'calm' }
  | { readonly kind: 'visible'; readonly at: number }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'blurred'; readonly at: number }
  | { readonly kind: 'focused'; readonly at: number }
  | { readonly kind: 'restored'; readonly at: number }
  | { readonly kind: 'move'; readonly from: string; readonly to: string; readonly held: boolean };

/** The screen a path is on: the route `matchRoute` names and its parameter (`'<id> <param>'`, the parameter empty when
 *  the pattern captures none), or `'none'` for a path outside the table. A Docs page turn stays on one screen, because
 *  the `docs` route captures nothing. */
export function screenOf(path: string): string {
  const at = matchRoute(path);
  return at === null ? 'none' : `${at.route.id} ${at.param ?? ''}`;
}

/** Whether a move between `from` and `to` at `nowMs` runs a pending reload. */
function moveReloads(s: ReloadState, from: string, to: string, held: boolean, nowMs: number): boolean {
  if (!s.pending || s.visibleSince === null || held) return false;
  if (screenOf(from) === screenOf(to)) return false;
  return nowMs - s.visibleSince >= RELOAD_QUIET_MS;   // a negative age (a clock step back) holds
}

/** Focus regained: back when the window was away for at least the quiet window, and the page is visible. */
function focused(s: ReloadState, at: number): ReloadState {
  const away = s.blurredSince !== null && at - s.blurredSince >= RELOAD_QUIET_MS;
  return { ...s, blurredSince: null, visibleSince: away && s.visibleSince !== null ? at : s.visibleSince };
}

/** One event's answer before the latch. A hidden page never reloads, in any arm (the brief's rule): an urgent reload
 *  held while hidden runs on the return, and a pending one waits for a move. */
function decide(s: ReloadState, e: ReloadEvent, nowMs: number): { readonly state: ReloadState; readonly reload: boolean } {
  const visible = s.visibleSince !== null;
  switch (e.kind) {
    case 'activated': return { state: { ...s, pending: true }, reload: visible && s.urgent };
    case 'urgent': return { state: { ...s, urgent: true }, reload: visible && s.pending };
    case 'calm': return { state: { ...s, urgent: false }, reload: false };
    case 'visible': return { state: { ...s, visibleSince: e.at }, reload: s.pending && s.urgent };
    case 'hidden': return { state: { ...s, visibleSince: null }, reload: false };
    case 'blurred': return { state: { ...s, blurredSince: s.blurredSince ?? e.at }, reload: false };
    case 'focused': return { state: focused(s, e.at), reload: false };
    case 'move': return { state: s, reload: moveReloads(s, e.from, e.to, e.held, nowMs) };
    case 'restored': return { state: s, reload: false };   // answered by reloadStep, before the latch
  }
}

/** One event's answer: the next state, and whether the page reloads now. A step never clears `pending`: the reload
 *  ends the page. Once a step has answered reload, the latch answers no to every later one; the state still tracks
 *  the page. */
export function reloadStep(
  s: ReloadState, e: ReloadEvent, nowMs: number,
): { readonly state: ReloadState; readonly reload: boolean } {
  if (e.kind === 'restored') {
    return { state: { ...s, reloading: false, visibleSince: e.at, blurredSince: null }, reload: false };
  }
  const r = decide(s, e, nowMs);
  if (s.reloading) return { state: r.state, reload: false };
  return r.reload ? { state: { ...r.state, reloading: true }, reload: true } : r;
}
