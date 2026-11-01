/**
 * D-7578 (plan docs/superpowers/plans/2026-10-30-consolidation-increment7-watcher-store-port.md, Task WP1;
 * increment 7). The series' record of what the store census (`scan/parse.ts#storeReach`) measures for `watch.ts` and
 * its lane files: the members they reach through `Deps.coord`'s whole store, and where they hand the whole store on
 * (each key with its call-site count). The members they reach at all are no longer listed here: since D-7579 (WP2)
 * they are `coord/ports.ts#WatcherCoordMember`, the port's own list. This is the series' record, which each series task
 * rewrites to what the census measures. Before WP10 no row reds on it except under `WATCHER_PORT_STRICT=1` (spec
 * §5.1 rule 3 rev 2: a census reports, and its may-only-shrink pin lands in the commit that reaches the series'
 * target). Each set may only shrink, except that a reached member is added in the series PR that measures it.
 * Measured on `origin/main` 53bc9370c.
 */

/** The members reached through the whole store (162, with #1614's `delegationRunStamps`): on `main` every reach is
 *  whole. Sorted. */
export const WATCHER_WHOLE_REACH: readonly string[] = [
  'absorbParkEscalation', 'activeClaims', 'approvalById', 'approvalsForChild', 'approvalsInState', 'askById',
  'autoContinueHeldUntil', 'backOff', 'baselineParkBox', 'bindingRunsOf', 'bindingsOf', 'bumpReplayCount',
  'cancelDeliveriesTo', 'checksRows', 'childReclaimCoordinatorClaims', 'childReclaimSessionIds', 'childStaleActivity',
  'claimDigestDay', 'closeRun', 'commitDeadCoordinatorBreakerState', 'coordPlacementStamps', 'currentAskFor',
  'currentAsksFor', 'currentEpisode', 'db', 'deadAnchors', 'deadCoordinatorBreakerHeldLatest',
  'deadCoordinatorBreakerState', 'deadCoordinatorJournalRows', 'declineApproval', 'declineAsk',
  'delegationEventStats', 'delegationRunStamps', 'deliveredUnacked', 'delivery', 'digestApprovals', 'digestAsks',
  'dispatchAbandonSetting', 'dispatchNode', 'driftAwaitingReview', 'driftFindingRows', 'driftFindingsOpenAt',
  'driftHeldQuestions', 'driftOpenRuns', 'driftOutstandingDeliveries', 'driftPushesOnDay', 'driftStallToldRows',
  'dueDeliveries', 'firstMailIdWithPrefix', 'foldPrLineage', 'hasMailWithSubject', 'hasNotice', 'hasOutstandingMail',
  'heldApprovalRowsByChild', 'heldApprovalsFor', 'heldAskFor', 'heldQuestionRows', 'holdParked', 'ingestJournal',
  'insertApproval', 'insertAsk', 'insertDelegationEvents', 'insertMail', 'insertObservation',
  'insertStallObservation', 'intentFor', 'journalGenerations', 'lapseApproval', 'lapseClaimRow', 'lastRunBySession',
  'laterReviewClosedFor', 'ledgerFloor', 'ledgerIssued', 'ledgerProjects', 'lifecycleBirthEventsFor',
  'lifecycleGapGens', 'lifecycleLeafEndsFor', 'lifecycleReclaimRowsSince', 'lifecycleStats', 'mailOrigin',
  'mailQueuedSince', 'markApprovalOperator', 'markApprovalOperatorRows', 'markDeadCoordinatorBreakerDirty',
  'markDelivered', 'markDriftPushed', 'markDriftShadowed', 'markIngested', 'markLanded', 'markParkEscalated',
  'markReleaseNotified', 'markUnreachable', 'maxMailDeliveryId', 'maxRunEventId', 'mergingRuns', 'node',
  'nodeByLabel', 'nodes', 'noteDispatchRefusal', 'noteGate', 'noteLeaseDetail', 'openAllocations',
  'openCoordinatorIds', 'outstandingMailFor', 'parkDelivery', 'parkedDeliveries', 'poolEpoch', 'programOpenRunCount',
  'projectDelegationCheckpoint', 'projectDelegationCheckpointChanges', 'pruneApprovalInputs', 'pruneAskQuestions',
  'queueDelivery', 'raiseLedgerFloor', 'recentProvenance', 'recordDriftPass', 'recordFeedEvent', 'recordGap',
  'recordObservation', 'recordRejection', 'recordRunEvent', 'recordShadowVerdict', 'recordStallObservation',
  'refusalsFor', 'refuseRelease', 'rejectDelivery', 'rekeyNode', 'releaseAsk', 'releaseLease', 'releases',
  'renewClaimRow', 'resolveNode', 'restampAsk', 'retireGeneration', 'rollSettings', 'run', 'runEvents',
  'runEventsSince', 'runLastMoves', 'runs', 'runsNamingSession', 'sealDeadCoordinatorBreakerState',
  'setDeliveryEnvelope', 'setSession', 'settleAsk', 'settleNode', 'staleAllocations', 'staleApproval', 'staleAsk',
  'stallCandidates', 'stallMailFor', 'stallSettings', 'stalledDispatchRunIds', 'strandedClear', 'takeApprovalForRule',
  'takeAskForAnswer', 'unlandedBriefs', 'unsealDeadCoordinatorBreakerState', 'untakeAsk', 'updateEpoch',
  'upsertNodeMeasurement', 'wakeParked',
];

/** Each whole hand-off key (38) with its call-site count (42 in all), sorted by key. */
export const WATCHER_WHOLE_HANDOFFS: Readonly<Record<string, number>> = {
  'tmpSweepLane.ts#mailOnce -> coord/rundefsTx.ts#queueSystemMail': 1,
  'watch.ts#FleetWatcher.applyStall -> coord/rundefsTx.ts#queueStallNotice': 3,
  'watch.ts#FleetWatcher.applyStallSession -> coord/rundefsTx.ts#queueStallNotice': 2,
  'watch.ts#FleetWatcher.archivedExpiryPass -> coord/expireArchived.ts#expireArchived': 1,
  'watch.ts#FleetWatcher.archivedExpiryPass -> coord/expireArchived.ts#recordExpireFeed': 1,
  'watch.ts#FleetWatcher.archivedExpiryStoreRead -> coord/expireArchived.ts#childEverCoordinated': 1,
  'watch.ts#FleetWatcher.checksDeliver -> coord/rundefsTx.ts#queueLandingNotice': 1,
  'watch.ts#FleetWatcher.checksEnd -> coord/rundefsTx.ts#queueLandingNotice': 1,
  'watch.ts#FleetWatcher.childReclaimPass -> coord/childReclaim.ts#recordChildReclaimKeptFeed': 1,
  'watch.ts#FleetWatcher.childReclaimPass -> coord/childReclaim.ts#recordChildReclaimKeptReason': 1,
  'watch.ts#FleetWatcher.childReclaimPass -> coord/childReclaim.ts#recordChildReclaimLeafKeptFeed': 1,
  'watch.ts#FleetWatcher.childReclaimPass -> coord/childReclaimDisabled.ts#childReclaimDisabledStops': 1,
  'watch.ts#FleetWatcher.childReclaimPass -> coord/siblingRead.ts#childSiblingsFromListing': 1,
  'watch.ts#FleetWatcher.constructor -> coord/questions.ts#createQuestions': 1,
  'watch.ts#FleetWatcher.deadCoordinatorAct -> coord/endDeadCoordinator.ts#endDeadCoordinator': 1,
  'watch.ts#FleetWatcher.deadCoordinatorAct -> coord/endDeadCoordinator.ts#readDeadCoordinatorJournalTrust': 1,
  'watch.ts#FleetWatcher.deadCoordinatorAct -> coord/endDeadCoordinator.ts#recordDeadCoordinatorFeed': 2,
  'watch.ts#FleetWatcher.deadCoordinatorAct -> coord/endDeadCoordinator.ts#recordDeadCoordinatorThrew': 1,
  'watch.ts#FleetWatcher.deadCoordinatorAct -> coord/endDeadCoordinator.ts#rereadDeadCoordinatorJournalTrust': 1,
  'watch.ts#FleetWatcher.deadCoordinatorAct -> coord/routes.ts#CoordRoutesHandle.withSweepAbandon': 1,
  'watch.ts#FleetWatcher.deadCoordinatorPass -> coord/endDeadCoordinator.ts#readDeadCoordinatorJournalTrust': 1,
  'watch.ts#FleetWatcher.deadCoordinatorPass -> coord/endDeadCoordinator.ts#recordDeadCoordinatorBreaker': 1,
  'watch.ts#FleetWatcher.deadCoordinatorPass -> coord/reclaim.ts#measureClaimant': 1,
  'watch.ts#FleetWatcher.deadDispatchStep -> coord/abandonDeadDispatch.ts#abandonDeadDispatches': 1,
  'watch.ts#FleetWatcher.digestBeat -> coord/digest.ts#buildDigest': 1,
  'watch.ts#FleetWatcher.execChildReclaim -> coord/childReclaim.ts#reclaimChild': 1,
  'watch.ts#FleetWatcher.execChildReclaimRelease -> coord/childReclaim.ts#releaseRetiredChildHold': 1,
  'watch.ts#FleetWatcher.judgeStall -> coord/reclaim.ts#measureClaimant': 1,
  'watch.ts#FleetWatcher.mirrorFor -> coord/mirror.ts#JournalMirror': 1,
  'watch.ts#FleetWatcher.noteDeadCoordinatorSeed -> coord/endDeadCoordinator.ts#recordDeadCoordinatorBreakerSeed': 1,
  'watch.ts#FleetWatcher.orphanBeat -> orphanTreeBeat.ts#OrphanTreeBeat': 1,
  'watch.ts#FleetWatcher.recordChildShadow -> coord/expireArchived.ts#recordExpireFeed': 1,
  'watch.ts#FleetWatcher.staleArchive -> staleArchiveBeat.ts#StaleArchiveBeat': 1,
  'watch.ts#FleetWatcher.sweepBriefs -> coord/rundefsTx.ts#queueStallNotice': 1,
  'watch.ts#FleetWatcher.sweepDrift -> coord/reclaim.ts#measureClaimant': 1,
  'watch.ts#FleetWatcher.sweepLanding -> coord/rundefsTx.ts#queueSystemMail': 1,
  'watch.ts#FleetWatcher.tellParkedSender -> coord/rundefsTx.ts#queueSystemMail': 1,
  'watch.ts#FleetWatcher.tick -> fleet.ts#assembleFleet': 1,
};
