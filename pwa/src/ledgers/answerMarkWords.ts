// Overlord W1, answer marks (spec 2026-11-09 §9.2.1, C70; plan w1-delegation-marks.md Task 4): the words of the operator's two
// boxes on Waiting on you, the field's one reader, and the rules for what a box shows. Ring L1 (pure, no React, no store, no
// clock), context Coordination: `AnswerMarkBox.tsx` (L4) draws and acts, and decides nothing.
//
// A mark grants nothing and is never an answer: the boxes only label a question for the Overlord to learn from later.
import {
  ASK_MARK_HOW_MAP, ANSWER_MARK_STATE_MAP, type AnswerMarkName, type AnswerMarkView, type AnswerMarksView, type AskMarkHow,
  type AskMarkRow,
} from '../../../shared/answerMarks';

/** The operator's words for the two marks on a question. */
export const ANSWER_MARK_LABEL: Readonly<Record<AnswerMarkName, string>> = {
  'could-answer': 'The Overlord could answer this',
  unsure: "I'm not sure of my answer",
};

/** The first mark's words on a task (answer marks C, #2900): a task is handled, a question is answered. */
export const TASK_COULD_HANDLE_LABEL = 'The Overlord could handle this';

/** A box's words: the wording follows the row's kind, so a `do` item's first box is a task's. */
export const answerMarkLabel = (mark: AnswerMarkName, rowKind: unknown): string =>
  mark === 'could-answer' && rowKind === 'do' ? TASK_COULD_HANDLE_LABEL : ANSWER_MARK_LABEL[mark];

/** Shown once per device, the first time any box is used. */
export const ANSWER_MARK_EXPLAINER =
  'Tick the questions you would let the Overlord answer and the tasks you would let it handle, and the answers you are not ' +
  'sure of. It learns from them. A tick gives it no authority, and you can untick at any time.';

/** The per-device key that remembers the explainer was shown. */
export const ANSWER_MARK_EXPLAINED_KEY = 'ccrc.answerMarks.explained';

/** A box whose mark could not be read. */
export const ANSWER_MARK_UNMEASURED_NOTE = 'Could not read this mark';

/** The group's label for a screen reader. */
export const ANSWER_MARKS_LABEL = 'Your marks for the Overlord';

const isMarkView = (v: unknown): v is AnswerMarkView => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o['state'] !== 'string' || !Object.hasOwn(ANSWER_MARK_STATE_MAP, o['state'])) return false;
  if (o['state'] === 'marked' || o['state'] === 'withdrawn') {
    return typeof o['id'] === 'number' && typeof o['at'] === 'number' && typeof o['signedIn'] === 'boolean';
  }
  if (o['state'] === 'unmeasured') return typeof o['detail'] === 'string';
  return true;
};

/** THE ONE READER of a row's `answerMarks`, an item's or an ask's (plan question 14). Absent means this server cannot mark
 *  this row (an older server, or a row with no box), never "never marked": `unsupported`, and the row draws no box. A field
 *  that is not an `AnswerMarksView` is `unsupported` too. A task (`do` item) reads `couldAnswer` alone and never an `unsure`,
 *  even one the field carries (answer marks C, #2900); every other row, an ask (no `kind`) among them, needs both, so a
 *  question missing one fails closed. */
export function answerMarksOf(item: { readonly answerMarks?: unknown; readonly kind?: unknown }): AnswerMarksView | 'unsupported' {
  const v: unknown = item.answerMarks;
  if (typeof v !== 'object' || v === null) return 'unsupported';
  const o = v as Record<string, unknown>;
  if (!isMarkView(o['couldAnswer'])) return 'unsupported';
  if (item.kind === 'do') return { couldAnswer: o['couldAnswer'] };
  return isMarkView(o['unsure']) ? { couldAnswer: o['couldAnswer'], unsure: o['unsure'] } : 'unsupported';
}

/** The one key of each mark in the view: `null` when the row carries no box for it (a task's `unsure`). */
export const markOf = (marks: AnswerMarksView, mark: AnswerMarkName): AnswerMarkView | null =>
  (mark === 'could-answer' ? marks.couldAnswer : marks.unsure) ?? null;

const idOf = (v: AnswerMarkView): number | null => (v.state === 'marked' || v.state === 'withdrawn' ? v.id : null);

/** THE SETTLE RULE (F14), once. When the door answers, the box keeps that answer as `settled`; it shows the newer of `settled`
 *  and the view's mark, by record id (the store's own order of a row's records, never the wall clock's `at`), and `settled`
 *  may be dropped once the view's mark is at least as new. A view mark with no record (`never`, or `unmeasured`) loses to a
 *  settled record, so a view frame older than the door's answer never unticks it. */
export function settledMark(view: AnswerMarkView, settled: AnswerMarkView | null): { shown: AnswerMarkView; drop: boolean } {
  const s = settled === null ? null : idOf(settled);
  if (settled === null || s === null) return { shown: view, drop: settled !== null };
  const v = idOf(view);
  return v !== null && v >= s ? { shown: view, drop: true } : { shown: settled, drop: false };
}

/** What one box shows: the server's value (`settledMark`'s `shown`), a write still pending, and whether the page is current. */
export function shownMark(server: AnswerMarkView, pending: boolean | null, current: boolean): {
  checked: boolean; disabled: boolean; note: string | null;
} {
  if (server.state === 'unmeasured') return { checked: false, disabled: true, note: ANSWER_MARK_UNMEASURED_NOTE };
  if (pending !== null) return { checked: pending, disabled: true, note: null };
  return { checked: server.state === 'marked', disabled: !current, note: null };
}

/** THE ONE READER of the waiting view's ask lists (answer marks B, plan Task 6): the rows that are asks the operator has, each
 *  with both marks. Absent (an older server, or one that could not read its asks) is no row at all, so no ask box is drawn; a
 *  row that is not an `AskMarkRow` is left out, never guessed at. */
export function askRowsOf(rows: unknown): AskMarkRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is AskMarkRow => {
    if (typeof r !== 'object' || r === null) return false;
    const o = r as Record<string, unknown>;
    return typeof o['id'] === 'number' && typeof o['childId'] === 'string' && typeof o['at'] === 'number'
      && typeof o['question'] === 'string' && (o['program'] === null || typeof o['program'] === 'string')
      && typeof o['how'] === 'string' && Object.hasOwn(ASK_MARK_HOW_MAP, o['how'])
      && (o['live'] === true || o['live'] === false || o['live'] === 'unmeasured') && answerMarksOf(o) !== 'unsupported';
  });
}

/** A question row's ask (plan Task 6): the listed ask of this session that the server read as live, so the boxes name the
 *  question the row shows and never an older ask of the same child. None for a session with no listed ask (a root session's
 *  own ask, an ask still held), for one whose ask is not live (its dialog has gone, or it shows a permission prompt), and
 *  when the server sent no ask list. */
export function askMarksFor(sessionId: string, asks: unknown): AskMarkRow | null {
  return askRowsOf(asks).find((a) => a.childId === sessionId && a.live === true) ?? null;
}

/** How a cleared ask reached the operator, in their words, before its age. */
export const ASK_HOW_WORD: Readonly<Record<AskMarkHow, string>> = {
  answered: 'you answered it',
  declined: 'its parent passed it to you',
  lapsed: 'its parent did not answer in time',
  'released-at-mint': 'it came straight to you',
};
/** A cleared ask whose question text the retention has blanked. */
export const ASK_NO_TEXT_WORD = 'A question (its text is no longer kept)';
