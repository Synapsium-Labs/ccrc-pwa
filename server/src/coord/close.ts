import path from 'node:path';
import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { RunCcd } from './ports.js';
import {
  abandonMove, decideClose, type CloseHalt, type CloseStop, type FleetAct, type RequestPlan,
} from './closeDecide.js';
import { CCD_ARGV, ccdCan, sweepDec, type CcdArgv } from '../ccdargv.js';
import { readPrHistory } from './prhistory.js';
import { verifyDone, verifyReviewDone } from './fingerprint.js';
import {
  type AdvanceResult, type CoordStore, type OpenSiblingsResult, type RunRow,
} from './store.js';
import {
  HANDOFF_SHA,
  holdReasonVerdict,
  releaseIsSafe,
  survivorOf,
  type HoldReasonVerdict,
} from './rundefs.js';
import { queueSystemMail } from './rundefsTx.js';
import { readSessionRecord } from '../registry.js';
import { childBirthOf, childSpent, childSpentLive, childSpentLiveFrom } from './childSpent.js';
import type { CcdPrLine } from '../prstate.js';
import type { DeadCoordinatorStop, SweepFleetAct } from '../deadCoordinator.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_LICENCE_NONE, childReclaimDecision, childReclaimHasCoordinated, childReclaimRowListing,
  childReclaimRowUuid,
  type ChildReclaimDecision, type ChildReclaimMinting, type ChildReclaimNotWhy, type ChildReclaimRequest,
  type ChildReclaimReviewed,
} from './childReclaim.js';
import {
  transitionsFor, type ChildMark, type DoneRejectCode, type RunRefuseCode, type RunState,
} from '../../../shared/api.js';

/**
 * `closeRun`'s executor (architecture doc increment 4; ARCH-35, GitHub #556). Same model as `dispatch.ts`'s
 * `dispatchRun`: narrowed deps, no `reply`, a typed result union out, and the precondition -> irreversible fleet act ->
 * commit ORDER owned in one place. Every precondition is DATA in `closeDecide.ts` (L1, pure): `decideClose` answers
 * what each read means, this file reads, acts and writes. "L1" never meant "pure" for the executor: every side effect
 * here is reached through a declared port, so a close is nameable, testable and callable without a Fastify instance.
 */
export interface CloseRunDeps {
  coord: CoordStore;
  io: FleetIO; cfg: CcrcConfig; runCcd: RunCcd; fleetState?: FleetState;
  /** Child reclamation (spec 2026-09-22 §5.7): hand a reclaim to THE ONE
   *  executor. Called only AFTER the close's transaction has committed — a
   *  reclaim that fails can never un-close a run — and NEVER awaited: the
   *  coordinator's API client gives up after a flat 30 s, `ws-reclaim`'s remote
   *  budget is 240 s, and a close the caller saw time out but the server
   *  committed is worse than one that answered `queued`. OPTIONAL: absent, an
   *  eligible child is answered `not-queued` with no reason, and wave 4's sweep
   *  reaches it. `coord/routes.ts` wires it to the session's own queue. */
  childReclaim?: (req: ChildReclaimRequest) => void;
}

export type CloseOutcome =
  | { ok: true; id: number; state: 'done' | 'failed';
      /** Is the workspace's claim GONE as a result of this close? `true` only
       *  after a `ws-release` that actually succeeded.
       *
       *  `false` IS NOT ONE FACT — it is the negation of one, and a reader
       *  that renders a single sentence from it alone will be wrong. All five
       *  ways to get it, so nobody has to rediscover them (review finding,
       *  W2b):
       *    1. a SIBLING open run still names this session, so the claim was
       *       HANDED OVER — re-held with the survivor's own reason. This is
       *       the case the field was added for, and the only one worth a
       *       sentence about another run;
       *    2. an ordinary NON-FINAL close: it never asks for a release at
       *       all, it re-holds for wave N+1. Ordinary, not news;
       *    3. `state:'failed' && archive` with no sibling: the workspace was
       *       ARCHIVED, and `cmd_ws_archive` does no `rm` of the registry, so
       *       the hold outlives it — literally not released, nothing like (1);
       *    4. an ABANDON of a `planned` run with `sessionId === null`: NO
       *       fleet act at all, and no workspace to claim. Nothing happened.
       *    5. an ABANDON of a run whose stored `sessionId` is not a registry
       *       id: NO fleet act, the same as (4), but the run HAD a session id
       *       (spec §2.3). One `fleet-act-omitted:bad-session` run event
       *       records it.
       *  A client that wants a sentence must branch on `state`/`archive` and
       *  on whether the run had a session — `pwa/src/fleet/AbandonSheet.tsx`
       *  does exactly that, and only speaks for case (1). It cannot yet tell
       *  (5) from (1), and would read (5) as a hand-over. */
      released: boolean;
      /** Child reclamation (spec 2026-09-22 §5.7), ADDITIVE. `queued`: the
       *  workspace is a child this close found FINISHED — released, never
       *  re-held — and its reclaim was handed to the executor, which runs
       *  AFTER this answer; its outcome is a feed row, never this response.
       *  `not-queued` otherwise. */
      childReclaim: 'queued' | 'not-queued';
      /** Why not, whenever the answer was a DECISION (`childReclaimDecision`).
       *  ABSENT on `not-queued` means the child WAS eligible and nothing took
       *  the hand-off — no executor wired, or wiring it threw. Both have one
       *  remedy, the sweep, so they are one shape; neither is ever spelled as
       *  a reason the decision did not give. */
      childReclaimWhy?: ChildReclaimNotWhy }
  | { ok: false; kind: 'unknown-run' }
  /** Spec §2.3: the run's STORED `sessionId` is not a registry id. Every close but the abandon refuses it, review
   *  closes included, before any read or argv names it. The abandon arm closes such a run `failed` with no fleet act
   *  instead (`released`, case 5). */
  | { ok: false; kind: 'bad-session' }
  | { ok: false; kind: 'bad-transition'; from: RunState; to: RunState }
  | { ok: false; kind: 'bad-request' }
  | { ok: false; kind: 'refused'; code: Extract<RunRefuseCode, 'not-dispatched' | 'prhistory-unreadable'> }
  | { ok: false; kind: 'doneVerdict'; code: DoneRejectCode; detail: string }
  | Extract<HoldReasonVerdict, { ok: false }>
  | { ok: false; kind: 'unsupported' }
  | { ok: false; kind: 'fleetFailed'; stderr: string }
  | { ok: false; kind: 'advanceFailed'; adv: Extract<AdvanceResult, { ok: false }> }
  /** The sweep's compare-and-set refused (workspace lifecycle spec 2026-09-24 §5.4, "No successor"): the run's
   *  claimant is no longer the crashed id the dead-coordinator lane named. `claimedBy` is who holds it now. */
  | { ok: false; kind: 'claimant-changed'; claimedBy: string | null }
  /** The sweep's in-arm re-measure stopped it (workspace lifecycle spec 2026-09-24 §5.4, "No successor"): the claimant
   *  is no longer crashed, or that cannot be told, or the operator raised `reclaim-paused` or disarmed the lane.
   *  `fleetAct`: WHICH fleet act ran before the stop — `released` (nothing else claimed the workspace: it is unheld
   *  until its coordinator re-holds it) or `re-held` (a surviving run's reason now holds it: it stays claimed) — and
   *  `null` when the stop came before any fleet act. Two acts, two words: a boolean folded them (review 339, F3). */
  | { ok: false; kind: 'sweep-stopped'; stop: DeadCoordinatorStop; fleetAct: SweepFleetAct | null };

/** What the dead-coordinator lane hands `closeRun` with its word (`'sweep'`): the crashed id the compare-and-set
 *  checks, and its re-measure, which the abandon arm runs IMMEDIATELY BEFORE the fleet act and again AFTER it, before
 *  the commit (the departure `the-sweep-re-measures-inside-the-arm`). A `claimedBy` compare-and-set cannot see a
 *  revive of the SAME id (`ccd ensure` takes no mutex and rewrites nothing in `coord.db`); only a re-measure can. */
export interface SweepCloseGuard {
  readonly claimedBy: string;
  readonly stillCrashed: () => Promise<DeadCoordinatorStop | null>;
}

/**
 * WHO closed a run, as `run_events.causedBy` records it. THREE words, each with its own door: the coordinator's own
 * close (`POST /api/runs/:id/close`), the operator's abandon (`POST /api/runs/:id/abandon` and the archive door's
 * `{programme:'end'}`), and the dead-coordinator lane's — `'sweep'` (workspace lifecycle spec 2026-09-24 §5.4), a third
 * word so the run event, the feed row and the audit never read as the operator's act. ADDITIVE on the wire, with no
 * `FLEET_PROTO` bump: the column is free text, and every reader (`runEvents`, `RoutingEvent.causedBy`, the stall
 * watch's notices, the landing lane) takes it as a string or ignores it.
 */
export type CloseCause = 'coordinator' | 'operator' | 'sweep';

/** The untrusted wire shape `POST /api/runs/:id/close` accepts — validated
 *  inside `closeRun` itself, in the SAME order the route used to (after the
 *  two precondition checks, D-48's own ordering fix), never trusted off a
 *  TypeScript annotation the JSON parse cannot enforce. */
export interface CloseRunBody {
  /** `'abandon'` | absent (D-274 (was D-B4-1)). The operator variant, validated as its OWN
   *  shape below — an abandon that also carries close fields is refused rather
   *  than half-honoured. */
  intent?: unknown;
  /** The work claim's four fields and the review claim's two, in ONE optional
   *  bag: which pair is required is decided by the run's KIND, in `closeRun`
   *  and `closeReviewRun` respectively, never by this type. Declared here so
   *  the accepted wire shape is readable without reading both validators
   *  (Task 7 review m8). */
  fingerprint?: { branchTip?: unknown; prNumber?: unknown; prPhase?: unknown; handoffCommit?: unknown;
                  reviewedTip?: unknown; report?: unknown };
  final?: unknown; state?: unknown; archive?: unknown;
}

/** The operator abandon's one move (D-2807) lives in `closeDecide.ts` with the rest of the close's decisions; this
 *  re-export keeps its readers (`abandonRefusal` below, the archive door) where they were. */
export { abandonMove };

/**
 * What `closeRun`'s abandon arm would refuse for this run from the ROW ALONE — its read, then `abandonMove` — asked
 * without acting. `null`: the arm can move it. The archive door reads it for every run inside the same `coordMutex`
 * hold that then runs the abandons (`CoordRoutesHandle.withAbandon`), so nothing moves between this read and the act.
 * What only the act measures — the sibling read, a hand-over hold, the verb, ccd's own answer — can still refuse after
 * an earlier run was ended, and the door says which runs it ended (`programme-partly-ended`).
 * A run whose stored `sessionId` is not a registry id is not refused here, and the arm does not refuse it either: the
 * arm closes it `failed` with no fleet act (spec §2.3), so the door ends such a programme whole.
 */
export function abandonRefusal(coord: CoordStore, id: number): Extract<CloseOutcome, { ok: false }> | null {
  const read = coord.run(id);
  // `closeRun`'s own two answers for a row it cannot use (D-2545; an absent run).
  if (!read.ok) return { ok: false, kind: 'hold-invalid', detail: read.detail };
  if (read.run === null) return { ok: false, kind: 'unknown-run' };
  const move = abandonMove(read.run);
  return move.ok ? null : move;
}

/**
 * Close a run: re-measure the done claim (never believe it) — UNLESS the
 * operator is explicitly ABANDONING the run (`state:'failed'`, deviation
 * D-49): that is not a done-claim at all, so there is nothing to re-measure.
 * Then fold `.prhistory` (refusing to close on an unreadable ledger), then
 * the FLEET ACT, then — only once it has actually succeeded — the
 * transition (deviation D-48: the fleet act runs AHEAD of the transition
 * commit, so a failed `ws-release` leaves the run exactly where it was,
 * never wedged terminal). The fleet act is a RELEASE (deviation D-5), never
 * an autonomous archive.
 *
 * `causedBy` is a PARAMETER with no default (D-276 (was D-B4-3) and D-279 (was D-B4-6)): the coordinator's own
 * close records `'coordinator'` and the operator's abandon records
 * `'operator'`, and a default is exactly how the second would silently record
 * the first. Both call sites pass it explicitly.
 *
 * THE THIRD WORD, `'sweep'` (workspace lifecycle spec 2026-09-24 §5.4), has a signature of its own: it comes WITH its
 * guard (`SweepCloseGuard`: the crashed claimant's id and its re-measure), so the dead-coordinator lane cannot reach
 * this arm without its compare-and-set and its re-measure, and it only ever abandons.
 */
export function closeRun(
  deps: CloseRunDeps, id: number, body: unknown, causedBy: 'coordinator' | 'operator',
): Promise<CloseOutcome>;
export function closeRun(
  deps: CloseRunDeps, id: number, body: unknown, causedBy: 'sweep', sweep: SweepCloseGuard,
): Promise<CloseOutcome>;
export async function closeRun(
  deps: CloseRunDeps, id: number, body: unknown,
  causedBy: CloseCause, sweep?: SweepCloseGuard,
): Promise<CloseOutcome> {
  // Everything the request says, ahead of any fleet act: `decideClose` names the arm and refuses what that arm cannot
  // take. The three arms are separate executors by construction (D-290): what an arm skips is ABSENT from it, not
  // skipped by a flag threaded through a shared path.
  const req = decideClose({ step: 'request', read: deps.coord.run(id), body, causedBy });
  if (req.kind !== 'go') return stopped(deps, req);
  const plan = req.plan;
  switch (plan.arm) {
    case 'abandon': return abandonRun(deps, id, plan, causedBy, sweep);
    case 'review': return closeReviewRun(deps, plan.run, plan.body, causedBy);
    case 'work': return closeWorkRun(deps, id, plan, causedBy);
    default: return plan satisfies never;
  }
}

/** The one place a decider's non-`go` answer becomes a `CloseOutcome`. The `switch` is exhaustive: a fourth arm in
 *  `closeDecide.ts` is a compile error here until it is answered. A refused done-claim is recorded against the run
 *  and mailed back to its worker first, as the inline code did; the run state is unchanged. */
function stopped(deps: CloseRunDeps, d: CloseStop, run?: RunRow): CloseHalt {
  switch (d.kind) {
    case 'refused':
      if (d.rejection !== undefined && run !== undefined && run.sessionId !== null) {
        deps.coord.recordRejection({ ...d.rejection, runId: run.id, toId: run.sessionId });
        queueSystemMail(deps.coord, run, { fromId: 'coordinator', toId: run.sessionId, runId: run.id,
          kind: 'status', subject: 'wave-done-rejected', body: `${d.rejection.code}: ${d.rejection.detail}` });
      }
      return d.outcome;
    case 'stale':
      return d.outcome;
    default:
      return d satisfies never;
  }
}

/** The fleet verb a decision composed, as the argv ccd takes: every close names its actor by the run, `close`. */
function fleetArgv(deps: CloseRunDeps, id: number, sessionId: string, act: FleetAct): CcdArgv {
  const dec = sweepDec(deps.fleetState, `run:${id} close`);
  switch (act.verb) {
    case 'wsArchive': return CCD_ARGV.wsArchive(sessionId, dec);
    case 'wsRelease': return CCD_ARGV.wsRelease(sessionId, dec);
    case 'wsHold': return CCD_ARGV.wsHold(sessionId, act.reason, dec);
    default: return act satisfies never;
  }
}

/** The check, (the caller's last look,) the act and ccd's answer for one composed fleet verb, in that order. */
async function actOnFleet(
  deps: CloseRunDeps, id: number, sessionId: string, act: FleetAct,
  /** Run between the check and the act: the sweep's gate, which must read the world right before ccd is asked. */
  before: () => Promise<CloseHalt | null> = async () => null,
): Promise<CloseHalt | null> {
  const can = decideClose({ step: 'verb', verb: act.verb, can: ccdCan(deps.fleetState, act.verb) });
  if (can.kind !== 'go') return stopped(deps, can);
  const held = await before();
  if (held !== null) return held;
  const done = decideClose({ step: 'fleet', res: await deps.runCcd(fleetArgv(deps, id, sessionId, act)) });
  return done.kind === 'go' ? null : stopped(deps, done);
}

/** The sweep's gate (`decideClose`'s `sweep` step), or nothing for a door that has no guard. */
async function sweepGateOf(
  deps: CloseRunDeps, id: number, sweep: SweepCloseGuard | undefined,
): Promise<CloseHalt | null> {
  if (sweep === undefined) return null;
  const d = decideClose({ step: 'sweep', stop: await sweep.stillCrashed(), fresh: () => deps.coord.run(id), claimedBy: sweep.claimedBy });
  return d.kind === 'go' ? null : stopped(deps, d);
}

/** The abandon's commit: the store's close of the run `failed`, and what its answer means (`commit` step). */
function commitAbandon(
  deps: CloseRunDeps, id: number, plan: Extract<RequestPlan, { arm: 'abandon' }>,
  causedBy: CloseCause, sweep: SweepCloseGuard | undefined, acted: boolean,
): CloseHalt | null {
  const closed = deps.coord.closeRun({
    runId: id, finalState: 'failed', causedBy, handoffCommit: null,
    program: plan.run.program, viaClosing: plan.target === 'closing',
    ...(sweep === undefined ? {} : { expectClaimedBy: sweep.claimedBy }),
  });
  const d = decideClose({ step: 'commit', closed, acted });
  return d.kind === 'go' ? null : stopped(deps, d);
}

/**
 * THE OPERATOR ABANDON, as ONE contiguous arm (D-290 (was D-B4-17)). It returns; it never falls through into the
 * ordinary close. No `not-dispatched` refusal (a `planned` run with no session is the `ambiguous-dispatch` wedge this
 * route exists for), no fingerprint, no `verifyDone` (D-49: there is no done-claim to re-measure), no `.prhistory` fold
 * (D-275: an unreadable ledger must not disable the control that exists for a broken box) and no `wsArchive` (D-280).
 * Each is pinned by a negative test in `coord-abandon.test.ts`, and each is true because the call is ABSENT.
 *
 * THE SWEEP'S GATE runs IMMEDIATELY BEFORE the fleet act and the claimant is re-measured once more AFTER it
 * (workspace lifecycle spec §5.4): a revive of the SAME id is the race a compare-and-set cannot see.
 *
 * A STORED ID NO VERB MAY NAME (spec §2.3): the run is still CLOSED, with no sibling read, child gate, hold or release,
 * and one `fleet-act-omitted:bad-session` run event, so the trail tells this close from an ordinary `failed`.
 */
async function abandonRun(
  deps: CloseRunDeps, id: number, plan: Extract<RequestPlan, { arm: 'abandon' }>,
  causedBy: CloseCause, sweep: SweepCloseGuard | undefined,
): Promise<CloseOutcome> {
  const { run } = plan;
  if (plan.unnamed) {
    const halt = await sweepGateOf(deps, id, sweep) ?? commitAbandon(deps, id, plan, causedBy, sweep, false);
    if (halt !== null) return halt;
    deps.coord.recordRunEvent(id, causedBy, 'fleet-act-omitted:bad-session');
    return { ok: true, id, state: 'failed', released: false, childReclaim: 'not-queued', childReclaimWhy: 'marker-unreadable' };
  }
  // The fleet act, AHEAD of the commit (D-48), and only when there is something to act on: a `planned` run that never
  // dispatched holds no workspace, and a run with no session names no child.
  const sessionId = run.sessionId;
  if (sessionId === null) {
    const halt = await sweepGateOf(deps, id, sweep) ?? commitAbandon(deps, id, plan, causedBy, sweep, false);
    return halt ?? { ok: true, id, state: 'failed', released: false, ...handOffChildReclaim(deps, NO_CHILD_GATE) };
  }
  const sibRead = deps.coord.openRunsForSession(sessionId, id);
  // An abandon never runs `verifyDone`, so there is no measured line to reuse: `null` is what "it did not run" IS.
  const act = await decideClose({ step: 'abandon', run, siblings: sibRead,
    gate: () => childGateAtClose(deps, run, sessionId, sibRead, false, 'failed', null) });
  if (act.kind !== 'go') return stopped(deps, act);
  const halt = await actOnFleet(deps, id, sessionId, act.plan.fleet, () => sweepGateOf(deps, id, sweep));
  if (halt !== null) return halt;
  if (sweep !== undefined) {
    const after = decideClose({ step: 'recheck', stop: await sweep.stillCrashed(), release: act.plan.released });
    if (after.kind !== 'go') return stopped(deps, after);
  }
  const late = commitAbandon(deps, id, plan, causedBy, sweep, true);
  return late ?? { ok: true, id, state: 'failed', released: act.plan.released, ...handOffChildReclaim(deps, act.plan.gate) };
}

/**
 * The ordinary close of a work run: re-measure the done claim (never believe it) — unless the close is an explicit
 * ABANDON of the claim (`state: 'failed'`, D-49) — then fold `.prhistory` (refusing to close on an unreadable ledger),
 * then the FLEET ACT, then, only once it has succeeded, the transition (D-48: a failed `ws-release` leaves the run
 * exactly where it was, never wedged terminal). The act is a RELEASE (D-5), never an autonomous archive, with ONE
 * explicit `wsArchive` in the whole coordination lane, gated on the same sibling check as the release. Which verb, and
 * why, is `decideClose`'s `close` step; this function reads, acts and writes.
 */
async function closeWorkRun(
  deps: CloseRunDeps, id: number, plan: Extract<RequestPlan, { arm: 'work' }>, causedBy: CloseCause,
): Promise<CloseOutcome> {
  const { coord } = deps;
  const { run, sessionId, final, state } = plan;
  // Spec §5.7: `verifyDone`'s own measured `pr-state` row is carried past this block so the child-spent redate reuses
  // it instead of asking a second time inside the same mutex section.
  let line: CcdPrLine | null = null;
  if (plan.verify) {
    const measured = await verifyDone(
      { io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState },
      { sessionId, project: run.project, branch: run.branch ?? '' }, plan.claim);
    const verdict = decideClose({ step: 'verified', verdict: measured });
    if (verdict.kind !== 'go') return stopped(deps, verdict, run);
    line = verdict.plan.line;
  }
  // Decide and validate the hold before any close-path write: `foldPrLineage` persists measured history.
  const sibRead = coord.openRunsForSession(sessionId, id);
  const act = await decideClose({ step: 'close', run, siblings: sibRead, final, state, archive: plan.archive,
    gate: () => childGateAtClose(deps, run, sessionId, sibRead, final, state, line) });
  if (act.kind !== 'go') return stopped(deps, act);
  const ledger = decideClose({ step: 'ledger', history: await readPrHistory(deps.io, deps.cfg.registryDir, sessionId) });
  if (ledger.kind !== 'go') return stopped(deps, ledger);
  coord.foldPrLineage(id, ledger.plan.entries);
  const halt = await actOnFleet(deps, id, sessionId, act.plan.fleet);
  if (halt !== null) return halt;
  // The transition, the handoff commit, the delivery cancellation and the program-retirement check, as ONE
  // transaction (review finding 25). The ordinary close always takes the `closing` hop (D-281).
  const closed = coord.closeRun({ runId: id, finalState: state, causedBy, handoffCommit: plan.handoffCommit,
    program: run.program, viaClosing: true });
  const committed = decideClose({ step: 'commit', closed, acted: true });
  if (committed.kind !== 'go') return stopped(deps, committed);
  return { ok: true, id, state, released: act.plan.released, ...handOffChildReclaim(deps, act.plan.gate) };
}

/** The review-kind close (design 2026-09-14 §5.3–5.4, D-2796). Body:
 *  `{ fingerprint: { reviewedTip, report }, state?: 'done'|'failed' }`. `final`
 *  and `archive` are REFUSED: a review run is always final (its workspace is its
 *  own and is released here), and archive stays a human act. `state:'failed'`
 *  is the coordinator's "the reviewer died" — nothing is re-measured, exactly
 *  as the work path's abandon arm (D-49). On `state:'failed'` the fingerprint
 *  is optional — a dead reviewer has none, and an abandon asserts no claim
 *  (D-2812); a fingerprint that IS present on a `failed` close is still
 *  shape-checked — malformed is refused, never silently ignored. */
async function closeReviewRun(
  deps: CloseRunDeps, run: RunRow, b: CloseRunBody, causedBy: CloseCause,
): Promise<CloseOutcome> {
  const coord = deps.coord;
  /** The OTHER open runs on this workspace, read fresh at the decision point and never cached; the closing run
   *  excludes itself. Returns the RESULT, not the list (D-2545): "unreadable" must never arrive as `[]`. */
  const siblingsOf = (sessionId: string): OpenSiblingsResult => coord.openRunsForSession(sessionId, run.id);
  if (b.final !== undefined || b.archive !== undefined ||
      (b.state !== undefined && b.state !== 'done' && b.state !== 'failed')) {
    return { ok: false, kind: 'bad-request' };
  }
  const state: 'done' | 'failed' = b.state === 'failed' ? 'failed' : 'done';
  // `state:'done'` (the default) always requires the fingerprint, shape-checked
  // exactly as before D-2812. `state:'failed'` makes it OPTIONAL: an absent one
  // (the reviewer never wrote one) skips the shape check entirely; a
  // fingerprint PRESENT on a `failed` close is still shape-checked — malformed
  // is refused, never silently ignored. `validFp` is computed ONCE, here,
  // rather than re-derived at its one read site below (D-2812) — the
  // non-null assertion there is justified by `fpRequired`'s own condition
  // repeating `state !== 'failed'`, never by trusting the wire shape twice.
  const fp = b.fingerprint;
  const fpRequired = state === 'done' || fp !== undefined;
  const validFp: { reviewedTip: string; report: string } | null = fpRequired
    ? (typeof fp === 'object' && fp !== null &&
       typeof fp.reviewedTip === 'string' && HANDOFF_SHA.test(fp.reviewedTip) &&
       typeof fp.report === 'string' && path.isAbsolute(fp.report))
      ? { reviewedTip: fp.reviewedTip, report: fp.report }
      : null
    : null;
  if (fpRequired && validFp === null) {
    return { ok: false, kind: 'bad-request' };
  }
  if (!transitionsFor(run.kind)[run.state].includes(state)) {
    return { ok: false, kind: 'bad-transition', from: run.state, to: state };
  }
  // `run.sessionId` is non-null here: `closeRun`'s own `not-dispatched` check
  // runs before this arm is entered. The type still says `string | null`, so
  // narrow it once for the reads below rather than re-check a fact already decided.
  const sessionId = run.sessionId as string;

  if (state !== 'failed') {
    if (run.reviews === null) {
      return { ok: false, kind: 'doneVerdict', code: 'tip-unmeasurable', detail: 'this review run names no reviewed run' };
    }
    const workRead = coord.run(run.reviews);
    if (!workRead.ok) return { ok: false, kind: 'hold-invalid', detail: workRead.detail };
    if (workRead.run === null) {
      return { ok: false, kind: 'doneVerdict', code: 'tip-unmeasurable', detail: `reviewed run ${run.reviews} no longer exists` };
    }
    const work = workRead.run;
    if (work.sessionId === null) {
      return { ok: false, kind: 'doneVerdict', code: 'tip-unmeasurable', detail: `reviewed run ${work.id} has no session to measure` };
    }
    const verdict = await verifyReviewDone(
      { io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState },
      { sessionId: work.sessionId, project: work.project, branch: work.branch ?? '' },
      // Non-null: `state !== 'failed'` here means `state === 'done'`, and
      // `fpRequired` above was true in exactly that case — the guard already
      // refused a null `validFp` on that path.
      validFp!,
    );
    if (!verdict.ok) {
      coord.recordRejection({ code: verdict.code, runId: run.id, toId: sessionId, detail: verdict.detail });
      queueSystemMail(coord, run, { fromId: 'coordinator', toId: sessionId, runId: run.id,
        kind: 'status', subject: 'review-done-rejected', body: `${verdict.code}: ${verdict.detail}` });
      return { ok: false, kind: 'doneVerdict', code: verdict.code, detail: verdict.detail };
    }
  }

  // The fleet act, AHEAD of the commit (D-48). A review workspace hosts one
  // run, so the ordinary answer is a release; the sibling check is kept
  // because it is a re-measurement, not an assumption.
  const sibRead = siblingsOf(sessionId);
  if (!sibRead.ok) return { ok: false, kind: 'hold-invalid', detail: sibRead.detail };
  // A review run is always final (§5.3) and the release below is already the
  // act — but its reviewer child is NOT finished while the run it reviews is
  // open (spec §5.7): the decision answers `review-report-live`, and
  // the sweep reclaims the reviewer once the reviewed run is terminal.
  // `null`: this arm re-measures through `verifyReviewDone`, never `verifyDone`
  // (design 2026-09-14 §5.3-5.4 — a review run has no PR-bearing done-claim to
  // reuse a `pr-state` line from), so there is nothing to hand in — the fast
  // path, when reached, fetches `pr-state` itself exactly as `childGateAtClose`
  // already does whenever no line is given.
  const childGate = await childGateAtClose(deps, run, sessionId, sibRead, true, state, null);
  const survivor = survivorOf(sibRead.siblings);
  const release = releaseIsSafe(sibRead.siblings) || survivor === null;
  // Spelled hand-over-first so the compiler narrows `survivor` on the arm that
  // reads it, and so `argv` is a `const` carrying the `CcdArgv` brand rather
  // than an evolving `let` (the abandon arm's own shape — Task 7 review m7).
  let handoff: HoldReasonVerdict | null = null;
  if (!release && survivor !== null) {
    handoff = holdReasonVerdict(survivor.program, survivor.wave, survivor.waveOf, survivor.id);
    if (!handoff.ok) return handoff;
  }
  const argv = handoff !== null && handoff.ok
    ? CCD_ARGV.wsHold(sessionId, handoff.reason, sweepDec(deps.fleetState, `run:${run.id} close`))
    : CCD_ARGV.wsRelease(sessionId, sweepDec(deps.fleetState, `run:${run.id} close`));
  // D-5866: the row the argv above was built from — the hold when a survivor takes the claim, else the release.
  if (!ccdCan(deps.fleetState, handoff !== null && handoff.ok ? 'wsHold' : 'wsRelease')) {
    return { ok: false, kind: 'unsupported' };
  }
  const res = await deps.runCcd(argv);
  if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };

  const closed = coord.closeRun({
    runId: run.id, finalState: state, causedBy, handoffCommit: null, program: run.program,
    viaClosing: false,   // REVIEW_RUN_TRANSITIONS has no `closing` (§5.2)
  });
  if (!closed.ok) return { ok: false, kind: 'advanceFailed', adv: closed };
  return { ok: true, id: run.id, state, released: release, ...handOffChildReclaim(deps, childGate) };
}

// ── child reclamation: close decides, it does not wait (spec 2026-09-22 §5.7) ──

/** What a close decided about the child, and the request it would hand off. */
export interface ChildGate { readonly decision: ChildReclaimDecision; readonly request: ChildReclaimRequest | null }

const NO_CHILD_GATE: ChildGate = { decision: { reclaim: false, why: 'not-a-child' }, request: null };

/**
 * Read both authorities and ask `childReclaimDecision`, inside the mutex and
 * before the fleet act. The box's: the registry's `ChildMark`, re-read now
 * (`readSessionRecord`). An `absent` read is not folded straight to `none`
 * (amendment A6, controller ruling P5): `readSessionRecord`'s `absent` covers
 * two populations — no `.uuid` in a listing that succeeded, and a row
 * `buildRecord` DROPPED though the workspace is still live and marked — and a
 * live marked child answered `not-a-child` would hand it a remedy it is not
 * entitled to. So an `absent` read is re-listed once through the executor's
 * own `childReclaimRowListing`: `none` iff that second listing SUCCEEDS and
 * `.child` is NOT listed, `unreadable` when `.child` IS listed (a row that
 * exists and could not be built) or the second listing itself fails. Close is
 * the SECOND caller of that export — the first is the executor's own
 * gone-check, which folds `.uuid`-OR-`.child` for its own different question.
 * An `unlistable` read (the registry directory itself could not be listed) is
 * `unreadable` directly, with no second listing to take.
 *
 * The server's authority: the MINTING run's row, by the id the marker names —
 * which is not this run whenever the child handed over across waves — and,
 * when that row is a review run's, the row of the run it reviews (spec
 * §5.7), read here beside the caller's sibling read, in the same mutex
 * section. The spent verdict is asked LAST and only when it is the one
 * conjunct left: its live half is a gh round trip, and every other answer is
 * already final without it.
 *
 * A2/P6: the fast path (`childSpent`'s registry `.prnumber`/`.prhistory`
 * rungs) answers `spent` with `incarnation:'unplaced'` — it carries no date,
 * and a child's branch name is a recycled slug (spec §5.5), so unplaced
 * evidence may belong to an earlier workspace. The close never reclaims on
 * that alone: it re-dates the same PR through the live rung and decides on
 * the LIVE answer ONLY — `spent`/`this` finishes the child, anything else
 * (unspent, unmeasured, or still `unplaced`) holds it.
 *
 * COST (spec §5.7 — measured, not the ~50 s an earlier wave accepted by
 * design): `verifiedLine` is `verifyDone`'s own measured `pr-state` row for
 * this SAME session, taken moments earlier inside this same mutex section
 * (`state !== 'failed'` is exactly when `verifyDone` ran at all). When its
 * `.id` names `sessionId`, every live rung below — the initial `childSpent`
 * call and, when the fast path answers spent, the redate — runs the PURE
 * `childSpentLiveFrom` over that one line instead of asking `pr-state` again,
 * so a non-final `done` close makes AT MOST ONE `pr-state` call in total
 * (`verifyDone`'s own), never two. A line that names a different session, or
 * no line at all (the abandon and review-close arms, which never run
 * `verifyDone`), falls back to fetching fresh, exactly as before this task —
 * the fetch is still a live read taken inside this same mutex section, so a
 * PR opened in the gap can only HOLD the child, never make one vanish.
 *
 * A NON-REGISTRY ID (path identity, spec §2.3) reads `unreadable`, never
 * `none`. `readSessionRecord` answers `bad-id` before any listing. The
 * `absent` arm's re-listing would find nothing for an id nothing lists, and
 * would answer `not-a-child`, a verdict nobody measured. No second listing is
 * taken, and the coordination fence gets a `null` uuid. `closeRun` checks the
 * stored id on every arm before it gets here, so no close reaches this arm
 * today.
 *
 * EXPORTED FOR ITS PIN, and for nothing else: no file outside `close.ts`
 * calls it. Spec §2.3 asks for a pin at each absence-acting caller, and with
 * the arm masked no flow can reach it, so the pin calls this function directly
 * (`single-read-bad-id.test.ts`).
 */
export async function childGateAtClose(
  deps: CloseRunDeps, run: RunRow, sessionId: string, siblings: OpenSiblingsResult,
  final: boolean, state: 'done' | 'failed', verifiedLine: CcdPrLine | null,
): Promise<ChildGate> {
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  let mark: ChildMark;
  switch (read.kind) {
    case 'found':
      mark = read.record.child;
      break;
    case 'unlistable':
      mark = { kind: 'unreadable' };
      break;
    case 'absent': {
      // A6/P5: `absent` is re-listed once, folding ONLY `.child` (never
      // `.uuid`) — the close's own question, distinct from the executor's.
      const listing = await childReclaimRowListing(deps, sessionId);
      mark = listing.kind === 'unlistable' || listing.child ? { kind: 'unreadable' } : { kind: 'none' };
      break;
    }
    // Masked by `closeRun`'s stored-id checks; see the docstring.
    case 'bad-id':
      mark = { kind: 'unreadable' };
      break;
    default: {
      const _x: never = read;
      return _x;
    }
  }
  const minting: ChildReclaimMinting = mark.kind === 'child' ? mintingRowOf(deps.coord, mark.runId) : { kind: 'absent' };
  const reviewed = reviewedRowOf(deps.coord, minting);
  // Whether this session has coordinated in its own generation
  // (`childReclaimHasCoordinated`; spec §1 rule 4, spec §5.6: slugs recycle):
  // read beside the sibling list, through the same fence the executor reads
  // for the same question (`childReclaim.ts`'s own step 2a). `Date.now()` is
  // the generation pick's clock: `CloseRunDeps` carries none, and `closeRun`
  // stamps `closedAt` from it too. An unreadable read is
  // not "never coordinated" — but it is also NOT folded into
  // `siblings-unreadable` HERE: doing so ahead of calling the decision would
  // outrank `not-a-child` and `marker-unreadable` for every close, coordinated
  // or not, whenever one bad `run_events` row makes the read throw. It is
  // carried into the pure decision as a THIRD value instead
  // (`hasCoordinated: 'unreadable'`), which `childReclaimDecision` folds into
  // `siblings-unreadable` at the exact place the sibling check itself ranks —
  // after the mark/minting checks, never ahead of them.
  let hasCoordinated: boolean | 'unreadable';
  try {
    // The birth is told the row that this close read (spec §5.7): its own unfinished purge never unplaces it.
    // An unplaced birth with an earlier claim declines `has-coordinated` here. That is fail-safe: the sweep
    // judges the child again on its next pass.
    hasCoordinated = childReclaimHasCoordinated(deps.coord, sessionId, Date.now(), read.kind === 'found' ? childReclaimRowUuid(read.record) : null);
  } catch (err) {
    console.warn(`ccrc-server: the coordination fence (childReclaimHasCoordinated) failed at close `
      + `(${err instanceof Error ? err.message : String(err)}) — ${sessionId}'s coordination history unreadable`);
    hasCoordinated = 'unreadable';
  }
  const input = {
    mark, minting, sessionId, siblings, reviewed, final, state, spent: { kind: 'unasked' } as const,
    spentFastPath: false, hasCoordinated,
    // D-51's predicate with THIS run set aside — the retirement check
    // `CoordStore.closeRun` runs after the commit, asked before it.
    retiresProgram: deps.coord.programOpenRunCount(run.program, run.id) === 0,
  };
  let decision = childReclaimDecision(input);
  if (!decision.reclaim && decision.why === 'not-finished' && read.kind === 'found' && minting.kind === 'row') {
    // The minting row is guaranteed present here — `childReclaimDecision`
    // only answers `not-finished` past its own `minting.kind==='row'` check —
    // so `minting.sessionBornAt`/`minting.sessionBornFor`/
    // `minting.dispatchStartedAt` are this child's birth, read once, never a
    // second `coord.run` query.
    const birth = childBirthOf(
      { ok: true, run: { sessionId: minting.sessionId, sessionBornAt: minting.sessionBornAt,
                          sessionBornFor: minting.sessionBornFor,
                          dispatchStartedAt: minting.dispatchStartedAt } },
      sessionId);
    // Spec §5.7: reuse `verifyDone`'s own measured line for THIS session —
    // the same argv, the same parser — rather than fetch a second time.
    // `undefined` (never fetched, and `childSpent`/the redate below fetch
    // fresh) whenever `verifyDone` did not run or answered for a different
    // session — `verifyDone`'s own `.find(isFullLine)` is NOT filtered by
    // session id the way `childSpentLive`'s fetch is (`fingerprint.ts`), so
    // this check is the fail-closed guard: a line proven to belong to
    // ANOTHER session must never be trusted for this one's spent verdict.
    const line = verifiedLine !== null && verifiedLine.id === sessionId ? verifiedLine : undefined;
    let spent = await childSpent(deps, read.record, birth, line);
    // A2/P6: a fast-path spent (registry `.prnumber` or `.prhistory`, always
    // `incarnation:'unplaced'`) is never trusted alone — it is re-dated
    // through the live rung, and the close decides on THAT answer only. A
    // `spent`/`'live'` verdict already IS that live answer (childSpent's own
    // rung 3), so it is not asked twice. `spentFastPath` carries WHICH case
    // this was (spec §5.3), so a re-dated `unspent` answer can still say why
    // it is not finished (`not-finished-merge-commit`) rather than the
    // ordinary unspent hand-over.
    const spentFastPath = spent.kind === 'spent' && spent.source !== 'live';
    if (spentFastPath) {
      spent = line !== undefined ? childSpentLiveFrom(line, read.record, birth) : await childSpentLive(deps, read.record, birth);
    }
    decision = childReclaimDecision({ ...input, spent, spentFastPath });
  }
  return {
    decision,
    // `deferredSinceMs: null`: close is always a first attempt (spec §5.7), and
    // so the feed says nothing about it yet (`feedQuiet`, spec §5.9).
    // `mark.runId` is the MINTING run — never `run.id`, the run being closed,
    // which differ exactly when the child handed over across waves or was
    // minted by a review run this close is not.
    request: decision.reclaim && mark.kind === 'child'
      ? { sessionId, runId: mark.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
          feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: CHILD_RECLAIM_LICENCE_NONE } : null,
  };
}

function mintingRowOf(coord: CoordStore, runId: number): ChildReclaimMinting {
  const r = coord.run(runId);
  if (!r.ok) return { kind: 'unreadable' };
  return r.run === null ? { kind: 'absent' }
    : { kind: 'row', sessionId: r.run.sessionId, reviews: r.run.reviews,
        sessionBornAt: r.run.sessionBornAt, sessionBornFor: r.run.sessionBornFor,
        dispatchStartedAt: r.run.dispatchStartedAt };
}

/** The run a REVIEW child's minting run reviews (spec §5.7) — `none` when the
 *  minting row is a work run's (or is no row at all: the decision has already
 *  answered on the minting read). Four answers, never folded; the row carries
 *  its STATE, and the pure decision alone asks whether it is terminal. */
function reviewedRowOf(coord: CoordStore, minting: ChildReclaimMinting): ChildReclaimReviewed {
  if (minting.kind !== 'row' || minting.reviews === null) return { kind: 'none' };
  const r = coord.run(minting.reviews);
  if (!r.ok) return { kind: 'unreadable' };
  return r.run === null ? { kind: 'absent' } : { kind: 'row', state: r.run.state };
}

/** AFTER the commit, and never awaited. A port that throws is logged and
 *  answered `not-queued` with no reason — the close has committed, and a
 *  throw out of here would reach `CoordMutex.run`'s `finally` as a bare 500
 *  about a close that happened. */
function handOffChildReclaim(
  deps: CloseRunDeps, gate: ChildGate,
): { childReclaim: 'queued' | 'not-queued'; childReclaimWhy?: ChildReclaimNotWhy } {
  if (!gate.decision.reclaim) return { childReclaim: 'not-queued', childReclaimWhy: gate.decision.why };
  if (deps.childReclaim === undefined || gate.request === null) return { childReclaim: 'not-queued' };
  try {
    deps.childReclaim(gate.request);
  } catch (err) {
    console.warn(`ccrc-server: handing the reclaim of ${gate.request.sessionId} off threw `
      + `(${err instanceof Error ? err.message : String(err)}) — the close committed; the sweep reaches it`);
    return { childReclaim: 'not-queued' };
  }
  return { childReclaim: 'queued' };
}
