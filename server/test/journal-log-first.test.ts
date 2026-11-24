// D-7058 (ARCH-73 #808, its journal half; W8 Task C8f's characterization pin). The log-first writers that keep a
// number from ever being reissued — `setAccountPools` (the pool epoch over `PoolEdgeLog`) and `setIntent` (the update
// epoch over `UpdateIntentLog`); the deviation allocator's `allocateDeviations` over `LedgerLog` was the third until it
// retired (docs/superpowers/plans/2026-11-24-deviation-allocator-removal-pr2.md) — each read the floor,
// decide, append the journal and only then write the row, in ONE transaction. This file pins what each does today, so
// the move onto `journalKernel.ts` (`journalFloor`, `appendThenApply`) is held by rows written before it: the order
// (every statement and every journal call in one ordered list), the floor (file ahead, db ahead, both empty, a torn
// last line), an append that throws, a row write that throws after the append (the journal one ahead: skipped, never
// reissued), a floor read that throws, and each method's own answer for each. `setCollectLane`'s rows (its refusals,
// `unchanged`, each `failed` phase, the decide-phase rethrow and the post-commit re-reads) are
// `collect-lane-store.test.ts`'s, run unchanged; the one row added here (a stop whose COMMIT throws) is the second
// review's. Fixture HOMEs only (mkTmp); never a live coord.db.
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { FLEET_SCOPE } from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { PoolEdgeLog, type PoolEdgeLogEntry } from '../src/coord/pooledgelog.js';
import { UpdateIntentLog, type UpdateIntentLogEntry } from '../src/coord/updateintentlog.js';
import { collectLaneJournalAt, defaultCollectLaneJournalPath } from '../src/coord/collectLaneJournal.js';
import type { CollectLaneWriteRequest } from '../src/collectLane.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_785_300_000_000;

/** `INSERT pool_edges`, `SELECT pool_epoch`, …: a statement's verb and its first table, so the ordered list reads. */
const tagOf = (sql: string): string => {
  const verb = (/^\s*(\w+)/.exec(sql)?.[1] ?? '?').toUpperCase();
  const table = /\b(?:FROM|INTO|UPDATE)\s+(\w+)/i.exec(sql)?.[1] ?? '?';
  return `${verb} ${table}`;
};

interface Trace { readonly events: string[]; failOn: RegExp | null }

/** The store's handle, traced: every `exec` (BEGIN, COMMIT, ROLLBACK) and every run/get/all of a prepared statement
 *  is pushed into `trace.events`, and a statement whose tag matches `trace.failOn` throws when it runs. */
const traced = (db: DatabaseSync, trace: Trace): DatabaseSync => new Proxy(db, {
  get(target, key) {
    if (key === 'exec') {
      return (sql: string) => { trace.events.push(sql.trim().split(/\s+/)[0]!.toUpperCase()); return target.exec(sql); };
    }
    if (key === 'prepare') {
      return (sql: string): StatementSync => {
        const st = target.prepare(sql);
        const tag = tagOf(sql);
        return new Proxy(st, {
          get(s, k) {
            const v = Reflect.get(s, k) as unknown;
            if (typeof v !== 'function') return v;
            if (k === 'run' || k === 'get' || k === 'all') {
              return (...args: unknown[]) => {
                trace.events.push(tag);
                if (trace.failOn !== null && trace.failOn.test(tag)) throw new Error(`fixture: ${tag} refused`);
                return (v as (...a: unknown[]) => unknown).apply(s, args);
              };
            }
            return (v as (...a: unknown[]) => unknown).bind(s);
          },
        });
      };
    }
    const v = Reflect.get(target, key) as unknown;
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  },
});

interface Faults { readFail?: Error; appendFail?: Error }

class RecordingPoolLog extends PoolEdgeLog {
  constructor(p: string, readonly events: string[], readonly faults: Faults = {}) { super(p); }
  override maxEpoch(): number | null {
    this.events.push('maxEpoch');
    if (this.faults.readFail !== undefined) throw this.faults.readFail;
    return super.maxEpoch();
  }
  override append(entries: readonly PoolEdgeLogEntry[]): void {
    this.events.push(`append:${entries.map((e) => e.epoch).join(',')}`);
    if (this.faults.appendFail !== undefined) throw this.faults.appendFail;
    super.append(entries);
  }
}

class RecordingIntentLog extends UpdateIntentLog {
  constructor(p: string, readonly events: string[], readonly faults: Faults = {}) { super(p); }
  override maxEpoch(): number | null {
    this.events.push('maxEpoch');
    if (this.faults.readFail !== undefined) throw this.faults.readFail;
    return super.maxEpoch();
  }
  override append(entry: UpdateIntentLogEntry): void {
    this.events.push(`append:${entry.epoch}`);
    if (this.faults.appendFail !== undefined) throw this.faults.appendFail;
    super.append(entry);
  }
}

/** A fixture HOME: a traced store over a fresh coord.db, the two journals' paths beside it, one shared event list. */
const home = () => {
  const d = mkTmp('ccrc-journal-log-first-');
  mkdirSync(path.join(d, '.ccrc'), { recursive: true });
  const trace: Trace = { events: [], failOn: null };
  const db = openCoordDb(path.join(d, '.ccrc', 'coord.db'));
  return {
    trace, db,
    store: new CoordStore(traced(db, trace)),
    plain: new CoordStore(db),
    pool: path.join(d, '.ccrc', 'pool-edges.log'),
    intent: path.join(d, '.ccrc', 'update-intent.log'),
  };
};

const poolEpoch = (db: DatabaseSync): number => (db.prepare('SELECT epoch AS e FROM pool_epoch WHERE id = 1').get() as { e: number }).e;
const updateEpoch = (db: DatabaseSync): number => (db.prepare('SELECT epoch AS e FROM update_epoch WHERE id = 1').get() as { e: number }).e;
const poolRows = (db: DatabaseSync): unknown[] => db.prepare('SELECT * FROM pool_edges ORDER BY subjectId, pool').all();
const intentRows = (db: DatabaseSync): unknown[] => db.prepare('SELECT * FROM update_intent ORDER BY scope').all();
const lines = (p: string): string[] => readFileSync(p, 'utf8').split('\n').filter((l) => l !== '');

const setPools = (s: CoordStore, log: PoolEdgeLog, accountId = 'acct-a') =>
  s.setAccountPools({ accountId, pools: ['pool-a'], addedBy: 'op', now: NOW }, log);
const setDev = (s: CoordStore, log: UpdateIntentLog) => s.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW);

describe('the order: floor read, decide, journal append, row write, in one transaction', () => {
  it('setAccountPools: the journal is written before the row', () => {
    const h = home();
    const log = new RecordingPoolLog(h.pool, h.trace.events);
    expect(setPools(h.store, log)).toEqual({ ok: true, epoch: 1 });
    expect(h.trace.events).toEqual([
      'BEGIN', 'SELECT pool_epoch', 'maxEpoch', 'append:1',
      'DELETE pool_edges', 'INSERT pool_edges', 'SELECT pool_edges', 'UPDATE pool_epoch', 'COMMIT',
    ]);
  });

  it('setIntent: the journal is written before the row', () => {
    const h = home();
    const log = new RecordingIntentLog(h.intent, h.trace.events);
    expect(setDev(h.store, log)).toMatchObject({ ok: true, epoch: 1 });
    expect(h.trace.events).toEqual([
      'SELECT update_intent',
      'BEGIN', 'SELECT update_epoch', 'maxEpoch', 'append:1', 'INSERT update_intent', 'UPDATE update_epoch', 'COMMIT',
    ]);
  });

  it('a refusal decided before the transaction reads no floor (setAccountPools multi-pool, setIntent empty-patch)', () => {
    const h = home();
    const p = new RecordingPoolLog(h.pool, h.trace.events);
    const i = new RecordingIntentLog(h.intent, h.trace.events);
    expect(h.store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a', 'pool-b'], addedBy: null, now: NOW }, p))
      .toEqual({ ok: false, error: 'multi-pool-not-supported', pools: ['pool-a', 'pool-b'] });
    expect(h.store.setIntent(FLEET_SCOPE, {}, i, NOW)).toEqual({ ok: false, why: 'empty-patch' });
    expect(h.trace.events).toEqual([]);
  });
});

describe('the floor: MAX(file, db), the next number past both', () => {
  it('both empty: setAccountPools and setIntent issue 1', () => {
    const h = home();
    expect(setPools(h.store, new PoolEdgeLog(h.pool))).toEqual({ ok: true, epoch: 1 });
    expect(setDev(h.store, new UpdateIntentLog(h.intent))).toMatchObject({ ok: true, epoch: 1 });
  });

  it('the file ahead of the db: the next number is past the file', () => {
    const h = home();
    writeFileSync(h.pool, '{"epoch":5,"accountId":"acct-z","pools":["pool-z"],"addedBy":null,"at":1}\n');
    writeFileSync(h.intent, '{"epoch":9,"scope":"*","channel":"dev"}\n');
    expect(setPools(h.store, new PoolEdgeLog(h.pool))).toEqual({ ok: true, epoch: 6 });
    expect(poolEpoch(h.db)).toBe(6);
    expect(setDev(h.store, new UpdateIntentLog(h.intent))).toMatchObject({ ok: true, epoch: 10 });
    expect(updateEpoch(h.db)).toBe(10);
  });

  it('the db ahead of the file: the next number is past the db', () => {
    const h = home();
    const p = new PoolEdgeLog(h.pool);
    const i = new UpdateIntentLog(h.intent);
    for (let k = 0; k < 3; k++) { setPools(h.store, p); setDev(h.store, i); }
    writeFileSync(h.pool, `${lines(h.pool)[0]!}\n`);          // the file now says epoch 1, the db 3
    writeFileSync(h.intent, `${lines(h.intent)[0]!}\n`);
    expect(setPools(h.store, p)).toEqual({ ok: true, epoch: 4 });
    expect(setDev(h.store, i)).toMatchObject({ ok: true, epoch: 4 });
  });

  it('a torn last line is counted: the next number is past the torn one', () => {
    const h = home();
    writeFileSync(h.pool, '{"epoch":3}\n{"epoch":7');
    writeFileSync(h.intent, '{"epoch":3}\n{"epoch":7');
    expect(setPools(h.store, new PoolEdgeLog(h.pool))).toEqual({ ok: true, epoch: 8 });
    expect(setDev(h.store, new UpdateIntentLog(h.intent))).toMatchObject({ ok: true, epoch: 8 });
  });
});

describe('an append that throws: no row changed, the transaction rolled back, each method its own answer', () => {
  const boom = (): Error => Object.assign(new Error('fixture: no space'), { code: 'ENOSPC' });

  it('setAccountPools: the error itself propagates', () => {
    const h = home();
    const err = boom();
    const log = new RecordingPoolLog(h.pool, h.trace.events, { appendFail: err });
    let thrown: unknown = null;
    try { setPools(h.store, log); } catch (e) { thrown = e; }
    expect(thrown).toBe(err);
    expect(h.trace.events.at(-1)).toBe('ROLLBACK');
    expect(h.trace.events).not.toContain('DELETE pool_edges');
    expect(poolEpoch(h.db)).toBe(0);
    expect(poolRows(h.db)).toEqual([]);
  });

  it('setIntent: journal-unwritable, the error\'s message as detail', () => {
    const h = home();
    const log = new RecordingIntentLog(h.intent, h.trace.events, { appendFail: boom() });
    const rows = intentRows(h.db);
    expect(setDev(h.store, log)).toEqual({ ok: false, why: 'journal-unwritable', detail: 'fixture: no space' });
    expect(h.trace.events.at(-1)).toBe('ROLLBACK');
    expect(h.trace.events).not.toContain('INSERT update_intent');
    expect(updateEpoch(h.db)).toBe(0);
    expect(intentRows(h.db)).toEqual(rows);
  });

});

describe('a row write that throws after the append: the journal one ahead, the row unchanged (skipped, never reissued)', () => {
  it('setAccountPools', () => {
    const h = home();
    const log = new PoolEdgeLog(h.pool);
    expect(setPools(h.store, log)).toEqual({ ok: true, epoch: 1 });
    h.trace.failOn = /^UPDATE pool_epoch$/;
    expect(() => setPools(h.store, log, 'acct-b')).toThrow('fixture: UPDATE pool_epoch refused');
    expect(log.maxEpoch()).toBe(2);
    expect(poolEpoch(h.db)).toBe(1);
    expect((poolRows(h.db) as { subjectId: string }[]).map((r) => r.subjectId)).toEqual(['acct-a']);
    h.trace.failOn = null;
    expect(setPools(h.store, log, 'acct-b')).toEqual({ ok: true, epoch: 3 });
  });

  it('setIntent: the row write\'s error propagates as itself', () => {
    const h = home();
    const log = new UpdateIntentLog(h.intent);
    const rows = intentRows(h.db);
    h.trace.failOn = /^INSERT update_intent$/;
    expect(() => setDev(h.store, log)).toThrow('fixture: INSERT update_intent refused');
    expect(log.maxEpoch()).toBe(1);
    expect(updateEpoch(h.db)).toBe(0);
    expect(intentRows(h.db)).toEqual(rows);
    h.trace.failOn = null;
    expect(setDev(h.store, log)).toMatchObject({ ok: true, epoch: 2 });
  });

});

describe('a floor read that throws', () => {
  const unreadable = (): Error => Object.assign(new Error('fixture: unreadable'), { code: 'EACCES' });

  it('setIntent answers journal-unreadable and appends nothing', () => {
    const h = home();
    const log = new RecordingIntentLog(h.intent, h.trace.events, { readFail: unreadable() });
    expect(setDev(h.store, log)).toEqual({ ok: false, why: 'journal-unreadable', detail: 'fixture: unreadable' });
    expect(h.trace.events.filter((e) => e.startsWith('append'))).toEqual([]);
    expect(h.trace.events.at(-1)).toBe('ROLLBACK');
    expect(updateEpoch(h.db)).toBe(0);
  });

  it('setAccountPools lets the error itself propagate', () => {
    const h = home();
    const err = unreadable();
    const log = new RecordingPoolLog(h.pool, h.trace.events, { readFail: err });
    let thrown: unknown = null;
    try { setPools(h.store, log); } catch (e) { thrown = e; }
    expect(thrown).toBe(err);
    expect(h.trace.events.filter((e) => e.startsWith('append'))).toEqual([]);
    expect(poolEpoch(h.db)).toBe(0);
  });

  it('an existing journal with no epoch: setIntent journal-unreadable, setAccountPools the reader\'s throw', () => {
    const h = home();
    writeFileSync(h.pool, '');
    writeFileSync(h.intent, '');
    expect(() => setPools(h.store, new PoolEdgeLog(h.pool))).toThrow(`pool-edges journal exists at ${h.pool} but yields no epoch`);
    expect(setDev(h.store, new UpdateIntentLog(h.intent)))
      .toMatchObject({ ok: false, why: 'journal-unreadable' });
  });
});

describe('the readers, byte for byte', () => {
  const thrownMessage = (f: () => unknown): string => {
    try { f(); } catch (e) { return (e as Error).message; }
    throw new Error('did not throw');
  };

  it('the two maxEpoch sentences', () => {
    const h = home();
    writeFileSync(h.pool, 'not a journal\n');
    writeFileSync(h.intent, '');
    expect(thrownMessage(() => new PoolEdgeLog(h.pool).maxEpoch())).toBe(
      `pool-edges journal exists at ${h.pool} but yields no epoch — zero-length or unparseable is not the same as ` +
      'absent; answering null here would be the reissue this file exists to prevent');
    expect(thrownMessage(() => new UpdateIntentLog(h.intent).maxEpoch())).toBe(
      `update-intent journal exists at ${h.intent} but yields no epoch — zero-length or unparseable is not the same as ` +
      'absent; answering null here would be the reissue this file exists to prevent');
  });

  it('a missing journal is null for both maxEpoch readers', () => {
    const h = home();
    expect(new PoolEdgeLog(h.pool).maxEpoch()).toBeNull();
    expect(new UpdateIntentLog(h.intent).maxEpoch()).toBeNull();
  });

});

describe('setCollectLane: a stop whose COMMIT throws is the defect it is, never a failed write', () => {
  // The kernel leaves `phase.at` at 'decide' on a stop, so a COMMIT that throws after a refusal or a no-op propagates
  // as itself (the decide-phase rule), never `{ kind: 'failed', phase: 'commit' }`: no append was made to fail after.
  const NODE_A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
  const commitThrows = (h: ReturnType<typeof home>, req: (j: ReturnType<typeof collectLaneJournalAt>) => CollectLaneWriteRequest) => {
    const j = collectLaneJournalAt(defaultCollectLaneJournalPath(path.dirname(h.pool)));
    const err = Object.assign(new Error('fixture: disk I/O error'), { code: 'ERR_SQLITE_ERROR' });
    const realExec = h.db.exec.bind(h.db);
    const spy = vi.spyOn(h.db, 'exec').mockImplementation((sql: string) => {
      if (sql === 'COMMIT') throw err;
      realExec(sql);
    });
    let thrown: unknown = null;
    try { h.plain.setCollectLane(req(j), NOW, j); } catch (e) { thrown = e; } finally { spy.mockRestore(); }
    return { thrown, err, j };
  };

  it('a refusal (conflict)', () => {
    const h = home();
    const { thrown, err, j } = commitThrows(h, (jj) =>
      ({ kind: 'live', fleetNodeId: NODE_A, expected: { kind: 'absent' }, expectedJournal: jj.read() }));
    expect(thrown).toBe(err);
    expect(j.read()).toEqual({ kind: 'missing' });
  });

  it('a true no-op (Off over the seed)', () => {
    const h = home();
    const { thrown, err, j } = commitThrows(h, () => ({ kind: 'off' }));
    expect(thrown).toBe(err);
    expect(j.read()).toEqual({ kind: 'missing' });
  });
});
