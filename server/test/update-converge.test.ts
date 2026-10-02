// Design 2026-09-20 §10 — the dispatcher's ACT (`runDispatch`, server/src/update/converge.ts) end to end, over
// a real CoordStore on an `mkTmp` coord.db: the lease is acquired by Task 3's real `dispatchNode`, the op is
// "sent" through a recording SendUpdateOp, the server-role node is spawned through `spawnFromRunner` (the double for
// `localUpdateSpawnFor`) over a recording Runner, and every settle and release is W2's own writers — including the sweep's, driven through
// W2's `sweepPlanFor` in the sweep's own order. Nothing here reads the live $HOME, spawns a real `ccrc` or
// talks to a real agent: the link is a function, the spawn is a recorder, the node files live under a fixture
// HOME.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UPDATE_LOCK_HELD_PREFIX, UPDATE_OP_DETAIL_MAX, UPDATE_SPAWN_TIMEOUT_MS, inFlightBusyDetail, isUpdateLockHeldLine, type ResOk } from '../../shared/agent-protocol.js';
import { FLEET_SCOPE, UPDATE_GATE_CAP, type NodeRole, type RequestKind } from '../../shared/api.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import { realRunner, type ExecResult, type Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import { localIO, type FleetIO } from '../src/io.js';
import { AgentOpError, LinkNotSentError } from '../src/remote/client.js';
import type { Deps } from '../src/server.js';
import {
  LINK_DOWN_DETAIL, LOCAL_SPAWNING_DETAIL, NO_FLEET_LINK_DETAIL, NO_LOCAL_RUNNER_DETAIL,
  dispatchViewsFor, localUpdateSpawnFor, runDispatch,
  type ConvergeDeps, type ConvergeStore, type DispatchRunResult, type LocalUpdateSpawn, type SendUpdateOp,
} from '../src/update/converge.js';
import {
  AGENT_REJECTED_DETAIL, DEADLINE_DETAIL, LINK_FAILED_HOLD_PREFIX, UNVERSIONED_DETAIL, linkFailedHoldDetail,
  type MoveFeedRecord,
} from '../src/update/dispatch.js';
import {
  FLEET_LABEL, SERVER_LABEL, sweepInventory, sweepPlanFor, type InventoryDeps, type SweepPlan,
} from '../src/update/inventory.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { CCRC_SRC, TERMINAL_REPORT, deadPid, holdLock, lockFree, plantRealBox } from './updateRealBox.js';
import { itLinux } from './platformFixtures.js';
import { spawnFromRunner } from './updateSpawnFake.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const DEADLINE = 900_000;
const FLEET_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const SERVER_ID = '05050505-0505-4505-8505-050505050505';
const ACCEPTED: ResOk = { t: 'res', id: 1, ok: true, accepted: true };
const LAUNCHER_ARGV = ['update', '--to', 'v0.0.10', '--detach', '--from', 'pwa'];
const IN_FLIGHT = 'update.json says installing (target v0.0.10, started 1790000000)';
/** D-3411: what the busy sentence for THIS process's in-flight report reads, spelled out (the builder is L0's). */
const BUSY_TAIL = ' - a live updater that hangs answers busy on every sweep: ack the row or mend the box';
const liveBusy = `update.json says installing (target v0.0.10, started 1790000000, writer pid ${process.pid})${BUSY_TAIL}`;
const reportOf = (pid: unknown): string =>
  `${JSON.stringify({ target: 'v0.0.10', phase: 'installing', startedAt: 1790000000, updatedAt: 1790000005, detail: null, from: 'cli', pid })}\n`;

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
/** Fix round 1 (review 178 F1, case ii): an io that answers `absent` at once, the same idiom as
 *  `update-inventory.test.ts`'s `NOTHING_IO` — used for the SERVER's own local read so the fleet fixture files
 *  planted below (same `ccrcDir`, the remote-arm simulation both files share) are never mistaken for this box's
 *  own report. */
const NOTHING_IO: FleetIO = { ...localIO, lstatMeasured: async () => ({ ok: false as const, reason: 'absent' as const }) };

/** What W2's inventory sweep does with ONE measurement, in its own order (`applyMeasurement`: plan against the
 *  pre-upsert row → upsert → refuse → lease), through W2's own writers — so a lease this task acquired is
 *  settled or released by the same plan and the same writers production uses. TWO differences, deliberate. It skips `applyMeasurement`'s collision check, its re-key and its read-state overrides (the unmeasured floor/previous/report carries and the stamp-unmeasured report restore): every measurement below is fully read, with `stampRead: 'ok'`, into an existing UUID row, so none of them would fire. And the
 *  writers' `expectedStartedAt` is passed `null` here — `applyMeasurement` computes it inline
 *  (`preRow === null ? null : preRow.updateStartedAt`, not a named helper), and this harness has no `preRow` of
 *  its own to read it from — so the store's identity guard is not exercised by this file. W2's
 *  `update-inventory.test.ts` and `update-store-nodes.test.ts` pin it. The rule that decides whether a report counts
 *  for a lease is identity plus change (D-3405), never a clock: no report below is ordered against a lease by its time. */
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
  /** Wave 8 item A: every `recordMove` call the default port received, in order — a case that needs a
   *  different port (a throw, or a shared log with `onAccepted`) overrides `h.deps.recordMove` directly. */
  records: MoveFeedRecord[];
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
  const records: MoveFeedRecord[] = [];
  const deps: ConvergeDeps = {
    store, role: o.role ?? 'server', ccrcDir: path.join(home, '.ccrc'), localIo: o.localIo ?? localIO,
    deadlineMs: DEADLINE,
    fleet: { state, send: (tag, kind) => { sent.push({ tag, kind }); return send(tag, kind); } },
    runLocal: o.noLocal === true ? null : spawnFromRunner(recording, home, o.boundMs),
    onAccepted: () => { accepted += 1; },
    recordMove: (r) => { records.push(r); },
  };
  return { store, home, state, deps, sent, spawned, accepted: () => accepted, records };
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

  it('U1 -> U2 (busy) -> U1: the lease follows the label, so the server is never dispatched while the fleet box\'s run proceeds (D-3412)', async () => {
    const h = harness();
    const FLEET_ID2 = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';
    const busyRows = (): string[] => h.store.nodes().filter((n) => n.updateState !== 'idle').map((n) => n.nodeId);
    seedFleet(h, null);                                  // U1, idle, no request
    seedServer(h);                                       // the server, requested
    // The box's node-id flips to U2 (U1 retired while idle), and U2 is the fleet node the operator moves.
    expect(h.store.rekeyNode(FLEET_LABEL, FLEET_ID2)).toMatchObject({ ok: true, retired: 1, revived: false });
    expect(h.store.upsertNodeMeasurement(fleetMeas({ nodeId: FLEET_ID2 })).ok).toBe(true);
    expect(h.store.requestNode(FLEET_ID2, 'v0.0.10', 'update', T0).ok).toBe(true);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toMatchObject({ nodeId: FLEET_ID2, result: 'accepted' });
    expect(busyRows()).toEqual([FLEET_ID2]);
    // The identity comes back (a restored snapshot): U1 is revived and U2 retired — the run is the same box's.
    expect(h.store.rekeyNode(FLEET_LABEL, FLEET_ID)).toMatchObject({ ok: true, retired: 1, revived: true });
    expect(busyRows(), 'exactly one live busy row').toEqual([FLEET_ID]);
    const r2 = ran(await runDispatch(h.deps, T0 + 2000));
    expect(r2.outcome).toBeNull();
    expect(r2.plan.gate.leaseHeldBy).toBe(FLEET_ID);
    expect(h.spawned, 'the server was dispatched while the fleet box\'s run proceeds').toEqual([]);
    expect(h.sent).toHaveLength(1);
    // The run's own report settles the handed lease, and the server moves after it.
    const swept = sweepOnce(h.store, fleetMeas({
      currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', measuredAt: T0 + 60_000,
      report: { phase: 'done', target: 'v0.0.10', startedAt: T0 + 6000, updatedAt: T0 + 50_000, detail: null },
    }));
    expect(swept.lease.kind).toBe('settle');
    const r3 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r3.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
  });

  it('a revived `failed: provenance:` row does not halt, so it receives the box\'s lease and the server is never dispatched beside that run (I1, D-3412)', async () => {
    const h = harness();
    const FLEET_ID2 = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';
    const busyRows = (): string[] => h.store.nodes().filter((n) => n.updateState !== 'idle' && n.updateState !== 'failed').map((n) => n.nodeId);
    seedFleet(h);                                        // U1, requested
    seedServer(h);                                       // the server, requested
    expect(ran(await runDispatch(h.deps, T0 + 1000)).outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    // U1's node refuses the release: a verdict on the release (D-3378), not a fault, so it does not halt.
    expect(h.store.releaseLease(FLEET_ID, 'failed', 'provenance: unsigned bundle', T0 + 1000)).toEqual({ ok: true, state: 'failed' });
    // The box's node-id flips to U2; U2 is the fleet node the operator moves, and its run is the box's real one.
    expect(h.store.rekeyNode(FLEET_LABEL, FLEET_ID2)).toMatchObject({ ok: true, retired: 1, revived: false });
    expect(h.store.upsertNodeMeasurement(fleetMeas({ nodeId: FLEET_ID2 })).ok).toBe(true);
    expect(h.store.requestNode(FLEET_ID2, 'v0.0.10', 'update', T0).ok).toBe(true);
    expect(ran(await runDispatch(h.deps, T0 + 2000)).outcome).toMatchObject({ nodeId: FLEET_ID2, result: 'accepted' });
    // U1 comes back: it does not halt, so it takes the lease U2 held.
    expect(h.store.rekeyNode(FLEET_LABEL, FLEET_ID)).toMatchObject({ ok: true, retired: 1, revived: true });
    expect(busyRows(), 'exactly one live busy row').toEqual([FLEET_ID]);
    const r = ran(await runDispatch(h.deps, T0 + 3000));
    expect(r.plan.gate).toMatchObject({ haltedBy: [], leaseHeldBy: FLEET_ID });
    expect(r.outcome).toBeNull();
    expect(h.spawned, 'the server moved beside the fleet box\'s run').toEqual([]);
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

  it('a server-role spawn that exits 1 on the LOCK → busy: released idle, the request standing, carrying the parent\'s FIRST stderr line, and the next run asks again (D-3411, review F1)', async () => {
    const lock = 'ccrc: update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)';
    const h = harness({ run: async () => ({ code: 1, stdout: '', stderr: `${lock}\nsecond line` }) });
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    // The lock line, then the ack advice (Step 0.1): a holder that hangs writes no report, so the row names the way out.
    const busy = `busy — ${lock} - a live updater that hangs answers busy on every sweep: ack the row or mend the box`;
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'released', to: 'idle', detail: busy });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', updateDetail: busy, requestedTag: 'v0.0.10' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    // Not halting: the fleet gate reads no halted row, and the next run spawns again.
    const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r2.plan.gate.haltedBy).toEqual([]);
    expect(h.spawned).toHaveLength(2);
  });

  it.each([
    ['flock absent (`_upd_flock_die`)', "ccrc: flock (util-linux) is required by 'ccrc update' — it serialises updates and refuses rather than racing; nothing on this box was changed"],
    ["an unmeasured lock (the probe's last arm)", 'ccrc: update: ~/.ccrc/update.lock could not be measured (probe rc 3) — refusing to detach a run past a lock this box cannot see; nothing on this box was changed'],
    ['a lock sentence that is NOT the first line', 'ccrc: something else\nccrc: update: another update holds ~/.ccrc/update.lock (pid 7)'],
  ])('every OTHER refusal keeps its halting spawn-failed — %s (D-3411)', async (_what, stderr) => {
    const h = harness({ run: async () => ({ code: 1, stdout: '', stderr }) });
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'released', to: 'failed' });
    expect(h.store.node(SERVER_ID)?.updateState).toBe('failed');
    expect(h.store.node(SERVER_ID)?.updateDetail).toMatch(/^spawn-failed — /);
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

  it('a link that failed BEFORE the frame was handed (LinkNotSentError) → idle, the request standing; not sent while the sweep says unreachable; sent again once measured reachable (D-3555)', async () => {
    let calls = 0;
    const h = harness({ send: async () => { calls += 1; if (calls === 1) throw new LinkNotSentError('disconnected'); return ACCEPTED; } });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateDetail: 'disconnected — the op never reached the fleet link; the request stands', requestedTag: 'v0.0.10',
    });
    expect(h.store.markUnreachable(FLEET_LABEL, 'fleet', T0 + 2000).ok).toBe(true);
    ran(await runDispatch(h.deps, T0 + 2500));
    expect(h.sent).toHaveLength(1);
    sweepOnce(h.store, fleetMeas({ measuredAt: T0 + 3000 }));
    ran(await runDispatch(h.deps, T0 + 3500));
    expect(h.sent).toHaveLength(2);
    expect(h.store.node(FLEET_ID)?.updateState).toBe('pending');
  });

  it('a send that timed out after the frame was handed HOLDS the lease; the detached run\'s own report of the tag settles it and clears the request, and nothing is sent twice (Review Focus 1, D-3555)', async () => {
    const h = harness({ send: async () => { throw new Error('timeout'); } });
    seedFleet(h);
    const r0 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r0.outcome).toEqual({ nodeId: FLEET_ID, result: 'held', detail: linkFailedHoldDetail('timeout', 'timeout') });
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'pending', updateDetail: linkFailedHoldDetail('timeout', 'timeout'), requestedTag: 'v0.0.10',
    });
    expect(h.accepted()).toBe(1);
    // The detached run the op started finished anyway; the sweep measures the new stamp with the node's own report.
    expect(sweepOnce(h.store, fleetMeas({
      currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', measuredAt: T0 + 60_000,
      report: { phase: 'done', target: 'v0.0.10', startedAt: T0 + 6000, updatedAt: T0 + 50_000, detail: null },
    })).lease.kind).toBe('settle');
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateDetail: 'done: v0.0.10', requestedTag: null,
    });
    ran(await runDispatch(h.deps, T0 + 61_000));
    expect(h.sent).toHaveLength(1);
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

  it('an in-flight update.json whose writer is ALIVE answers busy, names the writer and the way out, and spawns nothing (D-3384, D-3411)', async () => {
    const h = harness();
    mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(h.home, '.ccrc', 'update.json'), reportOf(process.pid));
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(inFlightBusyDetail({ phase: 'installing', target: 'v0.0.10', startedAtS: 1790000000, pid: process.pid })).toBe(liveBusy);
    expect(liveBusy.length).toBeLessThanOrEqual(UPDATE_OP_DETAIL_MAX);
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'released', to: 'idle', detail: `busy — ${liveBusy}` });
    expect(h.spawned).toEqual([]);
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: 'v0.0.10', updateDetail: `busy — ${liveBusy}` });
  });

  it('a report whose pid is absent or unreadable keeps busy: that writer is unmeasurable, not dead (D-3411)', async () => {
    for (const pid of [undefined, 0, -1, 1.5, '4242', null]) {
      const h = harness();
      mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
      writeFileSync(path.join(h.home, '.ccrc', 'update.json'), reportOf(pid));
      seedServer(h);
      const r = ran(await runDispatch(h.deps, T0 + 1000));
      expect(r.outcome, String(pid)).toMatchObject({ result: 'released', to: 'idle' });
      expect(h.store.node(SERVER_ID)?.updateDetail, String(pid)).toContain('writer pid unknown');
      expect(h.spawned, String(pid)).toEqual([]);
    }
  });

  it('a leftover in-flight report whose writer is DEAD is spawned over: the parent\'s own lock probe decides (D-3411, review F2)', async () => {
    const dead = await deadPid();
    for (const phase of ['queued', 'installing', 'restoring']) {
      const h = harness();
      mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
      writeFileSync(path.join(h.home, '.ccrc', 'update.json'), reportOf(dead).replace('installing', phase));
      seedServer(h);
      const r = ran(await runDispatch(h.deps, T0 + 1000));
      expect(r.outcome, phase).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
      expect(h.spawned, phase).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    }
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

  it('a spawn whose parent never exits is answered exactly at UPDATE_SPAWN_TIMEOUT_MS, by the runner\'s own kill: nothing queued (update.json absent at both reads) is arm A, released idle (Review Focus 4, D-3400 amended, D-3413, review F3/F4)', async () => {
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
    // F4: the row says what happened, and it is NOT the old "the node dropped mid-dispatch" (nothing dropped).
    const armA = `not-queued — the --detach parent was stopped at the ${UPDATE_SPAWN_TIMEOUT_MS} ms bound before it queued anything; nothing started`;
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'released', to: 'idle', detail: armA });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', updateDetail: armA, requestedTag: 'v0.0.10' });
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

describe('runDispatch — the server-role spawn against the REAL ccrc: a held lock is busy (D-3411, review F1)', () => {
  // The REAL `ccd/ccrc` behind the REAL launcher in a fixture HOME (`updateRealBox.ts`, whose header states the
  // containment: an env built from scratch, a poisoned recording systemd-run, a stub curl), spawned by the REAL
  // bounded runner, with a real `flock` holding `update.lock`.
  const holders: { pid?: number }[] = [];
  afterEach(() => {
    for (const p of holders.splice(0)) {
      if (p.pid !== undefined) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  });
  const kinds: { kind: RequestKind; tag: string; argv: string[] }[] = [
    { kind: 'update', tag: 'v0.0.10', argv: LAUNCHER_ARGV },
    { kind: 'rollback', tag: 'v0.0.8', argv: ['rollback', '--to', 'v0.0.8', '--detach', '--from', 'pwa'] },
  ];

  for (const { kind, tag, argv } of kinds) {
    // PLATFORM-ONLY: `--detach` is Linux-only (design decision 17: `_upd_detach_os_check` refuses it on darwin before any lock probe or systemd-run), so a darwin arm has nothing to assert.
    itLinux(`${kind}: the lock held by a real flock answers busy with the lock line, update.json is byte-identical, and nothing reached systemd-run`, async () => {
      const h = harness();
      h.deps.runLocal = plantRealBox(h.home).spawn();
      expect(h.store.upsertNodeMeasurement(serverMeas()).ok).toBe(true);
      expect(h.store.requestNode(SERVER_ID, tag, kind, T0).ok).toBe(true);
      holders.push(holdLock(h.home));
      const r = ran(await runDispatch(h.deps, T0 + 1000));
      expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'released', to: 'idle' });
      const detail = (r.outcome as { detail: string }).detail;
      expect(detail).toMatch(/^busy — ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(.*\) - a live updater that hangs answers busy on every sweep: ack the row or mend the box$/);
      expect(isUpdateLockHeldLine(detail.slice('busy — '.length))).toBe(true);
      expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: tag, requestedKind: kind });
      expect(readFileSync(path.join(h.home, '.ccrc', 'update.json'), 'utf8')).toBe(TERMINAL_REPORT);
      expect(existsSync(path.join(h.home, 'systemd-run-argv')), 'a lock the harness failed to hold reached systemd-run').toBe(false);
      expect(existsSync(path.join(h.home, 'systemctl-argv')), 'the script reached systemctl').toBe(false);
      if (kind === 'rollback') expect(readFileSync(path.join(h.home, 'curl-argv'), 'utf8')).toContain(`/download/${tag}/SHA256SUMS`);
    });

    // PLATFORM-ONLY: `--detach` is Linux-only (design decision 17: `_upd_detach_os_check` refuses it on darwin before any lock probe or systemd-run), so a darwin arm has nothing to assert.
    itLinux(`${kind} (control): with the lock FREE the script goes on to the poisoned systemd-run, so the absence above is a measurement`, async () => {
      const h = harness();
      h.deps.runLocal = plantRealBox(h.home).spawn();
      expect(h.store.upsertNodeMeasurement(serverMeas()).ok).toBe(true);
      expect(h.store.requestNode(SERVER_ID, tag, kind, T0).ok).toBe(true);
      expect(lockFree(h.home)).toBe(true);
      const r = ran(await runDispatch(h.deps, T0 + 1000));
      // The poisoned systemd-run answers 97: the parent dies after its `queued` write, with its own sentence.
      expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'released', to: 'failed' });
      expect((r.outcome as { detail: string }).detail).toMatch(/could not start the detached run \(systemd-run exited 97\)/);
      const runArgv = readFileSync(path.join(h.home, 'systemd-run-argv'), 'utf8');
      expect(runArgv).toContain(`ccrc-detach ${argv[0]} --to ${tag} --from pwa`);
      // Exactly ONE invocation: the recorder appends a line per call, so a second `systemd-run` (a retried start, a
      // second unit) is a second line and reds here — `toContain` alone would read it as the same answer.
      expect(runArgv.split('\n').filter((l) => l !== ''), 'systemd-run was invoked more than once').toHaveLength(1);
    });
  }

  it('the declared prefix is the sentence `_upd_busy_die` prints — read from the script, not restated', () => {
    const src = readFileSync(CCRC_SRC, 'utf8');
    const die = /^_upd_busy_die\(\) \{[^\n]*\}$/m.exec(src);
    expect(die, '_upd_busy_die not found in ccd/ccrc').not.toBeNull();
    // `_ccrc_die` prefixes `$PROG: ` (PROG is `ccrc`), and the holder rides in parentheses after the prefix.
    expect(die![0]).toContain(`_ccrc_die "${UPDATE_LOCK_HELD_PREFIX.slice('ccrc: '.length)} (`);
    expect(/^PROG=ccrc$/m.test(src), "`_ccrc_die`'s prefix is PROG").toBe(true);
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

describe('a move the node took leaves one feed record naming its source (wave 8 item A)', () => {
  /** A node-scoped auto intent (D-3586's cases): a FLEET-WIDE intent would also turn the server row's own auto
   *  on, and these cases care about exactly one move. `fleetMeas`'s caps lack UPDATE_GATE_CAP — auto needs it. */
  const seedFleetAuto = (h: Harness, target = 'v0.0.10', over: Partial<NodeMeasurement> = {}): void => {
    const capsWithGate = ['verify', 'node-id', 'floor', 'update-json', 'detach', 'rollback', UPDATE_GATE_CAP];
    expect(h.store.upsertNodeMeasurement(fleetMeas({ caps: capsWithGate, ...over })).ok).toBe(true);
    const log = new UpdateIntentLog(defaultUpdateIntentLogPath(h.deps.ccrcDir));
    expect(h.store.setIntent(FLEET_ID, { channel: 'stable', auto: 'channel' }, log, T0).ok).toBe(true);
    expect(h.store.resolveNode(FLEET_ID, { channel: 'stable', desiredTag: target, resolveDetail: null }).ok).toBe(true);
  };
  /** A `ConvergeStore` over a real `CoordStore` whose `dispatchNode` alone is swapped for a `busy` refusal — the
   *  real store cannot be made to refuse the acquire in the same synchronous stretch a dispatch run reads it in
   *  (case d). Every other method passes straight through. */
  const acquireRefusedStore = (base: CoordStore): ConvergeStore => ({
    nodes: base.nodes.bind(base), releases: base.releases.bind(base), refusalsFor: base.refusalsFor.bind(base),
    intentFor: base.intentFor.bind(base), updateEpoch: base.updateEpoch.bind(base),
    dispatchNode: () => ({ ok: false, why: 'busy', heldBy: 'other' }),
    releaseLease: base.releaseLease.bind(base), settleNode: base.settleNode.bind(base),
    noteDispatchRefusal: base.noteDispatchRefusal.bind(base), noteLeaseDetail: base.noteLeaseDetail.bind(base),
  });
  /** A `ConvergeStore` whose `releaseLease` alone answers refused (`not-busy`), so a spawn-failed answer becomes
   *  a `release-refused` outcome (case j). */
  const releaseRefusedStore = (base: CoordStore): ConvergeStore => ({
    nodes: base.nodes.bind(base), releases: base.releases.bind(base), refusalsFor: base.refusalsFor.bind(base),
    intentFor: base.intentFor.bind(base), updateEpoch: base.updateEpoch.bind(base),
    dispatchNode: base.dispatchNode.bind(base),
    releaseLease: () => ({ ok: false, why: 'not-busy', state: 'idle' }),
    settleNode: base.settleNode.bind(base),
    noteDispatchRefusal: base.noteDispatchRefusal.bind(base), noteLeaseDetail: base.noteLeaseDetail.bind(base),
  });

  it('(a) an auto link update, accepted: exactly one record naming it auto', async () => {
    const h = harness();
    seedFleetAuto(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(h.records).toHaveLength(1);
    expect(h.records[0]!.title).toBe('update fleet: auto update to v0.0.10');
  });

  it('(b) a requested rollback: the title says requested rollback', async () => {
    const h = harness();
    expect(h.store.upsertNodeMeasurement(fleetMeas()).ok).toBe(true);
    expect(h.store.requestNode(FLEET_ID, 'v0.0.8', 'rollback', T0).ok).toBe(true);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(h.records).toHaveLength(1);
    expect(h.records[0]!.title).toBe('update fleet: requested rollback to v0.0.8');
  });

  it('(c) an AUTO update from an UNVERSIONED node: the title still says auto (move.source, never move.detail)', async () => {
    const h = harness();
    seedFleetAuto(h, 'v0.0.9', { currentVersion: null, highestVersion: null, floorRead: 'absent' });
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(h.records).toHaveLength(1);
    expect(h.records[0]!.title).toBe('update fleet: auto update to v0.0.9');
    expect(h.records[0]!.body).toContain(UNVERSIONED_DETAIL);
  });

  it('(d) a not-sent move and an acquire-refused one write no record', async () => {
    const h1 = harness();
    h1.state.connected = false;
    seedFleet(h1);
    const r1 = ran(await runDispatch(h1.deps, T0 + 1000));
    expect(r1.outcome).toEqual({ nodeId: FLEET_ID, result: 'not-sent', detail: LINK_DOWN_DETAIL });
    expect(h1.records).toEqual([]);

    const h2 = harness();
    seedFleet(h2);
    h2.deps.store = acquireRefusedStore(h2.store);
    const r2 = ran(await runDispatch(h2.deps, T0 + 1000));
    expect(r2.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'acquire-refused', why: 'busy' });
    expect(h2.records).toEqual([]);
  });

  it('(e) a D-3555 transport hold: the body names the link failure', async () => {
    const h = harness({ send: async () => { throw new Error('timeout'); } });
    seedFleet(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'held' });
    expect(h.records).toHaveLength(1);
    expect(h.records[0]!.body).toContain('lease held: link failed mid-op');
  });

  it('(f) a spawn-failed release: the body names it released failed', async () => {
    const h = harness({ run: async () => ({ code: 1, stdout: '', stderr: '' }) });
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'released', to: 'failed' });
    expect(h.records).toHaveLength(1);
    expect(h.records[0]!.body).toContain('released failed: spawn-failed');
  });

  it('(g) a recordMove that throws never changes the run', async () => {
    const hNull = harness();
    hNull.deps.recordMove = null;
    seedFleet(hNull);
    const rNull = ran(await runDispatch(hNull.deps, T0 + 1000));

    const hThrow = harness();
    hThrow.deps.recordMove = () => { throw new Error('boom'); };
    seedFleet(hThrow);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Settled, never awaited bare: a mutation that drops the try/catch (M-A4) or that moves the call before the
    // send (M-A8) makes `runDispatch` REJECT with the bare `boom`, and a bare `await` would die on it — a crash
    // is not a pin (mutation-table discipline). Both facts are asserted SOFT, unconditionally, so neither masks
    // the other: `settled.ok` alone fires for M-A4 (the send already ran; only the safety net is gone, so `sent`
    // still reads 1); both `settled.ok` AND `sent` fire for M-A8 (the record — and its throw — now happen BEFORE
    // `deps.fleet.send` is ever called, so `sent` stays empty) — that second fact is what tells the two mutants
    // apart.
    const settled = await runDispatch(hThrow.deps, T0 + 1000).then(
      (r) => ({ ok: true as const, r }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    expect.soft(settled.ok, 'runDispatch must resolve, never reject, even when recordMove throws').toBe(true);
    expect.soft(hThrow.sent, 'the send must already have happened by the time recordMove runs').toHaveLength(1);
    if (!settled.ok) return; // the shape below is the genuine (non-mutant) resolution only

    const rThrow = ran(settled.r);
    expect(rThrow.outcome).toEqual(rNull.outcome);
    expect(hThrow.store.node(FLEET_ID)).toEqual(hNull.store.node(FLEET_ID));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/^ccrc-server: the update move's feed record was not written/);
  });

  it('(h) onAccepted runs before recordMove, in the hold arm', async () => {
    const h = harness();
    seedFleet(h);
    const order: string[] = [];
    h.deps.onAccepted = () => { order.push('onAccepted'); };
    h.deps.recordMove = () => { order.push('recordMove'); };
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ result: 'accepted' });
    expect(order).toEqual(['onAccepted', 'recordMove']);
  });

  it('(i) a node answering busy on every run writes zero records', async () => {
    const h = harness({ send: async () => { throw new AgentOpError('busy', IN_FLIGHT); } });
    seedFleet(h);
    for (let i = 1; i <= 5; i++) {
      const r = ran(await runDispatch(h.deps, T0 + i * 1000));
      expect(r.outcome).toMatchObject({ result: 'released', to: 'idle' });
      expect(h.sent).toHaveLength(i);
    }
    expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^busy — /);
    expect(h.records).toEqual([]);
  });

  it('(j) a release refused is never worded "released"', async () => {
    const h = harness({ run: async () => ({ code: 1, stdout: '', stderr: 'boom' }) });
    seedServer(h);
    h.deps.store = releaseRefusedStore(h.store);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'release-refused', to: 'failed', why: 'not-busy' });
    expect(h.records).toHaveLength(1);
    expect(h.records[0]!.body).toContain('release refused (not-busy) — the answer was: spawn-failed');
    expect(h.records[0]!.body).not.toContain('released ');
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
    // Fix round 1 item 4: the ONE await above the acquire is the server's own report, read BEFORE the stretch. The stretch
    // starts at the deadline sweep's own row read (`const expired`, whose `for` reads `store.nodes()` next) and must hold
    // no yield at all up to the acquire; the text above it holds exactly that read and nothing else. Comments are
    // stripped: they may name the word.
    const code = body.replace(/\/\/.*$/gm, '');
    const stretchAt = code.indexOf('const expired');
    expect(stretchAt).toBeGreaterThan(-1);
    expect(code.indexOf('.dispatchNode(')).toBeGreaterThan(stretchAt);
    expect(code.slice(stretchAt, code.indexOf('.dispatchNode('))).not.toMatch(/\bawait\b/);
    expect(code.slice(0, stretchAt).match(/\bawait\b/g)).toEqual(['await']);
    expect(code.slice(0, stretchAt)).toMatch(/await ownReportOrigin\(deps\)/);
    // ... and the stretch's own first row read is the one after it: no `store.nodes()` between the await and `const expired`.
    expect(code.slice(code.indexOf('await ownReportOrigin('), stretchAt)).not.toMatch(/store\.nodes\(\)/);
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

describe('runDispatch — a fleet-link failure after the op was handed holds the lease, and only a report or the deadline ends it (D-3555, residue R1)', () => {
  it.each([
    ['timeout', new Error('timeout')],
    ['disconnected', new Error('disconnected')],
    ['aborted', new Error('aborted')],
    ['EPIPE', new Error('EPIPE')],
    ['a non-Error rejection', 'not an Error at all'],
  ] as const)('every post-send failure holds (%s)', async (_label, thrown) => {
    const h = harness({ send: async () => { throw thrown; } });
    seedFleet(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    const why = message === 'disconnected' || message === 'timeout' || message === 'aborted' ? message : 'other';
    const detail = linkFailedHoldDetail(why, message);
    expect(r.outcome).toEqual({ nodeId: FLEET_ID, result: 'held', detail });
    expect(detail.startsWith(`${LINK_FAILED_HOLD_PREFIX} (`)).toBe(true);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateDetail: detail, requestedTag: 'v0.0.10' });
    expect(h.accepted()).toBe(1);
    expect(h.sent).toHaveLength(1);
    if (why === 'other') expect(detail).toContain('(other: ');
  });

  it('the one-lease invariant: a fleet run possibly still live after a link failure blocks the server row too (class-1 pin)', async () => {
    const h = harness({ send: async () => { throw new Error('timeout'); } });
    seedFleet(h);
    seedServer(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    // The fleet node's own run finished while its link was down: measured AT the target, with NO report at all.
    expect(sweepOnce(h.store, fleetMeas({ currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', measuredAt: T0 + 120_000 }))
      .lease).toEqual({ kind: 'none', why: 'no-report' });
    for (const now of [T0 + 121_000, T0 + 181_000]) {
      const r = ran(await runDispatch(h.deps, now));
      expect(r.settled).toEqual([]);
      expect(r.plan.gate.leaseHeldBy).toBe(FLEET_ID);
    }
    expect(h.store.node(FLEET_ID)?.updateState).toBe('pending');
    expect(h.spawned).toEqual([]);
  });

  it('a report naming another tag never settles it', async () => {
    const h = harness({ send: async () => { throw new Error('timeout'); } });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    const plan = sweepOnce(h.store, fleetMeas({
      measuredAt: T0 + 2000,
      report: { phase: 'installing', target: 'v0.0.9', startedAt: T0 + 2000, updatedAt: T0 + 3000, detail: null },
    }));
    expect(plan.lease).toEqual({ kind: 'none', why: 'stale-report' });
    expect(h.store.node(FLEET_ID)?.updateState).toBe('pending');
  });

  it('words at the deadline, and they halt', async () => {
    const h = harness({ send: async () => { throw new Error('timeout'); } });
    seedFleet(h);
    seedServer(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    const before = ran(await runDispatch(h.deps, T0 + 1000 + DEADLINE - 1));
    expect(before.expired).toEqual([]);
    expect(h.store.node(FLEET_ID)?.updateState).toBe('pending');
    const after = ran(await runDispatch(h.deps, T0 + 1000 + DEADLINE + 1));
    expect(after.expired).toEqual([FLEET_ID]);
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'failed',
      updateDetail: "deadline — the fleet link failed mid-op; the row's last report does not name v0.0.10",
      requestedTag: 'v0.0.10',
    });
    expect(h.store.node(FLEET_ID)?.updateDetail).not.toContain('was reported');
    expect(after.plan.gate.haltedBy).toEqual([FLEET_ID]);
    expect(h.spawned).toEqual([]);
    expect(h.store.ackNode(FLEET_ID).ok).toBe(true);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', requestedTag: null });
  });

  it("the same words follow another tag's report (case 3's stale report), the deadline measured from its updatedAt", async () => {
    const h = harness({ send: async () => { throw new Error('timeout'); } });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(sweepOnce(h.store, fleetMeas({
      measuredAt: T0 + 2000,
      report: { phase: 'installing', target: 'v0.0.9', startedAt: T0 + 2000, updatedAt: T0 + 3000, detail: null },
    })).lease).toEqual({ kind: 'none', why: 'stale-report' });
    const before = ran(await runDispatch(h.deps, T0 + 3000 + DEADLINE - 1));
    expect(before.expired).toEqual([]);
    const after = ran(await runDispatch(h.deps, T0 + 3000 + DEADLINE + 1));
    expect(after.expired).toEqual([FLEET_ID]);
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'failed',
      updateDetail: "deadline — the fleet link failed mid-op; the row's last report does not name v0.0.10",
    });
    expect(h.store.node(FLEET_ID)?.updateDetail).not.toContain('was reported');
  });

  it('a report of the tag itself gets the qualified words at the deadline, halting', async () => {
    const h = harness({ send: async () => { throw new Error('timeout'); } });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(sweepOnce(h.store, fleetMeas({
      measuredAt: T0 + 2000,
      report: { phase: 'installing', target: 'v0.0.10', startedAt: T0 + 2000, updatedAt: T0 + 3000, detail: null },
    })).lease).toEqual({ kind: 'none', why: 'in-flight' });
    expect(h.store.node(FLEET_ID)?.updateState).toBe('pending');
    const after = ran(await runDispatch(h.deps, T0 + 3000 + DEADLINE + 1));
    expect(after.expired).toEqual([FLEET_ID]);
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'failed',
      updateDetail: "deadline — the fleet link failed mid-op; the row's last report names v0.0.10, which may be an earlier run's",
    });
    expect(after.plan.gate.haltedBy).toEqual([FLEET_ID]);
  });

  it("a later writer's report replaces this run's own — the deadline still says only what the row's LAST report "
    + 'proves, never a history it cannot see (fix round 1, review 178 F1, case i)', async () => {
    const h = harness({ send: async () => { throw new Error('timeout'); } });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    // This lease's OWN run reports in: `installing v0.0.10`, the lease's own target — a genuine report of it.
    expect(sweepOnce(h.store, fleetMeas({
      measuredAt: T0 + 2000,
      report: { phase: 'installing', target: 'v0.0.10', startedAt: T0 + 2000, updatedAt: T0 + 3000, detail: null },
    })).lease).toEqual({ kind: 'none', why: 'in-flight' });
    expect(h.store.node(FLEET_ID)).toMatchObject({ reportedPhase: 'installing', reportedTarget: 'v0.0.10' });
    // A LATER writer's report of the PREVIOUS release replaces it on the row — the genuine report of this lease's
    // own run is gone, overwritten by a stale report of a run this lease never made.
    expect(sweepOnce(h.store, fleetMeas({
      measuredAt: T0 + 4000,
      report: { phase: 'done', target: 'v0.0.9', startedAt: T0 + 3500, updatedAt: T0 + 3900, detail: null },
    })).lease).toEqual({ kind: 'none', why: 'stale-report' });
    expect(h.store.node(FLEET_ID)).toMatchObject({ reportedPhase: 'done', reportedTarget: 'v0.0.9' });
    const after = ran(await runDispatch(h.deps, T0 + 3900 + DEADLINE + 1));
    expect(after.expired).toEqual([FLEET_ID]);
    const detail = h.store.node(FLEET_ID)?.updateDetail;
    expect(detail).toBe("deadline — the fleet link failed mid-op; the row's last report does not name v0.0.10");
    expect(detail).not.toContain('was reported');
  });

  it("D-3214's stamp-unmeasured override (`inventory.ts`) writes the row's own PREVIOUS report back over a "
    + "genuine one — the deadline still says only what the row's LAST report proves (fix round 1, review 178 F1, "
    + 'case ii)', async () => {
    const h = harness({ send: async () => { throw new Error('timeout'); }, localIo: NOTHING_IO });
    // A REAL previous release is already recorded on this row before the lease for v0.0.10 is even acquired.
    seedFleet(h, 'v0.0.10', {
      report: { phase: 'done', target: 'v0.0.9', startedAt: T0 - 100_000, updatedAt: T0 - 90_000, detail: null },
    });
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'pending', reportedPhase: 'done', reportedTarget: 'v0.0.9',
    });
    // The node's own update.json now says `done v0.0.10` — a genuine report of THIS lease's run — but its build
    // stamp cannot be read on this sweep (no build.json planted). D-3214's override (`inventory.ts:603-605`)
    // restores the row's OWN previous report rather than storing the new one, so `reportedTarget` stays v0.0.9
    // even though the node reported v0.0.10 done. Read through the REAL sweep (`sweepInventory`), not this file's
    // `sweepOnce` shortcut, which deliberately skips this override (see its own doc comment above).
    mkdirSync(h.deps.ccrcDir, { recursive: true });
    writeFileSync(path.join(h.deps.ccrcDir, 'node-id'), `${FLEET_ID}\n`);
    writeFileSync(path.join(h.deps.ccrcDir, 'update.json'), `${JSON.stringify({
      target: 'v0.0.10', phase: 'done', startedAt: 1_790_000_002, updatedAt: 1_790_000_100, detail: null, from: 'cli',
    })}\n`);
    const invDeps: InventoryDeps = {
      store: h.store, localIo: NOTHING_IO, ccrcDir: h.deps.ccrcDir, role: 'server', fleet: { io: localIO, state: h.state },
    };
    const [, fleet] = await sweepInventory(invDeps, T0 + 2000);
    expect(fleet).toMatchObject({ label: FLEET_LABEL, result: 'measured', nodeId: FLEET_ID, lease: 'none' });
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'pending', reportedPhase: 'done', reportedTarget: 'v0.0.9', stampRead: 'absent',
    });
    const after = ran(await runDispatch(h.deps, T0 + 2000 + DEADLINE + 1));
    expect(after.expired).toEqual([FLEET_ID]);
    const detail = h.store.node(FLEET_ID)?.updateDetail;
    expect(detail).toBe("deadline — the fleet link failed mid-op; the row's last report does not name v0.0.10");
    expect(detail).not.toContain('was reported');
  });
});

describe('runDispatch — a revive during the op hands the lease to the heir, and the answer lands on the heir (residue R5, review 176 F1)', () => {
  const FLEET_ID2 = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';
  const notSettled = (n: { updateState: string }): boolean => n.updateState !== 'idle' && n.updateState !== 'reverted' && n.updateState !== 'failed';
  const busyRows = (h: Harness): string[] => h.store.nodes().filter(notSettled).map((n) => n.nodeId);

  /** The observations `send` records on its FIRST call, so the harness's own `expect`s land as themselves rather
   *  than being caught by `linkAnswer` and reported as a transport failure (any non-`AgentOpError` throw inside
   *  `send` becomes a transport hold, which swallows a failed assertion and reports the wrong cause). */
  interface SendObserved { rekey?: { ok: boolean; revived?: boolean }; busyIds?: string[]; busyStartedAt?: number | null }

  /** The reviewer's interleaving (steps 1-4): U1 idle, rekeyed away to U2, U2 requested and dispatched; the
   *  harness's `send` then revives U1 BACK — mid-op — before it answers, so the lease U2 acquired is now U1's,
   *  and RECORDS (never asserts, so a failure here is not folded into `linkAnswer`'s catch) that exactly one live
   *  busy row remains (U1, holding the acquire's `updateStartedAt`) before answering with `tail`. Recorded only
   *  on the first call: a later `send` (e.g. a post-deadline re-move) must not re-record or re-assert. Step 5
   *  (`runDispatch`) is left to the caller, which asserts on `observed` after it returns. */
  const setup = (tail: SendUpdateOp): { h: Harness; observed: SendObserved } => {
    const box: { h?: Harness } = {};
    const observed: SendObserved = {};
    let first = true;
    const send: SendUpdateOp = async (tag, kind) => {
      const h = box.h!;
      if (first) {
        first = false;
        observed.rekey = h.store.rekeyNode(FLEET_LABEL, FLEET_ID);
        const busy = h.store.nodes().filter(notSettled);
        observed.busyIds = busy.map((n) => n.nodeId);
        observed.busyStartedAt = busy[0]?.updateStartedAt;
      }
      return tail(tag, kind);
    };
    const h = harness({ send });
    box.h = h;
    seedFleet(h, null);   // U1 = FLEET_ID, idle, no request
    expect(h.store.rekeyNode(FLEET_LABEL, FLEET_ID2)).toMatchObject({ ok: true, retired: 1, revived: false });
    expect(h.store.upsertNodeMeasurement(fleetMeas({ nodeId: FLEET_ID2 })).ok).toBe(true);
    expect(h.store.requestNode(FLEET_ID2, 'v0.0.10', 'update', T0).ok).toBe(true);
    return { h, observed };
  };

  /** The interleaving's own assertions, checked AFTER `runDispatch` resolves so a failure reports itself instead
   *  of being caught inside `send` and re-reported as a transport hold. */
  const assertObserved = (observed: SendObserved): void => {
    expect(observed.rekey).toMatchObject({ ok: true, revived: true });
    expect(observed.busyIds, 'exactly one live busy row remains, and it is FLEET_ID').toEqual([FLEET_ID]);
    expect(observed.busyStartedAt, 'the live busy row holds the acquire\'s updateStartedAt').toBe(T0 + 1000);
  };

  interface ReleaseCase { name: string; answer: SendUpdateOp; to: 'idle' | 'failed'; detail: string }
  const releaseCases: ReleaseCase[] = [
    { name: 'busy', answer: async () => { throw new AgentOpError('busy', IN_FLIGHT); }, to: 'idle', detail: `busy — ${IN_FLIGHT}` },
    {
      name: 'not-queued', answer: async () => { throw new AgentOpError('not-queued', 'stopped before it queued anything'); },
      to: 'idle', detail: 'not-queued — stopped before it queued anything',
    },
    { name: 'spawn-failed', answer: async () => { throw new AgentOpError('spawn-failed', 'boom'); }, to: 'failed', detail: 'spawn-failed — boom' },
    { name: 'bad-tag', answer: async () => { throw new AgentOpError('bad-tag', null); }, to: 'failed', detail: 'agent refused the op: bad-tag' },
    { name: 'bad-kind', answer: async () => { throw new AgentOpError('bad-kind', null); }, to: 'failed', detail: 'agent refused the op: bad-kind' },
    { name: 'bad-request', answer: async () => { throw new AgentOpError('bad-request', null); }, to: 'failed', detail: AGENT_REJECTED_DETAIL },
    { name: 'forbidden', answer: async () => { throw new AgentOpError('forbidden', null); }, to: 'failed', detail: 'agent answered forbidden' },
    { name: 'ok-without-accepted', answer: async () => ({ t: 'res', id: 1, ok: true }), to: 'failed', detail: 'agent answered ok-without-accepted' },
    {
      name: 'disconnected (never sent)', answer: async () => { throw new LinkNotSentError('disconnected'); },
      to: 'idle', detail: 'disconnected — the op never reached the fleet link; the request stands',
    },
  ];

  it.each(releaseCases)('every release word lands on the heir, not the id acquired: $name', async ({ answer, to, detail }) => {
    const { h, observed } = setup(answer);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    assertObserved(observed);
    expect(r.outcome).toEqual({ nodeId: FLEET_ID, result: 'released', to, detail });
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: to, updateDetail: detail });
    expect(busyRows(h), 'no live row is busy').toEqual([]);
    expect(h.store.node(FLEET_ID2)?.supersededBy).toBe(FLEET_ID);
    const r2 = ran(await runDispatch(h.deps, T0 + 1000 + DEADLINE + 1));
    expect(r2.expired, 'no false failed: deadline follows a release').toEqual([]);
  });

  interface HoldCase { name: string; answer: SendUpdateOp; detail: string }
  const holdCases: HoldCase[] = [
    {
      name: 'an accepted with the bound\'s words',
      answer: async () => ({ t: 'res', id: 1, ok: true, accepted: true, detail: 'held at the bound: it queued v0.0.10' }),
      detail: 'held at the bound: it queued v0.0.10',
    },
    {
      name: 'a timeout (Task 2\'s hold: a link failure after the hand-off holds like accepted)',
      answer: async () => { throw new Error('timeout'); },
      detail: linkFailedHoldDetail('timeout', 'timeout'),
    },
  ];

  it.each(holdCases)('every hold word lands on the heir, not the id acquired: $name', async ({ answer, detail }) => {
    const { h, observed } = setup(answer);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    assertObserved(observed);
    expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, detail });
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateDetail: detail });
    expect(busyRows(h), 'exactly one live busy row remains, and it is FLEET_ID').toEqual([FLEET_ID]);
  });

  it('the fallback (control): a settled lease has no holder, so the write goes to the id acquired — today\'s behaviour, unchanged', async () => {
    const box: { h?: Harness } = {};
    const send: SendUpdateOp = async () => {
      // U2's own report settles its lease before the answer arrives — no rekey at all.
      sweepOnce(box.h!.store, fleetMeas({
        nodeId: FLEET_ID2, currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', measuredAt: T0 + 1500,
        report: { phase: 'done', target: 'v0.0.10', startedAt: T0 + 1000, updatedAt: T0 + 1400, detail: null },
      }));
      throw new AgentOpError('busy', IN_FLIGHT);
    };
    const h = harness({ send });
    box.h = h;
    seedFleet(h, null);
    expect(h.store.rekeyNode(FLEET_LABEL, FLEET_ID2)).toMatchObject({ ok: true, retired: 1, revived: false });
    expect(h.store.upsertNodeMeasurement(fleetMeas({ nodeId: FLEET_ID2 })).ok).toBe(true);
    expect(h.store.requestNode(FLEET_ID2, 'v0.0.10', 'update', T0).ok).toBe(true);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({
      nodeId: FLEET_ID2, result: 'release-refused', to: 'idle', detail: `busy — ${IN_FLIGHT}`, why: 'not-busy',
    });
  });
});

describe('runDispatch — a rollback the node is known to refuse (wave 8 item C, D-3587, D-3588)', () => {
  /** v0.0.8's row, re-applied with its provenance bundle unlisted (`coverage: 'single'`, an upsert by tag —
   *  `seedReleases` already planted v0.0.8/9/10, all bundled). */
  const noBundleV8 = (store: CoordStore): void => {
    expect(store.applyReleaseListing([{ ...rel('v0.0.8', T0 - 3000), bundleListed: false }], T0, 'single').ok).toBe(true);
  };

  it('(a) a pre-W8 standing rollback request to a no-bundle tag never sends, and the request stands (decision 7)', async () => {
    const h = harness();
    noBundleV8(h.store);
    expect(h.store.upsertNodeMeasurement(fleetMeas()).ok).toBe(true);
    expect(h.store.requestNode(FLEET_ID, 'v0.0.8', 'rollback', T0).ok).toBe(true);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toBeNull();
    expect(h.sent).toEqual([]);
    expect(h.spawned).toEqual([]);
    expect(r.plan.gate.haltedBy).toEqual([]);
    const row = h.store.node(FLEET_ID)!;
    expect(row.updateState).toBe('idle');
    expect(row.updateDetail).toMatch(/^no-bundle — /);
    expect(row.requestedTag).toBe('v0.0.8');
    expect(row.requestedKind).toBe('rollback');
  });

  it('(b) that request on the FLEET row, plus a server row with an AUTO move: the server\'s op sends in the same run', async () => {
    const h = harness();
    noBundleV8(h.store);
    const capsWithGate = ['verify', 'node-id', 'floor', 'update-json', 'detach', 'rollback', UPDATE_GATE_CAP];
    expect(h.store.upsertNodeMeasurement(fleetMeas({ caps: capsWithGate })).ok).toBe(true);
    expect(h.store.requestNode(FLEET_ID, 'v0.0.8', 'rollback', T0).ok).toBe(true);
    expect(h.store.upsertNodeMeasurement(serverMeas({ caps: capsWithGate })).ok).toBe(true);
    // A fleet-wide auto intent (D-3588's exclusion applies to BOTH holds; neither may hold the server here).
    const log = new UpdateIntentLog(defaultUpdateIntentLogPath(h.deps.ccrcDir));
    expect(h.store.setIntent(FLEET_SCOPE, { channel: 'stable', auto: 'channel' }, log, T0).ok).toBe(true);
    expect(h.store.resolveNode(FLEET_ID, { channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null }).ok).toBe(true);
    expect(h.store.resolveNode(SERVER_ID, { channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null }).ok).toBe(true);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    expect(h.sent).toEqual([]);   // the fleet row's own refused request is never sent over the link
    expect(h.store.node(FLEET_ID)!.updateDetail).toMatch(/^no-bundle — /);
  });
});
