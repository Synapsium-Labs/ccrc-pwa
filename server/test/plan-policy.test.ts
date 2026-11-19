// D-8181: the plan deciders (`coord/planPolicy.ts`), pure.
import { describe, it, expect } from 'vitest';
import {
  diffPlan, epicForWave, epicIsDone, linearOwnerOf, listedWaves, parsePlanClose, parsePlanPut, parsePlanTicketAdd, planCallerVerdict, programmeEnd,
  ticketIsHeld, linearOwnerOfProject, linearOwnerOfTeam, parsePlanTake, parsePlanTriage, teamOwnerProject, triageVerdict,
  type OwnerFacts, type PlanCtx,
} from '../src/coord/planPolicy.js';
import * as policy from '../src/coord/planPolicy.js';
import { EPIC_FOR_OPEN_CASES } from './planEpicForOpenCases.js';
import type { HierarchyProjectFacts, InboundRow } from '../src/coord/planStore.js';
import { TRIAGE_DECISIONS } from '../../shared/plan.js';
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
  it('ticketIsHeld: started, or open with a run (a planned run); a done ticket keeps its runId and is not held', () => {
    expect(ticketIsHeld({ state: 'started', runId: 1 })).toBe(true);
    expect(ticketIsHeld({ state: 'open', runId: 1 })).toBe(true);
    expect(ticketIsHeld({ state: 'open', runId: null })).toBe(false);
    expect(ticketIsHeld({ state: 'done', runId: 1 })).toBe(false);
    expect(ticketIsHeld({ state: 'dropped', runId: 1 })).toBe(false);
  });
  it('diffPlan: a droppedWhy on an epic a run holds a ticket of is plan-runs-open; otherwise its open checkpoints and tickets drop with it', () => {
    const cps = [{ id: 7, state: 'open' }, { id: 8, state: 'met' }];
    const held = stored(storedEpic('e1', { checkpoints: cps, tickets: [{ id: 5, key: 't1', state: 'open', runId: 3 }] }));
    const r = diffPlan(held, put(epic(1, { key: 'e1', droppedWhy: 'cut' })), ctx());
    expect(r.ok ? null : r.word).toBe('plan-runs-open');
    const free = stored(storedEpic('e1', { checkpoints: cps, tickets: [{ id: 5, key: 't1', state: 'open', runId: null }, { id: 6, key: 't2', state: 'done', runId: 2 }] }));
    const d = diffPlan(free, put(epic(1, { key: 'e1', droppedWhy: 'cut' })), ctx());
    if (!d.ok) throw new Error(d.word);
    expect([d.changes.epics.drop, d.changes.checkpoints.drop, d.changes.tickets.drop])
      .toEqual([[{ id: 1, why: 'cut' }], [{ id: 7, why: 'cut' }], [{ id: 5, why: 'cut' }]]);
  });
  it('epicForWave finds the live epic that lists the wave', () => {
    const es = [{ id: 1, waves: [1, 2], state: 'dropped' as const }, { id: 2, waves: [2, 3], state: 'active' as const }];
    expect(epicForWave(es, 2)).toBe(2);
    expect(epicForWave(es, 9)).toBeNull();
  });
});

describe('epics without wave ranges (programme work map WM6, D-8780)', () => {
  const noWaves = (i: number | string, over: Partial<PlanEpicBody> = {}): PlanEpicBody => {
    const { waves: _w, ...rest } = epic(i, over);
    return rest as PlanEpicBody;
  };
  it('an epic that omits waves parses, and a new one lists none', () => {
    expect(parsePlanPut({ epics: [noWaves(1), noWaves(2)] })).toMatchObject({ ok: true });
    expect(diffPlan(emptyStored, put(noWaves(1), noWaves(2), epic(3, { waves: [1, 2] })), ctx())).toMatchObject({
      ok: true, changes: { epics: { insert: [{ key: 'e-1', waves: [] }, { key: 'e-2', waves: [] }, { key: 'e-3', waves: [1, 2] }] } },
    });
  });
  it('waves that are not a list are plan-bad-body, absent or not', () => {
    expect(parsePlanPut({ epics: [{ ...noWaves(1), waves: 'all' }] })).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(parsePlanPut({ epics: [{ ...noWaves(1), waves: null }] })).toMatchObject({ ok: false, word: 'plan-bad-body' });
  });
  // Review 2791 F6, the coordinator's ruling: a put that omits `waves` KEEPS the stored range; an explicit [] clears it.
  it('a put that omits the waves of a stored epic keeps its range', () => {
    const r = diffPlan(stored(storedEpic('e-1', { waves: [1] })), put(noWaves(1)), ctx());
    expect(r.ok && r.changes.epics.update.some((u) => 'waves' in u)).toBe(false);
  });
  it('an explicit empty list clears the stored range', () => {
    const r = diffPlan(stored(storedEpic('e-1', { waves: [1] })), put(epic(1, { waves: [] })), ctx());
    expect(r).toMatchObject({ ok: true, changes: { epics: { update: [{ id: 1, waves: [] }] } } });
  });
  it('an epic that keeps its range by omission still holds it: another epic cannot take a wave in it', () => {
    const s = stored(storedEpic('e-1', { waves: [1, 2] }));
    expect(diffPlan(s, put(noWaves(1), epic(2, { waves: [2, 3] })), ctx())).toMatchObject({ ok: false, word: 'wave-overlap' });
  });
  it('contiguity and overlap are read among the epics that list waves', () => {
    expect(diffPlan(emptyStored, put(noWaves(1), epic(2, { waves: [2, 4] })), ctx())).toMatchObject({ ok: false, word: 'waves-not-contiguous' });
    expect(diffPlan(emptyStored, put(noWaves(1), epic(2, { waves: [3] }), epic(3, { waves: [3] })), ctx())).toMatchObject({ ok: false, word: 'wave-overlap' });
  });
  it('listedWaves: a list is its own range, [] included; an absent list keeps the stored range, else lists none', () => {
    expect(listedWaves({ waves: [2, 3] }, [1])).toEqual([2, 3]);
    expect(listedWaves({ waves: [] }, [1])).toEqual([]);
    expect(listedWaves({}, [1])).toEqual([1]);
    expect(listedWaves({})).toEqual([]);
  });
  describe('epicForOpen: EPIC_FOR_OPEN_CASES of planEpicForOpenCases.ts', () => {
    it.each(EPIC_FOR_OPEN_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => { c.run(policy); });
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

// ── The inbound path's deciders (D-8183, Task 4.3) ──

const projectFacts = (project: string, over: Partial<HierarchyProjectFacts> = {}): HierarchyProjectFacts =>
  ({ project, teamKey: 'AAA', initiatives: 'on', linearOwner: null, ownsTeam: false, order: null, ...over });

describe('teamOwnerProject (D-8183)', () => {
  it('the project marked ownsTeam owns the team key', () => {
    const rows = [projectFacts('project-a', { order: 1 }), projectFacts('project-b', { order: 2, ownsTeam: true })];
    expect(teamOwnerProject('AAA', rows)).toBe('project-b');
  });
  it('with none marked, the first project that set the key owns it, whatever the row order', () => {
    const rows = [projectFacts('project-b', { order: 5 }), projectFacts('project-a', { order: 2 }), projectFacts('project-c', { order: null })];
    expect(teamOwnerProject('aaa', rows)).toBe('project-a');
  });
  it('a key no project holds has no owning project, and another team key is not counted', () => {
    expect(teamOwnerProject('BBB', [projectFacts('project-a', { order: 1 })])).toBeNull();
    expect(teamOwnerProject('AAA', [projectFacts('project-a', { teamKey: 'BBB', order: 1, ownsTeam: true })])).toBeNull();
  });
  it('a project with a key and no order still owns it when it is the only one', () => {
    expect(teamOwnerProject('AAA', [projectFacts('project-a', { order: null })])).toBe('project-a');
  });
});

describe('linearOwnerOfTeam (D-8183)', () => {
  const f = { latestProgrammeCoordinator: (p: string) => `coord-of-${p}`, presence: () => 'alive' as const };
  it("answers the owning project's named owner, else its latest programme's coordinator", () => {
    const rows = [projectFacts('project-a', { order: 1, linearOwner: 'coord-x' }), projectFacts('project-b', { order: 2 })];
    expect(linearOwnerOfTeam('AAA', rows, f)).toMatchObject({ project: 'project-a', id: 'coord-x', source: 'named', live: true });
    expect(linearOwnerOfTeam('AAA', [projectFacts('project-b', { order: 2 })], f)).toMatchObject({ project: 'project-b', id: 'coord-of-project-b', source: 'default' });
  });
  it('a team no project holds has no owner row at all', () => {
    expect(linearOwnerOfTeam('CCC', [projectFacts('project-a', { order: 1 })], f)).toBeNull();
  });
});

describe('linearOwnerOfProject (D-8183)', () => {
  const f = { latestProgrammeCoordinator: (p: string) => `coord-of-${p}`, presence: () => 'alive' as const };
  it("a project with no key is its own owner's; a sharing project answers the team's owning project", () => {
    const rows = [projectFacts('project-a', { teamKey: null, linearOwner: 'coord-x' }), projectFacts('project-b', { order: 1 }), projectFacts('project-c', { order: 2, linearOwner: 'coord-c' })];
    expect(linearOwnerOfProject('project-a', rows, f)).toMatchObject({ project: 'project-a', id: 'coord-x', source: 'named' });
    expect(linearOwnerOfProject('project-c', rows, f)).toMatchObject({ project: 'project-b', id: 'coord-of-project-b', source: 'default' });
    expect(linearOwnerOfProject('project-b', rows, f)).toMatchObject({ project: 'project-b', id: 'coord-of-project-b' });
  });
  it('a project that is in no row has no named owner and only the default', () => {
    expect(linearOwnerOfProject('project-z', [], f)).toMatchObject({ project: 'project-z', id: 'coord-of-project-z', source: 'default' });
  });
});

describe('parsePlanTriage (D-8183)', () => {
  const bad = { ok: false, word: 'plan-bad-body' };
  it('the four decisions are spelled once', () => expect(TRIAGE_DECISIONS).toEqual(['hand', 'upkeep', 'close', 'raise']));
  it('a hand needs a programme key; its epic and checkpoint are optional here and checked by the route', () => {
    expect(parsePlanTriage({ issue: 'AAA-12', decision: 'hand' })).toMatchObject(bad);
    expect(parsePlanTriage({ issue: 'AAA-12', decision: 'hand', programme: 'Not A Key' })).toMatchObject(bad);
    expect(parsePlanTriage({ issue: 'AAA-12', decision: 'hand', programme: 'prog-a', epic: 'e1', checkpoint: 'c1', note: 'n' }))
      .toEqual({ ok: true, triage: { issue: 'AAA-12', decision: 'hand', programme: 'prog-a', epic: 'e1', checkpoint: 'c1', note: 'n' } });
  });
  it('a close needs a reason of at most 500 characters; the note is bounded alike', () => {
    expect(parsePlanTriage({ issue: 'AAA-12', decision: 'close' })).toMatchObject(bad);
    expect(parsePlanTriage({ issue: 'AAA-12', decision: 'close', reason: 'x'.repeat(501) })).toMatchObject(bad);
    expect(parsePlanTriage({ issue: 'AAA-12', decision: 'close', reason: 'duplicate of another' })).toMatchObject({ ok: true });
    expect(parsePlanTriage({ issue: 'AAA-12', decision: 'raise', note: 'x'.repeat(501) })).toMatchObject(bad);
  });
  it('upkeep and raise take the issue alone; an issue that is no identifier, an unknown decision and an unknown field are refused', () => {
    expect(parsePlanTriage({ issue: 'AAA-12', decision: 'upkeep' })).toEqual({ ok: true, triage: { issue: 'AAA-12', decision: 'upkeep' } });
    expect(parsePlanTriage({ issue: 'AAA-12', decision: 'raise' })).toMatchObject({ ok: true });
    expect(parsePlanTriage({ issue: 'not an id', decision: 'upkeep' })).toMatchObject(bad);
    expect(parsePlanTriage({ issue: 'AAA-12', decision: 'delete' })).toMatchObject(bad);
    expect(parsePlanTriage({ issue: 'AAA-12', decision: 'upkeep', extra: 1 })).toMatchObject(bad);
    expect(parsePlanTriage(null)).toMatchObject(bad);
  });
});

describe('parsePlanTake (D-8183)', () => {
  const bad = { ok: false, word: 'plan-bad-body' };
  it('takes an issue into an epic, with an optional checkpoint', () => {
    expect(parsePlanTake({ issue: 'AAA-12', epic: 'e1' })).toEqual({ ok: true, take: { issue: 'AAA-12', epic: 'e1' } });
    expect(parsePlanTake({ issue: 'AAA-12', epic: 'e1', checkpoint: 'c1' })).toEqual({ ok: true, take: { issue: 'AAA-12', epic: 'e1', checkpoint: 'c1' } });
  });
  it('closes with a why, or returns with a note', () => {
    expect(parsePlanTake({ issue: 'AAA-12', close: { why: 'duplicate' } })).toEqual({ ok: true, take: { issue: 'AAA-12', close: { why: 'duplicate' } } });
    expect(parsePlanTake({ issue: 'AAA-12', return: { note: 'not ours' } })).toEqual({ ok: true, take: { issue: 'AAA-12', return: { note: 'not ours' } } });
  });
  it('exactly one arm, each well-formed, no unknown field', () => {
    expect(parsePlanTake({ issue: 'AAA-12' })).toMatchObject(bad);
    expect(parsePlanTake({ issue: 'AAA-12', epic: 'e1', close: { why: 'x' } })).toMatchObject(bad);
    expect(parsePlanTake({ issue: 'AAA-12', close: { why: '' } })).toMatchObject(bad);
    expect(parsePlanTake({ issue: 'AAA-12', close: { why: 'x'.repeat(501) } })).toMatchObject(bad);
    expect(parsePlanTake({ issue: 'AAA-12', return: {} })).toMatchObject(bad);
    expect(parsePlanTake({ issue: 'AAA-12', epic: 'Not A Key' })).toMatchObject(bad);
    expect(parsePlanTake({ issue: 'AAA-12', checkpoint: 'c1' })).toMatchObject(bad);
    expect(parsePlanTake({ issue: 'AAA-12', epic: 'e1', extra: 1 })).toMatchObject(bad);
    expect(parsePlanTake({ issue: 'nope', epic: 'e1' })).toMatchObject(bad);
  });
});

describe('triageVerdict (D-8183)', () => {
  const row = (state: InboundRow['state']): InboundRow => ({
    linearId: 'l1', workspaceId: 'ws-a', teamKey: 'AAA', identifier: 'AAA-12', title: 't', body: null, seenAt: 1, mailedTo: null, mailedAt: null,
    handedTo: null, reason: null, actedAt: null, state, itemId: null,
  });
  const owner = { id: 'coord-a', source: 'named' as const, live: true, gone: false };
  it('only the team owner triages', () => {
    expect(triageVerdict('coord-b', owner, row('waiting'))).toEqual({ ok: false, word: 'not-linear-owner' });
    expect(triageVerdict('coord-a', { id: null }, row('waiting'))).toEqual({ ok: false, word: 'not-linear-owner' });
    expect(triageVerdict('coord-a', owner, row('waiting'))).toEqual({ ok: true });
  });
  it('the issue must be waiting or mailed', () => {
    expect(triageVerdict('coord-a', owner, row('mailed'))).toEqual({ ok: true });
    for (const s of ['handed', 'taken', 'placed', 'closed', 'raised'] as const) expect(triageVerdict('coord-a', owner, row(s))).toEqual({ ok: false, word: 'issue-not-inbound' });
    expect(triageVerdict('coord-a', owner, null)).toEqual({ ok: false, word: 'issue-not-inbound' });
  });
  it('the owner is judged before the issue', () => {
    expect(triageVerdict('coord-b', owner, null)).toEqual({ ok: false, word: 'not-linear-owner' });
  });
});
