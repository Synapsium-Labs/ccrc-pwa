import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { saveSnapshot, type FleetState } from '../src/fleetstate.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { DEFAULT_TEST_ROSTER, seedRoster, testDeps } from './helpers.js';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { bodyDigest } from '../../shared/mark.mjs';
import type { FleetSession } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';
import { genFile } from './lifecycleHelpers.js';
import { LC_ACT_UNKNOWN, LC_DIR_NAME, LIFECYCLE_ACTS } from '../../shared/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const deadRunner: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

/** Deps in remote mode against a throwaway fixture home. */
function remoteDeps(
  env: Record<string, string> = {},
  fleetState?: FleetState,
  stateCachePath?: string,
): Deps {
  const home = mkTmp('ccrc-');
  seedRoster(home);
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote', ...env });
  return { cfg, runCcd: ccdRunner(deadRunner, cfg), tmux: new Tmux(deadRunner), io: localIO, fleetState, stateCachePath, queue: new KeyedQueue() };
}

// A COMPLETE FleetSession — the fixture was eight fields short of the type it
// claims (server/tsconfig.json does not include test/, so nothing said so).
const session = (id: string): FleetSession => ({
  id, wrapper: 'claude', home: '/home/rc', project: id, workdir: `/data/projects/${id}`,
  workspace: null, name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null,
  started: true, spawnState: null,
});

/** The digest the SERVER computes for its own roster — derived through the
 *  same two functions the route uses, never transcribed, so a change to either
 *  moves both sides together instead of turning this into a pin on a stale
 *  constant. */
const OWN_FP = bodyDigest(generateAccountsSh(parseRoster(DEFAULT_TEST_ROSTER)));

describe('GET /api/fleet/health', () => {
  it('local mode reports connected with no downSince, regardless of fleetState', async () => {
    const app = await buildServer(testDeps());
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
    expect(res.statusCode).toBe(200);
    // `roster: 'unknown'` and not `'agreed'` — local mode drives ccd off this
    // same roster, so there is nothing to compare and nothing was compared.
    expect(res.json()).toEqual({ mode: 'local', connected: true, downSince: null, roster: 'unknown', build: 'unknown' });
    await app.close();
  });

  it('remote mode + connected fleetState reports connected', async () => {
    const app = await buildServer(remoteDeps({}, { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null }));
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
    expect(res.json()).toEqual({ mode: 'remote', connected: true, downSince: null, roster: 'unknown', build: 'unknown' });
    await app.close();
  });

  it('remote mode + disconnected fleetState surfaces connected:false and downSince', async () => {
    const app = await buildServer(remoteDeps({}, { connected: false, downSince: 1700000000000, ccdVerbs: null, rosterFp: null, build: null }));
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
    expect(res.json()).toEqual({ mode: 'remote', connected: false, downSince: 1700000000000, roster: 'unknown', build: 'unknown' });
    await app.close();
  });

  it("agrees when the fleet host's installed projection digests to the same value", async () => {
    const app = await buildServer(remoteDeps({}, { connected: true, downSince: null, ccdVerbs: null, rosterFp: OWN_FP, build: null }));
    expect((await app.inject({ method: 'GET', url: '/api/fleet/health' })).json())
      .toMatchObject({ roster: 'agreed' });
    await app.close();
  });

  it('reports divergent when the fleet host is running a different account list', async () => {
    // The failure this whole path exists for: the link is UP and healthy, so
    // nothing else on the dashboard is wrong, while the two boxes disagree
    // about which accounts exist — sessions attributed to the wrong account, a
    // swap target ccd rejects, and no error anywhere naming the cause.
    const app = await buildServer(remoteDeps({}, {
      connected: true, downSince: null, ccdVerbs: null, rosterFp: 'deadbeef'.repeat(8), build: null,
    }));
    expect((await app.inject({ method: 'GET', url: '/api/fleet/health' })).json())
      .toMatchObject({ mode: 'remote', connected: true, roster: 'divergent' });
    await app.close();
  });

  it('a fleet host that reports no digest is unknown, never divergent', async () => {
    // An agent older than this field, or one whose box has no readable
    // projection. Absence of evidence must not render as evidence of absence:
    // a divergence banner on every older agent is a banner nobody reads.
    const app = await buildServer(remoteDeps({}, { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null }));
    expect((await app.inject({ method: 'GET', url: '/api/fleet/health' })).json())
      .toMatchObject({ roster: 'unknown' });
    await app.close();
  });
});

describe('GET /api/fleet — degraded mode', () => {
  it('serves the cached snapshot with stale:true + downSince when disconnected', async () => {
    const dir = mkTmp('ccrc-cache-');
    const cachePath = path.join(dir, 'state-cache.json');
    const cachedSessions = [session('claude-Cached')];
    await saveSnapshot(cachedSessions, cachePath);

    const deps = remoteDeps({}, { connected: false, downSince: 1700000000000, ccdVerbs: null, rosterFp: null, build: null }, cachePath);
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessions: cachedSessions, stale: true, downSince: 1700000000000 });
    await app.close();
  });

  it('falls back to a live assemble (no stale flag) when disconnected but no cache exists yet', async () => {
    const dir = mkTmp('ccrc-cache-');
    const cachePath = path.join(dir, 'never-written.json');
    const deps = remoteDeps({}, { connected: false, downSince: Date.now(), ccdVerbs: null, rosterFp: null, build: null }, cachePath);
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.json()).toEqual({ sessions: [] });
    await app.close();
  });

  it('serves a cache written by an OLDER build with pr/archivedAt/tasks as null', async () => {
    // The whole point of the degraded route is that this file survives a server
    // upgrade. What it serves is what the PWA renders, and `archivedAt: undefined`
    // on the wire is `archivedAt !== null` — every workspace reads as archived.
    const dir = mkTmp('ccrc-cache-');
    const cachePath = path.join(dir, 'state-cache.json');
    writeFileSync(cachePath, JSON.stringify({
      savedAt: 1785300000001,
      sessions: [{
        id: 'claude-Cached', wrapper: 'claude', home: '/home/rc', project: 'claude-Cached',
        workdir: '/data/projects/claude-Cached', workspace: null, name: null, status: 'idle',
        statusUpdatedAt: null, limits: null, dialogPending: false, version: null,
        model: null, effort: null, ultracode: false, branch: null,
      }],
    }));

    const deps = remoteDeps({}, { connected: false, downSince: 1700000000000, ccdVerbs: null, rosterFp: null, build: null }, cachePath);
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    const body = res.json() as { sessions: FleetSession[]; stale: boolean; downSince: number };
    // Task 5's own additions predate this cache too — same degrade-to-null as
    // pr/archivedAt/tasks, and `session('claude-Cached')` below already
    // expects them null, so this is the explicit form of that same claim.
    expect(body.sessions[0]?.hookState).toBeNull();
    expect(body.sessions[0]?.askSummary).toBeNull();
    expect(body.sessions[0]?.subagents).toBeNull();
    expect(body).toEqual({
      sessions: [session('claude-Cached')],
      stale: true,
      downSince: 1700000000000,
    });
    await app.close();
  });

  it('ignores the cache and assembles live when connected', async () => {
    const dir = mkTmp('ccrc-cache-');
    const cachePath = path.join(dir, 'state-cache.json');
    await saveSnapshot([session('claude-Stale')], cachePath);

    const deps = remoteDeps({}, { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null }, cachePath);
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.json()).toEqual({ sessions: [] });
    await app.close();
  });
});

describe('POST /api/fleet/reboot', () => {
  it('409s when the fleet is local', async () => {
    const app = await buildServer(testDeps());
    const res = await app.inject({ method: 'POST', url: '/api/fleet/reboot' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-remote' });
    await app.close();
  });

  it('501s in remote mode with no Hetzner token/server id configured', async () => {
    const app = await buildServer(remoteDeps({}, { connected: false, downSince: 1, ccdVerbs: null, rosterFp: null, build: null }));
    const res = await app.inject({ method: 'POST', url: '/api/fleet/reboot' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
    await app.close();
  });

  it('202s and POSTs the Hetzner reboot action when configured and the API accepts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(
      remoteDeps(
        { CCRC_HETZNER_TOKEN: 'hetzner-secret', CCRC_FLEET_SERVER_ID: '12345' },
        { connected: false, downSince: 1, ccdVerbs: null, rosterFp: null, build: null },
      ),
    );
    const res = await app.inject({ method: 'POST', url: '/api/fleet/reboot' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.hetzner.cloud/v1/servers/12345/actions/reboot');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer hetzner-secret');
    await app.close();
  });

  it('502s when the Hetzner API rejects the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(
      remoteDeps(
        { CCRC_HETZNER_TOKEN: 'bad-token', CCRC_FLEET_SERVER_ID: '12345' },
        { connected: false, downSince: 1, ccdVerbs: null, rosterFp: null, build: null },
      ),
    );
    const res = await app.inject({ method: 'POST', url: '/api/fleet/reboot' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, error: 'hetzner-error' });
    await app.close();
  });

  it('502s when the Hetzner fetch itself throws (network error)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(
      remoteDeps(
        { CCRC_HETZNER_TOKEN: 'token', CCRC_FLEET_SERVER_ID: '12345' },
        { connected: false, downSince: 1, ccdVerbs: null, rosterFp: null, build: null },
      ),
    );
    const res = await app.inject({ method: 'POST', url: '/api/fleet/reboot' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, error: 'hetzner-error' });
    await app.close();
  });
});

describe('/api/fleet/health: the lifecycle block (build 9)', () => {
  const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
  const G1 = '1755780000000000000';

  it('reports the mirror once the watcher has swept', async () => {
    const home = mkTmp('ccrc-fh-lc-');
    const deps = testDeps(home);
    const dir = path.join(deps.cfg.registryDir, LC_DIR_NAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, genFile(G1)),
      `${JSON.stringify({ uid: 'a.1', at: 100, act: AN_ACT, outcome: 'done', id: 'demo' })}\n`);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const full = { ...deps, coord,
      fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-rm', LC_CAP_TOKEN] } } as never;
    const bus = new Bus();
    const watcher = new FleetWatcher(full, bus);
    const app = await buildServer(full, bus, watcher);
    try {
      await watcher.sweepLifecycle();
      const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as
        { lifecycle?: { state: string; rows: number; horizon: number | null; gaps: number } };
      expect(body.lifecycle).toMatchObject({ state: 'ok', rows: 1, horizon: 100, gaps: 0 });
    } finally { await app.close(); }
  });

  it('OMITS the block entirely when there is no watcher — absent reads as `unknown`, never as `ok`', async () => {
    const app = await buildServer(testDeps(mkTmp('ccrc-fh-lc-')));
    try {
      const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as
        Record<string, unknown>;
      expect('lifecycle' in body && body['lifecycle'] !== undefined).toBe(false);
    } finally { await app.close(); }
  });

  // Fix round 1: the collapse flagged in the Task 38/39 review. `null` used to
  // mean BOTH "no coordination database" AND "database present, no sweep yet"
  // — two conditions a caller would handle differently, folded into one value.
  // The three cases below prove they are now distinguishable OVER THE WIRE,
  // not merely in `lifecycleHealth()`'s return type.

  it('has a watcher but NO coordination database — the block is absent, same as no watcher at all', async () => {
    const deps = testDeps(mkTmp('ccrc-fh-lc-'));
    const bus = new Bus();
    const watcher = new FleetWatcher(deps, bus);
    const app = await buildServer(deps, bus, watcher);
    try {
      const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as
        Record<string, unknown>;
      const present = 'lifecycle' in body && body['lifecycle'] !== undefined;
      expect(present, 'no Deps.coord means no block, watcher or not').toBe(false);
    } finally { await app.close(); }
  });

  it('has a coordination database but has NOT swept yet — the block is present, as `unknown`, never absent', async () => {
    const home = mkTmp('ccrc-fh-lc-');
    const deps = testDeps(home);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const full = { ...deps, coord,
      fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-rm', LC_CAP_TOKEN] } } as never;
    const bus = new Bus();
    const watcher = new FleetWatcher(full, bus);
    const app = await buildServer(full, bus, watcher);
    try {
      // Deliberately NOT calling `watcher.sweepLifecycle()` — that omission is
      // the entire point of this case.
      const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as
        { lifecycle?: { state: string; rows: number; horizon: number | null; gaps: number;
                         lastOk: number | null } };
      expect(body.lifecycle, 'a database with no sweep yet must still report a block').toBeDefined();
      const lc = body.lifecycle!;   // HARD guard above already stopped the test if absent.
      expect.soft(lc.state, 'state').toBe('unknown');
      expect.soft(lc.lastOk, 'lastOk').toBeNull();
      expect.soft(lc.rows, 'rows').toBe(0);
      expect.soft(lc.gaps, 'gaps').toBe(0);
    } finally { await app.close(); }
  });
});
