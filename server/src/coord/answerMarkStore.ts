// Overlord W1, answer marks (spec 2026-11-09 §9.2.1, C70; plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-delegation-marks.md,
// Task 2). Ring: L3, context Coordination (C5). SQL only: every function is synchronous over the store's own database handle,
// and `CoordStore` keeps a one-line delegate for each. No repository and no async wrapper.
//
// ONE WRITER: `recordAnswerMark` is the only writer of `answer_marks` (`single-definition/writers-map.test.ts` pins the table,
// and that only `CoordStore`'s delegate and the operator's answer-mark door call it). The table is APPEND-ONLY: every change
// is a record with its time and actor, and the newest record of a row's mark is that mark's value (plan question 9), so a later
// reader (W3's gates) can read the value that stood at any instant. A record names its row by kind and id and copies no fact
// of it (question 10): an item's kind, programme and raiser, and an ask's run, read back by a join.
//
// THE READ keeps every distinction it reads: a mark this build does not know (a newer build's) is skipped and counted
// `unreadable`, never folded into a known one; a throw is `{ ok: false, detail }`, never an empty map.
import type { DatabaseSync } from 'node:sqlite';
import { isAnswerMarkName, type AnswerMarkKind, type AnswerMarkName, type AnswerMarkWrite } from '../../../shared/answerMarks.js';
import { tx } from './tx.js';
export type { AnswerMarkKind, AnswerMarkWrite };

/** One stored change of one mark. `kind` and `mark` are the table's text, read through the vocabulary by every reader. */
export interface AnswerMarkRecord { id: number; kind: string; rowId: number; mark: string; value: number; at: number; actor: string }

/** `recordAnswerMark`'s answer: whether a record was written, and the newest record of that mark afterwards (`null`: none). */
export interface AnswerMarkWriteResult { changed: boolean; newest: AnswerMarkRecord | null }

/** The newest records of each row's two marks. */
export interface RowMarks { couldAnswer: AnswerMarkRecord | null; unsure: AnswerMarkRecord | null }
export type AnswerMarksRead =
  | { ok: true; newest: Map<number, RowMarks>; unreadable: number }
  | { ok: false; detail: string };

const COLS = 'id, kind, rowId, mark, value, at, actor';

function newestOf(db: DatabaseSync, kind: AnswerMarkKind, rowId: number, mark: AnswerMarkName): AnswerMarkRecord | null {
  const r = db.prepare(`SELECT ${COLS} FROM answer_marks WHERE kind = ? AND rowId = ? AND mark = ? ORDER BY id DESC LIMIT 1`)
    .get(kind, rowId, mark) as AnswerMarkRecord | undefined;
  return r ?? null;
}

/** THE ONE WRITER. In one transaction: a change to the value the newest record already holds writes nothing, and so does an
 *  untick of a mark never ticked (a withdrawal of nothing); any other change inserts one record. It does not check that the
 *  row exists or is markable: the door has asked `itemMarkable` with no `await` between, so the transaction is the whole guard. */
export function recordAnswerMark(db: DatabaseSync, write: AnswerMarkWrite, actor: string, now: number): AnswerMarkWriteResult {
  return tx(db, () => {
    const newest = newestOf(db, write.kind, write.id, write.mark);
    const value = write.value ? 1 : 0;
    if (newest === null ? value === 0 : newest.value === value) return { changed: false, newest };
    db.prepare('INSERT INTO answer_marks (kind, rowId, mark, value, at, actor) VALUES (?, ?, ?, ?, ?, ?)')
      .run(write.kind, write.id, write.mark, value, now, actor);
    return { changed: true, newest: newestOf(db, write.kind, write.id, write.mark) };
  });
}

/** The newest record of each of `ids`' marks, in one statement. A row with no record is absent from the map (both marks
 *  `never`); a mark this build does not know is skipped and counted. A throw is `{ ok: false }` with its message. It takes no
 *  transaction: a pure read never takes the write lock. */
export function answerMarksOf(db: DatabaseSync, kind: AnswerMarkKind, ids: readonly number[]): AnswerMarksRead {
  try {
    const rows = db.prepare(
      `SELECT ${COLS} FROM answer_marks WHERE id IN (` +
      'SELECT MAX(id) FROM answer_marks WHERE kind = ? AND rowId IN (SELECT value FROM json_each(?)) GROUP BY rowId, mark)',
    ).all(kind, JSON.stringify(ids)) as unknown as AnswerMarkRecord[];
    const newest = new Map<number, RowMarks>();
    let unreadable = 0;
    for (const r of rows) {
      if (!isAnswerMarkName(r.mark)) { unreadable++; continue; }
      const marks = newest.get(r.rowId) ?? { couldAnswer: null, unsure: null };
      if (r.mark === 'could-answer') marks.couldAnswer = r; else marks.unsure = r;
      newest.set(r.rowId, marks);
    }
    return { ok: true, newest, unreadable };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
