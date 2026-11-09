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
  CLEARED_WINDOW_MS, ITEM_KINDS, NEEDED_BY_LEVELS, OPEN_ITEM_STATES, isEndRunAction, nextItemState, parseItemAction, recommendationOf,
  type GoalsView, type ItemAct, type ItemAction, type ItemActor, type ItemKind, type ItemMoveRefusal, type ItemState, type NeededBy,
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
}
/** One move of one item. `act` is an `ItemAct` or `raise`, `block`, `unblock`. */
export interface ItemEventRow {
  id: number; itemId: number; at: number; act: ItemAct | 'raise' | 'block' | 'unblock'; actor: ItemActor; note: string | null;
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
  'raisedAt, tickedAt, closedAt, recommended, recommendedWhy, action, heldUntil';

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
    action: r.action === null ? null : actionOf(r.id, r.action), heldUntil: r.heldUntil,
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
export function raiseItem(db: DatabaseSync, input: RaiseItemInput, now: number, actor: 'coordinator' | 'ccrc' = 'coordinator'): number {
  checkRaise(input);
  return tx(db, () => raiseItemInTx(db, input, now, actor));
}

/** `raiseItem`'s vocabulary checks, thrown before any transaction opens. */
function checkRaise(input: RaiseItemInput): void {
  if (!ITEM_KINDS.includes(input.kind)) throw new RangeError(`raiseItem: kind ${String(input.kind)} is not an item kind`);
  if (!NEEDED_BY_LEVELS.includes(input.neededBy)) throw new RangeError(`raiseItem: neededBy ${String(input.neededBy)} is not a level`);
  if (input.kind === 'decide' && recommendationOf(input) === null) {
    throw new RangeError('raiseItem: a decide item needs a recommended option and the reason it beats the others');
  }
}

/** The insert and its `raise` event, inside a transaction the CALLER holds (`tx` does not nest). */
function raiseItemInTx(db: DatabaseSync, input: RaiseItemInput, now: number, actor: 'coordinator' | 'ccrc'): number {
  const res = db.prepare(
    'INSERT INTO operator_items (program, runId, raisedBy, kind, title, why, how, options, neededBy, soonLabel, ' +
    "secretSlot, state, raisedAt, recommended, recommendedWhy, action, heldUntil) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)",
  ).run(input.program, input.runId, input.raisedBy, input.kind, input.title, input.why, JSON.stringify(input.how),
    input.options === null ? null : JSON.stringify(input.options), input.neededBy, input.soonLabel, input.secretSlot, now,
    input.recommended ?? null, input.recommendedWhy ?? null,
    input.action === undefined || input.action === null ? null : JSON.stringify(input.action), input.heldUntil ?? null);
  const id = Number(res.lastInsertRowid);
  writeItemEvent(db, id, now, 'raise', actor, null);
  return id;
}

/** `raiseItem` and a mail in ONE transaction (the pattern of `tickWithMail`): `queue` gets the new id and inserts the system
 *  mail; a throw from it rolls the item back. `queue` must open no transaction of its own. */
export function raiseItemWithMail<T>(
  db: DatabaseSync, input: RaiseItemInput, now: number, actor: 'coordinator' | 'ccrc', queue: (id: number) => T,
): { id: number; mail: T } {
  checkRaise(input);
  return tx(db, () => { const id = raiseItemInTx(db, input, now, actor); return { id, mail: queue(id) }; });
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

/** One move, inside a transaction the CALLER holds. The decider is `nextItemState`; this reads the row, asks it, and
 *  writes the state, the timestamps and one event, or writes nothing and answers its word. THE ONLY WRITER of
 *  `operator_items.state`. `fields.answer` is kept on a tick; `fields.note` is kept on the row only for a return (the
 *  coordinator's note) and is recorded on the event for every act. */
function moveItemInTx(
  db: DatabaseSync, id: number, act: ItemAct, actor: ItemActor, fields: { answer?: string | null; note?: string | null },
  now: number, ctx: { programmeHasOpenRun: boolean },
): ItemMoveResult {
  const row = itemById(db, id);
  if (row === null) return { ok: false, why: 'unknown-item' };
  const verdict = nextItemState(row.state, act, actor, ctx);
  if (!verdict.ok) return verdict;
  // An item that carries an action ends by `act`, `decline`, `withdraw` or `settle`; a tick, confirm or return would strand it.
  if (isEndRunAction(row.action) && (act === 'tick' || act === 'confirm' || act === 'return')) return { ok: false, why: 'not-open' };
  const closes = verdict.to === 'done' || verdict.to === 'withdrawn' || verdict.to === 'dismissed';
  const answer = act === 'tick' && fields.answer !== undefined ? fields.answer : row.answer;
  const note = act === 'return' && fields.note !== undefined ? fields.note : row.note;
  db.prepare('UPDATE operator_items SET state = ?, tickedAt = ?, closedAt = ?, answer = ?, note = ? WHERE id = ?')
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
  for (const item of openEndRequestsOf(db, runId)) {
    const res = moveItemInTx(db, item.id, 'settle', 'ccrc', { note }, now, { programmeHasOpenRun: true });
    if (res.ok) settled += 1;
  }
  return settled;
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
      if (item === null || !isEndRunAction(item.action)) return null;
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
export function setBlocking(db: DatabaseSync, id: number, blocking: boolean, now: number):
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
    return { ok: true, changed: true } as const;
  });
}

/** An item's moves, oldest first. */
export function itemHistory(db: DatabaseSync, id: number): ItemEventRow[] {
  return db.prepare('SELECT id, itemId, at, act, actor, note FROM operator_item_events WHERE itemId = ? ORDER BY id')
    .all(id) as unknown as ItemEventRow[];
}

/** Pins a spec to a programme with the copy of its "In short" (spec §4). The route has checked the path (`isSpecPath`),
 *  the length, and that the caller claims the programme; a slug with no programme row changes nothing. */
export function setSpecPin(db: DatabaseSync, program: string, specPath: string, inShort: string, now: number): void {
  db.prepare('UPDATE programs SET specPath = ?, inShort = ?, inShortAt = ? WHERE slug = ?').run(specPath, inShort, now, program);
}

/** Records one change since approval; `mergedAt` stays NULL until `markModificationsMerged`. Returns the id. */
export function addModification(
  db: DatabaseSync, program: string, m: { text: string; ruling: string | null; itemId: number | null; pr: number | null }, now: number,
): number {
  const res = db.prepare('INSERT INTO programme_modifications (program, at, text, ruling, itemId, pr) VALUES (?, ?, ?, ?, ?, ?)')
    .run(program, now, m.text, m.ruling, m.itemId, m.pr);
  return Number(res.lastInsertRowid);
}

/** The spec PR merged: marks this programme's still-pending modifications of that PR, once (a marked one keeps its first
 *  time). Returns how many it marked. */
export function markModificationsMerged(db: DatabaseSync, program: string, pr: number, mergedAt: number): number {
  const res = db.prepare('UPDATE programme_modifications SET mergedAt = ? WHERE program = ? AND pr = ? AND mergedAt IS NULL')
    .run(mergedAt, program, pr);
  return Number(res.changes);
}

/** What Goals shows for one programme: the pin, its In short copy and the modifications, newest first. A programme with
 *  no pin (or no row) reads null fields and, if it has none, an empty list. */
export function goalsFor(db: DatabaseSync, program: string): GoalsView {
  const pin = db.prepare('SELECT specPath, inShort, inShortAt FROM programs WHERE slug = ?').get(program) as
    { specPath: string | null; inShort: string | null; inShortAt: number | null } | undefined;
  const mods = db.prepare(
    'SELECT id, at, text, ruling, itemId, pr, mergedAt FROM programme_modifications WHERE program = ? ORDER BY at DESC, id DESC',
  ).all(program) as unknown as { id: number; at: number; text: string; ruling: string | null; itemId: number | null; pr: number | null; mergedAt: number | null }[];
  return {
    program, specPath: pin?.specPath ?? null, inShort: pin?.inShort ?? null, inShortAt: pin?.inShortAt ?? null,
    modifications: mods.map((m) => ({ id: m.id, at: m.at, text: m.text, ruling: m.ruling, itemId: m.itemId, pr: m.pr, merged: m.mergedAt !== null })),
  };
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
