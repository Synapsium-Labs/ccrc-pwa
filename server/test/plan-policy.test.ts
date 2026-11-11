// D-8181: the plan deciders (`coord/planPolicy.ts`), pure.
import { describe, it, expect } from 'vitest';
import {
  diffPlan, epicForWave, epicIsDone, linearOwnerOf, parsePlanClose, parsePlanPut, parsePlanTicketAdd, planCallerVerdict, programmeEnd,
  type OwnerFacts, type PlanCtx,
} from '../src/coord/planPolicy.js';
import type { StoredPlan } from '../src/coord/planStore.js';
import type { PlanEpicBody, PlanPutBody } from '../../shared/plan.js';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const epic = (i: number | string, over: Partial<PlanEpicBody> = {}): PlanEpicBody => ({
  key: `e-${i}`, title: `Epic ${i}`, summary: 's', waves: [], checkpoints: [], ...over,
});
const ctx = (over: Partial<PlanCtx> = {}): PlanCtx => ({ home: 'project-a', doneWhenCount: 3, workspaceOfProject: () => 'ws-a', ...over });
const emptyStored: StoredPlan = { program: 'prog-a', planBy: null, required: true, epics: [] };
const storedEpic = (key: string, over: Record<string, unknown> = {}): StoredPlan['epics'][number] => ({
  id: 1, program: 'prog-a', project: 'project-a', waves: [1], key, ordinal: 0, title: key, summary: 's', state: 'planned',
  droppedWhy: null, putBackAt: null, openedAt: null, doneAt: null, checkpoints: [], tickets: [], ...over,
} as StoredPlan['epics'][number]);
const stored = (...epics: StoredPlan['epics']): StoredPlan => ({ ...emptyStored, epics });
const put = (...epics: PlanEpicBody[]): PlanPutBody => ({ epics });

describe('parsePlanPut', () => {
  it('25 epics is plan-too-large', () =>
    expect(parsePlanPut({ epics: range(25).map((i) => epic(i)) })).toMatchObject({ ok: false, word: 'plan-too-large' }));
  it('17 checkpoints in an epic and 201 tickets in a body are plan-too-large', () => {
    const cps = range(17).map((i) => ({ key: `c-${i}`, title: 't', kind: 'acceptance' as const }));
    expect(parsePlanPut({ epics: [epic(1, { checkpoints: cps })] })).toMatchObject({ ok: false, word: 'plan-too-large' });
    const tks = range(201).map((i) => ({ key: `t-${i}`, kind: 'work' as const, title: 't' }));
    expect(parsePlanPut({ epics: [epic(1, { tickets: tks })] })).toMatchObject({ ok: false, word: 'plan-too-large' });
  });
  it('a 256-code-point title is plan-bad-body; 255 is fine; a control character is plan-bad-body', () => {
    expect(parsePlanPut({ epics: [epic(1, { title: 'x'.repeat(256) })] })).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(parsePlanPut({ epics: [epic(1, { title: '\u{1F600}'.repeat(255) })] })).toMatchObject({ ok: true });
    expect(parsePlanPut({ epics: [epic(1, { title: 'a\u0007b' })] })).toMatchObject({ ok: false, word: 'plan-bad-body' });
  });
  it('proves [5] on a programme with 3 done-when entries is plan-bad-body', () => {
    const cp = { key: 'c-1', title: 't', kind: 'acceptance' as const, proves: [5] };
    expect(parsePlanPut({ epics: [epic(1, { checkpoints: [cp] })] }, { doneWhenCount: 3 })).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(parsePlanPut({ epics: [epic(1, { checkpoints: [{ ...cp, proves: [2] }] })] }, { doneWhenCount: 3 })).toMatchObject({ ok: true });
  });
  it('a put on an absent programme with no home is plan-bad-body', () => {
    expect(parsePlanPut({ epics: [] }, { home: { stored: null } })).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(parsePlanPut({ home: 'project-a', epics: [] }, { home: { stored: null } })).toMatchObject({ ok: true });
    expect(parsePlanPut({ home: 'project-b', epics: [] }, { home: { stored: 'project-a' } })).toMatchObject({ ok: false, word: 'plan-bad-body' });
  });
  it('an unknown field, a bad key, a repeated key and itemId on a non-operator-act are plan-bad-body', () => {
    expect(parsePlanPut({ epics: [], extra: 1 })).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(parsePlanPut({ epics: [{ ...epic(1), extra: 1 }] })).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(parsePlanPut({ epics: [epic('Bad Key')] })).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(parsePlanPut({ epics: [epic(1), epic(1)] })).toMatchObject({ ok: false, word: 'plan-bad-body' });
    const cp = { key: 'c-1', title: 't', kind: 'measured' as const, itemId: 4 };
    expect(parsePlanPut({ epics: [epic(1, { checkpoints: [cp] })] })).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(parsePlanPut({ epics: [epic(1, { checkpoints: [{ ...cp, kind: 'operator-act' }] })] })).toMatchObject({ ok: true });
  });
});

describe('the auto ticket prefix is reserved', () => {
  const tk = (key: string) => ({ key, kind: 'work' as const, title: 't' });
  it('ticket-add of a run-<n> key is plan-bad-body; another key is fine', () => {
    expect(parsePlanTicketAdd({ epic: 'e-1', ...tk('run-7') })).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(parsePlanTicketAdd({ epic: 'e-1', ...tk('rerun-7') })).toMatchObject({ ok: true });
  });
  it('a put that adds a run-<n> ticket is plan-bad-body; restating a stored auto ticket is not', () => {
    expect(diffPlan(emptyStored, put(epic(1, { waves: [1], tickets: [tk('run-7')] })), ctx())).toMatchObject({ ok: false, word: 'plan-bad-body' });
    const auto = { id: 9, program: 'prog-a', project: 'project-a', epicId: 1, checkpointId: null, key: 'run-7', kind: 'work', title: 't',
      body: '', source: 'plan', state: 'open', runId: 7, droppedWhy: null, putBackAt: null };
    const s = stored(storedEpic('e-1', { tickets: [auto] }));
    expect(diffPlan(s, put(epic(1, { waves: [1], tickets: [tk('run-7')] })), ctx())).toMatchObject({ ok: true });
  });
});

describe('diffPlan', () => {
  it('waves 2 and 4 in one epic is waves-not-contiguous', () =>
    expect(diffPlan(emptyStored, put(epic(1, { waves: [2, 4] })), ctx())).toMatchObject({ ok: false, word: 'waves-not-contiguous' }));
  it('wave 3 in two live epics is wave-overlap; in a dropped one it is not', () => {
    expect(diffPlan(emptyStored, put(epic(1, { waves: [3] }), epic(2, { waves: [3] })), ctx())).toMatchObject({ ok: false, word: 'wave-overlap' });
    const s = stored(storedEpic('e-1', { waves: [3] }), storedEpic('e-2', { id: 2, waves: [4] }));
    const r = diffPlan(s, put(epic(1, { waves: [3], droppedWhy: 'gone' }), epic(2, { waves: [3, 4] })), ctx());
    expect(r.ok).toBe(true);
  });
  it('a vanished epic key without droppedWhy is dropped-needs-reason; with droppedWhy it is dropped', () => {
    const s = stored(storedEpic('e-1'));
    expect(diffPlan(s, put(), ctx())).toMatchObject({ ok: false, word: 'dropped-needs-reason' });
    const r = diffPlan(s, put(epic(1, { waves: [1], droppedWhy: 'out of scope' })), ctx());
    expect(r).toMatchObject({ ok: true, changes: { epics: { drop: [{ id: 1, why: 'out of scope' }] } } });
  });
  it('a ticket of project-b in an epic of project-a across workspaces is ticket-workspace-mismatch', () => {
    const c = ctx({ workspaceOfProject: (p) => (p === 'project-a' ? 'ws-a' : 'ws-b') });
    const e = epic(1, { tickets: [{ key: 't-1', kind: 'work', title: 't', project: 'project-b' }] });
    expect(diffPlan(emptyStored, put(e), c)).toMatchObject({ ok: false, word: 'ticket-workspace-mismatch' });
    expect(diffPlan(emptyStored, put(e), ctx())).toMatchObject({ ok: true });
  });
  it('a new epic inserts with its checkpoints and tickets; a re-put of the same plan changes nothing', () => {
    const e = epic(1, {
      waves: [1], checkpoints: [{ key: 'c-1', title: 'C', kind: 'acceptance' }],
      tickets: [{ key: 't-1', kind: 'work', title: 'T', checkpoint: 'c-1' }],
    });
    const r = diffPlan(emptyStored, put(e), ctx());
    expect(r).toMatchObject({ ok: true, changes: {
      epics: { insert: [{ key: 'e-1', project: 'project-a', waves: [1], ordinal: 0 }] },
      checkpoints: { insert: [{ epicKey: 'e-1', key: 'c-1' }] },
      tickets: { insert: [{ program: 'prog-a', epicKey: 'e-1', checkpointKey: 'c-1', key: 't-1', source: 'plan' }] },
    } });
    const same = stored(storedEpic('e-1', { title: 'Epic 1', waves: [1] }));
    const again = diffPlan(same, put(epic(1, { waves: [1] })), ctx());
    expect(again).toMatchObject({ ok: true, changes: { epics: { insert: [], update: [], drop: [] } } });
  });
  it('a met checkpoint is not re-opened or rewritten by a put', () => {
    const cp = { id: 9, epicId: 1, key: 'c-1', ordinal: 0, title: 'Old', kind: 'acceptance', proves: [], state: 'met', droppedWhy: null, putBackAt: null, metAt: 5, evidence: { pr: 1 }, itemId: null };
    const s = stored(storedEpic('e-1', { checkpoints: [cp] }));
    const r = diffPlan(s, put(epic(1, { waves: [1], checkpoints: [{ key: 'c-1', title: 'New', kind: 'acceptance' }] })), ctx());
    expect(r).toMatchObject({ ok: true, changes: { checkpoints: { update: [] } } });
  });
});

describe('parsePlanClose', () => {
  it('abandoned close with no why is dropped-needs-reason', () => {
    expect(parsePlanClose({ outcome: 'abandoned' })).toMatchObject({ ok: false, word: 'dropped-needs-reason' });
    expect(parsePlanClose({ outcome: 'abandoned', why: 'cancelled' })).toMatchObject({ ok: true });
    expect(parsePlanClose({ outcome: 'done' })).toMatchObject({ ok: true });
    expect(parsePlanClose({ outcome: 'later' })).toMatchObject({ ok: false, word: 'plan-bad-body' });
  });
});

describe('states', () => {
  it('epicIsDone: all met or dropped and no open or started ticket', () => {
    expect(epicIsDone([{ state: 'met' }, { state: 'dropped' }], [{ state: 'done' }])).toBe(true);
    expect(epicIsDone([{ state: 'open' }], [])).toBe(false);
    expect(epicIsDone([{ state: 'met' }], [{ state: 'started' }])).toBe(false);
  });
  it('programmeEnd: state done with a planned epic is live; abandoned with no planEnd is live; planEnd wins', () => {
    const base = { planEnd: null, programState: 'done' as const, epics: [{ state: 'planned' as const }], openTickets: 0 };
    expect(programmeEnd(base)).toBeNull();
    expect(programmeEnd({ ...base, programState: 'abandoned', epics: [{ state: 'done' }] })).toBeNull();
    expect(programmeEnd({ ...base, epics: [{ state: 'done' }, { state: 'dropped' }] })).toBe('done');
    expect(programmeEnd({ ...base, epics: [] })).toBeNull();
    expect(programmeEnd({ ...base, epics: [{ state: 'done' }], openTickets: 1 })).toBeNull();
    expect(programmeEnd({ ...base, planEnd: 'abandoned' })).toBe('abandoned');
  });
  it('epicForWave finds the live epic that lists the wave', () => {
    const es = [{ id: 1, waves: [1, 2], state: 'dropped' as const }, { id: 2, waves: [2, 3], state: 'active' as const }];
    expect(epicForWave(es, 2)).toBe(2);
    expect(epicForWave(es, 9)).toBeNull();
  });
});

describe('callers and owners', () => {
  it('a worker files a follow-up into its own epic only', () => {
    const run = { program: 'prog-a', epicId: 4 };
    expect(planCallerVerdict('worker', 'coord', 'follow-up', run)).toEqual({ ok: true });
    expect(planCallerVerdict('worker', 'coord', 'follow-up', run, { program: 'prog-a', epicId: 5 })).toMatchObject({ ok: false, word: 'not-plan-owner' });
    expect(planCallerVerdict('worker', 'coord', 'follow-up', null)).toMatchObject({ ok: false });
    expect(planCallerVerdict('worker', 'coord', 'programme', run)).toMatchObject({ ok: false });
    expect(planCallerVerdict('coord', 'coord', 'programme', null)).toEqual({ ok: true });
    expect(planCallerVerdict('first', null, 'programme', null)).toEqual({ ok: true });
  });
  const facts = (over: Partial<OwnerFacts> = {}): OwnerFacts => ({
    named: null, ownsTeamProject: null, latestProgrammeCoordinator: (p) => `coord-of-${p}`, presence: () => 'alive', ...over,
  });
  it("the Linear owner of a shared key is the owning project's, and the default is the latest programme's coordinator", () => {
    expect(linearOwnerOf('project-b', facts({ ownsTeamProject: 'project-a' }))).toEqual({ id: 'coord-of-project-a', source: 'default', live: true, gone: false });
    expect(linearOwnerOf('project-a', facts({ named: 'ws-x' }))).toMatchObject({ id: 'ws-x', source: 'named' });
    expect(linearOwnerOf('project-a', facts({ latestProgrammeCoordinator: () => null }))).toMatchObject({ id: null, source: 'none', live: false });
  });
  it('an owner whose presence is unmeasured is not gone, and not live', () => {
    expect(linearOwnerOf('project-a', facts({ presence: () => 'unmeasured' }))).toMatchObject({ live: false, gone: false });
    expect(linearOwnerOf('project-a', facts({ presence: () => 'dead' }))).toMatchObject({ live: false, gone: true });
    expect(linearOwnerOf('project-a', facts({ presence: () => 'absent' }))).toMatchObject({ gone: true });
  });
});
