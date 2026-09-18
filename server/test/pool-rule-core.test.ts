// `shared/poolrule.ts` — the TypeScript spelling of design §5.2's one rule,
// driven through `POOL_RULE_CASES` by this suite, and `ccd`'s bash `_pool_ok`
// is now driven through the same table too (`server/test/ccd-pool-ok.test.ts`,
// wave 2a) — two implementations, one table, so either drifting reds its own
// suite against the same rows, which is what "spelled once per language" has
// to mean when the languages cannot share code. The PWA will not be a third:
// wave 4's `splitByPool` is to call this function rather than re-deriving it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectPoolWire } from '../../shared/api.js';
import { poolRule, declaredAccountPool } from '../../shared/poolrule.js';
import type { AccountPoolWire } from '../../shared/poolrule.js';
import { POOL_RULE_CASES } from './fixtures/poolRule.js';
import type { PoolRuleCase } from './fixtures/poolRule.js';

/** Build one fixture row's account side. Existing rows never set
 *  `accountState` and must keep producing exactly today's verdict — only a
 *  row that opts in with `accountState` (added by a later task) reaches the
 *  new undecidable/tagged-origin shapes. Added by wave 1 Task 5. */
const wireFor = (c: PoolRuleCase): AccountPoolWire =>
  c.accountState === undefined
    ? (c.accountPool === null
        ? { state: 'untagged', origin: 'central' }
        : { state: 'tagged', pools: [c.accountPool], origin: 'central' })
    : { state: c.accountState } as AccountPoolWire;

const taggedAccount = (name: string): AccountPoolWire =>
  ({ state: 'tagged', pools: [name], origin: 'central' });
const untaggedAccount: AccountPoolWire = { state: 'untagged', origin: 'central' };

describe('poolRule over the shared truth table', () => {
  it.each(POOL_RULE_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const v = poolRule(wireFor(c), c.project);
    const actual = v.ok ? 'serve' : v.reason === 'pool-mismatch' ? 'mismatch' : 'undecidable';
    expect(actual, c.why).toBe(c.expect);
  });

  it('a mismatch carries BOTH names, so no caller re-derives them', () => {
    // Wave 3's 409 body, wave 2a's `ccd` die text and wave 4's PWA confirm
    // sentence will each need to name the two pools. Carrying them on the
    // verdict is what will stop three callers each looking them up again —
    // and disagreeing when one of them looks in the wrong roster copy.
    expect(poolRule(taggedAccount('pool-a'), { state: 'tagged', name: 'pool-b' })).toEqual({
      ok: false, reason: 'pool-mismatch', accountPool: 'pool-a', projectPool: 'pool-b',
    });
  });

  it('an undecidable carries WHICH state, because the two have different remedies', () => {
    // `unreadable` is a permissions problem; `malformed` is "rewrite the file".
    // A single `undecidable` token would send the operator to the wrong one.
    expect(poolRule(taggedAccount('pool-a'), { state: 'unreadable' }))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'unreadable' });
    expect(poolRule(taggedAccount('pool-a'), { state: 'malformed' }))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'malformed' });
  });

  it('names every serve REASON, so a collapsed `why` cannot pass', () => {
    // "served because the project is untagged" and "served because the names
    // agree" are different facts to a reader deciding whether tagging the
    // project would change anything — and the PWA's copy is built from them.
    expect(poolRule(untaggedAccount, { state: 'untagged' })).toEqual({ ok: true, why: 'untagged-project' });
    expect(poolRule(taggedAccount('pool-a'), { state: 'untagged' })).toEqual({ ok: true, why: 'untagged-project' });
    expect(poolRule(untaggedAccount, { state: 'tagged', name: 'pool-a' })).toEqual({ ok: true, why: 'untagged-account' });
    expect(poolRule(taggedAccount('pool-a'), { state: 'tagged', name: 'pool-a' })).toEqual({ ok: true, why: 'same-pool' });
  });

  // The three assertions below are what no fixture row (today) can express —
  // `PoolRuleCase.accountPool` has no vocabulary for `unreadable` / `stale` /
  // `malformed` on the account side, and a fixture row with `pools.length > 1`
  // does not exist yet. Added by wave 1 Task 5.

  it('an account the roster does not carry stays PERMISSIVE, not undecidable', () => {
    // poolrule.ts's docstring argues this fold deliberately: the PWA's roster
    // can lag the fleet's, and hiding a live non-roster account is worse than
    // offering it and letting `ccd` refuse. `unreadable` must NOT swallow this
    // case — `untagged` is the only account state that means "cannot see it".
    expect(poolRule({ state: 'untagged', origin: 'central' }, { state: 'tagged', name: 'pool-a' }))
      .toEqual({ ok: true, why: 'untagged-account' });
  });

  it('stale and unreadable are two words, not one', () => {
    const a = poolRule({ state: 'stale' }, { state: 'tagged', name: 'pool-a' });
    const b = poolRule({ state: 'unreadable' }, { state: 'tagged', name: 'pool-a' });
    expect(a).toEqual({ ok: false, reason: 'pool-undecidable', state: 'stale' });
    expect(b).toEqual({ ok: false, reason: 'pool-undecidable', state: 'unreadable' });
    expect(a).not.toEqual(b);
  });

  it('multi-pool membership is set membership, so the wire needs no change later', () => {
    expect(poolRule({ state: 'tagged', pools: ['pool-a', 'pool-b'], origin: 'central' },
                    { state: 'tagged', name: 'pool-b' })).toEqual({ ok: true, why: 'same-pool' });
  });

  it('acct-unreadable-project-untagged', () => {
    // Guards the ORDERING invariant the brief calls out twice: the project
    // decides FIRST. If the account's unreadable/malformed/stale block were
    // moved above the `projectPool.state === 'untagged'` return, an untagged
    // project would stop serving the moment the account side could not be
    // read — turning a bounded, deliberately-tagged-projects-only outage into
    // a fleet-wide stop. The correct order never even LOOKS at the account
    // here, so any account state — including an undecidable one — must still
    // serve.
    expect(poolRule({ state: 'unreadable' }, { state: 'untagged' }))
      .toEqual({ ok: true, why: 'untagged-project' });
  });
});

describe('declaredAccountPool — the adapter the five roster-only call sites now share (T5-R1)', () => {
  // `server/src/poolrule.ts` and `pwa/src/lib/pools.ts` predate this wave and
  // still hold only a roster NAME, never a wire. This is the seam that turns
  // that name into an `AccountPoolWire`, and it must preserve `poolRule`'s
  // documented permissive fold: a roster miss is `untagged`, not `unreadable`.
  it('declaredAccountPool(null) against a tagged project preserves the roster-miss fold', () => {
    expect(poolRule(declaredAccountPool(null), { state: 'tagged', name: 'pool-a' }))
      .toEqual({ ok: true, why: 'untagged-account' });
  });

  it('declaredAccountPool(name) against the same name still serves', () => {
    expect(poolRule(declaredAccountPool('pool-a'), { state: 'tagged', name: 'pool-a' }))
      .toEqual({ ok: true, why: 'same-pool' });
  });
});

describe('poolRule fails shut on an unrecognised project-pool wire state', () => {
  // Wire evolution can carry a state that this build's declared union does not
  // know. Keep these casts at the ingress-shaped test boundary, not in L0.
  const futureStateWithoutName = { state: 'future-state' } as unknown as ProjectPoolWire;
  const archivedNamedPool = { state: 'archived', name: 'pool-z' } as unknown as ProjectPoolWire;
  const unrecognisedState = { state: 'unrecognised' } as unknown as ProjectPoolWire;

  it.each([
    ['a future state without a name', taggedAccount('pool-a'), futureStateWithoutName],
    ['a named archived state', taggedAccount('pool-a'), archivedNamedPool],
    ['an unrecognised state over an untagged account', untaggedAccount, unrecognisedState],
  ] as const)('%s is undecidable rather than inferred', (_name, account, projectPool) => {
    expect(poolRule(account, projectPool)).toEqual({
      ok: false, reason: 'pool-undecidable', state: 'unrecognised',
    });
  });

  it.each([
    ['unreadable', taggedAccount('pool-a'), { state: 'unreadable' }, { ok: false, reason: 'pool-undecidable', state: 'unreadable' }],
    ['malformed', untaggedAccount, { state: 'malformed' }, { ok: false, reason: 'pool-undecidable', state: 'malformed' }],
    ['untagged project', taggedAccount('pool-a'), { state: 'untagged' }, { ok: true, why: 'untagged-project' }],
    ['untagged account', untaggedAccount, { state: 'tagged', name: 'pool-a' }, { ok: true, why: 'untagged-account' }],
    ['same tagged pool', taggedAccount('pool-a'), { state: 'tagged', name: 'pool-a' }, { ok: true, why: 'same-pool' }],
    ['different tagged pools', taggedAccount('pool-a'), { state: 'tagged', name: 'pool-b' }, { ok: false, reason: 'pool-mismatch', accountPool: 'pool-a', projectPool: 'pool-b' }],
  ] as const)('%s remains in-vocabulary', (_name, account, projectPool, expected) => {
    expect(poolRule(account, projectPool)).toEqual(expected);
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
      const v = poolRule(wireFor(c), c.project);
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
    // three mutations survived the whole table.
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
