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
//    of the list, but one: appends are the foot follow's. ROWS PREPENDED AT THE TOP (an older page, desktop polish wave
//    175) ARE HELD BY THIS SAME HOLD: the list shifts virtuoso's first index by the prepend, measured by a row's KEY
//    (`prependShift`), so virtuoso keeps that row in place as well as its size estimates allow, and the hold then puts the
//    row crossing the top of the view back exactly, by its key. One mechanism, so the two never write the scroller in one
//    frame. One change is corrected once: the list compares a frame later, after any correction of virtuoso's or the
//    browser's own, and puts nothing back when the list moved in between (`holdShift`'s `moved`);
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
  /** The change came with rows put before the first one (an older page): the hold keeps the reader's row in place. */
  readonly prepended: boolean;
}

export type HeightMove = 'foot' | 'hold' | 'none';

export function heightMove(c: HeightChange): HeightMove {
  if (c.before === null) return 'none';
  if (c.sinceTap !== null && c.sinceTap < TAP_SETTLE_MS) return 'none';
  if (c.pinned && c.before - c.scrollTop - c.clientHeight <= c.band + 1) return 'foot';
  if (c.sinceMove !== null && c.sinceMove < MOVE_SETTLE_MS) return 'none';
  if (c.newItem && !c.prepended) return 'none';
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

/** How far a row's index moved between two lists of row keys, measured by a row both carry (desktop polish wave 175): the
 *  row `preferred` names when it survives, else the first row after it in `before` that survives, else the first that
 *  does. Virtuoso's first index moves by this so that row keeps its place. 0 when the first row is the same (nothing was
 *  put before it or taken from before it). NULL when no row survives (a new list: a backlog onto another file), its own
 *  answer (desktop polish wave 179, A1): a list nothing was put before moves no index, and the caller adds nothing to it.
 *  By key, never by counting rows added: at the join a time divider can go and a tool stretch can take the page's calls,
 *  so the count of rows added is not how far the rows below the join moved. Negative when rows were taken from the top. */
export function prependShift(before: readonly string[], after: readonly string[], preferred: string | null): number | null {
  if (before.length === 0 || after.length === 0) return null;
  if (before[0] === after[0]) return 0;
  const at = new Map<string, number>();
  after.forEach((k, i) => { if (!at.has(k)) at.set(k, i); });
  const from = preferred === null ? 0 : Math.max(0, before.indexOf(preferred));
  for (const i of [...range(from, before.length), ...range(0, from)]) {
    const j = at.get(before[i]!);
    if (j !== undefined) return j - i;
  }
  return null;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

/** What the list does when virtuoso says the reader is no longer at the foot (desktop polish wave 175, carried item 6a).
 *  ONE OWNER OF "STAY AT THE FOOT": virtuoso's own follow is off (it armed a 100ms window on every render that followed a
 *  reader's tap to the end, measured throwing a tapped header out of view in 13 of 20 taps), so the list keeps a reader
 *  at the foot itself, here and in `heightMove`'s `foot`. The foot left the reader, not the reader the foot, unless they
 *  moved the scroller up from where the foot last stood, or tapped a disclosure: then they `leave` it. Otherwise the list
 *  grew under them, or the view shrank (a phone keyboard opening), and they are taken back (`foot`). While the column
 *  settles (opening, a width change, a skin change) a pinned reader is taken back whatever moved. */
export interface FootLeft {
  /** The column is still settling (`Column.settling`). */
  readonly settling: boolean;
  /** The scroller stands above where it last stood at the foot, by a pixel or more. */
  readonly movedUp: boolean;
  /** Milliseconds since the reader last opened or closed a disclosure in the list; null if they never have. */
  readonly sinceTap: number | null;
}

export function footLeft(c: FootLeft): 'foot' | 'leave' {
  if (c.settling) return 'foot';
  if (c.movedUp) return 'leave';
  if (c.sinceTap !== null && c.sinceTap < TAP_SETTLE_MS) return 'leave';
  return 'foot';
}
