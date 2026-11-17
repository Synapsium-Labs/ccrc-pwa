// The done-test deciders (Overlord W2 done tests A; plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-done-tests.md
// §5, Table 3). `parseDoneTest` is the one shape check of a done test (Q2, F8): the relay door stores what it accepts and
// the coordinator doors' counter validates with it. `targetVerdict` answers one bare target from the facts its one
// gatherer read (`doneTestRead.ts#readTarget`).
//
// Ring: L1, context C5 Coordination. Pure: no clock, no I/O. Both are first match and total, and an answer's evidence is
// ids and words only, never text a session wrote. A fact the gatherer could not read never moves an answer to `passed` or
// `ended` (DT3, the property in `done-tests-policy.test.ts`).
import { TERMINAL_RUN_STATES, isPrPhase, isRunState } from '../../../shared/api.js';
import { ITEM_STATES, type ItemState } from '../../../shared/ledgers.js';
import { isHead40 } from '../../../shared/landing.js';
import {
  DONE_PREDICATES, DONE_TEST_BOUNDS, MEASURED_PREDICATES,
  type DonePredicate, type DoneTarget, type DoneTest, type TargetAnswer,
} from '../../../shared/doneTests.js';

/** Why a done test is refused. The relay door and the counter map every one to `bad-request` (DT9). */
export type DoneTestRefusal = 'not-a-list' | 'empty' | 'too-many' | 'unknown-predicate' | 'duplicate' | 'no-measured-predicate';
const DONE_TEST_REFUSAL_MAP: Record<DoneTestRefusal, true> = {
  'not-a-list': true, empty: true, 'too-many': true, 'unknown-predicate': true, duplicate: true, 'no-measured-predicate': true,
};
export const DONE_TEST_REFUSALS = Object.keys(DONE_TEST_REFUSAL_MAP) as DoneTestRefusal[];

export type DoneTestParse = { ok: true; test: DoneTest } | { ok: false; why: DoneTestRefusal };

const isPredicate = (v: unknown): v is DonePredicate =>
  typeof v === 'string' && (DONE_PREDICATES as readonly string[]).includes(v);

/** One entry is a plain object whose ONLY key is `predicate`, naming a word of the vocabulary. Any other key, a missing
 *  `predicate`, or a word outside it is `unknown-predicate`: a done test never carries prose or a field nobody reads. */
const entryOf = (v: unknown): DonePredicate | null => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 1 || keys[0] !== 'predicate') return null;
  const p = (v as { predicate: unknown }).predicate;
  return isPredicate(p) ? p : null;
};

/** The shape check of a done test, first match: a list, not empty, at most `DONE_TEST_BOUNDS.entries`, every entry a known
 *  predicate alone, no predicate twice, and at least one this build can measure (DT9). The accepted test is rebuilt from
 *  the words, never the caller's objects. */
export function parseDoneTest(v: unknown): DoneTestParse {
  if (!Array.isArray(v)) return { ok: false, why: 'not-a-list' };
  if (v.length === 0) return { ok: false, why: 'empty' };
  if (v.length > DONE_TEST_BOUNDS.entries) return { ok: false, why: 'too-many' };
  const words: DonePredicate[] = [];
  for (const e of v) {
    const p = entryOf(e);
    if (p === null) return { ok: false, why: 'unknown-predicate' };
    words.push(p);
  }
  if (new Set(words).size !== words.length) return { ok: false, why: 'duplicate' };
  if (!words.some((p) => (MEASURED_PREDICATES as readonly string[]).includes(p))) return { ok: false, why: 'no-measured-predicate' };
  return { ok: true, test: words.map((predicate) => ({ predicate })) };
}

/** The run a target names, as the gatherer read it. `closePr` and `lineage` are the stored values, unvalidated: this
 *  decider reads them. `reviews` are the runs that review it, read only for `review-passed`. */
export type TargetRunFacts = {
  state: string; kind: string; openedAt: number; closeDetail: string | null; closePr: unknown; lineage: unknown;
};
export type TargetFacts =
  | { kind: 'threw'; why: string }
  | { kind: 'run'; run: TargetRunFacts | 'absent' | 'unreadable'; reviews?: readonly { state: string }[] }
  | { kind: 'item'; item: { state: string } | 'absent' };

const passed = (evidence: string): TargetAnswer => ({ kind: 'passed', evidence });
const ended = (evidence: string): TargetAnswer => ({ kind: 'ended', evidence });
const pending = (evidence: string): TargetAnswer => ({ kind: 'pending', evidence });
const unmeasured = (why: string): TargetAnswer => ({ kind: 'unmeasured', why });
const unmeasurable = (why: string): TargetAnswer => ({ kind: 'unmeasurable', why });

const isTerminal = (s: string): boolean => (TERMINAL_RUN_STATES as readonly string[]).includes(s);
const isItemState = (s: string): s is ItemState => (ITEM_STATES as readonly string[]).includes(s);
const isPr = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

/** `runs.closePr` (DT7): `none` for NULL, `bad` for anything but `{ pr, merged, head }` JSON. */
type ClosePr = { kind: 'none' } | { kind: 'bad' } | { kind: 'ok'; pr: number; merged: boolean };
function closePrOf(raw: unknown): ClosePr {
  if (raw === null || raw === undefined) return { kind: 'none' };
  if (typeof raw !== 'string') return { kind: 'bad' };
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { kind: 'bad' }; }
  if (typeof v !== 'object' || v === null) return { kind: 'bad' };
  const { pr, merged, head } = v as { pr?: unknown; merged?: unknown; head?: unknown };
  if (!isPr(pr) || typeof merged !== 'boolean' || typeof head !== 'string' || !isHead40(head)) return { kind: 'bad' };
  return { kind: 'ok', pr, merged };
}

/** The newest lineage entry for `pr` recorded in the run's own window, or null; `bad` when the lineage is unreadable.
 *  `.prhistory`'s `recordedAt` is whole SECONDS (ccd's `int(time.time())`) and `openedAt` milliseconds, so the window is
 *  measured in seconds: an entry recorded in the second the run opened counts (slug `lineage-recorded-at-is-seconds`). */
function lineageEntry(lineage: unknown, pr: number, openedAt: number): { phase: unknown } | null | 'bad' {
  if (!Array.isArray(lineage)) return 'bad';
  const from = Math.floor(openedAt / 1000);
  let best: { phase: unknown; at: number } | null = null;
  for (const e of lineage) {
    if (typeof e !== 'object' || e === null) return 'bad';
    const { pr: n, recordedAt } = e as { pr?: unknown; recordedAt?: unknown };
    if (typeof n !== 'number' || typeof recordedAt !== 'number') return 'bad';
    if (n !== pr || recordedAt < from) continue;
    if (best === null || recordedAt >= best.at) best = { phase: (e as { phase?: unknown }).phase, at: recordedAt };
  }
  return best;
}

/** The first word of a failed run's close detail (`abandon:<reason>` is `abandon`), or none. */
const failedEvidence = (detail: string | null): string => {
  const word = detail === null ? null : /^[a-z][a-z0-9-]*/.exec(detail)?.[0] ?? null;
  return word === null ? 'failed' : `failed:${word}`;
};

function runClosed(id: number, r: TargetRunFacts): TargetAnswer {
  if (!isTerminal(r.state)) return pending(`run-${id}-${r.state}`);
  if (r.state === 'failed') return ended(failedEvidence(r.closeDetail));
  const c = closePrOf(r.closePr);
  if (c.kind === 'bad') return unmeasurable('close-record-unreadable');
  if (c.kind === 'none') return unmeasurable('no-close-record');
  return c.merged ? passed(`pr-${c.pr}`) : ended(`pr-${c.pr}-not-merged`);
}

function prMerged(id: number, pr: number, r: TargetRunFacts): TargetAnswer {
  if (!isTerminal(r.state)) return pending(`run-${id}-${r.state}`);
  const c = closePrOf(r.closePr);
  if (c.kind === 'bad') return unmeasurable('close-record-unreadable');
  if (c.kind === 'ok' && c.pr === pr) return c.merged ? passed(`pr-${pr}`) : ended(`pr-${pr}-not-merged`);
  const e = lineageEntry(r.lineage, pr, r.openedAt);
  if (e === 'bad') return unmeasurable('lineage-unreadable');
  if (e === null) return unmeasurable('not-this-runs-pr');
  if (e.phase === 'merged') return passed(`pr-${pr}`);
  if (e.phase === 'closed') return ended(`pr-${pr}-closed`);
  return unmeasurable(isPrPhase(e.phase) ? `phase-${e.phase}` : 'phase-unknown');
}

function reviewPassed(id: number, r: TargetRunFacts, reviews: readonly { state: string }[] | undefined): TargetAnswer {
  if (r.state === 'failed') return ended(failedEvidence(r.closeDetail));
  if (reviews === undefined) return unmeasurable('reviews-unread');
  if (reviews.some((v) => !isRunState(v.state))) return unmeasurable('state-unknown');
  if (reviews.some((v) => !isTerminal(v.state))) return pending(`run-${id}-review-open`);
  if (reviews.some((v) => v.state === 'done')) return unmeasurable('verdict-not-recorded');
  return pending(`run-${id}-no-review`);
}

/** Table 3, first match and total. */
export function targetVerdict(target: DoneTarget, facts: TargetFacts): TargetAnswer {
  if (facts.kind === 'threw') return unmeasured(facts.why);
  if (target.predicate === 'operator-confirms') {
    if (facts.kind !== 'item') return unmeasurable('facts-mismatch');
    if (facts.item === 'absent') return unmeasurable('no-such-row');
    const s = facts.item.state;
    if (!isItemState(s)) return unmeasurable('state-unknown');
    if (s === 'done') return passed(`item-${target.itemId}-done`);
    if (s === 'dismissed' || s === 'withdrawn') return ended(s);
    return pending(`item-${target.itemId}-${s}`);
  }
  if (facts.kind !== 'run') return unmeasurable('facts-mismatch');
  if (facts.run === 'absent') return unmeasurable('no-such-row');
  if (facts.run === 'unreadable') return unmeasurable('run-unreadable');
  const r = facts.run;
  if (!isRunState(r.state)) return unmeasurable('state-unknown');
  if (target.predicate === 'run-closed') return runClosed(target.runId, r);
  if (target.predicate === 'pr-merged') return prMerged(target.runId, target.pr, r);
  return reviewPassed(target.runId, r, facts.reviews);
}
