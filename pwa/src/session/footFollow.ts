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
//  - `hold`: the reader was anywhere else, so the item at the top of their view is kept where it was, and a row that
//    grew above it moves nothing they read (a row below it, or the item itself growing at its foot, moves nothing
//    anyway);
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
}

export type HeightMove = 'foot' | 'hold' | 'none';

export function heightMove(c: HeightChange): HeightMove {
  if (c.before === null) return 'none';
  if (c.sinceTap !== null && c.sinceTap < TAP_SETTLE_MS) return 'none';
  return c.pinned && c.before - c.scrollTop - c.clientHeight <= c.band + 1 ? 'foot' : 'hold';
}

/** How far to scroll to put the item at the top of the view back where it was: where it is now less where it was, px;
 *  nothing under a pixel (layout rounding is not a move). */
export function holdShift(was: number, now: number): number {
  const d = now - was;
  return Math.abs(d) < 1 ? 0 : d;
}
