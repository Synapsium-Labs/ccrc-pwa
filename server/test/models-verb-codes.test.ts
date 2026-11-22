// What this guards: the Models sheet words every refusal code that `ccrc models <lane> hold|release|revert` prints
// (`VERB_CODE_WORDS`, pwa/src/accounts/modelsSheetWords.ts, a hand-kept list). This scan reads the files that print
// those codes, deploy/models-op.mjs, its Anthropic arm deploy/models-anthropic.mjs and the lane-lock layer of ccd/ccrc, as text, and reds when a printed code has
// neither a sentence there nor an entry in NOT_FROM_THE_ACTS below, so a new code turns something red.
// Why a SERVER test: a change to deploy/ or ccd/ does not reach the PWA tests on a fast pull-request run, but it does
// reach the server's tree-reading tests.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p: string[]): string => readFileSync(path.join(REPO, ...p), 'utf8');

/** Every code models-op.mjs can print as an error, by the shapes it uses: `refuse(<n>, '<code>'`, an `err: ['<code>'`
 *  tuple, a `return ['<code>',` tuple, and the third argument of `writeJsonFile(…, '<code>');`. */
function modelsOpCodes(src: string): Set<string> {
  const out = new Set<string>();
  const shapes = [
    /\brefuse\(\s*\d+,\s*'([a-z][a-z0-9-]*)'/g,
    /\berr: \['([a-z][a-z0-9-]*)'/g,
    /\breturn \['([a-z][a-z0-9-]*)',/g,
    /\bwriteJsonFile\(.*,\s*'([a-z][a-z0-9-]*)'\)\s*;/g,
  ];
  for (const re of shapes) for (const m of src.matchAll(re)) out.add(m[1]);
  return out;
}

/** A shell function's body: from its `name() {` line to the next line that is a lone `}`. */
function functionBody(src: string, name: string): string {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`${name}() {`));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && l === '}');
  return lines.slice(start, end < 0 ? lines.length : end + 1).join('\n');
}

/** The lane-lock layer's words: every `MODELS_LOCK_ERR=<word>`, and the `_models_refuse <word>` calls inside
 *  `_models_answer` and `_models_answer_locked` only (ccd/ccrc prints many codes for other verbs). */
function lockLayerCodes(ccrc: string): Set<string> {
  const out = new Set<string>();
  for (const m of ccrc.matchAll(/\bMODELS_LOCK_ERR=([a-z][a-z0-9-]*)\b/g)) out.add(m[1]);
  for (const fn of ['_models_answer', '_models_answer_locked']) {
    for (const m of functionBody(ccrc, fn).matchAll(/\b_models_refuse ([a-z][a-z0-9-]*) /g)) out.add(m[1]);
  }
  return out;
}

/** The keys of `VERB_CODE_WORDS`, read from the PWA source as text. */
function sentenceKeys(words: string): Set<string> {
  const at = words.indexOf('export const VERB_CODE_WORDS');
  const end = words.indexOf('\n};', at);
  const out = new Set<string>();
  if (at < 0 || end < 0) return out;
  for (const m of words.slice(at, end).matchAll(/^\s*'([a-z][a-z0-9-]*)':/gm)) out.add(m[1]);
  return out;
}

/** Printed codes with neither a sentence nor an exclusion. */
function unworded(printed: Set<string>, worded: Set<string>, excluded: Set<string>): string[] {
  return [...printed].filter((c) => !worded.has(c) && !excluded.has(c)).sort();
}

/** Codes the two files print that hold, release and revert can NOT print: each belongs to another op. Decided by reading
 *  main's dispatcher (hold/release/revert go from the shared prelude, through the `no-registry` gate, to `holdOp` or
 *  `revertOp` and nothing else) and ccd's `hold|release|revert` arm. When in doubt a code is reachable and has a sentence. */
const NOT_FROM_THE_ACTS: Readonly<Record<string, string>> = {
  'bad-argv': 'argv shape: ccd\'s hold|release|revert arm composes exactly --file --id --class from checked values, so readPairs cannot refuse it; other ops take free-form keys',
  'bad-model-id': 'set-class, set-window, discovery and advance-commit check a model id; the acts take none',
  'bad-window': 'set-window\'s token count',
  'unknown-window-model': 'set-window and clear-window',
  'above-max-context': 'set-window',
  'windows-unreadable': 'the two window ops and lower-windows refuse on the windows file; the acts read it as a reading, never a refusal',
  'windows-unwritable': 'the windows file is written by set-window, clear-window and lower-windows only',
  'stats-invalid': 'lower-windows reads a bridge stats file',
  'stats-unreadable': 'lower-windows reads a bridge stats file',
  'not-a-codex-lane': 'lower-windows and litellm',
  'class-unassigned': 'set-subagent and set-effort name a class that holds no model',
  'subagent-class-unsupported': 'set-subagent',
  'not-in-catalogue': 'set-class\'s model is checked against the catalogue',
  'not-discovered': 'set-class\'s model is checked against the discovery list',
  'no-suggestion': 'suggest and init\'s --suggested',
  'unknown-probe': 'init',
  'probe-declared': 'init',
  'codex-registry-needs-codex-lane': 'init',
  'never-probed': 'litellm',
  'template-invalid': 'litellm',
  'template-unreadable': 'litellm',
  'config-unwritable': 'litellm writes its --out file',
  'discovery-is-catalogue': 'discovery add and rm',
  'endpoints-required': 'discovery add on an openrouter lane',
  'endpoints-invalid': 'discovery add\'s endpoints answer',
  'no-allowed-provider': 'discovery add\'s ownership whitelist',
  'whitelist-absent': 'discovery add\'s ownership whitelist',
  'materialise-unreadable': 'materialise --check compares files on disk; the acts write through materialise and never check',
  'unwritable': 'rm\'s unlink loop',
  'aliases-invalid': 'aliases-refresh builds and writes the aliases file; the acts only read it',
  'aliases-unwritable': 'aliases-refresh writes the aliases file; the acts only read it',
  'not-an-anthropic-lane': 'aliases-refresh on a lane that is not an Anthropic lane',
};

const words = read('pwa', 'src', 'accounts', 'modelsSheetWords.ts');
// The op's codes are printed from two files: the op itself and its Anthropic arm (when that file stands; the arm was moved
// out of the op whole and its codes are the op's, so this reads both and the one set is the same wherever the code lives).
const opSource = (): string => ['models-op.mjs', 'models-anthropic.mjs']
  .filter((f) => existsSync(path.join(REPO, 'deploy', f))).map((f) => read('deploy', f)).join('\n');
const printedByOp = modelsOpCodes(opSource());
const printedByLock = lockLayerCodes(read('ccd', 'ccrc'));
const printed = new Set([...printedByOp, ...printedByLock]);
const worded = sentenceKeys(words);
const excluded = new Set(Object.keys(NOT_FROM_THE_ACTS));

describe('the codes hold, release and revert print all have a sentence on the Models sheet', () => {
  it('each extractor finds a real number of codes, so one that matches nothing reds', () => {
    expect(printedByOp.size).toBeGreaterThan(40);
    expect(printedByLock.size).toBeGreaterThanOrEqual(6);
    expect(worded.size).toBeGreaterThan(20);
    for (const c of ['lock-busy', 'install-incomplete', 'budget-deferred', 'bad-account-id', 'no-answer']) expect(printedByLock.has(c), c).toBe(true);
    for (const c of ['roster-absent', 'registry-unwritable', 'advance-unwritable', 'no-previous']) expect(printedByOp.has(c), c).toBe(true);
  });

  it('every printed code has a sentence or is named as another op\'s', () => {
    expect(unworded(printed, worded, excluded)).toEqual([]);
  });

  it('a code is never both worded and excluded', () => {
    expect([...worded].filter((c) => excluded.has(c))).toEqual([]);
  });

  it('every sentence and every exclusion names a code the scan found, so a stale entry reds', () => {
    expect([...worded].filter((c) => !printed.has(c)).sort()).toEqual([]);
    expect([...excluded].filter((c) => !printed.has(c)).sort()).toEqual([]);
  });

  it('PLANTED CONTROL: a new code in either file is reported as unworded', () => {
    const op = modelsOpCodes(`${opSource()}\n  return refuse(1, 'planted-new-code', 'x');\n`);
    expect(unworded(op, worded, excluded)).toEqual(['planted-new-code']);
    const lock = lockLayerCodes(`${read('ccd', 'ccrc')}\n  MODELS_LOCK_ERR=planted-lock-code\n`);
    expect(unworded(lock, worded, excluded)).toEqual(['planted-lock-code']);
    const planted = modelsOpCodes('function f() {\n  return refuse(1, \'planted-new-code\', `d`);\n}\n');
    expect(unworded(planted, new Set(), new Set())).toEqual(['planted-new-code']);
    expect(functionBody('a() {\n  _models_refuse x-y 1\n}\nb() {\n}\n', 'a')).toContain('x-y');
  });
});
