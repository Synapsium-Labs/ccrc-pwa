import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { FleetSession } from '../../shared/api.js';

/**
 * Degraded-mode snapshot cache. Structurally mirrors `remote/client.ts`'s
 * `FleetState` (connected + downSince) WITHOUT importing it, so local-mode
 * code (and this module) never needs to know the remote client exists.
 */
export interface FleetState { connected: boolean; downSince: number | null }

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
 *  collapse to null (same "no data" stance as `localIO`'s read ops). */
export async function loadSnapshot(cachePath: string): Promise<FleetSnapshot | null> {
  let raw: string;
  try {
    raw = await readFile(cachePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<FleetSnapshot>;
    if (!Array.isArray(parsed.sessions) || typeof parsed.savedAt !== 'number') return null;
    return { sessions: parsed.sessions, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}
