// Delegation broker wave 5, PR5a (Task 5.5.1): the ONE lease transition table and the carrier-state derivation, in L1.
//
// `delegation-lease-state.ts` decides every lease transition: the live doors (PR5b) and the journal replay fold (this PR) both
// call `decideLeaseTransition`, so the two can never disagree about what a journalled transition means.
import { describe, it, expect } from 'vitest';
import { DELEGATION_CARRIER_STATES } from '../../shared/api.js';
import {
  DELEGATION_CARRIER_GATED_REASONS,
  DELEGATION_LEASE_TRANSITIONS,
  DELEGATION_LEASE_TRANSITION_REASONS,
  decideLeaseRelease,
  decideLeaseTransition,
  delegationCarrierStateOf,
  planNativeRemoved,
  type NativeRemovedInput,
} from '../src/coord/delegation-lease-state.js';
import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
import type { DelegationLeaseCarrierRow, DelegationLeaseRow } from '../src/coord/delegation-model.js';
import { checkpointWithLease, leaseRow } from './delegationLeaseFixture.js';

const carrierRow = (over: Partial<DelegationLeaseCarrierRow> & { leaseId: string }): DelegationLeaseCarrierRow => ({
  transferringSince: null, transferRun: null, promotedRun: null, promotedSession: null, releaseReason: null, resolvedThrough: null, ...over,
});

describe('the one lease transition table', () => {
  it('W5-J1: every row starts and ends in carrier states, and no row starts from released or promoted', () => {
    for (const [reason, row] of Object.entries(DELEGATION_LEASE_TRANSITIONS)) {
      for (const f of row.from) expect(DELEGATION_CARRIER_STATES, reason).toContain(f);
      if (row.to !== 'prior') expect(DELEGATION_CARRIER_STATES, reason).toContain(row.to);
      expect(row.from, reason).not.toContain('released');
      expect(row.from, reason).not.toContain('promoted');
    }
    expect(Object.keys(DELEGATION_LEASE_TRANSITIONS)).toEqual([...DELEGATION_LEASE_TRANSITION_REASONS]);
  });

  it('W5-J2: adopt only from ephemeral; retain from ephemeral, adopted or retained; promote only from transferring', () => {
    const l = (disposition: 'ephemeral' | 'adopted' | 'retained' | 'promoted', generation = 1) => leaseRow({ disposition, generation });
    const req = (reason: 'adopt' | 'retain' | 'promote') => ({ reason, expectGeneration: 1, carrierRequired: false });
    expect(decideLeaseTransition(l('ephemeral'), undefined, req('adopt'))).toEqual({ ok: true, to: 'adopted', generation: 2 });
    expect(decideLeaseTransition(l('adopted'), undefined, req('adopt'))).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
    expect(decideLeaseTransition(l('retained'), undefined, req('adopt'))).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
    expect(decideLeaseTransition(l('ephemeral'), undefined, req('retain'))).toMatchObject({ ok: true, to: 'retained' });
    expect(decideLeaseTransition(l('adopted'), undefined, req('retain'))).toMatchObject({ ok: true, to: 'retained' });
    expect(decideLeaseTransition(l('retained'), undefined, req('retain'))).toMatchObject({ ok: true, to: 'retained' });
    expect(decideLeaseTransition(l('promoted'), undefined, req('retain'))).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
    expect(decideLeaseTransition(l('retained'), undefined, req('promote'))).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
  });

  it('W5-J3: a transfer goes back to the prior disposition, never to ephemeral by default', () => {
    const lease = leaseRow({ disposition: 'adopted', generation: 3 });
    const carrier = carrierRow({ leaseId: lease.leaseId, transferringSince: '2026-11-10T12:00:00.000Z', transferRun: 12 });
    const req = (reason: 'transfer-refused' | 'transfer-recovered' | 'retain' | 'promote') => ({ reason, expectGeneration: 3, carrierRequired: false });
    expect(delegationCarrierStateOf(lease, carrier)).toBe('transferring');
    expect(decideLeaseTransition(lease, carrier, req('transfer-refused'))).toEqual({ ok: true, to: 'adopted', generation: 4 });
    expect(decideLeaseTransition(lease, carrier, req('transfer-recovered'))).toEqual({ ok: true, to: 'adopted', generation: 4 });
    expect(decideLeaseTransition(lease, carrier, req('retain'))).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
    expect(decideLeaseTransition(lease, carrier, req('promote'))).toEqual({ ok: true, to: 'promoted', generation: 4 });
    // A transferring lease is never released (the table's own-kind row), and a settled one is.
    expect(decideLeaseRelease(lease, carrier, { expectGeneration: 3 })).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
    expect(decideLeaseRelease(lease, undefined, { expectGeneration: 3 })).toEqual({ ok: true, to: 'released', generation: 4 });
  });

  it('W5-J4: a stale generation, an unknown lease and a released lease each refuse with their own word', () => {
    const req = { reason: 'retain' as const, expectGeneration: 1, carrierRequired: false };
    expect(decideLeaseTransition(leaseRow({ generation: 2 }), undefined, req)).toMatchObject({ refusal: 'stale-generation' });
    expect(decideLeaseTransition(undefined, undefined, req)).toMatchObject({ refusal: 'lease-unknown' });
    expect(decideLeaseTransition(leaseRow({ releasedAt: '2026-11-09T00:00:00.000Z' }), undefined, req)).toMatchObject({ refusal: 'lease-released' });
    expect(decideLeaseRelease(leaseRow({ generation: 2 }), undefined, { expectGeneration: 1 })).toMatchObject({ refusal: 'stale-generation' });
    expect(decideLeaseRelease(undefined, undefined, { expectGeneration: 1 })).toMatchObject({ refusal: 'lease-unknown' });
    expect(decideLeaseRelease(leaseRow({ releasedAt: '2026-11-09T00:00:00.000Z' }), undefined, { expectGeneration: 1 })).toMatchObject({ refusal: 'lease-released' });
  });

  it('W5-J5: carrier is only the first transition', () => {
    expect(decideLeaseTransition(leaseRow({ generation: 0 }), undefined, { reason: 'carrier', expectGeneration: 0, carrierRequired: false }))
      .toEqual({ ok: true, to: 'ephemeral', generation: 1 });
    expect(decideLeaseTransition(leaseRow({ generation: 1 }), undefined, { reason: 'carrier', expectGeneration: 1, carrierRequired: false }))
      .toMatchObject({ ok: false });
  });

  it('W5-J5b: carrier-behind refuses only a gated reason, only when the caller requires a carrier', () => {
    const behind = leaseRow({ disposition: 'retained', generation: 3, carrierGenerationSeen: 2 });
    const caught = leaseRow({ disposition: 'retained', generation: 3, carrierGenerationSeen: 3 });
    const retain = (carrierRequired: boolean) => ({ reason: 'retain' as const, expectGeneration: 3, carrierRequired });
    expect(decideLeaseTransition(behind, undefined, retain(true))).toMatchObject({ ok: false, refusal: 'carrier-behind' });
    expect(decideLeaseTransition(behind, undefined, retain(false))).toEqual({ ok: true, to: 'retained', generation: 4 });
    expect(decideLeaseTransition(caught, undefined, retain(true))).toEqual({ ok: true, to: 'retained', generation: 4 });
    expect(decideLeaseTransition(caught, undefined, retain(false))).toEqual({ ok: true, to: 'retained', generation: 4 });
    // A never-read-back carrier is behind too.
    expect(decideLeaseTransition(leaseRow({ disposition: 'adopted', generation: 2 }), undefined,
      { reason: 'retain', expectGeneration: 2, carrierRequired: true })).toMatchObject({ ok: false, refusal: 'carrier-behind' });
    // The transfer's own marks are driven synchronously: its finishing reasons never wait on the carrier.
    const moving = leaseRow({ disposition: 'retained', generation: 3, carrierGenerationSeen: 2 });
    const carrier = carrierRow({ leaseId: moving.leaseId, transferringSince: '2026-11-10T12:00:00.000Z', transferRun: 12 });
    for (const reason of ['transfer-refused', 'transfer-recovered', 'promote'] as const) {
      expect(decideLeaseTransition(moving, carrier, { reason, expectGeneration: 3, carrierRequired: true }), reason).toMatchObject({ ok: true });
    }
    expect(decideLeaseTransition(leaseRow({ generation: 0, carrierGenerationSeen: null }), undefined,
      { reason: 'carrier', expectGeneration: 0, carrierRequired: true })).toEqual({ ok: true, to: 'ephemeral', generation: 1 });
    expect([...DELEGATION_CARRIER_GATED_REASONS]).toEqual(['adopt', 'retain', 'operator-retain', 'attach', 'transfer']);
  });

  it('the carrier state reads released first, then transferring, then the disposition', () => {
    const lease = leaseRow({ disposition: 'retained', generation: 2 });
    expect(delegationCarrierStateOf(lease, undefined)).toBe('retained');
    expect(delegationCarrierStateOf({ ...lease, releasedAt: '2026-11-09T00:00:00.000Z' },
      carrierRow({ leaseId: lease.leaseId, transferringSince: '2026-11-10T12:00:00.000Z', transferRun: 4 }))).toBe('released');
  });
});

// ── PR5b (Task 5.5.4): native-removed release, the planner ─────────────────────────────────────────────────────────────

describe('planNativeRemoved: a lease whose tree is gone from two successful listings is released', () => {
  const key = (project: string, record: string): string => delegationTreeKey(project, record);
  const A = leaseRow({ leaseId: 'lease-a', project: 'project-a', adminRecord: 'wt-1', generation: 1, currentJournalSequence: 6 });
  /** One pass's census: which projects were censused, and per record (by project) its census state; a record not named is not listed. */
  type Pass = { censused: string[]; records?: Array<[string, string, 'present' | 'absent' | 'unreadable', string?]> };
  type Memory = { absentListings: ReadonlyMap<string, number>; lastHeads: ReadonlyMap<string, string> };
  const inputOf = (leases: DelegationLeaseRow[], pass: Pass, memory: Memory, carriers: DelegationLeaseCarrierRow[] = []): NativeRemovedInput => {
    const recs = pass.records ?? [];
    return {
      checkpoint: { ...checkpointWithLease(), leases, ...(carriers.length === 0 ? {} : { leaseCarriers: carriers }) },
      censused: new Set(pass.censused),
      listed: new Set(recs.map(([p, r]) => key(p, r))),
      absent: new Set(recs.filter(([, , s]) => s === 'absent').map(([p, r]) => key(p, r))),
      unreadable: new Set(recs.filter(([, , s]) => s === 'unreadable').map(([p, r]) => key(p, r))),
      heads: new Map(recs.flatMap(([p, r, s, h]) => (s === 'present' && h !== undefined ? [[key(p, r), h] as const] : []))),
      ...memory,
    };
  };
  /** Runs passes in order, carrying the memory, and answers each pass's plan. */
  const run = (leases: DelegationLeaseRow[], passes: Pass[], carriers: DelegationLeaseCarrierRow[] = []) => {
    let memory: Memory = { absentListings: new Map(), lastHeads: new Map() };
    return passes.map((p) => { const out = planNativeRemoved(inputOf(leases, p, memory, carriers)); memory = { absentListings: out.absentListings, lastHeads: out.lastHeads }; return out; });
  };
  const gone: Pass = { censused: ['project-a'], records: [['project-a', 'wt-other', 'present']] };
  const present: Pass = { censused: ['project-a'], records: [['project-a', 'wt-1', 'present']] };

  it('W5-J15: absent from two consecutive successful listings releases, native-removed, at the lease\'s generation', () => {
    const [one, two] = run([A], [gone, gone]);
    expect(one!.release).toEqual([]);
    expect(one!.absentListings.get('lease-a')).toBe(1);
    expect(two!.release).toEqual([{ leaseId: 'lease-a', expectGeneration: 1, releaseReason: 'native-removed', lastHeadSha: null }]);
    expect(two!.absentListings.has('lease-a')).toBe(false);
    expect(run([A], [{ censused: ['project-a'], records: [['project-a', 'wt-1', 'absent']] }, gone])[1]!.release, 'listed absent counts as absent').toHaveLength(1);
    expect(run([A], [gone, present, gone]).map((o) => o.release.length), 'a present listing resets the count').toEqual([0, 0, 0]);
  });

  it('W5-J16: an uncensused pass between two absences neither counts nor resets; an unreadable one resets', () => {
    expect(run([A], [gone, { censused: [] }, gone]).map((o) => o.release.length)).toEqual([0, 0, 1]);
    const unread: Pass = { censused: ['project-a'], records: [['project-a', 'wt-1', 'unreadable']] };
    const outs = run([A], [gone, unread, gone]);
    expect(outs.map((o) => o.release.length)).toEqual([0, 0, 0]);
    expect(outs[1]!.absentListings.has('lease-a'), 'unreadable is never absence: the count is 0').toBe(false);
  });

  it('W5-J16b: an admin record that stays listed while its tree directory is gone never releases; missing from two listings it does', () => {
    // The census lists the record (its admin record reads) while the tree directory is gone: listed, and not `absent`.
    const standing: Pass = { censused: ['project-a'], records: [['project-a', 'wt-1', 'present']] };
    const outs = run([A], [standing, standing, standing, gone, gone]);
    expect(outs.map((o) => o.release.length)).toEqual([0, 0, 0, 0, 1]);
    expect(outs.slice(0, 3).every((o) => !o.absentListings.has('lease-a')), 'its count stays 0').toBe(true);
  });

  it('W5-J16c: a project dropped from the census, or listed unmeasured, releases nothing for three passes, keeps its count and is counted uncensused', () => {
    // Dropped from the registry-named census: not in `censused` at all.
    const dropped = run([A], [gone, { censused: ['project-b'] }, { censused: ['project-b'] }, { censused: ['project-b'] }]);
    expect(dropped.map((o) => o.release.length)).toEqual([0, 0, 0, 0]);
    expect(dropped.slice(1).map((o) => [o.uncensused, o.absentListings.get('lease-a')])).toEqual([[1, 1], [1, 1], [1, 1]]);
    // Listed but unmeasured (`delegation: null`): the lane leaves it out of `censused` too, so the same three answers.
    const unmeasured = run([A], [{ censused: [] }, { censused: [] }, { censused: [] }]);
    expect(unmeasured.map((o) => [o.release.length, o.uncensused, o.absentListings.has('lease-a')])).toEqual([[0, 1, false], [0, 1, false], [0, 1, false]]);
  });

  it('W5-J16d: two leases on one admin record name in two projects: missing from A\'s listing while B lists it counts only A\'s lease', () => {
    const B = leaseRow({ leaseId: 'lease-b', project: 'project-b', adminRecord: 'wt-1', canonicalPath: '/work/project-b/.claude/worktrees/wt-1', generation: 2 });
    const pass: Pass = { censused: ['project-a', 'project-b'], records: [['project-b', 'wt-1', 'present']] };
    const outs = run([A, B], [pass, pass]);
    expect(outs[1]!.release).toEqual([{ leaseId: 'lease-a', expectGeneration: 1, releaseReason: 'native-removed', lastHeadSha: null }]);
    expect(outs.every((o) => !o.absentListings.has('lease-b'))).toBe(true);
  });

  it('D-8025: the release carries the last head a census saw for the record, kept across the absent listings and an uncensused pass', () => {
    const seen: Pass = { censused: ['project-a'], records: [['project-a', 'wt-1', 'present', 'a'.repeat(40)]] };
    const later: Pass = { censused: ['project-a'], records: [['project-a', 'wt-1', 'present', 'b'.repeat(40)]] };
    const outs = run([A], [seen, later, gone, { censused: [] }, gone]);
    expect(outs[1]!.lastHeads.get('lease-a')).toBe('b'.repeat(40));
    expect(outs[4]!.release).toEqual([{ leaseId: 'lease-a', expectGeneration: 1, releaseReason: 'native-removed', lastHeadSha: 'b'.repeat(40) }]);
    expect(outs[4]!.lastHeads.has('lease-a'), 'a released lease leaves the memory').toBe(false);
  });

  it('W5-J17: a promoted lease releases transferred; a transferring lease never releases; a released lease is not planned', () => {
    const P = leaseRow({ leaseId: 'lease-p', disposition: 'promoted', generation: 3, promotedAt: '2026-10-15T00:00:00.000Z' });
    expect(run([P], [gone, gone])[1]!.release).toEqual([{ leaseId: 'lease-p', expectGeneration: 3, releaseReason: 'transferred', lastHeadSha: null }]);
    const X = leaseRow({ leaseId: 'lease-t', disposition: 'adopted', generation: 3 });
    const transferring: DelegationLeaseCarrierRow = { leaseId: 'lease-t', transferringSince: '2026-10-15T00:00:00.000Z', transferRun: 12,
      promotedRun: null, promotedSession: null, releaseReason: null, resolvedThrough: null };
    expect(run([X], [gone, gone, gone], [transferring]).map((o) => o.release.length)).toEqual([0, 0, 0]);
    expect(run([leaseRow({ releasedAt: '2026-10-15T00:00:00.000Z' })], [gone, gone]).map((o) => o.release.length)).toEqual([0, 0]);
  });
});
