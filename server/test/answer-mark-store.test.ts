// Overlord W1, answer marks (plan w1-delegation-marks.md Task 2): `answer_marks`' one writer, `recordAnswerMark`, and its read,
// `answerMarksOf`, over a fixture coord.db.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { AnswerMarkWrite } from '../../shared/answerMarks.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_790_000_000_000;
const MIN = 60_000;

let coord: CoordStore;
beforeEach(() => { coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-answer-mark-store-'), '.ccrc', 'coord.db'))); });

const w = (o: Partial<AnswerMarkWrite> = {}): AnswerMarkWrite => ({ kind: 'item', id: 3, mark: 'could-answer', value: true, ...o });
const records = () => coord.db.prepare('SELECT kind, rowId, mark, value, at, actor FROM answer_marks ORDER BY id').all();
const read = (ids: number[], kind: 'item' | 'ask' = 'item') => {
  const r = coord.answerMarksOf(kind, ids);
  if (!r.ok) throw new Error(r.detail);
  return r;
};

describe('answer_marks and its one writer', () => {
  it('a fresh database has the table and no record, and the read answers an empty map', () => {
    expect(records()).toEqual([]);
    const r = read([1, 2, 3]);
    expect([r.newest.size, r.unreadable]).toEqual([0, 0]);
  });

  it('a tick writes one record with its time and actor, and the same tick again writes nothing', () => {
    expect(coord.recordAnswerMark(w(), 'op-a', NOW)).toEqual({
      changed: true, newest: { id: 1, kind: 'item', rowId: 3, mark: 'could-answer', value: 1, at: NOW, actor: 'op-a' },
    });
    expect(coord.recordAnswerMark(w(), 'op-a', NOW + MIN)).toEqual({
      changed: false, newest: { id: 1, kind: 'item', rowId: 3, mark: 'could-answer', value: 1, at: NOW, actor: 'op-a' },
    });
    expect(records()).toEqual([{ kind: 'item', rowId: 3, mark: 'could-answer', value: 1, at: NOW, actor: 'op-a' }]);
  });

  it('tick, untick, tick writes three records, and the read answers the newest, ticked', () => {
    coord.recordAnswerMark(w(), 'op-a', NOW);
    coord.recordAnswerMark(w({ value: false }), 'op-a', NOW + MIN);
    coord.recordAnswerMark(w(), 'flag-off', NOW + 2 * MIN);
    expect(records()).toHaveLength(3);
    expect(read([3]).newest.get(3)?.couldAnswer).toMatchObject({ value: 1, at: NOW + 2 * MIN, actor: 'flag-off' });
  });

  it('an untick of a mark never ticked writes nothing', () => {
    expect(coord.recordAnswerMark(w({ value: false }), 'op-a', NOW)).toEqual({ changed: false, newest: null });
    expect(records()).toEqual([]);
  });

  it('the two marks of one row are independent: ticking unsure leaves could-answer as it was, and the read answers both', () => {
    coord.recordAnswerMark(w(), 'op-a', NOW);
    expect(coord.recordAnswerMark(w({ mark: 'unsure' }), 'op-a', NOW + MIN).changed).toBe(true);
    expect(coord.recordAnswerMark(w({ mark: 'unsure', value: false }), 'op-a', NOW + 2 * MIN).changed).toBe(true);
    const marks = read([3]).newest.get(3);
    expect(marks?.couldAnswer).toMatchObject({ value: 1, at: NOW });
    expect(marks?.unsure).toMatchObject({ value: 0, at: NOW + 2 * MIN });
  });

  it('marks on item:3 and ask:3 are separate rows', () => {
    coord.recordAnswerMark(w(), 'op-a', NOW);
    expect(coord.recordAnswerMark(w({ kind: 'ask' }), 'op-a', NOW + MIN).changed).toBe(true);
    expect(coord.recordAnswerMark(w({ kind: 'ask', value: false }), 'op-a', NOW + 2 * MIN).changed).toBe(true);
    expect(read([3]).newest.get(3)?.couldAnswer).toMatchObject({ kind: 'item', value: 1 });
    expect(read([3], 'ask').newest.get(3)?.couldAnswer).toMatchObject({ kind: 'ask', value: 0 });
  });

  it('reads only the ids asked for, and leaves a row with no record out of the map', () => {
    coord.recordAnswerMark(w({ id: 1 }), 'op-a', NOW);
    coord.recordAnswerMark(w({ id: 2, mark: 'unsure' }), 'op-a', NOW);
    const r = read([2, 9]);
    expect([...r.newest.keys()]).toEqual([2]);
    expect(r.newest.get(2)).toMatchObject({ couldAnswer: null, unsure: { value: 1 } });
  });

  it('a record of a mark this build does not know (a newer build\'s) is skipped and counted unreadable (F12)', () => {
    coord.recordAnswerMark(w(), 'op-a', NOW);
    coord.db.prepare("INSERT INTO answer_marks (kind, rowId, mark, value, at, actor) VALUES ('item', 3, 'sure', 1, ?, 'op-a')").run(NOW + MIN);
    coord.db.prepare("INSERT INTO answer_marks (kind, rowId, mark, value, at, actor) VALUES ('item', 4, 'sure', 1, ?, 'op-a')").run(NOW + MIN);
    const r = read([3, 4]);
    expect(r.unreadable).toBe(2);
    expect([...r.newest.keys()]).toEqual([3]);
    expect(r.newest.get(3)).toMatchObject({ couldAnswer: { value: 1 }, unsure: null });
  });

  it('a record of a kind this build does not know is never selected: it changes neither the answer nor the count', () => {
    coord.recordAnswerMark(w(), 'op-a', NOW);
    const before = read([3]);
    coord.db.prepare("INSERT INTO answer_marks (kind, rowId, mark, value, at, actor) VALUES ('approval', 3, 'could-answer', 0, ?, 'op-a')").run(NOW + MIN);
    const after = read([3]);
    expect(after.unreadable).toBe(before.unreadable);
    expect(after.newest).toEqual(before.newest);
  });

  it('a read on a closed database answers { ok: false } with the error, never an empty map', () => {
    coord.db.close();
    const r = coord.answerMarksOf('item', [3]);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.detail).not.toBe('');
  });

  it('the history: the records of one mark come back in order with their times, so the value at any instant can be read', () => {
    coord.recordAnswerMark(w({ mark: 'unsure' }), 'op-a', NOW);
    coord.recordAnswerMark(w({ mark: 'unsure', value: false }), 'op-a', NOW + 5 * MIN);
    coord.recordAnswerMark(w({ mark: 'unsure' }), 'op-a', NOW + 9 * MIN);
    const history = coord.db.prepare("SELECT value, at FROM answer_marks WHERE kind = 'item' AND rowId = 3 AND mark = 'unsure' ORDER BY id").all() as { value: number; at: number }[];
    expect(history).toEqual([{ value: 1, at: NOW }, { value: 0, at: NOW + 5 * MIN }, { value: 1, at: NOW + 9 * MIN }]);
    const stoodAt = (t: number): number | null => history.filter((h) => h.at <= t).at(-1)?.value ?? null;
    expect([stoodAt(NOW - 1), stoodAt(NOW + MIN), stoodAt(NOW + 6 * MIN), stoodAt(NOW + 10 * MIN)]).toEqual([null, 1, 0, 1]);
  });

  it('the join: a marked item\'s kind, programme and raiser, and a marked ask\'s programme, read back with no fact copied', () => {
    const itemId = coord.raiseItem({
      program: 'prog-a', runId: null, raisedBy: 'lane-a-project-a', kind: 'value', title: 't', why: 'w', how: [], options: null,
      neededBy: 'soon', soonLabel: null, secretSlot: null,
    }, NOW - MIN);
    coord.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-b', 'B', ?, 'active')").run(NOW - 10 * MIN);
    const runId = Number(coord.db.prepare("INSERT INTO runs (program, wave, project, state, kind, openedAt) VALUES ('prog-b', 1, 'project-a', 'working', 'work', ?)").run(NOW - 9 * MIN).lastInsertRowid);
    const askId = Number(coord.db.prepare(
      "INSERT INTO asks (at, childId, parentId, runId, askKey, askAt, dialogId, question, options, state, releasedAt) VALUES (?, 'lane-a-child', 'lane-a-parent', ?, 'k', ?, 'd', 'q', '[]', 'released', ?)",
    ).run(NOW - 5 * MIN, runId, NOW - 5 * MIN, NOW - 4 * MIN).lastInsertRowid);
    coord.recordAnswerMark(w({ id: itemId }), 'op-a', NOW);
    coord.recordAnswerMark(w({ kind: 'ask', id: askId, mark: 'unsure' }), 'op-a', NOW);
    expect(coord.db.prepare('PRAGMA table_info(answer_marks)').all().map((c) => (c as { name: string }).name))
      .toEqual(['id', 'kind', 'rowId', 'mark', 'value', 'at', 'actor']);
    expect(coord.db.prepare(
      "SELECT i.kind, i.program, i.raisedBy FROM answer_marks m JOIN operator_items i ON i.id = m.rowId WHERE m.kind = 'item'",
    ).all()).toEqual([{ kind: 'value', program: 'prog-a', raisedBy: 'lane-a-project-a' }]);
    expect(coord.db.prepare(
      "SELECT r.program FROM answer_marks m JOIN asks a ON a.id = m.rowId JOIN runs r ON r.id = a.runId WHERE m.kind = 'ask'",
    ).all()).toEqual([{ program: 'prog-b' }]);
  });
});
