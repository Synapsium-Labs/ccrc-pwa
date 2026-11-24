// What the chat list does when its height changes (desktop polish wave 168; review 3450 F5, review 3478 F5, F6 and A8).
// The list measures and acts (`ChatList.tsx`, `onHeight`); this decides.
//
// WHY THE LIST ACTS ON A HEIGHT CHANGE AT ALL. A call arriving in a tool-activity row adds no list item (the stretch's
// row takes it), and neither does a failure card surfacing under a closed row. Virtuoso's `followOutput` answers a new
// item only, so a reader at the foot was left 50px above a surfaced card, inside the pill's band, where no pill said so.
// And virtuoso does not move the view for a row above it that grows: a card surfacing 258px above the reader moved
// everything they were reading down by its 50px (both measured in Chrome, `browser/tool-activity.browser.test.ts`).
//
// SO, ON EACH CHANGE, ONE OF THREE:
//  - `foot`: the reader was at the foot (within the pill's band of it, measured against the list as it stood BEFORE
//    this change, and the list's own flag agreeing), so the list goes back to it;
//  - `hold`: the reader was anywhere else, so the row crossing the top of their view (by its key, never its index) is put
//    back where it was, and a row wholly above it that grew or shrank moves nothing they read (a row below it, or the
//    row itself changing at its foot, moves nothing anyway). Never while the reader is moving the list themselves (a
//    wheel, a touch, a scroll key within `INPUT_SETTLE_MS`, or a finger or pointer held on it), and never for a change
//    that came with an item added or removed at either end of the list: appends are the foot follow's, and items added
//    at the top belong to the older-history work, which owns that anchor. One change is corrected once: the list
//    measures a frame later, after any correction of virtuoso's or the browser's own;
//  - `none`: the reader caused the change by opening or closing a row, a run group or a card, so nothing moves: the
//    header they tapped stays where it was, and what opened grows downward under it, as every disclosure did before the
//    fold. A change within `TAP_SETTLE_MS` of the reader's last tap on a disclosure in the list is theirs.
//
// "AT THE FOOT" IS MEASURED, NOT REMEMBERED: the list's pinned flag alone is late, because a jump up the list renders
// and measures the rows it lands on, and the height change those measures make can arrive before the list reports the
// reader left the foot, which pulled the reader straight back down.
//
// L1: pure, no I/O, no React.

/** How long after a tap on a disclosure a height change is still the tap's: a card opens over 0.24s (`--dur-base`), and
 *  the list measures the rows it re-renders a frame or two later. */
export const TAP_SETTLE_MS = 600;

/** How long after the reader's own wheel, touch or scroll key the list is still theirs: a wheel's or a fling's momentum
 *  scrolls on after its last event. */
export const INPUT_SETTLE_MS = 300;

export interface HeightChange {
  /** The list's last word on whether the reader is at the foot (`atBottomStateChange`). */
  readonly pinned: boolean;
  /** The list's total height before this change, px; null before the first report. */
  readonly before: number | null;
  /** The scroller's position and its viewport's height, px. */
  readonly scrollTop: number;
  readonly clientHeight: number;
  /** The pill's band, px: within it of the foot is at the foot. */
  readonly band: number;
  /** Milliseconds since the reader last opened or closed a disclosure in the list; null if they never have. */
  readonly sinceTap: number | null;
  /** Milliseconds since the reader last moved the list themselves (a wheel, a touch, a scroll key); null if never. */
  readonly sinceInput: number | null;
  /** A finger or a pointer is held down on the list (a touch, a scrollbar drag). */
  readonly held: boolean;
  /** An item was added or removed at either end of the list since the last change. */
  readonly newItem: boolean;
}

export type HeightMove = 'foot' | 'hold' | 'none';

export function heightMove(c: HeightChange): HeightMove {
  if (c.before === null) return 'none';
  if (c.sinceTap !== null && c.sinceTap < TAP_SETTLE_MS) return 'none';
  if (c.pinned && c.before - c.scrollTop - c.clientHeight <= c.band + 1) return 'foot';
  if (c.held || c.newItem || (c.sinceInput !== null && c.sinceInput < INPUT_SETTLE_MS)) return 'none';
  return 'hold';
}

/** How far to scroll to put the item at the top of the view back where it was: where it is now less where it was, px;
 *  nothing under a pixel (layout rounding is not a move). */
export function holdShift(was: number, now: number): number {
  const d = now - was;
  return Math.abs(d) < 1 ? 0 : d;
}
