// L1, context C3 (Session Conversation): who writes the route field `compact` (Overlord spec §3.3.4 C39, §3.6 H1; W1a renewal
// act, carrying launch profiles PR B's departure `compact-owned-while-continuity-live`, review 2024 F3). Pure.
//
// While `continuity` is live the launch-profile lane owns the compaction columns: it writes every session's `compact` to its
// role's profile, or clears it for a role without one, on its next pass, so a value a door wrote would be undone a minute
// later. So the route doors that write a single field (the operator's `POST /api/sessions/:id/route` and the coordinator's
// `POST /api/runs/:id/route`) refuse `compact` while `continuity` is live, with words that say why; in shadow they write it
// as before (slug compact-refused-at-the-route-doors).

/** The words the doors refuse `compact` with while `continuity` is live. */
export const COMPACT_OWNED_DETAIL = 'compact is written by the launch-profile lane while the continuity row is live, '
  + 'so a value set here would be undone on its next pass';

/** The refusal's detail when a door may not write `field` now, or null when it may. */
export function compactRefusal(field: string, continuityLive: boolean): string | null {
  return continuityLive && field === 'compact' ? COMPACT_OWNED_DETAIL : null;
}
