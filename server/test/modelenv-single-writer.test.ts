// §6.1 and §12: `shared/modelenv.mjs` is the ONLY file in this tree that writes
// `ANTHROPIC_DEFAULT_*_MODEL` keys, or the eighth key
// `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (§6.1, amended 2026-09-08), into a settings
// file.
//
// It needs its own test because `server/test/single-definition.test.ts`'s scan
// filters `.tsx?` and would never see a second `.mjs` writer — and a second
// writer is exactly what the account-connections wave's settings-block writer
// would be if it grew its own copy instead of calling this one, which its plan's
// Task 25 says it will. Two writers of these eight variables is two opinions
// about what a lane routes to, resolved by whichever ran last.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** Every tracked source file, whatever its language. `git ls-files` rather than
 *  a directory walk so nothing generated, ignored or vendored can enter — and
 *  deliberately NOT filtered by extension, which is the blind spot this exists
 *  to close. */
function tracked(): string[] {
  return execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((p) => !p.startsWith('docs/') && !p.endsWith('.md'));
}

/** Fix round 1, finding 2: true when `src` IMPORTS `clearSettingsEnv` or
 *  `mergeSettingsEnv` FROM `shared/modelenv.mjs` — a DELEGATING CALLER that
 *  reaches a settings file only by calling the one function allowed to touch
 *  it, not a second implementation. Task 6's `deploy/models-op.mjs` imports
 *  `MODEL_ENV_KEYS` and `clearSettingsEnv`, itself calls
 *  `writeFileSync`/`renameSync` for the registry/TSV files it separately
 *  owns, and spells the literal `settings.json` when it builds the path it
 *  hands to `clearSettingsEnv` — every ingredient `deletesTheBlock` looks
 *  for, despite delegating rather than reimplementing. Importing EITHER
 *  helper is proof of delegation regardless of which one a file imports, so
 *  it exempts a file from BOTH pins below — `deploy/` is not in either pin's
 *  test-dir exclusion, and should not need to be. */
function importsHelper(src: string): boolean {
  return /import\s*\{[^}]*\b(?:clearSettingsEnv|mergeSettingsEnv)\b[^}]*\}\s*from\s*['"][^'"]*\bmodelenv\.mjs['"]/
    .test(src);
}

/** A file WRITES the block if it spells one of the four alias variables OR the
 *  eighth key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (§6.1 amendment), AND reaches
 *  a settings file in the same breath. Spelling one in a comment, an
 *  assertion or an expected value is not writing it, which is why the second
 *  half of the conjunction is here — the test corpus names these variables
 *  constantly. A delegating caller (`importsHelper`) is exempt: it reaches a
 *  settings file only through the one function allowed to. */
export function writesTheBlock(src: string): boolean {
  if (importsHelper(src)) return false;
  if (!/(ANTHROPIC_DEFAULT_(HAIKU|SONNET|OPUS|FABLE)_MODEL|CLAUDE_CODE_MAX_CONTEXT_TOKENS)/.test(src)) {
    return false;
  }
  return /(writeFileSync|renameSync|mergeSettingsEnv\s*\()/.test(src)
    && /settings\.json/.test(src);
}

describe('§6.1 — one writer of the model env block', () => {
  it('is shared/modelenv.mjs, and nothing else in the tree', () => {
    const holders = tracked()
      .filter((rel) => {
        try { return writesTheBlock(readFileSync(path.join(REPO, rel), 'utf8')); }
        catch { return false; }
      })
      .filter((rel) => !rel.startsWith('server/test/') && !rel.startsWith('pwa/test/')
        && !rel.startsWith('agent/test/'))
      .sort();
    expect(holders).toEqual(['shared/modelenv.mjs']);
  });

  it('the predicate is not vacuous — it catches a second writer and ignores prose', () => {
    // Guards the guard: a `writesTheBlock` that answered false for everything
    // would make the row above pass over any tree at all.
    expect(writesTheBlock(
      'writeFileSync(p, JSON.stringify({env:{ANTHROPIC_DEFAULT_OPUS_MODEL:x}}));\n'
      + '// p is a settings.json')).toBe(true);
    expect(writesTheBlock(
      'writeFileSync(p, JSON.stringify({env:{CLAUDE_CODE_MAX_CONTEXT_TOKENS:"1"}}));\n'
      + '// p is a settings.json')).toBe(true);
    expect(writesTheBlock('// ANTHROPIC_DEFAULT_OPUS_MODEL is written by the materialiser'))
      .toBe(false);
    expect(writesTheBlock('writeFileSync(p, "hello"); // settings.json')).toBe(false);
  });

  it('fix round 1, finding 2 — a DELEGATING CALLER is exempt, a reimplementation is still caught', () => {
    // Task 6's `deploy/models-op.mjs` shape: imports `mergeSettingsEnv`, calls
    // it, and separately writes the registry/TSV with `writeFileSync` — every
    // ingredient the bare predicate looked for, but delegated rather than
    // reimplemented.
    expect(writesTheBlock(
      "import { mergeSettingsEnv } from '../shared/modelenv.mjs';\n"
      + 'mergeSettingsEnv(settingsPath, block);\n'
      + 'writeFileSync(registryPath, JSON.stringify(registry));\n'
      + '// settingsPath is .../settings.json')).toBe(false);
    // Importing `clearSettingsEnv` exempts too — either helper is proof of
    // delegation, regardless of which this particular file happens to call.
    expect(writesTheBlock(
      "import { clearSettingsEnv } from '../shared/modelenv.mjs';\n"
      + 'writeFileSync(p, JSON.stringify({env:{ANTHROPIC_DEFAULT_OPUS_MODEL:x}}));\n'
      + '// p is a settings.json')).toBe(false);
    // The SAME write, with NO import of either helper, is still caught — the
    // exemption is for delegation, not for spelling the variable names near
    // an unrelated import.
    expect(writesTheBlock(
      "import { readFileSync } from 'node:fs';\n"
      + 'writeFileSync(p, JSON.stringify({env:{ANTHROPIC_DEFAULT_OPUS_MODEL:x}}));\n'
      + '// p is a settings.json')).toBe(true);
  });

  it('the corpus is real: it holds the writer itself', () => {
    expect(tracked()).toContain('shared/modelenv.mjs');
  });
});

// §4.1 Lifecycle and §10: `ccrc models <id> rm` deletes the same eight keys
// `clearSettingsEnv` owns — a SECOND function that deleted them (rather than
// calling `clearSettingsEnv`) would be a second opinion about what "reaped"
// means, resolved by whichever ran last, exactly like a second writer. This
// is its own describe rather than folded into the one above: the two
// predicates ask different questions of the same corpus and a single holders
// list conflating "writes" and "deletes" would stop naming which one broke.
/** A file DELETES the block if it spells `MODEL_ENV_KEYS` — the frozen export
 *  that is the one place these eight names originate — AND reaches a settings
 *  file in the same breath, either by deleting a key off an `env` object or by
 *  rewriting the file outright. Importing or logging the export is not
 *  deleting it, which is why the second half of the conjunction is here too.
 *  A delegating caller (`importsHelper`) is exempt for the same reason
 *  `writesTheBlock` exempts one: Task 6's `deploy/models-op.mjs` legitimately
 *  imports `MODEL_ENV_KEYS` alongside `clearSettingsEnv`, and otherwise trips
 *  every ingredient below without being a second implementation. */
export function deletesTheBlock(src: string): boolean {
  if (importsHelper(src)) return false;
  if (!/MODEL_ENV_KEYS/.test(src)) return false;
  return /(delete\s+env\[|writeFileSync|renameSync)/.test(src) && /settings\.json/.test(src);
}

describe('§4.1 Lifecycle, §10 — one deleter of the model env block\'s keys', () => {
  it('is also shared/modelenv.mjs, and nothing else in the tree', () => {
    const holders = tracked()
      .filter((rel) => {
        try { return deletesTheBlock(readFileSync(path.join(REPO, rel), 'utf8')); }
        catch { return false; }
      })
      .filter((rel) => !rel.startsWith('server/test/') && !rel.startsWith('pwa/test/')
        && !rel.startsWith('agent/test/'))
      .sort();
    expect(holders).toEqual(['shared/modelenv.mjs']);
  });

  it('the predicate is not vacuous — it catches a second deleter and ignores prose', () => {
    expect(deletesTheBlock(
      'import { MODEL_ENV_KEYS } from "./modelenv.mjs";\n'
      + 'for (const k of MODEL_ENV_KEYS) { delete env[k]; }\n'
      + "// env belongs to a lane's settings.json")).toBe(true);
    expect(deletesTheBlock('// MODEL_ENV_KEYS is the export clearSettingsEnv iterates'))
      .toBe(false);
    expect(deletesTheBlock('writeFileSync(p, "hello"); // settings.json')).toBe(false);
  });

  it('fix round 1, finding 2 — a DELEGATING CALLER is exempt, a reimplementation is still caught', () => {
    // Task 6's `deploy/models-op.mjs` shape, verbatim from the finding:
    // imports `MODEL_ENV_KEYS` and `clearSettingsEnv`, calls `clearSettingsEnv`
    // (which itself does the deletion), and separately writes the
    // registry/TSV with `writeFileSync`/`renameSync` — every ingredient the
    // bare predicate looked for, but delegated rather than reimplemented.
    expect(deletesTheBlock(
      "import { MODEL_ENV_KEYS, clearSettingsEnv } from '../shared/modelenv.mjs';\n"
      + 'clearSettingsEnv(settingsPath, MODEL_ENV_KEYS);\n'
      + 'writeFileSync(registryPath, JSON.stringify(registry));\n'
      + 'renameSync(tmp, registryPath);\n'
      + '// settingsPath is .../settings.json')).toBe(false);
    // Importing `mergeSettingsEnv` exempts too — either helper is proof of
    // delegation, regardless of which this particular file happens to call.
    expect(deletesTheBlock(
      "import { MODEL_ENV_KEYS, mergeSettingsEnv } from '../shared/modelenv.mjs';\n"
      + 'for (const k of MODEL_ENV_KEYS) { delete env[k]; }\n'
      + "// env belongs to a lane's settings.json")).toBe(false);
    // The SAME reimplementation, with NO import of either helper, is still
    // caught — the exemption is for delegation, not for spelling
    // MODEL_ENV_KEYS near an unrelated import.
    expect(deletesTheBlock(
      "import { readFileSync } from 'node:fs';\n"
      + "import { MODEL_ENV_KEYS } from '../shared/modelenv.mjs';\n"
      + 'for (const k of MODEL_ENV_KEYS) { delete env[k]; }\n'
      + "// env belongs to a lane's settings.json")).toBe(true);
  });
});
