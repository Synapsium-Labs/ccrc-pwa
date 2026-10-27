// stripFold — how the lanes strip folds (desktop polish S5b, D-6530; the operator's rulings Q10 and Q13): how many
// lanes a folded strip shows, whether it folds at all, and the one line of words that says what the fold hides.
// Pure L1: no I/O and no layout read. The measure of a desk row's width is `useRowWidth`'s (L4); this file only turns
// that width into a count, so the width-to-count step is one function end to end.
//
// A phone folds to a LANE COUNT (`FOLD_SHOWN`), not a measured fit: four fills two rows of the two-column grid and one
// row of the four-column grid from 700 px, so no width draws a ragged row and the hidden set never changes when a
// tablet rotates. A desk folds to one line, as many cards as `rowFit` says the line's tracks hold, less the track the
// end cell (the control and All accounts) takes. The file also holds the two delays of the desk's hover flyout
// (`FLYOUT_OPEN_MS`, `FLYOUT_CLOSE_MS`), which are pure numbers the strip's timers and the tests share.
import type { AccountUsage } from '../../../shared/api';
import type { AccountStateWord } from '../../../shared/accounts';
import { stateWordFor } from '../../../shared/accounts';
import { SIGN_IN_EXPIRED } from '../lib/accounts';

/** The lanes a folded strip shows on a phone, at every phone width. */
export const FOLD_SHOWN = 4;

/** How long the pointer, or focus, rests on the desk's folded line before its flyout opens (strip-hover-flyout): long
 *  enough that a pointer crossing the line to somewhere else never flickers it open, short enough to read as a hover. */
export const FLYOUT_OPEN_MS = 150;

/** How long the flyout stays open after the pointer, and focus, have left the line and the flyout (strip-hover-flyout):
 *  the grace in which a pointer crossing the gap between the line and the panel, or coming back, keeps it. */
export const FLYOUT_CLOSE_MS = 250;

/** A lane card's floor in px: the one place the figure is written. It reaches the lanes row's grid as the custom
 *  property `--lane-card-min` (written by the strip), so the grid's tracks and `rowFit`'s count agree. */
export const LANE_CARD_MIN = 260;

/** How many tracks of `cardMin` px, `gap` px apart, one line of `width` px holds: the track count of
 *  `repeat(auto-fill, minmax(cardMin, 1fr))`, at least one. `null` for a width that is not a measurement (null, zero,
 *  negative, not finite): an unmeasured row, which `foldShown` and `foldLanes` pass on as "fold nothing". Total. */
export function rowFit(width: number | null, cardMin: number, gap: number): number | null {
  if (width === null || !Number.isFinite(width) || width <= 0) return null;
  return Math.max(1, Math.floor((width + gap) / (cardMin + gap)));
}

/** How many lanes a folded strip shows. A phone: `FOLD_SHOWN`, whatever `tracks` is. A desk: one fewer than the line's
 *  `tracks` (the last track is the end cell's), at least one; `null` when the row is unmeasured (`tracks` null). */
export function foldShown(desk: boolean, tracks: number | null): number | null {
  if (!desk) return FOLD_SHOWN;
  return tracks === null ? null : Math.max(1, tracks - 1);
}

/** What the fold decided: the lanes to mount, the ones left out, whether the strip folds at all (the control renders
 *  iff it does), and the choice it was asked for (the stored one), echoed so a caller reads one object. */
export interface Fold<T extends AccountUsage = AccountUsage> {
  readonly shown: T[];
  readonly hidden: T[];
  readonly foldable: boolean;
  readonly expanded: boolean;
}

/** Fold `sorted` (the strip's live lanes in `lanesByFree`'s order) to `count` lanes (`foldShown`'s; null when a desk
 *  row is unmeasured). It never folds to hide fewer than two lanes: `foldable` needs `count + 2` lanes, so five lanes on
 *  a phone all show, folded or not, with no control. Folded and foldable, the first `count` are shown and the rest,
 *  the fullest, hidden; otherwise every lane shows and none is hidden. */
export function foldLanes<T extends AccountUsage>(sorted: readonly T[], expanded: boolean, count: number | null): Fold<T> {
  const foldable = count !== null && sorted.length >= count + 2;
  if (!foldable || expanded) return { shown: [...sorted], hidden: [], foldable, expanded };
  return { shown: sorted.slice(0, count), hidden: sorted.slice(count), foldable, expanded };
}

/** The kinds of hidden lane that need the operator, in the order they print: a lapsed sign-in first, because its numbers
 *  are frozen. Each is an `AccountStateWord`, from `stateWordFor`'s ranking, which is why a lane counts under one only.
 *  A lane that is merely critical, or never read, is not among them. */
const NEEDS_YOU = ['signed-out', 'rate-limited'] as const satisfies readonly AccountStateWord[];

/** How a kind prints: the lapsed sign-in in the phrase the accounts surfaces use, the other by its state word. */
const kindWords = (word: (typeof NEEDS_YOU)[number]): string => (word === 'signed-out' ? SIGN_IN_EXPIRED : word);

/** The control's words, the one sentence the fold prints (nothing else builds it). Folded: "+13 more", then, for each
 *  kind of hidden lane that needs the operator, its count ("1 sign-in expired · 1 rate-limited"), a kind at zero left
 *  out. Expanded: "Show fewer". `null` when the fold is not `foldable`: there is no control to word. `nowMs` is the
 *  caller's clock (epoch ms): this file reads none. */
export function foldWords(fold: Fold, nowMs: number): string | null {
  if (!fold.foldable) return null;
  if (fold.expanded) return 'Show fewer';
  const counts = new Map<AccountStateWord, number>();
  for (const lane of fold.hidden) {
    // The strip drops disabled lanes before it folds, so none is hidden here; the decider is asked as the strip's card is.
    const { word } = stateWordFor({ ...lane, disabled: false, now: nowMs });
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const kinds = NEEDS_YOU.flatMap((word) => {
    const n = counts.get(word) ?? 0;
    return n > 0 ? [`${n} ${kindWords(word)}`] : [];
  });
  return [`+${fold.hidden.length} more`, ...kinds].join(' · ');
}
