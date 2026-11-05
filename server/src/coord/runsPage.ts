// Console speed S2, per-request reads: one PAGE of the run archive for `GET /api/runs?closed=1&limit=&before=`.
//
// A query over the coord db, SYNCHRONOUS like the store it serves (no async surface over `CoordStore`). The row
// columns, the terminal-state list and the row hydration are the STORE's and arrive as arguments (the store's delegate
// passes its own), so this file names no second copy of any of them. It declares no ring: its ring follows its facts.
import type { ChildReclaimAttention } from '../../../shared/api.js';
import type { RunsReadResult } from './store.js';

/** The one thing this file asks of the coord db handle: prepare a statement and read all its rows. A structural port, so
 *  the store's `DatabaseSync` satisfies it and this file names no sqlite module (only the store and the route files
 *  that own the handle may). Method syntax, so a statement taking narrower bound-parameter types still fits. */
export interface RunsDb {
  prepare(sql: string): { all(...args: unknown[]): unknown[] };
}

/** The most terminal runs one page may ask for (the route refuses a larger `limit`). */
export const RUNS_PAGE_LIMIT_MAX = 500;

/** A page: the hydrated read (its `run-unreadable` failure arm passes through unchanged, hydrate decides it) and, when
 *  older terminal runs remain, the `before` value that asks for the next page. */
export interface RunsPage { readonly read: RunsReadResult; readonly nextBefore?: number }

/** The run ids a reclaim attention list names, deduplicated: every arm's own `runId` when it is a number (a null one
 *  names no run) and every collapsed arm's members. PURE. Written here because no shared extractor exists: the PWA's
 *  reader (`childReclaimWords.ts`) renders the list and does not collect ids. */
export function reclaimAttentionRunIds(items: readonly ChildReclaimAttention[] | undefined): number[] {
  const ids = new Set<number>();
  for (const item of items ?? []) {
    if ('runId' in item && typeof item.runId === 'number') ids.add(item.runId);
    if ('members' in item && Array.isArray(item.members)) {
      for (const m of item.members) if (typeof m?.runId === 'number') ids.add(m.runId);
    }
  }
  return [...ids];
}

/**
 * Every ACTIVE run (state not terminal, as `runs()` reads it), the newest `limit` TERMINAL runs with `id < before` (all
 * terminal runs when `before` is absent), and every run in `pinned` however old; no duplicates, ordered by id ascending.
 *
 * `nextBefore` is the smallest terminal id among the `limit` page rows (a pinned extra never counts) WHEN a terminal run
 * with a smaller id remains, and absent on the last page. `limit` and `before` are bound parameters, and so is every
 * pinned id.
 */
export function runsPage(
  db: RunsDb,
  opts: { limit: number; before?: number; pinned: readonly number[] },
  sql: { columns: string; terminalStatesSql: string },
  hydrate: (rows: readonly unknown[]) => RunsReadResult,
): RunsPage {
  const { limit, before } = opts;
  const pinned = [...new Set(opts.pinned)];
  const terminal = sql.terminalStatesSql;
  const older = before === undefined ? '' : ' AND id < ?';
  const olderArgs = before === undefined ? [] : [before];
  const marks = pinned.map(() => '?').join(',');

  // One extra id tells whether an older terminal run remains, with no second count.
  const pageIds = db.prepare(
    `SELECT id FROM runs WHERE state IN ${terminal}${older} ORDER BY id DESC LIMIT ?`,
  ).all(...olderArgs, limit + 1) as unknown as { id: number }[];
  const nextBefore = pageIds.length > limit ? pageIds[limit - 1]!.id : undefined;

  const rows = db.prepare(
    `SELECT ${sql.columns} FROM runs r JOIN programs p ON p.slug = r.program ` +
    `WHERE r.state NOT IN ${terminal} OR r.id IN ` +
    `(SELECT id FROM runs WHERE state IN ${terminal}${older} ORDER BY id DESC LIMIT ?)` +
    (pinned.length === 0 ? ' ' : ` OR r.id IN (${marks}) `) +
    'ORDER BY r.id',
  ).all(...olderArgs, limit, ...pinned);
  const read = hydrate(rows);
  return nextBefore === undefined ? { read } : { read, nextBefore };
}
