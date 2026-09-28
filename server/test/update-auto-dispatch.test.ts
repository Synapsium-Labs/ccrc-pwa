// Centralised update management, programme wave 5 Task 7 (design 2026-09-20 §9
// "auto", §10, §18 "`auto` needs the gate cap, at dispatch time" and "every
// capability refusal is in the dispatcher"). The intent route's
// `409 auto-needs-rollback-gate` is ADVISORY; the dispatcher is the enforcement.
// So every intent row below that a capless node would have made the route
// refuse is written by `setIntent` DIRECTLY — the path a node that was offline
// when `auto` was set takes back into the dispatcher (§9) — and then resolved,
// as the route's `reproject` and every sweep's `sweepThenProject` resolve,
// because `desiredTag` is a stored column the resolver writes. Nothing here
// reads the live `$HOME`: every box is a `mkTmp` fixture, the fleet link is a
// recording `SendUpdateOp`, and the server-role spawn a recording `Runner`
// behind `spawnFromRunner` (the double for `localUpdateSpawnFor`) — the same two-template capability `index.ts` binds.
import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { FLEET_SCOPE, UPDATE_GATE_CAP, type RequestKind } from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import {
  CoordStore, type NodeMeasurement, type ReleaseListingRow, type UpdateIntentPatch,
} from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import { DEFAULT_UPDATE_DEADLINE_MS } from '../src/config.js';
import type { Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import { localIO } from '../src/io.js';
import { Bus } from '../src/bus.js';
import { buildServer, type Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { RESOLVE_DETAIL, autoGateBlockers } from '../src/update/resolve.js';
import { resolveAndProject } from '../src/update/project.js';
import { DETACH_CAP, ROLLBACK_CAP } from '../src/update/dispatch.js';
import { runDispatch, type ConvergeDeps, type DispatchRunResult } from '../src/update/converge.js';
import { spawnFromRunner } from './updateSpawnFake.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_790_000_000_000;
/** Two node-ids in `_inst_node_id`'s lowercase shape (`NODE_ID_RE`) — a node
 *  scope in `setIntent` must be one (W2 D-3194). */
const FLEET_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const SERVER_ID = '05050505-0505-4505-8505-050505050505';

/** What a W1–W3 install writes: no W4 word at all. */
const W1_CAPS = ['verify', 'node-id', 'floor'];
/** Every W4 word but the gate. `moveRefusal` checks `detach` before the gate, so
 *  only this shape isolates `no-update-gate` — a real pre-W4 box is W1_CAPS and
 *  is refused `no-detach-cap` first (the control case below). */
const NO_GATE = [...W1_CAPS, 'update-json', ROLLBACK_CAP, DETACH_CAP];
const GATED = [...NO_GATE, UPDATE_GATE_CAP];

/** One stable and one dev release, both with a bundle listed: a stable node at
 *  v0.0.9 resolves v0.0.10, a dev node v0.0.11. */
const LISTING: readonly ReleaseListingRow[] = [
  { tag: 'v0.0.10', channel: 'stable', publishedAt: NOW - 120_000, commitSha: null,
    tarballUrl: 'https://example.invalid/ccrc-v0.0.10.tar.gz', bundleListed: true, notes: null, draft: false },
  { tag: 'v0.0.11', channel: 'dev', publishedAt: NOW - 60_000, commitSha: null,
    tarballUrl: 'https://example.invalid/ccrc-v0.0.11.tar.gz', bundleListed: true, notes: null, draft: false },
];

/** The fleet node as the inventory measures it over a W4 agent: `agentOps`
 *  advertises the op, so the only refusal left to find is the capability one. */
const fleetNode = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main',
  currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: NO_GATE, agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8', floorRead: 'measured', previousRead: 'measured', os: 'linux',
  measuredAt: NOW - 60_000, report: null,
  ...over,
});
/** The server's own row: spawned locally, `agentOps` NULL by construction (decision 11). */
const serverNode = (over: Partial<NodeMeasurement> = {}): NodeMeasurement =>
  fleetNode({ nodeId: SERVER_ID, role: 'server', label: SERVER_LABEL, agentOps: null, ...over });

interface Box {
  home: string; ccrcDir: string; store: CoordStore; log: UpdateIntentLog; state: FleetState;
  sent: { tag: string; kind: RequestKind }[];
  spawned: { cmd: string; args: string[] }[];
  accepted: number;
}

/** A fixture HOME with its own coord.db and the catalogue above — never the live one. */
function box(): Box {
  const home = mkTmp('ccrc-update-auto-');
  const ccrcDir = path.join(home, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  const store = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  const listed = store.applyReleaseListing(LISTING, NOW - 30_000, 'complete');
  expect(listed.ok, JSON.stringify(listed)).toBe(true);
  return {
    home, ccrcDir, store, log: new UpdateIntentLog(defaultUpdateIntentLogPath(ccrcDir)),
    // Task 11's fixture shape, connected, with a W4 agent's `ready.ops`.
    state: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, agentOps: ['update'] },
    sent: [], spawned: [], accepted: 0,
  };
}

/** The recording `Runner` the local spawn capability runs: it records the argv
 *  `spawnFromRunner` hands it and exits 0, as a `--detach` parent does. */
const recorder = (spawned: { cmd: string; args: string[] }[]): Runner => async (cmd, args) => {
  spawned.push({ cmd, args: [...args] });
  return { code: 0, stdout: '', stderr: '' };
};

/** A two-box fleet's server: the link records every op it is asked to send and
 *  answers `accepted`; the local spawn is `spawnFromRunner` (Task 5's capability, doubled) over the
 *  recorder, so the argv asserted below is the one the capability builds. */
const deps = (b: Box): ConvergeDeps => ({
  store: b.store, role: 'server', ccrcDir: b.ccrcDir, localIo: localIO,
  deadlineMs: DEFAULT_UPDATE_DEADLINE_MS,
  fleet: {
    state: b.state,
    send: async (tag, kind) => {
      b.sent.push({ tag, kind });
      return { t: 'res', id: b.sent.length, ok: true, accepted: true };
    },
  },
  runLocal: spawnFromRunner(recorder(b.spawned), b.home),
  onAccepted: () => { b.accepted += 1; },
});

const measure = (b: Box, m: NodeMeasurement): void => {
  const r = b.store.upsertNodeMeasurement(m);
  expect(r.ok, `measuring ${m.nodeId}: ${JSON.stringify(r)}`).toBe(true);
};
/** The resolver, as the intent route and every sweep run it after a write. */
const resolve = async (b: Box, now: number): Promise<void> => {
  await resolveAndProject({ store: b.store, role: 'server', ccrcDir: b.ccrcDir }, now);
};
/** `setIntent` DIRECTLY — around the advisory route — then the resolver. */
const intend = async (b: Box, scope: string, patch: UpdateIntentPatch, now = NOW): Promise<void> => {
  const w = b.store.setIntent(scope, patch, b.log, now);
  expect(w.ok, JSON.stringify(w)).toBe(true);
  await resolve(b, now);
};
type Ran = Extract<DispatchRunResult, { ran: true }>;
const run = async (b: Box, now = NOW): Promise<Ran> => {
  const r = await runDispatch(deps(b), now);
  if (!r.ran) throw new Error(`runDispatch did not run: ${r.why}`);
  return r;
};

describe('auto needs the gate cap, at dispatch time (spec §9, §18)', () => {
  it('a node whose measured caps lack update-gate is refused no-update-gate under auto: no op, no lease, no request', async () => {
    const b = box();
    measure(b, fleetNode());
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    expect(b.store.node(FLEET_ID)).toMatchObject({ channel: 'stable', desiredTag: 'v0.0.10' });
    const r = await run(b);
    expect(r.plan.move).toBeNull();
    expect(r.plan.refusals).toEqual([expect.objectContaining({ nodeId: FLEET_ID, refusal: 'no-update-gate' })]);
    expect(r.outcome).toBeNull();
    expect(b.sent, 'the capless node was sent the op').toEqual([]);
    expect(b.spawned).toEqual([]);
    expect(b.accepted).toBe(0);
    const row = b.store.node(FLEET_ID)!;
    expect(row).toMatchObject({
      updateState: 'idle', updateTarget: null, updateStartedAt: null,
      requestedTag: null, requestedKind: null, requestedAt: null,
    });
    expect(row.updateDetail).toMatch(/^no-update-gate — /);
  });

  it('the same node re-measured WITH update-gate dispatches on the next run — the caps read are the ones measured now', async () => {
    const b = box();
    measure(b, fleetNode());
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    expect((await run(b)).plan.move).toBeNull();
    measure(b, fleetNode({ caps: GATED, measuredAt: NOW + 60_000 }));
    await resolve(b, NOW + 60_000);
    const r = await run(b, NOW + 60_000);
    expect(r.plan.move).toMatchObject({ nodeId: FLEET_ID, kind: 'update', target: 'v0.0.10', source: 'auto', viaLink: true });
    expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(b.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(b.spawned).toEqual([]);
    expect(b.accepted).toBe(1);
    // An auto move is a lease, never a request: nothing for ack to clear.
    expect(b.store.node(FLEET_ID)).toMatchObject({
      updateState: 'pending', updateTarget: 'v0.0.10', updateStartedAt: NOW + 60_000, requestedTag: null,
    });
  });

  it('a node offline when auto was set cannot converge unattended on its return (§9, the sentence this row is about)', async () => {
    const b = box();
    measure(b, fleetNode());
    expect(b.store.markUnreachable(FLEET_LABEL, 'fleet', NOW - 30_000)).toMatchObject({ ok: true, nodeId: FLEET_ID });
    b.state.connected = false;
    // The route would have refused this write — the advisory predicate names the node, reachable or not.
    expect(autoGateBlockers(FLEET_SCOPE, b.store.nodes().map((n) => ({ nodeId: n.nodeId, caps: n.caps }))))
      .toEqual([FLEET_ID]);
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    const away = await run(b);
    expect(away.plan.move).toBeNull();
    expect(away.plan.refusals, 'an unreachable node is not considered, so nothing is noted').toEqual([]);
    expect(b.store.node(FLEET_ID)?.updateDetail).toBeNull();
    // It comes back — still capless.
    b.state.connected = true;
    measure(b, fleetNode({ measuredAt: NOW + 60_000 }));
    await resolve(b, NOW + 60_000);
    const back = await run(b, NOW + 60_000);
    expect(back.plan.move).toBeNull();
    expect(back.plan.refusals).toEqual([expect.objectContaining({ nodeId: FLEET_ID, refusal: 'no-update-gate' })]);
    expect(b.sent).toEqual([]);
    expect(b.store.node(FLEET_ID)).toMatchObject({ reachable: true, updateState: 'idle', requestedTag: null });
  });

  it('control: a W1-caps box under auto is refused no-detach-cap — moveRefusal checks detach first, and still no op', async () => {
    const b = box();
    measure(b, fleetNode({ caps: W1_CAPS }));
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    const r = await run(b);
    expect(r.plan.move).toBeNull();
    expect(r.plan.refusals).toEqual([expect.objectContaining({ nodeId: FLEET_ID, refusal: 'no-detach-cap' })]);
    expect(b.sent).toEqual([]);
  });

  it("auto 'stable' on a node resolved dev moves nothing and notes nothing — the node is not considered", async () => {
    const b = box();
    measure(b, fleetNode({ caps: GATED }));
    await intend(b, FLEET_SCOPE, { channel: 'dev', auto: 'stable' });
    expect(b.store.node(FLEET_ID)).toMatchObject({ channel: 'dev', desiredTag: 'v0.0.11' });
    const r = await run(b);
    expect(r.plan.move).toBeNull();
    expect(r.plan.refusals).toEqual([]);
    expect(b.sent).toEqual([]);
    expect(b.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: null });
  });

  it("auto 'off' moves nothing, gated or not — notify only", async () => {
    const b = box();
    measure(b, fleetNode({ caps: GATED }));
    await intend(b, FLEET_SCOPE, { auto: 'off' });
    expect(b.store.node(FLEET_ID)?.desiredTag).toBe('v0.0.10');
    const r = await run(b);
    expect(r.plan.move).toBeNull();
    expect(r.plan.refusals).toEqual([]);
    expect(b.sent).toEqual([]);
    expect(b.spawned).toEqual([]);
  });

  it("a per-node auto row over '*' off moves that node only — the fleet node over the link", async () => {
    const b = box();
    measure(b, fleetNode({ caps: GATED }));
    measure(b, serverNode({ caps: GATED }));
    await intend(b, FLEET_ID, { auto: 'channel' });
    expect(b.store.intentFor(FLEET_SCOPE)!.auto).toBe('off');
    const r = await run(b);
    expect(r.plan.move).toMatchObject({ nodeId: FLEET_ID, source: 'auto', viaLink: true });
    expect(b.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(b.spawned, 'the server row follows `*` (off) and must not move').toEqual([]);
    expect(b.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', updateDetail: null });
  });

  it("a per-node auto row over '*' off moves that node only — the server node, spawned locally", async () => {
    const b = box();
    measure(b, fleetNode({ caps: GATED }));
    measure(b, serverNode({ caps: GATED }));
    await intend(b, SERVER_ID, { auto: 'channel' });
    const r = await run(b);
    expect(r.plan.move).toMatchObject({ nodeId: SERVER_ID, source: 'auto', viaLink: false });
    expect(b.spawned).toEqual([
      { cmd: `${b.home}/.local/bin/ccrc`, args: ['update', '--to', 'v0.0.10', '--detach', '--from', 'pwa'] },
    ]);
    expect(b.sent, 'the fleet row follows `*` (off) and must not be sent the op').toEqual([]);
    expect(b.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: null });
  });

  it('an operator request on a capless node moves under auto — a requested update needs detach, not the gate', async () => {
    const b = box();
    measure(b, fleetNode());
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    expect(b.store.requestNode(FLEET_ID, 'v0.0.10', 'update', NOW)).toMatchObject({ ok: true });
    const r = await run(b);
    expect(r.plan.move).toMatchObject({ nodeId: FLEET_ID, kind: 'update', target: 'v0.0.10', source: 'request' });
    expect(b.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    // The request stands until convergence settles it (decision 7) — the lease is what moved.
    expect(b.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', requestedTag: 'v0.0.10', requestedKind: 'update' });
  });

  it('the server row lacking update-gate under auto is refused no-update-gate — checked for caps, never for agentOps', async () => {
    const b = box();
    measure(b, serverNode());
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    const refused = await run(b);
    expect(refused.plan.move).toBeNull();
    expect(refused.plan.refusals).toEqual([expect.objectContaining({ nodeId: SERVER_ID, refusal: 'no-update-gate' })]);
    expect(b.spawned).toEqual([]);
    expect(b.store.node(SERVER_ID)?.updateDetail).toMatch(/^no-update-gate — /);
    // Gated, the same row moves — and agentOps NULL is never read as "predates the op".
    measure(b, serverNode({ caps: GATED, measuredAt: NOW + 60_000 }));
    await resolve(b, NOW + 60_000);
    const moved = await run(b, NOW + 60_000);
    expect(moved.plan.move).toMatchObject({ nodeId: SERVER_ID, source: 'auto', viaLink: false });
    expect(b.spawned).toEqual([
      { cmd: `${b.home}/.local/bin/ccrc`, args: ['update', '--to', 'v0.0.10', '--detach', '--from', 'pwa'] },
    ]);
    expect(b.sent).toEqual([]);
  });

  it("a gated server waits behind a gateless fleet under '*' auto; once gated the fleet moves first, then the server (D-3402)", async () => {
    const b = box();
    measure(b, fleetNode());                          // NO_GATE: auto cannot move it
    measure(b, serverNode({ caps: GATED }));
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    const held = await run(b);
    expect(held.plan.move).toBeNull();
    expect(held.plan.refusals.map((r) => [r.nodeId, r.refusal]))
      .toEqual([[FLEET_ID, 'no-update-gate'], [SERVER_ID, 'waiting-for-fleet']]);
    expect(b.sent).toEqual([]);
    expect(b.spawned, 'the server auto-moved before the fleet').toEqual([]);
    expect(b.store.node(SERVER_ID)?.updateDetail).toMatch(/^waiting-for-fleet — /);
    // The fleet is gated: it moves first, over the link, while the server still waits.
    measure(b, fleetNode({ caps: GATED, measuredAt: NOW + 60_000 }));
    await resolve(b, NOW + 60_000);
    const first = await run(b, NOW + 60_000);
    expect(first.plan.move).toMatchObject({ nodeId: FLEET_ID, source: 'auto', viaLink: true });
    expect(b.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(b.spawned).toEqual([]);
    // The fleet converges — measured at the target and settled by W2's writer, as its sweep settles a `done`
    // report — so its desiredTag resolves NULL, and the server moves on the next run.
    measure(b, fleetNode({ caps: GATED, currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', measuredAt: NOW + 120_000 }));
    expect(b.store.settleNode(FLEET_ID, 'converged at v0.0.10', null)).toMatchObject({ ok: true });
    await resolve(b, NOW + 120_000);
    expect(b.store.node(FLEET_ID)?.desiredTag).toBeNull();
    const second = await run(b, NOW + 120_000);
    expect(second.plan.move).toMatchObject({ nodeId: SERVER_ID, source: 'auto', viaLink: false });
    expect(b.spawned).toEqual([
      { cmd: `${b.home}/.local/bin/ccrc`, args: ['update', '--to', 'v0.0.10', '--detach', '--from', 'pwa'] },
    ]);
    expect(b.sent).toHaveLength(1);
  });

  it('an auto move is never a rollback: a node rolled back below its floor resolves nothing, and nothing is dispatched', async () => {
    const b = box();
    // Floor v0.0.10 (highest), running v0.0.8: the only eligible stable tag is the floor itself.
    measure(b, fleetNode({ caps: GATED, currentVersion: 'v0.0.8', highestVersion: 'v0.0.10', previousVersion: 'v0.0.10' }));
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    expect(b.store.node(FLEET_ID)).toMatchObject({
      desiredTag: null, resolveDetail: RESOLVE_DETAIL.rolledBack('v0.0.8', 'v0.0.10'),
    });
    const r = await run(b);
    expect(r.plan.move).toBeNull();
    expect(r.plan.refusals).toEqual([]);
    expect(b.sent).toEqual([]);
    expect(b.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', requestedTag: null, requestedKind: null });
  });
});

describe('the advisory route and the enforcing dispatcher, one box (FleetWatcher.dispatchNow)', () => {
  it('the intent route still answers 409 auto-needs-rollback-gate; auto written around it is refused at dispatch', async () => {
    const home = mkTmp('ccrc-update-auto-watch-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    expect(coord.applyReleaseListing(LISTING, NOW - 30_000, 'complete').ok).toBe(true);
    const spawned: { cmd: string; args: string[] }[] = [];
    // `Deps.updateRunner` is a LocalUpdateSpawn (Task 5, D-3397) — bound as index.ts binds it.
    const updateRunner = spawnFromRunner(recorder(spawned), home);
    const log = new UpdateIntentLog(defaultUpdateIntentLogPath(base.cfg.ccrcDir));
    const deps: Deps = { ...base, coord, updateIntentLog: log, updateRunner };
    const bus = new Bus();
    // A REAL watcher, never started; its state cache on the fixture home.
    const w = new FleetWatcher(deps, bus, 60_000, path.join(base.cfg.ccrcDir, 'state-cache.json'));
    const app = await buildServer(deps, bus, w);
    await app.ready();
    try {
      // The local-mode box: its one row is the server's own, labelled SERVER_LABEL,
      // so the route's on-demand sweep (`ensureInventory`) does not re-measure it.
      const m = coord.upsertNodeMeasurement(serverNode({ role: base.cfg.role }));
      expect(m.ok, JSON.stringify(m)).toBe(true);
      const res = await app.inject({ method: 'POST', url: '/api/updates/intent', payload: { scope: '*', auto: 'channel' } });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toEqual({ ok: false, error: 'auto-needs-rollback-gate', nodes: [SERVER_ID] });
      expect(coord.intentFor(FLEET_SCOPE)!.auto).toBe('off');
      // The enforcement does not lean on that refusal: the row written around it.
      expect(coord.setIntent(FLEET_SCOPE, { auto: 'channel' }, log, NOW).ok).toBe(true);
      await resolveAndProject({ store: coord, role: base.cfg.role, ccrcDir: base.cfg.ccrcDir }, NOW);
      const r = await w.dispatchNow();
      if (!r.ran) throw new Error(`dispatchNow did not run: ${r.why}`);
      expect(r.plan.refusals).toEqual([expect.objectContaining({ nodeId: SERVER_ID, refusal: 'no-update-gate' })]);
      expect(r.outcome).toBeNull();
      expect(spawned, 'the capless server node was spawned under auto').toEqual([]);
      expect(coord.node(SERVER_ID)?.updateDetail).toMatch(/^no-update-gate — /);
    } finally {
      await app.close();
      coord.db.close();
    }
  });
});
