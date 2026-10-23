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

/** Which clock a throttle reads: the watcher's monotonic clock (`Deps.monotonicMs`) or the wall clock (`Date.now()`). */
export type LaneClock = 'mono' | 'wall';

/** What a caller does when a run is already in flight: `skip` refuses (and, with `staleAfterMs`, abandons a run older
 *  than that), `join` hands back the run in flight, `join-rerun` joins and queues exactly one rerun, `none` lets
 *  runs overlap (the lane has no guard today). */
export type LaneFlight = 'skip' | 'join' | 'join-rerun' | 'none';

export type LaneName = 'caps' | 'catalogue' | 'inventory' | 'serverCaps';

export interface LaneRow {
  readonly name: LaneName | (string & {});
  /** How often the lane looks, in milliseconds. */
  readonly cadenceMs: number;
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
];

export function laneRow(name: string): LaneRow {
  const row = LANE_SCHEDULE.find((r) => r.name === name);
  if (row === undefined) throw new Error(`LANE_SCHEDULE has no lane named ${name}`);
  return row;
}
