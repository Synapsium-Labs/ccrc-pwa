// The pool set's oracles and mutant sets (the pool-set plan, `docs/superpowers/plans/2026-11-14-overlord-w1/w1-pool-set.md`,
// Task 1, Step 6). Each decider's cases are written ONCE here, as suite cases over a module: `pool-rule-core.test.ts` and
// `pool-set-spelling.test.ts` run them against the real module, and `mutation-floors.test.ts` runs them against each
// named mutant (D-8217's every-run floors). The expected words are written out, not read from the code the cases judge;
// the two tables (`fixtures/poolRule.ts`, `fixtures/poolSetSpelling.ts`) are the shared oracles for the rest.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { AccountPoolWire } from '../../../shared/poolrule.js';
import { POOL_RULE_CASES, POOL_RULE_PROJECT_CASES, wireFor } from '../fixtures/poolRule.js';
import { POOL_SET_AT_CAP_SPELLING, POOL_SET_PARSE_CASES, POOL_SET_SPELL_CASES } from '../fixtures/poolSetSpelling.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RULE_MODULE = path.join(ROOT, 'shared/poolrule.ts');
const SET_MODULE = path.join(ROOT, 'shared/poolset.ts');

export type PoolRuleModule = typeof import('../../../shared/poolrule.js');
export type PoolSetModule = typeof import('../../../shared/poolset.js');

const wordOf = (v: { ok: boolean; reason?: string }): string =>
  v.ok ? 'serve' : v.reason === 'pool-mismatch' ? 'mismatch' : 'undecidable';

const tagged = (...pools: [string, ...string[]]): AccountPoolWire => ({ state: 'tagged', pools, origin: 'central' });
const untagged: AccountPoolWire = { state: 'untagged', origin: 'central' };
const spelled = (spelling: string) => ({ kind: 'spelled', spelling });

// ---------- poolRule ----------

export function poolRuleCases(m: Pick<PoolRuleModule, 'poolRule'>): Record<string, SuiteCase> {
  const rule = m.poolRule;
  return {
    'every row of the shared table gives its word, a set row with the set as the side': () => {
      for (const c of POOL_RULE_CASES) expect(wordOf(rule(wireFor(c), c.set ?? c.project)), `${c.name}: ${c.why}`).toBe(c.expect);
    },
    'the tag n and the set n+untagged agree on every tagged row (C46)': () => {
      let n = 0;
      for (const c of POOL_RULE_PROJECT_CASES) {
        if (c.project.state !== 'tagged') continue;
        n++;
        const v = rule(wireFor(c), { state: 'set', set: { pools: [c.project.name], untagged: true } });
        expect(wordOf(v), c.name).toBe(c.expect);
      }
      expect(n, 'no tagged rows: the equivalence is vacuous').toBeGreaterThanOrEqual(8);
    },
    'a set serve names its reason': () => {
      expect(rule(tagged('pool-a'), { state: 'set', set: { pools: ['pool-a'], untagged: false } })).toStrictEqual({ ok: true, why: 'in-set' });
      expect(rule(untagged, { state: 'set', set: { pools: ['pool-a'], untagged: true } })).toStrictEqual({ ok: true, why: 'untagged-in-set' });
    },
    'a set mismatch names the account\'s side, the one spelling of the set, and side set': () => {
      expect(rule(tagged('pool-a'), { state: 'set', set: { pools: ['pool-b', 'pool-ab'], untagged: true } }))
        .toStrictEqual({ ok: false, reason: 'pool-mismatch', side: 'set', account: { pool: 'pool-a' }, set: 'pool-ab,pool-b+untagged' });
      expect(rule(untagged, { state: 'set', set: { pools: ['pool-a'], untagged: false } }))
        .toStrictEqual({ ok: false, reason: 'pool-mismatch', side: 'set', account: { untagged: true }, set: 'pool-a' });
      expect(rule(tagged('pool-a'), { state: 'set', set: { pools: [], untagged: false } }))
        .toStrictEqual({ ok: false, reason: 'pool-mismatch', side: 'set', account: { pool: 'pool-a' }, set: '-' });
    },
    'a set with no spelling is labelled by why, three labels apart (review 2120 F1)': () => {
      const label = (pools: string[], u: boolean) => {
        const v = rule(tagged('pool-a'), { state: 'set', set: { pools, untagged: u } });
        return v.ok === false && v.reason === 'pool-mismatch' && v.side === 'set' ? v.set : JSON.stringify(v);
      };
      expect(label([], false)).toBe('-');
      expect(label(['Pool-B'], false)).toBe('?name');
      expect(label(POOL_SET_AT_CAP_SPELLING.split(','), true)).toBe('?over-cap');
    },
    'a bad set is undecidable on the SET side over every account state, an untagged one included': () => {
      const accounts: AccountPoolWire[] = [untagged, tagged('pool-a'), { state: 'unreadable' }, { state: 'stale' }, { state: 'malformed' }];
      for (const a of accounts) {
        expect(rule(a, { state: 'set-unreadable' }), a.state)
          .toStrictEqual({ ok: false, reason: 'pool-undecidable', side: 'set', state: 'unreadable' });
        expect(rule(a, { state: 'set-malformed' }), a.state)
          .toStrictEqual({ ok: false, reason: 'pool-undecidable', side: 'set', state: 'malformed' });
      }
    },
    'a failed account side is undecidable on the ACCOUNT side, under a tag and under a set': () => {
      for (const state of ['unreadable', 'stale', 'malformed'] as const) {
        expect(rule({ state }, { state: 'tagged', name: 'pool-a' }), state)
          .toStrictEqual({ ok: false, reason: 'pool-undecidable', side: 'account', state });
        expect(rule({ state }, { state: 'set', set: { pools: ['pool-a'], untagged: true } }), state)
          .toStrictEqual({ ok: false, reason: 'pool-undecidable', side: 'account', state });
      }
    },
    'a project verdict names the PROJECT side (tag mismatch, unreadable, malformed, unrecognised)': () => {
      expect(rule(tagged('pool-a'), { state: 'tagged', name: 'pool-b' }))
        .toStrictEqual({ ok: false, reason: 'pool-mismatch', side: 'project', accountPool: 'pool-a', projectPool: 'pool-b' });
      expect(rule(untagged, { state: 'unreadable' })).toStrictEqual({ ok: false, reason: 'pool-undecidable', side: 'project', state: 'unreadable' });
      expect(rule(untagged, { state: 'malformed' })).toStrictEqual({ ok: false, reason: 'pool-undecidable', side: 'project', state: 'malformed' });
      expect(rule(untagged, { state: 'future' } as never)).toStrictEqual({ ok: false, reason: 'pool-undecidable', side: 'project', state: 'unrecognised' });
    },
    'an account in two pools is served by a set naming the second only': () => {
      expect(wordOf(rule(tagged('pool-a', 'pool-b'), { state: 'set', set: { pools: ['pool-b'], untagged: false } }))).toBe('serve');
      expect(wordOf(rule(tagged('pool-a', 'pool-b'), { state: 'set', set: { pools: ['pool-ab'], untagged: false } }))).toBe('mismatch');
    },
    'membership is exact equality, not containment, in both directions and across a multi-name set': () => {
      const sets = (pools: string[]) => ({ state: 'set', set: { pools, untagged: false } }) as const;
      expect(wordOf(rule(tagged('pool-a'), sets(['pool-ab'])))).toBe('mismatch');
      expect(wordOf(rule(tagged('pool-ab'), sets(['pool-a'])))).toBe('mismatch');
      expect(wordOf(rule(tagged('pool-a'), sets(['pool-ab', 'pool-b'])))).toBe('mismatch');
    },
    'the project side still decides first: an untagged project serves with no account side read': () => {
      expect(rule({ state: 'unreadable' }, { state: 'untagged' })).toStrictEqual({ ok: true, why: 'untagged-project' });
    },
  };
}

const RULE_SET: MutantSet<PoolRuleModule> = {
  modulePath: RULE_MODULE,
  mutants: [
    // The plan's named mutants (Task 1 Step 6).
    { id: 'R1 an untagged account serves a set that does not admit it', old: "return set.untagged\n        ?", new: 'return true\n        ?' },
    { id: 'R2 set-unreadable serves like an untagged project', old: "  if (projectPool.state === 'set-unreadable' || projectPool.state === 'set-malformed') {", new: "  if (projectPool.state === 'set-unreadable') return { ok: true, why: 'untagged-project' };\n  if (projectPool.state === 'set-malformed') {" },
    { id: 'R3 set-malformed serves like an untagged project', old: "  if (projectPool.state === 'set-unreadable' || projectPool.state === 'set-malformed') {", new: "  if (projectPool.state === 'set-malformed') return { ok: true, why: 'untagged-project' };\n  if (projectPool.state === 'set-unreadable') {" },
    { id: 'R4 a bad set names the project side', old: "ok: false, reason: 'pool-undecidable', side: 'set',\n      state:", new: "ok: false, reason: 'pool-undecidable', side: 'project',\n      state:" },
    { id: 'R5 a bad set reads the account first', old: "  if (projectPool.state === 'set-unreadable' || projectPool.state === 'set-malformed') {", new: "  if (account.state === 'stale') return { ok: false, reason: 'pool-undecidable', side: 'account', state: 'stale' };\n  if (projectPool.state === 'set-unreadable' || projectPool.state === 'set-malformed') {" },
    { id: 'R6 membership by containment over the spelling', old: 'account.pools.some((p) => set.pools.includes(p))', new: 'set.pools.join(\',\').includes(account.pools[0])' },
    { id: 'R7 only the first of the account\'s pools is asked', old: 'account.pools.some((p) => set.pools.includes(p))', new: '[account.pools[0]].some((p) => set.pools.includes(p))' },
    { id: 'R8 the empty set serves', old: 'account.pools.some((p) => set.pools.includes(p))', new: 'account.pools.some((p) => set.pools.length === 0 || set.pools.includes(p))' },
    { id: 'R9 a failed account is not undecidable under a set', old: "  if (projectPool.state === 'set') {\n    if (account.state === 'unreadable' || account.state === 'malformed' || account.state === 'stale') {\n      return { ok: false, reason: 'pool-undecidable', side: 'account', state: account.state };\n    }\n", new: "  if (projectPool.state === 'set') {\n    if (account.state === 'stale') return { ok: true, why: 'in-set' };\n" },
    { id: 'R10 the set is named by a second spelling', old: "spelling.kind === 'spelled' ? spelling.spelling\n", new: "spelling.kind === 'spelled' ? set.pools.join(',')\n" },
    { id: 'R11 the empty set has a spelling of its own', old: "spelling.kind === 'empty' ? '-'", new: "spelling.kind === 'empty' ? ''" },
    { id: 'R16 an unspellable set reads as the empty one', old: "spelling.kind === 'empty' ? '-' : `?${spelling.why}`", new: "'-'" },
    { id: 'R17 the two unspellable reasons read alike', old: "`?${spelling.why}`", new: "'?'" },
    { id: 'R12 an untagged account is named by a pool', old: "account: { untagged: true }, set: spelled", new: "account: { pool: '' }, set: spelled" },
    { id: 'R13 the set mismatch names the project side', old: "reason: 'pool-mismatch', side: 'set', account: { pool: account.pools[0] }", new: "reason: 'pool-mismatch', side: 'project', account: { pool: account.pools[0] }" },
    { id: 'R14 an unreadable account decides before an untagged project', old: "  if (projectPool.state === 'untagged') return { ok: true, why: 'untagged-project' };", new: "  if (account.state === 'unreadable') return { ok: false, reason: 'pool-undecidable', side: 'account', state: 'unreadable' };\n  if (projectPool.state === 'untagged') return { ok: true, why: 'untagged-project' };" },
    { id: 'R15 a tag mismatch names the set side', old: "ok: false, reason: 'pool-mismatch', side: 'project',\n      // `pools`", new: "ok: false, reason: 'pool-mismatch', side: 'set',\n      // `pools`" },
  ],
  suite: poolRuleCases,
};

// ---------- poolSetSpelling ----------

export function poolSetSpellingCases(m: Pick<PoolSetModule, 'poolSetSpelling'>): Record<string, SuiteCase> {
  return {
    'every row of the spelling table spells as it says': () => {
      for (const c of POOL_SET_SPELL_CASES) expect(m.poolSetSpelling(c.set), `${c.name}: ${c.why}`).toStrictEqual(c.out);
    },
    'the spelling sorts ascending by byte order, and sorting is not by length': () => {
      expect(m.poolSetSpelling({ pools: ['pool-b', 'pool-a'], untagged: false })).toStrictEqual(spelled('pool-a,pool-b'));
      expect(m.poolSetSpelling({ pools: ['pool-ab', 'pool-b', 'pool-a'], untagged: false })).toStrictEqual(spelled('pool-a,pool-ab,pool-b'));
      expect(m.poolSetSpelling({ pools: ['b', 'aa', 'a'], untagged: true })).toStrictEqual(spelled('a,aa,b+untagged'));
    },
    'repeats drop, and the input is not mutated': () => {
      const pools = ['pool-b', 'pool-a', 'pool-b'];
      expect(m.poolSetSpelling({ pools, untagged: false })).toStrictEqual(spelled('pool-a,pool-b'));
      expect(pools).toStrictEqual(['pool-b', 'pool-a', 'pool-b']);
    },
    'the cap: exactly 1,024 bytes spells, 1,025 does not': () => {
      const pools = POOL_SET_AT_CAP_SPELLING.split(',');
      const overCap = { kind: 'unspellable', why: 'over-cap' };
      expect(POOL_SET_AT_CAP_SPELLING.length).toBe(1024);
      expect(m.poolSetSpelling({ pools, untagged: false })).toStrictEqual(spelled(POOL_SET_AT_CAP_SPELLING));
      expect(m.poolSetSpelling({ pools: [...pools.slice(0, -1), 'n2050'], untagged: false })).toStrictEqual(overCap);   // 1,025 bytes
      expect(m.poolSetSpelling({ pools: [...pools, 'n206'], untagged: false })).toStrictEqual(overCap);
      expect(m.poolSetSpelling({ pools, untagged: true })).toStrictEqual(overCap);
    },
    'the empty set, a bad name and an over-cap set are three answers, never one (review 2120 F1)': () => {
      const answers = [
        m.poolSetSpelling({ pools: [], untagged: false }),
        m.poolSetSpelling({ pools: ['Pool-A'], untagged: false }),
        m.poolSetSpelling({ pools: POOL_SET_AT_CAP_SPELLING.split(','), untagged: true }),
      ];
      expect(answers).toStrictEqual([{ kind: 'empty' }, { kind: 'unspellable', why: 'name' }, { kind: 'unspellable', why: 'over-cap' }]);
    },
  };
}

const SPELL_SET: MutantSet<PoolSetModule> = {
  modulePath: SET_MODULE,
  mutants: [
    { id: 'L1 no sort', old: '  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));\n', new: '' },
    { id: 'L2 sorted descending', old: '(a < b ? -1 : a > b ? 1 : 0)', new: '(a < b ? 1 : a > b ? -1 : 0)' },
    { id: 'L3 repeats kept', old: '[...new Set(set.pools)]', new: '[...set.pools]' },
    { id: 'L4 the empty set spells', old: "  if (names.length === 0 && !set.untagged) return { kind: 'empty' };\n", new: '' },
    { id: 'L5 an unspellable name spells', old: "  if (names.some((n) => !POOL_NAME_RE.test(n))) return { kind: 'unspellable', why: 'name' };\n", new: '' },
    { id: 'L6 no cap', old: "  if (spelling.length > POOL_SET_SPELLING_MAX_BYTES) return { kind: 'unspellable', why: 'over-cap' };\n", new: '' },
    { id: 'L7 the cap one early', old: "spelling.length > POOL_SET_SPELLING_MAX_BYTES) return { kind", new: "spelling.length >= POOL_SET_SPELLING_MAX_BYTES) return { kind" },
    { id: 'L8 the cap one late', old: "spelling.length > POOL_SET_SPELLING_MAX_BYTES) return { kind", new: "spelling.length > POOL_SET_SPELLING_MAX_BYTES + 1) return { kind" },
    { id: 'L11 a bad name reads as the empty set', old: "return { kind: 'unspellable', why: 'name' };", new: "return { kind: 'empty' };" },
    { id: 'L12 over the cap reads as the empty set', old: "return { kind: 'unspellable', why: 'over-cap' };", new: "return { kind: 'empty' };" },
    { id: 'L13 over the cap reads as a bad name', old: "return { kind: 'unspellable', why: 'over-cap' };", new: "return { kind: 'unspellable', why: 'name' };" },
    { id: 'L9 the untagged suffix dropped', old: "(set.untagged ? UNTAGGED_SUFFIX : '')", new: "''" },
    { id: 'L10 the untagged suffix always', old: "(set.untagged ? UNTAGGED_SUFFIX : '')", new: 'UNTAGGED_SUFFIX' },
  ],
  suite: poolSetSpellingCases,
};

// ---------- parsePoolSet ----------

export function parsePoolSetCases(m: Pick<PoolSetModule, 'parsePoolSet'>): Record<string, SuiteCase> {
  return {
    'every row of the spelling table reads as it says': () => {
      for (const c of POOL_SET_PARSE_CASES) {
        const r = m.parsePoolSet(c.spelling);
        if (c.out === 'malformed') expect(r, `${c.name}: ${c.why}`).toStrictEqual({ ok: false });
        else expect(r, `${c.name}: ${c.why}`).toStrictEqual({ ok: true, set: c.out });
      }
    },
    'strictly ascending: an unsorted list and a repeat are malformed, a sorted one is not': () => {
      expect(m.parsePoolSet('pool-b,pool-a').ok).toBe(false);
      expect(m.parsePoolSet('pool-a,pool-a').ok).toBe(false);
      expect(m.parsePoolSet('pool-a,pool-b,pool-a').ok).toBe(false);
      expect(m.parsePoolSet('pool-a,pool-b,pool-b').ok).toBe(false);
      expect(m.parsePoolSet('pool-a,pool-ab,pool-b').ok).toBe(true);
    },
    'the cap: 1,024 bytes reads, 1,025 is malformed, and the suffix counts': () => {
      expect(POOL_SET_AT_CAP_SPELLING.length).toBe(1024);
      expect(m.parsePoolSet(POOL_SET_AT_CAP_SPELLING).ok).toBe(true);
      expect(m.parsePoolSet(`${POOL_SET_AT_CAP_SPELLING}x`).ok).toBe(false);
      expect(m.parsePoolSet(`${POOL_SET_AT_CAP_SPELLING}+untagged`).ok).toBe(false);
      expect(m.parsePoolSet(POOL_SET_AT_CAP_SPELLING.split(',').slice(0, -1).join(',')).ok).toBe(true);
    },
    'no byte outside the grammar: CR, NUL, newline, space, a non-ASCII character': () => {
      for (const bad of ['pool-a\r', 'pool-a\0', 'pool-a\n', ' pool-a', 'pool-a ', 'pool-é', 'é']) {
        expect(m.parsePoolSet(bad).ok, JSON.stringify(bad)).toBe(false);
      }
    },
    'the suffix is exact and ends the spelling': () => {
      expect(m.parsePoolSet('+untagged')).toStrictEqual({ ok: true, set: { pools: [], untagged: true } });
      expect(m.parsePoolSet('pool-a+untagged')).toStrictEqual({ ok: true, set: { pools: ['pool-a'], untagged: true } });
      expect(m.parsePoolSet('pool-a')).toStrictEqual({ ok: true, set: { pools: ['pool-a'], untagged: false } });
      for (const bad of ['+untagged+untagged', '+UNTAGGED', '+untagge', '+', 'pool-a+', 'pool-a,+untagged', '+untagged,pool-a']) {
        expect(m.parsePoolSet(bad).ok, bad).toBe(false);
      }
    },
  };
}

const PARSE_SET: MutantSet<PoolSetModule> = {
  modulePath: SET_MODULE,
  mutants: [
    { id: 'P1 the ascending check dropped', old: '    if (i > 0 && !(pools[i - 1]! < n)) return { ok: false };\n', new: '' },
    { id: 'P2 repeats allowed', old: '!(pools[i - 1]! < n)', new: 'pools[i - 1]! > n' },
    { id: 'P3 descending required', old: '!(pools[i - 1]! < n)', new: '!(pools[i - 1]! > n)' },
    { id: 'P4 the byte cap dropped', old: ' || spelling.length > POOL_SET_SPELLING_MAX_BYTES', new: '' },
    { id: 'P5 the byte cap one early', old: 'spelling.length > POOL_SET_SPELLING_MAX_BYTES) return { ok', new: 'spelling.length >= POOL_SET_SPELLING_MAX_BYTES) return { ok' },
    { id: 'P6 the byte cap one late', old: 'spelling.length > POOL_SET_SPELLING_MAX_BYTES) return { ok', new: 'spelling.length > POOL_SET_SPELLING_MAX_BYTES + 1) return { ok' },
    { id: 'P7 the name pattern dropped', old: '    if (!POOL_NAME_RE.test(n)) return { ok: false };\n', new: '' },
    { id: 'P8 the suffix never read', old: 'spelling.endsWith(UNTAGGED_SUFFIX)', new: 'false' },
    { id: 'P10 the suffix alone is malformed', old: 'if (head.length === 0) return { ok: true, set: { pools: [], untagged: true } };', new: 'if (head.length === 0) return { ok: false };' },
    { id: 'P12 the suffix answer reads untagged no', old: '{ ok: true, set: { pools, untagged } }', new: '{ ok: true, set: { pools, untagged: false } }' },
  ],
  suite: parsePoolSetCases,
};

// ---------- parsePoolAnswer (plan Task 6) ----------

const PARSER_MODULE = path.join(ROOT, 'server/src/poolrule.ts');
export type PoolRuleServerModule = typeof import('../../src/poolrule.js');

/** A well-formed `ccd pool-answer` line, its six values overridable by key. */
export function poolAnswerLine(o: Partial<Record<'side' | 'verdict' | 'pool-side' | 'pool-state' | 'crossing' | 'account', string>> = {}): string {
  const v = { side: 'set:pool-a,pool-b', verdict: 'serve', 'pool-side': 'account', 'pool-state': 'named:pool-a', crossing: 'none', account: 'lane-a', ...o };
  return `pool-answer side=${v.side} verdict=${v.verdict} pool-side=${v['pool-side']} pool-state=${v['pool-state']} crossing=${v.crossing} account=${v.account}\n`;
}

export function parsePoolAnswerCases(m: Pick<PoolRuleServerModule, 'parsePoolAnswer'>): Record<string, SuiteCase> {
  const ok = (stdout: string) => m.parsePoolAnswer({ ran: true, code: 0, stdout });
  const kind = (stdout: string) => ok(stdout).kind;
  return {
    'ran is read first: a read that did not happen is not-run whatever its code, never refused': () => {
      expect(m.parsePoolAnswer({ ran: false, code: 1, stdout: '' })).toStrictEqual({ kind: 'not-run' });
      expect(m.parsePoolAnswer({ ran: false, code: 0, stdout: poolAnswerLine() })).toStrictEqual({ kind: 'not-run' });
    },
    'ran with a non-zero code is ccd\'s refusal, its code kept': () => {
      expect(m.parsePoolAnswer({ ran: true, code: 1, stdout: '' })).toStrictEqual({ kind: 'refused', code: 1 });
      expect(m.parsePoolAnswer({ ran: true, code: 3, stdout: poolAnswerLine() })).toStrictEqual({ kind: 'refused', code: 3 });
    },
    'a well-formed line is an answer, every field read': () => {
      expect(ok(poolAnswerLine())).toStrictEqual({ kind: 'answer', answer: {
        side: 'set:pool-a,pool-b', verdict: 'serve', poolSide: 'account', poolState: 'named:pool-a', crossing: 'none', account: 'lane-a' } });
      expect(ok(poolAnswerLine({ side: 'set-unreadable', verdict: 'undecidable', 'pool-side': 'set', 'pool-state': 'unreadable', crossing: 'unreadable' })))
        .toStrictEqual({ kind: 'answer', answer: { side: 'set-unreadable', verdict: 'undecidable', poolSide: 'set', poolState: 'unreadable', crossing: 'unreadable', account: 'lane-a' } });
      expect(ok(poolAnswerLine({ side: 'untagged', 'pool-side': 'project', 'pool-state': 'untagged', crossing: 'valid' })).kind).toBe('answer');
      expect(ok(poolAnswerLine({ side: 'named:pool-b', verdict: 'mismatch', 'pool-state': 'named:pool-a' })).kind).toBe('answer');
      expect(ok(poolAnswerLine({ side: 'set:+untagged', 'pool-state': 'untagged' })).kind).toBe('answer');
      expect(ok(poolAnswerLine().slice(0, -1)).kind, 'the newline is optional').toBe('answer');
    },
    'every side word ccd prints is read, and nothing else': () => {
      for (const side of ['untagged', 'unreadable', 'malformed', 'set-unreadable', 'set-malformed', 'named:pool-a', 'set:pool-a', 'set:pool-a+untagged']) {
        expect(kind(poolAnswerLine({ side })), side).toBe('answer');
      }
      for (const side of ['', 'named', 'named:', 'named:Pool', 'set:', 'set:pool-b,pool-a', 'set', 'stale', 'set-stale', 'named:pool-a,pool-b']) {
        expect(kind(poolAnswerLine({ side })), JSON.stringify(side)).toBe('unparsed');
      }
    },
    'an extra key, a missing key, a key out of order and a repeated key are unparsed': () => {
      expect(kind(`${poolAnswerLine().slice(0, -1)} extra=1\n`)).toBe('unparsed');
      expect(kind(poolAnswerLine().replace(' crossing=none', ''))).toBe('unparsed');
      expect(kind(poolAnswerLine().replace('verdict=serve pool-side=account', 'pool-side=account verdict=serve'))).toBe('unparsed');
      expect(kind(poolAnswerLine().replace('account=lane-a', 'crossing=none'))).toBe('unparsed');
      expect(kind(poolAnswerLine().replace('pool-answer ', 'pool-answers '))).toBe('unparsed');
      expect(kind(poolAnswerLine().replace('account=', 'acc0unt=')), 'a misspelled key of the same length').toBe('unparsed');
    },
    'a verdict, a pool side, a crossing or an account outside its vocabulary is unparsed': () => {
      expect(kind(poolAnswerLine({ verdict: 'yes' }))).toBe('unparsed');
      expect(kind(poolAnswerLine({ verdict: '' }))).toBe('unparsed');
      expect(kind(poolAnswerLine({ 'pool-side': 'projection' }))).toBe('unparsed');
      expect(kind(poolAnswerLine({ crossing: 'maybe' }))).toBe('unparsed');
      expect(kind(poolAnswerLine({ account: '' }))).toBe('unparsed');
      expect(kind(poolAnswerLine({ account: 'a/b' }))).toBe('unparsed');
      expect(kind(poolAnswerLine({ account: 'a'.repeat(65) }))).toBe('unparsed');
      expect(kind(poolAnswerLine({ account: 'a'.repeat(64) }))).toBe('answer');
    },
    'the pool state must be a word of its own side': () => {
      expect(kind(poolAnswerLine({ 'pool-side': 'account', 'pool-state': 'stale' }))).toBe('answer');
      expect(kind(poolAnswerLine({ 'pool-side': 'project', 'pool-state': 'stale' }))).toBe('unparsed');
      expect(kind(poolAnswerLine({ 'pool-side': 'project', 'pool-state': 'named:pool-a' }))).toBe('unparsed');
      expect(kind(poolAnswerLine({ 'pool-side': 'set', 'pool-state': 'unrecognised' }))).toBe('answer');
      expect(kind(poolAnswerLine({ 'pool-side': 'set', 'pool-state': 'untagged' }))).toBe('unparsed');
      expect(kind(poolAnswerLine({ 'pool-side': 'account', 'pool-state': 'named:' }))).toBe('unparsed');
    },
    'an empty stdout, a second line and a double space are unparsed': () => {
      expect(kind('')).toBe('unparsed');
      expect(kind('\n')).toBe('unparsed');
      expect(kind(poolAnswerLine() + poolAnswerLine())).toBe('unparsed');
      expect(kind(poolAnswerLine().replace(' verdict', '  verdict'))).toBe('unparsed');
    },
  };
}

const ANSWER_SET: MutantSet<PoolRuleServerModule> = {
  modulePath: PARSER_MODULE,
  mutants: [
    { id: 'A1 code read before ran', old: '  if (!r.ran) return { kind: \'not-run\' };\n  if (r.code !== 0) return { kind: \'refused\', code: r.code };',
      new: '  if (r.code !== 0) return { kind: \'refused\', code: r.code };\n  if (!r.ran) return { kind: \'not-run\' };' },
    { id: 'A2 ran ignored', old: '  if (!r.ran) return { kind: \'not-run\' };\n', new: '' },
    // A3 (the second-line check dropped) is EQUIVALENT, so it is not listed: a second line glues onto the last token, the
    // account, whose pattern admits no newline. The check stays in the code for its own `why`.
    { id: 'A4 the key count unchecked', old: 'if (tokens.length !== POOL_ANSWER_KEYS.length + 1) return', new: 'if (tokens.length < POOL_ANSWER_KEYS.length + 1) return' },
    { id: 'A5 the head word unchecked', old: '  if (tokens[0] !== \'pool-answer\') return { kind: \'unparsed\', why: \'not a pool-answer line\' };\n', new: '' },
    { id: 'A6 the side unchecked', old: '    return { kind: \'unparsed\', why: \'side\' };', new: '    void 0;' },
    { id: 'A7 a set side read without its parse', old: "(side.startsWith('set:') && parsePoolSet(side.slice('set:'.length)).ok)", new: "side.startsWith('set:')" },
    { id: 'A8 the verdict unchecked', old: '  if (!isWordOf(POOL_ANSWER_VERDICTS, verdict)) return { kind: \'unparsed\', why: \'verdict\' };\n', new: '' },
    { id: 'A9 the pool side unchecked', old: '  if (!isWordOf(POOL_ANSWER_POOL_SIDES, poolSide)) return { kind: \'unparsed\', why: \'pool-side\' };\n', new: '' },
    { id: 'A10 any state on any side', old: 'isWordOf(POOL_ANSWER_STATES[poolSide], poolState)', new: 'Object.values(POOL_ANSWER_STATES).some((w) => w.includes(poolState))' },
    { id: 'A11 a named state on any side', old: "(poolSide === 'account' && namedPool(poolState))", new: 'namedPool(poolState)' },
    { id: 'A12 the crossing unchecked', old: '  if (!isWordOf(POOL_ANSWER_CROSSINGS, crossing)) return { kind: \'unparsed\', why: \'crossing\' };\n', new: '' },
    { id: 'A13 the account unchecked', old: '  if (!ACCOUNT_ID_RE.test(account)) return { kind: \'unparsed\', why: \'account\' };\n', new: '' },
    { id: 'A14 a key read anywhere', old: "if (!t.startsWith(`${key}=`))", new: "if (!t.includes('='))" },
    { id: 'A15 a named pool without its pattern', old: "w.startsWith('named:') && POOL_NAME_RE.test(w.slice('named:'.length))", new: "w.startsWith('named:')" },
  ],
  suite: parsePoolAnswerCases,
};

export const POOL_ANSWER_PARSE_KEY = 'server/src/poolrule.ts#parsePoolAnswer';

export const POOL_RULE_KEY = 'shared/poolrule.ts#poolRule';
export const POOL_SET_SPELLING_KEY = 'shared/poolset.ts#poolSetSpelling';
export const POOL_SET_PARSE_KEY = 'shared/poolset.ts#parsePoolSet';

export const POOL_SET_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [POOL_RULE_KEY]: RULE_SET as MutantSet<never>,
  [POOL_SET_SPELLING_KEY]: SPELL_SET as MutantSet<never>,
  [POOL_SET_PARSE_KEY]: PARSE_SET as MutantSet<never>,
  [POOL_ANSWER_PARSE_KEY]: ANSWER_SET as MutantSet<never>,
};
