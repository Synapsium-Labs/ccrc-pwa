/**
 * L1, pure (console speed S1): which registry rows a watcher tick must read in full (`hot`) and which it may take
 * from the previous tick (`cold`). Imports types and one constant only; no fs, no clock (the caller passes `nowMs`).
 *
 * The doctrine is the polarity of `classifyHasSession`: DOUBT READS HOT. A row is cold only when every condition
 * below is positively measured, so a missing previous read, an unclean record, an unknown verdict or no listing at
 * all each make the row hot, never cold.
 */
import { HOLD_UNREADABLE, type SessionRecord } from './registry.js';
import type { SessionVerdict } from './exec.js';

/** A cold row is re-read in full at least this often, whatever its key says. */
export const COLD_ROW_REREAD_MS = 30_000;

/** The registry listing's fingerprint of one row: the sorted names of `<id>.*` entries and, when the agent gave
 *  them, their mtimes in the same order. `times: null` = the agent gave none (names-only key). */
export type RowKey = { names: readonly string[]; times: readonly number[] | null };

/** Names equal; times: both null compare on names alone, one null and one present are NOT equal, both present
 *  compare element-wise. */
export function rowKeyEqual(a: RowKey, b: RowKey): boolean {
  if (a.names.length !== b.names.length) return false;
  for (let i = 0; i < a.names.length; i++) if (a.names[i] !== b.names[i]) return false;
  if (a.times === null && b.times === null) return true;
  if (a.times === null || b.times === null) return false;
  if (a.times.length !== b.times.length) return false;
  for (let i = 0; i < a.times.length; i++) if (a.times[i] !== b.times[i]) return false;
  return true;
}

/** A record every field of which was measured: nothing unmeasured, no lifecycle field unmeasured, and a hold that
 *  was readable. The one predicate for "may be reused or cached" (the row cache uses this too). */
export function isCleanRecord(rec: SessionRecord): boolean {
  return rec.unmeasured.length === 0 && rec.lifecycleUnmeasured.length === 0 && rec.held !== HOLD_UNREADABLE;
}

export type PrevRow = { record: SessionRecord; key: RowKey; readAt: number };

export function rowTemperature(
  prev: PrevRow | undefined,
  verdict: SessionVerdict | null,
  key: RowKey,
  nowMs: number,
): 'hot' | 'cold' {
  if (prev === undefined) return 'hot';
  if (!isCleanRecord(prev.record)) return 'hot';
  if (prev.record.stopped === null && prev.record.archivedAt === null) return 'hot';
  if (verdict?.verdict !== 'gone') return 'hot';
  if (!rowKeyEqual(prev.key, key)) return 'hot';
  const age = nowMs - prev.readAt;
  if (age < 0 || age >= COLD_ROW_REREAD_MS) return 'hot';
  return 'cold';
}

/** With times only: a clean row whose key (names AND mtimes) is unchanged reuses its record even when hot. A
 *  names-only key cannot see a rewrite in place, so it never licenses reuse. */
export function hotRowReuse(prev: PrevRow | undefined, key: RowKey): boolean {
  if (prev === undefined || key.times === null || prev.key.times === null) return false;
  return isCleanRecord(prev.record) && rowKeyEqual(prev.key, key);
}
