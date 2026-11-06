// A status label must not say the opposite of its sentence (chat reading Task C, D-8061; fix round 1, review 1584 F1;
// departure c-s3-negation, which amends spec 2026-11-06 §3.3's S3). Once Task C paints `data-status`, S3's label on
// "No tests failed." is a red label on a good outcome. So S3 withholds the label, and keeps the mark, when:
//   - a negator (`STATUS_NEGATORS`: no, none, not, never, nothing, 0, zero) stands before the status word in its
//     clause, before the subject or between the two, or right after it behind a colon as its count ("passed: 0 of 12");
//   - the status word's sentence ends in "?".
// A clause ends at `.`, `!`, `?`, `;`, `,` or `:` followed by a space or the end, or at a line break.
// `chat-marks.test.ts` (Task L's claim) keeps the S3 table; this file holds only the withholding.
import { describe, expect, it } from 'vitest';
import { STATUS_NEGATORS, markRuns, type Mark } from '../src/lib/chatMarks';

const statusesOf = (text: string): { text: string; tone: string }[] =>
  markRuns(text).flatMap((r) => (r.kind === 'status' ? [{ text: r.text, tone: r.tone }] : []));
const marksOf = (text: string): Mark[] => markRuns(text).flatMap((r) => (r.kind === 'mark' ? [r.mark] : []));

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

describe('labels that keep their colour (positives)', () => {
  it.each<[string, string, { text: string; tone: string }]>([
    ['a count above zero', '3 tests failed', { text: 'failed', tone: 'fail' }],
    ['the build failed', 'the build failed', { text: 'failed', tone: 'fail' }],
    ['a name and its word', '#651 merged', { text: 'merged', tone: 'merged' }],
    ['a full stop ends it', 'CI green.', { text: 'green', tone: 'ok' }],
    ['a file name\'s dot is not a sentence end', 'run 1527 is blocked on docs/a.md?x', { text: 'blocked', tone: 'wait' }],
    ['a word that merely contains a negator', 'Notably the build failed.', { text: 'failed', tone: 'fail' }],
    ['a negator-like word fused to another', 'Nonetheless tests passed.', { text: 'passed', tone: 'ok' }],
  ])('%s keeps its label', (_name, text, status) => {
    expect(statusesOf(text)).toEqual([status]);
  });
});
