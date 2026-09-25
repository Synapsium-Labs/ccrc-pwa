import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { Presence } from '../presence.js';
import type { NotifyLog } from '../notifylog.js';
import { CCD_ARGV, RECLAIM_CAP, capSupported, sweepDec, verbSupported } from '../ccdargv.js';
import { readSessionRecord } from '../registry.js';
import { refusalSentence } from '../wsaudit.js';
import type { ChildSpentVerdict } from './childSpent.js';
import type { CoordStore, OpenSiblingsResult } from './store.js';
import { CHILD_RUN_ID, TERMINAL_RUN_STATES, type ChildMark, type RunState } from '../../../shared/api.js';

/**
 * CHILD-WORKSPACE RECLAMATION, the server half (spec 2026-09-22 §5.5–§5.7).
 *
 * `close.ts`'s kind of file: an L1 decision reached through declared ports.
 * Three things live here and nowhere else —
 *   - the fourteen words `ccd ws-reclaim` and `ccd ws-audit --reclaim` answer
 *     with, and what each one MEANS to the server (gone / terminal / retry);
 *   - `childReclaimDecision`, the pure "has the coordinator finished with this
 *     child" predicate `closeRun` asks inside the coordination mutex;
 *   - `reclaimChild`, THE ONE EXECUTOR. The close path hands it a request on
 *     the session's own queue; wave 4's sweep hands it the same request. So
 *     presence, the capability gate and the feed row behave identically
 *     however a reclaim was started.
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

export type ChildReclaimOutcome =
  | { readonly kind: 'reclaimed'; readonly sessionId: string; readonly runId: number;
      readonly wip: string | null | 'unreadable' }
  | { readonly kind: 'deferred'; readonly sessionId: string; readonly runId: number; readonly why: ChildReclaimDeferWhy; readonly detail: string }
  | { readonly kind: 'refused'; readonly sessionId: string; readonly runId: number; readonly token: ChildReclaimToken; readonly sentence: string; readonly detail: string }
  | { readonly kind: 'gone'; readonly sessionId: string }
  /** `resumable` says whether the box left a breadcrumb the next attempt can
   *  pick up FROM (fix round 1 review minor #4, corrected in fix round 2
   *  minor C): true only for a `ws-reclaim` failure that genuinely started —
   *  its own `{failed:…}` document at exit 1, or a call cut short with
   *  nothing printed (ccd's breadcrumb survives either). False for
   *  `ws-audit --reclaim` itself (a non-destructive verb that never reaches
   *  the reap lock), and for a `ws-reclaim` answer that is a REFUSAL in
   *  substance even though this build cannot name it — an unrecognised
   *  refusal word, or a `reclaimed` document naming another session — where
   *  ccd's own ladder never advanced this session's state at all. The feed
   *  text must not promise a resume where there is nothing to resume. */
  | { readonly kind: 'failed'; readonly sessionId: string; readonly runId: number;
      readonly resumable: boolean; readonly detail: string };

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
 *  have — this workspace; `review-report-live` is a REVIEW child kept while the
 *  run it reviewed is not terminal, because the coordinator cites the report
 *  in its clips by path (spec §5.7); `not-finished` is the ordinary
 *  non-final close. */
export type ChildReclaimNotWhy =
  | 'not-a-child' | 'marker-unreadable' | 'siblings-open' | 'siblings-unreadable' | 'review-report-live'
  | 'not-finished';

const CHILD_RECLAIM_NOT_WHY: Readonly<Record<ChildReclaimNotWhy, true>> = {
  'not-a-child': true, 'marker-unreadable': true, 'siblings-open': true, 'siblings-unreadable': true,
  'review-report-live': true, 'not-finished': true,
};

export type ChildReclaimDecision =
  | { readonly reclaim: true }
  | { readonly reclaim: false; readonly why: ChildReclaimNotWhy };

/** The minting run's row, read by the id the marker names — the SERVER's half
 *  of spec §5.1's two authorities. Three answers, never two. `reviews` is the
 *  row's own column: the work run a REVIEW run reads, `null` on a work run.
 *  `dispatchStartedAt` is the same column `childBirthOf` reads (`childSpent.ts`)
 *  — carried here so the close (Task 9) can place a fast-path spent verdict's
 *  evidence against this child's own birth before it decides; it plays no
 *  part in `childReclaimDecision`'s own logic, which reads only `spent.kind`
 *  and `spent.incarnation`, already resolved by the caller. */
export type ChildReclaimMinting =
  | { readonly kind: 'row'; readonly sessionId: string | null; readonly reviews: number | null;
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
  /** No OTHER open run of this run's program: `CoordStore.programOpenRunCount`
   *  with this run excluded — D-51's predicate, not a second spelling. */
  readonly retiresProgram: boolean;
}

/**
 * Has the coordinator FINISHED with this child? (spec §5.7). Eligible iff
 * child ∧ no open sibling ∧ (final ∨ spent-and-proven-this-incarnation ∨ an
 * abandon ∨ this close retires the program). "No open sibling" ALONE is also
 * true on the ordinary non-final close, which is claiming the child for wave
 * N+1 — reclaiming on it would be the 2026-09-10 harm through a new door.
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
 * never reclaims on a guess.
 */
export function childReclaimDecision(input: ChildReclaimDecisionInput): ChildReclaimDecision {
  const no = (why: ChildReclaimNotWhy): ChildReclaimDecision => ({ reclaim: false, why });
  if (input.mark.kind === 'none') return no('not-a-child');
  if (input.mark.kind === 'unreadable') return no('marker-unreadable');
  if (input.minting.kind === 'unreadable') return no('marker-unreadable');
  if (input.minting.kind === 'absent' || input.minting.sessionId !== input.sessionId) return no('not-a-child');
  if (!input.siblings.ok) return no('siblings-unreadable');
  if (input.siblings.siblings.length > 0) return no('siblings-open');
  if (input.minting.reviews !== null) {
    if (input.reviewed.kind === 'unreadable') return no('marker-unreadable');
    if (input.reviewed.kind !== 'row' || !isChildReclaimTerminalState(input.reviewed.state)) return no('review-report-live');
  }
  const finished = input.final || input.state === 'failed' || input.retiresProgram
    || (input.spent.kind === 'spent' && input.spent.incarnation === 'this');
  return finished ? { reclaim: true } : no('not-finished');
}

/** `mail-routes.test.ts`'s kebab scanner reads every quoted hyphenated literal
 *  in `server/src/coord` and admits it through an exported guard per
 *  vocabulary. This file's three vocabularies — the box's tokens, the defer
 *  reasons and the close decision's reasons — plus close's `not-queued`, are
 *  one family, admitted here, so a word added to any of the three types is
 *  accepted and a typo is not. Deliberately NOT named `isChildReclaimWord`:
 *  wave 5 owns that name, in `shared/api.ts`, as the type guard of the run
 *  chip's `ChildReclaimWord` vocabulary (spec §5.9) — a different set with a
 *  different meaning. */
export function isChildReclaimKebab(v: unknown): boolean {
  return isChildReclaimToken(v) || isChildReclaimDeferWhy(v)
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

/** `ccd ws-reclaim …`'s answer. Three documents (spec §5.6): `reclaimed` and
 *  `refused` at exit 0, `failed` at exit 1 — and a fourth condition that is
 *  not a document at all, a call cut short with nothing printed, which is
 *  `failed` too: the breadcrumb on the box resumes it on the next attempt. */
export type ChildReclaimVerbRead =
  /** `wip`: `null` — ccd printed a LITERAL `null`, genuinely nothing
   *  uncommitted (fix round 2, review minor B: ONLY `null` means this — a
   *  present non-string value, a number, boolean or object, and a MISSING
   *  key all read `'unreadable'`, exactly like a malformed string); a string
   *  — the pinned commit id, 40 or 64 lower-hex; `'unreadable'` — a `wip`
   *  this build cannot attribute to a commit, whatever shape it took (fix
   *  round 1, review minor #2) — work MAY still be pinned (the attic holds
   *  it either way), but the feed must not claim nothing was left when it
   *  cannot read what was. */
  | { readonly kind: 'reclaimed'; readonly wip: string | null | 'unreadable' }
  | { readonly kind: 'refused'; readonly token: ChildReclaimToken; readonly detail: string }
  /** `resumable` (fix round 2, review minor C): true only when ccd's own
   *  destructive tail genuinely started and left a breadcrumb — a
   *  `{failed:…}` document, or a call cut short with nothing printed. An
   *  unrecognised refusal word and a `reclaimed` document naming another
   *  session are REFUSALS in substance (ccd's ladder never advanced this
   *  session's state), so neither is resumable. */
  | { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string };

export function parseChildReclaimResult(sessionId: string, stdout: string, stderr: string): ChildReclaimVerbRead {
  let v: unknown = null;
  try { v = JSON.parse(stdout.trim()); } catch { v = null; }
  if (isRecord(v)) {
    if (typeof v.reclaimed === 'string') {
      if (v.reclaimed !== sessionId) {
        return { kind: 'failed', resumable: false,
          detail: `ws-reclaim reported reclaiming ${v.reclaimed}, not ${sessionId}` };
      }
      const wip = v.wip === null ? null : (typeof v.wip === 'string' && WIP_SHAPE.test(v.wip) ? v.wip : 'unreadable');
      return { kind: 'reclaimed', wip };
    }
    if (typeof v.refused === 'string') {
      const detail = typeof v.detail === 'string' ? v.detail : '';
      return isChildReclaimToken(v.refused)
        ? { kind: 'refused', token: v.refused, detail }
        : { kind: 'failed', resumable: false,
            detail: `ws-reclaim refused with a word this build does not know: ${v.refused}` };
    }
    if (typeof v.failed === 'string') {
      // Fix round 2, review minor C: an empty `detail` must not render
      // "…failed: ." — omit the separator rather than leave it dangling.
      const detail = typeof v.detail === 'string' ? v.detail : '';
      return { kind: 'failed', resumable: true, detail: detail === '' ? v.failed : `${v.failed}: ${detail}` };
    }
  }
  const err = stderr.trim();
  return { kind: 'failed', resumable: true,
    detail: err === '' ? 'ws-reclaim answered nothing — it may have been cut short; the next attempt resumes it' : err };
}

// ── the ONE executor ─────────────────────────────────────────────────────────

/**
 * Reclaim ONE child, from either trigger (spec §5.7). Re-reads everything it
 * decides on — the marker against `req.runId`, the open siblings, presence,
 * the capability — then `ws-audit --reclaim` → token → `ws-reclaim`. On
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
  // WAVE 4 ADDS THE SERVER-SIDE PAUSE READ HERE (spec §5.8: the close path
  // and the sweep skip): a `paused-at-server` deferral through `deferred(…)`
  // above when the registry carries `RECLAIM_PAUSE_MARKER`, before presence,
  // the capability or any argv — an early skip that returns through this
  // function's one exit like every other outcome, never inside the
  // `reclaimChild` wrapper. ccd's own rung 3, read on the box at the instant
  // of deletion (Task 2), is the read that matters, and it does not change.
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
  if (audit.kind === 'unreadable') return { kind: 'failed', sessionId, runId, resumable: false, detail: audit.detail };
  if (audit.kind === 'refused') return childReclaimRefusal(req, audit.token, audit.detail);
  if (audit.childOf !== runId) {
    return deferred('marker-mismatch', `ws-audit read the child marker as run ${audit.childOf}, not run ${runId}`);
  }
  // 6 — the act. ccd re-proves the token inside the reap lock.
  const act = await childReclaimAct(deps, req, audit.token);
  if (act === 'unsupported') return deferred('unsupported', `the fleet host does not advertise ${RECLAIM_CAP}`);
  if (act.kind === 'failed') return { kind: 'failed', sessionId, runId, resumable: act.resumable, detail: act.detail };
  if (act.kind === 'refused') return childReclaimRefusal(req, act.token, act.detail);
  // 7 — the child is gone: nothing may still be waiting to be typed into it,
  // or into a stranger that inherits its recycled slug.
  childReclaimCancelMail(deps, sessionId, 'reclaimed');
  return { kind: 'reclaimed', sessionId, runId, wip: act.wip };
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
 *  ONE caller today: the executor's own gone-check above, which folds
 *  `uuid || child` into its `.uuid`-OR-`.child` rule (unchanged by this fix —
 *  only the export's return shape changed). The close path (Task 9,
 *  `childGateAtClose`) will be the SECOND caller, folding `.child` ALONE
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
 *  `failed` fallback below is `resumable: false` — a refusal, in whichever
 *  ladder produced it, never advanced the box's destructive state — and is
 *  unreachable in practice, since this map's own equality with the defer
 *  vocabulary is held by `child-reclaim.test.ts`. */
function childReclaimRefusal(req: ChildReclaimRequest, token: ChildReclaimToken, detail: string): ChildReclaimOutcome {
  const { sessionId, runId } = req;
  switch (CHILD_RECLAIM_TOKEN_KIND[token]) {
    case 'gone': return { kind: 'gone', sessionId };
    // The kind map and the defer vocabulary are held equal by
    // `child-reclaim.test.ts`; a token marked `retry` that is no defer word is
    // answered as a failure, never cast into a reason it is not.
    case 'retry': return isChildReclaimDeferWhy(token)
      ? { kind: 'deferred', sessionId, runId, why: token, detail }
      : { kind: 'failed', sessionId, runId, resumable: false,
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

function childReclaimFeedBody(o: Exclude<ChildReclaimOutcome, { kind: 'gone' }>, req: ChildReclaimRequest,
  nowMs: number): string {
  const who = `${o.sessionId}, child of run #${o.runId}`;
  const wait = childReclaimWaitText(o, req, nowMs);
  switch (o.kind) {
    case 'reclaimed':
      return `${who}, was reclaimed (${req.trigger}). `
        + (o.wip === null ? 'Nothing uncommitted was left.'
          : o.wip === 'unreadable' ? 'Uncommitted work was pinned, but its commit id could not be read.'
          : `Uncommitted work was pinned as ${o.wip}.`) + wait;
    case 'deferred': return `${who}: reclaim deferred (${o.why}) — ${childReclaimSentence(o.detail)}${wait}`;
    case 'refused': return `${who}: ${o.sentence}${o.detail === '' ? '' : ` (${o.detail})`}${wait}`;
    // `resumable` says what to promise the reader (fix round 1 review minor
    // #4, corrected fix round 2 minor C): true only when ccd's own tail
    // genuinely started and left a breadcrumb; false for an audit failure
    // (never reached the destructive path) and for a verb answer that is a
    // REFUSAL in substance (an unrecognised word, or `reclaimed` naming
    // another session) — neither advanced this session's state, so neither
    // has anything to resume. `childReclaimSentence` (not a bare `.`) avoids
    // doubling the punctuation when `o.detail` already ends a sentence.
    case 'failed': return `${who}: reclaim failed — ${childReclaimSentence(o.detail)} `
      + (o.resumable ? 'It is retried; the box resumes where it stopped.' : 'It is retried from the start.')
      + wait;
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
