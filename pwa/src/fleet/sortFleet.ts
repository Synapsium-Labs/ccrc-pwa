import { BUCKET_ORDER, BUCKET_RANK, type FleetSession, type SessionBucket } from '../../../shared/api';

/** Bucket priority for the LIST — not a re-derivation of which bucket a session
 *  is in (the server decided that, `shared/api.ts`'s `sessionBucket`), only of
 *  what order the buckets read in, and that is `shared/api.ts#BUCKET_RANK`, the
 *  one order (D-7188): read here, never typed a second time. */
export const RANK: Readonly<Record<SessionBucket, number>> = BUCKET_RANK;

/** The same order as a list, `shared/api.ts#BUCKET_ORDER`, re-exported for the list's readers. */
export { BUCKET_ORDER };

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
