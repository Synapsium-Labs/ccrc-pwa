// READER_MIN_COLS exists TWICE by construction — `shared/api.ts` for the server
// and a bash global in `ccd/ccd` — because bash cannot import TypeScript. This
// file is the mechanism that keeps the two one number, exactly as
// `auto-continue-armed.test.ts` keeps the auto-continue regex one literal
// (spec §6.3). It asserts the derivation's own bound (69 + 37, as LITERALS,
// D-2779 fix round 1) separately from the `toBe(120)` mutation-table pin — a
// constant lowered under the widest measured carrier reds the bound even
// though a raise would only trip the pin — and it binds "carries the
// derivation" to the lines immediately above each definition, not to a
// file-wide substring search a wrong implementation could satisfy by luck.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD } from './ccdWsHelpers.js';
import { READER_MIN_COLS } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = path.resolve(here, '..', '..', 'shared', 'api.ts');

/** The bash copy, read off its own assignment line. A `READER_MIN_COLS=` that
 *  is interpolated, conditional, or written twice is a drift shape this cannot
 *  see — so the count is asserted, not just the first hit. */
const bashCopy = (): number => {
  const hits = readFileSync(CCD, 'utf8').split('\n')
    .map((l) => /^READER_MIN_COLS=(\d+)\b/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);
  expect(hits.length, 'ccd/ccd must assign READER_MIN_COLS exactly once, at column 0').toBe(1);
  return Number(hits[0]![1]);
};

/** The lines immediately above a definition line (inclusive of that line
 *  itself), where ITS OWN derivation comment must live. Binds "carries the
 *  derivation" to this site rather than to the file as a whole — a wrong
 *  implementation that deletes the comment above the definition but leaves
 *  the tool name sitting in some unrelated line far away must not pass. */
const WINDOW_BEFORE = 35;
const defWindow = (text: string, matcher: RegExp): string => {
  const ls = text.split('\n');
  const idx = ls.findIndex((l) => matcher.test(l));
  expect(idx, `no line in this file matches ${matcher}`).toBeGreaterThanOrEqual(0);
  return ls.slice(Math.max(0, idx - WINDOW_BEFORE), idx + 1).join('\n');
};

describe('READER_MIN_COLS is one number in two languages', () => {
  it('ccd/ccd assigns exactly what shared/api.ts exports', () => {
    expect(bashCopy()).toBe(READER_MIN_COLS);
  });

  it('is the derived value, and stays at or above the derivation\'s own bound', () => {
    // 120, derived in the plan's Task 1: the widest measured carrier needs 69
    // columns and the widest status segment is 37, so 120 leaves room for one
    // more segment (69 + 37 = 106) while staying under a 171-column desktop.
    // `toBe(120)` is an EQUALITY pin, not a bound — it reds on a raise just as
    // hard as a lower, and would red exactly the same way on 110, which is
    // still ABOVE the derived floor. So it stays as this repo's
    // mutation-table control, but the actual bound is asserted separately,
    // with both derivation numbers written as LITERALS (69, 37) rather than
    // computed from anything the code under test produces — a bound derived
    // from its own subject can never red.
    expect(READER_MIN_COLS).toBe(120);
    expect(READER_MIN_COLS).toBeGreaterThanOrEqual(69 + 37);
  });

  it('each definition carries its own derivation nearby, not merely somewhere in the file', () => {
    // A file-wide `toContain('wrap-ansi')` binds no subject: over a 6900+/
    // 18000+ line file, a wrong implementation that deletes the derivation
    // comment above the definition still passes as long as the token
    // "wrap-ansi" appears ANYWHERE else — including in some unrelated later
    // comment. Take the window of lines immediately above each definition
    // instead, and require the derivation's own numbers there too, not just
    // the tool name — so the check is bound to THIS site.
    const apiWindow = defWindow(readFileSync(API, 'utf8'), /^export const READER_MIN_COLS\b/);
    for (const needle of ['wrap-ansi', '69', '37', '120']) {
      expect(apiWindow, `shared/api.ts: the ${WINDOW_BEFORE} lines above the READER_MIN_COLS export must contain "${needle}"`)
        .toContain(needle);
    }

    const ccdWindow = defWindow(readFileSync(CCD, 'utf8'), /^READER_MIN_COLS=\d+\b/);
    for (const needle of ['wrap-ansi', '69', '37', '120']) {
      expect(ccdWindow, `ccd/ccd: the ${WINDOW_BEFORE} lines above READER_MIN_COLS= must contain "${needle}"`)
        .toContain(needle);
    }
  });

  it('stands a phone down and leaves a desktop measurable — the two-sided constraint', () => {
    // The constant's JOB, stated as a test rather than as prose: a 43-column
    // phone attach must be below it (the readers stand down) and a 171-column
    // desktop above it (automation keeps running). F12's census and §6.3.
    expect(43).toBeLessThan(READER_MIN_COLS);
    expect(171).toBeGreaterThanOrEqual(READER_MIN_COLS);
  });
});
