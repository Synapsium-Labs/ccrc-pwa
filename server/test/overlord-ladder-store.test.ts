// Overlord W1, ladder plan Task 2: the two ladder tables, their writers and their readers (`overlordLadderStore.ts`), over a coord
// db opened through the real migrations and a FAKE authority appender that records every entry and answers from a scripted
// queue, so each writer's record, its order against the row write, its `from` and its reaction to every row of the journal's
// decision table are pinned without a journal file.
import { describe, it, expect, afterEach } from 'vitest';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { actorOf } from '../src/accounts/audit.js';
const identity = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });
const operator = identity.operator(actorOf('operator-a', ''));
const lane = identity.operator(actorOf('lane-a', ''));

import { DatabaseSync } from 'node:sqlite';
import { tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import {
  applyRestoreInTx, clearLatchInTx, journalPendingInTx, ladderRows, ladderRungRead, raiseLatchInTx, setRungInTx,
  type AuthorityAppender, type LadderWrite,
} from '../src/coord/overlordLadderStore.js';
import { OverlordAuthorityJournal, overlordAuthorityFileAt, type AuthorityAppend, type AuthorityAppendError } from '../src/coord/overlordAuthorityJournal.js';
import { authorityCoherence, type AuthorityState } from '../src/coord/overlordAuthorityCoherence.js';
import { authorityFold, type OverlordAuthorityMove } from '../src/coord/overlordAuthority.js';
import type { Rung } from '../../shared/overlord-ladder.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

// Boot coherence reads the head and each authority table, so each fixture creates all four from their real migrations.
const fixtureMigrations = ['overlord_authority_head', 'overlord_designation', 'overlord_ladder', 'decision_rows'].map((table) => {
  const sql = MIGRATIONS.find((migration) => migration.includes(`CREATE TABLE ${table} (`));
  if (sql === undefined) throw new Error(`migration not found for ${table}`);
  return sql;
});
const opened: DatabaseSync[] = [];
afterEach(() => {
  for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } }
  removeTmpFixtures();
});

const NOW = 1_800_000_000_000;
const openDb = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  for (const sql of fixtureMigrations) db.exec(sql);
  opened.push(db);
  return db;
};

interface Seen { entry: OverlordAuthorityMove; inTx: boolean; rung: Record<string, unknown> | undefined; latches: number }
interface Fake extends AuthorityAppender { seen: Seen[]; script: AuthorityAppend[]; seq: number }
const appended = (sequence: number): AuthorityAppend => ({ ok: true, kind: 'appended', record: { sequence } } as unknown as AuthorityAppend);
const rowOnly = (state: Exclude<AuthorityState, { kind: 'coherent' }> = { kind: 'unmeasured', why: 'journal' }): AuthorityAppend =>
  ({ ok: true, kind: 'row-only', state });
const refuse = (error: AuthorityAppendError): AuthorityAppend => ({ ok: false, error, detail: 'refused for the test' });
function fake(db: DatabaseSync): Fake {
  const f: Fake = {
    seen: [], script: [], seq: 100,
    appendInTx(_db, entry) {
      f.seen.push({
        entry, inTx: db.isTransaction,
        rung: db.prepare('SELECT * FROM overlord_ladder').get() as Record<string, unknown> | undefined,
        latches: (db.prepare('SELECT COUNT(*) AS n FROM overlord_latches').get() as { n: number }).n,
      });
      return f.script.shift() ?? appended(++f.seq);
    },
  };
  return f;
}
const kinds = (f: Fake): string[] => f.seen.map((s) => s.entry.kind);
const rungRow = (db: DatabaseSync): Record<string, unknown> | undefined =>
  db.prepare('SELECT * FROM overlord_ladder').get() as Record<string, unknown> | undefined;
const latchRows = (db: DatabaseSync): Record<string, unknown>[] =>
  db.prepare('SELECT * FROM overlord_latches ORDER BY id').all() as Record<string, unknown>[];
const put = (db: DatabaseSync, rung: string, o: { seq?: number | null; from?: string | null } = {}): void => {
  db.prepare('INSERT OR REPLACE INTO overlord_ladder (id, operatorRung, actor, updatedAt, recordSequence, recordFrom, narrowedAt) VALUES (1, ?, ?, ?, ?, ?, NULL)')
    .run(rung, 'operator-a', NOW - 1, o.seq === undefined ? 1 : o.seq, o.from ?? null);
};
const putLatch = (db: DatabaseSync, cause: string, cap: string, seq: number | null = 7): void => {
  db.prepare('INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy, raiseSequence) VALUES (?, ?, ?, ?, ?, ?)')
    .run(cause, cap, 'because', NOW - 1, 'lane-a', seq);
};

const setRung = (db: DatabaseSync, f: Fake, to: Rung, over: { opKey?: string; actor?: string } = {}): ReturnType<typeof setRungInTx> => {
  const read = ladderRungRead(db);
  const from = read.kind !== 'current' || read.current.kind === 'unreadable' ? 'full' : read.current.kind === 'default' ? 'chat' : read.current.rung;
  return tx(db, () => setRungInTx(db, f, { from, to, actor: over.actor === undefined ? operator : identity.console(true, over.actor.replace(/^device:/, '')), at: NOW, opKey: over.opKey ?? 'op-1' }));
};
const raise = (db: DatabaseSync, f: Fake, cause = 'latch-a', cap: Rung = 'chat', opKey = 'op-r'): ReturnType<typeof raiseLatchInTx> =>
  tx(db, () => raiseLatchInTx(db, f, { cause, cap, detail: 'why', raisedBy: lane, at: NOW, opKey }));
const clear = (db: DatabaseSync, f: Fake, cause = 'latch-a', opKey = 'op-c'): LadderWrite =>
  tx(db, () => clearLatchInTx(db, f, { cause, actor: operator, at: NOW, opKey }));

describe('the reads', () => {
  it('with no row ladderRows answers rung null, and after a write the row', () => {
    const db = openDb();
    expect(ladderRows(db)).toEqual({ kind: 'measured', rung: null, standing: [] });
    expect(ladderRungRead(db)).toEqual({ kind: 'current', current: { kind: 'default' } });
    setRung(db, fake(db), 'off');
    expect(ladderRows(db)).toEqual({
      kind: 'measured', standing: [],
      rung: { operatorRung: 'off', actor: 'operator-a 00000000', updatedAt: NOW, recordSequence: 101, journalled: true, narrowedAt: NOW },
    });
    expect(ladderRungRead(db)).toEqual({ kind: 'current', current: { kind: 'rung', rung: 'off' } });
  });

  it('ladderRows answers the standing latches with their stored cap, and not a cleared one', () => {
    const db = openDb();
    putLatch(db, 'latch-a', 'advise', null);
    putLatch(db, 'latch-b', 'chat');
    db.prepare("UPDATE overlord_latches SET clearedAt = 5, clearedBy = 'operator-a', clearSequence = 9 WHERE cause = 'latch-b'").run();
    const r = ladderRows(db);
    expect(r.kind === 'measured' && r.standing.map((l) => [l.cause, l.cap, l.journalled, l.raiseSequence])).toEqual([['latch-a', 'advise', false, null]]);
  });

  it.each([
    ['a bad rung word', (db: DatabaseSync) => { put(db, 'bogus'); }],
    ['a rung row whose recordFrom is not a rung', (db: DatabaseSync) => { put(db, 'off', { seq: null, from: 'bogus' }); }],
    ['a bad cap', (db: DatabaseSync) => { putLatch(db, 'latch-a', 'bogus'); }],
    ['a bad cause', (db: DatabaseSync) => { putLatch(db, 'Not A Cause', 'chat'); }],
    ['a non-integer sequence', (db: DatabaseSync) => { db.prepare("INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy, raiseSequence) VALUES ('latch-a','chat','d',1,'x','seven')").run(); }],
  ])('ladderRows answers unmeasured on %s', (_n, arrange) => {
    const db = openDb();
    arrange(db);
    expect(ladderRows(db).kind).toBe('unmeasured');
  });

  it('ladderRows and ladderRungRead answer unmeasured, never a throw, on a closed database', () => {
    const db = openDb();
    db.close();
    expect(ladderRows(db).kind).toBe('unmeasured');
    expect(ladderRungRead(db).kind).toBe('unmeasured');
  });

  it('ladderRungRead answers unreadable on the bad rung word, and current with a bad latch row standing beside a good rung', () => {
    const db = openDb();
    put(db, 'bogus');
    expect(ladderRungRead(db)).toEqual({ kind: 'current', current: { kind: 'unreadable' } });
    put(db, 'chat');
    putLatch(db, 'latch-a', 'bogus');
    expect(ladderRows(db).kind).toBe('unmeasured');
    expect(ladderRungRead(db)).toEqual({ kind: 'current', current: { kind: 'rung', rung: 'chat' } });
  });
});

describe('setRungInTx', () => {
  it('refuses a non-off target over an unknown word even when its normalized origin is full', () => {
    const db = openDb(); const journal = fake(db); put(db, 'future');
    expect(tx(db, () => setRungInTx(db, journal, { from: 'full', to: 'chat', actor: operator, at: NOW, opKey: 'race' })))
      .toEqual({ ok: false, error: 'row-changed' });
    expect(journal.seen).toEqual([]); expect(rungRow(db)).toMatchObject({ operatorRung: 'future' });
  });
  it('refuses a classified origin that changed before its transaction', () => {
    const db = openDb(); const journal = fake(db); put(db, 'off');
    const result = tx(db, () => setRungInTx(db, journal, { from: 'advise', to: 'chat', actor: operator, at: NOW, opKey: 'race' }));
    expect(result).toEqual({ ok: false, error: 'row-changed' });
    expect(journal.seen).toEqual([]);
    expect(rungRow(db)).toMatchObject({ operatorRung: 'off' });
  });
  it('a lowering appends authority-rung with the default as from when there is no row, and writes the row with the record\'s sequence and narrowedAt', () => {
    const db = openDb();
    const f = fake(db);
    expect(setRung(db, f, 'off', { actor: 'device:phone' })).toEqual({ ok: true, changed: true, journalled: true, recordSequence: 101 });
    expect(f.seen.map((s) => s.entry)).toEqual([{ kind: 'authority-rung', opKey: 'op-1', from: 'chat', to: 'off' }]);
    expect(rungRow(db)).toMatchObject({ operatorRung: 'off', actor: 'device:phone', updatedAt: NOW, recordSequence: 101, recordFrom: null, narrowedAt: NOW });
  });

  it('a raise writes narrowedAt NULL', () => {
    const db = openDb();
    const f = fake(db);
    put(db, 'off');
    expect(setRung(db, f, 'chat')).toMatchObject({ ok: true, changed: true, journalled: true });
    expect(rungRow(db)).toMatchObject({ operatorRung: 'chat', narrowedAt: null });
  });

  it('the record is appended BEFORE the row is written', () => {
    const db = openDb();
    const f = fake(db);
    setRung(db, f, 'off');
    expect(f.seen[0]!.rung).toBeUndefined();
    put(db, 'advise');
    setRung(db, f, 'chat', { opKey: 'op-2' });
    expect(f.seen[1]!.rung).toMatchObject({ operatorRung: 'advise' });
  });

  it('a same-rung write, and a write of chat over no row, answer changed:false and append nothing', () => {
    const db = openDb();
    const f = fake(db);
    expect(setRung(db, f, 'chat')).toEqual({ ok: true, changed: false });
    setRung(db, f, 'off');
    f.seen.length = 0;
    expect(setRung(db, f, 'off', { opKey: 'op-2' })).toEqual({ ok: true, changed: false });
    expect(f.seen).toEqual([]);
  });

  describe('THE from DUTY (review 2219 F2): from is the row\'s own rung, read in the same transaction', () => {
    it('a row by hand at off, moved to chat: from is off (a widening, so the journal reads it so)', () => {
      const db = openDb();
      const f = fake(db);
      put(db, 'off');
      setRung(db, f, 'chat');
      expect(f.seen.map((s) => s.entry)).toEqual([{ kind: 'authority-rung', opKey: 'op-1', from: 'off', to: 'chat' }]);
    });
    it('no row: from is the default chat', () => {
      const db = openDb();
      const f = fake(db);
      setRung(db, f, 'off');
      expect((f.seen[0]!.entry as { from: string }).from).toBe('chat');
    });
    it('a stored word that is not a rung: from is full, and only a lowering to off makes sense over it', () => {
      const db = openDb();
      const f = fake(db);
      put(db, 'bogus');
      setRung(db, f, 'off');
      expect(f.seen[0]!.entry).toEqual({ kind: 'authority-rung', opKey: 'op-1', from: 'full', to: 'off' });
      expect(rungRow(db)).toMatchObject({ operatorRung: 'off' });
    });
  });

  it('the row keeps the FIRST unjournalled change\'s from while the catch-up keeps failing', () => {
    const db = openDb();
    const f = fake(db);
    put(db, 'advise');
    f.script.push(rowOnly());                                 // advise -> chat lands row-only
    setRung(db, f, 'chat');
    expect(rungRow(db)).toMatchObject({ operatorRung: 'chat', recordSequence: null, recordFrom: 'advise' });
    f.script.push(rowOnly(), rowOnly());                      // the catch-up answers row-only, so does chat -> off
    setRung(db, f, 'off', { opKey: 'op-2' });
    expect(rungRow(db)).toMatchObject({ operatorRung: 'off', recordSequence: null, recordFrom: 'advise' });
  });

  it('an unreadable pending from is preserved instead of fabricating a journal origin', () => {
    const db = openDb();
    const f = fake(db);
    put(db, 'chat', { seq: null, from: 'unknown' });
    f.script.push(rowOnly());
    setRung(db, f, 'off');
    expect(rungRow(db)).toMatchObject({ operatorRung: 'off', recordSequence: null, recordFrom: 'unknown' });
    expect(ladderRows(db).kind).toBe('unmeasured');
  });
});

describe('NL: an operator narrowing always lands, a widening refuses (one case per decision row of the journal)', () => {
  const ROW_ONLY: [string, AuthorityAppend][] = [
    ['row 1: unmeasured (journal)', rowOnly({ kind: 'unmeasured', why: 'journal' })],
    ['row 1: unmeasured (rows)', rowOnly({ kind: 'unmeasured', why: 'rows' })],
    ['row 1: unmeasured (privacy-head)', rowOnly({ kind: 'unmeasured', why: 'privacy-head' })],
    ['row 3: rolled-back (missing)', rowOnly({ kind: 'rolled-back', cause: 'missing' })],
    ['row 6: rolled-back (diverged)', rowOnly({ kind: 'rolled-back', cause: 'diverged' })],
    ['row 8: rolled-back (witness-epoch)', rowOnly({ kind: 'rolled-back', cause: 'witness-epoch' })],
  ];
  const REFUSALS: [string, AuthorityAppend][] = (['authority-rolled-back', 'authority-unmeasured', 'journal-append', 'bad-entry', 'not-in-transaction'] as const)
    .map((e) => [`refusal ${e}`, refuse(e)]);

  const NARROWINGS: [string, (db: DatabaseSync, f: Fake) => LadderWrite, (db: DatabaseSync) => number][] = [
    ['a rung down', (db, f) => { put(db, 'advise'); return setRung(db, f, 'chat'); }, (db) => (rungRow(db) as { recordSequence: number | null }).recordSequence ?? -1],
    ['off', (db, f) => setRung(db, f, 'off'), (db) => (rungRow(db) as { recordSequence: number | null }).recordSequence ?? -1],
    ['a latch raise', (db, f) => raise(db, f), (db) => (latchRows(db)[0] as { raiseSequence: number | null }).raiseSequence ?? -1],
  ];
  const WIDENINGS: [string, (db: DatabaseSync, f: Fake) => LadderWrite, (db: DatabaseSync) => unknown][] = [
    ['a rung up', (db, f) => setRung(db, f, 'chat'), (db) => rungRow(db)],
    ['a clear', (db, f) => clear(db, f), (db) => latchRows(db)],
  ];

  for (const [name, act, seqOf] of NARROWINGS) {
    for (const [row, answer] of ROW_ONLY) {
      it(`${name} on ${row} lands as its row with a NULL sequence, journalled:false`, () => {
        const db = openDb();
        const f = fake(db);
        f.script.push(answer);
        expect(act(db, f)).toMatchObject({ ok: true, changed: true, journalled: false, recordSequence: null });
        expect(seqOf(db)).toBe(-1);
      });
    }
    for (const [row, answer] of REFUSALS) {
      it(`${name} on ${row} writes nothing and answers the error (a writer that got one never writes)`, () => {
        const db = openDb();
        const f = fake(db);
        f.script.push(answer);
        const before = name === 'a rung down' ? (put(db, 'advise'), rungRow(db)) : undefined;
        const got = name === 'a rung down' ? setRung(db, f, 'chat') : name === 'off' ? setRung(db, f, 'off') : raise(db, f);
        expect(got).toEqual({ ok: false, error: (answer as { error: string }).error });
        expect(rungRow(db)).toEqual(before);
        expect(latchRows(db)).toEqual([]);
      });
    }
  }

  for (const [name, act, snap] of WIDENINGS) {
    for (const [row, answer] of [...REFUSALS, ...ROW_ONLY]) {
      it(`${name} on ${row} writes nothing`, () => {
        const db = openDb();
        const f = fake(db);
        // Arrange first, so the snapshot is of the row the widening found.
        if (name === 'a rung up') put(db, 'off'); else putLatch(db, 'latch-a', 'chat');
        const before = JSON.stringify(snap(db));
        f.script.push(answer);
        const got = act(db, f);
        expect(got.ok).toBe(false);
        expect(got).toEqual({ ok: false, error: answer.ok ? 'authority-rolled-back' : answer.error });
        expect(JSON.stringify(snap(db))).toBe(before);
      });
    }
  }

  it('every writer is called inside the caller\'s transaction, so none reaches not-in-transaction', () => {
    const db = openDb();
    const f = fake(db);
    setRung(db, f, 'off'); raise(db, f); clear(db, f);
    expect(f.seen.length).toBe(3);
    expect(f.seen.every((s) => s.inTx)).toBe(true);
  });
});

describe('raiseLatchInTx', () => {
  it('appends authority-latch-raise {cause, cap} and writes a standing row with the sequence', () => {
    const db = openDb();
    const f = fake(db);
    expect(raise(db, f, 'latch-a', 'advise')).toEqual({ ok: true, changed: true, journalled: true, recordSequence: 101, notice: 'none' });
    expect(f.seen.map((s) => s.entry)).toEqual([{ kind: 'authority-latch-raise', opKey: 'op-r', cause: 'latch-a', cap: 'advise' }]);
    expect(f.seen[0]!.latches).toBe(0);
    expect(latchRows(db)).toMatchObject([{ cause: 'latch-a', cap: 'advise', detail: 'why', raisedAt: NOW, raisedBy: 'lane-a 00000000', raiseSequence: 101, clearedAt: null }]);
  });

  it('a second raise of a standing cause answers changed:false, appends nothing and never moves the stored cap', () => {
    const db = openDb();
    const f = fake(db);
    raise(db, f, 'latch-a', 'advise');
    f.seen.length = 0;
    expect(raise(db, f, 'latch-a', 'off', 'op-r2')).toEqual({ ok: true, changed: false });
    expect(f.seen).toEqual([]);
    expect(latchRows(db)).toMatchObject([{ cap: 'advise' }]);
  });

  it('a cause that is not a cause key, or a cap that is not a rung, is bad-entry with nothing appended or written', () => {
    const db = openDb();
    const f = fake(db);
    expect(raise(db, f, 'Not A Cause')).toEqual({ ok: false, error: 'bad-entry' });
    expect(raise(db, f, 'latch-a', 'bogus' as Rung)).toEqual({ ok: false, error: 'bad-entry' });
    expect(f.seen).toEqual([]);
    expect(latchRows(db)).toEqual([]);
  });

  it('echoes the cause table\'s notice, and none for a cause this build does not know', () => {
    const db = openDb();
    const f = fake(db);
    expect(raise(db, f, 'generation-degraded')).toMatchObject({ notice: 'none' });
    expect(raise(db, f, 'cause-from-a-newer-build', 'chat', 'op-r2')).toMatchObject({ notice: 'none' });
  });

  it('after a cleared latch of the cause, a raise makes a new standing row', () => {
    const db = openDb();
    const f = fake(db);
    raise(db, f); clear(db, f);
    expect(raise(db, f, 'latch-a', 'chat', 'op-r3')).toMatchObject({ ok: true, changed: true });
    expect(latchRows(db).map((r) => r['clearedAt'] === null)).toEqual([false, true]);
  });
});

describe('clearLatchInTx', () => {
  it('appends authority-latch-clear {cause} and stamps the row cleared with clearSequence', () => {
    const db = openDb();
    const f = fake(db);
    putLatch(db, 'latch-a', 'chat');
    expect(clear(db, f)).toEqual({ ok: true, changed: true, journalled: true, recordSequence: 101 });
    expect(f.seen.map((s) => s.entry)).toEqual([{ kind: 'authority-latch-clear', opKey: 'op-c', cause: 'latch-a' }]);
    expect(latchRows(db)).toMatchObject([{ clearedAt: NOW, clearedBy: 'operator-a 00000000', clearSequence: 101 }]);
  });

  it('a cause with no standing row answers changed:false and appends nothing', () => {
    const db = openDb();
    const f = fake(db);
    expect(clear(db, f)).toEqual({ ok: true, changed: false });
    expect(f.seen).toEqual([]);
  });

  it('a restore-detected latch cannot be cleared while the journal is not coherent (slug restore-latch-is-a-row)', () => {
    const db = openDb();
    const f = fake(db);
    putLatch(db, 'restore-detected', 'chat');
    f.script.push(refuse('authority-rolled-back'));
    expect(clear(db, f, 'restore-detected')).toEqual({ ok: false, error: 'authority-rolled-back' });
    expect(latchRows(db)).toMatchObject([{ clearedAt: null }]);
  });
});

describe('the catch-up (question 20)', () => {
  it('a row-only lowering, then a coherent raise, appends the pending authority-rung before the raise\'s own record and stamps the row', () => {
    const db = openDb();
    const f = fake(db);
    f.script.push(rowOnly());
    setRung(db, f, 'off');
    expect(rungRow(db)).toMatchObject({ recordSequence: null, recordFrom: 'chat' });
    f.seen.length = 0;
    raise(db, f);
    expect(f.seen.map((s) => s.entry)).toEqual([
      { kind: 'authority-rung', opKey: 'op-r', from: 'chat', to: 'off' },
      { kind: 'authority-latch-raise', opKey: 'op-r', cause: 'latch-a', cap: 'chat' },
    ]);
    expect(rungRow(db)).toMatchObject({ recordSequence: 101, recordFrom: null });
  });

  it('a row-only latch is stamped the same way by the next coherent write', () => {
    const db = openDb();
    const f = fake(db);
    f.script.push(rowOnly());
    raise(db, f);
    expect(latchRows(db)).toMatchObject([{ raiseSequence: null }]);
    f.seen.length = 0;
    setRung(db, f, 'off');
    expect(f.seen.map((s) => s.entry)).toEqual([
      { kind: 'authority-latch-raise', opKey: 'op-1', cause: 'latch-a', cap: 'chat' },
      { kind: 'authority-rung', opKey: 'op-1', from: 'chat', to: 'off' },
    ]);
    expect(latchRows(db)).toMatchObject([{ raiseSequence: 101 }]);
  });

  it('a catch-up answered row-only leaves the row, and still-pending rows are not stamped', () => {
    const db = openDb();
    const f = fake(db);
    put(db, 'chat', { seq: null, from: 'advise' });
    putLatch(db, 'latch-a', 'chat', null);
    f.script.push(rowOnly(), rowOnly());
    setRung(db, f, 'chat', { opKey: 'op-2' });
    expect(rungRow(db)).toMatchObject({ recordSequence: null, recordFrom: 'advise' });
    expect(latchRows(db)).toMatchObject([{ raiseSequence: null }]);
  });

  it('skips an oversized latch but catches up a valid pending latch before the brake', () => {
    const db = openDb();
    const f = fake(db);
    putLatch(db, 'latch-a', 'chat', null);
    putLatch(db, 'latch-b', 'chat', null);
    db.exec("UPDATE overlord_latches SET raisedAt = 9007199254740992 WHERE cause = 'latch-a'");
    expect(ladderRows(db).kind).toBe('unmeasured');
    expect(setRung(db, f, 'off')).toMatchObject({ ok: true, changed: true });
    expect(f.seen.map((s) => s.entry.kind)).toEqual(['authority-latch-raise', 'authority-rung']);
    expect(f.seen[0]!.entry).toMatchObject({ cause: 'latch-b' });
    expect(db.prepare('SELECT cause, raiseSequence FROM overlord_latches ORDER BY cause').all()).toEqual([
      { cause: 'latch-a', raiseSequence: null }, { cause: 'latch-b', raiseSequence: 101 },
    ]);
  });

  it('an unreadable rung or latch row is skipped, never thrown on', () => {
    const db = openDb();
    const f = fake(db);
    put(db, 'bogus', { seq: null, from: 'advise' });
    putLatch(db, 'Not A Cause', 'chat', null);
    putLatch(db, 'latch-a', 'chat', null);
    db.prepare("UPDATE overlord_latches SET raisedAt = 'invalid' WHERE cause = 'latch-a'").run();
    expect(() => setRung(db, f, 'off')).not.toThrow();
    expect(f.seen.map((s) => s.entry.kind)).toEqual(['authority-rung']);
    expect(latchRows(db).map((row) => row['raiseSequence'])).toEqual([null, null]);
  });
});

describe('catch-up through the real authority journal', () => {
  function realJournal() {
    const db = openDb();
    let state: AuthorityState = { kind: 'coherent' };
    const failures: string[] = [];
    const journal = new OverlordAuthorityJournal(overlordAuthorityFileAt(mkTmp('ccrc-ladder-journal-')),
      { clock: fakeTime({ wallMs: NOW }).ports.clock },
      { state: () => state, writerFailed: (cause) => { failures.push(cause); state = { kind: 'rolled-back', cause: 'diverged' }; } });
    return { db, journal, failures, setState: (next: AuthorityState) => { state = next; } };
  }

  it('replays pending narrowings with a 128-character shared operation key, folds to the rows, and never appends twice', () => {
    const { db, journal, setState } = realJournal();
    expect(tx(db, () => setRungInTx(db, journal, { from: 'chat', to: 'advise', actor: operator, at: NOW, opKey: 'original' })))
      .toMatchObject({ ok: true, journalled: true, recordSequence: 1 });
    setState({ kind: 'unmeasured', why: 'journal' });
    expect(tx(db, () => setRungInTx(db, journal, { from: 'advise', to: 'off', actor: operator, at: NOW, opKey: 'narrow' })))
      .toMatchObject({ ok: true, journalled: false });
    expect(tx(db, () => raiseLatchInTx(db, journal, { cause: 'latch-a', cap: 'chat', detail: 'why', raisedBy: lane, at: NOW, opKey: 'raise' })))
      .toMatchObject({ ok: true, journalled: false });
    setState({ kind: 'coherent' });
    const opKey = 'x'.repeat(128);
    expect(tx(db, () => raiseLatchInTx(db, journal, { cause: 'latch-b', cap: 'off', detail: 'why', raisedBy: lane, at: NOW, opKey })))
      .toMatchObject({ ok: true, journalled: true, recordSequence: 4 });
    const read = journal.readVerified();
    expect(read.kind).toBe('records');
    if (read.kind !== 'records') throw new Error('journal was not readable');
    expect(read.records.slice(1).map((r) => r.entry)).toEqual([
      { kind: 'authority-rung', opKey, from: 'advise', to: 'off' },
      { kind: 'authority-latch-raise', opKey, cause: 'latch-a', cap: 'chat' },
      { kind: 'authority-latch-raise', opKey, cause: 'latch-b', cap: 'off' },
    ]);
    const folded = authorityFold(read.records);
    expect(folded.operatorRung).toBe(rungRow(db)!['operatorRung']);
    expect([...folded.latches]).toEqual(latchRows(db).map((r) => [r['cause'], r['cap']]));
    expect(rungRow(db)).toMatchObject({ recordSequence: 2, recordFrom: null });
    expect(latchRows(db)).toMatchObject([{ raiseSequence: 3 }, { raiseSequence: 4 }]);
    tx(db, () => journalPendingInTx(db, journal, opKey));
    const after = journal.readVerified();
    expect(after.kind === 'records' && after.records.length).toBe(4);
    expect(journal.measure(db)).toEqual({ kind: 'coherent' });
  });

  it('the real appender refuses an ordinary move that lies about from to disguise a widening', () => {
    const { db, journal, failures } = realJournal();
    expect(tx(db, () => setRungInTx(db, journal, { from: 'chat', to: 'off', actor: operator, at: NOW, opKey: 'initial' })))
      .toMatchObject({ ok: true, journalled: true });
    const answer = tx(db, () => journal.appendInTx(db, { kind: 'authority-rung', opKey: 'lying', from: 'full', to: 'chat' }));
    expect(answer).toMatchObject({ ok: false, error: 'authority-rolled-back' });
    expect(failures).toContain('diverged');
    expect(rungRow(db)).toMatchObject({ operatorRung: 'off', recordSequence: 1 });
    const read = journal.readVerified();
    expect(read.kind === 'records' && read.records.length).toBe(1);
  });
});

describe('applyRestoreInTx (question 22)', () => {
  it('the CoordStore restore delegate joins the existing Confirm transaction and rolls back with it', () => {
    const db = openDb();
    const store = new CoordStore(db);
    const stricter = { operatorRung: 'off' as const, latches: [{ cause: 'latch-a', cap: 'chat' as const }] };
    expect(() => tx(db, () => {
      store.applyRestore(stricter, 55, NOW);
      expect(rungRow(db)).toMatchObject({ operatorRung: 'off', recordSequence: 55 });
      throw new Error('abort Confirm');
    })).toThrow('abort Confirm');
    expect(rungRow(db)).toBeUndefined();
    expect(latchRows(db)).toEqual([]);
    tx(db, () => store.applyRestore(stricter, 55, NOW));
    expect(rungRow(db)).toMatchObject({ operatorRung: 'off', recordSequence: 55 });
    expect(latchRows(db)).toMatchObject([{ cause: 'latch-a', raiseSequence: 55 }]);
  });

  const restore = (db: DatabaseSync, stricter: Parameters<typeof applyRestoreInTx>[1]): void => {
    tx(db, () => applyRestoreInTx(db, stricter, 55, NOW));
  };

  it.each([9, null])('never widens a stricter stored rung, retaining or stamping sequence %s', (sequence) => {
    const db = openDb(); put(db, 'off', { seq: sequence, from: sequence === null ? 'chat' : null });
    restore(db, { operatorRung: 'advise', latches: [] });
    expect(rungRow(db)).toMatchObject({ operatorRung: 'off', recordSequence: sequence ?? 55, actor: sequence === null ? 'restore' : 'operator-a' });
  });
  it('writes the stricter rung over a higher one, stamped with the Confirm sequence, and appends nothing', () => {
    const db = openDb();
    put(db, 'advise');
    restore(db, { operatorRung: 'off', latches: [] });
    expect(rungRow(db)).toMatchObject({ operatorRung: 'off', actor: 'restore', updatedAt: NOW, recordSequence: 55, recordFrom: null, narrowedAt: NOW });
  });

  it('uses the supplied rung for an absent database row', () => {
    const db = openDb(); restore(db, { operatorRung: 'advise', latches: [] });
    expect(rungRow(db)).toMatchObject({ operatorRung: 'advise', actor: 'restore', recordSequence: 55 });
  });
  it('writes the stricter rung when there is no row', () => {
    const db = openDb();
    restore(db, { operatorRung: 'off', latches: [] });
    expect(rungRow(db)).toMatchObject({ operatorRung: 'off', actor: 'restore', recordSequence: 55, narrowedAt: NOW });
  });

  it('stamps a row-only rung row of the same rung with the Confirm sequence and restore actor', () => {
    const db = openDb();
    put(db, 'off', { seq: null, from: 'chat' });
    restore(db, { operatorRung: 'off', latches: [] });
    expect(rungRow(db)).toMatchObject({ operatorRung: 'off', actor: 'restore', updatedAt: NOW, recordSequence: 55, recordFrom: null });
  });

  it('leaves an already-journalled equal row with its own sequence', () => {
    const db = openDb();
    put(db, 'off', { seq: 9 });
    restore(db, { operatorRung: 'off', latches: [] });
    expect(rungRow(db)).toMatchObject({ recordSequence: 9, actor: 'operator-a' });
  });

  it('inserts a journal-only latch with its cap, raisedBy restore and the Confirm sequence; stamps a row-only latch; keeps the others', () => {
    const db = openDb();
    putLatch(db, 'latch-b', 'off', null);
    putLatch(db, 'latch-c', 'advise', 7);
    restore(db, { operatorRung: 'chat', latches: [{ cause: 'latch-a', cap: 'chat' }, { cause: 'latch-c', cap: 'chat' }] });
    const by = Object.fromEntries(latchRows(db).map((r) => [r['cause'] as string, r]));
    expect(by['latch-a']).toMatchObject({ cap: 'chat', raisedBy: 'restore', raiseSequence: 55, raisedAt: NOW, clearedAt: null });
    expect(by['latch-b']).toMatchObject({ cap: 'off', raisedBy: 'lane-a', raiseSequence: 55 });
    expect(by['latch-c']).toMatchObject({ cap: 'chat', raiseSequence: 55 });
  });

  it.each([7, null])('Confirm narrows an existing latch cap and stamps it with sequence 55, previous sequence %s', (previous) => {
    const db = openDb();
    putLatch(db, 'latch-a', 'advise', previous);
    restore(db, { operatorRung: 'chat', latches: [{ cause: 'latch-a', cap: 'chat' }] });
    expect(latchRows(db)).toMatchObject([{ cap: 'chat', raiseSequence: 55, raisedBy: 'lane-a', detail: 'because' }]);
  });

  it.each([7, null])('Confirm never widens an already stricter cap, previous sequence %s', (previous) => {
    const db = openDb();
    putLatch(db, 'latch-a', 'off', previous);
    restore(db, { operatorRung: 'chat', latches: [{ cause: 'latch-a', cap: 'chat' }] });
    expect(latchRows(db)).toMatchObject([{ cap: 'off', raiseSequence: previous ?? 55 }]);
  });

  it('a narrowed cap and its Confirm stamp roll back with the caller transaction', () => {
    const db = openDb();
    putLatch(db, 'latch-a', 'advise', 7);
    expect(() => tx(db, () => {
      applyRestoreInTx(db, { operatorRung: 'chat', latches: [{ cause: 'latch-a', cap: 'chat' }] }, 55, NOW);
      expect(latchRows(db)).toMatchObject([{ cap: 'chat', raiseSequence: 55 }]);
      throw new Error('abort Confirm');
    })).toThrow('abort Confirm');
    expect(latchRows(db)).toMatchObject([{ cap: 'advise', raiseSequence: 7 }]);
  });

  it('an invalid restored latch rolls back the entire restore, rather than silently discarding it', () => {
    const db = openDb();
    put(db, 'advise');
    expect(() => restore(db, { operatorRung: 'off', latches: [{ cause: 'bad cause', cap: 'chat' }] })).toThrow();
    expect(rungRow(db)).toMatchObject({ operatorRung: 'advise', actor: 'operator-a', recordSequence: 1 });
    expect(latchRows(db)).toEqual([]);
  });

  it('appends nothing: it takes no appender at all, and a latch cleared in the db is raised again as a new row', () => {
    const db = openDb();
    putLatch(db, 'latch-a', 'chat');
    db.prepare("UPDATE overlord_latches SET clearedAt = 5, clearedBy = 'operator-a', clearSequence = 9").run();
    restore(db, { operatorRung: 'chat', latches: [{ cause: 'latch-a', cap: 'chat' }] });
    expect(latchRows(db).map((r) => [r['clearedAt'] === null, r['raiseSequence']])).toEqual([[false, 7], [true, 55]]);
  });
});

describe('SQLite refuses what no writer writes', () => {
  it('a second standing row of one cause', () => {
    const db = openDb();
    putLatch(db, 'latch-a', 'chat');
    expect(() => putLatch(db, 'latch-a', 'off')).toThrow(/UNIQUE/);
  });
  it('a cleared row without its actor, or without its sequence', () => {
    const db = openDb();
    putLatch(db, 'latch-a', 'chat');
    expect(() => db.prepare('UPDATE overlord_latches SET clearedAt = 5, clearSequence = 9').run()).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE overlord_latches SET clearedAt = 5, clearedBy = 'x'").run()).toThrow(/CHECK/);
  });
  it('a rung row with both a sequence and a recordFrom', () => {
    const db = openDb();
    expect(() => put(db, 'off', { seq: 3, from: 'chat' })).toThrow(/CHECK/);
  });
  it('a second rung row', () => {
    const db = openDb();
    put(db, 'off');
    expect(() => db.prepare("INSERT INTO overlord_ladder (id, operatorRung, actor, updatedAt) VALUES (2, 'off', 'x', 1)").run()).toThrow(/CHECK/);
  });
});

describe('boot coherence over the ladder\'s tables (OVERLORD_AUTHORITY_TABLES)', () => {
  const journal = new OverlordAuthorityJournal(null as never, null as never, null as never);
  const verdict = (db: DatabaseSync) => authorityCoherence({ kind: 'absent' }, journal.readRows(db));

  it('a fresh box with no journal and no ladder row reads coherent: the migration seeds nothing', () => {
    expect(verdict(openDb())).toEqual({ kind: 'coherent' });
  });
  it('no journal beside a ladder row reads missing', () => {
    const db = openDb();
    put(db, 'off');
    expect(verdict(db)).toEqual({ kind: 'rolled-back', cause: 'missing' });
  });
  it('no journal beside a latch row reads missing', () => {
    const db = openDb();
    putLatch(db, 'latch-a', 'chat');
    expect(verdict(db)).toEqual({ kind: 'rolled-back', cause: 'missing' });
  });
});
