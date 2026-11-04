// Console speed S2, per-request reads: `GET /api/runs?closed=1` WITHOUT `limit` answers every active run and every
// closed run, in the order the store gives them. This file pins that unpaged answer over a fixture CoordStore (3
// active runs, 5 closed ones); later steps add the paging cases beside it, and these must stay green when they do.
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { ChildReclaimAttention, CoordStatus, RunSummary } from '../../shared/api.js';
import { reclaimAttentionRunIds } from '../src/coord/runsPage.js';
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

async function harness(): Promise<{ coord: CoordStore; app: FastifyInstance; watcher: FleetWatcher }> {
  const home = mkTmp('ccrc-runs-page-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(home), coord };
  const bus = new Bus();
  const watcher = new FleetWatcher(deps, bus);
  app = await buildServer(deps, bus, watcher);
  return { coord, app, watcher };
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

// ---- Step 3: the archive pages (`limit`, `before`) --------------------------------------------------------------------
type Page = { runs: RunSummary[]; nextBefore?: number };
const getPage = async (a: FastifyInstance, url: string): Promise<Page> => {
  const res = await a.inject({ method: 'GET', url });
  expect(res.statusCode).toBe(200);
  return res.json() as Page;
};
const ids = (runs: RunSummary[]): number[] => runs.map((r) => r.id);
const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

/** 3 active runs (ids 1-3), then 120 closed ones (ids 4-123). */
const seedArchive = (coord: CoordStore): void => {
  for (let i = 0; i < 3; i += 1) dispatched(coord);
  for (let i = 0; i < 120; i += 1) closed(coord, T_OPEN + i * 1_000);
};

describe('GET /api/runs?closed=1&limit=&before= pages the archive (console speed S2, step 3)', () => {
  // Seeding 123 runs through the store's own verbs is slow, and no case here writes: one fixture serves them all. It is
  // kept out of the module's `app`, which `afterEach` closes after every case.
  let shared: { coord: CoordStore; app: FastifyInstance; watcher: FleetWatcher };
  beforeAll(async () => {
    shared = await harness();
    app = null;
    seedArchive(shared.coord);
  }, 600_000);
  afterAll(async () => { await shared?.app.close(); });
  const fixture = async () => shared;

  it('no limit is today\'s answer', async () => {
    const h = await fixture();
    const page = await getPage(h.app, '/api/runs?closed=1');
    expect(ids(page.runs)).toEqual(range(1, 123));
    expect('nextBefore' in page).toBe(false);
  });

  it('limit 50 returns every active run and the newest 50 closed', async () => {
    const h = await fixture();
    const page = await getPage(h.app, '/api/runs?closed=1&limit=50');
    expect(ids(page.runs)).toEqual([1, 2, 3, ...range(74, 123)]);
    expect(page.nextBefore).toBe(74);
  });

  it('before pages strictly older', async () => {
    const h = await fixture();
    const second = await getPage(h.app, '/api/runs?closed=1&limit=50&before=74');
    // Every active run rides every page, and the closed ones are 24..73: nothing at or above `before`.
    expect(ids(second.runs)).toEqual([1, 2, 3, ...range(24, 73)]);
    expect(second.nextBefore).toBe(24);
    const third = await getPage(h.app, `/api/runs?closed=1&limit=50&before=${second.nextBefore}`);
    expect(ids(third.runs)).toEqual([1, 2, 3, ...range(4, 23)]);
  });

  it('a pinned closed run older than the page is included', async () => {
    const h = await fixture();
    const attention: ChildReclaimAttention[] = [
      { kind: 'kept', sessionId: 'project-a-sess-4', runId: 4, word: 'refused', sentence: 'kept' } as unknown as ChildReclaimAttention,
      { kind: 'kept-many', word: 'refused', sentence: 'two', members: [{ sessionId: 'project-a-sess-9', runId: 9 }] } as unknown as ChildReclaimAttention,
    ];
    vi.spyOn(h.watcher, 'currentCoord').mockReturnValue({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: attention } as unknown as CoordStatus);
    const first = await getPage(h.app, '/api/runs?closed=1&limit=50');
    expect(ids(first.runs)).toEqual([1, 2, 3, 4, 9, ...range(74, 123)]);
    // The pinned extras never move the cursor: it is still the smallest id of the 50 page rows.
    expect(first.nextBefore).toBe(74);
    // Pinned runs ride a `before` page too (4 and 9 are older than this page's 24..73).
    // A pinned run the page already holds is not listed twice:
    const second = await getPage(h.app, '/api/runs?closed=1&limit=50&before=74');
    expect(ids(second.runs)).toEqual([1, 2, 3, 4, 9, ...range(24, 73)]);
  });

  it('nextBefore is absent on the last page', async () => {
    const h = await fixture();
    const last = await getPage(h.app, '/api/runs?closed=1&limit=50&before=24');
    expect('nextBefore' in last).toBe(false);
    // Exactly `limit` terminal runs remain: that is the last page too, and no older run is promised.
    const exact = await getPage(h.app, '/api/runs?closed=1&limit=20&before=24');
    expect(ids(exact.runs)).toEqual([1, 2, 3, ...range(4, 23)]);
    expect('nextBefore' in exact).toBe(false);
    // One short of the remainder promises exactly the one older run.
    const short = await getPage(h.app, '/api/runs?closed=1&limit=19&before=24');
    expect(short.nextBefore).toBe(5);
  });

  it('limit 0, 501, -1 and a non-integer before are 400', async () => {
    const h = await fixture();
    for (const url of [
      '/api/runs?closed=1&limit=0', '/api/runs?closed=1&limit=501', '/api/runs?closed=1&limit=-1', '/api/runs?closed=1&limit=1.5',
      '/api/runs?closed=1&limit=abc', '/api/runs?closed=1&limit=',
      '/api/runs?closed=1&limit=10&before=0', '/api/runs?closed=1&limit=10&before=-3', '/api/runs?closed=1&limit=10&before=1.5',
      '/api/runs?closed=1&limit=10&before=abc', '/api/runs?closed=1&before=10',
      '/api/runs?limit=10', '/api/runs?limit=10&before=10',
    ]) {
      const res = await h.app.inject({ method: 'GET', url });
      expect({ url, status: res.statusCode }).toEqual({ url, status: 400 });
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
    // The bounds themselves are accepted.
    expect((await h.app.inject({ method: 'GET', url: '/api/runs?closed=1&limit=1' })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/api/runs?closed=1&limit=500' })).statusCode).toBe(200);
  });
});

describe('reclaimAttentionRunIds', () => {
  it('collects every number runId and member run, once, and none for null', () => {
    const items = [
      { kind: 'terminal', sessionId: 's', runId: 7, token: 't', sentence: 'x', at: 1 },
      { kind: 'failing', sessionId: 's', runId: null, token: 't', sentence: 'x', at: 1 },
      { kind: 'kept', sessionId: 's', runId: 7, word: 'refused', sentence: 'x' },
      { kind: 'kept-many', word: 'refused', sentence: 'x', members: [{ sessionId: 's', runId: 8 }, { sessionId: 's', runId: 9 }] },
      { kind: 'collect', sessionId: 's', runId: 11, word: 'w', sentence: 'x' },
    ] as unknown as ChildReclaimAttention[];
    expect(reclaimAttentionRunIds(items).sort((a, b) => a - b)).toEqual([7, 8, 9, 11]);
    expect(reclaimAttentionRunIds(undefined)).toEqual([]);
    expect(reclaimAttentionRunIds([])).toEqual([]);
  });
});
