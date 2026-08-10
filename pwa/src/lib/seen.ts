import type { FleetSession } from '../../../shared/api';

const KEY = 'ccrc:seen:v1';

export type Acks = Record<string, number>;

/** The buckets that WANT a human. `working` and `idle` are never badged:
 *  nothing is being asked of you, and a badge that fires for ordinary progress
 *  is a badge you learn to ignore. */
const BADGED: ReadonlySet<FleetSession['bucket']> = new Set(['attention', 'done', 'cleanup']);

/**
 * Per-DEVICE, not per-fleet. ccrc has no user accounts, so "seen" is a property
 * of the person holding the phone, not of the fleet — storing this map
 * server-side would let the desktop mark the phone's badge read.
 *
 * The server DOES keep a viewer notion: `server/src/presence.ts`, "which
 * sessions a human is currently LOOKING AT". It is a DIFFERENT fact, not a
 * copy of this one, and the difference is deliberate. Presence collapses
 * across every connected client (`isVisible(id)` is true if ANY connection
 * token claims the session), is never persisted, and is read in exactly one
 * place — the push gate in `watch.ts`'s `pushOne` (watch.ts:237). It neither
 * reads nor writes this map, and nothing writes this map but this device.
 *
 * They therefore disagree, by design, and here is the shipped consequence: the
 * desktop having cc-a on screen suppresses the PUSH for cc-a's attention event
 * for every device — the phone is told nothing — while the phone's own
 * watermark, which the desktop cannot reach, still badges cc-a until this
 * device acks it. That is the intended split: presence decides only whether a
 * notification is sent, this map decides only what this screen draws, and for
 * anything drawn here the watermark wins.
 */
export function loadAcks(): Acks {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Acks = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

// — the map as a subscribable value —
//
// localStorage is a write-through log, not a change feed: writing it notifies
// nobody. Every ack therefore has to be PUBLISHED, or a surface that read the
// map once keeps drawing the map it read. That is not hypothetical — it is the
// shipped path: `SessionScreen` acks on mount (`/s/<id>`), while `FleetScreen`
// stays mounted for the whole app lifetime (app.tsx renders it as the desktop
// sidebar) and the server suppresses a fleet broadcast when nothing changed
// (watch.ts's `lastJson` guard). Without this, opening a merged-and-archived
// session — whose wire record will never change again — left its own unseen
// badge and "Mark all seen" on screen until an unrelated session moved or the
// page reloaded.
//
// One snapshot object, swapped only when the map's CONTENTS change, so
// `useSyncExternalStore` can compare identities: re-publishing an equal map
// (every `prune` that drops nothing, i.e. most of them) must not re-render.
let snapshot: Acks | null = null;
const listeners = new Set<() => void>();

function same(a: Acks, b: Acks): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** Adopt `next` as the current map and wake every subscriber — unless it says
 *  exactly what the current one already does, in which case the existing
 *  object identity survives untouched. Never writes storage; `save` does. */
function publish(next: Acks): Acks {
  if (snapshot !== null && same(snapshot, next)) return snapshot;
  snapshot = next;
  // Copied first: a listener that unsubscribes while being notified (a
  // component unmounting on the render this ack causes) must not shorten the
  // set mid-iteration.
  for (const fn of [...listeners]) fn();
  return snapshot;
}

/** THE map every rendering surface reads, with a stable identity between
 *  changes — pair it with `subscribeAcks` in `useSyncExternalStore`.
 *
 *  Storage is read exactly ONCE per document, here, on first use. It is never
 *  read again, and that is load-bearing rather than an optimisation: every
 *  mutator below bases its next map on THIS snapshot, so a write storage
 *  refuses cannot silently roll the map back.
 *
 *  The path that made it necessary: `save` catches its own `setItem` throw
 *  (quota — `lib/offline.ts` writes the whole fleet snapshot to this same
 *  origin on every broadcast and swallows its own quota errors — or Safari
 *  private mode) and publishes anyway, so the badge clears on screen. When
 *  the mutators re-read storage instead, the very next fleet snapshot ran
 *  `prune`, read the UNCHANGED stored map back, and republished it: the badge
 *  came back seconds later, and two acks in a row kept only the last one.
 *
 *  The cost, stated plainly: another TAB's acks are no longer adopted. They
 *  never were adopted reliably — `prune` only ran on a fleet snapshot — and
 *  the honest fix for that is a `storage` event listener, not a re-read that
 *  outranks this document's own writes. */
export function acksSnapshot(): Acks {
  if (snapshot === null) snapshot = loadAcks();
  return snapshot;
}

/** A fresh, mutable copy of the published map — the base every mutator starts
 *  from. Never `loadAcks()`: see `acksSnapshot` above. */
function base(): Acks {
  return { ...acksSnapshot() };
}

/**
 * Drop the in-memory map and take storage as ground truth again — the ONE
 * supported way to make this module forget.
 *
 * It exists because the snapshot is document-lifetime by design (see
 * `acksSnapshot`): once storage stops being re-read, clearing `localStorage`
 * no longer clears this module, and a test suite that cleared the key between
 * cases was silently carrying the previous case's acks forward. Publishing
 * (rather than nulling `snapshot`) keeps every subscriber in step with the
 * reset instead of leaving them rendering a map nothing else holds.
 */
export function resetAcks(): Acks {
  return publish(loadAcks());
}

/** Subscribe to ack changes. Returns the unsubscribe. */
export function subscribeAcks(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Write through, then publish. The publish happens even when storage refused
 *  (private mode, quota): the map this document is showing is the one in
 *  memory, so an ack a phone cannot persist is still an ack until reload —
 *  and, because every mutator bases off the published snapshot rather than
 *  storage, nothing rolls it back before then. */
function save(acks: Acks): Acks {
  try { localStorage.setItem(KEY, JSON.stringify(acks)); } catch { /* private mode / quota */ }
  return publish(acks);
}

/** The ack key for the fleet-wide notification feed (`/mail`). NAMESPACED
 *  with a colon, which ccd's own id regex (`^[A-Za-z0-9._-]+$`, ccd:1671)
 *  forbids in a session id — so this can never collide with one, and `prune`
 *  below can tell the two apart by SHAPE, never by an allowlist it would have
 *  to maintain by hand. */
export const FEED_ACK_KEY = 'ccrc:feed';

/** THE comparison — moved one level down from `isUnseen` so a thing with no
 *  bucket (a `NotifyEvent`, which has neither `bucket` nor `bucketSince`) can
 *  still be counted by it. Every surface that badges unseen — the fleet
 *  screen's bucket-bar counts, `groupFleet`'s per-project `unseen`, and now
 *  the feed's own unread count — reaches this SAME `>` against the SAME map.
 *  A second implementation is the drift it exists to end. */
export function isUnseenAt(key: string, since: number | null, acks: Acks): boolean {
  if (since === null) return false;
  return since > (acks[key] ?? 0);
}

/** Every surface that badges an unseen SESSION calls this; it is `isUnseenAt`
 *  with the bucket ladder's own two preconditions in front of it. */
export function isUnseen(s: FleetSession, acks: Acks): boolean {
  if (!BADGED.has(s.bucket)) return false;
  return isUnseenAt(s.id, s.bucketSince, acks);
}

/**
 * THE ack stamp, and the reason acks are not simply `Date.now()`.
 *
 * `bucketSince` is minted on the FLEET HOST's clock (shared/api.ts's
 * `sessionBucket`, off `statusUpdatedAt` / the hook's `updatedAt`); both
 * writers of this map stamp the DEVICE's. A laptop just resumed from suspend,
 * or a phone with no NTP, runs behind — and a device 90s behind writes
 * `acks[id] = T - 90_000` for a session whose `bucketSince` is `T`, so
 * `isUnseen` stays true, the chip keeps its count, and "Mark all seen" is a
 * button that visibly does nothing for the whole duration of the skew.
 *
 * An ack means "this human has now seen this episode". The episode's own
 * start is the one instant both clocks agree on, so the stamp is never
 * allowed to land before it. Taking the max (rather than using `bucketSince`
 * outright) keeps a FORWARD-running device honest too: acking at the device's
 * own later `now` is what stops the NEXT episode, which will carry a
 * `bucketSince` after this one, from arriving pre-acked.
 */
function stampFor(at: number, bucketSince: number | null): number {
  return bucketSince === null ? at : Math.max(at, bucketSince);
}

/** Ack one session. Pass the session itself whenever the caller has it — the
 *  `bucketSince` is what makes the stamp survive a clock behind the host's
 *  (see `stampFor`). The id-only form is the deep-link case, where the fleet
 *  snapshot has not landed yet and there is no episode start to floor to. */
export function ack(id: string, at: number, bucketSince: number | null = null): Acks {
  const acks = base();
  acks[id] = stampFor(at, bucketSince);
  return save(acks);
}

export function ackAll(sessions: readonly FleetSession[], at: number): Acks {
  const acks = base();
  for (const s of sessions) acks[s.id] = stampFor(at, s.bucketSince);
  return save(acks);
}

/**
 * Bounded growth: forget acks for sessions the fleet no longer has.
 *
 * An empty `live` prunes NOTHING, because an empty fleet snapshot is not
 * evidence that the fleet is empty — it is equally the shape of a snapshot
 * that failed to read. `readRegistry` returns `[]` when `io.readdir` comes
 * back null (registry dir momentarily missing or unreadable — a home swap, a
 * permissions blip). `watch.ts`'s tick no longer broadcasts that shape (the
 * ladder made it return before emitting), but `server.ts`'s `GET /api/fleet`
 * fallback and the connect-time `/ws/fleet` push still assemble fresh off
 * `readRegistry` and ship the `[]` — as can any pre-ladder server. Pruning
 * against it would delete every entry AND persist the deletion,
 * so one bad second would re-badge the entire fleet as unseen with the real
 * watermark already overwritten in localStorage — unrecoverable, and the
 * loudest possible failure of the one affordance whose whole job is to stay
 * quiet. Absent evidence proves nothing here, exactly as `bucketSince === null`
 * badges nothing in `isUnseen`.
 *
 * The cost, stated plainly: a fleet that legitimately empties keeps its map
 * until the next snapshot that has a session in it. That map is bounded by the
 * largest fleet ever seen on this device and is a few dozen bytes.
 */
export function prune(live: ReadonlySet<string>): Acks {
  // `base()`, never `loadAcks()`: this runs on EVERY fleet snapshot, so a
  // re-read here is the fastest possible rollback of an ack storage refused —
  // the badge cleared, then came back within one tick. See `acksSnapshot`.
  const acks = base();
  if (live.size === 0) return publish(acks);
  let changed = false;
  for (const id of Object.keys(acks)) {
    // A key containing `:` is not a session id (ccd's id regex forbids the
    // character) — it is a namespaced watermark like FEED_ACK_KEY, and the
    // fleet's session list says nothing about whether it is still wanted.
    // Without this the feed's watermark is deleted on the next snapshot AND
    // the deletion is persisted: the whole feed silently re-badges unread and
    // the real mark is gone. Same class as the empty-fleet guard above —
    // absent evidence proves nothing.
    if (id.includes(':')) continue;
    if (!live.has(id)) { delete acks[id]; changed = true; }
  }
  // `publish`, not a bare return, on the unchanged path too: it costs nothing
  // when the map is unchanged (`publish` keeps the existing identity) and it
  // keeps one exit for both paths. It never persists on this path.
  return changed ? save(acks) : publish(acks);
}
