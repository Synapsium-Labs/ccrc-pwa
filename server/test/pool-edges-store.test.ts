// Account-pool membership (design 2026-09-18 §5.2), task 6: the authoritative
// store `pool_edges`/`pool_epoch` and the flat-file journal under it. Same
// doctrine as `ledger-store.test.ts`'s allocator: the journal is appended
// INSIDE the transaction, BEFORE the commit, and recovery takes MAX(file,
// db) — so an epoch is SKIPPED, NEVER REISSUED. See `pooledgelog.ts`'s own
// docstring for why: a lost coord.db that could not reconstruct would answer
// "untagged" for every account, and untagged is the fail-OPEN direction this
// whole design exists to prevent.
import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { PoolEdgeLog, type PoolEdgeLogEntry } from '../src/coord/pooledgelog.js';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bodyDigest } from '../../shared/mark.mjs';

const fresh = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'pool-edges-'));
  return { store: new CoordStore(openCoordDb(path.join(d, 'coord.db'))),
           log: new PoolEdgeLog(path.join(d, 'pool-edges.log')), dir: d };
};

describe('pool_edges', () => {
  it('writes one row per edge and bumps the epoch', () => {
    const { store, log } = fresh();
    const r = store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1000 }, log);
    expect(r).toEqual({ ok: true, epoch: 1 });
    expect(store.accountPoolEdges().get('acct-a')).toEqual(['pool-a']);
  });

  it('APPENDS THE JOURNAL BEFORE THE COMMIT — the file leads the db', () => {
    const { store, log, dir } = fresh();
    store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1000 }, log);
    const lines = readFileSync(path.join(dir, 'pool-edges.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ epoch: 1, accountId: 'acct-a', pools: ['pool-a'] });
  });

  it('recovery takes MAX(journal, db) so an epoch is SKIPPED, never reissued', () => {
    const { store, log, dir } = fresh();
    // Simulate a crash between append and commit: the journal is ahead.
    writeFileSync(path.join(dir, 'pool-edges.log'),
      JSON.stringify({ epoch: 9, accountId: 'x', pools: [], addedBy: 'op', at: 1 }) + '\n', 'utf8');
    const r = store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1000 }, log);
    expect(r).toEqual({ ok: true, epoch: 10 });          // 9 skipped, never handed out twice
  });

  it('one pool per account today — a second write REPLACES, it does not accumulate', () => {
    const { store, log } = fresh();
    store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1 }, log);
    store.setAccountPools({ accountId: 'acct-a', pools: ['pool-b'], addedBy: 'op', now: 2 }, log);
    expect(store.accountPoolEdges().get('acct-a')).toEqual(['pool-b']);
  });

  it('an empty pool list clears the account', () => {
    const { store, log } = fresh();
    store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1 }, log);
    store.setAccountPools({ accountId: 'acct-a', pools: [], addedBy: 'op', now: 2 }, log);
    expect(store.accountPoolEdges().has('acct-a')).toBe(false);
  });

  it('an UNREADABLE journal throws rather than reissuing', () => {
    const { store, log, dir } = fresh();
    writeFileSync(path.join(dir, 'pool-edges.log'), 'x', 'utf8');
    // 0o200 (write-only), not 0o000: `setAccountPools` reads `log.maxEpoch()`
    // BEFORE it calls `log.append`, so on the CORRECT code path execution
    // never reaches `append` at all once `maxEpoch` throws. 0o000 blocks
    // BOTH read and write, so a mutated `maxEpoch` that swallows the read
    // error and returns `null` still hits a throw one line later, on
    // `append`'s own `appendFileSync` — the test would pass for the wrong
    // reason (measured: it stayed GREEN with `return null` substituted for
    // `throw err` in `maxEpoch`'s non-ENOENT arm, because 0o000 made the
    // subsequent append throw regardless). 0o200 leaves the file WRITABLE,
    // so only `maxEpoch`'s own read failure can make this call throw.
    chmodSync(path.join(dir, 'pool-edges.log'), 0o200);
    expect(() => store.setAccountPools({ accountId: 'a', pools: [], addedBy: 'op' }, log)).toThrow();
  });

  it('pool_epoch refuses a second row', () => {
    const { store } = fresh();
    // Single-quoted 'x': the brief's own draft double-quoted this literal,
    // which SQLite's double-quoted-string misfeature reads as an (absent)
    // COLUMN name, so the statement always threw "no such column: x" —
    // BEFORE the CHECK constraint ever got a chance to fire. That made the
    // test true for the wrong reason: it passed unchanged with `CHECK (id =
    // 1)` deleted from the migration (measured — mutation 3 stayed GREEN
    // until this fix). Single-quoting it is the fix: now the only thing that
    // can make this insert throw is the CHECK.
    expect(() => (store as any).db.exec("INSERT INTO pool_epoch (id, epoch, issuedAt, digest) VALUES (2, 1, 1, 'x')"))
      .toThrow();
  });

  it('addedBy: null is a real answer — a row written by a path with no session identity', () => {
    const { store, log } = fresh();
    store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: null, now: 1 }, log);
    expect(store.accountPoolEdges().get('acct-a')).toEqual(['pool-a']);
    const lines = readFileSync(log.logPath, 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0]!).addedBy).toBeNull();
  });
});

// ── F1 (fix round 1): "moving log.append after the INSERT loop stays green"
// was reported as genuinely undetectable with the given fakes — wrong. Since
// `PoolEdgeLog` has no private members and `setAccountPools` takes `log` as a
// parameter, a fake whose `append()` reads the SAME `db` observes the world
// from INSIDE the still-open transaction. These are the reviewer's own fakes,
// run and confirmed: RED under "move append after the INSERT loop", green on
// shipped code.
class ObservingLog {
  readonly logPath = '/dev/null/never-written';
  seen: { edgeRows: number; epoch: number; entries: number } | null = null;
  constructor(private readonly db: DatabaseSync) {}
  append(entries: readonly PoolEdgeLogEntry[]): void {
    const edgeRows = (this.db.prepare('SELECT COUNT(*) AS n FROM pool_edges').get() as { n: number }).n;
    const epoch = (this.db.prepare('SELECT epoch AS e FROM pool_epoch WHERE id = 1').get() as { e: number }).e;
    this.seen = { edgeRows, epoch, entries: entries.length };
  }
  maxEpoch(): number | null { return null; }
}

// The CONTROL: proves the fake CAN see a row inside the transaction at all —
// without this, `edgeRows: 0` in the test below could mean "uncommitted rows
// are invisible on this connection" rather than "append genuinely ran before
// the INSERT loop." Measured: rows ARE visible; this is what keeps that
// measured rather than assumed.
class InsertingControlLog {
  readonly logPath = '/dev/null/never-written';
  seenBefore: number | null = null;
  seenAfter: number | null = null;
  constructor(private readonly db: DatabaseSync) {}
  append(): void {
    this.seenBefore = (this.db.prepare('SELECT COUNT(*) AS n FROM pool_edges').get() as { n: number }).n;
    this.db.prepare(
      "INSERT INTO pool_edges (subjectKind, subjectId, pool, addedAt, addedBy) " +
      "VALUES ('account', 'control-probe', 'control-pool', 0, NULL)",
    ).run();
    this.seenAfter = (this.db.prepare('SELECT COUNT(*) AS n FROM pool_edges').get() as { n: number }).n;
  }
  maxEpoch(): number | null { return null; }
}

describe('journal-before-commit is OBSERVABLE, not just orderable (F1, fix round 1)', () => {
  it('on the FIRST write, append sees ZERO edge rows and epoch 0 — before the INSERT loop, not after', () => {
    const { store } = fresh();
    const observer = new ObservingLog(store.db);
    store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1 }, observer);
    expect(observer.seen).toEqual({ edgeRows: 0, epoch: 0, entries: 1 });
  });

  it('CONTROL: the same connection DOES see a row inserted inside the transaction — edgeRows:0 above is not connection blindness', () => {
    const { store } = fresh();
    const control = new InsertingControlLog(store.db);
    store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1 }, control);
    expect(control.seenBefore).toBe(0);
    expect(control.seenAfter).toBe(1);
  });
});

// ── F2 (fix round 1): `pool_edges_one_per_account` is a PARTIAL unique index
// and was unpinned — deleting it left 83/83 green, because the store's own
// "second write REPLACES" test DELETEs before it INSERTs, never exercising
// the index at all. Pin the index directly: a two-row INSERT for one
// subjectId must throw, and a `subjectKind != 'account'` pair must NOT be
// constrained — the second half is what pins the *partial*-ness, not just a
// plain unique index on `subjectId`.
describe('pool_edges_one_per_account is a PARTIAL unique index (F2, fix round 1)', () => {
  it('a direct two-row INSERT for one account subjectId throws', () => {
    const { store } = fresh();
    const db = store.db;
    db.exec("INSERT INTO pool_edges (subjectKind, subjectId, pool, addedAt, addedBy) " +
            "VALUES ('account', 'acct-a', 'pool-a', 1, NULL)");
    expect(() => db.exec("INSERT INTO pool_edges (subjectKind, subjectId, pool, addedAt, addedBy) " +
                          "VALUES ('account', 'acct-a', 'pool-b', 2, NULL)"))
      .toThrow();
  });

  it('a subjectKind != \'account\' pair is NOT constrained — this is the partial-ness', () => {
    const { store } = fresh();
    const db = store.db;
    db.exec("INSERT INTO pool_edges (subjectKind, subjectId, pool, addedAt, addedBy) " +
            "VALUES ('project', 'acct-a', 'pool-a', 1, NULL)");
    expect(() => db.exec("INSERT INTO pool_edges (subjectKind, subjectId, pool, addedAt, addedBy) " +
                          "VALUES ('project', 'acct-a', 'pool-b', 2, NULL)"))
      .not.toThrow();
  });
});

// ── F3 (fix round 1): `poolEpoch()` and the private `poolEdgeDigest()` were
// asserted by NOTHING — a returned `{epoch:-1,issuedAt:-1,digest:'WRONG'}`
// stayed 7/7 green. The digest is measured stable and content-sensitive; these
// are the three assertions that were missing.
describe('poolEpoch() and poolEdgeDigest() are asserted (F3, fix round 1)', () => {
  it('poolEpoch() reflects the written epoch, issuedAt and a real digest — not a stub value', () => {
    const { store, log } = fresh();
    const r = store.setAccountPools({ accountId: 'acct-a', pools: ['p1'], addedBy: 'op', now: 42 }, log);
    expect(r).toEqual({ ok: true, epoch: 1 });
    expect(store.poolEpoch()).toEqual({ epoch: 1, issuedAt: 42, digest: bodyDigest('acct-a p1') });
  });

  it('the digest is CONTENT-SENSITIVE: a second account changes it', () => {
    const { store, log } = fresh();
    store.setAccountPools({ accountId: 'acct-a', pools: ['p1'], addedBy: 'op', now: 1 }, log);
    const d1 = store.poolEpoch().digest;
    store.setAccountPools({ accountId: 'acct-b', pools: ['p2'], addedBy: 'op', now: 2 }, log);
    const d2 = store.poolEpoch().digest;
    expect(d2).not.toBe(d1);
    expect(d2).toBe(bodyDigest('acct-a p1\nacct-b p2'));
  });

  it('the digest is STABLE: undoing the second write returns the FIRST hash again', () => {
    const { store, log } = fresh();
    store.setAccountPools({ accountId: 'acct-a', pools: ['p1'], addedBy: 'op', now: 1 }, log);
    const d1 = store.poolEpoch().digest;
    store.setAccountPools({ accountId: 'acct-b', pools: ['p2'], addedBy: 'op', now: 2 }, log);
    store.setAccountPools({ accountId: 'acct-b', pools: [], addedBy: 'op', now: 3 }, log);   // clear acct-b
    expect(store.poolEpoch().digest).toBe(d1);
  });
});

// ── F5/T6-R4 (fix round 1): a two-pool write used to throw a raw `UNIQUE
// constraint failed` AFTER the journal already committed a line for the
// membership the store went on to reject. Refused now, named, before either
// is touched.
describe('setAccountPools refuses more than one pool (F5/T6-R4, fix round 1)', () => {
  it('a multi-pool write is refused with a NAMED result before the journal or the db are touched', () => {
    const { store, log, dir } = fresh();
    const r = store.setAccountPools(
      { accountId: 'acct-a', pools: ['pool-a', 'pool-b'], addedBy: 'op', now: 1 }, log);
    expect(r).toEqual({ ok: false, error: 'multi-pool-not-supported', pools: ['pool-a', 'pool-b'] });
    // The journal file was never even created — the check runs before
    // `log.maxEpoch()`/`log.append()`.
    expect(() => readFileSync(path.join(dir, 'pool-edges.log'), 'utf8')).toThrow();
    expect(store.poolEpoch()).toEqual({ epoch: 0, issuedAt: 0, digest: '' });
    expect(store.accountPoolEdges().has('acct-a')).toBe(false);
  });
});

// ── F6/T6-R5 (fix round 1), the one that matters most: a journal that EXISTS
// but yields no epoch must THROW. Only ENOENT may answer null. The old
// `return null` on a zero-length (or unparseable) file let a real reissue
// through with no unreadable file anywhere in the sequence — measured below.
describe('maxEpoch: only ENOENT answers null (F6/T6-R5, fix round 1)', () => {
  it('an EXISTING zero-length journal (the ext4 delayed-allocation crash shape) THROWS', () => {
    const { log, dir } = fresh();
    writeFileSync(path.join(dir, 'pool-edges.log'), '', 'utf8');
    expect(() => log.maxEpoch()).toThrow();
  });

  it('setAccountPools refuses to write through a zero-length journal rather than reissue', () => {
    const { store, log, dir } = fresh();
    writeFileSync(path.join(dir, 'pool-edges.log'), '', 'utf8');
    expect(() => store.setAccountPools({ accountId: 'acct-a', pools: ['p1'], addedBy: 'op', now: 1 }, log))
      .toThrow();
  });

  it('reproduces the real reissue this guard closes: two epochs, a torn journal, a restored older coord.db — epoch 1 must NOT come back', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'pool-edges-'));
    const dbPath = path.join(d, 'coord.db');
    const logPath = path.join(d, 'pool-edges.log');
    const snapPath = path.join(d, 'coord.db.snapshot');
    const log = new PoolEdgeLog(logPath);

    let store = new CoordStore(openCoordDb(dbPath));
    store.setAccountPools({ accountId: 'acct-a', pools: ['p1'], addedBy: 'op', now: 1 }, log);   // epoch 1
    store.db.close();                                  // checkpoints WAL into the main file
    copyFileSync(dbPath, snapPath);                     // the "older snapshot": epoch 1 only

    store = new CoordStore(openCoordDb(dbPath));
    store.setAccountPools({ accountId: 'acct-a', pools: ['p2'], addedBy: 'op', now: 2 }, log);   // epoch 2
    store.db.close();

    writeFileSync(logPath, '', 'utf8');                 // crash-torn journal: zero bytes
    for (const suffix of ['-wal', '-shm']) {
      try { rmSync(dbPath + suffix); } catch { /* may not exist */ }
    }
    copyFileSync(snapPath, dbPath);                     // restore the pre-epoch-2 snapshot

    const restoredStore = new CoordStore(openCoordDb(dbPath));
    const restoredLog = new PoolEdgeLog(logPath);
    // Before the fix: `maxEpoch()` on the zero-length file returned `null`,
    // `dbMax` (back at 1 from the restored snapshot) handed out epoch 1
    // again — a real reissue reachable with no unreadable file anywhere.
    // After the fix this throws instead.
    expect(() => restoredStore.setAccountPools(
      { accountId: 'acct-b', pools: ['p3'], addedBy: 'op', now: 3 }, restoredLog))
      .toThrow();
  });
});
