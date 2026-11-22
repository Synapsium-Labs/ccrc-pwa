// D-8186: the migration map's deciders (`linear/migrationPolicy.ts`), pure.
import { describe, it, expect } from 'vitest';
import {
  applySteps, checkMap, mapProposerVerdict, migrationOfProject, parseMapProposal, resolveMapProposal, finishedComment, putBackSteps, reconcileMove, replacementComment, reportItemInput, shedTaken, ticketKeyOf, ticketKindOf, programmeOfEntry,
  type IssueSnapshotRow, type MapContext, type MoveRow, type PlanFacts,
} from '../src/linear/migrationPolicy.js';
import { projectOnTeam } from '../src/linear/route.js';
import type { StoredPlan } from '../src/coord/planStore.js';
import type { IssueSnapshot, MapBody, MapEntry, PlanEpicBody } from '../../shared/plan.js';

const U = (n: number) => `00000000-0006-4000-8000-${String(n).padStart(12, '0')}`;
const snap = (over: Partial<IssueSnapshot> = {}): IssueSnapshot => ({
  state: 'started', team: 'AAA', project: 'p-1', parent: null, milestone: null, title: 't', description: 'd', ...over,
});
const row = (n: number, over: Partial<IssueSnapshot> = {}): IssueSnapshotRow => ({ ...snap(over), linearId: U(n), identifier: `AAA-${n}` });
const entry = (n: number, cls: MapEntry['class'], target?: MapEntry['target']): MapEntry =>
  ({ issue: U(n), identifier: `AAA-${n}`, class: cls, ...(target ? { target } : {}) });
const epic = (key: string, over: Partial<PlanEpicBody> = {}): PlanEpicBody => ({ key, title: key, summary: 's', checkpoints: [], ...over });
const mapOf = (entries: MapEntry[], over: Partial<MapBody> = {}): MapBody => ({
  team: 'AAA', entries, snapshot: Object.fromEntries(entries.map((e, i) => [e.issue, snap({ title: `t${i}` })])), ...over,
});
const storedEpic = (key: string, over: Record<string, unknown> = {}): StoredPlan['epics'][number] => ({
  id: 1, program: 'prog-a', project: 'project-a', waves: [1], key, ordinal: 0, title: key, summary: 's', state: 'planned',
  droppedWhy: null, putBackAt: null, openedAt: null, doneAt: null, checkpoints: [], tickets: [], ...over,
} as StoredPlan['epics'][number]);
const plan = (...epics: StoredPlan['epics']): StoredPlan => ({ program: 'prog-a', planBy: null, required: true, epics });
const none: PlanFacts = { declared: false, live: false, plan: null };
const ctx = (over: Partial<MapContext> = {}): MapContext => ({
  home: 'project-a', teamOf: (p) => (p.startsWith('project-') ? 'AAA' : null), upkeepKeys: new Set(), ...over,
});
const leaf = (n: number, over: MapEntry['target'] = {}) => entry(n, 'leaf', { programme: 'prog-a', epic: 'e-1', ...over });
/** A finished entry with its evidence (review 2892 F7): a pull request, or a one-line reason when there is none. */
const fin = (n: number, over: MapEntry['target'] = { pr: 'org-a/repo-a#12' }) => entry(n, 'finished', over);
const withPlan = (p: StoredPlan | null, over: Partial<PlanFacts> = {}) => (prog: string): PlanFacts =>
  prog === 'prog-a' ? { declared: p !== null, live: false, plan: p, ...over } : none;
const planA = plan(storedEpic('e-1'));
const bad = (r: { ok: boolean }) => r as { ok: false; word: string; detail: string };

describe('checkMap coverage', () => {
  it('an issue missing from the map is map-incomplete', () => {
    const r = checkMap(mapOf([leaf(1)]), [row(1), row(3)], withPlan(planA), ctx());
    expect(r).toEqual({ ok: false, word: 'map-incomplete', detail: 'missing:AAA-3' });
  });
  it('an issue listed twice is map-incomplete', () => {
    const r = checkMap(mapOf([leaf(1), leaf(1)]), [row(1)], withPlan(planA), ctx());
    expect(bad(r)).toMatchObject({ word: 'map-incomplete', detail: 'twice:AAA-1' });
  });
  it('an entry for an issue that is not open is map-incomplete', () => {
    const r = checkMap(mapOf([leaf(1), entry(9, 'stale')]), [row(1)], withPlan(planA), ctx());
    expect(bad(r)).toMatchObject({ word: 'map-incomplete', detail: 'not-open:AAA-9' });
  });
});

describe('checkMap declared structure', () => {
  const m = (): MapBody => mapOf([fin(1)], { epics: [{ programme: 'prog-a', epics: [epic('e-1')] }] });
  it('epics for a declared programme with a run open is map-rewrites-plan', () => {
    expect(bad(checkMap(m(), [row(1)], withPlan(planA, { live: true }), ctx()))).toMatchObject({ word: 'map-rewrites-plan', detail: 'prog-a' });
  });
  it('epics for an undeclared programme with a non-terminal run is map-rewrites-plan', () => {
    expect(bad(checkMap(m(), [row(1)], withPlan(null, { live: true }), ctx())).word).toBe('map-rewrites-plan');
  });
  it('epics for a declared programme with no run at all is map-rewrites-plan', () => {
    expect(bad(checkMap(m(), [row(1)], withPlan(planA, { live: false }), ctx())).word).toBe('map-rewrites-plan');
  });
  it('epics for a done programme with no plan pass, even while its coordinator is alive', () => {
    const map = mapOf([fin(1), leaf(2)], { epics: [{ programme: 'prog-a', epics: [epic('e-1', { checkpoints: [{ key: 'c-1', title: 'c', kind: 'acceptance' }] })] }] });
    const r = checkMap(map, [row(1), row(2)], () => ({ declared: false, live: false, plan: null }), ctx());
    expect(r).toEqual({ ok: true, counts: { created: 3, moved: 1, closed: 1, left: 0, skipped: 0 } });
  });
  it('a backlog slug with a stored plan with epics is map-rewrites-plan', () => {
    const map = mapOf([fin(1)], { backlog: [{ slug: 'prog-a', title: 'T', epics: [epic('e-1')] }] });
    expect(bad(checkMap(map, [row(1)], withPlan(planA, { declared: false }), ctx())).word).toBe('map-rewrites-plan');
  });
});

describe('checkMap body and targets', () => {
  it('a leaf with no ticketKey gets the identifier-derived key', () => {
    expect(ticketKeyOf(leaf(7))).toBe('aaa-7');
    expect(ticketKeyOf(leaf(7, { ticketKey: 'x-1' }))).toBe('x-1');
    expect(ticketKindOf(leaf(7))).toBe('task');
    expect(ticketKindOf(leaf(7, { kind: 'bug' }))).toBe('bug');
    expect(checkMap(mapOf([leaf(7)]), [row(7)], withPlan(planA), ctx())).toMatchObject({ ok: true });
  });
  it('a leaf whose epic\'s project is in another team is plan-bad-body', () => {
    const p = plan(storedEpic('e-1', { project: 'other-proj' }));
    const teamOf = (q: string) => (q === 'other-proj' ? 'BBB' : 'AAA');
    expect(bad(checkMap(mapOf([leaf(1)]), [row(1)], withPlan(p), ctx({ teamOf })))).toMatchObject({ word: 'plan-bad-body', detail: 'leaf-other-team:AAA-1' });
  });
  it('a leaf whose epic\'s project has no team key is plan-bad-body, not same-team (D-8795)', () => {
    const p = plan(storedEpic('e-1', { project: 'other-proj' }));
    expect(bad(checkMap(mapOf([leaf(1)]), [row(1)], withPlan(p), ctx()))).toMatchObject({ word: 'plan-bad-body', detail: 'leaf-no-team:AAA-1' });
  });
  it('a declared epic without a project is judged by the home project', () => {
    const map = mapOf([leaf(1)], { epics: [{ programme: 'prog-a', epics: [epic('e-1')] }] });
    expect(checkMap(map, [row(1)], () => none, ctx())).toMatchObject({ ok: true });
    // The declared epic is judged first: its project, the home one, is in another team, so the structure is refused.
    expect(bad(checkMap(map, [row(1)], () => none, ctx({ teamOf: () => 'BBB' }))).detail).toBe('epic-other-team:prog-a/e-1');
  });
  it('structure declared in another team\'s project is plan-bad-body (D-8186, security review)', () => {
    const map = mapOf([leaf(1)], { epics: [{ programme: 'prog-a', epics: [epic('e-1'), epic('e-2', { project: 'other-proj' })] }] });
    const teamOf = (q: string) => (q === 'other-proj' ? 'BBB' : 'AAA');
    expect(bad(checkMap(map, [row(1)], () => none, ctx({ teamOf })))).toMatchObject({ word: 'plan-bad-body', detail: 'epic-other-team:prog-a/e-2' });
    const backlogged = mapOf([leaf(1, { programme: 'new-a' })], { backlog: [{ slug: 'new-a', title: 'New', epics: [epic('e-1', { project: 'other-proj' })] }] });
    expect(bad(checkMap(backlogged, [row(1)], () => none, ctx({ teamOf }))).detail).toBe('epic-other-team:new-a/e-1');
  });
  it('an unknown target is plan-bad-body', () => {
    for (const e of [leaf(1, { epic: 'nope' }), leaf(1, { programme: 'prog-z' }), entry(1, 'epic', { programme: 'prog-a' }),
      leaf(1, { checkpoint: 'c-9' }), entry(1, 'superseded')]) {
      expect(bad(checkMap(mapOf([e]), [row(1)], withPlan(planA), ctx()))).toMatchObject({ word: 'plan-bad-body', detail: 'unknown-target:AAA-1' });
    }
  });
  it('a dropped or put-back epic is not a target', () => {
    const p = plan(storedEpic('e-1', { state: 'dropped' }));
    expect(bad(checkMap(mapOf([leaf(1)]), [row(1)], withPlan(p), ctx())).detail).toBe('unknown-target:AAA-1');
  });
  it('a ticket key already used is plan-bad-body', () => {
    const used = plan(storedEpic('e-1', { tickets: [{ key: 'aaa-1' }] }));
    expect(bad(checkMap(mapOf([leaf(1)]), [row(1)], withPlan(used), ctx()))).toMatchObject({ word: 'plan-bad-body', detail: 'ticket-key-used:aaa-1' });
    const twice = mapOf([leaf(1, { ticketKey: 'k-1' }), leaf(2, { ticketKey: 'k-1' })]);
    expect(bad(checkMap(twice, [row(1), row(2)], withPlan(planA), ctx())).detail).toBe('ticket-key-used:k-1');
    const up = mapOf([entry(1, 'upkeep')]);
    expect(bad(checkMap(up, [row(1)], () => none, ctx({ upkeepKeys: new Set(['aaa-1']) }))).detail).toBe('ticket-key-used:aaa-1');
  });
  it('a bad body is plan-bad-body', () => {
    const map = mapOf([fin(1)], { backlog: [{ slug: 'prog-b', title: '', epics: [] }] });
    expect(bad(checkMap(map, [row(1)], () => none, ctx())).word).toBe('plan-bad-body');
    const dup = mapOf([fin(1)], { backlog: [{ slug: 'prog-b', title: 'T', epics: [] }], epics: [{ programme: 'prog-b', epics: [] }] });
    expect(bad(checkMap(dup, [row(1)], () => none, ctx())).word).toBe('plan-bad-body');
  });
  it('counts add up across every class', () => {
    const map = mapOf([
      leaf(1), entry(2, 'upkeep'), fin(3), entry(4, 'superseded', { successor: 'AAA-1' }), entry(5, 'stale'),
      entry(6, 'unclear'), entry(7, 'programme', { programme: 'prog-a' }), entry(8, 'epic', { programme: 'prog-a', epic: 'e-1' }),
      entry(9, 'checkpoint', { programme: 'prog-a', epic: 'e-1', checkpoint: 'c-1' }),
    ], { backlog: [{ slug: 'prog-b', title: 'B', epics: [epic('e-2')] }] });
    const p = plan(storedEpic('e-1', { checkpoints: [{ key: 'c-1' }] }));
    const r = checkMap(map, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => row(n)), withPlan(p), ctx());
    expect(r).toEqual({ ok: true, counts: { created: 2, moved: 2, closed: 6, left: 1, skipped: 0 } });
  });
});

describe('applySteps', () => {
  const after = (e: MapEntry) => ({ expect: { state: 'started' }, id: e.identifier });
  it('a changed snapshot is skipped and listed', () => {
    const map = mapOf([leaf(1), leaf(2), leaf(3), leaf(4)]);
    const reread = new Map<string, IssueSnapshot | 'closed'>([
      [U(1), map.snapshot[U(1)]!], [U(2), { ...map.snapshot[U(2)]!, title: 'changed' }], [U(3), 'closed']]);
    const r = applySteps(map, new Set(), reread, after);
    expect(r.now.map((s) => s.linearId)).toEqual([U(1)]);
    expect(r.now[0]).toMatchObject({ op: 'issueUpdate', before: map.snapshot[U(1)] });
    expect(r.skipped).toEqual([U(2), U(3), U(4)]);
  });
  it('a live programme\'s part waits', () => {
    const map = mapOf([leaf(1), entry(2, 'leaf', { programme: 'prog-b', epic: 'e-1' })]);
    const reread = new Map<string, IssueSnapshot | 'closed'>(Object.entries(map.snapshot));
    const r = applySteps(map, new Set(['prog-a']), reread, after);
    expect(r.waiting).toEqual([U(1)]);
    expect(r.now.map((s) => s.linearId)).toEqual([U(2)]);
    expect(applySteps(map, new Set(), reread, () => null).waiting).toEqual([U(1), U(2)]);
  });
  it('leaves come before the replaced levels, in map order', () => {
    const map = mapOf([entry(1, 'programme', { programme: 'prog-a' }), entry(2, 'stale'), entry(3, 'unclear'), leaf(4),
      entry(5, 'upkeep'), fin(6)]);
    const reread = new Map<string, IssueSnapshot | 'closed'>(Object.entries(map.snapshot));
    expect(applySteps(map, new Set(), reread, after).now.map((s) => s.linearId)).toEqual([U(4), U(5), U(2), U(6), U(1)]);
  });
  it('programmeOfEntry reads the target', () => {
    expect(programmeOfEntry(leaf(1))).toBe('prog-a');
    expect(programmeOfEntry(entry(1, 'upkeep'))).toBeNull();
    expect(programmeOfEntry(entry(1, 'stale'))).toBeNull();
  });
});

const mv = (id: number, over: Partial<MoveRow> = {}): MoveRow => ({
  id, migrationId: 1, subject: `s${id}`, kind: 'issue', linearId: U(id), identifier: `AAA-${id}`, before: snap(),
  after: { expect: { state: 'completed' } }, appliedAt: 5, revertedAt: null, ...over,
});

describe('reconcileMove', () => {
  it('reconcileMove: after → applied, before → redo, other → skip', () => {
    const r = mv(1, { after: { expect: { project: 'p-2', title: 'n' } } });
    expect(reconcileMove(r, snap({ project: 'p-2', title: 'n' }))).toBe('applied');
    expect(reconcileMove(r, snap())).toBe('redo');
    expect(reconcileMove(r, snap({ title: 'else' }))).toBe('skip');
    expect(reconcileMove(r, 'closed')).toBe('skip');
    expect(reconcileMove(mv(1, { after: { expect: { state: 'canceled' } } }), 'closed')).toBe('applied');
  });
  it('reconcileMove compares by key and type: a field it cannot measure is never a match (D-8795)', () => {
    expect(reconcileMove(mv(1, { after: { expect: { title: 7 } } }), snap({ title: '7' }))).toBe('skip');
    expect(reconcileMove(mv(1, { after: { expect: { title: 7 } } }), snap())).toBe('redo');
    expect(reconcileMove(mv(1, { after: { expect: { title: 'n' } } }), { ...snap(), title: undefined } as unknown as IssueSnapshot)).toBe('skip');
    // An after that names no field proves nothing: a moved issue is skipped, an untouched one redone.
    expect(reconcileMove(mv(1, { after: {} }), snap({ title: 'else' }))).toBe('skip');
    expect(reconcileMove(mv(1, { after: {} }), snap())).toBe('redo');
  });
  it('a create row is redo with no object and applied with one', () => {
    expect(reconcileMove(mv(1, { before: null, linearId: null }), snap())).toBe('redo');
    expect(reconcileMove(mv(1, { before: null }), snap())).toBe('applied');
  });
});

describe('putBackSteps', () => {
  it('put back reverses in order and lists an issue moved since', () => {
    const rows = [mv(1), mv(2), mv(3), mv(4, { appliedAt: null }), mv(5, { revertedAt: 9 })];
    const cur = new Map<string, IssueSnapshot>([
      [U(1), snap({ state: 'completed' })], [U(2), snap({ state: 'started' })], [U(3), snap({ state: 'completed' })]]);
    const r = putBackSteps(rows, cur);
    expect(r.steps.map((s) => s.linearId)).toEqual([U(3), U(1)]);
    expect(r.moved).toEqual(['AAA-2']);
  });
  it('an issue gone from the current read is listed as moved', () => {
    expect(putBackSteps([mv(1)], new Map())).toEqual({ steps: [], moved: ['AAA-1'], left: [] });
  });
  it('put back restores team, title and description', () => {
    const before = snap({ team: 'BBB', title: 'old', description: 'was', project: 'p-9', parent: U(50), milestone: U(51) });
    const cur = snap({ state: 'completed', team: 'AAA', title: 'new' });
    const r = putBackSteps([mv(1, { before })], new Map([[U(1), cur]]));
    expect(r.steps).toEqual([{ op: 'issueUpdate', linearId: U(1), before: cur, after: { expect: before, restore: before } }]);
  });
  it('a create row put back is a cancel', () => {
    const rows = [mv(1, { kind: 'programme', before: null, after: {} }), mv(2, { kind: 'epic', before: null, after: {} })];
    expect(putBackSteps(rows, new Map()).steps).toEqual([
      { op: 'projectUpdate', linearId: U(2), before: null, after: { cancel: true } },
      { op: 'initiativeUpdate', linearId: U(1), before: null, after: { cancel: true } },
    ]);
  });
  it('a milestone create row emits no put-back step', () => {
    // D-8795: it stays in Linear under its canceled project; put back writes nothing for it and lists it.
    expect(putBackSteps([mv(1, { kind: 'checkpoint', before: null, after: {} })], new Map())).toEqual({ steps: [], moved: [], left: ['s1'] });
  });
});

describe('replacementComment', () => {
  it('a public team\'s replacement comment has no URL and no identifier', () => {
    for (const mode of ['public', 'unknown'] as const) {
      const c = replacementComment('project-a', mode, 'https://example.test/x');
      expect(c).toContain('project-a');
      expect(c).not.toMatch(/https?:|[A-Z]{2,}-\d+/);
    }
    expect(replacementComment('project-a', 'private', null)).toBe(replacementComment('project-a', 'public', null));
    expect(replacementComment('project-a', 'private', 'https://example.test/x')).toContain('(https://example.test/x)');
  });
});

describe('review 2892 fix round 1 (D-8186)', () => {
  it('F6: a superseded entry names a successor that exists in the map or the store, or the map is plan-bad-body unknown-successor', () => {
    const open = [row(1), row(2)];
    const facts = withPlan(planA);
    expect(checkMap(mapOf([leaf(1), entry(2, 'superseded', { successor: 'AAA-1' })]), open, facts, ctx()).ok).toBe(true);
    expect(checkMap(mapOf([leaf(1), entry(2, 'superseded', { successor: U(1) })]), open, facts, ctx()).ok).toBe(true);
    expect(checkMap(mapOf([leaf(1), entry(2, 'superseded', { successor: 'AAA-77' })]), open, facts, ctx({ heldIssues: new Set(['AAA-77']) })).ok).toBe(true);
    expect(checkMap(mapOf([leaf(1), entry(2, 'superseded', { successor: 'AAA-77' })]), open, facts, ctx()))
      .toEqual({ ok: false, word: 'plan-bad-body', detail: 'unknown-successor:AAA-2' });
    expect(bad(checkMap(mapOf([leaf(1), entry(2, 'superseded', { successor: 'AAA-2' })]), open, facts, ctx())).detail).toBe('unknown-successor:AAA-2');   // not itself
    // review 2918 A5: itself by its issue id too, though that id is on the map
    expect(bad(checkMap(mapOf([leaf(1), entry(2, 'superseded', { successor: U(2) })]), open, facts, ctx())).detail).toBe('unknown-successor:AAA-2');
  });

  it('F7: a finished entry carries a pull request or a one-line reason, or the map is plan-bad-body finished-needs-evidence', () => {
    const open = [row(1), row(2)];
    const facts = withPlan(planA);
    expect(checkMap(mapOf([leaf(1), fin(2)]), open, facts, ctx()).ok).toBe(true);
    expect(checkMap(mapOf([leaf(1), fin(2, { reason: 'Shipped before ccrc tracked it' })]), open, facts, ctx()).ok).toBe(true);
    for (const t of [undefined, {}, { pr: 'repo-a#12' }, { pr: 'org-a/repo-a#x' }, { pr: 'org-a/repo-a' }, { reason: '' }, { reason: 'two\nlines' }, { reason: 'r'.repeat(201) }]) {
      expect(checkMap(mapOf([leaf(1), entry(2, 'finished', t)]), open, facts, ctx()), JSON.stringify(t))
        .toEqual({ ok: false, word: 'plan-bad-body', detail: 'finished-needs-evidence:AAA-2' });
    }
  });

  it('F7: the close names its evidence; a public team names a pull request outside its own repository by "a pull request" only', () => {
    expect(finishedComment({ pr: 'org-a/repo-a#12' }, { teamKey: 'AAA', mode: 'private' }, 'org-a/repo-b', [])).toContain('org-a/repo-a#12');
    expect(finishedComment({ pr: 'org-a/repo-a#12' }, { teamKey: 'AAA', mode: 'public' }, 'org-a/repo-a', [])).toContain('org-a/repo-a#12');
    for (const mode of ['public', 'unknown'] as const) {
      const c = finishedComment({ pr: 'org-a/repo-a#12' }, { teamKey: 'AAA', mode: mode }, 'org-a/repo-b', []);
      expect(c).toContain('a pull request');
      expect(c).not.toContain('repo-a');
      expect(finishedComment({ pr: 'org-a/repo-a#12' }, { teamKey: 'AAA', mode: mode }, null, [])).not.toContain('repo-a');
    }
    expect(finishedComment({ reason: 'Shipped before ccrc tracked it' }, { teamKey: 'AAA', mode: 'public' }, null, [])).toContain('Shipped before ccrc tracked it');
    // a reason the public-text check refuses is not written to a public team: the close says only that it is finished
    const refused = finishedComment({ reason: 'see AAA-12 for it' }, { teamKey: 'AAA', mode: 'public' }, null, []);
    expect(refused).not.toContain('AAA-12');
    expect(refused).toContain('finished');
  });

  it('A6: the report says a done programme\'s initiative stays active while its placed tickets are open (D-8796)', () => {
    const c = { created: 0, moved: 1, closed: 0, left: 0, skipped: 0 };
    expect(reportItemInput(4, 'AAA', c).why).not.toContain('stays active');
    const why = reportItemInput(4, 'AAA', c, ['prog-b']).why;
    expect(why).toContain('prog-b');
    expect(why).toContain('initiative stays active in Linear while its placed tickets are open');
  });
});

describe('shedTaken (review 2955 F2)', () => {
  it('moves each held identifier from skipped to taken, deduplicated and in order', () => {
    const held = new Set(['AAA-2', 'AAA-4']);
    expect(shedTaken(['AAA-1', 'AAA-2', 'AAA-3', 'AAA-4'], ['AAA-4', 'AAA-9'], (i) => held.has(i)))
      .toEqual({ skipped: ['AAA-1', 'AAA-3'], taken: ['AAA-4', 'AAA-9', 'AAA-2'], moved: true });
  });
  it('moves nothing when no skipped identifier is held', () => {
    expect(shedTaken(['AAA-1'], ['AAA-9'], () => false)).toEqual({ skipped: ['AAA-1'], taken: ['AAA-9'], moved: false });
  });
});

describe('mapProposerVerdict (D-8808: the map route\'s decider, review 2997 F2)', () => {
  const ownerIn = (mine: readonly (string | null)[]) => (ws: string | null) => ({ kind: 'owner' as const, id: mine.includes(ws) ? 'coord-a' : 'coord-b' });
  it('one waiting workspace the caller owns is the one', () => {
    expect(mapProposerVerdict('coord-a', ['ws-a', 'ws-b'], ['ws-a', 'ws-b'], ownerIn(['ws-a']))).toEqual({ ok: true, workspaceId: 'ws-a' });
  });
  it('two the caller owns is team-ambiguous', () => {
    expect(mapProposerVerdict('coord-a', ['ws-a', 'ws-b'], ['ws-a', 'ws-b'], ownerIn(['ws-a', 'ws-b']))).toMatchObject({ ok: false, word: 'team-ambiguous' });
  });
  it('something waits but the caller owns none of it: not-linear-owner', () => {
    expect(mapProposerVerdict('coord-a', ['ws-b'], ['ws-a', 'ws-b'], ownerIn(['ws-a']))).toMatchObject({ ok: false, word: 'not-linear-owner' });
  });
  it('nothing waits and the caller owns the team somewhere: plan-bad-body', () => {
    expect(mapProposerVerdict('coord-a', [], ['ws-a', 'ws-b'], ownerIn(['ws-a']))).toMatchObject({ ok: false, word: 'plan-bad-body' });
  });
  it('nothing waits and the caller owns nothing: not-linear-owner, learning nothing', () => {
    expect(mapProposerVerdict('coord-a', [], ['ws-b'], ownerIn([]))).toMatchObject({ ok: false, word: 'not-linear-owner' });
  });
});

describe('projectOnTeam and migrationOfProject (D-8808)', () => {
  const slot = (workspaceId: string, ...keys: string[]) => ({ ref: { source: 'file' as const, id: workspaceId }, workspaceId, urlKey: workspaceId, teamKeys: keys });
  const both = [slot('ws-a', 'AAA'), slot('ws-b', 'AAA')];
  const measured = (slots: typeof both) => ({ slots, unreadableWorkspaces: new Set<string>(), unreadableLegacy: false });
  it('a row naming a workspace is judged by it', () => {
    expect(projectOnTeam({ teamKey: 'AAA', workspaceId: 'ws-b' }, 'AAA', 'ws-b', measured(both))).toBe(true);
    expect(projectOnTeam({ teamKey: 'AAA', workspaceId: 'ws-b' }, 'AAA', 'ws-a', measured(both))).toBe(false);
    expect(projectOnTeam({ teamKey: 'BBB', workspaceId: 'ws-a' }, 'AAA', 'ws-a', measured(both))).toBe(false);
    expect(projectOnTeam({ teamKey: 'AAA', workspaceId: 'ws-a' }, 'AAA', 'ws-a', null)).toBe(true);
  });
  it('a row naming none is routed: one slot decides, an ambiguous or unroutable key is false', () => {
    expect(projectOnTeam({ teamKey: 'AAA', workspaceId: null }, 'AAA', 'ws-a', measured([slot('ws-a', 'AAA')]))).toBe(true);
    expect(projectOnTeam({ teamKey: 'AAA', workspaceId: null }, 'AAA', 'ws-b', measured([slot('ws-a', 'AAA')]))).toBe(false);
    expect(projectOnTeam({ teamKey: 'AAA', workspaceId: null }, 'AAA', 'ws-a', measured(both))).toBe(false);
    expect(projectOnTeam({ teamKey: 'AAA', workspaceId: null }, 'AAA', 'ws-a', null)).toBe('unmeasured');
  });
  const m = (id: number, workspaceId: string) => ({ id, workspaceId, teamKey: 'AAA' });
  it('migrationOfProject: a pinned row takes its workspace\'s newest', () => {
    expect(migrationOfProject({ teamKey: 'AAA', workspaceId: 'ws-b' }, [m(1, 'ws-a'), m(2, 'ws-b'), m(3, 'ws-a')], null)?.id).toBe(2);
  });
  it('migrationOfProject: an unpinned row is routed, ambiguous is none, unroutable falls back to one workspace only', () => {
    const rows = [m(1, 'ws-a'), m(2, 'ws-b')];
    expect(migrationOfProject({ teamKey: 'AAA', workspaceId: null }, rows, [slot('ws-b', 'AAA')])?.id).toBe(2);
    expect(migrationOfProject({ teamKey: 'AAA', workspaceId: null }, rows, both)).toBeNull();
    expect(migrationOfProject({ teamKey: 'AAA', workspaceId: null }, rows, null)).toBeNull();
    expect(migrationOfProject({ teamKey: 'AAA', workspaceId: null }, [m(1, 'ws-a'), m(5, 'ws-a')], null)?.id).toBe(5);
  });
});

describe('parseMapProposal and resolveMapProposal (D-8186: the visible identifier without the UUID)', () => {
  const tgt = { programme: 'prog-a', epic: 'e-1' };
  const eligible = [row(1), row(2), row(3)];
  const proposal = (entries: unknown[]) => {
    const p = parseMapProposal({ entries }, 'AAA');
    if (!p.ok) throw new Error(p.detail);
    return p.proposal;
  };
  const refusal = (r: { ok: boolean }) => r as { ok: false; word: string; detail: string };

  it('parses an identifier-only entry, and keeps a given UUID', () => {
    expect(parseMapProposal({ entries: [{ identifier: 'AAA-1', class: 'leaf', target: tgt }, { issue: U(2), identifier: 'AAA-2', class: 'stale' }] }, 'AAA'))
      .toEqual({ ok: true, proposal: { team: 'AAA', entries: [{ identifier: 'AAA-1', class: 'leaf', target: tgt }, { identifier: 'AAA-2', issue: U(2), class: 'stale' }] } });
  });
  it('refuses a non-string issue, a missing identifier and a bad class', () => {
    expect(parseMapProposal({ entries: [{ issue: 5, identifier: 'AAA-1', class: 'leaf' }] }, 'AAA')).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(parseMapProposal({ entries: [{ issue: null, identifier: 'AAA-1', class: 'leaf' }] }, 'AAA')).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(parseMapProposal({ entries: [{ issue: U(1), class: 'leaf' }] }, 'AAA')).toEqual({ ok: false, word: 'plan-bad-body', detail: 'an entry needs an identifier and a class' });
    expect(parseMapProposal({ entries: [{ identifier: '', class: 'leaf' }] }, 'AAA')).toMatchObject({ ok: false, detail: 'an entry needs an identifier and a class' });
    expect(parseMapProposal({ entries: [{ identifier: 'AAA-1', class: 'nope' }] }, 'AAA')).toMatchObject({ ok: false, detail: 'an entry needs an identifier and a class' });
  });

  it('resolves to the canonical UUID and identifier, keeps the order and the target untouched', () => {
    const r = resolveMapProposal(proposal([{ identifier: 'aaa-2', class: 'leaf', target: tgt }, { issue: U(1), identifier: 'AAA-1', class: 'stale' }]), eligible);
    expect(r).toEqual({ ok: true, map: { team: 'AAA', entries: [{ issue: U(2), identifier: 'AAA-2', class: 'leaf', target: tgt }, { issue: U(1), identifier: 'AAA-1', class: 'stale' }] } });
  });
  it('carries backlog and epics through', () => {
    const p = parseMapProposal({ entries: [], backlog: [{ slug: 'b', title: 't', epics: [] }], epics: [{ programme: 'prog-a', epics: [] }] }, 'AAA');
    if (!p.ok) throw new Error('parse');
    expect(resolveMapProposal(p.proposal, eligible)).toEqual({ ok: true, map: { team: 'AAA', entries: [], backlog: [{ slug: 'b', title: 't', epics: [] }], epics: [{ programme: 'prog-a', epics: [] }] } });
  });
  it('an identifier no eligible row has is not-open, as sent', () => {
    expect(refusal(resolveMapProposal(proposal([{ identifier: 'aaa-9', class: 'leaf' }]), eligible))).toMatchObject({ word: 'map-incomplete', detail: 'not-open:aaa-9' });
    expect(refusal(resolveMapProposal(proposal([{ issue: U(9), identifier: 'AAA-9', class: 'leaf' }]), eligible))).toMatchObject({ word: 'map-incomplete', detail: 'not-open:AAA-9' });
  });
  it('no row by identifier but the issue is eligible: issue-mismatch', () => {
    expect(refusal(resolveMapProposal(proposal([{ issue: U(1), identifier: 'AAA-99', class: 'leaf' }]), eligible))).toEqual({ ok: false, word: 'plan-bad-body', detail: 'issue-mismatch:AAA-99' });
  });
  it('a row by identifier whose UUID is not the one sent: issue-mismatch, never another row', () => {
    expect(refusal(resolveMapProposal(proposal([{ issue: U(2), identifier: 'AAA-1', class: 'leaf' }]), eligible))).toEqual({ ok: false, word: 'plan-bad-body', detail: 'issue-mismatch:AAA-1' });
    expect(refusal(resolveMapProposal(proposal([{ issue: U(77), identifier: 'AAA-1', class: 'leaf' }]), eligible))).toEqual({ ok: false, word: 'plan-bad-body', detail: 'issue-mismatch:AAA-1' });
  });
  it('folds ASCII letters only: a character whose Unicode upper case is ASCII matches nothing', () => {
    const ff = [{ ...row(1), identifier: 'FF-1' }];
    expect(resolveMapProposal(proposal([{ identifier: 'ff-1', class: 'stale' }]), ff)).toMatchObject({ ok: true });
    expect(refusal(resolveMapProposal(proposal([{ identifier: 'ﬀ-1', class: 'stale' }]), ff))).toEqual({ ok: false, word: 'map-incomplete', detail: 'not-open:ﬀ-1' });
  });
  it('two rows with one identifier: ambiguous', () => {
    const dup = [...eligible, { ...row(1), linearId: U(190) }];
    expect(refusal(resolveMapProposal(proposal([{ identifier: 'AAA-1', class: 'leaf' }]), dup))).toEqual({ ok: false, word: 'map-incomplete', detail: 'ambiguous:AAA-1' });
  });
  it('one row named twice in any mix of forms: twice, canonical identifier', () => {
    expect(refusal(resolveMapProposal(proposal([{ identifier: 'AAA-1', class: 'leaf' }, { issue: U(1), identifier: 'aaa-1', class: 'stale' }]), eligible)))
      .toEqual({ ok: false, word: 'map-incomplete', detail: 'twice:AAA-1' });
  });
  it('the first refusal in the order sent wins', () => {
    expect(refusal(resolveMapProposal(proposal([{ identifier: 'AAA-8', class: 'leaf' }, { issue: U(2), identifier: 'AAA-1', class: 'leaf' }]), eligible)).detail).toBe('not-open:AAA-8');
  });
  it('leaves a missing eligible row to checkMap', () => {
    expect(resolveMapProposal(proposal([{ identifier: 'AAA-1', class: 'stale' }]), eligible)).toMatchObject({ ok: true });
  });
});
