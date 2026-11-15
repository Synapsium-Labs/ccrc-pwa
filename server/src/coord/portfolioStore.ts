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
// caught here: the read door answers it `runs-unreadable`.
import type { DatabaseSync } from 'node:sqlite';
import { isRunKind } from '../../../shared/api.js';
import { OPEN_ITEM_STATES } from '../../../shared/ledgers.js';
import {
  PORTFOLIO_WINDOW_DAYS, isServiceClass,
  type PortfolioAsk, type PortfolioFacts, type PortfolioItem, type PortfolioProgramme, type PortfolioRun, type RankRow, type RankWrite,
} from '../../../shared/portfolio.js';
import type { LiveAskRead } from './ports.js';
import { tx } from './tx.js';
export type { LiveAskRead, PortfolioFacts, RankWrite };

/** `setPortfolioRank`'s answer: the new revision; or, having written nothing, `unknown-programme` with the first `order` slug
 *  no `programs` row names, or `rank-changed` with the current revision. */
export type RankWriteResult =
  | { ok: true; revision: number }
  | { ok: false; why: 'unknown-programme'; slug: string }
  | { ok: false; why: 'rank-changed'; revision: number };

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
    if (unknown !== undefined) return { ok: false, why: 'unknown-programme', slug: unknown.slug };
    const revision = revisionOf(db);
    if (write.basedOn !== revision) return { ok: false, why: 'rank-changed', revision };
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

/** Everything `portfolioFor` reads, inside one transaction. It only bounds what it fetches: items still open or closed in
 *  the window, and asks released in the window or still `released` or `declined`. For each `released` or `declined` ask
 *  that is its child's newest row it asks `liveAsk(childId)`: the row's own key reads `live: true`, any other key or `null`
 *  `false`, and `unmeasured` stays `'unmeasured'`. Every other ask carries `live: null`. */
export function portfolioFacts(db: DatabaseSync, now: number, terminalStatesSql: string, liveAsk: LiveAskRead): PortfolioFacts {
  const from = now - PORTFOLIO_WINDOW_DAYS * 24 * 3_600_000;
  const listed = LISTED(terminalStatesSql);
  const openItems = `(${OPEN_ITEM_STATES.map((s) => `'${s}'`).join(', ')})`;
  return tx(db, () => {
    const programmes = db.prepare(
      `SELECT slug, title, createdAt FROM programs WHERE slug IN (${listed}) ORDER BY slug`,
    ).all() as unknown as PortfolioProgramme[];
    const ranks: RankRow[] = (db.prepare(
      `SELECT program, position, cls, fixedDate, setAt, setBy FROM portfolio_rank WHERE program IN (${listed}) ORDER BY program`,
    ).all() as unknown as RankRowRaw[]).map((r) => ({ ...r, cls: isServiceClass(r.cls) ? r.cls : null, clsRaw: r.cls }));
    const runs: PortfolioRun[] = (db.prepare(
      'SELECT id, program, wave, kind, reviews, state, openedAt, dispatchedAt, closedAt, closeDetail FROM runs ' +
      `WHERE program IN (${listed}) ORDER BY id`,
    ).all() as unknown as (Omit<PortfolioRun, 'kind'> & { kind: string })[]).map((r) => ({ ...r, kind: isRunKind(r.kind) ? r.kind : 'unknown' }));
    const itemRows = db.prepare(
      'SELECT id, program, title, neededBy, state, raisedAt, heldUntil, tickedAt, closedAt FROM operator_items ' +
      `WHERE program IN (${listed}) AND (state IN ${openItems} OR closedAt >= ?) ORDER BY id`,
    ).all(from) as unknown as Omit<PortfolioItem, 'events'>[];
    const eventsOf = db.prepare('SELECT at, act FROM operator_item_events WHERE itemId = ? ORDER BY at, id');
    const items: PortfolioItem[] = itemRows.map((i) => ({ ...i, events: eventsOf.all(i.id) as unknown as { at: number; act: string }[] }));
    const askRows = db.prepare(
      'SELECT a.id, r.program, a.state, a.releasedAt, a.answeredAt, a.answeredBy, a.childId, a.askKey, ' +
      '(a.id = (SELECT MAX(b.id) FROM asks b WHERE b.childId = a.childId)) AS newest ' +
      `FROM asks a JOIN runs r ON r.id = a.runId WHERE r.program IN (${listed}) ` +
      "AND (a.releasedAt >= ? OR a.state IN ('released', 'declined')) ORDER BY a.id",
    ).all(from) as unknown as (Omit<PortfolioAsk, 'live'> & { childId: string; askKey: string; newest: number })[];
    const asks: PortfolioAsk[] = askRows.map(({ childId, askKey, newest, ...a }) => {
      if (newest !== 1 || (a.state !== 'released' && a.state !== 'declined')) return { ...a, live: null };
      const key = liveAsk(childId);
      return { ...a, live: key === 'unmeasured' ? 'unmeasured' : key === askKey };
    });
    return { programmes, ranks, revision: revisionOf(db), runs, items, asks };
  });
}
