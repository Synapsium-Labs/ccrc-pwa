// server/src/auto/fire.ts — L1. Task 6 ships the split precondition ladder
// (spec §7's nine rungs, spec §6's steps 3 and 5): `checkPreClaim` (rungs
// 1-2, before the lease claim) and `checkPostClaim` (rungs 3-9, after it).
// Task 7 extends this file with `fireAutomation`, `RunFacts`, the prompt
// retry ladder etc. (task-6-decisions.md C2.6/C2.7) — nothing below should
// need reshaping for that, only additions.
//
// Interface per .superpowers/sdd/2026-08-31-automations/task-6-decisions.md
// C2.2/C2.3 — THE BINDING CONTRACT for this task, which fixes four defects
// in the plan's own text (task-6-brief.md); see task-6-report.md.
import type { Tmux } from '../exec.js';
import { UNMEASURED } from '../exec.js';
import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { KeyedQueue } from '../inject/queue.js';
import { cutShort, listProjects } from '../lifecycle.js';
import { measuredIdentity, readRegistry, readRegistryMeasured } from '../registry.js';
import { CCD_ARGV, sweepDec } from '../ccdargv.js';
import { measured, projectHome, readLimits } from '../limits.js';
import { sendPrompt, type SendResult } from '../inject/send.js';
import { COORDINATOR_PAUSE_MARKER } from '../coord/rundefs.js';
import {
  AUTOMATION_FAILURE_CEILING, AUTOMATION_MAX_CONCURRENT, AUTOMATION_PRESSURE_CEILING,
  type AutomationOutcome, type AutomationRefusal, type AutomationStep, type Wrapper,
} from '../../../shared/api.js';
/**
 * Type-only, per task-6-decisions.md C2.2's own model ("`import type` for
 * `CoordStore`... `auto/` must hold no store handle"): these three are plain
 * type aliases the store already declares as the ground truth for what
 * `markAutomationSpawn`/`settleAutomationRun` accept and answer.
 * DEVIATION (task-7-report.md, ledger number pending Task 12): Task 6's own
 * `AutomationCoordPort` deviation note claimed this file "imports nothing
 * from coord/store.js at all, typed or otherwise" as a STRICTER reading of
 * the ring note. That reading is not load-bearing (the ring note's own
 * example imports `CoordStore` itself, a far bigger surface, the same way),
 * and re-declaring these three shapes locally is exactly the second
 * definition that produced the `automationsPaused()`/`inFlightAutomationRuns`
 * drift this task found and fixed (see the report): Task 6 guessed at
 * `CoordStore`'s real shape before Task 4 landed it, and the guess was
 * wrong twice. Importing the store's own types is *type-only* — it erases
 * at compile time, leaves no runtime import and no store handle — so it
 * keeps the ring property the note actually states while stopping this file
 * from re-guessing shapes the store already owns.
 */
import type { RunSettlement, SettledRun, SpawnIdentity, SpawnRecord } from '../coord/store.js';
import type { AutomationRow } from './schedulepolicy.js';

/**
 * L2 port, declared BY THIS CONSUMER (L2 ports are declared by the
 * consumer, per CLAUDE.md's ring rules) — NOT `import type { CoordStore }
 * from '../coord/store.js'` the way task-6-decisions.md C2.2/C2.3 literally
 * shows.
 *
 * DEVIATION (see task-6-report.md): the dispatch that assigned this task
 * said explicitly not to touch or depend on `server/src/coord/store.ts`,
 * which a parallel agent is editing concurrently, and to declare the store
 * interface this policy needs as an owned port instead. This narrow,
 * structural interface is that port. It is in fact a STRICTER reading of
 * the ring note's own goal ("`auto/` must hold no store handle") than a
 * `import type { CoordStore }` would be: this file imports nothing from
 * `coord/store.js` at all, typed or otherwise, so there is no store handle
 * to hold even by type. Once `store.ts` lands `inFlightAutomationRuns`/
 * `automationsPaused` (or equivalents), a later wiring task's `CoordStore`
 * only needs to satisfy this shape structurally for `FireDeps.coord` to
 * accept it — no edit to this file required.
 */
export interface AutomationCoordPort {
  /** Rung 2: `automation_runs` rows with `outcome='running'`, EXCLUDING the
   *  row this sweep is about to open — counted BEFORE the claim, which is
   *  why this is a live count rather than a number the caller hands in
   *  (spec §7: "counted after the claim it would include this run's own
   *  running row, so a ceiling of 2 would admit 1").
   *
   *  DEVIATION (task-7-report.md, ledger number pending Task 12): named and shaped
   *  `inFlightAutomationRunCount(now)`, not the contract snippet's
   *  `inFlightAutomationRuns()` — `server/src/coord/store.ts:3505`'s real,
   *  already-committed method JOINS the parent and counts only LIVE leases
   *  (`COALESCE(a.leaseHardUntil, 0) > now`), which needs a clock, and a
   *  structural port that does not match the store's own method by name
   *  could never be satisfied by `coord: store` at the real wiring site. */
  inFlightAutomationRunCount(now: number): number;
  /** Rung 4: `automations_state.paused` — a ROW, not a file (spec §7 argues
   *  why: the server cannot write to `$REG`).
   *
   *  DEVIATION (task-7-report.md, ledger number pending Task 12): the real
   *  `automationsPaused()` (`store.ts:3513`) answers `{paused, updatedAt}`,
   *  not a bare `boolean` — the contract snippet guessed at a shape Task 4
   *  had not landed yet. Every caller here reads `.paused`. */
  automationsPaused(): { paused: boolean; updatedAt: number };
  /** Written the MOMENT rung 8's forecast is measured, before the spawn —
   *  `store.ts:3426`'s own docstring. `null` is UNMEASURED, never 0. */
  markRunHomeScore(runId: number, homeScore: number | null): void;
  /** The spawn's whole result — `store.ts:3435`'s `markAutomationSpawn`,
   *  written the MOMENT identification succeeds, never at settle (a process
   *  that dies during the prompt ladder must not lose the record that a
   *  session WAS created). */
  markAutomationSpawn(input: SpawnRecord): void;
  /** `store.ts:3449`'s `settleAutomationRun` — closes a leased run, applies
   *  the failure ladder and releases the lease, all inside the store's own
   *  `tx()`. */
  settleAutomationRun(input: {
    readonly runId: number; readonly settlement: RunSettlement; readonly now: number;
  }): SettledRun | { refused: 'unknown-run' } | { refused: 'already-settled'; outcome: AutomationOutcome };
  /** `store.ts:3458` — one `automation_run_events` row per numbered step
   *  (spec §6's own sentence: "that trail IS the log"). */
  appendRunEvent(runId: number, step: AutomationStep, ok: boolean, detail: string, now: number): void;
  /** `store.ts:3282` — moves ONLY the SOFT bound, never the hard one, and
   *  takes NO duration: the store owns the lease arithmetic, not the caller
   *  (a further correction over task-6-decisions.md C2.9's stale
   *  three-argument call shape, written before this method landed). */
  renewAutomationLease(automationId: number, now: number): boolean;
}

/** Rungs 1-2. Their row is opened UN-LEASED (`openUnleasedRun`), outside
 *  the claim. */
export type PreClaimRefusal = Extract<AutomationRefusal, 'overlap' | 'cap-concurrency'>;
/** Rungs 3-9. Their row is the LEASED one: settle it `refused` and release
 *  the lease. */
export type PostClaimRefusal = Extract<AutomationRefusal,
  | 'registry-unmeasurable' | 'automations-paused' | 'coordinator-paused'
  | 'unknown-project' | 'no-placeable-account' | 'account-pressed' | 'failure-ceiling'>;

/** Mechanism, not a promise (`agent/src/whitelist.ts:156-170`'s idiom):
 *  `PreClaimRefusal` while the two halves stay disjoint, `never` the instant
 *  a code is added to both. */
type ProvenPreClaim = [Extract<PreClaimRefusal, PostClaimRefusal>] extends [never]
  ? PreClaimRefusal : never;

const PRE_CLAIM_REFUSAL_MAP: Record<PreClaimRefusal, true> = {
  overlap: true, 'cap-concurrency': true,
};
/**
 * DEVIATION from task-6-decisions.md C2.2's literal text (see
 * task-6-report.md): that snippet casts straight to `ProvenPreClaim[]`
 * (`Object.keys(PRE_CLAIM_REFUSAL_MAP) as ProvenPreClaim[]`), which does
 * NOT catch the mutation it claims to — verified empirically:
 * `string[] as never[]` typechecks either way, so a cast landing directly on
 * the proven-typed export is not "a live constant [whose] tidy-up cannot
 * delete" the proof; it silently accepts `never[]` and moves on. The
 * verified-working precedent (`agent/src/whitelist.ts:169`,
 * `GRANTABLE_COMMANDS: readonly ProvenGrantable[] = EXEC_COMMANDS`) instead
 * assigns an UNPROVEN-typed value with NO further cast to the proven-typed
 * export, so plain assignability is checked — and DOES red with TS2322 the
 * instant the two refusal alphabets stop being disjoint (mutation table row
 * "replacement for (vii)", task-6-report.md). This mirrors that shape.
 */
const PRE_CLAIM_REFUSAL_LIST = Object.keys(PRE_CLAIM_REFUSAL_MAP) as PreClaimRefusal[];
/** LIVE, not a dead type-test: the un-leased writer's own allow-list, and
 *  this file's totality fixture's source of truth. Derived, never
 *  hand-written (GC 13; `PR_REASONS`, `shared/api.ts:371`, is the spelling). */
export const PRE_CLAIM_REFUSALS: readonly ProvenPreClaim[] = PRE_CLAIM_REFUSAL_LIST;

const POST_CLAIM_REFUSAL_MAP: Record<PostClaimRefusal, true> = {
  'registry-unmeasurable': true, 'automations-paused': true, 'coordinator-paused': true,
  'unknown-project': true, 'no-placeable-account': true, 'account-pressed': true,
  'failure-ceiling': true,
};
/** Symmetric with `PRE_CLAIM_REFUSALS` — GC 13, and this file's totality
 *  fixture needs a derived (not hand-written) post-claim list too. Not shown
 *  in task-6-decisions.md's C2.2 snippet, added here because Task 6 Step 1
 *  requires a totality fixture over BOTH halves of the ladder. */
export const POST_CLAIM_REFUSALS: readonly PostClaimRefusal[] =
  Object.keys(POST_CLAIM_REFUSAL_MAP) as PostClaimRefusal[];

export type PreClaimVerdict =
  | { readonly ok: true }
  | { readonly refused: PreClaimRefusal; readonly detail: string };

export type PostClaimVerdict =
  | { readonly ok: true;
      /** The account-pressure FORECAST at fire time. `null` = UNMEASURED
       *  (`limits.ts:40`'s rule), never `0` — `limits.ts:106`'s literal
       *  `score: 0` fallback is exactly the collapse rung 8 exists to undo. */
      readonly homeScore: number | null;
      readonly projectedWrapper: Wrapper }
  | { readonly refused: PostClaimRefusal; readonly detail: string };

/**
 * Consumer-declared (L2). Byte-comparable with the real `DispatchRunDeps`
 * (`server/src/coord/dispatch.ts:56-78`) MINUS `configDir` (task-6-decisions
 * .md C2.3 — that member's only consumer is the worker-skill preflight, and
 * an automation runs none) and MINUS the literal `CoordStore` type on
 * `coord` (see the `AutomationCoordPort` deviation note above).
 */
export interface FireDeps {
  coord: AutomationCoordPort;
  io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState;
  tmux: Tmux; queue: KeyedQueue;
}

/** Rungs 1-2. SYNCHRONOUS — both read `coord.db` only (through the port),
 *  and making that structural is the point: a pre-claim rung that awaited
 *  anything would widen the window between the overlap read and the CAS. */
export function checkPreClaim(
  deps: Pick<FireDeps, 'coord'>,
  a: Pick<AutomationRow, 'id' | 'leaseUntil'>,
  nowMs: number,
): PreClaimVerdict {
  // Rung 1: the lease predicate is the SOFT bound for overlap (renewal moves
  // `leaseUntil`, never `leaseHardUntil` — `claims.ts:177-193`'s model). A
  // leased row is re-selected by `dueAutomations` on every sweep; refusing
  // it without attempting a write is the whole point — this rung is not
  // dead even though the in-tx() CAS re-answers the same code on the race.
  if (a.leaseUntil !== null && nowMs < a.leaseUntil) {
    return { refused: 'overlap', detail: `automation ${a.id} is already leased until ${a.leaseUntil}` };
  }
  // Rung 2: counted through `deps.coord`, never a caller-supplied number —
  // handing it in is precisely how it would get counted after the claim.
  const inFlight = deps.coord.inFlightAutomationRunCount(nowMs);
  if (inFlight >= AUTOMATION_MAX_CONCURRENT) {
    return {
      refused: 'cap-concurrency',
      detail: `${inFlight} automation runs already in flight, ceiling ${AUTOMATION_MAX_CONCURRENT}`,
    };
  }
  return { ok: true };
}

/** Rungs 3-9, in spec §7's order. */
export async function checkPostClaim(
  deps: FireDeps,
  a: Pick<AutomationRow, 'id' | 'project' | 'consecutiveFailures'>,
  nowMs: number,
): Promise<PostClaimVerdict> {
  // Rungs 3 and 5 are ONE readdir (`dispatch.ts:222-226`'s idiom) and fail
  // shut on 3 — a directory we cannot list is a pause we cannot rule out —
  // but answer DIFFERENT codes: at 07:05, "I paused the fleet" and "the box
  // is unreachable" are different sentences with different fixes.
  const names = await deps.io.readdir(deps.cfg.registryDir);
  if (names === null) {
    return { refused: 'registry-unmeasurable', detail: `${deps.cfg.registryDir} is not listable` };
  }
  // Rung 4: the global switch, a ROW.
  if (deps.coord.automationsPaused().paused) {
    return { refused: 'automations-paused', detail: 'the automations lane is paused' };
  }
  // Rung 5: the SAME listing as rung 3.
  if (names.includes(COORDINATOR_PAUSE_MARKER)) {
    return {
      refused: 'coordinator-paused',
      detail: `${COORDINATOR_PAUSE_MARKER} is present in ${deps.cfg.registryDir}`,
    };
  }
  // Rung 6 fails OPEN, deliberately: it refuses only on POSITIVE evidence of
  // absence — a listable projects root (probed here, independently of
  // `listProjects`'s own internal read of the same path, precisely so an
  // UNLISTABLE root can be told apart from a listable-but-empty one) and the
  // registry already proven listable above, between them not naming the
  // project. An unmeasurable projects root PROCEEDS: ccd is the authority
  // for a project name, and being wrong here costs one `spawn-refused` row,
  // not a workspace.
  const projectsRootNames = await deps.io.readdir(deps.cfg.projectsRoot);
  if (projectsRootNames !== null) {
    const { projects } = await listProjects(deps.io, deps.cfg);
    if (!projects.some((p) => p.name === a.project)) {
      return { refused: 'unknown-project', detail: `project ${a.project} is not known to this fleet` };
    }
  }
  // Rungs 7-8 share one `readLimits` — the clock rides the THIRD argument
  // ALWAYS, so this stays clock-free (limits.ts:110-114's rollover rule).
  const limits = await readLimits(deps.io, deps.cfg, Math.floor(nowMs / 1000));
  const projected = projectHome(deps.cfg.roster, limits);
  if (projected === null) {
    return { refused: 'no-placeable-account', detail: 'no home-able account is available' };
  }
  // Rung 8: `measured()`, never `projected.score` — `projectHome`'s
  // all-unmeasured fallback returns a literal `score: 0`, exactly the
  // collapse this rung exists to undo. `null` is UNMEASURED and proceeds;
  // rung 8 does not fail shut.
  const homeScore = measured(limits[projected.wrapper]);
  if (homeScore !== null && homeScore >= AUTOMATION_PRESSURE_CEILING) {
    return {
      refused: 'account-pressed',
      detail: `${projected.wrapper} measured ${homeScore}, ceiling ${AUTOMATION_PRESSURE_CEILING}`,
    };
  }
  // Rung 9.
  if (a.consecutiveFailures >= AUTOMATION_FAILURE_CEILING) {
    return {
      refused: 'failure-ceiling',
      detail: `${a.consecutiveFailures} consecutive failures, ceiling ${AUTOMATION_FAILURE_CEILING}`,
    };
  }
  return { ok: true, homeScore, projectedWrapper: projected.wrapper };
}

/* ============================================================================
 * Task 7 — the act: spawn, identify by diff, adopt honestly, prompt.
 * task-6-decisions.md C2.6/C2.7, spec §6 steps 6-10. `checkPostClaim` above
 * runs exactly once, inside `fireAutomation`, for both doors (spec §6 step
 * 5's own sentence) — Run-now (Task 9) calls `fireAutomation` directly and
 * never duplicates rungs 3-9.
 * ==========================================================================*/

/**
 * DEVIATION (task-7-report.md, ledger number pending Task 12):
 * task-6-decisions.md C2.7 places these three in `shared/api.ts`'s Task-2 cap
 * block, alongside `AUTOMATION_FAILURE_CEILING` etc. They are not there —
 * `shared/api.ts` is not on this task's file list (only `server/src/auto/
 * fire.ts`), and a parallel agent owns files that may touch it concurrently.
 * Local, exactly as `schedulepolicy.ts`'s own `AUTOMATION_PUNCTUAL_MS`
 * deviation already does for the identical reason. Values verbatim from the
 * contract.
 */
export const AUTOMATION_PROMPT_MAX_ATTEMPTS = 6;
export const AUTOMATION_PROMPT_BACKOFF_BASE_MS = 30_000;
export const AUTOMATION_PROMPT_BACKOFF_MAX_MS = 240_000;

/** Every producer-written column of `automation_runs`, built in one place so
 *  no caller invents a value (task-6-decisions.md C2.6). All four identity
 *  fields null = no session was created. */
export interface RunFacts {
  readonly sessionId: string | null;
  readonly workspace: string | null;
  readonly branch: string | null;
  readonly wrapper: Wrapper | null;
  /** From `checkPostClaim`. NULL = UNMEASURED, never 0 (`limits.ts:40`). */
  readonly homeScore: number | null;
  /** The registry row's own `.spawn` rc, read as `winner.spawn?.rc ?? null`.
   *  NEVER `?? 0`: `CcdResult` (`lifecycle.ts:21-25`) carries no rc at all,
   *  so 0 here would be a number nobody measured. */
  readonly spawnRc: number | null;
  readonly adopted: boolean;
}

const NO_RUN_FACTS: RunFacts = {
  sessionId: null, workspace: null, branch: null, wrapper: null,
  homeScore: null, spawnRc: null, adopted: false,
};

export type SpawnRefusal = Extract<AutomationRefusal,
  'registry-unmeasurable' | 'spawn-refused' | 'spawn-cut-short' | 'spawn-unmeasured' | 'spawn-ambiguous'>;

/** Four arms because the caller does four different things. */
export type FireOutcome =
  | { readonly settle: 'ok'; readonly facts: RunFacts }
  | { readonly settle: 'refused'; readonly refusal: PostClaimRefusal | SpawnRefusal;
      readonly detail: string; readonly facts: RunFacts }
  | { readonly settle: 'failed'; readonly refusal: Extract<AutomationRefusal, 'prompt-refused'>;
      readonly detail: string; readonly facts: RunFacts }
  /** The prompt ladder is live: leave the run `running`, renew the SOFT
   *  lease, come back. Writes nothing terminal. */
  | { readonly pending: 'prompt'; readonly facts: RunFacts;
      readonly attempts: number; readonly nextAttemptAt: number; readonly detail: string };

/** Derived from `send.ts`'s own union — never re-spelled (single-definition).
 *  Six members: not-alive | dialog-open | draft-present | draft-clear-failed
 *  | verify-failed | enter-ignored (`inject/send.ts:15-18`). */
export type SendPromptError = Extract<SendResult, { ok: false }>['error'];

/** `Math.min(BASE * 2 ** (attempt - 1), MAX)` — `watch.ts:2469`'s exact
 *  arithmetic, one backoff shape across the watcher. `attempt` is 1-based
 *  and is the attempt just MADE. */
export function promptBackoffMs(attempt: number): number {
  return Math.min(AUTOMATION_PROMPT_BACKOFF_BASE_MS * 2 ** (attempt - 1), AUTOMATION_PROMPT_BACKOFF_MAX_MS);
}

/** Where the attempt counter lives: not a column, the durable `prompt` step
 *  trail itself (task-6-decisions.md C2.7's own words — "recorded as
 *  `prompt` steps"), so the ladder's state survives a restart and cannot
 *  disagree with the history the operator reads. */
export function promptAttempts(
  events: readonly { readonly step: AutomationStep; readonly ok: boolean }[],
): number {
  return events.filter((e) => e.step === 'prompt' && !e.ok).length;
}

export type PromptLadderState =
  | { readonly due: true; readonly attempts: number }
  | { readonly waiting: true; readonly attempts: number; readonly nextAttemptAt: number }
  | { readonly exhausted: true; readonly attempts: number };

/** Pure. `nextAttemptAt = lastFailedPromptStep.at + promptBackoffMs(attempts)`.
 *  Read by a LATER sweep (Task 8), over a run's own accumulated `prompt`
 *  steps, to decide whether attempt 2..N is due yet. */
export function promptLadder(
  events: readonly { readonly step: AutomationStep; readonly ok: boolean; readonly at: number }[],
  nowMs: number,
): PromptLadderState {
  const failed = events.filter((e) => e.step === 'prompt' && !e.ok);
  const attempts = failed.length;
  if (attempts >= AUTOMATION_PROMPT_MAX_ATTEMPTS) return { exhausted: true, attempts };
  if (attempts === 0) return { due: true, attempts };
  const last = failed[failed.length - 1]!;
  const nextAttemptAt = last.at + promptBackoffMs(attempts);
  return nowMs >= nextAttemptAt ? { due: true, attempts } : { waiting: true, attempts, nextAttemptAt };
}

export type PromptAttempt =
  | { readonly landed: true; readonly attempts: number }
  | { readonly retry: true; readonly attempts: number; readonly nextAttemptAt: number;
      readonly error: SendPromptError; readonly detail: string }
  | { readonly exhausted: true; readonly attempts: number;
      readonly error: SendPromptError; readonly detail: string };

/** ONE attempt, through the process-wide `KeyedQueue`, `sendPrompt({tmux,
 *  queue}, …)` (`dispatch.ts:533`'s call shape) and NEVER with
 *  the draft-replacing send option (GC 10). Used by `fireAutomation` for attempt 1 and by a
 *  later sweep (Task 8) for attempts 2..N. All six `SendResult` errors
 *  retry; only the ceiling makes any of them terminal — inventing a
 *  terminal/transient taxonomy the spec did not write would be a second
 *  policy to keep in step (task-6-decisions.md C2.7). */
export async function deliverPrompt(
  deps: Pick<FireDeps, 'tmux' | 'queue'>,
  sessionId: string, prompt: string, priorAttempts: number, nowMs: number,
): Promise<PromptAttempt> {
  const res = await sendPrompt({ tmux: deps.tmux, queue: deps.queue }, sessionId, prompt);
  const attempts = priorAttempts + 1;
  if (res.ok) return { landed: true, attempts };
  const detail = `attempt ${attempts} of ${AUTOMATION_PROMPT_MAX_ATTEMPTS}: ${res.error}`;
  if (attempts >= AUTOMATION_PROMPT_MAX_ATTEMPTS) {
    return { exhausted: true, attempts, error: res.error, detail };
  }
  return { retry: true, attempts, nextAttemptAt: nowMs + promptBackoffMs(attempts), error: res.error, detail };
}

/** The un-bound refusal shapes share one shape: an `identify` step naming
 *  what happened, the spawn fact recorded UNBOUND (`identity: {bound:
 *  false}` — never silently dropped, spec §6's orphan-manufacture rule),
 *  the settle, and the `close` step. */
function refuseSpawn(
  deps: FireDeps, runId: number, nowMs: number,
  refusal: SpawnRefusal, detail: string, spawnRc: number | null,
): FireOutcome {
  deps.coord.markAutomationSpawn({ runId, spawnRc, identity: { bound: false } });
  deps.coord.appendRunEvent(runId, 'identify', false, detail, nowMs);
  deps.coord.settleAutomationRun({ runId, settlement: { outcome: 'refused', refusal }, now: nowMs });
  deps.coord.appendRunEvent(runId, 'close', false, `settled refused:${refusal}`, nowMs);
  return { settle: 'refused', refusal, detail, facts: NO_RUN_FACTS };
}

/**
 * `fireAutomation(deps, automation, runId, nowMs)` — spec §6 steps 5-10, for
 * an already-open (leased or manual) `runId`. Calls `checkPostClaim` itself,
 * so rungs 3-9 run exactly once, in one place, for both doors (the sweep,
 * via `claimAndOpenRun`, and Run-now/Task 9, directly). Writes its own step
 * rows through `deps.coord.appendRunEvent` — `dispatch.ts:368`'s precedent
 * for an L1 decision recording its own events through the store port.
 *
 * Four things copied from `dispatch.ts` rather than reinvented (task-7-brief
 * .md): the `CCD_ARGV.wsAddAuto` call with the actor dec, the BEFORE
 * (tolerant)/AFTER (intolerant) registry-diff asymmetry, the adoption gate
 * (`cutShort(res) === true && winner.held === null` — ONLY a literal `true`
 * adopts), and `sendPrompt` through the shared `KeyedQueue`, NEVER with
 * the draft-replacing send option. Never parses ccd's stdout; never recomputes
 * `<wrapper>-<project>` (D-291) — the session id and wrapper come off the
 * registry row `readRegistryMeasured` proved fully measured.
 */
export async function fireAutomation(
  deps: FireDeps, a: AutomationRow, runId: number, nowMs: number,
): Promise<FireOutcome> {
  // Rungs 3-9, in spec §7's order, exactly once.
  const verdict = await checkPostClaim(deps, a, nowMs);
  if ('refused' in verdict) {
    deps.coord.appendRunEvent(runId, 'precheck', false, verdict.detail, nowMs);
    deps.coord.settleAutomationRun({
      runId, settlement: { outcome: 'refused', refusal: verdict.refused }, now: nowMs,
    });
    deps.coord.appendRunEvent(runId, 'close', false, `settled refused:${verdict.refused}`, nowMs);
    return { settle: 'refused', refusal: verdict.refused, detail: verdict.detail, facts: NO_RUN_FACTS };
  }
  const { homeScore, projectedWrapper } = verdict;
  // Written the MOMENT it is measured, before the spawn (rung 8's forecast).
  deps.coord.markRunHomeScore(runId, homeScore);
  deps.coord.appendRunEvent(
    runId, 'precheck', true,
    `placed on ${projectedWrapper}, homeScore ${homeScore === null ? 'unmeasured' : String(homeScore)}`,
    nowMs,
  );

  // Step 6: spawn. BEFORE tolerates degradation (the question is "does this
  // still exist"); AFTER, below, never does (the question is "is this NEW").
  const before = await readRegistry(deps.io, deps.cfg);
  const beforeIds = new Set(before.map((r) => r.id));
  const argv = CCD_ARGV.wsAddAuto(a.project, sweepDec(deps.fleetState, `auto:${a.id} fire`));
  const res = await deps.runCcd(argv);
  deps.coord.appendRunEvent(
    runId, 'spawn', res.ok, res.ok ? 'ws-add ok' : `ws-add failed${res.stderr ? `: ${res.stderr}` : ''}`, nowMs,
  );

  // Step 7: identify by registry diff — NEVER by parsing ccd's stdout, and
  // NEVER by recomputing `<wrapper>-<project>` (D-291).
  const afterRead = await readRegistryMeasured(deps.io, deps.cfg);
  if (!afterRead.listed ||
      afterRead.records.some((r) => r.project === a.project && measuredIdentity(r) === null)) {
    return refuseSpawn(
      deps, runId, nowMs, 'registry-unmeasurable',
      `${deps.cfg.registryDir} could not be measured after the spawn`, null,
    );
  }
  const after = afterRead.records;
  const candidates = after.filter((r) =>
    !beforeIds.has(r.id) && r.project === a.project && r.workspace !== null);

  if (candidates.length !== 1) {
    if (!res.ok && candidates.length === 0) {
      return refuseSpawn(
        deps, runId, nowMs, 'spawn-refused',
        `ccd refused; no new workspace for ${a.project}${res.stderr ? `: ${res.stderr}` : ''}`, null,
      );
    }
    return refuseSpawn(
      deps, runId, nowMs, 'spawn-ambiguous',
      `${candidates.length} new candidate workspaces for ${a.project}` +
      (candidates.length > 0 ? `: ${candidates.map((c) => c.id).join(',')}` : ''),
      null,
    );
  }

  // Step 8: the adoption gate, verbatim from dispatch §1.5. ONLY a literal
  // `true` may adopt; `UNMEASURED` and a clean non-zero rc both decline.
  const winner = candidates[0]!;
  const winnerSpawnRc = winner.spawn?.rc ?? null;
  let adopted = false;
  if (!res.ok) {
    const cs = cutShort(res);
    if (cs === true && winner.held === null) {
      adopted = true;
    } else if (cs === true) {
      return refuseSpawn(
        deps, runId, nowMs, 'spawn-cut-short',
        `ws-add was cut short; candidate ${winner.id} is already held`, winnerSpawnRc,
      );
    } else if (cs === UNMEASURED) {
      return refuseSpawn(
        deps, runId, nowMs, 'spawn-unmeasured',
        `the spawn transport dropped; cannot tell refused from cut short (candidate ${winner.id})`, winnerSpawnRc,
      );
    } else {
      return refuseSpawn(
        deps, runId, nowMs, 'spawn-refused',
        `ccd refused${res.stderr ? `: ${res.stderr}` : ''} (candidate ${winner.id} not created by this call)`,
        winnerSpawnRc,
      );
    }
  }

  const identity: SpawnIdentity = {
    bound: true, sessionId: winner.id, workspace: winner.workspace, branch: winner.branch,
    wrapper: winner.wrapper, adopted,
  };
  deps.coord.markAutomationSpawn({ runId, spawnRc: winnerSpawnRc, identity });
  deps.coord.appendRunEvent(runId, 'identify', true, `bound ${winner.id}${adopted ? ' (adopted)' : ''}`, nowMs);

  const facts: RunFacts = {
    sessionId: winner.id, workspace: winner.workspace, branch: winner.branch,
    wrapper: winner.wrapper, homeScore, spawnRc: winnerSpawnRc, adopted,
  };

  // Step 9: prompt — direct `sendPrompt`, NEVER the draft-replacing send option (GC 10),
  // through the bounded retry ladder (task-6-decisions.md C2.7 — the
  // spec's own decision, restored over the plan's "settle failed on
  // draft-present", which would make a pane ninety seconds old's transient
  // `draft-present` a PERMANENT failure and count it toward the ceiling).
  const attempt = await deliverPrompt(deps, winner.id, a.prompt, 0, nowMs);
  deps.coord.appendRunEvent(
    runId, 'prompt', 'landed' in attempt,
    'landed' in attempt ? `attempt ${attempt.attempts}: landed` : attempt.detail,
    nowMs,
  );

  if ('landed' in attempt) {
    // Step 10: close.
    deps.coord.settleAutomationRun({ runId, settlement: { outcome: 'ok' }, now: nowMs });
    deps.coord.appendRunEvent(runId, 'close', true, 'settled ok', nowMs);
    return { settle: 'ok', facts };
  }
  if ('retry' in attempt) {
    // The ladder is live: write nothing terminal, renew the SOFT lease.
    deps.coord.renewAutomationLease(a.id, nowMs);
    return {
      pending: 'prompt', facts, attempts: attempt.attempts,
      nextAttemptAt: attempt.nextAttemptAt, detail: attempt.detail,
    };
  }
  // `exhausted` — UNREACHABLE from this call (`priorAttempts` is always 0
  // here, so `attempts` is always 1 < `AUTOMATION_PROMPT_MAX_ATTEMPTS`),
  // kept because `PromptAttempt` is a three-arm union TypeScript requires
  // handled in full. A LATER sweep (Task 8) reaches this arm through
  // `promptLadder` over the run's own accumulated `prompt` steps. Spec §6's
  // own sentence: "The operator gets a live session with no prompt in it,
  // which is strictly better than a lie" — `sessionId` stays SET.
  deps.coord.settleAutomationRun({
    runId, settlement: { outcome: 'failed', refusal: 'prompt-refused' }, now: nowMs,
  });
  deps.coord.appendRunEvent(runId, 'close', false, 'settled failed:prompt-refused', nowMs);
  return { settle: 'failed', refusal: 'prompt-refused', detail: attempt.detail, facts };
}
