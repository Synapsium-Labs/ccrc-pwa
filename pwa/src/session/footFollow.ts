// Whether the chat list goes back to its foot when its height changes (desktop polish wave 168; review 3450 F5, review
// 3478 F5 and A8). The list acts on it (`ChatList.tsx`, `onHeight`); this decides.
//
// WHY THE LIST FOLLOWS A HEIGHT CHANGE AT ALL. A call arriving in a tool-activity row adds no list item (the stretch's
// row takes it), so virtuoso's `followOutput`, which answers a new item only, never fires for it: a failure card
// surfacing under a closed live row left a reader at the foot 50px above it, inside the pill's band, so no pill said so.
//
// WHEN IT DOES NOT. A reader above the foot is never moved. "At the foot" is measured against the list as it stood
// BEFORE this change (the last height reported, the scroller's own position), within the pill's band: the list's pinned
// flag alone is late, because a jump up the list renders and measures the rows it lands on, and the height change those
// measures make can arrive before the list reports the reader left. And a change the reader caused, by opening or
// closing a row, a run group or a card, is not followed: the header they tapped stays where it was, and what opened grows
// downward under it, as every disclosure did before the fold. It is recognised by time: a height change within
// `TAP_SETTLE_MS` of the reader's last tap on a disclosure in the list is theirs.
//
// L1: pure, no I/O, no React.

/** How long after a tap on a disclosure a height change is still the tap's: a card opens over 0.24s (`--dur-base`), and
 *  the list measures the rows it re-renders a frame or two later. */
export const TAP_SETTLE_MS = 600;

export interface FootFollowInput {
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

export function followsFoot(i: FootFollowInput): boolean {
  if (!i.pinned || i.before === null) return false;
  if (i.sinceTap !== null && i.sinceTap < TAP_SETTLE_MS) return false;
  return i.before - i.scrollTop - i.clientHeight <= i.band + 1;
}
