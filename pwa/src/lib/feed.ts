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

/** Identity of a feed record: `seq` alone is NOT it. `seq` is unique only
 *  WITHIN one `NotifyLog` epoch — `server/src/coord/schema.ts`'s own
 *  `feed_events` comment says so verbatim, and the server mints a fresh epoch
 *  (resetting `seq` to 0) whenever `~/.ccrc/notify-log.json` is missing,
 *  unreadable or malformed, which is a designed-for restart path, not an
 *  error path. `at` is the record's own timestamp, minted once
 *  (`NotifyLog.record`, `Date.now()`) and written identically to both the
 *  in-memory ring (the catch-up tail) and `feed_events` (the durable read) —
 *  so it travels with the record on both paths a client can see it from, and
 *  a `${at}:${seq}` pair is what actually identifies "the same record seen
 *  twice" versus "two different epochs' seq-1 rows". */
const recordKey = (e: NotifyEvent): string => `${e.at}:${e.seq}`;

/** Union two feed sources on record identity (see `recordKey`), oldest first,
 *  capped from the OLD end. The later argument wins a collision: a re-read is
 *  fresher than a cached copy, and a catch-up event that also appears in a
 *  durable read is the same record seen twice, never two records.
 *
 *  Ordered by `at` first, `seq` only as a same-millisecond tiebreaker: `at` is
 *  wall-clock time and keeps increasing across an epoch rotation, while `seq`
 *  resets to 0 there — sorting on `seq` alone would put a freshly-rotated
 *  seq-1 event ahead of everything the previous epoch ever recorded. */
export function mergeBySeq(a: readonly NotifyEvent[], b: readonly NotifyEvent[]): NotifyEvent[] {
  const by = new Map<string, NotifyEvent>();
  for (const e of a) by.set(recordKey(e), e);
  for (const e of b) by.set(recordKey(e), e);
  const all = [...by.values()].sort((x, y) => x.at - y.at || x.seq - y.seq);
  return all.length > FEED_CAP ? all.slice(all.length - FEED_CAP) : all;
}
