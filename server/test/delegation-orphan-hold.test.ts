// Delegation broker wave 5 PR4, Task 5.4.3: the server skip's L1 decision (`orphanLeaseHold`, D-7002, D-7811, D-7828; O5-1 (a)).
// A READY checkpoint is consulted for every orphan class; a null one (the applier not ready) stops only `claude`/`superpowers`
// trees, so the orphan lane composes an unleased `ccd-root` tree exactly as it did before PR4.
import { describe, it, expect } from 'vitest';
import { orphanLeaseHold, DELEGATION_ORPHAN_HELD_STATES, DELEGATION_UNREADY_HOLD_CLASSES } from '../src/coord/delegation-orphan-hold.js';
import { delegationCarrierStateOf } from '../src/coord/delegation-lease-state.js';
import { checkpointWithLease, leaseRow } from './delegationLeaseFixture.js';
import { beatLeaseHold } from '../src/orphanTreeBeat.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const byDisposition = (l: { disposition: string }) => l.disposition as never;

describe('orphanLeaseHold', () => {
  it('W5-O9: no checkpoint is not-ready, never free', () => {
    for (const orphanClass of DELEGATION_UNREADY_HOLD_CLASSES) {
      expect(orphanLeaseHold({ checkpoint: null, heldStateOf: byDisposition, orphanClass, path: '/p/demo/.claude/worktrees/agent-a', nowMs: NOW }).kind)
        .toBe('not-ready');
    }
  });
  it('W5-O10: an adopted lease is held until its expiry plus the margin, then free', () => {
    const cp = checkpointWithLease({ canonicalPath: '/p/t', disposition: 'adopted', cleanupDueAt: '2026-11-10T11:30:00.000Z' });
    expect(orphanLeaseHold({ checkpoint: cp, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t', nowMs: NOW }))
      .toMatchObject({ kind: 'held', state: 'adopted', until: '2026-11-10T11:30:00.000Z' });
    expect(orphanLeaseHold({ checkpoint: cp, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t', nowMs: NOW + 2 * 3_600_000 }).kind).toBe('free');
  });
  it('W5-O11: an ephemeral, promoted or released lease is free; another path is free', () => {
    for (const disposition of ['ephemeral', 'promoted'] as const) {
      const cp = checkpointWithLease({ canonicalPath: '/p/t', disposition, cleanupDueAt: null });
      expect(orphanLeaseHold({ checkpoint: cp, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t', nowMs: NOW }).kind).toBe('free');
    }
    const released = checkpointWithLease({ canonicalPath: '/p/t', disposition: 'retained', cleanupDueAt: '2026-12-01T00:00:00.000Z', releasedAt: '2026-11-09T00:00:00.000Z' });
    expect(orphanLeaseHold({ checkpoint: released, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t', nowMs: NOW }).kind).toBe('free');
    const held = checkpointWithLease({ canonicalPath: '/p/t', disposition: 'retained', cleanupDueAt: '2026-12-01T00:00:00.000Z' });
    expect(orphanLeaseHold({ checkpoint: held, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t2', nowMs: NOW }).kind).toBe('free');
    expect(orphanLeaseHold({ checkpoint: held, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t/', nowMs: NOW }).kind).toBe('free');   // byte for byte
  });
  it('W5-O12: a held disposition with no expiry, or an unreadable one, is not-ready', () => {
    for (const cleanupDueAt of [null, '2026-11-17']) {
      const cp = checkpointWithLease({ canonicalPath: '/p/t', disposition: 'retained', cleanupDueAt });
      expect(orphanLeaseHold({ checkpoint: cp, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t', nowMs: NOW }).kind).toBe('not-ready');
    }
  });
  it('W5-O12b: a ccd-root or other tree is free even with no checkpoint', () => {
    for (const orphanClass of ['ccd-root', 'other']) {
      expect(orphanLeaseHold({ checkpoint: null, heldStateOf: byDisposition, orphanClass, path: '/w/demo/quiet-mesa', nowMs: NOW }).kind).toBe('free');
    }
  });
  it('W5-O12c: a ready checkpoint holds a retained lease at a ccd-root path', () => {
    const cp = checkpointWithLease({ canonicalPath: '/w/demo/x', sourceKind: 'raw', disposition: 'retained', cleanupDueAt: '2026-11-17T12:00:00.000Z' });
    expect(orphanLeaseHold({ checkpoint: cp, heldStateOf: byDisposition, orphanClass: 'ccd-root', path: '/w/demo/x', nowMs: NOW }))
      .toMatchObject({ kind: 'held', state: 'retained' });
  });
  it('W5-O14: a lease with a transferringSince carrier row is held with until null (the carrier-state rule, as the beat wires it)', async () => {
    const lease = leaseRow({ canonicalPath: '/p/t', disposition: 'adopted', cleanupDueAt: '2026-11-01T00:00:00.000Z', generation: 3 });
    const cp = checkpointWithLease(lease, { leaseCarriers: [{ leaseId: lease.leaseId, transferringSince: '2026-11-09T00:00:00.000Z', transferRun: 41,
      promotedRun: null, promotedSession: null, releaseReason: null, resolvedThrough: null }] });
    const heldStateOf = (l: Parameters<typeof delegationCarrierStateOf>[0], c: typeof cp) =>
      delegationCarrierStateOf(l, c.leaseCarriers?.find((r) => r.leaseId === l.leaseId));
    expect(orphanLeaseHold({ checkpoint: cp, heldStateOf, orphanClass: 'claude', path: '/p/t', nowMs: NOW }))
      .toEqual({ kind: 'held', leaseId: lease.leaseId, state: 'transferring', until: null });
    // the beat's own wiring (`orphanTreeBeat.ts#beatLeaseHold`), never `l.disposition`
    expect(await beatLeaseHold(() => cp, () => NOW)('/p/t', 'claude')).toEqual({ kind: 'held', leaseId: lease.leaseId, state: 'transferring', until: null });
    expect((await beatLeaseHold(() => checkpointWithLease(lease), () => NOW)('/p/t', 'claude')).kind)
      .toBe('free');   // CONTROL: no carrier row, the expired adoption frees it
  });
  it('the held set is O5-1 (a)', () => {
    expect([...DELEGATION_ORPHAN_HELD_STATES]).toEqual(['adopted', 'retained', 'transferring']);
  });
});
