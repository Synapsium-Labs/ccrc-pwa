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
 *  changes — pair it with `subscribeAcks` in `useSyncExternalStore`. Reads
 *  storage exactly once, on first use; after that this module is the only
 *  writer in the document, so the snapshot cannot go stale behind it. */
export function acksSnapshot(): Acks {
  if (snapshot === null) snapshot = loadAcks();
  return snapshot;
}

/** Subscribe to ack changes. Returns the unsubscribe. */
export function subscribeAcks(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function save(acks: Acks): Acks {
  try { localStorage.setItem(KEY, JSON.stringify(acks)); } catch { /* private mode / quota */ }
  return publish(acks);
}

/** THE comparison. Every surface that badges unseen calls this one function —
 *  today that is the fleet screen's bucket-bar counts and `groupFleet`'s
 *  per-project `unseen`; a row badge or a bell counter, when either arrives,
 *  calls it too. A second implementation is the drift it exists to end. */
export function isUnseen(s: FleetSession, acks: Acks): boolean {
  if (!BADGED.has(s.bucket)) return false;
  if (s.bucketSince === null) return false;
  return s.bucketSince > (acks[s.id] ?? 0);
}

export function ack(id: string, at: number): Acks {
  const acks = loadAcks();
  acks[id] = at;
  return save(acks);
}

export function ackAll(sessions: readonly FleetSession[], at: number): Acks {
  const acks = loadAcks();
  for (const s of sessions) acks[s.id] = at;
  return save(acks);
}

/**
 * Bounded growth: forget acks for sessions the fleet no longer has.
 *
 * An empty `live` prunes NOTHING, because an empty fleet snapshot is not
 * evidence that the fleet is empty — it is equally the shape of a snapshot
 * that failed to read. `readRegistry` returns `[]` when `io.readdir` comes
 * back null (registry dir momentarily missing or unreadable — a home swap, a
 * permissions blip), and `watch.ts` broadcasts that `[]` with no non-empty
 * guard. Pruning against it would delete every entry AND persist the deletion,
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
  const acks = loadAcks();
  if (live.size === 0) return publish(acks);
  let changed = false;
  for (const id of Object.keys(acks)) if (!live.has(id)) { delete acks[id]; changed = true; }
  // `publish`, not a bare return, on the unchanged path too: this runs on every
  // fleet snapshot, so it is also the moment a map written by another tab is
  // adopted. It costs nothing when the map is unchanged — `publish` keeps the
  // existing identity — and it never persists on this path.
  return changed ? save(acks) : publish(acks);
}
