import { bindingOf, childParentOf, claimantsOf, parentOf, unbornIncarnation, type BindingRun, type Incarnation } from './runBinding.js';
import type { OpenSiblingsResult, RunsNamingSessionResult } from './store.js';

/**
 * The store's binding readers, asked in the shapes the callers outside the binding use (ARCH-62, GitHub #797; consolidation
 * spec §5.9). `CoordStore` keeps four session-keyed binding readers (`bindingRunsOf`, `openRunsForSession`,
 * `runsNamingSession`, `lastRunBySession`); the questions that used to have a reader each are these functions over them, so
 * "which run is this session's" is still decided in `coord/runBinding.ts` and nowhere else.
 */

type SeriesRead = { readonly ok: true; readonly runs: readonly BindingRun[] } | { readonly ok: false; readonly detail: string };

/** What these functions need of the store: the series read (proven ids, or ordinals that prove none), the open-only
 *  reader and the bound-worker reader. */
export interface BindingReadPort {
  bindingRunsOf(id: string, ids?: 'proven' | 'ordinal'): SeriesRead;
  openRunsForSession(sessionId: string, excludeRunId?: number, incarnation?: undefined, role?: 'worker' | 'claimant'): OpenSiblingsResult;
  runsNamingSession(sessionId: string, incarnation?: Incarnation): RunsNamingSessionResult;
}

/** EVERY coordinator that currently has `sessionId` working for it (the id-string rule: a coordinator or a manual workspace
 *  has no birth), newest open run first, each once, ownerless runs contributing nothing: `openClaimantsOf`'s answer, scope
 *  and failure exactly. Read over the series by ORDINAL (`bindingRunsOf(id, 'ordinal')`), so no integer is proven: a run
 *  the session CLAIMS never enters the answer, and no row's id (open or terminal, worker or claimed) can fail it. A series
 *  that cannot be read at all throws, so a partial list never reads as "nobody else's worker". */
export function claimantsOfSession(port: Pick<BindingReadPort, 'bindingRunsOf'>, sessionId: string, incarnation?: Incarnation): string[] {
  const series = port.bindingRunsOf(sessionId, 'ordinal');
  if (!series.ok) throw new Error(`claimantsOfSession: ${series.detail}`);
  return claimantsOf(series.runs, incarnation ?? unbornIncarnation(sessionId, 'not-a-child'));
}

/** A child's parent, read for heldFor and the drift lane alike (`childParentOf` over the proven series). When that series
 *  cannot be represented (it also reads the runs the child CLAIMS, and proves every id), the parent is the claimant of the
 *  child's open binding over the same series by ordinal, which proves no integer: `parentOfSession`'s answer before the
 *  fold (ruling (a)), `null` when there is none. `series` is the proven read, so a caller can say why it failed. */
export function childParentRead(
  port: Pick<BindingReadPort, 'bindingRunsOf'>, childId: string, minter: string | null, incarnation: Incarnation,
): { parent: string | null; series: SeriesRead } {
  const series = port.bindingRunsOf(childId);
  if (series.ok) return { parent: childParentOf(series.runs, minter, incarnation), series };
  const ordinal = port.bindingRunsOf(childId, 'ordinal');
  return { parent: ordinal.ok ? parentOf(bindingOf(ordinal.runs, incarnation)) : null, series };
}

/** The open runs `claimantId` claims, session-less planned runs included, in id order: `openRunsForSession`'s question
 *  asked of the claimant column. Not `childrenOf`, which excludes a run that names no session yet. */
export const openRunsClaimedBy = (port: Pick<BindingReadPort, 'openRunsForSession'>, claimantId: string): OpenSiblingsResult =>
  port.openRunsForSession(claimantId, undefined, undefined, 'claimant');

/** Every run `sessionId` touches, as WORKER (`sessionId`) or as COORDINATOR (`claimedBy`), any state, by id: the routing
 *  door's walk (routing spec 2026-09-14 §3, slice 6). The series is the binding's own (the OR), so this is the same read
 *  as `bindingRunsOf`, projected to the three columns the walk uses. A series this process cannot represent answers
 *  `ok: false` with why, never a partial walk: L1 `decideRoute` refuses it `runs-unreadable` (a partial history must not
 *  read as "no earlier move"). */
export function runsTouching(
  port: Pick<BindingReadPort, 'bindingRunsOf'>, sessionId: string,
): { ok: true; runs: { id: number; sessionId: string | null; claimedBy: string | null }[] } | { ok: false; detail: string } {
  const series = port.bindingRunsOf(sessionId);
  if (!series.ok) return { ok: false, detail: `runsTouching: ${series.detail}` };
  return { ok: true, runs: series.runs.map((r) => ({ id: r.id, sessionId: r.sessionId, claimedBy: r.claimedBy })) };
}
