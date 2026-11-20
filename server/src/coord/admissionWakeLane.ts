// Ring: L4 delivery, context Coordination (C5).
//
// D-6095 (fleet-capacity W1-4; spec §3.5 "The server wakes waiting coordinators"; re-grounded by the waiting-workers plan
// Task 4): ONE PASS OF THE ADMISSION-WAKE LANE. A coordinator the concurrency cap refused (a dispatch, or a send-back of a
// parked run) is MAILED when the cap has room. It is a row of `LANE_SCHEDULE` (`admissionWake`, at the wake budget's
// window) driven by `FleetWatcher.sweepAdmissionWake`, in the block-wake lane's shape (`blockWakeLane.ts`).
//
// It decides nothing itself: `capsMeasured` and `capsRoomOf` measure the room, `admissionWakeChoice` (L1) picks who is
// woken, and `queueAdmissionWake` writes each wake (the observation row, the mail, the woken stamp and the claimant's
// `capacity` blocks) in one transaction. Fail shut: nothing runs while the coordinator pause or the mail-disabled marker
// stands or the registry listing is unreadable, nothing is read when nobody waits, and nobody is woken without the
// coordination serialiser. The room is the cap reading's own: while `cap-counts-working` is in shadow every counted run
// holds its slot, so only a slot freed the ordinary way wakes anyone; armed, the worker readings are gathered first,
// outside the serialiser, and a slot a waiting or gone worker frees is room too. Inside the serialiser, in ONE synchronous
// step, the waiters are read again, the room measured (consuming no freed-slot admit), the choice made and each chosen
// waiter woken, so a run dispatched while the readings were taken is not mailed.
import { COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER, readSwitches } from '../../../shared/switches.js';
import { admissionWakeChoice, type AdmissionWaiter } from './admissionWake.js';
import { queueAdmissionWake } from './admissionWakeTx.js';
import { capCountsWorkingArmed, capsMeasured, workerReadings } from './dispatch.js';
import { capsRoomOf, type WorkerFacts } from './dispatchDecide.js';
import type { WatcherCoordPort } from './ports.js';

/** The lane's own memory, held by the watcher and in memory by design: its wake window (never the shared `wakeRecent`,
 *  so the one real process wake, the mail lane's, is charged once, there) and when it last served each programme. */
export interface AdmissionWakeMemory { recent: number[]; readonly served: Map<string, number> }

/** The record-only feed row of one wake, keyed on the refusal so a replay of it writes none. */
export interface AdmissionWokenNotice {
  kind: 'coord'; sessionId: string; project: string; title: string; body: string; runId: number;
  recordAlways: true; recordOnly: true; dedupeKey: string;
}

/** What one pass reads and where it writes, handed in by the watcher. */
export interface AdmissionWakeDeps {
  readonly coord: WatcherCoordPort;
  /** The tick's registry listing, which carries the two kill switches' markers; null when it could not be listed. */
  readonly names: readonly string[] | null;
  /** The coordination serialiser `buildServer` hands over; null until then, and the pass wakes nobody. */
  readonly serial: (<T>(fn: () => Promise<T>) => Promise<T>) | null;
  /** A run worker's measured facts (`turnverdict.ts#workerFactsFor`), the doors' own port. */
  readonly workerFacts: (sessionId: string) => Promise<WorkerFacts>;
  readonly memory: AdmissionWakeMemory;
  readonly push: (n: AdmissionWokenNotice) => void;
  readonly warn: (line: string) => void;
}

const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function admissionWakePass(d: AdmissionWakeDeps): Promise<void> {
  const sw = readSwitches(d.names);
  if (sw[COORDINATOR_PAUSE_MARKER] !== 'clear' || sw[MAIL_DISABLED_MARKER] !== 'clear') return;
  const serial = d.serial;
  if (serial === null) return;
  try {
    if (d.coord.admissionWaiters().length === 0) return;
    const armed = capCountsWorkingArmed(d.coord);
    const readings = armed ? await workerReadings(d.coord, d.workerFacts) : undefined;
    await serial(async () => {
      const now = Date.now();
      const room = capsRoomOf(capsMeasured(d.coord, readings, armed));
      const pick = admissionWakeChoice(d.coord.admissionWaiters(), room, d.memory.recent, now, d.memory.served);
      d.memory.recent = pick.recent;
      for (const [program, at] of pick.served) d.memory.served.set(program, at);
      for (const w of pick.chosen) wakeOne(d, w, now);
    });
  } catch (err) {
    d.warn(`ccrc-server: admission wake failed (${why(err)}) — the next pass asks again`);
  }
}

/** One chosen waiter: its one transaction (`queueAdmissionWake`), then, for a wake sent now, one server log line and one
 *  record-only feed row. A wake already recorded sends nothing again; a run that moved since the read is left alone. A
 *  failure leaves the waiter unmarked and is logged, so the next pass asks again. */
function wakeOne(d: AdmissionWakeDeps, w: AdmissionWaiter, now: number): void {
  try {
    if (!queueAdmissionWake(d.coord, w, now).queued) return;
    d.warn(`ccrc-server: admission wake: run ${w.runId} (${w.program}) has room under the concurrency cap; mailed ${w.claimedBy}`);
    d.push({
      kind: 'coord', sessionId: w.claimedBy, project: '', title: 'admission woken',
      body: `run ${w.runId} (${w.program}): the concurrency cap has room, ${w.claimedBy} was mailed`, runId: w.runId,
      recordAlways: true, recordOnly: true, dedupeKey: `admission-wake:${w.runId}:${w.lastRefusedAt}`,
    });
  } catch (err) {
    d.warn(`ccrc-server: admission wake of run ${w.runId} failed (${why(err)}) — the next pass asks again`);
  }
}
