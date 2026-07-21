// Offline shell state. The service worker (vite.config.ts) makes the app
// shell load without a network; this module makes it load with *content*: the
// last fleet snapshot persists to localStorage and the fleet store hydrates
// from it at boot, so a cold start — installed-app launch in a tunnel, on a
// plane — renders the fleet instantly. The data is clearly last-known: the
// store keeps conn 'connecting' until the socket opens, and FleetScreen
// stale-marks everything under that state. /api and /ws are never cached
// (network-only) — this snapshot is the only offline data, by design.
import type { FleetSession } from '../../../shared/api';

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

/** Last persisted snapshot, or null when absent/corrupt/unreadable. */
export function loadFleetSnapshot(): FleetSnapshot | null {
  try {
    const raw = storage().getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { savedAt, sessions } = parsed as { savedAt?: unknown; sessions?: unknown };
    if (typeof savedAt !== 'number' || !Array.isArray(sessions)) return null;
    return { savedAt, sessions: sessions as FleetSession[] };
  } catch {
    return null;
  }
}
