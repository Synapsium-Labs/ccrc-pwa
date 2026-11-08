// D-8071 (spec 2026-11-04 §11.4, A30, A31): `GET /api/runs/find`, the lookup and the close-order list in one slim read.
//
// A query over the coord db, SYNCHRONOUS like `runsPage.ts` and through the same structural `RunsDb` port, so this file
// names no sqlite module. It reads STORED COLUMNS only: no hydrate, no item tally, no spend, and no join to `run_events`
// (`closedBy` and `closeDetail` are columns of `runs`, written by `advanceInner` beside `closedAt`). One statement for
// each part: the exact id, the reviews of it, the open runs, and a page of closed runs. It declares no ring: its ring
// follows its facts.
import type { RunClosedBy, RunFindAnswer, RunFindQuery, RunHit, RunKind, RunState } from '../../../shared/api.js';
import { redactCommand } from './redact.js';
import type { RunsDb } from './runsPage.js';

/** The most closed runs one page may ask for, and the page size when `limit` is absent. */
export const RUN_FIND_LIMIT_MAX = 100;
export const RUN_FIND_LIMIT_DEFAULT = 30;
/** The longest `q` the read takes; a longer one is a bad request, never a silent cut. */
export const RUN_FIND_Q_MAX = 200;

const CLOSED_BY: readonly string[] = ['coordinator', 'operator', 'sweep'];

/** What the route hands the query: the parsed, validated form of `RunFindQuery`. */
export interface RunFindParsed {
  readonly q: string | null;
  readonly scope: 'open' | 'closed' | 'all';
  readonly closedBy: string | null;
  readonly closedSince: number | null;
  readonly program: string | null;
  readonly limit: number;
  readonly cursor: { readonly beforeAt: number; readonly beforeId: number } | null;
}

const NON_NEGATIVE = /^(0|[1-9][0-9]{0,15})$/;
const nonNegative = (v: string): number | null => {
  if (!NON_NEGATIVE.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};

/** Parse the wire query. `null` is a bad request: a bad `closedSince`, `program`, `limit`, `scope`, a half cursor, or a
 *  `q` over the cap is refused, never clamped or coerced. PURE. */
export function parseRunFind(raw: Readonly<Record<string, unknown>>): RunFindParsed | null {
  let bad = false;
  const str = (k: string): string | undefined => {
    const v = raw[k];
    if (v === undefined) return undefined;
    if (typeof v === 'string') return v;
    bad = true;
    return undefined;
  };
  const q = str('q'), scope = str('scope'), closedBy = str('closedBy'), closedSince = str('closedSince');
  const program = str('program'), limit = str('limit'), beforeAt = str('beforeAt'), beforeId = str('beforeId');
  if (bad) return null;

  const qText = q === undefined ? null : q.trim();
  if (qText !== null && qText.length > RUN_FIND_Q_MAX) return null;
  if (scope !== undefined && scope !== 'open' && scope !== 'closed' && scope !== 'all') return null;
  if (closedBy !== undefined && (closedBy.length === 0 || closedBy.length > 64)) return null;
  let since: number | null = null;
  if (closedSince !== undefined) { since = nonNegative(closedSince); if (since === null) return null; }
  if (program !== undefined && !/^[^\s\u0000-\u001f]{1,200}$/u.test(program)) return null;
  let n = RUN_FIND_LIMIT_DEFAULT;
  if (limit !== undefined) {
    const l = nonNegative(limit);
    if (l === null || l < 1 || l > RUN_FIND_LIMIT_MAX) return null;
    n = l;
  }
  if ((beforeAt === undefined) !== (beforeId === undefined)) return null;
  let cursor: RunFindParsed['cursor'] = null;
  if (beforeAt !== undefined && beforeId !== undefined) {
    const at = nonNegative(beforeAt), id = nonNegative(beforeId);
    if (at === null || id === null || id < 1) return null;
    cursor = { beforeAt: at, beforeId: id };
  }
  return {
    q: qText === null || qText === '' ? null : qText,
    scope: scope ?? 'all',
    closedBy: closedBy ?? null,
    closedSince: since,
    program: program ?? null,
    limit: n,
    cursor,
  };
}

/** `%`, `_` and the escape character itself, made literal for `LIKE ... ESCAPE '\'`. PURE. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

interface HitRow {
  id: number; program: string; programTitle: string; runTitle: string | null; wave: number; waveOf: number | null;
  kind: string; reviews: number | null; state: string; project: string; workspace: string | null; branch: string | null;
  claimedBy: string | null; openedAt: number; closedAt: number | null; closedBy: string | null; closeDetail: string | null;
}

const COLUMNS =
  'r.id, r.program, p.title AS programTitle, r.title AS runTitle, r.wave, r.waveOf, r.kind, r.reviews, r.state, ' +
  'r.project, r.workspace, r.branch, r.claimedBy, r.openedAt, r.closedAt, r.closedBy, r.closeDetail';

const toHit = (row: HitRow): RunHit => ({
  id: row.id,
  program: row.program,
  programTitle: row.programTitle,
  runTitle: row.runTitle,
  wave: row.wave,
  waveOf: row.waveOf,
  kind: row.kind as RunKind,
  reviews: row.reviews,
  state: row.state as RunState,
  project: row.project,
  workspace: row.workspace,
  branch: row.branch,
  claimedBy: row.claimedBy,
  openedAt: row.openedAt,
  closedAt: row.closedAt,
  // A stored word outside the three reads as no closer, like the wire's own reader.
  closedBy: row.closedBy !== null && CLOSED_BY.includes(row.closedBy) ? (row.closedBy as RunClosedBy) : null,
  closeDetail: row.closeDetail === null ? null : redactCommand(row.closeDetail),
});

/** The runs that review run `id`, newest first, as hits (D-8071; spec §11.5 `reviewedBy`). The one statement `find`'s
 *  `reviewsOf` runs, shared so the record read and the lookup list the same rows. */
export function runsReviewing(db: RunsDb, id: number): RunHit[] {
  return (db.prepare(`SELECT ${COLUMNS} FROM runs r JOIN programs p ON p.slug = r.program WHERE r.reviews = ? ORDER BY r.id DESC LIMIT 100`).all(id) as HitRow[]).map(toHit);
}

/** The text match: case-insensitive `LIKE` over run title, programme slug and title, workspace, branch and project. */
const TEXT_COLUMNS = ['r.title', 'r.program', 'p.title', 'r.workspace', 'r.branch', 'r.project'];

export function runFind(
  db: RunsDb,
  parsed: RunFindParsed,
  sql: { terminalStatesSql: string },
): RunFindAnswer {
  const { q, scope, closedBy, closedSince, program, limit, cursor } = parsed;
  const terminal = sql.terminalStatesSql;
  const from = 'FROM runs r JOIN programs p ON p.slug = r.program';

  // A number: the run with that id (however old, whatever the filters), and the runs that review it.
  const id = q !== null && /^[1-9][0-9]{0,15}$/.test(q) && Number.isSafeInteger(Number(q)) ? Number(q) : null;
  let exact: RunHit | null = null;
  let reviewsOf: RunHit[] = [];
  if (id !== null && cursor === null) {
    const row = db.prepare(`SELECT ${COLUMNS} ${from} WHERE r.id = ?`).all(id)[0] as HitRow | undefined;
    exact = row === undefined ? null : toHit(row);
    reviewsOf = runsReviewing(db, id);
  }

  const where: string[] = [];
  const args: unknown[] = [];
  if (q !== null) {
    const pat = `%${escapeLike(q)}%`;
    where.push('(' + TEXT_COLUMNS.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')');
    for (let i = 0; i < TEXT_COLUMNS.length; i += 1) args.push(pat);
  }
  if (program !== null) { where.push('r.program = ?'); args.push(program); }
  if (id !== null) { where.push('r.id <> ?'); args.push(id); }
  const base = where.length === 0 ? '' : ' AND ' + where.join(' AND ');

  // Open runs: first page only, outside `limit`, newest id first. A closer or a close time filter names closed runs alone.
  let open: HitRow[] = [];
  if (scope !== 'closed' && cursor === null && closedBy === null && closedSince === null) {
    open = db.prepare(`SELECT ${COLUMNS} ${from} WHERE r.state NOT IN ${terminal}${base} ORDER BY r.id DESC`)
      .all(...args) as HitRow[];
  }

  let closed: HitRow[] = [];
  let next: RunFindAnswer['next'] = null;
  if (scope !== 'open') {
    const extra: string[] = [];
    const cargs: unknown[] = [];
    if (closedBy !== null) { extra.push('r.closedBy = ?'); cargs.push(closedBy); }
    if (closedSince !== null) { extra.push('r.closedAt >= ?'); cargs.push(closedSince); }
    if (cursor !== null) {
      extra.push('(r.closedAt < ? OR (r.closedAt = ? AND r.id < ?))');
      cargs.push(cursor.beforeAt, cursor.beforeAt, cursor.beforeId);
    }
    const more = extra.length === 0 ? '' : ' AND ' + extra.join(' AND ');
    // `closedAt IS NOT NULL` is the partial index's own predicate, so the order walks the index.
    const rows = db.prepare(
      `SELECT ${COLUMNS} ${from} WHERE r.closedAt IS NOT NULL AND r.state IN ${terminal}${base}${more} ` +
      'ORDER BY r.closedAt DESC, r.id DESC LIMIT ?',
    ).all(...args, ...cargs, limit + 1) as HitRow[];
    closed = rows.slice(0, limit);
    if (rows.length > limit) {
      const last = closed[closed.length - 1]!;
      next = { beforeAt: last.closedAt as number, beforeId: last.id };
    }
  }

  return { ok: true, exact, runs: [...open, ...closed].map(toHit), reviewsOf, next };
}

/** Narrow the wire query type to what the route reads off `req.query`. */
export type RunFindWire = { [K in keyof RunFindQuery]?: string };
