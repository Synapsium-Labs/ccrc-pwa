// Overlord W1 sequence, plan `w1-sequence-monitor.md` Tasks 1 and 3: the one sequence's tables, its one writer, its prune and its
// reads (`overlordSequenceStore.ts`), over a coord db opened through the real migrations.
import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb, tx } from '../src/coord/db.js';
import {
  designationBaseline, isSequenceStampKebab, pruneSequenceThrough, sequenceAfter, sequenceOldest, STAMP_FAILURES, stampSequenceInTx, type SequenceLineInput,
} from '../src/coord/overlordSequenceStore.js';
import { LINE_REFUSALS, sequencePage } from '../src/coord/overlordSequence.js';
import { SEQUENCE_KINDS } from '../../shared/overlord-sequence.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

let template = '';
const opened: DatabaseSync[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-sequence-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } } });
afterAll(() => removeTmpFixtures());

const openDb = (): DatabaseSync => {
  const dir = path.join(mkTmp('ccrc-sequence-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  return db;
};

const AT = 1_800_000_000_000;
const LINE: SequenceLineInput = { kind: 'generation', id: '7', state: 'carded', actor: 'server', actorKind: 'server', at: AT };
const stamp = (db: DatabaseSync, over: Partial<SequenceLineInput> = {}) => tx(db, () => stampSequenceInTx(db, { ...LINE, ...over }));
const count = (db: DatabaseSync): number => Number((db.prepare('SELECT count(*) AS n FROM overlord_sequence').get() as { n: number }).n);

describe('sequence stamp refusal vocabulary', () => {
  it('admits every derived refusal word to the coordination census', () => {
    for (const word of [...LINE_REFUSALS, ...STAMP_FAILURES]) expect(isSequenceStampKebab(word), word).toBe(true);
  });
  it('admits each sequence kind, a line\'s own label, and no other look-alike', () => {
    for (const kind of SEQUENCE_KINDS) expect(isSequenceStampKebab(kind), kind).toBe(true);
    expect(isSequenceStampKebab('ladder-step')).toBe(false);
  });
  it('does not admit an unknown refusal word to the coordination census', () => {
    expect(isSequenceStampKebab('imaginary-sequence-refusal')).toBe(false);
  });
});

describe('stampSequenceInTx, the one writer', () => {
  it('inside tx() a stamp answers the next number and the line reads back with every column', () => {
    const db = openDb();
    expect(stamp(db)).toEqual({ ok: true, seq: 1 });
    expect(stamp(db, { kind: 'designation', id: 'overlord-a', state: 'live', actor: 'acct:operator-a', actorKind: 'operator', at: AT + 1 }))
      .toEqual({ ok: true, seq: 2 });
    expect(db.prepare('SELECT * FROM overlord_sequence ORDER BY seq').all()).toEqual([
      { seq: 1, kind: 'generation', id: '7', state: 'carded', actor: 'server', actorKind: 'server', at: AT },
      { seq: 2, kind: 'designation', id: 'overlord-a', state: 'live', actor: 'acct:operator-a', actorKind: 'operator', at: AT + 1 },
    ]);
  });
  it('outside a transaction it answers not-in-transaction and writes nothing', () => {
    const db = openDb();
    const a = stampSequenceInTx(db, LINE);
    expect(a).toMatchObject({ ok: false, error: 'not-in-transaction' });
    expect(count(db)).toBe(0);
  });
  it('a refused line answers its word and writes nothing', () => {
    const db = openDb();
    expect(stamp(db, { state: 'live' })).toMatchObject({ ok: false, error: 'unknown-state' });
    expect(stamp(db, { kind: 'grant' as SequenceLineInput['kind'] })).toMatchObject({ ok: false, error: 'unknown-kind' });
    expect(stamp(db, { id: '' })).toMatchObject({ ok: false, error: 'bad-id' });
    expect(stamp(db, { at: -1 })).toMatchObject({ ok: false, error: 'bad-at' });
    expect(count(db)).toBe(0);
  });
  it('a failed insert answers write-failed and never throws', () => {
    const db = openDb();
    db.exec("CREATE TRIGGER refuse BEFORE INSERT ON overlord_sequence BEGIN SELECT RAISE(ABORT, 'refused'); END");
    expect(stamp(db)).toMatchObject({ ok: false, error: 'write-failed', detail: expect.stringContaining('refused') });
  });
  it('a stamp inside a tx() that then throws leaves no line', () => {
    const db = openDb();
    expect(() => tx(db, () => { stampSequenceInTx(db, LINE); throw new Error('the row write failed'); })).toThrow('the row write failed');
    expect(count(db)).toBe(0);
  });
  it('numbers rise across transactions, and after every line is deleted the next continues above the highest issued', () => {
    const db = openDb();
    for (let i = 0; i < 3; i++) stamp(db);
    db.exec('DELETE FROM overlord_sequence');
    expect(stamp(db)).toEqual({ ok: true, seq: 4 });
  });
});

describe('overlord_sequence_pruned', () => {
  it('SQLite refuses a second row and a floor of 0', () => {
    const db = openDb();
    db.prepare('INSERT INTO overlord_sequence_pruned (one, through) VALUES (1, 5)').run();
    expect(() => db.prepare('INSERT INTO overlord_sequence_pruned (one, through) VALUES (2, 5)').run()).toThrow(/CHECK/);
    expect(() => db.prepare('INSERT INTO overlord_sequence_pruned (one, through) VALUES (1, 6)').run()).toThrow(/UNIQUE|PRIMARY/);
    db.exec('DELETE FROM overlord_sequence_pruned');
    expect(() => db.prepare('INSERT INTO overlord_sequence_pruned (one, through) VALUES (1, 0)').run()).toThrow(/CHECK/);
  });
});

describe('the prune and the reads', () => {
  const fill = (db: DatabaseSync, kinds: readonly ('g' | 'd')[]): void => {
    kinds.forEach((k, i) => stamp(db, k === 'g' ? { at: AT + i } : { kind: 'designation', id: 'overlord-a', state: 'live', at: AT + i }));
  };
  it('sequenceOldest marks keep the newest designation line, which here is also the newest live one, and no other', () => {
    const db = openDb();
    fill(db, ['g', 'd', 'g', 'd', 'g']);
    const r = sequenceOldest(db, 10);
    expect(r).toEqual({ kind: 'measured', value: [1, 2, 3, 4, 5].map((seq) => ({ seq, at: AT + seq - 1, keep: seq === 4 })) });
    expect(sequenceOldest(db, 2)).toEqual({ kind: 'measured', value: [{ seq: 1, at: AT, keep: false }, { seq: 2, at: AT + 1, keep: false }] });
  });
  it('sequenceOldest marks keep only the standing binding\'s live line while a rebind is pending or after one failed (review 3740 F2, call 1077)', () => {
    const db = openDb();
    stamp(db, { kind: 'designation', id: 'overlord-a', state: 'live', at: AT });
    stamp(db, { at: AT + 1 });
    stamp(db, { kind: 'designation', id: 'overlord-b', state: 'pending', at: AT + 2 });
    stamp(db, { kind: 'designation', id: 'overlord-b', state: 'failed', at: AT + 3 });
    stamp(db, { at: AT + 4 });
    const r = sequenceOldest(db, 10);
    expect(r).toEqual({ kind: 'measured', value: [1, 2, 3, 4, 5].map((seq) => ({ seq, at: AT + seq - 1, keep: seq === 1 })) });
  });

  describe('the term baseline (review 3740 F2, call 1077): while a binding stands, the newest live designation line', () => {
    const d = (db: DatabaseSync, id: string, state: string, at: number): void => { stamp(db, { kind: 'designation', id, state, at }); };
    const baselineOf = (db: DatabaseSync): unknown => {
      const r = designationBaseline(db);
      if (r.kind !== 'measured') throw new Error(r.why);
      return r.value === null ? null : { id: r.value.id, state: r.value.state, seq: r.value.seq };
    };
    const kept = (db: DatabaseSync): number[] => {
      const r = sequenceOldest(db, 100);
      if (r.kind !== 'measured') throw new Error(r.why);
      return r.value.filter((l) => l.keep).map((l) => l.seq);
    };
    it('no designation line: no baseline, nothing kept', () => {
      const db = openDb(); stamp(db);
      expect(baselineOf(db)).toBeNull(); expect(kept(db)).toEqual([]);
    });
    it('after a rebind\'s go-live: the new body\'s live line, whichever order go-live stamps its two lines in', () => {
      for (const order of [['retired', 'live'], ['live', 'retired']] as const) {
        const db = openDb();
        d(db, 'overlord-a', 'pending', AT); d(db, 'overlord-a', 'live', AT + 1); d(db, 'overlord-b', 'pending', AT + 2);
        for (const st of order) d(db, st === 'live' ? 'overlord-b' : 'overlord-a', st, AT + 3);
        const liveSeq = order[0] === 'live' ? 4 : 5;
        expect(baselineOf(db)).toEqual({ id: 'overlord-b', state: 'live', seq: liveSeq });
        expect(kept(db)).toEqual([liveSeq]);
      }
    });
    it('while a rebind is pending: the standing binding\'s live line, not the new body\'s pending', () => {
      const db = openDb();
      d(db, 'overlord-a', 'live', AT); d(db, 'overlord-b', 'pending', AT + 1);
      expect(baselineOf(db)).toEqual({ id: 'overlord-a', state: 'live', seq: 1 });
      expect(kept(db)).toEqual([1]);
    });
    it('after a failed rebind: the standing binding\'s live line, not the failed body\'s line', () => {
      const db = openDb();
      d(db, 'overlord-a', 'live', AT); d(db, 'overlord-b', 'pending', AT + 1); d(db, 'overlord-b', 'failed', AT + 2);
      expect(baselineOf(db)).toEqual({ id: 'overlord-a', state: 'live', seq: 1 });
      expect(kept(db)).toEqual([1]);
    });
    it('after a retire with no binding: the last line, as before (and a later pending-only attempt\'s line after it)', () => {
      const db = openDb();
      d(db, 'overlord-a', 'live', AT); d(db, 'overlord-a', 'retired', AT + 1);
      expect(baselineOf(db)).toEqual({ id: 'overlord-a', state: 'retired', seq: 2 });
      expect(kept(db)).toEqual([2]);
      d(db, 'overlord-b', 'pending', AT + 2);
      expect(baselineOf(db)).toEqual({ id: 'overlord-b', state: 'pending', seq: 3 });
      d(db, 'overlord-a', 'failed', AT + 3); d(db, 'overlord-b', 'failed', AT + 4);
      expect(kept(db)).toEqual([5]);
    });
    it('a retire while a rebind is pending (failed, then retired): the last line', () => {
      const db = openDb();
      d(db, 'overlord-a', 'live', AT); d(db, 'overlord-b', 'pending', AT + 1); d(db, 'overlord-b', 'failed', AT + 2); d(db, 'overlord-a', 'retired', AT + 2);
      expect(baselineOf(db)).toEqual({ id: 'overlord-a', state: 'retired', seq: 4 });
    });
    it('a database it cannot read is unmeasured, never null', () => {
      const db = openDb(); db.close();
      expect(designationBaseline(db)).toMatchObject({ kind: 'unmeasured' });
      expect(sequenceOldest(db, 10)).toMatchObject({ kind: 'unmeasured' });
    });
  });
  it('a prune deletes through the floor, keeps the kept line and raises the floor', () => {
    const db = openDb();
    fill(db, ['g', 'd', 'g', 'g']);
    expect(pruneSequenceThrough(db, 3, [2])).toEqual({ pruned: 2 });
    expect(db.prepare('SELECT seq FROM overlord_sequence ORDER BY seq').all()).toEqual([{ seq: 2 }, { seq: 4 }]);
    expect(db.prepare('SELECT through FROM overlord_sequence_pruned').all()).toEqual([{ through: 3 }]);
  });
  it('a second prune with a lower floor leaves the floor where it was', () => {
    const db = openDb();
    fill(db, ['g', 'g', 'g', 'g']);
    pruneSequenceThrough(db, 3, []);
    expect(pruneSequenceThrough(db, 1, [])).toEqual({ pruned: 0 });
    expect(db.prepare('SELECT through FROM overlord_sequence_pruned').all()).toEqual([{ through: 3 }]);
  });
  it('a floor that is not a positive integer is refused and nothing is deleted', () => {
    const db = openDb();
    fill(db, ['g', 'g']);
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(pruneSequenceThrough(db, bad, [])).toMatchObject({ error: expect.any(String) });
    expect(count(db)).toBe(2);
  });
  it('a page after a prune never serves the kept line, and a cursor below the floor reads gap', () => {
    const db = openDb();
    fill(db, ['g', 'd', 'g', 'g', 'g']);
    pruneSequenceThrough(db, 3, [2]);
    const at = (after: number) => {
      const r = sequenceAfter(db, after, 10);
      if (r.kind !== 'measured') throw new Error(r.why);
      return sequencePage(after, 10, r.value.facts, r.value.lines, 'unmeasured');
    };
    expect(at(0)).toEqual({ kind: 'gap', after: 0, prunedThrough: 3, head: 5, restoreGeneration: 'unmeasured' });
    const page = at(3);
    expect(page.kind === 'page' && page.lines.map((l) => l.seq)).toEqual([4, 5]);
    expect(at(6)).toMatchObject({ kind: 'ahead', head: 5 });
  });
  it('sequenceAfter reads the head from the issued numbers, so an emptied table keeps its head', () => {
    const db = openDb();
    fill(db, ['g', 'g', 'g']);
    pruneSequenceThrough(db, 3, []);
    expect(sequenceAfter(db, 3, 10)).toEqual({ kind: 'measured', value: { facts: { head: 3, prunedThrough: 3 }, lines: [] } });
    expect(sequenceAfter(openDb(), 0, 10)).toEqual({ kind: 'measured', value: { facts: { head: 0, prunedThrough: null }, lines: [] } });
  });
  it('a stored line with an unknown kind or state comes back known: false with its text, and the rest of the page whole', () => {
    const db = openDb();
    stamp(db);
    db.prepare("INSERT INTO overlord_sequence (kind, id, state, actor, actorKind, at) VALUES ('grant', 'operator', 'chat', 'acct:a', 'operator', ?)").run(AT);
    db.prepare("INSERT INTO overlord_sequence (kind, id, state, actor, actorKind, at) VALUES ('generation', '8', 'paused', 'server', 'robot', ?)").run(AT);
    stamp(db, { id: '9' });
    const r = sequenceAfter(db, 0, 10);
    expect(r.kind === 'measured' && r.value.lines).toEqual([
      { seq: 1, at: AT, kind: 'generation', id: '7', state: 'carded', actor: 'server', actorKind: 'server', known: true },
      { seq: 2, at: AT, kind: 'grant', id: 'operator', state: 'chat', actor: 'acct:a', actorKind: 'operator', known: false },
      { seq: 3, at: AT, kind: 'generation', id: '8', state: 'paused', actor: 'server', actorKind: 'unknown', known: false },
      { seq: 4, at: AT, kind: 'generation', id: '9', state: 'carded', actor: 'server', actorKind: 'server', known: true },
    ]);
  });
  it('the read serves the seven named columns and never a later one', () => {
    const db = openDb();
    db.exec('ALTER TABLE overlord_sequence ADD COLUMN drill TEXT');
    stamp(db);
    db.exec("UPDATE overlord_sequence SET drill = 'mark'");
    const r = sequenceAfter(db, 0, 10);
    expect(r.kind === 'measured' && Object.keys(r.value.lines[0]!).sort()).toEqual(['actor', 'actorKind', 'at', 'id', 'kind', 'known', 'seq', 'state']);
  });
  it('a closed database answers unmeasured, never a page or a throw', () => {
    const db = openDb();
    db.close();
    expect(sequenceAfter(db, 0, 10)).toMatchObject({ kind: 'unmeasured', why: expect.any(String) });
    expect(sequenceOldest(db, 10)).toMatchObject({ kind: 'unmeasured' });
    expect(pruneSequenceThrough(db, 1, [])).toMatchObject({ error: expect.any(String) });
  });
});
