// D-8077 (spec 2026-11-04 §7, §12; the ruled plan's W1, rules R1 to R8): THE RUN-CLOSE LANE'S DECIDER. L1: pure and
// clock-free (`nowMs` is an argument), no I/O, no store. It imports L0, `drift.ts` (the quiet window) and
// `deadCoordinator.ts` (the gap rule) and `askwindow.ts` (the hold's length) alone. The lane (`runCloseLane.ts`) gathers the facts, this file says what each row
// means, and `runStuck.ts` reads the same predicates, so a stuck reason and a close can never disagree (spec §7).
//
// TWO ROWS LAND HERE, in shadow until the operator arms the group: E1 (`never-started`, a programme whose every open run is
// planned and has been quiet for 72 hours, after a warning delivered at least 24 hours earlier) and E1r (`review-orphaned`,
// a planned review whose target closed, or whose target has a later review that moved). The kept crash row
// (`claimant-crashed`) is named so the shared rules (R1, R6) and its anchor read one definition. Later waves extend
// `RunCloseRow`; nothing here is a second definition of drift's `RUN_QUIET_MS` or the dead-coordinator lane's gap.
//
// ANY UNCERTAIN READING ANSWERS "NOT THIS PASS" (R2): a null anchor, an unread branch fact or an unmeasured claimant never
// closes and never counts toward a clock.
import {
  DEAD_COORDINATOR_LANE_LIVE_MARKER, RUNS_EXPIRE_COORDINATOR_GONE_MARKER, RUNS_EXPIRE_NEVER_STARTED_MARKER, type SwitchName,
} from '../../../shared/switches.js';
import { runBelongsTo, type ChildMarkRead } from '../../../shared/runBelongs.js';
import { RUN_CLOSE_REFUSALS, runCloseGroupArmed, type RunCloseChoice, type RunCloseGroup } from '../../../shared/run-close.js';
import { ITEM_DOORS, type ItemDoor, type ItemDoors } from '../../../shared/ledgers.js';
import { DEAD_COORDINATOR_BREAKER_WINDOW_MS, DEAD_COORDINATOR_GAP_MS } from '../deadCoordinator.js';
import { RUN_QUIET_MS } from './drift.js';

/** The rows the lane carries, by the names the plan gives them: E1, E1r, the kept crash row, and (D-8078) E3 (`claimant-gone`, a
 *  coordinator removed), E3s (`claimant-stopped`, a coordinator stopped by a person) and E5 (`name-reused`, a session name a later
 *  run now holds). */
export const RUN_CLOSE_ROWS = [
  'never-started', 'review-orphaned', 'claimant-crashed', 'claimant-gone', 'claimant-stopped', 'name-reused',
] as const;
export type RunCloseRow = (typeof RUN_CLOSE_ROWS)[number];

/** The words the lane's verdicts and holds carry (a hold's word reads "Nothing closes this on its own" for as long as it
 *  lasts). They ride a feed row, the lane's outcome and a log line, never a mail rejection or a run refusal. */
export const RUN_CLOSE_WORDS = [
  'live-session', 'unmeasured', 'coordinator-not-reached', 'warning-undelivered', 'child-marker-unreadable', 'open-pr',
  'unpushed-commits', 'would-warn', 'would-close', 'busy-worker', 'absent-claimant', 'tell-and-hold', 'breaker-held',
] as const;
/** Admitted through this guard by the mail-code scanner (`mail-routes.test.ts`), never NOT_CODES. */
export const isRunCloseKebab = (tok: string): boolean =>
  (RUN_CLOSE_ROWS as readonly string[]).includes(tok) || (RUN_CLOSE_WORDS as readonly string[]).includes(tok)
  || (RUN_CLOSE_REFUSALS as readonly string[]).includes(tok) || (REFUSAL_REASONS as readonly string[]).includes(tok)
  || (ITEM_DOORS as readonly string[]).includes(tok);
/** A lane row as spec §7's anchor table names it. Later waves add theirs to `RunCloseRow`. */
export type LaneRowName = RunCloseRow;

/** The marker that arms each row: no row is armed by another group's marker (R8). */
export const RUN_CLOSE_ROW_SWITCH: Readonly<Record<RunCloseRow, SwitchName>> = {
  'never-started': RUNS_EXPIRE_NEVER_STARTED_MARKER,
  'review-orphaned': RUNS_EXPIRE_NEVER_STARTED_MARKER,
  'claimant-crashed': DEAD_COORDINATOR_LANE_LIVE_MARKER,
  'claimant-gone': RUNS_EXPIRE_COORDINATOR_GONE_MARKER,
  'claimant-stopped': RUNS_EXPIRE_COORDINATOR_GONE_MARKER,
  'name-reused': RUNS_EXPIRE_COORDINATOR_GONE_MARKER,
};

/** The control group each row belongs to (§12.3): E1 and E1r arm together, the crash row on its own. */
export const RUN_CLOSE_ROW_GROUP: Readonly<Record<RunCloseRow, RunCloseGroup>> = {
  'never-started': 'never-started',
  'review-orphaned': 'never-started',
  'claimant-crashed': 'claimant-crashed',
  'claimant-gone': 'claimant-gone',
  'claimant-stopped': 'claimant-gone',
  'name-reused': 'claimant-gone',
};

/** Is this row armed? Its own group's exact `on`, or its group's marker standing in this registry listing (the emergency
 *  override). No other group's marker or choice counts. */
export const runCloseRowArmed = (row: RunCloseRow, names: readonly string[], choice: RunCloseChoice): boolean =>
  runCloseGroupArmed(names.includes(RUN_CLOSE_ROW_SWITCH[row]), choice);

/** E1's warning goes this long before the close (spec §7: the quiet arm starts at 48 h, the warning's own moment). */
export const RUN_CLOSE_WARN_LEAD_MS = 24 * 3_600_000;
/** The grace each row waits, from its anchor. `never-started` reads `RUN_QUIET_MS` by reference (G1 (a)). */
export const RUN_CLOSE_GRACE_MS: Readonly<Record<RunCloseRow, number>> = {
  'never-started': RUN_QUIET_MS,
  'review-orphaned': 3_600_000,
  'claimant-crashed': 3_600_000,
  /** E3: the first pass plus 1 h. E3s: the first pass plus 24 h. E5: the next pass, so it has no grace (spec §7). */
  'claimant-gone': 3_600_000,
  'claimant-stopped': 24 * 3_600_000,
  'name-reused': 0,
};
/** R7: at most this many programmes acted on a pass, and at most this many E1 warnings a pass, lane-wide. */
export const RUN_CLOSE_PROGRAMMES_PER_PASS = 3;
export const RUN_CLOSE_WARNINGS_PER_PASS = 1;
/** R6: a branch fact older than this, at the act, is unmeasured. */
export const RUN_CLOSE_FACT_MAX_AGE_MS = 5 * 60_000;
/** E1's quiet arm: the stuck verdict's `never-started` reads it too (spec §7 row 5), so the moment the coordinator is warned
 *  is the moment the run shows. */
export const RUN_CLOSE_QUIET_ARM_MS = RUN_QUIET_MS - RUN_CLOSE_WARN_LEAD_MS;

// ── the clocks (spec §7, "What 'in 20 h' counts down to") ────────────────────────────────────────────────────

/** What a row's anchor reads: the first pass of the unbroken series on which its condition held, and, for E1, the
 *  programme's last activity (R4). */
export interface LaneAnchorFacts {
  readonly firstPassAt: number | null;
  readonly programmeLastActivityAt: number | null;
}

/** THE ONE PLACE A ROW'S ACTIVITY ENTERS (spec §7). E1: the later of the programme's last activity and the first pass, so a
 *  50-day-old run in its first pass reads the full grace. E1r and the crash row: the first pass, and activity moves nothing.
 *  `null` when the row has no first pass yet (R2: not this pass). */
export function rowAnchor(row: LaneRowName, facts: LaneAnchorFacts): number | null {
  if (facts.firstPassAt === null) return null;
  if (row === 'never-started') return Math.max(facts.firstPassAt, facts.programmeLastActivityAt ?? 0);
  return facts.firstPassAt;
}

/** E1's warning as the lane has it: queued at `queuedAt`, and delivered at `deliveredAt` once the mail sweep delivered it. */
export interface WarningRead {
  readonly queuedAt: number;
  readonly deliveredAt: number | null;
}

/** `RunStuck['closes']` for one row (spec §7): the moment the row's own clocks run out, or null when no close is coming. E5 has no
 *  anchor and no grace: its clock is the next pass, so `at` is now.
 *  A shadow E1 counts the 72 h alone. An armed E1 is no earlier than 24 h after the warning's delivery, or 24 h from now
 *  while the warning is on its way (A58); a warning 24 h undelivered gives null. The lane closes at the first pass at or
 *  after `at`, never later (`neverStartedVerdict` reads the same figures). */
export function closesOf(
  row: LaneRowName, anchor: number | null, warning: WarningRead | null, armed: boolean, nowMs: number,
): { at: number; armed: boolean } | null {
  if (row === 'name-reused') return { at: nowMs, armed };
  if (anchor === null) return null;
  const base = anchor + RUN_CLOSE_GRACE_MS[row];
  if (row !== 'never-started' || !armed) return { at: base, armed };
  if (warning !== null && warning.deliveredAt !== null) return { at: Math.max(base, warning.deliveredAt + RUN_CLOSE_WARN_LEAD_MS), armed };
  if (warning !== null) {
    if (nowMs - warning.queuedAt >= RUN_CLOSE_WARN_LEAD_MS) return null;
    return { at: Math.max(base, nowMs + RUN_CLOSE_WARN_LEAD_MS), armed };
  }
  // No warning yet: before its moment the row reads as shadow does; from its moment the warning is on its way.
  if (nowMs < anchor + RUN_CLOSE_QUIET_ARM_MS) return { at: base, armed };
  return { at: Math.max(base, nowMs + RUN_CLOSE_WARN_LEAD_MS), armed };
}

// ── the store's rows ─────────────────────────────────────────────────────────────────────────────────────────

/** One open run as the lane reads it: the columns the rows' conditions name, and nothing hydrated
 *  (`CoordStore.runCloseRuns`). */
export interface LaneRun {
  readonly id: number;
  readonly program: string;
  readonly wave: number;
  readonly kind: 'work' | 'review';
  readonly state: string;
  readonly reviews: number | null;
  readonly claimedBy: string | null;
  readonly sessionId: string | null;
  readonly openedAt: number;
  readonly dispatchStartedAt: number | null;
  readonly lastDispatchAttemptAt: number | null;
  /** The run's project and its own branch (D-8078): E5 reads the open-PR fact by the run's branch, never by the session, whose
   *  branch is the later run's. Optional so a fixture that names neither stays valid. */
  readonly project?: string;
  readonly branch?: string | null;
}

/** A programme's E1 warning: queued at `warnedAt` to `claimant`, as delivery `deliveryId`; `deliveredAt` once the mail sweep
 *  delivered it (the delivery's own stamp), else null. A delivery that was rejected never delivers. */
export interface WarningRow {
  readonly programme: string;
  readonly claimant: string;
  readonly warnedAt: number;
  readonly deliveryId: number;
  readonly deliveredAt: number | null;
}

// ── R5: the grace anchor ─────────────────────────────────────────────────────────────────────────────────────

/** A row's durable anchor (`run_close_anchors`): the first and the latest pass of an unbroken series. */
export interface GraceAnchor { readonly firstAt: number; readonly lastAt: number }

/** The anchor after a pass on which the row's condition held (R5, `deadAnchorNext`'s rule): the first pass writes `firstAt`,
 *  a later one moves `lastAt` alone, and the series restarts on a gap over `DEAD_COORDINATOR_GAP_MS`, on `held` (a pause or
 *  maintenance) and on a backward step of the clock. */
export function graceAnchorNext(prev: GraceAnchor | null, nowMs: number, held: boolean): GraceAnchor {
  if (held || prev === null || nowMs < prev.lastAt || nowMs - prev.lastAt > DEAD_COORDINATOR_GAP_MS) {
    return { firstAt: nowMs, lastAt: nowMs };
  }
  return { firstAt: prev.firstAt, lastAt: nowMs };
}

// ── R4: activity ─────────────────────────────────────────────────────────────────────────────────────────────

/** What counts as a programme's activity (R4). Every field is an epoch-ms time or null. */
export interface ProgrammeActivityFacts {
  /** The newest act row on the programme's runs, drift's definition minus `causedBy 'sweep'` rows. */
  readonly lastActAt: number | null;
  /** The newest `openedAt` of the programme's runs. */
  readonly lastOpenedAt: number | null;
  /** The newest `lastDispatchAttemptAt` of the programme's runs (a refused dispatch counts). */
  readonly lastDispatchAttemptAt: number | null;
  /** The newest mail from the claimant that names one of the programme's runs. */
  readonly lastClaimantMailAt: number | null;
  /** The claimant's last busy turn, or `'unread'` when the watcher has not seen the session since it started. */
  readonly claimantBusyAt: number | null | 'unread';
  /** The warning's `deliveredAt` when one is delivered, else null. */
  readonly warningDeliveredAt: number | null;
}

/** The newest of the programme's activity, or `'unread'` (R2) when the busy turn matters and has not been read. The
 *  claimant's busy turn counts ONLY while no warning for the programme is delivered; from the warning's `deliveredAt`, the
 *  turn that reads the warning, or a turn on another programme it claims, is not activity (the departure
 *  `warning-turn-not-activity`). */
export function programmeLastActivity(f: ProgrammeActivityFacts): number | null | 'unread' {
  const times: number[] = [];
  for (const t of [f.lastActAt, f.lastOpenedAt, f.lastDispatchAttemptAt, f.lastClaimantMailAt]) if (t !== null) times.push(t);
  if (f.warningDeliveredAt === null) {
    if (f.claimantBusyAt === 'unread') return 'unread';
    if (f.claimantBusyAt !== null) times.push(f.claimantBusyAt);
  }
  return times.length === 0 ? null : Math.max(...times);
}

// ── R1 and R6: what may be touched ───────────────────────────────────────────────────────────────────────────

/** R1, every row (the crash row included): what the fleet act is. `none` for a run with no session, a marker that does not
 *  name this run (a later wave's, or a recycled name's) and a `none` marker (the departure `none-marker-no-fleet-act`): the
 *  close proceeds with no `ccd` call and no child hand-off. `list` for an unreadable or unrecognised marker: the run is
 *  listed and never closed. `release` for a readable marker of this run. */
export type FleetActFor = 'none' | 'release' | 'list';
export function fleetActFor(run: { readonly id: number; readonly sessionId: string | null }, mark: ChildMarkRead): FleetActFor {
  if (run.sessionId === null) return 'none';
  if (mark.kind === 'unreadable' || mark.kind === 'unrecognised') return 'list';
  return runBelongsTo(mark, run.id) ? 'release' : 'none';
}

/** The facts R6 reads for a run with a session, with the time they were read. `null` is unmeasured. */
export interface BranchFacts {
  readonly readAt: number;
  readonly openPr: boolean | null;
  readonly unpushed: boolean | null;
}
export type BranchVerdict =
  | { readonly kind: 'clear' }
  | { readonly kind: 'list'; readonly reason: 'open-pr' | 'unpushed-commits' | 'unmeasured' };

/** R6: an open PR or unpushed commits refuse the close and list the run; a fact older than `RUN_CLOSE_FACT_MAX_AGE_MS`, or
 *  unmeasured, refuses too. */
export function branchFactsFor(facts: BranchFacts | null, nowMs: number): BranchVerdict {
  if (facts === null || nowMs - facts.readAt > RUN_CLOSE_FACT_MAX_AGE_MS || nowMs < facts.readAt) return { kind: 'list', reason: 'unmeasured' };
  if (facts.openPr === null || facts.unpushed === null) return { kind: 'list', reason: 'unmeasured' };
  if (facts.openPr) return { kind: 'list', reason: 'open-pr' };
  if (facts.unpushed) return { kind: 'list', reason: 'unpushed-commits' };
  return { kind: 'clear' };
}

// ── the verdicts ─────────────────────────────────────────────────────────────────────────────────────────────

/** What a row decides for one candidate this pass. `wait`: its clock is running and nothing is due. `warn` and `close` act
 *  (armed); `would-warn` and `would-close` are their shadow. `list` is a needs-you reason with its word; `hold` is a
 *  deliberate non-act with its word (R2, R3, R6). */
export type RunCloseVerdict =
  | { readonly kind: 'wait' }
  | { readonly kind: 'warn' | 'would-warn' | 'close' | 'would-close' }
  | { readonly kind: 'list'; readonly word: string }
  | { readonly kind: 'hold'; readonly word: string };

export interface NeverStartedInput {
  /** `rowAnchor('never-started', …)`, or null (not this pass). */
  readonly anchor: number | null;
  /** The programme's last activity (R4) at this pass. */
  readonly lastActivityAt: number | null;
  readonly warning: WarningRead | null;
  readonly armed: boolean;
  /** Can the warning be delivered: the claimant reads alive, or asleep. `null` is unmeasured. */
  readonly claimantReachable: boolean | null;
}

/** E1 (spec §7, R4): warn when the programme has been quiet for 48 h, close at 72 h once the warning was delivered at least
 *  24 h earlier and after the programme's last activity. In shadow it answers `would-warn`, and `would-close` for a
 *  programme whose warning would already be 24 h delivered. An undelivered warning blocks the close and, with a claimant
 *  that cannot be reached, lists the programme as coordinator not reached. */
export function neverStartedVerdict(i: NeverStartedInput, nowMs: number): RunCloseVerdict {
  if (i.anchor === null) return { kind: 'hold', word: 'unmeasured' };
  const elapsed = nowMs - i.anchor;
  if (elapsed < RUN_CLOSE_QUIET_ARM_MS) return { kind: 'wait' };
  if (!i.armed) return { kind: elapsed >= RUN_QUIET_MS ? 'would-close' : 'would-warn' };
  const w = i.warning;
  const valid = w !== null && w.deliveredAt !== null && (i.lastActivityAt === null || w.deliveredAt > i.lastActivityAt);
  if (valid && elapsed >= RUN_QUIET_MS && nowMs - (w.deliveredAt as number) >= RUN_CLOSE_WARN_LEAD_MS) return { kind: 'close' };
  if (valid) return { kind: 'wait' };
  // No valid warning. It must be sent, and delivered, before anything closes.
  if (i.claimantReachable === null) return { kind: 'hold', word: 'unmeasured' };
  if (!i.claimantReachable) return { kind: 'list', word: 'coordinator-not-reached' };
  if (w === null) return { kind: 'warn' };
  return { kind: 'hold', word: 'warning-undelivered' };
}

export interface ReviewOrphanedInput {
  /** The review's target run has closed. */
  readonly targetClosed: boolean;
  /** The target has a later review that reached `working` or `done`. */
  readonly laterReviewMoved: boolean;
  readonly anchor: number | null;
  readonly armed: boolean;
}

/** E1r: a planned review whose target closed, or whose target has a later review that moved, after 1 h. A review of an open
 *  work run is never E1r. */
export function reviewOrphanedVerdict(i: ReviewOrphanedInput, nowMs: number): RunCloseVerdict {
  if (!i.targetClosed && !i.laterReviewMoved) return { kind: 'wait' };
  if (i.anchor === null) return { kind: 'hold', word: 'unmeasured' };
  if (nowMs - i.anchor < RUN_CLOSE_GRACE_MS['review-orphaned']) return { kind: 'wait' };
  return { kind: i.armed ? 'close' : 'would-close' };
}

export interface ClaimantGoneInput {
  readonly row: 'claimant-gone' | 'claimant-stopped' | 'name-reused';
  /** `rowAnchor(row, …)`, or null (not this pass). E5 has none and needs none. */
  readonly anchor: number | null;
  readonly armed: boolean;
}

/** E3, E3s and E5 (D-8078; spec §7, §12): a run whose coordinator was removed waits the first pass plus 1 h, one whose coordinator a
 *  person stopped the first pass plus 24 h, and one whose session name a later run holds waits for nothing (the next pass).
 *  Activity moves none of them. A null anchor is "not this pass" (R2). */
export function claimantGoneVerdict(i: ClaimantGoneInput, nowMs: number): RunCloseVerdict {
  if (i.row === 'name-reused') return { kind: i.armed ? 'close' : 'would-close' };
  if (i.anchor === null) return { kind: 'hold', word: 'unmeasured' };
  if (nowMs - i.anchor < RUN_CLOSE_GRACE_MS[i.row]) return { kind: 'wait' };
  return { kind: i.armed ? 'close' : 'would-close' };
}

/** A coordinator is NEWLY measured gone (the ruled W2) for this long after its stored gone time; an older one is a backlog, which is
 *  never clustered (the backlog drains on R7's budget). A burst already seen is held durably, so this is only the first sight's test. */
export const CLAIMANT_GONE_NEW_MS = 24 * 3_600_000;

/** The per-row breaker on TRANSITIONS (D-8078, the ruled W2): two or more coordinators that went gone within
 *  `DEAD_COORDINATOR_BREAKER_WINDOW_MS` of one another trip the row, so a burst (an OOM policy stopping every pane, a wave of
 *  archives) is never closed on a clock but left for a person. `goneAt` is each distinct coordinator's stored "gone since" time
 *  (`stuck.since`, which a restart moves not at all), so an old backlog, whose times are far apart, is never clustered. Returns
 *  the coordinators the breaker holds. */
export function claimantGoneBreaker(goneAt: ReadonlyMap<string, number>, fleetDoubt = false): ReadonlySet<string> {
  const held = new Set<string>();
  if (fleetDoubt) return new Set(goneAt.keys());   // a lane-wide doubt holds every coordinator in the pool
  const entries = [...goneAt];
  for (const [a, at] of entries) {
    for (const [b, bt] of entries) {
      if (a !== b && Math.abs(at - bt) <= DEAD_COORDINATOR_BREAKER_WINDOW_MS) { held.add(a); held.add(b); }
    }
  }
  return held;
}

/** R7: the candidates a pass may act on, oldest activity first, at most `RUN_CLOSE_PROGRAMMES_PER_PASS` programmes. The rest
 *  stay eligible on the next pass. */
export function runCloseBudget<T extends { readonly program: string; readonly activityAt: number | null }>(
  candidates: readonly T[],
): { readonly act: T[]; readonly left: T[] } {
  const ordered = [...candidates].sort((a, b) => (a.activityAt ?? 0) - (b.activityAt ?? 0) || a.program.localeCompare(b.program));
  const programmes: string[] = [];
  const act: T[] = [];
  const left: T[] = [];
  for (const c of ordered) {
    if (!programmes.includes(c.program) && programmes.length >= RUN_CLOSE_PROGRAMMES_PER_PASS) { left.push(c); continue; }
    if (!programmes.includes(c.program)) programmes.push(c.program);
    act.push(c);
  }
  return { act, left };
}

// ── refused closes (spec §12.2, A19, A59, A62) ───────────────────────────────────────────────────────────────

/** Why an armed lane's close was refused, as the table in §12.2 names the cases. `unknown-run` is a run in a state this server
 *  cannot name; `busy-worker` is E3's (a later wave feeds it) and `absent-claimant` is a run nobody claims and nothing records. */
export const REFUSAL_REASONS = [
  'open-pr', 'unpushed-commits', 'busy-worker', 'child-marker-unreadable', 'absent-claimant', 'warning-undelivered', 'unknown-run',
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** THE ONE TABLE of each raising row's doors (A19, A62). An empty list is a reason that raises no item. Every door but one
 *  opens a page or a sheet that already exists; Abandon and "Abandon anyway" reach `POST /api/items/:id/act`, and "Hand to a
 *  coordinator" is `POST /api/runs/:id/reclaim` under a gone claimant. */
export const REFUSAL_DOORS: Readonly<Record<RefusalReason, readonly ItemDoor[]>> = {
  'open-pr': ['open-pr'],
  'unpushed-commits': ['hand-to-coordinator', 'abandon-anyway'],
  'busy-worker': ['open-worker'],
  'child-marker-unreadable': ['abandon'],
  'absent-claimant': ['abandon'],
  'warning-undelivered': ['open-coordinator'],
  'unknown-run': [],
};

/** The doors of a reason as the action wants them (a non-empty tuple), or null for a reason that raises no item. */
export function refusalDoors(reason: RefusalReason): ItemDoors | null {
  const d = REFUSAL_DOORS[reason];
  return d.length === 0 ? null : (d as unknown as ItemDoors);
}

export type RefusalRoute =
  | { readonly kind: 'tell' }
  | { readonly kind: 'tell-and-hold'; readonly doors: ItemDoors }
  | { readonly kind: 'item'; readonly doors: ItemDoors }
  | { readonly kind: 'inform' };

/** One row per line of §12.2's table. `coordinator` is `lives` for an alive or asleep claimant and `gone` for one that reads
 *  dead; `abandonable` is `abandonRefusal(coord, runId) === null`, read inside the lane's hold. A run the arm cannot move from
 *  its row raises no item whoever owns it, and an `unknown` run is information whoever owns it. A live coordinator is told first
 *  and the item is the last step, so it shows only when the cell is one the coordinator may handle itself (the unreadable
 *  marker, held for the ask window). This decider is clock-free: the lane takes the hold's end from `askNotifyAt(now)`.
 *  The cells §12.2 says do not arise under a living coordinator (busy worker, absent claimant, an undelivered warning) answer
 *  `tell`: nothing is raised for them. */
export function refusalRoute(reason: RefusalReason, coordinator: 'lives' | 'gone', abandonable: boolean): RefusalRoute {
  const doors = refusalDoors(reason);
  if (reason === 'unknown-run' || doors === null || !abandonable) return { kind: 'inform' };
  if (coordinator === 'lives') {
    return reason === 'child-marker-unreadable' ? { kind: 'tell-and-hold', doors } : { kind: 'tell' };
  }
  return { kind: 'item', doors };
}

/** E1's warning, due at the programme's quiet arm and never delivered: it has been undelivered for 24 hours past its due
 *  moment (a queued warning's own queue time, else the anchor's quiet arm). The `Open the coordinator` row of §12.2. */
export function warningUndeliveredPast(anchor: number | null, warning: WarningRead | null, nowMs: number): boolean {
  if (warning !== null && warning.deliveredAt !== null) return false;
  const due = warning !== null ? warning.queuedAt : anchor === null ? null : anchor + RUN_CLOSE_QUIET_ARM_MS;
  return due !== null && nowMs - due >= RUN_CLOSE_WARN_LEAD_MS;
}
