// Single-definition scanners, one area of the guard (see ./helpers.ts for the doctrine and the shared walkers).
//
// The secret tail's linear strip (decision model B, departure `secret-tail-linear-strip`; review 2418 F7, the coordinator's
// ruling). `shared/ledgers.ts#secretTailOf` sets a value's trailing `=` aside with a loop: the old `/=+$/` backtracks
// quadratically over a long run of `=` (CodeQL js/polynomial-redos), and both answer alike on every input, so no behaviour
// case can tell them apart. This scan is the guard: it goes red if an end-anchored run of `=` returns to the file's code.
// Code lines only (`stallCodeText`), so a comment naming the old pattern is not a hit.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ccrcRoot, stallCodeText } from './helpers.js';

/** An end-anchored run of `=` in a regular expression: `=+$` or `=*$`, as a literal or a `RegExp` string. */
const TRAILING_EQUALS_RUN = /=[+*]\$/;
const hits = (text: string): string[] => stallCodeText(text).split('\n').filter((l) => TRAILING_EQUALS_RUN.test(l));

describe('the secret tail sets a trailing = aside without a backtracking pattern (review 2418 F7)', () => {
  it('CONTROL: the scan sees the old pattern, in either quantifier, and passes over a comment and the loop', () => {
    expect(hits("  if (utf8Bytes(value.replace(/=+$/, '')) < SECRET_TAIL_MIN) return '';")).toHaveLength(1);
    expect(hits("  const t = value.replace(new RegExp('=*$'), '');")).toHaveLength(1);
    expect(hits('  // A loop, not `/=+$/`: that pattern backtracks.')).toEqual([]);
    expect(hits('  while (end > 0 && value.charCodeAt(end - 1) === 0x3d) end--;')).toEqual([]);
  });

  it('shared/ledgers.ts has no end-anchored run of = in its code', () => {
    expect(hits(readFileSync(path.join(ccrcRoot, 'shared', 'ledgers.ts'), 'utf8'))).toEqual([]);
  });
});
