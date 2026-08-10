// The durable feed's client half.
//
// Two sources, one list. `GET /api/feed` is the durable read (coord.db, so it
// survives the several deploys a day this box takes — the 200-event in-memory
// ring never did); the catch-up response on every socket open is the live tail,
// and `notifymark.ts` advances the durable mark ONE-WAY at the moment that
// response lands. So the tail must be merged and rendered on receipt: there is
// no second chance to ask for it.
import { reviveNotifyEvent, type NotifyEvent } from '../../../shared/api';

/** How many events the store keeps. Mirrors the server ring's own 200
 *  (server/src/notifylog.ts) so the client never pretends to hold more
 *  scrollback than anything upstream can produce in one read. */
export const FEED_CAP = 200;

/**
 * Revive a `GET /api/feed` response. ONE revival function for `NotifyEvent`
 * already exists — `reviveNotifyEvent` (`shared/api.ts`), the same one
 * `notifymark.ts`'s catch-up path uses — and this is a caller of it, never a
 * second implementation: a kind this build does not recognise degrades to
 * `'unknown'`, and any field of the wrong type (including a missing `seq` or
 * `at`, the identity and the ordering — nothing can invent those) rejects the
 * WHOLE event, exactly as that function's own docstring states.
 *
 * The difference from the catch-up path is what happens to a rejection: catch-
 * up drops it silently (the mark has already moved, nothing to do but drop).
 * Here the count travels beside the list, so the screen can say how many
 * records this build could not read. A feed that loses a record silently is
 * the one failure this surface exists to prevent.
 */
export function reviveNotifyEvents(raw: unknown): { events: NotifyEvent[]; dropped: number } {
  if (!Array.isArray(raw)) return { events: [], dropped: 0 };
  const events: NotifyEvent[] = [];
  let dropped = 0;
  for (const item of raw as unknown[]) {
    const e = reviveNotifyEvent(item);
    if (e === null) dropped += 1;
    else events.push(e);
  }
  return { events, dropped };
}

/** Union two feed sources on `seq`, oldest first, capped from the OLD end.
 *  The later argument wins a collision: a re-read is fresher than a cached
 *  copy, and a catch-up event that also appears in a durable read is the same
 *  record seen twice, never two records. */
export function mergeBySeq(a: readonly NotifyEvent[], b: readonly NotifyEvent[]): NotifyEvent[] {
  const by = new Map<number, NotifyEvent>();
  for (const e of a) by.set(e.seq, e);
  for (const e of b) by.set(e.seq, e);
  const all = [...by.values()].sort((x, y) => x.seq - y.seq);
  return all.length > FEED_CAP ? all.slice(all.length - FEED_CAP) : all;
}
