import type { FleetSession, SessionBucket } from '../../../shared/api';

/** Bucket priority for the LIST — not a re-derivation of which bucket a session
 *  is in (the server decided that, `shared/api.ts`'s `sessionBucket`), only of
 *  what order the buckets read in. Exported: `FleetScreen`'s bucket sections
 *  render in this same order, from this same constant — one ordering, not two. */
export const RANK: Record<SessionBucket, number> = {
  attention: 0, done: 1, idle: 2, working: 3, cleanup: 4, archived: 5, dead: 6,
};

/** `RANK`'s keys, ascending by value — computed rather than typed a second
 *  time, so retuning a priority above can never leave this order stale. */
export const BUCKET_ORDER: readonly SessionBucket[] =
  (Object.keys(RANK) as SessionBucket[]).slice().sort((a, b) => RANK[a] - RANK[b]);

/**
 * Order the fleet by the server's own bucket, then most-recently-interacted
 * first within a bucket (statusUpdatedAt desc, id as a stable tiebreak). Pure
 * — returns a new array. Does not decide which bucket a session is in: that
 * decision is `sessionBucket` (shared/api.ts), run once, server-side.
 */
export function sortFleet(sessions: FleetSession[]): FleetSession[] {
  return [...sessions].sort((a, b) => {
    const r = RANK[a.bucket] - RANK[b.bucket];
    if (r !== 0) return r;
    const ta = a.statusUpdatedAt ?? -Infinity;
    const tb = b.statusUpdatedAt ?? -Infinity;
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
