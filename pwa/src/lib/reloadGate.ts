// The reload gate (console speed, Task C3; spec 2026-11-04 §2.5, D15): WHEN the open console moves onto a release
// that a new service worker has already taken over. The operator's ruling on item 33: "Reload when you next move
// between screens, never in the first seconds back."
//
// Pure: a reducer over the pending flag, the urgent flag and the time the page last became visible. `lib/swupdate.ts`
// holds the state and acts on the answer; nothing here touches the page.
//
// - A new worker's activation only marks a reload as pending (the plugin's own `location.reload()` is replaced by
//   `onNeedReload`, `main.tsx`).
// - A pending reload runs at the next move between screens, once the page has been visible for RELOAD_QUIET_MS.
// - Two cases reload at once, because the old build cannot go on: the block screen asked for a build (`urgent`), and a
//   lazy chunk failed to load while a reload is pending (the new worker dropped the old build's chunks).
import { matchRoute } from './routes';

/** "The first seconds back": a move this soon after the page became visible, or loaded visible, holds the reload. By
 *  then the update check has run and the link is live or being retried, and the operator has read what they came back
 *  for (spec §2.5). The coordinator's bound inside the operator's ruling. */
export const RELOAD_QUIET_MS = 15_000;

export interface ReloadState {
  /** A new worker took over and this page has not reloaded. */
  readonly pending: boolean;
  /** The block screen asked for a build (`requestUpdate`): reload as soon as a new worker is in. */
  readonly urgent: boolean;
  /** When the page last became visible (or loaded visible); null only while it is hidden. */
  readonly visibleSince: number | null;
}

export const RELOAD_IDLE: ReloadState = { pending: false, urgent: false, visibleSince: null };

/** `from` and `to` of a move are pathnames, with no search: a search-only change is the same path. */
export type ReloadEvent =
  | { readonly kind: 'activated' }
  | { readonly kind: 'urgent' }
  | { readonly kind: 'visible'; readonly at: number }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'move'; readonly from: string; readonly to: string }
  | { readonly kind: 'chunk-failed' };

/** The screen a path is on: the route `matchRoute` names and its parameter (`'<id> <param>'`, the parameter empty when
 *  the pattern captures none), or `'none'` for a path outside the table. A Docs page turn stays on one screen, because
 *  the `docs` route captures nothing. */
export function screenOf(path: string): string {
  const at = matchRoute(path);
  return at === null ? 'none' : `${at.route.id} ${at.param ?? ''}`;
}

/** Whether a move between `from` and `to` at `nowMs` runs a pending reload. */
function moveReloads(s: ReloadState, from: string, to: string, nowMs: number): boolean {
  if (!s.pending || s.visibleSince === null) return false;
  if (screenOf(from) === screenOf(to)) return false;
  return nowMs - s.visibleSince >= RELOAD_QUIET_MS;   // a negative age (a clock step back) holds
}

/** One event's answer: the next state, and whether the page reloads now. A step never clears `pending`: the reload
 *  ends the page. A hidden page never reloads, in any arm (the brief's rule): an urgent reload held while hidden runs
 *  on the return, and a pending one waits for a move. */
export function reloadStep(
  s: ReloadState, e: ReloadEvent, nowMs: number,
): { readonly state: ReloadState; readonly reload: boolean } {
  const visible = s.visibleSince !== null;
  switch (e.kind) {
    case 'activated': return { state: { ...s, pending: true }, reload: visible && s.urgent };
    case 'urgent': return { state: { ...s, urgent: true }, reload: visible && s.pending };
    case 'visible': return { state: { ...s, visibleSince: e.at }, reload: s.pending && s.urgent };
    case 'hidden': return { state: { ...s, visibleSince: null }, reload: false };
    case 'move': return { state: s, reload: moveReloads(s, e.from, e.to, nowMs) };
    case 'chunk-failed': return { state: s, reload: visible && s.pending };
  }
}
