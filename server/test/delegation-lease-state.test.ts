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
} from '../src/coord/delegation-lease-state.js';
import type { DelegationLeaseCarrierRow } from '../src/coord/delegation-model.js';
import { leaseRow } from './delegationLeaseFixture.js';

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
