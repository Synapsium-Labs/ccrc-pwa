// D-8077 (spec 2026-11-04 §7, §12; the ruled plan's W1): ONE PASS OF THE RUN-CLOSE LANE, rows E1 (`never-started`) and E1r
// (`review-orphaned`). It is a row of `LANE_SCHEDULE` (`runClose`, a minute, the registry pass's own cadence) driven by
// `FleetWatcher.sweepRunClose`; it adds no clock of its own. It decides nothing itself (`runClose.ts`, L1, is the decider) and
// closes nothing itself (`closeRun`'s abandon arm, reached only through the coordination serialiser's sweep handle).
//
// SHADOW UNTIL THE OPERATOR ARMS THE GROUP (Advanced, `POST /api/coord/run-close`, Task 26; the `runs-expire-never-started` marker stays
// an emergency override). The group's choice is off, shadow or on: off reads, records and acts on nothing. Unarmed, a pass reads, anchors,
// writes the `closes` map the screen counts down on, and records "would warn" / "would close" through `notify` (record-only)
// only when a (row, programme) outcome CHANGES. It sends no mail, asks no wake and acts on nothing. Armed, it warns (at most
// one a pass, lane-wide) and closes (at most three programmes a pass), each close through the guard below.
//
// IN ORDER, EVERY DOUBT "NOT THIS PASS" (R2):
//   1. the registry listing: `reclaim-paused` stops the lane entirely (shadow included) and `coordinator-paused` holds it (R3);
//      either clears the `closes` map and restarts every grace (R5), as does a listing that could not be taken;
//   2. the open runs, in one read; a store that cannot say leaves the map as it was;
//   3. per programme or review: the anchor (R5), the activity (R4), the verdict (`runClose.ts`) and `closes` (`closesOf`);
//   4. per candidate run with a session: a live session holds (R1), the branch facts (R6) and the child marker (R1) are read
//      BEFORE the serialiser, and any run they refuse reads `closes` null ("Nothing closes this on its own");
//   5. armed only: the warning, then the closes, inside the serialiser, each with `stillStuck` re-measuring the world.
//
// A run's `closes` is written for every candidate the lane reads, whole, on each pass, and the map is empty while the lane
// holds. The stuck verdict's pass never touches it, so the two clocks never fight (A57).
//
// ROWS E3, E3s AND E5 (D-8078; the claimant-gone group, its own choice and marker). They take their candidates from the stuck
// verdict's own answer (`RunVerdict.closeRow`, `closeRowOf`), so a stuck reason and a close can never disagree: E3 a coordinator
// removed (the first pass plus 1 h), E3s one a person stopped (plus 24 h), E5 a session name a later run holds (the next pass,
// with no ccd call). A run E1 or E1r already fits stays theirs (E1 over E3, o2). A live worker under a gone coordinator is the
// `busy-worker` refusal, and two coordinators gone within the breaker's window hold their runs for a person (`claimantGoneBreaker`).
import type { NotifyLog } from '../notifylog.js';
import type { DeadCoordinatorStop } from '../deadCoordinator.js';
import { notifyEach } from '../notice.js';
import { readSwitches } from '../../../shared/switches.js';
import type { ChildMarkRead } from '../../../shared/runBelongs.js';
import type { RunStuck } from '../../../shared/api.js';
import type { CloseOutcome, SweepCloseGuard } from './close.js';
import { routeRefusals, unknownStateRuns, type RefusedClose } from './runCloseRefusals.js';
import type { WatcherCoordPort } from './ports.js';
import type { ClaimantVerdict } from './reclaim.js';
import { RUN_CLOSE_WHY, type RunCloseNamed, type RunCloseReading, type RunCloseWhy, type RunCloseWould } from '../../../shared/run-close.js';
import { runBelongsTo } from '../../../shared/runBelongs.js';
import { COORDINATOR_PAUSE_MARKER, RECLAIM_PAUSE_MARKER } from './rundefs.js';
import { insertSystemMailTx } from './rundefsTx.js';
import type { RunVerdicts } from './runVerdicts.js';
import {
  RUN_CLOSE_WARNINGS_PER_PASS, branchFactsFor, CLAIMANT_GONE_NEW_MS, claimantGoneBreaker, claimantGoneVerdict, closesOf, fleetActFor, graceAnchorNext, warningUndeliveredPast,
  RUN_CLOSE_ROW_GROUP, RUN_CLOSE_ROW_SWITCH, neverStartedVerdict, programmeLastActivity, reviewOrphanedVerdict, rowAnchor, runCloseBudget, runCloseRowArmed,
  type BranchFacts, type LaneRun, type RefusalReason, type RunCloseRow, type RunCloseVerdict, type WarningRead,
} from './runClose.js';

/** The head of the warning this lane sends; the push lane and the tests read it from here (record-only, never a push). */
export const RUN_CLOSE_WARNING_PREFIX = 'runs closing:';
export const isRunCloseWarning = (subject: string): boolean => subject.startsWith(RUN_CLOSE_WARNING_PREFIX);

/** How long a branch fact read for a candidate is reused. Under R6's five minutes, so the fact the act sees is fresh enough. */
const BRANCH_FACT_REUSE_MS = 3 * 60_000;

/** What the lane remembers between passes, in memory only: the last outcome it recorded per (row, programme), and the branch
 *  facts it read. A restart forgets both, which costs one repeated feed row and one repeated read. */
export interface RunCloseLaneMemory {
  readonly outcomes: Map<string, string>;
  readonly facts: Map<number, BranchFacts>;
}
export const createRunCloseMemory = (): RunCloseLaneMemory => ({ outcomes: new Map(), facts: new Map() });

export interface RunCloseLaneDeps {
  readonly coord: WatcherCoordPort;
  readonly verdicts: RunVerdicts;
  readonly now: () => number;
  /** One measured listing of the registry directory (the switches), or null when it could not be listed. */
  readonly registryNames: () => Promise<readonly string[] | null>;
  /** The act-time guard's own listing, fresh; absent, the pass's `registryNames`. */
  readonly freshRegistryNames?: () => Promise<readonly string[] | null>;
  /** The reclaim door's own ladder for a session, claimant or worker. */
  readonly measure: (id: string) => Promise<ClaimantVerdict>;
  /** `measure` for the claimant-gone rows' coordinators (A56): a dead reading over a standing `.substrate` stamp is doubt, so a stamp
   *  holds E3 and E3s as it holds the stuck verdict. Absent, `measure`. */
  readonly measureHeld?: (id: string) => Promise<ClaimantVerdict>;
  /** The claimant's last busy turn, or `'unread'` before the watcher has seen the session since it started (R4). */
  readonly claimantBusyAt: (claimant: string) => number | null | 'unread';
  /** R6: the open-PR and unpushed-commit reads for a session's branch, taken before the serialiser. */
  readonly branchFacts: (sessionId: string) => Promise<BranchFacts>;
  /** R1: the session's `.child` marker, read fresh, or null when it cannot be measured. */
  readonly childMark: (sessionId: string) => Promise<ChildMarkRead | null>;
  /** `abandonRefusal(coord, runId)`: the abandon arm's own read of a run's row, without acting. Asked inside the hold before an item
   *  whose door is Abandon is raised (A62). */
  readonly abandonRefusal: (runId: number) => Extract<CloseOutcome, { ok: false }> | null;
  /** E5's R6 read (D-8078): is a pull request open from the RUN'S OWN branch, read by that head and never by `--session` (the
   *  session's branch is the later run's). `null` is unmeasured. Absent, every E5 run is unmeasured and listed. */
  readonly branchOpenPr?: (project: string, branch: string) => Promise<boolean | null>;
  /** The coordination serialiser's sweep handle. Null when none is wired: nothing is ever closed. */
  readonly serial: (<T>(coord: WatcherCoordPort, fn: (
    abandon: (runId: number, claimedBy: string, stillStuck: SweepCloseGuard['stillStuck'],
      extra?: Pick<SweepCloseGuard, 'fleetAct' | 'detail'>) => Promise<CloseOutcome>,
  ) => Promise<T>) => Promise<T>) | null;
  readonly notifyLog?: NotifyLog;
  readonly memory: RunCloseLaneMemory;
}

/** What a pass did, for the suites and the log. */
export interface RunCloseOutcome {
  readonly held: string | null;
  readonly warned: readonly string[];
  readonly closed: readonly number[];
  readonly refused: readonly { readonly runId: number; readonly why: string }[];
}

const E1: RunCloseRow = 'never-started';
const E1R: RunCloseRow = 'review-orphaned';
/** The three rows of the claimant-gone group, and the reason each shows in the would-close list. */
const GONE_ROWS = ['claimant-gone', 'claimant-stopped', 'name-reused'] as const;
type GoneRow = (typeof GONE_ROWS)[number];
/** The breaker's durable state (the ruled W2's `run_close_armed` and held set), kept as anchors under a pseudo lane row per breaker row
 *  so no migration is needed: `breaker:<row>` holds the claimants a burst holds (until they stop being candidates), and `backlog:<row>`
 *  the claimants present when the group was armed, plus a `*` sentinel (so an empty snapshot is still a snapshot). */
const BREAKER_ROWS = ['claimant-gone', 'claimant-stopped'] as const;
const heldStore = (row: (typeof BREAKER_ROWS)[number]): string => `breaker:${row}`;
const backlogStore = (row: (typeof BREAKER_ROWS)[number]): string => `backlog:${row}`;
const BREAKER_STORES = BREAKER_ROWS.flatMap((r) => [heldStore(r), backlogStore(r)]);
const SNAPSHOT_KEY = '*';
const isGoneRow = (row: RunCloseRow): row is GoneRow => (GONE_ROWS as readonly string[]).includes(row);
const GONE_WHY: Readonly<Record<GoneRow, RunCloseWhy>> = {
  'claimant-gone': RUN_CLOSE_WHY.claimantGone, 'claimant-stopped': RUN_CLOSE_WHY.claimantStopped, 'name-reused': RUN_CLOSE_WHY.nameReused,
};

/** A candidate run the lane read this pass. */
interface Candidate {
  readonly run: LaneRun;
  readonly row: RunCloseRow;
  /** `null`: the run may be closed (its fleet act is `fleetAct`); a word otherwise ("Nothing closes this on its own"). */
  readonly hold: string | null;
  readonly fleetAct: 'release' | 'none';
}

/** One programme or review the lane may act on this pass, with what the act needs. */
interface Actionable {
  readonly row: RunCloseRow;
  readonly program: string;
  readonly claimant: string;
  readonly activityAt: number | null;
  readonly verdict: RunCloseVerdict;
  readonly runs: readonly Candidate[];
  readonly warning: WarningRead | null;
  readonly detail: string;
  /** How the claimant reads (the reclaim door's ladder), and the row's anchor: what a refused close is routed by. */
  readonly claimantState: 'alive' | 'dead' | 'unmeasurable';
  /** D-8558: false when the registry holds no row for the claimant (`cause: 'absent'`): its item offers no door to it. */
  readonly claimantHeld: boolean;
  readonly anchor: number | null;
}

/** One pass. Never throws: a failure is warned and leaves the `closes` map as it was. */
export async function runClosePass(deps: RunCloseLaneDeps): Promise<RunCloseOutcome> {
  try {
    return await pass(deps);
  } catch (err) {
    console.warn(`ccrc-server: runClose: the pass failed (${err instanceof Error ? err.message : String(err)}) — the clocks keep their last answer`);
    return { held: 'failed', warned: [], closed: [], refused: [] };
  }
}

const NONE: RunCloseOutcome = { held: null, warned: [], closed: [], refused: [] };

async function pass(deps: RunCloseLaneDeps): Promise<RunCloseOutcome> {
  const { coord, memory } = deps;
  const names = await deps.registryNames();
  // R3: a pause, or a registry that will not list, holds the whole lane. The map is empty, and every grace restarts.
  const hold = names === null ? 'the registry did not list'
    : readSwitches(names)[RECLAIM_PAUSE_MARKER] === 'set' ? `${RECLAIM_PAUSE_MARKER} is raised`
      : readSwitches(names)[COORDINATOR_PAUSE_MARKER] === 'set' ? `${COORDINATOR_PAUSE_MARKER} is raised` : null;
  if (hold !== null) {
    deps.verdicts.setCloses(new Map());
    deps.verdicts.setReading(null);
    for (const row of [E1, E1R, ...GONE_ROWS] as const) for (const key of coord.runCloseAnchors(row).keys()) coord.deleteRunCloseAnchor(row, key);
    return { ...NONE, held: hold };
  }
  const choice = coord.runCloseChoice(RUN_CLOSE_ROW_GROUP[E1]);
  const armed = runCloseRowArmed(E1, names!, choice);
  const goneChoice = coord.runCloseChoice('claimant-gone');
  const goneArmed = runCloseRowArmed('claimant-gone', names!, goneChoice);
  const now = deps.now();
  // OFF (§12.3): a group that is off reads nothing, records nothing and keeps no clock. A standing marker is the emergency override
  // and wins. Each group is off on its own: the other still runs.
  const neverOff = choice === 'off' && !names!.includes(RUN_CLOSE_ROW_SWITCH[E1]);
  const goneOff = goneChoice === 'off' && !names!.includes(RUN_CLOSE_ROW_SWITCH['claimant-gone']);
  if (neverOff) for (const row of [E1, E1R] as const) for (const key of coord.runCloseAnchors(row).keys()) coord.deleteRunCloseAnchor(row, key);
  if (goneOff) for (const row of [...GONE_ROWS, ...BREAKER_STORES] as const) for (const key of coord.runCloseAnchors(row).keys()) coord.deleteRunCloseAnchor(row, key);
  if (neverOff && goneOff) {
    deps.verdicts.setCloses(new Map());
    deps.verdicts.setReading({ at: now, groups: {} });
    return { ...NONE, held: 'off' };
  }
  const runs = coord.runCloseRuns();
  /** E1 and E1r read nothing while their group is off, whatever the other group does. */
  const e1Runs = neverOff ? [] : runs;
  // The branch facts of a run that is no longer open are forgotten, so the memory stays as small as the open runs.
  const open = new Set(runs.map((r) => r.id));
  for (const id of memory.facts.keys()) if (!open.has(id)) memory.facts.delete(id);
  const closes = new Map<number, NonNullable<RunStuck['closes']>>();
  const would: RunCloseWould[] = [];
  const named: RunCloseNamed[] = [];
  const doubted = new Set<number>();   // runs a pass could not measure: never "gone" on a doubt
  const acts: Actionable[] = [];
  const measured = new Map<string, Promise<ClaimantVerdict>>();
  const measure = (id: string): Promise<ClaimantVerdict> => {
    let m = measured.get(id);
    if (m === undefined) { m = deps.measure(id); measured.set(id, m); }
    return m;
  };
  const measuredHeld = new Map<string, Promise<ClaimantVerdict>>();
  const measureHeld = (id: string): Promise<ClaimantVerdict> => {
    if (deps.measureHeld === undefined) return measure(id);
    let m = measuredHeld.get(id);
    if (m === undefined) { m = deps.measureHeld(id); measuredHeld.set(id, m); }
    return m;
  };

  // ── E1: a programme whose every open run is planned ──────────────────────────────────────────────────────
  const anchors = coord.runCloseAnchors(E1);
  const seen = new Set<string>();
  const absent: LaneRun[] = [];
  const programmes = [...new Set(e1Runs.map((r) => r.program))];
  /** The runs E1 or E1r fits: E1 decides them, so E3 neither counts nor closes them (o2, spec §12.2's precedence rule). */
  const lanedRuns = new Set<number>();
  for (const program of programmes) {
    const ofProgram = e1Runs.filter((r) => r.program === program);
    const work = ofProgram.filter((r) => r.kind === 'work');
    if (work.length === 0 || !ofProgram.every((r) => r.state === 'planned')) continue;
    const claimants = [...new Set(ofProgram.map((r) => r.claimedBy))];
    if (claimants.length !== 1) continue;   // R2: two claimants is not this pass
    for (const r of ofProgram) lanedRuns.add(r.id);
    if (claimants[0] === null) {
      // No claimant on record for any run of the programme: nothing to warn and nobody to measure, so no clock but its own quiet.
      // When that quiet has run its grace the close is not coming (there is no one to warn); the refusal is §12.2's absent-claimant
      // cell, raised at once with Abandon.
      seen.add(program);
      const quietAct = programmeLastActivity({ ...coord.programmeActivity(program), claimantBusyAt: null, warningDeliveredAt: null });
      if (quietAct === 'unread') { for (const r of ofProgram) doubted.add(r.id); continue; }
      const quietNext = graceAnchorNext(anchors.get(program) ?? null, now, false);
      coord.setRunCloseAnchor(E1, program, quietNext);
      const quietAnchor = rowAnchor(E1, { firstPassAt: quietNext.firstAt, programmeLastActivityAt: quietAct });
      const quietDue = closesOf(E1, quietAnchor, null, false, now);
      if (quietDue !== null && now >= quietDue.at) absent.push(work[0]!);
      // The grace is still running from this server's own first sight of the programme (a restart: a pause, a gap, a first
      // pass): the refusal is not re-measured, so its item and anchor stay (§12.2: a refusal that lasts tells once).
      else if (quietAnchor === quietNext.firstAt) for (const r of ofProgram) doubted.add(r.id);
      continue;
    }
    const claimant = claimants[0]!;
    seen.add(program);
    let warningRow = coord.runCloseWarning(program);
    // A warning was sent to the claimant of that day. A reclaim since makes the programme's coordinator someone who was never
    // warned, so the row is no warning for them: deleted, and the next pass warns the claimant now.
    if (warningRow !== null && warningRow.claimant !== claimant) { coord.deleteRunCloseWarning(program); warningRow = null; }
    const act = programmeLastActivity({
      ...coord.programmeActivity(program), claimantBusyAt: deps.claimantBusyAt(claimant),
      warningDeliveredAt: warningRow?.deliveredAt ?? null,
    });
    if (act === 'unread') { for (const r of ofProgram) doubted.add(r.id); continue; }   // R2: the busy turn has not been read since the server started
    // Any activity after the warning invalidates it: the next close needs a fresh one delivered 24 h earlier.
    if (warningRow !== null && act !== null && act > warningRow.warnedAt) { coord.deleteRunCloseWarning(program); warningRow = null; }
    const reach = await measure(claimant);
    if (reach.state === 'unmeasurable') { for (const r of ofProgram) doubted.add(r.id); continue; }   // R2: an uncertain claimant counts toward no clock this pass
    const claimantReachable = reach.state === 'alive';
    const next = graceAnchorNext(anchors.get(program) ?? null, now, false);
    coord.setRunCloseAnchor(E1, program, next);
    const anchor = rowAnchor(E1, { firstPassAt: next.firstAt, programmeLastActivityAt: act });
    const warning: WarningRead | null = warningRow === null ? null : { queuedAt: warningRow.warnedAt, deliveredAt: warningRow.deliveredAt };
    const verdict = neverStartedVerdict({ anchor, lastActivityAt: act, warning, armed, claimantReachable }, now);
    // The clock the run screen counts down on. An armed warning that can never be sent (the verdict lists the programme as
    // "coordinator not reached") is no clock at all: "Nothing closes this on its own", from the first pass that reads it.
    const armedClock = closesOf(E1, anchor, warning, true, now);
    let clock = armed ? armedClock : closesOf(E1, anchor, warning, false, now);
    if (armed && verdict.kind === 'list') clock = null;
    // The would-close list counts what ARMING does (§12.3): a run with no delivered warning is "later" in shadow as it is armed.
    const listClock = armed ? clock : armedClock;
    const candidates: Candidate[] = [];
    for (const run of work) {
      const c = await candidateOf(deps, run, E1, now, measure);
      candidates.push(c);
      if (clock !== null && c.hold === null) closes.set(run.id, clock);
      // The would-close list (§12.3): a run the lane holds, or whose warning cannot be delivered, is named under it, never in it.
      const why = c.hold ?? (verdict.kind === 'list' || verdict.kind === 'hold' ? verdict.word : !claimantReachable ? 'coordinator-not-reached' : null);
      if (why !== null) named.push({ runId: run.id, program, why });
      else if (listClock === null) named.push({ runId: run.id, program, why: 'warning-undelivered' });
      else would.push({ runId: run.id, program, why: RUN_CLOSE_WHY.neverStarted, at: listClock.at });
    }
    // A grace that restarted (a pause, a gap over DEAD_COORDINATOR_GAP_MS, a first sight) reads `wait` whatever stood before,
    // for as long as the grace binds: that is a doubt, not "the reason has gone" (§12.2). Activity moves the anchor past it.
    if (verdict.kind === 'wait' && anchor === next.firstAt) for (const r of ofProgram) doubted.add(r.id);
    record(deps, E1, program, claimant, verdict, armed, now);
    acts.push({
      row: E1, program, claimant, activityAt: act, verdict, runs: candidates, warning,
      detail: `expired:never-started quiet-since=${anchor ?? 0}`, claimantState: claimantReachable ? 'alive' : 'dead',
      claimantHeld: registryHolds(reach), anchor,
    });
  }
  for (const program of coord.runCloseWarningProgrammes()) if (!seen.has(program)) coord.deleteRunCloseWarning(program);
  for (const key of anchors.keys()) if (!seen.has(key)) coord.deleteRunCloseAnchor(E1, key);

  // ── E1r: a planned review of finished work ───────────────────────────────────────────────────────────────
  const reviewAnchors = coord.runCloseAnchors(E1R);
  const seenReviews = new Set<string>();
  for (const run of e1Runs) {
    if (run.kind !== 'review' || run.state !== 'planned' || run.reviews === null) continue;
    const target = coord.run(run.reviews);
    if (!target.ok || target.run === null) { doubted.add(run.id); continue; }   // R2: a target the store cannot read is not this pass
    const targetClosed = target.run.closedAt !== null;
    const laterAt = coord.laterReviewMovedAt(run.reviews, run.id);
    if (!targetClosed && laterAt === null) continue;
    if (run.claimedBy === null) continue;
    lanedRuns.add(run.id);
    seenReviews.add(String(run.id));
    const next = graceAnchorNext(reviewAnchors.get(String(run.id)) ?? null, now, false);
    coord.setRunCloseAnchor(E1R, String(run.id), next);
    const anchor = rowAnchor(E1R, { firstPassAt: next.firstAt, programmeLastActivityAt: null });
    const verdict = reviewOrphanedVerdict({ targetClosed, laterReviewMoved: laterAt !== null, anchor, armed }, now);
    const c = await candidateOf(deps, run, E1R, now, measure);
    const owner = await measure(run.claimedBy);
    const clock = closesOf(E1R, anchor, null, armed, now);
    if (clock !== null && c.hold === null) closes.set(run.id, clock);
    if (c.hold !== null) named.push({ runId: run.id, program: run.program, why: c.hold });
    else if (clock !== null) {
      would.push({ runId: run.id, program: run.program, why: targetClosed ? RUN_CLOSE_WHY.reviewOfClosed : RUN_CLOSE_WHY.laterReview, at: clock.at });
    }
    if (verdict.kind === 'wait') doubted.add(run.id);   // the grace runs from this server's own first sight: a doubt, not a measurement
    record(deps, E1R, `${run.program}#${run.id}`, run.claimedBy, verdict, armed, now);
    acts.push({
      row: E1R, program: run.program, claimant: run.claimedBy, activityAt: anchor, verdict, runs: [c], warning: null,
      detail: `expired:review-orphaned ${targetClosed ? 'target-closed' : 'later-review'}`,
      claimantState: owner.state === 'alive' ? 'alive' : owner.state === 'dead' ? 'dead' : 'unmeasurable', claimantHeld: registryHolds(owner), anchor,
    });
  }
  for (const key of reviewAnchors.keys()) if (!seenReviews.has(key)) coord.deleteRunCloseAnchor(E1R, key);

  // ── E3, E3s, E5: the claimant-gone group ─────────────────────────────────────────────────────────────────
  const goneWould: RunCloseWould[] = [];
  const goneNamed: RunCloseNamed[] = [];
  const goneAbsent: LaneRun[] = [];
  if (!goneOff) await claimantGoneRows(deps, { runs, lanedRuns, armed: goneArmed, now, closes, would: goneWould, named: goneNamed, doubted, acts, measure, measureHeld, absent: goneAbsent });

  deps.verdicts.setCloses(closes);
  const reading: RunCloseReading = { at: now, groups: {
    ...(neverOff ? {} : { 'never-started': { would, named } }),
    ...(goneOff ? {} : { 'claimant-gone': { would: goneWould, named: goneNamed } }),
  } };
  deps.verdicts.setReading(reading);
  if (!(armed || goneArmed) || deps.serial === null) return NONE;
  const out = await act(deps, acts, now);
  // A refusal is routed only for a row whose OWN group is armed: a shadow group raises no item (A53) and one group's choice never arms
  // another's rows (R8).
  const groupArmed = (row: RunCloseRow): boolean => (RUN_CLOSE_ROW_GROUP[row] === 'claimant-gone' ? goneArmed : armed);
  await routeClosesRefused(deps, runs, acts.filter((a) => groupArmed(a.row)), out, now, measure, doubted, [...(armed ? absent : []), ...(goneArmed ? goneAbsent : [])]);
  // A close the arm refused is remembered per group, so Advanced can say how many it met in 7 days.
  const groupOf = new Map(acts.flatMap((a) => a.runs.map((c) => [c.run.id, RUN_CLOSE_ROW_GROUP[a.row]] as const)));
  for (const r of out.refused) coord.recordRunCloseRefusal(groupOf.get(r.runId) ?? RUN_CLOSE_ROW_GROUP[E1], r.runId, r.why, now);
  // A close the arm refused is no close coming: the run reads "Nothing closes this on its own" until the next pass re-measures.
  if (out.refused.length > 0) {
    for (const r of out.refused) closes.delete(r.runId);
    deps.verdicts.setCloses(closes);
  }
  return out;
}

/** What `claimantGoneRows` shares with the pass that calls it: the pass's own collections, which it fills. */
interface GoneContext {
  readonly runs: readonly LaneRun[];
  readonly lanedRuns: ReadonlySet<number>;
  readonly armed: boolean;
  readonly now: number;
  readonly closes: Map<number, NonNullable<RunStuck['closes']>>;
  readonly would: RunCloseWould[];
  readonly named: RunCloseNamed[];
  readonly doubted: Set<number>;
  readonly acts: Actionable[];
  readonly measure: (id: string) => Promise<ClaimantVerdict>;
  /** The held measure (A56) the E3 and E3s coordinator reads use. */
  readonly measureHeld: (id: string) => Promise<ClaimantVerdict>;
  /** Started runs under a claimant absent from the registry with no lifecycle history: no verdict, so listed, never closed. */
  readonly absent: LaneRun[];
}

/** E3, E3s and E5 (D-8078; spec §7, §12). A run is a candidate when the stuck verdict's own answer names its row
 *  (`RunVerdict.closeRow`) and E1 and E1r do not already fit it (o2). Each run has its own anchor (the first pass of the unbroken
 *  series, R5; E5 has none), its own clock (`closesOf`) and, armed, its own close. Any doubt is "not this pass" (R2): a coordinator
 *  that does not measure dead, or a verdict the pass has not written, gives no clock. */
async function claimantGoneRows(deps: RunCloseLaneDeps, c: GoneContext): Promise<void> {
  const { coord } = deps;
  const answers = deps.verdicts.all();
  const candidates: { run: LaneRun; row: GoneRow; since: number | null; clear: boolean }[] = [];
  const unknownIds = new Set(unknownStateRuns(c.runs).map((r) => r.id));
  for (const run of c.runs) {
    const v = answers.get(run.id);
    const row = v?.closeRow;
    if (row === undefined) {
      // A started run under a claimant absent from the registry with no lifecycle history gets no stuck verdict (the ruled
      // `unmeasured` rule), so it is never an E3 candidate: it is listed under §12.2's absent-claimant cell, never closed.
      if (v === undefined && run.claimedBy !== null && run.state !== 'planned' && !unknownIds.has(run.id) && !c.lanedRuns.has(run.id)) {
        const o = await c.measureHeld(run.claimedBy);
        if (o.state === 'dead' && o.cause === 'absent') c.absent.push(run);
      }
      continue;
    }
    if (c.lanedRuns.has(run.id) || run.claimedBy === null) continue;
    candidates.push({ run, row, since: v?.stuck?.since ?? null, clear: v?.nameReusedClear === true });
  }
  // A review sorts after its work run, so the work run's hold is known when the review is read (the ruled W2).
  candidates.sort((x, y) => (x.run.kind === 'review' ? 1 : 0) - (y.run.kind === 'review' ? 1 : 0));
  const holdOf = new Map<number, string | null>();
  const openIds = new Set(c.runs.map((r) => r.id));
  const seen: Record<GoneRow, Set<string>> = { 'claimant-gone': new Set(), 'claimant-stopped': new Set(), 'name-reused': new Set() };
  const anchors: Record<GoneRow, Map<string, { firstAt: number; lastAt: number }>> = {
    'claimant-gone': coord.runCloseAnchors('claimant-gone'), 'claimant-stopped': coord.runCloseAnchors('claimant-stopped'),
    'name-reused': coord.runCloseAnchors('name-reused'),
  };
  // The breaker (E3 and E3s only, one pool per row) counts TRANSITIONS, not states: coordinators join a burst when they were NEWLY
  // measured gone (their stored gone time, `stuck.since`, within CLAIMANT_GONE_NEW_MS) within the window of one another. The backlog
  // present when the group was armed (a durable snapshot) is exempt, and a burst once seen is held durably until its coordinators
  // stop being candidates. A backlog gone far apart, or archived together long ago, is never a burst.
  const nextAnchor = new Map<number, { firstAt: number; lastAt: number }>();
  for (const k of candidates) {
    if (k.row === 'name-reused') continue;
    nextAnchor.set(k.run.id, graceAnchorNext(anchors[k.row].get(String(k.run.id)) ?? null, c.now, false));
  }
  // A lane-wide doubt (the dead-coordinator lane's `fleetDoubt`): two or more distinct coordinators the ladder could not answer for
  // at once is tmux not answering, not coordinators going, so the group holds every candidate for this pass and acts on nothing.
  const unreadable = new Set<string>();
  for (const k of candidates) if (k.row !== 'name-reused' && (await c.measureHeld(k.run.claimedBy!)).state === 'unmeasurable') unreadable.add(k.run.claimedBy!);
  const fleetDoubt = unreadable.size >= 2;
  const burst = new Set<string>();   // `${row}\u0000${claimant}`
  for (const row of BREAKER_ROWS) {
    const held = coord.runCloseAnchors(heldStore(row));
    const backlog = coord.runCloseAnchors(backlogStore(row));
    const goneAt = new Map<string, number>();
    for (const k of candidates) if (k.row === row) { if (k.since !== null) goneAt.set(k.run.claimedBy!, k.since); else if (!goneAt.has(k.run.claimedBy!)) goneAt.set(k.run.claimedBy!, Number.NaN); }
    const present = new Set(candidates.filter((k) => k.row === row).map((k) => k.run.claimedBy!));
    if (c.armed && !backlog.has(SNAPSHOT_KEY)) {
      for (const key of [SNAPSHOT_KEY, ...present]) { const a = { firstAt: c.now, lastAt: c.now }; coord.setRunCloseAnchor(backlogStore(row), key, a); backlog.set(key, a); }
    } else if (!c.armed) {
      for (const key of backlog.keys()) coord.deleteRunCloseAnchor(backlogStore(row), key);
      backlog.clear();
    }
    const fresh = new Map<string, number>();
    for (const [cl, at] of goneAt) if (!backlog.has(cl) && Number.isFinite(at) && c.now - at <= CLAIMANT_GONE_NEW_MS) fresh.set(cl, at);
    for (const cl of claimantGoneBreaker(fresh, fleetDoubt)) if (!held.has(cl)) { const a = { firstAt: c.now, lastAt: c.now }; coord.setRunCloseAnchor(heldStore(row), cl, a); held.set(cl, a); }
    for (const cl of held.keys()) if (!present.has(cl)) coord.deleteRunCloseAnchor(heldStore(row), cl);
    for (const cl of held.keys()) if (present.has(cl)) burst.add(`${row}\u0000${cl}`);
  }

  for (const { run, row, clear } of candidates) {
    const claimant = run.claimedBy!;
    const owner = await c.measureHeld(claimant);
    // An E3 or E3s coordinator must measure dead: alive (a revival the verdict has not caught up with) or unmeasurable is doubt.
    if (owner.state === 'unmeasurable' || (row !== 'name-reused' && owner.state !== 'dead')) { c.doubted.add(run.id); continue; }
    let anchor: number | null = null;
    if (row !== 'name-reused') {
      const next = nextAnchor.get(run.id)!;
      coord.setRunCloseAnchor(row, String(run.id), next);
      seen[row].add(String(run.id));
      anchor = rowAnchor(row, { firstPassAt: next.firstAt, programmeLastActivityAt: null });
    }
    const verdict = claimantGoneVerdict({ row, anchor, armed: c.armed }, c.now);
    // A run whose session now carries ANOTHER run's marker is a reused name whichever row it fits (E3 or E3s with E5's cause): its
    // session is never touched, the marker is read before the live-session hold, and R6 reads the run's own branch (R1).
    const reused = row !== 'name-reused' && await markNamesAnotherRun(deps, run);
    let cand = row === 'name-reused' || reused ? await nameReusedCandidate(deps, run, c.now, clear) : await candidateOf(deps, run, row, c.now, c.measure);
    // A review of a work run that is refused or left open stays open with it, listed under the same reason.
    if (run.kind === 'review' && run.reviews !== null && cand.hold === null && openIds.has(run.reviews)) {
      const th = holdOf.get(run.reviews);
      if (th === undefined || th !== null) cand = { ...cand, hold: th ?? 'unmeasured' };
    }
    holdOf.set(run.id, cand.hold);
    const held = fleetDoubt || (row !== 'name-reused' && burst.has(`${row}\u0000${claimant}`));
    const word = held ? 'breaker-held' : cand.hold === 'live-session' && row !== 'name-reused' ? 'busy-worker' : cand.hold;
    const clock = closesOf(row, anchor, null, c.armed, c.now);
    if (clock !== null && word === null) c.closes.set(run.id, clock);
    if (word !== null) c.named.push({ runId: run.id, program: run.program, why: word });
    else if (clock !== null) c.would.push({ runId: run.id, program: run.program, why: GONE_WHY[row], at: clock.at });
    // The grace runs from this server's own first sight (a pause, a gap, a first pass): a doubt, not a measurement.
    if (verdict.kind === 'wait') c.doubted.add(run.id);
    record(deps, row, `${run.program}#${run.id}`, claimant, held ? { kind: 'hold', word: 'breaker-held' } : verdict, c.armed, c.now);
    c.acts.push({
      row, program: run.program, claimant, activityAt: anchor, verdict: held ? { kind: 'hold', word: 'breaker-held' } : verdict, runs: [cand],
      warning: null, detail: `expired:${row}`, claimantState: owner.state === 'alive' ? 'alive' : owner.state === 'dead' ? 'dead' : 'unmeasurable',
      claimantHeld: registryHolds(owner), anchor,
    });
  }
  for (const row of GONE_ROWS) for (const key of anchors[row].keys()) if (!seen[row].has(key)) coord.deleteRunCloseAnchor(row, key);
}

/** D-8558: does the registry still hold the claimant's session: everything but a death the reclaim ladder read as a missing row. */
const registryHolds = (v: ClaimantVerdict): boolean => !(v.state === 'dead' && v.cause === 'absent');

/** True when the run has a session whose readable `.child` marker names a different run: a later wave's, or a recycled name's. */
async function markNamesAnotherRun(deps: RunCloseLaneDeps, run: LaneRun): Promise<boolean> {
  if (run.sessionId === null) return false;
  const mark = await deps.childMark(run.sessionId);
  return mark !== null && mark.kind === 'child' && !runBelongsTo(mark, run.id);
}

/** R1 and R6 for an E5 run: its session now belongs to a later run, so the session is never touched (no live-session hold, no
 *  fleet act, no child hand-off) and the open-PR fact is read by the run's OWN branch, never `--session`. The unpushed-commits fact
 *  is clean only when the trusted journal records a reap or a purge of the session after the run's dispatch (`clear`), and is
 *  otherwise unmeasured, so the run is listed and not closed (the ruled W2). */
async function nameReusedCandidate(deps: RunCloseLaneDeps, run: LaneRun, now: number, clear: boolean): Promise<Candidate> {
  const row: RunCloseRow = 'name-reused';
  let facts = deps.memory.facts.get(run.id);
  if (facts === undefined || now - facts.readAt > BRANCH_FACT_REUSE_MS || now < facts.readAt) {
    const openPr = deps.branchOpenPr === undefined || run.project === undefined || run.branch === undefined || run.branch === null
      ? null : await deps.branchOpenPr(run.project, run.branch);
    facts = { readAt: now, openPr, unpushed: clear ? false : null };
    deps.memory.facts.set(run.id, facts);
  }
  const branch = branchFactsFor(facts, now);
  return { run, row, hold: branch.kind === 'list' ? branch.reason : null, fleetAct: 'none' };
}

/** The reason a lane hold names in §12.2's table, or null for a hold that is not a refusal the operator can act on (a live session
 *  or a doubt is transient: the run reads "Nothing closes this on its own" and no item is raised). */
const REFUSAL_OF_HOLD: Readonly<Record<string, RefusalReason>> = {
  'open-pr': 'open-pr', 'unpushed-commits': 'unpushed-commits', 'child-marker-unreadable': 'child-marker-unreadable',
};

/** Every close an armed pass refused that §12.2 routes (a due close held by R1 or R6, a warning 24 hours undelivered, a run in a state
 *  this server cannot read), then `routeRefusals` inside the coordination hold: the coordinator first, the item last. A claimant the
 *  pass could not measure is never routed (R2). A run the pass closed is not a refusal. */
async function routeClosesRefused(
  deps: RunCloseLaneDeps, runs: readonly LaneRun[], acts: readonly Actionable[], out: RunCloseOutcome, now: number,
  measure: (id: string) => Promise<ClaimantVerdict>, doubted: ReadonlySet<number>, absent: readonly LaneRun[],
): Promise<void> {
  const current: RefusedClose[] = [];
  const seen = new Set<string>();
  // Runs the pass could not measure this time: their anchors and items stay until a definite measurement (never "gone" on a doubt).
  const unmeasured = new Set<number>(doubted);
  const add = (r: RefusedClose): void => {
    const k = `${r.reason}:${r.run.id}`;
    if (seen.has(k) || out.closed.includes(r.run.id)) return;
    seen.add(k);
    current.push(r);
  };
  for (const a of acts) {
    if (a.claimantState === 'unmeasurable') { for (const c of a.runs) unmeasured.add(c.run.id); continue; }
    const lives = a.claimantState === 'alive';
    if (a.verdict.kind === 'close') {
      for (const c of a.runs) {
        // A live session under a gone coordinator is E3's busy worker: a refusal with its own item, not a doubt.
        const busy = c.hold === 'live-session' && (a.row === 'claimant-gone' || a.row === 'claimant-stopped');
        if (c.hold === 'unmeasured' || (c.hold === 'live-session' && !busy)) unmeasured.add(c.run.id);
        const reason = c.hold === null ? undefined : busy ? 'busy-worker' : REFUSAL_OF_HOLD[c.hold];
        if (reason !== undefined) add({ run: c.run, row: a.row, reason, claimant: a.claimant, lives, held: a.claimantHeld });
      }
    }
    // E1's warning, due and never delivered for 24 hours more: the coordinator was not reached, which is the reason (A58).
    if (a.row === E1 && !lives && warningUndeliveredPast(a.anchor, a.warning, now)) {
      const first = a.runs[0];
      if (first !== undefined) add({ run: first.run, row: a.row, reason: 'warning-undelivered', claimant: a.claimant, lives: false, held: a.claimantHeld });
    }
  }
  // A quiet programme nobody is on record as coordinating: the coordinator is gone by definition, so its item shows at once.
  for (const run of absent) add({ run, row: E1, reason: 'absent-claimant', claimant: null, lives: false, held: false });
  // A run in a state a newer build wrote: information whoever owns it, and a living coordinator is told.
  for (const run of unknownStateRuns(runs)) {
    const v = run.claimedBy === null ? null : await measure(run.claimedBy);
    if (v !== null && v.state === 'unmeasurable') { unmeasured.add(run.id); continue; }
    add({ run, row: null, reason: 'unknown-run', claimant: run.claimedBy, lives: v !== null && v.state === 'alive', held: v !== null && registryHolds(v) });
  }
  await deps.serial!(deps.coord, async () => {
    routeRefusals({ coord: deps.coord, abandonRefusal: deps.abandonRefusal, notifyLog: deps.notifyLog }, current, now, unmeasured);
  });
}

/** R1 and R6 for one candidate run, read BEFORE the serialiser. A run with no session has nothing to touch. */
async function candidateOf(
  deps: RunCloseLaneDeps, run: LaneRun, row: RunCloseRow, now: number, measure: (id: string) => Promise<ClaimantVerdict>,
): Promise<Candidate> {
  const sessionId = run.sessionId;
  if (sessionId === null) return { run, row, hold: null, fleetAct: 'none' };
  // A live session is never closed out from under itself; a doubt is not "gone".
  const v = await measure(sessionId);
  if (v.state === 'alive') return { run, row, hold: 'live-session', fleetAct: 'none' };
  if (v.state === 'unmeasurable') return { run, row, hold: 'unmeasured', fleetAct: 'none' };
  let facts = deps.memory.facts.get(run.id);
  if (facts === undefined || now - facts.readAt > BRANCH_FACT_REUSE_MS || now < facts.readAt) {
    facts = await deps.branchFacts(sessionId);
    deps.memory.facts.set(run.id, facts);
  }
  const branch = branchFactsFor(facts, now);
  if (branch.kind === 'list') return { run, row, hold: branch.reason, fleetAct: 'none' };
  const mark = await deps.childMark(sessionId);
  if (mark === null) return { run, row, hold: 'unmeasured', fleetAct: 'none' };
  const fleet = fleetActFor({ id: run.id, sessionId }, mark);
  if (fleet === 'list') return { run, row, hold: 'child-marker-unreadable', fleetAct: 'none' };
  return { run, row, hold: null, fleetAct: fleet === 'release' ? 'release' : 'none' };
}

/** The shadow and armed feed rows: one record-only row when a (row, programme) outcome CHANGES, never every pass. */
function record(
  deps: RunCloseLaneDeps, row: RunCloseRow, subject: string, claimant: string, verdict: RunCloseVerdict, armed: boolean, _now: number,
): void {
  const key = `${row}:${subject}`;
  const outcome = verdict.kind === 'list' || verdict.kind === 'hold' ? `${verdict.kind}:${verdict.word}` : verdict.kind;
  const shown = outcome === 'wait' || outcome === 'hold:unmeasured' ? null : outcome;
  if (deps.memory.outcomes.get(key) === outcome) return;
  deps.memory.outcomes.set(key, outcome);
  if (shown === null) return;
  const what = outcomeWords(row, subject, shown, armed);
  if (what === null) return;
  notifyEach({ coord: deps.coord, notifyLog: deps.notifyLog }, [{ kind: 'run', sessionId: claimant, runId: null, title: what.title, body: what.body }],
    'record-only', { degraded: 'run-close outcome, feed archive degraded' });
}

const GONE_WHAT: Readonly<Record<GoneRow, string>> = {
  'claimant-gone': 'the run, whose coordinator was removed,', 'claimant-stopped': 'the run, whose coordinator a person stopped,',
  'name-reused': 'the run, whose session name a later run now holds,',
};

function outcomeWords(row: RunCloseRow, subject: string, outcome: string, armed: boolean): { title: string; body: string } | null {
  if (isGoneRow(row)) {
    const gone = GONE_WHAT[row];
    switch (outcome) {
      case 'would-close': return { title: `ccrc would close ${subject}`, body: `${gone} would be closed. Nothing is closed while the group is in shadow.` };
      case 'close': return { title: `ccrc closes ${subject}`, body: `${gone} is closed${armed ? '' : ' (shadow)'}.` };
      default: return null;
    }
  }
  const what = row === E1 ? `the never-started waves of ${subject}` : `the review run ${subject}`;
  switch (outcome) {
    case 'would-warn': return { title: `ccrc would warn the coordinator of ${subject}`, body: `${what} have been quiet for 48 hours. Nothing is sent while the group is in shadow.` };
    case 'would-close': return { title: `ccrc would close ${subject}`, body: `${what} would be closed. Nothing is closed while the group is in shadow.` };
    case 'warn': return { title: `ccrc warns the coordinator of ${subject}`, body: `${what} have been quiet for 48 hours; the coordinator is told, and they close in 24 hours unless something moves.` };
    case 'close': return { title: `ccrc closes ${subject}`, body: `${what} are closed${armed ? '' : ' (shadow)'}.` };
    case 'list:coordinator-not-reached': return { title: `ccrc could not reach the coordinator of ${subject}`, body: `${what} have been quiet, but the coordinator reads gone, so no warning was sent and nothing is closed.` };
    default: return null;
  }
}

// ── the armed act ────────────────────────────────────────────────────────────────────────────────────────────

async function act(deps: RunCloseLaneDeps, acts: readonly Actionable[], now: number): Promise<RunCloseOutcome> {
  const { coord } = deps;
  const warned: string[] = [];
  const closed: number[] = [];
  const refused: { runId: number; why: string }[] = [];

  // THE WARNING: at most one a pass, lane-wide, the quietest programme first. It is queued with the row that records it, in one
  // transaction; the mail sweep delivers it (a hibernated coordinator wakes only through its hibernated gate's budget).
  const due = acts.filter((a) => a.row === E1 && a.verdict.kind === 'warn');
  for (const a of runCloseBudget(due).act.slice(0, RUN_CLOSE_WARNINGS_PER_PASS)) {
    try {
      coord.queueRunCloseWarning(a.program, a.claimant, now, () => insertSystemMailTx(coord, { program: a.program }, {
        fromId: 'operator', toId: a.claimant, runId: null, kind: 'status',
        subject: `${RUN_CLOSE_WARNING_PREFIX} ${a.program}`,
        body: [`The planned waves of ${a.program} have been quiet for 48 hours, and nothing has started.`,
          'ccrc will close them in 24 hours unless something moves: a mail about a run, a dispatch, or a new wave.',
          'This is a notice. It asks nothing of you.'].join('\n'),
      }).deliveryId);
      warned.push(a.program);
      notifyEach({ coord, notifyLog: deps.notifyLog }, [{ kind: 'run', sessionId: a.claimant, runId: null, ...(outcomeWords(E1, a.program, 'warn', true) ?? { title: '', body: '' }) }],
        'record-only', { degraded: 'run-close warning, feed archive degraded' });
    } catch (err) {
      console.warn(`ccrc-server: runClose: the warning for ${a.program} could not be queued (${err instanceof Error ? err.message : String(err)}) — asked again next pass`);
    }
  }

  // A run a close is due for that R1, R6 or a live session holds is LISTED, never closed: it reads "Nothing closes this on its own".
  for (const a of acts) {
    if (a.verdict.kind !== 'close') continue;
    for (const c of a.runs) if (c.hold !== null) refused.push({ runId: c.run.id, why: c.hold });
  }
  // THE CLOSES: at most three programmes a pass (R7), each run through the abandon arm with this file's re-measure as its guard.
  const closable = acts.filter((a) => a.verdict.kind === 'close' && a.runs.some((c) => c.hold === null));
  const picked = runCloseBudget(closable.map((a) => ({ ...a, activityAt: a.activityAt }))).act;
  if (picked.length === 0 || deps.serial === null) return { held: null, warned, closed, refused };
  await deps.serial(coord, async (abandon) => {
    for (const a of picked) {
      for (const c of a.runs) {
        if (c.hold !== null) continue;
        const guard = (): Promise<DeadCoordinatorStop | null> => stillStuck(deps, a, c);
        const out = await abandon(c.run.id, a.claimant, guard, { fleetAct: c.fleetAct, detail: a.detail });
        if (out.ok) { closed.push(c.run.id); continue; }
        refused.push({ runId: c.run.id, why: out.kind === 'sweep-stopped' ? out.stop.why : out.kind });
        if (out.kind === 'sweep-stopped' || out.kind === 'claimant-changed') break;
      }
      if (a.runs.some((c) => closed.includes(c.run.id))) {
        notifyEach({ coord, notifyLog: deps.notifyLog }, [{ kind: 'run', sessionId: a.claimant, runId: null, ...(outcomeWords(a.row, a.program, 'close', true) ?? { title: '', body: '' }) }],
          'record-only', { degraded: 'run-close act, feed archive degraded' });
      }
    }
  });
  return { held: null, warned, closed, refused };
}

/** The guard, asked INSIDE the serialiser immediately before the fleet act and again before the commit (the departure
 *  `the-sweep-re-measures-inside-the-arm`): the switches from a fresh listing, then the store facts that made the run a
 *  candidate. Any change stops the act; nothing here waits on `gh` or `ccd`. */
async function stillStuck(deps: RunCloseLaneDeps, a: Actionable, c: Candidate): Promise<DeadCoordinatorStop | null> {
  const names = await (deps.freshRegistryNames ?? deps.registryNames)();
  if (names === null) return { kind: 'switch', why: 'the registry did not list, so a raised pause cannot be ruled out' };
  const sw = readSwitches(names);
  if (sw[RECLAIM_PAUSE_MARKER] === 'set') return { kind: 'switch', why: `${RECLAIM_PAUSE_MARKER} was raised during the act` };
  if (sw[COORDINATOR_PAUSE_MARKER] === 'set') return { kind: 'switch', why: `${COORDINATOR_PAUSE_MARKER} was raised during the act` };
  const choice = deps.coord.runCloseChoice(RUN_CLOSE_ROW_GROUP[a.row]);
  if (!runCloseRowArmed(a.row, names, choice)) return { kind: 'switch', why: 'the group was returned to shadow or turned off during the act' };
  const fresh = deps.coord.run(c.run.id);
  if (!fresh.ok || fresh.run === null) return { kind: 'remeasured', why: 'the run could not be read again' };
  const r = fresh.run;
  if (isGoneRow(a.row) ? r.state !== c.run.state : r.state !== 'planned') return { kind: 'remeasured', why: `the run is ${r.state} now` };
  if (r.claimedBy !== a.claimant) return { kind: 'successor', why: 'the run has another coordinator now' };
  if (isGoneRow(a.row)) {
    // E3, E3s and E5 re-read the stuck verdict's own answer: the coordinator back, a person's stop undone, or the session name
    // handed back all end the row, and the verdict is what said the row fit.
    if (deps.verdicts.of(c.run.id)?.closeRow !== a.row) return { kind: 'remeasured', why: 'the run no longer fits its row' };
    if (c.run.kind === 'review' && c.run.reviews !== null) {
      const target = deps.coord.run(c.run.reviews);
      if (!target.ok) return { kind: 'remeasured', why: 'the review\'s target could not be read again' };
      if (target.run !== null && target.run.closedAt === null) return { kind: 'remeasured', why: 'the review\'s target is still open' };
    }
    if (a.row !== 'name-reused') {
      const v = await (deps.measureHeld ?? deps.measure)(a.claimant);
      if (v.state !== 'dead') return { kind: 'remeasured', why: 'the coordinator does not read gone now' };
    } else if (c.run.sessionId !== null) {
      const mark = await deps.childMark(c.run.sessionId);
      if (mark === null || mark.kind !== 'child' || runBelongsTo(mark, c.run.id) || mark.runId < c.run.id) {
        return { kind: 'remeasured', why: 'the session name no longer belongs to a later run' };
      }
    }
  }
  if (r.dispatchStartedAt !== c.run.dispatchStartedAt || r.sessionId !== c.run.sessionId) {
    return { kind: 'remeasured', why: 'a dispatch began since the pass' };
  }
  if (a.row === E1) {
    const open = deps.coord.runCloseRuns().filter((x) => x.program === a.program);
    if (!open.every((x) => x.state === 'planned')) return { kind: 'remeasured', why: 'a wave of the programme has started' };
    const warning = deps.coord.runCloseWarning(a.program);
    if (warning === null || warning.deliveredAt === null) return { kind: 'remeasured', why: 'the warning is not delivered' };
    if (warning.claimant !== a.claimant) return { kind: 'remeasured', why: 'the warning went to another coordinator' };
    const act = programmeLastActivity({
      ...deps.coord.programmeActivity(a.program), claimantBusyAt: deps.claimantBusyAt(a.claimant), warningDeliveredAt: warning.deliveredAt,
    });
    if (act === 'unread') return { kind: 'remeasured', why: 'the coordinator\'s turns are unread' };
    if (act !== null && act > warning.warnedAt) return { kind: 'remeasured', why: 'the programme moved since the warning' };
  }
  return null;
}
