import path from 'node:path';
import type { FleetIO } from './io.js';

export interface LiveState {
  pid: number; sessionId: string; cwd: string; name: string | null;
  /** Claude Code's own account of where `name` came from. `'derived'` means it
   *  built the string from the cwd basename plus a counter — a session handle,
   *  which is not end-user information. Absent in older files: a name written
   *  before this field existed was chosen, so absent must NOT read as derived. */
  nameSource: string | null;
  status: string; statusUpdatedAt: number | null; version: string | null;
  /** When this Claude Code process started, epoch ms: the live file's numeric `startedAt` (measured present on
   *  2.1.284). Null when absent (an older build), not a number, or not finite. The turn marker's reader judges a
   *  marker written before it as `stale` (`turnmark.ts`, worker stall watch wave 2, §5.1). */
  startedAt: number | null;
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

/** The two verdicts over this file's words live in the L1 `liveVerdicts.ts` (D-7512); these are the same bindings. */
export { liveSessionStatus, liveStatusCoversDelegation } from './liveVerdicts.js';

/**
 * What `<configDir>/sessions/<pid>.json` — Claude Code's own live status file
 * — had to say about this pane, and, on the `false` arm, whether anything was
 * said at all.
 *
 * `no-state` is a MEASUREMENT that came back empty-handed: the reader looked
 * at the file (or proved there is none) and it describes no session. Genuinely
 * absent — the ordinary shape in the seconds between `ccd ws-add` starting a
 * pane and Claude Code first publishing — or a well-formed record naming no
 * `sessionId`, so nothing says whose pane it is. Two conditions, one arm,
 * deliberately: both mean the same actionable thing, and an arm no consumer
 * branches on is a wider type, not a finer measurement (`limits.ts:310` and
 * `commands.ts:73` are the tree's own precedent for leaving an indifferent
 * fold alone).
 *
 * `unmeasured` is not a measurement at all: the READ failed. The file is
 * there — EACCES, a dropped agent-WS round trip in remote mode, a device
 * error — and it may say `busy`. D-115: folding this into `no-state` is what
 * let `assembleFleet` and the chat header paint `idle · 1m ago` over a
 * session this box never managed to look at. D-5234 puts a body that is empty
 * or not JSON here too, once a re-read 50 ms later is still torn: Claude Code
 * rewrites the file in place with no lock against this reader, so those bytes
 * are a write caught half-done — a read that measured nothing, not a pane
 * that published nothing.
 *
 * AND THE FOLD IS STILL RIGHT FOR MOST CALLERS, which is why `readLiveState`
 * below keeps its signature rather than being replaced. `watch.ts`'s mail gate
 * hands the null straight to `mailTurnIdle` (`turnidle.ts`), which reads it as
 * `not-idle` and delivers only on an affirmative `idle` or `shell`, so an
 * unreadable file already fails shut there through the null.
 * `commands.ts` wants a cwd and has a registry
 * fallback for not having one. And the interrupt route's verdict
 * (`turnverdict.ts`'s `interruptVerdict`) reads this same failure as `idle` ON
 * PURPOSE (D-5236): it REFUSES on an unread word, so there the reassuring word is the
 * fail-shut one and "fail toward busy" would GRANT interrupts on a read that
 * measured nothing. Only the two DISPLAY surfaces — the fleet card and the
 * chat header — had the polarity the wrong way round, and they take the
 * measured form. So does the stall lane (`watch.ts`'s `sweepStalls`), which
 * must hold on `unmeasured` rather than read it as a quiet worker.
 */
export type LiveStateRead =
  | { ok: true; state: LiveState }
  | { ok: false; reason: 'no-state' }
  | { ok: false; reason: 'unmeasured' };

/** One frozen value for the two-conditions-into-one arm — see
 *  `LiveStateRead`. A constant rather than a literal per gate so the fold is
 *  visibly ONE decision taken once, not several that happen to agree today. */
const NO_STATE: LiveStateRead = { ok: false, reason: 'no-state' };
const UNMEASURED: LiveStateRead = { ok: false, reason: 'unmeasured' };

/**
 * `<configDir>/sessions/<pid>.json` → `LiveStateRead`. See that type for what
 * separates its two `false` arms, and why two of its conditions share
 * one of them.
 */
export async function readLiveStateMeasured(io: FleetIO, configDir: string, pid: number): Promise<LiveStateRead> {
  // `readFileMeasured`, not `readFile`: this seam is the only place the
  // absent-vs-unreadable line still exists as evidence (`io.ts`'s
  // `MeasuredRead`), and folding it here is what D-115 named. A proven ENOENT
  // is the ordinary shape for a pane that has not published yet; anything
  // else is a file this box could not read, which proves nothing about the
  // session and must say so.
  const file = path.join(configDir, 'sessions', `${pid}.json`);
  let read = await io.readFileMeasured(file);
  if (!read.ok) return read.reason === 'absent' ? NO_STATE : UNMEASURED;
  let raw = parseLiveBody(read.content);
  if (raw === TORN) {
    // D-5234: read but empty or not JSON. Claude Code rewrites this file in
    // place, so the bytes were caught mid-write: a read that measured
    // nothing, not a pane that published nothing. Once more after the
    // writer has had its moment; still torn, it is `unmeasured`.
    await new Promise((resolve) => setTimeout(resolve, LIVE_TORN_RETRY_MS));
    read = await io.readFileMeasured(file);
    if (!read.ok) return read.reason === 'absent' ? NO_STATE : UNMEASURED;
    raw = parseLiveBody(read.content);
    if (raw === TORN) return UNMEASURED;
  }
  try {
    // Every rejection from here down is NO_STATE: each is well-formed JSON
    // this reader successfully looked at and found says nothing about this
    // pane (a torn body never reaches here — D-5234, above). Spelling that
    // conclusion once is what stops a later edit from quietly promoting one
    // of them to `unmeasured` — the direction that would paint a pane that
    // has published no session as a busy one.
    if (typeof raw.sessionId !== 'string') return NO_STATE;
    return {
      ok: true,
      state: {
        pid, sessionId: raw.sessionId, cwd: String(raw.cwd ?? ''),
        name: typeof raw.name === 'string' ? raw.name : null,
        nameSource: typeof raw.nameSource === 'string' ? raw.nameSource : null,
        // D-77 — `?? ''`, NOT `?? 'idle'`. A file with no `status` field told
        // us nothing, and `liveVerdicts.ts#liveSessionStatus` spends a paragraph arguing
        // that the unknown case must fail toward work. This was the one line
        // that inverted that argument, handing the single value that reads as
        // REST to the case carrying the least evidence. `''` is not `'idle'`,
        // so the two now agree; `sessionBucket`'s hook arbitration (D-75) is
        // what corrects the answer when the hook has something fresher to say.
        // A STRING OR NOTHING (review 244, F1): `String(…)` spelled `["idle"]`
        // as `'idle'` and `true` as `'true'`, and the archive door's fail-closed
        // read (`stopVerdict`) stopped the first as an idle pane. ccd's
        // `_ws_status` greps the bytes for `"status":"<word>"` and reads neither.
        status: typeof raw.status === 'string' ? raw.status : '',
        statusUpdatedAt: typeof raw.statusUpdatedAt === 'number' ? raw.statusUpdatedAt : null,
        startedAt: typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt) ? raw.startedAt : null,
        version: typeof raw.version === 'string' ? raw.version : null,
        waitingFor: typeof raw.waitingFor === 'string' ? raw.waitingFor : null,
      },
    };
  } catch { return NO_STATE; }
}

/** D-5234: how long a torn live file is given before its one re-read. */
const LIVE_TORN_RETRY_MS = 50;

/** The parse's own answer for a body that is empty or not JSON — one value,
 *  so the retry above and the verdict after it test the same thing. */
const TORN: unique symbol = Symbol('torn');

/** `JSON.parse`, with an empty or unparseable body answering `TORN`. Valid
 *  JSON of any shape comes back as parsed; the shape checks are the caller's. */
function parseLiveBody(content: string): any {
  try { return JSON.parse(content); } catch { return TORN; }
}

/**
 * The folded form, unchanged in signature and in every answer it gives: null
 * for every condition the measured read tells apart. Its callers —
 * `commands.ts`'s cwd lookup and `watch.ts`'s mail
 * gate (one read, handed to `mailTurnIdle`, which fails shut on the null) —
 * are each indifferent to the
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

/**
 * D-7512: `readLiveStateMeasured` bound to one box's io, as the reader `fleet.ts`'s `assembleFleet` is handed
 * (`fleet.ts#LiveStateMeasuredReader`). `fleet.ts` is L1 and this file is L3 (the torn-body wait), so the assembly
 * takes the read through a parameter instead of importing it. The return type is spelled structurally, so this file
 * imports nothing from `fleet.ts`.
 */
export function liveStateReaderOver(io: FleetIO): (configDir: string, pid: number, uuid: string) => Promise<LiveStateRead> {
  return (configDir, pid, uuid) => readLiveStateMeasuredFor(io, configDir, pid, uuid);
}

/**
 * The live file for a session, addressed by the fact BOTH sides write — the
 * session uuid — with the pid tmux reports as the fast path. The MEASURED form:
 * same three answers as `readLiveStateMeasured`, same meaning for each.
 *
 * `readLiveStateMeasured` keys on the pane pid alone, which holds only where
 * tmux and Claude Code share a pid namespace. On Windows they do not: tmux is
 * an MSYS2 program and reports the pid the MSYS runtime assigned, while Claude
 * Code is native and names its file by the Windows pid it sees for itself.
 * Measured on this box: tmux said 7956, the file was `56116.json`. So the pid
 * read answers `no-state` for EVERY session there — the arm D-115 reserves for
 * "a pane that has published nothing yet" — and every display surface leaves
 * the card at `idle`, unnamed, with no version, forever. That is the board this
 * function exists to stop drawing: the pid read is a proven ENOENT, so D-115's
 * own polarity calls it rest, and on Windows it is never true.
 * `ccd`'s half of the same defect is fixed by `_hook_pid` (ccd/ccd), which can
 * read MSYS's `/proc/<pid>/winpid`; native Node cannot — that path does not
 * exist on disk (measured: ENOENT) — so this side resolves by identity instead.
 *
 * PID FIRST, and not merely for speed: it is one read against a name, and on
 * every POSIX box it is also correct, so off Windows a pid read IS the answer,
 * exactly `readLiveStateMeasured`'s, and the scan below never runs there (a
 * stale file of an earlier pid naming the same uuid must not answer for a pane
 * whose own pid published nothing yet). The scan is bounded by the session
 * count of one wrapper HOME and only pays on a box where the pid cannot be the
 * key.
 *
 * THE THREE ARMS SURVIVE THE SCAN — the rule is "an adapter may not narrow a
 * distinction it received", and this function receives D-115's:
 *
 *   - The pid read `unmeasured` RETURNS `unmeasured`, unscanned. That file is
 *     there and could not be read; on POSIX it IS this session's file. A scan
 *     that then found nothing would answer `no-state` — rest — over a session
 *     nobody looked at, which is D-115's defect reached through a side door.
 *   - A scanned file that reads `unmeasured` may be ours. If no file MATCHES
 *     and one of them could not be read, the honest answer is `unmeasured`,
 *     not `no-state`: "we did not find it" is only a measurement when we could
 *     read everywhere we looked.
 *   - An absent `sessions/` answers `no-state`; one that cannot be listed
 *     answers `unmeasured` (`readdirMeasured` keeps the two apart, and the
 *     plain `readdir` ratchet in `fleetio-contract.test.ts` may only shrink).
 *   - An EMPTY uuid never scans. A degraded registry record's uuid is `''`
 *     (see `measuredIdentity`); it must not match a file, and it must not
 *     become "read whatever is there".
 */
export async function readLiveStateMeasuredFor(
  io: FleetIO, configDir: string, pid: number | null, uuid: string,
): Promise<LiveStateRead> {
  // Off Windows the pid IS the key, and the file may lawfully name another uuid: after a fork the pane keeps
  // publishing the pre-fork id while the registry holds the new one (`_sync_uuid`, ccd/ccd), and a /clear lags the
  // registry by a tick. So there the pid read is the whole answer, as it was before the Windows port.
  if (pid !== null && process.platform !== 'win32') return readLiveStateMeasured(io, configDir, pid);
  // Which live-state FILE is this session's: the file's own sessionId against the registry record's transcript uuid.
  // No run is read (named in `runSessionCensus.ts`'s NOT_BINDING_SITES). An empty uuid (a degraded record) names none.
  const namesUuid = (s: LiveState): boolean => s.sessionId === uuid;
  if (pid !== null) {
    const byPid = await readLiveStateMeasured(io, configDir, pid);
    // On Windows the pane pid (MSYS) and the file names (Windows pids) are two number spaces, so a file under the
    // pane's pid is ours only when it names our uuid; a collision is another session's file. An empty uuid cannot
    // check, so it keeps the pid read's answer.
    if (byPid.ok ? uuid === '' || namesUuid(byPid.state) : byPid.reason === 'unmeasured') return byPid;
  }
  if (uuid === '') return NO_STATE;
  const listed = await io.readdirMeasured(path.join(configDir, 'sessions'));
  if (!listed.ok) return listed.reason === 'absent' ? NO_STATE : { ok: false, reason: 'unmeasured' };
  let sawUnmeasured = false;
  for (const name of listed.entries) {
    const n = /^(\d+)\.json$/.exec(name);
    if (n === null) continue;
    const read = await readLiveStateMeasured(io, configDir, Number(n[1]));
    if (read.ok) {
      if (namesUuid(read.state)) return read;
    } else if (read.reason === 'unmeasured') {
      sawUnmeasured = true;
    }
  }
  return sawUnmeasured ? { ok: false, reason: 'unmeasured' } : NO_STATE;
}

/**
 * `readLiveStateMeasuredFor`, folded — for the callers `LiveStateRead`'s own
 * docstring names as correctly served by the fold (the mail gate, `commands`,
 * `liveStatus`, `archiveSafety`). ONE resolution with a fold on top, exactly
 * the relationship `readLiveState` has to `readLiveStateMeasured`, so the pid
 * and uuid lookups cannot drift between the two forms.
 */
export async function readLiveStateFor(
  io: FleetIO, configDir: string, pid: number | null, uuid: string,
): Promise<LiveState | null> {
  const read = await readLiveStateMeasuredFor(io, configDir, pid, uuid);
  return read.ok ? read.state : null;
}
