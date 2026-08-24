// D13: the allocator self-seeds, then fails shut — and D8: the FILE FIRST,
// the COMMIT SECOND, recovery MAX(file, db), numbers skipped never reissued.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { LedgerLog } from '../src/coord/ledgerlog.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;

const fixture = (): { s: CoordStore; log: LedgerLog } => {
  const home = mkTmp('ccrc-ledger-');
  return {
    s: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))),
    log: new LedgerLog(path.join(home, '.ccrc', 'ledger-alloc.log')),
  };
};

const alloc = (s: CoordStore, log: LedgerLog, count = 1, now = NOW) =>
  s.allocateDeviations({ project: 'demo', count, title: 'the measured-read seam',
    allocatedTo: 'demo-quiet-basin', runId: null, now }, log);

describe('CoordStore.allocateDeviations', () => {
  it('FAILS SHUT until seeded — 409 not-seeded before a floor exists (D13)', () => {
    const { s, log } = fixture();
    expect(alloc(s, log)).toEqual({ ok: false, why: 'not-seeded' });
    expect(log.maxAllocated('demo')).toBeNull();          // nothing written anywhere
    expect(s.ledgerAllocations('demo')).toEqual([]);
  });

  it('seeded: contiguous numbers from the floor, in the file AND the db', () => {
    const { s, log } = fixture();
    s.raiseLedgerFloor('demo', 261, 'docs/superpowers/specs/x.md names D-211', NOW);
    const r = alloc(s, log, 3);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error('unreachable');
    expect(r.allocation).toEqual({ project: 'demo', numbers: [261, 262, 263], floor: 261,
      title: 'the measured-read seam', allocatedTo: 'demo-quiet-basin',
      runId: null, allocatedAt: NOW });
    expect(log.maxAllocated('demo')).toBe(263);
    expect(s.ledgerAllocations('demo').map((a) => [a.n, a.state])).toEqual(
      [[261, 'allocated'], [262, 'allocated'], [263, 'allocated']]);
  });

  it('bad-count refuses before anything is written', () => {
    const { s, log } = fixture();
    s.raiseLedgerFloor('demo', 261, 'seeded', NOW);
    expect(alloc(s, log, 0)).toEqual({ ok: false, why: 'bad-count' });
    expect(log.maxAllocated('demo')).toBeNull();
  });

  it('RECOVERY IS MAX(file, db): a file the database never heard of still moves the cursor', () => {
    const { s, log } = fixture();
    s.raiseLedgerFloor('demo', 261, 'seeded', NOW);
    // The crash shape: an earlier process appended and died before its commit.
    log.append([{ project: 'demo', n: 300, title: 'lost', allocatedTo: 'demo-calm-mesa', at: 1 }]);
    const r = alloc(s, log);
    if (!r.ok) throw new Error('unreachable');
    expect(r.allocation.numbers).toEqual([301]);          // 261..300 SKIPPED, never reissued
  });

  it('the floor only ever RISES', () => {
    const { s, log } = fixture();
    s.raiseLedgerFloor('demo', 261, 'first evidence', NOW);
    s.raiseLedgerFloor('demo', 200, 'a lower scan later', NOW + 1);
    expect(s.ledgerFloor('demo')).toEqual({ floor: 261, evidence: 'first evidence', updatedAt: NOW });
    s.raiseLedgerFloor('demo', 400, 'a higher scan', NOW + 2);
    expect(s.ledgerFloor('demo')).toMatchObject({ floor: 400, evidence: 'a higher scan' });
  });

  it('markLanded stamps allocated -> landed, once, and staleAllocations reports the never-landed', () => {
    const { s, log } = fixture();
    s.raiseLedgerFloor('demo', 261, 'seeded', NOW);
    alloc(s, log, 2);
    s.markLanded('demo', 261, 'docs/superpowers/plans/2026-08-24-plan.md', NOW + 5);
    const rows = s.ledgerAllocations('demo');
    expect(rows[0]).toMatchObject({ n: 261, state: 'landed', landedAt: NOW + 5,
      landedIn: 'docs/superpowers/plans/2026-08-24-plan.md' });
    expect(rows[1]).toMatchObject({ n: 262, state: 'allocated', landedAt: null });
    // landed is terminal: a re-mark does not re-stamp
    s.markLanded('demo', 261, 'docs/superpowers/plans/other.md', NOW + 99);
    expect(s.ledgerAllocations('demo')[0]!.landedAt).toBe(NOW + 5);
    expect(s.staleAllocations(NOW + 1).map((a) => a.n)).toEqual([262]);
    expect(s.openAllocations().map((a) => a.n)).toEqual([262]);
  });
});
