// deploy/history-gate.mjs — ccrc history W2's gate: every scoring decision of the replay eval, as pure functions.
//
// Spec: docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §10.2 (the replay eval, the gate).
// The decisions document for W2 (W2-D11 to W2-D25, W2-D60 to W2-D64, W2-D72, W2-D79 to W2-D81, W2-D87, W2-D89,
// W2-D90) is the authority for what lives here and why.
//
// PURE (W2-D11). The only imports are `node:crypto` and `../ccd/history/lib.mjs`. No fs, no child_process, no
// environment read, no clock and no random source: every input, a seed and every instant included, arrives as a
// parameter. measure-history.test.ts pins this over the import block and over the whole text, comments and strings
// included, so even a sentence here never spells one of the banned reads. JSDoc types are written inline, never
// through a dynamic type import, for the same reason.
//
// WHO READS IT. `deploy/history-replay.mjs` (the driver, W2-4 to W2-5b) and `deploy/history-counters.mjs` (W2-6)
// import it. Every scoring decision lives here and nowhere else (W2-D24): the open record pins this file's sha256
// in `gate_code`, beside measure-history.py, history-replay.mjs and lib.mjs, and every `--record` consumer
// re-checks it.
//
// ITS WORDS ARE ITS OWN (W2-D12; D-5774). The gate's closed word sets are frozen once, below, and never in lib.mjs:
// lib's vocabularies are ccd/history's (its REASONS are the CLI's words). No name lib exports is declared again
// here (O14), and FACT_KINDS and LABELS have this file as their one declaring file under deploy/ and server/test/.
// Two class words of the model catalogue are never spelled in this file, not even in a comment, so the catalogue's
// class-enumeration scan in single-definition.test.ts never counts it.
import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';

// ── The window (W2-D14) ──────────────────────────────────────────────────────────────────────────────────────
/** K: a post-compaction window is the first K assistant turns after a main boundary (spec §10.2, Q14). */
export const K = 10;

/** The unit K counts (W2-D14): assistant turns, consecutive rows grouped by msg_id, else request_id, else uuid.
 *  validateOpenRecord refuses any other `k_unit`. */
export const K_UNIT = 'assistant-turns';

/** X = 1/10 as an exact fraction: criterion 3's floor on the lower bound of the treatment window share (spec §10.2,
 *  Q14). Every comparison against it is by cross-multiplication, never in floating point (W2-D18).
 *  @type {Readonly<{num: number, den: number}>} */
export const X = Object.freeze({ num: 1, den: 10 });

/** The ruled metric, as the open record's `metric` field carries it (part 1, fixed). */
export const METRIC_TEXT = 'recall calls per post-compaction turn, reported for both arms; gated: the share of treatment '
  + 'windows with at least one ccrc history read-verb call over the first K assistant turns after a main boundary';

/** The row cap every W2 measure-history.py run passes as `--row-cap` (plan-chosen). assembleReports refuses a
 *  report made under any other cap (`row-cap-mismatch`, W2-D22); a window cut by it before turn K+1 is unmeasured. */
export const ROW_CAP = 400;

/** @type {readonly ['measured', 'unmeasured']} */
export const WINDOW_STATES = Object.freeze(['measured', 'unmeasured']);
/** @typedef {(typeof WINDOW_STATES)[number]} WindowState */

// ── The bootstrap, its substreams and the assignment (W2-D18, W2-D19) ────────────────────────────────────────
/** The bootstrap as the record's `bootstrap` field fixes it; the seed and the substream list ride beside it.
 *  @type {Readonly<{B: 10000, ci: 95, method: 'percentile', percentile: 'nearest-rank', statistic: 'pooled', prng: 'xoshiro128**'}>} */
export const BOOTSTRAP = Object.freeze({
  B: 10000, ci: 95, method: 'percentile', percentile: 'nearest-rank', statistic: 'pooled', prng: 'xoshiro128**',
});

/** The closed list of substream labels a draft seed feeds (W2-D18). A label outside it is refused.
 *  @type {readonly ['quiz-ci', 'live-ci', 'q18', 'handcheck', 'quiz-sample', 'judge-order']} */
export const SUBSTREAMS = Object.freeze(['quiz-ci', 'live-ci', 'q18', 'handcheck', 'quiz-sample', 'judge-order']);
/** @typedef {(typeof SUBSTREAMS)[number]} Substream */

/** The pilot's one label, used only with the pilot's own seed, never with the draft seed (W2-D18). */
export const PILOT_SUBSTREAM = 'pilot-sample';

/** The assignment's hash label: an arm is bit 0 of sha256(seed + ':assign:' + familyKey), not a substream draw
 *  (W2-D19). */
export const ASSIGN_LABEL = 'assign';

/** @type {readonly ['treatment', 'control']} */
export const ASSIGNMENT_ARMS = Object.freeze(['treatment', 'control']);
/** @typedef {(typeof ASSIGNMENT_ARMS)[number]} Arm */

/** Why a store's family is not active at W2 open (W2-D20), one reason each, never folded: (a) merged, (a) a legacy
 *  '' generation (excluded, fixed), (b) not its id's newest unmerged family, (c) no main entry in the look-back.
 *  @type {readonly ['merged', 'legacy', 'not-newest', 'no-recent-entry']} */
export const ACTIVE_EXCLUSIONS = Object.freeze(['merged', 'legacy', 'not-newest', 'no-recent-entry']);
/** @typedef {(typeof ACTIVE_EXCLUSIONS)[number]} ActiveExclusion */

// ── The quiz (W2-D60 to W2-D64, W2-D72, W2-D79 to W2-D81) ────────────────────────────────────────────────────
/** The fact kinds the quiz sources (W2-D60; D-5775). Decisions are not sourced: nothing mines one mechanically,
 *  and prose has no whole-fact form to match by string. Re-adding them takes a new kind, a variant rule, a
 *  labeller and a new record version.
 *  @type {readonly ['sha', 'path', 'command', 'error']} */
export const FACT_KINDS = Object.freeze(['sha', 'path', 'command', 'error']);
/** @typedef {(typeof FACT_KINDS)[number]} FactKind */

/** An answer's label (spec §10.2 Scoring). `correct` is decided by labelCorrect alone; the judge picks between the
 *  other two (W2-D63, W2-D79).
 *  @type {readonly ['correct', 'uncertain', 'fabricated']} */
export const LABELS = Object.freeze(['correct', 'uncertain', 'fabricated']);
/** @typedef {(typeof LABELS)[number]} Label */

/** The judge rubrics part 1 may sign by `rubric_id` (W2-D79).
 *  @type {readonly ['v1', 'v1-strict']} */
export const RUBRIC_IDS = Object.freeze(['v1', 'v1-strict']);
/** @typedef {(typeof RUBRIC_IDS)[number]} RubricId */

/** What the question writer is shown (W2-D72): the default excerpt, or leaf N's whole redacted span.
 *  @type {readonly ['excerpt', 'leaf-span']} */
export const WRITER_INPUTS = Object.freeze(['excerpt', 'leaf-span']);
/** @typedef {(typeof WRITER_INPUTS)[number]} WriterInput */

/** The two `sha_min_prefix` values part 1 may sign (W2-D63): 7, the default, or 40, the spec's exact match.
 *  @type {readonly [7, 40]} */
export const SHA_MIN_PREFIXES = Object.freeze([7, 40]);
/** @typedef {(typeof SHA_MIN_PREFIXES)[number]} ShaMinPrefix */

/** parseAnswerField's three answers (W2-D64): only `value` reaches labelCorrect.
 *  @type {readonly ['value', 'unknown', 'absent']} */
export const ANSWER_STATES = Object.freeze(['value', 'unknown', 'absent']);
/** @typedef {(typeof ANSWER_STATES)[number]} AnswerState */

/** One spawned run's class (W2-D80): a model-level non-answer is `answered`; a stop is `not-run`, never a failure.
 *  @type {readonly ['answered', 'infra-failed', 'not-run']} */
export const RUN_CLASSES = Object.freeze(['answered', 'infra-failed', 'not-run']);
/** @typedef {(typeof RUN_CLASSES)[number]} RunClass */

/** A question's outcome over its attempts (W2-D80): one infra failure is `rerun`, a second `run-failed`.
 *  @type {readonly ['answered', 'rerun', 'run-failed', 'not-run']} */
export const QUESTION_OUTCOMES = Object.freeze(['answered', 'rerun', 'run-failed', 'not-run']);
/** @typedef {(typeof QUESTION_OUTCOMES)[number]} QuestionOutcome */

// ── The verdict (W2-D89) ─────────────────────────────────────────────────────────────────────────────────────
/** decideGate's verdicts: `halt` waits on an operator ruling, `incomplete` on the hand-check's missing labels.
 *  @type {readonly ['pass', 'fail', 'halt', 'incomplete']} */
export const VERDICTS = Object.freeze(['pass', 'fail', 'halt', 'incomplete']);
/** @typedef {(typeof VERDICTS)[number]} Verdict */

/** The words decideGate lists in `halts`: the absent rate over `absent_rate_max` in either arm (W2-D64), the
 *  run-failed share over `run_failed_max` (W2-D80), hand-check agreement under `handcheck_agreement_min` (W2-D81),
 *  and an empty arm, a criterion 1 or 3 treatment set with no cluster left (the coordinator's W2-3 ruling). The hold,
 *  a judge-failed item with no operator label, has no word here: it is the verdict `incomplete`.
 *  @type {readonly ['absent-rate', 'run-failed', 'handcheck-agreement', 'empty-arm']} */
export const HALT_WORDS = Object.freeze(['absent-rate', 'run-failed', 'handcheck-agreement', 'empty-arm']);
/** @typedef {(typeof HALT_WORDS)[number]} HaltWord */

// ── The open record (W2-D22, W2-D24, W2-D25, W2-D72, W2-D90) ─────────────────────────────────────────────────
/** The kinds an amendment to part 2 may carry (W2-D90, chosen set).
 *  @type {readonly ['version-move', 'freeze-exception', 'forced-act']} */
export const AMENDMENT_KINDS = Object.freeze(['version-move', 'freeze-exception', 'forced-act']);
/** @typedef {(typeof AMENDMENT_KINDS)[number]} AmendmentKind */

/** The four files whose installed bytes `gate_code.files` hashes, by repo-relative path (W2-D24).
 *  @type {readonly ['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs']} */
export const GATE_CODE_FILES = Object.freeze([
  'deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs',
]);

/** Every refusal word the gate answers, in four groups: assembleReports' (W2-D22, with W2-D13's echoed window and W2-D24's
 *  `code-changed`, `code-unmeasured` for a sha missing on either side), the question writer's discards (W2-D72), decideGate's one refusal (W2-D89), and validateOpenRecord's, one
 *  word per remedy for W2-D25's bullets and W2-D90's rule (a code-sha mismatch in step 0a or the pilot reuses `code-changed`).
 *  Only this module declares the list (W2-D12); W2-4's DRIVER_REASONS shares three spellings, `code-changed`, `code-unmeasured` and `assignment-mismatch`.
 *  @type {readonly ['store-id-null', 'store-id-duplicate', 'store-id-unlisted', 'family-unassigned', 'row-cap-mismatch', 'window-mismatch', 'code-changed', 'code-unmeasured', 'writer-malformed', 'writer-leak', 'question-not-run', 'field-missing', 'field-unknown', 'field-malformed', 'constant-mismatch', 'value-outside-set', 'model-alias', 'model-forbidden', 'signed-text-mismatch', 'release-mismatch', 'flag-rejected', 'seed-changed', 'pilot-drift', 'quiz-mismatch', 'quiz-holds-control', 'pilot-quiz-overlap', 'window-length', 'assignment-mismatch', 'draft-mismatch', 'chain-mismatch', 'post-start-change', 'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted']} */
export const GATE_REASONS = Object.freeze([
  // assembleReports (W2-D22, with W2-D13's echoed window) and the gate_code re-check (W2-D24)
  'store-id-null', 'store-id-duplicate', 'store-id-unlisted', 'family-unassigned', 'row-cap-mismatch', 'window-mismatch', 'code-changed', 'code-unmeasured',
  // the question writer's discards (W2-D72)
  'writer-malformed', 'writer-leak',
  // decideGate's one refusal: a question still not-run at gate time (W2-D89)
  'question-not-run',
  // validateOpenRecord (W2-D25, W2-D90)
  'field-missing', 'field-unknown', 'field-malformed', 'constant-mismatch', 'value-outside-set', 'model-alias', 'model-forbidden',
  'signed-text-mismatch', 'release-mismatch', 'flag-rejected', 'seed-changed', 'pilot-drift', 'quiz-mismatch', 'quiz-holds-control',
  'pilot-quiz-overlap', 'window-length', 'assignment-mismatch', 'draft-mismatch', 'chain-mismatch', 'post-start-change',
  'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted',
]);
/** @typedef {(typeof GATE_REASONS)[number]} GateReason */

// ── The family key (W2-D19, W2-D22; spec §10.2 "The cluster unit") ───────────────────────────────────────────
/** A session family's one key: canonical JSON of (store_id, ccrc_id, generation), so equal id strings on two
 *  stores are two families, never one cluster. The assignment hashes it and assembleReports keys by it.
 *  @param {string} storeId
 *  @param {string} ccrcId
 *  @param {string} generation
 *  @returns {string} */
export function familyKey(storeId, ccrcId, generation) {
  return canonicalJson([storeId, ccrcId, generation]);
}
