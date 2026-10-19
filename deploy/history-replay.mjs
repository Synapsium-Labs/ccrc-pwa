#!/usr/bin/env node
// deploy/history-replay.mjs: the ccrc history W2 replay driver (spec 2026-10-05 §10.2; W2 decisions W2-D50 to W2-D59).
//
// An L4 operator script. The operator runs it by hand, from a shell OUTSIDE tmux, on a named node. It admits one
// account from the roster, spawns Claude Code headless under one fixed contract, reads the stream-json those spawns
// print, and writes every output under the operator's --out directory. Refusing to run inside a pane is main's first
// act (W2-D51, W2-D45).
//
// Imports: node: built-ins, ../ccd/history/lib.mjs and ../shared/roster-json.mjs only. It never loads node:sqlite in
// any form: every store read W2 makes opens through store.mjs's read-only openReader (W2-D51), and
// history-replay.test.ts scans every deploy/history-*.mjs for it.
// Children: spawn with an argv array, never a shell, never a command string, and no env value in one (CodeQL's
// js/shell-command-injection-from-environment opens a review thread that blocks the merge).
// Environment: main gets the entry guard's by-name projection {HOME, TMUX_PANE, LANG}; nothing here passes
// process.env whole, and every other env read goes through main's env parameter.
// Never spelled here: the recall arm words, which reach a spawn as parameters (W2-D50), and the headless marker's
// path, which W2-5b reaches through lib's historyPaths.
// Its words: DRIVER_REASONS, frozen once here and nowhere else (W2-D59, W2-D12; D-5774). A refusal prints
// `ccrc history-replay: <word>: <detail>` on stderr and exits EXIT.REFUSED (2); a defect exits EXIT.INTERNAL (1).
// They are never lib REASONS: §8.7's table and SKILL.md do not list them. EXIT is imported, never declared (O14).
import { accessSync, appendFileSync, chmodSync, closeSync, constants, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path, { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { EXIT, blobOverDecodeCap, canonicalJson, redactField, sha256Hex } from '../ccd/history/lib.mjs';
import { rosterFromJson, RosterInvalid } from '../shared/roster-json.mjs';

// ── the driver's words (W2-D59) ───────────────────────────────────────────
/** Every word the driver refuses with, in one frozen list. The first sixteen are W2-D59's, in its order (each owner
 *  PR raises its own). The last nine are W2-4's nine words (five plan-chosen, four by coordinator ruling), each kept apart from a lib REASONS word by design
 *  (C-J): `args-invalid` (an argv the grammar refuses; lib's is `bad-args`), `in-pane` (TMUX_PANE is set; lib's is
 *  `headless-in-pane`), `roster-invalid` (accounts.json absent, unreadable or refused by rosterFromJson; lib's is
 *  `roster-unreadable`), `account-refused` (W2-D52's admission), `input-invalid` (an input whose shape is wrong: a
 *  step 0a file whose sha matched, or a family id lib's idOk refuses), and, by coordinator ruling, `code-unmeasured`
 *  (a gate_code file that cannot be read; --allow-code-change never stamps it), `version-unmeasured` (a Claude Code
 *  --version that cannot be measured), `tree-unmeasured` (a release stamp that cannot be read; `tree-moved` stays
 *  for a measured mismatch) and `wrapper-unmeasured` (a generated account's wrapper that cannot be read;
 *  `wrapper-moved` stays for a measured mismatch). */
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

// ── main ──────────────────────────────────────────────────────────────────
/** The pane first, then the grammar, then the handler. A refusal is one stderr line and EXIT.REFUSED; anything else
 *  thrown is a defect, one stderr line and EXIT.INTERNAL. Nothing is written to stdout here.
 *  @param {string[]} argv  @param {DriverEnv} env  @returns {Promise<number>} */
export async function main(argv, env) {
  try {
    const pane = paneRefusal(env);
    if (pane !== null) throw pane;
    process.umask(0o077);   // W2-D53: before any filesystem act, so every file and directory under --out is the operator's alone
    const { sub, flags } = parseArgs(argv);
    const handler = /** @type {(flags: Flags, env: DriverEnv) => Promise<number>} */ (HANDLERS.get(sub));
    return await handler(flags, env);
  } catch (e) {
    if (e instanceof DriverRefusal) {
      process.stderr.write(`ccrc history-replay: ${e.word}: ${e.detail}\n`);
      return EXIT.REFUSED;
    }
    process.stderr.write(`ccrc history-replay: internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return EXIT.INTERNAL;
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
/** A marker longer than this is not one the driver wrote: the bound on the one read of it. */
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
  mkdirSync(abs, { mode: 0o700 });
  writeFileSync(path.join(abs, OUT_MARKER), OUT_KIND, { mode: 0o600, flag: 'wx' });
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
  const marker = path.join(abs, OUT_MARKER);
  let ms;
  try { ms = lstatSync(marker); } catch (e) {
    if (e?.code === 'ENOENT') refuse('out-refused', 'marker-absent');
    throw e;
  }
  if (!ms.isFile() || ms.size > OUT_MARKER_MAX_BYTES) refuse('out-refused', 'marker-mismatch');
  let text = null;
  try { text = readFileSync(marker, 'utf8'); } catch { text = null; }   // a marker the driver cannot read back is not one it wrote
  if (text !== OUT_KIND) refuse('out-refused', 'marker-mismatch');
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
//     spawns spent. A finished job is never re-spawned, so the only double count is a run killed between its ledger
//     line and its run.json, and over-counting is the safe direction for a budget. A ledger that cannot be read
//     whole fails closed as budget-exhausted 'ledger-unreadable', never as 0.

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
  appendFileSync(`${out}/${SPEND_LEDGER}`, `${canonicalJson({ name, tokens, ts_ms: Date.now() })}\n`, { mode: 0o600 });
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
 *  over-counting is the budget's safe direction). 0 when no ledger exists yet. A ledger
 *  that is not a regular file, cannot be read, or holds a line recordSpend would not write (a torn last line
 *  included) throws DriverRefusal('budget-exhausted', 'ledger-unreadable').
 *  @param {string} out
 *  @returns {number} */
export function spentSoFar(out) {
  const file = `${out}/${SPEND_LEDGER}`;
  let st;
  try {
    st = lstatSync(file);
  } catch (e) {
    if (e?.code === 'ENOENT') return 0;
    refuse('budget-exhausted', 'ledger-unreadable');
  }
  if (!st.isFile()) refuse('budget-exhausted', 'ledger-unreadable');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    refuse('budget-exhausted', 'ledger-unreadable');
  }
  const rows = text.split('\n');
  if (rows.pop() !== '') refuse('budget-exhausted', 'ledger-unreadable');   // the last line was torn
  let sum = 0;
  for (const line of rows) {
    const row = spendRow(line);
    if (row === null) refuse('budget-exhausted', 'ledger-unreadable');
    sum += row.tokens;
  }
  return sum;
}

// ── W2-4 Task 5: the spawn contract and the batch runner (W2-D50, W2-D51, W2-D53, W2-D55) ─────────────────────
// The ONE way this driver runs Claude Code (spec §10.2 "Two arms": Launch, Environment, cwd, Flags, Tools; the
// writer and the judge "go through the driver's spawn contract", SE10). Every spawn is `spawn(launcher, argv)`
// with an argv array and no shell, a FRESH env built by spawnEnv from the allow-list (never a copy of the
// driver's own), an empty 0700 cwd made per run outside any git tree and removed after it, and stdin as the only
// input. Arm values arrive as parameters: this file never spells one (W2-5b's scan pins that).
// A run's files land under --out in a fixed order: the stream `<name>.jsonl`, then its spend line in the ledger,
// then `<name>.run.json` via tmp + rename. The run.json is the completion marker and comes LAST, so a run killed
// before it is spawned again on resume; if its ledger line had landed, the summed ledger counts both spawns (an
// over-count, the budget's safe direction). A run whose run.json exists is never spawned again (W2-D53, W2-D55).
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
  const dir = path.join(out, POISON_BIN_DIR);
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const st = lstatSync(dir);
  if (!st.isDirectory()) refuse('out-refused', `${POISON_BIN_DIR} is not a directory`);
  const gh = path.join(dir, 'gh');
  writeFileSync(gh, POISON_GH, { mode: 0o700 });
  chmodSync(gh, 0o700);
  return dir;
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
  // D-5803: a name whose stream file would be the spend ledger is refused, or openSync(streamPath, 'w') truncates it and the budget fails open.
  if (`${name}.jsonl` === SPEND_LEDGER) throw new TypeError(`launchRun: run name ${JSON.stringify(name)} would stream into the spend ledger ${SPEND_LEDGER}`);
  return { streamPath: path.join(out, `${name}.jsonl`), runJsonPath: path.join(out, `${name}.run.json`) };
}

/** The outcome of a job whose run.json exists (resume), or null when it has none. A run.json that does not
 *  parse, one recorded for another account, mode, model or settings mode, or a stream whose bytes changed since,
 *  refuses: a resumed batch builds on what was recorded, and only for the job that recorded it. */
function finishedOutcome(job) {
  const { streamPath, runJsonPath } = runPaths(job.out, job.name);
  let text;
  try {
    text = readFileSync(runJsonPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    refuse('out-refused', `run-json-unreadable ${job.name} ${e.code}`);
  }
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
  const stream = readFileSync(streamPath);
  if (sha256Hex(stream) !== rec.stream_sha256) refuse('out-refused', `run-stream-changed ${job.name}`);
  return {
    name: job.name, skipped: true, code: rec.code, signal: rec.signal, ms: rec.ms, cwd: rec.cwd, streamPath,
    facts: readStreamJson(stream.toString('utf8')), tokens: rec.tokens, unknownOptions: rec.unknown_options,
  };
}

/** One child, stdout straight into the stream file, stdin written whole, stderr kept to a bound; killed on its
 *  own pid when it outlives `timeoutMs` (SIGTERM, then SIGKILL after a grace). */
function runChild(launcher, argv, { cwd, childEnv, stdin, streamPath, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const fd = openSync(streamPath, 'w', 0o600);
    let child;
    try {
      child = spawn(launcher, argv, { cwd, env: childEnv, stdio: ['pipe', fd, 'pipe'] });
    } finally {
      closeSync(fd);
    }
    const errs = [];
    let kept = 0;
    child.stderr.on('data', (b) => {
      if (kept < STDERR_KEEP_BYTES) { errs.push(b.subarray(0, STDERR_KEEP_BYTES - kept)); kept += b.length; }
    });
    child.stdin.on('error', (e) => { if (e.code !== 'EPIPE') reject(e); });
    let killer = null;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      killer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); if (killer) clearTimeout(killer); reject(e); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (killer) clearTimeout(killer);
      resolve({ code, signal, stderr: Buffer.concat(errs).toString('utf8') });
    });
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
 *  segments of `[a-z0-9][a-z0-9._-]*`; a name whose stream would be `<out>/SPEND_LEDGER` is refused (D-5803).
 *  @param {{launch: object, mode: string, model: string, settingsMode: string, recall?: object, stdin: string,
 *    out: string, name: string, lang: string | undefined, timeoutMs?: number}} job */
export async function launchRun(job) {
  if (job === null || typeof job !== 'object' || !Object.hasOwn(job, 'lang')) {
    throw new TypeError("launchRun: a RunJob carries lang, the caller's LANG from main's env (undefined when unset)");
  }
  const done = finishedOutcome(job);
  if (done !== null) return done;
  const { launch, mode, model, settingsMode, recall, stdin, out, name, lang } = job;
  const timeoutMs = job.timeoutMs ?? RUN_TIMEOUT_MS;
  if (typeof stdin !== 'string') throw new TypeError('launchRun: stdin must be a string');
  const { streamPath, runJsonPath } = runPaths(out, name);
  const home = runHomeOf(launch);
  const argv = spawnArgv({ mode, model, settingsMode, home });
  const childEnv = spawnEnv({ mode, home, configDir: launch.configDir, poisonBin: ensurePoisonBin(out), lang, recall });
  mkdirSync(path.dirname(streamPath), { recursive: true, mode: 0o700 });
  const cwd = makeRunCwd();
  const t0 = Date.now();
  let res;
  try {
    res = await runChild(launch.launcher, argv, { cwd, childEnv, stdin, streamPath, timeoutMs });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  const ms = Date.now() - t0;
  const stream = readFileSync(streamPath);
  const facts = readStreamJson(stream.toString('utf8'));
  const tokens = spendTokens(facts);
  const unknownOptions = unknownOptionsIn(res.stderr);
  recordSpend(out, name, tokens);
  const rec = {
    kind: RUN_KIND, v: 1, name, account: launch.accountId, mode, model, settings_mode: settingsMode,
    code: res.code, signal: res.signal, ms, cwd, stream_sha256: sha256Hex(stream), tokens, unknown_options: unknownOptions,
  };
  const tmp = `${runJsonPath}.tmp-${process.pid}`;
  writeFileSync(tmp, canonicalJson(rec) + '\n', { mode: 0o600 });
  renameSync(tmp, runJsonPath);
  return { name, skipped: false, code: res.code, signal: res.signal, ms, cwd, streamPath, facts, tokens, unknownOptions };
}

/** Run up to BATCH_MAX jobs, at most `concurrency` (<= CONCURRENCY_MAX) at once, calling `gate` before each spawn
 *  (Task 6's limits and budget stop). The gate is required: a missing one is a TypeError before any spawn, so the
 *  stop is never opt-in. A finished job is skipped without the gate. The first throw, the gate's
 *  included, stops the batch: no further spawn starts, a run already started finishes and is recorded, and the
 *  throw is rethrown, so a re-run resumes. */
export async function runBatch(jobs, opts = {}) {
  if (typeof opts.gate !== 'function') throw new TypeError('runBatch: opts.gate is required (Task 6\'s batchGate, or a test\'s explicit no-op): no batch spawns ungated');
  if (!Array.isArray(jobs) || jobs.length > BATCH_MAX) throw new TypeError(`runBatch: a batch is at most ${BATCH_MAX} jobs`);
  const concurrency = opts.concurrency ?? CONCURRENCY_MAX;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > CONCURRENCY_MAX) throw new TypeError(`runBatch: concurrency must be 1 to ${CONCURRENCY_MAX}`);
  const names = jobs.map((j) => path.join(j.out, j.name));
  if (new Set(names).size !== names.length) throw new TypeError('runBatch: two jobs share one --out and name');
  const gate = opts.gate;
  const outcomes = new Array(jobs.length);
  let next = 0;
  let stop = null;
  const lane = async () => {
    while (stop === null && next < jobs.length) {
      const i = next++;
      try {
        const done = finishedOutcome(jobs[i]);
        if (done !== null) { outcomes[i] = done; continue; }
        gate();
        outcomes[i] = await launchRun(jobs[i]);
      } catch (e) {
        if (stop === null) stop = { e };
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, lane));
  if (stop !== null) throw stop.e;
  return outcomes;
}

// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised
// when main runs. Importing the module (the tests do) runs nothing. The exit code is set, never forced, so stderr drains.
// main gets a by-name projection of the environment, never process.env whole; an unset name stays undefined (W2-D45).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2), { HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG });
}
