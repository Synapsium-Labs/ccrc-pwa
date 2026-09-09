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
const CENSUS_RE = /this file makes (\d+)\n?#? ?invocations across (\d+) non-comment lines/;

/** The two numbers the census sentence states, parsed once. Both cases derive
 *  from this — an earlier cut hard-coded `['132', '108']` in the second case,
 *  so the SANCTIONED re-measure (add a call site, correct the sentence — which
 *  is exactly what the first case's failure message orders) left the first case
 *  green and redded the second with advice that would have deleted the census.
 *  A pin that punishes its own remedy is not a pin. (#69 review round 5, its
 *  own refute pass.) */
function statedCensus(src: string): { calls: number; lines: number } {
  const m = src.match(CENSUS_RE);
  if (!m) throw new Error('the census sentence no longer states its two counts in the expected shape');
  return { calls: Number(m[1]), lines: Number(m[2]) };
}

describe('the `_reg_get` header states a census that stays honest', () => {
  it('both numbers the header claims match what its own cited commands count', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src.indexOf('THE FOLD `_reg_get` KEEPS'),
      'the `_reg_get` census header could not be found').toBeGreaterThan(-1);
    const { calls: statedCalls, lines: statedLines } = statedCensus(src);

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
    const history = block.indexOf('It has moved five times now');
    expect(history, 'the dated history clause could not be found').toBeGreaterThan(-1);
    const outsideHistory = block.slice(0, history)
      + block.slice(block.indexOf('\n', block.indexOf('Every earlier move left a stale cardinal')));
    // WHAT THIS REFUSES, STATED NARROWLY ENOUGH TO BE TRUE. An earlier cut
    // matched `/\b1[0-9]{2}\b/` and its failure message claimed to refuse "any
    // new three-digit cardinal" — measured, a restated 98 or 260 sailed
    // straight through. Widening to every 2–4 digit token is no better: the
    // block legitimately contains `chmod 000` and "~20 supervisors", which are
    // not counts of anything this sentence owns.
    //
    // The defect is specifically a RESTATEMENT of this census, and every time
    // it has happened the stale copy sat within a handful of the live figure
    // (133/134/135 against 132; 109/110 against 108). So the band is what is
    // refused, and it is what the failure message says. A number far from the
    // census is a different claim and this pin does not police it.
    const { calls, lines } = statedCensus(src);
    const near = (n: number): boolean =>
      Math.abs(n - calls) <= 25 || Math.abs(n - lines) <= 25;
    const cardinals = (outsideHistory.match(/(?:D-|#|ccd:)?\d{2,4}\b/g) ?? [])
      .filter((t) => !/^(?:D-|#|ccd:)/.test(t))
      .filter((t) => near(Number(t)));
    expect(cardinals,
      `the census block restates a figure within 25 of the one sentence that owns it `
      + `(${cardinals.join(', ')}) — say "every call site" and let the pin above hold the number`)
      .toEqual([String(calls), String(lines)]);
  });
});

/**
 * The SAME shape for the other census this branch keeps falsifying. `cmd_prefer`
 * carries a sentence counting the measured `.project` readers, and round 5
 * converted a third one at `cmd_start` in the very commit whose message books
 * "an enumeration falsified by the entry added directly below it" — leaving that
 * sentence one function away asserting two verbs where there are now three.
 * A comment saying "re-measure this" is how that happens; a case is how it stops.
 */
describe('the `_reg_read "$id" project` census one function over stays honest too', () => {
  it('both numbers `cmd_prefer` claims match its own cited command, filtered and bare', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('THE CENSUS, SPELLED SO IT DOES NOT COUNT ITSELF');
    expect(from, "cmd_prefer's `.project` census header could not be found").toBeGreaterThan(-1);
    const block = src.slice(from, from + 700);
    const m = block.match(/answers (\w+) — the two tick reads and the three verbs[\s\S]*?bare grep answers (\w+)/);
    expect(m, 'the census sentence no longer states its counts in the expected shape').not.toBeNull();

    // The sentence spells its numbers as WORDS, which is how it has always read
    // and is why no scanner ever caught it going stale.
    const WORDS: Record<string, number> = {
      two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    const statedFiltered = WORDS[m![1]!.toLowerCase()];
    const statedBare = WORDS[m![2]!.toLowerCase()];
    expect(statedFiltered, `unrecognised number word "${m![1]}"`).toBeDefined();
    expect(statedBare, `unrecognised number word "${m![2]}"`).toBeDefined();

    const lines = src.split('\n');
    const bare = lines.filter((l) => l.includes('_reg_read "$id" project')).length;
    const filtered = lines.filter(
      (l) => l.includes('_reg_read "$id" project') && !/^\s*#/.test(l)).length;

    expect(filtered,
      `the filtered census answers ${filtered} now, but cmd_prefer's sentence still claims `
      + `${statedFiltered}. A converted reader moves this number; correct the sentence.`)
      .toBe(statedFiltered);
    expect(bare,
      `the bare grep answers ${bare} now, but the sentence still claims ${statedBare}.`)
      .toBe(statedBare);
    // AND THE TRAP THE SENTENCE DESCRIBES IS REAL. `bare - filtered` is the
    // comment-line count BY CONSTRUCTION, so asserting it against itself — which
    // is what the first cut of this line literally did, `.toBe(bare - filtered)`
    // — cannot red on any tree, and asserting it against the two stated numbers
    // is no better once the two above pin each of them to reality. What is NOT
    // derivable is that anything quotes the pattern at all: strip the citation
    // out of `cmd_prefer`'s comment and the two assertions above simply track
    // the new pair while the prose goes on explaining a self-count that no
    // longer happens. (#69 review round 5 merge gate — a tautology, in the
    // commit whose subject is assertions that pass for the wrong reason.)
    expect(bare,
      'nothing quotes the pattern any more, so the sentence above is explaining a '
      + 'self-counting trap that no longer exists — say the bare and filtered counts are equal, '
      + 'or restore the citation')
      .toBeGreaterThan(filtered);
  });
});
