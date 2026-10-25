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

/** Build 9 wave 7 (D12): the claim lease's lanes. 60 s: a 45-minute lease does not need the 2 s tick, and the divergence
 *  census already argues this cadence. Renew and lapse each keep their own row so neither starves the other's first run. */
export const CLAIM_SWEEP_MS = 60_000;

/** The stall watch's lane (spec 2026-09-29 §4.2, §10). It runs at `CLAIM_SWEEP_MS`'s cadence, for that constant's reason:
 *  a threshold of the quiet time (2 h built-in, 30 min at the least, stall watch settings §7) does not need the 2 s tick.
 *  A DECLARED REFERENCE (the row's `derivedFrom`), never a second literal. EXPORTED for its suite; `watch.ts` re-exports it. */
export const STALL_SWEEP_MS = CLAIM_SWEEP_MS;

/** `idle-compact-nudge` (D-5373): the lane's own clock. A nudge waits out `IDLE_NUDGE_SETTLE_MS` (30 s) anyway, so a 10 s
 *  beat costs at most one beat of extra delay; the transcript tail is re-read only when the file changed. */
export const IDLE_NUDGE_SWEEP_MS = 10_000;

/** The mail lane (the seventh; spec:159 fixes the cadence). Ten seconds is not how fast mail should arrive, it is how
 *  often the lane is allowed to ASK: delivery is bounded below by `MAIL_QUIET_MS`, so mail lands at a turn boundary. */
export const MAIL_SWEEP_MS = 10_000;

/** The ask-release lane's own self-throttle (RULING F4, task-7-brief): not how fast a lapsed hold fires (that ceiling is
 *  `ASK_GRACE_MS`, measured in minutes) but how often the lane is allowed to ASK, as `MAIL_SWEEP_MS` is for mail. */
export const ASK_SWEEP_MS = 10_000;

/** The approvals lane's daily prune of the approval inputs and the asks' question text (D-5298). The lane itself
 *  (`sweepApprovals`: lapse, ceiling, deferred pushes) has NO throttle and runs on every tick; only this block is a row. */
export const APPROVAL_PRUNE_MS = 86_400_000;

/** The drift reconciler's beat (D-5922, spec §4.1): fifteen minutes, the ledger reconcile's own, a read-and-record pass. */
export const DRIFT_SWEEP_MS = 900_000;

/** The daily digest's beat (D-5300): once a minute at most it looks for a settled day. */
export const DIGEST_BEAT_MS = 60_000;

/** The child-reclaim lane (child-reclamation wave 4, spec §5.7). The
 *  census's cadence, for the census's reason — a child's eligibility moves on
 *  human timescales (a run closes, a re-dispatch binds) — and the
 *  TWICE-OBSERVED rule is measured in these intervals: a child must read
 *  eligible on two passes at least this far apart before anything is
 *  composed. It is also the base of the failure backoff (spec §5.9: "retries
 *  back off in between"). The collector, the expiry lane and the dead-coordinator lane run at the same cadence, as
 *  siblings on the same tick. EXPORTED so its suite advances by the real constant; `watch.ts` re-exports it. */
export const CHILD_RECLAIM_SWEEP_MS = 60_000;

/** The temp-root collector's observation interval (spec §5.10): the lane spends a token only when its executor's own
 *  audit ARRIVED at least this long after an earlier audit of the id answered that same token, on this process's
 *  monotonic clock. The child lane's cadence, for that lane's reason, and DERIVED from it, never a second literal; L1
 *  takes it as an argument (it imports no L4 constant). EXPORTED for its suite; `watch.ts` re-exports it. */
export const COLLECT_OBSERVE_INTERVAL_MS = CHILD_RECLAIM_SWEEP_MS;

/** The checks lane's beat (PR landing in ccrc, stage 1): the fastest a project's read cadence goes. */
export const LANDING_CHECKS_BEAT_MS = 30_000;

/** Which clock a throttle reads: the watcher's monotonic clock (`Deps.monotonicMs`) or the wall clock (`Date.now()`). */
export type LaneClock = 'mono' | 'wall';

/** What a caller does when a run is already in flight: `skip` refuses (and, with `staleAfterMs`, abandons a run older
 *  than that), `join` hands back the run in flight, `join-rerun` joins and queues exactly one rerun, `none` lets
 *  runs overlap (the lane has no guard today). */
export type LaneFlight = 'skip' | 'join' | 'join-rerun' | 'none';

export type LaneName =
  | 'caps' | 'catalogue' | 'inventory' | 'landingChecks' | 'serverCaps'
  | 'tasks' | 'usage' | 'pr' | 'names' | 'divergences' | 'lifecycle' | 'readiness' | 'ledgerReconcile' | 'ledgerFloor' | 'drift'
  | 'claimRenew' | 'claimLapse' | 'stalls' | 'idleNudge' | 'mail' | 'asks' | 'approvalPrune' | 'digestBeat'
  | 'childReclaim' | 'collect' | 'archivedExpiry' | 'deadCoordinator' | 'orphanTrees';

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
  /** True when the lane's old field started at `-Infinity`, not `0`: it is due at ANY reading of its clock, a reading
   *  injected by a caller (`sweepDigest(now)`) included. */
  readonly startsDue?: true;
}

// Every row throttles on the monotonic clock: the operator ruled OA-C4 (a) on 2026-10-24 (#803), so the 21 rows that
// throttled on `Date.now()` moved after the expiry and dead-coordinator pair (spec K11, §5.1 rule 1b). A cadence is real
// time: a wall clock stepped back runs a lane at its cadence, and one stepped forward never runs it early. Verdicts keep
// reading the wall clock (an `expiresAt`, a `closedAt`, a digest day); `LaneClock` keeps its 'wall' member for a row that
// might ask for it, and none does.
export const LANE_SCHEDULE: readonly LaneRow[] = [
  { name: 'caps', cadenceMs: CAPS_REFRESH_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  {
    name: 'catalogue', cadenceMs: CATALOGUE_POLL_INTERVAL_MS, derivedFrom: null, clock: 'mono', flight: 'none',
    warnKey: 'ccrc-server: the catalogue poller rejected — this is a bug, poll() should never reject',
  },
  { name: 'inventory', cadenceMs: UPDATE_INVENTORY_MS, derivedFrom: null, clock: 'mono', flight: 'join-rerun', warnKey: null },
  // PR landing in ccrc, stage 1 (spec §3.5): the checks lane looks every 30 s; each project's own read cadence (30 s
  // while an episode is unsettled or red, 120 s otherwise) is the lane's own memory. A pass still running after five
  // minutes (a hung ccd call is bounded by its own timeout) is abandoned, never allowed to hold the lane shut.
  {
    name: 'landingChecks', cadenceMs: LANDING_CHECKS_BEAT_MS, derivedFrom: null, clock: 'mono', flight: 'skip',
    staleAfterMs: 5 * 60_000, warnKey: 'ccrc-server: the landing checks lane failed',
  },
  { name: 'serverCaps', cadenceMs: SERVER_CAPS_WRITE_MS, derivedFrom: null, clock: 'mono', flight: 'join', warnKey: null },
  { name: 'tasks', cadenceMs: TASK_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  { name: 'usage', cadenceMs: USAGE_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  {
    name: 'pr', cadenceMs: PR_SWEEP_MS, activeCadenceMs: PR_SWEEP_ACTIVE_MS, derivedFrom: null, clock: 'mono',
    flight: 'skip', staleAfterMs: PR_SWEEP_STUCK_MS, warnKey: null,
  },
  { name: 'names', cadenceMs: NAME_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  { name: 'divergences', cadenceMs: DIVERGENCE_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  { name: 'lifecycle', cadenceMs: LC_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  { name: 'readiness', cadenceMs: READINESS_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  { name: 'ledgerReconcile', cadenceMs: LEDGER_RECONCILE_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  { name: 'drift', cadenceMs: DRIFT_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'skip', warnKey: null },
  { name: 'ledgerFloor', cadenceMs: LEDGER_FLOOR_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  { name: 'claimRenew', cadenceMs: CLAIM_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  { name: 'claimLapse', cadenceMs: CLAIM_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  {
    name: 'stalls', cadenceMs: STALL_SWEEP_MS, clock: 'mono', flight: 'skip', warnKey: null,
    derivedFrom: { name: 'CLAIM_SWEEP_MS', reason: 'the stall watch needs no finer beat than the claim lanes it runs after' },
  },
  { name: 'idleNudge', cadenceMs: IDLE_NUDGE_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'skip', warnKey: null },
  { name: 'mail', cadenceMs: MAIL_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  { name: 'asks', cadenceMs: ASK_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  // The prune's failure is caught by `sweepApprovals`' own try (its sentence names the whole sweep), so no warnKey.
  { name: 'approvalPrune', cadenceMs: APPROVAL_PRUNE_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  { name: 'digestBeat', cadenceMs: DIGEST_BEAT_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null, startsDue: true },
  // The four lanes that select destructive acts. Child reclaim is the census's own cadence; the other three are its siblings on
  // the same tick, at the same cadence, and follow it by reference. All four throttle on the monotonic clock (spec K11, §5.1
  // rule 1b: a cadence is real time, so a wall clock stepped back must not hold a lane for the step, nor one stepped forward
  // run it early); the expiry and dead-coordinator lanes moved there from `Date.now()` in a commit of their own, and their
  // verdicts keep reading the wall clock. Child reclaim has no guard (a pass overtaken while it gathers
  // is dropped by its own pass counter), the collector keeps one pass at a time, and the dead-coordinator lane hands its pass to
  // the shutdown seal (`inFlight`). Their failures reach `tick`'s own catch, so no row warns.
  { name: 'childReclaim', cadenceMs: CHILD_RECLAIM_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'none', warnKey: null },
  {
    name: 'collect', cadenceMs: CHILD_RECLAIM_SWEEP_MS, clock: 'mono', flight: 'skip', warnKey: null,
    derivedFrom: { name: 'childReclaim', reason: 'a sibling of the child lane on the same tick; its observation interval is the same real time' },
  },
  {
    name: 'archivedExpiry', cadenceMs: CHILD_RECLAIM_SWEEP_MS, clock: 'mono', flight: 'skip', warnKey: null,
    derivedFrom: { name: 'childReclaim', reason: 'a sibling of the child lane on the same tick, under the same switch' },
  },
  {
    name: 'deadCoordinator', cadenceMs: CHILD_RECLAIM_SWEEP_MS, clock: 'mono', flight: 'join', warnKey: null,
    derivedFrom: { name: 'childReclaim', reason: 'a sibling of the child lane on the same tick, under the same switch' },
  },
  // The orphan-worktree lane (fleet disk retention, D-6631): the fifth of the same-tick siblings, its beat moved here from a
  // `lastOrphanTreeSweep` field of the watcher (GitHub #1279) with the clock, cadence and flight it had: monotonic, one pass a
  // cadence, passes may overlap (`OrphanTreeSweep` refuses its own second), and its failure reaches `tick`'s own catch.
  {
    name: 'orphanTrees', cadenceMs: CHILD_RECLAIM_SWEEP_MS, clock: 'mono', flight: 'none', warnKey: null,
    derivedFrom: { name: 'childReclaim', reason: 'a sibling of the child lane on the same tick, shadow until its own switch' },
  },
];

export function laneRow(name: string): LaneRow {
  const row = LANE_SCHEDULE.find((r) => r.name === name);
  if (row === undefined) throw new Error(`LANE_SCHEDULE has no lane named ${name}`);
  return row;
}
