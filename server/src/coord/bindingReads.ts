import type { BindingRun } from './runBinding.js';
import { claimantsOf, unbornIncarnation } from './runBinding.js';
import type { OpenSiblingsResult } from './store.js';

/**
 * The store's one series read, asked in the two shapes the callers outside the binding use (ARCH-62, GitHub #797; consolidation
 * spec §5.9). `CoordStore` keeps four binding readers (`bindingRunsOf`, `openRunsForSession`, `runsNamingSession`,
 * `lastRunBySession`); the questions that used to have a reader each are these functions over them, so "which run is this
 * session's" is still decided in `coord/runBinding.ts` and nowhere else.
 */

/** What these functions need of the store: the series read, and the open-only reader. */
export interface BindingReadPort {
  bindingRunsOf(id: string): { readonly ok: true; readonly runs: readonly BindingRun[] } | { readonly ok: false; readonly detail: string };
  openRunsForSession(sessionId: string, excludeRunId?: number, incarnation?: undefined, role?: 'worker' | 'claimant'): OpenSiblingsResult;
}

/** EVERY coordinator that currently has `sessionId` working for it (the id-string rule: a coordinator or a manual workspace
 *  has no birth), newest open run first, each once. A series this process cannot represent THROWS, naming why, so a partial
 *  list never reads as "nobody else's worker"; every caller either sits in a route that answers a refusal on a throw or
 *  guards a handover that must not proceed on doubt. */
export function claimantsOfSession(port: Pick<BindingReadPort, 'bindingRunsOf'>, sessionId: string): string[] {
  const series = port.bindingRunsOf(sessionId);
  if (!series.ok) throw new Error(`claimantsOfSession: ${series.detail}`);
  return claimantsOf(series.runs, unbornIncarnation(sessionId, 'not-a-child'));
}

/** The open runs `claimantId` claims, session-less planned runs included, in id order: `openRunsForSession`'s question
 *  asked of the claimant column. Not `childrenOf`, which excludes a run that names no session yet. */
export const openRunsClaimedBy = (port: Pick<BindingReadPort, 'openRunsForSession'>, claimantId: string): OpenSiblingsResult =>
  port.openRunsForSession(claimantId, undefined, undefined, 'claimant');

/** Every run `sessionId` touches, as WORKER (`sessionId`) or as COORDINATOR (`claimedBy`), any state, by id: the routing
 *  door's walk (routing spec 2026-09-14 §3, slice 6). The series is the binding's own (the OR), so this is the same read
 *  as `bindingRunsOf`, projected to the three columns the walk uses. A series this process cannot represent THROWS, as a
 *  failed read does at the door: a partial history must not read as "no earlier move". */
export function runsTouching(
  port: Pick<BindingReadPort, 'bindingRunsOf'>, sessionId: string,
): { id: number; sessionId: string | null; claimedBy: string | null }[] {
  const series = port.bindingRunsOf(sessionId);
  if (!series.ok) throw new Error(`runsTouching: ${series.detail}`);
  return series.runs.map((r) => ({ id: r.id, sessionId: r.sessionId, claimedBy: r.claimedBy }));
}
