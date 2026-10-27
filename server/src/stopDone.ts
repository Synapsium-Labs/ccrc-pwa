import { IDLE_RUN_STATES, type FleetSession } from '../../shared/api.js';
import {
  SLEEP_HELD_RULES, SLEEP_POLICY_NAMES, SLEEP_QUIET_BOUNDARIES, SLEEP_RUN_CLOCKS, decideSleep, type SleepInput,
  type SleepPolicy,
} from './sleep.js';

/**
 * STOP A FINISHED RUN'S WORKER (D-5370, `stop-worker-at-run-done`): the pure verdict.
 *
 * A dispatched worker whose run reached `done` keeps its Claude Code process alive until somebody stops it — child
 * reclamation removes the workspace only once the programme has finished with it (`childReclaimDecision`,
 * `coord/childReclaim.ts`: `final`, a retired programme or a spent child), and a wave that is not the last is none of
 * those. Measured 2026-10-17: of 28 long-idle sessions stopped by hand on a fleet box pinned at its memory cap, 23 were
 * workers whose runs were already `done` and merged, each holding about 200 MiB for days. The operator ruled: a
 * finished run's worker is stopped once idle, and restarts on re-dispatch — the dispatch resume arm already calls
 * `ccd ensure` (`coord/dispatch.ts`), which re-supervises and resumes a stopped session.
 *
 * L1: decisions only, over what the sweep (`sleepLane.ts`, L4) measured. It imports L0 alone.
 *
 * ABSORBED BY HIBERNATION (D-5242, spec §5.11; stop-done-composes-hibernate (D-5427), plan Task 17b): the lane
 * composes `ccd hibernate`, never `ccd stop`, so a finished worker it puts down wakes like any sleeping session — mail
 * (under the fleet-wide wake budget), a re-dispatch's `ensure`, a Restart. It keeps hibernation's USE holds in
 * hibernation's words (`HIBERNATE_HOLDS`): `opted-out` (`$REG/<id>.no-hibernate`), `scheduled` (the marker's `crons`
 * not exactly 0), the marker's two, and at the act ccd's own `attached`.
 *
 * ITS CLOCK IS THE RUN'S CLOSE (D-6091, fleet capacity W1-1; the operator's ruling of 2026-10-17, "stop workers at run
 * close", confirmed as F5 (0) on 2026-10-20). `recent` keeps its word and changes its clock: the turn marker's newest
 * stamp must be at least the grace (`STOP_DONE_GRACE_MS`) old, not hibernation's N, so a finished worker sleeps about
 * ten minutes after its run reads `done`. The holds that guard a WORKSPACE stop holding sleep for this policy (spec
 * §3.0, sleep versus retire): a programme hold, a hold naming a terminal run, a review of an open run, and a `planned`
 * run naming it (a wave not yet dispatched uses nothing). They still guard retirement, which this lane never does. A
 * programme-held child sleeps only through `ccd hibernate --hold-ok <the exact text>` on a box that advertises
 * `hibernate-hold-ok`; an operator's own hold, a hold naming an open or unreadable run, and a box without the token
 * keep `held`. Hibernation's own sweep (`idle-hours`, `hibernateVerdict`) is untouched: it acts only once armed, and
 * `hibernate-disabled` stops this lane too. The words that are this lane's alone say why it is narrower: only a
 * dispatched child (`not-a-child`), only once its newest placed run is finished (`no-run`, `not-done`,
 * `close-unplaced`) and a grace has passed (`grace`), only on a box whose ccd has the verb (`no-verb`), and only with
 * the fail-closed turn verdict idle (`turn`).
 *
 * "FINISHED" PER F5 (b) (D-6092, fleet capacity W1-1b; ruled 2026-10-20). A run is finished for this policy when it is
 * `done` or `failed` and closed (`failed` is a change from D-5370, which slept `done` alone), or when it is a producer's
 * run PARKED in `awaiting-review`, `merging` or `closing` (`STOP_DONE_PARKED_STATES`) and the turn marker has been
 * quiet `STOP_DONE_PARKED_IDLE_MS`. A parked run has no close, so its clock is the marker alone. A send-back (advance to
 * `working`) and a merge step reach a sleeping producer the way every sleeping session is reached: mail under the wake
 * budget, or a dispatch's `ensure`. Another run still holds the worker (`run-worker`) only while it is ACTIVE
 * (`openPlacedWorkers`, which counts a state this build cannot name, as the caps do), so a producer's own parked run
 * never holds it.
 */

/** Every reason the lane leaves a session running this pass — a `Record`, so the list below is derived and a word
 *  cannot be added without its meaning. Retried every pass; none is a terminal state. */
const STOP_DONE_HOLD_MAP = {
  'not-a-child': 'no child marker: the operator\'s own session, or a coordinator — only dispatched children are stopped',
  'child-unreadable': 'the child marker could not be read',
  archived: 'archived: the archive already stopped it',
  stopped: 'already stopped (the registry carries its stop stamp)',
  unmeasured: 'its identity or its status was not measured',
  held: 'a hold stands that guards more than the workspace: the operator\'s own text, one naming a run that is open or unreadable, or a box whose ccd cannot pass a programme hold (`hibernate-hold-ok`)',
  stranded: 'stranded by an automatic swap',
  'swap-blocked': 'a swap was refused for it',
  substrate: 'a substrate marker stands',
  'runs-unreadable': 'the coordination store could not answer its runs',
  'no-run': 'no placed run names it as worker (a `planned` run is not placed)',
  'not-done': 'its newest placed run is not finished: neither `done` nor `failed`, nor parked at `awaiting-review`, `merging` or `closing`',
  'close-unplaced': 'its newest placed run reads `done` or `failed` with no close time',
  grace: 'its run closed less than the grace ago',
  'run-worker': 'another active run names it as worker',
  'run-claimant': 'it claims an open run (it coordinates)',
  claim: 'it holds a live claim',
  mail: 'mail to it is outstanding',
  viewer: 'somebody has it open (on screen or in a hidden tab), or the server started too recently to know',
  menu: 'a pane menu is pending',
  bucket: 'its bucket is not `idle` (a `done` row is badged: its result may be unread)',
  background: 'background work is running',
  roster: 'subagents are running',
  'no-verb': 'this box\'s ccd does not list `hibernate` in its caps',
  'opted-out': 'the operator opted it out (`$REG/<id>.no-hibernate`)',
  pane: 'no live pane to stop',
  'live-word': 'its live word is not `idle`',
  turn: 'the fail-closed turn verdict is not `idle`',
  marker: 'its turn marker does not read a finished turn (`done`), or could not be read, or is not this process\'s',
  'marker-background': 'its turn marker\'s last Stop listed background work, or could not say (`bg` not exactly 0; −1 holds)',
  scheduled: 'its last Stop listed a session cron or wakeup, or the marker cannot say (`crons` not exactly 0; absent holds)',
  recent: 'its last main event is less than the grace old (`STOP_DONE_PARKED_IDLE_MS` for a parked run), or the marker carries no stamp to age',
} as const satisfies Record<string, string>;

export type StopDoneHold = keyof typeof STOP_DONE_HOLD_MAP;
export const STOP_DONE_HOLDS: readonly StopDoneHold[] = Object.keys(STOP_DONE_HOLD_MAP) as StopDoneHold[];
export function stopDoneHoldText(h: StopDoneHold): string { return STOP_DONE_HOLD_MAP[h]; }

/** How long after its run's close a worker is left alone, whatever else it reads — room for the coordinator's next
 *  wave to be opened onto it (`run-worker` then holds it). */
export const STOP_DONE_GRACE_MS = 10 * 60_000;

/** D-6092 (F5 (b)): how long a producer's run parked at review, merge or close must have left its turn marker quiet
 *  before the worker is put to sleep. A parked run has no close, so this is its only clock. */
export const STOP_DONE_PARKED_IDLE_MS = 30 * 60_000;

/** D-6092 (F5 (b)): the run states a producer is PARKED in — `IDLE_RUN_STATES` but `planned` (a wave not yet
 *  dispatched has no producer to park). Derived, never respelled. */
export const STOP_DONE_PARKED_STATES: readonly string[] = IDLE_RUN_STATES.filter((st) => st !== 'planned');

/** At most this many stops a pass, fleet-wide: a herd of stops is a herd of supervisors restarting on a re-dispatch,
 *  and a slower drain costs nothing (the 2026-08-14 usage-scan herd). */
export const STOP_DONE_PER_PASS = 3;

/** At most this many candidates have their live state read a pass (tmux and live-file reads each). */
export const STOP_DONE_MEASURES_PER_PASS = 6;

/** The lane's own cadence, off the watcher's tick: the `sleepRunDone` row's, declared in the L0 table (D-7045). */
export { STOP_DONE_SWEEP_MS } from './laneSchedule.js';

/** After a stop the box refused, the lane does not ask again for this long. In memory only: a restart asks once more. */
export const STOP_DONE_RETRY_MS = 60 * 60_000;

/** The actor the lane's act declares (`sweepDec`), as every unattended server lane names itself. */
export const STOP_DONE_ACTOR = 'sweep:stop-done';

/** The kill switch: while `$REG/stop-done-disabled` is listed the lane does nothing at all. The operator's to touch and
 *  remove BY HAND — nothing in the tree writes it (`single-definition.test.ts`). */
export { STOP_DONE_DISABLED_MARKER } from '../../shared/switches.js';

/** The registry row's facts the verdict reads — the fleet frame's own row, so the lane sees what the PWA shows. */
export type StopDoneRow = Pick<FleetSession,
  'id' | 'archivedAt' | 'held' | 'stoppedBy' | 'unmeasured' | 'statusUnmeasured' | 'dialogPending' | 'background'
  | 'subagents' | 'stranded' | 'swapBlocked' | 'substrate' | 'child' | 'bucket'>;

/** The coordination store's answers for one session, read once a pass (and again at the act). */
export type StopDoneStoreRead =
  | { readonly ok: false; readonly detail: string }
  | {
    readonly ok: true;
    /** The session's newest PLACED run as worker (`lastRunBySession`'s `lastPlaced`: a `planned` run, a wave not yet
     *  dispatched, is left out; D-6091), or null when no placed run names it. */
    readonly last: { readonly runId: number; readonly state: string; readonly closedAt: number | null } | null;
    /** An ACTIVE run names it (`openPlacedWorkers`: outside the idle and terminal sets, so an unnamed state counts;
     *  D-6091, narrowed by D-6092 so a producer's own parked run does not hold it). */
    readonly openWorker: boolean;
    /** A run PARKED at review, merge or close names it, newest or not (`parkedPlacedWorkers`;
     *  sibling-parked-run-takes-parked-clock): the marker's quiet is then measured against `STOP_DONE_PARKED_IDLE_MS`. */
    readonly parkedWorker: boolean;
    readonly openClaimant: boolean;
    readonly claim: boolean;
    readonly mail: boolean;
  };

/** The turn marker, as `turnMarkFor` (`turnverdict.ts`) reads it, judged against the live process — the fields the
 *  verdict reads (hibernation's `HibernateMark`), structurally, so this L1 file still imports L0 alone. Any `ok: false`
 *  reason holds. */
export type StopDoneMark =
  | {
    readonly ok: true; readonly state: string; readonly bg: number; readonly crons: number | null;
    readonly turnAt: number | null; readonly stopAt: number | null; readonly restartAt: number | null;
  }
  | { readonly ok: false; readonly reason: string };

/** The live reads, made only for a session every other hold has passed. `unread` asks the sweep to make them. */
export type StopDoneLive =
  | { readonly kind: 'unread' }
  | {
    readonly kind: 'read';
    /** `liveWordFor`'s answer, the RAW word; `no-pane`/`no-config-dir`/`unmeasured` when it gave none. */
    readonly word: { readonly ok: true; readonly word: string } | { readonly ok: false; readonly reason: 'no-pane' | 'no-config-dir' | 'unmeasured' };
    /** `turnVerdictFor`'s answer. */
    readonly turn: 'idle' | 'busy' | 'unmeasured';
    /** The turn marker (spec §5.1), hibernation's `marker` and `marker-background` reads. */
    readonly mark: StopDoneMark;
  };

/** What the row's `.hold` is, classified by the sweep (L4) so this file still imports L0 alone (D-6091). `none`: no
 *  hold. `operator`: any text outside the programme-hold grammar (`programmeHoldOf`), the unreadable and empty
 *  placeholders included. `programme`: a programme hold naming no run. `run-terminal` / `run-live`: one naming a run
 *  the store reads in / outside `TERMINAL_RUN_STATES`. `unreadable`: one naming a run the store could not read. */
export type StopDoneHeldKind = 'none' | 'operator' | 'programme' | 'run-terminal' | 'run-live' | 'unreadable';

export interface StopDoneInput {
  readonly row: StopDoneRow;
  /** The row's `.hold`, classified (D-6091). */
  readonly heldKind: StopDoneHeldKind;
  /** `capSupported` for `hibernate-hold-ok`: this box's ccd takes `ccd hibernate --hold-ok <text>` (D-6091). */
  readonly holdOkVerb: boolean;
  readonly store: StopDoneStoreRead;
  /** `Viewers.isOpen` for this id (D-5242's presence contract): an open screen, visible or hidden. */
  readonly viewer: boolean;
  /** Milliseconds since the server started: presence is never persisted, so a viewer that has not reconnected yet
   *  reads as none for one open-claim TTL (`PRESENCE_OPEN_TTL_MS`) after a start. */
  readonly sinceStartMs: number;
  readonly viewerOpenTtlMs: number;
  /** `verbSupported` for `CCD_ARGV.hibernate`: the box's ccd lists `hibernate` in its caps. */
  readonly verb: boolean;
  /** `$REG/<id>.no-hibernate` is listed. */
  readonly optedOut: boolean;
  readonly live: StopDoneLive;
  readonly now: number;
  readonly graceMs: number;
}

export type StopDoneVerdict =
  | {
    readonly act: 'hibernate'; readonly runId: number; readonly idleMs: number;
    /** D-6091: the exact `.hold` text a programme hold passed with; the act hands it to `ccd hibernate --hold-ok`. */
    readonly holdOk?: string;
  }
  | { readonly act: 'measure' }
  | { readonly act: 'hold'; readonly reason: StopDoneHold };

/** The `run-done` policy row (D-7040; ARCH-43): this lane's every difference from `idle-hours` that the one ladder
 *  (`decideSleep`, `sleep.ts`) reads. Only dispatched children, a stop stamp holds; a workspace hold passes with
 *  `hibernate-hold-ok`; the run's close is the clock (with the parked states' own); `no-verb` before `measure`; the
 *  turn verdict is read; quiet is measured strictly below the grace, or `STOP_DONE_PARKED_IDLE_MS` for a parked run. */
export const RUN_DONE_POLICY: SleepPolicy<StopDoneHold> = {
  name: SLEEP_POLICY_NAMES[0],
  holds: STOP_DONE_HOLDS,
  entry: { child: true, archivedBucket: false, paneDead: false, stopped: true },
  held: SLEEP_HELD_RULES.workspacePasses,
  runClock: { kind: SLEEP_RUN_CLOCKS.runClose, parkedStates: STOP_DONE_PARKED_STATES },
  verbBeforeMeasure: true,
  turnVerdict: true,
  liveWord: 'sleep',
  quiet: { boundary: SLEEP_QUIET_BOUNDARIES.below, parkedMs: STOP_DONE_PARKED_IDLE_MS },
};

/** The one ladder's facts, from this lane's input. The pane's death is not read (`paneDead: null`; the row does not
 *  count it). D-6091: a programme hold, or one naming a terminal run, guards the workspace, not its sleep — it passes
 *  only where ccd can pass it too; every other kind, a kind the sweep did not classify included, holds. */
export function stopDoneSleepInput(i: StopDoneInput): SleepInput {
  return {
    row: i.row, child: i.row.child, paneDead: null, stopped: i.row.stoppedBy !== null,
    heldPasses: i.holdOkVerb && (i.heldKind === 'programme' || i.heldKind === 'run-terminal'),
    optedOut: i.optedOut, store: i.store, viewer: i.viewer, sinceStartMs: i.sinceStartMs,
    viewerOpenTtlMs: i.viewerOpenTtlMs, verb: i.verb, live: i.live, now: i.now, quietMs: i.graceMs,
  };
}

/**
 * Put this worker to sleep? The holds run cheapest first, and the live reads come last: `measure` asks the sweep to read
 * them for a session nothing else holds. Every read the verdict could not make HOLDS — never an unmeasured act.
 * D-7040 (ARCH-43): the ladder is the one `decideSleep` (`sleep.ts`) runs for both sleep policies, under this lane's row,
 * `RUN_DONE_POLICY`; this function keeps its name, its input and its answer.
 */
export function stopDoneVerdict(i: StopDoneInput): StopDoneVerdict {
  const v = decideSleep(stopDoneSleepInput(i), RUN_DONE_POLICY);
  if (v.act !== 'hibernate') return v;
  // The run-close clock always names its run: a `hibernate` answer under this row carries it.
  const runId = v.runId as number;
  return v.holdOk === undefined
    ? { act: 'hibernate', runId, idleMs: v.idleMs }
    : { act: 'hibernate', runId, idleMs: v.idleMs, holdOk: v.holdOk };
}

/** Is unread mail the ONE thing keeping this finished worker awake (D-6091)? The verdict asked twice — as measured,
 *  and with no outstanding mail — so there is one hold order, the verdict's. The lane counts these on its feed (the
 *  excluded row): a worker the run-done policy would put to sleep but for mail nobody has read.
 *
 *  The live reads cost tmux and file reads, and the lane makes them only for a row nothing else holds, so a mail-held
 *  row is asked with its live state unread: `measure` without the mail counts as "would sleep" here. */
export function mailOnly(i: StopDoneInput): boolean {
  if (!i.store.ok || !i.store.mail) return false;
  const v = stopDoneVerdict(i);
  if (v.act !== 'hold' || v.reason !== 'mail') return false;
  const without = stopDoneVerdict({ ...i, store: { ...i.store, mail: false } });
  return without.act === 'hibernate' || without.act === 'measure';
}

