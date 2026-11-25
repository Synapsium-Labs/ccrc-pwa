// Overlord W1 readiness, plan `w1-readiness.md` Task 2 Step 2: the readiness word's rows and their one writer
// (`overlordReadinessStore.ts`), over a coord db opened through the real migrations. The raise and settle of items are a
// later stage and are not tested here.
import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb, tx } from '../src/coord/db.js';
import {
  closeReadinessItem, openReadinessItems, pruneReadiness, readinessChanges, readinessNow, recordReadiness, recordReadinessInTx,
  READINESS_NO_SESSION, type ReadinessWrite,
} from '../src/coord/overlordReadinessStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

let template = '';
const opened: DatabaseSync[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-readiness-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } } });
afterAll(() => removeTmpFixtures());

const openDb = (): DatabaseSync => {
  const dir = path.join(mkTmp('ccrc-readiness-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  return db;
};

const AT = 1_800_000_000_000;
const A = 'cc-overlord-a';
const B = 'cc-overlord-b';
const W = (word: string, over: Partial<ReadinessWrite> = {}): ReadinessWrite =>
  ({ word, why: null, until: null, strandCause: null, restartable: false, sessionId: A, ...over } as ReadinessWrite);
const rec = (db: DatabaseSync, word: string, at: number, over: Partial<ReadinessWrite> = {}) => recordReadiness(db, W(word, over), at);
const rows = (db: DatabaseSync): Record<string, unknown>[] => db.prepare('SELECT * FROM overlord_readiness ORDER BY id').all() as Record<string, unknown>[];
const lines = (db: DatabaseSync): Record<string, unknown>[] => db.prepare('SELECT * FROM overlord_sequence ORDER BY seq').all() as Record<string, unknown>[];
const nowOf = (db: DatabaseSync) => {
  const r = readinessNow(db);
  if (!r.ok) throw new Error(r.detail);
  return r.now;
};

describe('recordReadiness: a new word', () => {
  it('writes one row and its sequence line in one transaction, the row carrying the line\'s seq', () => {
    const db = openDb();
    const r = rec(db, 'ready', AT, { why: 'proven' });
    expect(r).toEqual({ ok: true, changed: true, rowId: 1, episodeFirst: false });
    const [row] = rows(db);
    const [line] = lines(db);
    expect(rows(db)).toHaveLength(1);
    expect(lines(db)).toHaveLength(1);
    expect(line).toMatchObject({ kind: 'readiness', id: A, state: 'ready', actor: 'server', at: AT });
    expect(row).toMatchObject({ sessionId: A, word: 'ready', why: 'proven', at: AT, seq: line!.seq, pushedAt: null, restartable: 0 });
  });

  it('a null session is stamped under the id `none`', () => {
    const db = openDb();
    expect(rec(db, 'absent', AT, { sessionId: null })).toMatchObject({ ok: true, changed: true });
    expect(lines(db)[0]).toMatchObject({ kind: 'readiness', id: 'none', state: 'absent' });
    expect(READINESS_NO_SESSION).toBe('none');
    expect(rows(db)[0]).toMatchObject({ sessionId: null, word: 'absent' });
  });

  it('each change takes the next sequence number, and the detail columns round-trip', () => {
    const db = openDb();
    rec(db, 'unproved', AT);
    rec(db, 'stranded', AT + 1, { why: 'every account limited', until: AT + 5_000, strandCause: 'limited', restartable: true });
    const rs = rows(db);
    const ls = lines(db);
    expect(rs.map((r) => r.seq)).toEqual(ls.map((l) => l.seq));
    expect(Number(ls[1]!.seq)).toBe(Number(ls[0]!.seq) + 1);
    expect(rs[1]).toMatchObject({ word: 'stranded', why: 'every account limited', untilAt: AT + 5_000, strandCause: 'limited', restartable: 1 });
  });
});

describe('recordReadiness: refusals leave nothing', () => {
  it('recordReadinessInTx outside a transaction throws, with no row and no line', () => {
    const db = openDb();
    expect(() => recordReadinessInTx(db, W('ready'), AT)).toThrow(/readiness line refused/);
    expect(rows(db)).toHaveLength(0);
    expect(lines(db)).toHaveLength(0);
  });

  it('an out-of-vocabulary word answers `word` and writes nothing', () => {
    const db = openDb();
    expect(rec(db, 'imaginary', AT)).toEqual({ ok: false, why: 'word' });
    expect(rows(db)).toHaveLength(0);
    expect(lines(db)).toHaveLength(0);
  });

  it('a failed insert answers `write` and rolls the stamped line back', () => {
    const db = openDb();
    db.exec("CREATE TRIGGER readiness_fail BEFORE INSERT ON overlord_readiness BEGIN SELECT RAISE(ABORT, 'no'); END");
    expect(rec(db, 'ready', AT)).toEqual({ ok: false, why: 'write' });
    expect(lines(db)).toHaveLength(0);
    db.exec('DROP TRIGGER readiness_fail');
    expect(rec(db, 'ready', AT)).toMatchObject({ ok: true });
    expect(lines(db)).toHaveLength(1);
  });
});

describe('recordReadiness: the same word', () => {
  it('with new detail updates the newest row in place: no new row, no new line', () => {
    const db = openDb();
    rec(db, 'stranded', AT, { why: 'x', strandCause: 'limited' });
    const before = rows(db)[0]!;
    const r = rec(db, 'stranded', AT + 10, { why: 'y', until: AT + 99, strandCause: 'limited', restartable: true });
    expect(r).toEqual({ ok: true, changed: true, rowId: 1, episodeFirst: false });
    expect(rows(db)).toHaveLength(1);
    expect(lines(db)).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ why: 'y', untilAt: AT + 99, restartable: 1, at: AT, seq: before.seq });
  });

  it('each detail column alone is a change', () => {
    const db = openDb();
    rec(db, 'stranded', AT, { why: 'x', strandCause: 'limited' });
    expect(rec(db, 'stranded', AT, { why: 'z', strandCause: 'limited' })).toMatchObject({ changed: true });
    expect(rec(db, 'stranded', AT, { why: 'z', until: 5, strandCause: 'limited' })).toMatchObject({ changed: true });
    expect(rec(db, 'stranded', AT, { why: 'z', until: 5, strandCause: 'projection' })).toMatchObject({ changed: true });
    expect(rec(db, 'stranded', AT, { why: 'z', until: 5, strandCause: 'projection', restartable: true })).toMatchObject({ changed: true });
    expect(rows(db)).toHaveLength(1);
  });

  it('an identical answer writes nothing', () => {
    const db = openDb();
    rec(db, 'dead', AT, { why: 'gone' });
    const snap = JSON.stringify([rows(db), lines(db)]);
    expect(rec(db, 'dead', AT + 5, { why: 'gone' })).toEqual({ ok: true, changed: false, rowId: 1, episodeFirst: false });
    expect(JSON.stringify([rows(db), lines(db)])).toBe(snap);
  });

  it('a different session with the same word is a new row', () => {
    const db = openDb();
    rec(db, 'unproved', AT);
    expect(rec(db, 'unproved', AT + 1, { sessionId: B })).toMatchObject({ changed: true, rowId: 2 });
    expect(rows(db)).toHaveLength(2);
  });
});

describe('episodeFirst and pushedAt', () => {
  it('dead, unmeasured, dead of one session is ONE episode', () => {
    const db = openDb();
    expect(rec(db, 'dead', AT)).toMatchObject({ ok: true, episodeFirst: true });
    expect(rec(db, 'unmeasured', AT + 1)).toMatchObject({ ok: true, episodeFirst: false });
    expect(rec(db, 'dead', AT + 2)).toMatchObject({ ok: true, episodeFirst: false });
    expect(rows(db).map((r) => r.pushedAt)).toEqual([AT, null, null]);
  });

  it('dead, restarting, dead is TWO episodes', () => {
    const db = openDb();
    expect(rec(db, 'dead', AT)).toMatchObject({ episodeFirst: true });
    expect(rec(db, 'restarting', AT + 1)).toMatchObject({ episodeFirst: false });
    expect(rec(db, 'dead', AT + 2)).toMatchObject({ episodeFirst: true });
    expect(rows(db).map((r) => r.pushedAt)).toEqual([AT, null, AT + 2]);
  });

  it('a dead of session A then a dead of session B (a rebind) starts a new episode', () => {
    const db = openDb();
    expect(rec(db, 'dead', AT, { sessionId: A })).toMatchObject({ episodeFirst: true });
    expect(rec(db, 'dead', AT + 1, { sessionId: B })).toMatchObject({ episodeFirst: true });
    expect(rows(db).map((r) => r.pushedAt)).toEqual([AT, AT + 1]);
  });
});

describe('readinessNow', () => {
  it('answers `none` on an empty table', () => {
    expect(nowOf(openDb())).toBe('none');
  });

  it('never ready: readySince and leftReadyAt are null', () => {
    const db = openDb();
    rec(db, 'unproved', AT);
    expect(nowOf(db)).toMatchObject({ word: 'unproved', readySince: null, leftReadyAt: null, episodeFirstId: null, pushedAt: null });
  });

  it('readySince is the newest ready row\'s at; leftReadyAt the at of the first row after it', () => {
    const db = openDb();
    rec(db, 'ready', AT);
    rec(db, 'wedged', AT + 10);
    rec(db, 'ready', AT + 20);
    expect(nowOf(db)).toMatchObject({ word: 'ready', readySince: AT + 20, leftReadyAt: null });
    rec(db, 'deaf', AT + 30);
    rec(db, 'wedged', AT + 40);
    expect(nowOf(db)).toMatchObject({ word: 'wedged', readySince: AT + 20, leftReadyAt: AT + 30 });
  });

  it('while dead, episodeFirstId and pushedAt name the episode\'s first row', () => {
    const db = openDb();
    rec(db, 'ready', AT);
    rec(db, 'dead', AT + 10);
    rec(db, 'unmeasured', AT + 20);
    rec(db, 'dead', AT + 30, { why: 'again' });
    expect(nowOf(db)).toMatchObject({ id: 4, word: 'dead', episodeFirstId: 2, pushedAt: AT + 10, readySince: AT, leftReadyAt: AT + 10 });
  });

  it('a later episode names its own first row, not the earlier one', () => {
    const db = openDb();
    rec(db, 'dead', AT);
    rec(db, 'restarting', AT + 1);
    rec(db, 'dead', AT + 2);
    expect(nowOf(db)).toMatchObject({ episodeFirstId: 3, pushedAt: AT + 2 });
  });

  it('carries the newest row\'s detail', () => {
    const db = openDb();
    rec(db, 'stranded', AT, { why: 'w', until: AT + 7, strandCause: 'limited', restartable: true });
    expect(nowOf(db)).toMatchObject({ sessionId: A, why: 'w', until: AT + 7, strandCause: 'limited', restartable: true, at: AT });
  });

  it('a row with an unknown word is unreadable, never a guess', () => {
    const db = openDb();
    rec(db, 'ready', AT);
    db.prepare("UPDATE overlord_readiness SET word = 'from-the-future'").run();
    expect(readinessNow(db)).toMatchObject({ ok: false });
  });
});

describe('readinessChanges', () => {
  it('serves the half-open window [since, until), oldest first, with the table\'s oldest at', () => {
    const db = openDb();
    rec(db, 'unproved', 100);
    rec(db, 'ready', 200);
    rec(db, 'wedged', 300);
    rec(db, 'ready', 400);
    const r = readinessChanges(db, 200, 400);
    expect(r).toMatchObject({ ok: true, oldest: 100 });
    if (!r.ok) return;
    expect(r.rows.map((x) => [x.word, x.at])).toEqual([['ready', 200], ['wedged', 300]]);
    expect(r.rows[0]).toMatchObject({ sessionId: A, restartable: false, pushedAt: null });
  });

  it('an empty window still answers the oldest, and an empty table answers null', () => {
    const db = openDb();
    expect(readinessChanges(db, 0, 1_000)).toEqual({ ok: true, rows: [], oldest: null });
    rec(db, 'ready', 100);
    expect(readinessChanges(db, 500, 600)).toEqual({ ok: true, rows: [], oldest: 100 });
  });
});

describe('the item records', () => {
  const item = (db: DatabaseSync, over: Record<string, unknown> = {}): number => {
    const r = db.prepare("INSERT INTO operator_items (program, raisedBy, kind, title, why, how, neededBy, state, raisedAt) "
      + "VALUES ('p', 'server', 'do', 't', 'w', 'h', 'soon', ?, ?)").run((over.state as string) ?? 'open', AT);
    return Number(r.lastInsertRowid);
  };
  const record = (db: DatabaseSync, kind: string, key: string, itemId: number, raisedAt = AT): number =>
    Number(db.prepare('INSERT INTO overlord_readiness_items (item, key, itemId, raisedAt) VALUES (?, ?, ?, ?)').run(kind, key, itemId, raisedAt).lastInsertRowid);

  it('joins each open record to its item\'s state, `missing` when the item row is gone, and omits settled records', () => {
    const db = openDb();
    const i1 = item(db, { state: 'checking' });
    const i2 = item(db);
    const r1 = record(db, 'stranded', 'limited', i1, AT + 1);
    const r2 = record(db, 'count', 'restarts', 9999, AT + 2);
    const r3 = record(db, 'hold', 'lane-a', i2, AT + 3);
    db.prepare('UPDATE overlord_readiness_items SET settledAt = ? WHERE id = ?').run(AT + 9, r3);
    const r = openReadinessItems(db);
    expect(r).toEqual({ ok: true, rows: [
      { id: r1, item: 'stranded', key: 'limited', itemId: i1, raisedAt: AT + 1, itemState: 'checking' },
      { id: r2, item: 'count', key: 'restarts', itemId: 9999, raisedAt: AT + 2, itemState: 'missing' },
    ] });
  });

  it('an item in a state this build does not know is unreadable', () => {
    const db = openDb();
    record(db, 'stranded', 'limited', item(db, { state: 'from-the-future' }));
    expect(openReadinessItems(db)).toMatchObject({ ok: false });
  });

  it('closeReadinessItem stamps settledAt and closedBy operator once, and frees the (item, key) for a new record', () => {
    const db = openDb();
    const id = record(db, 'stranded', 'limited', item(db));
    expect(() => record(db, 'stranded', 'limited', item(db))).toThrow(/UNIQUE/);
    expect(closeReadinessItem(db, id, AT + 5)).toEqual({ changed: true });
    expect(db.prepare('SELECT settledAt, closedBy FROM overlord_readiness_items WHERE id = ?').get(id)).toEqual({ settledAt: AT + 5, closedBy: 'operator' });
    expect(closeReadinessItem(db, id, AT + 6)).toEqual({ changed: false });
    expect(db.prepare('SELECT settledAt FROM overlord_readiness_items WHERE id = ?').get(id)).toEqual({ settledAt: AT + 5 });
    expect(() => record(db, 'stranded', 'limited', item(db))).not.toThrow();
    expect(closeReadinessItem(db, 99_999, AT)).toEqual({ changed: false });
  });
});

describe('pruneReadiness', () => {
  it('removes old rows but keeps the newest row, the newest ready row and an open dead episode\'s first row', () => {
    const db = openDb();
    rec(db, 'unproved', 10);          // 1: old, removed
    rec(db, 'ready', 20);             // 2: the newest ready row, kept
    rec(db, 'wedged', 30);            // 3: old, removed
    rec(db, 'dead', 40);              // 4: the open episode's first row, kept
    rec(db, 'unmeasured', 50);        // 5: old, removed
    rec(db, 'dead', 60, { why: 'x' }); // 6: the newest row, kept
    expect(pruneReadiness(db, 1_000)).toEqual({ removed: 3 });
    expect(rows(db).map((r) => r.id)).toEqual([2, 4, 6]);
    expect(nowOf(db)).toMatchObject({ episodeFirstId: 4, pushedAt: 40, readySince: 20 });
  });

  it('keeps rows at or after the cutoff, removes nothing on an empty table, and is idempotent', () => {
    const db = openDb();
    expect(pruneReadiness(db, 1_000)).toEqual({ removed: 0 });
    rec(db, 'unproved', 10);
    rec(db, 'wedged', 500);
    rec(db, 'ready', 600);
    expect(pruneReadiness(db, 500)).toEqual({ removed: 1 });
    expect(pruneReadiness(db, 500)).toEqual({ removed: 0 });
    expect(rows(db)).toHaveLength(2);
  });

  it('a closed dead episode\'s first row is not kept', () => {
    const db = openDb();
    rec(db, 'dead', 10);
    rec(db, 'restarting', 20);
    rec(db, 'ready', 30);
    expect(pruneReadiness(db, 25)).toEqual({ removed: 2 });
    expect(rows(db).map((r) => r.word)).toEqual(['ready']);
  });
});

describe('one transaction around a pass', () => {
  it('a caller\'s own rollback takes the row and the line together', () => {
    const db = openDb();
    expect(() => tx(db, () => { recordReadinessInTx(db, W('ready'), AT); throw new Error('abort'); })).toThrow('abort');
    expect(rows(db)).toHaveLength(0);
    expect(lines(db)).toHaveLength(0);
  });
});
