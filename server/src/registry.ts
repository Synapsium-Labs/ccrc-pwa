import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CcrcConfig } from './config.js';

export interface SessionRecord {
  id: string; wrapper: string; project: string; workdir: string; uuid: string;
  started: boolean; home: string | null; pool: string[] | null; lastswap: number | null;
}

async function field(dir: string, id: string, name: string): Promise<string | null> {
  try { return (await readFile(path.join(dir, `${id}.${name}`), 'utf8')).trim(); }
  catch { return null; }
}

export async function readRegistry(cfg: CcrcConfig): Promise<SessionRecord[]> {
  let names: string[];
  try { names = await readdir(cfg.registryDir); } catch { return []; }
  const ids = names.filter((n) => n.endsWith('.uuid')).map((n) => n.slice(0, -'.uuid'.length)).sort();
  const out: SessionRecord[] = [];
  for (const id of ids) {
    const [wrapper, project, workdir, uuid, started, home, pool, lastswap] = await Promise.all([
      field(cfg.registryDir, id, 'wrapper'), field(cfg.registryDir, id, 'project'),
      field(cfg.registryDir, id, 'workdir'), field(cfg.registryDir, id, 'uuid'),
      field(cfg.registryDir, id, 'started'), field(cfg.registryDir, id, 'home'),
      field(cfg.registryDir, id, 'pool'), field(cfg.registryDir, id, 'lastswap'),
    ]);
    if (!wrapper || !workdir || !uuid) continue;   // incomplete registry entry — skip, don't crash
    out.push({
      id, wrapper, project: project ?? id, workdir, uuid,
      started: started === '1',
      home, pool: pool ? pool.split(/\s+/).filter(Boolean) : null,
      lastswap: lastswap ? parseInt(lastswap, 10) : null,
    });
  }
  return out;
}
