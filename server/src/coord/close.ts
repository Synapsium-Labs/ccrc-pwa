import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import { CCD_ARGV, verbSupported, sweepDec } from '../ccdargv.js';
import { readPrHistory } from './prhistory.js';
import { verifyDone, type DoneClaim } from './fingerprint.js';
import { type AdvanceResult, type CoordStore, type OpenSibling } from './store.js';
import { HANDOFF_SHA, holdReason, queueSystemMail, releaseIsSafe } from './rundefs.js';
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
  | { ok: true; id: number; state: 'done' | 'failed';
      /** Is the workspace's claim GONE as a result of this close? `true` only
       *  after a `ws-release` that actually succeeded.
       *
       *  `false` IS NOT ONE FACT — it is the negation of one, and a reader
       *  that renders a single sentence from it alone will be wrong. All four
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
       *  A client that wants a sentence must branch on `state`/`archive` and
       *  on whether the run had a session — `pwa/src/fleet/AbandonSheet.tsx`
       *  does exactly that, and only speaks for case (1). */
      released: boolean }
  | { ok: false; kind: 'unknown-run' }
  | { ok: false; kind: 'bad-transition'; from: RunState; to: RunState }
  | { ok: false; kind: 'bad-request' }
  | { ok: false; kind: 'refused'; code: Extract<RunRefuseCode, 'not-dispatched' | 'prhistory-unreadable'> }
  | { ok: false; kind: 'doneVerdict';
      code: Extract<MailRejectCode, 'stale-tip' | 'tip-unmeasurable' | 'branch-unmeasurable' |
        'pr-regressed' | 'pr-unmeasurable' | 'no-handoff-commit'>;
      detail: string }
  | { ok: false; kind: 'unsupported' }
  | { ok: false; kind: 'fleetFailed'; stderr: string }
  | { ok: false; kind: 'advanceFailed'; adv: Extract<AdvanceResult, { ok: false }> };

/** The untrusted wire shape `POST /api/runs/:id/close` accepts — validated
 *  inside `closeRun` itself, in the SAME order the route used to (after the
 *  two precondition checks, D-48's own ordering fix), never trusted off a
 *  TypeScript annotation the JSON parse cannot enforce. */
export interface CloseRunBody {
  /** `'abandon'` | absent (D-274 (was D-B4-1)). The operator variant, validated as its OWN
   *  shape below — an abandon that also carries close fields is refused rather
   *  than half-honoured. */
  intent?: unknown;
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
 *
 * `causedBy` is a PARAMETER with no default (D-276 (was D-B4-3) and D-279 (was D-B4-6)): the coordinator's own
 * close records `'coordinator'` and the operator's abandon records
 * `'operator'`, and a default is exactly how the second would silently record
 * the first. Both call sites pass it explicitly.
 */
export async function closeRun(
  deps: CloseRunDeps, id: number, body: unknown,
  causedBy: 'coordinator' | 'operator',
): Promise<CloseOutcome> {
  const coord = deps.coord;
  const run = coord.run(id);
  if (!run) return { ok: false, kind: 'unknown-run' };

  /** The OTHER open runs on this workspace. Read fresh at the decision point,
   *  never cached: a snapshot consulted at a destructive decision point is
   *  the shape `watch.ts` already had to fix once. The closing run excludes
   *  itself — it has not transitioned yet (D-48 puts the fleet act first). */
  const siblingsOf = (sessionId: string): OpenSibling[] => coord.openRunsForSession(sessionId, id);
  /** The claim that survives this close: the MOST RECENTLY opened run, because
   *  the coordinator protocol opens wave N+1 before closing wave N. With the
   *  ordinary one-sibling case this is a distinction without a difference; it
   *  is written down so two siblings produce a DETERMINISTIC reason rather
   *  than a coin toss (`openRunsForSession` is `ORDER BY id`). */
  const survivorOf = (s: readonly OpenSibling[]): OpenSibling | null => s[s.length - 1] ?? null;

  // The body is read HERE, above every precondition, because the abandon arm
  // below branches on it — and the ordinary path's own validation is left
  // exactly where it was, one `const b` shorter.
  const b = (body ?? {}) as CloseRunBody;
  const abandon = b.intent === 'abandon';
  if (abandon && (b.fingerprint !== undefined || b.final !== undefined ||
                  b.state !== undefined || b.archive !== undefined)) {
    // A mixed shape is not a shape. An abandon asserts nothing about a branch,
    // a PR or a wave boundary, so a body carrying those fields is a caller
    // that has confused two acts — answered as `bad-request` rather than
    // silently ignoring half of it.
    return { ok: false, kind: 'bad-request' };
  }

  if (abandon) {
    /**
     * THE OPERATOR ABANDON, as ONE contiguous arm (D-290 (was D-B4-17)). It returns; it
     * never falls through into the ordinary close below.
     *
     * What is skipped is skipped BY CONSTRUCTION, not by four flags threaded
     * through a hundred lines:
     *   - the `not-dispatched` refusal below: a `planned` run with no session
     *     is precisely the `ambiguous-dispatch` wedge this route exists for,
     *     so there is nothing to refuse;
     *   - the fingerprint validation and its derivations: an abandon carries
     *     no claim, so `handoffCommit`/`final`/`state`/`archive` are
     *     `null`/`false`/`'failed'`/`false` here and are not read from a body
     *     at all (D-274);
     *   - `verifyDone` (step 1): D-49's own reasoning, reached from a second
     *     door — there is no done-claim to re-measure;
     *   - the `.prhistory` fold (step 2, D-275 (was D-B4-2)): an unreadable ledger must
     *     not disable the control that exists for a broken box;
     *   - `wsArchive` (step 3): a release destroys nothing and this arm has no
     *     archive branch to reach (D-280 (was D-B4-7) closes the other half at the route).
     * Each of those is pinned by a negative test in `coord-abandon.test.ts`,
     * and each is true because the call is ABSENT, not because a guard skipped
     * it.
     *
     * Cost, named: ~14 lines of transition/fleet-act/commit shape appear twice
     * inside one function. That is the price of the property.
     */
    const target: RunState = run.state === 'planned' ? 'failed' : 'closing';
    if (!RUN_TRANSITIONS[run.state].includes(target)) {
      return { ok: false, kind: 'bad-transition', from: run.state, to: target };
    }
    // The fleet act, AHEAD of the commit (D-48), and only when there is
    // something to act on: a `planned` run that never dispatched holds no
    // workspace. RELEASE ONLY WHEN NOTHING ELSE CLAIMS IT — otherwise HAND
    // THE CLAIM OVER by re-holding with the surviving run's own reason. The
    // abandoned run still transitions either way; the workspace stays
    // claimed. Never `wsArchive` on this arm (D-280).
    let released = false;
    if (run.sessionId !== null) {
      const siblings = siblingsOf(run.sessionId);
      const survivor = survivorOf(siblings);
      // DECIDED ONCE, USED TWICE (review finding, W2b). The act and the
      // reported field used to come from two independent expressions —
      // `releaseIsSafe(siblings) || survivor === null` chose the argv while
      // `releaseIsSafe(siblings)` alone set the field. Today the disjunct is
      // dead (`releaseIsSafe(s) === (s.length === 0) === (survivorOf(s) ===
      // null)`), but the whole point of giving `releaseIsSafe` one home is
      // that it may grow a condition — and the moment it does, the route
      // would report `released:false` for a close that actually ran
      // `ws-release`, the response contradicting the fleet act. The main
      // path below already decides once, via `safe`.
      const release = releaseIsSafe(siblings) || survivor === null;
      // Spelled hand-over-first so the compiler narrows `survivor` on the arm
      // that reads it; `survivor !== null && !release` is exactly `!release`
      // (`release` already absorbs `survivor === null`).
      const argv = survivor !== null && !release
        ? CCD_ARGV.wsHold(run.sessionId,
            holdReason(survivor.program, survivor.wave, survivor.waveOf, survivor.id),
            sweepDec(deps.fleetState, `run:${id} close`))
        : CCD_ARGV.wsRelease(run.sessionId, sweepDec(deps.fleetState, `run:${id} close`));
      if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
      const res = await deps.runCcd(argv);
      if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
      released = release;
    }
    const closed = coord.closeRun({
      runId: id, finalState: 'failed', causedBy, handoffCommit: null,
      program: run.program, viaClosing: target === 'closing',
    });
    if (!closed.ok) return { ok: false, kind: 'advanceFailed', adv: closed };
    return { ok: true, id, state: 'failed', released };
  }

  if (run.sessionId === null) {
    // Never dispatched: there is no worker session for `verifyDone` to
    // re-measure against and no worker to mail a rejection back to.
    return { ok: false, kind: 'refused', code: 'not-dispatched' };
  }
  // A second precondition, read-only, checked BEFORE the fleet act (fix,
  // found in Task 9 review — D-48, the close-route half of D-46's same
  // ordering fix for dispatch): a run that cannot legally reach `closing`
  // from its CURRENT state — already `done`/`failed` (a second close), or
  // still `planned` (sessionId set at OPEN time for a wave N>=2 reclaim,
  // but never actually dispatched) — must never reach the fleet act at
  // all. Without this, moving the fleet act ahead of the transition commit
  // below would have made a double-close run `ws-release`/`ws-hold`/
  // `ws-archive` a SECOND time before discovering the transition was
  // always going to be refused — trading one wedge for another.
  // `advance()` below still re-checks the live row and is still the only
  // WRITER of `state`.
  if (!RUN_TRANSITIONS[run.state].includes('closing')) {
    return { ok: false, kind: 'bad-transition', from: run.state, to: 'closing' };
  }

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
      queueSystemMail(coord, run, { fromId: 'coordinator', toId: run.sessionId, runId: id,
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
  // coordination lane — and, Wave 2, IT IS GATED ON THE SAME SIBLING CHECK
  // as the release. `ws-archive` has no hold rung in ccd (deliberately: a
  // by-hand archive of a held workspace must still work), so an ungated arm
  // here archives a SIBLING run's workspace and leaves that sibling's
  // `.hold` standing over it — F9's harm through a different door. When a
  // sibling is open the archive does not happen, the claim is handed to the
  // survivor by the `else` arm below, the run still transitions to `failed`,
  // and `released:false` is the signal. The cost is stated rather than
  // hidden: the operator asked for an archive and did not get one. It is
  // recoverable by the same hands — `POST /api/sessions/:id/archive` with
  // `{force:true}` — and the corrective act is the one every other arm
  // implies anyway: close the sibling first.
  const siblings = siblingsOf(run.sessionId);
  const survivor = survivorOf(siblings);
  const safe = releaseIsSafe(siblings);
  let released = false;
  if (state === 'failed' && archive && safe) {
    const argv = CCD_ARGV.wsArchive(run.sessionId, sweepDec(deps.fleetState, `run:${id} close`));
    if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
  } else if (final && safe) {
    const argv = CCD_ARGV.wsRelease(run.sessionId, sweepDec(deps.fleetState, `run:${id} close`));
    if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
    released = true;
  } else {
    // TWO cases land here, and the reason they share an arm is that they need
    // the same act with a different reason string:
    //   - the ordinary NON-FINAL close, no sibling: claim the workspace for
    //     wave N+1, whose run does not exist yet — hence `null` for the run
    //     id, and the string is byte-identical to what shipped;
    //   - ANY close, final or not, with a SIBLING still open: the surviving
    //     run's own reason wins. Before Wave 2 the non-final arm wrote its
    //     OWN row's `wave + 1` unconditionally, silently rewriting the live
    //     run's claim whenever the two rows disagree.
    const nextReason = survivor === null
      ? holdReason(run.program, run.wave + 1, run.waveOf, null)
      : holdReason(survivor.program, survivor.wave, survivor.waveOf, survivor.id);
    const argv = CCD_ARGV.wsHold(run.sessionId, nextReason, sweepDec(deps.fleetState, `run:${id} close`));
    if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
  }

  // 4: the transition, the handoff commit, the outstanding-delivery
  // cancellation and the program-retirement check — as ONE transaction
  // now (fix, review finding 25: `closeRun` below replaces two
  // INDEPENDENT `advance()` calls that used to let a crash, a full-disk
  // write failure, or a SIGTERM landing between them wedge the run in
  // `closing` PERMANENTLY — see `CoordStore.closeRun`'s own docstring for
  // the full reasoning, including why it also folds in review findings
  // 8/14's delivery cancellation and D-51's program retirement). Only a
  // SHAPE-VALID handoff commit is ever passed through to be written (fix,
  // review findings 6/18): `verifyDone` is skipped entirely on an
  // abandon (`state:'failed'`, D-49), so its own 40-hex `SHA` check never
  // ran over `claim.handoffCommit` on that path — checking it again here,
  // independent of whether `verifyDone` ran, closes the gap without
  // reintroducing a re-measurement an abandon has nothing left to
  // re-measure against.
  const handoffCommit = HANDOFF_SHA.test(claim.handoffCommit) ? claim.handoffCommit : null;
  const closed = coord.closeRun({
    runId: id, finalState: state, causedBy, handoffCommit, program: run.program,
    // The ordinary close always takes the `closing` hop it always took — the
    // only path that skips it is the abandon arm above (D-281 (was D-B4-8)).
    viaClosing: true,
  });
  if (!closed.ok) return { ok: false, kind: 'advanceFailed', adv: closed };

  return { ok: true, id, state, released };
}
