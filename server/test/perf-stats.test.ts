import { describe, it, expect } from 'vitest';
import { NumberRing, percentile, perfSummaryLine } from '../src/perf/stats.js';
import type { PerfHealth } from '../../shared/perf.js';

describe('perf stats (console speed S1)', () => {
  it('percentiles over a known series are nearest-rank on the sorted copy', () => {
    const series = [50, 10, 40, 20, 30, 100, 90, 80, 70, 60];
    expect(percentile(series, 50)).toBe(50);
    expect(percentile(series, 95)).toBe(100);
    expect(percentile(series, 99)).toBe(100);
    expect(percentile(series, 10)).toBe(10);
    expect(percentile([], 50)).toBe(0);
    expect(series[0]).toBe(50); // the input is not sorted in place
  });

  it('the ring keeps the last N', () => {
    const ring = new NumberRing(3);
    for (const n of [1, 2, 3, 4, 5]) ring.push(n);
    expect(ring.values()).toEqual([3, 4, 5]);
  });

  it('the summary line names every field', () => {
    const h: PerfHealth = {
      since: 1,
      tick: { count: 7, lastMs: 11, p50Ms: 12, p95Ms: 13, maxMs: 14, overIntervalCount: 2, phases: { hooks: { lastMs: 5, p95Ms: 6 }, usage: { lastMs: 1, p95Ms: 2 } } },
      link: { readdir: { count: 3, p50Ms: 21, p95Ms: 22, maxMs: 23 } },
      loop: { p50Ms: 31, p99Ms: 32, maxMs: 33 },
      slowRoutes: [{ route: '/api/x', method: 'GET', ms: 600, at: 5 }],
    };
    const line = perfSummaryLine(h, 4);
    for (const word of ['ticks=7', 'last=11', 'p50=12', 'p95=13', 'max=14', 'over=2', 'slowest=hooks', 'readdir', 'p50=21', 'p95=22', 'max=23', 'loop', 'p99=32', 'max=33', 'slowRoutes=1', 'suppressed=4']) {
      expect(line, word).toContain(word);
    }
    expect(perfSummaryLine({ ...h, loop: null }, 0)).toContain('loop=none');
  });
});
