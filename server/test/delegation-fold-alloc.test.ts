// Delegation broker wave 3, run 645, D-5833: the checkpoint builder's fold allocates an activity's id IN PLACE.
//
// Two rows pin what `openFromCandidate` does with the builder's own mapping. R1 is the parity guard: a fixed journal folded through the
// builder yields the same canonical checkpoint bytes and the same activity IDs as before the change (the digests were taken at main and
// are pinned here); it is green by design on the old code and red when the in-place function stops writing `mapping[encoded]`. R2 is the
// cost guard: 1,000 opening records folded into a builder holding 40,000 mappings call `allocateDelegationActivityIdInto` 1,000 times,
// `restoreOrAllocateActivityId` never, and the builder's mapping keeps its object identity. The rows live in their own file so that a
// mutant that breaks the model function fails them as rows: `delegation-recovery.test.ts` runs recoveries while it collects, and fails
// there before any row of it is measured. Every journal is in memory: nothing here touches a file or the live `~/.ccrc`.
//
// Run 762 adds the builder-level rows of the Bash-call facts (D-6267, D-6268) and the two fold-cost rows: RB11, RB12, RB12b, RB12c, RB13,
// RB-CLONE and RB-COST (the Bash map), and D-SC-COST (the stop-candidate ageing, D-6270). Everything new is reached through casts, so
// each row fails on its own assertion at a build that has not got the member yet.
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import {
  delegationIntentKey,
  delegationSha256Hex,
  deriveDelegationActivityId,
  deriveDelegationLineageId,
  emptyDelegationCheckpoint,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';
import { buildDelegationJournalRecord } from '../src/coord/delegation-journal.js';
import { DelegationCheckpointBuilder, encodeDelegationCheckpoint, recoverDelegation } from '../src/coord/delegation-checkpoint.js';
import * as modelNs from '../src/coord/delegation-model.js';
import { oldRuleCheckpoint } from './delegationOldRuleFixture.js';

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

// ── Run 762: the builder's Bash-call facts, its clone census and the fold's cost ──────────────────────────────────────────────────────
//
// Journal time only: every chain below is built by `chainAt` over `buildDelegationJournalRecord` with an explicit acceptance instant in
// ms, from a literal origin. The two horizons are read from the model namespace, falling back to the ruled literal ONLY so that these rows
// run (and fail on their own assertions) at a build that does not export them yet.
const A0 = Date.UTC(2026, 9, 14, 12);
const BOUND: number = (modelNs as unknown as { DELEGATION_BASH_PENDING_MS?: number }).DELEGATION_BASH_PENDING_MS ?? 3_600_000;
const HORIZON: number = (modelNs as unknown as { DELEGATION_STOP_CANDIDATE_HORIZON_MS?: number }).DELEGATION_STOP_CANDIDATE_HORIZON_MS ?? 172_800_000;

/** A chain of journal entries from sequence 1 (or after `after`), each accepted at the given instant in epoch ms. */
const chainEntriesAt = (entries: readonly (readonly [DelegationJournalEntryV1, number])[], after?: DelegationJournalRecordV1): DelegationJournalRecordV1[] => {
  const out: DelegationJournalRecordV1[] = [];
  let prev: string | null = after?.digest ?? null;
  let seq = (after?.sequence ?? 0) + 1;
  for (const [entry, ms] of entries) {
    const r = buildDelegationJournalRecord({ sequence: seq++, acceptedAt: formatDelegationInstant(ms), previousDigest: prev, entry });
    out.push(r);
    prev = r.digest;
  }
  return out;
};
/** The one chain shape of the ageing rows: evidence events, each with its own acceptance instant (never the event's observation time). */
const chainAt = (entries: readonly (readonly [DelegationEventEnvelopeV1, number])[], after?: DelegationJournalRecordV1): DelegationJournalRecordV1[] =>
  chainEntriesAt(entries.map(([event, ms]) => [{ kind: 'evidence-accepted', event } as DelegationJournalEntryV1, ms] as const), after);

const bashPre = (n: number, toolUseId: string, listing?: readonly string[], over: Over & { truncated?: true } = {}): DelegationEventEnvelopeV1 => {
  const { truncated, ...rest } = over;
  return { ...base(n, rest), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId, ...(listing === undefined ? {} : { listing }), ...(truncated ? { truncated } : {}) };
};
const bashPost = (n: number, toolUseId: string, listing?: readonly string[], over: Over & { truncated?: true } = {}): DelegationEventEnvelopeV1 => {
  const { truncated, ...rest } = over;
  return { ...base(n, rest), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId, outcome: 'completed', ...(listing === undefined ? {} : { listing }), ...(truncated ? { truncated } : {}) };
};
const wfLaunchAt = (n: number, runId: string, taskId: string, toolUseId: string): DelegationEventEnvelopeV1 => ({
  ...base(n), eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId, outcome: 'async-launched',
  launch: { status: 'async-launched', taskId, taskType: 'local_workflow', workflowName: 'review-pass', runId, transcriptDir: `/work/t/${runId}`, scriptPath: '/work/s.js' },
});
const notificationAt = (n: number, toolUseId: string, taskId: string): DelegationEventEnvelopeV1 =>
  ({ ...base(n), eventKind: 'UserPromptSubmit', notification: { taskId, toolUseId, status: 'completed' } });
const bashKey = (toolUseId: string, over: Over = {}): string =>
  encodeDelegationNaturalKey({ parentId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, sourceKind: 'bash-worktree', upstreamId: toolUseId });

/** The Bash-call fact as the task text types it: 'pre' (a measured PreToolUse with no decision yet) or 'equal' (that Pre, then a Post naming the same records). */
type BashFact =
  | { kind: 'pre'; journalId: string; sequence: number; observedAt: string; lastObservedAt: string; listing: readonly string[]; acceptedAtMs: number }
  | { kind: 'equal'; preJournalId: string };
/** The builder members run 762 adds, reached by cast: absent at base, where the row's first assertion says so. */
interface BashFactSurface {
  bashCallFactOf?: (encoded: string) => BashFact | undefined;
  bashCallFactCount?: () => number;
  retirableZeroDeltaBash?: () => string[];
}
const surfaceOf = (b: DelegationCheckpointBuilder): BashFactSurface => b as unknown as BashFactSurface;
const factOf = (b: DelegationCheckpointBuilder, encoded: string): BashFact | undefined => {
  const fn = surfaceOf(b).bashCallFactOf;
  expect(typeof fn, 'DelegationCheckpointBuilder.bashCallFactOf is a method (D-6267)').toBe('function');
  return fn!.call(b, encoded);
};
const factCount = (b: DelegationCheckpointBuilder): number => {
  const fn = surfaceOf(b).bashCallFactCount;
  expect(typeof fn, 'DelegationCheckpointBuilder.bashCallFactCount is a method (D-6267)').toBe('function');
  return fn!.call(b);
};
const retirable = (b: DelegationCheckpointBuilder): string[] => {
  const fn = surfaceOf(b).retirableZeroDeltaBash;
  expect(typeof fn, 'DelegationCheckpointBuilder.retirableZeroDeltaBash is a method (D-6268)').toBe('function');
  return fn!.call(b);
};

/** A builder over LEGACY stock (`oldRuleCheckpoint`, never the new fold alone): `covered` events become the old rule's rows, every covered
 *  record is then observed as recovery does (unless `observe` is false), and the `suffix` records are returned to be folded by the row. */
function legacyBuilder(covered: readonly DelegationEventEnvelopeV1[], suffix: readonly DelegationEventEnvelopeV1[], observe = true) {
  const all = chainAt([...covered, ...suffix].map((e, i) => [e, A0 + i * 1000] as const));
  const coveredRecs = all.slice(0, covered.length);
  const suffixRecs = all.slice(covered.length);
  const cp = oldRuleCheckpoint(coveredRecs);
  const b = DelegationCheckpointBuilder.from(cp);
  if (observe) for (const r of coveredRecs) b.observeRecord(r);
  return { b, cp, coveredRecs, suffixRecs };
}
/** A builder from nothing that folds every event (an UNMAPPED world). */
function foldedBuilder(events: readonly DelegationEventEnvelopeV1[], gapMs = 1000) {
  const records = chainAt(events.map((e, i) => [e, A0 + i * gapMs] as const));
  const b = DelegationCheckpointBuilder.from(emptyDelegationCheckpoint());
  for (const r of records) b.foldRecord(r);
  return { b, records };
}

describe('RB11: the Bash-call fact table at builder level (D-6267 (a) 7 on a mapped key, (a) 6 on an unmapped one)', () => {
  const K = bashKey('toolu_k');
  const P = (listing: readonly string[]) => [sessionStart(1), bashPre(2, 'toolu_k', listing)];
  interface Case { name: string; run: () => void }
  const mapped = (preListing: readonly string[], suffix: readonly DelegationEventEnvelopeV1[], observe = true) => {
    const w = legacyBuilder(P(preListing), suffix, observe);
    expect(w.cp.activityIdsByNaturalKey[K], 'the legacy stock maps K to the old rule\'s row (identity: its Pre)').toBeDefined();
    return w;
  };
  const CASES: Case[] = [
    { name: '(i) mapped K: the identity Pre P is a pre fact with P\'s journalId, sequence and listing', run: () => {
      const { b, coveredRecs } = mapped(['a', 'b'], []);
      expect(factOf(b, K)).toMatchObject({ kind: 'pre', journalId: coveredRecs[1]!.journalId, sequence: 2, listing: ['a', 'b'] });
    } },
    { name: '(ii) mapped K: a listing Pre that is not the identity, with no entry, makes no fact', run: () => {
      const { b, suffixRecs } = mapped(['a', 'b'], [bashPre(3, 'toolu_k', ['a', 'b'])], false);
      for (const r of suffixRecs) b.foldRecord(r);
      expect(factOf(b, K)).toBeUndefined();
    } },
    { name: '(iii) after (i), a Post naming the same set in another order is an equal fact (preJournalId P)', run: () => {
      const { b, coveredRecs, suffixRecs } = mapped(['a', 'b'], [bashPost(3, 'toolu_k', ['b', 'a'])]);
      for (const r of suffixRecs) b.foldRecord(r);
      expect(factOf(b, K)).toEqual({ kind: 'equal', preJournalId: coveredRecs[1]!.journalId });
    } },
    { name: '(iv) a Post naming one name twice is an equal fact (set semantics)', run: () => {
      const { b, coveredRecs, suffixRecs } = mapped(['a'], [bashPost(3, 'toolu_k', ['a', 'a'])]);
      for (const r of suffixRecs) b.foldRecord(r);
      expect(factOf(b, K)).toEqual({ kind: 'equal', preJournalId: coveredRecs[1]!.journalId });
    } },
    { name: '(v) a Post with no listing spoils the fact', run: () => {
      const { b, suffixRecs } = mapped(['a', 'b'], [bashPost(3, 'toolu_k')]);
      for (const r of suffixRecs) b.foldRecord(r);
      expect(factOf(b, K)).toBeUndefined();
    } },
    { name: '(vi) a truncated Post spoils the fact', run: () => {
      const { b, suffixRecs } = mapped(['a', 'b'], [bashPost(3, 'toolu_k', undefined, { truncated: true })]);
      for (const r of suffixRecs) b.foldRecord(r);
      expect(factOf(b, K)).toBeUndefined();
    } },
    { name: '(vii) a Post that adds a name spoils the fact', run: () => {
      const { b, suffixRecs } = mapped(['a', 'b'], [bashPost(3, 'toolu_k', ['a', 'b', 'c'])]);
      for (const r of suffixRecs) b.foldRecord(r);
      expect(factOf(b, K)).toBeUndefined();
    } },
    { name: '(viii) a Post that removes a name spoils the fact', run: () => {
      const { b, suffixRecs } = mapped(['a', 'b'], [bashPost(3, 'toolu_k', ['a'])]);
      for (const r of suffixRecs) b.foldRecord(r);
      expect(factOf(b, K)).toBeUndefined();
    } },
    { name: '(ix) after (i), a second Pre spoils the fact', run: () => {
      const { b, suffixRecs } = mapped(['a', 'b'], [bashPre(3, 'toolu_k', ['a', 'b'])]);
      expect(factOf(b, K), 'the fact stands before the second Pre').toMatchObject({ kind: 'pre' });
      for (const r of suffixRecs) b.foldRecord(r);
      expect(factOf(b, K)).toBeUndefined();
    } },
    { name: '(x-a) an equal fact then any later record (a Post) is gone', run: () => {
      const { b, suffixRecs } = mapped(['a', 'b'], [bashPost(3, 'toolu_k', ['a', 'b']), bashPost(4, 'toolu_k', ['a', 'b'])]);
      b.foldRecord(suffixRecs[0]!);
      expect(factOf(b, K), 'the first Post makes it equal').toMatchObject({ kind: 'equal' });
      b.foldRecord(suffixRecs[1]!);
      expect(factOf(b, K)).toBeUndefined();
    } },
    { name: '(x-b) an equal fact then any later record (a Pre) is gone', run: () => {
      const { b, suffixRecs } = mapped(['a', 'b'], [bashPost(3, 'toolu_k', ['a', 'b']), bashPre(4, 'toolu_k', ['a', 'b'])]);
      b.foldRecord(suffixRecs[0]!);
      expect(factOf(b, K), 'the Post makes it equal').toMatchObject({ kind: 'equal' });
      b.foldRecord(suffixRecs[1]!);
      expect(factOf(b, K)).toBeUndefined();
    } },
    { name: '(xi) unmapped U: a listing Pre is a pre fact', run: () => {
      const U = bashKey('toolu_u');
      const { b, records } = foldedBuilder([sessionStart(1), bashPre(2, 'toolu_u', ['a'])]);
      expect(factOf(b, U)).toMatchObject({ kind: 'pre', journalId: records[1]!.journalId, sequence: 2, listing: ['a'] });
    } },
    { name: '(xii) unmapped U: a truncated Pre makes no fact', run: () => {
      const { b } = foldedBuilder([sessionStart(1), bashPre(2, 'toolu_u', undefined, { truncated: true })]);
      expect(factOf(b, bashKey('toolu_u'))).toBeUndefined();
    } },
    { name: '(xiii) unmapped U: a Post with a listing and no entry opens a row (the Post is the identity) and leaves no fact', run: () => {
      const { b, records } = foldedBuilder([sessionStart(1), bashPost(2, 'toolu_u', ['a'])]);
      expect(factOf(b, bashKey('toolu_u'))).toBeUndefined();
      const rows = b.build(1).activities;
      expect(rows.map((r) => [r.upstreamId, r.identityJournalId, r.executionState])).toEqual([['toolu_u', records[1]!.journalId, 'ended']]);
    } },
  ];
  it.each(CASES)('RB11: $name', ({ run }) => { run(); });
});

describe('RB12, RB12b, RB12c: the Bash map holds only what is pending, or waits on a mapped key (D-6267 (a) 12)', () => {
  it('RB12: 500 rule-A zero-delta calls and 500 listing-less Bash calls leave no fact and no activity (mutant MB14)', () => {
    const events: DelegationEventEnvelopeV1[] = [];
    let n = 0;
    for (let i = 0; i < 500; i++) events.push(bashPre(++n, `toolu_z${i}`, ['a']), bashPost(++n, `toolu_z${i}`, ['a']));
    for (let i = 0; i < 500; i++) events.push(bashPre(++n, `toolu_q${i}`), bashPost(++n, `toolu_q${i}`));
    const { b } = foldedBuilder(events, 500);                 // 2,000 records over 1,000 s: inside the bound
    expect(factCount(b), 'bashCallFactCount after 500 zero-delta pairs and 500 listing-less pairs').toBe(0);
    expect(b.build(1).activities, 'no activity opens').toHaveLength(0);
  });

  it('RB12b: 500 pending Pre-only calls age out at the bound, with their holds (mutant MA9)', () => {
    const events: [DelegationEventEnvelopeV1, number][] = [];
    for (let i = 0; i < 500; i++) events.push([bashPre(i + 1, `toolu_p${i}`, ['a']), A0]);
    const keys = new Set(Array.from({ length: 500 }, (_, i) => bashKey(`toolu_p${i}`)));
    const bashHolds = (b: DelegationCheckpointBuilder): number =>
      b.build(1).pruningHolds.filter((h) => h.reason === 'identity-candidate' && keys.has(h.ownerId)).length;
    const records = chainAt(events);
    const b = DelegationCheckpointBuilder.from(emptyDelegationCheckpoint());
    for (const r of records) b.foldRecord(r);
    expect(factCount(b), 'all 500 are pending before the bound').toBe(500);
    expect(bashHolds(b), 'and each holds its Pre').toBe(500);
    // a filler of another owner, accepted one ms short of the bound: still pending; at the bound: forgotten
    const [justShort, atBound] = chainAt([[sessionStart(900, { sessionId: 'lane-b-demo' }), A0 + BOUND - 1], [sessionStart(901, { sessionId: 'lane-b-demo' }), A0 + BOUND]], records[records.length - 1]);
    b.foldRecord(justShort!);
    expect(factCount(b), 'one ms short of the bound').toBe(500);
    b.foldRecord(atBound!);
    expect(factCount(b), 'at the bound every Pre is forgotten').toBe(0);
    expect(bashHolds(b), 'and no bash identity-candidate hold remains').toBe(0);
  });

  it('RB12c: a Post-only rule-A row never gets an equal fact from a later duplicate Pre and equal Post, so the door retires nothing (mutant MB-start)', () => {
    const { b } = foldedBuilder([sessionStart(1), bashPost(2, 'toolu_x', ['a']), bashPre(3, 'toolu_x', ['a']), bashPost(4, 'toolu_x', ['a'])]);
    expect(b.build(1).activities.map((r) => r.upstreamId), 'the Post-only call opened one row').toEqual(['toolu_x']);
    expect(factCount(b), 'no fact for the mapped key').toBe(0);
    expect(retirable(b), 'the door has nothing to retire').toEqual([]);
  });
});

describe('RB13: a clone owns its Bash facts', () => {
  it('RB13: folding K\'s equal Post on a clone leaves the original at pre (mutant MA14)', () => {
    const K = bashKey('toolu_k');
    const { b, coveredRecs, suffixRecs } = legacyBuilder([sessionStart(1), bashPre(2, 'toolu_k', ['a'])], [bashPost(3, 'toolu_k', ['a'])]);
    expect(factOf(b, K), 'the identity Pre of the legacy row is a pre fact').toMatchObject({ kind: 'pre', journalId: coveredRecs[1]!.journalId });
    const c = b.clone();
    c.foldRecord(suffixRecs[0]!);
    expect(factOf(b, K), 'the original still holds its pre').toMatchObject({ kind: 'pre' });
    expect(factOf(c, K), 'the clone moved to equal').toEqual({ kind: 'equal', preJournalId: coveredRecs[1]!.journalId });
  });
});

describe('RB-CLONE: clone() and replaceRows() carry every collection of the builder (the clone census)', () => {
  const Z = 'agent-ghi789';
  /** The 17 collections `clone()` copies (the four newest: bashCalls, bashDue, stopDue, workflowLaunches). */
  const COLLECTIONS = [
    'sessions', 'attempts', 'activities', 'mapping', 'intent', 'leases', 'lineage', 'cursors', 'intervals', 'candidates', 'leaseFacts',
    'leaseByIdentity', 'leaseByPath', 'bashCalls', 'bashDue', 'stopDue', 'workflowLaunches',
  ].sort();
  const SCALARS = ['appliedSequence', 'appliedJournalId', 'appliedDigest', 'revisionNo', 'coveredEnds'];
  const collectionsOf = (b: DelegationCheckpointBuilder): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [name, v] of Object.entries(b)) {
      if (v instanceof Map || Array.isArray(v) || (typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype)) out[name] = v;
    }
    return out;
  };
  const scalarsOf = (b: DelegationCheckpointBuilder): Record<string, unknown> => {
    const entries = Object.entries(b) as [string, unknown][];
    return Object.fromEntries(SCALARS.map((k) => [k, entries.find(([n]) => n === k)?.[1]]));
  };
  const sizeOf = (v: unknown): number => (v instanceof Map ? v.size : Array.isArray(v) ? v.length : Object.keys(v as object).length);

  /** A builder whose every collection is non-empty, and which has ended a workflow run from a covered task notification. */
  function populated(): DelegationCheckpointBuilder {
    // Covered: a session, a Workflow launch and the run's completed notification. The checkpoint is the one the launch alone would have
    // left (the run active), so observing the notification ends the run and counts it (D-6269).
    const covered = chainAt([
      [sessionStart(1), A0], [wfLaunchAt(2, 'wf_run1', 'task_1', 'toolu_wf1'), A0 + 1000], [notificationAt(3, 'toolu_wf1', 'task_1'), A0 + 2000],
    ]);
    const cp0 = recoverDelegation(null, covered).state.checkpoint;
    const stale = { ...cp0, activities: cp0.activities.map((a) => (a.sourceKind === 'workflow' ? { ...a, executionState: 'active' as const, endedAt: null, lastEventAt: T(2) } : a)) };
    const b = DelegationCheckpointBuilder.from(stale);
    for (const r of covered) b.observeRecord(r);
    // Folded: an agent that opens, a bare occurrence of another (a candidate), a start-less stop (a stop-only candidate) and a pending Bash Pre.
    const evidence = chainAt([
      [subagentStart(4, X), A0 + 3000], [bareTool(5, Y), A0 + 4000], [subagentStop(6, Z), A0 + 5000], [bashPre(7, 'toolu_pend', ['main-wt']), A0 + 6000],
    ], covered[covered.length - 1]);
    for (const r of evidence) b.foldRecord(r);
    // A lease on the opened agent, through a real lease-created record: leases, lineage, leaseFacts, leaseByIdentity and leaseByPath.
    const activityId = deriveDelegationActivityId(keyOf(X), evidence[0]!.journalId);
    const leaseId = 'lease-1';
    const [lease] = chainEntriesAt([[{
      kind: 'lease-created', leaseId, generation: 0, activityId, parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-1',
      canonicalPath: '/work/project-a/wt-1', creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: T(8),
      lineageId: deriveDelegationLineageId({ leaseId, parentId: PARENT, parentIncarnation: INC, activityId }),
    } as DelegationJournalEntryV1, A0 + 7000]], evidence[evidence.length - 1]);
    b.foldRecord(lease!);
    b.setCursor({ sessionId: PARENT, parentIncarnation: INC, bucket: '2026101412', cursor: 4096, lastSize: 4096, lastCompleteAt: T(8), intervalState: 'measured', detail: null, anchor: null, replaced: false });
    b.mergeInterval({ sessionId: PARENT, parentIncarnation: INC, utcHour: formatDelegationInstant(A0), state: 'measured', detail: null, recordedAt: T(8) });
    // An attempt and the coordinator intent: checkpoint-only state, which only a replacement of the rows can bring in.
    const built = b.build(2);
    b.replaceRows({
      ...built,
      attempts: [{ attemptId: 'attempt-1', parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-1', canonicalPath: null, attemptedAt: T(8),
        rung: null, verdict: 'unresolved', evidenceJournalIds: [], detail: null }],
      coordinatorIntentByParent: { [delegationIntentKey(PARENT, INC)]: T(5) },
      sessions: built.sessions.map((s) => ({ ...s, explicitIntentAt: T(5), effective: true, effectiveBasis: ['explicit' as const] })),
    });
    return b;
  }

  it('RB-CLONE: (i) clone() copies each of the 17 collections as a new object equal by value, and the scalars by value (mutants MCL(F))', () => {
    const b = populated();
    const own = collectionsOf(b);
    expect(Object.keys(own).sort(), 'the builder\'s Map, Array and plain-object fields are exactly the 17 collections clone() must copy').toEqual(COLLECTIONS);
    for (const name of COLLECTIONS) expect(sizeOf(own[name]), `the fixture fills ${name}`).toBeGreaterThan(0);
    const coveredEnds = scalarsOf(b)['coveredEnds'];
    expect(typeof coveredEnds === 'number' && coveredEnds > 0, `coveredEnds (${String(coveredEnds)}) counts the run a covered notification ended`).toBe(true);
    const c = b.clone();
    const copy = collectionsOf(c);
    expect(Object.keys(copy).sort(), 'the clone has the same collection fields').toEqual(COLLECTIONS);
    for (const name of COLLECTIONS) {
      expect(copy[name], `clone().${name} equals the original by value`).toEqual(own[name]);
      expect(copy[name], `clone().${name} is a new object, not the original's`).not.toBe(own[name]);
    }
    expect(scalarsOf(c), 'the scalars are carried by value').toEqual(scalarsOf(b));
  });

  it('RB-CLONE: (ii) replaceRows(build()) keeps each journal-derived field equal by value (mutants MCL-r(F))', () => {
    const b = populated();
    expect(Object.keys(collectionsOf(b)).sort(), 'the builder\'s collection fields are exactly the 17 named').toEqual(COLLECTIONS);
    const FIELDS = ['candidates', 'leaseFacts', 'bashCalls', 'bashDue', 'stopDue', 'workflowLaunches'];
    const before = collectionsOf(b);
    const snapshot = Object.fromEntries(FIELDS.map((f) => [f, structuredClone(before[f])]));
    for (const f of FIELDS) expect(sizeOf(before[f]), `the fixture fills ${f}`).toBeGreaterThan(0);
    b.replaceRows(b.build(3));
    const after = collectionsOf(b);
    for (const f of FIELDS) expect(after[f], `replaceRows keeps ${f}`).toEqual(snapshot[f]);
  });
});

/** A Map that counts every entry its iterators yield: the D-5833 rig, for a collection the fold must never scan. */
class CountingMap<K, V> extends Map<K, V> {
  yielded = 0;
  override *[Symbol.iterator](): MapIterator<[K, V]> { for (const e of super[Symbol.iterator]()) { this.yielded++; yield e; } }
  override *entries(): MapIterator<[K, V]> { for (const e of super.entries()) { this.yielded++; yield e; } }
  override *keys(): MapIterator<K> { for (const k of super.keys()) { this.yielded++; yield k; } }
  override *values(): MapIterator<V> { for (const v of super.values()) { this.yielded++; yield v; } }
  override forEach(cb: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void { for (const [k, v] of this) cb.call(thisArg, v, k, this); }
}

describe('RB-COST and D-SC-COST: the fold pops due entries and never scans a map per record', () => {
  it('RB-COST: 20,000 equal facts and 5,000 pending Pres in a builder, then 20,000 fillers: the Bash map is never scanned per record (mutant MA-scan)', () => {
    const PAIRS = 20_000;
    const PRE_ONLY = 5_000;
    const FILLERS = 20_000;
    let n = 0;
    let ms = A0;
    const covered: [DelegationEventEnvelopeV1, number][] = [[sessionStart(++n), ms]];
    for (let i = 0; i < PAIRS; i++) covered.push([bashPre(++n, `toolu_e${i}`, ['a']), (ms += 10)], [bashPost(++n, `toolu_e${i}`, ['a']), (ms += 10)]);
    for (let i = 0; i < PRE_ONLY; i++) covered.push([bashPre(++n, `toolu_p${i}`, ['a']), (ms += 10)]);
    // every covered record is accepted within ~450 s of the first, inside the bound; the fillers start one bound after the LAST covered
    // record, so the 5,000 pending Pres all fall due at the first filler while the 20,000 equal pairs (decided within 10 ms) never age
    const fillerStart = ms + BOUND;
    const fillers: [DelegationEventEnvelopeV1, number][] = Array.from({ length: FILLERS }, (_, j): [DelegationEventEnvelopeV1, number] => [sessionStart(++n), fillerStart + 10 * (j + 1)]);
    const all = chainAt([...covered, ...fillers]);
    const coveredRecs = all.slice(0, covered.length);
    const fillerRecs = all.slice(covered.length);

    const cp = oldRuleCheckpoint(coveredRecs);
    expect(Object.keys(cp.activityIdsByNaturalKey), 'the legacy stock maps every listed Bash call').toHaveLength(PAIRS + PRE_ONLY);
    expect(cp.appliedJournalSequence, 'its applied position is the last covered record, so the first filler follows it').toBe(coveredRecs.length);
    const b = DelegationCheckpointBuilder.from(cp);
    const held = b as unknown as { bashCalls?: Map<string, BashFact> };
    expect(held.bashCalls instanceof Map, 'the builder has a bashCalls Map (D-6267)').toBe(true);
    const counting = new CountingMap<string, BashFact>(held.bashCalls);
    held.bashCalls = counting;

    for (const r of coveredRecs) b.observeRecord(r);
    for (const r of fillerRecs) b.foldRecord(r);

    const records = coveredRecs.length + fillerRecs.length;
    // Measured (2026-10-22, base bc231bbcb): 65,001 records (45,001 covered, 20,000 fillers); the legacy stock builds in the rows' setup and
    // is not part of the count. A due-heap ageing yields 0 entries on this path (nothing here iterates the map), so the bound is the
    // record count; a scan per record yields the 20,000 equal facts at every one of them, i.e. 20,000 x 65,001 = 1.3e9.
    expect(counting.yielded, `entries yielded by bashCalls' iterators over ${records} records`).toBeLessThanOrEqual(records);
    expect(counting.size, 'the 20,000 equal facts remain; the 5,000 pending Pres were forgotten').toBe(PAIRS);
    expect(factCount(b)).toBe(PAIRS);
    expect(factOf(b, bashKey('toolu_e0')), 'an equal pair').toMatchObject({ kind: 'equal' });
    expect(factOf(b, bashKey(`toolu_e${PAIRS - 1}`)), 'the last equal pair').toMatchObject({ kind: 'equal' });
    expect(factOf(b, bashKey('toolu_p0')), 'a pending Pre aged out at the first filler').toBeUndefined();
  }, 300_000);

  it('D-SC-COST: 10,000 early candidates (5,000 bare, 5,000 stop-only) in 50,000 records: observe 25,000 covered, fold 25,000 more; no candidate scan per record, and the stop-only ones age out (mutant MS-scan)', () => {
    const BARE = 5_000;
    const STOPS = 5_000;
    const TOTAL = 50_000;
    const HALF = 25_000;
    const events: [DelegationEventEnvelopeV1, number][] = [];
    for (let i = 1; i <= TOTAL; i++) {
      // records 1-10,000 create the candidates early; every later record is a session-start filler accepted one horizon after them, so the
      // first filler already finds all 5,000 stop-only candidates due (a bare occurrence never ages: the meta door needs it)
      if (i <= BARE) events.push([bareTool(i, `agent-bare-${i}`), A0 + i * 10]);
      else if (i <= BARE + STOPS) events.push([subagentStop(i, `agent-stop-${i}`), A0 + i * 10]);
      else events.push([sessionStart(i), A0 + HORIZON + i * 10]);
    }
    const all = chainAt(events);
    const firstHalf = all.slice(0, HALF);
    const secondHalf = all.slice(HALF);
    const recovered = recoverDelegation(null, firstHalf);
    expect(recovered.failure, 'the first half recovers').toBeNull();
    const b = DelegationCheckpointBuilder.from(recovered.state.checkpoint);
    expect(recovered.state.checkpoint.appliedJournalSequence).toBe(HALF);
    const held = b as unknown as { candidates: Map<string, unknown> };
    expect(held.candidates instanceof Map, 'the builder has a candidates Map').toBe(true);
    const counting = new CountingMap<string, unknown>(held.candidates);
    held.candidates = counting;

    // A counting call-through on the model's parser (as D-5833 R2 counts the allocator): a bare spy would retain every call.
    const ns = modelNs as unknown as Record<string, (...a: unknown[]) => unknown>;
    const real = ns['parseDelegationInstant']!;
    let parses = 0;
    const spy = vi.spyOn(ns, 'parseDelegationInstant').mockImplementation((...a: unknown[]) => { spy.mockClear(); parses++; return real(...a); });
    try {
      for (const r of firstHalf) b.observeRecord(r);
      for (const r of secondHalf) b.foldRecord(r);
    } finally {
      spy.mockRestore();
    }
    // Measured (2026-10-22, base bc231bbcb): 50,000 records; at base the fold reads no instant and scans no candidate map (yielded 0, parses
    // 0), and the 5,000 stop-only candidates never age (10,000 candidates remain). The bounds are the ruled ones: at the tip one parse per
    // record for `at`, one per popped candidate, a re-file at most one more.
    expect(counting.yielded, `entries yielded by candidates' iterators over ${TOTAL} records`).toBeLessThanOrEqual(TOTAL);
    expect(parses, `parseDelegationInstant calls over ${TOTAL} records and ${BARE + STOPS} candidates`).toBeLessThanOrEqual(4 * TOTAL + 2 * (BARE + STOPS));
    const keys = [...counting.keys()];
    expect(keys.filter((k) => k.includes('agent-stop-')), 'the 5,000 stop-only candidates aged out at the first filler').toHaveLength(0);
    expect(keys, 'the 5,000 bare candidates remain').toHaveLength(BARE);
    expect(keys.every((k) => k.includes('agent-bare-')), 'and they are the bare ones').toBe(true);
  }, 300_000);
});
