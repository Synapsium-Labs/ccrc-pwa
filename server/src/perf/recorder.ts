// The timers that change nothing (console speed S1, L4): the duration of each tick phase, the agent round trip per op,
// the event-loop delay and any route slower than 500 ms. One summary line a minute through `console.warn`, plus a line
// for a tick over its interval or a slow route, at most TEN such event lines a minute (the rest counted, and the count
// reported in the next summary). It decides nothing and no caller reads it to choose a behaviour.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { PerfHealth } from '../../../shared/perf.js';
import { NumberRing, percentile, perfSummaryLine } from './stats.js';

const SUMMARY_MS = 60_000;
const SLOW_ROUTE_MS = 500;
const MAX_EVENT_LINES = 10;
const SLOW_ROUTES_KEPT = 20;
const SAMPLES_KEPT = 300;

/** What the recorder needs of an event-loop-delay histogram (`perf_hooks.IntervalHistogram`, nanoseconds). */
export interface LoopMonitor { enable(): unknown; disable(): unknown; reset(): void; readonly count?: number; percentile(p: number): number; readonly max: number }
export interface PerfRecorderOptions { monitor?: () => LoopMonitor; now?: () => number }

const stat = (ring: NumberRing): { p50: number; p95: number; max: number; last: number } => {
  const v = ring.values();
  return { p50: percentile(v, 50), p95: percentile(v, 95), max: v.length === 0 ? 0 : Math.max(...v), last: v.at(-1) ?? 0 };
};

export class PerfRecorder {
  private readonly now: () => number;
  private readonly makeMonitor: () => LoopMonitor;
  private readonly since: number;
  private tickRing = new NumberRing(SAMPLES_KEPT);
  private tickCount = 0;
  private over = 0;
  private readonly phases = new Map<string, NumberRing>();
  private readonly links = new Map<string, { count: number; ring: NumberRing }>();
  private slow: { route: string; method: string; ms: number; at: number }[] = [];
  private suppressed = 0;
  private windowStart: number;
  private windowLines = 0;
  private monitor: LoopMonitor | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: PerfRecorderOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.makeMonitor = opts.monitor ?? (() => monitorEventLoopDelay({ resolution: 20 }));
    this.since = this.now();
    this.windowStart = this.since;
  }

  phase(name: string, ms: number): void {
    let ring = this.phases.get(name);
    if (ring === undefined) { ring = new NumberRing(SAMPLES_KEPT); this.phases.set(name, ring); }
    ring.push(ms);
  }

  tickDone(ms: number, intervalMs: number): void {
    this.tickRing.push(ms);
    this.tickCount += 1;
    if (ms > intervalMs) { this.over += 1; this.event(`ccrc-server: perf tick took ${Math.round(ms)}ms over its ${intervalMs}ms interval`); }
  }

  link(op: string, ms: number): void {
    let e = this.links.get(op);
    if (e === undefined) { e = { count: 0, ring: new NumberRing(SAMPLES_KEPT) }; this.links.set(op, e); }
    e.count += 1;
    e.ring.push(ms);
  }

  route(method: string, route: string, ms: number): void {
    if (ms <= SLOW_ROUTE_MS) return;
    this.slow.push({ route, method, ms, at: this.now() });
    if (this.slow.length > SLOW_ROUTES_KEPT) this.slow.shift();
    this.event(`ccrc-server: perf slow route ${method} ${route} took ${Math.round(ms)}ms`);
  }

  health(nowMs: number): PerfHealth {
    void nowMs;
    const t = stat(this.tickRing);
    const phases: PerfHealth['tick']['phases'] = {};
    for (const [name, ring] of this.phases) { const s = stat(ring); phases[name] = { lastMs: s.last, p95Ms: s.p95 }; }
    const link: PerfHealth['link'] = {};
    for (const [op, e] of this.links) { const s = stat(e.ring); link[op] = { count: e.count, p50Ms: s.p50, p95Ms: s.p95, maxMs: s.max }; }
    const m = this.monitor;
    const loop = m === null || !((m.count ?? 1) > 0) ? null
      : { p50Ms: m.percentile(50) / 1e6, p99Ms: m.percentile(99) / 1e6, maxMs: m.max / 1e6 };
    return {
      since: this.since,
      tick: { count: this.tickCount, lastMs: t.last, p50Ms: t.p50, p95Ms: t.p95, maxMs: t.max, overIntervalCount: this.over, phases },
      link, loop, slowRoutes: this.slow.map((s) => ({ ...s })),
    };
  }

  start(): void {
    if (this.timer !== null) return;
    this.monitor = this.makeMonitor();
    this.monitor.enable();
    this.timer = setInterval(() => {
      console.warn(perfSummaryLine(this.health(this.now()), this.suppressed));
      this.suppressed = 0;
      this.monitor?.reset();
    }, SUMMARY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    if (this.monitor !== null) { this.monitor.disable(); this.monitor = null; }
  }

  /** An event line, at most ten in a minute window; the rest are counted for the next summary. */
  private event(line: string): void {
    const at = this.now();
    if (at - this.windowStart >= SUMMARY_MS) { this.windowStart = at; this.windowLines = 0; }
    if (this.windowLines >= MAX_EVENT_LINES) { this.suppressed += 1; return; }
    this.windowLines += 1;
    console.warn(line);
  }
}

/** Await `work`, record its duration as phase `name` (also when it rejects, which is rethrown), return its value. */
export async function timed<T>(perf: PerfRecorder | undefined, name: string, work: Promise<T>): Promise<T> {
  const t0 = performance.now();
  try { return await work; } finally { perf?.phase(name, performance.now() - t0); }
}
