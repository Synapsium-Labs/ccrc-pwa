// D-8182 (Linear hierarchy plan, Task 3.5): the initiatives-off operator item the plan sync raises and settles, and the item
// route the operator acts on it through. The directory state is set by the test (`initiatives: 'off'`): the probe never reads
// `off` (R8), so nothing live raises this item. A real coord.db and Linear store on a tmp dir; Linear faked at the `call` port.
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { CoordStore } from '../src/coord/store.js';
import { NO_PLAN_CHANGES, applyPlanChanges, planStorePort, type PlanChanges } from '../src/coord/planStore.js';
import { registerHierarchyRoutes } from '../src/coord/hierarchyRoutes.js';
import type { LinearDirectoryEntries } from '../src/linear/ops.js';
import { PLAN_SYNC_DEBOUNCE_MS, PlanSync } from '../src/linear/planSync.js';
import { readLinearStore } from '../src/linear/store.js';
import { LINEAR_SYNC_PROGRAMME } from '../../shared/plan.js';
import { memCoordDb } from './linearServicesFake.js';
import { seedSlot } from './linearProxyRig.js';
import { mkTmp } from './tmpHelpers.js';

const T = 1_800_000_000_000;
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OFF: LinearDirectoryEntries = {
  viewerId: U(900), labels: [], projects: [], users: [], initiatives: 'off',
  states: [{ id: U(21), name: 'Todo', type: 'unstarted', teamKey: 'AAA' }],
  projectStatuses: [{ id: U(31), name: 'P', type: 'planned' }],
};
const changes = (over: Partial<PlanChanges>): PlanChanges => ({ ...NO_PLAN_CHANGES(), ...over });

let dirs: string[] = [];
afterEach(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* the reaper */ } } dirs = []; });

interface Rig {
  db: DatabaseSync; coord: CoordStore; sync: PlanSync; dir: { initiatives: LinearDirectoryEntries['initiatives'] };
  queued: unknown[]; t: { now: number }; ccrcDir: string;
}
/** Two programmes (`prog-a` on project-a, `prog-b` on project-b), both on team AAA, which one slot serves. */
async function rig(o: { projectBInitiatives?: 'on' | 'off'; projectAInitiatives?: 'on' | 'off' } = {}): Promise<Rig> {
  const dir = mkTmp('ccrc-linear-items-');
  dirs.push(dir);
  const ccrcDir = path.join(dir, '.ccrc');
  await seedSlot(ccrcDir, 'a');
  const db = memCoordDb();
  const coord = new CoordStore(db);
  for (const [project, setting] of [['project-a', o.projectAInitiatives ?? 'on'], ['project-b', o.projectBInitiatives ?? 'on']] as const) {
    db.prepare('INSERT INTO project_linking (project, teamKey, override, initiatives) VALUES (?, ?, ?, ?)').run(project, 'AAA', 'private', setting);
  }
  // Programme lifecycle W1 (R11): one coordinator owns at most one live programme, so each programme has its own.
  for (const [slug, project, coordinator] of [['prog-a', 'project-a', 'coord-a'], ['prog-b', 'project-b', 'coord-b']] as const) {
    applyPlanChanges(db, slug, changes({
      epics: { insert: [{ key: 'e1', project, waves: [1], ordinal: 0, title: 'Epic', summary: 'Summary' }], update: [], drop: [] },
      checkpoints: { insert: [{ epicKey: 'e1', key: 'c1', ordinal: 0, title: 'Checkpoint', kind: 'acceptance', proves: [], itemId: null }], update: [], drop: [] },
    }), coordinator, T, { home: project, title: slug });
  }
  const plan = planStorePort(db);
  const r = { db, coord, dir: { initiatives: 'off' as LinearDirectoryEntries['initiatives'] }, queued: [] as unknown[], t: { now: T }, ccrcDir } as Rig;
  r.sync = new PlanSync({
    coord, plan, ccrcDir, readLinearStore: () => readLinearStore(ccrcDir),
    call: async () => ({ ok: false, word: 'unreachable', maybeSent: false }),
    directory: { get: () => ({ ...OFF, initiatives: r.dir.initiatives }), filledAt: () => T - 1000, projectStatusesRead: () => 'read' },
    directoryMiss: () => undefined, markSlotRejected: async () => undefined,
    queueDirectory: (slot) => { r.queued.push(slot); },
    now: () => r.t.now, privateTrackerKeys: [],
  });
  return r;
}
const tick = async (r: Rig): Promise<void> => { r.t.now = Math.max(r.t.now, T + PLAN_SYNC_DEBOUNCE_MS); await r.sync.tick(r.t.now); };
const itemsOf = (r: Rig) => r.db.prepare('SELECT id, kind, title, state, action FROM operator_items WHERE program = ? ORDER BY id')
  .all(LINEAR_SYNC_PROGRAMME) as { id: number; kind: string; title: string; state: string; action: string }[];

describe('the initiatives-off item (D-8182)', () => {
  it('one item per workspace however many programmes wait', async () => {
    const r = await rig();
    await tick(r);
    await tick(r);
    const items = itemsOf(r);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'do', title: 'Turn on initiatives in this Linear workspace', state: 'open' });
    expect(JSON.parse(items[0]!.action)).toEqual({ verb: 'linear-initiatives', workspaceId: expect.any(String) });
  });

  it('a probe that reads on settles the item', async () => {
    const r = await rig();
    await tick(r);
    expect(itemsOf(r).map((i) => i.state)).toEqual(['open']);
    r.dir.initiatives = 'on';
    r.db.prepare('INSERT INTO plan_sync_due (program, dueAt) VALUES (?, ?) ON CONFLICT(program) DO UPDATE SET dueAt = excluded.dueAt').run('prog-a', 0);
    await r.sync.tick(r.t.now + 1);
    expect(itemsOf(r).map((i) => i.state)).toEqual(['done']);
  });

  it('a tick settles the item when the directory reads on, with no programme due', async () => {
    const r = await rig();
    await tick(r);
    r.db.prepare('DELETE FROM plan_sync_due').run();
    r.dir.initiatives = 'on';
    await r.sync.tick(r.t.now + 1);
    expect(itemsOf(r).map((i) => i.state)).toEqual(['done']);
  });

  it('settling marks the waiting programmes due, and the next pass creates their initiative', async () => {
    const r = await rig();
    await tick(r);
    r.db.prepare('DELETE FROM plan_sync_due').run();
    r.t.now += 60_000;                                    // past the workspace holds the first tick's failures set (D-8183)
    r.dir.initiatives = 'on';
    const asks: string[] = [];
    (r.sync as unknown as { deps: { call: (a: { op: string }) => Promise<unknown> } }).deps.call = async (a) => { asks.push(a.op); return { ok: false, word: 'unreachable', maybeSent: false }; };
    await r.sync.tick(r.t.now + 1);
    const due = (r.db.prepare('SELECT program FROM plan_sync_due ORDER BY program').all() as { program: string }[]).map((d) => d.program);
    expect(due).toEqual(['prog-a', 'prog-b']);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 10);
    expect(asks).toContain('initiativeCreate');
  });

  it('a project set off raises nothing', async () => {
    const r = await rig({ projectAInitiatives: 'off', projectBInitiatives: 'off' });
    await tick(r);
    expect(itemsOf(r)).toEqual([]);
  });

  it('check-again queues the probe', async () => {
    const r = await rig();
    await tick(r);
    const [item] = itemsOf(r);
    const app = Fastify();
    registerHierarchyRoutes(app, {
      plan: planStorePort(r.db), serial: (fn) => fn(), presenceOf: () => 'unmeasured', by: () => 'device-a',
      itemOf: (id) => r.coord.itemById(id), checkInitiatives: (w) => r.sync.checkInitiatives(w),
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: `/api/items/${item!.id}/linear`, payload: { act: 'check-again' } });
    await app.close();
    expect([res.statusCode, res.json().ok]).toEqual([200, true]);
    expect(r.queued).toHaveLength(1);
    expect(itemsOf(r).map((i) => i.state)).toEqual(['open']);       // it queues, it never settles: the next probe does
  });

  it('approve on an initiatives item is item-act-mismatch', async () => {
    const r = await rig();
    await tick(r);
    const [item] = itemsOf(r);
    const app = Fastify();
    registerHierarchyRoutes(app, {
      plan: planStorePort(r.db), serial: (fn) => fn(), presenceOf: () => 'unmeasured', by: () => 'device-a',
      itemOf: (id) => r.coord.itemById(id), checkInitiatives: (w) => r.sync.checkInitiatives(w),
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: `/api/items/${item!.id}/linear`, payload: { act: 'approve' } });
    await app.close();
    expect([res.statusCode, res.json().error]).toEqual([409, 'item-act-mismatch']);
    expect(r.queued).toHaveLength(0);
  });
});

describe('the persistent-drift item\'s acts (D-8183)', () => {
  type DriftAct = NonNullable<Parameters<typeof registerHierarchyRoutes>[1]['driftAct']>;
  async function routeRig(driftAct: DriftAct | undefined) {
    const r = await rig();
    const id = r.coord.raiseItem({
      program: LINEAR_SYNC_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'decide', neededBy: 'later', soonLabel: null, secretSlot: null,
      title: 'Linear keeps changing ticket t1', why: 'w', how: [], options: ['Hand to the coordinator', 'Keep the plan'], recommended: 0, recommendedWhy: 'because',
      action: { verb: 'linear-drift', bindingId: 7 },
    }, T, 'ccrc');
    const app = Fastify();
    registerHierarchyRoutes(app, {
      plan: planStorePort(r.db), serial: (fn) => fn(), presenceOf: () => 'unmeasured', by: () => 'device-a',
      itemOf: (i) => r.coord.itemById(i), ...(driftAct === undefined ? {} : { driftAct }),
    });
    await app.ready();
    const post = async (act: string) => { const res = await app.inject({ method: 'POST', url: `/api/items/${id}/linear`, payload: { act } }); return { code: res.statusCode, body: res.json() }; };
    return { r, id, post, close: () => app.close() };
  }

  it('hand and keep reach the drift pass with the item and its binding, and answer ok', async () => {
    const calls: unknown[] = [];
    const { id, post, close } = await routeRig((i, a, b) => { calls.push([i, a, b]); return { ok: true }; });
    expect(await post('hand')).toMatchObject({ code: 200, body: { ok: true } });
    expect(await post('keep')).toMatchObject({ code: 200, body: { ok: true } });
    await close();
    expect(calls).toEqual([[id, 'hand', 7], [id, 'keep', 7]]);
  });

  it('a refusal of the pass is the route\'s refusal word', async () => {
    const { post, close } = await routeRig(() => ({ ok: false, word: 'not-open' }));
    expect(await post('keep')).toMatchObject({ code: 409, body: { error: 'not-open' } });
    await close();
    const again = await routeRig(() => ({ ok: false, word: 'not-found' }));
    expect(await again.post('hand')).toMatchObject({ code: 404, body: { error: 'not-found' } });
    await again.close();
  });

  it('an act the drift action does not take is item-act-mismatch, and a route with no pass is unavailable', async () => {
    const calls: unknown[] = [];
    const { post, close } = await routeRig((i, a, b) => { calls.push([i, a, b]); return { ok: true }; });
    expect(await post('check-again')).toMatchObject({ code: 409, body: { error: 'item-act-mismatch' } });
    expect(await post('approve')).toMatchObject({ code: 409, body: { error: 'item-act-mismatch' } });
    await close();
    expect(calls).toEqual([]);
    const none = await routeRig(undefined);
    expect(await none.post('hand')).toMatchObject({ code: 503, body: { error: 'unavailable' } });
    await none.close();
  });

  it('hand on an initiatives item is item-act-mismatch, never reaching the drift pass', async () => {
    const r = await rig();
    await tick(r);
    const [item] = itemsOf(r);
    const calls: unknown[] = [];
    const app = Fastify();
    registerHierarchyRoutes(app, {
      plan: planStorePort(r.db), serial: (fn) => fn(), presenceOf: () => 'unmeasured', by: () => 'device-a',
      itemOf: (id) => r.coord.itemById(id), checkInitiatives: (w) => r.sync.checkInitiatives(w), driftAct: (i, a, b) => { calls.push([i, a, b]); return { ok: true }; },
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: `/api/items/${item!.id}/linear`, payload: { act: 'hand' } });
    await app.close();
    expect([res.statusCode, res.json().error]).toEqual([409, 'item-act-mismatch']);
    expect(calls).toEqual([]);
  });
});
