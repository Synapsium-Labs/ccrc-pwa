// The done-test vocabulary (Overlord W2, done tests A; plan docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-done-tests.md §4): Table 5.5a's predicates, the bare targets the one reader takes, the reader's answer words and
// a request's verdicts.
//
// Ring: L0, context C5 Coordination. It imports nothing: the PWA may bundle it, and the request record's row type
// imports `DoneTest` from here (DT1, one concern per sibling). Every list is derived from its key map, so a word added
// to a map is a word in its list, and a union with no map cannot be added (`rings/wire-totality`).

const DONE_PREDICATE_MAP = {
  'run-closed': true, 'pr-merged': true, 'review-passed': true, 'goals-modified': true, 'operator-confirms': true,
} as const;
/** What a done test can name. No predicate reads prose (§5.5, H22). */
export type DonePredicate = keyof typeof DONE_PREDICATE_MAP;
export const DONE_PREDICATES = Object.keys(DONE_PREDICATE_MAP) as DonePredicate[];

/** The predicates a row of this build can answer. `review-passed` has no recorded verdict (DT4) and a request's
 *  `operator-confirms` has no linked item before W3 (DT5), so a test must name at least one of these (DT9). */
const MEASURED_PREDICATE_MAP = {
  'run-closed': true, 'pr-merged': true, 'goals-modified': true,
} as const satisfies Partial<Record<DonePredicate, true>>;
export const MEASURED_PREDICATES = Object.keys(MEASURED_PREDICATE_MAP) as DonePredicate[];

/** One entry of a request's done test: the predicate alone, bound later to what the request links (DT2, DT6). */
export type DoneTestEntry = { readonly predicate: DonePredicate };
/** A request's done test: one to `DONE_TEST_BOUNDS.entries` distinct entries, as `parseDoneTest` accepts it. */
export type DoneTest = readonly DoneTestEntry[];
export const DONE_TEST_BOUNDS = { entries: 5 } as const;

/** A bare target names a row (DT2): a run, a pull request named by its run, the work run a review reads, or an
 *  operator item. `goals-modified` has none: its only meaning is a modification that cites a request. */
export type DoneTarget =
  | { readonly predicate: 'run-closed'; readonly runId: number }
  | { readonly predicate: 'pr-merged'; readonly runId: number; readonly pr: number }
  | { readonly predicate: 'review-passed'; readonly runId: number }
  | { readonly predicate: 'operator-confirms'; readonly itemId: number };

/** The reader's five words (DT3). `unmeasured` is a read that failed now and holds; `unmeasurable` is a fact no row of
 *  this build can answer, which a request may close `done-unverified` on. They are never folded. */
const TARGET_ANSWER_MAP = { passed: true, ended: true, pending: true, unmeasured: true, unmeasurable: true } as const;
export type TargetAnswerWord = keyof typeof TARGET_ANSWER_MAP;
export const TARGET_ANSWER_WORDS = Object.keys(TARGET_ANSWER_MAP) as TargetAnswerWord[];
/** One answer, with its evidence or its reason: ids and words only, never text a session wrote. */
export type TargetAnswer =
  | { readonly kind: 'passed' | 'ended' | 'pending'; readonly evidence: string }
  | { readonly kind: 'unmeasured' | 'unmeasurable'; readonly why: string };

/** What a request's test decides (Table 4, built in done tests B). */
const DONE_VERDICT_MAP = { close: true, 'close-unverified': true, hold: true, none: true } as const;
export type DoneVerdict = keyof typeof DONE_VERDICT_MAP;
export const DONE_VERDICTS = Object.keys(DONE_VERDICT_MAP) as DoneVerdict[];
