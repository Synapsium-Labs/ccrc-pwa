// What `POST /api/runs` reads of a programme's plan (design 2026-11-10 §4.4, D-8181), shaped for `openRun.ts`'s `planGate`.
// It takes the plan port and the coord store (for the one run lookup below) and names no `coord.db`.
import type { CoordStore } from './store.js';
import type { PlanStorePort } from './planStore.js';
import type { OpenRunPlanFacts } from './openRun.js';

/** `plan.required` is true for a slug with no `programs` row (`planOf`'s own answer), `ended` reads `planEnd`. A ticket held
 *  by the `planned` run of this very claimant is reported free: a retried open that names the same ticket after a client
 *  timeout reaches the store's idempotent arm, which attaches nothing twice, instead of `ticket-unavailable`. */
export function planFactsOf(plan: PlanStorePort, coord: CoordStore, slug: string, claimedBy: string): OpenRunPlanFacts {
  const stored = plan.planOf(slug);
  return {
    required: stored.required,
    ended: plan.planEndOf(slug) !== null,
    epics: stored.epics,
    ticket: (key) => {
      for (const e of stored.epics) {
        const t = e.tickets.find((x) => x.key === key);
        if (t === undefined) continue;
        let runId = t.runId;
        if (runId !== null) {
          const r = coord.run(runId);
          if (r.ok && r.run !== null && r.run.state === 'planned' && r.run.claimedBy === claimedBy) runId = null;
        }
        return { id: t.id, epicId: t.epicId, project: t.project, state: t.state, runId };
      }
      return null;
    },
  };
}
