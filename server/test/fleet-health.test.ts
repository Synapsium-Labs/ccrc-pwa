import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { saveSnapshot, type FleetState } from '../src/fleetstate.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import { DEFAULT_TEST_ROSTER, seedRoster, testDeps } from './helpers.js';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { bodyDigest } from '../../shared/mark.mjs';
import type { FleetHealth, FleetSession } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';
import { genFile } from './lifecycleHelpers.js';
import { LC_ACT_UNKNOWN, LC_DIR_NAME, LIFECYCLE_ACTS } from '../../shared/api.js';
import { DELEGATION_JOURNAL_FILE, DELEGATION_TORN_DIR, buildDelegationJournalRecord, encodeDelegationJournalRecord } from '../src/coord/delegation-journal.js';
import type { BuildInfo } from '../../shared/buildinfo.js';
import type { NodeMeasurement } from '../src/coord/store.js';

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
  id, wrapper: 'claude', home: '/home/u', project: id, workdir: `/data/projects/${id}`,
  workspace: null, name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, background: null, withCoordinator: null, lastEnd: null, hibernatedAt: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, role: 'coordinator', releasedFrom: null,
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
    expect(res.json()).toEqual({ mode: 'local', connected: true, downSince: null, roster: 'unknown', build: 'unknown', projectPools: 'unknown' });
    await app.close();
  });

  it('never emits `builds` in local mode — there is no second box to show', async () => {
    const app = await buildServer(testDeps());
    const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
    expect('builds' in body).toBe(false);
    await app.close();
  });

  it('remote mode + connected fleetState reports connected', async () => {
    const app = await buildServer(remoteDeps({}, { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null }));
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
    expect(res.json()).toEqual({ mode: 'remote', connected: true, downSince: null, roster: 'unknown', build: 'unknown', projectPools: 'unknown', builds: { own: null, fleet: null } });
    await app.close();
  });

  it('remote mode + disconnected fleetState surfaces connected:false and downSince', async () => {
    const app = await buildServer(remoteDeps({}, { connected: false, downSince: 1700000000000, ccdVerbs: null, rosterFp: null, build: null }));
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
    expect(res.json()).toEqual({ mode: 'remote', connected: false, downSince: 1700000000000, roster: 'unknown', build: 'unknown', projectPools: 'unknown', builds: { own: null, fleet: null } });
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

  it('local mode with no measured caps says projectPools: unknown — never unavailable', async () => {
    // `unavailable` is a MEASURED absence an operator acts on (redeploy the
    // agent lane). No caps list is no evidence, and wave 4's banner arms on
    // `unavailable` only — so folding these two would put a "redeploy the
    // fleet host" banner on every dev box.
    const app = await buildServer(testDeps());
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
    expect(res.json().projectPools).toBe('unknown');
    await app.close();
  });

  it('a fleet host advertising project-pool is enforced; one that is not is unavailable', async () => {
    const verb = CCD_ARGV.projectPoolClear('demo')[0]!;
    for (const [verbs, expected] of [
      [[verb, 'swap'], 'enforced'],
      [['swap', 'start'], 'unavailable'],
      [null, 'unknown'],
    ] as const) {
      const app = await buildServer(remoteDeps({}, {
        connected: true, downSince: null, ccdVerbs: verbs === null ? null : [...verbs],
        rosterFp: null, build: null,
      }));
      const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
      expect(res.json().projectPools, JSON.stringify(verbs)).toBe(expected);
      await app.close();
    }
  });});

describe('GET /api/fleet/health — the inventory-derived `builds` degrades, never 500s (design 2026-09-20 §14)', () => {
  const STAMP: BuildInfo = { sha: 'abc1234', ref: 'main', builtAt: '2026-09-21T00:00:00Z', dirty: false, version: 'v0.0.11' };
  const serverRow = (role: 'server' | 'both'): NodeMeasurement => ({
    nodeId: 'server', role, label: 'server',
    currentVersion: STAMP.version ?? null, currentSha: STAMP.sha, currentRef: STAMP.ref,
    currentBuiltAt: STAMP.builtAt, currentDirty: STAMP.dirty,
    stampRead: 'ok', installState: 'unknown', provenance: 'unknown', caps: [], agentOps: null,
    highestVersion: null, previousVersion: null, floorRead: 'absent', previousRead: 'absent',
    os: 'linux', measuredAt: 1_758_000_000_000, report: null,
  });

  it('an inventory that cannot be read answers builds null per side and build unknown — the route stays up', async () => {
    // `nodes()` is a synchronous sqlite read; a corrupt or locked coord.db throws. Before W2 nothing in this arm
    // touched coord.db, so a throw here would be a NEW way for the banner route to 500. It degrades the way
    // `readPoolEpoch` degrades — and it does NOT fall back to the handshake stamp planted below (spec §8).
    const deps = remoteDeps({}, { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: STAMP });
    const coord = new CoordStore(openCoordDb(deps.cfg.coordDbPath));
    const broken = Object.assign(Object.create(coord) as CoordStore, {
      nodes: (): never => { throw new Error('planted: the inventory cannot be read'); },
    });
    const app = await buildServer({ ...deps, build: STAMP, coord: broken });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ mode: 'remote', connected: true, build: 'unknown', builds: { own: null, fleet: null } });
    } finally {
      await app.close();
      coord.db.close();
    }
  });

  it('local mode never emits `builds`, even over an inventory holding this box\'s row', async () => {
    // The derivation is the remote arm's alone: there is still no second box to show.
    const home = mkTmp('ccrc-fh-builds-');
    const deps = testDeps(home);
    const coord = new CoordStore(openCoordDb(deps.cfg.coordDbPath));
    expect(coord.upsertNodeMeasurement(serverRow('both'))).toMatchObject({ ok: true });
    const app = await buildServer({ ...deps, coord });
    try {
      const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
      expect('builds' in body).toBe(false);
      expect(body['build']).toBe('unknown');
    } finally {
      await app.close();
      coord.db.close();
    }
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
    // WIDENED, NOT LOOSENED (account pools, wave 3): the LIVE-assemble arm now
    // carries `pools` for first paint, and this stays an exact-shape assertion
    // so the DEGRADED arm's own case — which asserts the key is ABSENT — keeps
    // its meaning. `listed: false` is the truthful answer for a fixture whose
    // registry root does not list: nobody decides, and that is not `untagged`.
    // `observedEpoch: null` (item 1, wave-1 fix round A): no `$REG/pool-epoch`
    // was planted in this fixture's home, a real ENOENT `readObservedEpochFromRegistry`
    // measures and reports honestly, independent of the root listing above.
    expect(res.json()).toEqual({
      sessions: [], pools: { listed: false, enforcement: 'unknown', observedEpoch: null, accountPools: 'unknown' },
    });
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
        id: 'claude-Cached', wrapper: 'claude', home: '/home/u', project: 'claude-Cached',
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
    expect(body.sessions[0]?.graphQueries).toBeNull();
    expect(body).toEqual({
      // D-5301: an older cache says nothing about the role, so it revives null —
      // never re-derived from the defaulted `child` (`reviveSessionRole`).
      sessions: [{ ...session('claude-Cached'), role: null }],
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
    // WIDENED, NOT LOOSENED (account pools, wave 3): the LIVE-assemble arm now
    // carries `pools` for first paint, and this stays an exact-shape assertion
    // so the DEGRADED arm's own case — which asserts the key is ABSENT — keeps
    // its meaning. `listed: false` is the truthful answer for a fixture whose
    // registry root does not list: nobody decides, and that is not `untagged`.
    // `observedEpoch: null` (item 1, wave-1 fix round A) — see the sibling
    // case above.
    expect(res.json()).toEqual({
      sessions: [], pools: { listed: false, enforcement: 'unknown', observedEpoch: null, accountPools: 'unknown' },
    });
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

describe('/api/fleet/health: the delegation observation health (wave 3, Task 13)', () => {
  const DELEGATION_CAPS = ['caps', 'delegation-events-v1'];
  const INC = '0189abcd-1234-5678-9abc-0123456789ab';

  /** A watcher over a store, with a census pass planted for one live session whose spool directory exists: the lane then has run. */
  async function lane(env: Record<string, string> = {}, verbs: string[] = DELEGATION_CAPS, plant?: (ccrcDir: string) => void) {
    const home = mkTmp('ccrc-fh-dg-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home, ...env });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    plant?.(path.join(home, '.ccrc'));
    mkdirSync(path.join(cfg.registryDir, 'delegation', 'spool', 'demo-a'), { recursive: true });
    const full = {
      cfg, runCcd: ccdRunner(deadRunner, cfg), tmux: new Tmux(deadRunner), io: localIO, queue: new KeyedQueue(), coord,
      fleetState: { connected: true, downSince: null, ccdVerbs: verbs, rosterFp: null, build: null },
    } as never as Deps;
    const bus = new Bus();
    const watcher = new FleetWatcher(full, bus);
    const app = await buildServer(full, bus, watcher);
    const runLane = async (): Promise<void> => {
      (watcher as unknown as { delegationCensus: unknown }).delegationCensus = {
        measuredAt: Date.now(), projects: new Map(), incarnations: new Map([['demo-a', { kind: 'measured', incarnation: INC }]]),
      };
      await watcher.sweepDelegation([{ id: 'demo-a', project: 'demo', status: 'idle' }] as never, [{ id: 'demo-a', project: 'demo', child: { kind: 'none' } }] as never);
    };
    return { app, watcher, runLane };
  }
  type Body = Record<string, unknown> & { delegation?: Record<string, unknown> };

  for (const [name, env] of [['local', {}], ['remote', { CCRC_FLEET: 'remote' }]] as const) {
    it(`${name} mode: the member is ABSENT until the lane has run (absence reads as unknown), then present and report-only`, async () => {
      const { app, runLane } = await lane(env);
      try {
        const before = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Body;
        expect('delegation' in before, 'a health that has measured nothing must not render a block').toBe(false);
        await runLane();
        const after = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Body;
        expect(after.delegation).toMatchObject({ mode: 'report-only', stageGate: 'unmeasured', unmeasuredRate: null, circuitBreaker: 'clear' });
        // the new member is the only change: nothing else of the response moved
        const { delegation: _gone, ...rest } = after;
        const { ...restBefore } = before;
        expect(rest).toEqual(restBefore);
      } finally { await app.close(); }
    });
  }

  it('an old fleet (a `ccd caps` list without the token) is unmeasured on the wire, never a zero or an eligible', async () => {
    const { app, runLane } = await lane({}, ['caps', 'ws-rm']);
    try {
      await runLane();
      const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Body;
      expect(body.delegation).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null });
      expect(body.delegation!['stageGate']).not.toBe('eligible');
    } finally { await app.close(); }
  });

  it('a server with a watcher but no coordination database, or no watcher at all, never emits it', async () => {
    const deps = testDeps(mkTmp('ccrc-fh-dg-'));
    const bus = new Bus();
    const watcher = new FleetWatcher(deps, bus);
    const a = await buildServer(deps, bus, watcher);
    const b = await buildServer(testDeps(mkTmp('ccrc-fh-dg-')));
    try {
      for (const app of [a, b]) {
        const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Body;
        expect('delegation' in body).toBe(false);
      }
    } finally { await a.close(); await b.close(); }
  });

  // D-4655: a torn journal tail the server healed at boot is reported here, additively, and is never a failure.
  describe('a healed torn journal tail (D-4655): lastTailHeal on the member, never a failure', () => {
    const record = buildDelegationJournalRecord({
      sequence: 1, acceptedAt: '2026-10-15T10:00:00.000Z', previousDigest: null,
      entry: {
        kind: 'evidence-accepted',
        event: {
          v: 1, eventKind: 'SessionStart', source: 'startup', observedAt: '2026-10-15T09:59:00.000Z', sessionId: 'demo-a', parentIncarnation: INC,
          claudeSessionId: '6350faa0-a1be-4e78-939c-57485268f6fc', eventId: 'e'.repeat(64), bucket: '2026101509', startOffset: 0, endOffset: 120,
        },
      },
    });
    const torn = (ccrcDir: string): void => {
      mkdirSync(ccrcDir, { recursive: true });
      writeFileSync(path.join(ccrcDir, DELEGATION_JOURNAL_FILE), Buffer.concat([Buffer.from(encodeDelegationJournalRecord(record)), Buffer.from('{"acceptedAt":"2026-10-15T1')]));
    };

    it('the member carries {at, bytes, quarantinePath} after the lane has healed a tail, and the rest of the member is what it was', async () => {
      const { app, runLane } = await lane({}, DELEGATION_CAPS, torn);
      try {
        await runLane();
        const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Body;
        const heal = body.delegation!['lastTailHeal'] as { at: string; bytes: number; quarantinePath: string };
        expect(heal.bytes).toBe('{"acceptedAt":"2026-10-15T1'.length);
        expect(heal.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(heal.quarantinePath).toMatch(new RegExp(`${DELEGATION_TORN_DIR.replace('.', '\\.')}/\\d+-[0-9a-f]{64}\\.tail$`));
        expect(readFileSync(heal.quarantinePath, 'utf8')).toBe('{"acceptedAt":"2026-10-15T1');
        // never a failure, never unhealthy, and not made unmeasured by itself: the gates read what they read without it
        expect(body.delegation).toMatchObject({ mode: 'report-only', stageGate: 'unmeasured', circuitBreaker: 'clear', unmeasuredRate: null });
        expect(Object.keys(body.delegation!).sort()).toEqual([
          'circuitBreaker', 'conflicting', 'lastCheckpointRevision', 'lastIngestedAt', 'lastJournalSequence', 'lastTailHeal', 'measuredSessionHours', 'mode',
          'stageGate', 'unmeasured', 'unmeasuredRate', 'unresolved', 'unmeasuredSessionHours', 'windowEndedAt', 'windowStartedAt',
        ].sort());
        expect(body.delegation!['lastJournalSequence']).toBe(1);
      } finally { await app.close(); }
    });

    it('without a heal the member has no lastTailHeal key at all (absence is not "healthy" and not an empty object)', async () => {
      const { app, runLane } = await lane();
      try {
        await runLane();
        const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Body;
        expect('lastTailHeal' in body.delegation!).toBe(false);
      } finally { await app.close(); }
    });
  });

  it('adds no PWA state and no fleet frame: the type is an optional member and the PWA source never names it', () => {
    const fh: FleetHealth = { mode: 'local', connected: true, downSince: null };
    expect(fh.delegation).toBeUndefined();
    const pwa = path.resolve(__dirname, '../../pwa/src');
    const grep = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? grep(p) : /\.(ts|tsx|svelte|js)$/.test(e.name) && /DelegationObservationHealth|\.delegation\b/.test(readFileSync(p, 'utf8')) ? [p] : [];
    });
    expect(grep(pwa)).toEqual([]);
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

  // The ask half of this composed first-paint handler, plus its websocket
  // cold-start twin, is pinned by fleetws.test.ts's cold-path ask cases.
  it('a live assemble carries the measured pools for first paint', async () => {
    const home = mkTmp('ccrc-fleet-pools-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions', 'pools'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'pools', 'demo'), 'pool-a');
    const app = await buildServer(testDeps(home));
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    // `observedEpoch: null` (item 1, wave-1 fix round A): no `$REG/pool-epoch`
    // was planted in this fixture's home.
    expect(res.json().pools).toEqual({
      listed: true, byProject: { demo: { state: 'tagged', name: 'pool-a' } }, enforcement: 'unknown',
      observedEpoch: null, accountPools: 'unknown',
    });
    await app.close();
  });

  it('the DEGRADED arm carries no pools key at all — a cached tag is not live policy', async () => {
    // Nothing pooled is persisted (spec §5.4.1). Serving the last snapshot must
    // not come with a pool answer this process could not take, so the key is
    // ABSENT and the PWA renders nothing rather than a stale chip.
    const cachePath = path.join(mkTmp('ccrc-fleet-pools-cache-'), 'state-cache.json');
    await saveSnapshot([session('demo')], cachePath);
    const app = await buildServer(remoteDeps({}, {
      connected: false, downSince: 1785300000000, ccdVerbs: null, rosterFp: null, build: null,
    }, cachePath));
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.json().stale).toBe(true);
    expect(Object.keys(res.json())).not.toContain('pools');
    await app.close();
  });});
