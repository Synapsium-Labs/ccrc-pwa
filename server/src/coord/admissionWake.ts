// L1, pure (D-6095; fleet-capacity W1-4; spec §3.5 "The server wakes waiting coordinators"). WHICH refused coordinators the
// `admissionWake` lane mails at this pass: none while the cap has no room, then the oldest ELIGIBLE refusal of each programme,
// the programmes taken round-robin from the one served longest ago, and no more than the wake budget admits.
//
// The budget is `wakeAdmit` over a list of the LANE'S OWN (`recentWakes`), `WAKE_BURST` per `WAKE_WINDOW_MS`, both read by
// reference. The lane never records into `FleetWatcher.admitWake`'s shared list: the one real process wake, if the coordinator
// is hibernated, is the mail lane's and is charged once, there. Nothing here reads a clock, a store or the registry; the
// lane gathers `waiters` (`CoordStore.admissionWaiters`, which lists eligible waiters only: a woken one is skipped until it is
// refused again, so it never blocks the next one in its programme) and `room`.
import { WAKE_WINDOW_MS, wakeAdmit } from './wakeBudget.js';

/** One refused run waiting for the cap, as `CoordStore.admissionWaiters` lists it. `sendBack`: a refused send-back of a
 *  parked run, not a refused dispatch. */
export interface AdmissionWaiter {
  readonly runId: number;
  readonly program: string;
  readonly claimedBy: string;
  /** The OLDEST refusal: orders the queue. */
  readonly since: number;
  /** The newest refusal: the once-only key of its wake. */
  readonly lastRefusedAt: number;
  readonly sendBack: boolean;
}

export interface AdmissionWakeChoice {
  /** The waiters to mail now, in the order they were taken. */
  readonly chosen: readonly AdmissionWaiter[];
  /** The lane's own window after this pass: the wakes still inside it plus these. */
  readonly recent: number[];
  /** When each programme was last served, with this pass's. */
  readonly served: Map<string, number>;
}

/**
 * `room`: free concurrency slots, a figure the lane measured without consuming a freed-slot admit. At most `room` waiters
 * are chosen. Programmes are taken round-robin, one waiter per programme per round, starting from the programme served
 * longest ago (a programme never served first; ties by the oldest waiting refusal, then by name).
 */
export function admissionWakeChoice(
  waiters: readonly AdmissionWaiter[], room: number, recentWakes: readonly number[], now: number,
  servedAt: ReadonlyMap<string, number> = new Map(),
): AdmissionWakeChoice {
  let recent = recentWakes.filter((t) => now - t < WAKE_WINDOW_MS);
  const served = new Map(servedAt);
  const chosen: AdmissionWaiter[] = [];
  const queues = new Map<string, AdmissionWaiter[]>();
  for (const x of [...waiters].sort((a, b) => a.since - b.since || a.runId - b.runId)) {
    const q = queues.get(x.program);
    if (q === undefined) queues.set(x.program, [x]); else q.push(x);
  }
  const order = [...queues.keys()].sort((a, b) =>
    (served.get(a) ?? Number.NEGATIVE_INFINITY) - (served.get(b) ?? Number.NEGATIVE_INFINITY)
    || queues.get(a)![0]!.since - queues.get(b)![0]!.since || (a < b ? -1 : a > b ? 1 : 0));
  let full = room <= 0;
  while (!full && chosen.length < room) {
    let tookOne = false;
    for (const program of order) {
      if (chosen.length >= room) break;
      const q = queues.get(program)!;
      if (q.length === 0) continue;
      const r = wakeAdmit(recent, now, 'auto');
      recent = r.recent;
      if (!r.admit) { full = true; break; }
      chosen.push(q.shift()!);
      served.set(program, now);
      tookOne = true;
    }
    if (!tookOne) break;
  }
  return { chosen, recent, served };
}
