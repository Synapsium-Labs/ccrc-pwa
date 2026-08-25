// D13's pure half: the allocator's decision and the floor scan. The CAS
// (BEGIN IMMEDIATE, PRIMARY KEY backstop, the log-first append) is part B;
// ledger-race.test.ts lives there with it. What THIS file pins is the
// arithmetic that makes a number impossible to reissue — and the D14
// transition rule that a legacy D-B<k>-<m> is recognized but never seeds
// the global namespace.
import { describe, it, expect } from 'vitest';
import { LEDGER_SEED_GAP } from '../../shared/api.js';
import { decideAllocation, floorFromScan, LEDGER_ALLOC_MAX } from '../src/coord/ledger.js';

describe('decideAllocation', () => {
  it('answers not-seeded until a floor row exists — refuse to allocate rather than open empty (D13)', () => {
    expect(decideAllocation(null, null, 1)).toEqual({ refused: 'not-seeded' });
  });

  it('issues a contiguous block starting at the floor', () => {
    expect(decideAllocation({ floor: 260 }, null, 3))
      .toEqual({ ok: true, numbers: [260, 261, 262], floor: 260 });
  });

  it('starts past the greatest number ever ISSUED — an allocated-but-unwritten number is never reissued', () => {
    // 265 was allocated but has landed in no plan yet; the scan cannot see
    // it, which is exactly why the issued max — not the floor — wins here.
    expect(decideAllocation({ floor: 260 }, 265, 2))
      .toEqual({ ok: true, numbers: [266, 267], floor: 260 });
  });

  it('the floor wins when history sits below it — the floor only ever rises', () => {
    expect(decideAllocation({ floor: 260 }, 210, 1))
      .toEqual({ ok: true, numbers: [260], floor: 260 });
  });

  it('refuses a non-integer, non-positive or over-cap count', () => {
    expect(decideAllocation({ floor: 260 }, null, 0)).toEqual({ refused: 'bad-count' });
    expect(decideAllocation({ floor: 260 }, null, 1.5)).toEqual({ refused: 'bad-count' });
    expect(decideAllocation({ floor: 260 }, null, LEDGER_ALLOC_MAX + 1))
      .toEqual({ refused: 'bad-count' });
    expect(decideAllocation({ floor: 260 }, null, LEDGER_ALLOC_MAX))
      .toMatchObject({ ok: true });
  });

  it('bad-count is refused even unseeded — the caller learns BOTH defects in the worst case, not one per retry', () => {
    expect(decideAllocation(null, null, 0)).toEqual({ refused: 'bad-count' });
  });
});

describe('floorFromScan', () => {
  it('takes max(D-<n>) + LEDGER_SEED_GAP, with evidence naming the file and the number', () => {
    const r = floorFromScan([
      { path: 'docs/superpowers/plans/a.md', text: 'closes D-114 and D-149.' },
      { path: 'docs/superpowers/plans/b.md', text: 'the ledger reaches D-210 here.' },
    ]);
    expect(r).toEqual({
      floor: 210 + LEDGER_SEED_GAP,
      evidence: 'docs/superpowers/plans/b.md names D-210',
      legacy: [],
    });
  });

  it('recognizes the legacy D-B<k>-<m> form and reports it — but it NEVER feeds the floor (D14)', () => {
    const r = floorFromScan([
      { path: 'p.md', text: 'D-210 stands; D-B4-' + '400 is legacy and its 400 is another namespace.' },
    ]);
    expect(r).toEqual({
      floor: 210 + LEDGER_SEED_GAP,
      evidence: 'p.md names D-210',
      legacy: ['D-B4-' + '400'],
    });
  });

  it('a tree with ONLY legacy refs is NOT a seed — fail shut, not guess (D13/D14)', () => {
    expect(floorFromScan([{ path: 'p.md', text: 'only D-B4-9 and D-B8-13 here' }])).toBeNull();
  });

  it('an empty scan is null, and null is not a floor of 50', () => {
    expect(floorFromScan([])).toBeNull();
    expect(floorFromScan([{ path: 'p.md', text: 'no deviations named' }])).toBeNull();
  });

  it('does not misparse: D-TBD-<slug>, a legacy tail, and a 6-digit token all feed nothing', () => {
    const r = floorFromScan([
      // Placeholder built by concatenation — dtbd.test.ts scans every tracked
      // file for the concrete form, and this fixture must feed the parser the
      // real string without landing the literal in the tree.
      { path: 'p.md', text: 'D-42 is real; ' + 'D-TBD' + '-mirror-gap is a placeholder; D-123456 is garbage.' },
    ]);
    expect(r).toEqual({ floor: 42 + LEDGER_SEED_GAP, evidence: 'p.md names D-42', legacy: [] });
  });
});

describe('D13 property: a block is contiguous, above the floor, above ALL history', () => {
  it('every issued block is gap-free and strictly increasing', () => {
    const d = decideAllocation({ floor: 260 }, 271, 5);
    if (!('ok' in d)) throw new Error('expected ok');
    expect(d.numbers).toEqual([272, 273, 274, 275, 276]);
    for (let i = 1; i < d.numbers.length; i++) {
      expect(d.numbers[i]! - d.numbers[i - 1]!).toBe(1);
    }
    expect(Math.min(...d.numbers)).toBeGreaterThan(271);
    expect(Math.min(...d.numbers)).toBeGreaterThanOrEqual(260);
  });
});
