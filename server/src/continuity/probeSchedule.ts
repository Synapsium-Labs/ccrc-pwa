// L1, context C3 (Session Conversation): when the generations lane asks a probe round and which graded round it feeds the
// machine (Overlord spec §3.3.5 C41, §3.3.9 C52; plan `docs/superpowers/plans/2026-11-10-overlord/w1a-probes.md`, Tasks 5 and
// 6). Pure: the lane (L4) reads one generation's rounds, its card read, its compactions and its context, and asks
// `probeSchedule` what to do; it opens the round (through the store) and feeds the event (through the apply loop), and decides
// nothing itself.
//
// THE RULES, one generation at a time, at most one round open per generation:
// - `probing`: the first start round opens at once; the round for this step (`probeRounds` counts FAILED rounds, review 1912
//   F3) feeds `probes` once it is graded `passed` or `failed`; after a failed first round, the second opens only once the
//   card was read again after that round was answered. A round graded `unmeasured` feeds nothing (review 1999 F4b: the lane
//   never records it as `passed: false`), and the generation waits there (slug unmeasured-round-waits).
// - `active`: a compaction since the newest snapshot round, or since the generation entered `active`, opens a `compaction`
//   round over the newest snapshot the conversation read (`roundSnapshotOf`, review 2063 F2). A failed compaction round asks
//   for a re-read: the next compaction round opens only once the card was read after it, and if that one fails too,
//   `probeFailedUnfixed` reads true (`renewalDue`'s `probe-failed` row). A compaction round supersedes an unanswered spot
//   round (review 2063 F3): nothing announces a spot round yet, so one left open must not block the compaction rounds.
//   A spot round opens while the session is idle and its fresh context is `SPOT_PROBE_EVERY_TOKENS` past the baseline: the
//   depth the newest spot or compaction round opened at, so a compaction resets it (review 2063 F5); a busy session, a stale
//   sidecar, an unread turn marker or a baseline that was not measured opens none (unmeasured, never a guess).
// - Any other state opens nothing.
import { SPOT_PROBE_EVERY_TOKENS, type GenerationState, type ProbeGrade, type ProbeRoundKind } from '../../../shared/continuity.js';
import type { CardFacts, CardMail, CardNote } from '../../../shared/continuity-card.js';
import type { FleetRole } from '../../../shared/fleetRoles.js';
import { roundVerdict, type RoundVerdict } from './probes.js';
import type { Reading } from './renewalDue.js';

/** One stored question as the lane reads it (a `continuity_probes` row's columns). */
export interface ProbeRowFacts {
  readonly roundId: string; readonly kind: ProbeRoundKind; readonly askedAt: number; readonly answeredAt: number | null;
  readonly grade: ProbeGrade | null; readonly roundUnmeasured: boolean; readonly depthTokens: number | null;
}

/** One round of a generation: when it was asked and answered, and its verdict once every question is graded. */
export interface RoundSummary {
  readonly roundId: string; readonly kind: ProbeRoundKind; readonly askedAt: number;
  /** When the round was answered; null while any of its questions is not. */
  readonly answeredAt: number | null;
  readonly verdict: RoundVerdict | null;
  readonly depthTokens: number | null;
}

/** The rows grouped into rounds, in the order each round's first row comes. */
export function roundsOf(rows: readonly ProbeRowFacts[]): readonly RoundSummary[] {
  const byId = new Map<string, ProbeRowFacts[]>();
  for (const r of rows) byId.set(r.roundId, [...(byId.get(r.roundId) ?? []), r]);
  return [...byId.values()].map((rs) => {
    const first = rs[0]!;
    const graded = rs.every((r) => r.answeredAt !== null && r.grade !== null);
    return {
      roundId: first.roundId, kind: first.kind, askedAt: first.askedAt,
      answeredAt: graded ? Math.max(...rs.map((r) => r.answeredAt!)) : null,
      verdict: graded ? roundVerdict(rs.map((r) => r.grade!), first.roundUnmeasured) : null,
      depthTokens: first.depthTokens,
    };
  });
}

/** Where the compactions that open a `compaction` round are counted from: the newest snapshot round's ask, or the time the
 *  generation entered its state, whichever is later. The lane counts the compactions since it (`compactionsSince`). */
export function compactionWindowStart(enteredAt: number, rounds: readonly RoundSummary[]): number {
  const asked = rounds.filter((r) => r.kind !== 'spot').map((r) => r.askedAt);
  return Math.max(enteredAt, ...asked);
}

export interface ProbeScheduleInput {
  /** The generation's effective state (`effectiveGeneration`: never a state column read directly). */
  readonly state: GenerationState;
  /** Failed rounds in this `probing` (0 or 1). */
  readonly probeRounds: number;
  /** This generation's rounds, in the order they opened. */
  readonly rounds: readonly RoundSummary[];
  /** The newest full read of the card by this generation's conversation (null: none since its start). */
  readonly cardReadAt: Reading<number | null>;
  /** The compactions since `compactionWindowStart`. */
  readonly compactionsSince: Reading<number>;
  /** The turn marker says the session's main loop is idle. */
  readonly idle: Reading<boolean>;
  /** The session's context, from a fresh usage sidecar. */
  readonly ctxTokens: Reading<number>;
}

export interface ProbeSchedule {
  /** The graded round to feed the machine as `probes`, or null. */
  readonly feed: { readonly passed: boolean } | null;
  /** The round to open, or null: a spot or compaction round records the depth it opened at (the spot baseline), and a
   *  compaction round names the unanswered spot round it supersedes. */
  readonly open: { readonly kind: ProbeRoundKind; readonly depthTokens: number | null; readonly supersedes: string | null } | null;
  /** `renewalDue`'s `probe-failed` input: a mid-generation round failed, and the round after a re-read failed too. */
  readonly probeFailedUnfixed: Reading<boolean>;
}

const measured = <T>(value: T): Reading<T> => ({ kind: 'measured', value });
const answered = (rs: readonly RoundSummary[]): RoundSummary[] => rs.filter((r) => r.answeredAt !== null);
/** The card was read after `at`. */
const reReadAfter = (card: Reading<number | null>, at: number): boolean =>
  card.kind === 'measured' && card.value !== null && card.value > at;

/** `probe-failed` (§3.3.5: "a mid-generation fail a re-read does not fix makes a renewal due"): the newest graded compaction
 *  round failed and so did the one before it, which asked for the re-read. A spot round is not one: its question is about
 *  rows the card does not carry, so a re-read cannot fix it (slug probe-failed-reads-compaction-rounds). A newest round
 *  graded `unmeasured` leaves the answer unmeasured. */
export function probeFailedUnfixedOf(rounds: readonly RoundSummary[]): Reading<boolean> {
  const done = answered(rounds.filter((r) => r.kind === 'compaction'));
  const last = done[done.length - 1];
  if (last === undefined) return measured(false);
  if (last.verdict === 'unmeasured') return { kind: 'unmeasured', why: 'the newest compaction round could not be graded' };
  return measured(last.verdict === 'failed' && done[done.length - 2]?.verdict === 'failed');
}

/** One generation's probe step this pass. */
export function probeSchedule(i: ProbeScheduleInput): ProbeSchedule {
  const probeFailedUnfixed = probeFailedUnfixedOf(i.rounds);
  const none: ProbeSchedule = { feed: null, open: null, probeFailedUnfixed };
  const isOpen = i.rounds.some((r) => r.answeredAt === null);

  if (i.state === 'probing') {
    const starts = i.rounds.filter((r) => r.kind === 'start');
    const target = starts[i.probeRounds];
    if (target !== undefined) {
      if (target.verdict === 'passed' || target.verdict === 'failed') return { ...none, feed: { passed: target.verdict === 'passed' } };
      return none;
    }
    if (isOpen) return none;
    const prev = starts[i.probeRounds - 1];
    if (i.probeRounds === 0 || (prev?.answeredAt != null && reReadAfter(i.cardReadAt, prev.answeredAt))) {
      return { ...none, open: { kind: 'start', depthTokens: null, supersedes: null } };
    }
    return none;
  }

  if (i.state !== 'active') return none;
  const openRound = i.rounds.find((r) => r.answeredAt === null);
  if (openRound !== undefined && openRound.kind !== 'spot') return none;
  const depth = i.ctxTokens.kind === 'measured' ? i.ctxTokens.value : null;
  const compaction = { ...none, open: { kind: 'compaction' as const, depthTokens: depth, supersedes: openRound?.roundId ?? null } };
  const comps = answered(i.rounds.filter((r) => r.kind === 'compaction'));
  const lastComp = comps[comps.length - 1];
  const awaitingReRead = lastComp?.verdict === 'failed' && !(probeFailedUnfixed.kind === 'measured' && probeFailedUnfixed.value);
  if (awaitingReRead) {
    if (reReadAfter(i.cardReadAt, lastComp.answeredAt!)) return compaction;
  } else if (i.compactionsSince.kind === 'measured' && i.compactionsSince.value >= 1) {
    return compaction;
  }
  if (openRound !== undefined || i.idle.kind !== 'measured' || !i.idle.value || depth === null) return none;
  const marks = i.rounds.filter((r) => r.kind === 'spot' || r.kind === 'compaction');
  const baseline = marks.length === 0 ? 0 : marks[marks.length - 1]!.depthTokens;
  if (baseline !== null && depth - baseline >= SPOT_PROBE_EVERY_TOKENS) return { ...none, open: { kind: 'spot', depthTokens: depth, supersedes: null } };
  return none;
}

/** The snapshot a round of `kind` is drawn from: none for a spot round; the one the generation was carded with for a start
 *  round; and for a compaction round the newest snapshot the conversation read (review 2063 F2: a row that moved hours
 *  before the ask is not the session's to be failed on), the carded one when it has read none since, and unmeasured when
 *  that read failed, so the round waits. */
export function roundSnapshotOf(kind: ProbeRoundKind, carded: string | null, newestRead: Reading<string | null>): Reading<string | null> {
  if (kind === 'spot') return measured(null);
  if (kind === 'start') return measured(carded);
  if (newestRead.kind !== 'measured') return newestRead;
  return measured(newestRead.value ?? carded);
}

/** What an empty try is remembered by (review 2063 F4): a start or compaction round's snapshot, or a spot round's 50k step,
 *  so a composition with no question is not drawn and logged again until the key changes. */
export function emptyTryKey(kind: ProbeRoundKind, snapshotId: string | null, depthTokens: number | null): string {
  return kind === 'spot' ? `spot:${Math.floor((depthTokens ?? 0) / SPOT_PROBE_EVERY_TOKENS)}` : `${kind}:${snapshotId ?? ''}`;
}

/** The facts a spot round is drawn from: only the rows of this generation, the notes it wrote and the mail it was sent since
 *  `since` (the time it entered its state), so the question is about a row the snapshot does not carry. Every other fact
 *  reads as an empty list in that scope: those rows are not this generation's to be asked about. */
export function spotFactsOf(sessionId: string, role: FleetRole, at: number, notes: readonly CardNote[], mail: readonly CardMail[],
  since: number): CardFacts {
  const read = <T>(value: T) => ({ kind: 'read' as const, value });
  return {
    sessionId, role, roleWhy: 'a spot round reads this generation\'s rows', at, runs: read([]), ledger: read([]), claims: read([]),
    intent: read(false), itemsRaised: read([]), mailOutstanding: read(mail.filter((m) => m.at >= since)), mailMore: false,
    notes: read(notes.filter((n) => n.at >= since)), checkpoint: read(null), history: read({ verb: 'ccrc history describe', node: null }),
  };
}
