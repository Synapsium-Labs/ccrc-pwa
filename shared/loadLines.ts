// The load lines and the runway's words (Overlord W1 serviceability PR B, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md` Task 4; spec §6.8 Table 6.8a, C57, Table 11.5b).
// L0, context C1: it imports NOTHING, not even `node:*`, because the PWA bundles this file (home B's capacity line reads
// `PoolRunwayAnswer` off `GET /api/pools/runway`). Every number here is a starting value (the W1 index's question 7).

/** The three load lines, in percent of an account's measured load (§6.8). `soft` is ccd's `FRESH_PICK_SOFT_PCT`. */
export const LOAD_LINE_PCT = { soft: 70, hard: 85, chat: 95 } as const;
export type LoadLine = keyof typeof LOAD_LINE_PCT;
/** Every line, derived from the map (wire totality). */
export const LOAD_LINES = Object.keys(LOAD_LINE_PCT) as LoadLine[];

/** A reading older than this proves nothing "under" for the server's lines and runway (plan question 13). A reading at
 *  or past a line stays past until its window resets, so only an "under" claim and a rate need it. */
export const LOAD_FRESH_S = 3_600;

/** The sampler's beat and what it keeps (the W1 index's question 8). */
export const LIMIT_SAMPLE_MS = 5 * 60_000;
export const LIMIT_SAMPLES_KEEP_S = 30 * 86_400;

/** The runway's fit: samples of the current window inside this span of the newest, and at least this much time between
 *  the oldest and the newest of them. */
export const RUNWAY_FIT_S = { five: 7_200, seven: 86_400 } as const;
export const RUNWAY_MIN_SPAN_S = 900;

/** Why a crossing could not be projected. */
const CROSSING_UNMEASURED_MAP = {
  'no-sample': 'no sample of the current window',
  stale: 'the newest sample is older than LOAD_FRESH_S and under the line',
  rolled: 'the newest sample\'s window has reset',
  thin: 'fewer than two samples, or less than RUNWAY_MIN_SPAN_S between them',
  'no-reset': 'the window carries no reset time',
} as const;
export type CrossingUnmeasured = keyof typeof CROSSING_UNMEASURED_MAP;
export const CROSSING_UNMEASURED = Object.keys(CROSSING_UNMEASURED_MAP) as CrossingUnmeasured[];

/** When a line is crossed: `at` (at or before now: already past), not before the window's reset, or unmeasured. */
export type Crossing =
  | { readonly kind: 'at'; readonly atS: number }
  | { readonly kind: 'not-before-reset'; readonly resetS: number }
  | { readonly kind: 'unmeasured'; readonly why: CrossingUnmeasured };

/** When an exhausted account regains headroom (ruled, F2): never a bare null. */
export type EarliestReset =
  | { readonly kind: 'none-exhausted' }
  | { readonly kind: 'at'; readonly atS: number }
  | { readonly kind: 'unmeasured'; readonly why: 'no-sample' | 'stale' | 'no-reset' };

export interface PoolRunwayAnswer {
  /** Crossing `SEVEN_DAY_CEILING_PCT`: the pool runs out. */
  readonly out: Crossing;
  readonly lines: Readonly<Record<LoadLine, Crossing>>;
  readonly earliestReset: EarliestReset;
}

/** A load line now, over the Overlord's candidate accounts (plan question 14). */
export type LineState =
  | { readonly kind: 'under' }
  | { readonly kind: 'past'; readonly leastPct: number }
  | { readonly kind: 'unmeasured'; readonly why: 'no-candidate' | 'stale' };

/** `GET /api/pools/runway` (the home plan's question 6): one answer per pool, the untagged accounts under `pool: null`.
 *  Masked: it names pools, never an account. */
export interface PoolRunwayWire {
  readonly ok: true;
  readonly nowS: number;
  readonly pools: readonly { readonly pool: string | null; readonly runway: PoolRunwayAnswer }[];
}
