// Overlord W2, the label queue's vocabulary (plan w2-label-queue.md Task 1): the numbers H6 and LQ1 to LQ12 fix, the answer
// words written out, and a card's wire shape with no field that could carry the model's answer (LQ10).
import { describe, expect, it } from 'vitest';
import {
  LABEL_ANSWER_WORDS, LABEL_CARD_OUTCOMES, LABEL_CARDS_PER_WEEK, LABEL_DOOR_REFUSALS, LABEL_ROW_MAX_GAP_WEEKS, LABELS_NEEDED_CAP,
  isLabelAnswerWord, type CardField, type CardView, type LabelCardsAnswer,
} from '../../shared/labelQueue.js';

describe('the label queue vocabulary', () => {
  it('fixes the week, the gap and the search cap (H6: ten a week, a card at least every fourth week; LQ5)', () => {
    expect(LABEL_CARDS_PER_WEEK).toBe(10);
    expect(LABEL_ROW_MAX_GAP_WEEKS).toBe(4);
    expect(LABELS_NEEDED_CAP).toBe(1000);
  });

  it('writes the answer words, the outcomes and the door refusals out', () => {
    expect(LABEL_ANSWER_WORDS).toEqual(['yes', 'no', 'none', 'not-sure']);
    expect(LABEL_CARD_OUTCOMES).toEqual(['labelled', 'not-sure']);
    expect(LABEL_DOOR_REFUSALS).toEqual(['not-found', 'bad-request', 'row-changed', 'write-failed']);
    expect(LABEL_ANSWER_WORDS.every(isLabelAnswerWord)).toBe(true);
    for (const v of ['maybe', '', 'Yes', null, 1, { option: 'a' }]) expect(isLabelAnswerWord(v)).toBe(false);
  });

  it('a card has no field that could carry the verdict, a probability, the band or the line (LQ10)', () => {
    // The compiler makes each list exhaustive: a field added to CardView, CardField or LabelCardsAnswer is a compile error
    // here until it is listed, and then it meets the forbidden names below.
    const card: Record<keyof CardView, true> = { id: true, row: true, question: true, fields: true, answers: true, pickedAt: true, week: true };
    const field: Record<keyof CardField, true> = { name: true, quoted: true, text: true };
    const read: Record<keyof LabelCardsAnswer, true> = { ok: true, cards: true, open: true, pickedThisWeek: true, week: true, skipped: true };
    const forbidden = ['verdict', 'p', 'band', 'line', 'probability'];
    for (const keys of [card, field, read]) expect(Object.keys(keys).filter((k) => forbidden.includes(k))).toEqual([]);
  });
});
