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
// `.`, `!` or `?` followed by a space or the end, or at a line break. Through the plugin, the text of the same block
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
  const out: { text: string; tone: string }[] = [];
  const stack: MdNode[] = [processor.runSync(processor.parse(src)) as unknown as MdNode];
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
    ['tests passed: 0 (of 12)'],
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
    ['not-yet CI green', { text: 'green', tone: 'ok' }],
    ['tests passed: 0.5% of the time', { text: 'passed', tone: 'ok' }],
    ['tests passed: none skipped', { text: 'passed', tone: 'ok' }],
    ['tests passed: 0 offline', { text: 'passed', tone: 'ok' }],
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
    const t0 = performance.now();
    const statuses = pluginStatuses(src);
    const ms = performance.now() - t0;
    expect(statuses.length).toBe(Math.ceil(100_000 / 'CI green `x` '.length));
    // The parse is inside this bound too (about 0.15 s in all on the author's box), so it is wider. A scan per text
    // node over its whole clause took about 2.8 s for the plugin alone.
    expect(ms).toBeLessThan(BOUND_MS * 5);
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

  it('the context is the block\'s: a negator in another paragraph does not count', () => {
    expect(pluginStatuses('No **flakes**\n\nCI green.')).toEqual([{ text: 'green', tone: 'ok' }]);
  });
});
