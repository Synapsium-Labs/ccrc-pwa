// A KEPT WORKER (D-8981, D-8982): a worker whose run has closed stays in its programme's box while that programme's
// coordinator still holds open work of it, instead of falling to "Not in a programme" with "run not on the board". The
// wire fact is the closed run's programme and wave on the session's own binding (`FleetSession.run`, D-8980); the decider
// is `keptRunOf` (`fleet/runWords.ts`), asked once per fleet by `fleetTree`; the tree nests the row (`nestFleet`'s rule 6),
// the box reads it as a child, and a row whose coordinator renders on another card is a worker of a programme elsewhere.
// Red first: before this change every case below answered "lone" or "run not on the board".
import { describe, expect, it } from 'vitest';
import type { FleetSession, RunSummary } from '../../shared/api';
import { childRunContext, fleetTree } from '../src/fleet/fleetTree';
import { nestFleet, type FleetRow } from '../src/fleet/nestFleet';
import { cardBoxes, rowClaimant, rowProgramme } from '../src/fleet/programmeBoxes';
import { childOfRunLabel, keptRunOf, type KeptRun } from '../src/fleet/runWords';
import { run, sess } from './rollupFixture';
import { withProgrammeBinding } from './runBindingFixture';

const coord = sess('coord', 'project-c', { role: 'coordinator', status: 'busy', bucket: 'working' });
const worker = (id: string, mint: number, project = 'project-c'): FleetSession =>
  sess(id, project, { role: 'child', child: { kind: 'child', runId: mint } });
const idOf = (r: FleetRow): string => (r.kind === 'session' ? r.session.id : `spawn:${r.run.id}`);

/** Wave 1 closed (its worker `w-done` kept), wave 2 open under the same coordinator. */
const closed = run(10, 'coord', 'w-done', { state: 'done', wave: 1, closedAt: 1 });
const live = run(11, 'coord', 'w-live', { wave: 2 });

/** The fleet as a current server sends it: every session bound over every run it knows, the runs frame the open ones. */
const fleet = (sessions: FleetSession[], all: RunSummary[]) => {
  const bound = withProgrammeBinding(sessions, all);
  const open = all.filter((r) => r.state !== 'done' && r.state !== 'failed');
  return { bound, open, cards: fleetTree(bound, [...new Set(bound.map((s) => s.project))], open) };
};
const card = (f: ReturnType<typeof fleet>, project: string) => {
  const g = f.cards.find((c) => c.project === project)!;
  return { g, ...cardBoxes(g.rows, g.runs, g.claimed, g.hues, null, null, false) };
};

describe('keptRunOf: the closed run a programme still keeps (D-8981)', () => {
  const [done] = withProgrammeBinding([worker('w-done', 10)], [closed, live]);

  it('a worker whose newest run closed, its coordinator still holding open work of that programme: the run, kept', () => {
    expect(keptRunOf(done!, [live])).toEqual({ id: 10, program: 'port-api', wave: 1, coordinatorId: 'coord' });
  });

  it('the programme has no open run left (done or abandoned): not kept', () => {
    expect(keptRunOf(done!, [])).toBeNull();
    expect(keptRunOf(done!, [run(12, 'coord', 'w-live', { state: 'done' })])).toBeNull();
  });

  it('the coordinator\'s open work is another programme\'s, or another coordinator\'s: not kept', () => {
    expect(keptRunOf(done!, [run(11, 'coord', 'w-live', { program: 'billing' })])).toBeNull();
    expect(keptRunOf(done!, [run(11, 'coord-b', 'w-live')])).toBeNull();
  });

  it('an open run binds the session: it is doing that run, not kept', () => {
    const [busy] = withProgrammeBinding([worker('w-done', 10)], [closed, run(13, 'coord', 'w-done', { wave: 3 })]);
    expect(keptRunOf(busy!, [live, run(13, 'coord', 'w-done', { wave: 3 })])).toBeNull();
  });

  it('a newer run closed while an older one is still open: the open run is its work, not kept', () => {
    const older = run(10, 'coord', 'w-done', { wave: 1 });
    const [both] = withProgrammeBinding([worker('w-done', 10)], [older, run(12, 'coord', 'w-done', { state: 'done', wave: 2 })]);
    expect(both!.run).toMatchObject({ id: 12, state: 'done' });
    expect(keptRunOf(both!, [older, live])).toBeNull();
  });

  it('an older server (no programme on the binding) or an ownerless run: not kept, the row stays where it was', () => {
    const older = { ...done!, run: { id: 10, state: 'done' as const, claimedBy: 'coord' } };
    expect(keptRunOf(older, [live])).toBeNull();
    const ownerless = { ...done!, run: { id: 10, state: 'done' as const, claimedBy: null, program: 'port-api', wave: 1 } };
    expect(keptRunOf(ownerless, [live])).toBeNull();
  });

  it('a session that is no dispatched child (a main checkout, a manual workspace, an unreadable marker): not kept', () => {
    const [main] = withProgrammeBinding([sess('w-done', 'project-c')], [closed, live]);
    expect(main!.run).toMatchObject({ id: 10, state: 'done', program: 'port-api' });
    expect(keptRunOf(main!, [live])).toBeNull();
    const [manual] = withProgrammeBinding([sess('w-done', 'project-c', { role: 'coordinator' })], [closed, live]);
    expect(keptRunOf(manual!, [live])).toBeNull();
    const [blurred] = withProgrammeBinding([sess('w-done', 'project-c', { child: { kind: 'unreadable' } })], [closed, live]);
    expect(keptRunOf(blurred!, [live])).toBeNull();
  });

  it('a child whose marker names a LATER run than the closed one (a recycled name): not kept', () => {
    // The server's incarnation binding already drops the older run for this name, so the row arrives unbound
    const [recycled] = withProgrammeBinding([worker('w-done', 11)], [closed, live]);
    expect(keptRunOf(recycled!, [live])).toBeNull();
    // and the decider refuses it on its own too, given a binding that still names the older run.
    const stale = { ...recycled!, run: { id: 10, state: 'done' as const, claimedBy: 'coord', program: 'port-api', wave: 1 } };
    expect(keptRunOf(stale, [live])).toBeNull();
  });

  it('a child resumed for a later wave (its marker names the earlier minting run): kept', () => {
    const [resumed] = withProgrammeBinding([worker('w-done', 9)], [closed, live]);
    expect(resumed!.run).toMatchObject({ id: 10, state: 'done' });
    expect(keptRunOf(resumed!, [live])).toMatchObject({ id: 10, program: 'port-api', coordinatorId: 'coord' });
  });
});

describe('the tree and the box keep the worker (D-8981)', () => {
  it('nests the kept worker under its coordinator, after the working ones, and the box counts it as a child', () => {
    const f = fleet([coord, worker('w-live', 11), worker('w-done', 10), sess('l1', 'project-c')], [closed, live]);
    const c = card(f, 'project-c');
    expect(c.g.rows.map((r) => `${idOf(r)}@${r.depth}`)).toEqual(['coord@0', 'w-live@1', 'w-done@1', 'l1@0']);
    expect(c.g.rows.find((r) => idOf(r) === 'w-done')).toMatchObject({ kept: { id: 10, program: 'port-api', coordinatorId: 'coord' } });
    expect(c.prog.boxes.map((b) => b.children.map(idOf))).toEqual([['w-live', 'w-done']]);
    expect(c.prog.lone.map(idOf)).toEqual(['l1']);
  });

  it('keeps it under a coordinator whose only open work runs on another card', () => {
    const far = run(11, 'coord', 'w-far', { wave: 2, project: 'project-b' });
    const f = fleet([coord, worker('w-done', 10), worker('w-far', 11, 'project-b')], [closed, far]);
    const c = card(f, 'project-c');
    expect(c.prog.boxes.map((b) => [b.coordinatorId, b.children.map(idOf), b.abroad.map((r) => r.id)])).toEqual([['coord', ['w-done'], [11]]]);
    expect(c.prog.lone).toEqual([]);
  });

  it('a kept worker whose coordinator renders on another card is a worker of a programme elsewhere, in that programme\'s hue', () => {
    const away = sess('coord', 'project-b', { role: 'coordinator' });
    const f = fleet([away, worker('w-live', 11, 'project-b'), worker('w-done', 10)], [closed, { ...live, project: 'project-b' }]);
    const c = card(f, 'project-c');
    expect(c.prog.boxes).toEqual([]);
    expect(c.prog.elsewhere.map(idOf)).toEqual(['w-done']);
    expect(c.prog.lone).toEqual([]);
    const row = c.prog.elsewhere[0]!;
    expect(rowClaimant(row, c.g.runs)).toBe('coord');
    expect(rowProgramme(row, c.g.runs)).toBe('port-api');
    expect(c.prog.hues.get('port-api')).toBeDefined();
  });

  it('a programme with no open run left keeps no one: the worker stays in no programme', () => {
    const f = fleet([coord, worker('w-done', 10)], [closed]);
    const c = card(f, 'project-c');
    expect(c.prog.boxes).toEqual([]);
    expect(c.prog.lone.map(idOf)).toEqual(['coord', 'w-done']);
  });

  it('rule 4 still holds: a kept worker that coordinates open work of its own is a parent, never a child', () => {
    const own = run(12, 'w-done', 'w-sub', { program: 'billing' });
    const f = fleet([coord, worker('w-live', 11), worker('w-done', 10), worker('w-sub', 12)], [closed, live, own]);
    const rows = card(f, 'project-c').g.rows.map((r) => `${idOf(r)}@${r.depth}`);
    expect(rows).toContain('w-done@0');
    expect(rows).toContain('w-sub@1');
  });

  it('rule 4 for the coordinator: one that is itself another\'s worker becomes a parent of its kept worker, and no row is lost', () => {
    const top = sess('top', 'project-c', { role: 'coordinator' });
    const above = run(20, 'top', 'coord', { program: 'billing' });
    const far = run(11, 'coord', 'w-far', { wave: 2, project: 'project-b' });
    const f = fleet([top, coord, worker('w-done', 10), worker('w-far', 11, 'project-b')], [above, closed, far]);
    // The top level keeps the fleet's own order; the kept worker sits one line under its coordinator.
    const rows = card(f, 'project-c').g.rows.map((r) => `${idOf(r)}@${r.depth}`);
    expect([...rows].sort()).toEqual(['coord@0', 'top@0', 'w-done@1']);
    expect(rows[rows.indexOf('coord@0') + 1]).toBe('w-done@1');
  });

  it('a kept worker that is itself a parent makes no parent of its coordinator: the coordinator stays under its own', () => {
    const top = sess('top', 'project-c', { role: 'coordinator' });
    const above = run(20, 'top', 'coord', { program: 'billing' });
    const far = run(11, 'coord', 'w-far', { wave: 2, project: 'project-b' });
    const own = run(12, 'w-done', 'w-sub', { program: 'search' });
    const f = fleet([top, coord, worker('w-done', 10), worker('w-sub', 12), worker('w-far', 11, 'project-b')],
      [above, closed, far, own]);
    const rows = card(f, 'project-c').g.rows.map((r) => `${idOf(r)}@${r.depth}`);
    expect(rows).toEqual(['top@0', 'coord@1', 'w-done@0', 'w-sub@1']);
  });

  const keptBy = (coordinatorId: string, id: number): KeptRun => ({ id, program: 'port-api', wave: 1, coordinatorId });

  it('a kept worker that heads a kept worker of its own stays at the top level, and no row is lost', () => {
    const list = [sess('c', 'project-c'), sess('k1', 'project-c'), sess('k2', 'project-c')];
    const kept = new Map([['k1', keptBy('c', 10)], ['k2', keptBy('k1', 11)]]);
    expect(nestFleet(list, [], kept).map((r) => `${idOf(r)}@${r.depth}`)).toEqual(['c@0', 'k1@0', 'k2@1']);
  });

  it('a kept worker an open edge already places makes no parent of its coordinator', () => {
    const list = [sess('t', 'project-c'), sess('c', 'project-c'), sess('k', 'project-c')];
    const rows = nestFleet(list, [run(20, 't', 'k'), run(21, 't', 'c')], new Map([['k', keptBy('c', 10)]]));
    expect(rows.map((r) => `${idOf(r)}@${r.depth}`).sort()).toEqual(['c@1', 'k@1', 't@0']);
  });

  it('nestFleet with no kept map is today\'s tree', () => {
    const bound = withProgrammeBinding([coord, worker('w-done', 10)], [closed, live]);
    expect(nestFleet(bound, [live]).map((r) => `${idOf(r)}@${r.depth}`)).toEqual(['coord@0', 'w-done@0']);
  });
});

describe('the kept worker\'s label (D-8982)', () => {
  const [done] = withProgrammeBinding([worker('w-done', 10)], [closed, live]);
  const kept = keptRunOf(done!, [live]);

  it('names its programme and wave and says the run closed, never "run not on the board"', () => {
    const l = childOfRunLabel(done!, childRunContext(done!, [live], (id) => (id === 'coord' ? coord : null), kept))!;
    expect(l.text).toBe('port-api · wave 1 · run closed');
    expect(l.data).toBe('child');
    expect(l.title).toContain('run #10');
    expect(l.title).toContain('coord');
  });

  it('without the kept fact the label is today\'s', () => {
    expect(childOfRunLabel(done!, childRunContext(done!, [live], () => null))!.text).toBe('run not on the board');
  });
});
