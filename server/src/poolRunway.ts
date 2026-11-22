// `poolRunway`: when a pool runs out, and when it crosses each load line (Overlord W1 serviceability PR B, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md` Task 4; spec C57, "A history of limits", Table 3.4b).
// Ring L1, context C1: pure decisions over the samples `limit_samples` keeps. No I/O and no clock: `nowS` is handed in.
//
// One fact the rules lean on: inside a window a load only rises, until the window resets. So a sample at or past a line
// proves "past" at any age; only a claim of "under" needs a fresh sample (within `LOAD_FRESH_S`), and only a rate needs
// fresh samples. A rolled-over window proves nothing.
import {
  LOAD_FRESH_S, LOAD_LINE_PCT, LOAD_LINES, RUNWAY_FIT_S, RUNWAY_MIN_SPAN_S,
  type Crossing, type EarliestReset, type LoadLine, type PoolRunwayAnswer, type PoolRunwayWire,
} from '../../shared/loadLines.js';
import { SEVEN_DAY_CEILING_PCT } from '../../shared/serviceability.js';
import type { Roster } from '../../shared/roster.js';
import type { AccountLimits } from './limits.js';
import { resolvedAccountPool } from './poolrule.js';

/** How far back a runway read asks for samples: the weekly window, past which every reading has rolled over
 *  (`limits.ts#readLimits`), so an older sample can prove nothing. */
export const RUNWAY_READ_S = 604_800;

/** One stored reading of one account, as `limit_samples` keeps it (`coord/limitSamplesStore.ts`). Times in seconds. */
export interface LimitSample {
  readonly account: string; readonly ts: number;
  readonly five: number | null; readonly seven: number | null;
  readonly fiveResetAt: number | null; readonly sevenResetAt: number | null;
  readonly fiveRolled: boolean; readonly sevenRolled: boolean;
  /** The producer's five-hour window width; `0` is a plan with no five-hour window. */
  readonly fiveWindowMinutes: number | null;
}

/** One window's reading at one time. */
export interface WindowSample { readonly ts: number; readonly pct: number; readonly resetAt: number | null; readonly rolled: boolean }
/** One account's two windows, oldest first. `no-window`: the plan has no five-hour window, so the weekly one is the whole. */
export interface AccountSamples { readonly five: readonly WindowSample[] | 'no-window'; readonly seven: readonly WindowSample[] }

/** One account's rows (any order) as its two windows, oldest first. A row with no figure for a window adds nothing to it. */
export function accountSamplesOf(rows: readonly LimitSample[]): AccountSamples {
  const sorted = [...rows].sort((a, b) => a.ts - b.ts);
  const newest = sorted[sorted.length - 1];
  const win = (pick: (r: LimitSample) => [number | null, number | null, boolean]): WindowSample[] => sorted.flatMap((r) => {
    const [pct, resetAt, rolled] = pick(r);
    return pct === null ? [] : [{ ts: r.ts, pct, resetAt, rolled }];
  });
  return {
    five: newest !== undefined && newest.fiveWindowMinutes === 0 ? 'no-window' : win((r) => [r.five, r.fiveResetAt, r.fiveRolled]),
    seven: win((r) => [r.seven, r.sevenResetAt, r.sevenRolled]),
  };
}

/** A window's crossing of `line` (the rules in the plan's order, N2). */
export function windowCrossing(line: number, samples: readonly WindowSample[], fitS: number, nowS: number): Crossing {
  const newest = samples[samples.length - 1];
  if (newest === undefined) return { kind: 'unmeasured', why: 'no-sample' };
  if (newest.rolled) return { kind: 'unmeasured', why: 'rolled' };
  if (newest.pct >= line) return { kind: 'at', atS: newest.ts };
  if (nowS - newest.ts > LOAD_FRESH_S) return { kind: 'unmeasured', why: 'stale' };
  if (newest.resetAt === null) return { kind: 'unmeasured', why: 'no-reset' };
  const current = samples.filter((s) => !s.rolled && s.resetAt === newest.resetAt && newest.ts - s.ts <= fitS);
  const oldest = current[0]!;
  if (current.length < 2 || newest.ts - oldest.ts < RUNWAY_MIN_SPAN_S) return { kind: 'unmeasured', why: 'thin' };
  const rate = (newest.pct - oldest.pct) / (newest.ts - oldest.ts);
  if (rate <= 0) return { kind: 'not-before-reset', resetS: newest.resetAt };
  const atS = newest.ts + (line - newest.pct) / rate;
  return atS >= newest.resetAt ? { kind: 'not-before-reset', resetS: newest.resetAt } : { kind: 'at', atS };
}

/** An account crosses when its first window does. Every window measured: the earliest `at`, or `not-before-reset` at the
 *  later reset when every window says so. A window that could not be projected voids a FUTURE crossing (it might cross
 *  sooner), so then only an `at` already past stands; otherwise `unmeasured` with the first such window's reason (slug
 *  `an-unmeasured-window-voids-a-future-crossing`). */
export function accountCrossing(line: number, a: AccountSamples, nowS: number): Crossing {
  const windows = [
    ...(a.five === 'no-window' ? [] : [windowCrossing(line, a.five, RUNWAY_FIT_S.five, nowS)]),
    windowCrossing(line, a.seven, RUNWAY_FIT_S.seven, nowS),
  ];
  const ats = windows.flatMap((w) => (w.kind === 'at' ? [w.atS] : []));
  const unmeasured = windows.find((w): w is Extract<Crossing, { kind: 'unmeasured' }> => w.kind === 'unmeasured');
  if (unmeasured !== undefined) {
    const past = ats.filter((t) => t <= nowS);
    return past.length > 0 ? { kind: 'at', atS: Math.min(...past) } : unmeasured;
  }
  if (ats.length > 0) return { kind: 'at', atS: Math.min(...ats) };
  return { kind: 'not-before-reset', resetS: Math.max(...windows.map((w) => (w as Extract<Crossing, { kind: 'not-before-reset' }>).resetS)) };
}

/** A pool crosses when its last account does: `not-before-reset` when any account carries the pool to its reset (the
 *  soonest such reset), `at` the latest account time when every account is `at`, otherwise `unmeasured` with the first
 *  account's reason. An empty pool is `unmeasured` `no-sample`. */
export function poolCrossing(line: number, accounts: readonly AccountSamples[], nowS: number): Crossing {
  if (accounts.length === 0) return { kind: 'unmeasured', why: 'no-sample' };
  const each = accounts.map((a) => accountCrossing(line, a, nowS));
  const carried = each.flatMap((c) => (c.kind === 'not-before-reset' ? [c.resetS] : []));
  if (carried.length > 0) return { kind: 'not-before-reset', resetS: Math.min(...carried) };
  const unmeasured = each.find((c) => c.kind === 'unmeasured');
  if (unmeasured !== undefined) return unmeasured;
  return { kind: 'at', atS: Math.max(...each.map((c) => (c as Extract<Crossing, { kind: 'at' }>).atS)) };
}

type AccountReset = { kind: 'exhausted'; atS: number } | { kind: 'clear' } | { kind: 'unknown'; why: 'no-sample' | 'stale' | 'no-reset' };

/** One account's headroom (ruled, F2): exhausted when a window's newest unrolled sample is at or past the ceiling, at any
 *  age, regaining at the latest reset among its exhausted windows; clear when every window's newest sample is fresh,
 *  unrolled and under the ceiling; otherwise unknown. */
function accountReset(a: AccountSamples, nowS: number): AccountReset {
  const windows = a.five === 'no-window' ? [a.seven] : [a.five, a.seven];
  const exhausted: (number | null)[] = [];
  let unknown: 'no-sample' | 'stale' | null = null;
  for (const w of windows) {
    const newest = w[w.length - 1];
    if (newest === undefined || newest.rolled) { unknown ??= 'no-sample'; continue; }
    if (newest.pct >= SEVEN_DAY_CEILING_PCT) { exhausted.push(newest.resetAt); continue; }
    if (nowS - newest.ts > LOAD_FRESH_S) unknown ??= 'stale';
  }
  if (exhausted.length > 0) {
    if (exhausted.includes(null)) return { kind: 'unknown', why: 'no-reset' };
    return { kind: 'exhausted', atS: Math.max(...(exhausted as number[])) };
  }
  return unknown === null ? { kind: 'clear' } : { kind: 'unknown', why: unknown };
}

/** The earliest reset at which an exhausted account of the pool regains headroom: `unmeasured` with the first unknown
 *  account's reason, else `at` the least regain time, else `none-exhausted`. An empty pool is `unmeasured` `no-sample`. */
export function earliestReset(accounts: readonly AccountSamples[], nowS: number): EarliestReset {
  if (accounts.length === 0) return { kind: 'unmeasured', why: 'no-sample' };
  const each = accounts.map((a) => accountReset(a, nowS));
  const unknown = each.find((r): r is Extract<AccountReset, { kind: 'unknown' }> => r.kind === 'unknown');
  if (unknown !== undefined) return { kind: 'unmeasured', why: unknown.why };
  const regains = each.flatMap((r) => (r.kind === 'exhausted' ? [r.atS] : []));
  return regains.length > 0 ? { kind: 'at', atS: Math.min(...regains) } : { kind: 'none-exhausted' };
}

/** C57's runway for one pool: when it runs out (the ceiling), when it crosses each load line, and its earliest reset. */
export function poolRunway(accounts: readonly AccountSamples[], nowS: number): PoolRunwayAnswer {
  const lines = Object.fromEntries(LOAD_LINES.map((l) => [l, poolCrossing(LOAD_LINE_PCT[l], accounts, nowS)])) as Record<LoadLine, Crossing>;
  return { out: poolCrossing(SEVEN_DAY_CEILING_PCT, accounts, nowS), lines, earliestReset: earliestReset(accounts, nowS) };
}

/** The accounts a pool's runway counts: every enabled Anthropic roster account (the only accounts sampled, F14), by its
 *  resolved pool, an account in two pools counted in each, untagged accounts under `null`. An account whose pool cannot be
 *  decided (`malformed`, `unreadable`, `stale`) is in no pool, never folded into `null`. Pools in first-seen roster order. */
export function runwayPools(roster: Roster, limits: Readonly<Record<string, AccountLimits>>,
  edges: ReadonlyMap<string, readonly string[]>): { readonly pool: string | null; readonly accounts: readonly string[] }[] {
  const out = new Map<string | null, string[]>();
  for (const a of roster.accounts) {
    if (a.telemetry !== 'anthropic' || limits[a.id]?.disabled === true) continue;
    const p = resolvedAccountPool(a.id, a, edges);
    const keys = p.state === 'tagged' ? [...p.pools] : p.state === 'untagged' ? [null] : [];
    for (const k of keys) out.set(k, [...(out.get(k) ?? []), a.id]);
  }
  return [...out].map(([pool, accounts]) => ({ pool, accounts }));
}

/** `GET /api/pools/runway`'s answer from each pool's accounts and the samples read for them (any order). */
export function runwayByPool(pools: readonly { readonly pool: string | null; readonly accounts: readonly string[] }[],
  samples: readonly LimitSample[], nowS: number): PoolRunwayWire['pools'] {
  const byAccount = new Map<string, LimitSample[]>();
  for (const s of samples) byAccount.set(s.account, [...(byAccount.get(s.account) ?? []), s]);
  return pools.map(({ pool, accounts }) => ({
    pool, runway: poolRunway(accounts.map((id) => accountSamplesOf(byAccount.get(id) ?? [])), nowS),
  }));
}
