// The approval census's rows and their one writer (approvals plan 2026-11-18, §3.1, Tasks 1.3 and 1.4). Ring L3, context
// C6 (operator questions). ONE table (migration 102), `approval_census`: one row per permission prompt that leaves no
// approvals row (Table 2a's paths 1, 2, 6 and 7, and the prompts it cannot place, `unmeasured`). Its ONLY writer is `insertCensusRow`, reached only through the questions
// owner (`coord/questions.ts`, `observeCensus`), and its summary is cleared by `pruneCensusSummaries` at the approvals'
// retention. The readers answer what the census read counts (`censusRowsIn`, `approvalRowsForCensus`, `approvalPushSources`):
// every column narrowed, and a value no writer writes is an error the read answers, never a guess.
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  APPROVAL_CENSUS_ROW_PATHS, isApprovalCensusPath, isApprovalCensusUnmeasured, type ApprovalCensusRowPath, type ApprovalCensusUnmeasured,
} from '../../../shared/approval-census.js';

const STMTS = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
function stmt(db: DatabaseSync, sql: string): StatementSync {
  let m = STMTS.get(db);
  if (m === undefined) { m = new Map(); STMTS.set(db, m); }
  let s = m.get(sql);
  if (s === undefined) { s = db.prepare(sql); m.set(sql, s); }
  return s;
}

/** One census row as its writer takes it. `sightingKey` names the prompt's sighting (the envelope's stamp, or the menu's
 *  first sighting), so one prompt seen on many ticks is one row. */
export interface CensusRowInsert {
  readonly sessionId: string;
  readonly sightingKey: string;
  readonly path: ApprovalCensusRowPath;
  /** Why an `unmeasured` row could not be placed; null on every other path. */
  readonly why: ApprovalCensusUnmeasured | null;
  readonly route: string | null;
  readonly thread: 'main' | 'subagent' | null;
  readonly tool: string | null;
  readonly summary: string | null;
  readonly runId: number | null;
  readonly seenAt: number;
}

/** THE ONE WRITER of `approval_census`. Inserts the row unless this sighting already has one; either way answers the
 *  sighting's row id (the push's source) and whether this call wrote it. */
export function insertCensusRow(db: DatabaseSync, r: CensusRowInsert): { readonly id: number; readonly inserted: boolean } {
  const res = stmt(db, 'INSERT OR IGNORE INTO approval_census (sessionId, sightingKey, path, why, route, thread, tool, summary, runId, seenAt) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.sessionId, r.sightingKey, r.path, r.why, r.route, r.thread, r.tool, r.summary, r.runId, r.seenAt);
  const row = stmt(db, 'SELECT id FROM approval_census WHERE sessionId = ? AND sightingKey = ?').get(r.sessionId, r.sightingKey) as
    { id: number } | undefined;
  if (row === undefined) throw new Error('approval_census: the sighting has no row after its insert');
  return { id: Number(row.id), inserted: Number(res.changes) === 1 };
}

/** The approvals' retention for census rows: the summary is cleared, the row kept as the journal. */
export function pruneCensusSummaries(db: DatabaseSync, before: number): number {
  return Number(stmt(db, 'UPDATE approval_census SET summary = NULL WHERE seenAt < ? AND summary IS NOT NULL').run(before).changes);
}

/** A census row as the read counts it, with its programme (the run its session's mark named), or an error naming the
 *  first column no writer writes. */
export interface CensusRowRead {
  readonly id: number; readonly sessionId: string; readonly path: ApprovalCensusRowPath; readonly why: ApprovalCensusUnmeasured | null;
  readonly route: string | null; readonly thread: 'main' | 'subagent' | null; readonly tool: string | null;
  readonly summary: string | null; readonly programme: string | null; readonly seenAt: number;
}
export type CensusRowsResult = { readonly ok: true; readonly rows: readonly CensusRowRead[] } | { readonly ok: false; readonly detail: string };

const ROW_PATHS: ReadonlySet<string> = new Set(APPROVAL_CENSUS_ROW_PATHS);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export function censusRowsIn(db: DatabaseSync, fromMs: number, toMs: number): CensusRowsResult {
  const raw = stmt(db, 'SELECT c.id, c.sessionId, c.path, c.why, c.route, c.thread, c.tool, c.summary, c.seenAt, r.program AS programme '
    + 'FROM approval_census c LEFT JOIN runs r ON r.id = c.runId WHERE c.seenAt >= ? AND c.seenAt < ? ORDER BY c.id').all(fromMs, toMs) as
    Record<string, unknown>[];
  const rows: CensusRowRead[] = [];
  for (const x of raw) {
    const path = x['path'];
    const thread = x['thread'];
    if (typeof path !== 'string' || !ROW_PATHS.has(path) || !isApprovalCensusPath(path)) return { ok: false, detail: `approval_census row ${String(x['id'])}: path ${String(path)}` };
    const why = x['why'];
    // `why` is set on an `unmeasured` row only, and is one of the census's own words.
    if (path === 'unmeasured' ? !isApprovalCensusUnmeasured(why) : why !== null) return { ok: false, detail: `approval_census row ${String(x['id'])}: why ${String(why)}` };
    if (thread !== null && thread !== 'main' && thread !== 'subagent') return { ok: false, detail: `approval_census row ${String(x['id'])}: thread ${String(thread)}` };
    if (typeof x['sessionId'] !== 'string' || typeof x['seenAt'] !== 'number') return { ok: false, detail: `approval_census row ${String(x['id'])}: unreadable` };
    rows.push({
      id: Number(x['id']), sessionId: x['sessionId'], path: path as ApprovalCensusRowPath,
      why: isApprovalCensusUnmeasured(why) ? why : null, route: str(x['route']), thread,
      tool: str(x['tool']), summary: str(x['summary']), programme: str(x['programme']), seenAt: x['seenAt'],
    });
  }
  return { ok: true, rows };
}

/** A minted approvals row as the census read counts it: the row's own columns the census needs, its programme, and the
 *  two facts from mint (NULL on a row minted before them). */
export interface ApprovalCensusSourceRow {
  readonly id: number; readonly childId: string; readonly agentId: string; readonly tool: string;
  readonly inputRedacted: string | null; readonly class: string; readonly state: string; readonly releaseReason: string | null;
  readonly verdict: string | null; readonly answeredBy: string | null; readonly askAt: number; readonly programme: string | null;
  readonly notifyAt: number | null; readonly ruledAt: number | null;
  readonly commandWords: readonly string[] | null; readonly literalInRoot: boolean | null;
}
export type ApprovalCensusSourceResult =
  | { readonly ok: true; readonly rows: readonly ApprovalCensusSourceRow[] } | { readonly ok: false; readonly detail: string };

const wordsOf = (v: unknown): readonly string[] | null | 'bad' => {
  if (v === null) return null;
  if (typeof v !== 'string') return 'bad';
  try {
    const p: unknown = JSON.parse(v);
    return Array.isArray(p) && p.every((w) => typeof w === 'string') ? p as string[] : 'bad';
  } catch { return 'bad'; }
};

export function approvalRowsForCensus(db: DatabaseSync, fromMs: number, toMs: number): ApprovalCensusSourceResult {
  const raw = stmt(db, 'SELECT a.id, a.childId, a.agentId, a.tool, a.inputRedacted, a.class, a.state, a.releaseReason, a.verdict, '
    + 'a.answeredBy, a.askAt, a.notifyAt, a.ruledAt, a.commandWords, a.literalInRoot, r.program AS programme '
    + 'FROM approvals a LEFT JOIN runs r ON r.id = a.runId WHERE a.askAt >= ? AND a.askAt < ? ORDER BY a.id').all(fromMs, toMs) as
    Record<string, unknown>[];
  const rows: ApprovalCensusSourceRow[] = [];
  for (const x of raw) {
    const words = wordsOf(x['commandWords']);
    const lit = x['literalInRoot'];
    if (words === 'bad') return { ok: false, detail: `approvals row ${String(x['id'])}: commandWords` };
    if (lit !== null && lit !== 0 && lit !== 1) return { ok: false, detail: `approvals row ${String(x['id'])}: literalInRoot` };
    if (typeof x['childId'] !== 'string' || typeof x['state'] !== 'string' || typeof x['askAt'] !== 'number') {
      return { ok: false, detail: `approvals row ${String(x['id'])}: unreadable` };
    }
    rows.push({
      id: Number(x['id']), childId: x['childId'], agentId: str(x['agentId']) ?? '', tool: str(x['tool']) ?? '',
      inputRedacted: str(x['inputRedacted']), class: str(x['class']) ?? '', state: x['state'], releaseReason: str(x['releaseReason']),
      verdict: str(x['verdict']), answeredBy: str(x['answeredBy']), askAt: x['askAt'], programme: str(x['programme']),
      notifyAt: num(x['notifyAt']), ruledAt: num(x['ruledAt']),
      commandWords: words, literalInRoot: lit === null ? null : lit === 1,
    });
  }
  return { ok: true, rows };
}

/** The approval pushes the outbox wrote in the window, counted by their source's kind (`approval` or `census`). */
export function approvalPushSources(db: DatabaseSync, fromMs: number, toMs: number): Readonly<Record<string, number>> {
  const raw = stmt(db, "SELECT substr(pushSource, 1, instr(pushSource, ':') - 1) AS kind, COUNT(*) AS n FROM push_outbox "
    + "WHERE pushSource IS NOT NULL AND instr(pushSource, ':') > 1 AND createdAt >= ? AND createdAt < ? GROUP BY kind").all(fromMs, toMs) as
    { kind: string; n: number }[];
  const out: Record<string, number> = {};
  for (const r of raw) out[r.kind] = Number(r.n);
  return out;
}

/** A run as M38's denominator reads it: its programme and when it was open. */
export interface CensusRunSpanRow { readonly programme: string; readonly openedAt: number; readonly closedAt: number | null }
export type CensusRunSpansResult = { readonly ok: true; readonly rows: readonly CensusRunSpanRow[] } | { readonly ok: false; readonly detail: string };

/** Every run open at any time in `[fromMs, toMs)` (opened before its end, not closed before its start), for M38's
 *  programme-days (review 2638 F4): a programme with an open run on a day counts that day, prompt or none. */
export function censusRunSpans(db: DatabaseSync, fromMs: number, toMs: number): CensusRunSpansResult {
  const raw = stmt(db, 'SELECT id, program, openedAt, closedAt FROM runs WHERE openedAt < ? AND (closedAt IS NULL OR closedAt >= ?) ORDER BY id')
    .all(toMs, fromMs) as Record<string, unknown>[];
  const rows: CensusRunSpanRow[] = [];
  for (const x of raw) {
    const closed = x['closedAt'];
    if (typeof x['program'] !== 'string' || typeof x['openedAt'] !== 'number' || (closed !== null && typeof closed !== 'number')) {
      return { ok: false, detail: `runs row ${String(x['id'])}: unreadable` };
    }
    rows.push({ programme: x['program'], openedAt: x['openedAt'], closedAt: closed });
  }
  return { ok: true, rows };
}
