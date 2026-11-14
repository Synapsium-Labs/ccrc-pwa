// L2 ports (ARCH-03, D-6003): the three capabilities the coordination lanes, the turn reads and the watcher take
// from their hosts (two from their L4 hosts, and the watcher's narrow view of the store, D-7579), declared here beside
// their consumers so no file below L4 imports `server.ts` or `watch.ts`, even for a type. Every top-level statement is
// a type: tsc emits nothing for this file's declarations.
import type { CcdArgv } from '../ccdargv.js';
import type { CoordStore } from './store.js';
import type { NotRan, Unmeasured } from '../unmeasured.js';
import type { Statusline } from '../pane/statusline.js';

/** `killed` and `signal` are REQUIRED here, unlike their `ExecResult`
 *  counterparts: no test anywhere builds a `CcdResult` literal, and only a
 *  handful of whole-object `toEqual`s in `lifecycle.test.ts` observe them — so
 *  requiring them costs nothing and forces every producer to answer.
 *
 *  REQUIRED, so they carry the TOKEN rather than an absence (`exec.ts`'s
 *  vocabulary paragraph). §1.7: `killed: boolean` USED to be the answer and was
 *  wrong in one direction only — `r.killed === true` collapsed an ABSENT
 *  optional into `false`, telling every caller "this child was not killed" when
 *  the truth was "nobody measured whether it was". The adoption gate handles
 *  those two differently on purpose, and an older agent, the transport catch
 *  path and `local` mode all land in the second. */
interface CcdAnswer {
  ok: boolean; stdout: string; stderr: string;
  killed: boolean | Unmeasured;
  signal: string | null | Unmeasured;
}

/** D-6034, D-6840 (ARCH-10, #543): the runner's `ran` discriminant, CARRIED by `ccd()` (`lifecycle.ts`) and
 *  required on both arms (an agent older than the key is read as `ran: true` by `asExecResult`): `ran: true` is a ccd that ran and exited (`ok` is its exit code 0); `ran: false` is the not-ran arm, whose
 *  every other field is what it was before the arm existed (`ok: false`, the runner's `stderr`, and `killed`/`signal`
 *  from the same hop), so a reader of `ok` alone narrows to the ran arm by `ok` itself. A reader that classifies a
 *  refusal, a box word or a die reads `ran === false` FIRST and reports it as unmeasured and retryable, never as a
 *  refusal: a transport failure is never permission to act, nor a verdict. */
export type CcdResult =
  | (CcdAnswer & { ran: true;
      /** The ran arm's measured exit code (landing-order 5h), set by `ccd()` from the runner's `code`; ABSENT means the
       *  producer did not measure it and is never read as 0, and the not-ran arm never carries it. */
      exitCode?: number })
  | (CcdAnswer & NotRan & { ok: false });

/** The single ccd capability: run one `ccd` verb. Failure contract: a non-zero exit is `ok: false` with the verb's
 *  stderr, and whether the child was cut short is `killed`/`signal`, `Unmeasured` when nobody measured it.
 *  `Deps.runCcd` is this type, and `lifecycle.ts`'s `CcdRunner` names it. */
export type RunCcd = (argv: CcdArgv) => Promise<CcdResult>;

/** The watcher's newest pane-scraped reads, as the turn reads take them (`turnverdict.ts`'s `turnReadDeps`).
 *  `FleetWatcher` satisfies it. Failure contract: both reads are synchronous snapshots of the last sweep, never a
 *  throw, each a fresh copy; an empty set or map means the last sweep saw none, and no watcher at all is the
 *  caller's `undefined`. */
export interface FleetWatcherView {
  currentPending(): Set<string>;
  currentStatuslines(): Map<string, Statusline>;
}

/** D-7579 (increment 7, WP2): increment 7's one narrow store port. Its members are every `CoordStore` member that the
 *  watcher (`watch.ts`), its lane files (`*Lane.ts`, `lane*.ts`) and everything they hand the store to reach, as
 *  D-7578's census (`server/test/scan/parse.ts#storeReach`) measures them; `rings/watcher-store-port.test.ts` reads
 *  this list through the checker and reports a reached member it lacks or a member nothing reaches. A lane that
 *  needs a new member adds it here, in its sorted place, in the same PR. Never split it per lane or per callee (the
 *  ruling of 2026-10-30, the plan's Rejected list): one port, one member list. */
export type WatcherCoordMember =
  | 'absorbParkEscalation' | 'activeClaims' | 'advanceCursor' | 'advanceLanding' | 'advanceObserved'
  | 'approvalById' | 'approvalsForChild' | 'approvalsInState' | 'askById'
  | 'autoContinueHeldUntil' | 'backOff' | 'baselineParkBox' | 'bigCallsIn' | 'bindingRunsOf' | 'bindingsOf' | 'bumpReplayCount'
  | 'cancelDeliveriesTo' | 'checksRows' | 'clearShadowWalk' | 'childReclaimCoordinatorClaims' | 'childReclaimSessionIds'
  | 'childStaleActivity' | 'claimDigestDay' | 'claudeBuilds' | 'closeRun' | 'closedProgrammeClaimants' | 'collectLaneRow' | 'commitDeadCoordinatorBreakerState'
  | 'coordPlacementStamps' | 'countDelegationEventsAtOrBelow' | 'currentAskFor' | 'currentAsksFor' | 'currentEpisode'
  | 'db' | 'deadAnchors' | 'deadCoordinatorBreakerHeldLatest' | 'deadCoordinatorBreakerState' | 'deadCoordinatorJournalRows'
  | 'declineApproval' | 'declineAsk' | 'delegationEventStats' | 'delegationRunStamps' | 'deleteDelegationEventsBetween' | 'deleteGoneSince' | 'deleteRunCloseAnchor' | 'deleteRunCloseWarning'
  | 'deliveredUnacked'
  | 'delivery' | 'digestApprovals' | 'digestAsks' | 'dispatchAbandonSetting' | 'dispatchNode' | 'drainUntold' | 'driftAwaitingReview'
  | 'driftFindingRows' | 'driftFindingsOpenAt' | 'driftHeldQuestions' | 'driftOpenRuns' | 'driftOutstandingDeliveries'
  | 'driftPushesOnDay' | 'driftStallToldRows' | 'dueDeliveries' | 'firstMailIdWithPrefix' | 'foldPrLineage' | 'goneSince'
  | 'hasMailWithSubject' | 'hasNotice' | 'hasOutstandingMail' | 'heldApprovalRowsByChild' | 'heldApprovalsFor'
  | 'heldAskFor' | 'heldQuestionRows' | 'holdParked' | 'importLaneArmMarker' | 'ingestJournal' | 'insertApproval' | 'insertAsk'
  | 'insertDelegationEvents' | 'insertMail' | 'insertObservation' | 'insertStallObservation' | 'intentFor'
  | 'generationsCursor' | 'journalGenerations' | 'landingReadProjects' | 'laneArmSetting' | 'lapseApproval' | 'lapseClaimRow' | 'lastRunBySession' | 'laterReviewClosedFor' | 'laterReviewMovedAt'
  | 'ledgerFloor' | 'ledgerIssued' | 'ledgerProjects' | 'lifecycleBirthEventsFor' | 'lifecycleCreatesFor'
  | 'lifecycleFor' | 'lifecycleGapGens' | 'lifecycleLeafEndsFor' | 'lifecycleReclaimRowsSince' | 'lifecycleStats' | 'linkTeamAuto' | 'linkingAll' | 'liveGenerations'
  | 'mailOrigin' | 'mailQueuedSince' | 'markApprovalOperator' | 'markApprovalOperatorRows' | 'markClaudeBuildAttempt'
  | 'markDeadCoordinatorBreakerDirty' | 'markDelivered' | 'markDriftPushed' | 'markDriftShadowed' | 'markIngested'
  | 'markLanded' | 'markParkEscalated' | 'markReleaseNotified' | 'markUnreachable' | 'maxMailDeliveryId'
  | 'maxRunEventId' | 'mergingRuns' | 'mintGeneration' | 'moveItem' | 'newestClaimedWorkRuns' | 'node' | 'nodeByLabel' | 'nodes' | 'noteClaudeBuildsSeen' | 'noteDispatchRefusal' | 'noteGate'
  | 'noteLeaseDetail' | 'openAllocations' | 'openCloseRefusedItems' | 'openCoordinatorIds' | 'openPracticeCase' | 'openReleaseReviewItems' | 'outstandingMailFor' | 'parkDelivery'
  | 'parkedDeliveries' | 'poolEpoch' | 'practiceCaseNewest' | 'programOpenRunCount' | 'programmeActivity' | 'programmeLeftPlannedAt' | 'programmeLive' | 'projectDelegationCheckpoint'
  | 'projectDelegationCheckpointChanges' | 'pruneApprovalInputs' | 'pruneAskQuestions' | 'queueDelivery' | 'queueRunCloseWarning'
  | 'raiseItemWithMail' | 'raiseLedgerFloor' | 'readLanding' | 'recentProvenance' | 'recordClaudeBuildVerdict' | 'recordDriftPass' | 'recordFeedEvent' | 'recordGap' | 'recordLinkingReading'
  | 'recordObservation' | 'recordRejection' | 'recordRunCloseRefusal' | 'recordRunEvent' | 'recordShadowVerdict' | 'recordStallObservation'
  | 'recordTeamCandidates'
  | 'refusalsFor' | 'refuseRelease' | 'rejectDelivery' | 'rekeyNode' | 'releaseAsk' | 'releaseLease' | 'releaseReviewItemRaised' | 'releases'
  | 'renewClaimRow' | 'requestNode' | 'resolveNode' | 'restampAsk' | 'retireGeneration' | 'reviewChildReleased' | 'reviveParkedDeliveries' | 'rollSettings' | 'run'
  | 'runCloseAnchors' | 'runCloseChoice' | 'runCloseRuns' | 'runCloseWarning' | 'runCloseWarningProgrammes' | 'runEvents' | 'runEventsSince' | 'runLastMoves' | 'runs' | 'runsNamingSession' | 'sealDeadCoordinatorBreakerState'
  | 'setCollectLane' | 'setDeliveryEnvelope' | 'setGenerationDue' | 'setGoneSince' | 'setRunCloseAnchor' | 'setSession' | 'settleAsk' | 'settleNode' | 'staleAllocations'
  | 'staleApproval' | 'staleAsk' | 'stallCandidates' | 'stallMailFor' | 'stallObservationsSince' | 'stallSettings' | 'stalledDispatchRunIds'
  | 'startRunsOnTakenBrief' | 'startsSince' | 'strandedClear' | 'sweepClosesBetween' | 'takeApprovalForRule' | 'takeAskForAnswer' | 'tellRefusal' | 'unlandedBriefs'
  | 'unsealDeadCoordinatorBreakerState' | 'untakeAsk' | 'untoldRows' | 'updateEpoch' | 'upsertNodeMeasurement' | 'wakeParked';

/** D-7579: the watcher's narrow view of the coordination store, the one `Pick` of `CoordStore` the series uses. A
 *  `CoordStore` is assignable to it; it is not assignable back (the store's private members). */
export type WatcherCoordPort = Pick<CoordStore, WatcherCoordMember>;
