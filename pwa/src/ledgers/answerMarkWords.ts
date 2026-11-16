// Overlord W1, answer marks (spec 2026-11-09 §9.2.1, C70; plan w1-delegation-marks.md Task 4): the words of the operator's two
// boxes on Waiting on you, the field's one reader, and the rules for what a box shows. Ring L1 (pure, no React, no store, no
// clock), context Coordination: `AnswerMarkBox.tsx` (L4) draws and acts, and decides nothing.
//
// A mark grants nothing and is never an answer: the boxes only label a question for the Overlord to learn from later.
import {
  ANSWER_MARK_STATE_MAP, type AnswerMarkName, type AnswerMarkView, type AnswerMarksView,
} from '../../../shared/answerMarks';
import type { ItemView } from '../../../shared/ledgers';

/** The operator's words for the two marks. */
export const ANSWER_MARK_LABEL: Readonly<Record<AnswerMarkName, string>> = {
  'could-answer': 'The Overlord could answer this',
  unsure: "I'm not sure of my answer",
};

/** Shown once per device, the first time either box is used. */
export const ANSWER_MARK_EXPLAINER =
  'Tick the questions you would let the Overlord answer for you, and the answers you are not sure of. It learns from both. A tick ' +
  'gives it no authority, and you can untick at any time.';

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

/** THE ONE READER of an item's `answerMarks` (plan question 14). Absent means this server cannot mark this row (an older
 *  server, or a row with no box), never "never marked": `unsupported`, and the row draws no box. A field that is not an
 *  `AnswerMarksView` is `unsupported` too. */
export function answerMarksOf(item: Pick<ItemView, 'answerMarks'>): AnswerMarksView | 'unsupported' {
  const v: unknown = item.answerMarks;
  if (typeof v !== 'object' || v === null) return 'unsupported';
  const o = v as Record<string, unknown>;
  return isMarkView(o['couldAnswer']) && isMarkView(o['unsure']) ? (v as AnswerMarksView) : 'unsupported';
}

/** The one key of each mark in the view. */
export const markOf = (marks: AnswerMarksView, mark: AnswerMarkName): AnswerMarkView =>
  mark === 'could-answer' ? marks.couldAnswer : marks.unsure;

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
