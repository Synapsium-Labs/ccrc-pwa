#!/usr/bin/env -S node --no-warnings
// deploy/history-replay.mjs: the ccrc history W2 replay driver (spec 2026-10-05 §10.2; W2 decisions W2-D50 to W2-D59).
//
// An L4 operator script. The operator runs it by hand, from a shell OUTSIDE tmux, on a named node. It admits one
// account from the roster, spawns Claude Code headless under one fixed contract, reads the stream-json those spawns
// print, and writes every output under the operator's --out directory. Refusing to run inside a pane is main's first
// act (W2-D51, W2-D45).
//
// Imports: node: built-ins (node:crypto's randomBytes draws the W2 seeds); ../ccd/history/lib.mjs, with the as-of cut's
// statements and the card line (W2-2a; W2-D35, W2-D75) and the headless seam's arm words and marker grammar (W2-2b;
// W2-D42, W2-D44); the W2-1 exports the quiz reads, from ../ccd/history/store.mjs, ../ccd/history/derive.mjs,
// ../ccd/history/recall.mjs (with W2-2a's asOfCutOf) and ../ccd/history/cli.mjs (W2-D33, W2-D74); the index text and the
// registry read from ../ccd/history/sweep.mjs, never its recall-off reader (W2-D29); ./history-gate.mjs, the pure gate
// (W2-D11); and ../shared/roster-json.mjs.
// history-replay.test.ts pins the exact list and the names each ccd/history module brings in (D-5814). The driver spells
// no node:sqlite specifier: it loads node:sqlite only through store.mjs, that module's one importer, and every store read
// opens through store.mjs's read-only openReader (W2-D51); history-replay.test.ts scans every deploy/history-*.mjs for a
// specifier. Loading it prints Node's experimental-feature warning on stderr before any module body runs, so the driver
// runs under --no-warnings (its shebang, and every spawn of it), as cli.mjs and sweep.mjs do. Importing cli.mjs sets this
// process's umask to 0o077 (W2-D33); main sets it again before any file act (W2-D53).
// Children: spawn with an argv array, never a shell, never a command string, and no env value in one (CodeQL's
// js/shell-command-injection-from-environment opens a review thread that blocks the merge).
// Environment: main gets the entry guard's by-name projection {HOME, TMUX_PANE, LANG}; nothing here passes
// process.env whole, and every other env read goes through main's env parameter, with ONE exception: makeRunCwd's
// os.tmpdir() reads TMPDIR itself for each run's cwd, as `mktemp -d` does in spec §10.2's cwd rule. The cwd is
// still checked (outside any git tree, empty, mode 0700), so a TMPDIR that fails those refuses.
// Never spelled here: the recall arm words (W2-D42), which this file takes by position from lib's RECALL_ARMS
// (CONTROL_ARM, TREATMENT_ARM) and which reach a spawn as parameters (W2-D50); and the headless marker's path, which
// W2-5b reaches through lib's historyPaths (O13). history-replay.test.ts scans this file for an arm word.
// Its words: DRIVER_REASONS, frozen once here and nowhere else (W2-D59, W2-D12; D-5774). A refusal prints
// `ccrc history-replay: <word>: <detail>` on stderr and exits EXIT.REFUSED (2); a defect exits EXIT.INTERNAL (1).
// They are never lib REASONS: §8.7's table and SKILL.md do not list them. EXIT is imported, never declared (O14).
import { accessSync, closeSync, constants, fchmodSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import os from 'node:os';
import path, { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { CONTROL_FILE_MAX, EXIT, HEADLESS_LIST_MAX_BYTES, RECALL_ARMS, RECALL_OFF_META, SCHEMA_ADDED, SEARCHABLE_PROVENANCE, UUID_RE, asOfBinds, asOfHiddenNodesSql, asOfVisibleEntriesSql, backendOf, blobOverDecodeCap, canonicalJson, cardLine, displayPrefixes, entryIndexText, formatHeadlessList, ftsPhrase, ftsTextOf, historyPaths, idOk, isHistoryCommand, isSyntheticModel, parseHeadlessList, producerOf, producerOfCopy, recallOffPath, recallOffStatusOf, redactField, redactFinalJson, renderEntryText, sha256Hex, summaryRowFor, toolResultIdsOf, toolUsesOf } from '../ccd/history/lib.mjs';
import { StoreError, openReader, readBounded, userVersion } from '../ccd/history/store.mjs';
import { blobReadStmts, bodyOf, epochOfUuid, holdingCopyOf } from '../ccd/history/derive.mjs';
import { asOfCutOf, expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf } from '../ccd/history/recall.mjs';
import { pairIndexOf } from '../ccd/history/cli.mjs';
import { ftsTextOfBlob, readRegPresence } from '../ccd/history/sweep.mjs';
import { ANSWER_PROTOCOL, ANSWER_PROTOCOL_SHA256, ASSIGNMENT_ARMS, EXACT_MODEL_ID_RE, FACT_KINDS, GATE_CODE_FILES, LABELLER, OPEN_RECORD_V1, OPUS_MODEL_RE, PILOT_SUBSTREAM, QUESTION_OUTCOMES, RUBRICS, RUBRIC_IDS, RUBRIC_SHA256, SHA_MIN_PREFIXES, WRITER_INPUTS, WRITER_PROMPT, WRITER_PROMPT_SHA256, activeFamilies, admitFact, assignArms, assignmentSha256, buildWindows, checkGateCode, classifyRun, collapseWs, expectedWindows, familyKey, labelCorrect, parseAnswerField, parseLabelLine, parseQuestionLine, q18Power, questionOutcome, randInt, recordSha256, substream, validateOpenRecord, windowTotals } from './history-gate.mjs';
import { rosterFromJson, RosterInvalid } from '../shared/roster-json.mjs';

// ── the driver's words (W2-D59) ───────────────────────────────────────────
/** Every word the driver refuses with, in one frozen list. The first sixteen are W2-D59's, in its order (each owner
 *  PR raises its own). The next nine are W2-4's nine words (five plan-chosen, four by coordinator ruling), each kept apart from a lib REASONS word by design
 *  (C-J): `args-invalid` (an argv the grammar refuses; lib's is `bad-args`), `in-pane` (TMUX_PANE is set; lib's is
 *  `headless-in-pane`), `roster-invalid` (accounts.json absent, unreadable or refused by rosterFromJson; lib's is
 *  `roster-unreadable`), `account-refused` (W2-D52's admission), `input-invalid` (an input whose shape is wrong: a
 *  step 0a file whose sha matched, or a family id lib's idOk refuses), and, by coordinator ruling, `code-unmeasured`
 *  (a gate_code file that cannot be read; --allow-code-change never stamps it), `version-unmeasured` (a Claude Code
 *  --version that cannot be measured), `tree-unmeasured` (a release stamp that cannot be read; `tree-moved` stays
 *  for a measured mismatch) and `wrapper-unmeasured` (a generated account's wrapper that cannot be read;
 *  `wrapper-moved` stays for a measured mismatch). The last three are fix round 1's (D-5984, D-5985): `run-live` (a
 *  leftover `.part` whose writer is alive or unmeasured, or a regular `.pid` whose content is not a record), `out-in-use` (another
 *  driver holds the --out lock, or the lock file is not one) and `interrupted` (a SIGINT, SIGTERM or SIGHUP stopped
 *  the driver: a signal that arrives before the poll phase inside a yield is handled there, and every stop check after it
 *  refuses, so no spawn starts after the handler has run; after the handler has run, no run.json, step0a.json or probe.json
 *  is written, but a run whose post-close stretch is under way when a signal arrives is recorded, and the subcommand then
 *  refuses; a run stopped in flight is charged once, by its spend line; a signal that arrives in one lane's synchronous
 *  stretch from its yield to its spawn is handled only at the next poll phase, so a sibling lane whose yield returns in the
 *  same check phase passes its stop check and spawns: lanes that start together end their yields in one check phase, so up
 *  to c children (the batch's concurrency) can start in it, and each is stopped and charged; a signal that arrives after
 *  the batch's last check, when every child has closed, is not handled: the result is written, and the driver exits 0, or
 *  ends by that signal if it comes after main has removed its listeners: D-5984). The last is W2-5a's (Task 1):
 *  `store-unreadable`, a store this node cannot open or read (store.mjs's StoreError word, or SQLite's own error as
 *  store-read-failed), so reconstruction never reads an absent store as an empty one. */
export const DRIVER_REASONS = Object.freeze([
  'family-unlisted', 'family-recall-off',
  'quiz-unanswerable', 'quiz-sha-mismatch',
  'claude-version-moved', 'tree-moved', 'wrapper-moved', 'code-changed',
  'limits-threshold', 'limits-stale', 'budget-exhausted',
  'record-invalid', 'record-sha-mismatch', 'input-sha-mismatch',
  'assignment-mismatch',
  'out-refused',
  'args-invalid', 'in-pane', 'roster-invalid', 'account-refused', 'input-invalid',
  'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured',
  'run-live', 'out-in-use', 'interrupted',
  'store-unreadable',
]);

/** A refusal: one DRIVER_REASONS word and its detail. Any other throw is a defect (EXIT.INTERNAL). */
export class DriverRefusal extends Error {
  /** @param {string} word a DRIVER_REASONS member  @param {string} detail */
  constructor(word, detail) {
    if (!DRIVER_REASONS.includes(word)) throw new TypeError(`DriverRefusal: ${JSON.stringify(word)} is not a DRIVER_REASONS word`);
    super(`${word}: ${detail}`);
    this.name = 'DriverRefusal';
    /** @type {string} */
    this.word = word;
    /** @type {string} */
    this.detail = detail;
  }
}

/** Throws the refusal; never returns.
 *  @param {string} word  @param {string} detail  @returns {never} */
export function refuse(word, detail) {
  throw new DriverRefusal(word, detail);
}

// ── W2-5b1 Task 1: the arm words by position (W2-D42, W2-D50; S2's C9) ──────────────────────────────────────────
/** The two recall arms, by position in lib's RECALL_ARMS (W2-2b), the arm vocabulary's one declaration. This file spells
 *  no arm word: history-replay.test.ts scans it, holds these two to the words W2 means by them, and holds RECALL_ARMS to
 *  the gate's ASSIGNMENT_ARMS as a set (the gate's order is its own: handcheckSample reads it). These two lines are the
 *  only places the driver indexes RECALL_ARMS. */
export const CONTROL_ARM = RECALL_ARMS[0];
export const TREATMENT_ARM = RECALL_ARMS[1];

// ── W2-5b1 Task 1: the stop/refusal partition of DRIVER_REASONS (W2-D80 as amended, decisions §7; Q24) ─────────────
/** The driver words that are STOPS: a question not spawned, or cut off, because of one is `not-run`. It never consumes its
 *  re-run and is resumed after the stop clears (W2-D80). W2-D80's seven (the limits and budget stops and the moved and
 *  changed four), decisions §7's eight (W2-4's four unmeasured words, its three later words and `out-refused`, which can
 *  land mid-batch), and W2-5a's `store-unreadable`. In DRIVER_REASONS order. `not-run` stays emergent (Q24): a stopped
 *  or refused run writes no run.json. */
export const DRIVER_STOPS = Object.freeze([
  'claude-version-moved', 'tree-moved', 'wrapper-moved', 'code-changed',
  'limits-threshold', 'limits-stale', 'budget-exhausted',
  'out-refused',
  'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured',
  'run-live', 'out-in-use', 'interrupted',
  'store-unreadable',
]);
/** Every other driver word is a REFUSAL: its remedy is a changed input, flag, account or record, or an operator act on
 *  the marker, a control file or a frozen question (W2-D78's three), never a wait. In DRIVER_REASONS order. Both lists
 *  are spelled, so a word added to DRIVER_REASONS reds history-replay.test.ts's "exactly once" pin until it is classified. */
export const DRIVER_REFUSALS = Object.freeze([
  'family-unlisted', 'family-recall-off',
  'quiz-unanswerable', 'quiz-sha-mismatch',
  'record-invalid', 'record-sha-mismatch', 'input-sha-mismatch',
  'assignment-mismatch',
  'args-invalid', 'in-pane', 'roster-invalid', 'account-refused', 'input-invalid',
]);
/** A driver word's class, for the batch summary and the operator's line (Q24, Q30). Pure.
 *  @param {string} word  @returns {'stop' | 'refusal'} */
export function driverWordClass(word) {
  if (DRIVER_STOPS.includes(word)) return 'stop';
  if (DRIVER_REFUSALS.includes(word)) return 'refusal';
  throw new TypeError(`driverWordClass: ${JSON.stringify(word)} is not a DRIVER_REASONS word`);
}

// ── the argument grammar ──────────────────────────────────────────────────
/** @typedef {'string' | 'int' | 'bool' | 'list'} FlagKind */
/** @typedef {Record<string, string | number | boolean | string[]>} Flags */
/** @typedef {Record<string, string | undefined>} DriverEnv */

/** Every flag the driver knows and its kind. A string or int flag takes the next argv entry as its value; a bool flag
 *  takes none. Each subcommand reads the flags it needs and refuses a missing required one itself. */
export const FLAG_SPECS = Object.freeze(/** @type {Record<string, FlagKind>} */ ({
  out: 'string',
  account: 'string',
  budget: 'int',
  'writer-model': 'string',
  'judge-model': 'string',
  'arm-model': 'string',
  'settings-mode': 'string',
  // W2-5a Task 7 (W2-D25, W2-D73, W2-D84, W2-D21): the record subcommands' flags. A `list` flag repeats, one value per
  // node; its `-sha256` partner repeats with it and is paired by position (pairedInputs).
  step0a: 'list', 'step0a-sha256': 'list', 'node-label': 'list', 'node-store-id': 'list',
  pilot: 'string', 'pilot-sha256': 'string', overrides: 'string',
  record: 'string', 'record-sha256': 'string', supersedes: 'string', 'supersedes-sha256': 'string',
  part1: 'string', 'part1-sha256': 'string', 'prior-final': 'string', 'prior-final-sha256': 'string',
  census: 'list', 'census-sha256': 'list', verify: 'list', 'verify-sha256': 'list', sourced: 'list', 'sourced-sha256': 'list',
  frozen: 'string', 'frozen-sha256': 'string', 'quiz-meta': 'string', 'quiz-meta-sha256': 'string',
  power: 'string', 'power-sha256': 'string', 'pilot-result': 'string', 'pilot-result-sha256': 'string',
  'sha-min-prefix': 'int', 'writer-input': 'string', 'n-fidelity': 'int', 'n-usage': 'int',
  'spend-budget': 'int', 'window-start': 'int', 'window-end': 'int', 'q18-decision': 'string',
  draft: 'bool', finalize: 'bool', template: 'bool', registry: 'bool', section: 'string',
  // W2-5b1 Task 1 (W2-D24, Q23): a part 2 consumer's stamp, taken at or after window start only (loadFinalRecord). No W2-5a
  // form lists it, so each refuses it through checkFlags.
  'allow-code-change': 'bool',
}));

/** The subcommands, by name. Empty until Tasks 8 and 9 register `step0a` and `probe`, so every subcommand is
 *  args-invalid until then.
 *  @type {Map<string, (flags: Flags, env: DriverEnv) => Promise<number>>} */
export const HANDLERS = new Map();

const INT_TEXT = /^[1-9][0-9]*$/;

/** `<sub> [--flag value | --bool]...`: the subcommand first, then flags, each at most once but a `list` flag, whose values are kept in order. `--name=value` is not
 *  this grammar (it reads as an unknown flag). A value may not begin with `--`, so a flag left without its value never
 *  swallows the next flag. An int is a positive safe integer written in plain decimal.
 *  @param {string[]} argv
 *  @param {{specs?: Readonly<Record<string, FlagKind>>, subs?: Iterable<string>}} [opts] Tests pass their own sets;
 *    the driver passes none, so FLAG_SPECS and HANDLERS' keys answer.
 *  @returns {{sub: string, flags: Flags}} */
export function parseArgs(argv, opts = {}) {
  const specs = opts.specs ?? FLAG_SPECS;
  const subs = new Set(opts.subs ?? HANDLERS.keys());
  const sub = argv[0];
  if (sub === undefined || sub.startsWith('-')) refuse('args-invalid', 'no subcommand');
  if (!subs.has(sub)) refuse('args-invalid', `unknown subcommand ${JSON.stringify(sub)}`);
  /** @type {Flags} */
  const flags = {};
  for (let i = 1; i < argv.length; i += 1) {
    const tok = /** @type {string} */ (argv[i]);
    if (!tok.startsWith('--')) refuse('args-invalid', `unexpected argument ${JSON.stringify(tok)}`);
    const name = tok.slice(2);
    if (!Object.hasOwn(specs, name)) refuse('args-invalid', `unknown flag ${JSON.stringify(tok)}`);
    const kind = specs[name];
    if (kind !== 'list' && Object.hasOwn(flags, name)) refuse('args-invalid', `repeated flag --${name}`);
    if (kind === 'bool') { flags[name] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) refuse('args-invalid', `missing value for --${name}`);
    i += 1;
    if (kind === 'list') {   // W2-5a Task 7: every value, in argv order
      flags[name] = [...(/** @type {string[]} */ (flags[name] ?? [])), value];
      continue;
    }
    if (kind === 'int') {
      const n = Number(value);
      if (!INT_TEXT.test(value) || !Number.isSafeInteger(n)) {
        refuse('args-invalid', `--${name} wants a positive integer, got ${JSON.stringify(value)}`);
      }
      flags[name] = n;
    } else {
      flags[name] = value;
    }
  }
  return { sub, flags };
}

// ── the pane refusal (W2-D51, W2-D45) ─────────────────────────────────────
const PANE_DETAIL = 'TMUX_PANE is set; run the driver from a shell outside tmux';

/** TMUX_PANE is set iff it is defined, so an empty value refuses too (W2-D45).
 *  @param {DriverEnv} env  @returns {DriverRefusal | null} */
export function paneRefusal(env) {
  return env.TMUX_PANE !== undefined ? new DriverRefusal('in-pane', PANE_DETAIL) : null;
}

// ── D-5984: no unseen child (the registry, the stopping flag, the signal handler) ─────────────────────────────
// Every child is spawned as its own process-group leader (`detached: true`, so pid === pgid) and registered the moment
// spawn() returns. A SIGINT, SIGTERM or SIGHUP makes main's handler set the stopping flag, send SIGTERM to every group the
// registry holds and, after STOP_GRACE_MS, SIGKILL to whatever it STILL holds. The handler never exits the driver: the
// interrupt surfaces as the `interrupted` refusal, through main's one stderr line and EXIT.REFUSED. A driver killed alone
// (SIGKILL, the OOM killer) cannot run any of this; the `.pid` record each run leaves is what the next driver reads
// (settleLeftover). What a stop guarantees: a signal that arrives before the poll phase inside a yield (yieldToSignals) is
// handled there, and every stop check after it refuses `interrupted`, so no spawn starts after the handler has run. A signal
// that arrives in one lane's synchronous stretch from its yield to its spawn is handled only at the next poll phase, so a
// sibling lane whose yield returns in the same check phase does not see it: it passes its stop check, calls its gate and
// spawns. Lanes that start together (every batch's start, through Promise.all) end their yields in one check phase, so that
// window is up to c children, the batch's concurrency, not one; every child spawned in it is stopped (the handler SIGTERMs
// every live group) and charged, so no spend goes unseen.
// The wait after a leader's exit is bounded (spawnGroup): a STOP_GRACE_MS timer from the leader's 'exit', cleared at
// 'close', SIGKILLs the leader's group and destroys the streams, so a process that outlives the leader and holds a pipe
// cannot hold the driver, its lock or a signal's answer.
// Residuals, named: that yield-to-spawn window (up to c children); the post-last-check window (a signal that arrives
// after runBatch's last check, when every child has closed, is not handled: main removes its listeners before the loop
// polls, the result is written, and the driver exits 0, or, when the signal comes after that removal, ends by the
// signal's default action); a driver killed between spawn() and its `.pid` record leaves a `.part` with no record,
// charged as D-5811 says; a grandchild that calls setsid escapes every group kill and keeps running, and it no longer
// holds the driver (if it inherited the run's stdout, it can still write into the stream after the charge: for a
// RECORDED run, with its run.json written and its stream renamed to `<name>.jsonl`, a resume then refuses the changed
// stream; but on the stop path launchRun charges the run and removes its `.part`, and settleLeftover does the same to a
// leftover it charges, so the escapee's later writes go to an unlinked file that no batch sees, and a resume spawns the
// job again beside the escapee that is still running; it is not the process that spends: the Claude Code leader, which
// spends, is dead when it is charged, and on the stop path was killed, outside the spawn-to-record window and a
// run-live remedy that removed an unmeasured writer's `.pid`, where a `.part` with no `.pid` is charged even if its
// leader lives on); a process in the run's group that holds no pipe to the driver (on the stop path, one that also
// ignores SIGTERM; the leftover path settles a driver that was SIGKILLed, where no group signal was sent, so any member
// that keeps the stream survives): close fires at once, the timer is cleared, and it can outlive its leader; if it kept
// the run's stdout it can still write into the stream after the charge, with the same two outcomes, a refused resume
// for a recorded run and a re-spawned job beside it after a stop or a leftover's charge; and a group id reused by an
// unrelated process after the run's group emptied (the setsid case leaves it empty), which the bound's, the stop's and
// the timeout's group SIGKILL would then reach: it needs a pid wrap within the grace, and only the registry check,
// which catches a reuse by our own sibling, stands in the way.
/** Every live child, keyed by its pid (which is its process-group id). A Map, not a Set of pids, so 'close' can tell its
 *  own entry from a newer child's: the kernel may hand a reaped child's pid to a sibling spawned before the old child's
 *  'close' fires, and the old 'close' must not drop that newer entry (D-5984). No test reaches this: the reuse window
 *  is the kernel's, a test cannot make a pid recur between a child's exit and its 'close', and the registry is
 *  module-private with no hook (none is added for this). */
const liveChildren = new Map();
/** The signal that stopped the driver (its name), or null. main resets it at entry. */
let stopping = null;
const STOP_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP']);
const STOP_GRACE_MS = 5_000;

/** Signal a child's whole group. ESRCH (already gone) is the expected answer and any other failure leaves nothing more
 *  this process can do, so none is thrown: this runs from signal handlers and timers, where a throw would crash the
 *  driver with its children still running. */
function signalGroup(pid, sig) {
  try {
    process.kill(-pid, sig);
  } catch {
    // gone, or not ours to signal
  }
}

/** main's handler for SIGINT, SIGTERM and SIGHUP: the first signal names the stop; every group gets SIGTERM; the groups
 *  still registered after the grace get SIGKILL (read at that moment, not a snapshot). */
function onStopSignal(sig) {
  if (stopping === null) stopping = sig;
  for (const pid of liveChildren.keys()) signalGroup(pid, 'SIGTERM');
  setTimeout(() => { for (const pid of liveChildren.keys()) signalGroup(pid, 'SIGKILL'); }, STOP_GRACE_MS).unref();
}

/** Two turns of the event loop, in sequence: the point at which a signal that arrived before the poll phase between them
 *  is handled (one that arrives later, in a lane's stretch from this yield to its spawn, is handled at the next poll phase,
 *  and a sibling lane whose yield returns in the same check phase does not see it: D-5984). A Node signal
 *  handler runs only when the loop reaches its poll phase, and a lane resumes in a poll-phase callback (a child's 'exit' or
 *  'close'). From there one setImmediate runs in the same iteration's check phase, before the next poll, so a single turn
 *  can resume the lane ahead of a pending signal's handler. Two turns always have a poll phase between them. setTimeout 0
 *  is no substitute. The yields precede the stop checks on runBatch's path and on measureClaudeVersion's. launchRun's own
 *  pre-spawn check is kept for direct callers of that exported function, who pass no yield: a direct caller that wants a
 *  pending signal seen must yield itself (D-5984). */
async function yieldToSignals() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/** Refuse `interrupted` while the stopping flag is set. Six call sites: each runBatch lane iteration (after a yield and the
 *  re-read), runBatch's last act (after its lanes), launchRun before runChild, launchRun's post-close branch,
 *  measureClaudeVersion (after a yield), and step 0a right after its `--version` returns. So no spawn starts after the
 *  handler has run, and after the handler has run no run.json, step0a.json or probe.json is written. A run whose
 *  post-close stretch is under way when a signal arrives is recorded (its run.json is written), and the subcommand then
 *  refuses at its next check. A signal that arrives after runBatch's last check is not answered (the post-last-check
 *  window, named in the header above). A run stopped in flight is still charged once, by its spend line. */
function refuseIfStopping() {
  if (stopping !== null) refuse('interrupted', `${stopping} received; no spawn starts after this, and no run.json, step0a.json or probe.json is written`);
}

/** `spawn` as a registered group leader: not unref'd, the caller's stdio. The registry drops the entry at 'close', and only
 *  when it is still THIS child's (see liveChildren). It does not drop it on 'error': a child with a pid that reports an
 *  error (a failed kill, say) may still be running, and a stop must still signal its group. A child with no pid (the
 *  spawn failed) is never registered.
 *
 *  The wait after the leader is bounded (D-5984). 'close' fires only when every stdio pipe has closed, so a process that
 *  outlives the leader and holds one of them would hold the run, the lock and every signal's answer with it. When the
 *  leader's 'exit' fires, a STOP_GRACE_MS timer starts and 'close' clears it. If it fires it SIGKILLs the leader's group
 *  (only processes still in the run's group: a live member keeps the group allocated) and destroys the child's stdin,
 *  stdout and stderr streams that exist (runChild's stdout is the `.part`'s descriptor, so `child.stdout` is null there).
 *  Node then emits 'close' with the exit's code and signal and the run finishes as on close. What can be cut is what a
 *  process writes to a pipe after the leader's exit and is still unread when the timer fires. For runChild that is
 *  stderr only: its stdout is the `.part`'s descriptor, and the leader's own stderr is in the pipe at its exit and read
 *  well before the timer fires. For measureClaudeVersion, whose stdout is a pipe too, stdout still unread when the timer
 *  fires (written by a grandchild after the leader's exit) is cut as well; the version line the leader wrote before its
 *  exit is read. The SIGKILL is skipped when the registry no longer holds this child (a reaped child's pid may have been
 *  reused by a sibling group leader within the grace). A residual, named: when the run's group has emptied (a setsid
 *  grandchild left it) and the leader's pid was reused by an unrelated process that leads a group, the SIGKILL reaches
 *  that group, here and in the stop's and the timeout's kills; it needs a pid wrap within the grace, and the registry
 *  check catches a reuse only by our own sibling. The timer is NOT unref'd: when a grandchild holds a pipe the pipe's
 *  handle keeps the loop alive anyway, and a ref'd timer is what guarantees it fires; it is cleared at 'close', so it
 *  never holds a finished run. */
function spawnGroup(launcher, argv, options) {
  const child = spawn(launcher, argv, { ...options, detached: true });
  const pid = child.pid;
  if (typeof pid === 'number') {
    liveChildren.set(pid, child);
    let bound = null;
    // Node emits 'exit' before 'close' for a child with a pid ('close' waits for the exit and for every readable stdio
    // pipe), so the timer is always started before 'close' clears it.
    child.once('exit', () => {
      bound = setTimeout(() => {
        // The group is killed only while the registry still holds THIS child: a reaped child's pid may be reused by a
        // sibling group leader within the grace, and that sibling's group is not this run's to kill. The streams are
        // destroyed either way.
        if (liveChildren.get(pid) === child) signalGroup(pid, 'SIGKILL');
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
      }, STOP_GRACE_MS);
    });
    child.once('close', () => {
      if (bound !== null) clearTimeout(bound);
      if (liveChildren.get(pid) === child) liveChildren.delete(pid);
    });
  }
  return child;
}

// ── main ──────────────────────────────────────────────────────────────────
/** The pane first, then the grammar, then the handler. A refusal is one stderr line and EXIT.REFUSED; anything else
 *  thrown is a defect, one stderr line and EXIT.INTERNAL. Nothing is written to stdout here.
 *  @param {string[]} argv  @param {DriverEnv} env  @returns {Promise<number>} */
export async function main(argv, env) {
  stopping = null;   // D-5984: in-process callers (the tests) run main many times
  /** @type {Array<[string, () => void]>} */
  const installed = STOP_SIGNALS.map((sig) => [sig, () => onStopSignal(sig)]);
  try {
    const pane = paneRefusal(env);
    if (pane !== null) throw pane;
    process.umask(0o077);   // W2-D53: before any filesystem act, so every file and directory under --out is the operator's alone
    const { sub, flags } = parseArgs(argv);
    const handler = /** @type {(flags: Flags, env: DriverEnv) => Promise<number>} */ (HANDLERS.get(sub));
    for (const [sig, fn] of installed) process.on(sig, fn);   // D-5984: a signal stops the children's groups; it never exits the driver
    return await handler(flags, env);
  } catch (e) {
    if (e instanceof DriverRefusal) {
      process.stderr.write(`ccrc history-replay: ${e.word}: ${e.detail}\n`);
      return EXIT.REFUSED;
    }
    process.stderr.write(`ccrc history-replay: internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return EXIT.INTERNAL;
  } finally {
    for (const [sig, fn] of installed) process.off(sig, fn);
  }
}

// ── W2-4 Task 2: the --out directory (W2-D53; spec §10.2 "It writes only under --out, which it creates 0700 under
// umask 077" and "It refuses an --out inside a git tree"; pin RP4) ───────────────────────────────────────────────
// Every file the driver writes lands under --out, and --out holds one W2 run's transcripts and scores, which are
// private (§4 of the W2 decisions: only hashes and counts go public). So the directory is the operator's and the
// driver's alone: created 0700 under main's umask 077, marked with OUT_MARKER holding exactly OUT_KIND, and reused
// only when it is still exactly that. Reuse is what lets a stopped batch resume (W2-D53, W2-D55): finished runs are
// skipped. Nothing in the tree removes it; it is shared/lifecycle.ts's history-replay-out row (O, collector null):
// removed by hand once the W2 decision is recorded (W2-D9).
//   - A git tree is refused wherever it is found, at any depth above --out: a `.git` entry of ANY type, so a
//     worktree's `.git` file counts as a repository's directory does. The walk starts from the realpath of the
//     nearest ancestor that exists, because --out may not exist yet.
//   - An lstat that fails with anything but ENOENT is UNMEASURED, and unmeasured refuses: it is never read as
//     "outside" (an unreadable ancestor may hold the `.git` the walk cannot see).
//   - Never a recursive create: the parent is the operator's to make, so a typo cannot grow a tree.
export const OUT_MARKER = '.ccrc-history-replay';
export const OUT_KIND = 'ccrc-history-replay-out';
/** A marker longer than this is not one the driver wrote: the bound on the one read of it. The bound has no observable
 *  outcome of its own (an oversized marker refuses `marker-mismatch` whether or not the read is bounded), so no mutant of
 *  it can red a test (D-5814). */
const OUT_MARKER_MAX_BYTES = 64;

const errCode = (e) => String(e?.code ?? 'unknown');

/** Whether `p`, or the nearest of its ancestors that exists, sits inside a git tree. */
export function insideGitTree(p) {
  let cur = path.resolve(p);
  for (;;) {
    try { lstatSync(cur); break; } catch (e) {
      if (e?.code !== 'ENOENT') return { state: 'unmeasured', at: cur, code: errCode(e) };
    }
    const up = path.dirname(cur);
    if (up === cur) return { state: 'unmeasured', at: cur, code: 'ENOENT' };
    cur = up;
  }
  let dir;
  try {
    const real = realpathSync(cur);
    dir = lstatSync(real).isDirectory() ? real : path.dirname(real);   // an existing file: its own directory
  } catch (e) {
    return { state: 'unmeasured', at: cur, code: errCode(e) };
  }
  for (;;) {
    const dotGit = path.join(dir, '.git');
    try { lstatSync(dotGit); return { state: 'inside', at: dir }; } catch (e) {
      if (e?.code !== 'ENOENT') return { state: 'unmeasured', at: dotGit, code: errCode(e) };
    }
    const up = path.dirname(dir);
    if (up === dir) return { state: 'outside' };
    dir = up;
  }
}

/** Make or reuse --out, and answer its realpath; refuse out-refused with a detail naming the one rule it broke. */
export function prepareOut(out, uid = process.getuid()) {
  if (typeof out !== 'string' || !path.isAbsolute(out)) refuse('out-refused', 'relative');
  const abs = path.resolve(out);   // no trailing slash, so lstat never follows a symlink named `link/`
  let pre;
  try { pre = lstatSync(abs).isSymbolicLink() ? 'symlink' : 'present'; } catch (e) {
    pre = e?.code === 'ENOENT' ? 'absent' : 'unmeasured';   // unmeasured: insideGitTree answers it below, at abs
  }
  if (pre === 'symlink') refuse('out-refused', 'symlink');
  const git = insideGitTree(abs);
  if (git.state === 'inside') refuse('out-refused', `in-git-tree ${git.at}`);
  if (git.state === 'unmeasured') refuse('out-refused', `git-unmeasured ${git.at} ${git.code}`);
  if (pre === 'absent') createOut(abs);
  return checkOut(abs, uid);
}

/** A missing --out: its parent must already be a directory. 0700 under main's umask 077, then the marker. */
function createOut(abs) {
  // insideGitTree has measured every ancestor: one it could not lstat refused above, so a failure here is absence.
  let parentIsDir = false;
  try { parentIsDir = statSync(path.dirname(abs)).isDirectory(); } catch { parentIsDir = false; }
  if (!parentIsDir) refuse('out-refused', 'parent-absent');
  // D-5986: a failure to make --out, or to write its marker, refuses `out-refused` with the errno, never a raw exit 1: a parent
  // nobody may write into reaches the mkdir's EACCES every time, and two drivers making the same fresh --out meet EEXIST.
  try {
    mkdirSync(abs, { mode: 0o700 });
  } catch (e) {
    refuse('out-refused', `create-failed ${errCode(e)}`);
  }
  try {
    writeFileSync(path.join(abs, OUT_MARKER), OUT_KIND, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    refuse('out-refused', `marker-unwritable ${errCode(e)}; --out was created: remove it before a re-run`);   // D-5986: nothing in the tree removes --out
  }
}

/** The reuse rule, which a directory just created passes through too: a real directory, the caller's, mode exactly
 *  0700, holding the marker with exactly OUT_KIND. */
function checkOut(abs, uid) {
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) refuse('out-refused', 'symlink');
  if (!st.isDirectory()) refuse('out-refused', 'not-directory');
  if (st.uid !== uid) refuse('out-refused', 'foreign-owner');
  const mode = st.mode & 0o7777;
  if (mode !== 0o700) refuse('out-refused', `mode ${mode.toString(8).padStart(4, '0')}`);
  // D-5986: one bounded, type-checked read (lstat, no-follow non-blocking open, fstat). Absent is marker-absent; a marker
  // that is not a regular file, is over the bound, cannot be read back or holds other bytes is not one the driver wrote.
  const read = readPlain(path.join(abs, OUT_MARKER), OUT_MARKER_MAX_BYTES);
  if (read.state === 'absent') refuse('out-refused', 'marker-absent');
  if (read.state !== 'bytes' || read.bytes.toString('utf8') !== OUT_KIND) refuse('out-refused', 'marker-mismatch');
  return realpathSync(abs);
}

// ── W2-4 Task 3: account admission from the roster, before any spawn (W2-D52; spec §10.2 "Account and budget"; RP3, RP9) ─
// The driver reads $HOME/.ccrc/accounts.json ONCE, validates it with shared/roster-json.mjs's rosterFromJson, and reads
// exec.kind, exec.provider and hidden from that same parsed object: rosterFromJson validates provider and hidden but
// returns neither, and shared/ is not edited for this (W2-D52). Admission is an ALLOW-LIST: `upstream`, and `generated`
// whose provider is 'anthropic'. The provider is the one the roster's own reader answers: a `generated` account with
// no declared provider reads as 'anthropic', the default parseRoster and rosterFromJson apply (coordinator ruling).
// Every other kind is refused whatever it declares (the gateway lanes are `external`, so a deny-list keyed on codex or
// openai would fail open), and an `external` account with no declared provider stays refused by its kind.
// A generated account's token comes only from its declared secretsFile, which its ccrc-generated wrapper sources
// behind `[ -r "$HOME/<secretsFile>" ]`. This code stats that path as the test does (following a symlink), keeps a
// directory apart, checks R_OK, and never opens it. A Claude Code config dir's own OAuth file is never named or read
// here (RP9). The launch path and the config dir come from the roster: generated launches $HOME/.local/bin/<id>, its
// own wrapper; upstream launches $HOME/.local/bin/<roster upstreamId>, and its config dir must be exactly
// $HOME/.claude. Task 8's subcommands call both before any spawn, for the arms, the writer and the judge alike.

/** Reads $HOME/.ccrc/accounts.json once and validates it. Answers the parsed object and its validation; throws
 *  DriverRefusal('roster-invalid', …) with 'absent', 'unreadable <code>', 'not-json' or RosterInvalid's message. */
export function readRoster(home) {
  let text;
  try {
    text = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') refuse('roster-invalid', 'absent');
    refuse('roster-invalid', `unreadable ${e?.code ?? 'unknown'}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    refuse('roster-invalid', 'not-json');
  }
  try {
    return { json, roster: rosterFromJson(json) };
  } catch (e) {
    if (e instanceof RosterInvalid) refuse('roster-invalid', e.message);
    throw e;
  }
}

/** The one account `id` admitted, as a LaunchSpec, or DriverRefusal('account-refused', <detail>). `json` and `roster`
 *  are one readRoster result; an account the two disagree on is a caller defect (TypeError, exit 1). */
export function admitAccount(json, roster, id, home) {
  const acct = roster.accounts.find((a) => a.id === id);
  if (acct === undefined) refuse('account-refused', 'unknown-id');
  const raw = json.accounts.find((a) => a.id === id);
  if (raw === undefined || raw.exec.kind !== acct.execKind) {
    throw new TypeError(`admitAccount: the parsed roster and its validation disagree on account ${JSON.stringify(id)}`);
  }
  if (raw.hidden === true) refuse('account-refused', 'hidden');
  const kind = raw.exec.kind;
  if (kind === 'upstream') return admitUpstream(acct, roster, home);
  if (kind === 'generated') return admitGenerated(raw, acct, home);
  // The allow-list ends here: codex, external, and any kind a later roster adds, whatever provider they declare.
  refuse('account-refused', `kind-${kind}`);
}

/** upstream: the Claude Code binary the roster names, on exactly $HOME/.claude; no wrapper and no secrets file. */
function admitUpstream(acct, roster, home) {
  if (acct.configDirSuffix !== '.claude') refuse('account-refused', 'upstream-config-dir');
  return {
    accountId: acct.id, kind: 'upstream', launcher: join(home, '.local', 'bin', roster.upstreamId),
    configDir: join(home, acct.configDirSuffix), wrapperPath: null, secretsPath: null,
  };
}

/** generated: provider anthropic (declared, or absent and read as the roster's default) and a secretsFile this user
 *  can read; launched through its own wrapper. */
function admitGenerated(raw, acct, home) {
  // shared/roster.ts (parseRoster) and shared/roster-json.mjs (rosterFromJson) both read an absent provider on a
  // generated account as anthropic; admission reads the same provider the roster's reader answers (coordinator ruling).
  const provider = raw.exec.provider ?? 'anthropic';
  if (provider !== 'anthropic') refuse('account-refused', `provider-${provider}`);
  const secretsFile = raw.exec.secretsFile;
  if (secretsFile === undefined) refuse('account-refused', 'secrets-undeclared');
  const secretsPath = join(home, secretsFile);
  const why = secretsRefusal(secretsPath);
  if (why !== null) refuse('account-refused', why);
  const launcher = join(home, '.local', 'bin', acct.id);
  return {
    accountId: acct.id, kind: 'generated', launcher,
    configDir: join(home, acct.configDirSuffix), wrapperPath: launcher, secretsPath,
  };
}

/** What the wrapper's `[ -r … ]` folds into one false, kept apart; null when the file is regular and readable. The
 *  file is stat'ed and access-checked, never opened. */
function secretsRefusal(p) {
  let st;
  try {
    st = statSync(p);
  } catch (e) {
    return e?.code === 'ENOENT' || e?.code === 'ENOTDIR' ? 'secrets-absent' : 'secrets-unreadable';
  }
  if (!st.isFile()) return 'secrets-not-regular';
  try {
    accessSync(p, constants.R_OK);
  } catch {
    return 'secrets-unreadable';
  }
  return null;
}

// ── W2-4 Task 4: spawned text, the stream-json reader and the spend ledger (W2-D54, W2-D51, W2-D55) ─────────────
// Three small pieces the spawns (Task 5) and the reconstruction (W2-5a) need.
// (a) Spawned text (W2-D54). A field whose stored raw_len is over lib's decode cap is DISCARDED: never truncated and
//     never decoded; the caller drops its boundary or candidate. Every other field passes WHOLE through lib's
//     redactField, over the pair index the caller builds once per run (W2-5a passes the CLI's index), and only the
//     redacted text is cut to TOOL_RESULT_CUT code points. A cut first would leave a secret's head, which no
//     (length, sha256) pair matches. Lib's display-window redaction is never called here, and a scan pins that this
//     file never names it.
// (b) The stream-json reader (W2-D51). One pass over the lines of `--output-format stream-json --verbose`, and never a
//     throw: a line that is not a JSON object is counted in malformedLines. An init field the stream did not carry reads
//     null, never [], because absent and empty are two facts. Usage is the result event's when it carries one; otherwise
//     it is the assistant messages' usage, taken once per message.id, because Claude Code repeats a message's id and
//     usage on each content-block event.
// (c) The spend ledger (W2-D55). One canonical-JSON line per finished spawn, appended under --out. It is append-only
//     and summed over EVERY line, never de-duplicated by name: a re-run's spend adds to the total, because both
//     spawns spent. A finished job is never re-spawned, so a double count needs a kill inside one of three windows
//     (the spend line to the rename; the rename to the run.json; a leftover's charge to its `.part`'s removal; D-5811,
//     D-5984), and over-counting is the safe direction for a budget. A ledger that cannot be read
//     whole fails closed as out-refused (spentSoFar names which of four), never as 0 and never as budget-exhausted.

/** The most code points of a tool_result a spawn's input carries (spec §10.2, reconstruction item 2). */
export const TOOL_RESULT_CUT = 4000;

/** One stored field for a spawn's input (W2-D54): discarded over the decode cap, otherwise redacted whole.
 *  @param {{ text: string, rawLen: number }} field the field's text and its stored raw_len
 *  @param {import('../ccd/history/lib.mjs').PairIndex} idx the run's pair index, built once by the caller
 *  @returns {{ state: 'text', text: string } | { state: 'discard', why: 'over-decode-cap' }} */
export function redactForSpawn(field, idx) {
  if (blobOverDecodeCap(field.rawLen)) return { state: 'discard', why: 'over-decode-cap' };
  return { state: 'text', text: redactField(field.text, idx) };
}

/** The first TOOL_RESULT_CUT code points of text that redactForSpawn has already redacted. A surrogate pair is
 *  never split.
 *  @param {string} redacted
 *  @returns {string} */
export function cutToolResult(redacted) {
  let count = 0;
  let end = 0;
  for (const ch of redacted) {
    if (count === TOOL_RESULT_CUT) return redacted.slice(0, end);
    count += 1;
    end += ch.length;
  }
  return redacted;
}

/** A tool_result for a spawn's input, in W2-D54's order: redacted whole first, then cut.
 *  @param {{ text: string, rawLen: number }} field
 *  @param {import('../ccd/history/lib.mjs').PairIndex} idx
 *  @returns {{ state: 'text', text: string } | { state: 'discard', why: 'over-decode-cap' }} */
export function toolResultText(field, idx) {
  const r = redactForSpawn(field, idx);
  return r.state === 'text' ? { state: 'text', text: cutToolResult(r.text) } : r;
}

/** A JSON value redacted as a VALUE (D-6308): every string leaf, and every object key, through lib's redactFinalJson (the
 *  field pass and then the final belt, per string), the structure rebuilt around them, before anything serialises it. A
 *  secret that follows a newline in a tool_use input sits behind a JSON `\n` once the input is serialised (the `n`
 *  glues onto its run and no layer sees the value whole), so no site redacts text it has already serialised. W2-D54 holds:
 *  each string leaf IS the field, redactField still runs on every one before any cut, and redactFinal on top only adds.
 *  lib's redactFinalJson maps leaves and never touches object KEYS (a key is a field name fixed in code, there); a
 *  stored tool_use input's keys are data, so each key goes through it here too. Two keys that mask to one string
 *  collapse to the later value, which is the fail-closed direction. A value nested past the stack throws a RangeError,
 *  which renderOrNull's callers turn into a discard.
 *  @param {unknown} value  @param {import('../ccd/history/lib.mjs').PairIndex} idx  @returns {unknown} */
export function maskValue(value, idx) {
  if (typeof value === 'string') return redactFinalJson(value, idx);
  if (Array.isArray(value)) return value.map((v) => maskValue(v, idx));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [redactFinalJson(k, idx), maskValue(v, idx)]));
  }
  return value;
}

/** A stored body as lib's renderEntryText renders it, redacted as a value first (maskValue): the one way a body that is
 *  JSON (a tool_use input, a tool_result's block list or object content, an object body) becomes spawn text (D-6308).
 *  @param {unknown} body  @param {import('../ccd/history/lib.mjs').PairIndex} idx  @returns {string} */
export function renderMasked(body, idx) {
  return renderEntryText(maskValue(body, idx));
}

const sjObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sjList = (v) => (Array.isArray(v) ? [...v] : null);
const sjString = (v) => (typeof v === 'string' ? v : null);
const sjBool = (v) => (typeof v === 'boolean' ? v : null);
const sjCount = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);

/** A stream usage object as the four counts spend sums; a count that is not a non-negative integer reads 0. */
function sjUsage(u) {
  return {
    input: sjCount(u.input_tokens),
    cacheCreation: sjCount(u.cache_creation_input_tokens),
    cacheRead: sjCount(u.cache_read_input_tokens),
    output: sjCount(u.output_tokens),
  };
}

/** A tool_result's content as text: a string as it is, a block list as its text blocks joined by newlines, and
 *  null when it holds no text. */
function sjResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter((b) => sjObject(b) && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  return texts.length === 0 ? null : texts.join('\n');
}

/** @typedef {{ sessionId: string|null, model: string|null, tools: string[]|null, mcpServers: unknown[]|null,
 *    plugins: unknown[]|null, skills: unknown[]|null, slashCommands: string[]|null }} StreamInit */
/** @typedef {{ input: number, cacheCreation: number, cacheRead: number, output: number }} StreamUsage */
/** @typedef {{ id: string, name: string, input: unknown, result: string|null, isError: boolean|null,
 *    parentToolUseId: string|null }} ToolPair */
/** @typedef {{ id: string|null, parentToolUseId: string|null, usage: StreamUsage|null }} StreamMessage */
/** @typedef {{ init: StreamInit|null, usage: StreamUsage, usageSource: 'result'|'assistant'|'none', toolPairs: ToolPair[],
 *    permissionDenials: unknown[]|null, result: { subtype: string|null, isError: boolean|null, numTurns: number|null,
 *    text: string|null }|null, assistantMessages: number, malformedLines: number, firstCallUsage: StreamUsage|null,
 *    resultUsage: StreamUsage|null, assistantUsage: StreamUsage, messages: StreamMessage[] }} StreamFacts */

/** What one spawn's stream-json says (W2-D51). Never throws.
 *  @param {string} text the whole stream
 *  @returns {StreamFacts} */
export function readStreamJson(text) {
  let init = null;
  let result = null;
  let resultUsage = null;
  let permissionDenials = null;
  let malformedLines = 0;
  const messages = new Map();   // message.id, or a fresh Symbol for a message with none -> its usage, or null
  const pairs = new Map();      // tool_use id -> its pair, in first-seen order
  const parents = new Map();    // message key -> the parent_tool_use_id its first event carried (W2-5b1 Task 1)
  for (const line of String(text).split('\n')) {
    if (line.trim() === '') continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }
    if (!sjObject(ev)) {
      malformedLines += 1;
      continue;
    }
    if (ev.type === 'system' && ev.subtype === 'init') {
      if (init === null) {
        init = {
          sessionId: sjString(ev.session_id), model: sjString(ev.model), tools: sjList(ev.tools),
          mcpServers: sjList(ev.mcp_servers), plugins: sjList(ev.plugins), skills: sjList(ev.skills),
          slashCommands: sjList(ev.slash_commands),
        };
      }
    } else if (ev.type === 'assistant' && sjObject(ev.message)) {
      const msg = ev.message;
      // W2-5b1 Task 1 (W2-D82, W2-D58, Q7, Q11): the event's parent_tool_use_id, the Agent tool_use a subagent's events
      // name; null on the main thread, and for a value that is not a string, as every field here reads.
      const parent = sjString(ev.parent_tool_use_id);
      const key = typeof msg.id === 'string' ? msg.id : Symbol('a message without an id');
      if (!parents.has(key)) parents.set(key, parent);
      if (sjObject(msg.usage)) messages.set(key, sjUsage(msg.usage));
      else if (!messages.has(key)) messages.set(key, null);
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (sjObject(b) && b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string' && !pairs.has(b.id)) {
          pairs.set(b.id, { id: b.id, name: b.name, input: b.input ?? null, result: null, isError: null, parentToolUseId: parent });
        }
      }
    } else if (ev.type === 'user' && sjObject(ev.message) && Array.isArray(ev.message.content)) {
      for (const b of ev.message.content) {
        if (!sjObject(b) || b.type !== 'tool_result') continue;
        const pair = pairs.get(b.tool_use_id);
        if (pair === undefined) continue;   // a result with no tool_use in this stream pairs nothing
        pair.result = sjResultText(b.content);
        pair.isError = sjBool(b.is_error);
      }
    } else if (ev.type === 'result') {
      result = {
        subtype: sjString(ev.subtype), isError: sjBool(ev.is_error),
        numTurns: Number.isSafeInteger(ev.num_turns) ? ev.num_turns : null, text: sjString(ev.result),
      };
      resultUsage = sjObject(ev.usage) ? sjUsage(ev.usage) : null;
      permissionDenials = sjList(ev.permission_denials);
    }
  }
  // W2-5b1 Task 1 (Q7): every assistant message's usage, summed once per message, subagent messages included. `usage`
  // stays W2-4's reading (the result event's, else this sum); spend charges the larger of the two (spendTokens).
  let assistantUsage = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  let messageUsageSeen = false;
  for (const u of messages.values()) {
    if (u === null) continue;
    messageUsageSeen = true;
    assistantUsage = {
      input: assistantUsage.input + u.input, cacheCreation: assistantUsage.cacheCreation + u.cacheCreation,
      cacheRead: assistantUsage.cacheRead + u.cacheRead, output: assistantUsage.output + u.output,
    };
  }
  let usage = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  let usageSource = 'none';
  if (resultUsage !== null) {
    usage = resultUsage;
    usageSource = 'result';
  } else if (messageUsageSeen) {
    usage = { ...assistantUsage };
    usageSource = 'assistant';
  }
  // W2-5a Task 6: the FIRST call's usage, which the fidelity pilot's replay side reads (spec §10.2: "first-call input
  // tokens"). It is the first message the stream showed, by first-seen message id, with the last usage its events
  // carried. When that message carried none it is null, never a later message's usage.
  const firstKey = messages.keys().next();
  const firstCallUsage = firstKey.done ? null : messages.get(firstKey.value);
  return {
    init, usage, usageSource, toolPairs: [...pairs.values()], permissionDenials, result,
    assistantMessages: messages.size, malformedLines, firstCallUsage,
    resultUsage, assistantUsage,
    // W2-5b1 Task 1: each message in first-seen order, with the parent its first event named and its last usage.
    messages: [...messages.keys()].map((k) => ({
      id: typeof k === 'string' ? k : null, parentToolUseId: parents.get(k) ?? null, usage: messages.get(k) ?? null,
    })),
  };
}

/** A usage's token-equivalents (W2-D55): input + cache_creation + cache_read + output; a null usage is 0.
 *  @param {StreamUsage|null} u  @returns {number} */
export function usageTokens(u) {
  return u === null ? 0 : u.input + u.cacheCreation + u.cacheRead + u.output;
}

/** One spawn's spend in token-equivalents (W2-D55), charged fail-closed (Q7; decisions §7's C6): the larger of the result
 *  event's usage and the sum of every assistant message's usage, subagent messages included, so an Agent subagent's
 *  spend that the result usage leaves out is still charged, whatever the pilot later measures. Every charge site calls
 *  this (launchRun and settleLeftover). An over-count is the budget's safe direction.
 *  @param {StreamFacts} facts
 *  @returns {number} */
export function spendTokens(facts) {
  return Math.max(usageTokens(facts.resultUsage), usageTokens(facts.assistantUsage));
}

// ── D-5986: no-follow, type-checked I/O under --out ────────────────────────────────────────────────────────
// The paths the driver reads or writes under a (reused) --out go through these, so a symlink, a FIFO or a directory
// planted there refuses `out-refused` (or is read as the caller's own bad state) and never follows a link or blocks.
// Reads: lstat, then open O_RDONLY|O_NOFOLLOW|O_NONBLOCK, fstat isFile, then a bounded read. Appends open
// O_WRONLY|O_APPEND|O_CREAT|O_NOFOLLOW. Every other write is an exclusive create (O_EXCL|O_NOFOLLOW): a tmp file and then a
// rename or a link, or the `.part`, which the child writes in place. A failure to read, list, create or write at the sites
// below refuses `out-refused` with the path relative to --out and a cause (`<rel> unreadable <code>`, `<rel> unwritable
// <code>`, or the type refusals): an --out holder can make each happen, and a raw errno is not a W2 stop word. Covered: the
// reads and the claim walk (readPlain, lstatOrNull, refuseLinkedDirs, leftoverNames); the appends (appendPlain); the
// creates and writes (createPlain, writePlain, ensurePlainDir); the removals and renames of the run's own bookkeeping
// (removePlain in settleLeftover, createPlain and launchRun; the lock's link, rename and put-back in takeLock; launchRun's
// `.part` rename); and prepareOut's creation of --out (its mkdir `create-failed <code>`, its marker write
// `marker-unwritable <code>`, with the instruction to remove --out). A removal that fails AFTER the spend line leaves the
// `.part`, which the next driver charges again (an over-count). Not covered, each for a stated reason: runChild's
// child-error removals (a spawn that produced no child; a refusal there would hide the spawn error that got it there); the
// best-effort removals, which use `dropQuietly` so that a failed removal never becomes the answer, either on a path that is
// already refusing or after the work is done (writePlain's tmp cleanups; takeLock's stale and tmp removals; the claim's
// release). Still a raw error and exit 1, each only through a race: prepareOut's checkOut lstat (--out removed between
// prepareOut's lstat and checkOut's) and its realpath (the same removal, a step later). Not under --out, each answering its
// own state or refusal: the reads outside --out (/proc, the roster, the release stamp, the wrapper, the gate_code files).
// readPlain's O_NONBLOCK is reached only through a race too (a regular file swapped for a FIFO between the lstat and the
// open), but it never exits 1: the open passes and the fstat answers not-regular. The marker's read, and HOME's limits row,
// go through readPlain.

/** The largest ledger or stream the driver reads back. */
const OUT_STREAM_CAP = 256 * 1024 * 1024;
/** The largest run.json, or --step0a input, the driver reads. */
const OUT_JSON_CAP = 16 * 1024 * 1024;

/** Read the regular file at `p`, whole and no larger than `cap` bytes.
 *  - `{state: 'absent'}` when nothing is there (ENOENT at the lstat, or at the open if it went in between);
 *  - `{state: 'bytes', bytes}`;
 *  - `{state: 'bad', why}` with `why` `not-regular` (a directory, a link, a FIFO, a device, or a file that changed type
 *    between the lstat and the open), `over-cap` (answered from the descriptor's size before any read; the read loop's own
 *    bound stays for a file that grew after the fstat), or `unreadable` with the errno in `code`.
 *  Nothing but a regular file is ever opened for read.
 *  @param {string} p  @param {number} cap  @param {boolean} [follow] W2-D69: follow a link to what it names, as Claude Code reads a CLAUDE.md, still opening nothing but a regular file and never blocking on a FIFO (O_NONBLOCK). Every --out read leaves it false.
 *  @returns {{state: 'absent'} | {state: 'bytes', bytes: Buffer} | {state: 'bad', why: 'not-regular' | 'over-cap' | 'unreadable', code?: string}} */
function readPlain(p, cap, follow = false) {
  const unreadable = (e) => ({ state: 'bad', why: 'unreadable', code: String(e?.code ?? 'EUNKNOWN') });
  let st;
  try {
    st = follow ? statSync(p) : lstatSync(p);
  } catch (e) {
    return e?.code === 'ENOENT' ? { state: 'absent' } : unreadable(e);
  }
  if (!st.isFile()) return { state: 'bad', why: 'not-regular' };
  let fd;
  try {
    fd = openSync(p, constants.O_RDONLY | (follow ? 0 : constants.O_NOFOLLOW) | constants.O_NONBLOCK);
  } catch (e) {
    if (e?.code === 'ENOENT') return { state: 'absent' };
    if (e?.code === 'ELOOP') return { state: 'bad', why: 'not-regular' };
    return unreadable(e);
  }
  try {
    const fst = fstatSync(fd);
    if (!fst.isFile()) return { state: 'bad', why: 'not-regular' };   // replaced between the lstat and the open
    // D-5986: a file already past the cap is answered from the descriptor's size, before anything is read, so it is never
    // held in memory. The up-front answer and the loop's give the same outcome, so this half is observable only as memory.
    if (fst.size > cap) return { state: 'bad', why: 'over-cap' };
    const chunks = [];
    const buf = Buffer.alloc(Math.min(cap + 1, 1 << 20));
    let total = 0;
    for (;;) {
      const got = readSync(fd, buf, 0, buf.length, null);
      if (got === 0) break;
      total += got;
      if (total > cap) return { state: 'bad', why: 'over-cap' };   // for a file that grew after the fstat
      chunks.push(Buffer.from(buf.subarray(0, got)));
    }
    return { state: 'bytes', bytes: Buffer.concat(chunks) };
  } catch (e) {
    return unreadable(e);
  } finally {
    closeSync(fd);
  }
}

/** The word a `bad` read carries in a refusal detail: the errno for an unreadable one, else its `why`. */
const badWord = (bad) => (bad.why === 'unreadable' ? bad.code : bad.why);

/** Write every byte of `bytes` to `fd`. */
function writeAll(fd, bytes) {
  let at = 0;
  while (at < bytes.length) at += writeSync(fd, bytes, at, bytes.length - at);
}

/** Remove `<out>/<rel>` (D-5986). A file already gone is fine; any other failure (a directory nobody may write into: EACCES)
 *  refuses `out-refused` `<rel> unwritable <code>`, never a raw errno. Use it where the removal is part of the run's own
 *  bookkeeping; a cleanup that must not mask the refusal in flight uses `dropQuietly`.
 *  @param {string} out  @param {string} rel */
function removePlain(out, rel) {
  try {
    rmSync(path.join(out, rel), { force: true });
  } catch (e) {
    refuse('out-refused', `${rel} unwritable ${errCode(e)}`);
  }
}

/** Best-effort removal, for a removal whose failure must never become the answer: a tmp or stale file on a path that is
 *  already refusing (writePlain's tmp cleanups, takeLock's refusals), and a file whose work is done (the released lock,
 *  the tmp file in takeLock's `finally`, the stale file after a successful takeover). `tree` also removes a directory
 *  with its contents (the run's cwd, D-5984).
 *  @param {string} p  @param {boolean} [tree] */
function dropQuietly(p, tree = false) {
  try {
    rmSync(p, { force: true, recursive: tree });
  } catch {
    // the answer in flight (a refusal, or the finished work's result) stands. A tmp left behind is replaced by the next
    // create (createPlain replaceStale); a stale file or a released lock left behind names a driver that is dead by the
    // next start and is taken over; a cwd left behind is a directory under the temp directory, outside --out.
  }
}

/** Append one line to `<out>/<rel>`: the file is opened O_WRONLY|O_APPEND|O_CREAT|O_NOFOLLOW|O_NONBLOCK (a FIFO with no
 *  reader fails ENXIO instead of blocking) and must still be a regular file by fstat; one write. A link, a FIFO or any
 *  other type there refuses `out-refused` `<rel> is not a regular file` and nothing is written; an open, fstat or write
 *  failure of any other kind (a ledger nobody may write: EACCES) refuses `out-refused` `<rel> unwritable <code>`, never a
 *  raw errno. Every caller records a spend BEFORE it removes the `.part` and `.pid` the spend belongs to, so a spend line
 *  that cannot be written leaves both in place for the next driver to charge.
 *  @param {string} out  @param {string} rel  @param {string} text */
function appendPlain(out, rel, text) {
  let fd;
  try {
    fd = openSync(path.join(out, rel), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  } catch (e) {
    if (e?.code === 'ELOOP' || e?.code === 'ENXIO' || e?.code === 'EISDIR') refuse('out-refused', `${rel} is not a regular file`);
    refuse('out-refused', `${rel} unwritable ${errCode(e)}`);
  }
  try {
    if (!fstatSync(fd).isFile()) refuse('out-refused', `${rel} is not a regular file`);
    writeAll(fd, Buffer.from(text, 'utf8'));
  } catch (e) {
    if (e instanceof DriverRefusal) throw e;
    refuse('out-refused', `${rel} unwritable ${errCode(e)}`);
  } finally {
    closeSync(fd);
  }
}

/** Create `<out>/<rel>` exclusively (O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW, mode set exactly by fchmod on the descriptor) and
 *  answer the open descriptor. An existing entry refuses `out-refused` `<rel> already exists`, with one exception when
 *  `replaceStale` is set: a REGULAR file there (a temp file an earlier driver of this pid left) is removed once and the
 *  create retried. The refusal text says what the lstat found: an entry that is not a regular file says `<rel> already
 *  exists and is not a regular file`; a regular file (met again on the retry, or without `replaceStale`) says `<rel>
 *  already exists`; nothing (it vanished: a race) says `<rel> changed while it was being created`. Any other failure to create
 *  (a directory nobody may write into: EACCES) refuses `out-refused` `<rel> unwritable <code>`, never a raw errno.
 *  @returns {number} */
function createPlain(out, rel, mode, replaceStale) {
  const p = path.join(out, rel);
  for (let attempt = 0; ; attempt++) {
    let fd;
    try {
      fd = openSync(p, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    } catch (e) {
      if (e?.code !== 'EEXIST' && e?.code !== 'ELOOP') refuse('out-refused', `${rel} unwritable ${errCode(e)}`);
      const st = lstatOrNull(out, rel);
      if (replaceStale && attempt === 0 && st !== null && st.isFile()) { removePlain(out, rel); continue; }   // D-5986: a stale tmp nobody may remove refuses
      // D-5986: the text says what the lstat found. Only a race reaches the first two (nothing there, or a regular file met again).
      refuse('out-refused', st === null ? `${rel} changed while it was being created`
        : st.isFile() ? `${rel} already exists` : `${rel} already exists and is not a regular file`);
    }
    fchmodSync(fd, mode);
    return fd;
  }
}

/** Write `bytes` to the descriptor of an exclusively created tmp file and close it. A failed write (a full disk, or a file-size
 *  limit: RLIMIT_FSIZE answers EFBIG, the seam the pins use) closes the descriptor, removes the tmp file quietly and
 *  refuses `out-refused` `<rel> unwritable <code>`, never a raw errno (D-5986). `rel` is the name the refusal
 *  gives: the target's, or for the lock the tmp file's own.
 *  @param {number} fd  @param {Buffer} bytes  @param {string} tmp the tmp file's path  @param {string} rel */
function writeWhole(fd, bytes, tmp, rel) {
  try {
    writeAll(fd, bytes);
  } catch (e) {
    dropQuietly(tmp);
    refuse('out-refused', `${rel} unwritable ${errCode(e)}`);
  } finally {
    closeSync(fd);
  }
}

/** Write `bytes` to `<out>/<rel>` whole: a target that exists and is not a regular file refuses `out-refused`; the bytes
 *  go to a tmp file `<rel>.tmp-<pid>` created exclusively, mode `mode`, then a rename, so no write follows a link.
 *  @param {string} out  @param {string} rel  @param {string | Buffer} bytes  @param {number} [mode] */
function writePlain(out, rel, bytes, mode = 0o600) {
  const p = path.join(out, rel);
  const have = lstatOrNull(out, rel);
  if (have !== null && !have.isFile()) refuse('out-refused', `${rel} is not a regular file`);
  const tmpRel = `${rel}.tmp-${process.pid}`;
  const tmp = path.join(out, tmpRel);
  const fd = createPlain(out, tmpRel, mode, true);
  writeWhole(fd, typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes, tmp, rel);
  try {
    renameSync(tmp, p);
  } catch (e) {
    dropQuietly(tmp);
    refuse('out-refused', `${rel} unwritable ${errCode(e)}`);
  }
}

/** Make sure every segment of `rel` under `out` is a real directory: an existing one must lstat as a directory (a link,
 *  dangling or not, or any other type refuses `out-refused` `<path so far> is not a directory`), a missing one is made
 *  0700, non-recursively; a mkdir that fails (a directory nobody may write into) refuses `out-refused`
 *  `<path so far> unwritable <code>`.
 *  @param {string} out  @param {string} rel */
function ensurePlainDir(out, rel) {
  let cur = out;
  let sofar = '';
  for (const seg of rel.split('/')) {
    cur = path.join(cur, seg);
    sofar = sofar === '' ? seg : `${sofar}/${seg}`;
    let st = lstatOrNull(out, sofar);
    if (st === null) {
      try {
        mkdirSync(cur, { mode: 0o700 });
        continue;
      } catch (e) {
        if (e?.code !== 'EEXIST') refuse('out-refused', `${sofar} unwritable ${errCode(e)}`);
        st = lstatOrNull(out, sofar);   // made by someone else between the lstat and the mkdir: judge what is there
        if (st === null) refuse('out-refused', `${sofar} changed while it was being created`);   // only a race reaches this
      }
    }
    if (!st.isDirectory()) refuse('out-refused', `${sofar} is not a directory`);
  }
}

/** Check-only walk of a run name's parent directories (D-5986): every EXISTING segment of dirname(`name`) under `out`
 *  must lstat as a directory (a link, dangling or not, or any other type refuses `out-refused`
 *  `<path so far> is not a directory`); a missing segment ends the walk, since nothing below it can exist. It makes
 *  nothing. Run it before any path under the name is read, listed, charged or removed, because O_NOFOLLOW protects only
 *  the last component of a path.
 *  @param {string} out  @param {string} name */
function refuseLinkedDirs(out, name) {
  const dir = path.dirname(name);
  if (dir === '.') return;
  let sofar = '';
  for (const seg of dir.split('/')) {
    sofar = sofar === '' ? seg : `${sofar}/${seg}`;
    const st = lstatOrNull(out, sofar);
    if (st === null) return;
    if (!st.isDirectory()) refuse('out-refused', `${sofar} is not a directory`);
  }
}

/** The spend ledger's file name under --out. */
export const SPEND_LEDGER = 'spend.jsonl';
/** A ledger line's keys, sorted as canonicalJson writes them. */
const SPEND_KEYS = 'name,tokens,ts_ms';

/** Append one finished spawn's spend to the ledger under `out`: one canonical-JSON line, in one write. A name or a
 *  count that spentSoFar could not read back is a defect, so it throws TypeError and writes nothing.
 *  @param {string} out the --out directory (prepareOut's realpath)
 *  @param {string} name the job's name, unique within --out
 *  @param {number} tokens spendTokens of its stream */
export function recordSpend(out, name, tokens) {
  if (typeof name !== 'string' || name === '') throw new TypeError(`recordSpend: a job name is a non-empty string, not ${JSON.stringify(name)}`);
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new TypeError(`recordSpend: a spend is a non-negative integer, not ${String(tokens)}`);
  appendPlain(out, SPEND_LEDGER, `${canonicalJson({ name, tokens, ts_ms: Date.now() })}\n`);   // D-5986: a link or a FIFO there refuses out-refused, nothing written
}

/** One ledger line as {name, tokens}, or null when it is not one recordSpend writes. */
function spendRow(line) {
  let v;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!sjObject(v) || Object.keys(v).sort().join(',') !== SPEND_KEYS) return null;
  if (typeof v.name !== 'string' || v.name === '') return null;
  if (!Number.isSafeInteger(v.tokens) || v.tokens < 0 || !Number.isSafeInteger(v.ts_ms) || v.ts_ms < 0) return null;
  return { name: v.name, tokens: v.tokens };
}

/** The cumulative spend under `out` (W2-D55): every line summed, a repeated name included (never de-duplicated:
 *  over-counting is the budget's safe direction). 0 when no ledger exists yet. A ledger the driver cannot read whole
 *  refuses `out-refused` (D-5986), with exactly one of `spend.jsonl is not a regular file`, `spend.jsonl unreadable <code>`,
 *  `spend.jsonl over-cap` and `spend.jsonl malformed` (a torn or foreign line, one recordSpend would not write, or lines that
 *  each read but sum past the safe-integer range): raising
 *  --budget clears none of these states, so `budget-exhausted` means only that spend has reached the budget. (Task 4
 *  answered all of them `budget-exhausted` `ledger-unreadable`.)
 *  @param {string} out
 *  @returns {number} */
export function spentSoFar(out) {
  const read = readPlain(`${out}/${SPEND_LEDGER}`, OUT_STREAM_CAP);   // D-5986: lstat, no-follow open, fstat, bounded read
  if (read.state === 'absent') return 0;
  if (read.state === 'bad') {
    if (read.why === 'not-regular') refuse('out-refused', `${SPEND_LEDGER} is not a regular file`);
    if (read.why === 'over-cap') refuse('out-refused', `${SPEND_LEDGER} over-cap`);
    refuse('out-refused', `${SPEND_LEDGER} unreadable ${read.code}`);
  }
  const text = read.bytes.toString('utf8');
  const rows = text.split('\n');
  if (rows.pop() !== '') refuse('out-refused', `${SPEND_LEDGER} malformed`);   // the last line was torn
  let sum = 0;
  for (const line of rows) {
    const row = spendRow(line);
    if (row === null) refuse('out-refused', `${SPEND_LEDGER} malformed`);
    sum += row.tokens;
    if (!Number.isSafeInteger(sum)) refuse('out-refused', `${SPEND_LEDGER} malformed`);   // D-5986: lines that each read but sum past the safe range
  }
  return sum;
}

// ── W2-4 Task 5: the spawn contract and the batch runner (W2-D50, W2-D51, W2-D53, W2-D55) ─────────────────────
// The ONE way this driver runs Claude Code (spec §10.2 "Two arms": Launch, Environment, cwd, Flags, Tools; the
// writer and the judge "go through the driver's spawn contract", SE10). Every spawn is `spawn(launcher, argv)`
// with an argv array and no shell, a FRESH env built by spawnEnv from the allow-list (never a copy of the
// driver's own), an empty 0700 cwd made per run outside any git tree and removed after it, and stdin as the only
// input. Arm values arrive as parameters, each a word taken by position from lib's RECALL_ARMS (CONTROL_ARM, TREATMENT_ARM):
// this file spells no arm word, and history-replay.test.ts's arm-word scan pins that (W2-D42).
// A run's files land under --out in a fixed order: the stream `<name>.jsonl.part` while the child runs, then the spend
// line in the ledger, then the rename to `<name>.jsonl`, then `<name>.run.json` via tmp + rename (D-5811). The run.json
// is the completion marker and comes LAST, so a run killed before it is spawned again on resume. Beside the `.part` the
// driver keeps `<name>.pid` while the child runs (D-5984): written right after spawn, removed right after the spend
// line. Three shapes of kill, three answers: a driver that died while its child ran leaves a `.part` and no run.json, a
// LEFTOVER that the next batch (or launchRun) settles before any gate reads it (settleLeftover, D-5984); a driver that
// died between the spend line and the rename leaves a `.part` that is charged again (an over-count); one that died
// between the rename and the run.json leaves a `.jsonl` and its ledger line, and the re-spawn's spend adds to it (an
// over-count). Over-counting is the budget's safe direction; a spawn the ledger never saw is the unsafe one. What the
// code does: a leftover whose writer is alive (its `.pid` record reads alive or unmeasured) refuses `run-live` and is
// never charged, removed or spawned again; a dead writer's `.part` is charged once and removed. The named residual
// windows are a driver killed between spawn() and its `.pid` record (the `.part` has no record and is charged as D-5811
// says, even if the child lives on), and a grandchild that calls setsid (it escapes every group kill and keeps running,
// and the bounded wait after the leader's exit, spawnGroup, no longer lets it hold the driver; if it inherited the
// run's stdout it can still write into the stream after the charge: a resume refuses the changed stream only for a
// recorded run, and after a stop or a leftover's charge, which removes the `.part`, its late writes go to an unlinked
// file that no batch sees, and a resume spawns the job again beside it; the leader, which spends, is dead when it is
// charged, outside the spawn-to-record window and a run-live remedy that removed an unmeasured writer's `.pid`, where a
// `.part` with no `.pid` is charged even if its leader lives on). The over-count windows are spend line to rename,
// rename to run.json, and a leftover's charge to its `.part`'s removal (the `.pid` goes first, then the `.part`). A run
// whose run.json exists is never spawned again (W2-D53, W2-D55).
// The child's LANG arrives as RunJob.lang, threaded from main's env: this section never reads process.env.

/** The four ways a run is spawned: an arm run (with the CCRC_RECALL_* values), the question writer, the judge,
 *  and a box-verb run (an arm's tools, no arm values: step 0a's third spawn and the probe). */
export const SPAWN_MODES = Object.freeze(['arm', 'writer', 'judge', 'box']);
/** `--restricted`, or the fallback the pilot records if `--restricted` drops the skill (W2-D57, spec §10.2 Flags). */
export const SETTINGS_MODES = Object.freeze(['restricted', 'fallback']);
/** The turn bound, `--max-turns 12` (spec §10.2 Flags). */
export const MAX_TURNS = 12;
/** A batch is at most 10 spawns (W2-D55; part 1's `limits.batch_max` default). */
export const BATCH_MAX = 10;
/** At most 2 runs at once (W2-D51; part 1's `limits.concurrency` default). */
export const CONCURRENCY_MAX = 2;
/** The poisoned `gh` lives here under --out, first on every child's PATH (the ghContainedEnv shape). */
export const POISON_BIN_DIR = 'poison-bin';

const RUN_TIMEOUT_MS = 1_800_000;
const KILL_GRACE_MS = 10_000;
const STDERR_KEEP_BYTES = 65_536;
const RUN_KIND = 'ccrc-history-replay-run';
const RUN_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63}){0,3}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const UNKNOWN_OPTION_RE = /unknown option ['"](-{1,2}[A-Za-z0-9][A-Za-z0-9-]*)['"]/g;
const POISON_GH = '#!/bin/sh\necho "ccrc history-replay: a replay run must never reach gh" >&2\nexit 97\n';
const SETTINGS_ARGV = Object.freeze({
  restricted: Object.freeze(['--restricted']),
  fallback: Object.freeze(['--setting-sources', 'project,local', '--settings', '{"disableAllHooks":true}']),
});

/** The three spellings the arms are taught, exactly (spec §10.2 Tools, SE9): the absolute path, the skill's and
 *  the card's. */
export function allowedToolSpellings(home) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw new TypeError(`allowedToolSpellings: home ${JSON.stringify(home)} is not absolute`);
  return Object.freeze([
    `Bash(${home}/.local/bin/ccrc history:*)`,
    'Bash("$HOME/.local/bin/ccrc" history:*)',
    'Bash(~/.local/bin/ccrc history:*)',
  ]);
}

/** The argv of one spawn: the settings argv, the fixed flags, the model, then the tools by mode. Input is never
 *  an argument: it goes on stdin. Pure.
 *  @param {{mode: string, model: string, settingsMode: string, home: string}} spec
 *  @returns {string[]} */
export function spawnArgv({ mode, model, settingsMode, home }) {
  if (!SPAWN_MODES.includes(mode)) throw new TypeError(`spawnArgv: mode ${JSON.stringify(mode)} is not one of ${SPAWN_MODES.join(', ')}`);
  if (!SETTINGS_MODES.includes(settingsMode)) throw new TypeError(`spawnArgv: settings mode ${JSON.stringify(settingsMode)} is not one of ${SETTINGS_MODES.join(', ')}`);
  if (typeof model !== 'string' || !MODEL_RE.test(model)) throw new TypeError(`spawnArgv: model ${JSON.stringify(model)} is not a model id`);
  const argv = [...SETTINGS_ARGV[settingsMode], '-p', '--no-session-persistence', '--strict-mcp-config',
    '--output-format', 'stream-json', '--verbose', '--max-turns', String(MAX_TURNS), '--model', model];
  if (mode === 'arm' || mode === 'box') argv.push('--tools', 'Bash,Agent', '--allowedTools', ...allowedToolSpellings(home));
  else argv.push('--tools', '');
  return argv;
}

/** The child's whole environment, built fresh (the `env -i` equivalent, W2-D50): HOME, the explicit PATH, LANG,
 *  the account's CLAUDE_CONFIG_DIR, and in arm mode only the three CCRC_RECALL_* values passed in, each one the seam takes
 *  (W2-5b1 Task 1: a session id lib's idOk takes, a RECALL_ARMS word, a lowercase UUID; any other is a TypeError). Pure.
 *  @param {{mode: string, home: string, configDir: string, poisonBin: string, lang: string | undefined,
 *    recall?: {session: string, arm: string, asof: string}}} spec
 *  @returns {Record<string, string>} */
export function spawnEnv({ mode, home, configDir, poisonBin, lang, recall }) {
  if (!SPAWN_MODES.includes(mode)) throw new TypeError(`spawnEnv: mode ${JSON.stringify(mode)} is not one of ${SPAWN_MODES.join(', ')}`);
  for (const [k, v] of [['home', home], ['configDir', configDir], ['poisonBin', poisonBin]]) {
    if (typeof v !== 'string' || !path.isAbsolute(v) || v.includes(':')) throw new TypeError(`spawnEnv: ${k} ${JSON.stringify(v)} is not an absolute path without ':'`);
  }
  const child = {
    HOME: home,
    PATH: `${poisonBin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
    LANG: typeof lang === 'string' && lang !== '' ? lang : 'C.UTF-8',
    CLAUDE_CONFIG_DIR: configDir,
  };
  if (mode !== 'arm') {
    if (recall !== undefined) throw new TypeError(`spawnEnv: a ${mode} run carries no CCRC_RECALL_* values`);
    return child;
  }
  const r = recall ?? {};
  for (const k of ['session', 'arm', 'asof']) {
    if (typeof r[k] !== 'string' || r[k] === '') throw new TypeError(`spawnEnv: an arm run needs recall.${k}, a non-empty string`);
  }
  // W2-5b1 Task 1 (W2-D50, W2-D42; RP1-arm): no arm run starts on a value the CLI would refuse (headless-arm-unknown,
  // asof-invalid) after a model was paid for. A caller that builds one has a defect, so it is a TypeError.
  if (!idOk(r.session)) throw new TypeError(`spawnEnv: recall.session ${JSON.stringify(r.session)} is not a session id`);
  if (!RECALL_ARMS.includes(r.arm)) throw new TypeError(`spawnEnv: recall.arm ${JSON.stringify(r.arm)} is not one of RECALL_ARMS`);
  if (!UUID_RE.test(r.asof)) throw new TypeError(`spawnEnv: recall.asof ${JSON.stringify(r.asof)} is not a lowercase UUID`);
  child.CCRC_RECALL_SESSION = r.session;
  child.CCRC_RECALL_ARM = r.arm;
  child.CCRC_RECALL_ASOF = r.asof;
  return child;
}

/** Plant (every call, as ghContainedEnv re-plants) the poisoned gh under --out and answer its directory. */
export function ensurePoisonBin(out) {
  ensurePlainDir(out, POISON_BIN_DIR);
  writePlain(out, `${POISON_BIN_DIR}/gh`, POISON_GH, 0o700);   // D-5986: a tmp file at 0700, then a rename: no write follows a planted link
  return path.join(out, POISON_BIN_DIR);
}

/** A fresh, empty 0700 directory under os.tmpdir(), outside any git tree: one run's cwd. */
export function makeRunCwd() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccrc-history-replay-')));
  const g = insideGitTree(dir);
  const st = lstatSync(dir);
  const bad = g.state === 'inside' ? `run-cwd-in-git-tree ${g.at}`
    : g.state === 'unmeasured' ? `run-cwd-git-unmeasured ${g.at} ${g.code}`
      : !st.isDirectory() || (st.mode & 0o777) !== 0o700 ? `run-cwd-mode ${(st.mode & 0o777).toString(8)}`
        : readdirSync(dir).length !== 0 ? 'run-cwd-not-empty' : null;
  if (bad !== null) {
    rmSync(dir, { recursive: true, force: true });
    refuse('out-refused', bad);
  }
  return dir;
}

/** HOME for a launch: the directory its config dir sits in. A roster configDirSuffix is one segment (shared/
 *  roster-json.mjs refuses a '/'), so this is exact; the launcher must sit under the same home. */
function runHomeOf(launch) {
  const home = path.dirname(launch.configDir);
  if (!launch.launcher.startsWith(path.join(home, '.local', 'bin') + path.sep)) {
    throw new TypeError(`launchRun: launcher ${launch.launcher} is not under ${home}/.local/bin`);
  }
  return home;
}

function runPaths(out, name) {
  if (typeof name !== 'string' || !RUN_NAME_RE.test(name)) throw new TypeError(`launchRun: run name ${JSON.stringify(name)} is not a run name`);
  // D-5803: a name whose stream file would be the spend ledger is refused, or the rename of the finished `.part` onto streamPath replaces it and the budget fails open.
  if (`${name}.jsonl` === SPEND_LEDGER) throw new TypeError(`launchRun: run name ${JSON.stringify(name)} would stream into the spend ledger ${SPEND_LEDGER}`);
  const streamPath = path.join(out, `${name}.jsonl`);
  return { streamPath, partPath: `${streamPath}.part`, pidPath: path.join(out, `${name}.pid`), runJsonPath: path.join(out, `${name}.run.json`) };
}

// ── D-5984, D-5985: liveness, the pid record, the leftover rules, the --out lock and the claim ──────────────
/** The start time of `pid` (field 22 of /proc/<pid>/stat, the decimal text after the last ')'), or null where it cannot
 *  be read (no /proc, a vanished pid, an unparsable line, or any read failure at the moment, which is not told apart
 *  from a missing /proc). A record's null start therefore means 'not measured when it was written', and liveness then
 *  falls back to kill(pid, 0). */
function procStart(pid) {
  let text;
  try {
    text = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return null;
  }
  return startOfStat(text);
}

/** Field 22 of a /proc/<pid>/stat line: the line's text after its LAST ')' starts at field 3, so it is token 19. */
function startOfStat(text) {
  const close = text.lastIndexOf(')');
  if (close < 0) return null;
  const field = text.slice(close + 1).trim().split(/\s+/)[19];
  return typeof field === 'string' && /^[0-9]+$/.test(field) ? field : null;
}

/** Whether the process a record names is still running: 'alive', 'dead' or 'unmeasured' (D-5984). With a recorded
 *  start, /proc/<pid>/stat answers: ENOENT is dead only where /proc itself answers (this process's own
 *  /proc/self/stat reads; where it does not, there is no /proc to tell dead from missing, and the answer is unmeasured), the
 *  same start is alive, another start (a reused pid) is dead, and any other read failure or an unparsable line is
 *  unmeasured. Without a start (the record's was not measured when it was written: no /proc, or a read that failed
 *  then), `kill(pid, 0)` answers: ESRCH is dead, success or EPERM is alive (a reused pid then reads alive, which errs
 *  toward refusing), anything else unmeasured. A pid that is no positive integer is unmeasured: callers refuse malformed
 *  records before they ask. Only the leader is asked: a process left in a dead leader's group is not seen (a named
 *  residual, D-5984). `procDir` is the test seam for /proc.
 *  @param {number} pid  @param {string | null} start  @param {string} [procDir]
 *  @returns {'alive' | 'dead' | 'unmeasured'} */
export function liveness(pid, start, procDir = '/proc') {
  if (!Number.isSafeInteger(pid) || pid < 1) return 'unmeasured';
  if (start !== null) {
    if (typeof start !== 'string') return 'unmeasured';
    let text;
    try {
      text = readFileSync(`${procDir}/${pid}/stat`, 'utf8');
    } catch (e) {
      if (e?.code !== 'ENOENT') return 'unmeasured';
      // D-5984: a missing /proc reads every pid as ENOENT, which is not 'dead'. Only a /proc that answers for this
      // very process can say a pid is gone.
      try {
        readFileSync(`${procDir}/self/stat`, 'utf8');
      } catch {
        return 'unmeasured';
      }
      return 'dead';
    }
    const now = startOfStat(text);
    if (now === null) return 'unmeasured';
    return now === start ? 'alive' : 'dead';
  }
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (e) {
    if (e?.code === 'ESRCH') return 'dead';
    return e?.code === 'EPERM' ? 'alive' : 'unmeasured';
  }
}

const PID_RECORD_MAX_BYTES = 4096;

/** A `{pid, start}` record's text, canonical JSON plus a newline: the shape of a run's `.pid` file and of the lock. */
function pidRecordText(pid) {
  return canonicalJson({ pid, start: procStart(pid) }) + '\n';
}

/** Parse a pid record file: exactly `{pid: positive integer, start: digit string | null}`, whole (records are written
 *  whole, so a malformed one is tampering). Read through readPlain (D-5986), so the answer tells the causes apart:
 *  `{state: 'record', pid, start}`; `{state: 'absent'}`; or `{state: 'bad', why}` with `why` `not-regular`, `unreadable`
 *  (with `code`) or `malformed` (over PID_RECORD_MAX_BYTES included).
 *  @returns {{state: 'record', pid: number, start: string | null} | {state: 'absent'} | {state: 'bad', why: 'not-regular' | 'unreadable' | 'malformed', code?: string}} */
function readPidRecord(file) {
  const read = readPlain(file, PID_RECORD_MAX_BYTES);
  if (read.state === 'absent') return read;
  if (read.state === 'bad') return read.why === 'over-cap' ? { state: 'bad', why: 'malformed' } : read;
  const malformed = { state: 'bad', why: 'malformed' };
  const text = read.bytes.toString('utf8');
  if (!text.endsWith('\n')) return malformed;
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return malformed;
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== 'pid,start') return malformed;
  if (!Number.isSafeInteger(v.pid) || v.pid < 1) return malformed;
  if (!(v.start === null || (typeof v.start === 'string' && /^[0-9]+$/.test(v.start)))) return malformed;
  return { state: 'record', pid: v.pid, start: v.start };
}

/** What a refusal says of a pid-record file that readPidRecord could not give: its type, its errno or its content.
 *  @param {string} label  @param {string} noun  @param {{why: string, code?: string}} bad */
function recordBadDetail(label, noun, bad) {
  if (bad.why === 'not-regular') return `${label} is not a regular file`;
  if (bad.why === 'unreadable') return `${label} is unreadable (${bad.code})`;
  return `${label} is not a ${noun}`;
}

/** Write a run's `<name>.pid` whole: a tmp file created exclusively, mode 0600, then a rename (writePlain, D-5986). */
function writePidRecord(out, name, pid) {
  writePlain(out, `${name}.pid`, pidRecordText(pid));
}

/** lstat `<out>/<rel>`, answering null for ENOENT. Every caller is under --out, so any other failure (unmeasured never
 *  reads as absent) refuses `out-refused` `<rel> unreadable <code>`, never a raw errno (D-5986).
 *  @param {string} out  @param {string} rel */
function lstatOrNull(out, rel) {
  try {
    return lstatSync(path.join(out, rel));
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    refuse('out-refused', `${rel} unreadable ${errCode(e)}`);
  }
}

/** D-5811, D-5984: settle the leftovers of one run name. The caller's walk does not look at the name's run.json
 *  (claimOut's walk settles every name that has a `.part` or a `.pid`, whatever its job, and a driver's own run leaves
 *  no `.part` beside a run.json; runBatch and launchRun call it only for a name whose run.json is absent). A `.part` is a
 *  spawn whose driver did not finish; its `<name>.pid` says whether its writer is still running. The cases:
 *   - `.part` and `.pid`, the writer alive or unmeasured: refuse `run-live`, charging, removing and spawning nothing;
 *   - `.part` and `.pid`, the writer dead: charge the `.part` once, remove the `.pid`, THEN the `.part` (a crash between
 *     leaves a `.part` with no `.pid`, charged again: an over-count, never a lone record);
 *   - `.part` with no `.pid`: charge and remove it (D-5811; the named residual window of a driver killed before its record);
 *   - a lone `.pid`: remove it;
 *   - a `.pid` that is not a regular file (a link, a FIFO, a directory, or a file that changed type before the open): refuse
 *     `out-refused` `<name>.pid is not a regular file`, and one that cannot be read (EACCES, EIO, or gone between the lstat
 *     and the read): refuse `out-refused` `<name>.pid unreadable <code>` (D-5986: the wrong type or a failed read under
 *     --out); a regular `.pid` that is not exactly `{pid, start}` (records are written whole, so it is tampering): refuse
 *     `run-live` naming it (D-5984);
 *   - a `.part` that is not a regular file, or one over OUT_STREAM_CAP (never read, so never charged): refuse `out-refused`
 *     (`run-stream-invalid <name>`). The over-cap case wedges the --out until the file is removed by hand, and its spend is
 *     then lost: a named residual (D-5811), not a distinct word.
 *  @param {string} out  @param {string} name  @param {typeof liveness} live */
function settleLeftover(out, name, live) {
  const { partPath, pidPath } = runPaths(out, name);
  refuseLinkedDirs(out, name);   // D-5986: before any path under the name is touched
  const part = lstatOrNull(out, `${name}.jsonl.part`);
  const pid = lstatOrNull(out, `${name}.pid`);
  if (part !== null && !part.isFile()) refuse('out-refused', `run-stream-invalid ${name}`);
  let rec = null;
  if (pid !== null) {
    const read = readPidRecord(pidPath);
    if (read.state !== 'record') {
      // The three cases (D-5984, D-5986): the wrong type, and a file that cannot be read (an ENOENT here: it went between the
      // lstat and the read), are failures under --out and refuse out-refused; a regular file whose content is not exactly
      // {pid, start} is tampering and refuses run-live, naming the file.
      if (read.state === 'absent') refuse('out-refused', `${name}.pid unreadable ENOENT`);
      if (read.why === 'not-regular') refuse('out-refused', `${name}.pid is not a regular file`);
      if (read.why === 'unreadable') refuse('out-refused', `${name}.pid unreadable ${read.code}`);
      refuse('run-live', `${recordBadDetail(`${name}.pid`, 'pid record', read)}; remove it only after confirming no Claude Code from this --out is running`);
    }
    rec = read;
  }
  if (part === null) {
    if (pid !== null) removePlain(out, `${name}.pid`);   // D-5986: a removal that fails refuses out-refused
    return;
  }
  if (rec !== null) {
    const state = live(rec.pid, rec.start);
    if (state !== 'dead') {
      // D-5984: the remedy keeps the charge. Removing the `.pid` ALONE sends the next driver down the no-record rule, which
      // charges the `.part` and removes it; removing both files would lose that run's tokens for good.
      refuse('run-live', `pid ${rec.pid} (process group ${rec.pid}) is ${state}; ${name}.jsonl.part and ${name}.pid are its. `
        + 'If the pid is confirmed not to be a live Claude Code from this --out (a reused pid, or a box with no /proc), '
        + `remove only the \`${name}.pid\`: the next driver then charges the \`${name}.jsonl.part\` and removes it. `
        + `Never remove the \`${name}.jsonl.part\`.`);
    }
  }
  const partRead = readPlain(partPath, OUT_STREAM_CAP);
  if (partRead.state !== 'bytes') refuse('out-refused', `run-stream-invalid ${name}`);
  recordSpend(out, name, spendTokens(readStreamJson(partRead.bytes.toString('utf8'))));
  // D-5986: the spend line is written, so a removal that fails below leaves the `.part` (and the `.pid`) for the next
  // driver to charge again: an over-count, never a lost charge.
  if (rec !== null) removePlain(out, `${name}.pid`);
  removePlain(out, `${name}.jsonl.part`);
}

const LOCK_NAME = '.driver.lock';
/** The live claims claimOut has handed out. */
const liveClaims = new WeakSet();

/** D-5985: take the --out lock. `<out>/.driver.lock` holds `{pid, start}` of its driver; it is created whole through an
 *  exclusive tmp file and `linkSync` (EEXIST means held), so a lock is never empty or torn. A holder that reads alive
 *  or unmeasured, a lock that is no regular file, a lock record that cannot be read (its errno in the detail) and one
 *  that is no record refuse `out-in-use`. If the holder releases the lock between the failed link and the read (the
 *  read finds nothing), the link is tried ONCE more before the driver refuses. A dead holder's lock is renamed to
 *  `<lock>.stale-<pid>`, re-read, and taken over only if it still names the same dead holder (pid and start). A re-read
 *  lock naming anyone else is put back and the driver refuses; when the put-back meets EEXIST (a third driver linked
 *  its own lock inside the window), the stale file, which is the only copy of that holder's record, is dropped. The
 *  lock's tmp file is written through writeWhole (a failed write refuses `.driver.lock.tmp-<pid> unwritable <code>` and
 *  drops the tmp file). Every removal here (the stale file, the tmp file in the `finally`) is `dropQuietly` (D-5986):
 *  best-effort, on a path that is refusing or after the lock is taken, where a raw error would replace the answer; a
 *  stale or tmp file left behind is harmless, because the claim walk reads only `.jsonl.part` and `.pid` names.
 *  Residuals (D-5985): a put-back link that fails for a reason other than EEXIST refuses `out-refused` with the
 *  holder's lock still renamed away to the stale file (a live holder then no longer has its lock at `.driver.lock`);
 *  and the two routes to two holders: three or more drivers racing over one dead lock (the EEXIST drop above), and a
 *  driver SIGKILLed between its rename and its put-back, after which a later driver links freely beside the live
 *  holder. */
function takeLock(out, live, afterHeld) {
  const lock = path.join(out, LOCK_NAME);
  const tmpRel = `${LOCK_NAME}.tmp-${process.pid}`;
  const tmp = path.join(out, tmpRel);
  const fd = createPlain(out, tmpRel, 0o600, true);   // D-5986: exclusive, no-follow, like every write under --out
  writeWhole(fd, Buffer.from(pidRecordText(process.pid), 'utf8'), tmp, tmpRel);   // D-5986: a failed write refuses `<tmp> unwritable <code>` and drops the tmp
  const link = () => {
    try {
      linkSync(tmp, lock);
      return true;
    } catch (e) {
      if (e?.code === 'EEXIST') return false;
      refuse('out-refused', `${LOCK_NAME} unwritable ${errCode(e)}`);   // D-5986: a link that cannot be made is a refusal
    }
  };
  try {
    if (link()) return;
    if (afterHeld !== undefined) afterHeld();
    let read = readPidRecord(lock);
    if (read.state === 'absent') {
      // D-5986: the holder released the lock between the failed link and the read: take it once more before refusing.
      if (link()) return;
      read = readPidRecord(lock);
      if (read.state === 'absent') refuse('out-in-use', `${LOCK_NAME} was held and released while this driver started; run it again`);
    }
    if (read.state === 'bad') refuse('out-in-use', `${recordBadDetail(LOCK_NAME, 'lock record', read)}; remove it only after confirming no driver runs on this --out`);
    const holder = read;
    const state = live(holder.pid, holder.start);
    if (state !== 'dead') refuse('out-in-use', `pid ${holder.pid} holds ${LOCK_NAME} (${state})`);
    const stale = `${lock}.stale-${process.pid}`;
    try {
      renameSync(lock, stale);
    } catch (e) {
      if (e?.code === 'ENOENT') refuse('out-in-use', `${LOCK_NAME} was taken over by another driver`);
      refuse('out-refused', `${LOCK_NAME} unwritable ${errCode(e)}`);   // D-5986
    }
    const again = readPidRecord(stale);
    if (again.state !== 'record' || again.pid !== holder.pid || again.start !== holder.start) {
      try {
        linkSync(stale, lock);   // not the dead holder's: put it back
      } catch (e) {
        if (e?.code !== 'EEXIST' && !(again.state === 'absent' && e?.code === 'ENOENT')) refuse('out-refused', `${LOCK_NAME} unwritable ${errCode(e)}`);   // D-5986
      }
      dropQuietly(stale);
      refuse('out-in-use', `${LOCK_NAME} changed hands while this driver started`);
    }
    if (!link()) {
      dropQuietly(stale);
      refuse('out-in-use', `${LOCK_NAME} was taken over by another driver`);
    }
    dropQuietly(stale);
  } finally {
    dropQuietly(tmp);
  }
}

/** Every run name with a `*.jsonl.part` or a `*.pid` under `out`, sorted: directories walked by Dirent type (a link is
 *  never followed), at most four levels. A name that is no RUN_NAME_RE name refuses `out-refused`, and so does a directory
 *  that cannot be listed (`<rel or .> unreadable <code>`); claimOut releases its lock when this refuses. */
function leftoverNames(out) {
  const names = new Set();
  const walk = (dir, rel, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      refuse('out-refused', `${rel === '' ? '.' : rel} unreadable ${errCode(e)}`);   // D-5986: a directory nobody may list
    }
    for (const d of entries) {
      const r = rel === '' ? d.name : `${rel}/${d.name}`;
      if (d.isDirectory()) {
        if (depth < 3) walk(path.join(dir, d.name), r, depth + 1);
        continue;
      }
      const suffix = d.name.endsWith('.jsonl.part') ? '.jsonl.part' : d.name.endsWith('.pid') ? '.pid' : null;
      if (suffix === null) continue;
      const name = r.slice(0, -suffix.length);
      if (!RUN_NAME_RE.test(name) || `${name}.jsonl` === SPEND_LEDGER) refuse('out-refused', `run-name-invalid ${r}`);
      names.add(name);
    }
  };
  walk(out, '', 0);
  return [...names].sort();
}

/** D-5985: claim `out` for this driver: take the --out lock (one driver per --out), then settle the leftovers of every run
 *  name under it (settleLeftover), whatever job they were for. The claim is what runBatch and launchRun require, as they
 *  require a gate, so no subcommand spawns unlocked or skips the walk. Call it right after prepareOut; `release()` (in a
 *  finally) removes the lock if it still names this driver, and is harmless twice.
 *  @param {string} out prepareOut's answer
 *  `opts.afterHeld` is a test seam, as `liveness` is: called once when the lock's link found it held, before the lock is
 *  read, so a case can release it in that window (D-5986: the claim then takes it, instead of refusing).
 *  @param {{liveness?: typeof liveness, afterHeld?: () => void}} [opts]
 *  @returns {Readonly<{out: string, liveness: typeof liveness, release: () => void}>} */
export function claimOut(out, opts = {}) {
  const live = opts.liveness ?? liveness;
  takeLock(out, live, opts.afterHeld);
  let released = false;
  const claim = Object.freeze({
    out, liveness: live,
    release() {
      if (released) return;
      released = true;
      liveClaims.delete(claim);
      const lock = path.join(out, LOCK_NAME);
      const mine = readPidRecord(lock);
      // D-5986: quietly. A failed removal must not replace the refusal claimOut's catch is raising, or fail a release after
      // the work is done; a lock left behind names this driver, which is dead by the next start and is taken over.
      if (mine.state === 'record' && mine.pid === process.pid && mine.start === procStart(process.pid)) dropQuietly(lock);
    },
  });
  liveClaims.add(claim);
  try {
    for (const name of leftoverNames(out)) settleLeftover(out, name, live);
  } catch (e) {
    claim.release();
    throw e;
  }
  return claim;
}

/** runBatch and launchRun require a live claim over the --out of every job, as they require a gate (TypeError before any spawn). */
function requireClaim(who, opts, outs) {
  const claim = opts.claim;
  if (claim === null || typeof claim !== 'object' || !liveClaims.has(claim)) {
    throw new TypeError(`${who}: opts.claim is required (claimOut's live claim): no run spawns on an unclaimed --out`);
  }
  for (const o of outs) {
    if (o !== claim.out) throw new TypeError(`${who}: a job's --out ${JSON.stringify(o)} is not the claimed --out ${JSON.stringify(claim.out)}`);
  }
  return claim;
}

/** The outcome of a job whose run.json exists (resume), or null when it has none. A run.json that does not
 *  parse, one recorded for another account, mode, model or settings mode, or a stream whose bytes changed since,
 *  refuses: a resumed batch builds on what was recorded, and only for the job that recorded it. */
function finishedOutcome(job) {
  const { streamPath, runJsonPath } = runPaths(job.out, job.name);
  refuseLinkedDirs(job.out, job.name);   // D-5986: before run.json or the stream is read
  const runJson = readPlain(runJsonPath, OUT_JSON_CAP);   // D-5986: a FIFO or a link there refuses, never blocks or follows
  if (runJson.state === 'absent') return null;
  if (runJson.state === 'bad') refuse('out-refused', `run-json-unreadable ${job.name} ${badWord(runJson)}`);
  const text = runJson.bytes.toString('utf8');
  let rec;
  try {
    rec = JSON.parse(text);
  } catch {
    refuse('out-refused', `run-json-invalid ${job.name}`);
  }
  if (rec === null || typeof rec !== 'object' || rec.kind !== RUN_KIND || rec.name !== job.name) refuse('out-refused', `run-json-invalid ${job.name}`);
  // The recorded run must be this job's: another account, mode, model or settings mode on the same --out and name
  // is never reused (a re-run under another --account would otherwise record that account over this run's facts).
  if (rec.account !== job.launch.accountId || rec.mode !== job.mode || rec.model !== job.model || rec.settings_mode !== job.settingsMode) {
    refuse('out-refused', `run-json-mismatch ${job.name}`);
  }
  const streamRead = readPlain(streamPath, OUT_STREAM_CAP);
  if (streamRead.state !== 'bytes') refuse('out-refused', `run-stream-changed ${job.name}`);   // D-5986: absent, a directory or a FIFO: the recorded stream is not there
  const stream = streamRead.bytes;
  if (sha256Hex(stream) !== rec.stream_sha256) refuse('out-refused', `run-stream-changed ${job.name}`);
  return {
    name: job.name, skipped: true, code: rec.code, signal: rec.signal, ms: rec.ms, cwd: rec.cwd, streamPath,
    facts: readStreamJson(stream.toString('utf8')), tokens: rec.tokens, unknownOptions: rec.unknown_options,
  };
}

/** One child, stdout straight into the `.part` stream file (D-5811: launchRun renames it once the spawn is charged),
 *  stdin written whole, stderr kept to a bound. The child leads its own process group and is registered (D-5984); a
 *  `<name>.pid` record is written right after spawn() when it has a pid. It is killed, group and all, when it outlives
 *  `timeoutMs` (SIGTERM, then SIGKILL after a grace). The wait after its leader exits is bounded by spawnGroup (a
 *  STOP_GRACE_MS timer that SIGKILLs the group and destroys the stderr pipe; `child.stdout` is null here, the `.part`
 *  being the leader's stdout), so a same-group process that ignores SIGTERM and holds stderr is dead when this returns.
 *  A spawn that fails removes the `.part` and the `.pid`. It checks nothing about a stop itself: launchRun's check runs
 *  in the same synchronous stretch, before this is called (D-5984). */
function runChild(launcher, argv, { cwd, childEnv, stdin, out, name, partPath, pidPath, timeoutMs }) {
  return new Promise((resolve, reject) => {
    // D-5986: created exclusively and without following a link. claimOut and launchRun have settled every leftover, so a
    // `.part` that exists now was planted: out-refused.
    const fd = createPlain(out, `${name}.jsonl.part`, 0o600, false);
    let child;
    try {
      child = spawnGroup(launcher, argv, { cwd, env: childEnv, stdio: ['pipe', fd, 'pipe'] });
    } finally {
      closeSync(fd);
    }
    const pid = child.pid;
    const errs = [];
    let kept = 0;
    child.stderr.on('data', (b) => {
      if (kept < STDERR_KEEP_BYTES) { errs.push(b.subarray(0, STDERR_KEEP_BYTES - kept)); kept += b.length; }
    });
    // D-5984: a rejected run must not leave its child running unseen: any error other than EPIPE (the child closed its stdin
    // early) kills the child's group. The `.part` and `.pid` stay, and the next driver settles them (settleLeftover).
    child.stdin.on('error', (e) => {
      if (e.code === 'EPIPE') return;
      if (typeof pid === 'number') signalGroup(pid, 'SIGKILL');
      reject(e);
    });
    let killer = null;
    const timer = setTimeout(() => {
      if (typeof pid === 'number') signalGroup(pid, 'SIGTERM');
      killer = setTimeout(() => { if (typeof pid === 'number') signalGroup(pid, 'SIGKILL'); }, KILL_GRACE_MS);
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      if (killer) clearTimeout(killer);
      if (typeof pid === 'number') {
        // D-5984: a child with a pid may be running (a failed kill, say): kill its group and leave the `.part` and `.pid`
        // for the next driver, as for any killed driver. Only a spawn that never produced a child leaves nothing to keep.
        signalGroup(pid, 'SIGKILL');
      } else {
        rmSync(partPath, { force: true });
        rmSync(pidPath, { force: true });
      }
      reject(e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (killer) clearTimeout(killer);
      resolve({ code, signal, stderr: Buffer.concat(errs).toString('utf8') });
    });
    if (typeof pid === 'number') {
      try {
        writePidRecord(out, name, pid);
      } catch (e) {
        signalGroup(pid, 'SIGKILL');   // a child no record names must not run on
        clearTimeout(timer);
        // D-5984: the operator learns which child was killed (a refusal keeps its word and detail, a raw error stays as it is).
        reject(e instanceof DriverRefusal ? new DriverRefusal(e.word, `${e.detail}; its child (pid ${pid}) was killed with its group`) : e);
        return;
      }
    }
    child.stdin.end(stdin);
  });
}

/** The option names a run's stderr reports as unknown, in order, once each. Nothing else of stderr is kept. */
function unknownOptionsIn(stderr) {
  const seen = [];
  for (const m of stderr.matchAll(UNKNOWN_OPTION_RE)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/** Run one job, or answer its recorded outcome when its run.json exists. The job's `name` is one to four `/`-separated
 *  segments of `[a-z0-9][a-z0-9._-]*`; a name whose stream would be `<out>/SPEND_LEDGER` is refused (D-5803). The
 *  order of a spawn's files is: the stream into `<name>.jsonl.part` and the child's `<name>.pid`, the child's close, its
 *  spend line, the removal of the `.pid`, the rename to `<name>.jsonl`, then run.json (D-5811, D-5984). A leftover of
 *  this name is settled first (settleLeftover). `opts.claim` is claimOut's live claim over the job's --out, required
 *  as runBatch's gate is (D-5985); `opts.liveness` defaults to the claim's. A stopped driver refuses `interrupted`
 *  before the spawn (the check is kept because launchRun is exported). A child that closes while the driver is
 *  stopping is charged, its `.pid` and `.part` are removed, no run.json is written and the run refuses `interrupted`.
 *  @param {{launch: object, mode: string, model: string, settingsMode: string, recall?: object, stdin: string,
 *    out: string, name: string, lang: string | undefined, timeoutMs?: number}} job
 *  @param {{claim: object, liveness?: typeof liveness}} opts */
export async function launchRun(job, opts = {}) {
  if (job === null || typeof job !== 'object' || !Object.hasOwn(job, 'lang')) {
    throw new TypeError("launchRun: a RunJob carries lang, the caller's LANG from main's env (undefined when unset)");
  }
  const claim = requireClaim('launchRun', opts, [job.out]);
  const done = finishedOutcome(job);
  if (done !== null) return done;
  settleLeftover(job.out, job.name, opts.liveness ?? claim.liveness);   // finds nothing when claimOut or runBatch has settled it already
  const { launch, mode, model, settingsMode, recall, stdin, out, name, lang } = job;
  // D-5811: a final stream path that is not a regular file (a directory, a symlink) refuses before the spawn, or the
  // rename after the spend line would fail and every resume would charge and spawn again. A regular file (a finished
  // spawn whose run.json was lost) goes on: the re-spawn's rename replaces it.
  const finalSt = lstatOrNull(out, `${name}.jsonl`);
  if (finalSt !== null && !finalSt.isFile()) refuse('out-refused', `run-stream-invalid ${name}`);
  const timeoutMs = job.timeoutMs ?? RUN_TIMEOUT_MS;
  if (typeof stdin !== 'string') throw new TypeError('launchRun: stdin must be a string');
  const { streamPath, partPath, pidPath } = runPaths(out, name);
  const home = runHomeOf(launch);
  const argv = spawnArgv({ mode, model, settingsMode, home });
  const childEnv = spawnEnv({ mode, home, configDir: launch.configDir, poisonBin: ensurePoisonBin(out), lang, recall });
  if (path.dirname(name) !== '.') ensurePlainDir(out, path.dirname(name));   // D-5986: a run subdirectory is a real directory, never a link
  const cwd = makeRunCwd();
  const t0 = Date.now();
  let res;
  try {
    refuseIfStopping();
    res = await runChild(launch.launcher, argv, { cwd, childEnv, stdin, out, name, partPath, pidPath, timeoutMs });
  } finally {
    dropQuietly(cwd, true);   // D-5984: best-effort. A child-made entry nobody may remove (mode 000) must not turn the finished run into a raw error before its spend line
  }
  const ms = Date.now() - t0;
  const partRead = readPlain(partPath, OUT_STREAM_CAP);
  if (partRead.state !== 'bytes') refuse('out-refused', `run-stream-invalid ${name}`);
  const stream = partRead.bytes;
  const facts = readStreamJson(stream.toString('utf8'));
  const tokens = spendTokens(facts);
  const unknownOptions = unknownOptionsIn(res.stderr);
  recordSpend(out, name, tokens);
  // D-5986: the spend line is written. A removal or the rename below that fails refuses out-refused and leaves the `.part`
  // (with the `.pid` when that is what failed), which the next driver charges again: an over-count, never a lost charge.
  removePlain(out, `${name}.pid`);
  if (stopping !== null) {
    removePlain(out, `${name}.jsonl.part`);   // D-5984: charged above, so a resume spawns the job again and its spend is counted once
    refuseIfStopping();
  }
  try {
    renameSync(partPath, streamPath);
  } catch (e) {
    refuse('out-refused', `${name}.jsonl unwritable ${errCode(e)}`);
  }
  const rec = {
    kind: RUN_KIND, v: 1, name, account: launch.accountId, mode, model, settings_mode: settingsMode,
    code: res.code, signal: res.signal, ms, cwd, stream_sha256: sha256Hex(stream), tokens,
    // W2-5b1 Task 1 (Q7): both readings the charge took the larger of, beside it.
    usage_result_tokens: facts.resultUsage === null ? null : usageTokens(facts.resultUsage), usage_assistant_tokens: usageTokens(facts.assistantUsage),
    unknown_options: unknownOptions,
  };
  writePlain(out, `${name}.run.json`, canonicalJson(rec) + '\n');
  return { name, skipped: false, code: res.code, signal: res.signal, ms, cwd, streamPath, facts, tokens, unknownOptions };
}

/** Run up to BATCH_MAX jobs, at most `concurrency` (<= CONCURRENCY_MAX) at once, calling `gate` before each spawn
 *  (Task 6's limits and budget stop). The gate is required: a missing one is a TypeError before any spawn, so the
 *  stop is never opt-in. A finished job is skipped without the gate. A gate reads the ledger BEFORE its own spawn and
 *  cannot see the runs in flight, and a run's spend lands only when it closes: the budget is a SOFT stop. The gate admits
 *  a spawn while spent < budget, so the ledger can end up to c WHOLE runs past `--budget`, where c is the batch's
 *  concurrency (step 0a 1, the probe 2). Operator line: set `--budget` at least c runs' spend below any total you must
 *  not cross; the limits threshold stop is separate (D-5814). `opts.claim` is claimOut's live claim over every
 *  job's --out, required as the gate is (D-5985; the gate is checked first); `opts.liveness` defaults to the claim's.
 *  Before any lane starts, every job that has no run.json has its leftovers settled (settleLeftover, D-5984), so the
 *  first gate reads a dead writer's charge; a live writer refuses `run-live` and a `.part` that is not a regular
 *  file refuses out-refused, before any spawn. Each lane iteration yields to signals first (yieldToSignals), re-reads
 *  whether it may take a job, and then refuses `interrupted` if a stop is set, before finishedOutcome and the gate: a
 *  signal that arrives before the poll phase inside a yield is handled there and every stop check after it refuses, so no
 *  spawn starts after the handler has run. A signal that arrives in one lane's synchronous stretch from its yield to its
 *  spawn is handled only at the next poll phase, so a sibling lane whose yield returns in the same check phase does not see
 *  it: it passes its stop check, calls its gate and spawns. Lanes that start together (every batch's start, through
 *  Promise.all) end their yields in one check phase, so that window is up to c children, the batch's concurrency; every
 *  child spawned in it is stopped and charged. The batch's last check, after its lanes, refuses `interrupted` too: a
 *  lane whose final iteration found no job to take has made no stop check of its own. A signal that arrives after that
 *  check, when every child has closed, is not handled. The first throw, the gate's included, stops the batch: no further
 *  spawn starts, a run already started finishes and is recorded (a stopped one is not), and the throw is rethrown, so a
 *  re-run resumes. */
export async function runBatch(jobs, opts = {}) {
  if (typeof opts.gate !== 'function') throw new TypeError('runBatch: opts.gate is required (Task 6\'s batchGate, or a test\'s explicit no-op): no batch spawns ungated');
  if (!Array.isArray(jobs) || jobs.length > BATCH_MAX) throw new TypeError(`runBatch: a batch is at most ${BATCH_MAX} jobs`);
  const claim = requireClaim('runBatch', opts, jobs.map((j) => j.out));
  const liveNow = opts.liveness ?? claim.liveness;
  const concurrency = opts.concurrency ?? CONCURRENCY_MAX;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > CONCURRENCY_MAX) throw new TypeError(`runBatch: concurrency must be 1 to ${CONCURRENCY_MAX}`);
  const names = jobs.map((j) => path.join(j.out, j.name));
  if (new Set(names).size !== names.length) throw new TypeError('runBatch: two jobs share one --out and name');
  const gate = opts.gate;
  for (const job of jobs) {
    runPaths(job.out, job.name);   // a name that is no run name is a TypeError here, before anything is touched
    refuseLinkedDirs(job.out, job.name);   // D-5986: before the run.json lstat or the settle go through a link
    if (lstatOrNull(job.out, `${job.name}.run.json`) === null) settleLeftover(job.out, job.name, liveNow);   // D-5986: an lstat failure refuses, as every read under --out does
  }
  const outcomes = new Array(jobs.length);
  let next = 0;
  let stop = null;
  const lane = async () => {
    for (;;) {
      // D-5984: a signal that arrived before this yield's poll phase is handled here; one that arrives after it, in a
      // sibling's yield-to-spawn stretch, is not (up to c children)
      await yieldToSignals();
      if (stop !== null || next >= jobs.length) return;   // re-read after the yield: a sibling may have failed meanwhile
      const i = next++;
      try {
        refuseIfStopping();   // D-5984: no spawn and no gate call after the handler has run. Its place before finishedOutcome is not pinned on its own: the batch's last check below already refuses a fully resumed batch
        const done = finishedOutcome(jobs[i]);
        if (done !== null) { outcomes[i] = done; continue; }
        gate();
        outcomes[i] = await launchRun(jobs[i], { claim, liveness: liveNow });
      } catch (e) {
        if (stop === null) stop = { e };
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, lane));
  if (stop !== null) throw stop.e;
  // D-5984: the batch's last check. A lane's final iteration returns at the re-read with no stop check of its own, so a
  // signal handled at that last yield is caught here. Nothing awaits between this return and the subcommand's
  // step0a.json or probe.json write, so no handler can run in between: this check covers those writes. A signal that arrives
  // after it, when every child has closed, is not handled (the post-last-check window): the result is written, and the
  // driver exits 0, or ends by that signal if it comes after main has removed its listeners.
  refuseIfStopping();
  return outcomes;
}

// ── W2-4 Task 6: the limits stop and the spend budget (W2-D55; spec §10.2 "stops at a stated threshold", erratum E18) ──
// Before each batch and before each spawn the driver reads ONE limits row, `$HOME/.cc-limits/<account id>.json`,
// read-only: the one `~/.cc-limits` read in the spec (§5.2). lstat first, so a symlink, a directory or a FIFO is never
// opened; then one bounded read through an O_NOFOLLOW|O_NONBLOCK descriptor whose fstat must still say regular. The row
// is parsed by readLimits' rules (server/src/limits.ts), term for term: a lapsed resetAt is a FACT and writes 0; only
// then does the age fallback infer a 0 for a value older than its own window. readLimits folds both into one
// `*RolledOver` flag; the driver keeps the provenance beside it (`*Inferred`), because here the two answer differently:
// a resetAt 0 is a measured reset and may admit a batch, an age-inferred 0 measured nothing and stops it as stale.
// A parity case in history-replay.test.ts holds parseLimitsRow to readLimits over rolloverCases' bytes, so the two
// spellings of these rules cannot drift (a .mjs operator script cannot import server/src/*.ts). The budget is the
// cumulative spend ledger under --out (Task 4); a stop throws DriverRefusal (exit 2), and a re-run resumes, since
// runBatch skips every finished job (Task 5). Before part 1 the values are LIMITS_DEFAULTS and a required --budget;
// W2-5a and W2-5b pass part 1's or part 2's values through the same parameters.

/** The limits values in force before part 1 (W2-D55; part 1's `limits` records them). W2-5a and W2-5b pass part 1's
 *  values through batchGate's `limits` parameter. batch_max and concurrency are Task 5's constants, never a second
 *  literal. */
export const LIMITS_DEFAULTS = Object.freeze({
  threshold_pct: 70, max_age_ms: 3_600_000, batch_max: BATCH_MAX, concurrency: CONCURRENCY_MAX,
});

const LIMITS_FIVE_WINDOW_S = 18000;     // readLimits' FIVE_WINDOW: a five sample older than its own 5h window has rolled over
const LIMITS_SEVEN_WINDOW_S = 604800;   // readLimits' SEVEN_WINDOW, the same for seven
const LIMITS_ROW_CAP = 65536;           // a limits row is about 150 bytes; a file past 64 KiB is not one, and is malformed
const LIMITS_FUTURE_SKEW_MS = 60_000;   // a ts at most a minute ahead of the clock is skew; further ahead measured nothing
const LIMITS_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;   // one path segment, never `..`-led or hidden
const limitsNum = (v) => (typeof v === 'number' ? v : null);   // readLimits' numOrNull

/** One limits row's text, by readLimits' rules, keeping the provenance it folds. Throws on non-JSON or a non-object. */
export function parseLimitsRow(text, nowS) {
  const raw = JSON.parse(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('a limits row is one JSON object');
  const ts = limitsNum(raw.ts);
  const fiveResetAt = limitsNum(raw.fiveResetAt);
  const sevenResetAt = limitsNum(raw.sevenResetAt);
  let five = limitsNum(raw.five);
  let seven = limitsNum(raw.seven);
  // The FACT first: a lapsed resetAt comes straight from the API, so its 0 is a measured reset.
  let fiveRolledOver = five !== null && fiveResetAt !== null && nowS >= fiveResetAt;
  let sevenRolledOver = seven !== null && sevenResetAt !== null && nowS >= sevenResetAt;
  if (fiveRolledOver) five = 0;
  if (sevenRolledOver) seven = 0;
  // Then the INFERENCE, which may not re-derive what the fact already said (readLimits' `!fiveRolledOver` guards).
  // readLimits sets only *RolledOver here; the driver also says the 0 was inferred, because that 0 measured nothing.
  let fiveInferred = false;
  let sevenInferred = false;
  if (ts !== null) {
    if (!fiveRolledOver && five !== null && nowS - ts > LIMITS_FIVE_WINDOW_S) { five = 0; fiveRolledOver = true; fiveInferred = true; }
    if (!sevenRolledOver && seven !== null && nowS - ts > LIMITS_SEVEN_WINDOW_S) { seven = 0; sevenRolledOver = true; sevenInferred = true; }
  }
  return { five, seven, ts, fiveResetAt, sevenResetAt, fiveRolledOver, sevenRolledOver, fiveInferred, sevenInferred };
}

/** `$HOME/.cc-limits/<accountId>.json`, read-only, through readPlain (D-5986): lstat first (only a regular file is
 *  opened), then one bounded read through an O_NOFOLLOW|O_NONBLOCK descriptor whose fstat must still say regular. Every
 *  outcome is its own state: `absent`; `not-regular` (a directory, a link, a FIFO, or a file replaced between the lstat
 *  and the open); `malformed` (past LIMITS_ROW_CAP, or not a JSON object); `unreadable` with the errno in `code`; `row`. */
export function readLimitsRow(home, accountId, nowS) {
  if (typeof accountId !== 'string' || !LIMITS_ID.test(accountId)) throw new TypeError(`not an account id: ${JSON.stringify(accountId)}`);
  const read = readPlain(path.join(home, '.cc-limits', `${accountId}.json`), LIMITS_ROW_CAP);
  if (read.state === 'absent') return { state: 'absent' };
  if (read.state === 'bad') {
    if (read.why === 'not-regular') return { state: 'not-regular' };
    if (read.why === 'over-cap') return { state: 'malformed' };
    return { state: 'unreadable', code: read.code };
  }
  try { return { state: 'row', row: parseLimitsRow(read.bytes.toString('utf8'), nowS) }; } catch { return { state: 'malformed' }; }
}

/** The limits stop (W2-D55): null admits the batch; otherwise the word and detail it stops with. */
export function decideLimits(read, { nowMs, thresholdPct, maxAgeMs }) {
  const stale = (detail) => ({ word: 'limits-stale', detail });
  switch (read.state) {
    case 'absent': return stale('absent');
    case 'not-regular': return stale('not-regular');
    case 'unreadable': return stale(`unreadable ${read.code}`);
    case 'malformed': return stale('malformed');
    case 'row': break;
    default: throw new TypeError(`not a limits read: ${JSON.stringify(read.state)}`);
  }
  const r = read.row;
  if (r.five === null) return stale('five-null');
  if (r.seven === null) return stale('seven-null');
  if (!(r.five >= 0 && r.five <= 100) || !(r.seven >= 0 && r.seven <= 100)) return stale('percent-out-of-range');
  if (r.fiveInferred || r.sevenInferred) return stale('inferred-by-age');
  if (r.ts === null) return stale('ts-null');
  const aheadMs = r.ts * 1000 - nowMs;
  if (aheadMs > LIMITS_FUTURE_SKEW_MS) return stale(`ts-future ${aheadMs}`);
  const ageMs = nowMs - r.ts * 1000;
  if (ageMs > maxAgeMs) return stale(`old ${ageMs}`);
  if (Math.max(r.five, r.seven) >= thresholdPct) {
    return { word: 'limits-threshold', detail: `five ${r.five} seven ${r.seven} at or over ${thresholdPct}` };
  }
  return null;
}

/** The spend budget (W2-D55): the cumulative ledger at or over the budget stops. */
export function decideBudget(spent, budget) {
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new TypeError(`a budget is a positive integer: ${String(budget)}`);
  if (!Number.isSafeInteger(spent) || spent < 0) throw new TypeError(`a spend is a non-negative integer: ${String(spent)}`);
  return spent >= budget ? { word: 'budget-exhausted', detail: `spent ${spent} of ${budget}` } : null;
}

/** The gate called before each batch and before each spawn: the budget first, then the limits row. Throws DriverRefusal.
 *  It reads the ledger before its own spawn and cannot see a run in flight, and a run's spend lands when it closes: the
 *  gate admits a spawn while spent < budget, so the ledger can end up to c WHOLE runs past `--budget`, where c is the
 *  batch's concurrency (step 0a 1, the probe 2). The budget is a soft stop. Operator line: set `--budget` at least c
 *  runs' spend below any total you must not cross; the limits threshold stop is separate (D-5814). */
export function batchGate({ out, home, accountId, budget, limits, now = Date.now }) {
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new TypeError(`a budget is a positive integer: ${String(budget)}`);
  const thresholdPct = limits?.threshold_pct;
  const maxAgeMs = limits?.max_age_ms;
  if (typeof thresholdPct !== 'number' || !(thresholdPct > 0 && thresholdPct <= 100)) throw new TypeError(`limits.threshold_pct is in (0, 100]: ${String(thresholdPct)}`);
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new TypeError(`limits.max_age_ms is a positive integer: ${String(maxAgeMs)}`);
  return () => {
    const spent = decideBudget(spentSoFar(out), budget);
    if (spent !== null) refuse(spent.word, spent.detail);
    refuseOnLimits(home, accountId, { thresholdPct, maxAgeMs }, now());
  };
}

/** The limits half of batchGate's check, one function: the account's limits row against the threshold and the age
 *  bound, refusing with decideLimits' own word. batchGate's gate runs it after the budget half; the sourcing
 *  subcommands' pre-check (refuseWriterAdmission, D-6307) runs it alone, before --out exists.
 *  @param {string} home  @param {string} accountId  @param {{ thresholdPct: number, maxAgeMs: number }} bounds  @param {number} nowMs */
function refuseOnLimits(home, accountId, { thresholdPct, maxAgeMs }, nowMs) {
  const stop = decideLimits(readLimitsRow(home, accountId, Math.floor(nowMs / 1000)), { nowMs, thresholdPct, maxAgeMs });
  if (stop !== null) refuse(stop.word, stop.detail);
}

// ── W2-4 Task 7: the preflights W2-5a and W2-5b wire (W2-D56, W2-D24, W2-D6, W2-D78(ii), W2-D29, W2-D59) ────────
// These are the mechanisms; W2-5a wires them into pilot-source and quiz-source (openWriter's preflight and, before --out
// exists, refuseWriterAdmission's preflightFiles), and W2-5b wires its own spawning subcommands (W2-D24). Before part 1 a
// spawning subcommand compares what step 0a recorded (loadStep0a over `--step0a PATH --step0a-sha256 HEX`) with what it
// measures now; from part 1 it compares part 1's values. Step 0a (Task 8) RECORDS codeShas() and the release stamp and
// never compares them.
// Every reader keeps its conditions apart: a file that cannot be measured is never hashed as nothing, a stamp that
// cannot be read is never "no stamp", and a recall-off entry that cannot be lstat'ed is never "absent".

/** The four files whose installed bytes gate_code pins (W2-D24), relative to the tree the driver runs from: the gate's
 *  own GATE_CODE_FILES, so the four paths are spelled once (W2-5a Task 1, closing decisions §7's double spelling). The
 *  driver's other ccd/history imports (store.mjs, derive.mjs, recall.mjs, cli.mjs) and the modules they load (sweep.mjs,
 *  card.mjs, ccd/compact-card.mjs, shared/base-url.mjs) are not hashed: the release_tag comparison and the tree-moved
 *  preflight cover them (W2-D24, W2-D56). */
export const CODE_SHA_FILES = GATE_CODE_FILES;
/** The tree this file was loaded from: the installed release on a node, the checkout in a test. */
export const TREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Step 0a's output kind and its exact field set (W2-D57): loadStep0a's shape, and the one Task 8 writes. */
export const STEP0A_KIND = 'ccrc-history-w2-step0a';
export const STEP0A_FIELDS = Object.freeze(['kind', 'v', 'measured_ms', 'account', 'settings_mode', 'claude_code_version',
  'wrapper_sha256', 'flags_accepted', 'writer_init', 'judge_init', 'box_init', 'code_shas', 'release_stamp', 'budget', 'spend']);
const SHA256_RE = /^[0-9a-f]{64}$/;
const VERSION_TIMEOUT_MS = 60_000;
const VERSION_STDOUT_MAX = 65_536;

/** The sha256 of each CODE_SHA_FILES member's bytes under `root`, or the first one that cannot be measured. An
 *  absent file is `absent`; any other read failure is `unreadable`. */
export function codeShas(root = TREE_ROOT) {
  const files = {};
  for (const rel of CODE_SHA_FILES) {
    let bytes;
    try {
      bytes = readFileSync(path.join(root, rel));
    } catch (e) {
      return { state: 'unmeasured', path: rel, cause: e.code === 'ENOENT' ? 'absent' : 'unreadable' };
    }
    files[rel] = sha256Hex(bytes);
  }
  return { state: 'measured', files };
}

/** The installed release tag: `version` in `$HOME/.ccrc/build.json`, which an untagged build omits. Only the label
 *  is read; shared/buildinfo.ts stays the one validator of the stamp's other fields. */
export function readReleaseStamp(home) {
  let text;
  try {
    text = readFileSync(path.join(home, '.ccrc', 'build.json'), 'utf8');
  } catch (e) {
    return e.code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable', code: String(e.code) };
  }
  let stamp;
  try {
    stamp = JSON.parse(text);
  } catch {
    return { state: 'malformed' };
  }
  if (stamp === null || typeof stamp !== 'object' || Array.isArray(stamp)) return { state: 'malformed' };
  if (!Object.hasOwn(stamp, 'version')) return { state: 'untagged' };
  if (typeof stamp.version !== 'string' || stamp.version === '') return { state: 'malformed' };
  return { state: 'value', tag: stamp.version };
}

/** A generated account's wrapper bytes, hashed; null for upstream, which has no wrapper. A wrapper that cannot be
 *  read refuses `wrapper-unmeasured` here (coordinator ruling): null is upstream's answer and never a failed read's,
 *  and `wrapper-moved` names a measured mismatch only. */
export function wrapperSha(launch) {
  if (launch.kind === 'upstream') return null;
  if (launch.kind !== 'generated' || typeof launch.wrapperPath !== 'string') throw new TypeError(`wrapperSha: not a LaunchSpec: ${JSON.stringify(launch)}`);
  let bytes;
  try {
    bytes = readFileSync(launch.wrapperPath);
  } catch (e) {
    refuse('wrapper-unmeasured', `${launch.wrapperPath}: ${e.code}`);
  }
  return sha256Hex(bytes);
}

/** `<launcher> --version` under launchRun's rules: writer-mode env (no CCRC_RECALL_*), the poisoned PATH, a fresh
 *  empty 0700 cwd removed afterwards, no shell, a process-group leader of its own (D-5984) killed, group and all, past
 *  VERSION_TIMEOUT_MS. It spends nothing and
 *  records nothing in the ledger. It is the one exported spawn that takes no claim (D-5985's stated exception): it is
 *  a `--version` call that writes nothing under --out but the poison-bin `gh` (written whole, by writePlain), and
 *  step 0a calls it only after claimOut. The version is the first stdout line, trimmed. `lang` is the caller's LANG from
 *  main's env (undefined when unset), threaded as RunJob.lang is: this function reads no environment itself. The
 *  child env is named childEnv and passed as `env: childEnv`, as launchRun's is: Task 5's env scan reds on the
 *  shorthand `{ cwd, env }`.
 *  @param {object} launch  @param {string} out  @param {string | undefined} lang */
export async function measureClaudeVersion(launch, out, lang) {
  const home = runHomeOf(launch);
  await yieldToSignals();   // D-5984: a signal that arrived before this yield's poll phase is handled here
  refuseIfStopping();   // D-5984: no spawn starts after the handler has run
  const childEnv = spawnEnv({ mode: 'writer', home, configDir: launch.configDir, poisonBin: ensurePoisonBin(out), lang });
  const cwd = makeRunCwd();
  let r;
  try {
    r = await new Promise((resolve) => {
      const child = spawnGroup(launch.launcher, ['--version'], { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks = [];
      let kept = 0;
      child.stdout.on('data', (b) => {
        if (kept < VERSION_STDOUT_MAX) { chunks.push(b.subarray(0, VERSION_STDOUT_MAX - kept)); kept += b.length; }
      });
      const timer = setTimeout(() => { if (typeof child.pid === 'number') signalGroup(child.pid, 'SIGKILL'); }, VERSION_TIMEOUT_MS);
      child.on('error', () => { clearTimeout(timer); resolve({ code: null, signal: null, stdout: '' }); });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout: Buffer.concat(chunks).toString('utf8') }); });
    });
  } finally {
    dropQuietly(cwd, true);   // D-5984: best-effort, as launchRun's
  }
  const version = r.stdout.split('\n')[0].trim();
  if (r.code !== 0 || r.signal !== null || version === '') return { state: 'failed', code: r.code, signal: r.signal };
  return { state: 'value', version };
}

/** The version half of the preflight (W2-D56): the one comparison that needs a spawn (`--version`), asked first. Pure.
 *  @returns {{ ok: false, word: string, detail: string } | null} the refusal, or null when the version holds */
function preflightVersion(expected, measured) {
  const v = measured.version;
  if (v.state !== 'value') return { ok: false, word: 'version-unmeasured', detail: `--version failed (code ${v.code}, signal ${v.signal})` };
  if (v.version !== expected.claude_code_version) return { ok: false, word: 'claude-version-moved', detail: `recorded ${expected.claude_code_version}, measured ${v.version}` };
  return null;
}

/** The no-spawn half of the preflight (D-6311): the release stamp, the wrapper and the four code shas, in W2-D56's order.
 *  Each is a file read, so a caller that has measured them can ask before it spawns anything: refuseWriterAdmission asks it
 *  before --out exists, and `preflight` asks it again, after the version, at open. Pure. `measured` carries `stamp`,
 *  `wrapperSha256` and `codeShas`, no version.
 *  @returns {{ ok: false, word: string, detail: string } | { ok: true, stamps: string[] }} */
export function preflightFiles(expected, measured, opts = {}) {
  const s = measured.stamp;
  if (s.state !== 'value') return { ok: false, word: 'tree-unmeasured', detail: `the release stamp is ${s.state}${s.state === 'unreadable' ? ` (${s.code})` : ''}` };
  if (s.tag !== expected.release_stamp) return { ok: false, word: 'tree-moved', detail: `recorded ${expected.release_stamp}, measured ${s.tag}` };
  if (measured.wrapperSha256 !== expected.wrapper_sha256) return { ok: false, word: 'wrapper-moved', detail: `recorded ${expected.wrapper_sha256 ?? 'no wrapper'}, measured ${measured.wrapperSha256 ?? 'no wrapper'}` };
  const c = measured.codeShas;
  if (c.state !== 'measured') return { ok: false, word: 'code-unmeasured', detail: `${c.path} is ${c.cause}` };
  const names = [...new Set([...CODE_SHA_FILES, ...Object.keys(expected.code_shas)])];
  const moved = names.filter((f) => c.files[f] !== expected.code_shas[f]);
  if (moved.length === 0) return { ok: true, stamps: [] };
  if (opts.allowCodeChange === true) return { ok: true, stamps: ['code-changed'] };
  return { ok: false, word: 'code-changed', detail: `changed ${moved.join(' ')}` };
}

/** Compare what was recorded with what is measured, in W2-D56's fixed order: the Claude Code version
 *  (preflightVersion), then preflightFiles' release stamp (W2-D6's tree-moved), wrapper and four code shas. A moved word
 *  names a MEASURED mismatch only; an input that cannot be measured refuses its own word at its place (coordinator ruling):
 *  version-unmeasured, tree-unmeasured, code-unmeasured (the wrapper's, wrapper-unmeasured, is wrapperSha's refusal, before
 *  this is reached: measured.wrapperSha256 is a sha or upstream's null). Only the code-changed word, a MEASURED change,
 *  may become a stamp, and only with allowCodeChange (W2-D24's --allow-code-change); no unmeasured word ever
 *  does. Pure. */
export function preflight(expected, measured, opts = {}) {
  return preflightVersion(expected, measured) ?? preflightFiles(expected, measured, opts);
}

const plainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

/** The first field of a parsed step 0a output that is not Step0aOutput's shape, or null. */
function step0aShapeError(o) {
  if (!plainObject(o)) return 'not-object';
  const keys = Object.keys(o).sort().join(' ');
  if (keys !== [...STEP0A_FIELDS].sort().join(' ')) return `fields ${keys}`;
  if (o.kind !== STEP0A_KIND) return 'kind';
  if (o.v !== 1) return 'v';
  if (!Number.isSafeInteger(o.measured_ms) || o.measured_ms <= 0) return 'measured_ms';
  if (typeof o.account !== 'string' || o.account === '') return 'account';
  if (!SETTINGS_MODES.includes(o.settings_mode)) return 'settings_mode';
  if (typeof o.claude_code_version !== 'string' || o.claude_code_version === '') return 'claude_code_version';
  if (o.wrapper_sha256 !== null && !(typeof o.wrapper_sha256 === 'string' && SHA256_RE.test(o.wrapper_sha256))) return 'wrapper_sha256';
  if (!plainObject(o.flags_accepted) || !Object.values(o.flags_accepted).every((b) => typeof b === 'boolean')) return 'flags_accepted';
  for (const k of ['writer_init', 'judge_init', 'box_init']) if (o[k] !== null && !plainObject(o[k])) return k;
  if (!plainObject(o.code_shas) || Object.keys(o.code_shas).sort().join(' ') !== [...CODE_SHA_FILES].sort().join(' ')
    || !CODE_SHA_FILES.every((f) => typeof o.code_shas[f] === 'string' && SHA256_RE.test(o.code_shas[f]))) return 'code_shas';
  if (typeof o.release_stamp !== 'string' || o.release_stamp === '') return 'release_stamp';
  if (!Number.isSafeInteger(o.budget) || o.budget <= 0) return 'budget';
  if (!Number.isSafeInteger(o.spend) || o.spend < 0) return 'spend';
  return null;
}

/** Step 0a's output as a later subcommand's input (W2-D56): outside any git tree, its bytes' sha256 checked BEFORE
 *  they are parsed (input-sha-mismatch, W2-D59), then its shape (input-invalid). Shape-only (D-5812): pilot-source may
 *  run against a step 0a output that part 1 later refuses, because part 1 refuses a null in any of the three `*_init`
 *  fields (`box_init` included, the box run alone carrying `--allowedTools`) or a false flag. */
export function loadStep0a(p, sha256) {
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) refuse('args-invalid', '--step0a-sha256 is not 64 lowercase hex');
  if (typeof p !== 'string' || p === '') refuse('args-invalid', '--step0a names no path');
  const abs = path.resolve(p);
  const g = insideGitTree(path.dirname(abs));
  if (g.state === 'inside') refuse('input-invalid', `step0a in-git-tree ${g.at}`);
  if (g.state === 'unmeasured') refuse('input-invalid', `step0a git-unmeasured ${g.at} ${g.code}`);
  // D-5986: the input is read as every --out file is (lstat, no-follow non-blocking open, fstat), so a FIFO is refused, never waited on.
  const read = readPlain(abs, OUT_JSON_CAP);
  if (read.state === 'absent') refuse('input-invalid', 'step0a unreadable ENOENT');
  if (read.state === 'bad') refuse('input-invalid', read.why === 'unreadable' ? `step0a unreadable ${read.code}` : `step0a ${read.why}`);
  const bytes = read.bytes;
  const got = sha256Hex(bytes);
  if (got !== sha256) refuse('input-sha-mismatch', `step0a: expected ${sha256}, measured ${got}`);
  let o;
  try {
    o = JSON.parse(bytes.toString('utf8'));
  } catch {
    refuse('input-invalid', 'step0a not-json');
  }
  const bad = step0aShapeError(o);
  if (bad !== null) refuse('input-invalid', `step0a shape ${bad}`);
  return o;
}

/** Which ids have a recall-off entry (W2-D78(ii)): an lstat of lib's own path, whatever the entry's type or content,
 *  so a directory, an empty file and a dangling symlink are each present. ENOENT alone is absent; any other lstat
 *  error is unmeasured. An id that fails idOk makes recallOffPath throw a TypeError with no code, which refuses
 *  input-invalid (coordinator ruling): never read as absent, never a defect's exit 1.
 *  It never opens the entry (W2-D29): this lstat line is the presence check's one recall-off line (W2-D78(ii)).
 *  verify --section ab's controlFileOf reads a control file's content, through readBounded (W2-D84). */
export function recallOffPresence(home, ids) {
  const present = [];
  const unmeasured = [];
  for (const id of ids) {
    try {
      lstatSync(recallOffPath(home, id));
      present.push(id);
    } catch (e) {
      if (e instanceof TypeError && e.code === undefined) refuse('input-invalid', `family id ${JSON.stringify(id)} is not a session id`);
      if (typeof e?.code !== 'string') throw e;
      if (e.code !== 'ENOENT') unmeasured.push({ id, code: e.code });
    }
  }
  return { present, unmeasured };
}

/** Refuse when any id is present or unmeasured: both are the one driver word (W2-D78(ii)). */
export function refuseRecallOff(home, ids) {
  const { present, unmeasured } = recallOffPresence(home, ids);
  if (present.length === 0 && unmeasured.length === 0) return;
  const parts = [];
  if (present.length > 0) parts.push(`present ${present.join(' ')}`);
  if (unmeasured.length > 0) parts.push(`unmeasured ${unmeasured.map((u) => `${u.id} ${u.code}`).join(', ')}`);
  refuse('family-recall-off', parts.join('; '));
}

// ── W2-4 Task 8: step 0a, end to end (W2-D57, W2-D55, W2-D24, W2-D52, W2-D51) ──────────────────────────────────
// `step0a` runs once per named node before pilot sourcing (W2 decisions §5, act 7). It spends, so it takes every
// refusal before its first spawn: the pane and the arguments (main), HOME, every required flag (D-5815: --out,
// --account, --budget, --writer-model, --judge-model and --arm-model, so a missing one never leaves a fresh --out
// behind; W2-D55: no budget default before part 1), the settings mode (D-5815, so a bogus one leaves no --out
// either), the unusable inputs (D-5813), --out (Task 2), the claim (D-5985) and the account (Task 3). It then
// measures what it records but never compares: codeShas() over the tree it runs from and the installed release
// stamp (W2-D24; part 1's validator compares them with gate_code). Neither has an "unmeasured" spelling in the
// record, so an unmeasured one refuses here, with the preflight's own word (Task 7's rule): code-unmeasured
// or tree-unmeasured (coordinator rulings), its detail saying what could not be read. The wrapper sha is taken next,
// before any spawn or spend, so a wrapper that cannot be read refuses wrapper-unmeasured here (Task 7's wrapperSha;
// coordinator ruling). Then the limits and budget gate, the launcher's --version
// (a spawn that spends nothing, gated all the same), and one batch of three runs on one prompt, one at a time so
// the budget gate sees each finished run's spend before the next starts: the writer and the judge (--tools "")
// and one box-mode run (--tools Bash,Agent and the three spellings), so every flag the contract uses reaches the
// launcher once. A finished run is skipped on a re-run over the same --out (Task 5's run.json), and its facts are
// re-read from its stream file. A run that fails or rejects a flag is a finding, recorded, not a refusal.
// D-5812: the launch step 0a measured (account, Claude Code version, wrapper sha256) is pinned in
// `<out>/step0a/launch.json` before the first run, and a resume compares what it measures now with it, so the
// record never pairs one version's init events and flags with another version's name: a version that moved refuses
// claude-version-moved, a wrapper that moved wrapper-moved (both measured mismatches only), another account
// out-refused, and a launch.json that cannot be read as one out-refused. A flag is recorded accepted only when
// no run named it unknown and a run that carried it reached its init event (flagsAccepted).
// The record is canonicalJson + '\n' at <out>/step0a.json, written whole (tmp, then rename), and its sha256 is
// printed over the bytes read back from that file, the bytes the operator hands pilot-source as --step0a-sha256.
// D-5983: the line `sha256 <hex>` goes on stderr and stdout stays empty, as open and freeze print theirs.
// STEP0A_KIND and STEP0A_FIELDS are Task 7's (loadStep0a reads them first); this section never declares them again.
// HOME and LANG come from main's env parameter only, LANG threaded into each RunJob and into the --version spawn.
export const STEP0A_FILE = 'step0a.json';
export const STEP0A_PROMPT = 'Reply with the single word: ready. Do not use any tool.';
const STEP0A_RUNS = Object.freeze([
  Object.freeze({ key: 'writer', mode: 'writer', modelFlag: 'writer-model' }),
  Object.freeze({ key: 'judge', mode: 'judge', modelFlag: 'judge-model' }),
  Object.freeze({ key: 'box', mode: 'box', modelFlag: 'arm-model' }),
]);

/** step 0a's required flags, in the order a missing one is reported (D-5815). Every one is checked before
 *  refuseUnusableInputs and prepareOut, so a missing flag never leaves a fresh --out behind. */
const STEP0A_REQUIRED = Object.freeze(['out', 'account', 'budget', 'writer-model', 'judge-model', 'arm-model']);

/** D-5813: --out's realpath, which prepareOut answers, must not hold ':' either: an ancestor symlink can lead to a path
 *  that does while the spelling given did not, and the realpath is what spawnEnv receives. Called right after prepareOut,
 *  before any roster read or spawn.
 *  @param {string} out prepareOut's answer */
function refuseColonInRealOut(out) {
  if (out.includes(':')) refuse('args-invalid', "out contains ':'");
}

/** D-5813: the operator inputs that would otherwise surface as a TypeError (exit 1) from spawnArgv or spawnEnv after
 *  --out is made, or after step 0a's writer run has spent. HOME and the resolved --out must not hold ':' (PATH's
 *  separator), and every model flag given must be a model id (MODEL_RE). An absent model flag passes here: that branch is
 *  defence only, since both handlers check their required flags first (D-5815) and refuse `<flag>-required` before this
 *  runs. The TypeErrors stay as defence.
 *  @param {string} home  @param {string} outArg
 *  @param {ReadonlyArray<readonly [string, unknown]>} models flag name and value */
function refuseUnusableInputs(home, outArg, models) {
  if (home.includes(':')) refuse('args-invalid', "HOME contains ':'");
  if (path.resolve(outArg).includes(':')) refuse('args-invalid', "out contains ':'");
  for (const [flag, value] of models) {
    if (value !== undefined && !MODEL_RE.test(value)) {
      refuse('args-invalid', `${flag} ${JSON.stringify(value)} is not a model id`);
    }
  }
}

/** Every flag the runs' argvs carry (a token that starts with '-'; no contract value does). A flag is true only when
 *  no run reported it as an unknown option AND at least one run whose argv carries it emitted an init event
 *  (`facts.init !== null`): a flag whose every run died before Claude Code reached its init was not measured, and
 *  records false, never true (D-5812). The `*_init` nulls cannot tell "rejected" from "not reached" (a flag rejected as
 *  unknown also exits before init); each `<name>.run.json` holds the run's unknown-option names. The
 *  argvs and outcomes are parallel. Pure.
 *  @param {ReadonlyArray<readonly string[]>} argvs
 *  @param {ReadonlyArray<{ unknownOptions: readonly string[], facts: { init: object | null } }>} outcomes
 *  @returns {Record<string, boolean>} */
export function flagsAccepted(argvs, outcomes) {
  const unknown = new Set(outcomes.flatMap((o) => o.unknownOptions));
  const reached = new Set();
  argvs.forEach((argv, i) => {
    if (outcomes[i].facts.init !== null) for (const t of argv) reached.add(t);
  });
  const out = {};
  for (const argv of argvs) for (const t of argv) if (t.startsWith('-')) out[t] = !unknown.has(t) && reached.has(t);
  return out;
}

const STEP0A_DIR = 'step0a';
const STEP0A_LAUNCH_FILE = 'launch.json';
const STEP0A_LAUNCH_KIND = 'ccrc-history-replay-step0a-launch';
const STEP0A_LAUNCH_MAX_BYTES = 4096;

/** D-5812: pin the launch step 0a measured in `<dir>/launch.json`, or compare it with the pinned one. Absent: written
 *  whole (tmp, then rename, 0600). Present: a file that is not a regular file, does not parse or has the wrong kind,
 *  version or shape refuses out-refused (step0a-launch-invalid); another account refuses out-refused
 *  (step0a-launch-mismatch); another Claude Code version refuses claude-version-moved and another wrapper
 *  wrapper-moved, each naming both values.
 *  @param {string} out  @param {{account: string, version: string, wrapper: string | null}} now */
function pinStep0aLaunch(out, now) {
  const rel = `${STEP0A_DIR}/${STEP0A_LAUNCH_FILE}`;
  const read = readPlain(path.join(out, rel), STEP0A_LAUNCH_MAX_BYTES);   // D-5986: type-checked, bounded, no-follow
  if (read.state === 'absent') {
    const rec = { kind: STEP0A_LAUNCH_KIND, v: 1, account: now.account, claude_code_version: now.version, wrapper_sha256: now.wrapper };
    writePlain(out, rel, canonicalJson(rec) + '\n');
    return;
  }
  if (read.state === 'bad') refuse('out-refused', 'step0a-launch-invalid');
  let rec;
  try {
    rec = JSON.parse(read.bytes.toString('utf8'));
  } catch {
    refuse('out-refused', 'step0a-launch-invalid');
  }
  if (rec === null || rec.kind !== STEP0A_LAUNCH_KIND || rec.v !== 1
    || typeof rec.account !== 'string' || typeof rec.claude_code_version !== 'string'
    || !(rec.wrapper_sha256 === null || typeof rec.wrapper_sha256 === 'string')) refuse('out-refused', 'step0a-launch-invalid');
  if (rec.account !== now.account) refuse('out-refused', 'step0a-launch-mismatch');
  if (rec.claude_code_version !== now.version) {
    refuse('claude-version-moved', `step0a recorded ${JSON.stringify(rec.claude_code_version)}, now ${JSON.stringify(now.version)}`);
  }
  if (rec.wrapper_sha256 !== now.wrapper) {
    refuse('wrapper-moved', `step0a recorded ${JSON.stringify(rec.wrapper_sha256)}, now ${JSON.stringify(now.wrapper)}`);
  }
}

export async function step0aCommand(flags, env) {
  // W2-5a Task 7: the driver's flags now include many step 0a never reads; one given is refused, never ignored (as the probe's).
  for (const k of Object.keys(flags)) if (!STEP0A_REQUIRED.includes(k) && k !== 'settings-mode') refuse('args-invalid', `--${k} is not a step0a flag`);
  if (typeof env.HOME !== 'string' || !path.isAbsolute(env.HOME)) refuse('args-invalid', 'HOME is unset or not absolute');
  const home = path.resolve(env.HOME);   // D-5813: one spelling of HOME for every path and every taught spelling below
  // D-5815: every required flag first, before --out is made and before admission (a missing --budget answers
  // args-invalid even for an account admission would refuse).
  for (const k of STEP0A_REQUIRED) if (flags[k] === undefined) refuse('args-invalid', `${k}-required`);
  // D-5815: the settings mode is a usage check too, as the probe's: a bogus value leaves no fresh --out behind.
  const settingsMode = flags['settings-mode'] ?? 'restricted';
  if (!SETTINGS_MODES.includes(settingsMode)) refuse('args-invalid', `settings-mode ${settingsMode}`);
  const outArg = flags.out;
  refuseUnusableInputs(home, outArg, STEP0A_RUNS.map((r) => [r.modelFlag, flags[r.modelFlag]]));
  const out = prepareOut(outArg);
  refuseColonInRealOut(out);
  const claim = claimOut(out);   // D-5985: one driver per --out, every leftover settled, before the roster read
  try {
    const { json, roster } = readRoster(home);
    const launch = admitAccount(json, roster, flags.account, home);
    const budget = flags.budget;
    const models = Object.fromEntries(STEP0A_RUNS.map((r) => [r.key, flags[r.modelFlag]]));
    const shas = codeShas();
    if (shas.state !== 'measured') refuse('code-unmeasured', `${shas.path} is ${shas.cause}`);
    const stamp = readReleaseStamp(home);
    if (stamp.state !== 'value') refuse('tree-unmeasured', `stamp ${stamp.state}${stamp.code === undefined ? '' : ` ${stamp.code}`}`);
    // Before any spawn or spend: an unreadable wrapper refuses wrapper-unmeasured here, never after the batch has spent.
    const wrapperSha256 = wrapperSha(launch);
    const gate = batchGate({ out, home, accountId: launch.accountId, budget, limits: LIMITS_DEFAULTS });
    gate();
    const version = await measureClaudeVersion(launch, out, env.LANG);
    refuseIfStopping();   // D-5984: before the version's state is read, so a killed --version reports `interrupted`
    // A --version that cannot be measured is a refusal (coordinator ruling), never a guessed or recorded version.
    if (version.state !== 'value') refuse('version-unmeasured', `${launch.launcher} --version failed (code ${version.code}, signal ${version.signal})`);
    ensurePlainDir(out, STEP0A_DIR);   // D-5986: a link or a file there refuses out-refused
    pinStep0aLaunch(out, { account: launch.accountId, version: version.version, wrapper: wrapperSha256 });
    const jobs = STEP0A_RUNS.map((r) => ({
      launch, mode: r.mode, model: models[r.key], settingsMode, stdin: STEP0A_PROMPT, out, name: `${STEP0A_DIR}/${r.key}`, lang: env.LANG,
    }));
    const outcomes = await runBatch(jobs, { concurrency: 1, gate, claim });
    const init = Object.fromEntries(jobs.map((j, i) => {
      const stream = readPlain(path.join(out, `${j.name}.jsonl`), OUT_STREAM_CAP);
      if (stream.state !== 'bytes') refuse('out-refused', `run-stream-invalid ${j.name}`);
      return [STEP0A_RUNS[i].key, readStreamJson(stream.bytes.toString('utf8')).init];
    }));
    const output = {
      kind: STEP0A_KIND, v: 1, measured_ms: Date.now(), account: launch.accountId, settings_mode: settingsMode,
      claude_code_version: version.version, wrapper_sha256: wrapperSha256,
      flags_accepted: flagsAccepted(jobs.map((j) => spawnArgv({ mode: j.mode, model: j.model, settingsMode, home })), outcomes),
      writer_init: init.writer, judge_init: init.judge, box_init: init.box,
      code_shas: shas.files, release_stamp: stamp.tag, budget, spend: spentSoFar(out),
    };
    writePlain(out, STEP0A_FILE, canonicalJson(output) + '\n');
    process.stderr.write(`sha256 ${shaOfPlain(out, STEP0A_FILE)}\n`);   // D-5983: stderr, as open and freeze print it; stdout stays empty
    return EXIT.OK;
  } finally {
    claim.release();
  }
}
HANDLERS.set('step0a', step0aCommand);

// ── W2-4 Task 9: the probe, and step 0b's seam-free mechanics (W2-D58, W2-D57, W2-D55) ─────────────────────────
// The probe is a box verb, an EARLY CHECK only (W2-D58): it asks a box-mode run (an arm's tools and argv, no
// CCRC_RECALL_* value) to call each taught spelling once with `history status --json`, the one verb that needs
// no identity, and records what the stream shows. A finding is data: the probe exits 0 whatever it found, and
// only a driver word (a refusal before or between spawns) is non-zero. The spec's treatment-arm pilot
// assertions are W2-5b's, at step 0b.
// Step 0b's two mechanics that need no seam (W2-D57) ship here as exports; W2-5b wires them into its `step0b`
// subcommand after part 1, behind its own gate (every spawn is gated, W2-D55):
//   - the turn bound: a twenty-call request (repeated calls of an allowed spelling) must be stopped by the max-turns
//     limit within MAX_TURNS assistant turns. It is held only when the result event's subtype shows that stop AND the
//     assistant turn count is within MAX_TURNS (coordinator ruling); past MAX_TURNS it is false; a run that ended
//     within the bound for any other reason, or with no result event, is 'unmeasured', never held;
//   - the persistence check: no transcript named by the init event's session_id anywhere under
//     `<configDir>/projects/`, and no `<configDir>/projects/<slug of the run's cwd>` entry. A run whose init
//     event carried no session_id cannot be cleared, so it reads as left, never as clean.

/** The kind word of `<out>/probe.json`. */
export const PROBE_KIND = 'ccrc-history-w2-probe';
/** The flags the probe takes. parseArgs knows every driver flag; a flag the probe never reads is refused, not ignored. */
const PROBE_FLAGS = Object.freeze(['out', 'account', 'budget', 'arm-model', 'settings-mode']);
const PROBE_REQUIRED = Object.freeze(['out', 'account', 'arm-model', 'budget']);   // D-5815: --budget is checked here, before --out is made
/** The probe's runs and streams live under `<out>/probe/`. */
const PROBE_RUN_DIR = 'probe';
const PROBE_OUTPUT = 'probe.json';
/** The step 0b turn-bound run's name under --out. */
const STEP0B_TURN_RUN = 'step0b/turn-bound';
const TAUGHT_SPELLING = /^Bash\((.+) history:\*\)$/;
/** The result event's `subtype` when the --max-turns limit stopped the run. The field is the one readStreamJson reads
 *  (`result.subtype`; step 0a's and the probe's streams show it as `success`). The value is Claude Code's headless
 *  spelling for this stop, unmeasured on this fleet until step 0b's turn-bound run first reaches the bound; that
 *  run's turn_bound records the subtype it read, and any other spelling reads 'unmeasured', never held. */
export const MAX_TURNS_STOP_SUBTYPE = 'error_max_turns';

/** The step 0b turn-bound request: twenty separate Bash calls of `~/.local/bin/ccrc history status --json`, which the
 *  third taught spelling admits (`Bash(~/.local/bin/ccrc history:*)`), so the model is driven through repeated ALLOWED
 *  calls rather than stopped by denials. Under --max-turns 12 the run must end within 12 turns whatever the model would
 *  have done; turnBoundHeld reads it as held only when the result event shows the max-turns stop within 12 assistant
 *  turns. */
export const TURN_PROBE_PROMPT = [
  'This is a turn-limit check. Make twenty separate Bash tool calls, one after another.',
  'Each call runs exactly the command `~/.local/bin/ccrc history status --json` and nothing else.',
  'Do not combine calls, do not use a loop, and wait for each call\'s result before making the next.',
  'If a call is refused or fails, make the next call anyway. After the twentieth call, reply with the single word DONE.',
].join('\n') + '\n';

/** The command line a taught spelling admits for the probe: the spelling's prefix plus `history status --json`. */
function probeCommandOf(spelling) {
  // String#match, not the RegExp method: Task 5's no-shell scan reds on any non-comment call spelled exec.
  const m = spelling.match(TAUGHT_SPELLING);
  if (m === null) throw new TypeError(`probe: ${JSON.stringify(spelling)} is not a taught spelling`);
  return `${m[1]} history status --json`;
}

/** The probe's prompt for one spelling: run exactly that command once, then stop. */
function probePromptOf(command) {
  return [
    'This is a permission check. Use the Bash tool exactly once, to run exactly this command, with nothing added before or after it:',
    '',
    command,
    '',
    'Do not run any other command. After the one call, reply with the single word DONE.',
  ].join('\n') + '\n';
}

const bashCommandOf = (input) => (input !== null && typeof input === 'object' && typeof input.command === 'string' ? input.command : null);

/** What one probe run's stream shows for its command: the Bash calls asking for exactly it (`ran`), whether a
 *  permission denial names one of them, by tool_use_id or by its input (`denied`), and whether any of their
 *  tool_results is an error (`tool_error`, null when none came back). `result_seen` says whether the stream
 *  holds a result event carrying `permission_denials` at all: without one, `denied: false` measured nothing. */
function probeFindingOf(facts, command) {
  const calls = facts.toolPairs.filter((p) => p.name === 'Bash' && bashCommandOf(p.input) === command);
  const ids = new Set(calls.map((p) => p.id));
  const denials = Array.isArray(facts.permissionDenials) ? facts.permissionDenials : [];
  const denied = denials.some((d) => d !== null && typeof d === 'object'
    && ((typeof d.tool_use_id === 'string' && ids.has(d.tool_use_id)) || bashCommandOf(d.tool_input) === command));
  const errors = calls.map((p) => p.isError).filter((e) => typeof e === 'boolean');
  return {
    denied,
    tool_error: errors.length === 0 ? null : errors.includes(true),
    ran: calls.length > 0,
    result_seen: facts.result !== null && Array.isArray(facts.permissionDenials),
  };
}

/** Write `<out>/probe.json` as canonical JSON plus a newline, through a temp and a rename, and answer the sha256
 *  of the bytes on disk. */
function writeProbeJson(out, value) {
  writePlain(out, PROBE_OUTPUT, canonicalJson(value) + '\n');
  return shaOfPlain(out, PROBE_OUTPUT);
}

/** The sha256 of the bytes `<out>/<rel>` holds now, read back through readPlain (D-5986). */
function shaOfPlain(out, rel) {
  const read = readPlain(path.join(out, rel), OUT_JSON_CAP);
  if (read.state !== 'bytes') refuse('out-refused', `${rel} is not a regular file`);
  return sha256Hex(read.bytes);
}

/** `probe`: pane and args (main), then, in the code's order: unknown flags (a flag the probe never reads), required flags
 *  (--budget included, D-5815), the settings mode, HOME, the unusable inputs (D-5813), `prepareOut`, the realpath ':'
 *  check (D-5813), `claimOut` (D-5985), the roster and admission, the launcher's X_OK, and the gate before every spawn,
 *  so every one of those refusals lands before the first spawn. A refusal can also land after one: the gate's stops before
 *  a later spawn (`budget-exhausted`, the limits words, and `out-refused` `spend.jsonl …` when the ledger cannot be read
 *  whole), `interrupted`, every `out-refused` a run's files raise after its spawn (the `.pid` write, the stream read, the
 *  spend line, the removals, the rename, run.json), and the post-batch ones that are not a run's files: the final
 *  `spentSoFar` read into the output (`out-refused` on a torn ledger, after every spawn) and the write of `probe.json` and
 *  its sha read-back. Then one box-mode run per taught spelling (at most two at once), `<out>/probe.json`, and
 *  `sha256 <hex>` on stderr (D-5983), stdout empty. Exit 0 whatever the runs showed; a refusal exits 2, and a defect or a
 *  race-only raw error exits 1. */
export async function probeCommand(flags, env) {
  for (const k of Object.keys(flags)) if (!PROBE_FLAGS.includes(k)) refuse('args-invalid', `--${k} is not a probe flag`);
  for (const k of PROBE_REQUIRED) if (flags[k] === undefined) refuse('args-invalid', `${k}-required`);
  const settingsMode = flags['settings-mode'] ?? 'restricted';
  if (!SETTINGS_MODES.includes(settingsMode)) refuse('args-invalid', `settings-mode ${settingsMode}`);
  if (typeof env.HOME !== 'string' || !path.isAbsolute(env.HOME)) refuse('args-invalid', 'HOME is unset or not absolute');
  const home = path.resolve(env.HOME);   // D-5813: one spelling of HOME for the argv, the prompts and probe.json
  refuseUnusableInputs(home, flags.out, [['arm-model', flags['arm-model']]]);
  const out = prepareOut(flags.out);
  refuseColonInRealOut(out);
  const claim = claimOut(out);   // D-5985: one driver per --out, every leftover settled, before the roster read
  try {
    const { json, roster } = readRoster(home);
    const launch = admitAccount(json, roster, flags.account, home);
    // D-5813: an absent or non-executable launcher is an account that cannot be launched, a driver refusal, not a raw spawn error.
    try {
      accessSync(launch.launcher, constants.X_OK);
    } catch (e) {
      refuse('account-refused', `launcher-${e?.code ?? 'unknown'}`);
    }
    const gate = batchGate({ out, home, accountId: launch.accountId, budget: flags.budget, limits: LIMITS_DEFAULTS });
    const spellings = allowedToolSpellings(home);
    const jobs = spellings.map((spelling, i) => ({
      launch, mode: 'box', model: flags['arm-model'], settingsMode,
      stdin: probePromptOf(probeCommandOf(spelling)), out, name: `${PROBE_RUN_DIR}/spelling-${i + 1}`, lang: env.LANG,
    }));
    const outcomes = await runBatch(jobs, { concurrency: CONCURRENCY_MAX, gate, claim });
    const output = {
      kind: PROBE_KIND, v: 1, measured_ms: Date.now(), account: launch.accountId, settings_mode: settingsMode,
      model: flags['arm-model'],
      spellings: spellings.map((spelling, i) => ({ spelling, ...probeFindingOf(outcomes[i].facts, probeCommandOf(spelling)) })),
      budget: flags.budget, spend: spentSoFar(out),
    };
    const sha = writeProbeJson(out, output);
    process.stderr.write(`sha256 ${sha}\n`);   // D-5983: stderr, as open and freeze print it; stdout stays empty
    return EXIT.OK;
  } finally {
    claim.release();
  }
}
HANDLERS.set('probe', probeCommand);

/** Step 0b's turn bound (W2-D57; coordinator ruling, as revised). `held` is true ONLY when the result event shows that
 *  the max-turns limit stopped the run (its subtype is MAX_TURNS_STOP_SUBTYPE) AND the run made at most maxTurns
 *  assistant turns (readStreamJson's assistantMessages). More than maxTurns assistant turns is false: the bound did
 *  not hold, whatever the result event says. A run that ended within the bound for any other reason (another subtype,
 *  or no result event) is 'unmeasured', never true. `turns` is the assistant turn count the verdict read; the result
 *  event's num_turns and subtype (null without one) are recorded beside it, so a reader sees why. No tool-call count
 *  enters the verdict. Pure. */
export function turnBoundHeld(facts, maxTurns = MAX_TURNS) {
  if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new TypeError(`turnBoundHeld: maxTurns ${String(maxTurns)} is not a positive integer`);
  const turns = facts.assistantMessages;
  const numTurns = facts.result === null ? null : facts.result.numTurns;
  const subtype = facts.result === null ? null : facts.result.subtype;
  if (turns > maxTurns) return { held: false, turns, num_turns: numTurns, subtype };
  if (subtype !== MAX_TURNS_STOP_SUBTYPE) return { held: 'unmeasured', turns, num_turns: numTurns, subtype };
  return { held: true, turns, num_turns: numTurns, subtype };
}

/** Claude Code's project directory name for a cwd: every non-alphanumeric character becomes '-'. Pure. */
export function projectSlugOf(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new TypeError(`projectSlugOf: cwd ${JSON.stringify(cwd)} is not absolute`);
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

/** Every entry under `root` (real directories walked, links never followed) whose name is the session id or starts
 *  with it and a dot, as paths relative to `root`, sorted. An absent root is none; any other read failure throws. */
function entriesNamedBy(root, sessionId) {
  const found = [];
  const walk = (rel) => {
    let ents;
    try {
      ents = readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch (e) {
      if (rel === '' && e.code === 'ENOENT') return;
      throw e;
    }
    for (const d of ents) {
      const r = rel === '' ? d.name : `${rel}/${d.name}`;
      if (d.name === sessionId || d.name.startsWith(`${sessionId}.`)) found.push(r);
      else if (d.isDirectory()) walk(r);
    }
  };
  walk('');
  return found.sort();
}

/** Step 0b's persistence check (W2-D57): what a `--no-session-persistence` run left under `<configDir>/projects/`.
 *  `transcripts`: entries named by the init event's session_id anywhere under it; `projectDir`: whether
 *  `projects/<slug of the run's cwd>` exists, whatever its type. A null session id leaves the transcript half
 *  unmeasured, so `left` is true. An lstat or readdir failure other than ENOENT throws, never reads as clean. */
export function persistenceLeft({ configDir, sessionId, cwd }) {
  if (typeof configDir !== 'string' || !path.isAbsolute(configDir)) throw new TypeError(`persistenceLeft: configDir ${JSON.stringify(configDir)} is not absolute`);
  if (sessionId !== null && (typeof sessionId !== 'string' || sessionId === '' || sessionId.includes('/') || sessionId.startsWith('.'))) {
    throw new TypeError(`persistenceLeft: sessionId ${JSON.stringify(sessionId)} is not a session id`);
  }
  const projects = path.join(configDir, 'projects');
  let projectDir = true;
  try {
    lstatSync(path.join(projects, projectSlugOf(cwd)));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    projectDir = false;
  }
  const transcripts = sessionId === null ? [] : entriesNamedBy(projects, sessionId);
  return { left: sessionId === null || projectDir || transcripts.length > 0, transcripts, projectDir };
}

/** Step 0b's mechanics without the seam (W2-D57): one box-mode run of TURN_PROBE_PROMPT named 'step0b/turn-bound'
 *  (resumed from its run.json when it finished before), then the turn bound over its stream and the persistence
 *  check over the account's config dir, keyed by that run's init session_id and its cwd. The run goes through runBatch
 *  with the caller's required `gate` (W2-5b passes its batchGate) and `claim` (claimOut's, D-5985), so it is gated and
 *  claimed like every spawn; the caller also
 *  passes `lang`, its LANG from main's env (undefined when unset), into the run's RunJob. */
export async function step0bMechanics({ launch, out, model, settingsMode, lang, gate, claim }) {
  const [run] = await runBatch([{ launch, mode: 'box', model, settingsMode, stdin: TURN_PROBE_PROMPT, out, name: STEP0B_TURN_RUN, lang }], { concurrency: 1, gate, claim });
  const left = persistenceLeft({
    configDir: launch.configDir, sessionId: run.facts.init === null ? null : run.facts.init.sessionId, cwd: run.cwd,
  });
  return {
    turn_bound: turnBoundHeld(run.facts),
    persistence: { left: left.left, transcripts: left.transcripts, project_dir: left.projectDir },
  };
}

// ── W2-5a Task 1: reconstruction reads the store through W2-1's exports (W2-D74, W2-D75, W2-D33, W2-D68 (2), W2-D54) ──
// Boundary N's payload (spec §10.2 "Reconstruction", items 1 to 3) is built on the node that holds the store, and this
// file decodes nothing itself (W2-D74):
//   - the store opens through store.mjs's openReader (read-only, query_only; W2-D51), and the run's pair index is
//     cli.mjs's pairIndexOf, built once per open (W2-D54, W2-D67);
//   - N's holding copy is derive.mjs's holdingCopyOf (lib's pickHoldingCopy), and N's summary row is lib's
//     summaryRowFor over that copy's rows, as derivation picks it: a harness user row (an echo) is never the pick;
//   - kept(N) is the string members of the blob boundaries.kept_blob_id names, read through derive.mjs's bodyOf over
//     blobReadStmts: W2-D34's option (a), the membership the as-of cut keeps visible (W2-D38). A NULL id discards N as
//     kept-absent; a body that is not a list (a tombstone, a damaged or over-cap blob, JSON that is not a list) as
//     kept-unreadable, never an empty list. derive.mjs's keptOf folds all three into one empty set, so this file never
//     calls it (W2-D33, W2-D68), and history-replay.test.ts scans every deploy/*.mjs for its name;
//   - an entry's body is recall.mjs's expandEntryBody, expand's own pick (the unsanitised ccd-sanitize variant when
//     there is one, DM2b). Of its five words (D-6238), 'body' is read; 'unparseable' (a raw-only row's stored text) is
//     read as text for a kept member and counted, and discards N for the summary row, whose pointer line cannot be found
//     in a line that was never parsed; 'tombstone', 'over-cap' and 'undecodable' each discard N under a word of its own,
//     never folded: a damaged blob is not a pruned one;
//   - every field passes whole through redactForSpawn, a tool_result through toolResultText, before any cut (W2-D54).
// A discard is a count by its RECON_DISCARDS word, never a refusal. A store that cannot be opened or read refuses
// store-unreadable.

/** Every word a boundary is discarded with (R5): reconstruction's come first (W2-D68, W2-D75, W2-D54), then the words
 *  Tasks 2 to 4 append here in place (mining's span words, admission's verdicts, Baseline B's), and `body-unrenderable`
 *  (D-6302, a body that parses and cannot be rendered; mining discards with it too, D-6303) is kept LAST: an appending task
 *  inserts before it, as W2-5b1 Task 2 inserts `card-unrenderable` (a node id the store holds that lib's card grammar
 *  refuses). Counts, never refusals, and never a DRIVER_REASONS or GATE_REASONS word. */
export const RECON_DISCARDS = Object.freeze([
  'boundary-absent', 'boundary-uncopied',
  'summary-absent', 'summary-unparseable', 'summary-tombstone', 'summary-over-cap', 'summary-undecodable',
  'kept-absent', 'kept-unreadable',
  'member-tombstone', 'member-over-cap', 'member-undecodable',
  'over-decode-cap', 'leaf-absent',
  'span-unparseable', 'span-tombstone', 'span-over-cap', 'span-undecodable',
  'no-epoch', 'ts-null', 'before-other', 'before-unknown', 'after-other', 'after-unknown',
  'copy-moved', 'summary-unreadable', 'kept-member-unreadable', 'post-row-unreadable', 'post-over-cap',
  'cwd-unknown', 'cwd-missing', 'cwd-unreadable', 'file-unreadable', 'file-not-regular', 'file-over-cap',
  'card-unrenderable',
  'body-unrenderable',
]);
/** expandEntryBody's three body-less words (D-6238), each mapped to a discard word of its own. entryBodyOf throws on any
 *  other word, so neither map is ever read with a key it lacks (D-6301). */
const SUMMARY_LOST = Object.freeze({ tombstone: 'summary-tombstone', 'over-cap': 'summary-over-cap', undecodable: 'summary-undecodable' });
const MEMBER_LOST = Object.freeze({ tombstone: 'member-tombstone', 'over-cap': 'member-over-cap', undecodable: 'member-undecodable' });
/** What item 1 puts in place of a transcript-pointer line (spec §10.2 "Reconstruction", item 1). */
export const POINTER_REMOVED = '[pointer removed]';
/** A transcript-pointer line: a whole line naming a path that ends in .jsonl (D-6277). */
const POINTER_LINE_RE = /^.*\/\S*\.jsonl(?![A-Za-z0-9_]).*$/gm;

/** @param {string} why a RECON_DISCARDS word  @returns {{ state: 'discard', why: string }} */
const reconDiscard = (why) => ({ state: 'discard', why });

/** Item 1's pointer rule: each whole line that names a .jsonl path becomes POINTER_REMOVED, and `replaced` counts them. Pure.
 *  @param {string} text  @returns {{ text: string, replaced: number }} */
export function removePointerLines(text) {
  let replaced = 0;
  const out = text.replace(POINTER_LINE_RE, () => { replaced += 1; return POINTER_REMOVED; });
  return { text: out, replaced };
}

/** Items 1 to 3 (W2-D75), joined by one blank line: the summary, each kept member, then the question followed by
 *  ANSWER_PROTOCOL (W2-D64, D-5776). Pure; the parts and the question come already redacted. An empty question and
 *  empty parts still carry the protocol: the fidelity pilot's empty-question run composes through here (Task 6).
 *  @param {{ summary: string, kept: readonly string[] }} parts  @param {string} question  @returns {string} */
export function composePayload(parts, question) {
  return [parts.summary, ...parts.kept, `${question}\n\n${ANSWER_PROTOCOL}`].join('\n\n');
}

/** One tool_use as item 2 and the writer's paired line render it: `[tool_use <name>] <input>`, lib's renderEntryText of
 *  that one block when `inputText` is the JSON of its input. Pure.
 *  @param {string} name  @param {string} inputText  @returns {string} */
export function renderToolUseLine(name, inputText) {
  return `[tool_use ${name}] ${inputText}`;
}

/** The summary row of boundary `boundaryUuid` in one copy: lib's summaryRowFor pick over the meta derive.mjs's copyPlan
 *  builds (a summary is an is_compact_summary row; an echo is a user row of harness provenance, never the pick), as its
 *  index in `copyRows`. -1 when lib picks none, or names a row this copy does not hold. Pure; the driver's one summary
 *  pick, which boundaryCopyOf applies for the payload, admission (Task 3) and Baseline B (Task 4).
 *  @param {Array<{uuid: string, type: string, provenance: string, is_compact_summary: number}>} copyRows
 *  @param {string} boundaryUuid  @param {string|null} anchorUuid  @returns {number} */
export function summaryIndexOf(copyRows, boundaryUuid, anchorUuid) {
  const meta = copyRows.map((r) => ({ uuid: r.uuid, isCompactSummary: r.is_compact_summary === 1, isEcho: r.type === 'user' && r.provenance === 'harness' }));
  const pick = summaryRowFor({ boundaryUuid, anchorUuid, rows: meta });
  return pick.uuid === null ? -1 : copyRows.findIndex((r) => r.uuid === pick.uuid);
}

/** Leaf N's node id, for boundary N's entry id (one `?`): the depth-0 node whose boundary_entry_id is N, the lowest id if
 *  several are (derivation writes one). The span reader and the card (W2-5b1 Task 2) read leaf N through this one text. */
const LEAF_OF_BOUNDARY_SQL = 'SELECT node_id FROM nodes WHERE boundary_entry_id = ? AND depth = 0 ORDER BY node_id LIMIT 1';

/** The statements reconstruction reads with, prepared once per open. They read no body: bodies are read only through
 *  bodyOf and expandEntryBody (W2-D74). */
function replayStmts(db) {
  return {
    boundary: db.prepare(`SELECT b.entry_id AS entry_id, b.transcript_pk AS transcript_pk, b.kept_blob_id AS kept_blob_id,
        b.anchor_uuid AS anchor_uuid, e.uuid AS uuid
      FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id WHERE b.entry_id = ?`),
    copyRows: db.prepare(`SELECT m.line AS line, e.entry_id AS entry_id, e.uuid AS uuid, e.type AS type, e.model AS model,
        e.provenance AS provenance, e.is_compact_summary AS is_compact_summary, e.ts_ms AS ts_ms, e.blob_id AS blob_id
      FROM memberships m JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = ? ORDER BY m.line`),
    keptRows: db.prepare(`SELECT e.entry_id AS entry_id, e.uuid AS uuid, e.type AS type, e.blob_id AS blob_id, m.line AS line
      FROM entries e LEFT JOIN memberships m ON m.file_id = ? AND m.entry_id = e.entry_id
      WHERE e.uuid IN (SELECT value FROM json_each(?))
      ORDER BY m.line IS NULL, m.line, e.entry_id`),
    span: db.prepare(`SELECT e.entry_id AS entry_id, e.uuid AS uuid, e.type AS type, e.model AS model, e.provenance AS provenance,
        e.ts_ms AS ts_ms, e.blob_id AS blob_id
      FROM node_sources s JOIN entries e ON e.entry_id = s.entry_id
      WHERE s.node_id = (${LEAF_OF_BOUNDARY_SQL})
      ORDER BY s.ord`),
    storeId: db.prepare("SELECT v FROM meta WHERE k = 'store_id'"),
  };
}

/** @typedef {{ db: ReturnType<typeof openReader>, storeId: string, version: number, schema: typeof SCHEMA_ADDED,
 *    blobs: ReturnType<typeof blobReadStmts>, stmts: ReturnType<typeof replayStmts>,
 *    idx: import('../ccd/history/lib.mjs').PairIndex, close: () => void }} ReplayStore */

/** This node's store, open for the run (W2-D51, W2-D33, W2-D54): a read-only, query_only handle, this node's store id
 *  (meta.store_id, read through the same handle), its user_version and SCHEMA_ADDED (the `rc` expandEntryBody reads
 *  columns by, DM44), the two blob reads bodyOf needs, this section's statements, and the run's pair index, built once
 *  here through cli.mjs's pairIndexOf. Every subcommand opens the store once, here, and passes it down (R3). A store
 *  openReader refuses (missing, zero-byte, unmeasured), one with no UUID store id, or one whose first reads fail in
 *  SQLite, refuses store-unreadable.
 *  @param {string} home  @returns {ReplayStore} */
export function openReplayStore(home) {
  let db;
  try {
    db = openReader(historyPaths(home).dbFile);
  } catch (e) {
    storeRefusal(e);
  }
  try {
    const stmts = replayStmts(db);
    const id = stmts.storeId.get();
    if (id === undefined || !UUID_RE.test(String(id.v))) refuse('store-unreadable', id === undefined ? 'store-id-absent' : 'store-id-unreadable');
    return { db, storeId: String(id.v), version: userVersion(db), schema: SCHEMA_ADDED, blobs: blobReadStmts(db), stmts, idx: pairIndexOf(db, home), close: () => db.close() };
  } catch (e) {
    try { db.close(); } catch { /* the first throw is the signal */ }
    storeRefusal(e);
  }
}

/** D-6481's bounded retained masking snapshots. These are logical material charges, not a V8 heap claim. */
const MASKING_SNAPSHOT_MAX = 8;
const MASKING_SNAPSHOT_MATERIAL_MAX = 16_777_216;
const MASKING_SNAPSHOT_MATERIAL_TOTAL_MAX = 67_108_864;
class MaskingSnapshotError extends Error {
  /** @param {'invalid' | 'material'} kind */
  constructor(kind) { super(kind); this.kind = kind; }
}
const maskingInvalid = () => { throw new MaskingSnapshotError('invalid'); };
const maskingMaterial = () => { throw new MaskingSnapshotError('material'); };
/** Data-only exact record shape; getters and unrecognised fields are never admitted to a retained snapshot. */
function maskingRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) maskingInvalid();
  const own = Object.keys(value).sort();
  if (own.length !== keys.length || own.some((key, i) => key !== keys[i])) maskingInvalid();
  for (const key of keys) if (Object.getOwnPropertyDescriptor(value, key)?.get !== undefined || Object.getOwnPropertyDescriptor(value, key)?.set !== undefined) maskingInvalid();
  return value;
}
/** A concrete PairIndex is deliberately stricter than its public membership-only interface. */
function maskingIndexChecked(idx) {
  const index = maskingRecord(idx, ['belt', 'byLen']);
  if (!(index.byLen instanceof Map) || index.belt === null || index.belt === undefined) maskingInvalid();
  for (const [len, hashes] of index.byLen) {
    if (!Number.isSafeInteger(len) || len < 1 || !(hashes instanceof Set)) maskingInvalid();
    for (const hash of hashes) if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) maskingInvalid();
  }
  const belt = maskingRecord(index.belt, ['grams', 'overflow', 'texts', 'units', 'widths']);
  if (!Array.isArray(belt.units) || !Array.isArray(belt.texts) || !Array.isArray(belt.widths)
    || !Number.isSafeInteger(belt.grams) || belt.grams < 0 || !Number.isSafeInteger(belt.overflow) || belt.overflow < 0
    || belt.units.length !== belt.texts.length) maskingInvalid();
  for (let i = 0; i < belt.units.length; i += 1) {
    if (!(belt.units[i] instanceof Uint8Array) || typeof belt.texts[i] !== 'string') maskingInvalid();
  }
  for (const width of belt.widths) {
    const w = maskingRecord(width, ['pw', 'table', 'w']);
    if (!Number.isSafeInteger(w.w) || w.w < 1 || !Number.isSafeInteger(w.pw) || !(w.table instanceof Map)) maskingInvalid();
    for (const [key, collisions] of w.table) {
      if (!Number.isSafeInteger(key) || !Array.isArray(collisions)) maskingInvalid();
      for (const collision of collisions) {
        const c = maskingRecord(collision, ['off', 'unit']);
        if (!Number.isSafeInteger(c.unit) || c.unit < 0 || c.unit >= belt.units.length || !Number.isSafeInteger(c.off) || c.off < 0) maskingInvalid();
      }
    }
  }
  return index;
}
/** Charge every material occurrence without serialising sensitive values. */
function maskingMaterialOf(idx, limit) {
  const add = (n) => { if (!Number.isSafeInteger(n) || n < 0 || total > limit - n) maskingMaterial(); total += n; };
  const string = (value) => { add(value.length * 2); };
  const number = () => { add(8); };
  const record = (keys, values) => { add(64); for (let i = 0; i < keys.length; i += 1) { add(16); string(keys[i]); values[i](); } };
  const array = (values) => { add(64); for (const value of values) { add(8); value(); } };
  const map = (entries) => { add(64); for (const [key, value] of entries) { add(32); key(); value(); } };
  const set = (values) => { add(64); for (const value of values) { add(16); value(); } };
  let total = 0;
  const index = maskingIndexChecked(idx);
  const belt = index.belt;
  const meterBelt = () => record(['grams', 'overflow', 'texts', 'units', 'widths'], [
    number, number,
    () => array(belt.texts.map((text) => () => string(text))),
    () => array(belt.units.map((unit) => () => add(64 + unit.byteLength))),
    () => array(belt.widths.map((width) => () => record(['pw', 'table', 'w'], [
      number,
      () => map([...width.table].map(([key, collisions]) => [() => number(), () => array(collisions.map((c) => () => record(['off', 'unit'], [number, number]))) ])),
      number,
    ]))),
  ]);
  record(['belt', 'byLen'], [meterBelt, () => map([...index.byLen].map(([len, hashes]) => [() => number(), () => set([...hashes].map((hash) => () => string(hash)))]))]);
  return total;
}
function maskingIndexSame(a, b) {
  const aa = maskingIndexChecked(a); const bb = maskingIndexChecked(b);
  if (aa.byLen.size !== bb.byLen.size) return false;
  const ai = aa.byLen.entries(); const bi = bb.byLen.entries();
  for (;;) { const x = ai.next(); const y = bi.next(); if (x.done || y.done) { if (x.done !== y.done) return false; break; }
    if (x.value[0] !== y.value[0] || x.value[1].size !== y.value[1].size) return false;
    const xs = x.value[1].values(); const ys = y.value[1].values(); for (;;) { const p = xs.next(); const q = ys.next(); if (p.done || q.done) { if (p.done !== q.done) return false; break; } if (p.value !== q.value) return false; }
  }
  const ab = aa.belt; const bbelt = bb.belt;
  if (ab.grams !== bbelt.grams || ab.overflow !== bbelt.overflow || ab.units.length !== bbelt.units.length || ab.texts.length !== bbelt.texts.length || ab.widths.length !== bbelt.widths.length) return false;
  for (let i = 0; i < ab.units.length; i += 1) if (!Buffer.from(ab.units[i]).equals(Buffer.from(bbelt.units[i])) || ab.texts[i] !== bbelt.texts[i]) return false;
  for (let i = 0; i < ab.widths.length; i += 1) {
    const x = ab.widths[i]; const y = bbelt.widths[i]; if (x.w !== y.w || x.pw !== y.pw || x.table.size !== y.table.size) return false;
    const xi = x.table.entries(); const yi = y.table.entries(); for (;;) { const p = xi.next(); const q = yi.next(); if (p.done || q.done) { if (p.done !== q.done) return false; break; }
      if (p.value[0] !== q.value[0] || p.value[1].length !== q.value[1].length) return false;
      for (let j = 0; j < p.value[1].length; j += 1) if (p.value[1][j].unit !== q.value[1][j].unit || p.value[1][j].off !== q.value[1][j].off) return false;
    }
  }
  return true;
}
function maskingSnapshotRefusal(kind) {
  if (kind === 'material') refuse('input-invalid', 'masking-snapshots-material-cap');
  refuse('input-invalid', 'masking-snapshot-invalid');
}
/** Retain each bounded distinct reading; the returned representative preserves refreshPairIndex's index contract. */
function refreshPairIndex(rs, home) {
  let state = rs.maskingSnapshots;
  if (state === undefined) {
    try {
      const seed = maskingIndexChecked(rs.idx); const material = maskingMaterialOf(seed, MASKING_SNAPSHOT_MATERIAL_MAX);
      if (seed.belt.overflow > 0) refuse('input-invalid', 'masking-snapshot-belt-overflow');
      state = { snapshots: [{ idx: seed, material }], material };
      rs.maskingSnapshots = state;
    } catch (e) {
      if (e instanceof DriverRefusal) throw e;
      if (e instanceof MaskingSnapshotError) maskingSnapshotRefusal(e.kind);
      throw e;
    }
  }
  let candidate; let material;
  try {
    candidate = maskingIndexChecked(pairIndexOf(rs.db, home));
    material = maskingMaterialOf(candidate, MASKING_SNAPSHOT_MATERIAL_MAX);
    if (candidate.belt.overflow > 0) refuse('input-invalid', 'masking-snapshot-belt-overflow');
    const retained = state.snapshots.find((snapshot) => maskingIndexSame(snapshot.idx, candidate));
    if (retained !== undefined) { rs.idx = retained.idx; return retained.idx; }
  } catch (e) {
    if (e instanceof DriverRefusal) throw e;
    if (e instanceof MaskingSnapshotError) maskingSnapshotRefusal(e.kind);
    refuse('input-invalid', 'masking-snapshot-refresh-failed');
  }
  if (state.snapshots.length >= MASKING_SNAPSHOT_MAX) refuse('input-invalid', 'masking-snapshots-count-cap');
  if (state.material > MASKING_SNAPSHOT_MATERIAL_TOTAL_MAX - material) refuse('input-invalid', 'masking-snapshots-material-cap');
  state.snapshots.push({ idx: candidate, material }); state.material += material; rs.idx = candidate;
  return candidate;
}
/** @param {ReplayStore} rs @param {string} home */
function maskingSnapshotsOf(rs, home) { refreshPairIndex(rs, home); return rs.maskingSnapshots.snapshots; }
const sameMaskingText = (a, b) => Buffer.from(a).equals(Buffer.from(b));

/** A failed open or first read as the driver's word: a StoreError by its word alone (store.mjs: the caller prints the
 *  word, never the message), SQLite's own error as store-read-failed with its message; anything else is a defect.
 *  @param {unknown} e  @returns {never} */
function storeRefusal(e) {
  if (e instanceof StoreError) refuse('store-unreadable', e.word);
  if (e !== null && typeof e === 'object' && /** @type {{ code?: unknown }} */ (e).code === 'ERR_SQLITE_ERROR') {
    refuse('store-unreadable', `store-read-failed: ${/** @type {Error} */ (e).message}`);
  }
  throw e;
}

/** Boundary N and the copy that holds it (§6.1 "The copy"): N's boundaries row, the holding copy through derive.mjs's
 *  holdingCopyOf, that copy's rows in file order (no body), N's index in them, and N's summary row's index as lib's
 *  summaryRowFor picks it for derivation (a harness user row, an echo, is never the pick), or null when there is none.
 *  The admission (W2-D66) and Baseline B (W2-D68) read this same answer.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId */
export function boundaryCopyOf(rs, boundaryEntryId) {
  const boundary = rs.stmts.boundary.get(boundaryEntryId);
  if (boundary === undefined) return reconDiscard('boundary-absent');
  const holding = holdingCopyOf(rs.db, { entry_id: boundary.entry_id, transcript_pk: boundary.transcript_pk });
  if (holding === null) return reconDiscard('boundary-uncopied');
  const fileId = Number(holding.file_id);
  const rows = rs.stmts.copyRows.all(fileId);
  const boundaryIndex = rows.findIndex((r) => r.entry_id === boundary.entry_id);
  const at = summaryIndexOf(rows, boundary.uuid, boundary.anchor_uuid);
  return { state: 'copy', boundary, fileId, rows, boundaryIndex, summaryIndex: at < 0 ? null : at };
}

/** Leaf N's span (W2-D65): the rows derivation recorded as leaf N's sources (node_sources of N's depth-0 node), in their
 *  recorded order, which is N's holding copy's file order, each with the entries columns mining reads (R4). No leaf for
 *  N, or a leaf with no source, is leaf-absent. Never a second span rule over the copy.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId */
export function spanRowsOf(rs, boundaryEntryId) {
  const rows = rs.stmts.span.all(boundaryEntryId);
  if (rows.length === 0) return reconDiscard('leaf-absent');
  return { state: 'span', rows };
}

/** kept(N) (W2-D68 (2), W2-D34 option (a), W2-D38): the members of the blob boundaries.kept_blob_id names, read through
 *  bodyOf, deduplicated in first-occurrence order. A NULL id is kept-absent; a body that is not a list of strings
 *  (bodyOf's null for a tombstone, a damaged, over-cap or non-JSON blob; JSON that is not a list; a list holding
 *  anything but strings, which lib's boundaryOf never stores) is kept-unreadable. Never an empty list for either: that
 *  is the fold this file never calls. Baseline B passes its run budget; the payload reads with a fresh one.
 *  @param {ReplayStore} rs  @param {{ kept_blob_id: number | null }} boundary  @param {{ bytes: number }} [budget] */
export function keptMembersOf(rs, boundary, budget = { bytes: 0 }) {
  if (boundary.kept_blob_id === null) return reconDiscard('kept-absent');
  const v = bodyOf(rs.blobs, boundary.kept_blob_id, budget);
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return reconDiscard('kept-unreadable');
  return { state: 'kept', uuids: [...new Set(v)] };
}

/** The kept members the store holds, in N's holding copy's file order; a member outside that copy comes after, by
 *  entry_id, and is counted in `offCopy`; a uuid the store does not hold is counted in `absent` (W2-D75 item 2).
 *  @param {ReplayStore} rs  @param {string[]} uuids  @param {number} fileId */
export function keptRowsOf(rs, uuids, fileId) {
  const rows = rs.stmts.keptRows.all(fileId, JSON.stringify(uuids));
  return { rows, absent: uuids.length - rows.length, offCopy: rows.filter((r) => r.line === null).length };
}

/** An entry's body as expand picks it (W2-D74; D-6238): 'body' and 'unparseable' carry the pick and the primary's
 *  decoded length (W2-D54's rawLen; an over-cap blob never decodes, so it is never past the cap here); the three
 *  body-less words come back as `lost`, each kept apart.
 *  @param {ReplayStore} rs  @param {{ entry_id: number, blob_id: number }} row */
export function entryBodyOf(rs, row) {
  const k = expandEntryBody(rs, { entry_id: row.entry_id, blob_id: row.blob_id });
  if (k.state === 'body' || k.state === 'unparseable') return { state: k.state, body: k.body, rawLen: k.blob.bytes.length };
  // D-6301: a word expandEntryBody gains later has no discard here, so it throws rather than reach a wordless discard.
  if (!Object.hasOwn(SUMMARY_LOST, k.state) || !Object.hasOwn(MEMBER_LOST, k.state)) throw new TypeError(`entryBodyOf: unknown body state ${k.state}`);
  return { state: 'lost', word: k.state };
}

/** One kept member as item 2 renders it (W2-D75): each block on its own line. A text block, a bare string block and a
 *  body that is not a block list are tagged with the row's type (`[user] …`, `[assistant] …`). A tool_use is
 *  renderToolUseLine (`[tool_use <name>] <input>`, lib's rendering). A tool_result is `[tool_result] ` and its first TOOL_RESULT_CUT code
 *  points after redaction (toolResultText). Any other block is renderEntryText's `[<type>]`. Every piece is redacted
 *  whole before any cut (W2-D54).
 *  @param {{ type: string }} row  @param {{ body: unknown, rawLen: number }} k
 *  @param {import('../ccd/history/lib.mjs').PairIndex} idx */
export function renderKeptMember(row, k, idx) {
  // D-6308: the body is redacted as a value before any block of it is rendered, so no JSON the render makes is redacted as text.
  const body = maskValue(k.body, idx);
  const pieces = Array.isArray(body)
    ? body.map((b) => {
      const type = b !== null && typeof b === 'object' ? b.type : null;
      const text = type === 'tool_use' ? renderToolUseLine(typeof b.name === 'string' ? b.name : '', JSON.stringify(b.input ?? null)) : renderEntryText([b]);
      return { type, tagged: typeof b === 'string' || type === 'text', text };
    })
    : [{ type: null, tagged: true, text: renderEntryText(body) }];
  const lines = [];
  for (const p of pieces) {
    const field = { text: p.text, rawLen: k.rawLen };
    const r = p.type === 'tool_result' ? toolResultText(field, idx) : redactForSpawn(field, idx);
    if (r.state !== 'text') return r;
    lines.push(p.type === 'tool_result' ? `[tool_result] ${r.text}` : p.tagged ? `[${redactFinalJson(row.type, idx)}] ${r.text}` : r.text);
  }
  return { state: 'text', text: lines.join('\n') };
}

/** `fn()`, or null when it throws a RangeError: a body nested past V8's JSON.stringify stack (about 4,000 levels, far
 *  inside lib's JSON_DEPTH_MAX) parses and cannot be rendered, as recall.mjs's expandEntryText meets it (D-6302). Any other
 *  throw is a defect and propagates.
 *  @template T  @param {() => T} fn  @returns {T | null} */
function renderOrNull(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** Boundary N's payload (spec §10.2 "Reconstruction"; W2-D75 items 1 to 3), composed by composePayload:
 *  1. the summary row's text, redacted whole, its transcript-pointer lines replaced by POINTER_REMOVED;
 *  2. each kept(N) member the store holds, in N's holding copy's file order, rendered by renderKeptMember;
 *  3. the question, redacted, then ANSWER_PROTOCOL (W2-D64, D-5776).
 *  Any failure discards N under its RECON_DISCARDS word; `counts` reports what was read.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId  @param {string} question */
export function reconstructPayload(rs, boundaryEntryId, question) {
  const copy = boundaryCopyOf(rs, boundaryEntryId);
  if (copy.state !== 'copy') return copy;
  if (copy.summaryIndex === null) return reconDiscard('summary-absent');
  const sum = entryBodyOf(rs, copy.rows[copy.summaryIndex]);
  if (sum.state === 'lost') return reconDiscard(SUMMARY_LOST[sum.word]);
  if (sum.state === 'unparseable') return reconDiscard('summary-unparseable');
  const sumText = renderOrNull(() => renderMasked(sum.body, rs.idx));
  if (sumText === null) return reconDiscard('body-unrenderable');
  const s1 = redactForSpawn({ text: sumText, rawLen: sum.rawLen }, rs.idx);
  if (s1.state !== 'text') return s1;
  const item1 = removePointerLines(s1.text);
  const kept = keptMembersOf(rs, copy.boundary);
  if (kept.state !== 'kept') return kept;
  const members = keptRowsOf(rs, kept.uuids, copy.fileId);
  const rendered = [];
  let unparseable = 0;
  for (const row of members.rows) {
    const k = entryBodyOf(rs, row);
    if (k.state === 'lost') return reconDiscard(MEMBER_LOST[k.word]);
    if (k.state === 'unparseable') unparseable += 1;
    const m = renderOrNull(() => renderKeptMember(row, k, rs.idx));
    if (m === null) return reconDiscard('body-unrenderable');
    if (m.state !== 'text') return m;
    rendered.push(m.text);
  }
  const q = redactForSpawn({ text: question, rawLen: Buffer.byteLength(question, 'utf8') }, rs.idx);
  if (q.state !== 'text') return q;
  return {
    state: 'payload', text: composePayload({ summary: item1.text, kept: rendered }, q.text),
    counts: { members: members.rows.length, absent: members.absent, off_copy: members.offCopy, unparseable, pointer_lines: item1.replaced },
  };
}

// ── W2-5a Task 2: fact mining, the producer and the redaction screen (W2-D61, W2-D65, W2-D67) ───────────────────
// Mining (W2-D65) reads leaf N's span rows only, in holding-copy file order, each body through W2-1's body pick
// (expandEntryBody, which the caller hands in as `pick`; W2-D74). It yields every candidate of the four fact kinds
// (W2-D60) with both of its forms (W2-D61): `fact_raw`, the exact stored leaf or line, which the source side reads
// (the redaction screen below, answerability's index-text check, the writer's excerpt and the arm-time re-check), and
// `fact`, which admission and scoring read: collapseWs(fact_raw) for a command or an error, the run lower-cased for a
// sha, and the path made absolute against the epoch's cwd for a path. collapseWs is the gate's (W2-3); this file
// keeps no copy of it. Rows of any provenance but model and tool, and assistant rows whose model is Claude Code's own
// notice, are never mined and never picked. A mined row whose pick is not a body discards the boundary, by its own word.
// The producer (W2-D65) is decided per row through lib's backendOf alone. A tool result takes the backend of the
// assistant row in the SAME span whose tool_use ids hold its first answered id: the sweep's own pairing (prepareLines:
// the tool_uses seen so far, in file order). The entries column the sweep fills from the row's own field is never
// read, and nor is the sweep's walk up the parent chain, which can leave the span. A result with no such row is
// unpaired. The producer is recorded at mining and applied by the screen, in W2-D71's lazy order.
// The screen (W2-D71's first three filters): redaction (W2-D67), then the producer, then admission against Baseline B
// (W2-D62: the gate's admitFact over unredacted F and unredacted B, in memory only). Redaction is lib's redactField,
// the composed door 5h-2 left (5h-2's R11), over the run's pair index (pairIndexOf, built once per run by the caller): a
// candidate is dropped when its fact_raw is masked alone, or no longer occurs verbatim in its leaf once the leaf is
// masked. Every drop is counted by its word and never by its value.

/** The tools whose path fields are path facts (W2-D65). */
export const MINE_PATH_TOOLS = Object.freeze(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Glob', 'Grep']);
/** The path fields read from those tools' inputs, in this order (W2-D65). */
export const MINE_PATH_FIELDS = Object.freeze(['file_path', 'path', 'notebook_path']);
/** A command fact's collapsed length bounds, in UTF-16 code units, the unit the gate measures F in (W2-D65). */
export const MINE_COMMAND_CHARS = Object.freeze({ min: 12, max: 300 });
/** An error fact's collapsed length bounds, in the same unit (W2-D65). */
export const MINE_ERROR_CHARS = Object.freeze({ min: 16, max: 300 });
/** The boundary discard a mined row with no body gives, one per non-body state of W2-1's body pick (D-6238), never
 *  folded into one (W2-D74: a tombstone discards the boundary; W2-D54: so does over-cap). The words are RECON_DISCARDS'
 *  (R5). */
const SPAN_LOST = Object.freeze({ unparseable: 'span-unparseable', tombstone: 'span-tombstone', 'over-cap': 'span-over-cap', undecodable: 'span-undecodable' });
/** Every word a fact site or a candidate is dropped with: the one list of fact drops (R5). Drops are counted by word,
 *  never by value (W2-D67, W2-D71). A drop is a count, not a refusal, so no word here is a DRIVER_REASONS word, none is a
 *  gate word (the writer's two discards are the gate's GATE_REASONS), and none is a RECON_DISCARDS word. Tasks 5 and 6
 *  append theirs here, in place. */
export const FACT_DROP_REASONS = Object.freeze([
  'path-no-cwd', 'path-tilde', 'path-config-dir', 'command-recall', 'command-length', 'error-no-line', 'error-length',
  'duplicate', 'redact-fact', 'redact-leaf', 'result-unpaired', 'producer-other', 'producer-unknown', 'baseline-hit',
  'unanswerable', 'unanswerable-untimed',
  'writer-input-over-cap', 'writer-input-unrenderable', 'writer-fact-unplaced', 'sha-short',
]);
/** The span-row provenances mining reads. Operator, summary, harness, ccrc-injected and recall-echo rows never are. */
const MINED_PROVENANCE = Object.freeze(['model', 'tool']);
/** A sha fact's run: 7 to 40 lower-case hex, with no [0-9A-Za-z] on either side, so a longer run yields none. */
const SHA_RUN = /(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g;
/** lib's UUID grammar, unanchored and in either case: a run inside one of these is a UUID segment, not a sha. */
const UUID_SPAN = new RegExp(UUID_RE.source.slice(1, -1), 'gi');
/** A line that says only which exit code a command returned: never an error fact by itself. */
const EXIT_CODE_LINE = /^Exit code -?[0-9]+$/;

/** One span row, in holding-copy file order: the entries columns mining reads.
 *  @typedef {{ entry_id: number, uuid: string, type: string, model: string | null, provenance: string,
 *    ts_ms: number | null, blob_id: number }} SpanRow */
/** W2-1's expandEntryBody answer as mining reads it: the state word and, for 'body', the picked body.
 *  @typedef {{ state: string, body: unknown }} PickedBody */
/** Who produced a candidate's row (W2-D65): its own assistant row, the assistant row its result answers, or nobody.
 *  @typedef {{ state: 'row', backend: string } | { state: 'paired', backend: string, tool_use_uuid: string }
 *    | { state: 'unpaired' }} FactProducer */
/** A stored text as a spawn's input reads it (W2-D54): the text and its UTF-8 length. A span row's field also carries the
 *  `body` it was rendered from, and a paired tool_use input the `value` it was serialised from, so the writer redacts
 *  the JSON as a value and renders it again (D-6308).
 *  @typedef {{ text: string, rawLen: number, body?: unknown, value?: unknown }} StoredField */
/** One candidate fact (W2-D61, W2-D65), the one candidate shape every later task reads (R4). Its first twelve fields are
 *  the writer's item: the family, boundary N, `kind`, `fact` (F), `fact_raw` (F_raw), `source_entry_uuid`, `repo_roots`,
 *  `leaf` (the raw, unredacted text block, tool_use input string, Bash command, path field or tool_result text it was
 *  mined from), `pair` (the tool_use a tool_result leaf answers, its input as JSON; W2-D72's excerpt reads it) and `span`
 *  (leaf N's span, each mined row's rendering). The rest are mining's: `leaf_key` names the leaf within the run, and the
 *  source fields are W2-D70's.
 *  @typedef {{ store_id: string, ccrc_id: string, generation: string, boundary_uuid: string,
 *    kind: 'sha' | 'path' | 'command' | 'error', fact: string, fact_raw: string, source_entry_uuid: string,
 *    repo_roots: string[], leaf: StoredField, pair: { name: string, input: StoredField } | null, span: StoredField[],
 *    leaf_key: string, boundary_ts_ms: number, source_entry_id: number, source_ts_ms: number | null,
 *    source_blob_id: number, source_provenance: string, producer: FactProducer, ord: number }} FactCandidate */
/** @typedef {{ state: 'mined', boundaryUuid: string, boundaryTsMs: number, candidates: FactCandidate[],
 *    counts: Record<string, number> }} MinedBoundary */
/** @typedef {{ state: 'discard', boundaryUuid: string, why: string, counts: Record<string, number> }} DiscardedBoundary */

/** A fresh drop tally: every FACT_DROP_REASONS word at 0, in that order.
 *  @returns {Record<string, number>} */
export function newDropCounts() {
  return Object.fromEntries(FACT_DROP_REASONS.map((w) => [w, 0]));
}

/** Count one drop. A word outside FACT_DROP_REASONS is a defect: it throws and counts nothing.
 *  @param {Record<string, number>} counts  @param {string} reason */
export function noteDrop(counts, reason) {
  if (!FACT_DROP_REASONS.includes(reason)) throw new TypeError(`noteDrop: ${JSON.stringify(reason)} is not a FACT_DROP_REASONS word`);
  counts[reason] += 1;
}

/** A stored field from a mined leaf: its text and its own UTF-8 length. A mined row's body decoded under the cap (any
 *  other pick discards the boundary), so no leaf is past it. */
const storedField = (text) => ({ text, rawLen: Buffer.byteLength(text, 'utf8') });

/** Every rostered account's config dir under `home`, once each, sorted by code unit: the directories a path fact may
 *  not sit under (W2-D65), and W2-D69's (b) and (c) (Task 4). `roster` is readRoster's validated roster, which lists hidden accounts too and carries no
 *  hidden flag (shared/roster-json.d.mts), so a hidden account's dir is excluded like any other.
 *  @param {{ accounts: readonly { configDirSuffix: string }[] }} roster  @param {string} home
 *  @returns {string[]} */
export function rosterConfigDirs(roster, home) {
  return [...new Set(roster.accounts.map((a) => join(home, a.configDirSuffix)))].sort();
}

/** Every sha fact of one leaf, in position order (W2-D65): a SHA_RUN that holds a digit and a letter and overlaps no
 *  UUID-shaped span. */
function shaRunsOf(leaf) {
  const uuids = [...leaf.matchAll(UUID_SPAN)].map((m) => [m.index, m.index + m[0].length]);
  const out = [];
  for (const m of leaf.matchAll(SHA_RUN)) {
    const run = m[0];
    if (!/[0-9]/.test(run) || !/[a-f]/.test(run)) continue;
    if (uuids.some(([from, to]) => m.index < to && m.index + run.length > from)) continue;
    out.push(run);
  }
  return out;
}

/** The string leaves of a tool_use input, depth-first in key order: the leaves lib's ftsTextOf indexes (its walker
 *  is module-private, and W2-5a never edits lib). */
function inputLeavesOf(input) {
  const out = [];
  const stack = [input];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i -= 1) stack.push(v[i]);
    else if (sjObject(v)) {
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i >= 0; i -= 1) stack.push(v[keys[i]]);
    }
  }
  return out;
}

/** A path field's fact, made absolute against the epoch's cwd, or the word it is dropped with (W2-D65). An absolute
 *  field is kept as stored; the config-dir test reads its resolved form, so a `..` cannot walk under one unseen. */
function pathFactOf(raw, cwd, configDirs) {
  if (raw.startsWith('~')) return { drop: 'path-tilde' };
  let fact = raw;
  if (!raw.startsWith('/')) {
    if (typeof cwd !== 'string' || !cwd.startsWith('/')) return { drop: 'path-no-cwd' };
    fact = path.posix.resolve(cwd, raw);
  }
  const where = path.posix.resolve(fact);
  const under = (d) => where === d || where.startsWith(d + '/');
  if (configDirs.some(under)) return { drop: 'path-config-dir' };
  return { fact };
}

/** Mine one boundary's candidates (W2-D61, W2-D65). Pure: it reads the rows it is handed and calls `pick` once for
 *  each row it mines, never for any other row. The family (`storeId`, `ccrcId`, `generation`) is carried onto every
 *  candidate, so the candidate is the writer's item (R4). A mined body nested too deep to render (a RangeError from
 *  renderEntryText, caught by renderOrNull) discards the boundary under
 *  `body-unrenderable`, the word D-6302 gives reconstruction (D-6303).
 *  @param {{ storeId: string, ccrcId: string, generation: string, boundaryUuid: string, boundaryTsMs: number,
 *    rows: readonly SpanRow[], pick: (row: SpanRow) => PickedBody, cwd: string | null, cwdReal: string | null,
 *    configDirs: readonly string[] }} input
 *  @returns {MinedBoundary | DiscardedBoundary} */
export function mineBoundary({ storeId, ccrcId, generation, boundaryUuid, boundaryTsMs, rows, pick, cwd, cwdReal, configDirs }) {
  const counts = newDropCounts();
  const repoRoots = [...new Set([cwd, cwdReal].filter((r) => typeof r === 'string' && r !== ''))];
  const uses = new Map();
  const span = [];
  const candidates = [];
  for (const row of rows) {
    if (!MINED_PROVENANCE.includes(row.provenance)) continue;
    if (row.provenance === 'model' && isSyntheticModel(row.model)) continue;
    const picked = pick(row);
    if (picked.state !== 'body') {
      const why = Object.hasOwn(SPAN_LOST, picked.state) ? SPAN_LOST[picked.state] : undefined;
      if (why === undefined) throw new TypeError(`mineBoundary: body pick state ${JSON.stringify(picked.state)} is not one expandEntryBody answers`);
      return { state: 'discard', boundaryUuid, why, counts };
    }
    const rendered = renderOrNull(() => renderEntryText(picked.body));
    if (rendered === null) return { state: 'discard', boundaryUuid, why: 'body-unrenderable', counts };
    span.push({ ...storedField(rendered), body: picked.body });   // D-6308: the body rides beside its rendering, redacted as a value at the writer
    const blocks = Array.isArray(picked.body) ? picked.body : [];
    let producer;
    if (row.provenance === 'model') {
      producer = { state: 'row', backend: backendOf(row.model) };
      for (const u of toolUsesOf(picked.body)) uses.set(u.id, { row, block: blocks.find((b) => sjObject(b) && b.type === 'tool_use' && b.id === u.id) });
    } else {
      const first = toolResultIdsOf(picked.body)[0];
      const pair = first === undefined ? undefined : uses.get(first);
      producer = pair === undefined ? { state: 'unpaired' } : { state: 'paired', backend: backendOf(pair.row.model), tool_use_uuid: pair.row.uuid };
    }
    const add = (kind, fact, factRaw, leaf, leafKey, pair) => {
      candidates.push({
        store_id: storeId, ccrc_id: ccrcId, generation, boundary_uuid: boundaryUuid, kind, fact, fact_raw: factRaw,
        source_entry_uuid: row.uuid, repo_roots: repoRoots, leaf: storedField(leaf), pair, span,
        leaf_key: leafKey, boundary_ts_ms: boundaryTsMs, source_entry_id: row.entry_id, source_ts_ms: row.ts_ms,
        source_blob_id: row.blob_id, source_provenance: row.provenance, producer, ord: candidates.length,
      });
    };
    const addShas = (leaf, leafKey, pair) => {
      for (const run of shaRunsOf(leaf)) add('sha', run.toLowerCase(), run, leaf, leafKey, pair);
    };
    blocks.forEach((b, bi) => {
      if (!sjObject(b)) return;
      const key = `${row.entry_id}:${bi}`;
      if (row.provenance === 'model') {
        if (b.type === 'text' && typeof b.text === 'string') addShas(b.text, key, null);
        if (b.type !== 'tool_use') return;
        const input = sjObject(b.input) ? b.input : {};
        if (b.name === 'Bash' && typeof input.command === 'string') {
          const fact = collapseWs(input.command);
          if (isHistoryCommand(input.command)) noteDrop(counts, 'command-recall');
          else if (fact.length < MINE_COMMAND_CHARS.min || fact.length > MINE_COMMAND_CHARS.max) noteDrop(counts, 'command-length');
          else add('command', fact, input.command, input.command, `${key}:command`, null);
        }
        if (MINE_PATH_TOOLS.includes(b.name)) {
          for (const field of MINE_PATH_FIELDS) {
            const raw = input[field];
            if (typeof raw !== 'string' || raw === '') continue;
            const p = pathFactOf(raw, cwd, configDirs);
            if (p.drop !== undefined) noteDrop(counts, p.drop);
            else add('path', p.fact, raw, raw, `${key}:${field}`, null);
          }
        }
        inputLeavesOf(b.input).forEach((leaf, li) => addShas(leaf, `${key}:${li}`, null));
        return;
      }
      if (b.type !== 'tool_result') return;
      const text = sjResultText(b.content);
      if (text === null) return;
      const answered = typeof b.tool_use_id === 'string' ? uses.get(b.tool_use_id) : undefined;
      // The input needs no guard: that tool_use row's own renderEntryText, guarded above, already stringified it whole.
      const pair = answered?.block === undefined ? null
        : { name: typeof answered.block.name === 'string' ? answered.block.name : '',
          input: { ...storedField(JSON.stringify(answered.block.input ?? null)), value: answered.block.input ?? null } };   // D-6308
      if (b.is_error === true) {
        const line = text.split('\n').find((l) => {
          const c = collapseWs(l);
          return c !== '' && !EXIT_CODE_LINE.test(c);
        });
        if (line === undefined) noteDrop(counts, 'error-no-line');
        else {
          const fact = collapseWs(line);
          if (fact.length < MINE_ERROR_CHARS.min || fact.length > MINE_ERROR_CHARS.max) noteDrop(counts, 'error-length');
          else add('error', fact, line, text, key, pair);
        }
      }
      addShas(text, key, pair);
    });
  }
  Object.freeze(span);
  return { state: 'mined', boundaryUuid, boundaryTsMs, candidates, counts };
}

/** Earliest boundary first, ties by boundary uuid in code-unit order. */
function byBoundaryTime(a, b) {
  if (a.boundaryTsMs !== b.boundaryTsMs) return a.boundaryTsMs - b.boundaryTsMs;
  return a.boundaryUuid < b.boundaryUuid ? -1 : a.boundaryUuid > b.boundaryUuid ? 1 : 0;
}

/** One family's candidate pool (W2-D65): (kind, fact) once, kept at its first site, the earliest boundary first and
 *  file order within it, whatever order the boundaries arrive in. Each later copy counts `duplicate`.
 *  @param {readonly MinedBoundary[]} mined  @param {Record<string, number>} counts
 *  @returns {FactCandidate[]} */
export function dedupeFamily(mined, counts) {
  const order = [...mined].sort(byBoundaryTime);
  const seen = new Set();
  const kept = [];
  for (const m of order) {
    for (const c of m.candidates) {
      const key = canonicalJson([c.kind, c.fact]);
      if (seen.has(key)) { noteDrop(counts, 'duplicate'); continue; }
      seen.add(key);
      kept.push(c);
    }
  }
  return kept;
}

/** The redaction screen (W2-D67): 'redact-fact' when lib's redactField changes fact_raw alone, or changes F alone
 *  (R10, F6: collapseWs can join a header and the value a newline split, and the writer's input carries F), then
 *  'redact-leaf' when fact_raw no longer occurs verbatim in its leaf once the leaf is redacted, else null. `memo`
 *  (optional) keeps each redacted leaf by leaf_key for the caller's scope, so a leaf holding many candidates is
 *  redacted once.
 *  @param {FactCandidate} c  @param {import('../ccd/history/lib.mjs').PairIndex} idx  @param {Map<string, string> | null} [memo]
 *  @returns {null | 'redact-fact' | 'redact-leaf'} */
export function screenRedaction(c, idx, memo = null) {
  if (redactField(c.fact_raw, idx) !== c.fact_raw) return 'redact-fact';
  if (redactField(c.fact, idx) !== c.fact) return 'redact-fact';
  // D-6308: repo_roots (an epoch's cwd and cwd_real) reach frozen.json and sourced.json: one that redaction changes drops the candidate.
  if (c.repo_roots.some((r) => redactField(r, idx) !== r)) return 'redact-fact';
  let masked = memo === null ? undefined : memo.get(c.leaf_key);
  if (masked === undefined) {
    masked = redactField(c.leaf.text, idx);
    if (memo !== null) memo.set(c.leaf_key, masked);
  }
  return masked.includes(c.fact_raw) ? null : 'redact-leaf';
}

/** The producer screen (W2-D65): null for an anthropic producer, else the word.
 *  @param {FactCandidate} c
 *  @returns {null | 'result-unpaired' | 'producer-other' | 'producer-unknown'} */
export function screenProducer(c) {
  if (c.producer.state === 'unpaired') return 'result-unpaired';
  if (c.producer.backend === 'anthropic') return null;
  return c.producer.backend === 'other' ? 'producer-other' : 'producer-unknown';
}

/** W2-D71's third filter, the one spelling of admission against Baseline B (W2-D62): the gate's admitFact over
 *  unredacted F and B's unredacted text, with no question yet. screenCandidate and Task 6's sourceQuiz 'admit-baseline'
 *  stage both call it, so the admission call is written once.
 *  @param {FactCandidate} c  @param {string} baselineText
 *  @returns {null | 'baseline-hit'} */
export function screenBaseline(c, baselineText) {
  const admission = admitFact(c.kind, c.fact, baselineText, '', { repoRoots: c.repo_roots });
  return admission.admitted ? null : 'baseline-hit';
}

/** W2-D71's first three filters, in its order: redaction, the producer, then admission against Baseline B
 *  (screenBaseline). `baselineText` is B's unredacted text, held in memory by the caller.
 *  @param {FactCandidate} c
 *  @param {{ idx: import('../ccd/history/lib.mjs').PairIndex, baselineText: string, memo?: Map<string, string> | null }} ctx
 *  @returns {{ state: 'pass' } | { state: 'drop', reason: string }} */
export function screenCandidate(c, { idx, baselineText, memo = null }) {
  const early = screenRedaction(c, idx, memo) ?? screenProducer(c);
  if (early !== null) return { state: 'drop', reason: early };
  const late = screenBaseline(c, baselineText);
  return late === null ? { state: 'pass' } : { state: 'drop', reason: late };
}

// ── W2-5a Task 3: boundary admission (W2-D66; spec §10.2 RP5; the producer's copy rule, D-5771) ─────────────────
// A boundary enters the quiz's population only when the backend on BOTH sides of it is anthropic (RP5):
//   before  lib.producerOf over the models of the assistant rows before the boundary, nearest first: the last real
//           assistant row before it, a `<synthetic>` or model-less row skipped (lib.backendOf reads both 'unknown');
//   after   lib.producerOfCopy from the summary row: the first real assistant row after it, the witness
//           derive.mjs#leafFields reads for the leaf's producer.
// Both sides read ONE copy, Task 1's boundaryCopyOf over derive.mjs's holdingCopyOf: lib.pickHoldingCopy over every
// file of the transcript (live first, then the smallest file_id), the copy the leaf is derived from and the gate's
// producer stratum reads (D-5771), never W1's longest copy, which only the window reads (W2-D15). The summary row is
// Task 1's summaryIndexOf: lib.summaryRowFor's pick over the meta derive.mjs's copyPlan builds. Nothing here reads an
// account, a wrapper or a roster: a boundary is judged by its rows' model names alone, so an Anthropic-wrapper session
// whose last real row before the boundary came from a gateway is not admitted.
// The population: every main-transcript boundary (agent_id '') whose session uuid has a family under derive.mjs's
// epochOfUuid (a confirmed epoch of an unmerged session, the smallest session_pk: the family its leaf is derived
// under), with a non-null ts_ms and a summary row in its holding copy. W2-D71's family eligibility (pilot and control
// exclusions) is the sampler's. A drop is counted by its RECON_DISCARDS word (R5), never refused.
// The store is the caller's ReplayStore (Task 1's openReplayStore: a read-only openReader handle, W2-D51): this section
// opens nothing, writes nothing and spawns nothing.

/** A drop decided before both sides were read: no side measured. */
const unjudged = (reason) => ({ admitted: false, reason, file_id: null, boundary_index: null, summary_index: null, summary_entry_id: null, before: null, after: null });

/** RP5 over one copy's rows in file order (W2-D66). `before` folds the assistant rows before the boundary, nearest
 *  first, through lib.producerOf; `after` is lib.producerOfCopy from the summary row. Admitted iff both are
 *  'anthropic'. `reason` names the failing side, the before side first, as `before-<backend>` or `after-<backend>`;
 *  null when admitted. An index outside the copy is the caller's defect: TypeError, never a verdict.
 *  @param {Array<{type: string, model: string|null}>} copyRows
 *  @param {number} boundaryIndex
 *  @param {number} summaryIndex
 *  @returns {{admitted: boolean, reason: string|null, before: 'anthropic'|'other'|'unknown', after: 'anthropic'|'other'|'unknown'}} */
export function admitBoundary(copyRows, boundaryIndex, summaryIndex) {
  if (!Array.isArray(copyRows)) throw new TypeError('admitBoundary: copyRows must be an array');
  for (const [name, i] of [['boundaryIndex', boundaryIndex], ['summaryIndex', summaryIndex]]) {
    if (!Number.isInteger(i) || i < 0 || i >= copyRows.length) throw new TypeError(`admitBoundary: ${name} ${String(i)} is not a row of the copy`);
  }
  const nearestFirst = [];
  for (let i = boundaryIndex - 1; i >= 0; i -= 1) if (copyRows[i].type === 'assistant') nearestFirst.push(copyRows[i].model);
  const before = producerOf(nearestFirst);
  const after = producerOfCopy(copyRows, summaryIndex);
  const reason = before !== 'anthropic' ? `before-${before}` : after !== 'anthropic' ? `after-${after}` : null;
  return { admitted: before === 'anthropic' && after === 'anthropic', reason, before, after };
}

const ADMISSION_STMTS = new WeakMap();

/** The reads admission adds to Task 1's, prepared once per handle: every main-transcript boundary, in (transcript_pk,
 *  entry_id) order (agent_id '', as derive.mjs's todo reads them), and a family's generation. A boundary's copy and
 *  its rows are Task 1's boundaryCopyOf, the one holding-copy reader. */
function admissionStmts(db) {
  let s = ADMISSION_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    boundaries: db.prepare(`SELECT b.entry_id AS entry_id, e.uuid AS uuid, e.ts_ms AS ts_ms, b.transcript_pk AS transcript_pk,
        t.cc_session_uuid AS cc_uuid
      FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id JOIN transcripts t ON t.transcript_pk = b.transcript_pk
      WHERE t.agent_id = '' ORDER BY b.transcript_pk, b.entry_id`),
    generation: db.prepare('SELECT generation FROM sessions WHERE session_pk = ?'),
  };
  ADMISSION_STMTS.set(db, s);
  return s;
}

/** One boundary that has a family and a time, judged in Task 1's holding copy. A `boundary-absent` answer from
 *  boundaryCopyOf throws rather than being counted: the boundary row was read from this same handle a moment earlier,
 *  and no ccd/history writer deletes boundaries. A boundary no copy holds is
 *  boundary-uncopied, one whose copy has no summary row summary-absent; an admitted row names its summary row
 *  (summary_entry_id), so Baseline B can check the copy it reads again is this one. */
function admitHeld(rs, b) {
  const copy = boundaryCopyOf(rs, Number(b.entry_id));
  if (copy.state !== 'copy') {
    if (copy.why === 'boundary-uncopied') return unjudged('boundary-uncopied');
    throw new TypeError(`admitStoreBoundaries: boundary ${String(b.entry_id)} answered ${copy.why}`);
  }
  if (copy.summaryIndex === null) return { ...unjudged('summary-absent'), file_id: copy.fileId, boundary_index: copy.boundaryIndex };
  return { ...admitBoundary(copy.rows, copy.boundaryIndex, copy.summaryIndex), file_id: copy.fileId, boundary_index: copy.boundaryIndex,
    summary_index: copy.summaryIndex, summary_entry_id: Number(copy.rows[copy.summaryIndex].entry_id) };
}

/** Every main-transcript boundary in the store behind `rs`, each with its family and its W2-D66 verdict, and the count
 *  of each outcome: 'admitted' and every RECON_DISCARDS word, zeros included. In order: no family under derive.mjs's
 *  epochOfUuid is no-epoch, a NULL boundary ts_ms is ts-null, then the holding copy (boundary-uncopied, summary-absent)
 *  and RP5. `rs` is the caller's ReplayStore (Task 1), which the caller closes.
 *  @param {ReplayStore} rs
 *  @returns {{boundaries: Array<{entry_id: number, uuid: string, transcript_pk: number, ts_ms: number|null,
 *    ccrc_id: string|null, generation: string|null, admitted: boolean, reason: string|null, file_id: number|null,
 *    boundary_index: number|null, summary_index: number|null, summary_entry_id: number|null, before: string|null,
 *    after: string|null}>, counts: Record<string, number>}} */
export function admitStoreBoundaries(rs) {
  const s = admissionStmts(rs.db);
  const counts = Object.fromEntries(['admitted', ...RECON_DISCARDS].map((w) => [w, 0]));
  const boundaries = [];
  for (const b of s.boundaries.all()) {
    const ep = epochOfUuid(rs.db, b.cc_uuid);
    const v = ep === null ? unjudged('no-epoch') : b.ts_ms === null ? unjudged('ts-null') : admitHeld(rs, b);
    const key = v.reason ?? 'admitted';
    if (!Object.hasOwn(counts, key)) throw new TypeError(`admitStoreBoundaries: ${key} is not a RECON_DISCARDS word`);
    counts[key] += 1;
    boundaries.push({
      entry_id: Number(b.entry_id), uuid: b.uuid, transcript_pk: Number(b.transcript_pk), ts_ms: b.ts_ms === null ? null : Number(b.ts_ms),
      ccrc_id: ep === null ? null : ep.ccrc_id, generation: ep === null ? null : s.generation.get(ep.session_pk).generation,
      ...v,
    });
  }
  return { boundaries, counts };
}

// ── W2-5a Task 4: Baseline B and its files (W2-D68, W2-D69; spec §10.2 "Baseline B") ──────────────────────────────
// B is what the session still saw after compaction N, so a fact found in it is not "present only before the
// compaction" and is never asked: W2-D62's admitFact tests every variant of F against it. It is the newline-joined
// UNREDACTED text of four parts: (1) the summary row's stored body, whole, its transcript-pointer line kept; (2) every
// kept(N) member present in the store, in holding-copy order, each with its primary body and every entry_variants
// body; (3) the holding copy's rows after the summary row, up to but excluding the first operator-provenance or
// assistant row that is not a kept member, at most BASELINE_POST_ROWS_MAX of them
// (D-6278); (4) the baseline files (W2-D69). Every row of (1)-(3) is in B twice: as lib's renderEntryText, and as its
// plain string leaves, ftsTextOf's, or every string leaf of an object body (D-6279).
// The copy is Task 1's boundaryCopyOf, read again and held to the one admission judged (R3). Every blob B reads goes
// through derive.mjs's bodyOf over Task 1's blobReadStmts (W2-D33), and the kept list is Task 1's keptMembersOf and
// keptRowsOf. derive.mjs's kept-set reader folds a NULL id, a tombstone and a body that is not an array into one empty
// set, which would read as "nothing was kept" and admit facts the session still saw; Task 1's scan keeps it out of
// every deploy/*.mjs (W2-D33).
// B is held in memory only: never written under --out, never logged, never spawned. Its text is a non-enumerable
// property of a frozen answer, so canonicalJson, JSON.stringify and util.inspect never carry it; only counts are
// recorded (baselineRow, writeBaselineRecord). A boundary whose B cannot be built whole is discarded with a
// RECON_DISCARDS word and counted, never read as empty text. W2-D69's files are read through readPlain with links
// followed, as Claude Code follows them: still nothing but a regular file of at most BASELINE_FILE_MAX is opened.

/** The baseline file set this code reads (W2-D69), recorded as the open record's quiz.baseline_files and in the
 *  pilot's `used`. A change to the set is a W2-5a amendment before part 1, under a new id; history-replay.test.ts pins
 *  this id to the open record's default (OPEN_RECORD_V1), as decisions §7 pins CODE_SHA_FILES to GATE_CODE_FILES. */
export const BASELINE_FILES_ID = OPEN_RECORD_V1.draft.quiz.fields.baseline_files.value;   // read from the gate's record, never spelled twice
/** The largest baseline file read (W2-D69): a larger one discards its boundary, `file-over-cap`. */
export const BASELINE_FILE_MAX = 1024 * 1024;
/** The most rows B's part 3 takes (W2-D68): one more discards its boundary, `post-over-cap`. */
export const BASELINE_POST_ROWS_MAX = 200;
/** How deep `@`-imports are followed (W2-D69 (d)): a file of (a)-(c) is depth 0. */
export const BASELINE_IMPORT_DEPTH = 5;
/** The instruction files W2-D69 (a) reads in each listed directory and in each of its ancestors. */
export const BASELINE_NAMES = Object.freeze(['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md']);
/** The --out sections a baseline record is written under (W2-D72's layout). */
export const BASELINE_SECTIONS = Object.freeze(['quiz', 'pilot']);
/** The baseline record's file name in its section. */
export const BASELINE_RECORD = 'baseline.json';
/** The baseline record's kind. */
export const BASELINE_RECORD_KIND = 'ccrc-history-w2-baseline';

/** @typedef {{state: 'built', bytes: number, files: number, keptMembers: number, keptAbsent: number, postRows: number, readonly text: string}} BaselineBuilt */
/** @typedef {{state: 'discard', why: string}} BaselineDiscard */
/** @typedef {BaselineBuilt | BaselineDiscard} BaselineAnswer */
/** An admitted row of Task 3's admitStoreBoundaries, read in part.
 *  @typedef {{entry_id: number, uuid: string, transcript_pk: number, admitted: boolean, file_id: number | null,
 *    boundary_index: number | null, summary_index: number | null, summary_entry_id: number | null}} BaselineBoundary */

/** Why a boundary has no B (W2-D68, W2-D69): a RECON_DISCARDS word (R5), counted in the baseline record, never refused.
 *  `copy-moved`: the holding copy is not the one admission judged (another file, the boundary at another index, or
 *  another summary row; W2-D68's "absent summary row" is Task 3's own `summary-absent` drop, before B). `cwd-unknown`:
 *  N's epoch has no absolute cwd, or no longer answers.
 *  @param {string} why  @returns {BaselineDiscard} */
const blDiscard = (why) => ({ state: 'discard', why });
/** Code-unit order (W2-D18's comparison, never a locale's). */
const blOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const BL_STMTS = new WeakMap();

/** The reads B adds to Task 1's, prepared once per handle, each naming its columns: a member's variants, a transcript's
 *  session uuid and a family's epochs up to N's. The copy, its rows and the kept list are Task 1's readers. */
function blStmts(db) {
  let s = BL_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    variants: db.prepare('SELECT blob_id FROM entry_variants WHERE entry_id = ? ORDER BY blob_id'),
    transcript: db.prepare('SELECT cc_session_uuid FROM transcripts WHERE transcript_pk = ?'),
    epochs: db.prepare('SELECT seq, cwd, cwd_real FROM epochs WHERE session_pk = ? AND seq <= ? ORDER BY seq'),
  };
  BL_STMTS.set(db, s);
  return s;
}

/** A kept member's blobs (a row of Task 1's keptRowsOf): its primary, then every entry_variants blob but the primary, by
 *  blob id, whatever its cause. */
const blMemberBlobs = (s, m) => [Number(m.blob_id), ...s.variants.all(Number(m.entry_id)).map((v) => Number(v.blob_id)).filter((id) => id !== Number(m.blob_id))];

/** Every string leaf of a value, depth-first in key order, with an explicit stack: an attachment's object can nest. */
function blObjectLeaves(value) {
  const out = [];
  const stack = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i -= 1) stack.push(v[i]);
    else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i >= 0; i -= 1) stack.push(v[keys[i]]);
    }
  }
  return out.join('\n');
}

/** A row's plain string leaves (W2-D68's second rendering): ftsTextOf's for a string or a block list; for an object
 *  body (an attachment's, where ftsTextOf answers '') every string leaf (D-6279). */
function blLeaves(body) {
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) return blObjectLeaves(body);
  return ftsTextOf(body, 'entry');
}

/** One row of parts 1-3 in both renderings (W2-D68), or null when renderEntryText cannot render the body: one nested past
 *  V8's JSON.stringify stack parses and then throws a RangeError, which renderOrNull turns into null so the caller fails
 *  closed as `body-unrenderable` (D-6304, as D-6302 and D-6303 rule). The string leaves never throw: blObjectLeaves is
 *  iterative and ftsTextOf is measured fine at every depth.
 *  @returns {string[] | null} */
function blRenderings(body) {
  const rendered = renderOrNull(() => renderEntryText(body));
  return rendered === null ? null : [rendered, blLeaves(body)];
}

/** A built B: its counts enumerable, its text not (W2-D68: never written, logged or spawned), the whole frozen. */
function blHeld(text, counts) {
  const b = { state: 'built', bytes: Buffer.byteLength(text, 'utf8'), ...counts };
  Object.defineProperty(b, 'text', { value: text, enumerable: false });
  return Object.freeze(b);
}

/** Baseline B for one boundary Task 3's admitStoreBoundaries admitted (W2-D68), unredacted, in memory only. The parts
 *  are built in order and the first failure answers `{state: 'discard', why}` with a RECON_DISCARDS word; otherwise
 *  `{state: 'built', bytes, files, keptMembers, keptAbsent, postRows}` with a non-enumerable `text`. `ctx.configDirs` is
 *  Task 2's rosterConfigDirs answer from the run's one roster read (W2-D52); `ctx.budget` is the run's bodyOf byte
 *  budget; `ctx.home` resolves a `~` import; `ctx.top`, which no subcommand passes, is the highest ancestor W2-D69 (a)
 *  walks. A row that is not admitted, or a ctx without configDirs, is a caller defect (TypeError).
 *  @param {ReplayStore} rs Task 1's store
 *  @param {BaselineBoundary} boundary
 *  @param {{home: string, configDirs: readonly string[], budget: {bytes: number}, top?: string}} ctx
 *  @returns {BaselineAnswer} */
export function baselineOf(rs, boundary, ctx) {
  if (boundary.admitted !== true || boundary.file_id === null || boundary.boundary_index === null || boundary.summary_index === null
    || boundary.summary_entry_id === null) {
    throw new TypeError('baselineOf: B is built only for a boundary admitStoreBoundaries admitted');
  }
  if (!Array.isArray(ctx.configDirs)) throw new TypeError("baselineOf: ctx.configDirs is rosterConfigDirs' answer, an array");
  const s = blStmts(rs.db);
  // The copy admission judged, read again through Task 1's one holding-copy reader: the same file, the boundary at its
  // index, and at the summary's index the summary row admission named. Anything else moved: never a guess (R3).
  const copy = boundaryCopyOf(rs, Number(boundary.entry_id));
  const sum = copy.state === 'copy' && copy.summaryIndex !== null ? copy.rows[copy.summaryIndex] : undefined;
  if (copy.state !== 'copy' || copy.fileId !== Number(boundary.file_id) || copy.boundaryIndex !== Number(boundary.boundary_index)
    || copy.summaryIndex !== Number(boundary.summary_index) || sum === undefined || Number(sum.entry_id) !== Number(boundary.summary_entry_id)) return blDiscard('copy-moved');
  const parts = [];
  // (1) the summary row, whole. Its transcript-pointer line stays here; only the payload replaces it (W2-D75).
  const summary = bodyOf(rs.blobs, Number(sum.blob_id), ctx.budget);
  if (summary === null) return blDiscard('summary-unreadable');
  const summaryParts = blRenderings(summary);
  if (summaryParts === null) return blDiscard('body-unrenderable');
  parts.push(...summaryParts);
  // (2) kept(N), through Task 1's kept-list reader with B's budget: every member's primary and every variant.
  const kept = keptMembersOf(rs, copy.boundary, ctx.budget);
  if (kept.state !== 'kept') return kept;
  const members = keptRowsOf(rs, kept.uuids, copy.fileId);
  const keptIds = new Set();
  for (const m of members.rows) {
    keptIds.add(Number(m.entry_id));
    for (const blobId of blMemberBlobs(s, m)) {
      const body = bodyOf(rs.blobs, blobId, ctx.budget);
      if (body === null) return blDiscard('kept-member-unreadable');
      const memberParts = blRenderings(body);
      if (memberParts === null) return blDiscard('body-unrenderable');
      parts.push(...memberParts);
    }
  }
  // (3) the copy's rows after the summary row, to the first operator or assistant row that is not a kept member.
  let postRows = 0;
  let stopped = null;
  for (const r of copy.rows.slice(copy.summaryIndex + 1)) {
    if (keptIds.has(Number(r.entry_id))) continue;   // part 2's row, never the stop (D-6278)
    if (r.type === 'assistant' || r.provenance === 'operator') break;
    postRows += 1;
    if (postRows > BASELINE_POST_ROWS_MAX) { stopped = 'post-over-cap'; break; }
    const body = bodyOf(rs.blobs, Number(r.blob_id), ctx.budget);
    if (body === null) { stopped = 'post-row-unreadable'; break; }
    const rowParts = blRenderings(body);
    if (rowParts === null) { stopped = 'body-unrenderable'; break; }
    parts.push(...rowParts);
  }
  if (stopped !== null) return blDiscard(stopped);
  // (4) the baseline files, over N's epoch as Task 3 found its family (derive.mjs's epochOfUuid).
  const t = s.transcript.get(Number(boundary.transcript_pk));
  const ep = t === undefined ? null : epochOfUuid(rs.db, t.cc_session_uuid);
  if (ep === null) return blDiscard('cwd-unknown');
  const files = baselineFiles({
    home: ctx.home, configDirs: ctx.configDirs, epochs: s.epochs.all(Number(ep.session_pk), Number(ep.seq)),
    epochSeq: Number(ep.seq), top: ctx.top,
  });
  if (files.state === 'discard') return files;
  for (const f of files.files) parts.push(f.text);
  return blHeld(parts.join('\n'), { files: files.files.length, keptMembers: members.rows.length, keptAbsent: members.absent, postRows });
}

/** W2-D69 (a) and (b)'s paths, in reading order, each once: for every listed cwd (code-unit order), BASELINE_NAMES in it
 *  and in each ancestor up to `top` (default: the filesystem root), then CLAUDE.md in every config dir. Pure.
 *  @param {{cwds: readonly string[], configDirs: readonly string[], top?: string}} o  @returns {string[]} */
export function baselineCandidates({ cwds, configDirs, top }) {
  const out = new Set();
  for (const cwd of [...cwds].sort(blOrder)) {
    for (let dir = cwd; ; dir = path.dirname(dir)) {
      for (const name of BASELINE_NAMES) out.add(join(dir, name));
      if (dir === top || dir === path.dirname(dir)) break;
    }
  }
  for (const c of configDirs) out.add(join(c, 'CLAUDE.md'));
  return [...out];
}

/** A directory's state, following links: 'dir'; 'missing' (ENOENT, ENOTDIR, or not a directory); 'unreadable'. */
function blDirState(d) {
  let st;
  try {
    st = statSync(d);
  } catch (e) {
    return e?.code === 'ENOENT' || e?.code === 'ENOTDIR' ? 'missing' : 'unreadable';
  }
  return st.isDirectory() ? 'dir' : 'missing';
}

/** Every `*.md` under a memory directory (W2-D69 (c)): real subdirectories walked, a link never walked as a directory,
 *  names in code-unit order. An absent directory (ENOENT, or a path through a regular file) holds none; any other
 *  failure to list answers null, which discards the boundary, `file-unreadable`. */
function blMemoryFiles(root) {
  const out = [];
  const walk = (dir) => {
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return dir === root && (e?.code === 'ENOENT' || e?.code === 'ENOTDIR');
    }
    for (const d of [...ents].sort((a, b) => blOrder(a.name, b.name))) {
      const p = join(dir, d.name);
      if (d.isDirectory()) {
        if (!walk(p)) return false;
      } else if (d.name.endsWith('.md')) out.push(p);
    }
    return true;
  };
  return walk(root) ? out : null;
}

/** `@`-mentions (W2-D69 (d)): an `@` at the start or after whitespace and the run of non-space after it, trailing
 *  punctuation dropped. `~/` is `home`; anything else resolves against the importing file's directory. Over-reading
 *  only rejects more facts; a mention that names nothing or a directory is left out by blRead. */
const BL_IMPORT_RE = /(?<=^|\s)@(\S+)/g;
const BL_IMPORT_TRAIL = /[.,;:!?)\]}'"`>]+$/;
function blImports(text, file, home) {
  const out = [];
  for (const m of text.matchAll(BL_IMPORT_RE)) {
    const tok = m[1].replace(BL_IMPORT_TRAIL, '');
    if (tok === '' || tok === '~' || tok.includes('\0')) continue;
    out.push(tok.startsWith('~/') ? join(home, tok.slice(2)) : path.resolve(path.dirname(file), tok));
  }
  return out;
}

/** One baseline file through readPlain, links followed (W2-D69). `absent` leaves it out: nothing there, or a path
 *  through a regular file (ENOTDIR); for an `@`-import also a directory or a name too long to be a path, since such a
 *  mention is not an import. Anything else that is not a regular file of at most BASELINE_FILE_MAX discards. */
function blRead(p, imported) {
  const r = readPlain(p, BASELINE_FILE_MAX, true);
  if (r.state !== 'bad') return r;
  if (r.why === 'unreadable' && (r.code === 'ENOTDIR' || (imported && r.code === 'ENAMETOOLONG'))) return { state: 'absent' };
  if (imported && r.why === 'not-regular' && blDirState(p) === 'dir') return { state: 'absent' };
  if (r.why === 'over-cap') return blDiscard('file-over-cap');
  if (r.why === 'not-regular') return blDiscard('file-not-regular');
  return blDiscard('file-unreadable');
}

/** W2-D69's files for boundary N, read whole. `epochs` are the family's epochs up to and including N's ({seq, cwd,
 *  cwd_real}), `epochSeq` N's. N's cwd must be known and absolute (`cwd-unknown`), and it and N's cwd_real must exist as
 *  directories (`cwd-missing`, `cwd-unreadable`). Then every candidate (baselineCandidates over the distinct absolute
 *  cwd and cwd_real values), every `*.md` under `<config dir>/projects/<projectSlugOf(cwd)>/memory/` for each config dir
 *  and listed cwd, then their `@`-imports breadth-first to BASELINE_IMPORT_DEPTH, `~` read as `home`, each path once.
 *  An absent file is left out; any other failure discards (blRead).
 *  @param {{home: string, configDirs: readonly string[], epochs: ReadonlyArray<{seq: number, cwd: string | null, cwd_real: string | null}>, epochSeq: number, top?: string}} o
 *  @returns {{state: 'files', files: Array<{path: string, text: string}>} | BaselineDiscard} */
export function baselineFiles({ home, configDirs, epochs, epochSeq, top }) {
  const n = epochs.find((e) => Number(e.seq) === epochSeq);
  if (n === undefined) return blDiscard('cwd-unknown');
  const nDirs = [n.cwd, n.cwd_real].filter((d) => d !== null);
  if (typeof n.cwd !== 'string' || !nDirs.every((d) => typeof d === 'string' && path.isAbsolute(d))) return blDiscard('cwd-unknown');
  for (const d of nDirs) {
    const st = blDirState(d);
    if (st === 'missing') return blDiscard('cwd-missing');
    if (st === 'unreadable') return blDiscard('cwd-unreadable');
  }
  const cwds = [...new Set(epochs.flatMap((e) => [e.cwd, e.cwd_real]).filter((d) => typeof d === 'string' && path.isAbsolute(d)))].sort(blOrder);
  const roots = baselineCandidates({ cwds, configDirs, top });
  for (const c of configDirs) {
    for (const cwd of cwds) {
      const listed = blMemoryFiles(join(c, 'projects', projectSlugOf(cwd), 'memory'));
      if (listed === null) return blDiscard('file-unreadable');
      roots.push(...listed);
    }
  }
  const seen = new Set();
  const files = [];
  let frontier = roots.map((p) => ({ p, depth: 0 }));
  while (frontier.length > 0) {
    const next = [];
    for (const { p, depth } of frontier) {
      if (seen.has(p)) continue;
      seen.add(p);
      const r = blRead(p, depth > 0);
      if (r.state === 'absent') continue;
      if (r.state === 'discard') return r;
      const text = r.bytes.toString('utf8');
      files.push({ path: p, text });
      if (depth < BASELINE_IMPORT_DEPTH) for (const q of blImports(text, p, home)) next.push({ p: q, depth: depth + 1 });
    }
    frontier = next;
  }
  return { state: 'files', files };
}

/** One boundary's line in the baseline record: counts and the discard word, never B's text (W2-D68).
 *  @param {string} boundaryUuid  @param {BaselineAnswer} b */
export function baselineRow(boundaryUuid, b) {
  if (b.state === 'built') {
    return { boundary_uuid: boundaryUuid, state: 'built', why: null, bytes: b.bytes, files: b.files, kept_members: b.keptMembers,
      kept_absent: b.keptAbsent, post_rows: b.postRows };
  }
  return { boundary_uuid: boundaryUuid, state: 'discard', why: b.why, bytes: null, files: null, kept_members: null, kept_absent: null,
    post_rows: null };
}

/** `<out>/<section>/baseline.json` (0600), the run's baseline record: exactly the bytes of canonicalJson({kind, v: 1,
 *  baseline_files, store_id, boundaries, discards}) and one newline, `boundaries` sorted by boundary_uuid (code unit) and
 *  `discards` counting each word. Written through ensurePlainDir and writePlain (D-5986: a link or a non-directory at the
 *  section, or a non-regular file at the record, refuses out-refused), and answered as the sha256 of the bytes on disk.
 *  A section outside BASELINE_SECTIONS, or one boundary twice, is a caller defect (TypeError). The pilot's per-boundary
 *  file counts are read from this record (W2-D69).
 *  @param {string} out  @param {string} section
 *  @param {{storeId: string, rows: ReadonlyArray<ReturnType<typeof baselineRow>>}} o  @returns {string} */
export function writeBaselineRecord(out, section, { storeId, rows }) {
  if (!BASELINE_SECTIONS.includes(section)) {
    throw new TypeError(`writeBaselineRecord: section ${JSON.stringify(section)} is not one of ${BASELINE_SECTIONS.join(', ')}`);
  }
  const sorted = [...rows].sort((a, b) => blOrder(a.boundary_uuid, b.boundary_uuid));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].boundary_uuid === sorted[i - 1].boundary_uuid) throw new TypeError(`writeBaselineRecord: boundary ${sorted[i].boundary_uuid} twice`);
  }
  const discards = {};
  for (const r of sorted) if (r.state === 'discard') discards[r.why] = (discards[r.why] ?? 0) + 1;
  const rel = `${section}/${BASELINE_RECORD}`;
  ensurePlainDir(out, section);
  writePlain(out, rel, `${canonicalJson({ kind: BASELINE_RECORD_KIND, v: 1, baseline_files: BASELINE_FILES_ID, store_id: storeId, boundaries: sorted, discards })}\n`);
  return shaOfPlain(out, rel);
}

// ── W2-5a Task 5: answerability, the same-millisecond count and sampling (W2-D70, W2-D34, W2-D71; D-5780) ──────────
// Answerability (W2-D70) asks whether boundary N's own store could answer a fact at all. Some source in leaf N's span
// holds F_raw verbatim in the text the index holds; that blob is indexed and unpruned; the index's own MATCH returns
// it; and (clause 4, D-5780) the source is stamped at or before T_N. Clause 4 removes what the as-of cut (W2-D34,
// W2-D35) hides: a NULL-ts row, and a sidecar with no entry. The same-millisecond count (W2-D34's residual) is
// reported per admitted question and decides nothing. Sampling (W2-D71) walks families, then each family's
// candidates, in seeded order (the quiz's families in their own keyed order, quizFamilyOrderKey, R10; the pilot's on its one
// stream), skips by quota before any filter, and runs the filters lazily in QUIZ_STAGES'
// order. Every read here is on the read-only handle; nothing writes.

/** The filters a quiz candidate passes, in W2-D71's order. sampleQuestions runs them in exactly this order, lazily:
 *  a candidate a quota skips reaches none of them, and one a stage drops reaches no later stage. This task ships the
 *  `answerable` stage (answerableStage); the subcommand that samples hands in the rest. */
export const QUIZ_STAGES = Object.freeze(['redaction', 'producer', 'admit-baseline', 'answerable', 'writer', 'admit-question']);

/** What sampling counts when a quota, not a filter, passes a candidate over (W2-D71's caps). A skipped candidate
 *  reaches no stage. */
export const QUOTA_SKIPS = Object.freeze(['cap-family', 'cap-boundary', 'cap-kind']);

/** Why one source fails W2-D70, each word with the clause it belongs to. checkSource answers one of these. W2-5b1's
 *  re-check before an arm batch (W2-D78(iii)(b), ruling Q21: any answerable source) reads answerability, which folds a
 *  question's sources to answerable, untimed or unanswerable, and names that word, not a clause number. */
export const SOURCE_FAILS = Object.freeze({
  'entry-absent': 1, provenance: 1, 'not-verbatim': 1,
  'blob-absent': 2, 'not-indexed': 2, pruned: 2,
  'no-match': 3,
  unlinked: 4, 'ts-null': 4, 'ts-after': 4,
});

const ANSWER_STMTS = new WeakMap();
/** The reads answerability makes, prepared once per handle. */
function answerStmts(db) {
  let s = ANSWER_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    entry: db.prepare('SELECT entry_id, uuid, ts_ms, provenance, blob_id FROM entries WHERE entry_id = ?'),
    // A sidecar is a source when it is linked to a searchable span row, and also when it is linked to nothing
    // (entry_id NULL): clauses 1 to 3 read such a sidecar as the spec did, and clause 4 removes it (D-5780), so the
    // removal is counted. A sidecar linked to any other row is never a source.
    sidecars: db.prepare(`SELECT name, blob_id, entry_id FROM sidecars WHERE transcript_pk = ?
      AND (entry_id IS NULL OR entry_id IN (SELECT value FROM json_each(?))) ORDER BY name, blob_id`),
    blob: db.prepare('SELECT z, raw_len, fts_indexed, pruned_ms FROM blobs WHERE blob_id = ?'),
    // D-6479: node:sqlite binds a JS number as REAL, and FTS5 then ignores a `rowid = ?` constraint, answering ANY row the
    // phrase matches. The CAST makes the constraint apply, and checkSource still decides on the returned rowid itself.
    match: db.prepare('SELECT rowid FROM blobs_fts WHERE blobs_fts MATCH ? AND rowid = CAST(? AS INTEGER)'),
  };
  ANSWER_STMTS.set(db, s);
  return s;
}

/** A blob's index text as the sweep writes it. indexBlob inserts entryIndexText over ftsTextOfBlob's text, and
 *  rederiveFts recomputes it the same way. A blob ftsTextOfBlob answers over-cap or undecodable gets no index row.
 *  The driver calls the sweep's own function, so deploy/ holds no second decode (W2-D74).
 *  @returns {Promise<{state: 'text', text: string} | {state: 'none'}>} */
async function indexTextOf(b, isSidecar, idx) {
  if (b.z === null) return { state: 'none' };
  const t = await ftsTextOfBlob(b.z, isSidecar, idx, Number(b.raw_len));
  if (t.undecodable === true || t.overCap === true) return { state: 'none' };
  return { state: 'text', text: entryIndexText(t.text, idx) };
}

/** @param {keyof typeof SOURCE_FAILS} why */
const sourceFail = (why) => ({ ok: false, clause: SOURCE_FAILS[why], why });

/**
 * One source against W2-D70's four clauses, cheapest first. The order is clause 1's provenance part, then clause 2,
 * clause 3, clause 1's verbatim part, and clause 4 last, so "passes 1 to 3 and fails 4" is measured. The answer names
 * the first clause that fails. The caller vouches that an entry source is a leaf-N span row; a sidecar source with a
 * null entryId is an unlinked sidecar.
 * @param {object} db the read-only handle
 * @param {object} idx the run's pair index
 * @param {{via: 'entry'|'sidecar', entryId: number|null, blobId: number, name: string|null}} source
 * @param {string} factRaw F_raw (W2-D61)
 * @param {number} tsMs T_N, boundary N's own ts_ms
 * @returns {Promise<{ok: true, entryUuid: string} | {ok: false, clause: number, why: string}>}
 */
export async function checkSource(db, idx, source, factRaw, tsMs) {
  if (typeof factRaw !== 'string' || factRaw === '') throw new TypeError('checkSource: factRaw is a non-empty string');
  if (!Number.isSafeInteger(tsMs)) throw new TypeError(`checkSource: tsMs=${String(tsMs)} is not an integer`);
  if (source.via !== 'entry' && source.via !== 'sidecar') throw new TypeError(`checkSource: via ${JSON.stringify(source.via)}`);
  if (source.via === 'entry' && source.entryId === null) throw new TypeError('checkSource: an entry source names its entry');
  const s = answerStmts(db);
  let row = null;
  if (source.entryId !== null) {
    row = s.entry.get(source.entryId) ?? null;
    if (row === null) return sourceFail('entry-absent');
    if (!SEARCHABLE_PROVENANCE.includes(row.provenance)) return sourceFail('provenance');
  }
  const b = s.blob.get(source.blobId);
  if (b === undefined) return sourceFail('blob-absent');
  if (Number(b.fts_indexed) !== 1) return sourceFail('not-indexed');
  if (b.pruned_ms !== null || b.z === null) return sourceFail('pruned');
  const hit = s.match.get(ftsPhrase(factRaw), source.blobId);
  if (hit === undefined || Number(hit.rowid) !== Number(source.blobId)) return sourceFail('no-match');
  const t = await indexTextOf(b, source.via === 'sidecar', idx);
  if (t.state !== 'text' || !t.text.includes(factRaw)) return sourceFail('not-verbatim');
  if (row === null) return sourceFail('unlinked');
  if (row.ts_ms === null) return sourceFail('ts-null');
  if (Number(row.ts_ms) > tsMs) return sourceFail('ts-after');
  return { ok: true, entryUuid: row.uuid };
}

/**
 * W2-D70: is F_raw answerable from leaf N's span? Sources are the span's rows in holding-copy file order, then the
 * span transcript's sidecars that are linked to a searchable span row or to nothing, by (name, blob_id). The first
 * source that passes all four clauses answers. With none, `untimed` says some source passed clauses 1 to 3 and only
 * clause 4 (D-5780) removed it, and `unanswerable` says none did. A span id missing from the store is a defect: the
 * caller read the span from this store.
 * @param {object} db
 * @param {object} idx
 * @param {{tsMs: number, transcriptPk: number, spanEntryIds: number[]}} ctx
 * @param {string} factRaw
 * @returns {Promise<{state: 'answerable', source: {via: 'entry'|'sidecar', entryId: number|null, blobId: number, name: string|null, entryUuid: string}} | {state: 'untimed'} | {state: 'unanswerable'}>}
 */
export async function answerability(db, idx, ctx, factRaw) {
  if (!Array.isArray(ctx.spanEntryIds)) throw new TypeError('answerability: spanEntryIds is an array');
  const s = answerStmts(db);
  const rows = ctx.spanEntryIds.map((id) => {
    const r = s.entry.get(id);
    if (r === undefined) throw new TypeError(`answerability: span entry ${String(id)} is not in the store`);
    return r;
  });
  const linkable = rows.filter((r) => SEARCHABLE_PROVENANCE.includes(r.provenance)).map((r) => Number(r.entry_id));
  const sources = [
    ...rows.map((r) => ({ via: 'entry', entryId: Number(r.entry_id), blobId: Number(r.blob_id), name: null })),
    ...s.sidecars.all(ctx.transcriptPk, JSON.stringify(linkable)).map((c) => ({
      via: 'sidecar', entryId: c.entry_id === null ? null : Number(c.entry_id), blobId: Number(c.blob_id), name: c.name,
    })),
  ];
  let untimed = false;
  for (const src of sources) {
    const v = await checkSource(db, idx, src, factRaw, ctx.tsMs);
    if (v.ok) return { state: 'answerable', source: { ...src, entryUuid: v.entryUuid } };
    if (v.clause === 4) untimed = true;
  }
  return { state: untimed ? 'untimed' : 'unanswerable' };
}

/**
 * The `answerable` stage (QUIZ_STAGES[3]). It keeps an answerable candidate with its `source`, which freeze reads as
 * `source_entry_uuid` (W2-D73), and drops the rest as `unanswerable`, or as `unanswerable-untimed` when only clause 4
 * (D-5780) removed every source: two FACT_DROP_REASONS words (R5), so what D-5780 costs is counted apart.
 * @param {object} db
 * @param {object} idx
 * @param {(candidate: object) => {tsMs: number, transcriptPk: number, spanEntryIds: number[], factRaw: string}} contextOf
 */
export function answerableStage(db, idx, contextOf) {
  return async (candidate) => {
    const c = contextOf(candidate);
    const a = await answerability(db, idx, c, c.factRaw);
    if (a.state === 'answerable') return { keep: true, candidate: { ...candidate, source: a.source } };
    return { keep: false, reason: a.state === 'untimed' ? 'unanswerable-untimed' : 'unanswerable' };
  };
}

/**
 * The transcripts the CLI searches for one family (R6): recall.mjs's own family scope, never a second family rule.
 * familiesOf with kind 'family' answers the family's row-life (a family a re-key merged answers the family it merged
 * into), and transcriptsOf its confirmed epochs' transcripts that hold rows. The same-millisecond count reads this.
 * @param {object} db
 * @param {{ccrc_id: string, generation: string}} f
 * @returns {number[]}
 */
export function familyScopeOf(db, f) {
  const fams = scopeFamiliesOf(db, { kind: 'family', id: f.ccrc_id, generation: f.generation, project: null, workdir: null, workdirReal: null });
  return transcriptsOf(db, fams.map((x) => x.sessionPk));
}

/** W2-D34's same-millisecond count. These are the entries holding an FTS hit for the phrase, by their own row, a variant
 *  or a linked sidecar, that the cut leaves visible outside N's holding copy at exactly T_N: stamped T_N, in the family's
 *  transcripts, searchable (a sidecar by its route, as grep shows it), and not a member of the holding file. Each entry is
 *  counted once. N's boundary and summary entries are members of that file, and a kept(N) member stamped T_N outside it
 *  is visible by its stamp anyway, so no cut code is needed. */
const SAME_MS_SQL = `WITH m(blob_id) AS (SELECT rowid FROM blobs_fts WHERE blobs_fts MATCH :q),
  hit(entry_id, via) AS (
    SELECT e.entry_id, 'row' FROM m JOIN entries e ON e.blob_id = m.blob_id
    UNION SELECT v.entry_id, 'row' FROM m JOIN entry_variants v ON v.blob_id = m.blob_id
    UNION SELECT s.entry_id, 'sidecar' FROM m JOIN sidecars s ON s.blob_id = m.blob_id)
  SELECT count(DISTINCT e.entry_id) AS n FROM hit h JOIN entries e ON e.entry_id = h.entry_id
  WHERE e.ts_ms = :t
    AND e.transcript_pk IN (SELECT value FROM json_each(:tpks))
    AND (h.via = 'sidecar' OR e.provenance IN (SELECT value FROM json_each(:provs)))
    AND NOT EXISTS (SELECT 1 FROM memberships mb WHERE mb.file_id = :hold AND mb.entry_id = e.entry_id)`;
const SAME_MS_STMTS = new WeakMap();

/**
 * `asof_same_ms_hits` for one admitted question (W2-D34). Reported, never gating: nothing in sampling reads it.
 * @param {object} db
 * @param {{tsMs: number, holdingFileId: number, transcriptPks: number[]}} ctx
 * @param {string} factRaw
 * @returns {number}
 */
export function asofSameMsHits(db, ctx, factRaw) {
  if (typeof factRaw !== 'string' || factRaw === '') throw new TypeError('asofSameMsHits: factRaw is a non-empty string');
  if (!Number.isSafeInteger(ctx.tsMs) || !Number.isSafeInteger(ctx.holdingFileId) || !Array.isArray(ctx.transcriptPks)) {
    throw new TypeError('asofSameMsHits: tsMs and holdingFileId are integers and transcriptPks an array');
  }
  let st = SAME_MS_STMTS.get(db);
  if (st === undefined) {
    st = db.prepare(SAME_MS_SQL);
    SAME_MS_STMTS.set(db, st);
  }
  const r = st.get({
    q: ftsPhrase(factRaw), t: ctx.tsMs, hold: ctx.holdingFileId,
    tpks: JSON.stringify(ctx.transcriptPks), provs: JSON.stringify(SEARCHABLE_PROVENANCE),
  });
  return Number(r.n);
}

/** sampleQuestions' `afterAdmit` for the quiz: each admitted question's report, keyed by its qid beside the frozen list,
 *  never in it (W2-D73 fixes the entry keys). */
export function sameMsReport(db, contextOf) {
  return async (candidate) => {
    const c = contextOf(candidate);
    return { asof_same_ms_hits: asofSameMsHits(db, c, c.factRaw) };
  };
}

/** Code-unit order (W2-D18's amendment). */
const cmpUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** @param {{store_id: string, ccrc_id: string, generation: string}} f */
const familyKeyOf = (f) => familyKey(f.store_id, f.ccrc_id, f.generation);

/**
 * A seeded order (W2-D18's amendment, W2-D71). `items` is sorted by `keyOf`, by code unit, and a key listed twice is
 * a defect. Then a Fisher–Yates order is drawn from `rng` by randInt, as handcheckSample draws: n − 1 draws for n items.
 * The same stream and the same items give the same order in any input order.
 * @template T
 * @param {{nextU32(): number}} rng
 * @param {readonly T[]} items
 * @param {(item: T) => string} keyOf
 * @returns {T[]}
 */
export function seededOrder(rng, items, keyOf) {
  const keyed = items.map((it) => {
    const k = keyOf(it);
    if (typeof k !== 'string') throw new TypeError('seededOrder: every key is a string');
    return /** @type {[string, T]} */ ([k, it]);
  });
  keyed.sort((a, b) => cmpUnit(a[0], b[0]));
  for (let i = 1; i < keyed.length; i += 1) {
    if (keyed[i - 1][0] === keyed[i][0]) throw new TypeError(`seededOrder: the key ${JSON.stringify(keyed[i][0])} is listed twice`);
  }
  const out = keyed.map(([, it]) => it);
  for (let s = 0; s < out.length - 1; s += 1) {
    const j = s + randInt(rng, out.length - s);
    [out[s], out[j]] = [out[j], out[s]];
  }
  return out;
}

/** A keyed family order (W2-D71 as amended 2026-10-22; R10): the families sorted by `keyOf`, by code unit, each with
 *  its key, which is its family rank. No draw. A key that is not a non-empty string, or one listed twice (one family
 *  given twice), is a defect.
 *  @template F  @param {readonly F[]} families  @param {(f: F) => string} keyOf  @returns {Array<[string, F]>} */
function keyedOrder(families, keyOf) {
  const pairs = families.map((f) => {
    const k = keyOf(f);
    if (typeof k !== 'string' || k === '') throw new TypeError('sampleQuestions: every family order key is a non-empty string');
    return /** @type {[string, F]} */ ([k, f]);
  });
  pairs.sort((x, y) => cmpUnit(x[0], y[0]));
  for (let i = 1; i < pairs.length; i += 1) {
    if (pairs[i - 1][0] === pairs[i][0]) throw new TypeError(`sampleQuestions: the family order key ${pairs[i][0]} is listed twice`);
  }
  return pairs;
}

/** The quiz's stream: the open record's seed, substream 'quiz-sample' (W2-D71). */
export function quizRng(recordSeedHex) {
  return substream(recordSeedHex, 'quiz-sample');
}

/** The pilot's stream: the pilot's own seed, never the record's, substream PILOT_SUBSTREAM (W2-D71, W2-D18). */
export function pilotRng(pilotSeedHex) {
  return substream(pilotSeedHex, PILOT_SUBSTREAM);
}

/** One family's own candidate stream: the walk's seed joined to the family's key, under the walk's label. A family's
 *  candidate order is then the same on whichever node holds it, whatever the other families hold, so every node's ranks
 *  are the global walk's and freeze merges them by rank alone (W2-D71; R4).
 *  @param {string} seedHex  @param {string} label 'quiz-sample' or PILOT_SUBSTREAM
 *  @param {{store_id: string, ccrc_id: string, generation: string}} family */
export function familyRng(seedHex, label, family) {
  return substream(`${seedHex}:${familyKeyOf(family)}`, label);
}

/** The quiz's per-family order key (W2-D71, as the coordinator amended it in place on 2026-10-22; R10): the
 *  'quiz-sample' substream's seed, sha256Hex(`<seed>:quiz-sample`) as the gate's substream derives it, hashed with the
 *  family's familyKey, as 64 lowercase hex. Families sorted by it, by code unit, come in one order on every node, and
 *  a node needs no list of the others' families, so each node's ranks are the walk over every node's (freeze merges by
 *  rank).
 *  @param {string} recordSeedHex  @param {{store_id: string, ccrc_id: string, generation: string}} family */
export function quizFamilyOrderKey(recordSeedHex, family) {
  if (typeof recordSeedHex !== 'string' || recordSeedHex === '') throw new TypeError('quizFamilyOrderKey: the seed is a non-empty string, passed in');
  return sha256Hex(`${sha256Hex(`${recordSeedHex}:quiz-sample`)}:${familyKeyOf(family)}`);
}

/** Where pilot-source pins its seed under --out (D-6313). */
export const PILOT_SEED_FILE = 'pilot/seed';
const SEED_HEX_RE = /^[0-9a-f]{64}$/;

/** pilot-source's seed for this --out, drawn once (D-6313): the pinned `<out>/pilot/seed` (0600, one line of 64 lowercase
 *  hex) when it is there, else `draw()` written there first. A re-run of a stopped batch (W2-D55: the batch can be
 *  resumed) then samples the same families and asks the same questions, so the writer inputs it pinned match, the finished
 *  asks are reused and the spend already charged is not orphaned. Read and written as every --out file is (D-5986): a
 *  seed that is not a regular file, is unreadable, or is not a seed refuses `out-refused`. No flag takes a seed; `draw`
 *  stays injectable (a test passes it).
 *  @param {string} out  @param {() => string} draw  @returns {string} */
function pinnedPilotSeed(out, draw) {
  const read = readPlain(path.join(out, PILOT_SEED_FILE), 1024);
  if (read.state === 'bad') refuse('out-refused', `${PILOT_SEED_FILE} ${badWord(read)}`);
  if (read.state === 'bytes') {
    const m = read.bytes.toString('utf8').match(/^([0-9a-f]{64})\n$/);
    if (m === null) refuse('out-refused', `${PILOT_SEED_FILE} is not a seed`);
    return m[1];
  }
  const seed = draw();
  if (typeof seed !== 'string' || !SEED_HEX_RE.test(seed)) throw new TypeError('pilotSourceCommand: deps.seed answers 64 lowercase hex');
  ensurePlainDir(out, 'pilot');
  writePlain(out, PILOT_SEED_FILE, `${seed}\n`);
  return seed;
}

/** A fresh seed: 32 bytes from `draw` (crypto's randomBytes), as 64 lowercase hex. pilot-source records it in the pilot
 *  section (W2-D71). No flag ever takes a seed; a test injects `draw`. */
export function drawSeedHex(draw = randomBytes) {
  const b = draw(32);
  if (!(b instanceof Uint8Array) || b.length !== 32) throw new TypeError('drawSeedHex: the draw is 32 bytes');
  return Buffer.from(b).toString('hex');
}

/**
 * The quiz population (W2-D71, W2-D77). It keeps the families with at least one W2-D66-admitted boundary and drops,
 * counted: every pilot family, and every family whose (store_id, ccrc_id) holds a control-assigned family at any
 * generation. The input order is kept.
 * @template {{store_id: string, ccrc_id: string, generation: string, admitted: number}} F
 * @param {F[]} families
 * @param {{pilotFamilies: Array<{store_id: string, ccrc_id: string, generation: string}>, assignment: Array<{store_id: string, ccrc_id: string, generation: string, arm: string}>}} o
 * @returns {{families: F[], excluded: {'no-admitted-boundary': number, pilot: number, 'control-id': number}}}
 */
export function quizPopulation(families, { pilotFamilies, assignment }) {
  const pilot = new Set(pilotFamilies.map(familyKeyOf));
  const controlIds = new Set();
  for (const a of assignment) {
    if (!ASSIGNMENT_ARMS.includes(a.arm)) throw new TypeError(`quizPopulation: arm ${JSON.stringify(a.arm)} is not an assignment arm`);
    if (a.arm === CONTROL_ARM) controlIds.add(canonicalJson([a.store_id, a.ccrc_id]));
  }
  const kept = [];
  const excluded = { 'no-admitted-boundary': 0, pilot: 0, 'control-id': 0 };
  for (const f of families) {
    if (!Number.isSafeInteger(f.admitted) || f.admitted < 0) throw new TypeError(`quizPopulation: admitted=${String(f.admitted)} is not a count`);
    if (f.admitted === 0) excluded['no-admitted-boundary'] += 1;
    else if (pilot.has(familyKeyOf(f))) excluded.pilot += 1;
    else if (controlIds.has(canonicalJson([f.store_id, f.ccrc_id]))) excluded['control-id'] += 1;
    else kept.push(f);
  }
  return { families: kept, excluded };
}

/** @param {string} name @param {unknown} v */
function assertCount(name, v) {
  if (!Number.isSafeInteger(v) || /** @type {number} */ (v) < 1) throw new TypeError(`sampleQuestions: the quota ${name}=${String(v)} is not a positive integer`);
}

/**
 * W2-D71's draw. Families come in seeded order (by familyKey), and within each family its candidates in seeded order
 * (by id), from the one `rng`, or from `candidateRng(family)` when it is given (a walk spread over nodes). With
 * `familyOrder`, the families are not drawn: they are sorted by `familyOrder(family)`, by code unit (the quiz passes
 * quizFamilyOrderKey, W2-D71 as amended 2026-10-22, R10). Each question carries `rank: [family rank, candidate rank]`,
 * its place in the two orders; the family rank is the family's index in the drawn order, or its key under
 * `familyOrder`, so the ranks of nodes that each hold some families merge into the one walk. A candidate is first checked against the quotas: the target, then the per-family,
 * per-boundary and per-kind caps, which count admitted questions only. A candidate a cap skips is counted under
 * QUOTA_SKIPS and reaches no stage. The rest run QUIZ_STAGES in order, and the first stage that drops one ends its run;
 * the drop is counted under that stage and its reason. `afterAdmit` runs once per admitted question, and its answer is
 * stored in `reports` and never read here. A family is mined (`candidates()`) only when the draw reaches it. Malformed
 * inputs are defects (TypeError).
 * @param {{families: Array<{store_id: string, ccrc_id: string, generation: string, candidates: () => Promise<Array<{id: string, kind: string, boundary_uuid: string}>>}>, rng: {nextU32(): number}, quotas: {target: number, caps: {family: number, boundary: number, kind_per_family: number}}, stages: Record<string, Function>, afterAdmit?: Function, candidateRng?: Function, familyOrder?: (family: {store_id: string, ccrc_id: string, generation: string}) => string}} o
 */
export async function sampleQuestions({ families, rng, quotas, stages, afterAdmit, candidateRng, familyOrder }) {
  for (const name of QUIZ_STAGES) if (typeof stages[name] !== 'function') throw new TypeError(`sampleQuestions: no '${name}' stage`);
  for (const name of Object.keys(stages)) if (!QUIZ_STAGES.includes(name)) throw new TypeError(`sampleQuestions: '${name}' is an unknown stage`);
  assertCount('target', quotas.target);
  for (const k of ['family', 'boundary', 'kind_per_family']) assertCount(`caps.${k}`, quotas.caps?.[k]);
  const drops = Object.fromEntries(QUIZ_STAGES.map((n) => [n, {}]));
  const skips = Object.fromEntries(QUOTA_SKIPS.map((w) => [w, 0]));
  const questions = [];
  const reports = {};
  const taken = new Set();
  const ordered = familyOrder === undefined ? [...seededOrder(rng, families, familyKeyOf).entries()] : keyedOrder(families, familyOrder);
  for (const [fi, f] of ordered) {
    if (questions.length >= quotas.target) break;
    const candidates = await f.candidates();
    for (const c of candidates) {
      if (!FACT_KINDS.includes(c.kind)) throw new TypeError(`sampleQuestions: candidate ${JSON.stringify(c.id)} has kind ${JSON.stringify(c.kind)}`);
      if (typeof c.boundary_uuid !== 'string' || c.boundary_uuid === '') throw new TypeError(`sampleQuestions: candidate ${JSON.stringify(c.id)} names no boundary`);
    }
    let inFamily = 0;
    const inBoundary = new Map();
    const inKind = new Map();
    const order = seededOrder(candidateRng === undefined ? rng : candidateRng(f), candidates, (x) => x.id);
    for (const [ci, c] of order.entries()) {
      if (questions.length >= quotas.target) break;
      if (inFamily >= quotas.caps.family) { skips['cap-family'] += 1; continue; }
      if ((inBoundary.get(c.boundary_uuid) ?? 0) >= quotas.caps.boundary) { skips['cap-boundary'] += 1; continue; }
      if ((inKind.get(c.kind) ?? 0) >= quotas.caps.kind_per_family) { skips['cap-kind'] += 1; continue; }
      let cur = c;
      let dropped = null;
      for (const name of QUIZ_STAGES) {
        const v = await stages[name](cur, f);
        if (v.keep === true) { cur = v.candidate; continue; }
        if (typeof v.reason !== 'string' || v.reason === '') throw new TypeError(`sampleQuestions: the '${name}' stage dropped ${JSON.stringify(c.id)} without a reason word`);
        dropped = { stage: name, reason: v.reason };
        break;
      }
      if (dropped !== null) {
        drops[dropped.stage][dropped.reason] = (drops[dropped.stage][dropped.reason] ?? 0) + 1;
        continue;
      }
      inFamily += 1;
      inBoundary.set(c.boundary_uuid, (inBoundary.get(c.boundary_uuid) ?? 0) + 1);
      inKind.set(c.kind, (inKind.get(c.kind) ?? 0) + 1);
      questions.push({ ...cur, rank: [fi, ci] });
      taken.add(familyKeyOf(f));
      if (afterAdmit !== undefined) reports[c.id] = await afterAdmit(cur, f);
    }
  }
  return { questions, families: [...taken].sort(cmpUnit), drops, skips, reports };
}

/** W2-D71's halt floor: fewer questions or fewer families than `haltFloor` (part 1's `quiz.halt_floor`) halts W2 for a
 *  ruling before part 2. Exactly the floor does not. */
export function quizFloor(nQuestions, nFamilies, haltFloor) {
  const short = [];
  if (nQuestions < haltFloor.questions) short.push('questions');
  if (nFamilies < haltFloor.families) short.push('families');
  return { halt: short.length > 0, short };
}

/**
 * The fidelity pilot's boundaries (W2-D71: sourced like the quiz). Families come in seeded order, and within each its
 * boundaries in seeded order (by boundary_uuid), from the one `rng`. The first boundary `admitBoundary` keeps is taken,
 * at most one per family, until `n`. A dropped boundary is counted by its reason. A family is read (`boundaries()`)
 * only when the draw reaches it.
 */
export async function sampleFidelityBoundaries({ families, rng, n, admitBoundary }) {
  if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(`sampleFidelityBoundaries: n=${String(n)} is not a positive integer`);
  const picked = [];
  const drops = {};
  for (const f of seededOrder(rng, families, familyKeyOf)) {
    if (picked.length >= n) break;
    for (const b of seededOrder(rng, await f.boundaries(), (x) => x.boundary_uuid)) {
      const v = await admitBoundary(b, f);
      if (v.keep === true) { picked.push({ family: f, boundary: b }); break; }
      if (typeof v.reason !== 'string' || v.reason === '') throw new TypeError('sampleFidelityBoundaries: a dropped boundary carries a reason word');
      drops[v.reason] = (drops[v.reason] ?? 0) + 1;
    }
  }
  return { boundaries: picked, drops };
}

// ── W2-5a Task 6: the question writer, the frozen lists, and the fidelity pilot's payloads and arithmetic ─────────────
// (W2-D72, W2-D73, W2-D64, W2-D54, W2-D55, W2-D56; D-5779, D-5776)
// The writer (W2-D72) is one spawn per candidate, in writer mode (`--tools ""`), through W2-4's contract and nothing else.
// openWriter refuses a writer model that is not an exact Opus id, admits the account from the roster (W2-D52: a gateway
// account is refused here, before any spawn), builds the limits and budget gate (W2-D55) and runs W2-D56's preflight
// against the values it is handed (step 0a's output before part 1, part 1's after). Every ask runs that preflight again
// and is a batch of one under the gate, so the soft budget overshoots by at most one run. The input is canonical
// {v: 1, kind, fact, excerpt}. The excerpt is built in order: the raw leaf redacted WHOLE (W2-D54); then windowed to
// WRITER_LEAF_WINDOW code points centred on the raw fact's first occurrence; then, for a tool_result, one line for its
// paired tool_use, redacted whole and capped at WRITER_PAIR_CAP. Its UTF-8 bytes stay within WRITER_EXCERPT_MAX_BYTES,
// the leaf window shrinking around the fact until they do. Under 'leaf-span' the base is leaf N's whole span, each leaf
// redacted whole, within the same budget (D-5779 is void then). The reply goes through the gate's parseQuestionLine and
// the question through the gate's admitFact; `writer-malformed` and `writer-leak` are never retried. Each ask's input
// bytes are pinned beside its stream, so a resume never builds on a run made from other input.
// The frozen lists (W2-D73) are exactly canonicalJson's bytes, with no trailing newline and entries sorted by qid. freeze
// writes the quiz's and pilot-source the pilot's, through writeFrozenList, which never replaces a list it finds with a
// different one. Every consumer loads a list through loadFrozenList, which checks the sha before it parses a byte.
// The fidelity pilot (spec §10.2) has three stdins per boundary through Task 1's composer: the payload, the
// empty-question run (which carries ANSWER_PROTOCOL as every composed stdin does, W2-D64, D-5776) and the user-text run.
// The original side is read from the store's rows, and the arithmetic nets each side of its own fixed overhead. The
// spawns, the tolerance and the verdict are W2-5b's. Nothing here reads the environment, opens a store or names a switch.

/** The writer's leaf window, in code points (W2-D72). */
export const WRITER_LEAF_WINDOW = 4000;
/** The paired tool_use line's cap, in code points (W2-D72). */
export const WRITER_PAIR_CAP = 2000;
/** The excerpt's whole budget, in UTF-8 bytes: W2-D72's "8 KiB in all". */
export const WRITER_EXCERPT_MAX_BYTES = 8192;
/** Where a writer run and a frozen list belong: `<out>/quiz/…` and `<out>/pilot/…` (W2-D72, W2-D73). */
export const WRITER_SECTIONS = Object.freeze(['quiz', 'pilot']);
/** Each section's frozen-list kind (W2-D73). */
export const FROZEN_LIST_KINDS = Object.freeze({ quiz: 'ccrc-history-w2-quiz', pilot: 'ccrc-history-w2-pilot' });
/** A frozen list's file name under its section. */
export const FROZEN_LIST_FILE = 'frozen.json';
/** A frozen entry's keys, sorted as canonicalJson writes them (W2-D73). */
export const FROZEN_ENTRY_KEYS = Object.freeze(['boundary_uuid', 'ccrc_id', 'fact', 'fact_raw', 'generation', 'kind', 'qid',
  'question', 'repo_roots', 'source_entry_uuid', 'store_id']);
/** The three fidelity runs per boundary, by stdin (spec §10.2's fidelity pilot; the spawns are W2-5b's). */
export const FIDELITY_RUNS = Object.freeze(['payload', 'empty', 'user-text']);
/** Task 1's composer over no summary and no kept member: the empty-question run's and the user-text run's parts. */
export const FIDELITY_EMPTY_PARTS = Object.freeze({ summary: '', kept: Object.freeze([]) });

/** @typedef {{ text: string, rawLen: number }} StoredField */
/** @typedef {{ store_id: string, ccrc_id: string, generation: string, boundary_uuid: string, kind: string, fact: string,
 *    fact_raw: string, source_entry_uuid: string, repo_roots: string[], leaf: StoredField,
 *    pair: { name: string, input: StoredField } | null, span: StoredField[] }} WriterItem */
/** @typedef {{ qid: string, store_id: string, ccrc_id: string, generation: string, boundary_uuid: string, kind: string,
 *    fact: string, fact_raw: string, question: string, source_entry_uuid: string, repo_roots: string[] }} FrozenEntry */
/** @typedef {{ code: number|null, signal: string|null, skipped: boolean, tokens: number, result: boolean }} WriterRun */
/** @typedef {{ state: 'question', qid: string, entry: FrozenEntry, run: WriterRun }
 *    | { state: 'discard', qid: string, why: 'over-decode-cap' | 'writer-input-over-cap' | 'writer-input-unrenderable' | 'writer-fact-unplaced' }
 *    | { state: 'discard', qid: string, why: 'writer-malformed' | 'writer-leak', run: WriterRun }} WriterAnswer */

/** `length` code points of `cps` from `start`, joined. */
const cpSlice = (cps, start, length) => cps.slice(start, start + length).join('');

/** The excerpt around the raw fact (W2-D72). Pure. The window holds `firstWindow` code points (never fewer than the fact
 *  has), centred on the fact's FIRST occurrence and clamped to the text's ends, then `pairLine` on its own line. While
 *  the excerpt's UTF-8 is over WRITER_EXCERPT_MAX_BYTES the window shrinks around the same centre, never below the fact;
 *  a fact that cannot fit is `writer-input-over-cap`. A fact absent from `base` is a TypeError of this pure function;
 *  writerInputOf never reaches it (it places the fact by factSpellingIn first, D-6309).
 *  @param {{ base: string, factRaw: string, firstWindow: number, pairLine: string | null }} p
 *  @returns {{ state: 'text', excerpt: string } | { state: 'discard', why: 'writer-input-over-cap' }} */
export function windowExcerpt({ base, factRaw, firstWindow, pairLine }) {
  const at = typeof factRaw === 'string' && factRaw !== '' ? base.indexOf(factRaw) : -1;
  if (at === -1) throw new TypeError('windowExcerpt: the raw fact does not occur in the redacted text it was mined from (W2-D67 discards that candidate first)');
  const cps = Array.from(base);
  const p = Array.from(base.slice(0, at)).length;
  const L = Array.from(factRaw).length;
  const tail = pairLine === null ? '' : `\n${pairLine}`;
  let w = Math.min(cps.length, Math.max(firstWindow, L));
  for (;;) {
    const start = Math.min(Math.max(0, p + Math.floor(L / 2) - Math.floor(w / 2)), cps.length - w);
    const excerpt = cpSlice(cps, start, w) + tail;
    const over = Buffer.byteLength(excerpt, 'utf8') - WRITER_EXCERPT_MAX_BYTES;
    if (over <= 0) return { state: 'text', excerpt };
    if (w === L) return { state: 'discard', why: 'writer-input-over-cap' };
    w = Math.max(L, w - Math.ceil(over / 4));   // a code point is at most 4 UTF-8 bytes: every step makes progress and keeps the fact
  }
}

/** One span row or paired tool_use input for the writer (W2-D54, D-6308): a field mined from a row carries the JSON it
 *  was rendered from (`body` for a span row, `value` for a paired input), and that is redacted as a VALUE (maskValue)
 *  and rendered again, never the serialised text; a hand-built field with neither is text, redacted whole as before. The
 *  rendering then goes through redactForSpawn too (the decode cap, and the context rules that read a JSON pair on one
 *  line). A body too deep to render again is discarded `writer-input-unrenderable`, never a throw.
 *  @param {{ text: string, rawLen: number, body?: unknown, value?: unknown }} field
 *  @param {import('../ccd/history/lib.mjs').PairIndex} idx */
function writerField(field, idx) {
  const hasBody = Object.hasOwn(field, 'body');
  if (!hasBody && !Object.hasOwn(field, 'value')) return redactForSpawn(field, idx);
  if (blobOverDecodeCap(field.rawLen)) return { state: 'discard', why: 'over-decode-cap' };
  const text = renderOrNull(() => (hasBody ? renderMasked(field.body, idx) : JSON.stringify(maskValue(field.value, idx))));
  if (text === null) return { state: 'discard', why: 'writer-input-unrenderable' };
  return redactForSpawn({ text, rawLen: field.rawLen }, idx);
}

/** Where the raw fact sits in the redacted base (D-6309): its raw spelling, else its JSON-escaped spelling (a span row is
 *  rendered as JSON, so a command with a `"`, a backslash or a control character occurs only escaped), else null. Pure.
 *  @param {string} base  @param {string} factRaw  @returns {string | null} the spelling that occurs in `base` */
export function factSpellingIn(base, factRaw) {
  if (typeof factRaw !== 'string' || factRaw === '') return null;
  if (base.includes(factRaw)) return factRaw;
  const escaped = JSON.stringify(factRaw).slice(1, -1);
  return escaped !== factRaw && base.includes(escaped) ? escaped : null;
}

/** The writer's input for one candidate (W2-D72), every field redacted whole BEFORE any window (W2-D54). Pure.
 *  @param {WriterItem} item  @param {string} writerInput 'excerpt' or 'leaf-span' (WRITER_INPUTS)
 *  @param {import('../ccd/history/lib.mjs').PairIndex} idx the run's pair index
 *  @returns {{ state: 'input', input: { v: 1, kind: string, fact: string, excerpt: string } }
 *    | { state: 'discard', why: 'over-decode-cap' | 'writer-input-over-cap' | 'writer-input-unrenderable' | 'writer-fact-unplaced' }} */
export function writerInputOf(item, writerInput, idx) {
  if (!WRITER_INPUTS.includes(writerInput)) throw new TypeError(`writerInputOf: writer_input ${JSON.stringify(writerInput)} is not one of ${WRITER_INPUTS.join(', ')}`);
  if (!FACT_KINDS.includes(item.kind)) throw new TypeError(`writerInputOf: kind ${JSON.stringify(item.kind)} is not one of ${FACT_KINDS.join(', ')}`);
  let base;
  let firstWindow;
  let pairLine = null;
  if (writerInput === 'excerpt') {
    const leaf = redactForSpawn(item.leaf, idx);
    if (leaf.state === 'discard') return { state: 'discard', why: leaf.why };
    base = leaf.text;
    firstWindow = WRITER_LEAF_WINDOW;
    if (item.pair !== null) {
      const input = writerField(item.pair.input, idx);
      if (input.state === 'discard') return { state: 'discard', why: input.why };
      // D-6308: the tool's name is stored data too (mining takes it from the block), masked as a value like its input.
      pairLine = cpSlice(Array.from(renderToolUseLine(redactFinalJson(item.pair.name, idx), input.text)), 0, WRITER_PAIR_CAP);
    }
  } else {
    const texts = [];
    for (const f of item.span) {
      const r = writerField(f, idx);
      if (r.state === 'discard') return { state: 'discard', why: r.why };
      texts.push(r.text);
    }
    base = texts.join('\n');
    firstWindow = Number.MAX_SAFE_INTEGER;
  }
  // D-6309: a fact neither spelling of which occurs is a counted drop, never windowExcerpt's TypeError after --out and spend.
  const spelled = factSpellingIn(base, item.fact_raw);
  if (spelled === null) return { state: 'discard', why: 'writer-fact-unplaced' };
  const w = windowExcerpt({ base, factRaw: spelled, firstWindow, pairLine });
  if (w.state === 'discard') return w;
  return { state: 'input', input: { v: 1, kind: item.kind, fact: item.fact, excerpt: w.excerpt } };
}

/** The writer's stdin: its prompt, a blank line, the canonical input, one newline. Input is never an argument. */
export function writerStdin(input) {
  return `${WRITER_PROMPT}\n\n${canonicalJson(input)}\n`;
}

/** W2-D73's qid: the first 16 hex of the sha256 of the canonical six-tuple. A missing field is a TypeError.
 *  @param {{ store_id: string, ccrc_id: string, generation: string, boundary_uuid: string, kind: string, fact: string }} e
 *  @returns {string} */
export function qidOf({ store_id, ccrc_id, generation, boundary_uuid, kind, fact }) {
  for (const [k, v] of Object.entries({ store_id, ccrc_id, generation, boundary_uuid, fact })) {
    if (typeof v !== 'string' || v === '') throw new TypeError(`qidOf: ${k} is a non-empty string, not ${JSON.stringify(v)}`);
  }
  if (!FACT_KINDS.includes(kind)) throw new TypeError(`qidOf: kind ${JSON.stringify(kind)} is not one of ${FACT_KINDS.join(', ')}`);
  return sha256Hex(canonicalJson([store_id, ccrc_id, generation, boundary_uuid, kind, fact])).slice(0, 16);
}

/** Pin one ask's input bytes beside its stream: written when absent, compared when present. Different bytes refuse
 *  `out-refused` (a resume never builds on a question written from other input); a path that is not a regular file
 *  refuses as every read under --out does (D-5986). */
function pinWriterInput(out, rel, text) {
  pinOutBytes(out, rel, text, 'writer-input');
}

/** Pin bytes under --out (W2-5a's writer input, W2-5b1's judge input and judge map): written when absent, compared when
 *  present. Different bytes refuse `out-refused` `<what>-changed <rel>` (a resume never builds on a run made from other
 *  input, nor reads an id as another pair); a path that is not a regular file refuses as every read under --out does
 *  (D-5986). One function, so the three pins are one spelling.
 *  @param {string} out  @param {string} rel  @param {string} text  @param {string} what */
function pinOutBytes(out, rel, text, what) {
  const read = readPlain(path.join(out, rel), OUT_JSON_CAP);
  if (read.state === 'absent') { writePlain(out, rel, text); return; }
  if (read.state === 'bad') refuse('out-refused', `${rel} ${badWord(read)}`);
  if (read.bytes.toString('utf8') !== text) refuse('out-refused', `${what}-changed ${rel}`);
}

/** W2-D72, W2-D25: the writer is the exact Opus id, never an alias, refused `args-invalid` before any spawn. Before
 *  part 1 no validator has read it yet. One function, so the sourcing subcommands can ask it before prepareOut makes
 *  --out, and a refused model leaves no --out (R10); openWriter asks it again, for every other caller.
 *  @param {unknown} model */
function refuseWriterModel(model) {
  refuseOpusModel('writer-model', model);
}

/** W2-D72, W2-D79, W2-D25: the writer and the judge are each an exact Opus id, never an alias (the gate's
 *  EXACT_MODEL_ID_RE and OPUS_MODEL_RE), refused `args-invalid` under the flag that names the role, before admission and
 *  any spawn. One function, so the writer's check and the judge's are one spelling.
 *  @param {string} flag  @param {unknown} model */
function refuseOpusModel(flag, model) {
  if (typeof model !== 'string' || !EXACT_MODEL_ID_RE.test(model) || !OPUS_MODEL_RE.test(model)) {
    refuse('args-invalid', `${flag} ${JSON.stringify(model)} is not an exact Opus model id`);
  }
}

/** Open the question writer (W2-D72) on a claimed --out. In order, before any spawn: the model (an exact Opus id, else
 *  `args-invalid`, refuseWriterModel), the roster and the account (W2-D52: `roster-invalid`, `account-refused`), the gate (W2-D55), then
 *  W2-D56's preflight: the wrapper's sha (`wrapper-unmeasured`), the gate, `--version` (a spawn that spends nothing),
 *  then `preflight` against `expected` (`claude-version-moved`, `tree-moved`, `wrapper-moved`, `code-changed` and the
 *  four unmeasured words). Each ask runs the preflight again, pins its input, and runs ONE writer-mode job through
 *  runBatch under the gate.
 *  @param {{ home: string, accountId: string, model: string, settingsMode: string, writerInput: string, claim: object,
 *    budget: number, limits: object, expected: object, allowCodeChange?: boolean, lang: string | undefined,
 *    idx: import('../ccd/history/lib.mjs').PairIndex }} o
 *  @returns {Promise<Readonly<{ launch: object, stamps: () => string[],
 *    ask: (section: string, item: WriterItem) => Promise<WriterAnswer> }>>} */
export async function openWriter(o) {
  if (o === null || typeof o !== 'object' || !Object.hasOwn(o, 'lang')) {
    throw new TypeError("openWriter: carries lang, the caller's LANG from main's env (undefined when unset)");
  }
  const { home, accountId, model, settingsMode, writerInput, claim, budget, limits, expected, lang, idx } = o;
  if (!WRITER_INPUTS.includes(writerInput)) throw new TypeError(`openWriter: writer_input ${JSON.stringify(writerInput)} is not one of ${WRITER_INPUTS.join(', ')}`);
  if (!SETTINGS_MODES.includes(settingsMode)) throw new TypeError(`openWriter: settings mode ${JSON.stringify(settingsMode)} is not one of ${SETTINGS_MODES.join(', ')}`);
  const { out } = requireClaim('openWriter', { claim }, []);
  refuseWriterModel(model);
  const { json, roster } = readRoster(home);
  const launch = admitAccount(json, roster, accountId, home);   // RP3-writer: every refusal here lands before any spawn
  const gate = batchGate({ out, home, accountId: launch.accountId, budget, limits });
  const stamps = new Set();
  const preflightNow = async () => {
    // W2-5b1 Task 4 (R26): the one spawn preflight the writer, the arms and the judge share.
    const pre = await preflightSpawn({ launch, home, out, lang, gate, expected, allowCodeChange: o.allowCodeChange === true });
    for (const s of pre.stamps) stamps.add(s);
  };
  await preflightNow();
  /** @param {string} section  @param {WriterItem} item  @returns {Promise<WriterAnswer>} */
  const ask = async (section, item) => {
    if (!WRITER_SECTIONS.includes(section)) throw new TypeError(`ask: section ${JSON.stringify(section)} is not one of ${WRITER_SECTIONS.join(', ')}`);
    const qid = qidOf(item);
    const made = writerInputOf(item, writerInput, idx);
    if (made.state === 'discard') return { state: 'discard', qid, why: made.why };
    await preflightNow();
    const dir = `${section}/writer`;
    ensurePlainDir(out, dir);
    pinWriterInput(out, `${dir}/${qid}.input.json`, `${canonicalJson(made.input)}\n`);
    const job = { launch, mode: 'writer', model, settingsMode, stdin: writerStdin(made.input), out, name: `${dir}/${qid}`, lang };
    const [done] = await runBatch([job], { concurrency: 1, gate, claim });
    const run = { code: done.code, signal: done.signal, skipped: done.skipped, tokens: done.tokens, result: done.facts.result !== null };
    // D-6305: a run that failed (a non-zero exit, a signal) or showed no result event is writer-malformed, whatever text
    // it printed: a run killed after its result event, or one that exited non-zero with a QUESTION line, never yields a question.
    if (run.code !== 0 || run.signal !== null || !run.result) return { state: 'discard', qid, why: 'writer-malformed', run };
    const parsed = parseQuestionLine(done.facts.result?.text ?? '');
    if (!parsed.ok) return { state: 'discard', qid, why: parsed.word, run };
    const leak = admitFact(item.kind, item.fact, '', parsed.question, { repoRoots: item.repo_roots });
    if (!leak.admitted) return { state: 'discard', qid, why: 'writer-leak', run };
    const entry = {
      qid, store_id: item.store_id, ccrc_id: item.ccrc_id, generation: item.generation, boundary_uuid: item.boundary_uuid,
      kind: item.kind, fact: item.fact, fact_raw: item.fact_raw, question: parsed.question,
      source_entry_uuid: item.source_entry_uuid, repo_roots: [...item.repo_roots],
    };
    return { state: 'question', qid, entry, run };
  };
  return Object.freeze({ launch, stamps: () => [...stamps].sort(), ask });
}

/** A frozen list's exact text (W2-D73): canonicalJson of the head and the entries sorted by qid, with no trailing
 *  newline. The prompt and protocol shas are the texts this driver sends. Pure. A wrong qid, a repeated one, an unknown
 *  kind, a key outside FROZEN_ENTRY_KEYS, or a writer model that is not an exact Opus id is a TypeError.
 *  @param {string} section 'quiz' or 'pilot'
 *  @param {{ writer_model: string, labeller: object }} head
 *  @param {FrozenEntry[]} entries
 *  @returns {string} */
export function frozenListText(section, head, entries) {
  if (!WRITER_SECTIONS.includes(section)) throw new TypeError(`frozenListText: section ${JSON.stringify(section)} is not one of ${WRITER_SECTIONS.join(', ')}`);
  const { writer_model, labeller } = head ?? {};
  if (typeof writer_model !== 'string' || !EXACT_MODEL_ID_RE.test(writer_model) || !OPUS_MODEL_RE.test(writer_model)) {
    throw new TypeError(`frozenListText: writer_model ${JSON.stringify(writer_model)} is not an exact Opus model id`);
  }
  if (labeller === null || typeof labeller !== 'object' || Array.isArray(labeller)) throw new TypeError('frozenListText: labeller is an object');
  if (!Array.isArray(entries)) throw new TypeError('frozenListText: entries is an array');
  const seen = new Set();
  for (const e of entries) {
    const keys = e !== null && typeof e === 'object' && !Array.isArray(e) ? Object.keys(e).sort().join(',') : '';
    if (keys !== FROZEN_ENTRY_KEYS.join(',')) throw new TypeError(`frozenListText: an entry's keys are ${keys}, not ${FROZEN_ENTRY_KEYS.join(',')}`);
    for (const k of ['fact_raw', 'question', 'source_entry_uuid']) {
      if (typeof e[k] !== 'string' || e[k] === '') throw new TypeError(`frozenListText: entry ${String(e.qid)} ${k} is a non-empty string`);
    }
    if (!Array.isArray(e.repo_roots) || !e.repo_roots.every((r) => typeof r === 'string' && r !== '')) {
      throw new TypeError(`frozenListText: entry ${String(e.qid)} repo_roots is a list of non-empty strings`);
    }
    if (e.qid !== qidOf(e)) throw new TypeError(`frozenListText: entry ${String(e.qid)} is not qidOf its own six fields`);
    if (seen.has(e.qid)) throw new TypeError(`frozenListText: qid ${e.qid} is repeated`);
    seen.add(e.qid);
  }
  const sorted = [...entries].sort((a, b) => (a.qid < b.qid ? -1 : a.qid > b.qid ? 1 : 0));
  return canonicalJson({
    kind: FROZEN_LIST_KINDS[section], version: 1, writer_model, writer_prompt_sha256: WRITER_PROMPT_SHA256,
    answer_protocol_sha256: ANSWER_PROTOCOL_SHA256, labeller, entries: sorted });
}

/** Write `<out>/<section>/frozen.json` (0600, tmp then rename, D-5986) and answer the sha256 of the bytes on disk. The
 *  same bytes again are a no-op with the same sha; a different list over one already there refuses `out-refused`: a
 *  frozen list is never replaced, and the remedy is a fresh --out.
 *  @param {string} out  @param {string} section  @param {string} text frozenListText's answer  @returns {string} */
export function writeFrozenList(out, section, text) {
  if (!WRITER_SECTIONS.includes(section)) throw new TypeError(`writeFrozenList: section ${JSON.stringify(section)} is not one of ${WRITER_SECTIONS.join(', ')}`);
  if (typeof text !== 'string' || text === '') throw new TypeError('writeFrozenList: text is frozenListText\'s answer');
  ensurePlainDir(out, section);
  const rel = `${section}/${FROZEN_LIST_FILE}`;
  const have = readPlain(path.join(out, rel), OUT_JSON_CAP);
  if (have.state === 'bad') refuse('out-refused', `${rel} ${badWord(have)}`);
  if (have.state === 'absent') writePlain(out, rel, text);
  else if (have.bytes.toString('utf8') !== text) refuse('out-refused', `${rel} holds another frozen list; a frozen list is never replaced (use a fresh --out)`);
  return shaOfPlain(out, rel);
}

/** A frozen list as a consumer reads it (W2-D73): its bytes' sha256 checked BEFORE they are parsed (`quiz-sha-mismatch`),
 *  then the bytes must be exactly the canonical list their own fields give (`input-invalid`). Read through readPlain
 *  (D-5986), so a FIFO or a link refuses and is never waited on or followed.
 *  @param {string} p  @param {string} sha256  @param {string} section  @returns {any} */
export function loadFrozenList(p, sha256, section) {
  if (!WRITER_SECTIONS.includes(section)) throw new TypeError(`loadFrozenList: section ${JSON.stringify(section)} is not one of ${WRITER_SECTIONS.join(', ')}`);
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) refuse('args-invalid', 'a frozen list sha256 is 64 lowercase hex');
  const read = readPlain(path.resolve(p), OUT_JSON_CAP);
  if (read.state === 'absent') refuse('input-invalid', 'frozen list unreadable ENOENT');
  if (read.state === 'bad') refuse('input-invalid', `frozen list ${read.why === 'unreadable' ? `unreadable ${read.code}` : read.why}`);
  const got = sha256Hex(read.bytes);
  if (got !== sha256) refuse('quiz-sha-mismatch', `${section} frozen list: expected ${sha256}, measured ${got}`);
  const text = read.bytes.toString('utf8');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    refuse('input-invalid', 'frozen list not-json');
  }
  let again;
  try {
    again = frozenListText(section, { writer_model: doc?.writer_model, labeller: doc?.labeller }, doc?.entries);
  } catch (e) {
    if (e instanceof TypeError) refuse('input-invalid', `frozen list shape: ${e.message}`);
    throw e;
  }
  if (again !== text) refuse('input-invalid', 'frozen list is not the canonical list its own fields give');
  return doc;
}

/** A stored assistant row's first-call input (spec §10.2: input + cache_creation + cache_read), or null when its usage
 *  cannot be read: an absent `input_tokens`, or any count that is not a non-negative safe integer. An absent cache count
 *  is 0. Never 0 for an unreadable row. */
export function usageInputOf(body) {
  const u = body?.message?.usage;
  if (u === null || typeof u !== 'object' || Array.isArray(u)) return null;
  const count = (v, required) => (v === undefined && !required ? 0 : Number.isSafeInteger(v) && v >= 0 ? v : null);
  const parts = [count(u.input_tokens, true), count(u.cache_creation_input_tokens, false), count(u.cache_read_input_tokens, false)];
  return parts.includes(null) ? null : parts.reduce((a, b) => a + b, 0);
}

/** A stored user row's text: a string content as it is, a block list as its text blocks joined by newlines, null when it
 *  holds none (the stream reader's own rule, sjResultText). */
export function userTextOf(body) {
  return sjResultText(body?.message?.content);
}

/** The fidelity pilot's original side, from the store's rows (each `{type, provenance, model, body, rawLen}`, in file
 *  order): the epoch's first call (the first assistant row whose model is not synthetic), the operator rows before it
 *  (their text is that call's user text), and the first non-synthetic assistant row after the summary row of N's holding
 *  copy. Every missing piece answers `unmeasured` with its own reason. Pure. */
export function originalSideOf({ epochRows, copyRows, summaryIndex }) {
  const isCall = (r) => r.type === 'assistant' && typeof r.model === 'string' && !isSyntheticModel(r.model);
  const firstAt = epochRows.findIndex(isCall);
  if (firstAt === -1) return { state: 'unmeasured', why: 'epoch-first-call-absent' };
  const firstInput = usageInputOf(epochRows[firstAt].body);
  if (firstInput === null) return { state: 'unmeasured', why: 'epoch-first-usage-absent' };
  const userRows = [];
  for (const r of epochRows.slice(0, firstAt)) {
    if (r.provenance !== 'operator') continue;
    const text = userTextOf(r.body);
    if (text !== null && text !== '') userRows.push({ text, rawLen: r.rawLen });
  }
  if (userRows.length === 0) return { state: 'unmeasured', why: 'epoch-first-user-text-absent' };
  const post = copyRows.slice(summaryIndex + 1).find(isCall);
  if (post === undefined) return { state: 'unmeasured', why: 'post-boundary-call-absent' };
  const postInput = usageInputOf(post.body);
  if (postInput === null) return { state: 'unmeasured', why: 'post-boundary-usage-absent' };
  return { state: 'measured', firstInput, postInput, userRows };
}

/** The fidelity pilot's three stdins for one boundary, all through Task 1's composer: the reconstructed payload with an
 *  empty question, which is reconstructPayload's own text, so its summary and kept members come redacted from the one
 *  reconstruction and are never handed in as raw parts (W2-D54, W2-D75); the empty-question run (no summary, no kept
 *  member); and the user-text run (the epoch's first-call operator text, redacted whole over the run's pair index, as
 *  the question). Every one carries ANSWER_PROTOCOL as item 3 (W2-D64). A user row over the decode cap is discarded
 *  (W2-D54), and a boundary reconstruction discards answers its own RECON_DISCARDS word.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId  @param {Array<{ text: string, rawLen: number }>} userRows */
export function fidelityStdins(rs, boundaryEntryId, userRows) {
  if (!Array.isArray(userRows) || userRows.length === 0) throw new TypeError("fidelityStdins: the user-text run needs originalSideOf's userRows");
  const texts = [];
  for (const r of userRows) {
    const t = redactForSpawn(r, rs.idx);
    if (t.state === 'discard') return { state: 'discard', why: t.why };
    texts.push(t.text);
  }
  const p = reconstructPayload(rs, boundaryEntryId, '');
  if (p.state !== 'payload') return p;
  return {
    state: 'stdins',
    stdins: Object.freeze({
      payload: p.text,
      empty: composePayload(FIDELITY_EMPTY_PARTS, ''),
      'user-text': composePayload(FIDELITY_EMPTY_PARTS, texts.join('\n')),
    }),
  };
}

/** The fidelity figures for one boundary (spec §10.2): each side net of its own fixed overhead. The replay side's
 *  overhead is the empty-question run's first-call input; the user text's tokens are the user-text run's less that; the
 *  original's overhead is its epoch's first-call input less those tokens. `runs` are the three runs' StreamFacts. Any
 *  piece that is missing or not positive answers `unmeasured` with its own reason, never a 0. Pure.
 *  @param {{ original: { state: string, why?: string, firstInput?: number, postInput?: number },
 *    runs: Record<string, StreamFacts> }} p */
export function fidelityFigures({ original, runs }) {
  if (original.state !== 'measured') return { state: 'unmeasured', why: original.why };
  const first = {};
  for (const k of FIDELITY_RUNS) {
    const u = runs[k]?.firstCallUsage;
    if (u === null || u === undefined) return { state: 'unmeasured', why: `${k}-first-call-absent` };
    first[k] = u.input + u.cacheCreation + u.cacheRead;
  }
  const userTextTokens = first['user-text'] - first.empty;
  if (userTextTokens <= 0) return { state: 'unmeasured', why: 'user-text-nonpositive' };
  const originalOverhead = original.firstInput - userTextTokens;
  if (originalOverhead < 0) return { state: 'unmeasured', why: 'original-overhead-negative' };
  const originalPayload = original.postInput - originalOverhead;
  if (originalPayload <= 0) return { state: 'unmeasured', why: 'original-payload-nonpositive' };
  const replayPayload = first.payload - first.empty;
  if (replayPayload <= 0) return { state: 'unmeasured', why: 'replay-payload-nonpositive' };
  return {
    state: 'measured', original_payload: originalPayload, replay_payload: replayPayload,
    original_overhead: originalOverhead, replay_overhead: first.empty, user_text_tokens: userTextTokens,
  };
}

// ── sourceQuiz: Tasks 1 to 6 composed, in W2-D71's lazy order ───────────────────────────────────────────────────
/** The epoch reads sourceQuiz adds: a transcript's session uuid, and N's epoch's cwd and cwd_real (mining's paths). */
const SOURCE_STMTS = new WeakMap();
function sourceStmts(db) {
  let s = SOURCE_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    transcript: db.prepare('SELECT cc_session_uuid FROM transcripts WHERE transcript_pk = ?'),
    epoch: db.prepare('SELECT cwd, cwd_real FROM epochs WHERE session_pk = ? AND seq = ?'),
  };
  SOURCE_STMTS.set(db, s);
  return s;
}

/** One node's sourcing run (W2-D71), Tasks 1 to 6 composed over the run's one open store (`rs`, R3):
 *  - the store's admitted boundaries (Task 3), grouped into this node's families; no family list is taken in either
 *    mode (R10);
 *  - quiz mode: every local admitted family, less every pilot family and every control-held (store_id, ccrc_id) at any
 *    generation (quizPopulation, W2-D71, W2-D77), never the census's active list, which feeds the assignment only
 *    (W2-D73; the headless arm resolves a family from its epochs, W2-D40). The families come in quizFamilyOrderKey
 *    order (the 'quiz-sample' substream seed hashed with familyKey, W2-D71 as amended 2026-10-22) and each family's
 *    candidates from its own stream (familyRng), so a question's `rank`, [order key, candidate rank], is the walk over
 *    every node's families and freeze merges the nodes in that order (R4, R10);
 *  - pilot mode: the walk is this node's families on the pilot's one stream, the fidelity boundaries first (at most
 *    one per family) and the usage questions after (W2-D71);
 *  - a family's candidates are mined from each admitted boundary's leaf span (Tasks 1, 2), deduplicated, and given
 *    their qid as `id` (W2-D73, R4);
 *  - the stages, in QUIZ_STAGES order: redaction and the producer (Task 2), admission against B (Task 4, built once per
 *    boundary, lazily), answerability (Task 5), the writer (`writer.ask`, this task's handle, R6) and the question's
 *    own admission;
 *  - per admitted question, the same-millisecond count over the CLI's family scope (Task 5), reported, never gating;
 *  - the baseline record under `<out>/<mode>/baseline.json`, every B built or discarded (Task 4).
 *  `top` is Baseline B's test seam; no subcommand passes it.
 *  @param {{ mode: 'quiz' | 'pilot', rs: ReplayStore, home: string, out: string,
 *    writer: { ask: (section: string, item: object) => Promise<WriterAnswer> }, seedHex: string,
 *    exclude: { pilotFamilies: Array<{store_id: string, ccrc_id: string, generation: string}>, assignment: Array<object> },
 *    plan: { target?: number, n_fidelity?: number, n_usage?: number, caps: { family: number, boundary: number, kind_per_family: number } },
 *    configDirs: readonly string[], shaMinPrefix: 7 | 40, top?: string }} input
 *  @returns {Promise<{ entries: Array<FrozenEntry & { rank: [string | number, number] }>, fidelity: Array<object>, counts: object,
 *    asof_same_ms_hits: Record<string, unknown> }>} */
export async function sourceQuiz({ mode, rs, home, out, writer, seedHex, exclude, plan, configDirs, shaMinPrefix, top }) {
  if (!WRITER_SECTIONS.includes(mode)) throw new TypeError(`sourceQuiz: mode ${JSON.stringify(mode)} is not one of ${WRITER_SECTIONS.join(', ')}`);
  // D-6312: the labeller's sha_min_prefix is this function's own argument, never a field of the signed plan.
  if (!SHA_MIN_PREFIXES.includes(shaMinPrefix)) throw new TypeError(`sourceQuiz: shaMinPrefix ${JSON.stringify(shaMinPrefix)} is not one of ${SHA_MIN_PREFIXES.join(', ')}`);
  const storeId = rs.storeId;
  const admission = admitStoreBoundaries(rs);
  const local = new Map();
  for (const b of admission.boundaries) {
    if (!b.admitted) continue;
    const key = familyKeyOf({ store_id: storeId, ccrc_id: b.ccrc_id, generation: b.generation });
    if (!local.has(key)) local.set(key, { store_id: storeId, ccrc_id: b.ccrc_id, generation: b.generation, boundaries: [] });
    local.get(key).boundaries.push(b);
  }
  const counts = { boundaries: admission.counts, mined: newDropCounts(), discards: {}, writer: { questions: 0, failed_runs: 0, malformed_replies: 0, leaks: 0 } };
  const discard = (why) => { counts.discards[why] = (counts.discards[why] ?? 0) + 1; };
  const byBoundary = new Map();   // boundary_uuid -> { row, spanEntryIds }
  const baselines = new Map();    // boundary_uuid -> B
  const scopes = new Map();       // family key -> transcript pks
  const memo = new Map();         // leaf_key -> redacted leaf, for the run
  const candidatesOf = (fam) => async () => {
    if (fam === undefined) return [];
    const mined = [];
    for (const b of fam.boundaries) {
      const got = mineStoredBoundary(rs, b, fam, configDirs);
      // D-6306: a boundary discarded whole is counted once, under counts.discards; its partial site drops are not merged.
      if (got.state !== 'mined') { discard(got.why); continue; }
      const m = got.mined;
      for (const [w, n] of Object.entries(m.counts)) counts.mined[w] += n;
      byBoundary.set(b.uuid, { row: b, spanEntryIds: got.spanEntryIds });
      // D-6312 (W2-D63): at a sha_min_prefix of 40 only a 40-character sha can score correct, so a shorter one is dropped
      // here, counted, before deduplication, sampling and the caps: the quotas count eligible facts only.
      const eligible = m.candidates.filter((c) => {
        if (c.kind !== 'sha' || c.fact.length >= shaMinPrefix) return true;
        noteDrop(counts.mined, 'sha-short');
        return false;
      });
      mined.push({ ...m, candidates: eligible });
    }
    return dedupeFamily(mined, counts.mined).map((c) => ({ ...c, id: qidOf(c) }));
  };
  const baselineFor = (c) => {
    if (!baselines.has(c.boundary_uuid)) {
      baselines.set(c.boundary_uuid, baselineOf(rs, byBoundary.get(c.boundary_uuid).row, { home, configDirs, budget: { bytes: 0 }, top }));
    }
    return baselines.get(c.boundary_uuid);
  };
  const keep = (c) => ({ keep: true, candidate: c });
  const drop = (reason) => ({ keep: false, reason });
  const stages = {
    redaction: async (c) => { const r = screenRedaction(c, rs.idx, memo); return r === null ? keep(c) : drop(r); },
    producer: async (c) => { const r = screenProducer(c); return r === null ? keep(c) : drop(r); },
    'admit-baseline': async (c) => {
      const b = baselineFor(c);
      if (b.state !== 'built') return drop(b.why);
      const r = screenBaseline(c, b.text);   // Task 2's one admission-against-B call (W2-D62)
      return r === null ? keep(c) : drop(r);
    },
    answerable: answerableStage(rs.db, rs.idx, (c) => {
      const b = byBoundary.get(c.boundary_uuid);
      return { tsMs: b.row.ts_ms, transcriptPk: b.row.transcript_pk, spanEntryIds: b.spanEntryIds, factRaw: c.fact_raw };
    }),
    writer: async (c) => {
      // The question's source is the one answerability found (W2-D73: the first source that passes).
      const a = await writer.ask(mode, { ...c, source_entry_uuid: c.source.entryUuid });
      const failed = a.run !== undefined && (a.run.code !== 0 || a.run.signal !== null || a.run.result === false);
      if (failed) counts.writer.failed_runs += 1;
      if (a.state === 'question' || a.why === 'writer-leak') return keep({ ...c, answer: a });
      // D-6305: a failed run is counted apart from a malformed reply, so the two counters never overlap.
      if (a.why === 'writer-malformed' && !failed) counts.writer.malformed_replies += 1;
      return drop(a.why);
    },
    'admit-question': async (c) => {
      if (c.answer.state === 'question') { counts.writer.questions += 1; return keep(c); }
      counts.writer.leaks += 1;
      return drop('writer-leak');
    },
  };
  const afterAdmit = sameMsReport(rs.db, (c) => {
    const b = byBoundary.get(c.boundary_uuid);
    const fk = familyKeyOf(c);
    if (!scopes.has(fk)) scopes.set(fk, familyScopeOf(rs.db, c));
    return { tsMs: b.row.ts_ms, holdingFileId: b.row.file_id, transcriptPks: scopes.get(fk), factRaw: c.fact_raw };
  });
  let rng;
  let candidateRng;
  let familyOrder;
  let walk;
  let fidelity = [];
  // D-6310: a legacy family (a session from before generations, generation '') has no qid (qidOf needs a generation) and no
  // place in either mode's walk, fidelity sampling included, so it is excluded here, counted, before anything is sampled.
  const all = [...local.values()];
  const own = all.filter((f) => f.generation !== '');   // this node's admitted families, each with its admitted boundaries
  const legacy = all.length - own.length;
  const walked = (f) => ({ store_id: f.store_id, ccrc_id: f.ccrc_id, generation: f.generation, admitted: f.boundaries.length, candidates: candidatesOf(f) });
  if (mode === 'quiz') {
    // W2-D71's population over this node (R10): every local admitted family less the exclusions, never a census list.
    rng = quizRng(seedHex);
    candidateRng = (f) => familyRng(seedHex, 'quiz-sample', f);
    familyOrder = (f) => quizFamilyOrderKey(seedHex, f);
    const pop = quizPopulation(own.map((f) => ({ ...f, admitted: f.boundaries.length })),
      { pilotFamilies: exclude.pilotFamilies, assignment: exclude.assignment });
    counts.population = { ...pop.excluded, legacy };
    walk = pop.families.map(walked);
  } else {
    rng = pilotRng(seedHex);
    const picked = await sampleFidelityBoundaries({
      families: own.map((f) => ({ store_id: f.store_id, ccrc_id: f.ccrc_id, generation: f.generation,
        boundaries: async () => f.boundaries.map((b) => ({ boundary_uuid: b.uuid, entry_id: b.entry_id })) })),
      rng, n: plan.n_fidelity,
      admitBoundary: async (b) => {
        const p = reconstructPayload(rs, b.entry_id, '');
        return p.state === 'payload' ? { keep: true } : { keep: false, reason: p.why };
      },
    });
    counts.population = { legacy };
    counts.fidelity = picked.drops;
    fidelity = picked.boundaries.map((p) => ({ store_id: storeId, ccrc_id: p.family.ccrc_id, generation: p.family.generation, boundary_uuid: p.boundary.boundary_uuid }));
    walk = own.map(walked);
  }
  const target = mode === 'quiz' ? plan.target : plan.n_usage;
  const sampled = await sampleQuestions({ families: walk, rng, quotas: { target, caps: plan.caps }, stages, afterAdmit, candidateRng, familyOrder });
  counts.drops = sampled.drops;
  counts.skips = sampled.skips;
  writeBaselineRecord(out, mode, { storeId, rows: [...baselines.entries()].map(([u, b]) => baselineRow(u, b)) });
  return {
    entries: sampled.questions.map((q) => ({ ...q.answer.entry, rank: q.rank })),
    fidelity, counts, asof_same_ms_hits: sampled.reports,
  };
}

// ── W2-5a Task 7: the record subcommands (W2-D84's first half, W2-D24, W2-D73, W2-D21, W2-D19, W2-D20, W2-D25; D-5773) ──
// The operator's acts before window start (W2 decisions §4 and §5, acts 9 to 19), one subcommand each:
//   pilot-source         writer spawns before part 1, under its own --budget and LIMITS_DEFAULTS, preflighted against the
//                        one step 0a output it is given (W2-D56); its own crypto seed (W2-D71); `<out>/pilot/frozen.json`
//                        and `<out>/pilot-source.json`, the values part 1's pilot section copies (W2-D73, W2-D76);
//   open --template      a skeleton of both parts from the gate's OPEN_RECORD_V1 (W2-D25);
//   open --draft         each node's step 0a output bound to its node, the overrides on default fields only, the seed
//                        (W2-D18), gate_code measured, part 1 validated and printed (W2-D25);
//   verify --registry    one node's active families against their registry generations (W2-D20, D-5773);
//   power                Q18 over every node's census and verify outputs: one q18Power call per power level at
//                        rho_headline and at 0, covered_days from lookback_days (W2-D21, amended 2026-10-20);
//   quiz-source          writer spawns after part 1, under part 1's pilot_budget, limits, account and models, preflighted
//                        against part 1; the assignment derived from the census and verify inputs (W2-D19, W2-D71, W2-D77);
//   freeze               one sourced list per named node, merged in global rank order, cut at quiz.target, written as
//                        W2-D73's exact bytes, with quiz-source's assignment_sha256 in the meta beside it;
//   open --finalize      the assignment re-derived from the same inputs (assignment-mismatch), part 2 printed (W2-D73);
//   verify --section ab  one node's control and treatment files, and the presence record's seen_ms (W2-D84).
// W2-D24: every subcommand that takes --record re-checks the four gate_code files through codeShas() (recheckCode) right
// after the record validates, before any other input is read and before any spawn. None declares --allow-code-change:
// each runs before window start, where W2-D6's remedy for a code change is a re-pilot and a superseding draft, and
// neither the record nor the frozen list has a place for a stamp.
// Every input's sha256 is checked before its bytes are parsed, and a path inside a git tree is refused (W2-D25, as
// loadStep0a does). A record is validated with the context the validator requires: --supersedes names the record it
// supersedes, --part1 a final's draft, --frozen a final's frozen list.
// The record and every report print as canonical JSON and one newline on stdout, `sha256 <hex>` of those bytes on stderr
// (open, power, verify); a subcommand that writes under --out prints only that file's sha on stderr (D-5983).
// verify reads, never writes: the registry through sweep.mjs's readRegPresence, a presence file's content as W2-D84
// says, through historyPaths, recallOffPath and store.mjs's readBounded (controlFileOf; the driver imports no
// recallOffPresence, R6), the presence directory's mtime as the newest write (the writer renames into it, W2-D28), and
// seen_ms from the store's meta through lib's recallOffStatusOf, status's own reader.
// Every subcommand that reads this node's store opens it once, through Task 1's openReplayStore, and passes it down
// (R3); the sourcing subcommands open the question writer (Task 6's openWriter, which preflights) and hand both to
// Task 6's sourceQuiz.

export const PILOT_SOURCE_KIND = 'ccrc-history-w2-pilot-source';
export const PILOT_SOURCE_FILE = 'pilot-source.json';
/** Where Task 6's writeFrozenList puts each section's list. */
export const PILOT_FROZEN_FILE = `pilot/${FROZEN_LIST_FILE}`;
export const SOURCED_KIND = 'ccrc-history-w2-quiz-sourced';
export const SOURCED_FILE = 'quiz/sourced.json';
export const FROZEN_FILE = `quiz/${FROZEN_LIST_FILE}`;
export const QUIZ_META_KIND = 'ccrc-history-w2-quiz-meta';
export const QUIZ_META_FILE = 'quiz/frozen.meta.json';
export const VERIFY_REGISTRY_KIND = 'ccrc-history-w2-verify-registry';
export const VERIFY_AB_KIND = 'ccrc-history-w2-verify-ab';
export const POWER_KIND = 'ccrc-history-w2-power';
/** The pilot's result as open --finalize reads it; W2-5b's pilot writes it. */
export const PILOT_RESULT_KIND = 'ccrc-history-w2-pilot-result';
export const TEMPLATE_KIND = 'ccrc-history-w2-open-template';
/** verify --registry's answers (W2-D20): `ok`, and the gate's three drop reasons, which its validator holds in a
 *  module-private list; a parity case holds the two equal. */
export const REGISTRY_STATES = Object.freeze(['ok', 'registry-mismatch', 'registry-absent', 'unreadable']);
/** verify --section ab's answers per family (W2-D84). */
export const AB_STATES = Object.freeze(['ok', 'control-absent', 'control-mismatch', 'treatment-named', 'unreadable']);
/** The operator's Q18 decision (W2 decisions §5 act 12): keep the window, lengthen it, or name more nodes. */
export const Q18_DECISIONS = Object.freeze(['keep', 'lengthen', 'add-nodes']);
/** Which q18Power call each of part 2's q18 figures reads (W2-D21, D-5791). The gate's own Q18_FIGURE_POWER is
 *  module-private, so the two levels are spelled here once more, held equal to it by a parity case. */
export const Q18_FIGURES = Object.freeze({
  headline: Object.freeze({ power: 0.5, rho: 'headline' }),
  at_power_80: Object.freeze({ power: 0.8, rho: 'headline' }),
  at_rho_0: Object.freeze({ power: 0.5, rho: 'zero' }),
});
/** active_rule.text's default: W2-D20's rule in words (the schema gives the field no value). */
export const ACTIVE_RULE_TEXT = 'W2-D20: a family (store_id, ccrc_id, generation) is active iff its merged_into is null and its generation '
  + 'is a UUID, it is its id\'s newest unmerged family (first_seen_ms DESC, then session_pk DESC), and a main transcript of one '
  + 'of its confirmed epochs has an entry with ts_ms in [T0 - lookback_ms, T0), T0 being its node\'s census instant; a legacy '
  + 'family (an empty generation) is excluded, fixed (D-5773)';

const DRAFT_SPEC = OPEN_RECORD_V1.draft;
const Q18_DAY_MS = 86_400_000;
const INPUT_WORDS = Object.freeze({ sha: 'input-sha-mismatch', invalid: 'input-invalid' });
const RECORD_WORDS = Object.freeze({ sha: 'record-sha-mismatch', invalid: 'record-invalid' });
/** Part 1 fields that come from the pilot-source output (the validator ties them to what the pilot used, W2-D71): an
 *  override naming one is refused. rubric_sha256 is refused too: it follows rubric_id (buildDraft). */
const PILOT_DERIVED = Object.freeze(['labeller.sha_min_prefix', 'quiz.writer_input', 'quiz.baseline_files', 'pilot.n_fidelity', 'pilot.n_usage']);
const DRAFT_INPUT = Object.freeze(['record', 'record-sha256']);
const PRED_INPUT = Object.freeze(['supersedes', 'supersedes-sha256']);
const NODE_INPUTS = Object.freeze(['census', 'census-sha256', 'verify', 'verify-sha256']);
/** Each subcommand form's flags: a flag outside both lists is refused, a required one missing is refused. */
const SUBCOMMAND_FLAGS = Object.freeze({
  'pilot-source': { required: ['out', 'account', 'budget', 'writer-model', 'step0a', 'step0a-sha256'], optional: ['sha-min-prefix', 'writer-input', 'n-fidelity', 'n-usage'] },
  'quiz-source': { required: ['out', ...DRAFT_INPUT, ...NODE_INPUTS], optional: [...PRED_INPUT] },
  freeze: { required: ['out', ...DRAFT_INPUT, 'sourced', 'sourced-sha256'], optional: [...PRED_INPUT] },
  power: { required: [...DRAFT_INPUT, ...NODE_INPUTS], optional: [...PRED_INPUT] },
  'open --template': { required: ['template'], optional: [] },
  'open --draft': { required: ['draft', 'step0a', 'step0a-sha256', 'node-label', 'node-store-id', 'pilot', 'pilot-sha256', 'account', 'arm-model', 'writer-model', 'judge-model'],
    optional: ['overrides', ...PRED_INPUT] },
  'open --finalize': { required: ['finalize', ...DRAFT_INPUT, ...NODE_INPUTS, 'power', 'power-sha256', 'frozen', 'frozen-sha256', 'quiz-meta', 'quiz-meta-sha256',
    'pilot-result', 'pilot-result-sha256', 'spend-budget', 'window-start', 'window-end', 'q18-decision'], optional: [...PRED_INPUT, 'prior-final', 'prior-final-sha256'] },
  'verify --registry': { required: ['registry', ...DRAFT_INPUT, 'census', 'census-sha256'], optional: [...PRED_INPUT] },
  'verify --section ab': { required: ['section', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT] },
  // W2-5b1 Task 3 (W2-D84): marker prints one node (--node-label, once); pilot reads part 1, quiz and ab read part 2.
  'marker --section pilot': { required: ['section', ...DRAFT_INPUT, 'node-label'], optional: [...PRED_INPUT] },
  'marker --section quiz': { required: ['section', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256', 'node-label'], optional: [...PRED_INPUT] },
  'marker --section ab': { required: ['section', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256', 'node-label'], optional: [...PRED_INPUT] },
  'verify --section pilot': { required: ['section', ...DRAFT_INPUT], optional: [...PRED_INPUT] },
  'verify --section quiz': { required: ['section', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT] },
  // W2-5b1 Task 4 (Q2, Q23): the pilot form reads part 1 and the pilot frozen list and takes no --allow-code-change (a
  // pilot act's remedy for a code change is a re-pilot, W2-D6); the quiz form reads part 2 with its part 1 and frozen list.
  'arms --section pilot': { required: ['section', 'out', ...DRAFT_INPUT, 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT] },
  'arms --section quiz': { required: ['section', 'out', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT, 'allow-code-change'] },
  // W2-5b1 Task 5 (Q2, Q23): the judge reads exactly what arms reads (Task 4's loadArmRun), and no flag of its own.
  'judge --section pilot': { required: ['section', 'out', ...DRAFT_INPUT, 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT] },
  'judge --section quiz': { required: ['section', 'out', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT, 'allow-code-change'] },
});

const copyJson = (v) => JSON.parse(JSON.stringify(v));
/** Families in familyKey order, by code unit: Task 5's familyKeyOf and cmpUnit, never a second key helper (W2-D12, R3).
 *  Seeds come from Task 5's drawSeedHex and the halt floor from Task 5's quizFloor, never a copy here. */
const byFamilyKey = (a, b) => cmpUnit(familyKeyOf(a), familyKeyOf(b));

/** Unknown flags first, then required ones, then each sha flag given with its file flag and only with it. */
function checkFlags(form, flags) {
  const spec = SUBCOMMAND_FLAGS[form];
  const known = new Set([...spec.required, ...spec.optional]);
  for (const k of Object.keys(flags)) if (!known.has(k)) refuse('args-invalid', `--${k} is not a ${form} flag`);
  for (const k of spec.required) if (flags[k] === undefined) refuse('args-invalid', `${k}-required`);
  for (const k of known) {
    if (!k.endsWith('-sha256')) continue;
    const file = k.slice(0, -'-sha256'.length);
    if ((flags[k] === undefined) !== (flags[file] === undefined)) refuse('args-invalid', `--${file} and --${k} go together`);
  }
}

/** `--<name>` and `--<name>-sha256`, paired by position. */
function pairedInputs(flags, name) {
  const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const paths = asList(flags[name]);
  const shas = asList(flags[`${name}-sha256`]);
  if (paths.length !== shas.length) refuse('args-invalid', `--${name} given ${paths.length} times, --${name}-sha256 ${shas.length}`);
  return paths.map((p, i) => [p, shas[i]]);
}

/** One JSON input: outside any git tree, its bytes' sha256 checked BEFORE they are parsed (W2-D25, W2-D59), as loadStep0a
 *  checks step 0a's. `words` names the two refusals (a record's, a frozen list's or any other input's).
 *  @param {string} label  @param {string} p  @param {string} sha256
 *  @returns {{path: string, sha256: string, value: any}} */
export function loadInput(label, p, sha256, words = INPUT_WORDS, cap = OUT_JSON_CAP) {
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) refuse('args-invalid', `--${label}-sha256 is not 64 lowercase hex`);
  if (typeof p !== 'string' || p === '') refuse('args-invalid', `--${label} names no path`);
  const abs = path.resolve(p);
  const g = insideGitTree(path.dirname(abs));
  if (g.state === 'inside') refuse(words.invalid, `${label} in-git-tree ${g.at}`);
  if (g.state === 'unmeasured') refuse(words.invalid, `${label} git-unmeasured ${g.at} ${g.code}`);
  const read = readPlain(abs, cap);
  if (read.state === 'absent') refuse(words.invalid, `${label} unreadable ENOENT`);
  if (read.state === 'bad') refuse(words.invalid, read.why === 'unreadable' ? `${label} unreadable ${read.code}` : `${label} ${read.why}`);
  const got = sha256Hex(read.bytes);
  if (got !== sha256) refuse(words.sha, `${label}: expected ${sha256}, measured ${got}`);
  let value;
  try {
    value = JSON.parse(read.bytes.toString('utf8'));
  } catch {
    refuse(words.invalid, `${label} not-json`);
  }
  return { path: abs, sha256: got, value };
}
/** Every `--<name>` input, in argv order. A census can be large (raw rows over every family), so it reads to OUT_STREAM_CAP. */
function loadInputs(flags, name, cap = OUT_JSON_CAP) {
  return pairedInputs(flags, name).map(([p, h]) => loadInput(name, p, h, INPUT_WORDS, cap));
}

/** A frozen list (the quiz's by default; W2-5b1 Task 4 reads the pilot's) (W2-D73) through Task 6's one reader, loadFrozenList (its sha checked before a byte is parsed,
 *  quiz-sha-mismatch; its bytes the canonical list their own fields give, input-invalid), after loadInput's git-tree
 *  rule (W2-D25); and its families. */
function loadFrozen(p, sha256, section = 'quiz') {
  if (typeof p !== 'string' || p === '') refuse('args-invalid', '--frozen names no path');
  const g = insideGitTree(path.dirname(path.resolve(p)));
  if (g.state === 'inside') refuse('input-invalid', `frozen in-git-tree ${g.at}`);
  if (g.state === 'unmeasured') refuse('input-invalid', `frozen git-unmeasured ${g.at} ${g.code}`);
  const list = loadFrozenList(p, sha256, section);
  return { sha256, list, families: familiesOf(list.entries) };
}

/** `--record` as `part`, validated with the context the validator requires (W2-D25, amended 2026-10-19): a draft that
 *  supersedes another is read only beside it (--supersedes); a final beside its draft (--part1) and its frozen list
 *  (--frozen, whose sha must be the record's quiz.sha256) and, when it supersedes a final, that final (--supersedes). */
function loadRecordInput(flags, part) {
  const rec = loadInput('record', flags.record, flags['record-sha256'], RECORD_WORDS);
  const r = rec.value;
  if (!plainObject(r) || r.part !== part) refuse('record-invalid', `record part ${JSON.stringify(r?.part)}, wanted ${part}`);
  const pred = flags.supersedes === undefined ? null : loadInput('supersedes', flags.supersedes, flags['supersedes-sha256'], RECORD_WORDS).value;
  let draft = null;
  let frozen = null;
  let fz = null;
  if (part === 'final') {
    if (flags.part1 === undefined) refuse('args-invalid', 'part1-required');
    draft = loadInput('part1', flags.part1, flags['part1-sha256'], RECORD_WORDS).value;
    fz = loadFrozen(flags.frozen, flags['frozen-sha256']);
    const want = plainObject(r.quiz) ? r.quiz.sha256 : undefined;
    if (fz.sha256 !== want) refuse('quiz-sha-mismatch', `frozen ${fz.sha256} is not the record's quiz.sha256 ${want}`);
    frozen = { families: fz.families, n_questions: fz.list.entries.length };
  } else if (r.supersedes !== null && pred === null) {
    refuse('args-invalid', 'supersedes-required: the record supersedes a draft; pass it as --supersedes');
  }
  const v = validateOpenRecord(r, { draft, predecessor: pred, frozen });
  if (!v.ok) refuse('record-invalid', v.errors.map((e) => `${e.path} ${e.word}`).join('; '));
  return { record: r, sha256: rec.sha256, frozen: fz };
}

/** W2-D24's re-check as a verdict, pure: `shas` (codeShas' answer) against the record's gate_code. An unmeasured file, on
 *  either side, is `code-unmeasured` whatever the flag says (W2-D24 as amended); a measured change is `code-changed`, or,
 *  with `allowCodeChange`, the stamp `code-changed` (W2-D24's one exception). The flag is taken at or after the record's
 *  `window.start_ms` only (Q23): before it, W2-D6's remedy for a code change is a re-pilot and a superseding part 2, so the
 *  flag is `args-invalid` there whether or not the code moved, and on a record with no window (a part 1) always. A caller
 *  that passes the flag passes its clock (`nowMs`, a safe integer; anything else is a TypeError).
 *  @param {{gate_code: unknown, window?: unknown}} record
 *  @param {{state: 'measured', files: Record<string, string>} | {state: 'unmeasured', path: string, cause: string}} shas
 *  @param {{allowCodeChange?: boolean, nowMs?: number | null}} [opts]
 *  @returns {{ok: true, stamps: string[]} | {ok: false, word: string, detail: string}} */
export function codeRecheckVerdict(record, shas, { allowCodeChange = false, nowMs = null } = {}) {
  if (allowCodeChange) {
    const start = plainObject(record.window) ? record.window.start_ms : undefined;
    if (!Number.isSafeInteger(start)) {
      return { ok: false, word: 'args-invalid', detail: '--allow-code-change is taken only by a part 2 consumer, after window start (W2-D6, W2-D24)' };
    }
    if (!Number.isSafeInteger(nowMs)) throw new TypeError(`codeRecheckVerdict: nowMs ${String(nowMs)} is not a clock reading`);
    if (nowMs < start) {
      return { ok: false, word: 'args-invalid', detail: `--allow-code-change before window start ${start}: before it a code change is a re-pilot and a superseding part 2 (W2-D6, W2-D24)` };
    }
  }
  if (shas.state !== 'measured') return { ok: false, word: 'code-unmeasured', detail: `${shas.path} is ${shas.cause}` };
  const c = checkGateCode(record.gate_code, shas.files);
  if (c.ok) return { ok: true, stamps: [] };
  if (c.word === 'code-unmeasured') return { ok: false, word: 'code-unmeasured', detail: `gate_code lacks ${c.unmeasured.join(' ')}` };
  if (allowCodeChange) return { ok: true, stamps: ['code-changed'] };
  return { ok: false, word: 'code-changed', detail: `changed ${c.mismatched.join(' ')}` };
}

/** W2-D24: the four gate_code files' installed bytes, measured now through codeShas(), against the record's gate_code,
 *  refusing on codeRecheckVerdict's refusal and answering its stamps. W2-5a's consumers pass no opts (no flag before
 *  window start, W2-D6); W2-5b's part 2 consumers reach it through loadFinalRecord. */
export function recheckCode(record, root = TREE_ROOT, opts = {}) {
  const v = codeRecheckVerdict(record, codeShas(root), opts);
  if (!v.ok) refuse(v.word, v.detail);
  return v.stamps;
}

function subcommandHome(env) {
  if (typeof env.HOME !== 'string' || !path.isAbsolute(env.HOME)) refuse('args-invalid', 'HOME is unset or not absolute');
  return path.resolve(env.HOME);
}
/** This node's store id, through Task 1's one store opener (openReplayStore, W2-D51, R3), closed at once: a store that
 *  cannot be opened refuses store-unreadable with the store's own word, so an absent store is never an unreadable one. */
function nodeStoreId(home) {
  const rs = openReplayStore(home);
  try {
    return rs.storeId;
  } finally {
    rs.close();
  }
}
/** W2-D84: a subcommand reading this node refuses unless its store is one of the record's nodes. */
function requireNamedNode(record, storeId) {
  if (!record.nodes.some((n) => n.store_id === storeId)) refuse('input-invalid', `store ${storeId} is not one of the record's nodes`);
}
/** A sourced entry as the frozen list takes it: its eleven W2-D73 fields, its rank left behind. */
const frozenEntryOf = (e) => Object.fromEntries(FROZEN_ENTRY_KEYS.map((k) => [k, e[k]]));
/** The pilot's caps: part 1's quiz caps as the open record's defaults give them (the pilot runs before part 1; W2-D71). */
const pilotCaps = () => Object.fromEntries(['family', 'boundary', 'kind_per_family'].map((k) => [k, DRAFT_SPEC.quiz.fields.caps.fields[k].value]));
/** One warning line when any writer run failed (R6): a non-zero exit, a signal or no result event. Each such run's
 *  candidate is counted writer-malformed, so a failing account would otherwise drain the population quietly. */
function warnFailedRuns(counts) {
  const n = counts?.writer?.failed_runs ?? 0;
  if (n > 0) process.stderr.write(`ccrc history-replay: warning: ${n} writer run(s) failed (a non-zero exit, a signal or no result event); each is counted writer-malformed\n`);
}
/** One control file's content, read as W2-D84 says: through historyPaths' recallOffPath and store.mjs's readBounded at
 *  CONTROL_FILE_MAX, never following a link. Three answers, never folded: value, absent, unreadable (over-cap included,
 *  as sweep.mjs's reader folds it). The driver imports no recallOffPresence (R6), and this reads, never writes, so
 *  O13's one-writer pin holds. W2-D84 requires the content; W2-D29's "the driver does not read content" is the
 *  presence check's (W2-D78(ii)), still W2-4's one lstat line (R10).
 *  @param {string} home  @param {string} id */
function controlFileOf(home, id) {
  const r = readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false);
  return r.state === 'value' ? { state: 'value', value: r.value } : r.state === 'absent' ? { state: 'absent' } : { state: 'unreadable' };
}

/** Canonical JSON and one newline on stdout, `sha256 <hex>` of exactly those bytes on stderr. For a record that is
 *  recordSha256 (W2-D25). */
function printWithSha(value) {
  const text = canonicalJson(value) + '\n';
  process.stdout.write(text);
  process.stderr.write(`sha256 ${sha256Hex(text)}\n`);
  return EXIT.OK;
}

// ── the contract's flags, the frozen list and its merge ─────────────────────────────────────────────────────
/** Every flag token of every spawn mode's argv under `settingsMode`: the set step 0a's `flags_accepted` must name
 *  exactly (W2-D25 amended 2026-10-20, section 7). The model and home are placeholders; neither is a flag.
 *  @param {string} settingsMode  @returns {string[]} */
export function contractFlags(settingsMode) {
  const flags = new Set();
  for (const mode of SPAWN_MODES) {
    for (const t of spawnArgv({ mode, model: 'contract-model', settingsMode, home: '/contract-home' })) if (t.startsWith('-')) flags.add(t);
  }
  return [...flags].sort();
}

/** The families a list of entries or boundaries names, each once, sorted by familyKey. Pure. */
export function familiesOf(items) {
  const seen = new Map();
  for (const e of items) {
    const f = { store_id: e.store_id, ccrc_id: e.ccrc_id, generation: e.generation };
    seen.set(familyKeyOf(f), f);
  }
  return [...seen.values()].sort(byFamilyKey);
}

/** Every node's sourced entries in global rank order (W2-D71 as amended 2026-10-22: families by their
 *  quizFamilyOrderKey, by code unit, then candidates by their rank in the family's own stream; R10), cut at the target.
 *  Each node walked that order over its own families and stopped at the target, so the merged walk is the one a node
 *  holding every store would make. Two entries with one rank refuse. */
export function mergeSourced(lists, target) {
  const byRank = (a, b) => cmpUnit(a.rank[0], b.rank[0]) || a.rank[1] - b.rank[1];
  const all = lists.flat().sort(byRank);
  for (let i = 1; i < all.length; i += 1) {
    if (byRank(all[i - 1], all[i]) === 0) refuse('input-invalid', `sourced rank-duplicate ${all[i].rank.join(':')}`);
  }
  return all.slice(0, target);
}

// ── the census assembler (checks nodes only), the assignment, and Q18 ────────────────────────────────────────
function censusError(o) {
  if (!plainObject(o)) return 'not-object';
  if (typeof o.store_id !== 'string' || !UUID_RE.test(o.store_id)) return 'store_id';
  if (!plainObject(o.counters)) return 'counters';
  const c = o.census;
  if (!plainObject(c)) return 'census';
  for (const k of ['as_of_ms', 'since_ms', 'row_cap']) if (!Number.isSafeInteger(c[k])) return `census.${k}`;
  if (!plainObject(c.ticks) || !Number.isSafeInteger(c.ticks.n) || c.ticks.n < 0) return 'census.ticks';
  for (const k of ['first_ts_ms', 'last_ts_ms']) if (c.ticks[k] !== null && !Number.isSafeInteger(c.ticks[k])) return `census.ticks.${k}`;
  if (!Array.isArray(c.families)) return 'census.families';
  return null;
}
function verifyError(o) {
  if (!plainObject(o) || o.kind !== VERIFY_REGISTRY_KIND || o.v !== 1) return 'kind';
  if (typeof o.store_id !== 'string') return 'store_id';
  if (typeof o.census_sha256 !== 'string' || !SHA256_RE.test(o.census_sha256)) return 'census_sha256';
  if (!Number.isSafeInteger(o.lookback_ms)) return 'lookback_ms';
  if (!Array.isArray(o.families) || !o.families.every((f) => plainObject(f) && typeof f.ccrc_id === 'string'
    && typeof f.generation === 'string' && REGISTRY_STATES.includes(f.state))) return 'families';
  return null;
}

/** The census assembler W2-D21 names, which checks NODES only: each census names a node's store, once, and every node
 *  has one; each verify output names a census by its sha, the record's look-back and exactly that census's active list
 *  (W2-D20). No window, row cap or script sha is checked here (assembleReports does that, after the window). Answers
 *  every node with its census and states, the active list, the registry drops and the families kept (W2-D20: drops
 *  removed before Q18 and before the flip). */
export function assembleCensus(record, censusIn, verifyIn) {
  const labels = new Map(record.nodes.map((n) => [n.store_id, n.label]));
  const nodes = new Map();
  for (const c of censusIn) {
    const bad = censusError(c.value);
    if (bad !== null) refuse('input-invalid', `census shape ${bad}`);
    const sid = c.value.store_id;
    if (!labels.has(sid)) refuse('input-invalid', `census store-id-unlisted ${sid}`);
    if (nodes.has(sid)) refuse('input-invalid', `census store-id-duplicate ${sid}`);
    let act;
    try {
      act = activeFamilies(sid, c.value.census, { lookbackMs: record.active_rule.lookback_ms });
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      refuse('input-invalid', `census ${sid} ${e.message}`);
    }
    nodes.set(sid, { store_id: sid, label: labels.get(sid), census_sha256: c.sha256, report: c.value, active: act.active, verify_sha256: null, states: null });
  }
  for (const [sid, label] of labels) if (!nodes.has(sid)) refuse('input-invalid', `census node-missing ${label}`);
  for (const v of verifyIn) {
    const bad = verifyError(v.value);
    if (bad !== null) refuse('input-invalid', `verify shape ${bad}`);
    const node = nodes.get(v.value.store_id);
    if (node === undefined) refuse('input-invalid', `verify store-id-unlisted ${v.value.store_id}`);
    if (node.states !== null) refuse('input-invalid', `verify store-id-duplicate ${node.store_id}`);
    if (v.value.census_sha256 !== node.census_sha256) refuse('input-invalid', `verify census-mismatch ${node.store_id}`);
    if (v.value.lookback_ms !== record.active_rule.lookback_ms) refuse('input-invalid', `verify lookback-mismatch ${node.store_id}`);
    const want = node.active.map(familyKeyOf).join('\n');
    const got = v.value.families.map((f) => familyKey(node.store_id, f.ccrc_id, f.generation)).join('\n');
    if (got !== want) refuse('input-invalid', `verify families-mismatch ${node.store_id}`);
    node.verify_sha256 = v.sha256;
    node.states = v.value.families;
  }
  for (const node of nodes.values()) if (node.states === null) refuse('input-invalid', `verify node-missing ${node.label}`);
  const list = [...nodes.values()].sort((a, b) => (a.store_id < b.store_id ? -1 : a.store_id > b.store_id ? 1 : 0));
  const active = list.flatMap((n) => n.active).sort(byFamilyKey);
  const drops = list.flatMap((n) => n.states.filter((s) => s.state !== 'ok')
    .map((s) => ({ store_id: n.store_id, ccrc_id: s.ccrc_id, generation: s.generation, reason: s.state }))).sort(byFamilyKey);
  const dropped = new Set(drops.map(familyKeyOf));
  return { nodes: list, active, drops, kept: active.filter((f) => !dropped.has(familyKeyOf(f))) };
}

/** W2-D19's assignment over the kept families, and its sha. */
export function deriveAssignment(seedHex, assembled) {
  const list = assignArms(seedHex, assembled.kept);
  return { list, sha256: assignmentSha256(list) };
}

/** W2-D21's covered_days: the look-back clipped to the node's tick coverage, in days; null with no tick in it. Pure. */
export function coveredDays(census, lookbackDays) {
  const t = census.ticks;
  if (t.n === 0 || t.first_ts_ms === null) return null;
  const from = Math.max(census.since_ms, t.first_ts_ms);
  const days = (census.as_of_ms - from) / Q18_DAY_MS;
  return days > 0 ? Math.min(lookbackDays, days) : null;
}

/** rho_hat (W2-D21, reported beside the figures): the one-way ANOVA estimate of the intra-cluster correlation of "a
 *  window holds a read call", over families with at least one window. Unclipped; null with fewer than two such families,
 *  no within-family degree of freedom, or a zero denominator. Pure. */
export function rhoHat(clusters) {
  const cs = clusters.filter((c) => c.windows > 0);
  const m = cs.length;
  const n = cs.reduce((s, c) => s + c.windows, 0);
  if (m < 2 || n - m < 1) return null;
  const pbar = cs.reduce((s, c) => s + c.with_call, 0) / n;
  const ssb = cs.reduce((s, c) => s + c.windows * (c.with_call / c.windows - pbar) ** 2, 0);
  const ssw = cs.reduce((s, c) => s + c.with_call - (c.with_call * c.with_call) / c.windows, 0);
  const msb = ssb / (m - 1);
  const msw = ssw / (n - m);
  const n0 = (n - cs.reduce((s, c) => s + c.windows * c.windows, 0) / n) / (m - 1);
  const den = msb + (n0 - 1) * msw;
  return den === 0 ? null : (msb - msw) / den;
}

/** The power output (W2-D21, amended 2026-10-20 after W2-3's review 664, F3 and F8): q18_settings read from the
 *  record; one q18Power call per power level with rho = rho_headline and with rho = 0; covered_days from lookback_days;
 *  the population the flip uses (the kept families). It holds no clock reading, so the same inputs print the same bytes. */
export function powerReport(record, recordSha256, assembled) {
  const s = record.q18_settings;
  const plannedDays = record.window_plan.planned_days;
  const lookbackMs = s.lookback_days * Q18_DAY_MS;
  const kept = new Set(assembled.kept.map(familyKeyOf));
  const coverage = {};
  const perNode = {};
  const consumed = {};
  const fams = [];
  for (const node of assembled.nodes) {
    const c = node.report.census;
    if (c.as_of_ms - c.since_ms !== lookbackMs) {
      refuse('input-invalid', `census ${node.store_id} since-mismatch: as_of - since is ${c.as_of_ms - c.since_ms} ms, lookback_days is ${s.lookback_days}`);
    }
    const covered = coveredDays(c, s.lookback_days);
    if (covered === null) refuse('input-invalid', `census ${node.store_id} no-tick-coverage`);
    coverage[node.store_id] = { covered_days: covered, ticks: copyJson(c.ticks) };
    const per = { windows: 0, with_call: 0 };
    for (const row of c.families) {
      const key = familyKey(node.store_id, row.ccrc_id, row.generation);
      if (!kept.has(key)) continue;
      // A census row is a family the store holds: buildWindows reads it as a family report once `found` says so.
      const t = windowTotals(buildWindows({ ccrc_id: row.ccrc_id, generation: row.generation, found: true,
        merged_generations: row.merged_generations, calls: row.calls, boundaries: row.boundaries }));
      fams.push({ key, store_id: node.store_id, windows: t.windows, with_call: t.with_call, covered_days: covered });
      per.windows += t.windows;
      per.with_call += t.with_call;
    }
    perNode[node.store_id] = per;
    const n = node.report.counters['card_consumed:main'];
    consumed[node.store_id] = Number.isSafeInteger(n) ? n : 0;
  }
  fams.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const q18In = fams.map(({ key, windows, covered_days }) => ({ key, windows, covered_days }));
  const figures = [];
  for (const power of s.power) {
    for (const rho of [s.rho_headline, 0]) {
      const q = q18Power({ families: q18In, plannedDays, seedHex: record.bootstrap.seed, rho, power, sims: s.sims, gridStep: s.grid_step, B: record.bootstrap.B });
      figures.push({ power, rho, figure: q.figure, points: q.points });
    }
  }
  const figureOf = (f) => figures.find((x) => x.power === f.power && x.rho === (f.rho === 'zero' ? 0 : s.rho_headline))?.figure ?? null;
  const total = Object.values(perNode).reduce((t, p) => ({ windows: t.windows + p.windows, with_call: t.with_call + p.with_call }), { windows: 0, with_call: 0 });
  // §4's q18 carries n_f per family and per node: a node's n_f is the sum over its kept families.
  const expected = expectedWindows(q18In, plannedDays);
  const storeOfKey = new Map(fams.map((f) => [f.key, f.store_id]));
  const nfPerNode = Object.fromEntries(assembled.nodes.map((n) => [n.store_id, 0]));
  for (const x of expected) nfPerNode[storeOfKey.get(x.key)] += x.n;
  return {
    kind: POWER_KIND, v: 1, record_sha256: recordSha256,
    inputs: assembled.nodes.map((n) => ({ store_id: n.store_id, census_sha256: n.census_sha256, verify_sha256: n.verify_sha256 })),
    q18_settings: copyJson(s), planned_days: plannedDays, population: fams.length, registry_drops: assembled.drops.length, figures,
    headline: figureOf(Q18_FIGURES.headline), at_power_80: figureOf(Q18_FIGURES.at_power_80), at_rho_0: figureOf(Q18_FIGURES.at_rho_0),
    rho_hat: rhoHat(fams),
    n_f: { per_family: Object.fromEntries(expected.map((x) => [x.key, x.n])), per_node: nfPerNode },
    coverage,
    pre_window_uptake: { per_node: perNode, total, card_consumed_main_all_time: consumed },
  };
}

// ── the reports the subcommands write, as pure builders ───────────────────────────────────────────────────
/** A registry read against the census generation (W2-D20): four answers, never folded. Pure. */
export function registryStateOf(read, generation) {
  if (read.state === 'absent') return 'registry-absent';
  if (read.state !== 'value') return 'unreadable';
  return read.value === generation ? 'ok' : 'registry-mismatch';
}
export function verifyRegistryReport({ recordSha256, storeId, censusSha256, lookbackMs, families }) {
  const counts = Object.fromEntries(REGISTRY_STATES.map((s) => [s, families.filter((f) => f.state === s).length]));
  return { kind: VERIFY_REGISTRY_KIND, v: 1, record_sha256: recordSha256, store_id: storeId, census_sha256: censusSha256,
    lookback_ms: lookbackMs, families, counts };
}
/** One assigned family's presence file against its arm (W2-D84). A control file must hold its generation (trimmed, as
 *  decideRecallOff trims); a treatment file must not name its own (another generation is not this family's). Unreadable
 *  is its own answer, never absent. Pure. */
export function abStateOf(arm, generation, read) {
  if (read.state === 'unreadable') return 'unreadable';
  if (arm === CONTROL_ARM) {
    if (read.state === 'absent') return 'control-absent';
    return read.value.trim() === generation ? 'ok' : 'control-mismatch';
  }
  if (read.state === 'absent') return 'ok';
  return read.value.trim() === generation ? 'treatment-named' : 'ok';
}
export function verifyAbReport({ recordSha256, storeId, families, newest, seen }) {
  const seenAfter = seen !== null && (newest.state === 'absent' || (newest.state === 'value' && seen > newest.ms));
  const counts = Object.fromEntries(AB_STATES.map((s) => [s, families.filter((f) => f.state === s).length]));
  return { kind: VERIFY_AB_KIND, v: 1, record_sha256: recordSha256, store_id: storeId, families, counts,
    newest_write: newest, seen_ms: seen, seen_after_write: seenAfter, ok: seenAfter && families.every((f) => f.state === 'ok') };
}
export function sourcedReport({ recordSha256, storeId, assignmentSha256, inputs, sourced, spend }) {
  return { kind: SOURCED_KIND, v: 1, record_sha256: recordSha256, store_id: storeId, assignment_sha256: assignmentSha256,
    inputs, entries: sourced.entries, counts: sourced.counts, asof_same_ms_hits: sourced.asof_same_ms_hits ?? {}, spend };
}
/** The meta beside the frozen list: quiz-source's assignment_sha256 (W2-D73), the counts, the floor verdict (W2-D71),
 *  and whether the list names fewer families than the record's quiz.min_families (`minFamilies`, the signed default 20,
 *  W2-D71's "at least 20 families"). That flag is a report, never a refusal (R11): the halt floor stays the only
 *  family-count stop, and nothing reads the flag to decide. */
export function quizMetaReport({ recordSha256, frozenSha256, assignmentSha256, entries, floor, minFamilies, sourced }) {
  const families = familiesOf(entries);
  return { kind: QUIZ_META_KIND, v: 1, record_sha256: recordSha256, frozen_sha256: frozenSha256, assignment_sha256: assignmentSha256,
    n_questions: entries.length, n_families: families.length,
    below_floor: quizFloor(entries.length, families.length, floor).halt,
    short_of_min_families: families.length < minFamilies,
    // Sorted by store_id (code unit), so the meta's bytes do not depend on the order the sourced lists were named in.
    sourced: [...sourced].sort((a, b) => cmpUnit(a.store_id, b.store_id)) };
}

// ── the record: template, draft and final ──────────────────────────────────────────────────────────────────
function skeletonField(f) {
  if (Object.hasOwn(f, 'value')) return copyJson(f.value);
  if (f.fields) return skeletonOf(f.fields);
  if (f.type === 'array') return f.items ? [skeletonField(f.items)] : [];
  if (f.values) return { '<key>': skeletonField(f.values) };
  return `<${f.status} ${f.type}${f.nullable ? ' or null' : ''}>`;
}
function skeletonOf(spec) {
  return Object.fromEntries(Object.entries(spec).map(([k, f]) => [k, skeletonField(f)]));
}
/** open --template's skeleton: both parts, from OPEN_RECORD_V1, every fixed or default value filled. Pure. */
export function openTemplate() {
  return { kind: TEMPLATE_KIND, v: 1, draft: skeletonOf(OPEN_RECORD_V1.draft), final: skeletonOf(OPEN_RECORD_V1.final) };
}

/** The values a schema gives: a field's value when it has one, an object of its fields' values when it has fields (a key
 *  with no value left out), nothing otherwise. */
function schemaValues(spec) {
  const o = {};
  for (const [k, f] of Object.entries(spec)) {
    if (Object.hasOwn(f, 'value')) o[k] = copyJson(f.value);
    else if (f.fields) {
      const inner = schemaValues(f.fields);
      if (Object.keys(inner).length > 0) o[k] = inner;
    }
  }
  return o;
}
/** The operator's overrides, applied to `default` fields only (W2-D25: the values the operator confirms or changes when
 *  signing). An array is replaced whole; a fixed, measured, derived or operator field, an unknown key, and a field that
 *  comes from the pilot-source output are args-invalid. */
function applyOverrides(target, over, spec, prefix) {
  for (const [k, v] of Object.entries(over)) {
    const p = prefix === '' ? k : `${prefix}.${k}`;
    const f = spec[k];
    if (f === undefined) refuse('args-invalid', `override ${p} is not a part 1 field`);
    if (PILOT_DERIVED.includes(p)) refuse('args-invalid', `override ${p} comes from the pilot-source output`);
    if (p === 'rubric_sha256') refuse('args-invalid', 'override rubric_sha256 follows rubric_id');
    if (f.fields && !Object.hasOwn(f, 'value') && plainObject(v)) {
      if (!plainObject(target[k])) target[k] = {};
      applyOverrides(target[k], v, f.fields, p);
      continue;
    }
    if (f.status === 'default') {
      target[k] = copyJson(v);
      continue;
    }
    refuse('args-invalid', `override ${p} is ${f.status}`);
  }
}
function readOverrides(p) {
  const read = readPlain(path.resolve(p), OUT_JSON_CAP);
  if (read.state !== 'bytes') refuse('args-invalid', `overrides ${read.state === 'absent' ? 'absent' : badWord(read)}`);
  let o;
  try {
    o = JSON.parse(read.bytes.toString('utf8'));
  } catch {
    refuse('args-invalid', 'overrides not-json');
  }
  if (!plainObject(o)) refuse('args-invalid', 'overrides is not a JSON object');
  return o;
}

/** Part 1 (W2 decisions §4): the schema's fixed and default values, the overrides, then what the operator named, what
 *  step 0a and the pilot measured, the seed and gate_code. Pure: the caller draws the seed and reads the clock.
 *  @param {Record<string, any>} input  @returns {Record<string, any>} */
export function buildDraft({ nodes, step0a, pilot, account, models, gateCode, seedHex, nowMs, overrides = {}, supersedes = null }) {
  const d = schemaValues(DRAFT_SPEC);
  applyOverrides(d, overrides, DRAFT_SPEC, '');
  return {
    ...d,
    drafted_ms: nowMs, supersedes, nodes: copyJson(nodes), account,
    arm_model: models.arm, writer_model: models.writer, judge_model: models.judge,
    step0a: copyJson(step0a),
    bootstrap: { ...d.bootstrap, seed: seedHex },
    labeller: { ...d.labeller, sha_min_prefix: pilot.used.sha_min_prefix },
    rubric_sha256: Object.hasOwn(RUBRIC_SHA256, d.rubric_id) ? RUBRIC_SHA256[d.rubric_id] : d.rubric_sha256,
    quiz: { ...d.quiz, writer_input: pilot.used.writer_input, baseline_files: pilot.used.baseline_files },
    active_rule: { ...d.active_rule, text: d.active_rule.text ?? ACTIVE_RULE_TEXT },
    pilot: { seed: pilot.seed, n_fidelity: pilot.n_fidelity, n_usage: pilot.n_usage, tolerance: d.pilot.tolerance,
      families: copyJson(pilot.families), frozen_sha256: pilot.frozen_sha256, writer_model: pilot.writer_model, used: copyJson(pilot.used),
      code_shas: copyJson(pilot.code_shas), release_stamp: pilot.release_stamp, budget: pilot.budget, spend: pilot.spend },
    gate_code: copyJson(gateCode),
  };
}

/** Part 2 (W2 decisions §4): part 1 whole, then the census instants, the registry drops, the power figures, the pilot's
 *  result, the approved spend budget, the re-derived assignment, the frozen quiz and the window. Pure.
 *  @param {Record<string, any>} input  @returns {Record<string, any>} */
export function buildFinal({ draft, draftSha256, priorSha256 = null, assembled, assignment, power, powerSha256, frozen, pilotResult, spendBudget, window, decision, nowMs }) {
  return {
    ...copyJson(draft),
    part: 'final', supersedes: priorSha256 ?? draftSha256, finalized_ms: nowMs,
    census: assembled.nodes.map((n) => ({ store_id: n.store_id, census_ms: n.report.census.as_of_ms, census_sha256: n.census_sha256 })),
    registry_drops: copyJson(assembled.drops),
    q18: { headline: power.headline, at_power_80: power.at_power_80, at_rho_0: power.at_rho_0, rho_hat: power.rho_hat,
      n_f: copyJson(power.n_f), coverage: copyJson(power.coverage), pre_window_uptake: copyJson(power.pre_window_uptake),
      power_output_sha256: powerSha256, decision },
    pilot_result: { fidelity: copyJson(pilotResult.fidelity), usage_extrapolation: copyJson(pilotResult.usage_extrapolation),
      step0b_sha256: pilotResult.step0b_sha256, settings_mode: pilotResult.settings_mode, absent_rate: copyJson(pilotResult.absent_rate) },
    spend_budget: spendBudget,
    assignment: copyJson(assignment.list), assignment_sha256: assignment.sha256,
    quiz: { ...copyJson(draft.quiz), sha256: frozen.sha256, n_questions: frozen.list.entries.length, n_families: frozen.families.length, families: copyJson(frozen.families) },
    window: { start_ms: window.start, end_ms: window.end },
    amendments: [],
  };
}

// ── input shapes the subcommands read ──────────────────────────────────────────────────────────────────────
function entryError(e) {
  if (!plainObject(e)) return 'entry';
  for (const k of FROZEN_ENTRY_KEYS) if (!Object.hasOwn(e, k)) return `entry ${k}`;
  // A string that is empty is no value: qidOf and the frozen list's own checks would throw on it later, a TypeError instead of
  // this refusal, so every text field and every repo root must be non-empty here.
  for (const k of ['qid', 'store_id', 'ccrc_id', 'generation', 'boundary_uuid', 'fact', 'fact_raw', 'question', 'source_entry_uuid']) {
    if (typeof e[k] !== 'string' || e[k] === '') return `entry ${k}`;
  }
  if (!FACT_KINDS.includes(e.kind)) return 'entry kind';
  if (!Array.isArray(e.repo_roots) || !e.repo_roots.every((r) => typeof r === 'string' && r !== '')) return 'entry repo_roots';
  // A quiz entry's rank is [its family's quizFamilyOrderKey, its candidate rank] (W2-D71 as amended 2026-10-22; R10).
  if (!Array.isArray(e.rank) || e.rank.length !== 2 || typeof e.rank[0] !== 'string' || !SHA256_RE.test(e.rank[0])
    || !Number.isSafeInteger(e.rank[1]) || e.rank[1] < 0) return 'entry rank';
  return null;
}
function sourcedError(o) {
  if (!plainObject(o) || o.kind !== SOURCED_KIND || o.v !== 1) return 'kind';
  for (const k of ['record_sha256', 'assignment_sha256']) if (typeof o[k] !== 'string' || !SHA256_RE.test(o[k])) return k;
  if (typeof o.store_id !== 'string') return 'store_id';
  if (!Array.isArray(o.entries)) return 'entries';
  for (const e of o.entries) { const bad = entryError(e); if (bad !== null) return bad; }
  return plainObject(o.counts) ? null : 'counts';
}
function quizMetaError(o) {
  if (!plainObject(o) || o.kind !== QUIZ_META_KIND || o.v !== 1) return 'kind';
  for (const k of ['record_sha256', 'frozen_sha256', 'assignment_sha256']) if (typeof o[k] !== 'string' || !SHA256_RE.test(o[k])) return k;
  if (!Number.isSafeInteger(o.n_questions) || !Number.isSafeInteger(o.n_families)) return 'counts';
  return typeof o.below_floor === 'boolean' ? null : 'below_floor';
}
function powerError(o) {
  if (!plainObject(o) || o.kind !== POWER_KIND || o.v !== 1) return 'kind';
  if (typeof o.record_sha256 !== 'string' || !SHA256_RE.test(o.record_sha256)) return 'record_sha256';
  if (!Array.isArray(o.inputs)) return 'inputs';
  for (const k of ['headline', 'at_power_80', 'at_rho_0', 'rho_hat']) if (o[k] !== null && typeof o[k] !== 'number') return k;
  for (const k of ['n_f', 'coverage', 'pre_window_uptake']) if (!plainObject(o[k])) return k;
  return null;
}
function pilotSourceError(o) {
  if (!plainObject(o) || o.kind !== PILOT_SOURCE_KIND || o.v !== 1) return 'kind';
  for (const k of ['seed', 'frozen_sha256']) if (typeof o[k] !== 'string' || !SHA256_RE.test(o[k])) return k;
  for (const k of ['n_fidelity', 'n_usage', 'budget', 'spend']) if (!Number.isSafeInteger(o[k])) return k;
  if (!Array.isArray(o.families)) return 'families';
  if (typeof o.writer_model !== 'string' || typeof o.release_stamp !== 'string') return 'writer_model';
  if (!plainObject(o.used) || !plainObject(o.code_shas)) return 'used';
  return null;
}
function pilotResultError(o) {
  if (!plainObject(o) || o.kind !== PILOT_RESULT_KIND || o.v !== 1) return 'kind';
  if (!Array.isArray(o.fidelity) || !o.fidelity.every(plainObject)) return 'fidelity';
  if (!plainObject(o.usage_extrapolation)) return 'usage_extrapolation';
  if (typeof o.step0b_sha256 !== 'string' || !SHA256_RE.test(o.step0b_sha256)) return 'step0b_sha256';
  if (!SETTINGS_MODES.includes(o.settings_mode)) return 'settings_mode';
  return plainObject(o.absent_rate) ? null : 'absent_rate';
}

// ── the subcommands ────────────────────────────────────────────────────────────────────────────────────────
/** A positive safe integer: D-6309's range for every count and bound the record carries. */
const positiveInt = (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 1;

/** D-6309's refusal over [path, inRange] rows: `record-invalid`, naming each failing path as `<path> out-of-range`,
 *  joined by `; `, in row order; nothing when every row is in range. The one spelling of that refusal, for
 *  refuseOutOfRangeValues and for W2-5b1 Task 4's expectedForNode (R30, W2-D12).
 *  @param {Array<[string, boolean]>} checks */
function refuseRangeRows(checks) {
  const bad = checks.filter(([, ok]) => !ok).map(([name]) => `${name} out-of-range`);
  if (bad.length > 0) refuse('record-invalid', bad.join('; '));
}

/** D-6309: the record's budget, limits and quiz quotas, in range, asked before prepareOut makes --out. The
 *  gate's validator types these fields as bare integers with no range, so a signed record can carry a value that batchGate
 *  (`pilot_budget`, `limits.threshold_pct`, `limits.max_age_ms`) or sampleQuestions' assertCount (`quiz.target` and
 *  `quiz.caps.family`, `boundary` and `kind_per_family`) throws on, a TypeError after --out and, for the quotas, after a
 *  writer spawn. Every field those two assert on is checked here, each a positive safe integer and `threshold_pct` also at
 *  most 100; their throws stay as internal assertions behind this check. A bad value refuses `record-invalid` (the word for a
 *  record the gate would not sign), naming each field as `<path> out-of-range`; nothing is written. One function, reached
 *  from both subcommands through refuseWriterAdmission: quiz-source passes the signed record's values, pilot-source its
 *  `--budget` (a positive integer by the flag grammar), LIMITS_DEFAULTS and pilotCaps, with `--n-usage` as the target.
 *  Tightening W2-3's validator in the gate is not this file's.
 *  W2-5b1 Task 1 (S2's C22): `budgetField` names the budget's field (`spend_budget` for a part 2 consumer); `quotas: null`
 *  skips the quiz-quota rows (a part 2 consumer samples nothing); `part2`, a final, adds part2RangeChecks' rows.
 *  `batch` adds batchShapeChecks' rows (W2-5b1 Task 4).
 *  @param {{ budget: unknown, budgetField?: string, limits: { threshold_pct?: unknown, max_age_ms?: unknown } | undefined,
 *    quotas: { target: unknown, caps: { family?: unknown, boundary?: unknown, kind_per_family?: unknown } | undefined } | null,
 *    part2?: any, batch?: boolean }} o */
export function refuseOutOfRangeValues({ budget, budgetField = 'pilot_budget', limits, quotas, part2 = null, batch = false }) {
  const checks = [
    [budgetField, positiveInt(budget)],
    ['limits.threshold_pct', positiveInt(limits?.threshold_pct) && /** @type {number} */ (limits?.threshold_pct) <= 100],
    ['limits.max_age_ms', positiveInt(limits?.max_age_ms)],
    ...(quotas === null ? [] : [
      ['quiz.target', positiveInt(quotas?.target)],
      ['quiz.caps.family', positiveInt(quotas?.caps?.family)],
      ['quiz.caps.boundary', positiveInt(quotas?.caps?.boundary)],
      ['quiz.caps.kind_per_family', positiveInt(quotas?.caps?.kind_per_family)],
    ]),
    // W2-5b1 Task 4 (R4): the arm batch's shape, asked by `arms` on either part (part 2 also carries it through part2).
    ...(batch ? batchShapeChecks(limits) : []),
    ...(part2 === null ? [] : part2RangeChecks(part2)),
  ];
  refuseRangeRows(checks);
}

/** D-6307 (R10), D-6311, D-6309: the refusals openWriter makes that need no store and no spawn, asked before prepareOut makes
 *  --out, so a refused run leaves no --out. First the record's values in range (refuseOutOfRangeValues, `record-invalid`),
 *  then, in openWriter's order and through the SAME functions it calls, never a second spelling: the roster
 *  (`roster-invalid`), the account (`account-refused`), the wrapper's sha (`wrapper-unmeasured`), the limits row at open
 *  (`limits-threshold` and the other limits words) and preflight's no-spawn half (preflightFiles: `tree-unmeasured`,
 *  `tree-moved`, `wrapper-moved`, `code-unmeasured`, `code-changed`) against `expected`, the values openWriter is given.
 *  It writes nothing, and it is a pre-check only: openWriter asks every one again and stays the authority at open, so a
 *  state that moves between the two still refuses there, after --out was made (an empty --out is that race's residual).
 *  Two orders differ from openWriter's alone (D-6307): the roster, account, wrapper and limits words answer before
 *  prepareOut's `out-refused` words, and the limits word answers before `budget-exhausted` (batchGate checks the budget
 *  first, but the budget needs the ledger under --out, which does not exist yet). D-6311 adds a third: the
 *  `--version` probe is a spawn and stays openWriter's, so with both the version and the tree moved this answers
 *  `tree-moved` where open would have said `claude-version-moved`.
 *  @param {{ home: string, accountId: string, budget: number, limits: { threshold_pct: number, max_age_ms: number },
 *    quotas: { target: number, caps: { family: number, boundary: number, kind_per_family: number } }, expected: object }} o */
function refuseWriterAdmission({ home, accountId, budget, limits, quotas, expected }) {
  refuseOutOfRangeValues({ budget, limits, quotas });
  refuseSpawnAdmission({ home, accountId, limits, expected });
}

/** refuseWriterAdmission's no-store, no-spawn half (D-6307, D-6311), factored by W2-5b1 Task 4 so the writer, `arms` and
 *  `judge` ask one spelling (R26): the roster (`roster-invalid`), the account (`account-refused`), the wrapper's sha
 *  (`wrapper-unmeasured`), the limits row at open, then preflightFiles against `expected`, in that order. `allowCodeChange`
 *  (`arms` and `judge` after window start under --allow-code-change, Q23) lets preflightFiles answer a measured code change
 *  as a stamp, as the batch preflight does; the writer passes none, so its words and order are unchanged. Writes nothing.
 *  @param {{ home: string, accountId: string, limits: { threshold_pct: number, max_age_ms: number }, expected: object,
 *    allowCodeChange?: boolean }} o */
function refuseSpawnAdmission({ home, accountId, limits, expected, allowCodeChange = false }) {
  const { json, roster } = readRoster(home);
  const launch = admitAccount(json, roster, accountId, home);
  const wrapperSha256 = wrapperSha(launch);
  refuseOnLimits(home, accountId, { thresholdPct: limits.threshold_pct, maxAgeMs: limits.max_age_ms }, Date.now());
  const verdict = preflightFiles(expected, { stamp: readReleaseStamp(home), wrapperSha256, codeShas: codeShas() }, { allowCodeChange });
  if (!verdict.ok) refuse(verdict.word, verdict.detail);
}

// A handler that takes deps after its env names that parameter driverEnv, never env: W2-4 Task 5's env scan reads
// `, env,` on a code line as an env passed whole, and the value is still main's by-name projection.
/** `pilot-source` (W2 decisions §5 act 9, one pilot node, R9): before part 1, so its writer is preflighted against the
 *  one step 0a output it is given (Task 6's openWriter), under its own --budget and the driver's LIMITS_DEFAULTS (W2-D55,
 *  W2-D56). It records the code shas and the stamp the preflight held equal to step 0a's, which part 1's validator checks
 *  against gate_code (W2-D24). Its seed is its own (W2-D71), drawn by deps.seed. */
export async function pilotSourceCommand(flags, driverEnv, deps = { sourceQuiz, seed: drawSeedHex }) {
  checkFlags('pilot-source', flags);
  const home = subcommandHome(driverEnv);
  const pairs = pairedInputs(flags, 'step0a');
  if (pairs.length !== 1) refuse('args-invalid', 'pilot-source reads one step 0a output, this node\'s');
  const step0a = loadStep0a(pairs[0][0], pairs[0][1]);
  if (step0a.account !== flags.account) refuse('input-invalid', `step0a account ${step0a.account} is not --account ${flags.account}`);
  const shaMinPrefix = flags['sha-min-prefix'] ?? DRAFT_SPEC.labeller.fields.sha_min_prefix.value;
  if (!SHA_MIN_PREFIXES.includes(shaMinPrefix)) refuse('args-invalid', `sha-min-prefix ${shaMinPrefix} is not one of ${SHA_MIN_PREFIXES.join(', ')}`);
  const writerInput = flags['writer-input'] ?? DRAFT_SPEC.quiz.fields.writer_input.value;
  if (!WRITER_INPUTS.includes(writerInput)) refuse('args-invalid', `writer-input ${JSON.stringify(writerInput)} is not one of ${WRITER_INPUTS.join(', ')}`);
  const nFidelity = flags['n-fidelity'] ?? DRAFT_SPEC.pilot.fields.n_fidelity.value;
  const nUsage = flags['n-usage'] ?? DRAFT_SPEC.pilot.fields.n_usage.value;
  const baselineFiles = DRAFT_SPEC.quiz.fields.baseline_files.value;
  const writerModel = flags['writer-model'];
  refuseUnusableInputs(home, flags.out, [['writer-model', writerModel]]);
  refuseWriterModel(writerModel);   // R10: a refusal that needs no store and no spawn answers before --out exists
  refuseWriterAdmission({ home, accountId: flags.account, budget: flags.budget, limits: LIMITS_DEFAULTS, quotas: { target: nUsage, caps: pilotCaps() }, expected: step0a });   // D-6307, D-6311, D-6309: so do the ranges, the roster, the account, the wrapper, the limits row and the tree
  const rs = openReplayStore(home);   // the run's one store open (R3), read-only and before --out like quiz-source's (D-6311)
  try {
    const out = prepareOut(flags.out);
    refuseColonInRealOut(out);
    const claim = claimOut(out);
    try {
      // The writer: the model, the account (W2-D52), the gate (W2-D55) and W2-D56's preflight against step 0a, before
      // any writer spawn and before every writer batch (Task 6's openWriter).
      const writer = await openWriter({ home, accountId: flags.account, model: writerModel, settingsMode: step0a.settings_mode, writerInput,
        claim, budget: flags.budget, limits: LIMITS_DEFAULTS, expected: step0a, lang: driverEnv.LANG, idx: rs.idx });
      const seedHex = pinnedPilotSeed(out, deps.seed);   // D-6313: pinned under --out before the first ask
      const sourced = await deps.sourceQuiz({
        mode: 'pilot', rs, home, out, writer, seedHex, exclude: { pilotFamilies: [], assignment: [] },
        plan: { n_fidelity: nFidelity, n_usage: nUsage, caps: pilotCaps() }, configDirs: rosterConfigDirs(readRoster(home).roster, home),
        shaMinPrefix,
      });
      warnFailedRuns(sourced.counts);
      const frozenSha = writeFrozenList(out, 'pilot', frozenListText('pilot',
        { writer_model: writerModel, labeller: { ...copyJson(LABELLER), sha_min_prefix: shaMinPrefix } }, sourced.entries.map(frozenEntryOf)));
      const output = {
        kind: PILOT_SOURCE_KIND, v: 1, store_id: rs.storeId, seed: seedHex, n_fidelity: nFidelity, n_usage: nUsage,
        families: familiesOf([...sourced.entries, ...sourced.fidelity]), fidelity: copyJson(sourced.fidelity),
        frozen_sha256: frozenSha, writer_model: writerModel,
        used: { labeller: copyJson(LABELLER), sha_min_prefix: shaMinPrefix, writer_input: writerInput, baseline_files: baselineFiles,
          writer_prompt_sha256: WRITER_PROMPT_SHA256, answer_protocol_sha256: ANSWER_PROTOCOL_SHA256 },
        code_shas: copyJson(step0a.code_shas), release_stamp: step0a.release_stamp, budget: flags.budget, spend: spentSoFar(out), counts: sourced.counts,
      };
      writePlain(out, PILOT_SOURCE_FILE, canonicalJson(output) + '\n');
      process.stderr.write(`sha256 ${shaOfPlain(out, PILOT_SOURCE_FILE)}\n`);   // D-5983: stderr; stdout stays empty
      return EXIT.OK;
    } finally {
      claim.release();
    }
  } finally {
    rs.close();
  }
}

/** `quiz-source` (W2 decisions §5 act 16): after part 1, under part 1's account, models, settings mode, limits and
 *  pilot_budget (W2-D55), preflighted against part 1 (W2-D56). The assignment comes from the census and verify inputs
 *  (W2-D19, W2-D73); control-held ids and pilot families are excluded from sourcing (W2-D77), which walks this node's
 *  own admitted families, never the census's kept list (W2-D71, R10). Its writer model is the validated record's, held
 *  to an exact Opus id by the validator, so no refusal here needs --out first. */
export async function quizSourceCommand(flags, driverEnv, deps = { sourceQuiz }) {
  checkFlags('quiz-source', flags);
  const home = subcommandHome(driverEnv);
  const rec = loadRecordInput(flags, 'draft');
  recheckCode(rec.record);   // W2-D24 (quiz-source)
  const assembled = assembleCensus(rec.record, loadInputs(flags, 'census', OUT_STREAM_CAP), loadInputs(flags, 'verify'));
  const assignment = deriveAssignment(rec.record.bootstrap.seed, assembled);
  const rs = openReplayStore(home);   // the run's one store open (R3)
  try {
    const storeId = rs.storeId;
    requireNamedNode(rec.record, storeId);
    const entry = rec.record.step0a.find((s) => s.store_id === storeId);   // the validator binds exactly one per node
    const writerModel = rec.record.writer_model;
    refuseUnusableInputs(home, flags.out, [['writer-model', writerModel]]);
    const expected = { claude_code_version: entry.claude_code_version, release_stamp: rec.record.gate_code.release_tag,
      wrapper_sha256: entry.wrapper_sha256, code_shas: rec.record.gate_code.files };
    refuseWriterAdmission({ home, accountId: rec.record.account, budget: rec.record.pilot_budget, limits: rec.record.limits,
      quotas: { target: rec.record.quiz.target, caps: rec.record.quiz.caps }, expected });   // D-6307, D-6311, D-6309: before --out exists
    const out = prepareOut(flags.out);
    refuseColonInRealOut(out);
    const claim = claimOut(out);
    try {
      // The writer under part 1's account, models, settings mode, limits and pilot_budget (W2-D55), preflighted against
      // this node's part 1 step 0a entry and gate_code before every writer batch (Task 6's openWriter; W2-D56).
      const writer = await openWriter({ home, accountId: rec.record.account, model: writerModel, settingsMode: rec.record.settings_mode,
        writerInput: rec.record.quiz.writer_input, claim, budget: rec.record.pilot_budget, limits: rec.record.limits,
        expected, lang: driverEnv.LANG, idx: rs.idx });
      const sourced = await deps.sourceQuiz({
        // No family list (R10, C1): sourceQuiz walks this store's admitted families; assembled.kept fed the assignment only.
        mode: 'quiz', rs, home, out, writer, seedHex: rec.record.bootstrap.seed,
        exclude: { pilotFamilies: copyJson(rec.record.pilot.families), assignment: copyJson(assignment.list) },
        plan: copyJson(rec.record.quiz), configDirs: rosterConfigDirs(readRoster(home).roster, home),
        shaMinPrefix: rec.record.labeller.sha_min_prefix,
      });
      warnFailedRuns(sourced.counts);
      const inputs = assembled.nodes.map((n) => ({ store_id: n.store_id, census_sha256: n.census_sha256, verify_sha256: n.verify_sha256 }));
      ensurePlainDir(out, 'quiz');
      writePlain(out, SOURCED_FILE, canonicalJson(sourcedReport({ recordSha256: rec.sha256, storeId, assignmentSha256: assignment.sha256,
        inputs, sourced, spend: spentSoFar(out) })) + '\n');
      process.stderr.write(`sha256 ${shaOfPlain(out, SOURCED_FILE)}\n`);
      return EXIT.OK;
    } finally {
      claim.release();
    }
  } finally {
    rs.close();
  }
}

/** `freeze --record <draft>` (W2-D73): every named node's sourced list, exactly one each (a node with none refuses
 *  `sourced node-missing`, as the census assembler's word), of this record and one assignment, merged in global rank
 *  order (each family's order key, then its candidate rank; R10) and cut at quiz.target; `<out>/quiz/frozen.json` as W2-D73's exact bytes, 0600, and its meta beside it. */
export async function freezeCommand(flags, env) {
  checkFlags('freeze', flags);
  const rec = loadRecordInput(flags, 'draft');
  recheckCode(rec.record);   // W2-D24 (freeze)
  const lists = loadInputs(flags, 'sourced');
  const stores = new Set();
  const qids = new Set();
  let assignmentSha = null;
  for (const l of lists) {
    const bad = sourcedError(l.value);
    if (bad !== null) refuse('input-invalid', `sourced shape ${bad}`);
    const s = l.value;
    if (s.record_sha256 !== rec.sha256) refuse('input-invalid', `sourced record-mismatch ${s.store_id}`);
    requireNamedNode(rec.record, s.store_id);
    if (stores.has(s.store_id)) refuse('input-invalid', `sourced store-id-duplicate ${s.store_id}`);
    stores.add(s.store_id);
    if (assignmentSha !== null && s.assignment_sha256 !== assignmentSha) refuse('assignment-mismatch', `sourced lists disagree: ${assignmentSha} and ${s.assignment_sha256}`);
    assignmentSha = s.assignment_sha256;
    for (const e of s.entries) {
      if (e.store_id !== s.store_id) refuse('input-invalid', `sourced entry ${e.qid} names another store`);
      if (qidOf(e) !== e.qid) refuse('input-invalid', `sourced entry ${e.qid} qid-mismatch`);
      // A repeated qid (two ranks, one question) would reach frozenListText's "is repeated" TypeError: refuse it here.
      if (qids.has(e.qid)) refuse('input-invalid', `sourced qid-duplicate ${e.qid}`);
      qids.add(e.qid);
    }
  }
  // W2-D71's population is the families on the NAMED nodes: one list per node, or the merge freezes a subset.
  for (const n of rec.record.nodes) if (!stores.has(n.store_id)) refuse('input-invalid', `sourced node-missing ${n.label}`);
  const entries = mergeSourced(lists.map((l) => l.value.entries), rec.record.quiz.target);
  const text = frozenListText('quiz', { writer_model: rec.record.writer_model,
    labeller: { ...copyJson(LABELLER), sha_min_prefix: rec.record.labeller.sha_min_prefix } }, entries.map(frozenEntryOf));
  const out = prepareOut(flags.out);
  const claim = claimOut(out);
  try {
    const sha = writeFrozenList(out, 'quiz', text);   // Task 6's one writer: 0600, never replaced (W2-D73)
    writePlain(out, QUIZ_META_FILE, canonicalJson(quizMetaReport({ recordSha256: rec.sha256, frozenSha256: sha, assignmentSha256: assignmentSha,
      entries, floor: rec.record.quiz.halt_floor, minFamilies: rec.record.quiz.min_families,
      sourced: lists.map((l) => ({ store_id: l.value.store_id, sha256: l.sha256 })) })) + '\n');
    process.stderr.write(`sha256 ${sha}\n`);
    return EXIT.OK;
  } finally {
    claim.release();
  }
}

/** `power --record <draft>` (W2-D21, amended 2026-10-20): the census and verify outputs through the assembler that checks
 *  nodes only; prints to stdout, its sha on stderr. Reads no HOME and writes no file. */
export async function powerCommand(flags, env) {
  checkFlags('power', flags);
  const rec = loadRecordInput(flags, 'draft');
  recheckCode(rec.record);   // W2-D24 (power)
  const assembled = assembleCensus(rec.record, loadInputs(flags, 'census', OUT_STREAM_CAP), loadInputs(flags, 'verify'));
  return printWithSha(powerReport(rec.record, rec.sha256, assembled));
}

async function openDraft(flags, driverEnv, deps) {
  checkFlags('open --draft', flags);
  const home = subcommandHome(driverEnv);
  const pairs = pairedInputs(flags, 'step0a');
  const labels = flags['node-label'];
  const stores = flags['node-store-id'];
  if (labels.length !== pairs.length || stores.length !== pairs.length) {
    refuse('args-invalid', `--step0a, --node-label and --node-store-id are given ${pairs.length}, ${labels.length} and ${stores.length} times`);
  }
  const step0a = pairs.map(([p, h], i) => {
    const o = loadStep0a(p, h);
    const want = contractFlags(o.settings_mode);
    const have = Object.keys(o.flags_accepted).sort();
    const missing = want.filter((f) => !have.includes(f));
    const extra = have.filter((f) => !want.includes(f));
    if (missing.length + extra.length > 0) {
      refuse('input-invalid', `step0a ${labels[i]} flags-incomplete${missing.length > 0 ? ` missing ${missing.join(' ')}` : ''}${extra.length > 0 ? ` extra ${extra.join(' ')}` : ''}`);
    }
    return { ...o, label: labels[i], store_id: stores[i] };
  });
  const pilot = loadInput('pilot', flags.pilot, flags['pilot-sha256']).value;
  const pbad = pilotSourceError(pilot);
  if (pbad !== null) refuse('input-invalid', `pilot shape ${pbad}`);
  const overrides = flags.overrides === undefined ? {} : readOverrides(flags.overrides);
  const pred = flags.supersedes === undefined ? null : loadInput('supersedes', flags.supersedes, flags['supersedes-sha256'], RECORD_WORDS);
  if (pred !== null && !(plainObject(pred.value) && pred.value.part === 'draft' && plainObject(pred.value.bootstrap) && typeof pred.value.bootstrap.seed === 'string')) {
    refuse('record-invalid', 'supersedes is not a draft with a seed');
  }
  const shas = codeShas();
  if (shas.state !== 'measured') refuse('code-unmeasured', `${shas.path} is ${shas.cause}`);
  const stamp = readReleaseStamp(home);
  if (stamp.state !== 'value') refuse('tree-unmeasured', `stamp ${stamp.state}${stamp.code === undefined ? '' : ` ${stamp.code}`}`);
  const record = buildDraft({
    nodes: step0a.map((s) => ({ label: s.label, store_id: s.store_id })), step0a, pilot, account: flags.account,
    models: { arm: flags['arm-model'], writer: flags['writer-model'], judge: flags['judge-model'] },
    gateCode: { release_tag: stamp.tag, files: shas.files },
    seedHex: pred === null ? deps.seed() : pred.value.bootstrap.seed, nowMs: deps.now(), overrides,
    supersedes: pred === null ? null : pred.sha256,
  });
  const v = validateOpenRecord(record, { draft: null, predecessor: pred === null ? null : pred.value, frozen: null });
  if (!v.ok) refuse('record-invalid', v.errors.map((e) => `${e.path} ${e.word}`).join('; '));
  return printWithSha(record);
}

async function openFinalize(flags, driverEnv, deps) {
  checkFlags('open --finalize', flags);
  const rec = loadRecordInput(flags, 'draft');
  recheckCode(rec.record);   // W2-D24 (open --finalize)
  const assembled = assembleCensus(rec.record, loadInputs(flags, 'census', OUT_STREAM_CAP), loadInputs(flags, 'verify'));
  const assignment = deriveAssignment(rec.record.bootstrap.seed, assembled);
  const meta = loadInput('quiz-meta', flags['quiz-meta'], flags['quiz-meta-sha256']).value;
  const mbad = quizMetaError(meta);
  if (mbad !== null) refuse('input-invalid', `quiz-meta shape ${mbad}`);
  if (meta.record_sha256 !== rec.sha256) refuse('input-invalid', 'quiz-meta record-mismatch');
  const frozen = loadFrozen(flags.frozen, flags['frozen-sha256']);
  if (meta.frozen_sha256 !== frozen.sha256) refuse('quiz-sha-mismatch', `quiz-meta names ${meta.frozen_sha256}, the frozen list is ${frozen.sha256}`);
  if (meta.assignment_sha256 !== assignment.sha256) {
    refuse('assignment-mismatch', `quiz-source derived ${meta.assignment_sha256}, the census and verify inputs give ${assignment.sha256}`);
  }
  if (meta.below_floor) refuse('input-invalid', 'quiz-meta below-floor: a ruling to proceed lowers quiz.halt_floor in a superseding draft');
  const powerIn = loadInput('power', flags.power, flags['power-sha256']);
  const pwbad = powerError(powerIn.value);
  if (pwbad !== null) refuse('input-invalid', `power shape ${pwbad}`);
  if (powerIn.value.record_sha256 !== rec.sha256) refuse('input-invalid', 'power record-mismatch');
  const inputs = assembled.nodes.map((n) => ({ store_id: n.store_id, census_sha256: n.census_sha256, verify_sha256: n.verify_sha256 }));
  if (canonicalJson(powerIn.value.inputs) !== canonicalJson(inputs)) refuse('input-invalid', 'power inputs-mismatch');
  const pilotResult = loadInput('pilot-result', flags['pilot-result'], flags['pilot-result-sha256']).value;
  const prbad = pilotResultError(pilotResult);
  if (prbad !== null) refuse('input-invalid', `pilot-result shape ${prbad}`);
  const decision = flags['q18-decision'];
  if (!Q18_DECISIONS.includes(decision)) refuse('args-invalid', `q18-decision ${JSON.stringify(decision)} is not one of ${Q18_DECISIONS.join(', ')}`);
  const prior = flags['prior-final'] === undefined ? null : loadInput('prior-final', flags['prior-final'], flags['prior-final-sha256'], RECORD_WORDS);
  const final = buildFinal({
    draft: rec.record, draftSha256: rec.sha256, priorSha256: prior === null ? null : prior.sha256, assembled, assignment,
    power: powerIn.value, powerSha256: powerIn.sha256, frozen, pilotResult, spendBudget: flags['spend-budget'],
    window: { start: flags['window-start'], end: flags['window-end'] }, decision, nowMs: deps.now(),
  });
  const v = validateOpenRecord(final, { draft: rec.record, predecessor: prior === null ? null : prior.value,
    frozen: { families: frozen.families, n_questions: frozen.list.entries.length } });
  if (!v.ok) refuse('record-invalid', v.errors.map((e) => `${e.path} ${e.word}`).join('; '));
  return printWithSha(final);
}

/** `open --draft | --finalize | --template` (W2-D25): writes no file. */
export async function openCommand(flags, driverEnv, deps = { seed: drawSeedHex, now: () => Date.now() }) {
  const modes = ['draft', 'finalize', 'template'].filter((m) => flags[m] === true);
  if (modes.length !== 1) refuse('args-invalid', 'open wants exactly one of --draft, --finalize and --template');
  if (modes[0] === 'template') {
    checkFlags('open --template', flags);
    process.stdout.write(canonicalJson(openTemplate()) + '\n');
    return EXIT.OK;
  }
  return modes[0] === 'draft' ? openDraft(flags, driverEnv, deps) : openFinalize(flags, driverEnv, deps);
}

/** The presence directory's mtime: every write of the one writer renames into it (W2-D28), so it is the newest write. */
function newestPresenceWrite(home) {
  let st;
  try {
    st = lstatSync(historyPaths(home).recallOffDir);
  } catch (e) {
    return e?.code === 'ENOENT' ? { state: 'absent' } : { state: 'unmeasured', code: errCode(e) };
  }
  return st.isDirectory() ? { state: 'value', ms: st.mtimeMs } : { state: 'unmeasured', code: 'not-a-directory' };
}
/** status's recall_off.seen_ms, from the store's presence meta rows through lib's own reader (W2-D31), on the run's one
 *  open store. */
function presenceSeenMs(rs) {
  const rows = rs.db.prepare('SELECT k, v FROM meta WHERE substr(k, 1, ?) = ?').all(RECALL_OFF_META.length, RECALL_OFF_META);
  return recallOffStatusOf(new Map(rows.map((r) => [String(r.k), String(r.v)]))).seen_ms;
}

async function verifyRegistry(flags, env) {
  checkFlags('verify --registry', flags);
  const home = subcommandHome(env);
  const rec = loadRecordInput(flags, 'draft');
  recheckCode(rec.record);   // W2-D24 (verify --registry)
  const census = loadInputs(flags, 'census', OUT_STREAM_CAP);
  if (census.length !== 1) refuse('args-invalid', 'verify --registry reads one census, this node\'s');
  const c = census[0];
  const bad = censusError(c.value);
  if (bad !== null) refuse('input-invalid', `census shape ${bad}`);
  const storeId = nodeStoreId(home);
  requireNamedNode(rec.record, storeId);
  if (c.value.store_id !== storeId) refuse('input-invalid', `census store-id ${c.value.store_id} is not this node's store ${storeId}`);
  let act;
  try {
    act = activeFamilies(storeId, c.value.census, { lookbackMs: rec.record.active_rule.lookback_ms });
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    refuse('input-invalid', `census ${storeId} ${e.message}`);
  }
  const reg = historyPaths(home).reg;
  const families = act.active.map((f) => {
    if (!idOk(f.ccrc_id)) refuse('input-invalid', `census family id ${JSON.stringify(f.ccrc_id)} is not a session id`);
    return { ccrc_id: f.ccrc_id, generation: f.generation, state: registryStateOf(readRegPresence(path.join(reg, `${f.ccrc_id}.generation`)), f.generation) };
  });
  return printWithSha(verifyRegistryReport({ recordSha256: rec.sha256, storeId, censusSha256: c.sha256, lookbackMs: rec.record.active_rule.lookback_ms, families }));
}

async function verifyAb(flags, env) {
  checkFlags('verify --section ab', flags);
  const home = subcommandHome(env);
  const rec = loadRecordInput(flags, 'final');
  recheckCode(rec.record);   // W2-D24 (verify --section ab)
  const rs = openReplayStore(home);   // the run's one store open (R3)
  try {
    const storeId = rs.storeId;
    requireNamedNode(rec.record, storeId);
    const families = rec.record.assignment.filter((a) => a.store_id === storeId).map((a) => {
      if (!idOk(a.ccrc_id)) refuse('input-invalid', `assignment family id ${JSON.stringify(a.ccrc_id)} is not a session id`);
      return { ccrc_id: a.ccrc_id, generation: a.generation, arm: a.arm, state: abStateOf(a.arm, a.generation, controlFileOf(home, a.ccrc_id)) };
    });
    const newest = newestPresenceWrite(home);
    const seen = presenceSeenMs(rs);
    return printWithSha(verifyAbReport({ recordSha256: rec.sha256, storeId, families, newest, seen }));
  } finally {
    rs.close();
  }
}

/** `verify --registry | --section ab | --section pilot | --section quiz` (W2-D84): read-only on one node; a finding is
 *  data, exit 0. --registry and --section ab are W2-5a Task 7's; pilot and quiz are W2-5b1 Task 3's (verifyHeadless). */
export async function verifyCommand(flags, env) {
  const registry = flags.registry === true;
  if (registry === (flags.section !== undefined)) refuse('args-invalid', 'verify wants exactly one of --registry and --section');
  if (registry) return verifyRegistry(flags, env);
  if (flags.section === 'ab') return verifyAb(flags, env);
  if (flags.section === 'pilot' || flags.section === 'quiz') return verifyHeadless(flags.section, flags, env);
  return refuse('args-invalid', `section ${JSON.stringify(flags.section)}: verify reads ab, pilot or quiz`);
}

HANDLERS.set('pilot-source', (flags, env) => pilotSourceCommand(flags, env));
HANDLERS.set('quiz-source', (flags, env) => quizSourceCommand(flags, env));
HANDLERS.set('freeze', freezeCommand);
HANDLERS.set('power', powerCommand);
HANDLERS.set('open', (flags, env) => openCommand(flags, env));
HANDLERS.set('verify', verifyCommand);

// ── W2-5b1 Task 1: part 2 for W2-5b's consumers (W2-D24, W2-D25, W2-D90; S2's C22, Q23) ────────────────────────────────
/** The amendment kind whose detail W2-D56's version preflight reads (W2-D90): one of the gate's AMENDMENT_KINDS, held
 *  there by history-replay.test.ts. */
export const VERSION_MOVE_KIND = 'version-move';

/** The arm batch's shape (Q3, R4), one spelling for part2RangeChecks and for `arms` on part 1 (W2-5b1 Task 4's `batch`):
 *  limits.batch_max holds both arms of at least one question (RECALL_ARMS.length) and at most BATCH_MAX spawns (runBatch
 *  throws past it), and limits.concurrency is runBatch's 1 to CONCURRENCY_MAX. The record's values are read, bounded by
 *  these, never replaced by the constants. Pure.
 *  @param {any} limits  @returns {Array<[string, boolean]>} */
function batchShapeChecks(limits) {
  return [
    ['limits.batch_max', positiveInt(limits?.batch_max) && limits.batch_max >= RECALL_ARMS.length && limits.batch_max <= BATCH_MAX],
    ['limits.concurrency', positiveInt(limits?.concurrency) && limits.concurrency <= CONCURRENCY_MAX],
  ];
}

/** Each version-move amendment's node label (Q13 requires it: one of the record's node labels) and Claude Code version
 *  (W2-D56 compares the measured --version with it: a non-empty string), as [path, inRange], in array order; another
 *  kind adds no row. The one spelling of these two ranges (R30, W2-D12): part2RangeChecks reads it for a part 2
 *  consumer, and W2-5b1 Task 4's expectedForNode reads it through refuseRangeRows. Pure.
 *  @param {any} r  @returns {Array<[string, boolean]>} */
function versionMoveChecks(r) {
  const labels = new Set((Array.isArray(r?.nodes) ? r.nodes : []).map((n) => n?.label));
  /** @type {Array<[string, boolean]>} */
  const checks = [];
  (Array.isArray(r?.amendments) ? r.amendments : []).forEach((a, i) => {
    if (a?.kind !== VERSION_MOVE_KIND) return;
    checks.push([`amendments[${i}].node_label_ref`, typeof a.node_label_ref === 'string' && labels.has(a.node_label_ref)]);
    const v = a.detail?.claude_code_version;
    checks.push([`amendments[${i}].detail.claude_code_version`, typeof v === 'string' && v !== '']);
  });
  return checks;
}

/** The part 2 fields a W2-5b consumer reads that the gate's validator types but does not range (S2's C22, D-6309's rule),
 *  each as [path, inRange]: the arm batch's shape (batchShapeChecks); the question count (a count kept in range; Q5's per-node
 *  share divides by the frozen list's entry count instead, which nodeQuestions holds non-empty); the settings mode the arms run under (Q26; spawnArgv
 *  throws on another word); and each version-move amendment's rows (versionMoveChecks, R30). The window is not here: the
 *  validator holds it to planned_days. A later task that reads another part 2 field adds its row here in the same commit. Pure.
 *  @param {any} r  @returns {Array<[string, boolean]>} */
function part2RangeChecks(r) {
  /** @type {Array<[string, boolean]>} */
  const checks = [
    ...batchShapeChecks(r?.limits),
    ['quiz.n_questions', positiveInt(r?.quiz?.n_questions)],
    ['pilot_result.settings_mode', SETTINGS_MODES.includes(r?.pilot_result?.settings_mode)],
    ...versionMoveChecks(r),
  ];
  return checks;
}

/** W2-5b's part 2 consumers' one loader (`arms --section quiz` and `judge --section quiz`, Tasks 4 and 5; W2-5b2's
 *  `report`). The final through loadRecordInput (W2-D25: its sha before a byte is parsed, its draft, its frozen list, and
 *  the final it supersedes when it is amended, the validator holding the chain); then W2-D24's re-check, first, before any
 *  other input is read and before any spawn, with --allow-code-change taken at or after window start only and answered as
 *  stamps the consumer writes into every output (Q23); then every part 2 field the consumer reads, in range (S2's C22). It
 *  writes nothing and takes no --out, so a consumer calls it before prepareOut (W2-5a's R10, D-6309's rule).
 *  @param {Flags} flags  @param {{nowMs: number, root?: string}} o
 *  @returns {{record: any, sha256: string, frozen: any, stamps: string[]}} */
export function loadFinalRecord(flags, { nowMs, root = TREE_ROOT }) {
  const rec = loadRecordInput(flags, 'final');
  const stamps = recheckCode(rec.record, root, { allowCodeChange: flags['allow-code-change'] === true, nowMs });
  const r = rec.record;
  refuseOutOfRangeValues({ budget: r.spend_budget, budgetField: 'spend_budget', limits: r.limits, quotas: null, part2: r });
  return { ...rec, stamps };
}

// ── W2-5b1 Task 2: the as-of pieces: the card line, the two payloads and the re-check (W2-D75, W2-D78(iii), W2-D38) ──
// Every as-of decision here is lib's own (W2-D38), never a second spelling: the cut at boundary N is recall.mjs's
// asOfCutOf over this run's read-only handle, called on one line (armCut); a node is hidden by lib's asOfHiddenNodesSql
// (W2-D35 as amended: D-6282, D-6283, D-6284), and an entry is visible by lib's asOfVisibleEntriesSql, each bound with
// lib's asOfBinds. R8's ref rule answers another question (does describe drop a node's refs) and is never composed here
// (ruling S2).
// The card line (W2-D75; spec §8.6): lib's cardLine over leaf N's node (LEAF_OF_BOUNDARY_SQL, the node spanRowsOf reads)
// and its depth-1 parent, named only when lib does not hide it under the cut at N, so the card never names a node that
// answers exit 3 under the arm's own cut. A leaf with several depth-1 parents names none (fail closed). Both print as
// lib's displayPrefixes over the family's whole node-id set (ruling Q20), as the sweep's card does.
// The payloads (ruling Q20; spec §10.2 "Two arms": the driver prepends the card): the plain payload is W2-5a's
// reconstructPayload text, byte for byte; the carded one is the card line, one blank line, then that same text.
// The re-check before every arm batch (W2-D78(iii), ruling Q21), each question in batch order, its first failing clause
// named: (a) the one redaction screen, screenRedaction, over the question's candidate re-mined from the store through
// mineStoredBoundary (sourceQuiz's own mining: a frozen entry carries no leaf); (b) W2-D70 over leaf N's span, any
// source (answerability); (c) the frozen source_entry_uuid visible under the cut at boundary_uuid, the cut's own
// asof-invalid included. A batch with any failure refuses quiz-unanswerable, naming every failing qid and its clause: a
// frozen question is never dropped silently.
// A failure on store data is a RECON_DISCARDS word or a clause, never a throw (D-6309's rule: a data case after --out
// never exits INTERNAL); a caller's defect (a cut of another boundary, a question of another store) is a TypeError.

/** Where the card's parent stands (W2-D75): named (`shown`), no depth-1 parent (`none`), hidden under the cut at N
 *  (`hidden`), or several depth-1 parents, a damaged store's shape, so none is named (`several`). A report word, never a
 *  refusal. */
export const CARD_PARENTS = Object.freeze(['shown', 'none', 'hidden', 'several']);

const ARM_STMTS = new WeakMap();
/** The reads this section makes, prepared once per handle: lib's node and entry statements, and the boundary, entry and
 *  node reads the card and the re-check add. The boundary's transcript is the boundaries row's (D-6281). */
function armStmts(db) {
  let s = ARM_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    boundary: db.prepare(`SELECT b.entry_id AS entry_id, e.uuid AS uuid, e.ts_ms AS ts_ms, b.transcript_pk AS transcript_pk
      FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id WHERE e.uuid = ?`),
    entryId: db.prepare('SELECT entry_id FROM entries WHERE uuid = ?'),
    leaf: db.prepare(`SELECT node_id, session_pk FROM nodes WHERE node_id = (${LEAF_OF_BOUNDARY_SQL})`),
    parents: db.prepare(`SELECT c.node_id AS node_id FROM node_children c JOIN nodes p ON p.node_id = c.node_id
      WHERE c.child_id = ? AND p.depth = 1 ORDER BY c.node_id`),
    family: db.prepare('SELECT node_id FROM nodes WHERE session_pk = ? ORDER BY node_id'),
    hidden: db.prepare(asOfHiddenNodesSql()),
    visible: db.prepare(asOfVisibleEntriesSql()),
  };
  ARM_STMTS.set(db, s);
  return s;
}

/** The cut at boundary N (W2-D38): recall.mjs's asOfCutOf over this run's read-only handle (it reads `rc.db` only),
 *  answered unchanged: `{ ok: true, cut }`, or `{ ok: false, rc, reason: 'asof-invalid' }` (D-5765's store half). The
 *  driver's one call.
 *  @param {ReplayStore} rs  @param {string} boundaryUuid */
export function armCut(rs, boundaryUuid) {
  return asOfCutOf(rs, boundaryUuid);
}

/** Boundary N's card line (W2-D75; spec §8.6), under `cut`, the cut at N: lib's cardLine over leaf N's node and its
 *  depth-1 parent, the parent only when lib's asOfHiddenNodesSql does not hide it (CARD_PARENTS says where it stands),
 *  both as displayPrefixes over the family's whole node-id set (ruling Q20). No leaf node for N is `leaf-absent`; an id
 *  lib's grammar refuses is `card-unrenderable`. A cut of another boundary is the caller's defect.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId  @param {{ boundaryEntryId: number }} cut
 *  @returns {{ state: 'card', line: string, leafId: string, parentId: string | null, parent: string }
 *    | { state: 'discard', why: 'leaf-absent' | 'card-unrenderable' }} */
export function cardOf(rs, boundaryEntryId, cut) {
  if (cut.boundaryEntryId !== Number(boundaryEntryId)) {
    throw new TypeError(`cardOf: the cut is boundary entry ${String(cut.boundaryEntryId)}'s, not ${String(boundaryEntryId)}'s`);
  }
  const s = armStmts(rs.db);
  const leaf = s.leaf.get(boundaryEntryId);
  if (leaf === undefined) return reconDiscard('leaf-absent');
  const parents = s.parents.all(leaf.node_id).map((r) => String(r.node_id));
  let parent = 'none';
  let parentId = null;
  if (parents.length > 1) parent = 'several';
  else if (parents.length === 1) {
    const hidden = s.hidden.all({ ...asOfBinds(cut), asof_nodes: JSON.stringify(parents) }).length > 0;
    parent = hidden ? 'hidden' : 'shown';
    if (!hidden) parentId = parents[0];
  }
  const family = s.family.all(leaf.session_pk).map((r) => String(r.node_id));
  const shown = displayPrefixes([...family, String(leaf.node_id), ...(parentId === null ? [] : [parentId])]);
  let line;
  try {
    line = cardLine({ leaf: shown.get(String(leaf.node_id)), parent: parentId === null ? null : shown.get(parentId) });
  } catch (e) {
    if (e instanceof TypeError) return reconDiscard('card-unrenderable');
    throw e;
  }
  return { state: 'card', line, leafId: String(leaf.node_id), parentId, parent };
}

/** The carded payload (ruling Q20; spec §10.2 "Two arms"): the card line, one blank line, then the plain payload,
 *  unchanged. Pure.
 *  @param {string} line  @param {string} payload  @returns {string} */
export function prependCard(line, payload) {
  return `${line}\n\n${payload}`;
}

/** Boundary N's two payloads for one question (W2-D75; ruling Q20): `plain`, W2-5a's reconstructPayload text unchanged,
 *  and `carded`, prependCard over the card line and `plain`. A reconstruction or card discard answers its RECON_DISCARDS
 *  word, which the arm engine answers before any spawn. `cut` is the cut at N: armCut's, or recheckQuestion's verdict's.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId  @param {string} question  @param {{ boundaryEntryId: number }} cut */
export function armPayloads(rs, boundaryEntryId, question, cut) {
  const p = reconstructPayload(rs, boundaryEntryId, question);
  if (p.state !== 'payload') return p;
  const card = cardOf(rs, boundaryEntryId, cut);
  if (card.state !== 'card') return card;
  return { state: 'payloads', plain: p.text, carded: prependCard(card.line, p.text), card, counts: p.counts };
}

/** Boundary N's candidates mined from the store (W2-D65): leaf N's span (spanRowsOf), N's epoch's cwd and cwd_real (the
 *  path facts' base, through derive.mjs's epochOfUuid), and mineBoundary over expand's own body pick (W2-D74). The one
 *  composition sourceQuiz and the arm-batch re-check share. A span or mining discard answers its RECON_DISCARDS word.
 *  @param {ReplayStore} rs
 *  @param {{ entry_id: number, uuid: string, ts_ms: number | null, transcript_pk: number }} b  boundary N
 *  @param {{ ccrc_id: string, generation: string }} family
 *  @param {readonly string[]} configDirs  the roster's config dirs (rosterConfigDirs)
 *  @returns {{ state: 'mined', mined: MinedBoundary, spanEntryIds: number[] } | { state: 'discard', why: string }} */
export function mineStoredBoundary(rs, b, family, configDirs) {
  const span = spanRowsOf(rs, b.entry_id);
  if (span.state !== 'span') return span;
  const s = sourceStmts(rs.db);
  const t = s.transcript.get(b.transcript_pk);
  const ep = t === undefined ? null : epochOfUuid(rs.db, t.cc_session_uuid);
  const e = ep === null ? undefined : s.epoch.get(ep.session_pk, ep.seq);
  const m = mineBoundary({
    storeId: rs.storeId, ccrcId: family.ccrc_id, generation: family.generation, boundaryUuid: b.uuid, boundaryTsMs: b.ts_ms,
    rows: span.rows, pick: (row) => expandEntryBody(rs, row), cwd: e?.cwd ?? null, cwdReal: e?.cwd_real ?? null, configDirs,
  });
  if (m.state !== 'mined') return reconDiscard(m.why);
  return { state: 'mined', mined: m, spanEntryIds: span.rows.map((r) => Number(r.entry_id)) };
}

/** W2-D78(iii) for one frozen question (ruling Q21), its clauses in order, the first that fails answered:
 *  (a) boundary N's candidate, re-mined (mineStoredBoundary) and matched on kind, F and F_raw, passes screenRedaction
 *      under the run's pair index: `why` is the screen's word, a span or mining discard's word, `boundary-uuid-invalid`
 *      (a frozen uuid that is not a lowercase UUID), `boundary-absent` or `fact-unmined`;
 *  (b) some source in leaf N's span passes W2-D70's four clauses at N's own ts_ms (answerability): `unanswerable`,
 *      `unanswerable-untimed` (clause 4 alone, D-5780) or `boundary-untimed`;
 *  (c) the frozen source_entry_uuid is visible under the cut at boundary_uuid (armCut, then lib's asOfVisibleEntriesSql;
 *      a sidecar source is its linked row, W2-D35): the cut's own `asof-invalid`, `source-absent` or `source-hidden`.
 *  A clean question answers N's entry id and the cut, which armPayloads takes. A question of another store is a defect.
 *  @param {ReplayStore} rs  @param {FrozenEntry} entry  @param {{ configDirs: readonly string[] }} ctx
 *  @returns {Promise<{ ok: true, boundaryEntryId: number, cut: object } | { ok: false, clause: 'a' | 'b' | 'c', why: string }>} */
export async function recheckQuestion(rs, entry, { configDirs }) {
  if (entry.store_id !== rs.storeId) {
    throw new TypeError(`recheckQuestion: question ${String(entry.qid)} is store ${String(entry.store_id)}'s, not this store's`);
  }
  const s = armStmts(rs.db);
  const fail = (clause, why) => ({ ok: false, clause, why });
  // W2-D50: boundary N's uuid becomes the arm's CCRC_RECALL_ASOF, which spawnEnv refuses as a defect unless UUID_RE
  // holds; a frozen uuid that is not one is data, answered here before any spawn, never a TypeError after --out.
  if (typeof entry.boundary_uuid !== 'string' || !UUID_RE.test(entry.boundary_uuid)) return fail('a', 'boundary-uuid-invalid');
  const row = s.boundary.get(entry.boundary_uuid);
  if (row === undefined) return fail('a', 'boundary-absent');
  const b = { entry_id: Number(row.entry_id), uuid: row.uuid, ts_ms: row.ts_ms === null ? null : Number(row.ts_ms), transcript_pk: Number(row.transcript_pk) };
  const got = mineStoredBoundary(rs, b, entry, configDirs);
  if (got.state !== 'mined') return fail('a', got.why);
  const c = got.mined.candidates.find((x) => x.kind === entry.kind && x.fact === entry.fact && x.fact_raw === entry.fact_raw);
  if (c === undefined) return fail('a', 'fact-unmined');
  const screened = screenRedaction(c, rs.idx);
  if (screened !== null) return fail('a', screened);
  if (b.ts_ms === null) return fail('b', 'boundary-untimed');
  const a = await answerability(rs.db, rs.idx, { tsMs: b.ts_ms, transcriptPk: b.transcript_pk, spanEntryIds: got.spanEntryIds }, entry.fact_raw);
  if (a.state !== 'answerable') return fail('b', a.state === 'untimed' ? 'unanswerable-untimed' : 'unanswerable');
  const cut = armCut(rs, entry.boundary_uuid);
  if (!cut.ok) return fail('c', cut.reason);
  const src = s.entryId.get(entry.source_entry_uuid);
  if (src === undefined) return fail('c', 'source-absent');
  const visible = s.visible.all({ ...asOfBinds(cut.cut), asof_entries: JSON.stringify([Number(src.entry_id)]) });
  if (visible.length === 0) return fail('c', 'source-hidden');
  return { ok: true, boundaryEntryId: b.entry_id, cut: cut.cut };
}

/** W2-D78(iii) over one batch's questions, in batch order (ruling Q21). Every question is re-checked; when any fails, the
 *  batch refuses quiz-unanswerable before any spawn, naming each failing qid and its clause (`<qid> clause (<a|b|c>)
 *  <why>`, joined by `; `). A clean batch answers each question's verdict by qid. It reads only, and spawns nothing.
 *  @param {ReplayStore} rs  @param {readonly FrozenEntry[]} entries  @param {{ configDirs: readonly string[] }} ctx
 *  @returns {Promise<Map<string, { ok: true, boundaryEntryId: number, cut: object }>>} */
export async function recheckBatch(rs, entries, ctx) {
  const passed = new Map();
  const failed = [];
  for (const e of entries) {
    const v = await recheckQuestion(rs, e, ctx);
    if (v.ok) passed.set(e.qid, v);
    else failed.push(`${e.qid} clause (${v.clause}) ${v.why}`);
  }
  if (failed.length > 0) refuse('quiz-unanswerable', failed.join('; '));
  return passed;
}

// ── W2-5b1 Task 3: marker, verify --section pilot|quiz, and the headless-on reader (W2-D84, W2-D76, W2-D78 (i), W2-D24; D-5781) ──
// marker --record <draft|final> --section pilot|quiz|ab --node-label <label> prints ONE node's text, writing nothing
// (W2-D84). It reads the record and nothing else: no HOME, no store, no spawn.
//   pilot  the headless-on marker listing exactly part 1's pilot.families on that node's store (W2-D76, D-5781);
//   quiz   the headless-on marker listing exactly part 2's quiz.families on that node's store;
//   ab     one `ccrc history recall-off <id> --generation <G>` line per control family on that node's store; the
//          generation is always printed, because the W2 flow writes no legacy control file (W2-D27).
// Its text goes to stdout, so `> file` holds the marker's exact bytes, and `sha256 <hex>` of those bytes goes to
// stderr. The marker text is lib's formatHeadlessList, the one producer of it, over the pairs in familyKey order.
// Its TypeError (a grammar fault) and RangeError (a bound: for long ids 65,536 bytes binds before 1,000 pairs) are
// record-invalid, the word D-6309 gives a record the gate signs and the driver cannot run. A store holding no family
// of the section has no marker (input-invalid).
// verify --section pilot|quiz runs read-only on a node (W2-D84): the local store is one of the record's nodes, the
// marker is read once (readHeadlessOn), and the sha256 of what was read is held to the sha256 of the text marker
// prints for this store. Every other answer is its own state, never folded (HEADLESS_ON_STATES). --section quiz also
// counts the leaves lib's node rule hides under the stated all-visible cut (ALL_VISIBLE_CUT): D-6284's over-hide on
// this node (Q16). The arm preflight's W2-D78 (i) is requireListed, over the same reader; Task 4 composes it.
// W2-D24: both re-check the code they run under right after the record validates. Neither declares
// --allow-code-change (Q23 grants it to arms, judge and report only). Neither has --out.
// O13 and W2-D44: the marker is reached only as historyPaths(home).headlessOn, on readHeadlessOn's one line, a read
// through store.mjs's readBounded at HEADLESS_LIST_MAX_BYTES that never follows a link. No line spells the marker's
// path text, and no line pairs a write verb with that field; history-replay.test.ts pins all three.

/** marker's sections (W2-D84). */
export const MARKER_SECTIONS = Object.freeze(['pilot', 'quiz', 'ab']);
export const VERIFY_HEADLESS_KIND = 'ccrc-history-w2-verify-headless';
/** verify --section pilot|quiz's answers for the marker, never folded (W2-D84: "each mismatch kind is reported").
 *  `absent`, `unreadable` (a directory, a link, any other failure) and `over-cap` are readBounded's own; `malformed` is
 *  parseHeadlessList's refusal; `store-other` a store line naming another store; `pairs-differ` a pair missing or extra;
 *  `bytes-differ` the same pairs in other bytes (a comment, another order, a duplicate, no final newline). */
export const HEADLESS_ON_STATES = Object.freeze(['ok', 'absent', 'unreadable', 'over-cap', 'malformed', 'store-other', 'pairs-differ', 'bytes-differ']);
/** The stated all-visible cut of Q16, as lib's asOfBinds turns it into binds: every timed row is shown (ts_ms at most
 *  Number.MAX_SAFE_INTEGER), no copy's later rows are hidden (file -1 holds nothing), no boundary or summary is exempt
 *  (entry -1, null), and no kept member is added. A NULL ts_ms is never shown under any cut (D-5766), so the count is
 *  D-6284's over-hide plus any leaf whose boundary or summary row is untimed. */
export const ALL_VISIBLE_CUT = Object.freeze({ asof: 'all-visible', tsCut: Number.MAX_SAFE_INTEGER, boundaryEntryId: -1, summaryEntryId: null,
  keptUuids: Object.freeze([]), holdingFileId: -1, boundaryLine: -1 });
/** R10: the most hidden leaf ids verify --section quiz lists; the count beside them is always the total. */
export const OVER_HIDE_IDS_MAX = 1000;

/** One marker pair as its line reads (W2-D44): `<ccrc_id> <generation>`, `-` for the legacy one. */
const markerLine = (p) => `${p.ccrcId} ${p.generation === '' ? '-' : p.generation}`;
/** @param {{ccrc_id: string, generation: string}} f */
const familyMarkerLine = (f) => markerLine({ ccrcId: f.ccrc_id, generation: f.generation });

/** The pairs a section's marker lists on one store, in familyKey order by code unit (byFamilyKey): part 1's
 *  pilot.families for the pilot (W2-D76, D-5781), part 2's quiz.families (the frozen list's, validator-held) for the
 *  quiz. A store holding none has no marker: input-invalid, never a bare store line the seam reads as unlisted.
 *  @param {any} record  @param {'pilot' | 'quiz'} section  @param {string} storeId
 *  @returns {Array<{ccrcId: string, generation: string}>} */
export function headlessPairsOf(record, section, storeId) {
  const families = section === 'pilot' ? record.pilot.families : record.quiz.families;
  const pairs = families.filter((f) => f.store_id === storeId).sort(byFamilyKey).map((f) => ({ ccrcId: f.ccrc_id, generation: f.generation }));
  if (pairs.length === 0) refuse('input-invalid', `${section} lists no family on store ${storeId}: that node has no headless-on marker`);
  return pairs;
}
/** The marker text for one store: lib's formatHeadlessList, its errors as record-invalid (D-6309's word).
 *  @param {any} record  @param {'pilot' | 'quiz'} section  @param {string} storeId  @returns {string} */
export function headlessTextOf(record, section, storeId) {
  const pairs = headlessPairsOf(record, section, storeId);
  try {
    return formatHeadlessList({ storeId, pairs });
  } catch (e) {
    if (!(e instanceof TypeError) && !(e instanceof RangeError)) throw e;
    return refuse('record-invalid', `${section} marker for store ${storeId} cannot be formatted: ${e.name}: ${e.message}`);
  }
}
/** ab's lines for one store: each control family's command with its generation (W2-D27), in familyKey order, or ''.
 *  An id idOk refuses, or a generation that is not a UUID, is never printed as a shell line.
 *  @param {any} record  @param {string} storeId  @returns {string} */
export function abCommandsOf(record, storeId) {
  return record.assignment.filter((a) => a.store_id === storeId && a.arm === CONTROL_ARM).sort(byFamilyKey).map((a) => {
    if (!idOk(a.ccrc_id) || !UUID_RE.test(a.generation)) refuse('record-invalid', `ab family ${JSON.stringify(a.ccrc_id)} ${JSON.stringify(a.generation)} cannot be printed as a command`);
    return `ccrc history recall-off ${a.ccrc_id} --generation ${a.generation}\n`;
  }).join('');
}

/** The headless-on marker's one read in this file (W2-D44, W2-D84, W2-D78 (i)): store.mjs's readBounded at the
 *  marker's bound, never following a link, then lib's parseHeadlessList. Five answers, none folded into another:
 *  value (with the text and the parsed list), malformed (with the text), absent, over-cap and unreadable.
 *  @param {string} home */
export function readHeadlessOn(home) {
  const read = readBounded(historyPaths(home).headlessOn, HEADLESS_LIST_MAX_BYTES, false);
  if (read.state === 'absent' || read.state === 'over-cap') return { state: read.state };
  if (read.state !== 'value') return { state: 'unreadable' };
  const list = parseHeadlessList(read.value);
  return list.ok ? { state: 'value', text: read.value, list } : { state: 'malformed', text: read.value };
}
/** The marker against the text marker prints for this store (W2-D84), pure. `ok` is the sha256 comparison alone. The
 *  sha256 is the text's as read: for a marker that is valid UTF-8 that is its bytes' sha256; one holding an invalid
 *  byte reads with U+FFFD (D-5768), which formatHeadlessList's text never holds, so it is malformed and never ok.
 *  @param {ReturnType<typeof readHeadlessOn>} read  @param {string} expected  @param {string} storeId */
export function headlessStateOf(read, expected, storeId) {
  const sha = read.text === undefined ? null : sha256Hex(read.text);
  const none = { sha256: sha, missing: [], extra: [] };
  if (read.state !== 'value') return { state: read.state, ...none };
  if (sha === sha256Hex(expected)) return { state: 'ok', ...none };
  if (read.list.storeId !== storeId) return { state: 'store-other', ...none };
  const want = parseHeadlessList(expected);
  if (!want.ok) throw new TypeError('headlessStateOf: the expected text does not parse; formatHeadlessList never prints such a text');
  const wanted = want.pairs.map(markerLine);
  const got = new Set(read.list.pairs.map(markerLine));
  const missing = wanted.filter((l) => !got.has(l));
  const extra = [...got].filter((l) => !wanted.includes(l)).sort();
  return { state: missing.length + extra.length > 0 ? 'pairs-differ' : 'bytes-differ', sha256: sha, missing, extra };
}

/** W2-D78 (i), pure: why a batch is unlisted, or null. Fail closed: every answer but a parsed value is unlisted; the
 *  store line must be this store; each (ccrc_id, generation) must be a listed pair, by id AND generation.
 *  @param {ReturnType<typeof readHeadlessOn>} read  @param {string} storeId
 *  @param {Array<{store_id: string, ccrc_id: string, generation: string}>} families  @returns {string | null} */
export function unlistedOf(read, storeId, families) {
  if (read.state !== 'value') return `headless-on ${read.state}`;
  if (read.list.storeId !== storeId) return `headless-on names store ${read.list.storeId}, not this store ${storeId}`;
  const listed = new Set(read.list.pairs.map(markerLine));
  const missing = families.filter((f) => f.store_id !== storeId || !listed.has(familyMarkerLine(f)));
  return missing.length === 0 ? null : `not listed for store ${storeId}: ${missing.map(familyMarkerLine).join(', ')}`;
}
/** W2-D78 (i), the arm preflight's read: refuses family-unlisted unless every batch pair is on this store's marker.
 *  Read-only, before any spawn; Task 4 calls it before every arm batch.
 *  @param {string} home  @param {string} storeId  @param {Array<{store_id: string, ccrc_id: string, generation: string}>} families */
export function requireListed(home, storeId, families) {
  const why = unlistedOf(readHeadlessOn(home), storeId, families);
  if (why !== null) refuse('family-unlisted', why);
}

/** D-6284's over-hide on this node (Q16, R10): every leaf of the store, bound as one JSON array to lib's node rule
 *  (asOfHiddenNodesSql, through Task 2's prepared armStmts statement, so the rule is named on one line) under
 *  asOfBinds(ALL_VISIBLE_CUT). The total is always given; the ids listed are the first `max`, sorted. Read-only; nothing
 *  gates on it. An SQLite failure is store-unreadable (storeRefusal), never an internal error.
 *  @param {{prepare: (sql: string) => {all: (...a: any[]) => any[]}}} db  @param {number} [max] */
export function overHideOf(db, max = OVER_HIDE_IDS_MAX) {
  try {
    const ids = db.prepare("SELECT node_id FROM nodes WHERE kind <> 'condensed' ORDER BY node_id").all().map((r) => String(r.node_id));
    const binds = asOfBinds(ALL_VISIBLE_CUT);
    const hidden = ids.length === 0 ? [] : armStmts(db).hidden.all({ ...binds, asof_nodes: JSON.stringify(ids) }).map((r) => String(r.node_id)).sort();
    return { cut: 'all-visible', binds, leaves: ids.length, hidden: hidden.length, hidden_ids: hidden.slice(0, max), hidden_ids_max: max };
  } catch (e) {
    return storeRefusal(e);
  }
}

export function verifyHeadlessReport({ recordSha256, storeId, section, expectedSha256, found, overHide }) {
  return { kind: VERIFY_HEADLESS_KIND, v: 1, record_sha256: recordSha256, store_id: storeId, section, expected_sha256: expectedSha256,
    found, ok: found.state === 'ok', over_hide: overHide };
}

/** Text on stdout as it is, `sha256 <hex>` of exactly those bytes on stderr (W2-D84: the content plus its sha256). */
function printTextWithSha(text) {
  process.stdout.write(text);
  process.stderr.write(`sha256 ${sha256Hex(text)}\n`);
  return EXIT.OK;
}

/** `marker --record <draft|final> --section pilot|quiz|ab --node-label <label>` (W2-D84). The section is checked before
 *  its form's flags; the record validates, then the code it runs under (W2-D24); then the node is looked up by label.
 *  @param {Flags} flags  @returns {Promise<number>} */
export async function markerCommand(flags) {
  const section = flags.section;
  if (section === undefined) refuse('args-invalid', 'section-required');
  if (typeof section !== 'string' || !MARKER_SECTIONS.includes(section)) refuse('args-invalid', `section ${JSON.stringify(section)}: marker prints ${MARKER_SECTIONS.join(', ')}`);
  checkFlags(`marker --section ${section}`, flags);
  const labels = /** @type {string[]} */ (flags['node-label']);
  if (labels.length !== 1) refuse('args-invalid', `marker prints one node: --node-label given ${labels.length} times`);
  const rec = loadRecordInput(flags, section === 'pilot' ? 'draft' : 'final');
  recheckCode(rec.record);   // W2-D24 (marker)
  const node = rec.record.nodes.find((n) => n.label === labels[0]);
  if (node === undefined) refuse('args-invalid', `node-label ${JSON.stringify(labels[0])} names no node of the record`);
  return printTextWithSha(section === 'ab' ? abCommandsOf(rec.record, node.store_id) : headlessTextOf(rec.record, section, node.store_id));
}

/** `verify --section pilot|quiz` (W2-D84), read-only on this node: the record validates, then the code (W2-D24), then
 *  the run's one store open (W2-5a's R3) names this node, which must be one of the record's. */
async function verifyHeadless(section, flags, env) {
  checkFlags(`verify --section ${section}`, flags);
  const home = subcommandHome(env);
  const rec = loadRecordInput(flags, section === 'pilot' ? 'draft' : 'final');
  recheckCode(rec.record);   // W2-D24 (verify --section pilot|quiz)
  const rs = openReplayStore(home);
  try {
    const storeId = rs.storeId;
    requireNamedNode(rec.record, storeId);
    const expected = headlessTextOf(rec.record, section, storeId);
    const found = headlessStateOf(readHeadlessOn(home), expected, storeId);
    const overHide = section === 'quiz' ? overHideOf(rs.db) : null;
    return printWithSha(verifyHeadlessReport({ recordSha256: rec.sha256, storeId, section, expectedSha256: sha256Hex(expected), found, overHide }));
  } finally {
    rs.close();
  }
}

HANDLERS.set('marker', markerCommand);

// ── W2-5b1 Task 4: the arm engine, `arms --section pilot|quiz` (W2-D78, W2-D80, W2-D56, W2-D55, W2-D64, W2-D82; S1, Q2 to Q5, Q14, Q23 to Q26, Q30, Q31) ──
// One subcommand, run per node in that node's own --out (Q2):
//   arms --section pilot   after part 1, on the pilot node, over the pilot frozen list's usage questions, under part 1's
//                          pilot_budget, limits, account, arm_model and settings_mode (W2-D55, W2-D76);
//   arms --section quiz    after part 2, on each named node, over the quiz questions on this node's store, under this
//                          node's share of spend_budget (Q5) and part 2's pilot_result.settings_mode (Q26).
// Both arms of each question run side by side, at the record's limits.concurrency, limits.batch_max / 2 questions per
// batch, in frozen qid order (Q3); batches loop inside one invocation, and armBatchPreflight, W2-D78's and W2-D56's checks
// composed once, runs before each. A run's attempt is in its name (`<section>/arms/<qid>/<arm>.a<n>`, Q4). A recorded run
// (its run.json written, W2-4) is classified by the gate's classifyRun over its stream's events, spawned and not stopped
// (a driver timeout has no result event: infra-failed); an arm's outcome is the gate's questionOutcome over its recorded
// attempts, and a question's is questionStateOf over its arms. A stop writes no run.json, so a stopped attempt is never an
// attempt: it keeps its number and is resumed, never consuming the re-run (W2-D80, Q24). Each batch writes a manifest
// before it spawns (Q14); each settled question writes one answer record per arm (W2-D82, W2-D64); the summary is
// rewritten after the last batch and on any refusal once --out is claimed, with the stop's word, its kind (Task 1's
// DRIVER_STOPS partition) and the not-run count, and one stderr line says so (Q30). Nothing is retried automatically.
// Every refusal that needs no spawn answers before prepareOut makes --out (W2-5a's R10, D-6307, D-6311, D-6309's rule).
// The run's loader, node values and answer reader (loadArmRun, armNodeOf, readArmAnswers), the no-spawn admission
// (refuseSpawnAdmission) and the spawn preflight (preflightSpawn) are shared with W2-5b1 Task 5's judge (R8, R26).
// The arm words are never spelled here: every per-arm value is keyed by RECALL_ARMS' members at run time (W2-D42).

/** The two sections an arm batch runs over (W2-D76, W2-D77). */
export const ARM_SECTIONS = Object.freeze(['pilot', 'quiz']);
/** W2-D80: one run and one re-run; a second infrastructure failure makes the arm run-failed. */
export const ARM_ATTEMPTS_MAX = 2;
/** The per-batch manifest (Q14), the per-(qid, arm) answer record (W2-D82) and the summary (Q30). */
export const ARM_BATCH_KIND = 'ccrc-history-w2-arm-batch';
export const ANSWER_KIND = 'ccrc-history-w2-answer';
export const ARMS_SUMMARY_KIND = 'ccrc-history-w2-arms-summary';
/** D-6482: the reason an owed arm is excluded as run-failed when its answered sibling's payload, as built now, is no longer the
 *  one the sibling answered: a report word on the answer record and the summary, never a DRIVER_REASONS word and never an
 *  arm state. Spelled here once. */
export const ARM_PAYLOAD_CHANGED = 'arm-payload-changed';
const ARM_BATCH_FILE_RE = /^[0-9]{4}\.json$/;
/** questionCountsOf's key for each of the gate's QUESTION_OUTCOMES. */
const QUESTION_COUNT_KEYS = Object.freeze({ answered: 'answered', 'run-failed': 'run_failed', rerun: 'rerun_owed', 'not-run': 'not_run' });

function armSectionOk(who, section) {
  if (!ARM_SECTIONS.includes(section)) throw new TypeError(`${who}: section ${JSON.stringify(section)} is not one of ${ARM_SECTIONS.join(', ')}`);
}
function armOk(who, arm) {
  if (!RECALL_ARMS.includes(arm)) throw new TypeError(`${who}: ${JSON.stringify(arm)} is not a RECALL_ARMS member`);
}
/** One arm run's name under --out (Q4): the attempt is part of it, so a re-run never overwrites the run it re-runs.
 *  @param {string} section  @param {string} qid  @param {string} arm  @param {number} attempt  @returns {string} */
export function armRunName(section, qid, arm, attempt) {
  armSectionOk('armRunName', section);
  armOk('armRunName', arm);
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > ARM_ATTEMPTS_MAX) throw new TypeError(`armRunName: attempt ${String(attempt)} is not 1 to ${ARM_ATTEMPTS_MAX}`);
  return `${section}/arms/${qid}/${arm}.a${attempt}`;
}
/** One (qid, arm)'s answer record under --out (W2-D82).  @returns {string} */
export function answerRel(section, qid, arm) {
  armSectionOk('answerRel', section);
  armOk('answerRel', arm);
  return `${section}/answers/${qid}.${arm}.json`;
}
/** The section's summary under --out (Q30).  @returns {string} */
export function armsSummaryRel(section) {
  armSectionOk('armsSummaryRel', section);
  return `${section}/arms/summary.json`;
}
const armBatchDir = (section) => `${section}/arms/batches`;

// ── pure ──
/** Q5: this node's share of part 2's spend_budget, ceil(budget × nNode / nAll), in integers (BigInt), so the share is
 *  exact for any safe budget. The share is at most the budget, so it is a safe integer. Pure.
 *  @param {number} budget  @param {number} nNode this node's questions  @param {number} nAll the frozen list's  @returns {number} */
export function spendShareOf(budget, nNode, nAll) {
  for (const [k, v] of [['budget', budget], ['nNode', nNode], ['nAll', nAll]]) {
    if (!Number.isSafeInteger(v) || v < 1) throw new TypeError(`spendShareOf: ${k} ${String(v)} is not a positive safe integer`);
  }
  if (nNode > nAll) throw new TypeError(`spendShareOf: ${nNode} questions of ${nAll}`);
  return Number((BigInt(budget) * BigInt(nNode) + BigInt(nAll) - 1n) / BigInt(nAll));
}

/** W2-D80: a question's state from its arms' outcomes (each the gate's questionOutcome over that arm's attempts). A
 *  run-failed arm fails the question, which is then excluded from both arms; both arms answered answer it; an owed re-run
 *  leaves it `rerun`; anything else is `not-run` (Q24's emergent rule). Pure.
 *  @param {readonly string[]} armStates  @returns {'answered' | 'rerun' | 'run-failed' | 'not-run'} */
export function questionStateOf(armStates) {
  if (!Array.isArray(armStates) || armStates.length === 0) throw new TypeError('questionStateOf: one outcome per arm');
  for (const s of armStates) if (!QUESTION_OUTCOMES.includes(s)) throw new TypeError(`questionStateOf: ${String(s)} is not a question outcome`);
  if (armStates.includes('run-failed')) return 'run-failed';
  if (armStates.every((s) => s === 'answered')) return 'answered';
  return armStates.includes('rerun') ? 'rerun' : 'not-run';
}

/** The summary's counts over questionStateOf's answers (Q30). Pure.
 *  @param {readonly string[]} states  @returns {{questions: number, answered: number, run_failed: number, rerun_owed: number, not_run: number}} */
export function questionCountsOf(states) {
  const c = { questions: states.length, answered: 0, run_failed: 0, rerun_owed: 0, not_run: 0 };
  for (const s of states) {
    const k = QUESTION_COUNT_KEYS[s];
    if (k === undefined) throw new TypeError(`questionCountsOf: ${String(s)} is not a question outcome`);
    c[k] += 1;
  }
  return c;
}

/** A recorded run's stream as the parsed events classifyRun reads: every line that is a JSON object, in order; any other
 *  line is skipped (readStreamJson counts it). Never throws. Pure.  @param {string} text  @returns {object[]} */
export function streamEventsOf(text) {
  const events = [];
  for (const line of String(text).split('\n')) {
    if (line.trim() === '') continue;
    try {
      const ev = JSON.parse(line);
      if (plainObject(ev)) events.push(ev);
    } catch {
      // not an event: readStreamJson's malformedLines
    }
  }
  return events;
}

/** Q31: every string `error` field the run's events carried, once each, sorted. Pure.  @param {object[]} events  @returns {string[]} */
export function errorFieldsOf(events) {
  return [...new Set(events.filter((e) => typeof e.error === 'string').map((e) => e.error))].sort();
}

/** W2-D82: an uptake call is a Bash tool_use whose command lib's isHistoryCommand reads as `ccrc history`, paired by id
 *  with a tool_result that is not is_error. One inside an Agent subagent (Task 1's parentToolUseId) counts, and is also
 *  counted as via_agent. A history call whose result is is_error is `errored` (the control arm's exit 8, which the pilot
 *  measures, W2-D82), never a call. A tool_use with no tool_result paired is neither. Pure.
 *  @param {ReadonlyArray<{name: string, input: unknown, result: string | null, isError: boolean | null, parentToolUseId: string | null}>} toolPairs
 *  @returns {{calls: number, via_agent: number, errored: number}} */
export function uptakeOf(toolPairs) {
  let calls = 0;
  let viaAgent = 0;
  let errored = 0;
  for (const p of toolPairs) {
    if (p.name !== 'Bash' || !plainObject(p.input) || typeof p.input.command !== 'string' || !isHistoryCommand(p.input.command)) continue;
    if (p.result === null && p.isError === null) continue;   // no tool_result paired by id
    if (p.isError === true) { errored += 1; continue; }
    calls += 1;
    if (typeof p.parentToolUseId === 'string') viaAgent += 1;
  }
  return { calls, via_agent: viaAgent, errored };
}

/** One answered run's answer (W2-D64): the gate's parseAnswerField over the result text, labelCorrect on a `value` only
 *  (W2-D63), the absent state kept apart for the absent rate, the reply as the run gave it (the judge redacts it, W2-D79),
 *  and uptakeOf. Pure.
 *  @param {{kind: string, fact: string, repo_roots: string[]}} entry  @param {{result: {text: string | null} | null, toolPairs: object[]}} facts
 *  @param {7 | 40} shaMinPrefix */
export function armAnswerOf(entry, facts, shaMinPrefix) {
  const reply = facts.result === null ? null : facts.result.text;
  const answerField = parseAnswerField(reply ?? '');
  const correct = answerField.state === 'value'
    && labelCorrect(entry.kind, entry.fact, answerField.value, { repoRoots: entry.repo_roots, shaMinPrefix });
  return { answer_field: answerField, correct, absent: answerField.state === 'absent', reply, uptake: uptakeOf(facts.toolPairs) };
}

/** W2-D56's `expected` for this node: part 1's step 0a entry for its store (version, wrapper) and gate_code (stamp, code
 *  shas), with the version replaced by the node's newest version-move amendment when part 2 carries one (W2-D90; Q13's
 *  detail `{claude_code_version, repilot_sha256}`, node_label_ref required). Amendments are append-only, so the newest
 *  is the last in array order. A version-move naming no node, or whose detail holds no version, is a record the gate
 *  should not have signed: record-invalid, before --out, through W2-5b1 Task 1's versionMoveChecks and refuseRangeRows,
 *  the one spelling of those two ranges (R30, W2-D12), never a second one here. Pure.
 *  @param {Record<string, any>} record  @param {string} storeId */
export function expectedForNode(record, storeId) {
  const node = record.nodes.find((n) => n.store_id === storeId);
  const entry = record.step0a.find((s) => s.store_id === storeId);
  if (node === undefined || entry === undefined) refuse('input-invalid', `store ${storeId} is not one of the record's nodes`);
  refuseRangeRows(versionMoveChecks(record));   // R30: Task 1's one spelling of the version-move ranges (W2-D12)
  let version = entry.claude_code_version;
  let from = 'step0a';
  (record.amendments ?? []).forEach((a, i) => {
    if (a.kind !== VERSION_MOVE_KIND || a.node_label_ref !== node.label) return;
    version = a.detail.claude_code_version;
    from = `amendments[${i}]`;
  });
  return { expected: { claude_code_version: version, release_stamp: record.gate_code.release_tag, wrapper_sha256: entry.wrapper_sha256,
    code_shas: record.gate_code.files }, from };
}

/** The summary (Q30, W2-D64): the counts over every question, and per arm over the answered questions only (a run-failed
 *  question is excluded from both arms, W2-D80): the answer states, the correct count and uptake (W2-D82); the absent
 *  rate per arm as an exact {num, den}. Pure.
 *  @param {{section: string, recordSha256: string, storeId: string, budget: object, spend: number, batches: number,
 *    stop: {word: string, kind: string, detail: string} | null, stamps: Iterable<string>,
 *    questions: Array<{qid: string, state: string, arms: Array<{arm: string, answer: object | null}>}>,
 *    payloadChanged?: string[]}} o  `payloadChanged` (D-6482) are the qids excluded for a changed payload; the summary names
 *  their count and qids only when there are some. */
export function armsSummaryOf({ section, recordSha256, storeId, budget, spend, batches, stop, stamps, questions, payloadChanged = [] }) {
  const zero = () => ({ answered: 0, value: 0, unknown: 0, absent: 0, correct: 0, uptake_questions: 0, uptake_calls: 0, via_agent: 0, errored: 0 });
  const arms = Object.fromEntries(RECALL_ARMS.map((arm) => [arm, zero()]));
  for (const q of questions) {
    if (q.state !== 'answered') continue;
    for (const a of q.arms) {
      const s = arms[a.arm];
      s.answered += 1;
      s[a.answer.answer_field.state] += 1;
      if (a.answer.correct) s.correct += 1;
      if (a.answer.uptake.calls > 0) s.uptake_questions += 1;
      s.uptake_calls += a.answer.uptake.calls;
      s.via_agent += a.answer.uptake.via_agent;
      s.errored += a.answer.uptake.errored;
    }
  }
  return {
    kind: ARMS_SUMMARY_KIND, v: 1, section, record_sha256: recordSha256, store_id: storeId, budget, spend, batches, stop,
    stamps: [...stamps].sort(), counts: questionCountsOf(questions.map((q) => q.state)), arms,
    absent_rate: Object.fromEntries(RECALL_ARMS.map((arm) => [arm, { num: arms[arm].absent, den: arms[arm].answered }])),
    questions: questions.map((q) => ({ qid: q.qid, state: q.state })),
    // D-6482: the questions excluded for a changed payload, present only when there are some.
    ...(payloadChanged.length === 0 ? {} : { payload_changed: { count: payloadChanged.length, qids: [...payloadChanged] } }),
  };
}

// ── measuring and acting ──
/** The pilot frozen list (W2-D73) through W2-5a's loadFrozen (the git-tree rule, its sha before a byte is parsed, the
 *  canonical bytes), and its sha must be part 1's pilot.frozen_sha256 (W2-D76). */
function loadPilotFrozen(flags, record) {
  const fz = loadFrozen(flags.frozen, flags['frozen-sha256'], 'pilot');
  if (fz.sha256 !== record.pilot.frozen_sha256) refuse('quiz-sha-mismatch', `frozen ${fz.sha256} is not the record's pilot.frozen_sha256 ${record.pilot.frozen_sha256}`);
  return fz;
}
/** This node's questions, in the frozen list's qid order (Q3). The pilot runs on its one node, so a pilot question on
 *  another store refuses; a node with no question has no arm batch to run. */
function nodeQuestions(section, entries, storeId) {
  const other = entries.find((e) => e.store_id !== storeId);
  if (section === 'pilot' && other !== undefined) refuse('input-invalid', `pilot question ${other.qid} is on store ${other.store_id}, not this node's ${storeId}`);
  const mine = entries.filter((e) => e.store_id === storeId);
  if (mine.length === 0) refuse('input-invalid', `the ${section} list holds no question on store ${storeId}`);
  return mine;
}
/** The arm run's inputs (R8, R26: the one loader `arms` and `judge` share), each refusal before any store, spawn or --out:
 *  quiz, Task 1's loadFinalRecord (the chain, W2-D24's re-check first with Q23's stamp after window start, the part 2
 *  ranges), the settings mode part 2's pilot_result.settings_mode (Q26); pilot, part 1 through loadRecordInput, its
 *  gate_code re-checked (recheckCode; the pilot forms take no --allow-code-change, Q23), then the pilot frozen list
 *  against part 1's pilot.frozen_sha256, the settings mode part 1's. Reads no store, spawns nothing, writes nothing.
 *  @param {Flags} flags  @param {'pilot' | 'quiz'} section  @param {{ nowMs: number }} o */
export function loadArmRun(flags, section, { nowMs }) {
  armSectionOk('loadArmRun', section);
  if (section === 'pilot') {
    const rec = loadRecordInput(flags, 'draft');
    const codeStamps = recheckCode(rec.record);   // W2-D24 (arms and judge --section pilot)
    const fz = loadPilotFrozen(flags, rec.record);
    if (!SETTINGS_MODES.includes(rec.record.settings_mode)) refuse('record-invalid', 'settings_mode out-of-range');
    return { section, record: rec.record, recordSha256: rec.sha256, frozen: fz, settingsMode: rec.record.settings_mode, allowCodeChange: false, codeStamps };
  }
  const rec = loadFinalRecord(flags, { nowMs });   // W2-D24 (arms and judge --section quiz)
  return { section, record: rec.record, recordSha256: rec.sha256, frozen: rec.frozen,
    settingsMode: rec.record.pilot_result.settings_mode,
    allowCodeChange: flags['allow-code-change'] === true, codeStamps: rec.stamps };
}

/** This node's values for an arm run (R26; Q2, Q5, W2-D56): the node named in the record (W2-D84's rule), this node's
 *  questions in frozen qid order, the budget in force (part 1's pilot_budget, or this node's share of spend_budget, Q5),
 *  W2-D56's expected values (expectedForNode), the account, the limits and the settings mode. Refuses before --out. */
export function armNodeOf(run, storeId) {
  const r = run.record;
  requireNamedNode(r, storeId);
  const questions = nodeQuestions(run.section, run.frozen.list.entries, storeId);
  const nAll = run.frozen.list.entries.length;
  const budget = run.section === 'pilot' ? r.pilot_budget : spendShareOf(r.spend_budget, questions.length, nAll);
  const { expected } = expectedForNode(r, storeId);
  return { questions, nAll, account: r.account, expected, budget, limits: r.limits, settingsMode: run.settingsMode };
}
/** One arm run (W2-D50): the family's id as CCRC_RECALL_SESSION, the arm, and boundary N as CCRC_RECALL_ASOF. */
function armJob(ctx, q, arm, attempt, stdin) {
  const job = { launch: ctx.launch, mode: 'arm', model: ctx.model, settingsMode: ctx.settingsMode,
    recall: { session: q.ccrc_id, arm, asof: q.boundary_uuid }, stdin, out: ctx.out, name: armRunName(ctx.section, q.qid, arm, attempt), lang: ctx.lang };
  return ctx.timeoutMs === undefined ? job : { ...job, timeoutMs: ctx.timeoutMs };
}
/** One arm's recorded attempts, each classified (W2-D80), its outcome and the attempt it owes next (null when settled).
 *  A recorded run is W2-4's finishedOutcome, which refuses a run recorded for another account, model or settings mode,
 *  or a changed stream; its exit code must be an integer or null, or classifyRun would throw (D-6309's rule). */
function armAttemptsOf(ctx, q, arm) {
  const attempts = [];
  for (let n = 1; n <= ARM_ATTEMPTS_MAX; n += 1) {
    const job = armJob(ctx, q, arm, n, '');
    const done = finishedOutcome(job);
    if (done === null) break;
    if (!(done.code === null || Number.isInteger(done.code))) refuse('out-refused', `run-json-invalid ${job.name}`);
    const read = readPlain(done.streamPath, OUT_STREAM_CAP);
    if (read.state !== 'bytes') refuse('out-refused', `run-stream-changed ${job.name}`);
    const events = streamEventsOf(read.bytes.toString('utf8'));
    const cls = classifyRun(events, done.code, { spawned: true, stopped: false });
    attempts.push({ name: job.name, class: cls, code: done.code, signal: done.signal ?? null, tokens: done.tokens, errorFields: errorFieldsOf(events), facts: done.facts });
    if (cls === 'answered') break;
  }
  const state = questionOutcome(attempts.map((t) => t.class));
  if (state === 'not-run' || state === 'rerun') {
    // D-6482: an arm excluded for a changed payload has its record (with the reason) already, and owes nothing.
    const reason = excludedReasonOf(ctx, q, arm);
    if (reason !== null) return { attempts, state: 'run-failed', next: null, reason };
  }
  return { attempts, state, next: state === 'not-run' || state === 'rerun' ? attempts.length + 1 : null };
}
/** D-6482: the reason an arm's answer record carries, when it carries `arm-payload-changed` (null when there is no record, or
 *  an ordinary one). Anything at the record's path that is not a regular file, or is not JSON, refuses `out-refused`. */
function excludedReasonOf(ctx, q, arm) {
  const rel = answerRel(ctx.section, q.qid, arm);
  const st = lstatOrNull(ctx.out, rel);
  if (st === null) return null;
  if (!st.isFile()) refuse('out-refused', `${rel} is not a regular file`);
  const read = readPlain(path.join(ctx.out, rel), OUT_JSON_CAP);
  if (read.state !== 'bytes') refuse('out-refused', `${rel} ${read.state === 'bad' ? badWord(read) : read.state}`);
  let r;
  try {
    r = JSON.parse(read.bytes.toString('utf8'));
  } catch {
    refuse('out-refused', `${rel} is not JSON`);
  }
  return plainObject(r) && r.kind === ANSWER_KIND && r.reason === ARM_PAYLOAD_CHANGED ? ARM_PAYLOAD_CHANGED : null;
}
const answeredAttempt = (a) => a.attempts.find((t) => t.class === 'answered') ?? null;
/** One question's arms, its state, and the (arm, attempt) jobs it owes; a settled question owes none (a run-failed one
 *  is excluded from both arms, so its other arm's owed re-run is never spawned, W2-D80). */
function questionArmsOf(ctx, q) {
  const arms = RECALL_ARMS.map((arm) => ({ arm, ...armAttemptsOf(ctx, q, arm) }));
  const state = questionStateOf(arms.map((a) => a.state));
  const settled = state === 'answered' || state === 'run-failed';
  return { q, arms, state, next: settled ? [] : arms.filter((a) => a.next !== null).map((a) => ({ arm: a.arm, attempt: a.next })) };
}

/** W2-D78 and W2-D56 before one arm batch, composed once. Read-only first:
 *  (0) the store's pair index refreshed (D-6481, refreshPairIndex), so the re-check and the payloads below read the pairs the
 *      store holds now, both arms of every question from one index;
 *  (i) every batch family listed in headless-on for this store (Task 3's requireListed: family-unlisted);
 *  (ii) no batch family with a recall-off entry (W2-4's refuseRecallOff: family-recall-off);
 *  (iii) the batch's questions re-checked (Task 2's recheckBatch: quiz-unanswerable naming each failing qid and clause,
 *        over the roster's config dirs, R6), then each question's two payloads (Task 2's armPayloads, with the verdict's
 *        cut: plain to the control arm, carded to the treatment arm); a payload that no longer reconstructs refuses
 *        quiz-unanswerable `<qid> payload <word>`, never dropping the question (D-6469);
 *  then preflightSpawn (R26): the wrapper's sha, the gate (W2-D55: the budget, then the limits row), and the one spawn,
 *  `--version`, with W2-D56's preflight against ctx.expected. Answers each pending (qid, arm)'s stdin and the version. */
async function armBatchPreflight(ctx, pending) {
  const snapshots = maskingSnapshotsOf(ctx.rs, ctx.home);
  const qs = pending.map((s) => s.q);
  requireListed(ctx.home, ctx.storeId, familiesOf(qs));   // W2-D78 (i)
  refuseRecallOff(ctx.home, [...new Set(qs.map((q) => q.ccrc_id))]);   // W2-D78 (ii)
  let baseline = null;
  for (const snapshot of snapshots) {
    const view = { ...ctx.rs, idx: snapshot.idx };
    const verdicts = await ctx.deps.recheck(view, qs, { configDirs: ctx.configDirs });   // every retained reading must permit the full original batch
    const built = new Map();
    for (const s of pending) {
      const v = verdicts.get(s.q.qid);
      const p = ctx.deps.payloads(view, v.boundaryEntryId, s.q.question, v.cut);
      if (p.state !== 'payloads') refuse('quiz-unanswerable', `${s.q.qid} payload ${p.why}`);   // D-6469
      built.set(s.q.qid, new Map([[CONTROL_ARM, p.plain], [TREATMENT_ARM, p.carded]]));
    }
    if (baseline === null) { baseline = built; continue; }
    for (const s of pending) for (const arm of RECALL_ARMS) {
      if (!sameMaskingText(baseline.get(s.q.qid).get(arm), built.get(s.q.qid).get(arm))) refuse('input-invalid', 'masking-snapshots-disagree arms');
    }
  }
  const stdins = new Map();
  const kept = [];
  let shas = null;
  for (const s of pending) {
    const byArm = baseline.get(s.q.qid);
    // D-6482 runs only after all retained reads agreed; a disagreement never writes an exclusion.
    const answeredArm = s.arms.find((a) => a.state === 'answered');
    if (answeredArm !== undefined) {
      shas ??= armManifestShas(ctx);
      const won = answeredAttempt(answeredArm);
      const then = shas.get(won.name);
      if (then === undefined) refuse('out-refused', `arm-manifest-missing ${won.name}`);
      if (sha256Hex(byArm.get(answeredArm.arm)) !== then) { excludeOwedArms(ctx, s); continue; }
    }
    for (const { arm } of s.next) stdins.set(`${s.q.qid} ${arm}`, byArm.get(arm));
    kept.push(s);
  }
  if (kept.length === 0) return { stdins, version: null, pending: kept };
  const pre = await preflightSpawn({ launch: ctx.launch, home: ctx.home, out: ctx.out, lang: ctx.lang, gate: ctx.gate,
    expected: ctx.expected, allowCodeChange: ctx.allowCodeChange });
  for (const st of pre.stamps) ctx.stamps.add(st);
  return { stdins, version: pre.version, pending: kept };
}
/** D-6482: each planned run's stdin sha as the section's manifests recorded it, by run name; a run planned twice (a stopped
 *  attempt planned again, which keeps its number) reads from the last manifest that names it. An unreadable or non-JSON
 *  manifest refuses `out-refused` (D-6309's rule). */
function armManifestShas(ctx) {
  const rel = armBatchDir(ctx.section);
  const shas = new Map();
  if (lstatOrNull(ctx.out, rel) === null) return shas;
  let names;
  try {
    names = readdirSync(path.join(ctx.out, rel)).filter((n) => ARM_BATCH_FILE_RE.test(n)).sort();
  } catch (e) {
    refuse('out-refused', `${rel} unreadable ${errCode(e)}`);
  }
  for (const n of names) {
    const read = readPlain(path.join(ctx.out, rel, n), OUT_JSON_CAP);
    if (read.state !== 'bytes') refuse('out-refused', `${rel}/${n} ${read.state === 'bad' ? badWord(read) : read.state}`);
    let m;
    try {
      m = JSON.parse(read.bytes.toString('utf8'));
    } catch {
      refuse('out-refused', `${rel}/${n} is not JSON`);
    }
    if (!plainObject(m) || m.kind !== ARM_BATCH_KIND || !Array.isArray(m.runs)) refuse('out-refused', `${rel}/${n} is not an arm batch manifest`);
    for (const r of m.runs) if (plainObject(r) && typeof r.name === 'string' && typeof r.stdin_sha256 === 'string') shas.set(r.name, r.stdin_sha256);
  }
  return shas;
}
/** D-6482 (departing from W2-D80, where run-failed came only from two infrastructure failures): the question's owed arm is
 *  excluded as run-failed, its reason `arm-payload-changed`, and the question with it, so it is excluded from both arms
 *  under W2-D80's rule and counts in W2-D89's run-failed share. The owed arm's answer record is written here, at once (the
 *  record is what the next pass reads, so the arm is never spawned in a later pass); the answered sibling keeps its answer
 *  (R14) and its record is written by the next pass as a run-failed question's. No spawn, no re-run consumed. */
function excludeOwedArms(ctx, s) {
  const state = 'run-failed';
  ensurePlainDir(ctx.out, `${ctx.section}/answers`);
  for (const a of s.arms) {
    if (a.next === null) continue;
    const rel = answerRel(ctx.section, s.q.qid, a.arm);
    if (lstatOrNull(ctx.out, rel) !== null) refuse('out-refused', `${rel} already exists`);
    writePlain(ctx.out, rel, canonicalJson(answerRecordOf(ctx, { ...s, state }, { ...a, state, reason: ARM_PAYLOAD_CHANGED })) + '\n');
  }
  process.stderr.write(`ccrc history-replay: arms ${ctx.section} excluded ${s.q.qid}: ${ARM_PAYLOAD_CHANGED}\n`);
}

/** W2-D56's preflight before a spawn batch, the one spelling the writer (`openWriter`), the arms (armBatchPreflight) and
 *  the judge (`openJudge`) share (R26), in W2-D56's order: the wrapper's sha (`wrapper-unmeasured` before any spawn), the
 *  gate (W2-D55), the one `--version` spawn, the stop check, then `preflight` against `expected` (`claude-version-moved`,
 *  `tree-moved`, `wrapper-moved`, `code-changed` and the four unmeasured words; a measured code change is a stamp under
 *  `allowCodeChange`). Answers the measured version and the stamps.
 *  @returns {Promise<{ version: string, stamps: string[] }>} */
async function preflightSpawn({ launch, home, out, lang, gate, expected, allowCodeChange = false }) {
  const wrapperSha256 = wrapperSha(launch);   // wrapper-unmeasured before any spawn
  gate();
  const version = await measureClaudeVersion(launch, out, lang);
  refuseIfStopping();
  const verdict = preflight(expected, { version, stamp: readReleaseStamp(home), wrapperSha256, codeShas: codeShas() }, { allowCodeChange });
  if (!verdict.ok) refuse(verdict.word, verdict.detail);
  return { version: version.version, stamps: verdict.stamps };
}
/** How many batch manifests the section holds (Q14): 0 before its first. */
function armBatchCount(ctx) {
  const rel = armBatchDir(ctx.section);
  const st = lstatOrNull(ctx.out, rel);
  if (st === null) return 0;
  if (!st.isDirectory()) refuse('out-refused', `${rel} is not a directory`);
  let names;
  try {
    names = readdirSync(path.join(ctx.out, rel));
  } catch (e) {
    refuse('out-refused', `${rel} unreadable ${errCode(e)}`);
  }
  return names.filter((n) => ARM_BATCH_FILE_RE.test(n)).length;
}
/** Q14: the batch's manifest, written after its preflight and before its first spawn, never replaced: the version the
 *  preflight measured, the stamps in force, and each planned run with its stdin's sha. A run's version is the last
 *  manifest that names it (a recorded run is never planned again). */
function writeArmManifest(ctx, version, planned) {
  const n = armBatchCount(ctx) + 1;
  ensurePlainDir(ctx.out, armBatchDir(ctx.section));
  const rel = `${armBatchDir(ctx.section)}/${String(n).padStart(4, '0')}.json`;
  if (lstatOrNull(ctx.out, rel) !== null) refuse('out-refused', `${rel} already exists`);
  writePlain(ctx.out, rel, canonicalJson({
    kind: ARM_BATCH_KIND, v: 1, section: ctx.section, record_sha256: ctx.recordSha256, store_id: ctx.storeId, batch: n,
    claude_code_version: version, stamps: [...ctx.stamps].sort(), preflight_ms: Date.now(),
    runs: planned.map((p) => ({ name: p.job.name, qid: p.qid, arm: p.arm, attempt: p.attempt, stdin_sha256: sha256Hex(p.job.stdin) })),
  }) + '\n');
}
/** One (qid, arm)'s answer record (W2-D82, W2-D64, Q31), for a settled question. */
function answerRecordOf(ctx, s, a) {
  const q = s.q;
  const won = answeredAttempt(a);
  const ans = won === null ? null : armAnswerOf(q, won.facts, ctx.shaMinPrefix);
  return {
    kind: ANSWER_KIND, v: 1, section: ctx.section, record_sha256: ctx.recordSha256, store_id: q.store_id,
    qid: q.qid, arm: a.arm, ccrc_id: q.ccrc_id, generation: q.generation, boundary_uuid: q.boundary_uuid, fact_kind: q.kind,
    question_state: s.state, arm_state: a.state, ...(a.reason === undefined ? {} : { reason: a.reason }),
    attempts: a.attempts.map((t) => ({ name: t.name, class: t.class, code: t.code, signal: t.signal, tokens: t.tokens, error_fields: t.errorFields })),
    run: won === null ? null : won.name,
    answer_field: ans === null ? null : ans.answer_field, correct: ans === null ? null : ans.correct,
    absent: ans === null ? null : ans.absent, reply: ans === null ? null : ans.reply, uptake: ans === null ? null : ans.uptake,
    stamps: [...ctx.stamps].sort(),
  };
}
/** Every settled question's two records, written once: a settled question's runs never change, so a record already there
 *  is left as it is; anything there that is not a regular file refuses out-refused (D-5986). */
function settleAnswers(ctx, states) {
  for (const s of states) {
    if (s.state !== 'answered' && s.state !== 'run-failed') continue;
    ensurePlainDir(ctx.out, `${ctx.section}/answers`);
    for (const a of s.arms) {
      const rel = answerRel(ctx.section, s.q.qid, a.arm);
      const have = lstatOrNull(ctx.out, rel);
      if (have !== null) {
        if (!have.isFile()) refuse('out-refused', `${rel} is not a regular file`);
        continue;
      }
      writePlain(ctx.out, rel, canonicalJson(answerRecordOf(ctx, s, a)) + '\n');
    }
  }
}
/** A section's answer records under --out, as the judge reads them (R8, R26; W2-5b2 reads the same files): each
 *  `<section>/answers/<qid>.<arm>.json` settleAnswers wrote, projected as {qid, arm, outcome, reply, correct}: `outcome`
 *  the record's arm_state, `reply` the answered attempt's raw result text (the judge redacts it, W2-D54), `correct` its
 *  labelCorrect flag. No directory is no record. A file it cannot read, or one that is not this section's answer record
 *  under its own name, refuses out-refused (D-5986, D-6309's rule).
 *  @param {string} out  @param {'pilot' | 'quiz'} section */
export function readArmAnswers(out, section) {
  armSectionOk('readArmAnswers', section);
  const rel = `${section}/answers`;
  const st = lstatOrNull(out, rel);
  if (st === null) return [];
  if (!st.isDirectory()) refuse('out-refused', `${rel} is not a directory`);
  let names;
  try {
    names = readdirSync(path.join(out, rel)).sort();
  } catch (e) {
    refuse('out-refused', `${rel} unreadable ${errCode(e)}`);
  }
  return names.map((n) => {
    const read = readPlain(path.join(out, rel, n), OUT_JSON_CAP);
    if (read.state !== 'bytes') refuse('out-refused', `${rel}/${n} ${read.state === 'bad' ? badWord(read) : read.state}`);
    let r;
    try {
      r = JSON.parse(read.bytes.toString('utf8'));
    } catch {
      refuse('out-refused', `${rel}/${n} is not JSON`);
    }
    if (!plainObject(r) || r.kind !== ANSWER_KIND || r.section !== section || `${r.qid}.${r.arm}.json` !== n) refuse('out-refused', `${rel}/${n} is not an answer record`);
    return { qid: r.qid, arm: r.arm, outcome: r.arm_state, reply: r.reply, correct: r.correct };
  });
}
/** The summary (Q30), rewritten whole; answers its path under --out. */
function writeArmsSummary(ctx, states, stop) {
  const questions = states.map((s) => ({ qid: s.q.qid, state: s.state, arms: s.arms.map((a) => {
    const won = answeredAttempt(a);
    return { arm: a.arm, answer: won === null ? null : armAnswerOf(s.q, won.facts, ctx.shaMinPrefix) };
  }) }));
  const summary = armsSummaryOf({ section: ctx.section, recordSha256: ctx.recordSha256, storeId: ctx.storeId, budget: ctx.budget,
    spend: spentSoFar(ctx.out), batches: armBatchCount(ctx), stop, stamps: ctx.stamps, questions,
    payloadChanged: states.filter((s) => s.arms.some((a) => a.reason === ARM_PAYLOAD_CHANGED)).map((s) => s.q.qid) });
  const rel = armsSummaryRel(ctx.section);
  ensurePlainDir(ctx.out, `${ctx.section}/arms`);
  writePlain(ctx.out, rel, canonicalJson(summary) + '\n');
  return rel;
}
/** Q30: a refusal once --out is claimed. The line names the word, its kind (Task 1's driverWordClass over the DRIVER_STOPS
 *  partition, so a word with no class is a defect, never a guess: a stop is resumed once its cause
 *  clears; any other word is a refusal the operator rules on) and the not-run count; the settled answers and the summary
 *  are written, except after `interrupted` (D-5984: nothing more after the signal handler has run). A second refusal while
 *  measuring leaves the counts unmeasured and the summary unwritten; the first refusal stands. */
function reportArmsStop(ctx, questions, e) {
  const kind = driverWordClass(e.word);
  let counted = 'not-run count unmeasured';
  try {
    const states = questions.map((q) => questionArmsOf(ctx, q));
    const c = questionCountsOf(states.map((s) => s.state));
    counted = `${c.not_run} question(s) not run, ${c.rerun_owed} owing a re-run`;
    if (e.word !== 'interrupted') {
      settleAnswers(ctx, states);
      writeArmsSummary(ctx, states, { word: e.word, kind, detail: e.detail });
    }
  } catch (e2) {
    if (!(e2 instanceof DriverRefusal)) throw e2;
  }
  process.stderr.write(`ccrc history-replay: arms ${ctx.section} ${kind} ${e.word}: ${counted}; nothing is retried\n`);
}

// A handler that takes deps after its env names that parameter driverEnv, never env (W2-4 Task 5's env scan).
/** `arms --section pilot|quiz` (W2 decisions §5 acts 14 and 21; W2-D78, W2-D80, W2-D56, W2-D55). In order: the section and
 *  its form's flags; HOME; loadArmRun (the record, its gate_code re-checked first, W2-D24; Q23's --allow-code-change, quiz
 *  only, after window start; the frozen list, the pilot's against part 1; the settings mode, Q26); the unusable inputs;
 *  the store, once (W2-5a's R3), and armNodeOf (this node named in the record, its questions, the budget in force, Q5,
 *  W2-D56's expected); the ranges with the batch shape (R4) and refuseSpawnAdmission (roster, account, wrapper, limits
 *  row, preflightFiles; R26); W2-D78 (i) and (ii) over every question; all before prepareOut. Then `--out` (fresh of
 *  pilot-source's output, Q25), the claim, the account, the gate, and the batch loop. Exit 0 with every question settled
 *  and `sha256 <hex>` of the summary on stderr, stdout empty (D-5983); a refusal exits 2 after reportArmsStop's line. */
export async function armsCommand(flags, driverEnv, deps = { recheck: recheckBatch, payloads: armPayloads, now: () => Date.now() }) {
  const section = flags.section;
  if (!ARM_SECTIONS.includes(section)) refuse('args-invalid', `arms wants --section pilot or --section quiz, not ${JSON.stringify(section ?? null)}`);
  checkFlags(`arms --section ${section}`, flags);
  const home = subcommandHome(driverEnv);
  const run = loadArmRun(flags, section, { nowMs: deps.now() });   // W2-D24 (arms): gate_code before any other input
  const record = run.record;
  refuseUnusableInputs(home, flags.out, [['arm-model', record.arm_model]]);
  const rs = openReplayStore(home);
  try {
    const storeId = rs.storeId;
    const node = armNodeOf(run, storeId);
    const { questions, budget, nAll } = node;
    refuseOutOfRangeValues({ budget, budgetField: section === 'pilot' ? 'pilot_budget' : 'spend_budget', limits: node.limits, quotas: null, batch: true });
    refuseSpawnAdmission({ home, accountId: node.account, limits: node.limits, expected: node.expected, allowCodeChange: run.allowCodeChange });   // arms: W2-5a's R10, D-6307, D-6311
    requireListed(home, storeId, familiesOf(questions));
    refuseRecallOff(home, [...new Set(questions.map((q) => q.ccrc_id))]);
    if (section === 'quiz') process.stderr.write(`ccrc history-replay: spend share ${budget} = ceil(${record.spend_budget} x ${questions.length} / ${nAll})\n`);
    const out = prepareOut(flags.out);
    refuseColonInRealOut(out);
    if (lstatOrNull(out, PILOT_SOURCE_FILE) !== null) refuse('out-refused', `${PILOT_SOURCE_FILE} is here: arms run on a fresh --out, never pilot-source's`);
    const claim = claimOut(out);
    try {
      const { json, roster } = readRoster(home);
      const launch = admitAccount(json, roster, node.account, home);
      const gate = batchGate({ out, home, accountId: launch.accountId, budget, limits: node.limits });
      const ctx = {
        section, home, out, rs, storeId, launch, gate, expected: node.expected, allowCodeChange: run.allowCodeChange, deps,
        configDirs: rosterConfigDirs(roster, home), model: record.arm_model, settingsMode: node.settingsMode,
        lang: driverEnv.LANG, timeoutMs: deps.timeoutMs, recordSha256: run.recordSha256, shaMinPrefix: record.labeller.sha_min_prefix,
        budget: { in_force: budget, spend_budget: section === 'quiz' ? record.spend_budget : null, n_node: questions.length, n_all: nAll },
        stamps: new Set(run.codeStamps),
      };
      const perBatch = Math.floor(node.limits.batch_max / RECALL_ARMS.length);
      let states;
      try {
        for (;;) {
          states = questions.map((q) => questionArmsOf(ctx, q));
          settleAnswers(ctx, states);
          const pending = states.filter((s) => s.next.length > 0).slice(0, perBatch);
          if (pending.length === 0) break;
          const pre = await armBatchPreflight(ctx, pending);
          if (pre.pending.length === 0) continue;   // D-6482: every question of the batch was excluded; the next pass reads them as run-failed
          const planned = pre.pending.flatMap((s) => s.next.map(({ arm, attempt }) => ({ qid: s.q.qid, arm, attempt,
            job: armJob(ctx, s.q, arm, attempt, pre.stdins.get(`${s.q.qid} ${arm}`)) })));
          writeArmManifest(ctx, pre.version, planned);
          await runBatch(planned.map((p) => p.job), { gate, claim, concurrency: record.limits.concurrency });
        }
      } catch (e) {
        if (e instanceof DriverRefusal) reportArmsStop(ctx, questions, e);
        throw e;
      }
      const rel = writeArmsSummary(ctx, states, null);
      process.stderr.write(`sha256 ${shaOfPlain(out, rel)}\n`);
      return EXIT.OK;
    } finally {
      claim.release();
    }
  } finally {
    rs.close();
  }
}

HANDLERS.set('arms', (flags, env) => armsCommand(flags, env));

// ── W2-5b1 Task 5: the judge (W2-D79, W2-D54, W2-D80, W2-D18; Q18, Q2) ───────────────────────────────────────────
// One judge-mode spawn (`--tools ""`) per non-correct (qid, arm) of this node, through W2-4's contract and nothing else:
// launchRun reached through runBatch, under batchGate, on a claimed --out, after W2-D56's preflight before every batch
// (RP1-judge, RP3-judge). Its input is canonical {v: 1, kind, question, expected, answer_field, reply}, every string masked
// as a VALUE before anything serialises it (W2-D54, D-6308), the reply then cut to JUDGE_REPLY_MAX_BYTES of UTF-8. No arm
// token reaches an input or a file name: an item is named by its positional id in the 'judge-order' shuffle over every
// (qid, arm) pair of the section's frozen list, sorted by (qid, arm) by code unit (W2-D18, W2-D79, Q18), the same map on
// every node, and the id-to-(qid, arm) map is its own file, <section>/judge.map.json. A correct answer (labelCorrect over
// the reply's ANSWER field, re-derived here and held to the arm's record) never reaches the judge, nor does either arm of
// a run-failed question (W2-D80). A reply with no LABEL line, or a run that failed (a non-zero exit, a signal, no result
// event: D-6305's rule for the writer), is a malformed attempt, retried once with identical input in a later batch, then
// judge-failed (W2-D79, W2-D81). A stop throws before its run is recorded, so it never consumes the retry: a resume runs
// that attempt again under the same name (W2-D80's rule; D-5984). This file never spells an arm word: the arms are
// RECALL_ARMS' values, passed in (W2-D42).

/** W2-D79: the most UTF-8 bytes of an arm's redacted reply the judge's input carries (16 KiB). */
export const JUDGE_REPLY_MAX_BYTES = 16 * 1024;
/** W2-D79's canonical judge input, its keys in canonicalJson's order. */
export const JUDGE_INPUT_KEYS = Object.freeze(['answer_field', 'expected', 'kind', 'question', 'reply', 'v']);
/** W2-D79: a malformed reply is retried once with identical input, so an item is spawned at most twice. */
export const JUDGE_ATTEMPTS = 2;
/** A judged item's outcome (W2-D79, W2-D81): driver-local report words, never refusals and never the gate's, pinned
 *  disjoint from DRIVER_REASONS and GATE_REASONS as W2-5a pinned its drop lists. */
export const JUDGE_OUTCOMES = Object.freeze(['judged', 'judge-failed']);
const JUDGE_ID_MIN_DIGITS = 4;
/** Q18: a positional judge id, `j` and at least JUDGE_ID_MIN_DIGITS digits, one width in a map. */
export const JUDGE_ID_RE = new RegExp(`^j[0-9]{${JUDGE_ID_MIN_DIGITS},}$`);
/** Under --out: a section's judge runs and pinned inputs (<section>/judge/<id>-<attempt>, <section>/judge/<id>.input.json),
 *  its map (<section>/judge.map.json) and its output (<section>/judged.json). */
export const JUDGE_DIR = 'judge';
export const JUDGE_MAP_FILE = 'judge.map.json';
export const JUDGED_FILE = 'judged.json';
export const JUDGE_MAP_KIND = 'ccrc-history-w2-judge-map';
export const JUDGED_KIND = 'ccrc-history-w2-judged';

/** @typedef {{ run: string, code: number|null, signal: string|null, skipped: boolean, tokens: number, result: boolean,
 *    label: 'uncertain'|'fabricated'|null, error_fields: string[] }} JudgeAttempt */
/** @typedef {{ id: string, outcome: 'judged'|'judge-failed', label: 'uncertain'|'fabricated'|null,
 *    attempts: JudgeAttempt[] }} JudgedItem */
/** @typedef {{ v: 1, kind: string, question: string, expected: string, answer_field: string|null, reply: string }} JudgeInput */

/** The longest prefix of `text`, in whole code points, whose UTF-8 is at most `maxBytes`: a surrogate pair is never split.
 *  Pure.
 *  @param {string} text  @param {number} maxBytes  @returns {string} */
export function capUtf8Bytes(text, maxBytes) {
  if (typeof text !== 'string') throw new TypeError('capUtf8Bytes: text is a string');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('capUtf8Bytes: maxBytes is a non-negative integer');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > maxBytes) break;
    bytes += n;
    end += ch.length;
  }
  return text.slice(0, end);
}

/** The ANSWER field as the judge is shown it (the gate's RUBRIC_HEAD: "null when it gave none"): a value as parsed, the
 *  protocol's own `UNKNOWN` for an unknown, null for no ANSWER line. */
const answerFieldOf = (a) => (a.state === 'value' ? a.value : a.state === 'unknown' ? 'UNKNOWN' : null);

/** The (qid, arm) key's separator: a NUL, built at runtime, so this file holds no escape an agent's write could decode
 *  into a raw byte (a qid is 16 hex digits, so no qid holds it). */
const JUDGE_PAIR_SEP = String.fromCharCode(0);
/** The one (qid, arm) key every judge list sorts and looks up by: the qid, JUDGE_PAIR_SEP, the arm, so code-unit order
 *  over keys is (qid, arm) order. */
const judgePairKey = (qid, arm) => `${qid}${JUDGE_PAIR_SEP}${arm}`;

/** The judge's input for one answer (W2-D79), every string masked as a value (W2-D54, D-6308) and only then the reply cut
 *  to JUDGE_REPLY_MAX_BYTES; answer_field is read from the RAW reply (the field labelCorrect scored), masked whole, then cut
 *  at the same cap, so the judge's stdin is bounded (D-6470). Pure.
 *  @param {{ kind: string, question: string, fact: string }} entry  @param {string|null} reply
 *  @param {import('../ccd/history/lib.mjs').PairIndex} idx  @returns {JudgeInput} */
export function judgeInputOf(entry, reply, idx) {
  if (!FACT_KINDS.includes(entry?.kind)) throw new TypeError(`judgeInputOf: kind ${JSON.stringify(entry?.kind)} is not one of ${FACT_KINDS.join(', ')}`);
  if (reply !== null && typeof reply !== 'string') throw new TypeError('judgeInputOf: reply is a string or null');
  const text = reply ?? '';
  const field = answerFieldOf(parseAnswerField(text));
  return {
    v: 1, kind: entry.kind,
    question: /** @type {string} */ (maskValue(entry.question, idx)),
    expected: /** @type {string} */ (maskValue(entry.fact, idx)),
    answer_field: field === null ? null : capUtf8Bytes(/** @type {string} */ (maskValue(field, idx)), JUDGE_REPLY_MAX_BYTES),   // D-6470
    reply: capUtf8Bytes(/** @type {string} */ (maskValue(text, idx)), JUDGE_REPLY_MAX_BYTES),
  };
}

/** The judge's stdin: the signed rubric, a blank line, the canonical input, one newline (the writer's shape). Pure.
 *  @param {string} rubricId  @param {JudgeInput} input  @returns {string} */
export function judgeStdin(rubricId, input) {
  if (!RUBRIC_IDS.includes(rubricId)) throw new TypeError(`judgeStdin: rubric ${JSON.stringify(rubricId)} is not one of ${RUBRIC_IDS.join(', ')}`);
  return `${RUBRICS[rubricId]}\n\n${canonicalJson(input)}\n`;
}

/** Q18, W2-D79, W2-D18: the judge map, every (qid, arm) pair of the section's frozen list sorted by (qid, arm) by code unit
 *  and drawn into order on the record seed's 'judge-order' substream (W2-5a's seededOrder), each named by its position,
 *  `j` and the 1-based position at one width (at least JUDGE_ID_MIN_DIGITS). The same list and seed give the same map on
 *  every node, so an id names one pair across nodes. Pure.
 *  @param {string} seedHex  @param {ReadonlyArray<{ qid: string }>} entries  @param {readonly string[]} arms
 *  @returns {Array<{ id: string, qid: string, arm: string }>} */
export function judgeMapOf(seedHex, entries, arms) {
  const pairs = [];
  for (const e of entries) for (const arm of arms) pairs.push({ qid: e.qid, arm });
  const order = seededOrder(substream(seedHex, 'judge-order'), pairs, (p) => judgePairKey(p.qid, p.arm));
  const width = Math.max(JUDGE_ID_MIN_DIGITS, String(order.length).length);
  return order.map((p, k) => ({ id: `j${String(k + 1).padStart(width, '0')}`, qid: p.qid, arm: p.arm }));
}

/** The map file's exact text: canonicalJson of {kind, v, section, frozen_sha256, items} and one newline. Pure. */
export function judgeMapText(section, frozenSha256, map) {
  const items = map.map(({ id, qid, arm }) => ({ id, qid, arm }));
  return `${canonicalJson({ kind: JUDGE_MAP_KIND, v: 1, section, frozen_sha256: frozenSha256, items })}\n`;
}

/** Who reaches the judge (W2-D79, W2-D80), over this node's frozen entries and the arm answers its --out holds. Every
 *  answer record must name one of these qids and an arm, once (else `out-refused`); every question must be settled as
 *  Task 4 settles it (R14): every arm recorded, and either some arm run-failed or every arm answered (else `input-invalid`
 *  arms-unsettled, one per unsettled pair: the arm batches come first). A question either of whose arms is run-failed is
 *  settled and excluded in both, whatever the other arm's own record reads (`rerun` or `not-run`: arms never spawns it
 *  again, so refusing it would never clear); an answer is correct by labelCorrect over its own reply's ANSWER field, which
 *  must equal the record's flag (else `out-refused` answer-record-mismatch), and a correct one never reaches the judge.
 *  Every refusal here is data under --out, never a TypeError (D-6309's rule).
 *  @param {{ entries: Array<{ qid: string, kind: string, fact: string, repo_roots: string[] }>,
 *    answers: Array<{ qid: string, arm: string, outcome: string, reply: string|null, correct: boolean|null }>,
 *    arms: readonly string[], shaMinPrefix: number }} o */
export function judgeItemsOf({ entries, answers, arms, shaMinPrefix }) {
  const byQid = new Map(entries.map((e) => [e.qid, e]));
  const seen = new Map();
  for (const a of answers) {
    if (!plainObject(a) || !byQid.has(a.qid) || !arms.includes(a.arm)) refuse('out-refused', `answer-record-unknown ${typeof a?.qid === 'string' ? a.qid : 'without a qid'}`);
    const key = judgePairKey(a.qid, a.arm);
    if (seen.has(key)) refuse('out-refused', `answer-record-duplicate ${a.qid}`);
    seen.set(key, a);
  }
  const unsettled = [];
  for (const e of entries) {
    const own = arms.map((arm) => seen.get(judgePairKey(e.qid, arm)));
    const failed = own.some((a) => a !== undefined && a.outcome === 'run-failed');   // R14: either arm run-failed settles the question
    for (const a of own) if (a === undefined || (!failed && a.outcome !== 'answered')) unsettled.push(e.qid);
  }
  if (unsettled.length > 0) refuse('input-invalid', `arms-unsettled ${unsettled.length} (first ${[...unsettled].sort(cmpUnit)[0]}): finish the arm batches first`);
  const items = [];
  const excluded = { correct: 0, run_failed_questions: 0 };
  for (const e of [...entries].sort((x, y) => cmpUnit(x.qid, y.qid))) {
    const own = arms.map((arm) => seen.get(judgePairKey(e.qid, arm)));
    if (own.some((a) => a.outcome === 'run-failed')) { excluded.run_failed_questions += 1; continue; }   // W2-D80: excluded from both arms
    for (const a of own) {
      if (a.reply !== null && typeof a.reply !== 'string') refuse('out-refused', `answer-record-invalid ${e.qid}`);
      const parsed = parseAnswerField(a.reply ?? '');
      const correct = parsed.state === 'value' && labelCorrect(e.kind, e.fact, parsed.value, { repoRoots: e.repo_roots, shaMinPrefix });
      if (a.correct !== correct) refuse('out-refused', `answer-record-mismatch ${e.qid}`);
      if (correct) { excluded.correct += 1; continue; }   // W2-D79: a correct answer never reaches the judge
      items.push({ qid: e.qid, arm: a.arm, entry: e, reply: a.reply ?? '' });
    }
  }
  return { items, excluded };
}

/** The judge's jobs: each item's input under its map id, in id order (the shuffle's order). Pure. A pair the map lacks is
 *  a defect: the map and the items come from the same frozen list.
 *  @param {{ items: Array<{ qid: string, arm: string, entry: object, reply: string }>,
 *    map: Array<{ id: string, qid: string, arm: string }>, idx: import('../ccd/history/lib.mjs').PairIndex }} o
 *  @returns {Array<{ id: string, input: JudgeInput }>} */
export function judgeJobsOf({ items, map, idx }) {
  const idOf = new Map(map.map((m) => [judgePairKey(m.qid, m.arm), m.id]));
  return items.map((it) => {
    const id = idOf.get(judgePairKey(it.qid, it.arm));
    if (id === undefined) throw new TypeError(`judgeJobsOf: ${it.qid} has no id in the judge map`);
    return { id, input: judgeInputOf(it.entry, it.reply, idx) };
  }).sort((a, b) => cmpUnit(a.id, b.id));
}

/** One judge run as its attempt (W2-D79): a run that failed (a non-zero exit, a signal, no result event) yields no label,
 *  whatever it printed (D-6305's rule for the writer, applied to the judge); otherwise the reply's last LABEL line. Every
 *  `error` field the run's stream carried is recorded, as each arm attempt records them (Q31, Task 4's streamEventsOf and
 *  errorFieldsOf); a stream it cannot read refuses `out-refused`, a data case under --out (D-6309's rule).
 *  @returns {JudgeAttempt} */
function judgeAttemptOf(d) {
  const failed = d.code !== 0 || d.signal !== null || d.facts.result === null;
  const parsed = failed ? { ok: false } : parseLabelLine(d.facts.result?.text ?? '');
  const read = readPlain(d.streamPath, OUT_STREAM_CAP);
  if (read.state !== 'bytes') refuse('out-refused', `run-stream-changed ${d.name}`);
  return { run: d.name, code: d.code, signal: d.signal, skipped: d.skipped, tokens: d.tokens, result: d.facts.result !== null,
    label: parsed.ok ? parsed.label : null, error_fields: errorFieldsOf(streamEventsOf(read.bytes.toString('utf8'))) };
}

/** Open the judge (W2-D79) on a claimed --out. In order, before any spawn: the settings mode and the rubric id (TypeErrors:
 *  the record's validator signed both), the model (an exact Opus id, else `args-invalid`, refuseOpusModel), the roster and
 *  the account (W2-D52: `roster-invalid`, `account-refused`; RP3-judge), the gate (W2-D55), then W2-D56's preflight
 *  (Task 4's preflightSpawn). `judge(section, jobs)` pins each job's input beside its runs, then runs attempt 1 of every
 *  job and attempt 2 of every malformed one, each pass in batches of at most BATCH_MAX at CONCURRENCY_MAX (runBatch's
 *  default), the preflight before each batch.
 *  @param {{ home: string, accountId: string, model: string, settingsMode: string, rubricId: string, claim: object,
 *    budget: number, limits: object, expected: object, allowCodeChange?: boolean, lang: string | undefined }} o
 *  @returns {Promise<Readonly<{ launch: object, stamps: () => string[],
 *    judge: (section: string, jobs: Array<{ id: string, input: JudgeInput }>) => Promise<JudgedItem[]> }>>} */
export async function openJudge(o) {
  if (o === null || typeof o !== 'object' || !Object.hasOwn(o, 'lang')) {
    throw new TypeError("openJudge: carries lang, the caller's LANG from main's env (undefined when unset)");
  }
  const { home, accountId, model, settingsMode, rubricId, claim, budget, limits, expected, lang } = o;
  if (!SETTINGS_MODES.includes(settingsMode)) throw new TypeError(`openJudge: settings mode ${JSON.stringify(settingsMode)} is not one of ${SETTINGS_MODES.join(', ')}`);
  if (!RUBRIC_IDS.includes(rubricId)) throw new TypeError(`openJudge: rubric ${JSON.stringify(rubricId)} is not one of ${RUBRIC_IDS.join(', ')}`);
  const { out } = requireClaim('openJudge', { claim }, []);
  refuseOpusModel('judge-model', model);
  const { json, roster } = readRoster(home);
  const launch = admitAccount(json, roster, accountId, home);   // RP3-judge: every refusal here lands before any spawn
  const gate = batchGate({ out, home, accountId: launch.accountId, budget, limits });
  const stamps = new Set();
  const preflightNow = async () => {
    const pre = await preflightSpawn({ launch, home, out, lang, gate, expected, allowCodeChange: o.allowCodeChange === true });
    for (const s of pre.stamps) stamps.add(s);
  };
  await preflightNow();
  /** @param {string} section  @param {Array<{ id: string, input: JudgeInput }>} jobs  @returns {Promise<JudgedItem[]>} */
  const judge = async (section, jobs) => {
    if (!ARM_SECTIONS.includes(section)) throw new TypeError(`judge: section ${JSON.stringify(section)} is not one of ${ARM_SECTIONS.join(', ')}`);
    const ids = new Set();
    for (const j of jobs) {
      if (!plainObject(j) || typeof j.id !== 'string' || !JUDGE_ID_RE.test(j.id) || ids.has(j.id)) {
        throw new TypeError(`judge: job id ${JSON.stringify(j?.id)} is not a fresh judge id`);
      }
      ids.add(j.id);
    }
    const dir = `${section}/${JUDGE_DIR}`;
    ensurePlainDir(out, dir);
    for (const j of jobs) pinOutBytes(out, `${dir}/${j.id}.input.json`, `${canonicalJson(j.input)}\n`, 'judge-input');
    /** @type {Map<string, JudgeAttempt[]>} */
    const attempts = new Map(jobs.map((j) => [j.id, []]));
    for (let attempt = 1; attempt <= JUDGE_ATTEMPTS; attempt += 1) {
      // W2-D79: attempt 1 of every job, then attempt 2 of every malformed one, never of a labelled one
      const due = jobs.filter((j) => {
        const a = attempts.get(j.id);
        return a.length === attempt - 1 && a.every((x) => x.label === null);
      });
      for (let i = 0; i < due.length; i += BATCH_MAX) {
        const batch = due.slice(i, i + BATCH_MAX);
        await preflightNow();   // W2-D56: before every judge batch
        const runs = batch.map((j) => ({ launch, mode: 'judge', model, settingsMode, stdin: judgeStdin(rubricId, j.input), out, name: `${dir}/${j.id}-${attempt}`, lang }));
        const done = await runBatch(runs, { gate, claim });
        done.forEach((d, k) => attempts.get(batch[k].id).push(judgeAttemptOf(d)));
      }
    }
    return jobs.map((j) => {
      const a = attempts.get(j.id);
      const label = a[a.length - 1].label;
      return { id: j.id, outcome: label === null ? 'judge-failed' : 'judged', label, attempts: a };
    });
  };
  return Object.freeze({ launch, stamps: () => [...stamps].sort(), judge });
}

/** `judge --section pilot|quiz` (W2 decisions §5 acts 14 and 21; W2-D79; Q2): on this node, in this node's --out, after
 *  the section's arm batches. In order: the section, then its form's flags (`judge --section pilot|quiz`); Task 4's loader, which
 *  re-checks gate_code before any other input (W2-D24) and answers the section's record, frozen list and code-change
 *  stamps, under deps.now's clock (Q23's window); the unusable inputs and the judge model (D-5813, refuseOpusModel); the run's
 *  one store open (W2-5a's R3), for this node's id and the run's pair index; Task 4's node values (the account, W2-D56's
 *  expected values, the budget in force, Q5, the limits and the settings mode); the ranges of the budget in force and the
 *  limits (D-6309's rule) and the refusals that need no store and no spawn, before --out exists (W2-5a's R10, D-6307,
 *  D-6311), as `arms` makes them; then --out, its claim, the map (pinned), the arm answers, the items, the jobs and the
 *  judge. Writes <section>/judged.json and prints only `sha256 <hex>` of it on stderr (D-5983).
 *  @param {Flags} flags  @param {DriverEnv} driverEnv
 *  @param {{ loadArmRun: typeof loadArmRun, armNodeOf: typeof armNodeOf, readArmAnswers: typeof readArmAnswers, now: () => number }} [deps] */
export async function judgeCommand(flags, driverEnv, deps = { loadArmRun, armNodeOf, readArmAnswers, now: () => Date.now() }) {
  const section = flags.section;
  if (!ARM_SECTIONS.includes(section)) refuse('args-invalid', `judge wants --section pilot or --section quiz, not ${JSON.stringify(section ?? null)}`);
  checkFlags(`judge --section ${section}`, flags);
  const home = subcommandHome(driverEnv);
  const run = deps.loadArmRun(flags, section, { nowMs: deps.now() });   // W2-D24 (judge): gate_code before any other input, the store or a spawn
  refuseUnusableInputs(home, flags.out, [['judge-model', run.record.judge_model]]);   // D-5813: HOME, --out and the model id, before --out
  refuseOpusModel('judge-model', run.record.judge_model);   // R10: before --out; openJudge asks it again at open
  const rs = openReplayStore(home);   // the run's one store open (W2-5a's R3): this node's id and the run's pair index
  try {
    const node = deps.armNodeOf(run, rs.storeId);
    refuseOutOfRangeValues({ budget: node.budget, budgetField: section === 'pilot' ? 'pilot_budget' : 'spend_budget', limits: node.limits, quotas: null });   // D-6309's rule: batchGate throws on either
    refuseSpawnAdmission({ home, accountId: node.account, limits: node.limits, expected: node.expected, allowCodeChange: run.allowCodeChange === true });   // judge: W2-5a's R10, D-6307, D-6311, before --out exists
    const out = prepareOut(flags.out);
    refuseColonInRealOut(out);
    const claim = claimOut(out);
    try {
      const r = run.record;
      const map = judgeMapOf(r.bootstrap.seed, run.frozen.list.entries, RECALL_ARMS);
      ensurePlainDir(out, section);
      const mapRel = `${section}/${JUDGE_MAP_FILE}`;
      pinOutBytes(out, mapRel, judgeMapText(section, run.frozen.sha256, map), 'judge-map');
      const own = run.frozen.list.entries.filter((e) => e.store_id === rs.storeId);   // Q2: this node's questions only
      const picked = judgeItemsOf({ entries: own, answers: deps.readArmAnswers(out, section), arms: RECALL_ARMS, shaMinPrefix: r.labeller.sha_min_prefix });
      const snapshots = maskingSnapshotsOf(rs, home);
      let jobs = null;
      for (const snapshot of snapshots) {
        const built = judgeJobsOf({ items: picked.items, map, idx: snapshot.idx });
        if (jobs === null) { jobs = built; continue; }
        if (jobs.length !== built.length || jobs.some((job, i) => job.id !== built[i].id || !sameMaskingText(canonicalJson(job.input) + '\n', canonicalJson(built[i].input) + '\n'))) {
          refuse('input-invalid', 'masking-snapshots-disagree judge');
        }
      }
      const judge = await openJudge({ home, accountId: node.account, model: r.judge_model, settingsMode: node.settingsMode, rubricId: r.rubric_id,
        claim, budget: node.budget, limits: node.limits, expected: node.expected, allowCodeChange: run.allowCodeChange === true, lang: driverEnv.LANG });
      const items = await judge.judge(section, jobs);
      const count = (pred) => items.filter(pred).length;
      const output = {
        kind: JUDGED_KIND, v: 1, section, store_id: rs.storeId, record_sha256: run.recordSha256, frozen_sha256: run.frozen.sha256,
        map_sha256: shaOfPlain(out, mapRel), judge_model: r.judge_model, rubric_id: r.rubric_id, rubric_sha256: RUBRIC_SHA256[r.rubric_id],
        settings_mode: node.settingsMode, reply_max_bytes: JUDGE_REPLY_MAX_BYTES, items,
        counts: {
          judged: count((i) => i.outcome === 'judged'), judge_failed: count((i) => i.outcome === 'judge-failed'),
          uncertain: count((i) => i.label === 'uncertain'), fabricated: count((i) => i.label === 'fabricated'),
          excluded_correct: picked.excluded.correct, excluded_run_failed_questions: picked.excluded.run_failed_questions,
        },
        budget: node.budget, spend: spentSoFar(out), stamps: [...new Set([...run.codeStamps, ...judge.stamps()])].sort(),
      };
      const rel = `${section}/${JUDGED_FILE}`;
      writePlain(out, rel, canonicalJson(output) + '\n');
      process.stderr.write(`sha256 ${shaOfPlain(out, rel)}\n`);   // D-5983: stderr; stdout stays empty
      return EXIT.OK;
    } finally {
      claim.release();
    }
  } finally {
    rs.close();
  }
}

HANDLERS.set('judge', (flags, env) => judgeCommand(flags, env));

// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised
// when main runs. Importing the module (the tests do) runs nothing. The exit code is set, never forced, so stderr drains.
// main gets a by-name projection of the environment, never process.env whole; an unset name stays undefined (W2-D45).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2), { HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG });
}
