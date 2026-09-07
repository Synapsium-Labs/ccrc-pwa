// `shared/providers.ts` — the provider table, and the two L0 files this wave
// adds beside it. Three things are measured here and nowhere else:
//
//  1. THE NO-IMPORT RULE, for the files it binds — TWO today, and three the
//     moment the endpoint-gate task writes `shared/base-url.ts` and adds its
//     row to the describe below.
//
//     `shared/roster.ts` has been import-free since Stage 2a and nothing ever asserted it
//     (measured 2026-09-07: `grep -c '^import' shared/roster.ts` -> 0, over 653
//     lines; the only two L0 pins in the tree are lifecycle.test.ts:840-844 and
//     peers-claims-l0.test.ts:156-161, and neither covers this file). The rule
//     is real rather than decorative because `pwa/src/lib/offline.ts:10` is a
//     VALUE import of it — `import { HUES } from '../../../shared/roster';` —
//     so roster.ts is in the browser bundle and a `node:*` import in it breaks
//     that bundle while every vitest run stays green (D-1864).
//
//     roster.ts's expected import list is `[]` TODAY and becomes exactly two
//     lines — `./providers.js` and `./base-url.js` — in the task that adds
//     `provider` to `ExecSpec`. That is the pin working, not the pin breaking:
//     the value is asserted whole, so the task that adds an import has to come
//     here and say which one.
//
//  2. THE DERIVATIONS. `PROVIDER_IDS` and `GENERATABLE` must be computed from
//     the table, never re-listed beside it — the `PR_REASONS = Object.keys(…)`
//     rule (shared/api.ts:409), applied to the second table in the tree that
//     has a runtime list and a type saying the same thing.
//
//  3. THE `.mjs` HALF OF §4.2's SINGLE-DEFINITION PROMISE. `single-definition.
//     test.ts` scans `/\.tsx?$/` only (`sources()`, :40-57, the filter at :54,
//     `ALL` at :59)
//     and `source-bytes.test.ts:30-36` names that blindness by name as the
//     reason it walks `git ls-files` instead. So the TABLE's uniqueness is
//     asserted twice: over the four TypeScript roots there (Step 3b), and over
//     every TRACKED file here — which is the only one of the two that can see a
//     copy landing in `shared/roster-json.mjs` (D-1860).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROVIDERS, PROVIDER_IDS, GENERATABLE, isProviderId, ACCOUNT_FINDINGS,
} from '../../shared/providers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

/** Every TRACKED file, binaries excluded — the walk `source-bytes.test.ts:71-76`
 *  uses, and for the identical reason: a root list cannot see a `.mjs`, and the
 *  copy this scan exists to catch would be in one. */
const BINARY = /\.(png|jpg|jpeg|gif|ico|webp|woff2?|ttf|otf|pdf|zip|gz|db|sqlite)$/i;
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter((p) => p !== '' && !BINARY.test(p));
}

describe('L0 stays import-free: the PWA bundles these files', () => {
  // `shared/base-url.ts` got its row here in Task 2, the task that wrote the
  // file — it is the SECOND `it` below (`:72`), after `providers.ts`'s own row.
  // It could not have landed in THIS task (Task 1): asserting it here would
  // have meant committing a suite with a known-red row — `ENOENT …
  // shared/base-url.ts` — and this repo's rule is that every task ships green:
  // a red row in a landed commit is indistinguishable, on the next run, from a
  // regression.
  it('shared/providers.ts imports nothing at all', () => {
    expect(read('shared/providers.ts')).not.toMatch(/^\s*import /m);
  });

  it('shared/base-url.ts imports nothing at all', () => {
    // The second of the two L0 files this wave adds, pinned in the SAME
    // describe as the first so the rule has one home rather than two that can
    // drift apart. It could not be written in the task that opened this
    // describe: the file did not exist there, and a row asserted against an
    // absent file is a committed red — indistinguishable, on the next run, from
    // a regression.
    expect(read('shared/base-url.ts')).not.toMatch(/^\s*import /m);
  });

  it('shared/roster.ts imports L0 only — the whole list, so an addition must be stated here', () => {
    const imports = read('shared/roster.ts').split('\n').filter((l) => /^import\s/.test(l));
    // Two lines, both `shared/*.ts`, both import-free themselves (pinned above),
    // so the browser bundle gains no runtime dependency. `shared/api.ts` carries
    // the same shape and the same pin (peers-claims-l0.test.ts:156-161).
    expect(imports).toEqual([
      "import { PROVIDERS, PROVIDER_IDS, isProviderId, type ProviderId } from './providers.js';",
      "import { BASE_URL_OK } from './base-url.js';",
    ]);
  });
});

describe('the provider table is derived, never re-listed', () => {
  it('PROVIDER_IDS is Object.keys(PROVIDERS), in table order', () => {
    expect(PROVIDER_IDS).toEqual(Object.keys(PROVIDERS));
    // The positive control, the same shape `single-definition.test.ts:846-853`
    // uses for its own hunt list: a derivation over an empty table would
    // satisfy the line above and assert nothing.
    expect(PROVIDER_IDS.length).toBe(4);
    expect(PROVIDER_IDS).toContain('anthropic');
    expect(PROVIDER_IDS).toContain('compatible');
  });

  it('GENERATABLE is a filter over the table, and openai is the one that is not', () => {
    expect(GENERATABLE).toEqual(PROVIDER_IDS.filter((p) => PROVIDERS[p].generatable));
    expect([...GENERATABLE].sort()).toEqual(['anthropic', 'compatible', 'openrouter']);
    // `openai` is somebody else's launcher: `declare`, never `add` (spec §5).
    expect(GENERATABLE).not.toContain('openai');
  });

  it('isProviderId narrows the constant, never the input', () => {
    expect(isProviderId('openrouter')).toBe(true);
    expect(isProviderId('anthorpic')).toBe(false);
    expect(isProviderId(7)).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
  });

  it('every row states its endpoint policy, and only compatible requires one', () => {
    // The three facts §4.2's prose asserts, as data rather than as prose:
    // openrouter carries a default, compatible has none and demands one, and
    // the two subscription lanes have neither.
    expect(PROVIDERS.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(PROVIDERS.compatible.baseUrl).toBeNull();
    expect(PROVIDERS.anthropic.baseUrl).toBeNull();
    expect(PROVIDERS.openai.baseUrl).toBeNull();
    expect(PROVIDER_IDS.filter((p) => PROVIDERS[p].baseUrlRequired)).toEqual(['compatible']);
    // A provider that requires an endpoint and also ships a default would be
    // stating both halves of a contradiction; nothing else in the tree would
    // notice.
    for (const p of PROVIDER_IDS) {
      if (PROVIDERS[p].baseUrlRequired) expect(PROVIDERS[p].baseUrl, p).toBeNull();
    }
  });

  it('models are legal on exactly the two api-key lanes', () => {
    // §4.1 line 229 and §14 line 1455 disagree — "the two api-key providers"
    // against "refused on a non-openrouter provider". The table settles it as
    // DATA so the two gates (parseRoster's, and the .mjs mirror's) read one
    // answer instead of each re-deciding: §4.1 is the later text, written with
    // `compatible` in existence, and §4.2's own table gives `compatible` the
    // degraded model field.
    expect(PROVIDER_IDS.filter((p) => PROVIDERS[p].apiKeyModels)).toEqual(['openrouter', 'compatible']);
    // …and the catalogue is OpenRouter's alone (§4.3): `compatible` has the
    // field and no catalogue, which is the whole difference between them.
    expect(PROVIDER_IDS.filter((p) => PROVIDERS[p].catalogue !== null)).toEqual(['openrouter']);
  });

  it('the connect methods are the flag values, bare — this is the vocabulary the wave shares', () => {
    // The one place the method NAMES are asserted as content rather than as
    // agreement. `deploy/account-op.mjs`'s mirror is compared to this column by
    // `ccrc-account.test.ts` (Task 20) and `ccd-account-auth`'s `case` matches
    // these same strings (Tasks 51-55), so a `pane:` prefix landing here would
    // refuse `--method setup-token` — a value spec:413 documents — everywhere at
    // once. §4.2's cell (spec:272, :275) writes the prefixed spelling; §5:413,
    // §5:419 and §6:507-508 write these, and §6:543 says what the prefix meant.
    expect(PROVIDERS.anthropic.connect).toEqual(['login', 'paste', 'setup-token']);
    expect(PROVIDERS.openrouter.connect).toEqual(['pkce', 'paste']);
    expect(PROVIDERS.compatible.connect).toEqual(['paste']);
    // Not `pane:login`: §4.2's cell and §6's method name are two different
    // names, not one name with a prefix, and the helper answers to this one.
    expect(PROVIDERS.openai.connect).toEqual(['openai-login']);
    // No member of any row's list carries the prefix — asserted over the table
    // rather than row by row, so a fifth provider cannot reintroduce it.
    for (const p of PROVIDER_IDS) {
      for (const m of PROVIDERS[p].connect) expect(m, p).not.toContain('pane:');
    }
    // …and the first member is the default the connect door opens on (§4.2
    // spells anthropic's `login` "(default)"), which is what `check-add` reads
    // when `--method` is absent.
    expect(PROVIDERS.anthropic.connect[0]).toBe('login');
  });

  it('the doctor vocabulary is a closed list with a type over it', () => {
    expect([...ACCOUNT_FINDINGS]).toEqual(
      ['credential-declared-absent', 'settings-env-drift', 'launcher-absent']);
  });
});

describe('the provider table has ONE home, in a scan that can see a .mjs', () => {
  it('finds files to check at all', () => {
    // A scan over an empty list passes everything (`source-bytes.test.ts:79-84`
    // makes the same check for the same reason).
    expect(trackedFiles().length).toBeGreaterThan(100);
  });

  it('no tracked file but shared/providers.ts declares a PROVIDERS table', () => {
    const RE = /^\s*(?:export\s+)?const\s+PROVIDERS\b/m;
    // The premise, established rather than assumed.
    expect(RE.test('export const PROVIDERS = {')).toBe(true);
    expect(RE.test('const PROVIDERS = {')).toBe(true);
    expect(RE.test('// PROVIDERS is the table')).toBe(false);
    // `docs/` is excluded for the same reason the ROWS scan below excludes it,
    // and the exclusion is REQUIRED rather than tidy: prose legitimately quotes
    // the table inside a fenced block at column 0, and one tracked spec already
    // does — measured 2026-09-07,
    // `git grep -nE "^\s*(export\s+)?const\s+PROVIDERS\b"` returns exactly
    // `docs/superpowers/specs/2026-08-21-account-provisioning-design.md:255`.
    // Without the clause this assertion is RED on the tree it is written
    // against, and it would go red a second time the moment the plan carrying
    // this very file lands under `docs/superpowers/plans/`. A scan that cannot
    // survive its own plan being committed is not a mechanism.
    const holders = trackedFiles()
      .filter((f) => !f.startsWith('docs/') && !f.endsWith('server/test/providers.test.ts'))
      .filter((f) => { try { return RE.test(readFileSync(path.join(REPO, f), 'utf8')); } catch { return false; } });
    expect(holders, 'a second provider table').toEqual(['shared/providers.ts']);
  });

  it('no tracked file spells the provider rows as a second object literal', () => {
    // The shape a hand-copied table takes in a `.mjs` mirror: an object literal
    // naming two or more provider ids as KEYS, with at least one ProviderRow
    // field inside it. Modelled on `enumeratesAsArray` (single-definition.
    // test.ts:859-865), widened from `[...]` to `{...}` because a table copy is
    // an object and a list copy is an array, and this scan must catch both.
    //
    // NESTING IS THE WHOLE DIFFICULTY, and it is why this walks braces by hand
    // instead of reusing `enumeratesAsArray`'s one-regex shape. A regex of the
    // form `/\{[^{}]*\}/gs` matches only INNERMOST brace pairs — measured
    // 2026-09-07 against the exact mutant Step 5(b) appends to
    // `shared/roster-json.mjs`, that spelling returns FALSE: the only block in
    // which two provider ids appear as keys is the OUTER one, and the regex
    // never offers it as a candidate, while the two inner row blocks score zero
    // id-keys each. A real table copy is always nested — a row is an object —
    // so the innermost-only spelling is vacuous against every shape this test
    // exists for. `braceBlocks` collects EVERY balanced `{…}` span, outer ones
    // included, which is what makes the scan able to fail.
    //
    // It deliberately does NOT catch a bare ID LIST in `shared/roster-json.mjs`
    // — the mirror needs one to stay STRICTER than the parser (its header,
    // :49-52), and the task that adds it also adds a test asserting it equals
    // `PROVIDER_IDS` element for element. What is forbidden is a second copy of
    // the TABLE: the labels, env vars, connect methods, probes and endpoints.
    //
    // THE SAME PERMISSION, STATED FOR THE OTHER BARE-`node` READER, because the
    // wave's second cluster relies on it and a scanner nobody can predict is a
    // scanner people work around. `deploy/account-op.mjs` needs four of this
    // table's columns and cannot import TypeScript either, so it carries them
    // as four PER-COLUMN projections — `PROVIDER_ENV_VAR`, `PROVIDER_BASE_URL`,
    // `PROVIDER_CONNECT`, and two id sets — and composes the per-provider view
    // it hands callers at load time from those. Each column is compared to this
    // table's own projection of it by `ccrc-account.test.ts`'s `providers`
    // agreement test, element for element, in both directions. That is derived
    // data with a named source and a red suite behind it; a hand-written ROW
    // — `{ envVar: …, connect: […] }` per provider id — is a fork, and it is
    // what this scan refuses. The distinction is not a loophole in the regex:
    // a column projection cannot silently disagree about a provider the table
    // does not have, because its keys ARE the ids the agreement test iterates.
    // No holder is exempted here and none may be: `holders` is asserted EMPTY,
    // and a file that trips this scan has to change its shape rather than join
    // a list.
    const FIELD = /\b(?:envVar|connect|baseUrlRequired|generatable|apiKeyModels|catalogue)\s*:/;
    /** Every balanced `{…}` span in `src`, nested and enclosing alike. */
    const braceBlocks = (src: string): string[] => {
      const out: string[] = [];
      const stack: number[] = [];
      for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === '{') stack.push(i);
        else if (ch === '}' && stack.length > 0) out.push(src.slice(stack.pop()!, i + 1));
      }
      return out;
    };
    // The premise, established rather than assumed — both shapes a copy can
    // take, and the innermost-only spelling this replaces failing the nested
    // one. Without these three lines the scan could go vacuous in a refactor
    // and nothing would say so.
    const rowsCopied = (src: string): boolean => {
      if (!FIELD.test(src)) return false;
      for (const blk of braceBlocks(src)) {
        if (!FIELD.test(blk)) continue;
        const hits = PROVIDER_IDS.filter((p) => new RegExp(`(^|[^A-Za-z-])['"]?${p}['"]?\\s*:`).test(blk));
        if (hits.length >= 2) return true;
      }
      return false;
    };
    expect(rowsCopied(
      "const T = { openrouter: { envVar: 'x' }, compatible: { envVar: 'y' } };")).toBe(true);
    expect(rowsCopied(
      "const T = { anthropic: 'a', openrouter: 'b', envVar: 1 };")).toBe(true);
    expect(rowsCopied("const T = { openrouter: { envVar: 'x' } };")).toBe(false);

    const holders = trackedFiles()
      .filter((f) => f !== 'shared/providers.ts' && !f.endsWith('server/test/providers.test.ts')
        && !f.startsWith('docs/'))
      .filter((f) => {
        try { return rowsCopied(readFileSync(path.join(REPO, f), 'utf8')); } catch { return false; }
      });
    expect(holders, 'a second copy of the provider ROWS').toEqual([]);
  });
});
