import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import { PR_PHASES, type PrPhase } from '../../shared/api.js';

export interface SessionRecord {
  id: string; wrapper: string; project: string; workdir: string; uuid: string;
  started: boolean; home: string | null; pool: string[] | null; lastswap: number | null;
  workspace: string | null; branch: string | null;
  /** `origin/main` — what ws-add recorded as this branch's base (ccd:221).
   *  Never re-derived: a proof against a base the workspace was not cut from
   *  is a proof about a different question. */
  base: string | null;
  /** Written by `ccd pr-state`, read here. The server cannot write the
   *  registry — the agent's write whitelist is `.cc-clips` only — so the box
   *  that reads GitHub is the box that persists the answer. Persisted at all
   *  so a server restart degrades to HONEST STALE, never to silence. */
  prPhase: PrPhase | null;
  prNumber: number | null;
  prCheckedAt: number | null;    // epoch ms
  archivedAt: number | null;     // epoch seconds
  /** The worktree size ws-archive measured AT ARCHIVE TIME. Null when the
   *  manifest is absent or half-written — never 0, which would argue
   *  against a cleanup that would free gigabytes. */
  archivedBytes: number | null;
}

async function field(io: FleetIO, dir: string, id: string, name: string): Promise<string | null> {
  const content = await io.readFile(path.join(dir, `${id}.${name}`));
  return content !== null ? content.trim() : null;
}

/** A registry field as a finite number, or null. `parseInt` alone yields NaN
 *  for a truncated write, and NaN on the wire renders as `null` in JSON while
 *  typing as `number` — a silent lie. */
function numOrNull(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

function manifestBytes(raw: string | null): number | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    const n = typeof v === 'object' && v !== null ? (v as { worktreeBytes?: unknown }).worktreeBytes : null;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function readRegistry(io: FleetIO, cfg: CcrcConfig): Promise<SessionRecord[]> {
  const names = await io.readdir(cfg.registryDir);
  if (names === null) return [];
  const ids = names.filter((n) => n.endsWith('.uuid')).map((n) => n.slice(0, -'.uuid'.length)).sort();
  const out: SessionRecord[] = [];
  for (const id of ids) {
    const [wrapper, project, workdir, uuid, started, home, pool, lastswap, workspace, branch,
      base, prPhaseRaw, prNumberRaw, prCheckedAtRaw, archivedRaw, manifestRaw] = await Promise.all([
      field(io, cfg.registryDir, id, 'wrapper'), field(io, cfg.registryDir, id, 'project'),
      field(io, cfg.registryDir, id, 'workdir'), field(io, cfg.registryDir, id, 'uuid'),
      field(io, cfg.registryDir, id, 'started'), field(io, cfg.registryDir, id, 'home'),
      field(io, cfg.registryDir, id, 'pool'), field(io, cfg.registryDir, id, 'lastswap'),
      field(io, cfg.registryDir, id, 'workspace'), field(io, cfg.registryDir, id, 'branch'),
      field(io, cfg.registryDir, id, 'base'), field(io, cfg.registryDir, id, 'prphase'),
      field(io, cfg.registryDir, id, 'prnumber'), field(io, cfg.registryDir, id, 'prcheckedat'),
      field(io, cfg.registryDir, id, 'archived'), field(io, cfg.registryDir, id, 'archivemanifest'),
    ]);
    if (!wrapper || !workdir || !uuid) continue;   // incomplete registry entry — skip, don't crash
    out.push({
      id, wrapper, project: project ?? id, workdir, uuid,
      started: started === '1',
      home, pool: pool ? pool.split(/\s+/).filter(Boolean) : null,
      lastswap: lastswap ? parseInt(lastswap, 10) : null,
      workspace, branch,
      base,
      // A phase this build does not know degrades to null (= unchecked), never
      // to a raw string the PWA would switch on and render as nothing.
      prPhase: PR_PHASES.includes(prPhaseRaw as PrPhase) ? (prPhaseRaw as PrPhase) : null,
      prNumber: numOrNull(prNumberRaw),
      prCheckedAt: numOrNull(prCheckedAtRaw),
      archivedAt: numOrNull(archivedRaw),
      /** The worktree size ws-archive measured AT ARCHIVE TIME. Null when the
       *  manifest is absent or half-written — never 0, which would argue
       *  against a cleanup that would free gigabytes. */
      archivedBytes: manifestBytes(manifestRaw),
    });
  }
  return out;
}
