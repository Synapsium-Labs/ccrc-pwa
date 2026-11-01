// The update plane's rollout parity (D-7678, D-7679): what the PWA-started update plane does so the two boxes end
// on one build, the way `ccrc rollout` does from a terminal (fleet box first, then the server box to the SAME tag).
//
//   D-7678 — a request written beside a node's own running lease survives that lease's settle, so Update all tapped
//            while the server was still finishing an older move is not dropped: the dispatcher moves the fleet to
//            the new tag, then the server.
//   D-7679 — when a fleet-role row's requested update to T lands (`done` with the stamp at T, whatever the done
//            detail says — a failed doctor still moved the box), every idle server-role row with no request and a
//            floor below T is requested T, so the server follows. A refusal is noted on the server row instead; a
//            `failed` fleet move, a server already at T, and a server with its own request write nothing.
//
// Everything runs over a real CoordStore on an `mkTmp` coord.db through the REAL inventory sweep (`sweepInventory`)
// reading fixture node files, and the REAL dispatcher act (`runDispatch`): the link is a recording function and
// the server's spawn a recording Runner behind `spawnFromRunner`. Nothing touches the live $HOME.
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ResOk } from '../../shared/agent-protocol.js';
import { NODE_FILES } from '../../shared/agent-protocol.js';
import type { RequestKind } from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import type { ExecResult, Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import { localIO, type FleetIO } from '../src/io.js';
import {
  dispatchViewsFor, followLandedMove, runDispatch, type ConvergeDeps, type DispatchRunResult,
} from '../src/update/converge.js';
import type { MoveFeedRecord } from '../src/update/dispatch.js';
import { FLEET_LABEL, SERVER_LABEL, sweepInventory, type InventoryDeps } from '../src/update/inventory.js';
import { Bus } from '../src/bus.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { spawnFromRunner } from './updateSpawnFake.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const T_S = Math.floor(T0 / 1000);
const DEADLINE = 900_000;
const FLEET_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const SERVER_ID = '05050505-0505-4505-8505-050505050505';
const SHA = 'a'.repeat(40);
const ACCEPTED: ResOk = { t: 'res', id: 1, ok: true, accepted: true };
const MOVE_CAPS = ['verify', 'node-id', 'floor', 'update-json', 'update-gate', 'detach', 'rollback'];
const DOCTOR_DONE = "doctor exited 1 — the box moved; its health is ccrc doctor's";

const rel = (tag: string, publishedAt: number): ReleaseListingRow => ({
  tag, channel: 'stable', publishedAt, commitSha: null, tarballUrl: `https://example.invalid/ccrc-${tag}.tar.gz`,
  bundleListed: true, notes: null, draft: false,
});

const fleetMeas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.9', currentSha: SHA, currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: MOVE_CAPS, agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8',
  floorRead: 'measured', previousRead: 'measured', os: 'linux', measuredAt: T0, report: null, ...over,
});
const serverMeas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement =>
  fleetMeas({ nodeId: SERVER_ID, role: 'server', label: SERVER_LABEL, agentOps: null, ...over });

/** One box's ~/.ccrc node files, as the inventory sweep reads them. */
function plantBox(dir: string, o: { id: string; version: string; caps?: readonly string[]; report?: Record<string, unknown> }): void {
  mkdirSync(dir, { recursive: true });
  const files: Partial<Record<keyof typeof NODE_FILES, string>> = {
    nodeId: `${o.id}\n`,
    stamp: `${JSON.stringify({ sha: SHA, ref: 'main', builtAt: '2026-09-20T00:00:00Z', dirty: false, version: o.version })}\n`,
    installed: `${SHA}\n`,
    caps: `os linux\n${(o.caps ?? MOVE_CAPS).join('\n')}\n`,
    floor: `${o.version}\n`, previous: 'v0.0.8\n',
  };
  if (o.report !== undefined) files.report = `${JSON.stringify(o.report)}\n`;
  for (const [k, body] of Object.entries(files)) writeFileSync(path.join(dir, NODE_FILES[k as keyof typeof NODE_FILES]), body);
}

/** The server's OWN io reads a directory of its own: every path under `from` is read under `to` instead, so the
 *  two rows of one sweep (which share one `ccrcDir`, the same-absolute-path assumption every remote read makes)
 *  measure two different boxes. */
function remapIo(from: string, to: string, base: FleetIO = localIO): FleetIO {
  return new Proxy(base, {
    get(target, key, receiver) {
      const v: unknown = Reflect.get(target, key, receiver);
      if (typeof v !== 'function') return v;
      return (p: unknown, ...rest: unknown[]) => (v as (...a: unknown[]) => unknown).call(
        target, typeof p === 'string' && p.startsWith(from) ? `${to}${p.slice(from.length)}` : p, ...rest,
      );
    },
  });
}

interface Harness {
  store: CoordStore; home: string; fleetDir: string; serverDir: string; deps: ConvergeDeps; inv: InventoryDeps;
  sent: { tag: string; kind: RequestKind }[]; spawned: { cmd: string; args: string[] }[]; records: MoveFeedRecord[];
}

function harness(): Harness {
  const home = mkTmp('update-rollout-follow-');
  const fleetDir = path.join(home, '.ccrc');
  const serverDir = path.join(home, 'server-ccrc');
  const store = new CoordStore(openCoordDb(path.join(home, 'coord.db')));
  expect(store.applyReleaseListing([rel('v0.0.9', T0 - 3000), rel('v0.0.10', T0 - 2000), rel('v0.0.11', T0 - 1000)],
    T0 - 500, 'complete').ok).toBe(true);
  const state: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, agentOps: ['update'] };
  const sent: Harness['sent'] = [];
  const spawned: Harness['spawned'] = [];
  const records: MoveFeedRecord[] = [];
  const ok: Runner = async (cmd, args): Promise<ExecResult> => { spawned.push({ cmd, args: [...args] }); return { ran: true, code: 0, stdout: '', stderr: '' }; };
  const deps: ConvergeDeps = {
    store, role: 'server', ccrcDir: serverDir, localIo: remapIo(fleetDir, serverDir), deadlineMs: DEADLINE,
    fleet: { state, send: async (tag, kind) => { sent.push({ tag, kind }); return ACCEPTED; } },
    runLocal: spawnFromRunner(ok, home),
    onAccepted: () => {},
    recordMove: (r) => { records.push(r); },
  };
  const inv: InventoryDeps = {
    store, localIo: remapIo(fleetDir, serverDir), ccrcDir: fleetDir, role: 'server', fleet: { io: localIO, state },
    follow: (landed, now) => { followLandedMove({ store, recordMove: (r) => { records.push(r); } }, landed, now); },
  };
  expect(store.upsertNodeMeasurement(fleetMeas()).ok).toBe(true);
  expect(store.upsertNodeMeasurement(serverMeas()).ok).toBe(true);
  return { store, home, fleetDir, serverDir, deps, inv, sent, spawned, records };
}

type Ran = Extract<DispatchRunResult, { ran: true }>;
const ran = (r: DispatchRunResult): Ran => {
  if (!r.ran) throw new Error(`the dispatch run did not run: ${r.why}`);
  return r;
};
const serverArgv = (tag: string): string[] => ['update', '--to', tag, '--detach', '--from', 'pwa'];

/** The fleet row's requested move to `tag`, dispatched: its lease is held and the op was sent. */
async function fleetMoving(h: Harness, tag: string, at: number): Promise<void> {
  expect(h.store.requestNode(FLEET_ID, tag, 'update', at).ok).toBe(true);
  const r = ran(await runDispatch(h.deps, at + 1));
  expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
}

describe('D-7679: the server follows a fleet move that landed, to the same tag', () => {
  it("a fleet `done` at T whose detail says the doctor failed settles the fleet row, requests T on the idle server row, and the next plan moves the server to T — with the server's auto off", async () => {
    const h = harness();
    expect(dispatchViewsFor(h.store).find((v) => v.row.nodeId === SERVER_ID)!.auto, 'auto is off for the server').toBe('off');
    await fleetMoving(h, 'v0.0.10', T0);
    plantBox(h.fleetDir, { id: FLEET_ID, version: 'v0.0.10', report: {
      target: 'v0.0.10', phase: 'done', startedAt: T_S + 2, updatedAt: T_S + 90, detail: DOCTOR_DONE, from: 'pwa',
    } });
    plantBox(h.serverDir, { id: SERVER_ID, version: 'v0.0.9' });
    const out = await sweepInventory(h.inv, T0 + 60_000);
    expect(out.find((o) => o.label === FLEET_LABEL)).toMatchObject({ result: 'measured', nodeId: FLEET_ID, lease: 'settle' });
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: 'done: v0.0.10', requestedTag: null });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: 'v0.0.10', requestedKind: 'update' });
    expect(h.records.map((r) => r.title)).toContain('update server: follows fleet to v0.0.10');

    const next = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(next.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: serverArgv('v0.0.10') }]);
    expect(h.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);   // the server is never sent the op over the link
  });

  it('a server already at or above T writes nothing', async () => {
    const h = harness();
    expect(h.store.upsertNodeMeasurement(serverMeas({ currentVersion: 'v0.0.10', highestVersion: 'v0.0.10' })).ok).toBe(true);
    await fleetMoving(h, 'v0.0.10', T0);
    plantBox(h.fleetDir, { id: FLEET_ID, version: 'v0.0.10', report: {
      target: 'v0.0.10', phase: 'done', startedAt: T_S + 2, updatedAt: T_S + 90, detail: null, from: 'pwa',
    } });
    plantBox(h.serverDir, { id: SERVER_ID, version: 'v0.0.10' });
    const before = h.store.node(SERVER_ID)!.updateDetail;
    await sweepInventory(h.inv, T0 + 60_000);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: 'done: v0.0.10' });
    expect(h.store.node(SERVER_ID)).toMatchObject({ requestedTag: null, updateDetail: before });
    expect(h.records.filter((r) => r.title.includes('follow'))).toEqual([]);
  });

  it('a fleet `failed` writes nothing on the server — the halt stands, the server lane stops', async () => {
    const h = harness();
    await fleetMoving(h, 'v0.0.10', T0);
    plantBox(h.fleetDir, { id: FLEET_ID, version: 'v0.0.9', report: {
      target: 'v0.0.10', phase: 'failed', startedAt: T_S + 2, updatedAt: T_S + 90, detail: 'gate: unit not up', from: 'pwa',
    } });
    plantBox(h.serverDir, { id: SERVER_ID, version: 'v0.0.9' });
    await sweepInventory(h.inv, T0 + 60_000);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: 'gate: unit not up' });
    expect(h.store.node(SERVER_ID)).toMatchObject({ requestedTag: null });
    expect(h.records.filter((r) => r.title.includes('follow'))).toEqual([]);
    const next = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(next.outcome).toBeNull();
    expect(h.spawned).toEqual([]);
  });

  it('a server row with its own request keeps it — the follow-through never overwrites an operator request', async () => {
    const h = harness();
    await fleetMoving(h, 'v0.0.10', T0);
    expect(h.store.requestNode(SERVER_ID, 'v0.0.11', 'update', T0 + 5).ok).toBe(true);
    plantBox(h.fleetDir, { id: FLEET_ID, version: 'v0.0.10', report: {
      target: 'v0.0.10', phase: 'done', startedAt: T_S + 2, updatedAt: T_S + 90, detail: null, from: 'pwa',
    } });
    plantBox(h.serverDir, { id: SERVER_ID, version: 'v0.0.9' });
    await sweepInventory(h.inv, T0 + 60_000);
    expect(h.store.node(SERVER_ID)).toMatchObject({ requestedTag: 'v0.0.11', requestedAt: T0 + 5 });
    expect(h.records.filter((r) => r.title.includes('follow'))).toEqual([]);
  });

  it('a server the dispatcher would refuse is NOTED on its row, saying the fleet moved and why the server cannot follow — no request is written', async () => {
    const h = harness();
    const noDetach = MOVE_CAPS.filter((c) => c !== 'detach');
    expect(h.store.upsertNodeMeasurement(serverMeas({ caps: noDetach })).ok).toBe(true);
    await fleetMoving(h, 'v0.0.10', T0);
    plantBox(h.fleetDir, { id: FLEET_ID, version: 'v0.0.10', report: {
      target: 'v0.0.10', phase: 'done', startedAt: T_S + 2, updatedAt: T_S + 90, detail: null, from: 'pwa',
    } });
    plantBox(h.serverDir, { id: SERVER_ID, version: 'v0.0.9', caps: noDetach });
    await sweepInventory(h.inv, T0 + 60_000);
    const server = h.store.node(SERVER_ID)!;
    expect(server.requestedTag).toBeNull();
    expect(server.updateDetail).toMatch(/^fleet moved to v0\.0\.10 — server cannot follow: no-detach-cap — /);
    expect(h.records.map((r) => r.title)).toContain('update server: cannot follow fleet to v0.0.10');
  });

  it('a fleet move auto made (no request) leaves the server to its own auto: nothing is written', async () => {
    const h = harness();
    // An auto move has no request on the row; the lease is acquired the way the dispatcher's auto arm does.
    expect(h.store.dispatchNode(FLEET_ID, 'v0.0.10', 'update', T0, 'auto update from v0.0.9 to v0.0.10')).toEqual({ ok: true });
    plantBox(h.fleetDir, { id: FLEET_ID, version: 'v0.0.10', report: {
      target: 'v0.0.10', phase: 'done', startedAt: T_S + 2, updatedAt: T_S + 90, detail: null, from: 'pwa',
    } });
    plantBox(h.serverDir, { id: SERVER_ID, version: 'v0.0.9' });
    await sweepInventory(h.inv, T0 + 60_000);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: 'done: v0.0.10' });
    expect(h.store.node(SERVER_ID)).toMatchObject({ requestedTag: null });
  });
});

describe('D-7678: Update all tapped while the server finishes an older move converges both boxes on the new tag', () => {
  it("after the server's v(N) lease settles, the dispatcher moves the fleet to v(N+1), then the server to v(N+1)", async () => {
    const h = harness();
    expect(h.store.upsertNodeMeasurement(fleetMeas({ currentVersion: 'v0.0.10', highestVersion: 'v0.0.10' })).ok).toBe(true);
    // The server's own v0.0.10 move is running (the fleet already runs v0.0.10, so nothing held it back).
    expect(h.store.requestNode(SERVER_ID, 'v0.0.10', 'update', T0).ok).toBe(true);
    const first = ran(await runDispatch(h.deps, T0 + 1));
    expect(first.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    // Update all v0.0.11 lands while that lease is busy: requestAll's writes, through the same writer.
    expect(h.store.requestNode(FLEET_ID, 'v0.0.11', 'update', T0 + 10).ok).toBe(true);
    expect(h.store.requestNode(SERVER_ID, 'v0.0.11', 'update', T0 + 10).ok).toBe(true);
    // The server's v0.0.10 run reports done: its lease settles and the v0.0.11 request survives it.
    plantBox(h.serverDir, { id: SERVER_ID, version: 'v0.0.10', report: {
      target: 'v0.0.10', phase: 'done', startedAt: T_S + 1, updatedAt: T_S + 60, detail: null, from: 'pwa',
    } });
    plantBox(h.fleetDir, { id: FLEET_ID, version: 'v0.0.10' });
    await sweepInventory(h.inv, T0 + 60_000);
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', updateDetail: 'done: v0.0.10', requestedTag: 'v0.0.11' });
    // Fleet first.
    const second = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(second.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(h.sent).toEqual([{ tag: 'v0.0.11', kind: 'update' }]);
    expect(second.plan.refusals.find((r) => r.nodeId === SERVER_ID)?.refusal).toBe('waiting-for-fleet');
    plantBox(h.fleetDir, { id: FLEET_ID, version: 'v0.0.11', report: {
      target: 'v0.0.11', phase: 'done', startedAt: T_S + 62, updatedAt: T_S + 120, detail: null, from: 'pwa',
    } });
    await sweepInventory(h.inv, T0 + 120_000);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: 'done: v0.0.11' });
    // Then the server, to the same tag.
    const third = ran(await runDispatch(h.deps, T0 + 121_000));
    expect(third.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned.map((s) => s.args)).toEqual([serverArgv('v0.0.10'), serverArgv('v0.0.11')]);
  });
});

describe('D-7688: a request older than the running lease never survives its settle to pin the server lane', () => {
  it('a fleet request for v0.0.10 written beside its running v0.0.11 move is cleared when v0.0.11 lands — no not-newer refusal, nothing holds the server', async () => {
    const h = harness();
    await fleetMoving(h, 'v0.0.11', T0);
    // The write an Update all for the OLDER v0.0.10 made beside the busy row before D-7688 (requestAll now
    // refuses it `not-newer`); the settle must not keep it either.
    expect(h.store.requestNode(FLEET_ID, 'v0.0.10', 'update', T0 + 10).ok).toBe(true);
    plantBox(h.fleetDir, { id: FLEET_ID, version: 'v0.0.11', report: {
      target: 'v0.0.11', phase: 'done', startedAt: T_S + 2, updatedAt: T_S + 90, detail: null, from: 'pwa',
    } });
    plantBox(h.serverDir, { id: SERVER_ID, version: 'v0.0.9' });
    await sweepInventory(h.inv, T0 + 60_000);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: 'done: v0.0.11', requestedTag: null });
    // The stale request replaced the one the lease served, so this settle is not a requested move the follow-through
    // reads (`landedMoveOf`); the server is moved by the operator's tap (the banner's `move` arm), and nothing on the
    // fleet row holds that tap `waiting-for-fleet`.
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: null });
    expect(h.store.requestNode(SERVER_ID, 'v0.0.11', 'update', T0 + 60_500).ok).toBe(true);
    const next = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(next.plan.refusals, JSON.stringify(next.plan)).toEqual([]);
    expect(next.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: serverArgv('v0.0.11') }]);
  });
});

describe('D-7679: the FleetWatcher wires the follow-through into its own inventory run', () => {
  it("the watcher's inventory run settles the fleet's landed move and requests the same tag on the server", async () => {
    const home = mkTmp('update-rollout-follow-watch-');
    const base = testDeps(home);
    const fleetDir = path.join(home, 'fleet-ccrc');
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    expect(coord.applyReleaseListing([rel('v0.0.9', T0 - 3000), rel('v0.0.10', T0 - 2000)], T0 - 500, 'complete').ok).toBe(true);
    expect(coord.upsertNodeMeasurement(fleetMeas()).ok).toBe(true);
    expect(coord.upsertNodeMeasurement(serverMeas()).ok).toBe(true);
    expect(coord.requestNode(FLEET_ID, 'v0.0.10', 'update', T0).ok).toBe(true);
    expect(coord.dispatchNode(FLEET_ID, 'v0.0.10', 'update', T0 + 1, 'requested update from v0.0.9 to v0.0.10')).toEqual({ ok: true });
    plantBox(fleetDir, { id: FLEET_ID, version: 'v0.0.10', report: {
      target: 'v0.0.10', phase: 'done', startedAt: T_S + 2, updatedAt: T_S + 90, detail: DOCTOR_DONE, from: 'pwa',
    } });
    plantBox(base.cfg.ccrcDir, { id: SERVER_ID, version: 'v0.0.9' });
    const fleetState: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, agentOps: ['update'] };
    const deps: Deps = {
      ...base, cfg: { ...base.cfg, role: 'server', fleetMode: 'remote' }, coord, fleetState,
      // The fleet connection's reads land in the fleet box's own directory; the server's own row reads its own.
      io: remapIo(base.cfg.ccrcDir, fleetDir, base.io),
    };
    const watcher = new FleetWatcher(deps, new Bus());
    // The dispatcher run the inventory run ends in is not what this case measures: it is stubbed, so the row reads
    // exactly what the sweep wrote.
    vi.spyOn(watcher as unknown as { dispatchOnce(): Promise<DispatchRunResult> }, 'dispatchOnce')
      .mockResolvedValue({ ran: false, why: 'no-coord' });
    await watcher.inventoryNow();
    expect(coord.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: 'done: v0.0.10' });
    expect(coord.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: 'v0.0.10', requestedKind: 'update' });
    coord.db.close();
  });
});
