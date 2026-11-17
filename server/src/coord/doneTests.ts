// The done-test deciders (Overlord W2 done tests A; plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-done-tests.md
// §5, Table 3). `parseDoneTest` is the one shape check of a done test (Q2, F8): the relay door stores what it accepts and
// the coordinator doors' counter validates with it. `targetVerdict` answers one bare target from the facts its one
// gatherer read (`doneTestRead.ts#readTarget`).
//
// Ring: L1, context C5 Coordination. Pure: no clock, no I/O. Both are first match and total, and an answer's evidence is
// ids and words only, never text a session wrote. A fact the gatherer could not read never moves an answer to `passed` or
// `ended` (DT3, the property in `done-tests-policy.test.ts`).
import { TERMINAL_RUN_STATES, isRunState } from '../../../shared/api.js';
import { ITEM_STATES, type ItemState } from '../../../shared/ledgers.js';
import { isHead40 } from '../../../shared/landing.js';
import type { ReadFailure } from '../../../shared/agent-protocol.js';
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
  | { kind: 'run'; run: TargetRunFacts | ReadFailure; reviews?: readonly { state: string }[] }
  | { kind: 'item'; item: { state: string } | 'absent' };

const passed = (evidence: string): TargetAnswer => ({ kind: 'passed', evidence });
const ended = (evidence: string): TargetAnswer => ({ kind: 'ended', evidence });
const pending = (evidence: string): TargetAnswer => ({ kind: 'pending', evidence });
/** Why a target is unmeasurable, each a fixed word (Table 3). */
const TARGET_WHY_MAP = {
  'close-record-unreadable': true, 'no-close-record': true, 'lineage-unreadable': true, 'not-this-runs-pr': true,
  'lineage-unattributed': true, 'reviews-unread': true, 'state-unknown': true, 'verdict-not-recorded': true,
  'facts-mismatch': true, 'no-such-row': true, 'run-unreadable': true,
} as const satisfies Record<string, true>;
type TargetWhy = keyof typeof TARGET_WHY_MAP;

/** Every kebab word this context spells, for `mail-routes.test.ts`'s code scan: a predicate, a done test's refusal and why
 *  a target is unmeasurable. None is a mail rejection or a run refusal: a refusal is `bad-request` at its door (DT9). */
export const isDoneTestKebab = (tok: string): boolean => (DONE_PREDICATES as readonly string[]).includes(tok)
  || Object.hasOwn(DONE_TEST_REFUSAL_MAP, tok) || Object.hasOwn(TARGET_WHY_MAP, tok);

const unmeasured = (why: string): TargetAnswer => ({ kind: 'unmeasured', why });
const unmeasurable = (why: TargetWhy): TargetAnswer => ({ kind: 'unmeasurable', why });

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

/** Whether the lineage names `pr` in the run's own window; `bad` when the lineage is unreadable. It only tells "not
 *  this run's PR" from "unattributed": the fold keeps entries by the shared workspace branch and ccd stamps an outgoing
 *  PR when it is replaced, inside the replacing run's window, so no entry says whose it is (review 2377 F2, slug
 *  `pr-merged-reads-the-own-close-only`). `.prhistory`'s `recordedAt` is whole SECONDS (ccd's `int(time.time())`) and
 *  `openedAt` milliseconds, so the window is measured in seconds (slug `lineage-recorded-at-is-seconds`). */
function lineageNames(lineage: unknown, pr: number, openedAt: number): boolean | 'bad' {
  if (!Array.isArray(lineage)) return 'bad';
  const from = Math.floor(openedAt / 1000);
  let named = false;
  for (const e of lineage) {
    if (typeof e !== 'object' || e === null) return 'bad';
    const { pr: n, recordedAt } = e as { pr?: unknown; recordedAt?: unknown };
    if (typeof n !== 'number' || typeof recordedAt !== 'number') return 'bad';
    if (n === pr && recordedAt >= from) named = true;
  }
  return named;
}

/** A failed run's evidence: its close detail's first word (`abandon:<reason>` is `abandon`), or `failed` when the detail
 *  is absent or does not open with a lower-case word. Never the rest of the detail. */
const failedEvidence = (detail: string | null): string =>
  (detail === null ? null : /^[a-z][a-z0-9-]*/.exec(detail)?.[0]) ?? 'failed';

function runClosed(id: number, r: TargetRunFacts): TargetAnswer {
  if (!isTerminal(r.state)) return pending(`run-${id}-${r.state}`);
  if (r.state === 'failed') return ended(failedEvidence(r.closeDetail));
  const c = closePrOf(r.closePr);
  if (c.kind === 'bad') return unmeasurable('close-record-unreadable');
  if (c.kind === 'none') return unmeasurable('no-close-record');
  return c.merged ? passed(`pr-${c.pr}`) : ended(`pr-${c.pr}-not-merged`);
}

/** `pr-merged` means "this run's PR N merged" (review 2377 F2): only the run's own close record answers it. An unreadable
 *  record is unmeasurable before the lineage is read (slug `pr-merged-unreadable-close-is-unmeasurable`), and a PR only
 *  the lineage names is `lineage-unattributed`, never passed or ended. */
function prMerged(id: number, pr: number, r: TargetRunFacts): TargetAnswer {
  if (!isTerminal(r.state)) return pending(`run-${id}-${r.state}`);
  const c = closePrOf(r.closePr);
  if (c.kind === 'bad') return unmeasurable('close-record-unreadable');
  if (c.kind === 'ok' && c.pr === pr) return c.merged ? passed(`pr-${pr}`) : ended(`pr-${pr}-not-merged`);
  const named = lineageNames(r.lineage, pr, r.openedAt);
  if (named === 'bad') return unmeasurable('lineage-unreadable');
  return unmeasurable(named ? 'lineage-unattributed' : 'not-this-runs-pr');
}

/** A review run never has reviews of its own: a `review-passed` target naming one is the wrong row (review 2377 F6). */
function reviewPassed(id: number, r: TargetRunFacts, reviews: readonly { state: string }[] | undefined): TargetAnswer {
  if (r.kind !== 'work') return unmeasurable('facts-mismatch');
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

/** What the drift grace gathers to ask whether a run's PR is merged (Linear hierarchy design §7.3: Linear's GitHub integration
 *  completes an issue when its PR merges): the run's stored lineage, unvalidated, its own workspace branch, and its session's PR
 *  as the newest fleet listing shows it (null when the listing has no row for that session), or why the run was not read. */
export type RunMergedFacts =
  | { run: 'unreadable' | 'absent' }
  | { run: 'read'; lineage: unknown; ownBranch: string | null; listing: { phase: string | null; branch: string | null } | null };

/** Whether a run's PR is merged as the server knows it, for an open run as well as a closed one: a `merged` phase in its folded
 *  `.prhistory` lineage, else its session's listed PR merged on the run's own workspace branch. It is NOT `pr-merged`, which
 *  reads only the run's own close record: the grace asks while the run is still open (merging, no close record yet), and a
 *  wait for the close would restore an issue the merge just completed. A run not read, or a lineage that is no list, reads
 *  as no merge there; the grace then holds its usual one pass. Moved here from the drift pass (#2964 made this file the one
 *  decider of "merged" from a run's lineage; the coordinator's ruling on review 2408's fix round 3). */
export function runPrMergedSeen(f: RunMergedFacts): boolean {
  if (f.run !== 'read') return false;
  const inLineage = Array.isArray(f.lineage)
    && f.lineage.some((e) => typeof e === 'object' && e !== null && (e as { phase?: unknown }).phase === 'merged');
  if (inLineage) return true;
  const l = f.listing;
  return l !== null && l.phase === 'merged' && f.ownBranch !== null && l.branch !== null && l.branch === f.ownBranch;
}
