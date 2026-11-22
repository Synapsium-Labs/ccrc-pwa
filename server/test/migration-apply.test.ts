// D-8186 and D-8796 (Linear hierarchy plan, Task 7.3): the apply. The migration writes each move row before its write, adopts a
// leaf or upkeep issue only with that row in one transaction, and lets the plan sync send the update on lane `migration`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIGRATION_CALLS_PER_TICK, MIGRATION_WRITES_PER_TICK } from '../src/linear/migration.js';
import { InboundLane } from '../src/linear/inboundLane.js';
import { readLinearStore } from '../src/linear/store.js';
import { adoptIssueBindingInTx, applyPlanChanges, NO_PLAN_CHANGES, takeInboundIntoEpic, type NewTicket, type PlanChanges } from '../src/coord/planStore.js';
import { cleanMigRigs, entry, leaf, migRig, ok, fail, SLUG, T, U, OWNER, type MigRig } from './migrationRig.js';
import { WS } from './linearProxyRig.js';
import type { CcrcOpOutcome } from '../src/linear/ccrcCall.js';

afterEach(() => { vi.restoreAllMocks(); cleanMigRigs(); });

const writesOf = (r: MigRig) => r.asks.filter((a) => a.op === 'issueUpdate' || a.op === 'issueComment' || a.op === 'issueRelationCreate');
const updates = (r: MigRig, id: string) => r.asks.filter((a) => a.op === 'issueUpdate' && a.input['id'] === id);
const moveRows = (r: MigRig, id: number) => r.plan.movesOf(id);
const tickets = (r: MigRig): number => (r.db.prepare('SELECT COUNT(*) AS n FROM plan_tickets').get() as { n: number }).n;
const ticketBindings = (r: MigRig) => r.db.prepare("SELECT * FROM linear_bindings WHERE localKind = 'ticket'").all() as { linearId: string | null; state: string }[];
const changes = (over: Partial<PlanChanges>): PlanChanges => ({ ...NO_PLAN_CHANGES(), ...over });

describe('the migration apply (D-8186, D-8796)', () => {
  it('every move is recorded before its write', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const seen: { op: string; id: string; moves: string[]; tickets: number }[] = [];
    const mid = { v: 0 };
    r.watch.current = (ask) => {
      if (ask.op !== 'issueComment' && ask.op !== 'issueUpdate') return;
      const id = String(ask.op === 'issueUpdate' ? ask.input['id'] : ask.input['issueId']);
      seen.push({ op: ask.op, id, moves: r.plan.movesOf(mid.v).map((m) => m.subject), tickets: tickets(r) });
    };
    const id = await r.approved([leaf(1, 'k1'), entry(2, 'stale')]);
    mid.v = id;
    await r.tick();
    const leafSeen = seen.filter((s) => s.id === U(101) && s.op === 'issueUpdate');
    const closerSeen = seen.filter((s) => s.id === U(102));
    expect(leafSeen).toHaveLength(1);
    expect(closerSeen.map((s) => s.op)).toEqual(['issueComment', 'issueUpdate']);
    for (const s of [...leafSeen, ...closerSeen]) expect(s.moves).toContain(`issue:${s.id}`);
    expect(leafSeen[0]!.tickets).toBe(1);                    // the adoption stands before the sync's update
  });

  it('a re-run after a crash redoes nothing applied', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), entry(2, 'stale')]);
    await r.tick();
    const rows = moveRows(r, id);
    expect(rows).toHaveLength(2);
    const before = writesOf(r).length;
    r.restart();                                             // the process dies and starts again
    await r.until(() => r.stateOf(id) === 'applied');
    expect(r.stateOf(id)).toBe('applied');
    expect(writesOf(r)).toHaveLength(before);                // nothing was written twice
    expect(moveRows(r, id)).toHaveLength(2);
    expect(moveRows(r, id).every((m) => m.appliedAt !== null)).toBe(true);
  });

  it('a crash after the write and before appliedAt marks the row applied on re-run and writes no second row', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), entry(2, 'stale')]);
    vi.spyOn(r.plan, 'setMove').mockImplementationOnce(() => { throw new Error('crash'); });
    await expect(r.tick()).rejects.toThrow('crash');         // the closer's write landed, its appliedAt did not
    expect(r.issues.get(U(102))!.stateType).toBe('canceled');
    expect(moveRows(r, id).find((m) => m.identifier === 'AAA-2')!.appliedAt).toBeNull();
    const before = writesOf(r).length;
    r.restart();
    await r.until(() => r.stateOf(id) === 'applied');
    expect(r.stateOf(id)).toBe('applied');
    expect(writesOf(r)).toHaveLength(before);
    expect(moveRows(r, id)).toHaveLength(2);
    expect(moveRows(r, id).map((m) => m.appliedAt !== null)).toEqual([true, true]);
  });

  it('a crash between the adoption transaction and the pass: reconcileMove settles it with no second move row', async () => {
    const r = await migRig();
    r.addIssue(1);
    let held = 0;
    r.override.current = (ask) => {
      if (ask.op === 'issueUpdate' && held === 0) { held += 1; return fail('rate-limited'); }
      return undefined;
    };
    const id = await r.approved([leaf(1, 'k1')]);
    await r.tick();
    expect(moveRows(r, id)).toHaveLength(1);
    expect(moveRows(r, id)[0]!.appliedAt).toBeNull();         // adopted and recorded, the update refused
    expect(r.issues.get(U(101))!.title).toBe('Issue 1');
    await r.until(() => r.stateOf(id) === 'applied', 60);
    expect(r.stateOf(id)).toBe('applied');
    expect(moveRows(r, id)).toHaveLength(1);
    expect(tickets(r)).toBe(1);
    expect(updates(r, U(101)).length).toBeGreaterThanOrEqual(2);
    expect(r.issues.get(U(101))!.description).toContain('kept by ccrc');
  });

  it('a crash before the write redoes it on re-run', async () => {
    const r = await migRig();
    r.addIssue(2);
    let refused = 0;
    r.override.current = (ask) => {
      if (ask.op === 'issueUpdate' && refused === 0) { refused += 1; return fail('unreachable'); }
      return undefined;
    };
    const id = await r.approved([entry(2, 'stale')]);
    await r.tick();
    expect(moveRows(r, id)).toHaveLength(1);
    expect(moveRows(r, id)[0]!.appliedAt).toBeNull();
    expect(r.issues.get(U(102))!.stateType).toBe('unstarted');
    r.restart();
    await r.until(() => r.stateOf(id) === 'applied');
    expect(r.stateOf(id)).toBe('applied');
    expect(r.issues.get(U(102))!.stateType).toBe('canceled');
    expect(moveRows(r, id)).toHaveLength(1);
    expect(updates(r, U(102))).toHaveLength(2);               // the refused one and the redo
  });

  it('an issue adopted only with its move row; a skipped issue is never adopted', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2); r.addIssue(3, { stateType: 'unstarted' });
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2'), leaf(3, 'k3')]);
    r.issues.get(U(102))!.title = 'Changed by a person';      // skipped
    r.issues.get(U(103))!.stateType = 'completed';            // closed since: skipped
    // the move row cannot be written: the adoption rolls back whole
    vi.spyOn(r.plan, 'insertMove').mockImplementationOnce(() => { throw new Error('crash'); });
    await expect(r.tick()).rejects.toThrow('crash');
    expect(tickets(r)).toBe(0);
    expect(ticketBindings(r)).toHaveLength(0);
    expect(moveRows(r, id)).toHaveLength(0);
    vi.restoreAllMocks();
    r.restart();
    await r.until(() => r.stateOf(id) === 'applied');
    expect(r.stateOf(id)).toBe('applied');
    expect(r.plan.migrationById(id)!.report!.skipped.sort()).toEqual(['AAA-2', 'AAA-3']);
    expect(tickets(r)).toBe(1);                              // AAA-1 only
    expect(ticketBindings(r).map((b) => b.linearId)).toEqual([U(101)]);
    expect(moveRows(r, id).map((m) => m.identifier)).toEqual(['AAA-1']);
    expect(updates(r, U(102))).toHaveLength(0);
  });

  it('the sync emits nothing for an adopted issue on its next pass', async () => {
    const r = await migRig();
    r.addIssue(1);
    const id = await r.applied([leaf(1, 'k1')]);
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual([]);   // the move's expect is what the sync wrote
    expect(r.plan.movesOf(id)[0]!.appliedAt).not.toBeNull();
    r.asks.length = 0;
    r.plan.markSyncDue(SLUG, r.t.now);
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    r.t.now += 60_000;
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    expect(r.asks.filter((a) => !a.op.endsWith('ById') && a.op !== 'issueOwned')).toEqual([]);
  });

  it('a migrated leaf is bound, and the next sync pass creates no issue', async () => {
    const r = await migRig();
    r.addIssue(1);
    await r.applied([leaf(1, 'k1')]);
    const b = ticketBindings(r);
    expect(b).toEqual([expect.objectContaining({ linearId: U(101), state: 'bound' })]);
    r.plan.markSyncDue(SLUG, r.t.now);
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    expect(r.opsOf('issueCreate')).toHaveLength(0);
    expect(r.plan.planOf(SLUG).epics[0]!.tickets.map((t) => [t.key, t.source])).toEqual([['k1', 'plan']]);
  });

  it('the first upkeep entry creates the Upkeep epic once and binds its issue', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    expect(r.plan.upkeepEpicOf('project-a')).toBeNull();
    const id = await r.applied([entry(1, 'upkeep'), entry(2, 'upkeep')]);
    const epic = r.plan.upkeepEpicOf('project-a');
    expect(epic).not.toBeNull();
    expect((r.db.prepare("SELECT COUNT(*) AS n FROM plan_epics WHERE title LIKE '%pkeep%'").get() as { n: number }).n).toBe(1);
    // The Upkeep epic is shared with the inbound path: it is no object of the migration's, so it has no move row.
    expect(moveRows(r, id).filter((m) => m.subject.startsWith('epic:'))).toEqual([]);
    expect(r.plan.bindingsOf('upkeep:project-a').some((b) => b.localKind === 'epic' && b.state === 'bound' && b.linearId !== null)).toBe(true);
    expect(ticketBindings(r).map((x) => x.linearId).sort()).toEqual([U(101), U(102)]);
    expect(r.plan.upkeepPlanOf('project-a').epics[0]!.tickets.map((t) => t.source)).toEqual(['inbound', 'inbound']);
  });

  it("the map's declared projects and initiatives are created by the sync as move rows with before null", async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    r.addIssue(1);
    const id = await r.applied([leaf(1, 'k1', { programme: 'prog-b', epic: 'eb', checkpoint: 'cb' })], {
      epics: [{ programme: 'prog-b', epics: [{ key: 'eb', title: 'Epic B', summary: 'S', project: 'project-a', waves: [], checkpoints: [{ key: 'cb', title: 'Checkpoint B', kind: 'acceptance' }] }] }],
    });
    const rowid = r.plan.programmeRowId('prog-b')!;
    const epicId = r.plan.planOf('prog-b').epics[0]!.id;
    const cpId = r.plan.planOf('prog-b').epics[0]!.checkpoints[0]!.id;
    const created = moveRows(r, id).filter((m) => m.before === null);
    expect(created.map((m) => m.subject).sort()).toEqual([`checkpoint:${cpId}`, `epic:${epicId}`, `programme:${rowid}`].sort());
    for (const m of created) { expect(m.linearId).not.toBeNull(); expect(m.appliedAt).not.toBeNull(); }
    expect(r.opsOf('initiativeCreate')).toHaveLength(1);
    expect(r.opsOf('projectCreate')).toHaveLength(1);
    expect(r.opsOf('projectMilestoneCreate')).toHaveLength(1);
    expect(r.plan.migrationById(id)!.report).toMatchObject({ skipped: [] });
    expect(ticketBindings(r).map((b) => b.linearId)).toEqual([U(101)]);
  });

  it('a changed issue is skipped and listed', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2); r.addIssue(3);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2'), entry(3, 'stale')]);
    r.issues.get(U(102))!.description = 'Rewritten by a person';
    r.issues.get(U(103))!.stateType = 'started';
    await r.until(() => r.stateOf(id) === 'applied');
    const m = r.plan.migrationById(id)!;
    expect(m.state).toBe('applied');
    expect(m.report!.skipped.sort()).toEqual(['AAA-2', 'AAA-3']);
    expect(updates(r, U(102))).toHaveLength(0);
    expect(updates(r, U(103))).toHaveLength(0);
    expect(r.issues.get(U(102))!.description).toBe('Rewritten by a person');
    expect((r.db.prepare('SELECT why FROM operator_items WHERE id = ?').get(m.reportItemId!) as { why: string }).why).toContain('2 skipped as changed');
  });

  it("a live programme's part waits until no run is dispatched or working, and the adoption itself waits", async () => {
    const r = await migRig();
    r.addIssue(1);
    const run = r.openRun(SLUG, 'working');
    const id = await r.approved([leaf(1, 'k1')]);
    await r.tick(); await r.tick(); await r.tick();
    expect(r.stateOf(id)).toBe('applying');
    expect(tickets(r)).toBe(0);                              // not adopted while the run works
    expect(ticketBindings(r)).toHaveLength(0);
    expect(moveRows(r, id)).toHaveLength(0);
    expect(r.plan.migrationById(id)!.report!.waiting).toEqual(['AAA-1']);
    expect(updates(r, U(101))).toHaveLength(0);
    r.db.prepare("UPDATE runs SET state = 'dispatched' WHERE id = ?").run(run);
    await r.tick();
    expect(tickets(r)).toBe(0);
    r.db.prepare("UPDATE runs SET state = 'done', closedAt = ? WHERE id = ?").run(T, run);
    await r.until(() => r.stateOf(id) === 'applied');
    expect(r.stateOf(id)).toBe('applied');
    expect(tickets(r)).toBe(1);
    expect(r.plan.migrationById(id)!.report!.waiting).toEqual([]);
  });

  it("the sync's writes for a migration's adopted issues are charged to lane migration with pass migration", async () => {
    const r = await migRig();
    r.addIssue(1);
    await r.applied([leaf(1, 'k1')]);
    const w = updates(r, U(101));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ pass: 'migration', lane: 'migration' });
    expect(r.asks.filter((a) => a.op === 'issueOwned').every((a) => a.lane === 'migration' && a.pass === 'migration')).toBe(true);
  });

  it("a large map does not delay an ordinary programme's sync step past one pass", async () => {
    const r = await migRig();
    r.addProgramme('prog-c', 'active');
    applyPlanChanges(r.db, 'prog-c', changes({
      epics: { insert: [{ key: 'ec', project: 'project-a', waves: [1], ordinal: 0, title: 'Epic C', summary: 'S' }], update: [], drop: [] },
      tickets: { insert: [], update: [], drop: [] },
    }), OWNER, T, null);
    for (let n = 1; n <= 6; n += 1) r.addIssue(n);
    await r.approved([1, 2, 3, 4, 5, 6].map((n) => leaf(n, `k${n}`)));
    r.mig.tick = r.mig.tick.bind(r.mig);
    await r.tick();
    // an ordinary programme's pending create goes out on the sync's own lane in the same tick the migration spends its share
    const t: NewTicket = { program: 'prog-c', epicKey: 'ec', checkpointKey: null, key: 'tc', kind: 'work', title: 'Ordinary ticket', body: 'Do it', project: 'project-a', source: 'plan' };
    applyPlanChanges(r.db, 'prog-c', changes({ tickets: { insert: [t], update: [], drop: [] } }), OWNER, r.t.now, null);
    r.asks.length = 0;
    await r.sync.passFor('prog-c', r.t.now + 60_000);
    const creates = r.opsOf('issueCreate');
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ pass: 'plan-sync', lane: 'sync' });
    // and the migration's own adopted writes stay on its lane
    await r.tick();
    expect(r.asks.filter((a) => a.op === 'issueUpdate' && a.pass === 'migration').every((a) => a.lane === 'migration')).toBe(true);
    expect(r.asks.filter((a) => a.op === 'issueUpdate' && a.pass === 'plan-sync')).toEqual([]);
  });

  it('at most MIGRATION_WRITES_PER_TICK issue writes start per tick', async () => {
    const r = await migRig();
    for (let n = 1; n <= 6; n += 1) r.addIssue(n);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2'), leaf(3, 'k3'), entry(4, 'stale'), entry(5, 'stale'), entry(6, 'stale')]);
    const per: number[] = [];
    for (let i = 0; i < 12 && r.stateOf(id) !== 'applied'; i += 1) {
      const from = r.asks.length;
      await r.tick();
      per.push(r.asks.slice(from).filter((a) => a.op === 'issueUpdate').length);
    }
    expect(r.stateOf(id)).toBe('applied');
    expect(Math.max(...per)).toBeLessThanOrEqual(MIGRATION_WRITES_PER_TICK);
    expect(per.reduce((a, b) => a + b, 0)).toBe(6);
    expect(per.length).toBeGreaterThanOrEqual(3);
  });

  it('nothing is ever deleted', async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    for (let n = 1; n <= 6; n += 1) r.addIssue(n);
    const id = await r.applied([
      leaf(1, 'k1', { programme: 'prog-b', epic: 'eb', checkpoint: 'cb' }), leaf(2, 'k2'),
      entry(3, 'programme', { programme: 'prog-b' }), entry(4, 'finished', { pr: 'org-a/repo-a#12' }), entry(5, 'superseded', { successor: U(102) }), entry(6, 'stale'),
    ], { epics: [{ programme: 'prog-b', epics: [{ key: 'eb', title: 'Epic B', summary: 'S', project: 'project-a', waves: [], checkpoints: [{ key: 'cb', title: 'CB', kind: 'acceptance' }] }] }] });
    const m = r.plan.migrationById(id)!;
    expect(r.mig.act(m.reportItemId!, id, 'put-back', null)).toEqual({ ok: true });
    await r.until(() => r.stateOf(id) === 'put-back');
    expect(r.stateOf(id)).toBe('put-back');
    expect(r.asks.length).toBeGreaterThan(10);
    expect(r.asks.filter((a) => /Delete|Archive/i.test(a.op))).toEqual([]);
  });

  it('the team is managed after apply', async () => {
    const r = await migRig();
    r.addIssue(1);
    expect(r.plan.managedTeams()).toEqual([]);
    const id = await r.approved([leaf(1, 'k1')]);
    expect(r.plan.managedTeams()).toEqual([]);               // approved is not managed
    await r.until(() => r.stateOf(id) === 'applied');
    expect(r.plan.managedTeams()).toEqual([{ workspaceId: WS.a.id, teamKey: 'AAA' }]);
    expect(r.plan.migrationById(id)!.reportItemId).not.toBeNull();
    expect(r.db.prepare('SELECT planRequired FROM programs WHERE slug = ?').get(SLUG)).toMatchObject({ planRequired: 1 });
  });

  it('applied only when every move is applied or skipped', async () => {
    const r = await migRig();
    r.addIssue(1);
    let blocked = true;
    r.override.current = (ask) => (blocked && ask.op === 'issueUpdate' ? fail('unreachable') : undefined);
    const id = await r.approved([leaf(1, 'k1')]);
    for (let i = 0; i < 4; i += 1) await r.tick();
    expect(moveRows(r, id)[0]!.appliedAt).toBeNull();
    expect(r.stateOf(id)).toBe('applying');
    expect(r.plan.managedTeams()).toEqual([]);
    expect(r.plan.migrationById(id)!.reportItemId).toBeNull();
    blocked = false;
    await r.until(() => r.stateOf(id) === 'applied', 60);
    expect(r.stateOf(id)).toBe('applied');
    expect(moveRows(r, id)[0]!.appliedAt).not.toBeNull();
    expect(ok()).toBeTruthy();
  });
});

const expectedFields = (r: MigRig, id: number, identifier: string): Record<string, unknown> =>
  (r.plan.movesOf(id).find((m) => m.identifier === identifier)!.after['expect'] as Record<string, unknown>);

describe('the migration apply reads each issue by id (D-8796, review round)', () => {
  it('an issue a person edits after the tick began is read inside the flight and skipped, never adopted', async () => {
    const r = await migRig();
    r.addIssue(1);
    const id = await r.approved([leaf(1, 'k1')]);
    r.asks.length = 0;                                       // the propose's page read is not the apply's
    const flight = r.sync.withFlight.bind(r.sync);
    vi.spyOn(r.sync, 'withFlight').mockImplementation((key, fn) => {
      if (key === SLUG) r.issues.get(U(101))!.title = 'Edited while the tick ran';   // after the tick's snapshot, before the key's flight
      return flight(key, fn);
    });
    await r.until(() => r.stateOf(id) === 'applied');
    expect(r.stateOf(id)).toBe('applied');
    expect(tickets(r)).toBe(0);
    expect(moveRows(r, id)).toHaveLength(0);
    expect(updates(r, U(101))).toHaveLength(0);
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual(['AAA-1']);
    expect(r.asks.some((a) => a.op === 'issueOwned' && a.input['id'] === U(101) && a.pass === 'migration' && a.lane === 'migration')).toBe(true);
    expect(r.asks.some((a) => a.op === 'teamOpenIssues')).toBe(false);              // no page read in the apply
    expect(r.issues.get(U(101))!.title).toBe('Edited while the tick ran');
  });

  it('a description Linear re-flows (trailing whitespace) still reconciles as applied', async () => {
    const r = await migRig();
    r.addIssue(1);
    r.override.current = (ask) => (ask.op === 'issueUpdate' ? fail('unreachable') : undefined);
    const id = await r.approved([leaf(1, 'k1')]);
    await r.tick();
    expect(moveRows(r, id)[0]!.appliedAt).toBeNull();        // adopted, its write refused
    r.override.current = null;
    // the write lands with Linear's whitespace re-flow: trailing spaces, CRLF and a run of blank lines
    const exp = expectedFields(r, id, 'AAA-1');
    const i = r.issues.get(U(101))!;
    if (typeof exp['description'] === 'string') i.description = `${exp['description'].replace(/\n/gu, '  \r\n')}  \r\n\r\n\r\n\r\n`;
    if (typeof exp['title'] === 'string') i.title = exp['title'];
    if ('state' in exp) i.stateType = String(exp['state']);
    if ('project' in exp) i.projectId = (exp['project'] as string | null) ?? null;
    if ('milestone' in exp) i.milestoneId = (exp['milestone'] as string | null) ?? null;
    if ('parent' in exp) i.parentId = (exp['parent'] as string | null) ?? null;
    const before = updates(r, U(101)).length;
    await r.until(() => r.stateOf(id) === 'applied', 10);
    expect(r.stateOf(id)).toBe('applied');
    expect(moveRows(r, id)[0]!.appliedAt).not.toBeNull();
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual([]);
    expect(updates(r, U(101))).toHaveLength(before);         // nothing redone
  });

  it('an adopted issue changed before its write is put aside: its ticket dropped "put back", the sync writes nothing to it, and a follow-up map can move it again', async () => {
    const r = await migRig();
    r.addIssue(1);
    r.override.current = (ask) => (ask.op === 'issueUpdate' ? fail('unreachable') : undefined);
    const id = await r.approved([leaf(1, 'k1')]);
    await r.tick();
    const row = moveRows(r, id)[0]!;
    const ticketId = row.after['ticketId'] as number;
    expect(row.appliedAt).toBeNull();
    r.override.current = null;
    r.issues.get(U(101))!.title = 'A person renamed it between the adoption and the write';
    const refused = updates(r, U(101)).length;
    await r.until(() => r.stateOf(id) === 'applied', 10);
    expect(r.stateOf(id)).toBe('applied');
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual(['AAA-1']);
    expect(r.plan.ticketById(ticketId)).toMatchObject({ state: 'dropped' });
    expect(r.plan.ticketById(ticketId)!.putBackAt).not.toBeNull();
    expect(moveRows(r, id)[0]!.subject).toMatch(/^issue:.+:skipped:\d+$/u);
    // the sync writes nothing to the person's issue
    r.plan.markSyncDue(SLUG, r.t.now);
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    r.t.now += 60_000;
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    expect(updates(r, U(101))).toHaveLength(refused);
    expect(r.issues.get(U(101))!.title).toBe('A person renamed it between the adoption and the write');
    // a follow-up map can move it again
    const open = await r.mig.readOpen('AAA', WS.a.id);
    if (!open.ok) throw new Error('read');
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1b')] }, open)).toMatchObject({ ok: true, migrationId: id });
    const m = r.plan.migrationById(id)!;
    expect(r.mig.act(m.itemId!, id, 'approve', null)).toEqual({ ok: true });
    await r.until(() => r.stateOf(id) === 'applied' && moveRows(r, id).some((x) => x.subject === `issue:${U(101)}` && x.appliedAt !== null), 20);
    expect(moveRows(r, id).filter((x) => x.subject === `issue:${U(101)}`)).toHaveLength(1);
    expect(moveRows(r, id).find((x) => x.subject === `issue:${U(101)}`)!.appliedAt).not.toBeNull();
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual([]);
  });

  it('a map-declared programme declared by its coordinator before the apply skips its issues and the migration finishes', async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1', { programme: 'prog-b', epic: 'eb', checkpoint: 'cb' }), leaf(2, 'k2')], {
      epics: [{ programme: 'prog-b', epics: [{ key: 'eb', title: 'Epic B', summary: 'S', project: 'project-a', waves: [], checkpoints: [{ key: 'cb', title: 'CB', kind: 'acceptance' }] }] }],
    });
    // the coordinator declares prog-b's plan itself, after the map was approved
    applyPlanChanges(r.db, 'prog-b', changes({
      epics: { insert: [{ key: 'ez', project: 'project-a', waves: [1], ordinal: 0, title: 'Their own epic', summary: 'S' }], update: [], drop: [] },
    }), OWNER, T, null);
    expect(r.plan.planOf('prog-b').planBy).toBe(OWNER);
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual(['AAA-1']);
    expect(r.plan.planOf('prog-b').epics.map((e) => e.key)).toEqual(['ez']);        // the map's structure was not created
    expect(moveRows(r, id).filter((m) => m.before === null)).toEqual([]);
    expect(moveRows(r, id).map((m) => m.identifier)).toEqual(['AAA-2']);            // the other issue still moved
    expect(r.opsOf('initiativeCreate')).toHaveLength(0);
  });

  it("with initiatives off the map's declared programme does not hold the apply", async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    r.addIssue(1);
    const id = await r.approved([leaf(1, 'k1', { programme: 'prog-b', epic: 'eb', checkpoint: 'cb' })], {
      epics: [{ programme: 'prog-b', epics: [{ key: 'eb', title: 'Epic B', summary: 'S', project: 'project-a', waves: [], checkpoints: [{ key: 'cb', title: 'CB', kind: 'acceptance' }] }] }],
    });
    r.db.prepare("UPDATE project_linking SET initiatives = 'off' WHERE project = 'project-a'").run();
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    const rowid = r.plan.programmeRowId('prog-b')!;
    const prog = moveRows(r, id).find((m) => m.subject === `programme:${rowid}`)!;
    expect(prog.appliedAt).not.toBeNull();
    expect(prog.linearId).toBeNull();                        // settled with no Linear id: no initiative exists
    expect(r.opsOf('initiativeCreate')).toHaveLength(0);
  });

  it('a rate refusal rests the lane until its retry time', async () => {
    const r = await migRig();
    r.addIssue(1);
    let refused = 0;
    r.override.current = (ask) => {
      if (ask.op === 'issueOwned' && refused === 0) { refused += 1; return { ok: false, word: 'rate-limited', retryAfterS: 600 } as CcrcOpOutcome; }
      return undefined;
    };
    const id = await r.approved([leaf(1, 'k1')]);
    await r.tick();
    expect(refused).toBe(1);
    const n = r.asks.length;
    await r.tick();                                          // 31 s later: still resting
    await r.tick();
    expect(r.asks).toHaveLength(n);
    expect(r.stateOf(id)).toBe('applying');
    await r.tick(600_000);                                   // past the retry time
    expect(r.asks.length).toBeGreaterThan(n);
    await r.until(() => r.stateOf(id) === 'applied', 10);
    expect(r.stateOf(id)).toBe('applied');
  });
});

describe('review 2892 fix round 1: the apply (D-8186)', () => {
  it('F3: a step that cannot be placed now spends no budget, is listed as waiting with its reason, and the closers behind it run', async () => {
    const r = await migRig();
    for (let n = 1; n <= 4; n += 1) r.addIssue(n);
    // The Upkeep epic's project cannot be created, so neither upkeep issue can be placed under it.
    r.override.current = (ask) => (ask.op === 'projectCreate' ? fail('unreachable') : undefined);
    const id = await r.approved([entry(1, 'upkeep'), entry(2, 'upkeep'), entry(3, 'stale'), entry(4, 'stale')]);
    for (let i = 0; i < 6; i += 1) await r.tick();
    expect(r.issues.get(U(103))!.stateType).toBe('canceled');
    expect(r.issues.get(U(104))!.stateType).toBe('canceled');
    expect(r.stateOf(id)).toBe('applying');
    const report = r.plan.migrationById(id)!.report!;
    expect([...report.waiting].sort()).toEqual(['AAA-1', 'AAA-2']);
    expect(report.waitingWhy).toEqual({ 'AAA-1': 'upkeep-not-in-linear', 'AAA-2': 'upkeep-not-in-linear' });
    expect(moveRows(r, id).filter((m) => m.identifier === 'AAA-1' || m.identifier === 'AAA-2')).toEqual([]);
    // once the project can be created, the waiting issues are placed and the migration finishes
    r.override.current = null;
    await r.until(() => r.stateOf(id) === 'applied', 30);
    expect(r.stateOf(id)).toBe('applied');
    expect(r.plan.migrationById(id)!.report!.waiting).toEqual([]);
  });

  it('F5: an issue changed after its adoption reaches the Linear owner once as inbound, and is never written', async () => {
    const r = await migRig();
    r.addIssue(1);
    r.override.current = (ask) => (ask.op === 'issueUpdate' ? fail('unreachable') : undefined);
    const id = await r.approved([leaf(1, 'k1')]);
    await r.tick();
    const row = moveRows(r, id)[0]!;
    const bindingId = row.after['bindingId'] as number;
    r.override.current = null;
    r.issues.get(U(101))!.title = 'A person renamed it between the adoption and the write';
    const before = updates(r, U(101)).length;
    await r.until(() => r.stateOf(id) === 'applied', 10);
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual(['AAA-1']);
    // the binding is retired, never deleted: the issue is no longer ccrc's
    expect(r.db.prepare('SELECT state, linearId FROM linear_bindings WHERE id = ?').get(bindingId)).toEqual({ state: 'retired', linearId: U(101) });
    expect(r.plan.issueBound(WS.a.id, { id: U(101), identifier: 'AAA-1' })).toBe(false);
    expect(r.plan.boundLinearIdsOf(WS.a.id)).not.toContain(U(101));
    expect(r.plan.bindingByLinearId(WS.a.id, U(101))).toBeNull();
    // the inbound lane sees it as an issue ccrc holds no live binding for, and mails the owner once
    const lane = new InboundLane({
      coord: r.coord, plan: r.plan, planSync: r.sync, readLinearStore: () => readLinearStore(r.ccrcDir), call: async () => fail('not-found'),
      now: () => r.t.now, presenceOf: () => 'alive', viaFleet: () => new Set(), directory: { get: () => null, filledAt: () => null, projectStatusesRead: () => 'none' },
    } as unknown as ConstructorParameters<typeof InboundLane>[0]);
    const node = { ...r.issues.get(U(101))! };
    for (let i = 0; i < 2; i += 1) {
      lane.detect(WS.a.id, [node], new Set(['AAA']), r.t.now);
      await lane.tick(r.t.now);
      r.t.now += 60_000;
    }
    expect(r.plan.inboundOf(U(101))).toMatchObject({ state: 'mailed', mailedTo: OWNER, identifier: 'AAA-1' });
    expect((r.db.prepare("SELECT COUNT(*) AS n FROM mail WHERE subject LIKE 'Linear inbound%' AND toId = ?").get(OWNER) as { n: number }).n).toBe(1);
    // and nothing writes it: no later sync pass, no migration tick
    r.plan.markSyncDue(SLUG, r.t.now);
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    await r.tick();
    expect(updates(r, U(101))).toHaveLength(before);
  });

  it('F8 (D-8798): apply sets planRequired for the programmes the map names and those with a declared plan, never an unnamed one with no plan', async () => {
    const r = await migRig();
    r.addProgramme('prog-c', 'active');          // homed in the team, live, no plan, not named by the map
    r.openRun('prog-c', 'working');
    // both existed before this build (`planRequired` 0, as migration 59 left every older programme)
    r.db.prepare("UPDATE programs SET planRequired = 0 WHERE slug IN (?, ?)").run(SLUG, 'prog-c');
    r.addIssue(1);
    const id = await r.applied([entry(1, 'stale')]);
    expect(r.stateOf(id)).toBe('applied');
    const req = (slug: string) => (r.db.prepare('SELECT planRequired FROM programs WHERE slug = ?').get(slug) as { planRequired: number }).planRequired;
    expect(req(SLUG)).toBe(1);                   // declared (its coordinator's plan), not named
    expect(req('prog-c')).toBe(0);               // left alone: its coordinator's next run open is not refused plan-missing
  });

  it('A1: a replaced level relates to an issue the migration placed, by its applied move row, and the relation is sent once', async () => {
    const r = await migRig();
    for (let n = 1; n <= 3; n += 1) r.addIssue(n);
    let refusedState = 0;
    r.override.current = (ask) => {
      if (ask.op === 'issueUpdate' && ask.input['id'] === U(103) && 'stateId' in ask.input && refusedState === 0) { refusedState += 1; return fail('unreachable'); }
      return undefined;
    };
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2'), entry(3, 'epic', { programme: SLUG, epic: 'e1' })]);
    r.issues.get(U(101))!.title = 'Changed before the apply';      // the first leaf under e1 is skipped, never placed
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    const rel = r.opsOf('issueRelationCreate');
    expect(rel).toHaveLength(1);
    expect(rel[0]!.input).toMatchObject({ issueId: U(103), relatedIssueId: U(102) });
    expect(refusedState).toBe(1);
  });

  it('A7: every Linear call of a tick counts against its budget, and a refused close write rests the lane', async () => {
    const r = await migRig();
    for (let n = 1; n <= 4; n += 1) r.addIssue(n);
    const id = await r.approved([1, 2, 3, 4].map((n) => entry(n, 'stale')));
    const per: number[] = [];
    for (let i = 0; i < 12 && r.stateOf(id) !== 'applied'; i += 1) {
      const from = r.asks.length;
      await r.tick();
      per.push(r.asks.slice(from).filter((a) => a.lane === 'migration').length);
    }
    expect(r.stateOf(id)).toBe('applied');
    expect(Math.max(...per)).toBeLessThanOrEqual(MIGRATION_CALLS_PER_TICK);

    const q = await migRig();
    q.addIssue(1); q.addIssue(2);
    let refused = 0;
    q.override.current = (ask) => {
      if (ask.op === 'issueComment' && refused === 0) { refused += 1; return { ok: false, word: 'rate-limited', retryAfterS: 600 } as CcrcOpOutcome; }
      return undefined;
    };
    const qid = await q.approved([entry(1, 'stale'), entry(2, 'stale')]);
    await q.tick();
    expect(refused).toBe(1);
    const n = q.asks.length;
    await q.tick();                                          // 31 s later: resting
    expect(q.asks).toHaveLength(n);
    await q.tick(600_000);
    await q.until(() => q.stateOf(qid) === 'applied', 10);
    expect(q.stateOf(qid)).toBe('applied');
  });
});

describe('review 2918 fix round 2 (D-8186)', () => {
  const liveTicketBindings = (r: MigRig, linearId: string) => ticketBindings(r).filter((b) => b.linearId === linearId && b.state !== 'retired');
  const comments = (r: MigRig, id: string) => r.opsOf('issueComment').filter((a) => a.input['issueId'] === id).map((a) => String(a.input['body']));

  it('F1: an issue set aside and then taken by the owner through inbound is not opened again by a follow-up map', async () => {
    const r = await migRig();
    r.addIssue(1);
    r.override.current = (ask) => (ask.op === 'issueUpdate' ? fail('unreachable') : undefined);
    const id = await r.approved([leaf(1, 'k1')]);
    await r.tick();
    r.override.current = null;
    r.issues.get(U(101))!.title = 'A person renamed it between the adoption and the write';
    await r.until(() => r.stateOf(id) === 'applied', 10);
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual(['AAA-1']);   // set aside: its binding retired
    // the owner takes it through the inbound path: a new live binding holds it
    const lane = new InboundLane({
      coord: r.coord, plan: r.plan, planSync: r.sync, readLinearStore: () => readLinearStore(r.ccrcDir), call: async () => fail('not-found'),
      now: () => r.t.now, presenceOf: () => 'alive', viaFleet: () => new Set(), directory: { get: () => null, filledAt: () => null, projectStatusesRead: () => 'none' },
    } as unknown as ConstructorParameters<typeof InboundLane>[0]);
    lane.detect(WS.a.id, [{ ...r.issues.get(U(101))! }], new Set(['AAA']), r.t.now);
    await lane.tick(r.t.now);
    const e1 = r.plan.planOf(SLUG).epics.find((e) => e.key === 'e1')!;
    expect(takeInboundIntoEpic(r.db, { linearId: U(101), program: SLUG, epicId: e1.id, checkpointId: null, project: 'project-a', now: r.t.now })).toMatchObject({ ok: true });
    expect(liveTicketBindings(r, U(101))).toHaveLength(1);
    // the next tick moves it from the skipped list to `taken` (review 2955 F2): the owner's follow-up mail never asks for it, and
    // no migration waits for a map
    await r.tick();
    const rep = r.plan.migrationById(id)!.report!;
    expect(rep.taken).toEqual(['AAA-1']);
    expect(rep.skipped).toEqual([]);
    expect(r.db.prepare("SELECT subject FROM mail WHERE toId = ? AND subject LIKE '%follow-up%'").all(OWNER)).toEqual([]);
    const open = await r.mig.readOpen('AAA', WS.a.id);
    if (!open.ok) throw new Error('read');
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1b')] }, open)).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(liveTicketBindings(r, U(101))).toHaveLength(1);
  });

  it('F1: the adoption refuses an issue a live binding holds: one issue never gets a second ticket or a second bound binding', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2')]);
    // between Approve and the apply, a live binding comes to hold AAA-1 (the owner's take, say)
    const t: NewTicket = { program: SLUG, epicKey: 'e1', checkpointKey: 'c1', key: 'taken', kind: 'work', title: 'Taken', body: 'x', project: 'project-a', source: 'inbound' };
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [t], update: [], drop: [] } }), OWNER, r.t.now, null);
    const taken = r.plan.planOf(SLUG).epics[0]!.tickets.find((x) => x.key === 'taken')!.id;
    adoptIssueBindingInTx(r.db, taken, WS.a.id, 'AAA', U(101), 'AAA-1', r.t.now);
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(liveTicketBindings(r, U(101))).toHaveLength(1);
    expect(r.plan.movesOf(id).map((x) => x.identifier)).toEqual(['AAA-2']);
    expect(r.plan.migrationById(id)!.report!.taken).toEqual(['AAA-1']);   // review 2955 F2: its own list, not skipped
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual([]);
  });

  it('F2: a replaced level whose leaf is adopted in the same tick waits, listed, and closes related to that leaf once it is applied', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), entry(2, 'epic', { programme: SLUG, epic: 'e1' })]);
    await r.tick();
    expect(r.plan.movesOf(id).map((x) => x.identifier)).toEqual(['AAA-1']);   // the leaf adopted, the closer not started
    expect(comments(r, U(102))).toEqual([]);
    expect(updates(r, U(102))).toEqual([]);
    expect(r.plan.migrationById(id)!.report!.waitingWhy).toEqual({ 'AAA-2': 'placed-ticket-not-applied' });
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    const rel = r.opsOf('issueRelationCreate');
    expect(rel.map((a) => a.input)).toEqual([expect.objectContaining({ issueId: U(102), relatedIssueId: U(101) })]);
    expect(r.issues.get(U(102))!.stateType).toBe('canceled');
    expect(r.plan.migrationById(id)!.report!.unrelated ?? []).toEqual([]);
  });

  it('F2: a replaced level with every leaf under it skipped closes with no relation, and the report says so', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), entry(2, 'epic', { programme: SLUG, epic: 'e1' })]);
    r.issues.get(U(101))!.title = 'Changed before the apply';      // the only leaf under e1 is skipped
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(r.opsOf('issueRelationCreate')).toEqual([]);
    expect(r.issues.get(U(102))!.stateType).toBe('canceled');
    expect(r.plan.migrationById(id)!.report!.unrelated).toEqual(['AAA-2']);
  });

  it('F5 (1): a finished close comments with its evidence, built at the call site (a private team names the pull request)', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.applied([entry(1, 'finished', { pr: 'org-a/repo-a#12' }), entry(2, 'finished', { reason: 'shipped before ccrc kept a plan' })]);
    expect(r.stateOf(id)).toBe('applied');
    expect(comments(r, U(101))).toEqual([expect.stringContaining('org-a/repo-a#12')]);
    expect(comments(r, U(102))).toEqual([expect.stringContaining('no pull request: shipped before ccrc kept a plan')]);
  });

  it('F5 (3): the call budget bounds a tick that the writes cap alone does not (two closes with relations are 8 calls)', async () => {
    const r = await migRig();
    for (let n = 1; n <= 4; n += 1) r.addIssue(n);
    // the leaf settles on tick 2, beside the first close; the other two closes are then due together
    const id = await r.approved([leaf(1, 'k1'), entry(2, 'epic', { programme: SLUG, epic: 'e1' }), entry(3, 'checkpoint', { programme: SLUG, epic: 'e1', checkpoint: 'c1' }), entry(4, 'programme', { programme: SLUG })]);
    const per: number[] = [];
    for (let i = 0; i < 12 && r.stateOf(id) !== 'applied'; i += 1) {
      const from = r.asks.length;
      await r.tick();
      per.push(r.asks.slice(from).filter((a) => a.lane === 'migration').length);
    }
    expect(r.stateOf(id)).toBe('applied');
    expect(r.opsOf('issueRelationCreate')).toHaveLength(3);                  // every close relates: 4 calls each
    expect(Math.max(...per)).toBeLessThanOrEqual(MIGRATION_CALLS_PER_TICK);
  });

  it('A6: the report item names a done programme the map placed open tickets into', async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    r.addIssue(1);
    const id = await r.applied([leaf(1, 'k1', { programme: 'prog-b', epic: 'eb', checkpoint: 'cb' })],
      { epics: [{ programme: 'prog-b', epics: [{ key: 'eb', title: 'Epic B', summary: 'S', project: 'project-a', waves: [], checkpoints: [{ key: 'cb', title: 'CB', kind: 'acceptance' }] }] }] });
    const m = r.plan.migrationById(id)!;
    expect((r.db.prepare('SELECT why FROM operator_items WHERE id = ?').get(m.reportItemId!) as { why: string }).why)
      .toContain('Programme prog-b is done: each one\'s initiative stays active in Linear while its placed tickets are open.');
  });

  it('F8: a programme named only by an unclear entry is not made plan-required', async () => {
    const r = await migRig();
    r.addProgramme('prog-c', 'active', { home: 'project-x' });   // homed outside the team: never "declared"
    r.db.prepare("UPDATE programs SET planRequired = 0 WHERE slug = 'prog-c'").run();
    r.addIssue(1); r.addIssue(2);
    const id = await r.applied([leaf(1, 'k1'), entry(2, 'unclear', { programme: 'prog-c' })]);
    expect(r.stateOf(id)).toBe('applied');
    expect((r.db.prepare("SELECT planRequired FROM programs WHERE slug = 'prog-c'").get() as { planRequired: number }).planRequired).toBe(0);
  });
});

describe('review 2955 (D-8186)', () => {
  const comments = (r: MigRig, id: string) => r.opsOf('issueComment').filter((a) => a.input['issueId'] === id);
  /** A live ticket binding comes to hold issue `n` (the owner's take through inbound, say). */
  const hold = (r: MigRig, n: number, key: string): void => {
    const t: NewTicket = { program: SLUG, epicKey: 'e1', checkpointKey: 'c1', key, kind: 'work', title: key, body: 'x', project: 'project-a', source: 'inbound' };
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [t], update: [], drop: [] } }), OWNER, r.t.now, null);
    const id = r.plan.planOf(SLUG).epics[0]!.tickets.find((x) => x.key === key)!.id;
    adoptIssueBindingInTx(r.db, id, WS.a.id, 'AAA', U(100 + n), `AAA-${n}`, r.t.now);
  };
  it('F1: a no-relation level settled in step 2 stays listed when step 2\'s own next read is refused', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    applyPlanChanges(r.db, SLUG, changes({ checkpoints: { insert: [{ epicKey: 'e1', key: 'c2', ordinal: 1, title: 'Checkpoint two', kind: 'acceptance', proves: [], itemId: null }], update: [], drop: [] } }), OWNER, r.t.now, null);
    // map order: the checkpoint close (no leaf under c2), then the leaf under c1
    const id = await r.approved([entry(1, 'checkpoint', { programme: SLUG, epic: 'e1', checkpoint: 'c2' }), leaf(2, 'k2')]);
    // tick 1: step 3 adopts the leaf (its row stays unapplied) and starts the close, whose state write lands but its answer is lost
    r.override.current = (ask) => {
      if (ask.op !== 'issueUpdate' || ask.input['id'] !== U(101)) return undefined;
      r.issues.get(U(101))!.stateType = 'canceled';
      return fail('unreachable');
    };
    await r.tick();
    expect(r.plan.movesOf(id).map((x) => [x.identifier, x.appliedAt === null])).toEqual([['AAA-2', true], ['AAA-1', true]]);
    // tick 2: step 2 settles the close as applied (joins `unrelated`), then the leaf row's read is refused: step 2's own early return
    r.override.current = (ask) => (ask.op === 'issueOwned' && ask.input['id'] === U(102) ? fail('unreachable') : undefined);
    await r.tick();
    expect(r.plan.migrationById(id)!.report!.unrelated).toEqual(['AAA-1']);
    r.override.current = null;
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(r.plan.migrationById(id)!.report!.unrelated).toEqual(['AAA-1']);
  });

  it('F1: a no-relation level settled in step 2 stays listed when step 3\'s closer read is then refused', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([entry(1, 'epic', { programme: SLUG, epic: 'e1' }), entry(2, 'checkpoint', { programme: SLUG, epic: 'e1', checkpoint: 'c1' })]);
    // tick 1: the epic's close is commented, its state write lands but the answer is lost (3 calls), so the checkpoint is not reached
    r.override.current = (ask) => {
      if (ask.op !== 'issueUpdate' || ask.input['id'] !== U(101)) return undefined;
      r.issues.get(U(101))!.stateType = 'canceled';
      return fail('unreachable');
    };
    await r.tick();
    expect(r.plan.movesOf(id).map((x) => [x.identifier, x.appliedAt])).toEqual([['AAA-1', null]]);
    // tick 2: step 2 settles the epic's row as applied (1 call); step 3's checkpoint close then has its read refused inside its flight
    r.override.current = (ask) => (ask.op === 'issueOwned' && ask.input['id'] === U(102) ? fail('unreachable') : undefined);
    await r.tick();
    expect(r.plan.movesOf(id).map((x) => x.identifier)).toEqual(['AAA-1']);   // the checkpoint's row was never inserted
    expect(r.plan.migrationById(id)!.report!.unrelated).toEqual(['AAA-1']);
    r.override.current = null;
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(r.plan.migrationById(id)!.report!.unrelated).toEqual(['AAA-1', 'AAA-2']);
  });

  it('F1: a no-relation close\'s `unrelated` entry is kept when step 3 then ends early on a refused adoption read', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    // the second checkpoint has no leaf under it (the leaf sits under c1), so its close goes ahead with no relation
    applyPlanChanges(r.db, SLUG, changes({ checkpoints: { insert: [{ epicKey: 'e1', key: 'c2', ordinal: 1, title: 'Checkpoint two', kind: 'acceptance', proves: [], itemId: null }], update: [], drop: [] } }), OWNER, r.t.now, null);
    const id = await r.approved([entry(1, 'checkpoint', { programme: SLUG, epic: 'e1', checkpoint: 'c2' }), leaf(2, 'k2')]);
    // tick 1: the leaf cannot be placed yet (its epic is not bound in Linear), and the close's state write is refused once
    const epicBinding = r.db.prepare("SELECT id, state FROM linear_bindings WHERE localKind = 'epic' AND state = 'bound'").all() as { id: number; state: string }[];
    expect(epicBinding.length).toBeGreaterThan(0);
    r.db.prepare("UPDATE linear_bindings SET state = 'pending' WHERE localKind = 'epic' AND state = 'bound'").run();
    let refused = 0;
    r.override.current = (ask) => (ask.op === 'issueUpdate' && ask.input['id'] === U(101) && refused++ === 0 ? fail('unreachable') : undefined);
    await r.tick();
    expect(r.plan.movesOf(id).map((x) => [x.identifier, x.appliedAt])).toEqual([['AAA-1', null]]);
    expect(r.plan.migrationById(id)!.report!.unrelated ?? []).toEqual([]);
    // tick 2: step 2 retries the close and it lands; then step 3's adoption read is refused
    r.db.prepare("UPDATE linear_bindings SET state = 'bound' WHERE localKind = 'epic' AND id IN (" + epicBinding.map((b) => b.id).join(',') + ')').run();
    r.override.current = (ask) => (ask.op === 'issueOwned' && ask.input['id'] === U(102) ? fail('unreachable') : undefined);
    await r.tick();
    expect(r.issues.get(U(101))!.stateType).toBe('canceled');
    expect(r.plan.migrationById(id)!.report!.unrelated).toEqual(['AAA-1']);
    r.override.current = null;
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.plan.migrationById(id)!.report!.unrelated).toEqual(['AAA-1']);
  });

  it('A2: a no-relation close whose state write is refused is not listed as unrelated until the write lands', async () => {
    const r = await migRig();
    r.addIssue(1);
    let refused = 0;
    r.override.current = (ask) => (ask.op === 'issueUpdate' && refused++ === 0 ? fail('unreachable') : undefined);
    const id = await r.approved([entry(1, 'epic', { programme: SLUG, epic: 'e1' })]);
    await r.tick();
    expect(r.issues.get(U(101))!.stateType).not.toBe('canceled');
    expect(r.plan.migrationById(id)!.report!.unrelated ?? []).toEqual([]);
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.plan.migrationById(id)!.report!.unrelated).toEqual(['AAA-1']);
  });

  it('F2: an issue on the skipped list that the owner then takes leaves it for `taken`, is not mailed for, and nothing waits on it', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2')]);
    r.issues.get(U(101))!.title = 'Changed before the apply';
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual(['AAA-1']);
    hold(r, 1, 'taken');
    await r.tick();
    const rep = r.plan.migrationById(id)!.report!;
    expect(rep.taken).toEqual(['AAA-1']);
    expect(rep.skipped).toEqual([]);
    expect(rep.waiting).toEqual([]);
    expect(r.db.prepare("SELECT subject FROM mail WHERE toId = ? AND subject LIKE '%follow-up%'").all(OWNER)).toEqual([]);
    expect(r.mig.waitingWorkspaces('AAA')).toEqual([]);
  });

  it('A1: a stale closer and a replaced epic naming an issue a live binding holds get no comment, no relation and no close; both go to `taken`', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2); r.addIssue(3);
    const id = await r.approved([entry(1, 'stale'), entry(2, 'epic', { programme: SLUG, epic: 'e1' }), leaf(3, 'k3')]);
    hold(r, 1, 'held1'); hold(r, 2, 'held2');
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    for (const n of [1, 2]) {
      expect(comments(r, U(100 + n))).toEqual([]);
      expect(updates(r, U(100 + n)).filter((a) => a.lane === 'migration')).toEqual([]);   // the sync's own writes are another lane
      expect(r.issues.get(U(100 + n))!.stateType).not.toBe('canceled');
    }
    expect(r.opsOf('issueRelationCreate')).toEqual([]);
    const rep = r.plan.migrationById(id)!.report!;
    expect([...(rep.taken ?? [])].sort()).toEqual(['AAA-1', 'AAA-2']);
    expect(rep.skipped).toEqual([]);
    expect(rep.waiting).toEqual([]);
  });

  it('A1: a closer whose move row is unapplied, then held by a live binding, is not closed on the next tick; it goes to `taken`', async () => {
    const r = await migRig();
    r.addIssue(1);
    r.override.current = (ask) => (ask.op === 'issueUpdate' ? fail('unreachable') : undefined);
    const id = await r.approved([entry(1, 'stale')]);
    await r.tick();
    expect(r.plan.movesOf(id).map((x) => x.appliedAt)).toEqual([null]);
    r.override.current = null;
    const before = writesOf(r).length;
    hold(r, 1, 'held1');
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(writesOf(r).length).toBe(before);
    expect(r.plan.migrationById(id)!.report!.taken).toEqual(['AAA-1']);
  });

  it('F2: a replaced level whose only leaf is taken closes with no relation, and does not wait on it', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), entry(2, 'epic', { programme: SLUG, epic: 'e1' })]);
    hold(r, 1, 'held1');
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(r.opsOf('issueRelationCreate')).toEqual([]);
    expect(r.issues.get(U(102))!.stateType).toBe('canceled');
    const rep = r.plan.migrationById(id)!.report!;
    expect(rep.taken).toEqual(['AAA-1']);
    expect(rep.unrelated).toEqual(['AAA-2']);
  });
});

describe('review 2998 fix round 1 (D-8186, D-8796)', () => {
  const hold = (r: MigRig, n: number, key: string): void => {
    const t: NewTicket = { program: SLUG, epicKey: 'e1', checkpointKey: 'c1', key, kind: 'work', title: key, body: 'x', project: 'project-a', source: 'inbound' };
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [t], update: [], drop: [] } }), OWNER, r.t.now, null);
    const id = r.plan.planOf(SLUG).epics[0]!.tickets.find((x) => x.key === key)!.id;
    adoptIssueBindingInTx(r.db, id, WS.a.id, 'AAA', U(100 + n), `AAA-${n}`, r.t.now);
  };
  const whyOf = (r: MigRig, id: number): string => (r.db.prepare('SELECT why FROM operator_items WHERE id = ?').get(r.plan.migrationById(id)!.reportItemId!) as { why: string }).why;
  const migrationUpdates = (r: MigRig, id: string) => updates(r, id).filter((a) => a.lane === 'migration');

  it('F1: a live binding made while the close\'s comment is in flight stops the close: no state write, the issue is taken', async () => {
    const r = await migRig();
    r.addIssue(1);
    r.override.current = (ask) => { if (ask.op === 'issueComment' && ask.input['issueId'] === U(101)) hold(r, 1, 'held1'); return undefined; };
    const id = await r.approved([entry(1, 'stale')]);
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(migrationUpdates(r, U(101))).toEqual([]);
    expect(r.issues.get(U(101))!.stateType).not.toBe('canceled');
    expect(r.plan.migrationById(id)!.report!.taken).toEqual(['AAA-1']);
  });

  it('F1: a live binding made while a replaced level\'s relation is in flight stops the close before its state write', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), entry(2, 'epic', { programme: SLUG, epic: 'e1' })]);
    r.override.current = (ask) => { if (ask.op === 'issueRelationCreate' && ask.input['issueId'] === U(102)) hold(r, 2, 'held2'); return undefined; };
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(migrationUpdates(r, U(102))).toEqual([]);
    expect(r.issues.get(U(102))!.stateType).not.toBe('canceled');
    expect(r.plan.migrationById(id)!.report!.taken).toEqual(['AAA-2']);
  });

  it('F1: a live binding made while the closer\'s first read is in flight inserts no move row: the issue is taken', async () => {
    const r = await migRig();
    r.addIssue(1);
    r.override.current = (ask) => { if (ask.op === 'issueOwned' && ask.input['id'] === U(101)) hold(r, 1, 'held1'); return undefined; };
    const id = await r.approved([entry(1, 'stale')]);
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.plan.movesOf(id)).toEqual([]);
    expect(writesOf(r).filter((x) => x.lane === 'migration')).toEqual([]);
    expect(r.plan.migrationById(id)!.report!.taken).toEqual(['AAA-1']);
  });

  it('F1: a live binding made while step 2\'s reconcile read is in flight stops the retried close before its comment', async () => {
    const r = await migRig();
    r.addIssue(1);
    r.override.current = (ask) => (ask.op === 'issueUpdate' ? fail('unreachable') : undefined);
    const id = await r.approved([entry(1, 'stale')]);
    await r.tick();
    const comments = r.opsOf('issueComment').length;
    r.override.current = (ask) => { if (ask.op === 'issueOwned' && ask.input['id'] === U(101)) hold(r, 1, 'held1'); return undefined; };
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.opsOf('issueComment')).toHaveLength(comments);
    expect(r.plan.migrationById(id)!.report!.taken).toEqual(['AAA-1']);
  });

  it('F2: a skipped issue the owner takes while the row is still applying is counted taken, not skipped, in the report item', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2); r.addIssue(3);
    // AAA-1 is skipped in tick 1; the epic close waits on AAA-2's adoption, so the row stays applying
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2'), entry(3, 'epic', { programme: SLUG, epic: 'e1' })]);
    r.issues.get(U(101))!.title = 'Changed before the apply';
    await r.tick();
    expect(r.stateOf(id)).toBe('applying');
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual(['AAA-1']);
    hold(r, 1, 'held1');
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    const rep = r.plan.migrationById(id)!.report!;
    expect(rep.taken).toEqual(['AAA-1']);
    expect(rep.skipped).toEqual([]);
    expect(whyOf(r, id)).toContain('0 skipped as changed');
  });

  it('F2: a follow-up map stored while a held issue is still on the skipped list moves it to taken and refuses a map naming it', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2); r.addIssue(3);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2'), leaf(3, 'k3')]);
    r.issues.get(U(101))!.title = 'Changed before the apply';
    r.issues.get(U(103))!.title = 'Changed before the apply too';
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect([...r.plan.migrationById(id)!.report!.skipped].sort()).toEqual(['AAA-1', 'AAA-3']);
    hold(r, 1, 'held1');                                    // no tick has run: the applied row's report still lists it as skipped
    const open = await r.mig.readOpen('AAA', WS.a.id);
    if (!open.ok) throw new Error('read');
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1b'), leaf(3, 'k3b')] }, open)).toMatchObject({ ok: false });
    const stored = r.mig.storeProposal('AAA', OWNER, { entries: [leaf(3, 'k3b')] }, open);
    expect(stored).toMatchObject({ ok: true });
    const rep = r.plan.migrationById(id)!.report!;
    expect(rep.taken).toEqual(['AAA-1']);
    expect(rep.skipped).toEqual([]);
  });

  it('F3: a map-declared programme refused at the apply puts an issue a live binding holds in taken, never in skipped', async () => {
    const r = await migRig();
    r.addProgramme('prog-b', 'done');
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1', { programme: 'prog-b', epic: 'eb', checkpoint: 'cb' }), leaf(2, 'k2')], {
      epics: [{ programme: 'prog-b', epics: [{ key: 'eb', title: 'Epic B', summary: 'S', project: 'project-a', waves: [], checkpoints: [{ key: 'cb', title: 'CB', kind: 'acceptance' }] }] }],
    });
    applyPlanChanges(r.db, 'prog-b', changes({
      epics: { insert: [{ key: 'ez', project: 'project-a', waves: [1], ordinal: 0, title: 'Their own epic', summary: 'S' }], update: [], drop: [] },
    }), OWNER, T, null);
    hold(r, 1, 'held1');
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    const rep = r.plan.migrationById(id)!.report!;
    expect(rep.taken).toEqual(['AAA-1']);
    expect(rep.skipped).toEqual([]);
    expect(whyOf(r, id)).toContain('0 skipped as changed');
  });
});

describe('review 3004 fix round 2 (D-8186, D-8796)', () => {
  const hold = (r: MigRig, n: number, key: string): void => {
    const t: NewTicket = { program: SLUG, epicKey: 'e1', checkpointKey: 'c1', key, kind: 'work', title: key, body: 'x', project: 'project-a', source: 'inbound' };
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [t], update: [], drop: [] } }), OWNER, r.t.now, null);
    const id = r.plan.planOf(SLUG).epics[0]!.tickets.find((x) => x.key === key)!.id;
    adoptIssueBindingInTx(r.db, id, WS.a.id, 'AAA', U(100 + n), `AAA-${n}`, r.t.now);
  };
  const whyOf = (r: MigRig, id: number): string => (r.db.prepare('SELECT why FROM operator_items WHERE id = ?').get(r.plan.migrationById(id)!.reportItemId!) as { why: string }).why;

  it('F1: a live binding made while a replaced level\'s comment is in flight stops the close before its relation', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), entry(2, 'epic', { programme: SLUG, epic: 'e1' })]);
    r.override.current = (ask) => { if (ask.op === 'issueComment' && ask.input['issueId'] === U(102)) hold(r, 2, 'held2'); return undefined; };
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(r.opsOf('issueRelationCreate')).toEqual([]);
    expect(updates(r, U(102)).filter((a) => a.lane === 'migration')).toEqual([]);
    expect(r.issues.get(U(102))!.stateType).not.toBe('canceled');
    expect(r.plan.movesOf(id).find((x) => x.identifier === 'AAA-2')!.appliedAt).toBeNull();
    expect(r.plan.migrationById(id)!.report!.taken).toEqual(['AAA-2']);
  });

  it('F2: a take landing during the state write lists the issue as taken, and it is counted neither closed nor unrelated', async () => {
    const r = await migRig();
    r.addIssue(1);
    r.override.current = (ask) => { if (ask.op === 'issueUpdate' && ask.input['id'] === U(101) && ask.lane === 'migration') hold(r, 1, 'held1'); return undefined; };
    const id = await r.approved([entry(1, 'epic', { programme: SLUG, epic: 'e1' })]);
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(r.issues.get(U(101))!.stateType).toBe('canceled');   // the write went out
    const rep = r.plan.migrationById(id)!.report!;
    expect(rep.taken).toEqual(['AAA-1']);
    expect(rep.unrelated ?? []).toEqual([]);
    expect(whyOf(r, id)).toContain('0 closed');
    expect(r.mig.view(id)!.counts.closed).toBe(0);
  });

  it('F2 (review 3016): a take landing during the reconcile read of a closed-but-unacknowledged issue lists it taken, never applied, unrelated or counted closed', async () => {
    const r = await migRig();
    r.addIssue(1);
    const id = await r.approved([entry(1, 'epic', { programme: SLUG, epic: 'e1' })]);
    let refused = 0;
    r.override.current = (ask) => {
      // the state write reaches Linear, its answer does not
      if (ask.op === 'issueUpdate' && ask.input['id'] === U(101) && ask.lane === 'migration' && refused === 0) { refused += 1; r.issues.get(U(101))!.stateType = 'canceled'; return fail('unreachable'); }
      return undefined;
    };
    for (let i = 0; i < 6 && refused === 0; i += 1) await r.tick();
    expect(refused).toBe(1);
    expect(r.plan.movesOf(id).find((x) => x.identifier === 'AAA-1')!.appliedAt).toBeNull();
    let taken = false;
    r.override.current = (ask) => { if (ask.op === 'issueOwned' && ask.input['id'] === U(101) && !taken) { taken = true; hold(r, 1, 'held1'); } return undefined; };
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(taken).toBe(true);
    expect(r.stateOf(id)).toBe('applied');
    const rep = r.plan.migrationById(id)!.report!;
    expect(rep.taken).toEqual(['AAA-1']);
    expect(rep.unrelated ?? []).toEqual([]);
    expect(r.plan.movesOf(id).find((x) => x.identifier === 'AAA-1')!.appliedAt).toBeNull();
    expect(r.mig.view(id)!.counts.closed).toBe(0);
    expect(whyOf(r, id)).toContain('0 closed');
  });

  it('A2 (review 3016): a take found after the state write is listed in the stored report when the row is stamped, so a crash in the same tick loses nothing', async () => {
    const r = await migRig();
    r.addIssue(1);
    r.override.current = (ask) => { if (ask.op === 'issueUpdate' && ask.input['id'] === U(101) && ask.lane === 'migration') hold(r, 1, 'held1'); return undefined; };
    const id = await r.approved([entry(1, 'epic', { programme: SLUG, epic: 'e1' })]);
    // the tick's own report save fails, as a restart before it would
    const crash = vi.spyOn(r.mig as unknown as { saveReport: () => never }, 'saveReport').mockImplementation(() => { throw new Error('crash'); });
    for (let i = 0; i < 6 && r.issues.get(U(101))!.stateType !== 'canceled'; i += 1) { try { await r.tick(); } catch { /* the crash */ } }
    expect(r.issues.get(U(101))!.stateType).toBe('canceled');   // the write went out
    // The stamp and the listing stand together or not at all: the failed save took the stamp with it, so the row is not left
    // applied with the take forgotten (an applied row is never read again).
    expect(r.plan.movesOf(id).find((x) => x.identifier === 'AAA-1')!.appliedAt).toBeNull();
    crash.mockRestore();
    r.override.current = null;
    await r.until(() => r.stateOf(id) === 'applied', 20);
    expect(r.stateOf(id)).toBe('applied');
    expect(r.plan.migrationById(id)!.report!.taken).toEqual(['AAA-1']);
    expect(r.mig.view(id)!.counts.closed).toBe(0);
  });
});
