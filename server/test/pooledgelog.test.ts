// D8, the `ledger_alloc` shape: `pool_edges` is AUTHORITATIVE WITH A FLAT-FILE
// GROUND TRUTH — every epoch is appended to ~/.ccrc/pool-edges.log FIRST and
// committed SECOND; recovery takes MAX(file, db), so an epoch is SKIPPED,
// NEVER REISSUED. `pool-edges-store.test.ts` covers `PoolEdgeLog` through
// `CoordStore.setAccountPools`; this file is `ledgerlog.test.ts`'s missing
// twin — `PoolEdgeLog` and `defaultPoolEdgeLogPath` on their own, unwired
// from any store (F-minor, fix round 1: `defaultPoolEdgeLogPath` was asserted
// nowhere while its `ledgerlog.ts` sibling is pinned).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { PoolEdgeLog, defaultPoolEdgeLogPath } from '../src/coord/pooledgelog.js';
import { mkTmp } from './tmpHelpers.js';

const fresh = (): PoolEdgeLog =>
  new PoolEdgeLog(path.join(mkTmp('ccrc-pooledgelog-'), '.ccrc', 'pool-edges.log'));

describe('PoolEdgeLog', () => {
  it('defaultPoolEdgeLogPath is ~/.ccrc/pool-edges.log', () => {
    expect(defaultPoolEdgeLogPath('/home/u')).toBe('/home/u/.ccrc/pool-edges.log');
  });

  it('a missing file is null — nothing was ever tagged', () => {
    expect(fresh().maxEpoch()).toBeNull();
  });

  it('append creates the parent and maxEpoch reads back the max across every line', () => {
    const log = fresh();
    log.append([
      { epoch: 1, accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', at: 1 },
      { epoch: 2, accountId: 'acct-b', pools: ['pool-b'], addedBy: 'op', at: 2 },
    ]);
    expect(log.maxEpoch()).toBe(2);
    expect(readFileSync(log.logPath, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('A TORN FINAL LINE STILL COUNTS — a crash mid-append must not resurrect its epoch', () => {
    const log = fresh();
    log.append([{ epoch: 1, accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', at: 1 }]);
    appendFileSync(log.logPath, '{"epoch":7,"accountId":"acct-b","po');   // no newline, no close
    expect(log.maxEpoch()).toBe(7);
  });

  it('an UNREADABLE log throws — it must fail the write, never read as empty', () => {
    const dir = mkTmp('ccrc-pooledgelog-');
    mkdirSync(path.join(dir, 'pool-edges.log'));                  // a DIRECTORY at the path: EISDIR
    expect(() => new PoolEdgeLog(path.join(dir, 'pool-edges.log')).maxEpoch()).toThrow();
  });

  it('an EXISTING zero-length file THROWS rather than answering null (F6/T6-R5)', () => {
    const logPath = path.join(mkTmp('ccrc-pooledgelog-'), 'pool-edges.log');
    appendFileSync(logPath, '');
    expect(() => new PoolEdgeLog(logPath).maxEpoch()).toThrow();
  });

  it('EXISTING content with no "epoch":<digits> anywhere THROWS, same as zero-length', () => {
    const logPath = path.join(mkTmp('ccrc-pooledgelog-'), 'pool-edges.log');
    appendFileSync(logPath, 'not json, no epoch key here\n');
    expect(() => new PoolEdgeLog(logPath).maxEpoch()).toThrow();
  });

  it('append([]) is REFUSED — an empty batch would create a file maxEpoch() cannot tell from a torn write (out-of-scope note, fix round 2)', () => {
    const logPath = path.join(mkTmp('ccrc-pooledgelog-'), 'pool-edges.log');
    expect(() => new PoolEdgeLog(logPath).append([])).toThrow();
    // Refused BEFORE the file is even touched: no zero-length file left behind.
    expect(() => new PoolEdgeLog(logPath).maxEpoch()).not.toThrow();
    expect(new PoolEdgeLog(logPath).maxEpoch()).toBeNull();
  });
});
