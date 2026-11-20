// D-8186 (Linear hierarchy plan, Task 7.2): the migration's start, the owner's proposal and the operator's Approve and Return.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanMigRigs, entry, leaf, migRig, OWNER, U } from './migrationRig.js';
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
    // It joins the stored map (the same migration, the same Put back) and leaves the skipped list, so the apply writes it.
    expect(r.plan.migrationById(id)!.map!.entries.map((e) => e.identifier)).toEqual(['AAA-1', 'AAA-2']);
    expect(r.plan.migrationById(id)!.report!.skipped).toEqual([]);
    const m = r.plan.migrationById(id)!;
    expect(r.mig.act(m.itemId!, id, 'approve', null)).toEqual({ ok: true });
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
});
