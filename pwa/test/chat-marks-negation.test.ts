// A status label must not say the opposite of its sentence (chat reading Task C, D-8061; fix rounds 1 and 2, reviews
// 1584 F1 and 1592; departure c-s3-negation, which amends spec 2026-11-06 §3.3's S3). Once Task C paints
// `data-status`, S3's label on "No tests failed." is a red label on a good outcome. So S3 withholds the label, and
// keeps the mark, when:
//   - a negator (`STATUS_NEGATORS`: no, none, not, never, nothing, 0, zero) stands before the status word in its
//     clause, before the subject or between the two. A word is read whole, joined by `.`, `-` or `/` (`v0.0.1003`,
//     `no-op`), and a recognised name's own words are not negators (`run 0`). A joined zero count is one ("0/12",
//     "0-0", "0.0", "No/none": review 1601 F1, desktop-polish Task C14);
//   - right after the status word, behind a colon, its count is zero: `0`, `zero` or `none`, followed by the clause's
//     end, "of N" or "out of N" (N a number or a number word), "(of N)", "/N" with or without spaces, `%` or a dash
//     clause ("passed: 0 of 12", "failed: 0 — all good": review 1601 F2);
//   - the status word's sentence ends in "?".
// A clause ends at `.`, `!`, `?`, `;`, `,` or `:` followed by a space or the end, or at a line break; a sentence at
// a run of `.`, `!` or `?` (any closers after it) followed by a space or the end, at a `)` or `]` followed by a space and
// a capital, at a spaced dash, or at a line break, and an end inside an aside that opens after the label is the aside's
// (review 1592 F5, desktop-polish Task C14). Through the plugin, the text of the same block
// before and after a text node counts too, bounded to the clause and the sentence ("**No** tests failed.").
// `chat-marks.test.ts` (Task L's claim) keeps the S3 table; this file holds only the withholding.
import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkAlerts } from '../src/lib/remarkAlerts';
import { remarkChatMarks } from '../src/lib/remarkChatMarks';
import { LabelScan, MARK_ATTR, STATUS_NEGATORS, markRuns, type Mark, type MarkRun } from '../src/lib/chatMarks';

const statusesOf = (text: string): { text: string; tone: string }[] =>
  markRuns(text).flatMap((r) => (r.kind === 'status' ? [{ text: r.text, tone: r.tone }] : []));
const statusRuns = (runs: readonly MarkRun[]): { text: string; tone: string }[] =>
  runs.flatMap((r) => (r.kind === 'status' ? [{ text: r.text, tone: r.tone }] : []));
const marksOf = (text: string): Mark[] => markRuns(text).flatMap((r) => (r.kind === 'mark' ? [r.mark] : []));

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, unknown> };
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkAlerts).use(remarkChatMarks);

/** Every status label chat's plugin writes over `src` (S1, S2 or S3), as its text and tone, in document order. */
function pluginStatuses(src: string): { text: string; tone: string }[] {
  return treeStatuses(processor.runSync(processor.parse(src)) as unknown as MdNode);
}

/** Every status label in a tree the plugin has run over, as `pluginStatuses` reads it. */
function treeStatuses(tree: MdNode): { text: string; tone: string }[] {
  const out: { text: string; tone: string }[] = [];
  const stack: MdNode[] = [tree];
  while (stack.length > 0) {
    const n = stack.pop()!;
    const tone = n.data?.hProperties?.[MARK_ATTR.status];
    if (typeof tone === 'string') {
      const text = n.value ?? (n.children ?? []).map((c) => c.value ?? '').join('');
      out.push({ text, tone });
    }
    const c = n.children ?? [];
    for (let i = c.length - 1; i >= 0; i -= 1) stack.push(c[i]!);
  }
  return out;
}

describe('S3 withholds a label a negator turns around (c-s3-negation)', () => {
  it('the negators are the ruling\'s seven words', () => {
    expect([...STATUS_NEGATORS]).toEqual(['no', 'none', 'not', 'never', 'nothing', '0', 'zero']);
  });

  it.each<[string, string]>([
    // The review's inputs.
    ['a negator before the subject', 'No tests failed.'],
    ['none of the subject', 'none of the checks failed'],
    ['a count of zero', '0 tests failed'],
    ['a count of zero after a colon', 'tests passed: 0 of 12'],
    // Each other negator word. Between subject and word one is already no label: S3 allows only a linker there.
    ['zero, as a word', 'Zero tests failed.'],
    ['never, before the subject', 'Never has the build failed.'],
    ['not, before the subject', 'Not all checks passed.'],
    ['nothing, before the subject', 'Nothing in review is blocked.'],
    ['none, after the colon', 'checks failed: none'],
  ])('%s: no label', (_name, text) => {
    expect(statusesOf(text)).toEqual([]);
  });

  it('a negator governs its own clause only: after a comma the next label stands', () => {
    expect(statusesOf('0 tests failed, 12 tests passed')).toEqual([{ text: 'passed', tone: 'ok' }]);
    expect(statusesOf('No, CI passed.')).toEqual([{ text: 'passed', tone: 'ok' }]);
  });

  it('a negator in an earlier sentence does not reach the next one', () => {
    expect(statusesOf('No flakes. CI green.')).toEqual([{ text: 'green', tone: 'ok' }]);
  });

  it('a 0 inside a larger number is not a negator', () => {
    expect(statusesOf('10 tests failed')).toEqual([{ text: 'failed', tone: 'fail' }]);
    expect(statusesOf('tests passed: 10 of 12')).toEqual([{ text: 'passed', tone: 'ok' }]);
  });

  it('the mark stays: a PR is still a PR', () => {
    expect(marksOf('No #651 merged yet.')).toEqual([{ kind: 'pr', id: '651', text: '#651' }]);
    expect(statusesOf('No #651 merged yet.')).toEqual([]);
  });
});

describe('S3 withholds a label in a question (c-s3-negation)', () => {
  it('a sentence ending in "?" gives no label, and keeps its mark', () => {
    expect(statusesOf('Has #651 merged?')).toEqual([]);
    expect(marksOf('Has #651 merged?')).toEqual([{ kind: 'pr', id: '651', text: '#651' }]);
    expect(statusesOf('Is CI green now?')).toEqual([]);
  });

  it('the question governs its own sentence only', () => {
    expect(statusesOf('Is CI green? Yes: #651 merged.')).toEqual([{ text: 'merged', tone: 'merged' }]);
    expect(statusesOf('#651 merged. Is it out?')).toEqual([{ text: 'merged', tone: 'merged' }]);
  });
});

describe('a sentence end reads its closers (review 1592 F5; desktop-polish Task C14, D-8110)', () => {
  it.each<[string, string, { text: string; tone: string }[]]>([
    // A "?" glued to a closer ends a question.
    ['a question inside parentheses', '(Has #651 merged?)', []],
    ['a "?" before a closing parenthesis', 'Has #651 merged?)', []],
    ['a "?" before a closing quote', 'Has #651 merged?"', []],
    ['a "?" before a curly single closer', 'Has #651 merged?’', []],
    ['a "?" before a curly double closer', 'Has #651 merged?”', []],
    ['a "?!" run', 'Is #651 merged?!', []],
    ['a "!?" run', 'Is #651 merged!?', []],
    // A closer before a space and a capital ends the sentence, so the next sentence's "?" does not reach back.
    ['a parenthesis around the label, then a question', '(#651 merged) Is it out?', [{ text: 'merged', tone: 'merged' }]],
    ['a full stop and a parenthesis, then a question', '#651 merged.) Is it out?', [{ text: 'merged', tone: 'merged' }]],
    ['a spaced dash, then a question', '#651 merged — is it out?', [{ text: 'merged', tone: 'merged' }]],
    ['a quoted aside, then a question', 'CI green ("done") Ready to land?', [{ text: 'green', tone: 'ok' }]],
    // A "?" inside a parenthesis that opens after the label is not the label's sentence end.
    ['a question in an aside, then a full stop', '#651 merged (really?) yes.', [{ text: 'merged', tone: 'merged' }]],
    ['a question in an aside, then more of the sentence', '#651 merged (why?) and shipped.', [{ text: 'merged', tone: 'merged' }]],
    // Guards around those: an aside with a lower-case word after it does not end the sentence.
    ['an aside inside a question', 'Is CI green (on main) today?', []],
    ['an aside at the end of a question', 'Is CI green (see the log)?', []],
    ['a full stop inside an aside ends nothing outside it', 'Is CI green (see run 3.) on main?', []],
    ['an unclosed aside does not hide its question', 'CI green (see the log? on main.', []],
    ['an unclosed emoticon does not hide its question', 'Is CI green :( or not?', []],
    ['an unspaced dash ends nothing', 'Is CI green—or red?', []],
    ['a line break ends an aside too', 'CI green (see the log\nthen) is it out?', [{ text: 'green', tone: 'ok' }]],
    // The cost of the spaced dash, named in Task C14's note: a question split by one reads its first half alone.
    ['a spaced dash splits a question as well', 'Is CI green — or red?', [{ text: 'green', tone: 'ok' }]],
    // A closer needs a space before the capital (Task C16, review 1689 A3): glued to it, the sentence goes on.
    ['a closer glued to a capital ends nothing', '#651 merged (x)Is it out?', []],
    ['a closer, a space and a capital still ends it', '#651 merged (x) Is it out?', [{ text: 'merged', tone: 'merged' }]],
    // The cost of the closer rule, named in the heuristic's comment (review 1689 A7): a final aside before a capital
    // word ends the sentence, so its own "?" is not reached.
    ['an aside before a capital word ends the question early', 'Is CI green (on main) OK?', [{ text: 'green', tone: 'ok' }]],
  ])('%s', (_name, text, statuses) => {
    expect(statusesOf(text)).toEqual(statuses);
  });
});

describe('the after-colon arm reads a count of zero only (review 1592 F2)', () => {
  it.each<[string]>([
    ['tests passed: 0 of 12'],
    ['tests passed: 0/12'],
    ['tests passed: zero'],
    ['checks failed: none'],
    ['tests failed: 0'],
    ['Tests passed: None.'],
  ])('%s: no label', (text) => {
    expect(statusesOf(text)).toEqual([]);
  });

  it.each<[string, { text: string; tone: string }]>([
    ['build failed: no space left on device', { text: 'failed', tone: 'fail' }],
    ['CI failed: not found in cache', { text: 'failed', tone: 'fail' }],
    ['#651 merged: nothing left to do', { text: 'merged', tone: 'merged' }],
    ['CI green: no failures', { text: 'green', tone: 'ok' }],
    ['tests passed: none skipped', { text: 'passed', tone: 'ok' }],
    ['tests passed: 0.5 of the time', { text: 'passed', tone: 'ok' }],
  ])('%s keeps its label', (text, status) => {
    expect(statusesOf(text)).toEqual([status]);
  });
});

describe('a zero count joined or spaced carries no label (review 1601 F1, F2; desktop-polish Task C14, D-8110)', () => {
  it.each<[string]>([
    // F1: a joined token that is a zero count, `0`, `zero` or `none` then `/` and a number, or zero words joined.
    ['0/12 tests passed'],
    ['0/3 checks passed'],
    ['Zero/12 tests passed'],
    ['0-0 tests passed'],
    ['0.0 tests failed'],
    ['No/none tests failed'],
    // F2: the follow-set behind the colon.
    ['tests passed: 0 / 12'],
    ['tests passed: 0 out of 12'],
    ['tests passed: 0%'],
    ['tests passed: 0 of twelve'],
    // The plurals `tens`, `hundreds` and `thousands` are counts too (Task C16 fix round 1, review 1722 F5; Task C18,
    // review 1723 F2): A4's word end must not cut them. Other plurals ("0 of dozens", "0 of millions") are not number
    // words here, and keep a label as they did on main.
    ['tests failed: 0 of hundreds of cases'],
    ['CI passed: 0 of thousands'],
    ['tests failed: 0 of tens of thousands'],
    ['CI failed: 0 of tens of cases'],
    ['tests passed: 0 (of 12)'],
    ['tests passed: 0 (out of 12)'],
    ['tests failed: 0 — all good'],
  ])('%s: no label', (text) => {
    expect(statusesOf(text)).toEqual([]);
  });

  it.each<[string, { text: string; tone: string }]>([
    ['0.5% of tests failed', { text: 'failed', tone: 'fail' }],
    ['v0.0.1003 is live and CI green', { text: 'green', tone: 'ok' }],
    ['docs/no.md merged', { text: 'merged', tone: 'merged' }],
    ['On Node 0.10 tests passed', { text: 'passed', tone: 'ok' }],
    ['0.0.1 tests passed', { text: 'passed', tone: 'ok' }],
    ['the no-op build passed', { text: 'passed', tone: 'ok' }],
    // Known gap, outside item 1: "not-yet" still keeps a green label (review 1689 F5).
    ['not-yet CI green', { text: 'green', tone: 'ok' }],
    ['tests passed: 0.5% of the time', { text: 'passed', tone: 'ok' }],
    ['tests passed: none skipped', { text: 'passed', tone: 'ok' }],
    ['tests passed: 0 offline', { text: 'passed', tone: 'ok' }],
    // A number word ends at a word end (Task C16, review 1689 A4): "ten" is not the start of "tenants".
    ['tests passed: 0 of tenants', { text: 'passed', tone: 'ok' }],
    ['tests failed: none of tenants', { text: 'failed', tone: 'fail' }],
    ['tests failed: 0 of tensions', { text: 'failed', tone: 'fail' }],
    // A combining mark continues a word, as in NEGATION_TOKEN (Task C18, review 1723 N6): "hundreds" and U+0301 is not
    // the number word.
    ['tests failed: 0 of hundreds\u0301', { text: 'failed', tone: 'fail' }],
  ])('%s keeps its label', (text, status) => {
    expect(statusesOf(text)).toEqual([status]);
  });
});

describe('a negator is a whole word, joined by . - or / (review 1592 F3)', () => {
  it.each<[string, { text: string; tone: string }]>([
    ['v0.0.1003 is live and CI green', { text: 'green', tone: 'ok' }],
    ['On Node 0.10 tests passed', { text: 'passed', tone: 'ok' }],
    ['the no-op build passed', { text: 'passed', tone: 'ok' }],
    ['0.5% of tests failed', { text: 'failed', tone: 'fail' }],
    ['docs/no.md merged', { text: 'merged', tone: 'merged' }],
    ['run 0 accepted', { text: 'accepted', tone: 'ok' }],
    ['#0 merged', { text: 'merged', tone: 'merged' }],
  ])('%s keeps its label', (text, status) => {
    expect(statusesOf(text)).toEqual([status]);
  });
});

describe('the clause and sentence boundaries, one row per guard (review 1592 F7)', () => {
  it.each<[string, string, { text: string; tone: string }[]]>([
    ['a clause ends at ":"', 'No: CI passed.', [{ text: 'passed', tone: 'ok' }]],
    ['a clause ends at ";"', 'No flakes; CI green.', [{ text: 'green', tone: 'ok' }]],
    ['a clause ends at "!"', 'No! CI passed.', [{ text: 'passed', tone: 'ok' }]],
    ['a clause ends at a line break', 'No flakes\nCI green.', [{ text: 'green', tone: 'ok' }]],
    ['a "." with no space after it ends no clause', 'No .env change turned CI red.', []],
    ['a sentence ends at a line break', 'CI green\nIs it out?', [{ text: 'green', tone: 'ok' }]],
    ['a sentence ends at "!"', 'CI green! Is it out?', [{ text: 'green', tone: 'ok' }]],
    ['a "." with no space after it ends no sentence', 'Is CI green on docs/a.md?', []],
    ['a "?" with no space after it ends no sentence', 'CI green on a?b today.', [{ text: 'green', tone: 'ok' }]],
    ['the count after the colon is a whole word', 'tests passed: 0x of 12', [{ text: 'passed', tone: 'ok' }]],
    ['(h) spaces may stand before the clause end after a zero', 'tests failed: 0 .', []],
    // The cost of the zero-count rule, named in the heuristic's comment (review 1689 A7): a joined token of zeros is a
    // zero count wherever it stands, an address included.
    ['an all-zero dotted token negates', 'Bound to 0.0.0.0 and CI green', []],
  ])('%s', (_name, text, statuses) => {
    expect(statusesOf(text)).toEqual(statuses);
  });
});

describe('labels that keep their colour (positives)', () => {
  it.each<[string, string, { text: string; tone: string }]>([
    ['a count above zero', '3 tests failed', { text: 'failed', tone: 'fail' }],
    ['the build failed', 'the build failed', { text: 'failed', tone: 'fail' }],
    ['a name and its word', '#651 merged', { text: 'merged', tone: 'merged' }],
    ['a full stop ends it', 'CI green.', { text: 'green', tone: 'ok' }],
    ['a "?" with a word straight after it ends no sentence', 'run 1527 is blocked on docs/a.md?x', { text: 'blocked', tone: 'wait' }],
    ['a word that merely contains a negator', 'Notably the build failed.', { text: 'failed', tone: 'fail' }],
    ['a negator-like word fused to another', 'Nonetheless tests passed.', { text: 'passed', tone: 'ok' }],
  ])('%s keeps its label', (_name, text, status) => {
    expect(statusesOf(text)).toEqual([status]);
  });
});

describe('the check is linear in the text (review 1592 F1)', () => {
  // Round 1 re-read the prefix for every label: about 2 s and 3 s for these on the review's box, against about 3 ms
  // for a single pass. The bound is generous so load cannot flake it.
  const BOUND_MS = 400;
  const repeat = (unit: string, length: number): string => unit.repeat(Math.ceil(length / unit.length));

  it.each<[string, string, number]>([
    ['"tests passed " to 100k characters', 'tests passed ', 100_000],
    ['"#1 merged " to 100k characters', '#1 merged ', 100_000],
  ])('%s, every label kept, well within the bound', (_name, unit, length) => {
    const text = repeat(unit, length);
    const t0 = performance.now();
    const statuses = statusesOf(text);
    const ms = performance.now() - t0;
    expect(statuses.length).toBe(Math.ceil(length / unit.length));
    expect(ms).toBeLessThan(BOUND_MS);
  });

  it('through the plugin, one clause split into many text nodes is one pass too', () => {
    const src = repeat('CI green `x` ', 100_000);
    // The parse is outside the timed region (review 1601 F6; desktop-polish Task C14): the plugins alone take about
    // 6 to 21 ms here, and a scan per text node over its whole clause took about 2.7 s, so the bound sits far from both.
    const tree = processor.parse(src);
    const t0 = performance.now();
    const ran = processor.runSync(tree) as unknown as MdNode;
    const ms = performance.now() - t0;
    expect(treeStatuses(ran).length).toBe(Math.ceil(100_000 / 'CI green `x` '.length));
    expect(ms).toBeLessThan(BOUND_MS);
  });

  it('the check scales linearly: four times the text costs well under eight times the time (review 1601 F4 i)', () => {
    // Many labels with one "?" at the very end: every label asks where its sentence ends. A quadratic check costs about
    // sixteen times as much at 200k as at 50k; a linear one about four. The fastest of three runs each, so a pause
    // for garbage collection does not count, and the 50k run is bounded first so a quadratic one fails fast.
    // Measured on this box (Task C16, review 1689 A9; three repeats of the two sizes, each the fastest of three):
    // 3 to 6 ms at 50k, about 13 ms at 200k, a ratio of 2.1 to 4.1. The 50k run is dominated by fixed overhead (warm-up
    // and the first allocations), which is why the ratio is a loose guard and sits under 8; the absolute bound is what
    // catches a quadratic mutant (round 1 of the check took seconds, review 1592 F1).
    const fastest = (length: number): number => {
      const text = `${repeat('CI green ', length)}?`;
      let best = Infinity;
      for (let k = 0; k < 3; k += 1) {
        const t0 = performance.now();
        expect(statusesOf(text)).toEqual([]);
        best = Math.min(best, performance.now() - t0);
        expect(best).toBeLessThan(BOUND_MS);
      }
      return best;
    };
    const small = fastest(50_000);
    const large = fastest(200_000);
    expect(large / Math.max(small, 1)).toBeLessThan(8);
  });

  // Review 1601 F4 (g): each reset in `restart()` has a row. Names are registered in order (as the plugin and
  // `markRuns` register them); the labels are asked out of order through the exported scan.
  it.each<[string, string, ({ name: [number, number] } | { label: [number, number] })[], boolean[]]>([
    ['a negator from a later clause does not stay (negatorAt)', 'CI green. No tests failed.', [
      { label: [19, 25] }, { label: [3, 8] },
    ], [true, false]],
    ['the clause starts again from the text\'s start (clauseFrom, tokens, pending)', 'No tests failed. CI green.', [
      { label: [20, 25] }, { label: [9, 15] },
    ], [false, true]],
    ['the names are walked again from the first (skip)', 'run 0 accepted. CI green, run 1 failed.', [
      { name: [0, 5] }, { name: [26, 31] }, { label: [32, 38] }, { label: [6, 14] },
    ], [false, false]],
  ])('%s', (_name, text, steps, answers) => {
    const scan = new LabelScan(text);
    const got: boolean[] = [];
    for (const step of steps) {
      if ('name' in step) scan.name(...step.name);
      else got.push(scan.withheld(...step.label));
    }
    expect(got).toEqual(answers);
  });

  it('a block\'s scan gives the same answers when asked out of order', () => {
    const scan = new LabelScan('No tests failed. CI green.');
    expect(statusRuns(markRuns('CI green.', { scan, offset: 17 }))).toEqual([{ text: 'green', tone: 'ok' }]);
    expect(statusRuns(markRuns('No tests failed.', { scan, offset: 0 }))).toEqual([]);
  });
});

describe('a negator or "?" in another text node of the same block counts (review 1592 F4)', () => {
  it.each<[string]>([
    ['**No** tests failed.'],
    ['No *new* tests failed.'],
    ['`0` tests failed'],
    ['Has #651 merged into `main`?'],
    ['Is CI green (see `log`)?'],
  ])('%s: no label', (src) => {
    expect(pluginStatuses(src)).toEqual([]);
  });

  it.each<[string, { text: string; tone: string }]>([
    ['CI **green**.', { text: 'green', tone: 'ok' }],
    ['#651 merged in `main`.', { text: 'merged', tone: 'merged' }],
  ])('%s keeps its label', (src, status) => {
    expect(pluginStatuses(src)).toEqual([status]);
  });

  // Review 1601 F3 (desktop-polish Task C14, D-8110): code, link text and raw html are not prose for the "?" rule; a
  // name in link text is a name; a `<br>` is a line break.
  it.each<[string, string, { text: string; tone: string }[]]>([
    ['a "?" in inline code ends no sentence', 'CI green, adds the `?` operator.', [{ text: 'green', tone: 'ok' }]],
    ['a "?" in link text ends no sentence', 'CI green [why?](http://example.com/x)', [{ text: 'green', tone: 'ok' }]],
    ['a "?" in raw html ends no sentence', 'CI green <!-- really? --> today.', [{ text: 'green', tone: 'ok' }]],
    ['a name in link text is a name', '[run 0](http://example.com/x) and CI passed', [{ text: 'passed', tone: 'ok' }]],
    ['a name under emphasis in link text is a name', '[**run 0**](http://example.com/x) and CI passed', [{ text: 'passed', tone: 'ok' }]],
    ['a name in a reference link\'s text is a name', '[run 0][r] and CI passed\n\n[r]: http://example.com/x', [{ text: 'passed', tone: 'ok' }]],
    ['a <br> is a line break', 'No<br>CI green', [{ text: 'green', tone: 'ok' }]],
    ['a <br> in a table cell is a line break', '| a |\n|---|\n| No<br/>CI green |', [{ text: 'green', tone: 'ok' }]],
  ])('%s', (_name, src, statuses) => {
    expect(pluginStatuses(src)).toEqual(statuses);
  });

  // Review 1601 F4 (a) to (e): the plugin's guards, one row each.
  it.each<[string, string, { text: string; tone: string }[]]>([
    ['(a) a name in a later text node is placed at its offset', '**x** run 0 accepted', [{ text: 'accepted', tone: 'ok' }]],
    ['(a) a name\'s offset never excuses a negator before it', 'No **run 5 failed**', []],
    ['(b) a heading is one block', '# **No** tests failed', []],
    ['(c) a table body cell is one block', '| a |\n|---|\n| **No** tests failed |', []],
    ['(d) a hard break is a line break', 'No flakes\\\nCI green.', [{ text: 'green', tone: 'ok' }]],
    ['(e) link text is read for its negators', '[No](http://example.com/x) tests failed.', []],
  ])('%s', (_name, src, statuses) => {
    expect(pluginStatuses(src)).toEqual(statuses);
  });

  // Task C16, review 1689 A5 and A6. Masking hides letters' case no more: a capital in code or link text opens a
  // sentence as it does in plain prose. Text in code holds no sentence end, so a "." in it ends nothing (kept, A5).
  it.each<[string, string, { text: string; tone: string }[]]>([
    ['(A6) a capital in code after a closer ends the sentence', '(#651 merged) `Main` is red?', [{ text: 'merged', tone: 'merged' }]],
    ['(A6) the same capital in plain prose', '(#651 merged) Main is red?', [{ text: 'merged', tone: 'merged' }]],
    ['(A5) a full stop in code ends no sentence', '#651 merged `step 1.` Is it out?', []],
  ])('%s', (_name, src, statuses) => {
    expect(pluginStatuses(src)).toEqual(statuses);
  });

  it('the context is the block\'s: a negator in another paragraph does not count', () => {
    expect(pluginStatuses('No **flakes**\n\nCI green.')).toEqual([{ text: 'green', tone: 'ok' }]);
  });
});
