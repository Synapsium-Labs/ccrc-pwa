// D-8186 (Linear hierarchy plan, Task 7.4): the report and put back. Put back runs from the move record alone: the ccrc half first
// (the records dropped "put back"), then each issue restored and each created initiative and project canceled.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPlanChanges, NO_PLAN_CHANGES, type NewTicket, type PlanChanges } from '../src/coord/planStore.js';
import { cleanMigRigs, entry, fail, leaf, migRig, OWNER, SLUG, T, U, type MigRig } from './migrationRig.js';
import { WS } from './linearProxyRig.js';
import { tx } from '../src/coord/tx.js';
import { PUT_BACK_ISSUES_PER_TICK } from '../src/linear/migration.js';

afterEach(() => { vi.restoreAllMocks(); cleanMigRigs(); });

const changes = (over: Partial<PlanChanges>): PlanChanges => ({ ...NO_PLAN_CHANGES(), ...over });
const STRUCTURE = { epics: [{ programme: 'prog-b', epics: [{ key: 'eb', title: 'Epic B', summary: 'S', project: 'project-a', waves: [] as number[], checkpoints: [{ key: 'cb', title: 'Checkpoint B', kind: 'acceptance' as const }] }] }] };
const B_LEAF = (n: number, key: string) => leaf(n, key, { programme: 'prog-b', epic: 'eb', checkpoint: 'cb' });
const reportItem = (r: MigRig, id: number): number => r.plan.migrationById(id)!.reportItemId!;
async function putBack(r: MigRig, id: number): Promise<void> {
  expect(r.mig.act(reportItem(r, id), id, 'put-back', null)).toEqual({ ok: true });
  await r.until(() => r.stateOf(id) === 'put-back', 30);
  expect(r.stateOf(id)).toBe('put-back');
}
const putBackAsks = (r: MigRig) => r.asks.filter((a) => a.pass === 'put-back');

describe('the migration report and put back (D-8186)', () => {
  it('the report counts skipped issues', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2); r.addIssue(3);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2'), entry(3, 'stale')]);
    r.issues.get(U(102))!.title = 'Changed by a person';
    await r.until(() => r.stateOf(id) === 'applied');
    const m = r.plan.migrationById(id)!;
    expect(m.report!.skipped).toEqual(['AAA-2']);
    const item = r.db.prepare('SELECT title, why FROM operator_items WHERE id = ?').get(m.reportItemId!) as { title: string; why: string };
    expect(item.title).toContain('team AAA');
    expect(item.why).toContain('1 moved');
    expect(item.why).toContain('1 closed');
    expect(item.why).toContain('1 skipped as changed');
  });

  it('put back reverses every move and cancels created objects', async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    r.addIssue(1); r.addIssue(2);
    const id = await r.applied([B_LEAF(1, 'k1'), entry(2, 'stale')], STRUCTURE);
    const tid = r.plan.planOf('prog-b').epics[0]!.tickets[0]!.id;
    expect(r.issues.get(U(101))!.projectId).not.toBeNull();
    expect(r.issues.get(U(102))!.stateType).toBe('canceled');
    await putBack(r, id);
    expect(r.issues.get(U(101))).toMatchObject({ projectId: null, milestoneId: null, stateType: 'unstarted', title: 'Issue 1', description: 'Body 1', teamKey: 'AAA' });
    expect(r.issues.get(U(102))!.stateType).toBe('unstarted');   // the closed issue is open again
    const epic = r.plan.planOf('prog-b').epics[0]!;
    expect(epic).toMatchObject({ state: 'dropped' });
    expect(epic.putBackAt).not.toBeNull();
    expect(epic.checkpoints[0]!.putBackAt).not.toBeNull();
    expect(r.plan.ticketById(tid)).toMatchObject({ state: 'dropped' });
    expect(r.plan.ticketById(tid)!.putBackAt).not.toBeNull();
    const moves = r.plan.movesOf(id);
    expect(moves.filter((m) => m.kind !== 'checkpoint').every((m) => m.revertedAt !== null)).toBe(true);
    expect(r.plan.migrationById(id)).toMatchObject({ state: 'put-back' });
    expect(r.plan.migrationById(id)!.putBackAt).not.toBeNull();
  });

  it('an issue moved since is listed, not touched', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.applied([leaf(1, 'k1'), leaf(2, 'k2')]);
    r.issues.get(U(101))!.title = 'Renamed by a person after the migration';
    await putBack(r, id);
    expect(r.issues.get(U(101))!.title).toBe('Renamed by a person after the migration');
    expect(r.issues.get(U(101))!.projectId).not.toBeNull();  // untouched, still in ccrc's project
    expect(putBackAsks(r).filter((a) => a.op === 'issueUpdate' && a.input['id'] === U(101))).toHaveLength(0);
    expect(r.issues.get(U(102))).toMatchObject({ projectId: null, title: 'Issue 2' });
    expect(r.plan.migrationById(id)!.report!.movedSince).toEqual(['AAA-1']);
  });

  it('put back after the next migration started is refused', async () => {
    const r = await migRig();
    r.addIssue(1);
    const id = await r.applied([leaf(1, 'k1')]);
    r.plan.insertMigration({ workspaceId: WS.a.id, teamKey: 'AAA', project: 'project-a', now: r.t.now });
    expect(r.mig.act(reportItem(r, id), id, 'put-back', null)).toMatchObject({ ok: false, word: 'migration-in-flight' });
    expect(r.plan.migrationById(id)!.putBackAskedAt).toBeNull();
    await r.tick();
    expect(r.stateOf(id)).toBe('applied');
    expect(putBackAsks(r)).toHaveLength(0);
  });

  it("after put back, the next sync pass writes nothing to an adopted issue", async () => {
    const r = await migRig();
    r.addIssue(1);
    const id = await r.applied([leaf(1, 'k1')]);
    await putBack(r, id);
    r.asks.length = 0;
    r.plan.markSyncDue(SLUG, r.t.now);
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    r.t.now += 60_000;
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    expect(r.asks.filter((a) => /^(issue)(Update|Create|Comment|Link)/.test(a.op))).toEqual([]);
    expect(r.issues.get(U(101))).toMatchObject({ projectId: null, title: 'Issue 1', description: 'Body 1' });
  });

  it('put back cancels the projects and initiatives the executor created, from their move rows', async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    r.addIssue(1);
    const id = await r.applied([B_LEAF(1, 'k1')], STRUCTURE);
    const moves = r.plan.movesOf(id);
    const prog = moves.find((m) => m.kind === 'programme')!;
    const epic = moves.find((m) => m.kind === 'epic')!;
    r.asks.length = 0;
    await putBack(r, id);
    const proj = putBackAsks(r).filter((a) => a.op === 'projectUpdate');
    expect(proj).toHaveLength(1);
    expect(proj[0]).toMatchObject({ target: epic.linearId, lane: 'migration', input: { id: epic.linearId, statusId: U(34) } });
    // the initiative is canceled by put back itself, with the plan's end recorded (see the next test)
    expect(putBackAsks(r).filter((a) => a.op === 'initiativeUpdate')).toEqual([
      expect.objectContaining({ target: prog.linearId, lane: 'migration', input: { id: prog.linearId, status: 'Canceled' } }),
    ]);
    expect(prog.linearId).not.toBeNull();
  });

  it("put back records the programme's plan end and cancels its initiative, and the sync never writes it again", async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    r.addIssue(1);
    const id = await r.applied([B_LEAF(1, 'k1')], STRUCTURE);
    expect(r.plan.planEndOf('prog-b')).toBeNull();
    r.asks.length = 0;
    await putBack(r, id);
    expect(r.plan.planEndOf('prog-b')).toMatchObject({ outcome: 'abandoned', why: 'put back' });
    expect(r.asks.filter((a) => a.op === 'initiativeUpdate' && a.pass === 'put-back')).toHaveLength(1);
    r.asks.length = 0;
    await r.sync.passFor('prog-b', r.t.now + 60_000);
    await r.sync.passFor('prog-b', r.t.now + 60_000);
    expect(r.asks.filter((a) => a.op === 'initiativeUpdate')).toEqual([]);
  });

  it('put back leaves a programme its coordinator has since declared: no plan end, no initiative write (security review)', async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    r.addIssue(1);
    const id = await r.applied([B_LEAF(1, 'k1')], STRUCTURE);
    r.db.prepare("UPDATE programs SET planBy = 'coord-b' WHERE slug = 'prog-b'").run();
    r.asks.length = 0;
    await putBack(r, id);
    expect(r.plan.migrationById(id)!.state).toBe('put-back');
    expect(r.plan.planEndOf('prog-b')).toBeNull();
    expect(r.asks.filter((a) => a.op === 'initiativeUpdate' && a.pass === 'put-back')).toEqual([]);
  });

  it('put back drops the ticket of a move row that never applied, as well as the applied ones (security review)', async () => {
    const r = await migRig();
    r.addIssue(1);
    const id = await r.applied([leaf(1, 'k1')]);
    const row = r.plan.movesOf(id).find((x) => x.kind === 'issue')!;
    r.db.prepare('UPDATE linear_migration_moves SET appliedAt = NULL WHERE id = ?').run(row.id);
    await putBack(r, id);
    const ticket = r.plan.planOf(SLUG).epics.flatMap((e) => e.tickets).find((t) => t.id === row.after['ticketId']);
    expect(ticket?.putBackAt).not.toBeNull();
  });

  it("put back leaves the project's Upkeep epic in place, and inbound keeps placing into it", async () => {
    const r = await migRig();
    r.addIssue(1);
    const id = await r.applied([entry(1, 'upkeep')]);
    const epic = r.plan.upkeepEpicOf('project-a')!;
    expect(epic).not.toBeNull();
    await putBack(r, id);
    const after = r.plan.upkeepEpicOf('project-a')!;
    expect(after).toMatchObject({ id: epic.id, state: epic.state });
    expect(after.state).not.toBe('dropped');
    expect(after.putBackAt).toBeNull();
    expect(r.plan.movesOf(id).filter((m) => m.subject.startsWith('epic:'))).toEqual([]);
    expect(r.asks.filter((a) => a.op === 'projectUpdate')).toEqual([]);                 // its Linear project is not canceled
    expect(tx(r.coord.db, () => r.plan.ensureUpkeepEpicInTx('project-a', r.t.now))).toBe(epic.id);   // inbound reuses it
  });

  it('put back runs a few issues a tick and finishes', async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    for (let n = 1; n <= 5; n += 1) r.addIssue(n);
    const id = await r.applied([1, 2, 3, 4, 5].map((n) => B_LEAF(n, `k${n}`)), STRUCTURE);
    expect(r.mig.act(reportItem(r, id), id, 'put-back', null)).toEqual({ ok: true });
    r.asks.length = 0;
    const per: number[] = [];
    let projectBeforeIssuesDone = false;
    for (let i = 0; i < 12 && r.stateOf(id) !== 'put-back'; i += 1) {
      const from = r.asks.length;
      await r.tick();
      const slice = r.asks.slice(from);
      per.push(slice.filter((a) => a.pass === 'put-back' && a.op === 'issueUpdate').length);
      const restored = [...r.issues.values()].filter((x) => x.projectId === null).length;
      if (restored < 5 && slice.some((a) => a.op === 'projectUpdate')) projectBeforeIssuesDone = true;
    }
    expect(r.stateOf(id)).toBe('put-back');
    expect(Math.max(...per)).toBeLessThanOrEqual(PUT_BACK_ISSUES_PER_TICK);
    expect(per.reduce((a, b) => a + b, 0)).toBe(5);
    expect(per.length).toBeGreaterThanOrEqual(3);
    expect(projectBeforeIssuesDone).toBe(false);             // a project is canceled only after every issue left it
    expect(r.asks.filter((a) => a.op === 'projectUpdate')).toHaveLength(1);
  });

  it('a created milestone is written nothing and listed', async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    r.addIssue(1);
    const id = await r.applied([B_LEAF(1, 'k1')], STRUCTURE);
    const cp = r.plan.movesOf(id).find((m) => m.kind === 'checkpoint')!;
    r.asks.length = 0;
    await putBack(r, id);
    expect(putBackAsks(r).filter((a) => a.op.startsWith('projectMilestone'))).toEqual([]);
    expect(r.asks.filter((a) => a.input['id'] === cp.linearId)).toEqual([]);
    expect(r.plan.migrationById(id)!.report!.milestonesLeft).toEqual([cp.subject]);
    expect(r.plan.movesOf(id).find((m) => m.id === cp.id)!.revertedAt).not.toBeNull();   // handled: listed once, never again
  });

  it("put back restores an adopted issue's title and description", async () => {
    const r = await migRig();
    r.addIssue(1, { title: 'A person wrote this title', description: 'And this long description' });
    const id = await r.applied([leaf(1, 'k1')]);
    expect(r.issues.get(U(101))!.description).toContain('kept by ccrc');
    await putBack(r, id);
    const w = putBackAsks(r).find((a) => a.op === 'issueUpdate')!;
    expect(w.input).toMatchObject({ id: U(101), title: 'A person wrote this title', description: 'And this long description', projectId: null, projectMilestoneId: null, parentId: null, stateId: U(21), teamId: WS.a.teams[0].id });
    expect(r.issues.get(U(101))).toMatchObject({ title: 'A person wrote this title', description: 'And this long description' });
  });

  it('a coordinator\'s own drop whose why reads "put back" is still canceled by the sync', async () => {
    const r = await migRig();
    const t: NewTicket = { program: SLUG, epicKey: 'e1', checkpointKey: 'c1', key: 'own', kind: 'work', title: 'Our own ticket', body: 'Do it', project: 'project-a', source: 'plan' };
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [t], update: [], drop: [] } }), OWNER, r.t.now, null);
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    const issueId = r.opsOf('issueCreate').length;
    expect(issueId).toBe(1);
    const tid = r.plan.planOf(SLUG).epics[0]!.tickets[0]!.id;
    const bound = r.plan.bindingOf('ticket', tid, WS.a.id)!;
    r.issues.set(bound.linearId!, { id: bound.linearId!, identifier: 'AAA-50', title: 'Our own ticket', description: 'x', teamKey: 'AAA', stateType: 'unstarted', projectId: null, milestoneId: null, parentId: null });
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [], update: [], drop: [{ id: tid, why: 'put back' }] } }), OWNER, r.t.now, null);
    expect(r.plan.ticketById(tid)!.putBackAt).toBeNull();     // a plain drop: not a migration's put back
    r.asks.length = 0;
    r.t.now += 60_000;
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    expect(r.issues.get(bound.linearId!)!.stateType).toBe('canceled');
    expect(r.asks.filter((a) => a.op === 'issueUpdate' && a.input['id'] === bound.linearId)).toHaveLength(1);
  });

  it('a sync pass between two put-back writes writes nothing to a restored issue', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.applied([leaf(1, 'k1'), leaf(2, 'k2')]);
    expect(r.mig.act(reportItem(r, id), id, 'put-back', null)).toEqual({ ok: true });
    let n = 0;
    r.override.current = (ask) => {
      if (ask.pass === 'put-back' && ask.op === 'issueUpdate') { n += 1; if (n === 2) return fail('unreachable'); }
      return undefined;
    };
    await r.tick();
    expect(r.stateOf(id)).toBe('applied');                    // half done: the second restore was refused
    const restored = [...r.issues.values()].filter((i) => i.projectId === null && i.title.startsWith('Issue'));
    expect(restored).toHaveLength(1);
    // the sync's pass runs between the two writes
    r.asks.length = 0;
    r.plan.markSyncDue(SLUG, r.t.now);
    r.t.now += 60_000;
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    expect(r.asks.filter((a) => a.op === 'issueUpdate' || a.op === 'issueCreate')).toEqual([]);
    expect(restored[0]!).toMatchObject({ projectId: null, description: expect.not.stringContaining('kept by ccrc') });
    await r.until(() => r.stateOf(id) === 'put-back', 20);
    expect(r.stateOf(id)).toBe('put-back');
    expect([...r.issues.values()].every((i) => i.projectId === null)).toBe(true);
    expect(T).toBeGreaterThan(0);
  });

  it('the team is no longer managed after put back', async () => {
    const r = await migRig();
    r.addIssue(1);
    const id = await r.applied([leaf(1, 'k1')]);
    expect(r.plan.managedTeams()).toEqual([{ workspaceId: WS.a.id, teamKey: 'AAA' }]);
    expect(r.mig.act(reportItem(r, id), id, 'put-back', null)).toEqual({ ok: true });
    expect(r.plan.managedTeams()).toEqual([{ workspaceId: WS.a.id, teamKey: 'AAA' }]);   // asked, not yet done
    await r.until(() => r.stateOf(id) === 'put-back', 30);
    expect(r.plan.managedTeams()).toEqual([]);
    // the report closes after a put back and the next team may start
    expect(r.mig.act(reportItem(r, id), id, 'done', null)).toEqual({ ok: true });
    expect(r.plan.migrationById(id)!.reportDoneAt).not.toBeNull();
  });
});
