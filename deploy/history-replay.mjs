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
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EXIT } from '../ccd/history/lib.mjs';

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

// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised
// when main runs. Importing the module (the tests do) runs nothing. The exit code is set, never forced, so stderr drains.
// main gets a by-name projection of the environment, never process.env whole; an unset name stays undefined (W2-D45).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2), { HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG });
}
