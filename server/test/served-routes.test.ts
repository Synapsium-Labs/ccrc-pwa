// Console speed S2, per-request reads: the three routes the phone polls (`GET /api/accounts`, `GET /api/projects`,
// `GET /api/fleet`) answer over ONE fixture HOME with NO watcher, so every field comes from the route's own reads.
// This file pins today's status and body shape: later steps add the "fresh watcher state answers with ageMs" cases
// beside these, and the cases here must stay green when they do.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { FleetState } from '../src/fleetstate.js';
import { servedFleetReads, servedProjectReads } from '../src/servedRead.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const now = (): number => Math.floor(Date.now() / 1000);
const WORKDIR = (home: string): string => path.join(home, 'projects', 'project-a');
const ROWS = ['claude-project-a-sess-a', 'claude-project-a-sess-b'] as const;

/** One fixture: a limits file for one account, a project directory, two registry rows on it. */
function fixture(): { home: string } {
  const home = mkTmp('ccrc-served-routes-');
  const limits = path.join(home, '.cc-limits');
  mkdirSync(limits, { recursive: true });
  const t = now();
  writeFileSync(path.join(limits, 'claude.json'),
    JSON.stringify({ five: 12, seven: 34, ts: t - 30, fiveResetAt: t + 3600, sevenResetAt: t + 200000 }));
  const workdir = WORKDIR(home);
  mkdirSync(path.join(workdir, '.git'), { recursive: true });
  writeFileSync(path.join(workdir, 'README'), 'x');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const id of ROWS) {
    const fields: Record<string, string> = {
      wrapper: 'claude', project: 'project-a', workdir, uuid: `u-${id}`, started: '1', workspace: id, branch: `ws/${id}`,
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  }
  return { home };
}

let app: FastifyInstance | null = null;
let watcher: FleetWatcher | null = null;
afterEach(async () => { vi.useRealTimers(); await app?.close(); app = null; watcher?.stop(); watcher = null; });

/** A server over the fixture with no watcher (the third argument of `buildServer` left out). */
async function get(url: string): Promise<{ status: number; body: Record<string, unknown>; home: string }> {
  const f = fixture();
  app = await buildServer(testDeps(f.home));
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, home: f.home };
}

/** A fleet row's keys, as the route sends them today (a field added later is an additive change this list takes). */
const FLEET_ROW_KEYS = [
  'archivedAt', 'archivedBytes', 'ask', 'askSummary', 'background', 'boardProject', 'branch', 'bucket', 'bucketSince',
  'child', 'ctxPct', 'deadSince', 'dialogPending', 'effort', 'graphGateDenials', 'graphQueries', 'held', 'hibernatedAt',
  'home', 'hookState', 'id', 'lastEnd', 'lifecycle', 'limits', 'model', 'name', 'openRun', 'paneCols', 'pr', 'presence',
  'project', 'releasedFrom', 'role', 'route', 'run', 'spawnState', 'started', 'status', 'statusUnmeasured',
  'statusUpdatedAt', 'stoppedBy', 'stranded', 'subagents', 'substrate', 'swapBlocked', 'tasks', 'title', 'ultracode',
  'unmeasured', 'usage', 'version', 'withCoordinator', 'workdir', 'workspace', 'wrapper',
];

describe('served routes with no watcher: today\'s answers (console speed S2, step 0)', () => {
  it('GET /api/accounts: the measured account, the projection and the roster', async () => {
    const r = await get('/api/accounts');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['accounts', 'projected', 'roster']);
    const accounts = r.body.accounts as { wrapper: string; five: number; seven: number }[];
    expect(accounts.map((a) => [a.wrapper, a.five, a.seven])).toEqual([['claude', 12, 34]]);
    expect(Object.keys(accounts[0]!).sort()).toEqual([
      'authDead', 'disabled', 'five', 'fiveResetAt', 'fiveRolledOver', 'seven', 'sevenResetAt', 'sevenRolledOver',
      'ts', 'wrapper',
    ]);
    expect(r.body.projected).toEqual({ wrapper: 'claude', score: 34 });
    const roster = r.body.roster as { id: string }[];
    expect(roster.map((a) => a.id)).toEqual(['claude', 'claude-a', 'claude-b', 'gpt', 'claude-d']);
  });

  it('GET /api/projects: one project from the root, the registry listed, no age field', async () => {
    const r = await get('/api/projects');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['projects', 'registry', 'roots']);
    expect(r.body.registry).toBe('listed');
    expect(r.body.roots).toEqual([path.join(r.home, 'projects')]);
    const projects = r.body.projects as Record<string, unknown>[];
    expect(projects.map((p) => [p.name, p.workdir])).toEqual([['project-a', WORKDIR(r.home)]]);
    expect(Object.keys(projects[0]!).sort()).toEqual(['name', 'placement', 'pool', 'readiness', 'repo', 'workdir']);
    expect(projects[0]).toMatchObject({
      readiness: null, pool: { state: 'untagged' }, placement: { kind: 'projected', wrapper: 'claude', score: 34 },
      repo: { state: 'unmeasured' },
    });
    expect('ageMs' in r.body).toBe(false);
  });

  it('GET /api/fleet: both registry rows, dead and orphaned, and the pools block', async () => {
    const r = await get('/api/fleet');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['pools', 'sessions']);
    const sessions = r.body.sessions as Record<string, unknown>[];
    expect(sessions.map((s) => s.id)).toEqual([...ROWS]);
    for (const s of sessions) {
      expect(Object.keys(s).sort()).toEqual(FLEET_ROW_KEYS);
      expect(s).toMatchObject({
        wrapper: 'claude', project: 'project-a', workdir: WORKDIR(r.home), status: 'dead', lifecycle: 'orphan',
        bucket: 'dead', limits: { five: 12, seven: 34 }, unmeasured: [], started: true,
      });
    }
    expect(r.body.pools).toEqual({
      listed: true, byProject: {}, enforcement: 'unknown', observedEpoch: null, accountPools: 'unknown',
    });
    expect('stale' in r.body).toBe(false);
    expect('ageMs' in r.body).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Step 7, part 2: with a watcher whose last tick is fresh, the three routes answer from it and say how old it is.

interface Req { op: string; path: string }
/** `localIO` with every call logged, so what a route asks the agent link for is the thing measured. */
function countingIO(): { io: FleetIO; requests: Req[]; unlistable: Set<string> } {
  const requests: Req[] = [];
  /** Directories whose listing fails (`readdir` null, `readdirMeasured` unreadable); mutable between requests. */
  const unlistable = new Set<string>();
  const io = { ...localIO } as Record<string, unknown>;
  for (const [op, fn] of Object.entries(localIO)) {
    if (typeof fn !== 'function') continue;
    io[op] = (...args: unknown[]) => {
      const p = String(args[0]);
      requests.push({ op, path: p });
      if (unlistable.has(p) && op === 'readdir') return Promise.resolve(null);
      if (unlistable.has(p) && op === 'readdirMeasured') return Promise.resolve({ ok: false, reason: 'unreadable' });
      return (fn as (...a: unknown[]) => unknown).apply(localIO, args);
    };
  }
  return { io: io as unknown as FleetIO, requests, unlistable };
}

/** A server over the fixture WITH a watcher that has ticked once (`tick: false` leaves it cold). */
async function rig(tick = true): Promise<{ home: string; requests: Req[]; unlistable: Set<string>; registryDir: string; get: (url: string) => Promise<Record<string, unknown>>; w: FleetWatcher }> {
  const f = fixture();
  const c = countingIO();
  const deps = withFakeClock({ ...testDeps(f.home), io: c.io });
  const bus = new Bus();
  const w = new FleetWatcher(deps, bus, 2000);
  watcher = w;
  if (tick) await w.tick();
  app = await buildServer(deps, bus, w);
  const a = app;
  return {
    home: f.home, requests: c.requests, unlistable: c.unlistable, registryDir: deps.cfg.registryDir, w,
    get: async (url) => {
      const res = await a.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      return res.json() as Record<string, unknown>;
    },
  };
}

const ROUTES = ['/api/accounts', '/api/projects', '/api/fleet'] as const;
/** A request that reads what the watcher already measured: the registry, the limits files, the pools directory. */
const measuredReads = (reqs: Req[]): Req[] => reqs.filter((q) => /\.cc-sessions|\.cc-limits/.test(q.path));

describe('served routes with a fresh watcher tick: the answer carries ageMs and asks the agent link nothing (console speed S2, Step 7)', () => {
  for (const url of ROUTES) {
    it(`fresh watcher state answers with ageMs and makes no agent request: ${url}`, async () => {
      const r = await rig();
      // Warm the route's own caches (the projects walk) so the count below is the route's steady state.
      await r.get(url);
      r.requests.length = 0;
      const body = await r.get(url);
      expect(typeof body.ageMs).toBe('number');
      expect(body.ageMs as number).toBeGreaterThanOrEqual(0);
      expect(body.ageMs as number).toBeLessThan(20_000);
      expect(r.requests, `${url} asked the link for something the watcher holds`).toEqual([]);
    });
  }

  it('GET /api/fleet: a served answer has the keys and rows of the read one, plus ageMs', async () => {
    const r = await rig();
    const body = await r.get('/api/fleet');
    expect(Object.keys(body).sort()).toEqual(['ageMs', 'pools', 'sessions']);
    const sessions = body.sessions as Record<string, unknown>[];
    expect(sessions.map((s) => s.id)).toEqual([...ROWS]);
    for (const s of sessions) expect(Object.keys(s).sort()).toEqual(FLEET_ROW_KEYS);
    expect(body.pools).toEqual({ listed: true, byProject: {}, enforcement: 'unknown', observedEpoch: null, accountPools: 'unknown' });
  });

  it('a served /api/fleet drops a landing past its window', async () => {
    const r = await rig();
    const listing = r.w.currentFleetListing()!;
    // The radar's window is `RADAR_PROBE_FRESH_S` (1200 s): one row's landing is older than that, one is fresh.
    const at = (offsetS: number): string => new Date(Date.now() + offsetS * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const [a, b] = listing.sessions;
    const withLanding = [
      { ...a!, landing: { at: at(-1201) } },
      { ...b!, landing: { at: at(-10) } },
    ] as unknown as typeof listing.sessions;
    vi.spyOn(r.w, 'currentFleetListing').mockReturnValue({ ...listing, sessions: withLanding });
    const body = await r.get('/api/fleet');
    expect(typeof body.ageMs, 'this is the served arm').toBe('number');
    const rows = body.sessions as Record<string, unknown>[];
    expect('landing' in rows[0]!, 'the stale landing is dropped').toBe(false);
    expect('landing' in rows[1]!, 'the fresh landing is carried').toBe(true);
  });

  it('GET /api/accounts: a served answer has the keys and the account of the read one, plus ageMs', async () => {
    const r = await rig();
    const body = await r.get('/api/accounts');
    expect(Object.keys(body).sort()).toEqual(['accounts', 'ageMs', 'projected', 'roster']);
    expect((body.accounts as { wrapper: string; five: number; seven: number }[]).map((a) => [a.wrapper, a.five, a.seven])).toEqual([['claude', 12, 34]]);
    expect(body.projected).toEqual({ wrapper: 'claude', score: 34 });
  });

  it('GET /api/projects: a served answer has the project and its placement of the read one, plus ageMs', async () => {
    const r = await rig();
    const body = await r.get('/api/projects');
    expect(Object.keys(body).sort()).toEqual(['ageMs', 'projects', 'registry', 'roots']);
    const projects = body.projects as Record<string, unknown>[];
    expect(projects.map((p) => p.name)).toEqual(['project-a']);
    expect(projects[0]).toMatchObject({ pool: { state: 'untagged' }, placement: { kind: 'projected', wrapper: 'claude', score: 34 } });
  });

  it('GET /api/fleet: a fresh listing with no pools read beside it is not served, and reads as today', async () => {
    const r = await rig();
    vi.spyOn(r.w, 'currentProjectPoolsRead').mockReturnValue(null);
    r.requests.length = 0;
    const body = await r.get('/api/fleet');
    expect('ageMs' in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual(['pools', 'sessions']);
    expect(measuredReads(r.requests).length, 'the route read the registry itself').toBeGreaterThan(0);
  });

  it('GET /api/fleet: a remote link that is down, with no snapshot, is not served (fix round 1, F3)', async () => {
    const f = fixture();
    const c = countingIO();
    const base = testDeps(f.home);
    const link = { connected: true, downSince: null as number | null };
    // The snapshot path is the fixture's, never the default under the real home: "no snapshot" is this case's premise.
    const stateCachePath = path.join(f.home, '.ccrc', 'state-cache.json');
    const deps = withFakeClock({ ...base, io: c.io, cfg: { ...base.cfg, fleetMode: 'remote' as const }, fleetState: link as unknown as FleetState, stateCachePath });
    const bus = new Bus();
    const w = new FleetWatcher(deps, bus, 2000);
    watcher = w;
    await w.tick();
    app = await buildServer(deps, bus, w);
    const get = async (): Promise<Record<string, unknown>> => (await app!.inject({ method: 'GET', url: '/api/fleet' })).json() as Record<string, unknown>;
    expect(typeof (await get()).ageMs, 'control: the link up, the tick is served').toBe('number');
    rmSync(stateCachePath, { force: true });
    link.connected = false; link.downSince = Date.now();
    c.requests.length = 0;
    const body = await get();
    expect('ageMs' in body, 'the served arm declines while the link is down').toBe(false);
    expect(measuredReads(c.requests).length, 'the route read the registry itself, as the base did').toBeGreaterThan(0);
  });

  it('GET /api/projects: the ?class= validation still runs first', async () => {
    const r = await rig();
    r.requests.length = 0;
    const res = await app!.inject({ method: 'GET', url: '/api/projects?class=nonsense' });
    expect(res.statusCode).toBe(400);
    expect(r.requests.length).toBe(0);
  });
});

describe('served routes with stale or missing watcher state answer as today (console speed S2, Step 7)', () => {
  for (const url of ROUTES) {
    it(`stale or missing state answers as today, no ageMs: ${url}`, async () => {
      // Missing: a watcher that has not ticked.
      const cold = await rig(false);
      const missing = await cold.get(url);
      expect('ageMs' in missing).toBe(false);
      expect(measuredReads(cold.requests).length, 'a cold watcher leaves the route to read for itself').toBeGreaterThan(0);
      await app!.close(); app = null; watcher?.stop(); watcher = null;
      // Stale: a watcher whose last tick is a minute old.
      vi.useFakeTimers({ toFake: ['Date'] });
      const warm = await rig();
      vi.setSystemTime(Date.now() + 60_000);
      warm.requests.length = 0;
      const stale = await warm.get(url);
      expect('ageMs' in stale).toBe(false);
      expect(measuredReads(warm.requests).length, 'a stale tick is read again').toBeGreaterThan(0);
      // The same keys the no-watcher route sends today.
      expect(Object.keys(stale).sort()).toEqual(Object.keys(missing).sort());
    });
  }
});

describe('an unlistable tick (every watcher getter null) stops the routes serving (console speed S2, Step 7)', () => {
  it('GET /api/accounts, /api/projects and /api/fleet read for themselves and carry no ageMs', async () => {
    const r = await rig();
    expect(typeof (await r.get('/api/accounts')).ageMs, 'control: served before').toBe('number');
    r.unlistable.add(r.registryDir);
    await r.w.tick();
    expect(r.w.currentLimits()).toBeNull();
    expect(r.w.currentProjectPoolsRead()).toBeNull();
    expect(r.w.currentFleetListing()).toBeNull();
    r.requests.length = 0;
    const accounts = await r.get('/api/accounts');
    expect('ageMs' in accounts).toBe(false);
    expect((accounts.accounts as { wrapper: string }[]).map((a) => a.wrapper)).toEqual(['claude']);
    expect(r.requests.some((q) => /\.cc-limits/.test(q.path)), 'accounts read the limits itself').toBe(true);
    r.requests.length = 0;
    const projects = await r.get('/api/projects');
    expect('ageMs' in projects).toBe(false);
    expect(r.requests.some((q) => /\.cc-limits/.test(q.path)), 'projects read the limits itself').toBe(true);
    const fleet = await r.get('/api/fleet');
    expect('ageMs' in fleet).toBe(false);
    expect(fleet.stale, 'an unlistable registry reads as stale, as before').toBe(true);
  });
});

describe('the serve deciders (console speed S2, Step 7)', () => {
  const T = 1_000_000;
  it('servedProjectReads: both fresh serve with the larger age; one stale or missing serves nothing', () => {
    const pools = { listedAt: T - 3_000 };
    const limits = { listedAt: T - 8_000 };
    expect(servedProjectReads(pools, limits, T, 20_000)).toEqual({ serve: true, pools, limits, ageMs: 8_000 });
    expect(servedProjectReads(pools, { listedAt: T - 20_000 }, T, 20_000)).toEqual({ serve: false });
    expect(servedProjectReads(null, limits, T, 20_000)).toEqual({ serve: false });
    expect(servedProjectReads(pools, null, T, 20_000)).toEqual({ serve: false });
  });

  it('servedFleetReads: the listing and the pools read serve together with the larger age, or not at all', () => {
    const listing = { listedAt: T - 9_000, sessions: [] as string[] };
    const poolsRead = { listedAt: T - 2_000 };
    expect(servedFleetReads(listing, poolsRead, T, 20_000)).toEqual({ serve: true, listing, ageMs: 9_000 });
    expect(servedFleetReads(listing, { listedAt: T - 30_000 }, T, 20_000)).toEqual({ serve: false });
    expect(servedFleetReads({ ...listing, listedAt: T - 30_000 }, poolsRead, T, 20_000)).toEqual({ serve: false });
    expect(servedFleetReads(listing, null, T, 20_000), 'no pools read').toEqual({ serve: false });
    expect(servedFleetReads(null, poolsRead, T, 20_000), 'no listing').toEqual({ serve: false });
  });
});
