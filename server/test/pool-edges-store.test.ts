// Account-pool membership (design 2026-09-18 §5.2), task 6: the authoritative
// store `pool_edges`/`pool_epoch` and the flat-file journal under it. Same
// doctrine as `ledger-store.test.ts`'s allocator: the journal is appended
// INSIDE the transaction, BEFORE the commit, and recovery takes MAX(file,
// db) — so an epoch is SKIPPED, NEVER REISSUED. See `pooledgelog.ts`'s own
// docstring for why: a lost coord.db that could not reconstruct would answer
// "untagged" for every account, and untagged is the fail-OPEN direction this
// whole design exists to prevent.
import { describe, it, expect } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { PoolEdgeLog } from '../src/coord/pooledgelog.js';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fresh = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'pool-edges-'));
  return { store: new CoordStore(openCoordDb(path.join(d, 'coord.db'))),
           log: new PoolEdgeLog(path.join(d, 'pool-edges.log')), dir: d };
};

describe('pool_edges', () => {
  it('writes one row per edge and bumps the epoch', () => {
    const { store, log } = fresh();
    const r = store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1000 }, log);
    expect(r.epoch).toBe(1);
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
    expect(r.epoch).toBe(10);          // 9 skipped, never handed out twice
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
});
