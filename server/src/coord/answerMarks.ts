// Overlord W1, answer marks (spec 2026-11-09 §9.2.1, C70; plan w1-delegation-marks.md Task 1): which rows carry the operator's
// two boxes, and what one mark reads as on the wire. Ring: L1, context Coordination: pure, no store, no clock (`now` is an
// argument), and it imports `shared/` only. The door (`ledgersRoutes.ts`) asks these and decides nothing itself; the store
// (`answerMarkStore.ts`) answers the newest records these read.
//
// ONE RULE FOR "ON THE LIST" (Review Focus 2). `itemMarkable` reads the same hold rule, open states and Recently cleared window
// as `ledgersStore.ts#itemsFor` (`operatorShownAt`, `OPEN_ITEM_STATES`, `CLEARED_WINDOW_MS`), never a copy, so a `decide` or
// `value` item the list shows carries boxes exactly when the door accepts a mark on it. `answer-marks.test.ts` pins that
// agreement over one fixture set in a real `coord.db`.
import { CLEARED_WINDOW_MS, OPEN_ITEM_STATES, operatorShownAt, type ItemKind } from '../../../shared/ledgers.js';
import { isAnswerMarkName, type AnswerMarkView, type AnswerMarksView } from '../../../shared/answerMarks.js';

/** Why a row carries no box (plan question 13, the `not-markable` refusal's `detail`):
 *  `no-box`: a `do` or `secret` item, which is not a question the Overlord could answer (Table 6.1a);
 *  `not-shown`: the operator was never shown it (held, or settled inside its hold);
 *  `past-window`: done longer ago than the Recently cleared window;
 *  `not-listed`: in no list's state (withdrawn, dismissed, or a state this build does not know). */
export type NotMarkableReason = 'no-box' | 'not-shown' | 'past-window' | 'not-listed';
const NOT_MARKABLE_REASON_MAP: Readonly<Record<NotMarkableReason, true>> = { 'no-box': true, 'not-shown': true, 'past-window': true, 'not-listed': true };
/** The door's `bad-request` detail for a mark on an ask, which W1 does not take yet. */
export const ASK_MARKS_NOT_YET = 'ask-marks-not-yet';
/** The answer marks' own words, for `mail-routes.test.ts`'s code scan: a mark's name, a reason and the ask detail. None is
 *  a mail or run refusal; the door's refusal is `not-markable`, sent by `refuseRoute`. */
export const isAnswerMarkKebab = (tok: string): boolean =>
  isAnswerMarkName(tok) || Object.hasOwn(NOT_MARKABLE_REASON_MAP, tok) || tok === ASK_MARKS_NOT_YET;
export type Markable = { markable: true } | { markable: false; reason: NotMarkableReason };

/** The kinds that carry an answer the Overlord could give, and so the two boxes. */
const BOXED_KINDS: Readonly<Record<ItemKind, boolean>> = { decide: true, value: true, do: false, secret: false };

/** The fields of an item row the rule reads. `state` is a string: a state this build does not know is `not-listed`. */
export interface MarkableItem {
  readonly kind: string; readonly state: string;
  readonly raisedAt: number; readonly heldUntil: number | null; readonly closedAt: number | null;
}

/** Whether the operator may mark this item now, first match: `no-box`, `not-shown`, then its state. A shown `decide` or
 *  `value` item that is `open` or `checking`, or `done` inside the Recently cleared window, is markable. */
export function itemMarkable(row: MarkableItem, now: number): Markable {
  if (BOXED_KINDS[row.kind as ItemKind] !== true) return { markable: false, reason: 'no-box' };
  const shownAt = operatorShownAt(row);
  if (shownAt === null || shownAt > now) return { markable: false, reason: 'not-shown' };
  if ((OPEN_ITEM_STATES as readonly string[]).includes(row.state)) return { markable: true };
  if (row.state === 'done') {
    return row.closedAt !== null && row.closedAt >= now - CLEARED_WINDOW_MS
      ? { markable: true } : { markable: false, reason: 'past-window' };
  }
  return { markable: false, reason: 'not-listed' };
}

/** The fields of a stored mark record the view reads (`answerMarkStore.ts#AnswerMarkRecord`, passed as a plain row). */
export interface MarkRecordLike { readonly id: number; readonly value: number; readonly at: number; readonly actor: string }

/** The actor a mark written while sign-in was dark carries (the rank door's word): no session said who made it. */
export const DARK_MARK_ACTOR = 'flag-off';

/** One mark's view: `null` is `never`; a record is `marked` (value 1) or `withdrawn` (value 0) with its id and time, and
 *  `signedIn` is false for a dark mark; `'unmeasured'` is a failed read, with its detail. */
export function markViewOf(newest: MarkRecordLike | null | 'unmeasured', detail = 'the mark could not be read'): AnswerMarkView {
  if (newest === 'unmeasured') return { state: 'unmeasured', detail };
  if (newest === null) return { state: 'never' };
  return { state: newest.value === 1 ? 'marked' : 'withdrawn', id: newest.id, at: newest.at, signedIn: newest.actor !== DARK_MARK_ACTOR };
}

/** What an item's view is given of its marks: the read of its newest records, or the read's failure. */
export type ItemMarkRead =
  | { readonly ok: true; readonly couldAnswer: MarkRecordLike | null; readonly unsure: MarkRecordLike | null }
  | { readonly ok: false; readonly detail: string };

/** The `answerMarks` an item's view carries: none (`undefined`, the field absent) when the item carries no box now, else
 *  both marks, each `unmeasured` when the read failed. A failed read never hides the item (Review Focus 3). */
export function itemMarksView(row: MarkableItem, now: number, read: ItemMarkRead): AnswerMarksView | undefined {
  if (!itemMarkable(row, now).markable) return undefined;
  if (!read.ok) return { couldAnswer: markViewOf('unmeasured', read.detail), unsure: markViewOf('unmeasured', read.detail) };
  return { couldAnswer: markViewOf(read.couldAnswer), unsure: markViewOf(read.unsure) };
}
