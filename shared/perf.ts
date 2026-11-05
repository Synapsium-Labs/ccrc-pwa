// The console's own timing block (console speed S1): what the server measured about itself. L0, imports nothing.
// `since` is when the recorder began; `loop` is null before the monitor has a sample; `slowRoutes` keeps the last 20.
export interface PerfHealth {
  since: number;
  tick: { count: number; lastMs: number; p50Ms: number; p95Ms: number; maxMs: number; overIntervalCount: number; phases: Record<string, { lastMs: number; p95Ms: number }> };
  link: Record<string, { count: number; p50Ms: number; p95Ms: number; maxMs: number }>;
  loop: { p50Ms: number; p99Ms: number; maxMs: number } | null;
  slowRoutes: { route: string; method: string; ms: number; at: number }[];
}
