// L1, pure (D-6095; fleet-capacity W1-4; spec §3.5 "The server wakes waiting coordinators"). WHICH refused coordinators the
// `admissionWake` lane mails at this pass: none while the cap has no room, then the oldest ELIGIBLE refusal of each programme (one round a pass),
// the programmes taken round-robin from the one served longest ago, and no more than the wake budget admits.
//
// The budget is `wakeAdmit` over a list of the LANE'S OWN (`recentWakes`), `WAKE_BURST` per `WAKE_WINDOW_MS`, both read by
// reference. The lane never records into `FleetWatcher.admitWake`'s shared list: the one real process wake, if the coordinator
// is hibernated, is the mail lane's and is charged once, there. Nothing here reads a clock, a store or the registry; the
// lane gathers `waiters` (`CoordStore.admissionWaiters`, which lists eligible waiters only: a woken one is skipped until it is
// refused again, so it never blocks the next one in its programme) and `room`.
import { wakeAdmitMany } from './wakeBudget.js';
import type { AdvanceRefusal } from './advance.js';

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
 * are chosen. Programmes are taken round-robin, one waiter per programme per pass, starting from the programme served
 * longest ago (a programme never served has time 0, so goes first; ties by the oldest waiting refusal, then by name).
 */
export function admissionWakeChoice(
  waiters: readonly AdmissionWaiter[], room: number, recentWakes: readonly number[], now: number,
  servedAt: ReadonlyMap<string, number> = new Map(),
): AdmissionWakeChoice {
  const served = new Map(servedAt);
  const queues = new Map<string, AdmissionWaiter[]>();
  for (const x of [...waiters].sort((a, b) => a.since - b.since || a.runId - b.runId)) {
    const q = queues.get(x.program);
    if (q === undefined) queues.set(x.program, [x]); else q.push(x);
  }
  const order = [...queues.keys()].sort((a, b) =>
    (served.get(a) ?? 0) - (served.get(b) ?? 0)
    || queues.get(a)![0]!.since - queues.get(b)![0]!.since || (a < b ? -1 : a > b ? 1 : 0));
  // ONE ROUND a pass: at most one waiter per programme, so a programme with many waiters is served at the lane's cadence
  // and two coordinators of one programme never race for the same free slot in one pass.
  const heads = order.slice(0, Math.max(0, room)).map((program) => ({ program, head: queues.get(program)![0]! }));
  const budget = wakeAdmitMany(recentWakes, now, heads.length);
  const chosen: AdmissionWaiter[] = [];
  for (const { program, head } of heads.slice(0, budget.admitted)) {
    chosen.push(head);
    served.set(program, now);
  }
  const recent = budget.recent;
  return { chosen, recent, served };
}

/** The wake mail's words for one chosen waiter (D-6095), decided here so the lane only sends them. */
export function admissionWakeMail(w: Pick<AdmissionWaiter, 'runId' | 'program' | 'sendBack'>): { subject: string; body: string } {
  return w.sendBack
    ? { subject: `capacity: room to send back run ${w.runId}`,
        body: `The concurrency cap has room again. Send run ${w.runId} (${w.program}) back to work now: your send-back was refused while the cap was full.` }
    : { subject: `capacity: room for run ${w.runId}`,
        body: `The concurrency cap has room again. Dispatch run ${w.runId} (${w.program}) now: your dispatch was refused while the cap was full.` };
}

/** The wake's observation row (D-6095, the stall-notice pattern): one per refusal episode, an episode being the wait from
 *  the newest refusal to its wake, so the run's `lastRefusedAt` is in it and a refusal after the wake opens a new one.
 *  `run_events`' `(runId, detail)` dedupe makes it once-only across a restart. It doubles as the wake's journal line. */
export function admissionWakeDetail(w: Pick<AdmissionWaiter, 'claimedBy' | 'lastRefusedAt'>): string {
  return `admission-woken:${w.claimedBy} refused=${w.lastRefusedAt}`;
}

/** Capacity follow-ups (T4 review 2907 F3): whether a live block is woken with this waiter's wake. Only a `capacity` block,
 *  and only the woken run's: a block naming another run of the same coordinator waits for that run's own wake, so a
 *  coordinator refused in two runs and given one slot is not told twice. A block that names no run waited for room for
 *  any of its programme's runs, so the first wake in its programme wakes it. Pure. */
export function blockWokenWith(b: { readonly wakeOn: string | null; readonly runId: number | null; readonly program: string },
  w: Pick<AdmissionWaiter, 'runId' | 'program'>): boolean {
  if (b.wakeOn !== 'capacity') return false;
  return b.runId === null ? b.program === w.program : b.runId === w.runId;
}

/** D-6095: the numbers of a refusal by the concurrency cap, or null for any other refusal. The advance route reads it to
 *  stamp a refused send-back as a wait (through `dispatch.ts#waitOnSendBackRefusal`), so the handler decides nothing
 *  itself (ARCH-33). Pure. It lives here and not in `advance.ts` because that file was held under a freeze
 *  (`docs/superpowers/programs/overlord/capacity-task4-notes.md`, slug capwaitof-in-admissionwake). */
export function capWaitOf(r: AdvanceRefusal): { limit: number; running: number } | null {
  return 'reject' in r && r.reject.code === 'cap-concurrency' ? { limit: r.reject.limit, running: r.reject.running } : null;
}
