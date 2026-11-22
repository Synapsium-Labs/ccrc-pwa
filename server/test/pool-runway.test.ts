// `poolRunway` (Overlord W1 serviceability PR B, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md`
// Task 4): every rule a row, on a fixture clock. Times in seconds.
import { describe, expect, it } from 'vitest';
import { LOAD_FRESH_S, RUNWAY_FIT_S, RUNWAY_MIN_SPAN_S } from '../../shared/loadLines.js';
import { parseRoster } from '../../shared/roster.js';
import {
  accountCrossing, accountSamplesOf, earliestReset, poolCrossing, poolRunway, runwayByPool, runwayPools, windowCrossing,
  type AccountSamples, type LimitSample, type WindowSample,
} from '../src/poolRunway.js';
import type { AccountLimits } from '../src/limits.js';

const NOW = 2_000_000_000;
const RESET = NOW + 10_000;
const w = (ago: number, pct: number, over: Partial<WindowSample> = {}): WindowSample => ({ ts: NOW - ago, pct, resetAt: RESET, rolled: false, ...over });
/** A rising window: 10% an hour, the newest at `pct`, `ago` seconds old. */
const rising = (pct: number, ago = 60, resetAt: number | null = RESET): WindowSample[] =>
  [w(ago + 3_600, pct - 10, { resetAt }), w(ago, pct, { resetAt })];
const acct = (seven: WindowSample[], five: WindowSample[] | 'no-window' = 'no-window'): AccountSamples => ({ five, seven });

describe('windowCrossing: the rules in the plan\'s order', () => {
  const fit = RUNWAY_FIT_S.five;
  it('no sample is no-sample; a rolled newest is rolled', () => {
    expect(windowCrossing(85, [], fit, NOW)).toEqual({ kind: 'unmeasured', why: 'no-sample' });
    expect(windowCrossing(85, [w(60, 90, { rolled: true })], fit, NOW)).toEqual({ kind: 'unmeasured', why: 'rolled' });
  });
  it('a newest sample at or past the line is `at` its time, at any age', () => {
    expect(windowCrossing(85, [w(60, 85)], fit, NOW)).toEqual({ kind: 'at', atS: NOW - 60 });
    expect(windowCrossing(85, [w(LOAD_FRESH_S * 5, 90)], fit, NOW)).toEqual({ kind: 'at', atS: NOW - LOAD_FRESH_S * 5 });
  });
  it('a stale newest sample under the line is stale', () => {
    expect(windowCrossing(85, rising(80, LOAD_FRESH_S + 1), fit, NOW)).toEqual({ kind: 'unmeasured', why: 'stale' });
    expect(windowCrossing(85, rising(80, LOAD_FRESH_S), fit, NOW).kind).not.toBe('unmeasured');
  });
  it('no reset time is no-reset', () => {
    expect(windowCrossing(85, rising(80, 60, null), fit, NOW)).toEqual({ kind: 'unmeasured', why: 'no-reset' });
  });
  it('one sample, or two closer than the minimum span, is thin', () => {
    expect(windowCrossing(85, [w(60, 80)], fit, NOW)).toEqual({ kind: 'unmeasured', why: 'thin' });
    expect(windowCrossing(85, [w(60 + RUNWAY_MIN_SPAN_S - 1, 70), w(60, 80)], fit, NOW)).toEqual({ kind: 'unmeasured', why: 'thin' });
    expect(windowCrossing(85, [w(60 + RUNWAY_MIN_SPAN_S, 70), w(60, 80)], fit, NOW).kind).toBe('at');
  });
  it('samples outside the fit span, of another window or rolled, are not fitted', () => {
    expect(windowCrossing(85, [w(60 + fit + 1, 10), w(60, 80)], fit, NOW)).toEqual({ kind: 'unmeasured', why: 'thin' });
    expect(windowCrossing(85, [w(3_660, 10, { resetAt: RESET - 18_000 }), w(60, 80)], fit, NOW)).toEqual({ kind: 'unmeasured', why: 'thin' });
    expect(windowCrossing(85, [w(3_660, 10, { rolled: true }), w(60, 80)], fit, NOW)).toEqual({ kind: 'unmeasured', why: 'thin' });
    expect(windowCrossing(85, [w(60 + fit, 10), w(60, 80)], fit, NOW).kind).toBe('at');
  });
  it('a flat or falling rate does not cross before the reset', () => {
    expect(windowCrossing(85, [w(3_660, 80), w(60, 80)], fit, NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET });
    expect(windowCrossing(85, [w(3_660, 82), w(60, 80)], fit, NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET });
  });
  it('the endpoint slope projects the crossing; at or after the reset it does not cross', () => {
    // 10% an hour from 80 at NOW-60: 85 at NOW-60+1800.
    expect(windowCrossing(85, rising(80), fit, NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_800 });
    // the same slope with the reset at that very second, and a second before it
    expect(windowCrossing(85, rising(80, 60, NOW - 60 + 1_800), fit, NOW)).toEqual({ kind: 'not-before-reset', resetS: NOW - 60 + 1_800 });
    expect(windowCrossing(85, rising(80, 60, NOW - 60 + 1_801), fit, NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_800 });
  });
  it('the endpoint slope uses the oldest fitted sample, not a middle one', () => {
    expect(windowCrossing(90, [w(7_260, 60), w(3_660, 79), w(60, 80)], fit, NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 3_600 });
  });
});

describe('accountCrossing: an account crosses when its first window does', () => {
  it('the earlier window\'s `at`', () => {
    const a = acct(rising(80), rising(80, 60).map((s) => ({ ...s, pct: s.pct + 2 })));
    expect(accountCrossing(85, a, NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_080 });
  });
  it('not before reset only when every window says so, at the later reset', () => {
    const flat = (resetAt: number): WindowSample[] => [w(3_660, 50, { resetAt }), w(60, 50, { resetAt })];
    expect(accountCrossing(85, acct(flat(RESET + 500), flat(RESET)), NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET + 500 });
    expect(accountCrossing(85, acct(flat(RESET), rising(80)), NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_800 });
  });
  it('an unmeasured window voids a future crossing, but an `at` already past stands', () => {
    expect(accountCrossing(85, acct(rising(80), []), NOW)).toEqual({ kind: 'unmeasured', why: 'no-sample' });
    expect(accountCrossing(85, acct([w(60, 90)], []), NOW)).toEqual({ kind: 'at', atS: NOW - 60 });
  });
  it('a lane with no five-hour window is its weekly window alone', () => {
    expect(accountCrossing(85, acct(rising(80), 'no-window'), NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_800 });
  });
});

describe('poolCrossing: a pool crosses when its last account does', () => {
  const flat = acct([w(3_660, 50), w(60, 50)]);
  it('an empty pool is no-sample', () => {
    expect(poolCrossing(85, [], NOW)).toEqual({ kind: 'unmeasured', why: 'no-sample' });
  });
  it('one account that lasts to its reset carries the pool, whatever the others read', () => {
    expect(poolCrossing(85, [acct(rising(80)), flat], NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET });
    expect(poolCrossing(85, [acct([]), flat], NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET });
  });
  it('every account `at`: the latest time', () => {
    expect(poolCrossing(85, [acct(rising(80)), acct([w(60, 90)])], NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_800 });
  });
  it('otherwise unmeasured with the first reason', () => {
    expect(poolCrossing(85, [acct(rising(80)), acct([w(LOAD_FRESH_S * 2, 50)])], NOW)).toEqual({ kind: 'unmeasured', why: 'stale' });
  });
});

describe('earliestReset (ruled, F2)', () => {
  it('none exhausted when every window is fresh and under the ceiling', () => {
    expect(earliestReset([acct([w(60, 50)], [w(60, 40)])], NOW)).toEqual({ kind: 'none-exhausted' });
  });
  it('an exhausted window regains at its reset, at any age; the latest among an account\'s, the least among the pool\'s', () => {
    const exhausted = acct([w(LOAD_FRESH_S * 9, 98, { resetAt: RESET + 900 })], [w(60, 99, { resetAt: RESET + 100 })]);
    expect(earliestReset([exhausted], NOW)).toEqual({ kind: 'at', atS: RESET + 900 });
    const other = acct([w(60, 99, { resetAt: RESET + 300 })]);
    expect(earliestReset([exhausted, other, acct([w(60, 10)])], NOW)).toEqual({ kind: 'at', atS: RESET + 300 });
  });
  it('the ceiling is reached at 98, not before', () => {
    expect(earliestReset([acct([w(60, 97.9)])], NOW)).toEqual({ kind: 'none-exhausted' });
    expect(earliestReset([acct([w(60, 98)])], NOW)).toEqual({ kind: 'at', atS: RESET });
  });
  it('an exhausted window with no reset is no-reset', () => {
    expect(earliestReset([acct([w(60, 99, { resetAt: null })])], NOW)).toEqual({ kind: 'unmeasured', why: 'no-reset' });
  });
  it('a stale sample under the ceiling is stale; none, or a rolled one, is no-sample; and either holds the pool unmeasured', () => {
    expect(earliestReset([acct([w(LOAD_FRESH_S + 1, 50)])], NOW)).toEqual({ kind: 'unmeasured', why: 'stale' });
    expect(earliestReset([acct([])], NOW)).toEqual({ kind: 'unmeasured', why: 'no-sample' });
    expect(earliestReset([acct([w(60, 99, { rolled: true })])], NOW)).toEqual({ kind: 'unmeasured', why: 'no-sample' });
    expect(earliestReset([acct([w(60, 99)]), acct([w(LOAD_FRESH_S + 1, 50)])], NOW)).toEqual({ kind: 'unmeasured', why: 'stale' });
    expect(earliestReset([], NOW)).toEqual({ kind: 'unmeasured', why: 'no-sample' });
  });
});

describe('poolRunway and its read', () => {
  const sample = (account: string, ago: number, seven: number, over: Partial<LimitSample> = {}): LimitSample => ({
    account, ts: NOW - ago, five: seven, seven, fiveResetAt: RESET, sevenResetAt: RESET + 50_000, fiveRolled: false, sevenRolled: false,
    fiveWindowMinutes: null, ...over,
  });
  it('accountSamplesOf sorts by time, splits the windows and reads the no-window marker off the newest row', () => {
    const a = accountSamplesOf([sample('a', 60, 80), sample('a', 3_660, 70, { five: null })]);
    expect(a.seven.map((s) => s.pct)).toEqual([70, 80]);
    expect(a.five).toEqual([{ ts: NOW - 60, pct: 80, resetAt: RESET, rolled: false }]);
    expect(accountSamplesOf([sample('a', 60, 80, { fiveWindowMinutes: 0 })]).five).toBe('no-window');
  });
  it('answers the ceiling, the three lines and the earliest reset', () => {
    const r = poolRunway([acct(rising(80))], NOW);
    expect(r.lines.soft).toEqual({ kind: 'at', atS: NOW - 60 });
    expect(r.lines.hard).toEqual({ kind: 'at', atS: NOW - 60 + 1_800 });
    expect(r.lines.chat).toEqual({ kind: 'at', atS: NOW - 60 + 5_400 });
    expect(r.out).toEqual({ kind: 'at', atS: NOW - 60 + 6_480 });
    expect(r.earliestReset).toEqual({ kind: 'none-exhausted' });
    expect(poolRunway([acct(rising(80, 60, NOW + 6_000))], NOW).out).toEqual({ kind: 'not-before-reset', resetS: NOW + 6_000 });
  });
  it('runwayPools: enabled Anthropic accounts by resolved pool; two pools count an account twice; an undecidable pool is in none', () => {
    const lane = (id: string, hue: string, more: Record<string, unknown> = {}): Record<string, unknown> =>
      ({ id, label: id, configDirSuffix: `.${id}`, exec: { kind: id === 'lane-a' ? 'upstream' : 'generated' }, homeAble: true, hue, telemetry: 'anthropic', ...more });
    const roster = parseRoster({ version: 1, accounts: [
      lane('lane-a', 'cyan', { pool: 'pool-a' }), lane('lane-b', 'violet'), lane('lane-c', 'blue', { pool: 'pool-a' }),
      lane('lane-d', 'green', { telemetry: 'none' }), lane('lane-e', 'amber'),
    ] });
    const limits = { 'lane-c': { disabled: true } as AccountLimits };
    const edges = new Map([['lane-e', ['pool-b', 'pool-a']]]);
    expect(runwayPools(roster, limits, edges)).toEqual([
      { pool: 'pool-a', accounts: ['lane-a', 'lane-e'] }, { pool: null, accounts: ['lane-b'] }, { pool: 'pool-b', accounts: ['lane-e'] },
    ]);
  });
  it('runwayByPool: each pool from its own accounts\' samples; no account id in the answer', () => {
    const out = runwayByPool([{ pool: 'pool-a', accounts: ['lane-a'] }, { pool: null, accounts: ['lane-b'] }],
      [sample('lane-a', 60, 99), sample('lane-b', 60, 10)], NOW);
    expect(out.map((p) => [p.pool, p.runway.earliestReset.kind])).toEqual([['pool-a', 'at'], [null, 'none-exhausted']]);
    expect(JSON.stringify(out)).not.toMatch(/lane-/);
  });
});
