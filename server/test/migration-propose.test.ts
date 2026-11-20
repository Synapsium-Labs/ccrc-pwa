// D-8186 (Linear hierarchy plan, Task 7.2): the migration's start, the owner's proposal and the operator's Approve and Return.
import { afterEach, describe, expect, it } from 'vitest';
import { applyPlanChanges, NO_PLAN_CHANGES, type NewTicket } from '../src/coord/planStore.js';
import { cleanMigRigs, entry, fail, leaf, migRig, OWNER, SLUG, U } from './migrationRig.js';
import { WS } from './linearProxyRig.js';

afterEach(cleanMigRigs);

const itemsOf = (r: Awaited<ReturnType<typeof migRig>>): { id: number; state: string; action: string | null }[] =>
  r.db.prepare("SELECT id, state, action FROM operator_items WHERE action LIKE '%linear-map%'").all() as { id: number; state: string; action: string | null }[];
const mailsTo = (r: Awaited<ReturnType<typeof migRig>>, to: string): { subject: string; body: string }[] =>
  r.db.prepare('SELECT subject, body FROM mail WHERE toId = ? ORDER BY id').all(to) as { subject: string; body: string }[];

describe('the migration proposal (D-8186)', () => {
  it('a second team while the first is applying is migration-in-flight', async () => {
    const r = await migRig();
    r.addIssue(1);
    const id = await r.approved([leaf(1, 'k1')]);
    expect(r.stateOf(id)).toBe('approved');
    r.db.prepare('INSERT INTO project_linking (project, teamKey, override) VALUES (?, ?, ?)').run('project-b', 'BBB', 'private');
    expect(r.mig.start('project-b', WS.a.id)).toMatchObject({ ok: false, word: 'migration-in-flight' });
    await r.tick();                                          // applying
    expect(r.stateOf(id)).toBe('applying');
    expect(r.mig.start('project-b', WS.a.id)).toMatchObject({ ok: false, word: 'migration-in-flight' });
    expect(r.plan.migrationsOf()).toHaveLength(1);
  });

  it('a project with no team key cannot start', async () => {
    const r = await migRig();
    expect(r.mig.start('project-nokey', WS.a.id)).toMatchObject({ ok: false, word: 'no-team-key' });
  });

  it('propose by a non-owner is not-linear-owner', async () => {
    const r = await migRig();
    r.addIssue(1);
    expect(r.mig.start('project-a', WS.a.id).ok).toBe(true);
    const open = await r.mig.readOpen('AAA');
    if (!open.ok) throw new Error('read');
    const res = r.mig.storeProposal('AAA', 'coord-x', { entries: [leaf(1, 'k1')] }, open);
    expect(res).toMatchObject({ ok: false, word: 'not-linear-owner' });
    expect(itemsOf(r)).toHaveLength(0);
    expect(r.plan.migrationsOf()[0]).toMatchObject({ state: 'proposing', map: null });
    // the owner's own proposal goes through
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1')] }, open)).toMatchObject({ ok: true });
  });

  it('a map missing an open issue is map-incomplete and raises nothing', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    expect(r.mig.start('project-a', WS.a.id).ok).toBe(true);
    const open = await r.mig.readOpen('AAA');
    if (!open.ok) throw new Error('read');
    const res = r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1')] }, open);
    expect(res).toMatchObject({ ok: false, word: 'map-incomplete', detail: 'missing:AAA-2' });
    expect(itemsOf(r)).toHaveLength(0);
    expect(r.plan.migrationsOf()[0]).toMatchObject({ state: 'proposing', map: null, itemId: null });
    // an entry for an issue that is not open is refused too
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1'), leaf(2, 'k2'), entry(3, 'stale')] }, open))
      .toMatchObject({ ok: false, word: 'map-incomplete', detail: 'not-open:AAA-3' });
  });

  it('a stored map raises its decide item and the snapshot of every listed issue', async () => {
    const r = await migRig();
    r.addIssue(1);
    const { migrationId, itemId } = await r.propose([leaf(1, 'k1')]);
    const m = r.plan.migrationById(migrationId)!;
    expect(m.state).toBe('proposed');
    expect(m.map!.snapshot[U(101)]).toMatchObject({ state: 'unstarted', team: 'AAA', title: 'Issue 1', description: 'Body 1' });
    expect(itemsOf(r)).toEqual([expect.objectContaining({ id: itemId, state: 'open' })]);
  });

  it('approve moves to approved', async () => {
    const r = await migRig();
    r.addIssue(1);
    const { migrationId, itemId } = await r.propose([leaf(1, 'k1')]);
    expect(r.mig.act(itemId, migrationId, 'approve', null)).toEqual({ ok: true });
    expect(r.stateOf(migrationId)).toBe('approved');
    expect(itemsOf(r)[0]!.state).toBe('done');
    // a second approve of the same item is refused, not applied twice
    expect(r.mig.act(itemId, migrationId, 'approve', null)).toMatchObject({ ok: false, word: 'not-open' });
  });

  it('return mails the owner the note', async () => {
    const r = await migRig();
    r.addIssue(1);
    const { migrationId, itemId } = await r.propose([leaf(1, 'k1')]);
    expect(r.mig.act(itemId, migrationId, 'return', 'Place AAA-1 under the other epic')).toEqual({ ok: true });
    expect(r.plan.migrationById(migrationId)).toMatchObject({ state: 'proposing', map: null });
    const mail = mailsTo(r, OWNER).find((x) => x.subject.includes('came back'));
    expect(mail).toBeDefined();
    expect(mail!.body).toContain('Place AAA-1 under the other epic');
    // the owner proposes again
    const open = await r.mig.readOpen('AAA');
    if (!open.ok) throw new Error('read');
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1')] }, open)).toMatchObject({ ok: true });
  });

  it('a proposing row mails the owner once for its map', async () => {
    const r = await migRig();
    r.addIssue(1);
    expect(r.mig.start('project-a', WS.a.id).ok).toBe(true);
    await r.tick(); await r.tick();
    expect(mailsTo(r, OWNER).filter((x) => x.subject.includes('propose the map'))).toHaveLength(1);
  });

  it('a follow-up map covers only the issues the apply skipped', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2')]);
    r.issues.get(U(102))!.title = 'Edited by a person after the map';
    await r.until(() => r.stateOf(id) === 'applied');
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual(['AAA-2']);

    const open = await r.mig.readOpen('AAA');
    if (!open.ok) throw new Error('read');
    // AAA-1 was moved already: a follow-up that lists it again is not a map of the skipped issues
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1b'), leaf(2, 'k2')] }, open)).toMatchObject({ ok: false, word: 'map-incomplete', detail: 'not-open:AAA-1' });
    const ok = r.mig.storeProposal('AAA', OWNER, { entries: [leaf(2, 'k2')] }, open);
    expect(ok).toMatchObject({ ok: true, migrationId: id });
    expect(r.plan.migrationById(id)!.state).toBe('proposed');
    // It leaves the skipped list, and joins the stored map on Approve (the same migration, the same Put back), so the apply
    // writes it; until then the item shows the follow-up's own entries (review 2892 A2).
    expect(r.plan.migrationById(id)!.map!.entries.map((e) => e.identifier)).toEqual(['AAA-2']);
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual([]);
    const m = r.plan.migrationById(id)!;
    expect(r.mig.act(m.itemId!, id, 'approve', null)).toEqual({ ok: true });
    expect(r.plan.migrationById(id)!.map!.entries.map((e) => e.identifier)).toEqual(['AAA-1', 'AAA-2']);
    await r.until(() => r.stateOf(id) === 'applied' && r.plan.movesOf(id).some((x) => x.identifier === 'AAA-2' && x.appliedAt !== null));
    expect(r.plan.movesOf(id).filter((x) => x.kind === 'issue').map((x) => [x.identifier, x.appliedAt !== null])).toEqual([['AAA-1', true], ['AAA-2', true]]);
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual([]);
  });

  it('a returned follow-up puts its issues back on the skipped list', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2')]);
    r.issues.get(U(102))!.title = 'Edited by a person after the map';
    await r.until(() => r.stateOf(id) === 'applied');
    const open = await r.mig.readOpen('AAA');
    if (!open.ok) throw new Error('read');
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(2, 'k2')] }, open)).toMatchObject({ ok: true });
    const m = r.plan.migrationById(id)!;
    expect(r.mig.act(m.itemId!, id, 'return', 'not yet')).toEqual({ ok: true });
    expect(r.plan.migrationById(id)!.state).toBe('applied');
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual(['AAA-2']);
  });

  it('an issue the sync already binds is no part of a map', async () => {
    const r = await migRig();
    r.addIssue(1);
    // a ticket ccrc's own sync created: its issue is open in the team and bound
    const t: NewTicket = { program: SLUG, epicKey: 'e1', checkpointKey: 'c1', key: 'own', kind: 'work', title: 'Our own ticket', body: 'Do it', project: 'project-a', source: 'plan' };
    applyPlanChanges(r.db, SLUG, { ...NO_PLAN_CHANGES(), tickets: { insert: [t], update: [], drop: [] } }, OWNER, r.t.now, null);
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    const tid = r.plan.planOf(SLUG).epics[0]!.tickets[0]!.id;
    const bound = r.plan.bindingOf('ticket', tid, WS.a.id)!;
    r.issues.set(bound.linearId!, { id: bound.linearId!, identifier: 'AAA-50', title: 'Our own ticket', description: 'x', teamKey: 'AAA', stateType: 'unstarted', projectId: null, milestoneId: null, parentId: null });
    expect(r.mig.start('project-a', WS.a.id).ok).toBe(true);
    const open = await r.mig.readOpen('AAA');
    if (!open.ok) throw new Error('read');
    expect(open.rows.map((x) => x.identifier).sort()).toEqual(['AAA-1', 'AAA-50']);
    // the map covers AAA-1 alone: the bound issue is not "missing"
    const named = r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1'), { issue: bound.linearId!, identifier: 'AAA-50', class: 'stale' }] }, open);
    expect(named).toMatchObject({ ok: false, word: 'map-incomplete', detail: 'not-open:AAA-50' });
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1')] }, open)).toMatchObject({ ok: true });
  });

  it('a follow-up map still leaves out a bound issue this migration never set aside (security review)', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2')]);
    r.issues.get(U(102))!.title = 'Edited by a person after the map';
    await r.until(() => r.stateOf(id) === 'applied');
    // AAA-1 was adopted and applied: listing it among the skipped does not open it to a follow-up map
    const m = r.plan.migrationById(id)!;
    r.plan.setMigration(id, ['applied'], { report: { ...m.report!, skipped: ['AAA-1', 'AAA-2'] } }, r.t.now);
    const open = await r.mig.readOpen('AAA');
    if (!open.ok) throw new Error('read');
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1b'), leaf(2, 'k2')] }, open)).toMatchObject({ ok: false, word: 'map-incomplete', detail: 'not-open:AAA-1' });
  });

  it('awaitsMap answers only while a migration waits', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    expect(r.mig.awaitsMap('AAA')).toBe(false);              // none
    const { migrationId, itemId } = await (async () => {
      expect(r.mig.start('project-a', WS.a.id).ok).toBe(true);
      expect(r.mig.awaitsMap('AAA')).toBe(true);             // proposing
      const open = await r.mig.readOpen('AAA');
      if (!open.ok) throw new Error('read');
      expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1'), leaf(2, 'k2')] }, open)).toMatchObject({ ok: true });
      const m = r.plan.migrationsOf()[0]!;
      return { migrationId: m.id, itemId: m.itemId! };
    })();
    expect(r.mig.awaitsMap('AAA')).toBe(false);              // proposed
    expect(r.mig.act(itemId, migrationId, 'approve', null)).toEqual({ ok: true });
    expect(r.mig.awaitsMap('AAA')).toBe(false);              // approved
    r.issues.get(U(102))!.title = 'Edited by a person after the map';
    await r.until(() => r.stateOf(migrationId) === 'applied');
    expect(r.mig.awaitsMap('AAA')).toBe(true);               // applied with one skipped: a follow-up
    expect(r.mig.awaitsMap('ZZZ')).toBe(false);
  });

  it('a follow-up map is refused while put back is asked', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2')]);
    r.issues.get(U(102))!.title = 'Edited by a person after the map';
    await r.until(() => r.stateOf(id) === 'applied');
    const m = r.plan.migrationById(id)!;
    expect(r.mig.awaitsMap('AAA')).toBe(true);
    expect(r.mig.act(m.reportItemId!, id, 'put-back', null)).toEqual({ ok: true });
    expect(r.mig.awaitsMap('AAA')).toBe(false);
    const open = await r.mig.readOpen('AAA');
    if (!open.ok) throw new Error('read');
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(2, 'k2')] }, open)).toMatchObject({ ok: false, word: 'plan-bad-body' });
    expect(r.plan.migrationById(id)!.state).toBe('applied');
  });

  it('a follow-up propose mail has its own subject and names the skipped count', async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2')]);
    r.issues.get(U(102))!.title = 'Edited by a person after the map';
    await r.until(() => r.stateOf(id) === 'applied');
    await r.tick(); await r.tick();
    const subjects = mailsTo(r, OWNER).map((x) => x.subject);
    expect(subjects.filter((s) => s.includes('propose a follow-up map for team AAA (1 skipped)'))).toHaveLength(1);
  });
});

describe('review 2892 fix round 1: the follow-up map and the row state (D-8186)', () => {
  it('F4: a returned follow-up keeps an issue adopted then set aside on the skipped list (a retired move row is not a move)', async () => {
    const r = await migRig();
    r.addIssue(1);
    r.override.current = (ask) => (ask.op === 'issueUpdate' ? fail('unreachable') : undefined);
    const id = await r.approved([leaf(1, 'k1')]);
    await r.tick();
    r.override.current = null;
    r.issues.get(U(101))!.title = 'A person renamed it between the adoption and the write';
    await r.until(() => r.stateOf(id) === 'applied', 10);
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual(['AAA-1']);
    expect(r.plan.movesOf(id).map((x) => x.subject)).toEqual([expect.stringMatching(/:skipped:/u)]);
    const open = await r.mig.readOpen('AAA');
    if (!open.ok) throw new Error('read');
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [leaf(1, 'k1b')] }, open)).toMatchObject({ ok: true });
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual([]);
    const m = r.plan.migrationById(id)!;
    expect(r.mig.act(m.itemId!, id, 'return', 'not yet')).toEqual({ ok: true });
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual(['AAA-1']);
  });

  it("A2: a follow-up's map item counts and lists its own map only", async () => {
    const r = await migRig();
    r.addIssue(1); r.addIssue(2); r.addIssue(3);
    const id = await r.approved([leaf(1, 'k1'), leaf(2, 'k2'), entry(3, 'stale')]);
    r.issues.get(U(102))!.title = 'Edited by a person after the map';
    await r.until(() => r.stateOf(id) === 'applied');
    const open = await r.mig.readOpen('AAA');
    if (!open.ok) throw new Error('read');
    const stored = r.mig.storeProposal('AAA', OWNER, { entries: [leaf(2, 'k2')] }, open);
    expect(stored).toMatchObject({ ok: true, counts: { moved: 1, closed: 0 } });
    const v = r.mig.view(id);
    expect(v).toMatchObject({ state: 'proposed', counts: { moved: 1, closed: 0, created: 0, left: 0 } });
    expect(v!.entries.map((e) => e.identifier)).toEqual(['AAA-2']);
  });

  it("A4: a project row's state is its team's newest migration in the workspace its key routes to", async () => {
    const r = await migRig();
    r.plan.insertMigration({ workspaceId: 'ws-elsewhere', teamKey: 'AAA', project: 'project-x', now: r.t.now });
    expect(await r.mig.stateOfTeam('AAA')).toMatchObject({ state: 'not-migrated' });
    r.addIssue(1);
    expect(r.mig.start('project-a', WS.a.id)).toMatchObject({ ok: false, word: 'migration-in-flight' });   // one at a time, every workspace
    r.db.prepare("UPDATE linear_migrations SET state = 'failed' WHERE workspaceId = 'ws-elsewhere'").run();
    const { migrationId } = await r.propose([leaf(1, 'k1')]);
    r.plan.insertMigration({ workspaceId: 'ws-elsewhere', teamKey: 'AAA', project: 'project-x', now: r.t.now + 1 });
    expect(await r.mig.stateOfTeam('AAA')).toMatchObject({ state: 'map-waiting', itemId: r.plan.migrationById(migrationId)!.itemId });
  });
});

describe('review 2918 fix round 2: wiring the panel mutated green (D-8186)', () => {
  it("A4: of two rows of the team in one workspace, the project row's state is the newer one's", async () => {
    const r = await migRig();
    const older = r.plan.insertMigration({ workspaceId: WS.a.id, teamKey: 'AAA', project: 'project-a', now: r.t.now });
    r.db.prepare("UPDATE linear_migrations SET state = 'put-back', putBackAt = ? WHERE id = ?").run(r.t.now, older);
    r.plan.insertMigration({ workspaceId: WS.a.id, teamKey: 'AAA', project: 'project-a', now: r.t.now + 1 });
    expect(await r.mig.stateOfTeam('AAA')).toMatchObject({ state: 'migrating' });
  });

  it('F6: a superseded entry may name a successor ccrc already holds (a bound issue outside the map)', async () => {
    const r = await migRig();
    r.addIssue(1);
    const t: NewTicket = { program: SLUG, epicKey: 'e1', checkpointKey: 'c1', key: 'own', kind: 'work', title: 'Our own ticket', body: 'Do it', project: 'project-a', source: 'plan' };
    applyPlanChanges(r.db, SLUG, { ...NO_PLAN_CHANGES(), tickets: { insert: [t], update: [], drop: [] } }, OWNER, r.t.now, null);
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    const bound = r.plan.bindingOf('ticket', r.plan.planOf(SLUG).epics[0]!.tickets[0]!.id, WS.a.id)!;
    r.issues.set(bound.linearId!, { id: bound.linearId!, identifier: 'AAA-50', title: 'Our own ticket', description: 'x', teamKey: 'AAA', stateType: 'unstarted', projectId: null, milestoneId: null, parentId: null });
    expect(r.mig.start('project-a', WS.a.id).ok).toBe(true);
    const open = await r.mig.readOpen('AAA');
    if (!open.ok) throw new Error('read');
    expect(r.mig.storeProposal('AAA', OWNER, { entries: [entry(1, 'superseded', { successor: bound.linearId! })] }, open)).toMatchObject({ ok: true });
  });
});
