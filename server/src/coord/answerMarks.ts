// Overlord W1, answer marks (spec 2026-11-09 §9.2.1, C70; plan w1-delegation-marks.md Tasks 1 and 5): which rows carry the operator's
// two boxes, and what one mark reads as on the wire. Ring: L1, context Coordination: pure, no store, no clock (`now` is an
// argument), and it imports `shared/` only. The door (`ledgersRoutes.ts`) asks these and decides nothing itself; the store
// (`answerMarkStore.ts`) answers the newest records these read.
//
// ONE RULE FOR "ON THE LIST" (Review Focus 2). `itemMarkable` reads the same hold rule, open states and Recently cleared window
// as `ledgersStore.ts#itemsFor` (`operatorShownAt`, `OPEN_ITEM_STATES`, `CLEARED_WINDOW_MS`), never a copy, so a `decide` or
// `value` item the list shows carries boxes exactly when the door accepts a mark on it. `answer-marks.test.ts` pins that
// agreement over one fixture set in a real `coord.db`. `askMarkable` is the same rule for asks: `answerMarkStore.ts#askMarkTargets`
// lists exactly the asks it calls markable, and `answer-marks.test.ts` pins that agreement too.
import { CLEARED_WINDOW_MS, OPEN_ITEM_STATES, operatorShownAt, type ItemKind } from '../../../shared/ledgers.js';
import { ASK_MARK_HOW_MAP, isAnswerMarkName, type AnswerMarkView, type AnswerMarksView } from '../../../shared/answerMarks.js';
import { ASK_OPERATOR_PRINCIPAL } from '../../../shared/api.js';

/** Why a row carries no box (plan question 13, the `not-markable` refusal's `detail`):
 *  `no-box`: a `do` or `secret` item, which is not a question the Overlord could answer (Table 6.1a);
 *  `not-shown`: the operator was never shown it (held, or settled inside its hold; an ask held, or answered by its parent);
 *  `past-window`: done (or, for an ask, released or answered) longer ago than the Recently cleared window;
 *  `not-listed`: in no list's state (withdrawn, dismissed, or a state this build does not know). */
export type NotMarkableReason = 'no-box' | 'not-shown' | 'past-window' | 'not-listed';
const NOT_MARKABLE_REASON_MAP: Readonly<Record<NotMarkableReason, true>> = { 'no-box': true, 'not-shown': true, 'past-window': true, 'not-listed': true };
/** The answer marks' own words, for `mail-routes.test.ts`'s code scan: a mark's name, a reason, and how an ask reached the
 *  operator. None is a mail or run refusal; the door's refusal is `not-markable`, sent by `refuseRoute`. */
export const isAnswerMarkKebab = (tok: string): boolean =>
  isAnswerMarkName(tok) || Object.hasOwn(NOT_MARKABLE_REASON_MAP, tok) || Object.hasOwn(ASK_MARK_HOW_MAP, tok);
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
  return rowMarksView(read);
}

/** Both marks of a markable row from its read: each from its own record, or both `unmeasured` when the read failed. */
export function rowMarksView(read: ItemMarkRead): AnswerMarksView {
  if (!read.ok) return { couldAnswer: markViewOf('unmeasured', read.detail), unsure: markViewOf('unmeasured', read.detail) };
  return { couldAnswer: markViewOf(read.couldAnswer), unsure: markViewOf(read.unsure) };
}

/** The fields of an ask row the rule reads (`answerMarkStore.ts#askMarkRead`'s row). `state` is a string: a state this build
 *  does not know is `not-listed`. `reachedOperatorAt` is the push outbox's reach stamp (`pushOutboxStore.ts#stampReach`). */
export interface MarkableAsk {
  readonly state: string; readonly answeredBy: string | null; readonly answeredAt: number | null; readonly releasedAt: number | null;
  readonly reachedOperatorAt: number | null;
}

/** Whether the operator may mark this ask now (plan Task 5; review 2217 F1, slug reached-is-the-reach-stamp). An ask that
 *  reached the operator stays one they were shown, whoever answers it later. `released` and `declined` say so by their state,
 *  but a released ask does not stay released: a principal may take it into `answering`, its parent may answer it late, and its
 *  dialog may vanish (`stale`, which overwrites `releasedAt`). Past those moves the reach stamp says it: the instant the ask
 *  reached the operator, written once by the release and never cleared. A `released` or `declined` ask, and a reached
 *  `answering` one, is markable while `live` (its child's dialog waits on it) or inside the Recently cleared window of its
 *  `releasedAt`; an `unmeasured` live read counts as not live. An answered ask the operator answered, or one that reached them,
 *  is markable inside the window of its `answeredAt`, and a reached `stale` ask inside the window of the time it went stale. An
 *  ask that never reached the operator (`held`, or moved on with no stamp) is `not-shown`; any other state is `not-listed`. */
export function askMarkable(row: MarkableAsk, live: boolean | 'unmeasured', now: number): Markable {
  const inWindow = (at: number | null): boolean => at !== null && at >= now - CLEARED_WINDOW_MS;
  const shown = (at: number | null, liveCounts: boolean): Markable =>
    (liveCounts && live === true) || inWindow(at) ? ASK_MARKABLE : askRefused('past-window');
  const reached = row.reachedOperatorAt !== null;
  switch (row.state) {
    case 'released': case 'declined': return shown(row.releasedAt, true);
    case 'answering': return reached ? shown(row.releasedAt, true) : askRefused('not-shown');
    case 'answered': return reached || row.answeredBy === ASK_OPERATOR_PRINCIPAL ? shown(row.answeredAt, false) : askRefused('not-shown');
    case 'stale': return reached ? shown(row.releasedAt, false) : askRefused('not-shown');
    case 'held': return askRefused('not-shown');
    default: return askRefused('not-listed');
  }
}
const ASK_MARKABLE: Markable = { markable: true };
const askRefused = (reason: NotMarkableReason): Markable => ({ markable: false, reason });

/** Whether an ask is live, from the live-ask port's answer for its child (`ports.ts#LiveAskAnswer`, read structurally so this
 *  file imports no port): the ask's own key is live, another key or none is not, and `unmeasured` stays `'unmeasured'`. Ask it
 *  only for a `released`, `declined` or `answering` ask that is its child's newest row: the port speaks for no other. */
export const askLiveOf = (read: { kind: 'unmeasured' } | { kind: 'read'; key: string | null }, askKey: string): boolean | 'unmeasured' =>
  read.kind === 'unmeasured' ? 'unmeasured' : read.key === askKey;

/** The waiting view's two ask lists from the listed asks and their marks' read: each row with both marks, the live ones in
 *  `asks` (their boxes sit on the child's question row) and every other in `asksCleared` (a row of Recently cleared). */
export function askListsView<T extends { readonly id: number; readonly live: boolean | 'unmeasured' }>(
  rows: readonly T[], readOf: (id: number) => ItemMarkRead,
): { asks: (T & { answerMarks: AnswerMarksView })[]; asksCleared: (T & { answerMarks: AnswerMarksView })[] } {
  const marked = rows.map((r) => ({ ...r, answerMarks: rowMarksView(readOf(r.id)) }));
  return { asks: marked.filter((r) => r.live === true), asksCleared: marked.filter((r) => r.live !== true) };
}
