// Overlord W1, portfolio (spec 2026-11-09 §5.6, H38; plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-portfolio.md):
// the operator's order between programmes and the wire the portfolio read answers. Ring: L0, context Coordination. The
// server's decider (`server/src/coord/portfolio.ts`), its store (`portfolioStore.ts`) and the console read this one file, so
// it imports only types from `./api.js`, never `node:*` and nothing outside `shared/`.
//
// The ORDER is the operator's fact: only the rank door writes a rank row (`portfolioStore.ts#setPortfolioRank`). Every
// MEASURE is the server's, computed at read time by `portfolioFor` and never stored. A measure with no data is `null` with
// `n: 0`, never 0, and what the read could not judge is counted (`cycleUnmeasured`, `itemsUnmeasured`, `asksUnmeasured`).
import type { RunKind } from './api.js';

/** Table 5.6a's classes of service, in band order: the rank orders by class first, then by position inside the class. */
export type ServiceClass = 'expedite' | 'fixed-date' | 'standard' | 'background';
const SERVICE_CLASS_MAP: Record<ServiceClass, true> = { expedite: true, 'fixed-date': true, standard: true, background: true };
/** Derived from the map, in its key order, which is the band order. */
export const SERVICE_CLASSES = Object.keys(SERVICE_CLASS_MAP) as readonly ServiceClass[];
export const isServiceClass = (v: unknown): v is ServiceClass =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(SERVICE_CLASS_MAP, v);
/** The class an unranked programme reads as: the bottom of `standard` (§5.6). */
export const UNRANKED_CLASS: ServiceClass = 'standard';

/** The portfolio's window: endings, waits and the listing of ranked programmes with no open run all reach back this far. */
export const PORTFOLIO_WINDOW_DAYS = 28;
/** The most entries one rank write may carry, in `seen` and in `order` each. */
export const RANK_ORDER_MAX = 200;

/** One stored rank row. `cls` is read through `isServiceClass`; a word it refuses arrives as `null`, with `clsRaw` kept. */
export interface RankRow {
  program: string; position: number; cls: ServiceClass | null; clsRaw: string;
  fixedDate: string | null; setAt: number; setBy: string;
}
export interface PortfolioProgramme { slug: string; title: string; createdAt: number }
export interface PortfolioRun {
  id: number; program: string; wave: number; kind: RunKind; reviews: number | null;
  state: string; openedAt: number; dispatchedAt: number | null; closedAt: number | null; closeDetail: string | null;
}
/** One operator item with its moves, `events` oldest first. */
export interface PortfolioItem {
  id: number; program: string; title: string; neededBy: string; state: string;
  raisedAt: number; heldUntil: number | null; tickedAt: number | null; closedAt: number | null;
  events: readonly { at: number; act: string }[];
}
/** `live`: the facts read's verdict from the live-ask port, for a `released` or `declined` row that is its child's newest;
 *  `null` for every other row. */
export interface PortfolioAsk {
  id: number; program: string; state: string; releasedAt: number | null;
  answeredAt: number | null; answeredBy: string | null; live: boolean | 'unmeasured' | null;
}
/** What the facts read hands `portfolioFor`. `revision` is 0 when the rank was never written. */
export interface PortfolioFacts {
  programmes: readonly PortfolioProgramme[]; ranks: readonly RankRow[]; revision: number;
  runs: readonly PortfolioRun[]; items: readonly PortfolioItem[]; asks: readonly PortfolioAsk[];
}
/** A duration series: `n` samples, and null for both figures when `n` is 0, never 0. */
export interface Measure { n: number; medianMs: number | null; p85Ms: number | null }
export interface PortfolioEntry {
  /** `title` is session-written: render it as untrusted data. */
  slug: string; title: string;
  /** Null: unranked. */
  rank: { position: number; cls: ServiceClass; fixedDate: string | null } | null;
  /** The effective class: the rank's, or `standard` when unranked. */
  cls: ServiceClass;
  /** A stored row whose class word this build does not know: read as unranked, and said so. */
  rankUnreadable?: true;
  wip: { working: number; waiting: number; queued: number };
  closedWaves: { days7: number; days28: number };
  /** Done waves, first dispatch to close. */
  cycle: Measure;
  /** Done waves with no `dispatchedAt` (a rebuilt database). */
  cycleUnmeasured: number;
  /** The oldest started, still open wave's age. Null only when no wave is `working` or `waiting`: `wip.queued` counts the
   *  waves that have no `dispatchedAt`. */
  oldestOpenMs: number | null;
  /** Review runs over done waves, both counts. */
  reviewRounds: { rounds: number; waves: number };
  ended28: { done: number; failed: number; neverStarted: number };
  /** Programme-time over the window: two items waiting at once count twice. */
  waitingOnOperatorMs28: number;
  /** Items whose events this build cannot fold. */
  itemsUnmeasured: number;
  /** Asks that reached the operator and whose end no live signal shows. */
  asksUnmeasured: number;
  blocking: { items: readonly { id: number; title: string }[]; asks: number };
}
export interface PortfolioView { at: number; revision: number; programmes: readonly PortfolioEntry[] }

/** One entry of a rank write's `order`: `fixedDate` (`YYYY-MM-DD`) is carried on `fixed-date` alone. */
export interface RankOrderEntry { slug: string; cls: ServiceClass; fixedDate: string | null }
/** A rank write: `seen` is the slugs the console listed at `basedOn`, `order` its new order of some of them. */
export interface RankWrite { basedOn: number; seen: readonly string[]; order: readonly RankOrderEntry[] }
