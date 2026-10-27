// Delegation broker wave 4, PR3: journal compaction (D-7000, D-7001, D-6999, D-7021; armed on landing, D-7022).
//
// The rows of the plan's "## PR3" Tasks 3.1 (the upkeep door, at the door; the lane's rows are delegation-compaction-lane.test.ts's),
// 3.2 (the pure planner), 3.3 (the crash-safe rewrite), 3.4 (the delete and the repair's step 0) and 3.5 (C1). Every file is in a FIXTURE
// directory and every SQLite is a fixture database: nothing here reads or writes the live `~/.ccrc`.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { parsedFile } from './scan/symbols.js';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import {
  DELEGATION_INTERVAL_RETENTION_HOURS,
  canonicalDelegationJson,
  deriveDelegationActivityId,
  deriveDelegationLineageId,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  type DelegationCheckpointV1,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';
import { DELEGATION_EVIDENCE_MARGIN_MS } from '../src/coord/delegation-correlation.js';
import {
  DELEGATION_CARRIED_FILE,
  DELEGATION_JOURNAL_FILE,
  DELEGATION_RETENTION_FLOOR_MS,
  buildDelegationJournalRecord,
  decodeDelegationJournalLine,
  encodeDelegationJournalRecord,
  nodeDelegationFilePort,
  parseDelegationJournal,
  type DelegationFileHandle,
  type DelegationFilePort,
} from '../src/coord/delegation-journal.js';
import {
  DELEGATION_CHECKPOINT_FILE,
  DELEGATION_COMPACTION_EDGES,
  DelegationDurability,
  encodeDelegationCheckpoint,
  delegationRecordNaming,
  recoverDelegation,
  recoverDelegationFromFiles,
  repairDelegationProjection,
  type DelegationCompactionOutcome,
  type DelegationDurabilityDeps,
  type DelegationDurabilityEdge,
  type DelegationProjectionPort,
} from '../src/coord/delegation-checkpoint.js';
import {
  DELEGATION_CARRY_REASONS,
  DELEGATION_COMPACTION_MIN_SHARE,
  DELEGATION_RAW_LEASE_WINDOW_MS,
  DelegationCompactionPlanner,
  isDelegationCompactionKebab,
  type DelegationCompactionPlan,
} from '../src/coord/delegation-compaction.js';

// ── fixtures: events at absolute instants ──────────────────────────────────────────────────────────────────────────────

const PARENT = 'lane-a-demo';
const INC = 'g1';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const D0 = Date.UTC(2026, 9, 1);
const iso = (ms: number): string => formatDelegationInstant(ms);
type Over = { sessionId?: string; parentIncarnation?: string };

let serial = 0;
const base = (ms: number, over: Over = {}) => {
  const n = ++serial;
  return {
    v: 1 as const, observedAt: iso(ms), sessionId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, claudeSessionId: CLAUDE,
    eventId: createHash('sha256').update(`compaction-event-${n}`).digest('hex'), bucket: '2026100100', startOffset: n * 100, endOffset: n * 100 + 99,
  };
};
const sessionStart = (ms: number, over: Over = {}): DelegationEventEnvelopeV1 => ({ ...base(ms, over), eventKind: 'SessionStart', source: 'startup' });
const subagentStart = (ms: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 => ({ ...base(ms, over), eventKind: 'SubagentStart', agentId, agentType: null });
const subagentStop = (ms: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(ms, over), eventKind: 'SubagentStop', agentId, agentType: null, agentTranscriptPath: null });
/** A tool event inside a subagent: it names the agent only through `agentId` (a bare occurrence, no join). */
const bareTool = (ms: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(ms, over), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_bare_${serial}`, outcome: 'completed', agentId });
const bashPre = (ms: number, toolUseId: string, listing?: readonly string[], over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(ms, over), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId, ...(listing === undefined ? {} : { listing }) });
const bashPost = (ms: number, toolUseId: string, listing?: readonly string[], over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(ms, over), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId, outcome: 'completed', ...(listing === undefined ? {} : { listing }) });
const wfLaunch = (ms: number, runId: string, taskId: string, toolUseId: string): DelegationEventEnvelopeV1 => ({
  ...base(ms), eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId, outcome: 'async-launched',
  launch: { status: 'async-launched', taskId, taskType: 'local_workflow', workflowName: 'review-pass', runId, transcriptDir: `/work/t/${runId}`, scriptPath: '/work/s.js' },
});
const notification = (ms: number, toolUseId: string, taskId: string, status: 'completed' | 'unknown' = 'completed'): DelegationEventEnvelopeV1 =>
  ({ ...base(ms), eventKind: 'UserPromptSubmit', notification: { taskId, toolUseId, status } });

const keyOf = (sourceKind: 'agent' | 'workflow' | 'bash-worktree', upstreamId: string, over: Over = {}) =>
  ({ parentId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, sourceKind, upstreamId });
const encodedOf = (sourceKind: 'agent' | 'workflow' | 'bash-worktree', upstreamId: string): string => encodeDelegationNaturalKey(keyOf(sourceKind, upstreamId));

// ── in-memory journals for the pure planner ────────────────────────────────────────────────────────────────────────────

type Entry = readonly [DelegationJournalEntryV1, number];
const ev = (event: DelegationEventEnvelopeV1, acceptedMs?: number): Entry =>
  [{ kind: 'evidence-accepted', event }, acceptedMs ?? Date.parse(event.observedAt) + 1000] as const;

/** A chain from sequence 1, each record accepted at its own instant. */
function chainOf(entries: readonly Entry[]): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev: string | null = null;
  entries.forEach(([entry, ms], i) => {
    const r = buildDelegationJournalRecord({ sequence: i + 1, acceptedAt: iso(ms), previousDigest: prev, entry });
    out.push(r);
    prev = r.digest;
  });
  return out;
}

/** A lease-created entry for an activity the chain so far opened. */
function leaseEntry(records: readonly DelegationJournalRecordV1[], kind: 'agent' | 'workflow' | 'bash-worktree', upstreamId: string, leaseId: string,
  over: { firstObservedMs: number; correlation?: readonly string[]; activityId?: string }): DelegationJournalEntryV1 {
  const identity = recoverDelegation(null, records).state.checkpoint.activities.find((a) => a.sourceKind === kind && a.upstreamId === upstreamId);
  const activityId = over.activityId ?? identity?.activityId ?? deriveDelegationActivityId(keyOf(kind, upstreamId), 'f'.repeat(64));
  return {
    kind: 'lease-created', leaseId, generation: 0, activityId, parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: `wt-${leaseId}`,
    canonicalPath: `/work/project-a/.claude/worktrees/${leaseId}`, creationBase: null, sourceKind: kind === 'bash-worktree' ? 'raw' : kind,
    correlationJournalIds: [...(over.correlation ?? [])], firstObservedAt: iso(over.firstObservedMs),
    lineageId: deriveDelegationLineageId({ leaseId, parentId: PARENT, parentIncarnation: INC, activityId }),
  };
}

/** The planner over an in-memory journal (no carried file), at `nowMs` with the 10-day floor unless told otherwise. */
function planOf(records: readonly DelegationJournalRecordV1[], opts: { nowMs: number; floorMs?: number; ready?: boolean; checkpoint?: DelegationCheckpointV1 }): DelegationCompactionPlan {
  const report = recoverDelegation(null, records);
  expect(report.failure, 'the fixture journal recovers').toBeNull();
  const planner = new DelegationCompactionPlanner({
    checkpoint: opts.checkpoint ?? report.state.checkpoint, ready: opts.ready ?? true, nowMs: opts.nowMs, floorMs: opts.floorMs ?? DELEGATION_RETENTION_FLOOR_MS,
    naming: delegationRecordNaming,
  });
  let offset = 0;
  for (const r of records) {
    const length = encodeDelegationJournalRecord(r).length;
    planner.add(r, { offset, length });
    offset += length;
  }
  return planner.finish(offset);
}
const carriedSeqs = (plan: DelegationCompactionPlan): number[] => plan.carried.map((l) => l.sequence);
const reasonsAt = (plan: DelegationCompactionPlan, seq: number): readonly string[] | undefined => plan.carried.find((l) => l.sequence === seq)?.reasons;

// ── Task 3.2: the planner (pure) ───────────────────────────────────────────────────────────────────────────────────────

describe('Task 3.2: the planner: the cut point S and the carried set (pure)', () => {
  it('the planner module names no filesystem, no SQLite, no clock and no randomness, and imports only the model and the shared vocabulary', () => {
    // read from the parse (ARCH-06: no literal source pin)
    const parsed = parsedFile('server/src/coord/delegation-compaction.ts');
    expect([...new Set(parsed.imports.map((i) => i.specifier))].sort()).toEqual(['../../../shared/api.js', './delegation-model.js']);
    expect(parsed.calls.map((c) => c.callee).filter((c) => /^(?:Date\.now|Math\.random|performance\.now|readFileSync|writeFileSync|setTimeout|setImmediate)$|randomUUID|^fsp\.|^fs\./.test(c))).toEqual([]);
  });

  it('W4-C4: records accepted from day 0 to day 12, now = day 12: S is the last record accepted at or before now - 10 d, limited by the floor', () => {
    const entries: Entry[] = [];
    for (let d = 0; d <= 12; d++) entries.push(ev(sessionStart(D0 + d * DAY)), ev(sessionStart(D0 + d * DAY + HOUR)));
    const records = chainOf(entries);
    const now = D0 + 12 * DAY + 2 * HOUR;
    const plan = planOf(records, { nowMs: now });
    const lastOld = records.filter((r) => Date.parse(r.acceptedAt) <= now - DELEGATION_RETENTION_FLOOR_MS).at(-1)!;
    expect(plan.cutThrough).toBe(lastOld.sequence);
    expect(plan.limitedBy).toBe('floor');
    expect(plan.cutRecords).toBe(lastOld.sequence);
    expect(plan.suffixOffset, 'the offset of record S+1').toBe(records.slice(0, lastOld.sequence).reduce((n, r) => n + encodeDelegationJournalRecord(r).length, 0));
    expect(plan.cutBytes).toBe(plan.suffixOffset);
  });

  it('W4-C4b (D-7000): the 10-day floor exceeds the lane\'s evidence horizon (192 h of interval retention plus the 20-minute margin)', () => {
    expect(DELEGATION_RETENTION_FLOOR_MS).toBe(10 * DAY);
    expect(DELEGATION_RETENTION_FLOOR_MS).toBeGreaterThan(DELEGATION_INTERVAL_RETENTION_HOURS * 3_600_000 + DELEGATION_EVIDENCE_MARGIN_MS);
  });

  it('D-6999: the raw-lease window is the correlation\'s evidence margin, 20 minutes', () => {
    expect(DELEGATION_RAW_LEASE_WINDOW_MS).toBe(DELEGATION_EVIDENCE_MARGIN_MS);
    expect(DELEGATION_RAW_LEASE_WINDOW_MS).toBe(20 * MIN);
  });

  it('W4-C5: an applied position inside the floor bounds S at applied - 1 (anchor); a reconstructing state cuts and carries nothing', () => {
    const entries: Entry[] = [];
    for (let d = 0; d <= 12; d++) entries.push(ev(sessionStart(D0 + d * DAY)));
    const records = chainOf(entries);
    const full = recoverDelegation(null, records).state.checkpoint;
    // a checkpoint applied only through day 1's record: S stops before it, wherever the floor is
    const early = recoverDelegation(null, records.slice(0, 2)).state.checkpoint;
    const anchored = planOf(records, { nowMs: D0 + 12 * DAY + HOUR, checkpoint: early });
    expect(anchored.cutThrough).toBe(1);
    expect(anchored.limitedBy).toBe('anchor');
    const notReady = planOf(records, { nowMs: D0 + 12 * DAY + HOUR, ready: false, checkpoint: full });
    expect(notReady).toMatchObject({ enabled: false, cutThrough: 0, carried: [], cutEvidenceEventIds: [], retirable: [] });
    expect(notReady.disabledReason).toMatch(/recovery has not completed/);
    // with nothing inside the floor, S is the anchor's: never the anchor record itself
    const allOld = planOf(records, { nowMs: D0 + 40 * DAY, checkpoint: full });
    expect(allOld.cutThrough).toBe(records.length - 1);
    expect(allOld.limitedBy).toBe('anchor');
  });

  describe('W4-C6: K1 to K4, each carried with exactly its reason; the ended twin of each is not carried', () => {
    const now = D0 + 12 * DAY;
    /** Day 0 holds the case, then a run of filler inside the floor. */
    function caseOf(day0: Entry[], after: (records: DelegationJournalRecordV1[]) => Entry[] = () => []): { records: DelegationJournalRecordV1[]; plan: DelegationCompactionPlan } {
      const first = chainOf([...day0, ev(sessionStart(D0 + 11 * DAY))]);
      const records = chainOf([...day0, ...after(first), ev(sessionStart(D0 + 11 * DAY)), ev(sessionStart(D0 + 11 * DAY + HOUR))]);
      return { records, plan: planOf(records, { nowMs: now }) };
    }
    it('K1 open-lease and open-lineage: a lease\'s creating record and its correlation record', () => {
      const { records, plan } = caseOf([ev(subagentStart(D0 + MIN, 'agent-l')), ev(subagentStop(D0 + 2 * MIN, 'agent-l'))],
        (r) => [[leaseEntry(r, 'agent', 'agent-l', 'lease-1', { firstObservedMs: D0 + 3 * MIN, correlation: [r[0]!.journalId] }), D0 + 3 * MIN] as const]);
      expect(reasonsAt(plan, 1), 'the correlation record').toEqual(['open-lease', 'open-lineage']);
      expect(reasonsAt(plan, 3), 'the creating record').toEqual(['open-lease', 'open-lineage']);
      expect(reasonsAt(plan, 2), 'the stop names an ended, leased agent and nothing holds it').toBeUndefined();
      expect(plan.cutThrough).toBeGreaterThanOrEqual(3);
      expect(records[2]!.entry.kind).toBe('lease-created');
    });
    it('K2 identity-candidate: every record naming a bare occurrence\'s key; the opened twin is not', () => {
      const { plan } = caseOf([ev(bareTool(D0 + MIN, 'agent-c')), ev(bareTool(D0 + 2 * MIN, 'agent-c')), ev(bareTool(D0 + 3 * MIN, 'agent-o')), ev(subagentStart(D0 + 4 * MIN, 'agent-o')), ev(subagentStop(D0 + 5 * MIN, 'agent-o'))]);
      expect(reasonsAt(plan, 1)).toEqual(['identity-candidate']);
      expect(reasonsAt(plan, 2)).toEqual(['identity-candidate']);
      expect(carriedSeqs(plan).filter((s) => s >= 3 && s <= 5), 'the opened, ended agent').toEqual([]);
    });
    it('K3 active-identity: an active agent\'s identity record; the ended twin is not', () => {
      const { plan } = caseOf([ev(subagentStart(D0 + MIN, 'agent-a')), ev(subagentStart(D0 + 2 * MIN, 'agent-e')), ev(subagentStop(D0 + 3 * MIN, 'agent-e'))]);
      expect(reasonsAt(plan, 1)).toEqual(['active-identity']);
      expect(reasonsAt(plan, 2)).toBeUndefined();
      expect(reasonsAt(plan, 3)).toBeUndefined();
    });
    it('K4 active-workflow-launch: an active run\'s launch response (its identity too: K3); the ended twin is not', () => {
      const { plan } = caseOf([ev(wfLaunch(D0 + MIN, 'wf_a', 'task_a', 'toolu_wa')), ev(wfLaunch(D0 + 2 * MIN, 'wf_e', 'task_e', 'toolu_we')), ev(notification(D0 + 3 * MIN, 'toolu_we', 'task_e'))]);
      expect(reasonsAt(plan, 1)).toEqual(['active-identity', 'active-workflow-launch']);
      expect(reasonsAt(plan, 2)).toBeUndefined();
      expect(reasonsAt(plan, 3)).toBeUndefined();
    });
  });

  describe('W4-C7 (D-6999): K5 keeps every record within 20 minutes of a raw lease\'s call, inclusive, on any repository', () => {
    const now = D0 + 12 * DAY;
    const T10 = D0 + 10 * HOUR;
    it('a lease on a call opened at 10:00:00.000 and ended at 10:04:00.000: 09:40 and 10:24 are carried, 09:39:59.999 and 10:24:00.001 are not; another session inside is carried', () => {
      const day0: Entry[] = [
        ev(sessionStart(T10 - 20 * MIN - 1)), ev(sessionStart(T10 - 20 * MIN)), ev(bashPre(T10, 'toolu_raw', ['wt-a'])), ev(bashPost(T10 + 4 * MIN, 'toolu_raw', ['wt-a', 'wt-r'])),
        ev(sessionStart(T10 + 5 * MIN, { sessionId: 'lane-b-demo' })), ev(sessionStart(T10 + 24 * MIN)), ev(sessionStart(T10 + 24 * MIN + 1)),
      ];
      const first = chainOf(day0);
      const records = chainOf([...day0, [leaseEntry(first, 'bash-worktree', 'toolu_raw', 'lease-raw', { firstObservedMs: T10 + 5 * MIN }), T10 + 30 * MIN],
        ev(sessionStart(D0 + 11 * DAY)), ev(sessionStart(D0 + 11 * DAY + HOUR))]);
      const plan = planOf(records, { nowMs: now });
      expect(reasonsAt(plan, 1), '09:39:59.999').toBeUndefined();
      expect(reasonsAt(plan, 2), '09:40:00.000').toEqual(['raw-lease-window']);
      expect(reasonsAt(plan, 3)).toEqual(['raw-lease-window']);
      expect(reasonsAt(plan, 4)).toEqual(['raw-lease-window']);
      expect(reasonsAt(plan, 5), 'another session, inside').toEqual(['raw-lease-window']);
      expect(reasonsAt(plan, 6), '10:24:00.000').toEqual(['raw-lease-window']);
      expect(reasonsAt(plan, 7), '10:24:00.001').toBeUndefined();
      expect(reasonsAt(plan, 8), 'the lease record').toEqual(['open-lease', 'open-lineage']);
    });
    it('W4-C7b: a raw lease with NO activity row anchors its window on its own firstObservedAt (10:05): 09:45 and 10:25 are carried, 09:44:59.999 and 10:25:00.001 are not', () => {
      const day0: Entry[] = [
        ev(sessionStart(T10 - 15 * MIN - 1)), ev(sessionStart(T10 - 15 * MIN)), ev(sessionStart(T10 + 25 * MIN)), ev(sessionStart(T10 + 25 * MIN + 1)),
        ev(bashPre(T10, 'toolu_raw', ['wt-a'])), ev(bashPost(T10 + 4 * MIN, 'toolu_raw', ['wt-a', 'wt-r'])),
      ];
      const first = chainOf(day0);
      const records = chainOf([...day0, [leaseEntry(first, 'bash-worktree', 'toolu_raw', 'lease-raw', { firstObservedMs: T10 + 5 * MIN }), T10 + 30 * MIN],
        ev(sessionStart(D0 + 11 * DAY)), ev(sessionStart(D0 + 11 * DAY + HOUR))]);
      const full = recoverDelegation(null, records).state.checkpoint;
      const lease = full.leases[0]!;
      // the checkpoint without the lease's activity row: the planner reads the lease alone (it is shown with an unmeasured creator)
      const orphaned: DelegationCheckpointV1 = { ...full, activities: full.activities.filter((a) => a.activityId !== lease.activityId) };
      const plan = planOf(records, { nowMs: now, checkpoint: orphaned });
      expect(reasonsAt(plan, 1), '09:44:59.999').toBeUndefined();
      expect(reasonsAt(plan, 2), '09:45:00.000').toEqual(['raw-lease-window']);
      expect(reasonsAt(plan, 3), '10:25:00.000').toEqual(['raw-lease-window']);
      expect(reasonsAt(plan, 4), '10:25:00.001').toBeUndefined();
    });
  });

  describe('W4-C8: K6 keeps a Bash call\'s records together', () => {
    const now = D0 + 12 * DAY;
    const cutoff = now - DELEGATION_RETENTION_FLOOR_MS;
    const tail = (): Entry[] => [ev(sessionStart(D0 + 11 * DAY)), ev(sessionStart(D0 + 11 * DAY + HOUR))];
    it('a pair with Pre <= S < Post carries its Pre, and S is unchanged; two overlapping straddling pairs carry both Pres', () => {
      const records = chainOf([
        [{ kind: 'evidence-accepted', event: bashPre(cutoff - 2000, 'toolu_s1', ['wt-a']) }, cutoff - 2000],
        [{ kind: 'evidence-accepted', event: bashPre(cutoff - 1000, 'toolu_s2', ['wt-a']) }, cutoff - 1000],
        [{ kind: 'evidence-accepted', event: bashPost(cutoff + 1000, 'toolu_s1', ['wt-a']) }, cutoff + 1000],
        [{ kind: 'evidence-accepted', event: bashPost(cutoff + 2000, 'toolu_s2', ['wt-a']) }, cutoff + 2000],
        ...tail(),
      ]);
      const plan = planOf(records, { nowMs: now });
      expect(plan.cutThrough).toBe(2);
      expect(plan.carried.map((l) => [l.sequence, l.reasons])).toEqual([[1, ['bash-pair']], [2, ['bash-pair']]]);
    });
    it('a K5-carried Post whose Pre lies outside the window carries the Pre; a K5-carried Pre whose Post is <= S carries the Post', () => {
      const T10 = D0 + 10 * HOUR;
      const day0: Entry[] = [
        ev(bashPre(T10 - 25 * MIN, 'toolu_in_post', ['wt-b'])), ev(bashPost(T10 - 19 * MIN, 'toolu_in_post', ['wt-b'])),       // 1, 2
        ev(bashPre(T10, 'toolu_raw', ['wt-a'])), ev(bashPost(T10 + MIN, 'toolu_raw', ['wt-a', 'wt-r'])),                    // 3, 4
        ev(bashPre(T10 + 20 * MIN, 'toolu_in_pre', ['wt-c'])), ev(bashPost(T10 + 30 * MIN, 'toolu_in_pre', ['wt-c'])),      // 5, 6
      ];
      const first = chainOf(day0);
      const records = chainOf([...day0, [leaseEntry(first, 'bash-worktree', 'toolu_raw', 'lease-raw', { firstObservedMs: T10 + MIN }), T10 + 40 * MIN], ...tail()]);
      const plan = planOf(records, { nowMs: now });
      expect(reasonsAt(plan, 1), 'the Pre outside, carried for its Post').toEqual(['bash-pair']);
      expect(reasonsAt(plan, 2)).toEqual(['raw-lease-window']);
      expect(reasonsAt(plan, 5)).toEqual(['raw-lease-window']);
      expect(reasonsAt(plan, 6), 'the Post outside, carried for its Pre').toEqual(['bash-pair']);
    });
    it('D-7011 (a): a second PreToolUse on the key joins the call, so the PostToolUse above S keeps both Pres', () => {
      const records = chainOf([
        [{ kind: 'evidence-accepted', event: bashPre(cutoff - 2000, 'toolu_2p', ['wt-a']) }, cutoff - 2000],
        [{ kind: 'evidence-accepted', event: bashPre(cutoff - 1000, 'toolu_2p', ['wt-b']) }, cutoff - 1000],
        [{ kind: 'evidence-accepted', event: bashPost(cutoff + 1000, 'toolu_2p', ['wt-b']) }, cutoff + 1000],
        ...tail(),
      ]);
      expect(carriedSeqs(planOf(records, { nowMs: now }))).toEqual([1, 2]);
    });
    it('D-7011 (b): a carried call the fold aged (no Post within the pending bound) carries the record that aged it, so recovery ages it there too', () => {
      const T10 = D0 + 10 * HOUR;
      const day0: Entry[] = [
        ev(bashPre(T10, 'toolu_raw', ['wt-a'])), ev(bashPost(T10 + MIN, 'toolu_raw', ['wt-a', 'wt-r'])),                    // 1, 2
        [{ kind: 'evidence-accepted', event: bashPre(T10 + 5 * MIN, 'toolu_aged', ['wt-c']) }, T10 + 5 * MIN],              // 3: K5
        [{ kind: 'evidence-accepted', event: sessionStart(T10 + 2 * HOUR) }, T10 + 2 * HOUR],                                // 4: ages 3
        [{ kind: 'evidence-accepted', event: bashPost(T10 + 3 * HOUR, 'toolu_aged') }, T10 + 3 * HOUR],                      // 5: no listing
      ];
      const first = chainOf(day0);
      const records = chainOf([...day0, [leaseEntry(first, 'bash-worktree', 'toolu_raw', 'lease-raw', { firstObservedMs: T10 + MIN }), T10 + 4 * HOUR], ...tail()]);
      const plan = planOf(records, { nowMs: now });
      expect(reasonsAt(plan, 3)).toEqual(['raw-lease-window']);
      expect(reasonsAt(plan, 4), 'the ager').toEqual(['bash-pair']);
      expect(reasonsAt(plan, 5), 'the unpaired Post the fold read as Post-only').toBeUndefined();
    });
  });

  it('D-7012: a Bash call split across the PREVIOUS cut (its Pre carried last time, its Post in the journal) stays whole, even when this cut removes the Post', () => {
    const now = D0 + 12 * DAY;
    const records = chainOf([
      ev(bashPre(D0 + MIN, 'toolu_old', ['wt-a'])), ev(sessionStart(D0 + 2 * MIN)), ev(bashPost(D0 + 3 * MIN, 'toolu_old', ['wt-a'])),
      ev(sessionStart(D0 + 11 * DAY)), ev(sessionStart(D0 + 11 * DAY + HOUR)),
    ]);
    const planner = new DelegationCompactionPlanner({
      checkpoint: recoverDelegation(null, records).state.checkpoint, ready: true, nowMs: now, floorMs: DELEGATION_RETENTION_FLOOR_MS, naming: delegationRecordNaming,
    });
    // the state after a first compaction that cut through record 1 and carried its Pre: the journal begins at 2
    const len = (r: DelegationJournalRecordV1): number => encodeDelegationJournalRecord(r).length;
    planner.addCarried(records[0]!, { offset: 0, length: len(records[0]!) });
    let offset = 0;
    for (const r of records.slice(1)) { planner.add(r, { offset, length: len(r) }); offset += len(r); }
    const plan = planner.finish(offset);
    expect(plan.cutThrough).toBe(3);
    expect(plan.carried.map((l) => [l.sequence, l.source, l.reasons])).toEqual([[1, 'carried', ['bash-pair']], [3, 'journal', ['bash-pair']]]);
  });

  it('W4-C9: a plan that cuts 24% of the bytes, net of lines carried from the journal, is not worthwhile; at 25% it is', () => {
    // 100 records of 100 bytes each (positions are the planner's input, so they are set exactly); `cut` lie past the floor
    const now = D0 + 12 * DAY;
    const plan = (cut: number, carriedFromJournal: boolean): DelegationCompactionPlan => {
      const T10 = D0 + 10 * HOUR;
      const entries: Entry[] = Array.from({ length: 100 }, (_, i) => ev(sessionStart((i < cut ? D0 : D0 + 11 * DAY) + i * 1000)));
      if (carriedFromJournal) entries[0] = ev(subagentStart(T10, 'agent-active'));          // an active agent's identity: K3, carried from the journal
      const records = chainOf(entries);
      const planner = new DelegationCompactionPlanner({
        checkpoint: recoverDelegation(null, records).state.checkpoint, ready: true, nowMs: now, floorMs: DELEGATION_RETENTION_FLOOR_MS, naming: delegationRecordNaming,
      });
      records.forEach((r, i) => planner.add(r, { offset: i * 100, length: 100 }));
      return planner.finish(10_000);
    };
    expect(plan(24, false)).toMatchObject({ cutBytes: 2400, carriedBytes: 0, worthwhile: false });
    expect(plan(25, false)).toMatchObject({ cutBytes: 2500, carriedBytes: 0, worthwhile: true });
    expect(plan(25, true), 'net 24%: one 100-byte line is carried out of the journal').toMatchObject({ cutBytes: 2500, carriedBytes: 100, worthwhile: false });
    expect(plan(26, true), 'net 25%').toMatchObject({ cutBytes: 2600, carriedBytes: 100, worthwhile: true });
    expect(DELEGATION_COMPACTION_MIN_SHARE).toBe(0.25);
  });

  it('W4-K2 (the planner\'s half): the kebab words are the tables\', never re-spelled', () => {
    for (const r of DELEGATION_CARRY_REASONS) expect(isDelegationCompactionKebab(r), r).toBe(true);
    for (const w of ['floor', 'anchor', 'empty', 'not-ready', 'nothing-to-cut', 'below-share']) expect(isDelegationCompactionKebab(w), w).toBe(true);
    expect(isDelegationCompactionKebab('raw-lease')).toBe(false);
  });
});

// ── the durable rig: an applier over a fixture directory and a real store ──────────────────────────────────────────────

/** The real store's projection port; the retention deletes are logged for the ordering pins. */
function projectionOf(store: CoordStore, log: string[] = []): DelegationProjectionPort {
  return {
    project: (cp) => store.projectDelegationCheckpoint(cp),
    projectChanged: (prior, next) => store.projectDelegationCheckpointChanges(prior, next),
    insertEvents: (rows) => store.insertDelegationEvents(rows),
    eventStats: () => store.delegationEventStats(),
    countEventsAtOrBelow: (sequence) => store.countDelegationEventsAtOrBelow(sequence),
    deleteEventsBetween: (after, through, limit) => {
      log.push(`delete:${after}:${through}:${limit}`);
      return store.deleteDelegationEventsBetween(after, through, limit);
    },
  };
}

interface Rig {
  dir: string;
  db: DatabaseSync;
  store: CoordStore;
  clock: { ms: number };
  /** `fault`: throw at `<edge>:<when>` once. `hold`: await this promise at `<edge>:<when>`. */
  ctl: { fault: string | null; hold: { at: string; gate: Promise<void> } | null };
  log: string[];
  deps: (over?: Partial<DelegationDurabilityDeps>) => DelegationDurabilityDeps;
  open: (over?: Partial<DelegationDurabilityDeps>) => Promise<DelegationDurability>;
}

class InjectedFault extends Error {}

/** The real filesystem with every fsync a no-op: the fixture builds hundreds of records, and the fsync order is not what these rows test
 *  (the edges are, through `onEdge`). */
const noSync = (h: DelegationFileHandle): DelegationFileHandle => ({ write: (b) => h.write(b), sync: async () => undefined, close: () => h.close() });
const quickPort: DelegationFilePort = {
  ...nodeDelegationFilePort,
  openAppend: async (p) => noSync(await nodeDelegationFilePort.openAppend(p)),
  createTemp: async (p) => noSync(await nodeDelegationFilePort.createTemp(p)),
  fsyncDir: async () => undefined,
  fsyncFile: async () => undefined,
};
const opened: DelegationDurability[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((d) => d.close().catch(() => undefined))); });

function rig(opts: { dir?: string } = {}): Rig {
  const dir = opts.dir ?? mkTmp('ccrc-deleg-compact-');
  const db = openCoordDb(path.join(dir, 'coord.db'));
  const store = new CoordStore(db);
  const clock = { ms: D0 };
  const ctl: Rig['ctl'] = { fault: null, hold: null };
  const log: string[] = [];
  let n = 0;
  const onEdge = async (edge: DelegationDurabilityEdge, when: 'before' | 'after'): Promise<void> => {
    const at = `${edge}:${when}`;
    if (ctl.hold !== null && ctl.hold.at === at) { const g = ctl.hold.gate; ctl.hold = null; await g; }
    if (ctl.fault === at) { ctl.fault = null; throw new InjectedFault(`injected at ${at}`); }
  };
  const deps = (over: Partial<DelegationDurabilityDeps> = {}): DelegationDurabilityDeps => ({
    dir, projection: projectionOf(store, log), port: quickPort, now: () => clock.ms, randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, onEdge, ...over,
  });
  return { dir, db, store, clock, ctl, log, deps, open: async (over) => { const d = await DelegationDurability.open(deps(over)); opened.push(d); return d; } };
}

/** Applies events, each accepted one second after it was observed. */
const apply = (dur: DelegationDurability, events: readonly DelegationEventEnvelopeV1[]) =>
  dur.applyAccepted({ accepted: events.map((event) => ({ event, acceptedAt: iso(Date.parse(event.observedAt) + 1000) })), cursor: null, interval: null });
const activityIdOf = (dur: DelegationDurability, kind: 'agent' | 'workflow' | 'bash-worktree', upstreamId: string): string => {
  const id = dur.state().checkpoint.activityIdsByNaturalKey[encodedOf(kind, upstreamId)];
  if (id === undefined) throw new Error(`no activity for ${kind} ${upstreamId}`);
  return id;
};
const journalOf = (dir: string): Buffer => readFileSync(path.join(dir, DELEGATION_JOURNAL_FILE));
const carriedOf = (dir: string): Buffer | null => (existsSync(path.join(dir, DELEGATION_CARRIED_FILE)) ? readFileSync(path.join(dir, DELEGATION_CARRIED_FILE)) : null);
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
/** A journal's records, chain-checked. */
const recordsOf = (bytes: Uint8Array | null): DelegationJournalRecordV1[] => (bytes === null || bytes.length === 0 ? [] : parseDelegationJournal(new Uint8Array(bytes)));
/** A carried file's records: each line decoded, no chain (the carried file has none). */
const linesOf = (bytes: Uint8Array | null): DelegationJournalRecordV1[] =>
  bytes === null ? [] : new TextDecoder().decode(bytes).split('\n').filter((l) => l !== '').map((l) => decodeDelegationJournalLine(new TextEncoder().encode(l)));
const withoutRevision = (cp: DelegationCheckpointV1): string => canonicalDelegationJson({ ...cp, revision: 0 });
interface Internals { eventIds: Set<string>; builder: { computeHolds(): unknown; candidates: Map<string, unknown>; workflowLaunches: Map<string, unknown>; bashCalls: Map<string, unknown> } }
const internals = (d: DelegationDurability): Internals => d as unknown as Internals;

/** now, and the cutoff the 10-day floor puts at day 2 + 1 h. */
const NOW = D0 + 12 * DAY + HOUR;
const CUTOFF = NOW - DELEGATION_RETENTION_FLOOR_MS;

/**
 * The 12-day fixture (W4-C10's): evidence, an agent lease, a raw lease, an active Workflow run with a worker, an ended run with a worker,
 * an ended run held by a workflow lease (with a worker), a straddling Bash pair, a zero-delta call, an identity candidate, an ended agent
 * named only inside the raw lease's window, an ended agent named above S, and filler on every day. Retirable behind the cut: `agent-ended`,
 * and `wf_done` with its worker.
 */
async function fixture(r: Rig = rig()): Promise<{ r: Rig; dur: DelegationDurability }> {
  const dur = await r.open();
  await apply(dur, [
    sessionStart(D0), subagentStart(D0 + MIN, 'agent-ended'), subagentStop(D0 + 2 * MIN, 'agent-ended'),
    subagentStart(D0 + 3 * MIN, 'agent-leased'), subagentStop(D0 + 4 * MIN, 'agent-leased'),
    wfLaunch(D0 + 5 * MIN, 'wf_active', 'task_a', 'toolu_wa'), wfLaunch(D0 + 6 * MIN, 'wf_done', 'task_d', 'toolu_wd'), wfLaunch(D0 + 6 * MIN + 30_000, 'wf_held', 'task_h', 'toolu_wh'),
  ]);
  for (const runId of ['wf_active', 'wf_done', 'wf_held']) {
    expect((await dur.applyPositiveWorkflowMeta({ parentId: PARENT, parentIncarnation: INC, runId, workerIndex: 0 })).kind).toBe('opened');
  }
  await apply(dur, [
    notification(D0 + 7 * MIN, 'toolu_wd', 'task_d'), notification(D0 + 7 * MIN + 30_000, 'toolu_wh', 'task_h'),
    bashPre(D0 + 8 * MIN, 'toolu_zero', ['wt-z']), bashPost(D0 + 8 * MIN + 1000, 'toolu_zero', ['wt-z']), bareTool(D0 + 20 * MIN, 'agent-cand'),
    ...Array.from({ length: 150 }, (_, i) => sessionStart(D0 + HOUR + i * 10_000)),
  ]);
  const journalNow = recordsOf(journalOf(r.dir));
  const leasedStart = journalNow.find((x) => x.entry.kind === 'evidence-accepted' && x.entry.event.eventKind === 'SubagentStart' && x.entry.event.agentId === 'agent-leased')!;
  r.clock.ms = D0 + 30 * MIN;
  const leased = await dur.createLease({ activityId: activityIdOf(dur, 'agent', 'agent-leased'), parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-leased',
    canonicalPath: '/work/project-a/.claude/worktrees/leased', creationBase: null, sourceKind: 'agent', correlationJournalIds: [leasedStart.journalId], firstObservedAt: iso(D0 + 3 * MIN) });
  expect(leased.kind).toBe('created');
  const held = await dur.createLease({ activityId: activityIdOf(dur, 'workflow', 'wf_held'), parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-held',
    canonicalPath: '/work/project-a/.claude/worktrees/held', creationBase: null, sourceKind: 'workflow', correlationJournalIds: [], firstObservedAt: iso(D0 + 6 * MIN) });
  expect(held.kind).toBe('created');
  const D1 = D0 + DAY;
  await apply(dur, [
    bashPre(D1 + 10 * MIN, 'toolu_raw', ['wt-a']), bashPost(D1 + 12 * MIN, 'toolu_raw', ['wt-a', 'wt-r']),
    subagentStart(D1 + 15 * MIN, 'agent-window'), subagentStop(D1 + 16 * MIN, 'agent-window'),
    sessionStart(D1 + 31 * MIN), sessionStart(D1 + 33 * MIN), subagentStart(D1 + 40 * MIN, 'agent-late'),
    ...Array.from({ length: 100 }, (_, i) => sessionStart(D1 + 2 * HOUR + i * 10_000)),
  ]);
  r.clock.ms = D1 + 50 * MIN;
  const raw = await dur.createLease({ activityId: activityIdOf(dur, 'bash-worktree', 'toolu_raw'), parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-raw',
    canonicalPath: '/work/project-a/.claude/worktrees/raw', creationBase: null, sourceKind: 'raw', correlationJournalIds: [], firstObservedAt: iso(D1 + 12 * MIN) });
  expect(raw.kind).toBe('created');
  // the straddling pair: Pre accepted 30 s before the cutoff, Post 30 s after (equal listings: nothing opens, so a Post kept alone would refuse)
  await apply(dur, [bashPre(CUTOFF - 31_000, 'toolu_straddle', ['wt-s'])]);
  await apply(dur, [bashPost(CUTOFF + 29_000, 'toolu_straddle', ['wt-s']), bareTool(D0 + 5 * DAY, 'agent-cand'), subagentStop(D0 + 5 * DAY + MIN, 'agent-late')]);
  for (let d = 3; d <= 12; d++) await apply(dur, Array.from({ length: 20 }, (_, i) => sessionStart(D0 + d * DAY + i * 10_000)));
  expect(dur.failure()).toBeNull();
  r.clock.ms = NOW;
  return { r, dur };
}

const RETIRED = (dur: DelegationDurability): string[] =>
  [activityIdOf(dur, 'agent', 'agent-ended'), activityIdOf(dur, 'workflow', 'wf_done'), activityIdOf(dur, 'workflow', 'wf_done-0')].sort();

/** The checkpoint less the activities C1 retired (rows and mapping). */
function withoutActivities(cp: DelegationCheckpointV1, ids: readonly string[]): DelegationCheckpointV1 {
  const gone = new Set(ids);
  return {
    ...cp,
    activities: cp.activities.filter((a) => !gone.has(a.activityId)),
    activityIdsByNaturalKey: Object.fromEntries(Object.entries(cp.activityIdsByNaturalKey).filter(([, id]) => !gone.has(id))),
  };
}

async function compacted(): Promise<{ r: Rig; dur: DelegationDurability; before: DelegationCheckpointV1; retired: string[]; out: Extract<DelegationCompactionOutcome, { kind: 'compacted' }>; eventIdsBefore: Set<string> }> {
  const { r, dur } = await fixture();
  const before = structuredClone(dur.state().checkpoint) as DelegationCheckpointV1;
  const retired = RETIRED(dur);
  const eventIdsBefore = new Set(internals(dur).eventIds);
  const out = await dur.compactJournal(NOW, DELEGATION_RETENTION_FLOOR_MS);
  if (out.kind !== 'compacted') throw new Error(`expected a compaction, got ${JSON.stringify({ ...out, plan: null })}`);
  return { r, dur, before, retired, out, eventIdsBefore };
}

// ── Task 3.3: compactJournal ───────────────────────────────────────────────────────────────────────────────────────────

describe('Task 3.3: compactJournal, the crash-safe rewrite inside the serial queue', () => {
  it('W4-C10: a compacted set recovers to the same checkpoint (less what C1 retired), and the live state equals the fresh recovery\'s', async () => {
    const { r, dur, before, retired, out, eventIdsBefore } = await compacted();
    expect(out.plan.limitedBy).toBe('floor');
    expect(out.retired).toBe(3);
    expect(out.plan.retirable).toEqual(retired);
    const fresh = await r.open({ projection: null });
    expect(fresh.failure()).toBeNull();
    expect(withoutRevision(fresh.state().checkpoint as DelegationCheckpointV1), 'the fresh recovery').toBe(withoutRevision(withoutActivities(before, retired)));
    expect(withoutRevision(dur.state().checkpoint as DelegationCheckpointV1), 'the live applier').toBe(withoutRevision(fresh.state().checkpoint as DelegationCheckpointV1));
    const journal = recordsOf(journalOf(r.dir));
    expect(journal[0]!.sequence, 'the journal begins at S+1').toBe(out.plan.cutThrough + 1);
    expect(linesOf(carriedOf(r.dir)).map((x) => x.sequence), 'the carried file holds the plan\'s lines').toEqual(out.plan.carried.map((l) => l.sequence));
    expect(out.plan.carried.length).toBeGreaterThan(0);
    const after = internals(dur).eventIds;
    expect([...after].every((id) => eventIdsBefore.has(id)), 'the event IDs after are a subset').toBe(true);
    expect(after.size).toBe(eventIdsBefore.size - out.plan.cutEvidenceEventIds.length);
    expect(after).toEqual(internals(fresh).eventIds);
    expect(dur.pruningEnabled()).toBe(true);
    expect(fresh.pruningEnabled()).toBe(true);
    const live = internals(dur).builder;
    const rebuilt = internals(fresh).builder;
    expect(live.computeHolds(), 'the holds').toEqual(rebuilt.computeHolds());
    expect(live.candidates, 'the candidates').toEqual(rebuilt.candidates);
    expect(live.workflowLaunches, 'the Workflow launch index').toEqual(rebuilt.workflowLaunches);
    expect(live.bashCalls, 'the Bash-call facts').toEqual(rebuilt.bashCalls);
    expect(live.workflowLaunches.size, 'the active run\'s launch is still indexed, the held run\'s cut one is not').toBe(1);
  });

  describe('W4-C11: a fault at any edge before the journal\'s rename leaves the journal byte-identical and the applier ready', () => {
    const EDGES = DELEGATION_COMPACTION_EDGES.slice(0, DELEGATION_COMPACTION_EDGES.indexOf('journal-copy-fsync') + 1);
    const cases = [...EDGES.flatMap((e) => [`${e}:before`, `${e}:after`]), 'journal-rename:before'];
    it.each(cases)('at %s', async (at) => {
      const { r, dur } = await fixture();
      const journal = journalOf(r.dir);
      const cp = withoutRevision(dur.state().checkpoint as DelegationCheckpointV1);
      const ids = internals(dur).eventIds.size;
      const head = recordsOf(journal).at(-1)!.sequence;
      r.ctl.fault = at;
      await expect(dur.compactJournal(NOW, DELEGATION_RETENTION_FLOOR_MS)).rejects.toBeInstanceOf(InjectedFault);
      expect(sha256(journalOf(r.dir)), 'the journal is byte-identical').toBe(sha256(journal));
      expect(dur.failure(), 'the faulted applier is still ready').toBeNull();
      expect(internals(dur).eventIds.size, 'eventIds is unchanged').toBe(ids);
      expect(readdirSync(r.dir).filter((f) => f.endsWith('.tmp')), 'both temps are removed').toEqual([]);
      const fresh = await r.open({ projection: null });
      expect(fresh.failure()).toBeNull();
      expect(withoutRevision(fresh.state().checkpoint as DelegationCheckpointV1)).toBe(cp);
      await apply(dur, [sessionStart(NOW)]);
      const tail = recordsOf(journalOf(r.dir)).at(-1)!;
      expect(tail.sequence, 'the next append lands at head + 1, in the journal').toBe(head + 1);
    });
  });

  describe('W4-C12: a fault at or after the journal\'s rename fails the applier, and a recovery reads the compacted set ready', () => {
    it.each(['journal-rename:after', 'journal-directory-fsync:before', 'memory-prune:before', 'writer-reopen:before'])('at %s', async (at) => {
      const { r, dur, retired } = await (async () => { const f = await fixture(); return { ...f, retired: RETIRED(f.dur) }; })();
      const before = structuredClone(dur.state().checkpoint) as DelegationCheckpointV1;
      r.ctl.fault = at;
      await expect(dur.compactJournal(NOW, DELEGATION_RETENTION_FLOOR_MS)).rejects.toBeInstanceOf(InjectedFault);
      expect(dur.failure()).not.toBeNull();
      expect(dur.state().phase).toBe('reconstructing');
      const report = await dur.recover();
      expect(report.failure).toBeNull();
      expect(dur.state().phase).toBe('ready');
      // the retirement never ran (the fault came first): the recovered checkpoint is the one before, row for row
      expect(withoutRevision(dur.state().checkpoint as DelegationCheckpointV1)).toBe(withoutRevision(before));
      expect(retired.length).toBe(3);
      const head = recordsOf(journalOf(r.dir)).at(-1)!.sequence;
      await apply(dur, [sessionStart(NOW)]);
      const journal = recordsOf(journalOf(r.dir));
      expect(journal.at(-1)!.sequence).toBe(head + 1);
      expect(journal[0]!.sequence, 'the new journal').toBeGreaterThan(1);
    });
  });

  it('W4-C13: a crash between the two renames (a first compaction): every carried line is at or above J, matched and skipped; the checkpoint is unchanged', async () => {
    const { r, dur } = await fixture();
    const cp = withoutRevision(dur.state().checkpoint as DelegationCheckpointV1);
    const journalLines = recordsOf(journalOf(r.dir)).length;
    r.ctl.fault = 'carried-directory-fsync:after';
    await expect(dur.compactJournal(NOW, DELEGATION_RETENTION_FLOOR_MS)).rejects.toBeInstanceOf(InjectedFault);
    const carried = linesOf(carriedOf(r.dir));
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.every((x) => x.sequence >= 1)).toBe(true);
    const report = await recoverDelegationFromFiles(nodeDelegationFilePort, r.dir);
    expect(report.failure).toBeNull();
    expect(report.scanned, 'scanned counts journal lines only').toBe(journalLines);
    expect(withoutRevision(report.state.checkpoint)).toBe(cp);
  });

  it('W4-C29 crash window: a skipped plan counts every physical carried line, including copies at or above J', async () => {
    const { r, dur } = await fixture();
    r.ctl.fault = 'carried-directory-fsync:after';
    await expect(dur.compactJournal(NOW, DELEGATION_RETENTION_FLOOR_MS)).rejects.toBeInstanceOf(InjectedFault);
    const carried = carriedOf(r.dir)!;
    const lines = linesOf(carried);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.sequence >= recordsOf(journalOf(r.dir))[0]!.sequence)).toBe(true);
    await dur.recover();
    const out = await dur.compactJournal(NOW, 20 * DAY);
    expect(out).toMatchObject({ kind: 'skipped', reason: 'nothing-to-cut', plan: { currentCarriedBytes: carried.length, currentCarriedLines: lines.length } });
    expect(carriedOf(r.dir)).toEqual(carried);
  });

  it('W4-C13b: the same crash in a second compaction: the re-carried old lines are accepted, the new ones matched; the repair prunes the dropped carried rows without a wipe', async () => {
    const { r, dur } = await compacted();
    // three more days: the active run ends (its launch and identity are no longer carried), and the floor moves on
    await apply(dur, [notification(NOW + MIN, 'toolu_wa', 'task_a')]);
    for (let d = 0; d < 3; d++) await apply(dur, Array.from({ length: 60 }, (_, i) => sessionStart(NOW + d * DAY + HOUR + i * 10_000)));
    const later = NOW + 3 * DAY + 2 * HOUR;
    const cp = withoutRevision(dur.state().checkpoint as DelegationCheckpointV1);
    const oldCarried = linesOf(carriedOf(r.dir));
    r.ctl.fault = 'carried-directory-fsync:after';
    // a 2-day floor, so this second cut is worth making on a small fixture (the floor is the caller's argument)
    await expect(dur.compactJournal(later, 2 * DAY)).rejects.toBeInstanceOf(InjectedFault);
    const J = recordsOf(journalOf(r.dir))[0]!.sequence;
    const newCarried = linesOf(carriedOf(r.dir));
    const reCarried = newCarried.filter((x) => x.sequence < J);
    expect(reCarried.length, 'some old lines are carried again').toBeGreaterThan(0);
    expect(newCarried.some((x) => x.sequence >= J), 'and some new ones are copies of journal lines').toBe(true);
    const droppedEvidence = oldCarried.filter((x) => x.entry.kind === 'evidence-accepted' && !reCarried.some((y) => y.sequence === x.sequence)).length;
    expect(droppedEvidence, 'the ended run\'s carried records are dropped').toBeGreaterThan(0);
    const report = await recoverDelegationFromFiles(nodeDelegationFilePort, r.dir);
    expect(report.failure).toBeNull();
    expect(withoutRevision(report.state.checkpoint)).toBe(cp);
    const repaired = await repairDelegationProjection({
      projection: projectionOf(r.store), checkpoint: report.state.checkpoint, journal: () => retainedOf(r.dir), evidence: report.facts!.evidence,
      retainedFrom: report.journal!.firstSequence,
    });
    expect(repaired).toMatchObject({ prunedBelow: droppedEvidence, wipedAll: false });
  });

  it('W4-C14: an append queued during a compaction lands at head + 1 in the NEW journal, after it; so does a recovery, which reads it ready', async () => {
    const { r, dur } = await fixture();
    let release!: () => void;
    r.ctl.hold = { at: 'journal-copy:before', gate: new Promise<void>((res) => { release = res; }) };
    const order: string[] = [];
    const compacting = dur.compactJournal(NOW, DELEGATION_RETENTION_FLOOR_MS).then((o) => { order.push('compacted'); return o; });
    const head = recordsOf(journalOf(r.dir)).at(-1)!.sequence;
    await new Promise((res) => setTimeout(res, 20));
    const appending = apply(dur, [sessionStart(NOW + MIN)]).then(() => { order.push('appended'); });
    release();
    await Promise.all([compacting, appending]);
    expect(order).toEqual(['compacted', 'appended']);
    const journal = recordsOf(journalOf(r.dir));
    expect(journal.at(-1)!.sequence).toBe(head + 1);
    expect(journal[0]!.sequence).toBeGreaterThan(1);
    expect(() => parseDelegationJournal(new Uint8Array(journalOf(r.dir)))).not.toThrow();
    // a recovery queued during the next compaction runs after it and reads the compacted set
    await apply(dur, Array.from({ length: 40 }, (_, i) => sessionStart(NOW + DAY + i * 1000)));
    let release2!: () => void;
    r.ctl.hold = { at: 'compact-plan:after', gate: new Promise<void>((res) => { release2 = res; }) };
    const second = dur.compactJournal(NOW + 3 * DAY, DELEGATION_RETENTION_FLOOR_MS);
    await new Promise((res) => setTimeout(res, 20));
    const recovering = dur.recover();
    release2();
    await second;
    const report = await recovering;
    expect(report.failure).toBeNull();
    expect(dur.state().phase).toBe('ready');
  });

  it('W4-C15: a short copy refuses short-copy: the journal byte-identical, the temp removed, the applier ready', async () => {
    const { r, dur } = await fixture();
    const journal = journalOf(r.dir);
    const shortTemp: DelegationFilePort = {
      ...quickPort,
      createTemp: async (p) => {
        const h = await quickPort.createTemp(p);
        if (!p.endsWith(`${DELEGATION_JOURNAL_FILE}.tmp`)) return h;
        let first = true;
        const short: DelegationFileHandle = { write: async (b) => { if (first) { first = false; return h.write(b.subarray(0, b.length - 1)); } return h.write(b); }, sync: () => h.sync(), close: () => h.close() };
        return short;
      },
    };
    const d2 = await r.open({ port: shortTemp });
    await dur.close();
    await expect(d2.compactJournal(NOW, DELEGATION_RETENTION_FLOOR_MS)).rejects.toMatchObject({ code: 'short-copy' });
    expect(sha256(journalOf(r.dir))).toBe(sha256(journal));
    expect(readdirSync(r.dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(d2.failure()).toBeNull();
  });
});

/** The retained set of a directory as records, through the one reader. */
async function* retainedOf(dir: string): AsyncGenerator<DelegationJournalRecordV1> {
  const { readDelegationRetainedRecords } = await import('../src/coord/delegation-journal.js');
  for await (const line of readDelegationRetainedRecords(nodeDelegationFilePort, path.join(dir, DELEGATION_CARRIED_FILE), path.join(dir, DELEGATION_JOURNAL_FILE))) yield line.record;
}

describe('W4-C16: recovery\'s carried rules', () => {
  /** Six records, SessionStarts only (nothing to hold); the journal from J = 3, the checkpoint at `applied`. */
  function plant(carried: readonly Uint8Array[], opts: { applied?: number; journalFrom?: number; tail?: Uint8Array } = {}): string {
    const dir = mkTmp('ccrc-deleg-carried-');
    const records = base6();
    const applied = opts.applied ?? 6;
    writeFileSync(path.join(dir, DELEGATION_JOURNAL_FILE), Buffer.concat(records.slice((opts.journalFrom ?? 3) - 1).map(encodeDelegationJournalRecord)));
    writeFileSync(path.join(dir, DELEGATION_CARRIED_FILE), Buffer.concat([...carried, ...(opts.tail === undefined ? [] : [opts.tail])]));
    writeFileSync(path.join(dir, DELEGATION_CHECKPOINT_FILE), encodeDelegationCheckpoint({ ...recoverDelegation(null, records.slice(0, applied)).state.checkpoint, revision: 1 }));
    return dir;
  }
  let six: DelegationJournalRecordV1[] | null = null;
  const base6 = (): DelegationJournalRecordV1[] => (six ??= chainOf(Array.from({ length: 6 }, (_, i) => ev(sessionStart(D0 + i * MIN)))));
  const line = (r: DelegationJournalRecordV1): Uint8Array => encodeDelegationJournalRecord(r);
  /** Another valid record at a sequence: same chain position, other content. */
  const other = (sequence: number): DelegationJournalRecordV1 =>
    buildDelegationJournalRecord({ sequence, acceptedAt: iso(D0 + 9 * MIN), previousDigest: base6()[sequence - 2]?.digest ?? null, entry: { kind: 'evidence-accepted', event: sessionStart(D0 + 9 * MIN) } });
  const failureOf = async (dir: string): Promise<string | null> => (await recoverDelegationFromFiles(nodeDelegationFilePort, dir)).failure?.code ?? null;

  it('a carried line at or above J that equals the journal\'s line is skipped, and recovery is ready (scanned counts journal lines only)', async () => {
    const r = base6();
    const report = await recoverDelegationFromFiles(nodeDelegationFilePort, plant([line(r[0]!), line(r[2]!), line(r[3]!)]));
    expect(report.failure).toBeNull();
    expect(report.scanned).toBe(4);
    expect(report.facts!.evidence.total, 'the carried line below J counts, the matched ones do not twice').toBe(5);
  });
  it('a carried line at or above J whose bytes differ from the journal\'s line refuses carried-past-journal', async () => {
    expect(await failureOf(plant([line(base6()[0]!), line(other(4))]))).toBe('carried-past-journal');
  });
  it('a carried line whose sequence the journal never reaches refuses carried-past-journal', async () => {
    expect(await failureOf(plant([line(base6()[0]!), line(other(9))]))).toBe('carried-past-journal');
  });
  it('a descending carried line refuses carried-order', async () => {
    expect(await failureOf(plant([line(base6()[1]!), line(base6()[0]!)]))).toBe('carried-order');
  });
  it('a carried line below J past the checkpoint\'s applied position refuses carried-past-applied', async () => {
    expect(await failureOf(plant([line(base6()[2]!)], { applied: 2, journalFrom: 5 }))).toBe('carried-past-applied');
  });
  it('a carried file with a torn tail refuses torn-tail, and is never healed', async () => {
    const dir = plant([line(base6()[0]!)], { tail: line(base6()[1]!).subarray(0, 30) });
    const before = carriedOf(dir);
    expect(await failureOf(dir)).toBe('torn-tail');
    const dur = await rig({ dir }).open();
    expect(dur.failure()?.code).toBe('torn-tail');
    expect(carriedOf(dir), 'the carried file is left as it was').toEqual(before);
  });
});

// ── Task 3.4: delegation_events retention, and a repair that deletes instead of wiping ─────────────────────────────────

const countRows = (db: DatabaseSync): number => Number((db.prepare('SELECT COUNT(*) AS n FROM delegation_events').get() as { n: number }).n);
const rowSequences = (db: DatabaseSync): number[] => (db.prepare('SELECT journalSequence AS s FROM delegation_events ORDER BY journalSequence').all() as { s: number }[]).map((x) => Number(x.s));
interface EvidenceInternals { evidence: { total: number }; drifted: Map<string, { sessionId: string; incarnation: string }> }
const evidenceOf = (d: DelegationDurability): EvidenceInternals => d as unknown as EvidenceInternals;
/** SQLite holds exactly the retained evidence: its count is the applier's, and every row is carried evidence or above S. */
function expectRetainedRows(db: DatabaseSync, dur: DelegationDurability, plan: DelegationCompactionPlan): void {
  expect(countRows(db)).toBe(evidenceOf(dur).evidence.total);
  const carried = new Set(plan.carriedEvidenceSequences);
  expect(rowSequences(db).filter((seq) => seq <= plan.cutThrough && !carried.has(seq)), 'no cut row survives').toEqual([]);
  expect(plan.carriedEvidenceSequences.filter((seq) => !rowSequences(db).includes(seq)), 'W4-C19: every carried evidence row is present').toEqual([]);
}

describe('Task 3.4: delegation_events retention, and a repair that deletes instead of wiping', () => {
  it('W4-C17: after a compaction SQLite holds exactly the retained evidence, and eventsDeleted is the cut evidence count', async () => {
    const { r, dur, out } = await compacted();
    expect(out.eventsDeleted).toBe(out.plan.cutEvidenceEventIds.length);
    expect(out.eventsDeleted).toBeGreaterThan(0);
    expectRetainedRows(r.db, dur, out.plan);
  });

  it('W4-C17 (the chunks): with a chunk of 2 and 7 rows in one gap, four deletes, and the loop gets a turn after each', async () => {
    const r = rig();
    const turns: string[] = [];
    const base = projectionOf(r.store);
    const projection: DelegationProjectionPort = {
      ...base,
      deleteEventsBetween: (after, through, limit) => { turns.push('delete'); setImmediate(() => turns.push('turn')); return base.deleteEventsBetween!(after, through, limit); },
    };
    const dur = await r.open({ projection, eventsDeleteChunk: 2 });
    await apply(dur, Array.from({ length: 7 }, (_, i) => sessionStart(D0 + i * MIN)));
    await apply(dur, Array.from({ length: 10 }, (_, i) => sessionStart(D0 + 11 * DAY + i * MIN)));
    const out = await dur.compactJournal(NOW, DELEGATION_RETENTION_FLOOR_MS);
    expect(out).toMatchObject({ kind: 'compacted', eventsDeleted: 7 });
    expect(turns).toEqual(['delete', 'turn', 'delete', 'turn', 'delete', 'turn', 'delete', 'turn']);
    expect(countRows(r.db)).toBe(10);
  });

  it('W4-C18: a crash after the rename and before the delete is repaired by deleting below the first retained record, never by a wipe', async () => {
    const { r, dur } = await fixture();
    r.ctl.fault = 'events-delete:before';
    await expect(dur.compactJournal(NOW, DELEGATION_RETENTION_FLOOR_MS)).rejects.toBeInstanceOf(InjectedFault);
    expect(dur.failure(), 'a fault after the rename fails the applier').not.toBeNull();
    const report = await recoverDelegationFromFiles(nodeDelegationFilePort, r.dir);
    expect(report.failure).toBeNull();
    const J = report.journal!.firstSequence!;
    const cutEvidence = rowSequences(r.db).filter((seq) => seq < J).length - report.facts!.evidence.countAtOrBelow(J - 1);
    expect(cutEvidence).toBeGreaterThan(0);
    const repaired = await repairDelegationProjection({
      projection: projectionOf(r.store), checkpoint: report.state.checkpoint, journal: () => retainedOf(r.dir), evidence: report.facts!.evidence, retainedFrom: J,
    });
    expect(repaired).toMatchObject({ wipedAll: false, fullReplay: false, prunedBelow: cutEvidence });
    expect(repaired.journalPasses).toBeLessThanOrEqual(1);
    expect(countRows(r.db)).toBe(report.facts!.evidence.total);
    // and the applier's own recovery reaches the same rows
    const reopened = await r.open();
    expect(reopened.failure()).toBeNull();
    expect(countRows(r.db)).toBe(evidenceOf(reopened).evidence.total);
  });

  it('the pruning plan still locates carried holds after compaction', async () => {
    const { dur } = await compacted();
    const retained: DelegationJournalRecordV1[] = [];
    await dur.visitRetainedRecords((r) => retained.push(r));
    const held = new Set(dur.state().checkpoint.pruningHolds.map((h) => h.journalId));
    const firstHeld = retained.find((r) => held.has(r.journalId))!;
    expect(firstHeld.sequence).toBeLessThan(dur.state().checkpoint.appliedJournalSequence);
    expect(await dur.planPruning(NOW, DELEGATION_RETENTION_FLOOR_MS)).toMatchObject({ enabled: true, prunableThroughSequence: firstHeld.sequence - 1 });
  });

  it('W4-C30: after a compaction a heal replays the carried evidence, and so does a wipe; a second full repair wipes nothing', async () => {
    const { r, dur, out } = await compacted();
    evidenceOf(dur).drifted.set(JSON.stringify([PARENT, INC]), { sessionId: PARENT, incarnation: INC });
    const healed = await dur.repairProjection();
    expect(healed?.healedSessions).toBe(1);
    expectRetainedRows(r.db, dur, out.plan);
    // a stray row the journal does not hold: the repair wipes and replays the retained set
    r.db.prepare(`INSERT INTO delegation_events (eventId, journalSequence, journalDigest, acceptedAt, sessionId, parentIncarnation, claudeSessionId, eventKind, observedAt, payloadJson)
      VALUES (?, 999999, ?, 0, ?, ?, ?, 'SessionStart', 0, '{}')`).run('f'.repeat(64), 'e'.repeat(64), PARENT, INC, CLAUDE);
    const wiped = await dur.repairProjection();
    expect(wiped?.wipedAll).toBe(true);
    expectRetainedRows(r.db, dur, out.plan);
    expect((await dur.repairProjection())?.wipedAll).toBe(false);
    expect((await dur.repairProjection({ perPass: true }))?.skipped).toBe(false);
    expect((await dur.repairProjection({ perPass: true }))?.skipped).toBe(true);
  });
});

// ── Task 3.5: C1, retiring ended activities behind the cut ─────────────────────────────────────────────────────────────

describe('Task 3.5: C1 retires ended activities behind the cut (D-7001, D-7024)', () => {
  it('W4-C20: every ended agent and Workflow run whose records are all cut is gone from rows and mapping; a fresh recovery equals the live checkpoint byte for byte', async () => {
    const { r, dur, retired } = await compacted();
    const cp = dur.state().checkpoint as DelegationCheckpointV1;
    for (const id of retired) {
      expect(cp.activities.some((a) => a.activityId === id), id).toBe(false);
      expect(Object.values(cp.activityIdsByNaturalKey).includes(id), id).toBe(false);
    }
    const fresh = await r.open({ projection: null });
    expect(fresh.failure()).toBeNull();
    expect(Buffer.from(encodeDelegationCheckpoint(fresh.state().checkpoint as DelegationCheckpointV1)).toString()).toBe(Buffer.from(encodeDelegationCheckpoint(cp)).toString());
  });

  it('W4-C21: kept: an agent a carried record names, a leased one, one a lineage edge names, one a record above S names, an active one, and an ended worker whose run is kept', async () => {
    const { r, dur } = await fixture();
    const ended = activityIdOf(dur, 'agent', 'agent-ended');
    await dur.applyCheckpointChange((cp) => ({
      ...cp,
      lineage: [...cp.lineage, { lineageId: 'a'.repeat(64), parentId: PARENT, parentIncarnation: INC, activityId: ended, leaseId: null, runId: null, openedAt: iso(D0 + MIN), closedAt: null, closeReason: null }],
    }));
    const out = await dur.compactJournal(NOW, DELEGATION_RETENTION_FLOOR_MS);
    expect(out.kind).toBe('compacted');
    const kept = (kind: 'agent' | 'workflow', id: string): boolean => dur.state().checkpoint.activityIdsByNaturalKey[encodedOf(kind, id)] !== undefined;
    expect(kept('agent', 'agent-window'), 'named by a K5-carried record').toBe(true);
    expect(kept('agent', 'agent-leased'), 'named by a lease').toBe(true);
    expect(kept('agent', 'agent-ended'), 'named by a lineage edge').toBe(true);
    expect(kept('agent', 'agent-late'), 'named by a record above S').toBe(true);
    expect(kept('workflow', 'wf_active'), 'active').toBe(true);
    expect(kept('workflow', 'wf_held-0'), 'an ended worker whose run a lease keeps').toBe(true);
    expect(kept('workflow', 'wf_done'), 'the control: the ended, unnamed run leaves').toBe(false);
    const fresh = await r.open({ projection: null });
    expect(fresh.failure()).toBeNull();
    // a meta read of the kept worker finds it open: nothing reopens under a new identity
    expect((await dur.applyPositiveWorkflowMeta({ parentId: PARENT, parentIncarnation: INC, runId: 'wf_held', workerIndex: 0 })).kind).toBe('already-open');
  });

  it('W4-C22b: retireBehindCut drops the retired run\'s launch-index entry with its row, so a later notification of it is ignored (not refused)', () => {
    const records = chainOf([ev(sessionStart(D0)), ev(wfLaunch(D0 + MIN, 'wf_r', 'task_r', 'toolu_r')), ev(notification(D0 + 2 * MIN, 'toolu_r', 'task_r'))]);
    const report = recoverDelegation(null, records);
    const b = report.facts!.builder;
    const launches = (b as unknown as { workflowLaunches: Map<string, unknown> }).workflowLaunches;
    expect(launches.size).toBe(1);
    const run = report.state.checkpoint.activityIdsByNaturalKey[encodedOf('workflow', 'wf_r')]!;
    expect(b.retireBehindCut([run])).toBe(1);
    expect(launches.size, 'the entry left with the row').toBe(0);
    const late = buildDelegationJournalRecord({ sequence: 4, acceptedAt: iso(D0 + 3 * MIN), previousDigest: records[2]!.digest, entry: { kind: 'evidence-accepted', event: notification(D0 + 3 * MIN, 'toolu_r', 'task_r') } });
    expect(() => b.foldRecord(late)).not.toThrow();
  });

  it('W4-C22: a task notification for a retired run, arriving live after the retirement, is ignored, and after recovery too', async () => {
    const { dur } = await compacted();
    const activities = canonicalDelegationJson(dur.state().checkpoint.activities);
    await apply(dur, [notification(NOW + MIN, 'toolu_wd', 'task_d')]);
    expect(dur.failure()).toBeNull();
    expect(canonicalDelegationJson(dur.state().checkpoint.activities)).toBe(activities);
    const report = await dur.recover();
    expect(report.failure).toBeNull();
    expect(canonicalDelegationJson(dur.state().checkpoint.activities)).toBe(activities);
  });
});

describe('Task 3.4: indexed event retention through CoordStore', () => {
  it('counts inclusively and deletes only the bounded gap, oldest first and at most the requested chunk', async () => {
    const r = rig();
    const d = await r.open();
    await apply(d, Array.from({ length: 8 }, (_, i) => sessionStart(D0 + i * MIN)));
    expect([0, 1, 5, 8, 99].map((s) => r.store.countDelegationEventsAtOrBelow(s))).toEqual([0, 1, 5, 8, 8]);
    expect(r.store.deleteDelegationEventsBetween(2, 7, 2)).toBe(2);
    expect(rowSequences(r.db)).toEqual([1, 2, 5, 6, 7, 8]);
    expect(r.store.countDelegationEventsAtOrBelow(5)).toBe(3);
    expect(r.store.deleteDelegationEventsBetween(2, 7, 2)).toBe(2);
    expect(rowSequences(r.db)).toEqual([1, 2, 7, 8]);
    expect(r.store.deleteDelegationEventsBetween(2, 7, 2)).toBe(1);
    expect(r.store.deleteDelegationEventsBetween(2, 7, 2)).toBe(0);
    expect(rowSequences(r.db)).toEqual([1, 2, 8]);
    expect(r.store.deleteDelegationEventsBetween(0, 8, 0)).toBe(0);
    expect(r.store.delegationEventStats()).toEqual({ count: 3, maxSequence: 8 });
  });
});

// ── Task 3.1: the upkeep door (at the door; the lane's rows are delegation-compaction-lane.test.ts's) ───────────────────

describe('Task 3.1: the upkeep door: one commit instead of the hourly whole-checkpoint replace', () => {
  const HOUR_MS = Date.UTC(2026, 9, 15, 10);
  const NOW_MS = HOUR_MS + MIN;                                  // the first minute of an hour
  const bucketBack = (back: number): string => iso(HOUR_MS - back * HOUR).replace(/[-:T]/g, '').slice(0, 10);
  const hourBack = (back: number): string => iso(HOUR_MS - back * HOUR);
  /** A directory holding a zero-delta Bash call on a key an old-rule checkpoint maps (retirable), then an applier over it carrying an interval
   *  row past retention and a cursor past 48 h with its hour on file. */
  async function upkeepRig(): Promise<{ r: Rig; dur: DelegationDurability }> {
    const { oldRuleCheckpoint } = await import('./delegationOldRuleFixture.js');
    const records = chainOf([ev(sessionStart(HOUR_MS - 3 * HOUR)), ev(bashPre(HOUR_MS - 3 * HOUR + MIN, 'toolu_z', ['a'])), ev(bashPost(HOUR_MS - 3 * HOUR + 2 * MIN, 'toolu_z', ['a']))]);
    const dir = mkTmp('ccrc-deleg-upkeep-');
    writeFileSync(path.join(dir, DELEGATION_JOURNAL_FILE), Buffer.concat(records.map(encodeDelegationJournalRecord)));
    writeFileSync(path.join(dir, DELEGATION_CHECKPOINT_FILE), encodeDelegationCheckpoint({ ...oldRuleCheckpoint(records), revision: 1 }));
    const r = rig({ dir });
    const dur = await r.open();
    const cursor = (back: number) => ({ sessionId: PARENT, parentIncarnation: INC, bucket: bucketBack(back), cursor: 10, lastSize: 10, lastCompleteAt: iso(HOUR_MS - back * HOUR + 5 * MIN),
      intervalState: 'measured' as const, detail: null, anchor: { start: 0, sha256: 'a'.repeat(64) }, replaced: false });
    const interval = (back: number) => ({ sessionId: PARENT, parentIncarnation: INC, utcHour: hourBack(back), state: 'measured' as const, detail: null, recordedAt: iso(HOUR_MS - back * HOUR + 2 * HOUR) });
    await dur.applyAccepted({ accepted: [], cursor: cursor(49), interval: interval(49) });
    await dur.applyAccepted({ accepted: [], cursor: null, interval: interval(200) });
    return { r, dur };
  }

  it('Task 3.1 (door): all three parts due make ONE commit: one encode, one write, the revision advances by exactly one', async () => {
    const { dur } = await upkeepRig();
    const before = dur.commitMeasures();
    const revision = dur.state().checkpoint.revision;
    const out = await dur.upkeep({ nowMs: NOW_MS, intervals: true, cursors: true, zeroDelta: true });
    const after = dur.commitMeasures();
    expect(out).toMatchObject({ intervalsChanged: true, cursorsDropped: 1, cursorsUnparseable: 0, retired: 1 });
    expect(out.applied?.durable).toBe(true);
    expect(after.encodes - before.encodes, 'no no-op compare').toBe(1);
    expect(after.writes - before.writes).toBe(1);
    expect(dur.state().checkpoint.revision).toBe(revision + 1);
    expect(dur.state().checkpoint.bucketCursors).toEqual([]);
    expect(dur.state().checkpoint.observationIntervals.some((i) => i.utcHour === hourBack(200))).toBe(false);
  });

  it('Task 3.1 (door): nothing due: no commit, no encode, no write', async () => {
    const { dur } = await upkeepRig();
    await dur.upkeep({ nowMs: NOW_MS, intervals: true, cursors: true, zeroDelta: true });
    const before = dur.commitMeasures();
    const revision = dur.state().checkpoint.revision;
    const out = await dur.upkeep({ nowMs: NOW_MS, intervals: true, cursors: true, zeroDelta: true });
    expect(out).toEqual({ intervalsChanged: false, cursorsDropped: 0, cursorsUnparseable: 0, retired: 0, applied: null });
    expect(dur.commitMeasures().encodes).toBe(before.encodes);
    expect(dur.commitMeasures().writes).toBe(before.writes);
    expect(dur.state().checkpoint.revision).toBe(revision);
  });

  it('Task 3.1 (door): the interval part alone, mid-hour, drops no cursor', async () => {
    const { dur } = await upkeepRig();
    const out = await dur.upkeep({ nowMs: NOW_MS + 30 * MIN, intervals: true, cursors: false, zeroDelta: false });
    expect(out).toMatchObject({ intervalsChanged: true, cursorsDropped: 0, retired: 0 });
    expect(dur.state().checkpoint.bucketCursors.map((c) => c.bucket)).toEqual([bucketBack(49)]);
  });
});
