// Delegation broker wave 5, PR5 (Tasks 5.5.2 and 5.5.3): the lease kinds held, carried and freed by the durability layer.
//
// PR5a (reader only) owns W5-J8: `computeHolds` holds every record of an unreleased lease, and a release frees them all and
// closes the lease's opening lineage with the release reason. Nothing here writes a new kind through a door: the records are
// built by the journal's own record builder, as PR5b's doors would append them. Rows W5-J9 to W5-J14 arrive with PR5b's doors.
import { describe, it, expect } from 'vitest';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import {
  delegationSha256Hex,
  deriveDelegationLineageId,
  formatDelegationInstant,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';
import { buildDelegationJournalRecord } from '../src/coord/delegation-journal.js';
import { recoverDelegation } from '../src/coord/delegation-checkpoint.js';

const PARENT = 'lane-a-demo';
const INC = 'g1';
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 10, 10) + s * 1000);
const plus7d = (at: string): string => formatDelegationInstant(Date.parse(at) + 7 * 86_400_000);

const eid = (n: number): string => delegationSha256Hex(`fixture-event-${n}`);
const base = (n: number) => ({
  v: 1 as const, observedAt: T(n), sessionId: PARENT, parentIncarnation: INC, claudeSessionId: '11111111-2222-3333-4444-555555555555',
  eventId: eid(n), bucket: '2026111000', startOffset: n * 100, endOffset: n * 100 + 99,
});
const sessionStart = (n: number): DelegationEventEnvelopeV1 => ({ ...base(n), eventKind: 'SessionStart', source: 'startup' });
const subagentStart = (n: number, agentId: string): DelegationEventEnvelopeV1 => ({ ...base(n), eventKind: 'SubagentStart', agentId, agentType: null });

function chain(entries: readonly DelegationJournalEntryV1[]): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev: string | null = null;
  entries.forEach((entry, i) => {
    const r = buildDelegationJournalRecord({ sequence: i + 1, acceptedAt: T(1000 + i), previousDigest: prev, entry });
    out.push(r);
    prev = r.digest;
  });
  return out;
}

describe('W5-J8: computeHolds holds an open lease\'s every record, and a release frees them', () => {
  const events = [sessionStart(1), subagentStart(2, 'agent-abc123')];
  const base = chain(events.map((event) => ({ kind: 'evidence-accepted' as const, event })));
  const activityId = recoverDelegation(null, base).state.checkpoint.activities[0]!.activityId;
  const lineageId = deriveDelegationLineageId({ leaseId: 'lease-1', parentId: PARENT, parentIncarnation: INC, activityId });
  const created: DelegationJournalEntryV1 = {
    kind: 'lease-created', leaseId: 'lease-1', generation: 0, activityId, parentId: PARENT, parentIncarnation: INC, project: 'project-a',
    adminRecord: 'wt-1', canonicalPath: '/work/project-a/wt-1', creationBase: null, sourceKind: 'agent', correlationJournalIds: [base[1]!.journalId],
    firstObservedAt: T(3), lineageId,
  };
  const tr = (generation: number, reason: string, to: string, at: string, expiresAt: string | null = null): DelegationJournalEntryV1 => ({
    kind: 'lease-transition', leaseId: 'lease-1', generation, reason, to, at, expiresAt, terminalEvidenceAt: null, runId: null, promotedSession: null,
    auditEvidence: null, lineageClose: null, lineageOpenRun: null, resolvesThrough: null,
  } as DelegationJournalEntryV1);
  const open = [created, tr(1, 'carrier', 'ephemeral', T(4)), { kind: 'lease-carrier-seen', leaseId: 'lease-1', generation: 1, at: T(5) } as DelegationJournalEntryV1,
    tr(2, 'retain', 'retained', T(6), plus7d(T(6)))];
  const released: DelegationJournalEntryV1 = { kind: 'lease-released', leaseId: 'lease-1', generation: 3, releaseReason: 'native-removed', at: T(9), lastHeadSha: null, resolvesThrough: null };

  it('an unreleased lease holds its creating record, its evidence and every transition record, as open-lease and open-lineage', () => {
    const records = chain([...base.map((r) => r.entry), ...open]);
    const report = recoverDelegation(null, records);
    expect(report.failure).toBeNull();
    const held = (reason: string) => report.state.checkpoint.pruningHolds.filter((h) => h.reason === reason).map((h) => h.journalId).sort();
    const want = [base[1]!.journalId, ...records.slice(2).map((r) => r.journalId)].sort();
    expect(held('open-lease')).toEqual(want);
    expect(held('open-lineage')).toEqual(want);
  });

  it('after lease-released no record of that lease is held, and its opening lineage is closed with the release reason', () => {
    const records = chain([...base.map((r) => r.entry), ...open, released]);
    const report = recoverDelegation(null, records);
    expect(report.failure).toBeNull();
    const cp = report.state.checkpoint;
    expect(cp.pruningHolds.filter((h) => h.reason === 'open-lease' || h.reason === 'open-lineage')).toEqual([]);
    expect(cp.lineage.find((n) => n.lineageId === lineageId)).toMatchObject({ closedAt: T(9), closeReason: 'native-removed' });
    expect(cp.leases[0]).toMatchObject({ releasedAt: T(9), generation: 3, disposition: 'retained' });
    expect(cp.leaseCarriers).toEqual([{ leaseId: 'lease-1', transferringSince: null, transferRun: null, promotedRun: null, promotedSession: null,
      releaseReason: 'native-removed', resolvedThrough: null }]);
  });
});
