// Programme ledgers (plan PL2): the SQL behind `CoordStore`'s item, history, modification and spec-pin methods.
//
// It sits beside `store.ts` in the same ring and context (Coordination), because it is that file's body moved out. Every
// function takes the store's `DatabaseSync` and is synchronous, like the store: there is no repository or async wrapper
// over `CoordStore`. `CoordStore` keeps the public
// methods as one-line delegates, so a caller still says `coord.moveItem(...)`; this file exists so the god-file `store.ts`
// does not take the SQL (ARCH-01, `growth-check`).
//
// Everything here is keyed on the programme's SLUG (spec §3.4). The moves are decided by `nextItemState` in
// `shared/ledgers.ts` and by nothing in this file: `moveItemInTx` is THE ONLY WRITER of `operator_items.state`.
import type { DatabaseSync } from 'node:sqlite';
import { TERMINAL_RUN_STATES, type MailDeliveryState, type StuckReason } from '../../../shared/api.js';
import {
  CLEARED_WINDOW_MS, ITEM_KINDS, actionAdmits, NEEDED_BY_LEVELS, OPEN_ITEM_STATES, doneWhenOf, isCloseRefusedAction, isEndRunAction, isReleaseReviewAction,
  RELEASE_REVIEW_VERB, goalRatification, modificationSource, nextItemState, operatorShownAt, parseItemAction, parseRatifiedBy, pinSource, ratifiedByText, recommendationOf,
  type GoalsView, type ItemAct, type ItemAction, type ItemActor, type ItemEventAct, type ItemKind, type ItemMoveRefusal, type ItemState,
  type GoalsVersion, type NeededBy, type Ratification, type RatifiedBy, type WrittenSource,
} from '../../../shared/ledgers.js';
import { tx } from './tx.js';

/** An operator item as the store holds it (migration 37). `how` and `options` are parsed from their JSON columns. */
export interface ItemRow {
  id: number; program: string; runId: number | null; raisedBy: string; kind: ItemKind; title: string; why: string;
  how: string[]; options: string[] | null; neededBy: NeededBy; soonLabel: string | null; secretSlot: string | null;
  state: ItemState; answer: string | null; note: string | null; raisedAt: number; tickedAt: number | null; closedAt: number | null;
  /** A decide item's recommended option and why (plan PL9); NULL for every other kind and for an item raised before it. */
  recommended: number | null; recommendedWhy: string | null;
  /** The typed action the server wrote for the item (spec §10), NULL for every ordinary item. */
  action: ItemAction | null;
  /** Before this time `itemsFor` leaves the item out (the coordinator-first hold, A21); NULL when it is not held. */
  heldUntil: number | null;
  /** The row's revision (Overlord W2): raised by each move, 0 at the raise; bookkeeping writes leave it. */
  revision: number;
}
/** One move of one item. `act` is an `ItemAct` or `raise`, `block`, `unblock`. */
export interface ItemEventRow {
  id: number; itemId: number; at: number; act: ItemEventAct; actor: ItemActor; note: string | null;
}
/** `moveItem`'s answer: the moved item, or the refusal word (`nextItemState`'s three, or `unknown-item`). */
export type ItemMoveResult =
  | { ok: true; item: ItemRow }
  | { ok: false; why: ItemMoveRefusal };
/** What the coordinator gives when it raises an item. The recommendation (plan PL9) is optional in the type and stored NULL
 *  when it is left out: a decide item must carry one `recommendationOf` can read (`raiseItem` throws otherwise), and the route
 *  (`parseRaise`) refuses it in words before then, and refuses it on any other kind. */
export interface RaiseItemInput {
  program: string; runId: number | null; raisedBy: string; kind: ItemKind; title: string; why: string;
  how: string[]; options: string[] | null; neededBy: NeededBy; soonLabel: string | null; secretSlot: string | null;
  recommended?: number | null; recommendedWhy?: string | null;
  /** Written by a server caller alone: `parseRaise` carries neither, so a coordinator cannot attach an action (spec §10). */
  action?: ItemAction | null; heldUntil?: number | null;
}
/** The table's row before the JSON columns are parsed. */
type ItemRowRaw = Omit<ItemRow, 'how' | 'options' | 'action'> & { how: string; options: string | null; action: string | null };

const ITEM_COLS =
  'id, program, runId, raisedBy, kind, title, why, how, options, neededBy, soonLabel, secretSlot, state, answer, note, ' +
  'raisedAt, tickedAt, closedAt, recommended, recommendedWhy, action, heldUntil, revision';

/** The row's JSON `string[]` columns are written by `raiseItem` alone, from a typed array, so a value that does not
 *  parse as one is a corrupt file, not a distinction to fold: it throws, naming the item, rather than reading as an
 *  empty list. */
function itemRowOf(r: ItemRowRaw): ItemRow {
  const list = (text: string, col: string): string[] => {
    const v: unknown = JSON.parse(text);
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error(`operator item ${r.id}: ${col} is not a string list`);
    return v as string[];
  };
  return {
    id: r.id, program: r.program, runId: r.runId, raisedBy: r.raisedBy, kind: r.kind, title: r.title,
    why: r.why, how: list(r.how, 'how'), options: r.options === null ? null : list(r.options, 'options'),
    neededBy: r.neededBy, soonLabel: r.soonLabel, secretSlot: r.secretSlot, state: r.state,
    answer: r.answer, note: r.note, raisedAt: r.raisedAt, tickedAt: r.tickedAt, closedAt: r.closedAt,
    recommended: r.recommended, recommendedWhy: r.recommendedWhy,
    action: r.action === null ? null : actionOf(r.id, r.action), heldUntil: r.heldUntil, revision: r.revision,
  };
}

/** The `action` column, parsed. A verb this build does not understand (a newer build's row after a rollback) reads as no
 *  action: the item has no controls here and is an ordinary item, rather than taking every reader down. */
function actionOf(_id: number, text: string): ItemAction | null {
  return parseItemAction(text);
}

/** One `operator_item_events` row. Callers hold the transaction. */
function writeItemEvent(db: DatabaseSync, itemId: number, at: number, act: ItemEventRow['act'], actor: ItemActor, note: string | null): void {
  db.prepare('INSERT INTO operator_item_events (itemId, at, act, actor, note) VALUES (?, ?, ?, ?, ?)').run(itemId, at, act, actor, note);
}

/** The coordinator raises an item: open, with its `raise` event, in one transaction. The kind and the needed-by level
 *  must be in L0's vocabulary (the route has already bounded the text; this stops an out-of-vocabulary word reaching a
 *  column no SQL check guards) and throw otherwise. So does a decide item without a recommendation the one reader
 *  (`recommendationOf`) can read (plan PL9): no caller can store a decide row the view would show without one. Returns the
 *  new id. `actor` is who the `raise` event names: the coordinator for its own item, `ccrc` for one the server wrote on
 *  another session's behalf (A18). */
export function raiseItem(
  db: DatabaseSync, input: RaiseItemInput, now: number, actor: 'coordinator' | 'ccrc' = 'coordinator', reach?: ItemReach,
): number {
  checkRaise(input);
  return tx(db, () => raiseItemInTx(db, input, now, actor, reach));
}

/** `raiseItem`'s in-transaction form, for a caller that already holds the transaction (programme lifecycle W2: the end
 *  proposal raises its item with its programme event in one transaction; the invariant monitor's finding writes its row in the
 *  same one): `checkRaise` first, then the insert, so `operator_items` keeps its one writer behind three
 *  checked entries. A refused input throws `RangeError` inside the caller's `tx()`, which rolls it back. Its settle is
 *  `settleItemCheckedInTx`. */
export function raiseItemCheckedInTx(
  db: DatabaseSync, input: RaiseItemInput, now: number, actor: 'coordinator' | 'ccrc', reach?: ItemReach,
): number {
  if (!db.isTransaction) throw new Error('raiseItemCheckedInTx: no transaction is open');
  checkRaise(input);
  return raiseItemInTx(db, input, now, actor, reach);
}

/** The push outbox's write beside a raise (Overlord W1, `pushOutboxStore.ts#reachInTx`), handed in by `CoordStore` so this
 *  file imports no outbox code: called inside the raise's transaction, with the new id, only for an item the operator is
 *  shown at its raise (`operatorWasShown`, the hold's one rule); a held item's reach is the held drain's (I2). */
export type ItemReach = (id: number) => void;

/** `raiseItem`'s vocabulary checks, thrown before any transaction opens. */
function checkRaise(input: RaiseItemInput): void {
  if (!ITEM_KINDS.includes(input.kind)) throw new RangeError(`raiseItem: kind ${String(input.kind)} is not an item kind`);
  if (!NEEDED_BY_LEVELS.includes(input.neededBy)) throw new RangeError(`raiseItem: neededBy ${String(input.neededBy)} is not a level`);
  if (input.kind === 'decide' && recommendationOf(input) === null) {
    throw new RangeError('raiseItem: a decide item needs a recommended option and the reason it beats the others');
  }
}

/** The insert and its `raise` event, inside a transaction the CALLER holds (`tx` does not nest). */
function raiseItemInTx(db: DatabaseSync, input: RaiseItemInput, now: number, actor: 'coordinator' | 'ccrc', reach?: ItemReach): number {
  const res = db.prepare(
    'INSERT INTO operator_items (program, runId, raisedBy, kind, title, why, how, options, neededBy, soonLabel, ' +
    "secretSlot, state, raisedAt, recommended, recommendedWhy, action, heldUntil) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)",
  ).run(input.program, input.runId, input.raisedBy, input.kind, input.title, input.why, JSON.stringify(input.how),
    input.options === null ? null : JSON.stringify(input.options), input.neededBy, input.soonLabel, input.secretSlot, now,
    input.recommended ?? null, input.recommendedWhy ?? null,
    input.action === undefined || input.action === null ? null : JSON.stringify(input.action), input.heldUntil ?? null);
  const id = Number(res.lastInsertRowid);
  writeItemEvent(db, id, now, 'raise', actor, null);
  if (reach !== undefined && operatorWasShown({ heldUntil: input.heldUntil ?? null, closedAt: null, raisedAt: now }, now)) reach(id);
  return id;
}

/** `raiseItem` and a mail in ONE transaction (the pattern of `tickWithMail`): `queue` gets the new id and inserts the system
 *  mail; a throw from it rolls the item back. `queue` must open no transaction of its own. */
export function raiseItemWithMail<T>(
  db: DatabaseSync, input: RaiseItemInput, now: number, actor: 'coordinator' | 'ccrc', queue: (id: number) => T, reach?: ItemReach,
): { id: number; mail: T } {
  checkRaise(input);
  return tx(db, () => { const id = raiseItemInTx(db, input, now, actor, reach); return { id, mail: queue(id) }; });
}

export function itemById(db: DatabaseSync, id: number): ItemRow | null {
  const r = db.prepare(`SELECT ${ITEM_COLS} FROM operator_items WHERE id = ?`).get(id) as ItemRowRaw | undefined;
  return r === undefined ? null : itemRowOf(r);
}

/** The items still waiting (`open`, `checking`; oldest first; an item whose `heldUntil` is in the future is left out: the one
 *  filter of the hold, A21, so every reader of this function agrees) and the ones cleared inside the Recently-cleared window
 *  (`done` with `closedAt` no older than `CLEARED_WINDOW_MS`, newest first). `program === null` means every programme.
 *  Withdrawn and dismissed items appear in neither list, nor does an item its coordinator settled inside the hold (`closedAt`
 *  before `heldUntil`): the operator was never asked, so the trail does not show it. */
export function itemsFor(db: DatabaseSync, program: string | null, now: number): { open: ItemRow[]; cleared: ItemRow[] } {
  const scope = program === null ? '' : ' AND program = ?';
  const args = (extra: (string | number)[]): (string | number)[] => (program === null ? extra : [...extra, program]);
  const openStates = OPEN_ITEM_STATES.map((st) => `'${st}'`).join(', ');
  const open = db.prepare(
    `SELECT ${ITEM_COLS} FROM operator_items WHERE state IN (${openStates}) AND (heldUntil IS NULL OR heldUntil <= ?)${scope} ORDER BY raisedAt, id`,
  ).all(...args([now])) as unknown as ItemRowRaw[];
  const cleared = db.prepare(
    `SELECT ${ITEM_COLS} FROM operator_items WHERE state = 'done' AND closedAt >= ? AND (heldUntil IS NULL OR closedAt >= heldUntil)${scope} ORDER BY closedAt DESC, id DESC`,
  ).all(...args([now - CLEARED_WINDOW_MS])) as unknown as ItemRowRaw[];
  return { open: open.map(itemRowOf), cleared: cleared.map(itemRowOf) };
}

/** Whether the operator was ever shown an item (D-8194), the hold rule `itemsFor` filters by, for one row read by its id: an
 *  item still held (`heldUntil` in the future) is not, nor is one its coordinator settled inside the hold (closed before
 *  `heldUntil`); every other item is, whatever its state and however long ago it closed. The rule is
 *  `shared/ledgers.ts#operatorShownAt`'s, which the portfolio reads too. */
export function operatorWasShown(row: Pick<ItemRow, 'raisedAt' | 'heldUntil' | 'closedAt'>, now: number): boolean {
  const shownAt = operatorShownAt(row);
  return shownAt !== null && shownAt <= now;
}

/** One move, inside a transaction the CALLER holds. The decider is `nextItemState`; this reads the row, asks it, and
 *  writes the state, the timestamps and one event, or writes nothing and answers its word. THE ONLY WRITER of
 *  `operator_items.state`. `fields.answer` is kept on a tick; `fields.note` is kept on the row only for a return (the
 *  coordinator's note) and is recorded on the event for every act. */
export function moveItemInTx(
  db: DatabaseSync, id: number, act: ItemAct, actor: ItemActor, fields: { answer?: string | null; note?: string | null },
  now: number, ctx: { programmeHasOpenRun: boolean },
): ItemMoveResult {
  const row = itemById(db, id);
  if (row === null) return { ok: false, why: 'unknown-item' };
  const verdict = nextItemState(row.state, act, actor, ctx);
  if (!verdict.ok) return verdict;
  // What an item's action admits is `actionAdmits`'s (A-1): a tick, confirm or return would strand it, and a drift item is not dismissed.
  if (!actionAdmits(row.action, act)) return { ok: false, why: 'not-open' };
  const closes = verdict.to === 'done' || verdict.to === 'withdrawn' || verdict.to === 'dismissed';
  const answer = act === 'tick' && fields.answer !== undefined ? fields.answer : row.answer;
  const note = act === 'return' && fields.note !== undefined ? fields.note : row.note;
  db.prepare('UPDATE operator_items SET state = ?, tickedAt = ?, closedAt = ?, answer = ?, note = ?, revision = revision + 1 WHERE id = ?')
    .run(verdict.to, act === 'tick' ? now : row.tickedAt, closes ? now : null, answer, note, id);
  writeItemEvent(db, id, now, act, actor, fields.note ?? null);
  return { ok: true, item: itemById(db, id) as ItemRow };
}

/** A move of one item, atomic with its event. See `moveItemInTx`. */
export function moveItem(
  db: DatabaseSync, id: number, act: ItemAct, actor: ItemActor, fields: { answer?: string | null; note?: string | null },
  now: number, ctx: { programmeHasOpenRun: boolean },
): ItemMoveResult {
  return tx(db, () => moveItemInTx(db, id, act, actor, fields, now, ctx));
}

/** The operator's tick and the mail it queues, in ONE transaction (the pattern of `correctWithMail`): the move runs,
 *  then `queue` gets the moved item and inserts the system mail. A throw from `queue` rolls the move back, so a ticked
 *  item always has its mail and a failed mail leaves the item open. A refused tick never calls `queue`. `queue` must
 *  open no transaction of its own: `tx` does not nest (`insertSystemMailTx` is the shape, as for `correctWithMail`). */
export function tickWithMail<T>(db: DatabaseSync, id: number, answer: string | null, now: number, queue: (item: ItemRow) => T):
  { ok: true; item: ItemRow; mail: T } | Extract<ItemMoveResult, { ok: false }> {
  return tx(db, () => {
    // A tick ignores the programme context (`nextItemState`), so none is asked for.
    const moved = moveItemInTx(db, id, 'tick', 'operator', { answer }, now, { programmeHasOpenRun: false });
    if (!moved.ok) return moved;
    return { ok: true, item: moved.item, mail: queue(moved.item) };
  });
}

/** A move of one item and a mail in ONE transaction, for a move that tells somebody (the end request's withdraw and decline,
 *  A22). `queue` gets the moved item and inserts the system mail; a refused move never calls it, and a throw from it rolls
 *  the move back. `queue` must open no transaction of its own. */
export function moveItemWithMail<T>(
  db: DatabaseSync, id: number, act: ItemAct, actor: ItemActor, fields: { answer?: string | null; note?: string | null },
  now: number, ctx: { programmeHasOpenRun: boolean }, queue: (item: ItemRow) => T,
): { ok: true; item: ItemRow; mail: T } | Extract<ItemMoveResult, { ok: false }> {
  return tx(db, () => {
    const moved = moveItemInTx(db, id, act, actor, fields, now, ctx);
    if (!moved.ok) return moved;
    return { ok: true, item: moved.item, mail: queue(moved.item) };
  });
}

/** The end-request items of a run that still wait (`open` or `checking`), held or not, oldest first. Raw: the hold is
 *  `itemsFor`'s filter alone, so a withdraw and a settle still reach a held item. */
export function openEndRequestsOf(db: DatabaseSync, runId: number): ItemRow[] {
  const states = OPEN_ITEM_STATES.map((st) => `'${st}'`).join(', ');
  return (db.prepare(
    `SELECT ${ITEM_COLS} FROM operator_items WHERE runId = ? AND action IS NOT NULL AND state IN (${states}) ORDER BY id`,
  ).all(runId) as unknown as ItemRowRaw[]).map(itemRowOf).filter((i) => isEndRunAction(i.action));
}

/** Every item of a run that carries an action (an end request or a refused close) and still waits, held or not, oldest first.
 *  A run that starts or ends handles all of them. */
export function openActionItemsOf(db: DatabaseSync, runId: number): ItemRow[] {
  const states = OPEN_ITEM_STATES.map((st) => `'${st}'`).join(', ');
  return (db.prepare(
    `SELECT ${ITEM_COLS} FROM operator_items WHERE runId = ? AND action IS NOT NULL AND state IN (${states}) ORDER BY id`,
  ).all(runId) as unknown as ItemRowRaw[]).map(itemRowOf).filter((i) => i.action !== null);
}

/** The refused-close items that still wait, held or not, oldest first: the lane re-measures them each pass (`settle`). */
export function openCloseRefusedItems(db: DatabaseSync): ItemRow[] {
  const states = OPEN_ITEM_STATES.map((st) => `'${st}'`).join(', ');
  return (db.prepare(
    `SELECT ${ITEM_COLS} FROM operator_items WHERE action IS NOT NULL AND state IN (${states}) ORDER BY id`,
  ).all() as unknown as ItemRowRaw[]).map(itemRowOf).filter((i) => isCloseRefusedAction(i.action));
}

/** D-8293: the release-review items that still wait, held or not, oldest first: the sweep re-measures them each judging pass
 *  (`settle`). */
export function openReleaseReviewItems(db: DatabaseSync): ItemRow[] {
  const states = OPEN_ITEM_STATES.map((st) => `'${st}'`).join(', ');
  return (db.prepare(
    `SELECT ${ITEM_COLS} FROM operator_items WHERE action IS NOT NULL AND state IN (${states}) ORDER BY id`,
  ).all() as unknown as ItemRowRaw[]).map(itemRowOf).filter((i) => isReleaseReviewAction(i.action));
}

/** The release-review item rows of one review run, in any state, matched by the action's own `reviewRunId`. */
const RELEASE_REVIEW_OF =
  "FROM operator_items i WHERE i.action IS NOT NULL AND json_extract(i.action, '$.verb') = ? "
  + "AND json_extract(i.action, '$.reviewRunId') = ?";

/** D-8293: has a release-review item EVER been raised for this review run, in any state? The sweep raises one per review run
 *  and never again: a coordinator that withdrew it still cites the report, and an item the operator acted on has released it. */
export function releaseReviewItemRaised(db: DatabaseSync, reviewRunId: number): boolean {
  return db.prepare(`SELECT 1 AS x ${RELEASE_REVIEW_OF} LIMIT 1`).get(RELEASE_REVIEW_VERB, reviewRunId) !== undefined;
}

/** Has an item with this exact title ever been raised on this programme by this raiser, in any state? The weekly replay quiz
 *  lane (Overlord W1a, `continuity/quizLane.ts`) raises one item a week, named by its week, and never again that week: an item
 *  the operator dismissed or ticked is not raised a second time. */
export function itemRaisedWithTitle(db: DatabaseSync, program: string, raisedBy: string, title: string): boolean {
  return db.prepare('SELECT 1 AS x FROM operator_items WHERE program = ? AND raisedBy = ? AND title = ? LIMIT 1')
    .get(program, raisedBy, title) !== undefined;
}

/** D-8293: has the operator released this review run's report? True only for a release-review item of it that the operator's
 *  `act` moved to `done` (`moveItemInTx`, the one writer, records the act's event); an item ccrc settled is no release. This is
 *  the one read of the fact: the child reclaim sweep stops keeping the review's workspace for the run it reviewed. */
export function reviewChildReleased(db: DatabaseSync, reviewRunId: number): boolean {
  return db.prepare(
    `SELECT 1 AS x ${RELEASE_REVIEW_OF} AND i.state = 'done' `
    + "AND EXISTS (SELECT 1 FROM operator_item_events e WHERE e.itemId = i.id AND e.act = 'act' AND e.actor = 'operator') LIMIT 1",
  ).get(RELEASE_REVIEW_VERB, reviewRunId) !== undefined;
}

/** The newest end request of a run raised BY THIS ASKER that ended in a decline or a withdraw: who asked, when it ended and
 *  the reason it was raised under (A24). Scoped to the asker, so two parties to one run taking turns cannot hide each
 *  other's ended request from the repeat rule. An item settled `done` is not one. */
export function lastEndedEndRequest(db: DatabaseSync, runId: number, askerId: string): { askerId: string; at: number; stuckReason: StuckReason | null } | null {
  const rows = db.prepare(
    `SELECT ${ITEM_COLS} FROM operator_items WHERE runId = ? AND raisedBy = ? AND action IS NOT NULL AND state IN ('withdrawn', 'dismissed') ` +
    'ORDER BY closedAt DESC, id DESC',
  ).all(runId, askerId) as unknown as ItemRowRaw[];
  for (const r of rows) {
    const item = itemRowOf(r);
    if (isEndRunAction(item.action) && item.closedAt !== null) {
      return { askerId: item.raisedBy, at: item.closedAt, stuckReason: item.action.stuckReason };
    }
  }
  return null;
}

/** The sessions of the review runs of a run (any state), each once: the workers who may ask to end the run they review. */
export function reviewWorkersOf(db: DatabaseSync, runId: number): string[] {
  const rows = db.prepare("SELECT DISTINCT sessionId FROM runs WHERE kind = 'review' AND reviews = ? AND sessionId IS NOT NULL ORDER BY id")
    .all(runId) as unknown as { sessionId: string }[];
  return rows.map((r) => r.sessionId);
}

/** A run started or ended, so its open end requests are handled: each moves `settle` (ccrc, open or checking to done) with
 *  `note`, inside the transaction the CALLER holds. The move is `moveItemInTx`'s, the only writer of the state. */
export function settleEndRequestsInTx(db: DatabaseSync, runId: number, note: string, now: number): number {
  let settled = 0;
  for (const item of openActionItemsOf(db, runId)) {
    const res = moveItemInTx(db, item.id, 'settle', 'ccrc', { note }, now, { programmeHasOpenRun: true });
    if (res.ok) settled += 1;
  }
  return settled;
}

/** A server-raised item's cause cleared, so the item moves `settle` (ccrc, open or checking to done) with `note`, inside a
 *  transaction the CALLER holds (the Overlord readiness lane stamps its record in the same one). The settle beside
 *  `raiseItemCheckedInTx`: it throws when no transaction is open, and the move is `moveItemInTx`'s, the only writer of the
 *  state, so a dismissed or done item answers its refusal and nothing is written. */
export function settleItemCheckedInTx(db: DatabaseSync, id: number, note: string, now: number): ItemMoveResult {
  if (!db.isTransaction) throw new Error('settleItemCheckedInTx: no transaction is open');
  return moveItemInTx(db, id, 'settle', 'ccrc', { note }, now, { programmeHasOpenRun: true });
}

/** The mend for a death between the operator's act and its item (spec 2026-11-04 §10, "The act", step 3): the abandon committed
 *  with `abandon:requested:<item>`, which the run's own transition leaves to the act, and the server died before the item moved.
 *  Every open end-request item whose run is already closed moves `settle` (ccrc) with `note`, each in its own transaction. Run
 *  from the waiting read, so the item is gone within one read. The move is `moveItemInTx`'s, the only writer of the state. */
export function settleEndRequestsOfClosedRuns(db: DatabaseSync, note: string, now: number): number {
  const states = OPEN_ITEM_STATES.map((st) => `'${st}'`).join(', ');
  const closed = TERMINAL_RUN_STATES.map((st) => `'${st}'`).join(', ');
  const ids = db.prepare(
    `SELECT i.id AS id FROM operator_items i JOIN runs r ON r.id = i.runId WHERE i.action IS NOT NULL AND i.state IN (${states}) ` +
    `AND r.state IN (${closed}) ORDER BY i.id`,
  ).all() as unknown as { id: number }[];
  let settled = 0;
  for (const { id } of ids) {
    const res = tx(db, () => {
      const item = itemById(db, id);
      if (item === null || item.action === null) return null;
      return moveItemInTx(db, id, 'settle', 'ccrc', { note }, now, { programmeHasOpenRun: true });
    });
    if (res?.ok === true) settled += 1;
  }
  return settled;
}

/** The coordinator marks an item blocking (work has stopped on it) or lowers it. Raising records the level it replaced
 *  as the `block` event's note; lowering restores that level, and an item that was RAISED blocking (no earlier level on
 *  record) falls back to `soon` when it carries a label and `later` when it does not. A repeat of the level it already
 *  has writes nothing and answers `changed: false`: the one place that says whether the level moved. It writes `neededBy` and an event and never `state`. */
export function setBlocking(db: DatabaseSync, id: number, blocking: boolean, now: number, arm?: ItemReach):
  { ok: true; changed: boolean } | { ok: false; why: Extract<ItemMoveRefusal, 'unknown-item' | 'not-open'> } {
  return tx(db, () => {
    const row = itemById(db, id);
    if (row === null) return { ok: false, why: 'unknown-item' } as const;
    if (!OPEN_ITEM_STATES.includes(row.state)) return { ok: false, why: 'not-open' } as const;
    if ((row.neededBy === 'blocking') === blocking) return { ok: true, changed: false } as const;
    let next: NeededBy = 'blocking';
    if (!blocking) {
      const last = db.prepare("SELECT note FROM operator_item_events WHERE itemId = ? AND act = 'block' ORDER BY id DESC LIMIT 1")
        .get(id) as { note: string | null } | undefined;
      const kept = last?.note;
      next = kept === 'soon' || kept === 'later' ? kept : (row.soonLabel === null ? 'later' : 'soon');
    }
    db.prepare('UPDATE operator_items SET neededBy = ? WHERE id = ?').run(next, id);
    writeItemEvent(db, id, now, blocking ? 'block' : 'unblock', 'coordinator', blocking ? row.neededBy : null);
    // The push outbox's arm (slug rearm-is-an-upsert): a move to blocking arms the item's one row in this transaction.
    if (blocking) arm?.(id);
    return { ok: true, changed: true } as const;
  });
}

/** An item's moves, oldest first. */
export function itemHistory(db: DatabaseSync, id: number): ItemEventRow[] {
  return db.prepare('SELECT id, itemId, at, act, actor, note FROM operator_item_events WHERE itemId = ? ORDER BY id')
    .all(id) as unknown as ItemEventRow[];
}

/** Pins a spec to a programme with the copy of its "In short" (spec §4). The route has checked the path (`isSpecPath`),
 *  the length, and that the caller claims the programme; a slug with no programme row changes nothing. `doneWhen` is the
 *  programme's definition of done (D-8126): a list replaces the stored one, `null` leaves a stored list as it is (a
 *  re-pin without one keeps it). `source` is what the pin rests on (Overlord W1, portfolio B), written with the text, so a
 *  re-pin replaces the pin's source with its own: new text is never ratified by an older act; it is never the operator's,
 *  whose only writer is `ratifyGoalsVersion` (review 2240 F6), and it clears the act's device (`ratifiedActor`, F7). A list
 *  whose text differs from the stored one names the pin as its version (`doneWhenBy`); the same list, or none, keeps the
 *  list's provenance (review 2240 F9). One statement: SQLite reads every right-hand side from the row before the update.
 *  Required, so every caller is visited. */
export function setSpecPin(
  db: DatabaseSync, program: string, specPath: string, inShort: string, now: number, doneWhen: readonly string[] | null,
  source: WrittenSource,
): void {
  if (doneWhen === null) {
    db.prepare('UPDATE programs SET specPath = ?, inShort = ?, inShortAt = ?, ratifiedBy = ?, ratifiedAt = ?, ratifiedActor = NULL WHERE slug = ?')
      .run(specPath, inShort, now, ratifiedByText(source), now, program);
    return;
  }
  const list = JSON.stringify(doneWhen);
  // One literal, so the writers census (`writers-map.test.ts`) sees every column this statement writes.
  db.prepare("UPDATE programs SET specPath = ?, inShort = ?, inShortAt = ?, ratifiedBy = ?, ratifiedAt = ?, ratifiedActor = NULL, doneWhenBy = CASE WHEN doneWhen IS ? THEN doneWhenBy ELSE 'pin' END, doneWhen = ? WHERE slug = ?")
    .run(specPath, inShort, now, ratifiedByText(source), now, list, list, program);
}

/** Replaces the programme's definition of done (D-8126), the modification route's writer, naming modification `modId` as
 *  the version that wrote it (`doneWhenBy`, in the same statement). The caller has shaped the list (`doneWhenOf`) and
 *  checked ownership; a slug with no programme row changes nothing. `now` is the caller's clock, kept for the signature's
 *  symmetry with the other writers; the column carries no time of its own. */
export function setDoneWhen(db: DatabaseSync, program: string, doneWhen: readonly string[], _now: number, modId: number): void {
  db.prepare('UPDATE programs SET doneWhen = ?, doneWhenBy = ? WHERE slug = ?').run(JSON.stringify(doneWhen), `mod:${modId}`, program);
}

/** Records one change since approval, with what it rests on, derived here from the row's own `itemId`
 *  (`modificationSource`: the cited item, else the coordinator that wrote it; review 2240 F6); `mergedAt` stays NULL until
 *  `markModificationsMerged`. Returns the id. */
export function addModification(
  db: DatabaseSync, program: string, m: { text: string; ruling: string | null; itemId: number | null; pr: number | null; doneWhen?: readonly string[] | null },
  now: number,
): number {
  const insert = (): number => {
    const res = db.prepare('INSERT INTO programme_modifications (program, at, text, ruling, itemId, pr, ratifiedBy, ratifiedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(program, now, m.text, m.ruling, m.itemId, m.pr, ratifiedByText(modificationSource(m.itemId)), now);
    return Number(res.lastInsertRowid);
  };
  if (m.doneWhen === undefined || m.doneWhen === null) return insert();
  const doneWhen = m.doneWhen;
  // D-8126: the row and the new list are one act; `setDoneWhen` is the list's writer.
  return tx(db, () => { const id = insert(); setDoneWhen(db, program, doneWhen, now, id); return id; });
}

/** The spec PR merged: marks this programme's still-pending modifications of that PR, once (a marked one keeps its first
 *  time). Returns how many it marked. */
export function markModificationsMerged(db: DatabaseSync, program: string, pr: number, mergedAt: number): number {
  const res = db.prepare('UPDATE programme_modifications SET mergedAt = ? WHERE program = ? AND pr = ? AND mergedAt IS NULL')
    .run(mergedAt, program, pr);
  return Number(res.changes);
}

/** A stored definition of done read back: the parsed list when it passes `doneWhenOf`, else null (absence permits). */
function storedDoneWhen(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const r = doneWhenOf(JSON.parse(raw));
    return r.ok ? r.doneWhen : null;
  } catch {
    return null;
  }
}

type PinRow = { specPath: string | null; inShort: string | null; inShortAt: number | null; doneWhen: string | null; ratifiedBy: string | null; ratifiedAt: number | null; doneWhenBy: string | null };
type ModRow = {
  id: number; at: number; text: string; ruling: string | null; itemId: number | null; pr: number | null; mergedAt: number | null;
  ratifiedBy: string | null; iProgram: string | null; iState: string | null; iTickedAt: number | null;
};
const PIN_SQL = 'SELECT specPath, inShort, inShortAt, doneWhen, ratifiedBy, ratifiedAt, doneWhenBy FROM programs WHERE slug = ?';
/** Each modification with the item it cites, joined by the row's own `itemId` (never a copy of the item). */
const MODS_SQL = 'SELECT m.id, m.at, m.text, m.ruling, m.itemId, m.pr, m.mergedAt, m.ratifiedBy, i.program AS iProgram, ' +
  'i.state AS iState, i.tickedAt AS iTickedAt FROM programme_modifications m LEFT JOIN operator_items i ON i.id = m.itemId';

const modVerdict = (m: ModRow, program: string): Ratification => goalRatification(parseRatifiedBy(m.ratifiedBy),
  m.iProgram === null || m.iState === null ? null : { program: m.iProgram, state: m.iState, tickedAt: m.iTickedAt }, program, 'modification');
/** The pin's source counts only when stamped at or after its text (`pinSource`, review 2240 F2). */
const pinVerdict = (pin: PinRow | undefined, program: string): Ratification =>
  goalRatification(pinSource(pin?.ratifiedBy ?? null, pin?.ratifiedAt ?? null, pin?.inShortAt ?? null), null, program, 'pin');

/** What Goals shows for one programme: the pin, its In short copy and the modifications, newest first, each with its
 *  verdict (`goalRatification`, computed here at every read and never stored), and the verdict of the version that wrote
 *  the definition of done (`doneWhenBy`: `pin` takes the pin's, `mod:<id>` that row's, NULL `unrecorded`, any other text
 *  `unreadable`). A programme with no pin (or no row) reads null fields and, if it has none, an empty list. */
export function goalsFor(db: DatabaseSync, program: string): GoalsView {
  const pin = db.prepare(PIN_SQL).get(program) as PinRow | undefined;
  const mods = db.prepare(`${MODS_SQL} WHERE m.program = ? ORDER BY m.at DESC, m.id DESC`).all(program) as unknown as ModRow[];
  const verdicts = new Map(mods.map((m) => [m.id, modVerdict(m, program)] as const));
  const pinRatification = pinVerdict(pin, program);
  const by = pin?.doneWhenBy ?? null;
  const modOf = by === null ? null : /^mod:([1-9][0-9]*)$/.exec(by);
  const modId = modOf !== null && verdicts.has(Number(modOf[1])) ? Number(modOf[1]) : null;
  const pinAt = pin?.inShortAt ?? null;
  // Which version wrote the list (review 2240 F4), so the console shows it beside that version's control; the verdict of an
  // unrecorded or unreadable writer reads the same whichever version kind is named.
  const doneWhenVersion: GoalsVersion | null = by === 'pin' && pinAt !== null ? { pin: { inShortAt: pinAt } }
    : modId !== null ? { modification: modId } : null;
  const doneWhenRatification = by === null ? goalRatification('unrecorded', null, program, 'pin')
    : by === 'pin' ? pinRatification
      : modId !== null ? verdicts.get(modId)! : goalRatification('unreadable', null, program, 'pin');
  return {
    program, specPath: pin?.specPath ?? null, inShort: pin?.inShort ?? null, inShortAt: pin?.inShortAt ?? null,
    doneWhen: storedDoneWhen(pin?.doneWhen ?? null),
    modifications: mods.map((m) => ({
      id: m.id, at: m.at, text: m.text, ruling: m.ruling, itemId: m.itemId, pr: m.pr, merged: m.mergedAt !== null, ratification: verdicts.get(m.id)!,
    })),
    pinRatification, doneWhenRatification, doneWhenVersion,
  };
}

/** `unknown`: no pin, or no such modification of this programme (the door's `not-found`); `stale`: the pin's stamp moved
 *  (the door's `goals-changed`), with the stored stamp. */
export type RatifyResult = { ok: true; changed: boolean } | { ok: false; why: 'unknown' } | { ok: false; why: 'stale'; inShortAt: number | null };

const OPERATOR: RatifiedBy = { kind: 'operator' };
/** The operator's ratify act (Overlord W1, portfolio B, question 4): the operator's arm of the columns' writers, in one
 *  transaction. A programme with no pin, or a modification that is not this programme's, is `not-found`; a pin whose stamp
 *  differs from the one shown is `goals-changed`, so text the operator was not shown is never ratified. A version whose
 *  VERDICT already reads ratified (asked of `goalRatification`, never of the source) changes nothing. `actor` is the account
 *  gate's actor (its device label and session hash), kept with the act because it confers authority (review 2240 F7). */
export function ratifyGoalsVersion(db: DatabaseSync, program: string, version: GoalsVersion, now: number, actor: string): RatifyResult {
  return tx(db, (): RatifyResult => {
    if ('pin' in version) {
      const pin = db.prepare(PIN_SQL).get(program) as PinRow | undefined;
      if (pin === undefined || pin.inShort === null) return { ok: false, why: 'unknown' };
      if (pin.inShortAt !== version.pin.inShortAt) return { ok: false, why: 'stale', inShortAt: pin.inShortAt };
      if (pinVerdict(pin, program).ratified) return { ok: true, changed: false };
      db.prepare('UPDATE programs SET ratifiedBy = ?, ratifiedAt = ?, ratifiedActor = ? WHERE slug = ?').run(ratifiedByText(OPERATOR), now, actor, program);
      return { ok: true, changed: true };
    }
    const m = db.prepare(`${MODS_SQL} WHERE m.id = ? AND m.program = ?`).get(version.modification, program) as ModRow | undefined;
    if (m === undefined) return { ok: false, why: 'unknown' };
    if (modVerdict(m, program).ratified) return { ok: true, changed: false };
    db.prepare('UPDATE programme_modifications SET ratifiedBy = ?, ratifiedAt = ?, ratifiedActor = ? WHERE id = ?').run(ratifiedByText(OPERATOR), now, actor, m.id);
    return { ok: true, changed: true };
  });
}

/** The newest tick mail of an item: system mail from `operator` with this subject (`itemMailSubject` names the item's id, so
 *  the subject alone finds it), whatever its run and whoever it was addressed to, with that delivery's state and recipient;
 *  null when none was ever queued. ONE READER for the duplicate guard and the stale label (plan PL4, review 1335 F1, F2): a
 *  run that closed or a coordinator that was replaced since the tick does not hide the mail, and a later tick of a sent-back
 *  item queues a newer mail with the same subject, which is the one read. */
export function newestTickMail(db: DatabaseSync, subject: string): { state: MailDeliveryState; toId: string } | null {
  const r = db.prepare(
    "SELECT d.state AS state, d.toId AS toId FROM mail m JOIN mail_deliveries d ON d.mailId = m.id WHERE m.fromId = 'operator' AND m.subject = ? ORDER BY m.id DESC, d.id DESC LIMIT 1",
  ).get(subject) as { state: MailDeliveryState; toId: string } | undefined;
  return r ?? null;
}

/** Every programme that has a spec pin, in slug order: with the programmes that hold items, the ones the waiting list carries goals for. */
export function pinnedProgrammes(db: DatabaseSync): string[] {
  return (db.prepare('SELECT slug FROM programs WHERE specPath IS NOT NULL ORDER BY slug').all() as { slug: string }[]).map((r) => r.slug);
}

/** Whether the programme has a spec pin (the Goals pin R7 keys on). */
export function isPinned(db: DatabaseSync, program: string): boolean {
  return db.prepare('SELECT 1 AS x FROM programs WHERE slug = ? AND specPath IS NOT NULL LIMIT 1').get(program) !== undefined;
}

/** Whether the programme holds a `blocking` item that waits on the OPERATOR: state `open` only. A `checking` item has been
 *  ticked, so the ball is the coordinator's (`waitingCount` reads the same way; review 2817 R1). The coord-ball rung's and
 *  the idle nudge's `run-blocked-on-operator` hold read it. */
export function programmeHasBlockingItem(db: DatabaseSync, program: string): boolean {
  return db.prepare(
    "SELECT 1 AS x FROM operator_items WHERE program = ? AND neededBy = 'blocking' AND state = 'open' LIMIT 1",
  ).get(program) !== undefined;
}
