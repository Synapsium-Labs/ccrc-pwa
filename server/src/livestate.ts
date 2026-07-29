import path from 'node:path';
import type { FleetIO } from './io.js';
import type { SessionStatus } from '../../shared/api.js';

export interface LiveState {
  pid: number; sessionId: string; cwd: string; name: string | null;
  /** Claude Code's own account of where `name` came from. `'derived'` means it
   *  built the string from the cwd basename plus a counter — a session handle,
   *  which is not end-user information. Absent in older files: a name written
   *  before this field existed was chosen, so absent must NOT read as derived. */
  nameSource: string | null;
  status: string; statusUpdatedAt: number | null; version: string | null;
}

/**
 * The live file's `status` → the two states ccrc shows. Claude Code writes at
 * least three: `idle`, `busy` (a model turn is in flight) and `shell` (a Bash
 * tool command is running). From the operator's side the last two are the same
 * thing — Claude is working — so `idle` is the ONLY value that reads as idle
 * and everything else is busy.
 *
 * The default direction is the whole point. Matching `busy` and calling the
 * rest idle (what this used to do) made a session mid-command render "idle · 1m
 * ago" on its fleet card while its own terminal showed the spinner, made the
 * two surfaces flap out of sync as a turn alternated between streaming and
 * shelling out, and fired a "Finished — back to idle" push on every shell-out.
 * A status we don't recognise is far likelier to be new work than new rest.
 */
export function liveSessionStatus(status: string): SessionStatus {
  return status === 'idle' ? 'idle' : 'busy';
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
      nameSource: typeof raw.nameSource === 'string' ? raw.nameSource : null,
      status: String(raw.status ?? 'idle'),
      statusUpdatedAt: typeof raw.statusUpdatedAt === 'number' ? raw.statusUpdatedAt : null,
      version: typeof raw.version === 'string' ? raw.version : null,
    };
  } catch { return null; }
}
