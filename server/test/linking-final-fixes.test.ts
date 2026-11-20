// Linear hierarchy wave 8, D-8808 (the final whole-branch review, I1): a team key two connected workspaces share has an owner in
// EACH workspace. project-a holds AAA in ws-a, project-b holds AAA in ws-b. An issue filed in ws-b is triaged by project-b's owner,
// a handed ws-b issue's return goes to project-b's owner, its close reason is judged by project-b's linking mode, and a project's
// own Linear owner (`linearOwnerOfProject`) is decided in its own row's workspace. A real coord.db and a real Linear store on a tmp
// dir; the routes on a bare Fastify with the real plan store. Neutral fixtures only; nothing reaches a network.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NO_PLAN_CHANGES, applyPlanChanges, planStorePort, type PlanChanges, type PlanStorePort } from '../src/coord/planStore.js';
import { linearOwnerOfProject } from '../src/coord/planPolicy.js';
import { registerPlanRoutes } from '../src/coord/planRoutes.js';
import { readLinearStore } from '../src/linear/store.js';
import { InboundLane } from '../src/linear/inboundLane.js';
import { PlanSync } from '../src/linear/planSync.js';
import type { CcrcOpAsk, CcrcOpOutcome } from '../src/linear/ccrcCall.js';
import type { LinearDirectoryEntries } from '../src/linear/ops.js';
import { NOT_DESIGNATED_READS } from './otherLanesFixture.js';
import { seedSlot, WS } from './linearProxyRig.js';
import { mkTmp } from './tmpHelpers.js';

const T = 1_800_000_000_000;
const TOKEN = 'k'.repeat(64);
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** ws-b's own team keyed AAA (a different team id from ws-a's). */
const AAA_IN_B = [{ id: 'bbbbbbbb-1111-4000-8000-0000000000b1', key: 'AAA', name: 'Team A' }];

interface Rig { coord: CoordStore; plan: PlanStorePort; app: FastifyInstance; ccrcDir: string }
const dirs: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close().catch(() => undefined);
  for (const d of dirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* the reaper */ } }
});

const changes = (over: Partial<PlanChanges>): PlanChanges => ({ ...NO_PLAN_CHANGES(), ...over });

/** Two workspaces sharing key AAA; project-a (private, owner coord-a) pinned to ws-a, project-b (public, owner coord-b) to ws-b.
 *  prog-c (coordinator coord-c, home project-a) is the programme a ws-b issue is handed to. One ws-b issue, AAA-20, waits. */
async function rig(): Promise<Rig> {
  const dir = mkTmp('ccrc-linking-final-');
  dirs.push(dir);
  const ccrcDir = path.join(dir, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  await seedSlot(ccrcDir, 'a');
  await seedSlot(ccrcDir, 'b', { teams: AAA_IN_B });
  const coord = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  coord.setLinking('project-a', { teamKey: 'AAA', override: 'private', workspace: WS.a.id }, 'device-a', T - 10);
  coord.setLinking('project-b', { teamKey: 'AAA', override: 'public', workspace: WS.b.id }, 'device-a', T - 9);
  const plan = planStorePort(coord.db);
  const declare = (slug: string, by: string, home: string, at: number): void => {
    applyPlanChanges(coord.db, slug, changes({
      epics: { insert: [{ key: `e-${slug}`, project: home, waves: [1], ordinal: 0, title: 'Epic', summary: 'Summary' }], update: [], drop: [] },
      checkpoints: { insert: [{ epicKey: `e-${slug}`, key: `c-${slug}`, ordinal: 0, title: 'Checkpoint', kind: 'acceptance', proves: [], itemId: null }], update: [], drop: [] },
    }), by, at, { home, title: slug });
  };
  declare('prog-a', 'coord-a', 'project-a', T - 8);
  declare('prog-b', 'coord-b', 'project-b', T - 7);
  declare('prog-c', 'coord-c', 'project-a', T - 6);
  coord.db.prepare('DELETE FROM plan_sync_due').run();
  plan.setHierarchySettings('project-a', { initiatives: 'on', linearOwner: 'coord-a', ownsTeam: false }, 'test', T - 5);
  plan.setHierarchySettings('project-b', { initiatives: 'on', linearOwner: 'coord-b', ownsTeam: false }, 'test', T - 5);
  plan.upsertInbound({ linearId: U(20), workspaceId: WS.b.id, teamKey: 'AAA', identifier: 'AAA-20', title: 'Reporter title', body: 'Reporter body', seenAt: T - 4 });
  const app = Fastify();
  apps.push(app);
  registerPlanRoutes(app, {
    coord, plan, serial: (fn) => fn(), mailToken: () => TOKEN, attribute: async () => ({ ok: true }), otherLaneReads: NOT_DESIGNATED_READS,
    sessionAuth: () => ({ allow: false, verdict: 'no-session', reason: 'refused', device: null }), authEnabled: false,
    readLinearStore: () => readLinearStore(ccrcDir), runOfSession: () => null, now: () => T, presenceOf: () => 'alive', privateTrackerKeys: [],
    inboundRecheck: async () => ({ kind: 'managed' }),
  });
  await app.ready();
  return { coord, plan, app, ccrcDir };
}

const send = (r: Rig, url: string, body: unknown, who: string) =>
  r.app.inject({ method: 'POST', url: `${url}?byId=${who}&byUuid=u-${who}`, payload: body as never, headers: { 'x-ccrc-mail-token': TOKEN } });
const errorOf = (res: { json: () => unknown }): string => (res.json() as { error?: string }).error ?? '';

describe('a key two workspaces share: the inbound row\'s workspace decides the owner (final review I1)', () => {
  it("a ws-b issue is triaged by project-b's owner; project-a's owner is refused", async () => {
    const r = await rig();
    const other = await send(r, '/api/teams/AAA/plan/triage', { issue: 'AAA-20', decision: 'close', reason: 'already done elsewhere' }, 'coord-a');
    expect(errorOf(other), other.body).toBe('not-linear-owner');
    expect(r.plan.inboundOf(U(20))).toMatchObject({ state: 'waiting' });
    const own = await send(r, '/api/teams/AAA/plan/triage', { issue: 'AAA-20', decision: 'close', reason: 'already done elsewhere' }, 'coord-b');
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json()).toMatchObject({ ok: true, state: 'closed' });
    expect(r.plan.inboundOf(U(20))).toMatchObject({ state: 'closed', reason: 'already done elsewhere' });
  });

  it("a triage close reason is judged by project-b's mode (public): a tracker id is refused", async () => {
    const r = await rig();
    const res = await send(r, '/api/teams/AAA/plan/triage', { issue: 'AAA-20', decision: 'close', reason: 'a duplicate of AAA-5' }, 'coord-b');
    expect(errorOf(res), res.body).toBe('linear-text-public');
    expect(r.plan.inboundOf(U(20))).toMatchObject({ state: 'waiting' });
  });

  it("a handed ws-b issue's return goes to project-b's owner", async () => {
    const r = await rig();
    r.plan.setInboundState(U(20), { state: 'handed', handedTo: 'prog-c' });
    const res = await send(r, '/api/programmes/prog-c/plan/take', { issue: 'AAA-20', return: { note: 'not ours' } }, 'coord-c');
    expect(res.statusCode, res.body).toBe(200);
    expect(r.plan.inboundOf(U(20))).toMatchObject({ state: 'mailed', mailedTo: 'coord-b' });
    const mail = r.coord.db.prepare("SELECT toId FROM mail WHERE subject LIKE 'Linear inbound%' ORDER BY id").all() as { toId: string }[];
    expect(mail.map((m) => m.toId)).toEqual(['coord-b']);
  });

  it("a handed ws-b issue's close reason is judged by project-b's mode (public), not project-a's (private)", async () => {
    const r = await rig();
    r.plan.setInboundState(U(20), { state: 'handed', handedTo: 'prog-c' });
    const refused = await send(r, '/api/programmes/prog-c/plan/take', { issue: 'AAA-20', close: { why: 'a duplicate of AAA-5' } }, 'coord-c');
    expect(errorOf(refused), refused.body).toBe('linear-text-public');
    expect(r.plan.inboundOf(U(20))).toMatchObject({ state: 'handed' });
    const plain = await send(r, '/api/programmes/prog-c/plan/take', { issue: 'AAA-20', close: { why: 'not a bug' } }, 'coord-c');
    expect(plain.statusCode, plain.body).toBe(200);
    expect(r.plan.inboundOf(U(20))).toMatchObject({ state: 'closed' });
  });
});

describe("linearOwnerOfProject decides a shared key's owner in the project row's own workspace (final review I1)", () => {
  const f = { latestProgrammeCoordinator: (p: string) => `coord-of-${p}`, presence: () => 'alive' as const };
  const row = (project: string, workspaceId: string, order: number, linearOwner: string) =>
    ({ project, teamKey: 'AAA', initiatives: 'on' as const, linearOwner, ownsTeam: false, order, workspaceId });
  it("project-b's owner is project-b's, not the first holder's in another workspace", () => {
    const rows = [row('project-a', WS.a.id, 1, 'coord-a'), row('project-b', WS.b.id, 2, 'coord-b')];
    expect(linearOwnerOfProject('project-b', rows, f)).toMatchObject({ project: 'project-b', id: 'coord-b' });
    expect(linearOwnerOfProject('project-a', rows, f)).toMatchObject({ project: 'project-a', id: 'coord-a' });
  });
});

// Fix round 1 F1 (review 2971): the inbound lane's own public-text re-check, run before a close comment is sent, judges the reason
// by the project that owns the team IN THE ROW'S WORKSPACE. project-a (ws-a, private) set AAA first; a ws-b issue's close reason is
// judged by project-b's mode (public), so a tracker id in it never reaches Linear.
describe("the inbound lane's re-check before a close comment takes the row's workspace (fix round 1 F1)", () => {
  const DIRECTORY: LinearDirectoryEntries = {
    viewerId: U(900), labels: [], projects: [], users: [], initiatives: 'on',
    states: [{ id: U(21), name: 'Todo', type: 'unstarted', teamKey: 'AAA' }, { id: U(24), name: 'Nope', type: 'canceled', teamKey: 'AAA' }],
    projectStatuses: [],
  };

  it("a ws-b close reason naming a tracker id is judged by project-b's mode (public): the fallback comment, never the reason", async () => {
    const r = await rig();
    for (const ws of [WS.a.id, WS.b.id]) {
      r.coord.db.prepare('INSERT INTO linear_migrations (workspaceId, teamKey, state, createdAt, updatedAt, appliedAt) VALUES (?, ?, ?, 1, 1, ?)').run(ws, 'AAA', 'applied', T - 1000);
    }
    // The route would refuse this reason; the lane re-checks it anyway (the facts may change between triage and the act).
    r.plan.setInboundState(U(20), { state: 'closed', reason: 'a duplicate of AAA-5' });
    const asks: CcrcOpAsk[] = [];
    const call = async (ask: CcrcOpAsk): Promise<CcrcOpOutcome> => {
      asks.push(ask);
      if (ask.op === 'issueOwned') return { ok: true, value: { issue: { id: U(20), identifier: 'AAA-20', teamKey: 'AAA', stateType: 'unstarted' } }, created: null };
      return { ok: true, value: { id: U(30) }, created: null };
    };
    const directory = { get: () => DIRECTORY, filledAt: () => T - 1000, projectStatusesRead: () => 'read' as const };
    const read = () => readLinearStore(r.ccrcDir);
    const sync = new PlanSync({
      coord: r.coord, plan: r.plan, ccrcDir: r.ccrcDir, readLinearStore: read, call, directory, directoryMiss: () => undefined,
      markSlotRejected: async () => undefined, now: () => T, privateTrackerKeys: [], upkeepOwnerOf: () => null,
    });
    const lane = new InboundLane({
      coord: r.coord, plan: r.plan, planSync: sync, readLinearStore: read, call, now: () => T, presenceOf: () => 'alive', viaFleet: () => new Set(), directory,
    });
    await lane.tick(T);
    const comment = asks.find((a) => a.op === 'issueComment');
    expect(comment, JSON.stringify(asks.map((a) => a.op))).toBeDefined();
    expect(String(comment!.input['body'])).not.toContain('AAA-5');
    expect(String(comment!.input['body'])).toContain('did not pass the public-text check');
    expect(asks.map((a) => a.op)).toContain('issueUpdate');
  });
});
