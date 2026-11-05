// Delegation broker wave 5: the shared lease-row fixture. Moved, unchanged, from `delegation-model.test.ts`'s private `lease`
// builder (PR5a), so every wave-5 suite builds a lease the same way. PR4 adds `checkpointWithLease` beside it.
import {
  deriveDelegationLineageId, emptyDelegationCheckpoint, type DelegationCheckpointV1, type DelegationLeaseRow,
} from '../src/coord/delegation-model.js';

/** `deriveDelegationActivityId` of the fixture natural key over the fixture journalId (delegation-model.test.ts's vector). */
const ACTIVITY_ID_FROM_JOURNAL = '9239bd0ac5b8d4af700cd38ae205546b428bc6b605ef1d9adcd09c1796afcbfc';
const T0 = '2026-10-14T00:00:00.000Z';

/** A wave-3 lease row (generation 0, ephemeral, every transition field null), with `over` laid on top. */
export const leaseRow = (over: Partial<DelegationLeaseRow> = {}): DelegationLeaseRow => ({
  leaseId: '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f', generation: 0, creatingJournalSequence: 5, currentJournalSequence: 5,
  activityId: ACTIVITY_ID_FROM_JOURNAL, parentId: 'lane-a-demo', parentIncarnation: 'g1', project: 'project-a',
  adminRecord: 'wt-1', canonicalPath: '/work/project-a/.claude/worktrees/wt-1', creationBase: null, sourceKind: 'agent',
  parentageState: 'linked', workspaceState: 'unmeasured', disposition: 'ephemeral', cleanupState: 'not-due',
  cleanupPopulation: 'ephemeral-lease', firstObservedAt: T0, lastObservedAt: T0, terminalEvidenceAt: null,
  adoptedAt: null, retainedAt: null, promotedAt: null, cleanupDueAt: null, cleanupStartedAt: null,
  cleanupFinishedAt: null, cleanupEvidenceJson: null, carrierGenerationSeen: null, releasedAt: null, ...over,
});

/** An empty wave-3 checkpoint holding the one lease `leaseRow(over)` and its lease-owned opening lineage row, applied through the
 *  lease's journal sequence (PR4; PR5 to PR9 reuse it). `extra` lays further checkpoint members on top (a `leaseCarriers` row). */
export const checkpointWithLease = (over: Partial<DelegationLeaseRow> = {}, extra: Partial<DelegationCheckpointV1> = {}): DelegationCheckpointV1 => {
  const lease = leaseRow(over);
  return {
    ...emptyDelegationCheckpoint(),
    appliedJournalSequence: lease.currentJournalSequence,
    leases: [lease],
    lineage: [{
      lineageId: deriveDelegationLineageId(lease), parentId: lease.parentId, parentIncarnation: lease.parentIncarnation,
      activityId: null, leaseId: lease.leaseId, runId: null, openedAt: lease.firstObservedAt, closedAt: null, closeReason: null,
    }],
    ...extra,
  };
};
