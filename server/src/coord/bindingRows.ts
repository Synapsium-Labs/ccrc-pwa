import { isRunState } from '../../../shared/api.js';
import { boundRunsOf, isOpen, unbornIncarnation, type BindingRun, type Incarnation } from './runBinding.js';

/**
 * The store's session-keyed readers, as projections of ONE series (ARCH-62, GitHub #797; epic #771; consolidation spec
 * §3 K10). L1: pure. `CoordStore` reads the series once (`seriesRows`, the runs that name or claim an id, by id, the raw
 * columns), and each reader below decides over it through `bindingOf`, `claimantsOf` and `boundRunsOf`
 * (`coord/runBinding.ts`), so "which run is this session's" is written once and the store keeps one SQL reader for it.
 *
 * WHY THE ROWS STAY RAW. The readers' all-or-failure rule (D-2545) proves the integers of the rows a reader RETURNS and
 * of no other, so a row it does not return can never fail it. The binding decides over `BindingRun`s whose `id` is the
 * row's ordinal in the series (the series is by id, so the order is the id order exactly, with no integer read at all),
 * and each reader hands back the raw rows it selected for the store to prove.
 *
 * THE INCARNATION. A caller that knows the worker's birth passes its incarnation (`coord/heldFor.ts`); every other
 * caller passes none and gets the id-string rule, `unbornIncarnation(id, 'not-a-child')`, which is the rule these
 * readers had before and holds for a coordinator and a manual workspace.
 */

/** One run of the series: the columns the binding reads and the ones the readers project, raw. */
export interface SeriesRow {
  readonly idText: string;
  readonly program: string;
  readonly waveText: string;
  readonly waveOfText: string | null;
  readonly reviewsText: string | null;
  readonly state: string;
  readonly sessionId: string | null;
  readonly claimedBy: string | null;
  readonly openedAt: number;
  readonly sessionBornAt: number | null;
  readonly sessionBornFor: string | null;
}

const incarnationFor = (sessionId: string, incarnation: Incarnation | undefined): Incarnation =>
  incarnation ?? unbornIncarnation(sessionId, 'not-a-child');

/** The series as `BindingRun`s; a state this build cannot name reads `unknown`, as every session-keyed reader reads it. */
const runsOf = (rows: readonly SeriesRow[]): BindingRun[] => rows.map((r, i) => ({
  id: i + 1, sessionId: r.sessionId, claimedBy: r.claimedBy, state: isRunState(r.state) ? r.state : 'unknown',
  openedAt: r.openedAt, sessionBornAt: r.sessionBornAt, sessionBornFor: r.sessionBornFor,
}));

/** The raw rows of the runs that bind `sessionId`'s incarnation, by id: in any state, or only the open ones. */
export function boundRows(
  rows: readonly SeriesRow[], sessionId: string, which: 'any' | 'open', incarnation?: Incarnation,
): SeriesRow[] {
  return boundRunsOf(runsOf(rows), incarnationFor(sessionId, incarnation), which).map((b) => rows[b.id - 1]!);
}

/** The raw rows of a claimant's series that are not terminal (a state this build cannot name is open), in order. */
export const openRows = (rows: readonly SeriesRow[]): SeriesRow[] => {
  const runs = runsOf(rows);
  return rows.filter((_, i) => isOpen(runs[i]!));
};
