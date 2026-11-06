// Delegation broker wave 5, PR8 (Task 5.8.1): the PURE decisions behind Retain and resolve (`delegation-lease-acts.ts`).
//
// Rows W5-R1 to W5-R8b of the plan's "## PR8", under O5-8 (c): a resolve acts on a lease only, a `tree-<key>` is resolved as the
// unreleased lease on that tree, and a tree with none refuses `tree-unleased`. W5-R3c reads a real `CoordStore` over a fixture
// database; every other row is pure. Fixture names only: `lane-a-demo`, `coord-a-demo`, `project-a`.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  decideOperatorRetain, decideResolve, decideRetain, isDelegationLeaseActsKebab, leaseCoordinatorOf, parseLeaseTarget,
} from '../src/coord/delegation-lease-acts.js';
import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
import { delegationTreeTarget } from '../src/coord/delegation-conflicts.js';
import { projectDelegation } from '../src/coord/delegation-projection.js';
import {
  emptyDelegationCheckpoint, formatDelegationInstant, parseDelegationInstant,
  type DelegationAttemptRow, type DelegationCheckpointV1, type DelegationLeaseCarrierRow, type DelegationLeaseRow,
} from '../src/coord/delegation-model.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { LEASE_DOOR_REFUSALS } from '../../shared/api.js';
import { leaseRow } from './delegationLeaseFixture.js';
import { mkTmp } from './tmpHelpers.js';

const lease = leaseRow({ parentId: 'lane-a-demo', parentIncarnation: 'inc-1', disposition: 'adopted', generation: 2,
  cleanupDueAt: '2026-11-17T12:00:00.000Z', carrierGenerationSeen: 2 });
const noCoordinator = null;
const ok = { conflicting: new Set<string>(), boxHolds: true, carrierRequired: true };
const carrierRow = (over: Partial<DelegationLeaseCarrierRow> = {}): DelegationLeaseCarrierRow => ({
  leaseId: lease.leaseId, transferringSince: null, transferRun: null, promotedRun: null, promotedSession: null, releaseReason: null,
  resolvedThrough: null, ...over,
});

describe('decideRetain', () => {
  it('W5-R1: the parent at its incarnation may retain an adopted lease', () => {
    expect(decideRetain({ lease, carrier: undefined, byId: 'lane-a-demo', byIncarnation: 'inc-1', coordinator: noCoordinator, ...ok }))
      .toEqual({ ok: true, reason: 'retain', expectGeneration: 2 });
  });
  it('W5-R2: another session, or the parent in a later incarnation, is not the lease parent', () => {
    expect(decideRetain({ lease, carrier: undefined, byId: 'lane-b-demo', byIncarnation: 'inc-9', coordinator: noCoordinator, ...ok }))
      .toMatchObject({ ok: false, refusal: 'not-lease-parent' });
    expect(decideRetain({ lease, carrier: undefined, byId: 'lane-a-demo', byIncarnation: 'inc-2', coordinator: noCoordinator, ...ok }))
      .toMatchObject({ ok: false, refusal: 'not-lease-parent' });
  });
  it('W5-R3 (O5-4 a): the coordinator that bound the worker parent may retain; another session named as nobody\'s coordinator may not', () => {
    expect(decideRetain({ lease, carrier: undefined, byId: 'coord-a-demo', byIncarnation: 'inc-c',
      coordinator: 'coord-a-demo', ...ok })).toMatchObject({ ok: true });
    expect(decideRetain({ lease, carrier: undefined, byId: 'coord-b-demo', byIncarnation: 'inc-c',
      coordinator: 'coord-a-demo', ...ok })).toMatchObject({ ok: false, refusal: 'not-lease-parent' });
  });
  it('W5-R4: a transferring or promoted lease refuses wrong-disposition; a released one lease-released; an unknown one lease-unknown', () => {
    const transferring = carrierRow({ transferringSince: '2026-11-10T12:00:00.000Z', transferRun: 4 });
    expect(decideRetain({ lease, carrier: transferring, byId: 'lane-a-demo', byIncarnation: 'inc-1', coordinator: noCoordinator, ...ok }))
      .toMatchObject({ ok: false, refusal: 'wrong-disposition' });
    expect(decideRetain({ lease: { ...lease, disposition: 'promoted' }, carrier: undefined, byId: 'lane-a-demo', byIncarnation: 'inc-1',
      coordinator: noCoordinator, ...ok })).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
    expect(decideRetain({ lease: { ...lease, releasedAt: '2026-11-11T00:00:00.000Z' }, carrier: undefined, byId: 'lane-a-demo',
      byIncarnation: 'inc-1', coordinator: noCoordinator, ...ok })).toMatchObject({ ok: false, refusal: 'lease-released' });
    expect(decideRetain({ lease: undefined, carrier: undefined, byId: 'lane-a-demo', byIncarnation: 'inc-1', coordinator: noCoordinator, ...ok }))
      .toMatchObject({ ok: false, refusal: 'lease-unknown' });
  });
  it('W5-R5: a target is a UUID or tree-<64 hex>, nothing else', () => {
    expect(parseLeaseTarget('0f8e6a8c-1b2d-4c3e-9f00-0123456789ab')).toEqual({ kind: 'lease', leaseId: '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab' });
    expect(parseLeaseTarget(`tree-${'a'.repeat(64)}`)).toEqual({ kind: 'tree', treeKey: 'a'.repeat(64) });
    for (const bad of ['12', 'tree-xyz', '../x', '0F8E6A8C-1B2D-4C3E-9F00-0123456789AB', `tree-${'A'.repeat(64)}`, `tree-${'a'.repeat(63)}`, '']) {
      expect(parseLeaseTarget(bad), bad).toBeNull();
    }
  });
  it('W5-R5b: a conflicting tree, a box without the rung, and a carrier not yet read back each refuse', () => {
    const key = delegationTreeKey(lease.project, lease.adminRecord);
    const base = { lease, carrier: undefined, byId: 'lane-a-demo', byIncarnation: 'inc-1', coordinator: noCoordinator, ...ok };
    expect(decideRetain({ ...base, conflicting: new Set([key]) })).toMatchObject({ ok: false, refusal: 'lease-conflicting' });
    // a set keyed by any other spelling of the tree (here its URL target) does not name it
    expect(decideRetain({ ...base, conflicting: new Set([delegationTreeTarget(lease.project, lease.adminRecord)]) })).toMatchObject({ ok: true });
    expect(decideRetain({ ...base, lease: { ...lease, disposition: 'ephemeral', cleanupDueAt: null }, boxHolds: false }))
      .toMatchObject({ ok: false, refusal: 'box-unsupported' });
    expect(decideRetain({ ...base, boxHolds: false }), 'an adopted lease: the hold already stands').toMatchObject({ ok: true });
    expect(decideRetain({ ...base, lease: { ...lease, carrierGenerationSeen: 1 } })).toMatchObject({ ok: false, refusal: 'carrier-behind' });
    expect(decideRetain({ ...base, lease: { ...lease, carrierGenerationSeen: 1 }, carrierRequired: false }), 'no carrier capability: no wait')
      .toMatchObject({ ok: true });
  });
});

describe('decideOperatorRetain', () => {
  it('the operator keeps an ephemeral, adopted or retained lease with Retain\'s checks and no claimant', () => {
    for (const disposition of ['ephemeral', 'adopted', 'retained'] as const) {
      expect(decideOperatorRetain({ lease: { ...lease, disposition }, carrier: undefined, ...ok }), disposition)
        .toEqual({ ok: true, reason: 'operator-retain', expectGeneration: 2 });
    }
    const key = delegationTreeKey(lease.project, lease.adminRecord);
    expect(decideOperatorRetain({ lease, carrier: undefined, ...ok, conflicting: new Set([key]) })).toMatchObject({ refusal: 'lease-conflicting' });
    expect(decideOperatorRetain({ lease: { ...lease, disposition: 'ephemeral' }, carrier: undefined, ...ok, boxHolds: false }))
      .toMatchObject({ refusal: 'box-unsupported' });
    expect(decideOperatorRetain({ lease: { ...lease, carrierGenerationSeen: 0 }, carrier: undefined, ...ok })).toMatchObject({ refusal: 'carrier-behind' });
    expect(decideOperatorRetain({ lease: undefined, carrier: undefined, ...ok })).toMatchObject({ refusal: 'lease-unknown' });
  });
});

// ── leaseCoordinatorOf: O5-4 (a)'s one claimant rule ────────────────────────────────────────────────────────────────────

const T0 = Date.parse('2026-11-01T00:00:00.000Z');
const atMin = (m: number): number => T0 + m * 60_000;
const stamp = (id: number, sessionId: string, claimedBy: string | null, openedMin: number, closedMin: number | null) =>
  ({ id, sessionId, claimedBy, openedAt: atMin(openedMin), closedAt: closedMin === null ? null : atMin(closedMin) });

describe('leaseCoordinatorOf', () => {
  const worker = leaseRow({ parentId: 'lane-a-demo', firstObservedAt: formatDelegationInstant(atMin(30)) });
  it('W5-R3b: a closed run still names its coordinator for an instant inside its interval; a later run does not; a coordinator lease names null; R9 agrees', () => {
    const closed = [stamp(1, 'lane-a-demo', 'coord-a-demo', 10, 40)];
    expect(leaseCoordinatorOf(worker, closed)).toBe('coord-a-demo');
    expect(leaseCoordinatorOf(worker, [stamp(2, 'lane-a-demo', 'coord-a-demo', 31, null)]), 'a run opened after the lease').toBeNull();
    expect(leaseCoordinatorOf(worker, [stamp(3, 'lane-b-demo', 'lane-a-demo', 10, null)]), 'the parent is a coordinator, no run names it').toBeNull();
    // one fixture, both functions: the frame's R9 nests the same lease under the same coordinator, via the worker
    const frame = projectDelegation({
      checkpoint: { activities: [], leases: [worker], attempts: [] },
      census: { measuredAt: atMin(50), projects: new Map([[worker.project, { delegation: [] }]]), incarnations: new Map() },
      absences: [], sessions: [{ id: 'coord-a-demo', status: 'idle' }, { id: 'lane-a-demo', status: 'idle' }], runs: closed,
    });
    expect(frame.leases.map((l) => [l.parentId, l.via])).toEqual([[leaseCoordinatorOf(worker, closed), 'lane-a-demo']]);
  });

  it('W5-R3c: fed delegationRunStampsNaming, the rule names the coordinator past 501 newer closed runs; fed delegationRunStamps() it answers null', () => {
    const store = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-lease-acts-'), 'coord.db')));
    let n = 0;
    const open = (claimedBy: string) => {
      const r = store.openRun({ program: `program-${n++}`, title: 'run-a', project: 'project-a', wave: 1, waveOf: 1, claimedBy });
      if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
      return r.id;
    };
    const mine = open('coord-a-demo');
    store.bindSession(mine, 'lane-a-demo');
    expect(store.advance(mine, 'failed', 'test-close').ok).toBe(true);
    store.db.prepare('UPDATE runs SET openedAt = ?, closedAt = ? WHERE id = ?').run(atMin(10), atMin(40), mine);
    for (let i = 0; i < 501; i++) {
      const other = open('coord-b-demo');
      store.bindSession(other, `lane-z${i}-demo`);
      expect(store.advance(other, 'failed', 'test-close').ok).toBe(true);
    }
    const naming = store.delegationRunStampsNaming('lane-a-demo');
    if (!naming.ok) throw new Error(naming.detail);
    expect(naming.runs.map((r) => r.id)).toEqual([mine]);
    expect(leaseCoordinatorOf(worker, naming.runs)).toBe('coord-a-demo');
    // CONTROL: the bounded read holds the open runs and the newest 500 closed ones, so the worker's run is outside it
    const bounded = store.delegationRunStamps();
    if (!bounded.ok) throw new Error(bounded.detail);
    expect(bounded.runs.some((r) => r.id === mine)).toBe(false);
    expect(leaseCoordinatorOf(worker, bounded.runs)).toBeNull();
    // all-or-failure, like its sibling
    store.db.exec('PRAGMA ignore_check_constraints = ON');
    store.db.prepare('UPDATE runs SET openedAt = 0 WHERE id = ?').run(mine);
    store.db.exec('PRAGMA ignore_check_constraints = OFF');
    expect(store.delegationRunStampsNaming('lane-a-demo')).toEqual({ ok: false, kind: 'run-unreadable', detail: 'openedAt is not a positive safe integer' });
  });
});

// ── decideResolve ───────────────────────────────────────────────────────────────────────────────────────────────────────

const ATTEMPT_AT = '2026-11-02T00:00:00.000Z';
const attempt = (over: Partial<DelegationAttemptRow> = {}): DelegationAttemptRow => ({
  attemptId: 'a'.repeat(64), parentId: 'lane-a-demo', parentIncarnation: 'inc-1', project: lease.project, adminRecord: lease.adminRecord,
  canonicalPath: lease.canonicalPath, attemptedAt: ATTEMPT_AT, rung: null, verdict: 'conflicting', evidenceJournalIds: [],
  detail: 'rungs-disagree', ...over,
});
const cpOf = (leases: DelegationLeaseRow[], attempts: DelegationAttemptRow[] = [], carriers: DelegationLeaseCarrierRow[] = []): DelegationCheckpointV1 => ({
  ...emptyDelegationCheckpoint(), leases, attempts, ...(carriers.length > 0 ? { leaseCarriers: carriers } : {}),
});
const live = (id: string) => (id === 'lane-a-demo' ? { incarnation: 'inc-1' } : null);
const raw = { ...lease, sourceKind: 'raw' as const, disposition: 'ephemeral' as const, cleanupDueAt: null };
const key = delegationTreeKey(lease.project, lease.adminRecord);
const resolveOf = (over: Partial<Parameters<typeof decideResolve>[0]> & { checkpoint: DelegationCheckpointV1 }) => decideResolve({
  target: { kind: 'lease', leaseId: lease.leaseId }, action: 'attach', parent: 'lane-a-demo', conflicting: new Set(), boxHolds: true,
  carrierRequired: true, liveParent: live, ...over,
});

describe('decideResolve', () => {
  it('W5-R6: attach of a raw lease to its own live parent moves it to retained; the box, another parent and a linked lease are checked', () => {
    expect(resolveOf({ checkpoint: cpOf([raw]) }))
      .toEqual({ ok: true, act: 'transition', leaseId: lease.leaseId, reason: 'attach', expectGeneration: 2, resolvesThrough: null });
    expect(resolveOf({ checkpoint: cpOf([raw]), boxHolds: false }), 'an ephemeral raw lease on a box that cannot hold it')
      .toMatchObject({ ok: false, refusal: 'box-unsupported' });
    expect(resolveOf({ checkpoint: cpOf([lease], [attempt()]), conflicting: new Set([key]), boxHolds: false }), 'an adopted conflicting lease')
      .toMatchObject({ ok: true, act: 'transition' });
    expect(resolveOf({ checkpoint: cpOf([raw]), parent: 'lane-b-demo' })).toMatchObject({ ok: false, refusal: 'not-lease-parent' });
    const linked = resolveOf({ checkpoint: cpOf([lease]) });
    expect(linked).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
    expect(!linked.ok && linked.detail).toMatch(/operator-retain/);
    expect(resolveOf({ checkpoint: cpOf([lease], [attempt()]), conflicting: new Set([key]) }), 'a conflicting agent lease to its own parent')
      .toEqual({ ok: true, act: 'transition', leaseId: lease.leaseId, reason: 'attach', expectGeneration: 2,
        resolvesThrough: { attemptedAt: ATTEMPT_AT, attemptId: 'a'.repeat(64) } });
  });

  it('W5-R6 (live parent): a parent with no live registry row or no measured incarnation refuses not-live-parent', () => {
    expect(resolveOf({ checkpoint: cpOf([raw]), liveParent: () => null })).toMatchObject({ ok: false, refusal: 'not-live-parent' });
    expect(resolveOf({ checkpoint: cpOf([raw]), parent: null })).toMatchObject({ ok: false, refusal: 'not-lease-parent' });
  });

  it('W5-R7: a tree-<key> holding an unreleased lease resolves as that lease; one with none refuses tree-unleased (O5-8 c)', () => {
    const target = { kind: 'tree' as const, treeKey: delegationTreeTarget(lease.project, lease.adminRecord) };
    expect(resolveOf({ checkpoint: cpOf([lease], [attempt()]), target, conflicting: new Set([key]) }))
      .toMatchObject({ ok: true, act: 'transition', leaseId: lease.leaseId });
    expect(resolveOf({ checkpoint: cpOf([lease], [attempt()]), target, action: 'foreign' })).toMatchObject({ ok: true, act: 'release', leaseId: lease.leaseId });
    const released = { ...lease, releasedAt: '2026-11-03T00:00:00.000Z' };
    expect(resolveOf({ checkpoint: cpOf([released], [attempt()]), target }), 'only a released lease on the tree').toMatchObject({ ok: false, refusal: 'tree-unleased' });
    expect(resolveOf({ checkpoint: cpOf([], [attempt()]), target }), 'an unowned tree with no lease').toMatchObject({ ok: false, refusal: 'tree-unleased' });
    expect(resolveOf({ checkpoint: cpOf([lease]), target: { kind: 'lease', leaseId: '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab' } }))
      .toMatchObject({ ok: false, refusal: 'lease-unknown' });
  });

  it('W5-R8: foreign of a lease releases it with the resolution mark (null with no unowned attempt); a transferring lease refuses', () => {
    expect(resolveOf({ checkpoint: cpOf([lease]), action: 'foreign', parent: null }))
      .toEqual({ ok: true, act: 'release', leaseId: lease.leaseId, expectGeneration: 2, resolvesThrough: null });
    const older = attempt({ attemptId: 'b'.repeat(64), attemptedAt: '2026-11-01T00:00:00.000Z' });
    expect(resolveOf({ checkpoint: cpOf([lease], [older, attempt()]), action: 'foreign', parent: null, boxHolds: false }), 'never gated on the box')
      .toMatchObject({ ok: true, act: 'release', resolvesThrough: { attemptedAt: ATTEMPT_AT, attemptId: 'a'.repeat(64) } });
    expect(resolveOf({ checkpoint: cpOf([lease], [], [carrierRow({ transferringSince: ATTEMPT_AT, transferRun: 4 })]), action: 'foreign', parent: null }))
      .toMatchObject({ ok: false, refusal: 'wrong-disposition' });
    expect(resolveOf({ checkpoint: cpOf([{ ...lease, releasedAt: ATTEMPT_AT }]), action: 'foreign', parent: null }))
      .toMatchObject({ ok: false, refusal: 'lease-released' });
  });

  it('W5-R8b: resolve is the one act a conflicting lease admits: attach and foreign both pass the conflict check', () => {
    const conflicting = new Set([key]);
    expect(resolveOf({ checkpoint: cpOf([lease], [attempt()]), conflicting })).toMatchObject({ ok: true, act: 'transition' });
    expect(resolveOf({ checkpoint: cpOf([lease], [attempt()]), conflicting, action: 'foreign' })).toMatchObject({ ok: true, act: 'release' });
    expect(decideRetain({ lease, carrier: undefined, byId: 'lane-a-demo', byIncarnation: 'inc-1', coordinator: null, ...ok, conflicting }))
      .toMatchObject({ ok: false, refusal: 'lease-conflicting' });
  });
});

describe('the words', () => {
  it('every lease door word has its status in shared/api.ts, and the kebab guard admits them', () => {
    for (const w of Object.keys(LEASE_DOOR_REFUSALS)) expect(isDelegationLeaseActsKebab(w), w).toBe(true);
    expect(isDelegationLeaseActsKebab('operator-retain')).toBe(true);
    expect(isDelegationLeaseActsKebab('stale-generation')).toBe(false);
    expect(parseDelegationInstant(lease.firstObservedAt)).toBeGreaterThan(0);
  });
});
