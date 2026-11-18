// The programme work map WM1's deciders (D-8727; spec 2026-11-16 §4.1, D10 and D11): `runMustNameTicket` (the
// `ticket-required` rule of `runs open`), `parsePlanTicketDone` (`plan ticket-done`'s body) and `ticketDoneVerdict` (its
// evidence rule, as review 2375 F2 corrected it), in `server/src/coord/planPolicy.ts`. Each case is written ONCE here over a
// module, so `plan-ticket-done.test.ts` and `plan-ticket-required.test.ts` run them against the real file and
// `sim/planTicketDoneSets.ts` against each named mutant (`mutation-floors.test.ts`). Pure data: no database.
import { expect } from 'vitest';
import type { TicketDoneEvidence } from '../../shared/plan.js';
import type { TicketDoneFacts } from '../src/coord/planPolicy.js';

export type PlanPolicyModule = typeof import('../src/coord/planPolicy.js');
export interface TicketDoneCase { name: string; run(m: PlanPolicyModule): void }

const open = (key: string, runId: number | null = null) => ({ key, state: 'open' as const, runId });
const RUN = 40;
const T = { id: 11, key: 't1', project: 'project-a', state: 'open' as const, runId: null };
/** A done work run of prog-a whose own ticket is its auto ticket `run-40` (id 90). */
const DONE_RUN = { program: 'prog-a', kind: 'work', state: 'done', ticketId: 90, ticketKey: 'run-40' };
const facts = (evidence: TicketDoneEvidence, over: Partial<TicketDoneFacts> = {}): TicketDoneFacts => ({
  program: 'prog-a', ticket: T, evidence,
  run: 'runId' in evidence ? DONE_RUN : null,
  landed: 'pr' in evidence ? { kind: 'landed' } : null,
  stored: [],
  links: { kind: 'read', pairs: [] },
  ...over,
});
const word = (v: ReturnType<PlanPolicyModule['ticketDoneVerdict']>): string => (v.ok ? 'ok' : v.word);
const parsed = (m: PlanPolicyModule, body: unknown): string => {
  const p = m.parsePlanTicketDone(body);
  return p.ok ? `ok:${p.done.ticket}:${JSON.stringify(p.done.evidence)}` : p.word;
};

export const REQUIRED_CASES: TicketDoneCase[] = [
  { name: 'ticket-required: a phased plan with an open declared ticket no run holds needs a named ticket',
    run: (m) => { expect(m.runMustNameTicket(true, [open('t1')])).toBe(true); } },
  { name: 'ticket-required: a plan with no phases never needs one',
    run: (m) => { expect(m.runMustNameTicket(false, [open('t1')])).toBe(false); } },
  { name: 'ticket-required: an epic with only auto tickets open admits the run',
    run: (m) => { expect(m.runMustNameTicket(true, [open('run-7')])).toBe(false); } },
  { name: 'ticket-required: a declared ticket a run holds does not count',
    run: (m) => { expect(m.runMustNameTicket(true, [open('t1', 9), { key: 't2', state: 'started', runId: 8 }])).toBe(false); } },
  { name: 'ticket-required: done and dropped declared tickets do not count',
    run: (m) => { expect(m.runMustNameTicket(true, [{ key: 't1', state: 'done', runId: null }, { key: 't2', state: 'dropped', runId: null }])).toBe(false); } },
  { name: 'ticket-required: one open declared ticket among held, auto and closed ones still needs a named ticket (review 2429 F9)',
    run: (m) => {
      expect(m.runMustNameTicket(true, [open('t1'), open('run-7'), { key: 't2', state: 'started', runId: 8 },
        { key: 't3', state: 'done', runId: null }])).toBe(true);
    } },
  { name: 'ticket-required: an epic with no tickets admits the run',
    run: (m) => { expect(m.runMustNameTicket(true, [])).toBe(false); } },
];

export const DONE_CASES: TicketDoneCase[] = [
  // The body (closed, exactly one evidence key, positive integers, the identity on the query).
  { name: 'body: a run or a pull request is accepted',
    run: (m) => {
      expect(parsed(m, { ticket: 't1', evidence: { runId: 4 } })).toBe('ok:t1:{"runId":4}');
      expect(parsed(m, { ticket: 't1', evidence: { pr: 7 } })).toBe('ok:t1:{"pr":7}');
    } },
  { name: 'body: two evidence keys are refused plan-bad-body',
    run: (m) => { expect(parsed(m, { ticket: 't1', evidence: { runId: 4, pr: 7 } })).toBe('plan-bad-body'); } },
  { name: 'body: no evidence key, or another key, is refused plan-bad-body',
    run: (m) => {
      expect(parsed(m, { ticket: 't1', evidence: {} })).toBe('plan-bad-body');
      expect(parsed(m, { ticket: 't1', evidence: { itemId: 3 } })).toBe('plan-bad-body');
      expect(parsed(m, { ticket: 't1' })).toBe('plan-bad-body');
    } },
  { name: 'body: evidence that is not a positive integer is refused plan-bad-body',
    run: (m) => {
      for (const ev of [{ runId: 0 }, { runId: -1 }, { runId: 1.5 }, { runId: 2 ** 53 }, { pr: '7' }, { pr: 0 }]) {
        expect(parsed(m, { ticket: 't1', evidence: ev }), JSON.stringify(ev)).toBe('plan-bad-body');
      }
    } },
  { name: 'body: a body naming byId or byUuid is refused plan-bad-body',
    run: (m) => {
      expect(parsed(m, { ticket: 't1', evidence: { runId: 4 }, byId: 'coord-a' })).toBe('plan-bad-body');
      expect(parsed(m, { ticket: 't1', evidence: { runId: 4 }, byUuid: 'u' })).toBe('plan-bad-body');
    } },
  { name: 'body: a ticket that is not a plan key is refused plan-bad-body',
    run: (m) => { expect(parsed(m, { ticket: 'A B', evidence: { runId: 4 } })).toBe('plan-bad-body'); } },

  // The ticket's own state, in plan ticket-move's words (F21).
  { name: 'verdict: a ticket a run holds is refused plan-runs-open',
    run: (m) => {
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { ticket: { ...T, runId: 5 } })))).toBe('plan-runs-open');
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { ticket: { ...T, state: 'started', runId: 5 } })))).toBe('plan-runs-open');
    } },
  { name: 'verdict: a ticket not open is refused plan-bad-body',
    run: (m) => {
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { ticket: { ...T, state: 'done' } })))).toBe('plan-bad-body');
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { ticket: { ...T, state: 'dropped' } })))).toBe('plan-bad-body');
    } },

  // { runId }: a work run of this programme, done, whose own ticket is this one, an auto ticket or none (review 2375 F2).
  { name: 'verdict: a done run of this programme whose own ticket is its auto ticket verifies',
    run: (m) => { expect(word(m.ticketDoneVerdict(facts({ runId: RUN })))).toBe('ok'); } },
  { name: 'verdict: a done run with no ticket of its own verifies',
    run: (m) => { expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { run: { ...DONE_RUN, ticketId: null, ticketKey: null } })))).toBe('ok'); } },
  { name: 'verdict: a done run whose own ticket is this ticket verifies',
    run: (m) => { expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { run: { ...DONE_RUN, ticketId: T.id, ticketKey: T.key } })))).toBe('ok'); } },
  { name: 'verdict: a run that does not exist is refused evidence-unverified',
    run: (m) => { expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { run: null })))).toBe('evidence-unverified'); } },
  { name: 'verdict: a run that is not done is refused evidence-unverified',
    run: (m) => {
      for (const state of ['working', 'merging', 'failed', 'abandoned']) {
        expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { run: { ...DONE_RUN, state } }))), state).toBe('evidence-unverified');
      }
    } },
  { name: 'verdict: a run of another programme is refused evidence-unverified',
    run: (m) => { expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { run: { ...DONE_RUN, program: 'prog-b' } })))).toBe('evidence-unverified'); } },
  { name: 'verdict: a review run is refused evidence-unverified',
    run: (m) => { expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { run: { ...DONE_RUN, kind: 'review' } })))).toBe('evidence-unverified'); } },
  { name: 'verdict: a run whose own ticket is another declared one is refused evidence-unverified',
    run: (m) => { expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { run: { ...DONE_RUN, ticketId: 12, ticketKey: 't2' } })))).toBe('evidence-unverified'); } },

  // { pr }: landed on the landing line for the ticket's own project (F19); no entry names the run instead.
  { name: 'verdict: a pull request landed for the ticket\'s project verifies',
    run: (m) => { expect(word(m.ticketDoneVerdict(facts({ pr: 7 })))).toBe('ok'); } },
  { name: 'verdict: a pull request the landing line holds but has not landed is refused evidence-unverified',
    run: (m) => { expect(word(m.ticketDoneVerdict(facts({ pr: 7 }, { landed: { kind: 'unlanded', state: 'pinned' } })))).toBe('evidence-unverified'); } },
  { name: 'verdict: a pull request with no landing entry is refused evidence-unverified, naming the run instead',
    run: (m) => {
      const v = m.ticketDoneVerdict(facts({ pr: 7 }, { landed: { kind: 'no-entry' } }));
      expect(word(v)).toBe('evidence-unverified');
      expect(v.ok ? '' : v.detail).toContain('name the run');
    } },
  { name: 'landed: what one project\'s landing line says of a pull request',
    run: (m) => {
      expect(m.landedFactOf([], 7)).toEqual({ kind: 'no-entry' });
      expect(m.landedFactOf([{ pr: 8, state: 'landed' }], 7)).toEqual({ kind: 'no-entry' });
      expect(m.landedFactOf([{ pr: 7, state: 'pinned' }], 7)).toEqual({ kind: 'unlanded', state: 'pinned' });
      expect(m.landedFactOf([{ pr: 7, state: 'ejected' }, { pr: 7, state: 'queued' }], 7)).toEqual({ kind: 'unlanded', state: 'queued' });
      expect(m.landedFactOf([{ pr: 7, state: 'landed' }, { pr: 7, state: 'queued' }], 7)).toEqual({ kind: 'landed' });
      // Ejected, then pinned again and landed: the pull request landed (review 2429 F6).
      expect(m.landedFactOf([{ pr: 7, state: 'ejected' }, { pr: 7, state: 'landed' }], 7)).toEqual({ kind: 'landed' });
    } },
  { name: 'verdict: an unreadable landing line is refused evidence-unverified',
    run: (m) => { expect(word(m.ticketDoneVerdict(facts({ pr: 7 }, { landed: { kind: 'unreadable', detail: 'landing-fenced' } })))).toBe('evidence-unverified'); } },

  // One piece of evidence closes at most one ticket (F2), except the run's own auto ticket, which folds in (review 2375 F2).
  { name: 'verdict: a run already stored on another ticket of the programme is refused evidence-unverified',
    run: (m) => {
      const stored = [{ ticketId: 12, key: 't2', project: 'project-a', evidence: { runId: RUN } }];
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { stored })))).toBe('evidence-unverified');
    } },
  { name: 'verdict: the run\'s own auto ticket holding its evidence does not refuse it',
    run: (m) => {
      const stored = [{ ticketId: 90, key: 'run-40', project: 'project-a', evidence: { runId: RUN } }];
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { stored })))).toBe('ok');
    } },
  { name: 'verdict: a run stored on a ticket of another project of the programme still refuses it (a run id is global; review 2429 F5)',
    run: (m) => {
      const stored = [{ ticketId: 12, key: 't2', project: 'project-b', evidence: { runId: RUN } }];
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { stored })))).toBe('evidence-unverified');
    } },
  { name: 'verdict: an auto ticket of ANOTHER run holding this run\'s evidence still refuses it',
    run: (m) => {
      const stored = [{ ticketId: 91, key: 'run-41', project: 'project-a', evidence: { runId: RUN } }];
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { stored })))).toBe('evidence-unverified');
    } },
  { name: 'verdict: a pull request already stored on another ticket of the same project is refused evidence-unverified',
    run: (m) => {
      const stored = [{ ticketId: 12, key: 't2', project: 'project-a', evidence: { pr: 7 } }];
      expect(word(m.ticketDoneVerdict(facts({ pr: 7 }, { stored })))).toBe('evidence-unverified');
    } },
  { name: 'verdict: the same pull request number of another project is another pull request',
    run: (m) => {
      const stored = [{ ticketId: 12, key: 't2', project: 'project-b', evidence: { pr: 7 } }];
      expect(word(m.ticketDoneVerdict(facts({ pr: 7 }, { stored })))).toBe('ok');
    } },
  { name: 'verdict: a different run or pull request stored elsewhere does not refuse',
    run: (m) => {
      const stored = [{ ticketId: 12, key: 't2', project: 'project-a', evidence: { runId: RUN + 1 } },
        { ticketId: 13, key: 't3', project: 'project-a', evidence: { pr: RUN } }];
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { stored })))).toBe('ok');
    } },

  // A run and the pull request it carried are one piece of work (review 2429 F2, the coordinator's ruling): the landing
  // line's link ties evidence of one kind to evidence of the other kind already stored.
  { name: 'verdict: a pull request whose landing entry names a run stored on another ticket is refused evidence-unverified',
    run: (m) => {
      const stored = [{ ticketId: 12, key: 't2', project: 'project-a', evidence: { runId: RUN } }];
      const tied = { kind: 'read' as const, pairs: [{ project: 'project-a', pr: 7, runId: RUN }] };
      expect(word(m.ticketDoneVerdict(facts({ pr: 7 }, { stored, links: tied })))).toBe('evidence-unverified');
      // Control: the landing line ties the pull request to another run.
      const other = { kind: 'read' as const, pairs: [{ project: 'project-a', pr: 7, runId: RUN + 1 }] };
      expect(word(m.ticketDoneVerdict(facts({ pr: 7 }, { stored, links: other })))).toBe('ok');
    } },
  { name: 'verdict: a run a landing entry ties to a pull request stored on another ticket is refused evidence-unverified',
    run: (m) => {
      const stored = [{ ticketId: 12, key: 't2', project: 'project-a', evidence: { pr: 7 } }];
      const tied = { kind: 'read' as const, pairs: [{ project: 'project-a', pr: 7, runId: RUN }] };
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { stored, links: tied })))).toBe('evidence-unverified');
      // Control: the same number on another project's line is another pull request.
      const elsewhere = { kind: 'read' as const, pairs: [{ project: 'project-b', pr: 7, runId: RUN }] };
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { stored, links: elsewhere })))).toBe('ok');
    } },
  { name: 'verdict: the run\'s own auto ticket holding the run its pull request carried does not refuse the pull request',
    run: (m) => {
      const stored = [{ ticketId: 90, key: 'run-40', project: 'project-a', evidence: { runId: RUN } }];
      const tied = { kind: 'read' as const, pairs: [{ project: 'project-a', pr: 7, runId: RUN }] };
      expect(word(m.ticketDoneVerdict(facts({ pr: 7 }, { stored, links: tied })))).toBe('ok');
    } },
  { name: 'verdict: a link between runs and pull requests that cannot be read is refused evidence-unverified',
    run: (m) => {
      const links = { kind: 'unreadable' as const, detail: 'project-a: landing-fenced' };
      expect(word(m.ticketDoneVerdict(facts({ runId: RUN }, { links })))).toBe('evidence-unverified');
      expect(word(m.ticketDoneVerdict(facts({ pr: 7 }, { links })))).toBe('evidence-unverified');
    } },
];

export const TICKET_DONE_CASES: TicketDoneCase[] = [...REQUIRED_CASES, ...DONE_CASES];
