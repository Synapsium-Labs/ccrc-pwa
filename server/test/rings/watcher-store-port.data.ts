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

/** The members reached through the whole store (132, with #1614's `delegationRunStamps` and #2038's `requestNode`; 166 before D-7580, WP3,
 *  whose lanes' units read 11 through the port, and 155 before D-7581, WP4, whose mail helpers and mail, landing-checks and tmp-sweep units take the port). Sorted. */
export const WATCHER_WHOLE_REACH: readonly string[] = [
  'activeClaims', 'approvalById', 'approvalsForChild', 'approvalsInState', 'askById', 'bindingRunsOf', 'bindingsOf',
  'cancelDeliveriesTo', 'checksRows', 'childReclaimCoordinatorClaims', 'childReclaimSessionIds', 'childStaleActivity',
  'claimDigestDay', 'closeRun', 'coordPlacementStamps', 'currentAskFor', 'currentAsksFor', 'currentEpisode',
  'deadAnchors', 'deadCoordinatorBreakerHeldLatest', 'deadCoordinatorBreakerState', 'deadCoordinatorJournalRows',
  'declineApproval', 'declineAsk', 'delegationEventStats', 'delegationRunStamps', 'digestApprovals', 'digestAsks',
  'dispatchAbandonSetting', 'dispatchNode', 'driftAwaitingReview', 'driftFindingRows', 'driftFindingsOpenAt',
  'driftHeldQuestions', 'driftOpenRuns', 'driftOutstandingDeliveries', 'driftPushesOnDay', 'driftStallToldRows',
  'firstMailIdWithPrefix', 'foldPrLineage', 'hasMailWithSubject', 'hasNotice', 'heldApprovalRowsByChild',
  'heldApprovalsFor', 'heldAskFor', 'heldQuestionRows', 'ingestJournal', 'insertApproval', 'insertAsk',
  'insertDelegationEvents', 'intentFor', 'journalGenerations', 'lapseApproval', 'lapseClaimRow', 'lastRunBySession',
  'laterReviewClosedFor', 'ledgerFloor', 'ledgerIssued', 'ledgerProjects', 'lifecycleBirthEventsFor',
  'lifecycleGapGens', 'lifecycleLeafEndsFor', 'lifecycleReclaimRowsSince', 'lifecycleStats', 'mailQueuedSince',
  'markApprovalOperator', 'markApprovalOperatorRows', 'markDriftPushed', 'markDriftShadowed', 'markLanded',
  'markReleaseNotified', 'markUnreachable', 'maxMailDeliveryId', 'maxRunEventId', 'mergingRuns', 'node',
  'nodeByLabel', 'nodes', 'noteDispatchRefusal', 'noteLeaseDetail', 'openAllocations', 'openCoordinatorIds',
  'outstandingMailFor', 'poolEpoch', 'programOpenRunCount', 'projectDelegationCheckpoint',
  'projectDelegationCheckpointChanges', 'pruneApprovalInputs', 'pruneAskQuestions', 'raiseLedgerFloor',
  'recentProvenance', 'recordDriftPass', 'recordFeedEvent', 'recordGap', 'recordRejection', 'recordRunEvent',
  'recordShadowVerdict', 'recordStallObservation', 'refusalsFor', 'refuseRelease', 'rekeyNode', 'releaseAsk',
  'releaseLease', 'releases', 'renewClaimRow', 'requestNode', 'resolveNode', 'restampAsk', 'retireGeneration',
  'rollSettings', 'run',
  'runEvents', 'runEventsSince', 'runLastMoves', 'runs', 'runsNamingSession', 'sealDeadCoordinatorBreakerState',
  'setSession', 'settleAsk', 'settleNode', 'staleAllocations', 'staleApproval', 'staleAsk', 'stallCandidates',
  'stallMailFor', 'stallSettings', 'stalledDispatchRunIds', 'takeApprovalForRule', 'takeAskForAnswer', 'untakeAsk',
  'updateEpoch', 'upsertNodeMeasurement',
];

/** Each whole hand-off key (30) with its call-site count (31 in all), sorted by key. */
export const WATCHER_WHOLE_HANDOFFS: Readonly<Record<string, number>> = {
  'watch.ts#FleetWatcher.archivedExpiryPass -> coord/expireArchived.ts#expireArchived': 1,
  'watch.ts#FleetWatcher.archivedExpiryPass -> coord/expireArchived.ts#recordExpireFeed': 1,
  'watch.ts#FleetWatcher.archivedExpiryStoreRead -> coord/expireArchived.ts#childEverCoordinated': 1,
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
  'watch.ts#FleetWatcher.sweepDrift -> coord/reclaim.ts#measureClaimant': 1,
  'watch.ts#FleetWatcher.tick -> fleet.ts#assembleFleet': 1,
};
