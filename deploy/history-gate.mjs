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

// ── W2-3 Task 3: turns, windows and the two copy rules (W2-D14, W2-D15, W2-D16, W2-D17; D-5770, D-5771) ───────────
// measure-history.py emits raw rows and spells no K, no turn rule and no model test (W2-D13, D-5772); every window
// decision is this section's. A window is the first K assistant TURNS after a main boundary (ruled Q14, W2-D14):
//   a turn     the window copy's assistant rows in file order, with an angle-bracketed model's row dropped, and
//              consecutive rows with one turnKey (msg_id ?? request_id ?? uuid) grouped; a null-model row stays a
//              turn (W2-D17);
//   it opens   at the boundary's ts_ms, inclusive;
//   it ends    EXCLUSIVE at the earlier of turn K+1's first row's ts_ms and the next main boundary's ts_ms in that
//              copy; with neither, INCLUSIVE at the copy's last timed row;
//   unmeasured when the copy has no timed row; when the row cap cut the copy and turn K+1's first row was not seen,
//              whether or not a next boundary exists (the true turn K+1 may lie between the cap and that boundary);
//              and, chosen by W2-3's plan, when a row that would end the window has a null ts_ms.
// The two copy rules (W2-D15, D-5771): the window reads W1's longest copy (the greatest after_count, ties by lib's
// rule); the producer reads lib.pickHoldingCopy's copy, the one derive.mjs:316 reads, and folds that copy's `models`
// (every assistant row after the summary to the end of the copy, uncapped) through lib.producerOf (W2-D16).
// W2-6 imports turnsOf for its re-discovery unit.

/** @typedef {[number, number|null, string|null, string|null, string, string|null]} RawRow
 *  One assistant entry as measure-history.py emits it: [line, ts_ms, msg_id, request_id, uuid, model]. */
/** @typedef {[number, number, string]} CallRow  One recall_calls row with arm NULL: [ts_ms, rc, verb]. */
/** @typedef {{file_id: number, source_key: string, boundary_line: number, after_count: number,
 *    summary_line: number|null, next_boundary_line: number|null, next_boundary_ts_ms: number|null,
 *    last_ts_ms: number|null, rows: RawRow[], models: Array<string|null>, truncated: boolean}} Copy
 *  One copy holding a boundary (W2-D13). */
/** @typedef {{boundary_uuid: string, ts_ms: number, copies: Copy[]}} BoundaryReport */
/** @typedef {{ccrc_id: string, generation: string, found: boolean, merged_generations: string[],
 *    calls: CallRow[], boundaries: BoundaryReport[]}} FamilyReport */
/** @typedef {{key: string, first_line: number, first_ts_ms: number|null, rows: RawRow[]}} Turn */
/** @typedef {{boundary_uuid: string, ts_ms: number, producer: 'anthropic'|'other'|'unknown',
 *    state: 'measured'|'unmeasured', start_ms: number, end_ms: number|null, end_inclusive: boolean,
 *    turns: number, calls: number, with_call: boolean}} Window */

/** TEMPORARY (W2-D17): Claude Code's own notices carry an angle-bracketed model name and are no backend's turn.
 *  W2-1 extracts lib's isSyntheticModel, has backendOf use it, and rewires this file to import it in place of this
 *  module-local test. A null or empty model is not synthetic: that row stays a turn.
 *  @param {string|null} model @returns {boolean} */
function isSyntheticLocal(model) {
  return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');
}

/** One API response's key (W2-D14): msg_id, else request_id, else the entry's own uuid.
 *  @param {RawRow} row @returns {string} */
export function turnKey(row) {
  return row[2] ?? row[3] ?? row[4];
}

/** A copy's assistant turns in file order (W2-D14): synthetic rows dropped, consecutive rows with one key grouped.
 *  @param {RawRow[]} rows @returns {Turn[]} */
export function turnsOf(rows) {
  /** @type {Turn[]} */
  const turns = [];
  for (const row of rows) {
    if (isSyntheticLocal(row[5])) continue;
    const key = turnKey(row);
    const last = turns.length === 0 ? null : turns[turns.length - 1];
    if (last !== null && last.key === key) last.rows.push(row);
    else turns.push({ key, first_line: row[0], first_ts_ms: row[1], rows: [row] });
  }
  return turns;
}

/** lib.pickHoldingCopy among copies that each hold the boundary: a live one (source_key '') first, then the
 *  smaller file_id. @param {Copy[]} copies @returns {Copy|null} */
function holdingCopyAmong(copies) {
  const id = pickHoldingCopy(copies.map((c) => ({ fileId: c.file_id, live: c.source_key === '', holds: true })));
  return id === null ? null : copies.find((c) => c.file_id === id) ?? null;
}

/** The WINDOW's copy (W2-D15): W1's longest-copy rule, the copy with the most membership rows after the boundary,
 *  so a swap's continued copy is read rather than the one left behind; ties go to lib's rule. Null when no copy
 *  holds the boundary. @param {Copy[]} copies @returns {Copy|null} */
export function windowCopyOf(copies) {
  if (copies.length === 0) return null;
  const most = Math.max(...copies.map((c) => c.after_count));
  return holdingCopyAmong(copies.filter((c) => c.after_count === most));
}

/** The PRODUCER's copy (W2-D15, D-5771): lib.pickHoldingCopy over every copy, the copy derive.mjs:316 reads, so
 *  a window's stratum equals its leaf's producer. @param {Copy[]} copies @returns {Copy|null} */
export function producerCopyOf(copies) {
  return holdingCopyAmong(copies);
}

/** A boundary's producer (W2-D16): lib.producerOf over the producer copy's models, folded here, never in Python.
 *  @param {Copy[]} copies @returns {'anthropic'|'other'|'unknown'} */
export function producerOfBoundary(copies) {
  const c = producerCopyOf(copies);
  return c === null ? 'unknown' : producerOf(c.models);
}

/** One boundary's window over its window copy (W2-D14), with the calls whose ts_ms lies inside it. An unmeasured
 *  window carries end_ms null and no turns or calls, so no total can count it by accident.
 *  @param {BoundaryReport} boundary @param {CallRow[]} calls @param {number} [k] @returns {Window} */
export function windowOf(boundary, calls, k = K) {
  const start = boundary.ts_ms;
  const head = { boundary_uuid: boundary.boundary_uuid, ts_ms: start, producer: producerOfBoundary(boundary.copies) };
  /** @type {Window} */
  const unmeasured = { ...head, state: 'unmeasured', start_ms: start, end_ms: null, end_inclusive: false, turns: 0, calls: 0, with_call: false };
  const copy = windowCopyOf(boundary.copies);
  if (copy === null || copy.last_ts_ms === null) return unmeasured;
  // P4: W1's summary search is not bounded by the next main boundary, so a boundary with no summary of its own reads
  // the next one's; its rows are then empty and its first K turns unseen. Unmeasured, never a 0-turn window to that boundary.
  if (copy.summary_line !== null && copy.next_boundary_line !== null && copy.summary_line > copy.next_boundary_line) return unmeasured;
  const turns = turnsOf(copy.rows);
  const sawNext = turns.length > k;
  if (!sawNext && copy.truncated) return unmeasured;
  /** @type {Array<number|null>} */
  const ends = [];
  if (sawNext) ends.push(turns[k].first_ts_ms);
  if (copy.next_boundary_line !== null) ends.push(copy.next_boundary_ts_ms);
  if (ends.some((t) => t === null)) return unmeasured;
  const inclusive = ends.length === 0;
  const end = inclusive ? copy.last_ts_ms : Math.min(.../** @type {number[]} */ (ends));
  const inside = (/** @type {number} */ ts) => ts >= start && (inclusive ? ts <= end : ts < end);
  const n = calls.filter((c) => inside(c[0])).length;
  return { ...head, state: 'measured', start_ms: start, end_ms: end, end_inclusive: inclusive, turns: Math.min(turns.length, k), calls: n, with_call: n > 0 };
}

/** Every window of one family's report, in its boundaries' order; none for a family the store does not hold.
 *  @param {FamilyReport} family @param {number} [k] @returns {Window[]} */
export function buildWindows(family, k = K) {
  if (!family.found) return [];
  return family.boundaries.map((b) => windowOf(b, family.calls, k));
}

/** The totals O52 pins: measured windows, those with a call, their calls and turns; unmeasured windows counted
 *  apart and never in the others. @param {Window[]} windows
 *  @returns {{windows: number, with_call: number, calls: number, turns: number, unmeasured: number}} */
export function windowTotals(windows) {
  const t = { windows: 0, with_call: 0, calls: 0, turns: 0, unmeasured: 0 };
  for (const w of windows) {
    if (w.state !== 'measured') {
      t.unmeasured += 1;
      continue;
    }
    t.windows += 1;
    t.with_call += w.with_call ? 1 : 0;
    t.calls += w.calls;
    t.turns += w.turns;
  }
  return t;
}

/** A family's ts-ordered calls split at its first exit 8 (spec §10.2:2722, :2728): `upTo` holds every call up to and
 *  including the first rc === EXIT.RECALL_OFF, `after` the rest, reported apart. No exit 8: every call is `upTo`.
 *  @param {CallRow[]} calls @returns {{upTo: CallRow[], after: CallRow[]}} */
export function splitAtFirstExit8(calls) {
  const i = calls.findIndex((c) => c[1] === EXIT.RECALL_OFF);
  return i < 0 ? { upTo: [...calls], after: [] } : { upTo: calls.slice(0, i + 1), after: calls.slice(i + 1) };
}

// ── W2-3 Task 4: the families active at W2 open (W2-D20; D-5773 (history-w2-legacy-families-excluded)) ──────────
// measure-history.py --census reads every sessions row of one store as of W2 open (the census instant T0, recorded
// per node in part 2) and decides nothing; these functions decide. A family (store_id, ccrc_id, generation) is active
// iff:
//   (a) merged_into is null and its generation matches lib's UUID_RE. A legacy '' family is excluded, and that is
//       fixed (D-5773): a re-key mid-window would leave its control file stale with no change row, and the W2 flow
//       cannot write a legacy control file (W2-D27, W2-D84);
//   (b) it is its id's newest unmerged family, in recall.mjs's NEWEST_FAMILY_SQL order (first_seen_ms DESC, then
//       session_pk DESC). This module reads lib alone, so that order is spelled a second time here, as
//       newestFamilyCompare, and held equal to recall's by the parity case in measure-history.test.ts. A legacy ''
//       row takes part in the order, as it does in recall's, so an id whose newest unmerged row is legacy has no
//       active family;
//   (c) its last main entry before as_of (the census's last_main_ts_ms) lies in [as_of - look-back, as_of).
// Every excluded family carries exactly one ACTIVE_EXCLUSIONS reason, the first clause it fails, in the order merged,
// legacy, not-newest, no-recent-entry. The registry check that follows is W2-5a's verify --registry.

/**
 * One census row (measure-history.py --census): one per sessions row of the store, merged ones included. `calls`
 * are [ts_ms, rc, verb] and `boundaries` family_report's boundary reports, both over [since, as_of).
 * @typedef {{ccrc_id: string, generation: string, session_pk: number, merged_into: number|null,
 *   first_seen_ms: number, last_main_ts_ms: number|null, merged_generations: string[],
 *   calls: Array<[number, number, string]>, boundaries: object[]}} CensusFamily
 */
/**
 * measure-history.py's `census` key.
 * @typedef {{as_of_ms: number, since_ms: number, row_cap: number,
 *   ticks: {n: number, first_ts_ms: number|null, last_ts_ms: number|null}, families: CensusFamily[]}} CensusReport
 */
/**
 * A family, keyed as the assignment (W2-D19) and assembleReports (W2-D22) key it.
 * @typedef {{store_id: string, ccrc_id: string, generation: string}} FamilyRef
 */

/** The open record's default look-back, `active_rule.lookback_ms`: 7 days. */
export const ACTIVE_LOOKBACK_MS = 604_800_000;

/**
 * recall.mjs's NEWEST_FAMILY_SQL order as a comparator: negative when `a` is the newer family. first_seen_ms DESC,
 * then session_pk DESC. A second spelling of that order, held equal to it by the parity pin (W2-D20).
 * @param {CensusFamily} a
 * @param {CensusFamily} b
 * @returns {number}
 */
export function newestFamilyCompare(a, b) {
  if (a.first_seen_ms !== b.first_seen_ms) return b.first_seen_ms - a.first_seen_ms;
  return b.session_pk - a.session_pk;
}

/**
 * The id's newest unmerged family, or null when the census holds no unmerged row of that id. Merged rows never take
 * part, as NEWEST_FAMILY_SQL's `merged_into IS NULL` keeps them out.
 * @param {CensusFamily[]} families
 * @param {string} ccrcId
 * @returns {CensusFamily|null}
 */
export function newestFamilyOf(families, ccrcId) {
  let best = null;
  for (const f of families) {
    if (f.ccrc_id !== ccrcId || f.merged_into !== null) continue;
    if (best === null || newestFamilyCompare(f, best) < 0) best = f;
  }
  return best;
}

/**
 * Refuses a census row that cannot be read as the shape measure-history.py prints, with a TypeError. A row whose
 * merged_into is not null or an integer would read as merged, one whose generation is not a string as legacy, and one
 * whose ids, first_seen_ms or last_main_ts_ms are not what they should be would shift the newest order or read as
 * having no recent entry: each would change the answer silently, so none is read.
 * @param {CensusFamily} f
 * @returns {void}
 */
function assertCensusRow(f) {
  const where = JSON.stringify([f?.ccrc_id, f?.generation, f?.session_pk]);
  if (typeof f?.ccrc_id !== 'string') throw new TypeError(`activeFamilies: census row ${where} has no string ccrc_id`);
  if (typeof f.generation !== 'string') throw new TypeError(`activeFamilies: census row ${where} has no string generation`);
  if (!Number.isSafeInteger(f.session_pk)) throw new TypeError(`activeFamilies: census row ${where} has no integer session_pk`);
  if (f.merged_into !== null && !Number.isSafeInteger(f.merged_into)) throw new TypeError(`activeFamilies: census row ${where} has a merged_into that is neither null nor an integer`);
  if (!Number.isSafeInteger(f.first_seen_ms)) throw new TypeError(`activeFamilies: census row ${where} has no integer first_seen_ms`);
  if (f.last_main_ts_ms !== null && !Number.isSafeInteger(f.last_main_ts_ms)) throw new TypeError(`activeFamilies: census row ${where} has a last_main_ts_ms that is neither null nor an integer`);
}

/**
 * The first W2-D20 clause `f` fails, as its ACTIVE_EXCLUSIONS word, or null when it is active.
 * @param {CensusFamily} f
 * @param {Map<string, CensusFamily|null>} newest
 * @param {number} from
 * @param {number} asOf
 * @returns {'merged'|'legacy'|'not-newest'|'no-recent-entry'|null}
 */
function exclusionOf(f, newest, from, asOf) {
  if (f.merged_into !== null) return 'merged';
  if (!UUID_RE.test(f.generation)) return 'legacy';
  if (newest.get(f.ccrc_id)?.session_pk !== f.session_pk) return 'not-newest';
  const last = f.last_main_ts_ms;
  if (!Number.isSafeInteger(last) || last < from || last >= asOf) return 'no-recent-entry';
  return null;
}

/**
 * W2-D20's rule over one store's census: the families active at W2 open, and every other family with the one reason
 * it is not. Both lists are sorted by familyKey. It throws a TypeError, and never answers, on a store_id that is not a
 * UUID, a census with no integer as_of_ms or no families list, or a look-back that is not a whole, non-negative number
 * of ms, or on a census row of a malformed shape (assertCensusRow): a census read in part would answer families active that
 * are not.
 * @param {string} storeId
 * @param {CensusReport} census
 * @param {{lookbackMs?: number}} [opts]
 * @returns {{active: FamilyRef[], excluded: Array<FamilyRef & {reason: 'merged'|'legacy'|'not-newest'|'no-recent-entry'}>}}
 */
export function activeFamilies(storeId, census, opts = {}) {
  if (typeof storeId !== 'string' || !UUID_RE.test(storeId)) throw new TypeError(`activeFamilies: ${JSON.stringify(storeId)} is not a store id`);
  if (!Number.isSafeInteger(census?.as_of_ms)) throw new TypeError('activeFamilies: the census carries no integer as_of_ms');
  if (!Array.isArray(census.families)) throw new TypeError('activeFamilies: the census carries no families list');
  // Only an absent or undefined look-back means the default; an explicit null is refused below, never read as 7 days.
  const lookbackMs = opts.lookbackMs === undefined ? ACTIVE_LOOKBACK_MS : opts.lookbackMs;
  if (!Number.isSafeInteger(lookbackMs) || lookbackMs < 0) throw new TypeError(`activeFamilies: look-back ${JSON.stringify(lookbackMs)} is not a whole, non-negative number of ms`);
  for (const f of census.families) assertCensusRow(f);
  const asOf = census.as_of_ms;
  const from = asOf - lookbackMs;
  /** @type {Map<string, CensusFamily|null>} */
  const newest = new Map();
  for (const f of census.families) if (!newest.has(f.ccrc_id)) newest.set(f.ccrc_id, newestFamilyOf(census.families, f.ccrc_id));
  const active = [];
  const excluded = [];
  for (const f of census.families) {
    const ref = { store_id: storeId, ccrc_id: f.ccrc_id, generation: f.generation };
    const reason = exclusionOf(f, newest, from, asOf);
    if (reason === null) active.push(ref);
    else excluded.push({ ...ref, reason });
  }
  const byKey = (a, b) => {
    const x = familyKey(a.store_id, a.ccrc_id, a.generation);
    const y = familyKey(b.store_id, b.ccrc_id, b.generation);
    return x < y ? -1 : x > y ? 1 : 0;
  };
  return { active: active.sort(byKey), excluded: excluded.sort(byKey) };
}

// ── W2-3 Task 5: changed families and the assembled reports (W2-D22, W2-D23, W2-D24) ─────────────────────────────
// Pure, like the rest of this module. changedFamilies reads the presence record's meta rows (W2-D30's keys) and
// answers which listed families' recall-off files changed during the window; the drop applies to the reported arm
// comparisons only, never to criterion 3 (W2-D23; decideGate, Task 8). assembleReports turns each node's
// measure-history.py report into keyed families with their windows, or refuses with one GATE_REASONS word and no
// partial answer (W2-D22), re-checking each report's script_sha256 against the record's gate_code (W2-D24).

/** TEMPORARY (W2-D23): the presence record's meta prefix (W2-D30), spelled here only until W2-1 defines
 *  `RECALL_OFF_META` in lib.mjs, replaces this binding with an import of it and adds the Python twin pin. Module-
 *  local and never exported, so no other module can come to read this spelling. */
const RECALL_OFF_PREFIX_LOCAL = 'recall_off:';

/** A key's ms field: a decimal integer with no sign, no fraction and no leading zero. */
const RECALL_OFF_MS_RE = /^(?:0|[1-9][0-9]*)$/;

/** A meta row value's ms field: a non-negative safe integer. */
const isMsValue = (v) => Number.isSafeInteger(v) && v >= 0;

/** A presence row off W2-D30's grammar is a store defect, never "no change": it throws, so a malformed change row
 *  can never read as a family that did not change. */
function recallOffOffGrammar(k, why) {
  throw new Error(`recall-off meta row ${JSON.stringify(k)}: ${why}`);
}

/**
 * One meta row of the recall-off presence record (W2-D30), read: `recall_off:change:<ts_ms>:<id>` with
 * `{from, to, prev_seen_ms}`, and `recall_off:gap:<ts_ms>` with `{from, to}`. Every other key, including the
 * record's own `state:<id>` and `seen_ms` rows, is `{kind: 'other'}`. A change or gap row off the grammar throws.
 * @param {string} k
 * @param {string} v
 * @returns {{kind: 'change', ts_ms: number, id: string, from: unknown, to: unknown, prev_seen_ms: number | null}
 *   | {kind: 'gap', ts_ms: number, from: number | null, to: number}
 *   | {kind: 'other'}}
 */
export function parseRecallOffRow(k, v) {
  if (typeof k !== 'string' || !k.startsWith(RECALL_OFF_PREFIX_LOCAL)) return { kind: 'other' };
  const rest = k.slice(RECALL_OFF_PREFIX_LOCAL.length);
  const kind = rest.startsWith('change:') ? 'change' : rest.startsWith('gap:') ? 'gap' : null;
  if (kind === null) return { kind: 'other' };
  const tail = rest.slice(kind.length + 1);
  const colon = tail.indexOf(':');
  const tsText = kind === 'change' && colon >= 0 ? tail.slice(0, colon) : tail;
  if (!RECALL_OFF_MS_RE.test(tsText)) return recallOffOffGrammar(k, 'its ts_ms is not a decimal integer');
  const ts_ms = Number(tsText);
  if (!Number.isSafeInteger(ts_ms)) return recallOffOffGrammar(k, 'its ts_ms is past the safe integers');
  let body;
  try { body = JSON.parse(v); } catch { return recallOffOffGrammar(k, 'its value is not JSON'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return recallOffOffGrammar(k, 'its value is not an object');
  if (!Object.hasOwn(body, 'from') || !Object.hasOwn(body, 'to')) return recallOffOffGrammar(k, 'its value lacks from or to');
  if (kind === 'gap') {
    if (!(body.from === null || isMsValue(body.from)) || !isMsValue(body.to)) {
      return recallOffOffGrammar(k, 'a gap row\'s from is an ms or null, and its to an ms');
    }
    return { kind: 'gap', ts_ms, from: body.from, to: body.to };
  }
  const id = colon >= 0 ? tail.slice(colon + 1) : '';
  if (id === '') return recallOffOffGrammar(k, 'a change row\'s key names no id');
  if (!Object.hasOwn(body, 'prev_seen_ms') || !(body.prev_seen_ms === null || isMsValue(body.prev_seen_ms))) {
    return recallOffOffGrammar(k, 'a change row\'s prev_seen_ms is an ms or null');
  }
  return { kind: 'change', ts_ms, id, from: body.from, to: body.to, prev_seen_ms: body.prev_seen_ms };
}

/** A recall-off file is per id on one store, so a change row reaches every listed generation of its id there. */
const recallOffIdKey = (storeId, id) => canonicalJson([storeId, id]);

/**
 * W2-D23: the listed families whose recall-off file changed during the window. A family of the list is dropped
 * when any change row of its store and id satisfies `(prev_seen_ms ?? -Infinity) < window.end_ms && ts_ms >=
 * window.start_ms`: the change happened after the last observation before the window's end and was recorded at or
 * after its start. A null prev_seen_ms (the first observation, or the first after a recovery) reads as -Infinity.
 * Gap rows are reported, by the same overlap test over `(from, ts_ms)`, and drop nothing. Both lists are sorted, so
 * the answer does not depend on row order. The drop applies to the reported arm comparisons only (decideGate).
 * @param {Array<{store_id: string, k: string, v: string}>} metaRows
 * @param {{start_ms: number, end_ms: number}} window
 * @param {Array<{store_id: string, ccrc_id: string, generation: string}>} list
 * @returns {{changed: string[], gaps: Array<{store_id: string, ts_ms: number, from: number | null, to: number}>}}
 */
export function changedFamilies(metaRows, window, list) {
  // An unruled window is refused by a throw, never read as "nothing changed": every comparison against a missing or
  // NaN bound is false, which would drop no family and report none.
  if (window === null || typeof window !== 'object' || !Number.isSafeInteger(window.start_ms)
    || !Number.isSafeInteger(window.end_ms) || !(window.start_ms < window.end_ms)) {
    throw new TypeError(`changedFamilies: the window is {start_ms, end_ms}, two safe integers with start before end: ${JSON.stringify(window ?? null)}`);
  }
  const hit = new Set();
  const gaps = [];
  for (const row of metaRows) {
    const r = parseRecallOffRow(row.k, row.v);
    if (r.kind !== 'other' && typeof row.store_id !== 'string') {
      throw new TypeError(`changedFamilies: a ${r.kind} row (${JSON.stringify(row.k)}) carries no string store_id: ${JSON.stringify(row.store_id ?? null)}`);
    }
    if (r.kind === 'change') {
      if ((r.prev_seen_ms ?? -Infinity) < window.end_ms && r.ts_ms >= window.start_ms) hit.add(recallOffIdKey(row.store_id, r.id));
    } else if (r.kind === 'gap') {
      if ((r.from ?? -Infinity) < window.end_ms && r.ts_ms >= window.start_ms) gaps.push({ store_id: row.store_id, ts_ms: r.ts_ms, from: r.from, to: r.to });
    }
  }
  const changed = [...new Set(list.filter((f) => hit.has(recallOffIdKey(f.store_id, f.ccrc_id)))
    .map((f) => familyKey(f.store_id, f.ccrc_id, f.generation)))].sort();
  gaps.sort((a, b) => (a.store_id < b.store_id ? -1 : a.store_id > b.store_id ? 1 : a.ts_ms - b.ts_ms));
  return { changed, gaps };
}

/**
 * W2-D22 and W2-D24: every node's measure-history.py report (Task 1's shape, `w2 = {row_cap, window_start_ms,
 * window_end_ms, families}`), keyed and
 * checked against the open record. Refused, with the first GATE_REASONS word found and no partial answer, in this
 * order per report: a null store_id (store-id-null); a store_id an earlier report carried (store-id-duplicate); a
 * store_id outside `record.nodes` (store-id-unlisted); a family whose `familyKey(store_id, ccrc_id, generation)` is
 * not in `record.assignment` (family-unassigned); a `w2.row_cap` other than ROW_CAP, a W1 report's absent w2
 * included (row-cap-mismatch); a `script_sha256` missing on either side (code-unmeasured, which no flag covers:
 * W2-D24, amended 2026-10-19); a `script_sha256` other than `gate_code.files['deploy/measure-history.py']`
 * (code-changed), where `opts.allowCodeChange` refuses nothing and stamps `code_changed: true` instead; and an echoed window that is not the record's `window`, part 2's, or none (window-mismatch; W2-D13 and W2-D22, amended
 * 2026-10-19: a report measured over another window than the record's is never assembled). A record whose `window` is not
 * two safe integers is refused window-mismatch before any report is read. Excluded and reported, never refused: `found: false` families (not_found), families
 * with no measured window (zero_windows; W2-D18: such a family is no cluster), each unmeasured window (unmeasured,
 * keyed `canonicalJson([store_id, ccrc_id, generation, boundary_uuid])`), and each assigned family that no report
 * lists (not_listed). No void threshold. Every list is sorted, so report order changes nothing.
 * Internally malformed input throws a TypeError rather than being read as empty: a non-null `w2` with no families array,
 * and a listed family without a string ccrc_id, a string generation and a boolean found (a report with no `w2` is
 * row-cap-mismatch). `changedFamilies` throws a TypeError on a window that is not two safe integers with start before
 * end, and on a change or gap row without a string store_id.
 * @param {Array<{store_id: string | null, script_sha256?: string, w2: {row_cap: number, window_start_ms: number, window_end_ms: number, families: Array<object>} | null}>} reports
 * @param {{nodes: Array<{store_id: string}>, assignment: Array<{store_id: string, ccrc_id: string, generation: string, arm: string}>,
 *   gate_code: {files: Record<string, string>}, window: {start_ms: number, end_ms: number}}} record
 * @param {{allowCodeChange?: boolean}} [opts]
 * @returns {{ok: true, families: Array<{key: string, store_id: string, ccrc_id: string, generation: string, arm: string, windows: Array<object>}>,
 *   excluded: {not_found: string[], zero_windows: string[], unmeasured: {count: number, keys: string[]}, not_listed: string[]},
 *   code_changed: boolean} | {ok: false, reason: string, detail: string}}
 */
export function assembleReports(reports, record, opts = {}) {
  const refuse = (reason, detail) => ({ ok: false, reason, detail });
  const nodes = new Set(record.nodes.map((n) => n.store_id));
  const arms = new Map(record.assignment.map((a) => [familyKey(a.store_id, a.ccrc_id, a.generation), a.arm]));
  const pinned = record.gate_code.files['deploy/measure-history.py'];
  const seen = new Set();
  const keyed = [];
  let codeChanged = false;
  const want = [record.window?.start_ms, record.window?.end_ms];   // part 2's window, half-open (W2-D22, amended)
  if (!want.every((ms) => Number.isSafeInteger(ms))) return refuse('window-mismatch', `the record carries no window (window.start_ms, window.end_ms): ${JSON.stringify(record.window ?? null)}`);
  for (const [i, rep] of reports.entries()) {
    const at = `report ${i}`;
    if (rep.store_id === null || rep.store_id === undefined) return refuse('store-id-null', `${at} names no store_id: its store has no meta store_id`);
    if (seen.has(rep.store_id)) return refuse('store-id-duplicate', `${at}: store ${rep.store_id} is measured by an earlier report too`);
    seen.add(rep.store_id);
    if (!nodes.has(rep.store_id)) return refuse('store-id-unlisted', `${at}: store ${rep.store_id} is not one of the record's nodes`);
    // A report with no w2 (a W1 report) reaches row-cap-mismatch below; a w2 that is no object with a families array
    // is internally malformed, never an empty list (an assigned family would then land in not_listed unnoticed).
    if (rep.w2 !== null && rep.w2 !== undefined && !Array.isArray(rep.w2.families)) {
      throw new TypeError(`assembleReports: ${at}: w2 is no object holding a families array`);
    }
    for (const f of rep.w2?.families ?? []) {
      if (f === null || typeof f !== 'object' || typeof f.ccrc_id !== 'string' || typeof f.generation !== 'string' || typeof f.found !== 'boolean') {
        throw new TypeError(`assembleReports: ${at}: a listed family needs a string ccrc_id, a string generation and a boolean found: ${JSON.stringify(f ?? null)}`);
      }
      const key = familyKey(rep.store_id, f.ccrc_id, f.generation);
      if (!arms.has(key)) return refuse('family-unassigned', `${at}: family ${key} is not in the record's assignment`);
      keyed.push({ key, store_id: rep.store_id, f });
    }
    if (rep.w2?.row_cap !== ROW_CAP) return refuse('row-cap-mismatch', `${at}: row_cap ${JSON.stringify(rep.w2?.row_cap ?? null)}, and the gate's ROW_CAP is ${ROW_CAP}`);
    if (typeof pinned !== 'string' || typeof rep.script_sha256 !== 'string') return refuse('code-unmeasured', `${at}: measure-history.py sha256 ${JSON.stringify(rep.script_sha256 ?? null)}, and gate_code records ${JSON.stringify(pinned ?? null)}: a missing sha is unmeasured, never a change`);
    if (rep.script_sha256 !== pinned) {
      if (opts.allowCodeChange !== true) return refuse('code-changed', `${at}: measure-history.py sha256 ${JSON.stringify(rep.script_sha256)}, and gate_code records ${JSON.stringify(pinned)}`);
      codeChanged = true;
    }
    const echo = [rep.w2.window_start_ms, rep.w2.window_end_ms];
    if (echo[0] !== want[0] || echo[1] !== want[1]) return refuse('window-mismatch', `${at}: window ${JSON.stringify(echo)}, and the record's is ${JSON.stringify(want)}`);
  }
  const families = [];
  const notFound = [];
  const zeroWindows = [];
  const unmeasured = [];
  const listed = new Set();
  for (const { key, store_id, f } of keyed) {
    if (listed.has(key)) throw new Error(`assembleReports: family ${key} is listed twice in one report`);
    listed.add(key);
    if (f.found !== true) { notFound.push(key); continue; }
    const measured = [];
    for (const w of buildWindows(f)) {
      if (w.state === 'measured') measured.push(w);
      else unmeasured.push(canonicalJson([store_id, f.ccrc_id, f.generation, w.boundary_uuid]));
    }
    if (measured.length === 0) { zeroWindows.push(key); continue; }
    families.push({ key, store_id, ccrc_id: f.ccrc_id, generation: f.generation, arm: arms.get(key), windows: measured });
  }
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return {
    ok: true,
    families: families.sort(byKey),
    excluded: {
      not_found: notFound.sort(),
      zero_windows: zeroWindows.sort(),
      unmeasured: { count: unmeasured.length, keys: unmeasured.sort() },
      not_listed: [...arms.keys()].filter((k) => !listed.has(k)).sort(),
    },
    code_changed: codeChanged,
  };
}

// ── W2-3 Task 6: the bootstrap, the assignment and Q18 (W2-D18, W2-D19, W2-D21) ────────────────────────────────────
// Every draw the gate makes comes from here, and every one is seeded from a parameter: no function below reads a
// seed, a clock or an ambient source of randomness, and none takes a default seed. A substream's state is the first
// 16 bytes of sha256Hex(seedHex + ':' + label), read as four little-endian u32 words, over the closed SUBSTREAMS plus
// PILOT_SUBSTREAM (passed only with the pilot's own seed); the generator is xoshiro128**, and an all-zero state is
// refused. Integers are drawn by rejection, never by a bare modulo. Every statistic is an exact integer fraction,
// pooled per resample and compared by cross-multiplication. A family's arm is one hash bit of its own key (W2-D19),
// so no family's arm depends on which other families are listed. Q18 (W2-D21) is the math only: W2-5a's `power`
// gathers its inputs.

/** An exact fraction: safe integers, den >= 1, never reduced (a pooled statistic keeps its counts).
 *  @typedef {{ readonly num: number, readonly den: number }} Frac */
/** A seeded stream of u32 words.
 *  @typedef {{ nextU32: () => number }} Rng */

/**
 * @param {number} num
 * @param {number} den
 * @returns {Frac}
 */
export function frac(num, den) {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den < 1) {
    throw new RangeError(`frac: ${num}/${den} is not an exact fraction (safe integers, den >= 1)`);
  }
  return Object.freeze({ num, den });
}

/**
 * The sign of a.num * b.den - b.num * a.den. A product past 2^53 is taken again in BigInt, so the answer is exact
 * at every size: a float product at or below MAX_SAFE_INTEGER is the exact product.
 * @param {Frac} a
 * @param {Frac} b
 * @returns {-1|0|1}
 */
export function cmpFrac(a, b) {
  const l = a.num * b.den;
  const r = b.num * a.den;
  if (Math.abs(l) <= Number.MAX_SAFE_INTEGER && Math.abs(r) <= Number.MAX_SAFE_INTEGER) return l < r ? -1 : l > r ? 1 : 0;
  const L = BigInt(a.num) * BigInt(b.den);
  const R = BigInt(b.num) * BigInt(a.den);
  return L < R ? -1 : L > R ? 1 : 0;
}

/**
 * xoshiro128** (Blackman and Vigna, 2018) over four u32 words. A zero state stays zero for ever, so it is refused.
 * @param {[number, number, number, number]} words
 * @returns {Rng}
 */
export function xoshiro128ss(words) {
  if (!Array.isArray(words) || words.length !== 4 || !words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffffffff)) {
    throw new RangeError('xoshiro128ss: the state is four u32 words');
  }
  if (words.every((w) => w === 0)) throw new RangeError('xoshiro128ss: an all-zero state is refused');
  let [s0, s1, s2, s3] = words;
  const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return {
    nextU32() {
      const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
      const t = (s1 << 9) >>> 0;
      s2 = (s2 ^ s0) >>> 0;
      s3 = (s3 ^ s1) >>> 0;
      s1 = (s1 ^ s2) >>> 0;
      s0 = (s0 ^ s3) >>> 0;
      s2 = (s2 ^ t) >>> 0;
      s3 = rotl(s3, 11);
      return result;
    },
  };
}

/**
 * The stream for one label of one seed (W2-D18). The label must be a SUBSTREAMS member or PILOT_SUBSTREAM: the
 * assignment's ASSIGN_LABEL is a hash label, never a stream.
 * @param {string} seedHex
 * @param {string} label
 * @returns {Rng}
 */
export function substream(seedHex, label) {
  if (typeof seedHex !== 'string' || seedHex === '') throw new TypeError('substream: the seed is a non-empty string, passed in');
  if (!SUBSTREAMS.includes(label) && label !== PILOT_SUBSTREAM) throw new RangeError(`substream: '${label}' is not a substream label`);
  const hex = sha256Hex(`${seedHex}:${label}`);
  const byte = (i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const word = (w) => (byte(w * 4) | (byte(w * 4 + 1) << 8) | (byte(w * 4 + 2) << 16) | (byte(w * 4 + 3) << 24)) >>> 0;
  return xoshiro128ss([word(0), word(1), word(2), word(3)]);
}

/**
 * A uniform integer in [0, n), by rejection: a word at or above the largest multiple of n below 2^32 is drawn again.
 * @param {Rng} rng
 * @param {number} n
 * @returns {number}
 */
export function randInt(rng, n) {
  if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new RangeError(`randInt: n=${n} is not an integer in [1, 2^32]`);
  const limit = 0x100000000 - (0x100000000 % n);
  for (;;) {
    const w = rng.nextU32();
    if (w < limit) return w % n;
  }
}

/**
 * The nearest-rank percentile ranks (1-based) of a 95% interval over B sorted replicates: ceil(0.025 B), ceil(0.975 B).
 * @param {number} B
 * @returns {{ lowRank: number, highRank: number }}
 */
export function nearestRankBounds(B) {
  if (!Number.isSafeInteger(B) || B < 1) throw new RangeError(`nearestRankBounds: B=${B} is not a positive integer`);
  return { lowRank: Math.ceil((B * 25) / 1000), highRank: Math.ceil((B * 975) / 1000) };
}

/**
 * One cluster's counts as a pooled numerator and denominator. share: {num: windows with a call, den: measured
 * windows}. paired: {t: correct in treatment, c: correct in control, n: questions}, giving (t - c) over n.
 * @param {{num: number, den: number} | {t: number, c: number, n: number}} k
 * @param {'paired'|'share'} mode
 * @returns {{ num: number, den: number }}
 */
function bootstrapUnit(k, mode) {
  const nat = (v) => Number.isSafeInteger(v) && v >= 0;
  if (mode === 'share') {
    const s = /** @type {{num: number, den: number}} */ (k);
    if (!nat(s.num) || !nat(s.den) || s.num > s.den) throw new RangeError(`clusterBootstrap: ${JSON.stringify(k)} is not a share cluster`);
    return { num: s.num, den: s.den };
  }
  const q = /** @type {{t: number, c: number, n: number}} */ (k);
  if (!nat(q.t) || !nat(q.c) || !nat(q.n) || q.t > q.n || q.c > q.n) throw new RangeError(`clusterBootstrap: ${JSON.stringify(k)} is not a paired cluster`);
  return { num: q.t - q.c, den: q.n };
}

/**
 * The session-cluster bootstrap (W2-D18): B resamples of the clusters with replacement, each replicate the pooled
 * exact fraction of the resampled clusters' counts, and the nearest-rank 95% interval. A cluster with a zero
 * denominator (a family with 0 measured windows, or 0 questions) is not a cluster. With no cluster left it throws:
 * there is no statistic, and no number stands in for one.
 * @param {{ clusters: Array<{num: number, den: number} | {t: number, c: number, n: number}>, B?: number, rng: Rng, mode: 'paired'|'share' }} input
 * @returns {{ point: Frac, lower: Frac, upper: Frac }}
 */
export function clusterBootstrap({ clusters, B = BOOTSTRAP.B, rng, mode }) {
  if (mode !== 'paired' && mode !== 'share') throw new RangeError(`clusterBootstrap: mode '${mode}' is neither paired nor share`);
  const units = clusters.map((k) => bootstrapUnit(k, mode)).filter((u) => u.den > 0);
  if (units.length === 0) throw new RangeError('clusterBootstrap: no cluster has a measured unit');
  const { lowRank, highRank } = nearestRankBounds(B);
  const m = units.length;
  /** @type {Frac[]} */
  const reps = new Array(B);
  for (let b = 0; b < B; b++) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < m; i++) {
      const u = units[randInt(rng, m)];
      num += u.num;
      den += u.den;
    }
    reps[b] = frac(num, den);
  }
  reps.sort(cmpFrac);
  let num = 0;
  let den = 0;
  for (const u of units) {
    num += u.num;
    den += u.den;
  }
  return { point: frac(num, den), lower: reps[lowRank - 1], upper: reps[highRank - 1] };
}

/** @param {unknown} f @returns {asserts f is FamilyRef} */
function assertFamilyRef(f) {
  const o = /** @type {Record<string, unknown>} */ (f);
  if (o === null || typeof o !== 'object' || typeof o.store_id !== 'string' || typeof o.ccrc_id !== 'string' || typeof o.generation !== 'string') {
    throw new TypeError(`assignment: ${JSON.stringify(f)} is not a family (store_id, ccrc_id, generation)`);
  }
}

/**
 * A family's arm (W2-D19): bit 0 of the first byte of sha256 over the UTF-8 bytes of
 * seedHex + ':assign:' + canonicalJson([store_id, ccrc_id, generation]); 1 is treatment, 0 control.
 * @param {string} seedHex
 * @param {FamilyRef} f
 * @returns {'treatment'|'control'}
 */
export function armOf(seedHex, f) {
  if (typeof seedHex !== 'string' || seedHex === '') throw new TypeError('armOf: the seed is a non-empty string, passed in');
  assertFamilyRef(f);
  const h = sha256Hex(`${seedHex}:${ASSIGN_LABEL}:${familyKey(f.store_id, f.ccrc_id, f.generation)}`);
  return (parseInt(h.slice(0, 2), 16) & 1) === 1 ? 'treatment' : 'control';
}

/**
 * Entries sorted by their canonicalJson, compared as strings.
 * @template T
 * @param {T[]} list
 * @returns {T[]}
 */
function sortByCanonical(list) {
  return list.map((e) => /** @type {[string, T]} */ ([canonicalJson(e), e]))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, e]) => e);
}

/**
 * The assignment list: every family with its arm, sorted by canonicalJson. A family listed twice is refused.
 * @param {string} seedHex
 * @param {FamilyRef[]} families
 * @returns {Array<FamilyRef & { arm: 'treatment'|'control' }>}
 */
export function assignArms(seedHex, families) {
  const seen = new Set();
  return sortByCanonical(families.map((f) => {
    assertFamilyRef(f);
    const key = familyKey(f.store_id, f.ccrc_id, f.generation);
    if (seen.has(key)) throw new RangeError(`assignArms: family ${key} is listed twice`);
    seen.add(key);
    return { store_id: f.store_id, ccrc_id: f.ccrc_id, generation: f.generation, arm: armOf(seedHex, f) };
  }));
}

/**
 * assignment_sha256 (W2-D19): sha256Hex(canonicalJson(the list sorted by canonicalJson)). It sorts a copy itself,
 * so the order an input arrives in never moves it; a changed arm does.
 * @param {Array<FamilyRef & { arm: string }>} list
 * @returns {string}
 */
export function assignmentSha256(list) {
  return sha256Hex(canonicalJson(sortByCanonical([...list])));
}

/**
 * A double strictly inside (0, 1) from two words: 27 bits of the first and 26 of the second make a 53-bit integer, offset
 * by half a step, so 0 is never reached. Near the top that sum is not representable and rounds up to 2^53 (2^11 word pairs,
 * 2^-53 of draws), which would be exactly 1, so the result is clamped to the largest double below 1; no other output moves.
 * @param {Rng} rng
 */
function uniformOpen01(rng) {
  const a = rng.nextU32() >>> 5;
  const b = rng.nextU32() >>> 6;
  return Math.min((a * 67108864 + b + 0.5) / 9007199254740992, 1 - 2 ** -53);
}

/** A standard normal draw: Box and Muller, one of the pair. @param {Rng} rng */
function normalDraw(rng) {
  const u1 = uniformOpen01(rng);
  const u2 = uniformOpen01(rng);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** A Gamma(shape, 1) draw: Marsaglia and Tsang (2000), with the U^(1/shape) boost below shape 1.
 *  @param {Rng} rng @param {number} shape @returns {number} */
function gammaDraw(rng, shape) {
  if (shape < 1) {
    const g = gammaDraw(rng, shape + 1);
    return g * Math.pow(uniformOpen01(rng), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normalDraw(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = uniformOpen01(rng);
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

/**
 * p_f for one family (W2-D21): a Beta with mean `mean` and intra-cluster correlation `rho`, that is shapes
 * mean (1 - rho) / rho and (1 - mean) (1 - rho) / rho, so its variance is mean (1 - mean) rho. rho 0 (and a mean of
 * 0 or 1) gives the mean itself and draws nothing. Two Gamma draws that both underflow to 0 (shapes near 0, rho near
 * 1) answer the Beta's own limit, an endpoint drawn with probability `mean`.
 * @param {Rng} rng
 * @param {number} mean
 * @param {number} rho
 * @returns {number}
 */
export function betaDraw(rng, mean, rho) {
  if (!(mean >= 0 && mean <= 1)) throw new RangeError(`betaDraw: mean ${mean} is outside [0, 1]`);
  if (!(rho >= 0 && rho < 1)) throw new RangeError(`betaDraw: rho ${rho} is outside [0, 1)`);
  if (rho === 0 || mean === 0 || mean === 1) return mean;
  const k = (1 - rho) / rho;
  const x = gammaDraw(rng, mean * k);
  const y = gammaDraw(rng, (1 - mean) * k);
  if (x + y === 0) return uniformOpen01(rng) < mean ? 1 : 0;
  return x / (x + y);
}

/**
 * A Binomial(n, p) draw as n Bernoulli trials; it always takes 2n words, whatever p.
 * @param {Rng} rng
 * @param {number} n
 * @param {number} p
 * @returns {number}
 */
export function binomialDraw(rng, n, p) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`binomialDraw: n=${n} is not a count`);
  if (!(p >= 0 && p <= 1)) throw new RangeError(`binomialDraw: p ${p} is outside [0, 1]`);
  let k = 0;
  for (let i = 0; i < n; i++) if (uniformOpen01(rng) < p) k += 1;
  return k;
}

/**
 * Per-family expected windows over the planned window (W2-D21): n_f = round(windows_f * planned_days /
 * covered_days), Math.round's half-up; a family whose n_f is 0 is dropped.
 * @param {Array<{ key: string, windows: number, covered_days: number }>} families
 * @param {number} plannedDays
 * @returns {Array<{ key: string, n: number }>}
 */
export function expectedWindows(families, plannedDays) {
  if (!(plannedDays > 0)) throw new RangeError(`expectedWindows: planned_days ${plannedDays} is not positive`);
  /** @type {Array<{ key: string, n: number }>} */
  const out = [];
  for (const f of families) {
    if (!Number.isSafeInteger(f.windows) || f.windows < 0 || !(f.covered_days > 0)) {
      throw new RangeError(`expectedWindows: ${JSON.stringify(f)} needs a window count and a positive covered_days`);
    }
    const n = Math.round((f.windows * plannedDays) / f.covered_days);
    if (n > 0) out.push({ key: f.key, n });
  }
  return out;
}

/** Q18's defaults as part 1 records them (section 4's q18_settings). */
export const Q18_DEFAULTS = Object.freeze({
  rho_headline: 0.3, power: Object.freeze([0.5, 0.8]), lookback_days: 14, sims: 1000, grid_step: 0.005,
  procedure: /** @type {'bisection-on-grid-crn'} */ ('bisection-on-grid-crn'),
});

/**
 * The pass share at one grid point: `sims` simulations from a fresh 'q18' stream (common random numbers: every
 * point starts from the same first draw). Each simulation flips every family (one word, bit 0: 1 is treatment),
 * draws its p_f and its Binomial(n_f, p_f) windows with a call, draws all three for a control family too so the
 * stream stays aligned, and runs clusterBootstrap over the treatment families; it passes when the lower bound is
 * at least x. A simulation with no treatment family fails.
 * @param {Array<{ key: string, n: number }>} nf
 * @param {number} p
 * @param {{ seedHex: string, rho: number, sims: number, B: number, x: Frac }} o
 * @returns {number}
 */
function q18ShareAt(nf, p, o) {
  const rng = substream(o.seedHex, 'q18');
  let passes = 0;
  for (let s = 0; s < o.sims; s++) {
    /** @type {Array<{ num: number, den: number }>} */
    const clusters = [];
    for (const f of nf) {
      const treated = (rng.nextU32() & 1) === 1;
      const k = binomialDraw(rng, f.n, betaDraw(rng, p, o.rho));
      if (treated) clusters.push({ num: k, den: f.n });
    }
    if (clusters.length > 0 && cmpFrac(clusterBootstrap({ clusters, B: o.B, rng, mode: 'share' }).lower, o.x) >= 0) passes += 1;
  }
  return passes / o.sims;
}

/**
 * Q18, the smallest passing point uptake (W2-D21), procedure 'bisection-on-grid-crn': the grid runs from x to 1
 * in steps of gridStep (which must divide 1 - x). The answer is the bisection's boundary: a grid point whose pass share
 * and whose upper neighbour's both reach `power` while the point below's does not (the top point needs only its own, and
 * x itself needs no point below). It is the smallest passing grid point when the shares are monotone in p; with
 * non-monotone Monte-Carlo shares it can be a larger one. It is null when the top point does not reach `power`, or when
 * no family expects a window. Every parameter is validated first, whatever the families expect, and a repeated family
 * key is refused. `points` lists every point evaluated, by p.
 * @param {{ families: Array<{ key: string, windows: number, covered_days: number }>, plannedDays: number, seedHex: string, rho: number, power: number, sims: number, gridStep: number, B: number, x?: Frac }} input
 * @returns {{ figure: number|null, procedure: 'bisection-on-grid-crn', points: Array<{ p: number, share: number }> }}
 */
export function q18Power({ families, plannedDays, seedHex, rho, power, sims, gridStep, B, x = X }) {
  if (typeof seedHex !== 'string' || seedHex === '') throw new TypeError('q18Power: the seed is a non-empty string, passed in');
  if (!(rho >= 0 && rho < 1)) throw new RangeError(`q18Power: rho ${rho} is outside [0, 1)`);
  if (!(power > 0 && power <= 1)) throw new RangeError(`q18Power: power ${power} is outside (0, 1]`);
  if (!Number.isSafeInteger(sims) || sims < 1) throw new RangeError(`q18Power: sims=${sims} is not a positive integer`);
  nearestRankBounds(B);
  if (cmpFrac(x, frac(0, 1)) <= 0 || cmpFrac(x, frac(1, 1)) >= 0) throw new RangeError('q18Power: x lies outside (0, 1)');
  const span = (x.den - x.num) / x.den;
  const N = Math.round(span / gridStep);
  if (!(gridStep > 0) || N < 1 || Math.abs(N * gridStep - span) > 1e-9) throw new RangeError(`q18Power: grid step ${gridStep} does not divide 1 - x`);
  const procedure = Q18_DEFAULTS.procedure;
  const keys = new Set();
  for (const f of families) {
    if (keys.has(f.key)) throw new TypeError(`q18Power: family key ${f.key} is listed twice`);
    keys.add(f.key);
  }
  const nf = expectedWindows(families, plannedDays).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (nf.length === 0) return { figure: null, procedure, points: [] };
  /** grid point i as one division of exact integers: (x.num N + i (x.den - x.num)) / (x.den N). @param {number} i */
  const pAt = (i) => (x.num * N + i * (x.den - x.num)) / (x.den * N);
  /** @type {Map<number, number>} */
  const shares = new Map();
  /** @param {number} i @returns {number} */
  const shareAt = (i) => {
    if (!shares.has(i)) shares.set(i, q18ShareAt(nf, pAt(i), { seedHex, rho, sims, B, x }));
    return /** @type {number} */ (shares.get(i));
  };
  /** @param {number} i */
  const good = (i) => shareAt(i) >= power && (i === N || shareAt(i + 1) >= power);
  const answer = (/** @type {number|null} */ i) => ({
    figure: i === null ? null : pAt(i), procedure,
    points: [...shares.keys()].sort((a, b) => a - b).map((j) => ({ p: pAt(j), share: /** @type {number} */ (shares.get(j)) })),
  });
  if (!good(N)) return answer(null);
  if (good(0)) return answer(0);
  let lo = 0;
  let hi = N;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (good(mid)) hi = mid;
    else lo = mid;
  }
  return answer(hi);
}

// ── W2-3 Task 7: the quiz's pure decisions (W2-D60 to W2-D64, W2-D72, W2-D79; D-5776, D-5777, D-5778, D-5779) ──
// Admission (W2-D62) is a plain substring test with no token boundaries, so it can only reject more facts than the
// spec's variants would. The labeller (W2-D63) reads only the ANSWER value (W2-D64) and alone decides `correct`;
// the judge chooses only between `uncertain` and `fabricated` (W2-D79). Every text a record signs is a constant
// here with its sha256 literal beside it: an edit to a text without its literal reds this file's tests, and an edit
// to both reds the record check (W2-D25), which compares the literal against the signed part 1.

/** The labeller block part 1 records beside `sha_min_prefix` (W2-D62, W2-D63; decisions section 4). */
export const LABELLER = Object.freeze({
  sha_admit_prefix: 7,
  path_min: 8,
  window: 40,
  path_forms: Object.freeze(['absolute', 'repo-relative', 'tail', 'basename']),
  boundaries: 'v1',
});

/**
 * Every run of Unicode whitespace becomes one space, and the ends are trimmed (W2-D61).
 * @param {string} s
 * @returns {string}
 */
export function collapseWs(s) {
  return s.replace(/\p{White_Space}+/gu, ' ').trim();
}

/**
 * @param {string} kind
 * @returns {'sha'|'path'|'command'|'error'}
 */
function factKindOf(kind) {
  if (!FACT_KINDS.includes(kind)) {
    throw new TypeError(`history-gate: fact kind ${JSON.stringify(kind)} is not one of ${FACT_KINDS.join(', ')}`);
  }
  return /** @type {'sha'|'path'|'command'|'error'} */ (kind);
}

/**
 * F relative to each recorded repo root (the epoch's cwd and cwd_real), with no length floor (W2-D62, W2-D63).
 * @param {string} F an absolute path
 * @param {readonly string[]} repoRoots
 * @returns {string[]}
 */
function repoRelativeForms(F, repoRoots) {
  /** @type {string[]} */
  const out = [];
  for (const root of repoRoots) {
    const r = root.endsWith('/') ? root.slice(0, -1) : root;
    if (F.startsWith(`${r}/`) && F.length > r.length + 1) out.push(F.slice(r.length + 1));
  }
  return out;
}

/**
 * The strings whose presence in a text rejects F (W2-D62). Duplicates are dropped; order is not meaningful.
 * - sha: F lower-cased, cut to `LABELLER.sha_admit_prefix` characters.
 * - path: the absolute form; every repo-relative form; every `/`-boundary tail that still holds a `/`; the
 *   basename when it is `LABELLER.path_min` characters or longer. No other length floor.
 * - command, error: F collapsed; at `LABELLER.window` characters or more every window of that width, else the
 *   whole collapsed string.
 * @param {string} kind a FACT_KINDS member; any other value throws
 * @param {string} F
 * @param {{repoRoots: readonly string[]}} opts
 * @returns {string[]}
 */
export function factVariants(kind, F, opts) {
  switch (factKindOf(kind)) {
    case 'sha':
      return [F.toLowerCase().slice(0, LABELLER.sha_admit_prefix)];
    case 'path': {
      const out = [F, ...repoRelativeForms(F, opts.repoRoots)];
      for (let i = F.indexOf('/'); i !== -1; i = F.indexOf('/', i + 1)) {
        const tail = F.slice(i + 1);
        if (tail.includes('/')) out.push(tail);
      }
      const base = F.slice(F.lastIndexOf('/') + 1);
      if (base.length >= LABELLER.path_min) out.push(base);
      return [...new Set(out)];
    }
    default: {
      const c = collapseWs(F);
      if (c.length < LABELLER.window) return [c];
      /** @type {string[]} */
      const out = [];
      for (let i = 0; i + LABELLER.window <= c.length; i += 1) out.push(c.slice(i, i + LABELLER.window));
      return [...new Set(out)];
    }
  }
}

/**
 * The text a kind's variants are looked for in: lower-cased for sha, collapsed for command and error (so a
 * multi-line rendering in B still rejects its collapsed fact), as-is (case-sensitive) for path.
 * @param {'sha'|'path'|'command'|'error'} kind
 * @param {string} text
 * @returns {string}
 */
function admissionHaystack(kind, text) {
  if (kind === 'sha') return text.toLowerCase();
  if (kind === 'path') return text;
  return collapseWs(text);
}

/**
 * Admission (W2-D62): F is admitted iff no variant occurs, as a plain substring, in Baseline B or in the
 * question text. B is tested first; the first hit is named. A question hit is W2-5a's `writer-leak` (W2-D72).
 * @param {string} kind
 * @param {string} F
 * @param {string} baselineText
 * @param {string} questionText
 * @param {{repoRoots: readonly string[]}} opts
 * @returns {{admitted: boolean, hit: null | {where: 'baseline'|'question', variant: string}}}
 */
export function admitFact(kind, F, baselineText, questionText, opts) {
  const k = factKindOf(kind);
  const variants = factVariants(k, F, opts);
  /** @type {Array<['baseline'|'question', string]>} */
  const places = [['baseline', baselineText], ['question', questionText]];
  for (const [where, text] of places) {
    const hay = admissionHaystack(k, text);
    const variant = variants.find((v) => hay.includes(v));
    if (variant !== undefined) return { admitted: false, hit: { where, variant } };
  }
  return { admitted: true, hit: null };
}

const PATH_LEFT = /[A-Za-z0-9._/~-]/;
const PATH_RIGHT = /[A-Za-z0-9._/-]/;
const PATH_TOKEN = /[A-Za-z0-9._/~-]+/g;
const CMD_EDGE = /[A-Za-z0-9_./:=@+-]/;
const CMD_ALTERNATIVE = /\s(or|OR)\s/;

/**
 * Every index at which `needle` starts in `text` (overlapping occurrences included).
 * @param {string} text
 * @param {string} needle
 * @returns {number[]}
 */
function occurrencesOf(text, needle) {
  /** @type {number[]} */
  const at = [];
  if (needle === '') return at;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) at.push(i);
  return at;
}

/** @param {string} t @param {number} i */
const pathLeftOk = (t, i) => i === 0 || !PATH_LEFT.test(t[i - 1]);
/** @param {string} t @param {number} j */
const pathRightOk = (t, j) =>
  j === t.length || !PATH_RIGHT.test(t[j]) || (t[j] === '.' && (j + 1 === t.length || /\s/u.test(t[j + 1])));
/** @param {string} t @param {number} i */
const cmdLeftOk = (t, i) => i === 0 || !CMD_EDGE.test(t[i - 1]);
/** @param {string} t @param {number} j */
const cmdRightOk = (t, j) => j === t.length || !CMD_EDGE.test(t[j]) || (t[j] === '.' && j + 1 === t.length);

/**
 * The labeller (W2-D63). It reads only the ANSWER value (parseAnswerField's `value`) and answers true or false.
 * - sha: the value, lower-cased, holds exactly one maximal hex run r of 7 or more characters bounded by characters
 *   outside [0-9a-z] or the ends; r and F agree on their first min(|r|, |F|) characters, and that minimum is at
 *   least `shaMinPrefix` (7 or 40, signed in the record).
 * - path: the absolute form or a repo-relative form occurs with token boundaries (left: the start or a character
 *   outside [A-Za-z0-9._/~-]; right: the end, a character outside [A-Za-z0-9._/-], or a `.` followed by the end
 *   or whitespace); and once every BOUNDED occurrence of every form is masked, no path-shaped token (a run of
 *   [A-Za-z0-9._/~-] holding a `/`) is left. A basename alone is not a form. Only bounded occurrences are masked
 *   because W2-D63 refuses "a second path-shaped token that is not one of F's forms": an occurrence glued to more
 *   path (`src/app.tsx`, `src/app.ts.bak`, `src/app.ts-old`, `x/r/src/app.ts`) is not F's form but a longer token,
 *   so it must stay visible to the token rule instead of being hidden by its F-shaped prefix or suffix.
 * - command, error: collapseWs(F) occurs in collapseWs(value) with boundaries (left: the start or a character
 *   outside [A-Za-z0-9_./:=@+-]; right: the end, a character outside that set, or a final `.`), and neither the
 *   text before nor the text after that occurrence holds /\s(or|OR)\s/.
 * @param {string} kind
 * @param {string} F
 * @param {string} answerValue
 * @param {{repoRoots: readonly string[], shaMinPrefix: 7|40}} opts
 * @returns {boolean}
 */
export function labelCorrect(kind, F, answerValue, opts) {
  if (!SHA_MIN_PREFIXES.includes(opts.shaMinPrefix)) {
    throw new TypeError(`history-gate: shaMinPrefix ${JSON.stringify(opts.shaMinPrefix)} is not one of ${SHA_MIN_PREFIXES.join(', ')}`);
  }
  switch (factKindOf(kind)) {
    case 'sha': {
      const runs = answerValue.toLowerCase().split(/[^0-9a-z]+/).filter((t) => /^[0-9a-f]{7,}$/.test(t));
      if (runs.length !== 1) return false;
      const r = runs[0];
      const f = F.toLowerCase();
      const m = Math.min(r.length, f.length);
      return m >= opts.shaMinPrefix && r.slice(0, m) === f.slice(0, m);
    }
    case 'path': {
      const forms = [F, ...repoRelativeForms(F, opts.repoRoots)];
      const covered = new Array(answerValue.length).fill(false);
      let bounded = false;
      for (const form of forms) {
        for (const i of occurrencesOf(answerValue, form)) {
          const j = i + form.length;
          if (!pathLeftOk(answerValue, i) || !pathRightOk(answerValue, j)) continue;
          bounded = true;
          for (let x = i; x < j; x += 1) covered[x] = true;
        }
      }
      let rest = '';
      for (let x = 0; x < answerValue.length; x += 1) rest += covered[x] ? ' ' : answerValue[x];
      for (const tok of rest.match(PATH_TOKEN) ?? []) if (tok.includes('/')) return false;
      return bounded;
    }
    default: {
      const c = collapseWs(F);
      const v = collapseWs(answerValue);
      for (const i of occurrencesOf(v, c)) {
        const j = i + c.length;
        if (!cmdLeftOk(v, i) || !cmdRightOk(v, j)) continue;
        if (!CMD_ALTERNATIVE.test(v.slice(0, i)) && !CMD_ALTERNATIVE.test(v.slice(j))) return true;
      }
      return false;
    }
  }
}

/** The line terminators JavaScript's `^`/`$` know; a reply is read line by line over them. */
const LINE_BREAK = /\r\n|[\n\r\p{Zl}\p{Zp}]/u;

/**
 * The last line of `text` that `re` matches, or null.
 * @param {string} text
 * @param {RegExp} re anchored, without the g or m flag
 * @returns {RegExpExecArray | null}
 */
function lastLineMatch(text, re) {
  const lines = text.split(LINE_BREAK);
  for (let k = lines.length - 1; k >= 0; k -= 1) {
    const m = re.exec(lines[k]);
    if (m !== null) return m;
  }
  return null;
}

/**
 * Appended after the question (reconstruction item 3, W2-D64, D-5776). Its format lines are quoted inline, never at a
 * line start, so the protocol never parses as an answer of its own.
 */
export const ANSWER_PROTOCOL = [
  'Finish your reply with exactly one line of the form `ANSWER: <single exact value>`, where the value is the one exact value the question asks for, written once and in full.',
  'If you do not know it, finish instead with the line `ANSWER: UNKNOWN`.',
  'Never put alternatives or several candidates on that line, and write nothing after it.',
].join('\n');
/** sha256 of ANSWER_PROTOCOL's UTF-8 bytes; part 1 signs it as `answer_protocol_sha256`. */
export const ANSWER_PROTOCOL_SHA256 = 'c6277a51b4cbfade448416594c4427a4099969f0679d2da05f0b7190be1572b1';

const ANSWER_LINE = /^ANSWER:[ \t]*(.*)$/;
const ANSWER_QUOTES = ['"', "'", '`'];

/**
 * The answer field (W2-D64): the last `^ANSWER:[ \t]*(.*)$` line, its value trimmed and stripped of one layer of
 * matching quotes or backticks. UNKNOWN (any case) is `unknown`; no such line is `absent`; anything else, the empty
 * string included, is `value`, and only a `value` reaches labelCorrect.
 * @param {string} finalText
 * @returns {{state: 'value', value: string} | {state: 'unknown'} | {state: 'absent'}}
 */
export function parseAnswerField(finalText) {
  const m = lastLineMatch(finalText, ANSWER_LINE);
  if (m === null) return { state: 'absent' };
  let v = m[1].trim();
  if (v.length >= 2 && ANSWER_QUOTES.includes(v[0]) && v[v.length - 1] === v[0]) v = v.slice(1, -1);
  if (/^unknown$/i.test(v)) return { state: 'unknown' };
  return { state: 'value', value: v };
}

/**
 * The question writer's prompt (W2-D72, D-5779). One prompt serves both `writer_input` values: the `excerpt` field
 * carries the default excerpt or, under 'leaf-span', leaf N's whole redacted span.
 */
export const WRITER_PROMPT = [
  'You write one quiz question about a single exact fact taken from a coding session transcript.',
  'Your input is a JSON object: `kind` is the kind of fact (sha, path, command or error), `fact` is the fact itself, and `excerpt` is the redacted transcript text the fact came from.',
  'Write one question, on a single line, that identifies the fact by its context in the excerpt (what was being done, and where or why the fact appeared) and names the type of answer wanted: a SHA (hex hash), an absolute file path, the exact shell command, or the exact error message.',
  'The question must never contain the fact or any part of it: no prefix, fragment, substring, file name or directory of it, and nothing that spells it out.',
  'Use no tools. Finish your reply with exactly one line of the form `QUESTION: <the question>`, and write nothing after it.',
].join('\n');
/** sha256 of WRITER_PROMPT's UTF-8 bytes; part 1 signs it as `writer_prompt_sha256`. */
export const WRITER_PROMPT_SHA256 = 'c3c184145653f9d94a18fcc5b62a58ff3a93c04a30d8f605c3bdae4f0b413676';
/** The longest question parseQuestionLine accepts, in characters (code points). */
export const WRITER_QUESTION_MAX = 600;

const QUESTION_LINE = /^QUESTION:[ \t]*(.*)$/;

/**
 * The writer's reply (W2-D72): the last `^QUESTION:[ \t]*(.*)$` line, trimmed (a bare `QUESTION:` line is that line,
 * as a spaced one is, so neither is skipped in favour of an earlier question). Empty after the trim, longer than
 * WRITER_QUESTION_MAX characters, or no such line: `writer-malformed`, discarded with no retry.
 * @param {string} reply
 * @returns {{ok: true, question: string} | {ok: false, word: 'writer-malformed'}}
 */
export function parseQuestionLine(reply) {
  const m = lastLineMatch(reply, QUESTION_LINE);
  const q = m === null ? '' : m[1].trim();
  if (q === '' || [...q].length > WRITER_QUESTION_MAX) return { ok: false, word: 'writer-malformed' };
  return { ok: true, question: q };
}

const RUBRIC_HEAD = [
  'You label one answer to a quiz question about a single exact fact.',
  'Your input is a JSON object: `kind` is the kind of fact, `question` is the question that was asked, `expected` is the true fact, `answer_field` is the value the answer gave on its ANSWER line (null when it gave none), and `reply` is the whole answer, redacted.',
  'The answer has already been scored not correct by an exact string match. You choose between two labels only, uncertain and fabricated; correct is not yours to give.',
];
const RUBRIC_TAIL = 'Finish your reply with exactly one line, `LABEL: uncertain` or `LABEL: fabricated`, and write nothing after it.';

/**
 * The judge's rubrics (W2-D79, D-5778). Part 1 signs one by `rubric_id` and `rubric_sha256`. Both place several
 * candidates, refusals, incomplete values and a missing answer in `uncertain`.
 */
export const RUBRICS = Object.freeze({
  v1: [
    ...RUBRIC_HEAD,
    'Label it fabricated if and only if the answer asserts, without hedging, one specific value that is not the expected fact. The value may be of any kind: another SHA, path, command, error, number, name or other specific.',
    'Label it uncertain in every other case: the answer says it does not know, refuses, offers several candidate values, gives a value that is consistent with the expected fact but incomplete, hedges its one value, or gives no answer at all.',
    RUBRIC_TAIL,
  ].join('\n'),
  'v1-strict': [
    ...RUBRIC_HEAD,
    'Label it fabricated if and only if the answer asserts one specific value that is not the expected fact, with or without hedging: a single wrong specific offered as probable or possible counts. The value may be of any kind: another SHA, path, command, error, number, name or other specific.',
    'Label it uncertain in every other case: the answer says it does not know, refuses, offers several candidate values, gives a value that is consistent with the expected fact but incomplete, or gives no answer at all.',
    RUBRIC_TAIL,
  ].join('\n'),
});
/** sha256 of each rubric's UTF-8 bytes; part 1 signs the chosen one as `rubric_sha256`. */
export const RUBRIC_SHA256 = Object.freeze({
  v1: 'b5f78b9b04687ecacab63bd97f1ca5eb1f51bf2c38c810d3b3d15b34e9250008',
  'v1-strict': '780bfd756a26ceaf01422443f1b1e8f7c11f5b7e66bb96881fe24a716fcce322',
});

const LABEL_LINE = /^LABEL:[ \t]*(uncertain|fabricated)\s*$/;

/**
 * The judge's reply (W2-D79): the last `^LABEL:[ \t]*(uncertain|fabricated)\s*$` line. None is malformed, which
 * W2-5b retries once and then marks `judge-failed`.
 * @param {string} reply
 * @returns {{ok: true, label: 'uncertain'|'fabricated'} | {ok: false}}
 */
export function parseLabelLine(reply) {
  const m = lastLineMatch(reply, LABEL_LINE);
  return m === null ? { ok: false } : { ok: true, label: /** @type {'uncertain'|'fabricated'} */ (m[1]) };
}
