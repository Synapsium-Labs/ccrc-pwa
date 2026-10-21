// Delegation broker wave 3, run 645, D-5833: the checkpoint builder's fold allocates an activity's id IN PLACE.
//
// Two rows pin what `openFromCandidate` does with the builder's own mapping. R1 is the parity guard: a fixed journal folded through the
// builder yields the same canonical checkpoint bytes and the same activity IDs as before the change (the digests were taken at main and
// are pinned here); it is green by design on the old code and red when the in-place function stops writing `mapping[encoded]`. R2 is the
// cost guard: 1,000 opening records folded into a builder holding 40,000 mappings call `allocateDelegationActivityIdInto` 1,000 times,
// `restoreOrAllocateActivityId` never, and the builder's mapping keeps its object identity. The rows live in their own file so that a
// mutant that breaks the model function fails them as rows: `delegation-recovery.test.ts` runs recoveries while it collects, and fails
// there before any row of it is measured. Every journal is in memory: nothing here touches a file or the live `~/.ccrc`.
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import {
  delegationSha256Hex,
  emptyDelegationCheckpoint,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';
import { buildDelegationJournalRecord } from '../src/coord/delegation-journal.js';
import { DelegationCheckpointBuilder, encodeDelegationCheckpoint } from '../src/coord/delegation-checkpoint.js';
import * as modelNs from '../src/coord/delegation-model.js';

const PARENT = 'lane-a-demo';
const INC = 'g1';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const X = 'agent-abc123';
const Y = 'agent-def456';
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + s * 1000);
const eid = (n: number): string => delegationSha256Hex(`fixture-event-${n}`);
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

const base = (n: number, over: { sessionId?: string; parentIncarnation?: string } = {}) => ({
  v: 1 as const, observedAt: T(n), sessionId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, claudeSessionId: CLAUDE,
  eventId: eid(n), bucket: '2026101400', startOffset: n * 100, endOffset: n * 100 + 99,
});
type Over = { sessionId?: string; parentIncarnation?: string };
const sessionStart = (n: number, over: Over = {}): DelegationEventEnvelopeV1 => ({ ...base(n, over), eventKind: 'SessionStart', source: 'startup' });
/** A tool event inside a subagent: it names the agent only through the common `agentId` field. NOT a qualifying join. */
const bareTool = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', agentId });
const subagentStart = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'SubagentStart', agentId, agentType: null });
const subagentStop = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'SubagentStop', agentId, agentType: null, agentTranscriptPath: null });
const agentLaunch = (n: number, agentId: string, status: 'async-launched' | 'completed' = 'async-launched', over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PostToolUse', toolName: 'Agent', toolUseId: `toolu_${n}`, outcome: status, launch: { status, agentId, isAsync: status === 'async-launched' } });

/** A chain of evidence records from sequence 1, each accepted at an instant that is NOT its event's observation time. */
const evidenceChain = (events: readonly DelegationEventEnvelopeV1[]): DelegationJournalRecordV1[] => {
  const out: DelegationJournalRecordV1[] = [];
  let prev: string | null = null;
  events.forEach((event, i) => {
    const entry: DelegationJournalEntryV1 = { kind: 'evidence-accepted', event };
    const r = buildDelegationJournalRecord({ sequence: 1 + i, acceptedAt: T(100000 + 1 + i), previousDigest: prev, entry });
    out.push(r);
    prev = r.digest;
  });
  return out;
};
const keyOf = (agentId: string, over: Over = {}) => ({ parentId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, sourceKind: 'agent' as const, upstreamId: agentId });

describe('D-5833: the fold writes an opened activity\'s id into the builder\'s own mapping', () => {
  const RUN = 'wf_run1';
  const workflowLaunch = (n: number): DelegationEventEnvelopeV1 => ({
    ...base(n), eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId: `toolu_wf${n}`, outcome: 'async-launched',
    launch: { status: 'async-launched', taskId: `task_${n}`, taskType: 'local_workflow', workflowName: 'review-pass', runId: RUN, transcriptDir: `/work/t/${RUN}`, scriptPath: '/work/s.js' },
  });
  const LATE = 'agent-late77';
  const OTHER_LANE = { sessionId: 'lane-b-demo' };
  /** A fixed journal: a join that opens at once (SubagentStart), an agent only a bare tool event names (opened later by a meta), an async
   *  launch, a workflow run (and its two workers, opened by metas), a stop, and a second session's agent. */
  const FIXTURE_EVENTS: DelegationEventEnvelopeV1[] = [
    sessionStart(1), subagentStart(2, X), bareTool(3, Y), agentLaunch(4, 'agent-zzz999'), workflowLaunch(5), subagentStop(6, X),
    sessionStart(7, OTHER_LANE), subagentStart(8, 'agent-b1', OTHER_LANE), bareTool(9, LATE), agentLaunch(10, 'agent-zzz999', 'completed'),
  ];
  const digestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

  it('D-5833 R1: PARITY — the built checkpoint\'s canonical bytes and every activityId are what the fold produced before the change', () => {
    const records = evidenceChain(FIXTURE_EVENTS);
    const b = DelegationCheckpointBuilder.from(emptyDelegationCheckpoint());
    for (const r of records) b.foldRecord(r);
    expect(b.openFromMeta(PARENT, INC, Y).kind).toBe('opened');
    expect(b.openFromMeta(PARENT, INC, LATE).kind).toBe('opened');
    expect(b.openWorkflowWorkerFromMeta(PARENT, INC, RUN, 0).kind).toBe('opened');
    expect(b.openWorkflowWorkerFromMeta(PARENT, INC, RUN, 1).kind).toBe('opened');
    expect(b.openFromMeta(PARENT, INC, Y).kind, 'a second open of a mapped key is a hit').toBe('already-open');
    const cp = b.build(1);
    expect(cp.activities).toHaveLength(8);
    expect(Object.keys(cp.activityIdsByNaturalKey)).toHaveLength(8);
    // The digests were computed AT MAIN, before D-5833's change, by this very fold, and pinned here.
    expect(digestOf(encodeDelegationCheckpoint(cp)), 'the checkpoint\'s canonical bytes').toBe('c777160bc4b603dc728bddea60600645c35e3a9d72094904577fb94070d40f81');
    expect(sha(cp.activities.map((a) => a.activityId).join('\n')), 'every activityId, in checkpoint order').toBe('32d8c411a689772296f3508fed44bcae932f4d36fc9aae226fe5ff2906d26d68');
  });

  it('D-5833 R2: NO COPY PER OPEN — 1,000 opening records into a builder holding 40,000 mappings never re-copy the mapping', () => {
    const mapping: Record<string, string> = {};
    for (let i = 0; i < 40_000; i++) mapping[`synthetic-key-${i}`] = sha(`synthetic-activity-${i}`);
    const b = DelegationCheckpointBuilder.from({ ...emptyDelegationCheckpoint(), activityIdsByNaturalKey: mapping });
    const mappingOf = (x: DelegationCheckpointBuilder): Record<string, string> => (x as unknown as { mapping: Record<string, string> }).mapping;
    const held = mappingOf(b);
    expect(Object.keys(held)).toHaveLength(40_000);
    const records = evidenceChain(Array.from({ length: 1000 }, (_, i) => subagentStart(i + 1, `agent-open-${i}`)));

    // A counting call-through, not a bare `vi.spyOn`: a spy RETAINS every call's result, and each result of the old function carries
    // its own 40,000-key copy of the mapping, so a bare spy would hold 1,000 copies and exhaust the worker's heap before it counted.
    const counted = (name: 'restoreOrAllocateActivityId' | 'allocateDelegationActivityIdInto'): { calls: () => number; restore: () => void } | null => {
      const ns = modelNs as unknown as Record<string, (...a: unknown[]) => unknown>;
      const real = ns[name];
      // `allocateDelegationActivityIdInto` does not exist before D-5833: spy only when it does, so this row fails on its own count
      // assertion below and not on `spyOn` throwing.
      if (typeof real !== 'function') return null;
      let n = 0;
      const spy = vi.spyOn(ns, name).mockImplementation((...a: unknown[]) => { spy.mockClear(); n++; return real(...a); });
      return { calls: () => n, restore: () => spy.mockRestore() };
    };
    const oldFn = counted('restoreOrAllocateActivityId')!;
    const inPlace = counted('allocateDelegationActivityIdInto');
    try {
      for (const r of records) b.foldRecord(r);
      expect(oldFn.calls(), 'restoreOrAllocateActivityId calls (it copies the whole mapping)').toBe(0);
      expect(inPlace?.calls() ?? 0, 'allocateDelegationActivityIdInto calls, one per opened activity').toBe(1000);
      expect(mappingOf(b), 'the builder\'s mapping keeps its object identity across the fold').toBe(held);
      expect(Object.keys(held)).toHaveLength(41_000);
      for (const i of [0, 499, 999]) {
        const id = modelNs.deriveDelegationActivityId(keyOf(`agent-open-${i}`), records[i]!.journalId);
        expect(held[encodeDelegationNaturalKey(keyOf(`agent-open-${i}`))], `agent-open-${i}`).toBe(id);
        expect(b.activityOf(id)?.upstreamId).toBe(`agent-open-${i}`);
      }
    } finally {
      oldFn.restore();
      inPlace?.restore();
    }
  }, 300_000);
});
