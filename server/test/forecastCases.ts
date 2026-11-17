// Overlord W2, forecasts A (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-forecasts-health.md, Tasks 1 and 2): the
// cases over `seededDraws` and the three forecast deciders. `forecast.test.ts` runs them against the real modules and
// `sim/forecastSets.ts` against each mutant, so one list of cases is both the suite and the mutation floor's judge. The
// property cases take their run count as an argument: the suite runs the plan's 200, a mutant fewer.
import { expect } from 'vitest';
import {
  ABANDON_REDRAWS_MAX, CALIBRATION_MIN_N, FORECAST_FLEET_MIN, FORECAST_OWN_MIN,
  type Forecast, type LeadHistory, type SealedForecast,
} from '../../shared/programmeFacts.js';
import type * as Forecasts from '../src/coord/forecast.js';
import type * as Seeded from '../src/time/seeded.js';
import { mulberry32 } from './fakeTime.js';

export type ForecastModule = Pick<typeof Forecasts, 'forecastProgramme' | 'forecastOutcome' | 'forecastCalibration'>;
export type SeededModule = Pick<typeof Seeded, 'seededDraws' | 'streamFor'>;
export interface Case<M> { name: string; run: (m: M) => void }

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const AS_OF = 1_790_000_000_000;

export const hist = (o: Partial<LeadHistory> = {}): LeadHistory => ({
  done: o.done ?? [], abandoned: o.abandoned ?? [], rework: o.rework ?? [],
  waves: o.waves ?? (o.done ?? []).length, abandons: o.abandons ?? 0, reworks: o.reworks ?? 0, leadsUnmeasured: o.leadsUnmeasured ?? 0,
});
const days = (n: number, d = DAY): number[] => Array.from({ length: n }, () => d);
/** n leads of 1..n days, so every percentile names a different day. */
const spread = (n: number): number[] => Array.from({ length: n }, (_, i) => (i + 1) * DAY);
const EMPTY = hist();

const dated = (f: Forecast): Extract<Forecast, { kind: 'forecast' }> => {
  if (f.kind !== 'forecast') throw new Error(`expected a forecast, got ${JSON.stringify(f)}`);
  return f;
};

// ── seededDraws ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const SEEDED_CASES: Case<SeededModule>[] = [
  { name: 'seededDraws answers the reference mulberry32 sequence for seed 1', run: (m) => {
    const s = m.seededDraws(1);
    expect([s.next(), s.next(), s.next()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
    const ref = mulberry32(7);
    const t = m.seededDraws(7);
    for (let i = 0; i < 1000; i++) expect(t.next()).toBe(ref());
  } },
  { name: 'seededDraws never answers 1.0 or below 0, and below(n) is an integer in [0, n)', run: (m) => {
    const s = m.seededDraws(0xffffffff);
    for (let i = 0; i < 20_000; i++) {
      const v = s.next();
      expect(v >= 0 && v < 1).toBe(true);
      const b = s.below(7);
      expect(Number.isInteger(b) && b >= 0 && b < 7).toBe(true);
    }
  } },
  { name: 'below refuses a bound that is not a positive integer up to 2^32', run: (m) => {
    const s = m.seededDraws(1);
    for (const n of [0, -1, 1.5, Number.NaN, 2 ** 32 + 1]) expect(() => s.below(n)).toThrow(RangeError);
    expect(s.below(1)).toBe(0);
  } },
  { name: 'one seed gives one sequence; another seed another', run: (m) => {
    const a = m.seededDraws(42); const b = m.seededDraws(42); const c = m.seededDraws(43);
    const xs = [a.next(), a.next()]; expect([b.next(), b.next()]).toEqual(xs); expect([c.next(), c.next()]).not.toEqual(xs);
  } },
  { name: 'streamFor mixes seed and index into one 32-bit seed, distinct across neighbours', run: (m) => {
    const seen = new Set<number>();
    for (const seed of [0, 1, 2, 0xffffffff]) for (let i = 0; i < 100; i++) {
      const v = m.streamFor(seed, i);
      expect(Number.isInteger(v) && v >= 0 && v < 2 ** 32).toBe(true);
      seen.add(v);
    }
    expect(seen.size).toBe(400);
    expect(m.streamFor(5, 9)).toBe(m.streamFor(5, 9));
  } },
];

// ── forecastProgramme ───────────────────────────────────────────────────────────────────────────────────────────────

const OWN20 = hist({ done: days(FORECAST_OWN_MIN) });
const FLEET20 = hist({ done: days(FORECAST_FLEET_MIN, 2 * DAY) });

export const FORECAST_ROW_CASES: Case<ForecastModule>[] = [
  { name: 'row 1: no statement is unforecastable, no-remaining', run: (m) => {
    expect(m.forecastProgramme({ own: OWN20, fleet: FLEET20 }, null, 1, AS_OF)).toEqual({ kind: 'unforecastable', reason: 'no-remaining' });
  } },
  { name: 'row 2: a statement of nothing left is unforecastable, nothing-left', run: (m) => {
    expect(m.forecastProgramme({ own: OWN20, fleet: FLEET20 }, { lo: 0, hi: 0 }, 1, AS_OF))
      .toEqual({ kind: 'unforecastable', reason: 'nothing-left' });
  } },
  { name: 'row 3: own history of FORECAST_OWN_MIN done leads forecasts from its own, before the fleet', run: (m) => {
    const f = dated(m.forecastProgramme({ own: OWN20, fleet: FLEET20 }, { lo: 1, hi: 1 }, 1, AS_OF));
    expect(f).toMatchObject({ source: 'own', n: FORECAST_OWN_MIN, seed: 1, medianAt: AS_OF + DAY, p85At: AS_OF + DAY });
  } },
  { name: 'row 4: own history one short of the minimum forecasts from the fleet', run: (m) => {
    const own = hist({ done: days(FORECAST_OWN_MIN - 1) });
    const f = dated(m.forecastProgramme({ own, fleet: FLEET20 }, { lo: 1, hi: 1 }, 1, AS_OF));
    expect(f).toMatchObject({ source: 'fleet', n: FORECAST_FLEET_MIN, medianAt: AS_OF + 2 * DAY });
  } },
  { name: 'row 5: neither history has enough done leads: too-little-history', run: (m) => {
    const own = hist({ done: days(FORECAST_OWN_MIN - 1) });
    const fleet = hist({ done: days(FORECAST_FLEET_MIN - 1) });
    expect(m.forecastProgramme({ own, fleet }, { lo: 1, hi: 5 }, 1, AS_OF)).toEqual({ kind: 'unforecastable', reason: 'too-little-history' });
    expect(m.forecastProgramme({ own: EMPTY, fleet: EMPTY }, { lo: 1, hi: 5 }, 1, AS_OF)).toEqual({ kind: 'unforecastable', reason: 'too-little-history' });
  } },
  { name: 'twenty identical leads of one day with lo = hi = 3 answer both dates at asOf + 3 days', run: (m) => {
    const f = dated(m.forecastProgramme({ own: OWN20, fleet: EMPTY }, { lo: 3, hi: 3 }, 99, AS_OF));
    expect([f.medianAt, f.p85At]).toEqual([AS_OF + 3 * DAY, AS_OF + 3 * DAY]);
  } },
  { name: 'an abandon share of 1 adds exactly ABANDON_REDRAWS_MAX abandoned leads to each wave', run: (m) => {
    const own = hist({ done: days(20), abandoned: days(20, HOUR), waves: 10, abandons: 10 });
    const f = dated(m.forecastProgramme({ own, fleet: EMPTY }, { lo: 2, hi: 2 }, 5, AS_OF));
    expect([f.medianAt, f.p85At]).toEqual([AS_OF + 2 * (DAY + ABANDON_REDRAWS_MAX * HOUR), AS_OF + 2 * (DAY + ABANDON_REDRAWS_MAX * HOUR)]);
  } },
  { name: 'an empty abandoned set reuses the done set', run: (m) => {
    const own = hist({ done: days(20), waves: 10, abandons: 10 });
    const f = dated(m.forecastProgramme({ own, fleet: EMPTY }, { lo: 1, hi: 1 }, 5, AS_OF));
    expect(f.medianAt).toBe(AS_OF + (1 + ABANDON_REDRAWS_MAX) * DAY);
  } },
  { name: 'a rework share of 1 adds one rework lead to each wave; an empty rework set reuses the done set', run: (m) => {
    const own = hist({ done: days(20), rework: days(20, 2 * HOUR), waves: 4, reworks: 4 });
    expect(dated(m.forecastProgramme({ own, fleet: EMPTY }, { lo: 3, hi: 3 }, 5, AS_OF)).p85At).toBe(AS_OF + 3 * (DAY + 2 * HOUR));
    const bare = hist({ done: days(20), waves: 4, reworks: 4 });
    expect(dated(m.forecastProgramme({ own: bare, fleet: EMPTY }, { lo: 3, hi: 3 }, 5, AS_OF)).p85At).toBe(AS_OF + 6 * DAY);
  } },
  { name: 'no abandon and no rework when the shares are 0', run: (m) => {
    const own = hist({ done: days(20), abandoned: days(20, 50 * DAY), rework: days(20, 50 * DAY), waves: 30 });
    expect(dated(m.forecastProgramme({ own, fleet: EMPTY }, { lo: 2, hi: 2 }, 3, AS_OF)).p85At).toBe(AS_OF + 2 * DAY);
  } },
  { name: 'a wider range reaches its top: lo = 3, hi = 4 puts the 85% date at 4 waves and the median at 3 or 4', run: (m) => {
    const f = dated(m.forecastProgramme({ own: OWN20, fleet: EMPTY }, { lo: 3, hi: 4 }, 11, AS_OF));
    expect(f.p85At).toBe(AS_OF + 4 * DAY);
    expect([AS_OF + 3 * DAY, AS_OF + 4 * DAY]).toContain(f.medianAt);
    const g = dated(m.forecastProgramme({ own: OWN20, fleet: EMPTY }, { lo: 0, hi: 1 }, 11, AS_OF));
    expect(g.p85At).toBe(AS_OF + DAY);
  } },
  { name: 'the replay case: one fixed history and seed answer pinned dates', run: (m) => {
    // Leads a few seconds apart, so the totals do not quantise to whole days and another seed moves the pinned dates.
    const own = hist({ done: spread(20).map((d, i) => d + i * 7_919_000), abandoned: days(5, 6 * HOUR).map((d, i) => d + i * 104_729),
      rework: days(5, 12 * HOUR).map((d, i) => d + i * 1_299_709), waves: 25, abandons: 5, reworks: 5 });
    const f = dated(m.forecastProgramme({ own, fleet: EMPTY }, { lo: 2, hi: 5 }, 20261117, AS_OF));
    expect(f).toEqual({ kind: 'forecast', medianAt: AS_OF + REPLAY.median, p85At: AS_OF + REPLAY.p85, n: 20, source: 'own', seed: 20261117 });
  } },
  { name: 'the 85% date is the 85th percentile of the totals, not a lower one', run: (m) => {
    // One wave of 1..20 days: the totals are uniform over the 20 leads, so p85 is 17 days and p80 16.
    const f = dated(m.forecastProgramme({ own: hist({ done: spread(20) }), fleet: EMPTY }, { lo: 1, hi: 1 }, 77, AS_OF));
    expect(f.p85At - AS_OF).toBeGreaterThanOrEqual(16.5 * DAY);
    expect(f.medianAt - AS_OF).toBeLessThanOrEqual(11 * DAY);
  } },
];

/** The replay case's pinned dates, offsets from asOf in ms (about 39.3 and 59.6 days), measured once and pinned: a change to the
 *  draws, their order or the percentile moves them. */
export const REPLAY = { median: 3_393_327_000, p85: 5_147_950_000 };

// ── the properties ──────────────────────────────────────────────────────────────────────────────────────────────────

const genHistory = (r: () => number, max: number): LeadHistory => {
  const n = Math.floor(r() * max);
  const leads = (k: number) => Array.from({ length: k }, () => 1 + Math.floor(r() * 10 * DAY));
  const waves = n + Math.floor(r() * 10);
  return hist({ done: leads(n), abandoned: leads(Math.floor(r() * 5)), rework: leads(Math.floor(r() * 5)),
    waves, abandons: Math.floor(r() * (waves + 1) * 0.5), reworks: Math.floor(r() * (waves + 1) * 0.5) });
};
const genRemaining = (r: () => number): { lo: number; hi: number } | null => {
  if (r() < 0.1) return null;
  const lo = Math.floor(r() * 4); return { lo, hi: lo + Math.floor(r() * 4) };
};

export const forecastPropertyCases = (runs: number): Case<ForecastModule>[] => [
  { name: `one seed and one input give one answer (${runs} runs)`, run: (m) => {
    const r = mulberry32(101);
    for (let i = 0; i < runs; i++) {
      const h = { own: genHistory(r, 30), fleet: genHistory(r, 40) }; const rem = genRemaining(r); const seed = Math.floor(r() * 2 ** 32);
      expect(m.forecastProgramme(h, rem, seed, AS_OF)).toEqual(m.forecastProgramme(h, rem, seed, AS_OF));
    }
  } },
  { name: `a larger lo or hi never gives an earlier date, for one seed (${runs} runs)`, run: (m) => {
    const r = mulberry32(202);
    for (let i = 0; i < runs; i++) {
      const h = { own: genHistory(r, 30), fleet: genHistory(r, 40) }; const seed = Math.floor(r() * 2 ** 32);
      const lo = Math.floor(r() * 4); const hi = lo + 1 + Math.floor(r() * 3);
      const base = m.forecastProgramme(h, { lo, hi }, seed, AS_OF);
      for (const wider of [{ lo, hi: hi + 1 + Math.floor(r() * 3) }, { lo: lo + 1, hi }, { lo: lo + 1, hi: hi + 2 }]) {
        const w = m.forecastProgramme(h, wider, seed, AS_OF);
        expect(w.kind).toBe(base.kind);
        if (base.kind === 'forecast' && w.kind === 'forecast') {
          expect(w.medianAt).toBeGreaterThanOrEqual(base.medianAt);
          expect(w.p85At).toBeGreaterThanOrEqual(base.p85At);
        }
      }
    }
  } },
  { name: `removing samples never turns unforecastable into a forecast (${runs} runs)`, run: (m) => {
    const r = mulberry32(303);
    const drop = (h: LeadHistory): LeadHistory => ({ ...h, done: h.done.slice(0, Math.floor(r() * (h.done.length + 1))),
      abandoned: h.abandoned.slice(0, Math.floor(r() * (h.abandoned.length + 1))), rework: h.rework.slice(1) });
    for (let i = 0; i < runs; i++) {
      const h = { own: genHistory(r, 30), fleet: genHistory(r, 30) }; const rem = genRemaining(r);
      if (m.forecastProgramme(h, rem, 1, AS_OF).kind !== 'unforecastable') continue;
      expect(m.forecastProgramme({ own: drop(h.own), fleet: drop(h.fleet) }, rem, 1, AS_OF).kind).toBe('unforecastable');
    }
  } },
];

// ── forecastOutcome ─────────────────────────────────────────────────────────────────────────────────────────────────

const P85 = AS_OF + 10 * DAY;
export const seal = (o: Partial<SealedForecast> = {}): SealedForecast => ({
  id: 1, program: 'prog-a', closingRunId: 9, sealedAt: AS_OF, asOf: AS_OF, statementId: 3, lo: 1, hi: 2,
  forecast: { kind: 'forecast', medianAt: AS_OF + 5 * DAY, p85At: P85, n: 20, source: 'own', seed: 1 },
  outcome: 'open', scoredAt: null, ...o,
});
const AFTER = P85 + HOUR;
const closed = (openedAt: number, closedAt: number, state = 'done') => ({ openedAt, closedAt, state });

export const OUTCOME_CASES: Case<ForecastModule>[] = [
  { name: 'outcome row 1: an unforecastable, unreadable or already scored seal answers none', run: (m) => {
    const two = { doneWaveCloses: [AS_OF + DAY, AS_OF + 2 * DAY], runs: [] };
    expect(m.forecastOutcome(seal({ forecast: { kind: 'unforecastable', reason: 'no-remaining' } }), two, AFTER)).toBe('none');
    expect(m.forecastOutcome(seal({ forecast: 'unreadable' }), two, AFTER)).toBe('none');
    expect(m.forecastOutcome(seal({ outcome: 'met' }), two, AFTER)).toBe('none');
    expect(m.forecastOutcome(seal({ outcome: 'missed' }), two, AFTER)).toBe('none');
    expect(m.forecastOutcome(seal({ outcome: 'unreadable' }), two, AFTER)).toBe('none');
    expect(m.forecastOutcome(seal(), two, AFTER)).toBe('met');
  } },
  { name: 'outcome row 2: before the 85% date nothing is scored, even with every wave done; at it, it is', run: (m) => {
    const two = { doneWaveCloses: [AS_OF + DAY, AS_OF + 2 * DAY], runs: [] };
    expect(m.forecastOutcome(seal(), two, P85 - 1)).toBe('none');
    expect(m.forecastOutcome(seal(), two, P85)).toBe('met');
  } },
  { name: 'outcome row 3: the seal\'s hi work waves done after asOf and at or before the date is met', run: (m) => {
    expect(m.forecastOutcome(seal(), { doneWaveCloses: [AS_OF + 1, P85], runs: [] }, AFTER)).toBe('met');
    expect(m.forecastOutcome(seal(), { doneWaveCloses: [AS_OF + 1], runs: [] }, AFTER)).toBe('missed');
    expect(m.forecastOutcome(seal(), { doneWaveCloses: [AS_OF + 1, P85 + 1], runs: [] }, AFTER)).toBe('missed');
    expect(m.forecastOutcome(seal(), { doneWaveCloses: [AS_OF, AS_OF + 1], runs: [] }, AFTER)).toBe('missed');
    expect(m.forecastOutcome(seal({ hi: 3 }), { doneWaveCloses: [AS_OF + 1, AS_OF + 2], runs: [] }, AFTER)).toBe('missed');
  } },
  { name: 'outcome row 4: the programme closed its last run done, with nothing opened after, is met', run: (m) => {
    const runs = [closed(AS_OF - DAY, AS_OF + DAY), closed(AS_OF + DAY, AS_OF + 2 * DAY)];
    expect(m.forecastOutcome(seal({ hi: 5 }), { doneWaveCloses: [AS_OF + DAY], runs }, AFTER)).toBe('met');
  } },
  { name: 'outcome row 4: a run opened one millisecond before the date, after the last close, is missed (F17)', run: (m) => {
    const runs = [closed(AS_OF - DAY, AS_OF + DAY), { openedAt: P85 - 1, closedAt: null, state: 'working' }];
    expect(m.forecastOutcome(seal({ hi: 5 }), { doneWaveCloses: [AS_OF + DAY], runs }, AFTER)).toBe('missed');
    const later = [closed(AS_OF - DAY, AS_OF + DAY), { openedAt: P85 + 1, closedAt: null, state: 'working' }];
    expect(m.forecastOutcome(seal({ hi: 5 }), { doneWaveCloses: [AS_OF + DAY], runs: later }, AFTER)).toBe('met');
  } },
  { name: 'outcome row 4: a last close that failed, a run still open from before, or a close after the date is missed', run: (m) => {
    expect(m.forecastOutcome(seal({ hi: 5 }), { doneWaveCloses: [], runs: [closed(AS_OF - DAY, AS_OF + DAY, 'failed')] }, AFTER)).toBe('missed');
    const parallel = [closed(AS_OF - DAY, AS_OF + DAY), { openedAt: AS_OF - 2 * DAY, closedAt: null, state: 'working' }];
    expect(m.forecastOutcome(seal({ hi: 5 }), { doneWaveCloses: [AS_OF + DAY], runs: parallel }, AFTER)).toBe('missed');
    const lateClose = [closed(AS_OF - DAY, AS_OF + DAY), closed(AS_OF - 2 * DAY, P85 + 1)];
    expect(m.forecastOutcome(seal({ hi: 5 }), { doneWaveCloses: [AS_OF + DAY], runs: lateClose }, AFTER)).toBe('missed');
    expect(m.forecastOutcome(seal({ hi: 5 }), { doneWaveCloses: [], runs: [closed(AS_OF - DAY, AS_OF)] }, AFTER)).toBe('missed');
  } },
  { name: 'outcome row 5: no close at all is missed, whatever a statement said (F3)', run: (m) => {
    // The decider takes no statement: a coordinator stating 0..0 before the date cannot score its own forecast.
    expect(m.forecastOutcome(seal(), { doneWaveCloses: [], runs: [] }, AFTER)).toBe('missed');
    expect(m.forecastOutcome.length).toBe(3);
  } },
  { name: 'outcome property: removing a measured close never turns missed into met', run: (m) => {
    const r = mulberry32(404);
    for (let i = 0; i < 300; i++) {
      const at = () => AS_OF - DAY + Math.floor(r() * 12 * DAY);
      const closes = Array.from({ length: Math.floor(r() * 4) }, at);
      const runs = Array.from({ length: Math.floor(r() * 3) }, () => {
        const o = at(); return r() < 0.3 ? { openedAt: o, closedAt: null, state: 'working' } : closed(o, o + Math.floor(r() * 3 * DAY), r() < 0.8 ? 'done' : 'failed');
      });
      const s = seal({ hi: 1 + Math.floor(r() * 3) });
      if (m.forecastOutcome(s, { doneWaveCloses: closes, runs }, AFTER) !== 'missed') continue;
      expect(m.forecastOutcome(s, { doneWaveCloses: closes.slice(1), runs }, AFTER)).toBe('missed');
      expect(m.forecastOutcome(s, { doneWaveCloses: closes, runs: runs.map((x, k) => (k === 0 ? { ...x, closedAt: null } : x)) }, AFTER)).toBe('missed');
    }
  } },
];

// ── forecastCalibration ─────────────────────────────────────────────────────────────────────────────────────────────

const NOW = AS_OF + 60 * DAY;
/** `n` scored seals, `met` of them met, scored at `at`. */
const batch = (at: number, n: number, met: number) =>
  Array.from({ length: n }, (_, i) => ({ scoredAt: at, outcome: i < met ? ('met' as const) : ('missed' as const) }));
/** Cut k's time. A window is 28 days and the cuts are 7 apart, so one batch is read by several cuts: each case says which. */
const cutAt = (k: number): number => NOW - k * 7 * DAY;

export const CALIBRATION_CASES: Case<ForecastModule>[] = [
  { name: 'calibration: four cuts, now and 7, 14 and 21 days before, each over the 28 days before it', run: (m) => {
    const c = m.forecastCalibration(batch(NOW - 20 * DAY, 10, 8), NOW);
    expect(c.cuts.map((x) => x.at)).toEqual([cutAt(0), cutAt(1), cutAt(2), cutAt(3)]);
    // Scored 20 days before now: inside cuts 0 to 2's windows (28 days), not cut 3's (it is 1 day after cut 3).
    expect(c.cuts.map((x) => x.n)).toEqual([10, 10, 10, 0]);
    expect(c.cuts[0]).toEqual({ at: NOW, n: 10, met: 8, share: 0.8 });
    expect(c.cuts[3]!.share).toBeNull();
    expect(c.state).toBe('unmeasured');
  } },
  { name: 'calibration: all four measured and outside 75 to 90% is uncalibrated; at the window edges', run: (m) => {
    // Scored at cut 3, so read by all four cuts: 5 of 10 everywhere.
    expect(m.forecastCalibration(batch(NOW - 21 * DAY, 10, 5), NOW).state).toBe('uncalibrated');
    // A seal scored exactly 28 days before cut 0 is outside cut 0's window; one scored at the cut is inside.
    const edge = m.forecastCalibration([...batch(NOW - 28 * DAY, 10, 10), ...batch(NOW - 21 * DAY, 8, 0)], NOW);
    expect(edge.cuts[0]!.n).toBe(8);
    expect(edge.cuts[3]!.n).toBe(18);
    expect(m.forecastCalibration(batch(NOW, 8, 8), NOW).cuts[0]!.n).toBe(8);
  } },
  { name: 'calibration: three cuts outside and one inside is calibrated', run: (m) => {
    // 10 seals at -21 days (5 met) are read by every cut; 10 more at now (10 met) only by cut 0: 15 of 20 is inside.
    const c = m.forecastCalibration([...batch(NOW - 21 * DAY, 10, 5), ...batch(NOW, 10, 10)], NOW);
    expect(c.cuts.map((x) => x.share)).toEqual([0.75, 0.5, 0.5, 0.5]);
    expect(c.state).toBe('calibrated');
  } },
  { name: 'calibration: the band\'s edges, 0.75 and 0.9, are inside', run: (m) => {
    expect(m.forecastCalibration(batch(NOW - 21 * DAY, 20, 15), NOW).state).toBe('calibrated');
    expect(m.forecastCalibration(batch(NOW - 21 * DAY, 10, 9), NOW).state).toBe('calibrated');
    expect(m.forecastCalibration(batch(NOW - 21 * DAY, 100, 74), NOW).state).toBe('uncalibrated');
    expect(m.forecastCalibration(batch(NOW - 21 * DAY, 100, 91), NOW).state).toBe('uncalibrated');
  } },
  { name: 'calibration: a cut with CALIBRATION_MIN_N - 1 seals is unmeasured, with CALIBRATION_MIN_N measured', run: (m) => {
    const seven = m.forecastCalibration(batch(NOW - 21 * DAY, CALIBRATION_MIN_N - 1, 0), NOW);
    expect(seven.state).toBe('unmeasured');
    expect(seven.cuts.every((x) => x.share === null && x.n === CALIBRATION_MIN_N - 1)).toBe(true);
    expect(m.forecastCalibration(batch(NOW - 21 * DAY, CALIBRATION_MIN_N, 0), NOW).state).toBe('uncalibrated');
    expect(m.forecastCalibration([], NOW).state).toBe('unmeasured');
  } },
  { name: 'calibration: a seal scored after now is not read', run: (m) => {
    expect(m.forecastCalibration(batch(NOW + 1, 20, 0), NOW).cuts[0]!.n).toBe(0);
  } },
  { name: 'calibration property: removing scored seals never turns unmeasured into either other state', run: (m) => {
    const r = mulberry32(505);
    for (let i = 0; i < 200; i++) {
      const s = Array.from({ length: Math.floor(r() * 60) }, () => ({
        scoredAt: NOW - Math.floor(r() * 50 * DAY), outcome: r() < 0.8 ? ('met' as const) : ('missed' as const) }));
      if (m.forecastCalibration(s, NOW).state !== 'unmeasured') continue;
      expect(m.forecastCalibration(s.filter(() => r() < 0.7), NOW).state).toBe('unmeasured');
    }
  } },
];

export const forecastCases = (runs: number): Case<ForecastModule>[] =>
  [...FORECAST_ROW_CASES, ...forecastPropertyCases(runs), ...OUTCOME_CASES, ...CALIBRATION_CASES];
