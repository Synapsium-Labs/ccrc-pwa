// D8/D13: ledger_alloc is AUTHORITATIVE WITH A FLAT-FILE GROUND TRUTH — every
// allocation is appended to ~/.ccrc/ledger-alloc.log FIRST and committed
// SECOND; recovery takes MAX(file, db), so a number is SKIPPED, NEVER REISSUED.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { LedgerLog, defaultLedgerLogPath } from '../src/coord/ledgerlog.js';
import { mkTmp } from './tmpHelpers.js';

const fresh = (): LedgerLog =>
  new LedgerLog(path.join(mkTmp('ccrc-ledgerlog-'), '.ccrc', 'ledger-alloc.log'));

describe('LedgerLog', () => {
  it('defaultLedgerLogPath is ~/.ccrc/ledger-alloc.log', () => {
    expect(defaultLedgerLogPath('/home/u')).toBe('/home/u/.ccrc/ledger-alloc.log');
  });

  it('a missing file is null — nothing was ever allocated', () => {
    expect(fresh().maxAllocated('demo')).toBeNull();
  });

  it('append creates the parent and maxAllocated reads back the per-project max', () => {
    const log = fresh();
    log.append([
      { project: 'demo', n: 261, title: 'a', allocatedTo: 'demo-quiet-basin', at: 1 },
      { project: 'demo', n: 262, title: 'a', allocatedTo: 'demo-quiet-basin', at: 1 },
      { project: 'other-project', n: 900, title: 'b', allocatedTo: 'x', at: 1 },
    ]);
    expect(log.maxAllocated('demo')).toBe(262);
    expect(log.maxAllocated('other-project')).toBe(900);
    expect(log.maxAllocated('never-seen')).toBeNull();
    expect(readFileSync(log.logPath, 'utf8').trim().split('\n')).toHaveLength(3);
  });

  it('A TORN FINAL LINE STILL COUNTS — a crash mid-append must not resurrect its numbers', () => {
    const log = fresh();
    log.append([{ project: 'demo', n: 261, title: 'a', allocatedTo: 'demo-quiet-basin', at: 1 }]);
    appendFileSync(log.logPath, '{"project":"demo","n":270,"ti');   // no newline, no close
    expect(log.maxAllocated('demo')).toBe(270);
  });

  it("a torn fragment whose project cannot be recovered counts for EVERY project — over-skipping is free, a reissue is bb47c9e", () => {
    const log = fresh();
    log.append([{ project: 'demo', n: 261, title: 'a', allocatedTo: 'demo-quiet-basin', at: 1 }]);
    appendFileSync(log.logPath, '"n":300,"ti');                     // project half lost
    expect(log.maxAllocated('demo')).toBe(300);
  });

  it('an UNREADABLE log throws — it must fail the allocation, never read as empty', () => {
    const dir = mkTmp('ccrc-ledgerlog-');
    mkdirSync(path.join(dir, 'ledger-alloc.log'));                  // a DIRECTORY at the path: EISDIR
    expect(() => new LedgerLog(path.join(dir, 'ledger-alloc.log')).maxAllocated('demo')).toThrow();
  });
});
