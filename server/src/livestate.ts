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
  /** WHY a `status: 'waiting'` session is blocked, in Claude Code's own words
   *  — `'sandbox request'`, `'input needed'`, `'dialog open'`, or whatever the
   *  top dialog names itself (D-76; the bundle's own `aTw`). Null for every
   *  other status, for a file written before the field existed, and for a
   *  value that is not a string.
   *
   *  Carried rather than collapsed on purpose: `liveSessionStatus` below has
   *  to answer in ccrc's two-value `SessionStatus` vocabulary and therefore
   *  cannot keep this distinction, so the reader keeps it instead — otherwise
   *  the one adapter that HAD the reason would be the one that threw it away.
   *  `fleet.ts` spends it on `dialogPending` + `askSummary`. */
  waitingFor: string | null;
}

/**
 * The live file's `status` → the two states ccrc shows. Claude Code writes at
 * least four: `idle`, `busy` (a model turn is in flight), `shell` (a Bash
 * tool command is running) and `waiting` (D-76 — blocked on the human, and
 * the bundle sets `working:!1` beside it). From the operator's side the
 * middle two are the same thing — Claude is working — so `idle` is the ONLY
 * value that reads as idle and everything else is busy.
 *
 * `waiting` COLLAPSES TO BUSY HERE, DELIBERATELY, and the fix for it is not
 * in this function. Three consumers read `SessionStatus` to answer "may I act
 * on this session right now" — the mail delivery gate and the archive-safety
 * verdict (`watch.ts`) and the per-session socket — and a human-blocked
 * session is one all three must keep their hands off, exactly like a busy
 * one. Answering `idle` here would let mail inject into an open dialog and
 * let auto-archive kill a session sitting on a permission prompt. What
 * `waiting` actually needs is the ATTENTION bucket, and it reaches that
 * through `fleet.ts`'s `dialogPending` (which reads `waitingFor`, kept above)
 * — a field, not a status word. `livestate.test.ts` pins this collapse.
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
      // D-77 — `?? ''`, NOT `?? 'idle'`. A file with no `status` field told us
      // nothing, and `liveSessionStatus` above spends a paragraph arguing that
      // the unknown case must fail toward work. This was the one line that
      // inverted that argument, handing the single value that reads as REST to
      // the case carrying the least evidence. `''` is not `'idle'`, so the two
      // now agree; `sessionBucket`'s hook arbitration (D-75) is what corrects
      // the answer when the hook has something fresher to say.
      status: String(raw.status ?? ''),
      statusUpdatedAt: typeof raw.statusUpdatedAt === 'number' ? raw.statusUpdatedAt : null,
      version: typeof raw.version === 'string' ? raw.version : null,
      waitingFor: typeof raw.waitingFor === 'string' ? raw.waitingFor : null,
    };
  } catch { return null; }
}
