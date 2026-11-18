// Overlord W1, portfolio (spec 2026-11-09 §5.6, H38; plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-portfolio.md,
// Task 2). Ring: L3, context Coordination (C5). SQL only: every function is synchronous over the store's own database
// handle, and `CoordStore` keeps a one-line delegate for each. No repository and no async wrapper.
//
// ONE WRITER: `setPortfolioRank` is the only writer of `portfolio_rank` and `portfolio_rank_revision`
// (`single-definition/writers-map.test.ts` pins both, and that only `CoordStore`'s delegate and the rank door call it). A
// write MERGES (question 8, ruled): it deletes only the rows of slugs the console listed and dropped, and keeps every
// ranked row the console did not list. The revision only rises, so a tab holding an older one is refused `rank-changed`.
//
// THE FACTS READ keeps every distinction it reads: a class word `isServiceClass` refuses arrives as `cls: null` with its
// `clsRaw`; a run kind reads through `isRunKind`; the live-ask port's `unmeasured` stays `'unmeasured'`. A throw is not
// caught here: the read door answers it `runs-unreadable`. It takes no transaction, as `itemsFor` and `readProgrammes` do
// not: a pure read never takes the write lock (review 2130, F9).
import type { DatabaseSync } from 'node:sqlite';
import { isRunKind } from '../../../shared/api.js';
import { OPEN_ITEM_STATES } from '../../../shared/ledgers.js';
import { LEDGER_ROUTE_REFUSALS } from '../../../shared/refusal.js';
import {
  PORTFOLIO_WINDOW_DAYS, isServiceClass,
  type PortfolioAsk, type PortfolioFacts, type PortfolioItem, type PortfolioProgramme, type PortfolioRun, type RankRow, type RankWrite,
} from '../../../shared/portfolio.js';
import { isRebuiltRun } from '../../../shared/programmes.js';
import { CALIBRATION_CUT_STEP_DAYS, CALIBRATION_CUTS, CALIBRATION_WINDOW_DAYS, HEALTH_WINDOW_DAYS } from '../../../shared/programmeFacts.js';
import type { LiveSpendReading, PortfolioW2Facts } from '../../../shared/portfolio.js';
import type { LiveAskRead } from './ports.js';
import { forecastsOf, newestHealthOf, openEdgesOf, remainingSince, spendOf } from './programmeFactsStore.js';
import { tx } from './tx.js';
export type { LiveAskRead, PortfolioFacts, RankWrite };
/** The usage sweep's reading of a session for the spend read, declared by this read: `not-ready` before the sweep's
 *  first pass in this process, `none` when the session has no reading. The watcher's `currentUsage` serves it. */
export type SpendUsageRead = (sessionId: string) => LiveSpendReading;

/** `setPortfolioRank`'s answer: the new revision; or, having written nothing, `unknownSlug`, the first `order` slug no
 *  `programs` row names (the door's `not-found`), or `rank-changed` with the current revision. */
export type RankWriteResult =
  | { ok: true; revision: number }
  | { ok: false; unknownSlug: string }
  | { ok: false; why: typeof LEDGER_ROUTE_REFUSALS.rankChanged; revision: number };

interface RankRowRaw { program: string; position: number; cls: string; fixedDate: string | null; setAt: number; setBy: string }

const revisionOf = (db: DatabaseSync): number =>
  (db.prepare('SELECT revision FROM portfolio_rank_revision WHERE id = 1').get() as { revision: number } | undefined)?.revision ?? 0;

/** The operator's rank write, in one transaction: refuse an `order` slug no programme has, then a stale `basedOn`; else merge, renumber each class band from 1,
 *  and raise the revision. The listed entries come first in each band, in the given order, then the kept rows in their old
 *  order. Kept rows keep their class, date, `setAt` and `setBy`; only their position moves. */
export function setPortfolioRank(db: DatabaseSync, write: RankWrite, actor: string, now: number): RankWriteResult {
  return tx(db, () => {
    const exists = db.prepare('SELECT 1 FROM programs WHERE slug = ?');
    const unknown = write.order.find((e) => exists.get(e.slug) === undefined);
    if (unknown !== undefined) return { ok: false, unknownSlug: unknown.slug };
    const revision = revisionOf(db);
    if (write.basedOn !== revision) return { ok: false, why: LEDGER_ROUTE_REFUSALS.rankChanged, revision };
    const ordered = new Set(write.order.map((e) => e.slug));
    const del = db.prepare('DELETE FROM portfolio_rank WHERE program = ?');
    for (const slug of write.seen) if (!ordered.has(slug)) del.run(slug);
    const kept = (db.prepare('SELECT program, position, cls FROM portfolio_rank ORDER BY position, program').all() as unknown as
      Pick<RankRowRaw, 'program' | 'position' | 'cls'>[]).filter((r) => !ordered.has(r.program));
    const bands = new Map<string, string[]>();
    const band = (cls: string): string[] => { const b = bands.get(cls) ?? []; bands.set(cls, b); return b; };
    const place = db.prepare(
      'INSERT INTO portfolio_rank (program, position, cls, fixedDate, setAt, setBy) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(program) DO UPDATE SET position = excluded.position, cls = excluded.cls, fixedDate = excluded.fixedDate, ' +
      'setAt = excluded.setAt, setBy = excluded.setBy');
    for (const e of write.order) {
      const b = band(e.cls);
      b.push(e.slug);
      place.run(e.slug, b.length, e.cls, e.fixedDate, now, actor);
    }
    const move = db.prepare('UPDATE portfolio_rank SET position = ? WHERE program = ?');
    for (const r of kept) { const b = band(r.cls); b.push(r.program); move.run(b.length, r.program); }
    const next = revision + 1;
    db.prepare(
      'INSERT INTO portfolio_rank_revision (id, revision, setAt, setBy) VALUES (1, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, setAt = excluded.setAt, setBy = excluded.setBy',
    ).run(next, now, actor);
    return { ok: true, revision: next };
  });
}

/** The programmes the portfolio may list: an open run of any kind, or a rank row. The 28-day rule is `portfolioFor`'s. */
const LISTED = (terminal: string): string =>
  'SELECT p.slug FROM programs p WHERE EXISTS (SELECT 1 FROM portfolio_rank k WHERE k.program = p.slug) ' +
  `OR EXISTS (SELECT 1 FROM runs r WHERE r.program = p.slug AND r.state NOT IN ${terminal})`;

/** An ask row that is its child's newest: the only one the live-ask port can speak for. */
const NEWEST_ASK = '(a.id = (SELECT MAX(b.id) FROM asks b WHERE b.childId = a.childId))';


/** Everything `portfolioFor` reads. It only bounds what it fetches: items still open or closed in the window; and asks
 *  released or answered in the window, still `answering`, or `released` or `declined` and their child's newest row (an
 *  older one released before the window cannot be live, so it is outside the window: asks-unmeasured-is-windowed). For
 *  each `released` or `declined` ask that is its child's newest row it asks `liveAsk(childId)`: the row's own key reads
 *  `live: true`, any other key or `null` `false`, and `unmeasured` stays `'unmeasured'`. Every other ask carries `live: null`. */
export function portfolioFacts(
  db: DatabaseSync, now: number, terminalStatesSql: string, liveAsk: LiveAskRead, usage: SpendUsageRead,
): PortfolioFacts {
  const from = now - PORTFOLIO_WINDOW_DAYS * 24 * 3_600_000;
  const listed = LISTED(terminalStatesSql);
  const openItems = `(${OPEN_ITEM_STATES.map((s) => `'${s}'`).join(', ')})`;
  const programmes = db.prepare(
    `SELECT slug, title, createdAt FROM programs WHERE slug IN (${listed}) ORDER BY slug`,
  ).all() as unknown as PortfolioProgramme[];
  const ranks: RankRow[] = (db.prepare(
    `SELECT program, position, cls, fixedDate, setAt, setBy FROM portfolio_rank WHERE program IN (${listed}) ORDER BY program`,
  ).all() as unknown as RankRowRaw[]).map((r) => ({ ...r, cls: isServiceClass(r.cls) ? r.cls : null, clsRaw: r.cls }));
  const runs: PortfolioRun[] = (db.prepare(
    'SELECT id, program, wave, kind, reviews, state, openedAt, dispatchedAt, closedAt, closeDetail, claimedBy FROM runs ' +
    `WHERE program IN (${listed}) ORDER BY id`,
  ).all() as unknown as (Omit<PortfolioRun, 'kind' | 'rebuilt'> & { kind: string; claimedBy: string | null })[])
    // The rebuilt-run rule is `shared/programmes.ts#isRebuiltRun`'s alone (forecasts A moved it out of this file's SQL).
    .map(({ claimedBy, ...r }) => ({ ...r, kind: isRunKind(r.kind) ? r.kind : 'unknown',
      ...(isRebuiltRun({ claimedBy, dispatchedAt: r.dispatchedAt, openedAt: r.openedAt }) ? { rebuilt: true as const } : {}) }));
  const itemRows = db.prepare(
    'SELECT id, program, title, neededBy, state, raisedAt, heldUntil, tickedAt, closedAt FROM operator_items ' +
    `WHERE program IN (${listed}) AND (state IN ${openItems} OR closedAt >= ?) ORDER BY id`,
  ).all(from) as unknown as Omit<PortfolioItem, 'events'>[];
  const eventsOf = db.prepare('SELECT at, act FROM operator_item_events WHERE itemId = ? ORDER BY at, id');
  const items: PortfolioItem[] = itemRows.map((i) => ({ ...i, events: eventsOf.all(i.id) as unknown as { at: number; act: string }[] }));
  const askRows = db.prepare(
    `SELECT a.id, r.program, a.state, a.releasedAt, a.answeredAt, a.answeredBy, a.childId, a.askKey, ${NEWEST_ASK} AS newest ` +
    `FROM asks a JOIN runs r ON r.id = a.runId WHERE r.program IN (${listed}) AND (a.releasedAt >= ? OR a.answeredAt >= ? ` +
    `OR a.state = 'answering' OR (a.state IN ('released', 'declined') AND ${NEWEST_ASK})) ORDER BY a.id`,
  ).all(from, from) as unknown as (Omit<PortfolioAsk, 'live'> & { childId: string; askKey: string; newest: number })[];
  const asks: PortfolioAsk[] = askRows.map(({ childId, askKey, newest, ...a }) => {
    if (newest !== 1 || (a.state !== 'released' && a.state !== 'declined')) return { ...a, live: null };
    const read = liveAsk(childId);
    return { ...a, live: read.kind === 'unmeasured' ? 'unmeasured' : read.key === askKey };
  });
  return { programmes, ranks, revision: revisionOf(db), runs, items, asks, w2: w2Facts(db, now, programmes.map((p) => p.slug), terminalStatesSql, usage) };
}

const DAY_MS = 24 * 3_600_000;
/** The scored seals calibration's four cuts read: the oldest cut's window reaches back this far. */
const SCORED_SPAN_MS = ((CALIBRATION_CUTS - 1) * CALIBRATION_CUT_STEP_DAYS + CALIBRATION_WINDOW_DAYS) * DAY_MS;

/** The W2 facts (forecasts B), each list bounded as `PortfolioW2Facts` says. */
function w2Facts(db: DatabaseSync, now: number, slugs: readonly string[], terminal: string, usage: SpendUsageRead): PortfolioW2Facts {
  const seals = slugs.flatMap((program) => forecastsOf(db, { program }));
  const edgePrograms = (db.prepare('SELECT DISTINCT program FROM programme_edges ORDER BY program').all() as unknown as { program: string }[])
    .map((r) => r.program);
  const edges = openEdgesOf(db, edgePrograms);
  const targetRuns = [...new Set(edges.flatMap((e) => (e.target?.predicate === 'run-closed' ? [e.target.runId] : [])))];
  const runProgram = db.prepare('SELECT program FROM runs WHERE id = ?');
  const edgeRuns = targetRuns.flatMap((runId) => {
    const r = runProgram.get(runId) as { program: string | null } | undefined;
    return r === undefined || r.program === null ? [] : [{ runId, program: r.program }];
  });
  const newestDated = (db.prepare(
    'SELECT f.program AS program, f.p85At AS p85At FROM programme_forecasts f ' +
    'WHERE f.id = (SELECT MAX(g.id) FROM programme_forecasts g WHERE g.program = f.program) ORDER BY f.program',
  ).all() as unknown as { program: string; p85At: number | null }[]);
  const marks = slugs.map(() => '?').join(', ');
  const live = slugs.length === 0 ? [] : (db.prepare(
    `SELECT id AS runId, sessionId FROM runs WHERE program IN (${marks}) AND state NOT IN ${terminal} AND sessionId IS NOT NULL ORDER BY id`,
  ).all(...slugs) as unknown as { runId: number; sessionId: string }[]).map((r) => ({ ...r, reading: usage(r.sessionId) }));
  const statements = remainingSince(db, slugs, now - HEALTH_WINDOW_DAYS * DAY_MS);
  const lastMove = db.prepare(
    `SELECT MAX(COALESCE((SELECT MAX(e.at) FROM run_events e WHERE e.runId = r.id AND e.fromState <> e.toState), r.openedAt)) AS at ` +
    `FROM runs r WHERE r.program = ? AND r.kind = 'work' AND r.state NOT IN ${terminal}`,
  );
  const lastMoves = slugs.map((program) => ({ program, at: (lastMove.get(program) as { at: number | null }).at }));
  return {
    seals, scored: forecastsOf(db, { scoredSince: now - SCORED_SPAN_MS }), health: newestHealthOf(db, slugs),
    edges, edgeRuns, newestDated, spend: spendOf(db, slugs), live, statements, lastMoves,
  };
}
