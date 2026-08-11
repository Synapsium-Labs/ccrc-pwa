import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import { CCD_ARGV, verbSupported } from '../ccdargv.js';
import { readPrHistory } from './prhistory.js';
import { verifyDone, type DoneClaim } from './fingerprint.js';
import { type AdvanceResult, type CoordStore } from './store.js';
import { HANDOFF_SHA, holdReason, queueSystemMail } from './rundefs.js';
import { RUN_TRANSITIONS, type MailRejectCode, type RunRefuseCode, type RunState } from '../../../shared/api.js';

/**
 * L1 decision function (architecture doc increment 4). Same model as
 * `dispatch.ts`'s `dispatchRun`: narrowed deps, no `reply`, a typed result
 * union out, and the precondition -> irreversible fleet act -> commit ORDER
 * owned in one place rather than split across a Fastify closure. See that
 * file's own docstring for why "L1" here does not mean "pure" — it means
 * every side effect is reached through a declared port and the decision is
 * nameable, testable and callable without a running Fastify instance.
 */
export interface CloseRunDeps {
  coord: CoordStore;
  io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState;
}

export type CloseOutcome =
  | { ok: true; id: number; state: 'done' | 'failed' }
  | { ok: false; kind: 'unknown-run' }
  | { ok: false; kind: 'bad-transition'; from: RunState; to: RunState }
  | { ok: false; kind: 'bad-request' }
  | { ok: false; kind: 'refused'; code: Extract<RunRefuseCode, 'not-dispatched' | 'prhistory-unreadable'> }
  | { ok: false; kind: 'doneVerdict';
      code: Extract<MailRejectCode, 'stale-tip' | 'tip-unmeasurable' | 'pr-regressed' | 'pr-unmeasurable' |
        'no-handoff-commit'>;
      detail: string }
  | { ok: false; kind: 'unsupported' }
  | { ok: false; kind: 'fleetFailed'; stderr: string }
  | { ok: false; kind: 'advanceFailed'; adv: Extract<AdvanceResult, { ok: false }> };

/** The untrusted wire shape `POST /api/runs/:id/close` accepts — validated
 *  inside `closeRun` itself, in the SAME order the route used to (after the
 *  two precondition checks, D-48's own ordering fix), never trusted off a
 *  TypeScript annotation the JSON parse cannot enforce. */
export interface CloseRunBody {
  fingerprint?: { branchTip?: unknown; prNumber?: unknown; prPhase?: unknown; handoffCommit?: unknown };
  final?: unknown; state?: unknown; archive?: unknown;
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
 */
export async function closeRun(deps: CloseRunDeps, id: number, body: unknown): Promise<CloseOutcome> {
  const coord = deps.coord;
  const run = coord.run(id);
  if (!run) return { ok: false, kind: 'unknown-run' };
  if (run.sessionId === null) {
    // Never dispatched: there is no worker session for `verifyDone` to
    // re-measure against and no worker to mail a rejection back to.
    return { ok: false, kind: 'refused', code: 'not-dispatched' };
  }
  // A second precondition, read-only, checked BEFORE the fleet act (D-48,
  // the close-route half of D-46's same ordering fix for dispatch): a run
  // that cannot legally reach `closing` from its CURRENT state must never
  // reach the fleet act at all.
  if (!RUN_TRANSITIONS[run.state].includes('closing')) {
    return { ok: false, kind: 'bad-transition', from: run.state, to: 'closing' };
  }

  const b = (body ?? {}) as CloseRunBody;
  const fp = b.fingerprint;
  if (typeof fp !== 'object' || fp === null ||
      typeof fp.branchTip !== 'string' || typeof fp.handoffCommit !== 'string' ||
      typeof fp.prPhase !== 'string' || !(fp.prNumber === null || typeof fp.prNumber === 'number') ||
      typeof b.final !== 'boolean' ||
      (b.state !== undefined && b.state !== 'done' && b.state !== 'failed') ||
      (b.archive !== undefined && typeof b.archive !== 'boolean')) {
    return { ok: false, kind: 'bad-request' };
  }
  // The claim is UNTRUSTED off the wire: `verifyDone` re-validates
  // `branchTip`/`handoffCommit`/`prPhase`/`prNumber` itself, when it runs at
  // all (see D-49, step 1 below).
  const claim: DoneClaim = { branchTip: fp.branchTip, prNumber: fp.prNumber as number | null,
    prPhase: fp.prPhase as DoneClaim['prPhase'], handoffCommit: fp.handoffCommit };
  const final = b.final;
  const state: 'done' | 'failed' = b.state === 'failed' ? 'failed' : 'done';
  const archive = b.archive === true;

  // 1: verifyDone re-measures a DONE CLAIM. `state:'failed'` is an explicit
  // operator ABANDON, not a claim of doneness (deviation D-49) — it skips
  // this step entirely.
  if (state !== 'failed') {
    const verdict = await verifyDone(
      { io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState },
      { sessionId: run.sessionId, project: run.project, branch: run.branch ?? '' },
      claim,
    );
    if (!verdict.ok) {
      // The run state is UNCHANGED. The rejection is recorded, and a
      // `status` mail carrying the code and detail is mailed back to the
      // worker.
      coord.recordRejection({ code: verdict.code, runId: id, toId: run.sessionId, detail: verdict.detail });
      queueSystemMail(coord, run, { toId: run.sessionId, runId: id,
        kind: 'status', subject: 'wave-done-rejected', body: `${verdict.code}: ${verdict.detail}` });
      return { ok: false, kind: 'doneVerdict', code: verdict.code, detail: verdict.detail };
    }
  }

  // 2: `.prhistory` — refuse to close on an unreadable ledger; nothing
  // closes.
  const history = await readPrHistory(deps.io, deps.cfg.registryDir, run.sessionId);
  if (!history.ok) {
    return { ok: false, kind: 'refused', code: 'prhistory-unreadable' };
  }
  coord.foldPrLineage(id, history.entries);

  // 3: the fleet act — AHEAD of the transition commit (deviation D-48). It
  // is a RELEASE (D-5), never an autonomous archive. `state:'failed'` with
  // `archive:true` is the ONE explicit `wsArchive` call in the whole
  // coordination lane.
  if (state === 'failed' && archive) {
    const argv = CCD_ARGV.wsArchive(run.sessionId);
    if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
  } else if (final) {
    const argv = CCD_ARGV.wsRelease(run.sessionId);
    if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
  } else {
    const nextReason = holdReason(run.program, run.wave + 1, run.waveOf);
    const argv = CCD_ARGV.wsHold(run.sessionId, nextReason);
    if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
  }

  // 4: the transition, the handoff commit, the outstanding-delivery
  // cancellation and the program-retirement check — as ONE transaction
  // (`CoordStore.closeRun`'s own docstring has the full reasoning). Only a
  // SHAPE-VALID handoff commit is ever passed through to be written.
  const handoffCommit = HANDOFF_SHA.test(claim.handoffCommit) ? claim.handoffCommit : null;
  const closed = coord.closeRun({
    runId: id, finalState: state, causedBy: 'coordinator', handoffCommit, program: run.program,
  });
  if (!closed.ok) return { ok: false, kind: 'advanceFailed', adv: closed };

  return { ok: true, id, state };
}
