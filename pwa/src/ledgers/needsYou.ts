// THE ONE NEEDS-YOU SOURCE (runs rebuild §8.7, A5, F20; D-8075). A pure selector over the waiting items, the fleet's sessions
// and the runs, answering one list of what waits on the operator. The Waiting on you door, the programme chip, the Fleet
// box chip and the Runs badge are counts of this list (`needsYouCount`, `navBadges.ts`, `ledgerWords.ts`'s
// `programmeWaitingCount`), so no door can disagree with another.
//
// D-6170 holds: no run state is in it. A stuck run never joins (stuck is not needs-you), and a child's held ask does not
// count until it is handed over, which is `operatorAsk`'s own rule.
import type { FleetSession, RunSummary } from '../../../shared/api';
import type { ItemView } from '../../../shared/ledgers';
import { operatorAsk } from '../fleet/rollup';
import { capWaiting } from '../fleet/reviewCapWords';
import { boundOpenRun, claimedRunsOf } from '../fleet/runWords';

/** One thing that waits on the operator. `programme` is the slug, `''` for a session in none. `runId` is the run the
 *  entry is about: an item's run, a question's OPEN bound run (else the first open run it claims), a cap's run. */
export interface NeedsYouEntry {
  readonly programme: string;
  readonly runId: number | null;
  readonly kind: 'item' | 'question' | 'review-cap';
}

/** The kinds the `/waiting` page lists today. A review cap joins that page with its Lift cap control later in the rebuild
 *  (Task 24), and until then the page's own count is these two kinds. */
const LISTED_ON_WAITING: ReadonlySet<NeedsYouEntry['kind']> = new Set(['item', 'question']);

/** Every OPEN run an asking session is the operator's question for: the one it is bound to as a worker, then each it claims
 *  as a coordinator. The entry names the first; the Runs badge counts them all. */
function runsOfAsk(s: FleetSession, runs: readonly RunSummary[]): RunSummary[] {
  const bound = boundOpenRun(runs, s);
  return [...(bound === null ? [] : [bound]), ...claimedRunsOf(runs, s.id).filter((r) => r !== bound)];
}

/** The list: the open items (one being checked is the coordinator's), one question per asking session, and one entry per
 *  open run whose review cap waits. */
export function needsYou(
  items: readonly ItemView[], sessions: readonly FleetSession[], runs: readonly RunSummary[],
): readonly NeedsYouEntry[] {
  const out: NeedsYouEntry[] = [];
  for (const i of items) if (i.state === 'open') out.push({ programme: i.program, runId: i.runId, kind: 'item' });
  for (const s of sessions) {
    if (!operatorAsk(s)) continue;
    const run = runsOfAsk(s, runs)[0] ?? null;
    out.push({ programme: run?.program ?? '', runId: run?.id ?? null, kind: 'question' });
  }
  for (const r of runs) if (capWaiting(r) === 'waiting') out.push({ programme: r.program, runId: r.id, kind: 'review-cap' });
  return out;
}

/** How many entries a door prints: the Waiting door's and a chip's number (the kinds `/waiting` lists), for one programme
 *  when `programme` is given. */
export function needsYouCount(entries: readonly NeedsYouEntry[], programme?: string): number {
  return entries.filter((e) => LISTED_ON_WAITING.has(e.kind) && (programme === undefined || e.programme === programme)).length;
}

/** The open runs that need the operator, each once: every run an asking session is bound to or claims (D-8049's binding for a
 *  worker, the claimant for a coordinator), so a coordinator asking holds each of its runs up, as the Runs badge always counted. */
export function runsNeedingYou(sessions: readonly FleetSession[], runs: readonly RunSummary[]): number {
  const ids = new Set<number>();
  for (const s of sessions) if (operatorAsk(s)) for (const r of runsOfAsk(s, runs)) ids.add(r.id);
  return ids.size;
}
