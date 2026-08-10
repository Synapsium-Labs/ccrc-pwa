// Offline shell state. The service worker (vite.config.ts) makes the app
// shell load without a network; this module makes it load with *content*: the
// last fleet snapshot persists to localStorage and the fleet store hydrates
// from it at boot, so a cold start — installed-app launch in a tunnel, on a
// plane — renders the fleet instantly. The data is clearly last-known: the
// store keeps conn 'connecting' until the socket opens, and FleetScreen
// stale-marks everything under that state. /api and /ws are never cached
// (network-only) — this snapshot is the only offline data, by design.
import { reviveFleetSessions, unmeasuredFields, type FleetSession } from '../../../shared/api';

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
export function saveFleetSnapshot(sessions: FleetSession[]): void {
  if (sessions.length === 0) return;
  // `unmeasuredFields`, not `s.unmeasured` directly (blocking review finding
  // 2): a LIVE fleet frame never goes through `reviveFleetSession` (only this
  // module's own persisted-snapshot read does), so a row from a server that
  // predates this field can genuinely lack the key at runtime despite the
  // static type — see `unmeasuredFields`'s own docstring in shared/api.ts.
  if (sessions.some((s) => unmeasuredFields(s).length > 0)) return;
  try {
    const snap: FleetSnapshot = { savedAt: Date.now(), sessions };
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
 *  `archivedAt === undefined` reads as archived. See shared/api.ts. */
export function loadFleetSnapshot(): FleetSnapshot | null {
  try {
    const raw = storage().getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { savedAt, sessions } = parsed as { savedAt?: unknown; sessions?: unknown };
    if (typeof savedAt !== 'number') return null;
    const revived = reviveFleetSessions(sessions);
    if (revived === null) return null;
    return { savedAt, sessions: revived };
  } catch {
    return null;
  }
}
