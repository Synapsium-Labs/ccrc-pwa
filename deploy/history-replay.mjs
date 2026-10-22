#!/usr/bin/env -S node --no-warnings
// deploy/history-replay.mjs: the ccrc history W2 replay driver (spec 2026-10-05 §10.2; W2 decisions W2-D50 to W2-D59).
//
// An L4 operator script. The operator runs it by hand, from a shell OUTSIDE tmux, on a named node. It admits one
// account from the roster, spawns Claude Code headless under one fixed contract, reads the stream-json those spawns
// print, and writes every output under the operator's --out directory. Refusing to run inside a pane is main's first
// act (W2-D51, W2-D45).
//
// Imports: node: built-ins (node:crypto's randomBytes draws the W2 seeds); ../ccd/history/lib.mjs; the W2-1 exports
// the quiz reads, from ../ccd/history/store.mjs, ../ccd/history/derive.mjs, ../ccd/history/recall.mjs and
// ../ccd/history/cli.mjs (W2-D33, W2-D74); the index text and the registry read from ../ccd/history/sweep.mjs, never
// its recall-off reader (W2-D29); ./history-gate.mjs, the pure gate (W2-D11); and ../shared/roster-json.mjs.
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
// Never spelled here: the recall arm words, which reach a spawn as parameters (W2-D50), and the headless marker's
// path, which W2-5b reaches through lib's historyPaths.
// Its words: DRIVER_REASONS, frozen once here and nowhere else (W2-D59, W2-D12; D-5774). A refusal prints
// `ccrc history-replay: <word>: <detail>` on stderr and exits EXIT.REFUSED (2); a defect exits EXIT.INTERNAL (1).
// They are never lib REASONS: §8.7's table and SKILL.md do not list them. EXIT is imported, never declared (O14).
import { accessSync, closeSync, constants, fchmodSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import os from 'node:os';
import path, { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { EXIT, SCHEMA_ADDED, UUID_RE, backendOf, blobOverDecodeCap, canonicalJson, historyPaths, isHistoryCommand, isSyntheticModel, producerOf, producerOfCopy, recallOffPath, redactField, renderEntryText, sha256Hex, summaryRowFor, toolResultIdsOf, toolUsesOf } from '../ccd/history/lib.mjs';
import { StoreError, openReader, userVersion } from '../ccd/history/store.mjs';
import { blobReadStmts, bodyOf, epochOfUuid, holdingCopyOf } from '../ccd/history/derive.mjs';
import { expandEntryBody } from '../ccd/history/recall.mjs';
import { pairIndexOf } from '../ccd/history/cli.mjs';
import { ftsTextOfBlob } from '../ccd/history/sweep.mjs';
import { ANSWER_PROTOCOL, GATE_CODE_FILES, admitFact, collapseWs } from './history-gate.mjs';
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

// ── the argument grammar ──────────────────────────────────────────────────
/** @typedef {'string' | 'int' | 'bool'} FlagKind */
/** @typedef {Record<string, string | number | boolean>} Flags */
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
}));

/** The subcommands, by name. Empty until Tasks 8 and 9 register `step0a` and `probe`, so every subcommand is
 *  args-invalid until then.
 *  @type {Map<string, (flags: Flags, env: DriverEnv) => Promise<number>>} */
export const HANDLERS = new Map();

const INT_TEXT = /^[1-9][0-9]*$/;

/** `<sub> [--flag value | --bool]...`: the subcommand first, then flags, each at most once. `--name=value` is not
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
    if (Object.hasOwn(flags, name)) refuse('args-invalid', `repeated flag --${name}`);
    const kind = specs[name];
    if (kind === 'bool') { flags[name] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) refuse('args-invalid', `missing value for --${name}`);
    i += 1;
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
/** @typedef {{ id: string, name: string, input: unknown, result: string|null, isError: boolean|null }} ToolPair */
/** @typedef {{ init: StreamInit|null, usage: StreamUsage, usageSource: 'result'|'assistant'|'none', toolPairs: ToolPair[],
 *    permissionDenials: unknown[]|null, result: { subtype: string|null, isError: boolean|null, numTurns: number|null,
 *    text: string|null }|null, assistantMessages: number, malformedLines: number }} StreamFacts */

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
      const key = typeof msg.id === 'string' ? msg.id : Symbol('a message without an id');
      if (sjObject(msg.usage)) messages.set(key, sjUsage(msg.usage));
      else if (!messages.has(key)) messages.set(key, null);
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (sjObject(b) && b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string' && !pairs.has(b.id)) {
          pairs.set(b.id, { id: b.id, name: b.name, input: b.input ?? null, result: null, isError: null });
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
  let usage = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  let usageSource = 'none';
  if (resultUsage !== null) {
    usage = resultUsage;
    usageSource = 'result';
  } else {
    for (const u of messages.values()) {
      if (u === null) continue;
      usageSource = 'assistant';
      usage = {
        input: usage.input + u.input, cacheCreation: usage.cacheCreation + u.cacheCreation,
        cacheRead: usage.cacheRead + u.cacheRead, output: usage.output + u.output,
      };
    }
  }
  return {
    init, usage, usageSource, toolPairs: [...pairs.values()], permissionDenials, result,
    assistantMessages: messages.size, malformedLines,
  };
}

/** One spawn's spend in token-equivalents (W2-D55): input + cache_creation + cache_read + output.
 *  @param {StreamFacts} facts
 *  @returns {number} */
export function spendTokens(facts) {
  const u = facts.usage;
  return u.input + u.cacheCreation + u.cacheRead + u.output;
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
 *  @param {string} p  @param {number} cap
 *  @returns {{state: 'absent'} | {state: 'bytes', bytes: Buffer} | {state: 'bad', why: 'not-regular' | 'over-cap' | 'unreadable', code?: string}} */
function readPlain(p, cap) {
  const unreadable = (e) => ({ state: 'bad', why: 'unreadable', code: String(e?.code ?? 'EUNKNOWN') });
  let st;
  try {
    st = lstatSync(p);
  } catch (e) {
    return e?.code === 'ENOENT' ? { state: 'absent' } : unreadable(e);
  }
  if (!st.isFile()) return { state: 'bad', why: 'not-regular' };
  let fd;
  try {
    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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
// input. Arm values arrive as parameters: this file never spells one (W2-5b's scan pins that).
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
 *  the account's CLAUDE_CONFIG_DIR, and in arm mode only the three CCRC_RECALL_* values passed in. Pure.
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
    code: res.code, signal: res.signal, ms, cwd, stream_sha256: sha256Hex(stream), tokens, unknown_options: unknownOptions,
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
    const nowMs = now();
    const stop = decideLimits(readLimitsRow(home, accountId, Math.floor(nowMs / 1000)), { nowMs, thresholdPct, maxAgeMs });
    if (stop !== null) refuse(stop.word, stop.detail);
  };
}

// ── W2-4 Task 7: the preflights W2-5a and W2-5b wire (W2-D56, W2-D24, W2-D6, W2-D78(ii), W2-D29, W2-D59) ────────
// Mechanisms only: no subcommand here calls them yet. Before part 1 a spawning subcommand compares what step 0a
// recorded (loadStep0a over `--step0a PATH --step0a-sha256 HEX`) with what it measures now; from part 1 it compares
// part 1's values. W2-5a and W2-5b wire each of their own subcommands (W2-D24); step 0a (Task 8) RECORDS
// codeShas() and the release stamp and never compares them.
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

/** Compare what was recorded with what is measured, in W2-D56's fixed order: the Claude Code version, the release
 *  stamp (W2-D6's tree-moved), the wrapper, the four code shas. A moved word names a MEASURED mismatch only; an
 *  input that cannot be measured refuses its own word at its place (coordinator ruling): version-unmeasured,
 *  tree-unmeasured, code-unmeasured (the wrapper's, wrapper-unmeasured, is wrapperSha's refusal, before this is
 *  reached: measured.wrapperSha256 is a sha or upstream's null). Only the code-changed word, a MEASURED change,
 *  may become a stamp, and only with allowCodeChange (W2-D24's --allow-code-change); no unmeasured word ever
 *  does. Pure. */
export function preflight(expected, measured, opts = {}) {
  const v = measured.version;
  if (v.state !== 'value') return { ok: false, word: 'version-unmeasured', detail: `--version failed (code ${v.code}, signal ${v.signal})` };
  if (v.version !== expected.claude_code_version) return { ok: false, word: 'claude-version-moved', detail: `recorded ${expected.claude_code_version}, measured ${v.version}` };
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
 *  The driver never opens the entry (W2-D29): this lstat line is its one recall-off line. */
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
 *  inserts before it. Counts, never refusals, and never a DRIVER_REASONS or GATE_REASONS word. */
export const RECON_DISCARDS = Object.freeze([
  'boundary-absent', 'boundary-uncopied',
  'summary-absent', 'summary-unparseable', 'summary-tombstone', 'summary-over-cap', 'summary-undecodable',
  'kept-absent', 'kept-unreadable',
  'member-tombstone', 'member-over-cap', 'member-undecodable',
  'over-decode-cap', 'leaf-absent',
  'span-unparseable', 'span-tombstone', 'span-over-cap', 'span-undecodable',
  'no-epoch', 'ts-null', 'before-other', 'before-unknown', 'after-other', 'after-unknown',
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
      WHERE s.node_id = (SELECT node_id FROM nodes WHERE boundary_entry_id = ? AND depth = 0 ORDER BY node_id LIMIT 1)
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
  const pieces = Array.isArray(k.body)
    ? k.body.map((b) => {
      const type = b !== null && typeof b === 'object' ? b.type : null;
      const text = type === 'tool_use' ? renderToolUseLine(typeof b.name === 'string' ? b.name : '', JSON.stringify(b.input ?? null)) : renderEntryText([b]);
      return { type, tagged: typeof b === 'string' || type === 'text', text };
    })
    : [{ type: null, tagged: true, text: renderEntryText(k.body) }];
  const lines = [];
  for (const p of pieces) {
    const field = { text: p.text, rawLen: k.rawLen };
    const r = p.type === 'tool_result' ? toolResultText(field, idx) : redactForSpawn(field, idx);
    if (r.state !== 'text') return r;
    lines.push(p.type === 'tool_result' ? `[tool_result] ${r.text}` : p.tagged ? `[${row.type}] ${r.text}` : r.text);
  }
  return { state: 'text', text: lines.join('\n') };
}

/** `fn()`, or null when it throws a RangeError: a body nested past V8's JSON.stringify stack (about 4,500 levels, far
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
  const sumText = renderOrNull(() => renderEntryText(sum.body));
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
/** A stored text as a spawn's input reads it (W2-D54): the text and its UTF-8 length.
 *  @typedef {{ text: string, rawLen: number }} StoredField */
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
    span.push(storedField(rendered));
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
        : { name: typeof answered.block.name === 'string' ? answered.block.name : '', input: storedField(JSON.stringify(answered.block.input ?? null)) };
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

// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised
// when main runs. Importing the module (the tests do) runs nothing. The exit code is set, never forced, so stderr drains.
// main gets a by-name projection of the environment, never process.env whole; an unset name stays undefined (W2-D45).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2), { HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG });
}
