// The allocator's door is REMOVED (docs/superpowers/plans/2026-11-24-deviation-allocator-removal-pr2.md):
// POST /api/ledger/deviations answers 404. GET /api/ledger (a read of history, and the box-token proof door of
// ccrc-token-sync) is unchanged. Nothing writes the two ledger tables any more (the allocator's store, log, seed
// and sweeps are gone too), so the fixtures below plant rows the way an old build left them.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { LEDGER_STALE_MS } from '../../shared/api.js';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };

const openApp = async (over: Partial<Deps> = {}, home: string = mkTmp('ccrc-ledger-')) => {
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord, ...over });
  /** A floor row and allocated rows as the retired allocator left them. */
  const plant = (project: string, floor: number, rows: { n: number; title: string; allocatedTo: string; at: number }[]) => {
    db.prepare('INSERT INTO ledger_floor (project, floor, evidence, updatedAt) VALUES (?, ?, ?, ?)')
      .run(project, floor, 'seeded', Date.now());
    for (const r of rows) {
      db.prepare('INSERT INTO ledger_alloc (project, n, title, allocatedTo, runId, allocatedAt, state) ' +
        "VALUES (?, ?, ?, ?, NULL, ?, 'allocated')").run(project, r.n, r.title, r.allocatedTo, r.at);
    }
  };
  return { app, coord, home, plant };
};

const ledger = (app: FastifyInstance, qs: string, headers: Record<string, string> = tok) =>
  app.inject({ method: 'GET', url: `/api/ledger${qs}`, headers });

describe('the ledger routes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const seeded = async () => {
    const w = await openApp(); app = w.app;
    w.plant('demo', 261, [261, 262].map((n) => ({ n, title: 'block A', allocatedTo: 'demo-coordinator', at: Date.now() })));
    return w;
  };

  it('POST /api/ledger/deviations is gone: 404 with and without the box token', async () => {
    await seeded();
    for (const headers of [tok, {}]) {
      const res = await app!.inject({ method: 'POST', url: '/api/ledger/deviations', headers,
        payload: { project: 'demo', count: 1, title: 'x' } });
      expect(res.statusCode).toBe(404);
    }
  });

  it('GET still fails shut without the box token', async () => {
    await openApp().then((w) => { app = w.app; });
    expect((await ledger(app!, '?project=demo', {})).statusCode).toBe(401);
  });

  it('GET /api/ledger answers the floor and the allocations, per project, and 400s without one', async () => {
    await seeded();
    const res = await ledger(app!, '?project=demo');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { floor: number; allocations: { n: number; title: string;
      allocatedTo: string; state: string; stale: boolean }[] };
    expect(body.floor).toBe(263);
    expect(body.allocations.map((a) => a.n)).toEqual([261, 262]);
    expect(body.allocations[0]).toMatchObject({ title: 'block A', allocatedTo: 'demo-coordinator',
      state: 'allocated', stale: false });

    expect((await ledger(app!, '')).statusCode).toBe(400);
    // An unseeded project answers null, not 0 — 0 is a floor, not an absence.
    expect(((await ledger(app!, '?project=other')).json() as { floor: number | null }).floor)
      .toBeNull();
  });

  it('derives stale per row from this read\'s clock — an allocation older than LEDGER_STALE_MS answers true', async () => {
    const w = await openApp(); app = w.app;
    w.plant('demo', 261, [
      { n: 261, title: 'gone cold', allocatedTo: 'demo-coordinator', at: Date.now() - LEDGER_STALE_MS - 60_000 },
      { n: 262, title: 'fresh block', allocatedTo: '', at: Date.now() },
    ]);

    const body = (await ledger(app, '?project=demo')).json() as
      { allocations: { n: number; stale: boolean }[] };
    expect(body.allocations).toMatchObject([
      { n: 261, state: 'allocated', stale: true },
      { n: 262, state: 'allocated', stale: false },
    ]);
  });
});
