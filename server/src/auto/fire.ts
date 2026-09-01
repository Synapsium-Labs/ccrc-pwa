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
import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { KeyedQueue } from '../inject/queue.js';
import { listProjects } from '../lifecycle.js';
import { measured, projectHome, readLimits } from '../limits.js';
import { COORDINATOR_PAUSE_MARKER } from '../coord/rundefs.js';
import {
  AUTOMATION_FAILURE_CEILING, AUTOMATION_MAX_CONCURRENT, AUTOMATION_PRESSURE_CEILING,
  type AutomationRefusal, type Wrapper,
} from '../../../shared/api.js';
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
   *  running row, so a ceiling of 2 would admit 1"). */
  inFlightAutomationRuns(): number;
  /** Rung 4: `automations_state.paused` — a ROW, not a file (spec §7 argues
   *  why: the server cannot write to `$REG`). */
  automationsPaused(): boolean;
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
  const inFlight = deps.coord.inFlightAutomationRuns();
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
  if (deps.coord.automationsPaused()) {
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
