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

/**
 * What `<configDir>/sessions/<pid>.json` — Claude Code's own live status file
 * — had to say about this pane, and, on the `false` arm, whether anything was
 * said at all.
 *
 * `no-state` is a MEASUREMENT that came back empty-handed: the reader looked
 * at the file (or proved there is none) and it describes no session. Genuinely
 * absent — the ordinary shape in the seconds between `ccd ws-add` starting a
 * pane and Claude Code first publishing — bytes that are not JSON (a file
 * caught mid-write; there is no lock between the writer and this reader), or
 * a record naming no `sessionId`, so nothing says whose pane it is. Three
 * conditions, one arm, deliberately: every one of them means the same
 * actionable thing, and an arm no consumer branches on is a wider type, not a
 * finer measurement (`limits.ts:126` and `commands.ts:73` are the tree's own
 * precedent for leaving an indifferent fold alone).
 *
 * `unmeasured` is the fourth condition and it is not a measurement at all:
 * the READ failed. The file is there — EACCES, a dropped agent-WS round trip
 * in remote mode, a device error — and it may say `busy`. D-115: folding this
 * into the other three is what let `assembleFleet` and the chat header paint
 * `idle · 1m ago` over a session this box never managed to look at.
 *
 * AND THE FOLD IS STILL RIGHT FOR MOST CALLERS, which is why `readLiveState`
 * below keeps its signature rather than being replaced. `watch.ts`'s mail gate
 * and `archiveSafety` both require an AFFIRMATIVE idle (`!live || … !== 'idle'`
 * continues; `!live` returns `unknown`), so an unreadable file already fails
 * shut there through the null. `commands.ts` wants a cwd and has a registry
 * fallback for not having one. And `fleet.ts`'s `liveStatus` answers `'idle'`
 * on this same failure ON PURPOSE: its sole consumer is the interrupt route's
 * `… === 'busy'`, which REFUSES on idle, so there the reassuring word is the
 * fail-shut one and "fail toward busy" would GRANT interrupts on a read that
 * measured nothing. Only the two DISPLAY surfaces — the fleet card and the
 * chat header — had the polarity the wrong way round, and only they take the
 * measured form.
 */
export type LiveStateRead =
  | { ok: true; state: LiveState }
  | { ok: false; reason: 'no-state' }
  | { ok: false; reason: 'unmeasured' };

/** One frozen value for the three-conditions-into-one arm — see
 *  `LiveStateRead`. A constant rather than a literal per gate so the fold is
 *  visibly ONE decision taken once, not three that happen to agree today. */
const NO_STATE: LiveStateRead = { ok: false, reason: 'no-state' };

/**
 * `<configDir>/sessions/<pid>.json` → `LiveStateRead`. See that type for what
 * separates its two `false` arms, and why three of the four conditions share
 * one of them.
 */
export async function readLiveStateMeasured(io: FleetIO, configDir: string, pid: number): Promise<LiveStateRead> {
  // `readFileMeasured`, not `readFile`: this seam is the only place the
  // absent-vs-unreadable line still exists as evidence (`io.ts`'s
  // `MeasuredRead`), and folding it here is what D-115 named. A proven ENOENT
  // is the ordinary shape for a pane that has not published yet; anything
  // else is a file this box could not read, which proves nothing about the
  // session and must say so.
  const read = await io.readFileMeasured(path.join(configDir, 'sessions', `${pid}.json`));
  if (!read.ok) return read.reason === 'absent' ? NO_STATE : { ok: false, reason: 'unmeasured' };
  try {
    const raw = JSON.parse(read.content);
    // Every rejection from here down is NO_STATE: each is a file this reader
    // successfully looked at and found says nothing about this pane. Spelling
    // that conclusion once is what stops a later edit from quietly promoting
    // one of them to `unmeasured` — the direction that would paint an
    // ordinary half-written file as a busy session.
    if (typeof raw.sessionId !== 'string') return NO_STATE;
    return {
      ok: true,
      state: {
        pid, sessionId: raw.sessionId, cwd: String(raw.cwd ?? ''),
        name: typeof raw.name === 'string' ? raw.name : null,
        nameSource: typeof raw.nameSource === 'string' ? raw.nameSource : null,
        // D-77 — `?? ''`, NOT `?? 'idle'`. A file with no `status` field told
        // us nothing, and `liveSessionStatus` above spends a paragraph arguing
        // that the unknown case must fail toward work. This was the one line
        // that inverted that argument, handing the single value that reads as
        // REST to the case carrying the least evidence. `''` is not `'idle'`,
        // so the two now agree; `sessionBucket`'s hook arbitration (D-75) is
        // what corrects the answer when the hook has something fresher to say.
        status: String(raw.status ?? ''),
        statusUpdatedAt: typeof raw.statusUpdatedAt === 'number' ? raw.statusUpdatedAt : null,
        version: typeof raw.version === 'string' ? raw.version : null,
        waitingFor: typeof raw.waitingFor === 'string' ? raw.waitingFor : null,
      },
    };
  } catch { return NO_STATE; }
}

/**
 * The folded form, unchanged in signature and in every answer it gives: null
 * for all four conditions the measured read tells apart. Its four callers —
 * `fleet.ts`'s `liveStatus`, `commands.ts`'s cwd lookup, and both of
 * `watch.ts`'s already-fail-shut gates — are each indifferent to the
 * distinction (see `LiveStateRead` for why, one by one), and widening them to
 * carry an arm they do not act on is the defect this task removes, one type
 * over.
 *
 * Derived, not duplicated, for the reason `io.ts` states beside
 * `readFileMeasured`: two hand-kept ladders over the same four gates drift,
 * and the one that drifts is always the one nobody is reading.
 */
export async function readLiveState(io: FleetIO, configDir: string, pid: number): Promise<LiveState | null> {
  const read = await readLiveStateMeasured(io, configDir, pid);
  return read.ok ? read.state : null;
}
