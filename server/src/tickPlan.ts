/**
 * L1, pure (console speed S1): what one watcher tick reads, decided from its tmux listing and its cold rows. No I/O,
 * no clock, no console: the tick (`watch.ts`) acts on these answers and prints the notice.
 *
 * The polarity is `classifyHasSession`'s: DOUBT READS MORE. A failed listing makes every row hot, every pane
 * captured and every verdict asked the old way, never every session gone.
 */
import type { SessionVerdict } from './exec.js';
import { tmuxName } from '../../shared/tmux-target.js';
import type { SessionRecord } from './registry.js';
import type { AccountLimits } from './limits.js';
import type { SessionUsage } from '../../shared/api.js';
import { USAGE_FRESH_S } from './usage.js';
import { COLD_ROW_REREAD_MS } from './rowTemperature.js';

/** One whole-server pane listing. `panes` is keyed by the tmux SESSION NAME (`tmuxName(id)`), never by id: the name
 *  replaces `.` and `:`, so the map is read id to name (`verdictFromListing`) and never name to id.
 *
 *  THE POLARITY OF `classifyHasSession` HOLDS HERE: a session is `gone` ONLY on a clean listing that lacks its name.
 *  A listing that did not run, exited non-zero (tmux with no server also does, and that case is not told apart: the
 *  caller falls back to the per-row calls, which do tell), was cut short by a signal, or has a line this parser does
 *  not know answers `ok: false`, and a failed listing never reads as gone. `detail` is never ''. */
export type PaneListing =
  | { ok: true; at: number; panes: ReadonlyMap<string, { pid: number | null }> }
  | { ok: false; at: number; detail: string };

/** `live` when `tmuxName(id)` is in a clean listing, else `gone` (the polarity note on `PaneListing`). */
export function verdictFromListing(l: PaneListing & { ok: true }, id: string): SessionVerdict {
  return l.panes.has(tmuxName(id)) ? { verdict: 'live' } : { verdict: 'gone' };
}

/** The pid the listing gives `id`'s session (its active window's lowest pane), or null: not listed, or listed with no
 *  active window. Same `tmuxName` key rule as `verdictFromListing`. */
export function pidFromListing(l: PaneListing & { ok: true }, id: string): number | null {
  return l.panes.get(tmuxName(id))?.pid ?? null;
}

/** This tick's verdict per row: null for every id when the listing failed (the registry then treats every row as hot). */
export function verdictsOf(l: PaneListing): (id: string) => SessionVerdict | null {
  return l.ok ? (id) => verdictFromListing(l, id) : () => null;
}

export type TickPlan = { hookIds: ReadonlySet<string>; usageIds: ReadonlySet<string>; captureIds: ReadonlySet<string> };

/** Hook states read the hot rows (a cold row carries its previous entry); usage reads the hot rows too, and `usageReadIds`
 *  widens that set by age at the lane run; the dialog sweep captures the
 *  rows the listing names live, or every row when the listing failed. */
export function planTick(records: readonly SessionRecord[], cold: ReadonlySet<string>, listing: PaneListing): TickPlan {
  const hot = new Set(records.filter((r) => !cold.has(r.id)).map((r) => r.id));
  const capture = listing.ok ? records.filter((r) => verdictFromListing(listing, r.id).verdict === 'live') : records;
  return { hookIds: hot, usageIds: hot, captureIds: new Set(capture.map((r) => r.id)) };
}

/** Log latch: a warning only on the first failed listing of a run of failures; an ok listing resets it. */
export function listingNotice(prevFailed: boolean, l: PaneListing): { failed: boolean; warn: string | null } {
  if (l.ok) return { failed: false, warn: null };
  return { failed: true, warn: prevFailed ? null : `ccrc-server: tmux list-panes failed, asking each row the old way: ${l.detail}` };
}

/** The rows one usage lane run reads: every hot row, and any row (cold included) with no recorded read or whose last
 *  read is `COLD_ROW_REREAD_MS` or more old. A negative age reads. So a cold row's carried entry is never older than
 *  the re-read bound at a lane run, and a cold row is read no more often than that bound. */
export function usageReadIds(
  records: readonly SessionRecord[], hot: ReadonlySet<string>, lastReadAt: ReadonlyMap<string, number>, nowMs: number,
): Set<string> {
  const ids = new Set<string>();
  for (const r of records) {
    const at = lastReadAt.get(r.id);
    if (hot.has(r.id) || at === undefined || nowMs - at < 0 || nowMs - at >= COLD_ROW_REREAD_MS) ids.add(r.id);
  }
  return ids;
}

/** A usage entry carried over a sweep that did not read it (a cold row): `stale` is this sweep's own verdict, so it is
 *  re-derived against `nowS` and never copied (the unreadable arm's rule, ruling R5). */
export function carriedUsage(kept: SessionUsage, nowS: number): SessionUsage {
  return { ...kept, stale: nowS - kept.ts > USAGE_FRESH_S };
}

/** A listing call that rejected (no adapter does today) reads as a failed listing, so the tick falls back per row. */
export function rejectedListing(at: number, err: unknown): PaneListing {
  return { ok: false, at, detail: `tmux list-panes threw: ${err instanceof Error ? err.message : String(err)}` };
}

/** What one listed tick measured, as the watcher publishes it (`currentLimits`, `currentProjectPoolsRead`,
 *  `currentRowFacts`): all stamped with `listedAt`, when the tick's listing began. */
export interface TickFacts {
  listedAt: number;
  limits: Record<string, AccountLimits>;
  records: ReadonlyMap<string, SessionRecord>;
  listing: PaneListing;
  panePids: ReadonlyMap<string, number | null>;
}

/** One row's facts, a copy. On a tick whose listing failed no verdict was measured by the tick (assembleFleet asked each
 *  row the old way and kept the answer to itself), so the answer is null rather than a guess. */
export function rowFactsOf(f: TickFacts, id: string): { record: SessionRecord; verdict: SessionVerdict; pid: number | null; listedAt: number } | null {
  const record = f.records.get(id);
  if (record === undefined || !f.listing.ok) return null;
  return structuredClone({ record, verdict: verdictFromListing(f.listing, id), pid: f.panePids.get(id) ?? null, listedAt: f.listedAt });
}

/** A row's change signature: its verdict word and its record's JSON. A tick with no verdict (a failed listing) keeps the
 *  previous tick's word, so a listing that fails and recovers does not read as every row changing. */
export function rowSignatures(records: readonly SessionRecord[], listing: PaneListing, prev: ReadonlyMap<string, string>): Map<string, string> {
  const word = (id: string): string => (listing.ok ? verdictFromListing(listing, id).verdict : prev.get(id)?.split('|', 1)[0] ?? '');
  return new Map(records.map((r) => [r.id, `${word(r.id)}|${JSON.stringify(r)}`] as const));
}

/** The ids whose signature differs between two ticks, new rows included, and the ids that left the listing. */
export function changedRows(prev: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): string[] {
  return [...next].filter(([id, sig]) => prev.get(id) !== sig).map(([id]) => id).concat([...prev.keys()].filter((id) => !next.has(id)));
}
