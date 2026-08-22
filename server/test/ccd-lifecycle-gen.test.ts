// server/test/ccd-lifecycle-gen.test.ts
//
// The generation is IN THE FILENAME, not in a header line: a `readdir` alone
// tells the mirror the whole generation set with no second read, a rotation is
// "a new name appeared" rather than "the same file got smaller", and a shrink on
// an immutably-named generation is unambiguously a truncation.
//
// Deviation from the task-14 brief, per the standing rule established across
// this plan's earlier tasks: every `it` block below that makes more than one
// INDEPENDENT claim uses `expect.soft` rather than a hard `expect`, so a first
// failure does not hide the rest. No assertion's subject, matcher, or expected
// value was changed by this — only `expect` -> `expect.soft`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LC_GEN_PREFIX, LC_GEN_SUFFIX, LC_ROTATE_LOCK_NAME } from '../../shared/api.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { generationsOf, lcDir } from './lifecycleHelpers.js';

let h: CcdHarness;
let dir: string;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-gen-'); dir = lcDir(h.home); });
afterEach(() => { h.cleanup(); });

const gen = (ns: string): string => `${LC_GEN_PREFIX}${ns}${LC_GEN_SUFFIX}`;
const gens = (): string[] => generationsOf(h.home);

describe('_lc_live', () => {
  it('mints the directory and the first generation, and its name is 19 digits', () => {
    const p = h.sh('_lc_live');
    expect.soft(p).toMatch(/\.lifecycle\/journal-\d{19}\.ndjson$/);
    expect.soft(fs.existsSync(p)).toBe(true);
    expect.soft(gens()).toHaveLength(1);
  });

  it('is idempotent — a second call reuses the same generation, it does not mint', () => {
    const a = h.sh('_lc_live'); const b = h.sh('_lc_live');
    expect.soft(b).toBe(a);
    expect.soft(gens()).toHaveLength(1);
  });

  it('picks the GREATEST name, not the newest mtime', () => {
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['1000000000000000000', '3000000000000000000', '2000000000000000000']) {
      fs.writeFileSync(path.join(dir, gen(n)), '');
    }
    fs.utimesSync(path.join(dir, gen('1000000000000000000')), new Date(), new Date());
    expect(h.sh('_lc_live')).toBe(path.join(dir, gen('3000000000000000000')));
  });

  it('answers the empty string rather than dying when the directory cannot be made', () => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.lifecycle'), 'not a directory');
    expect(h.sh('_lc_live; printf END')).toBe('END');
  });

  // Not in the task-14 brief's literal test file — required by the dispatch:
  // "ORDERING IS BY FILENAME, AND IT IS LENGTH-FIRST — NOT lexicographic."
  // `shared/api.ts`'s `compareGenerations` picks the 20-digit name as greater
  // than ANY 19-digit name regardless of content
  // (`server/test/lifecycle-journal-constants.test.ts:114`,
  // `compareGenerations('9999999999999999999', '10000000000000000000')` is
  // negative — the 19-digit all-nines name is LESS than the 20-digit name
  // starting with '1'). A bare bash `[[ "$a" > "$b" ]]` or `sort` disagrees
  // here: lexicographically '9' > '1' at the first differing byte, so a naive
  // ordering picks the 19-digit name as "greatest" — exactly backwards.
  it('agrees with L0\'s length-first rule on a 19-digit vs 20-digit pair', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, gen('9999999999999999999')), '');
    fs.writeFileSync(path.join(dir, gen('10000000000000000000')), '');
    expect(h.sh('_lc_live')).toBe(path.join(dir, gen('10000000000000000000')));
  });
});

describe('_lc_rotate', () => {
  const big = (name: string): string => {
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'x'.repeat(4 * 1024 * 1024 + 1));
    return p;
  };

  it('does nothing at all below the cap', () => {
    const p = h.sh('_lc_live');
    fs.appendFileSync(p, 'small\n');
    h.sh(`_lc_rotate "${p}"`);
    expect.soft(gens()).toHaveLength(1);
    expect.soft(fs.readFileSync(p, 'utf8')).toBe('small\n');
  });

  it('MINTS A GREATER NAME and leaves the full one byte-identical — it never truncates', () => {
    // Mutant: replace the mint with `: > "$live"` -> this fails with
    // `the full generation must survive byte-for-byte: expected 0 to be 4194305`,
    // and `agent/src/tail.ts:53-58` hands its reader a reset it must model.
    const p = big(gen('1000000000000000000'));
    const before = fs.statSync(p).size;
    h.sh(`_lc_rotate "${p}"`);
    expect.soft(gens()).toHaveLength(2);
    expect.soft(fs.statSync(p).size, 'the full generation must survive byte-for-byte').toBe(before);
  });

  it('drops the OLDEST beyond four generations', () => {
    // Deviation from the task-14 brief: the brief's literal fixture named the
    // four "old" generations `1000000000000000000`..`4000000000000000000` —
    // 19-digit round numbers that straddle a REAL `_lc_now_ns()` reading
    // (measured: epoch ns is ~1.787e18 today, i.e. numerically between the
    // "1" and "2" fixtures). `_lc_rotate`'s own mint therefore lands inside
    // this test's "four oldest" range and — correctly, per the guard proven
    // below — survives retention, leaving 5 generations rather than the 4
    // the brief's literal assertions expect. That is not this test's mutant
    // to catch (the "NEVER prunes the generation it just minted" test below
    // owns it, and does, unmodified). Ten digits, not nineteen: by L0's
    // LENGTH-FIRST rule the same `compareGenerations` this whole task exists
    // to honour, a 10-digit name is unconditionally the smallest regardless
    // of a real 19-digit mint's numeric value, so this fixture no longer
    // depends on today's clock reading to keep the two tests independent.
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['1', '2', '3', '4']) {
      fs.writeFileSync(path.join(dir, gen(`${n}000000000`)), 'x');
    }
    const p = big(gen('5000000000000000000'));
    h.sh(`_lc_rotate "${p}"`);
    const left = gens();
    expect.soft(left).toHaveLength(4);
    expect.soft(left).toContain(gen('5000000000000000000'));
    expect.soft(left).not.toContain(gen('1000000000'));
  });

  it('NEVER prunes the generation it just minted, even beside a future-dated name', () => {
    // Mutant: delete the `!= "$live_now"` conjunct -> this fails with
    // `the freshly minted generation was pruned: expected [...] to contain ...`.
    // Production names are monotonic, so this cannot bite today; nothing stated
    // or enforced that, and a rotation that eats its own mint never converges —
    // `_lc_live` picks the full generation again on the very next event.
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['1', '2', '3', '4']) {
      fs.writeFileSync(path.join(dir, gen(`${n}000000000000000000`)), 'x');
    }
    const p = big(gen('9000000000000000000'));   // greater than any clock read
    h.sh(`_lc_rotate "${p}"`);
    const minted = gens().filter((f) => f !== gen('9000000000000000000')
      && !['1', '2', '3', '4'].some((n) => f === gen(`${n}000000000000000000`)));
    expect.soft(minted, 'nothing was minted — the fixture is wrong, not the guard').toHaveLength(1);
    expect.soft(gens(), 'the freshly minted generation was pruned').toContain(minted[0]!);
  });

  it('SKIPS rotation rather than dying when flock is unavailable', () => {
    // Every other flock site in ccd (1760, 3070, 5910) `die`s here. This one
    // must not: D7 forbids the journal from gating anything, so the generation
    // is allowed to grow past its cap instead.
    const p = big(gen('1000000000000000000'));
    const out = h.sh(`command() { if [[ "$2" == flock ]]; then return 1; fi; builtin command "$@"; }
      _lc_rotate "${p}"; printf END`);
    expect.soft(out).toBe('END');
    expect.soft(gens()).toHaveLength(1);
  });

  it('never unlinks the rotate lock', () => {
    const p = big(gen('1000000000000000000'));
    h.sh(`_lc_rotate "${p}"`);
    expect(fs.existsSync(path.join(dir, LC_ROTATE_LOCK_NAME)),
      'unlinking a held lock is how two processes come to hold it on two inodes (ccd:1531-1534)').toBe(true);
  });
});
