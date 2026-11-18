// L4 delivery, context Coordination (C5): the forecast lane (Overlord W2 forecasts A; spec §5.6 H38, Table 11.1d row "The
// forecast lane"; plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-forecasts-health.md, Task 4). One pass, every
// 60 s on the monotonic clock (`laneSchedule.ts`, row `forecasts`):
//   1. the SEAL arm: for each closed work run with no seal (`unsealedClosesOf`), `forecast.ts#sealBoundary` says wait or
//      seal; to seal, it draws a seed from the `Entropy` port, reads the lead history as of the boundary, asks
//      `forecastProgramme` and writes the answer (`sealForecast`);
//   2. the SCORE arm: for each open seal whose 85% date has passed, it reads the measured closes since its boundary, asks
//      `forecastOutcome` and writes `met` or `missed` (`scoreForecast`).
//   3. the SPEND arm (forecasts B): while the usage sweep has not completed a pass in this process it does nothing (the
//      boot guard); then, for each run closed since its first pass (or since the newest `run_spend` row, whichever is
//      earlier) with no row, `programmeMeasures.ts#runSpendVerdict` judges the session's reading and `recordRunSpend`
//      writes it;
//   4. the HEALTH arm (forecasts B): for each listed programme, `programmeHealth` over the portfolio's facts, a row on a
//      change, and a record-only notice when the word is worse (at most one per programme and word a day).
// It DECIDES NOTHING: every verdict is an L1 decider's. It is the only caller of the writers of `programme_forecasts`,
// `run_spend` and `programme_health` (`single-definition/writers-map.test.ts`). It sends no mail and pushes nothing. A
// throw on one close, seal, run or programme is caught and recorded on the pass record, and the pass goes on.
import type { Entropy } from '../time/ports.js';
import type { SessionUsage } from '../../../shared/api.js';
import type { SealedForecast } from '../../../shared/programmeFacts.js';
import {
  forecastOutcome, forecastProgramme, sealBoundary, type ForecastHistory, type OutcomeFacts, type UnsealedClose,
} from './forecast.js';
import type { NewRunSpend, NewSeal, UnspentClose } from './programmeFactsStore.js';
import { runSpendVerdict, type SpendReading } from './programmeMeasures.js';
import { EDGE_CLEARING_SHIPPED, type HealthRow, type HealthVerdict } from '../../../shared/programmeFacts.js';
import type { PortfolioFacts } from '../../../shared/portfolio.js';
import type { LiveAskRead } from './ports.js';
import type { SpendUsageRead } from './portfolioStore.js';
import { portfolioFor } from './portfolio.js';
import { healthChangeVerdict, healthExtrasFrom, healthFactsOf, programmeHealth } from './programmeHealth.js';

/** What the lane reads and writes, declared here by its consumer. `CoordStore` serves it with its delegates of the same
 *  names (`programmeFactsStore.ts`). A read that throws is caught by the pass, per close or per seal. */
export interface ForecastLanePort {
  unsealedClosesOf(now: number): { closes: UnsealedClose[]; missed: number };
  leadHistoryOf(program: string, asOf: number): ForecastHistory;
  sealForecast(seal: NewSeal, now: number): { written: boolean };
  forecastsOf(q: { dueBy: number }): SealedForecast[];
  outcomeFactsOf(sealId: number): OutcomeFacts | null;
  scoreForecast(id: number, outcome: 'met' | 'missed', now: number): { written: boolean };
  unspentClosesOf(firstPassAt: number): UnspentClose[];
  recordRunSpend(row: NewRunSpend, now: number): { written: boolean };
  portfolioFacts(now: number, liveAsk: LiveAskRead, usage: SpendUsageRead): PortfolioFacts;
  appendHealth(program: string, verdict: HealthVerdict, noticed: boolean, now: number): { id: number };
  healthNoticedSince(program: string, word: string, since: number): boolean;
}

/** The usage sweep's readings, declared here by their consumer and served by `FleetWatcher#currentUsage`: `ready` is
 *  false until the sweep has completed one pass in this process, so a restart never records a permanent `absent`
 *  (the boot guard); `reading` is a session's newest reading, or null when it has none. */
export interface UsageRead {
  ready(): boolean;
  reading(sessionId: string): SpendReading | null;
}

/** The watcher's two maps shaped into one reading: the usage sweep's `SessionUsage` (its `ts` in epoch seconds) and the
 *  conversation pair it was read beside. Null when the session has no reading. Shapes; judges nothing. */
export function spendReadingOf(
  usage: Pick<SessionUsage, 'ts' | 'cost' | 'class' | 'stale'> | undefined,
  conversation: { sidecar: string | null; registry: string } | undefined,
): SpendReading | null {
  if (usage === undefined) return null;
  return { readAt: usage.ts * 1000, cost: usage.cost, class: usage.class, stale: usage.stale,
    sidecarUuid: conversation?.sidecar ?? null, conversationUuid: conversation?.registry ?? null };
}

/** What the spend and health arms need beyond the store, from the watcher. `spendSince` is when the spend arm first ran
 *  with the usage sweep ready in this process. Absent: those arms do not run. */
export interface ForecastLive {
  readonly usage: UsageRead;
  readonly spendSince: number;
  /** The health arm's reads, the same ports the portfolio door hands its facts read. */
  readonly liveAsk: LiveAskRead;
  readonly liveSpend: SpendUsageRead;
  /** Records one record-only feed notice for a worse word; never pushes. */
  readonly notice: (program: string, verdict: HealthVerdict) => void;
}

/** One pass's record: seals written, closes still waiting for their statement, seals scored, closes missed in a gap
 *  (never sealed), and each failure as `<programme>: <message>`. */
export interface ForecastPass {
  readonly sealed: number; readonly waiting: number; readonly scored: number; readonly missed: number;
  readonly failed: readonly string[];
  /** `run_spend` rows written; `spendWaiting` is true while the boot guard holds the arm. */
  readonly spent: number; readonly spendWaiting: boolean;
  /** `programme_health` rows appended, and the record-only notices recorded with them. */
  readonly healthChanged: number; readonly notices: number;
}

const SEED_BOUND = 2 ** 32;
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function runForecastLane(
  port: ForecastLanePort, now: number, entropy: Pick<Entropy, 'below'>, live?: ForecastLive,
): ForecastPass {
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
  const spend = live === undefined ? { spent: 0, spendWaiting: false } : spendArm(port, live, now, failed);
  const health = live === undefined ? { healthChanged: 0, notices: 0 } : healthArm(port, live, now, failed);
  return { sealed, waiting, scored, missed, failed, ...spend, ...health };
}

const NOTICE_SPAN_MS = 24 * 3_600_000;

/** One health word per listed programme, over the portfolio's own facts and entry (question 7: computed here alone); a row
 *  when the word changed, and a notice when it is worse (`healthChangeVerdict`). */
function healthArm(port: ForecastLanePort, live: ForecastLive, now: number, failed: string[]): { healthChanged: number; notices: number } {
  let healthChanged = 0, notices = 0;
  let facts: PortfolioFacts;
  try { facts = port.portfolioFacts(now, live.liveAsk, live.liveSpend); } catch (err) {
    failed.push(`health: ${message(err)}`);
    return { healthChanged, notices };
  }
  const prevOf = new Map<string, HealthRow>((facts.w2?.health ?? []).map((h) => [h.program, h] as const));
  for (const entry of portfolioFor(facts, now).programmes) {
    try {
      const verdict = programmeHealth(healthFactsOf(entry, healthExtrasFrom(facts, entry.slug, now, EDGE_CLEARING_SHIPPED), now), now);
      const change = healthChangeVerdict(prevOf.get(entry.slug) ?? null, verdict.word,
        port.healthNoticedSince(entry.slug, verdict.word, now - NOTICE_SPAN_MS));
      if (!change.append) continue;
      port.appendHealth(entry.slug, verdict, change.notice, now);
      healthChanged += 1;
      if (change.notice) { live.notice(entry.slug, verdict); notices += 1; }
    } catch (err) {
      failed.push(`${entry.slug}: ${message(err)}`);
    }
  }
  return { healthChanged, notices };
}

function spendArm(port: ForecastLanePort, live: ForecastLive, now: number, failed: string[]): { spent: number; spendWaiting: boolean } {
  if (!live.usage.ready()) return { spent: 0, spendWaiting: true };
  let spent = 0;
  for (const c of port.unspentClosesOf(live.spendSince)) {
    try {
      const reading = c.sessionId === null ? null : live.usage.reading(c.sessionId);
      const row = runSpendVerdict(c, reading);
      if (port.recordRunSpend({ runId: c.runId, ...row }, now).written) spent += 1;
    } catch (err) {
      failed.push(`run ${c.runId}: ${message(err)}`);
    }
  }
  return { spent, spendWaiting: false };
}
