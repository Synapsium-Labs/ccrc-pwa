// READER_MIN_COLS exists TWICE by construction — `shared/api.ts` for the server
// and a bash global in `ccd/ccd` — because bash cannot import TypeScript. This
// file is the mechanism that keeps the two one number, exactly as
// `auto-continue-armed.test.ts` keeps the auto-continue regex one literal
// (spec §6.3). It also re-asserts the derivation's own bound, so a constant
// lowered under the widest measured carrier reds here rather than shipping.
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

describe('READER_MIN_COLS is one number in two languages', () => {
  it('ccd/ccd assigns exactly what shared/api.ts exports', () => {
    expect(bashCopy()).toBe(READER_MIN_COLS);
  });

  it('is the derived value, and both copies carry the derivation', () => {
    // 120, derived in the plan's Task 1: the widest measured carrier needs 69
    // columns and the widest status segment is 37, so 120 leaves room for one
    // more segment (69 + 37 = 106) while staying under a 171-column desktop.
    // A HARDCODED literal on purpose — this repo's mutation-table control.
    expect(READER_MIN_COLS).toBe(120);
    expect(readFileSync(API, 'utf8'), 'shared/api.ts must carry the derivation, not just the number')
      .toContain('wrap-ansi');
    expect(readFileSync(CCD, 'utf8'), 'ccd/ccd must carry the derivation, not just the number')
      .toContain('wrap-ansi');
  });

  it('stands a phone down and leaves a desktop measurable — the two-sided constraint', () => {
    // The constant's JOB, stated as a test rather than as prose: a 43-column
    // phone attach must be below it (the readers stand down) and a 171-column
    // desktop above it (automation keeps running). F12's census and §6.3.
    expect(43).toBeLessThan(READER_MIN_COLS);
    expect(171).toBeGreaterThanOrEqual(READER_MIN_COLS);
  });
});
