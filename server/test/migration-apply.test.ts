// D-8186 and D-8796 (Linear hierarchy plan, Task 7.3): the apply. The migration writes each move row before its write, adopts a
// leaf or upkeep issue only with that row in one transaction, and lets the plan sync send the update on lane `migration`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIGRATION_WRITES_PER_TICK } from '../src/linear/migration.js';
import { applyPlanChanges, NO_PLAN_CHANGES, type NewTicket, type PlanChanges } from '../src/coord/planStore.js';
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
      entry(3, 'programme', { programme: 'prog-b' }), entry(4, 'finished'), entry(5, 'superseded', { successor: U(102) }), entry(6, 'stale'),
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
    const open = await r.mig.readOpen('AAA');
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
