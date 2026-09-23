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

  it('a report older than the lease never moves it; NULL on either side is no precedence (§18 "a stale report never moves the lease")', () => {
    const s = leased('applying', T0 + 5000);
    expect(s.releaseLease(UUID_A, 'failed', 'stamp-mismatch', T0 + 4000))
      .toEqual({ ok: false, why: 'stale-report', updateStartedAt: T0 + 5000 });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'applying', updateDetail: 'planted' });
    // The same run's report — started at the lease's own instant — does move it.
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

  it('settleNode takes the same precedence as releaseLease', () => {
    const s = leased('applying', T0 + 5000);
    plantRequest(s, UUID_A);
    expect(s.settleNode(UUID_A, 'converged', T0 + 4000))
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
