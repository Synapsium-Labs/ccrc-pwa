// L0 — the watcher's one table of lane cadences (D-5862; ARCH-68 #803; spec 2026-10-19 K11, §2.3's clock row).
//
// One row per lane the watcher throttles: its cadence, the clock the throttle reads (as it is today, never as it may
// become), how a second caller is treated while a run is in flight, and the sentence a failure is caught with. The
// mechanism that reads the table is `LaneRunner` (`./laneRunner.ts`, behind `FleetWatcher.runLane`); this module is
// data, so the census and the tick-order pins read it without importing the watcher (a departure from K11's wording,
// which puts the table in `watch.ts`, recorded under D-5862).
//
// A cadence is how often a lane LOOKS; a safety interval is how long a lane WAITS before it acts on what it saw
// (`CHILD_RECLAIM_STALL_MS`, `COLLECT_AUDIT_STALL_MS`, the mail and PR backoffs, `DELEGATION_RECOVERY_RETRY_MS`). The
// two are different facts that happen to share a unit, so a safety interval is never a row and never a row's cadence.

/** The catalogue lane's cadence (design 2026-09-20 §7), the SCHEDULED poll's own: `catalogue.ts` re-exports it, so
 *  `routes.ts`'s refresh-door interval derives `SCHEDULED_POLLS_PER_HOUR` from the SAME constant the watcher polls on
 *  (D-3218, D-3404), never a second copy. GitHub's unauthenticated listing budget is 60 requests an hour per IP and
 *  a 304 still spends one, so every 30 minutes is 2 scheduled polls an hour, leaving the rest of the budget to
 *  `POST /api/updates/refresh`. */
export const CATALOGUE_POLL_INTERVAL_MS = 30 * 60_000;

/** The server's own server-caps beat: once a minute, a third of `SERVER_CAPS_LEASE_S`, so one missed write never turns
 *  an arm off. The fleet node's writer (`ccd-update-sync.timer`, `OnUnitActiveSec=60s`) keeps the same period.
 *  `serverCaps.ts` re-exports it. */
export const SERVER_CAPS_WRITE_MS = 60_000;

/** The fourth lane. A ccd install is a deliberate act by a human who is waiting, so a minute is the longest anyone
 *  should have to wonder whether the fleet noticed, and the agent's stat gate means an unchanged ccd costs a stat,
 *  not a bash process. */
export const CAPS_REFRESH_MS = 60_000;

/** The inventory lane (design 2026-09-20 §8): seven small ~/.ccrc reads per node, lstat-gated and budget-bounded,
 *  once a minute, and at once after a `ready` frame (`triggerInventory`, wired in `index.ts`). */
export const UPDATE_INVENTORY_MS = 60_000;

/** Task sweeps read every task file of every session, so they run on their own slower clock than the 2 s pane poll: a
 *  plan advances on the scale of minutes, and the fleet chip is a glance, not a readout. The open session's own stream
 *  reads its list every tick, so the screen you're looking at stays live regardless. */
export const TASK_SWEEP_MS = 10_000;

/** The usage sidecar lane's own clock (routing slice 0), the task sweep's shape: a sidecar is fresh for `USAGE_FRESH_S`
 *  (30 minutes), so re-reading it every 2 s tick would buy nothing for the cost of one agent round trip per session in
 *  remote mode. */
export const USAGE_SWEEP_MS = 60_000;

/** The naming lane. Naming does NOT ride the 2 s tick: a title that appears ten seconds late costs nothing, and reading
 *  transcripts thirty times a minute to learn nothing costs real work (`claimTitleRead`'s docstring has the arithmetic:
 *  roughly 7.7 MB/min across the agent link at this cadence, five times that on the tick). */
export const NAME_SWEEP_MS = 10_000;

/** The census lane. A disagreement between sources is a human-timescale event (a rename, a hand-made worktree, a run
 *  left open) and each sweep reads `<projectsRoot>/<project>/.git/worktrees/` per project, so it runs six times slower
 *  than the name sweep. */
export const DIVERGENCE_SWEEP_MS = 60_000;

/** The journal mirror's lane (child-reclamation wave 6; build 9 wave 4). Short, because a destruction's intent and
 *  outcome pair should be visible while the operator is still looking at the screen. EXPORTED because `mirror.ts`
 *  cannot import it (L3 importing L4), so the staleness window is passed in from the one construction site;
 *  `watch.ts` re-exports it for the suites that import it from there. */
export const LC_SWEEP_MS = 5_000;

/** D13's two ledger lanes. The floor scan reads every plan and spec of every registry-named project, so it runs
 *  hourly; reconcile reads only the plans of projects with open allocations, every 15 minutes, because `landed` is the
 *  signal a coordinator watches for. */
export const LEDGER_FLOOR_SWEEP_MS = 3_600_000;
export const LEDGER_RECONCILE_SWEEP_MS = 900_000;

/** F3's lane. Ten minutes: slower than the divergence census because the answer only changes when someone installs a
 *  skill or edits a token, and faster than the ledger floor's hour because an operator waiting to start a program is
 *  watching this one. EXPORTED so its own suite advances by the real constant; `watch.ts` re-exports it. */
export const READINESS_SWEEP_MS = 600_000;

/** The PR lane. 8 projects x 1 call / 120 s is ~240 GraphQL calls an hour against a 5000/hr budget with ~4900 free,
 *  about 5%; measured latency 0.51-0.69 s per call. `PR_SWEEP_ACTIVE_MS` is the row's other cadence, chosen by the
 *  lane while any project has an open PR whose checks are pending. */
export const PR_SWEEP_MS = 120_000;
export const PR_SWEEP_ACTIVE_MS = 30_000;

/** The ceiling of the PR and mail backoffs (15 minutes). A SAFETY interval, not a cadence: it lives here only because
 *  `PR_SWEEP_STUCK_MS` follows it and the table cannot import the watcher. */
export const PR_BACKOFF_MAX_MS = 900_000;

/** How long one PR sweep may be in flight before the next is allowed to start anyway: the row's `staleAfterMs`. In
 *  local mode `realRunner` passes no timeout to `execFile`, so nothing bounds the awaited `ccd` call and a wedged `gh`
 *  would otherwise hold the single flight shut for the process's lifetime. Same 15 minutes as the backoff ceiling: far
 *  longer than any real sweep, short enough that wedged is not permanent. A safety interval, never a cadence. */
export const PR_SWEEP_STUCK_MS = PR_BACKOFF_MAX_MS;

/** Which clock a throttle reads: the watcher's monotonic clock (`Deps.monotonicMs`) or the wall clock (`Date.now()`). */
export type LaneClock = 'mono' | 'wall';

/** What a caller does when a run is already in flight: `skip` refuses (and, with `staleAfterMs`, abandons a run older
 *  than that), `join` hands back the run in flight, `join-rerun` joins and queues exactly one rerun, `none` lets
 *  runs overlap (the lane has no guard today). */
export type LaneFlight = 'skip' | 'join' | 'join-rerun' | 'none';

export type LaneName =
  | 'caps' | 'catalogue' | 'inventory' | 'serverCaps'
  | 'tasks' | 'usage' | 'pr' | 'names' | 'divergences' | 'lifecycle' | 'readiness' | 'ledgerReconcile' | 'ledgerFloor';

export interface LaneRow {
  readonly name: LaneName | (string & {});
  /** How often the lane looks, in milliseconds. */
  readonly cadenceMs: number;
  /** A second cadence the lane chooses while it has pending work (the PR sweep, while a check is pending). */
  readonly activeCadenceMs?: number;
  /** Set when `cadenceMs` is a reference to another module's constant: the constant, and why the lane follows it. */
  readonly derivedFrom: { readonly name: string; readonly reason: string } | null;
  readonly clock: LaneClock;
  readonly flight: LaneFlight;
  /** On a `skip` row that abandons a stuck run: the age, on the row's clock, past which a run counts as stuck. */
  readonly staleAfterMs?: number;
  /** The lane's catch sentence (`ccrc-server: …`), to which the failure's detail is appended; null when the caller
   *  keeps its own catch or the lane has its own latch. */
  readonly warnKey: string | null;
}

export const LANE_SCHEDULE: readonly LaneRow[] = [
  { name: 'caps', cadenceMs: CAPS_REFRESH_MS, derivedFrom: null, clock: 'wall', flight: 'none', warnKey: null },
  {
    name: 'catalogue', cadenceMs: CATALOGUE_POLL_INTERVAL_MS, derivedFrom: null, clock: 'wall', flight: 'none',
    warnKey: 'ccrc-server: the catalogue poller rejected — this is a bug, poll() should never reject',
  },
  { name: 'inventory', cadenceMs: UPDATE_INVENTORY_MS, derivedFrom: null, clock: 'wall', flight: 'join-rerun', warnKey: null },
  { name: 'serverCaps', cadenceMs: SERVER_CAPS_WRITE_MS, derivedFrom: null, clock: 'wall', flight: 'join', warnKey: null },
  { name: 'tasks', cadenceMs: TASK_SWEEP_MS, derivedFrom: null, clock: 'wall', flight: 'none', warnKey: null },
  { name: 'usage', cadenceMs: USAGE_SWEEP_MS, derivedFrom: null, clock: 'wall', flight: 'none', warnKey: null },
  {
    name: 'pr', cadenceMs: PR_SWEEP_MS, activeCadenceMs: PR_SWEEP_ACTIVE_MS, derivedFrom: null, clock: 'wall',
    flight: 'skip', staleAfterMs: PR_SWEEP_STUCK_MS, warnKey: null,
  },
  { name: 'names', cadenceMs: NAME_SWEEP_MS, derivedFrom: null, clock: 'wall', flight: 'none', warnKey: null },
  { name: 'divergences', cadenceMs: DIVERGENCE_SWEEP_MS, derivedFrom: null, clock: 'wall', flight: 'none', warnKey: null },
  { name: 'lifecycle', cadenceMs: LC_SWEEP_MS, derivedFrom: null, clock: 'wall', flight: 'none', warnKey: null },
  { name: 'readiness', cadenceMs: READINESS_SWEEP_MS, derivedFrom: null, clock: 'wall', flight: 'none', warnKey: null },
  { name: 'ledgerReconcile', cadenceMs: LEDGER_RECONCILE_SWEEP_MS, derivedFrom: null, clock: 'wall', flight: 'none', warnKey: null },
  { name: 'ledgerFloor', cadenceMs: LEDGER_FLOOR_SWEEP_MS, derivedFrom: null, clock: 'wall', flight: 'none', warnKey: null },
];

export function laneRow(name: string): LaneRow {
  const row = LANE_SCHEDULE.find((r) => r.name === name);
  if (row === undefined) throw new Error(`LANE_SCHEDULE has no lane named ${name}`);
  return row;
}
