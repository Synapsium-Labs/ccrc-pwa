#!/usr/bin/env -S node --no-warnings
// deploy/history-quiz-unattended.mjs: the weekly replay quiz run by a timer, with no operator (Overlord W1a; the note
// docs/superpowers/programs/overlord/quiz-unattended.md, section 1; the operator's ruling of 2026-11-22 that supersedes the
// one W0-28 condition "the driver runs by your hand").
//
// An L4 runner, the one act of `ccd-quiz-weekly.service` (a systemd user timer, every 6 h): `node --no-warnings
// ~/ccrc/deploy/history-quiz-unattended.mjs`, no arguments. Each tick it advances the quiz by as many acts as it can, in
// order: the setup, the sourced and frozen questions and the headless marker text (once, ever), then this ISO week's arms,
// judge and report, then `ccrc quiz-record --confirm`. It spawns the single-arm driver (`history-quiz-single.mjs`) exactly
// as the operator's runbook does, reading each step's `sha256 <hex>` line and its refusal line on stderr, and it never
// opens the history store itself. Every refusal the driver has stays in force: step 0b's probes, `release-moved`, the
// masking agreement, the weekly --budget and the read-only store.
//
// Where it runs: the timer's run is neither a Claude Code session nor a tmux pane, so the two refusals the driver and the
// record verb share pass honestly (`in-session` when CLAUDECODE is set at all, `in-pane` when TMUX_PANE is). Nothing here
// ever unsets either variable, and the children get a by-name environment (HOME, LANG, PATH) that carries neither.
//
// The account (the coordinator's ruling of 2026-11-21): chosen once, at setup, from the placement reading. The candidates are
// the roster's accounts that are not hidden, whose `exec.kind` is upstream or generated and whose telemetry is neither
// openrouter nor codex (never usage credits, never a Codex lane); the arm, writer and judge model stay the Opus id. Room is
// the driver's own reading (history-replay.mjs's readLimitsRow and decideLimits at LIMITS_DEFAULTS): the candidate with the
// lowest `seven` among those with room is tried first, the next on `account-refused`; with none, the tick waits (`no-room`,
// never latched). Before every `arms` and `judge` the setup's account is re-read the same way. A week still running when a
// new ISO week starts is closed `failed` (`week-ended`): the runner works the current week only.
//
// What it writes: only under `$HOME/.ccrc/quiz/` (mode 0700): the state file `unattended.json` (written whole, by a
// rename), a lock, `journal.log`, the setup's --out at `setup.<n>` and one --out per ISO week at `weeks/<YYYY-Www>`. The ONE
// write outside it is `$HOME/.ccrc/history/headless-on`, made once and atomically: the marker bytes the driver's `marker`
// step printed go into a temp file under the quiz root (0600) and are hard-linked to the target (a link fails when the target
// exists, so it never clobbers), then the temp goes; one line of the write is appended to `journal.log`. An existing marker
// is parsed by the history lib's own parser and kept when it names this store and lists EVERY frozen family (extra pairs are
// fine, `present`); otherwise the tick refuses (`headless-on-incomplete`, `headless-on-unreadable`) and writes nothing. It is
// never edited, widened or removed. Steer, agents-on and recall-off stay the operator's.
//
// The status: at the end of every tick that wrote `last` (never the `in-session`, `in-pane` or `locked` ticks), the runner
// posts it with `ccrc-api quiz status --json -`, and records `last.posted`. A failed post never fails the tick.
//
// A refusal in the once-only setup phase (setup, source, freeze, marker, headless) that no resume cures is latched in the
// state file (`setup_refused: { word, detail, week }`): that phase is retried only when the ISO week differs from the latched
// one, so it makes at most one attempt a week, the bound a failed week has, and the latched ticks keep writing `last` with
// the word. A stop a resume cures (`interrupted`, the limits words) and an internal failure do not latch.
//
// One week, one --budget: a week is one directory. A stop that resuming cures (`interrupted` and the limits words) leaves
// the week `running`, and the next tick resumes the same directory. Any other driver refusal closes the week `failed` with
// its word, and the next ISO week starts fresh, so a week never spends more than one --budget. Recording is retried every
// tick until it confirms (a resend answers its own row).
//
// A week closed on `pilot-failed` (quiz-pilot-checks ruling 5): it is piloted again, in its own directory, only when the
// installed tree's release (`$HOME/.ccrc/build.json`, the driver's readReleaseStamp) differs from the release of every pilot
// that failed this week (each read from the driver's own release pin in the week's directory), and at most PILOTS_MAX pilots
// in a week. repilotOf decides it, pure; the runner only reopens the week and runs `arms --repilot`, the single-arm module's
// one door for it. The pilot spends on the week's own ledger, so it counts toward the week's one --budget, and a pass carries
// on as a first pass would. Every other closed week stays closed.
//
// State (`ccrc-quiz-unattended-state`, v1) is `{ kind, v, setup, setup_refused, weeks, last }`; doctor reads `last` (the tick's
// time, week, act, outcome, word, detail and whether it was posted). outcome: `ok` advanced or confirmed, `waiting` a stop resuming cures (or a run
// already holding the lock), `refused` a word that needs attention, `failed` an internal error. Exit 0 for the first three
// (the word lives in the state file), 1 for `failed`, 2 for the early refusals (`in-session`, `in-pane`, `home-unset`).
//
// Environment: main gets a by-name projection {HOME, TMUX_PANE, LANG, PATH, CLAUDECODE}; nothing here reads process.env whole.
import { appendFileSync, closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXIT, HEADLESS_LIST_MAX_BYTES, parseHeadlessList } from '../ccd/history/lib.mjs';
import { LIMITS_DEFAULTS, decideLimits, readLimitsRow, readReleaseStamp } from './history-replay.mjs';
import { JUDGED_FILE, OUT_MARKER, RELEASE_PIN_FILE, RELEASE_PIN_KIND, REPORT_FILE, SETUP_FILE, SUMMARY_FILE } from './history-quiz-single.mjs';

const PREFIX = 'ccrc quiz-unattended';

// ── the words, the kinds and the constants ───────────────────────────────────────────────────────────────────────────
export const STATE_KIND = 'ccrc-quiz-unattended-state';
export const STATE_FILE = 'unattended.json';
export const LOCK_FILE = 'unattended.lock';
/** The setup's built-in values (the coordinator's ruling of 2026-11-21): the weekly cap and the arm and judge models. */
export const BUDGET = 5000000;
export const SETTINGS_MODE = 'restricted';
export const WRITER_MODEL = 'claude-opus-5-5';
export const JUDGE_MODEL = 'claude-opus-5-5';
export const ARM_MODEL = 'claude-opus-5-5';
/** The driver refusal words a resume cures: `interrupted` and the limits words (history-replay.mjs's DRIVER_REASONS holds
 *  `limits-threshold` and `limits-stale`; the test pins this list to that file's `limits-*` words). Every other word closes
 *  the week `failed`. */
export const RESUMABLE_WORDS = Object.freeze(['interrupted', 'limits-threshold', 'limits-stale']);
/** The newest weeks kept on disk (and in the state file). */
export const KEEP_WEEKS = 4;
/** The most pilots one week runs (quiz-pilot-checks ruling 5): the first and at most two more, each on a newer release. */
export const PILOTS_MAX = 3;
/** The driver's word for a pilot that did not pass: the one word a week is piloted again after. */
export const PILOT_FAILED = 'pilot-failed';
/** Why repilotOf keeps a closed week closed, one word each. */
export const STAY_CLOSED = Object.freeze(['no-week', 'not-failed', 'not-the-pilot', 'pilots-unreadable', 'pilots-spent', 'release-unmeasured',
  'failed-release-unmeasured', 'release-unchanged']);
/** The acts of the once-only setup phase: a non-resumable refusal in one of them latches for its ISO week. */
export const SETUP_ACTS = Object.freeze(['setup', 'source', 'freeze', 'marker', 'headless']);
/** The acts, in order, and the `last.act` words (`none` and `done` are not acts the runner spawns). */
export const ACTS = Object.freeze(['setup', 'source', 'freeze', 'marker', 'headless', 'arms', 'judge', 'report', 'record', 'done']);
export const LAST_ACTS = Object.freeze([...ACTS, 'none']);
export const OUTCOMES = Object.freeze(['ok', 'waiting', 'refused', 'failed']);
/** This file's own words that can stand in `last.word` (beside the driver's refusal words, which pass through, and the record
 *  verb's, an open set: the first token of its last stderr line). */
export const OWN_WORDS = Object.freeze(['no-account-admitted', 'no-room', 'account-disabled', 'record-path-missing', 'week-ended', 'marker-sha-mismatch', 'marker-unparseable',
  'headless-on-incomplete', 'headless-on-unreadable', 'headless-on-cross-device', 'history-store-absent', 'record-failed',
  'record-unconfirmed', 'record-sha-mismatch', 'driver-failed', 'spawn-failed', 'no-sha-line', 'internal-error']);
/** The words that only ever reach stderr (a tick that prints one writes no `last`, and posts nothing). */
export const STDERR_WORDS = Object.freeze(['in-session', 'in-pane', 'home-unset', 'locked', 'state-unreadable']);
/** The roster's eligible accounts: `exec.kind` one of these, and a telemetry that is neither of the two below (never usage
 *  credits, never a Codex lane). */
export const ELIGIBLE_KINDS = Object.freeze(['upstream', 'generated']);
export const EXCLUDED_TELEMETRY = Object.freeze(['openrouter', 'codex']);
/** The status client's detail bound, and how long a post may take. */
export const STATUS_DETAIL_MAX = 200;
const POST_TIMEOUT_MS = 30_000;
const WEEK_KEY_RE = /^[0-9]{4}-W[0-9]{2}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DAY_MS = 86_400_000;

const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex');
const plainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 300);

// ── pure ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The ISO week of an instant, UTC, `YYYY-Www` (the same rule as server/src/continuity/quiz.ts#quizWeek: the ISO year is the
 *  year of the week's Thursday). Pure.  @param {number} nowMs */
export function weekKeyOf(nowMs) {
  const d = new Date(nowMs);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const monday = midnight - ((d.getUTCDay() + 6) % 7) * DAY_MS;
  const thursday = new Date(monday + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The setup is complete when every sha and the headless word stand. Pure. */
export function setupComplete(s) {
  return plainObject(s) && typeof s.setup_sha256 === 'string' && typeof s.sourced_sha256 === 'string' && typeof s.frozen_sha256 === 'string'
    && typeof s.marker_sha256 === 'string' && (s.headless === 'written' || s.headless === 'present');
}

/** The next act, from the state alone: setup, source, freeze, marker, headless once and for all; then the week's arms,
 *  judge, report and record; `done` when the week is confirmed or failed. Pure.
 *  @param {{ setup: any, weeks: Record<string, any> }} state  @param {string} weekKey  @returns {string} */
export function nextActOf(state, weekKey) {
  const s = state.setup;
  if (s === null || s === undefined) return 'setup';
  if (typeof s.sourced_sha256 !== 'string') return 'source';
  if (typeof s.frozen_sha256 !== 'string') return 'freeze';
  if (typeof s.marker_sha256 !== 'string') return 'marker';
  if (s.headless !== 'written' && s.headless !== 'present') return 'headless';
  const w = state.weeks?.[weekKey];
  if (w === undefined || w === null) return 'arms';
  if (w.state === 'confirmed' || w.state === 'failed') return 'done';
  if (typeof w.arms_sha256 !== 'string') return 'arms';
  if (typeof w.judged_sha256 !== 'string') return 'judge';
  if (typeof w.report_sha256 !== 'string') return 'report';
  return 'record';
}

/** The last `sha256 <hex>` line of a step's stderr, and its last refusal line (`ccrc history-quiz-single: <word>: <detail>`).
 *  A line of the driver's other shapes (`internal error`, `arms stop <word>`) is neither. Pure.  @param {string} stderr */
export function stepLinesOf(stderr) {
  let sha = null;
  let refusal = null;
  for (const line of String(stderr).split('\n')) {
    const a = /^sha256 ([0-9a-f]{64})$/.exec(line);
    if (a !== null) sha = a[1];
    const r = /^ccrc history-quiz-single: ([a-z][a-z0-9-]*): (.*)$/.exec(line);
    if (r !== null) refusal = { word: r[1], detail: r[2] };
  }
  return { sha, refusal };
}

/** The word of a failed `ccrc quiz-record`: the first token of its last stderr line before `:` (a leading `quiz-record:` and
 *  `refused:` are the verb's own framing and are skipped), else `record-failed`. Pure.  @param {string} stderr */
export function recordWordOf(stderr) {
  const lines = String(stderr).split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0) return { word: 'record-failed', detail: 'no output' };
  const last = lines[lines.length - 1];
  const bare = last.replace(/^quiz-record:\s*/, '');
  const framed = /^refused:\s*/.test(bare);
  const rest = bare.replace(/^refused:\s*/, '');
  const m = (framed ? /^([a-z][a-z0-9-]*)(?::|\s|$)/ : /^([a-z][a-z0-9-]*):/).exec(rest);
  return { word: m !== null ? m[1] : 'record-failed', detail: oneLine(last) };
}

/** The verb's success line: `confirmed run <id>, report sha <12 hex>` with ` (the baseline)` when the run became it. Pure. */
export function confirmedLineOf(stdout) {
  let found = null;
  for (const line of String(stdout).split('\n')) {
    const m = /^confirmed run ([0-9]+), report sha ([0-9a-f]{12})( \(the baseline\))?$/.exec(line.trim());
    if (m !== null) found = { runId: Number(m[1]), sha12: m[2], baseline: m[3] !== undefined };
  }
  return found;
}

/** Whether this ISO week's row is piloted again (quiz-pilot-checks ruling 5). `week` is the row, `pilots` the pilots that
 *  failed in it so far, oldest first (`{release}` each, the release the driver pinned for that pilot, or null when it could
 *  not be read), `release` the installed tree's release now (readReleaseStamp's answer). Yes only for a week closed on
 *  `pilot-failed`, with fewer than PILOTS_MAX failed pilots, a release measured now, every failed pilot's release measured,
 *  and the release now none of them. Anything unreadable keeps the week closed: an unmeasured value never re-spends. Pure.
 *  @param {{ week: any, pilots: unknown, release: { state: string, tag?: string } }} o
 *  @returns {{ repilot: true, pilot: number } | { repilot: false, why: string }} */
export function repilotOf({ week, pilots, release }) {
  const no = (why) => ({ repilot: false, why });
  if (!plainObject(week)) return no('no-week');
  if (week.state !== 'failed') return no('not-failed');
  if (week.word !== PILOT_FAILED) return no('not-the-pilot');
  if (!Array.isArray(pilots) || pilots.length === 0 || !pilots.every((p) => plainObject(p))) return no('pilots-unreadable');
  if (pilots.length >= PILOTS_MAX) return no('pilots-spent');
  if (!plainObject(release) || release.state !== 'value' || typeof release.tag !== 'string' || release.tag === '') return no('release-unmeasured');
  if (!pilots.every((p) => typeof p.release === 'string' && p.release !== '')) return no('failed-release-unmeasured');
  if (pilots.some((p) => p.release === release.tag)) return no('release-unchanged');
  return { repilot: true, pilot: pilots.length + 1 };
}

/** The week keys to keep (the newest KEEP_WEEKS of the ones named and the current one) and to drop. Pure.
 *  @param {string[]} keys  @param {string} current */
export function pruneSplitOf(keys, current) {
  const all = [...new Set([...keys.filter((k) => WEEK_KEY_RE.test(k)), current])].sort().reverse();
  const keep = new Set(all.slice(0, KEEP_WEEKS));
  keep.add(current);
  return { keep: [...keep].sort(), drop: all.filter((k) => !keep.has(k)).sort() };
}

/** A fresh state, and the shape check of a parsed one. */
export const freshState = () => ({ kind: STATE_KIND, v: 1, setup: null, setup_refused: null, weeks: {}, last: null });
export function stateShapeOk(s) {
  return plainObject(s) && s.kind === STATE_KIND && s.v === 1 && (s.setup === null || plainObject(s.setup)) && plainObject(s.weeks)
    && (s.last === null || plainObject(s.last)) && (s.setup_refused === undefined || s.setup_refused === null || plainObject(s.setup_refused));
}

// ── the state, the lock and the directories (L3) ─────────────────────────────────────────────────────────────────────
/** The one reader of the state file and its shape check: {state}, {absent}, {unreadable: code} or {malformed: why}. */
function readState(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) {
    return e?.code === 'ENOENT' ? { absent: true } : { unreadable: String(e?.code ?? 'EUNKNOWN') };
  }
  let v;
  try { v = JSON.parse(text); } catch { return { malformed: 'not JSON' }; }
  if (!stateShapeOk(v)) return { malformed: `not a ${STATE_KIND} v1 file` };
  return { state: v };
}
function loadState(file) {
  const r = readState(file);
  if (r.absent === true) return { state: freshState() };
  if (r.unreadable !== undefined) return { unreadable: `cannot read ${STATE_FILE}: ${r.unreadable}` };
  if (r.malformed !== undefined) return { unreadable: `${STATE_FILE} is ${r.malformed}` };
  return { state: r.state };
}
/** The one line `--state-verdict` prints: ok, absent, `unreadable <code>` or `malformed <why>`. */
export function stateVerdictOf(file) {
  const r = readState(file);
  if (r.absent === true) return 'absent';
  if (r.unreadable !== undefined) return `unreadable ${r.unreadable}`;
  if (r.malformed !== undefined) return `malformed ${r.malformed}`;
  return 'ok';
}
/** Whole, by write-to-temp-then-rename. */
function saveState(file, state) {
  const tmp = `${file}.tmp.${process.pid}`;
  const fd = openSync(tmp, 'w', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
}
/** An exclusive lock holding the pid; a lock whose pid is dead is stale and taken over. null when a live run holds it. */
function takeLock(file, isAlive) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      try { writeFileSync(fd, `${process.pid}\n`); } finally { closeSync(fd); }
      return { release() { try { if (Number(readFileSync(file, 'utf8').trim()) === process.pid) unlinkSync(file); } catch { /* already gone */ } } };
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      let pid = NaN;
      try { pid = Number(readFileSync(file, 'utf8').trim()); } catch { /* vanished: retry */ }
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) return null;
      try { unlinkSync(file); } catch { /* raced: the retry judges what is there */ }   // a dead pid, or no pid: stale
    }
  }
  return null;
}
const lstatOrNull = (p) => { try { return lstatSync(p); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; } };

// ── the children (L3) ────────────────────────────────────────────────────────────────────────────────────────────────
/** One child to its end: its exit code, stdout bytes and stderr text. The environment is by name (HOME, LANG, PATH), so no
 *  child carries CLAUDECODE or TMUX_PANE. Its stderr is relayed, so the journal reads what the driver said. */
function runChild(ctx, file, args, { input = null, timeoutMs = 0 } = {}) {
  const env = {};
  for (const k of ['HOME', 'LANG', 'PATH']) if (ctx.env[k] !== undefined) env[k] = ctx.env[k];
  return new Promise((resolve) => {
    let child;
    try { child = spawn(file, args, { env, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] }); } catch (e) { resolve({ error: String(e?.message ?? e) }); return; }
    ctx.child = child;
    if (input !== null) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    const timer = timeoutMs > 0 ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;
    const out = [];
    let err = '';
    child.stdout.on('data', (b) => out.push(b));
    child.stderr.on('data', (b) => { err += b.toString('utf8'); ctx.err(b.toString('utf8')); });
    child.on('error', (e) => { clearTimeout(timer); ctx.child = null; resolve({ error: String(e?.message ?? e) }); });
    child.on('close', (code, signal) => { clearTimeout(timer); ctx.child = null; resolve({ code, signal, stdout: Buffer.concat(out), stderr: err }); });
  });
}

/** The class of a stop: a word a resume cures is `waiting`, any other is `refused`. */
const stopOf = (word, detail) => ({ stop: { outcome: RESUMABLE_WORDS.includes(word) ? 'waiting' : 'refused', word, detail: oneLine(detail), driver: true } });
const failedStop = (word, detail) => ({ stop: { outcome: 'failed', word, detail: oneLine(detail), driver: false } });

/** One driver step: `node --no-warnings <driver> <sub> <flags>`. Resolves {sha, stdout} or {stop}. */
async function driverStep(ctx, sub, flags, { wantSha = true } = {}) {
  const r = await runChild(ctx, ctx.node, ['--no-warnings', ctx.driver, sub, ...flags]);
  if (r.error !== undefined) return failedStop('spawn-failed', `${sub}: ${r.error}`);
  const lines = stepLinesOf(r.stderr);
  if (r.code === 0) {
    if (wantSha && lines.sha === null) return failedStop('no-sha-line', `${sub} exited 0 with no sha256 line`);
    return { sha: lines.sha, stdout: r.stdout };
  }
  if (r.code === 2 && lines.refusal !== null) return stopOf(lines.refusal.word, lines.refusal.detail);
  const last = String(r.stderr).split('\n').map((l) => l.trim()).filter((l) => l !== '').pop() ?? '';
  return failedStop('driver-failed', `${sub} ${r.signal !== null && r.signal !== undefined ? `killed by ${r.signal}` : `exited ${r.code}`}: ${last}`);
}

// ── the acts (L4) ────────────────────────────────────────────────────────────────────────────────────────────────────
const flagsOf = (o) => Object.entries(o).flatMap(([k, v]) => (v === true ? [`--${k}`] : [`--${k}`, String(v)]));

/** The roster's eligible account ids, in roster order: not hidden, `exec.kind` upstream or generated, telemetry neither
 *  openrouter nor codex. Pure.  @param {unknown[]} accounts */
export function eligibleAccountsOf(accounts, disabled = () => false) {
  return accounts.filter((a) => plainObject(a) && typeof a.id === 'string' && a.id !== '' && a.hidden !== true && plainObject(a.exec)
    && ELIGIBLE_KINDS.includes(a.exec.kind) && !EXCLUDED_TELEMETRY.includes(a.telemetry) && !disabled(a.id)).map((a) => a.id);
}
/** The operator's per-account lane kill switch, read as ccd's `_lane_enabled` reads it: `$HOME/.cc-sessions/<id>-disabled` is a
 *  regular file (`-f`, which follows a link). An id that is not a plain name is read as disabled (never a path out of the registry). */
function laneDisabled(home, id) {
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id.startsWith('.')) return true;
  try { return statSync(path.join(home, '.cc-sessions', `${id}-disabled`)).isFile(); } catch { return false; }
}
/** The candidates with room, the lowest `seven` first, ties in roster order. Pure.
 *  @param {Array<{ id: string, room: boolean, seven?: number }>} readings  in roster order */
export function roomOrderOf(readings) {
  return readings.map((r, i) => ({ ...r, i })).filter((r) => r.room).sort((x, y) => (x.seven - y.seven) || (x.i - y.i)).map((r) => r.id);
}
function candidatesOf(home) {
  let roster;
  try { roster = JSON.parse(readFileSync(path.join(home, '.ccrc', 'accounts.json'), 'utf8')); } catch (e) {
    return { error: `the roster is unreadable (${e?.code ?? 'not JSON'})` };
  }
  if (!plainObject(roster) || !Array.isArray(roster.accounts)) return { error: 'the roster has no accounts list' };
  return { ids: eligibleAccountsOf(roster.accounts, (id) => laneDisabled(home, id)) };
}
/** The driver's own reading of an account's room: its limits row, decided by decideLimits at the driver's defaults. */
function roomOf(ctx, id) {
  const nowMs = ctx.now();
  let read;
  try { read = readLimitsRow(ctx.home, id, Math.floor(nowMs / 1000)); } catch { return { room: false, word: 'limits-stale', detail: 'unusable account id' }; }
  const stop = decideLimits(read, { nowMs, thresholdPct: LIMITS_DEFAULTS.threshold_pct, maxAgeMs: LIMITS_DEFAULTS.max_age_ms });
  return stop === null ? { room: true, seven: read.row.seven } : { room: false, word: stop.word, detail: stop.detail };
}
const noRoomStop = (detail) => ({ stop: { outcome: 'waiting', word: 'no-room', detail: oneLine(detail), driver: false } });
function freshSetupOut(root) {
  for (let n = 1; ; n += 1) {
    const out = path.join(root, `setup.${n}`);
    if (lstatOrNull(out) === null) return out;
  }
}

async function actSetup(ctx) {
  const c = candidatesOf(ctx.home);
  if (c.error !== undefined) return stopOf('no-account-admitted', c.error);
  if (c.ids.length === 0) return stopOf('no-account-admitted', 'the roster names no eligible account');
  // chosen once, from the placement reading: the lowest `seven` among those with room first, the next on account-refused
  const readings = c.ids.map((id) => ({ id, ...roomOf(ctx, id) }));
  const order = roomOrderOf(readings);
  if (order.length === 0) return noRoomStop(readings.map((r, i) => `${i + 1}: ${r.word}`).join(', '));
  let lastDetail = '';
  for (const id of order) {
    const out = freshSetupOut(ctx.root);
    const r = await driverStep(ctx, 'setup', flagsOf({ out, account: id, budget: BUDGET, 'settings-mode': SETTINGS_MODE,
      'writer-model': WRITER_MODEL, 'judge-model': JUDGE_MODEL, 'arm-model': ARM_MODEL }));
    if (r.stop !== undefined && r.stop.word === 'account-refused') { lastDetail = r.stop.detail; continue; }
    if (r.stop !== undefined) return r;
    ctx.state.setup = { out, account: id, setup_sha256: r.sha, sourced_sha256: null, frozen_sha256: null, marker_sha256: null, headless: null };
    return { ok: true };
  }
  return stopOf('no-account-admitted', `every candidate with room was refused (${lastDetail})`);
}
const setupFile = (s) => path.join(s.out, SETUP_FILE);
async function actSource(ctx) {
  const s = ctx.state.setup;
  const r = await driverStep(ctx, 'source', flagsOf({ out: s.out, setup: setupFile(s), 'setup-sha256': s.setup_sha256 }));
  if (r.stop !== undefined) return r;
  s.sourced_sha256 = r.sha;
  return { ok: true };
}
async function actFreeze(ctx) {
  const s = ctx.state.setup;
  const r = await driverStep(ctx, 'freeze', flagsOf({ out: s.out, setup: setupFile(s), 'setup-sha256': s.setup_sha256,
    sourced: path.join(s.out, 'quiz', 'sourced.json'), 'sourced-sha256': s.sourced_sha256 }));
  if (r.stop !== undefined) return r;
  s.frozen_sha256 = r.sha;
  return { ok: true };
}
/** `marker`: its text on stdout and its sha on stderr; the stdout bytes must hash to the printed sha. */
async function markerOf(ctx) {
  const s = ctx.state.setup;
  const r = await driverStep(ctx, 'marker', flagsOf({ frozen: path.join(s.out, 'quiz', 'frozen.json'), 'frozen-sha256': s.frozen_sha256 }));
  if (r.stop !== undefined) return r;
  if (sha256Of(r.stdout) !== r.sha) return stopOf('marker-sha-mismatch', `the marker text hashes to ${sha256Of(r.stdout)}, the driver printed ${r.sha}`);
  return { text: r.stdout, sha: r.sha };
}
async function actMarker(ctx) {
  const m = await markerOf(ctx);
  if (m.stop !== undefined) return m;
  ctx.state.setup.marker_sha256 = m.sha;
  return { ok: true };
}
/** The marker's text on disk, or the refusal that says why it cannot be judged: a link, a non-regular file, a read past the
 *  grammar's bound or text the history lib's parser refuses is `headless-on-unreadable`. */
function readHeadlessOn(target, st) {
  if (!st.isFile() || st.isSymbolicLink()) return { stop: stopOf('headless-on-unreadable', 'headless-on is not a regular file; it is left as it is').stop };
  let text;
  try {
    const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const buf = Buffer.alloc(HEADLESS_LIST_MAX_BYTES + 1);
      let n = 0;
      for (;;) { const k = readSync(fd, buf, n, buf.length - n, null); if (k === 0) break; n += k; if (n > HEADLESS_LIST_MAX_BYTES) break; }
      if (n > HEADLESS_LIST_MAX_BYTES) return { stop: stopOf('headless-on-unreadable', 'headless-on is over the grammar\'s size bound; it is left as it is').stop };
      text = buf.subarray(0, n).toString('utf8');
    } finally { closeSync(fd); }
  } catch { return { stop: stopOf('headless-on-unreadable', 'headless-on cannot be read as a regular file; it is left as it is').stop }; }
  const parsed = parseHeadlessList(text);
  if (parsed.ok !== true) return { stop: stopOf('headless-on-unreadable', 'headless-on does not parse as a headless list; it is left as it is').stop };
  return { parsed };
}
/** An existing marker is kept when it names this store and lists every frozen family (extra pairs are fine); else refused. */
function judgeHeadlessOn(existing, expected) {
  if (existing.storeId !== expected.storeId) return { stop: stopOf('headless-on-incomplete', 'headless-on names another store; it is left as it is').stop };
  const has = (p) => existing.pairs.some((q) => q.ccrcId === p.ccrcId && q.generation === p.generation);
  if (!expected.pairs.every(has)) return { stop: stopOf('headless-on-incomplete', 'headless-on does not list every frozen family; it is left as it is').stop };
  return { ok: true };
}
/** The headless marker, written ONCE and ATOMICALLY: the bytes into a temp file under the quiz root (0600), a hard link to
 *  the target (it fails if the target exists, so it never clobbers), the temp removed. EEXIST is a racer: judge its file as
 *  any existing one. EXDEV is `headless-on-cross-device`. The write is journalled once, in `journal.log`. */
async function actHeadless(ctx) {
  const s = ctx.state.setup;
  const m = await markerOf(ctx);
  if (m.stop !== undefined) return m;
  if (m.sha !== s.marker_sha256) return stopOf('marker-sha-mismatch', `the marker now hashes to ${m.sha}, the setup recorded ${s.marker_sha256}`);
  const expected = parseHeadlessList(m.text.toString('utf8'));
  if (expected.ok !== true) return stopOf('marker-unparseable', 'the marker the driver printed does not parse as a headless list');
  const dir = path.join(ctx.home, '.ccrc', 'history');
  const dst = lstatOrNull(dir);
  if (dst === null || !dst.isDirectory()) return stopOf('history-store-absent', `${dir} is not a directory; the runner never makes it`);
  const target = path.join(dir, 'headless-on');
  const tmp = path.join(ctx.root, `headless-on.tmp.${process.pid}`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const st = lstatOrNull(target);
    if (st === null) {
      try { unlinkSync(tmp); } catch { /* none left by a crashed run */ }
      const fd = openSync(tmp, 'wx', 0o600);
      try { writeFileSync(fd, m.text); fsyncSync(fd); } finally { closeSync(fd); }   // the bytes are on disk before the link names them
      journalHeadless(ctx, expected, 'writing');   // the intent first: a crash after the link leaves a journalled marker, never an unjournalled one
      try {
        if (ctx.beforeHeadlessWrite !== undefined) ctx.beforeHeadlessWrite();   // a test's seam: the window between the probe and the link
        ctx.link(tmp, target);
      } catch (e) {
        journalNote(ctx, `headless-on not written (${e?.code ?? 'error'})`);
        if (e?.code === 'EEXIST') continue;   // a racer wrote it: judge what is there
        if (e?.code === 'EXDEV') return stopOf('headless-on-cross-device', 'the quiz root and the history store are on different devices; nothing was written');
        throw e;
      } finally {
        try { unlinkSync(tmp); } catch { /* gone */ }
      }
      s.headless = 'written';
      return { ok: true };
    }
    const read = readHeadlessOn(target, st);
    if (read.stop !== undefined) return { stop: read.stop };
    const verdict = judgeHeadlessOn(read.parsed, expected);
    if (verdict.stop !== undefined) return { stop: verdict.stop };
    s.headless = 'present';
    return { ok: true };
  }
  return stopOf('headless-on-unreadable', 'headless-on kept changing under the runner; it is left as it is');
}
/** One line: the ISO time, `headless-on written`, the store id and the frozen families' ccrc ids and generations. No history content. */
function journalHeadless(ctx, expected, word) {
  const fams = expected.pairs.map((p) => `${p.ccrcId}/${p.generation === '' ? '-' : p.generation}`).join(' ');
  journalNote(ctx, `headless-on ${word} store ${expected.storeId} families ${fams}`);
}
function journalNote(ctx, text) {
  try {
    appendFileSync(path.join(ctx.root, 'journal.log'), `${new Date(ctx.now()).toISOString()} ${text}\n`, { mode: 0o600 });
  } catch (e) { ctx.err(`${PREFIX}: journal: ${e?.code ?? e}\n`); }
}

const weekPaths = (ctx, w) => {
  const s = ctx.state.setup;
  return { out: w.out, setup: setupFile(s), frozen: path.join(s.out, 'quiz', 'frozen.json'), summary: path.join(w.out, SUMMARY_FILE),
    judged: path.join(w.out, JUDGED_FILE), report: path.join(w.out, REPORT_FILE) };
};
const baseFlags = (ctx, p) => ({ out: p.out, setup: p.setup, 'setup-sha256': ctx.state.setup.setup_sha256, frozen: p.frozen, 'frozen-sha256': ctx.state.setup.frozen_sha256 });

/** arms, judge and report on the week's directory. A word a resume cures leaves the week running; any other word closes it. */
async function actWeek(ctx, act) {
  let w = ctx.state.weeks[ctx.weekKey];
  if (w === undefined) {
    mkdirSync(path.join(ctx.root, 'weeks'), { recursive: true, mode: 0o700 });
    w = { out: path.join(ctx.root, 'weeks', ctx.weekKey), state: 'running', arms_sha256: null, judged_sha256: null, report_sha256: null,
      run_id: null, baseline: false, word: null };
    ctx.state.weeks[ctx.weekKey] = w;
    ctx.save(null);   // the row stands before the driver runs, so a crash mid-arms resumes this directory
  }
  if (act === 'arms' || act === 'judge') {   // the spend steps: the setup's account must still have room (report and record spend nothing)
    if (laneDisabled(ctx.home, ctx.state.setup.account)) {
      return { stop: { outcome: 'waiting', word: 'account-disabled', detail: 'the setup\'s account is switched off by the operator\'s lane kill switch', driver: false } };
    }
    const r = roomOf(ctx, ctx.state.setup.account);
    if (!r.room) return noRoomStop(`the setup's account: ${r.word} ${r.detail}`);
  }
  const p = weekPaths(ctx, w);
  const arms = { 'arms-summary': p.summary, 'arms-summary-sha256': w.arms_sha256 };
  const flags = act === 'arms' ? { ...baseFlags(ctx, p), ...(w.repilot === true ? { repilot: true } : {}) }
    : act === 'judge' ? { ...baseFlags(ctx, p), ...arms }
      : { ...baseFlags(ctx, p), ...arms, judged: p.judged, 'judged-sha256': w.judged_sha256 };
  const r = await driverStep(ctx, act, flagsOf(flags));
  if (r.stop !== undefined) {
    if (r.stop.driver && r.stop.outcome === 'refused') {
      if (act === 'arms' && r.stop.word === PILOT_FAILED) w.pilots = [...failedPilotsOf(w, 'prior'), { release: pinnedReleaseOf(w.out), at_ms: ctx.now() }];
      w.state = 'failed';
      w.word = r.stop.word;
    }
    return r;
  }
  w[act === 'arms' ? 'arms_sha256' : act === 'judge' ? 'judged_sha256' : 'report_sha256'] = r.sha;
  return { ok: true };
}

/** `ccrc quiz-record --report <file> --sha <sha> --confirm`: confirmed, or the week stays running and the record is retried. */
async function actRecord(ctx) {
  const w = ctx.state.weeks[ctx.weekKey];
  const r = await runChild(ctx, ctx.verb, ['quiz-record', '--report', path.join(w.out, REPORT_FILE), '--sha', w.report_sha256, '--confirm']);
  if (r.error !== undefined) return failedStop('spawn-failed', `quiz-record: ${r.error}`);
  if (r.code !== 0) {
    const f = recordWordOf(r.stderr);
    return { stop: { outcome: 'refused', word: f.word, detail: f.detail, driver: false } };
  }
  const c = confirmedLineOf(r.stdout.toString('utf8'));
  if (c === null) return { stop: { outcome: 'refused', word: 'record-unconfirmed', detail: 'quiz-record exited 0 without a "confirmed run" line', driver: false } };
  if (c.sha12 !== w.report_sha256.slice(0, 12)) {
    return { stop: { outcome: 'refused', word: 'record-sha-mismatch', detail: `the verb confirmed report sha ${c.sha12}, not ${w.report_sha256.slice(0, 12)}`, driver: false } };
  }
  w.state = 'confirmed';
  w.run_id = c.runId;
  w.baseline = c.baseline;
  return { ok: true };
}

/** The release the driver pinned in a week's directory (its own record of the release the week's arms, and its pilot, ran
 *  on), or null when the pin cannot be read or is not the driver's. */
function pinnedReleaseOf(out) {
  let p = null;
  try { p = JSON.parse(readFileSync(path.join(out, RELEASE_PIN_FILE), 'utf8')); } catch { return null; }
  return plainObject(p) && p.kind === RELEASE_PIN_KIND && p.v === 1 && typeof p.ccrc_release === 'string' && p.ccrc_release !== '' ? p.ccrc_release : null;
}
/** A week's failed pilots so far. A row this runner wrote since ruling 5 carries them (`pilots`); an older row closed on the
 *  pilot word carries none, so it stands for one failed pilot whose release is the week's pin. `prior` reads the row as it
 *  was before the closure being recorded: an older row then contributes nothing but what it carries. */
function failedPilotsOf(w, when = 'now') {
  if (Array.isArray(w.pilots)) return w.pilots;
  if (when === 'now' && w.state === 'failed' && w.word === PILOT_FAILED) return [{ release: pinnedReleaseOf(w.out), at_ms: null }];
  return [];
}
/** Ruling 5's act: when repilotOf says so, this ISO week's row is reopened for `arms --repilot`, and the reopening journalled. */
function reopenForPilot(ctx) {
  const w = ctx.state.weeks[ctx.weekKey];
  if (!plainObject(w) || w.state !== 'failed') return;
  const pilots = failedPilotsOf(w);
  const release = readReleaseStamp(ctx.home);
  const d = repilotOf({ week: w, pilots, release });
  if (!d.repilot) return;
  w.pilots = pilots;
  w.state = 'running';
  w.word = null;
  w.repilot = true;
  journalNote(ctx, `week ${ctx.weekKey} piloted again: pilot ${d.pilot} of ${PILOTS_MAX}, release ${release.tag}, after ${pilots.map((p) => p.release).join(' ')}`);
}

const ACT_FN = Object.freeze({ setup: actSetup, source: actSource, freeze: actFreeze, marker: actMarker, headless: actHeadless,
  arms: (c) => actWeek(c, 'arms'), judge: (c) => actWeek(c, 'judge'), report: (c) => actWeek(c, 'report'), record: actRecord });

/** The week directories older than the newest KEEP_WEEKS, removed only when the directory holds the driver module's
 *  marker, by a path built from the literal root and a validated key; the state rows of those weeks go too. Never the setup. */
function prune(ctx) {
  const weeksDir = path.join(ctx.root, 'weeks');
  let names = [];
  try { names = readdirSync(weeksDir); } catch (e) { if (e?.code !== 'ENOENT') throw e; }
  const { keep, drop } = pruneSplitOf([...names, ...Object.keys(ctx.state.weeks)], ctx.weekKey);
  for (const key of drop) {
    if (!WEEK_KEY_RE.test(key)) continue;
    const dir = path.join(weeksDir, key);
    const st = lstatOrNull(dir);
    if (st !== null) {
      const mark = lstatOrNull(path.join(dir, OUT_MARKER));
      if (!st.isDirectory() || st.isSymbolicLink() || mark === null || !mark.isFile()) continue;   // not ours: leave it
      rmSync(dir, { recursive: true, force: true });
    }
    delete ctx.state.weeks[key];
  }
  for (const key of Object.keys(ctx.state.weeks)) if (!keep.includes(key)) delete ctx.state.weeks[key];
}

/** The trace `ccrc quiz-record` carries: `quiz-unattended <user> <role> <UTC time to the second>`; the user is cut to
 *  [A-Za-z0-9._-] (else `unknown`), the role is the ccrc.env file's CCRC_ROLE cut to lower-case letters (else `unknown`). */
function traceOf(ctx) {
  let user = '';
  try { user = userInfo().username.replace(/[^A-Za-z0-9._-]/g, ''); } catch { /* unknown */ }
  let role = '';
  try {
    const lines = readFileSync(path.join(ctx.home, '.ccrc', 'ccrc.env'), 'utf8').split('\n').filter((l) => /^\s*CCRC_ROLE=/.test(l));
    if (lines.length > 0) role = lines[lines.length - 1].slice(lines[lines.length - 1].indexOf('=') + 1).replace(/[^a-z]/g, '');
  } catch { /* unknown */ }
  return `quiz-unattended ${user === '' ? 'unknown' : user} ${role === '' ? 'unknown' : role} ${new Date(ctx.now()).toISOString().replace(/\.\d+Z$/, 'Z')}`;
}

// ── the status post (L4) ─────────────────────────────────────────────────────────────────────────────────────────────
/** The tick's `last`, posted with `ccrc-api quiz status --json -`. A failed post never fails the tick: `last.posted` records it. */
async function postStatus(ctx) {
  const last = ctx.state?.last;
  if (!plainObject(last)) return;
  const body = JSON.stringify({ week: last.week, act: last.act, outcome: last.outcome, word: last.word,
    detail: typeof last.detail === 'string' ? last.detail.slice(0, STATUS_DETAIL_MAX) : null, at: last.at_ms, account: ctx.state.setup?.account ?? null, by: traceOf(ctx) });
  let posted = false;
  try {
    const r = await runChild(ctx, ctx.client, ['quiz', 'status', '--json', '-'], { input: body, timeoutMs: POST_TIMEOUT_MS });
    if (r.error === undefined && r.code === 0) {
      try { posted = JSON.parse(r.stdout.toString('utf8'))?.ok === true; } catch { posted = false; }
    }
  } catch { posted = false; }
  last.posted = posted;
  try { ctx.save(null); } catch (e) { ctx.err(`${PREFIX}: status: ${e?.code ?? e}\n`); }
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A refusal before anything is read: one stderr line, exit 2, nothing written. */
function early(err, word, detail) {
  err(`${PREFIX}: ${word}: ${detail}\n`);
  return EXIT.REFUSED;
}

/** One tick. The refusals come FIRST (the session, then the pane), then umask 077, then the lock, then the acts in order
 *  until one stops or the week is done; `last` is written after every act.
 *  @param {{HOME?: string, TMUX_PANE?: string, LANG?: string, PATH?: string, CLAUDECODE?: string}} env
 *  @param {{ driver?: string, verb?: string, node?: string, now?: () => number, isAlive?: (pid: number) => boolean, err?: (s: string) => void, beforeHeadlessWrite?: () => void, link?: (a: string, b: string) => void, client?: string }} [deps] */
export async function main(env, deps = {}) {
  const err = deps.err ?? ((s) => { process.stderr.write(s); });
  if (env.CLAUDECODE !== undefined) return early(err, 'in-session', 'CLAUDECODE is set; the weekly quiz is the timer\'s, never a session\'s');
  if (env.TMUX_PANE !== undefined) return early(err, 'in-pane', 'TMUX_PANE is set; the weekly quiz is the timer\'s, never a pane\'s');
  if (typeof env.HOME !== 'string' || !path.isAbsolute(env.HOME)) return early(err, 'home-unset', 'HOME is not an absolute path');
  process.umask(0o077);
  const tree = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const now = deps.now ?? Date.now;
  const root = path.join(env.HOME, '.ccrc', 'quiz');
  const ctx = {
    env, err, now, home: env.HOME, root, weekKey: weekKeyOf(now()), child: null, stopping: false, state: null,
    node: deps.node ?? process.execPath, driver: deps.driver ?? path.join(tree, 'deploy', 'history-quiz-single.mjs'),
    verb: deps.verb ?? path.join(env.HOME, '.local', 'bin', 'ccrc'), save: null, beforeHeadlessWrite: deps.beforeHeadlessWrite, link: deps.link ?? linkSync,
    client: deps.client ?? path.join(env.HOME, '.local', 'bin', 'ccrc-api'),
  };
  const stateFile = path.join(root, STATE_FILE);
  const onSignal = () => { ctx.stopping = true; if (ctx.child !== null) ctx.child.kill('SIGTERM'); };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  let lock = null;
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    lock = takeLock(path.join(root, LOCK_FILE), deps.isAlive ?? pidAlive);
    if (lock === null) { err(`${PREFIX}: locked: another run holds ${LOCK_FILE}; this tick does nothing\n`); return EXIT.OK; }
    const loaded = loadState(stateFile);
    if (loaded.unreadable !== undefined) { err(`${PREFIX}: state-unreadable: ${loaded.unreadable}; nothing was changed\n`); return EXIT.OK; }
    ctx.state = loaded.state;
    ctx.save = (last) => {
      if (last !== null) ctx.state.last = { at_ms: now(), ...last };
      saveState(stateFile, ctx.state);
    };
    for (const sig of signals) process.on(sig, onSignal);
    const code = await run(ctx);
    await postStatus(ctx);
    return code;
  } catch (e) {
    err(`${PREFIX}: internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    try {
      if (ctx.state !== null && ctx.save !== null) {
        ctx.save({ week: ctx.weekKey, act: 'none', outcome: 'failed', word: 'internal-error', detail: oneLine(e instanceof Error ? e.message : e) });
        await postStatus(ctx);
      }
    } catch { /* the state file itself is the defect */ }
    return EXIT.INTERNAL;
  } finally {
    for (const sig of signals) process.off(sig, onSignal);
    if (lock !== null) lock.release();
  }
}

/** The spend guard: before ANY act (so before setup and before every week's arms and judge) the runner proves it can record: the
 *  status client is an executable regular file and the agent credential file (under the ccrc directory) is a regular file. By
 *  stat only: that file holds a secret and is never opened. null when both stand, else the detail naming which one is missing. */
function recordPathMissing(ctx) {
  let exec = false;
  try { const st = statSync(ctx.client); exec = st.isFile() && (st.mode & 0o111) !== 0; } catch { /* absent */ }
  if (!exec) return `the status client (${path.basename(ctx.client)}) is not an executable regular file; nothing was spent`;
  const e = lstatOrNull(path.join(ctx.home, '.ccrc', ['agent', 'env'].join('.')));
  if (e === null || !e.isFile()) return 'the agent credential file under the ccrc directory is not a regular file; nothing was spent';
  return null;
}

/** The acts, in order, until a stop or the week is done. */
async function run(ctx) {
  // the runner works the current ISO week only: a week still running when a new one starts is over
  for (const [key, w] of Object.entries(ctx.state.weeks)) {
    if (key !== ctx.weekKey && plainObject(w) && w.state === 'running') { w.state = 'failed'; w.word = 'week-ended'; }
  }
  reopenForPilot(ctx);
  for (;;) {
    const act = nextActOf(ctx.state, ctx.weekKey);
    const weekAct = ['arms', 'judge', 'report', 'record'].includes(act);
    const week = weekAct || act === 'done' ? ctx.weekKey : null;
    if (act === 'done') {
      const w = ctx.state.weeks[ctx.weekKey];
      const failed = w.state === 'failed';
      prune(ctx);
      ctx.save({ week, act: 'done', outcome: failed ? 'refused' : 'ok', word: failed ? (w.word ?? 'failed') : null, detail: failed ? 'the week is closed failed' : null });
      return EXIT.OK;
    }
    if (ctx.stopping) {
      ctx.save({ week, act, outcome: 'waiting', word: 'interrupted', detail: 'a stop signal arrived between acts' });
      return EXIT.OK;
    }
    const setupAct = SETUP_ACTS.includes(act);
    const latch = ctx.state.setup_refused;
    if (setupAct && plainObject(latch) && latch.week === ctx.weekKey) {
      // latched: this phase was refused this ISO week, so it is not tried again before the next one (at most one attempt a week)
      ctx.save({ week: null, act, outcome: 'refused', word: latch.word, detail: latch.detail });
      return EXIT.OK;
    }
    const missing = recordPathMissing(ctx);
    if (missing !== null) {
      ctx.save({ week, act, outcome: 'waiting', word: 'record-path-missing', detail: missing });
      return EXIT.OK;
    }
    const r = await ACT_FN[act](ctx);
    if (r.stop === undefined && setupAct) ctx.state.setup_refused = null;
    if (r.stop !== undefined && setupAct && r.stop.outcome === 'refused') {
      ctx.state.setup_refused = { word: r.stop.word, detail: r.stop.detail, week: ctx.weekKey };
    }
    if (r.stop !== undefined) {
      const w = ctx.state.weeks[ctx.weekKey];
      const closed = weekAct && w !== undefined && w.state === 'failed';
      if (closed) prune(ctx);
      ctx.save({ week, act, outcome: r.stop.outcome, word: r.stop.word, detail: r.stop.detail });
      return r.stop.outcome === 'failed' ? EXIT.INTERNAL : EXIT.OK;
    }
    ctx.save({ week, act, outcome: 'ok', word: null, detail: null });
  }
}

// The entry guard stays the LAST block of this file. Importing the module (the tests do) runs nothing. The exit code is set,
// never forced, so stderr drains. main gets a by-name projection of the environment, never process.env whole.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href && process.argv[2] === '--state-verdict') {
  // Read-only: it reads only this runner's own state file, with no lock and no child, and writes nothing, so it may run where a
  // tick refuses (in a session or a pane): doctor asks it from either.
  const home = process.env.HOME;
  process.stdout.write(`${typeof home === 'string' && path.isAbsolute(home) ? stateVerdictOf(path.join(home, '.ccrc', 'quiz', STATE_FILE)) : 'unreadable EHOME'}\n`);
} else if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main({ HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG,
    PATH: process.env.PATH, CLAUDECODE: process.env.CLAUDECODE });
}
