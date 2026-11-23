#!/usr/bin/env -S node --no-warnings
// deploy/history-quiz-single.mjs: the replay quiz's single-arm mode (Overlord W1a; plan 2026-11-17-overlord-quiz-record.md
// §3 and §4; spec 2026-11-09-overlord-design.md §3.3.9 C52, §3.3.10 C53, §12 M13).
//
// An L4 operator script. The operator runs it by hand, from a shell OUTSIDE tmux and outside any Claude Code session, on
// the fleet box: `node --no-warnings ~/ccrc/deploy/history-quiz-single.mjs <subcommand>`. It runs the replay quiz once,
// recall on, with no A/B window: a setup and a frozen question list once, then each week step 0b's probes, the treatment
// arm alone, its judge and a report that carries no comparison. The report is what `ccrc quiz-record` records (PR 2).
// It is a measure only, never a gate on history's waves (C53), and never a W2 pilot: nothing it writes is W2 pilot
// evidence, W2's budget extrapolation or W2's quiz list (the history coordinator's skip condition 2).
//
// Why a module of its own, and what it re-spells (term 2; the history coordinator's waiver, §3). The driver's quiz sits
// behind W2's signed record chain (`loadArmRun` reads part 2), its arms always run both recall arms, and its judge and
// report are both-arm. The single-arm run skips the pilot's A/B instrument by the operator's ruling (OQ1 as restated), so
// it cannot reach the driver's subcommands. This file reuses the driver's pieces, exported by the one export-only edit the
// waiver allows, and re-spells only:
//   - the subcommand dispatch and flag table (`FORMS`, `FLAG_SPECS`), since the driver's SUBCOMMAND_FLAGS names W2's forms;
//   - the one-arm question states (`singleStatesOf`), since the driver's questionMoveOf maps RECALL_ARMS;
//   - the one-arm summary (`singleSummaryOf`), since armsSummaryOf and writeArmsSummary write both arms;
//   - the one-arm judged file and its counts, since judgedOf is both-arm and judgeTallyOf lacks the counts;
//   - the judge's masking agreement over two readings (`judgeJobsAgreed`), since the driver's maskingSnapshotsOf,
//     maskingAgreementOf and refreshPairIndex are pinned by their exact unexported lines in history-replay.test.ts (K28):
//     the jobs are built under the reading this process opened and again under a fresh pairIndexOf reading, and any
//     difference refuses `input-invalid masking-snapshots-disagree judge`, never masking under the newer one (K26).
// Every re-spelled piece has a characterization pin in history-quiz-single-characterization.test.ts. The answer records,
// the batch manifests, the sourced list, the frozen list and its meta, the judge map and the sourcing baseline record keep
// their W2 kinds, written by the driver's own code; W2's readers refuse every one as a record (skip condition 1, pinned in
// history-quiz-single.test.ts). The setup, the step 0b result, the summary, the judged file and the report carry this
// file's own kinds, never a W2 kind.
//
// The interval's generator (F1). No substream label is added: SUBSTREAMS is history-gate.mjs's and stays closed. This file
// builds its own stream with substream's recipe: xoshiro128ss over the four little-endian u32 words of the first 16 bytes
// of sha256Hex(seed + ':quiz-single-ci'), the seed being the setup's. The characterization test writes the recipe out and
// pins it equal to substream's.
//
// Fresh expectations each run (F5). `setup` records the release and Claude Code build it measured, for information only.
// `source`, `arms` and `judge` each measure a fresh expected node at their own start (the version by one `--version`
// spawn, the release stamp, the wrapper and the gate code files), and every batch's preflight compares with that. So a
// weekly run is never refused claude-version-moved or tree-moved for a move since setup. One week's arms run on one
// release: a resumed `arms` on another release refuses `release-moved` (its pin, `quiz/arms-release.json`), and `report`
// refuses `release-moved` when `arms` and `judge` ran on different releases. A resumed `arms` reuses a passed step 0b
// result only when every build it probed is the fresh expected node's, and otherwise probes again before the next arm.
// A failed step 0b result refuses pilot-failed on every later `arms`, except `arms --repilot` (quiz-pilot-checks ruling 5):
// when no arm batch was ever planned on that --out, it keeps the failed result as `quiz/step0b/<mode>.failed.r<round>.json`,
// pins the week to the release measured now and pilots again as the next round, on the week's own ledger and --budget. A
// round that stopped before its result was written is resumed only on the release it was pinned to, else it refuses
// `repilot-release-moved`. When to ask for it is the unattended runner's decision, never this file's: passed by hand, the
// flag is a permission and decides nothing (no cap, no same-release rule).
//
// Where it writes and what it spends (F7). Its files go under --out, the driver's --out rule (prepareOut: outside any git
// tree, 0700, the driver's marker) plus this file's own marker beside it, written only into a directory it has just made:
// an existing --out without this marker, a W2 run's above all, refuses out-refused before any write, and `arms` refuses a
// --out holding this setup's setup.json. Its spawns use a transient directory under the system temp and run with the
// account's real HOME and CLAUDE_CONFIG_DIR. --budget is one week's total, the arms and the judge together (OQ3's weekly
// cap, 5M token-equivalents): the arms stop at it on the week's ledger, and the judge's cap is what the arms left of it.
// The gate runs before every spawn, so the ledger can end at most two whole runs (the batch's concurrency) past a stop;
// the arms' and the judge's overshoots do not stack, since the judge refuses once the arms' spend has reached --budget.
// The 70% limits threshold still bounds each account's pool at every spawn, whichever stop comes first. The source
// phase's writer spend lands in the setup's --out, not a week's. An
// arm's admitted `ccrc history` read appends one arm-tagged counter line to the live spool, as W2's arms do (W2-D46).
// It reads the store only through the driver's openReplayStore (history-replay.test.ts's node:sqlite scan covers this
// file), never writes a history marker, and never runs a writing form of `ccrc history`.
//
// The stop (waiver condition 2). main installs the driver's own handler, onStopSignal, for STOP_SIGNALS, as the driver's
// main does. The driver's liveChildren and stopping stay private: every spawn here goes through the driver's registered
// spawn (runBatch, measureClaudeVersion, step0bMechanics, openWriter, openJudge), so a signal stops every child's group and
// every later stop check refuses `interrupted`. main does not reset the driver's stopping flag: one main runs per process.
//
// The week's account (run 3538, the coordinator's ruling 3 of 2026-11-23). `arms` and `judge` take `--account`, the week's
// account, which the unattended runner chooses each week (history-quiz-unattended.mjs's weekAccountOf); without it they take
// the setup's, as before. The account is admitted exactly as setup admits one (admitNode) and gated on its own limits row at
// every spawn (batchGate). The week's first `arms` records it in the week's folder (WEEK_ACCOUNT_FILE, the one writer,
// before anything is spawned), and every later act given another account refuses `account-moved`; a week an older build
// ran, with its release pin and no record, reads as the setup's account. The setup itself is never re-made.
//
// Its words: the driver's DRIVER_REASONS, through its refuse, plus QUIZ_SINGLE_REASONS, this file's own. A refusal
// prints `ccrc history-quiz-single: <word>: <detail>` on stderr and exits EXIT.REFUSED (2); a defect exits EXIT.INTERNAL (1).
// Environment: main gets a by-name projection {HOME, TMUX_PANE, LANG, CLAUDECODE}; nothing here reads process.env whole.
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXIT, SWITCHES, agentsArmedOf, canonicalJson, formatHeadlessList, sha256Hex } from '../ccd/history/lib.mjs';
import { pairIndexOf } from '../ccd/history/cli.mjs';
import { ARM_MODEL_FORBIDDEN_RE, BOOTSTRAP, EXACT_MODEL_ID_RE, LABELLER, OPEN_RECORD_V1, RUBRIC_SHA256, assignmentSha256, clusterBootstrap,
  familyKey, xoshiro128ss } from './history-gate.mjs';
import { DriverRefusal, LIMITS_DEFAULTS, OUT_JSON_CAP, QUIZ_META_FILE, SETTINGS_MODES, SOURCED_FILE, SOURCED_KIND, STEP0B_PROBES,
  STEP0B_SYNTHETIC_TRANSCRIPT, STOP_SIGNALS, TREATMENT_ARM, admissionCheckOf, admitAccount, armAttemptsOf, armBatchCount, armBatchPreflight,
  armJob, batchGate, armPayloads, armToolsOf, claimOut, codeShas, denialCheckOf, driverWordClass, drawSeedHex, ensurePlainDir, familiesOf,
  finishedOutcome, frozenEntryOf, frozenListText, initChecksOf, judgeItemsOf, judgeJobsOf, judgeMapOf, judgeSpentOf, judgeMapText, loadFrozen, loadInput,
  OUT_MARKER as DRIVER_OUT_MARKER, lstatOrNull, measureClaudeVersion, mergeSourced, onStopSignal, openJudge, openReplayStore, openWriter, paneRefusal, parseArgs,
  persistenceCheckOf, persistenceMeasured, pinOutBytes, prepareOut, preflightSpawn, probeFindingOf, qidOf, questionCountsOf,
  questionStateOf, quizMetaReport, readAnswerRecords, readArmAnswers, readArmManifests, readPlain, readReleaseStamp, readRoster,
  recheckBatch, refuse, refuseColonInRealOut, refuseIfStopping, refuseOpusModel, refuseOutOfRangeValues, refuseRecallOff,
  refuseSpawnAdmission, refuseSyntheticPresent, refuseUnusableInputs, refuseWriterModel, requireListed, rosterConfigDirs, runBatch,
  settleAnswers, shaOfPlain, sourceQuiz, sourcedReport, spawnArgv, spendLinesOf, spentSoFar, step0bCardOf, step0bFailureDetail, step0bMechanics,
  step0bRunOf, step0bStdinOf, step0bVerdictOf, step0bProbesOf, subagentToolsOf, subcommandHome, turnBoundCheckOf,
  warnFailedRuns, wrapperSha, writeArmManifest, writeFrozenList, writePlain } from './history-replay.mjs';

const PREFIX = 'ccrc history-quiz-single';

// ── the words, the kinds and the paths ──────────────────────────────────────────────────────────────────────────────
/** This file's own refusal words, beside the driver's DRIVER_REASONS: `in-session` (CLAUDECODE is set: the quiz is the
 *  operator's, never a session's) and `release-moved` (one week's arms ran on one release, and its judge on the same). */
export const QUIZ_SINGLE_REASONS = Object.freeze(['in-session', 'release-moved', 'repilot-release-moved', 'account-moved']);
/** A refusal in one of QUIZ_SINGLE_REASONS' words. */
export class QuizSingleRefusal extends Error {
  /** @param {string} word  @param {string} detail */
  constructor(word, detail) {
    if (!QUIZ_SINGLE_REASONS.includes(word)) throw new TypeError(`QuizSingleRefusal: ${JSON.stringify(word)} is not a QUIZ_SINGLE_REASONS word`);
    super(`${word}: ${detail}`);
    this.name = 'QuizSingleRefusal';
    this.word = word;
    this.detail = detail;
  }
}

/** The kinds of this file's own outputs: never a W2 kind (term 3; skip condition 1). */
export const SETUP_KIND = 'ccrc-history-quiz-single-setup';
export const STEP0B_KIND = 'ccrc-history-quiz-single-step0b';
export const SUMMARY_KIND = 'ccrc-history-quiz-single-arms-summary';
export const JUDGED_KIND = 'ccrc-history-quiz-single-judged';
export const REPORT_KIND = 'ccrc-history-quiz-single-report';
export const RELEASE_PIN_KIND = 'ccrc-history-quiz-single-arms-release';
export const WEEK_ACCOUNT_KIND = 'ccrc-history-quiz-single-week-account';
/** The marker beside the driver's own under every --out this file uses (shared/lifecycle.ts's history-quiz-single-out). */
export const OUT_MARKER = '.ccrc-history-quiz-single';
export const OUT_KIND = 'ccrc-history-quiz-single-out';
/** The report's `pilot` word (OQ1 as restated): the pilot's A/B instrument was skipped by a recorded ruling. */
export const PILOT_SKIPPED = 'skipped-by-ruling';
/** The interval's stream label (F1): never a SUBSTREAMS member, built by substream's recipe here. */
export const INTERVAL_LABEL = 'quiz-single-ci';
/** No key of these names appears at any depth of the report, and its text holds no `PASS` (term 3). */
export const REPORT_FORBIDDEN_KEYS = Object.freeze(['verdict', 'gate', 'criteria', 'lift', 'delta', 'pass']);
/** The report's fields, one by one (term 5; plan §4). */
export const REPORT_FIELDS = Object.freeze(['kind', 'v', 'measured_ms', 'arm', 'pilot', 'settings_mode', 'frozen_sha256', 'n_questions',
  'n_families', 'counts', 'share', 'interval', 'judge_model', 'ccrc_release', 'claude_code_versions', 'steer_armed', 'agents_on_armed', 'inputs']);
/** The armed words (plan §4): steering over the frozen families, and agents-on over the node. */
export const STEER_WORDS = Object.freeze(['yes', 'no', 'partial', 'unmeasured']);
export const AGENTS_WORDS = Object.freeze(['yes', 'no', 'unmeasured']);

export const SETUP_FILE = 'setup.json';
export const SECTION = 'quiz';
export const SUMMARY_FILE = 'quiz/arms-summary.json';
export const RELEASE_PIN_FILE = 'quiz/arms-release.json';
/** The week's account (run 3538, ruling 3): written by the week's first `arms` before anything is spawned, never rewritten. */
export const WEEK_ACCOUNT_FILE = 'quiz/week-account.json';
export const JUDGE_MAP_REL = 'quiz/judge.map.json';
export const JUDGED_FILE = 'quiz/judged.json';
export const REPORT_FILE = 'single-report.json';
const step0bRel = (mode) => `quiz/step0b/${mode}.json`;

const DRAFT = OPEN_RECORD_V1.draft;
/** A draft field's signed default, whole: a value, or an object of its fields' values. */
const draftValue = (f) => (Object.hasOwn(f, 'value') ? copyJson(f.value) : Object.fromEntries(Object.entries(f.fields).map(([k, x]) => [k, draftValue(x)])));
const SHA256_RE = /^[0-9a-f]{64}$/;
const plainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const copyJson = (v) => JSON.parse(JSON.stringify(v));

// ── the argument grammar (re-spelled: the driver's SUBCOMMAND_FLAGS names W2's forms) ───────────────────────────────
/** @type {Readonly<Record<string, 'string' | 'int' | 'bool' | 'list'>>} */
export const FLAG_SPECS = Object.freeze({
  out: 'string', account: 'string', budget: 'int', 'settings-mode': 'string', 'writer-model': 'string', 'judge-model': 'string',
  'arm-model': 'string', target: 'int', setup: 'string', 'setup-sha256': 'string', sourced: 'string', 'sourced-sha256': 'string',
  frozen: 'string', 'frozen-sha256': 'string', 'arms-summary': 'string', 'arms-summary-sha256': 'string', judged: 'string', 'judged-sha256': 'string',
  repilot: 'bool',
});
const SETUP_IN = ['setup', 'setup-sha256'];
const FROZEN_IN = ['frozen', 'frozen-sha256'];
/** Each subcommand's required and optional flags; `run` is set below, beside each handler. */
const FORM_FLAGS = Object.freeze({
  setup: { required: ['out', 'account', 'budget', 'settings-mode', 'writer-model', 'judge-model', 'arm-model'], optional: ['target'] },
  source: { required: ['out', ...SETUP_IN], optional: [] },
  freeze: { required: ['out', ...SETUP_IN, 'sourced', 'sourced-sha256'], optional: [] },
  marker: { required: FROZEN_IN, optional: [] },
  arms: { required: ['out', ...SETUP_IN, ...FROZEN_IN], optional: ['repilot', 'account'] },
  judge: { required: ['out', ...SETUP_IN, ...FROZEN_IN, 'arms-summary', 'arms-summary-sha256'], optional: ['account'] },
  report: { required: ['out', ...SETUP_IN, ...FROZEN_IN, 'arms-summary', 'arms-summary-sha256', 'judged', 'judged-sha256'], optional: [] },
});
export const SUBCOMMANDS = Object.freeze(Object.keys(FORM_FLAGS));

/** Unknown flags first, then required ones (`<flag>-required`). */
function checkForm(form, flags) {
  const spec = FORM_FLAGS[form];
  const known = new Set([...spec.required, ...spec.optional]);
  for (const k of Object.keys(flags)) if (!known.has(k)) refuse('args-invalid', `--${k} is not a ${form} flag`);
  for (const k of spec.required) if (flags[k] === undefined) refuse('args-invalid', `${k}-required`);
}

// ── pure ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The interval's stream (F1): substream's recipe under INTERVAL_LABEL. Pure.  @param {string} seedHex */
export function intervalStreamOf(seedHex) {
  if (typeof seedHex !== 'string' || !SHA256_RE.test(seedHex)) throw new TypeError('intervalStreamOf: the seed is 64 lowercase hex');
  const hex = sha256Hex(`${seedHex}:${INTERVAL_LABEL}`);
  const byte = (i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const word = (w) => (byte(w * 4) | (byte(w * 4 + 1) << 8) | (byte(w * 4 + 2) << 16) | (byte(w * 4 + 3) << 24)) >>> 0;
  return xoshiro128ss([word(0), word(1), word(2), word(3)]);
}

/** The steer word over the frozen families (plan §4): `no` when history-off or history-steer-off stands; else, per family,
 *  steer-on/<ccrc_id> a regular non-link file arms it; `yes` all, `no` none, `partial` some. Any probe that could not be
 *  measured makes the word `unmeasured`, never `no`. Pure over the probes' answers.
 *  @param {{ off: string, steerOff: string, families: string[] }} p  each `present`, `absent` or `unmeasured` */
export function steerWordOf(p) {
  const all = [p.off, p.steerOff, ...p.families];
  for (const s of all) if (!['present', 'absent', 'unmeasured'].includes(s)) throw new TypeError(`steerWordOf: ${String(s)} is not a probe answer`);
  if (all.includes('unmeasured')) return 'unmeasured';
  if (p.off === 'present' || p.steerOff === 'present' || p.families.length === 0) return 'no';
  const on = p.families.filter((s) => s === 'present').length;
  return on === p.families.length ? 'yes' : on === 0 ? 'no' : 'partial';
}

/** The agents-on word (plan §4): a failed lstat (anything but ENOENT) is `unmeasured`, never `no`; absence is `no`; a
 *  present marker is lib's agentsArmedOf (a regular non-link file). Pure.
 *  @param {{ state: 'absent' | 'unmeasured' } | { state: 'present', isFile: boolean, isSymbolicLink: boolean }} probe */
export function agentsWordOf(probe) {
  if (probe?.state === 'unmeasured') return 'unmeasured';
  if (probe?.state === 'absent') return 'no';
  if (probe?.state !== 'present') throw new TypeError('agentsWordOf: not a probe answer');
  return agentsArmedOf({ isFile: probe.isFile, isSymbolicLink: probe.isSymbolicLink }) ? 'yes' : 'no';
}

/** The one arm's question states (re-spelled: the driver's questionMoveOf maps RECALL_ARMS). No version move applies to a
 *  single-arm run, so every name is W2-5b1's (move null). Each question's state is the gate's outcome over its one arm. */
function singleStatesOf(ctx, questions) {
  return questions.map((q) => {
    const a = { arm: TREATMENT_ARM, ...armAttemptsOf(ctx, q, TREATMENT_ARM) };
    const state = questionStateOf([a.state]);
    const settled = state === 'answered' || state === 'run-failed';
    return { q, move: null, arms: [a], state, next: settled || a.next === null ? [] : [{ arm: TREATMENT_ARM, attempt: a.next }] };
  });
}

/** The one-arm summary (re-spelled from armsSummaryOf, which writes both arms). Its answer counts are over the answered
 *  questions only, as the driver's. Pure.
 *  @param {{ setupSha256: string, frozenSha256: string, storeId: string, settingsMode: string, budget: number, spend: number,
 *    batches: number, stop: object | null, stamps: Iterable<string>, startedMs: number, finishedMs: number, versions: string[],
 *    release: string, steer: string, agents: string, step0b: { rel: string, sha256: string },
 *    questions: Array<{ qid: string, state: string, answer: { answer_field: { state: string }, correct: boolean } | null }> }} o */
export function singleSummaryOf(o) {
  const { counts, answers } = summaryTallyOf(o.questions);
  return {
    kind: SUMMARY_KIND, v: 1, setup_sha256: o.setupSha256, frozen_sha256: o.frozenSha256, store_id: o.storeId, arm: TREATMENT_ARM,
    settings_mode: o.settingsMode, budget: o.budget, spend: o.spend, batches: o.batches, stop: o.stop, stamps: [...o.stamps].sort(),
    started_ms: o.startedMs, finished_ms: o.finishedMs, claude_code_versions: [...new Set(o.versions)].sort(), ccrc_release: o.release,
    steer_armed: o.steer, agents_on_armed: o.agents, step0b: o.step0b,
    counts, answers, questions: o.questions.map((q) => ({ qid: q.qid, state: q.state })),
  };
}
/** The summary's counts and answer tally from its questions' states and settled answers: what `arms` writes and what
 *  `report` recomputes from the answer records. Pure.  @param {Array<{ state: string, answer: any }>} questions */
export function summaryTallyOf(questions) {
  const answers = { value: 0, unknown: 0, absent: 0, correct: 0 };
  for (const q of questions) {
    if (q.state !== 'answered' || q.answer === null) continue;
    answers[q.answer.answer_field.state] += 1;
    if (q.answer.correct === true) answers.correct += 1;
  }
  return { counts: questionCountsOf(questions.map((q) => q.state)), answers };
}

/** Term 3: no key in REPORT_FORBIDDEN_KEYS at any depth, and no `PASS` in the text. A violation is a defect of this file,
 *  so it throws a TypeError (exit 1), never a refusal. Pure.  @param {unknown} report */
export function assertNoComparison(report) {
  const walk = (v, at) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (!plainObject(v)) return;
    for (const [k, x] of Object.entries(v)) {
      if (REPORT_FORBIDDEN_KEYS.includes(k.toLowerCase())) throw new TypeError(`assertNoComparison: the report carries ${at}${k}: no comparison figure (term 3)`);
      walk(x, `${at}${k}.`);
    }
  };
  walk(report, '');
  if (JSON.stringify(report).includes('PASS')) throw new TypeError('assertNoComparison: the report\'s text holds PASS (term 3)');
}

/** The single-arm report (plan §4, term 5, field by field), from the run's inputs and its answer records. Every frozen
 *  question must be settled: run-failed, or answered with its answer field absent (outside the share) or not (inside it).
 *  The share is correct over answered; the interval is the gate's clusterBootstrap in share mode over one cluster per
 *  family, on intervalStreamOf(the setup's seed). A refusal is `input-invalid`, never a guess. Pure but for the stream.
 *  @param {{ setup: any, setupSha256: string, frozen: any, frozenSha256: string, summary: any, summarySha256: string,
 *    judged: any, judgedSha256: string, answers: Map<string, any> }} o */
export function singleReportOf(o) {
  const entries = o.frozen.entries;
  const counts = { questions: entries.length, answered: 0, correct: 0, run_failed: 0, absent: 0 };
  const clusters = new Map();
  for (const e of entries) {
    const r = o.answers.get(e.qid);
    if (r === undefined) refuse('input-invalid', `answer-missing ${e.qid}`);
    if (r.question_state === 'run-failed') { counts.run_failed += 1; continue; }
    if (r.question_state !== 'answered' || !plainObject(r.answer_field)) refuse('input-invalid', `arms-unsettled ${e.qid}`);
    if (r.answer_field.state === 'absent') { counts.absent += 1; continue; }
    const key = familyKey(e.store_id, e.ccrc_id, e.generation);
    const c = clusters.get(key) ?? { num: 0, den: 0 };
    c.den += 1;
    if (r.correct === true) c.num += 1;
    clusters.set(key, c);
    counts.answered += 1;
    if (r.correct === true) counts.correct += 1;
  }
  if (counts.answered === 0) refuse('input-invalid', 'no question was answered: the share has no denominator');
  const ci = clusterBootstrap({ clusters: [...clusters.values()], B: BOOTSTRAP.B, rng: intervalStreamOf(o.setup.seed), mode: 'share' });
  const report = {
    kind: REPORT_KIND, v: 1, measured_ms: o.summary.finished_ms, arm: TREATMENT_ARM, pilot: PILOT_SKIPPED,
    settings_mode: o.setup.settings_mode, frozen_sha256: o.frozenSha256, n_questions: entries.length, n_families: familiesOf(entries).length,
    counts, share: { num: counts.correct, den: counts.answered },
    interval: { lower: { num: ci.lower.num, den: ci.lower.den }, upper: { num: ci.upper.num, den: ci.upper.den }, ci: BOOTSTRAP.ci, method: BOOTSTRAP.method, B: BOOTSTRAP.B },
    judge_model: o.setup.judge_model, ccrc_release: o.summary.ccrc_release,
    claude_code_versions: [...new Set([...o.summary.claude_code_versions, o.judged.claude_code_version])].sort(),
    steer_armed: o.summary.steer_armed, agents_on_armed: o.summary.agents_on_armed,
    inputs: { setup_sha256: o.setupSha256, frozen_sha256: o.frozenSha256, arms_summary_sha256: o.summarySha256, judged_sha256: o.judgedSha256 },
  };
  assertNoComparison(report);   // term 3: the guard, before any byte is written
  return report;
}

// ── inputs ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The setup this file wrote, read by sha (the driver's loadInput: outside any git tree, the sha before the parse), then
 *  its shape. A bad shape refuses `input-invalid setup <field>`. */
function loadSetup(flags) {
  const s = loadInput('setup', flags.setup, flags['setup-sha256']);
  const v = s.value;
  const bad = setupError(v);
  if (bad !== null) refuse('input-invalid', `setup ${bad}`);
  return { sha256: s.sha256, value: v };
}
/** The first setup field that is not its shape, or null. */
export function setupError(v) {
  if (!plainObject(v) || v.kind !== SETUP_KIND || v.v !== 1) return 'kind';
  if (typeof v.account !== 'string' || v.account === '') return 'account';
  if (!Number.isSafeInteger(v.budget) || v.budget < 1) return 'budget';
  if (!SETTINGS_MODES.includes(v.settings_mode)) return 'settings_mode';
  for (const k of ['writer_model', 'judge_model', 'arm_model']) if (typeof v[k] !== 'string' || !EXACT_MODEL_ID_RE.test(v[k])) return k;
  if (typeof v.rubric_id !== 'string' || RUBRIC_SHA256[v.rubric_id] === undefined) return 'rubric_id';
  if (typeof v.seed !== 'string' || !SHA256_RE.test(v.seed)) return 'seed';
  if (!plainObject(v.labeller) || ![7, 40].includes(v.labeller.sha_min_prefix)) return 'labeller';
  if (!plainObject(v.quiz) || !plainObject(v.quiz.caps) || typeof v.quiz.writer_input !== 'string') return 'quiz';
  if (!plainObject(v.limits)) return 'limits';
  return null;
}
/** The frozen list as the driver reads it (loadFrozen: the git-tree rule, its sha first, its canonical bytes), and every
 *  question on this node's store: the single-arm run is one node's (the fleet box's), so a question on another store refuses. */
function frozenOnNode(flags, storeId) {
  const fz = loadFrozen(flags.frozen, flags['frozen-sha256'], SECTION);
  const other = fz.list.entries.find((e) => e.store_id !== storeId);
  if (other !== undefined) refuse('input-invalid', `frozen question ${other.qid} is on store ${other.store_id}, not this node's ${storeId}`);
  if (fz.list.entries.length === 0) refuse('input-invalid', 'the frozen list holds no question');
  return fz;
}
/** The arm model: an exact model id, never a Fable one (the gate's ARM_MODEL_FORBIDDEN_RE, never re-spelled). */
function refuseArmModel(model) {
  if (typeof model !== 'string' || !EXACT_MODEL_ID_RE.test(model)) refuse('args-invalid', `arm-model ${JSON.stringify(model)} is not an exact model id`);
  if (ARM_MODEL_FORBIDDEN_RE.test(model)) refuse('args-invalid', `arm-model ${JSON.stringify(model)} is forbidden for an arm`);
}
/** One of this file's JSON outputs, read by sha through loadInput, with its kind and the setup it names checked. */
function loadOwn(flags, name, kind, setupSha256) {
  const r = loadInput(name, flags[name], flags[`${name}-sha256`]);
  if (!plainObject(r.value) || r.value.kind !== kind || r.value.v !== 1) refuse('input-invalid', `${name} is not a ${kind}`);
  if (r.value.setup_sha256 !== setupSha256) refuse('input-invalid', `${name} names setup ${String(r.value.setup_sha256)}, not ${setupSha256}`);
  return r;
}

// ── measuring and acting ────────────────────────────────────────────────────────────────────────────────────────────
/** --out by the driver's rule (prepareOut), then this file's marker beside the driver's. The marker is written only into a
 *  directory prepareOut has just made; an existing directory must already hold it, exactly OUT_KIND. So any other
 *  directory, a W2 run's --out (the driver's marker alone) above all, refuses out-refused before anything is written:
 *  this file never writes answers, batches or spend rows into a W2 run (skip condition 2). The reverse, the driver's
 *  checkOut accepting a single-arm --out, is in a gate code file and stays a residual (the task note). Nor is any --out
 *  inside a directory the driver made (refuseDriverAncestor), so a week never nests in a W2 run's --out either. */
function openOut(outArg) {
  refuseDriverAncestor(outArg);
  let fresh = false;
  try { lstatSync(path.resolve(outArg)); } catch (e) { fresh = e?.code === 'ENOENT'; }
  const out = prepareOut(outArg);
  refuseColonInRealOut(out);
  const read = readPlain(path.join(out, OUT_MARKER), 64);
  if (read.state === 'absent' && fresh) writePlain(out, OUT_MARKER, `${OUT_KIND}\n`);
  else if (read.state === 'absent') refuse('out-refused', `${OUT_MARKER} absent: this --out was not made by this file, and is never adopted`);
  else if (read.state !== 'bytes' || read.bytes.toString('utf8') !== `${OUT_KIND}\n`) refuse('out-refused', `${OUT_MARKER} is not this file's marker`);
  return out;
}
/** Every ancestor of --out, up to the filesystem root, as spelled and through realpath (a symlink into a W2 run's --out),
 *  must not hold the driver's marker: a week inside a W2 run's --out would put its runs within reach of W2's own claim
 *  walk and its spend onto W2's ledger (review 2422's F1-a). Checked before prepareOut makes anything. A marker that
 *  cannot be measured refuses too, never read as absent.  @param {string} outArg */
function refuseDriverAncestor(outArg) {
  const lexical = path.resolve(outArg);
  const chainOf = (from) => {
    const dirs = [];
    for (let d = from; ; d = path.dirname(d)) { dirs.push(d); if (path.dirname(d) === d) return dirs; }
  };
  let real = null;
  for (const d of chainOf(path.dirname(lexical))) {
    try { real = realpathSync(d); break; } catch (e) {
      if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') refuse('out-refused', `${d} unreadable ${e?.code ?? 'error'}`);
    }
  }
  for (const d of new Set([...chainOf(path.dirname(lexical)), ...(real === null ? [] : chainOf(real))])) {
    const at = path.join(d, DRIVER_OUT_MARKER);
    try { lstatSync(at); } catch (e) {
      if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') continue;
      refuse('out-refused', `${at} unreadable ${e?.code ?? 'error'}`);
    }
    refuse('out-refused', `--out is inside ${d}, which holds the driver's marker ${DRIVER_OUT_MARKER}: a week never runs inside a W2 run's --out, or the setup's`);
  }
}
/** The account from the roster (W2-D52) and the no-spawn admission (the roster, the account, the wrapper, the limits row
 *  and the files' preflight against what is measured now), before --out exists. */
function admitNode(home, s) {
  const { json, roster } = readRoster(home);
  const launch = admitAccount(json, roster, s.account, home);
  const files = measuredFiles(home, launch);
  refuseSpawnAdmission({ home, accountId: s.account, limits: s.limits, expected: files });
  return { launch, roster };
}
/** The release stamp, the wrapper and the gate code files, measured now; any one unmeasured refuses its driver word. */
function measuredFiles(home, launch) {
  const stamp = readReleaseStamp(home);
  if (stamp.state !== 'value') refuse('tree-unmeasured', `the release stamp is ${stamp.state}`);
  const code = codeShas();
  if (code.state !== 'measured') refuse('code-unmeasured', `${code.path} is ${code.cause}`);
  return { release_stamp: stamp.tag, wrapper_sha256: wrapperSha(launch), code_shas: code.files };
}
/** F5: a fresh expected node, measured at this act's start, against which every batch's preflight then compares. */
async function freshExpected({ launch, home, out, lang }) {
  const v = await measureClaudeVersion(launch, out, lang);
  refuseIfStopping();
  if (v.state !== 'value') refuse('version-unmeasured', `--version failed (code ${v.code}, signal ${v.signal})`);
  return { claude_code_version: v.version, ...measuredFiles(home, launch) };
}
/** One path under HOME, by lstat (never following a link): `absent` on ENOENT or ENOTDIR, `unmeasured` on any other
 *  failure, never folded into absence; else the stat itself. */
function probe(home, rel) {
  try {
    return { state: 'present', st: lstatSync(path.join(home, rel)) };
  } catch (e) {
    return e?.code === 'ENOENT' || e?.code === 'ENOTDIR' ? { state: 'absent' } : { state: 'unmeasured' };
  }
}
/** The armed words at arms time (plan §4), each read by existence through lib's SWITCHES. A steer-on entry counts only as
 *  a regular non-link file, as the session hook reads it. */
export function armedWordsOf(home, ccrcIds) {
  const at = (rel) => probe(home, rel).state;
  const fileAt = (rel) => {
    const p = probe(home, rel);
    return p.state !== 'present' ? p.state : (p.st.isFile() && !p.st.isSymbolicLink() ? 'present' : 'absent');
  };
  const steer = steerWordOf({ off: at(SWITCHES.off), steerOff: at(SWITCHES.steerOff), families: ccrcIds.map((id) => fileAt(path.join(SWITCHES.steerOnDir, id))) });
  const a = probe(home, SWITCHES.agentsOn);
  const agents = agentsWordOf(a.state === 'present' ? { state: 'present', isFile: a.st.isFile(), isSymbolicLink: a.st.isSymbolicLink() } : a);
  return { steer, agents };
}

// ── setup ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `setup`: the run's fixed values, once. --settings-mode has no default (OQ1 as restated), so a restricted default can
 *  never drop the skill unnoticed. The writer and the judge are exact Opus ids, the arm model never a Fable one. It
 *  admits the account, then makes --out, draws the seed and measures the release and the Claude Code build, which it
 *  records for information only (F5). Writes setup.json; its sha on stderr. */
export async function setupCommand(flags, env, deps = { seed: drawSeedHex }) {
  checkForm('setup', flags);
  const home = subcommandHome(env);
  if (!SETTINGS_MODES.includes(flags['settings-mode'])) refuse('args-invalid', `settings-mode ${JSON.stringify(flags['settings-mode'])} is not one of ${SETTINGS_MODES.join(', ')}`);
  refuseUnusableInputs(home, flags.out, [['writer-model', flags['writer-model']], ['judge-model', flags['judge-model']], ['arm-model', flags['arm-model']]]);
  refuseWriterModel(flags['writer-model']);
  refuseOpusModel('judge-model', flags['judge-model']);
  refuseArmModel(flags['arm-model']);
  const quiz = { target: flags.target ?? draftValue(DRAFT.quiz.fields.target), caps: draftValue(DRAFT.quiz.fields.caps),
    writer_input: draftValue(DRAFT.quiz.fields.writer_input) };
  const limits = copyJson(LIMITS_DEFAULTS);
  refuseOutOfRangeValues({ budget: flags.budget, budgetField: 'budget', limits, quotas: { target: quiz.target, caps: quiz.caps }, batch: true });
  const s = { account: flags.account, limits };
  const { launch } = admitNode(home, s);
  const out = openOut(flags.out);
  const claim = claimOut(out);
  try {
    const version = await measureClaudeVersion(launch, out, env.LANG);
    refuseIfStopping();
    const setup = {
      kind: SETUP_KIND, v: 1, account: flags.account, budget: flags.budget, settings_mode: flags['settings-mode'],
      writer_model: flags['writer-model'], judge_model: flags['judge-model'], arm_model: flags['arm-model'], rubric_id: draftValue(DRAFT.rubric_id),
      seed: deps.seed(), labeller: { ...copyJson(LABELLER), sha_min_prefix: draftValue(DRAFT.labeller.fields.sha_min_prefix) }, quiz, limits,
      measured: { at_ms: Date.now(), release: readReleaseStamp(home), claude_code: version },
    };
    writePlain(out, SETUP_FILE, `${canonicalJson(setup)}\n`);
    process.stderr.write(`sha256 ${shaOfPlain(out, SETUP_FILE)}\n`);
    return EXIT.OK;
  } finally {
    claim.release();
  }
}

// ── source, freeze, marker ──────────────────────────────────────────────────────────────────────────────────────────
/** `source`: every admitted family on this node (OQ2), through the driver's sourceQuiz and openWriter, under the setup's
 *  writer, settings mode, limits and budget, preflighted against a fresh expected node (F5). No family is excluded: a
 *  single-arm run has no pilot families and no assignment. Writes quiz/sourced.json (W2's kind, naming the setup's sha as
 *  its record) and the sourcing baseline record; its sha on stderr. */
export async function sourceCommand(flags, env, deps = { sourceQuiz }) {
  checkForm('source', flags);
  const home = subcommandHome(env);
  const setup = loadSetup(flags);
  const s = setup.value;
  refuseUnusableInputs(home, flags.out, [['writer-model', s.writer_model]]);
  refuseWriterModel(s.writer_model);
  refuseOutOfRangeValues({ budget: s.budget, budgetField: 'budget', limits: s.limits, quotas: { target: s.quiz.target, caps: s.quiz.caps }, settings: { mode: s.settings_mode } });
  const { launch, roster } = admitNode(home, s);
  const rs = openReplayStore(home);
  try {
    const out = openOut(flags.out);
    const claim = claimOut(out);
    try {
      const expected = await freshExpected({ launch, home, out, lang: env.LANG });
      const writer = await openWriter({ home, accountId: s.account, model: s.writer_model, settingsMode: s.settings_mode, writerInput: s.quiz.writer_input,
        claim, budget: s.budget, limits: s.limits, expected, lang: env.LANG, idx: rs.idx });
      const sourced = await deps.sourceQuiz({ mode: 'quiz', rs, home, out, writer, seedHex: s.seed, exclude: { pilotFamilies: [], assignment: [] },
        plan: { target: s.quiz.target, caps: s.quiz.caps }, configDirs: rosterConfigDirs(roster, home), shaMinPrefix: s.labeller.sha_min_prefix });
      warnFailedRuns(sourced.counts);
      ensurePlainDir(out, SECTION);
      writePlain(out, SOURCED_FILE, `${canonicalJson(sourcedReport({ recordSha256: setup.sha256, storeId: rs.storeId, assignmentSha256: assignmentSha256([]),
        inputs: [], sourced, spend: spentSoFar(out) }))}\n`);
      process.stderr.write(`sha256 ${shaOfPlain(out, SOURCED_FILE)}\n`);
      return EXIT.OK;
    } finally {
      claim.release();
    }
  } finally {
    rs.close();
  }
}

/** `freeze`: the sourced list, cut at the setup's target in its rank order (the driver's mergeSourced), as the frozen list's
 *  exact bytes (frozenListText, writeFrozenList: never replaced) and its meta (quizMetaReport, W2's halt floor and family
 *  minimum reported, never refusing). Its sha on stderr. */
export async function freezeCommand(flags) {
  checkForm('freeze', flags);
  const setup = loadSetup(flags);
  const s = setup.value;
  const sourced = loadInput('sourced', flags.sourced, flags['sourced-sha256']);
  const v = sourced.value;
  if (!plainObject(v) || v.kind !== SOURCED_KIND || v.v !== 1 || !Array.isArray(v.entries)) refuse('input-invalid', 'sourced is not a sourced list');
  if (v.record_sha256 !== setup.sha256) refuse('input-invalid', `sourced names ${String(v.record_sha256)}, not this setup ${setup.sha256}`);
  const qids = new Set();
  for (const e of v.entries) {
    if (!plainObject(e) || qidOf(e) !== e.qid) refuse('input-invalid', `sourced entry ${String(e?.qid)} qid-mismatch`);
    if (qids.has(e.qid)) refuse('input-invalid', `sourced qid-duplicate ${e.qid}`);
    qids.add(e.qid);
  }
  const entries = mergeSourced([v.entries], s.quiz.target);
  const text = frozenListText(SECTION, { writer_model: s.writer_model, labeller: s.labeller }, entries.map(frozenEntryOf));
  const out = openOut(flags.out);
  const claim = claimOut(out);
  try {
    const sha = writeFrozenList(out, SECTION, text);
    writePlain(out, QUIZ_META_FILE, `${canonicalJson(quizMetaReport({ recordSha256: setup.sha256, frozenSha256: sha, assignmentSha256: assignmentSha256([]),
      entries, floor: draftValue(DRAFT.quiz.fields.halt_floor), minFamilies: draftValue(DRAFT.quiz.fields.min_families), sourced: [{ store_id: v.store_id, sha256: sourced.sha256 }] }))}\n`);
    process.stderr.write(`sha256 ${sha}\n`);
    return EXIT.OK;
  } finally {
    claim.release();
  }
}

/** `marker`: the headless-on text the frozen families need (lib's formatHeadlessList, the one producer of that text), on
 *  stdout, and its sha on stderr. It writes nothing: the marker is the operator's to write. */
export async function markerCommand(flags) {
  checkForm('marker', flags);
  const fz = loadFrozen(flags.frozen, flags['frozen-sha256'], SECTION);
  const stores = [...new Set(fz.list.entries.map((e) => e.store_id))];
  if (stores.length !== 1) refuse('input-invalid', `the frozen list names ${stores.length} stores; the single-arm run is one node's`);
  let text;
  try {
    text = formatHeadlessList({ storeId: stores[0], pairs: fz.families.map((f) => ({ ccrcId: f.ccrc_id, generation: f.generation })) });
  } catch (e) {
    if (!(e instanceof TypeError) && !(e instanceof RangeError)) throw e;
    refuse('input-invalid', `the marker cannot be formatted: ${e.name}: ${e.message}`);
  }
  process.stdout.write(text);
  process.stderr.write(`sha256 ${sha256Hex(text)}\n`);
  return EXIT.OK;
}

// ── arms: step 0b's probes first, then the treatment arm ────────────────────────────────────────────────────────────
/** One week's release pin: written by the first `arms` on this --out, and a later `arms` on another release refuses. */
function pinArmsRelease(out, setupSha256, release) {
  const pin = armsPinOf(out, setupSha256);
  if (pin.state === 'absent') {
    ensurePlainDir(out, SECTION);
    writePlain(out, RELEASE_PIN_FILE, releasePinText(setupSha256, release, 0));
    return;
  }
  const p = pin.value;
  if (p.ccrc_release !== release) throw new QuizSingleRefusal('release-moved', `this week's arms ran on ${p.ccrc_release}, this node now runs ${release}: run the week again on a fresh --out`);
}

/** The release pin's bytes, the one composer of them (fix round 1, F3). The pin has two write sites, for two acts:
 *  pinArmsRelease writes it at the week's first `arms` and verifies it at every later one, and repilotPrepare replaces it on
 *  purpose after a failed pilot, for the round it starts. `round` is the step 0b round the pin was written for (0 at the
 *  first start); a pin written before it existed reads as round 0. Pure.
 *  @param {string} setupSha256  @param {string} release  @param {number} round  @returns {string} */
export function releasePinText(setupSha256, release, round) {
  if (!Number.isSafeInteger(round) || round < 0) throw new TypeError(`releasePinText: round ${String(round)}`);
  return `${canonicalJson({ kind: RELEASE_PIN_KIND, v: 1, setup_sha256: setupSha256, ccrc_release: release, round })}\n`;
}
/** This --out's release pin: `absent`, or its parsed `value` when it is this setup's pin (its kind and setup sha); any other
 *  file refuses out-refused. Both write sites read the pin through it first, so neither replaces a pin that is not this run's. */
function armsPinOf(out, setupSha256) {
  const read = readPlain(path.join(out, RELEASE_PIN_FILE), OUT_JSON_CAP);
  if (read.state === 'absent') return { state: 'absent' };
  let p = null;
  try { p = read.state === 'bytes' ? JSON.parse(read.bytes.toString('utf8')) : null; } catch { p = null; }
  if (!plainObject(p) || p.kind !== RELEASE_PIN_KIND || p.setup_sha256 !== setupSha256) refuse('out-refused', `${RELEASE_PIN_FILE} is not this run's pin`);
  return { state: 'value', value: p, round: Number.isSafeInteger(p.round) && p.round >= 0 ? p.round : 0 };
}

// ── the week's account (run 3538, the coordinator's ruling 3) ───────────────────────────────────────────────────────
/** The week's account record's bytes, the one composer of them. Pure.  @param {string} setupSha256  @param {string} account */
export function weekAccountText(setupSha256, account) {
  if (typeof account !== 'string' || account === '') throw new TypeError(`weekAccountText: account ${JSON.stringify(account)}`);
  return `${canonicalJson({ kind: WEEK_ACCOUNT_KIND, v: 1, setup_sha256: setupSha256, account })}\n`;
}
/** A week's account as its folder records it, the one reader (the runner asks it too, so it never throws):
 *  `recorded` with the account; `recorded` with `older: true` and the setup's account for a week an older build ran (its
 *  release pin stands and no record does: such a week ran on the setup's account); `none` when the week has spawned nothing
 *  (neither file); `unreadable` with a detail for a record that is not a regular file or not this setup's.
 *  @param {string} out  @param {string} setupSha256  @param {string} setupAccount */
export function weekAccountOf(out, setupSha256, setupAccount) {
  const read = readPlain(path.join(out, WEEK_ACCOUNT_FILE), OUT_JSON_CAP);
  if (read.state === 'absent') {
    return readPlain(path.join(out, RELEASE_PIN_FILE), OUT_JSON_CAP).state === 'absent' ? { state: 'none' }
      : { state: 'recorded', account: setupAccount, older: true };
  }
  if (read.state !== 'bytes') return { state: 'unreadable', detail: `${WEEK_ACCOUNT_FILE} is ${read.why}${read.code === undefined ? '' : ` ${read.code}`}` };
  let r = null;
  try { r = JSON.parse(read.bytes.toString('utf8')); } catch { r = null; }
  if (!plainObject(r) || r.kind !== WEEK_ACCOUNT_KIND || r.v !== 1 || r.setup_sha256 !== setupSha256 || typeof r.account !== 'string' || r.account === '') {
    return { state: 'unreadable', detail: `${WEEK_ACCOUNT_FILE} is not this run's record` };
  }
  return { state: 'recorded', account: r.account, older: false };
}
/** The act's account against the week's record, before anything is spawned: the week's first `arms` writes the record (the
 *  one writer), and every later act refuses `account-moved` when it was given another account than the record names. A
 *  record it cannot read refuses `out-refused`. `judge` writes nothing: a week with no record reads as the setup's account. */
function settleWeekAccount(out, setupSha256, setupAccount, account, { write }) {
  const rec = weekAccountOf(out, setupSha256, setupAccount);
  if (rec.state === 'unreadable') refuse('out-refused', rec.detail);
  if (rec.state === 'none' && write) {
    ensurePlainDir(out, SECTION);
    writePlain(out, WEEK_ACCOUNT_FILE, weekAccountText(setupSha256, account));
    return;
  }
  const recorded = rec.state === 'none' ? setupAccount : rec.account;
  if (recorded !== account) {
    throw new QuizSingleRefusal('account-moved', `this week ran on ${rec.state === 'recorded' && rec.older !== true ? 'the account its record names' : 'the setup\'s account'}, and this act was given another: a week never changes account`);
  }
}

/** Step 0b's probes (OQ1 as restated; W2-D57, W2-D58): the box run (the turn bound, persistence) and the treatment-arm
 *  probe runs (each taught spelling, the three denials, the Agent call), every arm run's init showing exactly its tools, no
 *  MCP server, no plugin and the ccrc-history skill. Every check must pass (step0bVerdictOf, fail-closed). The result is
 *  written whatever it shows; a failure refuses `pilot-failed` before any arm spawns. A result already here for this
 *  setup is read: failed, the week needs a fresh --out, unless `arms --repilot` (repilotPrepare) asked for it to be piloted
 *  again as the next round; passed, it is reused only when every build it probed is the
 *  fresh expected node's, and on any other build step 0b runs again, over it, before the next arm (the coordinator's
 *  ruling on review 2409's F4: no arm runs on a build step 0b never probed). With no arm left to run (c.reprobe false,
 *  every question settled) a passed result is reused whatever build it probed: nothing runs on the new build, and the
 *  summary's step 0b sha stays true (review 2422's F4-b). Every round's runs are named by the build and the round
 *  (step0bRoundName), so a resumed probe only ever reuses finished runs of its own build (review 2422's F4-a). */
async function step0bOf(c) {
  const rel = step0bRel(c.settingsMode);
  const have = step0bResultOf(c.out, rel, c.setupSha256);
  let round = 0;
  if (have.state === 'value') {
    const r = have.value;
    if (r.passed !== true && c.repilot === true) {
      // `arms --repilot` (quiz-pilot-checks ruling 5): the failed result was kept beside it by repilotPrepare and the release
      // pin moved; the pilot runs again as the next round, and its result replaces this one.
      round = roundOf(r) + 1;
      process.stderr.write(`${PREFIX}: step 0b failed here in round ${roundOf(r)}: --repilot probes it again as round ${round}\n`);
      return step0bRound(c, rel, round);
    }
    if (r.passed !== true) refuse('pilot-failed', `${rel} records a failed step 0b: run the week again on a fresh --out`);
    const versions = r.batches.map((b) => b?.claude_code_version);
    if (versions.length > 0 && versions.every((v) => v === c.expected.claude_code_version)) return { rel, sha256: shaOfPlain(c.out, rel), versions };
    if (!c.reprobe) {
      process.stderr.write(`${PREFIX}: step 0b probed ${[...new Set(versions)].join(', ')}, this node runs ${c.expected.claude_code_version}: every question is settled, so nothing runs and step 0b is not probed again\n`);
      return { rel, sha256: shaOfPlain(c.out, rel), versions };
    }
    process.stderr.write(`${PREFIX}: step 0b probed ${[...new Set(versions)].join(', ')}, this node runs ${c.expected.claude_code_version}: probing again\n`);
    round = roundOf(r) + 1;
  }
  return step0bRound(c, rel, round);
}

/** A step 0b result's round, 0 when it records none. Pure. */
const roundOf = (r) => (Number.isSafeInteger(r.round) && r.round >= 0 ? r.round : 0);

/** This --out's step 0b result for this setup: `absent`, or its parsed `value`; anything else refuses out-refused. */
function step0bResultOf(out, rel, setupSha256) {
  const have = readPlain(path.join(out, rel), OUT_JSON_CAP);
  if (have.state === 'absent') return { state: 'absent' };
  if (have.state !== 'bytes') refuse('out-refused', `${rel} is unreadable`);
  let r = null;
  try { r = JSON.parse(have.bytes.toString('utf8')); } catch { r = null; }
  if (!plainObject(r) || r.kind !== STEP0B_KIND || r.setup_sha256 !== setupSha256 || !Array.isArray(r.batches)) {
    refuse('out-refused', `${rel} is not this run's step 0b result`);
  }
  return { state: 'value', value: r, bytes: have.bytes };
}

/** The failed result `arms --repilot` keeps before it probes again: `quiz/step0b/<mode>.failed.r<round>.json`. Pure. */
export const step0bFailedRel = (mode, round) => `${SECTION}/step0b/${mode}.failed.r${round}.json`;

/** `arms --repilot` before the release pin is read (quiz-pilot-checks ruling 5). The flag permits the one thing a failed
 *  pilot otherwise refuses, piloting this --out again; it decides nothing else: WHEN a week is piloted again (the release
 *  moved, at most three pilots a week) is the unattended runner's decision (repilotOf), never this file's. With no failed
 *  result here it does nothing, so a resumed re-pilot that already passed carries on as any arms does. With one, it refuses
 *  out-refused when an arm batch was ever planned on this --out (the week's arms would span two releases). When the pin
 *  already names the round after the failed one, that round is under way (it stopped before its result was written): on the
 *  release installed now it is resumed as it stands, and on any other release it refuses repilot-release-moved, so one
 *  pilot result never mixes two releases (fix round 1, F2). Otherwise it keeps the failed result beside the new one and
 *  pins this week to the release measured now for the next round, so the pilot and every arm after it run on one release,
 *  as pinArmsRelease requires. The spend ledger is this --out's, so the pilot's spend counts toward the week's one --budget. */
function repilotPrepare(c) {
  const rel = step0bRel(c.settingsMode);
  const have = step0bResultOf(c.out, rel, c.setupSha256);
  if (have.state !== 'value' || have.value.passed === true) return;
  if (readArmManifests(c.out, SECTION).length > 0) refuse('out-refused', '--repilot: an arm batch was planned on this --out, so its week is never piloted again');
  const pin = armsPinOf(c.out, c.setupSha256);
  if (pin.state === 'absent') refuse('out-refused', `--repilot: no ${RELEASE_PIN_FILE} beside a failed step 0b`);
  const next = roundOf(have.value) + 1;
  if (pin.round > next) refuse('out-refused', `--repilot: ${RELEASE_PIN_FILE} names round ${pin.round}, past the next round ${next}`);
  if (pin.round === next) {
    if (pin.value.ccrc_release === c.release) return;   // the round under way, resumed on its own release
    throw new QuizSingleRefusal('repilot-release-moved', `step 0b round ${next} is under way on ${pin.value.ccrc_release}, this node now runs ${c.release}: one pilot never spans two releases`);
  }
  ensurePlainDir(c.out, `${SECTION}/step0b`);
  writePlain(c.out, step0bFailedRel(c.settingsMode, roundOf(have.value)), have.bytes);
  writePlain(c.out, RELEASE_PIN_FILE, releasePinText(c.setupSha256, c.release, next));
}

/** One step 0b round on this --out: the box batch and the arm batches, the checks, the result written whatever it shows. */
async function step0bRound(c, rel, round) {
  const { launch, out, model, settingsMode, lang, gate, claim, q, home } = c;
  // The driver's runBatch reuses a finished run of the same name rather than spawning it again, and a run's record names
  // no build: so every round, round 0 included, runs under its build and its round.
  const nameOf = (run) => step0bRoundName(settingsMode, c.expected.claude_code_version, round, run);
  const spawnPre = () => preflightSpawn({ launch, home, out, lang, gate, expected: c.expected });
  const batches = [];
  const pre0 = await spawnPre();
  const mech = await step0bMechanics({ launch, out, model, settingsMode, lang, gate, claim, name: nameOf('turn-bound') });
  batches.push({ claude_code_version: pre0.version, runs: [nameOf('turn-bound')] });
  const box = finishedOutcome({ launch, mode: 'box', model, settingsMode, out, name: nameOf('turn-bound') });
  const probes = step0bProbesOf(home, c.transcript);
  const outcomes = [];
  for (let i = 0; i < probes.length; i += c.limits.batch_max) {
    const card = await step0bCardOf(c.cardCtx);
    const pre = await spawnPre();
    const jobs = probes.slice(i, i + c.limits.batch_max).map((p) => {
      const job = { launch, mode: 'arm', model, settingsMode, recall: { session: q.ccrc_id, arm: TREATMENT_ARM, asof: q.boundary_uuid },
        stdin: step0bStdinOf(card, p), out, name: nameOf(p.probe), lang };
      return c.timeoutMs === undefined ? job : { ...job, timeoutMs: c.timeoutMs };
    });
    outcomes.push(...await runBatch(jobs, { gate, claim, concurrency: c.limits.concurrency }));
    batches.push({ claude_code_version: pre.version, runs: jobs.map((j) => j.name) });
  }
  const persistence = [{ name: box.name, ...mech.persistence }, ...outcomes.map((o) => ({ name: o.name,
    ...persistenceMeasured({ configDir: launch.configDir, sessionId: o.facts.init === null ? null : o.facts.init.sessionId, cwd: o.cwd }) }))];
  const checks = {
    'turn-bound': turnBoundCheckOf(mech.turn_bound),
    persistence: persistenceCheckOf(persistence),
    ...initChecksOf(outcomes.map((o) => o.facts.init), armToolsOf(spawnArgv({ mode: 'arm', model, settingsMode, home }))),
    ...Object.fromEntries(probes.flatMap((p, k) => (p.expect === 'subagent' ? [] : [[p.probe,
      (p.expect === 'admitted' ? admissionCheckOf : denialCheckOf)(probeFindingOf(outcomes[k].facts, p.command))]]))),
  };
  const verdict = step0bVerdictOf(checks);
  const agent = outcomes[probes.findIndex((p) => p.expect === 'subagent')];
  const output = {
    kind: STEP0B_KIND, v: 1, setup_sha256: c.setupSha256, store_id: c.storeId, round, measured_ms: Date.now(), account: launch.accountId, model,
    settings_mode: settingsMode, question: { qid: q.qid, ccrc_id: q.ccrc_id, generation: q.generation, boundary_uuid: q.boundary_uuid },
    synthetic_transcript: c.transcript, probes: [...STEP0B_PROBES], batches, checks, subagent: subagentToolsOf(agent.facts.toolPairs), persistence,
    runs: [step0bRunOf('box', box), ...outcomes.map((o) => step0bRunOf('arm', o))],
    passed: verdict.passed, failed: verdict.failed, unmeasured: verdict.unmeasured,
  };
  ensurePlainDir(out, `${SECTION}/step0b`);
  writePlain(out, rel, `${canonicalJson(output)}\n`);
  if (!verdict.passed) refuse('pilot-failed', step0bFailureDetail(settingsMode, checks, verdict));
  return { rel, sha256: shaOfPlain(out, rel), versions: batches.map((b) => b.claude_code_version) };
}

/** A build's token in step 0b's run names: its `--version` line folded to the run-name alphabet (lower case, any other
 *  run of characters one `-`, at most 24 characters), then 8 hex of the whole line's sha256, so two lines that fold
 *  alike still name apart. Pure.  @param {string} version  @returns {string} */
export function buildTokenOf(version) {
  if (typeof version !== 'string' || version === '') throw new TypeError(`buildTokenOf: ${JSON.stringify(version)} is not a version line`);
  const slug = version.toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(0, 24).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  return `v${slug}-${sha256Hex(version).slice(0, 8)}`;
}
/** One step 0b run's name in round `round` on build `version`: `quiz/step0b/<mode>.<build token>.r<round>/<run>`, four
 *  levels as RUN_NAME_RE allows (the review's `<mode>.v<version>.r<k>`, the version folded by buildTokenOf). Pure.
 *  @param {string} settingsMode  @param {string} version  @param {number} round  @param {string} run  @returns {string} */
export function step0bRoundName(settingsMode, version, round, run) {
  if (!SETTINGS_MODES.includes(settingsMode)) throw new TypeError(`step0bRoundName: settings mode ${JSON.stringify(settingsMode)}`);
  if (!Number.isSafeInteger(round) || round < 0) throw new TypeError(`step0bRoundName: round ${String(round)}`);
  return `${SECTION}/step0b/${settingsMode}.${buildTokenOf(version)}.r${round}/${run}`;
}

/** The summary from the one arm's states as they stand, rewritten whole. Each answered question's answer field and
 *  correct flag are read from its settled answer record, the driver's own scoring (armAnswerOf), never re-scored here. */
function writeSummary(ctx, run, states, stop) {
  const settled = new Map(readAnswerRecords(ctx.out, SECTION).map(({ record }) => [record.qid, record]));
  const questions = states.map((st) => {
    const r = settled.get(st.q.qid);
    return { qid: st.q.qid, state: st.state,
      answer: r === undefined || r.answer_field === null ? null : { answer_field: r.answer_field, correct: r.correct === true } };
  });
  const manifests = readArmManifests(ctx.out, SECTION);
  const summary = singleSummaryOf({ setupSha256: run.setupSha256, frozenSha256: run.frozenSha256, storeId: ctx.storeId, settingsMode: ctx.settingsMode,
    budget: run.budget, spend: spentSoFar(ctx.out), batches: armBatchCount(ctx), stop, stamps: ctx.stamps, startedMs: run.startedMs, finishedMs: Date.now(),
    versions: [...run.step0b.versions, ...manifests.map((m) => m.claude_code_version)], release: ctx.expected.release_stamp,
    steer: run.armed.steer, agents: run.armed.agents, step0b: { rel: run.step0b.rel, sha256: run.step0b.sha256 }, questions });
  writePlain(ctx.out, SUMMARY_FILE, `${canonicalJson(summary)}\n`);
}

/** `arms`: before --out, the setup, the frozen list (every question on this node), the arm model, the ranges, the
 *  account and the no-spawn admission, W2-D78 (i) and (ii) over every family, and step 0b's card for its question (W2-D78
 *  (iii)); then --out, the claim, the gate, a fresh expected node (F5) and this week's release pin, the armed words, step
 *  0b's probes (refusing on a failure before any arm spawns), and the treatment arm alone (TREATMENT_ARM, recall on), in
 *  batches of at most limits.batch_max questions behind the driver's armBatchPreflight, at most ARM_ATTEMPTS_MAX attempts
 *  each. Writes quiz/arms-summary.json (rewritten on a refusal once --out is claimed, except after `interrupted`); its sha
 *  on stderr. Nothing is retried automatically. */
export async function armsCommand(flags, env, deps = { recheck: recheckBatch, payloads: armPayloads }) {
  checkForm('arms', flags);
  const home = subcommandHome(env);
  const setup = loadSetup(flags);
  const s = setup.value;
  refuseUnusableInputs(home, flags.out, [['arm-model', s.arm_model]]);
  refuseArmModel(s.arm_model);
  refuseOutOfRangeValues({ budget: s.budget, budgetField: 'budget', limits: s.limits, quotas: null, batch: true, settings: { mode: s.settings_mode } });
  const account = flags.account ?? s.account;   // the week's account (ruling 3); the setup's when not given
  const transcript = deps.syntheticTranscript ?? STEP0B_SYNTHETIC_TRANSCRIPT;
  const rs = openReplayStore(home);
  try {
    const storeId = rs.storeId;
    const fz = frozenOnNode(flags, storeId);
    const questions = fz.list.entries;
    const { launch, roster } = admitNode(home, { account, limits: s.limits });
    requireListed(home, storeId, fz.families);   // W2-D78 (i)
    const ids = [...new Set(questions.map((q) => q.ccrc_id))];
    refuseRecallOff(home, ids);   // W2-D78 (ii)
    const configDirs = rosterConfigDirs(roster, home);
    const cardCtx = { home, rs, storeId, q: questions[0], deps, configDirs };
    await step0bCardOf(cardCtx);   // W2-D78 (iii) and the card, before --out
    refuseSyntheticPresent(transcript);
    const out = openOut(flags.out);
    if (lstatOrNull(out, SETUP_FILE) !== null && shaOfPlain(out, SETUP_FILE) === setup.sha256) {
      refuse('out-refused', `--out holds this setup's ${SETUP_FILE}: a week runs in a fresh --out of its own, never the setup's`);
    }
    const claim = claimOut(out);
    try {
      settleWeekAccount(out, setup.sha256, s.account, account, { write: true });   // before the first spawn
      const startedMs = Date.now();
      const gate = batchGate({ out, home, accountId: launch.accountId, budget: s.budget, limits: s.limits });
      const expected = await freshExpected({ launch, home, out, lang: env.LANG });
      if (flags.repilot === true) repilotPrepare({ out, setupSha256: setup.sha256, settingsMode: s.settings_mode, release: expected.release_stamp });
      pinArmsRelease(out, setup.sha256, expected.release_stamp);
      const armed = armedWordsOf(home, ids);
      const ctx = {
        section: SECTION, home, out, rs, storeId, launch, gate, expected, allowCodeChange: false, deps, configDirs, model: s.arm_model,
        settingsMode: s.settings_mode, lang: env.LANG, timeoutMs: deps.timeoutMs, recordSha256: setup.sha256, shaMinPrefix: s.labeller.sha_min_prefix,
        budget: { in_force: s.budget }, stamps: new Set(), moves: [], runVersions: new Map(),
      };
      // An arm left to run, measured before step 0b: with none, a passed step 0b result is never probed again (F4-b).
      const open = singleStatesOf(ctx, questions);
      settleAnswers(ctx, open);
      const step0b = await step0bOf({ setupSha256: setup.sha256, storeId, out, home, launch, gate, claim, expected, model: s.arm_model,
        settingsMode: s.settings_mode, lang: env.LANG, limits: s.limits, q: questions[0], cardCtx, transcript, timeoutMs: deps.timeoutMs,
        reprobe: open.some((st) => st.next.length > 0), repilot: flags.repilot === true });
      const run = { setupSha256: setup.sha256, frozenSha256: fz.sha256, budget: s.budget, startedMs, armed, step0b };
      let states;
      try {
        for (;;) {
          states = singleStatesOf(ctx, questions);
          settleAnswers(ctx, states);
          const pending = states.filter((st) => st.next.length > 0).slice(0, s.limits.batch_max);
          if (pending.length === 0) break;
          const pre = await armBatchPreflight(ctx, pending);
          if (pre.pending.length === 0) { refuseIfStopping(); continue; }
          const planned = pre.pending.flatMap((st) => st.next.map(({ arm, attempt }) => ({ qid: st.q.qid, arm, attempt,
            job: armJob(ctx, st.q, arm, attempt, pre.stdins.get(`${st.q.qid} ${arm}`)) })));
          writeArmManifest(ctx, pre.version, planned);
          await runBatch(planned.map((p) => p.job), { gate, claim, concurrency: s.limits.concurrency });
        }
      } catch (e) {
        if (e instanceof DriverRefusal) reportStop(ctx, run, questions, e);
        throw e;
      }
      writeSummary(ctx, run, states, null);
      process.stderr.write(`sha256 ${shaOfPlain(out, SUMMARY_FILE)}\n`);
      return EXIT.OK;
    } finally {
      claim.release();
    }
  } finally {
    rs.close();
  }
}

/** A refusal once the arms' --out is claimed: one line with the word, its kind (the driver's driverWordClass) and the
 *  not-run count; the settled answers and the summary are written, except after `interrupted` (nothing more after the
 *  signal handler has run). A second refusal while measuring leaves the counts unmeasured; the first refusal stands. */
function reportStop(ctx, run, questions, e) {
  const kind = driverWordClass(e.word);
  let counted = 'not-run count unmeasured';
  try {
    const states = singleStatesOf(ctx, questions);
    const c = questionCountsOf(states.map((st) => st.state));
    counted = `${c.not_run} question(s) not run, ${c.rerun_owed} owing a re-run`;
    if (e.word !== 'interrupted') {
      settleAnswers(ctx, states);
      writeSummary(ctx, run, states, { word: e.word, kind, detail: e.detail });
    }
  } catch (e2) {
    if (!(e2 instanceof DriverRefusal)) throw e2;
  }
  process.stderr.write(`${PREFIX}: arms ${kind} ${e.word}: ${counted}; nothing is retried\n`);
}

// ── judge ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The arms summary as `judge` and `report` take it: this setup's and this frozen list's, finished with no stop and every
 *  question settled, and the one this --out holds (so the answer records read beside it are its own). */
function loadSummary(flags, out, setupSha256, frozenSha256) {
  const r = loadOwn(flags, 'arms-summary', SUMMARY_KIND, setupSha256);
  const v = r.value;
  if (v.frozen_sha256 !== frozenSha256) refuse('quiz-sha-mismatch', `arms-summary names frozen list ${String(v.frozen_sha256)}, not ${frozenSha256}`);
  if (v.stop !== null || !plainObject(v.counts) || v.counts.rerun_owed !== 0 || v.counts.not_run !== 0) refuse('input-invalid', 'arms-unsettled: finish the arms first');
  if (out !== null) {
    const here = lstatOrNull(out, SUMMARY_FILE) === null ? null : shaOfPlain(out, SUMMARY_FILE);
    if (here !== r.sha256) refuse('input-invalid', `arms-summary is not this --out's ${SUMMARY_FILE}`);
  }
  return r;
}
/** The judge's jobs over the one arm under the reading this process opened, and again under a fresh pairIndexOf reading;
 *  any difference in count, id or canonical input refuses (K26: never the newer mask). Re-spelled: see the header. */
export function judgeJobsAgreed({ items, map, idx, freshIdx }) {
  const first = judgeJobsOf({ items, map, idx });
  const again = judgeJobsOf({ items, map, idx: freshIdx });
  const same = first.length === again.length && first.every((j, i) => j.id === again[i].id && canonicalJson(j.input) === canonicalJson(again[i].input));
  if (!same) refuse('input-invalid', 'masking-snapshots-disagree judge');
  return first;
}

/** The judge's cap: the setup's --budget less the spend this week's ledger records outside the judge's own rows. --budget
 *  is the week's total (the operator's weekly cap), where the driver's judge would take the whole budget again. The gate
 *  runs before every spawn, so the ledger can end at most two whole runs (the batch's concurrency) past it; the arms' and
 *  the judge's overshoots do not stack, since the judge refuses here once the arms' spend has reached --budget. The driver's judge gate counts only judge rows against its cap, so a resumed
 *  judge neither counts its own rows twice nor starts on a fresh budget: it stops where the first one would have. A cap
 *  at or under nothing refuses `budget-exhausted` before any spawn.  @param {string} out  @param {number} budget */
function judgeCapOf(out, budget) {
  const rows = spendLinesOf(out);
  const outside = rows.reduce((a, r) => a + r.tokens, 0) - judgeSpentOf(rows);
  if (outside >= budget) refuse('budget-exhausted', `spent ${outside} of ${budget} before the judge: --budget is the week's, arms and judge together`);
  return budget - outside;
}

/** `judge`: the non-correct answers of the one arm (judgeItemsOf over [TREATMENT_ARM]: a correct answer never reaches the
 *  judge, a run-failed question is excluded) through the driver's openJudge, under the setup's exact Opus judge model, its
 *  rubric and settings mode, capped at what the week's --budget leaves (judgeCapOf), preflighted against a fresh expected node (F5). Writes
 *  quiz/judge.map.json (W2's kind, pinned) and quiz/judged.json (this file's kind); its sha on stderr. */
export async function judgeCommand(flags, env) {
  checkForm('judge', flags);
  const home = subcommandHome(env);
  const setup = loadSetup(flags);
  const s = setup.value;
  refuseUnusableInputs(home, flags.out, [['judge-model', s.judge_model]]);
  refuseOpusModel('judge-model', s.judge_model);
  refuseOutOfRangeValues({ budget: s.budget, budgetField: 'budget', limits: s.limits, quotas: null, settings: { mode: s.settings_mode } });
  const rs = openReplayStore(home);
  try {
    const storeId = rs.storeId;
    const fz = frozenOnNode(flags, storeId);
    const account = flags.account ?? s.account;   // the week's account (ruling 3); the setup's when not given
    const { launch } = admitNode(home, { account, limits: s.limits });
    const out = openOut(flags.out);
    const summary = loadSummary(flags, out, setup.sha256, fz.sha256);
    const claim = claimOut(out);
    try {
      settleWeekAccount(out, setup.sha256, s.account, account, { write: false });
      const cap = judgeCapOf(out, s.budget);
      const map = judgeMapOf(s.seed, fz.list.entries, [TREATMENT_ARM]);
      pinOutBytes(out, JUDGE_MAP_REL, judgeMapText(SECTION, fz.sha256, map), 'judge-map');
      const picked = judgeItemsOf({ entries: fz.list.entries, answers: readArmAnswers(out, SECTION), arms: [TREATMENT_ARM], shaMinPrefix: s.labeller.sha_min_prefix });
      const jobs = judgeJobsAgreed({ items: picked.items, map, idx: rs.idx, freshIdx: pairIndexOf(rs.db, home) });
      const expected = await freshExpected({ launch, home, out, lang: env.LANG });
      const judge = await openJudge({ home, accountId: account, model: s.judge_model, settingsMode: s.settings_mode, rubricId: s.rubric_id,
        claim, budget: cap, limits: s.limits, expected, lang: env.LANG });
      const items = await judge.judge(SECTION, jobs);
      const count = (pred) => items.filter(pred).length;
      const output = {
        kind: JUDGED_KIND, v: 1, setup_sha256: setup.sha256, frozen_sha256: fz.sha256, arms_summary_sha256: summary.sha256, store_id: storeId,
        arm: TREATMENT_ARM, map_sha256: shaOfPlain(out, JUDGE_MAP_REL), judge_model: s.judge_model, rubric_id: s.rubric_id,
        rubric_sha256: RUBRIC_SHA256[s.rubric_id], settings_mode: s.settings_mode, claude_code_version: expected.claude_code_version,
        ccrc_release: expected.release_stamp, measured_ms: Date.now(), items,
        counts: {
          judged: count((i) => i.outcome === 'judged'), judge_failed: count((i) => i.outcome === 'judge-failed'),
          uncertain: count((i) => i.label === 'uncertain'), fabricated: count((i) => i.label === 'fabricated'),
          excluded_correct: picked.excluded.correct, excluded_run_failed_questions: picked.excluded.run_failed_questions,
        },
        budget: s.budget, spend: spentSoFar(out), stamps: judge.stamps(),
      };
      writePlain(out, JUDGED_FILE, `${canonicalJson(output)}\n`);
      process.stderr.write(`sha256 ${shaOfPlain(out, JUDGED_FILE)}\n`);
      return EXIT.OK;
    } finally {
      claim.release();
    }
  } finally {
    rs.close();
  }
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `report`: the setup, the frozen list, the arms summary and the judged file, each by sha and each naming the others; the
 *  answer records this --out holds, from which the summary's counts and answers are recomputed (a difference refuses
 *  `input-invalid arms-summary-mismatch`, before any scoring); `release-moved` when the arms and the judge ran on
 *  different releases. Writes
 *  single-report.json (canonical JSON, one newline: singleReportOf, with no comparison figure) and its sha on stderr. */
export async function reportCommand(flags) {
  checkForm('report', flags);
  const setup = loadSetup(flags);
  const fz = loadFrozen(flags.frozen, flags['frozen-sha256'], SECTION);
  const out = openOut(flags.out);
  const summary = loadSummary(flags, out, setup.sha256, fz.sha256);
  const judged = loadOwn(flags, 'judged', JUDGED_KIND, setup.sha256);
  if (judged.value.frozen_sha256 !== fz.sha256 || judged.value.arms_summary_sha256 !== summary.sha256) refuse('input-invalid', 'judged names another frozen list or arms summary');
  if (judged.value.ccrc_release !== summary.value.ccrc_release) {
    throw new QuizSingleRefusal('release-moved', `the arms ran on ${summary.value.ccrc_release}, the judge on ${judged.value.ccrc_release}`);
  }
  const claim = claimOut(out);
  try {
    const answers = new Map();
    for (const { record } of readAnswerRecords(out, SECTION, 'input-invalid')) {
      if (record.arm !== TREATMENT_ARM || record.record_sha256 !== setup.sha256) refuse('input-invalid', `answer record ${record.qid} is not this run's treatment arm`);
      answers.set(record.qid, record);
    }
    const again = summaryTallyOf(fz.list.entries.map((e) => {
      const r = answers.get(e.qid);
      return { state: r === undefined ? 'not-run' : r.question_state,
        answer: r === undefined || !plainObject(r.answer_field) ? null : { answer_field: r.answer_field, correct: r.correct === true } };
    }));
    if (canonicalJson(again.counts) !== canonicalJson(summary.value.counts) || canonicalJson(again.answers) !== canonicalJson(summary.value.answers)) {
      refuse('input-invalid', 'arms-summary-mismatch: its counts or answers are not what this --out\'s answer records say');
    }
    const report = singleReportOf({ setup: setup.value, setupSha256: setup.sha256, frozen: fz.list, frozenSha256: fz.sha256, summary: summary.value,
      summarySha256: summary.sha256, judged: judged.value, judgedSha256: judged.sha256, answers });
    writePlain(out, REPORT_FILE, `${canonicalJson(report)}\n`);
    process.stderr.write(`sha256 ${shaOfPlain(out, REPORT_FILE)}\n`);
    return EXIT.OK;
  } finally {
    claim.release();
  }
}

/** Each subcommand's handler. */
export const HANDLERS = Object.freeze({
  setup: setupCommand, source: sourceCommand, freeze: freezeCommand, marker: markerCommand, arms: armsCommand, judge: judgeCommand, report: reportCommand,
});

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The pane, then the session, then the umask, then the driver's stop handler, then the grammar and the handler. A refusal
 *  is one stderr line and EXIT.REFUSED; anything else thrown is a defect, one stderr line and EXIT.INTERNAL.
 *  `deps` reaches the handler unchanged; the entry guard passes none, so every handler takes its own defaults (a test
 *  passes its stand-ins for the store reads, as the driver's tests do through each handler's deps).
 *  @param {string[]} argv  @param {{HOME?: string, TMUX_PANE?: string, LANG?: string, CLAUDECODE?: string}} env  @param {object} [deps] */
export async function main(argv, env, deps = undefined) {
  const installed = STOP_SIGNALS.map((sig) => [sig, () => onStopSignal(sig)]);
  try {
    const pane = paneRefusal(env);
    if (pane !== null) throw pane;
    if (env.CLAUDECODE !== undefined) throw new QuizSingleRefusal('in-session', 'CLAUDECODE is set; the quiz is the operator\'s, run from their own shell');
    process.umask(0o077);
    for (const [sig, fn] of installed) process.on(sig, fn);   // the driver's handler: a signal stops the children's groups
    const { sub, flags } = parseArgs(argv, { specs: FLAG_SPECS, subs: SUBCOMMANDS });
    return await HANDLERS[sub](flags, env, deps);
  } catch (e) {
    if (e instanceof DriverRefusal || e instanceof QuizSingleRefusal) {
      process.stderr.write(`${PREFIX}: ${e.word}: ${e.detail}\n`);
      return EXIT.REFUSED;
    }
    process.stderr.write(`${PREFIX}: internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return EXIT.INTERNAL;
  } finally {
    for (const [sig, fn] of installed) process.off(sig, fn);
  }
}

// The entry guard stays the LAST block of this file. Importing the module (the tests do) runs nothing. The exit code is set,
// never forced, so stderr drains. main gets a by-name projection of the environment, never process.env whole.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2),
    { HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG, CLAUDECODE: process.env.CLAUDECODE });
}
