import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface LiveState {
  pid: number; sessionId: string; cwd: string; name: string | null;
  status: string; statusUpdatedAt: number | null; version: string | null;
}

export async function readLiveState(configDir: string, pid: number): Promise<LiveState | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(configDir, 'sessions', `${pid}.json`), 'utf8'));
    if (typeof raw.sessionId !== 'string') return null;
    return {
      pid, sessionId: raw.sessionId, cwd: String(raw.cwd ?? ''),
      name: typeof raw.name === 'string' ? raw.name : null,
      status: String(raw.status ?? 'idle'),
      statusUpdatedAt: typeof raw.statusUpdatedAt === 'number' ? raw.statusUpdatedAt : null,
      version: typeof raw.version === 'string' ? raw.version : null,
    };
  } catch { return null; }
}
