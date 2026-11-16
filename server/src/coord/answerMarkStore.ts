// Overlord W1, answer marks (spec 2026-11-09 §9.2.1, C70; plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-delegation-marks.md,
// Tasks 2 and 5). Ring: L3, context Coordination (C5). SQL only: every function is synchronous over the store's own database handle,
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
import { isAnswerMarkName, type AnswerMarkKind, type AnswerMarkName, type AnswerMarkWrite, type AskMarkHow, type AskMarkRow } from '../../../shared/answerMarks.js';
import { ASK_OPERATOR_PRINCIPAL, isAskReleaseReason, isAskState, isPositiveDecimalSafeInteger } from '../../../shared/api.js';
import { CLEARED_WINDOW_MS } from '../../../shared/ledgers.js';
import { askLiveOf, askMarkable, type Markable } from './answerMarks.js';
import type { LiveAskRead } from './ports.js';
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

/** One ask the operator has, before its marks are attached (`AskMarkRow` less `answerMarks`). */
export type AskMarkTarget = Omit<AskMarkRow, 'answerMarks'>;
export type AskMarkTargetsRead = { ok: true; rows: AskMarkTarget[] } | { ok: false; detail: string };

interface AskTargetRaw {
  idText: string; runIdText: string | null; childId: string; askKey: string; question: string | null; state: string;
  answeredBy: string | null; answeredAt: number | null; releasedAt: number | null; reachedOperatorAt: number | null;
  releaseReason: string | null; program: string | null; newest: number;
}

/** The one statement both ask reads use, before its `WHERE` (review 2217 F4 to F6): each child's newest row once
 *  (`MAX(id) … GROUP BY childId`), the question's first line taken in SQL, the reach stamp, and the id and run as text, so a
 *  row whose id or run is not a positive safe integer is measured unreadable as `store.ts#askById` measures it. */
const ASK_TARGET_SQL =
  'WITH newest AS (SELECT MAX(id) AS id FROM asks GROUP BY childId) ' +
  'SELECT CAST(a.id AS TEXT) AS idText, CAST(a.runId AS TEXT) AS runIdText, a.childId, a.askKey, ' +
  'CASE WHEN instr(a.question, char(10)) > 0 THEN substr(a.question, 1, instr(a.question, char(10)) - 1) ELSE a.question END AS question, ' +
  'a.state, a.answeredBy, a.answeredAt, a.releasedAt, a.reachedOperatorAt, a.releaseReason, r.program, (n.id IS NOT NULL) AS newest ' +
  'FROM asks a LEFT JOIN runs r ON r.id = a.runId LEFT JOIN newest n ON n.id = a.id WHERE ';

/** `store.ts#persistedInt`'s test through the same L0 predicate: an id or run that is not a positive safe integer is unreadable,
 *  named by its column and never quoted. A null run is legal (an ask minted with no open run). */
const unreadableInt = (text: string | null, column: string): string | null =>
  text === null || isPositiveDecimalSafeInteger(Number(text)) ? null : `${column} is not a positive safe integer`;

/** One read row: unreadable with its detail, or `askMarkable`'s answer and the row the view lists. The live-ask port is asked
 *  only for a `released`, `declined` or `answering` ask that is its child's newest row. */
function askTargetOf(r: AskTargetRaw, now: number, liveAsk: LiveAskRead): { ok: false; detail: string } | { ok: true; may: Markable; target: AskMarkTarget } {
  const bad = unreadableInt(r.idText, 'ask id') ?? unreadableInt(r.runIdText, 'ask runId');
  if (bad !== null) return { ok: false, detail: bad };
  const state = isAskState(r.state) ? r.state : 'unknown';
  const open = state === 'released' || state === 'declined' || state === 'answering';
  const live = open && r.newest === 1 ? askLiveOf(liveAsk(r.childId), r.askKey) : false;
  const how: AskMarkHow = state === 'answered' && r.answeredBy === ASK_OPERATOR_PRINCIPAL ? 'answered'
    : state === 'declined' ? 'declined' : r.releaseReason === null ? 'lapsed' : 'released-at-mint';
  return {
    ok: true, may: askMarkable({ ...r, state }, live, now),
    target: {
      id: Number(r.idText), childId: r.childId, program: r.program, question: r.question ?? '', how,
      reason: how === 'released-at-mint' ? (isAskReleaseReason(r.releaseReason) ? r.releaseReason : 'unknown') : null,
      at: (state === 'answered' ? r.answeredAt : r.releasedAt) ?? 0, live,
    },
  };
}

/** THE READ OF THE ASKS THE OPERATOR HAS (plan Task 5; review 2217 F1, slug reached-is-the-reach-stamp), newest change first.
 *  One statement selects the `released`, `declined` and `answering` asks released inside the Recently cleared window or that
 *  are their child's newest row, the answered asks answered inside it and the `stale` asks gone stale inside it; every row
 *  `askMarkable` would not call markable is dropped, so a newest row past the window that is not live is read and not listed,
 *  and the read is bounded by the number of children, never by time. A row this box cannot read is not listed (F4), as the door
 *  answers it `ask-unreadable`, and it never refuses another row. The programme comes from the ask's run (`null` with no run
 *  row). A throw is `{ ok: false }` with its message, never an empty list. */
export function askMarkTargets(db: DatabaseSync, now: number, liveAsk: LiveAskRead): AskMarkTargetsRead {
  try {
    const from = now - CLEARED_WINDOW_MS;
    const raw = db.prepare(ASK_TARGET_SQL +
      "(a.state IN ('released', 'declined', 'answering') AND (a.releasedAt >= ? OR n.id IS NOT NULL)) " +
      "OR (a.state = 'answered' AND a.answeredAt >= ?) OR (a.state = 'stale' AND a.releasedAt >= ?)",
    ).all(from, from, from) as unknown as AskTargetRaw[];
    const rows: AskMarkTarget[] = [];
    for (const r of raw) {
      const t = askTargetOf(r, now, liveAsk);
      if (t.ok && t.may.markable) rows.push(t.target);
    }
    rows.sort((a, b) => b.at - a.at || b.id - a.id);
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** The answer-mark door's read of one ask (review 2217 F4): the same statement and rule as the list, so the door and the view
 *  never disagree. Absent is `found: null`; a row this box cannot read, or a throw, is `{ ok: false }` with its detail. Whether
 *  the row is its child's newest is read by id alone, so another row's unreadable value never refuses this one. */
export type AskMarkRead = { ok: true; found: null | { may: Markable } } | { ok: false; detail: string };
export function askMarkRead(db: DatabaseSync, id: number, now: number, liveAsk: LiveAskRead): AskMarkRead {
  try {
    const r = db.prepare(`${ASK_TARGET_SQL}a.id = ?`).get(id) as unknown as AskTargetRaw | undefined;
    if (r === undefined) return { ok: true, found: null };
    const t = askTargetOf(r, now, liveAsk);
    return t.ok ? { ok: true, found: { may: t.may } } : t;
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
