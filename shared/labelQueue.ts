// Overlord W2, the label queue (spec 2026-11-09 §3.7 H6, "The label queue"; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-label-queue.md, Task 1). Ring L0: the queue's numbers, a card's answers and
// the two doors' wire shapes, one home each. It imports types only, so the console bundles it.
import type { DecisionRowId } from './decisionModel.js';

/** At most this many cards are picked in one UTC ISO week, and at most this many stand open at once (LQ2). */
export const LABEL_CARDS_PER_WEEK = 10;
/** A card row with a waiting case gets a card at least once in this many weeks, while the operator answers (LQ4). */
export const LABEL_ROW_MAX_GAP_WEEKS = 4;
/** `labelsNeeded` searches up to this many clean labels; a row that needs more is `far` (LQ5). */
export const LABELS_NEEDED_CAP = 1000;

/** A card's answer words (LQ12: `not-sure` closes the card with no label). A choice row's option rides as `{ option }`. */
export const LABEL_ANSWER_WORDS = ['yes', 'no', 'none', 'not-sure'] as const;
export type LabelAnswerWord = (typeof LABEL_ANSWER_WORDS)[number];
export type LabelAnswer = LabelAnswerWord | { readonly option: string };
export const isLabelAnswerWord = (v: unknown): v is LabelAnswerWord =>
  typeof v === 'string' && (LABEL_ANSWER_WORDS as readonly string[]).includes(v);

/** How a card closed: with a label, or "Not sure", which is no label (LQ12). */
export const LABEL_CARD_OUTCOMES = ['labelled', 'not-sure'] as const;
export type LabelCardOutcome = (typeof LABEL_CARD_OUTCOMES)[number];

/** The answer door's own refusals, beside the account gate's (`ACCOUNT_GATE_REFUSALS`): an unknown card, an answer the row
 *  does not allow, a card whose row went `off` or changed revision (LQ13), and a write that did not happen. */
export const LABEL_DOOR_REFUSALS = ['not-found', 'bad-request', 'row-changed', 'write-failed'] as const;
export type LabelDoorRefusal = (typeof LABEL_DOOR_REFUSALS)[number];

/** One field of a card, rebuilt from the record at each read and never stored. A `quoted` field is text a session wrote. */
export interface CardField {
  readonly name: string;
  readonly quoted: boolean;
  readonly text: string | readonly string[];
}

/** One card as the console draws it: the row's fixed question, its fields and the answers the row allows. It carries no
 *  verdict, probability, band or line (LQ10): the model's answer is hidden. */
export interface CardView {
  readonly id: number;
  readonly row: DecisionRowId;
  readonly question: string;
  readonly fields: readonly CardField[];
  readonly answers: readonly LabelAnswer[];
  readonly pickedAt: number;
  readonly week: string;
}

/** `GET /api/labels`. `skipped` counts the open cards left out because their state did not resolve: `absent` (a ref no
 *  longer resolves) and `unmeasured` (a read could not answer), never drawn empty and never from a stored copy. */
export interface LabelCardsAnswer {
  readonly ok: true;
  readonly cards: readonly CardView[];
  readonly open: number;
  readonly pickedThisWeek: number;
  readonly week: string;
  readonly skipped: { readonly absent: number; readonly unmeasured: number };
}

/** `POST /api/labels/:id`: `changed` is false when the card was already closed. */
export interface LabelAnswerResult {
  readonly ok: true;
  readonly changed: boolean;
}
