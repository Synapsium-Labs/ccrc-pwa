// The journal's names and its ceilings, plus the ONE reader of a generation
// filename. D1 puts the generation in the NAME, not in a header line: readdir
// alone then tells the mirror the whole generation set with no second read, a
// rotation is "a new name appeared" and never "the same file got smaller", and
// a shrink on an immutably-named generation is unambiguously a truncation.
// That only holds if exactly one piece of code decides what a generation name
// is — hence the readers here rather than a regex in the mirror.
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  LC_DIR_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX, LC_ERRORS_NAME, LC_ROTATE_LOCK_NAME,
  LC_LINE_MAX, LC_REASON_MAX_BYTES, LC_GEN_MAX_BYTES, LC_GEN_KEEP,
  LC_TOTAL_MAX_BYTES, LC_SPAWN_QUIET_MS,
  looksLikeGenerationFile, parseLifecycleGeneration, compareGenerations,
} from '../../shared/api.js';

const NS = '1755000000123456789';
const gen = (ns: string): string => `${LC_GEN_PREFIX}${ns}${LC_GEN_SUFFIX}`;

describe('the names', () => {
  it('are the five D1 spells, and the directory is dot-prefixed', () => {
    expect(LC_DIR_NAME).toBe('.lifecycle');
    expect(LC_DIR_NAME.startsWith('.'), 'a dotted directory matches no $REG/<id>.* glob').toBe(true);
    expect(LC_GEN_PREFIX).toBe('journal-');
    expect(LC_GEN_SUFFIX).toBe('.ndjson');
    expect(LC_ERRORS_NAME).toBe('errors');
    expect(LC_ROTATE_LOCK_NAME).toBe('.rotate.lock');
  });
});

describe('the ceilings', () => {
  it('are D1/D7`s numbers', () => {
    expect(LC_LINE_MAX).toBe(2048);
    expect(LC_REASON_MAX_BYTES).toBe(512);
    expect(LC_GEN_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(LC_GEN_KEEP).toBe(4);
    expect(LC_SPAWN_QUIET_MS).toBe(300_000);
  });

  it('DERIVES the hard ceiling — 16 MiB is not a second number to keep in step', () => {
    expect(LC_TOTAL_MAX_BYTES).toBe(16 * 1024 * 1024);
    expect(LC_TOTAL_MAX_BYTES).toBe(LC_GEN_MAX_BYTES * LC_GEN_KEEP);
  });

  it('a reason cannot fill a line on its own — the cap leaves room for the event', () => {
    expect(LC_REASON_MAX_BYTES).toBeLessThan(LC_LINE_MAX / 2);
  });

  it('the reason cap is BYTES, and bytes are not characters — measured, not asserted', () => {
    // The unit is the whole of B5's ruling: a 200-emoji reason is 800 bytes.
    // Cap it in characters and it passes one surface and is refused by
    // another; cap it in bytes everywhere and there is one number with one
    // meaning. ccd's twin measures the same way (`local LC_ALL=C; ${#s}`).
    const s = '🙂'.repeat(512);
    expect(s.length, 'UTF-16 code units').toBe(1024);
    expect([...s].length, 'code points').toBe(512);
    expect(Buffer.byteLength(s, 'utf8'), 'bytes').toBe(2048);
    expect(Buffer.byteLength(s, 'utf8')).toBeGreaterThan(LC_REASON_MAX_BYTES);
    // And the policy that goes with the unit: an over-cap reason is REFUSED,
    // never silently shortened. A 900-byte reason recorded as 512 reads as
    // the operator's own words, which is the overloaded-value defect at the
    // one seam whose entire job is to record what a person said.
  });
});

describe('looksLikeGenerationFile — "is this a generation file at all?"', () => {
  it('says yes for a well-formed name and for a malformed one', () => {
    expect(looksLikeGenerationFile(gen(NS))).toBe(true);
    // A `date +%N` that did not expand yields `journal-1755000000N.ndjson`. It
    // IS a generation file — it just cannot be ordered. Two questions, two
    // readers, so the mirror can record a gap instead of silently ignoring a
    // file full of real events.
    expect(looksLikeGenerationFile(`${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`)).toBe(true);
  });

  it('says no for everything else in the directory', () => {
    for (const n of [LC_ERRORS_NAME, LC_ROTATE_LOCK_NAME, '', 'journal-.ndjson',
      'journal-123', '123.ndjson', 'ournal-123.ndjson', 'journal-123.ndjson.tmp']) {
      expect(looksLikeGenerationFile(n), n).toBe(false);
    }
  });
});

describe('parseLifecycleGeneration — "and can it be ordered?"', () => {
  it('returns the digits for a well-formed name', () => {
    expect(parseLifecycleGeneration(gen(NS))).toBe(NS);
    expect(parseLifecycleGeneration(gen('7'))).toBe('7');
  });

  it('returns null for an unorderable name — DISTINCT from "not a generation"', () => {
    expect(parseLifecycleGeneration(`${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`)).toBeNull();
    expect(parseLifecycleGeneration(`${LC_GEN_PREFIX}-1${LC_GEN_SUFFIX}`)).toBeNull();
    expect(parseLifecycleGeneration(`${LC_GEN_PREFIX}1.2${LC_GEN_SUFFIX}`)).toBeNull();
    expect(parseLifecycleGeneration(LC_ERRORS_NAME)).toBeNull();
    // The pair is what makes the distinction usable:
    //   looksLike && !parse  -> a generation the mirror cannot order  -> gap
    //   !looksLike           -> not a generation at all               -> ignore
    const broken = `${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`;
    expect(looksLikeGenerationFile(broken) && parseLifecycleGeneration(broken) === null).toBe(true);
    expect(looksLikeGenerationFile(LC_ERRORS_NAME)).toBe(false);
  });

  it('bounds the digits — a 200-digit name is not a generation', () => {
    expect(parseLifecycleGeneration(gen('9'.repeat(25)))).toBe('9'.repeat(25));
    expect(parseLifecycleGeneration(gen('9'.repeat(26)))).toBeNull();
  });
});

describe('compareGenerations — "greatest name is live", made a single reader', () => {
  it('orders by magnitude, not lexicographically', () => {
    // The bug this exists to prevent: plain string compare puts a 20-digit
    // name BEFORE a 19-digit one, so the live generation reads as an old one
    // and the mirror ingests a stale file forever.
    expect(compareGenerations('9999999999999999999', '10000000000000000000')).toBeLessThan(0);
    expect('9999999999999999999' < '10000000000000000000').toBe(false);
  });

  it('orders equal-length names lexicographically, which for digits is numerically', () => {
    expect(compareGenerations('1755000000000000001', '1755000000000000002')).toBeLessThan(0);
    expect(compareGenerations('1755000000000000002', '1755000000000000001')).toBeGreaterThan(0);
    expect(compareGenerations(NS, NS)).toBe(0);
  });

  it('sorts a directory listing so the LAST element is the live generation', () => {
    const names = ['journal-1755000000000000003.ndjson', 'journal-999.ndjson',
      'journal-1755000000000000001.ndjson', 'errors', '.rotate.lock'];
    const gens = names.map(parseLifecycleGeneration).filter((g): g is string => g !== null);
    expect(gens.sort(compareGenerations)).toEqual(
      ['999', '1755000000000000001', '1755000000000000003']);
  });
});
