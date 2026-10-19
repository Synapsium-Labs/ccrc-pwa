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
  if (body.from === undefined || body.to === undefined) return recallOffOffGrammar(k, 'its value lacks from or to');
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
  const hit = new Set();
  const gaps = [];
  for (const row of metaRows) {
    const r = parseRecallOffRow(row.k, row.v);
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
    for (const f of rep.w2?.families ?? []) {
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
