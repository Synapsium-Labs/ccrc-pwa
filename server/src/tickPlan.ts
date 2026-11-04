/**
 * L1, pure (console speed S1): what one watcher tick reads, decided from its tmux listing and its cold rows. No I/O,
 * no clock, no console: the tick (`watch.ts`) acts on these answers and prints the notice.
 *
 * The polarity is `classifyHasSession`'s: DOUBT READS MORE. A failed listing makes every row hot, every pane
 * captured and every verdict asked the old way, never every session gone.
 */
import { verdictFromListing, type PaneListing, type SessionVerdict } from './exec.js';
import type { SessionRecord } from './registry.js';

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
