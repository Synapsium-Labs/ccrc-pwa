// D-8077 (spec 2026-11-04 §12.2, A19, A62; the runs rebuild, Task 27): the controls of a refused-close item, on a real server and a
// real store. The CONTROL PIN: the cells that raise an item are listed (the list is not empty, and holds §12.2's seven), every one
// names a door, and each door is run against that cell's fixture run and works. A fixture the decider routes to `inform` is checked
// as inform. Neutral names (prog-*, lane-a, worker-a).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { abandonRefusal } from '../src/coord/close.js';
import { routeRefusals, type RefusedClose } from '../src/coord/runCloseRefusals.js';
import { REFUSAL_REASONS, refusalRoute, type LaneRun, type RefusalReason } from '../src/coord/runClose.js';
import { ASK_GRACE_MS } from '../src/askwindow.js';
import { isCloseRefusedAction, type ItemDoor } from '../../shared/ledgers.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; removeTmpFixtures(); });

/** The seven cells of §12.2 that raise an item. */
const RAISING: readonly [RefusalReason, 'lives' | 'gone'][] = [
  ['open-pr', 'gone'], ['unpushed-commits', 'gone'], ['busy-worker', 'gone'], ['child-marker-unreadable', 'lives'],
  ['child-marker-unreadable', 'gone'], ['absent-claimant', 'gone'], ['warning-undelivered', 'gone'],
];

interface Rig { app: FastifyInstance; coord: CoordStore; home: string; calls: string[][]; n: number }

async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-close-refused-');
  // The heir exists in the registry; the dead claimant (`lane-gone`) does not, which is the shortest honest death.
  for (const id of ['worker-a', 'heir-a']) seedRow(home, id, { project: 'project-a' });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const rec = recorder();
  app = await buildServer({ ...testDeps(home, rec.run), mailToken: ID_GATE_TOKEN, coord }, new Bus());
  return { app, coord, home, calls: rec.calls as string[][], n: 0 };
}

/** One planned run of a programme of its own, claimed by the gone `lane-gone`, optionally with a worker session. */
function fixtureRun(r: Rig, withWorker: boolean): number {
  r.n += 1;
  const opened = r.coord.openRun({ program: `prog-${r.n}`, title: `Prog ${r.n}`, project: 'project-a', wave: 1, waveOf: 2, claimedBy: 'lane-gone' });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  if (withWorker) r.coord.markDispatched(opened.id, 'worker-a', 'worker-a', 'ws/worker-a', false);
  return opened.id;
}

const laneRunOf = (coord: CoordStore, id: number): LaneRun => coord.runCloseRuns().find((x) => x.id === id)!;

/** Raise the cell's item as the lane does, through `routeRefusals` and the real `abandonRefusal`. The clock is far enough back that a
 *  hold has run out by the time the routes read it. */
function raise(r: Rig, id: number, reason: RefusalReason, who: 'lives' | 'gone'): number {
  const refused: RefusedClose = { run: laneRunOf(r.coord, id), row: 'never-started', reason, claimant: 'lane-gone', lives: who === 'lives' };
  const out = routeRefusals({ coord: r.coord, abandonRefusal: (i) => abandonRefusal(r.coord, i) }, [refused], Date.now() - 2 * ASK_GRACE_MS);
  expect(out.raised, `${reason}/${who} raised its item`).toHaveLength(1);
  return out.raised[0]!;
}

const post = (r: Rig, url: string, payload?: unknown) =>
  r.app.inject({ method: 'POST', url, ...(payload === undefined ? {} : { payload: payload as never }) });
const stateOf = (r: Rig, id: number): string => (r.coord.run(id) as { run: { state: string } }).run.state;

describe('the control pin: every item names a control that works', () => {
  it('the list of cells that raise an item is not empty, and holds the seven cells of §12.2 that raise one', () => {
    const cells: string[] = [];
    for (const reason of REFUSAL_REASONS) for (const who of ['lives', 'gone'] as const) {
      const k = refusalRoute(reason, who, true).kind;
      if (k === 'item' || k === 'tell-and-hold') cells.push(`${reason}/${who}`);
    }
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.sort()).toEqual(RAISING.map(([a, b]) => `${a}/${b}`).sort());
  });

  it('every such cell names at least one door', async () => {
    const r = await rig();
    for (const [reason, who] of RAISING) {
      const id = fixtureRun(r, reason === 'busy-worker');
      const item = r.coord.itemById(raise(r, id, reason, who))!;
      expect(isCloseRefusedAction(item.action) && item.action.doors.length, `${reason}/${who}`).toBeGreaterThan(0);
    }
  });

  it('each Abandon or Abandon anyway door, run against that cell\'s fixture run on a real store, is accepted by POST /api/runs/:id/abandon and ends the run', async () => {
    const r = await rig();
    let ran = 0;
    for (const [reason, who] of RAISING) {
      const id = fixtureRun(r, false);
      const item = r.coord.itemById(raise(r, id, reason, who))!;
      if (!isCloseRefusedAction(item.action) || !item.action.doors.some((d) => d === 'abandon' || d === 'abandon-anyway')) continue;
      ran += 1;
      const res = await post(r, `/api/runs/${id}/abandon`);
      expect(res.statusCode, `${reason}/${who}: ${res.body}`).toBe(200);
      expect(['failed', 'closing']).toContain(stateOf(r, id));
    }
    expect(ran, 'the pin ran against the abandoning cells').toBe(4);
  });

  it('each Abandon or Abandon anyway door also works from the row: POST /api/items/:id/act ends the run and closes the item', async () => {
    const r = await rig();
    for (const [reason, who] of RAISING) {
      const id = fixtureRun(r, false);
      const itemId = raise(r, id, reason, who);
      const item = r.coord.itemById(itemId)!;
      if (!isCloseRefusedAction(item.action) || !item.action.doors.some((d) => d === 'abandon' || d === 'abandon-anyway')) continue;
      const res = await post(r, `/api/items/${itemId}/act`);
      expect(res.statusCode, `${reason}/${who}: ${res.body}`).toBe(200);
      expect(stateOf(r, id)).toBe('failed');
      expect(r.coord.itemById(itemId)!.state).toBe('done');
    }
  });

  it('each Hand to a coordinator door is accepted by POST /api/runs/:id/reclaim under a gone claimant', async () => {
    const r = await rig();
    let ran = 0;
    for (const [reason, who] of RAISING) {
      const id = fixtureRun(r, false);
      const item = r.coord.itemById(raise(r, id, reason, who))!;
      if (!isCloseRefusedAction(item.action) || !item.action.doors.includes('hand-to-coordinator')) continue;
      ran += 1;
      const res = await post(r, `/api/runs/${id}/reclaim`, { claimedBy: 'heir-a' });
      expect(res.statusCode, `${reason}/${who}: ${res.body}`).toBe(200);
      expect((r.coord.run(id) as { run: { claimedBy: string } }).run.claimedBy).toBe('heir-a');
    }
    expect(ran).toBeGreaterThan(0);
  });

  it('each link door opens a page that exists for that run: its record, its worker, its coordinator', async () => {
    const r = await rig();
    const links: ItemDoor[] = [];
    for (const [reason, who] of RAISING) {
      const id = fixtureRun(r, reason === 'busy-worker');
      const item = r.coord.itemById(raise(r, id, reason, who))!;
      if (!isCloseRefusedAction(item.action)) continue;
      const run = (r.coord.run(id) as { run: { sessionId: string | null; claimedBy: string | null } }).run;
      for (const door of item.action.doors) {
        if (door === 'open-pr' || door === 'open-worker' || door === 'open-coordinator') {
          links.push(door);
          // Every link lands on the run's page; the worker and the coordinator are the sessions the run names.
          const rec = await r.app.inject({ method: 'GET', url: `/api/runs/${id}/record` });
          expect(rec.statusCode, `${door}: ${rec.body}`).toBe(200);
          if (door === 'open-worker') expect(run.sessionId).not.toBeNull();
          if (door === 'open-coordinator') expect(run.claimedBy).not.toBeNull();
        }
      }
    }
    expect([...new Set(links)].sort()).toEqual(['open-coordinator', 'open-pr', 'open-worker']);
  });
});

describe('an item of a refused close', () => {
  it('Abandon anyway reuses act: the run is abandoned and the item closes done', async () => {
    const r = await rig();
    const id = fixtureRun(r, false);
    const itemId = raise(r, id, 'unpushed-commits', 'gone');
    expect((r.coord.itemById(itemId)!.action as { doors: readonly string[] } | null)!.doors).toEqual(['hand-to-coordinator', 'abandon-anyway']);
    const res = await post(r, `/api/items/${itemId}/act`);
    expect(res.statusCode, res.body).toBe(200);
    expect(stateOf(r, id)).toBe('failed');
    expect(r.coord.itemById(itemId)!.state).toBe('done');
    const ev = r.coord.db.prepare('SELECT causedBy, detail FROM run_events WHERE runId = ? ORDER BY id DESC LIMIT 1').get(id) as { causedBy: string; detail: string };
    expect(ev).toEqual({ causedBy: 'operator', detail: `abandon:refused:${itemId}` });
  });

  it('decline applies to end-run alone', async () => {
    const r = await rig();
    const itemId = raise(r, fixtureRun(r, false), 'child-marker-unreadable', 'gone');
    const res = await post(r, `/api/items/${itemId}/decline`);
    expect(res.statusCode).toBe(409);
    expect(r.coord.itemById(itemId)!.state).toBe('open');
  });

  it('act refuses an item whose doors only open pages', async () => {
    const r = await rig();
    const itemId = raise(r, fixtureRun(r, false), 'open-pr', 'gone');
    const res = await post(r, `/api/items/${itemId}/act`);
    expect(res.statusCode).toBe(409);
    expect(r.coord.itemById(itemId)!.state).toBe('open');
  });

  it('a tick is refused: the item is answered with the controls on its row', async () => {
    const r = await rig();
    const itemId = raise(r, fixtureRun(r, false), 'open-pr', 'gone');
    const res = await post(r, `/api/items/${itemId}/tick`, {});
    expect(res.statusCode).toBe(409);
    expect(r.coord.itemById(itemId)!.state).toBe('open');
  });

  it('an act-time refusal of an item\'s Abandon shows in the sheet and leaves the item raised', async () => {
    const r = await rig();
    const id = fixtureRun(r, false);
    const itemId = raise(r, id, 'child-marker-unreadable', 'gone');
    // The run moved on between the lane's read and the tap: the arm cannot move it from where it is.
    r.coord.db.prepare("UPDATE runs SET state = 'closing' WHERE id = ?").run(id);
    const res = await post(r, `/api/items/${itemId}/act`);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((res.json() as { ok: boolean; error: string }).ok).toBe(false);
    expect(r.coord.itemById(itemId)!.state, 'the item stays raised').toBe('open');
  });

  it('a held item cannot be acted on before the operator sees it', async () => {
    const r = await rig();
    const id = fixtureRun(r, false);
    const refused: RefusedClose = { run: laneRunOf(r.coord, id), row: 'never-started', reason: 'child-marker-unreadable', claimant: 'lane-gone', lives: true };
    const out = routeRefusals({ coord: r.coord, abandonRefusal: (i) => abandonRefusal(r.coord, i) }, [refused], Date.now());
    const res = await post(r, `/api/items/${out.raised[0]!}/act`);
    expect(res.statusCode).toBe(409);
    expect(stateOf(r, id)).toBe('planned');
  });

  it('settle closes the item when its run starts or closes, with the transition\'s own note', async () => {
    const r = await rig();
    const id = fixtureRun(r, false);
    const itemId = raise(r, id, 'open-pr', 'gone');
    r.coord.advance(id, 'failed', 'coordinator');
    const item = r.coord.itemById(itemId)!;
    expect(item.state).toBe('done');
    expect(r.coord.itemHistory(itemId).at(-1)).toMatchObject({ act: 'settle', actor: 'ccrc' });
  });
});

describe('a refusal the pass could not measure', () => {
  it('keeps its anchor and its item until a definite measurement, and a refusal that lasts raises once', async () => {
    const r = await rig();
    const id = fixtureRun(r, true);
    const refused: RefusedClose = { run: laneRunOf(r.coord, id), row: 'never-started', reason: 'open-pr', claimant: 'lane-gone', lives: false };
    const deps = { coord: r.coord, abandonRefusal: (i: number) => abandonRefusal(r.coord, i) };
    const t0 = Date.now() - 2 * ASK_GRACE_MS;
    expect(routeRefusals(deps, [refused], t0).raised).toHaveLength(1);
    // A pass with a measurement doubt: the refusal is absent from `current`, but the run is named unmeasured.
    const doubt = routeRefusals(deps, [], t0 + 1000, new Set([id]));
    expect(doubt.settled).toEqual([]);
    expect(r.coord.openCloseRefusedItems()).toHaveLength(1);
    // The next healthy pass finds the same refusal: it was told already, so nothing is raised again.
    const again = routeRefusals(deps, [refused], t0 + 2000);
    expect(again.raised).toEqual([]);
    expect(r.coord.openCloseRefusedItems()).toHaveLength(1);
    // A definite measurement that finds no refusal settles it.
    expect(routeRefusals(deps, [], t0 + 3000).settled).toHaveLength(1);
  });
});

