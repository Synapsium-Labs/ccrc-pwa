// The coordinator call record's SQL (D-8126, coordinator-autonomy-default plan Task A3-2, spec §8.2): `coordinator_calls`
// (migration 55). It sits beside `store.ts` in the same ring and context (Coordination), as `ledgersStore.ts` does: every
// function takes the store's `DatabaseSync` and is synchronous, and `CoordStore` keeps one-line delegates of the same names.
//
// One writer per column, and nothing else writes the table:
//   * `insertCall`        the only INSERT (every column but the four below);
//   * `markCallSeen`      the only writer of `seenAt`;
//   * `overturnCallTx`    the only writer of `overturnedAt` and `overturnNote`, inside `correctWithMail`'s transaction;
//   * `markBlockWoken`    the only writer of `wokenAt`.
// The pure rules (`isLiveBlock`, `callIsForOperator`, `callClearedAt`, `blockExpiresAt`) are `coordCalls.ts`'s.
import type { DatabaseSync } from 'node:sqlite';
import type { CallWake, CoordCallClass } from '../../../shared/api.js';
import { CLEARED_WINDOW_MS } from '../../../shared/ledgers.js';
import { blockExpiresAt, callClearedAt, callIsForOperator, isLiveBlock, parseWake, type CallRow, type NewCall } from './coordCalls.js';

const CALL_COLS =
  'id, program, runId, madeBy, class, question, options, chosen, why, reversible, wakeOn, expiresAt, at, seenAt, ' +
  'overturnedAt, overturnNote, wokenAt, build';

/** The table's row before `options`, `reversible` and `wakeOn` are read back into their types. */
interface CallRowRaw {
  id: number; program: string; runId: number | null; madeBy: string; class: string; question: string | null;
  options: string | null; chosen: string; why: string; reversible: number; wakeOn: string | null; expiresAt: number | null;
  at: number; seenAt: number | null; overturnedAt: number | null; overturnNote: string | null; wokenAt: number | null;
  build: string | null;
}

/** `options` is written by `insertCall` alone, from a typed array, so a value that does not parse as one is a corrupt
 *  file and throws, naming the call, rather than reading as none. A `wakeOn` that no longer parses reads as null: absence
 *  permits (a block whose word is unreadable holds nothing). */
function callRowOf(r: CallRowRaw): CallRow {
  let options: string[] | null = null;
  if (r.options !== null) {
    const v: unknown = JSON.parse(r.options);
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error(`coordinator call ${r.id}: options is not a string list`);
    options = v as string[];
  }
  return {
    id: r.id, program: r.program, runId: r.runId, madeBy: r.madeBy, class: r.class as CoordCallClass, question: r.question,
    options, chosen: r.chosen, why: r.why, reversible: r.reversible !== 0,
    wakeOn: r.wakeOn === null ? null : (parseWake(r.wakeOn) as CallWake | null),
    expiresAt: r.expiresAt, at: r.at, seenAt: r.seenAt, overturnedAt: r.overturnedAt, overturnNote: r.overturnNote,
    wokenAt: r.wokenAt, build: r.build,
  };
}

/** Records one call. A block's `expiresAt` is `blockExpiresAt` of its wake; every other class has none. THE ONLY INSERT.
 *  `build` is the server's build stamp (the one `/health` answers). Returns the new id. */
export function insertCall(db: DatabaseSync, program: string, madeBy: string, call: NewCall, build: string | null, now: number): number {
  const expiresAt = call.class === 'block' && call.wakeOn !== null ? blockExpiresAt(call.wakeOn, now) : null;
  const r = db.prepare(
    'INSERT INTO coordinator_calls (program, runId, madeBy, class, question, options, chosen, why, reversible, wakeOn, expiresAt, at, build) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    program, call.runId, madeBy, call.class, call.question, call.options === null ? null : JSON.stringify(call.options),
    call.chosen, call.why, call.reversible ? 1 : 0, call.wakeOn, expiresAt, now, build,
  );
  return Number(r.lastInsertRowid);
}

export function callById(db: DatabaseSync, id: number): CallRow | null {
  const r = db.prepare(`SELECT ${CALL_COLS} FROM coordinator_calls WHERE id = ?`).get(id) as CallRowRaw | undefined;
  return r === undefined ? null : callRowOf(r);
}

/** Every class of call that names the run, oldest first. */
export function callsForRun(db: DatabaseSync, runId: number): CallRow[] {
  return (db.prepare(`SELECT ${CALL_COLS} FROM coordinator_calls WHERE runId = ? ORDER BY at, id`).all(runId) as unknown as CallRowRaw[]).map(callRowOf);
}

/** Big calls, newest first; `program === null` means every programme. */
export function bigCallsFor(db: DatabaseSync, program: string | null, limit: number): CallRow[] {
  const scope = program === null ? '' : ' AND program = ?';
  const args: (string | number)[] = program === null ? [limit] : [program, limit];
  return (db.prepare(
    `SELECT ${CALL_COLS} FROM coordinator_calls WHERE class = 'big'${scope} ORDER BY at DESC, id DESC LIMIT ?`,
  ).all(...args) as unknown as CallRowRaw[]).map(callRowOf);
}

/** Big calls made inside `[fromMs, toMs)`, oldest first: the digest's window read (`callDecision` names which are lines). */
export function bigCallsIn(db: DatabaseSync, fromMs: number, toMs: number): CallRow[] {
  return (db.prepare(
    `SELECT ${CALL_COLS} FROM coordinator_calls WHERE class = 'big' AND at >= ? AND at < ? ORDER BY at, id`,
  ).all(fromMs, toMs) as unknown as CallRowRaw[]).map(callRowOf);
}

/** The operator's group: the big calls still open (`callIsForOperator`), and those that left it inside the window
 *  (`callClearedAt`), each newest first. The read takes every big call and lets the two predicates decide, so the rule
 *  lives in one place. */
export function callsForOperator(db: DatabaseSync, now: number): { open: CallRow[]; cleared: CallRow[] } {
  const rows = (db.prepare(`SELECT ${CALL_COLS} FROM coordinator_calls WHERE class = 'big' ORDER BY at DESC, id DESC`).all() as unknown as CallRowRaw[]).map(callRowOf);
  const open = rows.filter((r) => callIsForOperator(r, now));
  const cleared = rows
    .map((r) => ({ r, at: callClearedAt(r, now) }))
    .filter((x): x is { r: CallRow; at: number } => x.at !== null && x.at > now - CLEARED_WINDOW_MS)
    .sort((a, b) => b.at - a.at || b.r.id - a.r.id)
    .map((x) => x.r);
  return { open, cleared };
}

/** The blocks that still hold a thread for `madeBy` (P4: not woken, not expired). */
export function liveBlocksOf(db: DatabaseSync, madeBy: string, now: number): CallRow[] {
  return (db.prepare(
    `SELECT ${CALL_COLS} FROM coordinator_calls WHERE madeBy = ? AND class = 'block' AND wokenAt IS NULL AND expiresAt > ? ORDER BY at, id`,
  ).all(madeBy, now) as unknown as CallRowRaw[]).map(callRowOf).filter((r) => isLiveBlock(r, now));
}

/** The operator's Seen. THE ONLY WRITER of `seenAt`. */
export function markCallSeen(db: DatabaseSync, id: number, now: number): 'seen' | 'already' | 'unknown' | 'not-big' {
  const row = callById(db, id);
  if (row === null) return 'unknown';
  if (row.class !== 'big') return 'not-big';
  if (row.seenAt !== null) return 'already';
  const r = db.prepare("UPDATE coordinator_calls SET seenAt = ? WHERE id = ? AND class = 'big' AND seenAt IS NULL").run(now, id);
  return Number(r.changes) === 1 ? 'seen' : 'already';
}

/** The overturn: the operator's correction, inside `correctWithMail`'s transaction (the caller holds it; `tx` does not
 *  nest). THE ONLY WRITER of `overturnedAt` and `overturnNote`. */
export function overturnCallTx(db: DatabaseSync, id: number, note: string, now: number): void {
  db.prepare('UPDATE coordinator_calls SET overturnedAt = ?, overturnNote = ? WHERE id = ?').run(now, note, id);
}

/** A block's wake, compare-and-set. THE ONLY WRITER of `wokenAt` (wave A6's executor). True once, false after. */
export function markBlockWoken(db: DatabaseSync, id: number, now: number): boolean {
  const r = db.prepare("UPDATE coordinator_calls SET wokenAt = ? WHERE id = ? AND class = 'block' AND wokenAt IS NULL").run(now, id);
  return Number(r.changes) === 1;
}
