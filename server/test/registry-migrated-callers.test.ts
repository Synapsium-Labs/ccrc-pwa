// Path identity W1a, Task 7 (spec §2.3). Readers that answered an unlistable registry, or a refused row, with an
// empty or silent answer now say what they could not measure:
// - GET /api/fleet serves the watcher's last fleet, else the last-known-good snapshot, else nothing, marked
//   `stale: true`, and never a bare `{sessions: []}`;
// - the /ws/fleet cold start sends no `fleet` frame then, and still sends its `runs` frame;
// - GET /api/projects carries `registry: 'listed' | 'unlistable'`;
// - GET /api/peers counts refused rows (`refusedRows`, only when greater than 0) and refuses a `?of=` that is not a
//   registry id before any read;
// - the claims-conflict path reads the registry ONCE, so its rows and its presence ladder are one observation.
// Fixture HOMEs only. A dash-named row is a plain file under the fixture's registry.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import type { Runner } from '../src/exec.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { saveSnapshot } from '../src/fleetstate.js';
import { listProjects } from '../src/lifecycle.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { FleetSession } from '../../shared/api.js';
import { REFUSED_IDS } from './registryIdCases.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);
const UUID_X = 'c'.repeat(36);

/** A registry row `readRegistryMeasured` builds. Any id, a dash-led one included: it is a plain file name under the
 *  fixture's registry. */
const seed = (home: string, id: string, uuid: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/demo/${id}`, uuid, started: '1', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** tmux answers every pane alive, with a pid and an empty capture; every other exec fails. */
const aliveTmux: Runner = async (_cmd, args) => {
  if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
  if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
  if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
  return { code: 1, stdout: '', stderr: '' };
};

/** `localIO`, except that each listing of the registry directory is COUNTED and can be failed: while `blind` is set
 *  every one fails, and `failAt` (1-based, 0 = never) fails exactly that one. Every other path reads through. */
const registryIO = (registryDir: string) => {
  const state = { listings: 0, blind: false, failAt: 0 };
  const io: FleetIO = {
    ...localIO,
    readdir: async (p, timeoutMs, signal) => {
      if (p !== registryDir) return localIO.readdir(p, timeoutMs, signal);
      state.listings += 1;
      if (state.blind || state.listings === state.failAt) return null;
      return localIO.readdir(p, timeoutMs, signal);
    },
  };
  return { io, state };
};

/** A fixture-local state cache, so no case reads the default path. */
const cachePathOf = (home: string): string => path.join(home, '.ccrc', 'state-cache.json');

type Frame = { type: string; sessions?: FleetSession[] };

/** Listen, connect to /ws/fleet, and record every frame in arrival order. */
const openSocket = async (server: FastifyInstance): Promise<{ ws: WebSocket; frames: Frame[] }> => {
  await server.listen({ host: '127.0.0.1', port: 0 });
  const addr = server.server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
  const frames: Frame[] = [];
  ws.on('message', (d) => { frames.push(JSON.parse(String(d)) as Frame); });
  await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
  return { ws, frames };
};

describe('fleet, projects and peers report what they could not measure (spec §2.3)', () => {
  let app: FastifyInstance | undefined;
  // An unlistable registry logs `noteWholeFleetListing`'s line and a refused row logs once: both are expected here.
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  it('GET /api/fleet on an unlistable registry answers stale:true', async () => {
    const home = mkTmp('ccrc-w1a-fleet-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const base = testDeps(home, aliveTmux);
    const { io, state } = registryIO(base.cfg.registryDir);
    const cachePath = cachePathOf(home);
    const deps: Deps = { ...base, io, stateCachePath: cachePath };

    // (1) No watcher and no snapshot: an EMPTY fleet marked stale, never a bare `{sessions: []}`, which would tell
    // the phone every session had gone.
    app = await buildServer(deps);
    state.blind = true;
    const bare = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(bare.statusCode).toBe(200);
    expect(bare.json()).toEqual({ sessions: [], stale: true });

    // (2) The last-known-good snapshot, when there is one.
    state.blind = false;
    const live = (await app.inject({ method: 'GET', url: '/api/fleet' })).json() as { sessions: FleetSession[]; stale?: boolean };
    expect(live.stale).toBeUndefined();
    expect(live.sessions.map((s) => s.id)).toEqual(['demo-quiet-mesa']);
    await saveSnapshot(live.sessions, cachePath);
    state.blind = true;
    const fromSnap = (await app.inject({ method: 'GET', url: '/api/fleet' })).json() as Record<string, unknown>;
    expect(fromSnap['stale']).toBe(true);
    expect((fromSnap['sessions'] as FleetSession[]).map((s) => s.id)).toEqual(['demo-quiet-mesa']);
    expect(Object.keys(fromSnap).sort(), 'no pools (nothing measured) and no downSince (the link is up)')
      .toEqual(['sessions', 'stale']);
    await app.close();
    app = undefined;

    // (3) The watcher's last broadcast wins over the snapshot: it is this process's newest measurement.
    seed(home, 'demo-still-pond', UUID_B);
    state.blind = false;
    const bus = new Bus();
    const watcher = new FleetWatcher(deps, bus);
    app = await buildServer(deps, bus, watcher);
    await watcher.tick();
    state.blind = true;
    const fromWatcher = (await app.inject({ method: 'GET', url: '/api/fleet' })).json() as { sessions: FleetSession[]; stale: boolean };
    expect(fromWatcher.stale).toBe(true);
    expect(fromWatcher.sessions.map((s) => s.id).sort()).toEqual(['demo-quiet-mesa', 'demo-still-pond']);
  });

  it('the ws cold start with no watcher broadcast, on an unlistable registry, sends hello, then runs, and no fleet frame', async () => {
    const home = mkTmp('ccrc-w1a-cold-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const base = testDeps(home, aliveTmux);
    const { io, state } = registryIO(base.cfg.registryDir);
    state.blind = true;
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    app = await buildServer({ ...base, io, coord, stateCachePath: cachePathOf(home) });
    const { ws, frames } = await openSocket(app);
    // `runs` is chained after the fleet decision in ONE `.then`, so once it has arrived no cold `fleet` can follow.
    await vi.waitFor(() => expect(frames.map((f) => f.type)).toContain('runs'));
    expect(frames.map((f) => f.type)).toEqual(['hello', 'runs']);
    ws.close();
  });

  it('the ws cold start with a watcher broadcast reads no registry', async () => {
    const home = mkTmp('ccrc-w1a-cold-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const base = testDeps(home, aliveTmux);
    const { io, state } = registryIO(base.cfg.registryDir);
    const bus = new Bus();
    // The watcher reads through its OWN io, so every listing `state` counts is the server's.
    const watcher = new FleetWatcher({ ...base, io: localIO, stateCachePath: cachePathOf(home) }, bus);
    app = await buildServer({ ...base, io, stateCachePath: cachePathOf(home) }, bus, watcher);
    await watcher.tick();
    expect(watcher.currentFleet()?.map((s) => s.id)).toEqual(['demo-quiet-mesa']);
    state.listings = 0;
    const { ws, frames } = await openSocket(app);
    await vi.waitFor(() => expect(frames.map((f) => f.type)).toContain('fleet'));
    expect(frames.find((f) => f.type === 'fleet')?.sessions?.map((s) => s.id)).toEqual(['demo-quiet-mesa']);
    expect(state.listings, 'the cold frame is the broadcast: no registry read').toBe(0);
    ws.close();
  });

  it("GET /api/projects answers registry:'unlistable' on an unlistable registry, and still lists the root projects", async () => {
    const home = mkTmp('ccrc-w1a-projects-');
    const root = mkTmp('ccrc-w1a-root-');
    mkdirSync(path.join(root, 'alpha'));
    seed(home, 'demo-quiet-mesa', UUID_A, { project: 'regonly', workdir: '/w/regonly' });
    const base = testDeps(home, aliveTmux);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: root });
    const { io, state } = registryIO(cfg.registryDir);
    state.blind = true;
    app = await buildServer({ ...base, cfg, io });
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { registry?: string; projects: { name: string }[] };
    expect(body.registry).toBe('unlistable');
    expect(body.projects.map((p) => p.name), 'the root walk still answers; the registry half was not read')
      .toEqual(['alpha']);
    const direct = await listProjects(io, cfg);
    expect(direct.registry).toBe('unlistable');
    expect(direct.projects.map((p) => p.name)).toEqual(['alpha']);
  });

  it("GET /api/projects answers registry:'listed' when the registry lists", async () => {
    const home = mkTmp('ccrc-w1a-projects-');
    const root = mkTmp('ccrc-w1a-root-');
    mkdirSync(path.join(root, 'alpha'));
    seed(home, 'demo-quiet-mesa', UUID_A, { project: 'regonly', workdir: '/w/regonly' });
    const base = testDeps(home, aliveTmux);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: root });
    app = await buildServer({ ...base, cfg });
    const body = (await app.inject({ method: 'GET', url: '/api/projects' })).json() as { registry?: string; projects: { name: string }[] };
    expect(body.registry).toBe('listed');
    expect(body.projects.map((p) => p.name)).toEqual(['alpha', 'regonly']);
    expect((await listProjects(localIO, cfg)).registry).toBe('listed');
  });

  const peersApp = async (home: string, io: FleetIO = localIO): Promise<FastifyInstance> => {
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    return buildServer({ ...testDeps(home, aliveTmux), mailToken: TOKEN, coord, io });
  };

  it('GET /api/peers?project= with a planted --actor row answers 200 with refusedRows:1', async () => {
    const home = mkTmp('ccrc-w1a-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, '--actor', UUID_X);
    app = await peersApp(home);
    const res = await app.inject({ method: 'GET', url: '/api/peers?project=demo', headers: tok });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { peers: { id: string }[]; refusedRows?: number };
    expect(body.peers.map((p) => p.id), 'a refused row is never read, so never a peer').toEqual(['demo-quiet-mesa']);
    expect(body.refusedRows).toBe(1);
  });

  it('GET /api/peers?project= with no refused row has no refusedRows key', async () => {
    const home = mkTmp('ccrc-w1a-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    app = await peersApp(home);
    const res = await app.inject({ method: 'GET', url: '/api/peers?project=demo', headers: tok });
    expect(res.statusCode).toBe(200);
    expect('refusedRows' in (res.json() as Record<string, unknown>), 'absence permits: the key rides only when > 0').toBe(false);
  });

  it('GET /api/peers?of=--actor answers 400 bad-session with no listing', async () => {
    const home = mkTmp('ccrc-w1a-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, '--actor', UUID_X);
    const { io, state } = registryIO(path.join(home, '.cc-sessions'));
    app = await peersApp(home, io);
    const res = await app.inject({ method: 'GET', url: '/api/peers?of=--actor', headers: tok });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(state.listings, 'refused before any read: a bad id never heals').toBe(0);
  });

  it.each(REFUSED_IDS)('GET /api/peers?of=%j, no row planted, answers 400 bad-session with no listing', async (id) => {
    const home = mkTmp('ccrc-w1a-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const { io, state } = registryIO(path.join(home, '.cc-sessions'));
    app = await peersApp(home, io);
    const res = await app.inject({ method: 'GET', url: `/api/peers?of=${encodeURIComponent(id)}`, headers: tok });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(state.listings).toBe(0);
  });

  it('GET /api/peers on an unlistable registry answers the existing 502', async () => {
    const home = mkTmp('ccrc-w1a-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const { io, state } = registryIO(path.join(home, '.cc-sessions'));
    state.blind = true;
    app = await peersApp(home, io);
    const res = await app.inject({ method: 'GET', url: '/api/peers?project=demo', headers: tok });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(state.listings, 'ONE read: the listing and the rows are one observation').toBe(1);
  });

  it('the claims-conflict path on an unlistable registry reads presence unmeasured', async () => {
    const home = mkTmp('ccrc-w1a-claims-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-still-pond', UUID_B);
    const { io, state } = registryIO(path.join(home, '.cc-sessions'));
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const server = await buildServer({ ...testDeps(home, aliveTmux), mailToken: TOKEN, coord, io });
    app = server;
    const claim = (byId: string, byUuid: string, p: string) => server.inject({
      method: 'POST', url: '/api/claims', headers: tok,
      payload: { byId, byUuid, project: 'demo', paths: [p], intent: 'work' },
    });

    // Calibrate: an uncontested claim spends the attribution's listings alone, so the conflict arm's own read is
    // the one after them.
    state.listings = 0;
    expect((await claim('demo-quiet-mesa', UUID_A, 'shared/api.ts')).statusCode).toBe(200);
    const attribution = state.listings;
    expect(attribution, 'the attribution lists the registry').toBeGreaterThan(0);

    // Control: the same conflict with nothing failed reads the holder as deliverable. The conflict arm lists the
    // registry directory TWICE: its ONE registry read, then `assembleFleet`'s `readLimits`, which lists the same
    // directory for its `-disabled` and `-authdead` lane markers and reads no row. Before this task the arm listed it
    // three times: its own listing, the fallback's second registry read, and `readLimits`.
    state.listings = 0;
    const seen = await claim('demo-still-pond', UUID_B, 'shared/api.ts');
    expect(seen.statusCode).toBe(409);
    expect((seen.json() as { conflicts: { deliverable: string }[] }).conflicts[0]!.deliverable).toBe('yes');
    expect(state.listings, 'the conflict arm reads the registry ONCE').toBe(attribution + 2);

    // The conflict arm's one registry read fails. It is the arm's first listing, awaited before `assembleFleet`
    // starts: no rows and no listing, so presence is unmeasured, never `yes` off a second read the ladder never saw.
    state.listings = 0;
    state.failAt = attribution + 1;
    const res = await claim('demo-still-pond', UUID_B, 'shared/api.ts');
    expect(res.statusCode).toBe(409);
    const c = (res.json() as { conflicts: { heldBy: string; deliverable: string }[] }).conflicts[0]!;
    expect(c.heldBy).toBe('demo-quiet-mesa');
    expect(c.deliverable).toBe('unknown');
    expect(state.listings).toBe(attribution + 2);
  });
});
