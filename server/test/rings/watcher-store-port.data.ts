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

/** The members reached through the whole store (69, with #1614's `delegationRunStamps` and #2038's `requestNode`; 166
 *  before D-7580, WP3, whose lanes' units read 11 through the port; 155 before D-7581, WP4, whose mail helpers and mail,
 *  landing-checks and tmp-sweep units take the port; 132 before D-7582, WP5, whose stall lane takes the port; 129
 *  before D-7583, WP6, whose child-reclaim chain and lane take the port; 123 before D-7584, WP7, whose archive
 *  chain, beats and lane take the port; and 122 before D-7585, WP8, whose close path, dead-coordinator, dead-dispatch
 *  and mirror chains and lane take the port; and 101 before D-7586, WP9, whose questions chain takes the port, 76
 *  before its fleet-assembly chain did, 73 before its digest chain did and 70 before its digest beat did). The
 *  69 are the members read on `this.deps.coord`'s whole value in `watch.ts`, directly or into a narrow slot, which
 *  WP10's flip of `Deps` to `WatcherDeps` takes to the port. Sorted. */
export const WATCHER_WHOLE_REACH: readonly string[] = [
  'activeClaims', 'bindingRunsOf', 'bindingsOf', 'checksRows', 'childReclaimCoordinatorClaims', 'currentEpisode',
  'delegationEventStats', 'delegationRunStamps', 'dispatchNode', 'driftAwaitingReview', 'driftFindingRows',
  'driftHeldQuestions', 'driftOpenRuns', 'driftOutstandingDeliveries', 'driftPushesOnDay', 'driftStallToldRows',
  'firstMailIdWithPrefix', 'hasMailWithSubject', 'hasNotice', 'insertDelegationEvents', 'intentFor', 'lapseClaimRow',
  'lastRunBySession', 'ledgerFloor', 'ledgerIssued', 'ledgerProjects', 'lifecycleBirthEventsFor', 'mailQueuedSince',
  'markDriftPushed', 'markDriftShadowed', 'markLanded', 'markReleaseNotified', 'markUnreachable', 'maxMailDeliveryId',
  'maxRunEventId', 'mergingRuns', 'node', 'nodeByLabel', 'nodes', 'noteDispatchRefusal', 'noteLeaseDetail',
  'openAllocations', 'outstandingMailFor', 'poolEpoch', 'projectDelegationCheckpoint',
  'projectDelegationCheckpointChanges', 'raiseLedgerFloor', 'recentProvenance', 'recordDriftPass', 'recordFeedEvent',
  'refusalsFor', 'refuseRelease', 'rekeyNode', 'releaseLease', 'releases', 'renewClaimRow', 'requestNode',
  'resolveNode', 'rollSettings', 'run', 'runEventsSince', 'runLastMoves', 'runs', 'sealDeadCoordinatorBreakerState',
  'settleNode', 'staleAllocations', 'stallSettings', 'updateEpoch', 'upsertNodeMeasurement',
];

/** Each whole hand-off key with its call-site count, sorted by key: none since D-7586 (WP9), whose questions,
 *  fleet-assembly and digest chains take the port. */
export const WATCHER_WHOLE_HANDOFFS: Readonly<Record<string, number>> = {};
