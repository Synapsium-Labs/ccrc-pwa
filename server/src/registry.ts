import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';

export interface SessionRecord {
  id: string; wrapper: string; project: string; workdir: string; uuid: string;
  started: boolean; home: string | null; pool: string[] | null; lastswap: number | null;
  workspace: string | null;
}

async function field(io: FleetIO, dir: string, id: string, name: string): Promise<string | null> {
  const content = await io.readFile(path.join(dir, `${id}.${name}`));
  return content !== null ? content.trim() : null;
}

export async function readRegistry(io: FleetIO, cfg: CcrcConfig): Promise<SessionRecord[]> {
  const names = await io.readdir(cfg.registryDir);
  if (names === null) return [];
  const ids = names.filter((n) => n.endsWith('.uuid')).map((n) => n.slice(0, -'.uuid'.length)).sort();
  const out: SessionRecord[] = [];
  for (const id of ids) {
    const [wrapper, project, workdir, uuid, started, home, pool, lastswap, workspace] = await Promise.all([
      field(io, cfg.registryDir, id, 'wrapper'), field(io, cfg.registryDir, id, 'project'),
      field(io, cfg.registryDir, id, 'workdir'), field(io, cfg.registryDir, id, 'uuid'),
      field(io, cfg.registryDir, id, 'started'), field(io, cfg.registryDir, id, 'home'),
      field(io, cfg.registryDir, id, 'pool'), field(io, cfg.registryDir, id, 'lastswap'),
      field(io, cfg.registryDir, id, 'workspace'),
    ]);
    if (!wrapper || !workdir || !uuid) continue;   // incomplete registry entry — skip, don't crash
    out.push({
      id, wrapper, project: project ?? id, workdir, uuid,
      started: started === '1',
      home, pool: pool ? pool.split(/\s+/).filter(Boolean) : null,
      lastswap: lastswap ? parseInt(lastswap, 10) : null,
      workspace,
    });
  }
  return out;
}
