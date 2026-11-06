// Delegation broker wave 5, PR6 (Task 5.6.1): the L1 carrier planner and parser (`server/src/coord/delegation-carrier.ts`).
// Every row is pure: a checkpoint, the carriers the lane read back, and the lane's memory in; steps and health out.
import { describe, it, expect } from 'vitest';
import {
  DELEGATION_CARRIER_MARKS_PER_PASS, DELEGATION_CARRIER_REFUSAL_RETRY_PASSES, DELEGATION_CARRIER_REVERIFY_PER_PASS, carrierMarkArgs,
  carrierReadsOf, delegationCarrierCensusRow, parseDelegationCarrier, planCarrierSteps,
  type CarrierReadBack, type DelegationCarrierBody, type StandingMarkRefusal,
} from '../src/coord/delegation-carrier.js';
import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
import type { DelegationCheckpointV1, DelegationLeaseRow } from '../src/coord/delegation-model.js';
import { checkpointWithLease, leaseRow } from './delegationLeaseFixture.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const INC = '11111111-2222-4333-8444-555555555555';
const none = (): { refused: Map<string, StandingMarkRefusal>; censusRow: Map<string, string>; indexed: Set<string>; deferred: Set<string> } =>
  ({ refused: new Map(), censusRow: new Map(), indexed: new Set<string>(), deferred: new Set<string>() });
type PlanInput = Parameters<typeof planCarrierSteps>[0];
const plan = (checkpoint: DelegationCheckpointV1, over: Partial<PlanInput> = {}) =>
  planCarrierSteps({ checkpoint, readBack: new Map(), supported: true, lockSupported: true, nowMs: NOW, pass: 1, ...none(), ...over });

/** The carrier the box would hold for `lease` at its own generation, state and sequence (the verb's body, `markedAt` included). */
const bodyOf = (lease: DelegationLeaseRow, over: Partial<DelegationCarrierBody> = {}): DelegationCarrierBody => ({
  v: 1, leaseId: lease.leaseId, generation: lease.generation, state: lease.releasedAt !== null ? 'released' : lease.disposition,
  journalSeq: lease.currentJournalSequence, parentId: lease.parentId, parentIncarnation: lease.parentIncarnation, activityId: lease.activityId,
  source: lease.sourceKind, project: lease.project, adminRecord: lease.adminRecord, canonicalPath: lease.canonicalPath,
  fingerprint: 'f'.repeat(64), claudeBase: 'b'.repeat(40), branch: 'claude/wt-1', expiresAt: null, releaseReason: null,
  promotedRun: null, promotedSession: null, markedAt: NOW, ...over,
});
const carrier = (body: DelegationCarrierBody): CarrierReadBack => ({ kind: 'carrier', body });
/** A checkpoint of `n` leases built by `make(i)`, each with its own id, record and creating sequence (the planner's "oldest" order). */
const many = (n: number, make: (i: number) => Partial<DelegationLeaseRow>): DelegationCheckpointV1 => {
  const leases = Array.from({ length: n }, (_, i) => leaseRow({
    leaseId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, adminRecord: `wt-${i}`, canonicalPath: `/work/project-a/.claude/worktrees/wt-${i}`,
    creatingJournalSequence: 10 + i, currentJournalSequence: 10 + i, ...make(i),
  }));
  return { ...checkpointWithLease(), leases, lineage: [], appliedJournalSequence: 100 };
};

describe('planCarrierSteps', () => {
  it('W5-K1: a generation-0 lease is minted, raw included', () => {
    for (const sourceKind of ['agent', 'raw'] as const) {
      const cp = checkpointWithLease({ generation: 0, sourceKind });
      expect(plan(cp).steps).toEqual([{ kind: 'mint', leaseId: cp.leases[0]!.leaseId, expectGeneration: 0 }]);
    }
  });

  it('W5-K2: an unsupported box gets no step and counts unsupported', () => {
    const cp = checkpointWithLease({ generation: 0 });
    const r = plan(cp, { supported: false });
    expect(r.steps).toEqual([]);
    expect(r.health.unsupported).toBe(1);
    const behind = checkpointWithLease({ generation: 1, carrierGenerationSeen: null });
    const b = plan(behind, { supported: false, readBack: new Map([[behind.leases[0]!.leaseId, { kind: 'absent' }]]) });
    expect(b.steps).toEqual([]);
    expect(b.health).toMatchObject({ unsupported: 1, marked: 0, pending: 0 });
    // review 1546 F13: every lease the planner would step on but cannot counts, a released one included
    const gone = checkpointWithLease({ generation: 2, carrierGenerationSeen: 1, releasedAt: '2026-11-10T00:00:00.000Z' });
    expect(plan(gone, { supported: false }).health).toMatchObject({ unsupported: 1 });
  });

  it('W5-K3: a carrier behind the journal is re-marked at the journal generation; an equal one is seen', () => {
    const cp = checkpointWithLease({ generation: 2, disposition: 'adopted', cleanupDueAt: '2026-11-17T12:00:00.000Z', carrierGenerationSeen: 1 });
    const id = cp.leases[0]!.leaseId;
    const behind = plan(cp, { readBack: new Map([[id, { kind: 'carrier', body: { generation: 1 } as never }]]) });
    expect(behind.steps).toMatchObject([{ kind: 'mark', args: { leaseId: id, generation: 2, state: 'adopted', expiresAtMs: Date.parse('2026-11-17T12:00:00.000Z') } }]);
    const equal = plan(cp, { readBack: new Map([[id, carrier(bodyOf(cp.leases[0]!))]]) });
    expect(equal.steps).toEqual([{ kind: 'seen', leaseId: id, generation: 2 }]);
  });

  it('W5-K3b: a carrier two generations behind is marked once at the journal generation', () => {
    const cp = checkpointWithLease({ generation: 3, disposition: 'retained', cleanupDueAt: '2026-11-17T12:00:00.000Z', carrierGenerationSeen: 1 });
    const id = cp.leases[0]!.leaseId;
    const r = plan(cp, { readBack: new Map([[id, { kind: 'carrier', body: { generation: 1 } as never }]]) });
    expect(r.steps).toMatchObject([{ kind: 'mark', args: { leaseId: id, generation: 3, state: 'retained' } }]);
    expect(r.health.mismatched).toBe(0);
  });

  it('W5-K4: an equal carrier is seen once; seen equal gets nothing, and the pass after the seen counts no mismatch', () => {
    const cp = checkpointWithLease({ generation: 1, currentJournalSequence: 9, carrierGenerationSeen: null });
    const lease = cp.leases[0]!;
    const rb = new Map([[lease.leaseId, carrier(bodyOf(lease))]]);
    expect(plan(cp, { readBack: rb }).steps).toEqual([{ kind: 'seen', leaseId: lease.leaseId, generation: 1 }]);
    // the second pass, after the seen applied through PR5b's door, is `delegation-carrier-lane.test.ts`'s W5-K4 (review 1546 F5)
  });

  it('W5-K5: a carrier ahead of the journal, or naming a sequence the checkpoint does not hold, is mismatched and never marked', () => {
    const cp = checkpointWithLease({ generation: 1, currentJournalSequence: 9 });
    const lease = cp.leases[0]!;
    for (const body of [bodyOf(lease, { generation: 2 }), bodyOf(lease, { journalSeq: 8 }), bodyOf(lease, { parentId: 'lane-b-demo' }),
      bodyOf(lease, { state: 'adopted' })]) {
      const r = plan(cp, { readBack: new Map([[lease.leaseId, carrier(body)]]) });
      expect(r.steps).toEqual([]);
      expect(r.health.mismatched).toBe(1);
    }
  });

  it('W5-K6: an unreadable or malformed carrier is unmeasured, and gets no step', () => {
    const cp = checkpointWithLease({ generation: 1 });
    const id = cp.leases[0]!.leaseId;
    for (const rb of [{ kind: 'unreadable', detail: 'EACCES' }, { kind: 'malformed', detail: 'not JSON' }] as const) {
      const r = plan(cp, { readBack: new Map([[id, rb]]) });
      expect(r.steps).toEqual([]);
      expect(r.health.unmeasured).toBe(1);
    }
  });

  it('W5-K7: twelve leases at generation 0 give eight mints, oldest first, and four pending', () => {
    const cp = many(12, () => ({ generation: 0 }));
    const r = plan(cp);
    expect(DELEGATION_CARRIER_MARKS_PER_PASS).toBe(8);
    expect(r.steps.map((s) => s.kind === 'mint' ? s.leaseId : '')).toEqual(cp.leases.slice(0, 8).map((l) => l.leaseId));
    expect(r.health.pending).toBe(4);
  });

  it('W5-K7b: nine released leases with no carrier take no step and count nothing; the new lease is minted, then marked', () => {
    const old = many(9, () => ({ generation: 1, releasedAt: '2026-11-09T00:00:00.000Z' }));
    const fresh = leaseRow({ leaseId: 'ffffffff-0000-4000-8000-000000000001', adminRecord: 'wt-new', canonicalPath: '/work/project-a/.claude/worktrees/wt-new',
      creatingJournalSequence: 90, currentJournalSequence: 90, generation: 0 });
    const cp: DelegationCheckpointV1 = { ...old, leases: [...old.leases, fresh] };
    const absent = new Map<string, CarrierReadBack>(old.leases.map((l) => [l.leaseId, { kind: 'absent' }]));
    const first = plan(cp, { readBack: absent });
    expect(first.steps).toEqual([{ kind: 'mint', leaseId: fresh.leaseId, expectGeneration: 0 }]);
    expect(first.health).toMatchObject({ pending: 0, refused: 0, unmeasured: 0 });
    const minted: DelegationCheckpointV1 = { ...cp, leases: [...old.leases, { ...fresh, generation: 1, currentJournalSequence: 91 }] };
    const second = plan(minted, { readBack: new Map([...absent, [fresh.leaseId, { kind: 'absent' }]]) });
    expect(second.steps).toMatchObject([{ kind: 'mark', args: { leaseId: fresh.leaseId, generation: 1, state: 'ephemeral', journalSeq: 91 } }]);
  });

  it('W5-K7c: standing refusals take no budget until their tree or generation changes', () => {
    const locked = many(9, () => ({ generation: 1 }));
    const fresh = leaseRow({ leaseId: 'ffffffff-0000-4000-8000-000000000001', adminRecord: 'wt-new', canonicalPath: '/work/project-a/.claude/worktrees/wt-new',
      creatingJournalSequence: 90, currentJournalSequence: 90, generation: 0 });
    const cp: DelegationCheckpointV1 = { ...locked, leases: [...locked.leases, fresh] };
    const absent = new Map<string, CarrierReadBack>(locked.leases.map((l) => [l.leaseId, { kind: 'absent' }]));
    const censusRow = new Map(locked.leases.map((l) => [delegationTreeKey(l.project, l.adminRecord), 'row-locked']));
    const refused = new Map<string, StandingMarkRefusal>(locked.leases.map((l) => [l.leaseId, { generation: 1, censusRow: 'row-locked', word: 'locked', pass: 1 }]));
    const first = plan(cp, { readBack: absent, censusRow, refused });
    expect(first.steps).toEqual([{ kind: 'mint', leaseId: fresh.leaseId, expectGeneration: 0 }]);
    expect(first.health.refused).toBe(9);
    const minted: DelegationCheckpointV1 = { ...cp, leases: [...locked.leases, { ...fresh, generation: 1 }] };
    const second = plan(minted, { readBack: new Map([...absent, [fresh.leaseId, { kind: 'absent' }]]), censusRow, refused });
    expect(second.steps).toMatchObject([{ kind: 'mark', args: { leaseId: fresh.leaseId } }]);
    expect(second.health.refused).toBe(9);
    // the lock removed: the census row changes, and the nine are composed again, oldest first, within the budget
    const unlocked = new Map(locked.leases.map((l) => [delegationTreeKey(l.project, l.adminRecord), 'row-free']));
    const third = plan(cp, { readBack: absent, censusRow: unlocked, refused });
    expect(third.steps.filter((s) => s.kind === 'mark').map((s) => s.kind === 'mark' ? s.args.leaseId : ''))
      .toEqual(locked.leases.slice(0, 8).map((l) => l.leaseId));
    expect(third.steps).toHaveLength(8);                          // the ninth and the (newer) mint wait for the next pass
    expect(third.health).toMatchObject({ refused: 0, pending: 2 });
    // a new generation is composed again too
    const bumped: DelegationCheckpointV1 = { ...cp, leases: [{ ...locked.leases[0]!, generation: 2 }, ...locked.leases.slice(1), fresh] };
    const fourth = plan(bumped, { readBack: absent, censusRow, refused });
    expect(fourth.steps).toMatchObject([{ kind: 'mark', args: { leaseId: locked.leases[0]!.leaseId, generation: 2 } }, { kind: 'mint' }]);
  });

  it('W5-K8: a released lease whose carrier reads adopted is marked released with its reason; one with no carrier is not', () => {
    const cp = checkpointWithLease({ generation: 3, disposition: 'adopted', cleanupDueAt: '2026-11-17T12:00:00.000Z', releasedAt: '2026-11-10T00:00:00.000Z' },
      { leaseCarriers: [{ leaseId: leaseRow().leaseId, transferringSince: null, transferRun: null, promotedRun: null, promotedSession: null,
        releaseReason: 'foreign', resolvedThrough: null }] });
    const lease = cp.leases[0]!;
    const r = plan(cp, { readBack: new Map([[lease.leaseId, carrier(bodyOf(lease, { generation: 2, state: 'adopted' }))]]) });
    expect(r.steps).toMatchObject([{ kind: 'mark', args: { leaseId: lease.leaseId, generation: 3, state: 'released', releaseReason: 'foreign', expiresAtMs: null } }]);
    expect(plan(cp, { readBack: new Map([[lease.leaseId, { kind: 'absent' }]]) }).steps).toEqual([]);
  });

  it('W5-K8b: the heal, a released lease with no carrier that a by-tree entry names, gets one released mark; unmeasured gets none', () => {
    const cp = checkpointWithLease({ generation: 2, releasedAt: '2026-11-10T00:00:00.000Z' },
      { leaseCarriers: [{ leaseId: leaseRow().leaseId, transferringSince: null, transferRun: null, promotedRun: null, promotedSession: null,
        releaseReason: 'native-removed', resolvedThrough: null }] });
    const id = cp.leases[0]!.leaseId;
    const rb = new Map<string, CarrierReadBack>([[id, { kind: 'absent' }]]);
    expect(plan(cp, { readBack: rb, indexed: new Set([id]) }).steps)
      .toMatchObject([{ kind: 'mark', args: { leaseId: id, generation: 2, state: 'released', releaseReason: 'native-removed' } }]);
    const unmeasured = plan(cp, { readBack: rb, indexed: 'unmeasured' });
    expect(unmeasured.steps).toEqual([]);
    expect(unmeasured.health, 'review 1546 F10: an unmeasured index counts the lease unmeasured').toMatchObject({ unmeasured: 1 });
    const none = plan(cp, { readBack: rb, indexed: new Set() });
    expect(none.steps).toEqual([]);
    expect(none.health.unmeasured).toBe(0);
  });

  it('W5-K10: an unowned carrier counts unowned, and a released unowned one does not', () => {
    const cp = checkpointWithLease({ generation: 1, carrierGenerationSeen: 1 });
    const stray = bodyOf(leaseRow({ leaseId: '99999999-0000-4000-8000-000000000009', generation: 1 }));
    expect(plan(cp, { readBack: new Map([[stray.leaseId, carrier(stray)]]) }).health.unowned).toBe(1);
    expect(plan(cp, { readBack: new Map([[stray.leaseId, carrier({ ...stray, state: 'released', releaseReason: 'foreign' })]]) }).health.unowned).toBe(0);
  });

  it('D-8036 (review 1546 F6a): an unowned carrier that cannot be read counts unmeasured, never unowned', () => {
    const cp = checkpointWithLease({ generation: 1, carrierGenerationSeen: 1 });
    for (const rb of [{ kind: 'unreadable', detail: 'EACCES' }, { kind: 'malformed', detail: 'not JSON' }] as const) {
      expect(plan(cp, { readBack: new Map([['99999999-0000-4000-8000-000000000009', rb]]) }).health).toMatchObject({ unmeasured: 1, unowned: 0 });
    }
  });

  it('D-8034 (review 1546 F1): every lease behind is read, and up to eight up-to-date unreleased ones, least recently read first', () => {
    const cp = many(10, () => ({ generation: 1, carrierGenerationSeen: 1 }));
    const ids = cp.leases.map((l) => l.leaseId);
    expect(DELEGATION_CARRIER_REVERIFY_PER_PASS).toBe(8);
    const first = carrierReadsOf(cp, new Map());
    expect(first).toEqual({ behind: [], reverify: ids.slice(0, 8) });
    const second = carrierReadsOf(cp, new Map(ids.slice(0, 8).map((id) => [id, 1])));
    expect(second.reverify.slice(0, 2), 'the two left over go first').toEqual(ids.slice(8));
    expect(second.reverify).toHaveLength(8);
    const mixed: DelegationCheckpointV1 = { ...cp, leases: [{ ...cp.leases[0]!, generation: 2 }, { ...cp.leases[1]!, releasedAt: '2026-11-10T00:00:00.000Z' },
      ...cp.leases.slice(2)] };
    const m = carrierReadsOf(mixed, new Map());
    expect(m.behind, 'behind is read whatever the bound').toEqual([ids[0]]);
    expect(m.reverify, 'a released up-to-date lease is not read again').not.toContain(ids[1]);
  });

  it('D-8034 (review 1546 F1): a re-read up-to-date carrier that changed is mismatched, and one that is gone is marked again', () => {
    const cp = checkpointWithLease({ generation: 1, currentJournalSequence: 9, carrierGenerationSeen: 1 });
    const lease = cp.leases[0]!;
    for (const body of [bodyOf(lease, { generation: 2 }), bodyOf(lease, { journalSeq: 8 })]) {
      const r = plan(cp, { readBack: new Map([[lease.leaseId, carrier(body)]]) });
      expect(r.steps).toEqual([]);
      expect(r.health).toMatchObject({ mismatched: 1, marked: 0 });
    }
    expect(plan(cp, { readBack: new Map([[lease.leaseId, { kind: 'absent' }]]) }).steps)
      .toMatchObject([{ kind: 'mark', args: { leaseId: lease.leaseId, generation: 1, state: 'ephemeral' } }]);
    expect(plan(cp, { readBack: new Map([[lease.leaseId, carrier(bodyOf(lease))]]) })).toMatchObject({ steps: [], health: { marked: 1 } });
  });

  it('D-8037 (review 1546 F2): without the orphan lock, a mark of a state that holds a tree is not composed and counts unsupported', () => {
    const held = checkpointWithLease({ generation: 2, disposition: 'retained', cleanupDueAt: '2026-11-17T12:00:00.000Z', carrierGenerationSeen: 1 });
    const eph = checkpointWithLease({ generation: 1 });
    const absent = (cp: DelegationCheckpointV1) => new Map<string, CarrierReadBack>([[cp.leases[0]!.leaseId, { kind: 'absent' }]]);
    const r = plan(held, { readBack: absent(held), lockSupported: false });
    expect(r.steps).toEqual([]);
    expect(r.health).toMatchObject({ unsupported: 1, pending: 0 });
    expect(plan(eph, { readBack: absent(eph), lockSupported: false }).steps).toMatchObject([{ kind: 'mark', args: { state: 'ephemeral' } }]);
    expect(plan(held, { readBack: absent(held), lockSupported: true }).steps).toMatchObject([{ kind: 'mark', args: { state: 'retained' } }]);
  });

  it('D-8039 (review 1546 F3): a standing refusal ends after thirty passes, whatever the census row says', () => {
    const cp = checkpointWithLease({ generation: 1 });
    const lease = cp.leases[0]!;
    const key = delegationTreeKey(lease.project, lease.adminRecord);
    expect(DELEGATION_CARRIER_REFUSAL_RETRY_PASSES).toBe(30);
    for (const word of ['nested', 'tree-held'] as const) {
      const refused = new Map<string, StandingMarkRefusal>([[lease.leaseId, { generation: 1, censusRow: 'row', word, pass: 5 }]]);
      const at = (pass: number) => plan(cp, { readBack: new Map([[lease.leaseId, { kind: 'absent' }]]), censusRow: new Map([[key, 'row']]), refused, pass });
      expect(at(34)).toMatchObject({ steps: [], health: { refused: 1 } });
      expect(at(35).steps, `${word}: composed again at the bound`).toMatchObject([{ kind: 'mark', args: { leaseId: lease.leaseId } }]);
    }
  });

  it('D-8039 (review 1546 F4): a lease whose last mark answered unmeasured takes the budget after every other, oldest first in each group', () => {
    const cp = many(10, (i) => ({ generation: i < 9 ? 1 : 0 }));
    const ids = cp.leases.map((l) => l.leaseId);
    const absent = new Map<string, CarrierReadBack>(ids.slice(0, 9).map((id) => [id, { kind: 'absent' }]));
    const r = plan(cp, { readBack: absent, deferred: new Set(ids.slice(0, 9)) });
    const named = r.steps.map((s) => (s.kind === 'mark' ? s.args.leaseId : s.leaseId));
    expect(named, 'the new lease is minted first, then seven of the nine').toEqual([ids[9], ...ids.slice(0, 7)]);
    expect(r.health.pending).toBe(2);
    expect(plan(cp, { readBack: absent }).steps.map((s) => (s.kind === 'mark' ? s.args.leaseId : s.leaseId)), 'none deferred: oldest first')
      .toEqual(ids.slice(0, 8));
  });

  it('the census row says the tree state, head, lock and the registry workdirs at or inside it, and nothing else', () => {
    const t = '/w/demo/.claude/worktrees/a';
    const rec = { state: 'present', headSha: 'a'.repeat(40), locked: true } as const;
    const base = delegationCarrierCensusRow(t, rec, []);
    expect(delegationCarrierCensusRow(t, { ...rec, locked: false }, [])).not.toBe(base);
    expect(delegationCarrierCensusRow(t, { ...rec, headSha: 'c'.repeat(40) }, [])).not.toBe(base);
    expect(delegationCarrierCensusRow(t, rec, [`${t}/sub`])).not.toBe(base);
    expect(delegationCarrierCensusRow(t, rec, [t])).not.toBe(base);
    expect(delegationCarrierCensusRow(t, rec, ['/w/demo', `${t}b`])).toBe(base);
    expect(delegationCarrierCensusRow(t, undefined, [])).not.toBe(base);
  });

  it('the mark arguments carry the lease as journalled, with an expiry only on a kept lease and the promoted run on a promoted one', () => {
    const lease = leaseRow({ generation: 4, currentJournalSequence: 12, parentIncarnation: INC, disposition: 'promoted' });
    const row = { leaseId: lease.leaseId, transferringSince: null, transferRun: 7, promotedRun: 7, promotedSession: 'demo-bright-fern',
      releaseReason: null, resolvedThrough: null };
    expect(carrierMarkArgs(lease, row)).toEqual({
      leaseId: lease.leaseId, generation: 4, project: 'project-a', adminRecord: 'wt-1', parentId: 'lane-a-demo', parentIncarnation: INC,
      activityId: lease.activityId, source: 'agent', state: 'promoted', journalSeq: 12, expiresAtMs: null, releaseReason: null,
      promoted: { runId: 7, sessionId: 'demo-bright-fern' },
    });
  });
});

describe('parseDelegationCarrier', () => {
  const good = bodyOf(leaseRow({ generation: 1 }));
  it('reads the verb\'s own body', () => {
    expect(parseDelegationCarrier(`${JSON.stringify(good)}\n`)).toEqual({ kind: 'carrier', body: good });
    expect(parseDelegationCarrier(`${JSON.stringify(good)}\n`, good.leaseId)).toEqual({ kind: 'carrier', body: good });
  });
  it('review 1546 F8: a body whose leaseId is not the lease its file is named for is malformed', () => {
    expect(parseDelegationCarrier(JSON.stringify(good), '99999999-0000-4000-8000-000000000009')).toMatchObject({ kind: 'malformed' });
  });
  it('W5-K9: a missing key, an extra key, generation 0, a state outside the vocabulary and a body over 16384 bytes are malformed', () => {
    const { markedAt: _m, ...missing } = good;
    for (const text of [JSON.stringify(missing), JSON.stringify({ ...good, extra: 1 }), JSON.stringify({ ...good, generation: 0 }),
      JSON.stringify({ ...good, state: 'running' }), JSON.stringify({ ...good, canonicalPath: 'x'.repeat(16_400) }), '{', '[]', 'null']) {
      expect(parseDelegationCarrier(text).kind).toBe('malformed');
    }
  });
});
