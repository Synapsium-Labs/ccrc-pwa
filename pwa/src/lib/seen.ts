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

function save(acks: Acks): Acks {
  try { localStorage.setItem(KEY, JSON.stringify(acks)); } catch { /* private mode / quota */ }
  return acks;
}

/** THE comparison. Every surface — bucket header counts, row badge, the bell —
 *  calls this one function; a second implementation is the drift it exists to
 *  end. */
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
  if (live.size === 0) return acks;
  let changed = false;
  for (const id of Object.keys(acks)) if (!live.has(id)) { delete acks[id]; changed = true; }
  return changed ? save(acks) : acks;
}
