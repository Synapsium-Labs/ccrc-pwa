// L4 delivery: the case lane's one pass (Overlord spec §10.5), in shadow. It decides nothing: practiceCases.ts does.
// It reads the observation window, the newest case of each signature and the programme of each run, asks the decider
// what is due and records each case through the store's compare-and-set. It sends no mail, no push and no feed row.
import type { WatcherCoordPort } from './ports.js';
import { caseReadFrom, caseRunIds, casesDue } from './practiceCases.js';

/** The four store members the pass reaches, declared by this consumer, so a test can hand a small fake. */
export type CasesCoord = Pick<WatcherCoordPort, 'stallObservationsSince' | 'practiceCaseNewest' | 'run' | 'openPracticeCase'>;
export interface CasesPassDeps { readonly coord: CasesCoord; readonly now: () => number }
export interface CasesPassResult { readonly opened: number; readonly superseded: number; readonly unread: 'observations' | 'cases' | 'runs' | null }

/** One pass. It reads the observation rows from `caseReadFrom(now)`, two windows back, so a consumed episode whose first
 *  rung has slid out of the window is never revived by a later rung, unless the episode's rows span more than 14 days
 *  (the recorded residual). A failed observations or cases read opens nothing: it is answered in `unread` and warned
 *  (`ccrc-server: cases: <which> read failed: <detail>`), and the next pass tries again. A failed run read lowers the
 *  count (that run is left out), warns once and answers `unread: 'runs'`; an absent run is left out and not counted, with
 *  no warning. `unread: null` means every read succeeded. A thrown write rejects the pass, and the lane row's warnKey
 *  reports it. */
export async function casesPass(deps: CasesPassDeps): Promise<CasesPassResult> {
  const { coord } = deps;
  const now = deps.now();
  const obs = coord.stallObservationsSince(caseReadFrom(now));
  if (!obs.ok) {
    console.warn(`ccrc-server: cases: observations read failed: ${obs.detail}`);
    return { opened: 0, superseded: 0, unread: 'observations' };
  }
  const newest = coord.practiceCaseNewest();
  if (!newest.ok) {
    console.warn(`ccrc-server: cases: cases read failed: ${newest.detail}`);
    return { opened: 0, superseded: 0, unread: 'cases' };
  }
  // A run whose read is not ok, or that is absent, is left out: that can only lower what is counted.
  const programOf = new Map<number, string>();
  const runIds = caseRunIds(obs.rows);
  let failed = 0;
  let firstFailure = '';
  for (const id of runIds) {
    const r = coord.run(id);
    if (r.ok && r.run !== null) programOf.set(id, r.run.program);
    else if (!r.ok) {
      if (failed === 0) firstFailure = `run ${id}: ${r.detail}`;
      failed += 1;
    }
  }
  if (failed > 0) console.warn(`ccrc-server: cases: runs read failed: ${failed} of ${runIds.length} (${firstFailure})`);
  const due = casesDue({ rows: obs.rows, programOf, newestCaseAt: newest.newest, now });
  let opened = 0;
  let superseded = 0;
  for (const d of due) {
    const w = coord.openPracticeCase(d, newest.newest.get(d.signature) ?? null, now);
    if (w.opened) opened += 1; else superseded += 1;
  }
  return { opened, superseded, unread: failed > 0 ? 'runs' : null };
}
