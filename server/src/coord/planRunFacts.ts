// What `POST /api/runs` reads of a programme's plan (design 2026-11-10 §4.4, D-8181), shaped for `openRun.ts`'s `planGate`.
// It takes the plan port and the coord store (for the one run lookup below) and names no `coord.db`.
import type { CoordStore } from './store.js';
import type { PlanStorePort } from './planStore.js';
import type { OpenRunPlanFacts } from './openRun.js';
import type { EvidenceLink, TicketDoneFacts } from './planPolicy.js';
import type { TicketDoneEvidence } from '../../../shared/plan.js';

/** `plan.required` is true for a slug with no `programs` row (`planOf`'s own answer), `ended` reads `planEnd`. A ticket held
 *  by the `planned` run of this very claimant is reported free: a retried open that names the same ticket after a client
 *  timeout reaches the store's idempotent arm, which attaches nothing twice, instead of `ticket-unavailable`. */
export function planFactsOf(plan: PlanStorePort, coord: CoordStore, slug: string, claimedBy: string): OpenRunPlanFacts {
  const stored = plan.planOf(slug);
  return {
    required: stored.required,
    ended: plan.programmeEnded(slug),
    // Programme work map WM1: a plan that declares a phase (dropped ones included: it was declared) names its tickets at open.
    phased: plan.phasesOf(slug).length > 0,
    tickets: (epicId) => stored.epics.find((e) => e.id === epicId)?.tickets ?? [],
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

/** `plan ticket-done`'s links between a pull request and the run that carried it (programme work map WM1, review 2429 F2),
 *  for `ticketDoneVerdict`, which treats a run and its pull request as one piece of work. They are read from the landing
 *  line alone, through `CoordStore.readLanding` (no `runs.closePr`, no lineage): for a `{ pr }`, always the ticket's own
 *  project's line, since a run that carried it and still holds another ticket refuses it (review 2712 F1); for a `{ runId }`,
 *  the line of each project whose ticket stores a `{ pr }`. Each tie carries the ticket its run holds, read through the one
 *  owner of a run's ticket, `plan.ticketOfRun`. A line that cannot be read answers `unreadable`, which the verdict refuses.
 *  Stored evidence that reads as neither kind (`malformed`) ties nothing here; the verdict refuses it on its own (F3). */
export function evidenceLinksOf(
  coord: Pick<CoordStore, 'readLanding'>, plan: Pick<PlanStorePort, 'ticketOfRun'>, evidence: TicketDoneEvidence, project: string,
  stored: readonly { project: string; evidence: TicketDoneEvidence | 'malformed' }[],
): TicketDoneFacts['links'] {
  const projects = 'pr' in evidence
    ? [project]
    : [...new Set(stored.filter((s) => s.evidence !== 'malformed' && 'pr' in s.evidence).map((s) => s.project))];
  const pairs: EvidenceLink[] = [];
  for (const p of projects) {
    const read = coord.readLanding(p);
    if (!read.ok) return { kind: 'unreadable', detail: `${p}: ${read.error}` };
    for (const e of read.facts.entries) {
      if (e.runId === null) continue;
      if (!('pr' in evidence ? e.pr === evidence.pr : e.runId === evidence.runId)) continue;
      const own = plan.ticketOfRun(e.runId);
      const holder = own === null || own.ticketId === null || own.key === null ? null : { ticketId: own.ticketId, key: own.key };
      pairs.push({ project: p, pr: e.pr, runId: e.runId, holder });
    }
  }
  return { kind: 'read', pairs };
}
