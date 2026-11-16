// Overlord W1, answer marks (plan w1-delegation-marks.md Tasks 4 and 6): the field's one reader, the settle rule (F14), what
// one box shows, and the join of a question row to its ask. Pure: no React.
import { describe, expect, it } from 'vitest';
import type { AnswerMarkView, AskMarkRow } from '../../shared/answerMarks';
import {
  ANSWER_MARK_EXPLAINER, ANSWER_MARK_LABEL, ANSWER_MARK_UNMEASURED_NOTE, TASK_COULD_HANDLE_LABEL, answerMarkLabel, answerMarksOf,
  askMarksFor, askRowsOf, markOf, settledMark, shownMark,
} from '../src/ledgers/answerMarkWords';
import { LEDGER_REFUSAL_TEXT } from '../src/lib/refusalWords';
import { NOW, MIN } from './ledgersFixture';

const NEVER: AnswerMarkView = { state: 'never' };
/** A record by its id (the store's order); its wall time defaults to NOW, so the order is never read from `at`. */
const marked = (id: number, signedIn = true, at = NOW): AnswerMarkView => ({ state: 'marked', id, at, signedIn });
const withdrawn = (id: number, at = NOW): AnswerMarkView => ({ state: 'withdrawn', id, at, signedIn: true });
const UNMEASURED: AnswerMarkView = { state: 'unmeasured', detail: 'database is locked' };

describe('answerMarksOf, the one reader of the field', () => {
  it('an absent field is unsupported (an older server), never "never marked"', () => {
    expect(answerMarksOf({})).toBe('unsupported');
    expect(answerMarksOf({ answerMarks: undefined })).toBe('unsupported');
  });
  it('a malformed field is unsupported', () => {
    for (const v of [null, 3, 'x', {}, { couldAnswer: NEVER }, { couldAnswer: NEVER, unsure: { state: 'sure' } },
      { couldAnswer: { state: 'marked', id: 1, at: 'now', signedIn: true }, unsure: NEVER },
      { couldAnswer: { state: 'marked', at: NOW, signedIn: true }, unsure: NEVER },
      { couldAnswer: { state: 'marked', at: NOW }, unsure: NEVER },
      { couldAnswer: { state: 'unmeasured' }, unsure: NEVER }]) {
      expect(answerMarksOf({ answerMarks: v as never }), JSON.stringify(v)).toBe('unsupported');
    }
  });
  it('reads each state of each mark', () => {
    for (const [a, b] of [[NEVER, marked(5)], [withdrawn(5), UNMEASURED], [marked(5, false), NEVER]] as const) {
      const v = answerMarksOf({ answerMarks: { couldAnswer: a, unsure: b } });
      expect(v).not.toBe('unsupported');
      if (v === 'unsupported') return;
      expect([markOf(v, 'could-answer'), markOf(v, 'unsure')]).toEqual([a, b]);
    }
  });
  it('labels each mark in the operator\'s words', () => {
    expect(ANSWER_MARK_LABEL).toEqual({ 'could-answer': 'The Overlord could answer this', unsure: "I'm not sure of my answer" });
  });

  // Answer marks C (#2900): a task carries the first box alone, worded for a task.
  it('a do item reads couldAnswer alone, and markOf answers no unsure box', () => {
    const v = answerMarksOf({ kind: 'do', answerMarks: { couldAnswer: marked(5) } });
    expect(v).toStrictEqual({ couldAnswer: marked(5) });
    if (v === 'unsupported') return;
    expect(markOf(v, 'could-answer')).toEqual(marked(5));
    expect(markOf(v, 'unsure')).toBeNull();
  });
  it('a do item never shows an unsure box, even when the field carries one', () => {
    expect(answerMarksOf({ kind: 'do', answerMarks: { couldAnswer: NEVER, unsure: NEVER } })).toStrictEqual({ couldAnswer: NEVER });
  });
  it('a do item with no well-formed couldAnswer is unsupported', () => {
    for (const v of [{}, { unsure: NEVER }, { couldAnswer: { state: 'sure' } }, { couldAnswer: { state: 'marked', id: 1 } }]) {
      expect(answerMarksOf({ kind: 'do', answerMarks: v as never }), JSON.stringify(v)).toBe('unsupported');
    }
  });
  it('a question, an ask (no kind) or a secret with couldAnswer alone is unsupported, failing closed', () => {
    for (const kind of ['decide', 'value', 'secret', undefined]) {
      expect(answerMarksOf({ ...(kind === undefined ? {} : { kind }), answerMarks: { couldAnswer: NEVER } }), String(kind)).toBe('unsupported');
    }
  });
  it('a task\'s first box reads "The Overlord could handle this"; every other row keeps the question\'s words', () => {
    expect(TASK_COULD_HANDLE_LABEL).toBe('The Overlord could handle this');
    expect(answerMarkLabel('could-answer', 'do')).toBe('The Overlord could handle this');
    // Only the first box changes its words: unsure keeps the question's words, whatever the kind.
    expect(answerMarkLabel('unsure', 'do')).toBe("I'm not sure of my answer");
    for (const kind of ['decide', 'value', undefined, 'approval']) {
      expect(answerMarkLabel('could-answer', kind)).toBe('The Overlord could answer this');
      expect(answerMarkLabel('unsure', kind)).toBe("I'm not sure of my answer");
    }
  });
  it('the explainer covers tasks too', () => {
    expect(ANSWER_MARK_EXPLAINER).toMatch(/tasks/);
    expect(ANSWER_MARK_EXPLAINER).toMatch(/handle/);
    expect(ANSWER_MARK_EXPLAINER).toMatch(/no authority/);
  });
});

describe('settledMark, the one settle rule (F14)', () => {
  it('with nothing settled, the view shows', () => {
    expect(settledMark(marked(5), null)).toEqual({ shown: marked(5), drop: false });
  });
  it('a view older than the settled answer does not override it', () => {
    expect(settledMark(withdrawn(4), marked(5))).toEqual({ shown: marked(5), drop: false });
  });
  it('a view of never or unmeasured loses to a settled record', () => {
    expect(settledMark(NEVER, marked(5))).toEqual({ shown: marked(5), drop: false });
    expect(settledMark(UNMEASURED, marked(5))).toEqual({ shown: marked(5), drop: false });
  });
  it('a view at least as new as the settled answer wins, and the settled answer is dropped', () => {
    expect(settledMark(marked(5), marked(5))).toEqual({ shown: marked(5), drop: true });
    expect(settledMark(withdrawn(6), marked(5))).toEqual({ shown: withdrawn(6), drop: true });
  });
  it('orders by record id, never by the wall clock: a newer record stamped earlier still wins (review 2196 F4)', () => {
    expect(settledMark(withdrawn(6, NOW - MIN), marked(5, true, NOW))).toEqual({ shown: withdrawn(6, NOW - MIN), drop: true });
    expect(settledMark(withdrawn(4, NOW + MIN), marked(5, true, NOW))).toEqual({ shown: marked(5, true, NOW), drop: false });
  });
  it('a settled answer with no record (never) is dropped at once', () => {
    expect(settledMark(marked(5), NEVER)).toEqual({ shown: marked(5), drop: true });
  });
});

describe('shownMark', () => {
  it('marked is checked, withdrawn and never are unchecked, all enabled on a current page', () => {
    expect(shownMark(marked(5), null, true)).toEqual({ checked: true, disabled: false, note: null });
    expect(shownMark(withdrawn(5), null, true)).toEqual({ checked: false, disabled: false, note: null });
    expect(shownMark(NEVER, null, true)).toEqual({ checked: false, disabled: false, note: null });
  });
  it('unmeasured is a disabled, unchecked box with a short reason, pending or not', () => {
    expect(shownMark(UNMEASURED, null, true)).toEqual({ checked: false, disabled: true, note: ANSWER_MARK_UNMEASURED_NOTE });
    expect(shownMark(UNMEASURED, true, true)).toEqual({ checked: false, disabled: true, note: ANSWER_MARK_UNMEASURED_NOTE });
  });
  it('a pending write shows its value, disabled, so a second tap waits', () => {
    expect(shownMark(NEVER, true, true)).toEqual({ checked: true, disabled: true, note: null });
    expect(shownMark(marked(5), false, true)).toEqual({ checked: false, disabled: true, note: null });
  });
  it('a page that is not current (the saved copy) disables the box, keeping its value', () => {
    expect(shownMark(marked(5), null, false)).toEqual({ checked: true, disabled: true, note: null });
    expect(shownMark(NEVER, null, false)).toEqual({ checked: false, disabled: true, note: null });
  });
});

// Answer marks B (plan Task 6): the join of a question row to its live ask, and the one reader of the ask lists.
describe('askMarksFor and askRowsOf', () => {
  const row = (o: Partial<AskMarkRow> = {}): AskMarkRow => ({
    id: 5, childId: 'lane-a-child', program: 'prog-a', question: 'Which base?', how: 'lapsed', reason: null, at: NOW - MIN,
    live: true, answerMarks: { couldAnswer: NEVER, unsure: NEVER }, ...o,
  });

  it('finds the session\'s live ask', () => {
    expect(askMarksFor('lane-a-child', [row({ childId: 'lane-a-other', id: 4 }), row()])?.id).toBe(5);
  });

  it('answers nothing for a session with no listed ask (a root session\'s own ask, an ask still held)', () => {
    expect(askMarksFor('lane-a-root', [row()])).toBeNull();
    expect(askMarksFor('lane-a-child', [])).toBeNull();
  });

  it('answers nothing for an ask that is not live: its dialog has gone, or the session now shows a permission prompt', () => {
    expect(askMarksFor('lane-a-child', [row({ live: false })])).toBeNull();
    expect(askMarksFor('lane-a-child', [row({ live: 'unmeasured' })])).toBeNull();
  });

  it('answers nothing when the view has no ask list (an older server)', () => {
    expect(askMarksFor('lane-a-child', undefined)).toBeNull();
    expect(askRowsOf(undefined)).toEqual([]);
  });

  it('askRowsOf leaves out a row that is not an ask row, and keeps the rest', () => {
    const good = row();
    const bad: unknown[] = [null, 3, { ...good, how: 'invented' }, { ...good, live: 'yes' }, { ...good, answerMarks: undefined },
      { ...good, program: 4 }, { ...good, id: '5' }];
    expect(askRowsOf([...bad, good])).toEqual([good]);
    expect(askRowsOf({ length: 1 })).toEqual([]);
  });

  it('the door\'s ask refusals have their sentences', () => {
    expect(LEDGER_REFUSAL_TEXT['unknown-ask']).toBe('This question is no longer on record, so it cannot be marked.');
    expect(LEDGER_REFUSAL_TEXT['ask-unreadable']).toMatch(/could not read that question/);
  });
});
