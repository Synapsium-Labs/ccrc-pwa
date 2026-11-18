// D-8181: the per-project hierarchy settings' routes (`coord/hierarchyRoutes.ts`), on a bare Fastify with the real plan store.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import { rmSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { planStorePort } from '../src/coord/planStore.js';
import { registerHierarchyRoutes } from '../src/coord/hierarchyRoutes.js';
import type { CoordinatorPresence } from '../../shared/ledgers.js';
import type { DatabaseSync } from 'node:sqlite';
import { seedLegacyProgramme } from './helpers/plan.js';
import { mkTmp } from './tmpHelpers.js';

let home: string;
let db: DatabaseSync;
let app: FastifyInstance;
let presence: Record<string, CoordinatorPresence>;

const claim = (slug: string, home_: string, by: string, at: number): void => {
  seedLegacyProgramme(db, slug, home_);
  db.prepare('UPDATE programs SET createdAt = ?, planBy = ? WHERE slug = ?').run(at, by, slug);
};

beforeEach(async () => {
  home = mkTmp('ccrc-hierarchy-routes-');
  db = openCoordDb(path.join(home, 'coord.db'));
  presence = {};
  app = Fastify();
  registerHierarchyRoutes(app, {
    plan: planStorePort(db), serial: (fn) => fn(), presenceOf: (id) => presence[id] ?? 'unmeasured', by: () => 'device-a', now: () => 7,
  });
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); rmSync(home, { recursive: true, force: true }); });

const setProject = (project: string, body: unknown) =>
  app.inject({ method: 'POST', url: `/api/projects/${project}/hierarchy`, payload: body as never });
const get = () => app.inject({ method: 'GET', url: '/api/hierarchy' });

describe('hierarchy routes', () => {
  it('setting ownsTeam on project-b clears it on project-a with the same key', async () => {
    db.prepare("INSERT INTO project_linking (project, teamKey) VALUES ('project-a', 'AAA'), ('project-b', 'AAA')").run();
    expect((await setProject('project-a', { initiatives: 'on', linearOwner: null, ownsTeam: true })).statusCode).toBe(200);
    const res = await setProject('project-b', { initiatives: 'off', linearOwner: null, ownsTeam: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toEqual({ initiatives: 'off', linearOwner: null, ownsTeam: true });
    const a = (await get()).json().projects.find((p: { project: string }) => p.project === 'project-a');
    expect(a.ownsTeam).toBe(false);
  });

  it("owner for all writes every project's linearOwner", async () => {
    claim('prog-a', 'project-a', 'sess-1', 1);
    db.prepare("INSERT INTO project_linking (project, teamKey, initiatives) VALUES ('project-b', 'BBB', 'off')").run();
    const res = await app.inject({ method: 'POST', url: '/api/hierarchy/owner', payload: { linearOwner: 'sess-1' } });
    expect([res.statusCode, res.json().projects]).toEqual([200, 2]);
    const rows = (await get()).json().projects as { project: string; linearOwner: string; initiatives: string }[];
    expect(rows.map((r) => [r.project, r.linearOwner, r.initiatives])).toEqual([['project-a', 'sess-1', 'on'], ['project-b', 'sess-1', 'off']]);
  });

  it('GET answers the default owner and whether it is live', async () => {
    claim('prog-a', 'project-a', 'sess-1', 1);
    claim('prog-b', 'project-a', 'sess-2', 2);
    presence['sess-2'] = 'alive';
    presence['sess-1'] = 'dead';
    const body = (await get()).json();
    expect(body.projects).toEqual([{
      project: 'project-a', teamKey: null, initiatives: 'on', linearOwner: null, ownsTeam: false,
      ownerNow: { id: 'sess-2', source: 'default', live: true, project: 'project-a', ifUnnamed: { id: 'sess-2', live: true } }, state: 'not-migrated', stateAt: null, itemId: null, inboundWaiting: 0,
    }]);
    expect(body.coordinators).toEqual([{ id: 'sess-1', live: false }, { id: 'sess-2', live: true }]);
  });

  it("a shared team key answers the owning project's named owner, over the sharer's own", async () => {
    claim('prog-b', 'project-b', 'sess-1', 1);
    claim('prog-a', 'project-a', 'sess-2', 2);
    db.prepare("INSERT INTO project_linking (project, teamKey) VALUES ('project-a', 'AAA'), ('project-b', 'AAA')").run();
    await setProject('project-a', { initiatives: 'on', linearOwner: 'sess-2', ownsTeam: true });
    await setProject('project-b', { initiatives: 'on', linearOwner: 'sess-1', ownsTeam: false });
    const rows = (await get()).json().projects as { project: string; ownerNow: { id: string; source: string } }[];
    expect(rows.map((r) => [r.project, r.ownerNow.id, r.ownerNow.source])).toEqual([['project-a', 'sess-2', 'named'], ['project-b', 'sess-2', 'named']]);
    // `project` is the project the owner was decided for: the sibling's is the owning project (decided by `ownsTeam`), the owner's its own.
    expect(rows.map((r) => [r.project, (r as unknown as { ownerNow: { project: string } }).ownerNow.project])).toEqual([['project-a', 'project-a'], ['project-b', 'project-a']]);
  });

  it('with no project marked ownsTeam, the first project that set the key owns it', async () => {
    claim('prog-a', 'project-a', 'sess-1', 1);
    claim('prog-b', 'project-b', 'sess-2', 2);
    db.prepare("INSERT INTO project_linking (project, teamKey) VALUES ('project-b', 'AAA'), ('project-a', 'AAA')").run();
    const rows = (await get()).json().projects as { project: string; ownerNow: { id: string } }[];
    expect(rows.map((r) => [r.project, r.ownerNow.id])).toEqual([['project-a', 'sess-2'], ['project-b', 'sess-2']]);
    // No row is marked, so the lowest order (project-b set the key first) decides: both rows name project-b.
    expect(rows.map((r) => (r as unknown as { ownerNow: { project: string } }).ownerNow.project)).toEqual(['project-b', 'project-b']);
  });

  it('ifUnnamed is the coordinator the default rule gives with no named owner: for a named row not the named one, for none null, for a shared-key sibling its own default', async () => {
    claim('prog-a', 'project-a', 'sess-1', 1);
    claim('prog-b', 'project-b', 'sess-2', 2);
    db.prepare("INSERT INTO project_linking (project, teamKey) VALUES ('project-a', 'AAA'), ('project-b', 'AAA'), ('project-c', NULL)").run();
    presence['sess-1'] = 'alive';
    presence['sess-2'] = 'dead';
    await setProject('project-a', { initiatives: 'on', linearOwner: 'sess-2', ownsTeam: true });
    const rows = (await get()).json().projects as { project: string; ownerNow: { id: string | null; source: string; live: boolean; ifUnnamed: { id: string | null; live: boolean } } }[];
    const by = (p: string) => rows.find((r) => r.project === p)!.ownerNow;
    // named: the owner now is the named sess-2 (not live), but clearing it gives project-a's latest programme's coordinator, sess-1 (live).
    expect([by('project-a').id, by('project-a').source, by('project-a').ifUnnamed]).toEqual(['sess-2', 'named', { id: 'sess-1', live: true }]);
    // shared-key sibling: its owner now is project-a's named sess-2, its own default is project-b's coordinator, sess-2 (not live).
    expect([by('project-b').id, by('project-b').ifUnnamed]).toEqual(['sess-2', { id: 'sess-2', live: false }]);
    // none: no programme home, no named owner.
    expect([by('project-c').source, by('project-c').ifUnnamed]).toEqual(['none', { id: null, live: false }]);
  });

  it('a hibernated owner reads live', async () => {
    // `coordinatorPresenceIn` answers `alive` for an asleep session, so the route's `live` follows it.
    claim('prog-a', 'project-a', 'sess-1', 1);
    presence['sess-1'] = 'alive';
    expect((await get()).json().projects[0].ownerNow).toEqual({ id: 'sess-1', source: 'default', live: true, project: 'project-a', ifUnnamed: { id: 'sess-1', live: true } });
  });

  it('an unmeasured owner is neither live nor gone: it reads not live', async () => {
    claim('prog-a', 'project-a', 'sess-1', 1);
    expect((await get()).json().projects[0].ownerNow.live).toBe(false);
  });

  it('an unknown owner id is bad-request', async () => {
    claim('prog-a', 'project-a', 'sess-1', 1);
    const one = await setProject('project-a', { initiatives: 'on', linearOwner: 'nobody', ownsTeam: false });
    expect([one.statusCode, one.json().error]).toEqual([400, 'bad-request']);
    const all = await app.inject({ method: 'POST', url: '/api/hierarchy/owner', payload: { linearOwner: 'nobody' } });
    expect([all.statusCode, all.json().error]).toEqual([400, 'bad-request']);
    expect((await setProject('project-a', { initiatives: 'maybe', linearOwner: null, ownsTeam: false })).statusCode).toBe(400);
  });

  it('inboundWaiting reads 0 before wave 4', async () => {
    db.prepare("INSERT INTO project_linking (project, teamKey) VALUES ('project-a', 'AAA')").run();
    expect((await get()).json().projects[0].inboundWaiting).toBe(0);
  });
});
