// Overlord W2, act journal plan Task A2: the act journal's writer (`server/src/coord/overlordActJournal.ts#OverlordActJournal`, L3),
// its head row and its torn-tail heal. Real journals under `mkTmp`, a real coordination database file, the real guard behind a
// spy; never the live HOME. Until #3664 lands, `overlord_acts` is a one-column stand-in, created here (the writer reads only
// whether it holds a row).
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, constants as FS, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NODE_APPEND_ONLY_FS, type AppendOnlyFsOps } from '../src/appendOnlyFile.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { tx } from '../src/coord/tx.js';
import { OverlordAuthorityGuard } from '../src/coord/overlordAuthorityGuard.js';
import type { AuthorityWriterFailure } from '../src/coord/overlordAuthorityJournal.js';
import type { OverlordJournalName } from '../src/coord/overlordAuthorityCoherence.js';
import { OVERLORD_ACTS_BASENAME, OVERLORD_ACTS_TORN_DIR, type OverlordActRecord } from '../src/coord/overlordActRecords.js';
import { OverlordActJournal, overlordActsFileAt } from '../src/coord/overlordActJournal.js';
import { INTENT, OPEN, SETTLE } from './sim/overlordActJournalSets.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const HEAD_MIGRATION = MIGRATIONS.find((sql) => sql.includes('CREATE TABLE overlord_act_journal_head'))!;
type Fault = 'none' | 'open' | 'write' | 'fsync' | 'write2' | 'read';
type R = OverlordActRecord;
const settle = (actId: number, from: 'pending' | 'unknown' | null, to = 'done'): R => ({ ...SETTLE, actId, from, to } as R);
const intent = (actId: number): R => ({ ...INTENT, actId } as R);

function rig() {
  const dir = mkTmp('ccrc-actjournal-');
  const leaf = path.join(dir, OVERLORD_ACTS_BASENAME);
  const db = new DatabaseSync(path.join(dir, 'coord.db'));
  db.exec(HEAD_MIGRATION);
  db.exec('CREATE TABLE overlord_acts (id INTEGER PRIMARY KEY)');   // the stand-in until #3664 lands
  const fault = { now: 'none' as Fault };
  let wrote = false;
  let writes = 0;
  const eio = (): never => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); };
  const ops: AppendOnlyFsOps = {
    ...NODE_APPEND_ONLY_FS,
    openSync: (p, flags, mode) => {
      if (fault.now === 'open' && (flags & FS.O_APPEND) !== 0) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      // the leaf's read open (neither an append nor the directory)
      if (fault.now === 'read' && (flags & FS.O_APPEND) === 0 && (flags & FS.O_DIRECTORY) === 0) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return NODE_APPEND_ONLY_FS.openSync(p, flags, mode);
    },
    writeSync: (fd, b, o, l) => {
      writes += 1;
      if (fault.now === 'write' || (fault.now === 'write2' && writes === 2)) eio();
      wrote = true;
      return NODE_APPEND_ONLY_FS.writeSync(fd, b, o, l);
    },
    fsyncSync: (fd) => { if (fault.now === 'fsync' && wrote) eio(); NODE_APPEND_ONLY_FS.fsyncSync(fd); },
  };
  const failures: [AuthorityWriterFailure, OverlordJournalName | undefined][] = [];
  let journal!: OverlordActJournal;
  const guard = new OverlordAuthorityGuard({ healTornTail: () => ({ kind: 'no-tail' }), measure: () => journal.measure(db) });
  const spy = { state: () => guard.state(), writerFailed: (c: AuthorityWriterFailure, j?: OverlordJournalName) => { failures.push([c, j]); guard.writerFailed(c, j); } };
  journal = new OverlordActJournal(overlordActsFileAt(dir, ops), { clock: fakeTime({ wallMs: Date.parse('2026-11-28T10:00:00.000Z') }).ports.clock }, spy);
  guard.bootVerdict(journal.measure(db));
  const order: string[] = [];
  return {
    dir, leaf, db, guard, journal, fault, failures, order,
    head: () => db.prepare('SELECT sequence, journalId, digest, at, requestFloor FROM overlord_act_journal_head').get() as
      { sequence: number; journalId: string; digest: string; at: number; requestFloor: number } | undefined,
    lines: () => (existsSync(leaf) ? readFileSync(leaf, 'utf8').split('\n').filter((l) => l !== '') : []),
    /** One write inside a transaction, with an apply that records it ran and whether the head row was there before it. */
    write: (records: readonly R[], applyThrows = false) => tx(db, () => journal.appendInTx(db, records, () => {
      const h = db.prepare('SELECT sequence FROM overlord_act_journal_head').get() as { sequence: number } | undefined;
      order.push(`apply after head ${h?.sequence ?? 'none'}`);
      db.prepare('INSERT INTO overlord_acts (id) VALUES (NULL)').run();
      if (applyThrows) throw new Error('the apply failed');
    })),
  };
}

describe('Table 2, row by row', () => {
  it('row 1: outside a transaction, not-in-transaction, and nothing is read or written', () => {
    const r = rig();
    expect(r.journal.appendInTx(r.db, [settle(1, null)], () => { throw new Error('never'); })).toMatchObject({ ok: false, error: 'not-in-transaction' });
    expect(r.lines()).toEqual([]);
    expect(r.failures).toEqual([]);
  });

  it('row 2: the guard unmeasured answers authority-unmeasured, and appends nothing', () => {
    const r = rig();
    r.guard.writerFailed('rows-unreadable');
    expect(r.write([settle(1, null)])).toMatchObject({ ok: false, error: 'authority-unmeasured' });
    expect([r.lines(), r.order]).toEqual([[], []]);
  });

  it('row 3: the guard rolled back answers authority-rolled-back, and appends nothing', () => {
    const r = rig();
    r.guard.writerFailed('behind');
    expect(r.write([settle(1, null)])).toMatchObject({ ok: false, error: 'authority-rolled-back' });
    expect([r.lines(), r.order]).toEqual([[], []]);
  });

  it('row 4: a head row that cannot be read answers authority-unmeasured and tells the guard rows-unreadable, naming the act journal', () => {
    const r = rig();
    r.db.exec('DROP TABLE overlord_act_journal_head');
    expect(r.write([settle(1, null)])).toMatchObject({ ok: false, error: 'authority-unmeasured' });
    expect(r.failures).toEqual([['rows-unreadable', 'acts']]);
    expect(r.guard.state()).toStrictEqual({ kind: 'unmeasured', why: 'rows', journal: 'acts' });
    expect(r.lines()).toEqual([]);
  });

  it('row 4: a file that cannot be read answers authority-unmeasured and tells the guard journal-unreadable, appending nothing', () => {
    const r = rig();
    expect(r.write([settle(1, null)])).toEqual({ ok: true });
    r.fault.now = 'read';
    expect(r.write([settle(2, null)])).toMatchObject({ ok: false, error: 'authority-unmeasured' });
    expect(r.failures).toEqual([['journal-unreadable', 'acts']]);
    r.fault.now = 'none';
    expect(r.lines()).toHaveLength(1);
  });

  it('row 5: a head row behind the file reads trailing, refuses authority-rolled-back and fences, the act journal named', () => {
    const r = rig();
    expect(r.write([settle(1, null)])).toEqual({ ok: true });
    r.db.exec('DELETE FROM overlord_act_journal_head');
    expect(r.write([settle(2, null)])).toMatchObject({ ok: false, error: 'authority-rolled-back' });
    expect(r.failures).toEqual([['trailing', 'acts']]);
    expect(r.guard.state()).toStrictEqual({ kind: 'rolled-back', cause: 'trailing', journal: 'acts' });
    expect(r.lines()).toHaveLength(1);
  });

  it('row 5: a stated from the fold contradicts refuses and tells the guard diverged', () => {
    const r = rig();
    expect(r.write([intent(4)])).toEqual({ ok: true });
    expect(r.write([settle(4, 'unknown', 'done')])).toMatchObject({ ok: false, error: 'authority-rolled-back' });
    expect(r.failures).toEqual([['diverged', 'acts']]);
    expect(r.lines()).toHaveLength(1);
  });

  it('row 5: a one-step settle (from null) of an act the journal already holds is diverged; an intent of one too', () => {
    for (const second of [settle(4, null), intent(4)]) {
      const r = rig();
      expect(r.write([settle(4, null)])).toEqual({ ok: true });
      expect(r.write([second])).toMatchObject({ ok: false, error: 'authority-rolled-back' });
      expect(r.failures).toEqual([['diverged', 'acts']]);
    }
  });

  it('row 6: coherent and agreeing: the record is appended, then the head row, then the apply, and the answer is ok', () => {
    const r = rig();
    expect(r.write([settle(1, null)])).toEqual({ ok: true });
    expect(r.order).toEqual(['apply after head 1']);
    const rec = JSON.parse(r.lines()[0]!) as { sequence: number; journalId: string; digest: string; entry: R };
    expect(r.head()).toEqual({ sequence: 1, journalId: rec.journalId, digest: rec.digest, at: Date.parse('2026-11-28T10:00:00.000Z'), requestFloor: 0 });
    expect(rec.entry).toEqual(settle(1, null));
    expect(r.failures).toEqual([]);
  });
});

describe('records in a row', () => {
  it('two records of one write chain, the head row is the second, and the open-request follows its settle', () => {
    const r = rig();
    expect(r.write([settle(1, null), { ...OPEN, actId: 1, requestId: 9 } as R])).toEqual({ ok: true });
    const recs = r.lines().map((l) => JSON.parse(l) as { sequence: number; previousDigest: string | null; digest: string; entry: R });
    expect(recs.map((x) => [x.sequence, x.entry.kind])).toEqual([[1, 'act-settle'], [2, 'act-open-request']]);
    expect(recs[1]!.previousDigest).toBe(recs[0]!.digest);
    expect(r.head()?.sequence).toBe(2);
    expect(r.order).toEqual(['apply after head 2']);
  });

  it('a second write re-reads the file: an intent, then its settle from pending, chain from the first write\'s head', () => {
    const r = rig();
    expect(r.write([intent(2)])).toEqual({ ok: true });
    expect(r.write([settle(2, 'pending', 'unknown')])).toEqual({ ok: true });
    expect(r.write([settle(2, 'unknown', 'refused')])).toEqual({ ok: true });
    expect(r.head()?.sequence).toBe(3);
    expect(r.journal.readHighest()).toEqual({ kind: 'measured', act: 2, request: 0 });
  });

  it('the writer canonicalises: targets in another order are written in one order', () => {
    const r = rig();
    expect(r.write([{ ...settle(1, null), targets: [...SETTLE.targets].reverse() } as R])).toEqual({ ok: true });
    expect((JSON.parse(r.lines()[0]!) as { entry: R & { targets: unknown } }).entry.targets).toEqual(SETTLE.targets);
  });

  it('records the grammar refuses, or none, answer journal-append before anything is read or written, and the guard is not told', () => {
    const r = rig();
    expect(r.write([{ ...settle(1, null), authority: 'because' } as R])).toMatchObject({ ok: false, error: 'journal-append' });
    expect(r.write([])).toMatchObject({ ok: false, error: 'journal-append' });
    expect([r.lines(), r.failures, r.order]).toEqual([[], [], []]);
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
  });
});

describe('a failure at or after the append fences at once (F12)', () => {
  for (const fault of ['open', 'write', 'fsync'] as const) {
    it(`a port that fails at ${fault} answers journal-append, never throws, and tells the guard trailing for the act journal`, () => {
      const r = rig();
      r.fault.now = fault;
      expect(r.write([settle(1, null)])).toMatchObject({ ok: false, error: 'journal-append' });
      expect(r.failures).toEqual([['trailing', 'acts']]);
      expect(r.guard.state()).toStrictEqual({ kind: 'rolled-back', cause: 'trailing', journal: 'acts' });
      expect(r.order).toEqual([]);
    });
  }

  it('a failure on the second record of one write tells the guard trailing: the first stands, and no apply runs', () => {
    const r = rig();
    r.fault.now = 'write2';
    expect(r.write([settle(1, null), { ...OPEN, actId: 1, requestId: 9 } as R])).toMatchObject({ ok: false, error: 'journal-append' });
    expect(r.failures).toEqual([['trailing', 'acts']]);
    expect(r.lines()).toHaveLength(1);
    expect(r.order).toEqual([]);
  });

  it('an apply that throws after the append answers journal-append and tells the guard trailing in the same call, before the rollback', () => {
    const r = rig();
    let stateInCall: unknown = null;
    const out = tx(r.db, () => {
      const a = r.journal.appendInTx(r.db, [settle(1, null)], () => { throw new Error('the row failed'); });
      stateInCall = r.guard.state();
      return a;
    });
    expect(out).toMatchObject({ ok: false, error: 'journal-append' });
    expect(stateInCall).toStrictEqual({ kind: 'rolled-back', cause: 'trailing', journal: 'acts' });
    expect(r.failures).toEqual([['trailing', 'acts']]);
    expect(r.lines()).toHaveLength(1);   // the record stands: the file is never behind the database
  });

  it('a returning apply runs after the head row is written', () => {
    const r = rig();
    expect(r.write([settle(1, null)])).toEqual({ ok: true });
    expect(r.order).toEqual(['apply after head 1']);
  });
});

describe('the torn-tail heal', () => {
  it('cuts only a torn tail behind a sound prefix whose last record is the head row, into overlord-acts-torn', () => {
    const r = rig();
    expect(r.write([settle(1, null)])).toEqual({ ok: true });
    appendFileSync(r.leaf, '{"v":1,"seq');
    const heal = r.journal.healTornTail(r.db);
    expect(heal.kind).toBe('healed');
    expect(r.lines()).toHaveLength(1);
    expect(readdirSync(path.join(r.dir, OVERLORD_ACTS_TORN_DIR))).toHaveLength(1);
    expect(r.journal.measure(r.db)).toEqual({ kind: 'coherent' });
  });

  it('refuses a tail behind a head row that differs, and one over an unreadable head row; no tail is no-tail', () => {
    const r = rig();
    expect(r.journal.healTornTail(r.db)).toEqual({ kind: 'no-tail' });
    expect(r.write([settle(1, null)])).toEqual({ ok: true });
    appendFileSync(r.leaf, '{"v"');
    r.db.exec('DELETE FROM overlord_act_journal_head');
    expect(r.journal.healTornTail(r.db)).toEqual({ kind: 'not-healable' });
    r.db.exec('DROP TABLE overlord_act_journal_head');
    expect(r.journal.healTornTail(r.db)).toEqual({ kind: 'unmeasured' });
    expect(existsSync(path.join(r.dir, OVERLORD_ACTS_TORN_DIR))).toBe(false);
  });
});

describe('boot coherence over the head row (the writer\'s measure)', () => {
  it('a fresh box reads coherent; an act row with no record reads missing', () => {
    const r = rig();
    expect(r.journal.measure(r.db)).toEqual({ kind: 'coherent' });
    r.db.exec('INSERT INTO overlord_acts (id) VALUES (1)');
    expect(r.journal.measure(r.db)).toEqual({ kind: 'rolled-back', cause: 'missing' });
  });
});
