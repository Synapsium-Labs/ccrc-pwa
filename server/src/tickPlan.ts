/**
 * L1, pure (console speed S1): what one watcher tick reads, decided from its tmux listing and its cold rows. No I/O,
 * no clock, no console: the tick (`watch.ts`) acts on these answers and prints the notice.
 *
 * The polarity is `classifyHasSession`'s: DOUBT READS MORE. A failed listing makes every row hot, every pane
 * captured and every verdict asked the old way, never every session gone.
 */
import { verdictFromListing, type PaneListing, type SessionVerdict } from './exec.js';
import type { SessionRecord } from './registry.js';
import type { readLimits } from './limits.js';
import type { ProjectPoolsRead } from './pools.js';
import type { SessionUsage } from '../../shared/api.js';
import { USAGE_FRESH_S } from './usage.js';

/** This tick's verdict per row: null for every id when the listing failed (the registry then treats every row as hot). */
export function verdictsOf(l: PaneListing): (id: string) => SessionVerdict | null {
  return l.ok ? (id) => verdictFromListing(l, id) : () => null;
}

export type TickPlan = { hookIds: ReadonlySet<string>; usageIds: ReadonlySet<string>; captureIds: ReadonlySet<string> };

/** Hook states and usage read the hot rows (a cold row carries its previous entry); the dialog sweep captures the
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
 *  `currentRowFacts`): all stamped with `listedAt`, when the tick's listing began. `pools` is null until this tick's pools
 *  read returns, never the previous tick's value under this tick's stamp. */
export interface TickFacts {
  listedAt: number;
  limits: Awaited<ReturnType<typeof readLimits>>;
  records: ReadonlyMap<string, SessionRecord>;
  listing: PaneListing;
  panePids: ReadonlyMap<string, number | null>;
  pools: ProjectPoolsRead | null;
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
