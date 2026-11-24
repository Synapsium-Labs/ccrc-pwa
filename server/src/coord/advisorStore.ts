// The coordinator advisor's SQL (plan `2026-11-23-coordinator-advisor.md`, D-8967, D-8970, D-8971): `advisor_settings`,
// `advisor_calls` and `advisor_reads` (migration 123). It sits beside `store.ts` in the same ring and context, as
// `coordCallsStore.ts` does: every function takes the store's `DatabaseSync` and is synchronous, and `CoordStore` keeps
// one-line delegates of the same names.
//
// One writer per table, and nothing else writes them:
//   * `setCoordinatorAdvisor`  the only writer of `advisor_settings` (the Settings door);
//   * `recordAdvisorRead`      the only writer of `advisor_calls` and `advisor_reads` (the count lane), in one transaction.
// Nothing here decides: `coordinatorAdvisorOf` and `advisorFor` (`continuity/advisorPolicy.ts`, L1) do.
import type { DatabaseSync } from 'node:sqlite';
import type { AdvisorTokens, CoordinatorAdvisorSetting } from '../../../shared/coordinatorAdvisor.js';
import { tx } from './tx.js';
import type { AdvisorCallRow, AdvisorReadState, CoordinatorAdvisorRead } from '../continuity/advisorPolicy.js';
export type { AdvisorCallRow, AdvisorReadState, CoordinatorAdvisorRead } from '../continuity/advisorPolicy.js';

export function coordinatorAdvisorSettings(db: DatabaseSync): CoordinatorAdvisorRead {
  try {
    const r = db.prepare('SELECT choice, cap, scope FROM advisor_settings WHERE id = 1').get() as
      { choice: unknown; cap: unknown; scope: unknown } | undefined;
    if (r === undefined) return { kind: 'absent' };
    let scope: unknown = null;
    try { scope = typeof r.scope === 'string' ? JSON.parse(r.scope) : null; } catch { scope = null; }
    return { kind: 'row', choice: r.choice, cap: r.cap, scope };
  } catch (err) {
    return { kind: 'unreadable', detail: err instanceof Error ? err.message : String(err) };
  }
}

/** The one writer of `advisor_settings`, in one `tx()`: the row before, the write (an insert for a lost row), the row
 *  after. It validates nothing: the route has narrowed the setting. */
export function setCoordinatorAdvisor(db: DatabaseSync, s: CoordinatorAdvisorSetting, at: number):
  { before: CoordinatorAdvisorRead; after: CoordinatorAdvisorRead } {
  return tx(db, () => {
    const before = coordinatorAdvisorSettings(db);
    if (before.kind === 'unreadable') throw new Error(`coordinator advisor setting unreadable inside the write: ${before.detail}`);
    const scope = JSON.stringify(s.scope);
    if (before.kind === 'absent') {
      db.prepare('INSERT INTO advisor_settings (id, choice, cap, scope, updatedAt) VALUES (1, ?, ?, ?, ?)').run(s.choice, s.cap, scope, at);
    } else {
      db.prepare('UPDATE advisor_settings SET choice = ?, cap = ?, scope = ?, updatedAt = ? WHERE id = 1').run(s.choice, s.cap, scope, at);
    }
    return { before, after: coordinatorAdvisorSettings(db) };
  });
}

export function advisorReadState(db: DatabaseSync, sessionId: string): AdvisorReadState | null {
  const r = db.prepare('SELECT file, offset, spawnAt, requests, lastMessageId, available, availableAt, lastCallAt, unreadable, droppedDay FROM advisor_reads WHERE sessionId = ?')
    .get(sessionId) as (Omit<AdvisorReadState, 'available'> & { available: string | null }) | undefined;
  if (r === undefined) return null;
  const available = r.available === 'true' || r.available === 'false' ? r.available : null;
  return { file: r.file, offset: r.offset, spawnAt: r.spawnAt, requests: r.requests, lastMessageId: r.lastMessageId, available,
    availableAt: r.availableAt, lastCallAt: r.lastCallAt, unreadable: r.unreadable, droppedDay: r.droppedDay ?? null };
}

/** Calls and calls' rows are kept this many days, then pruned by the writer. */
export const ADVISOR_KEEP_DAYS = 14;

/** THE ONLY WRITER of `advisor_calls` and `advisor_reads`, in one transaction: each call upserted (a later line's measured
 *  usage replaces an earlier one, since a later streamed line of a message carries the fuller usage; a line with none
 *  leaves it; the model fills a NULL), the read state replaced, and rows older than
 *  `ADVISOR_KEEP_DAYS` pruned. `oldestDay` is the first UTC day kept. */
export function recordAdvisorRead(db: DatabaseSync, sessionId: string, state: AdvisorReadState, calls: readonly AdvisorCallRow[],
  now: number, oldestDay: string): void {
  tx(db, () => {
    const up = db.prepare(
      'INSERT INTO advisor_calls (sessionId, callId, day, at, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sessionId, callId) DO UPDATE SET ' +
      'model = COALESCE(model, excluded.model), inputTokens = COALESCE(excluded.inputTokens, inputTokens), ' +
      'outputTokens = COALESCE(excluded.outputTokens, outputTokens), cacheReadTokens = COALESCE(excluded.cacheReadTokens, cacheReadTokens), ' +
      'cacheWriteTokens = COALESCE(excluded.cacheWriteTokens, cacheWriteTokens)');
    for (const c of calls) {
      const t = c.tokens;
      up.run(sessionId, c.callId, c.day, c.at, c.model, t?.input ?? null, t?.output ?? null, t?.cacheRead ?? null, t?.cacheWrite ?? null);
    }
    db.prepare(
      'INSERT INTO advisor_reads (sessionId, file, offset, spawnAt, requests, lastMessageId, available, availableAt, lastCallAt, unreadable, droppedDay, updatedAt) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sessionId) DO UPDATE SET file = excluded.file, offset = excluded.offset, ' +
      'spawnAt = excluded.spawnAt, requests = excluded.requests, lastMessageId = excluded.lastMessageId, available = excluded.available, ' +
      'availableAt = excluded.availableAt, lastCallAt = excluded.lastCallAt, unreadable = excluded.unreadable, droppedDay = excluded.droppedDay, ' +
      'updatedAt = excluded.updatedAt',
    ).run(sessionId, state.file, state.offset, state.spawnAt, state.requests, state.lastMessageId, state.available, state.availableAt,
      state.lastCallAt, state.unreadable, state.droppedDay, now);
    db.prepare('DELETE FROM advisor_calls WHERE day < ?').run(oldestDay);
  });
}

/** One coordinator's day: its counted calls and the tokens the calls' usage carried (null when none carried any). */
export interface AdvisorDay { readonly calls: number; readonly tokens: AdvisorTokens | null }

/** Every session's counted calls on one UTC day. Throws on a failed read; the caller reads that as unmeasured. */
export function advisorDayCounts(db: DatabaseSync, day: string): Map<string, AdvisorDay> {
  const rows = db.prepare(
    'SELECT sessionId, COUNT(*) AS calls, COUNT(inputTokens) AS measured, SUM(inputTokens) AS i, SUM(outputTokens) AS o, ' +
    'SUM(cacheReadTokens) AS cr, SUM(cacheWriteTokens) AS cw FROM advisor_calls WHERE day = ? GROUP BY sessionId',
  ).all(day) as { sessionId: string; calls: number; measured: number; i: number | null; o: number | null; cr: number | null; cw: number | null }[];
  return new Map(rows.map((r) => [r.sessionId, {
    calls: r.calls,
    tokens: r.measured === 0 ? null : { input: r.i ?? 0, output: r.o ?? 0, cacheRead: r.cr ?? 0, cacheWrite: r.cw ?? 0 },
  }]));
}
