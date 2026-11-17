// Overlord W1, authority journal plan Task 3 (PR A): the Overlord authority journal's synchronous writer
// (`server/src/coord/overlordAuthorityJournal.ts#OverlordAuthorityJournal.appendInTx`), on a fixture `coord.db`, a fixture
// directory and the real guard (whose `writerFailed` calls are recorded). Real files under `mkTmp`, never the live HOME; faults
// through the port's fs-operations seam. Also the torn-tail heal through A0's `cutAside`.
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  appendFileSync, constants as FS, existsSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { NODE_APPEND_ONLY_FS, type AppendOnlyFsOps } from '../src/appendOnlyFile.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { tx } from '../src/coord/tx.js';
import {
  OVERLORD_AUTHORITY_BASENAME, OVERLORD_AUTHORITY_FORMAT, OVERLORD_AUTHORITY_TORN_DIR, type OverlordAuthorityMove,
} from '../src/coord/overlordAuthority.js';
import {
  OverlordAuthorityJournal, overlordAuthorityFileAt, type AuthorityAppend, type AuthorityWriterFailure,
} from '../src/coord/overlordAuthorityJournal.js';
import { OverlordAuthorityGuard } from '../src/coord/overlordAuthorityGuard.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const NARROW: OverlordAuthorityMove = { kind: 'authority-rung', opKey: 'op-n', from: 'full', to: 'advise' };
const WIDEN: OverlordAuthorityMove = { kind: 'authority-rung', opKey: 'op-w', from: 'advise', to: 'full' };
const LATCH: OverlordAuthorityMove = { kind: 'authority-latch-raise', opKey: 'op-l', cause: 'restore-detected', cap: 'chat' };

/** This piece's one migration, found by its table, so a renumber at the landing merge needs no edit here. */
const HEAD_MIGRATION = (() => {
  const m = MIGRATIONS.filter((sql) => sql.includes('CREATE TABLE overlord_authority_head'));
  if (m.length !== 1) throw new Error(`expected one migration creating overlord_authority_head, found ${m.length}`);
  return m[0]!;
})();

/** The designation table's migration (X2: boot coherence reads it beside the head row), found by its table. */
const DESIGNATION_MIGRATION = MIGRATIONS.find((sql) => sql.includes('CREATE TABLE overlord_designation'))!;

type Fault = 'none' | 'open' | 'write' | 'fsync';
interface Fx {
  dir: string; leaf: string; db: DatabaseSync; guard: OverlordAuthorityGuard; failures: AuthorityWriterFailure[];
  journal: OverlordAuthorityJournal; fault: { now: Fault };
  head(): { sequence: number; journalId: string; digest: string; at: number } | undefined;
  lines(): string[];
  inTx(e: OverlordAuthorityMove, after?: (a: AuthorityAppend) => void): AuthorityAppend;
}

/** A fixture: its own `coord.db`, its own `~/.ccrc` stand-in, a guard told the boot verdict, and a fault switch on the port. */
function fx(opts: { content?: string; wall?: () => number } = {}): Fx {
  const dir = mkTmp('ccrc-overlord-authority-');
  const leaf = path.join(dir, OVERLORD_AUTHORITY_BASENAME);
  if (opts.content !== undefined) writeFileSync(leaf, opts.content);
  const db = new DatabaseSync(path.join(dir, 'coord.db'));
  db.exec(HEAD_MIGRATION);
  db.exec(DESIGNATION_MIGRATION); // `OVERLORD_AUTHORITY_TABLES` lists its table, so boot coherence reads it beside the head row
  const fault = { now: 'none' as Fault };
  let wrote = false;
  const eio = (): never => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); };
  const ops: AppendOnlyFsOps = {
    ...NODE_APPEND_ONLY_FS,
    openSync: (p, flags, mode) => {
      if (fault.now === 'open' && (flags & FS.O_APPEND) !== 0) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return NODE_APPEND_ONLY_FS.openSync(p, flags, mode);
    },
    writeSync: (fd, b, o, l) => { if (fault.now === 'write') eio(); wrote = true; return NODE_APPEND_ONLY_FS.writeSync(fd, b, o, l); },
    fsyncSync: (fd) => { if (fault.now === 'fsync' && wrote) eio(); NODE_APPEND_ONLY_FS.fsyncSync(fd); },
  };
  const file = overlordAuthorityFileAt(dir, ops);
  const failures: AuthorityWriterFailure[] = [];
  let journal!: OverlordAuthorityJournal;
  const guard = new OverlordAuthorityGuard({ healTornTail: () => journal.healTornTail(db), measure: () => journal.measure(db) });
  const spy = { state: () => guard.state(), writerFailed: (c: AuthorityWriterFailure) => { failures.push(c); guard.writerFailed(c); } };
  const clock = fakeTime({ wallMs: Date.parse('2026-11-16T10:00:00.000Z') }).ports.clock;
  journal = new OverlordAuthorityJournal(file, { clock: opts.wall === undefined ? clock : { ...clock, wall: opts.wall } }, spy);
  guard.bootVerdict(journal.measure(db));
  return {
    dir, leaf, db, guard, failures, journal, fault,
    head: () => db.prepare('SELECT sequence, journalId, digest, at FROM overlord_authority_head').get() as never,
    lines: () => (existsSync(leaf) ? readFileSync(leaf, 'utf8').split('\n').filter((l) => l !== '') : []),
    inTx: (e, after) => tx(db, () => { const a = journal.appendInTx(db, e); after?.(a); return a; }),
  };
}

/** The leaf swapped for a symlink to itself, which the port refuses to read (`O_NOFOLLOW`): an unreadable journal. */
function unreadable(f: Fx): void {
  renameSync(f.leaf, `${f.leaf}.real`);
  symlinkSync(`${f.leaf}.real`, f.leaf);
}

describe('appendInTx: inside the caller\'s transaction, never outside', () => {
  it('measures DatabaseSync#isTransaction on this Node (the 22.16 floor\'s leg runs this file too)', () => {
    const db = new DatabaseSync(':memory:');
    expect(db.isTransaction).toBe(false);
    db.exec('BEGIN');
    expect(db.isTransaction).toBe(true);
    db.exec('ROLLBACK');
  });
  it('refuses not-in-transaction outside tx() and writes nothing', () => {
    const f = fx();
    expect(f.journal.appendInTx(f.db, NARROW)).toMatchObject({ ok: false, error: 'not-in-transaction' });
    expect(f.lines()).toEqual([]);
    expect(f.head()).toBeUndefined();
  });
  it('appends one line and writes the head row inside tx(); an absent file with no head row takes sequence 1', () => {
    const f = fx();
    const a = f.inTx(WIDEN);
    expect(a).toMatchObject({ ok: true, kind: 'appended', record: { sequence: 1, previousDigest: null, entry: WIDEN } });
    expect(f.lines()).toHaveLength(1);
    const rec = (a as Extract<AuthorityAppend, { kind: 'appended' }>).record;
    expect(f.head()).toEqual({ sequence: 1, journalId: rec.journalId, digest: rec.digest, at: Date.parse('2026-11-16T10:00:00.000Z') });
    expect(f.failures).toEqual([]);
  });
  it('two records in a row, each in its own transaction, chain, and the second re-reads the file (X1)', () => {
    const f = fx();
    const a = f.inTx(WIDEN) as Extract<AuthorityAppend, { kind: 'appended' }>;
    const b = f.inTx(NARROW) as Extract<AuthorityAppend, { kind: 'appended' }>;
    expect(b.record).toMatchObject({ sequence: 2, previousDigest: a.record.digest });
    expect(f.head()).toMatchObject({ sequence: 2, digest: b.record.digest });
    // The second append re-read the file: a line written behind the writer's back between the two is seen, not appended over.
    appendFileSync(f.leaf, readFileSync(f.leaf, 'utf8').split('\n')[0]! + '\n');
    expect(f.inTx(WIDEN)).toMatchObject({ ok: false, error: 'authority-rolled-back' });
    expect(f.failures).toEqual(['malformed']);
  });
  it('refuses a Confirm record and an entry the grammar refuses as bad-entry, writing nothing', () => {
    const f = fx();
    expect(f.inTx({ ...NARROW, to: 'max' } as never)).toMatchObject({ ok: false, error: 'bad-entry' });
    expect(f.inTx({ kind: 'authority-restore-confirmed' } as never)).toMatchObject({ ok: false, error: 'bad-entry' });
    expect(f.lines()).toEqual([]);
  });
});

describe('appendInTx\'s decision table, the guard in each state', () => {
  it('1 and 2: an unmeasured guard: a narrowing is row-only, a widening authority-unmeasured; neither appends', () => {
    const f = fx();
    f.guard.writerFailed('journal-unreadable');
    expect(f.guard.state()).toEqual({ kind: 'unmeasured', why: 'journal' });
    expect(f.inTx(NARROW)).toEqual({ ok: true, kind: 'row-only', state: { kind: 'unmeasured', why: 'journal' } });
    expect(f.inTx(WIDEN)).toMatchObject({ ok: false, error: 'authority-unmeasured' });
    expect(f.lines()).toEqual([]);
  });
  it('3 and 4: a guard rolled back by a witness while the file and the head row agree (F10): no append either way', () => {
    const f = fx();
    f.inTx(WIDEN);
    f.guard.witnessRefused('witness-epoch');
    expect(f.inTx(NARROW)).toEqual({ ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'witness-epoch' } });
    expect(f.inTx(WIDEN)).toMatchObject({ ok: false, error: 'authority-rolled-back' });
    expect(f.lines()).toHaveLength(1);
    expect(f.head()).toMatchObject({ sequence: 1 });
  });
  it('5: a coherent guard over an unreadable file: a narrowing is row-only and moves the guard to unmeasured (X3b)', () => {
    const f = fx();
    f.inTx(WIDEN);
    unreadable(f);
    expect(f.inTx(NARROW)).toEqual({ ok: true, kind: 'row-only', state: { kind: 'unmeasured', why: 'journal' } });
    expect(f.failures).toEqual(['journal-unreadable']);
  });
  it('5w: a coherent guard over an unreadable file: a widening is authority-unmeasured and the guard is not told', () => {
    const f = fx();
    f.inTx(WIDEN);
    unreadable(f);
    expect(f.inTx(WIDEN)).toMatchObject({ ok: false, error: 'authority-unmeasured' });
    expect(f.failures).toEqual([]);
    expect(f.guard.state()).toEqual({ kind: 'coherent' });
  });
  it.each(['behind', 'ahead', 'diverged'] as const)('6 and 7: a file %s of the head row reports that verdict; a narrowing is row-only, a widening refused', (cause) => {
    for (const e of [NARROW, WIDEN]) {
      const f = fx();
      f.inTx(WIDEN); f.inTx(NARROW);
      if (cause === 'behind') f.db.prepare('UPDATE overlord_authority_head SET sequence = 3').run();
      if (cause === 'ahead') f.db.prepare('UPDATE overlord_authority_head SET sequence = 0').run();
      if (cause === 'diverged') f.db.prepare(`UPDATE overlord_authority_head SET digest = '${'e'.repeat(64)}'`).run();
      if (cause === 'ahead') f.db.prepare('DELETE FROM overlord_authority_head').run();
      const a = f.inTx(e);
      expect(f.failures).toEqual([cause]);
      if (e === NARROW) expect(a).toEqual({ ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause } });
      else expect(a).toMatchObject({ ok: false, error: 'authority-rolled-back' });
      expect(f.lines()).toHaveLength(2);
    }
  });
  it.each(['open', 'write', 'fsync'] as const)('8: a port that fails at %s: journal-append for a widening, row-only for a narrowing, writerFailed(trailing), no head row', (fault) => {
    for (const e of [WIDEN, NARROW]) {
      const f = fx();
      f.fault.now = fault;
      const a = f.inTx(e);
      if (e === WIDEN) expect(a).toMatchObject({ ok: false, error: 'journal-append' });
      else expect(a).toEqual({ ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'trailing' } });
      expect(f.failures).toEqual(['trailing']);
      expect(f.head()).toBeUndefined();
    }
  });
  it('8: a head-row write that throws after the append answers journal-append, never throws, and fences trailing', () => {
    const f = fx();
    f.db.exec(`CREATE TRIGGER no_head BEFORE INSERT ON overlord_authority_head BEGIN SELECT RAISE(ABORT, 'no'); END;`);
    expect(f.inTx(WIDEN)).toMatchObject({ ok: false, error: 'journal-append' });
    expect(f.failures).toEqual(['trailing']);
    expect(f.lines()).toHaveLength(1);
    expect(f.guard.state()).toEqual({ kind: 'rolled-back', cause: 'trailing' });
    f.db.exec('DROP TRIGGER no_head');
    const g = fx();
    g.db.exec(`CREATE TRIGGER no_head BEFORE INSERT ON overlord_authority_head BEGIN SELECT RAISE(ABORT, 'no'); END;`);
    expect(g.inTx(NARROW)).toEqual({ ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'trailing' } });
  });
});

describe('the post-append failure in a running server (review F1)', () => {
  it('a caller\'s own row that throws after appended leaves the line and rolls the head row back; the next append sees trailing', () => {
    const f = fx();
    expect(() => f.inTx(WIDEN, () => { throw new Error('the caller\'s row failed'); })).toThrow(/caller/);
    expect(f.lines()).toHaveLength(1);
    expect(f.head()).toBeUndefined();
    expect(f.inTx(WIDEN)).toMatchObject({ ok: false, error: 'authority-rolled-back' });
    expect(f.failures).toEqual(['trailing']);
    expect(f.guard.state()).toEqual({ kind: 'rolled-back', cause: 'trailing' });
    expect(f.inTx(NARROW)).toEqual({ ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'trailing' } });
    expect(f.lines()).toHaveLength(1);
  });
});

describe('NL: a narrowing is never refused, in any row of the table (X3, X3b)', () => {
  const states: Array<[string, (f: Fx) => void]> = [
    ['1 unmeasured', (f) => f.guard.writerFailed('journal-unreadable')],
    ['3 rolled-back', (f) => f.guard.witnessRefused('witness-heads')],
    ['5 unreadable file', (f) => { f.inTx(WIDEN); unreadable(f); }],
    ['6 disagree', (f) => { f.inTx(WIDEN); f.db.prepare('DELETE FROM overlord_authority_head').run(); f.inTx(WIDEN); }],
    ['8 agree', () => undefined],
    ['8 append fails', (f) => { f.fault.now = 'write'; }],
    ['8 head row fails', (f) => f.db.exec(`CREATE TRIGGER no_head BEFORE INSERT ON overlord_authority_head BEGIN SELECT RAISE(ABORT, 'no'); END;`)],
  ];
  it.each(states)('%s', (_n, setUp) => {
    for (const e of [NARROW, LATCH, { kind: 'authority-retire', opKey: 'op-r', term: 2, previousSessionId: 'lane-a-project-a' } as const]) {
      const f = fx();
      setUp(f);
      const a = f.inTx(e);
      expect(a.ok, JSON.stringify(a)).toBe(true);
    }
  });
});

describe('the torn-tail heal through A0\'s cutAside (Task 4)', () => {
  it('heals a torn tail behind a sound prefix with an equal head row, creating the torn directory', () => {
    const f = fx();
    f.inTx(WIDEN);
    appendFileSync(f.leaf, '{"v":1,"seq');
    expect(existsSync(path.join(f.dir, OVERLORD_AUTHORITY_TORN_DIR))).toBe(false);
    const h = f.journal.healTornTail(f.db);
    expect(h).toMatchObject({ kind: 'healed' });
    const torn = path.join(f.dir, OVERLORD_AUTHORITY_TORN_DIR);
    expect(statSync(torn).mode & 0o777).toBe(0o700);
    expect(readdirSync(torn)).toEqual([(h as { name: string }).name]);
    expect(f.journal.measure(f.db)).toEqual({ kind: 'coherent' });
  });
  it('refuses a tail when the head row differs, which then reads malformed', () => {
    const f = fx();
    f.inTx(WIDEN); f.inTx(NARROW);
    f.db.prepare('DELETE FROM overlord_authority_head').run();
    appendFileSync(f.leaf, '{"v":1,"seq');
    expect(f.journal.healTornTail(f.db)).toEqual({ kind: 'not-healable' });
    expect(f.journal.measure(f.db)).toEqual({ kind: 'rolled-back', cause: 'malformed' });
  });
  it('a tail after a broken chain is no tail to heal: the file reads malformed', () => {
    const f = fx();
    f.inTx(WIDEN); f.inTx(NARROW);
    const [l1, l2] = f.lines();
    writeFileSync(f.leaf, `${l2}\n${l1}\n{"v":1`);
    expect(f.journal.healTornTail(f.db)).toEqual({ kind: 'no-tail' });
    expect(f.journal.measure(f.db)).toEqual({ kind: 'rolled-back', cause: 'malformed' });
  });
  it('with no tail there is nothing to heal', () => {
    const f = fx();
    f.inTx(WIDEN);
    expect(f.journal.healTornTail(f.db)).toEqual({ kind: 'no-tail' });
  });
});

// Review 2219, fix round 1 (the coordinator's rulings F1, F2, F6, F7).
const SET = (pools: string[], untagged = false) => ({ pools, untagged });
const ACCOUNTS = (from: ReturnType<typeof SET>, to: ReturnType<typeof SET>, opKey = 'op-a'): OverlordAuthorityMove =>
  ({ kind: 'authority-account-set', opKey, from, to });
type Appended = Extract<AuthorityAppend, { kind: 'appended' }>;

describe('F1: the writer canonicalises an account set\'s pool lists (the-writer-canonicalises)', () => {
  it('an unsorted narrowing, with a duplicate, lands, and the record holds the sorted, de-duplicated lists', () => {
    const f = fx();
    const a = f.inTx(ACCOUNTS(SET(['pool-b', 'pool-a', 'pool-b'], true), SET(['pool-b'])));
    expect(a).toMatchObject({ ok: true, kind: 'appended' });
    expect((a as Appended).record.entry).toEqual(ACCOUNTS(SET(['pool-a', 'pool-b'], true), SET(['pool-b'])));
    expect(f.failures).toEqual([]);
  });
  it('a reorder alone lands as no change of membership (a narrowing), held against the fold', () => {
    const f = fx();
    f.inTx(ACCOUNTS(SET(['pool-a', 'pool-b']), SET(['pool-a', 'pool-b'])));
    const a = f.inTx(ACCOUNTS(SET(['pool-b', 'pool-a']), SET(['pool-b', 'pool-a']), 'op-r'));
    expect(a).toMatchObject({ ok: true, kind: 'appended', record: { sequence: 2 } });
    expect((a as Appended).record.entry).toEqual(ACCOUNTS(SET(['pool-a', 'pool-b']), SET(['pool-a', 'pool-b']), 'op-r'));
  });
  it('an unsorted narrowing over a rolled-back guard is row-only, never bad-entry', () => {
    const f = fx();
    f.guard.witnessRefused('witness-epoch');
    expect(f.inTx(ACCOUNTS(SET(['pool-b', 'pool-a']), SET(['pool-b'])))).toEqual(
      { ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'witness-epoch' } });
  });
  it('a truly malformed account set is still bad-entry: a value that is not a pool name', () => {
    const f = fx();
    expect(f.inTx(ACCOUNTS(SET(['pool-a', 'Not A Pool']), SET(['pool-a'])))).toMatchObject({ ok: false, error: 'bad-entry' });
    expect(f.lines()).toEqual([]);
  });
});

describe('F2: a stated from is held against the fold while the journal is coherent (stated-from-against-the-fold)', () => {
  const RUNG = (from: string, to: string, opKey = 'op-x') => ({ kind: 'authority-rung', opKey, from, to }) as OverlordAuthorityMove;
  it('a from the fold contradicts, on a move that widens against the fold, is refused and tells the guard diverged', () => {
    const f = fx();
    f.inTx(RUNG('advise', 'chat'));                      // the fold reads chat
    const a = f.inTx(RUNG('full', 'advise'));            // states a narrowing; chat to advise widens
    expect(a).toMatchObject({ ok: false, error: 'authority-rolled-back', detail: expect.stringMatching(/fold/) });
    expect(f.failures).toEqual(['diverged']);
    expect(f.guard.state()).toEqual({ kind: 'rolled-back', cause: 'diverged' });
    expect(f.lines()).toHaveLength(1);
  });
  it('a from the fold contradicts, on a move narrower than the fold, lands row-only', () => {
    const f = fx();
    f.inTx(RUNG('advise', 'full'));                      // the fold reads full
    expect(f.inTx(RUNG('advise', 'chat'))).toEqual({ ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'diverged' } });
    expect(f.failures).toEqual(['diverged']);
    expect(f.lines()).toHaveLength(1);
  });
  it('an account set whose from the fold contradicts is refused when it widens against the fold', () => {
    const f = fx();
    f.inTx(ACCOUNTS(SET(['pool-a', 'pool-b']), SET(['pool-a'])));
    expect(f.inTx(ACCOUNTS(SET(['pool-a', 'pool-b']), SET(['pool-a', 'pool-b']), 'op-y'))).toMatchObject(
      { ok: false, error: 'authority-rolled-back' });
    expect(f.failures).toEqual(['diverged']);
  });
  it('a model class whose from the fold contradicts is held the same way', () => {
    const f = fx();
    f.inTx({ kind: 'authority-model-class', opKey: 'op-m', from: 'fable', to: 'opus' });
    expect(f.inTx({ kind: 'authority-model-class', opKey: 'op-m2', from: 'fable', to: 'opus' })).toEqual(
      { ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'diverged' } });
  });
  it('a from that matches the fold appends; a field no record named yet takes the stated from', () => {
    const f = fx();
    expect(f.inTx(RUNG('off', 'chat'))).toMatchObject({ ok: true, kind: 'appended' });
    expect(f.inTx(RUNG('chat', 'full'))).toMatchObject({ ok: true, kind: 'appended' });
    expect(f.failures).toEqual([]);
  });
  it('the documented residual: while the guard is not coherent the stated from stands, so a lying from lands row-only', () => {
    const f = fx();
    f.inTx(RUNG('advise', 'chat'));                      // the row and the fold read chat
    f.guard.witnessRefused('witness-heads');
    // The caller's duty is to pass the row's own value (chat); a from stated as full reads chat-to-advise as a narrowing.
    expect(f.inTx(RUNG('full', 'advise'))).toEqual({ ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'witness-heads' } });
    expect(f.lines()).toHaveLength(1);
  });
});

describe('F6 and F7: a head row that cannot be read keeps the rows word; a widening that throws first is not told', () => {
  it('F7: a head row holding sequence 0, left in place, reads unmeasured (rows); so does a digest that is not 64-hex', () => {
    const f = fx();
    f.inTx(WIDEN);
    f.db.prepare('UPDATE overlord_authority_head SET sequence = 0').run();
    expect(f.journal.measure(f.db)).toEqual({ kind: 'unmeasured', why: 'rows' });
    const g = fx();
    g.inTx(WIDEN);
    g.db.prepare(`UPDATE overlord_authority_head SET digest = 'zz'`).run();
    expect(g.journal.measure(g.db)).toEqual({ kind: 'unmeasured', why: 'rows' });
  });
  it('F6: a head row the append check cannot read: a narrowing is row-only with unmeasured (rows); a widening does not tell the guard', () => {
    const f = fx();
    f.inTx(WIDEN);
    f.db.prepare('UPDATE overlord_authority_head SET sequence = 0').run();
    expect(f.inTx(WIDEN)).toMatchObject({ ok: false, error: 'authority-unmeasured', detail: expect.stringMatching(/head row/) });
    expect(f.failures).toEqual([]);
    expect(f.inTx(NARROW)).toEqual({ ok: true, kind: 'row-only', state: { kind: 'unmeasured', why: 'rows' } });
    expect(f.failures).toEqual(['rows-unreadable']);
    expect(f.guard.state()).toEqual({ kind: 'unmeasured', why: 'rows' });
  });
  it('F6: a throw before the append: a widening is authority-unmeasured and the guard is not told (row 5w); a narrowing lands row-only', () => {
    const wall = (): number => { throw new Error('the clock is gone'); };
    const f = fx({ wall });
    expect(f.inTx(WIDEN)).toMatchObject({ ok: false, error: 'authority-unmeasured', detail: expect.stringMatching(/before the append/) });
    expect(f.failures).toEqual([]);
    expect(f.guard.state()).toEqual({ kind: 'coherent' });
    expect(f.inTx(NARROW)).toEqual({ ok: true, kind: 'row-only', state: { kind: 'unmeasured', why: 'journal' } });
    expect(f.failures).toEqual(['journal-unreadable']);
    expect(f.lines()).toEqual([]);
  });
});
