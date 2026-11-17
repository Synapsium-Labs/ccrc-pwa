// The forecast mutant sets (Overlord W2, forecasts A; plan w2-forecasts-health.md, Task 1 Step 5 and Task 2 Step 5; the
// floors rule is D-8217's): `seededDraws` against `../forecastCases.ts`' SEEDED_CASES over a mutated copy of
// server/src/time/seeded.ts, and `forecastProgramme`, `forecastOutcome` and `forecastCalibration` against its forecast
// cases over a mutated copy of server/src/coord/forecast.ts, with 20 runs per property (the suite runs 200). Registered in
// mutation-floors.test.ts's MUTANT_SETS, with a floor each in mutation-floors.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEEDED_CASES, forecastCases, type Case, type ForecastModule, type SeededModule } from '../forecastCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEEDED_TS = path.resolve(here, '../../src/time/seeded.ts');
const FORECAST_TS = path.resolve(here, '../../src/coord/forecast.ts');
export const SEEDED_DRAWS_KEY = 'server/src/time/seeded.ts#seededDraws';
export const FORECAST_PROGRAMME_KEY = 'server/src/coord/forecast.ts#forecastProgramme';
export const FORECAST_OUTCOME_KEY = 'server/src/coord/forecast.ts#forecastOutcome';
export const FORECAST_CALIBRATION_KEY = 'server/src/coord/forecast.ts#forecastCalibration';

const PROPERTY_RUNS = 20;
const suiteOf = <M>(cases: readonly Case<M>[]) => (m: M): Record<string, SuiteCase> =>
  Object.fromEntries(cases.map((c) => [c.name, () => c.run(m)]));
const forecastSet = (mutants: MutantSet<ForecastModule>['mutants']): MutantSet<ForecastModule> =>
  ({ modulePath: FORECAST_TS, mutants, suite: suiteOf(forecastCases(PROPERTY_RUNS)) });

export const SEEDED_DRAWS_SET: MutantSet<SeededModule> = {
  modulePath: SEEDED_TS, suite: suiteOf(SEEDED_CASES),
  mutants: [
    { id: 'SD-1', old: 'a = (a + 0x6d2b79f5) >>> 0;', new: 'a = (a + 0x6d2b79f4) >>> 0;' },
    { id: 'SD-2', old: '>>> 0) / TWO_32;', new: '>>> 0) / (TWO_32 - 1);' },
    { id: 'SD-3', old: 'n < 1 || n > TWO_32', new: 'n < 0 || n > TWO_32' },
    { id: 'SD-4', old: 'return Math.floor(next() * n);', new: 'return Math.round(next() * n);' },
    { id: 'SD-5', old: 'let h = ((seed >>> 0) ^ Math.imul((index >>> 0) + 1, 0x9e3779b1)) >>> 0;', new: 'let h = ((seed >>> 0) + (index >>> 0)) >>> 0;' },
    { id: 'SD-6', old: 'let a = seed >>> 0;', new: 'let a = (seed + 1) >>> 0;' },
  ],
};

export const FORECAST_PROGRAMME_SET = forecastSet([
  // The plan's red checks: own minimum 19; fleet before own; `hi` read as `hi + 1`; the 85th percentile read at 80; the
  // abandon cap removed (a cap of 50 stands in for none, which would loop for ever at a share of 1).
  { id: 'FP-1', old: 'history.own.done.length >= FORECAST_OWN_MIN', new: 'history.own.done.length >= FORECAST_OWN_MIN - 1' },
  { id: 'FP-2', old: "  if (history.own.done.length >= FORECAST_OWN_MIN) return monteCarlo(history.own, 'own', remaining, seed, asOf);\n  if (history.fleet.done.length >= FORECAST_FLEET_MIN) return monteCarlo(history.fleet, 'fleet', remaining, seed, asOf);",
    new: "  if (history.fleet.done.length >= FORECAST_FLEET_MIN) return monteCarlo(history.fleet, 'fleet', remaining, seed, asOf);\n  if (history.own.done.length >= FORECAST_OWN_MIN) return monteCarlo(history.own, 'own', remaining, seed, asOf);" },
  { id: 'FP-3', old: 's.below(r.hi - r.lo + 1)', new: 's.below(r.hi - r.lo + 2)' },
  { id: 'FP-4', old: 'p85At: asOf + percentile(totals, 85)', new: 'p85At: asOf + percentile(totals, 80)' },
  { id: 'FP-5', old: 'k < ABANDON_REDRAWS_MAX && s.next() < pAbandon', new: 'k < 50 && s.next() < pAbandon' },
  { id: 'FP-6', old: "if (remaining.hi === 0) return { kind: 'unforecastable', reason: 'nothing-left' };", new: '' },
  { id: 'FP-7', old: "if (remaining === null) return { kind: 'unforecastable', reason: 'no-remaining' };", new: "if (remaining === null) return { kind: 'unforecastable', reason: 'nothing-left' };" },
  { id: 'FP-8', old: 'history.fleet.done.length >= FORECAST_FLEET_MIN', new: 'history.fleet.done.length >= FORECAST_FLEET_MIN - 1' },
  { id: 'FP-9', old: 'medianAt: asOf + percentile(totals, 50)', new: 'medianAt: asOf + percentile(totals, 85)' },
  { id: 'FP-10', old: 'const abandoned = h.abandoned.length > 0 ? h.abandoned : h.done;', new: 'const abandoned = h.abandoned.length > 0 ? h.abandoned : [0];' },
  { id: 'FP-11', old: 'const rework = h.rework.length > 0 ? h.rework : h.done;', new: 'const rework = h.rework.length > 0 ? h.rework : [0];' },
  { id: 'FP-12', old: 'if (s.next() < pRework) total += pick(s, rework);', new: '' },
  { id: 'FP-13', old: 'const pRework = shareOf(h.reworks, h.waves);', new: 'const pRework = shareOf(h.abandons, h.waves);' },
  { id: 'FP-14', old: 'trial(seededDraws(streamFor(seed, t))', new: 'trial(seededDraws(streamFor(seed + 1, t))' },
  { id: 'FP-15', old: 'n: h.done.length, source, seed,', new: 'n: h.done.length + h.rework.length, source, seed,' },
]);

export const FORECAST_OUTCOME_SET = forecastSet([
  // The plan's red checks: score before the date; count a close after `p85At`; drop row 4's opened-run check.
  { id: 'FO-1', old: 'if (now < p85At) return \'none\';', new: 'if (now < p85At - 1) return \'none\';' },
  { id: 'FO-2', old: 'const inSpan = (t: number): boolean => t > seal.asOf && t <= p85At;', new: 'const inSpan = (t: number): boolean => t > seal.asOf;' },
  { id: 'FO-3', old: 'r.openedAt > p85At || (r.closedAt !== null && r.closedAt <= lastAt)', new: 'true' },
  { id: 'FO-4', old: 'const inSpan = (t: number): boolean => t > seal.asOf && t <= p85At;', new: 'const inSpan = (t: number): boolean => t >= seal.asOf && t <= p85At;' },
  { id: 'FO-5', old: ".filter(inSpan).length >= seal.hi) return 'met';", new: ".filter(inSpan).length >= seal.hi - 1) return 'met';" },
  { id: 'FO-6', old: "|| seal.outcome !== 'open') return 'none';", new: ") return 'none';" },
  { id: 'FO-7', old: "if (last !== null && last.state === 'done' && inSpan(last.closedAt!)) {", new: "if (last !== null && inSpan(last.closedAt!)) {" },
  { id: 'FO-8', old: 'r.openedAt > p85At || (r.closedAt !== null', new: 'r.openedAt >= p85At - 1 || (r.closedAt !== null' },
  { id: 'FO-9', old: 'r.closedAt !== null && r.closedAt <= p85At && (last', new: 'r.closedAt !== null && (last' },
]);

export const FORECAST_CALIBRATION_SET = forecastSet([
  // The plan's red checks: a closed band edge; three cuts instead of four; `CALIBRATION_MIN_N` read as 0.
  { id: 'FC-1', old: 'c.share! < lo || c.share! > hi', new: 'c.share! <= lo || c.share! > hi' },
  { id: 'FC-2', old: 'c.share! < lo || c.share! > hi', new: 'c.share! < lo || c.share! >= hi' },
  { id: 'FC-3', old: 'for (let k = 0; k < CALIBRATION_CUTS; k++)', new: 'for (let k = 0; k < CALIBRATION_CUTS - 1; k++)' },
  { id: 'FC-4', old: 'read.length >= CALIBRATION_MIN_N ?', new: 'read.length >= 0 ?' },
  { id: 'FC-5', old: 'const outside = cuts.every(', new: 'const outside = cuts.some(' },
  { id: 'FC-6', old: 's.scoredAt > from && s.scoredAt <= at', new: 's.scoredAt >= from && s.scoredAt <= at' },
  { id: 'FC-7', old: 's.scoredAt > from && s.scoredAt <= at', new: 's.scoredAt > from' },
  { id: 'FC-8', old: "if (cuts.some((c) => c.share === null)) return { state: 'unmeasured', cuts };", new: "if (cuts.every((c) => c.share === null)) return { state: 'unmeasured', cuts };" },
]);

export const FORECAST_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [SEEDED_DRAWS_KEY]: SEEDED_DRAWS_SET as MutantSet<never>,
  [FORECAST_PROGRAMME_KEY]: FORECAST_PROGRAMME_SET as MutantSet<never>,
  [FORECAST_OUTCOME_KEY]: FORECAST_OUTCOME_SET as MutantSet<never>,
  [FORECAST_CALIBRATION_KEY]: FORECAST_CALIBRATION_SET as MutantSet<never>,
};
