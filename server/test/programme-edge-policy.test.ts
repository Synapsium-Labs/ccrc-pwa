// Programme lifecycle W2 (spec 2026-11-24 §5, §8, §14; D-8987, D-8992, D-8993): the doors' L1 decisions, row by row. Pure:
// no store, no clock, no registry.
import { describe, expect, it } from 'vitest';
import {
  OPERATOR_DOOR_CREDENTIALS, doorCredential, edgeDecision, endProposalDecision, endProposalItem, parseEvidence, type EdgeFacts, type EdgeRequest,
} from '../src/coord/programmeEdgePolicy.js';
import { PROGRAMME_DOOR_ACTS } from '../../shared/programmeLifecycle.js';

const live: EdgeFacts = { stored: 'active', placeholder: null, openRuns: 0 };
const decide = (f: Partial<EdgeFacts>, req: EdgeRequest) => edgeDecision({ ...live, ...f }, req);

describe('edgeDecision: spec §5 transition table', () => {
  it('pause: a live programme pauses; an ended one is programme-ended; an unreadable one is programme-unknown', () => {
    expect(decide({}, { edge: 'pause' })).toEqual({ ok: true, kind: 'decide', to: 'paused', event: 'pause', abandonRuns: false });
    expect(decide({ openRuns: 2 }, { edge: 'pause' })).toMatchObject({ ok: true, to: 'paused' });
    expect(decide({ stored: 'done' }, { edge: 'pause' })).toMatchObject({ ok: false, why: 'programme-ended' });
    expect(decide({ stored: 'unknown' }, { edge: 'pause' })).toMatchObject({ ok: false, why: 'programme-unknown' });
    expect(decide({ stored: 'retired-by-hand' }, { edge: 'pause' })).toMatchObject({ ok: false, why: 'programme-unknown' });
  });

  it('resume: only from paused, to active', () => {
    expect(decide({ stored: 'paused' }, { edge: 'resume' })).toMatchObject({ ok: true, to: 'active', event: 'resume' });
    expect(decide({}, { edge: 'resume' })).toMatchObject({ ok: false, why: 'not-paused' });
  });

  it('reopen: only from an end, to active', () => {
    for (const stored of ['done', 'abandoned']) {
      expect(decide({ stored }, { edge: 'reopen' })).toMatchObject({ ok: true, to: 'active', event: 'reopened' });
    }
    expect(decide({}, { edge: 'reopen' })).toMatchObject({ ok: false, why: 'not-ended' });
  });

  it('end with no open run ends as asked; over open runs it is refused without abandonRuns', () => {
    expect(decide({}, { edge: 'end', outcome: 'done', abandonRuns: false })).toMatchObject({ ok: true, to: 'done', event: 'ended', abandonRuns: false });
    expect(decide({ stored: 'paused' }, { edge: 'end', outcome: 'abandoned', abandonRuns: false })).toMatchObject({ ok: true, to: 'abandoned' });
    expect(decide({ openRuns: 1 }, { edge: 'end', outcome: 'abandoned', abandonRuns: false })).toMatchObject({ ok: false, why: 'programme-runs-open' });
  });

  it('end over open runs with abandonRuns is Abandoned and asks the door to abandon them; Done is refused over open runs', () => {
    expect(decide({ openRuns: 2 }, { edge: 'end', outcome: 'abandoned', abandonRuns: true }))
      .toEqual({ ok: true, kind: 'decide', to: 'abandoned', event: 'ended', abandonRuns: true });
    expect(decide({ openRuns: 2 }, { edge: 'end', outcome: 'done', abandonRuns: true })).toMatchObject({ ok: false, why: 'programme-runs-open' });
    // abandonRuns over no open run abandons nothing.
    expect(decide({}, { edge: 'end', outcome: 'abandoned', abandonRuns: true })).toMatchObject({ ok: true, abandonRuns: false });
  });

  it('end of an ended programme is programme-ended; of an unreadable one, programme-unknown (repair is its way)', () => {
    expect(decide({ stored: 'abandoned' }, { edge: 'end', outcome: 'done', abandonRuns: false })).toMatchObject({ ok: false, why: 'programme-ended' });
    expect(decide({ stored: 'unknown' }, { edge: 'end', outcome: 'done', abandonRuns: false })).toMatchObject({ ok: false, why: 'programme-unknown' });
  });

  it('repair: only an unreadable stored value; an end target keeps the end\'s guards and never abandons', () => {
    expect(decide({ stored: 'unknown' }, { edge: 'repair', to: 'paused' })).toMatchObject({ ok: true, to: 'paused', event: 'repaired' });
    expect(decide({ stored: 'weird' }, { edge: 'repair', to: 'active' })).toMatchObject({ ok: true, to: 'active', event: 'repaired' });
    expect(decide({ stored: 'unknown' }, { edge: 'repair', to: 'done' })).toMatchObject({ ok: true, to: 'done', event: 'repaired' });
    expect(decide({ stored: 'unknown', openRuns: 1 }, { edge: 'repair', to: 'done' })).toMatchObject({ ok: false, why: 'programme-runs-open' });
    for (const stored of ['active', 'paused', 'done', 'abandoned']) {
      expect(decide({ stored }, { edge: 'repair', to: 'active' })).toMatchObject({ ok: false, why: 'not-unknown' });
    }
  });

  it('hand-over: any programme that has not ended', () => {
    expect(decide({}, { edge: 'hand-over' })).toEqual({ ok: true, kind: 'hand-over' });
    expect(decide({ stored: 'paused' }, { edge: 'hand-over' })).toEqual({ ok: true, kind: 'hand-over' });
    expect(decide({ stored: 'done' }, { edge: 'hand-over' })).toMatchObject({ ok: false, why: 'programme-ended' });
  });

  it('every edge refuses a placeholder (programme-provisional), filed, withdrawn or not', () => {
    const reqs: EdgeRequest[] = [{ edge: 'pause' }, { edge: 'resume' }, { edge: 'reopen' }, { edge: 'hand-over' },
      { edge: 'end', outcome: 'done', abandonRuns: false }, { edge: 'repair', to: 'active' }];
    for (const placeholder of ['unfiled', 'filed', 'withdrawn']) {
      for (const req of reqs) expect(decide({ placeholder }, req), `${placeholder} ${req.edge}`).toMatchObject({ ok: false, why: 'programme-provisional' });
    }
  });
});

describe('doorCredential: spec §14, one table', () => {
  it('pause and decline work dark; the start takes the gate; the rest take the step-up', () => {
    expect(OPERATOR_DOOR_CREDENTIALS).toEqual({
      pause: 'dark-ok', 'decline-end': 'dark-ok', start: 'gate',
      resume: 'step-up', end: 'step-up', reopen: 'step-up', repair: 'step-up', 'hand-over': 'step-up', 'confirm-end': 'step-up',
    });
    for (const act of PROGRAMME_DOOR_ACTS) expect(doorCredential(act, 'operator')).toBe(OPERATOR_DOOR_CREDENTIALS[act]);
  });

  it('every edge is allowed for the Overlord without a step-up: its rung cell is the whole permission', () => {
    for (const act of PROGRAMME_DOOR_ACTS) expect(doorCredential(act, 'overlord')).toBe('rung');
  });
});

describe('endProposalDecision: spec §8', () => {
  const base = { stored: 'active', placeholder: null, openRuns: 0, openProposal: null, evidence: ['shipped'] };
  it('admits a live programme with no open run, no open proposal and evidence', () => {
    expect(endProposalDecision(base)).toEqual({ ok: true });
    expect(endProposalDecision({ ...base, stored: 'paused' })).toEqual({ ok: true });
  });
  it('refuses, in order: a placeholder, an ended programme, open runs, an open proposal, no evidence', () => {
    expect(endProposalDecision({ ...base, placeholder: 'unfiled' })).toMatchObject({ ok: false, why: 'programme-provisional' });
    expect(endProposalDecision({ ...base, stored: 'done' })).toMatchObject({ ok: false, why: 'programme-ended' });
    expect(endProposalDecision({ ...base, openRuns: 1 })).toMatchObject({ ok: false, why: 'programme-runs-open' });
    expect(endProposalDecision({ ...base, openProposal: 7 })).toMatchObject({ ok: false, why: 'already-asked', detail: expect.stringContaining('7') });
    expect(endProposalDecision({ ...base, evidence: [] })).toMatchObject({ ok: false, why: 'evidence-required' });
  });
});

describe('parseEvidence and the proposal item', () => {
  it('reads absent as none, refuses a bad shape, trims lines', () => {
    expect(parseEvidence(undefined)).toEqual([]);
    expect(parseEvidence([' a ', 'b'])).toEqual(['a', 'b']);
    expect(parseEvidence('a')).toBeNull();
    expect(parseEvidence(['', 'b'])).toBeNull();
    expect(parseEvidence([1])).toBeNull();
  });

  it('with a pinned definition of done, each pinned line is answered by its evidence or "no evidence given"', () => {
    const item = endProposalItem({ title: 'Programme A', outcome: 'done', why: 'all shipped', evidence: ['PR 12 landed'],
      doneWhen: ['the feature ships', 'the docs are written'] });
    expect(item.how).toEqual(['the feature ships: PR 12 landed', 'the docs are written: no evidence given']);
    expect(item.title).toBe('End programme as Done: Programme A');
    expect(item.options).toEqual(['End the programme', 'Keep it open']);
    expect(item.why).toMatch(/^all shipped\nProposed outcome: Done\./);
  });

  it('with no pin, the item says no definition of done was pinned and carries the free lines', () => {
    const item = endProposalItem({ title: 'Programme A', outcome: 'abandoned', why: 'superseded', evidence: ['moved to B'], doneWhen: null });
    expect(item.how).toEqual(['No definition of done was pinned; the coordinator\'s evidence:', 'moved to B']);
    expect(item.title).toBe('End programme as Abandoned: Programme A');
  });
});
