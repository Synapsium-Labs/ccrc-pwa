// Overlord W1, portfolio (spec 2026-11-09 §5.6, H38; plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-portfolio.md,
// Task 1). Ring: L1, context Coordination (C5). PURE: no `fs`, no store, no clock; `now` is the caller's. It imports `shared/`
// and `../perf/stats.ts` (K) only.
//
// `portfolioOrder` is the operator's order read back: the classes in Table 5.6a's band order, then the position inside each
// band, with an unranked programme at the end of `standard` (oldest `createdAt` first, then slug). `portfolioFor` answers,
// per listed programme in that order, what W1's rows can measure. It stores nothing: every measure is computed at each read.
//
// HONESTY RULES (Review Focus 2): a measure with no data is `null` with `n: 0`, never 0; a done wave with no dispatch is
// counted in `cycleUnmeasured`; an item whose events this build cannot fold is counted in `itemsUnmeasured`; an ask that
// reached the operator and whose end no live signal shows is counted in `asksUnmeasured`, never as an ever-growing wait.
import { ASK_OPERATOR_PRINCIPAL } from '../../../shared/api.js';
import { ITEM_TRANSITIONS, isItemNonMove, operatorShownAt, type ItemAct } from '../../../shared/ledgers.js';
import {
  PORTFOLIO_WINDOW_DAYS, SERVICE_CLASSES, UNRANKED_CLASS,
  type Measure, type PortfolioAsk, type PortfolioEntry, type PortfolioFacts, type PortfolioItem, type PortfolioProgramme,
  type PortfolioRun, type PortfolioView, type RankRow, type ServiceClass,
} from '../../../shared/portfolio.js';
import { NEVER_STARTED_DETAIL } from '../../../shared/programmes.js';
import { percentile } from '../perf/stats.js';
import {
  doneCycles, earliestDispatch, isOpenRun, rebuiltWave, runSpendVerdict, waveSpend, wavesOf, type Wave,
} from './programmeMeasures.js';
import { EDGE_CLEARING_SHIPPED, type ProgrammeEdge, type RunSpendRow, type SealedForecast } from '../../../shared/programmeFacts.js';
import type { PortfolioW2Facts } from '../../../shared/portfolio.js';
import { forecastCalibration, type ScoredSeal } from './forecast.js';
import { blockingEdgesOf, criticalPath, shownItemIdsOf } from './programmeHealth.js';

const DAY_MS = 24 * 3_600_000;
const WINDOW_MS = PORTFOLIO_WINDOW_DAYS * DAY_MS;
const WEEK_MS = 7 * DAY_MS;

/** The rank row a programme reads by, when its class word is one this build knows. */
function readableRank(row: RankRow | undefined): (RankRow & { cls: ServiceClass }) | null {
  return row !== undefined && row.cls !== null ? (row as RankRow & { cls: ServiceClass }) : null;
}

/** Classes in band order, the position inside a band; unranked at the end of `standard`, by createdAt then slug. Rank rows
 *  for programmes not in `programmes` are ignored, and a row whose class word is unreadable reads as unranked. */
export function portfolioOrder(ranks: readonly RankRow[], programmes: readonly PortfolioProgramme[]): readonly string[] {
  const rankOf = new Map(ranks.map((r) => [r.program, r] as const));
  const out: string[] = [];
  for (const cls of SERVICE_CLASSES) {
    const ranked = programmes
      .map((p) => ({ p, r: readableRank(rankOf.get(p.slug)) }))
      .filter((x): x is { p: PortfolioProgramme; r: RankRow & { cls: ServiceClass } } => x.r !== null && x.r.cls === cls)
      .sort((a, b) => a.r.position - b.r.position || cmp(a.p.slug, b.p.slug));
    out.push(...ranked.map((x) => x.p.slug));
    if (cls !== UNRANKED_CLASS) continue;
    const unranked = programmes
      .filter((p) => readableRank(rankOf.get(p.slug)) === null)
      .sort((a, b) => a.createdAt - b.createdAt || cmp(a.slug, b.slug));
    out.push(...unranked.map((p) => p.slug));
  }
  return out;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The length of `[a, b]` inside `[from, to]`, never negative. */
const clipped = (a: number, b: number, from: number, to: number): number => Math.max(0, Math.min(b, to) - Math.max(a, from));

const isItemAct = (act: string): act is ItemAct => Object.prototype.hasOwnProperty.call(ITEM_TRANSITIONS, act);

/** The item's operator wait inside [from, to]: its `open` spans from its events, after `operatorShownAt`; or 'unmeasured'
 *  when an event's act is not an `ItemAct`, `raise`, `block` or `unblock`. The item is `open` from its `raisedAt`; each move
 *  goes to `ITEM_TRANSITIONS`' target, so a tick ends a span, a return starts one and a close ends it. The coordinator's
 *  `checking` time is never the operator's. An item still open at `to` waits up to `to`. */
export function itemWaitMs(item: PortfolioItem, from: number, to: number): number | 'unmeasured' {
  for (const e of item.events) if (!isItemAct(e.act) && !isItemNonMove(e.act)) return 'unmeasured';
  const shownAt = operatorShownAt(item);
  if (shownAt === null) return 0;
  const lo = Math.max(from, shownAt);
  let total = 0;
  let openSince: number | null = item.raisedAt;
  for (const e of item.events) {
    if (!isItemAct(e.act)) continue;
    const toOpen = ITEM_TRANSITIONS[e.act].to === 'open';
    if (openSince !== null && !toOpen) { total += clipped(openSince, e.at, lo, to); openSince = null; }
    else if (openSince === null && toOpen) openSince = e.at;
  }
  if (openSince !== null) total += clipped(openSince, to, lo, to);
  return total;
}

/** One ask's operator wait inside [from, to], or 'unmeasured'; null when it never waited on the operator in the window
 *  (question 10). */
function askWaitMs(a: PortfolioAsk, from: number, to: number): number | 'unmeasured' | null {
  // A stale ask is not counted at all: most went stale before any push, and staleAsk overwrites `releasedAt`.
  if (a.state === 'stale' || a.releasedAt === null) return null;
  if (a.state === 'answered') {
    if (a.answeredBy !== ASK_OPERATOR_PRINCIPAL) return null;
    return a.answeredAt === null ? 'unmeasured' : clipped(a.releasedAt, a.answeredAt, from, to);
  }
  if (a.state === 'released' || a.state === 'declined') {
    if (a.live === true) return clipped(a.releasedAt, to, from, to);
    // asks-unmeasured-is-windowed: released before the window and shown not live, it is outside "the last 28 days".
    // A live signal that is itself unmeasured cannot say so, and the ask still counts.
    if (a.live !== 'unmeasured' && a.releasedAt < from) return null;
    return 'unmeasured';
  }
  // answering-or-unknown-ask-is-unmeasured: an `answering` ask (the operator is mid-answer) or a state word this build does
  // not know reached the operator, and no signal shows its end.
  return 'unmeasured';
}

const measureOf = (series: readonly number[]): Measure =>
  series.length === 0 ? { n: 0, medianMs: null, p85Ms: null }
    : { n: series.length, medianMs: percentile(series, 50), p85Ms: percentile(series, 85) };


/** Question 7: a programme with an open run of any kind, and a ranked programme that closed a run in the window. */
function listed(p: PortfolioProgramme, runs: readonly PortfolioRun[], ranked: boolean, now: number): boolean {
  if (runs.some(isOpenRun)) return true;
  return ranked && runs.some((r) => r.closedAt !== null && r.closedAt >= now - WINDOW_MS);
}

function entryOf(
  p: PortfolioProgramme, rank: RankRow | undefined, runs: readonly PortfolioRun[], items: readonly PortfolioItem[],
  asks: readonly PortfolioAsk[], now: number,
): PortfolioEntry {
  const from = now - WINDOW_MS;
  const waves = wavesOf(runs);
  const done = waves.filter((w) => w.bucket === 'done');
  const closedSince = (w: Wave, t: number): boolean => w.rep.closedAt !== null && w.rep.closedAt >= t;
  const ended = waves.filter((w) => (w.bucket === 'done' || w.bucket === 'failed') && closedSince(w, from));

  const { cycles, unmeasured: cycleUnmeasured } = doneCycles(done);

  const open = waves.filter((w) => w.bucket === 'working' || w.bucket === 'waiting');
  const started = open.filter((w) => !rebuiltWave(w)).map(earliestDispatch).filter((d): d is number => d !== null);

  const doneRunIds = new Set(done.flatMap((w) => w.runs.map((r) => r.id)));
  const rounds = runs.filter((r) => r.kind === 'review' && r.reviews !== null && doneRunIds.has(r.reviews)).length;

  let waiting = 0, itemsUnmeasured = 0, asksUnmeasured = 0;
  for (const i of items) {
    const w = itemWaitMs(i, from, now);
    if (w === 'unmeasured') itemsUnmeasured += 1; else waiting += w;
  }
  for (const a of asks) {
    const w = askWaitMs(a, from, now);
    if (w === 'unmeasured') asksUnmeasured += 1; else if (w !== null) waiting += w;
  }

  const readable = readableRank(rank);
  const blockingItems = items.filter((i) => {
    if (i.state !== 'open' || i.neededBy !== 'blocking') return false;
    const shownAt = operatorShownAt(i);
    return shownAt !== null && shownAt <= now;
  }).map((i) => ({ id: i.id, title: i.title }));

  return {
    slug: p.slug,
    title: p.title,
    rank: readable === null ? null : { position: readable.position, cls: readable.cls, fixedDate: readable.fixedDate },
    cls: readable === null ? UNRANKED_CLASS : readable.cls,
    ...(rank !== undefined && readable === null ? { rankUnreadable: true as const } : {}),
    wip: {
      working: waves.filter((w) => w.bucket === 'working').length,
      waiting: waves.filter((w) => w.bucket === 'waiting').length,
      queued: waves.filter((w) => w.bucket === 'queued').length,
    },
    closedWaves: {
      days7: waves.filter((w) => (w.bucket === 'done' || w.bucket === 'failed') && closedSince(w, now - WEEK_MS)).length,
      days28: ended.length,
    },
    cycle: measureOf(cycles),
    cycleUnmeasured,
    oldestOpenMs: started.length === 0 ? null : Math.max(0, now - Math.min(...started)),
    oldestOpenUnmeasured: open.filter(rebuiltWave).length,
    reviewRounds: { rounds, waves: done.length },
    ended28: {
      done: ended.filter((w) => w.bucket === 'done').length,
      failed: ended.filter((w) => w.bucket === 'failed').length,
      neverStarted: ended.filter((w) => w.bucket === 'failed' && w.rep.closeDetail === NEVER_STARTED_DETAIL).length,
    },
    waitingOnOperatorMs28: waiting,
    itemsUnmeasured,
    asksUnmeasured,
    blocking: { items: blockingItems, asks: asks.filter((a) => a.live === true).length },
  };
}

// ── W2's measures (forecasts B, plan w2-forecasts-health.md Task 8) ─────────────────────────────────────────────────
// Shown, never computed here: the health word is the newest row the forecast lane recorded (`programmeHealth` runs only
// there, question 7, F7), and the dates are the newest seal's (no Monte Carlo at a read). Computed at each read: the
// edges listed, the spend roll-up, the critical path and the fleet's calibration.

/** The entry's newest seal: an open unforecastable seal is its own reading, never "pending" (review 2414 F9). */
function forecastEntry(seal: SealedForecast | undefined): PortfolioEntry['forecast'] {
  if (seal === undefined) return undefined;
  const f = seal.forecast;
  if (f === 'unreadable') return { kind: 'unreadable', sealedAt: seal.sealedAt };
  if (f.kind === 'unforecastable') return { kind: 'unforecastable', reason: f.reason, sealedAt: seal.sealedAt };
  return { kind: 'forecast', medianAt: f.medianAt, p85At: f.p85At, n: f.n, source: f.source, sealedAt: seal.sealedAt, outcome: seal.outcome };
}

const SPEND_KINDS: readonly string[] = ['work', 'review'];

/** The index's question 22 over one programme (question 10, ruled): measured `run_spend` rows, plus each open run's live
 *  reading judged as the spend arm judges a closed run, by `runSpendVerdict` as of now (fix round 1, F1: the window, the
 *  session's turns, a later dispatch, the dispatch conversation and the `/clear`), once per session. A run never dispatched
 *  has spent nothing and is skipped. A closed run with no measured row, a dispatched open run with no session, and an open
 *  run whose reading is not `measured` count in `runsUnmeasured`, never as 0. `total` is null when nothing was measured
 *  (F4), never 0. */
function spendEntry(runs: readonly PortfolioRun[], waves: readonly Wave[], w2: PortfolioW2Facts, now: number): NonNullable<PortfolioEntry['spend']> {
  const ids = new Set(runs.map((r) => r.id));
  const rows = new Map<number, RunSpendRow>(w2.spend.filter((r) => ids.has(r.runId)).map((r) => [r.runId, r] as const));
  const byClass: Record<string, number> = {};
  let total: number | null = null, runsUnmeasured = 0;
  const add = (cls: string | null, cost: number): void => { total = (total ?? 0) + cost; const k = cls ?? 'unknown'; byClass[k] = (byClass[k] ?? 0) + cost; };
  for (const r of runs) {
    if (!SPEND_KINDS.includes(r.kind) || isOpenRun(r)) continue;
    const row = rows.get(r.id);
    if (row !== undefined && row.state === 'measured' && row.cost !== null) add(row.class, row.cost); else runsUnmeasured += 1;
  }
  const counted = new Set<string>();
  const live = new Map(w2.live.map((l) => [l.runId, l] as const));
  for (const r of runs) {
    if (!SPEND_KINDS.includes(r.kind) || !isOpenRun(r) || r.dispatchedAt === null) continue;
    const l = live.get(r.id);
    const reading = l?.reading.kind === 'reading' ? l.reading : null;
    const v = l === undefined ? null : runSpendVerdict({ sessionId: l.sessionId, dispatchedAt: r.dispatchedAt, closedAt: now,
      redispatched: l.redispatched, resumed: l.resumed, clearedAt: l.clearedAt, conversation: l.conversation }, reading);
    if (l === undefined || v === null || v.state !== 'measured' || v.cost === null) { runsUnmeasured += 1; continue; }
    if (counted.has(l.sessionId)) continue;
    counted.add(l.sessionId);
    add(v.class, v.cost);
  }
  const perWave = waveSpend(waves, runs, rows, now - WINDOW_MS, now);
  return { total, byClass, perWaveMedian: perWave.medianPerWave, wavesMeasured: perWave.measured, wavesUnmeasured: perWave.unmeasured,
    runsUnmeasured, attributed: true, coordinatorExcluded: true, classAtClose: true };
}

/** The W2 fields of one entry. `blocking` gains the count of open edges that block (fix round 1, F7), so
 *  `blocked-on-you` always has a cause in it; omitted while clearing is not shipped. */
function w2Entry(slug: string, runs: readonly PortfolioRun[], w2: PortfolioW2Facts, now: number,
  blocking: PortfolioEntry['blocking'], shown: ReadonlySet<number>): Partial<PortfolioEntry> {
  const health = w2.health.find((h) => h.program === slug);
  const seals = w2.seals.filter((x) => x.program === slug);
  const edgesBy = new Map<string, ProgrammeEdge[]>();
  for (const e of w2.edges) { const l = edgesBy.get(e.program) ?? []; l.push(e); edgesBy.set(e.program, l); }
  const runProgram = new Map(w2.edgeRuns.map((r) => [r.runId, r.program] as const));
  const dated = new Map(w2.newestDated.map((d) => [d.program, d.p85At] as const));
  const forecast = forecastEntry(seals[seals.length - 1]);
  const blockingEdges = blockingEdgesOf(edgesBy.get(slug) ?? [], shown, EDGE_CLEARING_SHIPPED);
  return {
    ...(blockingEdges === null ? {} : { blocking: { ...blocking, edges: blockingEdges } }),
    ...(health === undefined ? {} : { health: { word: health.word, evidence: health.evidence, at: health.at } }),
    ...(forecast === undefined ? {} : { forecast }),
    edges: { list: edgesBy.get(slug) ?? [], clearingShipped: EDGE_CLEARING_SHIPPED },
    spend: spendEntry(runs, wavesOf(runs), w2, now),
    criticalPath: criticalPath(slug, (p) => edgesBy.get(p) ?? [], (id) => runProgram.get(id) ?? null, (p) => dated.get(p) ?? null,
      EDGE_CLEARING_SHIPPED),
  };
}

/** The listed programmes (question 7) in `portfolioOrder`, each with W1's measures and, when the facts carry them, W2's;
 *  the view's calibration is the fleet's (M30). Pure; `now` is the caller's. */
export function portfolioFor(facts: PortfolioFacts, now: number): PortfolioView {
  const rankOf = new Map(facts.ranks.map((r) => [r.program, r] as const));
  const group = <T extends { program: string }>(xs: readonly T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const x of xs) { const l = m.get(x.program) ?? []; l.push(x); m.set(x.program, l); }
    return m;
  };
  const runsOf = group(facts.runs), itemsOf = group(facts.items), asksOf = group(facts.asks);
  const shown = facts.programmes.filter((p) => listed(p, runsOf.get(p.slug) ?? [], rankOf.has(p.slug), now));
  const bySlug = new Map(shown.map((p) => [p.slug, p] as const));
  const shownItems = facts.w2 === undefined ? new Set<number>() : shownItemIdsOf(facts.items, now);
  const programmes = portfolioOrder(facts.ranks, shown).map((slug) => {
    const p = bySlug.get(slug)!;
    const runs = runsOf.get(slug) ?? [];
    const entry = entryOf(p, rankOf.get(slug), runs, itemsOf.get(slug) ?? [], asksOf.get(slug) ?? [], now);
    return facts.w2 === undefined ? entry : { ...entry, ...w2Entry(slug, runs, facts.w2, now, entry.blocking, shownItems) };
  });
  if (facts.w2 === undefined) return { at: now, revision: facts.revision, programmes };
  const scored = facts.w2.scored.flatMap((x): ScoredSeal[] =>
    x.scoredAt !== null && (x.outcome === 'met' || x.outcome === 'missed') ? [{ scoredAt: x.scoredAt, outcome: x.outcome }] : []);
  return { at: now, revision: facts.revision, programmes, calibration: forecastCalibration(scored, now) };
}
