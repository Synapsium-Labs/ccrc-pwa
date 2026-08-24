// The allocator's door (build 9 D13): self-seeds by sweep, then fails shut —
// `409 not-seeded` is openCoordDb's "refuse to start rather than open empty"
// rule, one level up. The race (20 concurrent, 20 distinct contiguous) is
// ledger-race.test.ts's; this file owns the HTTP contract.
//
// Landed-spelling adaptations (plan governance: the defining task's landed
// shape wins, this task's semantics stay binding): the floor seeds through
// `raiseLedgerFloor` (the plan drafted `recordLedgerFloor`); rows spell
// `allocatedTo` (the plan drafted `byId` — the wire body keeps `byId?`, the
// route maps it); and the wire `floor` is the NEXT FREE number, DERIVED by
// the route — the landed `AllocatedBlock.floor` carries the seeded floor,
// which allocation never moves.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
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

const openApp = async (over: Partial<Deps> = {}) => {
  const home = mkTmp('ccrc-ledger-');
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

  it('refuses 409 not-seeded before the floor sweep has scanned the project — never mints from a guess', async () => {
    const w = await openApp(); app = w.app;
    const res = await alloc(app, { project: 'demo', count: 2, title: 'build9b wave 7 block' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-seeded' });
    // NOTHING was allocated on the refusal path.
    expect(((await ledger(app, '?project=demo')).json() as { allocations: unknown[] })
      .allocations).toEqual([]);
  });

  it('allocates a contiguous block once seeded, 201, and the floor moves past it', async () => {
    const w = await openApp(); app = w.app;
    // What sweepLedgerFloor writes: max(D-<n>) + LEDGER_SEED_GAP, evidence named.
    w.coord.raiseLedgerFloor('demo', 261, 'plans/2026-08-23-x.md D-211 + 50', Date.now());

    const res = await alloc(app, { project: 'demo', count: 3,
      title: 'build9b wave 7 block', byId: 'demo-coordinator' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, numbers: [261, 262, 263], floor: 264 });

    const next = await alloc(app, { project: 'demo', count: 1, title: 'a straggler' });
    expect(next.statusCode).toBe(201);
    expect(next.json()).toEqual({ ok: true, numbers: [264], floor: 265 });

    // The flat-file half of MAX(file, db) landed IN THE FIXTURE HOME — the
    // route's one LedgerLog is rooted at cfg.home, so a test server can never
    // append to the live home's ledger. A route holding
    // defaultLedgerLogPath() with no home reds this by writing elsewhere.
    const log = readFileSync(path.join(w.home, '.ccrc', 'ledger-alloc.log'), 'utf8');
    expect(log).toContain('"n":261');
    expect(log).toContain('"n":264');
  });

  it('GET /api/ledger answers the floor and the allocations, per project, and 400s without one', async () => {
    const w = await openApp(); app = w.app;
    w.coord.raiseLedgerFloor('demo', 261, 'seeded', Date.now());
    await alloc(app, { project: 'demo', count: 2, title: 'block A', byId: 'demo-coordinator' });

    const res = await ledger(app, '?project=demo');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { floor: number; allocations: { n: number; title: string;
      allocatedTo: string; state: string; stale: boolean }[] };
    expect(body.floor).toBe(263);
    expect(body.allocations.map((a) => a.n)).toEqual([261, 262]);
    expect(body.allocations[0]).toMatchObject({ title: 'block A', allocatedTo: 'demo-coordinator',
      state: 'allocated', stale: false });

    expect((await ledger(app, '')).statusCode).toBe(400);
    // An unseeded project answers null, not 0 — 0 is a floor, not an absence.
    expect(((await ledger(app, '?project=other')).json() as { floor: number | null }).floor)
      .toBeNull();
  });

  it('derives stale per row from this read\'s clock — an allocation older than LEDGER_STALE_MS answers true', async () => {
    const w = await openApp(); app = w.app;
    w.coord.raiseLedgerFloor('demo', 261, 'seeded', Date.now());
    // Backdated through the store (the route stamps its own Date.now()), into
    // the SAME fixture-homed log the route appends to — n 261, a week-and-a-
    // minute cold, still state 'allocated'.
    const r = w.coord.allocateDeviations({ project: 'demo', count: 1, title: 'gone cold',
      allocatedTo: 'demo-coordinator', runId: null,
      now: Date.now() - LEDGER_STALE_MS - 60_000 },
      new LedgerLog(path.join(w.home, '.ccrc', 'ledger-alloc.log')));
    expect(r.ok).toBe(true);
    await alloc(app, { project: 'demo', count: 1, title: 'fresh block' });

    const body = (await ledger(app, '?project=demo')).json() as
      { allocations: { n: number; stale: boolean }[] };
    // DERIVED, not stored: the cold row answers true, the fresh row false —
    // a route hardcoding either constant reds one of the two.
    expect(body.allocations).toMatchObject([
      { n: 261, state: 'allocated', stale: true },
      { n: 262, state: 'allocated', stale: false },
    ]);
  });

  it('validates the body, and both routes fail shut without the box token', async () => {
    const w = await openApp(); app = w.app;
    w.coord.raiseLedgerFloor('demo', 261, 'seeded', Date.now());
    for (const body of [
      {}, { project: 'demo', count: 0, title: 'x' }, { project: 'demo', count: 1.5, title: 'x' },
      { project: 'demo', count: 501, title: 'x' }, { project: 'demo', count: 1, title: '' },
      { project: '', count: 1, title: 'x' }, { project: 'demo', count: 1, title: 'x', byId: 7 },
    ]) {
      expect((await alloc(app, body as Record<string, unknown>)).statusCode,
        JSON.stringify(body)).toBe(400);
    }
    expect((await alloc(app, { project: 'demo', count: 1, title: 'x' }, {})).statusCode).toBe(401);
    expect((await ledger(app, '?project=demo', {})).statusCode).toBe(401);
  });
});
