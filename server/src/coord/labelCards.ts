// Overlord W2, the label cards' deciders (spec 2026-11-09 §3.7 H6; plan docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-label-queue.md, Task 2, LQ10, LQ12 and LQ13). Ring: L1, context Attention & Notification (C6): pure, no store, no clock,
// no I/O; the card, the row now and the answer are arguments. The card doors (`labelCardRoutes.ts`, L4) ask these and decide
// nothing themselves, and the C5 store asks none of them (F13).
import type { DecisionQuestionRow, DecisionRowMode } from '../../../shared/decisionModel.js';
import type { CardField, CardView, LabelAnswer } from '../../../shared/labelQueue.js';
import type { LabelledAnswer } from './decisionLines.js';
import type { LabelCardRow } from './labelQueue.js';

/** The answers a card offers (LQ12): a yes-no row, yes, no and not-sure; a choice row, each of its options, none, not-sure. */
export function cardAllowedAnswers(row: DecisionQuestionRow, options: readonly string[]): readonly LabelAnswer[] {
  if (row.type === 'yes-no') return ['yes', 'no', 'not-sure'];
  return [...options.map((option): LabelAnswer => ({ option })), 'none', 'not-sure'];
}

export type CardAnswerVerdict =
  | { kind: 'label'; label: LabelledAnswer['label'] } | { kind: 'not-sure' } | { kind: 'already' }
  | { kind: 'refuse'; word: 'row-changed' | 'bad-request' };

/**
 * What an answer to a card does. First match:
 *
 * | # | When | Answer |
 * |---|---|---|
 * | 1 | the card is closed | already |
 * | 2 | the row is `off`, or its revision is not the card's | refuse row-changed (LQ13) |
 * | 3 | the answer is `not-sure` | not-sure (no label, LQ12) |
 * | 4 | the answer is one the row allows: a word, or `{ option }` with exactly that key | label |
 * | 5 | anything else | refuse bad-request |
 *
 * `now.options` is the choice row's shortlist, which the record holds and the row's catalogue does not.
 */
export function cardAnswerVerdict(
  card: { closedAt: number | null; row: string; revision: string },
  now: { mode: DecisionRowMode; revision: string; row: DecisionQuestionRow; options: readonly string[] },
  answer: unknown,
): CardAnswerVerdict {
  if (card.closedAt !== null) return { kind: 'already' };
  if (now.mode === 'off' || now.revision !== card.revision) return { kind: 'refuse', word: 'row-changed' };
  if (answer === 'not-sure') return { kind: 'not-sure' };
  const allowed = cardAllowedAnswers(now.row, now.options);
  if (answer === 'yes' || answer === 'no' || answer === 'none') {
    return allowed.includes(answer) ? { kind: 'label', label: answer } : { kind: 'refuse', word: 'bad-request' };
  }
  if (typeof answer === 'object' && answer !== null && !Array.isArray(answer)) {
    const keys = Object.keys(answer);
    const option = (answer as { option?: unknown }).option;
    if (keys.length === 1 && keys[0] === 'option' && typeof option === 'string'
      && allowed.some((a) => typeof a === 'object' && a.option === option)) {
      return { kind: 'label', label: { option } };
    }
  }
  return { kind: 'refuse', word: 'bad-request' };
}

/**
 * LQ10: a card as the console draws it: the row's fixed question, the fields the record rebuilt (in the catalogue's order,
 * each `quoted` one marked) and the answers the row allows. It never carries a verdict, `p`, band or line: a name that is
 * not a catalogue field of the row is dropped, so nothing the caller passes along can reach the card.
 */
export function cardView(
  card: LabelCardRow, row: DecisionQuestionRow, fields: Record<string, string | readonly string[]>, options: readonly string[],
): CardView {
  const shown: CardField[] = [];
  for (const f of row.fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, f.name)) continue;
    shown.push({ name: f.name, quoted: f.kind === 'quoted', text: fields[f.name]! });
  }
  return {
    id: card.id, row: card.row, question: row.instructions, fields: shown,
    answers: cardAllowedAnswers(row, options), pickedAt: card.pickedAt, week: card.week,
  };
}
