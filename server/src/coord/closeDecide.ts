import { isRegistryId, transitionsFor, type DoneRejectCode, type RunState } from '../../../shared/api.js';
import type { DeadCoordinatorStop } from '../deadCoordinator.js';
import type { CcdPrLine } from '../prstate.js';
import type { CloseCause, CloseOutcome, CloseRunBody, ChildGate } from './close.js';
import type { DoneClaim, DoneVerdict } from './fingerprint.js';
import type { PrHistoryRead } from './prhistory.js';
import { HANDOFF_SHA, holdReasonVerdict, releaseIsSafe, survivorOf } from './rundefs.js';
import type { AdvanceResult, OpenSiblingsResult, RunReadResult, RunRow } from './store.js';

/**
 * `closeRun`'s decisions, as data (ARCH-35, GitHub #556; architecture doc increment 4, the other half, after
 * `dispatchDecide.ts`). L1: no `fs`, no fastify, no tmux, no clock, and no act. The executor (`close.ts`) reads the
 * world, asks `decideClose` what it means, and ACTS on the answer; it decides nothing itself. Whether a precondition
 * refuses, which fleet verb a close composes, whether the box can take it and what a failed act or commit means are
 * all answers of this file.
 *
 * ONE FUNCTION, ONE STEP AT A TIME. A close is not one decision: it reads, acts, reads again and decides again, and
 * every fleet act in the middle changes what the next read means. So the facts arrive in the order the executor can
 * have them, and the first refusal wins:
 *
 *   request   the stored row and the body: unreadable or unknown row, the mixed abandon shape, the sweep word, the
 *             abandon move, not-dispatched, the stored session, the transition, the claim's shape. Names the ARM.
 *   sweep     (abandon, sweep word) the claimant re-measured, then the compare-and-set's first half.
 *   verified  (work close) `verifyDone`'s verdict: a failed claim is refused, with the rejection to record.
 *   close     (work close) the sibling list, the child gate, the hold: which fleet verb, and with what reason.
 *   abandon   (abandon arm) the same question for the abandon: release, or hand the claim to the survivor.
 *   ledger    (work close) the `.prhistory` read.
 *   verb      whether the box lists the fleet verb about to be sent.
 *   fleet     ccd's answer to the act.
 *   recheck   (abandon, sweep word) the claimant re-measured AFTER the act.
 *   commit    the store's answer to the transition: a refusal before any act is `refused`, after one `stale`.
 *
 * THE ORDER IS THE CONTRACT, inside each step and between them. `close-gate-order.test.ts` (through `closeRun`) and
 * `close-decide.test.ts` (through this function) pin it with a row per adjacent pair of gates one input can trip
 * together, each with a recorded reorder mutant.
 *
 * THE DECISION IS ONE OF THREE KINDS. `go` carries the step's plan. `refused` carries the exact `CloseOutcome` the
 * wire answers (and, for a failed done-claim, the rejection the executor records and mails). `stale` is the honest
 * third arm for a close the world outgrew AFTER a fleet act: the claimant re-measured alive, or the commit refused.
 * It answers the same wire words a refusal would, but it is NAMED, and the executor's `switch` over the arms is
 * exhaustive (`satisfies never`), so a fourth arm cannot be added unanswered.
 *
 * LAZY READS. The sibling-dependent steps take the child gate and the sweep's fresh read as thunks and call them only
 * when the gate before has not refused, so a refusal still costs exactly the reads ahead of it.
 */
export type CloseHalt = Extract<CloseOutcome, { ok: false }>;

export type CloseDecision<P> =
  | { kind: 'go'; plan: P }
  | { kind: 'refused'; outcome: CloseHalt; rejection?: { code: DoneRejectCode; detail: string } }
  | { kind: 'stale'; outcome: CloseHalt };

/** The decision that ends the close: everything but `go`. */
export type CloseStop = Exclude<CloseDecision<never>, { kind: 'go' }>;

const go = <P>(plan: P): CloseDecision<P> => ({ kind: 'go', plan });
const refused = (outcome: CloseHalt): CloseDecision<never> => ({ kind: 'refused', outcome });

/**
 * The operator abandon's one move (D-2807): a `planned` run, or any review run (its machine has no `closing`), fails
 * directly; every other run moves to `closing` — unless its own machine has no such edge (a run already `closing`, or
 * in `unknown`), which is the arm's `bad-transition`. ONE spelling, two readers: the request step below, and
 * `abandonRefusal`, which the archive door asks of every run a programme holds BEFORE it ends the first (workspace
 * lifecycle §5.2: every check that can refuse runs before any act that cannot be undone).
 */
export function abandonMove(run: Pick<RunRow, 'state' | 'kind'>):
  | { readonly ok: true; readonly to: RunState }
  | { readonly ok: false; readonly kind: 'bad-transition'; readonly from: RunState; readonly to: RunState } {
  const to: RunState = run.state === 'planned' || run.kind === 'review' ? 'failed' : 'closing';
  return transitionsFor(run.kind)[run.state].includes(to)
    ? { ok: true, to } : { ok: false, kind: 'bad-transition', from: run.state, to };
}

// -- step: request -----------------------------------------------------------------------------------------------

export interface RequestFacts {
  step: 'request';
  read: RunReadResult;
  /** UNKNOWN off the wire: the route's JSON parse gives it no shape. */
  body: unknown;
  causedBy: CloseCause;
}

/** Which of the three closes this request is, with what it carries. */
export type RequestPlan =
  | {
    arm: 'abandon'; run: RunRow;
    /** The abandon's one move (`abandonMove`): `closing` is the hop through it, `failed` the direct one. */
    target: RunState;
    /** Spec §2.3: the stored `sessionId` is not a registry id, so the arm takes no fleet act for it. */
    unnamed: boolean;
  }
  | { arm: 'review'; run: RunRow; body: CloseRunBody }
  | {
    arm: 'work'; run: RunRow; sessionId: string; claim: DoneClaim;
    final: boolean; state: 'done' | 'failed'; archive: boolean;
    /** `verifyDone` re-measures a DONE claim; `state: 'failed'` is an abandon of the claim, with nothing to measure. */
    verify: boolean;
    /** Only a shape-valid handoff commit is ever written (review findings 6/18). */
    handoffCommit: string | null;
  };

function decideRequest(f: RequestFacts): CloseDecision<RequestPlan> {
  const { read, causedBy } = f;
  // D-2545: the row exists and its integers are unrepresentable: refused in words, ahead of any fleet act.
  if (!read.ok) return refused({ ok: false, kind: 'hold-invalid', detail: read.detail });
  const run = read.run;
  if (!run) return refused({ ok: false, kind: 'unknown-run' });
  const b = (f.body ?? {}) as CloseRunBody;
  const abandon = b.intent === 'abandon';
  // A mixed shape is not a shape: an abandon asserts nothing about a branch, a PR or a wave boundary.
  if (abandon && (b.fingerprint !== undefined || b.final !== undefined || b.state !== undefined || b.archive !== undefined)) {
    return refused({ ok: false, kind: 'bad-request' });
  }
  // The sweep only ever ABANDONS (workspace lifecycle spec §5.4): a close body under its word confuses two acts.
  if (causedBy === 'sweep' && !abandon) return refused({ ok: false, kind: 'bad-request' });
  if (abandon) {
    const move = abandonMove(run);
    if (!move.ok) return refused(move);
    return go({ arm: 'abandon', run, target: move.to, unnamed: run.sessionId !== null && !isRegistryId(run.sessionId) });
  }
  // Never dispatched: no worker session for `verifyDone` to re-measure against and none to mail a rejection to.
  if (run.sessionId === null) return refused({ ok: false, kind: 'refused', code: 'not-dispatched' });
  // Spec §2.3: a stored id no verb may name refuses every close but the abandon, review closes included.
  if (!isRegistryId(run.sessionId)) return refused({ ok: false, kind: 'bad-session' });
  if (run.kind === 'review') return go({ arm: 'review', run, body: b });
  // D-48: a run that cannot legally reach `closing` from its CURRENT state must never reach the fleet act.
  if (!transitionsFor(run.kind)[run.state].includes('closing')) {
    return refused({ ok: false, kind: 'bad-transition', from: run.state, to: 'closing' });
  }
  const fp = b.fingerprint;
  if (typeof fp !== 'object' || fp === null ||
      typeof fp.branchTip !== 'string' || typeof fp.handoffCommit !== 'string' ||
      typeof fp.prPhase !== 'string' || !(fp.prNumber === null || typeof fp.prNumber === 'number') ||
      typeof b.final !== 'boolean' ||
      (b.state !== undefined && b.state !== 'done' && b.state !== 'failed') ||
      (b.archive !== undefined && typeof b.archive !== 'boolean')) {
    return refused({ ok: false, kind: 'bad-request' });
  }
  // The claim is UNTRUSTED off the wire: `verifyDone` re-validates every field itself, when it runs at all.
  const claim: DoneClaim = { branchTip: fp.branchTip, prNumber: fp.prNumber as number | null,
    prPhase: fp.prPhase as DoneClaim['prPhase'], handoffCommit: fp.handoffCommit };
  const state: 'done' | 'failed' = b.state === 'failed' ? 'failed' : 'done';
  return go({ arm: 'work', run, sessionId: run.sessionId, claim, final: b.final, state, archive: b.archive === true,
    verify: state !== 'failed', handoffCommit: HANDOFF_SHA.test(claim.handoffCommit) ? claim.handoffCommit : null });
}

// -- step: sweep -------------------------------------------------------------------------------------------------

/** The sweep's gate, run IMMEDIATELY BEFORE the fleet act (workspace lifecycle spec §5.4, "No successor"). */
export interface SweepFacts {
  step: 'sweep';
  /** The claimant re-measured: a revive of the same id is the race a compare-and-set on `claimedBy` cannot see. */
  stop: DeadCoordinatorStop | null;
  /** A FRESH read of the run, taken only when the re-measure has not stopped it. */
  fresh: () => RunReadResult;
  claimedBy: string;
}

function decideSweep(f: SweepFacts): CloseDecision<null> {
  if (f.stop !== null) return refused({ ok: false, kind: 'sweep-stopped', stop: f.stop, fleetAct: null });
  const fresh = f.fresh();
  if (!fresh.ok) return refused({ ok: false, kind: 'hold-invalid', detail: fresh.detail });
  if (fresh.run === null) return refused({ ok: false, kind: 'unknown-run' });
  return fresh.run.claimedBy === f.claimedBy ? go(null)
    : refused({ ok: false, kind: 'claimant-changed', claimedBy: fresh.run.claimedBy });
}

// -- step: verified ----------------------------------------------------------------------------------------------

export interface VerifiedFacts { step: 'verified'; verdict: DoneVerdict }

function decideVerified(f: VerifiedFacts): CloseDecision<{ line: CcdPrLine | null }> {
  const v = f.verdict;
  // The run state is UNCHANGED. The executor records the rejection and mails it back to the worker.
  if (!v.ok) {
    return { kind: 'refused', outcome: { ok: false, kind: 'doneVerdict', code: v.code, detail: v.detail },
      rejection: { code: v.code, detail: v.detail } };
  }
  return go({ line: v.line });
}

// -- steps: close and abandon (which fleet verb) -----------------------------------------------------------------

/** The fleet verb a close composes, and the reason a hold carries. */
export type FleetAct = { verb: 'wsArchive' } | { verb: 'wsRelease' } | { verb: 'wsHold'; reason: string };

export interface ActPlan {
  /** The child gate the close read, carried to the hand-off after the commit. */
  gate: ChildGate;
  fleet: FleetAct;
  /** Is the workspace's claim GONE as a result: `true` only after a `ws-release`. */
  released: boolean;
}

export interface CloseActFacts {
  step: 'close';
  run: RunRow;
  siblings: OpenSiblingsResult;
  final: boolean; state: 'done' | 'failed'; archive: boolean;
  /** Read only once the sibling list is known to be readable. */
  gate: () => Promise<ChildGate>;
}

async function decideCloseAct(f: CloseActFacts): Promise<CloseDecision<ActPlan>> {
  // Fail-shut ahead of the child gate and the fleet act alike: "the sibling rows could not be read" must never
  // arrive at an irreversible act spelled `[]` (D-2545).
  if (!f.siblings.ok) return refused({ ok: false, kind: 'hold-invalid', detail: f.siblings.detail });
  const siblings = f.siblings.siblings;
  const survivor = survivorOf(siblings);
  const safe = releaseIsSafe(siblings);
  // Child reclamation (spec §5.7): a child the coordinator has FINISHED with is RELEASED, never re-held or archived.
  const gate = await f.gate();
  const reclaim = gate.decision.reclaim;
  // `ws-archive` has no hold rung in ccd, so it is gated on the same sibling check as the release (Wave 2).
  if (f.state === 'failed' && f.archive && safe && !reclaim) return go({ gate, fleet: { verb: 'wsArchive' }, released: false });
  if ((f.final && safe) || reclaim) return go({ gate, fleet: { verb: 'wsRelease' }, released: true });
  // The ordinary non-final close claims the workspace for wave N+1 (whose run does not exist yet); with a sibling
  // still open, the surviving run's own reason wins.
  const next = survivor === null
    ? holdReasonVerdict(f.run.program, f.run.wave + 1, f.run.waveOf, null)
    : holdReasonVerdict(survivor.program, survivor.wave, survivor.waveOf, survivor.id);
  if (!next.ok) return refused(next);
  return go({ gate, fleet: { verb: 'wsHold', reason: next.reason }, released: false });
}

export interface AbandonFacts {
  step: 'abandon';
  run: RunRow;
  siblings: OpenSiblingsResult;
  gate: () => Promise<ChildGate>;
}

async function decideAbandon(f: AbandonFacts): Promise<CloseDecision<ActPlan>> {
  if (!f.siblings.ok) return refused({ ok: false, kind: 'hold-invalid', detail: f.siblings.detail });
  const siblings = f.siblings.siblings;
  // An abandon is FINISHED (spec §5.7), so an eligible child is exactly the no-survivor case: already released.
  const gate = await f.gate();
  const survivor = survivorOf(siblings);
  // DECIDED ONCE, USED TWICE: the verb and the reported `released` come from this one expression.
  const release = releaseIsSafe(siblings) || survivor === null;
  if (survivor === null || release) return go({ gate, fleet: { verb: 'wsRelease' }, released: release });
  const handoff = holdReasonVerdict(survivor.program, survivor.wave, survivor.waveOf, survivor.id);
  if (!handoff.ok) return refused(handoff);
  return go({ gate, fleet: { verb: 'wsHold', reason: handoff.reason }, released: false });
}

// -- steps: ledger, verb, fleet, recheck, commit -----------------------------------------------------------------

export interface LedgerFacts { step: 'ledger'; history: PrHistoryRead }

function decideLedger(f: LedgerFacts): CloseDecision<{ entries: Extract<PrHistoryRead, { ok: true }>['entries'] }> {
  // Refuse to close on an unreadable ledger; nothing closes.
  return f.history.ok ? go({ entries: f.history.entries })
    : refused({ ok: false, kind: 'refused', code: 'prhistory-unreadable' });
}

export interface VerbFacts { step: 'verb'; verb: FleetAct['verb']; can: boolean }

function decideVerb(f: VerbFacts): CloseDecision<null> {
  // D-5866: the row the argv was built from.
  return f.can ? go(null) : refused({ ok: false, kind: 'unsupported' });
}

export interface FleetFacts { step: 'fleet'; res: { ok: true } | { ok: false; stderr: string } }

function decideFleet(f: FleetFacts): CloseDecision<null> {
  return f.res.ok ? go(null) : refused({ ok: false, kind: 'fleetFailed', stderr: f.res.stderr });
}

export interface RecheckFacts {
  step: 'recheck';
  /** The claimant re-measured AFTER the fleet act, before the commit. */
  stop: DeadCoordinatorStop | null;
  /** Which act ran: a release (nothing else claimed the workspace) or a re-hold under the surviving run. */
  release: boolean;
}

function decideRecheck(f: RecheckFacts): CloseDecision<null> {
  // A revive that landed during the release keeps its run open: the stale arm names which act already ran.
  return f.stop === null ? go(null)
    : { kind: 'stale', outcome: { ok: false, kind: 'sweep-stopped', stop: f.stop, fleetAct: f.release ? 'released' : 're-held' } };
}

export interface CommitFacts {
  step: 'commit';
  closed: AdvanceResult;
  /** Did a fleet act already run? A refusal after one is STALE: the world moved while the act was in flight. */
  acted: boolean;
}

function decideCommit(f: CommitFacts): CloseDecision<null> {
  if (f.closed.ok) return go(null);
  // A successor that took the programme DURING the fleet act is refused here, and the run stays open under it.
  const outcome: CloseHalt = f.closed.error === 'claimant-changed'
    ? { ok: false, kind: 'claimant-changed', claimedBy: f.closed.claimedBy }
    : { ok: false, kind: 'advanceFailed', adv: f.closed };
  return f.acted ? { kind: 'stale', outcome } : refused(outcome);
}

// -- the one door ------------------------------------------------------------------------------------------------

export type CloseFacts =
  | RequestFacts | SweepFacts | VerifiedFacts | CloseActFacts | AbandonFacts
  | LedgerFacts | VerbFacts | FleetFacts | RecheckFacts | CommitFacts;

export function decideClose(f: RequestFacts): CloseDecision<RequestPlan>;
export function decideClose(f: SweepFacts | VerbFacts | FleetFacts | RecheckFacts | CommitFacts): CloseDecision<null>;
export function decideClose(f: VerifiedFacts): CloseDecision<{ line: CcdPrLine | null }>;
export function decideClose(f: LedgerFacts): CloseDecision<{ entries: Extract<PrHistoryRead, { ok: true }>['entries'] }>;
export function decideClose(f: CloseActFacts | AbandonFacts): Promise<CloseDecision<ActPlan>>;
export function decideClose(f: CloseFacts): unknown {
  switch (f.step) {
    case 'request': return decideRequest(f);
    case 'sweep': return decideSweep(f);
    case 'verified': return decideVerified(f);
    case 'close': return decideCloseAct(f);
    case 'abandon': return decideAbandon(f);
    case 'ledger': return decideLedger(f);
    case 'verb': return decideVerb(f);
    case 'fleet': return decideFleet(f);
    case 'recheck': return decideRecheck(f);
    case 'commit': return decideCommit(f);
    default: return f satisfies never;
  }
}

