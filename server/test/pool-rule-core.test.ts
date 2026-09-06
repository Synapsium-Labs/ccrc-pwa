// `shared/poolrule.ts` — the TypeScript spelling of design §5.2's one rule,
// driven through `POOL_RULE_CASES` by this suite alone today. `ccd`'s bash
// `_pool_ok` will be driven through the same table once wave 2a lands it —
// two implementations, one table, so either drifting will red its own suite
// against the same rows, which is what "spelled once per language" has to
// mean when the languages cannot share code. The PWA will not be a third:
// wave 4's `splitByPool` is to call this function rather than re-deriving it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { poolRule } from '../../shared/poolrule.js';
import { POOL_RULE_CASES } from './fixtures/poolRule.js';

describe('poolRule over the shared truth table', () => {
  it.each(POOL_RULE_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const v = poolRule(c.accountPool, c.project);
    const actual = v.ok ? 'serve' : v.reason === 'pool-mismatch' ? 'mismatch' : 'undecidable';
    expect(actual, c.why).toBe(c.expect);
  });

  it('a mismatch carries BOTH names, so no caller re-derives them', () => {
    // Wave 3's 409 body, wave 2a's `ccd` die text and wave 4's PWA confirm
    // sentence will each need to name the two pools. Carrying them on the
    // verdict is what will stop three callers each looking them up again —
    // and disagreeing when one of them looks in the wrong roster copy.
    expect(poolRule('pool-a', { state: 'tagged', name: 'pool-b' })).toEqual({
      ok: false, reason: 'pool-mismatch', accountPool: 'pool-a', projectPool: 'pool-b',
    });
  });

  it('an undecidable carries WHICH state, because the two have different remedies', () => {
    // `unreadable` is a permissions problem; `malformed` is "rewrite the file".
    // A single `undecidable` token would send the operator to the wrong one.
    expect(poolRule('pool-a', { state: 'unreadable' }))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'unreadable' });
    expect(poolRule('pool-a', { state: 'malformed' }))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'malformed' });
  });

  it('names every serve REASON, so a collapsed `why` cannot pass', () => {
    // "served because the project is untagged" and "served because the names
    // agree" are different facts to a reader deciding whether tagging the
    // project would change anything — and the PWA's copy is built from them.
    expect(poolRule(null, { state: 'untagged' })).toEqual({ ok: true, why: 'untagged-project' });
    expect(poolRule('pool-a', { state: 'untagged' })).toEqual({ ok: true, why: 'untagged-project' });
    expect(poolRule(null, { state: 'tagged', name: 'pool-a' })).toEqual({ ok: true, why: 'untagged-account' });
    expect(poolRule('pool-a', { state: 'tagged', name: 'pool-a' })).toEqual({ ok: true, why: 'same-pool' });
  });
});

describe('the table this drives is a real table', () => {
  // The floor, in `single-definition.test.ts`'s idiom: a scan over an emptied or
  // narrowed fixture list passes everything, so THIS goes red rather than every
  // assertion above going quietly vacuous.
  it('has a floor of rows, unique names, and covers every project state', () => {
    expect(POOL_RULE_CASES.length).toBeGreaterThanOrEqual(14);
    expect(new Set(POOL_RULE_CASES.map((c) => c.name)).size).toBe(POOL_RULE_CASES.length);
    expect([...new Set(POOL_RULE_CASES.map((c) => c.expect))].sort())
      .toEqual(['mismatch', 'serve', 'undecidable']);
    expect([...new Set(POOL_RULE_CASES.map((c) => c.project.state))].sort())
      .toEqual(['malformed', 'tagged', 'unreadable', 'untagged']);
  });

  it('exercises all five verdicts the rule can produce', () => {
    const outcomes = new Set(POOL_RULE_CASES.map((c) => {
      const v = poolRule(c.accountPool, c.project);
      return v.ok ? v.why : v.reason;
    }));
    expect([...outcomes].sort()).toEqual([
      'pool-mismatch', 'pool-undecidable', 'same-pool', 'untagged-account', 'untagged-project',
    ]);
  });

  it('carries a REJECT per rule — both undecidable states over both account shapes, and a mismatch each way', () => {
    for (const state of ['unreadable', 'malformed'] as const) {
      const rows = POOL_RULE_CASES.filter((c) => c.project.state === state && c.expect === 'undecidable');
      expect(rows.some((c) => c.accountPool === null), `${state} over an UNTAGGED account`).toBe(true);
      expect(rows.some((c) => c.accountPool !== null), `${state} over a TAGGED account`).toBe(true);
    }
    // FOUR mismatch rows, because each kills something none of the others
    // does. The two direction rows (`mismatch-a-into-b`, `mismatch-b-into-a`)
    // kill a comparison that only refuses one way round. The two prefix rows
    // kill CONTAINMENT, one direction each: a prefix or substring test only
    // reds where the string it is called on is the LONGER of the pair, so
    // `mismatch-on-a-prefix` (short account, long project) is the only row
    // that kills `projectPool.name.startsWith(accountPool)`, and
    // `mismatch-on-a-project-prefix` (long account, short project) is the only
    // row that kills either `accountPool.startsWith(projectPool.name)` or a
    // bare `accountPool.includes(projectPool.name)` — measured: each of those
    // three mutations passes every row except its own. Drop one row and one
    // mutation walks the whole table.
    expect(POOL_RULE_CASES.filter((c) => c.expect === 'mismatch').length).toBeGreaterThanOrEqual(4);
    // Two DIFFERENT names must agree-and-serve, not one. A rule that hard-coded
    // a single pool passes `same-pool-a` alone, and the floor above cannot see
    // one row leaving — so the pair is counted rather than assumed.
    expect(POOL_RULE_CASES.filter((c) =>
      c.expect === 'serve' && c.project.state === 'tagged' && c.accountPool !== null).length,
      'the same-pool pair has lost a row').toBeGreaterThanOrEqual(2);
    // Both untagged disjuncts, separately — one of them alone leaves the other
    // deletable.
    expect(POOL_RULE_CASES.some((c) => c.accountPool === null && c.project.state === 'tagged')).toBe(true);
    expect(POOL_RULE_CASES.some((c) => c.accountPool !== null && c.project.state === 'untagged')).toBe(true);
  });
});

describe('shared/poolrule.ts is the pure L0 module its ring requires', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'poolrule.ts'),
    'utf8');

  /** Comments blanked, positions preserved — `coord-caps-policy.test.ts`'s
   *  helper, kept for its reason: this module's own header NAMES `node:` and
   *  `server/src` while promising not to import them, and would red every
   *  assertion below on its own prose.
   *
   *  IF THIS FILE REDS WITH `no imports found — the scan is over nothing`, READ
   *  THIS BEFORE DOUBTING THE MODULE. Block comments are blanked FIRST, with a
   *  lazy `/\*[\s\S]*?\*\/`. So a `/*` written inside a LINE comment — the easiest
   *  way being to type a path glob like `shared/` followed by a star and `.ts` —
   *  opens a match that runs to the next real `*\/`, swallowing every line
   *  between, the `import type` line included. The scan then measures nothing and
   *  says so. That is not a false alarm: it is this assertion doing the one job
   *  it exists for, and the fix is in `shared/poolrule.ts`'s prose, not here.
   *  (D-1741, found before this file first landed.) */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export function poolRule');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(200);
  });

  it('takes TYPE imports only — L0 imports nothing, not even node:*', () => {
    // The PWA bundles every `shared/*.ts`, so a `node:` import here does not
    // degrade anything — it breaks the client bundle. And a VALUE import is what
    // would let a decision start depending on something that has to be
    // constructed, which is the ring rule L0 exists to state.
    const imports = [...code().matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]!);
    expect(imports.length, 'no imports found — the scan is over nothing').toBeGreaterThan(0);
    for (const line of imports) {
      expect(line, `poolrule.ts takes a VALUE import: ${line.trim()}`).toMatch(/^\s*import\s+type\b/);
    }
    expect(code(), 'poolrule.ts imports a node builtin — the PWA bundles this file')
      .not.toMatch(/from\s+['"]node:/);
  });

  it('has no clock, no filesystem, no reply', () => {
    expect(code(), 'poolrule.ts reads the clock — the rule is no longer a pure decision')
      .not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(|performance\s*\.\s*now/);
    expect(code(), 'poolrule.ts reaches for a filesystem').not.toMatch(/\bfs\s*\.|require\s*\(/);
    expect(code(), 'poolrule.ts names a reply — an L0 decision does not answer HTTP')
      .not.toMatch(/\breply\b|\bFastify|\bapp\s*\./);
  });
});
