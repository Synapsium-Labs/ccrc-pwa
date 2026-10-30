// The endpoint gate (spec §4.1): `shared/base-url.mjs`, the one implementation, and `shared/base-url.ts`, its typed
// re-export (D-7306, D-7307). Driven over the shared case table through both imports.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL_OK, LOOPBACK_HOSTS } from '../../shared/base-url.js';
// The implementation itself, the specifier the bare-`node` callers use, imported
// under a second name so the identity row can hold the two imports to one
// function. `shared/base-url.d.mts` is what makes this import typed; the pattern
// is `gen-accounts.test.ts`'s import of `shared/roster-json.mjs`, one directory
// over.
import { BASE_URL_OK as BASE_URL_OK_MJS, LOOPBACK_HOSTS as LOOPBACK_HOSTS_MJS } from '../../shared/base-url.mjs';
import { baseUrlCases } from './fixtures/baseUrlCases.js';
import { parseSource } from './scan/parse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
/** The gate's three files: the implementation, its typed re-export, its declarations. */
const GATE_FILES = ['shared/base-url.mjs', 'shared/base-url.ts', 'shared/base-url.d.mts'] as const;
const parse = (f: string) => parseSource(readFileSync(path.join(REPO, f), 'utf8'), f);
/** Every import and re-export edge of `f`, by its specifier, in source order. */
const edgesOf = (f: string): string[] => parse(f).imports.map((e) => e.specifier);

describe('BASE_URL_OK', () => {
  it('the table this drives is real, and covers both verdicts', () => {
    // A table of only-accepts or only-rejects would let half the gate be
    // deleted silently. Same reasoning as `single-definition.test.ts`'s
    // "the name list this scans is real".
    expect(baseUrlCases.filter((c) => c.expect.ok).length).toBeGreaterThanOrEqual(5);
    expect(baseUrlCases.filter((c) => !c.expect.ok).length).toBeGreaterThanOrEqual(10);
    // …and every refusal reason in the union is exercised by at least one row,
    // derived from the rows rather than re-listed, so a sixth reason added
    // without a row reds here instead of shipping untested.
    const reasons = new Set(baseUrlCases.flatMap((c) => (c.expect.ok ? [] : [c.expect.reason])));
    expect([...reasons].sort()).toEqual([
      'base-url-credentials', 'base-url-fragment', 'base-url-insecure',
      'base-url-query', 'base-url-unparseable',
    ]);
  });

  it.each(baseUrlCases.map((c) => [c.why, c] as const))('%s', (_why, c) => {
    expect(BASE_URL_OK(c.raw)).toEqual(c.expect);
  });

  it('the loopback set is closed and literal — three spellings, no range test', () => {
    expect([...LOOPBACK_HOSTS]).toEqual(['127.0.0.1', '[::1]', 'localhost']);
  });

  it('the .ts and the .mjs export the same function and the same set', () => {
    // ONE IMPLEMENTATION, TWO IMPORTS (D-7306). The `.ts` is what the server
    // bundle and the TypeScript callers import; the `.mjs` is what
    // `deploy/account-op.mjs` and `shared/roster-json.mjs` import under a bare
    // `node`, which cannot load a `.ts`. The `.ts` re-exports the `.mjs`, so
    // the two imports are the SAME objects: a local copy re-added to the `.ts`
    // reds the identity here before any row can disagree. The table is still
    // driven through the `.mjs` import, against the same expectation.
    expect(BASE_URL_OK_MJS).toBe(BASE_URL_OK);
    expect(LOOPBACK_HOSTS_MJS).toBe(LOOPBACK_HOSTS);
    for (const c of baseUrlCases) {
      expect(BASE_URL_OK_MJS(c.raw), c.why).toEqual(c.expect);
      expect(BASE_URL_OK_MJS(c.raw), `twins disagree: ${c.why}`).toEqual(BASE_URL_OK(c.raw));
    }
  });

  it('is L0 and holds the DECISION only — the table lives in the other file', () => {
    // The decision lives in `shared/base-url.mjs` (D-7306): it has no import or
    // re-export edge at all, `node:*` included, read by the scan parser.
    expect(edgesOf('shared/base-url.mjs')).toEqual([]);
    // The separation §4.2 asks for, asserted rather than trusted: the gate must
    // not learn which provider is asking. `baseUrlRequired` is the caller's
    // question and it is answered against the provider table, in parseExec.
    //
    // A SUBSTRING BAN, so it covers prose as well as code — the file may not
    // spell the table's identifier even in a comment, because a comment naming
    // it is the first move of a branch on it. That is why this file's own
    // header says "the provider table's `baseUrlRequired` column" in words:
    // the ban is on the identifier, and it is checked, so the header had to be
    // written to satisfy it rather than the assertion loosened to admit the
    // header. Same for `openrouter`: the only provider with a default endpoint
    // must not have it hardcoded here. It runs over the gate's three files:
    // the implementation, its re-export and its declarations.
    for (const f of GATE_FILES) {
      const src = readFileSync(path.join(REPO, f), 'utf8');
      expect(src, f).not.toContain('PROVIDERS');
      expect(src, f).not.toContain('openrouter');
    }
  });

  it('shared/base-url.ts re-exports the .mjs and defines no value (D-7306, D-7307)', () => {
    expect(edgesOf('shared/base-url.ts')).toEqual(['./base-url.mjs']);
    const p = parse('shared/base-url.ts');
    expect(p.bindings.map((b) => b.name)).toEqual([]);
    expect(p.symbols.filter((s) => s.kind === 'function' || s.kind === 'class' || s.kind === 'variable-function')
      .map((s) => s.name)).toEqual([]);
  });

  it('shared/base-url.d.mts reaches only the .ts, for its types (D-7307)', () => {
    expect([...new Set(edgesOf('shared/base-url.d.mts'))]).toEqual(['./base-url.js']);
    expect(parse('shared/base-url.d.mts').imports.every((e) => e.typeOnly)).toBe(true);
  });
});
