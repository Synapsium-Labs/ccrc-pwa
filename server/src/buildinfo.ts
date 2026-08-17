/** The deploy's build stamp (~/.ccrc/build.json, written by deploy.sh's
 *  stamp_build): what THIS box is running, stated by the box itself. Read
 *  once at boot. Every failure mode is null — absent (dev checkout, never
 *  stamped), unreadable, unparseable, wrong shape — never a throw and never
 *  a partial: /health is the deploy's own verification gate, and a stamp
 *  problem must not take the route down with it. `dirty` rides along so a
 *  working-tree deploy can never masquerade as the clean sha it claims.
 *
 *  THE SHAPE AND ITS VALIDATION LIVE IN `shared/buildinfo.ts` — this file is
 *  now only the filesystem read. The fleet host reads a stamp with these same
 *  four fields (`agent/src/server.ts`, reported as `AgentReady.build` so the
 *  server can compare the two boxes), the agent cannot import from
 *  `server/src`, and two copies of the field checks would be two definitions
 *  of "a well-formed stamp" for a comparison that only works if there is one.
 *  `BuildInfo` is re-exported here so this module still answers the question
 *  its name asks; `server/src/server.ts` and `index.ts` import it unchanged. */
import { readFileSync } from 'node:fs';
import { parseBuildInfo, type BuildInfo } from '../../shared/buildinfo.js';

export type { BuildInfo };

export function readBuildInfo(filePath: string): BuildInfo | null {
  let raw: string;
  try { raw = readFileSync(filePath, 'utf8'); } catch { return null; }
  return parseBuildInfo(raw);
}
