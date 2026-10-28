import type { FleetSession } from '../../shared/api.js';
import { STOP_DONE_PARKED_STATES, type StopDoneHeldKind } from './stopDone.js';

/**
 * SHED A SLEEPING SESSION'S DEPENDENCIES (D-7278; the operator's A1 ruling of 2026-10-28, extended to coordinators;
 * design note `docs/superpowers/plans/2026-10-28-worktree-leak-design.md` §4): the pure rule.
 *
 * A finished worker's worktree stays on disk while its session sleeps, kept for its programme by child reclaim (D-7279),
 * and about 1 GB of it is `node_modules` that `npm ci` rebuilds. A sleeping coordinator's worktree is never reclaimed
 * (rule 4), and holds the same. The operator ruled: ccrc may remove the git-ignored, untracked dependency directories of
 * a sleeping session whose work is finished past a configurable age, workers AND coordinators, and keep everything git
 * knows about. The box re-proves every fact it can see at the act (`ccd ws-shed-deps`, `ccd/lib/disk-retention.sh`).
 *
 * THE TWO CLASSES. The store's coordinator claims decide (`childReclaimCoordinatorClaims`, folded by the pass into
 * `DepsShedChair`). A chair on an open run, or one with no readable instant, keeps the row. A child that never held a
 * chair in its own generation is a WORKER (`child`): its newest placed run must be `done` or `failed`, closed at least
 * the age ago; a run parked at review, merge or close counts only once the parked age is configured (A4, unset by
 * default), on the sleep's own instant, because a parked run has no close. Any other row that held a chair (a non-child,
 * or a child that coordinated in its own generation) is a COORDINATOR: the latest instant it held one must be at least
 * the age ago. A non-child that never held a chair is the operator's own workspace and is never shed.
 *
 * Every read the pass could not make HOLDS. L1: decisions only, over what the pass (`depsShedPass.ts`, L4) read. It
 * imports L0 and `stopDone.ts`'s vocabulary alone.
 */

/** Every reason the arm leaves a row's dependencies alone this pass — a `Record`, so the list is derived and a word
 *  cannot be added without its meaning. Asked again every pass; none is terminal. */
const DEPS_SHED_HOLD_MAP = {
  'not-a-workspace': 'a project\'s main checkout: its dependencies are the operator\'s',
  archived: 'archived: the expiry lane owns an archived workspace',
  awake: 'no stop stamp: the session is not asleep',
  unmeasured: 'its identity or its status was not measured',
  'child-unreadable': 'the child marker could not be read',
  'no-verb': 'this box\'s ccd does not list `ws-shed-deps` (`shed-deps-v1`)',
  'opted-out': 'the operator opted it out (`$REG/<id>.no-hibernate`)',
  held: 'a hold stands that guards more than the workspace: the operator\'s own text, or one naming a run that is open or unreadable',
  viewer: 'somebody has it open (on screen or in a hidden tab), or the server started too recently to know',
  'stamp-unreadable': 'its shed stamp (`$REG/<id>.depsshed`) stands but could not be read',
  shed: 'its dependencies were already removed during this sleep',
  'runs-unreadable': 'the coordination store could not answer its runs or claims',
  'claims-open-run': 'it claims a run that is not terminal (it coordinates now)',
  'claim-unplaced': 'it held a chair whose instant cannot be read',
  'run-worker': 'an active run names it as worker',
  claim: 'it holds a live claim',
  'no-run': 'a worker no placed run names',
  'not-done': 'a worker whose newest placed run is not finished: neither `done` nor `failed` (nor parked, when the parked age is set)',
  'close-unplaced': 'a worker whose newest placed run reads finished with no close time',
  'too-recent': 'its work finished less than the age ago',
  'not-coordinated': 'not a dispatched child and never held a chair: the operator\'s own workspace',
} as const satisfies Record<string, string>;

export type DepsShedHold = keyof typeof DEPS_SHED_HOLD_MAP;
export const DEPS_SHED_HOLDS: readonly DepsShedHold[] = Object.keys(DEPS_SHED_HOLD_MAP) as DepsShedHold[];
export function depsShedHoldText(h: DepsShedHold): string { return DEPS_SHED_HOLD_MAP[h]; }

/** The two classes the box is told, and re-proves (`--class`): a worker sheds as `child` (the box requires its child
 *  marker), a coordinator as `coordinator`. */
export const DEPS_SHED_CLASSES = ['child', 'coordinator'] as const;
export type DepsShedClass = (typeof DEPS_SHED_CLASSES)[number];

/** The actor the arm's act declares (`sweepDec`), as every unattended server lane names itself. */
export const DEPS_SHED_ACTOR = 'sweep:deps-shed';

/** After an ask the box refused or that failed, the arm does not ask about that row again for this long; each further
 *  refusal in the same sleep doubles it, up to `DEPS_SHED_RETRY_MAX_MS`. In memory only: a restart asks once more. */
export const DEPS_SHED_RETRY_MS = 60 * 60_000;
/** The ceiling of that doubling: a row that keeps refusing is asked at most once a day for the rest of its sleep. */
export const DEPS_SHED_RETRY_MAX_MS = 24 * 60 * 60_000;
/** The box's refusals that stay true for the whole sleep: the arm does not ask that row again until it sleeps anew. */
export const DEPS_SHED_FINAL_REFUSALS: readonly string[] = ['nothing-to-shed', 'already-shed'];

/** The deployment defaults (D-7278): every threshold is config, read once by `loadConfig` (`depsShedConfigOf`). */
export const DEPS_SHED_AFTER_HOURS_DEFAULT = 24;
export const DEPS_SHED_PER_PASS_DEFAULT = 1;

/** The row's facts the rule reads — the fleet frame's own row. */
export type DepsShedRow = Pick<FleetSession,
  'id' | 'workspace' | 'archivedAt' | 'stoppedBy' | 'child' | 'unmeasured' | 'statusUnmeasured' | 'held'>;

/** The session's coordinator claims, folded by the pass: `never` (absent from the map), `open`, `unplaced`, or `ended`
 *  at the latest instant it held one; `ownGeneration` says whether that instant falls in this incarnation of the
 *  workspace (`childReclaimCoordinated`, with its birth, for a child; always true for a non-child). */
export type DepsShedChair =
  | { readonly kind: 'never' } | { readonly kind: 'open' } | { readonly kind: 'unplaced' }
  | { readonly kind: 'ended'; readonly at: number; readonly ownGeneration: boolean };

/** The coordination store's answers for one session. */
export type DepsShedStoreRead =
  | { readonly ok: false; readonly detail: string }
  | {
    readonly ok: true;
    /** The newest PLACED run naming it as worker, as stop-done reads it (`lastRunBySession`'s `lastPlaced`). */
    readonly last: { readonly runId: number; readonly state: string; readonly closedAt: number | null } | null;
    /** An ACTIVE run names it as worker (`openPlacedWorkers`). */
    readonly openWorker: boolean;
    /** It holds a live claim (`activeClaims`). */
    readonly claim: boolean;
    readonly chair: DepsShedChair;
  };

/** `$REG/<id>.depsshed` as the pass read it: absent, the instant it records (epoch MS), or unreadable. */
export type DepsShedStamp =
  | { readonly kind: 'absent' } | { readonly kind: 'at'; readonly atMs: number } | { readonly kind: 'unreadable' };

export interface DepsShedInput {
  readonly row: DepsShedRow;
  /** The row's `.hold`, classified as stop-done classifies it (`heldKindOf`). */
  readonly heldKind: StopDoneHeldKind;
  readonly store: DepsShedStoreRead;
  readonly stamp: DepsShedStamp;
  /** `$REG/<id>.no-hibernate` is listed. */
  readonly optedOut: boolean;
  /** `Viewers.isOpen` for this id. */
  readonly viewer: boolean;
  readonly sinceStartMs: number;
  readonly viewerOpenTtlMs: number;
  /** `ccdCan(fleetState, 'wsShedDeps')`. */
  readonly verb: boolean;
  readonly now: number;
  /** `CCRC_DEPS_SHED_AFTER_HOURS`, in ms. */
  readonly afterMs: number;
  /** `CCRC_DEPS_SHED_PARKED_AFTER_HOURS`, in ms; null (unset) means a parked run never sheds. */
  readonly parkedAfterMs: number | null;
}

export type DepsShedVerdict =
  | {
    readonly act: 'shed'; readonly class: DepsShedClass;
    /** The worker's run (null for a coordinator). */
    readonly runId: number | null;
    /** The instant the age is measured from: the run's close, the sleep (a parked run), or the chair's end. */
    readonly clockAt: number; readonly ageMs: number;
  }
  | { readonly act: 'hold'; readonly reason: DepsShedHold };

const hold = (reason: DepsShedHold): DepsShedVerdict => ({ act: 'hold', reason });
const FINISHED: readonly string[] = ['done', 'failed'];

/** Shed this row's dependencies? Cheapest first; the first fact that fails is the answer; every doubt holds. */
export function depsShedVerdict(i: DepsShedInput): DepsShedVerdict {
  const { row } = i;
  if (row.workspace === null) return hold('not-a-workspace');
  if (row.archivedAt !== null) return hold('archived');
  if (row.stoppedBy === null) return hold('awake');
  if (row.unmeasured.length > 0 || row.statusUnmeasured) return hold('unmeasured');
  if (row.child.kind === 'unreadable') return hold('child-unreadable');
  if (!i.verb) return hold('no-verb');
  if (i.optedOut) return hold('opted-out');
  if (!(i.heldKind === 'none' || i.heldKind === 'programme' || i.heldKind === 'run-terminal')) return hold('held');
  if (i.viewer || i.sinceStartMs < i.viewerOpenTtlMs) return hold('viewer');
  const asleepAt = row.stoppedBy.at;
  if (i.stamp.kind === 'unreadable') return hold('stamp-unreadable');
  if (i.stamp.kind === 'at' && !(i.stamp.atMs < asleepAt)) return hold('shed');
  const s = i.store;
  if (!s.ok) return hold('runs-unreadable');
  if (s.chair.kind === 'open') return hold('claims-open-run');
  if (s.chair.kind === 'unplaced') return hold('claim-unplaced');
  if (s.openWorker) return hold('run-worker');
  if (s.claim) return hold('claim');
  const coordinated = s.chair.kind === 'ended' && s.chair.ownGeneration;
  const aged = (cls: DepsShedClass, runId: number | null, clockAt: number, afterMs: number): DepsShedVerdict => {
    const ageMs = i.now - clockAt;
    // Written so that a NaN on either side holds: doubt keeps.
    return ageMs >= afterMs ? { act: 'shed', class: cls, runId, clockAt, ageMs } : hold('too-recent');
  };
  if (row.child.kind === 'child' && !coordinated) {
    const last = s.last;
    if (last === null) return hold('no-run');
    if (FINISHED.includes(last.state)) {
      return last.closedAt === null ? hold('close-unplaced') : aged('child', last.runId, last.closedAt, i.afterMs);
    }
    if (STOP_DONE_PARKED_STATES.includes(last.state) && i.parkedAfterMs !== null) {
      return aged('child', last.runId, asleepAt, i.parkedAfterMs);
    }
    return hold('not-done');
  }
  if (s.chair.kind === 'ended') return aged('coordinator', null, s.chair.at, i.afterMs);
  return hold('not-coordinated');
}
