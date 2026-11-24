// `poolRunway`: when a pool runs out, and when it crosses each load line (Overlord W1 serviceability PR B, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md` Task 4; spec C57, "A history of limits", Table 3.4b).
// Ring L1, context C1: pure decisions over the samples `limit_samples` keeps. No I/O and no clock: `nowS` is handed in.
//
// One fact the rules lean on: inside a window a load only rises, until the window resets. So a sample at or past a line
// proves "past" at any age until its window resets; only a claim of "under" needs a fresh sample (within `LOAD_FRESH_S`),
// and only a rate needs fresh samples. A window that has reset proves nothing, and whether it has is decided here, at read
// time (`sampleRolled`), because a stored sample is never updated.
import {
  LOAD_FRESH_S, LOAD_LINE_PCT, LOAD_LINES, RUNWAY_FIT_S, RUNWAY_MIN_SPAN_S,
  type Crossing, type EarliestReset, type LoadLine, type PoolRunwayAnswer, type PoolRunwayWire,
} from '../../shared/loadLines.js';
import { SEVEN_DAY_CEILING_PCT } from '../../shared/serviceability.js';
import type { AccountPoolWire } from '../../shared/poolrule.js';
import type { Roster } from '../../shared/roster.js';
import { FIVE_WINDOW, SEVEN_WINDOW, type AccountLimits } from './limits.js';
import { resolvedAccountPool } from './poolrule.js';

/** How far back a runway read asks for samples: the weekly window, past which every reading has rolled over
 *  (`limits.ts#readLimits`), so an older sample can prove nothing. */
export const RUNWAY_READ_S = SEVEN_WINDOW;

/** One stored reading of one account, as `limit_samples` keeps it (`coord/limitSamplesStore.ts`). Times in seconds. */
export interface LimitSample {
  readonly account: string; readonly ts: number;
  readonly five: number | null; readonly seven: number | null;
  readonly fiveResetAt: number | null; readonly sevenResetAt: number | null;
  readonly fiveRolled: boolean; readonly sevenRolled: boolean;
  /** The producer's five-hour window width; `0` is a plan with no five-hour window. */
  readonly fiveWindowMinutes: number | null;
}

/** A sampled window, named: its fit span is `RUNWAY_FIT_S[window]` and its width `WINDOW_S[window]`. */
export type RunwayWindow = 'five' | 'seven';
/** Each window's width, `limits.ts`' own constants: a reading older than its window has rolled over. */
const WINDOW_S: Readonly<Record<RunwayWindow, number>> = { five: FIVE_WINDOW, seven: SEVEN_WINDOW };

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

/** Whether a stored sample's window has reset by `nowS`, so it proves nothing. A row keeps the flags of the beat that
 *  first wrote it (`coord/limitSamplesStore.ts`: `INSERT OR IGNORE`, never updated), and an idle account offers the same
 *  reading for hours, so the stored flag alone goes stale. The read applies `limits.ts#readLimits`' two rolled-over rules
 *  again at `nowS`, beside the stored flag: the window's reset time at or before now (the fact), and a reading older than
 *  its own window (the fallback, for a reading with no reset time). Slug `a-stored-sample-rolls-at-read`. */
export function sampleRolled(s: WindowSample, window: RunwayWindow, nowS: number): boolean {
  return s.rolled || (s.resetAt !== null && s.resetAt <= nowS) || nowS - s.ts > WINDOW_S[window];
}

/** A window's crossing of `line` (the rules in the plan's order, N2; a window that has reset is `rolled`). */
export function windowCrossing(line: number, samples: readonly WindowSample[], window: RunwayWindow, nowS: number): Crossing {
  const newest = samples[samples.length - 1];
  if (newest === undefined) return { kind: 'unmeasured', why: 'no-sample' };
  if (sampleRolled(newest, window, nowS)) return { kind: 'unmeasured', why: 'rolled' };
  if (newest.pct >= line) return { kind: 'at', atS: newest.ts };
  if (nowS - newest.ts > LOAD_FRESH_S) return { kind: 'unmeasured', why: 'stale' };
  if (newest.resetAt === null) return { kind: 'unmeasured', why: 'no-reset' };
  const fitS = RUNWAY_FIT_S[window];
  const current = samples.filter((s) => !s.rolled && s.resetAt === newest.resetAt && newest.ts - s.ts <= fitS);
  const oldest = current[0]!;
  if (current.length < 2 || newest.ts - oldest.ts < RUNWAY_MIN_SPAN_S) return { kind: 'unmeasured', why: 'thin' };
  const rate = (newest.pct - oldest.pct) / (newest.ts - oldest.ts);
  if (rate <= 0) return { kind: 'not-before-reset', resetS: newest.resetAt };
  const atS = newest.ts + (line - newest.pct) / rate;
  if (atS <= nowS) return { kind: 'unmeasured', why: 'stale' };
  return atS >= newest.resetAt ? { kind: 'not-before-reset', resetS: newest.resetAt } : { kind: 'at', atS };
}

/** An account crosses when its first window does. A window that could not be projected voids a FUTURE crossing (it might
 *  cross sooner), so then only an `at` already past (at or before now) stands; otherwise `unmeasured` with the first such
 *  window's reason (slug `an-unmeasured-window-voids-a-future-crossing`). Every window measured: a `not-before-reset`
 *  proves nothing past its own reset, so the earliest bound decides. The earliest `at` stands when no reset comes before
 *  it; otherwise the account is `not-before-reset` at its FIRST reset, never a later one (slug
 *  `the-first-reset-ends-the-proof`, correcting the plan's "the later reset"). */
export function accountCrossing(line: number, a: AccountSamples, nowS: number): Crossing {
  const windows = [
    ...(a.five === 'no-window' ? [] : [windowCrossing(line, a.five, 'five', nowS)]),
    windowCrossing(line, a.seven, 'seven', nowS),
  ];
  const ats = windows.flatMap((w) => (w.kind === 'at' ? [w.atS] : []));
  const unmeasured = windows.find((w): w is Extract<Crossing, { kind: 'unmeasured' }> => w.kind === 'unmeasured');
  if (unmeasured !== undefined) {
    const past = ats.filter((t) => t <= nowS);
    return past.length > 0 ? { kind: 'at', atS: Math.min(...past) } : unmeasured;
  }
  // Every window is `at` or `not-before-reset` here, so at least one of the two is finite.
  const firstAt = Math.min(...ats);
  const firstReset = Math.min(...windows.flatMap((w) => (w.kind === 'not-before-reset' ? [w.resetS] : [])));
  return firstAt <= firstReset ? { kind: 'at', atS: firstAt } : { kind: 'not-before-reset', resetS: firstReset };
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

type AccountReset = { kind: 'exhausted'; atS: number } | { kind: 'clear' }
  | { kind: 'unknown'; why: Extract<EarliestReset, { kind: 'unmeasured' }>['why'] };

/** One account's headroom: unknown if any window is missing, rolled or stale under the ceiling. Otherwise, a window at
 *  or past the ceiling proves exhaustion at any age until its reset; if every exhausted window has a reset time, the
 *  account regains at the latest of them. With every window known and under the ceiling the account is clear. */
function accountReset(a: AccountSamples, nowS: number): AccountReset {
  const windows: [readonly WindowSample[], RunwayWindow][] = a.five === 'no-window' ? [[a.seven, 'seven']] : [[a.five, 'five'], [a.seven, 'seven']];
  const exhausted: (number | null)[] = [];
  let unknown: 'no-sample' | 'rolled' | 'stale' | null = null;
  for (const [w, window] of windows) {
    const newest = w[w.length - 1];
    if (newest === undefined) { unknown ??= 'no-sample'; continue; }
    if (sampleRolled(newest, window, nowS)) { unknown ??= 'rolled'; continue; }
    if (newest.pct >= SEVEN_DAY_CEILING_PCT) { exhausted.push(newest.resetAt); continue; }
    if (nowS - newest.ts > LOAD_FRESH_S) unknown ??= 'stale';
  }
  if (unknown !== null) return { kind: 'unknown', why: unknown };
  if (exhausted.length > 0) {
    if (exhausted.includes(null)) return { kind: 'unknown', why: 'no-reset' };
    return { kind: 'exhausted', atS: Math.max(...(exhausted as number[])) };
  }
  return { kind: 'clear' };
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

/** The pools an account's resolved pool puts it in, for the runway read: each tagged pool, `null` for an untagged account,
 *  and none for a pool nobody can decide (`malformed`, `unreadable`, `stale`), never folded into `null`. */
export function runwayPoolKeys(p: AccountPoolWire): readonly (string | null)[] {
  switch (p.state) {
    case 'tagged': return p.pools;
    case 'untagged': return [null];
    case 'malformed': case 'unreadable': case 'stale': return [];
    default: { const unreachable: never = p; return unreachable; }
  }
}

/** The accounts a pool's runway counts: every enabled Anthropic roster account (the only accounts sampled, F14), by its
 *  resolved pool (`runwayPoolKeys`), an account in two pools counted in each, untagged accounts under `null`, an account
 *  whose pool cannot be decided in none. Pools in first-seen roster order. */
export function runwayPools(roster: Roster, limits: Readonly<Record<string, AccountLimits>>,
  edges: ReadonlyMap<string, readonly string[]>): { readonly pool: string | null; readonly accounts: readonly string[] }[] {
  const out = new Map<string | null, string[]>();
  for (const a of roster.accounts) {
    if (a.telemetry !== 'anthropic' || limits[a.id]?.disabled === true) continue;
    for (const k of runwayPoolKeys(resolvedAccountPool(a.id, a, edges))) out.set(k, [...(out.get(k) ?? []), a.id]);
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
