// Path-identity spec 2026-10-12 §5.2 and §5.9: the inventory publishes the fleet node's identity ONLY from its own
// direct read of `node-id`, ONLY under the connection epoch it captured before its one await, and never from the
// connection-label fallback, a uuid carried forward from the persisted row, or a collision. FIXTURE HOMEs only:
// every ~/.ccrc is an `mkTmp` home, every coord.db is that home's own, and the fleet node is `localIO` over the
// fixture, a scripted io spread over `localIO`, or a real in-process agent over a real loopback WS.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../../agent/src/server.js';
import { NODE_FILES, type NodeFileKey } from '../../shared/agent-protocol.js';
import { collectLaneEffective, type CollectCurrentNode, type CollectLaneRow } from '../src/collectLane.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { FleetIdentityCell, type CurrentFleetIdentity, type FleetNodeMeasured } from '../src/fleetidentity.js';
import type { FleetState } from '../src/fleetstate.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import {
  FLEET_LABEL, NODE_FILE_CAP_BYTES, SERVER_LABEL, fleetNodeMeasuredOf, sweepInventory,
  type FleetIdentityPublisher, type InventoryDeps, type NodeFileRead, type SweepOutcome,
} from '../src/update/inventory.js';
import { bootAgent, connectToAgent, makeFixture } from './remoteHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const U1 = '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
const U2 = '11111111-2222-4333-8444-555555555555';
const NOW = 1_758_500_120_000;

type Measured = Exclude<NodeFileKey, 'projection' | 'tokenGeneration'>;
const stampJson = (): string =>
  `${JSON.stringify({ sha: SHA, ref: 'main', builtAt: '2026-09-22T10:00:00Z', dirty: false, version: 'v0.0.12' })}\n`;
/** Every node file but `node-id` (`update-inventory.test.ts`'s NO_ID). */
const NO_ID: Partial<Record<Measured, string>> = {
  stamp: stampJson(), installed: `${SHA}\n`, caps: 'os linux\nverify\nnode-id\nfloor\n', floor: 'v0.0.12\n', previous: 'v0.0.11\n',
};
const withId = (id: string): Partial<Record<Measured, string>> => ({ ...NO_ID, nodeId: `${id}\n` });

function plant(ccrcDir: string, files: Partial<Record<Measured, string>>): void {
  mkdirSync(ccrcDir, { recursive: true });
  for (const [key, body] of Object.entries(files) as [Measured, string][]) {
    writeFileSync(path.join(ccrcDir, NODE_FILES[key]), body);
  }
}
const unplant = (ccrcDir: string, key: Measured): void => rmSync(path.join(ccrcDir, NODE_FILES[key]), { force: true });

interface Box { ccrcDir: string; store: CoordStore }
/** A fixture HOME with its own coord database, never the live one. */
function box(prefix: string): Box {
  const ccrcDir = path.join(mkTmp(prefix), '.ccrc');
  return { ccrcDir, store: new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db'))) };
}
const fleetState = (): FleetState => ({ connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null });
/** The server row's io in the remote cases: it reads nothing, so the fleet row alone reads the fixture. */
const NOTHING_IO: FleetIO = { ...localIO, lstatMeasured: async () => ({ ok: false as const, reason: 'absent' as const }) };
const remoteDeps = (b: Box, identity: FleetIdentityPublisher, io: FleetIO = localIO): InventoryDeps =>
  ({ store: b.store, localIo: NOTHING_IO, ccrcDir: b.ccrcDir, role: 'server', fleet: { io, state: fleetState(), identity } });
/** A cell as the client leaves it after its first accepted ready: epoch 1, nothing measured yet. */
const readyCell = (): FleetIdentityCell => {
  const cell = new FleetIdentityCell();
  cell.invalidate('awaiting-inventory');
  return cell;
};
const measuredAs = (nodeId: string): SweepOutcome => ({ label: FLEET_LABEL, result: 'measured', nodeId, lease: 'none', refused: false });

describe('identity is published only from the direct read, under the captured epoch (path-identity spec §5.2, §5.9)', () => {
  let agent: RunningAgent | undefined;
  let fleet: ConnectedFleet | undefined;
  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
  });

  it('the planted node-id is known', async () => {
    const b = box('ccrc-ident-known-');
    plant(b.ccrcDir, withId(U1));
    const cell = readyCell();
    const out = await sweepInventory(remoteDeps(b, cell), NOW);
    expect(out[1]).toMatchObject({ label: FLEET_LABEL, result: 'measured', nodeId: U1 });
    expect(cell.current()).toEqual({ kind: 'known', connectionEpoch: 1, nodeId: U1, measuredAt: NOW });
  });

  it('an invalidation during the node-id read leaves it awaiting-inventory, and the row is still written', async () => {
    const b = box('ccrc-ident-midread-');
    plant(b.ccrcDir, withId(U1));
    const cell = readyCell();
    // A ready is accepted while the node-id read is out (the link dropped and came back; `connected` reads true).
    const reconnecting: FleetIO = {
      ...localIO,
      readFileMeasured: async (p, timeoutMs, signal) => {
        if (path.basename(p) === NODE_FILES.nodeId) cell.invalidate('awaiting-inventory');
        return localIO.readFileMeasured(p, timeoutMs, signal);
      },
    };
    const out = await sweepInventory(remoteDeps(b, cell, reconnecting), NOW);
    expect(cell.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 2, why: 'awaiting-inventory' });
    // The row is written as it always was; the sweep the new ready triggers re-measures it under the new epoch.
    expect(out[1]).toMatchObject({ label: FLEET_LABEL, result: 'measured', nodeId: U1 });
    expect(b.store.node(U1)).toMatchObject({ label: FLEET_LABEL, reachable: true, measuredAt: NOW });
  });

  it('the label fallback is never identity', async () => {
    const b = box('ccrc-ident-label-');
    plant(b.ccrcDir, NO_ID);
    const cell = readyCell();
    const out = await sweepInventory(remoteDeps(b, cell), NOW);
    expect(out[1], 'CONTROL: the row is keyed by the connection label').toMatchObject({ result: 'measured', nodeId: FLEET_LABEL });
    expect(cell.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 1, why: 'node-id-absent' });
  });

  it('the carried persisted uuid is never identity', async () => {
    const b = box('ccrc-ident-carry-');
    plant(b.ccrcDir, withId(U2));
    const cell = readyCell();
    await sweepInventory(remoteDeps(b, cell), NOW - 60_000);
    expect(cell.current()).toEqual({ kind: 'known', connectionEpoch: 1, nodeId: U2, measuredAt: NOW - 60_000 });
    unplant(b.ccrcDir, 'nodeId');
    const out = await sweepInventory(remoteDeps(b, cell), NOW);
    // CONTROL: the inventory keeps measuring into the row it already re-keyed, so the outcome still names U2.
    expect(out[1]).toMatchObject({ result: 'measured', nodeId: U2 });
    expect(cell.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 1, why: 'node-id-absent' });
  });

  it('a collision is collision', async () => {
    const b = box('ccrc-ident-collision-');
    // Both connections read ONE directory, so the fleet's node-id already keys the server's live row.
    plant(b.ccrcDir, withId(U1));
    const cell = readyCell();
    const deps: InventoryDeps = {
      store: b.store, localIo: localIO, ccrcDir: b.ccrcDir, role: 'both', fleet: { io: localIO, state: fleetState(), identity: cell },
    };
    const out = await sweepInventory(deps, NOW);
    expect(out[1]).toMatchObject({ label: FLEET_LABEL, result: 'node-id-collision' });
    expect(cell.current()).toEqual({ kind: 'collision', connectionEpoch: 1, why: 'node-id-keys-another-live-row' });
    expect('nodeId' in cell.current()).toBe(false);
  });

  it('unreadable, too-large and malformed each keep their own why', async () => {
    const whyAfter = async (prefix: string, files: Partial<Record<Measured, string>>, io: FleetIO = localIO): Promise<CurrentFleetIdentity> => {
      const b = box(prefix);
      plant(b.ccrcDir, files);
      const cell = readyCell();
      await sweepInventory(remoteDeps(b, cell, io), NOW);
      return cell.current();
    };
    const unreadableId: FleetIO = {
      ...localIO,
      readFileMeasured: async (p, timeoutMs, signal) => (path.basename(p) === NODE_FILES.nodeId
        ? { ok: false as const, reason: 'unreadable' as const }
        : localIO.readFileMeasured(p, timeoutMs, signal)),
    };
    expect(await whyAfter('ccrc-ident-unreadable-', withId(U1), unreadableId))
      .toEqual({ kind: 'unmeasured', connectionEpoch: 1, why: 'node-id-unreadable' });
    // Over the cap even though its first line is a valid id: a too-large file is never read as one.
    expect(await whyAfter('ccrc-ident-large-', { ...NO_ID, nodeId: `${U1}\n${'x'.repeat(NODE_FILE_CAP_BYTES)}` }))
      .toEqual({ kind: 'unmeasured', connectionEpoch: 1, why: 'node-id-too-large' });
    expect(await whyAfter('ccrc-ident-malformed-', { ...NO_ID, nodeId: 'not-a-uuid\n' }))
      .toEqual({ kind: 'unmeasured', connectionEpoch: 1, why: 'node-id-malformed' });
    expect(await whyAfter('ccrc-ident-upper-', withId(U1.toUpperCase())))
      .toEqual({ kind: 'unmeasured', connectionEpoch: 1, why: 'node-id-malformed' });
    expect(await whyAfter('ccrc-ident-absent-', NO_ID))
      .toEqual({ kind: 'unmeasured', connectionEpoch: 1, why: 'node-id-absent' });
  });

  it('known needs outcome.result measured and outcome.nodeId equal to the direct read; a disagreement is node-id-malformed', () => {
    const read: NodeFileRead = { ok: true, content: `${U1}\n` };
    const rows: readonly (readonly [string, NodeFileRead, SweepOutcome, FleetNodeMeasured])[] = [
      ['agree', read, measuredAs(U1), { kind: 'known', nodeId: U1, measuredAt: NOW }],
      ['the row keyed by another uuid', read, measuredAs(U2), { kind: 'unmeasured', why: 'node-id-malformed' }],
      ['the row keyed by the label', read, measuredAs(FLEET_LABEL), { kind: 'unmeasured', why: 'node-id-malformed' }],
      ['collision', read, { label: FLEET_LABEL, result: 'node-id-collision', nodeId: FLEET_LABEL, lease: 'none', refused: false },
        { kind: 'collision', why: 'node-id-keys-another-live-row' }],
      ['refused', read, { label: FLEET_LABEL, result: 'refused', why: 'bad-node-id' }, { kind: 'unmeasured', why: 'inventory-refused' }],
      ['error', read, { label: FLEET_LABEL, result: 'error', message: 'boom' }, { kind: 'unmeasured', why: 'inventory-refused' }],
      ['unreachable', read, { label: FLEET_LABEL, result: 'unreachable', nodeId: FLEET_LABEL }, { kind: 'unmeasured', why: 'link-down' }],
      ['absent beside a carried uuid', { ok: false, reason: 'absent' }, measuredAs(U1), { kind: 'unmeasured', why: 'node-id-absent' }],
      ['unreadable beside a carried uuid', { ok: false, reason: 'unreadable' }, measuredAs(U1), { kind: 'unmeasured', why: 'node-id-unreadable' }],
      ['too large beside a carried uuid', { ok: false, reason: 'too-large' }, measuredAs(U1), { kind: 'unmeasured', why: 'node-id-too-large' }],
      ['malformed', { ok: true, content: 'not-a-uuid\n' }, measuredAs(FLEET_LABEL), { kind: 'unmeasured', why: 'node-id-malformed' }],
    ];
    for (const [name, r, outcome, want] of rows) expect(fleetNodeMeasuredOf(r, outcome, NOW), name).toEqual(want);
  });

  it('local mode publishes the own node under epoch 0 through ownIdentity', async () => {
    // In local mode this box IS the fleet node: nothing invalidates the cell, and the server row's own sweep publishes.
    const b = box('ccrc-ident-local-');
    plant(b.ccrcDir, withId(U1));
    const cell = new FleetIdentityCell();
    const out = await sweepInventory(
      { store: b.store, localIo: localIO, ccrcDir: b.ccrcDir, role: 'both', fleet: null, ownIdentity: cell }, NOW);
    expect(out).toEqual([{ label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'none', refused: false }]);
    expect(cell.current()).toEqual({ kind: 'known', connectionEpoch: 0, nodeId: U1, measuredAt: NOW });
    // The remote shape sets no ownIdentity: the server box's own node-id never reaches the fleet cell.
    const r = box('ccrc-ident-remote-own-');
    plant(r.ccrcDir, withId(U1));
    const fleetCell = readyCell();
    const outR = await sweepInventory(
      { store: r.store, localIo: localIO, ccrcDir: r.ccrcDir, role: 'server', fleet: { io: NOTHING_IO, state: fleetState(), identity: fleetCell } },
      NOW);
    expect(outR[0]).toMatchObject({ label: SERVER_LABEL, result: 'measured', nodeId: U1 });
    expect(fleetCell.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 1, why: 'node-id-absent' });
  });

  /** A real agent over a fixture HOME whose node-id is `id`, a real client to it, and the ready trigger wired the way
   *  index.ts wires it, but straight to `sweepInventory`. The server row reads nothing (`NOTHING_IO`), so only the
   *  fleet row reads the fixture: one directory read by both rows would be a collision. `atReady` records what each
   *  ready leaves in the cell, before any sweep could publish into it. */
  async function wired(prefix: string, id: string): Promise<{ f: ConnectedFleet; ccrcDir: string; atReady: CurrentFleetIdentity[] }> {
    const fixture = makeFixture();
    const ccrcDir = path.join(fixture.home, '.ccrc');
    plant(ccrcDir, withId(id));
    agent = await bootAgent(fixture);
    const b = box(prefix);
    const f = connectToAgent(agent.port);
    fleet = f;
    const atReady: CurrentFleetIdentity[] = [];
    f.client.onConnected(() => { atReady.push(f.identity.current()); });
    f.client.onConnected(() => {
      void sweepInventory(
        { store: b.store, localIo: NOTHING_IO, ccrcDir, role: 'server', fleet: { io: f.io, state: f.state, identity: f.identity } },
        Date.now());
    });
    return { f, ccrcDir, atReady };
  }

  it('a real agent reconnecting to a different node goes unmeasured then known(U2) on a larger epoch', async () => {
    // Spec §5.3: "Connect a different or unmeasured fleet node: Settings Live is ineffective until freshly confirmed
    // for that node." Here the node-id behind the same address changes while the link is down.
    const { f, ccrcDir, atReady } = await wired('ccrc-ident-swap-', U1);
    await vi.waitFor(() => { expect(f.identity.current()).toMatchObject({ kind: 'known', nodeId: U1 }); }, { timeout: 3000, interval: 20 });
    const first = f.identity.epochNow();
    expect(atReady).toEqual([{ kind: 'unmeasured', connectionEpoch: first, why: 'awaiting-inventory' }]);
    writeFileSync(path.join(ccrcDir, NODE_FILES.nodeId), `${U2}\n`);
    f.client.ws?.close();
    await vi.waitFor(() => { expect(atReady).toHaveLength(2); }, { timeout: 3000, interval: 20 });
    expect(atReady[1]).toMatchObject({ kind: 'unmeasured', why: 'awaiting-inventory' });
    expect(atReady[1]!.connectionEpoch).toBeGreaterThan(first);
    await vi.waitFor(() => { expect(f.identity.current()).toMatchObject({ kind: 'known', nodeId: U2 }); }, { timeout: 3000, interval: 20 });
    expect(f.identity.current().connectionEpoch).toBe(atReady[1]!.connectionEpoch);
  });

  it('the same node re-arms after a fresh measurement with no new confirm', async () => {
    // Spec §5.8 SW7 A: a stored Live is "eligible to re-arm after the same node is freshly measured", "with the
    // post-ready state stopped until same-epoch identity is known". The stored row never changes: no new confirm.
    const STORED_LIVE_U1: CollectLaneRow = { choice: 'live', fleetNodeId: U1, markerRetiredAt: 1_000, generation: 1, updatedAt: 1_000 };
    const settingsArm = (node: CollectCurrentNode) => collectLaneEffective({
      switches: { paused: false, marker: false },
      epoch: { before: node.connectionEpoch, after: node.connectionEpoch },
      caps: { collect: true, reclaimPause: true },
      control: { kind: 'coherent', row: STORED_LIVE_U1, generation: 1, bootstrap: false },
      node,
    });
    const { f, atReady } = await wired('ccrc-ident-same-', U1);
    await vi.waitFor(() => { expect(f.identity.current()).toMatchObject({ kind: 'known', nodeId: U1 }); }, { timeout: 3000, interval: 20 });
    expect(settingsArm(f.identity.current()), 'CONTROL: armed before the link restarts').toMatchObject({ kind: 'live', armedBy: 'settings' });
    f.client.ws?.close();
    await vi.waitFor(() => { expect(atReady).toHaveLength(2); }, { timeout: 3000, interval: 20 });
    expect(settingsArm(atReady[1]!)).toEqual({ kind: 'stopped', why: 'unknown-fleet' });
    await vi.waitFor(() => {
      expect(f.identity.current()).toMatchObject({ kind: 'known', nodeId: U1, connectionEpoch: atReady[1]!.connectionEpoch });
    }, { timeout: 3000, interval: 20 });
    expect(atReady[1]!.connectionEpoch).toBeGreaterThan(atReady[0]!.connectionEpoch);
    expect(settingsArm(f.identity.current())).toMatchObject({ kind: 'live', armedBy: 'settings' });
  });
});
