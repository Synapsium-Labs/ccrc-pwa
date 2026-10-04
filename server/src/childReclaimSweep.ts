// The child-reclaim sweep's DECISIONS (child-reclamation spec §5.7 "On the
// sweep" as amended, §5.9's attention item). L1: pure, clock-free (the clock
// is an argument), `fs`-free and fastify-free — `divergence.ts`'s shape. It
// imports L0 alone. `watch.ts`'s `sweepChildReclaim` (L4) GATHERS the evidence
// and APPLIES these verdicts; nothing in this file reads a file, a row or a
// clock, which is what lets every fail direction below be one test row.
//
// EVERY UNCERTAIN ANSWER IS "NOT THIS PASS". The path these verdicts feed asks
// for a deletion with no human in it. Nothing here can make a child eligible
// that the evidence does not positively make eligible, and the executor that
// follows (wave 3's `reclaimChild`) re-reads, and ccd re-proves inside its lock
// at the instant of deletion — this file narrows the window, it does not close it.
import {
  SPAWN_STALL_MS, TERMINAL_RUN_STATES, holdReason, lcRefusalWord,
  type ChildMark, type ChildReclaimAttention, type LifecycleAct, type LifecycleOutcome,
  type MirroredLifecycleEvent, type RunState,
} from '../../shared/api.js';

/** How long a presence defer may continue before the reclaim proceeds past it
 *  (spec §5.7, "Presence, and its bound"). Unbounded would be worse than
 *  absent: the PWA's terminal drawer opens a real `tmux attach`, so a phone
 *  that locks with the drawer open would wedge a child forever, and the only
 *  exit would be a human detaching from a sub-workspace — rule 4 inverted by
 *  its own safeguard. The same span caps the failure backoff and is how long
 *  a run of failures lasts before the child is listed (spec §5.9: "kept
 *  failing past the defer ceiling"). */
export const CHILD_RECLAIM_DEFER_CEILING_MS = 15 * 60_000;

/** The defers the ceiling bounds: the server's per-session visibility claim
 *  (`presence`) and ccd's rungs 5 (`attached`) and 6 (`tree-busy`) — exactly
 *  what `deferExpired` skips. Every other defer (`paused`, `held`,
 *  `state-changed`, …) is a condition the ceiling must never override, so it
 *  starts the any-kind clock only, never the presence clock. */
export const CHILD_RECLAIM_PRESENCE_DEFERS = ['presence', 'attached', 'tree-busy'] as const;

/** The sweep's memory of one marked child. IN MEMORY ONLY: a restart loses
 *  it, and losing it can only DELAY a reclaim, or retry a failing one sooner —
 *  never cause one. TWO deferral clocks, never folded into one, because they
 *  answer two questions: how long has this child been waiting (any deferral —
 *  spec §5.9 shows a deferral "with its elapsed time"), and how long has a
 *  continuous PRESENCE episode kept it (the only thing the 15-minute ceiling
 *  bounds — spec §5.7, "Presence, and its bound"). A single clock would either
 *  let a `held` or a `state-changed` deferral expire presence, or leave every
 *  non-presence deferral's feed row with no wait to state.
 *
 *  The presence clock is an EPISODE, not a lifetime total: any outcome other
 *  than a presence-class deferral ends it (a failure, a terminal refusal, or a
 *  deferral of another kind all mean the box was reached and answered
 *  something other than "someone is here"), and the ceiling licenses exactly
 *  ONE attempt past it — a request the executor sent with `--defer-expired`
 *  that comes back presence-class again restarts the episode, rather than
 *  skipping ccd's presence rungs forever.
 *
 *  And the episode is CONTINUOUS in the literal sense (spec §5.7: "15
 *  minutes of continuous deferral"): a child that is not asked writes
 *  nothing, so time nobody measured must never count as presence observed.
 *  Two consecutive presence-class answers further apart than
 *  `CHILD_RECLAIM_PRESENCE_GAP_PASSES` (two and a half) sweep-pass intervals
 *  do not extend one episode — the later answer starts a new one — and the
 *  ceiling licenses an attempt only while the episode's LATEST answer is that
 *  recent. Neither rule ever licenses an ask EARLIER, or more OFTEN, than the
 *  ceiling would without them; where one licenses later, it is on a
 *  continuous, fresh episode, the one the spec sanctions. A backlog that
 *  makes one child sit out two passes (three or more due children behind the
 *  one slot) makes its presence defers wait UNLICENSED until the backlog
 *  drains, which fails closed. */
export interface ChildReclaimSweepEntry {
  readonly firstEligibleAt: number;
  /** The FIRST deferral of ANY kind the sweep saw — what each request carries
   *  as `deferredSinceMs`. */
  readonly firstDeferredAt: number | null;
  /** The current PRESENCE episode's start — the clock
   *  `childReclaimDeferExpired` measures the ceiling on. `null` whenever the
   *  last outcome was not a presence-class deferral. */
  readonly firstPresenceDeferredAt: number | null;
  /** When the current PRESENCE episode's LATEST presence-class answer came
   *  (the pass time of the request it answered) — what makes the episode
   *  continuous rather than a span between two samples: the next answer
   *  extends the episode only within `CHILD_RECLAIM_PRESENCE_GAP_PASSES`
   *  (two and a half) intervals of it, and the ceiling licenses an attempt
   *  only within as many. `null` exactly when `firstPresenceDeferredAt` is: every outcome
   *  that ends the episode clears both. */
  readonly lastPresenceDeferredAt: number | null;
  /** `failed` outcomes in a row (spec §5.9: "retries back off in between");
   *  any other outcome ends the run. */
  readonly consecutiveFailures: number;
  /** The pass time of the last failed attempt — the backoff's origin. */
  readonly lastFailedAt: number | null;
  /** When ccd last answered a TERMINAL refusal for this child, or `null`
   *  otherwise — the lane's own pacing for re-asking after one (a failure is
   *  retried on the ordinary backoff; a refusal is not). */
  readonly refusedAt: number | null;
  /** When this child was last asked, of any outcome — the lane's fairness
   *  ordering key (never-asked first, then `firstEligibleAt`, then id), so a
   *  child that defers every pass cannot hog the one in-flight slot. */
  readonly lastAskedAt: number | null;
}

/** A child seen eligible for the first time: no clock, no failure, never
 *  asked. */
export const childReclaimFirstSighting = (nowMs: number): ChildReclaimSweepEntry => ({
  firstEligibleAt: nowMs, firstDeferredAt: null, firstPresenceDeferredAt: null, lastPresenceDeferredAt: null,
  consecutiveFailures: 0, lastFailedAt: null, refusedAt: null, lastAskedAt: null,
});

/** The minting run as the store answered: a row, no row, or a row this process
 *  could not represent — three answers, never folded. `openedAt` is the run's
 *  own creation time, read alongside `dispatchStartedAt` so the birth fence
 *  below can place a re-dispatch against the child's own birth without a
 *  second read (spec §5.1: the run id the marker names is one of the two
 *  authorities, and after a lost coordination database ids restart at 1, so a
 *  run opened after the child was born cannot be the run that minted it). */
export type ChildReclaimMintingRunRead =
  | { readonly ok: true; readonly run: {
      readonly state: RunState; readonly sessionId: string | null; readonly dispatchStartedAt: number | null;
      readonly openedAt: number;
    } | null }
  | { readonly ok: false; readonly detail: string };

/** The run a REVIEW child's minting run reviews (`runs.reviews`), as the
 *  store answered (spec §5.7, "A review child is finished later than its own
 *  run"). `not-a-review` is the minting run's own
 *  answer ("reviews nothing", a work run), never a failed read; `absent` and
 *  `unreadable` are the two answers that are not a run, never folded. */
export type ChildReclaimReviewedRunRead =
  | { readonly kind: 'not-a-review' }
  | { readonly kind: 'run'; readonly state: RunState }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** The open runs naming this child, counted — or unreadable. */
export type ChildReclaimSiblingsRead =
  | { readonly ok: true; readonly open: number }
  | { readonly ok: false; readonly detail: string };

// ── the hold (spec §5.7, "no hold") ─────────────────────────────────────────

/** `CoordStore`'s own open-run count for a programme, or a read this process
 *  could not complete. */
export type ChildReclaimHoldOpenRead =
  | { readonly ok: true; readonly count: number }
  | { readonly ok: false; readonly detail: string };

/** A run this child's hold text MIGHT be accounted for by: one whose
 *  `sessionId` names this child, or the child's own minting run (spec §5.7's
 *  "no hold" — a hold left by a session's own dispatch or non-final close).
 *  Only what `holdReason` needs to render a claim in that run's name. */
export interface ChildReclaimHoldCandidate {
  readonly runId: number;
  readonly sessionId: string | null;
  readonly state: RunState;
  readonly program: string;
  readonly wave: number;
  readonly waveOf: number | null;
}

/** The candidate runs a hold might be accounted against, or a read this
 *  process could not complete. */
export type ChildReclaimHoldCandidatesRead =
  | { readonly ok: true; readonly candidates: readonly ChildReclaimHoldCandidate[] }
  | { readonly ok: false; readonly detail: string };

/** What accounts for a `program`-shaped hold: the programme name and the run
 *  whose rendering matched, carried through to the release job so it re-reads
 *  the SAME accounting rather than re-deriving it. */
export interface ChildReclaimHoldRelease {
  readonly reason: string;
  readonly program: string;
  readonly accountedRunId: number;
}

/** Whether — and why — this child's row is held (spec §5.7's "no hold"
 *  conjunct). Four answers, never a boolean or a bare string: a hold that
 *  matched no run's own claim is `held` and protects unconditionally (a
 *  human's hold, in or out of the programme grammar, is exactly this —
 *  nothing here parses it, it only fails to match); `unmeasured` is doubt,
 *  and doubt protects too; `program` is a hold this build PROVED was written
 *  by one of this child's own runs, carrying that run's programme and id so
 *  the verdict can ask whether the programme is still open before it ever
 *  reads as anything but held. */
export type ChildReclaimHoldRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'held'; readonly reason: string }
  | { readonly kind: 'unmeasured'; readonly reason: string; readonly detail: string }
  | { readonly kind: 'program'; readonly reason: string; readonly program: string; readonly accountedRunId: number;
      readonly open: ChildReclaimHoldOpenRead };

const isTerminalRunState = (state: RunState): boolean => (TERMINAL_RUN_STATES as readonly RunState[]).includes(state);

/** Reads the hold (spec §5.7's "no hold" conjunct, its accounting narrowed to
 *  a PROVEN match rather than a guess at shape). `raw === null`: no hold,
 *  before any run is even considered. Otherwise the TRIMMED text is compared
 *  — never parsed (`run-routes.test.ts`'s "NOTHING in the tree parses one
 *  back" stays green) — against `holdReason`'s own two renderings of every
 *  TERMINAL candidate naming this child or minting it: the open/dispatch
 *  claim, and the non-final close's `wave+1` claim. The first match wins and
 *  its programme's open-run count is asked; everything else — a human's free
 *  text, the PWA's placeholder grammar written on purpose, a rendering of a
 *  run that names a DIFFERENT session, a non-terminal candidate, or simply no
 *  match — reads as an ordinary, unconditional `held`. A candidate list this
 *  process could not read is `unmeasured`, never "no candidates". */
export function childReclaimHoldRead(
  raw: string | null,
  sessionId: string,
  mintingRunId: number,
  candidatesRead: ChildReclaimHoldCandidatesRead,
  openOf: (program: string) => ChildReclaimHoldOpenRead,
): ChildReclaimHoldRead {
  if (raw === null) return { kind: 'none' };
  const reason = raw.trim();
  if (!candidatesRead.ok) return { kind: 'unmeasured', reason, detail: candidatesRead.detail };
  for (const c of candidatesRead.candidates) {
    if (c.sessionId !== sessionId && c.runId !== mintingRunId) continue;
    if (!isTerminalRunState(c.state)) continue;
    const open = holdReason(c.program, c.wave, c.waveOf, c.runId);
    const close = holdReason(c.program, c.wave + 1, c.waveOf, null);
    if (reason === open || reason === close) {
      return { kind: 'program', reason, program: c.program, accountedRunId: c.runId, open: openOf(c.program) };
    }
  }
  return { kind: 'held', reason };
}

export interface ChildReclaimSweepInput {
  /** The registry row's id — the child's session id. */
  readonly sessionId: string;
  /** The registry's three-way reading of `$REG/<id>.child` (wave 2). */
  readonly child: ChildMark;
  /** False when this read could not measure the row's identity triple. */
  readonly identityMeasured: boolean;
  /** `FleetSession.workspace`: null for a project's main checkout, which
   *  cannot be a child in depth of ccd's own rung-1 refusal (spec §5.1). */
  readonly workspace: string | null;
  readonly held: ChildReclaimHoldRead;
  /** The child's latest reclaim outcome is a TERMINAL refusal. */
  readonly terminal: boolean;
  readonly mintingRun: ChildReclaimMintingRunRead;
  /** Read only when the minting run is a review run; `not-a-review` otherwise. */
  readonly reviewedRun: ChildReclaimReviewedRunRead;
  readonly siblings: ChildReclaimSiblingsRead;
  /** Has this session EVER been `claimedBy` of a run, or the `from` side of a
   *  chair displacement (spec §1 rule 4: manual cleanup is reserved for a
   *  coordinator's own workspace)? Read once by the caller from the SAME
   *  store method the close path uses, so the two can never disagree. */
  readonly coordinating: boolean;
  /** The child's own birth — the earliest `create` row of its CURRENT
   *  generation on ccd's clock — or `null` when this read could not place
   *  one. Run ids restart after a coordination-database loss, so a minting
   *  run opened after this instant (plus `skewMs`) cannot be the run that
   *  actually minted this incarnation of the workspace (spec §5.1). */
  readonly childBornAt: number | null;
  /** The clock-skew allowance between ccd's journal and the run row's own
   *  `openedAt` — the caller's `CHILD_BIRTH_SKEW_MS`, passed in because this
   *  L1 file imports no L2/L3 constant. */
  readonly skewMs: number;
  readonly nowMs: number;
}

export type ChildReclaimSweepSkip =
  | 'not-a-child' | 'marker-unreadable' | 'identity-unmeasured' | 'not-a-workspace'
  | 'held' | 'hold-unmeasured' | 'hold-retired'
  | 'terminal-refusal'
  | 'minting-run-unreadable' | 'minting-run-absent' | 'minting-run-open' | 'dispatch-in-flight'
  | 'child-birth-unplaced' | 'minting-run-postdates-child'
  | 'review-report-live' | 'reviewed-run-absent' | 'reviewed-run-unreadable'
  | 'siblings-unreadable' | 'siblings-open' | 'coordinating';

export type ChildReclaimSweepVerdict =
  | { readonly eligible: true; readonly runId: number }
  | { readonly eligible: false; readonly why: 'hold-retired'; readonly runId: number;
      readonly release: ChildReclaimHoldRelease }
  | { readonly eligible: false; readonly why: Exclude<ChildReclaimSweepSkip, 'hold-retired'> };

/** Is this marked child eligible THIS pass? (The twice-observed rule is the
 *  caller's: this answers one pass.) The order is the order of trust — a row
 *  whose child-ness is unknown says nothing else trustworthy, and a hold that
 *  matched no run of this child's own protects UNCONDITIONALLY, decided
 *  before the minting run is even read: the `held`/`unmeasured` kinds return
 *  at the SAME early place a bare boolean hold would have, ahead of even
 *  `minting-run-absent`. That is deliberate, not merely a narrower rule's
 *  allowance (only the PROVEN `program` kind is required to wait for the
 *  minting run) — it is fail-shut, because an unaccounted hold protects on
 *  its own terms, whatever the minting run reads as. Its one cost: after a
 *  coordination-database loss a child under a non-programme hold answers
 *  `held`, not `minting-run-absent`,
 *  and so produces no absence log line for THAT child on THAT pass — every
 *  other child still does, and this one is never destroyed by the omission,
 *  which is the only thing fail-shut requires. Only a hold this build PROVED
 *  belongs to one of this child's own runs is re-examined once the minting
 *  run's status, and the birth fence, are known — because releasing it must
 *  never happen through the orphan branch (a live minting run naming a
 *  different session is not "finished with this workspace", whatever it once
 *  claimed). */
export function childReclaimSweepVerdict(i: ChildReclaimSweepInput): ChildReclaimSweepVerdict {
  if (i.child.kind === 'none') return { eligible: false, why: 'not-a-child' };
  if (i.child.kind === 'unreadable') return { eligible: false, why: 'marker-unreadable' };
  if (!i.identityMeasured) return { eligible: false, why: 'identity-unmeasured' };
  if (i.workspace === null) return { eligible: false, why: 'not-a-workspace' };
  if (i.held.kind === 'held') return { eligible: false, why: 'held' };
  if (i.held.kind === 'unmeasured') return { eligible: false, why: 'hold-unmeasured' };
  if (i.terminal) return { eligible: false, why: 'terminal-refusal' };
  if (!i.mintingRun.ok) return { eligible: false, why: 'minting-run-unreadable' };
  const run = i.mintingRun.run;
  // THE AMENDED RULE. An absent minting run is NEVER eligible: a lost or
  // rebuilt coordination database makes every child's run absent at once, the
  // live ones included. The orphans the first draft reached through absence
  // are reached through the branch below instead.
  if (run === null) return { eligible: false, why: 'minting-run-absent' };
  if (!isTerminalRunState(run.state)) {
    // A live minting run keeps its child unless it provably moved on to a
    // DIFFERENT one — which is what a re-dispatched run that bound the child it
    // did get looks like. Naming this child, or no session, keeps it.
    if (run.sessionId === null || run.sessionId === i.sessionId) {
      return { eligible: false, why: 'minting-run-open' };
    }
    // …and a planned run inside the spawn-stall window may still be binding.
    // A missing stamp is doubt, and doubt waits.
    if (run.state === 'planned'
        && (run.dispatchStartedAt === null || i.nowMs - run.dispatchStartedAt < SPAWN_STALL_MS)) {
      return { eligible: false, why: 'dispatch-in-flight' };
    }
  }
  // The birth fence (spec §5.1): a minting run opened after this child's own
  // birth (plus the clock-skew allowance) cannot be the run that minted THIS
  // incarnation — run ids restart after a coordination-database loss. A
  // child whose own birth this read could not place is doubt, and doubt waits.
  // THE ONE RESIDUAL, ACCEPTED: the allowance is symmetric, so just after a
  // coordination-database loss a NEW run whose id collides with a pre-loss
  // child's marker, and which opened within `skewMs` (120 s) after that
  // child's own `create`, passes this fence and is read as the child's minting
  // run — an unrelated run whose state (terminal, or open and bound to another
  // session, the orphan branch above) can then make the child eligible.
  // Reaching it needs the new database to count up to that id inside those
  // two minutes of the child's birth, so it is negligible in practice; it is
  // the fence's only fail-open direction.
  if (i.childBornAt === null) return { eligible: false, why: 'child-birth-unplaced' };
  if (run.openedAt > i.childBornAt + i.skewMs) return { eligible: false, why: 'minting-run-postdates-child' };
  // A hold this build proved belongs to one of this child's own runs (spec
  // §5.7): it protects while that run is not yet terminal — the orphan branch
  // above never releases a hold — and while its programme still has an open
  // run. Only once both are settled does the hold stop protecting, and even
  // then the verdict below answers `hold-retired`, never plain `eligible`.
  if (i.held.kind === 'program') {
    if (!isTerminalRunState(run.state)) return { eligible: false, why: 'held' };
    if (!i.held.open.ok) return { eligible: false, why: 'hold-unmeasured' };
    if (i.held.open.count > 0) return { eligible: false, why: 'held' };
  }
  // A REVIEW child (spec §5.7, "A review child is finished
  // later than its own run"): the reviewer's report lives in this child's
  // clips and the coordinator cites its path in fix-round mail, so the child
  // is kept while the run it reviewed is not terminal — the orphan branch
  // above included. `review-report-live` is wave 3's `childReclaimDecision`
  // word for the same condition. Absent or unreadable is doubt, and doubt waits.
  switch (i.reviewedRun.kind) {
    case 'not-a-review': break;
    case 'absent': return { eligible: false, why: 'reviewed-run-absent' };
    case 'unreadable': return { eligible: false, why: 'reviewed-run-unreadable' };
    case 'run':
      if (!isTerminalRunState(i.reviewedRun.state)) return { eligible: false, why: 'review-report-live' };
      break;
  }
  if (!i.siblings.ok) return { eligible: false, why: 'siblings-unreadable' };
  if (i.siblings.open > 0) return { eligible: false, why: 'siblings-open' };
  // A child that has EVER coordinated a run (spec §1 rule 4): manual cleanup
  // is reserved for a coordinator's own workspace, never a sub-workspace an
  // automatic sweep may act on.
  if (i.coordinating) return { eligible: false, why: 'coordinating' };
  if (i.held.kind === 'program') {
    return { eligible: false, why: 'hold-retired', runId: i.child.runId,
      release: { reason: i.held.reason, program: i.held.program, accountedRunId: i.held.accountedRunId } };
  }
  return { eligible: true, runId: i.child.runId };
}

/** The executor's outcome, as far as this memory needs it. STRUCTURAL:
 *  wave 3's `ChildReclaimOutcome` is assignable to it without this file
 *  importing `coord/childReclaim.ts` (an L3/L4 module). */
export type ChildReclaimSweepOutcome =
  | { readonly kind: 'reclaimed' | 'gone' | 'failed' }
  | { readonly kind: 'refused'; readonly token: string }
  | { readonly kind: 'deferred'; readonly why: string };

/** How many sweep-pass intervals may separate two presence-class answers of
 *  one CONTINUOUS episode, and the episode's latest answer from the ask the
 *  ceiling would license (spec §5.7, "continuous deferral"): two and a half,
 *  inclusive. A pass lands one interval after the last plus up to one
 *  watcher tick, so a child asked on every pass is always inside it, and so
 *  is a child that sat out ONE pass (its previous request still in flight,
 *  or one other due child ahead of it for the one slot), asked again at
 *  most two intervals plus two ticks later. A child that sat out TWO passes
 *  (three or more due children) lands at three intervals or more, always
 *  past it: its episode restarts and its ask goes out unlicensed, which
 *  fails closed. The half interval is the margin between the two. */
const CHILD_RECLAIM_PRESENCE_GAP_PASSES = 2.5;

/** Is the entry's LATEST presence-class answer within
 *  `CHILD_RECLAIM_PRESENCE_GAP_PASSES` pass intervals of `nowMs`
 *  (inclusive)? `false` with no presence answer on record. */
const childReclaimPresenceRecent = (entry: ChildReclaimSweepEntry, nowMs: number, passIntervalMs: number): boolean =>
  entry.lastPresenceDeferredAt !== null
  && nowMs - entry.lastPresenceDeferredAt <= CHILD_RECLAIM_PRESENCE_GAP_PASSES * passIntervalMs;

/** The memory after one attempt (spec §5.7, §5.9). `null` = forget the
 *  child's entry: it is already gone, or truly reclaimed. A TERMINAL REFUSAL
 *  keeps its entry instead of forgetting it — the lifecycle mirror holds the
 *  refusal for the attention list, and this memory's own job is only pacing:
 *  it stamps `refusedAt` so the lane does not ask again before the next
 *  ceiling. A FAILURE counts one more in the run and stamps when it was
 *  asked. A DEFERRAL ends any run of failures and clears `refusedAt`, and
 *  starts the any-kind clock once.
 *
 *  The PRESENCE clock is an EPISODE (spec §5.7): every outcome other than a
 *  presence-class deferral ends it, so `failed`, `refused` and a
 *  non-presence `deferred` all answer `firstPresenceDeferredAt: null` and
 *  `lastPresenceDeferredAt: null`. A presence-class deferral always stamps
 *  `lastPresenceDeferredAt: nowMs`, and STARTS a new episode at `nowMs` in
 *  three cases: none is running; the request was `licensed` (the executor
 *  sent it with `deferExpired: true`, past the previous ceiling), so a
 *  presence answer to it restarts the episode rather than letting every
 *  later retry silently keep skipping ccd's presence rungs; or the previous
 *  presence answer is more than `CHILD_RECLAIM_PRESENCE_GAP_PASSES` (two and
 *  a half) × `passIntervalMs` old, so the time between the two was never observed and
 *  the episode was not continuous. Only an UNLICENSED presence answer that
 *  follows the last one within that gap (inclusive) extends the episode
 *  already running. `passIntervalMs` is the lane's pass interval — an
 *  argument, as `childReclaimDue`'s is, because this L1 file imports no L4
 *  constant. */
export function childReclaimNextEntry(
  entry: ChildReclaimSweepEntry, outcome: ChildReclaimSweepOutcome, nowMs: number, licensed: boolean,
  passIntervalMs: number,
): ChildReclaimSweepEntry | null {
  switch (outcome.kind) {
    case 'reclaimed': case 'gone': return null;
    case 'failed':
      return {
        ...entry, consecutiveFailures: entry.consecutiveFailures + 1, lastFailedAt: nowMs,
        firstPresenceDeferredAt: null, lastPresenceDeferredAt: null, refusedAt: null, lastAskedAt: nowMs,
      };
    case 'refused':
      return {
        ...entry, consecutiveFailures: 0, lastFailedAt: null,
        firstPresenceDeferredAt: null, lastPresenceDeferredAt: null, refusedAt: nowMs, lastAskedAt: nowMs,
      };
    case 'deferred': {
      const presence = (CHILD_RECLAIM_PRESENCE_DEFERS as readonly string[]).includes(outcome.why);
      const continues = presence && !licensed && entry.firstPresenceDeferredAt !== null
        && childReclaimPresenceRecent(entry, nowMs, passIntervalMs);
      return {
        ...entry,
        firstDeferredAt: entry.firstDeferredAt ?? nowMs,
        firstPresenceDeferredAt: presence ? (continues ? entry.firstPresenceDeferredAt : nowMs) : null,
        lastPresenceDeferredAt: presence ? nowMs : null,
        refusedAt: null,
        consecutiveFailures: 0, lastFailedAt: null,
        lastAskedAt: nowMs,
      };
    }
  }
}

/** May this ask go out LICENSED (`deferExpired: true`)? Only when BOTH hold:
 *  the current PRESENCE episode spans the ceiling (at EXACTLY the ceiling,
 *  yes), and its latest presence-class answer is within
 *  `CHILD_RECLAIM_PRESENCE_GAP_PASSES` (two and a half) × `passIntervalMs` of `nowMs`
 *  (inclusive) — so the licence rests on presence observed continuously up
 *  to the ask, never on one sample followed by time nobody measured (spec
 *  §5.7: "15 minutes of continuous deferral"). The presence clock alone:
 *  any other deferral is a condition the ceiling must never override. How
 *  long the child waited is not this function's to say: the lane passes
 *  `entry.firstDeferredAt` — the OTHER clock — on every request as
 *  `ChildReclaimRequest.deferredSinceMs`, and the executor's ONE feed row
 *  states the wait and its why for a `deferred` outcome and for a
 *  ceiling-expired reclaim (spec §5.7, §5.9). */
export const childReclaimDeferExpired = (
  entry: ChildReclaimSweepEntry, nowMs: number, passIntervalMs: number,
): boolean =>
  entry.firstPresenceDeferredAt !== null
  && nowMs - entry.firstPresenceDeferredAt >= CHILD_RECLAIM_DEFER_CEILING_MS
  && childReclaimPresenceRecent(entry, nowMs, passIntervalMs);

/** The wait after `consecutiveFailures` failed attempts in a row (spec §5.9:
 *  "retries back off in between"): `min(ceiling, passInterval × 2^k)` — two
 *  intervals after the first failure, doubling, never longer than the
 *  ceiling, so a child that keeps failing is still asked for at least once a
 *  ceiling. `0` with no failure. */
export function childReclaimBackoffMs(consecutiveFailures: number, passIntervalMs: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(CHILD_RECLAIM_DEFER_CEILING_MS, passIntervalMs * 2 ** consecutiveFailures);
}

/** Has the failure backoff passed? Always with no failure on record;
 *  otherwise only once `childReclaimBackoffMs` has elapsed since the failed
 *  attempt's pass — at EXACTLY the backoff, yes. Private: `childReclaimDue`
 *  is the one question a caller outside this file asks (spec §5.9's second
 *  pacing, the terminal-refusal wait, is not a failure and this predicate
 *  alone cannot see it — see `childReclaimDue`). */
const childReclaimBackoffOver = (entry: ChildReclaimSweepEntry, nowMs: number, passIntervalMs: number): boolean =>
  entry.lastFailedAt === null
  || nowMs - entry.lastFailedAt >= childReclaimBackoffMs(entry.consecutiveFailures, passIntervalMs);

/** May the lane ask for this child again — THE ONE "may I ask" question a
 *  caller outside this file uses, folding BOTH pacings this memory tracks
 *  (spec §5.9): the failure backoff (above), and — separately — a TERMINAL
 *  refusal's own wait, never sooner than the defer ceiling after `refusedAt`.
 *  The refusal wait exists because the executor's answer and the lifecycle
 *  mirror's ingest of the same refusal are two different writers on two
 *  different clocks: the mirror may not have the line yet, or (a `ws-audit`
 *  race, a truncated journal write) may never see it at all, so this memory's
 *  own `refusedAt` is the only thing pacing the re-ask in that window — the
 *  attention list is not a substitute, since it exists to be READ, not to
 *  gate anything. `refusedAt` is cleared by every OTHER outcome
 *  (`childReclaimNextEntry`), so a child that has since failed, been
 *  deferred, or been reclaimed is due on the ordinary backoff alone, exactly
 *  as if it had never been refused. Folding both here — rather than leaving
 *  either for the lane (L4) to compute — is what keeps L4 from ever deciding
 *  a pacing question itself. */
export const childReclaimDue = (entry: ChildReclaimSweepEntry, nowMs: number, passIntervalMs: number): boolean =>
  childReclaimBackoffOver(entry, nowMs, passIntervalMs)
  && (entry.refusedAt === null || nowMs - entry.refusedAt >= CHILD_RECLAIM_DEFER_CEILING_MS);

/** One row of the mirror read the attention list and the terminal exclusion
 *  share: the LATEST `reclaim` event of one session's CURRENT GENERATION, of
 *  any outcome — declared here, by its consumer. `outcome` is the mirror's
 *  outcome; `at` is ccd's clock, or null when the line carried none;
 *  `failingSince`, only when that event is `failed`, is when the unbroken run
 *  of failures ending at it began, on ccd's clock. NO `ingestedAt`: it is the
 *  server's clock and never an event time (`coord/schema.ts`), so this
 *  row does not carry it and nothing here can read it as one. */
export interface ChildReclaimJournalRow {
  readonly sessionId: string;
  readonly outcome: string;
  readonly refusal: string | null;
  readonly at: number | null;
  readonly failingSince: number | null;
}

/** The answer shape of wave 3's token classification, as this file receives
 *  it: an INJECTED lookup (`kindOf`), because L1 imports L0 alone. The lookup
 *  itself is `childReclaimTokenKind`, exported beside `CHILD_RECLAIM_TOKEN_KIND`
 *  in `coord/childReclaim.ts` — the one total reader of the one map. */
export type ChildReclaimTokenKind = 'gone' | 'terminal' | 'retry';

const RECLAIM_ACT: LifecycleAct = 'reclaim';
const INTENT: LifecycleOutcome = 'intent';
const REFUSED: LifecycleOutcome = 'refused';
const FAILED: LifecycleOutcome = 'failed';

/** ONE session's attention input row. `generation` is
 *  `childReclaimGeneration(events, at)`'s answer and `latest` is
 *  `childReclaimLatest(generation)`'s (`coord/childReclaim.ts`): where a
 *  generation starts and which event is latest — `intent` included — are
 *  decided there, once, and this file cannot import either, so the latest
 *  event is passed IN rather than picked again here. What this adds is the
 *  failure run: walking back from the end over `reclaim` events, `intent`s
 *  (the start of each attempt) and other acts are read past, each `failed`
 *  that ccd placed moves the start back, and any other outcome ends the walk.
 *  Time is ccd's clock ALONE: a `failed` line that carried no `at` is still
 *  a failure — it does not end the run — but it cannot be placed, so it
 *  starts no clock. The mirror's `ingestedAt` is never read. */
export function childReclaimJournalRow(
  generation: readonly MirroredLifecycleEvent[], latest: MirroredLifecycleEvent | null,
): ChildReclaimJournalRow | null {
  if (latest === null || latest.id === null) return null;
  let failingSince: number | null = null;
  if (latest.outcome === FAILED) {
    for (let k = generation.length - 1; k >= 0; k -= 1) {
      const e = generation[k]!;
      if (e.act !== RECLAIM_ACT || e.outcome === INTENT) continue;
      if (e.outcome !== FAILED) break;
      if (e.at !== null) failingSince = e.at;
    }
  }
  return { sessionId: latest.id, outcome: latest.outcome, refusal: latest.refusal, at: latest.at, failingSince };
}

/** THE reading of "this child stands under a TERMINAL refusal": its latest
 *  reclaim event is a refusal whose token wave 3 classes terminal. Shared by
 *  the attention list and the lane's terminal exclusion, so the two can never
 *  disagree — and deliberately NOT "is on the attention list", which also
 *  names children whose reclaim keeps FAILING, and a failure is retried. */
export const childReclaimTerminalRefusal = (
  row: ChildReclaimJournalRow, kindOf: (token: string) => ChildReclaimTokenKind | null,
): boolean => row.outcome === REFUSED && row.refusal !== null && kindOf(row.refusal) === 'terminal';

/** Has this child's reclaim kept failing for the whole ceiling (spec §5.9)?
 *  At EXACTLY the ceiling, yes. A failure row with no run start says nothing. */
export const childReclaimFailingPastCeiling = (row: ChildReclaimJournalRow, nowMs: number): boolean =>
  row.outcome === FAILED && row.failingSince !== null && nowMs - row.failingSince >= CHILD_RECLAIM_DEFER_CEILING_MS;

/** The server's sentence for a child listed because its reclaim keeps failing
 *  — the last failure's own word inside it, or a plain statement that ccd
 *  gave none. A report, not a stop. It says the retry is CONDITIONAL, because
 *  this list is derived before the lane learns whether it may act: while
 *  `reclaim-paused` stands, or the fleet box lacks the reclaim capabilities,
 *  the same item is listed and nothing retries it — so an unconditional
 *  "ccrc keeps retrying" would be false under the very switch an operator
 *  raises on seeing it (spec §5.9's "retries back off in between" describes
 *  the sweep, which only asks while reclamation is running). */
export const childReclaimFailingSentence = (word: string | null): string =>
  `Every attempt to reclaim this child has failed for at least ${CHILD_RECLAIM_DEFER_CEILING_MS / 60_000} minutes. `
  + 'While automatic reclamation is running, ccrc retries it, backing off in between. '
  + `The last failure: ${word ?? 'ccd recorded no reason.'}`;

export interface ChildReclaimAttentionInput {
  readonly latest: readonly ChildReclaimJournalRow[];
  /** Every registry row this read listed → its minting run id, or null when
   *  its marker does not read as a child. PRESENCE in this map IS "the row
   *  still exists". */
  readonly live: ReadonlyMap<string, number | null>;
  /** Wave 3's classification, read totally — null for a token this build does
   *  not know, which is therefore never reported as terminal. */
  readonly kindOf: (token: string) => ChildReclaimTokenKind | null;
  /** The server's one sentence per token (`wsaudit.ts`'s `refusalSentence`). */
  readonly sentenceFor: (token: string) => string;
  readonly nowMs: number;
}

/** The fleet-level attention list (spec §5.9): each child whose latest reclaim
 *  event in its current generation is a refusal wave 3 classes TERMINAL, or a
 *  failure closing a run of failures that has lasted the ceiling, and whose
 *  registry row still exists — with the server's sentence. An `intent` as the
 *  latest event lists nothing: an attempt is in flight, or died mid-way.
 *  DERIVED FROM THE MIRROR ALONE, "so a restart does not lose it": an
 *  audit-time terminal refusal is a mirror row like any other, because wave
 *  3's `cmd_ws_audit --reclaim` journals each terminal verdict it answers
 *  (`verb ws-audit`), and a failure is the `_lc_fail` line of an attempt that
 *  started. No executor answer and no in-memory memo is an input. A report:
 *  nothing waits on it. A failure's sentence is its journal word first
 *  (`lcRefusalWord`, the journal-only map) and the server's lookup second —
 *  the order `lcRefusalWord`'s own docstring prescribes. Only ccd's own `at`
 *  places a line in time: a child whose latest line carried none cannot say
 *  since when, and is not listed — the mirror's ingest time is the server's
 *  clock and never an event time. */
export function childReclaimAttention(i: ChildReclaimAttentionInput): ChildReclaimAttention[] {
  const out: ChildReclaimAttention[] = [];
  for (const row of i.latest) {
    if (!i.live.has(row.sessionId)) continue;
    // Unplaceable: no `at`, no item — whichever arm below it would reach.
    if (row.at === null) continue;
    const runId = i.live.get(row.sessionId) ?? null;
    if (childReclaimTerminalRefusal(row, i.kindOf)) {
      out.push({
        sessionId: row.sessionId, runId, token: row.refusal!, sentence: i.sentenceFor(row.refusal!),
        // Since when: the refusal's own line, on ccd's clock.
        at: row.at,
      });
    } else if (childReclaimFailingPastCeiling(row, i.nowMs)) {
      const word = row.refusal === null ? null : (lcRefusalWord(row.refusal) ?? i.sentenceFor(row.refusal));
      out.push({
        sessionId: row.sessionId, runId, token: row.refusal ?? '', sentence: childReclaimFailingSentence(word),
        // Since when: the start of the run of failures, not its latest line.
        at: row.failingSince!,
      });
    }
  }
  return out;
}
