// Linear hierarchy wave 8, D-8808 (Task 8.1): a project row that names its workspace resolves its team key there only.
// The owner rule (`teamOwnerProject`) and the plan store's project facts, over a real coord.db. Neutral fixtures only.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import Fastify from 'fastify';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { setLinking } from '../src/coord/linkingStore.js';
import { hierarchyProjectsOf, type HierarchyProjectFacts } from '../src/coord/planStore.js';
import { linearOwnerOfTeam, teamOwnerDiagnostic, teamOwnerProject } from '../src/coord/planPolicy.js';
import { CoordStore } from '../src/coord/store.js';
import { planStorePort } from '../src/coord/planStore.js';
import { registerPlanRoutes } from '../src/coord/planRoutes.js';
import { readLinearStore } from '../src/linear/store.js';
import { seedSlot, WS } from './linearProxyRig.js';
import { NOT_DESIGNATED_READS } from './otherLanesFixture.js';
import { mkTmp } from './tmpHelpers.js';

const WS_A = '00000000-0000-4000-8000-0000000000a1';
const WS_B = '00000000-0000-4000-8000-0000000000b2';
const facts = (project: string, over: Partial<HierarchyProjectFacts> = {}): HierarchyProjectFacts =>
  ({ project, teamKey: 'AAA', initiatives: 'on', linearOwner: null, ownsTeam: false, order: null, workspaceId: null, ...over });

describe('teamOwnerProject with a workspace', () => {
  const rows = [facts('project-a', { order: 1, workspaceId: WS_A }), facts('project-b', { order: 2, workspaceId: WS_B })];
  it('a shared key held by two projects in two workspaces routes each inbound issue to its own workspace\'s project', () => {
    expect(teamOwnerProject('AAA', rows, WS_A, null)).toMatchObject({ kind: 'owner', row: { project: 'project-a' } });
    expect(teamOwnerProject('AAA', rows, WS_B, null)).toMatchObject({ kind: 'owner', row: { project: 'project-b' } });
  });
  it('cannot pick a pinned owner when a higher-ranked unpinned holder is unmeasured', () => {
    expect(teamOwnerProject('AAA', [facts('project-c', { order: 1 }), ...rows], WS_B, null)).toMatchObject({ kind: 'unmeasured' });
  });
  it('a workspace nobody holds the key in owns nothing', () => {
    expect(teamOwnerProject('AAA', rows, '00000000-0000-4000-8000-0000000000c3', null)).toEqual({ kind: 'none', reason: 'no-holder' });
  });
});

describe('hierarchyProjectsOf carries the workspace', () => {
  let dir: string;
  let db: ReturnType<typeof openCoordDb>;
  beforeEach(() => { dir = mkTmp('ccrc-linking-ws-'); db = openCoordDb(path.join(dir, 'coord.db')); });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  it('a stored pair reads back, and a project with none reads null', () => {
    setLinking(db, 'project-a', { teamKey: 'AAA', override: null, workspace: WS_A }, 'device-1', 1);
    setLinking(db, 'project-b', { teamKey: 'AAA', override: null, workspace: null }, 'device-1', 2);
    const by = new Map(hierarchyProjectsOf(db).map((r) => [r.project, r.workspaceId]));
    expect(by.get('project-a')).toBe(WS_A);
    expect(by.get('project-b')).toBeNull();
  });
});

describe('linearOwnerOfTeam with a workspace', () => {
  const f = { latestProgrammeCoordinator: (p: string) => `coord-of-${p}`, presence: () => 'alive' as const };
  const rows = [facts('project-a', { order: 1, workspaceId: WS_A, linearOwner: 'coord-a' }), facts('project-b', { order: 2, workspaceId: WS_B, linearOwner: 'coord-b' })];
  it("a shared key held by two projects in two workspaces picks each workspace's own project's owner", () => {
    expect(linearOwnerOfTeam('AAA', rows, f, WS_A, null)).toMatchObject({ project: 'project-a', id: 'coord-a' });
    expect(linearOwnerOfTeam('AAA', rows, f, WS_B, null)).toMatchObject({ project: 'project-b', id: 'coord-b' });
    expect(teamOwnerDiagnostic('AAA', rows, f)).toMatchObject({ project: 'project-a' });
  });
});

// The call sites: a key two connected workspaces share, each project's row pinned to its own workspace.
describe('the plan routes resolve a project row in its own workspace', () => {
  const TOKEN = 'k'.repeat(64);
  const SHARED = [{ id: 'aaaaaaaa-1111-4000-8000-0000000000a1', key: 'AAA', name: 'Team A' }];
  const SHARED_B = [{ id: 'bbbbbbbb-1111-4000-8000-0000000000b1', key: 'AAA', name: 'Team A' }];

  it('two projects sharing key AAA, pinned to ws-a and ws-b, are in other workspaces: a ticket across them is ticket-workspace-mismatch', async () => {
    const dir = mkTmp('ccrc-linking-ws-routes-');
    const ccrcDir = path.join(dir, '.ccrc');
    mkdirSync(ccrcDir, { recursive: true });
    await seedSlot(ccrcDir, 'a', { teams: SHARED });
    await seedSlot(ccrcDir, 'b', { teams: SHARED_B });
    const coord = new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
    setLinking(coord.db, 'project-a', { teamKey: 'AAA', override: 'private', workspace: WS.a.id }, 'x', 1);
    setLinking(coord.db, 'project-b', { teamKey: 'AAA', override: 'private', workspace: WS.b.id }, 'x', 1);
    const app = Fastify();
    registerPlanRoutes(app, {
      coord, plan: planStorePort(coord.db), serial: (fn) => fn(), mailToken: () => TOKEN, attribute: async () => ({ ok: true }),
      otherLaneReads: NOT_DESIGNATED_READS, sessionAuth: () => ({ allow: false, verdict: 'no-session', reason: 'refused', device: null }),
      authEnabled: false, readLinearStore: () => readLinearStore(ccrcDir), runOfSession: () => null, now: () => 1_000,
      runVerdicts: { all: () => new Map() },
    });
    await app.ready();
    const send = (url: string, body: unknown) => app.inject({
      method: 'POST', url: `${url}?byId=coord-a&byUuid=u-coord-a`, payload: body as never, headers: { 'x-ccrc-mail-token': TOKEN },
    });
    const put = await send('/api/programmes/prog-a/plan', {
      home: 'project-a', epics: [{ key: 'e1', title: 'Epic', summary: 's', waves: [1], checkpoints: [{ key: 'e1-c1', title: 'c', kind: 'acceptance' }] }],
    });
    expect(put.statusCode, put.body).toBe(200);
    const across = await send('/api/programmes/prog-a/plan/tickets', { epic: 'e1', key: 't1', kind: 'task', title: 'Do it', project: 'project-b' });
    expect(across.json()).toMatchObject({ ok: false, error: 'ticket-workspace-mismatch' });
    const same = await send('/api/programmes/prog-a/plan/tickets', { epic: 'e1', key: 't2', kind: 'task', title: 'Do it' });
    expect(same.statusCode, same.body).toBe(200);
    await app.close();
    coord.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
