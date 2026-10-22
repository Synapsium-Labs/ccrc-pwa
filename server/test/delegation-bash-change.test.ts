// D-6267: rule A, "a Bash call opens an activity only when its worktree listing changed" (operator ruling "open only on a change").
//
// Before D-6267 a Bash PreToolUse or PostToolUse that carried a worktree `listing` was a qualifying join, so every listed call opened an
// activity at its first listing-carrying record, and 98.8% of those calls never changed the listing. Under rule A a listing-carrying
// PreToolUse makes its call PENDING (held as an identity candidate, aged on the journal's `acceptedAt` alone), and the call opens at its
// PostToolUse only when the two listings differ as SETS, or the PostToolUse carries none; the PreToolUse is then the identity record. A
// call whose PostToolUse names the same records opens nothing; a PostToolUse that finds no pending PreToolUse (none measured, shed, or
// forgotten after `DELEGATION_BASH_PENDING_MS`) opens the call with itself as identity (D-4649); a call with no listing on either side
// opens nothing. These rows are the executable form of the decision tables and of the fold order, and hold the one Bash-call map the
// builder keeps (never encoded, rebuilt at recovery from the retained journal like the identity candidates) to them.
//
// WHAT THIS FILE PINS
//   A1-A10    the decision table, by what the two records carry (equal, delta, removal, set-equal spellings, no Post, a Post without a
//             listing, `truncated` on either side, a Post alone, no listing on either side)
//   A11-A11c  ageing: the bound, journal time only (`acceptedAt`, never `observedAt` and never a clock), `>=`, and its fold position
//   A12-A12i  the durable applier and `clone()`: a pending call survives one application to the next
//   A13-A16b  recovery: a checkpoint that covers a pending call, an old-rule checkpoint recovered under the new rule, a lost row,
//             the holds a pending call writes and the holds ageing removes
//   A17       the equal-listing drop and correlation's zero delta are the same predicate, over all 64 pairs of subsets of three names
//   A20, A21  a second PreToolUse of a call; ageing sweeps the Bash map and never an agent candidate
// (A19 lives in `delegation-correlation.test.ts`, A22 in `delegation-wave3.integration.test.ts`.)
//
// THE NEW NAMES. `DELEGATION_BASH_PENDING_MS` is reached through a namespace import and a cast, so that this file is type-clean against
// code that has none of it yet and each row then fails on its own assertion, never as a whole file on an import error. The literal
// fallback (one hour, the ruled value) exists ONLY so the rows run at the base; at the tip the constant is the bound.
//
// JOURNAL TIME ONLY. Every chain whose ageing matters is built by `chainAt`, which stamps each record's `acceptedAt` from a literal
// instant; `observedAt` is the event's own and is a separate axis (A11b separates them on purpose). Nothing here reads a wall clock or
// a random number: the applier rows inject a clock that the test moves.
//
// Fixtures only: names are `lane-a-demo`, `lane-b-demo`, `project-a`, `main-wt`, `wt-raw`. The one directory made is a fixture directory
// from `mkTmp`; nothing reads or writes a live home.
import { afterEach, describe, it, expect } from 'vitest';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import { buildDelegationJournalRecord, nodeDelegationFilePort } from '../src/coord/delegation-journal.js';
import {
  DelegationCheckpointBuilder,
  DelegationDurability,
  encodeDelegationCheckpoint,
  recoverDelegation,
} from '../src/coord/delegation-checkpoint.js';
import { correlateDelegation, indexDelegationDropped, type DelegationCorrelationInput } from '../src/coord/delegation-correlation.js';
import * as modelNs from '../src/coord/delegation-model.js';
import {
  canonicalDelegationJson,
  delegationSha256Hex,
  deriveDelegationActivityId,
  emptyDelegationCheckpoint,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  type DelegationActivityRow,
  type DelegationCensusRecord,
  type DelegationCheckpointV1,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
  type DelegationPruningHold,
} from '../src/coord/delegation-model.js';
import { delegationListingWindowsOf } from '../src/watch.js';
import { oldRuleCheckpoint } from './delegationOldRuleFixture.js';
import { mkTmp } from './tmpHelpers.js';

// ── the new names, by namespace ──────────────────────────────────────────────────────────────────────────────────────

/** How long a listing-carrying PreToolUse waits, in journal time, for its PostToolUse. The literal is the ruled value and is a fallback only
 *  so the rows run at the base, where the constant does not exist. */
const BOUND = (modelNs as unknown as { DELEGATION_BASH_PENDING_MS?: number }).DELEGATION_BASH_PENDING_MS ?? 3_600_000;

// ── fixtures (the shapes of `delegation-correlation.test.ts`; a test file imports no other test file) ────────────────────

const PARENT = 'lane-a-demo';
const OTHER = 'lane-b-demo';
const INC = 'g1';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const AGENT = 'abc123def456';
const REPO = 'project-a';
const WT = (name: string): string => `/fixture/${REPO}/.claude/worktrees/${name}`;
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + s * 1000);
const eid = (n: number): string => delegationSha256Hex(`fixture-bash-change-event-${n}`);
/** The first accepted instant of an ageing chain (epoch ms). */
const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);

interface Over { sessionId?: string; parentIncarnation?: string; claudeSessionId?: string; cwd?: string }
const base = (n: number, over: Over = {}) => ({
  v: 1 as const, observedAt: T(n), sessionId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC,
  claudeSessionId: over.claudeSessionId ?? CLAUDE, ...(over.cwd === undefined ? {} : { cwd: over.cwd }),
  eventId: eid(n + (over.sessionId === OTHER ? 5000 : 0)), bucket: '2026101400', startOffset: n * 100, endOffset: n * 100 + 99,
});
const sessionStart = (n: number, over: Over = {}, source = 'startup'): DelegationEventEnvelopeV1 => ({ ...base(n, over), eventKind: 'SessionStart', source });
/** A tool event that names an agent only through the common `agentId` field: the event's EMITTER. Not a qualifying join. */
const bareTool = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', agentId });
const bashPre = (n: number, toolUseId: string, listing?: readonly string[], over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId, ...(listing === undefined ? {} : { listing }) });
const bashPost = (n: number, toolUseId: string, listing?: readonly string[], over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId, outcome: 'completed', ...(listing === undefined ? {} : { listing }) });
/** The hook shed the listing of a line already cut for another field: `truncated: true` and no `listing`. */
const shed = (e: DelegationEventEnvelopeV1): DelegationEventEnvelopeV1 => ({ ...e, truncated: true as const });

const evidence = (event: DelegationEventEnvelopeV1): DelegationJournalEntryV1 => ({ kind: 'evidence-accepted', event });
/** Records accepted one second apart, far from any bound; observedAt is the event's own. */
function evidenceChain(events: readonly DelegationEventEnvelopeV1[]): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev: string | null = null;
  events.forEach((event, i) => {
    const r = buildDelegationJournalRecord({ sequence: i + 1, acceptedAt: T(100000 + i + 1), previousDigest: prev, entry: evidence(event) });
    out.push(r);
    prev = r.digest;
  });
  return out;
}
/**
 * A chain whose records are accepted at the given journal instants (epoch ms), in order. The ONE helper for every row whose ageing
 * matters: ageing reads `acceptedAt` only, never `observedAt` and never a clock (D-6267).
 */
function chainAt(entries: readonly (readonly [DelegationEventEnvelopeV1, number])[]): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev: string | null = null;
  entries.forEach(([event, acceptedAtMs], i) => {
    const r = buildDelegationJournalRecord({ sequence: i + 1, acceptedAt: formatDelegationInstant(acceptedAtMs), previousDigest: prev, entry: evidence(event) });
    out.push(r);
    prev = r.digest;
  });
  return out;
}

/** The fold of a journal: what the checkpoint holds, and the evidence as correlation is handed it. */
function world(events: readonly DelegationEventEnvelopeV1[]) {
  const records = evidenceChain(events);
  const report = recoverDelegation(null, records);
  expect(report.failure).toBeNull();
  const acceptedEvidence = records.map((r) => {
    if (r.entry.kind !== 'evidence-accepted') throw new Error('fixture journals hold evidence only');
    return { journalId: r.journalId, event: r.entry.event };
  });
  return { records, report, builder: report.facts!.builder, cp: report.state.checkpoint, activities: report.state.checkpoint.activities, acceptedEvidence };
}

const bashKey = (upstreamId: string, over: Over = {}) =>
  ({ parentId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, sourceKind: 'bash-worktree' as const, upstreamId });
const encodeBash = (upstreamId: string, over: Over = {}): string => encodeDelegationNaturalKey(bashKey(upstreamId, over));
const encodeAgent = (agentId: string): string => encodeDelegationNaturalKey({ parentId: PARENT, parentIncarnation: INC, sourceKind: 'agent', upstreamId: agentId });
/** The hold a pending Bash call writes: the call's first listing-carrying PreToolUse, owned by the call's encoded natural key. */
const bashHold = (journalId: string, upstreamId: string): DelegationPruningHold => ({ journalId, reason: 'identity-candidate', ownerId: encodeBash(upstreamId) });
/** Every identity-candidate hold whose owner is a Bash call. */
const bashHoldsOf = (cp: DelegationCheckpointV1): DelegationPruningHold[] =>
  cp.pruningHolds.filter((h) => h.reason === 'identity-candidate' && h.ownerId.includes('bash-worktree'));
const holdReasons = (cp: DelegationCheckpointV1): string[] => cp.pruningHolds.map((h) => h.reason);
const bashRowsOf = (cp: DelegationCheckpointV1): DelegationActivityRow[] => cp.activities.filter((a) => a.sourceKind === 'bash-worktree');
const rowOf = (cp: DelegationCheckpointV1, upstreamId: string): DelegationActivityRow | undefined => cp.activities.find((a) => a.upstreamId === upstreamId);
const withoutRevision = (cp: DelegationCheckpointV1): string => canonicalDelegationJson({ ...cp, revision: 0 });
const sameSet = (x: readonly string[], y: readonly string[]): boolean => {
  const sx = new Set(x);
  const sy = new Set(y);
  return sx.size === sy.size && [...sx].every((n) => sy.has(n));
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// the decision table
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('D-6267 rule A: what a Bash call opens, by what its two records carry', () => {
  it('A1: a PreToolUse and a PostToolUse naming the same records open nothing: no activity, no mapping, no hold', () => {
    const w = world([bashPre(1, 'toolu_z', ['main-wt']), bashPost(2, 'toolu_z', ['main-wt'])]);
    expect(w.activities, 'an equal call opens no activity').toEqual([]);
    expect(w.cp.activityIdsByNaturalKey).toEqual({});
    expect(holdReasons(w.cp)).toEqual(['checkpoint-anchor']);
  });

  // GREEN at the base by design (the old rule also opened here, with the same row); mutant MA8 (the open uses the POST's identity) reds it.
  it('A2: a delta call opens ONE row at its PostToolUse with the PreToolUse as identity, field for field what the old rule wrote', () => {
    const w = world([bashPre(1, 'toolu_z', ['main-wt']), bashPost(2, 'toolu_z', ['main-wt', 'wt-raw'])]);
    const activityId = deriveDelegationActivityId(bashKey('toolu_z'), w.records[0]!.journalId);
    expect(w.activities).toEqual([{
      activityId, parentId: PARENT, parentIncarnation: INC, sourceKind: 'bash-worktree', upstreamId: 'toolu_z',
      identityJournalId: w.records[0]!.journalId, displayName: null, executionState: 'ended', openedAt: T(1), endedAt: T(2), lastEventAt: T(2),
    }]);
    expect(w.cp.activityIdsByNaturalKey).toEqual({ [encodeBash('toolu_z')]: activityId });
  });

  it('A3: a PreToolUse with a listing and no PostToolUse opens nothing, and its record is held as the call\'s identity candidate', () => {
    const w = world([bashPre(1, 'toolu_z', ['main-wt'])]);
    expect(w.activities, 'a pending Pre opens no activity').toEqual([]);
    expect(w.cp.activityIdsByNaturalKey).toEqual({});
    expect(w.cp.pruningHolds).toContainEqual(bashHold(w.records[0]!.journalId, 'toolu_z'));
  });

  // GREEN at the base by design (the old rule opened at the Pre and the Post ended it); mutant MA3 (listing equality ignores removals) reds it.
  it('A4: a removal is a change: Pre [a,b] then Post [a] opens one row, the PreToolUse its identity, ended', () => {
    const w = world([bashPre(1, 'toolu_z', ['a', 'b']), bashPost(2, 'toolu_z', ['a'])]);
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]).toMatchObject({ upstreamId: 'toolu_z', identityJournalId: w.records[0]!.journalId, executionState: 'ended', openedAt: T(1), endedAt: T(2) });
  });

  // MA4 (an order-sensitive compare) reds the first two cases at the tip.
  it.each([
    ['the same names in another order', ['b', 'a'], ['a', 'b']],
    ['a repeated name', ['a', 'a'], ['a']],
    ['two empty listings', [], []],
  ] as const)('A5: set-equal listings (%s) open nothing and hold nothing', (_label, before, after) => {
    const w = world([bashPre(1, 'toolu_z', before), bashPost(2, 'toolu_z', after)]);
    expect(w.activities, 'set-equal listings open no activity').toEqual([]);
    expect(bashHoldsOf(w.cp)).toEqual([]);
    expect(w.cp.activityIdsByNaturalKey).toEqual({});
  });

  // GREEN at the base by design; mutant MA6 (a Post without a listing drops the pending Pre, absent read as equal) reds it.
  it('A6: a PostToolUse with neither a listing nor `truncated` opens the call with the PreToolUse as identity, ended at the PostToolUse', () => {
    const w = world([bashPre(1, 'toolu_z', ['main-wt']), bashPost(2, 'toolu_z')]);
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]).toMatchObject({ identityJournalId: w.records[0]!.journalId, executionState: 'ended', openedAt: T(1), endedAt: T(2) });
  });

  // GREEN at the base by design; mutant MA6 reds it.
  it('A7: a PostToolUse that is `truncated` (its listing shed) opens the call the same way: the PreToolUse is the identity, ended', () => {
    const w = world([bashPre(1, 'toolu_z', ['main-wt']), shed(bashPost(2, 'toolu_z'))]);
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]).toMatchObject({ identityJournalId: w.records[0]!.journalId, executionState: 'ended', openedAt: T(1), endedAt: T(2) });
  });

  // GREEN at the base by design (D-4649 already skips a PreToolUse without a listing); mutant MA7 (a Post with no entry returns without opening) reds it.
  it('A8: a `truncated` PreToolUse pends nothing, so a PostToolUse that carries a listing is the identity record (D-4649)', () => {
    const w = world([shed(bashPre(1, 'toolu_z')), bashPost(2, 'toolu_z', ['main-wt'])]);
    expect(bashHoldsOf(world([shed(bashPre(1, 'toolu_z'))]).cp), 'no hold after the shed PreToolUse alone').toEqual([]);
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]).toMatchObject({ identityJournalId: w.records[1]!.journalId, executionState: 'ended', openedAt: T(2), endedAt: T(2) });
    expect(bashHoldsOf(w.cp)).toEqual([]);
  });

  // GREEN at the base by design; mutant MA7 reds it.
  it('A9: a PostToolUse that carries a listing and finds no PreToolUse opens the call with itself as identity, ended', () => {
    const w = world([bashPost(1, 'toolu_z', ['main-wt'])]);
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]).toMatchObject({ identityJournalId: w.records[0]!.journalId, executionState: 'ended', openedAt: T(1), endedAt: T(1) });
    expect(bashHoldsOf(w.cp)).toEqual([]);
  });

  // GREEN at the base and at the tip: the control for "a call with no listing on either side opens nothing" (`truncated` included).
  // Mutant MA-nolisting-pends (a listing-less PreToolUse pends) reds it.
  it('A10: a call with no listing on either side, `truncated` included, opens nothing and holds nothing', () => {
    const plain = world([bashPre(1, 'toolu_n'), bashPost(2, 'toolu_n')]);
    expect(plain.activities).toEqual([]);
    expect(holdReasons(plain.cp)).toEqual(['checkpoint-anchor']);
    const cut = world([shed(bashPre(1, 'toolu_n')), shed(bashPost(2, 'toolu_n'))]);
    expect(cut.activities).toEqual([]);
    expect(holdReasons(cut.cp)).toEqual(['checkpoint-anchor']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ageing: journal time, the bound, and the fold position
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('D-6267 ageing: a pending PreToolUse is forgotten DELEGATION_BASH_PENDING_MS after it was accepted, on acceptedAt alone', () => {
  // MA9 (the ageing call deleted) reds it; MA11 (`>=` becomes `>`) reds (b).
  it('A11: a pending call is held until a record is accepted at Pre + BOUND, then forgotten; its equal PostToolUse then opens the call with itself as identity', () => {
    const records = chainAt([
      [bashPre(1, 'toolu_z', ['main-wt']), T0],
      [sessionStart(2, { sessionId: OTHER }), T0 + BOUND - 1],
      [sessionStart(3, { sessionId: OTHER }), T0 + BOUND],
      [bashPost(4, 'toolu_z', ['main-wt']), T0 + BOUND + 1000],
    ]);
    const b = DelegationCheckpointBuilder.from(emptyDelegationCheckpoint());
    b.foldRecord(records[0]!);
    b.foldRecord(records[1]!);
    expect(bashHoldsOf(b.build(1)), '(a) one millisecond short of the bound the call is still pending').toEqual([bashHold(records[0]!.journalId, 'toolu_z')]);
    b.foldRecord(records[2]!);
    expect(bashHoldsOf(b.build(1)), '(b) a record accepted at exactly Pre + BOUND forgets it').toEqual([]);
    b.foldRecord(records[3]!);
    const cp = b.build(1);
    expect(bashRowsOf(cp)).toHaveLength(1);
    expect(bashRowsOf(cp)[0]).toMatchObject({ upstreamId: 'toolu_z', identityJournalId: records[3]!.journalId, executionState: 'ended', openedAt: T(4), endedAt: T(4) });
  });

  // MA10 (age by observedAt) reds it; MA-clock reds it only with the wall clock as the builder's default.
  it('A11b: ageing reads acceptedAt, never observedAt: records observed hours apart but accepted a minute apart do not age the Pre', () => {
    const farN = 1 + (2 * BOUND) / 1000;
    const records = chainAt([
      [bashPre(1, 'toolu_z', ['main-wt']), T0],
      [sessionStart(farN, { sessionId: OTHER }), T0 + 60_000],
      [bashPost(farN + 1, 'toolu_z', ['main-wt']), T0 + 120_000],
    ]);
    expect(Date.parse(T(farN)) - Date.parse(T(1))).toBe(2 * BOUND);        // observedAt really is far apart, acceptedAt really is close
    const report = recoverDelegation(null, records);
    expect(report.failure).toBeNull();
    expect(bashRowsOf(report.state.checkpoint), 'the equal Post consumed the Pre: accepted-time gap is a minute').toEqual([]);
    expect(holdReasons(report.state.checkpoint)).toEqual(['checkpoint-anchor']);
  });

  // MA12 (ageing runs BEFORE naming) reds it.
  it('A11c: a PostToolUse accepted past the bound still consumes its own PreToolUse: ageing runs AFTER naming', () => {
    const records = chainAt([
      [bashPre(1, 'toolu_z', ['main-wt']), T0],
      [bashPost(2, 'toolu_z', ['main-wt']), T0 + BOUND + 1000],
    ]);
    const report = recoverDelegation(null, records);
    expect(report.failure).toBeNull();
    expect(bashRowsOf(report.state.checkpoint), 'the Post consumed its own Pre before ageing ran').toEqual([]);
    expect(holdReasons(report.state.checkpoint)).toEqual(['checkpoint-anchor']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// the applier and clone(): a pending call survives from one application to the next
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Every applier a test opens, closed after the test so no descriptor is left to the garbage collector. */
const opened: DelegationDurability[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close().catch(() => undefined)));
});
/** A ready applier on a fixture directory, no SQLite, its clock a number the test moves. */
async function openApplier(dir: string, clock: { ms: number }): Promise<DelegationDurability> {
  const d = await DelegationDurability.open({
    dir, projection: null, now: () => clock.ms, randomUUID: () => '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f', port: nodeDelegationFilePort, warn: () => undefined,
  });
  opened.push(d);
  expect(d.failure()).toBeNull();
  return d;
}
const batchOf = (events: readonly DelegationEventEnvelopeV1[]) => ({ accepted: events.map((event) => ({ event })), cursor: null, interval: null });
const intervalChange = (cp: DelegationCheckpointV1): DelegationCheckpointV1 =>
  ({ ...cp, observationIntervals: [{ sessionId: PARENT, parentIncarnation: INC, utcHour: '2026101400', state: 'measured', detail: null, recordedAt: T(9) }] });

describe('D-6267 across applications and clones', () => {
  // MA13 (clone() leaves bashCalls empty) reds both; MB15 (replaceRows resets the map) reds (b).
  it.each([
    ['(a) two applications', false],
    ['(b) an interval-only checkpoint change between them', true],
  ] as const)('A12: %s: the PreToolUse of one application is the identity of the call the next one opens', async (_label, withChange) => {
    const dir = mkTmp('ccrc-bash-change-');
    const clock = { ms: T0 };
    const dur = await openApplier(dir, clock);
    const first = await dur.applyAccepted(batchOf([bashPre(1, 'toolu_z', ['main-wt'])]));
    const preId = first.appended[0]!.journalId;
    expect(bashHoldsOf(dur.state().checkpoint), 'after application 1 the pending Pre is held').toEqual([bashHold(preId, 'toolu_z')]);
    if (withChange) {
      await dur.applyCheckpointChange(intervalChange);
      expect(bashHoldsOf(dur.state().checkpoint), 'the change kept it').toEqual([bashHold(preId, 'toolu_z')]);
    }
    clock.ms += 1000;
    await dur.applyAccepted(batchOf([bashPost(2, 'toolu_z', ['main-wt', 'wt-raw'])]));
    const cp = dur.state().checkpoint;
    expect(bashRowsOf(cp)).toHaveLength(1);
    expect(bashRowsOf(cp)[0]).toMatchObject({ upstreamId: 'toolu_z', identityJournalId: preId, executionState: 'ended' });
    expect(bashHoldsOf(cp), 'the decided call holds nothing').toEqual([]);
  });

  // MA14 (clone() aliases bashCalls) reds it.
  it('A12i: a clone owns its Bash map: folding a PreToolUse into the clone leaves the original with no pending call', () => {
    const records = evidenceChain([sessionStart(1), bashPre(2, 'toolu_z', ['main-wt'])]);
    const a = recoverDelegation(null, records.slice(0, 1)).facts!.builder;
    const b = a.clone();
    b.foldRecord(records[1]!);
    expect(bashHoldsOf(a.build(1)), 'the original is untouched').toEqual([]);
    expect(bashHoldsOf(b.build(1)), 'the clone holds the pending call').toEqual([bashHold(records[1]!.journalId, 'toolu_z')]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// recovery
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('D-6267 recovery: the map is rebuilt from the retained journal', () => {
  // MA15 (recovery does not learn the pending calls of covered records) reds it. At the base the z row exists.
  it('A13: a checkpoint written while two Pres were pending, recovered over the journal that decides them, reaches the same state as a fold from nothing', () => {
    const full = chainAt([
      [bashPre(1, 'toolu_d', ['main-wt']), T0],
      [sessionStart(2, { sessionId: OTHER }), T0 + 1000],
      [bashPre(3, 'toolu_z', ['main-wt']), T0 + 2000],
      [bashPost(4, 'toolu_d', ['main-wt', 'wt-raw']), T0 + 3000],
      [bashPost(5, 'toolu_z', ['main-wt']), T0 + 4000],
    ]);
    const prefix = full.slice(0, 3);
    const cp = recoverDelegation(null, prefix).state.checkpoint;
    const resumed = recoverDelegation(encodeDelegationCheckpoint(cp), full);
    expect(resumed.failure).toBeNull();
    const fresh = recoverDelegation(null, full);
    expect(fresh.failure).toBeNull();
    expect(withoutRevision(resumed.state.checkpoint)).toBe(withoutRevision(fresh.state.checkpoint));
    expect(rowOf(resumed.state.checkpoint, 'toolu_d')?.identityJournalId).toBe(prefix[0]!.journalId);
    expect(rowOf(resumed.state.checkpoint, 'toolu_z'), 'the equal call z opens no row').toBeUndefined();
  });

  // MA-clock (recovery ages by the applier's clock) reds it: the observe pass ages the covered Pre at once and the covered Post refuses.
  it('A13b: a restart long after the records were accepted ages nothing: recovery reads journal time, never the clock', async () => {
    const dir = mkTmp('ccrc-bash-change-');
    const clock = { ms: T0 };
    const dur = await openApplier(dir, clock);
    await dur.applyAccepted(batchOf([bashPre(1, 'toolu_z', ['main-wt'])]));
    clock.ms = T0 + 1000;
    await dur.applyAccepted(batchOf([bashPost(2, 'toolu_z', ['main-wt'])]));
    const before = dur.state().checkpoint;
    expect(bashRowsOf(before), 'the equal call opened nothing').toEqual([]);
    clock.ms = T0 + 2 * BOUND;
    const report = await dur.recover();
    expect(report.failure).toBeNull();
    expect(dur.failure()).toBeNull();
    expect(dur.state().phase).toBe('ready');
    expect(bashRowsOf(dur.state().checkpoint)).toEqual([]);
    expect(withoutRevision(dur.state().checkpoint)).toBe(withoutRevision(before));
  });

  it('A14: a legacy checkpoint recovered under rule A keeps its rows and IDs, opens by the new rule from the suffix on, and a fresh checkpoint over the whole journal agrees with itself', () => {
    const records = chainAt([
      [bashPre(1, 'toolu_z1', ['main-wt']), T0],
      [bashPost(2, 'toolu_z1', ['main-wt']), T0 + 1000],
      [bashPre(3, 'toolu_d1', ['main-wt']), T0 + 2000],
      [bashPost(4, 'toolu_d1', ['main-wt', 'wt-raw']), T0 + 3000],
      [bashPre(5, 'toolu_n1', ['main-wt']), T0 + 4000],
      [sessionStart(6, { sessionId: OTHER }), T0 + 5000],
      // the suffix
      [bashPost(7, 'toolu_n1', ['main-wt']), T0 + 6000],
      [bashPre(8, 'toolu_z2', ['main-wt']), T0 + 7000],
      [bashPost(9, 'toolu_z2', ['main-wt']), T0 + 8000],
      [bashPre(10, 'toolu_d2', ['main-wt']), T0 + 9000],
      [bashPost(11, 'toolu_d2', ['main-wt', 'wt-raw']), T0 + 10_000],
      [bashPre(12, 'toolu_n2', ['main-wt']), T0 + 11_000],
    ]);
    const legacy = oldRuleCheckpoint(records.slice(0, 6));
    const resumed = recoverDelegation(encodeDelegationCheckpoint(legacy), records);
    expect(resumed.failure).toBeNull();
    const cp = resumed.state.checkpoint;
    for (const id of ['toolu_z1', 'toolu_d1', 'toolu_n1']) {
      expect(rowOf(cp, id)?.activityId, `${id} keeps its ID`).toBe(rowOf(legacy, id)!.activityId);
    }
    expect(rowOf(cp, 'toolu_n1')?.executionState, 'its Post in the suffix ends the old-rule active row').toBe('ended');
    expect(rowOf(cp, 'toolu_d2')?.identityJournalId, 'a suffix delta call has the Pre as identity').toBe(records[9]!.journalId);
    expect(rowOf(cp, 'toolu_z2'), 'a suffix equal call opens no row').toBeUndefined();
    expect(rowOf(cp, 'toolu_n2'), 'a suffix pending call opens no row').toBeUndefined();
    expect(bashHoldsOf(cp)).toEqual([bashHold(records[11]!.journalId, 'toolu_n2')]);
    // (c): a second checkpoint over the WHOLE journal under the new rule, recovered again
    const whole = recoverDelegation(null, records).state.checkpoint;
    const wholeBytes = encodeDelegationCheckpoint(whole);
    const again = recoverDelegation(wholeBytes, records);
    expect(again.failure).toBeNull();
    expect(Buffer.from(encodeDelegationCheckpoint(again.state.checkpoint)).equals(Buffer.from(wholeBytes))).toBe(true);
  });

  // GREEN at the base by design (the old rule already refuses a join with no row); mutant MA17 (observe mode opens instead of refusing) reds it.
  it('A15: a checkpoint that lost the row of a decided call is refused fold-refused in the identity-evidence phase', () => {
    const records = chainAt([
      [bashPre(1, 'toolu_d', ['main-wt']), T0],
      [bashPost(2, 'toolu_d', ['main-wt', 'wt-raw']), T0 + 1000],
      [sessionStart(3, { sessionId: OTHER }), T0 + 2000],
    ]);
    const good = recoverDelegation(null, records).state.checkpoint;
    expect(bashRowsOf(good)).toHaveLength(1);
    const lost: DelegationCheckpointV1 = {
      ...good, activities: good.activities.filter((a) => a.upstreamId !== 'toolu_d'), activityIdsByNaturalKey: {},
      pruningHolds: good.pruningHolds.filter((h) => h.reason === 'checkpoint-anchor'),
    };
    const report = recoverDelegation(encodeDelegationCheckpoint(lost), records);
    expect(report.failure).toMatchObject({ code: 'fold-refused', phase: 'identity-evidence' });
    expect(report.state.phase).toBe('reconstructing');
  });

  // MA16 (a pending call is not held) reds it, and (a) through the missing hold.
  it('A16: (a) a checkpoint taken with a Pre pending recovers over the same records to the same bytes', () => {
    const records = chainAt([[bashPre(1, 'toolu_p', ['main-wt']), T0], [sessionStart(2, { sessionId: OTHER }), T0 + 1000]]);
    const persisted = recoverDelegation(null, records).state.checkpoint;
    expect(persisted.pruningHolds).toContainEqual(bashHold(records[0]!.journalId, 'toolu_p'));
    const bytes = encodeDelegationCheckpoint(persisted);
    const report = recoverDelegation(bytes, records);
    expect(report.failure).toBeNull();
    expect(report.replayed).toBe(0);
    expect(Buffer.from(encodeDelegationCheckpoint(report.state.checkpoint)).equals(Buffer.from(bytes))).toBe(true);
  });

  it('A16: (b) the same checkpoint over a journal that no longer retains the pending Pre is refused held-evidence-missing', () => {
    const records = chainAt([[bashPre(1, 'toolu_p', ['main-wt']), T0], [sessionStart(2, { sessionId: OTHER }), T0 + 1000], [sessionStart(3, { sessionId: OTHER }), T0 + 2000]]);
    const bytes = encodeDelegationCheckpoint(recoverDelegation(null, records).state.checkpoint);
    const report = recoverDelegation(bytes, records.slice(1));
    expect(report.failure).toMatchObject({ code: 'held-evidence-missing', phase: 'holds' });
    expect(report.state.phase).toBe('reconstructing');
  });

  // GREEN at the base by design (the old rule holds nothing for a Bash call); mutant MA-age-fold-only (ageing only when folding, not when
  // observing) reds it: the recovered state would hold the aged Pre again and its bytes would differ from the persisted file's.
  it('A16b: a Pre aged out in the covered prefix has no hold, and recovery over the same records reproduces the persisted bytes', () => {
    const records = chainAt([[bashPre(1, 'toolu_p', ['main-wt']), T0], [sessionStart(2, { sessionId: OTHER }), T0 + BOUND]]);
    const persisted = recoverDelegation(null, records).state.checkpoint;
    expect(bashHoldsOf(persisted)).toEqual([]);
    const bytes = encodeDelegationCheckpoint(persisted);
    const report = recoverDelegation(bytes, records);
    expect(report.failure).toBeNull();
    expect(bashHoldsOf(report.state.checkpoint)).toEqual([]);
    expect(Buffer.from(encodeDelegationCheckpoint(report.state.checkpoint)).equals(Buffer.from(bytes))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// equal listings and correlation's zero delta are one predicate
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const NAMES = ['a', 'b', 'c'] as const;
const SUBSETS: string[][] = Array.from({ length: 8 }, (_, mask) => NAMES.filter((_n, i) => ((mask >> i) & 1) === 1));
const PAIRS: [string, string[], string[]][] = SUBSETS.flatMap((before) => SUBSETS.map((after): [string, string[], string[]] => [`[${before.join(',')}] then [${after.join(',')}]`, before, after]));

const censusRecordOf = (name: string): DelegationCensusRecord => ({
  project: REPO, adminRecord: name, canonicalPath: WT(name), headBranch: `branch-${name}`, headSha: null,
  claudeBase: 'main', locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null,
});
const correlationInput = (record: DelegationCensusRecord, w: ReturnType<typeof world>, listingWindows: DelegationCorrelationInput['listingWindows']): DelegationCorrelationInput => ({
  record, runChildAgreement: null, activities: w.activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [], listingWindows,
  birthPassesRemaining: 0, hasRegistryRow: false, hasChildMarker: false, evidenceHorizon: null, droppedEvidence: indexDelegationDropped([]),
  firstSighting: { after: T(1_000_000), at: T(1_000_060) },
});

describe('D-6267 the equal-listing drop is correlation\'s zero delta', () => {
  // The expectation is computed here from sets, never from the helper under test. MA2 (the drop removed), MA3 (removals ignored) and
  // MA5 (lengths compared only) red it.
  it.each(PAIRS)('A17: Pre %s: one row iff the two listings differ as sets, and a sole addition links at rung 4 to that row', (_label, before, after) => {
    const w = world([bashPre(10, 'toolu_b1', before), bashPost(12, 'toolu_b1', after)]);
    const equal = sameSet(before, after);
    const rows = bashRowsOf(w.cp);
    expect(rows, equal ? 'equal listings open nothing' : 'differing listings open one row').toHaveLength(equal ? 0 : 1);
    const added = after.filter((n) => !before.includes(n));
    const removed = before.filter((n) => !after.includes(n));
    if (added.length === 1 && removed.length === 0) {
      const windows = delegationListingWindowsOf(w.acceptedEvidence.map((a) => a.event), () => REPO);
      const verdict = correlateDelegation(correlationInput(censusRecordOf(added[0]!), w, windows));
      expect(verdict).toMatchObject({ kind: 'linked', rung: 4, activityId: rows[0]!.activityId });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// a second PreToolUse, and the other holds
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('D-6267 a second PreToolUse of one call, and ageing beside other holds', () => {
  // MA19 reds (a) (the first listing is compared); MA18 reds (b) (the latest listing replaces the identity); MA-age-latest (ageing from the
  // latest Pre instead of the first) reds (c).
  it.each([
    ['(a) the LATEST listing is the one compared: Pre [a], Pre [a,b], Post [a,b] opens nothing'],
    ['(b) the FIRST PreToolUse stays the identity: Pre [a], Pre [a], Post [a,b] opens one row identified by Pre 1'],
    ['(c) ageing counts from the FIRST PreToolUse: Pre [a] at t0, Pre [a] at t0+BOUND-1 s, a filler at t0+BOUND, Post [a,b] opens with the Post as identity'],
  ] as const)('A20: %s', (label) => {
    if (label.startsWith('(a)')) {
      const w = world([bashPre(1, 'toolu_z', ['a']), bashPre(2, 'toolu_z', ['a', 'b']), bashPost(3, 'toolu_z', ['a', 'b'])]);
      expect(bashRowsOf(w.cp), 'Pre 2 replaced the compared listing, so the equal Post opens nothing').toEqual([]);
      expect(bashHoldsOf(w.cp)).toEqual([]);
    } else if (label.startsWith('(b)')) {
      const w = world([bashPre(1, 'toolu_z', ['a']), bashPre(2, 'toolu_z', ['a']), bashPost(3, 'toolu_z', ['a', 'b'])]);
      expect(bashRowsOf(w.cp)).toHaveLength(1);
      expect(bashRowsOf(w.cp)[0]).toMatchObject({ identityJournalId: w.records[0]!.journalId, executionState: 'ended', openedAt: T(1) });
    } else {
      const records = chainAt([
        [bashPre(1, 'toolu_z', ['a']), T0],
        [bashPre(2, 'toolu_z', ['a']), T0 + BOUND - 1000],
        [sessionStart(3, { sessionId: OTHER }), T0 + BOUND],
        [bashPost(4, 'toolu_z', ['a', 'b']), T0 + BOUND + 1000],
      ]);
      const report = recoverDelegation(null, records);
      expect(report.failure).toBeNull();
      expect(bashRowsOf(report.state.checkpoint)).toHaveLength(1);
      expect(bashRowsOf(report.state.checkpoint)[0]).toMatchObject({ identityJournalId: records[3]!.journalId, openedAt: T(4) });
    }
  });

  // GREEN at the base by design (there the Pre opens a row and holds nothing); mutant MA-shared-map-sweep (ageing sweeps the agent
  // candidates too) reds it.
  it('A21: ageing a pending Pre removes only the Bash hold: a bare agent occurrence stays held, and its meta still opens the agent', () => {
    const records = chainAt([
      [bashPre(1, 'toolu_z', ['main-wt']), T0],
      [bareTool(2, AGENT), T0 + 1000],
      [sessionStart(3, { sessionId: OTHER }), T0 + BOUND],
    ]);
    const b = DelegationCheckpointBuilder.from(emptyDelegationCheckpoint());
    for (const r of records) b.foldRecord(r);
    const cp = b.build(1);
    expect(bashHoldsOf(cp)).toEqual([]);
    expect(cp.pruningHolds).toContainEqual({ journalId: records[1]!.journalId, reason: 'identity-candidate', ownerId: encodeAgent(AGENT) });
    expect(b.openFromMeta(PARENT, INC, AGENT).kind).toBe('opened');
  });
});
