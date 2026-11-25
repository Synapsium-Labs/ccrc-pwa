// What the chat list does when its height changes (desktop polish wave 168; review 3450 F5, review 3478 F5, F6 and A8,
// review 3607 F1).
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
//    row itself changing at its foot, moves nothing anyway). Never while the list is MOVING, for any reason: the bound is
//    what the scroller itself reports, a scroll event within `MOVE_SETTLE_MS` (the hold's own correcting write excluded),
//    so a touch fling after the finger lifts, a smooth scroll (Jump to latest's, or one made in code), a scrollbar drag,
//    scroll keys wherever focus is, and virtuoso's own corrections are all the list moving, with no input event needed.
//    A hold skipped because the list was moving is right: writing the scroller then would end a smooth scroll and set
//    the reader back by their own movement. And never for a change that came with an item added or removed at either end
//    of the list: appends are the foot follow's, and items added at the top belong to the older-history work, which owns
//    that anchor. One change is corrected once: the list compares a frame later, after any correction of virtuoso's or
//    the browser's own, and puts nothing back when the list moved in between (`holdShift`'s `moved`);
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

/** How long after the scroller's last scroll event the list still counts as moving. A moving list reports a scroll every
 *  frame it moves (a fling, a smooth scroll, a held key), so this only needs to outlast a slow frame or two. */
export const MOVE_SETTLE_MS = 200;

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
  /** Milliseconds since the scroller last reported a scroll, the list's own correcting write excluded; null if never. */
  readonly sinceMove: number | null;
  /** An item was added or removed at either end of the list since the last change. */
  readonly newItem: boolean;
}

export type HeightMove = 'foot' | 'hold' | 'none';

export function heightMove(c: HeightChange): HeightMove {
  if (c.before === null) return 'none';
  if (c.sinceTap !== null && c.sinceTap < TAP_SETTLE_MS) return 'none';
  if (c.pinned && c.before - c.scrollTop - c.clientHeight <= c.band + 1) return 'foot';
  if (c.newItem || (c.sinceMove !== null && c.sinceMove < MOVE_SETTLE_MS)) return 'none';
  return 'hold';
}

/** How far to scroll to put the item at the top of the view back where it was: where it is now less where it was, px;
 *  nothing under a pixel (layout rounding is not a move), and nothing when the list `moved` between the change and this
 *  compare (the difference would hold the reader's own movement, or a correction already made). */
export function holdShift(was: number, now: number, moved: boolean): number {
  if (moved) return 0;
  const d = now - was;
  return Math.abs(d) < 1 ? 0 : d;
}
