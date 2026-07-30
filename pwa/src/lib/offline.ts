// Offline shell state. The service worker (vite.config.ts) makes the app
// shell load without a network; this module makes it load with *content*: the
// last fleet snapshot persists to localStorage and the fleet store hydrates
// from it at boot, so a cold start — installed-app launch in a tunnel, on a
// plane — renders the fleet instantly. The data is clearly last-known: the
// store keeps conn 'connecting' until the socket opens, and FleetScreen
// stale-marks everything under that state. /api and /ws are never cached
// (network-only) — this snapshot is the only offline data, by design.
import { reviveFleetSessions, type FleetSession } from '../../../shared/api';

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
 *  the app simply cold-starts empty next time. */
export function saveFleetSnapshot(sessions: FleetSession[]): void {
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
