import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
// The path to the ccd script is spelled in exactly ONE file in this tree and
// `single-definition.test.ts` scans for a second copy, so it is imported here
// rather than joined — the same reason `ownership.test.ts` states at its own
// import.
import { CCD } from './ccdWsHelpers.js';

/**
 * `_reg_get`'s header argues that widening it to a three-answer read is a
 * fleet-wide change, and the argument is a COUNT: how many call sites would
 * inherit the duty of deciding what to do with rc 2. A count is a claim about
 * the file, and this one has been wrong in four of the five review rounds that
 * touched it — 133 at C1, 135 once this branch and the #70 merge had added
 * sites, 133 when round 3 converted the two tick `.project` reads, 132 when
 * rounds 4 and 5 converted the three verb readers. Each move left the previous
 * figure standing somewhere in the same comment block, and round 4's gate found
 * four stale cardinals sitting ABOVE the corrected one, where a reader hits
 * them first.
 *
 * The header's instruction was "re-measure it". That is a request. This is the
 * mechanism: it reads the two numbers out of the sentence that states them and
 * compares each to the thing that sentence says it counted. `ccd-pool-ok.test.ts`
 * carries the identical pin for the `_pool_ok` header one function away, and
 * that pin is why the `_pool_ok` census never went stale through the same five
 * rounds.
 *
 * WHY TWO NUMBERS AND NOT ONE: the header's own cited commands are
 * `grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l` for
 * OCCURRENCES and the same filter piped to `grep -c` for LINES. They differ
 * whenever one line holds two calls (`cmd_start`'s id form did, until round 5
 * split it), and a pin that measured occurrences while the sentence claimed
 * lines would be green for the wrong reason — the exact defect the `_pool_ok`
 * pin booked against itself as M-1.
 */
describe('the `_reg_get` header states a census that stays honest', () => {
  it('both numbers the header claims match what its own cited commands count', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('THE FOLD `_reg_get` KEEPS');
    expect(from, 'the `_reg_get` census header could not be found').toBeGreaterThan(-1);
    const block = src.slice(from, from + 600);
    const claimed = block.match(/this file makes (\d+)\n?#? ?invocations across (\d+) non-comment lines/);
    expect(claimed,
      'the census sentence no longer states its two counts in the expected shape')
      .not.toBeNull();
    const statedCalls = Number(claimed![1]);
    const statedLines = Number(claimed![2]);

    // The classifier is the header's own: a WHOLE-LINE comment is not a call
    // site. It is exact for `ccd/ccd` today — no code line carries a trailing
    // comment quoting the pattern — and a future one would be counted as a
    // call, at which point this pin needs a tokenizer rather than a filter.
    const code = src.split('\n').filter((line) => !/^\s*#/.test(line));
    const calls = code.reduce((n, line) => n + (line.match(/_reg_get "/g) ?? []).length, 0);
    const lines = code.filter((line) => line.includes('_reg_get "')).length;

    expect(calls,
      `ccd/ccd now makes ${calls} \`_reg_get "\` calls, but the census still claims `
      + `${statedCalls}. Re-measure the sentence, do not re-measure this test.`)
      .toBe(statedCalls);
    expect(lines,
      `those calls sit on ${lines} non-comment lines, but the census still claims `
      + `${statedLines}.`).toBe(statedLines);
  });

  it('and no OTHER cardinal in that block restates it — one number, one place', () => {
    // The round-4 gate's finding was not that the number was wrong; it was
    // that the block gave two different answers fifty lines apart, and the
    // stale ones came first. Every argument in the block now says "every call
    // site" instead of carrying its own copy of the figure, so the only digits
    // left inside it are the census itself and the dated history of what the
    // number USED to be. A new bare cardinal here is a new place to go stale.
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('`-f` FIRST, FOR THE SAME REASON `_reg_read` HAS ONE');
    const to = src.indexOf('HOW MANY C1 CONVERTED');
    expect(from, 'the hang-surface header could not be found').toBeGreaterThan(-1);
    expect(to, 'the end of the census block could not be found').toBeGreaterThan(from);
    const block = src.slice(from, to);
    const history = block.indexOf('It has moved four times in five rounds');
    expect(history, 'the dated history clause could not be found').toBeGreaterThan(-1);
    const outsideHistory = block.slice(0, history)
      + block.slice(block.indexOf('\n', block.indexOf('converted the three verb readers')));
    const cardinals = outsideHistory.match(/\b1[0-9]{2}\b/g) ?? [];
    expect(cardinals,
      `the census block restates a three-digit figure outside the one sentence that owns it `
      + `(${cardinals.join(', ')}) — say "every call site" and let the pin above hold the number`)
      .toEqual(['132', '108']);
  });
});
