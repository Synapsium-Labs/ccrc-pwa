// Overlord W2, forecasts B (spec 2026-11-09 §5.6, H38; plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-forecasts-health.md,
// Task 6). Ring: L1, context Coordination (C5). PURE: no `fs`, no store, no clock and no `Math.random`; `now` is the
// caller's. It imports `shared/`, `./programmeMeasures.ts` (L1) and `../perf/stats.ts` (K) only, and `programmeMeasures.ts`
// never imports it.
//
// `healthFactsOf` reads a `portfolioFor` entry and the lane's extra facts into `HealthFacts`, `programmeHealth` decides the
// one word with its evidence (first match over §5.6's order), `criticalPath` follows a programme's open run-closed edges to
// the chain that lands last, and `healthChangeVerdict` decides whether a changed word is recorded and noticed. The health
// lane's arm is the only caller of the first two (question 7). `null` means "measured, and there is nothing" (no seal, no
// closed wave); `'unmeasured'` means "could not be measured": the two never fold into one another.
import {
  HEALTH_BURN_FACTOR, HEALTH_BURN_MIN_WAVES, HEALTH_CHURN_REOPENS, HEALTH_CHURN_ROUNDS, HEALTH_OWN_CYCLE_MIN,
  HEALTH_SCOPE_GROWTH_WAVES, HEALTH_SLIP_DAYS, HEALTH_STALLED_HOURS, HEALTH_WINDOW_DAYS, PROGRAMME_HEALTH_WORDS,
  type HealthEvidence, type HealthRow, type HealthVerdict, type ProgrammeEdge, type ProgrammeHealthWord, type RemainingStatement,
  type RunSpendRow, type SealedForecast,
} from '../../../shared/programmeFacts.js';
import { isCalendarDate, type PortfolioEntry, type PortfolioRun, type ServiceClass } from '../../../shared/portfolio.js';
import { closedIn, wavesOf, waveSpend, type Wave } from './programmeMeasures.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const UNMEASURED = 'unmeasured' as const;
export type Measured<T> = T | typeof UNMEASURED;

export interface HealthFacts {
  readonly blockingItems: number;
  readonly blockingAsks: number;
  readonly asksUnmeasured: number;
  /** Open needs-decision edges whose operator-confirms item is shown; null while clearing is not shipped. */
  readonly blockingEdges: number | null;
  readonly cls: ServiceClass;
  readonly fixedDate: string | null;
  /** Null: no seal, or the newest is unforecastable; 'unmeasured': the newest forecast is unreadable. */
  readonly newestP85At: Measured<number | null>;
  readonly previousP85At: Measured<number | null>;
  readonly newestScoredMissed: Measured<boolean | null>;
  readonly wip: number;
  readonly lastMoveAt: Measured<number | null>;
  readonly oldestOpenMs: number | null;
  readonly oldestOpenUnmeasured: number;
  readonly referenceCycleP85Ms: number | null;
  readonly roundsPerWave: number | null;
  readonly reworkedWaves: number;
  readonly scope: { oldestHi: number; newestHi: number; doneSince: number } | null;
  readonly spendRecent: Measured<number | null>;
  readonly spendEarlier: Measured<number | null>;
}

export interface HealthExtras {
  readonly runs: readonly PortfolioRun[];
  /** The programme's seals, oldest first (by id). */
  readonly seals: readonly SealedForecast[];
  readonly statements: readonly RemainingStatement[];
  /** The newest state change of an open work run, else that run's `openedAt`; null: no open work run. Never a statement. */
  readonly lastMoveAt: number | null;
  readonly fleetCycleP85Ms: number | null;
  readonly spend: ReadonlyMap<number, RunSpendRow>;
  readonly edges: readonly ProgrammeEdge[];
  readonly shownItemIds: ReadonlySet<number>;
  /** The caller passes `EDGE_CLEARING_SHIPPED`; an argument so both branches are testable. */
  readonly clearingShipped: boolean;
}

/** A forecast's 85% date: null for an unforecastable seal, 'unmeasured' for one this build cannot read. */
const p85Of = (s: SealedForecast): Measured<number | null> =>
  s.forecast === 'unreadable' ? UNMEASURED : s.forecast.kind === 'forecast' ? s.forecast.p85At : null;

/** The first scored seal, newest first: `open` seals are skipped (an unforecastable seal stays `open` for ever). */
function newestScoredMissed(seals: readonly SealedForecast[]): Measured<boolean | null> {
  for (let i = seals.length - 1; i >= 0; i--) {
    const s = seals[i]!;
    if (s.outcome === 'open') continue;
    return s.outcome === 'unreadable' ? UNMEASURED : s.outcome === 'missed';
  }
  return null;
}

/** A window's median spend per wave: from `HEALTH_BURN_MIN_WAVES` measured waves; else 'unmeasured' when a wave could not be
 *  measured, else null. */
function spendIn(waves: readonly Wave[], x: HealthExtras, from: number, to: number): Measured<number | null> {
  const s = waveSpend(waves, x.runs, x.spend, from, to);
  if (s.measured >= HEALTH_BURN_MIN_WAVES) return s.medianPerWave;
  return s.unmeasured > 0 ? UNMEASURED : null;
}

export function healthFactsOf(entry: PortfolioEntry, x: HealthExtras, now: number): HealthFacts {
  const window = HEALTH_WINDOW_DAYS * DAY_MS;
  const waves = wavesOf(x.runs);
  const closed = waves.filter((w) => closedIn(w, now - window, now));
  const closedIds = new Set(closed.flatMap((w) => w.runs.map((r) => r.id)));
  const rounds = x.runs.filter((r) => r.kind === 'review' && r.reviews !== null && closedIds.has(r.reviews)).length;

  const inWindow = x.statements
    .filter((s) => s.at >= now - window && s.at <= now)
    .sort((a, b) => a.at - b.at || a.id - b.id);
  const oldest = inWindow[0], newest = inWindow[inWindow.length - 1];
  const scope = oldest === undefined || newest === undefined ? null : {
    oldestHi: oldest.hi, newestHi: newest.hi,
    doneSince: waves.filter((w) => w.bucket === 'done' && w.rep.closedAt !== null && w.rep.closedAt > oldest.at && w.rep.closedAt <= newest.at).length,
  };

  return {
    blockingItems: entry.blocking.items.length,
    blockingAsks: entry.blocking.asks,
    asksUnmeasured: entry.asksUnmeasured,
    blockingEdges: !x.clearingShipped ? null : x.edges.filter((e) =>
      e.state === 'open' && e.kind === 'needs-decision' && e.target?.predicate === 'operator-confirms' && x.shownItemIds.has(e.target.itemId)).length,
    cls: entry.cls,
    fixedDate: entry.rank?.fixedDate ?? null,
    newestP85At: x.seals.length === 0 ? null : p85Of(x.seals[x.seals.length - 1]!),
    previousP85At: x.seals.length < 2 ? null : p85Of(x.seals[x.seals.length - 2]!),
    newestScoredMissed: newestScoredMissed(x.seals),
    wip: entry.wip.working + entry.wip.waiting,
    lastMoveAt: x.lastMoveAt,
    oldestOpenMs: entry.oldestOpenMs,
    oldestOpenUnmeasured: entry.oldestOpenUnmeasured ?? 0,
    referenceCycleP85Ms: entry.cycle.n >= HEALTH_OWN_CYCLE_MIN ? entry.cycle.p85Ms : x.fleetCycleP85Ms,
    roundsPerWave: closed.length === 0 ? null : rounds / closed.length,
    reworkedWaves: closed.filter((w) => w.runs.length >= 2).length,
    scope,
    spendRecent: spendIn(waves, x, now - window, now),
    spendEarlier: spendIn(waves, x, now - 2 * window, now - window - 1),
  };
}

// ── programmeHealth ─────────────────────────────────────────────────────────────────────────────────────────────────

type Val = number | string | boolean | null;
interface Arm {
  readonly name: string;
  /** The inputs the arm reads, by name: an 'unmeasured' one keeps the arm from matching and is named in the evidence. */
  readonly inputs: Readonly<Record<string, Val>>;
  readonly test: () => boolean;
}
interface Row { readonly word: ProgrammeHealthWord; readonly arms: readonly Arm[]; readonly unmatchedUnmeasured?: () => readonly string[] }

/** The end of a `YYYY-MM-DD` day in UTC, 23:59:59.999, by civil-date arithmetic; null for a date that is not one. */
function endOfDay(date: string | null): number | null {
  if (date === null || !isCalendarDate(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!, 23, 59, 59, 999);
}

const isNum = (v: unknown): v is number => typeof v === 'number';

/** §5.6's rows in order; each row is a disjunction of arms. */
function rowsOf(f: HealthFacts, now: number): readonly Row[] {
  const fixedEnd = endOfDay(f.fixedDate);
  return [
    { word: 'blocked-on-you', arms: [
      { name: 'items', inputs: { blockingItems: f.blockingItems }, test: () => f.blockingItems > 0 },
      { name: 'asks', inputs: { blockingAsks: f.blockingAsks }, test: () => f.blockingAsks > 0 },
      { name: 'edges', inputs: { blockingEdges: f.blockingEdges }, test: () => f.blockingEdges !== null && f.blockingEdges > 0 },
    ], unmatchedUnmeasured: () => (f.asksUnmeasured > 0 ? ['asks'] : []) },
    { word: 'slipping', arms: [
      { name: 'fixed-date', inputs: { newestP85At: f.newestP85At, fixedDate: f.fixedDate },
        test: () => f.cls === 'fixed-date' && fixedEnd !== null && isNum(f.newestP85At) && f.newestP85At > fixedEnd },
      { name: 'missed', inputs: { newestScoredMissed: f.newestScoredMissed }, test: () => f.newestScoredMissed === true },
      { name: 'moved', inputs: { newestP85At: f.newestP85At, previousP85At: f.previousP85At },
        test: () => isNum(f.newestP85At) && isNum(f.previousP85At) && (f.newestP85At - f.previousP85At) / DAY_MS >= HEALTH_SLIP_DAYS },
    ] },
    { word: 'stalled', arms: [
      { name: 'quiet', inputs: { wip: f.wip, lastMoveAt: f.lastMoveAt },
        test: () => f.wip > 0 && isNum(f.lastMoveAt) && now - f.lastMoveAt >= HEALTH_STALLED_HOURS * HOUR_MS },
    ] },
    { word: 'aging', arms: [
      { name: 'oldest', inputs: { oldestOpenMs: f.oldestOpenMs, referenceCycleP85Ms: f.referenceCycleP85Ms },
        test: () => f.oldestOpenMs !== null && f.referenceCycleP85Ms !== null && f.oldestOpenMs > f.referenceCycleP85Ms },
    ], unmatchedUnmeasured: () => (f.oldestOpenUnmeasured > 0 ? ['oldestOpen'] : []) },
    { word: 'churning', arms: [
      { name: 'rounds', inputs: { roundsPerWave: f.roundsPerWave }, test: () => f.roundsPerWave !== null && f.roundsPerWave > HEALTH_CHURN_ROUNDS },
      { name: 'reworked', inputs: { reworkedWaves: f.reworkedWaves }, test: () => f.reworkedWaves > HEALTH_CHURN_REOPENS },
    ] },
    { word: 'scope-growing', arms: [
      { name: 'grew', inputs: { oldestHi: f.scope?.oldestHi ?? null, newestHi: f.scope?.newestHi ?? null, doneSince: f.scope?.doneSince ?? null },
        test: () => f.scope !== null && f.scope.newestHi + f.scope.doneSince - f.scope.oldestHi >= HEALTH_SCOPE_GROWTH_WAVES },
    ] },
    { word: 'burning', arms: [
      { name: 'spend', inputs: { spendRecent: f.spendRecent, spendEarlier: f.spendEarlier },
        test: () => isNum(f.spendRecent) && isNum(f.spendEarlier) && f.spendRecent > 0 && f.spendRecent >= HEALTH_BURN_FACTOR * f.spendEarlier },
    ] },
    { word: 'steady', arms: [{ name: 'always', inputs: {}, test: () => true }] },
  ];
}

/** First match over §5.6's order. An arm matches only when every input it reads is measured; an unmeasured one never
 *  matches and its name joins `evidence.unmeasured`. Every row is evaluated, so the evidence names every unmeasured input
 *  of the facts, sorted and distinct, whichever row matched. */
export function programmeHealth(facts: HealthFacts, now: number): HealthVerdict {
  const unmeasured = new Set<string>();
  let found: { word: ProgrammeHealthWord; matched: string | null; values: Record<string, Val> } | null = null;
  for (const row of rowsOf(facts, now)) {
    let matched: Arm | null = null;
    for (const arm of row.arms) {
      const missing = Object.entries(arm.inputs).filter(([, v]) => v === UNMEASURED).map(([k]) => k);
      for (const k of missing) unmeasured.add(k);
      if (missing.length === 0 && matched === null && arm.test()) matched = arm;
    }
    if (matched === null) for (const k of row.unmatchedUnmeasured?.() ?? []) unmeasured.add(k);
    if (matched !== null && found === null) {
      found = row.word === 'steady'
        ? { word: row.word, matched: null, values: {} }
        : { word: row.word, matched: `${row.word}:${matched.name}`, values: { ...matched.inputs } };
    }
  }
  const evidence: HealthEvidence = { matched: found!.matched, values: found!.values, unmeasured: [...unmeasured].sort() };
  return { word: found!.word, evidence };
}

// ── criticalPath ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The most links a critical path follows from its programme. */
export const CRITICAL_PATH_DEPTH_MAX = 10;
/** The most chains one read explores: open edges are bounded per programme (`OPEN_EDGES_PER_PROGRAMME_MAX`), but branches
 *  multiply with depth, so the walk stops here and answers `cut`. */
export const CRITICAL_PATH_VISITS_MAX = 500;

/** The chain from `slug` that lands last (question 11): each open `needs-landed` edge whose target is a run of another
 *  programme (`run-closed`) is followed to that programme; a `pr-merged` target, a run no programme owns and a programme
 *  already on the chain are leaves. Nothing is followed while clearing is not shipped. Among branches the chain whose latest
 *  85% date is latest wins (a chain with no date is below any date), ties to the first branch in edge order. `cut` is true
 *  when a chain stopped at `CRITICAL_PATH_DEPTH_MAX` links with an edge left to follow, or the walk spent
 *  `CRITICAL_PATH_VISITS_MAX`. */
export function criticalPath(
  slug: string,
  edgesOf: (slug: string) => readonly ProgrammeEdge[],
  programOfRun: (runId: number) => string | null,
  sealOf: (slug: string) => number | null,
  clearingShipped: boolean,
): { chain: readonly string[]; latestP85At: number | null; unmeasured: readonly string[]; cut: boolean } {
  let best: { chain: string[]; latest: number | null } | null = null;
  let cut = false;
  let visits = 0;
  const consider = (chain: string[]): void => {
    const dates = chain.map(sealOf).filter(isNum);
    const latest = dates.length === 0 ? null : Math.max(...dates);
    if (best === null || (latest !== null && (best.latest === null || latest > best.latest))) best = { chain, latest };
  };
  const walk = (chain: string[]): void => {
    const here = chain[chain.length - 1]!;
    const next: string[] = [];
    if (clearingShipped) {
      for (const e of edgesOf(here)) {
        if (e.state !== 'open' || e.kind !== 'needs-landed' || e.target?.predicate !== 'run-closed') continue;
        const p = programOfRun(e.target.runId);
        if (p !== null && !chain.includes(p)) next.push(p);
      }
    }
    if (next.length === 0) { consider(chain); return; }
    if (chain.length - 1 >= CRITICAL_PATH_DEPTH_MAX) { cut = true; consider(chain); return; }
    for (const p of next) {
      if (visits >= CRITICAL_PATH_VISITS_MAX) { cut = true; consider(chain); return; }
      visits += 1;
      walk([...chain, p]);
    }
  };
  walk([slug]);
  const { chain, latest } = best!;
  return { chain, latestP85At: latest, unmeasured: chain.filter((p) => sealOf(p) === null), cut };
}

// ── healthChangeVerdict ─────────────────────────────────────────────────────────────────────────────────────────────

/** A changed word is appended; it is noticed only when it is worse than a readable previous one and no notice for this
 *  programme and word stands in the last 24 hours (`noticedSince`). A first row, a better word and an unreadable previous
 *  word never notice. */
export function healthChangeVerdict(prev: HealthRow | null, next: ProgrammeHealthWord, noticedSince: boolean): { append: boolean; notice: boolean } {
  if (prev !== null && prev.word === next) return { append: false, notice: false };
  const worse = prev !== null && prev.word !== 'unreadable' && PROGRAMME_HEALTH_WORDS.indexOf(next) < PROGRAMME_HEALTH_WORDS.indexOf(prev.word);
  return { append: true, notice: worse && !noticedSince };
}
