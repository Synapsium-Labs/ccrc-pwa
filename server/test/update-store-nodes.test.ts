// Design 2026-09-20 §6/§8/§10, W2 Task 5 — the `nodes` row's writer groups,
// one method family each: measurement + report (`upsertNodeMeasurement`,
// `markUnreachable`), identity (`rekeyNode`), lease (`releaseLease`,
// `settleNode`, `ackNode`), resolved (`resolveNode`). Nothing in W2 acquires
// a lease, so every busy row below is PLANTED by raw SQL — the fixture W4's
// `dispatchNode` will produce for real.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, NODE_ID_RE, type NodeMeasurement, type NodeRow } from '../src/coord/store.js';
import { fleetGate, isHalting } from '../src/update/dispatch.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const UUID_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const UUID_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const UUID_S = '05050505-0505-4505-8505-050505050505';

const fresh = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('update-store-nodes-'), 'coord.db')));

/** A clean fleet-node measurement; each case overrides what it is about. */
const meas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: 'fleet', role: 'fleet', label: 'fleet',
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent', os: 'linux',
  measuredAt: T0, report: null, ...over,
});

/** The lease W4's dispatcher would acquire, planted. `state` is a raw string
 *  so a token outside `UpdateState` can be planted too. */
const plantLease = (store: CoordStore, nodeId: string, state: string, startedAt: number | null,
  target = 'v0.0.10'): void => {
  store.db.prepare(
    'UPDATE nodes SET updateState = ?, updateTarget = ?, updateStartedAt = ?, updateDetail = ? WHERE nodeId = ?',
  ).run(state, target, startedAt, 'planted', nodeId);
};
/** The request W4's apply route would write, planted. */
const plantRequest = (store: CoordStore, nodeId: string, tag = 'v0.0.10'): void => {
  store.db.prepare("UPDATE nodes SET requestedTag = ?, requestedKind = 'update', requestedAt = ? WHERE nodeId = ?")
    .run(tag, T0, nodeId);
};
const plantResolved = (store: CoordStore, nodeId: string): void => {
  store.db.prepare("UPDATE nodes SET channel = 'stable', desiredTag = 'v0.0.10', resolveDetail = NULL WHERE nodeId = ?")
    .run(nodeId);
};
/** One column exactly as stored — for the NULL-versus-'' distinctions the
 *  row reader is not allowed to hide. */
const raw = (store: CoordStore, nodeId: string, col: string): unknown =>
  (store.db.prepare(`SELECT ${col} AS v FROM nodes WHERE nodeId = ?`).get(nodeId) as { v: unknown }).v;
/** A fresh store holding one measured node with a planted lease. */
const leased = (state: string, startedAt: number | null, nodeId = UUID_A): CoordStore => {
  const s = fresh();
  expect(s.upsertNodeMeasurement(meas({ nodeId })).ok).toBe(true);
  plantLease(s, nodeId, state, startedAt);
  return s;
};

describe('upsertNodeMeasurement — the measurement and report groups only', () => {
  it('creates, then updates, and every measurement and report column round-trips (§18 "a full BuildInfo round-trips")', () => {
    const store = fresh();
    expect(store.upsertNodeMeasurement(meas())).toEqual({ ok: true, created: true });
    const expected: NodeRow = {
      nodeId: 'fleet', role: 'fleet', label: 'fleet',
      currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
      currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
      caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
      floorRead: 'measured', previousRead: 'absent', os: 'linux',
      measuredAt: T0, reachable: true, unreachableSince: null,
      reportedPhase: null, reportedTarget: null, reportedStartedAt: null, reportedUpdatedAt: null, reportedDetail: null,
      updateState: 'idle', updateTarget: null, updateStartedAt: null, updateDetail: null,
      channel: null, desiredTag: null, resolveDetail: null,
      requestedTag: null, requestedKind: null, requestedAt: null, supersededBy: null,
    };
    expect(store.node('fleet')).toEqual(expected);
    const report = { phase: 'installing', target: 'v0.0.10', startedAt: T0 + 1000, updatedAt: T0 + 2000,
      detail: 'placing the tree' } as const;
    expect(store.upsertNodeMeasurement(meas({ currentDirty: true, previousVersion: 'v0.0.8',
      measuredAt: T0 + 60_000, report }))).toEqual({ ok: true, created: false });
    expect(store.node('fleet')).toEqual({ ...expected, currentDirty: true, previousVersion: 'v0.0.8',
      measuredAt: T0 + 60_000, reportedPhase: 'installing', reportedTarget: 'v0.0.10',
      reportedStartedAt: T0 + 1000, reportedUpdatedAt: T0 + 2000, reportedDetail: 'placing the tree' });
    // A report file that is gone again is five NULLs, not the last one's values.
    store.upsertNodeMeasurement(meas({ measuredAt: T0 + 120_000 }));
    expect(store.node('fleet')).toMatchObject({ reportedPhase: null, reportedTarget: null, reportedStartedAt: null,
      reportedUpdatedAt: null, reportedDetail: null });
  });

  it('an unreadable stamp keeps its read word beside NULL current* columns (§18 "stampRead keeps EACCES from unversioned")', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ stampRead: 'unreadable', currentVersion: null, currentSha: null,
      currentRef: null, currentBuiltAt: null, currentDirty: null, installState: 'unknown', provenance: 'unknown' }));
    expect(store.node('fleet')).toMatchObject({ stampRead: 'unreadable', currentVersion: null, currentSha: null,
      currentRef: null, currentBuiltAt: null, currentDirty: null, installState: 'unknown', measuredAt: T0 });
    expect(raw(store, 'fleet', 'currentDirty')).toBeNull();
  });

  it('keeps agentOps NULL (no agent by construction) apart from \'\' (an agent too old to say); caps [] is stored as \'\'', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null, caps: [] }));
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A, agentOps: [] }));
    store.upsertNodeMeasurement(meas({ nodeId: UUID_B, label: 'other', agentOps: ['update'] }));
    expect(raw(store, UUID_S, 'agentOps')).toBeNull();
    expect(raw(store, UUID_S, 'caps')).toBe('');
    expect(raw(store, UUID_A, 'agentOps')).toBe('');
    expect(raw(store, UUID_A, 'caps')).toBe('verify node-id floor');
    expect(store.node(UUID_S)).toMatchObject({ agentOps: null, caps: [] });
    expect(store.node(UUID_A)!.agentOps).toEqual([]);
    expect(store.node(UUID_B)!.agentOps).toEqual(['update']);
  });

  it('names no lease, resolved, request or identity column — a measurement never moves any of them (§6 writer groups)', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas());
    plantLease(store, 'fleet', 'failed', T0);
    plantRequest(store, 'fleet');
    plantResolved(store, 'fleet');
    const before = store.node('fleet')!;
    store.upsertNodeMeasurement(meas({ measuredAt: T0 + 60_000,
      report: { phase: 'done', target: 'v0.0.10', startedAt: T0, updatedAt: T0 + 1, detail: null } }));
    const after = store.node('fleet')!;
    for (const k of ['updateState', 'updateTarget', 'updateStartedAt', 'updateDetail', 'channel', 'desiredTag',
      'resolveDetail', 'requestedTag', 'requestedKind', 'requestedAt', 'supersededBy'] as const) {
      expect(after[k], k).toEqual(before[k]);
    }
    expect(after.reportedPhase).toBe('done');
  });

  it('a stored token outside each vocabulary reads the named fallback (D-3181)', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas());
    store.db.prepare(
      "UPDATE nodes SET role = 'router', stampRead = 'partial', installState = 'half', provenance = 'maybe', " +
      "os = 'plan9', updateState = 'paused', reportedPhase = 'downloading', channel = 'nightly', " +
      "requestedKind = 'reinstall' WHERE nodeId = 'fleet'",
    ).run();
    expect(store.node('fleet')).toMatchObject({ role: null, stampRead: 'unreadable', installState: 'unknown',
      provenance: 'unknown', os: 'unknown', updateState: 'unknown', reportedPhase: 'unknown', channel: null,
      requestedKind: null });
  });

  it('an invalid stored caps or agentOps word list reads as [] — one bad word drops the whole file (validCapWords)', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A }));
    store.db.prepare("UPDATE nodes SET caps = 'BAD_WORD', agentOps = 'also bad!' WHERE nodeId = ?").run(UUID_A);
    expect(store.node(UUID_A)).toMatchObject({ caps: [], agentOps: [] });
  });
});

describe('markUnreachable — written on the sweep it happens', () => {
  it('writes reachable = 0 with the FIRST since, and the next measurement clears both (§18 "unreachable is written on the sweep it happens")', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A }));
    expect(store.markUnreachable('fleet', 'fleet', T0 + 100)).toEqual({ ok: true, nodeId: UUID_A, created: false, since: T0 + 100 });
    expect(store.markUnreachable('fleet', 'fleet', T0 + 200)).toEqual({ ok: true, nodeId: UUID_A, created: false, since: T0 + 100 });
    // The measurement columns keep the last measured values: unreachable is not "never seen".
    expect(store.node(UUID_A)).toMatchObject({ reachable: false, unreachableSince: T0 + 100, measuredAt: T0, stampRead: 'ok' });
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A, measuredAt: T0 + 300 }));
    expect(store.node(UUID_A)).toMatchObject({ reachable: true, unreachableSince: null, measuredAt: T0 + 300 });
  });

  it('with no live row for the label, writes a never-measured placeholder keyed by the label — shown, never dropped', () => {
    const store = fresh();
    expect(store.markUnreachable('fleet', 'fleet', T0)).toEqual({ ok: true, nodeId: 'fleet', created: true, since: T0 });
    expect(store.node('fleet')).toMatchObject({ role: 'fleet', label: 'fleet', measuredAt: null, reachable: false,
      unreachableSince: T0, stampRead: 'unreadable', installState: 'unknown', provenance: 'unknown', os: 'unknown',
      caps: [], agentOps: [], updateState: 'idle' });
    expect(store.nodes().map((n) => n.nodeId)).toEqual(['fleet']);
  });

  it('refuses when a superseded row holds the label key and no live row carries the label', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas());                          // the label-keyed row
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A }));
    expect(store.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'superseded', retired: 0, revived: false });
    expect(store.rekeyNode('fleet', UUID_B)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: false });   // UUID_A retired
    expect(store.markUnreachable('fleet', 'fleet', T0 + 5))
      .toEqual({ ok: false, why: 'label-key-taken', supersededBy: UUID_A });
  });

  it('refuses with supersededBy: null when the label key is held by a LIVE row under another label', () => {
    const store = fresh();
    // A row whose nodeId happens to equal this label, but whose own label
    // (and connection) is a different one entirely — not this label's heir.
    store.db.prepare(
      "INSERT INTO nodes (nodeId, role, label, stampRead, installState, provenance, caps, floorRead, previousRead, os, reachable) " +
      "VALUES ('fleet', 'fleet', 'other-connection', 'ok', 'complete', 'verified', '', 'absent', 'absent', 'linux', 1)",
    ).run();
    expect(store.markUnreachable('fleet', 'fleet', T0))
      .toEqual({ ok: false, why: 'label-key-taken', supersededBy: null });
  });

  it("the placeholder's agentOps is null for a non-fleet role — no agent by construction — and '' only for fleet", () => {
    const store = fresh();
    expect(store.markUnreachable('server', 'both', T0)).toEqual({ ok: true, nodeId: 'server', created: true, since: T0 });
    expect(raw(store, 'server', 'agentOps')).toBeNull();
    expect(store.node('server')).toMatchObject({ role: 'both', label: 'server', agentOps: null });
  });
});

describe('rekeyNode — the identity group', () => {
  it('refuses anything but the lowercase uuid _inst_node_id mints', () => {
    const store = fresh();
    for (const bad of ['fleet', '', UUID_A.toUpperCase(), `${UUID_A}\n`, `${UUID_A}\r`, ` ${UUID_A}`]) {
      expect(store.rekeyNode('fleet', bad), JSON.stringify(bad)).toEqual({ ok: false, why: 'bad-node-id' });
    }
    expect(NODE_ID_RE.test(UUID_A)).toBe(true);
  });

  it('re-keys the label row in place, carrying its history and its refusals (§18 "a label row re-keys")', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ installState: 'unknown' }));   // a pre-W1 node: no node-id yet
    plantLease(store, 'fleet', 'failed', T0);
    plantRequest(store, 'fleet');
    expect(store.refuseRelease('fleet', 'v0.0.10', T0 + 1, 'provenance: x')).toEqual({ ok: true, inserted: true });
    expect(store.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'rekeyed', retired: 0, revived: false });
    expect(store.node('fleet')).toBeNull();
    expect(store.node(UUID_A)).toMatchObject({ label: 'fleet', measuredAt: T0, updateState: 'failed',
      updateTarget: 'v0.0.10', requestedTag: 'v0.0.10', supersededBy: null });
    expect(store.refusalsFor(UUID_A).map((r) => r.tag)).toEqual(['v0.0.10']);
    expect(store.refusalsFor('fleet')).toEqual([]);
    expect(store.nodes().map((n) => n.nodeId)).toEqual([UUID_A]);   // one node, not two
    // The next sweep's re-key finds no label row and changes nothing.
    expect(store.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 0, revived: false });
  });

  it('with a uuid row already present the label row is superseded, and every reader but node() excludes it (§18 "a superseded row is invisible")', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ measuredAt: T0 }));
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A, measuredAt: T0 + 10 }));
    expect(store.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'superseded', retired: 0, revived: false });
    expect(store.node('fleet')!.supersededBy).toBe(UUID_A);
    expect(store.nodes().map((n) => n.nodeId)).toEqual([UUID_A]);
    expect(store.nodeByLabel('fleet')!.nodeId).toBe(UUID_A);
    const sup = { ok: false, why: 'superseded', supersededBy: UUID_A };
    expect(store.upsertNodeMeasurement(meas())).toEqual(sup);
    expect(store.releaseLease('fleet', 'failed', 'x', null)).toEqual(sup);
    expect(store.settleNode('fleet', 'x', null)).toEqual(sup);
    expect(store.resolveNode('fleet', { channel: 'stable', desiredTag: null, resolveDetail: 'x' })).toEqual(sup);
    expect(store.ackNode('fleet')).toEqual(sup);
  });

  it('a box re-installed under a NEW node-id retires its old identity on the same connection (D-3193)', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null }));
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A }));
    expect(store.rekeyNode('fleet', UUID_B)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: false });
    expect(store.node(UUID_A)!.supersededBy).toBe(UUID_B);
    expect(store.upsertNodeMeasurement(meas({ nodeId: UUID_B }))).toEqual({ ok: true, created: true });
    expect(store.nodes().map((n) => n.nodeId)).toEqual([UUID_B, UUID_S]);
    // Both fleet rows carry measuredAt T0, so only the superseded filter keeps
    // the retired identity (the lower id) from answering for the label.
    expect(store.nodeByLabel('fleet')!.nodeId).toBe(UUID_B);
    expect(store.node(UUID_S)!.supersededBy).toBeNull();   // another connection's row is not this label's
  });

  it('a node-id that returns after it was retired is revived, never a cycle (D-3208)', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas());                                     // the label-keyed row
    expect(store.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'rekeyed', retired: 0, revived: false });
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A }));
    // A is re-installed under B: A is retired.
    expect(store.rekeyNode('fleet', UUID_B)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: false });
    store.upsertNodeMeasurement(meas({ nodeId: UUID_B }));
    // A's ~/.ccrc is restored from a snapshot and reconnects: A must be
    // revived, not left superseded by B while B is superseded by A.
    expect(store.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });
    expect(store.upsertNodeMeasurement(meas({ nodeId: UUID_A }))).toEqual({ ok: true, created: false });
    expect(store.node(UUID_A)!.supersededBy).toBeNull();
    expect(store.node(UUID_B)!.supersededBy).toBe(UUID_A);
    expect(store.nodes().map((n) => n.nodeId)).toEqual([UUID_A]);
  });
});

// D-3412 (fix round 1, item 5; review F7) — the lease follows the label: one box, one lease. A revive puts a
// frozen row back among the live ones, so its lease columns are as they were the day it was retired — while the
// box's real run, and the fleet's one lease, may have moved on. Every row below acquires through the real
// `dispatchNode`, never a planted lease, and each case names the rows that are busy afterwards.
describe('rekeyNode — the lease follows the label (D-3412)', () => {
  const T1 = T0 + 1000;
  const T2 = T0 + 2000;
  const T3 = T0 + 3000;
  /** The fleet box (label `fleet`, id A) and the server box (label `server`), both measured, A requested. */
  const boxes = (): CoordStore => {
    const s = fresh();
    expect(s.upsertNodeMeasurement(meas({ nodeId: UUID_A })).ok).toBe(true);
    expect(s.upsertNodeMeasurement(meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null })).ok).toBe(true);
    expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0).ok).toBe(true);
    return s;
  };
  /** The live rows that hold a lease (busy = NOT settled — W2's stance), by node id. */
  const busy = (s: CoordStore): string[] => s.nodes().filter((n) => !['idle', 'failed', 'reverted'].includes(n.updateState)).map((n) => n.nodeId);
  /** The box's node-id flips: A retired by B (B has no row yet, so A is superseded toward it), and B measured in. */
  const flipToB = (s: CoordStore): void => {
    expect(s.rekeyNode('fleet', UUID_B)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: false });
    expect(s.upsertNodeMeasurement(meas({ nodeId: UUID_B })).ok).toBe(true);
  };

  it("the reviewer's five steps (F7): a revived pending row never sits beside another node's lease — two live busy rows never exist", () => {
    const s = boxes();
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T1, 'dispatched')).toEqual({ ok: true });   // 1. U1 acquires
    flipToB(s);                                                                                       // 2. U2 supersedes U1 while pending
    expect(busy(s)).toEqual([]);
    expect(s.dispatchNode(UUID_S, 'v0.0.10', 'update', T2, 'server move')).toEqual({ ok: true });    // 3. the server row acquires
    expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });   // 4. U1 revives
    expect(busy(s), '5. one live busy row, never two').toEqual([UUID_S]);
    // The revived row is released idle with its request standing, and its detail names the rekey.
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'idle', requestedTag: 'v0.0.10', requestedKind: 'update', supersededBy: null });
    expect(s.node(UUID_A)!.updateDetail).toMatch(/rekey/);
    expect(s.node(UUID_S)).toMatchObject({ updateState: 'pending', updateStartedAt: T2 });
  });

  it('U1 -> U2 (busy) -> U1, U1 frozen IDLE: the lease U2 held is handed to U1, exactly one live busy row, U2 retired (the run is the box\'s, never dropped)', () => {
    const s = boxes();
    flipToB(s);                                                                                       // A retired while idle
    expect(s.requestNode(UUID_B, 'v0.0.10', 'update', T0).ok).toBe(true);
    expect(s.dispatchNode(UUID_B, 'v0.0.10', 'update', T2, 'the fleet move')).toEqual({ ok: true });
    expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });
    expect(busy(s)).toEqual([UUID_A]);
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10', updateStartedAt: T2,
      updateDetail: 'the fleet move', requestedTag: 'v0.0.10', supersededBy: null });   // A's OWN request stands beside it
    expect(s.node(UUID_B)!.supersededBy).toBe(UUID_A);
  });

  it('U1 -> U2 (busy) -> U1, U1 frozen PENDING with its own older lease: the retired row\'s lease replaces it — the lease that is live is the box\'s real run', () => {
    const s = boxes();
    expect(s.dispatchNode(UUID_A, 'v0.0.9', 'update', T1, 'the old run')).toEqual({ ok: true });
    flipToB(s);
    expect(s.dispatchNode(UUID_B, 'v0.0.10', 'update', T3, 'the real run')).toEqual({ ok: true });
    expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });
    expect(busy(s)).toEqual([UUID_A]);
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10', updateStartedAt: T3, updateDetail: 'the real run' });
  });

  it('with two busy same-label rows retired at once (a planted, invariant-breaking fixture) the NEWEST lease is the one handed on', () => {
    const s = boxes();
    const UUID_C = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';
    flipToB(s);
    expect(s.upsertNodeMeasurement(meas({ nodeId: UUID_C })).ok).toBe(true);
    plantLease(s, UUID_B, 'pending', T2, 'v0.0.9');
    plantLease(s, UUID_C, 'pending', T3, 'v0.0.10');
    expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 2, revived: true });
    expect(busy(s)).toEqual([UUID_A]);
    expect(s.node(UUID_A)).toMatchObject({ updateStartedAt: T3, updateTarget: 'v0.0.10' });
  });

  it('the donor is a row of THIS label: a newer lease on another box\'s row is never the one handed on (planted, invariant-breaking fixture)', () => {
    const s = boxes();
    flipToB(s);
    plantLease(s, UUID_B, 'pending', T2, 'v0.0.9');
    plantLease(s, UUID_S, 'pending', T3, 'v0.0.10');
    expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'pending', updateStartedAt: T2, updateTarget: 'v0.0.9' });
    expect(s.node(UUID_S)).toMatchObject({ updateState: 'pending', updateStartedAt: T3 });
  });

  it('a busy row revived with no other lease anywhere keeps its own lease, byte for byte — an idle server row is not a lease', () => {
    const s = boxes();
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T1, 'dispatched')).toEqual({ ok: true });
    const before = s.node(UUID_A)!;
    flipToB(s);
    expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });
    expect(busy(s)).toEqual([UUID_A]);
    expect(s.node(UUID_A)).toEqual(before);
  });

  it('a `failed` row superseded and then revived still reads failed, with its detail and request, and still halts (a verdict is never dropped)', () => {
    const s = boxes();
    plantLease(s, UUID_A, 'failed', T1);
    s.db.prepare('UPDATE nodes SET updateDetail = ? WHERE nodeId = ?').run('the installer died', UUID_A);
    const before = s.node(UUID_A)!;
    flipToB(s);
    expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });
    expect(s.node(UUID_A)).toEqual(before);
    expect(isHalting(s.node(UUID_A)!)).toBe(true);
    expect(fleetGate(s.nodes()).haltedBy).toEqual([UUID_A]);
  });

  it('a halted row keeps its verdict even when a lease is held beside it: not released for a busy server row, and not written over by a retired row\'s lease', () => {
    for (const settled of ['failed', 'reverted'] as const) {
      // Beside a busy server row.
      const s = boxes();
      plantLease(s, UUID_A, settled, T1);
      flipToB(s);
      expect(s.dispatchNode(UUID_S, 'v0.0.10', 'update', T2, 'server move')).toEqual({ ok: true });
      expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });
      expect(s.node(UUID_A), settled).toMatchObject({ updateState: settled, updateDetail: 'planted', updateStartedAt: T1 });
      expect(busy(s), settled).toEqual([UUID_S]);
      // Beside a busy row it retires: the verdict wins, and the halt stops every other move.
      const t = boxes();
      plantLease(t, UUID_A, settled, T1);
      flipToB(t);
      expect(t.dispatchNode(UUID_B, 'v0.0.10', 'update', T2, 'the run')).toEqual({ ok: true });
      expect(t.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });
      expect(t.node(UUID_A), settled).toMatchObject({ updateState: settled, updateDetail: 'planted', updateStartedAt: T1 });
      expect(fleetGate(t.nodes()).haltedBy, settled).toEqual([UUID_A]);
    }
  });

  it('a revived `failed: provenance:` row does NOT halt (isHalting), so it receives the retired row\'s lease — the box\'s real run is never left unleased (I1, D-3412)', () => {
    const s = boxes();
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T1, 'dispatched')).toEqual({ ok: true });
    expect(s.releaseLease(UUID_A, 'failed', 'provenance: unsigned bundle', T1)).toEqual({ ok: true, state: 'failed' });
    flipToB(s);                                                                                       // A retired, B is the box's node
    expect(s.dispatchNode(UUID_B, 'v0.0.10', 'update', T2, 'the box\'s real run')).toEqual({ ok: true });
    expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });
    expect(busy(s), 'the revived row carries the run the box is doing').toEqual([UUID_A]);
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10', updateStartedAt: T2, updateDetail: 'the box\'s real run' });
    const gate = fleetGate(s.nodes());
    expect(gate.haltedBy).toEqual([]);
    expect(gate.leaseHeldBy, 'no dispatch may move beside that run').toBe(UUID_A);
  });

  it('the heir guard IS `isHalting`: over every settled state and a spread of details, a revived row is handed the lease exactly when it does not halt (I1)', () => {
    const details: (string | null)[] = [null, '', 'the installer died', 'provenance:', 'provenance: unsigned bundle', 'Provenance: x',
      'PROVENANCE: x', ' provenance: x', 'x provenance: y'];
    for (const state of ['idle', 'failed', 'reverted'] as const) {
      for (const detail of details) {
        const s = boxes();
        plantLease(s, UUID_A, state, T1);
        s.db.prepare('UPDATE nodes SET updateDetail = ? WHERE nodeId = ?').run(detail, UUID_A);
        flipToB(s);
        expect(s.dispatchNode(UUID_B, 'v0.0.10', 'update', T2, 'the run')).toEqual({ ok: true });
        const verdict = s.node(UUID_A)!;
        const halts = isHalting(verdict);
        expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });
        const label = `${state} / ${JSON.stringify(detail)}`;
        if (halts) {
          expect(s.node(UUID_A), label).toMatchObject({ updateState: state, updateDetail: detail, updateStartedAt: T1 });
          expect(fleetGate(s.nodes()).haltedBy, label).toEqual([UUID_A]);
        } else {
          expect(s.node(UUID_A), label).toMatchObject({ updateState: 'pending', updateStartedAt: T2, updateDetail: 'the run' });
          expect(busy(s), label).toEqual([UUID_A]);
        }
      }
    }
  });

  it('only a REVIVE moves a lease: an idempotent rekey of a live busy row beside another busy row (a planted, invariant-breaking fixture) releases nothing', () => {
    const s = boxes();
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T1, 'dispatched')).toEqual({ ok: true });
    plantLease(s, UUID_S, 'pending', T2);
    expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 0, revived: false });
    expect(busy(s)).toEqual([UUID_A, UUID_S]);
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'pending', updateStartedAt: T1, updateDetail: 'dispatched' });
  });

  it('a settled idle row revived beside no lease is unchanged, and a rekey that revives nothing hands nothing (a retired row\'s lease is W2\'s gap, not this writer\'s)', () => {
    const s = boxes();
    flipToB(s);
    const beforeA = { ...s.node(UUID_A)!, supersededBy: null };   // the revive clears the mark, and nothing else
    expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: true });
    expect(s.node(UUID_A)).toEqual(beforeA);
    // No revive: a live B holding a lease is retired by a rekey to a NEW id C — its lease is dropped, as W2 shipped it.
    const t = boxes();
    flipToB(t);
    expect(t.dispatchNode(UUID_B, 'v0.0.10', 'update', T2, 'the run')).toEqual({ ok: true });
    const UUID_C = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';
    expect(t.rekeyNode('fleet', UUID_C)).toEqual({ ok: true, how: 'no-label-row', retired: 1, revived: false });
    expect(busy(t)).toEqual([]);
  });
});

describe('handOffLease — the lease group\'s hand-off writer (D-3412)', () => {
  const T1 = T0 + 1000;
  /** A (the heir, label fleet, idle), B (label fleet, busy, superseded toward A — what a rekey to A leaves), S (server). */
  const heirAndDonor = (): CoordStore => {
    const s = fresh();
    for (const m of [meas({ nodeId: UUID_A }), meas({ nodeId: UUID_B }),
      meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null })]) expect(s.upsertNodeMeasurement(m).ok).toBe(true);
    expect(s.dispatchNode(UUID_B, 'v0.0.10', 'update', T1, 'the run')).toEqual({ ok: true });
    s.db.prepare('UPDATE nodes SET supersededBy = ? WHERE nodeId = ?').run(UUID_A, UUID_B);
    return s;
  };
  const writes = (s: CoordStore): number => (s.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  const neverVoid: [ReturnType<CoordStore['handOffLease']>] extends [void] ? never : true = true;

  it('copies the four lease columns from the retired row to the heir and writes nothing else (the request group is not the lease\'s)', () => {
    expect(neverVoid).toBe(true);
    const s = heirAndDonor();
    expect(s.requestNode(UUID_A, 'v0.0.9', 'update', T0 + 7).ok).toBe(true);
    const before = s.node(UUID_A)!;
    expect(s.handOffLease(UUID_B, UUID_A)).toEqual({ ok: true });
    expect(s.node(UUID_A)).toEqual({ ...before, updateState: 'pending', updateTarget: 'v0.0.10', updateStartedAt: T1, updateDetail: 'the run' });
    expect(s.node(UUID_B)).toMatchObject({ updateState: 'pending', supersededBy: UUID_A });   // the donor row is left as it was
  });

  it('a busy heir\'s own lease is replaced; a halted heir is refused with its state, and nothing is written', () => {
    const s = heirAndDonor();
    plantLease(s, UUID_A, 'applying', T0 + 1, 'v0.0.9');
    expect(s.handOffLease(UUID_B, UUID_A)).toEqual({ ok: true });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10', updateStartedAt: T1 });
    for (const state of ['failed', 'reverted'] as const) {
      const t = heirAndDonor();
      plantLease(t, UUID_A, state, T0 + 1);
      const n = writes(t);
      expect(t.handOffLease(UUID_B, UUID_A), state).toEqual({ ok: false, why: 'halted', state });
      expect(writes(t), state).toBe(n);
    }
  });

  it('the heir guard refuses a row that HALTS and only that: `failed: provenance:` is not one (isHalting), a `reverted` row with the same detail is', () => {
    const s = heirAndDonor();
    plantLease(s, UUID_A, 'failed', T0 + 1);
    s.db.prepare('UPDATE nodes SET updateDetail = ? WHERE nodeId = ?').run('provenance: unsigned bundle', UUID_A);
    expect(s.handOffLease(UUID_B, UUID_A)).toEqual({ ok: true });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'pending', updateStartedAt: T1, updateDetail: 'the run' });
    const t = heirAndDonor();
    plantLease(t, UUID_A, 'failed', T0 + 1);
    t.db.prepare('UPDATE nodes SET updateDetail = ? WHERE nodeId = ?').run('the installer died', UUID_A);
    const n = writes(t);
    expect(t.handOffLease(UUID_B, UUID_A)).toEqual({ ok: false, why: 'halted', state: 'failed' });
    expect(writes(t)).toBe(n);
    const u = heirAndDonor();
    plantLease(u, UUID_A, 'reverted', T0 + 1);
    u.db.prepare('UPDATE nodes SET updateDetail = ? WHERE nodeId = ?').run('provenance: unsigned bundle', UUID_A);
    expect(u.handOffLease(UUID_B, UUID_A)).toEqual({ ok: false, why: 'halted', state: 'reverted' });
    // The read-back names `halted` by the same notion: a non-halting heir refused for another reason is not called halted.
    const v = heirAndDonor();
    plantLease(v, UUID_A, 'failed', T0 + 1);
    v.db.prepare('UPDATE nodes SET updateDetail = ? WHERE nodeId = ?').run('provenance: unsigned bundle', UUID_A);
    v.db.prepare('UPDATE nodes SET supersededBy = NULL WHERE nodeId = ?').run(UUID_B);
    expect(v.handOffLease(UUID_B, UUID_A)).toEqual({ ok: false, why: 'no-lease-to-hand' });
  });

  it('refuses every other shape, each writing nothing: an unknown or superseded heir, and a donor that is not a busy same-label row this heir replaced', () => {
    const s = heirAndDonor();
    const n = writes(s);
    expect(s.handOffLease(UUID_B, '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c')).toEqual({ ok: false, why: 'unknown-node' });
    expect(s.handOffLease(UUID_A, UUID_B)).toEqual({ ok: false, why: 'superseded', supersededBy: UUID_A });
    expect(s.handOffLease(UUID_S, UUID_A)).toEqual({ ok: false, why: 'no-lease-to-hand' });   // live, another label, idle
    expect(s.handOffLease('0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', UUID_A)).toEqual({ ok: false, why: 'no-lease-to-hand' });   // absent donor
    expect(writes(s)).toBe(n);
    // A superseded heir is refused even when the donor WAS retired toward it: the heir is the live row or nothing.
    const gone = heirAndDonor();
    gone.db.prepare('UPDATE nodes SET supersededBy = ? WHERE nodeId = ?').run(UUID_S, UUID_A);
    const m = writes(gone);
    expect(gone.handOffLease(UUID_B, UUID_A)).toEqual({ ok: false, why: 'superseded', supersededBy: UUID_S });
    expect(writes(gone)).toBe(m);
    // A busy donor that is still LIVE (nothing retired it) is not handed over: only a row retired toward the heir is.
    const live = heirAndDonor();
    live.db.prepare('UPDATE nodes SET supersededBy = NULL WHERE nodeId = ?').run(UUID_B);
    expect(live.handOffLease(UUID_B, UUID_A)).toEqual({ ok: false, why: 'no-lease-to-hand' });
    // Retired toward somebody else.
    const other = heirAndDonor();
    other.db.prepare('UPDATE nodes SET supersededBy = ? WHERE nodeId = ?').run(UUID_S, UUID_B);
    expect(other.handOffLease(UUID_B, UUID_A)).toEqual({ ok: false, why: 'no-lease-to-hand' });
    // A settled donor holds nothing to hand.
    const settled = heirAndDonor();
    plantLease(settled, UUID_B, 'idle', T1);
    expect(settled.handOffLease(UUID_B, UUID_A)).toEqual({ ok: false, why: 'no-lease-to-hand' });
    // A donor of another LABEL is another box's lease: one box, one lease.
    const label = heirAndDonor();
    label.db.prepare("UPDATE nodes SET label = 'server' WHERE nodeId = ?").run(UUID_B);
    expect(label.handOffLease(UUID_B, UUID_A)).toEqual({ ok: false, why: 'no-lease-to-hand' });
    expect(label.node(UUID_A)).toMatchObject({ updateState: 'idle', updateStartedAt: null });
  });
});

describe('the lease group — releaseLease, settleNode, ackNode', () => {
  it('releaseLease moves a busy lease to the named settled state and leaves the request standing (§18 "a refusal does not consume the request")', () => {
    const s = leased('applying', T0);
    plantRequest(s, UUID_A);
    expect(s.releaseLease(UUID_A, 'idle', 'disconnected during dispatch', null)).toEqual({ ok: true, state: 'idle' });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'idle', updateDetail: 'disconnected during dispatch',
      updateTarget: 'v0.0.10', updateStartedAt: T0, requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: T0 });
  });

  it('counts pending, applying, unknown AND a token this build cannot name as busy (§18 "unknown is busy")', () => {
    for (const state of ['pending', 'applying', 'unknown', 'paused']) {
      expect(leased(state, T0).releaseLease(UUID_A, 'failed', 'deadline', null), state)
        .toEqual({ ok: true, state: 'failed' });
    }
  });

  it('releaseLease refuses a settled row as not-busy, and an absent one as unknown-node, writing nothing', () => {
    for (const state of ['idle', 'failed', 'reverted'] as const) {
      const s = leased(state, T0);
      expect(s.releaseLease(UUID_A, 'failed', 'x', null), state).toEqual({ ok: false, why: 'not-busy', state });
      expect(s.node(UUID_A)!.updateDetail).toBe('planted');
    }
    expect(fresh().releaseLease(UUID_A, 'failed', 'x', null)).toEqual({ ok: false, why: 'unknown-node' });
  });

  it('an expected lease that no longer matches the row\'s own current one is refused, EITHER side of it — identity, not clock order (W4 review 155, C33); NULL on either side is no precedence (§18 "a stale report never moves the lease")', () => {
    const s = leased('applying', T0 + 5000);
    // An expected `updateStartedAt` earlier than the row's own current lease is refused...
    expect(s.releaseLease(UUID_A, 'failed', 'stamp-mismatch', T0 + 4000))
      .toEqual({ ok: false, why: 'stale-report', updateStartedAt: T0 + 5000 });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'applying', updateDetail: 'planted' });
    // ...and so, symmetrically, is one LATER than it — this is no longer a `>=` clock-order test (a node's
    // report can read on either side of the lease's dispatch instant, C33), so a later expectation is refused
    // exactly as an earlier one is: only the SAME lease the caller actually observed is ever moved.
    expect(s.releaseLease(UUID_A, 'failed', 'stamp-mismatch', T0 + 6000))
      .toEqual({ ok: false, why: 'stale-report', updateStartedAt: T0 + 5000 });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'applying', updateDetail: 'planted' });
    // The value the caller actually read off the SAME still-open lease does move it.
    expect(s.releaseLease(UUID_A, 'failed', 'stamp-mismatch', T0 + 5000)).toEqual({ ok: true, state: 'failed' });
    // Not report-driven (a refusal, a drop, the deadline): no precedence at all.
    expect(leased('applying', T0 + 5000).releaseLease(UUID_A, 'failed', 'deadline', null))
      .toEqual({ ok: true, state: 'failed' });
    // A lease with no recorded start cannot be predated.
    expect(leased('applying', null).releaseLease(UUID_A, 'reverted', 'x', T0)).toEqual({ ok: true, state: 'reverted' });
  });

  it('settleNode returns a busy or idle row to idle and clears the request — convergence', () => {
    const s = leased('applying', T0);
    plantRequest(s, UUID_A);
    expect(s.settleNode(UUID_A, 'converged at v0.0.10', T0)).toEqual({ ok: true, clearedRequest: true });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'idle', updateDetail: 'converged at v0.0.10',
      updateTarget: 'v0.0.10', requestedTag: null, requestedKind: null, requestedAt: null });
    expect(s.settleNode(UUID_A, 'converged at v0.0.10', null)).toEqual({ ok: true, clearedRequest: false });
  });

  it('settleNode refuses a halted row — failed and reverted wait for ack — and keeps its request', () => {
    for (const state of ['failed', 'reverted'] as const) {
      const s = leased(state, T0);
      plantRequest(s, UUID_A);
      expect(s.settleNode(UUID_A, 'x', null), state).toEqual({ ok: false, why: 'halted', state });
      expect(s.node(UUID_A)).toMatchObject({ updateState: state, requestedTag: 'v0.0.10' });
    }
    expect(fresh().settleNode(UUID_A, 'x', null)).toEqual({ ok: false, why: 'unknown-node' });
  });

  it('settleNode takes the same identity guard as releaseLease — an expected lease on either side of the row\'s own current one is refused (W4 review 155, C33)', () => {
    const s = leased('applying', T0 + 5000);
    plantRequest(s, UUID_A);
    expect(s.settleNode(UUID_A, 'converged', T0 + 4000))
      .toEqual({ ok: false, why: 'stale-report', updateStartedAt: T0 + 5000 });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'applying', requestedTag: 'v0.0.10' });
    expect(s.settleNode(UUID_A, 'converged', T0 + 6000))
      .toEqual({ ok: false, why: 'stale-report', updateStartedAt: T0 + 5000 });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'applying', requestedTag: 'v0.0.10' });
  });

  it('ackNode returns a failed row to idle and clears its request and THIS node\'s refusals only (§18 "ack clears the node\'s refusals and its request")', () => {
    const s = leased('failed', T0);
    s.upsertNodeMeasurement(meas({ nodeId: UUID_B, label: 'other' }));
    plantRequest(s, UUID_A);
    s.refuseRelease(UUID_A, 'v0.0.10', T0, 'provenance: x');
    s.refuseRelease(UUID_A, 'v0.0.11', T0, 'provenance: y');
    s.refuseRelease(UUID_B, 'v0.0.10', T0, 'provenance: z');
    expect(s.ackNode(UUID_A)).toEqual({ ok: true, clearedRequest: true, clearedRefusals: 2 });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'idle', updateTarget: 'v0.0.10', requestedTag: null,
      requestedKind: null, requestedAt: null });
    expect(s.refusalsFor(UUID_A)).toEqual([]);
    expect(s.refusalsFor(UUID_B)).toHaveLength(1);
    expect(s.ackNode(UUID_A)).toEqual({ ok: true, clearedRequest: false, clearedRefusals: 0 });
  });

  it('ackNode refuses a busy row — unknown and an unnamed token included — and writes nothing (D-3183)', () => {
    for (const [stored, read] of [['pending', 'pending'], ['applying', 'applying'], ['unknown', 'unknown'],
      ['paused', 'unknown']] as const) {
      const s = leased(stored, T0);
      plantRequest(s, UUID_A);
      s.refuseRelease(UUID_A, 'v0.0.10', T0, 'provenance: x');
      expect(s.ackNode(UUID_A), stored).toEqual({ ok: false, why: 'busy', state: read });
      expect(raw(s, UUID_A, 'updateState')).toBe(stored);
      expect(s.node(UUID_A)!.requestedTag).toBe('v0.0.10');
      expect(s.refusalsFor(UUID_A)).toHaveLength(1);
    }
    expect(fresh().ackNode(UUID_A)).toEqual({ ok: false, why: 'unknown-node' });
  });
});

describe('resolveNode — the resolved group', () => {
  it('writes the three resolved columns only and says whether they changed; NULL compares equal to NULL', () => {
    const s = leased('failed', T0);
    const r1 = { channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null } as const;
    expect(s.resolveNode(UUID_A, r1)).toEqual({ ok: true, changed: true });
    expect(s.resolveNode(UUID_A, r1)).toEqual({ ok: true, changed: false });
    const r2 = { channel: null, desiredTag: null, resolveDetail: 'the intent row names no channel this build knows' };
    expect(s.resolveNode(UUID_A, r2)).toEqual({ ok: true, changed: true });
    expect(s.resolveNode(UUID_A, r2)).toEqual({ ok: true, changed: false });
    expect(s.node(UUID_A)).toMatchObject({ ...r2, updateState: 'failed', updateDetail: 'planted', measuredAt: T0 });
    expect(fresh().resolveNode(UUID_A, r1)).toEqual({ ok: false, why: 'unknown-node' });
  });
});

describe('the readers', () => {
  it('nodes() is live rows by label then id; node() sees every row; nodeByLabel prefers the latest measurement', () => {
    const s = fresh();
    s.upsertNodeMeasurement(meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null }));
    s.upsertNodeMeasurement(meas({ nodeId: UUID_A, measuredAt: T0 }));
    s.upsertNodeMeasurement(meas({ nodeId: UUID_B, measuredAt: T0 + 10 }));   // two live rows labelled fleet, before any re-key
    expect(s.nodes().map((n) => n.nodeId)).toEqual([UUID_A, UUID_B, UUID_S]);
    expect(s.nodeByLabel('fleet')!.nodeId).toBe(UUID_B);
    expect(s.nodeByLabel('nobody')).toBeNull();
    expect(s.node('nobody')).toBeNull();
  });
});
