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
    writeFileSync(path.join(reg, 'landing', 'proj-a', 'probe'), JSON.stringify({
      v: 1, project: 'proj-a', at: nowIso(), state: 'measured', base: { ref: 'main', sha: sha(9) },
      heads: [{ pr: 12, head: sha(12), branch: 'ws/alpha', id: ID, base: { state: 'clean' } }],
      headsCut: false, pairs: [], pairHeads: [12], pairsCut: false,
    }));
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
  const boot = async (pass: boolean) => {
    const deps: Deps = withFakeClock(testDeps(home));
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
    const { watcher } = await boot(false);
    await watcher.tick();
    await vi.waitFor(() => expect(watcher.currentLandings().get(ID)).toMatchObject(LANDING));
  });
});
