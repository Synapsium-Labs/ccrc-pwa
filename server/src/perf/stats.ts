// Pure arithmetic for the perf recorder (console speed S1, L1): a fixed-size ring and nearest-rank percentiles.
// No clock, no timer, no console.
import type { PerfHealth } from '../../../shared/perf.js';

/** The last `cap` numbers pushed, oldest first. */
export class NumberRing {
  private readonly buf: number[] = [];
  constructor(private readonly cap: number) {}
  push(n: number): void {
    this.buf.push(n);
    if (this.buf.length > this.cap) this.buf.shift();
  }
  values(): number[] { return [...this.buf]; }
}

/** Nearest-rank percentile on a sorted copy: the value at rank ceil(p/100 * n). 0 for an empty series. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

const r = (n: number): number => Math.round(n * 10) / 10;

/** The one summary line, naming every field; `suppressed` is the event lines dropped since the last summary. */
export function perfSummaryLine(h: PerfHealth, suppressed: number): string {
  const t = h.tick;
  let slowest = 'none';
  let slowestP95 = -1;
  for (const [name, p] of Object.entries(t.phases)) if (p.p95Ms > slowestP95) { slowest = name; slowestP95 = p.p95Ms; }
  const slowestText = slowestP95 < 0 ? 'none' : `${slowest}(p95=${r(slowestP95)})`;
  const link = Object.entries(h.link)
    .map(([op, s]) => `${op}(n=${s.count} p50=${r(s.p50Ms)} p95=${r(s.p95Ms)} max=${r(s.maxMs)})`).join(' ') || 'none';
  const loop = h.loop === null ? 'none' : `(p50=${r(h.loop.p50Ms)} p99=${r(h.loop.p99Ms)} max=${r(h.loop.maxMs)})`;
  return `ccrc-server: perf summary tick(ticks=${t.count} last=${r(t.lastMs)} p50=${r(t.p50Ms)} p95=${r(t.p95Ms)} max=${r(t.maxMs)} over=${t.overIntervalCount}) slowest=${slowestText} link: ${link} loop=${loop} slowRoutes=${h.slowRoutes.length} suppressed=${suppressed}`;
}
