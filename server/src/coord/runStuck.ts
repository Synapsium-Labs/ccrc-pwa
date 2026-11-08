// D-8071 (spec 2026-11-04 §7, §9.3, §11.2; A4, A28, A29, A39, A45, A46, A54 to A57, A60): THE STUCK VERDICT, one pure
// function. L1 decision: facts in, a verdict out, no clock of its own (`nowMs` is an argument), no I/O. The registry pass
// that feeds it (`runStuckPass.ts`) and every reader of its answer (`runVerdicts.ts`) decide nothing.
//
// FIRST MATCH WINS, in this order: `owner-gone`, `start-never-landed`, `review-of-closed`, `overtaken`, `never-started`.
// ANY UNCERTAIN READING GIVES NO VERDICT for the pass (rule R2): a run then draws as ordinary, and the detail screen still
// offers Abandon. DOUBT IS NEVER GONE (D-7370, D-7371): a hibernated person is asleep, and a substrate stamp over a gone pane
// is uncertain.
//
// AGES COME FROM STORED TIMES (A63), never from the pass's own clock: `stuckSince` reads a time that is already stored
// (a journal act, a registry stamp, the dead-coordinator lane's anchor, `gone_since`, the run's own columns), so a restart
// that empties the in-memory reader moves no age. A person with no stored time gets no verdict that pass.
import type {
  RunKind, RunState, RunStuck, RunWaitsOn, StuckCause, StuckReason,
} from '../../../shared/api.js';
import type { ClaimantDeadCause, DeadCoordinatorJournal } from '../deadCoordinator.js';

/** The hour a gone coordinator must have been gone (§7 row 1). */
export const OWNER_GONE_AFTER_MS = 60 * 60_000;
/** A worker gone with no move for a day (§7 row 1). */
export const WORKER_GONE_AFTER_MS = 24 * 60 * 60_000;
/** Row 2 and row 3 (over 1 hour). */
export const START_NEVER_LANDED_AFTER_MS = 60 * 60_000;
export const REVIEW_OF_CLOSED_AFTER_MS = 60 * 60_000;
/** Row 4 (over 24 hours). */
export const OVERTAKEN_AFTER_MS = 24 * 60 * 60_000;
/** Row 5 (over 168 hours, the spec's seven days). */
export const NEVER_STARTED_AFTER_MS = 168 * 60 * 60_000;

/** `ClaimantVerdict` as this file reads it, structurally (L1 imports L0 and `deadCoordinator.ts` only). */
export type PersonVerdict =
  | { readonly state: 'dead'; readonly cause: ClaimantDeadCause }
  | { readonly state: 'alive' }
  | { readonly state: 'unmeasurable' };

/** What is known about one person (a coordinator or a worker): the reclaim ladder's verdict, the `.hibernated` stamp and
 *  the registry's `substrate` stamp, read in that order by `claimantGone`. `archivedAt` (epoch ms) is the registry's
 *  archive stamp, read by `stuckCause` alone. */
export interface PersonFacts {
  readonly verdict: PersonVerdict;
  readonly hibernatedAt: number | null;
  readonly substrate: { readonly at: number; readonly text: string } | null;
  readonly archivedAt?: number | null;
}

export type PersonReading = 'gone' | 'asleep' | 'uncertain' | 'alive';

/** IS THIS PERSON GONE (A56)? One predicate for claimant and worker alike, and the lane reads it too, so a stamp holds the
 *  lane's rows as well. In order: an unmeasurable reading is uncertain; an alive reading is alive, or asleep with a
 *  `.hibernated` stamp; a dead reading is asleep with that stamp, even over `orphan` or `never-started` (D-7371), uncertain
 *  over a substrate stamp (D-7370), and gone otherwise. */
export function claimantGone(person: PersonFacts): PersonReading {
  const v = person.verdict;
  if (v.state === 'unmeasurable') return 'uncertain';
  if (v.state === 'alive') return person.hibernatedAt !== null ? 'asleep' : 'alive';
  if (person.hibernatedAt !== null) return 'asleep';
  if (person.substrate !== null) return 'uncertain';
  return 'gone';
}

/** WHY a gone person is gone (A54), from the registry row's stamps and the last deliberate act in the journal. */
export function stuckCause(person: PersonFacts, journal: DeadCoordinatorJournal, role: 'coordinator' | 'worker'): StuckCause {
  const stopped = person.verdict.state === 'dead' && person.verdict.cause === 'stopped';
  if (role === 'worker') return stopped ? 'worker-stopped' : 'worker-gone';
  if (person.archivedAt !== undefined && person.archivedAt !== null) return 'coordinator-archived';
  if (journal.kind === 'deliberate') {
    switch (journal.act) {
      case 'archive': return 'coordinator-archived';
      case 'forget': return 'coordinator-forgotten';
      case 'purge': case 'destroy': case 'reap': case 'reclaim': case 'expire': return 'coordinator-removed';
      case 'stop': return 'coordinator-stopped';
      default: break;
    }
  }
  return stopped ? 'coordinator-stopped' : 'coordinator-gone';
}

/** Every stored time `stuckSince` may read, in epoch MS. The registry's `archivedAt` and `stopped.at` are epoch SECONDS;
 *  the pass that builds this multiplies them by 1000 (`secondsToMs`), as `fleet.ts` does. */
export interface StoredTimes {
  /** The journal's newest deliberate act (`DeadCoordinatorJournal`'s `at`), or null. */
  readonly journalAt: number | null;
  readonly archivedAt: number | null;
  /** The coordinator's `stopped.at`. */
  readonly stoppedAt: number | null;
  /** The worker's `stopped.at`. */
  readonly workerStoppedAt: number | null;
  /** The dead-coordinator lane's `dead_claimants.firstDeadAt`, while the lane holds a row. */
  readonly deadFirstAt: number | null;
  /** The coordinator's `.supervised` stamp: it may only RAISE the anchor (`deadCoordinatorSince`). Already validated. */
  readonly supervisedAt: number | null;
  /** `gone_since.firstGoneAt` for the coordinator and for the worker. */
  readonly goneSinceCoordinator: number | null;
  readonly goneSinceWorker: number | null;
  /** The run's own columns and its neighbours' moves. */
  readonly openedAt: number;
  readonly dispatchStartedAt: number | null;
  readonly targetClosedAt: number | null;
  readonly laterReviewAt: number | null;
  readonly overtakenAt: number | null;
  readonly nameReusedAt: number | null;
}

/** Epoch seconds (a registry stamp) as ms; a non-positive or unsafe stamp is no time. */
export const secondsToMs = (s: number | null | undefined): number | null =>
  s === null || s === undefined || !Number.isSafeInteger(s) || s <= 0 ? null : s * 1000;

/** WHEN the reason began, from a stored time (A39, A63), or null when none is stored (then no verdict that pass). */
export function stuckSince(cause: StuckCause | null, reason: StuckReason, times: StoredTimes): number | null {
  switch (reason) {
    case 'start-never-landed': return times.dispatchStartedAt;
    case 'overtaken': return times.overtakenAt;
    case 'never-started': return times.openedAt;
    case 'review-of-closed': return cause === 'later-review' ? times.laterReviewAt : times.targetClosedAt;
    case 'owner-gone': break;
    default: return reason satisfies never;
  }
  switch (cause) {
    case 'coordinator-archived': return times.journalAt ?? times.archivedAt;
    case 'coordinator-forgotten': case 'coordinator-removed': return times.journalAt;
    case 'coordinator-stopped': return times.journalAt ?? times.stoppedAt;
    case 'coordinator-gone': {
      // The lane's row wins while it holds one, and raises to the supervisor's stamp (`deadCoordinatorSince`).
      if (times.deadFirstAt !== null) return Math.max(times.deadFirstAt, times.supervisedAt ?? 0);
      return times.goneSinceCoordinator;
    }
    case 'worker-stopped': return times.workerStoppedAt;
    case 'worker-gone': return times.goneSinceWorker;
    case 'name-reused': return times.nameReusedAt;
    case 'target-closed': case 'later-review': case null: return null;
    default: return cause satisfies never;
  }
}

/** Everything the verdict reads about one OPEN run. The pass supplies it; nothing here reads a store. */
export interface RunStuckFacts {
  readonly id: number;
  readonly state: RunState;
  readonly kind: RunKind;
  readonly dispatchStartedAt: number | null;
  readonly dispatchedAt: number | null;
  /** The run's newest move (`RunSummary.lastMoveAt`), or null. */
  readonly lastMoveAt: number | null;
  /** The claimant, or null when the run names none. */
  readonly claimant: PersonFacts | null;
  readonly claimantJournal: DeadCoordinatorJournal | null;
  /** The worker session, or null when the run names none. */
  readonly worker: PersonFacts | null;
  readonly workerJournal: DeadCoordinatorJournal | null;
  /** For a review run: the work run it reviews has closed, or a later review reached `working` or `done`. */
  readonly target: { readonly closed: boolean } | null;
  readonly laterReviewMoved: boolean;
  /** A later wave of the programme has left planned. */
  readonly overtaken: boolean;
  /** Nothing else is open in the programme. */
  readonly aloneInProgramme: boolean;
  /** A review is open on this run (`awaiting-review`): true, false, or null when unread. */
  readonly reviewOpen: boolean | null;
  /** The stuck run a planned run waits behind (the pass's second phase), or null. */
  readonly behind: number | null;
  readonly times: StoredTimes;
}

/** An absent claimant with no lifecycle history gets no verdict (the ruled `unmeasured` rule). */
const unmeasuredPerson = (p: PersonFacts, j: DeadCoordinatorJournal | null): boolean =>
  p.verdict.state === 'dead' && p.verdict.cause === 'absent' && (j === null || j.kind === 'no-history');

/** The claimant's reading with that rule applied: a proven absence with no history is doubt. */
export function claimantReading(p: PersonFacts | null, j: DeadCoordinatorJournal | null): PersonReading | null {
  if (p === null) return null;
  const r = claimantGone(p);
  return r === 'gone' && unmeasuredPerson(p, j) ? 'uncertain' : r;
}

const noJournal: DeadCoordinatorJournal = { kind: 'quiet', started: true };

const verdictOf = (reason: StuckReason, cause: StuckCause | null, since: number): RunStuck =>
  ({ reason, cause, since, closes: null });

/** ROW 1. The coordinator gone for an hour, or, for a run that started, its worker gone with no move for a day. */
function ownerGone(f: RunStuckFacts, nowMs: number): RunStuck | null | 'unknown' {
  if (f.claimant !== null && claimantReading(f.claimant, f.claimantJournal) === 'gone') {
    const cause = stuckCause(f.claimant, f.claimantJournal ?? noJournal, 'coordinator');
    const since = stuckSince(cause, 'owner-gone', f.times);
    if (since === null) return 'unknown';
    if (nowMs - since >= OWNER_GONE_AFTER_MS) return verdictOf('owner-gone', cause, since);
  }
  if (f.state !== 'planned' && f.worker !== null && claimantReading(f.worker, f.workerJournal) === 'gone') {
    const cause = stuckCause(f.worker, f.workerJournal ?? noJournal, 'worker');
    const since = stuckSince(cause, 'owner-gone', f.times);
    if (since === null) return 'unknown';
    if (nowMs - Math.max(since, f.lastMoveAt ?? 0) >= WORKER_GONE_AFTER_MS) return verdictOf('owner-gone', cause, since);
  }
  return null;
}

/** THE VERDICT (§7). `null` is no verdict: nothing holds, or a reading was uncertain. `closes` is null on every verdict
 *  until the run-close lane writes its own map (Task 25). */
export function runStuck(f: RunStuckFacts, nowMs: number): RunStuck | null {
  if (f.state === 'done' || f.state === 'failed' || f.state === 'unknown') return null;
  const own = ownerGone(f, nowMs);
  if (own === 'unknown') return null;
  if (own !== null) return own;
  if (f.state !== 'planned') return null;
  if (f.dispatchStartedAt !== null && f.dispatchedAt === null && nowMs - f.dispatchStartedAt > START_NEVER_LANDED_AFTER_MS) {
    return verdictOf('start-never-landed', null, f.dispatchStartedAt);
  }
  if (f.kind === 'review') {
    const cause: StuckCause | null = f.target?.closed === true ? 'target-closed' : f.laterReviewMoved ? 'later-review' : null;
    if (cause === null) return null;
    const since = stuckSince(cause, 'review-of-closed', f.times);
    if (since === null || nowMs - since <= REVIEW_OF_CLOSED_AFTER_MS) return null;
    return verdictOf('review-of-closed', cause, since);
  }
  if (f.overtaken) {
    const since = stuckSince(null, 'overtaken', f.times);
    if (since !== null && nowMs - since > OVERTAKEN_AFTER_MS) return verdictOf('overtaken', null, since);
  }
  if (f.aloneInProgramme && nowMs - f.times.openedAt > NEVER_STARTED_AFTER_MS) {
    return verdictOf('never-started', null, f.times.openedAt);
  }
  return null;
}

/** WHO HAS THE NEXT MOVE (§7, A29). Absent for `unknown`, `done` and `failed`. */
export function runWaitsOn(f: RunStuckFacts): RunWaitsOn | undefined {
  const gone = (p: PersonFacts | null, j: DeadCoordinatorJournal | null): boolean => claimantReading(p, j) === 'gone';
  switch (f.state) {
    case 'planned': return gone(f.claimant, f.claimantJournal) ? 'nobody' : 'coordinator';
    case 'dispatched': case 'working': return gone(f.worker, f.workerJournal) ? 'nobody' : 'worker';
    case 'awaiting-review': return f.reviewOpen === true ? 'reviewer' : f.reviewOpen === false ? 'coordinator' : undefined;
    case 'merging': return 'merge-queue';
    case 'closing': return 'coordinator';
    default: return undefined;
  }
}

/** The stuck run a planned run waits behind, or null (§7). */
export const blockedByOf = (f: RunStuckFacts): number | null => (f.state === 'planned' ? f.behind : null);
