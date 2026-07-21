import path from 'node:path';
import type { FleetIO } from './io.js';

export interface LiveState {
  pid: number; sessionId: string; cwd: string; name: string | null;
  status: string; statusUpdatedAt: number | null; version: string | null;
}

export async function readLiveState(io: FleetIO, configDir: string, pid: number): Promise<LiveState | null> {
  const content = await io.readFile(path.join(configDir, 'sessions', `${pid}.json`));
  if (content === null) return null;
  try {
    const raw = JSON.parse(content);
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
