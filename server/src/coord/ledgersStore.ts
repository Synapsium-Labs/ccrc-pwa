// Programme ledgers (plan PL2): the SQL behind `CoordStore`'s item, history, modification and spec-pin methods.
//
// Ring L3 (adapter over `coord.db`), context Coordination. Every function takes the store's `DatabaseSync` and is
// synchronous, like the store: there is no repository or async wrapper over `CoordStore`. `CoordStore` keeps the public
// methods as one-line delegates, so a caller still says `coord.moveItem(...)`; this file exists so the god-file `store.ts`
// does not take the SQL (ARCH-01, `growth-check`).
//
// Everything here is keyed on the programme's SLUG (spec §3.4). The moves are decided by `nextItemState` in
// `shared/ledgers.ts` and by nothing in this file: `moveItemInTx` is THE ONLY WRITER of `operator_items.state`.
import type { DatabaseSync } from 'node:sqlite';
import {
  CLEARED_WINDOW_MS, ITEM_KINDS, NEEDED_BY_LEVELS, OPEN_ITEM_STATES, nextItemState,
  type GoalsView, type ItemAct, type ItemActor, type ItemKind, type ItemMoveRefusal, type ItemState, type NeededBy,
} from '../../../shared/ledgers.js';
import { tx } from './tx.js';

/** An operator item as the store holds it (migration 37). `how` and `options` are parsed from their JSON columns. */
export interface ItemRow {
  id: number; program: string; runId: number | null; raisedBy: string; kind: ItemKind; title: string; why: string;
  how: string[]; options: string[] | null; neededBy: NeededBy; soonLabel: string | null; secretSlot: string | null;
  state: ItemState; answer: string | null; note: string | null; raisedAt: number; tickedAt: number | null; closedAt: number | null;
}
/** One move of one item. `act` is an `ItemAct` or `raise`, `block`, `unblock`. */
export interface ItemEventRow {
  id: number; itemId: number; at: number; act: ItemAct | 'raise' | 'block' | 'unblock'; actor: ItemActor; note: string | null;
}
/** `moveItem`'s answer: the moved item, or the refusal word (`nextItemState`'s three, or `unknown-item`). */
export type ItemMoveResult =
  | { ok: true; item: ItemRow }
  | { ok: false; why: ItemMoveRefusal };
/** What the coordinator gives when it raises an item. */
export interface RaiseItemInput {
  program: string; runId: number | null; raisedBy: string; kind: ItemKind; title: string; why: string;
  how: string[]; options: string[] | null; neededBy: NeededBy; soonLabel: string | null; secretSlot: string | null;
}
/** The table's row before the JSON columns are parsed. */
type ItemRowRaw = Omit<ItemRow, 'how' | 'options'> & { how: string; options: string | null };

const ITEM_COLS =
  'id, program, runId, raisedBy, kind, title, why, how, options, neededBy, soonLabel, secretSlot, state, answer, note, ' +
  'raisedAt, tickedAt, closedAt';

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
  };
}

/** One `operator_item_events` row. Callers hold the transaction. */
function writeItemEvent(db: DatabaseSync, itemId: number, at: number, act: ItemEventRow['act'], actor: ItemActor, note: string | null): void {
  db.prepare('INSERT INTO operator_item_events (itemId, at, act, actor, note) VALUES (?, ?, ?, ?, ?)').run(itemId, at, act, actor, note);
}

/** The coordinator raises an item: open, with its `raise` event, in one transaction. The kind and the needed-by level
 *  must be in L0's vocabulary (the route has already bounded the text; this stops an out-of-vocabulary word reaching a
 *  column no SQL check guards) and throw otherwise. Returns the new id. */
export function raiseItem(db: DatabaseSync, input: RaiseItemInput, now: number): number {
  if (!ITEM_KINDS.includes(input.kind)) throw new RangeError(`raiseItem: kind ${String(input.kind)} is not an item kind`);
  if (!NEEDED_BY_LEVELS.includes(input.neededBy)) throw new RangeError(`raiseItem: neededBy ${String(input.neededBy)} is not a level`);
  return tx(db, () => {
    const res = db.prepare(
      'INSERT INTO operator_items (program, runId, raisedBy, kind, title, why, how, options, neededBy, soonLabel, ' +
      "secretSlot, state, raisedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
    ).run(input.program, input.runId, input.raisedBy, input.kind, input.title, input.why, JSON.stringify(input.how),
      input.options === null ? null : JSON.stringify(input.options), input.neededBy, input.soonLabel, input.secretSlot, now);
    const id = Number(res.lastInsertRowid);
    writeItemEvent(db, id, now, 'raise', 'coordinator', null);
    return id;
  });
}

export function itemById(db: DatabaseSync, id: number): ItemRow | null {
  const r = db.prepare(`SELECT ${ITEM_COLS} FROM operator_items WHERE id = ?`).get(id) as ItemRowRaw | undefined;
  return r === undefined ? null : itemRowOf(r);
}

/** The items still waiting (`open`, `checking`; oldest first) and the ones cleared inside the Recently-cleared window
 *  (`done` with `closedAt` no older than `CLEARED_WINDOW_MS`, newest first). `program === null` means every programme.
 *  Withdrawn and dismissed items appear in neither list. */
export function itemsFor(db: DatabaseSync, program: string | null, now: number): { open: ItemRow[]; cleared: ItemRow[] } {
  const scope = program === null ? '' : ' AND program = ?';
  const args = (extra: (string | number)[]): (string | number)[] => (program === null ? extra : [...extra, program]);
  const openStates = OPEN_ITEM_STATES.map((st) => `'${st}'`).join(', ');
  const open = db.prepare(
    `SELECT ${ITEM_COLS} FROM operator_items WHERE state IN (${openStates})${scope} ORDER BY raisedAt, id`,
  ).all(...args([])) as unknown as ItemRowRaw[];
  const cleared = db.prepare(
    `SELECT ${ITEM_COLS} FROM operator_items WHERE state = 'done' AND closedAt >= ?${scope} ORDER BY closedAt DESC, id DESC`,
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
 *  item always has its mail and a failed mail leaves the item open. A refused tick never calls `queue`. */
export function tickWithMail<T>(db: DatabaseSync, id: number, answer: string | null, now: number, queue: (item: ItemRow) => T):
  { ok: true; item: ItemRow; mail: T } | Extract<ItemMoveResult, { ok: false }> {
  return tx(db, () => {
    // A tick ignores the programme context (`nextItemState`), so none is asked for.
    const moved = moveItemInTx(db, id, 'tick', 'operator', { answer }, now, { programmeHasOpenRun: false });
    if (!moved.ok) return moved;
    return { ok: true, item: moved.item, mail: queue(moved.item) };
  });
}

/** The coordinator marks an item blocking (work has stopped on it) or lowers it. Raising records the level it replaced
 *  as the `block` event's note; lowering restores that level, and an item that was RAISED blocking (no earlier level on
 *  record) falls back to `soon` when it carries a label and `later` when it does not. A repeat of the level it already
 *  has writes nothing. It writes `neededBy` and an event and never `state`. */
export function setBlocking(db: DatabaseSync, id: number, blocking: boolean, now: number):
  { ok: true } | { ok: false; why: Extract<ItemMoveRefusal, 'unknown-item' | 'not-open'> } {
  return tx(db, () => {
    const row = itemById(db, id);
    if (row === null) return { ok: false, why: 'unknown-item' } as const;
    if (!OPEN_ITEM_STATES.includes(row.state)) return { ok: false, why: 'not-open' } as const;
    if ((row.neededBy === 'blocking') === blocking) return { ok: true } as const;
    let next: NeededBy = 'blocking';
    if (!blocking) {
      const last = db.prepare("SELECT note FROM operator_item_events WHERE itemId = ? AND act = 'block' ORDER BY id DESC LIMIT 1")
        .get(id) as { note: string | null } | undefined;
      const kept = last?.note;
      next = kept === 'soon' || kept === 'later' ? kept : (row.soonLabel === null ? 'later' : 'soon');
    }
    db.prepare('UPDATE operator_items SET neededBy = ? WHERE id = ?').run(next, id);
    writeItemEvent(db, id, now, blocking ? 'block' : 'unblock', 'coordinator', blocking ? row.neededBy : null);
    return { ok: true } as const;
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
