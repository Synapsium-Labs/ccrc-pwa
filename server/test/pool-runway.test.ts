// `poolRunway` (Overlord W1 serviceability PR B, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md`
// Task 4): every rule a row, on a fixture clock. Times in seconds.
import { describe, expect, it } from 'vitest';
import { LOAD_FRESH_S, RUNWAY_FIT_S, RUNWAY_MIN_SPAN_S } from '../../shared/loadLines.js';
import type { AccountPoolWire } from '../../shared/poolrule.js';
import { parseRoster } from '../../shared/roster.js';
import {
  accountCrossing, accountSamplesOf, earliestReset, poolCrossing, poolRunway, runwayByPool, runwayPoolKeys, runwayPools, sampleRolled,
  windowCrossing, type AccountSamples, type LimitSample, type WindowSample,
} from '../src/poolRunway.js';
import { FIVE_WINDOW, SEVEN_WINDOW, type AccountLimits } from '../src/limits.js';

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
    expect(windowCrossing(85, [], 'five', NOW)).toEqual({ kind: 'unmeasured', why: 'no-sample' });
    expect(windowCrossing(85, [w(60, 90, { rolled: true })], 'five', NOW)).toEqual({ kind: 'unmeasured', why: 'rolled' });
  });
  it('a newest sample at or past the line is `at` its time, at any age until its window resets', () => {
    expect(windowCrossing(85, [w(60, 85)], 'five', NOW)).toEqual({ kind: 'at', atS: NOW - 60 });
    expect(windowCrossing(85, [w(FIVE_WINDOW, 90)], 'five', NOW)).toEqual({ kind: 'at', atS: NOW - FIVE_WINDOW });
    expect(windowCrossing(85, [w(FIVE_WINDOW + 1, 90)], 'seven', NOW)).toEqual({ kind: 'at', atS: NOW - FIVE_WINDOW - 1 });
  });
  it('a stale newest sample under the line is stale', () => {
    expect(windowCrossing(85, rising(80, LOAD_FRESH_S + 1), 'five', NOW)).toEqual({ kind: 'unmeasured', why: 'stale' });
    expect(windowCrossing(85, rising(80, LOAD_FRESH_S), 'five', NOW).kind).not.toBe('unmeasured');
  });
  it('no reset time is no-reset', () => {
    expect(windowCrossing(85, rising(80, 60, null), 'five', NOW)).toEqual({ kind: 'unmeasured', why: 'no-reset' });
  });
  it('one sample, or two closer than the minimum span, is thin', () => {
    expect(windowCrossing(85, [w(60, 80)], 'five', NOW)).toEqual({ kind: 'unmeasured', why: 'thin' });
    expect(windowCrossing(85, [w(60 + RUNWAY_MIN_SPAN_S - 1, 70), w(60, 80)], 'five', NOW)).toEqual({ kind: 'unmeasured', why: 'thin' });
    expect(windowCrossing(85, [w(60 + RUNWAY_MIN_SPAN_S, 70), w(60, 80)], 'five', NOW).kind).toBe('at');
  });
  it('samples outside the fit span, of another window or rolled, are not fitted', () => {
    expect(windowCrossing(85, [w(60 + fit + 1, 10), w(60, 80)], 'five', NOW)).toEqual({ kind: 'unmeasured', why: 'thin' });
    expect(windowCrossing(85, [w(3_660, 10, { resetAt: RESET - 18_000 }), w(60, 80)], 'five', NOW)).toEqual({ kind: 'unmeasured', why: 'thin' });
    expect(windowCrossing(85, [w(3_660, 10, { rolled: true }), w(60, 80)], 'five', NOW)).toEqual({ kind: 'unmeasured', why: 'thin' });
    expect(windowCrossing(85, [w(60 + fit, 10), w(60, 80)], 'five', NOW).kind).toBe('at');
  });
  it('a flat or falling rate does not cross before the reset', () => {
    expect(windowCrossing(85, [w(3_660, 80), w(60, 80)], 'five', NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET });
    expect(windowCrossing(85, [w(3_660, 82), w(60, 80)], 'five', NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET });
  });
  it('the endpoint slope projects the crossing; at or after the reset it does not cross', () => {
    // 10% an hour from 80 at NOW-60: 85 at NOW-60+1800.
    expect(windowCrossing(85, rising(80), 'five', NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_800 });
    // the same slope with the reset at that very second, and a second before it
    expect(windowCrossing(85, rising(80, 60, NOW - 60 + 1_800), 'five', NOW)).toEqual({ kind: 'not-before-reset', resetS: NOW - 60 + 1_800 });
    expect(windowCrossing(85, rising(80, 60, NOW - 60 + 1_801), 'five', NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_800 });
  });
  it('the endpoint slope uses the oldest fitted sample, not a middle one', () => {
    expect(windowCrossing(90, [w(7_260, 60), w(3_660, 79), w(60, 80)], 'five', NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 3_600 });
  });
});

describe('accountCrossing: an account crosses when its first window does', () => {
  it('the earlier window\'s `at`', () => {
    const a = acct(rising(80), rising(80, 60).map((s) => ({ ...s, pct: s.pct + 2 })));
    expect(accountCrossing(85, a, NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_080 });
  });
  const flat = (resetAt: number): WindowSample[] => [w(3_660, 50, { resetAt }), w(60, 50, { resetAt })];
  it('every window not before its reset: the FIRST reset ends the proof, never the later one (differing resets)', () => {
    expect(accountCrossing(85, acct(flat(RESET + 500), flat(RESET)), NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET });
    expect(accountCrossing(85, acct(flat(RESET), flat(RESET + 500)), NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET });
    // a flat five-hour window resetting within the hour, a flat weekly one resetting in six days (review 3330's case)
    expect(accountCrossing(85, acct(flat(NOW + 518_400), flat(NOW + 3_600)), NOW)).toEqual({ kind: 'not-before-reset', resetS: NOW + 3_600 });
  });
  it('an `at` before every reset stands; a reset before the `at` ends the proof there; on the reset\'s own second the `at` stands', () => {
    expect(accountCrossing(85, acct(flat(RESET), rising(80)), NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_800 });
    expect(accountCrossing(85, acct(rising(80), flat(NOW + 600)), NOW)).toEqual({ kind: 'not-before-reset', resetS: NOW + 600 });
    expect(accountCrossing(85, acct(rising(80), flat(NOW - 60 + 1_800)), NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_800 });
  });
  it('an unmeasured window voids a future crossing, but an `at` already past stands', () => {
    expect(accountCrossing(85, acct(rising(80), []), NOW)).toEqual({ kind: 'unmeasured', why: 'no-sample' });
    expect(accountCrossing(85, acct([w(60, 90)], []), NOW)).toEqual({ kind: 'at', atS: NOW - 60 });
  });
  it('an `at` exactly now is already past, so it stands beside an unmeasured window; a second later it is voided', () => {
    expect(accountCrossing(85, acct([w(0, 90)], []), NOW)).toEqual({ kind: 'at', atS: NOW });
    // 10% an hour from 80 at NOW-1800: 85 at exactly NOW; then the same a second later
    expect(accountCrossing(85, acct([w(5_400, 70), w(1_800, 80)], []), NOW)).toEqual({ kind: 'at', atS: NOW });
    expect(accountCrossing(85, acct([w(5_399, 70), w(1_799, 80)], []), NOW)).toEqual({ kind: 'unmeasured', why: 'no-sample' });
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
  it('an account\'s first reset carries into the pool (pool propagation), and an account whose window reset holds it unmeasured', () => {
    const differing = acct([w(3_660, 50, { resetAt: RESET + 500 }), w(60, 50, { resetAt: RESET + 500 })],
      [w(3_660, 50), w(60, 50)]);
    expect(poolCrossing(85, [acct(rising(80)), differing], NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET });
    const idle = acct([w(14_400, 99, { resetAt: NOW - 3_600 })], [w(14_400, 99, { resetAt: NOW - 3_600 })]);
    expect(poolCrossing(85, [acct(rising(80)), idle], NOW)).toEqual({ kind: 'unmeasured', why: 'rolled' });
  });
});

describe('a window that has reset proves nothing, decided when the runway reads it (review 3330 F1, slug a-stored-sample-rolls-at-read)', () => {
  it('sampleRolled: the stored flag, a reset time at or before now, or a reading older than its own window', () => {
    expect(sampleRolled(w(60, 50, { rolled: true }), 'five', NOW)).toBe(true);
    expect(sampleRolled(w(60, 50, { resetAt: NOW }), 'five', NOW)).toBe(true);
    expect(sampleRolled(w(60, 50, { resetAt: NOW + 1 }), 'five', NOW)).toBe(false);
    expect(sampleRolled(w(FIVE_WINDOW + 1, 50, { resetAt: null }), 'five', NOW)).toBe(true);
    expect(sampleRolled(w(FIVE_WINDOW, 50, { resetAt: null }), 'five', NOW)).toBe(false);
    expect(sampleRolled(w(FIVE_WINDOW + 1, 50, { resetAt: null }), 'seven', NOW)).toBe(false);
    expect(sampleRolled(w(SEVEN_WINDOW + 1, 50, { resetAt: null }), 'seven', NOW)).toBe(true);
  });
  it('an idle account\'s stored row, unrolled at 99% in both windows with both resets an hour gone: every line, the ceiling and the reset unmeasured', () => {
    const row: LimitSample = { account: 'lane-a', ts: NOW - 14_400, five: 99, seven: 99, fiveResetAt: NOW - 3_600, sevenResetAt: NOW - 3_600,
      fiveRolled: false, sevenRolled: false, fiveWindowMinutes: null };
    const r = poolRunway([accountSamplesOf([row])], NOW);
    expect(r.out).toEqual({ kind: 'unmeasured', why: 'rolled' });
    expect(r.lines).toEqual({ soft: { kind: 'unmeasured', why: 'rolled' }, hard: { kind: 'unmeasured', why: 'rolled' }, chat: { kind: 'unmeasured', why: 'rolled' } });
    expect(r.earliestReset).toEqual({ kind: 'unmeasured', why: 'rolled' });
  });
  it('the exact reset: a window resetting at now has reset; a second before it still proves', () => {
    expect(windowCrossing(85, [w(60, 90, { resetAt: NOW })], 'seven', NOW)).toEqual({ kind: 'unmeasured', why: 'rolled' });
    expect(windowCrossing(85, [w(60, 90, { resetAt: NOW + 1 })], 'seven', NOW)).toEqual({ kind: 'at', atS: NOW - 60 });
    expect(earliestReset([acct([w(60, 99, { resetAt: NOW })])], NOW)).toEqual({ kind: 'unmeasured', why: 'rolled' });
    expect(earliestReset([acct([w(60, 99, { resetAt: NOW + 1 })])], NOW)).toEqual({ kind: 'at', atS: NOW + 1 });
  });
  it('a prior window is never fitted: a newest sample past its reset is rolled, whatever samples precede it', () => {
    expect(windowCrossing(85, [w(3_660, 50, { resetAt: NOW - 30 }), w(60, 70, { resetAt: NOW - 30 })], 'five', NOW))
      .toEqual({ kind: 'unmeasured', why: 'rolled' });
  });
  it('one window: a lane with no five-hour window is rolled with its weekly window; a reset five-hour window beside a weekly one past the line leaves that `at` standing', () => {
    expect(accountCrossing(85, acct([w(60, 90, { resetAt: NOW - 1 })], 'no-window'), NOW)).toEqual({ kind: 'unmeasured', why: 'rolled' });
    expect(accountCrossing(85, acct([w(60, 90)], [w(60, 90, { resetAt: NOW - 1 })]), NOW)).toEqual({ kind: 'at', atS: NOW - 60 });
    expect(accountCrossing(85, acct(rising(80), [w(60, 90, { resetAt: NOW - 1 })]), NOW)).toEqual({ kind: 'unmeasured', why: 'rolled' });
  });
  it('a reading with no reset time older than its window has rolled (readLimits\' fallback)', () => {
    expect(windowCrossing(85, [w(FIVE_WINDOW + 1, 90, { resetAt: null })], 'five', NOW)).toEqual({ kind: 'unmeasured', why: 'rolled' });
    expect(windowCrossing(85, [w(FIVE_WINDOW, 90, { resetAt: null })], 'five', NOW)).toEqual({ kind: 'at', atS: NOW - FIVE_WINDOW });
  });
  it('a past reset is never offered as capacity to come: an exhausted window that has reset is rolled, not `at` its reset', () => {
    expect(earliestReset([acct([w(LOAD_FRESH_S * 4, 99, { resetAt: NOW - 3_600 })])], NOW)).toEqual({ kind: 'unmeasured', why: 'rolled' });
    expect(earliestReset([acct([w(60, 99, { resetAt: RESET })], [w(60, 99, { resetAt: NOW - 1 })])], NOW)).toEqual({ kind: 'at', atS: RESET });
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
  it('a stale sample under the ceiling is stale; none is no-sample; a rolled one is rolled, never folded into no-sample; and each holds the pool unmeasured', () => {
    expect(earliestReset([acct([w(LOAD_FRESH_S + 1, 50)])], NOW)).toEqual({ kind: 'unmeasured', why: 'stale' });
    expect(earliestReset([acct([])], NOW)).toEqual({ kind: 'unmeasured', why: 'no-sample' });
    expect(earliestReset([acct([w(60, 99, { rolled: true })])], NOW)).toEqual({ kind: 'unmeasured', why: 'rolled' });
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
  it('runwayPoolKeys: a tagged account in each of its pools, an untagged one under null, an undecidable one in none (never null)', () => {
    const states: [AccountPoolWire, readonly (string | null)[]][] = [
      [{ state: 'tagged', pools: ['pool-a', 'pool-b'], origin: 'central' }, ['pool-a', 'pool-b']],
      [{ state: 'untagged', origin: 'declared' }, [null]],
      [{ state: 'malformed' }, []], [{ state: 'unreadable' }, []], [{ state: 'stale' }, []],
    ];
    for (const [p, keys] of states) expect(runwayPoolKeys(p)).toEqual(keys);
  });
  it('runwayByPool: each pool from its own accounts\' samples; no account id in the answer', () => {
    const out = runwayByPool([{ pool: 'pool-a', accounts: ['lane-a'] }, { pool: null, accounts: ['lane-b'] }],
      [sample('lane-a', 60, 99), sample('lane-b', 60, 10)], NOW);
    expect(out.map((p) => [p.pool, p.runway.earliestReset.kind])).toEqual([['pool-a', 'at'], [null, 'none-exhausted']]);
    expect(JSON.stringify(out)).not.toMatch(/lane-/);
  });
});
