// The allocator's door is RETIRED (docs/superpowers/plans/2026-11-23-deviation-numbers-self-assigned-pr1.md):
// POST /api/ledger/deviations keeps its box-token check and answers 410, writing nothing.
// GET /api/ledger (a read of history) is unchanged. The store's allocation is
// ledger-race.test.ts's and ledger-store.test.ts's.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { LEDGER_STALE_MS } from '../../shared/api.js';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { LedgerLog } from '../src/coord/ledgerlog.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };

const openApp = async (over: Partial<Deps> = {}, home: string = mkTmp('ccrc-ledger-')) => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord, ...over });
  return { app, coord, home };
};

const alloc = (app: FastifyInstance, body: Record<string, unknown>,
               headers: Record<string, string> = tok) =>
  app.inject({ method: 'POST', url: '/api/ledger/deviations', headers, payload: body });
const ledger = (app: FastifyInstance, qs: string, headers: Record<string, string> = tok) =>
  app.inject({ method: 'GET', url: `/api/ledger${qs}`, headers });

describe('the ledger routes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const seeded = async () => {
    const w = await openApp(); app = w.app;
    w.coord.raiseLedgerFloor('demo', 261, 'seeded', Date.now());
    w.coord.allocateDeviations({ project: 'demo', count: 2, title: 'block A',
      allocatedTo: 'demo-coordinator', runId: null, now: Date.now() },
      new LedgerLog(path.join(w.home, '.ccrc', 'ledger-alloc.log')));
    return w;
  };

  it('POST answers 410 retired with the next-deviation pointer, and writes nothing', async () => {
    const w = await seeded();
    const before = (await ledger(app!, '?project=demo')).json();
    const logPath = path.join(w.home, '.ccrc', 'ledger-alloc.log');
    const logBefore = existsSync(logPath);
    const res = await alloc(app!, { project: 'demo', count: 3, title: 'block', byId: 'demo-coordinator' });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ ok: false, error: 'retired',
      detail: 'deviation numbers are self-assigned: the highest D-N defined on main and your branch, plus one, from 10000 (ccrc: cd server && npm run next-deviation)' });
    expect((res.json() as { detail: string }).detail).toContain('next-deviation');
    expect((await ledger(app!, '?project=demo')).json()).toEqual(before);
    expect(existsSync(logPath)).toBe(logBefore);
    // An unseeded project is not seeded by the call either.
    expect((await alloc(app!, { project: 'fresh', count: 1, title: 'x' })).statusCode).toBe(410);
    expect(w.coord.ledgerFloor('fresh')).toBeNull();
  });

  it('POST still fails shut without the box token (401 before 410)', async () => {
    await openApp().then((w) => { app = w.app; });
    expect((await alloc(app!, { project: 'demo', count: 1, title: 'x' }, {})).statusCode).toBe(401);
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
    w.coord.raiseLedgerFloor('demo', 261, 'seeded', Date.now());
    const log = new LedgerLog(path.join(w.home, '.ccrc', 'ledger-alloc.log'));
    const old = w.coord.allocateDeviations({ project: 'demo', count: 1, title: 'gone cold',
      allocatedTo: 'demo-coordinator', runId: null,
      now: Date.now() - LEDGER_STALE_MS - 60_000 }, log);
    const fresh = w.coord.allocateDeviations({ project: 'demo', count: 1, title: 'fresh block',
      allocatedTo: '', runId: null, now: Date.now() }, log);
    expect(old.ok && fresh.ok).toBe(true);

    const body = (await ledger(app, '?project=demo')).json() as
      { allocations: { n: number; stale: boolean }[] };
    expect(body.allocations).toMatchObject([
      { n: 261, state: 'allocated', stale: true },
      { n: 262, state: 'allocated', stale: false },
    ]);
  });
});
