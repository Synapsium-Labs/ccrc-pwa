import { TERMINAL_RUN_STATES, type RunState } from '../../../shared/api.js';
import type { BindingRun, Incarnation } from './runBinding.js';
import type { OpenSiblingsResult, RunsNamingSessionResult } from './store.js';

/**
 * The store's binding readers, asked in the shapes the callers outside the binding use (ARCH-62, GitHub #797; consolidation
 * spec §5.9). `CoordStore` keeps four session-keyed binding readers (`bindingRunsOf`, `openRunsForSession`,
 * `runsNamingSession`, `lastRunBySession`); the questions that used to have a reader each are these functions over them, so
 * "which run is this session's" is still decided in `coord/runBinding.ts` and nowhere else.
 */

/** What these functions need of the store: the series read, the open-only reader and the bound-worker reader. */
export interface BindingReadPort {
  bindingRunsOf(id: string): { readonly ok: true; readonly runs: readonly BindingRun[] } | { readonly ok: false; readonly detail: string };
  openRunsForSession(sessionId: string, excludeRunId?: number, incarnation?: undefined, role?: 'worker' | 'claimant'): OpenSiblingsResult;
  runsNamingSession(sessionId: string, incarnation?: Incarnation): RunsNamingSessionResult;
}

const isOpenState = (state: RunState): boolean => !(TERMINAL_RUN_STATES as readonly RunState[]).includes(state);

/** The claimants of the OPEN runs `sessionId`'s incarnation is bound to as WORKER, newest run first, each once, ownerless
 *  runs contributing nothing; or why the rows could not be read. Read from `runsNamingSession` (the worker column only), so
 *  a run the session CLAIMS never enters the answer nor fails it. */
function openClaimantsRead(
  port: Pick<BindingReadPort, 'runsNamingSession'>, sessionId: string, incarnation?: Incarnation,
): { ok: true; claimants: string[] } | { ok: false; detail: string } {
  const named = port.runsNamingSession(sessionId, incarnation);
  if (!named.ok) return { ok: false, detail: named.detail };
  const seen = new Set<string>();
  for (const r of [...named.runs].sort((a, b) => b.id - a.id)) {
    if (isOpenState(r.state) && r.claimedBy !== null) seen.add(r.claimedBy);
  }
  return { ok: true, claimants: [...seen] };
}

/** EVERY coordinator that currently has `sessionId` working for it (the id-string rule: a coordinator or a manual workspace
 *  has no birth), newest open run first, each once: `openClaimantsOf`'s answer and scope exactly (the runs naming the
 *  session as worker, nothing it claims). A worker row whose own integers this process cannot represent throws, naming
 *  why, so a partial list never reads as "nobody else's worker". */
export function claimantsOfSession(port: Pick<BindingReadPort, 'runsNamingSession'>, sessionId: string, incarnation?: Incarnation): string[] {
  const read = openClaimantsRead(port, sessionId, incarnation);
  if (!read.ok) throw new Error(`claimantsOfSession: ${read.detail}`);
  return read.claimants;
}

/** The claimant of the newest OPEN run bound to `incarnation` (`parentOf`'s answer), read from the worker rows only: `heldFor`'s
 *  fallback when the whole series (`bindingRunsOf`, which also reads the runs the child claims) cannot be represented.
 *  `null` parent: no open binding, or it is ownerless. */
export function provenParentOf(
  port: Pick<BindingReadPort, 'runsNamingSession'>, sessionId: string, incarnation: Incarnation,
): { ok: true; parent: string | null } | { ok: false; detail: string } {
  const named = port.runsNamingSession(sessionId, incarnation);
  if (!named.ok) return { ok: false, detail: named.detail };
  const open = [...named.runs].sort((a, b) => b.id - a.id).find((r) => isOpenState(r.state));
  return { ok: true, parent: open?.claimedBy ?? null };
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
