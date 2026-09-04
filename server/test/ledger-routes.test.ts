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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { LEDGER_STALE_MS, LEDGER_TITLE_MAX_BYTES } from '../../shared/api.js';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { LedgerLog } from '../src/coord/ledgerlog.js';
import { CoordStore } from '../src/coord/store.js';
import { localIO } from '../src/io.js';
import type { FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };

// `home` is a parameter so a test can plant docs under `<home>/projects/...`
// BEFORE the server is built — the synchronous floor seed reads them
// (wave 2, F2), and `testDeps` sets `cfg.projectsRoot` to exactly that path.
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

/** One plan document under `<home>/projects/<project>/docs/superpowers/plans`,
 *  which is where `cfg.projectsRoot` points for a fixture home. Every `D-` ref
 *  passed in must be spelled SPLIT by the caller — `deviation-refs.test.ts`
 *  runs the real `floorFromScan` over the tracked tree. */
const plantPlan = (home: string, project: string, name: string, text: string): void => {
  const d = path.join(home, 'projects', project, 'docs', 'superpowers', 'plans');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, name), text);
};

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

  it('SEEDS ITSELF on a fresh project and allocates on the first call', async () => {
    // The stall this deletes: before, the first program on every new project
    // waited up to an hour for the sweep, and the coordinator's own pinned
    // contract told it to report and not invent. A project with no live session
    // was never swept at all.
    const home = mkTmp('ccrc-ledger-');
    plantPlan(home, 'fresh', 'p.md', `### ${'D-' + '410'} a real one`);
    const w = await openApp({}, home); app = w.app;
    const res = await alloc(app, { project: 'fresh', count: 3, title: 'block' });
    expect(res.statusCode).toBe(201);
    // floorFromScan owns the gap: 410 + LEDGER_SEED_GAP.
    expect(res.json()).toMatchObject({ ok: true, numbers: [460, 461, 462] });
    // And it PERSISTED — the seed is a write, not a re-measurement per call.
    expect(w.coord.ledgerFloor('fresh')?.floor).toBe(460);
  });

  it('still answers 409 not-seeded when the measurement itself FAILS', async () => {
    // The refusal survives, narrowed. `claims-envelope.test.ts` separately
    // requires the producer literal to stay in coord/routes.ts.
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    const w = await openApp({ io: unlistable }); app = w.app;
    const res = await alloc(app, { project: 'fresh', count: 3, title: 'block' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-seeded' });
    expect((res.json() as { detail: string }).detail).toMatch(/could not be measured/i);
    expect(w.coord.ledgerFloor('fresh')).toBeNull();
  });

  it('answers 409 with a DIFFERENT detail when the docs are read and name no D-ref', async () => {
    // Two conditions, two sentences. Both refuse — there is no floor to seed
    // from either way — but "I could not look" and "I looked and there is
    // nothing" are different facts, and an operator acts on them differently:
    // one is a box to fix, the other is a plan to write.
    const home = mkTmp('ccrc-ledger-');
    plantPlan(home, 'fresh', 'p.md', 'a plan with nothing numbered in it');
    const w = await openApp({}, home); app = w.app;
    const res = await alloc(app, { project: 'fresh', count: 3, title: 'block' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-seeded' });
    const detail = (res.json() as { detail: string }).detail;
    expect(detail).toMatch(/name no |names no /i);
    expect(detail, 'the two not-seeded conditions collapsed into one sentence')
      .not.toMatch(/could not be measured/i);
  });

  it('refuses a bad count FIRST, and never runs a filesystem walk for it', async () => {
    // `decideAllocation` checks bad-count before not-seeded deliberately, and
    // ledger.test.ts pins it. Seeding BEFORE the allocator runs would spend a
    // document walk on a request that could never have been served, and would
    // put a second copy of the count predicate in L4 to avoid it.
    const home = mkTmp('ccrc-ledger-');
    plantPlan(home, 'fresh', 'p.md', `### ${'D-' + '410'} a real one`);
    const reads: string[] = [];
    const io: FleetIO = {
      ...localIO,
      readdir: async (p: string) => { reads.push(p); return localIO.readdir(p); },
    };
    const w = await openApp({ io }, home); app = w.app;
    const res = await alloc(app, { project: 'fresh', count: 0, title: 'block' });
    expect(res.statusCode).toBe(400);
    expect(reads.filter((p) => p.includes('superpowers')),
      'a bad-count request walked the documents').toEqual([]);
    expect(w.coord.ledgerFloor('fresh')).toBeNull();
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

  it('refuses an over-cap title 413 oversize and allocates NOTHING — the log writes it once per number', async () => {
    const w = await openApp(); app = w.app;
    w.coord.raiseLedgerFloor('demo', 261, 'seeded', Date.now());

    // BYTES, not chars: 67 three-byte characters is 201 bytes — over the cap
    // while comfortably under it as a character count, the same char-vs-byte
    // care the mail body cap pins. The multiplier is why the title is the one
    // capped field here: LedgerLog.append repeats it on one line PER allocated
    // number, up to LEDGER_ALLOC_MAX lines from a single box-token request.
    const over = '€'.repeat(Math.floor(LEDGER_TITLE_MAX_BYTES / 3) + 1);
    const res = await alloc(app, { project: 'demo', count: 100, title: over });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ ok: false, error: 'oversize',
      limit: LEDGER_TITLE_MAX_BYTES });

    // The TABLE, not just the response: nothing was minted on the refusal
    // path — the store answers no rows, and the append-only log's file was
    // never even created.
    expect(((await ledger(app, '?project=demo')).json() as { allocations: unknown[] })
      .allocations).toEqual([]);
    expect(existsSync(path.join(w.home, '.ccrc', 'ledger-alloc.log'))).toBe(false);

    // Exactly AT the cap still allocates — the boundary is >, matching the
    // intent cap's arm in POST /api/claims.
    const at = await alloc(app, { project: 'demo', count: 1,
      title: 'x'.repeat(LEDGER_TITLE_MAX_BYTES) });
    expect(at.statusCode).toBe(201);
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
