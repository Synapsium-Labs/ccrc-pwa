// The PR cap's two pure answers (D-7573, ARCH-05): whether a session has a PR cap at all, and the word on its door.
// Moved out of `PrKeycap.tsx` so the header's view and the ⋯ menu, both L1, read them without loading a component
// file; the cap, the PR section and the session flows read them here too.
import type { PrState } from '../../../shared/api';

/** A workspace session has a PR cap; a main checkout has none. ONE predicate: the header's cap renders where it holds
 *  and the palette offers `session-pr` where it holds, so neither offers a PR the other hides (W2 Task S2d). */
export function hasPrCap<S extends { workspace: string | null }>(session: S | null): session is S {
  return session !== null && session.workspace !== null;
}

/** The word on the PR door at the desk (desktop polish T3c, D-6333): the number once we have one, otherwise what
 *  tapping it does — a tap always opens the sheet, and the sheet is where a PR is opened, checked or retried. Below
 *  900 the cap shows `prLegend` as it always did; the More sheet's PR row carries this word at every width. */
export function prDoorWord(pr: PrState): string {
  if (pr.number !== null) return `#${pr.number}`;
  switch (pr.phase) {
    case 'none': return 'Open PR';
    case 'unchecked': return 'Check PR';
    case 'unknown': return 'Retry PR';
    default: return 'PR';
  }
}
