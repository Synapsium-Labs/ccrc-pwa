import { isRegistryId, spawnVerdict, transitionsFor, parseRouteFields, routeFieldsOrNull, routeParseDetail,
  MAIL_BODY_MAX_BYTES, WORK_ITEM_MAX, WORK_ITEM_TITLE_MAX, WORKSPACE_SLUG_RE,
  type CoordCaps, type CoordCapsUsage, type RouteFields, type SpawnVerdict,
} from '../../../shared/api.js';
import { routeDefaultFor } from '../../../shared/route-defaults.js';
import { measuredIdentity, type RegistryRead, type SessionRecord } from '../registry.js';
import type { MeasuredRead } from '../io.js';
import type { HookStateRead } from '../hookstate.js';
import type { cutShort } from '../lifecycle.js';
import { COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER, holdReasonVerdict, type HoldReasonVerdict } from './rundefs.js';
import type { TurnVerdict } from './archiveDoor.js';
import type { RunReadResult, RunRow } from './store.js';
import type { DispatchOutcome, SpawnPollTarget } from './dispatch.js';

/**
 * `dispatchRun`'s decisions, as data (ARCH-22, GitHub #553; architecture doc increment 4, the half
 * `dispatch.ts` had not finished). L1: no `fs`, no fastify, no tmux, no clock, and no act. The executor
 * (`dispatch.ts`) reads the world, asks `decideDispatch` what it means, and ACTS on the answer; it decides nothing
 * itself, and in particular it no longer imports the injection it used to decide (`sendPrompt`): whether the
 * `/clear` is typed is `decideDispatch({ step: 'act' })`'s answer, and the typing reaches `dispatch.ts` as the
 * `DispatchRunDeps.sendClear` port.
 *
 * ONE FUNCTION, FIVE STEPS. A dispatch is not one decision: it reads, acts, reads again and decides again, and
 * every fleet act in the middle (the `ws-add`, the `ensure`, the `ws-hold`) changes what the next read means. So the
 * facts arrive in the order the executor can have them, one `step` at a time, and the first refusal wins:
 *
 *   request  the stored row and the body: unknown row, transition, brief, oversize, items, route, slug, hold,
 *            stored session id.
 *   admit    the registry listing's pause markers, then the two caps.
 *   before   (a fresh spawn) the registry listing taken before the `ws-add` is measured.
 *   bind     (a fresh spawn) the registry diff after the `ws-add`: which new row is this run's, or whether to adopt.
 *   resume   (a bound session) the registry row, the project field, the hook state and the live verdict.
 *   act      the verdict read AGAIN at the act: whether the `/clear` is typed, or the dispatch is STALE.
 *
 * THE ORDER IS THE CONTRACT, inside each step and between them. `dispatch-gate-order.test.ts` (through
 * `dispatchRun`) and `dispatch-decide.test.ts` (through this function) pin it with a row per adjacent pair of gates
 * one input can trip together, each with a recorded reorder mutant.
 *
 * THE DECISION IS ONE OF THREE KINDS. `go` carries the step's plan. `refused` carries the exact `DispatchOutcome`
 * the wire answers, and, for the two bind refusals the run's trail records, the `event` to journal. `stale` is the
 * honest third arm, for a run row the fleet has outgrown: the session it names is gone from a listable registry
 * (the `resume` step), or the measurement the gate passed no longer holds when it comes to the keystroke, after the
 * hold is placed (the `act` step). It answers the same wire words a refusal would, but it is NAMED, and the
 * executor's `switch` over the arms is exhaustive (`satisfies never`) so a fourth arm cannot be added unanswered.
 *
 * LAZY READS. The resume and act steps take their reads as thunks and call them only when the gate before has not
 * refused, so a refusal still costs exactly the reads ahead of it, as the inline code did.
 */
export type DispatchHalt = Extract<DispatchOutcome, { ok: false }>;
type RefusedWire = Extract<DispatchHalt, { kind: 'refused' }>;

export type DispatchDecision<P> =
  | { kind: 'go'; plan: P }
  | { kind: 'refused'; outcome: DispatchHalt; event?: string }
  | { kind: 'stale'; outcome: RefusedWire };

/** The decision that ends the dispatch: everything but `go`. */
export type DispatchStop = Exclude<DispatchDecision<never>, { kind: 'go' }>;

const go = <P>(plan: P): DispatchDecision<P> => ({ kind: 'go', plan });
const refused = (outcome: DispatchHalt, event?: string): DispatchDecision<never> =>
  event === undefined ? { kind: 'refused', outcome } : { kind: 'refused', outcome, event };

/** What `capsMeasured` reads: the caps, the usage and, when the concurrency cap is reached, its numbers. */
export interface CapsReading {
  caps: CoordCaps; usage: CoordCapsUsage;
  overConcurrency: { limit: number; running: number } | null;
}

/** The run row a dispatch decides on, once it is known to exist. */
export type DispatchRun = RunRow;

// -- step: request -----------------------------------------------------------------------------------------------

export interface RequestFacts {
  step: 'request';
  read: RunReadResult;
  /** UNKNOWN off the wire: the route's JSON parse gives these no shape. */
  brief: unknown; items: unknown; route: unknown; slug: unknown;
  /** The standing protocol a brief of each kind invokes (`dispatch.ts` hands over its L0 constants). */
  prefixes: KickoffPrefixes;
}
export interface RequestPlan {
  run: DispatchRun;
  /** The mail: the standing protocol by name, then the wave's own brief. */
  body: string;
  itemTitles: readonly string[];
  routeFields: RouteFields | null;
  /** D-6794: the fields came from the run kind's default row, because the caller passed no route. */
  routeDefaulted: boolean;
  childSlug: string | null;
  hold: Extract<HoldReasonVerdict, { ok: true }>;
}

export interface KickoffPrefixes { work: string; review: string }

function decideRequest(f: RequestFacts): DispatchDecision<RequestPlan> {
  const { read, brief, items, route, slug, prefixes } = f;
  // D-2545: the row exists and its integers are unrepresentable: refused in words, ahead of any fleet act.
  if (!read.ok) return refused({ ok: false, kind: 'hold-invalid', detail: read.detail });
  const run = read.run;
  if (!run) return refused({ ok: false, kind: 'unknown-run' });
  // D-46: `dispatched -> dispatched` is illegal; answered before `ccd ensure`/`ws-add`/`ws-hold` can fire. Read by
  // KIND (design 2026-09-14 §5.2): a `kind: 'unknown'` row (D-2795) is refused here too.
  if (!transitionsFor(run.kind)[run.state].includes('dispatched')) {
    return refused({ ok: false, kind: 'bad-transition', from: run.state, to: 'dispatched' });
  }
  if (typeof brief !== 'string' || brief.trim() === '') return refused({ ok: false, kind: 'bad-request' });
  // The cap measures the composed mail, not the raw brief: the envelope's cost model counts what is queued, so a
  // brief AT the cap would otherwise queue a mail over it, and the two ingresses would disagree about 8 KiB.
  const prefix = run.kind === 'review' ? prefixes.review : prefixes.work;
  const body = prefix + brief;
  if (Buffer.byteLength(body, 'utf8') > MAIL_BODY_MAX_BYTES) {
    return refused({ ok: false, kind: 'oversize', limit: MAIL_BODY_MAX_BYTES,
      detail: `brief ${Buffer.byteLength(brief, 'utf8')} bytes + kickoff prefix ` +
        `${Buffer.byteLength(prefix, 'utf8')} bytes exceeds the ` +
        `${MAIL_BODY_MAX_BYTES}-byte mail body cap` });
  }
  // Spec §3.1: the item titles ride beside the brief as a structured field. `undefined` and `[]` are the same
  // legal answer. BYTES, not characters (`WORK_ITEM_TITLE_MAX`'s own reasoning).
  if (items !== undefined) {
    if (!Array.isArray(items) || items.length > WORK_ITEM_MAX) return refused({ ok: false, kind: 'bad-request' });
    for (const t of items) {
      if (typeof t !== 'string' || t.trim() === '' || Buffer.byteLength(t, 'utf8') > WORK_ITEM_TITLE_MAX) {
        return refused({ ok: false, kind: 'bad-request' });
      }
    }
  }
  const itemTitles: readonly string[] = (items as string[] | undefined) ?? [];
  // Routing spec 2026-09-14 §5.3: `undefined` is "the caller never asked", and stays `null` through every branch,
  // so the argv a run sends is byte-for-byte what it was before routing existed. No branch on `run.kind`: a review
  // run's SESSION is routed like any other (only the held-out panel it names is exempt).
  // D-6794: a dispatch that passes NO route (`undefined`) gets its run kind's row from the shared table; a route the
  // coordinator did pass, even an empty one, is never overridden.
  let routeFields: RouteFields | null = null;
  let routeDefaulted = false;
  if (route !== undefined) {
    const parsed = parseRouteFields(route);
    if (!parsed.ok) return refused({ ok: false, kind: 'bad-request', detail: routeParseDetail(parsed) });
    routeFields = routeFieldsOrNull(parsed.route);
  } else {
    routeFields = routeDefaultFor(run.kind);
    routeDefaulted = routeFields !== null;
  }
  // The coordinator may NAME the child a fresh spawn mints; a slug on a run that resumes its bound session names
  // nothing, so it is refused rather than silently dropped.
  let childSlug: string | null = null;
  if (slug !== undefined) {
    if (typeof slug !== 'string' || !WORKSPACE_SLUG_RE.test(slug)) {
      return refused({ ok: false, kind: 'bad-request', detail: 'slug: must match ' + WORKSPACE_SLUG_RE.source });
    }
    if (run.sessionId !== null) {
      return refused({ ok: false, kind: 'bad-request',
        detail: 'slug: this run resumes its bound session; a slug names a fresh spawn only' });
    }
    childSlug = slug;
  }
  // The complete hold is known from the persisted run. `openRun` checks it too; this seam rechecks authoritatively
  // because reconstructed or newer-database rows can bypass that ingress, and it must land before a fresh dispatch
  // can spawn a workspace.
  const hold = holdReasonVerdict(run.program, run.wave, run.waveOf, run.id);
  if (!hold.ok) return refused(hold);
  // The stored SESSION ID, re-checked for the hold's reason (spec §2.3): every id-taking call after this takes this
  // column. It runs after the body checks and before the pause listing, so a refused id costs no read.
  if (run.sessionId !== null && !isRegistryId(run.sessionId)) return refused({ ok: false, kind: 'bad-session' });
  return go({ run, body, itemTitles, routeFields, routeDefaulted, childSlug, hold });
}

// -- step: admit -------------------------------------------------------------------------------------------------

export interface AdmitFacts {
  step: 'admit';
  /** The registry directory's listing, or `null` when it could not be listed. */
  names: readonly string[] | null;
  /** Called only when neither marker refused. */
  caps: () => CapsReading;
}

function decideAdmit(f: AdmitFacts): DispatchDecision<null> {
  // 1: PAUSE / KILL-SWITCH FIRST. A directory that cannot be listed is a pause that cannot be ruled out: fail-shut.
  if (f.names === null || f.names.includes(COORDINATOR_PAUSE_MARKER)) {
    return refused({ ok: false, kind: 'refused', code: 'paused' });
  }
  // Refusing outright (rather than skipping the `/clear`) leaves the run `planned`, so the retry after the operator
  // lifts the marker is a genuinely fresh dispatch.
  if (f.names.includes(MAIL_DISABLED_MARKER)) return refused({ ok: false, kind: 'refused', code: 'mail-disabled' });
  // 2: caps. The refusal carries the numbers: a cap that refuses without saying what it is reads as a bug.
  const { caps, usage, overConcurrency } = f.caps();
  if (overConcurrency !== null) {
    // Fields spelled, not spread: coordinator-skill.test.ts harvests this frame's names.
    return refused({ ok: false, kind: 'refused', code: 'cap-concurrency',
      limit: overConcurrency.limit, running: overConcurrency.running });
  }
  if (usage.dispatchedIn24h >= caps.maxSessionsPerDay) {
    return refused({ ok: false, kind: 'refused', code: 'cap-daily',
      limit: caps.maxSessionsPerDay, used: usage.dispatchedIn24h });
  }
  return go(null);
}

// -- step: before ------------------------------------------------------------------------------------------------

export interface BeforeFacts { step: 'before'; read: RegistryRead }

/** The ids the registry held BEFORE the `ws-add`, REFUSED names included: the AFTER read refuses a refused name
 *  BEFORE did not list, so one that was already here must count as pre-existing or one stray file would refuse every
 *  dispatch. */
function decideBefore(f: BeforeFacts): DispatchDecision<ReadonlySet<string>> {
  // An unlistable registry refuses here (spec §2.3): tolerating it emptied `beforeIds`, one of the two measured
  // triggers for a false-new ADOPTION. Nothing has been spawned or stamped yet and the run stays `planned`.
  if (!f.read.listed) return refused({ ok: false, kind: 'registry-unmeasurable' });
  return go(new Set<string>([...f.read.records.map((r) => r.id), ...f.read.refused]));
}

// -- step: bind --------------------------------------------------------------------------------------------------

/** How the `ws-add` ended: `stderr` and the cut-short measurement are read only on a failure. */
export type SpawnEnding = { ok: true } | { ok: false; stderr: string; cutShort: ReturnType<typeof cutShort> };

export interface BindFacts {
  step: 'bind';
  project: string;
  childSlug: string | null;
  beforeIds: ReadonlySet<string>;
  after: RegistryRead;
  res: SpawnEnding;
}
export interface BindPlan {
  winner: SessionRecord;
  /** Adopted from a cut-short `ws-add`, not created by a clean one, so `ok` is NOT proof the pane is ready. */
  adopted: boolean;
  adoptedSpawn: SpawnVerdict | null;
}

function decideBind(f: BindFacts): DispatchDecision<BindPlan> {
  const { project, childSlug, beforeIds, after: afterRead, res } = f;
  // AFTER never tolerates degradation: the question is "is this NEW", the identity-by-subtraction this block
  // performs, and two drops could otherwise make an unrelated LIVE workspace the sole "new" candidate, which is
  // then bound, held and `/clear`ed. BEFORE answers "does this still exist" (tolerant); AFTER answers "is this new"
  // (never tolerant). A THIRD condition refuses here: a REFUSED name BEFORE did not list (listed, never read,
  // because it is not a registry id): subtraction cannot see it, so it is unmeasurable, never a guess.
  if (!afterRead.listed ||
      afterRead.records.some((r) => r.project === project && measuredIdentity(r) === null) ||
      [...afterRead.refused].some((x) => !beforeIds.has(x))) {
    // ccd's own words ride along when ccd ALSO failed. Present-or-absent, never `''`.
    return refused({ ok: false, kind: 'registry-unmeasurable', ...(res.ok ? {} : { stderr: res.stderr }) });
  }
  // A NAMED spawn has one acceptable identity, `<project>-<slug>` (ccd's id grammar): any other new row is a
  // stranger (an operator's racing `ws-add`) and is never bound in its place.
  const named = childSlug === null ? null : `${project}-${childSlug}`;
  const candidates = afterRead.records.filter((r) =>
    !beforeIds.has(r.id) && r.project === project && r.workspace !== null && (named === null || r.id === named));
  const ids = candidates.map((c) => c.id).join(',');
  if (candidates.length !== 1) {
    // Nothing is claimed on a guess: the run stays `planned`, no hold is placed, the operator resolves it.
    if (!res.ok) {
      const event = `dispatch-refused:${candidates.length === 0 ? 'fleetFailed' : 'ambiguous-dispatch'} candidates=${ids}`;
      // ccd failed AND left nothing new: no ambiguity to report, only a failure. `ambiguous-dispatch` means "the
      // ws-add worked and we cannot read the diff", which is a different sentence.
      if (candidates.length === 0) return refused({ ok: false, kind: 'fleetFailed', stderr: res.stderr }, event);
      return refused({ ok: false, kind: 'refused', code: 'ambiguous-dispatch', candidates: candidates.length }, event);
    }
    return refused({ ok: false, kind: 'refused', code: 'ambiguous-dispatch', candidates: candidates.length });
  }
  const winner = candidates[0]!;
  // §1.5: `!res.ok` no longer short-circuits before the diff. ADOPTION NEEDS POSITIVE EVIDENCE THAT THIS CANDIDATE
  // IS THE ONE THIS CALL CREATED: `cutShort === true` (the child was cut short in flight, not a ccd `die`; an
  // unmeasured ending does not adopt) AND `held === null` (fail-shut: a workspace a cut-short `ws-add` just made
  // never carries a hold, while a live coordinated worker always does). A decline is not silent: the run would sit
  // `planned` beside an unexplained new workspace, so the event names which ids appeared WITHOUT claiming them.
  if (!res.ok) {
    if (!(res.cutShort === true && winner.held === null)) {
      return refused({ ok: false, kind: 'fleetFailed', stderr: res.stderr }, `dispatch-refused:fleetFailed candidates=${ids}`);
    }
    return go({ winner, adopted: true, adoptedSpawn: spawnVerdict(winner.spawn === null ? null : winner.spawn.rc) });
  }
  return go({ winner, adopted: false, adoptedSpawn: null });
}

// -- step: resume ------------------------------------------------------------------------------------------------

export interface ResumeFacts {
  step: 'resume';
  project: string;
  sessionId: string;
  /** The run's own stored workspace and branch: the fallback when the registry row carries none. */
  runWorkspace: string | null;
  runBranch: string | null;
  /** The `ensure` (re)started the pane: its live file may not exist yet. */
  ensureStarted: boolean;
  registry: () => Promise<RegistryRead>;
  projectField: () => Promise<MeasuredRead>;
  hookState: (uuid: string) => Promise<HookStateRead>;
  turnVerdict: (rec: SessionRecord, uuid: string) => Promise<TurnVerdict>;
}
export interface ResumePlan {
  workspace: string | null;
  branch: string | null;
  /** The wrapper the session runs on, for the skill preflight. */
  wrapper: string | null;
  /** What the live gate measured, read again at the act. */
  liveGate: SpawnPollTarget;
}

async function decideResume(f: ResumeFacts): Promise<DispatchDecision<ResumePlan>> {
  const unmeasurable = refused({ ok: false, kind: 'registry-unmeasurable' });
  const registryRead = await f.registry();
  if (!registryRead.listed) return unmeasurable;
  // A session absent from a listable registry is TOLERATED here (the wrapper stays unmapped, the skill state
  // `unmeasurable`); a row whose identity is unmeasured is not.
  const record = registryRead.records.find((r) => r.id === f.sessionId);
  const recordIdentity = record !== undefined ? measuredIdentity(record) : null;
  if (record !== undefined && recordIdentity === null) return unmeasurable;
  if (record !== undefined) {
    // The guard reads `<id>.project` through `fieldMeasured` itself, never `record.project`, whose collapsing read
    // (`project ?? id`) would name a project nobody measured. Unreadable refuses; absent or empty compares nothing.
    const projectRead = await f.projectField();
    if (!projectRead.ok && projectRead.reason === 'unreadable') return unmeasurable;
    if (projectRead.ok && projectRead.content !== '' && projectRead.content !== f.project) {
      return refused({ ok: false, kind: 'refused', code: 'project-mismatch', by: projectRead.content });
    }
  }
  const workspace = record?.workspace ?? f.runWorkspace;
  const branch = record?.branch ?? f.runBranch;
  const wrapper = recordIdentity?.wrapper ?? null;
  // D-5238: the hook's `done` is necessary, no longer sufficient. A hook read this box could not take is its own
  // word; a hook that is not `done` is busy.
  const hs = recordIdentity ? await f.hookState(recordIdentity.uuid) : null;
  if (hs !== null && !hs.ok && hs.reason === 'unmeasured') {
    return refused({ ok: false, kind: 'refused', code: 'hookstate-unmeasurable' });
  }
  if (hs !== null && hs.ok && hs.state.state !== 'done') {
    return refused({ ok: false, kind: 'refused', code: 'worker-busy' });
  }
  // HONEST STALE: the run names a session whose row is absent from a LISTABLE registry (the tolerated case
  // `readRegistryMeasured` draws apart from an unlistable directory). Nothing is wrong with the read; the run row is
  // simply older than the fleet, so the answer is `status-unmeasurable` and says so by its arm. The identity test
  // is unreachable past the refusal above and only narrows the type.
  const statusUnmeasurable = { ok: false, kind: 'refused', code: 'status-unmeasurable' } as const;
  if (record === undefined) return { kind: 'stale', outcome: statusUnmeasurable };
  if (recordIdentity === null) return refused(statusUnmeasurable);
  const liveGate: SpawnPollTarget = { record, uuid: recordIdentity.uuid };
  const verdict = await f.turnVerdict(record, recordIdentity.uuid);
  if (verdict === 'busy') return refused({ ok: false, kind: 'refused', code: 'worker-busy' });
  if (verdict === 'unmeasured') {
    // Answered at once, with nothing after the `ensure` done: the route waits outside the mutex and re-decides.
    return f.ensureStarted
      ? refused({ ok: false, kind: 'worker-starting', poll: liveGate })
      : refused({ ok: false, kind: 'refused', code: 'status-unmeasurable' });
  }
  return go({ workspace, branch, wrapper, liveGate });
}

// -- step: act ---------------------------------------------------------------------------------------------------

export interface ActFacts {
  step: 'act';
  /** A bound session was resumed: the only dispatch that types a `/clear`. */
  resumed: boolean;
  /** What the resume gate measured; `null` on a fresh spawn. */
  liveGate: SpawnPollTarget | null;
  turnVerdict: (rec: SessionRecord, uuid: string) => Promise<TurnVerdict>;
}
export interface ActPlan {
  /** Type the `/clear` through the `sendClear` port. A fresh spawn types nothing (the zero-send-keys pin). */
  clear: boolean;
}

async function decideAct(f: ActFacts): Promise<DispatchDecision<ActPlan>> {
  if (!f.resumed) return go({ clear: false });
  // D-5238, AT THE ACT: the hold, its `ccdCan` and the route write sit between the resume gate and this keystroke,
  // so the verdict is read AGAIN immediately before the `/clear`. A change since the gate is STALE: the dispatch has
  // already placed its hold, so the answer is the honest one rather than a refusal as if nothing had been done.
  // `liveGate` is set on every path that reaches here with `resumed`.
  if (f.liveGate !== null) {
    const atAct = await f.turnVerdict(f.liveGate.record, f.liveGate.uuid);
    if (atAct === 'busy') return { kind: 'stale', outcome: { ok: false, kind: 'refused', code: 'worker-busy' } };
    if (atAct === 'unmeasured') {
      return { kind: 'stale', outcome: { ok: false, kind: 'refused', code: 'status-unmeasurable' } };
    }
  }
  return go({ clear: true });
}

// -- the one function --------------------------------------------------------------------------------------------

export type DispatchFacts = RequestFacts | AdmitFacts | BeforeFacts | BindFacts | ResumeFacts | ActFacts;

export function decideDispatch(f: RequestFacts): DispatchDecision<RequestPlan>;
export function decideDispatch(f: AdmitFacts): DispatchDecision<null>;
export function decideDispatch(f: BeforeFacts): DispatchDecision<ReadonlySet<string>>;
export function decideDispatch(f: BindFacts): DispatchDecision<BindPlan>;
export function decideDispatch(f: ResumeFacts): Promise<DispatchDecision<ResumePlan>>;
export function decideDispatch(f: ActFacts): Promise<DispatchDecision<ActPlan>>;
export function decideDispatch(f: DispatchFacts): unknown {
  switch (f.step) {
    case 'request': return decideRequest(f);
    case 'admit': return decideAdmit(f);
    case 'before': return decideBefore(f);
    case 'bind': return decideBind(f);
    case 'resume': return decideResume(f);
    case 'act': return decideAct(f);
    default: return f satisfies never;
  }
}
