// `shared/poolset.ts`: the pool set's one-token spelling, driven through `POOL_SET_PARSE_CASES` and
// `POOL_SET_SPELL_CASES` (`fixtures/poolSetSpelling.ts`). The cases the three deciders are judged by are written ONCE in
// `sim/poolSetSets.ts` and run here against the real module, then by `sim/mutation-floors.test.ts` against each mutant.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePoolSet, poolSetSpelling, POOL_SET_SPELLING_MAX_BYTES } from '../../shared/poolset.js';
import { execFileSync } from 'node:child_process';
import { ACCOUNT_ID_RE, POOL_NAME_RE } from '../../shared/roster.js';
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
    for (const kind of ['spelled', 'empty', 'unspellable:name', 'unspellable:over-cap']) {
      const has = POOL_SET_SPELL_CASES.some((c) => (c.out.kind === 'unspellable' ? `unspellable:${c.out.why}` : c.out.kind) === kind);
      expect(has, `no row answers ${kind}`).toBe(true);
    }
  });
  it.each(POOL_SET_SPELL_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(poolSetSpelling(c.set), c.why).toStrictEqual(c.out);
  });
});

describe('every spelling round-trips', () => {
  it('a parsed spelling spells back to itself', () => {
    const ok = POOL_SET_PARSE_CASES.filter((c) => c.out !== 'malformed');
    expect(ok.length).toBeGreaterThan(5);
    for (const c of ok) {
      const r = parsePoolSet(c.spelling);
      expect(r.ok, c.name).toBe(true);
      if (r.ok) expect(poolSetSpelling(r.set), c.name).toStrictEqual({ kind: 'spelled', spelling: c.spelling });
    }
  });
  it('a spelt set parses back to the sorted, repeat-free set', () => {
    const spelt = POOL_SET_SPELL_CASES.flatMap((c) => (c.out.kind === 'spelled' ? [{ ...c, spelling: c.out.spelling }] : []));
    expect(spelt.length).toBeGreaterThan(4);
    for (const c of spelt) {
      const r = parsePoolSet(c.spelling);
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
  // Run the whole table through `_poolset_parse` in ONE shell, with `extra` added to the harness's variables (the
  // runner's locale when none is named) and `pre` (shell text) run before the loop. Each line is the row's rc and
  // output, its newline written as `;`.
  const bashAnswers = (extra: NodeJS.ProcessEnv = {}, pre = ''): string[] => {
    const file = path.join(h.home, 'spellings');
    writeFileSync(file, fed.map((c) => `${c.spelling}\0`).join(''));
    const out = h.sh(`${pre}
      while IFS= read -r -d '' x; do o=$(_poolset_parse "$x"); printf '%s|%s\\n' "$?" "\${o//$'\\n'/;}"; done < ${JSON.stringify(file)}`, extra);
    return out.split('\n');
  };
  const wantOf = (c: (typeof fed)[number]): string =>
    c.out === 'malformed' ? '1|' : `0|names=${c.out.pools.join(' ')};untagged=${c.out.untagged ? 'yes' : 'no'}`;
  it('_poolset_parse reads every spelling as parsePoolSet does', () => {
    const lines = bashAnswers();
    expect(lines).toHaveLength(fed.length);
    fed.forEach((c, i) => {
      expect(lines[i], c.name).toBe(wantOf(c));
      expect(parsePoolSet(c.spelling).ok, `${c.name}: the TypeScript side agrees with the row`).toBe(c.out !== 'malformed');
    });
  });
  // Review 2120 F2: `local LC_ALL=C` is what makes the order test bytewise and `[a-z]` ASCII. Under a locale whose
  // collation is not bytewise (en_US), the row `pool-b,poola` is refused and `pool-é` accepted without it. CI's image
  // may not carry that locale, so this case runs where `locale -a` lists it, and the structural pin below holds the
  // line everywhere.
  const enUs = (() => {
    try { return execFileSync('locale', ['-a'], { encoding: 'utf8' }).split('\n').map((l) => l.trim()).find((l) => /^en_US\.utf-?8$/i.test(l)); }
    catch { return undefined; }
  })();
  it.runIf(enUs !== undefined)('_poolset_parse reads every spelling the same under en_US.UTF-8 (review 2120 F2)', () => {
    const lines = bashAnswers({ LC_ALL: enUs!, LANG: enUs! });
    expect(lines).toHaveLength(fed.length);
    fed.forEach((c, i) => { expect(lines[i], c.name).toBe(wantOf(c)); });
  });
  it('_poolset_parse and _acctorder_valid split on their own IFS, whatever the caller set (review 2120 F5)', () => {
    for (const ifs of [',', '-', 'a', ':', '\\n']) {
      const pre = `IFS=$'${ifs}'`;
      const lines = bashAnswers({}, pre);
      expect(lines, ifs).toHaveLength(fed.length);
      fed.forEach((c, i) => { expect(lines[i], `${ifs}: ${c.name}`).toBe(wantOf(c)); });
      const acct = h.sh(`${pre}; _acctorder_valid x,x; printf '%s' "$?"; _acctorder_valid x,y; printf '%s' "$?"`);
      expect(acct, `${ifs}: a repeat refused, two ids accepted`).toBe('10');
    }
  });
});

describe('the library\'s guards are in the function bodies (review 2120 F2, F5, F6)', () => {
  const lib = readFileSync(path.join(HERE, '..', '..', 'ccd', 'lib', 'pool-set.sh'), 'utf8');
  const body = (fn: string): string => {
    const m = lib.match(new RegExp(`^${fn}\\(\\) \\{[^\\n]*\\n([\\s\\S]*?)^\\}$`, 'm'));
    expect(m, `${fn} is defined`).not.toBeNull();
    return m![1]!;
  };
  for (const fn of ['_poolset_parse', '_acctorder_valid']) {
    it(`${fn} sets the C locale and its own IFS on its first local line`, () => {
      const local = body(fn).split('\n').find((l) => /^\s*local /.test(l));
      expect(local, fn).toMatch(/^\s*local LC_ALL=C IFS=' ' /);
    });
  }
  it('_acctorder_valid\'s element is ACCOUNT_ID_RE\'s, lifted from its source', () => {
    const element = ACCOUNT_ID_RE.source.replace(/^\^/, '').replace(/\$$/, '');
    expect(element).toBe('[A-Za-z0-9._-]{1,64}');
    expect(body('_acctorder_valid')).toContain(`=~ ^${element}(,${element})*$ ]]`);
  });
});
