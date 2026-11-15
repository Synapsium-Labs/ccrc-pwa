// `shared/poolset.ts`: the pool set's one-token spelling, driven through `POOL_SET_PARSE_CASES` and
// `POOL_SET_SPELL_CASES` (`fixtures/poolSetSpelling.ts`). The cases the three deciders are judged by are written ONCE in
// `sim/poolSetSets.ts` and run here against the real module, then by `sim/mutation-floors.test.ts` against each mutant.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePoolSet, poolSetSpelling, POOL_SET_SPELLING_MAX_BYTES } from '../../shared/poolset.js';
import { POOL_NAME_RE } from '../../shared/roster.js';
import { POOL_SET_PARSE_CASES, POOL_SET_SPELL_CASES } from './fixtures/poolSetSpelling.js';
import { poolSetSpellingCases, parsePoolSetCases } from './sim/poolSetSets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('parsePoolSet over the shared spelling table', () => {
  it('the table is not vacuous', () => {
    expect(POOL_SET_PARSE_CASES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(POOL_SET_PARSE_CASES.map((c) => c.name)).size).toBe(POOL_SET_PARSE_CASES.length);
    expect(POOL_SET_PARSE_CASES.some((c) => c.out === 'malformed')).toBe(true);
    expect(POOL_SET_PARSE_CASES.some((c) => c.out !== 'malformed')).toBe(true);
  });
  it.each(POOL_SET_PARSE_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    const r = parsePoolSet(c.spelling);
    if (c.out === 'malformed') expect(r, c.why).toEqual({ ok: false });
    else expect(r, c.why).toEqual({ ok: true, set: c.out });
  });
  it('the cap is 1,024 bytes', () => {
    expect(POOL_SET_SPELLING_MAX_BYTES).toBe(1024);
  });
});

describe('poolSetSpelling over the shared spelling table', () => {
  it('the table is not vacuous', () => {
    expect(POOL_SET_SPELL_CASES.length).toBeGreaterThanOrEqual(8);
    expect(POOL_SET_SPELL_CASES.some((c) => c.out === null)).toBe(true);
  });
  it.each(POOL_SET_SPELL_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(poolSetSpelling(c.set), c.why).toBe(c.out);
  });
});

describe('every spelling round-trips', () => {
  it('a parsed spelling spells back to itself', () => {
    const ok = POOL_SET_PARSE_CASES.filter((c) => c.out !== 'malformed');
    expect(ok.length).toBeGreaterThan(5);
    for (const c of ok) {
      const r = parsePoolSet(c.spelling);
      expect(r.ok, c.name).toBe(true);
      if (r.ok) expect(poolSetSpelling(r.set), c.name).toBe(c.spelling);
    }
  });
  it('a spelt set parses back to the sorted, repeat-free set', () => {
    const spelt = POOL_SET_SPELL_CASES.filter((c) => c.out !== null);
    expect(spelt.length).toBeGreaterThan(4);
    for (const c of spelt) {
      const r = parsePoolSet(c.out!);
      expect(r.ok, c.name).toBe(true);
      if (r.ok) {
        expect(r.set.untagged, c.name).toBe(c.set.untagged);
        expect([...r.set.pools], c.name).toEqual([...new Set(c.set.pools)].sort());
      }
    }
  });
});

describe('the pool-name pattern is the roster\'s', () => {
  it('poolset.ts takes POOL_NAME_RE from roster.ts, and holds no pattern of its own', () => {
    const src = readFileSync(path.join(HERE, '..', '..', 'shared', 'poolset.ts'), 'utf8');
    const code = src.replace(/\/\/[^\n]*/g, '');
    expect(code).toMatch(/import \{ POOL_NAME_RE \} from '\.\/roster\.js';/);
    expect(code, 'a second pool-name pattern').not.toMatch(/\[a-z\]\[a-z0-9-\]/);
  });
  it('behaves as that pattern at its boundary: 32 characters pass, 33 do not', () => {
    expect(POOL_NAME_RE.test(`a${'b'.repeat(31)}`)).toBe(true);
    expect(parsePoolSet(`a${'b'.repeat(31)}`).ok).toBe(true);
    expect(parsePoolSet(`a${'b'.repeat(32)}`).ok).toBe(false);
  });
});

describe('the mutation suite cases pass on the real module', () => {
  for (const [name, fn] of Object.entries({ ...poolSetSpellingCases({ poolSetSpelling }), ...parsePoolSetCases({ parsePoolSet }) })) {
    it(name, () => { fn(); });
  }
});

describe('bash _poolset_parse over the same table', () => {
  // TASK 2 (a later pull request of the pool-set plan) adds the bash arm HERE: `_poolset_parse` in `ccd/lib/pool-set.sh`,
  // driven over POOL_SET_PARSE_CASES in a fixture HOME. Nothing is written in bash by this pull request.
  it.todo('_poolset_parse reads every spelling in POOL_SET_PARSE_CASES as parsePoolSet does (Task 2)');
});
