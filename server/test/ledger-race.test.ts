// Spec §3/§4: "Two sessions race the allocator — serialised by BEGIN
// IMMEDIATE; DatabaseSync cannot yield inside it. PRIMARY KEY (project, n)
// makes any future loss of the transaction a loud constraint error."
// ledger-race fires 20 concurrent allocations and asserts 20 distinct
// contiguous numbers; the trigger test below is the one that goes RED when
// the transaction is lost, and the raw-INSERT test is the one that goes RED
// when the PRIMARY KEY is lost. Between them, neither mechanism can be
// "simplified away" as redundant (D11's own ordering rule).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { LedgerLog } from '../src/coord/ledgerlog.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;

const fixture = (): { s: CoordStore; log: LedgerLog } => {
  const home = mkTmp('ccrc-ledger-race-');
  const s = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  s.raiseLedgerFloor('demo', 100, 'seeded by the race fixture', NOW);
  return { s, log: new LedgerLog(path.join(home, '.ccrc', 'ledger-alloc.log')) };
};

describe('the allocator under fire', () => {
  it('20 concurrent allocations -> 20 DISTINCT CONTIGUOUS numbers', async () => {
    const { s, log } = fixture();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      Promise.resolve().then(() => s.allocateDeviations({
        project: 'demo', count: 1, title: `racer ${i}`,
        allocatedTo: 'demo-quiet-basin', runId: null, now: NOW,
      }, log))));
    const nums = results.flatMap((r) => (r.ok ? [...r.allocation.numbers] : []));
    expect(nums).toHaveLength(20);
    expect(new Set(nums).size).toBe(20);
    expect([...nums].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => 100 + i));
    expect(log.maxAllocated('demo')).toBe(119);
  });

  it('A MID-BATCH FAILURE ROLLS THE WHOLE BATCH BACK — and the file keeps the numbers, skipped forever', () => {
    // THIS is the test that reds when the transaction is lost: without the
    // tx, 100 and 101 would survive the abort on 102 as a half-committed
    // allocation — exactly the partial-acquisition shape D12 forbids for
    // claims, on the ledger side.
    const { s, log } = fixture();
    s.db.exec(
      'CREATE TRIGGER ledger_boom BEFORE INSERT ON ledger_alloc WHEN NEW.n = 102 ' +
      "BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    expect(() => s.allocateDeviations({
      project: 'demo', count: 3, title: 'doomed batch',
      allocatedTo: 'demo-quiet-basin', runId: null, now: NOW,
    }, log)).toThrow(/boom/);
    expect(s.ledgerAllocations('demo')).toEqual([]);       // ALL-or-nothing in the db…
    expect(log.maxAllocated('demo')).toBe(102);            // …and the FILE keeps all three
    s.db.exec('DROP TRIGGER ledger_boom');
    const next = s.allocateDeviations({
      project: 'demo', count: 1, title: 'after the crash',
      allocatedTo: 'demo-quiet-basin', runId: null, now: NOW + 1,
    }, log);
    if (!next.ok) throw new Error('unreachable');
    expect(next.allocation.numbers).toEqual([103]);        // SKIPPED, NEVER REISSUED
  });

  it('THE BACKSTOP IS THE REAL PRIMARY KEY: a duplicate (project, n) throws LOUDLY, never lands silently', () => {
    const { s } = fixture();
    const ins = (project: string, n: number): void => {
      s.db.prepare(
        'INSERT INTO ledger_alloc (project, n, title, allocatedTo, runId, allocatedAt, state) ' +
        "VALUES (?, ?, 'x', 'demo-quiet-basin', NULL, 1, 'allocated')",
      ).run(project, n);
    };
    ins('demo', 200);
    expect(() => ins('demo', 200)).toThrow(/PRIMARY KEY|UNIQUE/i);
    // and the key is (project, n), not n: another project may hold 200
    expect(() => ins('other-project', 200)).not.toThrow();
  });
});
