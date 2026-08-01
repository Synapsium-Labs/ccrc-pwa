import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { reviveFleetSessions, type FleetSession } from '../../shared/api.js';

/**
 * Degraded-mode snapshot cache, and the ONE declaration of fleet reachability.
 *
 * `remote/client.ts` used to declare its own structurally identical
 * `FleetState`; it now imports this one. The rule that mattered is unchanged —
 * this module must never import from `remote/`, so local-mode code still needs
 * no knowledge that the remote client exists — but two copies of a type that
 * must stay in lockstep is how `ccdVerbs` would have been added to one of them
 * and read off the other.
 */
export interface FleetState {
  connected: boolean;
  downSince: number | null;
  /** What `ccd caps` printed on the fleet host, or null when we have no
   *  evidence (local mode, or an agent old enough not to send it). Null is
   *  NOT "no verbs" — the server treats it as "do not block". */
  ccdVerbs: string[] | null;
}

export interface FleetSnapshot { sessions: FleetSession[]; savedAt: number }

/**
 * Cache lives on THIS box's disk — the one running ccrc-server — regardless
 * of fleet mode. Same stance as server.ts's dist-pwa existsSync check: this
 * is local-box housekeeping, never proxied through FleetIO/the agent.
 */
export function defaultCachePath(home: string = homedir()): string {
  return path.join(home, '.ccrc', 'state-cache.json');
}

/** Atomic write: tmp file in the same directory, then rename over the target
 *  — a reader never observes a partially-written cache file. */
export async function saveSnapshot(sessions: FleetSession[], cachePath: string): Promise<void> {
  const dir = path.dirname(cachePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.state-cache.${process.pid}.${Date.now()}.tmp`);
  const snapshot: FleetSnapshot = { sessions, savedAt: Date.now() };
  await writeFile(tmpPath, JSON.stringify(snapshot));
  await rename(tmpPath, cachePath);
}

/** Never throws — missing file, unreadable file, or corrupt JSON all
 *  collapse to null (same "no data" stance as `localIO`'s read ops).
 *
 *  There is no version key to bump here and nowhere to put one: the path is
 *  fixed, and renaming the file would discard the degraded-mode snapshot at the
 *  exact moment it is needed — the fleet host being down. So the READ is the
 *  version negotiation: sessions are revived into today's shape (shared/api.ts),
 *  and a cache that cannot be revived is treated as absent, which the route
 *  already handles by assembling live. */
export async function loadSnapshot(cachePath: string): Promise<FleetSnapshot | null> {
  let raw: string;
  try {
    raw = await readFile(cachePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { sessions, savedAt } = parsed as { sessions?: unknown; savedAt?: unknown };
    if (typeof savedAt !== 'number') return null;
    const revived = reviveFleetSessions(sessions);
    if (revived === null) return null;
    return { sessions: revived, savedAt };
  } catch {
    return null;
  }
}
