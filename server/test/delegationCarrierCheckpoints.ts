// Delegation broker wave 5, PR5a (review 1451 F1): checkpoints that carry `leaseCarriers`, built by the SERVER's own fold
// (`recoverDelegation` over a journal of evidence, two leases and their transitions), so a suite that holds a second reader of the
// checkpoint (the snapshot tool's) meets the bytes a PR5b server will write, not a hand-made shape.
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import { encodeDelegationCheckpoint, recoverDelegation } from '../src/coord/delegation-checkpoint.js';
import { buildDelegationJournalRecord } from '../src/coord/delegation-journal.js';
import {
  delegationSha256Hex, deriveDelegationLineageId, formatDelegationInstant,
  type DelegationCheckpointV1, type DelegationJournalEntryV1, type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';

const PARENT = 'lane-a-demo';
const INC = 'g1';
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + s * 1000);
const plus7d = (at: string): string => formatDelegationInstant(Date.parse(at) + 7 * 86_400_000);

const envelope = (n: number): Omit<DelegationEventEnvelopeV1, 'eventKind'> & Record<string, unknown> => ({
  v: 1, observedAt: T(n), sessionId: PARENT, parentIncarnation: INC, claudeSessionId: '11111111-2222-3333-4444-555555555555',
  eventId: delegationSha256Hex(`carrier-fixture-event-${n}`), bucket: '2026101400', startOffset: n * 100, endOffset: n * 100 + 99,
});
const events: DelegationEventEnvelopeV1[] = [
  { ...envelope(1), eventKind: 'SessionStart', source: 'startup' } as DelegationEventEnvelopeV1,
  { ...envelope(2), eventKind: 'SubagentStart', agentId: 'agent-carrier-x', agentType: null } as DelegationEventEnvelopeV1,
  { ...envelope(3), eventKind: 'SubagentStart', agentId: 'agent-carrier-y', agentType: null } as DelegationEventEnvelopeV1,
];

function chain(entries: readonly DelegationJournalEntryV1[]): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  entries.forEach((entry, i) => {
    out.push(buildDelegationJournalRecord({ sequence: i + 1, acceptedAt: T(100000 + i), previousDigest: out[i - 1]?.digest ?? null, entry }));
  });
  return out;
}

const transition = (over: Partial<Extract<DelegationJournalEntryV1, { kind: 'lease-transition' }>>): DelegationJournalEntryV1 => ({
  kind: 'lease-transition', leaseId: 'lease-1', generation: 1, reason: 'carrier', to: 'ephemeral', at: T(42), expiresAt: null,
  terminalEvidenceAt: null, runId: null, promotedSession: null, auditEvidence: null, lineageClose: null, lineageOpenRun: null, resolvesThrough: null, ...over,
} as DelegationJournalEntryV1);

/** A checkpoint the server built, and the journal it was built from (which a capture checks it against). */
export interface CarrierCheckpoint { name: string; checkpoint: DelegationCheckpointV1; records: DelegationJournalRecordV1[] }

/** Two leases folded by the server: `lease-1` attached with a resolution mark and then released `foreign` (so its carrier row holds
 *  `releaseReason` and `resolvedThrough`), and `lease-2` adopted and then put into transfer (its row holds `transferringSince` and
 *  `transferRun`). `released` is the checkpoint after lease-1's release only; `transferring` adds lease-2's transfer. */
export function carrierCheckpoints(): { released: CarrierCheckpoint; transferring: CarrierCheckpoint } {
  const evidence = chain(events.map((event) => ({ kind: 'evidence-accepted', event }) as DelegationJournalEntryV1));
  const cp0 = recoverDelegation(null, evidence).state.checkpoint;
  const activity = (agent: string): string => cp0.activities.find((a) => a.upstreamId === agent)!.activityId;
  const created = (leaseId: string, agent: string, n: number): DelegationJournalEntryV1 => {
    const activityId = activity(agent);
    return {
      kind: 'lease-created', leaseId, generation: 0, activityId, parentId: PARENT, parentIncarnation: INC, project: 'project-a',
      adminRecord: `wt-${n}`, canonicalPath: `/work/project-a/wt-${n}`, creationBase: null, sourceKind: n === 1 ? 'raw' : 'agent',
      correlationJournalIds: [], firstObservedAt: T(40), lineageId: deriveDelegationLineageId({ leaseId, parentId: PARENT, parentIncarnation: INC, activityId }),
    } as DelegationJournalEntryV1;
  };
  const leaseOne: DelegationJournalEntryV1[] = [
    created('lease-1', 'agent-carrier-x', 1), created('lease-2', 'agent-carrier-y', 2),
    transition({}),
    transition({ generation: 2, reason: 'attach', to: 'retained', at: T(50), expiresAt: plus7d(T(50)), resolvesThrough: { attemptedAt: T(45), attemptId: 'attempt-1' } }),
    { kind: 'lease-released', leaseId: 'lease-1', generation: 3, releaseReason: 'foreign', at: T(60), lastHeadSha: 'c'.repeat(40),
      resolvesThrough: { attemptedAt: T(55), attemptId: 'attempt-2' } } as DelegationJournalEntryV1,
  ];
  const leaseTwo: DelegationJournalEntryV1[] = [
    transition({ leaseId: 'lease-2', at: T(43) }),
    transition({ leaseId: 'lease-2', generation: 2, reason: 'adopt', to: 'adopted', at: T(70), terminalEvidenceAt: T(65), expiresAt: plus7d(T(70)) }),
    transition({ leaseId: 'lease-2', generation: 3, reason: 'transfer', to: 'transferring', at: T(75), runId: 11 }),
  ];
  const ready = (name: string, records: DelegationJournalRecordV1[]): CarrierCheckpoint => {
    const report = recoverDelegation(null, records);
    if (report.failure !== null || report.state.phase !== 'ready') throw new Error(`carrier fixture did not recover: ${JSON.stringify(report.failure)}`);
    return { name, checkpoint: { ...report.state.checkpoint, revision: 1 }, records };
  };
  const all = chain([...evidence.map((r) => r.entry), ...leaseOne, ...leaseTwo]);
  return { released: ready('a released lease', all.slice(0, evidence.length + leaseOne.length)), transferring: ready('a lease in transfer', all) };
}

/** `carrierCheckpoints()`, as the bytes the server's encoder writes. */
export const carrierCheckpointBytes = (): Uint8Array[] => {
  const { released, transferring } = carrierCheckpoints();
  return [encodeDelegationCheckpoint(released.checkpoint), encodeDelegationCheckpoint(transferring.checkpoint)];
};
