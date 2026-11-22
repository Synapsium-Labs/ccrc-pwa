// The load lines' and the runway's mutant sets (Overlord W1 serviceability PR B, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md` Task 4 Step 5). Each decider's cases are written here
// as suite cases over a loaded module, so `mutation-floors.test.ts` runs them against every named mutant; the full rule
// tables are `pool-runway.test.ts` and `account-load.test.ts`. The expected answers are written out, never read from the
// code they judge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { LOAD_FRESH_S } from '../../../shared/loadLines.js';
import type { AccountLimits } from '../../src/limits.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
type RunwayModule = typeof import('../../src/poolRunway.js');
type LoadModule = typeof import('../../src/accountLoad.js');

const NOW = 2_000_000_000;
const RESET = NOW + 10_000;
const w = (ago: number, pct: number, over: Record<string, unknown> = {}) => ({ ts: NOW - ago, pct, resetAt: RESET as number | null, rolled: false, ...over });
const rising = (pct: number, ago = 60, resetAt: number | null = RESET) => [w(ago + 3_600, pct - 10, { resetAt }), w(ago, pct, { resetAt })];
const acct = (seven: ReturnType<typeof w>[], five: ReturnType<typeof w>[] | 'no-window' = 'no-window') => ({ five, seven });

function runwayCases(m: RunwayModule): Record<string, SuiteCase> {
  return {
    'a sample at the line is at it': () => { expect(m.windowCrossing(85, [w(60, 85)], 7_200, NOW)).toEqual({ kind: 'at', atS: NOW - 60 }); },
    'a fresh sample is within LOAD_FRESH_S, inclusive': () => {
      expect(m.windowCrossing(85, rising(80, LOAD_FRESH_S), 7_200, NOW).kind).toBe('at');
      expect(m.windowCrossing(85, rising(80, LOAD_FRESH_S + 1), 7_200, NOW)).toEqual({ kind: 'unmeasured', why: 'stale' });
    },
    'a sample outside the fit span is not fitted': () => {
      expect(m.windowCrossing(85, [w(60 + 7_201, 10), w(60, 80)], 7_200, NOW)).toEqual({ kind: 'unmeasured', why: 'thin' });
    },
    'one sample is thin': () => { expect(m.windowCrossing(85, [w(60, 80)], 7_200, NOW)).toEqual({ kind: 'unmeasured', why: 'thin' }); },
    'a flat rate does not cross before the reset': () => {
      expect(m.windowCrossing(85, [w(3_660, 80), w(60, 80)], 7_200, NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET });
    },
    'a projection landing on the reset does not cross': () => {
      expect(m.windowCrossing(85, rising(80, 60, NOW - 60 + 1_800), 7_200, NOW)).toEqual({ kind: 'not-before-reset', resetS: NOW - 60 + 1_800 });
    },
    'an unmeasured window voids a future crossing': () => {
      expect(m.accountCrossing(85, acct(rising(80), []), NOW)).toEqual({ kind: 'unmeasured', why: 'no-sample' });
    },
    'one account lasting to its reset carries the pool': () => {
      expect(m.poolCrossing(85, [acct(rising(80)), acct([w(3_660, 50), w(60, 50)])], NOW)).toEqual({ kind: 'not-before-reset', resetS: RESET });
    },
    'every account at: the latest': () => {
      expect(m.poolCrossing(85, [acct(rising(80)), acct([w(60, 90)])], NOW)).toEqual({ kind: 'at', atS: NOW - 60 + 1_800 });
    },
    'the earliest reset is the least regain, at the ceiling': () => {
      expect(m.earliestReset([acct([w(60, 99, { resetAt: RESET + 900 })]), acct([w(60, 98, { resetAt: RESET + 300 })])], NOW))
        .toEqual({ kind: 'at', atS: RESET + 300 });
    },
    'none exhausted under the ceiling': () => {
      expect(m.earliestReset([acct([w(60, 97.9)])], NOW)).toEqual({ kind: 'none-exhausted' });
    },
    'a stale account under the ceiling holds the pool unmeasured': () => {
      expect(m.earliestReset([acct([w(60, 99)]), acct([w(LOAD_FRESH_S + 1, 50)])], NOW)).toEqual({ kind: 'unmeasured', why: 'stale' });
    },
  };
}

const RUNWAY_SET: MutantSet<RunwayModule> = {
  modulePath: path.join(ROOT, 'server/src/poolRunway.ts'),
  mutants: [
    { id: 'R1 past only above the line', old: 'if (newest.pct >= line) return', new: 'if (newest.pct > line) return' },
    { id: 'R2 freshness exclusive', old: "if (nowS - newest.ts > LOAD_FRESH_S) return { kind: 'unmeasured', why: 'stale' };", new: "if (nowS - newest.ts >= LOAD_FRESH_S) return { kind: 'unmeasured', why: 'stale' };" },
    // `current.length < 2` alone and `rate <= 0` alone are equivalent mutants (one sample spans 0 s; a 0 rate projects to
    // Infinity, past every reset), so neither is listed.
    { id: 'R3 the fit span ignored', old: ' && newest.ts - s.ts <= fitS', new: '' },
    { id: 'R5 the reset itself crosses', old: 'return atS >= newest.resetAt ?', new: 'return atS > newest.resetAt ?' },
    { id: 'R6 an unmeasured window ignored', old: 'const past = ats.filter((t) => t <= nowS);', new: 'const past = ats;' },
    { id: 'R7 no not-before-reset carry', old: 'if (carried.length > 0) return', new: 'if (false) return' },
    { id: 'R8 the pool at its first account', old: "return { kind: 'at', atS: Math.max(...each.map(", new: "return { kind: 'at', atS: Math.min(...each.map(" },
    { id: 'R9 the earliest reset the latest', old: "{ kind: 'at', atS: Math.min(...regains) }", new: "{ kind: 'at', atS: Math.max(...regains) }" },
    { id: 'R10 exhausted above the ceiling', old: 'if (newest.pct >= SEVEN_DAY_CEILING_PCT)', new: 'if (newest.pct > SEVEN_DAY_CEILING_PCT)' },
    { id: 'R11 none-exhausted arm', old: ": { kind: 'none-exhausted' };", new: ": { kind: 'unmeasured', why: 'no-sample' };" },
    { id: 'R12 an unknown account ignored', old: "if (unknown !== undefined) return { kind: 'unmeasured', why: unknown.why };", new: '' },
  ],
  suite: runwayCases,
};

const lim = (pct: number | null, ago = 60, over: Partial<AccountLimits> = {}): AccountLimits => ({
  five: pct, seven: pct, ts: NOW - ago, fiveResetAt: NOW + 9_000, sevenResetAt: NOW + 300_000, fiveRolledOver: false, sevenRolledOver: false,
  disabled: false, authDead: false, ...over,
});
const cand = (id: string, limits: AccountLimits, serves: 'yes' | 'at-ceiling' | 'unmeasured' = 'yes') => ({ id, limits, serves });
const lane = (seven: number, continuity: 'recorded' | 'none' = 'recorded') =>
  ({ anthropic: true, seven, share: null, fableBilling: 'included' as const, continuity });
const designated = { kind: 'designated', sessionId: 's', term: 1, row: { model: 'opus' } } as never;

function loadCases(m: LoadModule): Record<string, SuiteCase> {
  return {
    'under the line by one fresh serving account': () => {
      expect(m.loadLines([cand('a', lim(94.9)), cand('b', lim(96, LOAD_FRESH_S + 1))], NOW).chat).toEqual({ kind: 'under' });
    },
    'at the line is past, with the least': () => {
      expect(m.loadLines([cand('a', lim(95)), cand('b', lim(97))], NOW).chat).toEqual({ kind: 'past', leastPct: 95 });
    },
    'a fresh reading within LOAD_FRESH_S, inclusive; a stale one proves no under': () => {
      expect(m.loadLines([cand('a', lim(10, LOAD_FRESH_S))], NOW).chat).toEqual({ kind: 'under' });
      expect(m.loadLines([cand('a', lim(10, LOAD_FRESH_S + 1))], NOW).chat).toEqual({ kind: 'unmeasured', why: 'stale' });
    },
    'one past and one stale-under is unmeasured': () => {
      expect(m.loadLines([cand('a', lim(96)), cand('b', lim(10, LOAD_FRESH_S + 1))], NOW).chat).toEqual({ kind: 'unmeasured', why: 'stale' });
    },
    'an account that cannot serve proves no under': () => {
      expect(m.loadLines([cand('a', lim(10), 'unmeasured'), cand('b', lim(96))], NOW).chat).toEqual({ kind: 'unmeasured', why: 'stale' });
    },
    'one known window proves past': () => {
      expect(m.loadLines([cand('a', lim(null, 60, { seven: 96 }))], NOW).chat).toEqual({ kind: 'past', leastPct: 96 });
    },
    'an account at the ceiling is a past candidate (F1)': () => {
      const got = m.overlordLoadCandidates(designated, ['a', 'b'], { lanes: { a: lane(99), b: lane(99) }, limits: { a: lim(99), b: lim(99) }, nowS: NOW });
      expect(got).toMatchObject({ kind: 'candidates', list: [{ id: 'a', serves: 'at-ceiling' }, { id: 'b', serves: 'at-ceiling' }] });
      expect(m.loadLines((got as { list: never[] }).list, NOW).chat).toEqual({ kind: 'past', leastPct: 99 });
    },
    'an account with no continuity record is left out': () => {
      expect(m.overlordLoadCandidates(designated, ['a'], { lanes: { a: lane(10, 'none') }, limits: { a: lim(10) }, nowS: NOW }))
        .toEqual({ kind: 'candidates', list: [] });
    },
    'the move: true at hard with a fresh other under soft; only serving others counted': () => {
      expect(m.accountLoadMoveReading(cand('c', lim(85)), [cand('o', lim(69))], NOW)).toEqual({ kind: 'measured', value: true });
      expect(m.accountLoadMoveReading(cand('c', lim(86)), [cand('o', lim(10), 'unmeasured')], NOW)).toEqual({ kind: 'measured', value: false });
    },
    'the move: false under hard': () => {
      expect(m.accountLoadMoveReading(cand('c', lim(84.9)), [cand('o', lim(10))], NOW)).toEqual({ kind: 'measured', value: false });
    },
    'the move: an unmeasured counted other holds it unmeasured': () => {
      expect(m.accountLoadMoveReading(cand('c', lim(86)), [cand('o', lim(10, LOAD_FRESH_S + 1))], NOW).kind).toBe('unmeasured');
      expect(m.accountLoadMoveReading(cand('c', lim(86)), [cand('o', lim(null))], NOW).kind).toBe('unmeasured');
    },
  };
}

const LOAD_SET: MutantSet<LoadModule> = {
  modulePath: path.join(ROOT, 'server/src/accountLoad.ts'),
  mutants: [
    { id: 'A1 under at the line', old: 'return v !== null && v < pct; })) return', new: 'return v !== null && v <= pct; })) return' },
    { id: 'A2 past only above the line', old: 'v !== null && v >= pct)) return', new: 'v !== null && v > pct)) return' },
    { id: 'A3 freshness exclusive', old: 'nowS - l.ts > LOAD_FRESH_S ? null : m;', new: 'nowS - l.ts >= LOAD_FRESH_S ? null : m;' },
    { id: 'A4 no freshness', old: 'nowS - l.ts > LOAD_FRESH_S ? null : m;', new: 'false ? null : m;' },
    { id: 'A5 under needs every account', old: 'if (list.some((c) => {', new: 'if (list.every((c) => {' },
    { id: 'A6 past needs one account', old: 'if (past.every((v)', new: 'if (past.some((v)' },
    { id: 'A7 at-ceiling dropped', old: "{ out.push({ id, limits, serves: 'at-ceiling' }); continue; }", new: '{ continue; }' },
    { id: 'A8 any account proves under', old: "c.serves === 'yes' ? freshLoad(c.limits, nowS) : null", new: 'freshLoad(c.limits, nowS)' },
    { id: 'A9 one window proves nothing', old: 'return known.length === 0 ? null : Math.max(...known);', new: 'return null;' },
    { id: 'A10 no-record accounts kept', old: "if (answers.every(({ s }) => s.kind === 'unservable')) continue;", new: '' },
    { id: 'A11 every other counted', old: "const counted = others.filter((o) => o.serves === 'yes');", new: 'const counted = others;' },
    { id: 'A12 hard inclusive', old: 'if (cur !== null && cur < LOAD_LINE_PCT.hard)', new: 'if (cur !== null && cur <= LOAD_LINE_PCT.hard)' },
    { id: 'A13 an unmeasured other read as past', old: 'return v !== null && v >= LOAD_LINE_PCT.soft;', new: 'return v === null || v >= LOAD_LINE_PCT.soft;' },
  ],
  suite: loadCases,
};

export const POOL_RUNWAY_KEY = 'server/src/poolRunway.ts#poolRunway';
export const LOAD_LINES_KEY = 'server/src/accountLoad.ts#loadLines';

export const ACCOUNT_LOAD_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [POOL_RUNWAY_KEY]: RUNWAY_SET as MutantSet<never>,
  [LOAD_LINES_KEY]: LOAD_SET as MutantSet<never>,
};
