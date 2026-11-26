// L1, context C3 (Session Conversation): the `@overlord-place` mark's due-ness (Overlord W1 home B, plan w1-home.md question 4
// and Task 7, slug place-visible-rides-the-session-socket; ruled F3). Pure.
//
// The console's visible Overlord place reports itself over the session socket: a `{ type: 'visible', visible }` frame every
// 15 s. `placeMarkDue` rules on each one: only a visible frame, only of the session the designation binds, and at most once
// every `PLACE_MARK_EVERY_MS`, so the mark `OVERLORD_PLACE_MARK` stays younger than `BREAK_PLACE_HIDDEN_MS` while the place is
// on screen and ages when it is not (a closed socket, a hidden tab or a place the operator left sends no refresh).
//
// A designation or a mark that could not be read is `skip`, never `write`: the mark then ages, so a renewal may treat the
// place as hidden, which is the safe direction (a renewal at a break is the spec's design, and the hard rows still bound the
// context). A mark dated after `nowMs` (the wall clock stepped back) is refreshed at once, so it is never held stale until the
// clock catches up. The act, the reads and the clock are the caller's (`placeMarkReport.ts`); `nowMs` is an argument.
import { PLACE_MARK_EVERY_MS } from '../../../shared/continuity.js';

/** What the designation says: a session it binds, no session, or a read that failed (never folded into "no session"). */
export type PlaceBound = { readonly kind: 'bound'; readonly sessionId: string } | { readonly kind: 'not-designated' } | { readonly kind: 'unread' };

/** The mark's `at`, wall ms; `'absent'` when it has never been written; `'unread'` when the marks could not be read. */
export type PlaceMarkAt = number | 'absent' | 'unread';

export interface PlaceMarkFacts {
  /** The session whose socket carried the frame. */
  readonly frameSessionId: string;
  readonly visible: boolean;
  readonly bound: PlaceBound;
  readonly markAtMs: PlaceMarkAt;
  readonly nowMs: number;
}

/** Whether this frame refreshes the place mark. */
export function placeMarkDue(i: PlaceMarkFacts): 'write' | 'skip' {
  if (!i.visible) return 'skip';
  if (i.bound.kind === 'unread') return 'skip';
  if (i.bound.kind === 'not-designated') return 'skip';
  if (i.bound.sessionId !== i.frameSessionId) return 'skip';
  if (i.markAtMs === 'unread') return 'skip';
  if (i.markAtMs === 'absent') return 'write';
  return i.markAtMs <= i.nowMs && i.nowMs - i.markAtMs < PLACE_MARK_EVERY_MS ? 'skip' : 'write';
}
