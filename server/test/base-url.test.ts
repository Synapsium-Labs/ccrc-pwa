// `shared/base-url.ts` — the endpoint gate (spec §4.1). Driven over the shared
// case table so the bare-`node` mirror can be driven over the same rows.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL_OK, LOOPBACK_HOSTS } from '../../shared/base-url.js';
// The bare-`node` twin, imported under a second name so both are driven over
// one table in one suite. `shared/base-url.d.mts` is what makes this import
// typed; the pattern is `gen-accounts.test.ts`'s import of
// `shared/roster-json.mjs`, one directory over.
import { BASE_URL_OK as BASE_URL_OK_MJS } from '../../shared/base-url.mjs';
import { baseUrlCases } from './fixtures/baseUrlCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

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

  it('the bare-node twin answers identically, row for row', () => {
    // TWO IMPLEMENTATIONS, ONE TABLE — `server/test/fixtures/leastLoaded.ts`'s
    // pattern, and the reason the fixture module exists at all. The `.ts` is
    // what the PWA and the server bundle; the `.mjs` is what
    // `deploy/account-op.mjs` and `shared/roster-json.mjs` import under a bare
    // `node`, which cannot load a `.ts`. Neither is the mirror of the other in
    // the sense of being allowed to differ: they are compared to the SAME
    // expectation and to EACH OTHER, so a change to either alone reds here.
    for (const c of baseUrlCases) {
      expect(BASE_URL_OK_MJS(c.raw), c.why).toEqual(c.expect);
      expect(BASE_URL_OK_MJS(c.raw), `twins disagree: ${c.why}`).toEqual(BASE_URL_OK(c.raw));
    }
  });

  it('is L0 and holds the DECISION only — the table lives in the other file', () => {
    const src = readFileSync(path.join(REPO, 'shared/base-url.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import /m);
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
    // must not have it hardcoded here.
    expect(src).not.toContain('PROVIDERS');
    expect(src).not.toContain('openrouter');
  });
});
