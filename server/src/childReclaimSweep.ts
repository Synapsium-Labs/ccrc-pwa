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
  CHILD_RECLAIM_KEPT_WORDS, SPAWN_STALL_MS, TERMINAL_RUN_STATES, holdReason, isChildReclaimKeptWord, lcRefusalWord,
  type ChildMark, type ChildReclaimAttention, type ChildReclaimKeptWord, type LcRefusalToken, type LifecycleAct,
  type LifecycleOutcome, type MirroredLifecycleEvent, type RunState,
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

/** One reading of the sweep lane's two clocks. */
export interface ChildReclaimLaneNow {
  /** The process's monotonic clock, ms. It never steps, it stops while the box is suspended, and it means nothing outside this process. */
  readonly monoMs: number;
  /** Wall-clock epoch ms. */
  readonly wallMs: number;
}

/** What the lane knew when it sent one request. */
export interface ChildReclaimAsk {
  /** The lane's two clocks at the pass that sent it. */
  readonly at: ChildReclaimLaneNow;
  /** The request's own `deferExpired`. */
  readonly licensed: boolean;
  /** It was sent to the presence lease's holder (`childReclaimAskOrder`'s `holderId`). */
  readonly asHolder: boolean;
}

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
 *  THE CLOCKS. Every instant in this entry is the lane's MONOTONIC clock
 *  (`ChildReclaimLaneNow.monoMs`: never stepped, stopped while the box is
 *  suspended, and meaningless outside this process), with three exceptions.
 *  `firstDeferredAt` is wall-clock epoch ms because it is DISPLAYED (each
 *  request's `deferredSinceMs`, the run chip's `at`). `lastPresenceWallAt` is
 *  the presence gap's second operand. `bornAt` is ccd's clock, compared for
 *  equality only, and `markerRunId` is no clock at all. That is safe only
 *  because this memory never leaves the process: it is never persisted or
 *  sent, and nothing but `firstDeferredAt` is read as an epoch.
 *
 *  The presence clock is an EPISODE, not a lifetime total: any outcome other
 *  than a presence-class deferral ends it (a failure, a terminal refusal, or a
 *  deferral of another kind all mean the box was reached and answered
 *  something other than "someone is here"), and the ceiling licenses exactly
 *  ONE attempt past it — a request the executor sent with `--defer-expired`
 *  that comes back presence-class again restarts the episode, rather than
 *  skipping ccd's presence rungs forever.
 *
 *  And the episode is CONTINUOUS in the literal sense (spec §5.7: "15 minutes
 *  of continuous deferral"): a child that is not asked writes nothing, so time
 *  nobody measured must never count as presence observed. Each presence-class
 *  answer brackets its observation between the request that asked
 *  (`lastPresenceDeferredAt`) and its own arrival. The next answer extends the
 *  episode only while its ARRIVAL is within `CHILD_RECLAIM_PRESENCE_GAP_PASSES`
 *  (two and a half) pass intervals of that request. The episode starts at its
 *  first answer's ARRIVAL. The ceiling licenses an ask only while the latest
 *  answer's REQUEST is that recent. Each gap is the larger of the monotonic
 *  and the wall-clock difference, and the ceiling's span is the monotonic
 *  clock alone. None of this ever licenses an ask EARLIER, or more OFTEN, than
 *  the ceiling would for a lone child.
 *
 *  What keeps the ceiling REACHABLE however many children are due is the
 *  order (`childReclaimAskOrder`). The senior presence-held due child
 *  (`presenceHeldSince`) holds the lease and is asked on every pass it is due,
 *  exactly as a lone child is, while every other due child waits. A holder
 *  whose answer does not continue its episode, or whose request is rejected,
 *  forfeits the lease, so a slow box costs the lease and never stops the lane.
 *  Without the lease, three or more due children that kept deferring kept
 *  every presence-held child unlicensed for good (spec §5.7: "Unbounded would
 *  be worse than absent"). The entry describes ONE workspace generation, by
 *  two keys, its birth (`bornAt`) and the run its marker names
 *  (`markerRunId`): a slug minted again is a new child, sighted afresh
 *  (`childReclaimSameGeneration` states the windows the two keys leave).
 *
 *  THE BOUND (spec §5.7) is three figures, never run together. From its
 *  lease's first ask, the holder is licensed within the ceiling plus one pass
 *  spacing plus one presence answer's latency: about 16.5 minutes at the
 *  spacing measured on 2026-10-05. One lease, from its first ask to the next
 *  lease's first ask, takes at most the ceiling plus two pass spacings plus a
 *  presence answer's and a reclaim's latency: about 18.6 minutes there. And
 *  the k-th presence-held child in the ask order, with nothing else ahead, is
 *  licensed within k times (the ceiling + twice the gap bound + the lane's
 *  stall bound), k × 28 minutes. Each due child ahead of it that is not
 *  presence-held (a new sighting, or one returning from a backoff or a
 *  refusal) adds at most the stall bound plus the gap bound, about 10.5
 *  minutes more. Those are the worst cases while a pass plus a presence
 *  answer stays within the gap bound, an answer settles before the next pass,
 *  no wall-clock step or suspend falls in the lease, and this memory is not
 *  cleared. A breach of any of those forfeits the lease and fails closed. */
export interface ChildReclaimSweepEntry {
  /** When this child was first sighted eligible (monotonic). */
  readonly firstEligibleAt: number;
  /** The FIRST deferral of ANY kind the sweep saw — what each request carries
   *  as `deferredSinceMs`. WALL-CLOCK epoch ms, the one field here that is
   *  displayed. */
  readonly firstDeferredAt: number | null;
  /** The current PRESENCE episode's start: the ARRIVAL (monotonic) of its
   *  first presence-class answer, the instant `childReclaimDeferExpired`
   *  measures the ceiling from. `null` whenever the last outcome was not a
   *  presence-class deferral. */
  readonly firstPresenceDeferredAt: number | null;
  /** The REQUEST instant (monotonic) of the episode's latest presence-class
   *  answer. The next answer extends the episode only if it ARRIVES within
   *  `CHILD_RECLAIM_PRESENCE_GAP_PASSES` intervals of it, and the ceiling
   *  licenses an ask only within as many. `null` exactly when
   *  `firstPresenceDeferredAt` is. */
  readonly lastPresenceDeferredAt: number | null;
  /** That same request on the WALL clock, read only by the gap reading, whose
   *  larger difference neither a backward wall step nor a suspend can shrink.
   *  `null` exactly when `lastPresenceDeferredAt` is. */
  readonly lastPresenceWallAt: number | null;
  /** The lease's seniority: the ARRIVAL (monotonic) of the unlicensed
   *  presence-class answer that put this child in line. An unlicensed presence
   *  answer keeps it, unless the request went to the lease's HOLDER and the
   *  answer does not continue the episode: then the holder forfeits (`null`),
   *  and re-joins at the back on its next unlicensed presence answer. A
   *  licensed presence answer, any other outcome and a rejection clear it.
   *  Read ONLY by `childReclaimAskOrder`, never by the licence. */
  readonly presenceHeldSince: number | null;
  /** `failed` outcomes in a row (spec §5.9: "retries back off in between");
   *  any other outcome ends the run. */
  readonly consecutiveFailures: number;
  /** The pass time of the last failed attempt (monotonic) — the backoff's
   *  origin. */
  readonly lastFailedAt: number | null;
  /** When ccd last answered a TERMINAL refusal for this child (monotonic), or
   *  `null` otherwise — the lane's own pacing for re-asking after one (a
   *  failure is retried on the ordinary backoff; a refusal is not). */
  readonly refusedAt: number | null;
  /** When this child was last asked, of any outcome (monotonic) — the
   *  fairness order's key in `childReclaimAskOrder` (never-asked first, then
   *  `firstEligibleAt`, then id), so a child that defers every pass cannot hog
   *  the one in-flight slot. */
  readonly lastAskedAt: number | null;
  /** The birth of the workspace generation this entry describes: the opening
   *  `create`'s `at`, on ccd's clock, compared for equality only
   *  (`childReclaimSameGeneration`). A different birth is a different
   *  workspace under a recycled slug, which starts from a first sighting. */
  readonly bornAt: number | null;
  /** The run the `.child` marker named when this entry was sighted: the
   *  generation's second key (`childReclaimSameGeneration`). ws-add writes a
   *  recycled slug's new row and marker before it journals the new `create`,
   *  and the mirror ingests that line later still, so for a while the birth
   *  still reads the OLD workspace's; a marker naming a different run is a
   *  new workspace all the same, and starts from a first sighting. */
  readonly markerRunId: number;
  /** The `why` of the latest outcome when it was a deferral, or null after any other outcome:
   *  the deferral EPISODE a feed row is written once for (spec §5.9). No pacing reads it. */
  readonly lastDeferWhy: string | null;
}

/** A child seen eligible for the first time, in the workspace generation born
 *  at `bornAt` and marked by run `markerRunId`: no clock, no failure, never
 *  asked. `monoMs` is the lane's monotonic clock. */
export const childReclaimFirstSighting = (
  monoMs: number, bornAt: number | null, markerRunId: number,
): ChildReclaimSweepEntry => ({
  firstEligibleAt: monoMs, firstDeferredAt: null, firstPresenceDeferredAt: null, lastPresenceDeferredAt: null,
  lastPresenceWallAt: null, presenceHeldSince: null,
  consecutiveFailures: 0, lastFailedAt: null, refusedAt: null, lastAskedAt: null, bornAt, markerRunId,
  lastDeferWhy: null,
});

/** Does this entry describe the workspace generation born at `bornAt` whose `.child` marker names run
 *  `markerRunId` (spec §5.6: slugs recycle)? BOTH keys must match. A recycled slug's new row and marker
 *  are listed before its new birth can be placed, so the birth alone would let an old workspace's
 *  licence-ripe presence episode license a request to the new one; a marker naming a different run
 *  ends the old generation there. A null birth never matches.
 *
 *  A FIRST WINDOW LEFT is one run minting the same slug twice, with no pass between to forget the old
 *  entry. The old workspace must have been eligible while its run could still mint: `planned`, bound to
 *  another session past the spawn stall. Then, before the next pass, the old row is removed by anything
 *  but this lane's own reclaim (whose answer forgets the entry), a dispatch finds that session spent and
 *  unbinds the run, the next dispatch's ws-add draws the same slug, and the run then leaves that binding
 *  (abandoned, or bound to yet another workspace past `planned`). The next pass must also come before
 *  the mirror PLACES the new `create`: a `create` that carries no clock, or one dated ahead of the
 *  server's, does not place it. A pass in between that reads the run with no session, with this
 *  one, or inside the spawn stall, or that lists no row for the slug, deletes the entry.
 *
 *  A SECOND, SAME-RUN ROUTE is not this function's to close: a licensed request (one sent with
 *  `--defer-expired`, because the old workspace's presence episode ran past its ceiling, spec §5.7) that
 *  is still queued behind other work on the session's queue when the same run mints the slug again. The
 *  executor re-reads the marker against the request's own run when the job reaches the front, so a
 *  marker naming that same run passes, and the new workspace is asked about on the old one's licence.
 *  Nothing in the entry can see it, because the request is already out. Carried to wave 7. */
export const childReclaimSameGeneration = (
  entry: ChildReclaimSweepEntry, bornAt: number | null, markerRunId: number,
): boolean => entry.bornAt !== null && entry.bornAt === bornAt && entry.markerRunId === markerRunId;

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

/** One session id's coordinator claims, folded to what the generation fence reads. */
export type ChildReclaimCoordinatorClaim = number | 'open' | 'unplaced';
/** Has THIS incarnation of the workspace coordinated? (spec §1 rule 4; spec §5.6: slugs recycle.) */
export const childReclaimCoordinated = (
  claim: ChildReclaimCoordinatorClaim | undefined, bornAt: () => number | null, skewMs: number,
): boolean => {
  if (claim === undefined) return false;
  if (claim === 'open' || claim === 'unplaced') return true;
  const born = bornAt();
  // Written so that a NaN on either side keeps the child: doubt keeps.
  return born === null || !(claim < born - skewMs);
};

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
  /** This session's coordinator claims, folded (`CoordStore.childReclaimCoordinatorClaims`), or `undefined` when
   *  it never held a chair. The verdict fences them to this workspace's own generation (`childReclaimCoordinated`,
   *  with `childBornAt`), through the SAME function the close, the executor and the hold-release job use, so none
   *  can disagree. */
  readonly coordinatorClaim: ChildReclaimCoordinatorClaim | undefined;
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

/** Every reason the sweep leaves a marked child alone this pass. Twenty words: the five KEPT ones are
 *  the L0 word type (`ChildReclaimKeptWord`, which the attention list's kept arm carries), and the
 *  rest are the sweep's own. `CHILD_RECLAIM_SKIP` classes every one of them. */
export type ChildReclaimSweepSkip =
  | ChildReclaimKeptWord
  | 'not-a-child' | 'marker-unreadable' | 'identity-unmeasured' | 'child-birth-unplaced'
  | 'held' | 'hold-unmeasured' | 'hold-retired' | 'terminal-refusal'
  | 'minting-run-unreadable' | 'minting-run-open' | 'dispatch-in-flight'
  | 'review-report-live' | 'reviewed-run-unreadable' | 'siblings-unreadable' | 'siblings-open';

/** One pass's verdict on one marked child. `runId` is the run the child's marker named when it was
 *  judged, carried by the three shapes that need it: an eligible verdict and a retired hold, for the
 *  request and the release job; and a KEPT word, which outlives a pass that judged nothing (spec §5.9)
 *  and so can meet a newer registry listing. A slug recycles under another run (spec §5.6), so a
 *  surface reads a kept verdict only for the run it carries (`isChildReclaimKeptVerdict`). Display only:
 *  no decision reads a kept verdict's `runId`. Every kept word is reached after the marker reads as a
 *  child, so the run is always known. */
export type ChildReclaimSweepVerdict =
  | { readonly eligible: true; readonly runId: number }
  | { readonly eligible: false; readonly why: 'hold-retired'; readonly runId: number;
      readonly release: ChildReclaimHoldRelease }
  | { readonly eligible: false; readonly why: ChildReclaimKeptWord; readonly runId: number }
  | { readonly eligible: false; readonly why: Exclude<ChildReclaimSweepSkip, 'hold-retired' | ChildReclaimKeptWord> };

/** A verdict that answers a KEPT word, with the run its marker named when it was judged. */
export type ChildReclaimKeptVerdict = Extract<ChildReclaimSweepVerdict, { readonly why: ChildReclaimKeptWord }>;

/** Does this verdict answer a kept word (spec §5.9)? The one test the kept reduction, the attention
 *  list's kept arm and the run chip's composer read a kept verdict through. */
export const isChildReclaimKeptVerdict = (v: ChildReclaimSweepVerdict): v is ChildReclaimKeptVerdict =>
  !v.eligible && isChildReclaimKeptWord(v.why);

/** How one skip word reads on the surfaces (spec §5.9). `ordinary` carries no sentence: the chip's
 *  own planned rows answer for it. The other three classes carry the sentence the server composes. */
export type ChildReclaimSkipRow =
  | { readonly class: 'ordinary' }
  | { readonly class: 'held' | 'kept' | 'doubt'; readonly sentence: string };

/** THE ONE TABLE, keyed by the sweep's skip words: each word is classed exactly once, here, and
 *  every surface reads the class from this table (spec §5.9) — so the chip and the banner cannot
 *  class a word two ways, and a word added to `ChildReclaimSweepSkip` is a compile error until it
 *  is classed. `as const satisfies`: total over the union, and each key keeps its own row type, so
 *  `CHILD_RECLAIM_SKIP.coordinating.sentence` and `CHILD_RECLAIM_SKIP[keptWord].sentence` compile
 *  (a plain `Record<…, ChildReclaimSkipRow>` annotation would make both TS2339). The sentences
 *  are the server's: the PWA renders what it is given and maps no word itself. Apostrophes are
 *  curly, as in `LC_REFUSAL_WORD`'s copy.
 *
 *  - `kept`: a standing answer, read from what the coordination database, the registry and the
 *    lifecycle mirror hold, never from a read that failed, so no raised switch, missing capability
 *    or failed read ends it, and automatic reclamation does not take the child while it stands.
 *    Its ground ends when what it was read from changes: a person removes the workspace or its
 *    marker, or restores or rebuilds the coordination database (a rebuilt one's new runs come to
 *    reach the marker's run id); or the child's birth, which the words at and past the birth fence
 *    depend on and which every judging pass places afresh, moves with no person acting. A recycled
 *    slug's newer `create`, mirrored late or dated ahead of the server's clock, can end
 *    `coordinating` or `minting-run-postdates-child` that way and leave the child eligible. The
 *    next judging pass judges it afresh. A hold that no run of the child's own accounts for
 *    (`held`, or `hold-unmeasured`) answers ahead of every kept word but `not-a-workspace`, and an
 *    open run naming the session (`siblings-open`) answers ahead of `coordinating`: each replaces
 *    the kept word while it stands, and neither leads to eligibility. The chip reads `refused`,
 *    which the fleet-wide switch never replaces; the banner lists the child. Each sentence but
 *    `not-a-workspace`'s ends with the same phrase, and the two minting-run words say, directly
 *    before it, that a rebuilt database may have left workers running.
 *  - `doubt`: a read that failed, or one that placed no birth for the child
 *    (`child-birth-unplaced`: the mirror holds no dated creation of the workspace), so the sweep
 *    left the child alone and reads again next pass. The chip reads `deferred`, which the switch
 *    turns to `paused`; it never reaches the banner or the kept feed row.
 *  - `held`: a hold stands. Read as `deferred` like a doubt; it never reaches the banner, and
 *    while it stands the attention list's failing arm does not list the child.
 *  - `ordinary`: the chip's planned rows already say it.
 *    - `hold-retired`: the hold-release job is acting.
 *    - `terminal-refusal`: the mirror's terminal row decides the chip, and the banner's terminal
 *      arm lists the child.
 *    - `review-report-live`: the chip's own review rows say it.
 *    - `not-a-child`: the lane skips a row with no child marker before it judges one, so there is
 *      no child for a chip to speak of.
 *    - `minting-run-open`, `dispatch-in-flight` and `siblings-open`: they never reach a closed
 *      run's row rule, because the hand-over conjunct answers first. */
export const CHILD_RECLAIM_SKIP = {
  // kept
  coordinating: { class: 'kept', sentence:
    'This workspace has held a coordinator’s chair since about when it was created, holds one now, or held one at a time that cannot be placed against its creation, so ccrc treats it as a coordinator’s workspace. '
    + 'ccrc never reclaims it on its own; a person removes it once nothing still needs it.' },
  'minting-run-absent': { class: 'kept', sentence:
    'The run this workspace’s child marker names is not in the coordination database, so nothing proves the workspace is finished; after a lost or rebuilt database every child reads this way. '
    + 'After a rebuild, workers may still be running in these. '
    + 'ccrc never reclaims it on its own; a person removes it once nothing still needs it.' },
  'minting-run-postdates-child': { class: 'kept', sentence:
    'The run this workspace’s child marker names opened after the workspace was created, so it cannot be the run that made it: either the coordination database was rebuilt, and then every child of the old database reads this way, or the fleet box’s clock reads behind the server’s. '
    + 'After a rebuild, workers may still be running in these. '
    + 'ccrc never reclaims it on its own; a person removes it once nothing still needs it.' },
  'reviewed-run-absent': { class: 'kept', sentence:
    'This review’s workspace holds a report the coordinator may still cite, and the run it reviewed is not in the coordination database, so nothing proves that run closed. '
    + 'ccrc never reclaims it on its own; a person removes it once nothing still needs it.' },
  // The one kept sentence that does not end with the common phrase: that phrase would tell a person
  // to remove a main checkout, so this one tells them to remove the marker, never the checkout.
  'not-a-workspace': { class: 'kept', sentence:
    'This is a project’s main checkout carrying a child marker, and automatic reclamation never takes a main checkout. '
    + 'ccrc never reclaims it on its own; a person removes the marker, never the checkout.' },
  // doubt
  'marker-unreadable': { class: 'doubt', sentence:
    'This workspace’s child marker could not be read, so whose child it is cannot be said. The sweep reads it again on its next pass.' },
  'identity-unmeasured': { class: 'doubt', sentence:
    'The registry could not read this workspace’s identity on the last pass, so the sweep left it alone. It reads it again on its next pass.' },
  'hold-unmeasured': { class: 'doubt', sentence:
    'Whether this workspace’s hold belongs to its own programme could not be read, so the hold is treated as standing. The sweep reads it again on its next pass.' },
  'child-birth-unplaced': { class: 'doubt', sentence:
    'The lifecycle journal holds no dated creation of this workspace, so nothing proves the run its child marker names made it. '
    + 'The sweep leaves it alone and looks for that creation again on its next pass.' },
  'minting-run-unreadable': { class: 'doubt', sentence:
    'The run this workspace’s child marker names could not be read from the coordination database. The sweep reads it again on its next pass.' },
  'reviewed-run-unreadable': { class: 'doubt', sentence:
    'The run this review’s workspace reviewed could not be read from the coordination database. The sweep reads it again on its next pass.' },
  'siblings-unreadable': { class: 'doubt', sentence:
    'Whether another run still uses this workspace could not be read. The sweep reads it again on its next pass.' },
  // held
  held: { class: 'held', sentence:
    'This workspace carries a hold, so the sweep leaves it alone: a person’s hold stands until they release it, and a programme’s until that programme has no open run.' },
  // ordinary
  'not-a-child': { class: 'ordinary' },
  'hold-retired': { class: 'ordinary' },
  'terminal-refusal': { class: 'ordinary' },
  'minting-run-open': { class: 'ordinary' },
  'dispatch-in-flight': { class: 'ordinary' },
  'review-report-live': { class: 'ordinary' },
  'siblings-open': { class: 'ordinary' },
} as const satisfies Readonly<Record<ChildReclaimSweepSkip, ChildReclaimSkipRow>>;

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
  if (i.workspace === null) return { eligible: false, why: 'not-a-workspace', runId: i.child.runId };
  if (i.held.kind === 'held') return { eligible: false, why: 'held' };
  if (i.held.kind === 'unmeasured') return { eligible: false, why: 'hold-unmeasured' };
  if (i.terminal) return { eligible: false, why: 'terminal-refusal' };
  if (!i.mintingRun.ok) return { eligible: false, why: 'minting-run-unreadable' };
  const run = i.mintingRun.run;
  // THE AMENDED RULE. An absent minting run is NEVER eligible: a lost or
  // rebuilt coordination database makes every child's run absent at once, the
  // live ones included. The orphans the first draft reached through absence
  // are reached through the branch below instead.
  if (run === null) return { eligible: false, why: 'minting-run-absent', runId: i.child.runId };
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
  if (run.openedAt > i.childBornAt + i.skewMs) {
    return { eligible: false, why: 'minting-run-postdates-child', runId: i.child.runId };
  }
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
  // word for the same condition. An unreadable reviewed run is doubt, and
  // doubt waits. An absent one is kept: nothing proves that a run the
  // database does not hold has closed.
  switch (i.reviewedRun.kind) {
    case 'not-a-review': break;
    case 'absent': return { eligible: false, why: 'reviewed-run-absent', runId: i.child.runId };
    case 'unreadable': return { eligible: false, why: 'reviewed-run-unreadable' };
    case 'run':
      if (!isTerminalRunState(i.reviewedRun.state)) return { eligible: false, why: 'review-report-live' };
      break;
  }
  if (!i.siblings.ok) return { eligible: false, why: 'siblings-unreadable' };
  if (i.siblings.open > 0) return { eligible: false, why: 'siblings-open' };
  // A child whose CURRENT incarnation has coordinated a run (spec §1 rule 4:
  // manual cleanup is reserved for a coordinator's own workspace) is never
  // reclaimed automatically. That covers an open or unplaceable claim, and one
  // that ended at or after this generation's birth less the skew. A claim that
  // ended before this workspace existed belongs to an earlier workspace under
  // the same slug (spec §5.6), destroyed before ws-add could create this one.
  if (childReclaimCoordinated(i.coordinatorClaim, () => i.childBornAt, i.skewMs)) {
    return { eligible: false, why: 'coordinating', runId: i.child.runId };
  }
  if (i.held.kind === 'program') {
    return { eligible: false, why: 'hold-retired', runId: i.child.runId,
      release: { reason: i.held.reason, program: i.held.program, accountedRunId: i.held.accountedRunId } };
  }
  return { eligible: true, runId: i.child.runId };
}

/** The verdicts a pass that judged nothing keeps (spec §5.9): the KEPT words only. Each is read from
 *  what the coordination database, the registry and the lifecycle mirror hold, never from a read that
 *  failed, so a raised switch, a missing capability or a failed read does not make it untrue, and the
 *  attention list keeps listing it. What it was read from can still change meanwhile
 *  (`CHILD_RECLAIM_SKIP`'s class notes say how), and the next judging pass reads the change. Every
 *  other verdict is dropped, a doubt word's included: after such a pass it reads "no verdict yet",
 *  never eligible. A kept verdict keeps the run it was judged under, so it stays the word of that
 *  workspace alone while the registry moves on (spec §5.6): the surfaces read it only for that run. */
export function childReclaimKeptVerdicts(
  verdicts: ReadonlyMap<string, ChildReclaimSweepVerdict>,
): ReadonlyMap<string, ChildReclaimSweepVerdict> {
  return new Map([...verdicts].filter(([, v]) => isChildReclaimKeptVerdict(v)));
}

/** The executor's outcome, as far as this memory needs it. STRUCTURAL:
 *  wave 3's `ChildReclaimOutcome` is assignable to it without this file
 *  importing `coord/childReclaim.ts` (an L3/L4 module). */
export type ChildReclaimSweepOutcome =
  | { readonly kind: 'reclaimed' | 'gone' | 'failed' }
  | { readonly kind: 'refused'; readonly token: string }
  | { readonly kind: 'deferred'; readonly why: string };

/** How far apart two presence-class answers of one CONTINUOUS episode may be
 *  (the later answer's ARRIVAL from the earlier one's REQUEST), and how far
 *  the episode's latest REQUEST may be from the ask the ceiling would license
 *  (spec §5.7, "continuous deferral"): two and a half pass intervals,
 *  inclusive, each gap read as the larger of the monotonic and the wall-clock
 *  difference. The lease holder (`childReclaimAskOrder`) is asked on every
 *  pass it is due, so its gap is one pass spacing plus its answer's latency.
 *  Passes are at least 60 s apart, because the watcher's monotonic throttle
 *  refuses an earlier one, and measured pass gaps run 60–80 s; the
 *  51.5–79.6 s measured on 2026-10-05 was the spacing of `ws-reclaim`
 *  intents, not of passes. An audit answers in seconds, so the margin is
 *  about 60 s. A slow tick, a slow answer, a forward wall-clock step or a
 *  suspended box can push a gap past it. The episode then restarts, the
 *  licence is withheld and the holder forfeits the lease, which fails closed
 *  and costs that child its place in line. A child that does not hold the
 *  lease is asked only when the order reaches it, usually later than that, so
 *  its episode restarts until it holds the lease. The bound is this
 *  multiplier times the interval the caller hands in, never a constant of its
 *  own. */
const CHILD_RECLAIM_PRESENCE_GAP_PASSES = 2.5;

/** Is `now` within `CHILD_RECLAIM_PRESENCE_GAP_PASSES` pass intervals of the
 *  entry's latest presence-class REQUEST (inclusive), on the LARGER of the
 *  monotonic and the wall-clock differences? `false` with no presence answer
 *  on record. The one gap reading: continuity and freshness both ask it. */
const childReclaimPresenceWithin = (entry: ChildReclaimSweepEntry, now: ChildReclaimLaneNow, passIntervalMs: number): boolean =>
  entry.lastPresenceDeferredAt !== null && entry.lastPresenceWallAt !== null
  && Math.max(now.monoMs - entry.lastPresenceDeferredAt, now.wallMs - entry.lastPresenceWallAt)
     <= CHILD_RECLAIM_PRESENCE_GAP_PASSES * passIntervalMs;

/** The memory after one attempt (spec §5.7, §5.9). `null` = forget the
 *  child's entry: it is already gone, or truly reclaimed. A TERMINAL REFUSAL
 *  keeps its entry instead of forgetting it — the lifecycle mirror holds the
 *  refusal for the attention list, and this memory's own job is only pacing:
 *  it stamps `refusedAt` so the lane does not ask again before the next
 *  ceiling. A FAILURE counts one more in the run and stamps when it was
 *  asked. A DEFERRAL ends any run of failures and clears `refusedAt`, and
 *  starts the any-kind clock once.
 *
 *  The PRESENCE clock is an EPISODE (spec §5.7). Every outcome other than a
 *  presence-class deferral ends it, so `failed` (a rejected request among
 *  them, which the lane writes as `failed`), `refused` and a non-presence
 *  `deferred` clear `firstPresenceDeferredAt`, `lastPresenceDeferredAt`,
 *  `lastPresenceWallAt` and `presenceHeldSince`.
 *
 *  A presence-class deferral brackets its observation. It stamps the REQUEST
 *  (`ask.at`) into `lastPresenceDeferredAt` (monotonic) and
 *  `lastPresenceWallAt` (wall). It STARTS a new episode at its ARRIVAL
 *  (`answered.monoMs`) in three cases:
 *  - none is running;
 *  - the request was `licensed` (sent with `deferExpired: true`), so an answer
 *    to it restarts the episode rather than letting every later retry keep
 *    skipping ccd's presence rungs;
 *  - the arrival is more than `CHILD_RECLAIM_PRESENCE_GAP_PASSES` ×
 *    `passIntervalMs` after the previous request on either clock, so the time
 *    between was never observed.
 *
 *  Only an UNLICENSED presence answer arriving within that gap (inclusive)
 *  extends the episode. An unlicensed presence answer keeps
 *  `presenceHeldSince`, or sets it to its arrival, except that a request sent
 *  as the lease's holder whose answer does not extend the episode clears it:
 *  the holder forfeits. A licensed one clears it. `firstDeferredAt` (stamped once) and `lastPresenceWallAt`
 *  are `ask.at.wallMs`; `lastPresenceDeferredAt`, `lastAskedAt`, `lastFailedAt` and `refusedAt` are `ask.at.monoMs`.
 *
 *  `lastDeferWhy` is the deferral's own word after a deferral and null after
 *  every other outcome, a rejection (written as `failed`) among them: the
 *  episode the executor's feed row is written once for (spec §5.9). Nothing
 *  that paces or orders an ask reads it.
 *
 *  `passIntervalMs` is the lane's pass interval — an argument, as
 *  `childReclaimDue`'s is, because this L1 file imports no L4 constant. */
export function childReclaimNextEntry(
  entry: ChildReclaimSweepEntry, outcome: ChildReclaimSweepOutcome, ask: ChildReclaimAsk, answered: ChildReclaimLaneNow,
  passIntervalMs: number,
): ChildReclaimSweepEntry | null {
  switch (outcome.kind) {
    case 'reclaimed': case 'gone': return null;
    case 'failed':
      return {
        ...entry, consecutiveFailures: entry.consecutiveFailures + 1, lastFailedAt: ask.at.monoMs,
        firstPresenceDeferredAt: null, lastPresenceDeferredAt: null, lastPresenceWallAt: null, presenceHeldSince: null,
        refusedAt: null, lastAskedAt: ask.at.monoMs, lastDeferWhy: null,
      };
    case 'refused':
      return {
        ...entry, consecutiveFailures: 0, lastFailedAt: null,
        firstPresenceDeferredAt: null, lastPresenceDeferredAt: null, lastPresenceWallAt: null, presenceHeldSince: null,
        refusedAt: ask.at.monoMs, lastAskedAt: ask.at.monoMs, lastDeferWhy: null,
      };
    case 'deferred': {
      const presence = (CHILD_RECLAIM_PRESENCE_DEFERS as readonly string[]).includes(outcome.why);
      // the NEW answer's ARRIVAL against the previous answer's REQUEST
      const continues = presence && !ask.licensed && entry.firstPresenceDeferredAt !== null
        && childReclaimPresenceWithin(entry, answered, passIntervalMs);
      // the lease: an unlicensed presence answer keeps the child in line or puts it at the back,
      // EXCEPT that a holder whose answer does not continue its episode forfeits
      const inLine = presence && !ask.licensed && (continues || !ask.asHolder);
      return {
        ...entry,
        firstDeferredAt: entry.firstDeferredAt ?? ask.at.wallMs,                                                // WALL: display only
        firstPresenceDeferredAt: presence ? (continues ? entry.firstPresenceDeferredAt : answered.monoMs) : null, // the episode starts at an ARRIVAL
        lastPresenceDeferredAt: presence ? ask.at.monoMs : null,                                                // freshness reads the REQUEST
        lastPresenceWallAt: presence ? ask.at.wallMs : null,
        presenceHeldSince: inLine ? (entry.presenceHeldSince ?? answered.monoMs) : null,
        refusedAt: null, consecutiveFailures: 0, lastFailedAt: null, lastAskedAt: ask.at.monoMs,
        lastDeferWhy: outcome.why,                                                                              // the episode a feed row is written once for
      };
    }
  }
}

/** May this ask go out LICENSED (`deferExpired: true`)? Only when BOTH hold.
 *  First, the current PRESENCE episode has spanned the ceiling on the
 *  MONOTONIC clock, measured from its first answer's ARRIVAL (at EXACTLY the
 *  ceiling, yes). Second, its latest answer's REQUEST is within
 *  `CHILD_RECLAIM_PRESENCE_GAP_PASSES` × `passIntervalMs` of `now` on the
 *  larger of the two clocks (inclusive). So the licence rests on presence
 *  observed continuously up to the ask in real time, never on one sample
 *  followed by time nobody measured (spec §5.7: "15 minutes of continuous
 *  deferral"). `presenceHeldSince` is never read here: the lease decides who
 *  is asked, never what is licensed. The presence clock alone:
 *  any other deferral is a condition the ceiling must never override. How
 *  long the child waited is not this function's to say: the lane passes
 *  `entry.firstDeferredAt` — the OTHER clock — on every request as
 *  `ChildReclaimRequest.deferredSinceMs`, and the executor's ONE feed row
 *  states the wait and its why for a `deferred` outcome and for a
 *  ceiling-expired reclaim (spec §5.7, §5.9). */
export const childReclaimDeferExpired = (entry: ChildReclaimSweepEntry, now: ChildReclaimLaneNow, passIntervalMs: number): boolean =>
  entry.firstPresenceDeferredAt !== null
  && now.monoMs - entry.firstPresenceDeferredAt >= CHILD_RECLAIM_DEFER_CEILING_MS   // the span: the MONOTONIC clock alone
  && childReclaimPresenceWithin(entry, now, passIntervalMs);                         // freshness: the larger of the two clocks

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
const childReclaimBackoffOver = (entry: ChildReclaimSweepEntry, monoMs: number, passIntervalMs: number): boolean =>
  entry.lastFailedAt === null
  || monoMs - entry.lastFailedAt >= childReclaimBackoffMs(entry.consecutiveFailures, passIntervalMs);

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
 *  a pacing question itself. `monoMs` is the lane's MONOTONIC clock, the
 *  clock both `lastFailedAt` and `refusedAt` are stamped on. */
export const childReclaimDue = (entry: ChildReclaimSweepEntry, monoMs: number, passIntervalMs: number): boolean =>
  childReclaimBackoffOver(entry, monoMs, passIntervalMs)
  && (entry.refusedAt === null || monoMs - entry.refusedAt >= CHILD_RECLAIM_DEFER_CEILING_MS);

/** Least first by (`presenceHeldSince`, `firstEligibleAt`, id): the lease's
 *  seniority. Read only for items whose `presenceHeldSince` is a number. */
const childReclaimSeniorFirst = (
  a: { readonly id: string; readonly entry: ChildReclaimSweepEntry }, ah: number,
  b: { readonly id: string; readonly entry: ChildReclaimSweepEntry }, bh: number,
): boolean => {
  if (ah !== bh) return ah < bh;
  if (a.entry.firstEligibleAt !== b.entry.firstEligibleAt) return a.entry.firstEligibleAt < b.entry.firstEligibleAt;
  return a.id < b.id;
};

/** THE ORDER THE LANE ASKS IN (spec §5.7: a wait on presence is bounded). The
 *  holder of the presence lease comes first: the due child with a
 *  `presenceHeldSince`, least by (`presenceHeldSince`, `firstEligibleAt`, id).
 *  It is named in `holderId`, so the lane can tell each answer which role its
 *  request was sent in. Every other due child follows in the fairness order
 *  (`lastAskedAt`, never-asked first, then `firstEligibleAt`, then id), which
 *  used to be the lane's own inline sort.
 *
 *  Without the holder first, three or more due children that keep deferring
 *  ask each presence-held child every third pass or later. That is past the
 *  continuity gap, so no episode ever spans the ceiling. With the holder
 *  first, it is asked on every pass it is due, exactly as a lone child is. A
 *  holder that cannot keep its episode continuous forfeits
 *  (`childReclaimNextEntry`), so the lease never outlives the timing it rests
 *  on.
 *
 *  A PERMUTATION of `due`: it adds no ask and changes no pacing, and the lane
 *  still takes its free slots from the front. The cost: while a lease runs, no
 *  other due child is asked, so a backlog drain pauses for one lease per
 *  presence-held child (`ChildReclaimSweepEntry` states the bound's three
 *  figures). */
export function childReclaimAskOrder<T extends { readonly id: string; readonly entry: ChildReclaimSweepEntry }>(
  due: readonly T[],
): { readonly order: T[]; readonly holderId: string | null } {
  let holder: T | null = null;
  let holderSince = 0;
  for (const x of due) {
    const since = x.entry.presenceHeldSince;
    if (since === null) continue;
    if (holder === null || childReclaimSeniorFirst(x, since, holder, holderSince)) {
      holder = x;
      holderSince = since;
    }
  }
  const rest = due.filter((x) => x !== holder);
  rest.sort((a, b) => {
    const la = a.entry.lastAskedAt;
    const lb = b.entry.lastAskedAt;
    // `lastAskedAt` first, null (never asked) sorting before any instant —
    // but ONLY when the two differ: two children tied on this key (both
    // null, or asked at the identical instant) fall through to
    // `firstEligibleAt` rather than straight to id, so a never-asked child
    // sighted earlier is still asked before one sighted later.
    if (la !== lb) {
      if (la === null) return -1;
      if (lb === null) return 1;
      return la - lb;
    }
    if (a.entry.firstEligibleAt !== b.entry.firstEligibleAt) return a.entry.firstEligibleAt - b.entry.firstEligibleAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { order: holder === null ? rest : [holder, ...rest], holderId: holder === null ? null : holder.id };
}

/** One row of the mirror read the attention list and the terminal exclusion
 *  share: the LATEST `reclaim` event of one session's CURRENT GENERATION, of
 *  any outcome — declared here, by its consumer. `outcome` is the mirror's
 *  outcome; `at` is ccd's clock, or null when the line carried none;
 *  `failingSince`, only when that event is a failure line
 *  (`childReclaimFailureLine`), is when the unbroken run of failures ending at
 *  it began, on ccd's clock. NO `ingestedAt`: it is the
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

/** The `reclaim` refusals ccd journals for a PRE-LOCK die, keyed by the die. Spelled here, once:
 *  `coord/` code reads them by property, never as a quoted literal. `flock` and `lock` date from
 *  wave 3. `token` and `runId` date from wave 6 (spec §5.9): the two argv dies tied to an id,
 *  journaled once the session id is valid. The usage, bad-session-id and python3 dies are never
 *  journaled, so they are never here. */
export const CHILD_RECLAIM_PRE_LOCK_TOKEN = {
  flock: 'flock-unavailable', lock: 'lock-unopenable', token: 'token-malformed', runId: 'run-id-malformed',
} as const satisfies Readonly<Record<'flock' | 'lock' | 'token' | 'runId', LcRefusalToken>>;
export type ChildReclaimPreLockToken = (typeof CHILD_RECLAIM_PRE_LOCK_TOKEN)[keyof typeof CHILD_RECLAIM_PRE_LOCK_TOKEN];
const CHILD_RECLAIM_PRE_LOCK_TOKENS: readonly string[] = Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN);
/** Use THIS, never `.includes(x as ChildReclaimPreLockToken)`: `isRunState`'s rule. */
export function isChildReclaimPreLockToken(v: unknown): v is ChildReclaimPreLockToken {
  return typeof v === 'string' && CHILD_RECLAIM_PRE_LOCK_TOKENS.includes(v);
}
/** A `reclaim` line that is part of a run of FAILURES (spec §5.9): `failed`, or `refused` with one
 *  of the pre-lock tokens. ccd journals those pre-lock dies through `_lc_refuse`; the
 *  executor reads the same call as a `pre-lock-die` failure and the sweep retries it, so the
 *  report reads it as the failure it is, never as a settled refusal. ONLY these, by name: a
 *  token ccd starts journaling under `reclaim` later is classified when it is added, in this
 *  table or in `CHILD_RECLAIM_TOKEN_KIND`, and is never inherited. NOT read by
 *  `childReclaimTerminalRefusal`: no pre-lock token is terminal. */
export const childReclaimFailureLine = (e: { readonly outcome: string; readonly refusal: string | null }): boolean =>
  e.outcome === FAILED || (e.outcome === REFUSED && isChildReclaimPreLockToken(e.refusal));

/** ONE session's attention input row. `generation` is
 *  `childReclaimGeneration(events, at)`'s answer and `latest` is
 *  `childReclaimLatest(generation)`'s (`coord/childReclaim.ts`): where a
 *  generation starts and which event is latest — `intent` included — are
 *  decided there, once, and this file cannot import either, so the latest
 *  event is passed IN rather than picked again here. What this adds is the
 *  failure run: walking back from the end over `reclaim` events, `intent`s
 *  (the start of each attempt) and other acts are read past, each failure line
 *  (`childReclaimFailureLine`: a `failed`, or a pre-lock refusal) that ccd
 *  placed moves the start back, and any other outcome ends the walk.
 *  Time is ccd's clock ALONE: a failure line that carried no `at` is still
 *  a failure — it does not end the run — but it cannot be placed, so it
 *  starts no clock. The mirror's `ingestedAt` is never read. */
export function childReclaimJournalRow(
  generation: readonly MirroredLifecycleEvent[], latest: MirroredLifecycleEvent | null,
): ChildReclaimJournalRow | null {
  if (latest === null || latest.id === null) return null;
  let failingSince: number | null = null;
  if (childReclaimFailureLine(latest)) {
    for (let k = generation.length - 1; k >= 0; k -= 1) {
      const e = generation[k]!;
      if (e.act !== RECLAIM_ACT || e.outcome === INTENT) continue;
      if (!childReclaimFailureLine(e)) break;
      if (e.at !== null) failingSince = e.at;
    }
  }
  return { sessionId: latest.id, outcome: latest.outcome, refusal: latest.refusal, at: latest.at, failingSince };
}

/** THE reading of "this child stands under a TERMINAL refusal": its latest
 *  reclaim event is a refusal whose token wave 3 classes terminal. Shared by
 *  the attention list and the lane's terminal exclusion, so the two can never
 *  disagree — and deliberately NOT "is on the attention list", which also
 *  names children whose reclaim keeps FAILING, and a failure is retried. A
 *  pre-lock refusal is a failure line, never terminal (`childReclaimFailureLine`). */
export const childReclaimTerminalRefusal = (
  row: ChildReclaimJournalRow, kindOf: (token: string) => ChildReclaimTokenKind | null,
): boolean => row.outcome === REFUSED && row.refusal !== null && kindOf(row.refusal) === 'terminal';

/** Has this child's reclaim kept failing for the whole ceiling (spec §5.9)?
 *  At EXACTLY the ceiling, yes. A failure row with no run start says nothing. */
export const childReclaimFailingPastCeiling = (row: ChildReclaimJournalRow, nowMs: number): boolean =>
  childReclaimFailureLine(row) && row.failingSince !== null && nowMs - row.failingSince >= CHILD_RECLAIM_DEFER_CEILING_MS;

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

/** The last failure's word that `childReclaimFailingSentence` carries, derived
 *  ONCE for both of its callers: the attention list's failing arm, and the run
 *  chip past the ceiling (spec §5.9). So the banner and the chip say the same
 *  thing of one line. The journal word comes first (`lcRefusalWord`) and the
 *  server's lookup second. Null only when ccd journaled no token: an empty
 *  token is a token here, read through the lookup like any other. */
export const childReclaimFailingWord = (refusal: string | null, sentenceFor: (token: string) => string): string | null =>
  refusal === null ? null : (lcRefusalWord(refusal) ?? sentenceFor(refusal));

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

/** The two arms of the attention list that the lifecycle mirror alone derives
 *  (spec §5.9); `childReclaimAttention` answers these and no other. */
export type ChildReclaimJournalAttention = Extract<ChildReclaimAttention, { readonly kind: 'terminal' | 'failing' }>;

/** The fleet-level attention list (spec §5.9): each child whose latest reclaim
 *  event in its current generation is a refusal wave 3 classes TERMINAL, or a
 *  failure closing a run of failures that has lasted the ceiling, and whose
 *  registry row still exists — with the server's sentence. An `intent` as the
 *  latest event lists nothing: an attempt is in flight, or died mid-way.
 *  DERIVED FROM THE MIRROR ALONE, "so a restart does not lose it": an
 *  audit-time terminal refusal is a mirror row like any other, because wave
 *  3's `cmd_ws_audit --reclaim` journals each terminal verdict it answers
 *  (`verb ws-audit`), and a failure is an `_lc_fail` line (an attempt that
 *  started, or a probe that could not run, spec §5.9) or a pre-lock die's `_lc_refuse` line
 *  (`childReclaimFailureLine`). No executor answer and no in-memory memo is an input. A report:
 *  nothing waits on it. A failure's sentence is its journal word first
 *  (`lcRefusalWord`, the journal-only map) and the server's lookup second —
 *  the order `lcRefusalWord`'s own docstring prescribes. Only ccd's own `at`
 *  places a line in time: a child whose latest line carried none cannot say
 *  since when, and is not listed — the mirror's ingest time is the server's
 *  clock and never an event time. */
export function childReclaimAttention(i: ChildReclaimAttentionInput): ChildReclaimJournalAttention[] {
  const out: ChildReclaimJournalAttention[] = [];
  for (const row of i.latest) {
    if (!i.live.has(row.sessionId)) continue;
    // Unplaceable: no `at`, no item — whichever arm below it would reach.
    if (row.at === null) continue;
    const runId = i.live.get(row.sessionId) ?? null;
    if (childReclaimTerminalRefusal(row, i.kindOf)) {
      out.push({
        kind: 'terminal', sessionId: row.sessionId, runId, token: row.refusal!, sentence: i.sentenceFor(row.refusal!),
        // Since when: the refusal's own line, on ccd's clock.
        at: row.at,
      });
    } else if (childReclaimFailingPastCeiling(row, i.nowMs)) {
      const word = childReclaimFailingWord(row.refusal, i.sentenceFor);
      out.push({
        kind: 'failing', sessionId: row.sessionId, runId, token: row.refusal ?? '', sentence: childReclaimFailingSentence(word),
        // Since when: the start of the run of failures, not its latest line.
        at: row.failingSince!,
      });
    }
  }
  return out;
}

/** One marked child the sweep keeps on purpose (spec §5.9): the attention list's `kept` arm. */
export type ChildReclaimKeptAttention = Extract<ChildReclaimAttention, { readonly kind: 'kept' }>;

/** More children than this answering ONE kept word collapse into one line (spec §5.9): after a lost
 *  or rebuilt coordination database every child answers the same word at once. */
export const CHILD_RECLAIM_KEPT_MANY_OVER = 5;

const childReclaimBySession = (a: { readonly sessionId: string }, b: { readonly sessionId: string }): number =>
  (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0);

/** The attention list's kept arm (spec §5.9): one item per recorded verdict that is not eligible and
 *  answers a KEPT word, for a row this listing still carries as a child (`live` → the marker's run id,
 *  null when the row is no longer a child) whose marker still names the run the verdict was judged
 *  under, and that has no `terminal` item, because ccd's own terminal word outranks the sweep's, as on
 *  the chip. A marker naming another run is a recycled slug's next workspace (spec §5.6): the old
 *  workspace's kept verdict, which a pass that judged nothing keeps, is not listed for it, and the
 *  next judging pass judges it afresh. Doubt words, `held` and the ordinary words never reach it.
 *  The sentence is the sweep table's, so the banner and the chip say the same thing. Ordered by session
 *  id. Pure and deterministic: the coord frame's byte-equality guard emits once per change. */
export function childReclaimKeptItems(i: {
  readonly verdicts: ReadonlyMap<string, ChildReclaimSweepVerdict>;
  readonly live: ReadonlyMap<string, number | null>;
  readonly mirrorArms: readonly ChildReclaimJournalAttention[];
}): ChildReclaimKeptAttention[] {
  const terminal = new Set(i.mirrorArms.filter((a) => a.kind === 'terminal').map((a) => a.sessionId));
  const out: ChildReclaimKeptAttention[] = [];
  for (const [sessionId, v] of i.verdicts) {
    if (!isChildReclaimKeptVerdict(v)) continue;
    const runId = i.live.get(sessionId);
    if (typeof runId !== 'number') continue;
    if (v.runId !== runId) continue;
    if (terminal.has(sessionId)) continue;
    out.push({ kind: 'kept', sessionId, runId, word: v.why, sentence: CHILD_RECLAIM_SKIP[v.why].sentence });
  }
  return out.sort(childReclaimBySession);
}

/** The sentence of a collapsed kept line (spec §5.9): the count, then the one reason each child is kept for. */
export function childReclaimKeptManySentence(word: ChildReclaimKeptWord, n: number): string {
  return `${n} child workspaces are kept for the same reason. For each one: ${CHILD_RECLAIM_SKIP[word].sentence}`;
}

/** What the kept items list as (spec §5.9): a word answered by MORE than `CHILD_RECLAIM_KEPT_MANY_OVER`
 *  children becomes ONE `kept-many` item naming every one of them; every other word's items stay single.
 *  The singles come first, ordered by session id, then the groups, in the word list's order. */
export function childReclaimKeptList(items: readonly ChildReclaimKeptAttention[]): ChildReclaimAttention[] {
  const sorted = [...items].sort(childReclaimBySession);
  const singles: ChildReclaimKeptAttention[] = [];
  const groups: ChildReclaimAttention[] = [];
  for (const word of CHILD_RECLAIM_KEPT_WORDS) {
    const these = sorted.filter((a) => a.word === word);
    if (these.length > CHILD_RECLAIM_KEPT_MANY_OVER) {
      groups.push({
        kind: 'kept-many', word,
        members: these.map((a) => ({ sessionId: a.sessionId, runId: a.runId })),
        sentence: childReclaimKeptManySentence(word, these.length),
      });
    } else {
      singles.push(...these);
    }
  }
  return [...singles.sort(childReclaimBySession), ...groups];
}

/** The whole attention list (spec §5.9): the mirror arms, then the kept arm, with ONE item per child.
 *  A `kept` item replaces that child's `failing` item (a kept child is never asked, so its failure run
 *  can stand past the ceiling, and the failing sentence — "ccrc retries it" — would be false of it). A
 *  child whose recorded verdict is `held` has no `failing` item either, for the same reason: it is never
 *  asked while the hold stands. Only `held` withholds — a doubt word keeps wave 4's failing item — and a
 *  `terminal` item is never filtered. With no verdict recorded the failing arm stands as it always did. */
export function childReclaimAttentionWithKept(
  mirrorArms: readonly ChildReclaimJournalAttention[], kept: readonly ChildReclaimKeptAttention[],
  verdicts: ReadonlyMap<string, ChildReclaimSweepVerdict>,
): ChildReclaimAttention[] {
  const keptIds = new Set(kept.map((a) => a.sessionId));
  const heldIds = new Set([...verdicts].filter(([, v]) => !v.eligible && v.why === 'held').map(([id]) => id));
  return [
    ...mirrorArms.filter((a) => !(a.kind === 'failing' && (keptIds.has(a.sessionId) || heldIds.has(a.sessionId)))),
    ...childReclaimKeptList(kept),
  ];
}

/** What the feed already says for one child (spec §5.9), as the lane tells the executor on each request. */
export interface ChildReclaimFeedQuiet {
  /** The non-presence deferral episode this child is in, or null. */
  readonly deferWhy: string | null;
  /** The token of this child's `failing` attention item, or null when the failing arm does not list
   *  it, or lists it with no token. */
  readonly failureToken: string | null;
}

/** What the feed already says for this child (spec §5.9), derived from the entry the lane keeps and the
 *  attention list it has just published. `deferWhy` is the entry's latest deferral word unless that word is
 *  one of the presence defers, which keep their one-row-per-pass shape (the ceiling's own row states the wait
 *  each one ends). `failureToken` is the word of this child's `failing` item, when it has one and the item
 *  carries a word: a `terminal` item, another child's item and an item with no token say nothing. Pure: the
 *  executor decides nothing on it but whether its own feed row would repeat it. */
export function childReclaimFeedQuiet(
  entry: ChildReclaimSweepEntry, listed: readonly ChildReclaimAttention[], sessionId: string,
): ChildReclaimFeedQuiet {
  const why = entry.lastDeferWhy;
  const deferWhy = why !== null && !(CHILD_RECLAIM_PRESENCE_DEFERS as readonly string[]).includes(why) ? why : null;
  const failing = listed.find((a) => a.kind === 'failing' && a.sessionId === sessionId);
  const failureToken = failing !== undefined && failing.kind === 'failing' && failing.token !== '' ? failing.token : null;
  return { deferWhy, failureToken };
}
