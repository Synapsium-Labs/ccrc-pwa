import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { Presence } from '../presence.js';
import type { NotifyLog } from '../notifylog.js';
import { CCD_ARGV, RECLAIM_CAP, capSupported, sweepDec, verbSupported } from '../ccdargv.js';
import { readSessionRecord } from '../registry.js';
import { refusalSentence } from '../wsaudit.js';
import { CHILD_BIRTH_SKEW_MS, type ChildSpentVerdict } from './childSpent.js';
import {
  CHILD_RECLAIM_SKIP, childReclaimCoordinated, childReclaimFailingPastCeiling, childReclaimFailingSentence, childReclaimFailureLine,
  childReclaimJournalRow, type ChildReclaimKeptAttention, type ChildReclaimSweepSkip, type ChildReclaimSweepVerdict,
} from '../childReclaimSweep.js';
import type { CoordStore, OpenSiblingsResult } from './store.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import {
  CHILD_RUN_ID, LC_REASON_MAX_BYTES, TERMINAL_RUN_STATES, holdReason, type ChildMark, type LifecycleAct, type LifecycleOutcome,
  type ChildReclaimStatus, type MarkerState, type MirroredLifecycleEvent, type RunState, type RunSummary, lcRefusalWord,
} from '../../../shared/api.js';

/**
 * CHILD-WORKSPACE RECLAMATION, the server half (spec 2026-09-22 §5.5–§5.7).
 *
 * `close.ts`'s kind of file: an L1 decision reached through declared ports.
 * Five things live here and nowhere else —
 *   - the fourteen words `ccd ws-reclaim` and `ccd ws-audit --reclaim` answer
 *     with, and what each one MEANS to the server (gone / terminal / retry);
 *   - `childReclaimGeneration` and `childReclaimLatest`, the one fence and the
 *     one latest-event pick every read of the lifecycle mirror goes through
 *     (spec §5.6: slugs recycle);
 *   - `childReclaimDecision`, the pure "has the coordinator finished with this
 *     child" predicate `closeRun` asks inside the coordination mutex;
 *   - `reclaimChild`, THE ONE EXECUTOR. The close path hands it a request on
 *     the session's own queue; wave 4's sweep hands it the same request. So
 *     presence, the capability gate and the feed row behave identically
 *     however a reclaim was started;
 *   - `childReclaimStatus` and `withChildReclaim`, THE ONE DERIVATION of a
 *     closed run's chip (spec §5.9), in the wave-5 section at the end.
 *
 * NAMING: every identifier here says `childReclaim`, never a bare `reclaim` —
 * `coord/reclaim.ts` already means handing a dead coordinator's claim to an
 * heir, and the two must never be confused in a grep.
 */

/** Every word `cmd_ws_reclaim`/`_ws_reclaim_eval` (and so `ws-audit
 *  --reclaim`) can refuse with — and NO other. `child-reclaim.test.ts` holds
 *  this set equal to what ccd's RECLAIM region actually emits, in both
 *  directions. `no-worktree-record` is `ws-reap`'s word, reused: a directory
 *  that exists but that git does not record as the project's worktree (spec
 *  §5.5) — ccd cannot tell what it would be deleting there. */
export type ChildReclaimToken =
  | 'no-such-session' | 'not-a-workspace' | 'not-a-child' | 'paused' | 'held' | 'attached' | 'tree-busy'
  | 'branch-elsewhere' | 'tree-unreadable' | 'containment-unproven' | 'no-worktree-record' | 'state-changed'
  | 'in-progress' | 'reap-in-progress';

/** What each word means to the server, spelled ONCE:
 *   - `gone`: the child is already not there. Never a feed row, never an
 *     attention item — there is nothing left to report about.
 *   - `terminal`: the box proved something that will not change by waiting
 *     (not a child, not provably contained, not a worktree git records). A
 *     refusal with its sentence — and exactly the words `ws-audit --reclaim`
 *     journals when it finds them (spec §5.9), which `child-reclaim.test.ts`
 *     holds equal to this arm.
 *   - `retry`: the box found a condition that passes (a hold, a pause, a
 *     human at the pane, a git operation, a lock, a token that went stale).
 *     A deferral; wave 4's sweep tries again. */
export const CHILD_RECLAIM_TOKEN_KIND: Readonly<Record<ChildReclaimToken, 'gone' | 'terminal' | 'retry'>> = {
  'no-such-session': 'gone',
  'not-a-workspace': 'terminal',
  'not-a-child': 'terminal',
  'branch-elsewhere': 'terminal',
  'tree-unreadable': 'terminal',
  'containment-unproven': 'terminal',
  'no-worktree-record': 'terminal',
  paused: 'retry',
  held: 'retry',
  attached: 'retry',
  'tree-busy': 'retry',
  'state-changed': 'retry',
  'in-progress': 'retry',
  'reap-in-progress': 'retry',
};

export function isChildReclaimToken(v: unknown): v is ChildReclaimToken {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_TOKEN_KIND, v);
}

/** `CHILD_RECLAIM_TOKEN_KIND` read TOTALLY: a token's classification, or null
 *  for one this build was never compiled to know (a newer ccd's), which is
 *  therefore never terminal and never listed. Never a cast: the journal's
 *  `refusal` is free text. `hasOwnProperty`, not `in`: `'toString' in {}` is
 *  true.
 *
 *  THE ONE LOOKUP, exported beside the table it reads (child-reclamation
 *  wave 4, spec §5.9): the kind map is spelled once, and a second reader
 *  would be a second place a classification could drift. The sweep
 *  (`watch.ts`) imports it and injects it into the L1 attention derivation as
 *  `kindOf`; wave 5's run chip imports it as-is and moves nothing. */
export const childReclaimTokenKind = (token: string): 'gone' | 'terminal' | 'retry' | null =>
  Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_TOKEN_KIND, token)
    ? CHILD_RECLAIM_TOKEN_KIND[token as ChildReclaimToken]
    : null;

const CREATE_ACT: LifecycleAct = 'create';
const CREATE_DONE: LifecycleOutcome = 'done';
const RECLAIM_ACT: LifecycleAct = 'reclaim';

/** ONE WORKSPACE GENERATION of one session's lifecycle events (child-
 *  reclamation wave 4, spec §5.6, §5.9). Session ids are slugs and slugs
 *  recycle: once a child is reclaimed or reaped, ws-add may mint a NEW
 *  workspace under the same id, and "the latest `reclaim` event for this
 *  session" would then describe a workspace that no longer exists —
 *  inheriting a terminal refusal would list the new child and keep the sweep
 *  off it for good. So every such read is taken within one generation: from
 *  the last `create` row with outcome `done` whose `at` is at or before `at`,
 *  up to (not including) the first such `create` after it.
 *
 *  NO OPENING `create`, NO GENERATION. When no placed `done` create lies at
 *  or before `at` — a workspace minted before the mirror existed, one whose
 *  `create` has scrolled out of the window read or carried no clock, or a
 *  history of rows alone — the answer is `[]`: there is no evidence which
 *  workspace those rows describe, and a guess would be another generation's
 *  rows.
 *
 *  `events` is ONE session's rows in the mirror's `id` order, oldest first —
 *  `CoordStore.lifecycleFor({ sessionId })`'s or `lifecycleCreatesFor`'s
 *  answer — and the answer keeps that order: `id` orders, never `at`. TIME IS
 *  CCD'S CLOCK ALONE, and it only PLACES the fence. The mirror's `ingestedAt`
 *  is the server's clock and is never read as an event time (D8,
 *  `coord/schema.ts`), so a `done` create whose line carried no `at` cannot be
 *  placed: it is no boundary — it opens nothing and closes nothing — and it,
 *  like every row between two boundaries, belongs to the generation its `id`
 *  falls in, whatever its `at`. Only a `done` create opens or closes a
 *  generation: a refused `ws-add` minted nothing, and an `intent` without its
 *  `done` is a create that never completed.
 *
 *  THE ONE IMPLEMENTATION. The sweep's attention list calls it with `at` =
 *  now; the birth fence calls it over `lifecycleCreatesFor` alone, so its
 *  single-row answer is the opening `create` itself; wave 5's run chip
 *  imports it and calls it with `at` = the run's `closedAt`.
 *  `child-reclaim-generation.test.ts` scans for a second. */
export function childReclaimGeneration(
  events: readonly MirroredLifecycleEvent[], at: number,
): readonly MirroredLifecycleEvent[] {
  /** A generation BOUNDARY: a `done` create that ccd placed in time. */
  const bound = (e: MirroredLifecycleEvent): e is MirroredLifecycleEvent & { readonly at: number } =>
    e.act === CREATE_ACT && e.outcome === CREATE_DONE && e.at !== null;
  let start = -1;
  for (let k = 0; k < events.length; k += 1) {
    const e = events[k]!;
    if (bound(e) && e.at <= at) start = k;
  }
  if (start === -1) return [];
  let end = events.length;
  for (let k = start + 1; k < events.length; k += 1) {
    if (bound(events[k]!)) { end = k; break; }
  }
  return events.slice(start, end);
}

/** The LATEST `reclaim` event of a generation, of ANY outcome — `intent`
 *  included — or null when it holds none (child-reclamation wave 4). An
 *  `intent` newer than every outcome is an attempt in flight, or
 *  one that died mid-way: what it will find is not known yet, so the
 *  attention list lists nothing for that child and the chip falls through to
 *  its row rule (spec §5.9 — a report of what stands, never of what an
 *  unfinished attempt might say). The mirror's `id` order decides "latest",
 *  never ccd's nullable clock (`lifecycleFor`'s rule).
 *
 *  THE ONE RULE: the sweep's attention list reads it over
 *  `childReclaimGeneration(events, now)`; wave 5's chip imports it as-is.
 *  `child-reclaim-generation.test.ts` scans for a second. */
export function childReclaimLatest(events: readonly MirroredLifecycleEvent[]): MirroredLifecycleEvent | null {
  for (let k = events.length - 1; k >= 0; k -= 1) {
    if (events[k]!.act === RECLAIM_ACT) return events[k]!;
  }
  return null;
}

/** The birth fence's birth (spec §5.1): the opening `create` of the session's CURRENT generation, on ccd's
 *  clock; null when unplaceable. The one placement the birth fence and the coordination fence share. */
export function childReclaimBornAt(
  coord: Pick<CoordStore, 'lifecycleCreatesFor'>, sessionId: string, nowMs: number,
): number | null {
  return childReclaimGeneration(coord.lifecycleCreatesFor(sessionId), nowMs)[0]?.at ?? null;
}
/** THE reader for one session (spec §1 rule 4). Throws when a store read throws; each caller keeps its own
 *  unreadable answer. */
export function childReclaimHasCoordinated(
  coord: Pick<CoordStore, 'childReclaimCoordinatorClaims' | 'lifecycleCreatesFor'>, sessionId: string, nowMs: number,
): boolean {
  return childReclaimCoordinated(coord.childReclaimCoordinatorClaims().get(sessionId),
    () => childReclaimBornAt(coord, sessionId, nowMs), CHILD_BIRTH_SKEW_MS);
}

/** Why a reclaim did not happen YET. The server's own reasons first, then the
 *  seven retryable box words — exactly the `retry` rows above, so a deferral
 *  always says which condition it is waiting on. */
export type ChildReclaimDeferWhy =
  | 'presence' | 'siblings-open' | 'siblings-unreadable' | 'marker-unreadable' | 'marker-mismatch'
  | 'unsupported' | 'paused-at-server'
  | Extract<ChildReclaimToken, 'paused' | 'held' | 'attached' | 'tree-busy' | 'state-changed' | 'in-progress' | 'reap-in-progress'>;

const CHILD_RECLAIM_DEFER_WHY: Readonly<Record<ChildReclaimDeferWhy, true>> = {
  presence: true, 'siblings-open': true, 'siblings-unreadable': true, 'marker-unreadable': true,
  'marker-mismatch': true, unsupported: true, 'paused-at-server': true,
  paused: true, held: true, attached: true, 'tree-busy': true, 'state-changed': true, 'in-progress': true,
  'reap-in-progress': true,
};

export function isChildReclaimDeferWhy(v: unknown): v is ChildReclaimDeferWhy {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_DEFER_WHY, v);
}

/** `wip`, discriminated (review 170 F21): a bare `string | null | 'unreadable'`
 *  collapses in TypeScript to `string | null` — the `'unreadable'` sentinel is
 *  just another string, so nothing forces a consumer to branch on it (the seam
 *  rule: two conditions a caller handles differently must not collapse to the
 *  same value). `none` — ccd printed a LITERAL `null`, genuinely nothing
 *  uncommitted; `commit` — the pinned commit id, 40 or 64 lower-hex (`sha`);
 *  `unreadable` — a `wip` this build cannot attribute to a commit, whatever
 *  shape it took (work MAY still be pinned — the attic holds it either way —
 *  but the feed must not claim nothing was left when it cannot read what
 *  was). `WIP_SHAPE` stays the one parse check that decides `commit` from
 *  `unreadable`. */
export type ChildReclaimWip =
  | { readonly kind: 'none' }
  | { readonly kind: 'commit'; readonly sha: string }
  | { readonly kind: 'unreadable' };

/** Replaces a `resumable: boolean` + `preLockDie: boolean` pair (review 170
 *  fr-I m1): the pair admitted `{resumable:true, preLockDie:true}`, a state no
 *  producer ever built, and the seam rule this same round's F21 is about says
 *  two conditions a caller handles differently must not share a
 *  representation that also permits a THIRD, impossible one. One discriminant
 *  makes it unrepresentable:
 *   - `resumable`: ccd's own destructive tail genuinely started and left a
 *     breadcrumb — its own `{failed:…}` document at exit 1, or a call cut
 *     short with nothing printed. The next attempt resumes FROM there.
 *   - `not-resumable`: a substance refusal — `ws-audit --reclaim` itself (a
 *     non-destructive verb that never reaches the reap lock), an unrecognised
 *     refusal word, or a `reclaimed` document naming another session. ccd's
 *     own ladder never advanced this session's state, but a plain retry MIGHT
 *     still succeed (a race, a version gap this build cannot name yet).
 *   - `pre-lock-die`: a recognised PRE-LOCK die of `cmd_ws_reclaim` (a usage
 *     error, a malformed token/run id/session id, a missing `python3`, a
 *     missing `flock` binary, or an unopenable lock file — ccd's RECLAIM
 *     region, before `_ws_reclaim_locked` runs). Also never advanced
 *     anything, but UNLIKE `not-resumable` it recurs IDENTICALLY until
 *     whatever caused it changes — not a race, so the feed must say
 *     something DIFFERENT from both other cases. */
export type ChildReclaimResume = 'resumable' | 'not-resumable' | 'pre-lock-die';

const CHILD_RECLAIM_RESUME: Readonly<Record<ChildReclaimResume, true>> = {
  resumable: true, 'not-resumable': true, 'pre-lock-die': true,
};

export function isChildReclaimResume(v: unknown): v is ChildReclaimResume {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_RESUME, v);
}

/** The ONE ccd `{failed:…}` word `parseChildReclaimResult` gives its own
 *  treatment: the presence rungs' own in-lock tmux probe (spec §5.7,
 *  "Presence, and its bound" — rungs 5 and 6) failing BEFORE any act, which —
 *  because no breadcrumb can exist yet at that point (spec §5.6, "The tail,
 *  the breadcrumb and the resume") — unlike every other
 *  post-start failure word, free ccd text this file never compares against a
 *  literal — decides `ChildReclaimResume` itself (`not-resumable`, never
 *  `resumable`: nothing was left to resume from). Named so
 *  `isChildReclaimKebab` admits it without a second hand-kept literal. */
const CHILD_RECLAIM_PROBE_UNMEASURED = 'probe-unmeasured';

export type ChildReclaimOutcome =
  | { readonly kind: 'reclaimed'; readonly sessionId: string; readonly runId: number;
      readonly wip: ChildReclaimWip; readonly secretsDropped: number | 'unreadable' }
  | { readonly kind: 'deferred'; readonly sessionId: string; readonly runId: number; readonly why: ChildReclaimDeferWhy; readonly detail: string }
  | { readonly kind: 'refused'; readonly sessionId: string; readonly runId: number; readonly token: ChildReclaimToken; readonly sentence: string; readonly detail: string }
  | { readonly kind: 'gone'; readonly sessionId: string }
  | { readonly kind: 'failed'; readonly sessionId: string; readonly runId: number;
      readonly resume: ChildReclaimResume; readonly detail: string };

/** `runId` is the MINTING run — the one the child's `.child` marker names and
 *  the value composed as `--child-of`. On the close path it is read off the
 *  marker, never assumed to be the run being closed: a child that handed over
 *  across waves was minted by wave 1 and is closed by wave N.
 *
 *  `deferredSinceMs`: epoch ms of the FIRST deferral the sweep
 *  saw for this child, or `null` — close's value, always a first attempt. It
 *  exists so the feed row can say how long the child waited and why (spec
 *  §5.7, §5.9); the executor decides nothing on it. `deferExpired` is the
 *  sweep's own verdict on the same clock, carried separately because it is a
 *  fingerprint input on the box and this is not. */
export interface ChildReclaimRequest {
  readonly sessionId: string; readonly runId: number;
  readonly trigger: 'close' | 'sweep'; readonly deferExpired: boolean;
  readonly deferredSinceMs: number | null;
}

/** The executor's ports (L2, declared by this consumer). `presence` is
 *  narrowed to the one question asked of it; `notifyLog` is optional exactly
 *  as it is on `Deps` — a box with no feed log still reclaims, and says so
 *  nowhere, which is the existing degrade for every other feed writer. */
export interface ChildReclaimDeps {
  coord: CoordStore;
  io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState;
  presence?: Pick<Presence, 'isVisible'>;
  notifyLog?: NotifyLog;
  /** The clock the feed row's wait is rendered against (spec §5.7). Absent: `Date.now`. */
  now?: () => number;
}

// ── the close decision (pure) ────────────────────────────────────────────────

/** Why a close did NOT queue a reclaim. Each word is a condition a reader acts
 *  on differently, so none folds into another (carried constraint 2):
 *  `not-a-child` is ordinary; `marker-unreadable` is a box that could not be
 *  read (the sweep retries); `siblings-*` mean another run still has — or may
 *  have — this workspace; `has-coordinated` is a child that has itself ever
 *  been named `claimedBy` of a run — the session a reclaim made an heir, the
 *  session it displaced, or any nested coordinator (spec §1 rule 4):
 *  manual cleanup is reserved for a coordinator's own workspace, never a
 *  sub-workspace a close may act on; `review-report-live` is a REVIEW child
 *  kept while the run it reviewed is not terminal, because the coordinator
 *  cites the report in its clips by path (spec §5.7); the ordinary non-final
 *  close splits by WHY the spent evidence (spec §5.3) could not finish it:
 *  `not-finished-undated` — the live rung answered spent, but no dated row
 *  proves this incarnation; `not-finished-unmeasured` — the spent verdict was
 *  unmeasured; `not-finished-merge-commit` — a fast-path (registry or
 *  `.prhistory`) spent answer was re-dated `unspent`; plain `not-finished` is
 *  the ordinary unspent hand-over. */
export type ChildReclaimNotWhy =
  | 'not-a-child' | 'marker-unreadable' | 'siblings-open' | 'siblings-unreadable' | 'has-coordinated'
  | 'review-report-live' | 'not-finished-undated' | 'not-finished-unmeasured' | 'not-finished-merge-commit'
  | 'not-finished';

const CHILD_RECLAIM_NOT_WHY: Readonly<Record<ChildReclaimNotWhy, true>> = {
  'not-a-child': true, 'marker-unreadable': true, 'siblings-open': true, 'siblings-unreadable': true,
  'has-coordinated': true, 'review-report-live': true, 'not-finished-undated': true,
  'not-finished-unmeasured': true, 'not-finished-merge-commit': true, 'not-finished': true,
};

export type ChildReclaimDecision =
  | { readonly reclaim: true }
  | { readonly reclaim: false; readonly why: ChildReclaimNotWhy };

/** The minting run's row, read by the id the marker names — the SERVER's half
 *  of spec §5.1's two authorities. Three answers, never two. `reviews` is the
 *  row's own column: the work run a REVIEW run reads, `null` on a work run.
 *  `sessionBornAt`/`sessionBornFor`/`dispatchStartedAt` (migration 16, and
 *  migration 5 for the last) are the same columns `childBirthOf` reads
 *  (`childSpent.ts`) — carried here so the close (Task 9) can place a
 *  fast-path spent verdict's evidence against this child's own birth before
 *  it decides; they play no part in `childReclaimDecision`'s own logic, which
 *  reads only `spent.kind` and `spent.incarnation`, already resolved by the
 *  caller. */
export type ChildReclaimMinting =
  | { readonly kind: 'row'; readonly sessionId: string | null; readonly reviews: number | null;
      readonly sessionBornAt: number | null; readonly sessionBornFor: string | null;
      readonly dispatchStartedAt: number | null }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' };

/** The run a REVIEW child's minting run reviews (spec §5.7, "A review child
 *  is finished later than its own run"), read in the same mutex section as
 *  the sibling list. `none`: the minting run is a work run and reviews
 *  nothing. Four answers, never folded: `absent` (a reviewed run the database
 *  does not have) is NOT proven terminal and keeps the child
 *  (`review-report-live`); `unreadable` never authorises one — it defers
 *  (`marker-unreadable`). */
export type ChildReclaimReviewed =
  | { readonly kind: 'none' }
  | { readonly kind: 'row'; readonly state: RunState }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' };

/** `TERMINAL_RUN_STATES` (L0), asked — the one reading of "terminal" both of
 *  this file's callers use, never a second spelling of the list. */
export function isChildReclaimTerminalState(state: RunState): boolean {
  return (TERMINAL_RUN_STATES as readonly RunState[]).includes(state);
}

export interface ChildReclaimDecisionInput {
  /** The registry's reading of `$REG/<id>.child`. */
  readonly mark: ChildMark;
  /** Meaningful only when `mark` is `child`: the row of `mark.runId`. */
  readonly minting: ChildReclaimMinting;
  readonly sessionId: string;
  /** The OTHER open runs on this workspace, read inside the mutex. */
  readonly siblings: OpenSiblingsResult;
  /** Meaningful only when `minting` is a review run's row: the state of the
   *  run it reviews, read with the siblings (spec §5.7). */
  readonly reviewed: ChildReclaimReviewed;
  readonly final: boolean;
  readonly state: 'done' | 'failed';
  /** `unasked` until every other conjunct has been decided — the live half of
   *  the spent verdict is a gh round trip, asked only when it can matter. A
   *  `spent` verdict finishes a child only when its evidence is PROVEN dated
   *  to THIS incarnation of the workspace (`incarnation: 'this'`) — a spent
   *  verdict whose evidence cannot be placed against this child's own birth
   *  (`incarnation: 'unplaced'`, the fast path's registry number or
   *  `.prhistory`, or an undated live row) HOLDS the child on a non-final
   *  close (amendment A2): the branch name is a recycled slug (spec §5.5),
   *  and unplaced evidence could belong to an earlier workspace that wore it. */
  readonly spent: ChildSpentVerdict | { readonly kind: 'unasked' };
  /** True exactly when `spent.kind === 'spent' && spent.source !== 'live'`
   *  triggered the caller's re-date through `childSpentLive` (spec §5.3): the
   *  fast path (registry `.prnumber` or `.prhistory`) answered spent, never
   *  trusted alone, and was re-asked live. Carried so a fast-path answer that
   *  re-dates to `unspent` can still say WHY it is not finished —
   *  `not-finished-merge-commit` — rather than the ordinary unspent hand-over. */
  readonly spentFastPath: boolean;
  /** Whether this session has coordinated in its own generation
   *  (`childReclaimHasCoordinated`): named `claimedBy` of a run, or the session
   *  a reclaim DISPLACED from a programme's chair (`CoordStore.
   *  childReclaimCoordinatorClaims` — the heir side is dated by its
   *  displacement, because its claim on already-terminal runs began after
   *  their `closedAt`; the `from` side of a `reclaim:` displacement is dated
   *  there too), at or after this workspace's birth less the skew (spec §1
   *  rule 4; spec §5.6: slugs recycle): a coordinator's own workspace, cleaned
   *  up by a human, never reclaimed automatically. `'unreadable'` when the
   *  caller's store read itself failed — decided at the SAME place the
   *  sibling check ranks (right after it, never ahead of
   *  `not-a-child`/`marker-unreadable`), so a throw folds into the existing
   *  `siblings-unreadable` only where an unreadable sibling list already
   *  would, never on every close. No overloaded boolean:
   *  `true`/`false`/`'unreadable'` are three answers, never two. */
  readonly hasCoordinated: boolean | 'unreadable';
  /** No OTHER open run of this run's program: `CoordStore.programOpenRunCount`
   *  with this run excluded — D-51's predicate, not a second spelling. */
  readonly retiresProgram: boolean;
}

/**
 * Has the coordinator FINISHED with this child? (spec §5.7). Eligible iff
 * child ∧ no open sibling ∧ not coordinated in its own generation ∧ (final ∨
 * spent-and-proven-this-incarnation ∨ an abandon ∨ this close retires the
 * program). "No open sibling" ALONE is also true on the ordinary non-final
 * close, which is claiming the child for wave N+1 — reclaiming on it would be
 * the 2026-09-10 harm through a new door.
 *
 * Two authorities, EQUAL (spec §5.1): the box's marker names a run, and that
 * run's row names THIS session. A marker naming a run whose row is absent, or
 * names another session, is not a child here — never a guess in either
 * direction. An unreadable marker or an unreadable minting row is
 * `marker-unreadable`: DEFER, never authorise, never call it "not a child".
 *
 * A REVIEW child is not finished while the run it reviewed is open (spec
 * §5.7): reviewer clause 7 keeps the report in the reviewer's clips, and the
 * coordinator cites it BY PATH in every send-back `fix-round` mail — so even a
 * final close of the review run answers `review-report-live` until the
 * reviewed run is terminal, and the sweep reclaims the child after that. A
 * reviewed row that cannot be read is `marker-unreadable` (the server's half of
 * the child's identity could not be read — the minting row's own fold); one
 * the database does not have is not PROVEN terminal, and keeps the child.
 *
 * A SPENT verdict finishes a child only when `incarnation === 'this'`
 * (amendment A2): the fast path (`rec.prNumber`/`.prhistory`) and an undated
 * live row cannot say WHICH workspace wearing this recycled slug (spec §5.5)
 * the evidence belongs to, and this decision may DESTROY the workspace — so
 * unplaced evidence HOLDS on a non-final close exactly like an unspent child,
 * never reclaims on a guess. A close that HOLDS on unproven spent evidence
 * says why (spec §5.3): `not-finished-undated` (a proven `spent` verdict left
 * undated), `not-finished-unmeasured` (the verdict itself could not be read)
 * or `not-finished-merge-commit` (the fast path's own answer was re-dated
 * `unspent`) — otherwise plain `not-finished`, the ordinary unspent hand-over.
 *
 * A child that has coordinated in its own generation
 * (`childReclaimHasCoordinated`; spec §1 rule 4) is never reclaimed
 * automatically, whatever else this close would otherwise decide:
 * checked right after the sibling read, the same place that read's own
 * unreadable answer ranks — so a `hasCoordinated: 'unreadable'` input folds
 * into `siblings-unreadable` only there, never ahead of `not-a-child` or
 * `marker-unreadable` for an ordinary non-child close whose own coordination
 * history happens to be unreadable.
 */
export function childReclaimDecision(input: ChildReclaimDecisionInput): ChildReclaimDecision {
  const no = (why: ChildReclaimNotWhy): ChildReclaimDecision => ({ reclaim: false, why });
  if (input.mark.kind === 'none') return no('not-a-child');
  if (input.mark.kind === 'unreadable') return no('marker-unreadable');
  if (input.minting.kind === 'unreadable') return no('marker-unreadable');
  if (input.minting.kind === 'absent' || input.minting.sessionId !== input.sessionId) return no('not-a-child');
  if (!input.siblings.ok) return no('siblings-unreadable');
  if (input.siblings.siblings.length > 0) return no('siblings-open');
  if (input.hasCoordinated === 'unreadable') return no('siblings-unreadable');
  if (input.hasCoordinated) return no('has-coordinated');
  if (input.minting.reviews !== null) {
    if (input.reviewed.kind === 'unreadable') return no('marker-unreadable');
    if (input.reviewed.kind !== 'row' || !isChildReclaimTerminalState(input.reviewed.state)) return no('review-report-live');
  }
  const finished = input.final || input.state === 'failed' || input.retiresProgram
    || (input.spent.kind === 'spent' && input.spent.incarnation === 'this');
  if (finished) return { reclaim: true };
  if (input.spent.kind === 'spent') return no('not-finished-undated');
  if (input.spent.kind === 'unmeasured') return no('not-finished-unmeasured');
  if (input.spent.kind === 'unspent' && input.spentFastPath) return no('not-finished-merge-commit');
  return no('not-finished');
}

/** `mail-routes.test.ts`'s kebab scanner reads every quoted hyphenated literal
 *  in `server/src/coord` and admits it through an exported guard per
 *  vocabulary. This file's vocabularies — the box's tokens, the defer
 *  reasons, the close decision's reasons and (review 170 F20, fix round 3 of
 *  the gate's real red) the verb-parse `ChildReclaimResume` word — plus
 *  close's `not-queued`, are one family, admitted here, so a word added to
 *  any of these types is accepted and a typo is not. `ChildReclaimResume`'s
 *  own `isChildReclaimResume` guard, not a second hand-kept list here: the
 *  same reason every other member of this function is a guard call, never an
 *  inline set. Deliberately NOT named `isChildReclaimWord`: wave 5 owns that
 *  name, in `shared/api.ts`, as the type guard of the run chip's
 *  `ChildReclaimWord` vocabulary (spec §5.9) — a different set with a
 *  different meaning. */
export function isChildReclaimKebab(v: unknown): boolean {
  return isChildReclaimToken(v) || isChildReclaimDeferWhy(v) || isChildReclaimResume(v)
    || v === CHILD_RECLAIM_PROBE_UNMEASURED
    || (typeof v === 'string' && (Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_NOT_WHY, v) || v === 'not-queued'));
}

// ── the two ccd documents ────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;
/** A commit id ccd's own reader can attribute to a WIP pin: 40 lower-hex
 *  (SHA-1) or 64 lower-hex (a SHA-256 repository). Anything else is a shape
 *  this build cannot attribute to a real commit — never silently folded into
 *  "no WIP was pinned" (fix round 1, review minor #2). */
const WIP_SHAPE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** `ccd ws-audit --session <id> --reclaim [--defer-expired]`'s answer, read
 *  for exactly what the executor needs. `unreadable` is its own arm: a
 *  document this build cannot read is not a refusal and never a token. */
export type ChildReclaimAuditRead =
  | { readonly kind: 'token'; readonly token: string; readonly childOf: number }
  | { readonly kind: 'refused'; readonly token: ChildReclaimToken; readonly detail: string }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** `sessionId` is checked against the document's own `id` field exactly as
 *  `parseChildReclaimResult` checks `reclaimed`/`refused` against it (fix
 *  round 1, review minor #3, symmetry) — every ccd read of the registry
 *  prints `"id":<the --session argument>` first, so a mismatch here is either
 *  a caller bug or a race the audit itself cannot see past; `unreadable` is
 *  the existing vocabulary for "this document cannot be trusted", and the
 *  executor already maps that to the `failed` outcome (never a token spent
 *  on the wrong id). */
export function parseChildReclaimAudit(sessionId: string, stdout: string): ChildReclaimAuditRead {
  let v: unknown;
  try { v = JSON.parse(stdout.trim()); } catch { return { kind: 'unreadable', detail: 'ws-audit --reclaim printed no JSON document' }; }
  if (!isRecord(v)) return { kind: 'unreadable', detail: 'ws-audit --reclaim printed no JSON object' };
  if (v.id !== sessionId) {
    return { kind: 'unreadable', detail: `ws-audit --reclaim answered for ${String(v.id)}, not ${sessionId}` };
  }
  // An older ccd prints the PLAIN audit for an argv it does not parse only if
  // something upstream skipped the capability gate; either way, a document
  // without `mode: reclaim` was not minted by the reclaim ladder.
  if (v.mode !== 'reclaim') return { kind: 'unreadable', detail: 'ws-audit answered without "mode":"reclaim"' };
  if (v.verdict === 'reclaimable') {
    if (typeof v.token !== 'string' || !TOKEN_SHAPE.test(v.token)) {
      return { kind: 'unreadable', detail: 'ws-audit --reclaim said reclaimable with no 64-hex token' };
    }
    // ONE run-id grammar: `CHILD_RUN_ID` (wave 2, `shared/api.ts`) — ten ASCII
    // digits, no leading zero, exactly what ccd's `_child_runid_valid` lets a
    // marker hold. A wider numeric parse would admit sixteen digits no child
    // could ever be minted for.
    if (typeof v.childOf !== 'number' || !CHILD_RUN_ID.test(String(v.childOf))) {
      return { kind: 'unreadable', detail: 'ws-audit --reclaim said reclaimable with no childOf run id' };
    }
    return { kind: 'token', token: v.token, childOf: v.childOf };
  }
  if (isChildReclaimToken(v.verdict)) {
    return { kind: 'refused', token: v.verdict, detail: typeof v.detail === 'string' ? v.detail : '' };
  }
  return { kind: 'unreadable', detail: `ws-audit --reclaim answered a verdict this build does not know: ${String(v.verdict)}` };
}

/** The exact stderr shape ccd's own `die` calls print for the SIX single-line
 *  pre-lock dies of `cmd_ws_reclaim` — a usage error, a malformed token/run
 *  id/session id, a missing `python3`, a missing `flock` binary (ccd/ccd's
 *  RECLAIM region, everything above the `_ws_reclaim_locked "$token" …`
 *  call): a lone `ccd: <message>` line, nothing on stdout, nothing else on
 *  stderr. The seventh — lock-unopenable — is NOT one of these; see
 *  `matchChildReclaimLockUnopenableDie` below (review 170 fr-I I1: measured
 *  against the real harness, its shape is different).
 *
 *  Anchored `^…$` against the WHOLE trimmed, prefix-stripped message, never
 *  `.test` against a substring: an EXTENDED die — ccd rewords a message and
 *  APPENDS to it — must not match (review 170 fr-I I2), only an exact
 *  rewording reds the pin `child-reclaim.test.ts` reads straight off ccd's
 *  own text. */
const CHILD_RECLAIM_PRE_LOCK_DIE_PATTERNS: readonly RegExp[] = [
  /^usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id> \[--defer-expired\] \[--surface <word>\] \[--actor <text>\] \[--reason <text>\]$/,
  /^bad token$/,
  /^bad run id$/,
  /^bad session id$/,
  /^python3 unavailable — cannot quote the reclaim record safely$/,
  /^flock \(util-linux\) is unavailable — refusing to run the destructive verb unserialised$/,
];

/** The lock-unopenable die's REAL shape, MEASURED (review 170 fr-I I1) by
 *  running the real committed verb in a fixture HOME with the lock path
 *  turned into a directory — never hand-typed:
 *
 *      <ccd path>: line <N>: <lock path>: Is a directory
 *      ccd: cannot open the reap lock at <lock path>
 *
 *  `exec {lfd}>>"$lock"` failing makes BASH print its own redirection
 *  diagnostic FIRST, on its own line(s); ccd's `_lc_refuse` line is always
 *  LAST. Recognised positively and whole-output: the final line must be
 *  EXACTLY `ccd: cannot open the reap lock at <path>`, and every earlier line
 *  (zero or more — bash's exact wording varies by cause: EISDIR, EACCES,
 *  ENOENT) must be bash's own diagnostic for THAT SAME path. Nothing else is
 *  accepted, so a different path, extra trailing content, or a post-lock bash
 *  abort (which names no lock path at all) is never mistaken for this die. */
function matchChildReclaimLockUnopenableDie(err: string): string | null {
  const lines = err.split('\n');
  const last = lines[lines.length - 1] ?? '';
  const m = /^ccd: cannot open the reap lock at (.+)$/.exec(last);
  if (!m) return null;
  const lockPath = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bashLine = new RegExp(`^.*: line [0-9]+: ${lockPath}: .+$`);
  return lines.slice(0, -1).every((l) => bashLine.test(l)) ? last.slice('ccd: '.length) : null;
}

/** The one recogniser `parseChildReclaimResult`'s fallback calls: the SEVEN
 *  pre-lock dies, whichever shape each one takes. Returns ccd's own message
 *  (never `null`) on a match, so the caller never re-derives it. */
function matchChildReclaimPreLockDie(stderr: string): string | null {
  const err = stderr.trim();
  if (err === '') return null;
  const lock = matchChildReclaimLockUnopenableDie(err);
  if (lock !== null) return lock;
  const msg = err.startsWith('ccd: ') ? err.slice('ccd: '.length) : err;
  return CHILD_RECLAIM_PRE_LOCK_DIE_PATTERNS.some((p) => p.test(msg)) ? msg : null;
}

/** `ccd ws-reclaim …`'s answer. Three documents (spec §5.6): `reclaimed` and
 *  `refused` at exit 0, `failed` at exit 1 — and a fourth condition that is
 *  not a document at all, a call cut short with nothing printed, which is
 *  `failed` too: the breadcrumb on the box resumes it on the next attempt. */
export type ChildReclaimVerbRead =
  /** `wip` (review 170 F21 — see `ChildReclaimWip`'s own docstring for why
   *  this is a discriminated shape rather than `string | null | 'unreadable'`).
   *  `secretsDropped`: how many secret-shaped paths the reclaim dropped and
   *  recorded instead of committing (spec §5.5 step 2) — a hidden-flag secret
   *  edit among them; `'unreadable'` when ccd printed anything but a
   *  non-negative integer, or no key at all. A reclaim with no WIP that
   *  dropped a secret did leave something uncommitted, and the feed says so. */
  | { readonly kind: 'reclaimed'; readonly wip: ChildReclaimWip; readonly secretsDropped: number | 'unreadable' }
  | { readonly kind: 'refused'; readonly token: ChildReclaimToken; readonly detail: string }
  /** `resume` (review 170 F20; three-way since fr-I m1 — see
   *  `ChildReclaimResume`'s own docstring). `matchChildReclaimPreLockDie`,
   *  above, is what decides `pre-lock-die` here. */
  | { readonly kind: 'failed'; readonly resume: ChildReclaimResume; readonly detail: string };

export function parseChildReclaimResult(sessionId: string, stdout: string, stderr: string): ChildReclaimVerbRead {
  let v: unknown = null;
  try { v = JSON.parse(stdout.trim()); } catch { v = null; }
  if (isRecord(v)) {
    if (typeof v.reclaimed === 'string') {
      if (v.reclaimed !== sessionId) {
        return { kind: 'failed', resume: 'not-resumable',
          detail: `ws-reclaim reported reclaiming ${v.reclaimed}, not ${sessionId}` };
      }
      const wip: ChildReclaimWip = v.wip === null ? { kind: 'none' }
        : typeof v.wip === 'string' && WIP_SHAPE.test(v.wip) ? { kind: 'commit', sha: v.wip }
        : { kind: 'unreadable' };
      const secretsDropped = typeof v.secretsDropped === 'number' && Number.isSafeInteger(v.secretsDropped)
        && v.secretsDropped >= 0 ? v.secretsDropped : 'unreadable';
      return { kind: 'reclaimed', wip, secretsDropped };
    }
    if (typeof v.refused === 'string') {
      const detail = typeof v.detail === 'string' ? v.detail : '';
      return isChildReclaimToken(v.refused)
        ? { kind: 'refused', token: v.refused, detail }
        : { kind: 'failed', resume: 'not-resumable',
            detail: `ws-reclaim refused with a word this build does not know: ${v.refused}` };
    }
    if (typeof v.failed === 'string') {
      // Fix round 2, review minor C: an empty `detail` must not render
      // "…failed: ." — omit the separator rather than leave it dangling.
      const detail = typeof v.detail === 'string' ? v.detail : '';
      // `probe-unmeasured` (spec §5.7's presence rungs, §5.6's breadcrumb) is the
      // presence rungs' own in-lock tmux probe failing BEFORE any act — the
      // destructive tail never started, so unlike every other post-start
      // `{failed:…}` document there is no breadcrumb to resume from. A retry
      // starts completely afresh, exactly as `not-resumable` already reads
      // (`childReclaimFeedBody`'s tail text: "It is retried from the start.").
      const resume: ChildReclaimResume = v.failed === CHILD_RECLAIM_PROBE_UNMEASURED ? 'not-resumable' : 'resumable';
      return { kind: 'failed', resume, detail: detail === '' ? v.failed : `${v.failed}: ${detail}` };
    }
  }
  const err = stderr.trim();
  const dieMsg = matchChildReclaimPreLockDie(err);
  if (dieMsg !== null) return { kind: 'failed', resume: 'pre-lock-die', detail: dieMsg };
  return { kind: 'failed', resume: 'resumable',
    detail: err === '' ? 'ws-reclaim answered nothing — it may have been cut short; the next attempt resumes it' : err };
}

// ── the ONE executor ─────────────────────────────────────────────────────────

/**
 * Reclaim ONE child, from either trigger (spec §5.7). Re-reads everything it
 * decides on — the marker against `req.runId`, the open siblings, the
 * reclaim switch (`childReclaimPauseRead`, wave 4), presence, the
 * capability — then `ws-audit --reclaim` → token → `ws-reclaim`. On
 * `reclaimed` — and on a row step 1 measures ABSENT, whose earlier attempt's
 * box half finished without its cancel — it cancels every outstanding
 * delivery addressed to the child.
 * Every outcome but `gone` writes exactly ONE feed row, HERE — this function
 * is the single exit every outcome takes, so a new condition added to
 * `childReclaimOutcome` inherits its row rather than having to remember one.
 *
 * NEVER THROWS for a condition it can name: a failed read is a deferral or a
 * failure with a detail. What it cannot name (a bug) rejects, and the close
 * route's port logs it; the sweep reaches the child either way.
 */
export async function reclaimChild(deps: ChildReclaimDeps, req: ChildReclaimRequest): Promise<ChildReclaimOutcome> {
  const outcome = await childReclaimOutcome(deps, req);
  if (outcome.kind !== 'gone') recordChildReclaimFeed(deps, outcome, req);
  return outcome;
}

/** The server's read of the reclaim kill-switch (child-reclamation spec §5.8,
 *  wave 4) — the close path's skip, and the one server-side read that covers a
 *  sweep reclaim queued behind a session's `KeyedQueue` before the switch went
 *  up. `emitCoord`'s mapping of the same listing: THREE answers, because "the
 *  registry did not list" is not "the switch is down". NOT the authority —
 *  `ws-reclaim` re-reads the file inside its lock at rung 3 and again on
 *  resume; this spares the box an audit walk the server already knows ccd will
 *  refuse. */
export async function childReclaimPauseRead(
  io: Pick<FleetIO, 'readdir'>, registryDir: string,
): Promise<MarkerState> {
  const names = await io.readdir(registryDir);
  if (names === null) return 'unmeasurable';
  return names.includes(RECLAIM_PAUSE_MARKER) ? 'set' : 'clear';
}

async function childReclaimOutcome(deps: ChildReclaimDeps, req: ChildReclaimRequest): Promise<ChildReclaimOutcome> {
  const { sessionId, runId } = req;
  const deferred = (why: ChildReclaimDeferWhy, detail: string): ChildReclaimOutcome =>
    ({ kind: 'deferred', sessionId, runId, why, detail });

  // 1 — the box's authority, re-read: the marker must name THIS request's run.
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  if (!read.found && read.reason === 'absent') {
    // `absent` is read the way wave 2's `childBindGate` reads it: re-listed ONCE.
    // Absent twice is `gone`; a second listing that still names this id's
    // `.child` (or `.uuid`) — a row that exists and could not be built — is
    // `marker-unreadable`, and so is a second listing that fails. See
    // `childReclaimRowListing`.
    const again = await childReclaimRowListing(deps, sessionId);
    if (again.kind === 'unlistable') return deferred('marker-unreadable', 'the registry could not be listed');
    // The executor's OWN gone-check: `.uuid`-OR-`.child` (fix round 1, review
    // Important #1) — `childReclaimRowListing` no longer folds this for us.
    if (again.uuid || again.child) {
      return deferred('marker-unreadable', 'the registry lists this workspace but its row could not be built');
    }
    // GONE, AND THE MAIL GOES WITH IT. The box half of a reclaim can finish
    // without step 7 ever running: the server restarted between `ws-reclaim`
    // and the cancel, or the verb answered `purge-incomplete` (the row WAS
    // purged, and it reads as `failed`). The next attempt lands HERE, and
    // without this its outstanding mail would wait for `sweepMail`'s
    // abandonment park — listed as a human's to act on — through exactly the
    // slug-recycling window spec §5.6 moved the cancel into this wave to close.
    // Safe: a listing that names neither `<id>.uuid` nor `<id>.child` means no
    // session holds this id now.
    childReclaimCancelMail(deps, sessionId, 'gone');
    return { kind: 'gone', sessionId };
  }
  if (!read.found) return deferred('marker-unreadable', 'the registry could not be listed');
  const mark = read.record.child;
  if (mark.kind === 'unreadable') return deferred('marker-unreadable', 'the child marker could not be read');
  if (mark.kind === 'none') return deferred('marker-mismatch', 'the workspace carries no child marker');
  if (mark.runId !== runId) {
    return deferred('marker-mismatch', `the child marker names run ${mark.runId}, not run ${runId}`);
  }
  // 2 — no open run names it. Unreadable is INELIGIBLE, never "none".
  const sib = deps.coord.openRunsForSession(sessionId);
  if (!sib.ok) return deferred('siblings-unreadable', sib.detail);
  if (sib.siblings.length > 0) {
    return deferred('siblings-open', `open run(s) ${sib.siblings.map((s) => `#${s.id}`).join(', ')} still name this workspace`);
  }
  // 2a — COORDINATING, ANY STATE (spec §1, rule 4: manual cleanup is
  // reserved for a coordinator's OWN workspace, never a sub-workspace a sweep
  // may act on). A child that has coordinated in its own generation
  // (`childReclaimHasCoordinated`) — named `claimedBy` of a run, the session a
  // reclaim made an heir, the session the SAME reclaim displaced, or any
  // nested coordinator, at or after this workspace's birth less the skew
  // (spec §5.6: slugs recycle) — is never reclaimed automatically, whatever
  // state that run reaches later (`CoordStore.childReclaimCoordinatorClaims`'s
  // own docstring states what a claim covers and its one residual). Read
  // after the sibling re-read (which answers a narrower, LIVE question) and
  // before the pause: an unreadable coordination table or mirror is
  // `siblings-unreadable`, the same word this function already uses for an
  // unreadable `openRunsForSession` — never silently treated as "never
  // coordinated".
  try {
    if (childReclaimHasCoordinated(deps.coord, sessionId, (deps.now ?? Date.now)())) {
      return deferred('siblings-open', `${sessionId} has coordinated run(s)`);
    }
  } catch (err) {
    return deferred('siblings-unreadable', `whether ${sessionId} has coordinated a run could not be read `
      + `(${err instanceof Error ? err.message : String(err)})`);
  }
  // 2b — THE SWITCH, READ BY THE SERVER (spec §5.8: "the close path skips").
  // After the marker and sibling re-reads and BEFORE presence, the capability
  // and any argv: a raised switch — or a registry that did not list, which
  // cannot rule one out — defers, on EITHER trigger and WHATEVER
  // `deferExpired` says (the ceiling bounds presence; the pause is not
  // presence). Through this function's own `deferred(...)`, so `reclaimChild`
  // writes its one feed row for it like every other deferral. ccd's rung 3,
  // read on the box inside the lock at the instant of deletion, is still the
  // read that matters. Try-wrapped like 2a above: both shipped `FleetIO`
  // adapters fold every failure to `null` (the `unmeasurable` arm), so there
  // is no live throw path today, but a REJECTING `readdir` must still land on
  // this function's own `deferred(...)` — never an uncaught rejection that
  // skips the executor's one feed row.
  let pause: MarkerState;
  try {
    pause = await childReclaimPauseRead(deps.io, deps.cfg.registryDir);
  } catch (err) {
    return deferred('paused-at-server', `whether ${RECLAIM_PAUSE_MARKER} is raised could not be read `
      + `(${err instanceof Error ? err.message : String(err)})`);
  }
  if (pause !== 'clear') {
    return deferred('paused-at-server', pause === 'set'
      ? `${RECLAIM_PAUSE_MARKER} is raised: automatic reclamation is paused fleet-wide`
      : `the registry did not list, so a raised ${RECLAIM_PAUSE_MARKER} cannot be ruled out`);
  }
  // 3 — a human looking at it, unless the defer's ceiling was reached.
  if (!req.deferExpired && deps.presence?.isVisible(sessionId) === true) {
    return deferred('presence', 'someone is viewing this session');
  }
  // 4 — the box must PROVE it has the verb: `capSupported` refuses on no
  // evidence, which is the only safe default for a verb that never existed.
  if (!capSupported(deps.fleetState, RECLAIM_CAP)) {
    return deferred('unsupported', `the fleet host does not advertise ${RECLAIM_CAP}`);
  }
  // 5 — the token, minted by the ladder on the box.
  const audit = await childReclaimAudit(deps, req);
  if (audit.kind === 'unreadable') {
    return { kind: 'failed', sessionId, runId, resume: 'not-resumable', detail: audit.detail };
  }
  if (audit.kind === 'refused') return childReclaimRefusal(req, audit.token, audit.detail);
  if (audit.childOf !== runId) {
    return deferred('marker-mismatch', `ws-audit read the child marker as run ${audit.childOf}, not run ${runId}`);
  }
  // 6 — the act. ccd re-proves the token inside the reap lock.
  const act = await childReclaimAct(deps, req, audit.token);
  if (act === 'unsupported') return deferred('unsupported', `the fleet host does not advertise ${RECLAIM_CAP}`);
  if (act.kind === 'failed') {
    return { kind: 'failed', sessionId, runId, resume: act.resume, detail: act.detail };
  }
  if (act.kind === 'refused') return childReclaimRefusal(req, act.token, act.detail);
  // 7 — the child is gone: nothing may still be waiting to be typed into it,
  // or into a stranger that inherits its recycled slug.
  childReclaimCancelMail(deps, sessionId, 'reclaimed');
  return { kind: 'reclaimed', sessionId, runId, wip: act.wip, secretsDropped: act.secretsDropped };
}

/** What a second registry listing found, or that it could not be taken.
 *  NEVER pre-folded (fix round 1, review Important #1): `.uuid` and `.child`
 *  are reported SEPARATELY, because the executor's own question ("is this
 *  workspace gone?", `.uuid`-OR-`.child`) is not the close path's (Task 9,
 *  controller ruling P5: a `.uuid`-only listing at close is `none` — not a
 *  child — while a LISTED `.child` is `unreadable`, a box that could not be
 *  read). Folding the two booleans into one `'listed'` word — the shape this
 *  export carried before this fix — would force the close path to either
 *  read a dropped non-child row as `unreadable` (the wrong word) or re-list
 *  the registry on its own, which is the second spelling this export exists
 *  to prevent. */
export type ChildReclaimRowListing =
  | { readonly kind: 'unlistable' }
  | { readonly kind: 'listed'; readonly uuid: boolean; readonly child: boolean };

/** `readSessionRecord`'s `{ found: false, reason: 'absent' }` is TWO
 *  populations (its own docstring; wave 2's `childBindGate` reads it the same
 *  way): no `.uuid` in a listing that succeeded, AND a row `buildRecord`
 *  DROPPED — an identity field (`uuid`, `wrapper`, `workdir`) read back empty
 *  or listed-then-gone, or one the reconfirm listing lost. The second can be a
 *  LIVE, MARKED child, and calling it gone would cancel its outstanding mail
 *  with no feed row. So this lists the registry ONCE MORE, paid only on a
 *  miss, and returns WHAT it listed rather than an answer: each caller folds
 *  it into its own question (amendment A6).
 *
 *  Takes only the two ports it reads (`io`, `cfg`), not the whole
 *  `ChildReclaimDeps` — a caller with no `coord`/`runCcd` wired (the close
 *  path does not need them for this read) can call it without faking them.
 *
 *  TWO callers: the executor's own gone-check above, which folds `uuid ||
 *  child` into its `.uuid`-OR-`.child` rule, and the close path (Task 9,
 *  `childGateAtClose`, `close.ts`), the SECOND caller, folding `.child` ALONE
 *  (`none` when absent, `unreadable` when listed — controller ruling P5).
 *  Wave 2's `childBindGate` (`childBind.ts`) is NOT a caller: it takes its own
 *  `readdir` and asks the same `.child`-alone question independently — a
 *  parallel reader of the same registry, not a consumer of this export. */
export async function childReclaimRowListing(
  deps: Pick<ChildReclaimDeps, 'io' | 'cfg'>, sessionId: string,
): Promise<ChildReclaimRowListing> {
  const names = await deps.io.readdir(deps.cfg.registryDir);
  if (names === null) return { kind: 'unlistable' };
  return { kind: 'listed', uuid: names.includes(`${sessionId}.uuid`), child: names.includes(`${sessionId}.child`) };
}

/** The ONE place the executor cancels a child's mail — on `reclaimed`, and on
 *  a row step 1 itself measured ABSENT (a box half that finished without its
 *  cancel). Never on a refusal or a failure: the child is still there and may
 *  still read its mail. A throw here is logged, never allowed to turn a
 *  finished reclaim into a rejection. */
function childReclaimCancelMail(deps: ChildReclaimDeps, sessionId: string, why: 'reclaimed' | 'gone'): void {
  try {
    deps.coord.cancelDeliveriesTo(sessionId);
  } catch (err) {
    console.warn(`ccrc-server: cancelDeliveriesTo(${sessionId}) failed `
      + `(${err instanceof Error ? err.message : String(err)}) — ${why}; its outstanding mail stays queued`);
  }
}

/** A box word, turned into an outcome by the ONE kind map. The defensive
 *  `failed` fallback below is `resume: 'not-resumable'` — a refusal, in
 *  whichever ladder produced it, never advanced the box's destructive state —
 *  and is unreachable in practice, since this map's own equality with the
 *  defer vocabulary is held by `child-reclaim.test.ts`. */
function childReclaimRefusal(req: ChildReclaimRequest, token: ChildReclaimToken, detail: string): ChildReclaimOutcome {
  const { sessionId, runId } = req;
  switch (CHILD_RECLAIM_TOKEN_KIND[token]) {
    case 'gone': return { kind: 'gone', sessionId };
    // The kind map and the defer vocabulary are held equal by
    // `child-reclaim.test.ts`; a token marked `retry` that is no defer word is
    // answered as a failure, never cast into a reason it is not.
    case 'retry': return isChildReclaimDeferWhy(token)
      ? { kind: 'deferred', sessionId, runId, why: token, detail }
      : { kind: 'failed', sessionId, runId, resume: 'not-resumable',
          detail: `${token} is marked retry but is no defer reason` };
    case 'terminal': return { kind: 'refused', sessionId, runId, token, sentence: refusalSentence(token), detail };
  }
}

/** The audit — its own function so the verb-gate scanner reads its own gate:
 *  `ws-audit` is an old verb, asked the old question. The FLAG's question
 *  (`reclaim-v1`) was already answered in step 4. The EXIT STATUS is read
 *  before a byte of stdout: ANY exit 1 — the audit's own unmeasured answer, a
 *  reclaim document saying `"verdict":"unmeasured"`, included — is
 *  `unreadable` here and `failed` to the executor, whatever the document says,
 *  so no exit-1 document (a token-bearing one included) is ever spent. */
async function childReclaimAudit(deps: ChildReclaimDeps, req: ChildReclaimRequest): Promise<ChildReclaimAuditRead> {
  const argv = CCD_ARGV.wsReclaimAudit(req.sessionId, req.deferExpired);
  if (!verbSupported(deps.fleetState, argv)) return { kind: 'unreadable', detail: 'the fleet host cannot answer ws-audit' };
  const res = await deps.runCcd(argv);
  if (!res.ok) return { kind: 'unreadable', detail: `ws-audit --reclaim failed: ${res.stderr.trim()}` };
  return parseChildReclaimAudit(req.sessionId, res.stdout);
}

/** The act — its own function, and the capability asked AGAIN inside it, not
 *  merely in step 4: this is the scope `verb-gate.test.ts` reads for
 *  `ws-reclaim`'s gate, and the one line that must never run without it. */
async function childReclaimAct(
  deps: ChildReclaimDeps, req: ChildReclaimRequest, token: string,
): Promise<ChildReclaimVerbRead | 'unsupported'> {
  if (!capSupported(deps.fleetState, RECLAIM_CAP)) return 'unsupported';
  const argv = CCD_ARGV.wsReclaim(token, req.runId, req.sessionId, req.deferExpired,
    sweepDec(deps.fleetState, `run:${req.runId} reclaim ${req.trigger}`));
  const res = await deps.runCcd(argv);
  return parseChildReclaimResult(req.sessionId, res.stdout, res.stderr);
}

// ── the hold-release job ─────────────────────────────────────────────────────

/** A hold this build proved was written by one of a child's own runs, whose
 *  accounting has since retired — `childReclaimSweepVerdict`'s `hold-retired`
 *  verdict (`server/src/childReclaimSweep.ts`), and its `release` payload.
 *  `ws-reclaim`'s own rung 4 refuses any hold, so such a child can never
 *  become eligible through the ordinary path until its hold is released, and
 *  a hand-over hold is exactly what THIS build wrote for THIS child, never
 *  something to guess at by re-deriving it a second time here. */
export interface ChildReclaimReleaseRequest {
  readonly sessionId: string;
  readonly runId: number;
  readonly reason: string;
  readonly program: string;
  readonly accountedRunId: number;
}

/** `releaseRetiredChildHold`'s answer. `released`/`not-held` are ccd's own two
 *  documents for `ws-release` — both printed at exit 0, `cmd_ws_release`'s own
 *  idempotent design (`ccd/ccd`); `changed` is this job's OWN re-read finding
 *  a condition it relied on no longer holds, decided before ccd is ever
 *  called; `failed` is a throw, an `ok:false` read, an unsupported box, or a
 *  non-zero/unreadable ccd exit. */
export type ChildReclaimReleaseOutcome = 'released' | 'not-held' | 'changed' | 'failed';

/** The release job's `--actor`, kept inside ccd's cap on it
 *  (`LC_REASON_MAX_BYTES` bytes; ccd dies on a longer one). A programme name
 *  shaped by today's route is short, but a row written before that shaping
 *  may carry any length, and an over-cap actor would fail this child's
 *  release on every pass. The actor is this server's own attribution text,
 *  not a person's words, so it is SHORTENED to fit — the programme name cut
 *  at a code point and marked with an ellipsis — never refused. */
export function childReclaimReleaseActor(runId: number, program: string): string {
  const actor = (p: string): string => `run:${runId} reclaim sweep: program ${p} retired`;
  const bytes = (t: string): number => new TextEncoder().encode(t).length;
  if (bytes(actor(program)) <= LC_REASON_MAX_BYTES) return actor(program);
  // Every code point is at least one byte, so no fitting cut keeps more than
  // the cap's own count of them: the search starts there, not at the end.
  const points = Array.from(program);
  let keep = Math.min(points.length, LC_REASON_MAX_BYTES);
  while (keep > 0 && bytes(actor(`${points.slice(0, keep).join('')}…`)) > LC_REASON_MAX_BYTES) keep -= 1;
  return actor(`${points.slice(0, keep).join('')}…`);
}

/**
 * Release a hold this build proved belongs to one of a child's own runs, once
 * that accounting has retired (spec §5.7's "no hold" conjunct). The sweep
 * queues this on the child's own `KeyedQueue` key after TWO CONSECUTIVE
 * `hold-retired` passes, never on the first — a transient read glitch must
 * not fire it. By the time this job runs the deciding pass may be minutes
 * old, so it re-reads EVERY fact it relied on, in order, before it ever
 * touches the box:
 *   1. the row — the marker still names `runId`, and the held text is still
 *      the exact trimmed bytes this job was queued with;
 *   2. the accounting — `accountedRunId` is still a TERMINAL run, and its
 *      CURRENT fields render to the row's CURRENT held text (re-derived
 *      fresh, never compared against the cached `reason` a second time —
 *      only against a rendering built from what this re-read just measured).
 *      A terminal run's own fields do not move in the live system — this
 *      re-derivation is defence in depth, not a path a live rollback or
 *      re-dispatch can actually reach, since a terminal `r`'s identity is
 *      immutable (see the check's own comment below);
 *   3. that run's programme — still zero open runs;
 *   4. the child's own open runs — still none;
 *   5. the coordinator read — this child has still not coordinated in its own
 *      generation (`childReclaimHasCoordinated`, the fence the close and the
 *      executor's step 2a decide through);
 *   6. the reclaim switch (`childReclaimPauseRead`, the read the executor's
 *      own step 2b makes) — still down. A release queued behind the child's
 *      `KeyedQueue` before an operator raised `reclaim-paused` must not
 *      remove the hold the operator may have raised the switch to keep:
 *      `cmd_ws_release` does not read the marker itself. `set` answers
 *      `changed`; `unmeasurable` answers `failed`.
 * A throw or an `ok:false` from any of these answers `failed` and composes no
 * argv — never a guess standing in for a read this process could not finish.
 * Only once every one of them agrees does it compose `ws-release`, gated by
 * `verbSupported` exactly as the close route gates the same verb.
 *
 * THE RESIDUAL, ACCEPTED: a hold written between this job's last re-read and
 * ccd's own unlink is removed anyway — that window is under a second (one
 * agent exec, ccd startup, its journal write), and a hand hold lost this way
 * is reclaimed two passes later by the ordinary path, which pins its commits
 * and uncommitted work but not its pane, clips, temp root or ignored files. A
 * re-bind inside that same window stays protected by its own open run and is
 * re-held at its own dispatch. A hand hold byte-identical to the server's own
 * last-written claim is treated as that claim — this job cannot tell the two
 * apart, and nothing here tries to: parsing a hold back is exactly what this
 * whole lane refuses to do (`run-routes.test.ts`'s "NOTHING in the tree
 * parses one back").
 *
 * NEVER PARSES a hold: every comparison below is byte equality against a
 * RENDERING (`holdReason`), never a scan for structure inside the text
 * itself.
 */
export async function releaseRetiredChildHold(
  deps: ChildReclaimDeps, req: ChildReclaimReleaseRequest,
): Promise<ChildReclaimReleaseOutcome> {
  const { sessionId, runId, reason, program, accountedRunId } = req;

  // 1 — the row: the marker still names this run, and the held text is
  // still the exact bytes this job was queued with.
  let read: Awaited<ReturnType<typeof readSessionRecord>>;
  try {
    read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  } catch (err) {
    console.warn(`ccrc-server: releaseRetiredChildHold: reading ${sessionId}'s row failed `
      + `(${err instanceof Error ? err.message : String(err)})`);
    return 'failed';
  }
  if (!read.found) return read.reason === 'unlistable' ? 'failed' : 'changed';
  const mark = read.record.child;
  if (mark.kind !== 'child' || mark.runId !== runId) return 'changed';
  if (read.record.held === null || read.record.held.trim() !== reason) return 'changed';

  // 2 — the accounting: `accountedRunId` is still a TERMINAL run, and its
  // CURRENT fields still render to the CURRENT held text.
  let accounted: ReturnType<CoordStore['run']>;
  try {
    accounted = deps.coord.run(accountedRunId);
  } catch (err) {
    console.warn(`ccrc-server: releaseRetiredChildHold: re-reading run ${accountedRunId} failed `
      + `(${err instanceof Error ? err.message : String(err)})`);
    return 'failed';
  }
  if (!accounted.ok) return 'failed';
  const r = accounted.run;
  // NOT independently re-checked here: that `r` still NAMES this child (its
  // `sessionId` or its own id is still the candidate a match was found
  // against). A terminal run's identity is immutable — `clearSession` only
  // ever nulls a `'planned'` row, and every `bindSession` caller binds an
  // OPEN run — so a terminal `r` cannot have moved off this child between
  // the deciding pass and this re-read. The re-derived rendering below is
  // what actually re-proves the accounting; this comment states the
  // dependency it stands on rather than repeating a check nothing can fail.
  if (r === null || !isChildReclaimTerminalState(r.state)) return 'changed';
  const open = holdReason(r.program, r.wave, r.waveOf, r.id);
  const close = holdReason(r.program, r.wave + 1, r.waveOf, null);
  if (reason !== open && reason !== close) return 'changed';

  // 3 — that run's programme, re-counted: still zero open runs.
  let count: number;
  try {
    count = deps.coord.programOpenRunCount(r.program);
  } catch (err) {
    console.warn(`ccrc-server: releaseRetiredChildHold: re-counting ${r.program}'s open runs failed `
      + `(${err instanceof Error ? err.message : String(err)})`);
    return 'failed';
  }
  if (count > 0) return 'changed';

  // 4 — the child's own open runs: still none. `openRunsForSession` throws
  // bare (its `db.prepare().all()` sits outside any catch in `store.ts`), so
  // this is its own try like every other read above — never a throw that
  // rejects the job instead of answering `failed`.
  let sib: ReturnType<CoordStore['openRunsForSession']>;
  try {
    sib = deps.coord.openRunsForSession(sessionId);
  } catch (err) {
    console.warn(`ccrc-server: releaseRetiredChildHold: re-reading ${sessionId}'s open siblings failed `
      + `(${err instanceof Error ? err.message : String(err)})`);
    return 'failed';
  }
  if (!sib.ok) return 'failed';
  if (sib.siblings.length > 0) return 'changed';

  // 5 — the coordinator read: this child has still not coordinated in its own
  // generation (`childReclaimHasCoordinated`; spec §1 rule 4, spec §5.6). The
  // same fence the sweep's verdict reads, so a child the sweep calls
  // `hold-retired` is never `changed` here on a claim an earlier workspace
  // under the same slug made.
  try {
    if (childReclaimHasCoordinated(deps.coord, sessionId, (deps.now ?? Date.now)())) return 'changed';
  } catch (err) {
    console.warn(`ccrc-server: releaseRetiredChildHold: re-reading ${sessionId}'s coordination history failed `
      + `(${err instanceof Error ? err.message : String(err)})`);
    return 'failed';
  }

  // 6 — the reclaim switch: still down. Read last, nearest the argv, like
  // the executor's own step 2b.
  let pause: MarkerState;
  try {
    pause = await childReclaimPauseRead(deps.io, deps.cfg.registryDir);
  } catch (err) {
    console.warn(`ccrc-server: releaseRetiredChildHold: reading the reclaim switch failed `
      + `(${err instanceof Error ? err.message : String(err)})`);
    return 'failed';
  }
  if (pause === 'set') return 'changed';
  if (pause !== 'clear') return 'failed';

  // Only now: the one write this job may ever compose. It deletes nothing
  // but the hold file (`cmd_ws_release`'s own docstring).
  const argv = CCD_ARGV.wsRelease(sessionId, sweepDec(deps.fleetState, childReclaimReleaseActor(runId, program)));
  if (!verbSupported(deps.fleetState, argv)) return 'failed';
  const res = await deps.runCcd(argv);
  if (!res.ok) return 'failed';
  const out = res.stdout.trim();
  if (out === `released ${sessionId}`) return 'released';
  if (out === `not held ${sessionId}`) return 'not-held';
  return 'failed';
}

// ── the feed row ─────────────────────────────────────────────────────────────

const CHILD_RECLAIM_FEED_TITLE: Readonly<Record<Exclude<ChildReclaimOutcome['kind'], 'gone'>, string>> = {
  reclaimed: 'child reclaimed',
  deferred: 'child reclaim deferred',
  refused: 'child reclaim refused',
  failed: 'child reclaim failed',
};

const childReclaimMinutes = (n: number): string => (n === 1 ? '1 minute' : `${n} minutes`);

/** HOW LONG IT WAITED, AND WHY — the sentence spec §5.7 and §5.9 ask of the
 *  feed row, rendered from the request. Whole minutes,
 *  floored; a clock that reads earlier than the first deferral answers 0,
 *  never a negative wait.
 *   - A ceiling-expired attempt (`deferExpired`), WHATEVER its outcome, says
 *     the wait it ended and why it went ahead past presence.
 *   - A `deferred` outcome from the sweep says how long so far — its `why` and
 *     `detail` already say why.
 *   - Anything else, and everything from close (`deferredSinceMs: null`, a
 *     first attempt), says nothing about a wait: there was none. */
function childReclaimWaitText(o: Exclude<ChildReclaimOutcome, { kind: 'gone' }>, req: ChildReclaimRequest,
  nowMs: number): string {
  const waited = req.deferredSinceMs === null ? null
    : childReclaimMinutes(Math.max(0, Math.floor((nowMs - req.deferredSinceMs) / 60_000)));
  if (req.deferExpired) {
    return ` The defer ceiling was reached after ${waited ?? 'an unrecorded time'} of deferral, so presence, `
      + 'an attached terminal and a git operation in progress no longer held it back.';
  }
  return o.kind === 'deferred' && waited !== null ? ` Deferred for ${waited} so far.` : '';
}

const childReclaimSentence = (t: string): string => (/[.!?]$/.test(t) ? t : `${t}.`);

/** What a reclaim left uncommitted, in words (spec §5.5 step 2). "Nothing
 *  uncommitted was left" is said ONLY when there is no WIP commit AND ccd
 *  counted no dropped secret-shaped path: a secret edit — a hidden-flag one
 *  included — is uncommitted work that was dropped and recorded, not nothing. */
function childReclaimWipText(wip: ChildReclaimWip, dropped: number | 'unreadable'): string {
  const secrets = dropped === 'unreadable' ? ' Whether a secret-shaped path was dropped could not be read.'
    : dropped === 0 ? ''
    : ` ${dropped} secret-shaped ${dropped === 1 ? 'path was' : 'paths were'} dropped, never committed — the record names ${dropped === 1 ? 'it' : 'them'}.`;
  switch (wip.kind) {
    case 'none': return (secrets === '' ? 'Nothing uncommitted was left.' : 'No work was committed.') + secrets;
    case 'unreadable': return 'Uncommitted work was pinned, but its commit id could not be read.' + secrets;
    case 'commit': return `Uncommitted work was pinned as ${wip.sha}.` + secrets;
  }
}

function childReclaimFeedBody(o: Exclude<ChildReclaimOutcome, { kind: 'gone' }>, req: ChildReclaimRequest,
  nowMs: number): string {
  const who = `${o.sessionId}, child of run #${o.runId}`;
  const wait = childReclaimWaitText(o, req, nowMs);
  switch (o.kind) {
    case 'reclaimed':
      return `${who}, was reclaimed (${req.trigger}). ${childReclaimWipText(o.wip, o.secretsDropped)}${wait}`;
    case 'deferred': return `${who}: reclaim deferred (${o.why}) — ${childReclaimSentence(o.detail)}${wait}`;
    case 'refused': return `${who}: ${o.sentence}${o.detail === '' ? '' : ` (${o.detail})`}${wait}`;
    // `resume` says what to promise the reader (fix round 1 review minor #4,
    // corrected fix round 2 minor C; three-way since review 170 fr-I m1).
    // `childReclaimSentence` (not a bare `.`) avoids doubling the punctuation
    // when `o.detail` already ends a sentence.
    case 'failed': {
      // `pre-lock-die` (review 170 F20, wording per fr-I m2, corrected per
      // fr-I rereview-r1 m2): the recogniser covers THREE families — an
      // argv/version die (usage, a malformed token/run id/session id), a
      // missing binary (python3, flock), and a lock/registry state die
      // (lock-unopenable: EISDIR, EACCES, a missing `$REG`) — and no single
      // named list of causes ("its own arguments, or ccd/python3/flock") is
      // true of all three; naming only that list pointed an operator at the
      // wrong thing for the third. The sentence stays CAUSE-NEUTRAL instead
      // and leaves the cause to `o.detail` — ccd's own message, rendered
      // immediately before this sentence — which already names it.
      const tail = o.resume === 'pre-lock-die'
        ? 'ccd refused the call before anything started; nothing was touched, and it refuses the same way every time until that changes.'
        // `resumable`: ccd's own tail genuinely started and left a
        // breadcrumb. `not-resumable`: an audit failure (never reached the
        // destructive path) or a verb answer that is a REFUSAL in substance
        // (an unrecognised word, or `reclaimed` naming another session) —
        // neither advanced this session's state, so neither has anything to
        // resume, but unlike a pre-lock die a plain retry MIGHT still work.
        : o.resume === 'resumable' ? 'It is retried; the box resumes where it stopped.' : 'It is retried from the start.';
      return `${who}: reclaim failed — ${childReclaimSentence(o.detail)} ${tail}${wait}`;
    }
  }
}

/**
 * ONE explicit feed row per outcome (spec §5.9). Explicit because it does not
 * come for free: a reclaim on an already-closed run is an observation, not a
 * transition, and the run-event lane skips observations — a design that
 * assumed a row would have delivered none. `kind: 'run'`, recorded and NEVER
 * pushed (the operator's ruling: every reclaim lands in the feed; no push per
 * reap). The `POST /api/coord/caps` pattern exactly: a missing log degrades
 * the record and never the act, `recordFeedEvent` throws synchronously and is
 * caught, and the flush is in a `finally` (D-1213's reason).
 */
function recordChildReclaimFeed(
  deps: ChildReclaimDeps, o: Exclude<ChildReclaimOutcome, { kind: 'gone' }>, req: ChildReclaimRequest,
): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    const ev = log.record({ kind: 'run', sessionId: o.sessionId, runId: o.runId,
      title: CHILD_RECLAIM_FEED_TITLE[o.kind], body: childReclaimFeedBody(o, req, (deps.now ?? Date.now)()) });
    deps.coord.recordFeedEvent(log.epoch, ev);
  } catch (err) {
    console.warn('ccrc-server: recordFeedEvent failed '
      + `(${err instanceof Error ? err.message : String(err)}) — child reclaim ${o.kind}, feed archive degraded`);
  } finally {
    void log.flush();
  }
}

/** The title of the one feed row a kept child writes (spec §5.9). */
export const CHILD_RECLAIM_KEPT_FEED_TITLE = 'child reclaim kept';

/**
 * ONE feed row for a child the sweep keeps on purpose (spec §5.9), in `recordChildReclaimFeed`'s idiom
 * exactly: `kind: 'run'`, recorded and NEVER pushed; a missing log degrades the record and never the
 * sweep; `recordFeedEvent` throws synchronously and is caught; the flush is in a `finally`. The caller
 * decides when to write it — once per child, per word, per process — so this writes whatever it is
 * handed, and the row says what the attention item says.
 */
export function recordChildReclaimKeptFeed(
  deps: Pick<ChildReclaimDeps, 'coord' | 'notifyLog'>, a: ChildReclaimKeptAttention,
): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    const ev = log.record({ kind: 'run', sessionId: a.sessionId, runId: a.runId,
      title: CHILD_RECLAIM_KEPT_FEED_TITLE, body: `${a.sessionId}, child of run #${a.runId}: ${a.sentence}` });
    deps.coord.recordFeedEvent(log.epoch, ev);
  } catch (err) {
    console.warn('ccrc-server: recordFeedEvent failed '
      + `(${err instanceof Error ? err.message : String(err)}) — child reclaim kept, feed archive degraded`);
  } finally {
    void log.flush();
  }
}

// ── Wave 5: the closed run's chip (spec §5.9) ───────────────────────────────
//
// THE ONE DERIVATION. `GET /api/runs` composes `RunSummary.childReclaim` through
// `withChildReclaim` and nothing else decides a word. Every sentence is the
// server's: a journal token's comes from `childReclaimTokenSentence` (the two
// server maps in their one documented order); a sweep verdict's comes from
// `CHILD_RECLAIM_SKIP`, the table every surface reads (spec §5.9); the words
// that have neither have theirs below. The generation fence, the latest-event
// pick and the token-kind lookup are wave 4's exports above, each the
// programme's one copy (spec §5.6: slugs recycle, so every read of the mirror is
// one generation's), called here and never re-spelled.

/** The chip's sentences for the answers neither a ws-reclaim token nor a sweep
 *  verdict carries. Each one is a claim the operator will act on, so each is
 *  true of a CHILD specifically:
 *   - `reclaimed`: the pin phase attic-pins before any destructive act (spec
 *     §5.5) and the transcripts are kept (spec §1);
 *   - `pending`: said only when the sweep's last verdict was eligible or an
 *     ordinary skip, never for a child it keeps or holds (spec §5.9);
 *   - `unjudged`: the watcher holds no verdict for the child yet (a restart, or
 *     a pass that judged nothing), so whether it will be reclaimed is not known
 *     and the sentence says that, never "waiting to be reclaimed" (spec §5.9);
 *   - `sweepDeferred`: a sweep defer is retried on its own, and it says what
 *     ends a wait on presence and promises no time (spec §5.7: only that wait
 *     has a ceiling, and the ceiling is on continuous deferral);
 *   - `sweepFailing`: the sweep's own attempts keep failing and ccd recorded no
 *     outcome for them, so the journal cannot say; the sweep backs off between
 *     tries (spec §5.9: "retries back off in between");
 *   - `failed`: a failure is left to the sweep (spec §5.7, "Any failure is
 *     recorded and left to the sweep");
 *   - `refusedNoReason`: ccd refused and journaled no token;
 *   - `fleetPaused`: the fleet-wide switch stops reclamation and nothing else.
 *     It says what the switch does and promises nothing about what follows,
 *     because it also stands over children the sweep keeps for a person
 *     (spec §5.8);
 *   - `reviewKept`: a review child outlives its own run until the run it
 *     reviewed is terminal (spec §5.7, "A review child is finished later than
 *     its own run"). */
export const CHILD_RECLAIM_STATUS_SENTENCE = {
  reclaimed: 'This workspace was reclaimed after its run closed. Its commits are pinned in the attic and its transcripts are kept.',
  pending: 'This run has closed. Its workspace is waiting to be reclaimed.',
  unjudged: 'This run has closed. The sweep has not judged its workspace yet, so whether it will be reclaimed is not known.',
  sweepDeferred: 'Reclamation of this workspace was put off, and the sweep retries it on its own. A wait on someone using it ends once the sweep has watched it continuously for 15 minutes, one such workspace at a time. Any other wait lasts until its cause clears.',
  sweepFailing: 'The sweep’s recent attempts to reclaim this workspace failed, and ccd recorded no outcome for them. It tries again on its own, backing off in between.',
  failed: 'The last reclamation attempt stopped partway. The sweep tries again on its own.',
  refusedNoReason: 'Reclamation was refused, and ccd recorded no reason for it.',
  fleetPaused: 'Reclamation is paused fleet-wide. This workspace is kept while the switch stands.',
  reviewKept: 'This review’s workspace is kept until the run it reviewed is known to have closed, because the report the coordinator cites lives in it. It is reclaimed once that run closes.',
} as const;

/** The one ws-reclaim token the chip reads as its own word rather than as a
 *  defer: `paused` is retryable, and saying `deferred` would hide the switch. */
const PAUSED_TOKEN: ChildReclaimToken = 'paused';

/** What every answer that promises the sweep will act on its own becomes while
 *  the fleet-wide switch stands (spec §5.8: pausing stops reclamation
 *  fleet-wide): nothing acts until it comes down. No time: the switch's own is
 *  not a fact this read has. */
const CHILD_RECLAIM_SWITCH_PAUSED: ChildReclaimStatus = {
  word: 'paused', sentence: CHILD_RECLAIM_STATUS_SENTENCE.fleetPaused, at: null,
};

/** A journal token's sentence, in the lookup order `lcRefusalWord`'s own
 *  docstring prescribes: `LC_REFUSAL_WORD` first, then the audit's `SENTENCES`
 *  through `refusalSentence`. Wave 3 journals a post-start failure
 *  (`pin-failed`, `unit-still-active`, ws-reap's reused `purge-*`) as an
 *  `LcRefusalToken`, whose word `SENTENCES` does not hold, so `refusalSentence`
 *  alone answers it `ccrc declined: <token>.`. The maps are disjoint
 *  (`lifecycle-refusal-word.test.ts`), so the order changes no ws-reclaim
 *  refusal's sentence. For a token this build cannot classify, that fallback
 *  is the sentence: the chip reads "refused with the sentence" (spec §5.9)
 *  rather than vanishing. */
const childReclaimTokenSentence = (token: string): string =>
  lcRefusalWord(token) ?? refusalSentence(token);

/** The four fields of a mirror row the chip reads. */
export type ChildReclaimEvent = Pick<MirroredLifecycleEvent, 'act' | 'outcome' | 'refusal' | 'at'>;

/**
 * What the registry says of a run's session, as the watcher last listed it.
 * FOUR answers, because the chip treats "never listed" and "listed, no row"
 * differently from a row, and a row's `ChildMark` is itself three-way (spec
 * §5.1). None of them folds into another.
 */
export type ChildReclaimRowView =
  | { readonly kind: 'unmeasured' }                       // the watcher has not listed the registry yet
  | { readonly kind: 'absent' }                           // listed; no row for this session
  | { readonly kind: 'row'; readonly child: ChildMark };  // listed; the row's own marker

/** The sweep's last verdict for this child, as the chip reads it (spec §5.9). `unjudged`: the
 *  watcher holds no verdict for this row. Either no judging pass has run since the server started,
 *  or the last one did not judge this row, or a pass that judged nothing (the switch, a missing
 *  capability, a failed read) dropped it because it was not a kept word. NEVER read as `eligible`. */
export type ChildReclaimChipVerdict =
  | { readonly kind: 'unjudged' }
  | { readonly kind: 'eligible' }
  | { readonly kind: 'skip'; readonly why: ChildReclaimSweepSkip };

export interface ChildReclaimStatusInput {
  readonly run: Pick<RunSummary, 'id' | 'state' | 'sessionId'>;
  /** The latest `reclaim` row of THIS run's workspace generation, of ANY
   *  outcome and an `intent` included, as wave 4's `childReclaimLatest` picks it
   *  from `childReclaimGeneration` at the run's `closedAt`; or null when that
   *  generation holds none. */
  readonly event: ChildReclaimEvent | null;
  readonly row: ChildReclaimRowView;
  /** A non-terminal run names this session: the child was handed to the next
   *  wave, and is in use rather than waiting. */
  readonly sessionHasOpenRun: boolean;
  /** This is a review run and the work run it reviews (`RunSummary.reviews`)
   *  is NOT KNOWN TO BE TERMINAL: open in the list, or absent from it. The
   *  child holds the report the coordinator cites (spec §5.7, "A review child
   *  is finished later than its own run"), and doubt keeps it. */
  readonly reviewedRunNotTerminal: boolean;
  /** The fleet-wide switch stands (`CoordStatus.reclaim === 'set'`, wave 4). */
  readonly fleetPaused: boolean;
  /** When wave 4's sweep FIRST deferred this session, for any reason
   *  (`firstDeferredAt`), or null when it holds no defer. Never the
   *  presence-only clock that drives the ceiling. */
  readonly deferredSince: number | null;
  /** The sweep's last recorded verdict for this child, or `unjudged` when the watcher holds none (spec §5.9). */
  readonly verdict: ChildReclaimChipVerdict;
  /** The sweep's in-memory entry is in a run of failed attempts (`consecutiveFailures > 0`). */
  readonly sweepFailing: boolean;
  /** When THIS generation's unbroken run of failure lines (`childReclaimFailureLine`) began,
   *  ONLY when that run has lasted the ceiling at the composer's clock; else null. */
  readonly journalFailingSince: number | null;
}

/**
 * THE ONE DERIVATION of a closed run's chip (spec §5.9, with §5.6's recycled
 * slugs, §5.7's review child and deferrals, and §5.8's switch). First match
 * wins:
 *
 * 1. A run that is not terminal, or has no session, says nothing. That rule is
 *    what makes the store's `childReclaim: null` on every other emitter the
 *    same answer rather than a second meaning (`RunSummary.childReclaim`).
 * 2. SETTLED, from the generation's latest event, of any outcome: done →
 *    reclaimed; a refusal whose token is of kind `gone` → nothing; a TERMINAL
 *    refusal (`no-worktree-record` among them) → refused. None of these reads
 *    the registry: a reclaimed child's row is gone by design, and the mirror is
 *    the durable record (spec §5.9). A terminal refusal is ccd's own settled
 *    word, and the attention list's terminal arm lists the child in the same
 *    sentence.
 * 3. THE SWEEP'S LAST VERDICT, where the gate holds (the registry, as last
 *    listed, still carries a `ChildMark` naming THIS run, and no open run names
 *    the session): a KEPT word → refused, never replaced by the switch; a
 *    DOUBT or HELD word → deferred. It answers ahead of every event below it,
 *    because an older answer must not promise a retry the sweep will not make
 *    (a person's hold, or a coordinator's chair, outlasts a failure).
 * 4. THE REMAINING EVENTS:
 *    - a FAILURE LINE (`childReclaimFailureLine`: `failed`, or a refusal with
 *      one of the two pre-lock tokens) → deferred, in the attention list's own
 *      sentence once its run has lasted the ceiling;
 *    - refused with no token → refused;
 *    - the `paused` token → paused;
 *    - retry → deferred;
 *    - a token this build cannot classify → refused, through
 *      `refusalSentence`'s fallback;
 *    - `intent` / `unknown` (an act with no recorded end, an attempt in flight
 *      or one that died mid-way) → the row rule, because a registry row still
 *      carrying this run's marker is evidence the workspace is still there.
 * 5. THE ROW RULE, where the gate holds:
 *    - a review child whose reviewed run is not known to be terminal → pending,
 *      kept for the report;
 *    - a run of sweep failures → deferred;
 *    - a sweep defer → deferred;
 *    - an eligible verdict, or an ordinary skip → pending;
 *    - no verdict yet → pending, with its own sentence and never the eligible
 *      one.
 *    Anything short of the gate says nothing. An unreadable marker, or one
 *    naming another run (a recycled slug, or the hand-over wave's own row),
 *    cannot be said to be this run's.
 *
 * THE SWITCH replaces every answer that promises the sweep will act on its own
 * (pending, and every deferred) with `CHILD_RECLAIM_SWITCH_PAUSED`, and nothing
 * else: a settled answer stays settled, a kept one stays kept, the on-box
 * `paused` token keeps its own sentence and time, and a review child is kept by
 * its reviewed run, not by the switch.
 */
export function childReclaimStatus(input: ChildReclaimStatusInput): ChildReclaimStatus | null {
  const { run, event } = input;
  if (run.sessionId === null || !isChildReclaimTerminalState(run.state)) return null;
  const waiting = (s: ChildReclaimStatus): ChildReclaimStatus => (input.fleetPaused ? CHILD_RECLAIM_SWITCH_PAUSED : s);
  const token = event === null || event.refusal === null || event.refusal === '' ? null : event.refusal;
  const kind = token === null ? null : childReclaimTokenKind(token);
  // SETTLED (spec §5.9): a done reclaim, a row ccd found gone, and a TERMINAL refusal. The last is
  // what the attention list's terminal arm lists for this child, in the same sentence.
  if (event !== null) {
    if (event.outcome === 'done') {
      return { word: 'reclaimed', sentence: CHILD_RECLAIM_STATUS_SENTENCE.reclaimed, at: event.at };
    }
    if (event.outcome === 'refused' && token !== null) {
      if (kind === 'gone') return null;
      if (kind === 'terminal') return { word: 'refused', sentence: childReclaimTokenSentence(token), at: event.at };
    }
  }
  const row = input.row;
  const marked = row.kind === 'row' && row.child.kind === 'child' && row.child.runId === run.id
    && !input.sessionHasOpenRun;
  // THE SWEEP'S LAST VERDICT (spec §5.9), ahead of every retryable or failure event: a measured
  // reason the sweep keeps or waits on outranks an older answer that promises a retry it will not make.
  if (marked && input.verdict.kind === 'skip') {
    const skip = CHILD_RECLAIM_SKIP[input.verdict.why];
    // KEPT: settled until a person acts. The switch never replaces it.
    if (skip.class === 'kept') return { word: 'refused', sentence: skip.sentence, at: null };
    if (skip.class !== 'ordinary') return waiting({ word: 'deferred', sentence: skip.sentence, at: null });
  }
  if (event !== null) {
    // A FAILURE LINE (spec §5.9): `failed`, or a refusal with one of the two pre-lock tokens, which
    // the executor and the sweep retry. The SAME predicate the attention list's failing arm reads.
    if (childReclaimFailureLine(event)) {
      const word = token === null ? null : childReclaimTokenSentence(token);
      if (input.journalFailingSince !== null) {
        return waiting({ word: 'deferred', sentence: childReclaimFailingSentence(word), at: input.journalFailingSince });
      }
      return waiting({ word: 'deferred', sentence: word ?? CHILD_RECLAIM_STATUS_SENTENCE.failed, at: event.at });
    }
    if (event.outcome === 'refused') {
      if (token === null) {
        return { word: 'refused', sentence: CHILD_RECLAIM_STATUS_SENTENCE.refusedNoReason, at: event.at };
      }
      if (token === PAUSED_TOKEN) return { word: 'paused', sentence: childReclaimTokenSentence(token), at: event.at };
      if (kind === 'retry') return waiting({ word: 'deferred', sentence: childReclaimTokenSentence(token), at: event.at });
      // A token this build was never compiled to know (`kind` null) and not a pre-lock token:
      // refused, through `refusalSentence`'s fallback naming it (spec §5.9).
      return { word: 'refused', sentence: childReclaimTokenSentence(token), at: event.at };
    }
    // `intent` / `unknown`: an act with no recorded end, newer than any outcome in this
    // generation. An older attempt's answer is not this one's: fall through to the row rule.
  }
  if (!marked) return null;
  if (input.reviewedRunNotTerminal) return { word: 'pending', sentence: CHILD_RECLAIM_STATUS_SENTENCE.reviewKept, at: null };
  if (input.sweepFailing) return waiting({ word: 'deferred', sentence: CHILD_RECLAIM_STATUS_SENTENCE.sweepFailing, at: null });
  if (input.deferredSince !== null) {
    return waiting({ word: 'deferred', sentence: CHILD_RECLAIM_STATUS_SENTENCE.sweepDeferred, at: input.deferredSince });
  }
  // `unjudged` is never `eligible`: "waiting to be reclaimed" only after a verdict says so.
  return waiting({ word: 'pending',
    sentence: input.verdict.kind === 'unjudged' ? CHILD_RECLAIM_STATUS_SENTENCE.unjudged : CHILD_RECLAIM_STATUS_SENTENCE.pending,
    at: null });
}

/** The sessions whose mirror rows a board needs: terminal rows that carry both a
 *  session and a `closedAt`, each once. A row without `closedAt` (a
 *  reconstructed one) has no generation to fence, so nothing is asked for it. */
export function childReclaimSessions(runs: readonly RunSummary[]): string[] {
  const out = new Set<string>();
  for (const r of runs) {
    if (r.sessionId !== null && r.closedAt !== null && isChildReclaimTerminalState(r.state)) out.add(r.sessionId);
  }
  return [...out];
}

/** What `withChildReclaim` composes from. Every piece is already in memory
 *  or already read, so composition does no I/O of its own. */
export interface ChildReclaimSources {
  /** `CoordStore.childReclaimEvents(childReclaimSessions(runs))`, which answers every id it was asked. */
  readonly events: ReadonlyMap<string, readonly MirroredLifecycleEvent[]>;
  /** The watcher's last LISTED registry read, or null when it has listed none. */
  readonly marks: ReadonlyMap<string, ChildMark> | null;
  /** Wave 4's sweep state, read-only (`FleetWatcher.currentChildReclaimDefers()`),
   *  and read structurally, for two fields: `firstDeferredAt`, the FIRST
   *  deferral of any kind, and `consecutiveFailures`, the entry's run of failed
   *  attempts. The entry's decision clocks, among them the presence-only one
   *  that drives the defer ceiling (spec §5.7), are deliberately not declared
   *  here: the chip dates a defer from its start, whatever its cause.
   *  THE MAP'S LIMITS: it is in memory, so a restart empties it; it is cleared
   *  whole while the switch stands, when a capability is missing and when the
   *  mirror read fails; an entry exists only after an eligible verdict, and an
   *  ineligible verdict deletes it; and `firstDeferredAt` never resets within an
   *  entry's life. An entry whose `firstDeferredAt` is null is tracked but NOT
   *  deferring. */
  readonly defers: ReadonlyMap<string, { readonly firstDeferredAt: number | null; readonly consecutiveFailures: number }>;
  /** `FleetWatcher.currentChildReclaimVerdicts()`: null is "no judging pass since this process
   *  started", never an empty map; an id absent from a map was not judged. */
  readonly verdicts: ReadonlyMap<string, ChildReclaimSweepVerdict> | null;
  /** Wave 4's fleet-wide switch as the watcher last measured it
   *  (`currentCoord()?.reclaim === 'set'`). `unmeasurable` and "never
   *  measured" are false: the chip then says what it would say anyway, and
   *  claims no switch it did not see. */
  readonly fleetPaused: boolean;
  /** The composer's wall clock (epoch ms), for the failure ceiling. An argument: this file decides, it reads no clock. */
  readonly nowMs: number;
}

/**
 * `RunSummary[]` → the same rows with `childReclaim` composed. "Another run is
 * open on this session" and "the run this review reviewed is terminal" are
 * both derived from THIS list. `GET /api/runs?closed=1` carries every open run
 * uncapped (`CoordStore.runs`'s asymmetric clamp), so "open on this session" is
 * complete wherever a terminal row can appear. "Terminal" is not: the list
 * caps closed runs, so a reviewed run it does not carry is NOT KNOWN to be
 * terminal, and the review child is kept (spec §5.7: its report outlives its
 * own run). The cost of that direction is a stale "kept" on a child the sweep
 * reclaims, which the next read corrects off the mirror; the other direction
 * would promise a reclaim of a report still being cited. A list without
 * `?closed=1` carries no terminal row, so every answer there is null anyway.
 *
 * THE EVENT is wave 4's `childReclaimLatest` over wave 4's
 * `childReclaimGeneration`, read at the run's own `closedAt` (spec §5.6: slugs
 * recycle): the attention list reads the same two functions at now, and
 * nothing here re-implements either. THE FAILURE RUN is
 * `childReclaimJournalRow`'s, read over that same generation, so the chip and
 * the attention list date a run of failures from the same line.
 */
export function withChildReclaim(runs: readonly RunSummary[], src: ChildReclaimSources): RunSummary[] {
  const open = new Set<string>();
  const terminalRunIds = new Set<number>();
  for (const r of runs) {
    if (isChildReclaimTerminalState(r.state)) { terminalRunIds.add(r.id); continue; }
    if (r.sessionId !== null) open.add(r.sessionId);
  }
  return runs.map((run) => {
    const sid = run.sessionId;
    // `?? []` is not a default for a missing key: `childReclaimEvents` answers
    // every id `childReclaimSessions` names, and a session it was not asked
    // about belongs to a row the derivation answers null for before reading this.
    const gen = sid === null || run.closedAt === null
      ? [] : childReclaimGeneration(src.events.get(sid) ?? [], run.closedAt);
    const event = childReclaimLatest(gen);
    const journal = childReclaimJournalRow(gen, event);
    const mark = sid === null || src.marks === null ? undefined : src.marks.get(sid);
    const row: ChildReclaimRowView = src.marks === null
      ? { kind: 'unmeasured' }
      : mark === undefined ? { kind: 'absent' } : { kind: 'row', child: mark };
    const judged = sid === null || src.verdicts === null ? undefined : src.verdicts.get(sid);
    const entry = sid === null ? undefined : src.defers.get(sid);
    return {
      ...run,
      childReclaim: childReclaimStatus({
        run, event, row,
        sessionHasOpenRun: sid !== null && open.has(sid),
        // `typeof`, not `!== null`: a row from an older server omits `reviews`,
        // and absence means a work run, the only kind it knew. A reviewed run
        // ABSENT from this list is not known terminal, so it keeps the child.
        reviewedRunNotTerminal: typeof run.reviews === 'number' && !terminalRunIds.has(run.reviews),
        fleetPaused: src.fleetPaused,
        deferredSince: entry?.firstDeferredAt ?? null,
        verdict: judged === undefined ? { kind: 'unjudged' }
          : judged.eligible ? { kind: 'eligible' } : { kind: 'skip', why: judged.why },
        sweepFailing: (entry?.consecutiveFailures ?? 0) > 0,
        journalFailingSince: journal !== null && childReclaimFailingPastCeiling(journal, src.nowMs)
          ? journal.failingSince : null,
      }),
    };
  });
}
// ── end wave 5 chip ──
