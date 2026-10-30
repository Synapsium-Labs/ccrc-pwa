// Landing order wave 4b, Task 2: `FleetSession.landing` on every fleet frame the server builds (Review Focus 3): the REST
// fleet, the /ws/fleet cold frame and the tick's broadcast, each handed the lane's map, and each dropping an entry past its
// window. Modelled on `divergence-sweep.test.ts`'s two server.ts call-site cases. Absence is a missing key, never a null.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { buildServer, type Deps } from '../src/server.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { saveSnapshot } from '../src/fleetstate.js';
import { dropStaleLandings } from '../src/fleet.js';
import type { FleetSession } from '../../shared/api.js';
import { seedRoster, testDeps, withFakeClock } from './helpers.js';
import { watcherTeardown } from './watcherTeardown.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'claude-a-proj-a-alpha';
const sha = (n: number): string => n.toString(16).padStart(40, '0');
const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

describe('FleetSession.landing on the three frames', () => {
  let home: string;
  const teardown = watcherTeardown();

  /** Wave 3b's doc for the one fixture session, stamped `at`. */
  const probeDoc = (at: string): Record<string, unknown> => ({
    v: 1, project: 'proj-a', at, state: 'measured', base: { ref: 'main', sha: sha(9) },
    heads: [{ pr: 12, head: sha(12), branch: 'ws/alpha', id: ID, base: { state: 'clean' } }],
    headsCut: false, pairs: [], pairHeads: [12], pairsCut: false,
  });

  beforeEach(() => {
    home = mkTmp('ccrc-radar-frames-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(path.join(reg, 'landing', 'proj-a'), { recursive: true });
    const fields: Record<string, string> = {
      uuid: `u-${ID}`, wrapper: 'claude-a', project: 'proj-a', workdir: `/w/${ID}`, workspace: 'alpha', branch: 'ws/alpha',
      base: 'origin/main', started: '1',
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${f}`), v);
    writeFileSync(path.join(reg, 'landing', 'proj-a', 'probe'), JSON.stringify(probeDoc(nowIso())));
  });
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  afterEach(async () => {
    const closing = app;
    app = undefined;
    vi.restoreAllMocks();
    await teardown.remove(home, closing);
  });

  const LANDING = {
    pr: 12, head: sha(12), baseRef: 'main', base: { state: 'clean' }, paired: true, conflicts: [], unmeasuredWith: [],
    cut: { heads: false, pairs: false, unbound: false },
  };

  /** A watcher and a server over the fixture home; `pass` runs the lane once, before any frame is built. */
  const boot = async (pass: boolean, over: Partial<Deps> = {}) => {
    const deps: Deps = withFakeClock({ ...testDeps(home), ...over });
    const bus = new Bus();
    const watcher = teardown.track(new FleetWatcher(deps, bus, 10_000));
    if (pass) await watcher.sweepRadar(await readRegistry(deps.io, deps.cfg));
    app = await buildServer(deps, bus, watcher);
    return { deps, bus, watcher, app };
  };
  const row = (sessions: FleetSession[]): FleetSession => sessions.find((s) => s.id === ID)!;
  const getFleet = async (a: NonNullable<typeof app>): Promise<FleetSession[]> =>
    ((await a.inject({ method: 'GET', url: '/api/fleet' })).json() as { sessions: FleetSession[] }).sessions;

  it('GET /api/fleet after a lane pass carries the landing', async () => {
    const { app: a } = await boot(true);
    expect(row(await getFleet(a)).landing).toMatchObject(LANDING);
  });

  it('GET /api/fleet before any lane pass carries no landing key at all', async () => {
    const { app: a } = await boot(false);
    const r = row(await getFleet(a));
    expect('landing' in r, 'absence is a missing key, never null').toBe(false);
  });

  it('GET /api/fleet drops an entry past its window though the lane has not run again', async () => {
    const { app: a, watcher } = await boot(true);
    expect(watcher.currentLandings().get(ID)).toBeDefined();
    const real = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(real + 1201_000);
    const r = row(await getFleet(a));
    expect('landing' in r, 'an old prediction reached the wire').toBe(false);
  });

  it('a NEW /ws/fleet client\'s cold frame, before any broadcast, carries the landing', async () => {
    const { app: a } = await boot(true);
    await a.listen({ host: '127.0.0.1', port: 0 });
    const addr = a.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
    type Frame = { type: string; sessions?: FleetSession[] };
    // Found by TYPE, not index: the coord store adds cold-start frames of its own.
    const fleet = await new Promise<Frame>((resolve, reject) => {
      ws.on('message', (d) => {
        const f = JSON.parse(String(d)) as Frame;
        if (f.type === 'fleet') resolve(f);
      });
      ws.on('error', reject);
    });
    ws.close();
    expect(row(fleet.sessions!).landing).toMatchObject(LANDING);
  });

  it('tick() broadcasts the landing the lane holds', async () => {
    const { bus, watcher } = await boot(true);
    const frames: FleetSession[][] = [];
    bus.on('fleet', (s) => frames.push(s as FleetSession[]));
    await watcher.tick();
    expect(frames.length).toBeGreaterThan(0);
    expect(row(frames.at(-1)!).landing).toMatchObject(LANDING);
  });

  it('tick() runs the lane itself: no earlier pass, and the broadcast still reaches a landing', async () => {
    const { bus, watcher } = await boot(false);
    const frames: FleetSession[][] = [];
    bus.on('fleet', (s) => frames.push(s as FleetSession[]));
    await watcher.tick();                                                         // the lane's first pass starts here
    await vi.waitFor(() => expect(watcher.currentLandings().get(ID)).toMatchObject(LANDING));
    await watcher.tick();                                                         // a tick after the pass broadcasts it
    expect(frames.length, 'tick() broadcast no fleet').toBeGreaterThan(0);
    expect(row(frames.at(-1)!).landing, 'the broadcast never reached the landing the lane found').toMatchObject(LANDING);
    expect(row(watcher.currentFleet()!).landing).toMatchObject(LANDING);
  });

  // Fix round 1, R1 (review 1225, F1): four sends carry a fleet that was not just assembled, so `assembleFleet`'s own
  // window check never saw it: the cold frame and the degraded GET (the watcher's last broadcast) and the two snapshot
  // arms (a saved file). Every instant here is fixed and second-aligned (`T0`, the probe's `at` and the clock both),
  // never `nowIso()` against the real clock, so a window edge cannot move under the test.
  describe('the sends that carry an EARLIER fleet drop a landing past its window (R1)', () => {
    const T0 = Date.parse('2026-10-27T09:00:00Z');
    const stamp = (offsetS: number): string => new Date(T0 + offsetS * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const EDGE: ReadonlyArray<readonly [number, boolean]> = [[1200, true], [1201, false]];
    let unlistable = false;

    beforeEach(() => {
      unlistable = false;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      writeFileSync(path.join(home, '.cc-sessions', 'landing', 'proj-a', 'probe'), JSON.stringify(probeDoc(stamp(0))));
    });
    afterEach(() => { vi.useRealTimers(); });

    /** An io whose `readdir` of the REGISTRY directory alone can be made to fail: the lane's own listings go through
     *  `readdirMeasured` and stay real, as does every other directory. */
    const blindable = (): FleetIO => {
      const registryDir = testDeps(home).cfg.registryDir;
      return { ...localIO, readdir: async (p, t, sg) => (unlistable && p === registryDir ? null : localIO.readdir(p, t, sg)) };
    };
    const getBody = async (a: NonNullable<typeof app>): Promise<{ sessions: FleetSession[]; stale?: boolean }> =>
      (await a.inject({ method: 'GET', url: '/api/fleet' })).json() as { sessions: FleetSession[]; stale?: boolean };
    const coldFleet = async (a: NonNullable<typeof app>): Promise<FleetSession[]> => {
      await a.listen({ host: '127.0.0.1', port: 0 });
      const addr = a.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
      type Frame = { type: string; sessions?: FleetSession[] };
      const fleet = await new Promise<Frame>((resolve, reject) => {
        ws.on('message', (d) => {
          const f = JSON.parse(String(d)) as Frame;
          if (f.type === 'fleet') resolve(f);
        });
        ws.on('error', reject);
      });
      ws.close();
      return fleet.sessions!;
    };
    /** One lane pass and one tick at `T0`, then the clock moves `offset` s and the registry cannot be listed, and one
     *  more tick runs (the review's scenario): the watcher's last fleet still carries the landing it assembled at `T0`. */
    const blindAfter = async (offset: number) => {
      const b = await boot(false, { io: blindable() });
      await b.watcher.tick();                                                        // the lane's pass starts
      await vi.waitFor(() => expect(b.watcher.currentLandings().get(ID)).toBeDefined());
      await b.watcher.tick();                                                        // a broadcast that carries it
      expect(row(b.watcher.currentFleet()!).landing, 'the hazard: the last fleet carries the landing').toMatchObject(LANDING);
      vi.setSystemTime(T0 + offset * 1000);
      unlistable = true;
      await b.watcher.tick();
      return b;
    };

    it.each(EDGE)('the registry unlistable %i s after the pass: the degraded GET carries the landing: %s', async (offset, carries) => {
      const { app: a, watcher } = await blindAfter(offset);
      const body = await getBody(a);
      expect(body.stale, 'this is the degraded arm').toBe(true);
      expect('landing' in row(body.sessions), `a landing ${offset} s old, carried: ${String(carries)}`).toBe(carries);
      if (carries) expect(row(body.sessions).landing).toMatchObject(LANDING);
      expect(row(watcher.currentFleet()!).landing, 'the watcher\'s own last fleet is never mutated').toMatchObject(LANDING);
    });

    it.each(EDGE)('the registry unlistable %i s after the pass: a new /ws/fleet client\'s cold frame carries the landing: %s', async (offset, carries) => {
      const { app: a, watcher } = await blindAfter(offset);
      const sessions = await coldFleet(a);
      expect('landing' in row(sessions), `a landing ${offset} s old, carried: ${String(carries)}`).toBe(carries);
      if (carries) expect(row(sessions).landing).toMatchObject(LANDING);
      expect(row(watcher.currentFleet()!).landing, 'the watcher\'s own last fleet is never mutated').toMatchObject(LANDING);
    });

    /** A saved snapshot of a fleet that carries the landing (read off a live GET at `T0`), then the clock moves. */
    const snapshotThen = async (offset: number, connected: boolean) => {
      const cachePath = path.join(mkTmp('ccrc-radar-cache-'), 'state-cache.json');
      const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
      const fleetState = { connected: true, downSince: null as number | null, ccdVerbs: null, rosterFp: null, build: null };
      const b = await boot(true, { io: blindable(), cfg, fleetState, stateCachePath: cachePath });
      const live = await getBody(b.app);
      expect(row(live.sessions).landing, 'the snapshot is saved WITH a landing').toMatchObject(LANDING);
      await saveSnapshot(live.sessions, cachePath);
      vi.setSystemTime(T0 + offset * 1000);
      fleetState.connected = connected;
      fleetState.downSince = connected ? null : T0;
      return b;
    };

    it.each(EDGE)('the remote disconnected arm, a snapshot %i s old: the landing is carried: %s', async (offset, carries) => {
      const { app: a } = await snapshotThen(offset, false);
      const body = await getBody(a);
      expect(body.stale, 'this is the disconnected arm').toBe(true);
      expect('landing' in row(body.sessions), `a landing ${offset} s old, carried: ${String(carries)}`).toBe(carries);
    });

    it.each(EDGE)('the degraded arm\'s fallback to the snapshot, one %i s old: the landing is carried: %s', async (offset, carries) => {
      const { app: a, watcher } = await snapshotThen(offset, true);
      unlistable = true;                                       // no broadcast has been made, so the fallback is the snapshot
      expect(watcher.currentFleet()).toBeNull();
      const body = await getBody(a);
      expect(body.stale, 'this is the degraded arm').toBe(true);
      expect('landing' in row(body.sessions), `a landing ${offset} s old, carried: ${String(carries)}`).toBe(carries);
    });

    it('dropStaleLandings: a list with nothing to drop is returned as it is, and a stale row is copied, not edited', () => {
      const fresh = { id: 'a', landing: { at: stamp(0) } } as unknown as FleetSession;
      const old = { id: 'b', landing: { at: stamp(-1201) } } as unknown as FleetSession;
      const none = { id: 'c' } as unknown as FleetSession;
      const same = [fresh, none];
      expect(dropStaleLandings(same, T0)).toBe(same);
      const out = dropStaleLandings([fresh, old, none], T0);
      expect(out.map((s) => 'landing' in s)).toEqual([true, false, false]);
      expect(out[0]).toBe(fresh);
      expect(old.landing, 'the input row keeps its landing').toBeDefined();
    });
  });
});
