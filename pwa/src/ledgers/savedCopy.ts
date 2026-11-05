// Which list the Waiting on you page and an opened item draw before live data (console speed, Task C4; spec §2.6,
// Figure 8, D16; ring L1: pure). The operator's ruling on item 34: "Show it, marked as not current until live data
// replaces it." This module decides only WHICH list and rows to draw, and whether an item's acts are open; the routes
// draw it, and the words are `ledgerWords.ts`'s. A box that says it has no coordination database is decided before this,
// by the route, as today, so a saved copy never stands in for that answer.
//
// The saved copy is the store's `waitingSaved` (`stores/fleet.ts`), never its `waiting`: what this page has heard and
// what the device saved stay two inputs, and only `live` opens an act.
import type { FleetSession } from '../../../shared/api';
import type { WaitingView } from '../../../shared/ledgers';
import type { WaitingSnapshot } from '../lib/offline';

/** What the Waiting page draws: the live list and rows; the device's list (with the rows heard, or else the device's);
 *  the live list with the device's rows; or nothing to draw yet. */
export type ListSource =
  | { readonly kind: 'live'; readonly view: WaitingView; readonly sessions: readonly FleetSession[] }
  | { readonly kind: 'saved-list'; readonly view: WaitingView; readonly sessions: readonly FleetSession[]; readonly savedAt: number }
  | { readonly kind: 'saved-rows'; readonly view: WaitingView; readonly sessions: readonly FleetSession[] }
  | { readonly kind: 'none' };

/** What an opened item reads: it needs only the list, so it is live, saved or nothing. */
export type ItemSource =
  | { readonly kind: 'live'; readonly view: WaitingView }
  | { readonly kind: 'saved'; readonly view: WaitingView; readonly savedAt: number }
  | { readonly kind: 'none' };

/** The Waiting page's source. `heard` is what this page has heard (`null` for each part it has not: the list off the
 *  store's `waiting`, the rows off `useHeard`); `saved` is the device's copy of the list; `deviceRows` is the store's
 *  `sessions`, which the fleet snapshot hydrates on a cold start. Live only when both parts are heard, which is today's
 *  draw condition. */
export function listSource(
  heard: { readonly view: WaitingView | null; readonly sessions: readonly FleetSession[] | null },
  saved: WaitingSnapshot | null,
  deviceRows: readonly FleetSession[],
): ListSource {
  if (heard.view !== null) {
    return heard.sessions !== null
      ? { kind: 'live', view: heard.view, sessions: heard.sessions }
      : { kind: 'saved-rows', view: heard.view, sessions: deviceRows };
  }
  if (saved === null) return { kind: 'none' };
  return { kind: 'saved-list', view: saved.view, sessions: heard.sessions ?? deviceRows, savedAt: saved.savedAt };
}

/** An opened item's source: the list this page has heard, else the device's copy, else nothing. */
export function itemSource(heard: WaitingView | null, saved: WaitingSnapshot | null): ItemSource {
  if (heard !== null) return { kind: 'live', view: heard };
  return saved === null ? { kind: 'none' } : { kind: 'saved', view: saved.view, savedAt: saved.savedAt };
}

/** Whether an item's acts (Mark done, Dismiss, a secret's Save and Remove) may go out: on live data only, so nothing is
 *  sent on a list this page has not heard. */
export function actsOpen(s: ListSource | ItemSource): boolean {
  return s.kind === 'live';
}
