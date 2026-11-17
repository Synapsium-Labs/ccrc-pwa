// Overlord W2, forecasts A (spec 2026-11-09 §5.6, H38, M30; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-forecasts-health.md, Tasks 1 and 2). Ring: L1, context Coordination
// (C5). PURE: no `fs`, no store, no clock and no `Math.random`; `asOf`, `now` and the seed are the caller's. It imports
// `shared/`, `../time/seeded.ts` and `../perf/stats.ts` (K), and `./runCloseSwitch.ts` (L1) for the dispatch abandon's
// close detail.
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
  FORECAST_FLEET_MIN, FORECAST_OWN_MIN, FORECAST_TRIALS, SEAL_WAIT_MINUTES,
  type Calibration, type CalibrationCut, type Forecast, type ForecastSource, type ForecastVerdict, type LeadHistory,
  type SealedForecast,
} from '../../../shared/programmeFacts.js';
import { isRunKind } from '../../../shared/api.js';
import { NEVER_STARTED_DETAIL, countsAsWave, isRebuiltRun, waveRepresentative } from '../../../shared/programmes.js';
import { percentile } from '../perf/stats.js';
import { DISPATCH_ABANDON_CLOSE_DETAIL } from './runCloseSwitch.js';
import { seededDraws, streamFor, type SeededStream } from '../time/seeded.js';

const DAY_MS = 24 * 3_600_000;
/** Calibration's step between cuts, a week: its own fact, which only shares the number with other seven-day spans
 *  (`token-shared.test.ts` names it in a row of its own). */
const CALIBRATION_CUT_STEP_MS = CALIBRATION_CUT_STEP_DAYS * DAY_MS;

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
    const at = now - k * CALIBRATION_CUT_STEP_MS;
    const from = at - CALIBRATION_WINDOW_DAYS * DAY_MS;
    const read = scored.filter((s) => s.scoredAt > from && s.scoredAt <= at);
    const met = read.filter((s) => s.outcome === 'met').length;
    cuts.push({ at, n: read.length, met, share: read.length >= CALIBRATION_MIN_N ? met / read.length : null });
  }
  if (cuts.some((c) => c.share === null)) return { state: 'unmeasured', cuts };
  const outside = cuts.every((c) => c.share! < lo || c.share! > hi);
  return { state: outside ? 'uncalibrated' : 'calibrated', cuts };
}

const MINUTE_MS = 60_000;

/** One run as the lead history reads it, straight from `runs`. */
export interface LeadRun {
  readonly id: number; readonly program: string; readonly wave: number; readonly kind: string; readonly state: string;
  readonly openedAt: number; readonly dispatchedAt: number | null; readonly closedAt: number | null;
  readonly closeDetail: string | null; readonly claimedBy: string | null;
}

const isAbandonDetail = (d: string | null): boolean =>
  d !== null && d !== NEVER_STARTED_DETAIL && (d.startsWith('abandon:') || d === DISPATCH_ABANDON_CLOSE_DETAIL);
const isLead = (ms: number): boolean => Number.isFinite(ms) && ms > 0;

interface LeadWave { closedAt: number; runs: LeadRun[]; rep: LeadRun }

/** One programme's history as of `asOf` (questions 2 and 3, the wave rule of `shared/programmes.ts`). Only runs opened by
 *  `asOf` exist, and a run closed after `asOf` is still open. A wave stands as its `waveRepresentative`; it is closed when
 *  that run is, at its `closedAt`. Its lead is close to close (question 2): it starts at the previous counted wave's
 *  close (close order), so the gap between waves is in it whether the wave opened before that close or after; a
 *  programme's first wave starts at its earliest `openedAt`. A wave whose representative closed `done` gives a done
 *  lead; one closed `failed` by an abandon (never `abandon:never-started`, which is no wave at all) an abandoned lead.
 *  A wave closed `failed` for any other reason gives no sample and is not counted, and its close is no boundary: the
 *  next counted wave's lead spans it (from its earliest `openedAt` when it came first), so its time is never dropped.
 *  A reworked wave (two or more work runs: `RUN_TRANSITIONS` gives a closed run no exit, so this is also the only
 *  reopening) gives its first run's lead as its done or abandoned lead and ONE rework sample, the sum of its later
 *  runs' leads, each close to close from the run before it. A trial adds at most one rework sample per wave at the
 *  rework share's chance, so it reproduces a wave of any number of runs, and a wave's samples sum to its
 *  close-to-close lead. A wave with a run `isRebuiltRun` marks, or a lead that is not a finite number above zero, is
 *  counted in `leadsUnmeasured`, never added. */
function programmeLeads(runs: readonly LeadRun[], asOf: number): LeadHistory {
  const byWave = new Map<number, LeadRun[]>();
  for (const r of runs) {
    if (!isRunKind(r.kind) || !countsAsWave(r.kind) || r.openedAt > asOf) continue;
    const list = byWave.get(r.wave) ?? [];
    list.push(r);
    byWave.set(r.wave, list);
  }
  const closedBy = (r: LeadRun): number | null => (r.closedAt !== null && r.closedAt <= asOf ? r.closedAt : null);
  const waves: LeadWave[] = [];
  for (const list of byWave.values()) {
    const sorted = [...list].sort((a, b) => a.id - b.id);
    const rep = waveRepresentative(sorted.map((r) => ({ id: r.id, open: closedBy(r) === null, r })))!.r;
    const at = closedBy(rep);
    if (at === null || rep.closeDetail === NEVER_STARTED_DETAIL) continue;
    waves.push({ closedAt: at, runs: sorted, rep });
  }
  waves.sort((a, b) => a.closedAt - b.closedAt || a.rep.id - b.rep.id);
  const out = { done: [] as number[], abandoned: [] as number[], rework: [] as number[], waves: 0, abandons: 0, reworks: 0, leadsUnmeasured: 0 };
  let prevClose: number | null = null;
  let firstFrom: number | null = null;
  for (const w of waves) {
    const opened = Math.min(...w.runs.map((r) => r.openedAt));
    const start = prevClose ?? Math.min(firstFrom ?? opened, opened);
    const abandoned = w.rep.state === 'failed' && isAbandonDetail(w.rep.closeDetail);
    if (w.rep.state !== 'done' && !abandoned) { if (prevClose === null) firstFrom = start; continue; }
    prevClose = w.closedAt;
    if (w.runs.some(isRebuiltRun)) { out.leadsUnmeasured += 1; continue; }
    const closes = w.runs.map(closedBy);
    const main = (w.runs.length === 1 ? w.closedAt : closes[0] ?? NaN) - start;
    const reworks: number[] = [];
    for (let i = 1; i < w.runs.length; i++) reworks.push((closes[i] ?? NaN) - (closes[i - 1] ?? NaN));
    if (!isLead(main) || !reworks.every(isLead)) { out.leadsUnmeasured += 1; continue; }
    out.waves += 1;
    if (abandoned) { out.abandoned.push(main); out.abandons += 1; } else out.done.push(main);
    if (reworks.length > 0) { out.rework.push(reworks.reduce((a, b) => a + b, 0)); out.reworks += 1; }
  }
  return out;
}

/** The programme's own history and the fleet's (every programme's samples and counts pooled), as of `asOf`. */
export function leadHistoryFrom(runs: readonly LeadRun[], program: string, asOf: number): ForecastHistory {
  const byProgram = new Map<string, LeadRun[]>();
  for (const r of runs) { const l = byProgram.get(r.program) ?? []; l.push(r); byProgram.set(r.program, l); }
  const empty: LeadHistory = { done: [], abandoned: [], rework: [], waves: 0, abandons: 0, reworks: 0, leadsUnmeasured: 0 };
  let own = empty;
  const fleet = { done: [] as number[], abandoned: [] as number[], rework: [] as number[], waves: 0, abandons: 0, reworks: 0, leadsUnmeasured: 0 };
  for (const [slug, list] of [...byProgram].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const h = programmeLeads(list, asOf);
    if (slug === program) own = h;
    fleet.done.push(...h.done); fleet.abandoned.push(...h.abandoned); fleet.rework.push(...h.rework);
    fleet.waves += h.waves; fleet.abandons += h.abandons; fleet.reworks += h.reworks; fleet.leadsUnmeasured += h.leadsUnmeasured;
  }
  return { own, fleet };
}

/** A closed work run with no seal yet, paired with its statement (`programmeFactsStore.ts#unsealedClosesOf`): the newest
 *  one naming the run (`named`), else the newest standing `SEAL_WAIT_MINUTES` after the close, else null. */
export interface UnsealedClose {
  readonly runId: number; readonly program: string; readonly closedAt: number;
  readonly statement: { readonly id: number; readonly at: number; readonly lo: number; readonly hi: number } | null;
  readonly named: boolean;
}
export type SealBoundary =
  | { readonly kind: 'wait' }
  | { readonly kind: 'seal'; readonly asOf: number; readonly statementId: number | null; readonly remaining: RemainingRange | null };

/** Question 4, first match: a statement names the close: seal now, as of the later of the close and the statement; else,
 *  before `SEAL_WAIT_MINUTES` after the close: wait; else seal with the statement then standing, or none. A seal is
 *  computed as of its boundary, never as of the pass, so a late seal is the seal it would have been on time (F19). */
export function sealBoundary(c: UnsealedClose, now: number): SealBoundary {
  if (!c.named && now - c.closedAt < SEAL_WAIT_MINUTES * MINUTE_MS) return { kind: 'wait' };
  const s = c.statement;
  return { kind: 'seal', asOf: s === null ? c.closedAt : Math.max(c.closedAt, s.at), statementId: s?.id ?? null,
    remaining: s === null ? null : { lo: s.lo, hi: s.hi } };
}
