// Offline shell state. The service worker (vite.config.ts) makes the app
// shell load without a network; this module makes it load with *content*: the
// last fleet snapshot persists to localStorage and the fleet store hydrates
// from it at boot, so a cold start — installed-app launch in a tunnel, on a
// plane — renders the fleet instantly. The data is clearly last-known: the
// store keeps conn 'connecting' until the socket opens, and FleetScreen
// stale-marks everything under that state. /api and /ws are never cached
// (network-only) — this snapshot is the only offline data, by design.
import { reviveFleetSessions, unmeasuredFields, type FleetSession, type RosterWire } from '../../../shared/api';
import { HUES } from '../../../shared/roster';

// Stays at v1 — deliberately. A snapshot written before `tasks`/`pr`/`archivedAt`
// existed is still usable data, and the read normalizes it (reviveFleetSessions);
// bumping the key would instead throw it away, cold-starting the app empty, which
// is the one thing this module exists to prevent — and would need bumping again
// for every future nullable field.
const KEY = 'ccrc.fleet-snapshot.v1';

// Always via `window.` — Node 22+ ships an experimental bare `localStorage`
// global that shadows jsdom's working one under vitest.
const storage = (): Storage => window.localStorage;

export interface FleetSnapshot {
  savedAt: number; // epoch ms of the snapshot
  sessions: FleetSession[];
  /** The account roster, at the moment this snapshot was written (fix round
   *  1, finding 3). Cold-offline-start's whole reason to exist is rendering
   *  *something* instantly — without this, `accountLabel`/`accountColorVar`
   *  read an empty roster on a cold start exactly as they would before the
   *  first `/api/accounts` poll, and every account rendered as its raw
   *  wrapper id (`claude2`, `claude-corp`) instead of the jargon-free label
   *  this module exists to restore. Against the compile-time roster this
   *  replaced, that case never existed — labels were always available,
   *  synchronously, with no snapshot involved. `[]` for a pre-Task-7
   *  snapshot, same as an unarrived roster. */
  roster: RosterWire[];
}

/** Loose but real validation for a `RosterWire` read back out of localStorage
 *  — same-origin JS can write this key too, and an older or half-written
 *  build's snapshot is not attacker input but is still untrusted shape at
 *  runtime (`pwa/src/lib/api.ts`'s `getJson` is a bare cast; nothing upstream
 *  of this module ever validated `roster`). Not full `parseRoster`-grade
 *  parsing — a persisted UI cache degrading a malformed entry to "not there"
 *  is enough; it does not need `RosterError`'s named remedies, since nobody
 *  reads this file by hand. */
function isRosterWireLike(v: unknown): v is RosterWire {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['id'] === 'string' && typeof o['label'] === 'string'
    && typeof o['homeAble'] === 'boolean'
    && typeof o['hue'] === 'string' && (HUES as readonly string[]).includes(o['hue']);
}

/** Best-effort persist — quota errors and private-mode walls are swallowed;
 *  the app simply cold-starts empty next time.
 *
 *  Refuses two frame shapes before ever touching storage (Task 2), both for
 *  the SAME reason `lib/seen.ts`'s `prune` already states for its own refusal
 *  ("An empty `live` prunes NOTHING, because an empty fleet snapshot is not
 *  evidence that the fleet is empty — it is equally the shape of a snapshot
 *  that failed to read" — `seen.ts:198-208`): absent evidence proves nothing,
 *  and persisting a guess as fact defeats the one thing a last-known-good
 *  cache exists for, at exactly the moment (a real outage) it matters.
 *
 *  - An EMPTY frame (`sessions.length === 0`). `readRegistry` answers `[]`
 *    on `io.readdir` failure (registry.ts) the SAME way it would for a
 *    genuinely empty fleet — and while `watch.ts`'s tick path now refuses to
 *    broadcast that shape (it takes `readRegistryMeasured` and returns before
 *    `bus.emit('fleet', …)`), TWO producers still ship it: `server.ts`'s
 *    `GET /api/fleet` fallback and the connect-time `/ws/fleet` push both
 *    call `assembleFleet` fresh and take `readRegistry`'s `[]`-on-unlistable
 *    answer — plus any older server predating the ladder (the same
 *    FLEET_PROTO-stays-1 skew the `unmeasured` revival tolerates). So this
 *    guard is defence in depth behind the watcher's, not a duplicate of it,
 *    and stays load-bearing even after the tick path was closed. The cost,
 *    stated as plainly as `seen.ts` states its own: a fleet that
 *    legitimately empties keeps its LAST snapshot until the next frame that
 *    has a session in it.
 *  - A frame carrying even ONE degraded row (`unmeasured` non-empty — the
 *    registry ladder's own evidence that this pass could not measure that
 *    session's identity). That row's `status`/`branch`/etc may be frozen at
 *    a fallback rather than freshly read; persisting it as last-known-good
 *    would serve the guess as fact through the very outage this cache is
 *    for. Same reasoning `watch.ts`'s own state-cache guard applies
 *    server-side (Task 2) — this is the client-side mirror of that gate,
 *    independently enforced because the two caches (this one, and
 *    `~/.ccrc/state-cache.json`) have no other seam in common. */
/** `roster` defaults to `[]`, not "whatever was there before" — a caller that
 *  wants the persisted roster carried forward passes it explicitly
 *  (`stores/fleet.ts`'s only production call site does, with `get().roster`).
 *  A default that silently preserved would need to read storage itself to
 *  know what to preserve, which is a second read this function has never
 *  needed for `sessions` either. */
export function saveFleetSnapshot(sessions: FleetSession[], roster: readonly RosterWire[] = []): void {
  if (sessions.length === 0) return;
  // `unmeasuredFields`, not `s.unmeasured` directly (blocking review finding
  // 2): a LIVE fleet frame never goes through `reviveFleetSession` (only this
  // module's own persisted-snapshot read does), so a row from a server that
  // predates this field can genuinely lack the key at runtime despite the
  // static type — see `unmeasuredFields`'s own docstring in shared/api.ts.
  if (sessions.some((s) => unmeasuredFields(s).length > 0)) return;
  try {
    const snap: FleetSnapshot = { savedAt: Date.now(), sessions, roster: [...roster] };
    storage().setItem(KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}

/** Last persisted snapshot, or null when absent/corrupt/unreadable.
 *
 *  The snapshot outlives the build that wrote it — an installed PWA updates
 *  around it — so the sessions are REVIVED into today's shape rather than cast:
 *  fields added since get their nulls, and anything that cannot be a
 *  FleetSession rejects the whole snapshot instead of hydrating a fleet whose
 *  `archivedAt === undefined` reads as archived. See shared/api.ts.
 *
 *  `roster` is NOT held to the same all-or-nothing standard `sessions` is —
 *  a snapshot written before this field existed (every snapshot on disk the
 *  moment it ships) is not corrupt, it is version skew, and rejecting the
 *  whole snapshot over it would throw away the sessions too, right when the
 *  offline cache matters most. Absent, wrong-shaped, or holding an
 *  individually malformed entry all degrade to `[]` / a filtered array
 *  rather than failing the read — the same "unarrived roster" state
 *  `accountLabel`/`accountColorVar` already have a fallback for. */
export function loadFleetSnapshot(): FleetSnapshot | null {
  try {
    const raw = storage().getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { savedAt, sessions, roster } = parsed as { savedAt?: unknown; sessions?: unknown; roster?: unknown };
    if (typeof savedAt !== 'number') return null;
    const revived = reviveFleetSessions(sessions);
    if (revived === null) return null;
    const revivedRoster = Array.isArray(roster) ? roster.filter(isRosterWireLike) : [];
    return { savedAt, sessions: revived, roster: revivedRoster };
  } catch {
    return null;
  }
}
