// D-8186, D-8808 (review 2997 F1, F2): the migration resolves a project's team by the project row's workspace, never by "the first
// workspace holding the key". Two workspaces (ws-a, ws-b) both hold team AAA; project-a is pinned to ws-a, project-b to ws-b.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanMigRigs, entry, leaf, migRig, SLUG } from './migrationRig.js';
import { seedSlot, WS } from './linearProxyRig.js';
import type { LinearStoreRead } from '../src/linear/store.js';

afterEach(cleanMigRigs);

async function twoWorkspaces(): Promise<Awaited<ReturnType<typeof migRig>>> {
  const r = await migRig();
  await seedSlot(r.ccrcDir, 'b', { teams: [{ id: WS.b.teams[0].id, key: 'AAA', name: 'Team A in B' }] });
  r.db.prepare('INSERT INTO project_linking (project, teamKey, override, teamWorkspace) VALUES (?, ?, ?, ?)').run('project-b', 'AAA', 'private', WS.b.id);
  r.db.prepare('UPDATE project_linking SET teamWorkspace = ? WHERE project = ?').run(WS.a.id, 'project-a');
  return r;
}
const pin = (r: Awaited<ReturnType<typeof migRig>>, project: string, ws: string | null): void => {
  r.db.prepare('UPDATE project_linking SET teamWorkspace = ? WHERE project = ?').run(ws, project);
};

describe('start resolves the project by its workspace', () => {
  it('Reshape on project-b starts the ws-b migration, on project-a the ws-a one', async () => {
    const r = await twoWorkspaces();
    const b = await r.mig.workspaceOfProject('project-b');
    expect(b).toMatchObject({ ok: true, workspaceId: WS.b.id });
    const out = r.mig.start('project-b', b);
    expect(out.ok).toBe(true);
    expect(r.plan.migrationsOf().map((m) => ({ w: m.workspaceId, p: m.project }))).toEqual([{ w: WS.b.id, p: 'project-b' }]);
    r.db.prepare("UPDATE linear_migrations SET state = 'failed'").run();
    const a = await r.mig.workspaceOfProject('project-a');
    expect(a).toMatchObject({ ok: true, workspaceId: WS.a.id });
    expect(r.mig.start('project-a', a).ok).toBe(true);
    expect(r.plan.migrationsOf().filter((m) => m.state === 'proposing').map((m) => ({ w: m.workspaceId, p: m.project }))).toEqual([{ w: WS.a.id, p: 'project-a' }]);
  });

  it('a project naming no workspace, its key held by both, is team-ambiguous and inserts nothing', async () => {
    const r = await twoWorkspaces();
    pin(r, 'project-a', null);
    const where = await r.mig.workspaceOfProject('project-a');
    expect(where).toMatchObject({ ok: false, word: 'team-ambiguous' });
    expect(r.mig.start('project-a', where)).toMatchObject({ ok: false, word: 'team-ambiguous' });
    expect(r.plan.migrationsOf()).toEqual([]);
  });

  it.each(['proposing', 'applied'])('an ambiguous project is refused before another workspace’s %s migration', async (state) => {
    const r = await twoWorkspaces();
    pin(r, 'project-a', null);
    r.plan.insertMigration({ workspaceId: WS.b.id, teamKey: 'AAA', project: 'project-b', now: r.t.now });
    r.db.prepare('UPDATE linear_migrations SET state = ?, reportDoneAt = ?').run(state, state === 'applied' ? r.t.now : null);
    const where = await r.mig.workspaceOfProject('project-a');
    expect(r.mig.start('project-a', where)).toMatchObject({ ok: false, word: 'team-ambiguous' });
    expect(r.plan.migrationsOf()).toHaveLength(1);
  });

  it('a project without a team key keeps the no-team-key refusal', async () => {
    const r = await twoWorkspaces();
    r.db.prepare("UPDATE project_linking SET teamKey = NULL WHERE project = 'project-a'").run();
    const where = await r.mig.workspaceOfProject('project-a');
    expect(where).toMatchObject({ ok: false, word: 'no-team-key' });
    expect(r.mig.start('project-a', where)).toMatchObject({ ok: false, word: 'no-team-key' });
  });

  it('a key no slot holds stays unreachable', async () => {
    const r = await twoWorkspaces();
    r.db.prepare("UPDATE project_linking SET teamKey = 'QQQ', teamWorkspace = NULL WHERE project = 'project-a'").run();
    expect(await r.mig.workspaceOfProject('project-a')).toMatchObject({ ok: false, word: 'unreachable' });
  });
});

describe('the open read is in the migration\'s workspace', () => {
  it('readOpen asks teamOpenIssues of ws-b for a ws-b migration', async () => {
    const r = await twoWorkspaces();
    const open = await r.mig.readOpen('AAA', WS.b.id);
    expect(open).toMatchObject({ ok: true, workspaceId: WS.b.id });
    expect(r.asks.filter((a) => a.op === 'teamOpenIssues').map((a) => ({ workspaceId: a.workspaceId, slot: a.slot })))
      .toEqual([{ workspaceId: WS.b.id, slot: { source: 'file', id: WS.b.id } }]);
  });
  it('a workspace that does not hold the team is unreachable', async () => {
    const r = await twoWorkspaces();
    expect(await r.mig.readOpen('ZZZ', WS.b.id)).toMatchObject({ ok: false, word: 'unreachable' });
  });
});

describe('the Linear owner is the migration workspace\'s', () => {
  const owners = (r: Awaited<ReturnType<typeof migRig>>): void => {
    r.db.prepare("UPDATE project_linking SET linearOwner = 'coord-a' WHERE project = 'project-a'").run();
    r.db.prepare("UPDATE project_linking SET linearOwner = 'coord-b' WHERE project = 'project-b'").run();
  };
  const mails = (r: Awaited<ReturnType<typeof migRig>>, to: string): number =>
    (r.db.prepare('SELECT COUNT(*) AS n FROM mail WHERE toId = ?').get(to) as { n: number }).n;

  it('an ambiguous unpinned holder does not own a ws-b migration or its map', async () => {
    const r = await twoWorkspaces();
    pin(r, 'project-a', null);
    owners(r);
    expect(r.mig.start('project-b', await r.mig.workspaceOfProject('project-b')).ok).toBe(true);
    expect(r.plan.migrationsOf().map((m) => ({ w: m.workspaceId, p: m.project }))).toEqual([{ w: WS.b.id, p: 'project-b' }]);
    await r.tick();
    expect(mails(r, 'coord-b')).toBe(1);
    expect(mails(r, 'coord-a')).toBe(0);
    const open = await r.mig.readOpen('AAA', WS.b.id);
    if (!open.ok) throw new Error('read');
    const backlog = [{ slug: 'prog-new', title: 'New', epics: [
      { key: 'e2', title: 'Default home', summary: 'Summary', checkpoints: [] },
      { key: 'e3', title: 'Explicit home', summary: 'Summary', project: 'project-b', checkpoints: [] },
    ] }];
    expect(r.mig.storeProposal('AAA', 'coord-b', { entries: [], backlog }, open)).toMatchObject({ ok: true });
  });

  it('the map mail of a ws-b migration goes to project-b\'s owner', async () => {
    const r = await twoWorkspaces();
    owners(r);
    r.plan.insertMigration({ workspaceId: WS.b.id, teamKey: 'AAA', project: 'project-b', now: r.t.now });
    await r.tick();
    expect(mails(r, 'coord-b')).toBe(1);
    expect(mails(r, 'coord-a')).toBe(0);
  });

  it('project-a\'s owner may not propose the map of a ws-b migration', async () => {
    const r = await twoWorkspaces();
    owners(r);
    r.plan.insertMigration({ workspaceId: WS.b.id, teamKey: 'AAA', project: 'project-b', now: r.t.now });
    const open = await r.mig.readOpen('AAA', WS.b.id);
    if (!open.ok) throw new Error('read');
    expect(r.mig.storeProposal('AAA', 'coord-a', { entries: [] }, open)).toMatchObject({ ok: false, word: 'not-linear-owner' });
  });
});

describe('waitingWorkspaces', () => {
  it('names every workspace with a migration waiting for a map', async () => {
    const r = await twoWorkspaces();
    expect(r.mig.waitingWorkspaces('AAA')).toEqual([]);
    r.plan.insertMigration({ workspaceId: WS.b.id, teamKey: 'AAA', project: 'project-b', now: r.t.now });
    expect(r.mig.waitingWorkspaces('AAA')).toEqual([WS.b.id]);
    expect(r.mig.waitingWorkspaces('AAA')).not.toEqual([]);
    expect(r.mig.waitingWorkspaces('BBB')).toEqual([]);
  });
});

describe('the console view is the project row\'s own', () => {
  it('project-b shows its ws-b migration, project-a (only ws-b has one) is not migrated', async () => {
    const r = await twoWorkspaces();
    r.plan.insertMigration({ workspaceId: WS.b.id, teamKey: 'AAA', project: 'project-b', now: r.t.now });
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: WS.b.id })).toMatchObject({ state: 'migrating' });
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: WS.a.id })).toMatchObject({ state: 'not-migrated' });
  });
  it('an unpinned row whose key two workspaces hold is not migrated', async () => {
    const r = await twoWorkspaces();
    r.plan.insertMigration({ workspaceId: WS.b.id, teamKey: 'AAA', project: 'project-b', now: r.t.now });
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: null })).toMatchObject({ state: 'not-migrated' });
  });
  it('an unpinned row routed to one slot shows that workspace\'s migration', async () => {
    const r = await migRig();
    r.plan.insertMigration({ workspaceId: WS.a.id, teamKey: 'AAA', project: 'project-a', now: r.t.now });
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: null })).toMatchObject({ state: 'migrating' });
  });
  it('an unroutable key falls back to its migrations by key only while they sit in one workspace', async () => {
    const r = await migRig();
    r.plan.insertMigration({ workspaceId: 'ws-gone', teamKey: 'QQQ', project: 'project-x', now: r.t.now });
    expect(await r.mig.stateOfProject({ teamKey: 'QQQ', workspaceId: null })).toMatchObject({ state: 'migrating' });
    r.db.prepare("UPDATE linear_migrations SET state = 'failed'").run();
    r.plan.insertMigration({ workspaceId: 'ws-gone-2', teamKey: 'QQQ', project: 'project-x', now: r.t.now });
    expect(await r.mig.stateOfProject({ teamKey: 'QQQ', workspaceId: null })).toMatchObject({ state: 'not-migrated' });
  });
});

// F1 (D-8186, D-8808): a row whose owner or own workspace cannot be measured says so, never "Not migrated" (review 3087 F1, F4).
describe('the console view when the routing is not measured', () => {
  /** `record-unreadable` makes ONE workspace's team record unreadable (the other slots stay readable); `no-listing` fails the whole read. */
  type Mode = { kind: 'ok' } | { kind: 'record-unreadable'; workspaceId: string } | { kind: 'no-listing' };
  const OK: Mode = { kind: 'ok' };
  const rigWith = async (mode: () => Mode): ReturnType<typeof migRig> => migRig({ routing: (store: LinearStoreRead): LinearStoreRead => {
    const m = mode();
    if (m.kind === 'no-listing') return { kind: 'unreadable', code: 'EIO' };
    if (m.kind === 'record-unreadable' && store.kind === 'listed') {
      return { ...store, slots: store.slots.map((s) => (s.id === m.workspaceId ? { ...s, record: { kind: 'unreadable', code: 'EIO' } } : s)) };
    }
    return store;
  } });
  /** project-b pinned to ws-b with team AAA, which ws-b holds; project-a keeps its row in ws-a. */
  const withPinnedB = async (r: Awaited<ReturnType<typeof migRig>>): Promise<void> => {
    await seedSlot(r.ccrcDir, 'b', { teams: [{ id: WS.b.teams[0].id, key: 'AAA', name: 'Team A in B' }] });
    r.db.prepare('INSERT INTO project_linking (project, teamKey, override, teamWorkspace) VALUES (?, ?, ?, ?)').run('project-b', 'AAA', 'private', WS.b.id);
  };
  it('an unpinned row with one slot record unreadable is unmeasured even when a migration exists for its key', async () => {
    let mode: Mode = OK;
    const r = await rigWith(() => mode);
    r.plan.insertMigration({ workspaceId: WS.a.id, teamKey: 'AAA', project: 'project-a', now: r.t.now });
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: null })).toMatchObject({ state: 'migrating' });
    mode = { kind: 'record-unreadable', workspaceId: WS.a.id };
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: null })).toEqual({ state: 'unmeasured', at: null, itemId: null });
  });
  it('an unpinned row with no listing at all is unmeasured too', async () => {
    const r = await rigWith(() => ({ kind: 'no-listing' }));
    r.plan.insertMigration({ workspaceId: WS.a.id, teamKey: 'AAA', project: 'project-a', now: r.t.now });
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: null })).toEqual({ state: 'unmeasured', at: null, itemId: null });
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: null }, null)).toEqual({ state: 'unmeasured', at: null, itemId: null });
  });
  it('a pinned row outranked by an unpinned holder whose routing cannot be read is unmeasured, its own slot readable, even with a migration in its workspace', async () => {
    let mode: Mode = OK;
    const r = await rigWith(() => mode);
    await withPinnedB(r);
    r.db.prepare('UPDATE project_linking SET teamWorkspace = NULL WHERE project = ?').run('project-a');
    r.plan.insertMigration({ workspaceId: WS.b.id, teamKey: 'AAA', project: 'project-b', now: r.t.now });
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: WS.b.id })).toMatchObject({ state: 'migrating' });
    mode = { kind: 'record-unreadable', workspaceId: WS.a.id };            // only the OTHER workspace: the outranking row's routing is the cause
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: WS.b.id })).toEqual({ state: 'unmeasured', at: null, itemId: null });
  });
  it('a pinned top row whose own slot cannot be read, with no migration stored, is unmeasured, never "Not migrated" (Reshape would refuse it)', async () => {
    let mode: Mode = OK;
    const r = await rigWith(() => mode);
    await withPinnedB(r);
    pin(r, 'project-a', WS.a.id);                                          // project-b tops its key in ws-b: the owner is measured there
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: WS.b.id })).toMatchObject({ state: 'not-migrated' });
    mode = { kind: 'record-unreadable', workspaceId: WS.b.id };
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: WS.b.id })).toEqual({ state: 'unmeasured', at: null, itemId: null });
    expect(await r.mig.workspaceOfProject('project-b')).toMatchObject({ ok: false, word: 'unreachable' });
  });
  it('a pinned top row with no listing at all is unmeasured, even with a migration stored', async () => {
    const r = await rigWith(() => ({ kind: 'no-listing' }));
    pin(r, 'project-a', WS.a.id);
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: WS.a.id })).toEqual({ state: 'unmeasured', at: null, itemId: null });
    r.plan.insertMigration({ workspaceId: WS.a.id, teamKey: 'AAA', project: 'project-a', now: r.t.now });
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: WS.a.id })).toEqual({ state: 'unmeasured', at: null, itemId: null });
  });
  it('a pinned top row needs only its own slot: another workspace unreadable leaves its state, and a row with no team key has none to measure', async () => {
    let mode: Mode = OK;
    const r = await rigWith(() => mode);
    await withPinnedB(r);
    pin(r, 'project-a', WS.a.id);
    r.plan.insertMigration({ workspaceId: WS.b.id, teamKey: 'AAA', project: 'project-b', now: r.t.now });
    mode = { kind: 'record-unreadable', workspaceId: WS.a.id };
    expect(await r.mig.stateOfProject({ teamKey: 'AAA', workspaceId: WS.b.id })).toMatchObject({ state: 'migrating' });
    expect(await r.mig.stateOfProject({ teamKey: null, workspaceId: null })).toMatchObject({ state: 'not-migrated' });
  });
});

describe('programme matches take the workspace too', () => {
  it('a declared epic in the other workspace is refused even with the same team key', async () => {
    const r = await twoWorkspaces();
    expect(r.mig.start('project-a', await r.mig.workspaceOfProject('project-a')).ok).toBe(true);
    const open = await r.mig.readOpen('AAA', WS.a.id);
    if (!open.ok) throw new Error('read');
    const backlog = [{ slug: 'prog-new', title: 'New', epics: [{ key: 'e2', title: 'Epic', summary: 'Summary', project: 'project-b', checkpoints: [] }] }];
    expect(r.mig.storeProposal('AAA', 'coord-a', { entries: [], backlog }, open)).toMatchObject({ ok: false, word: 'plan-bad-body', detail: 'epic-other-team:prog-new/e2' });
  });

  it('declare mail for a ws-b migration reaches its programme, not a ws-a programme', async () => {
    const r = await twoWorkspaces();
    r.addProgramme('prog-a2', 'active', { home: 'project-a' });
    r.addProgramme('prog-b2', 'active', { home: 'project-b' });
    const a = r.openRun('prog-a2', 'working');
    const b = r.openRun('prog-b2', 'working');
    r.db.prepare('UPDATE runs SET claimedBy = ? WHERE id = ?').run('coord-a2', a);
    r.db.prepare('UPDATE runs SET claimedBy = ? WHERE id = ?').run('coord-b2', b);
    r.plan.insertMigration({ workspaceId: WS.b.id, teamKey: 'AAA', project: 'project-b', now: r.t.now });
    await r.tick();
    const mailed = (to: string) => (r.db.prepare("SELECT COUNT(*) AS n FROM mail WHERE toId = ? AND subject LIKE '%declare the plan%'").get(to) as { n: number }).n;
    expect(mailed('coord-a2')).toBe(0);
    expect(mailed('coord-b2')).toBe(1);
  });

  it('a ws-b apply does not require a declared ws-a programme plan', async () => {
    const r = await twoWorkspaces();
    r.db.prepare('UPDATE programs SET planRequired = 0 WHERE slug = ?').run(SLUG);
    r.db.prepare("UPDATE project_linking SET linearOwner = 'coord-b' WHERE project = 'project-b'").run();
    r.addIssue(1);
    expect(r.mig.start('project-b', await r.mig.workspaceOfProject('project-b')).ok).toBe(true);
    const open = await r.mig.readOpen('AAA', WS.b.id);
    if (!open.ok) throw new Error('read');
    const proposal = r.mig.storeProposal('AAA', 'coord-b', { entries: [entry(1, 'stale')] }, open);
    if (!proposal.ok) throw new Error(`proposal refused: ${proposal.detail}`);
    const m = r.plan.migrationById(proposal.migrationId)!;
    expect(r.mig.act(m.itemId!, m.id, 'approve', null)).toEqual({ ok: true });
    await r.until(() => r.stateOf(m.id) === 'applied');
    expect(r.stateOf(m.id)).toBe('applied');
    expect(r.db.prepare('SELECT planRequired FROM programs WHERE slug = ?').get(SLUG)).toMatchObject({ planRequired: 0 });
  });

  it('a leaf placed in an epic whose project is the other workspace\'s AAA is refused leaf-other-team', async () => {
    const r = await twoWorkspaces();
    r.addIssue(1);
    r.db.prepare("UPDATE plan_epics SET project = 'project-b' WHERE program = ?").run(SLUG);
    const where = await r.mig.workspaceOfProject('project-a');
    expect(r.mig.start('project-a', where).ok).toBe(true);
    const open = await r.mig.readOpen('AAA', WS.a.id);
    if (!open.ok) throw new Error('read');
    expect(r.mig.storeProposal('AAA', 'coord-a', { entries: [leaf(1, 'k1')] }, open)).toMatchObject({ ok: false, word: 'plan-bad-body', detail: 'leaf-other-team:AAA-1' });
  });
});
