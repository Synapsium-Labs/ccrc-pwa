// `limit_samples`: the history of each account's limits (Overlord W1 serviceability PR B, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md` Task 5; spec C57 "A history of limits", Table 11.1a).
// Ring L3, context C1: the table's SQL, in `claudeBuildsStore.ts`'s idiom: every function takes the store's
// `DatabaseSync` and is synchronous, and `CoordStore` keeps one-line delegates. ONE writer of the table, the sampler
// (`limitSampler.ts`), through `insertLimitSamples` and `pruneLimitSamples`; what a sample means is `poolRunway.ts`'s.
// Rows hold percentages and times, nothing private.
import type { DatabaseSync } from 'node:sqlite';
import { tx } from './tx.js';
import type { LimitSample } from '../poolRunway.js';

interface Row {
  account: string; ts: number; five: number | null; seven: number | null;
  five_reset_at: number | null; seven_reset_at: number | null;
  five_rolled: number; seven_rolled: number; five_window_minutes: number | null;
}

const COLUMNS = 'account, ts, five, seven, five_reset_at, seven_reset_at, five_rolled, seven_rolled, five_window_minutes';

/** One row per account reading: `INSERT OR IGNORE` on `(account, ts)`, so one reading is one row however many beats see
 *  it, and the first beat's flags stand. Answers how many rows were new. */
export function insertLimitSamples(db: DatabaseSync, rows: readonly LimitSample[], sampledAt: number): number {
  if (rows.length === 0) return 0;
  const ins = db.prepare(`INSERT OR IGNORE INTO limit_samples (${COLUMNS}, sampled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  return tx(db, () => rows.reduce((n, r) => n + Number(ins.run(
    r.account, r.ts, r.five, r.seven, r.fiveResetAt, r.sevenResetAt, r.fiveRolled ? 1 : 0, r.sevenRolled ? 1 : 0,
    r.fiveWindowMinutes, sampledAt,
  ).changes), 0));
}

/** The asked accounts' rows whose reading is at or after `sinceS`, by account, oldest first. Throws when the table cannot
 *  be read: the caller says so. */
export function limitSamplesSince(db: DatabaseSync, accounts: readonly string[], sinceS: number): LimitSample[] {
  if (accounts.length === 0) return [];
  const marks = accounts.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT ${COLUMNS} FROM limit_samples WHERE account IN (${marks}) AND ts >= ? ORDER BY account, ts`)
    .all(...accounts, sinceS) as unknown as Row[];
  return rows.map((r) => ({
    account: r.account, ts: r.ts, five: r.five, seven: r.seven, fiveResetAt: r.five_reset_at, sevenResetAt: r.seven_reset_at,
    fiveRolled: r.five_rolled === 1, sevenRolled: r.seven_rolled === 1, fiveWindowMinutes: r.five_window_minutes,
  }));
}

/** Deletes the rows whose reading is older than `beforeS` (strictly), answering the count. */
export function pruneLimitSamples(db: DatabaseSync, beforeS: number): number {
  return Number(db.prepare('DELETE FROM limit_samples WHERE ts < ?').run(beforeS).changes);
}
