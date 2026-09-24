// Design 2026-09-20 decision 2 and §9: `shared/semver.ts` is the one TS
// comparator over the tag form, "pinned to agree with `sort -V` on a fixture
// list run through a shell". It also has a bash twin that shipped first —
// `_ver_newer` in `ccd/ccrc`, which `cmd_update`'s floor check runs on every
// box — so it is pinned to BOTH: two comparators that disagree on one pair
// would let the server resolve a tag the node's own updater then refuses as
// below its floor, or the reverse.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareReleaseTags, isNewerTag, newestTag } from '../../shared/semver.js';
import { isReleaseTag } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SEMVER = path.join(REPO, 'shared', 'semver.ts');

// Distinct VALUES only: `sort -V` has no notion of two spellings of one version
// and would order `v0.0.10`/`v0.0.010` by some tie-break of its own. Shuffled
// on purpose — an input already in order proves nothing about a sort.
const DISTINCT = ['v1.0.0', 'v0.0.10', 'v10.0.0', 'v0.1.0', 'v0.0.9', 'v2.0.0', 'v0.10.0', 'v1.9.10', 'v1.9.9'];

// Coordinator addendum (fix round 1, dispatch E): a bounded timeout and a
// hard kill signal on every spawnSync in this file, so a stuck child fails
// its one case instead of freezing the whole vitest worker.
const SPAWN_OPTS = { timeout: 30_000, killSignal: 'SIGKILL' as const };

const sortV = (list: readonly string[]): string[] =>
  spawnSync('bash', ['-c', 'printf "%s\\n" "$@" | sort -V', '--', ...list],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, ...SPAWN_OPTS }).stdout.trim().split('\n');

/** `_ver_newer`, extracted from the shipped `ccd/ccrc` by regex — the W1 Task
 *  10 shape (`ccrc-install.test.ts`, "_ver_newer agrees with sort -V") — so a
 *  change to the bash function is a change to what this pins. */
const verNewerSrc = (): string => {
  const src = readFileSync(path.join(REPO, 'ccd', 'ccrc'), 'utf8');
  const fn = /^_ver_newer\(\) \{[\s\S]*?\n\}/m.exec(src);
  expect(fn, 'ccd/ccrc has no _ver_newer').not.toBeNull();
  return fn![0];
};

describe('compareReleaseTags agrees with sort -V (design §9)', () => {
  it('sorts the fixture list exactly as sort -V does', () => {
    const expected = sortV(DISTINCT);
    expect(expected, 'sort -V answered nothing — no bash or no sort on this box').toHaveLength(DISTINCT.length);
    expect([...DISTINCT].sort(compareReleaseTags)).toEqual(expected);
  });

  it('is not the lexical order — the case plain sort gets wrong', () => {
    expect(isNewerTag('v1.9.10', 'v1.9.9')).toBe(true);
    expect(isNewerTag('v0.10.0', 'v0.9.0')).toBe(true);
    expect(isNewerTag('v10.0.0', 'v9.99.99')).toBe(true);
  });
});

describe('compareReleaseTags agrees with ccd/ccrc\'s _ver_newer on every ordered pair', () => {
  const PAIRS = [...DISTINCT, 'v0.0.010'];

  it('isNewerTag(a, b) is exactly _ver_newer a b exiting 0, and 0 means neither is newer', () => {
    const fn = verNewerSrc();
    for (const a of PAIRS) {
      for (const b of PAIRS) {
        const r = spawnSync('bash', ['-c', `${fn}\n_ver_newer "$1" "$2"`, '--', a, b], { encoding: 'utf8', ...SPAWN_OPTS });
        expect(r.status === 0 || r.status === 1, `_ver_newer ${a} ${b} exited ${r.status}: ${r.stderr}`).toBe(true);
        expect(isNewerTag(a, b), `${a} newer than ${b}?`).toBe(r.status === 0);
        const back = spawnSync('bash', ['-c', `${fn}\n_ver_newer "$1" "$2"`, '--', b, a], { encoding: 'utf8', ...SPAWN_OPTS });
        const neither = r.status !== 0 && back.status !== 0;
        expect(compareReleaseTags(a, b) === 0, `${a} vs ${b}: equal iff neither is newer`).toBe(neither);
      }
    }
  });

  it('v0.0.10 and v0.0.010 are one version to both comparators', () => {
    expect(compareReleaseTags('v0.0.10', 'v0.0.010')).toBe(0);
    expect(compareReleaseTags('v0.0.010', 'v0.0.10')).toBe(0);
    expect(isNewerTag('v0.0.10', 'v0.0.010')).toBe(false);
  });

  it('is antisymmetric and answers only -1, 0 or 1', () => {
    for (const a of PAIRS) {
      for (const b of PAIRS) {
        const c = compareReleaseTags(a, b);
        expect([-1, 0, 1]).toContain(c);
        expect(compareReleaseTags(b, a)).toBe(-c === 0 ? 0 : -c);
      }
    }
  });

  it('is exact past 2^53 — digit strings, never Number()', () => {
    // 9007199254740993 === 9007199254740992 as a Number; as digits it is one more.
    expect(compareReleaseTags('v9007199254740993.0.0', 'v9007199254740992.0.0')).toBe(1);
    expect(compareReleaseTags('v0.0.00000000000000000000001', 'v0.0.1')).toBe(0);
  });
});

describe('newestTag', () => {
  it('answers null for an empty list and the newest otherwise', () => {
    expect(newestTag([])).toBeNull();
    expect(newestTag(['v0.0.9'])).toBe('v0.0.9');
    expect(newestTag(DISTINCT)).toBe('v10.0.0');
    expect(newestTag(['v0.0.9', 'v0.0.10', 'v0.0.8'])).toBe('v0.0.10');
  });

  it('keeps the FIRST of two spellings of one version — a stable answer', () => {
    expect(newestTag(['v0.0.10', 'v0.0.010'])).toBe('v0.0.10');
    expect(newestTag(['v0.0.010', 'v0.0.10'])).toBe('v0.0.010');
  });

  it('refuses a list with a non-tag in it, first element included', () => {
    expect(() => newestTag(['0.0.9'])).toThrow(RangeError);
    expect(() => newestTag(['v0.0.9', 'v0.0.10 '])).toThrow(RangeError);
  });
});

describe('a non-tag is refused, never ordered — and the parse is isReleaseTag\'s', () => {
  // The fixture list `update-states.test.ts` holds RELEASE_TAG to bash's SHAPE
  // on, widened by the shapes a structural parse gets wrong first.
  const SHAPES = [
    'v0.0.9', 'v0.0.10', 'v1.2.3', 'v10.20.30', 'v0.0.010', 'v0.0.0',
    '0.0.9', 'v0.0.9 ', ' v0.0.9', 'v0.0.9\n', 'v0.0', 'v0.0.9.1', 'V0.0.9', 'v0..9', 'v.0.0.9',
    'v0.0.9-rc1', 'v0.0.9+meta', 'vv0.0.9', 'v-1.0.0', 'v1e3.0.0', 'v0x1.0.0', 'v\u0661.0.0', '',
    'v', 'v..', 'v1.2.', 'v.1.2', 'v1.2.3.', 'v 1.2.3', 'v1.2.3\u0000', 'v\uff11.0.0', 'v1.0.0\r',
  ];

  it('throws RangeError on exactly the shapes isReleaseTag refuses', () => {
    for (const s of SHAPES) {
      let threw: unknown = null;
      try { compareReleaseTags(s, 'v0.0.1'); } catch (e) { threw = e; }
      expect(threw === null, `${JSON.stringify(s)}: parse accepts iff isReleaseTag does`).toBe(isReleaseTag(s));
      if (threw !== null) {
        expect(threw).toBeInstanceOf(RangeError);
        expect((threw as Error).message).toMatch(/^compareReleaseTags: not a release tag: /);
      }
      // …in either argument position.
      let threwRight = false;
      try { compareReleaseTags('v0.0.1', s); } catch { threwRight = true; }
      expect(threwRight, `${JSON.stringify(s)} as the second argument`).toBe(!isReleaseTag(s));
    }
  });

  it('refuses a non-string at runtime too — a JS caller or a JSON value', () => {
    for (const v of [null, undefined, 9, ['v0.0.9'], { tag: 'v0.0.9' }]) {
      expect(() => compareReleaseTags(v as unknown as string, 'v0.0.1')).toThrow(RangeError);
      expect(() => isNewerTag('v0.0.1', v as unknown as string)).toThrow(RangeError);
    }
  });
});

describe('shared/semver.ts is L0 and imports nothing', () => {
  it('has no import line, static or dynamic, and no require', () => {
    const src = readFileSync(SEMVER, 'utf8');
    expect(src.split('\n').filter((l) => /^\s*import\b/.test(l))).toEqual([]);
    expect(src).not.toMatch(/\bimport\s*\(/);
    expect(src).not.toMatch(/\brequire\s*\(/);
  });

  it('strips the v in exactly one place — the parse', () => {
    const src = readFileSync(SEMVER, 'utf8');
    expect((src.match(/\.slice\(1\)/g) ?? []).length).toBe(1);
    expect(src).not.toMatch(/replace\(\s*\/\^v\//);
  });
});
