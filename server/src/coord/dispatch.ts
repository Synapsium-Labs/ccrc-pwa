import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { RunCcd } from './ports.js';
import { cutShort } from '../lifecycle.js';
import type { SessionRecord } from '../registry.js';
import type { TurnVerdict } from './archiveDoor.js';
import { fieldMeasured, readRegistryMeasured } from '../registry.js';
import { readHookStateMeasured } from '../hookstate.js';
import {
  CCD_ARGV, CHILD_ARGV_CAP, ROUTE_ARGV_CAP, capSupported, ccdCan, sweepDec, type ActorFlags,
} from '../ccdargv.js';
import { type AdvanceResult, type CoordStore } from './store.js';
import {
  clearRefusedDetail,
  holdReasonVerdict,
  releaseIsSafe,
  survivorOf,
  type HoldReasonVerdict,
} from './rundefs.js';
import { queueSystemMail } from './rundefsTx.js';
import { WAVE_BRIEF_SUBJECT } from './briefwatch.js';
import {
  SPAWN_NOT_RECORDED, armEventDetail,
  type RouteFields, type RunKind, type RunRefuseCode, type RunState, type SkillState, type SpawnVerdict,
} from '../../../shared/api.js';
import { readSkillState, skillDirFor } from '../skillstate.js';
import { childBindGate, type ChildBindVerdict } from './childBind.js';
import {
  decideDispatch, type CapsReading, type DispatchHalt, type DispatchRun, type DispatchStop,
} from './dispatchDecide.js';

// The worker kickoff rides the brief mail itself: dispatch writes nothing to a
// wave-1 pane (the zero-send-keys pin), and skills are invoked BY NAME (the
// coordinator kickoff idiom, `shared/api.ts`'s `programKickoff`). One constant,
// one place — and since wave 4 (D-1043) that is a fact rather than an aspiration:
// the coordinator kickoff is queued by `coord/kickoff.ts` from that same L0
// constant, so BOTH kickoffs on this fleet now name their skill from one home.
//
// THE SKILL IT NAMES SHIPS ON THIS SAME BRANCH (`ccd/worker-skill/SKILL.md`) and
// reaches no box until that branch's installer has run there — prefix and skill
// are one slice on purpose, because either half alone is a lie: a skill nobody
// is told to run, or an instruction to run a skill that is not installed.
// `worker-skill.test.ts` binds this string to that file's own frontmatter
// `name:`, so a rename cannot leave every worker being sent after a ghost.
export const WORKER_KICKOFF_PREFIX =
  "Run the ccrc-worker skill — it is your standing protocol; read it before acting on anything below.\n\n";

// The reviewer's half of the same pair (design 2026-09-14 §8): one sentence,
// one skill name, bound to `ccd/reviewer-skill/SKILL.md`'s frontmatter by
// `reviewer-skill.test.ts` exactly as the worker's is.
export const REVIEWER_KICKOFF_PREFIX =
  "Run the ccrc-reviewer skill — it is your standing protocol; read it before acting on anything below.\n\n";

/** Which standing protocol a brief of this kind invokes. `unknown` never
 *  reaches here — dispatch refuses it at the transition precondition. */
export const kickoffPrefixFor = (kind: RunKind): string =>
  kind === 'review' ? REVIEWER_KICKOFF_PREFIX : WORKER_KICKOFF_PREFIX;

/**
 * L1 decision function (architecture doc increment 4 — "deciding split from
 * acting"): everything `POST /api/runs/:id/dispatch` used to decide AND act
 * on, inline in its Fastify closure, now a named function with narrowed deps
 * in and a typed result union out. NO `reply` anywhere below — the route
 * (`routes.ts`) is now purely a union->status map (`sendDispatchOutcome`).
 *
 * Deliberately NOT pure — like `fingerprint.ts`'s `verifyDone`, the model
 * this ring follows, it performs the real I/O and the real fleet acts,
 * injected through `DispatchRunDeps` rather than imported. What makes it L1
 * is not the absence of side effects; it is that every side effect is
 * reached through a narrow, consumer-declared port, nothing here touches
 * `fastify`/`reply`, and the ORDER — precondition, then the irreversible
 * fleet act, then the commit — is owned here, in one place, rather than
 * scattered across a route body interleaved with HTTP concerns.
 *
 * `CoordMutex` stays exactly where it was (`routes.ts`): this function does
 * not serialise itself, the same way `verifyDone` does not lock anything —
 * the caller's job, not the decision's.
 */
/** What typing the `/clear` answered: `sendPrompt`'s result, narrowed to the two words dispatch reads. */
export type ClearResult = { ok: true } | { ok: false; error: string };

export interface DispatchRunDeps {
  coord: CoordStore;
  io: FleetIO; cfg: CcrcConfig; runCcd: RunCcd; fleetState?: FleetState;
  /**
   * Types the `/clear` a resumed worker is sent, and answers what the typing did (`sendPrompt`'s proof discipline,
   * with a human's draft stashed around it, D-5912). A PORT, for `turnVerdict`'s reason: `inject/send.ts` is L3,
   * and whether to type is `decideDispatch`'s `act` step, not this module's (ARCH-22, #553). REQUIRED, for
   * `configDir`'s reason too: an optional port a caller forgot to wire would never clear a resumed worker.
   */
  sendClear: (sessionId: string) => Promise<ClearResult>;
  /**
   * A wrapper's config dir, or `undefined` when this box's roster does not
   * carry that wrapper — the CONSUMER-DECLARED port (L2) for the one join
   * `configDirFor` owns.
   *
   * Declared here rather than calling `configDirFor` directly because
   * `server/src/config.ts` imports `./coord/db.js`: a value import would pull
   * the store's own module graph into a policy module whose ring forbids
   * holding a handle, and every other file in this directory imports that file
   * TYPE-ONLY today (D-1015). The coord-ring guard would NOT have caught it —
   * it text-scans for direct `./db.js`/`node:sqlite` imports, and
   * `../config.js` is neither.
   *
   * REQUIRED, not optional: an optional port a caller forgot to wire would
   * report `unmeasurable` on a healthy fleet forever, and fail-quiet is the one
   * failure the preflight exists to delete.
   */
  configDir: (wrapper: string) => string | undefined;
  /**
   * The fail-closed turn verdict (`turnVerdictFor`, `server/src/turnverdict.ts`, the reads' one home; the rule is
   * `stopVerdict`'s) for the session the resume arm is about to `/clear` — D-5238's live gate. A PORT, for
   * `configDir`'s reason: the reads close over the watcher and `server.ts`'s deps, which this policy module cannot
   * import. REQUIRED, for `configDir`'s reason too: an optional port a caller forgot to wire would answer
   * `unmeasured` on a healthy fleet for ever.
   */
  turnVerdict: (rec: SessionRecord, uuid: string) => Promise<TurnVerdict>;
  /** The fleet-wide wake budget's one list (D-5242, `FleetWatcher.admitWake`): a resume onto a hibernated worker records
   *  an ASKED wake there beside its `ensure`, and is never refused for it. Absent (no watcher): nothing is recorded. */
  admitWake?: (kind: 'asked', id: string) => boolean;
}

/** What the dispatch route polls while a pane this dispatch's `ensure` started comes up (D-5238): the registry row
 *  and the uuid the resume arm measured, handed back so the route asks the SAME `turnVerdict` port outside
 *  `coordMutex`. */
export interface SpawnPollTarget { readonly record: SessionRecord; readonly uuid: string }

/** `cmd_ensure` prints `alive: <id>` ONLY on its early return for an already-live pane (`ccd/ccd`); any other answer
 *  is an ensure that (re)started the pane, whose live file may not exist yet. */
export function ensureFoundAlive(stdout: string, sessionId: string): boolean {
  return stdout.split('\n').some((line) => line.trim() === `alive: ${sessionId}`);
}

export type DispatchOutcome =
  | { ok: true; id: number; sessionId: string; resumed: boolean; clearedAt: number | null;
      briefQueued: boolean; clearError: string | null;
      /** Adopted from a KILLED `ws-add`, not created by a clean one — so `ok` is
       *  NO LONGER PROOF THE PANE IS READY. */
      adopted: boolean;
      /** How that spawn ended, when it recorded anything. `null` = not recorded. */
      spawnState: SpawnVerdict | null;
      /**
       * Whether the session this dispatch just bound has the `ccrc-worker`
       * skill installed on the home it is running from — MEASURED, never
       * assumed, and NEVER a reason to refuse (spec section 4,
       * absence-permits). An `absent` dispatch is a real dispatch whose worker
       * will read a brief without its standing protocol; a coordinator reports
       * that to the operator before treating the wave as briefed.
       * `unmeasurable` is not `absent` — nothing was proven about the fleet
       * either way, so it is an unknown to report, not a gap to go fix.
       */
      skillState: SkillState }
  | { ok: false; kind: 'unknown-run' }
  /** Spec §2.3: the run's STORED `sessionId` is not a registry id, so no id-taking argv may name it. That rules out
   *  the resume's `ensure`, the spent-child release or hand-over, the hold and the route write. It is refused before
   *  the pause listing, and the run stays `planned`. This is a stored defect, not a transient: a retry cannot change
   *  it, and `POST /api/runs/:id/abandon` closes such a run with no fleet act. */
  | { ok: false; kind: 'bad-session' }
  /** D-6790: the dispatch's `route` names class `fable`, which only the operator selects. Refused before any fleet act. */
  | { ok: false; kind: 'fable-operator-only' }
  | { ok: false; kind: 'bad-transition'; from: RunState; to: RunState }
  /** `detail` is PRESENT for the malformed-`route` refusal (routing spec
   *  §5.3, slice 4: `route: <why>[ <field>]`) and for the two `slug` refusals
   *  (`slug: must match …` — rename it; `slug: this run resumes …` — drop it).
   *  Every other `bad-request` on this union carries none, so the field
   *  distinguishes by presence rather than an empty string standing in for
   *  "nothing to say". */
  | { ok: false; kind: 'bad-request'; detail?: string }
  /** `detail` is the operator's own arithmetic, and it exists because the cap
   *  no longer measures the thing the sender is holding: the mail is
   *  `WORKER_KICKOFF_PREFIX + brief`, so a brief AT the cap refuses and
   *  "oversize, limit 8192" would read as a bug to whoever wrote 8192 bytes.
   *  Both numbers, in the same sentence, or the refusal is unactionable —
   *  the caps doctrine below ("a cap that refuses without saying what it is is
   *  indistinguishable from a bug") applied to a total the sender cannot
   *  compute from what they sent. */
  | { ok: false; kind: 'oversize'; limit: number; detail: string }
  | Extract<HoldReasonVerdict, { ok: false }>
  | { ok: false; kind: 'refused';
      code: Extract<RunRefuseCode, 'paused' | 'mail-disabled' | 'cap-concurrency' | 'cap-daily' |
        'ambiguous-dispatch' | 'worker-busy' | 'hookstate-unmeasurable' | 'project-mismatch' | 'status-unmeasurable'>;
      limit?: number; running?: number; used?: number; candidates?: number;
      /** WHICH project the measured party belongs to — `project-mismatch`'s
       *  own field, and the only refusal on this union that carries a string.
       *  PRESENT EXACTLY WHEN `.project` was MEASURED with a non-empty name
       *  that differs from the run's — never `record.project`, whose
       *  `registry.ts` collapsing read (`project ?? id`) would arrive as the
       *  session id on an absent or unreadable field and name a project
       *  nobody measured, which is why the guard below reads `<id>.project`
       *  through `fieldMeasured` itself instead. Unreadable answers
       *  `registry-unmeasurable` instead; absent answers nothing at all; an
       *  empty string is never sent, because presence is the distinction and
       *  `''` would collapse "no comparison was made" into "the project is
       *  nothing". The open route's own refusal already carries a `by`
       *  (`routes.ts`), so the two sites of one code answer one shape. */
      by?: string }
  /** `stderr` is PRESENT exactly when the ccd call in the same dispatch ALSO
   *  failed, and it is then ccd's own words. Two things went wrong on the
   *  fresh-spawn path once §1.5 moved the `!res.ok` return PAST the AFTER read —
   *  the `ws-add` and the listing that would have said what it left behind — and
   *  dropping ccd's half told the operator about one of them. Every other refusal
   *  on this path quotes ccd; this one does too.
   *
   *  ABSENT is not "ccd said nothing": it is "ccd is not the failing party" (the
   *  `ws-add` or `ensure` succeeded, and only the registry read failed; or, on the
   *  fresh-spawn arm's pre-spawn read, no ccd call has been made at all). An empty
   *  string would collapse those two, which is the defect class this whole
   *  increment is about — so the distinction is PRESENCE, never `''`. */
  | { ok: false; kind: 'registry-unmeasurable'; stderr?: string }
  | { ok: false; kind: 'unsupported' }
  /** D-5238: the pane this dispatch's `ensure` just STARTED has not published a measurable live file. Answered at
   *  once, with NOTHING after the `ensure` done (no hold, no route write, no transition, no `/clear`): this function
   *  runs inside `coordMutex` and never waits. The route waits for `poll` OUTSIDE the mutex and re-runs the whole
   *  decision once on a measured verdict; on the wire it is `409 {refused:'worker-starting'}`. */
  | { ok: false; kind: 'worker-starting'; poll: SpawnPollTarget }
  | { ok: false; kind: 'fleetFailed'; stderr: string }
  | { ok: false; kind: 'advanceFailed'; adv: Extract<AdvanceResult, { ok: false }> }
  /** Rule 3 at dispatch (child-reclamation spec §5.4): the resumed session is
   *  a CHILD whose branch has had a PR since this run was opened
   *  (`workspace-spent`, `pr` naming it), or whose evidence could not be read
   *  (`spent-unmeasured`, `detail` saying which). Its own member rather than a
   *  `refused` code because it is the one refusal on this union that may
   *  CHANGE something: on `workspace-spent` the spent child's claim is
   *  released — or handed to a surviving sibling — and the run is unbound, and
   *  `unbound` says whether that happened. `true`: dispatch again and a fresh
   *  child is minted. `false`: ALWAYS carries a `detail` (D-3349, F3+F6), one
   *  of two kinds. PERMANENT — the fleet act never even ran because a gate
   *  ahead of it refused first: this box's ccd does not support the verb, the
   *  surviving run's claim could not be written, or the other runs naming the
   *  workspace could not be read — the caller must STOP AND REPORT.
   *  RETRYABLE — everything else: the act ran and FAILED (`<verb> failed: …`),
   *  or the act ran, SUCCEEDED, and `clearSession` found the run no longer
   *  `planned` and bound — either way retry the same dispatch once, and if it
   *  repeats, stop and report. `spent-unmeasured` never unbinds — unknown is
   *  not spent. `pr` and `detail` distinguish by PRESENCE. */
  | { ok: false; kind: 'childSpent'; code: 'workspace-spent' | 'spent-unmeasured'; pr?: number; detail?: string; unbound: boolean };

/**
 * Dispatch a run: pause and caps checked FIRST, then either a fresh
 * workspace (wave 1), held as soon as its session id exists, or a resumed
 * one (wave N>=2, deviation D-1) whose hold is placed BEFORE the injected
 * `/clear` that follows it (R7: the `/clear` fires a SessionStart, and the
 * card that event emits quotes the hold file, so the hold must already be
 * there) — then the transition, then the brief — as MAIL, never injected
 * directly (a fresh pane is `working` for its first seconds, and the
 * delivery lane's own gate is exactly the thing that knows when it is not).
 * `brief` is UNKNOWN off the wire — the route's own JSON parse gives it no
 * shape guarantee, so this function validates it itself, in the same order
 * the route used to (D-46: the transition guard runs BEFORE the body is even
 * looked at).
 */

/**
 * THE CAP, MEASURED ONCE AND DECIDED ONCE (design 2026-09-14 §7.2 pin 2; D-2805).
 * Two routes refuse on the concurrency cap — `dispatchRun` below and
 * `POST /api/runs/:id/advance` when a run re-enters `working` from an idle
 * state — and both take their numbers from this one read, so the refusal's
 * arithmetic is spelled here and nowhere else. It reads `coord` rather than
 * taking the pair as arguments because `coord-caps-route.test.ts` pins that
 * `routes.ts` spells `.capsUsage(` exactly once (the caps VIEW); a route that
 * needs the numbers for a refusal asks here and never reads them itself.
 * `overConcurrency` carries the numbers a refusal must say (the caps doctrine:
 * a cap that refuses without saying what it is is indistinguishable from a bug).
 */
export function capsMeasured(coord: CoordStore): CapsReading {
  const caps = coord.caps();
  const usage = coord.capsUsage();
  const overConcurrency = usage.running >= caps.maxConcurrentWorkers
    ? { limit: caps.maxConcurrentWorkers, running: usage.running }
    : null;
  return { caps, usage, overConcurrency };
}

/** The `DispatchOutcome` member `refuseSpentChild` answers, and its inputs —
 *  named so its signature carries no braces (see the note above). */
type ChildSpentOutcome = Extract<DispatchOutcome, { kind: 'childSpent' }>;
type ChildBindRefusal = Extract<ChildBindVerdict, { ok: false }>;
interface RunBinding { id: number; sessionId: string }

/**
 * The resume arm refusing a CHILD it may not bind (child-reclamation spec
 * §5.4). Spentness can turn true between open and dispatch — the previous
 * wave's worker opens its PR after this wave was opened on its workspace — so
 * this refusal cannot merely fail: a refusal with no automated exit would need
 * a human, which rule 4 forbids.
 *
 * `spent-unmeasured` touches nothing and keeps the binding: unknown is not
 * spent, and the retry re-asks. `workspace-spent` runs the FLEET ACT FIRST
 * (D-48's order: a failed act leaves the run retryable, never half-unbound),
 * then `clearSession`:
 *   - RELEASE ONLY WHEN NOTHING ELSE CLAIMS IT — `closeRun`'s abandon arm,
 *     reached from a second door. If another open run still names this
 *     workspace (a coordinator that dispatched N+1 before closing N), a
 *     release would drop that live run's claim; the claim is HANDED OVER
 *     instead, re-held with the surviving run's own reason.
 *   - An unreadable sibling list, an invalid survivor hold, or a ccd that
 *     lacks the verb answers `unbound: false`, with a `detail` naming that
 *     PERMANENT cause, and changes nothing — stop and report (F3).
 *   - A failed act answers `unbound: false` the same way — retryable, not
 *     permanent.
 *   - A successful act whose `clearSession` finds the run no longer `planned`
 *     and bound also answers `unbound: false`, with a `detail` naming the act
 *     that DID run (F6) — retryable, not "nothing changed".
 *   - The act spends `dispatchDec` — this dispatch's OWN actor (F7), not the
 *     open's: the open placed its hold under `` sweepDec(…, `run:${opened.id}
 *     open`) `` (`routes.ts`), so the journal shows two actors, the open's and
 *     the dispatch's, never one label reused.
 * A crash between the act and `clearSession` leaves a released run still
 * bound; the next dispatch re-asks the gate, re-releases (idempotent) and
 * unbinds.
 */
async function refuseSpentChild(
  deps: DispatchRunDeps, run: RunBinding, gate: ChildBindRefusal, dispatchDec: ActorFlags | null,
): Promise<ChildSpentOutcome> {
  if (gate.code === 'spent-unmeasured') {
    return { ok: false, kind: 'childSpent', code: 'spent-unmeasured', detail: gate.detail, unbound: false };
  }
  const pr = gate.pr;
  const keep = (detail: string): ChildSpentOutcome =>
    ({ ok: false, kind: 'childSpent', code: 'workspace-spent', pr, detail, unbound: false });
  const sibRead = deps.coord.openRunsForSession(run.sessionId, run.id);
  if (!sibRead.ok) return keep(`the other runs naming this workspace could not be read: ${sibRead.detail}`);
  const survivor = survivorOf(sibRead.siblings);
  let handoff: HoldReasonVerdict | null = null;
  if (!releaseIsSafe(sibRead.siblings) && survivor !== null) {
    handoff = holdReasonVerdict(survivor.program, survivor.wave, survivor.waveOf, survivor.id);
    if (!handoff.ok) return keep(`the surviving run's claim cannot be written: ${handoff.detail}`);
  }
  const argv = handoff !== null && handoff.ok
    ? CCD_ARGV.wsHold(run.sessionId, handoff.reason, dispatchDec)
    : CCD_ARGV.wsRelease(run.sessionId, dispatchDec);
  // D-5866: the row the argv above was built from — the hold when a survivor takes the claim, else the release.
  if (!ccdCan(deps.fleetState, handoff !== null && handoff.ok ? 'wsHold' : 'wsRelease')) {
    return keep(`this box's ccd does not support ${argv[0]}`);
  }
  const res = await deps.runCcd(argv);
  if (!res.ok) return keep(`${argv[0]} failed: ${res.stderr.trim()}`);
  const cleared = deps.coord.clearSession(run.id, pr);
  // F3 + F6 (D-3349): the fleet act above DID run — `argv[0]` names which,
  // `ws-release` or the hand-over's `ws-hold` — but `clearSession` guards on
  // the run still being `planned` and bound. Every run-writing ROUTE runs
  // behind the same `coordMutex` (`routes.ts`), and a crash never reaches
  // this `return` at all — so there is, today, no path through the routes
  // that leaves `cleared.cleared` false here (F6's own reachability
  // argument). The `detail` below exists to keep the answer honest if that
  // ever stops being true — a future caller outside the mutex, a timer this
  // file has not audited — rather than assert "impossible" about a guard
  // whose whole point is to answer for a state it did not expect.
  // `unbound:false` here is NOT one of the three PERMANENT causes `keep`
  // above reports (unsupported verb, invalid survivor hold, unrepresentable
  // sibling): the act already ran, so this `detail` means retry the same
  // dispatch once, and if it repeats, stop and report — never "nothing
  // changed", which would be a lie about the act that just happened.
  if (!cleared.cleared) {
    return { ok: false, kind: 'childSpent', code: 'workspace-spent', pr, unbound: false,
      detail: `${argv[0]} ran, but run ${run.id} was no longer planned and bound by the time it ` +
        'completed, so nothing was unbound' };
  }
  return { ok: false, kind: 'childSpent', code: 'workspace-spent', pr, unbound: true };
}

/** The one place a decider's non-`go` answer becomes a `DispatchOutcome`. The `switch` is exhaustive: a fourth arm in
 *  `dispatchDecide.ts` is a compile error here until it is answered. A refusal that carries an `event` journals it
 *  first, as the inline code did. */
function stopped(coord: CoordStore, id: number, d: DispatchStop): DispatchHalt {
  switch (d.kind) {
    case 'refused':
      if (d.event !== undefined) coord.recordRunEvent(id, 'coordinator', d.event);
      return d.outcome;
    case 'stale':
      return d.outcome;
    default:
      return d satisfies never;
  }
}

/** What a dispatch bound: the session it will hold, brief and (resumed) `/clear`. */
interface Bound {
  sessionId: string; workspace: string | null; branch: string | null; wrapper: string | null; resumed: boolean;
  /** D-5238: what the resume gate measured, read again at the act. `null` on a fresh spawn. */
  liveGate: SpawnPollTarget | null;
  adopted: boolean; adoptedSpawn: SpawnVerdict | null;
}

/**
 * Wave 1: mint a workspace and learn its id by REGISTRY DIFF, never by parsing ccd's echoed sentence (a prose line
 * nobody wrote a contract for). Read the registry before and after; exactly one new `workspace !== null` row for this
 * project is the run's session. Which row, and whether to ADOPT one a cut-short `ws-add` left, is
 * `decideDispatch`'s `bind` step; this function only reads, spawns and writes.
 */
async function spawnFresh(
  deps: DispatchRunDeps, run: DispatchRun, routeFields: RouteFields | null, childSlug: string | null,
  dispatchDec: ActorFlags | null,
): Promise<Bound | DispatchHalt> {
  const coord = deps.coord;
  // [registry-refused:refuses] an unlistable registry refuses before anything is spawned.
  const before = decideDispatch({ step: 'before', read: await readRegistryMeasured(deps.io, deps.cfg) });
  if (before.kind !== 'go') return stopped(coord, run.id, before);
  // ROUTING (routing spec §5.3, slice 4, Task 3): gated on `ROUTE_ARGV_CAP`, the ARGV-PARSING capability: a
  // DIFFERENT token from the `ROUTE_CAP` the wave N>=2 arm gates the `ccd route` VERB on. `routeFields === null`
  // sends the identical bare argv regardless of the cap, so an absent token never fires the omission event for a
  // wave that carried no routing to omit.
  if (routeFields !== null && !capSupported(deps.fleetState, ROUTE_ARGV_CAP)) coord.recordRunEvent(run.id, 'coordinator', 'route-omitted:no-route-argv-cap');
  // THE CHILD (child-workspace reclamation, spec §5.1): every workspace this arm mints is a child of THIS run, so
  // `--child <run.id>` is sent unconditionally, EXCEPT to a box that has not said it parses the flag (`capSupported`:
  // no evidence REFUSES, since an older `cmd_ws_add` would bind `--child` as the project, D-410). A box without the
  // token ALWAYS journals the omission: a workspace minted without the marker is simply not a child.
  const child = capSupported(deps.fleetState, CHILD_ARGV_CAP) ? run.id : null;
  if (child === null) coord.recordRunEvent(run.id, 'coordinator', 'child-omitted:no-child-argv-cap');
  // `wsAddWorker`, not `wsAdd`: the one call site that knows the spawn is a dispatched program worker, so it
  // declares `--no-rc` at creation (the 2026-08-13 ruling) and WHO (D-410's remedy): the same `dispatchDec` the hold
  // spends, so the journal's `create` row and the `hold` row that follows read as one act by one lane. `null` (an
  // older ccd, no `actor-flags-v1`) composes the bare argv that shipped before.
  const argv = CCD_ARGV.wsAddWorker(run.project, dispatchDec, capSupported(deps.fleetState, ROUTE_ARGV_CAP) ? routeFields : null, child, childSlug);
  // BEFORE the call, never after: the only moment the run can say "a dispatch is in flight" (the id does not exist
  // yet). ONE MEASUREMENT, SPENT TWICE (child-reclamation spec §5.1): this instant is this attempt's
  // `dispatchStartedAt` AND, only for a clean spawn, this session's `sessionBornAt`.
  const startedAt = Date.now();
  coord.markDispatchStarted(run.id, startedAt);
  const res = await deps.runCcd(argv);
  // [registry-refused:refuses] a refused name new since BEFORE refuses the bind (the bind step decides it).
  const bind = decideDispatch({ step: 'bind', project: run.project, childSlug, beforeIds: before.plan,
    after: await readRegistryMeasured(deps.io, deps.cfg),
    res: res.ok ? { ok: true } : { ok: false, stderr: res.stderr, cutShort: cutShort(res) } });
  if (bind.kind !== 'go') return stopped(coord, run.id, bind);
  const { winner, adopted, adoptedSpawn } = bind.plan;
  // Fix, review finding 7: persist the spawn onto the run row RIGHT AWAY, before the hold, which can still fail. The
  // adopted arm (child-reclamation spec §5.1) dates NO birth: the workspace may be an EARLIER attempt's, so
  // `childBirthOf` refuses to date any PR row against it, `childBindGate` refuses on any PR evidence, and the close
  // holds rather than guessing which attempt this workspace's history belongs to.
  coord.setSession(run.id, winner.id, adopted ? null : startedAt);
  // Routing spec §6 "Arms": the `arm:` record, only when routing was actually seeded onto the argv, and gated on the
  // dispatch BINDING a session, never on `res.ok` (an adopted spawn reaches here with `res.ok === false`).
  if (routeFields !== null && capSupported(deps.fleetState, ROUTE_ARGV_CAP)) coord.recordRunEvent(run.id, 'coordinator', armEventDetail(routeFields));
  // `winner.wrapper` is MEASURED: the bind step refuses any same-project record whose identity is not.
  return { sessionId: winner.id, workspace: winner.workspace, branch: winner.branch, wrapper: winner.wrapper,
    resumed: false, liveGate: null, adopted, adoptedSpawn };
}

/**
 * Wave N>=2: resume the SAME workspace (deviation D-1: no ccd verb can spawn fresh into an existing one). NO
 * `markDispatchStarted` here, deliberately: that column measures the window in which a workspace is being MINTED
 * with no session id yet, and a resume has neither half. Adding the stamp widens what NULL means and reds
 * `run-routes.test.ts`'s resume-scope pin: do it only as a decided scope change.
 */
async function resumeBound(
  deps: DispatchRunDeps, run: DispatchRun, sessionId: string, dispatchDec: ActorFlags | null,
): Promise<Bound | DispatchHalt> {
  // Rule 3's dispatch half (child-reclamation spec §5.4): BEFORE `ensure`, so a spent child is never resumed.
  const childGate = await childBindGate(deps, deps.coord, sessionId);
  if (!childGate.ok) return refuseSpentChild(deps, { id: run.id, sessionId }, childGate, dispatchDec);
  // D-5242: resuming a hibernated worker WAKES it. The coordinator asked, so the wake budget never refuses it (its
  // answer is not read), but the wake is recorded in the window the mail lane's automatic wakes are bounded by.
  if (deps.admitWake !== undefined) {
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names !== null && names.includes(`${sessionId}.hibernated`)) deps.admitWake('asked', sessionId);
  }
  const res = await deps.runCcd(CCD_ARGV.ensure(sessionId));
  if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
  // NO REFUSED-ID ARM HERE, by design (spec §2.3): `sessionId` is the run's STORED id, and the request step's
  // stored-row gate refuses a bad one before any read; `childBindGate` holds it `spent-unmeasured` behind that.
  //
  // The live registry falls back to the run row (`fingerprint.ts`'s `verifyDone` uses the identical fallback). An
  // unmeasured value is refused BEFORE it is persisted by `markDispatched`: it would stop being a transient read and
  // become a fact the run row carries forever, and a degraded `record.uuid` (`''`) fed to the hook read would look up
  // a file that matches no real one and read back "not busy", turning the FAIL-SHUT busy gate FAIL-OPEN.
  const d = await decideDispatch({ step: 'resume', project: run.project, sessionId, runWorkspace: run.workspace,
    runBranch: run.branch, ensureStarted: !ensureFoundAlive(res.stdout, sessionId),
    // [registry-refused:gated] guarded by the stored-row gate and childBindGate, above.
    registry: () => readRegistryMeasured(deps.io, deps.cfg),
    projectField: () => fieldMeasured(deps.io, deps.cfg.registryDir, sessionId, 'project'),
    hookState: (uuid) => readHookStateMeasured(deps.io, deps.cfg.registryDir, sessionId, uuid, Date.now()),
    turnVerdict: deps.turnVerdict });
  if (d.kind !== 'go') return stopped(deps.coord, run.id, d);
  return { sessionId, ...d.plan, resumed: true, adopted: false, adoptedSpawn: null };
}

export async function dispatchRun(
  deps: DispatchRunDeps, id: number, brief: unknown, items: unknown, route: unknown = undefined,
  slug: unknown = undefined,
): Promise<DispatchOutcome> {
  const coord = deps.coord;
  // Everything the request says, in D-46's order: the cheapest refusal first, and nothing listed, counted, spawned or
  // held for a request that was never going to be accepted. SYNCHRONOUS up to the first `await` below on purpose:
  // two calls fired together both read the same `planned` row (`coord-decide.test.ts`).
  const req = decideDispatch({ step: 'request', read: coord.run(id), brief, items, route, slug,
    prefixes: { work: WORKER_KICKOFF_PREFIX, review: REVIEWER_KICKOFF_PREFIX } });
  if (req.kind !== 'go') return stopped(coord, id, req);
  const { run, body, itemTitles, routeFields, routeDefaulted, childSlug, hold } = req.plan;
  // PAUSE / KILL-SWITCH FIRST, then the caps, before anything is counted or spawned.
  const admit = decideDispatch({ step: 'admit', names: await deps.io.readdir(deps.cfg.registryDir),
    caps: () => capsMeasured(coord) });
  if (admit.kind !== 'go') return stopped(coord, id, admit);

  // ONE MEASUREMENT, SPENT TWICE — the dispatch's own dec, hoisted above the
  // fresh-spawn branch because BOTH of this function's ccd writes are the same
  // act by the same lane on the same run's behalf: the `ws-add` that mints the
  // workspace (wave 1 only) and the `ws-hold` at step 5 that claims it. Read
  // once here rather than composed at each site, for the reason D-410's review
  // gave when it deleted the second copy: `` `run:${run.id} dispatch` `` typed
  // twice is one drift away from splitting one lane into two actors in the
  // journal, and nothing would have kept the two literals equal. The single
  // read also means `deps.fleetState` cannot be consulted at two different
  // moments and answer differently.
  //
  // AND THE MOMENT IT SETTLES ON IS THE EARLIER ONE — a trade, not a pure win,
  // stated here because the line above reads like one. `state.ccdVerbs` is
  // MUTATED IN PLACE beneath us: `remote/client.ts`'s `onReady` rewrites it on
  // every agent re-handshake (and writes `null` for a ready frame carrying no
  // usable list), and `refreshcaps.ts`'s 60s lane overwrites it with whatever
  // the fleet host now advertises. The hold spends this value a few awaits
  // later, on either branch — the `ws-add` and two registry reads on the
  // fresh-spawn arm, or `ensure`, a registry read and a hook read on the
  // resume arm (R7 moved the hold ahead of that arm's `/clear`, so the clear
  // no longer widens this window) — so if caps REGRESS across that window (a
  // reconnect to a downgraded ccd, a ready frame with no `ccdVerbs`) the hold ships
  // `--surface`/`--actor` where the fresh `sweepDec` this hoist replaced would
  // have omitted them, at the cost `capSupported`'s no-evidence-FALSE default
  // is argued for in `ccdargv.ts`. Nothing below catches it, and the asymmetry
  // is three lines from the spend: `ccdCan(deps.fleetState, 'wsHold')`
  // re-reads the SAME field FRESH there, and by its own opposite default
  // answers TRUE on `null`. Accepted deliberately — one actor across the two
  // rows of one act outweighs a flag pair a regressed box refuses, and the
  // regression is a deploy-window event — but it is a staleness, not the
  // absence of one.
  //
  // AND A THIRD SPEND, on a refusal path only (child-reclamation wave 2):
  // `refuseSpentChild` releases — or hands to a surviving sibling — the claim
  // an earlier open placed on a spent child, under THIS dispatch's own
  // actor (F7) rather than minting a second label: the open placed its hold
  // under `` sweepDec(…, `run:${opened.id} open`) `` (`routes.ts`), so the
  // journal shows two actors for the two acts, the open's and the dispatch's.
  const dispatchDec = sweepDec(deps.fleetState, `run:${run.id} dispatch`);

  const bound = run.sessionId === null
    ? await spawnFresh(deps, run, routeFields, childSlug, dispatchDec)
    : await resumeBound(deps, run, run.sessionId, dispatchDec);
  if ('ok' in bound) return bound;
  // D-6794: the journal says the route was the table's row, not the coordinator's. It records the decision; a box
  // without `route-argv-v1` drops `--route` and journals `route-omitted` beside it. Written after the spawn's refusals.
  if (routeDefaulted) coord.recordRunEvent(id, 'coordinator', `route-defaulted:${run.kind}`);
  const { sessionId, resumed, liveGate, adopted, adoptedSpawn } = bound;

  // The hold: claimed AS SOON AS the session id exists, and on a resume BEFORE the injected `/clear` (R7: the `/clear`
  // fires a SessionStart whose card quotes the hold file, so the hold must already be there).
  const holdArgv = CCD_ARGV.wsHold(sessionId, hold.reason, dispatchDec);
  if (!ccdCan(deps.fleetState, 'wsHold')) return { ok: false, kind: 'unsupported' };
  const holdRes = await deps.runCcd(holdArgv);
  if (!holdRes.ok) return { ok: false, kind: 'fleetFailed', stderr: holdRes.stderr };

  // Routing spec §5.3: a resumed worker is routed by calling the `route` verb on its session. ONE ARGV, EVERY PAIR
  // (fix round 2, finding #3): `cmd_route` validates every `--set` pair before its write loop touches the registry,
  // so a refusal leaves the record untouched, which N calls would not. AFTER the hold, BEFORE the `/clear`: writing
  // first is what keeps a refused route from stranding a cleared, brief-less pane. A refusal returns `fleetFailed`;
  // the run stays `planned`, the `/clear` never fires, and there is nothing to unwind.
  if (resumed && routeFields !== null) {
    if (!ccdCan(deps.fleetState, 'routeSet')) {
      coord.recordRunEvent(id, 'coordinator', 'route-omitted:no-route-v1-cap');
    } else {
      const routeRes = await deps.runCcd(
        CCD_ARGV.routeSet(sessionId, routeFields, sweepDec(deps.fleetState, `run:${id} dispatch`)));
      if (!routeRes.ok) return { ok: false, kind: 'fleetFailed', stderr: routeRes.stderr };
      // Routing spec §6 "Arms": recorded only once the `route` verb itself succeeded.
      coord.recordRunEvent(id, 'coordinator', armEventDetail(routeFields));
    }
  }

  // R7 continued: the injected `/clear`, AFTER the hold. Whether it is typed, and whether the live verdict still
  // holds at the act (D-5238), is `decideDispatch`'s `act` step; typing it is the `sendClear` port.
  const act = await decideDispatch({ step: 'act', resumed, liveGate, turnVerdict: deps.turnVerdict });
  if (act.kind !== 'go') return stopped(coord, id, act);
  // D-5912: a human's draft in the worker's box is stashed around the `/clear` and restored after it (Claude Code
  // restores a stash after a slash command too, measured in Task P1b's probe), never a reason to skip the clear.
  // A refused `/clear` (dialog open, a stash refused, an ignored Enter…) is
  // not fatal to dispatch itself — the run still lands in `dispatched`
  // below, with `clearedAt` left null as the honest record that the
  // second step has not run yet; a coordinator that notices retries it
  // like any other failed step (D-1, orchestrator amendment). What
  // "recorded" and "retried" actually need — the refusal CODE, and never
  // queuing a brief into a context D-1's own "genuinely fresh" guarantee
  // was never met for — is deviation D-47 below.
  const clearRes = act.plan.clear ? await deps.sendClear(sessionId) : null;
  const clearedAt = clearRes?.ok ? Date.now() : null;
  const clearError = clearRes === null || clearRes.ok ? null : clearRes.error;

  // 6: ONE call, and one transaction (D-277 (was D-B4-4)). The dispatch write, the
  // `clearedAt` stamp, the transition and the declared ledger's INSERTs used
  // to be three independent `tx()`s plus (as of spec §3.1) a fourth batch of
  // statements after them — the same split `CoordStore.closeRun` was created
  // to close, reached a second time. `CoordStore.dispatchRun` owns the commit;
  // the `run_events` row still happens inside it and is still independently
  // attributable (`markDispatched`'s own docstring). A `/clear` refusal is
  // RECORDED (deviation D-47, found in Task 9 review) — D-1's own amended
  // text promises "the refusal recorded" and nothing did: `run_events.detail`
  // carries the typed `sendPrompt` error code (`dialog-open`/`stash-failed`/
  // `verify-failed`/`enter-ignored`/…) an operator (or Task 11's own record)
  // can otherwise only guess at.
  // COMPUTED HERE, ABOVE THE COMMIT, and used twice: once as a column the commit
  // writes and once at step 7 to gate the brief. Both inputs are final by the end
  // of the resume arm — `resumed` is set on both arms and `clearedAt` is the last
  // thing either writes — so hoisting the expression changes no decision, only
  // where it is available. The reasoning for the RULE itself stays at its call
  // site in step 7 (D-47), which is where a reader looking for "why is the brief
  // gated" will go.
  const briefQueued = !resumed || clearedAt !== null;
  const adv = coord.dispatchRun({ runId: id, sessionId, workspace: bound.workspace, branch: bound.branch, resumed,
    clearedAt, items: itemTitles, briefQueued, clearError,
    // The SUFFIX is a `SpawnVerdict`, never a raw rc — and never the word
    // `spawnstate`, which is not a field and must never become one. Recorded only
    // on the adoption path, so its PRESENCE is the record that this workspace came
    // from a cut-short `ws-add` rather than a clean one.
    //
    // `SPAWN_NOT_RECORDED` for the `null` case, and NOT `unrecognised`. `null`
    // means no `.spawn` fact was written at all — which on THIS path is the
    // LIKELY outcome, not an edge one: `cmd_ws_add` writes the worktree and every
    // registry row first and stamps `$REG/<id>.spawn` LAST, from `_spawn_settle`,
    // so a kill that lands mid-settle — the only reason this workspace is being
    // adopted — leaves nothing behind to read. `unrecognised` is a MEMBER of
    // `SpawnVerdict` and says something else and narrower: ccd DID record an rc,
    // and it is one this build's table cannot name. Spending that member on the
    // absent case tells the operator ccd reported something strange when ccd
    // reported nothing, and the two become indistinguishable in the event trail.
    // `clearRefusedDetail`, not a literal: Task 407 gave this token a READER
    // (`CoordStore.strandedClear` — the proof that lets the mail lane clear a
    // `/clear` this dispatch stranded), and a writer and a matcher spelling
    // the same string by hand is how that permission silently stops opening.
    detail: adopted ? `spawn-adopted:${adoptedSpawn ?? SPAWN_NOT_RECORDED}`
      : clearError !== null ? clearRefusedDetail(clearError) : undefined });
  if (!adv.ok) return { ok: false, kind: 'advanceFailed', adv };

  // 6b: THE SKILL PREFLIGHT (spec section 4 item 1). MEASURE, NEVER REFUSE.
  //
  // Placed after the commit deliberately, for two reasons that both matter.
  // (a) Ordering: this function owns a precondition -> irreversible act ->
  // commit sequence, and a read inserted upstream of the commit could only ever
  // delay it while deciding nothing. (b) The event row: `recordRunEvent` writes
  // a non-transition row whose `toState` is the run's CURRENT state, and
  // `FleetWatcher.pushNewRuns` tags every push `run-<id>-<toState>`. After the
  // commit that state is `dispatched`, so this row reuses the transition row's
  // own tag instead of minting a second one; before it, the row would have said
  // `planned` and pushed a notification naming a state the run has already left
  // — the noise `recordRunEvent`'s own docstring warns about.
  //
  // The row is written on ALL THREE answers, not just the interesting two. Were
  // it written only for absent/unmeasurable, the ABSENCE of a row would mean
  // either `present` or "an older build with no preflight" — a second
  // overloaded null, one layer down from the one this field deletes.
  // Which skill directory: BY KIND. The cast is sound because the transition
  // precondition above (`:190`, Task 4) already refused a `kind:'unknown'`
  // row before this function ever reaches an irreversible act — `unknown`
  // never lands here, so the narrower union is not a lie.
  const skillState = await readSkillState(
    deps.io, bound.wrapper === null ? undefined : deps.configDir(bound.wrapper),
    skillDirFor(run.kind as 'work' | 'review'));
  coord.recordRunEvent(id, 'coordinator', `skill-preflight:${skillState}`);

  // 7: the brief, as MAIL (kind `status`, subject `wave-brief`) — never
  // injected directly, and (deviation D-47) queued ONLY when the worker's
  // context is one it can actually land in: wave 1 has never had anything
  // else written into it, and wave N>=2's `/clear` must have actually
  // VERIFIED. Queuing unconditionally, as before, meant a refused `/clear`
  // still queued a brief into the resumed, un-cleared context — the exact
  // hazard D-1's "genuinely fresh context" sentence exists to make
  // mechanical rather than hopeful. Concretely, on `enter-ignored` the
  // literal text `/clear` is left sitting in the worker's own input box
  // (`send.ts`'s own `draft` return).
  //
  // WHAT THAT COSTS CHANGED UNDER THIS BUILD, and the new cost is the worse
  // of the two (wave-check). It used to be a park: the delivery lane's next
  // sweep hit `draft-present` (a word that lane no longer meets, D-5912), kept hitting it, and parked the brief
  // `rejected('undeliverable')` after `MAIL_MAX_ATTEMPTS` with nothing
  // surfacing why. Both halves of that are now false — Task 407 lets the
  // lane CLEAR exactly this box, on the record THIS CALL writes
  // (`clearRefusedDetail` below, read back by `CoordStore.strandedClear`),
  // and Task 409 tells the sender on the first block and on the park. So a
  // brief queued here would no longer sit and park where somebody eventually
  // notices; it would most likely LAND, in the un-cleared context D-1
  // forbids. The gate is what keeps it out, and it matters more than it did.
  // `clearError` (this outcome's own field) is the signal a
  // coordinator needs to decide what to do next; `POST /api/mail` stays
  // open to send the brief directly once the context is actually fresh.
  if (briefQueued) {
    // `body`, not `brief`: what lands in the worker is its standing protocol
    // followed by the wave's specifics, as ONE mail — the kickoff is never a
    // message of its own, so a path that queues no brief queues nothing at all.
    // The return value is deliberately dropped HERE and at the other two
    // run-mail call sites (D-1042). `queueSystemMail` now answers whether it
    // queued or found an identical one already outstanding, because the wave-4
    // kickoff route has to tell an operator which happened — but each of these
    // three has at most ONE instance in flight per run by construction, which
    // is the standing claim in that function's own dedupe comment, so there is
    // nothing here for the answer to change.
    queueSystemMail(coord, run, { fromId: 'coordinator', toId: sessionId, runId: id,
      kind: 'status', subject: WAVE_BRIEF_SUBJECT, body });
  }

  return { ok: true, id, sessionId, resumed, clearedAt, briefQueued, clearError,
    adopted, spawnState: adoptedSpawn, skillState };
}
