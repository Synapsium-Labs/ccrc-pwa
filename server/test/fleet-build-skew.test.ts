// The other half of the build stamp: the server READS what the fleet host said
// it is running, compares it against what THIS box is running, and answers with
// one of three words.
//
// Task 2 put `~/.ccrc/build.json` on the agent's `ready` frame. Nothing read
// it. A deploy that landed on one box and not the other was still invisible —
// the stamp existed, crossed the wire, and fell on the floor. This suite is
// what makes the round trip a fact rather than a hope, and it deliberately does
// NOT stop at unit-testing `buildAgreement`: `AgentReady.build` and
// `FleetHealth.build` are both OPTIONAL (additive wire discipline), so no
// compile error anywhere fires if the field is never sent or never read. The
// `end to end` describe at the bottom is the only mechanism that would go red
// on a silently-dropped field, and it runs a real agent, a real socket and a
// real route.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../../agent/src/server.js';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { buildAgreement, derivedBuilds, type BuildSource, type FleetState } from '../src/fleetstate.js';
import { CoordStore, type NodeMeasurement } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { FLEET_LABEL, sweepInventory } from '../src/update/inventory.js';
import type { NodeRole } from '../../shared/api.js';
import { KeyedQueue } from '../src/inject/queue.js';
import type { BuildInfo } from '../../shared/buildinfo.js';
import { seedRoster, testDeps } from './helpers.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import { mkTmp } from './tmpHelpers.js';

const OWN: BuildInfo = { sha: 'abc1234', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false };

const deadRunner: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

/** Remote-mode deps against a throwaway fixture home, with both build stamps
 *  under the test's control: the fleet host's (on `fleetState.build`, where the
 *  ready frame's reader puts it) and this box's own (`Deps.build`, where
 *  `index.ts` puts what it read at boot). */
function remoteDeps(fleetBuild: BuildInfo | null, ownBuild: BuildInfo | null): Deps {
  const home = mkTmp('ccrc-skew-');
  seedRoster(home);
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
  const fleetState: FleetState = {
    connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: fleetBuild,
  };
  return {
    cfg, build: ownBuild, runCcd: ccdRunner(deadRunner, cfg), tmux: new Tmux(deadRunner),
    io: localIO, fleetState, queue: new KeyedQueue(),
  };
}

const healthOf = async (deps: Deps): Promise<Record<string, unknown>> => {
  const app = await buildServer(deps);
  try {
    return (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
  } finally {
    await app.close();
  }
};

/** One inventory row exactly as the sweep writes it (Task 11's `measurementFrom`), the stamp spread into the five
 *  `current*` columns. `stamp: null` is a node with no stamp file (`stampRead: 'absent'`). No node-id was measured,
 *  so the row is keyed by its label and its install state is `unknown` (spec §8). */
function row(label: string, role: NodeRole, stamp: BuildInfo | null, over: Partial<NodeMeasurement> = {}): NodeMeasurement {
  return {
    nodeId: label, role, label,
    currentVersion: stamp?.version ?? null, currentSha: stamp?.sha ?? null, currentRef: stamp?.ref ?? null,
    currentBuiltAt: stamp?.builtAt ?? null, currentDirty: stamp?.dirty ?? null,
    stampRead: stamp ? 'ok' : 'absent', installState: 'unknown', provenance: 'unknown',
    caps: [], agentOps: role === 'fleet' ? [] : null, highestVersion: null, previousVersion: null, os: 'linux',
    measuredAt: 1_758_000_000_000, report: null,
    ...over,
  };
}

/** Remote-mode deps WITH a coordination database holding `rows`, and with the two OLD sources (`fleetState.build`,
 *  `deps.build`) set to `decoy` — so every case below can tell which source the route read. */
function inventoryDeps(rows: readonly NodeMeasurement[], decoy: { fleet: BuildInfo | null; own: BuildInfo | null }): { deps: Deps; coord: CoordStore } {
  const base = remoteDeps(decoy.fleet, decoy.own);
  const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
  for (const m of rows) expect(coord.upsertNodeMeasurement(m), m.label).toMatchObject({ ok: true });
  return { deps: { ...base, coord }, coord };
}

const FLEET: BuildInfo = { sha: 'abc1234', ref: 'release', builtAt: '2026-09-21T00:00:00Z', dirty: false, version: 'v0.0.11' };
const SERVER: BuildInfo = { ...FLEET, builtAt: '2026-09-21T00:02:00Z' };
const DECOY_FLEET: BuildInfo = { ...OWN, sha: 'dec0y01' };
const DECOY_OWN: BuildInfo = { ...OWN, sha: 'dec0y02' };

describe('buildAgreement — three answers, because "no evidence" is not "disagreement"', () => {
  it('is unknown when the agent reported nothing — an older agent is not a skewed one', () => {
    expect(buildAgreement(null, OWN)).toBe('unknown');
    expect(buildAgreement(undefined, OWN)).toBe('unknown');
  });

  it('is unknown when THIS box has no stamp — a dev checkout has nothing to compare with', () => {
    // The symmetric case, and the one an `===` against `deps.build!` would get
    // wrong: a server running from a git checkout has never been stamped, so it
    // cannot answer whether the fleet host is ahead of it. Saying `'skewed'`
    // here would light the banner on every developer's machine, which is how a
    // banner stops being read.
    expect(buildAgreement(OWN, null)).toBe('unknown');
    expect(buildAgreement(OWN, undefined)).toBe('unknown');
    expect(buildAgreement(null, null)).toBe('unknown');
  });

  it('compares the sha, and a dirty build never agrees even at the same sha', () => {
    expect(buildAgreement({ ...OWN }, OWN)).toBe('agreed');
    expect(buildAgreement({ ...OWN, sha: 'other' }, OWN)).toBe('skewed');
    expect(buildAgreement({ ...OWN, dirty: true }, OWN)).toBe('skewed');
  });

  it('a dirty stamp on THIS box is skew too — the working tree is on either side', () => {
    // `dirty` says "what this box runs is not the commit it names". Whichever
    // box it is true on, the two boxes are not running the same code, and the
    // sha they both print is a lie about at least one of them.
    expect(buildAgreement(OWN, { ...OWN, dirty: true })).toBe('skewed');
    expect(buildAgreement({ ...OWN, dirty: true }, { ...OWN, dirty: true })).toBe('skewed');
  });

  it('ignores version too — two stamps differing only in the tag still compare agreed', () => {
    // Stage 4, Task 1's pin: `buildAgreement` stays sha + dirty ONLY. The sha
    // is the truth and the tag is the label — a tag-equal/sha-differ pair is
    // skew, and a sha-equal pair is agreed whatever either box's tag says
    // (one box stamped by the release job, the other by a deploy of the same
    // commit, is a healthy fleet, not a skewed one).
    expect(buildAgreement({ ...OWN, version: 'v1.2.3' }, OWN)).toBe('agreed');
    expect(buildAgreement({ ...OWN, version: 'v1.2.3' }, { ...OWN, version: 'v9.9.9' })).toBe('agreed');
    expect(buildAgreement({ ...OWN, sha: 'other', version: 'v1.2.3' }, { ...OWN, version: 'v1.2.3' }))
      .toBe('skewed');
  });

  it('ignores ref and builtAt — the same commit deployed twice is not skew', () => {
    // Two boxes are deployed by two runs of `deploy.sh`, minutes apart, and the
    // agent lane goes first by contract (agent-first). `builtAt` therefore
    // ALWAYS differs, and `ref` differs whenever one box was deployed from a
    // branch and the other from the same commit on `main`. Comparing the whole
    // object would report skew on every single healthy deploy.
    expect(buildAgreement({ ...OWN, ref: 'feat/x', builtAt: '2020-01-01T00:00:00Z' }, OWN)).toBe('agreed');
  });
});

describe('GET /api/fleet/health — the skew answer reaches the operator', () => {
  it('reports agreed when both boxes are stamped with the same clean sha', async () => {
    expect(await healthOf(remoteDeps({ ...OWN }, OWN))).toMatchObject({ mode: 'remote', build: 'agreed' });
  });

  it('reports skewed when the fleet host is running a different commit', async () => {
    // The failure this exists for: the link is up, nothing on the dashboard is
    // red, and the two boxes are running different code — a `ccd` verb the
    // server believes exists, a hook writing a field the server does not read.
    // The remedy is to deploy the lagging box, agent-first.
    expect(await healthOf(remoteDeps({ ...OWN, sha: 'f00ba12' }, OWN)))
      .toMatchObject({ connected: true, build: 'skewed' });
  });

  it('reports skewed when the fleet host is running a working tree', async () => {
    expect(await healthOf(remoteDeps({ ...OWN, dirty: true }, OWN))).toMatchObject({ build: 'skewed' });
  });

  it('reports unknown, never skewed, when the fleet host sent no stamp', async () => {
    expect(await healthOf(remoteDeps(null, OWN))).toMatchObject({ build: 'unknown' });
  });

  it('reports unknown when this box was never stamped', async () => {
    expect(await healthOf(remoteDeps({ ...OWN }, null))).toMatchObject({ build: 'unknown' });
  });

  it('local mode reports unknown — one box cannot disagree with itself', async () => {
    // Same stance as `roster` (`'unknown'`, not `'agreed'`): nothing was
    // compared, and a reader that later renders `'agreed'` as a green tick must
    // not be shown one for a check that never ran.
    const health = await healthOf(testDeps());
    expect(health).toMatchObject({ mode: 'local', build: 'unknown' });
  });

  it('carries BOTH stamps as `builds` beside the agreement — version included when a stamp has one (spec §6)', async () => {
    const fleet: BuildInfo = { sha: 'abc1234', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.7' };
    const own: BuildInfo = { ...OWN, version: 'v0.0.9', sha: 'def5678' };
    const h = await healthOf(remoteDeps(fleet, own));
    expect(h['build']).toBe('skewed');
    expect(h['builds']).toEqual({ own, fleet });
  });

  it('`builds` is honest about absence: null per side, never a fabricated stamp', async () => {
    const h = await healthOf(remoteDeps(null, OWN));
    expect(h['build']).toBe('unknown');
    expect(h['builds']).toEqual({ own: OWN, fleet: null });
  });
});

describe('derivedBuilds — the pair as a view of the node rows (design 2026-09-20 §14)', () => {
  const A: BuildInfo = { ...OWN, sha: 'aaaaaaa' };
  const B: BuildInfo = { ...OWN, sha: 'bbbbbbb' };
  const C: BuildInfo = { ...OWN, sha: 'ccccccc' };

  it('no rows is no evidence on either side', () => {
    expect(derivedBuilds([])).toEqual({ own: null, fleet: null });
  });

  it('own is the server-role row, fleet the fleet-role row, whichever order they arrive in', () => {
    const s: BuildSource = { role: 'server', build: A };
    const f: BuildSource = { role: 'fleet', build: B };
    expect(derivedBuilds([s, f])).toEqual({ own: A, fleet: B });
    expect(derivedBuilds([f, s])).toEqual({ own: A, fleet: B });
  });

  it("a 'both' row is this box — the single-box shape records role both", () => {
    expect(derivedBuilds([{ role: 'both', build: A }])).toEqual({ own: A, fleet: null });
  });

  it('the FIRST row of a role decides, and a later row never backfills its null', () => {
    // The first live fleet-role row IS the fleet node (spec §14); a row after it is a second connection this
    // build has no label for (D-3184), and borrowing its stamp would describe a node nobody asked about.
    expect(derivedBuilds([{ role: 'fleet', build: B }, { role: 'fleet', build: C }])).toEqual({ own: null, fleet: B });
    expect(derivedBuilds([{ role: 'fleet', build: null }, { role: 'fleet', build: C }])).toEqual({ own: null, fleet: null });
    expect(derivedBuilds([{ role: 'server', build: null }, { role: 'both', build: A }])).toEqual({ own: null, fleet: null });
  });

  it('a row whose role is outside the vocabulary names neither side', () => {
    // `nodes.role` reads `null` for a token a newer build wrote (D-3181); it is not this box and
    // not the fleet box, so it must not be either.
    expect(derivedBuilds([{ role: null, build: A }])).toEqual({ own: null, fleet: null });
  });
});

describe('GET /api/fleet/health — `builds` is derived from the inventory when one is wired (design 2026-09-20 §14)', () => {
  async function health(deps: Deps, coord: CoordStore): Promise<Record<string, unknown>> {
    try { return await healthOf(deps); } finally { coord.db.close(); }
  }

  it('reads the two rows, not the boot stamp and the handshake stamp', async () => {
    // The decoys disagree with each other (the OLD source would answer `skewed`); the rows agree. Only a route that
    // reads the rows answers `agreed` with these stamps.
    const { deps, coord } = inventoryDeps(
      [row('server', 'server', SERVER), row(FLEET_LABEL, 'fleet', FLEET)],
      { fleet: DECOY_FLEET, own: DECOY_OWN });
    const h = await health(deps, coord);
    expect(h['build']).toBe('agreed');
    expect(h['builds']).toEqual({ own: SERVER, fleet: FLEET });
  });

  it('a dirty fleet row reads skewed — dirty survives the five current* columns (§18 "a full BuildInfo round-trips")', async () => {
    // Decoys agree and are clean: the old source would answer `agreed`. A dropped `currentDirty` column, or a
    // `buildInfoOfRow` that forgets it, turns this back into `agreed`.
    const dirty: BuildInfo = { ...FLEET, dirty: true };
    const { deps, coord } = inventoryDeps(
      [row('server', 'server', SERVER), row(FLEET_LABEL, 'fleet', dirty)],
      { fleet: OWN, own: OWN });
    const h = await health(deps, coord);
    expect(h['build']).toBe('skewed');
    expect(h['builds']).toEqual({ own: SERVER, fleet: dirty });
  });

  it('a row whose stamp did not read ok is null on that side, whatever its current* columns hold', async () => {
    // `unreadable` (EACCES, a symlink, an agent that refuses the read) and `malformed` are both "no evidence":
    // the answer is `unknown`, never a stamp and never `skewed`. The columns are planted non-null on purpose —
    // the gate is `stampRead`, not the columns happening to be empty.
    for (const stampRead of ['unreadable', 'malformed'] as const) {
      const { deps, coord } = inventoryDeps(
        [row('server', 'server', SERVER), row(FLEET_LABEL, 'fleet', FLEET, { stampRead })],
        { fleet: SERVER, own: SERVER });
      const h = await health(deps, coord);
      expect(h['build'], stampRead).toBe('unknown');
      expect(h['builds'], stampRead).toEqual({ own: SERVER, fleet: null });
    }
  });

  it('no rows yet is unknown on both sides — the handshake stamp is never read as current (spec §8)', async () => {
    // Before the first sweep writes a row. The decoys agree; a route that fell back to them would say `agreed`.
    const { deps, coord } = inventoryDeps([], { fleet: OWN, own: OWN });
    const h = await health(deps, coord);
    expect(h['build']).toBe('unknown');
    expect(h['builds']).toEqual({ own: null, fleet: null });
  });

  it('a superseded label row is invisible to `builds` (§18 "a superseded row is invisible")', async () => {
    // The label row sorts FIRST (`nodes()` orders by label; 'a-…' < 'fleet'), so a reader that stopped filtering
    // `supersededBy` would take the stale stamp as the fleet side.
    const FLEET_ID = '3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b';
    const stale: BuildInfo = { ...FLEET, sha: '0ldc0de', version: 'v0.0.3' };
    const { deps, coord } = inventoryDeps(
      [row('server', 'server', SERVER), row('a-old-connection', 'fleet', stale),
        row(FLEET_LABEL, 'fleet', FLEET, { nodeId: FLEET_ID })],
      { fleet: stale, own: SERVER });
    // `retired: 0` — Task 5's `RekeyNodeResult` carries the count of OTHER live rows under this label it retired;
    // the only other row here carries label `fleet`, not `a-old-connection`.
    expect(coord.rekeyNode('a-old-connection', FLEET_ID)).toEqual({ ok: true, how: 'superseded', retired: 0, revived: false });
    const h = await health(deps, coord);
    expect(h['builds']).toEqual({ own: SERVER, fleet: FLEET });
    expect(h['build']).toBe('agreed');
  });

  it('an unreachable fleet row keeps its last measured stamp, as the handshake field did across a disconnect', async () => {
    const { deps, coord } = inventoryDeps(
      [row('server', 'server', SERVER), row(FLEET_LABEL, 'fleet', FLEET)],
      { fleet: null, own: null });
    expect(coord.markUnreachable(FLEET_LABEL, 'fleet', 1_758_000_060_000)).toMatchObject({ ok: true, created: false });
    const h = await health(deps, coord);
    expect(h['builds']).toEqual({ own: SERVER, fleet: FLEET });
  });

  it("an older PWA's reading of `builds` is unchanged — the same stamps through either source are the same JSON", async () => {
    // The field's readers today are `BuildLine` and `FleetHostBanner`'s skewed arm (pwa/src/fleet/), both of which
    // read `version` by type (`typeof b.version === 'string'`, `b.version ?? …`). `toStrictEqual` on the PARSED
    // body is the whole contract they see: an unversioned stamp must arrive with NO `version` key — not
    // `version: null` — and a versioned one with it, exactly as `parseBuildInfo` shapes the boot and handshake reads.
    const unversioned: BuildInfo = { sha: 'abc1234', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false };
    for (const [ownStamp, fleetStamp] of [[SERVER, FLEET], [unversioned, FLEET], [SERVER, { ...unversioned, dirty: true }]] as const) {
      const before = await healthOf(remoteDeps(fleetStamp, ownStamp));
      const { deps, coord } = inventoryDeps(
        [row('server', 'server', ownStamp), row(FLEET_LABEL, 'fleet', fleetStamp)],
        { fleet: null, own: null });
      const after = await health(deps, coord);
      expect(after['builds'], JSON.stringify([ownStamp, fleetStamp])).toStrictEqual(before['builds']);
      expect(after['build']).toBe(before['build']);
    }
    const { deps, coord } = inventoryDeps([row('server', 'server', unversioned)], { fleet: null, own: null });
    const own = ((await health(deps, coord))['builds'] as { own: Record<string, unknown> }).own;
    expect('version' in own).toBe(false);
  });
});

/** Writes `~/.ccrc/build.json` exactly as `deploy/deploy.sh`'s `stamp_build`
 *  does — the file the agent reads on every `ready`. */
function writeStamp(home: string, stamp: BuildInfo): void {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'build.json'), `${JSON.stringify(stamp)}\n`);
}

describe('end to end — a stamp on the fleet host\'s disk becomes an answer on the route', () => {
  // WHY THIS IS NOT REDUNDANT with the two describes above. Everything this
  // field touches is optional: `AgentReady.build` is optional so an older agent
  // stays legal, and `FleetHealth.build` is optional so an older server's
  // response still parses. Optional at both ends means the compiler is silent
  // about a field that is never sent, never read, or read off the wrong frame —
  // the send site inherits it silently, and the route can simply not mention
  // it. Only a test that runs the whole path can fail on that, so this one
  // boots a REAL `ccrc-agent` against a fixture $HOME, connects a REAL
  // `connectFleet` client over a real loopback socket, and hands that live
  // `fleet.state` to a REAL `buildServer` — no fakes anywhere between the file
  // on disk and the JSON on the route.
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  /** Boots the agent over a fixture home holding `stamp` (or none), connects a
   *  real client, and returns it once the handshake has landed. */
  async function liveFleet(stamp: BuildInfo | null): Promise<ConnectedFleet> {
    fixture = makeFixture();
    if (stamp) writeStamp(fixture.home, stamp);
    agent = await bootAgent(fixture);
    const f = connectToAgent(agent.port);
    await vi.waitFor(() => expect(f.state.connected).toBe(true), { timeout: 3000 });
    return f;
  }

  /** A real remote-mode server over a live client's state — `fleetState` is the
   *  very object `FleetClient.onReady` mutates, exactly as `index.ts` wires it. */
  async function healthOverWire(live: ConnectedFleet, ownBuild: BuildInfo | null): Promise<Record<string, unknown>> {
    const home = mkTmp('ccrc-skew-e2e-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
    const app = await buildServer({
      cfg, build: ownBuild, runCcd: ccdRunner(deadRunner, cfg), tmux: new Tmux(deadRunner),
      io: localIO, fleetState: live.state, queue: new KeyedQueue(),
    });
    try {
      return (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
    } finally {
      await app.close();
    }
  }

  it('the fleet host\'s stamp arrives on the client state and reads as agreed', async () => {
    fleet = await liveFleet(OWN);
    // The travelling value itself, before any comparison — this is the
    // assertion that fails if `onReady` never reads `frame.build`.
    expect(fleet.state.build).toEqual(OWN);
    expect(await healthOverWire(fleet, OWN)).toMatchObject({ mode: 'remote', connected: true, build: 'agreed' });
  });

  it('a stamp carrying a release version crosses the wire intact', async () => {
    // Stage 4, Task 1: the ready frame's build is revalidated through
    // `parseBuildInfo` on arrival (`remote/client.ts`), so a validator that
    // dropped or rejected the additive `version` field would silently strip
    // the tag — or discard the whole stamp — between the fleet host's disk
    // and this assertion.
    const tagged = { ...OWN, version: 'v1.2.3' };
    fleet = await liveFleet(tagged);
    expect(fleet.state.build).toEqual(tagged);
    expect(await healthOverWire(fleet, OWN)).toMatchObject({ build: 'agreed' });
  });

  it('a fleet host on a different commit reads as skewed', async () => {
    const theirs = { ...OWN, sha: 'deadbee', builtAt: '2026-08-14T00:00:00Z' };
    fleet = await liveFleet(theirs);
    expect(fleet.state.build).toEqual(theirs);
    expect(await healthOverWire(fleet, OWN)).toMatchObject({ build: 'skewed' });
  });

  it('a fleet host with no stamp on disk reads as unknown while fully connected', async () => {
    // Absence of evidence across the real wire: the agent omits the field, the
    // client records null, the route says `'unknown'` — with `connected: true`
    // alongside it, so nothing about this looks like a link problem either.
    fleet = await liveFleet(null);
    expect(fleet.state.build).toBeNull();
    expect(await healthOverWire(fleet, OWN)).toMatchObject({ connected: true, build: 'unknown' });
  });

  it('a stamp the fleet host could not parse reads as unknown, not skewed', async () => {
    // A torn or hand-edited `build.json`. The agent omits it (proven in
    // `agent/test/build-fp.test.ts`); what this pins is that the omission
    // survives the whole path as "no evidence" rather than turning into an
    // alarm somewhere downstream.
    fixture = makeFixture();
    mkdirSync(path.join(fixture.home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(fixture.home, '.ccrc', 'build.json'), '{ not json');
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    expect(fleet.state.build).toBeNull();
    expect(await healthOverWire(fleet, OWN)).toMatchObject({ build: 'unknown' });
  });

  it('a redeploy of the fleet host is picked up on reconnect, not remembered stale', async () => {
    // `onReady` must RESET the field on every handshake, the same way `rosterFp`
    // does: a client that kept the stamp from the connection before would keep
    // reporting skew after the lagging box was deployed — the operator does the
    // remedy, the banner stays lit, and the next real skew is ignored.
    const stale = { ...OWN, sha: '0ldc0de' };
    fleet = await liveFleet(stale);
    expect(fleet.state.build).toEqual(stale);
    expect(await healthOverWire(fleet, OWN)).toMatchObject({ build: 'skewed' });

    writeStamp(fixture!.home, OWN);
    fleet.client.ws?.close();
    await vi.waitFor(() => expect(fleet!.state.build).toEqual(OWN), { timeout: 3000 });
    expect(await healthOverWire(fleet, OWN)).toMatchObject({ build: 'agreed' });
  });

  it('a fleet host that STOPS reporting a stamp goes back to unknown, not to the old one', async () => {
    // The other half of "reset on every ready", and the half a reader that only
    // assigns when the field is present would fail: the stamp going away is a
    // real transition — a re-imaged box, a stamp write that failed, an agent
    // rolled back to a build that predates the field — and a client that kept
    // the previous connection's value would answer with the sha of a build
    // nobody is running any more. That is worse than `'unknown'`, because it is
    // indistinguishable from a live measurement.
    fleet = await liveFleet(OWN);
    expect(fleet.state.build).toEqual(OWN);

    rmSync(path.join(fixture!.home, '.ccrc', 'build.json'));
    fleet.client.ws?.close();
    await vi.waitFor(() => expect(fleet!.state.build).toBeNull(), { timeout: 3000 });
    expect(await healthOverWire(fleet, OWN)).toMatchObject({ connected: true, build: 'unknown' });
  });

  it('the fleet host\'s stamp reaches `builds` through the INVENTORY — agent read, sweep, row, route', async () => {
    // The whole W2 path with no fakes: a real agent admits `~/.ccrc/build.json` through the exact-basename read set
    // (Task 8), `sweepInventory` measures it over the live socket (Task 11), the row lands in a real coord.db, and
    // the route derives from the row. The server's config points at the agent's fixture HOME — the
    // same-absolute-path assumption every remote read makes (Global Constraints) — so the server row measures the
    // same file. `fleetState.build` is nulled and `deps.build` is null: the old sources would answer `unknown`.
    const tagged: BuildInfo = { ...OWN, version: 'v0.0.9' };
    fleet = await liveFleet(tagged);
    seedRoster(fixture!.home);
    const cfg = loadConfig({ CCRC_HOME: fixture!.home, CCRC_FLEET: 'remote' });
    const coord = new CoordStore(openCoordDb(cfg.coordDbPath));
    try {
      const outcomes = await sweepInventory({
        store: coord, localIo: localIO, ccrcDir: cfg.ccrcDir, role: cfg.role,
        fleet: { io: fleet.io, state: fleet.state },
      }, Date.now());
      expect(outcomes.find((o) => o.label === FLEET_LABEL)).toMatchObject({ result: 'measured' });
      expect(coord.nodeByLabel(FLEET_LABEL)?.stampRead).toBe('ok');
      const app = await buildServer({
        cfg, build: null, runCcd: ccdRunner(deadRunner, cfg), tmux: new Tmux(deadRunner),
        io: localIO, fleetState: { ...fleet.state, build: null }, queue: new KeyedQueue(), coord,
      });
      try {
        const h = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
        expect(h['build']).toBe('agreed');
        expect(h['builds']).toEqual({ own: tagged, fleet: tagged });
      } finally {
        await app.close();
      }
    } finally {
      coord.db.close();
    }
  });
});
