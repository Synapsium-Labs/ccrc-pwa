// `shared/poolset.ts`: the pool set's one-token spelling, driven through `POOL_SET_PARSE_CASES` and
// `POOL_SET_SPELL_CASES` (`fixtures/poolSetSpelling.ts`). The cases the three deciders are judged by are written ONCE in
// `sim/poolSetSets.ts` and run here against the real module, then by `sim/mutation-floors.test.ts` against each mutant.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePoolSet, poolSetSpelling, POOL_SET_SPELLING_MAX_BYTES } from '../../shared/poolset.js';
import { POOL_NAME_RE } from '../../shared/roster.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
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
  // Task 2: `_poolset_parse` (`ccd/lib/pool-set.sh`) driven over POOL_SET_PARSE_CASES in a fixture HOME. A value reaches
  // ccd only through argv (`ccd route --set poolset=…`), which cannot carry a NUL, so the one NUL row is bash's to skip:
  // the skip is bounded and pinned below. Every other row is fed whole, in ONE shell, from a NUL-separated file.
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-pool-set-spelling-'); });
  afterEach(() => { h.cleanup(); });
  const fed = POOL_SET_PARSE_CASES.filter((c) => !c.spelling.includes('\0'));

  it('the skip is the one NUL row, and the table it leaves has both answers', () => {
    expect(POOL_SET_PARSE_CASES.length - fed.length).toBe(1);
    expect(fed.some((c) => c.out === 'malformed') && fed.some((c) => c.out !== 'malformed')).toBe(true);
  });
  it('the bash cap is the TypeScript cap', () => {
    expect(h.sh('printf %s "$POOL_SET_SPELLING_MAX_BYTES"')).toBe(String(POOL_SET_SPELLING_MAX_BYTES));
  });
  it('_poolset_parse reads every spelling as parsePoolSet does', () => {
    const file = path.join(h.home, 'spellings');
    writeFileSync(file, fed.map((c) => `${c.spelling}\0`).join(''));
    const out = h.sh(`while IFS= read -r -d '' x; do o=$(_poolset_parse "$x"); printf '%s|%s\\n' "$?" "\${o//$'\\n'/;}"; done < ${JSON.stringify(file)}`);
    const lines = out.split('\n');
    expect(lines).toHaveLength(fed.length);
    fed.forEach((c, i) => {
      const want = c.out === 'malformed' ? '1|' : `0|names=${c.out.pools.join(' ')};untagged=${c.out.untagged ? 'yes' : 'no'}`;
      expect(lines[i], c.name).toBe(want);
      expect(parsePoolSet(c.spelling).ok, `${c.name}: the TypeScript side agrees with the row`).toBe(c.out !== 'malformed');
    });
  });
});
