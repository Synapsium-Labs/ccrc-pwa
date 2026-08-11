/** The deploy's build stamp (~/.ccrc/build.json, written by deploy.sh's
 *  stamp_build): what THIS box is running, stated by the box itself. Read
 *  once at boot. Every failure mode is null — absent (dev checkout, never
 *  stamped), unreadable, unparseable, wrong shape — never a throw and never
 *  a partial: /health is the deploy's own verification gate, and a stamp
 *  problem must not take the route down with it. `dirty` rides along so a
 *  working-tree deploy can never masquerade as the clean sha it claims. */
import { readFileSync } from 'node:fs';

export interface BuildInfo {
  sha: string;
  ref: string;
  builtAt: string;
  dirty: boolean;
}

export function readBuildInfo(filePath: string): BuildInfo | null {
  let raw: string;
  try { raw = readFileSync(filePath, 'utf8'); } catch { return null; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.sha !== 'string' || typeof o.ref !== 'string'
    || typeof o.builtAt !== 'string' || typeof o.dirty !== 'boolean') return null;
  return { sha: o.sha, ref: o.ref, builtAt: o.builtAt, dirty: o.dirty };
}
