// Console speed S2, per-request reads: `GET /api/runs?closed=1` WITHOUT `limit` answers every active run and every
// closed run, in the order the store gives them. This file pins that unpaged answer over a fixture CoordStore (3
// active runs, 5 closed ones); later steps add the paging cases beside it, and these must stay green when they do.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { RunSummary } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const COORD = 'project-a-coordinator';
const T_OPEN = 1_758_500_000_000;

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; vi.restoreAllMocks(); });

let n = 0;
/** One run in a programme of its own (closing a programme's last run retires it), dispatched onto `sess-<n>`. */
const dispatched = (coord: CoordStore): number => {
  n += 1;
  const program = `runs-page-${n}`;
  const r = coord.openRun({ program, title: 'Runs page', project: 'project-a', wave: 1, waveOf: 1, claimedBy: COORD }) as { id: number };
  const slug = `sess-${n}`;
  coord.dispatchRun({
    runId: r.id, sessionId: `project-a-${slug}`, workspace: slug, branch: `ws/${slug}`, resumed: false, clearedAt: null, items: [],
  });
  return r.id;
};
/** A dispatched run closed `done`, its `closedAt` pinned to `closedAt`. */
const closed = (coord: CoordStore, closedAt: number): number => {
  const id = dispatched(coord);
  const program = `runs-page-${n}`;
  expect(coord.closeRun({ runId: id, finalState: 'done', causedBy: 'coordinator', handoffCommit: null, program, viaClosing: true }).ok).toBe(true);
  coord.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run(closedAt, id);
  return id;
};

async function harness(): Promise<{ coord: CoordStore; app: FastifyInstance }> {
  const home = mkTmp('ccrc-runs-page-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(home), coord };
  const bus = new Bus();
  app = await buildServer(deps, bus, new FleetWatcher(deps, bus));
  return { coord, app };
}

const getRuns = async (a: FastifyInstance, url: string): Promise<RunSummary[]> => {
  const res = await a.inject({ method: 'GET', url });
  expect(res.statusCode).toBe(200);
  return (res.json() as { runs: RunSummary[] }).runs;
};

describe('GET /api/runs?closed=1 without limit: every active run and every closed run (console speed S2, step 0)', () => {
  it('answers 3 active and 5 closed runs, ids and order as the store gives them', async () => {
    const h = await harness();
    // Interleave the opens so the answer cannot be "active first, then closed" by accident of id order.
    const ids = { closed: [] as number[], active: [] as number[] };
    ids.closed.push(closed(h.coord, T_OPEN + 1_000));
    ids.active.push(dispatched(h.coord));
    ids.closed.push(closed(h.coord, T_OPEN + 5_000));
    ids.closed.push(closed(h.coord, T_OPEN + 3_000));
    ids.active.push(dispatched(h.coord));
    ids.closed.push(closed(h.coord, T_OPEN + 4_000));
    ids.active.push(dispatched(h.coord));
    ids.closed.push(closed(h.coord, T_OPEN + 2_000));
    const runs = await getRuns(h.app, '/api/runs?closed=1');
    expect(runs).toHaveLength(8);
    // The store orders the whole answer by run id, ascending, active and closed together (`CoordStore.runs`).
    expect(runs.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(runs.filter((r) => r.state === 'done').map((r) => r.id)).toEqual(ids.closed);
    expect(runs.filter((r) => r.state !== 'done').map((r) => r.id)).toEqual(ids.active);
  });

  it('without closed=1 it answers the 3 active runs only', async () => {
    const h = await harness();
    const active = [dispatched(h.coord), dispatched(h.coord), dispatched(h.coord)];
    closed(h.coord, T_OPEN + 1_000);
    closed(h.coord, T_OPEN + 2_000);
    const runs = await getRuns(h.app, '/api/runs');
    expect(runs.map((r) => r.id).sort((a, b) => a - b)).toEqual(active);
  });
});
