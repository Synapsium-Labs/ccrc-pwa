// The readiness word's single-definition guard (Overlord W1 readiness, plan `w1-readiness.md` Task 1, Step 2).
// Table 6.4a of the Overlord spec names the fourteen words the readiness decider answers, in the order it falls by (first
// match wins). `READINESS_WORDS` in `shared/overlord-readiness.ts` is that list in code, and the decider's rows follow it.
// This test reads the table's first column from the spec and checks it against `READINESS_WORDS`, in order and in both
// directions, so a word added to one and not the other, or two words swapped, reds here. It reads a `docs/` file, so it
// lives where `.github/ci/fast-plan.mjs#GUARD_TESTS` runs it on every fast pull request.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { READINESS_WORDS } from '../../../shared/overlord-readiness.js';
import { ccrcRoot } from './helpers.js';

const SPEC = path.join(ccrcRoot, 'docs/superpowers/specs/2026-11-09-overlord-design.md');
const START = '- **H20. Ready, or not holding.**';
const END = '*Table 6.4a. The readiness word.';

/** The lines from H20's bullet to Table 6.4a's caption, both found by their text. */
function table6_4a(): string {
  const text = readFileSync(SPEC, 'utf8');
  const at = text.indexOf(`\n${START}`);
  const start = at < 0 ? -1 : at + 1;
  const end = text.indexOf(END);
  expect(start, 'the H20 bullet is gone').toBeGreaterThan(-1);
  expect(end, 'the caption of Table 6.4a is gone').toBeGreaterThan(start);
  return text.slice(start, end);
}

/** The first column's backticked word of each body row, in order: a row is a line that opens with a pipe and a backticked
 *  word. The header (`| Word | When |`) and the separator carry no backtick, so they are not rows. */
const firstColumn = (slice: string): string[] =>
  slice.split('\n').map((l) => /^\|\s*`([^`]+)`\s*\|/.exec(l)?.[1] ?? null).filter((w): w is string => w !== null);

describe('Table 6.4a names the readiness words READINESS_WORDS holds (H20)', () => {
  it('CONTROL: the slice was found and is a table of more than a few rows', () => {
    const slice = table6_4a();
    expect(slice.length, 'the slice reads as empty').toBeGreaterThan(1000);
    expect(slice).toContain('| Word | When |');
    expect(firstColumn(slice).length, 'the table body reads as too short').toBeGreaterThan(5);
    expect(firstColumn('| Word | When |\n|---|---|\n| `a` | x |\n| not a row |\n| `b-c` | y |')).toEqual(['a', 'b-c']);
  });
  it('the words, in order, are READINESS_WORDS, in both directions', () => {
    const words = firstColumn(table6_4a());
    expect(words.filter((w) => !(READINESS_WORDS as readonly string[]).includes(w)), 'a table word the code lacks').toEqual([]);
    expect(READINESS_WORDS.filter((w) => !words.includes(w)), 'a code word the table lacks').toEqual([]);
    expect(words).toEqual([...READINESS_WORDS]);
  });
});
