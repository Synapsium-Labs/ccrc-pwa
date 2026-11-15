// Overlord W1, answer marks (plan w1-delegation-marks.md Task 4): the field's one reader, the settle rule (F14) and what one
// box shows. Pure: no React.
import { describe, expect, it } from 'vitest';
import type { AnswerMarkView } from '../../shared/answerMarks';
import {
  ANSWER_MARK_LABEL, ANSWER_MARK_UNMEASURED_NOTE, answerMarksOf, markOf, settledMark, shownMark,
} from '../src/ledgers/answerMarkWords';
import { NOW, MIN } from './ledgersFixture';

const NEVER: AnswerMarkView = { state: 'never' };
const marked = (at: number, signedIn = true): AnswerMarkView => ({ state: 'marked', at, signedIn });
const withdrawn = (at: number): AnswerMarkView => ({ state: 'withdrawn', at, signedIn: true });
const UNMEASURED: AnswerMarkView = { state: 'unmeasured', detail: 'database is locked' };

describe('answerMarksOf, the one reader of the field', () => {
  it('an absent field is unsupported (an older server), never "never marked"', () => {
    expect(answerMarksOf({})).toBe('unsupported');
    expect(answerMarksOf({ answerMarks: undefined })).toBe('unsupported');
  });
  it('a malformed field is unsupported', () => {
    for (const v of [null, 3, 'x', {}, { couldAnswer: NEVER }, { couldAnswer: NEVER, unsure: { state: 'sure' } },
      { couldAnswer: { state: 'marked', at: 'now', signedIn: true }, unsure: NEVER },
      { couldAnswer: { state: 'marked', at: NOW }, unsure: NEVER },
      { couldAnswer: { state: 'unmeasured' }, unsure: NEVER }]) {
      expect(answerMarksOf({ answerMarks: v as never }), JSON.stringify(v)).toBe('unsupported');
    }
  });
  it('reads each state of each mark', () => {
    for (const [a, b] of [[NEVER, marked(NOW)], [withdrawn(NOW), UNMEASURED], [marked(NOW, false), NEVER]] as const) {
      const v = answerMarksOf({ answerMarks: { couldAnswer: a, unsure: b } });
      expect(v).not.toBe('unsupported');
      if (v === 'unsupported') return;
      expect([markOf(v, 'could-answer'), markOf(v, 'unsure')]).toEqual([a, b]);
    }
  });
  it('labels each mark in the operator\'s words', () => {
    expect(ANSWER_MARK_LABEL).toEqual({ 'could-answer': 'The Overlord could answer this', unsure: "I'm not sure of my answer" });
  });
});

describe('settledMark, the one settle rule (F14)', () => {
  it('with nothing settled, the view shows', () => {
    expect(settledMark(marked(NOW), null)).toEqual({ shown: marked(NOW), drop: false });
  });
  it('a view older than the settled answer does not override it', () => {
    expect(settledMark(withdrawn(NOW - MIN), marked(NOW))).toEqual({ shown: marked(NOW), drop: false });
  });
  it('a view of never or unmeasured loses to a settled record', () => {
    expect(settledMark(NEVER, marked(NOW))).toEqual({ shown: marked(NOW), drop: false });
    expect(settledMark(UNMEASURED, marked(NOW))).toEqual({ shown: marked(NOW), drop: false });
  });
  it('a view at least as new as the settled answer wins, and the settled answer is dropped', () => {
    expect(settledMark(marked(NOW), marked(NOW))).toEqual({ shown: marked(NOW), drop: true });
    expect(settledMark(withdrawn(NOW + MIN), marked(NOW))).toEqual({ shown: withdrawn(NOW + MIN), drop: true });
  });
  it('a settled answer with no record (never) is dropped at once', () => {
    expect(settledMark(marked(NOW), NEVER)).toEqual({ shown: marked(NOW), drop: true });
  });
});

describe('shownMark', () => {
  it('marked is checked, withdrawn and never are unchecked, all enabled on a current page', () => {
    expect(shownMark(marked(NOW), null, true)).toEqual({ checked: true, disabled: false, note: null });
    expect(shownMark(withdrawn(NOW), null, true)).toEqual({ checked: false, disabled: false, note: null });
    expect(shownMark(NEVER, null, true)).toEqual({ checked: false, disabled: false, note: null });
  });
  it('unmeasured is a disabled, unchecked box with a short reason, pending or not', () => {
    expect(shownMark(UNMEASURED, null, true)).toEqual({ checked: false, disabled: true, note: ANSWER_MARK_UNMEASURED_NOTE });
    expect(shownMark(UNMEASURED, true, true)).toEqual({ checked: false, disabled: true, note: ANSWER_MARK_UNMEASURED_NOTE });
  });
  it('a pending write shows its value, disabled, so a second tap waits', () => {
    expect(shownMark(NEVER, true, true)).toEqual({ checked: true, disabled: true, note: null });
    expect(shownMark(marked(NOW), false, true)).toEqual({ checked: false, disabled: true, note: null });
  });
  it('a page that is not current (the saved copy) disables the box, keeping its value', () => {
    expect(shownMark(marked(NOW), null, false)).toEqual({ checked: true, disabled: true, note: null });
    expect(shownMark(NEVER, null, false)).toEqual({ checked: false, disabled: true, note: null });
  });
});
