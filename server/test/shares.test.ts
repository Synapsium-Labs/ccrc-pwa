import { describe, it, expect } from 'vitest';
import { parseSweepShares, shareFor, sweepLatestPath } from '../src/shares.js';

const ISO = '2026-09-15T12:00:00Z';
const ISO_S = Date.UTC(2026, 8, 15, 12, 0, 0) / 1000;
const body = (accounts: Record<string, number | null>): string => JSON.stringify({
  finishedAt: ISO,
  perAccount: Object.fromEntries(Object.entries(accounts).map(([a, e]) => [a, { fableShare: { estimate: e } }])),
});

describe('parseSweepShares', () => {
  it('reads finishedAt and each account\'s estimate as an integer percent, floor(x*100+0.5)', () => {
    const r = parseSweepShares(body({ claude: 0.405, 'claude-a': 0.0, gpt: null }));
    expect(r).toEqual({ kind: 'reading', finishedAtS: ISO_S, byAccount: { claude: 41, 'claude-a': 0, gpt: null } });
  });
  it('malformed: not JSON, not an object, no finishedAt, a finishedAt that does not parse, perAccount not an object', () => {
    for (const c of ['nope', '[]', '{}', '{"finishedAt":"yesterday","perAccount":{}}', '{"finishedAt":"2026-09-15T12:00:00Z","perAccount":3}']) {
      expect(parseSweepShares(c), c).toEqual({ kind: 'malformed' });
    }
  });
  it('an account row without fableShare, or with a non-numeric estimate, is a null estimate — a row, not a malformed file', () => {
    const r = parseSweepShares(JSON.stringify({ finishedAt: ISO, perAccount: { claude: {}, 'claude-a': { fableShare: { estimate: 'x' } } } }));
    expect(r).toEqual({ kind: 'reading', finishedAtS: ISO_S, byAccount: { claude: null, 'claude-a': null } });
  });
});

describe('shareFor', () => {
  it('null for a non-reading and for an account the pass did not see; a ShareReading otherwise', () => {
    expect(shareFor({ kind: 'absent' }, 'claude')).toBeNull();
    expect(shareFor({ kind: 'malformed' }, 'claude')).toBeNull();
    const r = parseSweepShares(body({ claude: 0.1 }));
    expect(shareFor(r, 'nobody')).toBeNull();
    expect(shareFor(r, 'claude')).toEqual({ estimatePct: 10, finishedAtS: ISO_S });
  });
  it('the path is the sweep\'s own, under the .cc-sessions read root', () => {
    expect(sweepLatestPath('/h/.cc-sessions')).toBe('/h/.cc-sessions/usage/sweep/latest.json');
  });
});
