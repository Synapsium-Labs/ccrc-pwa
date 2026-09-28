// Design 2026-09-20 §10 — the dispatcher's ACT (`runDispatch`, server/src/update/converge.ts) end to end, over
// a real CoordStore on an `mkTmp` coord.db: the lease is acquired by Task 3's real `dispatchNode`, the op is
// "sent" through a recording SendUpdateOp, the server-role node is spawned through `spawnFromRunner` (the double for
// `localUpdateSpawnFor`) over a recording Runner, and every settle and release is W2's own writers — including the sweep's, driven through
// W2's `sweepPlanFor` in the sweep's own order. Nothing here reads the live $HOME, spawns a real `ccrc` or
// talks to a real agent: the link is a function, the spawn is a recorder, the node files live under a fixture
// HOME.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UPDATE_SPAWN_TIMEOUT_MS, type ResOk } from '../../shared/agent-protocol.js';
import type { NodeRole, RequestKind } from '../../shared/api.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import { realRunner, type ExecResult, type Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import { localIO, type FleetIO } from '../src/io.js';
import { AgentOpError } from '../src/remote/client.js';
import type { Deps } from '../src/server.js';
import {
  LINK_DOWN_DETAIL, LOCAL_SPAWNING_DETAIL, NO_FLEET_LINK_DETAIL, NO_LOCAL_RUNNER_DETAIL, SPAWN_TIMEOUT_MESSAGE,
  dispatchViewsFor, inFlightSentence, localUpdateSpawnFor, runDispatch,
  type ConvergeDeps, type DispatchRunResult, type LocalUpdateSpawn, type SendUpdateOp,
} from '../src/update/converge.js';
import { AGENT_REJECTED_DETAIL, DEADLINE_DETAIL } from '../src/update/dispatch.js';
import { FLEET_LABEL, SERVER_LABEL, sweepPlanFor, type SweepPlan } from '../src/update/inventory.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { spawnFromRunner } from './updateSpawnFake.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const DEADLINE = 900_000;
const FLEET_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const SERVER_ID = '05050505-0505-4505-8505-050505050505';
const ACCEPTED: ResOk = { t: 'res', id: 1, ok: true, accepted: true };
const LAUNCHER_ARGV = ['update', '--to', 'v0.0.10', '--detach', '--from', 'pwa'];
const IN_FLIGHT = 'update.json says installing (target v0.0.10, started 1790000000)';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const url = (tag: string): string => `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`;
const rel = (tag: string, publishedAt: number): ReleaseListingRow => ({
  tag, channel: 'stable', publishedAt, commitSha: null, tarballUrl: url(tag), bundleListed: true, notes: null, draft: false,
});
const seedReleases = (store: CoordStore): void => {
  expect(store.applyReleaseListing([rel('v0.0.8', T0 - 3000), rel('v0.0.9', T0 - 2000), rel('v0.0.10', T0 - 1000)],
    T0 - 500, 'complete').ok).toBe(true);
};

/** A clean fleet-node measurement: link-reached (its agentOps names the op), every cap both argvs need. */
const fleetMeas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor', 'update-json', 'detach', 'rollback'], agentOps: ['update'],
  highestVersion: 'v0.0.9', previousVersion: 'v0.0.8', floorRead: 'measured', previousRead: 'measured', os: 'linux', measuredAt: T0, report: null, ...over,
});
/** The server's own row: spawned locally, `agentOps` NULL by construction (decision 11). */
const serverMeas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement =>
  fleetMeas({ nodeId: SERVER_ID, role: 'server', label: SERVER_LABEL, agentOps: null, ...over });

/** What W2's inventory sweep does with ONE measurement, in its own order (`applyMeasurement`: plan against the
 *  pre-upsert row → upsert → refuse → lease), through W2's own writers — so a lease this task acquired is
 *  settled or released by the same plan and the same writers production uses. TWO differences, deliberate. It skips `applyMeasurement`'s collision check, its re-key and its read-state overrides (the unmeasured floor/previous/report carries and the stamp-unmeasured report restore): every measurement below is fully read, with `stampRead: 'ok'`, into an existing UUID row, so none of them would fire. And the
 *  writers' `expectedStartedAt` is passed `null` here — `applyMeasurement` computes it inline
 *  (`preRow === null ? null : preRow.updateStartedAt`, not a named helper), and this harness has no `preRow` of
 *  its own to read it from — so the store's identity guard is not exercised by this file. W2's
 *  `update-inventory.test.ts` and `update-store-nodes.test.ts` pin it, and every report below starts after the
 *  lease it reports on. */
const sweepOnce = (store: CoordStore, m: NodeMeasurement): SweepPlan => {
  const plan = sweepPlanFor(store.node(m.nodeId), m);
  expect(store.upsertNodeMeasurement(m).ok).toBe(true);
  if (plan.refuse !== null) store.refuseRelease(m.nodeId, plan.refuse.tag, m.measuredAt, plan.refuse.detail);
  if (plan.lease.kind === 'settle') store.settleNode(m.nodeId, plan.lease.detail, null);
  if (plan.lease.kind === 'release') store.releaseLease(m.nodeId, plan.lease.to, plan.lease.detail, null);
  return plan;
};

interface Harness {
  store: CoordStore; home: string; state: FleetState; deps: ConvergeDeps;
  sent: { tag: string; kind: RequestKind }[]; spawned: { cmd: string; args: string[] }[]; accepted: () => number;
}

/** A fixture coord.db with three listed stable releases, a connected link whose live agentOps names the op, a
 *  recording send (default: accepted) and a recording Runner behind `spawnFromRunner` (default: exit 0). */
function harness(o: {
  send?: SendUpdateOp; run?: Runner; boundMs?: number; noLocal?: true; agentOps?: readonly string[]; role?: NodeRole; localIo?: FleetIO;
} = {}): Harness {
  const home = mkTmp('update-converge-');
  const store = new CoordStore(openCoordDb(path.join(home, 'coord.db')));
  seedReleases(store);
  const sent: Harness['sent'] = [];
  const spawned: Harness['spawned'] = [];
  const state: FleetState = {
    connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, agentOps: o.agentOps ?? ['update'],
  };
  let accepted = 0;
  const send: SendUpdateOp = o.send ?? (async () => ACCEPTED);
  const run: Runner = o.run ?? (async (): Promise<ExecResult> => ({ code: 0, stdout: '', stderr: '' }));
  const recording: Runner = (cmd, args) => { spawned.push({ cmd, args }); return run(cmd, args); };
  const deps: ConvergeDeps = {
    store, role: o.role ?? 'server', ccrcDir: path.join(home, '.ccrc'), localIo: o.localIo ?? localIO,
    deadlineMs: DEADLINE,
    fleet: { state, send: (tag, kind) => { sent.push({ tag, kind }); return send(tag, kind); } },
    runLocal: o.noLocal === true ? null : spawnFromRunner(recording, home, o.boundMs),
    onAccepted: () => { accepted += 1; },
  };
  return { store, home, state, deps, sent, spawned, accepted: () => accepted };
}

const seedFleet = (h: Harness, tag: string | null = 'v0.0.10', over: Partial<NodeMeasurement> = {}): void => {
  expect(h.store.upsertNodeMeasurement(fleetMeas(over)).ok).toBe(true);
  if (tag !== null) expect(h.store.requestNode(FLEET_ID, tag, 'update', T0).ok).toBe(true);
};
const seedServer = (h: Harness, tag: string | null = 'v0.0.10', over: Partial<NodeMeasurement> = {}): void => {
  expect(h.store.upsertNodeMeasurement(serverMeas(over)).ok).toBe(true);
  if (tag !== null) expect(h.store.requestNode(SERVER_ID, tag, 'update', T0).ok).toBe(true);
};

type Ran = Extract<DispatchRunResult, { ran: true }>;
const ran = (r: DispatchRunResult): Ran => {
  if (!r.ran) throw new Error(`the dispatch run did not run: ${r.why}`);
  return r;
};

/** A local io whose update.json answers `absent` at once — no fs promise between the acquire and the spawn. The busy
 *  read goes through W2's `readNodeFile`, whose FIRST call is `lstatMeasured`, so that is the one that must answer. */
const absentIo: FleetIO = {
  ...localIO,
  lstatMeasured: async () => ({ ok: false, reason: 'absent' }),
  readFileMeasured: async () => ({ ok: false, reason: 'absent' }),
};

describe('runDispatch — one node at a time, fleet first (spec §10 Pins)', () => {
  it('two requested nodes: ONE op per run, the fleet node first; the server node moves only after W2\'s sweep settles the fleet node (§18 "one dispatch per sweep", "fleet before server")', async () => {
    const h = harness();
    seedFleet(h);
    seedServer(h);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(h.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(h.spawned).toEqual([]);
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: 'v0.0.10' });

    // The lease is held: a second run moves nobody, however many nodes are waiting.
    const r2 = ran(await runDispatch(h.deps, T0 + 2000));
    expect(r2.outcome).toBeNull();
    expect(r2.plan.gate.leaseHeldBy).toBe(FLEET_ID);
    expect(h.sent).toHaveLength(1);
    expect(h.spawned).toEqual([]);

    // The sweep sees `done` with the stamp at the target and settles the fleet row — W2's writer, not ours.
    const swept = sweepOnce(h.store, fleetMeas({
      currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', measuredAt: T0 + 60_000,
      report: { phase: 'done', target: 'v0.0.10', startedAt: T0 + 6000, updatedAt: T0 + 50_000, detail: null },
    }));
    expect(swept.lease.kind).toBe('settle');
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', requestedTag: null });

    const r3 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r3.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    expect(h.sent).toHaveLength(1);   // the server node is never sent the op over the link
  });

  it('a fleet request the dispatcher refuses holds the server until W2\'s ackNode clears it; the next run moves the server (D-3381, the acked way out)', async () => {
    const h = harness();
    seedFleet(h, 'v0.0.10', { caps: ['verify', 'node-id', 'floor', 'update-json'] });
    seedServer(h);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toBeNull();
    expect(h.spawned).toEqual([]);
    expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^no-detach-cap — /);
    expect(h.store.node(SERVER_ID)?.updateDetail).toMatch(/^waiting-for-fleet — /);
    expect(h.store.ackNode(FLEET_ID).ok).toBe(true);
    const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r2.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    expect(h.sent).toEqual([]);
  });

  it('accepted HOLDS the lease: the row stays pending with its request, and the inventory is asked once (§18 "`accepted` does not settle", "a one-tap is a row")', async () => {
    const h = harness();
    seedFleet(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: FLEET_ID, result: 'accepted', detail: 'accepted — the node queued a detached run' });
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'pending', updateTarget: 'v0.0.10', updateStartedAt: T0 + 1000,
      requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: T0,
    });
    expect(h.accepted()).toBe(1);
  });

  it('the row reads pending while the report says installing, and a report updatedAt inside the deadline keeps the lease (D-3382)', async () => {
    const h = harness();
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    const swept = sweepOnce(h.store, fleetMeas({
      measuredAt: T0 + DEADLINE,
      report: { phase: 'installing', target: 'v0.0.10', startedAt: T0 + 6000, updatedAt: T0 + DEADLINE - 4000, detail: 'placing the tree' },
    }));
    expect(swept.lease.kind).toBe('none');
    const r = ran(await runDispatch(h.deps, T0 + 1000 + DEADLINE + 1));
    expect(r.expired).toEqual([]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', reportedPhase: 'installing' });
  });
});

describe('runDispatch — the answer decides only what happens to the lease (§18 "a refusal releases in the same turn", "a refusal does not consume the request")', () => {
  it('busy → idle in the same run, with what the node said; the request stands; re-sent on the NEXT run only, never halting (Review Focus 3)', async () => {
    const h = harness({ send: async () => { throw new AgentOpError('busy', IN_FLIGHT); } });
    seedFleet(h);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toEqual({ nodeId: FLEET_ID, result: 'released', to: 'idle', detail: `busy — ${IN_FLIGHT}` });
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateDetail: `busy — ${IN_FLIGHT}`, requestedTag: 'v0.0.10', requestedKind: 'update',
    });
    expect(h.sent).toHaveLength(1);
    const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(h.sent).toHaveLength(2);
    expect(r2.plan.gate.haltedBy).toEqual([]);
    expect(h.store.node(FLEET_ID)?.updateState).toBe('idle');
    expect(h.accepted()).toBe(0);
  });

  it('bad-request from an agent whose LIVE ops name the op → failed, the spec\'s sentence, and the next run is halted (§18 "`bad-request` from an advertising agent halts")', async () => {
    const h = harness({ send: async () => { throw new AgentOpError('bad-request', null); } });
    seedFleet(h);
    seedServer(h);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toEqual({ nodeId: FLEET_ID, result: 'released', to: 'failed', detail: AGENT_REJECTED_DETAIL });
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: AGENT_REJECTED_DETAIL, requestedTag: 'v0.0.10' });
    const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r2.outcome).toBeNull();
    expect(r2.plan.gate.haltedBy).toEqual([FLEET_ID]);
    expect(h.spawned).toEqual([]);
    // The halt lasts until `ack`: W2's ackNode returns the row to idle and clears its request, and the next
    // run is no longer halted — the server, still requested, moves.
    expect(h.store.ackNode(FLEET_ID).ok).toBe(true);
    const r3 = ran(await runDispatch(h.deps, T0 + 121_000));
    expect(r3.plan.gate.haltedBy).toEqual([]);
    expect(r3.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    expect(h.sent).toHaveLength(1);
  });

  it('bad-request after the live ops dropped mid-dispatch → idle with the skew sentence; once the row is re-measured without the op it is never sent again', async () => {
    let h: Harness | null = null;
    h = harness({ send: async () => { h!.state.agentOps = []; throw new AgentOpError('bad-request', null); } });
    seedFleet(h);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'released', to: 'idle' });
    expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^agent-predates-update-op — /);
    expect(h.store.node(FLEET_ID)?.requestedTag).toBe('v0.0.10');
    sweepOnce(h.store, fleetMeas({ agentOps: [], measuredAt: T0 + 2000 }));
    ran(await runDispatch(h.deps, T0 + 3000));
    expect(h.sent).toHaveLength(1);
  });

  it('bad-tag → failed', async () => {
    const h = harness({ send: async () => { throw new AgentOpError('bad-tag', null); } });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: 'agent refused the op: bad-tag' });
  });

  it('a server-role spawn that exits 1 on the lock → failed, carrying the parent\'s FIRST stderr line (Review Focus 3)', async () => {
    const lock = 'ccrc: update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)';
    const h = harness({ run: async () => ({ code: 1, stdout: '', stderr: `${lock}\nsecond line` }) });
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'released', to: 'failed', detail: `spawn-failed — ${lock}` });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
  });

  it('a server-role spawn that exits non-zero with NO stderr names its exit, not the generic "no message" a missing launcher would share with a silent failure (Task 5 review finding 3)', async () => {
    const h = harness({ run: async () => ({ code: 1, stdout: '', stderr: '' }) });
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({
      nodeId: SERVER_ID, result: 'released', to: 'failed', detail: 'spawn-failed — exit 1 with no stderr from the launcher',
    });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'failed', updateDetail: 'spawn-failed — exit 1 with no stderr from the launcher' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
  });

  it('an ok reply without accepted: true → failed, named (D-3399)', async () => {
    const h = harness({ send: async () => ({ t: 'res', id: 1, ok: true }) });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: 'agent answered ok-without-accepted' });
  });

  it('disconnected during the send → idle, the request standing; not sent while the sweep says unreachable; sent again once measured reachable', async () => {
    let calls = 0;
    const h = harness({ send: async () => { calls += 1; if (calls === 1) throw new Error('disconnected'); return ACCEPTED; } });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateDetail: 'disconnected — the node dropped mid-dispatch; the request stands', requestedTag: 'v0.0.10',
    });
    expect(h.store.markUnreachable(FLEET_LABEL, 'fleet', T0 + 2000).ok).toBe(true);
    ran(await runDispatch(h.deps, T0 + 2500));
    expect(h.sent).toHaveLength(1);
    sweepOnce(h.store, fleetMeas({ measuredAt: T0 + 3000 }));
    ran(await runDispatch(h.deps, T0 + 3500));
    expect(h.sent).toHaveLength(2);
    expect(h.store.node(FLEET_ID)?.updateState).toBe('pending');
  });

  it('a send that timed out, then a node that converged out of band → the next run settles the request `met`, and sends nothing (Review Focus 1)', async () => {
    const h = harness({ send: async () => { throw new Error('timeout'); } });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateDetail: 'timeout — the node dropped mid-dispatch; the request stands', requestedTag: 'v0.0.10',
    });
    // The detached run the op started finished anyway; the sweep measures the new stamp on an idle row.
    expect(sweepOnce(h.store, fleetMeas({ currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', measuredAt: T0 + 120_000 }))
      .lease.kind).toBe('none');
    const r = ran(await runDispatch(h.deps, T0 + 121_000));
    expect(r.settled).toEqual([FLEET_ID]);
    expect(r.outcome).toBeNull();
    expect(h.sent).toHaveLength(1);
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateDetail: 'met: v0.0.10', requestedTag: null, requestedKind: null, requestedAt: null,
    });
  });
});

describe('runDispatch — a node that cannot be sent the op is never sent it, and takes no lease (§18 "an agent without the op is never sent it")', () => {
  it('a row measured with agentOps [] gets no frame — the planner\'s refusal, noted', async () => {
    const h = harness({ agentOps: [] });
    seedFleet(h, 'v0.0.10', { agentOps: [] });
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toBeNull();
    expect(h.sent).toEqual([]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateStartedAt: null, requestedTag: 'v0.0.10' });
    expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^agent-predates-update-op — /);
  });

  it('a row that advertises the op while the LIVE link does not (or has sent no ready) gets no frame and no lease (D-3398)', async () => {
    for (const live of [[], undefined] as const) {
      const h = harness();
      h.state.agentOps = live;
      seedFleet(h);
      const r = ran(await runDispatch(h.deps, T0 + 1000));
      expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'not-sent' });
      expect(h.sent).toEqual([]);
      expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateStartedAt: null, requestedTag: 'v0.0.10' });
      expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^agent-predates-update-op — /);
      // `not-sent` is transient: the next `ready` names the op, and the standing request is sent on the next run.
      h.state.agentOps = ['update'];
      const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
      expect(r2.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
      expect(h.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
      expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10' });
    }
  });

  it('a link that is down gets no frame and no lease', async () => {
    const h = harness();
    h.state.connected = false;
    seedFleet(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: FLEET_ID, result: 'not-sent', detail: LINK_DOWN_DETAIL });
    expect(h.sent).toEqual([]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: LINK_DOWN_DETAIL, updateStartedAt: null });
    // The reconnect: the standing request is sent on the next run.
    h.state.connected = true;
    const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r2.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(h.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10' });
  });

  it('no fleet link wired at all → a link-reached row is noted NO_FLEET_LINK_DETAIL, sent nothing, and takes no lease', async () => {
    const h = harness();
    h.deps.fleet = null;
    seedFleet(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: FLEET_ID, result: 'not-sent', detail: NO_FLEET_LINK_DETAIL });
    expect(h.sent).toEqual([]);
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateStartedAt: null, updateDetail: NO_FLEET_LINK_DETAIL, requestedTag: 'v0.0.10',
    });
  });

  it('no local spawner → the server row is noted and takes no lease', async () => {
    const h = harness({ noLocal: true });
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'not-sent', detail: NO_LOCAL_RUNNER_DETAIL });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', updateDetail: NO_LOCAL_RUNNER_DETAIL, updateStartedAt: null });
  });

  it('a fleet-role server does not dispatch at all', async () => {
    const h = harness({ role: 'fleet' });
    seedFleet(h);
    expect(await runDispatch(h.deps, T0 + 1000)).toEqual({ ran: false, why: 'not-server-role' });
    expect(h.sent).toEqual([]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: null, updateStartedAt: null });
  });
});

describe('runDispatch — the deadline (§18 "the deadline bounds a node that never wrote")', () => {
  it('a lease whose node never wrote a report stands at deadline − 1, fails `deadline` at + 1 with the request standing, and halts the server\'s turn', async () => {
    const h = harness();
    seedFleet(h);
    seedServer(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    const before = ran(await runDispatch(h.deps, T0 + 1000 + DEADLINE - 1));
    expect(before.expired).toEqual([]);
    expect(h.store.node(FLEET_ID)?.updateState).toBe('pending');
    const after = ran(await runDispatch(h.deps, T0 + 1000 + DEADLINE + 1));
    expect(after.expired).toEqual([FLEET_ID]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: DEADLINE_DETAIL, requestedTag: 'v0.0.10' });
    expect(after.plan.gate.haltedBy).toEqual([FLEET_ID]);
    expect(after.outcome).toBeNull();
    expect(h.spawned).toEqual([]);
  });
});

describe('runDispatch — the server-role spawn (§18 "the spawn argv is absolute", D-3397)', () => {
  it('spawns exactly the absolute launcher and the update template, and never uses the link', async () => {
    const h = harness();
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    expect(h.sent).toEqual([]);
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10' });
  });

  it('localUpdateSpawnFor throws RangeError on a non-tag BEFORE running anything', () => {
    // The REAL capability, over a home with no launcher in it: a throw here is before any spawn is attempted,
    // and a spawn that WAS attempted would answer `could not start the launcher` instead of throwing.
    const spawn: LocalUpdateSpawn = localUpdateSpawnFor(mkTmp('update-converge-spawn-'));
    expect(() => spawn('update', '; rm -rf ~')).toThrow(RangeError);
    expect(() => spawn('reinstall' as RequestKind, 'v0.0.9')).toThrow(RangeError);
    // The double keeps the same contract: it throws before its runner is called.
    const calls: string[][] = [];
    const doubled = spawnFromRunner(async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; }, '/h');
    expect(() => doubled('update', '; rm -rf ~')).toThrow(RangeError);
    expect(calls).toEqual([]);
  });

  it('an in-flight update.json on the server box answers busy and spawns nothing (D-3384)', async () => {
    const h = harness();
    mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(h.home, '.ccrc', 'update.json'),
      '{"target":"v0.0.10","phase":"installing","startedAt":1790000000,"updatedAt":1790000005,"detail":null,"from":"cli","pid":7}\n');
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(inFlightSentence({ phase: 'installing', target: 'v0.0.10', startedAtS: 1790000000 })).toBe(IN_FLIGHT);
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'released', to: 'idle', detail: `busy — ${IN_FLIGHT}` });
    expect(h.spawned).toEqual([]);
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: 'v0.0.10' });
  });

  it('a FIFO planted at the server\'s update.json never blocks the run: W2\'s readNodeFile refuses it unopened, and the node\'s own _upd_lock_probe decides (the agent\'s O_NONBLOCK rule, server side)', async () => {
    // Opened for reading, a FIFO with no writer blocks open(2) for good — AFTER the lease was taken, so the
    // dispatcher's single-flight run would never settle and no later trigger would run the deadline sweep.
    // `readNodeFile` lstats first and refuses anything that is not a regular file, so the FIFO is never opened.
    const h = harness();
    mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    execFileSync('mkfifo', [path.join(h.home, '.ccrc', 'update.json')]);
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
  });

  it('a spawn whose parent never exits is answered `timeout` exactly at UPDATE_SPAWN_TIMEOUT_MS, by the runner\'s own kill (Review Focus 4, D-3400, review F3)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let calls = 0;
    // The FIRST spawn parks; any later one exits 0 at once, as a `--detach` parent does. `boundMs` models the
    // bounded runner: it resolves `killed: true` at its bound, having killed the parent's group.
    const h = harness({
      localIo: absentIo,
      boundMs: UPDATE_SPAWN_TIMEOUT_MS,
      run: () => {
        calls += 1;
        return calls === 1 ? new Promise<ExecResult>(() => {}) : Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
    });
    seedServer(h);
    let done = false;
    const running = runDispatch(h.deps, T0 + 1000).then((r) => { done = true; return r; });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.spawned).toHaveLength(1);
    expect(h.store.node(SERVER_ID)?.updateState).toBe('pending');
    await vi.advanceTimersByTimeAsync(UPDATE_SPAWN_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);   // flush the continuation; the clock does not move
    expect(done).toBe(true);
    const r = ran(await running);
    expect(r.outcome).toEqual({
      nodeId: SERVER_ID, result: 'released', to: 'idle', detail: 'timeout — the node dropped mid-dispatch; the request stands',
    });
    expect(SPAWN_TIMEOUT_MESSAGE).toBe(`the --detach parent did not exit within ${UPDATE_SPAWN_TIMEOUT_MS} ms`);
    // The runner killed the parent's group and answered, so the spawn is over: `spawning` left the set when the
    // runner resolved, and the next run starts a fresh parent instead of answering busy for a parent that is gone.
    const second = runDispatch(h.deps, T0 + 61_000);
    await vi.advanceTimersByTimeAsync(0);
    const r2 = ran(await second);
    expect(h.spawned).toHaveLength(2);
    expect(r2.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
  });

  it('while a spawn is still running, a run made after the lease was released out of band starts no second parent, and the entry leaves when the runner resolves (D-3400)', async () => {
    const parked: { finish?: (r: ExecResult) => void } = {};
    let calls = 0;
    const h = harness({
      localIo: absentIo,
      run: () => {
        calls += 1;
        return calls === 1
          ? new Promise<ExecResult>((resolve) => { parked.finish = resolve; })
          : Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
    });
    seedServer(h);
    const first = runDispatch(h.deps, T0 + 1000);
    await vi.waitFor(() => expect(h.spawned).toHaveLength(1));
    // An out-of-band release (an ack, a rekey): the row is idle again with its request standing, and the first
    // parent has not exited. The bounded runner would resolve it at its bound; here it is still running.
    expect(h.store.releaseLease(SERVER_ID, 'idle', 'released out of band', null).ok).toBe(true);
    const r2 = ran(await runDispatch(h.deps, T0 + 2000));
    expect(h.spawned).toHaveLength(1);
    expect(r2.outcome).toEqual({
      nodeId: SERVER_ID, result: 'released', to: 'idle', detail: `busy — ${LOCAL_SPAWNING_DETAIL}`,
    });
    expect(LOCAL_SPAWNING_DETAIL).toBe('an update op is already spawning on this server');
    parked.finish!({ code: 0, stdout: '', stderr: '' });
    await first;
    const r3 = ran(await runDispatch(h.deps, T0 + 3000));
    expect(h.spawned).toHaveLength(2);
    expect(r3.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
  });
});

describe('runDispatch — refusal notes (Review Focus 5)', () => {
  it('a node refused on two consecutive runs is written ONCE', async () => {
    const h = harness();
    seedFleet(h, 'v0.0.10', { caps: ['verify', 'node-id', 'floor', 'update-json'] });
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r1.noted).toBe(1);
    expect(r2.noted).toBe(0);
    expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^no-detach-cap — /);
    expect(h.sent).toEqual([]);
  });

  it('a provenance-failed server row does not halt the fleet node\'s dispatch, and its verdict is never overwritten (§18 "a provenance refusal does not halt", end to end)', async () => {
    const h = harness();
    seedFleet(h, null);
    seedServer(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    const verdict = 'provenance: the bundle signature did not verify';
    const swept = sweepOnce(h.store, serverMeas({
      measuredAt: T0 + 9000,
      report: { phase: 'failed', target: 'v0.0.10', startedAt: T0 + 6000, updatedAt: T0 + 9000, detail: verdict },
    }));
    expect(swept.lease).toMatchObject({ kind: 'release', to: 'failed' });
    expect(swept.refuse).toMatchObject({ tag: 'v0.0.10' });
    expect(h.store.node(SERVER_ID)?.updateDetail).toMatch(/^provenance:/);
    const serverBefore = h.store.node(SERVER_ID);
    expect(h.store.requestNode(FLEET_ID, 'v0.0.10', 'update', T0 + 10_000).ok).toBe(true);
    const r = ran(await runDispatch(h.deps, T0 + 11_000));
    expect(r.plan.gate.haltedBy).toEqual([]);
    expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(h.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(h.store.node(SERVER_ID)).toEqual(serverBefore);
  });
});

describe('runDispatch — a FLEET node that refused its request on provenance holds no server move (D-3409, D-3378)', () => {
  it('the fleet node fails `provenance: …` on the tag it was asked for: its request stands, and the server dispatches (the mirror of the server-row case above, §18 "a provenance refusal does not halt")', async () => {
    const h = harness();
    seedFleet(h);
    seedServer(h);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    const verdict = 'provenance: the bundle signature did not verify';
    const swept = sweepOnce(h.store, fleetMeas({
      measuredAt: T0 + 9000,
      report: { phase: 'failed', target: 'v0.0.10', startedAt: T0 + 6000, updatedAt: T0 + 9000, detail: verdict },
    }));
    expect(swept.lease).toMatchObject({ kind: 'release', to: 'failed' });
    expect(swept.refuse).toMatchObject({ tag: 'v0.0.10' });
    // The request STANDS (decision 7) — it is the very row D-3381 would have counted as outstanding.
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'failed', requestedTag: 'v0.0.10' });
    expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^provenance:/);
    const fleetBefore = h.store.node(FLEET_ID);
    const r2 = ran(await runDispatch(h.deps, T0 + 11_000));
    expect(r2.plan.gate.haltedBy).toEqual([]);
    expect(r2.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    expect(h.sent).toHaveLength(1);
    expect(h.store.node(FLEET_ID)).toEqual(fleetBefore);
  });
});

describe('dispatchViewsFor — the one builder of the dispatcher\'s input (the routes read the same views)', () => {
  it('carries every live row, its resolved auto, and only THIS node\'s refused tags', () => {
    const h = harness();
    seedFleet(h, null);
    seedServer(h, null);
    expect(h.store.refuseRelease(SERVER_ID, 'v0.0.10', T0, 'provenance: x').ok).toBe(true);
    const views = dispatchViewsFor(h.store);
    const byId = new Map(views.map((v) => [v.row.nodeId, v]));
    expect([...byId.keys()].sort()).toEqual([FLEET_ID, SERVER_ID].sort());
    expect(byId.get(FLEET_ID)?.auto).toBe('off');
    expect([...(byId.get(FLEET_ID)?.refusedTags ?? [])]).toEqual([]);
    expect([...(byId.get(SERVER_ID)?.refusedTags ?? [])]).toEqual(['v0.0.10']);
  });
});

describe('converge.ts — nothing yields between the plan and the lease (D-3377)', () => {
  it('runDispatch plans once, acquires once, and holds no await anywhere above the acquire', () => {
    const src = readFileSync(new URL('../src/update/converge.ts', import.meta.url), 'utf8');
    const start = src.indexOf('export async function runDispatch(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body.split('planDispatch(').length - 1).toBe(1);
    expect(body.split('.dispatchNode(').length - 1).toBe(1);
    const lease = body.indexOf('.dispatchNode(');
    expect(body.indexOf('planDispatch(')).toBeLessThan(lease);
    expect(body.slice(0, lease)).not.toMatch(/\bawait\b/);
  });
});

describe('FleetWatcher — the dispatcher runs single-flight, at the end of every inventory run', () => {
  const watcherFor = (o: { send?: SendUpdateOp; role?: NodeRole } = {}) => {
    const home = mkTmp('update-converge-watch-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(path.join(home, 'coord.db')));
    seedReleases(coord);
    const sent: { tag: string; kind: RequestKind }[] = [];
    const fleetState: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, agentOps: ['update'] };
    const deps: Deps = {
      ...base, cfg: { ...base.cfg, role: o.role ?? 'server' }, coord, fleetState,
      sendUpdateOp: (tag, kind) => { sent.push({ tag, kind }); return (o.send ?? (async () => ACCEPTED))(tag, kind); },
      updateRunner: spawnFromRunner(async () => ({ code: 0, stdout: '', stderr: '' }), home),
    };
    const watcher = new FleetWatcher(deps, new Bus());
    const once = vi.spyOn(watcher as unknown as { dispatchOnce(): Promise<DispatchRunResult> }, 'dispatchOnce');
    return { coord, watcher, once, sent };
  };

  it('an inventory run ends in exactly one dispatch run', async () => {
    const { watcher, once } = watcherFor({ role: 'both' });
    await watcher.inventoryNow();
    expect(once).toHaveBeenCalledTimes(1);
  });

  it('a run acquires in the caller\'s own turn; two triggers during it ask for exactly ONE follow-up (§18 "one dispatch per sweep", the act half)', async () => {
    const reply: { answer?: (r: ResOk) => void } = {};
    const { coord, watcher, once, sent } = watcherFor({ send: () => new Promise<ResOk>((resolve) => { reply.answer = resolve; }) });
    const inventory = vi.spyOn(watcher, 'triggerInventory').mockImplementation(() => {});
    expect(coord.upsertNodeMeasurement(fleetMeas()).ok).toBe(true);
    expect(coord.requestNode(FLEET_ID, 'v0.0.10', 'update', T0).ok).toBe(true);
    const first = watcher.dispatchNow();
    expect(coord.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10' });
    expect(watcher.dispatchNow()).toBe(first);
    watcher.triggerDispatch();
    watcher.triggerDispatch();
    expect(once).toHaveBeenCalledTimes(1);
    reply.answer!(ACCEPTED);
    await first;
    expect(once).toHaveBeenCalledTimes(2);
    await (once.mock.results[1]!.value as Promise<DispatchRunResult>);
    await new Promise((resolve) => setImmediate(resolve));
    expect(once).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(inventory).toHaveBeenCalledTimes(1);
  });

  it('a rejected dispatch run is logged once and recovered — single-flight is not wedged by a thrown run (Task 5 review findings 1/2)', async () => {
    const { watcher, once } = watcherFor({ role: 'both' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    once.mockRejectedValueOnce(new Error('boom'));
    // The second trigger JOINS the run the first one already started (single-flight) and asks for exactly one
    // follow-up — the same "join, don't stack" contract the other FleetWatcher cases above pin for a resolving
    // run; here the run REJECTS instead.
    watcher.triggerDispatch();
    watcher.triggerDispatch();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const rejectWarns = warn.mock.calls.filter(
      (c) => typeof c[0] === 'string' && /a dispatch run rejected: .*boom/.test(c[0]),
    );
    // ONE warn for the one rejection — even though TWO triggers touched this same run (review finding 2: a
    // `.catch` attached inside `triggerDispatch` fires once per joiner, logging the same rejection twice).
    expect(rejectWarns).toHaveLength(1);
    // The queued follow-up (from the second `triggerDispatch`) ran a real second dispatch — single-flight
    // recovered rather than staying wedged on the thrown run (review finding 1).
    expect(once).toHaveBeenCalledTimes(2);
    // And a caller reaching for a THIRD run afterward gets a fresh promise that resolves cleanly, not the
    // rejected run replayed forever.
    await expect(watcher.dispatchNow()).resolves.toBeDefined();
  });

  it('without a coord store there is nothing to dispatch', async () => {
    const watcher = new FleetWatcher(testDeps(mkTmp('update-converge-nocoord-')), new Bus());
    await expect(watcher.dispatchNow()).resolves.toEqual({ ran: false, why: 'no-coord' });
  });
});

describe('the composition root binds the two update ports (a text pin over index.ts; no suite boots it in remote mode)', () => {
  it('names updateRunner in both deps literals and sendUpdateOp — with t: \'req\' and the op\'s own timeout — in the remote one only', () => {
    const indexTs = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const depsLiterals = indexTs.match(/^  deps = \{\n[\s\S]*?^  \};$/gm) ?? [];
    expect(depsLiterals).toHaveLength(2);
    expect(depsLiterals[0]).toContain('io: fleet.io');
    expect(depsLiterals[1]).toContain('io: localIO');
    for (const lit of depsLiterals) expect(lit).toMatch(/^    updateRunner: localUpdateSpawnFor\(cfg\.home\),$/m);
    expect(depsLiterals[0]).toMatch(
      /^    sendUpdateOp: \(tag, kind\) => fleet\.client\.request\(\{ t: 'req', op: 'update', tag, kind \}, UPDATE_OP_TIMEOUT_MS\),$/m);
    expect(depsLiterals[1]).not.toContain('sendUpdateOp');
  });

  it('Deps carries no raw Runner for the update spawn — only the two-template capability (D-3397)', () => {
    // @ts-expect-error — a raw Runner is not a LocalUpdateSpawn: its second parameter is an argv, not a tag
    const raw: NonNullable<Deps['updateRunner']> = realRunner;
    void raw;
    expect(typeof localUpdateSpawnFor('/h')).toBe('function');
  });
});
