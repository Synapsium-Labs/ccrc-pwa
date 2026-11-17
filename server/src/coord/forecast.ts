// Overlord W2, forecasts A (spec 2026-11-09 §5.6, H38, M30; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-forecasts-health.md, Tasks 1 and 2). Ring: L1, context Coordination
// (C5). PURE: no `fs`, no store, no clock and no `Math.random`; `asOf`, `now` and the seed are the caller's. It imports
// `shared/`, `../time/seeded.ts` and `../perf/stats.ts` (K) only.
//
// `forecastProgramme` answers when a programme will land: a Monte Carlo over its past wave lead times, seeded so a sealed
// row replays exactly. `forecastOutcome` scores a seal at its 85% date against measured closes alone, never a statement,
// so a forecast's own subject never scores it (question 5, ruled). `forecastCalibration` says whether the 85% dates hold
// (M30), fleet-wide, at each read.
//
// Each decider is first match, total over its stated domain and monotonic (the plan's tables; `forecast.test.ts` holds
// one case per row and the properties).
import {
  ABANDON_REDRAWS_MAX, CALIBRATION_BAND, CALIBRATION_CUTS, CALIBRATION_CUT_STEP_DAYS, CALIBRATION_MIN_N, CALIBRATION_WINDOW_DAYS,
  FORECAST_FLEET_MIN, FORECAST_OWN_MIN, FORECAST_TRIALS,
  type Calibration, type CalibrationCut, type Forecast, type ForecastSource, type ForecastVerdict, type LeadHistory,
  type SealedForecast,
} from '../../../shared/programmeFacts.js';
import { percentile } from '../perf/stats.js';
import { seededDraws, streamFor, type SeededStream } from '../time/seeded.js';

const DAY_MS = 24 * 3_600_000;

/** The programme's own history and the fleet's (every programme's), as of the seal's boundary. */
export interface ForecastHistory { readonly own: LeadHistory; readonly fleet: LeadHistory }
/** A remaining-work statement's range, `0 <= lo <= hi <= REMAINING_WAVES_MAX` as the door enforces. */
export interface RemainingRange { readonly lo: number; readonly hi: number }

/** A share of waves, read as a chance: 0 with no waves, never above 1. */
const shareOf = (part: number, waves: number): number => (waves > 0 ? Math.min(1, Math.max(0, part / waves)) : 0);

const pick = (s: SeededStream, set: readonly number[]): number => set[s.below(set.length)]!;

/** One trial's total: a wave count in [lo, hi], then for each wave, question 3's draws. Every draw comes from the trial's
 *  own stream in a fixed order, wave by wave, so a trial with more waves draws a superset of a trial with fewer: the
 *  forecast is monotonic in the range for one seed. */
function trial(s: SeededStream, h: LeadHistory, r: RemainingRange, pAbandon: number, pRework: number): number {
  const waves = r.lo + s.below(r.hi - r.lo + 1);
  const abandoned = h.abandoned.length > 0 ? h.abandoned : h.done;
  const rework = h.rework.length > 0 ? h.rework : h.done;
  let total = 0;
  for (let w = 0; w < waves; w++) {
    for (let k = 0; k < ABANDON_REDRAWS_MAX && s.next() < pAbandon; k++) total += pick(s, abandoned);
    total += pick(s, h.done);
    if (s.next() < pRework) total += pick(s, rework);
  }
  return total;
}

function monteCarlo(h: LeadHistory, source: ForecastSource, r: RemainingRange, seed: number, asOf: number): Forecast {
  const pAbandon = shareOf(h.abandons, h.waves);
  const pRework = shareOf(h.reworks, h.waves);
  const totals: number[] = new Array<number>(FORECAST_TRIALS);
  for (let t = 0; t < FORECAST_TRIALS; t++) totals[t] = trial(seededDraws(streamFor(seed, t)), h, r, pAbandon, pRework);
  return {
    kind: 'forecast', medianAt: asOf + percentile(totals, 50), p85At: asOf + percentile(totals, 85),
    n: h.done.length, source, seed,
  };
}

/** First match: no statement; nothing left; own history from `FORECAST_OWN_MIN` done leads; the fleet's from
 *  `FORECAST_FLEET_MIN`; else too little history. The store has already left out every lead that is not a finite
 *  number above zero (`programmeFactsStore.ts#leadHistoryOf`). */
export function forecastProgramme(history: ForecastHistory, remaining: RemainingRange | null, seed: number, asOf: number): Forecast {
  if (remaining === null) return { kind: 'unforecastable', reason: 'no-remaining' };
  if (remaining.hi === 0) return { kind: 'unforecastable', reason: 'nothing-left' };
  if (history.own.done.length >= FORECAST_OWN_MIN) return monteCarlo(history.own, 'own', remaining, seed, asOf);
  if (history.fleet.done.length >= FORECAST_FLEET_MIN) return monteCarlo(history.fleet, 'fleet', remaining, seed, asOf);
  return { kind: 'unforecastable', reason: 'too-little-history' };
}

/** One run of the programme, of any kind, that was open at some time after the seal's `asOf`. */
export interface OutcomeRun { readonly openedAt: number; readonly closedAt: number | null; readonly state: string }
/** What `forecastOutcome` reads, all measured from `runs` (`programmeFactsStore.ts#outcomeFactsOf`), never a statement:
 *  the close time of each work wave whose representative closed `done` after the seal's `asOf` (the wave rule,
 *  `shared/programmes.ts`), and every run open at some time after `asOf`. */
export interface OutcomeFacts { readonly doneWaveCloses: readonly number[]; readonly runs: readonly OutcomeRun[] }

/** First match: nothing to score (unforecastable, unreadable or already scored); not yet due; the seal's `hi` work waves
 *  done after `asOf` and at or before `p85At`; the programme's last run closed `done` in that span with no run open from
 *  then to `p85At`; else missed. Every comparison is of epoch milliseconds. */
export function forecastOutcome(seal: SealedForecast, since: OutcomeFacts, now: number): ForecastVerdict {
  if (seal.forecast === 'unreadable' || seal.forecast.kind !== 'forecast' || seal.outcome !== 'open') return 'none';
  const { p85At } = seal.forecast;
  if (now < p85At) return 'none';
  const inSpan = (t: number): boolean => t > seal.asOf && t <= p85At;
  if (seal.hi !== null && since.doneWaveCloses.filter(inSpan).length >= seal.hi) return 'met';
  let last: OutcomeRun | null = null;
  for (const r of since.runs) if (r.closedAt !== null && r.closedAt <= p85At && (last === null || r.closedAt > last.closedAt!)) last = r;
  if (last !== null && last.state === 'done' && inSpan(last.closedAt!)) {
    // Its last run: every run that had opened by p85At had closed by this close, so none opened after it or stood open.
    const lastAt = last.closedAt!;
    if (since.runs.every((r) => r.openedAt > p85At || (r.closedAt !== null && r.closedAt <= lastAt))) return 'met';
  }
  return 'missed';
}

/** One scored seal, as calibration reads it. */
export interface ScoredSeal { readonly scoredAt: number; readonly outcome: 'met' | 'missed' }

/** Question 6: four cuts, now and 7, 14 and 21 days before; each reads the seals scored in the 28 days before it (the
 *  cut included, its window's start not). A cut under `CALIBRATION_MIN_N` is unmeasured. All four measured and outside
 *  `CALIBRATION_BAND` (edges inside) is `uncalibrated`; any cut unmeasured is `unmeasured`; else `calibrated`. */
export function forecastCalibration(scored: readonly ScoredSeal[], now: number): Calibration {
  const [lo, hi] = CALIBRATION_BAND;
  const cuts: CalibrationCut[] = [];
  for (let k = 0; k < CALIBRATION_CUTS; k++) {
    const at = now - k * CALIBRATION_CUT_STEP_DAYS * DAY_MS;
    const from = at - CALIBRATION_WINDOW_DAYS * DAY_MS;
    const read = scored.filter((s) => s.scoredAt > from && s.scoredAt <= at);
    const met = read.filter((s) => s.outcome === 'met').length;
    cuts.push({ at, n: read.length, met, share: read.length >= CALIBRATION_MIN_N ? met / read.length : null });
  }
  if (cuts.some((c) => c.share === null)) return { state: 'unmeasured', cuts };
  const outside = cuts.every((c) => c.share! < lo || c.share! > hi);
  return { state: outside ? 'uncalibrated' : 'calibrated', cuts };
}
