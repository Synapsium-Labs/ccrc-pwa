import type { FleetState } from './fleetstate.js';
import type { Deps } from './server.js';
import type { Viewers } from './viewer.js';
import type { NotifyLog } from './notifylog.js';
import type { SessionRecord } from './registry.js';
import type { TurnVerdict } from './coord/archiveDoor.js';
import { programmeHoldOf } from './coord/rundefs.js';
import { TERMINAL_RUN_STATES, type FleetSession } from '../../shared/api.js';
import type { StopDoneHeldKind, StopDoneMark, StopDoneRow, StopDoneVerdict } from './stopDone.js';
import { RUN_DONE_LANE, sleepPass, type RunDoneCoordPort } from './sleepLane.js';

/**
 * STOP A FINISHED RUN'S WORKER (D-5370), the lane: L4, it reads and acts and DECIDES nothing — `stopDoneVerdict`
 * (`stopDone.ts`, L1) holds the rule. A SWEEP, never a step of the run's transition: `closeRun` commits `done` without
 * waiting on ccd, and this lane finds the worker on a later pass (`FleetWatcher.sweepStopDone`, at
 * `STOP_DONE_SWEEP_MS`, on the tick's own assembled rows). Since D-7042 (ARCH-43) its pass is the one sleep executor's
 * (`sleepPass` in `sleepLane.ts`) under this lane's row, `RUN_DONE_LANE`, which says how it differs from hibernation;
 * this file keeps the lane's deps, memory and outcome types, the excluded row's title, the hold classifier and its
 * pass's signature.
 */

export interface StopDoneSweepDeps {
  readonly coord: RunDoneCoordPort;
  readonly runCcd: Deps['runCcd'];
  readonly fleetState: FleetState | undefined;
  /** D-5242's presence contract: `isOpen`, an open screen visible or hidden — a hidden but open tab holds a finished
   *  worker as it holds a sleeping session. */
  readonly viewers: Pick<Viewers, 'isOpen'> | undefined;
  readonly notifyLog: NotifyLog | undefined;
  /** `turnverdict.ts`'s `liveWordFor` and `turnVerdictFor`, over the watcher's thunks. */
  readonly liveWord: (rec: SessionRecord) => Promise<
    { ok: true; word: string; since: number | null } | { ok: false; reason: 'no-pane' | 'no-config-dir' | 'unmeasured' }>;
  readonly turnVerdict: (rec: SessionRecord, uuid: string) => Promise<TurnVerdict>;
  /** `turnverdict.ts`'s `turnMarkFor`: the turn marker, judged against the live process. */
  readonly mark: (rec: SessionRecord) => Promise<StopDoneMark>;
  /** At the act: the registry record read again and the frame's row assembled from it (`readSessionRecord`, then
   *  `liveRowFor`). `ok: false` when either could not be read — the act then holds `unmeasured`. */
  readonly rowAtAct: (rec: SessionRecord) => Promise<{ ok: true; row: StopDoneRow } | { ok: false }>;
  /** The coordination serialiser (`CoordRoutesHandle.serial`); null until `buildServer` hands it over, and while it
   *  is the lane measures and stops nothing. */
  readonly serial: (<T>(fn: () => Promise<T>) => Promise<T>) | null;
  /** The process's per-session write queue. */
  readonly queueRun: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  readonly startedAt: number;
  readonly now: () => number;
}

export interface StopDoneMemory {
  /** After a refused stop: not asked again before this instant. */
  readonly retryAt: Map<string, number>;
  /** D-6091: the mail-only count the lane's last excluded row carried; absent until this process's first pass writes
   *  one, so a restart writes one row, zero included, and a zero reads apart from a lane that never ran. */
  mailOnly?: number;
}

/** The excluded row's title (D-6091): a finished worker that nothing but unread mail keeps awake is counted, never put
 *  to sleep. */
export const STOP_DONE_MAIL_ONLY_TITLE = 'Workers kept awake by unread mail';

export type StopDoneOutcome =
  | { readonly id: string; readonly kind: 'hibernated'; readonly runId: number }
  | { readonly id: string; readonly kind: 'skipped'; readonly detail: string }
  | { readonly id: string; readonly kind: 'held-at-act'; readonly verdict: StopDoneVerdict }
  | { readonly id: string; readonly kind: 'failed'; readonly detail: string };

/** The row's `.hold`, classified (D-6091): the grammar through `programmeHoldOf`, the one reader of
 *  `HOLD_REASON_PATTERN`, and a run suffix's state through the store's `run` read. Any read that cannot be made, or
 *  a run the store does not have, answers `unreadable`, which holds. */
export function heldKindOf(held: string | null, coord: Pick<StopDoneSweepDeps['coord'], 'run'>): StopDoneHeldKind {
  if (held === null) return 'none';
  const hold = programmeHoldOf(held);
  if (hold === null) return 'operator';
  if (hold.runId === null) return 'programme';
  try {
    const r = coord.run(hold.runId);
    if (!r.ok || r.run === null) return 'unreadable';
    return (TERMINAL_RUN_STATES as readonly string[]).includes(r.run.state) ? 'run-terminal' : 'run-live';
  } catch {
    return 'unreadable';
  }
}

/** One pass of the lane. Returns what it did, for the caller's log and the tests. */
export async function stopDonePass(
  deps: StopDoneSweepDeps, mem: StopDoneMemory,
  sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[],
): Promise<StopDoneOutcome[]> {
  return sleepPass(RUN_DONE_LANE, deps, mem, sessions, records, names);
}
