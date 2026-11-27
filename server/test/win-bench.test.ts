import { describe, it, expect } from 'vitest';
import { summarise, parseEntryLog, parseUnitJournal } from '../../win/bench/timing-report.mjs';

describe('win bench: timing-report', () => {
  it('summarises durations', () => {
    expect(summarise([5, 1, 3, 2, 4])).toEqual({ n: 5, median: 3, p90: 5, total: 15 });
  });
  it('reads the launcher log by verb, ignoring a torn last line', () => {
    const m = parseEntryLog('1700000000000\tcaps\t120\t0\n1700000000100\tcaps\t80\t0\n1700000000200\tlist\t9\t0\n17000');
    expect(m.get('caps')).toEqual([120, 80]);
    expect(m.get('list')).toEqual([9]);
    expect(m.size).toBe(2);
  });
  it('pairs start and exit lines of the manager journal, from a given time on', () => {
    const j = [
      '2026-01-01T00:00:00.000Z start ccd-scope-sweep.service #1 pid=10',
      '2026-01-01T00:00:13.000Z exit ccd-scope-sweep.service code=0 signal=null wanted=true',
      '2026-01-02T00:00:00.000Z start ccd-scope-sweep.service #1 pid=11',
      '2026-01-02T00:00:02.500Z exit ccd-scope-sweep.service code=0 signal=null wanted=true',
    ].join('\n');
    expect(parseUnitJournal(j, Date.parse('2026-01-02T00:00:00Z')).get('ccd-scope-sweep')).toEqual([2500]);
  });
});
