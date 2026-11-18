// L4 delivery, context Coordination (C5): the forecast lane (Overlord W2 forecasts A; spec §5.6 H38, Table 11.1d row "The
// forecast lane"; plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-forecasts-health.md, Task 4). One pass, every
// 60 s on the monotonic clock (`laneSchedule.ts`, row `forecasts`):
//   1. the SEAL arm: for each closed work run with no seal (`unsealedClosesOf`), `forecast.ts#sealBoundary` says wait or
//      seal; to seal, it draws a seed from the `Entropy` port, reads the lead history as of the boundary, asks
//      `forecastProgramme` and writes the answer (`sealForecast`);
//   2. the SCORE arm: for each open seal whose 85% date has passed, it reads the measured closes since its boundary, asks
//      `forecastOutcome` and writes `met` or `missed` (`scoreForecast`).
// It DECIDES NOTHING: every verdict is an L1 decider's. It is the only caller of the two writers of `programme_forecasts`
// (`single-definition/writers-map.test.ts`). It sends no mail and pushes nothing; what it seals, nothing serves yet (PR B's
// `portfolioFor` will). A throw on one close or one seal is caught and recorded on the pass record, and the pass goes on.
import type { Entropy } from '../time/ports.js';
import type { SealedForecast } from '../../../shared/programmeFacts.js';
import {
  forecastOutcome, forecastProgramme, sealBoundary, type ForecastHistory, type OutcomeFacts, type UnsealedClose,
} from './forecast.js';
import type { NewSeal } from './programmeFactsStore.js';

/** What the lane reads and writes, declared here by its consumer. `CoordStore` serves it with its delegates of the same
 *  names (`programmeFactsStore.ts`). A read that throws is caught by the pass, per close or per seal. */
export interface ForecastLanePort {
  unsealedClosesOf(now: number): { closes: UnsealedClose[]; missed: number };
  leadHistoryOf(program: string, asOf: number): ForecastHistory;
  sealForecast(seal: NewSeal, now: number): { written: boolean };
  forecastsOf(q: { dueBy: number }): SealedForecast[];
  outcomeFactsOf(sealId: number): OutcomeFacts | null;
  scoreForecast(id: number, outcome: 'met' | 'missed', now: number): { written: boolean };
}

/** One pass's record: seals written, closes still waiting for their statement, seals scored, closes missed in a gap
 *  (never sealed), and each failure as `<programme>: <message>`. */
export interface ForecastPass {
  readonly sealed: number; readonly waiting: number; readonly scored: number; readonly missed: number;
  readonly failed: readonly string[];
}

const SEED_BOUND = 2 ** 32;
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function runForecastLane(port: ForecastLanePort, now: number, entropy: Pick<Entropy, 'below'>): ForecastPass {
  let sealed = 0;
  let waiting = 0;
  let scored = 0;
  const failed: string[] = [];
  const { closes, missed } = port.unsealedClosesOf(now);
  for (const c of closes) {
    try {
      const b = sealBoundary(c, now);
      if (b.kind === 'wait') { waiting += 1; continue; }
      const seed = entropy.below(SEED_BOUND);
      const forecast = forecastProgramme(port.leadHistoryOf(c.program, b.asOf), b.remaining, seed, b.asOf);
      const w = port.sealForecast({ program: c.program, closingRunId: c.runId, asOf: b.asOf, statementId: b.statementId,
        lo: b.remaining?.lo ?? null, hi: b.remaining?.hi ?? null, forecast }, now);
      if (w.written) sealed += 1;
    } catch (err) {
      failed.push(`${c.program}: ${message(err)}`);
    }
  }
  for (const s of port.forecastsOf({ dueBy: now })) {
    try {
      const facts = port.outcomeFactsOf(s.id);
      if (facts === null) continue;
      const verdict = forecastOutcome(s, facts, now);
      if (verdict === 'none') continue;
      if (port.scoreForecast(s.id, verdict, now).written) scored += 1;
    } catch (err) {
      failed.push(`${s.program}: ${message(err)}`);
    }
  }
  return { sealed, waiting, scored, missed, failed };
}
