import { performance } from 'node:perf_hooks';
import type { Deps } from './server.js';
import type { Bus } from './bus.js';
import { assembleFleet, lifecycleInputFor, registrySecondsToMs } from './fleet.js';
import { answeredByBody, askPushBody, withCoordinatorBody } from './askbody.js';
import { measuredIdentity, readRegistry, readRegistryMeasured, readSessionRecord } from './registry.js';
import {
  accountPoolsEnforcement, poolsEnforcement, poolsWire, readObservedEpochFromRegistry, readPoolEpoch,
  readProjectPools,
} from './pools.js';
import { hasMenu, parseDialog } from './pane/dialog.js';
import { parseStatusline, type Statusline } from './pane/statusline.js';
import { defaultCachePath, loadSnapshot, saveSnapshot } from './fleetstate.js';
import { readTasks, taskProgress } from './tasks/read.js';
import { CCD_ARGV, EXPIRE_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP, capSupported, verbSupported, sweepDec } from './ccdargv.js';
import {
  isFullLine, parsePrLines, phaseFor, queueFor, repoCellFor, type CcdPrFailure, type PrQueueRead,
} from './prstate.js';
import { readLiveState, readLiveStateMeasured } from './livestate.js';
import { mailTurnIdle, mailTurnModeOf, mailTurnReadsMark, type MailTurnMode } from './turnidle.js';
import { readTurnMarkMeasured } from './turnmark.js';
import { finishedAfter } from './coord/finished.js';
import { readHookState, readHookStateRawMeasured, type HookState, type HookStateRawRead } from './hookstate.js';
import { readUsageMeasured, USAGE_FRESH_S } from './usage.js';
import { sendPrompt } from './inject/send.js';
import {
  decideIdleCompactNudge, idleNudgeDisabled, idleNudgeFeedBody, idleNudgeRefusedBody, idleNudgeRowHold, readCompactionTail,
  type CompactionTail, type IdleNudgeRowFacts,
} from './idlenudge.js';
import { askActions, askKey } from './askkey.js';
// The ask lane's two WINDOWS moved out of this file (whole-branch review
// F2(b)): `fleet.ts`'s chip is their second reader and cannot import this
// module — `watch.ts` imports `assembleFleet` from it — so they now live
// where both may read them. `ASK_SWEEP_MS` below is unaffected: it is this
// lane's poll cadence, not a window, and this file is still its only reader.
import { ASK_ANSWERING_MAX_MS, ASK_SETTLE_TICKS, askNotifyAt } from './askwindow.js';
import { UNTRUSTED_CAP_BYTES, untrustedBlock } from './coord/untrusted.js';
import type { SessionRecord } from './registry.js';
import type {
  ChildMark, ChildReclaimAttention, ChildReclaimGeneration, ChildReclaimKeptWord, CoordStatus, DeadCoordinatorAttention, Dialog, ExpiryAttention, FleetSession, HookAsk, HookAskQuestion,
  LifecycleHealth, MailGate, MirroredLifecycleEvent, NotifyEvent, ProjectPoolsWire, ProjectRepoWire, PrState, RunSummary,
  SessionStatus, SessionUsage, TaskProgress,
} from '../../shared/api.js';
import type { DelegationEventEnvelopeV1, DelegationHealthInput, DelegationObservationHealth } from '../../shared/api.js';
// ONE LINE, deliberately: `single-definition.test.ts` scans for `UNCHECKED_PR`
// arriving from shared/api on a single import line, and a prettier multi-line
// form is invisible to it.
import { FLEET_SCOPE, IDLE_COMPACT_NUDGE_PROMPT, LEDGER_STALE_MS, SERVER_CAPS, MAIL_MAX_ATTEMPTS, MAIL_REPLAY_MS, STALL_FOLLOW_LABEL, STALL_LEVEL_TEXT, TERMINAL_DELIVERY_STATES, UNCHECKED_PR, lifecycleIsDead, sessionLifecycle } from '../../shared/api.js';
import { JournalMirror } from './coord/mirror.js';
// The pause marker's ONE definition in the tree. `MAIL_DISABLED_MARKER` is
// NOT imported beside it: this file holds its own module-local literal
// (`sweepMail` already uses it), a second `const` of that name in one scope is
// a redeclaration (TS2451), and `rundefs.ts` explains on purpose why the two
// literals exist. `single-definition.test.ts` pins both halves of that split.
import {
  COORDINATOR_PAUSE_MARKER, MAIL_ROLE_IDS, RECLAIM_PAUSE_MARKER, askNudgeSubject, isAskNudgeMail,
  queueStallNotice, queueSystemMail, survivorOf,
} from './coord/rundefs.js';
import { landingAsk, landingVerdict, type LandingFacts } from './coord/landing.js';
import {
  readParentGenerations, readWorktreeCensus, settleParentIncarnations, type DelegationCensusPass, type WorktreeCensus,
} from './coord/gitref.js';
import { ccdIdForWorktree, divergences, unclaimedWorktrees, type DivergenceInput } from './divergence.js';
// The delegation lane's (wave 3, Task 13) imports, in one block of their own: the pure modules it composes, and the durable applier.
import { randomUUID } from 'node:crypto';
import type { MeasuredDirectoryRead } from './io.js';
import { DelegationDurability, type DelegationDurableBatch } from './coord/delegation-checkpoint.js';
import {
  DelegationIngestError, delegationBucketDurabilityOf, delegationBucketUtcHour, ingestAndApplyDelegationBucket, readDelegationBucket,
  unreadableDelegationBucketResult, type DelegationBucketDurability, type DelegationBucketResult,
} from './coord/delegation-ingest.js';
import { correlateDelegation, type DelegationCorrelationInput, type DelegationListingWindow } from './coord/delegation-correlation.js';
import { DELEGATION_EVIDENCE_MARGIN_MS, delegationLostEvidenceForced, delegationMarkAttributionOf } from './coord/delegation-correlation.js';
import { DELEGATION_CLOCK_SKEW_MS } from './coord/delegation-correlation.js';
import {
  DELEGATION_DROPPED_UNMEASURED, delegationDroppedKeyId, delegationDroppedKeyOf, delegationGoneTrees, delegationTreeKey, indexDelegationDropped,
  planDelegationDroppedPrune, type DelegationDroppedEvidence, type DelegationDroppedKey, type DelegationPruneProject,
} from './coord/delegation-correlation.js';
import {
  delegationHashSetAdd, delegationHashSetHas, delegationMarkForced, emptyDelegationHashSet, type DelegationHashSet, type DelegationMarkKind,
  DELEGATION_ROOT_UNMEASURED, delegationUnknownWindowForced, type DelegationProjectsRoot,
} from './coord/delegation-correlation.js';
import type { WorktreeRead } from './coord/gitref.js';
import type { DelegationCensusDiagnostic } from './coord/gitref.js';
import { delegationCircuitBreaker, planDelegationReconciliation, type DelegationReportEffect } from './coord/delegation-policy.js';
import { isUnownedWorkReason } from './coord/delegation-policy.js';
import { delegationBucketHourMs, delegationBucketReadable, planDelegationCursorRetention } from './coord/delegation-model.js';
import { DELEGATION_HOUR_NO_CAPABILITY, DELEGATION_HOUR_NO_SPOOL, isDelegationHourCarveOut } from './coord/delegation-model.js';
import {
  DELEGATION_HOUR_CLOSE_MARGIN_MS, DELEGATION_HOUR_MS, DELEGATION_HOUR_NEVER_CLOSED, DELEGATION_INTERVAL_RETENTION_HOURS, DELEGATION_UNMEASURED_INCARNATION,
  DelegationModelError,
  canonicalDelegationJson, delegationCapabilityState, delegationHealthInputOf, delegationObservationHealthOf, formatDelegationInstant,
  parseDelegationInstant, upkeepDelegationIntervals,
  type DeepReadonly, type DelegationAttemptRow, type DelegationBucketCursor, type DelegationCensusRecord, type DelegationCheckpointV1,
  type DelegationObservationInterval, type DelegationRecoveryState,
} from './coord/delegation-model.js';
import { claimExpiry, type LivenessProbe } from './coord/claims.js';
import { claimantMeasuredDead, measureClaimant } from './coord/reclaim.js';
import {
  BACKLOG_HORIZON_MS, STALL_CHECK_PREFIX, STALL_QUIET_MS, STALL_REPLY_PREFIX, parseStallDetail, stallArmingOf,
  stallCheckMail, stallCitedCheck, stallCoordinatorSubjects, stallDeadShaped, stallDetail, stallFacts,
  stallFailedVerdict, stallLastCheck, stallMailClass, stallMailStuckVerdicts, stallMarkUnreadable,
  stallNotifyDelivery, stallOrphanDCandidate, stallOrphanDVerdict, stallOrphanEVerdict, stallPushRoute, stallPushText, stallReportKind, stallReportMail, stallReportTitle,
  stallRunMail, stallSessionMail, stallNewestDelivery, stallSessionMarkerVerdict, stallSessionPushText, stallSubjects,
  stallReactivation, stallVerdict, stallW2ReportMail, turnMarkStale,
  type AskRowFact, type HookAskFact, type HookRawFact, type LiveWordRead, type StallArming,
  type StallInput, type StallNotice, type StallNotify, type StallRunRow, type StallSessionInput, type StallSubject,
  type StallVerdict, type StallWorker, type TurnMarkRead,
} from './coord/stall.js';
import {
  parseStallSettings, resolveStallWatch, stallBoxArmingOf, stallBusyClock,
  type StallBoxArming, type StallResolved, type StallSettingsParsed, type StallSettingsRead,
} from './coord/stallsettings.js';
// `floorFromScan` owns the seed arithmetic (max + LEDGER_SEED_GAP) and the
// evidence string alike — the sweep below only feeds it files and applies
// its answer, so LEDGER_SEED_GAP itself is not imported here.
import { definitionsIn, floorFromScan, unallocatedDefinitions } from './coord/ledger.js';
import { LEDGER_FLOOR_DIRS, SWEEP_POLICY, readLedgerDocs } from './coord/ledgerseed.js';
import type { ProvenancePair } from './coord/store.js';
import type { PushPayload } from './push.js';
import { deriveBranch } from './naming.js';
import { TranscriptResolver } from './transcript/resolve.js';
import { readAiTitle } from './transcript/title.js';
import {
  MAIL_REPLAY_CEILING_ERROR, toRunSummary, type AskRow, type CoordStore, type MarkReleaseNotifiedResult,
  type OpenSibling, type RunRow,
} from './coord/store.js';
import { renderMailNudge } from './coord/envelope.js';
import { configDirFor } from './config.js';
import { refusalSentence } from './wsaudit.js';
import {
  childMarkLeftListing, childReclaimBornAt, childReclaimGeneration, childReclaimGenerationRead, childReclaimLatest, childReclaimRowUuid,
  childReclaimSweepOutcomeOf, childReclaimTokenKind, isChildReclaimStuckToken, reclaimChild,
  recordChildReclaimKeptFeed, recordChildReclaimLeafKeptFeed, releaseRetiredChildHold, type ChildReclaimOutcome, type ChildReclaimReleaseOutcome,
  type ChildReclaimReleaseRequest, type ChildReclaimRequest,
} from './coord/childReclaim.js';
import {
  childReclaimAskOrder, childReclaimAttention, childReclaimAttentionWithKept, childReclaimDeferExpired, childReclaimDue,
  childReclaimFeedQuiet, childReclaimFirstSighting, childReclaimHoldRead, childReclaimJournalRow, childReclaimKeptItems,
  childReclaimHoldRetiredStep, childReclaimNextEntry, childReclaimSameGeneration, isChildReclaimGenerationKey,
  childReclaimSweepVerdict, childReclaimTerminalRefusal, type ChildReclaimAsk, type ChildReclaimCoordinatorClaim,
  childReclaimKeptVerdicts, type ChildReclaimHoldCandidate,
  type ChildReclaimHoldCandidatesRead, type ChildReclaimHoldOpenRead, type ChildReclaimHoldRead,
  type ChildReclaimGenerationIdentity, type ChildReclaimJournalAttention, type ChildReclaimJournalRow,
  type ChildReclaimKeptAttention,
  type ChildReclaimLaneNow, type ChildReclaimMintingRunRead,
  type ChildReclaimReviewedRunRead, type ChildReclaimSiblingsRead, type ChildReclaimSweepEntry,
  type ChildReclaimSweepOutcome, type ChildReclaimSweepSkip, type ChildReclaimSweepVerdict,
  childReclaimAttentionWithLeaves, childReclaimLeafKept, childReclaimLeafKeptSince, type ChildReclaimLeafKept,
  CHILD_RECLAIM_SWEEP_REJECTED, childReclaimTierSeed,
} from './childReclaimSweep.js';
import { CHILD_BIRTH_SKEW_MS } from './coord/childSpent.js';
import {
  EXPIRE_AUDITS_PER_PASS, archivedExpiryDue, archivedExpiryEntryFor, archivedExpiryLearned, archivedExpiryNextEntry,
  archivedExpiryOutcomeKey, archivedExpirySighted, archivedExpiryVerdict, expiryAttention, expiryReportStands,
  type ArchivedExpiryEntry, type ExpiryStoreRead,
} from './archivedExpiry.js';
import { expireArchived, expiryReviewing, learnExpiry, recordExpireFeed } from './coord/expireArchived.js';
import {
  deadAnchorNext, deadCoordinatorNewEpisode, deadCoordinatorAttention, deadCoordinatorBreaker,
  deadCoordinatorBreakerHeldKey, deadCoordinatorBreakerKey, deadCoordinatorCrash, deadCoordinatorDue, deadCoordinatorEntry, deadCoordinatorJournal, deadCoordinatorJournalSpawnedAt,
  deadCoordinatorNextEntry, deadCoordinatorOutcomeKey, deadCoordinatorSighted, deadCoordinatorSince, deadCoordinatorThrew,
  type ClaimantDeadCause, type DeadAnchor, type DeadCoordinatorActOutcome, type DeadCoordinatorBreaker,
  type DeadCoordinatorBreakerMember, type DeadCoordinatorEntry, type DeadCoordinatorJournal, type DeadCoordinatorJournalTrust,
  type DeadCoordinatorSealResult, type DeadCoordinatorSeedCause,
} from './deadCoordinator.js';
import {
  DeadCoordinatorActThrew, deadCoordinatorLaneArmed, endDeadCoordinator, readDeadCoordinatorJournalTrust, recordDeadCoordinatorBreaker, recordDeadCoordinatorBreakerSeed,
  recordDeadCoordinatorFeed, recordDeadCoordinatorThrew, rereadDeadCoordinatorJournalTrust,
} from './coord/endDeadCoordinator.js';
import type { CoordRoutesHandle } from './coord/routes.js';
import { localIO } from './io.js';
import { measureFleetReadiness, type FleetReadiness } from './readiness.js';
import { FLEET_LABEL, SERVER_LABEL, sweepInventory, type InventoryDeps, type SweepOutcome } from './update/inventory.js';
import { SERVER_CAPS_WRITE_MS, writeServerCaps, type WriteServerCapsResult } from './update/serverCaps.js';
import { resolveAndProject, type ProjectionOutcome } from './update/project.js';
import { runDispatch, type DispatchRunResult } from './update/converge.js';
import type { MoveFeedRecord } from './update/dispatch.js';
import { releasePushCopy, releaseToNotify, type ReleaseNotification } from './update/notify.js';
import { remoteSides, statedOf, summaryFromSides, versionSides } from '../../shared/update-summary.js';
import { CATALOGUE_POLL_INTERVAL_MS } from './update/catalogue.js';
// THE TEMP-ROOT COLLECTOR'S LANE (child reclamation wave 9, spec §5.10). A block of its own, so no import line above
// changes: `ccdargv.js` and `childReclaimSweep.js` are imported a second time here, by name.
import { COLLECT_CAP } from './ccdargv.js';
import type { ChildReclaimCollectInput } from './childReclaimSweep.js';
import { NO_FLEET_IDENTITY } from './fleetidentity.js';
import { stopDonePass, type StopDoneMemory } from './stopDoneSweep.js';
import { STOP_DONE_SWEEP_MS } from './stopDone.js';
import { liveRowFor, liveWordFor, turnMarkFor, turnReadDeps, turnVerdictFor } from './turnverdict.js';
import {
  COLLECT_AUDITS_PER_PASS, COLLECT_FEED_TITLE, collectAfterAct, collectAfterAudit, collectAfterFoldFailed, collectAfterHold,
  collectAfterPresence, collectAfterWouldCollect, collectAttentionItems, collectAttentionViews, collectBoxAfterPopulation,
  collectBoxProbesAtArrival, collectCandidateOf, collectClearPair, collectFeedAnswerBody, collectFeedCollectedBody,
  collectFeedCueOfAct, collectFeedCueOfAudit, collectFeedReadBody, collectFeedStep, collectLaneLive, collectSwitchFeedBody,
  collectFeedWouldCollectBody, COLLECT_SETTING_FEED_TITLE,
  collectFirstSighting, collectForgets, collectForgottenActRow, collectFresh, collectJobEffects, collectOffers,
  collectPassClass, collectPopulation, collectWouldCollectKey, type CollectAudit, type CollectEntry, type CollectFeedCue,
  type CollectPassClass, type CollectPopulation, type CollectResult, type CollectStep, type CollectUnsettledKind,
  collectLaneCounts, type CollectLaneCounts, type CollectLaneSettled, type CollectLatchOutcome,
} from './collectLane.js';
import {
  collectSwitches, collectTempRoot, learnCollect, readCollectPopulation,
  type CollectClock, type CollectControlDeps, type CollectGenerations, type CollectJobOutcome, type CollectLanePort,
  collectRetireLatch,
} from './coord/collectTempRoot.js';

const SGR = /\x1b\[[0-9;]*m/g; // same idiom as inject/send.ts:80 — see detectDialogs's own comment

/** Task sweeps read every task file of every session, so they run on their own
 *  slower clock than the 2 s pane poll — a plan advances on the scale of
 *  minutes, and the fleet chip is a glance, not a readout. The open session's
 *  own stream reads its list every tick, so the screen you're looking at stays
 *  live regardless. */
const TASK_SWEEP_MS = 10_000;

/** The usage sidecar lane's own clock (routing slice 0) — same shape as
 *  `TASK_SWEEP_MS`: a sidecar is fresh for `USAGE_FRESH_S` (30 minutes), so
 *  re-reading it every 2 s tick would buy nothing for the cost of one agent
 *  round trip per session in remote mode. */
const USAGE_SWEEP_MS = 60_000;

/** The sixth lane (the fifth is hook-state sweeping, which rides the 2 s tick).
 *  Naming does NOT ride that tick: a title that appears ten seconds late costs
 *  nothing, and reading transcripts thirty times a minute to learn nothing costs
 *  real work. `claimTitleRead`'s own docstring has the arithmetic for the nine
 *  transcripts on this box that carry no `ai-title` at all, re-read forever at
 *  THIS lane's real 10 s cadence: roughly 7.7 MB/min across the agent WS. The
 *  2 s tick is five times faster, so riding it would cost five times that on
 *  those same nine transcripts to learn nothing — roughly 38.5 MB/min. */
const NAME_SWEEP_MS = 10_000;

/** The census lane. A disagreement between sources is a HUMAN-timescale event —
 *  a rename, a hand-made worktree, a run left open — and each sweep reads
 *  `<projectsRoot>/<project>/.git/worktrees/` per project. Six times slower than
 *  the name sweep, deliberately: this one touches the filesystem per PROJECT,
 *  not per pane. */
const DIVERGENCE_SWEEP_MS = 60_000;

/** The child-reclaim lane (child-reclamation wave 4, spec §5.7). The
 *  census's cadence, for the census's reason — a child's eligibility moves on
 *  human timescales (a run closes, a re-dispatch binds) — and the
 *  TWICE-OBSERVED rule is measured in these intervals: a child must read
 *  eligible on two passes at least this far apart before anything is
 *  composed. It is also the base of the failure backoff (spec §5.9: "retries
 *  back off in between"). EXPORTED so its suite advances by the real
 *  constant. */
export const CHILD_RECLAIM_SWEEP_MS = 60_000;

/** The temp-root collector's observation interval (spec §5.10): the lane spends a token only when its executor's own
 *  audit ARRIVED at least this long after an earlier audit of the id answered that same token, on this process's
 *  monotonic clock. The child lane's cadence, for that lane's reason, and DERIVED from it, never a second literal; L1
 *  takes it as an argument (it imports no L4 constant). EXPORTED for its suite. */
export const COLLECT_OBSERVE_INTERVAL_MS = CHILD_RECLAIM_SWEEP_MS;

/** At most this many lane-asked reclaims outstanding at once. Close-path
 *  reclaims are not counted, and neither is a hold-release job: the bound is
 *  the LANE's own concurrency, not the fleet's — one destructive verb from
 *  this automatic trigger (spec §5.7, "On the sweep": no human is in this
 *  path) in flight at a time keeps a bad pass from asking the box for ten
 *  deletions before the first one has even answered. */
export const CHILD_RECLAIM_MAX_IN_FLIGHT = 1;

/** A lane-asked reclaim that has not settled after this long stops counting
 *  against `CHILD_RECLAIM_MAX_IN_FLIGHT` — twice `ws-reclaim`'s own remote
 *  budget (`ws-reap`'s four minutes, the same budget wave 3's executor
 *  composes its argv under), so a genuinely slow but live attempt gets a full
 *  budget's grace before the lane treats it as stuck. It STAYS in flight —
 *  nothing here cancels or forgets it — and is
 *  logged once, not once a pass, so a fleet host that never answers does not
 *  fill the log forever. The temp-root collector (spec §5.10) spends the same constant three times: its act is not
 *  offered until this long after the lane's start, a settled act job that may have acted keeps the act slot this long,
 *  and an act job still unsettled this long after it took the slot is listed; `collect-lane-pass.test.ts` pins it at
 *  or above twice `ws-collect`'s remote runner row. */
export const CHILD_RECLAIM_STALL_MS = 480_000;

/** How long a collector AUDIT (`ws-audit --collect`, a learning audit or the executor's own) may stay unsettled before
 *  the lane lists it (spec §5.10): twice `ws-audit`'s remote runner row, 90 s (`remote/runner.ts`, whose table is not
 *  exported, so the suite reads the row and pins this against it). Local mode's runner has no timeout, so a call can
 *  hang for ever; the id is never asked again until it settles. An act JOB's bound, whatever it has out (its act, its
 *  own audit, or nothing yet), is `CHILD_RECLAIM_STALL_MS`, asked first. Counted from when the lane QUEUED the call
 *  (`unsettled-bound-counts-from-the-queue`).
 *  EXPORTED for its suite. */
export const COLLECT_AUDIT_STALL_MS = 2 * 90_000;

/** One collector call or job the lane has queued and not heard back on (spec §5.10), with the monotonic instant it
 *  was QUEUED:
 *  - `learn`: a learning audit;
 *  - `act`: the executor's job, whose `phase` says what is out: `queued` (waiting on the id's key, or between its
 *    calls), `audit` (its own `ws-audit`) or `act` (its `ws-collect`). The runner the lane hands the executor sets it
 *    (`collectRunCcd`), so the unsettled line can list the executor's own audit at the audit's bound; at STALL the job
 *    is listed as holding the act slot, whatever is out. */
export interface CollectFlight {
  readonly kind: 'learn' | 'act';
  readonly sinceMono: number;
  readonly phase: 'queued' | 'audit' | 'act';
}

/** The collector's fleet-wide act slot (spec §5.10): free; taken by the act job queued for `id`; or KEPT, with its id,
 *  until `untilMono`, after an act that may have acted. */
export type CollectSlot =
  | { readonly kind: 'free' }
  | { readonly kind: 'job'; readonly id: string; readonly sinceMono: number }
  | { readonly kind: 'kept'; readonly id: string; readonly untilMono: number };

/** How long the FIRST fleet assembly after boot waits for the first HEAD
 *  sweep (`headBranches`) before shipping without it. Bounded because that
 *  sweep is serial agent round trips per project and a dropped one need not
 *  answer; only the first tick waits, and the first tick's busy->idle pushes
 *  are already suppressed, so what this delays is one frame at boot. */
export const HEADS_BOOT_WAIT_MS = 2_500;

/** The journal mirror's lane, and it is fast for the one reason the census's is
 *  slow: a sweep is ONE `readdir` plus one `readFileFrom` per live generation,
 *  and a destruction's `intent`/outcome pair should be visible while the
 *  operator is still looking at the screen. DECLARED HERE, beside its five
 *  siblings, and deliberately NOT in `shared/api.ts`: it has no bash twin and
 *  no wire meaning, and one sweep interval in L0 would be a second home for a
 *  class of value that already has one. EXPORTED because `mirror.ts` cannot
 *  import it — that would be L3 importing L4 — so the staleness window is
 *  passed in from the one construction site below. */
export const LC_SWEEP_MS = 5_000;

/** Build 9 wave 7 (D12): the claim lease's lane. 60 s — a 45-minute lease
 *  does not need the 2 s tick, and `sweepDivergences` already argues this
 *  cadence. Renew and lapse each keep their own clock so neither starves the
 *  other's first run. */
const CLAIM_SWEEP_MS = 60_000;

/** The stall watch's lane (spec 2026-09-29 §4.2, §10). It runs at `CLAIM_SWEEP_MS`'s cadence, for that
 *  constant's reason: a threshold of the quiet time (2 h built-in, 30 min at the least, stall watch settings §7)
 *  does not need the 2 s tick. EXPORTED for its suite, as `LC_SWEEP_MS` and `READINESS_SWEEP_MS` are. */
export const STALL_SWEEP_MS = CLAIM_SWEEP_MS;
/** `idle-compact-nudge` (D-5373): the lane's own clock. A nudge waits out `IDLE_NUDGE_SETTLE_MS` (30 s) anyway, so a
 *  10 s beat costs at most one beat of extra delay; the transcript tail is re-read only when the file changed. */
export const IDLE_NUDGE_SWEEP_MS = 10_000;
/** How much of a transcript's end the nudge lane reads: the compaction summary (~14 KB measured) and the attachments
 *  Claude Code re-injects after it sit well inside 1 MiB, the backlog's own window. */
const IDLE_NUDGE_TAIL_BYTES = 1024 * 1024;
/** The gap rule's threshold (slug `stall-clocks-drop-on-an-unobserved-gap` (D-3750)): between one missed sweep (~120 s, clocks survive) and two (~180 s, clocks drop). */
const STALL_CLOCK_GAP_MS = STALL_SWEEP_MS * 5 / 2;

/** What `FleetWatcher.stallResolveNow` answers each sweep (stall watch settings §9): the arming, which always carries
 *  a `mailMode`; the quiet time that r1, the dialog cap and the backoff base read; and where the level came from. */
interface StallResolution {
  readonly arming: StallBoxArming;
  readonly quietMs: number;
  readonly levelSource: StallResolved['levelSource'];
}

/**
 * What `tick()` already measured, handed to the stall lane so it reads neither again (worker stall watch wave 2, M6;
 * slug `tick-hands-the-lane-pids-and-records` (D-3649)). `panePids` holds the pane pid `assembleFleet` read for every alive
 * row: `null` when tmux answered none, and no entry for a pane that was not alive. `records` holds the registry rows
 * this tick read. REQUIRED: the lane has no pid or uuid read of its own, so production and the tests run one path.
 */
export interface StallTick {
  readonly panePids: ReadonlyMap<string, number | null>;
  readonly records: readonly SessionRecord[];
}

/** The registry uuid the stall lane reads a marker and a hookstate against, off the tick's rows: `uuid: null` for no
 *  row (unregistered), and `ok:false` for a row whose identity the tick could not measure. */
type StallUuid = { readonly ok: true; readonly uuid: string | null } | { readonly ok: false };
/** One live-file read: the raw word the verdict reads, and the live process's start the marker is judged by. */
interface StallLive { readonly live: LiveWordRead; readonly startedAt: number | null }
/** A session whose hookstate this lane does not read (a coordinator, a registry row): no session verdict takes an
 *  ask, and `unmeasured` says it was not read, never "no ask". */
const STALL_HOOK_ASK_UNREAD: HookAskFact = { kind: 'unmeasured' };
/** An identity the tick could not measure: the hookstate cannot be compared with it, so it is not read. */
const STALL_RAW_UNMEASURED: HookStateRawRead = { ok: false, reason: 'unmeasured' };

/** The hookstate ask the run verdict's holds 2a and 2b read, projected from the ONE raw read
 *  (`readHookStateRawMeasured`). A foreign or unregistered file carries no ask of this session's. `absent` and
 *  `malformed` read as no ask, as wave 1's identity-gated read answered them, and `unmeasured` stays unmeasured. A
 *  PermissionRequest `{approval}` envelope is carried as `approval` (M7b): L1 decides it is hold 2b, never 2a.
 *  Named departure `hook-ask-projection-in-l4` (D-3691): this projection, the identity cut included, stays in L4 as wave 1's
 *  shipped `stallHookAsk` kept it. It is not moved to `coord/stall.ts` in this wave. */
function stallHookAskOf(raw: HookStateRawRead): HookAskFact {
  if (!raw.ok) return raw.reason === 'unmeasured' ? { kind: 'unmeasured' } : { kind: 'none' };
  if (raw.identity !== 'current' || raw.state.ask === null) return { kind: 'none' };
  return 'questions' in raw.state.ask ? { kind: 'ask', at: raw.state.updatedAt } : { kind: 'approval', at: raw.state.updatedAt };
}

/** The raw hookstate as the frozen and delegates steps read it (`HookRawFact`): the identity, the event and the
 *  additive `aliveAt` (D-5232: subagent activity, which the two clocks read) are carried, and L1 judges them. */
function stallHookFactOf(raw: HookStateRawRead): HookRawFact {
  return raw.ok
    ? { ok: true, updatedAt: raw.state.updatedAt, event: raw.state.event, sessionId: raw.sessionId, identity: raw.identity,
      ...(raw.aliveAt === undefined ? {} : { aliveAt: raw.aliveAt }) }
    : { ok: false, reason: raw.reason };
}

/** D13's two ledger lanes. The floor scan reads every plan and spec of every
 *  registry-named project, so it runs HOURLY; reconcile reads only the plans
 *  of projects with open allocations, every 15 MINUTES, because `landed` is
 *  the signal a coordinator watches for. */
const LEDGER_FLOOR_SWEEP_MS = 3_600_000;
const LEDGER_RECONCILE_SWEEP_MS = 900_000;

/** F3's lane. Ten minutes: slower than the divergence census because the
 *  answer only changes when someone installs a skill or edits a token, and
 *  faster than the ledger floor's hour because an operator waiting to start a
 *  program is watching this one. EXPORTED so its own suite advances by the
 *  real constant rather than a copy that can drift from it. */
export const READINESS_SWEEP_MS = 600_000;

/** The name the coord probe asks the store about. `isSafeProjectSegment`
 *  REJECTS it (a leading space), so it can never collide with a real
 *  project's `ledger_floor` row — the probe is a liveness question, not a
 *  lookup, and must not be answerable by accident. */
const READINESS_PROBE_PROJECT = ' readiness-probe';

/** How far back the census weighs provenance pairs. One hour, not the whole
 *  table: a divergence the operator has already dealt with must stop being
 *  reported, and the durable record is `GET /api/lifecycle`. */
const PROVENANCE_WINDOW_MS = 3_600_000;

/** Refusal tokens (of ccd's fourteen, `spec:252-266` — the spec's own table
 *  predates the ninth and the fourteenth, `spec:49` is the unrelated `ws/`-
 *  prefix paragraph) that cannot stop being true: a branch, once pushed, is
 *  never un-pushed (`has-upstream`); a checkout that is not a workspace, a
 *  worktree ccd cannot find registered, and a worktree whose directory
 *  belongs to a different session are all facts about the session's shape
 *  that a title landing later cannot change (the last two ship their own
 *  remedy in the refusal detail, `git -C $main worktree add …`, which
 *  "cannot stop being true" only in the narrower sense that no TITLE fixes
 *  it). `name-taken-local`/`name-taken-origin` and `unchanged` are
 *  deliberately absent — a name collision or a since-changed title can
 *  resolve on the next sweep. See `FleetWatcher.nameSweepRetired` and review
 *  finding 1.
 *
 *  `registry-branch-drift` joins the set for the same "no title fixes it"
 *  reason as the worktree pair above: `cmd_ws_rename` now refuses when git's
 *  own worktree record disagrees with the registry's `branch` field — the
 *  corroboration `cmd_ws_reap` already requires (`ccd:7459`) — because
 *  without it a hand `git branch -m` (which moves git's answer but never
 *  updates the registry) leaves this sweep's own condition 2 believing the
 *  branch is still at its born name while `ws-rename` would act on whatever
 *  git says instead. The remedy is IN THE REFUSAL, same shape as the other
 *  two repairable tokens: a rename of that same branch through `ccd
 *  ws-rename` re-syncs the registry, which is a human action a later TITLE
 *  cannot substitute for — hence session-level retirement, not a
 *  per-derived-name retry.
 *
 *  `bad-branch` is deliberately NOT here, unlike the earlier draft of this
 *  set (review finding 5): it is a verdict on `deriveBranch(title)`, not on
 *  the workspace, and a later title is exactly the thing that can change it.
 *  Retiring the SESSION on `bad-branch` would be wrong the day it ever fires
 *  — `attemptedRenames`'s per-(incarnation, derived-branch) key is already the
 *  correct guard for a name-dependent refusal. Today the arm is dead code:
 *  `deriveBranch` only ever emits `ws/[a-z0-9]+(-[a-z0-9]+)*`, a subset
 *  `_ws_branch_valid` (`ccd/ccd:3186-3194`) always accepts, so `bad-branch`
 *  never actually reaches this lane — see `naming.ts:26-30`.
 *
 *  `held` (Wave 3 §3.1's `ws-rename` rung) is DELIBERATELY ABSENT and must
 *  stay absent. Every member here is permanent BY CONSTRUCTION — nothing about
 *  a later title makes a pushed branch un-pushed. A hold is the opposite: it
 *  exists to be released, and it is the ONE refusal this lane can meet that a
 *  later sweep should retry. Adding it would stop naming that workspace for
 *  the life of the process with no log line saying why. Pinned by
 *  `name-sweep.test.ts`'s "does not retire an incarnation on a `held`
 *  refusal", which goes red the moment the token joins this set. */
const PERMANENT_REFUSALS: ReadonlySet<string> = new Set([
  'has-upstream', 'not-a-workspace', 'worktree-unregistered', 'worktree-foreign',
  'registry-branch-drift',
]);

/** The fourth lane. A ccd install is a deliberate act by a human who is
 *  waiting, so a minute is the longest anyone should have to wonder whether
 *  the fleet noticed — and the agent's stat gate means an unchanged ccd costs
 *  a stat, not a bash process. */
const CAPS_REFRESH_MS = 60_000;

/** The catalogue lane's own cadence (design 2026-09-20 §7) — declared in
 *  `catalogue.ts` (`CATALOGUE_POLL_INTERVAL_MS`), which `routes.ts`'s refresh
 *  door also derives its interval from (fix round 2, C3), never a second
 *  copy of the 30-minute figure here. GitHub's unauthenticated listing
 *  budget is 60 requests an hour per IP and a 304 still spends one, so every
 *  30 minutes is 2 scheduled polls an hour, leaving the rest of the budget
 *  to `POST /api/updates/refresh`. */
const UPDATE_CATALOGUE_MS = CATALOGUE_POLL_INTERVAL_MS;

/** The inventory lane (design 2026-09-20 §8): seven small ~/.ccrc reads per
 *  node, lstat-gated and budget-bounded, once a minute — and at once after a
 *  `ready` frame (`triggerInventory`, wired in `index.ts`). */
const UPDATE_INVENTORY_MS = 60_000;

/** A thrown value's fs errno (`EACCES`, `EROFS`, …), or null — same stance as `writeOwnProjection`'s `code`
 *  (fix round 1, finding 1): a caller that wants to dedupe compares this, never the message. */
function errnoOf(e: unknown): string | null {
  return e instanceof Error ? (e as NodeJS.ErrnoException).code ?? null : null;
}

/** null = written, or nothing to write by construction (a fleet-role server has no own projection).
 *  Otherwise a STABLE `key` (`why`, plus the errno `code` when the outcome carries one — never the
 *  message or a path, both of which `writeOwnProjection`'s tmp name makes unique per attempt) for the
 *  caller to dedupe on, and the full `message` to print (fix round 1, finding 1: the previous version
 *  compared whole strings built from `detail`, so a box whose ~/.ccrc cannot take the file warned on
 *  every sweep instead of once per change of reason). */
function projectionWarn(p: ProjectionOutcome): { key: string; message: string } | null {
  if (p.ok || p.why === 'not-server-role') return null;
  const code = p.why === 'unwritable' ? p.code : null;
  const key = code !== null ? `${p.why}:${code}` : p.why;
  const message = p.why === 'unwritable' || p.why === 'no-channel' ? `${p.why}: ${p.detail}` : p.why;
  return { key, message };
}

/** The third lane. 8 projects x 1 call / 120 s is ~240 GraphQL calls an hour
 *  against a 5000/hr budget with ~4900 free — about 5%. Measured latency
 *  0.51-0.69 s per call. */
const PR_SWEEP_MS = 120_000;
const PR_SWEEP_ACTIVE_MS = 30_000;      // any project with an open PR whose checks are pending
const PR_BACKOFF_MAX_MS = 900_000;
/** How long one sweep may be in flight before the next is allowed to start
 *  anyway. In local mode `realRunner` passes NO timeout to `execFile`
 *  (`exec.ts:6-12`), so nothing bounds the awaited `ccd` call and a wedged `gh`
 *  would otherwise hold the single-flight latch for the process's lifetime —
 *  the cap would never update again and there would be no error anywhere to say
 *  why. Same 15 minutes as the backoff ceiling: far longer than any real sweep
 *  (measured 0.51-0.69 s per project call), short enough that wedged is not
 *  permanent. */
const PR_SWEEP_STUCK_MS = PR_BACKOFF_MAX_MS;

/** The SEVENTH lane. (Sixth is naming, fifth is hook-state sweeping.) spec:159
 *  fixes the cadence; the rest of this block is the gate's arithmetic.
 *
 *  Ten seconds is not how fast mail should arrive — it is how often the lane
 *  is allowed to ASK. Actual delivery is bounded below by `MAIL_QUIET_MS`,
 *  which is the point: mail lands at a turn boundary, not mid-thought. */
const MAIL_SWEEP_MS = 10_000;

/** How long a session must have been idle before it is interruptible. ccd's
 *  own `COMPACT_QUIET` (`ccd/ccd:142`), taken rather than re-derived: this is
 *  the same judgement about the same panes, and two numbers for one policy is
 *  two numbers to get out of step. Measured from `statusUpdatedAt`, which
 *  Claude Code rewrites only when the live word changes: under `idle` or
 *  `shell` the main loop has been idle at least that long (the worker stall
 *  watch design's §3.1), which is all this quiet needs. `mailTurnIdle`
 *  (`turnidle.ts`) applies it. */
const MAIL_QUIET_MS = 60_000;

/** The ask-release lane's own self-throttle (RULING F4, task-7-brief). Not how
 *  fast a lapsed hold fires — that ceiling is `ASK_GRACE_MS` (`askwindow.ts`), measured
 *  in minutes — but how often the lane is allowed to ASK, the same relation
 *  `MAIL_SWEEP_MS`'s own docstring states for the mail lane. Ten seconds
 *  matches that cadence and is ample against a window sized in minutes. */
const ASK_SWEEP_MS = 10_000;

/** No session gets two injections inside this window, however much mail is
 *  queued for it. A fan-out of six findings arriving as six prompts in ninety
 *  seconds is a denial of service dressed as coordination. */
const MAIL_COOLDOWN_MS = 120_000;

/** The same two questions the pair above asks, asked of a COORDINATOR — a
 *  session whose id is the `claimedBy` of a non-terminal run.
 *
 *  The pair above is sized for a worker mid-thought: a minute of measured idle
 *  before the lane may interrupt, and no second injection inside two. A
 *  coordinator at a wave boundary is not mid-anything. Its own contract
 *  (clause 7, `ccd/coordinator-skill/SKILL.md`) MANDATES that it end its turn
 *  and wait, so the state the worker floor exists to protect is the state the
 *  coordinator is required to be in, and the floor becomes a delay with nothing
 *  behind it — on the one session every other session in a program is waiting
 *  for.
 *
 *  Fifteen seconds is still an idle floor and not the absence of one: it is read
 *  off the same `statusUpdatedAt` and answers the same question, so a
 *  coordinator genuinely mid-turn is still not interrupted. Thirty seconds keeps
 *  `MAIL_COOLDOWN_MS`'s own promise — no fan-out arriving as a burst of prompts
 *  — at a boundary where two messages are a handoff rather than a denial of
 *  service.
 *
 *  Workers and every other session read the pair above, untouched. */
const COORD_QUIET_MS = 15_000;
const COORD_COOLDOWN_MS = 30_000;

/** WHAT `MAIL_REPLAY_MS` MEANS: how long
 *  an UNACKED delivery waits before it is replayed. Dated from the
 *  `UserPromptSubmit` edge when there is one, from `deliveredAt` otherwise —
 *  the edge proves the turn started, so the recipient is thinking, not
 *  ignoring. The VALUE is `shared/api.ts`'s (`stall.ts` reads it too). */

/** WHAT `MAIL_MAX_ATTEMPTS` MEANS, kept beside the code that enforces it. The
 *  VALUE moved to `shared/api.ts` in Task 408 — `MailSummary.attempts` puts
 *  the running count on the wire, so the PWA now names the same budget and a
 *  second `6` in the client would be a second copy of a policy number. The
 *  reasoning stays here, where the ceiling is actually applied.
 *
 *  The PRE-DELIVERY attempt budget, and the spacing between attempts —
 *  applies ONLY while a delivery's own `deliveredAt` is still null (review
 *  finding 4). A row that has NEVER been delivered parks as
 *  `rejected('undeliverable')` at the cap, and THE MAIL ROW IS UNTOUCHED
 *  (spec:170-172): the record of what was said survives the failure to say
 *  it. The instant `deliveredAt` is set, this budget stops applying: the
 *  row's own history already disproves 'undeliverable', so a failing REPLAY
 *  backs off instead of rejecting on THIS counter — `attempts` keeps
 *  counting on a delivered row too (it is one cumulative column), just
 *  without a ceiling that turns a failing SEND into a park.
 *
 *  A delivered row's own park is `MAIL_REPLAY_MAX_ATTEMPTS` below, a
 *  SEPARATE counter over successful replays (fix — review finding 20: before
 *  it existed, a delivery no one ever acked replayed "forever, bounded by
 *  ack rather than by a count" — true, and that is exactly what left
 *  spec:170-172's own terminal state structurally unreachable for any
 *  delivery that succeeded even once, since `MAIL_COOLDOWN_MS` only SPACES
 *  the injections and a send that keeps succeeding can never fail its way
 *  into this counter).
 *
 *  That is also what makes the constant below real (review finding 9): a
 *  NEVER-delivered row's own schedule (attempts 1..5, 30 s doubling to 8 min)
 *  never reaches `MAIL_BACKOFF_MAX_MS` before `MAIL_MAX_ATTEMPTS` parks it —
 *  `Math.min` never binds on that path and the ceiling is decorative there.
 *  A delivered row's `attempts` is not capped at 6, so by attempt 6
 *  (30 000 * 2^5 = 960 000) `Math.min` genuinely clamps to the ceiling —
 *  doubling from 30 s to the same 15-minute ceiling `PR_BACKOFF_MAX_MS`
 *  already uses, one ceiling for "this keeps not working" across the whole
 *  watcher. */
const MAIL_BACKOFF_BASE_MS = 30_000;
const MAIL_BACKOFF_MAX_MS = PR_BACKOFF_MAX_MS;

/** D-2369: how long a nudge is held when the recipient's own auto-continue is
 *  armed. Not a backoff step: the recipient is not failing, it is waiting, so
 *  the hold counts no attempt and `MAIL_MAX_ATTEMPTS` cannot park it. Five
 *  minutes against a reset that may be hours away: cheap re-reads, and the
 *  first sweep after the session resumes delivers. */
const MAIL_ARMED_HOLD_MS = 300_000;

/** Worker stall watch §4.1: how long a nudge is held when `sendPrompt` refused
 *  it `turn-running`. The live word delivered it (`shell`), but the pane's last
 *  8 rows showed `esc to interrupt`. Like `MAIL_ARMED_HOLD_MS`, this is not a
 *  backoff step. The recipient is not failing, so the hold counts no attempt
 *  and `MAIL_MAX_ATTEMPTS` cannot park it. Unlike that hold, the sender is not
 *  told, because a running turn is not a blocked recipient. *Chosen*, 60 s: a
 *  turn may end in seconds, while `MAIL_ARMED_HOLD_MS` is sized for a usage-limit
 *  reset. */
const MAIL_TURN_HOLD_MS = 60_000;

/** The ceiling on successful, UNACKED replays (review finding 20) — see
 *  `MAIL_MAX_ATTEMPTS`'s own docstring for why that counter cannot serve
 *  this role. At `MAIL_REPLAY_MS` (10 min) between replays, 20 attempts is
 *  a little over three hours of a recipient provably receiving the same
 *  envelope and never acking it — long enough that an ordinary slow ack
 *  (a session busy on something else for a while) never comes close, short
 *  enough that `MAIL_COOLDOWN_MS`'s own docstring's "denial of service
 *  dressed as coordination" eventually parks rather than running for the
 *  life of the box. */
const MAIL_REPLAY_MAX_ATTEMPTS = 20;

/** The fleet kill-switch, `$REG/mail-disabled` — ccd's `-disabled` family
 *  (`ccd/ccd:40-41`, `_lane_enabled` at `:248`), which the operator already
 *  knows how to use: `touch` to stop, `rm` to resume. Read by LISTING the
 *  registry directory, never by reading the file — and that stays true even
 *  though `FleetIO` no longer has to collapse "unreadable" into "absent":
 *  `readFileMeasured` (`MeasuredRead`/`ReadFailure`, `io.ts`) can now tell
 *  the two apart for a single file. It can't tell them apart for the CASE
 *  THAT MATTERS MOST here: a measured read of just this file answers
 *  `absent` on a plain ENOENT, and that ENOENT fires identically whether
 *  the marker itself is missing or the whole registry directory underneath
 *  it is gone — so treating a targeted `absent` as "not disabled" would
 *  fail OPEN exactly when the registry has vanished, the one case this
 *  kill-switch most needs to fail SHUT on. `io.readdir` still collapses
 *  every failure of its own to `null` — it is the folding read; its sibling
 *  `readdirMeasured` is not used here — and that collapse is the point: `listing === null` means "can't tell",
 *  and "can't tell" must read as disabled, not as license to proceed
 *  because the marker itself couldn't be seen. `limits.ts:134-142` already
 *  filters unknown `<name>-disabled` markers out of `/api/accounts`, so
 *  this name cannot fabricate an account row there. */
const MAIL_DISABLED_MARKER = 'mail-disabled';

/** The hold's own kill switch, `$REG/asks-disabled` — same family, same read
 *  discipline as `MAIL_DISABLED_MARKER` immediately above: LISTED, never
 *  statted directly, and an unlistable registry (`listing === null`, "can't
 *  tell") reads as disabled rather than as license to keep holding. Touch to
 *  stop every FUTURE hold from deferring (an already-held ask still waits out
 *  its own `until`, and `sweepAsks` still releases it on schedule); `rm` to
 *  resume. */
const ASKS_DISABLED_MARKER = 'asks-disabled';

// `UNCHECKED_PR` was a local copy of the literal `PrKeycap.tsx` and
// `prstate.ts` each also held — integration finding 6. One definition now, in
// `shared/api.ts`, which is the only module all three sides can import.

/**
 * Polls the fleet: captures every registered pane to detect menu dialogs
 * (emitting `session:<id>` dialog / dialog_cleared messages on change), then
 * emits 'fleet' on the bus only when the assembled JSON changed.
 *
 * In remote mode, every poll taken while actually connected also persists a
 * snapshot to the degraded-mode cache (fleetstate.ts) — skipped while
 * disconnected so a stretch of empty/partial reads never clobbers the last
 * known good snapshot `/api/fleet` falls back to.
 */
/** The identity of one merged announcement: the workspace AND the PR that
 *  merged. Defined once because two things key on it and they must not drift —
 *  `mergedNotified` (say it once) and the push's collapse tag (replace only
 *  what is genuinely the same statement). A workspace outlives its own merge
 *  now, so `id` alone is not an identity. */
const mergedKey = (id: string, number: number | null): string => `${id}#${number ?? '?'}`;

/** What one `FleetWatcher.pushRelease` call did (design 2026-09-20 §13; plan W3 Task 3). Each arm is a fact
 *  a caller or a test tells apart: nothing to decide; decided and marked with no push, every measured node
 *  already running the tag (D-3294); pushed; the mark lost to another writer, so nothing
 *  was sent; or a store read or write threw, so nothing was marked or sent. */
export type ReleasePushOutcome =
  | { did: 'skipped'; why: 'no-coord' | 'not-server-role' | 'no-push-service' | 'not-yet-swept' | 'nothing-to-notify' }
  | { did: 'marked'; tag: string }
  | { did: 'pushed'; tag: string; payload: PushPayload }
  | { did: 'refused'; tag: string; why: Extract<MarkReleaseNotifiedResult, { ok: false }>['why'] }
  | { did: 'failed'; detail: string };

/** Two readings of the breaker's held set merged, member by member: every instant and every flag either carries (D-4857:
 *  under a state that is not clean the lane keeps whatever it can still read). */
function mergeBreakerMembers(
  a: readonly DeadCoordinatorBreakerMember[], b: readonly DeadCoordinatorBreakerMember[],
): DeadCoordinatorBreakerMember[] {
  const out = new Map<string, DeadCoordinatorBreakerMember>();
  for (const m of [...a, ...b]) {
    const had = out.get(m.id);
    const all = [...new Set([...(had === undefined ? [] : [had.firstDeadAt, ...(had.instants ?? [])]), m.firstDeadAt, ...(m.instants ?? [])])]
      .sort((x, y) => x - y);
    const flagged = m.fallback === true || had?.fallback === true;
    out.set(m.id, { id: m.id, firstDeadAt: all[0]!, ...(all.length > 1 ? { instants: all } : {}), ...(flagged ? { fallback: true as const } : {}) });
  }
  return [...out.values()];
}

export class FleetWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastJson: string | null = null;
  /** The fleet the last `fleet` broadcast carried — `lastJson`, unserialised. */
  private lastFleet: FleetSession[] | null = null;
  /** Last-reported dialog id per session id. */
  private dialogIds = new Map<string, string>();
  /**
   * Session id → the dialog id of an ask push that went out with NO actions,
   * still pending an envelope.
   *
   * The ask push is edge-triggered on the dialog id, and `parseDialog`'s id is
   * a hash of the menu's labels and title — it does not change as the cursor
   * moves — so without this latch a question whose hookstate landed a beat
   * after its pane (see the ordering note in `tick()`) could NEVER become
   * answerable from the phone: the appear-edge is spent, and nothing else
   * produces `kind:'ask'`. With it, the first tick that can prove the envelope
   * re-raises the same notification, in the same tag, now carrying its
   * options.
   */
  private actionlessAsks = new Map<string, string>();
  /** Asks whose operator push is DEFERRED, keyed by session id. IN MEMORY BY
   *  DESIGN and not in coord.db (D-2169): this map is the only carrier of the
   *  deferred push, so a lost database must not be able to swallow it. A server
   *  restart drops the hold and the push is lost — which is PRE-EXISTING, not a
   *  regression: `this.primed` is false on the first tick after boot and
   *  `dialogIds` suppresses the second, so a restart during any live dialog
   *  re-pushes nothing today either.
   *
   *  Cleared in TWO places, both keyed off the dialog leaving the pane: the
   *  orphan-settle in the `last !== dialog.id` branch above, when a NEW
   *  dialog silently replaces an old one with no intervening clear tick; and
   *  (Task 8) the `else if (last !== undefined)` branch below, when the
   *  dialog goes away with nothing to replace it — an unanswered
   *  `AskUserQuestion` the operator escaped, or the session interrupted,
   *  cleared, swapped, or killed out from under it. Either way the dialog's
   *  own departure from the pane is the end of the hold; the second case
   *  settles the row `stale` and pushes nothing, since a cleared dialog is a
   *  question that no longer exists.
   *
   *  `answeringSince` (fix round 1, item 1): `null` until `sweepAsks` first
   *  observes this row `'answering'`, then the sweep's own `now` at that
   *  observation — never re-derived, and reset to `null` the moment the row
   *  is observed back at `'held'` (a `sweepAsks` decision, not `hold`'s —
   *  see `ASK_ANSWERING_MAX_MS`'s own docstring). */
  private heldAsks = new Map<string, { until: number; askId: number;
    ev: Parameters<FleetWatcher['pushOne']>[0]; answeringSince: number | null }>();
  /** D-5289, late answer wins: the push the lapse fired, per child, kept so a
   *  parent's answer after the deadline can replace that notification under
   *  the same tag (`answeredLate`). Set only by `sweepAsks`'s own lapse (a
   *  parent's `declined` never lands here: its push is the parent's own act),
   *  dropped when replaced and whenever the child's dialog clears or is
   *  replaced (`detectDialogs`), so it holds at most one entry per child
   *  sitting on a lapsed question. Its loss on a restart is free: the operator
   *  keeps the lapse's notification, today's behaviour. */
  private lapsedAsks = new Map<string, { askId: number; ev: Parameters<FleetWatcher['pushOne']>[0] }>();
  /** D-5290: dialogs whose FIRST raise is deferred, per child — the dialog id
   *  and how many ticks it has been seen while the child's hookstate was not
   *  yet `waiting` and no envelope made it answerable. Bounded by
   *  `ASK_SETTLE_TICKS`; dropped the moment the dialog is raised or held, and
   *  whenever it clears or is replaced. Its loss on a restart is free: a
   *  restart re-raises nothing anyway (`heldAsks`' own note). */
  private settlingAsks = new Map<string, { dialogId: string; ticks: number }>();
  /** Fail-shut kill switch for the hold, `$REG/asks-disabled`. Declared in
   *  Task 6 (RULING F2) so the mint fork below compiled before this method
   *  existed; now SET by `sweepAsks` below, off the same registry listing
   *  `sweepMail` reads for `MAIL_DISABLED_MARKER` — `listing === null`
   *  ("can't tell") reads as disabled, never as license to keep holding. */
  private asksDisabled = false;
  /**
   * `id#prNumber` keys already told "merged … nothing archived" — so
   * `sweepMerged` announces a merge ONCE per (workspace, PR) rather than on
   * every 2-minute sweep for as long as that PR stays the bound one.
   *
   * THE NUMBER IN THE KEY IS LOAD-BEARING, and more so since the archive was
   * removed: a workspace now survives its first merge, so it can land a
   * SECOND PR, and `boundRow` binds the newest one. A key of `id` alone would
   * announce the first merge and silently swallow every one after it.
   *
   * IN-MEMORY BY DESIGN, not a gap: a server restart forgets the latch and
   * may repeat the push, but `announceMerged` tags it `merged-<id>#<number>` —
   * the same key — so the repeat REPLACES that PR's own prior notification
   * rather than stacking a duplicate, while a DIFFERENT PR's announcement,
   * which is a different statement, still stands beside it. The cost of losing
   * this latch on restart is one redundant, silently-replaced notification;
   * persisting it would buy nothing back for that price.
   */
  private mergedNotified = new Set<string>();
  /** The merge-queue word each session's last full pr-state line carried
   *  (`queueFor`), kept beside `prStates` and written by the same arm of
   *  `sweepPr`. Read by `sweepLanding` and nothing else. */
  private prQueues = new Map<string, PrQueueRead>();
  /** `sweepLanding`'s in-memory latch, per (workspace, PR, notice, removal
   *  time) — the `mergedNotified` shape plus the notice and the removal's own
   *  timestamp, because a PR can be dequeued, re-enqueued and dequeued AGAIN,
   *  and each removal is a new fact the coordinator has to hear. Written only
   *  AFTER the notice landed, after a durable read proved an earlier process
   *  sent it, or once the lane has decided there is nobody to tell — never
   *  before a read: a latch set ahead of a failed read or a thrown mail would
   *  make that removal a landing that silently stops. It is NOT what stops a
   *  restart re-announcing (a PR can sit dequeued through a whole fix round,
   *  and every rollout restarts this process); that is `sweepLanding`'s
   *  DURABLE read. This set spares a latched notice the coord.db reads on
   *  every later sweep. */
  private landingNotified = new Set<string>();
  /** Last-seen model/effort/ultracode/branch per live session (from the pane). */
  private statuslines = new Map<string, Statusline>();
  /** The branch each worktree's own HEAD names, keyed by the CCD ID measured
   *  off its checkout path (`ccdIdForWorktree`, never git's admin name, which
   *  git suffixes on a basename collision and so can name a stranger), as
   *  `sweepDivergences` last measured it — the fleet's branch fallback when a
   *  pane gives no fresh full branch (fleet.ts). `project` rides along so a
   *  failed read can keep its own project's entries. Kept apart from the
   *  census's per-sweep map: that retention must never reach the census,
   *  which a failed read may only ever suppress, never feed. */
  private headBranches = new Map<string, { project: string; branch: string | null }>();
  /** What `sweepDivergences` last prepared for the delegation lane from the census it already takes (wave 3, Task 10): each
   *  censused project's answer and the incarnation of every registry id the pass used. REPLACED whole by a pass, never merged, so a
   *  project that was not read is never a stale one; `null` until the first pass. Nothing consumes it before the watcher lane. */
  private delegationCensus: DelegationCensusPass | null = null;
  /** Settles the first time `headBranches` is written; the first assembly
   *  after boot waits on it, bounded (`HEADS_BOOT_WAIT_MS`). */
  private headsSettled!: Promise<void>;
  private settleHeads: () => void = () => {};
  private headsBootWaited = false;
  /** Prior status per session — drives the busy→idle push. */
  private prevStatus = new Map<string, SessionStatus>();
  /** When each row's current busy stretch began (D-5233): set on the tick a measured row turns `busy`, from its
   *  `statusUpdatedAt` (the live file writes on change, so that stamp is the stretch's start), else the tick's clock;
   *  cleared when a measured row is anything but `busy`. The Finished push asks for a main Stop at or after it. */
  private episodeBusySince = new Map<string, number>();
  /** Last swept task progress per session id, and when the sweep ran. */
  private taskProgress = new Map<string, TaskProgress>();
  private lastTaskSweep = 0;
  /** Last-swept PR state per SESSION id. */
  private prStates = new Map<string, PrState>();
  /** Last-measured repo cell per PROJECT — retained, not derived, from what
   *  `sweepPr` already reads off `CcdPrLine.repo` / `CcdPrFailure.reason` for
   *  `GET /api/projects`. See `repoCellFor` (prstate.ts) for the fold. */
  private readonly projectRepos = new Map<string, ProjectRepoWire>();
  /** Last-read hook state per session id (the fifth lane) — rebuilt every
   *  tick, same cadence as dialog detection: `readHookState` is a single
   *  local JSON read per session, cheap enough not to need its own slower
   *  clock the way task/PR sweeps do. */
  private hookStates = new Map<string, HookState>();
  /** The usage sidecar lane (routing slice 0) — rebuilt on its own
   *  `USAGE_SWEEP_MS` clock, not every tick; see `sweepUsage`. */
  private usage = new Map<string, SessionUsage>();
  private lastUsageSweep = 0;
  /** Per-PROJECT backoff after a failed read: one repo failing must not slow
   *  or silence the other seven. */
  private prBackoff = new Map<string, { until: number; step: number }>();
  private lastPrSweep = 0;
  /** The fourth lane's clock. Starts at 0 so the first tick after start
   *  always refreshes — which is what recovers a server that connected to an
   *  agent whose boot-time caps read had already failed. */
  private lastCapsAt = 0;
  /** The catalogue lane's clock. Starts at 0, like `lastCapsAt`, so the first
   *  tick after a start polls: the catalogue's state is process memory
   *  (D-3182), and a restarted server should read
   *  "never checked" for one tick, not for half an hour. */
  private lastCatalogueAt = 0;
  /** The inventory lane's clock, and its ONE run in flight. Starts at 0 so
   *  the first tick after a start sweeps. `inventoryNow()` sets the clock, so
   *  a `ready`-triggered sweep also defers the minute gate's next one. */
  private lastInventoryAt = 0;
  private inventoryRun: Promise<SweepOutcome[]> | null = null;
  /** The server-caps beat's clock and its ONE write in flight (D-5232's mechanism, Task 9b). Starts at 0 so the first
   *  tick after a start writes: that tick IS the boot write (`start()` ticks at once). Its own clock, never the
   *  inventory lane's, so the file is rewritten whether or not this server has a coordination database. */
  private lastServerCapsAt = 0;
  private serverCapsRun: Promise<WriteServerCapsResult | null> | null = null;
  /** The last server-caps write failure's stable key (`unwritable:<errno>`), so an unwritable ~/.ccrc warns once
   *  per change of reason, not once a minute (`lastProjectionWhy`'s idiom); null after a success. */
  private lastServerCapsWhy: string | null = null;
  /** C2 (final fix wave): the last inventory-sweep REJECTION message warned
   *  about, so a standing cause (a locked or corrupt coord.db held past one
   *  sweep) warns once, not every tick/ready — reset to null the moment a
   *  sweep completes without rejecting. Never the source of truth for
   *  WHETHER a sweep failed; C1's per-row isolation means `sweepInventory`
   *  itself should not reject any more except for a bug outside either
   *  connection's own try/catch (e.g. inside `resolveAndProject`'s own
   *  queueing, which `sweepThenProject` already handles separately). */
  private lastInventoryRejectWarn: string | null = null;
  /** C4 (final fix wave): set when a caller of `triggerInventory()` (the
   *  `ready` hook) JOINS a sweep already in flight rather than starting one.
   *  The joiner's own connection state may be exactly what changed since the
   *  in-flight sweep read it — joining that promise alone would silently
   *  measure the join as though nothing had happened. ONE rerun, not a
   *  queue: every joiner while a run is in flight sets this SAME flag, and
   *  the first settle after it clears the flag and fires exactly one more
   *  sweep. */
  private inventoryRerunPending = false;
  /** C3 (final fix wave): the (label,nodeId,why) tuples this lane already
   *  warned about — a `node-id-collision` or a `refused` sweep outcome is
   *  otherwise named nowhere but the discarded `SweepOutcome[]` (D-3211's
   *  own gap). Warned once when a tuple first appears, silent while it
   *  repeats, and warned again if it clears and later recurs. */
  private lastInventoryIssues: ReadonlySet<string> = new Set();
  /** Task 12: the last projection-warning KEY (`projectionWarn`'s `key`, never its `message`), so a box
   *  whose ~/.ccrc cannot take the file warns once per change of reason, not once a minute. */
  private lastProjectionWhy: string | null = null;
  /** Plan W3 Task 3: the last reason a release-push decision failed, so a coord.db that cannot be read
   *  warns once per change of reason on the inventory lane's minute beat (`lastProjectionWhy`'s idiom). */
  private lastReleasePushFailure: string | null = null;
  /** Plan W3 Task 3 (D-3314): true once THIS process's sweep has actually REWRITTEN the rows the push decides
   *  on — never merely "a sweep finished" (W5 review 161, F-H: a sweep can finish with the server row
   *  unreachable, refused or errored, none of which rewrites it — `sweptEnoughToDecide` is the exact
   *  predicate, `sweepThenProject`'s own comment above its call site). Until it opens, the `nodes` rows are
   *  the previous process's, so the catalogue side (`pushReleaseAfterPoll`) decides nothing. Set by
   *  `sweepThenProject`; never cleared. */
  private inventorySwept = false;
  /** Wave 5 (design 2026-09-20 §10): the dispatcher's ONE run in flight, and whether a trigger arrived while
   *  it ran. However many triggers arrive during a run, they ask for ONE follow-up after it — so a request
   *  written mid-run is planned by a run that reads it, and no two runs ever hold the plan-then-acquire
   *  stretch at once. */
  private dispatchRun: Promise<DispatchRunResult> | null = null;
  private dispatchAgain = false;
  /** The sixth lane's clock. */
  private lastNameSweep = 0;
  /** The census lane's clock, and its byte-equality guard. A git-ref read per
   *  project is far too expensive for the 2 s poll, and a census changes on
   *  human timescales; `null` (not `'[]'`) so the first sweep always emits, even
   *  an empty one — mirroring `lastRunsJson`'s own initial value, and the reason
   *  a HEALTHY fleet is a frame rather than a silence. */
  private lastDivergenceSweep = 0;
  private lastDivergenceJson: string | null = null;
  /** The child-reclaim lane's clock (child-reclamation wave 4): the MONOTONIC
   *  time of the last pass, `null` before the first. Two writers stamp it
   *  (spec §5.5, §5.7): the gate stamp of a pass that the throttle let in,
   *  which is all a pass still gathering or overtaken during its gather ever
   *  writes; and the decision clock of the last pass that was NOT overtaken,
   *  which re-stamps it after the gather. Not the other lanes' `0`
   *  never-run idiom, because a monotonic source may start at 0, which would
   *  make `0` a real stamp. Monotonic so that a backward wall step cannot
   *  freeze the lane, and a forward one cannot run a pass early: the
   *  twice-observed rule's interval is real time. */
  private lastChildReclaimSweep: number | null = null;
  /** The child-reclaim lane's pass counter (spec §5.5, §5.7), bumped as each pass starts its generation gather,
   *  the one await before its loop. A pass whose number is no longer the latest when its gather settles was
   *  OVERTAKEN by a newer pass, and decides nothing. A pass that was NOT overtaken re-stamps the throttle
   *  (`lastChildReclaimSweep`) with its own decision clock, read after the gather, so the next pass cannot start
   *  until a whole interval after this one decided. Together the two keep any two passes that decide at least
   *  one interval apart on the monotonic clock, so one interval never counts as two sightings, however long a
   *  gather takes. */
  private childReclaimPassSeq = 0;
  /** Per marked child: the twice-observed sighting, the two deferral clocks
   *  (the first deferral of any kind, which each request carries; the first
   *  PRESENCE deferral, which alone the ceiling reads), the run of failed
   *  attempts the backoff reads, and the fairness ordering key
   *  (`lastAskedAt`) — `ChildReclaimSweepEntry`. IN MEMORY ONLY, deliberately:
   *  a restart loses it, and losing it can only DELAY a reclaim (two passes
   *  rebuild eligibility, the ceiling clock restarts) or retry a failing one
   *  sooner, which ccd's re-proof on the box makes safe — never cause one.
   *  The persistent tier is re-read at every first sighting
   *  (`childReclaimTierSeed`), so a lost memory costs a tier child one extra
   *  ask, never a fresh tier wait.
   *  Its decision clocks are this process's monotonic clock; `firstDeferredAt`
   *  and `lastPresenceWallAt` are wall-clock epoch ms and `bornAt` is ccd's
   *  clock, compared for equality only (`ChildReclaimSweepEntry`). An entry
   *  describes one workspace generation; a new birth, a marker naming a new
   *  run or a new registry generation replaces it with a first sighting. */
  private childReclaimSweepState = new Map<string, ChildReclaimSweepEntry>();
  /** Children whose reclaim this lane has asked for and not heard back on. A
   *  pass never asks a child already in this set twice: the executor can hold
   *  a session's queue for minutes (`ws-reclaim`'s remote budget is
   *  `ws-reap`'s). Bounded to `CHILD_RECLAIM_MAX_IN_FLIGHT`, except a
   *  dispatch that has run past `CHILD_RECLAIM_STALL_MS` — `childReclaimInFlightSince`
   *  is what tells the two apart. */
  private childReclaimInFlight = new Set<string>();
  /** When each in-flight dispatch was sent — `CHILD_RECLAIM_STALL_MS`'s own
   *  clock, and the reason a request that never settles stops holding the
   *  lane's one slot forever. MONOTONIC: a forward wall-clock step must never
   *  free the one slot while a reclaim is still running. */
  private childReclaimInFlightSince = new Map<string, number>();
  /** Session ids whose stall past `CHILD_RECLAIM_STALL_MS` this process has
   *  already logged once — never once a pass, for the reason
   *  `CHILD_RECLAIM_STALL_MS`'s own docstring gives. Cleared when the
   *  dispatch finally settles, so a LATER stall of the same child (a second
   *  reclaim, long after the first) is reported again. */
  private childReclaimStalledLogged = new Set<string>();
  /** One log line per absence per child per process, not one a minute — keyed
   *  `<why> <id>`, because an absent minting run and an absent reviewed run
   *  are two conditions with two sentences. */
  private childReclaimAbsentLogged = new Set<string>();
  /** Per marked child: the workspace generation in which THIS lane has seen a
   *  `hold-retired` verdict for it once, with no other verdict in between. The
   *  key is the child's birth, the run its marker names and its generation
   *  file's value (`ChildReclaimGenerationIdentity`; spec §5.7).
   *  A `hold-retired` verdict that a SECOND consecutive pass finds for the SAME
   *  generation queues the release job, carrying that generation, which the
   *  job re-reads nearest its argv. A sighting of ANOTHER generation is a
   *  first sighting, and its key REPLACES the stored one.
   *  `childReclaimHoldRetiredStep` (L1) decides which; this lane applies it.
   *  Any other verdict, eligible or any other ineligibility, deletes the
   *  entry, so the two sightings must be back to back. IN MEMORY ONLY, the
   *  `childReclaimSweepState` idiom: a restart only delays a release by one
   *  more sighting, never causes one, because the job's own re-reads and ccd's
   *  rung 4 prove everything again before anything is written. A child already
   *  in `childReclaimInFlight` (its release job dispatched, or its ordinary
   *  reclaim in flight) is never touched here: the lane has no re-entrancy
   *  guard beyond that one set, and an overlapping pass must not turn "two
   *  further passes" into one. */
  private childReclaimHoldRetiredSeen = new Map<string, ChildReclaimGenerationIdentity>();
  /** Per marked child: has its retired-hold release job ANSWERED since this
   *  lane last saw it eligible? Set where the job settles, beside the delete
   *  of its sweep entry; CONSUMED by the next eligible verdict, which seeds
   *  nothing that pass. A pass's registry listing is read before the lanes
   *  ahead of this one are awaited, so the job can answer between a listing
   *  and the loop that reads it — and a sighting seeded from a listing older
   *  than the answer must not count as one of the two fresh unheld passes the
   *  answer requires (spec §5.7). The lane cannot tell such a listing from a
   *  fresh one, so it skips one sighting either way: that fails closed and
   *  costs one pass. CLEARED in three places only: the two pass-level resets
   *  (the mirror or coordination-history fail-shut, and the switches and
   *  capabilities return), and the vanished-row loop, so a mark never
   *  outlives its child. An INELIGIBLE verdict deletes the entry but KEEPS
   *  the mark — a choice, not a safety need: ticks are serialised (`tick()`'s
   *  `ticking` guard), this lane's one await before its loop is the generation
   *  gather, and a pass overtaken during it decides nothing (`childReclaimPassSeq`),
   *  so only one pass's listing can predate a release answer; that pass's held row
   *  seeds nothing anyway, and the next listing postdates the answer, so
   *  spending the mark there would still leave two fresh unheld passes.
   *  Keeping it costs at most one pass, once. IN MEMORY ONLY, the
   *  `childReclaimSweepState` idiom. */
  private childReclaimReleaseAnswered = new Set<string>();
  /** The sweep's verdicts (spec §5.9): one per marked row the last JUDGING pass listed, L1's own
   *  `ChildReclaimSweepVerdict`, recorded and never re-decided here. A pass that judged nothing
   *  (`reclaim-paused` raised, a reclaim capability missing, the mirror or coordination read
   *  failed) — the same places the sweep state is cleared — reduces it to its KEPT verdicts
   *  (`childReclaimKeptVerdicts`, L1): the attention list keeps listing those, so the chip keeps
   *  saying them. Each kept verdict carries the run its marker named, and both surfaces read it
   *  only while the marker still names that run: a recycled slug's next workspace is not the old
   *  one's (spec §5.6). `null` until this process's first judging pass. IN MEMORY ONLY. Replaced
   *  whole, never mutated. Read by the run chip, through `currentChildReclaimVerdicts()`, and by
   *  the attention list's one write: its kept arm, and the failing items it withholds for a held
   *  child. */
  private childReclaimJudged: ReadonlyMap<string, ChildReclaimSweepVerdict> | null = null;
  /** Which kept words this process has fed for which child: one `child reclaim kept` feed row per
   *  child, per word, per process (spec §5.9). A child is a session id under ONE marker's run: an
   *  item whose run differs from the one recorded is a recycled slug's next workspace (spec §5.6),
   *  a new child, and starts a new set, whether or not any pass between saw the id unlisted. Pruned
   *  on every pass whose mirror read succeeds, a paused one included: an id that pass's listing no
   *  longer carries is dropped. A pass whose mirror read fails returns before the prune, and prunes
   *  nothing. What neither the key nor the prune tells apart is the same run minting the same slug
   *  again with no pruning pass between. IN MEMORY ONLY: a restart feeds each kept child once more. */
  private childReclaimKeptReported =
    new Map<string, { readonly runId: number; readonly words: Set<ChildReclaimKeptWord> }>();
  /** The kept-leaf items (spec §5.6, §5.9), as the sweep's last successful kept-leaf read derived them.
   *  Kept, never erased, across a read that failed. `[]` until the first pass. Derived from the mirror on
   *  every pass that gets past the fail-shut try, so a restart rebuilds them on its first pass. */
  private childReclaimLeaves: readonly ChildReclaimLeafKept[] = [];
  /** THE TEMP-ROOT COLLECTOR'S LANE (spec §5.10, child reclamation wave 9): its clocks and memory, its OWN — never the
   *  child lane's, the expiry lane's or the dead-coordinator lane's. IN MEMORY ONLY, deliberately: a restart loses all of
   *  it, and losing it can only DELAY a collection (two fresh observations, the start hold-off), never cause one. STATED
   *  RESIDUAL (spec §5.10, pacing): a restart re-enters each terminal and verb-failed id at j = 0, about eight extra
   *  terminal audits or failing acts per such id after it.
   *  - `lastCollectSweep`: the throttle, on the MONOTONIC clock; `null` before the first pass.
   *  - `collectSweeping`: one pass at a time (`sweepTempRootCollect`), over the gather and the decide-and-enqueue only.
   *  - `collectStartMono`: this lane's start (the watcher's construction), monotonic. No act job is offered until
   *    `CHILD_RECLAIM_STALL_MS` after it.
   *  - `collectGen`: the ONE counter every generation is drawn from, the lane-wide one and every id's (Task 4).
   *  - `collectLaneGen`: the lane-wide clear generation (`collectClearPairs`).
   *  - `collectState`: per id, `CollectEntry` (L1): the observation pair and its generation, the deferral count, the
   *    failing, verb-failed and terminal runs, the continuity clocks, the latest document's evidence and the feed
   *    episode. An entry is created only when a call for the id is queued.
   *  - `collectInFlight`: per id, the ONE call or job queued and not heard back on (`CollectFlight`). No further call is
   *    queued for an id in it.
   *  - `collectSlot`: the fleet-wide act slot (`CollectSlot`).
   *  - `collectUnsettledLogged`: the ids whose call this process has logged as unsettled, once.
   *  - `collectFlockLatched`: an act answered ccd's `flock-unavailable`: no act job is offered again in this process, and
   *    a box-wide line says so, so an armed lane is never silently off.
   *  - `collectLastSeenLive`: the effective live boolean as the last act job resolved it, never its source (path-identity
   *    spec 2026-10-12 §5.5). It starts SHADOWED, so an arming no job saw before a restart is still a flip, with its row.
   *  - `collectSeenEpoch`: the connection epoch the lane's observation pairs stand under (path-identity spec 2026-10-12
   *    §5.5), re-read at each pass's head and after its gather. A move clears every pair; an act job is queued under it
   *    (`collectAct`), so its executor composes nothing once the epoch it reads after its final listing differs.
   *  - `collectControlWarned`: the switch's warn latches (§5.5, `collectControlNote`): each safety-stop reason, and
   *    `marker-recreated`, warned once until a coherent resolution clears it. The latch's outcomes (`collectLatchNote`,
   *    the coordinator's extension of the warn-latch ruling) warn once under `latch-<kind>`, until a retire clears them.
   *  - `collectPop`: the last measured pass's population, for the box-wide listing and refused-name lines; `null` before
   *    one. `collectPopNames`: the registry listing that pass's pre-filter read, for attention's projection.
   *  - `collectBoxProbes`: the box-wide probes standing (through `collectBoxProbesAtArrival`: every answer but one older
   *    than their latest rebuild; the population's clear, `collectBoxAfterPopulation`, also drops them).
   *    `collectBoxProbesAtMono`: the ARRIVAL of the answer that last rebuilt them (a new map: a change, a re-assertion
   *    or an empty pass; `collectBoxProbesAtArrival`), so an answer older than that says nothing of them.
   *  - `collectPassSeq`, `collectPassTally`, `collectPassPublished`, `collectPassAudits`: each pass's audits by class
   *    (Task 5's `collectPassClass`), keyed by the pass that queued them; the latest pass whose calls have all settled is
   *    the one the pass-scoped box lines read. */
  private lastCollectSweep: number | null = null;
  private collectSweeping = false;
  private readonly collectStartMono: number;
  private collectGen = 0;
  private collectLaneGen = 0;
  private collectState = new Map<string, CollectEntry>();
  private collectInFlight = new Map<string, CollectFlight>();
  private collectSlot: CollectSlot = { kind: 'free' };
  private collectUnsettledLogged = new Set<string>();
  private collectFlockLatched = false;
  private collectLastSeenLive = false;
  private collectSeenEpoch = 0;
  private collectControlWarned = new Set<string>();
  private collectPop: CollectPopulation | null = null;
  private collectPopNames: ReadonlySet<string> = new Set();
  private collectBoxProbes: ReadonlyMap<string, string> = new Map();
  private collectBoxProbesAtMono = Number.NEGATIVE_INFINITY;
  private collectPassSeq = 0;
  private collectPassTally = new Map<number, { pending: number; readonly audits: Map<string, CollectPassClass> }>();
  private collectPassPublished = 0;
  private collectPassAudits: ReadonlyMap<string, CollectPassClass> = new Map();
  /** The mirror rows (`ChildReclaimLeafKept.source`) whose kept-leaf feed row this process has written: one
   *  row per source row per process, so a restart writes it once more. Never pruned, because an ended item
   *  never returns. */
  private readonly childReclaimLeafFed = new Set<number>();
  /** The seventh lane's clock — the journal mirror. `sweepLifecycle` below
   *  carries the lane's own docstring; this is only the clock field, same
   *  shape as `lastNameSweep`/`lastDivergenceSweep` above it. */
  private lastLifecycleSweep = 0;
  /** The claim lanes' clocks (build 9 wave 7, D12). */
  private lastClaimRenew = 0;
  private lastClaimLapse = 0;
  /** The stall lane's own clock (`STALL_SWEEP_MS`), with the same `!== 0` never-run idiom. */
  private lastStallSweep = 0;
  /** True while a `sweepStalls` pass awaits its reads. A second pass started meanwhile returns at once. */
  private stallSweepRunning = false;
  /** Wave 2's in-memory clocks, keyed by session id, pruned every sweep (`pruneStallMemory`) and dropped whole after a
   *  gap of more than STALL_CLOCK_GAP_MS between judged sweeps (`dropStallClocks`, `lastStallJudgedAt`). A server
   *  restart re-times each one, which the spec accepts (slug `absent-worker-is-dead-after-grace` (D-3631)): when a run worker
   *  was first seen with no fleet row; when it was first seen with an `orphan` or `never-started` lifecycle; when a
   *  worker's or coordinator's turn marker was first READ `unmeasured` or `malformed` (`stallMarkClock`: an unmeasured
   *  identity reads no marker, so it neither starts nor keeps that clock). */
  private stallAbsentSince = new Map<string, number>();
  private stallDeadSince = new Map<string, number>();
  private stallMarkUnreadableSince = new Map<string, number>();
  /** When the lane last FINISHED judging its candidates, or null before the first judged sweep: the gap rule's anchor
   *  (slug `stall-clocks-drop-on-an-unobserved-gap` (D-3750)). Stamped at the end of a sweep whose candidates read, never on an
   *  early return, so a slow sweep's own duration is never counted as a gap. */
  private lastStallJudgedAt: number | null = null;
  /** The run-less operator pushes already sent: each push tag (`stallPushRoute`'s) with the session it names, which
   *  the prune keys on. IN MEMORY (slug `run-less-push-latches-are-in-memory` (D-3751)): a restart re-pushes a run-less orphan D
   *  rung 2, a mail-stuck, a marker-unreadable or a coordinator's failed rung 2 to the operator while it stands. A
   *  coordinator's marker-unreadable push is keyed on its first-seen time, which a restart or a clock drop (an
   *  unobserved gap, `dropStallClocks`) re-times, so one push can go out on each side of it. Pushes only, never mail. */
  private stallLatch = new Map<string, string>();
  /** Warn-once keys, `<sessionId>|<what>`: a run-less shadow rung, `failed-unknown`, and the defensive r2-with-no-r1
   *  line (`applyStall`; no real input reaches it today). */
  private stallWarned = new Set<string>();
  /** The busy clock (stall watch settings §9, `busy-clock-starts-when-busy-delivery-starts` (D-4024)). Written by
   *  `sweepMail` alone, on a mode it applies, and read by `sweepStalls` through `stallBusyClock`. `lastApplied` is the
   *  mail gate mode last applied, `null` before the first. `busySince` is when the mail sweep moved into busy delivery
   *  from a known non-busy mode, and `null` whenever no such move has been seen since the server started. The
   *  unlistable return and the `MAIL_DISABLED_MARKER` return write neither: neither says anything about the mode, so
   *  a passing listing failure never restarts the clock. IN MEMORY: after a restart the stall sweep judges exactly as
   *  before this clock existed, until busy delivery begins again while the server runs. */
  private lastApplied: MailTurnMode | null = null;
  private busySince: number | null = null;
  /** The last settings resolution that fell back on a throw (§9): when, and why. `null` once a resolution succeeds.
   *  Read only through `stallFallback()`. */
  private lastFallback: { readonly at: number; readonly reason: string } | null = null;
  /** The settings row's warn latch (§8): the read states already warned (`absent`, `unreadable`, `level`, `quiet`),
   *  cleared when a read applies again, so a row that stays unusable warns once, not every 10 s. */
  private stallSettingsWarned = new Set<string>();
  /** Set by the first settings read that is not unreadable: the boot trace runs once (§8). */
  private stallSettingsTraced = false;
  /** The ledger lanes' clocks (build 9 wave 7, D13). */
  private lastLedgerFloor = 0;
  private lastLedgerReconcile = 0;
  /** The readiness lane's clock and its cache (program-leverage wave 3, F3).
   *  `undefined` until the first sweep lands — the same contract every other
   *  `currentX()` on this class already has, and the route turns it into a
   *  `readiness: null` on the wire rather than omitting the key. */
  private lastReadinessSweep = 0;
  private readiness: FleetReadiness | undefined;
  /** The stale set last reported, as JSON — one warn per CHANGING set, the
   *  `lastDivergenceJson` idiom, so a standing stale number is not a log
   *  line every 15 minutes forever. */
  private lastStaleReport: string | null = null;

  /** Per project, the last orphan set this sweep reported — `lastStaleReport`'s
   *  once-per-changing-set idiom, keyed because the reconcile sweep now walks
   *  every project the allocator has issued for rather than a subset of them. */
  private readonly lastOrphanReport = new Map<string, string>();
  /** Built lazily (`mirrorFor` below) as soon as a coordination database
   *  exists — NOT only on the first sweep, since `lifecycleHealth()` must be
   *  able to ask it before any sweep has run. The mirror holds the cursor,
   *  the error tally and the recorded-once gap names in memory, so there is
   *  exactly one instance per process and it must not be re-minted per tick. */
  private mirror: JournalMirror | null = null;
  /** `<project>/<name>` for the worktrees the PREVIOUS sweep found unclaimed —
   *  the census's one-interval debounce on `unregistered-worktree`, and the
   *  only cross-sweep memory this lane keeps. Empty at boot, so the first sweep
   *  after a restart reports no worktree of that kind; see `divergences`'s own
   *  note for why one interval of quiet is the right price. */
  private lastUnclaimedWorktrees: ReadonlySet<string> = new Set<string>();
  /** `<id>#<uuid>:<derived-branch>` for every pair already tried. THE DERIVED
   *  NAME, not the born slug: a title that changes while the branch is still
   *  at its born name earns exactly one fresh attempt, and a server restart
   *  earns one retry — which is the right amount, because the usual reason a
   *  rename failed is a condition a restart does not change, and the one
   *  reason it might have (a transient fleet outage) is worth one more try.
   *  Deliberately not durable: a registry marker would be state ccd has to
   *  own, write and purge on reap, for a retry budget whose entire purpose is
   *  to be forgotten.
   *
   *  KEYED ON `<id>#<uuid>`, not `<id>` alone: `<project>-<slug>` is a SLUG,
   *  recycled by `ws-reap` (`ccd:3313`), and nothing in this map is ever
   *  pruned when a row disappears — so a bare `<id>` key would let a reaped
   *  workspace's stale pairs shadow an unrelated LATER workspace that drew the
   *  same recycled slug. `r.uuid` is minted fresh by every `ws-add`, so the
   *  combined key cannot survive a slug's reap-and-redraw cycle — the same
   *  self-healing property `titleProbe` already has via a transcript path that
   *  changes with the uuid.
   *
   *  THE SAME KEY CHANGE ALSO HAPPENS WITHOUT A REAP: `ccd`'s `_sync_uuid`
   *  (`ccd:10700`) rewrites the registry's `uuid` field in place, on the SAME
   *  live session, whenever Claude Code rotates its own session uuid (a
   *  `/clear`, a compaction) — no `ws-reap`/`ws-add` cycle required. So "a
   *  server restart earns one retry", above, is not the only way a pair earns
   *  a fresh attempt without a title change: the next sweep after a uuid
   *  rotation reads a different `r.uuid`, computes a different incarnation,
   *  and finds no entry here either — the same consequence a restart has, on
   *  the process's own clock instead of one session's. */
  private attemptedRenames = new Set<string>();
  /** `<id>#<uuid>` incarnations the sweep will never spend another transcript
   *  read on. `attemptedRenames` is keyed per (incarnation, derived branch)
   *  and cannot express this: a title that keeps changing on a workspace whose
   *  branch was already pushed would keep minting fresh pairs forever, and
   *  each one earns its "one fresh attempt" — the stat gate (`claimTitleRead`)
   *  never closes on a session whose transcript is still growing. Populated
   *  only by a refusal that is permanent BY CONSTRUCTION (`PERMANENT_REFUSALS`),
   *  never by a transient one — a fleet outage or a name collision can stop
   *  being true; a pushed branch cannot become un-pushed. Review finding 1:
   *  without this, a live workspace stuck on `has-upstream` re-reads a 256 KB
   *  tail every ten seconds indefinitely, the exact cost the stat gate exists
   *  to price out. Deliberately not durable, same reasoning as
   *  `attemptedRenames`.
   *
   *  KEYED ON `<id>#<uuid>`, same reason and same recycling hazard as
   *  `attemptedRenames` above — but sharper here: this set never expires a key
   *  by (id, branch) at all, so a bare `<id>` key would silently retire every
   *  future workspace that ever draws a previously-retired slug, for the life
   *  of the process, with no log line anywhere to say why naming stopped
   *  working for that one workspace.
   *
   *  THE SAME KEYING MEANS RETIREMENT IS NOT RESTART-ONLY EITHER: a session
   *  `PERMANENT_REFUSALS` retired stays out of THIS incarnation's way for the
   *  rest of the process's life, but `_sync_uuid` rotating that session's own
   *  uuid mid-life (`attemptedRenames`'s docstring above has the mechanism) is
   *  a second, independent way to earn a fresh incarnation that was never
   *  added here — the sweep tries it again on the next tick, no server
   *  restart required. */
  private nameSweepRetired = new Set<string>();
  /** Per session: the transcript state whose title the sweep has already acted
   *  on. Same gate, for the same reason, as `SessionStream.claimAskRead`
   *  (`sessionws.ts:178-187`). */
  private titleProbe = new Map<string, { file: string; size: number; mtimeMs: number }>();
  /** Epoch ms the in-flight sweep started, or 0 when none is. A TIMESTAMP, not
   *  a boolean: see `PR_SWEEP_STUCK_MS`. */
  private prSweepStartedAt = 0;
  /** The first tick primes dialog/status state WITHOUT firing pushes, so a ccrc
   *  restart doesn't notify for every already-pending dialog / idle session. */
  private primed = false;
  private readonly cachePath: string;
  /** The sixth lane's transcript memo (§5.4) — ONE per watcher, shared across
   *  rows, keyed per `(configDir, uuid, dir)`. This lane resolves per eligible
   *  row on a 10 s clock; without the memo, every row with no transcript at its
   *  exact address would run a full uuid search on every sweep, forever. */
  private readonly transcripts: TranscriptResolver;
  /** `idle-compact-nudge` (D-5373): `<id>#<compaction key>` pairs this process has nudged or begun to nudge, written
   *  BEFORE the send, so a send in flight or a failed one is never retried. The durable half is the `nudge` feed row. */
  private readonly idleNudged = new Set<string>();
  /** The newest compaction read off each session's transcript tail, keyed by the file's path, size and mtime, so an
   *  idle session waiting on the operator costs one stat per beat, not a 1 MiB read. */
  private readonly idleNudgeTails = new Map<string, { sig: string; tail: CompactionTail }>();
  private idleNudgeRunning = false;
  private lastIdleNudgeAt = 0;
  /** The set of projects with at least one non-dead session, as of the last
   *  completed `tick()` — feeds `pushOne`'s "name the project only when more
   *  than one is active" rule. `detectDialogs` and `sweepPr`/`sweepMerged`
   *  run on their own clocks (the pane sweep runs before this tick's own
   *  `assembleFleet`; the PR sweep is a `void`-dispatched lane that can still
   *  be in flight ticks later) and neither has the current tick's session list
   *  in scope, so both read this cached, at-most-one-tick-stale set rather
   *  than recomputing the fleet — which `sweepPr` deliberately never does,
   *  since it must not block on `gh`. A push firing with last tick's project
   *  count is the honest cheap answer; the alternative (a fresh fleet read
   *  inside a lane that promises never to block) is not on offer.
   */
  private activeProjects = new Set<string>();
  /** The seventh lane's clock. */
  private lastMailSweep = 0;
  /** The ask-release lane's own clock (Task 7) — same `!== 0` never-run
   *  sentinel `lastMailSweep` above uses, gated by `ASK_SWEEP_MS`. */
  private lastAskSweep = 0;
  /** Per session: when this lane last injected. IN MEMORY BY DESIGN, and the
   *  direction of the failure is why: a restart forgets the cooldown and may
   *  deliver one message sooner than it should have. Persisting it would buy
   *  a politeness guarantee across a restart at the price of a column and a
   *  purge — the same trade `attemptedRenames` already declined (`:172-181`).
   *  The ATTEMPT budget, which protects a session from a loop rather than
   *  from a moment, IS durable: it is a column on the delivery. */
  private mailCooldown = new Map<string, number>();
  /** Session ids with a `sendPrompt` currently in flight from THIS lane —
   *  the cross-sweep single-flight guard `sweepMail` was missing (review
   *  findings 1/5). `tick()` void-dispatches `sweepMail` every
   *  `MAIL_SWEEP_MS`, and `sendPrompt` alone can run past that (four-plus
   *  seconds of its own polling, longer still behind another
   *  server-originated write holding the session's `KeyedQueue` slot — a
   *  reap, an inject, `sweepNames`) — so without this, a second sweep starting
   *  while the first is still blocked inside `sendPrompt` re-reads the SAME
   *  still-`queued`/still-`delivered` row (`markDelivered`/`backOff` have not
   *  run yet) and enqueues a SECOND send for it. Written BEFORE `sendPrompt`
   *  is called and cleared in a `finally`, same before-the-call discipline
   *  `sweepNames`'s `attemptedRenames` uses and for the identical reason —
   *  except this one must be cleared once the send resolves (attempted-once
   *  guards a lifetime; in-flight guards one send), so a `Set`, not a durable
   *  marker. IN MEMORY BY DESIGN, same reasoning as `mailCooldown` just
   *  above: a restart forgets an in-flight send along with the process that
   *  was making it, and there is nothing left to guard once the process is
   *  gone. */
  private mailInFlight = new Set<string>();
  /** Delivery ids whose `mail-gate-busy-shadow` "would deliver" line has been
   *  logged (worker stall watch §5.1). Before `mail-gate-busy` is armed, the
   *  operator checks each line against the session's transcript for 48 h, so
   *  there is one line per delivery, not one per sweep. `sweepMail` prunes it
   *  at its head to the deliveries still outstanding, due or not (a row backed
   *  off past a sweep is kept). IN MEMORY BY DESIGN, as
   *  `mailCooldown` is: a restart logs a still-held delivery once more. */
  private busyShadowLogged = new Set<number>();
  /** `emitRuns`'s own byte-equality guard, the same idiom as `lastJson`
   *  above, over `RunSummary[]` instead of `FleetSession[]`. `null` (not
   *  `'[]'`) so the very first tick with a real `coord` always emits at
   *  least once, even into an empty fleet — mirroring `lastJson`'s own
   *  initial value. */
  private lastRunsJson: string | null = null;
  /** The `coord` frame's last value and its own byte-equality guard, beside
   *  `lastRunsJson` and for the same reasons. `coord` is `null` until the first
   *  tick measures — see `currentCoord()`. */
  private coord: CoordStatus | null = null;
  private lastCoordJson: string | null = null;
  /** Child-reclamation wave 5: each LISTED registry row's `ChildMark`, off the
   *  listing `tick()` already made. `null` until the first listed tick, which is
   *  `currentCoord()`'s "never measured" and not "no children". Retained, not
   *  erased, across an unlistable tick, the same retain-don't-erase rule the
   *  fail-shut return in `tick()` applies to every map it guards. */
  private childMarks: ReadonlyMap<string, ChildMark> | null = null;
  /** The reclaim attention list (spec §5.9), as `sweepChildReclaim` last wrote it. `emitCoord` reads
   *  it on every tick; it is written in ONE place, `childReclaimPublishAttention`, on the sweep's own
   *  slower clock, so a frame never waits on a database read.
   *  - Its `terminal` and `failing` arms are derived from the lifecycle mirror by EVERY pass, so a
   *    restart does not lose them.
   *  - Its `kept` and `kept-many` arms come from the verdicts as they stand: the last judging pass's,
   *    or its kept verdicts alone after a pass that judged nothing, so a raised switch or a missing
   *    capability does not erase them.
   *  - A child has one item: a kept item replaces its failing item, and a terminal item stands. A
   *    child whose recorded verdict is `held` has no failing item; with no verdict recorded, the
   *    failing arm stands.
   *  - It is never fed by an executor answer, and never by a sweep entry (`ChildReclaimSweepEntry`).
   *  - Its `leaf-kept` items, and their `kept-many` collapse, come from the mirror on every pass that gets
   *    past the fail-shut try. They are never filtered by the listing, and they yield to any other item
   *    for the same child.
   *  - Its `collect` items come from the temp-root collector's memory, read at the same one write (spec §5.10): that lane
   *    never assigns this list, and its items reach the frame only when the child lane publishes.
   *  `[]` until the first sweep — which runs on the first tick after a restart, so the mirror arms are
   *  rebuilt within one tick, and the kept arm at the first judging pass, rather than lost. */
  private childReclaimAttentionList: readonly ChildReclaimAttention[] = [];
  /** The expiry lane's attention list (workspace lifecycle wave 3b) as `sweepArchivedExpiry` last derived it from its
   *  own memory — never child reclamation's list, so nothing that reads that one sees an expiry. `[]` until the lane's
   *  first pass. */
  private expiryAttentionList: readonly ExpiryAttention[] = [];
  /** The expiry lane's clock and memory (wave 3b): its OWN — never the child lane's map, which wave 5's chip reads.
   *  Per archived workspace, `ArchivedExpiryEntry` (L1): the instant ccd gave for THIS archive, the twice-observed
   *  sighting, the last outcome (for change-only feed rows), the in-use and failure runs and the report. IN MEMORY
   *  ONLY (review 381, F10): a restart drops the +∞ rows and the process halt (`archivedExpiryBoxRefused`), so an armed
   *  lane can ask again about a row it had stopped — each ask behind a fresh audit and ccd's in-lock re-proof. It
   *  also drops each row's `nextAskAt` (a fresh entry's is `0`) and `failures` (review 382, R6), so a tier or stuck row
   *  (normally asked every four hours) and a row backing off on the ladder are asked again within a few passes,
   *  SOONER; and it restarts the twice-observed sighting and the hour's runs, which DELAY an expiry. */
  private lastArchivedExpirySweep = 0;
  private archivedExpiryState = new Map<string, ArchivedExpiryEntry>();
  /** ONE PASS AT A TIME. `tick()` dispatches the lane with `void`, and a pass whose audits and act outlast the cadence
   *  would otherwise run beside the next one: two acts in one window, and the older pass acting on a `due` list the
   *  newer has already answered. A pass that finds another running returns at once — so at most one expiry act is
   *  ever in flight, fleet-wide, and every act's answer is folded onto the entry it was asked for. */
  private archivedExpirySweeping = false;
  /** The stop-done lane (D-5370, `stopDoneSweep.ts`): its last pass, whether one runs, its one memory (a refused
   *  stop's retry instant), the coordination serialiser `buildServer` hands it, and the process start it holds
   *  `viewer` against (presence is never persisted). */
  private lastStopDoneSweep = 0;
  private stopDoneSweeping = false;
  private readonly stopDoneMemory: StopDoneMemory = { retryAt: new Map() };
  private stopDoneSerial: (<T>(fn: () => Promise<T>) => Promise<T>) | null = null;
  private readonly stopDoneStartedAt = Date.now();
  /** `flock-unavailable`, once a box has answered it: the lane composes nothing more there (this process). */
  private archivedExpiryBoxRefused: string | null = null;
  /** THE DEAD-COORDINATOR LANE (workspace lifecycle wave 4): its clock; ONE PASS AT A TIME, the expiry lane's reason;
   *  its memory per claimant (IN MEMORY: the run of crashed passes, the backoff, the last outcome and the report — the
   *  durable half, the first-dead anchor, is `coord.db`'s `dead_claimants`); its breaker as the last pass measured it;
   *  and its attention list, which `emitCoord` reads. */
  private lastDeadCoordinatorSweep = 0;
  private deadCoordinatorSweeping = false;
  private deadCoordinatorState = new Map<string, DeadCoordinatorEntry>();
  private deadCoordinatorBreakerState: DeadCoordinatorBreaker = { tripped: false };
  /** The breaker's memory: the members it holds with every first-dead instant they have carried, released only on evidence
   *  (`breaker-remembers-its-cluster`); and the key of the trip its feed row last recorded. */
  private deadCoordinatorBreakerHeld: readonly DeadCoordinatorBreakerMember[] = [];
  private deadCoordinatorBreakerRecorded: string | null = null;
  /** The held set SURVIVES A RESTART (review 381, F1), in the breaker's TYPED STATE (D-4857, the operator's ruling 4286):
   *  `coord.db`'s `dead_coordinator_breaker_state`, read back ONCE per process at the first pass that reaches step three.
   *  Every pass that changes anything durable marks that state DIRTY alone, before any anchor changes
   *  (`markDeadCoordinatorBreakerDirty`), then writes the exact held snapshot, every anchor change and the state CLEAN in
   *  ONE transaction (`commitDeadCoordinatorBreakerState`), with the `run_events` record of a changed set inside it. Only
   *  a commit that landed lets the pass act, or moves what this process knows was committed. A state that reads anything
   *  but `sealed` (D-4916: clean, dirty, absent or unreadable) seeds the conservative hold (review 382, R2): every claimant
   *  the pass does not release, FLAGGED (a wildcard in the breaker, which HOLDS only when two or more stand unreleased; one
   *  alone only has its hour restarted), beside every member, instant and flag of the snapshot it can still read.
   *  `Seeded` is that once; `CommittedKey` is the key of the snapshot the last landed commit wrote (`''` until one lands
   *  or a sealed state is read: it matches no set's key); `DurableClean` says this process knows the state reads clean;
   *  `AnchorsPending` holds the anchor changes a commit has not landed yet (`null`: a staged delete), re-sent by the next
   *  commit and laid over the durable anchors meanwhile, so a retry is idempotent; `HeldRunId` is the run the last
   *  `run_events` record sits on (where an empty set is written). */
  private deadCoordinatorBreakerSeeded = false;
  private deadCoordinatorBreakerCommittedKey = '';
  private deadCoordinatorBreakerDurableClean = false;
  private deadCoordinatorAnchorsPending = new Map<string, DeadAnchor | null>();
  private deadCoordinatorBreakerHeldRunId: number | null = null;
  /** THE SEAL (fix round 5, D-4916; the operator's choice of 2026-10-13, "Seal on clean shutdown"). A start trusts the
   *  stored snapshot ONLY when it reads `sealed`; `Generation` is the generation of the row this process last read or wrote;
   *  `UnsealPending` is a sealed start's first-pass duty, writing `clean` back (retried each pass until it lands); `Landed`
   *  says a write of THIS process has landed (the unseal, or a dirty mark): until it has, the `unchanged` fast path is
   *  refused and nothing seals, and a sealed start writes no breaker state or anchor beyond its unseal (a tripping pass may
   *  still write its feed row) and acts on nothing until its unseal has landed (a later mark does not count in its place: R1.5); `Sealed` says this process's seal landed; `Stopped` is set by the first seal attempt, after
   *  which no pass runs; `PassRun` is the pass in flight, which a seal attempt awaits with a bound. */
  private deadCoordinatorBreakerGeneration: number | null = null;
  private deadCoordinatorBreakerUnsealPending = false;
  private deadCoordinatorBreakerUnsealWarned = false;
  private deadCoordinatorBreakerLanded = false;
  private deadCoordinatorBreakerSealed = false;
  private deadCoordinatorStopped = false;
  private deadCoordinatorPassRun: Promise<void> | null = null;
  private deadCoordinatorAttentionList: readonly DeadCoordinatorAttention[] = [];
  /** The coordination serialiser's sweep handle (`CoordRoutesHandle.withSweepAbandon`), handed over by `buildServer`
   *  once `registerCoordRoutes` has built it. Until then the lane measures and records, and ends nothing. */
  private deadCoordinatorSerial: CoordRoutesHandle['withSweepAbandon'] | null = null;
  /** `emitPools`'s byte-equality guard and last measured value — `lastCoordJson`
   *  and `coord`'s idiom, for their reasons. `null` until a tick has measured,
   *  and `currentPools()` sends NOTHING while it is: a fabricated empty map
   *  would claim this process had looked at the fleet host's registry. */
  private lastPoolsJson: string | null = null;
  private pools: ProjectPoolsWire | null = null;
  /** Watermark: the highest `mail_deliveries.id` this lane has already
   *  raised a `mail` NotifyEvent for. Seeded to the CURRENT max id on the
   *  priming tick (`tick()`'s own `!this.primed` arm) rather than left at 0,
   *  so a restart does not replay a notify for mail queued before this
   *  process started — the same "no storm on boot" courtesy `prevStatus`
   *  gives the `done` push above, and spec's own restart semantics name by
   *  name: "the primed-quiet rule... extends to the mail lane." */
  private lastMailNotifyId = 0;
  /** Same watermark discipline as `lastMailNotifyId`, over `run_events.id`
   *  for the `run` NotifyEvent lane. */
  private lastRunNotifyId = 0;
  /** C0.1: `tick()` had NO re-entrancy guard — `start()` fires it every
   *  `intervalMs` off a bare `setInterval`, unconditionally, so a tick still
   *  in flight past the next interval edge (a slow agent-WS registry read, a
   *  wedged pane capture) got a SECOND tick stacked on top of it: two
   *  concurrent full registry reads, two concurrent `assembleFleet`s, twice
   *  the load on exactly the path that was already slow. Mirrors
   *  `SessionStream.ticking` (`sessionws.ts`) verbatim — same field, same
   *  set/clear-in-finally discipline, for the identical reason. */
  private ticking = false;
  /** C0.4-followup: true once a snapshot write has been skipped because the
   *  shrink guard below could not confirm every id that dropped out of this
   *  tick's assembly was a GENUINE purge (see the guard's own comment).
   *  Cleared the moment a write actually lands (growth, an unchanged size, or
   *  a confirmed shrink) — so a refusal warns ONCE per stretch of refusals,
   *  not once per 2-second tick for however long a read fault or a slow purge
   *  confirmation lasts, while still guaranteeing the freeze this field is
   *  named after can never be silent. */
  private snapshotWriteSkippedWarned = false;
  /** Same warn-once-per-episode discipline as `snapshotWriteSkippedWarned`
   *  immediately above, on its OWN flag (Task 2): a shrink-episode and a
   *  degrade-episode are independent conditions — a tick can trip one, the
   *  other, both, or neither — and sharing one flag would let whichever
   *  fires first silence the other's own first warning. Cleared the moment a
   *  write actually lands with every row measured clean. */
  private snapshotWriteSkippedDegradedWarned = false;

  constructor(private deps: Deps, private bus: Bus, private intervalMs = 2000, cachePath?: string) {
    this.cachePath = cachePath ?? deps.stateCachePath ?? defaultCachePath();
    this.transcripts = new TranscriptResolver(deps.io);
    this.headsSettled = new Promise<void>((resolve) => { this.settleHeads = resolve; });
    // The collector lane's start (spec §5.10): its act hold-off counts from here, on the lane's monotonic clock.
    this.collectStartMono = deps.monotonicMs?.() ?? performance.now();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * The server-caps write (D-5232's mechanism; plan 2026-10-16 Task 9b; spec §6.1): on a `server` or `both` node, the
   * words this server advertises, at this process's clock, into `<ccrcDir>/server-caps`, the file the fleet's hook
   * gates on. A `fleet`-role server writes nothing (`ccd-update-sync` is that node's writer) and answers null.
   * Single-flight: a beat that finds a write in flight joins it. A failure warns once per change of `code`.
   */
  serverCapsNow(): Promise<WriteServerCapsResult | null> {
    if (this.serverCapsRun !== null) return this.serverCapsRun;
    this.lastServerCapsAt = Date.now();
    const { role, ccrcDir } = this.deps.cfg;
    if (role !== 'server' && role !== 'both') return Promise.resolve(null);
    const run = writeServerCaps(ccrcDir, SERVER_CAPS, Math.floor(Date.now() / 1000)).then((r) => {
      const key = r.ok ? null : `${r.why}:${r.code ?? 'none'}`;
      if (!r.ok && key !== this.lastServerCapsWhy) {
        console.warn(`ccrc-server: could not write ~/.ccrc/server-caps (the fleet hook's gated arms stay off until it is written): ${r.detail}`);
      }
      this.lastServerCapsWhy = key;
      return r;
    }).finally(() => { this.serverCapsRun = null; });
    this.serverCapsRun = run;
    return run;
  }

  /** Resolves once no server-caps write is in flight. For a caller that fired the beat and must read its result. */
  async serverCapsSettled(): Promise<void> {
    if (this.serverCapsRun !== null) await this.serverCapsRun;
  }

  /**
   * The inventory lane's ONE run (design 2026-09-20 §8). The minute gate in
   * `tick()`, the `ready` trigger in `index.ts` and `GET /api/updates`
   * (Task 13, before the first sweep) all JOIN the run in flight rather than
   * start a second: at boot the first tick and the first `ready` routinely
   * coincide, and a second sweep would re-read fourteen files to learn
   * nothing. Resolves `[]` on a server with no coord store.
   */
  inventoryNow(): Promise<SweepOutcome[]> {
    if (this.inventoryRun !== null) return this.inventoryRun;
    this.lastInventoryAt = Date.now();
    const run = this.runInventory().finally(() => { this.inventoryRun = null; });
    this.inventoryRun = run;
    return run;
  }

  /** C2, reworded by re-review finding 1 (final fix wave): C1 gave each
   *  connection's own measurement+apply its own try/catch, and
   *  `sweepThenProject` already catches a `resolveAndProject` throw
   *  separately (as a projection warning, never a rejection) — so a
   *  rejection THIS reads is now a throw from OUTSIDE both of those: a bug in
   *  this dispatch/warn plumbing itself, not the ordinary "coord.db is locked"
   *  case, which `warnInventoryIssues`'s `error` arm names instead. Still not
   *  silent either way: warned once per DISTINCT message, quiet while the
   *  same cause repeats, and re-armed (by the caller, on the next clean
   *  settle) after a recovery. */
  private warnInventoryRejected(err: unknown): void {
    // Deduped on the MESSAGE, never the stack: two throws of the very same
    // condition from two different call sites (or two turns of one retry
    // loop) carry two different stacks, which would defeat the dedupe.
    const message = err instanceof Error ? err.message : String(err);
    if (message !== this.lastInventoryRejectWarn) {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.warn('ccrc-server: the inventory sweep rejected — a throw outside the per-row ' +
        `measurement+apply catch (C1) or the projection path (both are their own arms/warnings): ${detail}`);
      this.lastInventoryRejectWarn = message;
    }
  }

  /** Fire-and-forget `inventoryNow()`, shared by `tick()`'s minute gate and
   *  `triggerInventory()`. Reworded by re-review finding 1 (final fix wave):
   *  a rejection here is now the NARROW case, not the ordinary one — C1 gave
   *  each connection's own measurement+apply its own try/catch (a throw
   *  there is the `error` `SweepOutcome` `warnInventoryIssues` names), and
   *  `sweepThenProject`'s own try/catch around `resolveAndProject` turns a
   *  throw there into a projection warning, never a rejection either. What
   *  reaches here is a throw from OUTSIDE both — a bug in this dispatch/warn
   *  plumbing itself. Still warned, deduped (C2), never swallowed silently;
   *  the dedupe key clears on the next clean settle, so a NEW cause after a
   *  recovery warns again. */
  private dispatchInventorySweep(): Promise<void> {
    return this.inventoryNow().then(
      () => { this.lastInventoryRejectWarn = null; },
      (err: unknown) => { this.warnInventoryRejected(err); },
    );
  }

  /** For a caller that must not wait: the `ready` hook runs inside the
   *  client's handshake handler.
   *
   *  C4: a caller that JOINS a sweep already in flight sets a one-shot rerun
   *  flag rather than trusting the joined run to reflect whatever changed
   *  between the join and the in-flight sweep's own read of it (the case
   *  this exists for: a `ready` arriving while a sweep that already read the
   *  connection as disconnected is still running its resolve/project tail).
   *  The flag is checked and cleared ONCE the run settles, so a run of
   *  joiners produces exactly one rerun, never a queue. */
  triggerInventory(): void {
    if (this.inventoryRun !== null) this.inventoryRerunPending = true;
    void this.dispatchInventorySweep().finally(() => {
      if (this.inventoryRerunPending) {
        this.inventoryRerunPending = false;
        this.triggerInventory();
      }
    });
  }

  /**
   * The dispatcher's ONE run (design 2026-09-20 §10), single-flight. Called at the end of every inventory run
   * (`sweepThenProject`) and by the update routes after every intent and request write. A call while a run is
   * in flight JOINS it and asks for exactly one follow-up; otherwise it starts a run SYNCHRONOUSLY — the run's
   * plan and lease acquire happen in the caller's own turn, so a route's reply already reads `pending`.
   */
  dispatchNow(): Promise<DispatchRunResult> {
    if (this.dispatchRun !== null) {
      this.dispatchAgain = true;
      return this.dispatchRun;
    }
    // `.finally`, not `.then` — it must clear `dispatchRun` whether this run resolves OR rejects. A `.then`
    // success-only callback would never run on a rejection, so a single thrown run would leave the single-flight
    // field set forever and nothing would dispatch again until restart (review finding 1).
    const run = this.dispatchOnce().finally(() => {
      this.dispatchRun = null;
      if (this.dispatchAgain) {
        this.dispatchAgain = false;
        this.triggerDispatch();
      }
    });
    // D-3493 — the update lanes' rule at the tip: a rejection is warned, never swallowed. Attached ONCE, here, at
    // the run's own creation — never inside `triggerDispatch`, which every caller that JOINS this same run also
    // calls: a `.catch` there would fire once per joiner, logging one rejection N times (review finding 2).
    void run.catch((err: unknown) => {
      console.warn(`ccrc-server: a dispatch run rejected: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    });
    this.dispatchRun = run;
    return run;
  }

  /** For a caller that must not wait: the inventory run's tail, a route's reply. Fire-and-forget only —
   *  `dispatchNow` itself attaches the rejection log to the run it creates (see above), so this must not attach
   *  a second one. */
  triggerDispatch(): void {
    void this.dispatchNow();
  }

  /** The act's deps, built from this process's Deps — the ONE place they are assembled. The server's own
   *  update.json is read through `localIO` in both modes (`deps.io` is the FLEET box's io in remote mode). */
  private async dispatchOnce(): Promise<DispatchRunResult> {
    const coord = this.deps.coord;
    if (coord === undefined) return { ran: false, why: 'no-coord' };
    const { cfg, fleetState, sendUpdateOp, updateRunner } = this.deps;
    return runDispatch({
      store: coord, role: cfg.role, ccrcDir: cfg.ccrcDir, localIo: localIO, deadlineMs: cfg.updateDeadlineMs,
      fleet: sendUpdateOp !== undefined && fleetState !== undefined ? { state: fleetState, send: sendUpdateOp } : null,
      runLocal: updateRunner ?? null,
      onAccepted: () => this.triggerInventory(),
      recordMove: (r) => { this.recordMoveFeed(r); },
    }, Date.now());
  }

  /** Wave 8 item A: a move's audit row, through pushOne's own record path (the ring, its flush, and the durable feed
   *  archive behind its guarded `recordFeedEvent`). Never a push (`recordOnly`), never gated on presence
   *  (`recordAlways`); about no session and no run. It decides nothing. */
  private recordMoveFeed(r: MoveFeedRecord): void {
    this.pushOne({
      kind: 'update', sessionId: '', project: '', title: r.title, body: r.body, runId: null,
      recordAlways: true, recordOnly: true,
    }, this.activeProjects);
  }

  /** C3 (final fix wave): D-3211 says a node-id collision "is named", but the
   *  sweep's `SweepOutcome[]` was discarded by both callers — nothing ever
   *  printed it. Warns each `node-id-collision`, each `refused` and each
   *  `error` outcome ONCE per (label, nodeId-or-why-or-message) tuple: a
   *  tuple already warned about stays quiet while it repeats, and warns
   *  again if it clears (the row measures cleanly for at least one sweep)
   *  and later recurs.
   *
   *  The `error` arm (re-review finding 1, final fix wave): C1's per-row
   *  isolation turns EVERY throw from a connection's own measurement+apply —
   *  a locked/corrupt coord.db, but just as much a real bug in
   *  `measurementFrom`/`applyMeasurement` — into this outcome, and nothing
   *  else reads `SweepOutcome` for it (`sweepThenProject`'s own try/catch is
   *  scoped to `resolveAndProject`, a DIFFERENT call). Before C1 such a
   *  throw rejected `sweepInventory` and `dispatchInventorySweep`'s own
   *  `warnInventoryRejected` named it; after C1 it resolves quietly unless
   *  named HERE. Deduped on `error:<label>:<message>`, same clear-and-recur
   *  rule as the other two arms.
   *
   *  Called from `sweepThenProject`, the one place both `tick()`'s minute
   *  gate and `triggerInventory()`'s `ready` hook funnel through (both reach
   *  it via `inventoryNow()` -> `runInventory()`). */
  private warnInventoryIssues(outcomes: readonly SweepOutcome[]): void {
    const keys = new Map<string, string>();
    for (const o of outcomes) {
      if (o.result === 'node-id-collision') {
        keys.set(`collision:${o.label}:${o.nodeId}`,
          `ccrc-server: update inventory — ${o.label}'s connection measured node-id ${o.nodeId}, already ` +
          'the key of a live row under another label; kept as two rows rather than merged (D-3211)');
      } else if (o.result === 'refused') {
        keys.set(`refused:${o.label}:${o.why}`,
          `ccrc-server: update inventory — ${o.label}'s sweep was refused: ${o.why}`);
      } else if (o.result === 'error') {
        keys.set(`error:${o.label}:${o.message}`,
          `ccrc-server: update: inventory row ${o.label} failed: ${o.message}`);
      }
    }
    for (const [key, message] of keys) {
      if (!this.lastInventoryIssues.has(key)) console.warn(message);
    }
    this.lastInventoryIssues = new Set(keys.keys());
  }

  /** Builds the sweep's deps and calls sweepThenProject, the file's one caller
   *  of sweepInventory, inside inventoryNow()'s single flight. The server's
   *  own row is read through `localIO` in both modes — `deps.io` is the FLEET
   *  box's io in remote mode. */
  private async runInventory(): Promise<SweepOutcome[]> {
    const coord = this.deps.coord;
    if (coord === undefined) return [];
    const { cfg, fleetState } = this.deps;
    // Path-identity spec 2026-10-12 §5.2: the one identity cell goes to the sweep that measures the fleet node. In
    // remote mode the agent connection's sweep publishes into it, and the server's own row never does. In local mode
    // this box IS the fleet node, so its own sweep publishes into the never-invalidated cell. Absent: nothing is
    // published.
    const inv: InventoryDeps = {
      store: coord, localIo: localIO, ccrcDir: cfg.ccrcDir, role: cfg.role,
      fleet: cfg.fleetMode === 'remote' && fleetState !== undefined
        ? { io: this.deps.io, state: fleetState, identity: this.deps.fleetIdentity } : null,
      ownIdentity: cfg.fleetMode === 'remote' ? undefined : this.deps.fleetIdentity,
    };
    return this.sweepThenProject(inv, Date.now());
  }

  /** Fix round 1 (F3/F4, D-3314 amended): true only when THIS sweep's outcomes are a real write — the row
   *  was upserted, not merely marked unreachable, refused, or lost to a throw. Fix round 2: looked up by
   *  `label` (`SERVER_LABEL`/`FLEET_LABEL`, every `SweepOutcome`'s own field), never by array position —
   *  `sweepInventory` has always ordered `[own, fleet?]`, but a lookup by label reads the same regardless of
   *  that ordering, matching how every OTHER outcome reader in this file (`warnInventoryIssues`,
   *  `unreachable()`'s own callers) already keys on `label`. Local mode has no fleet row to demand — the
   *  server row alone opens the gate. */
  private sweptEnoughToDecide(inv: InventoryDeps, outcomes: readonly SweepOutcome[]): boolean {
    const wasMeasured = (label: string): boolean => {
      const o = outcomes.find((x) => x.label === label);
      return o !== undefined && (o.result === 'measured' || o.result === 'node-id-collision');
    };
    if (!wasMeasured(SERVER_LABEL)) return false;
    return inv.fleet === null || wasMeasured(FLEET_LABEL);
  }

  /** One inventory run (design 2026-09-20 §9): the sweep, then the resolver over every live row and the
   *  server-role projection — so the file's `lease` is refreshed on the sweep's 60 s beat. Called ONLY from
   *  `runInventory()`, i.e. inside `inventoryNow()`'s single-flight promise, so a ready-triggered run and the
   *  tick's are ONE sweep. The single-flight is not what orders the writers, though: the update routes'
   *  `reproject` (Task 13) calls `resolveAndProject` without the watcher, and it is `resolveAndProject`'s own
   *  per-directory queue that keeps this run and a route's from interleaving two writers of the resolved
   *  columns or of the file. A resolve failure is warned and never loses the sweep's outcomes. The warning
   *  is deduped on `projectionWarn`'s stable `key` (fix round 1, finding 1) — never on the message text,
   *  which for an `unwritable` result embeds the tmp path's pid and timestamp and so never repeats. */
  private async sweepThenProject(inv: InventoryDeps, now: number): Promise<SweepOutcome[]> {
    const outcomes = await sweepInventory(inv, now);
    this.warnInventoryIssues(outcomes);
    const coord = this.deps.coord;
    if (!coord) return outcomes;
    let warn: { key: string; message: string } | null;
    try {
      const run = await resolveAndProject({ store: coord, role: this.deps.cfg.role, ccrcDir: this.deps.cfg.ccrcDir }, now);
      warn = projectionWarn(run.projection);
    } catch (e) {
      const code = errnoOf(e);
      warn = {
        key: code !== null ? `threw:${code}` : 'threw',
        message: `the resolve run threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const key = warn?.key ?? null;
    if (warn !== null && key !== this.lastProjectionWhy) {
      console.warn(`ccrc-server: update: this server's own ~/.ccrc/update-intent was not written (${warn.message})`);
    }
    this.lastProjectionWhy = key;
    // Plan W3 Task 3: the inventory run MEASURES what the nodes run, so it is where a release every node
    // already runs is marked instead of pushed (D-3294), where the first release after a
    // fresh install is decided at all (D-3300), and what opens the catalogue
    // side's decisions in this process — fix round 1 (F3/F4, D-3314 amended):
    // `inventorySwept` opens only once THIS sweep actually rewrote what the push decides on — the server's
    // own row written without a throw or refusal, AND (in remote mode) the fleet row measured by this
    // process, never merely marked unreachable. A link-down sweep or a `sweepOwn` throw leaves it closed, so
    // the direct call below — the same hazard `pushReleaseAfterPoll` guards for the catalogue lane — is
    // skipped too, rather than deciding on rows this process never wrote.
    if (this.sweptEnoughToDecide(inv, outcomes)) this.inventorySwept = true;
    if (this.inventorySwept) this.pushRelease(now);
    // Wave 5 (design 2026-09-20 §10): the sweep is what settles a lease, so every inventory run ends in ONE
    // dispatch run — the next node's turn starts on the beat that freed it.
    this.triggerDispatch();
    return outcomes;
  }

  /**
   * The release push (design 2026-09-20 §13; plan W3 Task 3): ONE Web Push per release tag, across restarts.
   * Called at the end of every inventory run (`sweepThenProject`) and, through `pushReleaseAfterPoll`, after
   * every catalogue poll — `tick()`'s catalogue gate and `POST /api/updates/refresh` (`update/routes.ts`), the
   * *Check now* poll, which runs outside `tick()`. PUBLIC for those callers and for the tests — the
   * `inventoryNow()` precedent.
   *
   * SYNCHRONOUS, and that is the dedup. The decision (`releaseToNotify`, pure) and the mark
   * (`markReleaseNotified`, whose `WHERE notifiedAt IS NULL` makes a second marker lose) run with no `await`
   * between them, so nothing else in this process — the other lane, a second tick — can interleave, and a
   * restarted process reads the committed `notifiedAt`. `mergedNotified`'s in-memory `Set` is the shape this
   * deliberately is not: a latch that forgets on restart repeats the push.
   *
   * The send starts only AFTER the mark committed, is `void`ed and is never retried
   * (D-3295): at most once, because a repeated "vX is out" is the noise the persisted
   * mark exists to stop, and a missed one is still shown by the banner and the settings screen.
   *
   * Sessionless (D-3296): no `sessionId`, no presence gate, no `NotifyLog` or feed record —
   * `pushOne` is about a session and this is about the fleet. A server-role process only: the push
   * subscriptions are this box's disk (`push.ts`'s header), and the notify mode is the fleet row's alone.
   * With no push service (no VAPID keys — `index.ts` builds `push` only then) it decides and marks NOTHING:
   * a mark with no sender would answer `pushed` for a push nobody sent and use the tag up for good, so a
   * sender configured later could never announce it.
   * Never throws: a store failure is the `failed` arm, so no caller's `.catch` (a lane's, or the refresh route's
   * request) is ever what stops it.
   */
  pushRelease(now: number): ReleasePushOutcome {
    const coord = this.deps.coord;
    if (coord === undefined) return { did: 'skipped', why: 'no-coord' };
    const role = this.deps.cfg.role;
    if (role !== 'server' && role !== 'both') return { did: 'skipped', why: 'not-server-role' };
    const sender = this.deps.push;
    if (sender === undefined) return { did: 'skipped', why: 'no-push-service' };
    let n: ReleaseNotification | null;
    let marked: MarkReleaseNotifiedResult;
    let summary: string;
    try {
      const fleetIntent = coord.intentFor(FLEET_SCOPE);
      const nodes = coord.nodes();
      n = releaseToNotify({ fleetIntent, releases: coord.releases(), nodes });
      if (n === null) {
        this.lastReleasePushFailure = null;
        return { did: 'skipped', why: 'nothing-to-notify' };
      }
      marked = coord.markReleaseNotified(n.tag, now);
      // Fix round 1 (F1/F14, D-3313/D-3316): sides are picked from EVERY live row — filtering first is what
      // let a `both` server row's own version stand in for a fleet nobody measured (the reviewer's exact
      // rows). `stated` carries the per-row "does this reading vouch for its version" fact — EVER measured
      // (W5 review 161, F-I: `measuredAt` is a persisting stamp, not "measured THIS sweep"), its stamp read,
      // and (D-3316) reachable — so an occupying row that fails it renders as a dash,
      // never its stale value, but still blocks another row from falling back into its side. On a remote
      // fleet (D-3313) a `both` row is THIS box, never the fleet box; local mode's one `both` row genuinely
      // is both (D-3301).
      const summaryRows = nodes.map((r) => ({ role: r.role, version: r.currentVersion, stated: statedOf(r) }));
      const sides = this.deps.cfg.fleetMode === 'remote' ? remoteSides(summaryRows) : versionSides(summaryRows);
      summary = summaryFromSides(sides);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      if (detail !== this.lastReleasePushFailure) console.warn(`ccrc-server: update: the release push was not decided (${detail}) — nothing was marked or sent`);
      this.lastReleasePushFailure = detail;
      return { did: 'failed', detail };
    }
    this.lastReleasePushFailure = null;
    if (!marked.ok) return { did: 'refused', tag: n.tag, why: marked.why };
    if (!n.push) return { did: 'marked', tag: n.tag };
    const copy = releasePushCopy(n, summary);
    const payload: PushPayload = { title: copy.title, body: copy.body, tag: copy.tag, url: copy.url };
    const tag = n.tag;
    const sending = sender.notify(payload);
    void sending.catch((e: unknown) => {
      console.warn(`ccrc-server: update: the release push for ${tag} did not send (${e instanceof Error ? e.message : String(e)}) — it is not retried; the banner and the settings screen still show the release`);
    });
    return { did: 'pushed', tag, payload };
  }

  /**
   * The catalogue side's entry (plan W3 Task 3): `tick()`'s catalogue gate and `POST /api/updates/refresh`
   * call this, never `pushRelease` directly. It decides only once THIS process's own sweep has actually
   * REWRITTEN the rows it decides on (D-3314) — not merely once an inventory run has finished (W5 review
   * 161, F-H: a finished run whose write was refused, errored or left the row merely marked unreachable
   * leaves `inventorySwept` closed too; `sweptEnoughToDecide` is the exact gate). Both lanes fire unawaited
   * on the first tick after a start, and
   * until the first sweep rewrites them the `nodes` rows are the previous process's. After a server-box update
   * they still carry the version the update replaced, so a poll that resolves first would push "vX is out" to
   * a fleet already on vX. The inventory run's own `pushRelease` call makes that first decision instead.
   */
  pushReleaseAfterPoll(now: number): ReleasePushOutcome {
    if (!this.inventorySwept) return { did: 'skipped', why: 'not-yet-swept' };
    return this.pushRelease(now);
  }

  /**
   * The set of session ids that currently have a pending menu dialog. Exposed
   * so a one-shot fleet assembly (the /api/fleet REST, and the /ws/fleet push
   * on a connect before this watcher's first broadcast — after it, the cold
   * frame IS that broadcast, `currentFleet`) can reflect an ALREADY-pending
   * dialog. Without this, a
   * dialog that appeared before a client connected shows no "needs you" marker
   * on the fleet overview: the initial push omits it and the watcher only
   * re-emits 'fleet' when the JSON *changes*, so an unchanged pending state is
   * never resent to the newcomer.
   */
  currentPending(): Set<string> {
    return new Set(this.dialogIds.keys());
  }

  /** The fleet this watcher last BROADCAST, or null before its first. A new
   *  /ws/fleet socket takes it as its cold frame: it is exactly what every
   *  connected client already holds, and this watcher re-emits only on change,
   *  so a cold frame assembled apart from it — from state captured at connect,
   *  or off a registry listing that failed once — was never corrected. */
  currentFleet(): FleetSession[] | null {
    return this.lastFleet;
  }

  /** Last-seen statuslines — passed into a one-shot fleet assembly (REST +
   *  initial /ws/fleet push) so model/effort/ultracode/branch show immediately,
   *  same reasoning as currentPending(). */
  currentStatuslines(): Map<string, Statusline> {
    return new Map(this.statuslines);
  }

  /** Last-measured worktree HEAD branches — passed into a one-shot fleet
   *  assembly (REST + initial /ws/fleet push) so a narrow pane's label shows
   *  its checked-out branch immediately. Same reasoning as currentPending(). */
  currentHeadBranches(): Map<string, string | null> {
    return new Map([...this.headBranches].map(([id, h]) => [id, h.branch]));
  }

  /** The delegation lane's input from the last census pass (see `delegationCensus`). */
  currentDelegationCensus(): DelegationCensusPass | null {
    return this.delegationCensus;
  }

  /** The delegation lane (wave 3, Task 13; see `DelegationLane`), made on first use: a parameter property is not yet assigned when a
   *  field initialiser runs, so it cannot be built beside the other fields. */
  private delegationLaneMemo: DelegationLane | null = null;
  private delegationLane(): DelegationLane {
    this.delegationLaneMemo ??= new DelegationLane(this.deps, () => this.delegationCensus);
    return this.delegationLaneMemo;
  }

  /** One pass of the delegation lane. PUBLIC for the reason `sweepNames` is: `tick()` dispatches it with `void`, so a test that awaits
   *  `tick()` has not awaited it. A no-op without a coordination database, inside the census cadence, or while a pass is running. */
  sweepDelegation(sessions: readonly LaneSession[], records: readonly LaneRecord[]): Promise<void> {
    return this.delegationLane().sweep(sessions, records);
  }

  /** The seven-day observation health, as of now, from the checkpoint's own intervals. `undefined` until the lane has tried to open its
   *  applier: absence on the wire reads as UNKNOWN, never as healthy. */
  currentDelegationHealth(): DelegationObservationHealth | undefined {
    return this.delegationLane().health();
  }

  /** What the lane last concluded, for tests and diagnostics: nothing here is wire. */
  delegationReport() {
    return this.delegationLane().report();
  }

  /** The lane's durable applier, opened on first use (null when the open itself failed). */
  delegationApplier(): Promise<DelegationDurability | null> {
    return this.delegationLane().applier();
  }

  /** Test seams of the delegation lane (see `DelegationLaneSeams`); production passes none. */
  setDelegationSeams(seams: DelegationLaneSeams): void {
    this.delegationLane().setSeams(seams);
  }

  /** Closes the delegation applier's journal descriptor, if it was ever opened (tests, and a clean shutdown). */
  closeDelegation(): Promise<void> {
    return this.delegationLaneMemo === null ? Promise.resolve() : this.delegationLaneMemo.close();
  }

  /** Whether `tick()`'s registry read listed. The health reads it as of the request: an unreadable registry is an unmeasured basis. */
  noteDelegationRegistry(listed: boolean): void {
    this.delegationLane().noteRegistry(listed);
  }

  /** Last-swept plan progress — same reasoning as currentPending(). */
  currentTaskProgress(): Map<string, TaskProgress> {
    return new Map(this.taskProgress);
  }

  /** Last-swept PR state — passed into a one-shot fleet assembly (REST +
   *  initial /ws/fleet push) so the cap is right immediately rather than two
   *  minutes late. Same reasoning as currentPending(). */
  currentPrStates(): Map<string, PrState> {
    return new Map(this.prStates);
  }

  /** Last-measured repo cell per project, for `GET /api/projects`. Same
   *  reasoning as `currentPrStates()`'s own copy: a caller must not be able to
   *  mutate this watcher's internal map through what it hands back. */
  currentProjectRepos(): Map<string, ProjectRepoWire> {
    return new Map(this.projectRepos);
  }

  /** Last-read hook state — passed into a one-shot fleet assembly (REST +
   *  initial /ws/fleet push) so an already-waiting hook state shows
   *  immediately. Same reasoning as currentPending(). */
  currentHookStates(): Map<string, HookState> {
    return new Map(this.hookStates);
  }

  /** The last measured marker state, for `/ws/fleet`'s cold start. `null` means
   *  THIS PROCESS HAS NEVER MEASURED — a socket that connects before the first
   *  tick is sent no `coord` frame at all, because inventing `clear` there
   *  would tell the phone the fleet is running on a box nothing has looked at.
   *  That is a different fact from `unmeasurable`, which is a measurement that
   *  came back unreadable. Same reasoning as currentPending(). */
  currentCoord(): CoordStatus | null {
    return this.coord;
  }

  /** The child marks off the last LISTED registry read, for `GET /api/runs`'s
   *  reclaim chip (wave 5), or null when no tick has listed one. In memory, and
   *  the reason is cost: a route-time `readRegistry` is ~721 agent-WS operations
   *  per board load in remote mode. */
  currentChildMarks(): ReadonlyMap<string, ChildMark> | null {
    return this.childMarks;
  }

  /** Child-reclamation wave 6 (spec §5.9): the journal mirror's newest
   *  committed reclaim end, or null when no mirror exists yet or it has
   *  committed none. In memory; read by `emitCoord` alone. */
  currentChildReclaimDoneAt(): number | null {
    return this.mirror?.childReclaimDoneAt() ?? null;
  }

  /** The collector lane's memory, read-only (child reclamation wave 9, spec §5.10) — for its tests. No decision outside
   *  the lane reads it. */
  currentCollectLane(): {
    readonly entries: ReadonlyMap<string, CollectEntry>; readonly inFlight: ReadonlyMap<string, CollectFlight>;
    readonly slot: CollectSlot; readonly laneGen: number; readonly lastSeenLive: boolean; readonly flockLatched: boolean;
  } {
    return { entries: this.collectState, inFlight: this.collectInFlight, slot: this.collectSlot,
      laneGen: this.collectLaneGen, lastSeenLive: this.collectLastSeenLive, flockLatched: this.collectFlockLatched };
  }

  /** The collector switch's counts (path-identity spec 2026-10-12 §5.7), for `GET /api/coord/collect-lane`'s view:
   *  would collect, held (unvouched ids among them) and the box-wide lines, by L1's `collectLaneCounts` over the input
   *  builder the published items use (`collectAttentionInput`), read at request time, not their snapshot. `null` until a
   *  pass has measured a population, which means "not measured yet", never zero. It adds no state; the PWA counts nothing. */
  currentCollectCounts(): CollectLaneCounts | null {
    if (this.collectPop === null) return null;
    return collectLaneCounts(this.collectAttentionInput());
  }

  /** The sweep's in-memory state, read-only (child-reclamation wave 4) — what
   *  wave 5's run chip reads to tell `deferred` from `pending`. Empty after a
   *  restart, by design: see `childReclaimSweepState`'s own docstring. Its
   *  `firstDeferredAt` is wall-clock epoch ms, the one field a reader outside the lane may
   *  read as a time. `lastPresenceWallAt` (wall clock) and `bornAt` (ccd's clock, compared for
   *  equality only) are the lane's own; every other clock in it is this process's monotonic clock. */
  currentChildReclaimDefers(): ReadonlyMap<string, ChildReclaimSweepEntry> {
    return this.childReclaimSweepState;
  }

  /** The sweep's last verdict per marked child, for `GET /api/runs`' chip (spec §5.9). TWO answers
   *  that are never folded:
   *  - `null` is "no verdict yet" for every child: no judging pass since this process started.
   *  - A map is the last judging pass's verdicts, or — after a pass that judged nothing (the
   *    switch, a missing capability, a failed read) — that pass's KEPT verdicts alone. An id absent
   *    from it has no verdict yet. A kept verdict carries the run its marker named, and says
   *    nothing of any other run (spec §5.6).
   *  Neither is "eligible". Read-only; replaced whole. */
  currentChildReclaimVerdicts(): ReadonlyMap<string, ChildReclaimSweepVerdict> | null {
    return this.childReclaimJudged;
  }

  /** The expiry lane's memory, read-only (wave 3b) — for its tests. NEVER read by the child lane's chip. */
  currentArchivedExpiry(): ReadonlyMap<string, ArchivedExpiryEntry> {
    return this.archivedExpiryState;
  }

  /** The dead-coordinator lane's memory, read-only (wave 4) — for its tests. */
  currentDeadCoordinators(): ReadonlyMap<string, DeadCoordinatorEntry> {
    return this.deadCoordinatorState;
  }

  /** `buildServer` hands the lane the coordination serialiser's sweep handle (workspace lifecycle spec §5.4: "the lane
   *  runs on the coordination serialiser, exported from `registerCoordRoutes`"). The lane's ONLY way to end a run. */
  useCoordSerialiser(h: Pick<CoordRoutesHandle, 'withSweepAbandon'>): void {
    this.deadCoordinatorSerial = h.withSweepAbandon;
  }

  /** `buildServer` hands the stop-done lane (D-5370) the coordination serialiser: its stop re-reads the store and acts
   *  inside it. Until then the lane stops nothing. */
  useStopDoneSerialiser(h: Pick<CoordRoutesHandle, 'serial'>): void {
    this.stopDoneSerial = (fn) => h.serial(fn);
  }

  /**
   * THE STOP-DONE LANE (D-5370): a finished run's dispatched worker is stopped once idle, and restarts on re-dispatch.
   * A sibling on the tick, at its own cadence, on THIS tick's assembled rows and registry listing (the listing carries
   * the kill switch). Never awaited by the tick; one pass at a time. The rule is `stopDoneVerdict` (L1), the pass
   * `stopDonePass` (L4).
   */
  async sweepStopDone(sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[]): Promise<void> {
    const coord = this.deps.coord;
    if (!coord || this.stopDoneSweeping) return;
    const now = Date.now();
    if (this.lastStopDoneSweep !== 0 && now - this.lastStopDoneSweep < STOP_DONE_SWEEP_MS) return;
    this.lastStopDoneSweep = now;
    this.stopDoneSweeping = true;
    try {
      const reads = turnReadDeps(this.deps, this);
      await stopDonePass({
        coord, runCcd: this.deps.runCcd, fleetState: this.deps.fleetState, presence: this.deps.presence,
        notifyLog: this.deps.notifyLog,
        liveWord: (rec) => liveWordFor(reads, rec), turnVerdict: (rec, uuid) => turnVerdictFor(reads, rec, uuid),
        mark: (rec) => turnMarkFor(reads, rec),
        rowAtAct: async (rec) => {
          const again = await readSessionRecord(this.deps.io, this.deps.cfg, rec.id);
          if (!again.found) return { ok: false };
          const row = await liveRowFor(reads, again.record, again.record.uuid);
          return row === null ? { ok: false } : { ok: true, row };
        },
        serial: this.stopDoneSerial, queueRun: (id, fn) => this.deps.queue.run(id, fn),
        startedAt: this.stopDoneStartedAt, now: Date.now,
      }, this.stopDoneMemory, sessions, records, names);
    } catch (err) {
      console.warn(`ccrc-server: sweepStopDone failed (${err instanceof Error ? err.message : String(err)}) — no stops this pass`);
    } finally {
      this.stopDoneSweeping = false;
    }
  }

  /** The last measured project-pool sweep, or null if none has been taken yet
   *  — same reasoning as `currentCoord()`'s null. */
  currentPools(): ProjectPoolsWire | null {
    return this.pools;
  }

  /** The last swept program-readiness (F3), for `GET /api/projects`.
   *  `undefined` means THIS PROCESS HAS NEVER SWEPT — the same shape, and the
   *  same reasoning, as `currentCoord()`'s `null` just above: inventing a
   *  clean bill for a box nothing has looked at is worse than saying so. The
   *  route publishes that as `readiness: null`, which is a different fact
   *  again from a server too old to carry the field at all. */
  currentReadiness(): FleetReadiness | undefined {
    return this.readiness;
  }

  async tick(): Promise<void> {
    // C0.1: a tick already in flight refuses a second one rather than
    // stacking — see `ticking`'s own docstring above. Mirrors
    // `SessionStream.tick` (`sessionws.ts`) verbatim.
    if (this.ticking) return;
    this.ticking = true;
    try {
      // The catalogue lane (design 2026-09-20 §7) is gated HERE, above the
      // registry read and its fail-shut return (`if (!registryRead.listed)`
      // below), because it reads nothing from the registry: a GitHub listing
      // is as answerable while `io.readdir` fails as while it succeeds, and
      // that return skips every lane below it (D-3198).
      // NEVER awaited, the caps refresh's reasoning further down: a GitHub
      // listing behind a 10 s deadline must not stall the dialog detector or
      // assembleFleet. `poll` records its own failures as `lastError` and does
      // not reject — including a throw from the store's writer, caught inside
      // `pollOnce` itself since D-3209 — so a rejection reaching here is a
      // BUG in the poller, not an expected failure mode; the `.catch` still
      // exists so it cannot become an unhandled rejection via start()'s
      // `void this.tick()`, but it now logs instead of swallowing silently
      // (D-3209: a silent `.catch(() => {})` here is exactly what let
      // `catalogueState` read "up to date" after a failed poll).
      if (this.deps.catalogue && Date.now() - this.lastCatalogueAt >= UPDATE_CATALOGUE_MS) {
        this.lastCatalogueAt = Date.now();
        // Plan W3 Task 3: a poll that listed a new tag is decided on the poll's own answer, not a minute later
        // on the inventory lane — once this process has swept (D-3314).
        // `pushReleaseAfterPoll` is synchronous and never throws, so the `.catch` still covers the poll alone.
        void this.deps.catalogue.poll(Date.now()).then(() => { this.pushReleaseAfterPoll(Date.now()); }).catch((err: unknown) => {
          console.warn('ccrc-server: the catalogue poller rejected — this is a bug, poll() should ' +
            `never reject: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
        });
      }

      // The inventory lane (design 2026-09-20 §8) is gated HERE, beside the
      // catalogue lane and above the registry read and its fail-shut return
      // below, because it is not registry-sourced — it reads ~/.ccrc — and
      // the one state it exists to record on the sweep it happens, a fleet
      // link that is down, is exactly the state in which
      // `readRegistryMeasured` answers `listed: false` and that return skips
      // every lane below it (D-3198, which covers
      // both update lanes).
      // NEVER awaited: seven reads per node over the agent must not stall the
      // dialog detector or the busy->idle push. A rejection here is now the
      // NARROW case (re-review finding 1, final fix wave): C1's per-row
      // isolation names a locked/corrupt coord.db as an `error` outcome
      // (`warnInventoryIssues`), and the projection path has its own catch —
      // what reaches `dispatchInventorySweep`'s own catch is a throw outside
      // both. Logged, deduped (C2), same idiom as the catalogue lane just
      // above, never swallowed silently either way.
      if (this.deps.coord && Date.now() - this.lastInventoryAt >= UPDATE_INVENTORY_MS) {
        void this.dispatchInventorySweep();
      }

      // The server-caps beat (D-5232's mechanism, Task 9b) sits BESIDE the inventory lane, never inside it: that lane
      // is `coord`-gated, and a coord-less server must still keep its fleet's file current. Above the registry's
      // fail-shut return for the same reason as both update lanes (it reads nothing from the registry). NEVER
      // awaited; `serverCapsNow` never rejects (`writeServerCaps` never throws, and its warning is its own).
      if (Date.now() - this.lastServerCapsAt >= SERVER_CAPS_WRITE_MS) {
        void this.serverCapsNow();
      }

      // Read once, share with the two lanes that would otherwise each read it
      // again on EVERY tick (detectDialogs, sweepHookStates) — in remote mode
      // every readRegistry() field is its own agent-WS round trip, so this is
      // the difference between one registry read and two, every 2s, forever.
      // sweepTasks/sweepPr below are NOT included: both throttle to their own
      // slower clock and skip the read entirely on most ticks already.
      //
      // `readRegistryMeasured`, not `readRegistry` (blocking review findings
      // 1/3): the old `[]`-on-unlistable signature made a single dropped
      // `io.readdir` — the whole-fleet cousin of the per-row ladder, and the
      // ordinary shape of one lost agent-WS round trip in remote mode — read
      // as "the fleet is now empty" to every lane below. `sweepHookStates`/
      // `sweepTasks` would rebuild both maps from zero rows, silently
      // discarding every entry the retain-don't-erase branch further down
      // exists to protect (findings 1/2's own harm, at fleet scale instead of
      // row scale), and the unconditional `bus.emit('fleet', sessions)` at
      // the bottom of this method would paint "no sessions" on every
      // connected PWA. Fail shut instead, the same evidence-not-time bound
      // `sweepMail` already draws three lanes down (`readRegistryMeasured`,
      // `!registryRead.listed` return) and `registry.ts`'s own docstring
      // states for this exact read: "a failed second listing proves nothing
      // and changes nothing".
      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
      // BEFORE the fail-shut return below, and on BOTH arms (D-283 (was D-B4-10)). An
      // unlistable registry is not "nothing is set": it is the exact state
      // `dispatchRun` FAILS SHUT on (`dispatch.ts:106-109`), so it must reach
      // the wire as `unmeasurable` on the same tick it happens. Placed beside
      // `emitRuns()` instead, this would be 236 lines below a `return` — the
      // banner would sit frozen on its last value while the server refused
      // every dispatch, which is the precise lie spec §4.2 mints
      // `unmeasurable` to prevent.
      this.emitCoord(registryRead.listed ? registryRead.names : null);
      // BEFORE the fail-shut return: an unlistable registry is exactly the
      // state in which nobody may decide a pool, so `listed:false` must reach
      // the wire now rather than leave the last pool snapshot frozen. That arm
      // is free: `readProjectPools` returns before touching io when names is
      // null. The listed arm's bounded cost and why it stays awaited are stated
      // on `emitPools`; `project-pools-read.test.ts` pins both cost arms.
      await this.emitPools(registryRead.listed ? registryRead.names : null);
      this.noteDelegationRegistry(registryRead.listed);
      if (!registryRead.listed) {
        // Retain, don't erase, at fleet scale: `this.hookStates`/
        // `this.taskProgress`/`this.prevStatus`/`this.lastJson` are all left
        // exactly as the prior successful tick set them. Nothing is broadcast
        // this tick — a stale-but-real fleet on the connected client's screen
        // is honest; an empty one is a lie. `registry.ts`'s own
        // `noteWholeFleetListing` already logs this episode's entry and exit
        // once, not per tick (shared by every caller of `readRegistryMeasured`/
        // `readSessionRecord`), so nothing further is logged here — a box
        // that stays unlistable for an hour still gets exactly two log lines.
        // The other per-tick lanes fall into two groups, and this return skips
        // them ALL — say so completely, because the second group is easy to
        // miss. Registry-sourced (`sweepPr`/`sweepNames`/`sweepMail`): each is
        // void-dispatched with its own slower/independent clock and its own
        // registry read (`sweepMail` already fails shut the identical way), so
        // skipping one 2s dispatch costs a few seconds' delay on an
        // already-rare failure, never data. Coord-DB-sourced (`emitRuns`,
        // `pushNewMail`/`pushNewRuns`): their data source is SQLite, perfectly
        // readable while `io.readdir` fails, and they still stall here — a
        // deliberate trade for one simple early return. Bounded and lossless:
        // both notify lanes are watermark-based (`lastMailNotifyId`/
        // `lastRunNotifyId`) and catch up on the next successful tick, and
        // `emitRuns` is byte-equality guarded so it re-emits the moment it
        // runs again. Delay, never loss.
        return;
      }
      const records = registryRead.records;
      // Wave 5: the reclaim chip's registry answer, off THIS listing. Never a
      // second read; see `childMarks`.
      const childMarks = new Map(records.map((r) => [r.id, r.child] as const));
      // Wave 6 (spec §5.9): a child that left the listing was, almost
      // always, just reclaimed, and ccd journals the reclaim's end AFTER the
      // purge. Reset the mirror's clock, so the `sweepLifecycle` dispatch below
      // sweeps on THIS tick, and the coord frame's `childReclaimDoneAt` usually
      // moves one tick later. An assignment, never an await: the tick's order
      // and its timing are unchanged. Only on a LISTED tick, below the fail-shut
      // return: an unlistable registry proves no child gone.
      if (childMarkLeftListing(this.childMarks, childMarks)) this.lastLifecycleSweep = 0;
      this.childMarks = childMarks;
      // hook states FIRST, dialogs second — the order is load-bearing and there
      // is a test on it. `detectDialogs` composes the ask push, and the actions
      // it attaches come from `this.hookStates`; with the old ordering that map
      // was always one tick behind, so whether a question arrived answerable
      // from the notification depended on how the 2-second poll happened to
      // straddle the hook's write. Sweeping first costs nothing (both lanes
      // share the one `records` read below).
      //
      // It NARROWS that window; it does not close it. The sweep reads a
      // session's hookstate at time s and `detectDialogs` captures its pane at
      // time c, sequentially, each capture an agent round trip in remote mode —
      // so for the last session of eight, c-s is a couple of hundred ms of a
      // 2000 ms tick. A `session-hook.sh` write landing inside (s, c) still
      // yields a menu with no envelope, and therefore an action-less ask push.
      // What covers the residue is `actionlessAsks` in `detectDialogs` below:
      // the latch remembers that push and amends it when the envelope turns up.
      await this.sweepHookStates(records);
      await this.sweepUsage(records);
      const pending = await this.detectDialogs(this.primed, records);
      await this.sweepTasks();
      // NEVER awaited: it shells out over the network and `gh` has no
      // --timeout, so awaiting it would stall the dialog detector and the
      // busy->idle push behind GitHub's reachability.
      void this.sweepPr().catch(() => { /* one bad sweep must not kill the poll */ });
      if (this.deps.refreshCaps && Date.now() - this.lastCapsAt >= CAPS_REFRESH_MS) {
        this.lastCapsAt = Date.now();
        // NEVER awaited: same reasoning as sweepPr immediately above — caps()
        // swallows its own failures today, but a wedged-yet-connected agent
        // must not stall assembleFleet behind an up-to-15s request timeout,
        // and a future implementation that DOES reject must not become an
        // unhandled rejection via start()'s `void this.tick()`.
        void this.deps.refreshCaps().catch(() => { /* one bad refresh must not kill the poll */ });
      }
      // NEVER awaited, same reasoning as sweepPr above and then some: this one
      // joins the per-session KeyedQueue, which `POST /workspace/reap` can hold
      // for minutes. Awaiting it would put the dialog detector and the
      // busy->idle push behind a reap. Overlapping sweeps are harmless — the
      // attempted-set is written BEFORE the call, so a second sweep's condition 4
      // refuses the pair the first is still running.
      void this.sweepNames().catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, same reasoning as `sweepNames` above. Own clock: this reads
      // git's admin directory per project, which is not a per-tick cost.
      //
      // NOT HANDED `registryRead.names`, deliberately, though it is sitting
      // right here and this lane needs exactly that listing. It takes its own,
      // AFTER git's records — the census weighs the two against each other, and
      // a listing snapshotted here would be three awaited lanes older than the
      // records it is compared with. `sweepDivergences` states the race in full.
      void this.sweepDivergences(records)
        .catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, same reasoning as `sweepNames` above and then some: this
      // lane joins the per-session KeyedQueue behind wave 3's `ws-reclaim`,
      // whose remote budget is `ws-reap`'s four minutes. Own clock
      // (`CHILD_RECLAIM_SWEEP_MS`). HANDED `registryRead.names`, unlike the
      // census: the only fact it takes from the listing is the reclaim
      // switches, and a listing a few awaited lanes old is safe for that one —
      // ccd re-reads `$REG/reclaim-paused` inside `ws-reclaim`'s lock at the
      // instant of deletion, which is the read that makes the switch real.
      void this.sweepChildReclaim(records, registryRead.names)
        .catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, the child lane's reasons: the EXPIRY lane (workspace lifecycle wave 3b) — a SIBLING pass on
      // the same tick's registry read, at the same cadence, under the same switch, sharing nothing else.
      void this.sweepArchivedExpiry(records, registryRead.names)
        .catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, the same reasons: the DEAD-COORDINATOR lane (workspace lifecycle wave 4) — a third sibling on
      // this tick's registry read, cadence and switch, sharing nothing else; its act waits on the coordination
      // serialiser behind whatever write route is running.
      void this.sweepDeadCoordinators(records, registryRead.names)
        .catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, the same reasons: the TEMP-ROOT COLLECTOR's lane (child reclamation wave 9, spec §5.10) — a fourth
      // sibling at this tick's cadence and under its switch. Its population is its own two listings, read in its own
      // gather; this listing feeds its pre-filter, which is economy and never a permission.
      void this.sweepTempRootCollect(records, registryRead.names)
        .catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, same reasoning as sweepNames immediately above: this one
      // joins the per-session KeyedQueue AND calls sendPrompt, whose worst case
      // is ~4.3 s of sleeps per message plus one round trip per line
      // (`inject/send.ts:30-40,115,126`). Awaiting it would put the dialog
      // detector and the busy->idle push behind a mail delivery.
      void this.sweepMail().catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, same reasoning as `sweepMail` immediately above — the
      // release CAS and its own registry listing must not sit in front of the
      // dialog detector either. Own clock (`ASK_SWEEP_MS`).
      void this.sweepAsks().catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, same reasoning as `sweepDivergences` above: in remote
      // mode this is one agent-WS `readdir` plus one `readFileFrom` per live
      // generation per sweep. Awaiting it would put the dialog detector and
      // the busy->idle push behind a journal read.
      void this.sweepLifecycle().catch(() => { /* one bad sweep must not kill the poll */ });
      // `records` PASSED IN, never re-read here: `assembleFleet` would
      // otherwise take its OWN read (`records ?? await readRegistry(...)`),
      // a SEPARATE whole-fleet sweep a few hundred ms after the one above —
      // in remote mode, 31 [registry-read-census:fields] field reads per
      // session, so a 24-session fleet's baseline is 745 agent-WS operations
      // [registry-read-census:fleet] per sweep before conditional
      // reconfirmation, doubled for no reason. Sharing the read also keeps
      // `sweepHookStates`/`detectDialogs` (which already consumed `records`
      // above) and this assembly looking at the identical snapshot, which is
      // what lets `unmeasuredIds` below be derived FROM `sessions` rather
      // than computed a second, independent way off `records` — see that
      // derivation's own comment (blocking review finding 4).
      // THE FIRST ASSEMBLY AFTER BOOT WAITS, BOUNDED, FOR THE FIRST HEAD SWEEP
      // just fired above. Without it the map is always empty here on tick 1 —
      // the argument below is read before the sweep's first await can resolve
      // — so the first frame, and the state-cache it writes, shipped the
      // registry's `.branch` for every row whose pane gave none: the name a
      // manual checkout leaves stale. Once only, so a sweep that never lands
      // costs one frame's latency, not every tick's.
      if (!this.headsBootWaited) {
        this.headsBootWaited = true;
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          this.headsSettled,
          new Promise<void>((resolve) => { timer = setTimeout(resolve, HEADS_BOOT_WAIT_MS); }),
        ]);
        clearTimeout(timer);
      }
      const panePids = new Map<string, number | null>();
      const sessions = await assembleFleet(this.deps.io, this.deps.cfg, this.deps.tmux, undefined, pending, this.statuslines, this.taskProgress, this.prStates, this.hookStates, records, this.deps.coord, this.usage, this.currentHeadBranches(), panePids);
      // Blocking review finding 4: `FleetSession.unmeasured` (Task 2) now
      // carries the SAME evidence `measuredIdentity(records[i]) === null`
      // would, one hop from `records[i]` in `sessions[i]` — so this reads it
      // off the assembled rows directly (one derivation of one fact) rather
      // than re-deriving it from `records` a second, independent way, which
      // is exactly the kind of drift `fleet.ts`'s own `records`-parameter
      // docstring warns a second copy of one shape invites. Names exactly the
      // rows whose STATUS this tick could not measure: a degraded `r.wrapper`
      // (`''`) makes `configDirFor` answer `undefined`, so `assembleFleet`
      // never reaches `readLiveState` and `status` freezes at the `alive`
      // default of `'idle'` — a session that may be plainly mid-turn.
      // THE UNION OF BOTH ROUTES (D-115). `s.unmeasured` names a degraded
      // identity triple, which freezes `status` at the `alive` default of
      // 'idle'; `s.statusUnmeasured` names an unreadable live-status file,
      // which `assembleFleet` paints 'busy'. Opposite words, one fact — this
      // tick did not measure this session's status — and the rule below wants
      // that fact, not either spelling of it. Missing the second route is what
      // fired a "✓ Finished" push at a session that never started a turn
      // (`push-copy.test.ts`, "an unreadable live-status file must never…").
      const unmeasuredIds = new Set(sessions
        .filter((s) => s.unmeasured.length > 0 || s.statusUnmeasured)
        .map((s) => s.id));
      // The whole fleet is in scope right here, which is exactly what
      // `pushOne`'s copy rule needs and `detectDialogs`/`sweepPr` below don't
      // have on their own clocks — see `activeProjects`'s own comment.
      const projects = new Set(sessions.filter((s) => s.status !== 'dead').map((s) => s.project));
      // Per-session project, off the SAME fleet assembly — the honest fallback
      // `pushNewMail` uses for run-less mail (review finding 3): a delivery's
      // `project` is null whenever the mail has no run, which `mailQueuedSince`'s
      // own docstring names as a fully supported case, not an edge one, and the
      // RECIPIENT session's own project (known here, not down in that method's
      // own scope) is the honest answer — never an empty string.
      const sessionProjects = new Map(sessions.map((s) => [s.id, s.project]));
      // Push on a busy→idle finish (a session completed a turn). Skip the priming
      // tick — otherwise a restart notifies for every currently-idle session.
      if (this.primed) {
        for (const s of sessions) {
          // Blocking review finding 2: never assert a turn completed on a row
          // this tick could not measure — `status` for a degraded row is a
          // guess (see `unmeasuredIds`'s own comment above), and a push
          // "says it happened" (the architecture doc's own words for exactly
          // this class of surface). `continue`d before the transition check,
          // not just before the push, so `prevStatus` (line ~590 below) is
          // ALSO left untouched for this id this tick — the real busy→idle
          // edge still fires, correctly, once the row heals and a later tick
          // can actually measure it, rather than being silently lost the
          // instant `prevStatus` was overwritten to an unmeasured 'idle'.
          if (unmeasuredIds.has(s.id)) continue;
          if (this.prevStatus.get(s.id) === 'busy' && s.status === 'idle') {
            // D-5233: the edge alone is no evidence a turn ended (a compaction, a restart, an overload tick and an
            // Escape all make one); a main Stop inside this busy stretch is.
            const since = this.episodeBusySince.get(s.id);
            if (since !== undefined && await this.finishedEvidence(s.id, s.wrapper, records, panePids, since)) {
              this.pushOne({ kind: 'done', sessionId: s.id, project: s.project, title: '✓ Finished', body: 'Finished — back to idle' }, projects);
            }
          }
        }
        // Build 7's two new notify kinds ride the SAME primed gate as the
        // `done` push above, for the identical restart reason. EACH WRAPPED
        // (review finding 1): both walk straight into `node:sqlite`, which
        // throws SYNCHRONOUSLY — a full disk (this fleet already ships a 10G
        // floor check, so it is not hypothetical) or a second connection
        // holding coord.db's write lock (`BEGIN IMMEDIATE` takes it eagerly,
        // no busy timeout) is enough. `tick()` is fired by `start()` as `void
        // this.tick()` with no `unhandledRejection` handler anywhere in this
        // tree, so an unguarded throw here would kill the whole process over a
        // fault every NEIGHBOURING lane already survives (sweepPr/sweepNames/
        // sweepMail's `void …().catch(…)`, saveSnapshot's try/catch below,
        // readRegistry's swallow-by-construction) — these two were the
        // exception, not the rule this file otherwise keeps.
        try { this.pushNewMail(projects, sessionProjects); }
        catch (err) {
          console.warn(`ccrc-server: pushNewMail failed (${err instanceof Error ? err.message : String(err)}) — one bad sweep must not kill the poll`);
        }
        try { this.pushNewRuns(projects); }
        catch (err) {
          console.warn(`ccrc-server: pushNewRuns failed (${err instanceof Error ? err.message : String(err)}) — one bad sweep must not kill the poll`);
        }
      } else if (this.deps.coord) {
        // The priming tick seeds both watermarks to "everything that already
        // exists" rather than 0, so the FIRST primed tick's `WHERE id > ?`
        // reads see only what changed after this process started — the mail-
        // lane courtesy spec's restart semantics name, extended here to runs.
        // Guarded for the identical reason as the two calls above (review
        // finding 1): a priming-tick SQLite failure must leave both watermarks
        // at 0, not kill the process — a later primed tick still reads
        // everything queued since the process actually started, which is the
        // same "replay a bit more than strictly necessary" cost every other
        // lane in this file accepts over losing the poll outright.
        try {
          this.lastMailNotifyId = this.deps.coord.maxMailDeliveryId();
          this.lastRunNotifyId = this.deps.coord.maxRunEventId();
        } catch (err) {
          console.warn(`ccrc-server: priming the mail/run watermarks failed (${err instanceof Error ? err.message : String(err)}) — one bad read must not kill the poll`);
        }
      }
      // Skips the SAME unmeasured ids the push loop above skips — see its own
      // comment: overwriting `prevStatus` with a guessed 'idle' here would
      // permanently lose the real busy→idle edge the instant the row heals.
      for (const s of sessions) {
        if (unmeasuredIds.has(s.id)) continue;
        this.prevStatus.set(s.id, s.status);
        // The busy stretch's start (D-5233; not the mail gate's own `busySince`), kept from the tick the row turned
        // busy, priming tick included, and under the same unmeasured skip as `prevStatus`, so a guessed status
        // neither opens nor closes a stretch.
        if (s.status !== 'busy') this.episodeBusySince.delete(s.id);
        else if (!this.episodeBusySince.has(s.id)) this.episodeBusySince.set(s.id, s.statusUpdatedAt ?? Date.now());
      }
      for (const id of this.episodeBusySince.keys()) { if (!sessionProjects.has(id)) this.episodeBusySince.delete(id); }
      this.activeProjects = projects;
      // Build 9 wave 7: the claim lease rides THIS tick, on its own slower
      // clocks — no new timer (D12), and the mail sweep below this block is
      // untouched by name (D10: a second producer lands BESIDE the most
      // load-bearing loop on the box, never inside it). Liveness comes off
      // the SAME `sessions` this tick assembled. Wrapped like `pushNewMail`,
      // for its reason: both walk straight into synchronous `node:sqlite`.
      try {
        this.renewClaims(sessions);
        this.lapseClaims(sessions);
      } catch (err) {
        console.warn(`ccrc-server: claim sweep failed (${err instanceof Error ? err.message : String(err)}) — one bad sweep must not kill the poll`);
      }
      // The stall watch (spec 2026-09-29 §4.2, §5) runs after the claim lanes, on THIS tick's `sessions`, its
      // registry listing (the listing carries the markers) and what this tick already measured: the pane pids
      // `assembleFleet` read and the registry rows (`StallTick`), so the lane reads neither again. It is never
      // awaited: its reads are async, so it cannot sit in the claim pair's synchronous try-block. It gates itself
      // on `primed`, which is set below, so the priming tick never judges.
      void this.sweepStalls(sessions, registryRead.names, { panePids, records }).catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, the stall watch's reasons: the STOP-DONE lane (D-5370) on THIS tick's rows and listing. Gated on
      // `primed` like the stall watch, so the priming tick never stops anything.
      if (this.primed) void this.sweepStopDone(sessions, records, registryRead.names).catch(() => { /* one bad sweep must not kill the poll */ });
      // D-5373: NEVER awaited, `sweepMail`'s reason — it can call `sendPrompt` through the per-session queue. Own clock.
      if (Date.now() - this.lastIdleNudgeAt >= IDLE_NUDGE_SWEEP_MS) {
        this.lastIdleNudgeAt = Date.now();
        void this.sweepIdleCompactNudge(sessions, registryRead.names, { panePids, records })
          .catch(() => { /* one bad sweep must not kill the poll */ });
      }
      // NEVER awaited, same reasoning as `sweepDivergences`: each is a
      // handful of io reads per PROJECT, on an hourly / 15-minute clock.
      void this.sweepLedgerFloor(records).catch(() => { /* one bad sweep must not kill the poll */ });
      void this.sweepLedgerReconcile().catch(() => { /* one bad sweep must not kill the poll */ });
      void this.sweepReadiness().catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, the same reasons: the DELEGATION lane (wave 3, Task 13) is a sibling at the census's own cadence, on this tick's
      // `sessions` and registry rows. It reads spool buckets over the agent link, so awaiting it would put the dialog detector and the
      // busy->idle push behind a slow remote read; it is single-flight and has its own budget (`DelegationLane`).
      void this.sweepDelegation(sessions, records).catch(() => { /* one bad sweep must not kill the poll */ });
      this.primed = true;
      if (this.deps.cfg.fleetMode === 'remote' && this.deps.fleetState?.connected) {
        // C0.4: `connected` alone is not "this read was complete" — a
        // wedged-yet-connected agent, a socket hiccup mid-sweep, or a handful of
        // sessions timing out inside `readRegistry`'s 24-generation loop all
        // still leave `fleetState.connected` true while `sessions` comes back
        // short. Without a size check, THAT partial assembly overwrites the
        // fuller last-known-good snapshot on disk — and `/api/fleet`
        // (server.ts) serves exactly this file, unconditionally, as `stale:
        // true` for the whole REST of a subsequent real outage. So a single bad
        // tick during an otherwise-healthy stretch degrades every request after
        // it, not just its own. Guard: never let a smaller (or empty) assembly
        // clobber a fuller one already on disk — implementing the intent this
        // class's own docstring already states above ("a stretch of
        // empty/partial reads never clobbers the last known good snapshot").
        //
        // C0.4-FOLLOWUP (blocking review findings 1/2): a bare length
        // comparison cannot tell "this tick's read was partial" apart from
        // "the fleet is genuinely smaller now" — and the second one is the
        // ROUTINE case, not the rare one: `ccd`'s `_reg_purge` unlinks a
        // session's whole registry entry from `cmd_ws_rm` (session rm),
        // `ws-reap`, and `ws-gc --prune` alike. Comparing lengths ALONE turns
        // every purge into a permanent high-water mark: once the fleet drops
        // below it, `sessions.length < prior.sessions.length` stays true on
        // every later tick FOREVER, even fully healthy ones, and the cache —
        // every field of every surviving session included — freezes at the
        // instant of the purge and never updates again. Silently: nothing
        // failed loudly enough to log.
        //
        // The escape hatch is the same evidence `readRegistry`'s own
        // hold-reconfirm already trusts (registry.ts): `_reg_purge` removes
        // the id's `.uuid` too, so a GENUINE purge is a directory listing that
        // no longer names `<id>.uuid` at all. A FAILED field read, by
        // contrast, leaves `.uuid` (and the id's other files) sitting right
        // there in the listing — only the bytes behind one of them came back
        // null. So: when this tick assembled fewer sessions than the prior
        // snapshot, list the registry directory fresh and check every id that
        // dropped out against it. The write is allowed only when EVERY
        // missing id is confirmed gone from that listing — one still-listed
        // id is enough to treat the whole tick as a partial read and keep the
        // prior snapshot, exactly as the original guard intended for that
        // case. A failed (or absent) confirmation listing itself proves
        // nothing either way, so it fails shut the same way.
        try {
          // Task 2: the shrink guard above keys ONLY on `sessions.length`,
          // and a degraded row survives length unchanged — `assembleFleet`
          // still emits one `FleetSession` per readable-or-degraded record,
          // it just carries a non-empty `unmeasured`. So a 24-row assembly
          // with 3 degraded rows sails straight through
          // `sessions.length >= prior.sessions.length` and would be
          // persisted as last-known-good: `status` frozen at a guessed
          // default, `branch`/`workdir` reading stale or empty for reasons
          // that have nothing to do with the session's real state. The
          // snapshot's whole purpose is degraded-mode serving (`/api/fleet`
          // ships it, unconditionally `stale: true`, through a REAL
          // fleet-host outage) — persisting a guess as THAT snapshot defeats
          // the one thing it exists for at the exact moment it matters.
          // Same warn-once-per-episode discipline as the shrink guard below,
          // on its own flag (`snapshotWriteSkippedDegradedWarned`) so the two
          // episodes can each report once without silencing the other.
          const degraded = sessions.filter((s) => s.unmeasured.length > 0);
          if (degraded.length > 0) {
            if (!this.snapshotWriteSkippedDegradedWarned) {
              this.snapshotWriteSkippedDegradedWarned = true;
              console.warn(`ccrc-server: snapshot write skipped — ${degraded.length}/${sessions.length} assembled sessions carry an unmeasured identity field this tick (${degraded.map((s) => s.id).join(', ')}); the cache would otherwise persist a guess as last-known-good`);
            }
          } else {
            this.snapshotWriteSkippedDegradedWarned = false;
            const prior = await loadSnapshot(this.cachePath);
            if (prior === null || sessions.length >= prior.sessions.length) {
              await saveSnapshot(sessions, this.cachePath);
              this.snapshotWriteSkippedWarned = false;
            } else {
              const survivingIds = new Set(sessions.map((s) => s.id));
              const missingIds = prior.sessions.map((s) => s.id).filter((id) => !survivingIds.has(id));
              const names = await this.deps.io.readdir(this.deps.cfg.registryDir);
              const allGenuinelyPurged = names !== null && missingIds.every((id) => !names.includes(`${id}.uuid`));
              if (allGenuinelyPurged) {
                await saveSnapshot(sessions, this.cachePath);
                this.snapshotWriteSkippedWarned = false;
              } else if (!this.snapshotWriteSkippedWarned) {
                this.snapshotWriteSkippedWarned = true;
                console.warn(`ccrc-server: snapshot write skipped — this tick assembled ${sessions.length}/${prior.sessions.length} of the prior snapshot's sessions and at least one missing id is still listed in the registry (a read failure, not a confirmed purge); cache stays at the prior size until that clears`);
              }
            }
          }
        } catch { /* best-effort cache — never blocks the poll */ }
      }
      // Independent of the `fleet` diff below: runs change on a different
      // clock from sessions, and an unchanged session snapshot must not
      // suppress a run transition from reaching an already-connected client.
      this.emitRuns();
      const json = JSON.stringify(sessions);
      if (json === this.lastJson) return;
      this.lastJson = json;
      this.lastFleet = sessions;
      this.bus.emit('fleet', sessions);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * The `{type:'runs'}` WS frame emitter (Task 10, spec:222-224). Runs every
   * tick, unthrottled: `CoordStore.runs()` is a handful of indexed SQLite
   * reads (synchronous — `DatabaseSync` has no async surface), not a pane
   * capture or a network round trip, so there is nothing here worth a slower
   * clock of its own the way `sweepNames`/`sweepMail` need one.
   *
   * Byte-equality guarded exactly like the `fleet` snapshot above: runs
   * change on human-and-agent timescales, and re-broadcasting an unchanged
   * list every 2 s would be new noise on a socket that spent real effort not
   * having any. No `coord` -> nothing to read -> nothing ever emitted, the
   * same "absent means none of this exists" stance every other coord-gated
   * surface in this build takes.
   *
   * GUARDED (review finding 1): `coord.runs()` is a synchronous `node:sqlite`
   * read, sitting directly on `tick()`'s own poll with no neighbouring
   * `catch` to absorb it — the same fault (a full disk, a locked coord.db)
   * that has a `try`/`.catch` at every OTHER synchronous or async lane in
   * this file. A failure here skips just this tick's `runs` emission;
   * `lastRunsJson` is left untouched so a later successful tick still diffs
   * correctly against whatever was last actually broadcast.
   */
  private emitRuns(): void {
    const coord = this.deps.coord;
    if (!coord) return;
    let runs: RunSummary[];
    try {
      const read = coord.runs();
      // D-2545: SKIP THE FRAME, the identical degrade to the throw arm below.
      // `lastRunsJson` is left untouched either way, so the previously-sent
      // frame stands and a later successful tick still diffs correctly against
      // what was last actually broadcast. Emitting `[]` here would tell every
      // client that every run had closed.
      if (!read.ok) {
        console.warn(`ccrc-server: emitRuns refused (${read.detail}) — no runs frame this tick`);
        return;
      }
      runs = read.runs.map(toRunSummary);
    }
    catch (err) {
      console.warn(`ccrc-server: emitRuns failed (${err instanceof Error ? err.message : String(err)}) — one bad read must not kill the poll`);
      return;
    }
    const json = JSON.stringify(runs);
    if (json === this.lastRunsJson) return;
    this.lastRunsJson = json;
    this.bus.emit('runs', runs);
  }

  /** The `{type:'coord'}` frame (spec §4.2). Derived from the SAME registry
   *  listing this tick already performed — carried out of `readRegistryMeasured`
   *  on `RegistryRead.names` rather than taken again (D-283).
   *
   *  `null` names is an UNLISTABLE directory, not an empty one, and rides the
   *  wire as `unmeasurable` — the state `dispatchRun` fails shut on.
   *
   *  Byte-equality guarded exactly like `emitRuns` above. No `try`/`catch`:
   *  unlike `emitRuns` this touches no `node:sqlite` and no I/O — it is an
   *  array scan, a `JSON.stringify` and a `bus.emit`, and the bus's own
   *  listeners are the two socket writers `emitRuns` already trusts. The
   *  attention list is a cached field, not a read: this method still touches
   *  no `node:sqlite` and no I/O.
   *
   *  Wave 6: it also carries the mirror's newest committed reclaim end
   *  (childReclaimDoneAt), omitted while there is none; the byte-equality guard
   *  re-emits the frame on the tick after it changes. */
  private emitCoord(names: readonly string[] | null): void {
    const base: CoordStatus = names === null
      ? { pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable',
          childReclaimAttention: this.childReclaimAttentionList, expiryAttention: this.expiryAttentionList,
          deadCoordinatorAttention: this.deadCoordinatorAttentionList }
      : { pause: names.includes(COORDINATOR_PAUSE_MARKER) ? 'set' : 'clear',
          mail: names.includes(MAIL_DISABLED_MARKER) ? 'set' : 'clear',
          reclaim: names.includes(RECLAIM_PAUSE_MARKER) ? 'set' : 'clear',
          childReclaimAttention: this.childReclaimAttentionList, expiryAttention: this.expiryAttentionList,
          deadCoordinatorAttention: this.deadCoordinatorAttentionList };
    // Wave 6 (spec §5.9): the mirror's newest committed reclaim end, on BOTH
    // arms, because it is the mirror's measurement and not the listing's.
    // OMITTED, never null, while there is none: absence is the one meaning
    // the PWA's reader gives it, whether the server restarted or predates the
    // field. Still no I/O and no `node:sqlite`: it is an in-memory field.
    const doneAt = this.currentChildReclaimDoneAt();
    const status: CoordStatus = doneAt === null ? base : { ...base, childReclaimDoneAt: doneAt };
    const json = JSON.stringify(status);
    if (json === this.lastCoordJson) return;
    this.lastCoordJson = json;
    this.coord = status;
    this.bus.emit('coord', status);
  }

  /** The `{type:'pools'}` frame (account pools, spec §5.4.5). Derived from the
   *  SAME registry listing this tick already performed — carried out of
   *  `readRegistryMeasured` on `RegistryRead.names` rather than taken again,
   *  exactly as `emitCoord` above does, so the two cannot disagree on the ticks
   *  that matter and the tick costs no extra root readdir.
   *
   *  `null` names is an UNLISTABLE registry, and rides the wire as
   *  `listed: false` — every project `unreadable`, nobody decides.
   *
   *  Byte-equality guarded like `emitCoord`, but awaited for its own reason:
   *  `lastPoolsJson` is written after the reads, so overlapping detached
   *  sweeps could finish out of order and latch an older snapshot until the
   *  tags changed again. `tick()`'s re-entrancy guard provides that ordering.
   *
   *  This POOL LEG has one caller-owned budget: half this watcher instance's
   *  interval, shared by one `pools/` readdir, concurrent measured reads for
   *  every non-dot entry, AND (item 1, wave-1 fix round A) the sibling
   *  `$REG/pool-epoch` read `readObservedEpochFromRegistry` performs — run
   *  concurrently with the marker sweep via `Promise.all` on the SAME budget,
   *  not serially after it, so this tick still costs no extra round trip. It
   *  prevents pool-marker cost from multiplying the remote client's
   *  15-second default by project population (D-2465/D-2478). It does NOT
   *  restore a two-second whole-tick cadence: the serial `readRegistryMeasured`
   *  above runs first and can still cost roughly one default timeout per
   *  session (D-2479). Closing that older reader is outside this wave.
   *
   *  Both FleetIO implementations fold read failures into measured return
   *  values, so no catch is needed here. `project-pools-read.test.ts` pins cost,
   *  overlap and deadline behavior; `fleetws.test.ts` pins this cadence-derived
   *  budget at the consumer. */
  private async emitPools(names: readonly string[] | null): Promise<void> {
    const budgetMs = Math.max(1, Math.floor(this.intervalMs / 2));
    const [read, observedEpoch] = await Promise.all([
      readProjectPools(this.deps.io, this.deps.cfg, names, budgetMs),
      readObservedEpochFromRegistry(this.deps.io, this.deps.cfg, budgetMs),
    ]);
    // T9-R2: the epoch/observedEpoch producer, the SAME two reads `/api/fleet`
    // (server.ts) makes for its own `poolsWire` call — `readPoolEpoch`
    // (`pools.ts`) leaves `epoch` off the wire whether `deps.coord` is
    // absent OR `poolEpoch()` throws (F1, pre-merge gate: a bare `?.` only
    // guarded the absent case, so a broken coord.db used to throw straight
    // through this tick instead of degrading it — see that function's own
    // docstring). `observedEpoch` (item 1, wave-1 fix round A) is now THIS
    // TICK's own `$REG/pool-epoch` measurement, not a forward of
    // `deps.fleetState`'s handshake-sampled value — that value was sampled
    // once per WS connection and never refreshed for a link that can live
    // for days; see `readObservedEpochFromRegistry`'s own docstring for the
    // three-valued contract this replaces it with.
    //
    // F2 (pre-merge gate): `accountPools`, the same three-state shape as
    // `enforcement` two lines below, derived off the SAME `ccdVerbs` list —
    // `accountPoolsEnforcement` reads the `account-pools` capability token
    // Task 2 added to `cmd_caps`, the way `poolsEnforcement` already reads
    // the project-pool verb.
    const wire = poolsWire(
      read,
      poolsEnforcement(this.deps.fleetState?.ccdVerbs ?? null),
      readPoolEpoch(this.deps.coord),
      observedEpoch,
      accountPoolsEnforcement(this.deps.fleetState?.ccdVerbs ?? null),
    );
    const json = JSON.stringify(wire);
    if (json === this.lastPoolsJson) return;
    this.lastPoolsJson = json;
    this.pools = wire;
    this.bus.emit('pools', wire);
  }

  /**
   * The `mail` NotifyEvent lane (Task 10, spec:243-244). Fires from the
   * delivery lane's own data at QUEUE time — `mailQueuedSince` walks
   * `mail_deliveries` by insertion order, so a row is raised the first tick
   * after `POST /api/mail` (or the coordinator's own system mail) queued it,
   * regardless of whether `sweepMail` has attempted injection yet. "Not at
   * injection — otherwise a message that never becomes deliverable is a fact
   * nothing recorded."
   *
   * `tag` is `mail-<toId>-<mailId>` (spec:236-237): NON-collapsing per
   * session, on purpose — two different messages about one session must not
   * replace each other in the tray, unlike `ask`/`done`/`merged`'s default
   * `${kind}-${sessionId}` key, where the newest statement supersedes the
   * last. `recordAlways: true` (spec:238-240): a message the operator is
   * looking at the recipient's pane for is still a fact that arrived: only
   * the PUSH is presence-gated, never the record.
   *
   * `sessionProjects` (review finding 3): `m.project` comes off a `LEFT JOIN`
   * to the mail's run and is `null` for ad-hoc mail with no run context — a
   * fully supported, first-class case (`mailQueuedSince`'s own docstring;
   * `POST /api/mail` treats `runId` as optional). Falling back to `''` left a
   * dangling ` · ` in a multi-project fleet: `pushOne` decorates on project
   * COUNT alone, with no test ever exercising a run-less mail there (every
   * mail case in `push-copy.test.ts` seeded one project). The recipient
   * SESSION's own project, read one scope up in `tick()` from this same
   * tick's fleet assembly, is the honest fallback.
   *
   * ONE EXCEPTION to "always pushes" (fix round 1, item 1, CRITICAL):
   * `isAskNudgeMail` (`coord/rundefs.ts`) rows — the ask pre-emption lane's
   * own nudge to a parent, queued by `hold()` — still RECORD here
   * (`recordAlways: true`, unconditionally, below) but never PUSH
   * (`recordOnly: true` added on top for exactly this row). Without that,
   * this lane's own delivery buzzed the operator's phone about the very
   * question the hold exists to keep off it, defeating the deferral it was
   * built to implement — the watermark still advances for these rows
   * exactly like every other, so this is a push-only exemption, not a skip.
   *
   * The stall watch's own mail follows the same rule (spec 2026-09-29 §4.2, "Push shape"), classified
   * by `stallMailClass`:
   * - A `check` (the watch's r1 to a worker) is recorded, never pushed.
   * - A `reply` is recorded, never pushed, and only when it is BOUND: from the run's own worker, on that run,
   *   and newer than the first check on it. The bind is read from the store only for a `re stall-check:`
   *   subject. Any other mail wearing that prefix is pushed as ordinary mail, so no box-token holder can use
   *   the prefix to keep a mail off the phone.
   * - A `self-wake` (wave 2: an `orphaned:` or `failed:` notice the watch mails a session about its own turn) is
   *   recorded, never pushed. The session is the one to act on it, and orphan D's rung 2 pushes the operator from
   *   the lane itself (`⚠ orphaned`) when that mail sits unacknowledged.
   * - A `report` (the watch's mail to the coordinator: wave 1's r2, and wave 2's frozen, dead and failed rung) is
   *   pushed under a title by its kind, read back from its own subject (`stallReportKind`, `stallReportTitle`):
   *   `⚠ stall`, `⚠ frozen`, `⚠ dead` or `⚠ failed` › <run workspace>. The lane never pushes a report itself, so
   *   this is its only push. Under `mail-disabled` the verdict holds every coordinator-bound rung, so no report is
   *   queued and none reaches this push. The lane's operator rungs still push (ruling Q1: no reroute).
   */
  private pushNewMail(projects: Set<string>, sessionProjects: Map<string, string>): void {
    const coord = this.deps.coord;
    if (!coord) return;
    for (const m of coord.mailQueuedSince(this.lastMailNotifyId)) {
      const project = m.project ?? sessionProjects.get(m.toId) ?? '';
      const bind = m.subject.startsWith(STALL_REPLY_PREFIX)
        ? {
          runSessionId: m.runSessionId,
          runId: m.runId,
          firstCheckId: m.runId === null ? null
            : coord.firstMailIdWithPrefix(m.runId, 'operator', m.fromId, STALL_CHECK_PREFIX),
        }
        : undefined;
      const stall = stallMailClass(m, bind);
      this.pushOne({
        kind: 'mail', sessionId: m.toId, project,
        title: stall === 'report' ? stallReportTitle(stallReportKind(m.subject), m.workspace ?? m.toId) : `✉ ${m.kind} › ${m.workspace ?? m.toId}`,
        body: m.subject,
        runId: m.runId,
        tag: `mail-${m.toId}-${m.mailId}`,
        recordAlways: true,
        ...(isAskNudgeMail(m) || stall === 'check' || stall === 'reply' || stall === 'self-wake' ? { recordOnly: true } : {}),
      }, projects);
      this.lastMailNotifyId = m.deliveryId;
    }
  }

  /**
   * The `run` NotifyEvent lane (Task 10, spec:243-244): one RECORD per
   * `run_events` row — every transition this run's own state machine
   * records, not just terminal ones. "A run transition is a fact about a
   * program, and the operator watching one pane must not erase it" —
   * `recordAlways: true` for the identical reason `pushNewMail` sets it.
   *
   * `closing` is `recordOnly` (review finding 4): `POST /api/runs/:id/close`
   * commits `advance(id,'closing')` and `advance(id, state)` inside ONE
   * transaction, `CoordStore.closeRun` (corrected — this used to describe
   * two adjacent synchronous route-level statements, true when review
   * finding 4 was fixed but not since `closeRun` was introduced), so the
   * SAME watcher tick always reads both rows, and every close fired TWO
   * pushes, one naming a state that exists for microseconds: internal
   * bookkeeping the operator can neither act on nor ever observe as a
   * resting state. The feed still gets it in full — the record above is
   * unconditional, same as every other transition — only the PUSH is
   * suppressed for this one state.
   *
   * A transition with no `sessionId` yet (e.g. an early refusal before
   * dispatch ever minted one) is skipped rather than guessed: presence
   * gating and the push's own target both need a real session id, and
   * `runEventsSince`'s own docstring states why the caller, not the store,
   * makes that call.
   */
  private pushNewRuns(projects: Set<string>): void {
    const coord = this.deps.coord;
    if (!coord) return;
    for (const r of coord.runEventsSince(this.lastRunNotifyId)) {
      // A row whose state did not change is an OBSERVATION, not a transition —
      // every `recordRunEvent` row is one by construction. Pushing it would
      // title and tag off `toState` alone, so it arrives as a duplicate of the
      // transition that actually happened, carrying none of the fact it was
      // written to record (wave 2, F2 — the skill preflight is the first such
      // row on a bound run). The watermark still advances past it below.
      if (r.sessionId !== null && r.fromState !== r.toState) {
        this.pushOne({
          kind: 'run', sessionId: r.sessionId, project: r.project,
          title: `▸ ${r.toState} › ${r.workspace ?? r.project}`,
          body: `program:${r.program} wave ${r.wave}/${r.waveOf ?? '?'}`,
          runId: r.runId,
          tag: `run-${r.runId}-${r.toState}`,
          recordAlways: true,
          recordOnly: r.toState === 'closing',
        }, projects);
      }
      this.lastRunNotifyId = r.eventId;
    }
  }

  /**
   * Every push goes through here, so the copy rules are stated once.
   *
   *  - Project context ONLY when more than one project is active. The server
   *    knows the whole fleet at push time, so it can tell — and "✓ ccrc-pwa"
   *    on a fleet running one project is noise dressed as information.
   *  - NOTHING PUSHES for a session the operator is looking at right now. A
   *    notification for the pane on your screen trains you to dismiss
   *    notifications. AMENDED for Build 7 (spec:238-240) — this used to be
   *    absolute, gating the RECORD too, and it still is for `ask`/`done`/
   *    `merged`. But agent-to-agent mail (and a run transition) is a record,
   *    not a "needs your eyes" ping: gating the record on presence would mean
   *    the operator watching a session ERASES the log of a message they
   *    never saw. `recordAlways` exempts the RECORD from this gate; the PUSH
   *    stays gated exactly as before, unconditionally, for every kind.
   *  - The log records what this method DECIDED to raise — after the presence
   *    gate, before delivery, and never corrected by delivery's outcome. It is
   *    not a record of what was sent: recording is unconditional while `push`
   *    is optional, so a reconnecting client's catch-up can and will list
   *    events no device ever received. `NotifyEvent`'s own docstring is the
   *    wire contract for that; keep the two saying the same thing. The
   *    durable feed (`CoordStore.recordFeedEvent`, Task 10) is written at the
   *    SAME point for the SAME reason, over ALL kinds — not just Build 7's
   *    two — so the archive behind the ring can never disagree with what the
   *    ring itself would have said.
   *
   *  `notifyLog` and `push` are independently optional, which is the reason
   *  above: the catch-up log is useful even on a box with no VAPID keys
   *  configured, so it is never gated on `push` being present. `coord` is a
   *  THIRD, independently-optional sink for the identical reason: a box with
   *  no coordination database still gets a working ring and catch-up, it
   *  simply has no durable archive behind either.
   */
  private pushOne(e: {
    kind: NotifyEvent['kind']; sessionId: string; project: string; title: string; body: string;
    /** WHICH RUN this push is about, when the lane raising it knows one
     *  (`NotifyEvent.runId`). OPTIONAL here and REQUIRED on the wire: most of
     *  this method's call sites are about a session and about no run at all
     *  (no count here — the last one went stale at "seven"), and an omitted
     *  field and an explicit `null` are the SAME fact for this one field —
     *  "about no run" — which is why folding them costs nothing. The lanes
     *  that know a run pass the one they already have: the mail lane, the run
     *  lane, the blocked-sender lane and the stall lane (`sweepStalls`). */
    runId?: number | null;
    actions?: PushPayload['actions'];
    /** Overrides the default `${kind}-${sessionId}` collapse key. Mail MUST
     *  pass one: two different messages about one session must not replace
     *  each other in the tray (spec:236-237), which is exactly what the
     *  default key does — and does correctly for `ask`/`done`/`merged`, where
     *  the newest statement about a session supersedes the last. */
    tag?: string;
    /** Record even when the operator is looking at this session. THE PRESENCE
     *  GATE STILL SUPPRESSES THE PUSH; only the RECORD is exempt. spec:238-240:
     *  agent-to-agent mail is a record, not a "needs your eyes" ping — gating
     *  the record on presence would mean the operator watching a session
     *  ERASES the log of a message they never saw. */
    recordAlways?: boolean;
    /** Record it (subject to the presence gate above, same as every other
     *  kind) but never emit an actual push notification for it. Added for the
     *  `run` lane's `closing` transition alone (review finding 4, see
     *  `pushNewRuns`'s own docstring): the feed genuinely wants every
     *  transition, which `recordAlways` already gets it; the tray does not,
     *  and until now `pushOne` had no way to say so — `recordAlways` only
     *  ever exempted the RECORD from the presence gate above, never the push
     *  from firing at all. */
    recordOnly?: boolean;
  }, projects: Set<string>): void {
    const visible = this.deps.presence?.isVisible(e.sessionId) === true;
    if (visible && !e.recordAlways) return;
    // Decorated only when BOTH more than one project is active AND the
    // project is actually known (review finding 3) — an empty `e.project`
    // (run-less mail whose recipient session could not be resolved either,
    // `pushNewMail`'s own fallback chain) must degrade to no decoration at
    // all, never to a dangling ` · ` with nothing after it.
    const title = projects.size > 1 && e.project !== '' ? `${e.title} · ${e.project}` : e.title;
    const log = this.deps.notifyLog;
    const recorded = log?.record({ kind: e.kind, sessionId: e.sessionId, title, body: e.body,
      runId: e.runId ?? null });
    void log?.flush();
    // The durable feed archive — same record, same point, ALL kinds (Task
    // 10's orchestrator-added scope). Only reachable when NotifyLog actually
    // produced an event: no `notifyLog` configured means no `{epoch,seq}`
    // pair exists to mirror, and a feed row that mirrors nothing is not an
    // archive of anything. GUARDED (review finding 1): `node:sqlite` throws
    // SYNCHRONOUSLY (a full disk, a second connection holding coord.db's
    // write lock — `tx()`'s `BEGIN IMMEDIATE` takes it eagerly, no busy
    // timeout) and this call sits directly on the poll, reached from every
    // kind this method ever raises (the `done` push above, the ask push in
    // `detectDialogs`, and both new Task 10 lanes). `tick()`'s own rule is
    // that one bad lane must not kill the others — every neighbouring lane
    // already earns that non-throwing property one way or another (see
    // `tick()`'s own comment above `pushNewMail`/`pushNewRuns`) and this call
    // was the one exception reachable from every push, not just two lanes.
    // The ring record and the push below are UNAFFECTED by a failure here —
    // only the archive row is lost.
    if (log && recorded) {
      try { this.deps.coord?.recordFeedEvent(log.epoch, recorded); }
      catch (err) {
        console.warn(`ccrc-server: recordFeedEvent failed (${err instanceof Error ? err.message : String(err)}) — feed archive degraded, ring/push unaffected`);
      }
    }
    if (visible) return;                       // recorded, not pushed
    if (e.recordOnly) return;                   // recorded, deliberately never pushed
    void this.deps.push?.notify({
      title, body: e.body, sessionId: e.sessionId,
      tag: e.tag ?? `${e.kind}-${e.sessionId}`,
      ...(e.actions ? { actions: e.actions } : {}),
    });
  }

  /**
   * Refresh every session's hook state, every tick — no slower clock of its
   * own, unlike sweepTasks/sweepPr below: `readHookState` is one local JSON
   * read per session and already gates its own freshness and identity, so
   * there is nothing to amortize by sampling it less often. The map is
   * rebuilt each tick, same discipline as sweepTasks, so a de-registered
   * session's state can't linger.
   *
   * `records` is `tick()`'s own registry read, passed in rather than fetched
   * again here — see the comment in `tick()`. Optional (defaulting to its own
   * read) so this stays independently callable, same shape as
   * `detectDialogs` below.
   */
  private async sweepHookStates(records?: SessionRecord[]): Promise<void> {
    const now = Date.now();
    let recs: SessionRecord[];
    if (records) {
      recs = records;
    } else {
      // Own read — only exercised when this method is called with no
      // argument (tests only today; `tick()` always supplies its own
      // already-listed `records`). Same fail-shut seam as `tick()`'s shared
      // read and `sweepTasks`' own read below (blocking review findings
      // 1/3): `readRegistryMeasured`, and `this.hookStates` is left
      // UNTOUCHED on `{listed:false}` rather than rebuilt from an empty `[]`
      // — a failed listing must not wipe every retained entry the branch
      // below exists to protect.
      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
      if (!registryRead.listed) return;
      recs = registryRead.records;
    }
    const next = new Map<string, HookState>();
    await Promise.all(
      recs.map(async (r) => {
        // RETAIN, DON'T ERASE (Task 2, the heal side): a degraded row's
        // `r.uuid` reads `''` (registry ladder), and `readHookState`'s own
        // identity gate compares that against the hookstate file's REAL
        // `sessionId` — a comparison that can never match, so a fresh read
        // here always answers "nothing pending" for a session that may still
        // be mid-turn. Carry the PREVIOUS sweep's entry forward untouched
        // instead of letting one transient registry-read failure flicker the
        // attention bucket / askSummary off and back on. Pruning a
        // genuinely-reaped id is UNAFFECTED: `next` is rebuilt fresh from
        // THIS tick's `recs` every sweep, so an id truly gone from the
        // registry (not merely degraded — absent from `recs` altogether) is
        // never copied forward and ages out of `this.hookStates` on this
        // very sweep, exactly as it always has (verified: this map has no
        // OTHER pruning mechanism, so the full-rebuild-from-current-listing
        // shape is load-bearing and is preserved here unchanged).
        if (measuredIdentity(r) === null) {
          const prev = this.hookStates.get(r.id);
          if (prev) next.set(r.id, prev);
          return;
        }
        const hs = await readHookState(this.deps.io, this.deps.cfg.registryDir, r.id, r.uuid, now);
        if (hs) next.set(r.id, hs);
      }),
    );
    this.hookStates = next;
  }

  /** The usage lane (routing slice 0). ON ITS OWN CLOCK — at most once per
   *  USAGE_SWEEP_MS, the `TASK_SWEEP_MS` shape — because the reader treats a
   *  sidecar as fresh for USAGE_FRESH_S and one agent round-trip per session
   *  per 2-second tick would buy nothing. Rebuilt from the current listing so
   *  a purged row ages out; a row whose read came back UNREADABLE this sweep
   *  keeps its previous reading with its `stale` verdict RE-DERIVED against
   *  this sweep's clock (a transient read failure is not a change of fact,
   *  but `stale` is not a property of the sidecar — it is this sweep's own
   *  verdict, so copying the object forward unchanged would re-assert a
   *  freshness call nobody measured this sweep, unbounded — controller
   *  ruling R5 — `readUsageMeasured` tells unreadable from absent, which
   *  drops the row). */
  private async sweepUsage(records: SessionRecord[]): Promise<void> {
    const now = Date.now();
    if (this.lastUsageSweep !== 0 && now - this.lastUsageSweep < USAGE_SWEEP_MS) return;
    this.lastUsageSweep = now;
    const nowS = Math.floor(now / 1000);
    const next = new Map<string, SessionUsage>();
    await Promise.all(records.map(async (r) => {
      const read = await readUsageMeasured(this.deps.io, this.deps.cfg.registryDir, r.id, nowS);
      if (read.kind === 'reading') next.set(r.id, read.usage);
      else if (read.kind === 'unreadable') {
        const prev = this.usage.get(r.id);
        if (prev) next.set(r.id, { ...prev, stale: nowS - prev.ts > USAGE_FRESH_S });
      }
    }));
    this.usage = next;
  }

  currentUsage(): Map<string, SessionUsage> { return this.usage; }

  /**
   * Refresh every session's plan progress, at most once per TASK_SWEEP_MS. The
   * map is rebuilt from the registry each sweep, so a de-registered session's
   * progress can't linger.
   */
  private async sweepTasks(): Promise<void> {
    const now = Date.now();
    if (this.lastTaskSweep !== 0 && now - this.lastTaskSweep < TASK_SWEEP_MS) return;
    this.lastTaskSweep = now;
    // Own read, on its own slower clock — never shared with `tick()`'s
    // (`sweepHookStates` above takes `tick()`'s `records` as a parameter;
    // this method does not). `readRegistryMeasured`, fail shut on
    // `{listed:false}` (blocking review findings 1/3): the old `readRegistry`
    // `[]`-on-unlistable answer made a single dropped `io.readdir` here wipe
    // `this.taskProgress` for the WHOLE fleet — the same harm the
    // retain-don't-erase branch two lines down exists to prevent for one
    // degraded row, at fleet scale, on a clock throttled to fire once per
    // `TASK_SWEEP_MS` — so a hit here can leave every task tally blank for a
    // whole sweep interval, exactly the cost this method's own comment names
    // for a single row. `this.lastTaskSweep` is stamped above regardless
    // (same ordering `sweepMail`'s own fail-shut kill-switch check uses): a
    // failed listing still consumes this sweep's slot rather than retrying
    // every 2 s tick, the same throttle discipline every other sweep here
    // keeps.
    const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
    if (!registryRead.listed) return;
    const records = registryRead.records;
    const next = new Map<string, TaskProgress>();
    await Promise.all(
      records.map(async (r) => {
        // RETAIN, DON'T ERASE — same reasoning and same pruning guarantee as
        // `sweepHookStates` above: a degraded `r.wrapper` (reads `''`) makes
        // `configDirFor` answer `undefined` even though the session is
        // plainly still there, and this sweep runs on its OWN slower clock
        // (`TASK_SWEEP_MS`) — a value dropped here can sit blank for a
        // whole sweep interval before the next tick even gets a chance to
        // heal it, longer than the 2 s the hook-state lane risks. Carry the
        // last-known tally forward instead of blanking it on a guess.
        // `next` is still rebuilt fresh from THIS sweep's `records` every
        // time, so a genuinely-reaped id (absent from `records`, not merely
        // degraded) is never copied forward — pruning is unchanged.
        if (measuredIdentity(r) === null) {
          const prev = this.taskProgress.get(r.id);
          if (prev) next.set(r.id, prev);
          return;
        }
        const cfgDir = configDirFor(this.deps.cfg, r.wrapper);
        if (!cfgDir) return;
        // THE call site the widened `readTasks` was widened for (D-115): this
        // is what fills the fleet card's `done/total`, so this is where a task
        // file the box could not read has to land in the denominator rather
        // than leaving the tally altogether and reading `2/2` over a plan with
        // work still in it. The whole read goes into `taskProgress` — the
        // count is not this caller's to interpret, and passing the pair rather
        // than unpacking it is what keeps the one rule ("unmeasured is total,
        // never done") in one place.
        //
        // One consequence in the safe direction: a session whose EVERY task
        // file is unreadable now sets a `0/N` row here where it used to set
        // nothing at all, because `taskProgress` no longer reads an empty
        // `tasks` as "no plan" on its own. That is a row saying "N to do,
        // none measurably done", which is what this sweep actually knows.
        const read = await readTasks(this.deps.io, cfgDir, r.uuid);
        // RETAIN, DON'T ERASE — the SAME rule as the degraded-identity branch
        // at the top of this callback, reached by the other route. `readdir`
        // answering null folds "no such directory" into "the directory would
        // not list", and this sweep runs on the slow `TASK_SWEEP_MS` clock, so
        // erasing on it blanks a measured `7/12` for a whole sweep interval
        // and the card renders it identically to a session that never had a
        // plan (`SessionLine.tsx` hides the chip entirely on null).
        //
        // Safe in the folded direction too: a session that genuinely has no
        // task directory has no `prev` to carry, so this is a no-op for the
        // ordinary shape. And `next` is still rebuilt from THIS sweep's
        // `records`, so a reaped id is never carried forward — pruning is
        // unchanged, exactly as the identity branch argues above.
        if (!read.listed) {
          const prev = this.taskProgress.get(r.id);
          if (prev) next.set(r.id, prev);
          return;
        }
        const p = taskProgress(read);
        if (p) next.set(r.id, p);
      }),
    );
    this.taskProgress = next;
  }

  /**
   * May we spend a transcript tail read on this session's title? Records the
   * state we read at, so the next sweep can tell whether anything could have
   * changed.
   *
   * A transcript with no `ai-title` is a PERMANENT state, not a startup window
   * — nine of the 609 on this box carry none, including some very large ones
   * — so re-reading them every ten seconds (`NAME_SWEEP_MS`, THIS lane's real
   * cadence, not a hypothetical one) forever is roughly 7.7 MB/min across the
   * agent WS to learn nothing: six sweeps a minute times nine transcripts
   * averaging under the 256 KB tail cap (`TITLE_TAIL_BYTES`). `NAME_SWEEP_MS`'s
   * own comment derives the faster, rejected 2 s-tick cost from this same
   * figure rather than re-measuring — the two must never state two different
   * numbers for the same nine files. Byte-identical bytes cannot have started
   * saying something they did not say last time. Copied from
   * `SessionStream.claimAskRead` (`sessionws.ts:178-187`), keyed per SESSION
   * rather than per stream because this map outlives any one socket.
   */
  private claimTitleRead(id: string, file: string, st: { size: number; mtimeMs: number } | null): boolean {
    if (st === null) {              // no transcript yet — nothing to read, nothing to remember
      this.titleProbe.delete(id);
      return false;
    }
    const p = this.titleProbe.get(id);
    if (p !== undefined && p.file === file && p.size === st.size && p.mtimeMs === st.mtimeMs) return false;
    this.titleProbe.set(id, { file, size: st.size, mtimeMs: st.mtimeMs });
    return true;
  }

  /**
   * Rename every workspace that is still on its born branch to the name Claude
   * Code already wrote. Four conditions, in this order, and the order is the
   * design:
   *
   *   1. it is a workspace, not a main checkout, and not archived — `ccd
   *      ws-archive` "DESTROYS NOTHING" (`ccd:5039`), so an archived row keeps
   *      `workspace`, `branch = ws/<slug>`, its worktree and its transcript,
   *      fully in scope for conditions 2-4 unless excluded here; same guard,
   *      same shape, as the skip right below this one in the file
   *      (`sweepMerged`, `r.workspace === null || r.archivedAt !== null`) —
   *      review finding 2;
   *   2. the REGISTRY says the branch is still exactly `ws/<workspace>` —
   *      condition 2 is also the idempotence marker, which is why there is no
   *      new registry field, no marker file and nothing to purge on reap;
   *   3. the fleet's ccd implements the verb — asked BEFORE the probe below is
   *      recorded, so a fleet that installs a newer ccd re-reads transcripts
   *      that have not changed since;
   *   4. this `(incarnation, derived name)` pair has not been attempted, AND
   *      the incarnation has not been retired outright by an earlier refusal
   *      that is permanent by construction (`PERMANENT_REFUSALS` — review
   *      finding 1; `nameSweepRetired` is checked first, since it is the
   *      cheaper question and answers it without a stat or a transcript
   *      read). "Incarnation" is `<id>#<uuid>`, not the bare session id — see
   *      `attemptedRenames`'s own docstring for why a recycled slug needs the
   *      uuid too.
   *
   * KNOWN GAP IN CONDITION 3, accepted and not engineered around: `ccd caps`
   * has advertised `ws-rename` since long before it took flags (`ccd:4413`), so
   * a fleet on an older ccd passes the verb gate. The old body binds the verb's
   * two arguments positionally — `local id="${1:?usage: …}"; local
   * new="${2:?…}"` — and this argv is `['ws-rename', '--session', <id>,
   * '--branch', <name>]`, so `$1` is the literal string `--session` and `$2`
   * is `<id>` — BOTH non-empty, so neither `${1:?}` nor `${2:?}` fires. It
   * falls through to `[[ -f "$REG/$id.uuid" ]] || die "no such session: $id"`
   * with `id` bound to `--session`, and dies `no such session: --session` —
   * NOT bash's own usage refusal (measured; see review finding 3). That is one
   * non-ok result per (session, derived name), absorbed by the retry guard,
   * and the rollout is agent-first so the window is one deploy long.
   *
   * The `<id>.uuid` inherited limitation applies and is not fixed here: it is
   * written once at `ccd start` and never refreshed, so after a `/clear` the
   * resolved path points at the superseded transcript. The chat stream and
   * `sessionCommands` share it; in practice this fires minutes after creation,
   * when the uuid is fresh.
   *
   * PUBLIC, unlike `sweepTasks`/`sweepPr`, and for a reason that is about the
   * tests being real rather than about convenience: `tick()` dispatches this
   * with `void` (it can sit on the queue for minutes), so a test that awaits
   * `tick()` has NOT awaited the sweep — every negative assertion about it
   * would pass while it was still running. `tick()` is already public for the
   * same class of reason.
   */
  async sweepNames(): Promise<void> {
    const now = Date.now();
    if (this.lastNameSweep !== 0 && now - this.lastNameSweep < NAME_SWEEP_MS) return;
    this.lastNameSweep = now;
    // The REGISTRY's branch, never the assembled `FleetSession.branch`: that one
    // is the pane's branch, else the worktree HEAD's, else this (fleet.ts), so it
    // lags a rename by however long Claude Code takes to re-render its pane.
    // Same reason sweepTasks and sweepPr read the registry themselves.
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    for (const r of records) {
      // SKIP a degraded row before anything else: an unmeasured `uuid`
      // computes an `incarnation` key (`${r.id}#${identity.uuid}`, below)
      // belonging to no real incarnation — `''` for every degraded session,
      // so two unrelated degraded sessions would collide on the SAME
      // `attemptedRenames`/`nameSweepRetired` budget — and an unmeasured
      // `.archivedAt` would defeat the archived-exclusion test right below
      // (a false null there makes an already-archived row look eligible for
      // a rename it must never receive: `ws-rename` on an archived worktree).
      const identity = measuredIdentity(r);
      if (identity === null) continue;
      // `ws-archive` destroys nothing — an archived row is still `workspace
      // !== null` with `branch` still at the born name — so it is excluded
      // here explicitly, the same shape `sweepMerged` below already uses.
      if (r.workspace === null || r.archivedAt !== null) continue;
      const born = `ws/${r.workspace}`;
      if (r.branch !== born) continue;
      // TWELFTH CONDITION (Wave 3 §3.1). A claimed workspace is not renamed —
      // `sessionLabel` reads `branch` before `workspace`, so a rename mid-wave
      // changes what every surface calls a worker the coordinator's ledger
      // already names. BOTH halves are needed and they are in cost order:
      // `held` is a field on the row this loop already read, and it covers the
      // ordinary dispatch (the hold lands before the brief, and the sweep needs
      // an ai-title that only exists once the worker answers the brief);
      // `openRunsForSession` is a query, short-circuited away for every claimed
      // row, and it covers the workspace created by hand and adopted into a run
      // via `POST /api/runs` with a `sessionId`, which reaches `dispatched`
      // with no `.hold` on disk.
      //
      // `?.`-CHAINED, and not by taste: `testDeps` supplies no `coord` and this
      // class already treats the store as optional on eight other lines. A
      // non-optional call here TypeErrors every watcher test in the tree that
      // does not wire a store.
      //
      // Doubt reads as HELD, matching ccd's four `-e` hold readers:
      // `readRegistry` maps an unreadable-but-listed `.hold` to HOLD_UNREADABLE
      // and an empty one to HOLD_NO_REASON, both NON-null, so `!== null` is the
      // whole test and must not grow an emptiness clause.
      //
      // D-2545: a REFUSAL reads as CLAIMED too, on the same "doubt reads as
      // HELD" rule this comment already states for an unreadable `.hold`. The
      // sweep's act is a branch rename; a workspace this box could not prove
      // unclaimed is one it must not rename.
      const sib = this.deps.coord?.openRunsForSession(r.id);
      if (r.held !== null || (sib !== undefined && (!sib.ok || sib.siblings.length > 0))) continue;
      // Keyed by id AND uuid, not id alone: `<project>-<slug>` is a SLUG,
      // recycled by ws-reap (`ccd:3313`'s "144 per project, recycled") —
      // `_ws_slug_free` only ever checks live registry rows, which `_reg_purge`
      // deletes on reap, so nothing stops a later `ws-add` drawing the same
      // slug for an unrelated workspace. `identity.uuid` is the Claude Code
      // session uuid, freshly minted by every `ws-add`, so a recycled id
      // pairs with a NEW uuid and this key cannot collide with a retired
      // incarnation of the same id — the same self-healing property
      // `titleProbe` already has by keying on a transcript PATH that changes
      // with the uuid.
      const incarnation = `${r.id}#${identity.uuid}`;
      // The cheapest question in the function, asked before anything that
      // costs a stat or a read: THIS INCARNATION, once retired by a permanent
      // refusal (`has-upstream` and its siblings), never un-retires — but a
      // uuid rotation (`nameSweepRetired`'s docstring) computes a different
      // incarnation for the same session id, which was never added here.
      if (this.nameSweepRetired.has(incarnation)) continue;
      // A PROBE argv: it is never sent. `verbSupported` reads argv[0] only, and
      // asking here — before `claimTitleRead` writes anything — is what makes
      // "an unsupported verb records no attempt" true of the stat gate as well
      // as of the attempted set. Skips silently, same self-healing caveat as
      // `sweepPr`'s own `pr-state` gate below (fix round 4, task 14,
      // Minor #5): automatic in remote mode, on THIS WATCHER's own 60s
      // timer (`CAPS_REFRESH_MS`) — not the agent's, which has none —
      // requires a server restart in local mode (`localcaps.ts`, one probe
      // at boot, no timer).
      if (!verbSupported(this.deps.fleetState,
                         CCD_ARGV.wsRename(r.id, born, sweepDec(this.deps.fleetState, 'sweep:names')))) continue;
      const cfgDir = configDirFor(this.deps.cfg, identity.wrapper);
      if (!cfgDir) continue;
      // NO `foreign`: a derived branch name is written into the row with no
      // banner attached to it, and a name taken from another account's frozen
      // copy is exactly the quiet wrongness this spec removes (§5.2). Rungs 1-5
      // are unconditional — a title should follow a transcript that moved
      // inside its own account.
      const file = (await this.transcripts.resolve({
        configDir: cfgDir, dir: identity.workdir, registryWorkdir: identity.workdir, uuid: identity.uuid,
      })).path;
      // `claimTitleRead` already refuses a null stat, so a `fallback` path costs
      // one stat and reads nothing — no extra branch needed here.
      if (!this.claimTitleRead(r.id, file, await this.deps.io.stat(file))) continue;
      const title = await readAiTitle(this.deps.io, file);
      if (title === null) continue;
      const branch = deriveBranch(title);
      // A title that slugifies to nothing has no pair to mark: the retry key is
      // `<incarnation>:<derived-branch>` and there is no derived branch. The
      // stat gate is what stops it being re-read, which is the same protection
      // the marked pairs get.
      if (branch === null) continue;
      const key = `${incarnation}:${branch}`;
      if (this.attemptedRenames.has(key)) continue;
      this.attemptedRenames.add(key);
      // AFTER the add, deliberately: the spec's error table marks this pair
      // attempted, and the key is the one this session would have used.
      if (branch === born) continue;      // the title already names the workspace
      // Through the per-session queue, so it serialises against every other
      // server-originated write on this session — the reap it must not race is
      // POST /workspace/reap, which is already queued. It does NOT serialise
      // against a ws-reap or ws-restore run by hand on the box: those take
      // `$REG/.reap-$id.lock`, which ws-rename does not, and that residue is
      // accepted (a hand-run reap on a workspace whose first turn is still
      // landing is not a case worth a lock for, and the rename is a
      // `git branch -m` a reap would immediately make moot).
      const res = await this.deps.queue.run(r.id, () => this.deps.runCcd(
        CCD_ARGV.wsRename(r.id, branch, sweepDec(this.deps.fleetState, 'sweep:names'))));
      if (!res.ok) {
        console.warn(`ccrc-server: ws-rename ${r.id} -> ${branch} failed: ${res.stderr.trim()}`);
        continue;
      }
      let answer: { refused?: unknown; old?: unknown; new?: unknown } = {};
      try { answer = JSON.parse(res.stdout.trim()) as typeof answer; }
      catch { /* not an answer we can read — an older ccd, or a fault */ }
      if (typeof answer.refused === 'string') {
        console.warn(`ccrc-server: ws-rename ${r.id} -> ${branch} refused: ${answer.refused}`);
        // Permanent by construction: nothing about a LATER title can make a
        // pushed branch un-pushed, or a foreign/unregistered worktree become
        // this session's own. Retire the session, not just this pair — see
        // `nameSweepRetired`.
        if (PERMANENT_REFUSALS.has(answer.refused)) this.nameSweepRetired.add(incarnation);
      } else if (typeof answer.old === 'string' && typeof answer.new === 'string') {
        // THE only line a successful rename ever writes — without it, the
        // sweep's most common outcome (the branch actually landing on the
        // title) leaves nothing a post-deploy audit can grep for.
        console.log(`ccrc-server: ws-rename ${r.id} ${answer.old} -> ${answer.new}`);
        // `res.ok` is true here even when `ccd`'s two origin probes
        // (`has-upstream`'s second check, the `$new` collision check) could
        // not reach origin: both warn-and-continue rather than refuse, so the
        // rename still succeeds and the only trace of the degradation is this
        // stderr string. Discarding it on the success arm alone (the `!res.ok`
        // branch above already surfaces stderr on a hard failure) lost the one
        // signal that a rename which LOOKED clean actually ran origin-blind.
        const warn = res.stderr.trim();
        if (warn !== '') console.warn(`ccrc-server: ws-rename ${r.id} -> ${branch}: ${warn}`);
      }
    }
  }

  /**
   * §1.6's census, and THE ONLY PRODUCER OF IT. Named once, deliberately, so
   * nobody adds a second — `reviveFleetSession` in particular must never become
   * one (the `fleet.ts` precedent exists to prevent exactly that shape, and it is
   * what makes splitting `DIVERGENCE_KINDS` in L0 from `divergences()` in L1
   * defensible).
   *
   * L4: it GATHERS (git's worktree records through `FleetIO`, open-run session
   * ids through `coord`) and it PUBLISHES. It DECIDES nothing — no ccd verb runs
   * here and nothing mutates. That is also what keeps `fleet.ts`'s
   * asymmetric-skew deferral valid: lifecycle stays a display-only qualifier, and
   * the deferral's own stated expiry ("if the census makes lifecycle drive an
   * adopt/respawn DECISION") has not been reached.
   *
   * PUBLIC for the reason `sweepNames` is public: `tick()` dispatches it with
   * `void`, so a test that awaits `tick()` has not awaited this.
   *
   * THE PROJECTS IT ASKS GIT ABOUT ARE THE PROJECTS THE REGISTRY NAMES, never a
   * listing of `projectsRoot`. That bounds the per-sweep cost to the fleet's
   * ACTIVE projects rather than to every checkout on the box, and it is a real
   * limit worth stating rather than discovering: a project whose every session
   * has been reaped contributes no rows, so its leftover worktrees go unnamed
   * until something is running there again. Widening it is a `readdir` of
   * `projectsRoot` per sweep plus a `.git/worktrees` read per project found —
   * a deliberate cost, not an oversight to be quietly fixed.
   *
   * `this.deps.coord` is `?.`-chained because `testDeps` supplies none — a
   * non-optional call TypeErrors fourteen `hold-gate` tests plus `pr-sweep`'s.
   */
  async sweepDivergences(records: SessionRecord[]): Promise<void> {
    // `Date.now()`, not an injected clock: this class has none, and `sweepNames`
    // just above reads the same way. `!== 0` is not a style tic — it is what
    // makes the FIRST sweep run immediately after a restart instead of waiting a
    // minute, and it is the shape `sweepNames` already ships.
    const now = Date.now();
    if (this.lastDivergenceSweep !== 0 && now - this.lastDivergenceSweep < DIVERGENCE_SWEEP_MS) return;
    this.lastDivergenceSweep = now;
    const projects = [...new Set(records.map((r) => r.project))];
    const worktrees: DivergenceInput['worktrees'][number][] = [];
    const headBranch = new Map<string, string | null>();
    const fleetHeads = new Map<string, { project: string; branch: string | null }>();
    const transientlyUnread = new Set<string>();
    // The delegation lane's input, taken from THIS pass's reads: each project's census, and the registry generations of the ids the
    // pass was handed, read once BEFORE the census and once after it (R38, restored exactly by R47): the first round COMPLETES before
    // the first census read is issued, so a generation bump between a census read and a late first read cannot label old-incarnation
    // evidence measured. It is one concurrent round (one round trip), the only delivery IO ahead of the console's HEAD labels; the
    // SECOND round runs after `settleHeads()`. No second admin-directory read and no schedule of its own.
    const generationOf = (id: string) => childReclaimGenerationRead(this.deps.io, this.deps.cfg.registryDir, id);
    const generationsBefore = await readParentGenerations(generationOf, records.map((r) => r.id));
    const delegationProjects = new Map<string, WorktreeCensus>();
    for (const project of projects) {
      const census = await readWorktreeCensus(this.deps.io, this.deps.cfg.projectsRoot, project);
      delegationProjects.set(project, census);
      const read = census.read;
      // §1.7. Both refusals contribute nothing for this project — a census can
      // only ever suppress a finding here, never manufacture one — but they are
      // NAMED separately rather than collapsed, because they are different facts
      // and only one of them is transient. `refused-project` is STANDING: the
      // registry keeps naming a project whose census this server will never read,
      // every sweep, forever, and silence is how that stays invisible. It gets one
      // line per sweep interval (60 s), which is the same cadence the `runs()`
      // guard just below already logs at. `unlistable` is a read that failed and
      // may succeed next minute — no log, or a broken permission would print
      // hourly for as long as it lasts.
      //
      // `not-a-checkout` and `unreachable` are the two that used to be ONE word,
      // and the reason they are two is that a log line could not say which — a
      // standing condition (a project directory that is not a checkout) and a
      // transient one (a dropped agent socket, which `FleetIO.stat` reports as
      // `null` exactly like a missing path) sharing a value at a seam. They are
      // told apart now by a rung walk up the path, not by a guess: see
      // `WorktreeRead`'s own docstring. BOTH stay quiet, for opposite reasons.
      // `not-a-checkout` is STANDING like `refused-project` but is a normal
      // shape of the box rather than a defect — four fleet projects answer it
      // every sweep, for ever, and four lines a minute is a log nobody reads.
      // `unreachable` is a read that failed and may succeed next minute, the
      // same argument that keeps `unlistable` quiet. What the split buys the
      // census is unchanged and is the point: neither is reported as a measured
      // zero, and the next consumer inherits the distinction instead of a value
      // that already threw it away.
      //
      // `ok: true` with an EMPTY array is the last case and is NOT a refusal:
      // git creates `.git/worktrees` with the first linked worktree, so its
      // absence — once `<project>/.git` has answered, which is what separates it
      // from `unreachable` — is a measured zero. It falls through the loop below
      // contributing nothing, which is the correct handling of a real answer that
      // happens to be empty — not the same code path as not knowing.
      if (!read.ok) {
        if (read.reason === 'refused-project') {
          console.warn(`ccrc-server: sweepDivergences cannot census project ${JSON.stringify(project)} — the name is refused by the path guard, so this project is permanently absent from the census`);
        }
        if (read.reason === 'unreachable' || read.reason === 'unlistable') transientlyUnread.add(project);
        continue;
      }
      for (const w of read.records) {
        worktrees.push({ project, name: w.name, path: w.path });
        headBranch.set(`${project}/${w.name}`, w.headBranch);
        const id = ccdIdForWorktree(project, w.path);
        if (id !== null) fleetHeads.set(id, { project, branch: w.headBranch });
      }
    }
    // The fleet's copy (see `headBranches`), written BEFORE any of the census's
    // own early returns below: the HEAD reads above are valid whether or not
    // the registry listing or the run read then refuses. A project that
    // answered replaces its entries, so a removed worktree's goes with it. One
    // whose worktree LISTING failed transiently (`unreachable`, `unlistable`)
    // keeps the last it had, so a dropped agent round trip does not flip every
    // label in it back to the registry's name for a minute; a STANDING refusal
    // (`not-a-checkout`, `refused-project`) keeps nothing. NOT covered: a
    // per-worktree `gitdir`/`HEAD` read that fails inside a listing that
    // answered — `readWorktreeCensus`'s `read` reports those as a dropped record or a
    // null HEAD, indistinguishable from a detached one, so that row falls to
    // the registry until the next sweep.
    for (const [id, h] of this.headBranches) {
      if (transientlyUnread.has(h.project) && !fleetHeads.has(id)) fleetHeads.set(id, h);
    }
    this.headBranches = fleetHeads;
    this.settleHeads();
    // The delegation lane's input, AFTER the console's labels are settled and BEFORE this method's own early returns below.
    this.delegationCensus = {
      measuredAt: now, projects: delegationProjects,
      incarnations: await settleParentIncarnations(generationOf, generationsBefore),
    };
    // THE CLAIM EVIDENCE, READ AFTER THE WORKTREE EVIDENCE IT IS WEIGHED
    // AGAINST — and that ordering is the whole reason this is a second listing
    // rather than the one `tick()` already took (D-283's "one listing,
    // shared"). ccd writes in a fixed order: `git worktree add` first, then the
    // registry field by field. So a listing taken BEFORE these git records —
    // which is what being handed `registryRead.names` from the top of the tick
    // meant, three awaited lanes earlier — can miss a `_reg_set` that had
    // already landed by the time the records were read, and reassemble "a
    // worktree no registry row claims" out of two reads neither of which ever
    // saw that state. That is the mid-`ws-add` false positive 502e35a closed in
    // the predicate, arriving through read order instead, and the debounce does
    // not cover it: the skew repeats every sweep for as long as the write keeps
    // landing in the window. Read late, the listing is never staler than the
    // records, and the only unclaimed worktrees left are the ones that really
    // were unclaimed when git was asked.
    //
    // Cost is ONE readdir per sweep interval (60 s), not per tick — the lane
    // clock above has already returned on every other call by the time this
    // line runs. D-283 was about the per-tick whole-fleet read, 31 field
    // reads [registry-read-census:fields] per session in remote mode; this is
    // one round trip a minute.
    const registryNames = await this.deps.io.readdir(this.deps.cfg.registryDir);
    if (registryNames === null) {
      // FAIL SHUT, and this is the one read in this method where the direction
      // is dangerous. Everywhere else a failed read can only SUPPRESS a finding
      // (an unlistable `.git/worktrees` contributes no worktrees). A failed
      // registry listing read as `[]` claims nothing claims anything — every
      // worktree on the box unclaimed at once, on the kind whose repair deletes
      // worktrees. Same evidence-not-time bound `tick()`'s own
      // `!registryRead.listed` return draws, and the memory below is left
      // standing for the reason the `runs()` arm states.
      console.warn('ccrc-server: sweepDivergences could not list the registry — no census this pass, because "nothing claims anything" is not what a failed read proves');
      return;
    }
    let openRunSessionIds = new Set<string>();
    let openRunIds = new Set<number>();
    try {
      const read = this.deps.coord?.runs();
      // D-2545: a refusal skips the census this pass, exactly as the throw arm
      // below does and for the same stated reason. NOT `?? []` — an empty run
      // set is what makes every claimed worktree look unclaimed, which is the
      // one direction this sweep's own comment above calls dangerous.
      if (read !== undefined && !read.ok) {
        console.warn(`ccrc-server: sweepDivergences runs() refused (${read.detail}) — no census this pass`);
        return;
      }
      const openRuns = read?.runs ?? [];
      openRunSessionIds = new Set(
        openRuns.map((r) => r.sessionId).filter((id): id is string => id !== null));
      openRunIds = new Set(openRuns.map((r) => r.id));
    } catch (err) {
      // `coord.runs()` walks straight into synchronous `node:sqlite` — the same
      // fault every neighbouring lane already guards. A failed read skips the
      // census this pass rather than killing the poll.
      console.warn(`ccrc-server: sweepDivergences runs() failed (${err instanceof Error ? err.message : String(err)}) — one bad read must not kill the poll`);
      return;
    }
    // THE CLAIM ROWS, degrade-to-empty like `provenance` below: an absence can
    // only suppress a claim-orphan finding, never manufacture one.
    let liveClaims: DivergenceInput['liveClaims'] = [];
    try {
      liveClaims = (this.deps.coord?.activeClaims() ?? []).flatMap((c) =>
        c.paths.map((p) => ({
          id: c.id, sessionId: c.heldBy, project: c.project, path: p, runId: c.runId,
        })));
    } catch (err) {
      console.warn(`ccrc-server: sweepDivergences activeClaims failed (${err instanceof Error ? err.message : String(err)}) — no claim findings this pass`);
    }
    // THE REGISTRY'S `.branch`, never the assembled `FleetSession.branch`:
    // `assembleFleet` puts the pane's branch ahead of HEAD and this (fleet.ts), and the
    // STATUSLINE wins there, so a census fed from `sessions` would compare git's
    // HEAD against whatever Claude Code last rendered. The field a
    // done-fingerprint trusts, and the field a rename moves, is this one — which
    // is exactly why this method takes `records`, the same reason `sweepNames`
    // reads the registry itself.
    // EMPTY ON REFUSAL, never stale: an absence is not a disagreement, and the
    // same one-bad-read-must-not-kill-the-poll rule the `runs()` arm above
    // states — except this one DEGRADES rather than returning, because the
    // other four kinds are unaffected by a mirror this lane could not read.
    let provenance: ProvenancePair[] = [];
    try {
      provenance = this.deps.coord?.recentProvenance(now - PROVENANCE_WINDOW_MS, 500) ?? [];
    } catch (err) {
      console.warn(`ccrc-server: sweepDivergences recentProvenance failed (${err instanceof Error ? err.message : String(err)}) — no provenance findings this pass`);
    }
    const classifierInput = {
      records: records.map((r) => ({
        id: r.id, project: r.project, workspace: r.workspace, workdir: r.workdir,
        branch: r.branch, held: r.held, archivedAt: r.archivedAt,
        // OFF THE RECORDS THIS SWEEP WAS HANDED, never a second read. The tick
        // already measured `.supervised` for every row (`registry.ts:187`), and
        // a re-read here would be a whole-fleet field sweep a minute for a
        // number sitting in scope.
        // D-1157. `r.supervisedAt` is epoch SECONDS and this seam is compared
        // against `nowMs`; `registrySecondsToMs` is the one place that
        // conversion lives, and `supervisedAtMs` is what the field is called
        // so a raw stamp assigned here reads wrong on sight.
        supervisedAtMs: registrySecondsToMs(r.supervisedAt),
      })),
      worktrees, headBranch, openRunSessionIds, openRunIds, liveClaims,
      // THE REGISTRY'S OWN DIRECTORY LISTING — the evidence that a workspace
      // mid-`ws-add` is claimed before its row parses (see
      // `unclaimedWorktrees`), taken above AFTER git's records for the ordering
      // reason stated there.
      registryNames,
      // THE CLOCK, HANDED IN. `divergence.ts` is pure and reads no clock of its
      // own, so the census and the ladder cannot drift against each other by
      // reading two different `Date.now()`s.
      nowMs: now,
      // THE PAIRS, NOT THE VERDICT. `corroboration` is L0's and is called in
      // `divergence.ts`; this lane only reads rows. Bounded to the last hour so
      // a standing disagreement is re-reported while it stands and drops off
      // once the session has been restarted honestly — the census is a list of
      // things to look at now, not an archive (that is `GET /api/lifecycle`).
      provenance,
    };
    const found = divergences({
      ...classifierInput, unclaimedLastSweep: this.lastUnclaimedWorktrees,
    });
    // The memory the debounce runs on, replaced only on a sweep that got this
    // far. An early return above (`coord.runs()` failed) leaves the PREVIOUS
    // observation standing rather than clearing it: a failed read is not
    // evidence that a worktree became claimed, and dropping the memory there
    // would silently re-arm the debounce and delay every finding another
    // interval. The classifier re-derives the same set internally rather than
    // being handed it, so this stays ONE definition of the claim rule.
    this.lastUnclaimedWorktrees = new Set(unclaimedWorktrees(classifierInput));
    const json = JSON.stringify(found);
    if (json === this.lastDivergenceJson) return;
    this.lastDivergenceJson = json;
    this.bus.emit('divergence', found);
  }

  /**
   * THE CHILD-RECLAIM LANE (child-reclamation wave 4, spec §5.7 "On the
   * sweep"). A SIBLING of `sweepDivergences`, never a branch of it: that lane
   * "DECIDES nothing — no ccd verb runs here and nothing mutates", and this
   * one asks for a deletion. It decides nothing either — every verdict is
   * `childReclaimSweepVerdict`'s (L1) — but it APPLIES them, through wave 3's
   * one executor, which both triggers share.
   *
   * THE SUBJECT IS THE MARKER. It walks the registry rows this tick already
   * read and acts only on those whose `.child` marker names a minting run, so
   * it reaches the children the close path cannot: dispatch's two arms that
   * mint a child and fail to bind it. An absent minting run is never
   * eligible.
   *
   * WHICH PASS, AND WHY IT DOES NOT RACE THE WRITE ROUTES. The 2 s tick's own
   * registry read, throttled to `CHILD_RECLAIM_SWEEP_MS`. It cannot take the
   * coordination mutex (not exported, and the watcher holds no handle on it),
   * so it does not try: every coord.db read here is one synchronous
   * `DatabaseSync` statement, atomic against the routes' writes; the executor
   * re-reads the marker and the sibling list itself immediately before it
   * composes the argv; the session's `KeyedQueue` serialises this lane against
   * the close path's reclaim and the reap route for that session; and ccd
   * recomputes the `--expect` fingerprint inside its lock, refusing
   * `state-changed` on any drift. The server narrows the window; the re-proof
   * on the box ends it.
   *
   * PRESENCE IS A DEFER, NOT AN INELIGIBILITY — the executor measures it (the
   * server's visibility claim) and ccd measures it (rungs 5 and 6), and each
   * answers `deferred`. That is what lets the ceiling bound it: a presence
   * that reset eligibility would reset the clock with it, and the drawer's
   * `tmux attach` on a locked phone would wedge a child forever.
   *
   * A `hold-retired` verdict — a hold this build proved was written by one of
   * this child's own runs, whose accounting has since retired (spec §5.7's
   * "no hold" conjunct) — never reaches the ordinary reclaim path directly:
   * `ws-reclaim`'s own rung 4 refuses any hold. Instead, on the SECOND
   * consecutive pass this pass answers it for the SAME workspace generation
   * (spec §5.7), the child's own `release` payload is queued as its own job
   * (`releaseRetiredChildHold`, `coord/childReclaim.
   * ts`) on the child's `KeyedQueue` key — which re-proves every fact it
   * relies on before it ever composes `ws-release`, and whose own outcome
   * (`released`/`not-held`/`changed`/`failed`) writes back nothing but the
   * memory this lane already keeps. The now-unheld child is then judged
   * afresh by the ordinary verdict, on the ordinary two-pass rule, through
   * `reclaimChild` like any other. The RESIDUAL this accepts: a hold written
   * between the job's own re-read and ccd's unlink is removed anyway — a
   * narrow window the job's own docstring states in full.
   *
   * PUBLIC for `sweepDivergences`'s reason: `tick()` dispatches it with
   * `void`.
   */
  async sweepChildReclaim(records: readonly SessionRecord[], names: readonly string[]): Promise<void> {
    const coord = this.deps.coord;
    if (!coord) return;
    // THE THROTTLE, stamped BEFORE the gather below (spec §5.7), on the
    // monotonic clock: a tick that lands while this pass gathers is throttled,
    // so no second pass starts within the interval.
    const gate = this.childReclaimLaneNow().monoMs;
    if (this.lastChildReclaimSweep !== null && gate - this.lastChildReclaimSweep < CHILD_RECLAIM_SWEEP_MS) return;
    this.lastChildReclaimSweep = gate;
    // THE PASS'S ONE AWAIT BEFORE ITS LOOP (spec §5.5): every marked row's
    // registry generation, read concurrently. Gathered whole, here, so the
    // per-child loop below stays synchronous: no await sits between a row's
    // entry read and its write. A pass that a newer one OVERTOOK while it
    // gathered (a read slower than the throttle) decides nothing.
    // THE RECORDS ARE OLDER THAN THE GATHER, A STATED RESIDUAL (spec §7): the tick read `records` before it
    // awaited its other lanes, and the generation is read only here. So a re-mint inside that gap gives the
    // new workspace's FIRST sighting the OLD row's fields (its hold, workspace and identity) under the new
    // generation, and the twice-observed rule covers the new row's own fields on one pass, not two. The
    // executor's generation re-read cannot tell this case apart: both sightings carry the new generation.
    // What keeps it safe: the pass that asks judges the new row's own records in full; the entry and its
    // presence episode are keyed to the generation, so no episode the old workspace ripened licenses the
    // new one; the executor re-reads the row's marker, open runs, switch and presence before it asks the
    // box; and ccd's audit judges the row's own hold, attachment and tree, and re-proves them in its lock.
    const pass = ++this.childReclaimPassSeq;
    const regGenerations = await this.childReclaimGatherGenerations(records);
    if (pass !== this.childReclaimPassSeq) return;
    // The lane's two clocks, read ONCE for the pass's decisions (spec §5.7),
    // AFTER the gather, so no decision clock is older than the evidence it
    // judges. `mono` is the in-flight stall clock and the entry's own instants
    // (`ChildReclaimSweepEntry` names the exceptions). `now`, the wall clock,
    // is what is compared with another process's stamps (the generation
    // fences, the attention list, the verdict's spawn-stall window), and what
    // L1 stamps from `ask.at.wallMs`: the displayed `firstDeferredAt` and
    // `lastPresenceWallAt`, the presence gap's second operand (the gap reads
    // the larger of the monotonic and the wall-clock difference).
    const asked = this.childReclaimLaneNow();
    const now = asked.wallMs;
    const mono = asked.monoMs;
    // THE THROTTLE, RE-STAMPED with this pass's decision clock (spec §5.7):
    // the pass was not overtaken, so it decides now, and the next pass must
    // start a whole interval after THIS decision, not after the gate stamped
    // above. Without it, a gather that settled just short of an interval would
    // let the next pass decide a moment later: two sightings in one interval.
    this.lastChildReclaimSweep = mono;

    // ONE — the attention list's mirror arms, and the pass's coordination-history
    // read, from the mirror ALONE (spec §5.9: "derived from the lifecycle mirror so
    // a restart does not lose it"), BEFORE either early return below: a
    // paused fleet, or a fleet host without both `reclaim-v1` and
    // `reclaim-pause-v1`, still has children standing under terminal
    // refusals or failing past the ceiling, and the report must not go dark
    // because the lane is idle. Per LISTED row whose id the mirror has a
    // `reclaim` row for: that session's history — `lifecycleCreatesFor`
    // MERGED with the windowed `lifecycleFor` read, so a long-refused
    // child's own opening `create` never drops off this list just because its
    // window has scrolled past it — cut to its CURRENT workspace generation
    // by the one fence (`at` = now; spec §5.6 — a refusal of an earlier
    // workspace under a recycled slug is not this child's), then the LATEST
    // reclaim event of that generation, of ANY outcome, `intent` included (an
    // attempt in flight, or one that died mid-way, lists nothing), as the L1
    // input row.
    //
    // ONE STORE READ of every coordinator claim per pass too — each session's
    // claims folded to their latest instant, which the verdict fences to the
    // child's own generation, so a child counts as coordinating only when it
    // has coordinated in its own generation (`childReclaimHasCoordinated`'s
    // fence, `childReclaimCoordinated`; spec §1 rule 4: manual cleanup is
    // reserved for a coordinator's OWN workspace; spec §5.6: slugs recycle) —
    // in the SAME try as the mirror read: a throw here proves as little about
    // who has coordinated as a failed mirror read proves about who is
    // terminal, so BOTH READS TOGETHER fail the WHOLE pass shut: an exception
    // from either one is caught below, this pass makes NO reclaim decision
    // for ANY child (the whole per-child loop is downstream of this try
    // succeeding), and the twice-observed memory is dropped so nothing is
    // asked on the strength of a partial measurement.
    let latest: ChildReclaimJournalRow[];
    let claims: ReadonlyMap<string, ChildReclaimCoordinatorClaim>;
    // THE PERSISTENT TIER'S SEED (spec §5.7) reads each child's CURRENT generation, the slice this read already
    // cuts: kept per id for the first sightings below, never read again.
    const tierGenerations = new Map<string, readonly MirroredLifecycleEvent[]>();
    try {
      const withReclaim = coord.childReclaimSessionIds();
      claims = coord.childReclaimCoordinatorClaims();
      latest = [];
      for (const r of records) {
        if (!withReclaim.has(r.id)) continue;
        const gen = childReclaimGeneration(this.childReclaimAttentionGenerationRows(coord, r.id), now);
        tierGenerations.set(r.id, gen);
        const row = childReclaimJournalRow(gen, childReclaimLatest(gen));
        if (row !== null) latest.push(row);
      }
    } catch (err) {
      // FAIL SHUT: a failed read proves nothing about which children are
      // terminal or which have coordinated in their own generation. So this
      // pass decides nothing, and publishes no attention list: the last one
      // stands. It drops the sweep state (`childReclaimSweepState`, the
      // twice-observed memory), so no child acts on the strength of a pass
      // that measured nothing. That state is also the chip's defer source, so
      // a deferring or failing child's chip loses its defer sentence, which
      // returns only once the sweep asks again and the child defers or fails
      // again. And it reduces the recorded verdicts to the kept ones
      // (`childReclaimKeptVerdicts`), so until the next judging pass the chip
      // holds no verdict for any other child: where nothing else answers (a
      // journal event, a review child, or the switch, which already reads
      // `paused`), a held or doubt child's reads "no verdict yet", where it
      // gave its hold or doubt sentence.
      if (this.childReclaimJudged !== null) this.childReclaimJudged = childReclaimKeptVerdicts(this.childReclaimJudged);
      console.warn(`ccrc-server: sweepChildReclaim could not read the lifecycle mirror or the coordination history (${err instanceof Error ? err.message : String(err)}) — no reclaim decisions this pass`);
      this.childReclaimSweepState.clear();
      this.childReclaimHoldRetiredSeen.clear();
      this.childReclaimReleaseAnswered.clear();
      return;
    }
    const live = new Map<string, number | null>(
      records.map((r): [string, number | null] => [r.id, r.child.kind === 'child' ? r.child.runId : null]));
    // A kept word is fed once per child per process, and "per child" ends with the registry row (spec
    // §5.9). A row still listed under a marker naming another run is a new child too: the feed below
    // keys the run (spec §5.6).
    for (const id of [...this.childReclaimKeptReported.keys()]) if (!live.has(id)) this.childReclaimKeptReported.delete(id);
    // The mirror arms; the list itself is written once, by `childReclaimPublishAttention`. No executor
    // answer ever writes it (spec §5.9 — see the `.then` below).
    const mirrorArms = childReclaimAttention({
      latest, live, kindOf: childReclaimTokenKind, stuckOf: isChildReclaimStuckToken, sentenceFor: refusalSentence, nowMs: now,
    });
    // ONE-b: the kept-leaf items (spec §5.6, §5.9). They are the clips directories and temp roots ccd kept
    // on a reclaim that completed. Read from the mirror ALONE, so a restart rebuilds them, and NEVER filtered
    // by `live`: after a `done`, ccd has purged the registry row, so no listing names the child.
    // ITS OWN TRY, AFTER THE FAIL-SHUT TRY ABOVE. The items gate nothing: no verdict, due set, lease or
    // request reads them. So a failed read here never fails the pass shut. It keeps the last items, as a
    // failed mirror read keeps the whole list, and the pass decides exactly as it would have. When the
    // fail-shut try failed, this read is never reached, and that pass publishes nothing.
    // BEFORE the two early returns below, so a paused or capability-less pass lists them too.
    try {
      const rows = coord.lifecycleReclaimRowsSince(childReclaimLeafKeptSince(now));
      this.childReclaimLeaves = childReclaimLeafKept({
        rows, ends: coord.lifecycleLeafEndsFor(rows.map((r) => r.sessionId)), nowMs: now });
    } catch (err) {
      console.warn(`ccrc-server: sweepChildReclaim could not read the kept leaves (${err instanceof Error ? err.message : String(err)}) — the last kept-leaf items stand, and no reclaim decision reads them`);
    }
    // The feed keeps the record once an item has ended (spec §5.9): one row per source row per process.
    // Recorded, never pushed.
    for (const k of this.childReclaimLeaves) {
      if (this.childReclaimLeafFed.has(k.source)) continue;
      this.childReclaimLeafFed.add(k.source);
      recordChildReclaimLeafKeptFeed({ coord, notifyLog: this.deps.notifyLog }, k);
    }

    // TWO — the switches (spec §5.8, "the fourth [reader] is the one that
    // matters" — the box itself, not merely the server): BOTH caps must be
    // advertised, not just `reclaim-v1` — a box that cannot answer
    // `reclaim-pause` cannot be told to stop from the phone, so an automatic
    // reclaim must never run there at all. No `reclaim-v1` on the fleet host
    // means the executor would answer `unsupported` for every child every
    // minute, each with a feed row; a raised `reclaim-paused` means stop.
    // Either way the memory is dropped: "the switches read clear" is itself an eligibility
    // conjunct, so a child needs two FRESH passes once a switch is lowered
    // (or the box gains the missing capability).
    if (!capSupported(this.deps.fleetState, RECLAIM_CAP) || !capSupported(this.deps.fleetState, RECLAIM_PAUSE_CAP)
        || names.includes(RECLAIM_PAUSE_MARKER)) {
      if (this.childReclaimJudged !== null) this.childReclaimJudged = childReclaimKeptVerdicts(this.childReclaimJudged);
      this.childReclaimPublishAttention(mirrorArms, live);
      this.childReclaimSweepState.clear();
      this.childReclaimHoldRetiredSeen.clear();
      this.childReclaimReleaseAnswered.clear();
      return;
    }

    // THREE — eligibility, per marked child, then GATHER the due ones, then
    // dispatch at most `CHILD_RECLAIM_MAX_IN_FLIGHT`. The
    // TERMINAL set is the mirror's terminal refusals ONLY — never the
    // attention list, which also names children whose reclaim keeps FAILING
    // past the ceiling, and a failure is retried (backing off) for as long as
    // it fails. It comes from the mirror alone (bound to the current
    // generation) and survives a restart, and it includes a terminal ladder
    // refusal found at AUDIT time: wave 3's `cmd_ws_audit --reclaim` journals
    // exactly the terminal verdicts (`verb ws-audit`), so the mirror holds
    // them as it holds `ws-reclaim`'s. A retryable verdict found there is
    // journaled nowhere and needs no exclusion — it is retried by design. Its
    // unmeasured answer is journaled now, as a `failed` line (spec §5.9), which
    // the TERMINAL set never reads.
    // Between the executor's `refused` answer and the mirror lane's ingest
    // (`LC_SWEEP_MS`) the child's entry is KEPT, not forgotten:
    // `childReclaimNextEntry` stamps its `refusedAt`, and `childReclaimDue`
    // holds off any re-ask until a whole defer ceiling after that — long
    // after the mirror has ingested the terminal line this set then reads.
    const terminal = new Set(latest
      .filter((row) => childReclaimTerminalRefusal(row, childReclaimTokenKind)).map((row) => row.sessionId));
    const seen = new Set<string>();
    const judged = new Map<string, ChildReclaimSweepVerdict>();
    const due: { r: SessionRecord; entry: ChildReclaimSweepEntry; runId: number; id: string }[] = [];
    // Declared here, not at section FOUR below, so the hold-release job (a
    // SEPARATE dispatch from the ordinary reclaim gathered into `due`) can be
    // pushed onto it from inside this same per-child loop, the instant its
    // second consecutive sighting fires — it does not wait for the bound or
    // the fairness sort below, neither of which it is subject to.
    const acts: Promise<void>[] = [];
    for (const r of records) {
      if (r.child.kind === 'none') continue;
      seen.add(r.id);
      // Every default below is the UNMEASURED shape, never an optimistic
      // "absent"/"zero" one, matching the fail-shut rule this whole lane
      // holds to (spec §5.7: a minting run absent from the database, or an
      // unreadable sibling list, answers ineligible, never "go" — the same
      // direction applies to a value this pass has simply not READ yet).
      // `child.kind !== 'child'` short-circuits `childReclaimSweepVerdict`
      // long before any of these would be consulted for such a row (its own
      // `child.kind` check comes first), so these defaults exist only so a
      // future change to that ordering fails SHUT rather than silently
      // reading a stale, permissive answer. `reviewedRun` in particular is
      // NOT defaulted to `'not-a-review'` — that is a MEASURED fact (this
      // run's `reviews` column read `null`), set explicitly once the minting
      // run's row is actually read below, never assumed. `held` is `'none'`
      // only when the row's own `held` text is genuinely null (itself a
      // measured fact, read before this loop) — non-null text defaults to
      // `'unmeasured'` until the DB reads below either confirm a match or run
      // out without one.
      let mintingRun: ChildReclaimMintingRunRead = { ok: false, detail: 'not read: not a child marker' };
      let mintingRunFull: RunRow | null = null;
      let reviewedRun: ChildReclaimReviewedRunRead = { kind: 'unreadable', detail: 'not read' };
      let reviewedId: number | null = null;
      let siblings: ChildReclaimSiblingsRead = { ok: false, detail: 'not read: not a child marker' };
      let held: ChildReclaimHoldRead = r.held === null
        ? { kind: 'none' } : { kind: 'unmeasured', reason: r.held.trim(), detail: 'not read' };
      let childBornAt: number | null = null;
      if (r.child.kind === 'child') {
        try {
          const run = coord.run(r.child.runId);
          mintingRunFull = run.ok ? run.run : null;
          mintingRun = run.ok
            ? { ok: true, run: run.run === null ? null : { state: run.run.state, sessionId: run.run.sessionId,
                dispatchStartedAt: run.run.dispatchStartedAt, openedAt: run.run.openedAt } }
            : { ok: false, detail: run.detail };
          // THE HOLD READ (spec §5.7's "no hold" conjunct): built from the
          // row's own trimmed `held` text, the candidate runs a match might be
          // one of, and a lazy per-programme open-run count — each of the
          // latter two in its OWN try (both private helpers below), so a
          // failure reading candidates or counting a programme's open runs
          // reads as `unmeasured` (which protects), never throws out to this
          // per-child catch and discards the reads that already succeeded.
          held = childReclaimHoldRead(r.held, r.id, r.child.runId,
            this.childReclaimHoldCandidatesRead(coord, r.id, r.child.runId, mintingRunFull),
            (program) => this.childReclaimOpenOf(coord, program));
          // A REVIEW run's child waits on the run it reviewed (`runs.reviews`;
          // spec §5.7, "A review child is finished later than its own run"):
          // the reviewer's report lives in the child's clips while the
          // coordinator still cites it. `reviewedRun` is set explicitly in
          // EVERY branch below — never left at its unmeasured default — so
          // "reviews nothing" is a MEASURED fact (`reviews === null`, read off
          // this run's own row), the same as the three answers that are not it.
          if (mintingRunFull !== null) {
            if (mintingRunFull.reviews === null) {
              reviewedRun = { kind: 'not-a-review' };
            } else {
              reviewedId = mintingRunFull.reviews;
              const reviewed = coord.run(reviewedId);
              reviewedRun = !reviewed.ok ? { kind: 'unreadable', detail: reviewed.detail }
                : reviewed.run === null ? { kind: 'absent' }
                : { kind: 'run', state: reviewed.run.state };
            }
          }
          const sib = coord.openRunsForSession(r.id);
          siblings = sib.ok ? { ok: true, open: sib.siblings.length } : { ok: false, detail: sib.detail };
          // THE RUN-ID FENCE (spec §5.1: the marker's run id and the argv the
          // server composed are the two authorities, and neither alone
          // authorises anything): after a coordination-database loss,
          // `reconstruct` mints fresh ids from 1, so a LOW id a marker names
          // is not proof of that same correspondence — it could equally be a
          // coincidence with a run this rebuilt database never actually
          // minted this workspace with. The child's own birth is the OPENING
          // `create` of its current generation, unless a `purge` that is not
          // this row's own follows it (spec §5.7). It is read uncapped
          // by `lifecycleBirthEventsFor`, so a failing child's `create` is
          // findable for the life of the workspace. It is placed through
          // `childReclaimBornAt`, the ONE placement that this fence, the
          // coordination fence and the entry's own `bornAt` all read, and it
          // is told this row's uuid.
          childBornAt = childReclaimBornAt(coord, r.id, now, childReclaimRowUuid(r));
        } catch (err) {
          // `node:sqlite` throws synchronously; an unread run is not an
          // absent one. Every read this try attempted is discarded together —
          // `mintingRun.ok === false` alone is enough to fail the verdict
          // shut, whatever `held`/`siblings`/`childBornAt` happened to read
          // before the throw.
          mintingRun = { ok: false, detail: err instanceof Error ? err.message : String(err) };
        }
      }
      // The row's registry generation as this pass gathered it (spec §5.5). A
      // row the gather holds no answer for reads `unreadable`, the unmeasured
      // default, never an optimistic `absent`.
      const regGeneration: ChildReclaimGeneration = regGenerations.get(r.id) ?? { kind: 'unreadable' };
      const v = childReclaimSweepVerdict({
        sessionId: r.id, child: r.child, identityMeasured: r.unmeasured.length === 0, generation: regGeneration,
        workspace: r.workspace, held, terminal: terminal.has(r.id), mintingRun, reviewedRun, siblings,
        coordinatorClaim: claims.get(r.id), childBornAt, skewMs: CHILD_BIRTH_SKEW_MS, nowMs: now,
      });
      judged.set(r.id, v);
      if (!v.eligible) {
        this.childReclaimSweepState.delete(r.id);
        // A hold this build proved belongs to one of this child's own runs,
        // whose accounting has since retired (spec §5.7's "no hold"
        // conjunct): `ws-reclaim`'s own rung 4 refuses any hold, so the
        // ordinary path can never reach this child until the hold is
        // released. Ahead of the generic ineligible fall-through below —
        // it is not an ordinary skip, it is a fact this pass acts on. A
        // child already busy (its release queued, or its ordinary reclaim
        // in flight) is left untouched: the in-flight set is this lane's
        // only re-entrancy guard, and touching the twice-observed set here
        // too would let an overlapping pass turn two sightings into one.
        if (v.why === 'hold-retired') {
          if (!this.childReclaimInFlight.has(r.id)) {
            // TWO SIGHTINGS OF ONE GENERATION (spec §5.7). L1 decides what this sighting does to the
            // memory (`childReclaimHoldRetiredStep`). A `first` stores its key, REPLACING whatever an
            // earlier generation left. A `second` or a `forget` deletes it. Only a `second` queues the
            // job, and the job carries the generation.
            const step = childReclaimHoldRetiredStep(
              this.childReclaimHoldRetiredSeen.get(r.id), childBornAt, v.runId, regGeneration);
            if (step.kind === 'first') this.childReclaimHoldRetiredSeen.set(r.id, step.key);
            else this.childReclaimHoldRetiredSeen.delete(r.id);
            if (step.kind === 'second') {
              this.childReclaimInFlight.add(r.id);
              const release = v.release;
              acts.push(this.execChildReclaimRelease(coord, {
                sessionId: r.id, runId: v.runId, reason: release.reason, program: release.program,
                accountedRunId: release.accountedRunId, generation: step.generation,
              }).then(
                (outcome) => {
                  // A `failed` answer composes no argv on the box and leaves
                  // the hold standing — an operator watching only the feed
                  // (the job writes no feed row of its own) would otherwise
                  // never learn a box keeps refusing `ws-release`.
                  if (outcome === 'failed') {
                    console.warn(`ccrc-server: sweepChildReclaim: releasing ${r.id}'s retired hold answered failed `
                      + '— the hold stays; retried after two fresh sightings');
                  }
                },
                (err: unknown) => {
                  console.warn(`ccrc-server: sweepChildReclaim: releasing ${r.id}'s retired hold threw `
                    + `(${err instanceof Error ? err.message : String(err)}) — left for the next pass`);
                },
              ).finally(() => {
                // THE ANSWER DELETES THE ENTRY, whatever it was — every
                // answer word and a throw alike (spec §5.7, the twice-observed
                // rule). ccd may unlink the hold before it answers, and a pass
                // in that window records an eligible first sighting while the
                // job is still in flight; keeping it would let the reclaim go
                // out ONE pass after the answer. Deleted here, the child needs
                // two fresh unheld passes after the answer, never fewer — and
                // the mark makes the next eligible verdict seed nothing, in
                // case that pass's listing was read before this answer.
                this.childReclaimSweepState.delete(r.id);
                this.childReclaimReleaseAnswered.add(r.id);
                this.childReclaimInFlight.delete(r.id);
              }));
            }
          }
          continue;
        }
        this.childReclaimHoldRetiredSeen.delete(r.id);
        this.childReclaimLogAbsence(r, v.why, reviewedId);
        if (v.why === 'minting-run-postdates-child' && mintingRunFull !== null && childBornAt !== null) {
          this.childReclaimLogBirthSkip(r, mintingRunFull.openedAt, childBornAt);
        }
        continue;
      }
      this.childReclaimHoldRetiredSeen.delete(r.id);
      // The first eligible verdict after a release ANSWERED seeds nothing: its
      // listing may predate the answer (`childReclaimReleaseAnswered`).
      if (this.childReclaimReleaseAnswered.delete(r.id)) continue;
      // An eligible verdict's generation is a key: the verdict answered
      // `identity-unmeasured` for an unreadable one (L1). This narrows the type
      // and decides nothing (spec §5.5: an unreadable generation seeds no entry).
      if (!isChildReclaimGenerationKey(regGeneration)) { this.childReclaimSweepState.delete(r.id); continue; }
      const entry = this.childReclaimSweepState.get(r.id);
      // A birth this entry does not describe, a marker naming a run it was not
      // sighted under, or a registry generation it does not carry, is a
      // recycled slug's NEW workspace (spec §5.5, §5.7): it starts from a first
      // sighting, never from the old workspace's sighting or presence. The run
      // and the generation change first: ws-add mints the generation and writes
      // the new marker before the mirror can place the new birth.
      // `v.runId` is the marker's own (`childReclaimSweepVerdict`).
      if (entry === undefined || !childReclaimSameGeneration(entry, childBornAt, v.runId, regGeneration)) {
        // A LOST MEMORY NEVER RESETS THE PERSISTENT TIER (spec §5.7): the sighting is seeded from the mirror's
        // current generation, with `lastFailedAt` left null, so a tier child is asked once on its next due pass
        // and then waits its tier pace. It never waits a fresh tier pace, and never falls back to the 15-minute ramp
        // unless the seed cannot read it (no placed birth, a reclaim done/unknown line, or a slice windowed short).
        this.childReclaimSweepState.set(r.id, childReclaimFirstSighting(mono, childBornAt, v.runId, regGeneration,
          childReclaimTierSeed(tierGenerations.get(r.id) ?? [], childBornAt, isChildReclaimStuckToken, childReclaimTokenKind)));
        continue;
      }
      if (this.childReclaimInFlight.has(r.id)) continue;
      // THE ONE "MAY I ASK AGAIN" QUESTION (`childReclaimDue`, L1): folds the
      // failure backoff (spec §5.9: "retries back off in between") AND the
      // terminal-refusal pacing — L4 decides no pacing of its own.
      if (!childReclaimDue(entry, mono, CHILD_RECLAIM_SWEEP_MS)) continue;
      due.push({ r, entry, runId: v.runId, id: r.id });
    }
    this.childReclaimJudged = judged;
    // The list's second publish, and the kept feed row: judging passes only, so a paused or capability-less
    // pass lists what it kept and writes nothing (spec §5.9). Recorded, never pushed.
    for (const a of this.childReclaimPublishAttention(mirrorArms, live)) {
      // An item's run is its marker's: a run other than the one fed for is a recycled slug's next
      // workspace, a new child (spec §5.6).
      const fed = this.childReclaimKeptReported.get(a.sessionId);
      const words = fed !== undefined && fed.runId === a.runId ? fed.words : new Set<ChildReclaimKeptWord>();
      if (words.has(a.word)) continue;
      words.add(a.word);
      this.childReclaimKeptReported.set(a.sessionId, { runId: a.runId, words });
      recordChildReclaimKeptFeed({ coord, notifyLog: this.deps.notifyLog }, a);
    }

    // FOUR — the bound: at most `CHILD_RECLAIM_MAX_IN_FLIGHT` destructive
    // verbs in flight from this automatic trigger at once (spec §5.7, "On
    // the sweep" — no human is in this path, so a bad pass must not be able
    // to ask the box for ten deletions before the first one has even
    // answered). A dispatch that has not settled after `CHILD_RECLAIM_STALL_MS`
    // stops counting against the bound (it stays in flight; nothing here
    // cancels it) and is logged once. Due children are asked in
    // `childReclaimAskOrder`'s order (L1). The presence lease's holder comes
    // first: the senior presence-held child, asked on every pass it is due,
    // so its ceiling is reachable however many children are due (spec §5.7).
    // Then never-asked, `lastAskedAt`, `firstEligibleAt`, id, so a child that
    // defers every pass cannot hog the one slot outside a lease, and a holder
    // that forfeits goes to the back.
    let activeInFlight = 0;
    for (const [id, since] of this.childReclaimInFlightSince) {
      if (mono - since < CHILD_RECLAIM_STALL_MS) { activeInFlight += 1; continue; }
      if (!this.childReclaimStalledLogged.has(id)) {
        this.childReclaimStalledLogged.add(id);
        console.warn(`ccrc-server: sweepChildReclaim: the reclaim of ${id} has not settled after `
          + `${CHILD_RECLAIM_STALL_MS / 1000}s — it stays in flight, and stops counting against `
          + `CHILD_RECLAIM_MAX_IN_FLIGHT`);
      }
    }
    const freeSlots = Math.max(0, CHILD_RECLAIM_MAX_IN_FLIGHT - activeInFlight);
    const { order, holderId } = childReclaimAskOrder(due);
    for (const { r, entry, runId, id } of order.slice(0, freeSlots)) {
      const ask: ChildReclaimAsk = {
        at: asked, licensed: childReclaimDeferExpired(entry, asked, CHILD_RECLAIM_SWEEP_MS), asHolder: id === holderId,
      };
      const req: ChildReclaimRequest = {
        sessionId: r.id, runId, trigger: 'sweep',
        // THE CEILING READS THE PRESENCE CLOCK ALONE (spec §5.7, "Presence,
        // and its bound": the ceiling bounds presence and nothing else), and
        // licenses only a CONTINUOUS episode whose latest answer's request is
        // recent, measured in this lane's own pass intervals on the larger of
        // its two clocks, its span on the monotonic clock.
        deferExpired: ask.licensed,
        // THE ELAPSED DEFER RIDES THE REQUEST. Spec §5.7: past the ceiling
        // "the feed row says how long it waited and why"; §5.9: a deferral is
        // shown "with its elapsed time". So it is the FIRST deferral of ANY
        // kind this sweep saw for the child — the other clock — and null
        // before any; the executor's ONE feed row renders the wait from it.
        // In memory, so a restart restarts it: a later `deferredSinceMs`,
        // never an earlier one.
        deferredSinceMs: entry.firstDeferredAt,
        // WHAT THE FEED ALREADY SAYS (spec §5.9): the child's non-presence deferral
        // episode, from this entry, and the failure word of its item on the list
        // this pass has just published. The executor only declines to repeat them
        // in its own feed row; it decides nothing on it, and neither does the lane.
        feedQuiet: childReclaimFeedQuiet(entry, this.childReclaimAttentionList, r.id),
        // THE GENERATION THIS REQUEST WAS JUDGED UNDER (spec §5.5): the
        // entry's own key, which this pass's read matched. Every sweep request
        // carries it, licensed or not, and the executor re-proves it.
        licenceGeneration: entry.generation,
      };
      this.childReclaimInFlight.add(r.id);
      this.childReclaimInFlightSince.set(r.id, mono);
      acts.push(this.execChildReclaim(coord, req).then(
        (outcome) => {
          const answered = this.childReclaimLaneNow();
          // `answered` is read FIRST, at the answer's arrival, never the
          // pass's `asked`. The episode starts at its first answer's arrival,
          // and continuity runs from this arrival back to the previous
          // request (spec §5.7, "continuous deferral").
          //
          // A terminal refusal, or a failure, needs no memory here beyond the
          // entry, and gets none: ccd journalled it, and the mirror is where
          // the attention list and the terminal exclusion read it (spec
          // §5.9 — an executor answer never feeds `CoordStatus`). `ask`
          // carries this REQUEST's own `deferExpired` (`licensed`): whether
          // this attempt was sent past the previous presence ceiling, which
          // is what lets a presence-class answer RESTART the episode rather
          // than silently keep skipping ccd's presence rungs forever (spec
          // §5.7), and whether it went to the lease's holder.
          this.childReclaimWriteBack(r.id, entry, childReclaimSweepOutcomeOf(outcome), ask, answered);
        },
        (err: unknown) => {
          const answered = this.childReclaimLaneNow();
          // A rejection is a defect the executor could not name
          // (`reclaimChild` never throws for a condition it can name). It is
          // written as a FAILED attempt. That ends the presence episode, so a
          // licensed request that rejects is never followed by a second
          // licence on the same episode. It forfeits a holder's lease. And it
          // backs off, so a child whose every attempt rejects cannot hog the
          // one slot. It is written only while the entry is still the live
          // one, like the answer. It names no word, so it leaves the persistent tier as it stands.
          console.warn(`ccrc-server: sweepChildReclaim: the reclaim of ${r.id} threw (${err instanceof Error ? err.message : String(err)}) — recorded as a failed attempt; the sweep retries after its backoff`);
          this.childReclaimWriteBack(r.id, entry, CHILD_RECLAIM_SWEEP_REJECTED, ask, answered);
        },
      ).finally(() => {
        this.childReclaimInFlight.delete(r.id);
        this.childReclaimInFlightSince.delete(r.id);
        this.childReclaimStalledLogged.delete(r.id);
      }));
    }
    // A child the registry no longer lists has no twice-observed entry to keep.
    for (const id of [...this.childReclaimSweepState.keys()]) {
      if (!seen.has(id)) this.childReclaimSweepState.delete(id);
    }
    for (const id of [...this.childReclaimHoldRetiredSeen.keys()]) {
      if (!seen.has(id)) this.childReclaimHoldRetiredSeen.delete(id);
    }
    for (const id of [...this.childReclaimReleaseAnswered]) {
      if (!seen.has(id)) this.childReclaimReleaseAnswered.delete(id);
    }
    await Promise.all(acts);
  }

  /** Every MARKED row's registry generation (spec §5.5), read concurrently
   *  through `childReclaimGenerationRead`: the pass's one await before its
   *  loop. A row whose marker does not read as a child is not read, because
   *  its verdict answers before identity is asked. Only the remote adapter's
   *  read has a timer (its request timeout); a local read has none. The pass
   *  counter (`childReclaimPassSeq`) and the throttle's re-stamp after the
   *  gather are what keep a slow gather from bringing two deciding passes
   *  within one interval. The reader lets a rejecting port propagate (spec §5.5),
   *  so a rejecting read folds to `unreadable` for its row HERE: one row's
   *  rejection is that row's `identity-unmeasured`, never the pass's. */
  private async childReclaimGatherGenerations(
    records: readonly SessionRecord[],
  ): Promise<ReadonlyMap<string, ChildReclaimGeneration>> {
    const marked = records.filter((r) => r.child.kind === 'child');
    const reads = await Promise.all(
      marked.map((r) => childReclaimGenerationRead(this.deps.io, this.deps.cfg.registryDir, r.id)
        .catch((): ChildReclaimGeneration => ({ kind: 'unreadable' }))));
    return new Map(marked.map((r, i): [string, ChildReclaimGeneration] => [r.id, reads[i]!]));
  }

  /** The child-reclaim lane's two clocks, read together
   *  (`ChildReclaimLaneNow`): this process's monotonic clock
   *  (`Deps.monotonicMs`, or `performance.now()` in production) and the wall
   *  clock. Synchronous, so the pass that reads it awaits nothing. */
  private childReclaimLaneNow(): ChildReclaimLaneNow {
    return { monoMs: this.deps.monotonicMs?.() ?? performance.now(), wallMs: Date.now() };
  }

  /** Writes one settled request back into the lane's memory (spec §5.7): the
   *  answer's and the rejection's ONE path. Only while the entry is still the
   *  live one. A pass that ran while this was in flight may have cleared the
   *  memory (switch raised, capability lost, mirror unread, row unlisted,
   *  child ineligible) or replaced the entry (a recycled slug's new
   *  workspace); re-seeding it from a stale entry would let the child be
   *  asked for on the FIRST pass after, and "two FRESH passes" would be
   *  false. `null` forgets the child. */
  private childReclaimWriteBack(
    id: string, entry: ChildReclaimSweepEntry, outcome: ChildReclaimSweepOutcome, ask: ChildReclaimAsk,
    answered: ChildReclaimLaneNow,
  ): void {
    if (this.childReclaimSweepState.get(id) !== entry) return;
    const next = childReclaimNextEntry(entry, outcome, ask, answered, CHILD_RECLAIM_SWEEP_MS);
    if (next === null) this.childReclaimSweepState.delete(id);
    else this.childReclaimSweepState.set(id, next);
  }

  /** `ChildReclaimHoldCandidatesRead` for one child (spec §5.7's "no hold"
   *  conjunct — a hold this build can PROVE was written by one of this
   *  child's own runs protects only conditionally, everything else protects
   *  unconditionally): every run naming this session, in ANY state
   *  (`CoordStore.runsNamingSession`), plus the MINTING RUN itself even when
   *  it names a DIFFERENT session — an orphan's own dispatch or non-final
   *  close may have written the hold this child still carries, and
   *  `runsNamingSession` alone cannot see that once the run has moved on to a
   *  different session. `runsNamingSession`'s OWN try: a throw here is this
   *  READ's failure alone, answered `unmeasured` by `childReclaimHoldRead` —
   *  which PROTECTS — never a throw that discards the per-child reads
   *  around it. */
  private childReclaimHoldCandidatesRead(
    coord: CoordStore, sessionId: string, mintingRunId: number, mintingRunFull: RunRow | null,
  ): ChildReclaimHoldCandidatesRead {
    let naming: ReturnType<CoordStore['runsNamingSession']>;
    try {
      naming = coord.runsNamingSession(sessionId);
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    if (!naming.ok) return { ok: false, detail: naming.detail };
    const candidates: ChildReclaimHoldCandidate[] = naming.runs.map((row) => (
      { runId: row.id, sessionId: row.sessionId, state: row.state, program: row.program, wave: row.wave,
        waveOf: row.waveOf }));
    if (mintingRunFull !== null) {
      candidates.push({ runId: mintingRunId, sessionId: mintingRunFull.sessionId, state: mintingRunFull.state,
        program: mintingRunFull.program, wave: mintingRunFull.wave, waveOf: mintingRunFull.waveOf });
    }
    return { ok: true, candidates };
  }

  /** `ChildReclaimHoldOpenRead` for one programme (spec §5.7's "no hold"
   *  conjunct, the count that decides whether a PROVEN programme hold still
   *  protects): `CoordStore.programOpenRunCount` throws bare, so this is its
   *  own try — called LAZILY by `childReclaimHoldRead`, only once a hold's
   *  text has PROVEN to match one of this child's own runs, so a programme
   *  whose hold does not match spends nothing here. */
  private childReclaimOpenOf(coord: CoordStore, program: string): ChildReclaimHoldOpenRead {
    try {
      return { ok: true, count: coord.programOpenRunCount(program) };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** The generation input for the attention list and the terminal exclusion
   *  ALONE (spec §5.9, "derived from the lifecycle mirror so a restart does
   *  not lose it"): `lifecycleCreatesFor` (every `create` row,
   *  uncapped) merged with `lifecycleFor`'s own windowed read, so a
   *  long-refused child's own OPENING `create` stays findable however far it
   *  has scrolled past `LIFECYCLE_PAGE_MAX`. `lifecycleFor` answers this
   *  session's NEWEST rows; any `create` this adds that the window did not
   *  already carry is — by that read's own ordering — older than every row
   *  the window holds, so it is PREPENDED, never interleaved into the
   *  window's own internal order (nothing here re-sorts either read).
   *  Deduplicated by `uid`, the mirror's one stable per-row identity
   *  (`lifecycle_uid`'s UNIQUE index); a `create` whose own line carried none
   *  (rare — the mirror's own dedupe degrades to its raw bytes for exactly
   *  that row) may appear twice, which costs `childReclaimGeneration`
   *  nothing: a duplicate boundary answers the same boundary. The birth
   *  (above, in the per-child loop) does NOT use this: it reads
   *  `lifecycleBirthEventsFor` through `childReclaimBornAt`. */
  private childReclaimAttentionGenerationRows(coord: CoordStore, sessionId: string): MirroredLifecycleEvent[] {
    const window = coord.lifecycleFor({ sessionId });
    const creates = coord.lifecycleCreatesFor(sessionId);
    if (creates.length === 0) return window;
    const windowUids = new Set(window.map((e) => e.uid).filter((u): u is string => u !== null));
    const extra = creates.filter((c) => c.uid === null || !windowUids.has(c.uid));
    return extra.length === 0 ? window : [...extra, ...window];
  }

  /** THE ONE WRITE of the attention list (spec §5.9): the mirror arms this pass derived, then the kept
   *  arm from the verdicts as they stand (the last judging pass's, or its kept verdicts alone), filtered
   *  to this listing and to the verdicts judged under the run its marker names, with no failing item for
   *  a child whose recorded verdict is `held`; then the kept leaves, and the temp-root collector's items, read from that
   *  lane's memory here (spec §5.10). L1 decides every item and the precedence between them; this method only assigns.
   *  Returns the kept items it listed, for the feed row. */
  private childReclaimPublishAttention(mirrorArms: readonly ChildReclaimJournalAttention[],
    live: ReadonlyMap<string, number | null>): ChildReclaimKeptAttention[] {
    const verdicts = this.childReclaimJudged ?? new Map<string, ChildReclaimSweepVerdict>();
    const kept = childReclaimKeptItems({ verdicts, live, mirrorArms });
    this.childReclaimAttentionList = childReclaimAttentionWithLeaves(
      childReclaimAttentionWithKept(mirrorArms, kept, verdicts), this.childReclaimLeaves, this.collectAttention());
    return kept;
  }

  /** Absence is logged and skipped (spec §5.7) — ONCE per child per condition
   *  per process. Three conditions, three sentences: an absent MINTING run is
   *  never eligible, because a lost or rebuilt database makes every child's
   *  minting run absent at once; an absent REVIEWED run keeps a review child,
   *  because a run the database does not hold is not proven terminal and the
   *  report in the child's clips may still be cited; a child whose own birth cannot be PLACED (no placed
   *  `create` row at all, or a removal journaled after its placed create that is not the row's own and that no
   *  newer create has replaced) cannot be proven to match its marker's run id, so it is skipped rather than guessed at
   *  (spec §5.1: the marker's run id and the argv the server composed are the
   *  two authorities, and neither alone authorises anything). A FOURTH, not an
   *  absence but logged the same way: a child that has coordinated in its
   *  current generation (`coordinating`, spec §1 rule 4: manual cleanup is
   *  reserved for a coordinator's own workspace) is never reclaimed
   *  automatically, and says so once (spec §5.9). Every other skip says
   *  nothing here: the run chip and the attention list carry it
   *  (`minting-run-postdates-child` has its OWN log, `childReclaimLogBirthSkip`,
   *  below — a different sentence with different evidence to name). */
  private childReclaimLogAbsence(r: SessionRecord, why: ChildReclaimSweepSkip, reviewedId: number | null): void {
    if (why !== 'minting-run-absent' && why !== 'reviewed-run-absent' && why !== 'child-birth-unplaced'
        && why !== 'coordinating') return;
    const key = `${why} ${r.id}`;
    if (this.childReclaimAbsentLogged.has(key)) return;
    this.childReclaimAbsentLogged.add(key);
    const runId = r.child.kind === 'child' ? String(r.child.runId) : '?';
    if (why === 'minting-run-absent') {
      console.warn(`ccrc-server: sweepChildReclaim: ${r.id} is marked as a child of run ${runId}, which coord.db does not hold — never eligible, because a lost or rebuilt database makes every child's minting run absent at once, the live ones included`);
    } else if (why === 'reviewed-run-absent') {
      console.warn(`ccrc-server: sweepChildReclaim: ${r.id} is a review child of run ${runId}, which reviews run ${reviewedId ?? '?'}, which coord.db does not hold — kept, because an absent reviewed run is not a terminal one and its report may still be cited`);
    } else if (why === 'coordinating') {
      console.warn(`ccrc-server: sweepChildReclaim: ${r.id} is marked as a child of run ${runId}, but it has held a coordinator's chair since about when it was created, holds one now, or held one at a time that cannot be placed — never reclaimed automatically; a person removes it once nothing still needs it`);
    } else {
      console.warn(`ccrc-server: sweepChildReclaim: ${r.id} is marked as a child of run ${runId}, but its own birth cannot be placed: the lifecycle mirror holds no placed 'create' row for it (a workspace minted before the mirror existed, or whose create line carried no ccd clock), or a removal journaled after its placed create, not the row's own, that ccrc has not yet seen replaced by a newer creation — so the run-id fence cannot prove the marker's run minted this workspace; skipped, and looked at again on the next pass`);
    }
  }

  /** Once per child per process, naming both instants — never re-logged for
   *  the same skip while this process runs. A minting run opened AFTER this
   *  child's own birth (past the clock-skew allowance) cannot be the run that
   *  minted THIS incarnation — run ids restart after a coordination-database
   *  loss — and the two possible causes are named so an operator does not
   *  have to guess which one applies. */
  private childReclaimLogBirthSkip(r: SessionRecord, openedAt: number, childBornAt: number): void {
    const key = `minting-run-postdates-child ${r.id}`;
    if (this.childReclaimAbsentLogged.has(key)) return;
    this.childReclaimAbsentLogged.add(key);
    console.warn(`ccrc-server: sweepChildReclaim: ${r.id}'s marker names a run opened ${openedAt - childBornAt}ms `
      + `after this child's own birth (run openedAt=${openedAt}, child born=${childBornAt}, skew=${CHILD_BIRTH_SKEW_MS}ms) `
      + '— skipped as minting-run-postdates-child: either a rebuilt coordination database (run ids restart at 1 after '
      + 'a loss) or the fleet box\'s clock reading behind the server\'s');
  }

  /** The ONE executor, as both triggers reach it: `reclaimChild` on the
   *  session's own `KeyedQueue`, with the deps the close route composes — so
   *  presence, the ceiling and the feed row behave identically however a
   *  reclaim was started (spec §5.7). Composes EXACTLY the close port's seven
   *  members (`coord, io, cfg, runCcd, fleetState, presence, notifyLog`),
   *  `now` unset — built HERE, inside the queue callback, as the close port
   *  does. `Deps.childReclaimExec` replaces the whole call in a test, and
   *  nowhere else. */
  private execChildReclaim(coord: CoordStore, req: ChildReclaimRequest): Promise<ChildReclaimOutcome> {
    const seam = this.deps.childReclaimExec;
    if (seam) return seam(req);
    // The close route's OWN shape (`coord/routes.ts`'s `childReclaimPort`):
    // the literal is built INSIDE the queue callback, so its members are
    // `deps`'s current answer WHEN THE JOB RUNS, never a snapshot taken when
    // the sweep queued it.
    return this.deps.queue.run(req.sessionId, () => reclaimChild({
      coord, io: this.deps.io, cfg: this.deps.cfg, runCcd: this.deps.runCcd,
      fleetState: this.deps.fleetState, presence: this.deps.presence, notifyLog: this.deps.notifyLog,
    }, req));
  }

  /**
   * THE TEMP-ROOT COLLECTOR'S LANE (spec §5.10; child reclamation wave 9): the first AUTOMATIC composer of `ws-collect`.
   * A FOURTH sibling of `sweepChildReclaim` on the tick, at its cadence (`CHILD_RECLAIM_SWEEP_MS`) and under its switch
   * (`reclaim-paused`, the fleet's one cleanup switch), and nothing else: its own population (`$REG/tmproots` and
   * `$REG/tmpquarantine`, read in its own gather, never the registry rows and never `~/.cc-tmp`), its own memory, its
   * executor (`collectTempRoot`), its feed rows, and its attention items, which reach the frame only through the child
   * lane's one write (`childReclaimPublishAttention`).
   *
   * IT SHIPS SHADOWED. Until the operator arms it (the legacy marker before its latch, or Settings `live` for this node),
   * a token the lane would spend is RECORDED — a feed row once per (id, token) episode, and an attention item — and
   * nothing is composed. The executor arms nearest the argv; this pass hands its listing to the switch's latch alone.
   *
   * WHAT IT ASKS. Each pass, at most ONE ACT JOB and at most `COLLECT_AUDITS_PER_PASS` LEARNING audits, chosen by
   * `collectOffers` (L1): the act first, to the earliest ripe id by ripening instant; then learning audits to due ids by
   * next-ask instant; each by id after that, and each skipping an id with a call pending. Every call rides the id's
   * `KeyedQueue` key, the key the reclaim and expiry executors use, so no two lanes touch one id at once, and no further
   * call is queued for an id whose last call has not settled (`collectInFlight`). The executor captures each request's
   * generations when it is COMPOSED; its answer is an OBSERVATION only if both still stand when it arrives (L1's
   * `collectFresh`). The act job spends only its OWN audit's token (observation 2), the token an earlier audit answered
   * (observation 1) at least `COLLECT_OBSERVE_INTERVAL_MS` before it, with only that token answered between.
   *
   * IT NEVER AWAITS A CALL IT QUEUED. `collectSweeping` spans the gather and the decide-and-enqueue only. Each call is
   * tracked by its queued-at stamp (`collectInFlight`), and every pass derives the unsettled lines from those stamps, so a
   * call or job that never settles never stops a later pass.
   *
   * THE SLOT. At most one act job in flight fleet-wide. It is taken when the job is queued; `collectJobEffects` (L1) says
   * whether the settled job frees it or keeps it, with its id, until `CHILD_RECLAIM_STALL_MS` after an act that may have
   * acted. A job that never settles keeps it for as long as it stands, and is listed. No act job is offered until
   * `CHILD_RECLAIM_STALL_MS` after this lane's start, because a restart forgets the slot while the previous process's
   * act may still be running on the box. STATED RESIDUALS (spec §7): in local mode that rests on the server unit's
   * default `KillMode=control-group`; and a killed ccd's orphaned children are not counted against the slot (they hold
   * the id's reap lock, so ccd answers `in-progress` for it).
   *
   * PUBLIC for `sweepDivergences`'s reason: `tick()` dispatches it with `void`. `records` is NOT read — the population is
   * the two listings — and is kept for the siblings' signature. `names` is the tick's listing, which feeds the
   * pre-filter alone: economy, never permission.
   */
  async sweepTempRootCollect(records: readonly SessionRecord[], names: readonly string[]): Promise<void> {
    const coord = this.deps.coord;
    if (!coord || this.collectSweeping) return;
    // THE THROTTLE, on the MONOTONIC clock (spec §5.10): stamped BEFORE the gather, so a pass a gate stops still spends
    // its interval, and re-stamped after it (`collectPass`) with the pass's decision clock.
    const gate = this.childReclaimLaneNow().monoMs;
    if (this.lastCollectSweep !== null && gate - this.lastCollectSweep < CHILD_RECLAIM_SWEEP_MS) return;
    this.lastCollectSweep = gate;
    // ONE PASS AT A TIME (spec §5.10): held over the gather and the decide-and-enqueue, so no pass is ever overtaken
    // while it gathers. The calls a pass queues are NOT under it, and are never awaited: they settle on their own.
    this.collectSweeping = true;
    try {
      await this.collectPass(coord, names);
    } finally {
      this.collectSweeping = false;
    }
  }

  /** One pass of the collector's lane, run only while no other pass runs. Its ONE await is the gather. It queues its
   *  calls and never awaits them (`sweepTempRootCollect`). Its connection epoch is read at its head and again after the
   *  gather (path-identity spec 2026-10-12 §5.5), and its listing is handed to the switch's latch (§5.4) and nothing else. */
  private async collectPass(coord: CoordStore, names: readonly string[]): Promise<void> {
    // ZERO — THE CONNECTION EPOCH (path-identity spec 2026-10-12 §5.5): the epoch the lane's observation pairs stand under.
    // One that moved since the last pass clears every pair, so no pair straddles two connections. An act job is queued
    // under it (`collectAct`), and its executor composes nothing when the epoch it reads after its final listing differs.
    const link = this.deps.fleetIdentity ?? NO_FLEET_IDENTITY;
    const head = link.epochNow();
    if (head !== this.collectSeenEpoch) {
      this.collectSeenEpoch = head;
      this.collectClearPairs();
    }
    // ONE — the capabilities (spec §5.10): both, or the lane never runs — never an automatic destructive lane on a box the
    // phone cannot pause. A missing one clears every pair, so each id needs two FRESH observations once it returns.
    if (!capSupported(this.deps.fleetState, COLLECT_CAP) || !capSupported(this.deps.fleetState, RECLAIM_PAUSE_CAP)) {
      this.collectClearPairs();
      return;
    }
    // TWO — THE ONE GATHER (spec §5.10): the population's two listings and the switches' own registry listing, together.
    // The pause is read from THIS listing, not the tick's, because the tick never hands a lane a registry that did not
    // list, and this lane must read one as a pause. Neither read rejects: a port that does makes THAT listing unmeasured,
    // or the registry paused. So no catch stands here: a guard no case can reach has no red.
    const gathered = await Promise.all([
      readCollectPopulation(this.deps.io, this.deps.cfg.registryDir),
      collectSwitches(this.deps.io, this.deps.cfg.registryDir),
    ]);
    // The pass's decision clock, read AFTER the gather; the throttle re-stamped with it, so any two deciding passes are at
    // least one interval apart however long a gather takes.
    const mono = this.childReclaimLaneNow().monoMs;
    this.lastCollectSweep = mono;
    const [listings, switches] = gathered;
    // THE GATHER'S BRACKET (path-identity spec 2026-10-12 §5.5): an epoch that moved while the gather was out clears every
    // pair and ends the pass. Nothing it listed is read, and no latch is retired from a listing that straddled two
    // connections. The pairs, now empty, stand under the epoch after it.
    const after = link.epochNow();
    if (after !== head) {
      this.collectSeenEpoch = after;
      this.collectClearPairs();
      return;
    }
    // THREE — the switch: a raised pause, or a registry that did not list, stops the pass before any audit and clears
    // every pair. Only `paused` is read here: the marker in the same listing is the executor's to arm with, at its act.
    if (switches.paused) {
      this.collectClearPairs();
      return;
    }
    // THE LATCH (path-identity spec 2026-10-12 §5.4): this listing, coherent, unpaused and on one epoch, proving the legacy
    // marker absent while the latch is unset, retires it through the one latch helper and the store's one writer, with
    // one feed row, so an idle lane follows a removed marker within one pass. The helper decides (`collectLatchDue`), it
    // never heals a mismatch, and the listing is handed to it and to nothing else. Its outcome is said once per
    // non-success kind (`collectLatchNote`, the coordinator's extension of the warn-latch ruling), so a latch that cannot
    // retire is never silent.
    this.collectLatchNote(collectRetireLatch(this.collectControlDeps(coord), switches, { before: head, after }));
    // FOUR — the population (L1): the ids to consider, from the MEASURED listings only, pre-filtered on the tick's exact
    // `<id>.child` and `<id>.uuid` names unless a measured record names the id. Kept for the box-wide lines. An id is
    // forgotten — its pacing and episodes with it, and no feed row — only when `collectForgets` says so (both listings
    // measured, neither names it); an answer still out for it then finds no entry, and is dropped, save a `collected`
    // act's row (`collectForgottenActRow`). The box-wide lines whose ids have all left are dropped with them (L1's
    // `collectBoxAfterPopulation`), so no line stands on evidence no later answer can clear.
    const pop = collectPopulation({ ...listings, registryNames: new Set(names) });
    this.collectPop = pop;
    this.collectPopNames = new Set(names);
    for (const id of [...this.collectState.keys()]) if (collectForgets(pop, id)) this.collectState.delete(id);
    const box = collectBoxAfterPopulation(pop, this.collectPassAudits, this.collectBoxProbes);
    this.collectPassAudits = box.passAudits;
    this.collectBoxProbes = box.boxProbes;
    // FIVE — the slot's kept deadline, and each call past its bound, logged once (its line is derived at the publish).
    if (this.collectSlot.kind === 'kept' && mono >= this.collectSlot.untilMono) this.collectSlot = { kind: 'free' };
    this.collectLogUnsettled(mono);
    // SIX — who is asked (L1), and the calls, each on its id's queue key, the act first. None is awaited.
    const busy = new Set<string>(this.collectInFlight.keys());
    if (this.collectSlot.kind === 'kept') busy.add(this.collectSlot.id);
    const offers = collectOffers({
      candidates: pop.candidates.map((id) => collectCandidateOf(id, this.collectState.get(id), mono,
        CHILD_RECLAIM_SWEEP_MS, COLLECT_OBSERVE_INTERVAL_MS)),
      busy, nowMono: mono, auditsMax: COLLECT_AUDITS_PER_PASS,
      act: { slotFree: this.collectSlot.kind === 'free', flockLatched: this.collectFlockLatched,
        startMono: this.collectStartMono, holdOffMs: CHILD_RECLAIM_STALL_MS },
    });
    const calls = offers.learn.length + (offers.act === null ? 0 : 1);
    if (calls === 0) return;
    const pass = ++this.collectPassSeq;
    this.collectPassTally.set(pass, { pending: calls, audits: new Map() });
    if (offers.act !== null) this.collectAct(coord, offers.act, pass, mono);
    for (const id of offers.learn) this.collectLearn(coord, id, pass, mono);
  }

  /** One LEARNING audit (spec §5.10): `learnCollect` on the id's queue key, never awaited. The executor captures the
   *  generations as it composes, through the port. An answer folds through Task 4's `collectAfterAudit`, an observation
   *  only under its capture; a missing capability is a lane-wide clear; a rejection is a defect the reader could not
   *  name, folded as an audit with no document that observes nothing (`a-thrown-job-reads-as-no-document`). */
  private collectLearn(coord: CoordStore, id: string, pass: number, mono: number): void {
    this.collectEntryOf(id);
    this.collectInFlight.set(id, { kind: 'learn', sinceMono: mono, phase: 'queued' });
    void this.deps.queue.run(id, () => learnCollect({
      runCcd: this.collectRunCcd(id), fleetState: this.deps.fleetState, lane: this.collectPortFor(coord, id),
    }, id))
      .then((answer) => {
        if (answer.kind === 'not-asked') { this.collectClearPairs(); return; }
        this.collectFoldAudit(coord, id, pass, answer.audit.value, answer.audit.arrived, answer.audit.composed);
      }, (err: unknown) => {
        this.collectFoldAudit(coord, id, null, { kind: 'no-document', stderr: err instanceof Error ? err.message : String(err) },
          this.collectClock(), null);
      })
      .catch((err: unknown) => {
        console.warn(`ccrc-server: sweepTempRootCollect: folding the learning audit for ${id} failed (${err instanceof Error ? err.message : String(err)})`);
      })
      .finally(() => { this.collectSettled(id, pass); });
  }

  /** The ONE act job (spec §5.10): `collectTempRoot`'s six steps on the id's queue key, the fleet-wide slot taken as it
   *  is queued, never awaited. The deps are composed INSIDE the queue callback, `execChildReclaim`'s idiom, so the job
   *  reads `deps`'s current answer when it runs. The connection epoch the job stands under is read OUTSIDE it, as the
   *  job is queued (path-identity spec 2026-10-12 §5.5), so a reconnect between this pass and the job's start composes
   *  nothing. The job reaches this lane's memory through `collectPortFor` alone, and the switch's control state through
   *  `collectControlDeps`. Its answer is folded for the LANE first (`collectJobEffects`: the slot, the flock latch),
   *  then for its id (`collectFoldJob`). */
  private collectAct(coord: CoordStore, id: string, pass: number, mono: number): void {
    this.collectEntryOf(id);
    this.collectInFlight.set(id, { kind: 'act', sinceMono: mono, phase: 'queued' });
    this.collectSlot = { kind: 'job', id, sinceMono: mono };
    // THE JOB'S EPOCH (path-identity spec 2026-10-12 §5.5): the epoch this pass found the lane's pairs standing under,
    // read HERE, as the job is queued, never inside the callback. Its executor composes nothing when the epoch it reads
    // after its final listing differs, so a reconnect between the queueing and the job's start composes nothing.
    const epoch = this.collectSeenEpoch;
    void this.deps.queue.run(id, () => collectTempRoot({
      coord, io: this.deps.io, cfg: this.deps.cfg, runCcd: this.collectRunCcd(id), fleetState: this.deps.fleetState,
      presence: this.deps.presence, lane: this.collectPortFor(coord, id), observeIntervalMs: COLLECT_OBSERVE_INTERVAL_MS,
      control: this.collectControlDeps(coord), link: this.deps.fleetIdentity ?? NO_FLEET_IDENTITY,
    }, { id, epoch }))
      .then((outcome) => { this.collectSettleJob(coord, id, pass, outcome); }, (err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn(`ccrc-server: sweepTempRootCollect: the collector's job for ${id} threw (${detail}) — read as one that may have acted: the act slot and ${id} wait CHILD_RECLAIM_STALL_MS`);
        this.collectSettleJob(coord, id, pass, { kind: 'threw', detail });
      })
      .catch((err: unknown) => {
        // The job settled and its fold failed, so the lane does not know what the job did: the pair resets under a new
        // generation and the id takes the refusal floor (`collectAfterFoldFailed`), before the line is written. The
        // slot is left as the settle made it, or as it was if the settle threw before its slot write (a stated residual).
        const e = this.collectState.get(id);
        if (e !== undefined) this.collectState.set(id, collectAfterFoldFailed(e, this.collectStepAt(this.collectClock())));
        console.warn(`ccrc-server: sweepTempRootCollect: folding the collector's job for ${id} failed (${err instanceof Error ? err.message : String(err)}) — ${e !== undefined ? `its observation pair is reset, and ${id} waits CHILD_RECLAIM_DEFER_CEILING_MS` : `${id} was forgotten while the job was out, so nothing is reset`}`);
      })
      .finally(() => { this.collectSettled(id, pass); });
  }

  /** A settled act job (spec §5.10): its LANE effects first (L1's `collectJobEffects`: the slot, the latch), then its
   *  fold for the id. A lane-wide clear the job saw was applied through the port the instant it saw it, never here. */
  private collectSettleJob(coord: CoordStore, id: string, pass: number,
    s: CollectJobOutcome | { readonly kind: 'threw'; readonly detail: string }): void {
    const clock = this.collectClock();
    const fx = collectJobEffects(s, clock.mono, CHILD_RECLAIM_STALL_MS);
    this.collectSlot = fx.keptUntilMono === null ? { kind: 'free' } : { kind: 'kept', id, untilMono: fx.keptUntilMono };
    if (fx.latchFlock) this.collectFlockLatched = true;
    this.collectFoldJob(coord, id, pass, s, clock);
  }

  /** THE FOLD TABLE (spec §5.10): each of the executor's outcome arms through Task 4's transitions, each transition at
   *  the answer's ARRIVAL under a generation the lane never used before, and each answer's word about the BOX only
   *  when no later answer has changed the box-wide probes since it arrived (`collectBoxProbesAtArrival`). Nothing here
   *  decides a pace; L1 does.
   *  - `not-asked`: caps and paused were cleared through the port already, and a refused id has nothing to pace;
   *    presence (step 3) is `collectAfterPresence`.
   *  - every arm that carries observation 2's answer folds it first (`collectFoldAudit`): an observation only under its
   *    capture, so a stale, paused, flipped, capability-less or cleared job's answer paces and never observes; then
   *    `answered` presence (step 6) is `collectAfterPresence`, `held` is `collectAfterHold`, `would-collect` is
   *    `collectAfterWouldCollect` with its once-per-(id, token) row, and `acted` is `collectAfterAct` with its row.
   *  - an id forgotten while the job was out: every fold is dropped but an `acted` outcome's word about the box and a
   *    `collected` act's row (`collectForgottenActRow`), worded from the job's own observation-2 document.
   *  - `threw`: an audit with no document, which observes nothing. */
  private collectFoldJob(coord: CoordStore, id: string, pass: number,
    s: CollectJobOutcome | { readonly kind: 'threw'; readonly detail: string }, clock: CollectClock): void {
    if (s.kind === 'threw') {
      this.collectFoldAudit(coord, id, null, { kind: 'no-document', stderr: s.detail }, clock, null);
      return;
    }
    if (s.kind === 'not-asked') {
      const e = this.collectState.get(id);
      if (s.why === 'presence' && e !== undefined) this.collectState.set(id, collectAfterPresence(e, this.collectStepAt(clock)));
      return;
    }
    const e = this.collectFoldAudit(coord, id, pass, s.audit.value, s.audit.arrived, s.audit.composed);
    // What an act says of the BOX counts whatever became of its id, as an audit's does (`collectFoldAudit`). It is the
    // only clear for a probe raised between observation 2's arrival and a `collected` act's answer, which observation 2's
    // own fold (a collectable answer, older than that probe) leaves standing. It stays ahead of the forgotten-id branch.
    if (s.kind === 'acted') this.collectBoxProbesAnswered(s.result, s.arrived.mono);
    if (e === null) {
      // The id was forgotten while the job was out: its fold is dropped, save the row L1 says a deletion still owes.
      const row = collectForgottenActRow(id, s, s.audit.value);
      if (row !== null) this.collectRecordFeed(coord, { sessionId: id, ...row });
      return;
    }
    const at = this.collectStepAt(s.audit.arrived);
    switch (s.kind) {
      case 'answered':
        if (s.why === 'presence') this.collectState.set(id, collectAfterPresence(e, at));
        return;
      case 'held':
        this.collectState.set(id, collectAfterHold(e, s.hold.why, at));
        return;
      case 'would-collect': {
        const next = collectAfterWouldCollect(e, at);
        this.collectFeedAfter(coord, id, next, { kind: 'row', key: collectWouldCollectKey(s.audit.value.token) },
          () => ({ title: COLLECT_FEED_TITLE['would-collect'],
            body: collectFeedWouldCollectBody(id, next.evidence.runId, next.evidence.leaf) }));
        return;
      }
      case 'acted': {
        const next = collectAfterAct(e, s.result, this.collectStepAt(s.arrived));
        this.collectFeedAfter(coord, id, next, collectFeedCueOfAct(s.result), () => this.collectActRow(id, next, s.result));
        return;
      }
      default: { const unnamed: never = s; return unnamed; }
    }
  }

  /** Folds one AUDIT answer (spec §5.10). What it says of the BOX counts whatever became of the id: the box-wide probes,
   *  by the answer's ARRIVAL (`collectBoxProbesAnswered`: an answer from before the probes were last rebuilt is skipped, as
   *  an act job's observation 2 can be, folded when its job settles) and, for an answer a pass queued, that pass's tally
   *  (`collectPassClass`). Then the id's entry, through Task 4's `collectAfterAudit`: an OBSERVATION only when
   *  `composed` is given and both generations it captured still stand (`collectFresh`); then the feed cue. An id
   *  forgotten while the call was out has no entry, and the answer is dropped for it
   *  (`an-answer-for-a-forgotten-id-is-dropped`): the entry written, or null. */
  private collectFoldAudit(coord: CoordStore, id: string, pass: number | null, a: CollectAudit, arrived: CollectClock,
    composed: CollectGenerations | null): CollectEntry | null {
    this.collectBoxProbesAnswered(a, arrived.mono);
    if (pass !== null) this.collectPassTally.get(pass)?.audits.set(id, collectPassClass(a));
    const entry = this.collectState.get(id);
    if (entry === undefined) return null;
    const observes = composed !== null && collectFresh(composed, this.collectLaneGen, entry);
    const next = collectAfterAudit(entry, a, this.collectStepAt(arrived), observes);
    return this.collectFeedAfter(coord, id, next, collectFeedCueOfAudit(a), () => ({ title: COLLECT_FEED_TITLE.answer,
      body: this.collectAuditBody(id, next, a) }));
  }

  /** The ONE write of the box-wide probes from an ANSWER (spec §5.10): both fields together, through L1's
   *  `collectBoxProbesAtArrival`, so no answer's word about the box is applied without its arrival. The population's
   *  clear (`collectBoxAfterPopulation`) is the only other write, and it leaves the stamp alone. */
  private collectBoxProbesAnswered(a: CollectAudit | CollectResult, arrivedMono: number): void {
    const next = collectBoxProbesAtArrival(
      { probes: this.collectBoxProbes, changedAtMono: this.collectBoxProbesAtMono }, a, arrivedMono);
    this.collectBoxProbes = next.probes;
    this.collectBoxProbesAtMono = next.changedAtMono;
  }

  /** Writes `next` back after one step's feed cue (Task 4's `collectFeedStep`, over Task 5's cue), and writes the
   *  episode's ONE row only when the step opened one: a repeat is quiet. */
  private collectFeedAfter(coord: CoordStore, id: string, next: CollectEntry, cue: CollectFeedCue,
    row: () => { readonly title: string; readonly body: string }): CollectEntry {
    const stepped = collectFeedStep(next, cue);
    this.collectState.set(id, stepped.entry);
    if (stepped.opened !== null) {
      const r = row();
      this.collectRecordFeed(coord, { sessionId: id, runId: stepped.entry.evidence.runId, title: r.title, body: r.body });
    }
    return stepped.entry;
  }

  /** An audit answer's row body, worded by Task 5's builder (spec §5.10). A collectable answer opens no row. A document
   *  that was not one (`no-document`, `unreadable`) is worded as ccrc's, by KIND, never as a word ccd said. */
  private collectAuditBody(id: string, e: CollectEntry, a: CollectAudit): string {
    const runId = e.evidence.runId;
    switch (a.kind) {
      case 'verdict': return collectFeedAnswerBody(id, runId, a.verdict, a.detail, []);
      case 'unmeasured': return collectFeedAnswerBody(id, runId, a.probe, a.detail, []);
      case 'no-document': return collectFeedReadBody(id, runId, 'no-document', a.stderr);
      case 'unreadable': return collectFeedReadBody(id, runId, 'unreadable', a.detail);
      case 'collectable': return collectFeedAnswerBody(id, runId, a.kind, null, []);
      default: { const unnamed: never = a; return unnamed; }
    }
  }

  /** An act's row, titled and worded by Task 5 (spec §5.10): `collected` its own; a `failed` with no word and an act that
   *  answered no document are ccrc's words, chosen by KIND; every other outcome ccd's word. */
  private collectActRow(id: string, e: CollectEntry, r: CollectResult): { readonly title: string; readonly body: string } {
    const runId = e.evidence.runId;
    switch (r.kind) {
      case 'collected':
        return { title: COLLECT_FEED_TITLE.collected, body: collectFeedCollectedBody(id, runId, e.evidence.leaf, r) };
      case 'refused': return { title: COLLECT_FEED_TITLE.answer, body: collectFeedAnswerBody(id, runId, r.word, r.detail, r.paths) };
      case 'failed': return { title: COLLECT_FEED_TITLE.answer, body: r.token === ''
        ? collectFeedReadBody(id, runId, 'unaccepted', r.detail) : collectFeedAnswerBody(id, runId, r.token, r.detail, []) };
      case 'die': return { title: COLLECT_FEED_TITLE.answer, body: collectFeedAnswerBody(id, runId, r.word, null, []) };
      case 'no-document': return { title: COLLECT_FEED_TITLE.answer, body: collectFeedReadBody(id, runId, 'no-document', r.stderr) };
      default: { const unnamed: never = r; return unnamed; }
    }
  }

  /** The collector's feed rows (spec §5.10): written HERE, never by the definer (`collectLane.ts`) or the executor
   *  (`coord/collectTempRoot.ts`), in `recordExpireFeed`'s idiom — a `run` row, recorded and archived, never pushed; a
   *  failed archive write is said and never stops the lane; the log is flushed whatever happened. */
  private collectRecordFeed(coord: CoordStore, row: {
    readonly sessionId: string; readonly runId: number | null; readonly title: string; readonly body: string;
  }): void {
    const log = this.deps.notifyLog;
    if (!log) return;
    try {
      const ev = log.record({ kind: 'run', sessionId: row.sessionId, runId: row.runId, title: row.title, body: row.body });
      coord.recordFeedEvent(log.epoch, ev);
    } catch (err) {
      console.warn('ccrc-server: recordFeedEvent failed '
        + `(${err instanceof Error ? err.message : String(err)}) — temp-root collector ${row.title}, feed archive degraded`);
    } finally {
      void log.flush();
    }
  }

  /** The collector's `coord` feed row (path-identity spec 2026-10-12 §5.4). It records the marker latch's retirement,
   *  a change to the switch's control state with no run and no session: `kind:'coord'`, `sessionId:''` and
   *  `runId:null`, as `POST /api/coord/caps` records its change. It is recorded and archived, never pushed. A failed
   *  archive write is said and never stops the lane, and the log is flushed whatever happened (`collectRecordFeed`'s
   *  idiom). */
  private collectRecordCoordFeed(coord: CoordStore, title: string, body: string): void {
    const log = this.deps.notifyLog;
    if (!log) return;
    try {
      const ev = log.record({ kind: 'coord', sessionId: '', runId: null, title, body });
      coord.recordFeedEvent(log.epoch, ev);
    } catch (err) {
      console.warn('ccrc-server: recordFeedEvent failed '
        + `(${err instanceof Error ? err.message : String(err)}) — temp-root collector ${title}, feed archive degraded`);
    } finally {
      void log.flush();
    }
  }

  /** The executor's view of this lane's memory (spec §5.10; `CollectLanePort`, declared by the executor). Every member is
   *  synchronous, so the executor's step 6 reads observation 1 with no await between that read and its argv, and
   *  resolves the switch with none between its reads and the flip. `id` is the job's, which the flip's row names. */
  private collectPortFor(coord: CoordStore, id: string): CollectLanePort {
    return {
      clock: () => this.collectClock(),
      generations: (of) => ({ lane: this.collectLaneGen, id: this.collectState.get(of)?.idGen ?? -1 }),
      observation: (of) => this.collectState.get(of)?.obs ?? null,
      // Every lane-wide clear a job reports (a pause, a missing capability, a moved epoch, an unknown node) clears every
      // pair alike (path-identity spec 2026-10-12 §5.5).
      cleared: () => { this.collectClearPairs(); },
      flipped: (r) => {
        this.collectControlNote(r);
        // THE LAST-SEEN-LIVE FLAG (spec §5.10; path-identity spec 2026-10-12 §5.5). The lane flips on the EFFECTIVE
        // BOOLEAN, never on its source: a marker-to-Settings handoff that stays live is no flip, writes no row and keeps
        // every pair. A change of the boolean either way is a FLIP: every pair clears, ONE feed row says so and names
        // the source or the bounded safety-stop reason, and the job that saw it composes nothing. Every change an act
        // job SEES is said; one undone between two step-6 resolutions is never seen. It starts SHADOWED, so an arming
        // the lane never saw is a flip too.
        const live = collectLaneLive(r);
        if (live === this.collectLastSeenLive) return false;
        this.collectLastSeenLive = live;
        this.collectClearPairs();
        this.collectRecordFeed(coord, { sessionId: id, runId: null, title: COLLECT_FEED_TITLE.switch,
          body: collectSwitchFeedBody(r) });
        return true;
      },
    };
  }

  /** The executor's control deps (path-identity spec 2026-10-12 §5.2, §5.4; `CollectControlDeps`, declared by the
   *  executor): the store, the process's ONE generation journal (`Deps.collectLane`, built in `index.ts`), the wall
   *  clock, and the latch's row writer. A server built with no journal hands null, which the executor reads as an
   *  unmeasurable control state, never as a missing journal. Wiring only: the deciding is the executor's and L1's. */
  private collectControlDeps(coord: CoordStore): CollectControlDeps {
    return {
      coord,
      journal: this.deps.collectLane?.journal ?? null,
      wallNow: () => this.childReclaimLaneNow().wallMs,
      latchRetired: (body) => { this.collectRecordCoordFeed(coord, COLLECT_SETTING_FEED_TITLE, body); },
    };
  }

  /** THE SWITCH'S WARN LATCHES (path-identity spec 2026-10-12 §5.5), called first from the port's `flipped`, which every
   *  settled resolution passes through: a safety stop warns once per reason, and a legacy file re-created after its latch
   *  warns once, so a stuck read state is said once rather than on every act job. A coherent resolution (live or
   *  shadowed) clears every latch but the one it raises again and the latch helper's own (`latch-…`,
   *  `collectLatchNote`), as the stall-settings latch re-arms when a read applies.
   *  The stopped arms (pause, unlistable, epoch, unknown fleet) never reach it, and change none. It decides nothing about
   *  the lane: the resolution is L1's. */
  private collectControlNote(r: CollectLaneSettled): void {
    const key = r.kind === 'safety-stopped' ? r.why : r.notes.markerRecreated ? 'marker-recreated' : null;
    if (r.kind !== 'safety-stopped') {
      for (const k of [...this.collectControlWarned]) if (k !== key && !k.startsWith('latch-')) this.collectControlWarned.delete(k);
    }
    if (key === null || this.collectControlWarned.has(key)) return;
    this.collectControlWarned.add(key);
    console.warn(r.kind === 'safety-stopped'
      ? `ccrc-server: sweepTempRootCollect: the collector's control state is safety-stopped (${r.why}) — it removes `
        + 'nothing until its database row and generation journal are proved coherent'
      : "ccrc-server: sweepTempRootCollect: the fleet box's legacy file was re-created; this server no longer honours it");
  }

  /** THE LATCH'S WARN LATCHES (the coordinator's extension of the warn-latch ruling, 2026-10-12): the pass's latch
   *  outcome, said once per non-success kind. A latch the store keeps refusing, failing or throwing on is reported once,
   *  neither silent nor repeated on every pass. Off stays refused until the latch retires, so this line is the
   *  operator's only reason for it. Its keys are `latch-<kind>`. They are cleared on `retired` and never by a coherent
   *  resolution (`collectControlNote` skips them). `not-due` changes nothing. It decides nothing: the helper already
   *  did, and the pass goes on either way. */
  private collectLatchNote(o: CollectLatchOutcome): void {
    if (o.kind === 'not-due') return;
    if (o.kind === 'retired') {
      for (const k of [...this.collectControlWarned]) if (k.startsWith('latch-')) this.collectControlWarned.delete(k);
      return;
    }
    const key = `latch-${o.kind}`;
    if (this.collectControlWarned.has(key)) return;
    this.collectControlWarned.add(key);
    const why = o.kind === 'refused' ? `the store refused it (${o.code})`
      : o.kind === 'failed' ? `the store failed at ${o.phase}`
      : 'the store threw before its append (a busy database or a read fault)';
    console.warn(`ccrc-server: sweepTempRootCollect: the legacy file's latch could not be retired: ${why}; `
      + 'Off stays refused until a later pass retires it');
  }

  /** The runner the lane hands its calls (spec §5.10): `deps.runCcd`, marking the id's flight with what is out — an
   *  audit (`argv[0]` is `ws-audit`) or the act (anything else the executor composes) — and back to `queued` when the
   *  call settles, so the unsettled line can tell the executor's audit from its act and from a job that has composed
   *  nothing. It decides nothing and composes nothing. */
  private collectRunCcd(id: string): Deps['runCcd'] {
    return async (argv) => {
      this.collectPhase(id, argv[0] === 'ws-audit' ? 'audit' : 'act');
      try {
        return await this.deps.runCcd(argv);
      } finally {
        this.collectPhase(id, 'queued');
      }
    };
  }

  private collectPhase(id: string, phase: CollectFlight['phase']): void {
    const f = this.collectInFlight.get(id);
    if (f !== undefined) this.collectInFlight.set(id, { ...f, phase });
  }

  /** The lane's two clocks, read together (Task 6's `CollectClock`). */
  private collectClock(): CollectClock {
    const n = this.childReclaimLaneNow();
    return { mono: n.monoMs, wall: n.wallMs };
  }

  /** One transition's context (Task 4's `CollectStep`): the answer's ARRIVAL, and a generation drawn from the ONE
   *  counter, never used before. */
  private collectStepAt(arrived: CollectClock): CollectStep {
    return { now: { monoMs: arrived.mono, wallMs: arrived.wall }, gen: ++this.collectGen, passIntervalMs: CHILD_RECLAIM_SWEEP_MS };
  }

  /** The id's entry, a first sighting (L1) the first time the lane queues a call for it, under a fresh generation. */
  private collectEntryOf(id: string): CollectEntry {
    const known = this.collectState.get(id);
    if (known !== undefined) return known;
    const fresh = collectFirstSighting(++this.collectGen);
    this.collectState.set(id, fresh);
    return fresh;
  }

  /** A LANE-WIDE CLEAR (spec §5.10): a raised pause or an unlistable registry, a missing capability, a marker flip.
   *  The lane's generation moves to a value never used before, so the answer to any call composed
   *  before it is no observation, and every entry goes through Task 4's `collectClearPair`: the PAIRS only. Each id's
   *  next ask, its runs, its clocks and its feed episodes survive; only a restart loses them. */
  private collectClearPairs(): void {
    this.collectLaneGen = ++this.collectGen;
    for (const [id, e] of this.collectState) this.collectState.set(id, collectClearPair(e));
  }

  /** One call or job settled: its flight ends, and its pass's tally counts it. The latest pass whose calls have all
   *  settled becomes the one the pass-scoped box lines read; an older pass still open is dropped then. */
  private collectSettled(id: string, pass: number): void {
    this.collectInFlight.delete(id);
    this.collectUnsettledLogged.delete(id);
    const t = this.collectPassTally.get(pass);
    if (t === undefined) return;
    t.pending -= 1;
    if (t.pending > 0) return;
    this.collectPassTally.delete(pass);
    if (pass < this.collectPassPublished) return;
    this.collectPassPublished = pass;
    this.collectPassAudits = t.audits;
    for (const p of [...this.collectPassTally.keys()]) if (p < pass) this.collectPassTally.delete(p);
  }

  /** The ids whose collector call or job has not settled within its bound (spec §5.10), by kind, each counted from when
   *  it was QUEUED. An act JOB not settled `CHILD_RECLAIM_STALL_MS` after it took the slot is asked FIRST, whatever it
   *  has out: its `ws-collect` (`act`), or its own audit or nothing yet (`job`) — spec §5.10: "whether or not the job's
   *  `ws-collect` is out" — and Task 5's line says the act slot is held for both. Short of that, an audit (a learning
   *  audit, or the job's own) is listed at `COLLECT_AUDIT_STALL_MS`. The two kinds differ only in the process log's
   *  noun. */
  private collectUnsettled(mono: number): Map<string, CollectUnsettledKind> {
    const out = new Map<string, CollectUnsettledKind>();
    for (const [id, f] of [...this.collectInFlight].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const age = mono - f.sinceMono;
      if (f.kind === 'act' && age >= CHILD_RECLAIM_STALL_MS) out.set(id, f.phase === 'act' ? 'act' : 'job');
      else if ((f.kind === 'learn' || f.phase === 'audit') && age >= COLLECT_AUDIT_STALL_MS) out.set(id, 'audit');
    }
    return out;
  }

  /** Each unsettled call is logged ONCE per unsettled episode (spec §5.10): when it first passes its bound, and again
   *  only after it has settled and a later call for that id passes its bound. Its attention line is derived at the
   *  publish. */
  private collectLogUnsettled(mono: number): void {
    for (const [id, kind] of this.collectUnsettled(mono)) {
      if (this.collectUnsettledLogged.has(id)) continue;
      this.collectUnsettledLogged.add(id);
      console.warn(`ccrc-server: sweepTempRootCollect: the collector's ${kind === 'job' ? 'job' : 'call'} for ${id} has not `
        + `settled within its bound — nothing further is queued for ${id} until it does`
        + `${this.collectSlot.kind === 'job' && this.collectSlot.id === id ? ', and the act slot stays taken' : ''}`);
    }
  }

  /** The collector's attention (spec §5.10), derived from this lane's memory when the child lane publishes its list:
   *  each remembered id L1 projects (`collectAttentionViews`: all but a re-registered id), and the box facts. L1
   *  decides every item; the list's ONE write merges them (`childReclaimPublishAttention`). A stated residual: they
   *  reach the frame only at that publish, and stand unchanged while the child lane's pass fails shut. */
  private collectAttention(): ChildReclaimCollectInput {
    return collectAttentionItems(this.collectAttentionInput());
  }

  /** What the collector's attention reads (spec §5.10), extracted so the published items and the switch's counts
   *  (`currentCollectCounts`, path-identity spec 2026-10-12 §5.7) read ONE input: each remembered id L1 projects, the
   *  box facts, and the clock the unsettled lines are measured at. It reads memory and decides nothing. */
  private collectAttentionInput(): Parameters<typeof collectAttentionItems>[0] {
    const nowMono = this.collectClock().mono;
    const entries = collectAttentionViews(this.collectState, this.collectPop, this.collectPopNames);
    return { entries, nowMono, box: {
      unmeasured: this.collectPop?.unmeasured ?? [], refusedNames: this.collectPop?.refusedNames ?? 0,
      boxProbes: this.collectBoxProbes, passAudits: this.collectPassAudits, flockLatched: this.collectFlockLatched,
      unsettled: this.collectUnsettled(nowMono),
    } };
  }

  /**
   * THE EXPIRY LANE (workspace lifecycle spec 2026-09-24 §5.3 "The lane", wave 3b): ARCHIVED workspaces, seven days
   * after their archive. A SIBLING of `sweepChildReclaim` on the same tick — its registry read, its cadence
   * (`CHILD_RECLAIM_SWEEP_MS`) and its switch (`reclaim-paused`, now the fleet's ONE cleanup switch) — and nothing else:
   * its own memory, verdict (`archivedExpiryVerdict`, L1), executor (`expireArchived`), feed rows and attention list.
   * A sibling pass, not a branch inside the child lane's, so neither lane's early return (the mirror unread, a
   * capability missing) can silence the other (the departure `expiry-lane-is-a-sibling-pass`).
   *
   * IT SHIPS SHADOWED (the coordinator's safety ruling (E)). Until the operator touches `$REG/expire-lane-live` by
   * hand, a due row is AUDITED and RECORDED — "would expire <id>", a feed row and an attention entry — and `ws-expire`
   * is never composed; the executor re-reads the file at the act. `reclaim-paused` stops the lane ENTIRELY, shadow
   * included: no audit, no record.
   *
   * THE THRESHOLD IS NEVER TYPED HERE. A row's instant is LEARNED from ccd (`learnExpiry`: the audit's `expiresAt`,
   * read through ONE reader), once per archive, at most `EXPIRE_AUDITS_PER_PASS` rows a pass; a row is not audited
   * again before its instant unless its archive changes. A box whose ccd predates the key answers no evidence, and
   * nothing is composed for that row.
   *
   * WHAT IT ASKS FOR. A row twice-observed eligible (`archivedExpiryVerdict` on two passes) is DUE; AT MOST ONE act
   * runs per pass, fleet-wide, and ONE PASS runs at a time, so never two acts at once. Every outcome is folded into
   * memory by L1 (`archivedExpiryNextEntry`); a feed row is written when a row's outcome CHANGES. Presence defers with
   * no ceiling; a standing `in-use` is reported, naming what holds it, and never killed.
   */
  async sweepArchivedExpiry(records: readonly SessionRecord[], names: readonly string[]): Promise<void> {
    const coord = this.deps.coord;
    if (!coord || this.archivedExpirySweeping) return;
    const now = Date.now();
    if (this.lastArchivedExpirySweep !== 0 && now - this.lastArchivedExpirySweep < CHILD_RECLAIM_SWEEP_MS) return;
    this.lastArchivedExpirySweep = now;
    this.archivedExpirySweeping = true;
    try {
      await this.archivedExpiryPass(coord, records, names, now);
    } finally {
      this.archivedExpirySweeping = false;
    }
  }

  /** One pass of the expiry lane — `sweepArchivedExpiry`'s body, run only while no other pass runs. */
  private async archivedExpiryPass(
    coord: CoordStore, records: readonly SessionRecord[], names: readonly string[], now: number,
  ): Promise<void> {
    const forgetSightings = (): void => {
      for (const [id, e] of this.archivedExpiryState) {
        if (e.eligibleSince !== null) this.archivedExpiryState.set(id, { ...e, eligibleSince: null });
      }
    };
    // ONE — the switch and the capability. Either way the twice-observed sightings are dropped: a row needs two
    // FRESH passes once the switch is lowered or the box proves the verb. What was learned and reported stands.
    if (names.includes(RECLAIM_PAUSE_MARKER) || !capSupported(this.deps.fleetState, EXPIRE_CAP)) {
      forgetSightings();
      return;
    }
    // TWO — the population, and the store's answers for it, read ONCE (`lastRunBySession`). A read that fails makes
    // every row ineligible this pass. (The executor re-reads them for its one row at the act.)
    const archived = records.filter((r) => r.workspace !== null && r.archivedAt !== null);
    let store: { ok: true; workers: ReadonlySet<string>; claimants: ReadonlySet<string> } | { ok: false; detail: string };
    try {
      const last = coord.lastRunBySession(archived.map((r) => r.id));
      store = last.ok ? { ok: true, workers: new Set(last.openWorkers), claimants: new Set(last.openClaimants) }
        : { ok: false, detail: last.detail };
    } catch (err) {
      store = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    const seen = new Set<string>();
    const learn: string[] = [];
    const due: string[] = [];
    for (const r of archived) {
      seen.add(r.id);
      let entry = archivedExpiryEntryFor(this.archivedExpiryState.get(r.id), r.archivedAt!);
      const past = entry.expiresAt !== null && now >= entry.expiresAt * 1000;
      const read: ExpiryStoreRead = !store.ok ? { ok: false, detail: store.detail } : this.archivedExpiryStoreRead(
        coord, r.id, store.workers.has(r.id), store.claimants.has(r.id), past);
      const v = archivedExpiryVerdict({
        sessionId: r.id, workspace: r.workspace, archivedAt: r.archivedAt, child: r.child,
        identityMeasured: r.unmeasured.length === 0, held: r.held, store: read, expiresAt: entry.expiresAt, nowMs: now,
      });
      entry = archivedExpirySighted(entry, v, r.held, now);
      this.archivedExpiryState.set(r.id, entry);
      if (!v.eligible && v.why === 'expiry-unknown' && now >= entry.nextAskAt) learn.push(r.id);
      if (archivedExpiryDue(entry, now)) due.push(r.id);
    }
    // A row that left the population is forgotten — save one whose expiry COMPLETED and kept a leaf (wave 5): it is gone
    // from the registry by definition, and its report is the only trace of what stays on disk until a restart.
    for (const [id, e] of [...this.archivedExpiryState]) if (!seen.has(id) && e.report?.kind !== 'kept') this.archivedExpiryState.delete(id);
    // THREE — learn: one audit at a time, each on its session's queue. The slots go in `nextAskAt` order — a row never
    // asked (0) first, then the rows asked longest ago — never registry order, so rows that keep failing cannot take
    // every slot from a row behind them (review 313, parked item 1). The sort is stable: ties keep registry order.
    learn.sort((a, b) => this.archivedExpiryState.get(a)!.nextAskAt - this.archivedExpiryState.get(b)!.nextAskAt);
    for (const id of learn.slice(0, EXPIRE_AUDITS_PER_PASS)) {
      try {
        const read = await this.deps.queue.run(id, () => learnExpiry(this.deps, id));
        const e = this.archivedExpiryState.get(id);
        if (e !== undefined) this.archivedExpiryState.set(id, archivedExpiryLearned(e, read, Date.now(), CHILD_RECLAIM_SWEEP_MS));
      } catch (err) {
        console.warn(`ccrc-server: sweepArchivedExpiry: learning ${id}'s expiry threw (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    // FOUR — the act: at most ONE per pass, fleet-wide, never on a box that answered `flock-unavailable`. Never asked
    // first: the row whose `nextAskAt` is earliest, then the oldest instant. No other pass runs meanwhile, so the
    // answer is folded onto the very entry the act was asked for.
    if (this.archivedExpiryBoxRefused === null && due.length > 0) {
      const pick = due.map((id) => [id, this.archivedExpiryState.get(id)!] as const)
        .sort(([ia, a], [ib, b]) => a.nextAskAt - b.nextAskAt || (a.expiresAt ?? 0) - (b.expiresAt ?? 0) || (ia < ib ? -1 : 1))[0]!;
      const [id, entry] = pick;
      try {
        const result = await this.deps.queue.run(id, () => expireArchived({
          coord, io: this.deps.io, cfg: this.deps.cfg, runCcd: this.deps.runCcd, fleetState: this.deps.fleetState,
          presence: this.deps.presence, notifyLog: this.deps.notifyLog,
        }, { sessionId: id, archivedAt: entry.archivedAt, expiresAt: entry.expiresAt! }));
        if (result.kind === 'box' && result.word === 'flock-unavailable') this.archivedExpiryBoxRefused = result.detail;
        // Whether the row's entry STANDS rides the feed row, so a shadow row over it never says nothing was deleted (wave 6).
        if (archivedExpiryOutcomeKey(result) !== entry.lastOutcome) {
          recordExpireFeed({ coord, notifyLog: this.deps.notifyLog }, result, expiryReportStands(entry.report));
        }
        const next = archivedExpiryNextEntry(entry, result, Date.now(), CHILD_RECLAIM_SWEEP_MS);
        if (next === null) this.archivedExpiryState.delete(id); else this.archivedExpiryState.set(id, next);
      } catch (err) {
        console.warn(`ccrc-server: sweepArchivedExpiry: the expiry of ${id} threw (${err instanceof Error ? err.message : String(err)}) — left for the next pass`);
      }
    }
    // FIVE — the attention list, from the lane's memory alone.
    this.expiryAttentionList = expiryAttention(this.archivedExpiryState, this.archivedExpiryBoxRefused !== null);
  }

  /** One archived row's store answers in the lane's pass (spec §5.3's run conjuncts). `reviewing` — a REVIEW run
   *  naming this row whose reviewed run is not terminal (`expiryReviewing`, the executor's own read) — is read only
   *  for a row PAST its instant (`past`), the only rows it can decide; a read that fails is the store's failure for
   *  this row. */
  private archivedExpiryStoreRead(
    coord: CoordStore, id: string, openWorker: boolean, openClaimant: boolean, past: boolean,
  ): ExpiryStoreRead {
    if (!past || openWorker || openClaimant) return { ok: true, openWorker, openClaimant, reviewing: false };
    const review = expiryReviewing(coord, id);
    return review.ok ? { ok: true, openWorker, openClaimant, reviewing: review.reviewing } : review;
  }

  /**
   * THE DEAD-COORDINATOR LANE (workspace lifecycle spec 2026-09-24 §5.4, wave 4): a coordinator that CRASHED and has
   * stayed dead an hour, with no successor, has its open runs closed `failed` — and #166 then reclaims its marked
   * children. A THIRD SIBLING of `sweepChildReclaim` on the same tick, with its registry read, its cadence
   * (`CHILD_RECLAIM_SWEEP_MS`) and its switch (`reclaim-paused`, the fleet's one cleanup switch) — and nothing else:
   * its own memory, verdicts (`deadCoordinator.ts`, L1), executor (`endDeadCoordinator`), feed rows and attention list
   * (the expiry lane's shape, `expiry-lane-is-a-sibling-pass`).
   *
   * IT SHIPS SHADOWED (the coordinator's safety ruling (B)). Until the operator touches `$REG/dead-coordinator-lane-live`
   * by hand, a due claimant is RECORDED — "would end programme <slug> (<n> runs)", a feed row and an attention entry —
   * and `closeRun`'s abandon arm is never reached; the executor re-reads the file inside the serialiser. The anchors and
   * the breaker are kept in shadow too, so the operator sees them before arming. `reclaim-paused` stops it ENTIRELY.
   *
   * WHO IT MEASURES: the distinct claimants of non-terminal runs, each with the reclaim door's own ladder
   * (`measureClaimant`, its dead arm carrying `cause`), plus ONE store read of the journal clause for the dead ones.
   * A crash, and only a crash, writes the durable first-dead anchor; any other answer deletes it — and a journal the
   * lane cannot trust to hold every deliberate act is no crash. DUE when an hour has passed since
   * `max(firstDeadAt, .supervised)` and the two latest passes both measured it crashed. Armed, AT MOST ONE claimant is
   * acted on per pass, the longest dead first; in shadow every due one is recorded; never while the circuit breaker
   * stands.
   *
   * IT NEVER PUSHES. The stall watch is what notifies about a dead coordinator: per stalled worker, its r3
   * (`coordinator-dead`, "Reclaim the run") and — once its wave-2 arms are armed — `coord-deaf` for a worker's unacked
   * ball-passing mail, each naming the worker's workspace and the coordinator. This lane's rows are records and
   * attention entries keyed by the same claimant id, so they read as that incident's outcome, never a second one.
   */
  async sweepDeadCoordinators(records: readonly SessionRecord[], names: readonly string[]): Promise<void> {
    const coord = this.deps.coord;
    if (!coord || this.deadCoordinatorSweeping || this.deadCoordinatorStopped) return;
    const now = Date.now();
    if (this.lastDeadCoordinatorSweep !== 0 && now - this.lastDeadCoordinatorSweep < CHILD_RECLAIM_SWEEP_MS) return;
    this.lastDeadCoordinatorSweep = now;
    this.deadCoordinatorSweeping = true;
    const run = this.deadCoordinatorPass(coord, records, names, now);
    this.deadCoordinatorPassRun = run;
    try {
      await run;
    } finally {
      this.deadCoordinatorSweeping = false;
      this.deadCoordinatorPassRun = null;
    }
  }

  /** SEAL THE BREAKER'S STATE (D-4916), synchronously, over a pass that is not running: the shutdown handler's one act on the
   *  lane (`sealDeadCoordinatorBreaker` awaits a pass first). The first attempt STOPS the lane — no pass runs after it, so
   *  nothing can change the state behind the seal. It writes `sealed` (one generation-checked statement over the same
   *  snapshot) ONLY when all of these hold, tested in this order, and otherwise writes nothing and says why: a store; no
   *  pass in flight; a write of this process has landed; not already sealed; no anchor change pending; the state durably
   *  clean; the held set's key the one the last commit wrote. Never throws. */
  sealDeadCoordinatorBreakerNow(): DeadCoordinatorSealResult {
    this.deadCoordinatorStopped = true;
    const coord = this.deps.coord;
    if (!coord) return { sealed: false, reason: 'no-store' };
    if (this.deadCoordinatorSweeping) return { sealed: false, reason: 'pass-in-flight' };
    if (!this.deadCoordinatorBreakerLanded) return { sealed: false, reason: 'no-landed-write' };
    if (this.deadCoordinatorBreakerSealed) return { sealed: false, reason: 'already-sealed' };
    if (this.deadCoordinatorAnchorsPending.size > 0) return { sealed: false, reason: 'changes-pending' };
    // A write DID land (a mark) but no commit has, so no generation is known: the state is not durably clean, and that is the
    // true reason (review of fix round 5, F3), not `no-landed-write`.
    if (!this.deadCoordinatorBreakerDurableClean || this.deadCoordinatorBreakerGeneration === null) return { sealed: false, reason: 'not-durably-clean' };
    if (deadCoordinatorBreakerHeldKey(this.deadCoordinatorBreakerHeld) !== this.deadCoordinatorBreakerCommittedKey) return { sealed: false, reason: 'key-mismatch' };
    try {
      const w = coord.sealDeadCoordinatorBreakerState(this.deadCoordinatorBreakerGeneration);
      if (!w.ok) return { sealed: false, reason: 'write-failed' };
      this.deadCoordinatorBreakerSealed = true;
      this.deadCoordinatorBreakerGeneration = w.generation;
      return { sealed: true, generation: w.generation };
    } catch {
      return { sealed: false, reason: 'write-failed' };
    }
  }

  /** `sealDeadCoordinatorBreakerNow` after the pass in flight, awaited for at most `boundMs`: past the bound it writes
   *  nothing (`pass-in-flight`) and the lane stays stopped. */
  async sealDeadCoordinatorBreaker(boundMs: number): Promise<DeadCoordinatorSealResult> {
    this.deadCoordinatorStopped = true;
    const run = this.deadCoordinatorPassRun;
    if (run !== null) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        run.then(() => undefined, () => undefined),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, boundMs); }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
    }
    return this.sealDeadCoordinatorBreakerNow();
  }

  /** The sealed start's first act (D-4916, R1.5): write `clean` back over the same snapshot, generation-checked, BEFORE any
   *  step of the pass can change state or act. Retried each pass until it lands; a failure is said once. A write of this
   *  process has landed when it does. */
  private unsealDeadCoordinatorBreaker(coord: CoordStore): void {
    const gen = this.deadCoordinatorBreakerGeneration;
    const w = gen === null ? null : coord.unsealDeadCoordinatorBreakerState(gen);
    if (w?.ok === true) {
      this.deadCoordinatorBreakerUnsealPending = false;
      this.deadCoordinatorBreakerLanded = true;
      this.deadCoordinatorBreakerGeneration = w.generation;
      return;
    }
    // A failed unseal re-reads the row, so a generation another writer moved does not wedge the retry for good while it leaves the row sealed
    // (a writer that moves it to any other state makes the unseal impossible: fail-shut, one warn line, no feed row).
    const now = coord.deadCoordinatorBreakerState();
    if (now.kind === 'sealed') this.deadCoordinatorBreakerGeneration = now.generation;
    if (!this.deadCoordinatorBreakerUnsealWarned) {
      this.deadCoordinatorBreakerUnsealWarned = true;
      console.warn(`ccrc-server: sweepDeadCoordinators could not unseal the breaker's state (${w === null ? 'no generation' : w.detail}) — no act and no write until the unseal lands; retried each pass`);
    }
  }

  /** One pass of the dead-coordinator lane — `sweepDeadCoordinators`'s body, run only while no other pass runs. */
  private async deadCoordinatorPass(
    coord: CoordStore, records: readonly SessionRecord[], names: readonly string[], now: number,
  ): Promise<void> {
    const forget = (): void => {
      for (const [id, e] of this.deadCoordinatorState) {
        if (e.crashedPasses !== 0) this.deadCoordinatorState.set(id, { ...e, crashedPasses: 0 });
      }
    };
    // ONE — the switch. `reclaim-paused` stops the lane entirely, shadow included: nothing is measured, recorded or
    // written. The run of crashed passes is forgotten, so a lowered switch needs two FRESH passes; the durable anchors
    // stand (the next crashed pass continues them, or the gap restarts them).
    if (names.includes(RECLAIM_PAUSE_MARKER)) { forget(); return; }
    // TWO — the journal's own trust (`readDeadCoordinatorJournalTrust`): a mirror not swept yet, or gone stale,
    // decides NOTHING this pass — no anchor is written or deleted, and the run of crashed passes starts again.
    const journal = await readDeadCoordinatorJournalTrust({ coord, io: this.deps.io, cfg: this.deps.cfg }, this.lifecycleHealth());
    if (journal.hold !== null) {
      console.warn(`ccrc-server: sweepDeadCoordinators: ${journal.hold} — no decisions this pass`);
      forget();
      return;
    }
    // THREE — the population, the anchors: one statement each. Either failing decides nothing this pass. The anchors are
    // the durable rows with every change a commit has not landed yet laid over them (D-4857): what this process decided.
    let ids: string[];
    const anchors = new Map<string, DeadAnchor>();
    try {
      ids = [...new Set(coord.openCoordinatorIds())].sort();
      const a = coord.deadAnchors();
      if (!a.ok) throw new Error(a.detail);
      for (const [id, x] of a.anchors) anchors.set(id, x);
      for (const [id, x] of this.deadCoordinatorAnchorsPending) if (x === null) anchors.delete(id); else anchors.set(id, x);
    } catch (err) {
      console.warn(`ccrc-server: sweepDeadCoordinators could not read the coordination store (${err instanceof Error ? err.message : String(err)}) — no decisions this pass`);
      forget();
      return;
    }
    // ...and, ONCE per process, the breaker's held set from its TYPED STATE (D-4857). A state that reads SEALED is the exact
    // snapshot of the last landed commit, vouched for by a clean shutdown (D-4916), and the only one seeded as it reads. Any
    // other answer — CLEAN (the last server did not end through a clean shutdown, so a hold it formed and could not write is
    // not ruled out), DIRTY (a pass marked it and its commit did not land, or the process died between), ABSENT (no lane of this release has written it: the deploy that creates the
    // table) or UNREADABLE — is a hold this pass cannot know, and an EMPTY seed would let a restart dissolve the very
    // cluster the breaker exists to hold; stopping the lane would freeze it for good, since only a commit can supersede the
    // row. So the pass goes on and step six seeds the conservative hold, where `released` is known: nothing clears dirty by
    // comparing timestamps.
    let seedCause: DeadCoordinatorSeedCause | null = null;
    let readable: readonly DeadCoordinatorBreakerMember[] = [];
    if (!this.deadCoordinatorBreakerSeeded) {
      const st = coord.deadCoordinatorBreakerState();
      // The `run_events` record: the run an empty set is written on, and, under a state that is not clean, members to keep.
      const rec = coord.deadCoordinatorBreakerHeldLatest();
      this.deadCoordinatorBreakerHeldRunId ??= rec.runId;
      if (st.kind === 'sealed') {
        // A SEALED state (D-4916) is the only one a start trusts as it reads: the server's shutdown handler wrote it over a
        // clean state with nothing pending, so it is the exact snapshot of the last landed commit.
        // RECOVERY OF A LOST WRITE (fix round 4, D-4826), against the clean snapshot's write time. Every claimant of this
        // pass's population whose durable anchor STARTED (its `firstDeadAt`, never `lastDeadAt`, which every crashed pass
        // rewrites) after that snapshot was written is added to the seed, FLAGGED, at its anchor instant, beside every
        // member, instant and flag the snapshot carries. Since D-4857 every anchor change this release makes lands in the
        // same transaction as the snapshot, written with the write-time clock, so under a sealed state this flags only
        // anchors written outside those commits: an older build's, run against this database after a rollback (it writes
        // `dead_claimants` and never this table). It stays as the rule; the class it could not close (a held instant that
        // lived in memory alone while writes failed) is closed by the dirty state, not by it.
        const seeded = new Map(st.held.map((m) => [m.id, m]));
        for (const id of ids) {
          const a = anchors.get(id);
          if (a === undefined || a.firstDeadAt <= st.writtenAt) continue;
          const had = seeded.get(id);
          const all = [...new Set([...(had === undefined ? [] : [had.firstDeadAt, ...(had.instants ?? [])]), a.firstDeadAt])].sort((x, y) => x - y);
          seeded.set(id, { id, firstDeadAt: all[0]!, ...(all.length > 1 ? { instants: all } : {}), fallback: true as const });
        }
        this.deadCoordinatorBreakerHeld = [...seeded.values()];
        this.deadCoordinatorBreakerCommittedKey = deadCoordinatorBreakerHeldKey(st.held);
        this.deadCoordinatorBreakerDurableClean = true;
        this.deadCoordinatorBreakerSeeded = true;
        this.deadCoordinatorBreakerGeneration = st.generation;
        this.deadCoordinatorBreakerUnsealPending = true;
      } else {
        seedCause = st.kind === 'absent' ? { kind: 'absent' } : st.kind === 'dirty' ? { kind: 'dirty', generation: st.generation }
          : st.kind === 'clean' ? { kind: 'unsealed', generation: st.generation }
            : { kind: 'unreadable', reason: st.detail.slice(0, 64) };
        // Every member, instant and flag it can still read: the snapshot the row carries (a dirty row's last landed one, an
        // unsealed clean row's exact one), and the latest record.
        readable = mergeBreakerMembers(
          st.kind === 'dirty' ? (st.snapshot.kind === 'members' ? st.snapshot.members : []) : st.kind === 'clean' ? st.held : [],
          rec.ok ? rec.held : []);
      }
    }
    // THE EAGER UNSEAL (D-4916): before any step can change state or act, a process that read `sealed` writes `clean` back.
    if (this.deadCoordinatorBreakerUnsealPending) this.unsealDeadCoordinatorBreaker(coord);
    // FOUR — each claimant, measured by the reclaim door's own ladder, one at a time, through a tmux port that notes
    // a tmux that did not answer (a FLEET-wide doubt the breaker reads); then the journal clause for the dead ones in
    // ONE store read. A read that throws is `unreadable` for each of them — never "no history".
    const fleetDoubt: string[] = [];
    const tmux = {
      sessionVerdict: async (id: string) => {
        const v = await this.deps.tmux.sessionVerdict(id);
        if (v.verdict === 'unknown') fleetDoubt.push(`tmux did not answer for ${id}: ${v.detail}`);
        return v;
      },
    };
    // EACH claimant is measured at the instant it is measured — a fresh `Date.now()`, never the pass's `now`, which is
    // older by every awaited read before it: a supervisor heartbeat landing mid-pass would read as a FUTURE stamp, and a
    // coordinator being brought back would read crashed. That instant is that claimant's own through step five (its
    // anchor, its hour, its sighting); the pass's `now` stays the instant of what is the pass's — the cadence stamp, the
    // breaker's clock, the due test, the feed rows.
    const measured = new Map<string, Awaited<ReturnType<typeof measureClaimant>>>();
    const measuredAt = new Map<string, number>();
    for (const id of ids) {
      const at = Date.now();
      measuredAt.set(id, at);
      measured.set(id, await measureClaimant({ coord, io: this.deps.io, cfg: this.deps.cfg, tmux }, id, at));
    }
    const dead = ids.filter((id) => claimantMeasuredDead(measured.get(id)!));
    let journalOf: (id: string) => DeadCoordinatorJournal;
    /** The newest successful spawn's instant for a claimant the clause called crashed (so the journal was trusted), or `null`. */
    let journalSpawnedAtOf: (id: string) => number | null = () => null;
    try {
      const rows = coord.deadCoordinatorJournalRows(dead);
      journalOf = (id) => {
        const j = rows.get(id);
        return j === undefined ? { kind: 'no-history' } : deadCoordinatorJournal(j.rows, j.hasHistory, journal.trust);
      };
      journalSpawnedAtOf = (id) => { const j = rows.get(id); return j === undefined ? null : deadCoordinatorJournalSpawnedAt(j.rows); };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      journalOf = () => ({ kind: 'unreadable', detail });
    }
    // FIVE — a crash and only a crash keeps (or starts) the durable anchor; any other answer deletes it. DECIDED HERE, IN
    // MEMORY (D-4857): the decisions drive this pass's breaker and due test exactly as before, and reach `coord.db` only
    // through step six's commit, after the dirty mark.
    const crashed: { id: string; firstDeadAt: number; since: number; cause: Exclude<ClaimantDeadCause, 'stopped'> }[] = [];
    const unmeasurable: string[] = [];
    /** Claimants this pass gave EVIDENCE about — alive, stopped, a deliberate act: the breaker releases them. */
    const released = new Set<string>();
    const upserts: [string, DeadAnchor][] = [];
    const deletes: string[] = [];
    for (const id of ids) {
      const c = deadCoordinatorCrash(measured.get(id)!, journalOf(id));
      if (c.kind === 'unmeasurable') unmeasurable.push(id);
      if (c.kind === 'alive' || c.kind === 'stopped' || c.kind === 'deliberate') released.add(id);
      const at = measuredAt.get(id)!;
      this.deadCoordinatorState.set(id, deadCoordinatorSighted(this.deadCoordinatorState.get(id) ?? deadCoordinatorEntry(), c, at));
      if (c.kind === 'crashed') {
        const supervisedAt = records.find((r) => r.id === id)?.supervisedAt ?? null;
        // A supervisor heartbeat LATER than the anchor is supervision since it began: a new episode, anchored afresh (D-4825).
        // On the CONSERVATIVE SEED's pass (a state that was clean but not sealed, dirty, absent or unreadable) no durable anchor is taken as
        // continuing: a delete this process's predecessor decided may never have landed, so every crashed claimant's hour
        // restarts at this pass (review of D-4857, item 3). That only delays an act.
        const prev = seedCause !== null ? null : anchors.get(id) ?? null;
        // ...or a trusted journal's newest successful spawn later than it (D-4827): the unsupervised fallbacks stamp no heartbeat.
        const spawnedAt = journalSpawnedAtOf(id);
        const fresh = deadCoordinatorNewEpisode(prev, supervisedAt, at, spawnedAt);
        const a = deadAnchorNext(fresh ? null : prev, at);
        upserts.push([id, a]);
        crashed.push({ id, firstDeadAt: a.firstDeadAt, since: deadCoordinatorSince(a, supervisedAt, at), cause: c.cause });
      } else if (anchors.has(id)) {
        deletes.push(id);
      }
    }
    // A claimant that left the population (its runs closed, or reclaimed by an heir) is forgotten, anchor and all.
    for (const id of [...this.deadCoordinatorState.keys()]) if (!ids.includes(id)) this.deadCoordinatorState.delete(id);
    for (const id of anchors.keys()) if (!ids.includes(id)) deletes.push(id);
    // SIX — the circuit breaker, evaluated in shadow too, WITH ITS MEMORY: a member stays held until this pass gave
    // evidence about it or it left the population; a pass that only doubted it keeps it, at every instant it carries.
    let held: readonly DeadCoordinatorBreakerMember[];
    if (seedCause === null) {
      held = this.deadCoordinatorBreakerHeld.filter((m) => ids.includes(m.id) && !released.has(m.id));
    } else {
      // THE CONSERVATIVE SEED (D-4857; review 382, R2; D-4916): the state was clean but not sealed, dirty, absent or unreadable,
      // so FLAG every claimant of this pass's population that this pass does not release (alive, stopped, deliberate), each
      // `fallback` (the breaker HOLDS them only when two or more stand unreleased; one alone has its hour restarted), with
      // every instant and flag a readable snapshot or record still carries for it (a claimant it names nothing for is held
      // at `now`, which is compared with nothing). A flagged member clusters with every other entry whatever the instants
      // (`deadCoordinatorBreaker`, which carries the proof that this never loosens: a wildcard only adds clustered pairs,
      // adding entries never breaks a within-window adjacency, and every member any lane holds is an unreleased claimant of
      // the population, so the seed holds it). The flag is written into the commit's snapshot, so a later restart seeds
      // it too; the commit's key differs from the unseeded `''`, so step six's commit always runs.
      const kept = new Map(readable.map((m) => [m.id, m]));
      held = ids.filter((id) => !released.has(id)).map((id) => {
        const m = kept.get(id);
        return m === undefined ? { id, firstDeadAt: now, fallback: true as const } : { ...m, fallback: true as const };
      });
    }
    const breaker = deadCoordinatorBreaker(crashed, held, unmeasurable, ids.length,
      fleetDoubt.length === 0 ? null : fleetDoubt.join('; '), now);
    this.deadCoordinatorBreakerState = breaker;
    const before = this.deadCoordinatorBreakerHeld;
    const next = breaker.tripped ? breaker.members : [];
    // THE COMMIT (D-4857): the dirty mark alone, then ONE transaction for the anchor changes, the exact snapshot and the
    // state clean. Whatever lands, the in-memory hold MOVES to this pass's (monotone): a dirty mark or a commit that did
    // not land keeps the anchor changes pending (laid over the durable anchors, re-sent by the next commit), and the pass
    // acts on nothing (review of D-4857, items 1 and 2: a failed write must never forget a trip or a doubt).
    // The hold moves BEFORE the commit's first statement (fix round 5, R2): nothing the commit does can drop it.
    this.deadCoordinatorBreakerHeld = next;
    const commit = this.commitDeadCoordinatorBreaker(coord, next, upserts, deletes, ids, before);
    if (seedCause !== null) {
      this.deadCoordinatorBreakerSeeded = true;
      this.noteDeadCoordinatorSeed(coord, seedCause, next.map((m) => m.id), breaker.tripped, ids, commit === 'committed');
    }
    const recorded = commit === 'committed' || commit === 'unchanged';
    const key = deadCoordinatorBreakerKey(breaker);
    if (breaker.tripped && key !== this.deadCoordinatorBreakerRecorded) {
      recordDeadCoordinatorBreaker({ coord, notifyLog: this.deps.notifyLog }, breaker);
    }
    this.deadCoordinatorBreakerRecorded = key;
    // SEVEN — the act, never while the breaker stands, the longest dead first. ARMED, at most ONE claimant a pass. In
    // SHADOW every due claimant is recorded — a would-end touches nothing on the box, and the shadow list is what the
    // operator arms on (the shadow half of `one-dead-coordinator-per-pass`). The executor decides shadow from its own listing, so
    // an outcome that is not a would-end ends the pass however this pass's listing read. And only on a pass whose commit
    // LANDED, or that had nothing to commit over a state it knows is clean (`recorded`, D-4857, review 382, R3): shadow
    // would-ends included, so the durable state never lags an act.
    if (!breaker.tripped && recorded) {
      const due = crashed.filter((c) => {
        const e = this.deadCoordinatorState.get(c.id)!;
        return deadCoordinatorDue(c.since, e.crashedPasses, now) && now >= e.nextAskAt;
      }).sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
      const armed = deadCoordinatorLaneArmed(names);
      for (const pick of due) {
        const out = await this.deadCoordinatorAct(coord, pick, now);
        if (armed || out?.kind !== 'would-end') break;
      }
    }
    // EIGHT — the attention list, from the lane's memory and its breaker alone.
    this.deadCoordinatorAttentionList = deadCoordinatorAttention(this.deadCoordinatorState, this.deadCoordinatorBreakerState);
  }

  /** THE COMMIT of one pass (D-4857, the operator's ruling 4286) — in shadow too: `coord.db` rows, not a fleet act.
   *  The changes are this pass's anchor upserts and deletes laid over every change a commit has not landed yet
   *  (`AnchorsPending`). Four answers:
   *   - `unchanged`: nothing to change — no anchor, the held set's key is what the last landed commit wrote, and the state
   *     is known clean. Nothing is written; the pass may act;
   *   - `unseal-pending` (D-4916): a sealed start whose unseal has not landed. No breaker state or anchor is written (a tripping pass's feed row may be) and no act is composed;
   *     the changes stay pending and the caller moves the in-memory hold; the next pass retries the unseal first;
   *   - `mark-failed`: the dirty mark did not land. NO anchor change and no act; the changes stay pending for the next
   *     commit, as on `commit-failed`, and the caller moves the in-memory hold. The state still reads as the last landed
   *     write left it (clean, if it was, and never sealed: the first pass of every process unseals), older than this
   *     process's hold; a restart finds a state no start trusts, and seeds conservatively (D-4916);
   *   - `commit-failed`: the mark landed and the transaction did not (a refusal, a statement or a COMMIT that threw, or any
   *     statement between the mark and its result: the carrier read included).
   *     Nothing of it moved, the state stays dirty, the changes stay pending for the next commit, and the pass acts on
   *     nothing; the caller keeps the new in-memory hold;
   *   - `committed`: the exact snapshot, every change and the state clean landed together. Only now does this process
   *     move what it knows was committed (`CommittedKey`, `DurableClean`) or let the pass act.
   *  The `run_events` record rides the transaction when the set CHANGED: the carrier is any run that exists — for a set,
   *  the lowest open run a member coordinates; for an empty set, the run the last record sits on, else a run any claimant
   *  in the population (the members `before` the change first) coordinates; with none, the table alone carries it. */
  private commitDeadCoordinatorBreaker(
    coord: CoordStore, next: readonly DeadCoordinatorBreakerMember[], upserts: readonly (readonly [string, DeadAnchor])[],
    deletes: readonly string[], ids: readonly string[], before: readonly DeadCoordinatorBreakerMember[],
  ): 'unchanged' | 'unseal-pending' | 'mark-failed' | 'commit-failed' | 'committed' {
    const key = deadCoordinatorBreakerHeldKey(next);
    const changes = new Map(this.deadCoordinatorAnchorsPending);
    for (const [id, a] of upserts) changes.set(id, a);
    for (const id of deletes) changes.set(id, null);
    // A sealed start whose unseal has NOT landed writes nothing and acts on nothing (D-4916, R1.5): a later mark or commit of
    // this process does not count in its place, and writing one would move the row off `sealed` and make the unseal
    // impossible. The pass's changes go pending, the hold has moved, and the next pass retries the unseal first.
    if (this.deadCoordinatorBreakerUnsealPending) {
      for (const [id, a] of changes) this.deadCoordinatorAnchorsPending.set(id, a);
      return 'unseal-pending';
    }
    // `unchanged` also needs a write of this process to have landed and the state known clean (D-4916; review 401, F7).
    // Both terms are redundant HERE and kept as defence (X9, and this Landed term, measured equivalent): a sealed start's
    // pass returned above until its unseal landed; a conservative seed's CommittedKey `''` matches no set's key, so its first
    // pass commits; and the state is known unclean only after a mark whose commit did not land, whose anchor changes sit in
    // `AnchorsPending` or whose key differs from `CommittedKey`, so no pass reaches here with it unclean and nothing to write.
    if (changes.size === 0 && key === this.deadCoordinatorBreakerCommittedKey && this.deadCoordinatorBreakerDurableClean
      && this.deadCoordinatorBreakerLanded) return 'unchanged';
    // NO EXCEPTION MAY DROP A COMPUTED HOLD (fix round 5, R2; review 401, F2): the changes go PENDING before the first
    // statement that can throw, and a throw anywhere between here and the commit's result is folded into exactly the
    // commit-failed path (state dirty, changes pending, no act). The caller moves the in-memory hold before it calls.
    for (const [id, a] of changes) this.deadCoordinatorAnchorsPending.set(id, a);
    this.deadCoordinatorBreakerDurableClean = false;
    try {
      const mark = coord.markDeadCoordinatorBreakerDirty(Date.now());
      if (!mark.ok) {
        console.warn(`ccrc-server: sweepDeadCoordinators could not mark the breaker's state dirty (${mark.detail}) — no anchor changed and no act this pass; the changes stay pending`);
        return 'mark-failed';
      }
      // The mark landed: a write of this process. (A sealed start never reaches here before its unseal has landed.)
      this.deadCoordinatorBreakerLanded = true;
      const record: number[] = [];
      if (key !== this.deadCoordinatorBreakerCommittedKey) {
        if (next.length === 0 && this.deadCoordinatorBreakerHeldRunId !== null) record.push(this.deadCoordinatorBreakerHeldRunId);
        for (const id of [...next.map((m) => m.id), ...before.map((m) => m.id), ...ids]) {
          const open = coord.openRunsClaimedBy(id);
          if (open.ok && open.siblings.length > 0) { record.push(open.siblings[0]!.id); break; }
        }
      }
      // The WRITE-TIME clock, never the pass's `now`: a same-pass anchor (measured at its own, later instant) must not read
      // as started after this snapshot (fix round 4, D-4826).
      const c = coord.commitDeadCoordinatorBreakerState({ generation: mark.generation, held: next, at: Date.now(),
        upserts: [...changes].flatMap(([id, a]) => (a === null ? [] : [[id, a] as const])),
        deletes: [...changes].flatMap(([id, a]) => (a === null ? [id] : [])),
        record: key === this.deadCoordinatorBreakerCommittedKey ? null : record });
      if (!c.ok) {
        console.warn(`ccrc-server: sweepDeadCoordinators could not commit the breaker's state (${c.detail}) — it stays dirty, no act this pass; the next pass commits again`);
        return 'commit-failed';
      }
      this.deadCoordinatorAnchorsPending.clear();
      this.deadCoordinatorBreakerCommittedKey = key;
      this.deadCoordinatorBreakerDurableClean = true;
      this.deadCoordinatorBreakerGeneration = c.generation;
      if (c.recordedOn !== null) this.deadCoordinatorBreakerHeldRunId = c.recordedOn;
      return 'committed';
    } catch (err) {
      console.warn(`ccrc-server: sweepDeadCoordinators: a statement of the breaker's commit threw (${err instanceof Error ? err.message : String(err)}) — it stays dirty, no act this pass; the changes stay pending and the hold stands`);
      return 'commit-failed';
    }
  }

  /** The words for a pass that seeded the hold conservatively (D-4857; review 382, R2): ONE warn line and ONE feed row,
   *  naming the cause — `no breaker state yet` (absent), a state left dirty, or a row it could not read (a bounded
   *  reason, never the row's content) — through `recordRows`, saying whether that pass's record LANDED. They are said
   *  once because the pass that seeds sets `Seeded`. No new attention kind, no wire word. */
  private noteDeadCoordinatorSeed(
    coord: CoordStore, cause: DeadCoordinatorSeedCause, held: readonly string[], tripped: boolean, ids: readonly string[],
    landed: boolean,
  ): void {
    const record = cause.kind === 'absent' ? 'the first state' : 'a fresh record';
    // Conditioned like the feed row beside it (review 401, F5): a hold forms only when two or more coordinators stand unreleased.
    const what = held.length > 0 ? 'it holds every coordinator this pass did not see released, flagged'
      : tripped ? 'fewer than two coordinators stood unreleased, so no cluster formed, but the breaker tripped on a fleet-wide doubt and holds the lane'
        : 'fewer than two coordinators stood unreleased, so no cluster formed and it holds none';
    const rest = `— ${what}, and restarts every crashed coordinator's hour; ${landed
      ? `it wrote ${record}` : `${record} did not land, so it ends nothing until one does`}`;
    console.warn(cause.kind === 'absent'
      ? `ccrc-server: sweepDeadCoordinators: no breaker state yet ${rest}`
      : cause.kind === 'dirty'
        ? `ccrc-server: sweepDeadCoordinators found the breaker's state left dirty (generation ${cause.generation}) ${rest}`
        : cause.kind === 'unsealed'
          ? `ccrc-server: sweepDeadCoordinators found the breaker's state not sealed (generation ${cause.generation}: the last server did not end through a clean shutdown) ${rest}`
          : `ccrc-server: sweepDeadCoordinators could not read the breaker's record of its hold (the breaker state row: ${cause.reason}) ${rest}`);
    recordDeadCoordinatorBreakerSeed({ coord, notifyLog: this.deps.notifyLog }, cause, held, tripped, ids, landed);
  }

  /** The act — or its shadow — for one due claimant, on the coordination serialiser. Its outcome, or `null` when it
   *  was not asked (no serialiser) or threw. */
  private async deadCoordinatorAct(
    coord: CoordStore, pick: { id: string; since: number; cause: Exclude<ClaimantDeadCause, 'stopped'> }, now: number,
  ): Promise<DeadCoordinatorActOutcome | null> {
    const serial = this.deadCoordinatorSerial;
    if (serial === null) {
      console.warn(`ccrc-server: sweepDeadCoordinators: ${pick.id} is due, but no coordination serialiser is wired — nothing ended or recorded`);
      return null;
    }
    const deps = { coord, io: this.deps.io, cfg: this.deps.cfg, tmux: this.deps.tmux, notifyLog: this.deps.notifyLog,
      // Each re-measure reads the clock as it measures (the watcher's own source, `Date.now`), never the pass's `now`.
      now: (): number => Date.now(),
      // WHOLE — the hold with the trust — so a mirror gone stale since the pass is a `hold` stop (review 339, F4).
      journalTrust: () => readDeadCoordinatorJournalTrust({ coord, io: this.deps.io, cfg: this.deps.cfg }, this.lifecycleHealth()),
      // ...and its synchronous half again AFTER the claimant's measure, from the mirror as it is THEN (wave 6; review 355, F7).
      journalReread: (early: DeadCoordinatorJournalTrust) => rereadDeadCoordinatorJournalTrust(coord, this.lifecycleHealth(), early) };
    try {
      const out = await serial(coord, (abandon) => endDeadCoordinator({ ...deps, abandon }, pick.id, now));
      const e = this.deadCoordinatorState.get(pick.id) ?? deadCoordinatorEntry();
      // An act is always news; a shadow record or a pause is written when it CHANGES.
      if (out.kind === 'ended' || deadCoordinatorOutcomeKey(out) !== e.lastOutcome) {
        recordDeadCoordinatorFeed({ coord, notifyLog: this.deps.notifyLog }, pick.id, out, pick.since);
      }
      this.deadCoordinatorState.set(pick.id, deadCoordinatorNextEntry(e, out, pick.cause, pick.since, Date.now(), CHILD_RECLAIM_SWEEP_MS));
      // A re-measure that found it NOT crashed is evidence: its hour starts again from the next crash (ruling E: any
      // answer but a crash deletes the anchor, and `deadCoordinatorNextEntry` forgets the run of crashed passes).
      // The delete is STAGED (D-4857): pending, then a commit of its own — the dirty mark, the delete and the unchanged
      // snapshot in one transaction. One that does not land stays pending: the next pass lays it over the durable anchors
      // (a crash then starts a fresh anchor) and re-sends it.
      if (out.kind === 'ended' && out.stoppedBy?.kind === 'remeasured') {
        this.deadCoordinatorAnchorsPending.set(pick.id, null);
        this.commitDeadCoordinatorBreaker(coord, this.deadCoordinatorBreakerHeld, [], [], [], []);
      }
      return out;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(`ccrc-server: sweepDeadCoordinators: the act on ${pick.id} threw (${detail}) — asked again after a backoff`);
      const e = this.deadCoordinatorState.get(pick.id) ?? deadCoordinatorEntry();
      // The runs the act closed before it threw ARE closed: their feed rows are written, and the entry says what closed.
      const done = err instanceof DeadCoordinatorActThrew ? err.outcome : null;
      if (done !== null && done.programmes.length > 0) {
        recordDeadCoordinatorFeed({ coord, notifyLog: this.deps.notifyLog }, pick.id, done, pick.since);
      }
      // EVERY thrown act is recorded, whatever it had done (review 339, F13): one that released a worker and then threw,
      // having closed nothing, is otherwise only an in-memory entry a restart loses.
      recordDeadCoordinatorThrew({ coord, notifyLog: this.deps.notifyLog }, pick.id, done, detail, pick.since);
      this.deadCoordinatorState.set(pick.id, deadCoordinatorThrew(e, detail, Date.now(), CHILD_RECLAIM_SWEEP_MS,
        done !== null && done.programmes.length > 0 ? { closed: done.programmes, released: [], reheld: [], stop: null } : undefined));
      return null;
    }
  }

  /** The hold-release job's own executor: `releaseRetiredChildHold` on the
   *  SAME session `KeyedQueue` key `execChildReclaim` uses, so a release and
   *  a reclaim for the same child never run on the box at once. No test seam
   *  of its own — nothing in this wave's tests needs to intercept it, since
   *  the release job's own re-reads are exactly what a test wants to observe,
   *  so a test runs it for real against a recording `runCcd` instead. */
  private execChildReclaimRelease(
    coord: CoordStore, req: ChildReclaimReleaseRequest,
  ): Promise<ChildReclaimReleaseOutcome> {
    return this.deps.queue.run(req.sessionId, () => releaseRetiredChildHold({
      coord, io: this.deps.io, cfg: this.deps.cfg, runCcd: this.deps.runCcd,
      fleetState: this.deps.fleetState, presence: this.deps.presence, notifyLog: this.deps.notifyLog,
    }, req));
  }

  /**
   * Built as soon as a coordination database exists, not only on the first
   * SWEEP — `lifecycleHealth()` below needs one to ask before any sweep has
   * run, so the ONLY condition left absent is "no coordination database",
   * never "database present but not swept yet" (fix round 1: those two must
   * not collapse to the same `null`, the seam-overload rule). Construction
   * itself is side-effect-free (`JournalMirror`'s constructor only assigns
   * its deps); the filesystem and the clock are touched by `sweep()`, not by
   * this. One instance per process, same as before — `??=` still guards a
   * second store existing across two calls in the same tick.
   */
  private mirrorFor(store: CoordStore): JournalMirror {
    this.mirror ??= new JournalMirror({
      io: this.deps.io,
      registryDir: this.deps.cfg.registryDir,
      store,
      ccdVerbs: () => this.deps.fleetState?.ccdVerbs ?? null,
      now: () => Date.now(),
      // THREE INTERVALS. One missed sweep is not an alarm, three is — and the
      // multiplication happens HERE, at the one construction site, because
      // `mirror.ts` is L3 and may not import this module.
      staleAfterMs: LC_SWEEP_MS * 3,
    });
    return this.mirror;
  }

  /**
   * Mirror `$REG/.lifecycle/` into `coord.db` (build 9 §1 D5).
   *
   * ON THE EXISTING TICK, WITH NO NEW TIMER. Its own clock, like
   * `sweepDivergences` and `sweepNames`: `!== 0` so the FIRST sweep runs
   * immediately after a restart instead of waiting `LC_SWEEP_MS`, which is the
   * shape those two already ship.
   *
   * PUBLIC so a test can await it. `sweepMail` is not touched by this wave, by
   * name (D9): a second producer lands BESIDE the most load-bearing loop on
   * the box, never inside it.
   */
  async sweepLifecycle(): Promise<void> {
    const store = this.deps.coord;
    if (!store) return;
    const now = Date.now();
    if (this.lastLifecycleSweep !== 0 && now - this.lastLifecycleSweep < LC_SWEEP_MS) return;
    this.lastLifecycleSweep = now;
    await this.mirrorFor(store).sweep();
  }

  /**
   * Liveness for `claimExpiry`, off the rows THIS tick already assembled —
   * no second registry read (the one-listing rule `sweepDivergences` states).
   * `LivenessProbe` is `claims.ts`'s own port, declared by the consumer (L2).
   *
   * `Pick<…>` in the sweep signatures is deliberate: the sweeps read exactly
   * three fields, and a test should not have to fabricate a whole
   * `FleetSession` to exercise a lease.
   */
  private claimProbe(
    sessions: readonly Pick<FleetSession, 'id' | 'status' | 'unmeasured'>[],
  ): LivenessProbe {
    const byId = new Map(sessions.map((s) => [s.id, s]));
    return {
      liveness: (id: string) => {
        const s = byId.get(id);
        if (s === undefined) return 'gone';                 // the fleet no longer lists it
        if (s.unmeasured.length > 0) return 'unmeasurable'; // doubt reads as HELD (D12)
        return s.status === 'dead' ? 'gone' : 'running';
      },
    };
  }

  /**
   * D12: NO SESSION-SIDE HEARTBEAT — "a protocol a model must remember is a
   * protocol that will be forgotten, and the failure is a wedged module."
   * The server renews for a holder it can measure running (and for one it
   * cannot measure at all — doubt reads as held), on the EXISTING tick.
   * `claimExpiry` (L1) owns every decision; this method only applies the
   * `renew` arm. Synchronous: `tick()` wraps the pair in the same try/catch
   * `pushNewMail` earned, because both walk straight into `node:sqlite`.
   *
   * DOUBT RENEWS in this lane (the plan's cross-task ruling), and the fold
   * below is why holding is not enough: the in-tx expiry pre-pass on every
   * claim attempt reads only the clock, so a doubted holder whose stale
   * lease merely STOOD would be lapsed by the next rival's attempt — the
   * mass-expiry a fleet-box hiccup must not cause. The fold hands
   * `claimExpiry` the renewing verdict rather than deciding here, so the
   * hard cap still fells it first and a no-op renewal is still a hold; the
   * lapse lane below keeps the honest verdict, which is where "doubt is not
   * death" does its other half of the work.
   */
  renewClaims(sessions: readonly Pick<FleetSession, 'id' | 'status' | 'unmeasured'>[]): void {
    const now = Date.now();
    if (this.lastClaimRenew !== 0 && now - this.lastClaimRenew < CLAIM_SWEEP_MS) return;
    this.lastClaimRenew = now;
    const store = this.deps.coord;
    if (!store) return;
    const probe = this.claimProbe(sessions);
    for (const c of store.activeClaims()) {
      const v = probe.liveness(c.heldBy);
      const d = claimExpiry(c, now, v === 'unmeasurable' ? 'running' : v);
      if (d.act === 'renew') store.renewClaimRow(c.id, d.expiresAt, now);
    }
  }

  /** The lapse half — `claimExpiry`'s `lapse` arm applied. A holder measured
   *  gone lapses at the STANDING `expiresAt` with `endedBy:'session-gone'`;
   *  the 8 h hard cap lapses whatever the liveness said. Rows survive —
   *  `lapseClaimRow` lapses, never deletes. */
  lapseClaims(sessions: readonly Pick<FleetSession, 'id' | 'status' | 'unmeasured'>[]): void {
    const now = Date.now();
    if (this.lastClaimLapse !== 0 && now - this.lastClaimLapse < CLAIM_SWEEP_MS) return;
    this.lastClaimLapse = now;
    const store = this.deps.coord;
    if (!store) return;
    const probe = this.claimProbe(sessions);
    for (const c of store.activeClaims()) {
      const d = claimExpiry(c, now, probe.liveness(c.heldBy));
      if (d.act === 'lapse') store.lapseClaimRow(c.id, d.endedBy, now);
    }
  }

  /**
   * The stall watch's lane (spec 2026-09-29 §4.2 wave 1, §5 wave 2). The pure `coord/stall.ts` decides
   * everything; this method READS the inputs and APPLIES the answers, as `renewClaims` applies `claimExpiry`'s.
   * `tick()` dispatches it after the claim lanes and never awaits it. It has its own clock (`STALL_SWEEP_MS`) and
   * its own in-flight flag, and it returns with no store.
   *
   * The clock is COMPARED before the in-flight flag and STAMPED after it, so a pass refused by the flag does not
   * use up the next minute.
   *
   * Three kinds of subject, each in its own try/catch (`node:sqlite` throws synchronously, and one bad subject
   * must not starve the next):
   * - a run WORKER (`stallSubjects`): the run verdict, then its session verdicts (orphan E, failed, each mail
   *   stuck, orphan D), every notice recorded on its primary run;
   * - a run COORDINATOR (`stallCoordinatorSubjects`, minus the workers): orphan E, failed, each mail stuck, its
   *   marker and orphan D (slug `coordinators-draw-orphan-d` (D-3749)), all RUN-LESS (slug `coordinator-notices-are-run-less` (D-3653)),
   *   so none can stand in a worker's proof (b);
   * - every other registry row: orphan D only, and only once its marker records a restart that lost tasks.
   *
   * Reads (slug `three-reads-per-candidate` (D-3642)): at most three agent reads per worker — the live file, the turn
   * marker and the raw hookstate — and two per coordinator. The pane pid and the registry uuid are the tick's
   * (`StallTick`, REQUIRED: slug `tick-hands-the-lane-pids-and-records` (D-3649)). It reads the RAW live word, never
   * `FleetSession.status`, which folds `shell` and `waiting` into `busy`. It reads the hookstate RAW and unaged
   * (`readHookStateRawMeasured`): hold 2a correlates its ask with the dialog by time, and a legit question
   * outlives `HOOKSTATE_FRESH_MS`. One mail read per subject (`stallMailFor`, slug `one-mail-read-per-candidate` (D-3641)):
   * the run verdict meets it through `stallRunMail`, run mail only as wave 1 read it (slug
   * `run-mail-filtered-in-l1` (D-3650)); the session verdicts meet it whole.
   *
   * In memory, and pruned every sweep (`pruneStallMemory`): when a worker was first seen absent or dead-shaped,
   * when a marker was first seen unreadable, the run-less push latch and the warn-once keys. A server restart
   * re-times the clocks (slug `absent-worker-is-dead-after-grace` (D-3631)) and may repeat a run-less push, a coordinator's
   * failed rung 2 among them (slug `run-less-push-latches-are-in-memory` (D-3751); `stallLatch` names which, and why a
   * marker-unreadable push re-keys after a clock drop). More than STALL_CLOCK_GAP_MS from one judged sweep's end to the
   * next one's start drops the clocks (`dropStallClocks`, slug `stall-clocks-drop-on-an-unobserved-gap` (D-3750)).
   *
   * Every mail is durable and deduped: on a run by its observation row (`queueStallNotice`,
   * `recordStallObservation`), run-less by its subject (`hasMailWithSubject`), so a restart re-sends none.
   * PUBLIC for `stall-sweep.test.ts`.
   */
  async sweepStalls(sessions: readonly FleetSession[], names: readonly string[], tick: StallTick): Promise<void> {
    if (!this.primed) return;
    const store = this.deps.coord;
    if (!store) return;
    const now = Date.now();
    if (this.lastStallSweep !== 0 && now - this.lastStallSweep < STALL_SWEEP_MS) return;
    if (this.stallSweepRunning) return;
    this.lastStallSweep = now;
    this.stallSweepRunning = true;
    let judging = false;
    try {
      // `mail-disabled` reaches L1 as a fact, and `stallMailDisabledHold` decides what it holds (slug
      // `lane-honours-mail-disabled` (D-3636)). The module-local literal, never rundefs' export: see the import note.
      // The arming is the one settings resolution the mail sweep also calls (stall watch settings §9). The busy clock
      // then decides the mode the verdicts judge, and when mail-stuck's busy idle start begins (D-4024).
      const r = this.stallResolveNow(store, names, names.includes(MAIL_DISABLED_MARKER));
      const arming: StallArming = { ...r.arming, ...stallBusyClock(r.arming.mailMode, this.lastApplied, this.busySince) };
      if (arming.disabled) return;
      const paused = names.includes(COORDINATOR_PAUSE_MARKER);
      let candidates: ReturnType<CoordStore['stallCandidates']>;
      try {
        candidates = store.stallCandidates();
      } catch (err) {
        console.warn(`ccrc-server: stall-watch candidate read failed (${err instanceof Error ? err.message : String(err)}) — one bad sweep must not kill the poll`);
        return;
      }
      if (!candidates.ok) {
        console.warn(`ccrc-server: stall-watch candidates unreadable (${candidates.kind}: ${candidates.detail}) — nothing judged this sweep`);
        return;
      }
      // `stall-clocks-drop-on-an-unobserved-gap` (D-3750): the one gap rule. A first-seen clock claims its condition held at
      // every judged sweep since it was set. More than STALL_CLOCK_GAP_MS from the END of the last judged sweep to this
      // start means nobody watched in between (a disabled window, unreadable or throwing candidate reads, ticks that
      // never reached the lane), so every clock restarts here. The early returns above never stamp it: they are that
      // unobserved time. A judged sweep's own duration is observed time, so `finally` stamps its end.
      if (this.lastStallJudgedAt !== null && now - this.lastStallJudgedAt > STALL_CLOCK_GAP_MS) this.dropStallClocks();
      judging = true;
      const workers = stallSubjects(candidates.runs);
      const workerIds = new Set(workers.map((x) => x.primary.sessionId));
      const coordinators = stallCoordinatorSubjects(candidates.runs).filter((c) => !workerIds.has(c.sessionId));
      const judged = new Set([...workerIds, ...coordinators.map((c) => c.sessionId)]);
      this.pruneStallMemory(workerIds, judged, new Set([...judged, ...tick.records.map((r) => r.id)]));
      for (const subject of workers) {
        try {
          await this.judgeStall(store, subject, sessions, tick, arming, paused, now, r.quietMs);
        } catch (err) {
          console.warn(`ccrc-server: stall-watch run ${subject.primary.id} (${subject.primary.sessionId}) failed (${err instanceof Error ? err.message : String(err)}) — the next subject still runs`);
        }
      }
      for (const c of coordinators) {
        try {
          await this.judgeStallCoordinator(store, c, sessions, tick, arming, paused, now);
        } catch (err) {
          console.warn(`ccrc-server: stall-watch coordinator ${c.sessionId} failed (${err instanceof Error ? err.message : String(err)}) — the next subject still runs`);
        }
      }
      for (const r of tick.records) {
        if (judged.has(r.id)) continue;
        try {
          await this.judgeStallOrphan(store, r, sessions, tick, arming, paused, now);
        } catch (err) {
          console.warn(`ccrc-server: stall-watch session ${r.id} failed (${err instanceof Error ? err.message : String(err)}) — the next subject still runs`);
        }
      }
    } catch (err) {
      // A throw outside the per-subject catches (a listing's `includes`, `stallSubjects`, `stallCoordinatorSubjects`, `pruneStallMemory`)
      // would reach the tick's silent `.catch`, and the lane would die every minute with no trace. One line per bad sweep instead.
      console.warn(`ccrc-server: stall-watch sweep failed (${err instanceof Error ? err.message : String(err)}) — one bad sweep must not kill the poll`);
    } finally {
      // A judged sweep is stamped when it ENDS, its error path included, so the next start measures only unobserved time.
      if (judging) this.lastStallJudgedAt = Date.now();
      this.stallSweepRunning = false;
    }
  }

  /**
   * The stall-watch settings, resolved once for one sweep over that sweep's own listing (stall watch settings §9):
   * the box arming (`stallBoxArmingOf`), the stored row (`store.stallSettings()`), its parse and the one resolver, then
   * the warn latch and the boot trace (§8). Of the sweeps, `sweepStalls` and `sweepMail` both call it and neither reads
   * the row any other way, so the two cannot read it differently. Three readers stand outside them: the GET view
   * (`stallWatchView`, `coord/routes.ts`) composes the same reading in parallel, calling `store.stallSettings()`,
   * `parseStallSettings` and `resolveStallWatch` itself; the POST handler reads the row to measure a write's effect;
   * and `CoordStore.setStallSettings` reads it again inside the write. The view agrees with the sweeps by calling the
   * same L1 parse and resolver over the same row, not by calling this method.
   *
   * It NEVER THROWS. `sweepMail` runs under `void this.sweepMail().catch(() => {})`, so a throw here would stop all
   * mail delivery fleet-wide with no line. On any throw (a store, parse or resolver bug, or a fault in the latch or
   * the trace) it answers the expression both sweeps ran before settings existed, over the same listing, with the
   * built-in quiet time and `files`, so the fallback adds nothing that can throw where that did not. The catch calls
   * nothing that can throw: `reason` is composed in its own `try`, keeping a fixed word when even reading the error
   * throws, and its one warn is a bare `console.warn` in its own `try`, printed only when no fallback stood, and never
   * through the latch, which may be the fault. It records `lastFallback`; a resolution that succeeds clears it.
   */
  private stallResolveNow(store: CoordStore, names: readonly string[], mailDisabled: boolean): StallResolution {
    try {
      const box = stallBoxArmingOf(names, mailDisabled);
      const read = store.stallSettings();
      const parsed = parseStallSettings(read);
      const r = resolveStallWatch(box, parsed);
      this.stallSettingsNotes(read, parsed, r);
      this.lastFallback = null;
      return { arming: r.arming, quietMs: r.quietMs, levelSource: r.levelSource };
    } catch (err) {
      let reason = 'an unreadable fault';
      try {
        reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      } catch { /* even reading the error threw: the fixed word stands */ }
      if (this.lastFallback === null) {
        try {
          console.warn(`ccrc-server: stall-watch settings not applied (${reason}) — following the box files and the built-in quiet time`);
        } catch { /* a log line must not stop a sweep */ }
      }
      this.lastFallback = { at: Date.now(), reason };
      return { arming: { ...stallArmingOf(names), mailDisabled, mailMode: mailTurnModeOf(names) }, quietMs: STALL_QUIET_MS, levelSource: 'files' };
    }
  }

  /** The warn latch and the boot trace (§8), for one read that resolved. A read that does not apply warns once per
   *  read state, in its own words, and a read that applies re-arms every latch. The first read that is not
   *  unreadable traces a stored choice that applies, once, so a roll-forward or a restored `coord.db` leaves a line. */
  private stallSettingsNotes(read: StallSettingsRead, parsed: StallSettingsParsed, r: StallResolved): void {
    const states: (readonly [string, string])[] = read.kind === 'absent' ? [['absent', 'no stored choice']]
      : read.kind === 'unreadable' ? [['unreadable', `stored choice unreadable: ${read.detail.slice(0, 200)}`]]
      : [
        ...(parsed.level.kind === 'unreadable' ? [['level', 'stored level unreadable'] as const] : []),
        ...(parsed.quiet.kind === 'unreadable' ? [['quiet', 'stored quiet time unreadable'] as const] : []),
      ];
    if (states.length === 0) this.stallSettingsWarned.clear();
    for (const [state, words] of states) this.stallSettingsWarn(state, words);
    if (this.stallSettingsTraced || read.kind === 'unreadable') return;
    this.stallSettingsTraced = true;
    if (r.chosen === null && r.quietSource !== 'chosen') return;
    const level = r.chosen === null ? STALL_FOLLOW_LABEL : STALL_LEVEL_TEXT[r.chosen].label;
    const quiet = `${r.quietMs / 60_000} min${r.quietSource === 'chosen' ? '' : ' (built-in)'}`;
    console.warn(`ccrc-server: stall-watch level ${level} / quiet time ${quiet} chosen in Settings overrides the box files`);
  }

  /** The latch itself: one line per read state until a read applies again. `stallResolveNow`'s catch never calls it. */
  private stallSettingsWarn(state: string, words: string): void {
    if (this.stallSettingsWarned.has(state)) return;
    this.stallSettingsWarned.add(state);
    console.warn(`ccrc-server: stall-watch settings not applied (${words}) — following the box files and the built-in quiet time`);
  }

  /** The settings view's seam (stall watch settings §9, §10): the last resolution that fell back on a throw, or
   *  `null` once one succeeds. PUBLIC for `registerCoordRoutes`' optional watcher, as `releaseHeldAsk` is. */
  stallFallback(): { readonly at: number; readonly reason: string } | null {
    return this.lastFallback;
  }

  /** One run worker: read, decide, apply — the run verdict first, then its session verdicts in the spec's order
   *  (orphan E, failed, each mail stuck, orphan D). Its throws are the caller's to catch. `quietMs` is the resolved
   *  quiet time (stall watch settings §7), set on the run verdict's input; the session verdicts use fixed constants. */
  private async judgeStall(
    store: CoordStore, subject: StallSubject, sessions: readonly FleetSession[], tick: StallTick,
    arming: StallArming, paused: boolean, now: number, quietMs: number,
  ): Promise<void> {
    const primary = subject.primary;
    const id = primary.sessionId;
    const s = sessions.find((x) => x.id === id);
    this.stallSince(this.stallAbsentSince, id, s === undefined, now);
    this.stallSince(this.stallDeadSince, id, s !== undefined && stallDeadShaped(s.lifecycle), now);
    const ident = this.stallUuid(tick, id);
    const lr = s === undefined ? null : await this.stallLiveRead(id, s.wrapper, tick);
    const mark = await this.stallMarkRead(id, ident, lr);
    this.stallMarkClock(id, ident, mark, now);
    const raw = ident.ok
      ? await readHookStateRawMeasured(this.deps.io, this.deps.cfg.registryDir, id, ident.uuid)
      : STALL_RAW_UNMEASURED;
    const worker = this.stallWorkerFor(store, s, lr, stallHookAskOf(raw));
    const runIds = subject.runs.map((r) => r.id);
    const read = store.stallMailFor(id, runIds, now - BACKLOG_HORIZON_MS);
    if (!read.ok) {
      console.warn(`ccrc-server: stall-watch run ${primary.id} mail unreadable (${read.kind}: ${read.detail}) — held this sweep`);
      return;
    }
    // ONE run_events read gives the notices and the re-activation (`quiet-restarts-on-reactivation` (D-3788)): a throw
    // here is what it was before, this subject's warn and no verdict.
    const events = store.runEvents(primary.id);
    const notices = this.stallNoticesOf(events);
    const markUnreadableSince = this.stallMarkUnreadableSince.get(id) ?? null;
    let input: StallInput = {
      subject, worker, mail: stallRunMail(read.mail, runIds), notices, arming, quietMs, coordinationPaused: paused,
      coordinator: null, activation: stallReactivation(events),
      w2: {
        mark, hook: stallHookFactOf(raw), deliveries: read.deliveries,
        absentSince: this.stallAbsentSince.get(id) ?? null, deadSince: this.stallDeadSince.get(id) ?? null,
        markUnreadableSince,
      },
    };
    let v = stallVerdict(input, now);
    if (v.act === 'measure-coordinator') {
      // D-3570 `r2-measures-on-demand`: the reclaim door's own re-measurement, only when r2 falls due.
      const measured = await measureClaimant(
        { coord: store, io: this.deps.io, cfg: this.deps.cfg, tmux: this.deps.tmux }, v.coordinatorId, now);
      input = { ...input, coordinator: measured.state };
      v = stallVerdict(input, now);
    }
    if (v.act === 'notify') this.applyStall(store, input, v, now);
    const si: StallSessionInput = {
      sessionId: id, role: 'worker', run: primary, worker, mark, liveStartedAt: lr?.startedAt ?? null,
      markUnreadableSince, mail: read.mail, deliveries: read.deliveries, notices, arming, coordinationPaused: paused,
    };
    for (const sv of [stallOrphanEVerdict(si, now), stallFailedVerdict(si, now), ...stallMailStuckVerdicts(si, now), stallOrphanDVerdict(si, now)]) {
      this.applyStallSession(store, si, primary.project, sv, now);
    }
  }

  /** One run coordinator, judged RUN-LESS (slug `coordinator-notices-are-run-less` (D-3653)): its notices are keyed on
   *  their mail subjects and on in-memory latches, never on a claimed run's `run_events`, where its orphan E rows
   *  would count toward that run's worker's proof (b). Its verdicts, in the spec's order: orphan E, failed, each mail
   *  stuck, its marker, and orphan D last as for a worker (spec §5.2 "any session"; slug `coordinators-draw-orphan-d` (D-3749)).
   *  The registry-row loop skips every judged id, so this is the only place a coordinator's orphan D is asked.
   *  Reads: the live file and the marker. No session verdict takes a hookstate ask, so none is read, and
   *  `unmeasured` says so. Its mail read carries no run ids: its claimed runs' mail is its worker's subject. */
  private async judgeStallCoordinator(
    store: CoordStore, c: { readonly sessionId: string; readonly runs: readonly StallRunRow[] },
    sessions: readonly FleetSession[], tick: StallTick, arming: StallArming, paused: boolean, now: number,
  ): Promise<void> {
    const id = c.sessionId;
    const s = sessions.find((x) => x.id === id);
    const ident = this.stallUuid(tick, id);
    const lr = s === undefined ? null : await this.stallLiveRead(id, s.wrapper, tick);
    const mark = await this.stallMarkRead(id, ident, lr);
    this.stallMarkClock(id, ident, mark, now);
    const worker = this.stallWorkerFor(store, s, lr, STALL_HOOK_ASK_UNREAD);
    const read = store.stallMailFor(id, [], now - BACKLOG_HORIZON_MS);
    if (!read.ok) {
      console.warn(`ccrc-server: stall-watch coordinator ${id} mail unreadable (${read.kind}: ${read.detail}) — held this sweep`);
      return;
    }
    const si: StallSessionInput = {
      sessionId: id, role: 'coordinator', run: null, worker, mark, liveStartedAt: lr?.startedAt ?? null,
      markUnreadableSince: this.stallMarkUnreadableSince.get(id) ?? null,
      mail: read.mail, deliveries: read.deliveries, notices: [], arming, coordinationPaused: paused,
    };
    const project = s?.project ?? c.runs[0]?.project ?? '';
    for (const sv of [stallOrphanEVerdict(si, now), stallFailedVerdict(si, now), ...stallMailStuckVerdicts(si, now), stallSessionMarkerVerdict(si, now), stallOrphanDVerdict(si, now)]) {
      this.applyStallSession(store, si, project, sv, now);
    }
  }

  /** A registry row that is no run's worker or coordinator: orphan D only (spec §5.2, "Candidates are the registry
   *  rows whose marker reads done with lostBg > 0"). ONE read, the marker judged with no live file, and the live
   *  file only for a marker that records a restart which lost background tasks. That gate is L1's
   *  (`stallOrphanDCandidate`, the mark alone), spent here on the read budget; this method asks it and spells no
   *  conjunct. `stallOrphanDVerdict` asks the same predicate again with the live facts, and re-judges the marker
   *  against the live process's start. A row whose identity is unmeasured reads nothing: these rows are not
   *  candidates for `marker-unreadable` (slug `coordinator-marker-unreadable` (D-3654)). Nor does a row with no live pane,
   *  which orphan D can never wake: a read-budget skip. */
  private async judgeStallOrphan(
    store: CoordStore, r: SessionRecord, sessions: readonly FleetSession[], tick: StallTick,
    arming: StallArming, paused: boolean, now: number,
  ): Promise<void> {
    const ident = measuredIdentity(r);
    if (ident === null) return;
    // A read-budget skip, like the line above: orphan D answers none without an idle live word, and a
    // row with no live pane has none (`stallLiveRead` folds a missing entry and a null pid alike to `no-pane`). Most
    // registry rows are long-dead sessions, so they cost no agent read.
    if (!tick.panePids.get(r.id)) return;
    const mark = await readTurnMarkMeasured(this.deps.io, this.deps.cfg.registryDir, r.id, ident.uuid, null);
    if (!mark.ok || !stallOrphanDCandidate(mark)) return;
    const s = sessions.find((x) => x.id === r.id);
    const lr = s === undefined ? null : await this.stallLiveRead(r.id, s.wrapper, tick);
    const worker = this.stallWorkerFor(store, s, lr, STALL_HOOK_ASK_UNREAD);
    const read = store.stallMailFor(r.id, [], now - BACKLOG_HORIZON_MS);
    if (!read.ok) {
      console.warn(`ccrc-server: stall-watch session ${r.id} mail unreadable (${read.kind}: ${read.detail}) — held this sweep`);
      return;
    }
    const si: StallSessionInput = {
      sessionId: r.id, role: 'other', run: null, worker, mark, liveStartedAt: lr?.startedAt ?? null,
      markUnreadableSince: null, mail: read.mail, deliveries: read.deliveries, notices: [], arming,
      coordinationPaused: paused,
    };
    this.applyStallSession(store, si, s?.project ?? r.project, stallOrphanDVerdict(si, now), now);
  }

  /** The registry uuid this sweep reads a marker and a hookstate against, off the tick's own rows. No row: `null`
   *  (unregistered). A row whose identity the tick could not measure: `ok:false`, never folded into
   *  "unregistered" (an adapter may not narrow a distinction it received). */
  private stallUuid(tick: StallTick, id: string): StallUuid {
    const rec = tick.records.find((r) => r.id === id);
    if (rec === undefined) return { ok: true, uuid: null };
    const ident = measuredIdentity(rec);
    return ident === null ? { ok: false } : { ok: true, uuid: ident.uuid };
  }

  /** Read 1: the raw live word and the live process's start. The pid is the one `assembleFleet` read this tick; no
   *  entry (a pane that was not alive) and a null (tmux answered none) are both `no-pane`, as wave 1's own
   *  `panePid` folded them. An unrostered wrapper and the read's `no-state` and `unmeasured` are each a named hold. */
  private async stallLiveRead(id: string, wrapper: string, tick: StallTick): Promise<StallLive> {
    const pid = tick.panePids.get(id) ?? null;
    if (!pid) return { live: { ok: false, reason: 'no-pane' }, startedAt: null };
    const cfgDir = configDirFor(this.deps.cfg, wrapper);
    if (!cfgDir) return { live: { ok: false, reason: 'no-config-dir' }, startedAt: null };
    const read = await readLiveStateMeasured(this.deps.io, cfgDir, pid);
    return read.ok
      ? { live: { ok: true, word: read.state.status, since: read.state.statusUpdatedAt }, startedAt: read.state.startedAt }
      : { live: { ok: false, reason: read.reason }, startedAt: null };
  }

  /** D-5233: did a main Stop fall inside this busy stretch? Asked only at a busy→idle edge, so the reads are rare. The
   *  turn marker is read for this id only, with the row's identity. Its `absent`, `malformed` and `foreign` readings
   *  need no live read, so a session with no live-status file (`no-state`: an older build, or one that has not
   *  published yet) still reaches the `absent` fallback. A readable marker is then judged stale against the live
   *  process's start (a second live read: the tick's row carries no `startedAt`); with no pane, no config dir, or a
   *  live read that is `no-state` or `unmeasured`, that start is unknown, so the marker is unjudgeable, counts as
   *  `unmeasured` and pushes nothing. An `absent` marker falls back to the hookstate the tick already holds. The rule
   *  is `finishedAfter`'s (L1). */
  private async finishedEvidence(id: string, wrapper: string, records: readonly SessionRecord[],
    panePids: ReadonlyMap<string, number | null>, busySince: number): Promise<boolean> {
    const hs = this.hookStates.get(id);
    const mark = await this.finishedMark(id, wrapper, records, panePids);
    return finishedAfter(mark, hs === undefined ? null : { state: hs.state, event: hs.event, updatedAt: hs.updatedAt }, busySince);
  }

  /** `finishedEvidence`'s marker read: the shape and identity first, with no staleness judgement; a readable marker
   *  then needs the live process's start, or it is `unmeasured`. */
  private async finishedMark(id: string, wrapper: string, records: readonly SessionRecord[],
    panePids: ReadonlyMap<string, number | null>): Promise<TurnMarkRead> {
    const rec = records.find((r) => r.id === id);
    const ident = rec === undefined ? null : measuredIdentity(rec);
    if (ident === null) return { ok: false, reason: 'unmeasured' };
    const mark = await readTurnMarkMeasured(this.deps.io, this.deps.cfg.registryDir, id, ident.uuid, null);
    if (!mark.ok) return mark;
    const pid = panePids.get(id) ?? null;
    const cfgDir = configDirFor(this.deps.cfg, wrapper);
    if (!pid || !cfgDir) return { ok: false, reason: 'unmeasured' };
    const live = await readLiveStateMeasured(this.deps.io, cfgDir, pid);
    if (!live.ok) return { ok: false, reason: 'unmeasured' };
    // As `readTurnMarkMeasured` judges it: a live file with no process start cannot vouch for the marker.
    return live.state.startedAt === null || turnMarkStale(mark, live.state.startedAt) ? { ok: false, reason: 'stale' } : mark;
  }

  /** Read 2: the turn marker. Judged for staleness against the live process when the live file was read; with no
   *  live read, L1 re-judges it from `liveStartedAt`. An unmeasured identity cannot be compared, so it answers
   *  `unmeasured` without reading, and `stallMarkClock` does not count that answer. */
  private async stallMarkRead(id: string, ident: StallUuid, lr: StallLive | null): Promise<TurnMarkRead> {
    if (!ident.ok) return { ok: false, reason: 'unmeasured' };
    return readTurnMarkMeasured(this.deps.io, this.deps.cfg.registryDir, id, ident.uuid,
      lr !== null && lr.live.ok ? { startedAt: lr.startedAt } : null);
  }

  /** The session's facts. They come from this tick's fleet row, the live read and the hookstate ask; the two store
   *  reads are synchronous. A failed auto-continue read has no slot of its own: it is a failed store read, hold 1,
   *  so it raises `unmeasured`. */
  private stallWorkerFor(store: CoordStore, s: FleetSession | undefined, lr: StallLive | null, hookAsk: HookAskFact): StallWorker {
    if (s === undefined || lr === null) return { present: false };
    const ask = store.currentAskFor(s.id);
    const askRow: AskRowFact = !ask.ok ? { kind: 'unmeasured' }
      : ask.ask === null ? { kind: 'none' } : { kind: 'row', state: ask.ask.state, at: ask.ask.at };
    const held = store.autoContinueHeldUntil(s.id);
    return {
      present: true,
      unmeasured: s.unmeasured.length > 0 || s.statusUnmeasured || !held.ok,
      lifecycle: s.lifecycle,
      limits: s.limits,
      dialogPending: s.dialogPending,
      stranded: s.stranded !== null,
      swapBlocked: s.swapBlocked !== null,
      live: lr.live,
      hookAsk,
      askRow,
      // `backOff` stores no time of its own, so the START of the hold is `nextAttemptAt − MAIL_ARMED_HOLD_MS`.
      // It is computed here because that constant is private to this file (spec §4.2, hold 3).
      autoContinueHeldAt: held.ok && held.until !== null ? held.until - MAIL_ARMED_HOLD_MS : null,
    };
  }

  /** The stall rows among one run's events, parsed. A detail this build cannot name is skipped (`parseStallDetail`). */
  private stallNoticesOf(events: ReturnType<CoordStore['runEvents']>): StallNotice[] {
    const notices: StallNotice[] = [];
    for (const e of events) {
      const parsed = parseStallDetail(e.detail);
      if (parsed !== null) notices.push({ ...parsed, at: e.at });
    }
    return notices;
  }

  /** Drops every first-seen clock (slug `stall-clocks-drop-on-an-unobserved-gap` (D-3750)), the one clearing method. Its one
   *  caller is the gap rule in `sweepStalls`: when more than STALL_CLOCK_GAP_MS passed since the last judged sweep ended,
   *  each clock restarts from this sweep, never firing on a duration nobody watched. A single unlistable tick, one
   *  refused pass or one missed sweep leaves no such gap. This is the lane's bookkeeping of its own observations, not
   *  a stall rule, so it stays in L4. */
  private dropStallClocks(): void {
    this.stallAbsentSince.clear();
    this.stallDeadSince.clear();
    this.stallMarkUnreadableSince.clear();
  }

  /** Keeps a first-seen time while `holds`, and drops it the first sweep it does not. */
  private stallSince(map: Map<string, number>, id: string, holds: boolean, now: number): void {
    if (!holds) { map.delete(id); return; }
    if (!map.has(id)) map.set(id, now);
  }

  /** The marker-unreadable first-seen clock. It counts only a marker READ that answered `unmeasured` or `malformed`.
   *  A session whose registry uuid the tick could not measure reads no marker (its `unmeasured` is `stallMarkRead`'s
   *  own answer, not the file's), so it neither starts the clock nor keeps one: a first-seen time from an earlier
   *  read is dropped, never left to fire off a sweep that read nothing. */
  private stallMarkClock(id: string, ident: StallUuid, mark: TurnMarkRead, now: number): void {
    this.stallSince(this.stallMarkUnreadableSince, id, ident.ok && stallMarkUnreadable(mark), now);
  }

  /** One warn per key (`<sessionId>|<what>`) for as long as the session stays in the registry. */
  private stallWarnOnce(sessionId: string, what: string, line: string): void {
    const key = `${sessionId}|${what}`;
    if (this.stallWarned.has(key)) return;
    this.stallWarned.add(key);
    console.warn(line);
  }

  /** The in-memory state's prune, every sweep. The absent and dead clocks live while their session is a run worker,
   *  the marker's first-seen time while it is a worker or a coordinator, and the latch and warn-once keys while
   *  their session is in the registry. A latch entry carries its session id, so the prune never parses a tag. */
  private pruneStallMemory(workers: ReadonlySet<string>, judged: ReadonlySet<string>, known: ReadonlySet<string>): void {
    for (const m of [this.stallAbsentSince, this.stallDeadSince]) for (const id of [...m.keys()]) if (!workers.has(id)) m.delete(id);
    for (const id of [...this.stallMarkUnreadableSince.keys()]) if (!judged.has(id)) this.stallMarkUnreadableSince.delete(id);
    for (const [tag, id] of [...this.stallLatch]) if (!known.has(id)) this.stallLatch.delete(tag);
    for (const key of [...this.stallWarned]) if (!known.has(key.slice(0, key.indexOf('|')))) this.stallWarned.delete(key);
  }

  /** Applies a run verdict's notify, and decides nothing. `stallNotifyDelivery` picks shadow or send from the markers
   *  (a wave-2 arm is shadow without `stall-watch-w2-live`).
   *  - Shadow: record a `stall-shadow:` row and warn once.
   *  - Send to the worker (r1) or the coordinator (r2, or a frozen or dead report): one `queueStallNotice`
   *    transaction (the row, then the mail).
   *  - Send to the operator: record the row first, then push, and only when the row is new.
   *  A refused write (`duplicate`, or `run-gone`: absent or no longer active, D-3584) sends and warns nothing. */
  private applyStall(store: CoordStore, input: StallInput, n: StallNotify, now: number): void {
    const primary = input.subject.primary;
    const worker = primary.sessionId;
    if (stallNotifyDelivery(n.arm, n.to, input.arming) === 'shadow') {
      const obs = store.recordStallObservation(primary.id, stallDetail('shadow', n.arm, n.rung, n.key), now);
      if (obs.recorded) console.warn(`ccrc-server: stall-watch shadow ${n.arm} r${n.rung} run ${primary.id} ${worker}`);
      return;
    }
    const detail = stallDetail('live', n.arm, n.rung, n.key);
    const facts = stallFacts(input);
    if (n.to === 'worker') {
      const text = stallCheckMail(input, facts, now);
      queueStallNotice(store, primary, { detail, at: now, toId: worker, kind: 'status', subject: text.subject, body: text.body });
      return;
    }
    if (n.to === 'coordinator') {
      if (n.arm !== 'quiet') {
        const report = stallW2ReportMail(input, facts, n, now);
        queueStallNotice(store, primary, { detail, at: now, toId: n.coordinatorId, kind: 'status', subject: report.subject, body: report.body });
        return;
      }
      // r2's body cites r1: `stallCitedCheck` (L1, M7a) picks its earliest LIVE row when one exists, else its
      // earliest row, because arming mid-episode leaves a shadow r1 before the live one (D-3572
      // `shadow-rung-accounting`). Its mail is `stallLastCheck`'s, with that mail's NEWEST delivery row from the one
      // mail read; a check with no delivery row hands null, never a row of nulls (D-3585). The null branch below is
      // DEFENSIVE and unreachable from real inputs today: the verdict and the citation read the same notice rows, so
      // an r2 that falls due always has an r1 to cite. It stays so that a later drift between the two warns once
      // instead of sending an r2 that cites nothing.
      const r1 = stallCitedCheck(input, n.key);
      if (r1 === null) {
        this.stallWarnOnce(worker, `no-r1-${primary.id}-${n.key}`, `ccrc-server: stall-watch run ${primary.id} r2 fell due with no r1 row — not sent`);
        return;
      }
      const r1Mail = stallLastCheck(input);
      const r1Row = r1Mail === null ? null : stallNewestDelivery(input.w2?.deliveries ?? [], r1Mail.id);
      const r1Delivery = r1Mail === null || r1Row === null ? null
        : { queuedAt: r1Mail.at, deliveredAt: r1Row.deliveredAt, ackedAt: r1Row.ackedAt };
      const text = stallReportMail(input, facts, r1, r1Delivery, now);
      queueStallNotice(store, primary, { detail, at: now, toId: n.coordinatorId, kind: 'status', subject: text.subject, body: text.body });
      return;
    }
    const obs = store.recordStallObservation(primary.id, detail, now);
    if (!obs.recorded) return;
    const text = stallPushText(input, facts, n, now);
    const route = stallPushRoute(n, worker, primary.id);
    this.pushOne({
      kind: route.kind, sessionId: worker, project: primary.project, title: text.title, body: text.body,
      runId: primary.id, tag: route.tag, recordAlways: true,
    }, this.activeProjects);
  }

  /** Applies one session verdict (orphan D and E, failed, mail stuck, a coordinator's marker), and decides nothing.
   *  - A hold applies nothing, except `failed-unknown`, which warns once (spec §5.2: never guessed into a
   *    self-wake).
   *  - Shadow: a worker records a `stall-shadow:` row on its run; a run-less session warns once per key, the key in the line (`runless-shadow-line-carries-its-key` (D-3800)).
   *  - To the session itself or to its coordinator: one `queueStallNotice`, on the worker's run, or run-less and
   *    deduped by its subject.
   *  - To the operator: a worker records the row first and pushes only when it is new; a run-less session latches in
   *    memory (`stallLatch`, slug `run-less-push-latches-are-in-memory` (D-3751)), so a restart re-pushes it, a coordinator's
   *    failed rung 2 included, and a marker-unreadable push re-keys on each side of a clock drop. L1's
   *    `stallPushRoute` names the push's kind and tag, which is also the latch key. */
  private applyStallSession(store: CoordStore, si: StallSessionInput, project: string, v: StallVerdict, now: number): void {
    const id = si.sessionId;
    if (v.act === 'hold' && v.why === 'failed-unknown') {
      const stopAt = si.mark.ok ? si.mark.stopAt : null;
      const err = si.mark.ok ? si.mark.err : null;
      this.stallWarnOnce(id, `failed-unknown-${stopAt}`, `ccrc-server: stall-watch unknown StopFailure ${err} on ${id} — held, never guessed into a self-wake`);
      return;
    }
    if (v.act !== 'notify') return;
    const run = si.run;
    if (stallNotifyDelivery(v.arm, v.to, si.arming) === 'shadow') {
      if (run === null) {
        this.stallWarnOnce(id, `shadow-${v.arm}-${v.rung}-${v.key}`, `ccrc-server: stall-watch shadow ${v.arm} r${v.rung} ${id} (run-less) key ${v.key}`);
        return;
      }
      const obs = store.recordStallObservation(run.id, stallDetail('shadow', v.arm, v.rung, v.key), now);
      if (obs.recorded) console.warn(`ccrc-server: stall-watch shadow ${v.arm} r${v.rung} run ${run.id} ${id}`);
      return;
    }
    const detail = stallDetail('live', v.arm, v.rung, v.key);
    if (v.to === 'worker') {
      const text = stallSessionMail(si, v, now);
      queueStallNotice(store, run, { detail, at: now, toId: id, kind: 'status', subject: text.subject, body: text.body });
      return;
    }
    if (v.to === 'coordinator') {
      const text = stallSessionMail(si, v, now);
      queueStallNotice(store, run, { detail, at: now, toId: v.coordinatorId, kind: 'status', subject: text.subject, body: text.body });
      return;
    }
    const route = stallPushRoute(v, id, run === null ? null : run.id);
    if (run !== null) {
      const obs = store.recordStallObservation(run.id, detail, now);
      if (!obs.recorded) return;
      const text = stallSessionPushText(si, v, now);
      this.pushOne({
        kind: route.kind, sessionId: id, project, title: text.title, body: text.body,
        runId: run.id, tag: route.tag, recordAlways: true,
      }, this.activeProjects);
      return;
    }
    if (this.stallLatch.has(route.tag)) return;
    this.stallLatch.set(route.tag, id);
    const text = stallSessionPushText(si, v, now);
    this.pushOne({
      kind: route.kind, sessionId: id, project, title: text.title, body: text.body,
      tag: route.tag, recordAlways: true,
    }, this.activeProjects);
  }

  /**
   * `idle-compact-nudge` (D-5373; operator ruling 2026-10-17, "Nudge if work is open"). After Claude Code's idle
   * compaction — which runs on a turn that had ENDED and starts none — type ONE "continue" prompt into a session whose
   * task list is fresh and has open items. L4: it gathers the facts and applies `decideIdleCompactNudge`'s answer
   * (`idlenudge.ts`, L1), which holds on every fact it could not read.
   *
   * The reads are staged cheapest first and each stops at the first hold: the fleet row (no read), then the live
   * status, the turn marker, the task list, and last the transcript tail (a stat, and a read only when the file
   * changed). At most once per compaction: the `<id>#<key>` pair is added to `idleNudged` and the `nudge` feed row is
   * recorded BEFORE `sendPrompt` runs, and that row (`hasFeedEvent`, exact body) is what a restarted server reads. A
   * row that did not land types nothing. The send is `sendPrompt` with its echo proofs, never over a draft, a menu,
   * an armed limit recovery or a pane that shows a turn running. The nudge then reads as the `idle-compact-nudge` pill
   * in the chat (`transcript/parse.ts`), and its user row is itself a hold for this compaction.
   */
  async sweepIdleCompactNudge(sessions: readonly FleetSession[], names: readonly string[], tick: StallTick): Promise<void> {
    if (!this.primed || this.idleNudgeRunning) return;
    this.idleNudgeRunning = true;
    try {
      const disabled = idleNudgeDisabled(names);
      const coord = this.deps.coord;
      const durable = coord !== undefined && this.deps.notifyLog !== undefined;
      for (const s of sessions) {
        const row: IdleNudgeRowFacts = {
          disabled, durable, unmeasured: s.unmeasured.length > 0 || s.statusUnmeasured,
          lifecycle: s.lifecycle, archived: s.archivedAt !== null, status: s.status,
          dialogPending: s.dialogPending, askSummary: s.askSummary, ask: s.ask?.state ?? null,
        };
        if (idleNudgeRowHold(row) !== null || coord === undefined) continue;
        await this.idleNudgeOne(s, row, coord, tick);
      }
    } finally {
      this.idleNudgeRunning = false;
    }
  }

  /** One session past the row holds: the staged reads, the decision, and the send. */
  private async idleNudgeOne(s: FleetSession, row: IdleNudgeRowFacts, coord: CoordStore, tick: StallTick): Promise<void> {
    const rec = tick.records.find((r) => r.id === s.id);
    const ident = rec === undefined ? null : measuredIdentity(rec);
    const cfgDir = ident === null ? null : configDirFor(this.deps.cfg, ident.wrapper);
    const pid = tick.panePids.get(s.id) ?? null;
    if (ident === null || !cfgDir || !pid) return;
    const liveRead = await readLiveStateMeasured(this.deps.io, cfgDir, pid);
    const live = liveRead.ok
      ? { ok: true as const, word: liveRead.state.status, since: liveRead.state.statusUpdatedAt }
      : { ok: false as const };
    const base = { ...row, now: Date.now(), live, mark: { ok: false as const }, tasks: { ok: false as const },
      compaction: { kind: 'none' as const }, alreadyNudged: () => false };
    // Stage 1: everything but the marker, the tasks and the tail. A hold here costs no further read.
    let v = decideIdleCompactNudge(base);
    if (v.act === 'hold' && v.reason !== 'no-marker') return;
    const markRead = await readTurnMarkMeasured(this.deps.io, this.deps.cfg.registryDir, s.id, ident.uuid,
      liveRead.ok ? { startedAt: liveRead.state.startedAt } : null);
    const mark = markRead.ok ? { ok: true as const, state: markRead.state, bg: markRead.bg } : { ok: false as const };
    v = decideIdleCompactNudge({ ...base, mark });
    if (v.act === 'hold' && v.reason !== 'tasks-unread') return;
    const taskRead = await readTasks(this.deps.io, cfgDir, ident.uuid, { touchedAt: true });
    const tasks = taskRead.listed
      ? { ok: true as const, open: taskRead.tasks.filter((t) => t.status === 'in_progress' || t.status === 'pending').length,
        touchedAt: taskRead.touchedAt ?? null }
      : { ok: false as const };
    v = decideIdleCompactNudge({ ...base, mark, tasks });
    if (v.act === 'hold' && v.reason !== 'no-compaction') return;
    const compaction = await this.idleNudgeTail(s.id, cfgDir, ident);
    const alreadyNudged = (key: string): boolean =>
      this.idleNudged.has(`${s.id}#${key}`) || coord.hasFeedEvent('nudge', s.id, idleNudgeFeedBody(key));
    v = decideIdleCompactNudge({ ...base, now: Date.now(), mark, tasks, compaction, alreadyNudged });
    if (v.act !== 'nudge') return;
    // Once, BEFORE the send: this process's set, then the durable row. A row that did not land types nothing.
    this.idleNudged.add(`${s.id}#${v.key}`);
    const body = idleNudgeFeedBody(v.key);
    this.pushOne({ kind: 'nudge', sessionId: s.id, project: s.project, title: '↻ Nudging after idle compaction', body,
      recordAlways: true, recordOnly: true }, this.activeProjects);
    if (!coord.hasFeedEvent('nudge', s.id, body)) {
      console.warn(`ccrc-server: idle-compact-nudge ${s.id} compaction ${v.key}: the feed record did not land — nothing typed`);
      return;
    }
    const res = await sendPrompt({ tmux: this.deps.tmux, queue: this.deps.queue }, s.id, IDLE_COMPACT_NUDGE_PROMPT,
      { holdIfAutoContinueArmed: true, refuseIfTurnRunning: true });
    console.warn(`ccrc-server: idle-compact-nudge ${s.id} compaction ${v.key}: ${res.ok ? 'typed' : `refused (${res.error}), not retried`}`);
    // The feed agrees with the log line: a refused send gets its own row, so "Nudging" is never the last word on a
    // nudge that typed nothing.
    if (!res.ok) {
      this.pushOne({ kind: 'nudge', sessionId: s.id, project: s.project, title: '↻ Nudge not typed',
        body: idleNudgeRefusedBody(v.key, res.error), recordAlways: true, recordOnly: true }, this.activeProjects);
    }
  }

  /** The newest compaction in this session's transcript tail, re-read only when the file's size or mtime moved. An
   *  unreadable or absent file answers `none`, which holds. */
  private async idleNudgeTail(id: string, cfgDir: string, ident: { uuid: string; workdir: string }): Promise<CompactionTail> {
    const file = (await this.transcripts.resolve({
      configDir: cfgDir, dir: ident.workdir, registryWorkdir: ident.workdir, uuid: ident.uuid,
    })).path;
    const st = await this.deps.io.statMeasured(file);
    if (!st.ok) return { kind: 'none' };
    const sig = `${file}:${st.size}:${st.mtimeMs}`;
    const memo = this.idleNudgeTails.get(id);
    if (memo !== undefined && memo.sig === sig) return memo.tail;
    const start = Math.max(0, st.size - IDLE_NUDGE_TAIL_BYTES);
    const res = await this.deps.io.readFileFromMeasured(file, start);
    if (!res.ok) return { kind: 'none' };
    const tail = readCompactionTail(res.data);
    this.idleNudgeTails.set(id, { sig, tail });
    return tail;
  }

  /**
   * D13: the allocator SELF-SEEDS. Hourly, per registry-named project (the
   * same bound `sweepDivergences` states: the fleet's active projects, never
   * every checkout on the box): floor = max(D-<n>) + LEDGER_SEED_GAP, and
   * THE FLOOR ONLY EVER RISES — `raiseLedgerFloor`'s conflict arm is the
   * mechanism. `floorFromScan` owns the gap arithmetic and the evidence
   * string; this lane only applies them. The 50-number gap is not
   * decoration: numbers allocated but not yet written into any plan are
   * invisible to this scan, and re-issuing one IS the bb47c9e failure.
   *
   * SEEDED FROM THE SAME branch-dependent working tree as reconcile, and unlike
   * reconcile that is left alone DELIBERATELY. A floor that reads a plan on an
   * unmerged branch raises the fleet's floor permanently and burns every number
   * below it — measured 2026-09-02, this project's floor stood well above the
   * highest number the allocator had ever issued, raised off a file on no merged
   * ref. (No cardinal here: the floor rises on its own sweep, so any figure
   * written down is false by the next tick.) That is WASTE, not corruption: the
   * numbers are cheap and a conservative floor is exactly what prevents a
   * reissue, which is the failure this lane exists to make impossible.
   * Reconcile's looseness was different in kind — it wrote a false fact into a
   * TERMINAL column — which is why only that one was tightened.
   *
   * PUBLIC for the reason `sweepDivergences` is: `tick()` dispatches it with
   * `void`, so a test that awaits `tick()` has not awaited this.
   */
  async sweepLedgerFloor(records: SessionRecord[]): Promise<void> {
    const now = Date.now();
    if (this.lastLedgerFloor !== 0 && now - this.lastLedgerFloor < LEDGER_FLOOR_SWEEP_MS) return;
    this.lastLedgerFloor = now;
    const store = this.deps.coord;
    if (!store) return;
    for (const project of [...new Set(records.map((r) => r.project))]) {
      // SWEEP_POLICY, named at the call site rather than defaulted: take what
      // you got, over the whole corpus, unbounded. A dir that will not list or
      // a file that will not read contributes nothing and the walk CONTINUES,
      // so a project whose plans/ is unreachable still seeds from specs/.
      //
      // Safe on this lane for one reason, and it is a property of this caller
      // rather than of the read: nothing downstream of here mints a number, so
      // a floor measured low costs a delay and the next pass raises it.
      // `read.complete` is therefore ignored ON PURPOSE — and D-1018 records
      // that the 50-number gap does NOT bound the under-seed, so "it can only
      // ever under-seed inside the gap" is not the reason; "it mints nothing"
      // is.
      const read = await readLedgerDocs(
        { io: this.deps.io, projectsRoot: this.deps.cfg.projectsRoot },
        project, LEDGER_FLOOR_DIRS, SWEEP_POLICY);
      if (read.files.length === 0 && !read.complete) continue;
      const scan = floorFromScan(read.files);
      if (scan === null) continue;      // no global D-ref anywhere: nothing to seed, fail shut
      store.raiseLedgerFloor(project, scan.floor, scan.evidence, now);
    }
  }

  /**
   * F3: the program-ready preconditions, measured once per lane tick and
   * cached for `GET /api/projects`.
   *
   * On this lane rather than on the route because of what it costs: two skill
   * reads per rostered HOME plus the box token, and in remote fleet mode every
   * one of those is an agent round trip with its own 15 s ceiling and no batch
   * op to fold them into. A request-time measurement would put that on a route
   * that today performs no fleet I/O at all.
   *
   * PUBLIC for the reason `sweepLedgerFloor` is: `tick()` dispatches it with
   * `void`, so a test that awaits `tick()` has not awaited this.
   */
  async sweepReadiness(): Promise<void> {
    const now = Date.now();
    // The `!== 0` half is INERT and is kept only for symmetry with the two
    // ledger lanes that spell it the same way (D-1031, measured): with
    // `lastReadinessSweep` at 0 and a real epoch clock, `now - 0` already
    // dwarfs the interval, so the first call falls through on the arithmetic
    // alone. Deleting it kills no test in this suite or theirs. What enforces
    // "measure on the first tick" is the arithmetic, not this conjunct.
    if (this.lastReadinessSweep !== 0 && now - this.lastReadinessSweep < READINESS_SWEEP_MS) return;
    this.lastReadinessSweep = now;
    const cfg = this.deps.cfg;
    // `homeAble` only: an account with no HOME on this box cannot have a skill
    // installed in one, so asking would manufacture an `unmeasurable` that
    // says nothing about the fleet.
    const homes = cfg.roster.homeAble.map((a) => ({
      wrapper: a.id, configDir: configDirFor(cfg, a.id),
    }));
    this.readiness = await measureFleetReadiness({
      io: this.deps.io,
      // SERVER-LOCAL, never `this.deps.io` (fix round 1, MAJOR 1). In remote
      // fleet mode that io is the agent, and `cfg.mailTokenPath` names a file
      // on THIS box, not the fleet host. See `ReadinessDeps.localIo` for what
      // asking the wrong box costs: not a degraded answer but a permanent
      // `unmeasurable`, which kept the verdict from ever reading `ready`.
      localIo: localIO,
      homes,
      mailTokenPath: cfg.mailTokenPath,
      // A REAL read, not a null check: `deps.coord` being set proves a handle
      // was constructed, not that it answers. `ledgerFloor` on a name no
      // project can have is the cheapest statement that exercises the path —
      // `null` on a healthy store, a throw on a sick one — which is exactly
      // the distinction `degraded` carries. `emitRuns` and the socket cold
      // start both learn this same fact and drop it on the floor; this is
      // where it gets recorded.
      coordProbe: () => {
        const store = this.deps.coord;
        if (!store) return 'not-configured';
        try {
          store.ledgerFloor(READINESS_PROBE_PROJECT);
          return 'available';
        } catch {
          return 'degraded';
        }
      },
      now: () => now,
    });
  }

  /**
   * D13: allocated -> landed when a plan of the main checkout DEFINES the number.
   * `landed` means exactly that and no more: the number was seen defined in a plan
   * file in the working tree of `<projectsRoot>/<project>` at the moment of a
   * sweep, on whatever branch that checkout was sitting on, uncommitted edits
   * included. It is NOT proof of a merge — nothing between `readLedgerDocs`'s
   * readdir and this column consults git, and `landedIn` names a path in that tree
   * which may exist on no ref (measured 2026-09-02: it did). Reading a REF instead
   * would need git, which is unreachable BY POLICY rather than by construction:
   * `CCRC_FLEET=remote` sends every command across the agent's
   * `EXEC_COMMANDS = ['tmux','ccd']` whitelist, while the server process itself
   * holds an unwhitelisted `execFile` (`server/src/exec.ts:59-71`) that LOCAL mode
   * uses. A number 7 days old and never landed is REPORTED (once per changing set)
   * and NEVER reclaimed.
   */
  async sweepLedgerReconcile(): Promise<void> {
    const now = Date.now();
    if (this.lastLedgerReconcile !== 0 &&
        now - this.lastLedgerReconcile < LEDGER_RECONCILE_SWEEP_MS) return;
    this.lastLedgerReconcile = now;
    const store = this.deps.coord;
    if (!store) return;
    const open = store.openAllocations();
    const openByProject = new Map<string, typeof open>();
    for (const a of open) {
      const list = openByProject.get(a.project);
      if (list === undefined) openByProject.set(a.project, [a]); else list.push(a);
    }
    // BEHAVIOUR CHANGE, STATED (F7). The project list is now every project the
    // allocator has issued for, not only those with OPEN allocations. That is a
    // widening, and the reason is that the second question below cannot be asked
    // of the old corpus: a project whose numbers have all landed has no open rows
    // and would never be audited, which is exactly the state a project reaches
    // once it is working correctly. The plan read is still ONE per project per
    // sweep — both questions are answered from the same `files`, so this costs a
    // read only for projects that previously had none, and still nothing per row.
    for (const project of store.ledgerProjects()) {
      // Reconcile reads plans ALONE — a different question (did this number
      // land in a plan?), not a narrower copy of the floor's dir list. Same
      // SWEEP_POLICY: a file it cannot read simply is not evidence that a
      // number landed, and the next pass looks again.
      const read = await readLedgerDocs(
        { io: this.deps.io, projectsRoot: this.deps.cfg.projectsRoot },
        project, ['plans'], SWEEP_POLICY);
      if (read.files.length === 0 && !read.complete) continue;
      const files = read.files;
      // ONE NOTION OF "THIS PLAN CARRIES D-N" (D-1420), shared by both halves
      // of this sweep. Until now the landing half matched a bare `\bD-<n>\b`
      // over the whole file text while the orphan half below used
      // `definitionsIn` — two standards over the same corpus, eleven lines
      // apart, in the same loop. It fired: on 2026-09-02 a BLOCKQUOTE citing an
      // allocation range stamped two numbers `landed` (terminally — markLanded's
      // `state = 'allocated'` guard never re-evaluates a landed row) against a
      // plan that DEFINES neither. (That plan was on no merged ref when it
      // stamped; it merged 2026-09-03, which changes nothing — the stamp was
      // wrong because the file CITES the range, not because it was unmerged.)
      // `definitionsIn`
      // reads that same line as no definition at all, which is why SHARING the
      // predicate is the fix rather than adding a second regex. Computed once
      // and used twice, so the two halves cannot drift apart again.
      const defs = definitionsIn(files);
      for (const a of openByProject.get(project) ?? []) {
        const hit = defs.find((d) => d.n === a.n);
        if (hit !== undefined) store.markLanded(project, a.n, hit.file, now);
      }
      // The INVERSE of `markLanded`, and the half nothing has ever measured: a
      // plan that DEFINES an allocator-era number the allocator never issued.
      // Reported, never enforced — the ledger is prose and this sweep has no
      // standing to refuse anything (D13's own stance on `stale`, one block
      // down). See `unallocatedDefinitions` for what this deliberately does NOT
      // claim, and why batch scatter is not reported here.
      const orphans = unallocatedDefinitions(defs, store.ledgerIssued(project));
      const oJson = JSON.stringify([project, orphans.map((o) => o.n)]);
      if (orphans.length > 0 && oJson !== this.lastOrphanReport.get(project)) {
        this.lastOrphanReport.set(project, oJson);
        console.warn(
          `ccrc-server: ${orphans.length} deviation number(s) defined in ${project}'s plans were ` +
          'never allocated: ' + orphans.map((o) => `D-${o.n} (${o.files.join(', ')})`).join('; ') +
          ' — allocate through POST /api/ledger/deviations and define in the same act');
      }
    }
    const stale = store.staleAllocations(now - LEDGER_STALE_MS);
    const json = JSON.stringify(stale.map((s) => [s.project, s.n]));
    if (stale.length > 0 && json !== this.lastStaleReport) {
      this.lastStaleReport = json;
      console.warn(
        `ccrc-server: ${stale.length} allocated deviation number(s) never landed in a plan ` +
        'after 7 days: ' + stale.map((s) => `${s.project} D-${s.n}`).join(', ') +
        ' — reported, never reclaimed (D13)');
    }
  }

  /**
   * `null` ONLY when this box runs no coordination database — `/api/fleet/health`
   * renders that as an ABSENT block. A database with no sweep yet is no longer
   * folded into the same `null`: the mirror exists as soon as the store does
   * (`mirrorFor` above), and its own `health()` answers truthfully with
   * `state: 'unknown'`, `lastOk: null` (`mirrorplan.ts`'s `lifecycleState`,
   * `lastOkAt === null` arm) — real evidence of "no evidence yet", not a
   * second meaning stuffed into this method's own `null`.
   */
  lifecycleHealth(): LifecycleHealth | null {
    const store = this.deps.coord;
    if (!store) return null;
    return this.mirrorFor(store).health();
  }

  /**
   * Deliver queued mail, one message per eligible session per sweep.
   *
   * SIX CONJUNCTS, in this order, cheapest first — and the order is the design,
   * because every rung below the first is a read that crosses the agent WS in
   * remote mode:
   *
   *   0. the lane is primed (a restart delivers no storm — spec:256-258);
   *   1. `$REG/mail-disabled` is absent, by DIRECTORY LISTING, fail-shut;
   *   2. this session is off its per-session cooldown;
   *   3. tmux has the session;
   *   4. no FRESH hookstate carries an unanswered `ask` (robust-mail-delivery
   *      spec §2.1 / F6b fix). This is a PENDING-QUESTION guard only — a
   *      null/stale `hs` (`readHookState`'s freshness/uuid gates,
   *      `hookstate.ts:149-154`) is NON-BLOCKING here: idle authority moved
   *      wholly to conjunct 5 below, so a resumed long-idle worker, or one
   *      whose `/clear` emitted no registered hook, is still deliverable;
   *   5. `mailTurnIdle` (`turnidle.ts`) reads the RAW live word as a finished
   *      turn — `idle`, or `shell` (an idle main loop over a background shell)
   *      unless `$REG/mail-gate-strict` is listed — and `statusUpdatedAt` is at
   *      least `MAIL_QUIET_MS` old (`COORD_QUIET_MS` for a coordinator): the
   *      SOLE turn-idle authority. A `shell` delivery also asks `sendPrompt`
   *      to refuse a pane showing `esc to interrupt` (`turn-running`), a
   *      tripwire only. It never asks `liveStatus`,
   *      because `liveStatus` answers `'idle'` for a missing pid, a missing
   *      config dir and an unreadable file (`fleet.ts:118-131`) —
   *      the deleted `archiveSafety`'s rule ("MUST NOT collapse `unknown` to
   *      idle") applies here for the same reason: this ends in a keystroke.
   *      That function is gone with the auto-archive it guarded (`sweepMerged`),
   *      and this lane is now the only place the rule still has work to do.
   *
   * ONLY THEN `sendPrompt`, with its whole proof discipline — echo verified,
   * `draft-present` refused, `dialog-open` refused — inside the session's own
   * `KeyedQueue` slot, injecting `renderMailNudge(d.toId)` — a tiny, single-
   * line, ID-AGNOSTIC reference (robust-mail-delivery spec §1), NEVER
   * `d.envelope` — with `resumeIfOwn: true` (F3 / bug #21, fix-round): a box
   * already holding this session's own un-submitted nudge (a prior sweep's
   * lost Enter) is recognized and its Enter finished, rather than misread as
   * `draft-present` and backed off forever — the exact self-block the build4
   * dogfood measured live (`docs/superpowers/programs/build4.md`). See
   * `sendPrompt`'s own docstring for the discrimination. NOTHING HERE TEACHES
   * IT TO RETYPE OR PRESS BLINDLY: the two-Enter budget and `submitEnter`'s
   * one-Enter doctrine (`inject/send.ts:456-460`) are load-bearing, and the
   * escalation for a stuck box is the human.
   *
   * `replaceDraft` IS NEVER PASSED. A half-typed human message outranks every
   * agent-to-agent finding in this system; `draft-present` is a back-off, and
   * the mail is still there in two minutes. `clearMailResidue` IS passed, but
   * only once this delivery has provably been attempted before (spec §2.2) —
   * see the send site's own comment — and it can never clear a human draft
   * either (`isMailResidue`'s own docstring, `inject/send.ts`).
   * `ownStrandedClear` IS passed too (Task 407), and it is the one clear this
   * lane makes on PROOF rather than on shape: `CoordStore.strandedClear` is a
   * durable `clear-refused:enter-ignored` run event saying this system typed
   * a `/clear` into that very box and never had it taken. No such row, no
   * permission — the text `/clear` alone never opens anything, because a
   * human types it too. The proof is SPENT by the first delivery that lands
   * (review, W4c finding 1 — see `strandedClear`'s own docstring): a landed
   * delivery is this store's evidence that the box was emptied, so the row
   * licenses the ONE delivery that inherits the wedge, not every later one.
   *
   * WHAT THIS CANNOT SEE, stated because it bounds the guarantee: Claude Code
   * silently QUEUES a prompt sent mid-turn and renders the hint in a dim span
   * that `draftOf` strips (`inject/send.ts:65`, pinned against a live capture
   * at `send.test.ts:642`). So "the box reads empty" is not "nothing is
   * pending", and the gate above is what keeps the lane away from a busy
   * session in the first place — not the send path, which would happily
   * succeed.
   *
   * CROSS-SWEEP SINGLE-FLIGHT (review findings 1/5, hardened by 33/38), on
   * TOP of the six conjuncts and the per-sweep `seen` set: `mailInFlight` is
   * CLAIMED immediately after the `.has` check, with NO `await` between
   * them, so the check-then-claim is atomic with respect to the event loop —
   * no other sweep's turn can run between "is this row claimed" and "claim
   * it". The surrounding try/finally begins at that claim, not at
   * `sendPrompt`, and covers every gate below it (registry lookup, tmux
   * session, hookstate, pane pid, live status, quiet time) as well as the
   * send itself, so a row that fails ANY gate still releases its claim, via
   * `finally`, before the loop moves on — a `continue` inside a `try` runs
   * the `finally` first. A row therefore holds `mailInFlight` for its
   * WHOLE walk through the gates, not just the sub-window where it is
   * already blocked inside `sendPrompt`: a second sweep that starts while
   * the first is still working through those `await`s for the same row
   * — gate-checking OR sending — sees the claim already there and refuses
   * the row, instead of re-passing gates that have not changed and
   * enqueueing a second send for it. (An earlier version of this claim ran
   * AFTER the four gate `await`s instead of before them, leaving exactly
   * that gate-walking window unguarded — two concurrent sweeps could both
   * pass the `.has` check, both clear the gates, and both send the same
   * envelope. Fixed by moving the claim to immediately follow the check.)
   *
   * THE `UserPromptSubmit` EDGE IS SAMPLED SEPARATELY (review finding 3),
   * over `store.deliveredUnacked()` — every `delivered`, unacked row, with NO
   * due-timing filter — rather than folded into the loop below over
   * `store.dueDeliveries()`. `dueDeliveries`'s replay arm does not select a
   * `delivered` row until `MAIL_REPLAY_MS` has already elapsed, so sampling
   * the edge only from ITS result could never observe a turn that started
   * (and, ordinarily, ended) any time before that — which is every ordinary
   * turn. See `CoordStore.deliveredUnacked`'s own docstring.
   *
   * `tick()` dispatches this with `void` (it can sit on the queue for as long
   * as `sendPrompt` does), so a test that awaits `tick()` has NOT awaited the
   * sweep — every negative assertion about it would pass while it was still
   * running. PUBLIC for the same reason `sweepNames` is.
   */
  async sweepMail(): Promise<void> {
    if (!this.primed) return;
    const store = this.deps.coord;
    if (!store) return;
    const now = Date.now();
    if (this.lastMailSweep !== 0 && now - this.lastMailSweep < MAIL_SWEEP_MS) return;
    this.lastMailSweep = now;

    // Fail-shut: a registry we cannot list is a kill-switch we cannot read.
    const listing = await this.deps.io.readdir(this.deps.cfg.registryDir);
    if (listing === null || listing.includes(MAIL_DISABLED_MARKER)) return;
    // The gate's mode comes from this SAME listing (worker stall watch §4.1,
    // `turnidle.ts`), through the one settings resolution the stall sweep also
    // calls (stall watch settings §9): a chosen level can set it, and strict
    // still wins. An unlistable registry has already returned above, so a
    // mode is never read from a listing that failed: the strict marker fails
    // shut at no extra cost. `false` is measured, not assumed: the return
    // above proved `MAIL_DISABLED_MARKER` absent from this listing.
    const mode = this.stallResolveNow(store, listing, false).arming.mailMode;
    // The busy clock (D-4024), on the mode just applied: a move into busy from
    // a known non-busy mode starts it, busy over busy keeps it, and any other
    // mode clears it. The first busy after a start leaves it null.
    if (mode !== 'busy') this.busySince = null;
    else if (this.lastApplied !== null && this.lastApplied !== 'busy') this.busySince = now;
    this.lastApplied = mode;

    const unacked = store.deliveredUnacked();
    const dueBefore = store.dueDeliveries(now, MAIL_REPLAY_MS);
    // The busy-shadow log's memory keeps only deliveries still outstanding.
    // It is pruned BEFORE the empty-queue return, so an idle box empties it.
    // Due or delivered this sweep is outstanding; a row in neither is looked up,
    // because a queued row another lane backed off past this sweep is still
    // outstanding and must not be said a second time when it returns.
    const outstandingIds = new Set([...unacked, ...dueBefore].map((r) => r.id));
    for (const loggedId of this.busyShadowLogged) {
      if (outstandingIds.has(loggedId)) continue;
      const row = store.delivery(loggedId);
      if (row === null || (TERMINAL_DELIVERY_STATES as readonly string[]).includes(row.state)) this.busyShadowLogged.delete(loggedId);
    }
    if (unacked.length === 0 && dueBefore.length === 0) return;
    // Fix — blocking review findings 1/5: `readRegistry`'s OLD signature
    // collapses a whole-fleet `io.readdir` failure to `[]` — the SAME shape
    // "this recipient is not in the registry" wears below (`rec ===
    // undefined`) — so a single dropped agent-WS round trip on THIS read
    // alone (the kill-switch listing three lines up already succeeded, and
    // is a SEPARATE `readdir` call) used to make EVERY due row read as
    // `unmeasurable = false` (line ~1292's `rec !== undefined`), ratchet
    // `attempts` toward `MAIL_MAX_ATTEMPTS`, and terminally
    // `rejectDelivery(..., 'undeliverable', 'recipient not in registry')` a
    // recipient that is plainly alive and fully listed — the exact
    // "unlistable read as proven absence" bug this ladder's own comment
    // three lines below denies happening. `readRegistryMeasured` draws that
    // line explicitly: `!listed` fails shut, the SAME way the kill-switch's
    // own unreadable listing already does three lines up, rather than
    // silently emptying `records` and letting every row downstream mistake
    // "we could not read the fleet this pass" for "this recipient is gone".
    const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
    if (!registryRead.listed) return;
    const records = registryRead.records;
    const uuidByToId = new Map(records.map((r) => [r.id, r.uuid] as const));
    // For `pushOne`'s project decoration (Task 409's sender-side notice), from
    // the registry read this method already has. A sender the registry does
    // not list decorates to '' — and `pushOne` degrades an empty project to no
    // decoration at all, never to a dangling separator.
    const projects = new Set(records.map((r) => r.project));
    const sessionProjects = new Map(records.map((r) => [r.id, r.project] as const));
    // One hookstate read per SESSION this sweep, shared between the edge
    // sample below and the gate's own read further down — both use this same
    // `now`, so a cached answer is exactly as fresh as a second read would
    // be. A `Map`, not a plain object, so a session with no readable
    // hookstate (a real miss) is distinguishable from "not looked up yet"
    // via `.has` rather than an `undefined` that could mean either.
    const hsCache = new Map<string, HookState | null>();
    const hookStateFor = async (toId: string): Promise<HookState | null> => {
      if (hsCache.has(toId)) return hsCache.get(toId) ?? null;
      const uuid = uuidByToId.get(toId);
      const hs = uuid === undefined ? null
        : await readHookState(this.deps.io, this.deps.cfg.registryDir, toId, uuid, now);
      hsCache.set(toId, hs);
      return hs;
    };

    // The UserPromptSubmit edge, over EVERY delivered-unacked row — see this
    // method's own docstring and review finding 3. A recipient that has gone
    // (`uuidByToId` has no entry) reads as no edge, same as `due`'s own loop
    // treats a vanished recipient: the row waits.
    //
    // `row.ingestedAt !== null` SKIPS the row entirely (fix — review finding
    // 31): before this, the edge was sampled UNCONDITIONALLY, so every LATER
    // prompt the session submitted — the operator talking to it, the next
    // brief, its own tool loop's own `UserPromptSubmit` — re-dated
    // `ingestedAt` again, and `dueDeliveries`'s `MAX(ingestedAt, deliveredAt)`
    // replay gate never matured for as long as the session kept submitting
    // prompts at least once per `MAIL_REPLAY_MS`, which is what a WORKING
    // session does by definition. `hookstate.ts`'s own docstring calls this
    // edge proof that "the injected turn actually STARTED" — proof of ONE
    // specific turn, not a clock a whole session's later, unrelated activity
    // should keep pushing out. Capturing it once and freezing it means a
    // fresh, later edge from an actual REPLAY still re-dates the clock — via
    // that replay's own `markDelivered`, not this loop — exactly as
    // `dueDeliveries`'s `MAX(...)` already expects (see its own docstring).
    for (const row of unacked) {
      if (row.deliveredAt === null) continue;   // defensive; markDelivered always sets it
      if (row.ingestedAt !== null) continue;
      const hs = await hookStateFor(row.toId);
      if (hs !== null && hs.event === 'UserPromptSubmit' && hs.updatedAt > row.deliveredAt) {
        store.markIngested(row.id, hs.updatedAt);
      }
    }

    // Re-read due-ness AFTER the edge sample above, not before: `markIngested`
    // can only ever push a row's replay clock LATER, so a `dueBefore` row
    // whose edge just landed could have gone from due to not-due in the same
    // sweep. Skipped when nothing was sampled (`unacked.length === 0`) —
    // nothing could have changed, so `dueBefore` is still exact and a second
    // identical query would only cost, never correct, anything.
    const due = unacked.length === 0 ? dueBefore : store.dueDeliveries(now, MAIL_REPLAY_MS);
    if (due.length === 0) return;
    // WHO IS COORDINATING SOMETHING LIVE — one read for the whole sweep, for
    // every row in it. The same bargain `hsCache` strikes one field over
    // (`:2246`), legitimate for the same reason: a second read would carry this
    // same `now`, so a cached answer is exactly as fresh as a fresh one.
    //
    // Placed AFTER the `due.length === 0` return, so an idle box pays nothing:
    // no mail, no query. And shaped into a `Set` HERE rather than in the store,
    // matching how `uuidByToId` and `sessionProjects` are built from `records`
    // — the store returns rows, the sweep shapes them into what it will ask.
    const coordinators = new Set(store.openCoordinatorIds());
    // D-792's ONE WRITER. Every ordinary gate below calls this and then
    // `continue`s; nothing reads it back. It records WHAT refused the row and
    // for how long, and changes nothing about whether, when or how often the
    // row is tried again — `nextAttemptAt` and `attempts` are both untouched
    // here, so a busy session's mail keeps its place in the queue exactly as
    // before. The two gates that ALSO back off call this IN ADDITION: "when
    // may this be retried" and "what refused it" are different questions.
    const gated = (d: { id: number; lastGate: string | null; gateSince: number | null },
                   gate: MailGate): void => {
      store.noteGate(d.id, gate, now, d.lastGate === gate, d.gateSince);
    };
    const seen = new Set<string>();          // one message per session per sweep
    for (const d of due) {
      if (seen.has(d.toId)) { gated(d, 'same-sweep'); continue; }
      if (this.mailInFlight.has(d.toId)) { gated(d, 'in-flight'); continue; }   // CHECK — review findings 1/5, see this method's docstring
      // CLAIM — immediately after the check, with NO await in between, so the
      // check-then-act is atomic with respect to the event loop: nothing can
      // run between "is it claimed" and "claim it" that would let a second
      // concurrent sweep observe the pre-claim state (fix — review finding
      // 33/38: see this method's docstring). The try/finally now begins HERE,
      // not at the send, so every gate below that `continue`s — cooldown,
      // missing registry row, no tmux session, hookstate not `done`, not
      // idle, not quiet — releases the claim on its way out, exactly once,
      // and never leaves a session claimed across sweeps.
      this.mailInFlight.add(d.toId);
      try {
        // THE ONE FACT THIS RUNG ADDS, read once per row from the per-sweep set
        // above and consumed by exactly two gates: this one and `not-quiet`
        // below. Neither condition changes — only the threshold each is measured
        // against.
        const isCoordinator = coordinators.has(d.toId);
        const last = this.mailCooldown.get(d.toId) ?? 0;
        if (now - last < (isCoordinator ? COORD_COOLDOWN_MS : MAIL_COOLDOWN_MS)) { gated(d, 'cooldown'); continue; }
        const rec = records.find((r) => r.id === d.toId);
        // registry ladder: `records` came from `readRegistryMeasured` above,
        // with `!listed` already refused (fix — blocking review findings
        // 1/5) — so by the time this line runs, a whole-fleet read failure
        // has already returned out of this method entirely, and can no
        // longer masquerade as "every row is absent" here. `readRegistry`'s
        // per-row ladder DEGRADES rather than drops a row whose `.uuid` is
        // listed but a sibling identity field is not (registry.ts's own
        // ladder) — so `rec` being found-but-degraded and `rec` being
        // altogether ABSENT are two different facts, evidence read straight
        // off the row itself (`measuredIdentity(rec)`) rather than the
        // hand-rolled `listing.includes` probe this block used to run.
        // `rec === undefined` therefore NARROWS to PROVEN absence: one of
        // THREE routes now, not two. Never listed. Twice-observed gone within
        // `readRegistryMeasured`'s own second-listing retirement. Or (Task 5)
        // `buildRecord`'s identity-triple loop dropping the row on a SINGLE
        // measured-`absent` identity field, no second listing at all — see
        // its own comment in registry.ts. That third route is STRONGER
        // evidence than the second, not weaker, in the ORDINARY case: a
        // listed-then-ENOENT `.uuid`/`.wrapper`/`.workdir` comes from ccd's
        // `_reg_purge`, i.e. a full reap. It is not the ONLY producer, and
        // the earlier "can only come from" here was wrong (wave-1 review
        // minor m3): losing the registry DIRECTORY itself mid-pass produces
        // the same observation — this method's own listing succeeded at the
        // top, the per-field reads afterwards ENOENT, and every row not yet
        // read takes this route in the same pass (a loss landing mid-loop
        // spares the rows `buildRecord` already read; only a loss between
        // `readRegistryMeasured`'s top-level `readdir` and the start of that
        // loop catches the whole fleet). That case is fleet-wide and lasts ONE PASS
        // (the next sweep's listing fails and the method returns before this
        // loop), where a reap is per-row and permanent; the cost of the
        // difference is that a directory lost for one pass mass-parks
        // deliveries that used to sit degraded. But it widens the residual the
        // second route already carried: the pre-branch ladder kept a
        // degraded row degraded — never parks — whenever the CONFIRMING
        // second listing itself failed, and this route drops the row on the
        // first read alone, so the same failed-second-listing window that
        // used to protect against a park no longer does. Never "we just
        // couldn't list the registry this pass" (that case is refused above,
        // before this loop is ever reached) and never "we just couldn't read
        // one field this pass" (that is the degraded branch, not this one).
        const identity = rec !== undefined ? measuredIdentity(rec) : null;
        // `rec === undefined` is spelled OUT here rather than left implied by
        // `identity === null`, and the two are equivalent by construction (the
        // line above returns null for exactly that case) — so this changes no
        // behaviour and `unmeasurable` below still reads the same fact. What it
        // buys is the narrowing: every rung after this block now has `rec` as a
        // SessionRecord rather than `SessionRecord | undefined`, so the
        // lifecycle read at the tmux rung needs no non-null assertion — an
        // assertion being a claim nothing checks, which is the shape this tree
        // asks a guard not to be.
        if (rec === undefined || identity === null) {
          const unmeasurable = rec !== undefined;
          // Fix — review finding 30: a row whose recipient's registry row is
          // genuinely ABSENT (reaped, purged) used to `continue` here with
          // `attempts` untouched forever — `MAIL_MAX_ATTEMPTS` can only ever be
          // reached through a FAILED `sendPrompt`, which never runs on this
          // path, so the row was re-selected on every `MAIL_SWEEP_MS` tick
          // indefinitely, and a purged workspace slug being re-minted
          // (`_ws_slug_new` draws only from FREE slugs) could eventually hand
          // this exact id to an unrelated program. Backed off on the SAME
          // schedule a send failure gets, and eventually parked — the spec's
          // own `rejected('undeliverable')` terminal state, otherwise
          // structurally unreachable for exactly the recipients this build can
          // prove are gone. Scoped to ONLY this gate: every gate below (no
          // tmux session, hookstate not `done`, not idle, on cooldown) is
          // ORDINARY and expected to hold indefinitely for a session that is
          // merely busy, and must never accrue toward a park.
          //
          // A DEGRADED row (`unmeasurable`) must NEVER park, ever — the
          // recipient plainly still exists, only this one read could not
          // measure it — the same line `POST /api/mail`'s own ingress draws,
          // refusing `registry-unmeasurable` rather than guessing whenever a
          // row's `.uuid` is listed but a sibling is not (D-37,
          // `coord/routes.ts`'s `names.includes` checks, pinned at
          // `mail-routes.test.ts:259`). Without this, one dropped agent-WS
          // round trip on a SINGLE field of a LIVE session's registry row was
          // indistinguishable from that session being reaped, and six
          // backoffs (~15 minutes) permanently parked its mail
          // `rejected('undeliverable')`. "Unmeasurable" therefore keeps
          // backing off forever — the same as every ordinary gate below —
          // while only a recipient PROVEN absent can ever park.
          //
          // `store.backOff`'s `countsAsAttempt: false` on the unmeasurable arm
          // (checked every reader of the `attempts` column first: the ONLY
          // other reader is this same file's own `d.attempts + 1` two lines
          // below and `dueDeliveries`' pass-through select — no ratchet here
          // means this row's own local `attempts` snapshot never advances
          // past 1, so its backoff step stays fixed at `MAIL_BACKOFF_BASE_MS`
          // rather than climbing toward `MAIL_MAX_ATTEMPTS` — the ceiling this
          // branch must never reach) — attempts is SEND-FAILURE budget
          // (`MAIL_MAX_ATTEMPTS`'s own docstring), and this row was never
          // attempted at all, only found unmeasurable before any gate below
          // could even run.
          //
          // No `MailRejectCode` applies here (scoped-verify H6: a `backOff` is
          // not a reject, so `registry-unmeasurable` — a `refuse(...)` code the
          // ingress route returns on the wire — has nowhere typed to land on
          // this row), but the two are the SAME underlying condition, and
          // `mail_deliveries.lastError` is free text a maintainer greps, not a
          // typed column — so the word itself rides along in the message
          // below, not just in this comment, for whoever greps the ROW rather
          // than the source.
          gated(d, unmeasurable ? 'registry-unmeasurable' : 'registry-absent');
          const attempts = d.attempts + 1;
          // D-1069 — THE PARK STAYS, and a DELIVERED row now says why it parked.
          //
          // An earlier draft of this change (D-1067, withdrawn before merge)
          // added `&& d.deliveredAt === null` here, mirroring the SEND-failure
          // park ~250 lines below. That was wrong, and `store.ts`'s own
          // OUTSTANDING_OR_ABANDONED_SQL comment says why: a `rejected` row
          // stays visible to a HUMAN ("is this worth a human's attention")
          // while staying terminal for the LANE ("should the delivery lane act
          // on this again"). This park is the ONLY thing that ends the lane for
          // a delivered row whose recipient's registry row was PURGED.
          // `cancelOutstandingDeliveries` is runId-scoped, so peer mail
          // (`runId IS NULL`) is out of its reach, and `MAIL_REPLAY_MAX_ATTEMPTS`
          // counts SUCCESSFUL replays, which a row gated HERE never gets.
          // Without the park the row stays due at the 15-minute ceiling for
          // ever — and `_ws_slug_new` recycles a purged slug (`ccd/ccd:3653`,
          // and ccd's own comment: "144 per project, recycled by ws-reap"), so
          // that id can be re-minted for an unrelated workspace and the lane
          // will then type this stale envelope into it. `mail_deliveries`
          // carries no recipient uuid, so nothing downstream can tell the two
          // recipients apart. The hazard is bounded today only because this
          // park ends the row ~26 minutes after the purge.
          //
          // What WAS wrong is the sentence. `'recipient not in registry'` beside
          // `rejectCode: 'undeliverable'` reads as "this never arrived", and for
          // a delivered row that is false. `lastError` is free text a maintainer
          // greps, so the row itself now says what actually happened. The ack
          // door stays shut either way (`markAcked` admits only the replay-
          // ceiling park) and that is correct here: a PURGE is permanent —
          // `ws-restore` restores an ARCHIVED workspace, which keeps its
          // registry row and so lands on the session-dead rung, not this one —
          // so the only party that could ever walk through that door is a
          // re-minted stranger wearing the same id.
          if (attempts >= MAIL_MAX_ATTEMPTS && !unmeasurable) {
            store.rejectDelivery(d.id, 'undeliverable',
              d.deliveredAt === null
                ? 'recipient not in registry'
                : 'recipient purged after this message was delivered, and never acked');
          } else {
            const step = Math.min(MAIL_BACKOFF_BASE_MS * 2 ** (attempts - 1), MAIL_BACKOFF_MAX_MS);
            store.backOff(d.id,
              unmeasurable ? 'registry row listed but unreadable (registry-unmeasurable)' : 'recipient not in registry',
              now + step, !unmeasurable);
          }
          continue;
        }
        // D-309 (was D-B8-13): `gone` — tmux itself said the recipient's pane does not
        // exist — stays the ordinary silent gate, exactly like busy or
        // on-cooldown: the mail waits for the session to come back, nothing
        // recorded, retried next sweep. `unknown` — tmux DID NOT ANSWER — must
        // not wear the same bare `continue`, four lines below a registry read
        // that carefully distinguishes the matching pair on its own seam. It
        // backs off on the unmeasurable arm's exact never-ratcheting terms
        // (`countsAsAttempt: false`, so `attempts` stays send-failure budget
        // and the step stays pinned at MAIL_BACKOFF_BASE_MS — a substrate
        // outage must never walk a row toward the undeliverable park), and the
        // tmux message rides in `lastError` verbatim because the message IS
        // the diagnosis (substrate-unreachable spec §2). The backoff is also
        // the herd valve: without it every due row re-spawns a doomed tmux
        // client each sweep against a component that is already unwell.
        const sv = await this.deps.tmux.sessionVerdict(d.toId);
        if (sv.verdict === 'gone') {
          // D-1066 — D-309 REFINED, not reversed (operator ruling 2026-08-30). Its
          // premise — "the mail waits for the session to come back" — is right
          // for a swap, a restart or a reboot, and false for a session somebody
          // archived. Measured on the live fleet before this line was written:
          // a delivery to an archived workspace sat `queued` 22.5 hours and was
          // refused 6,769 times, once per sweep, with no terminal state and
          // nothing telling the sender. D-792's gate columns are what made it
          // visible; this is the half that acts on it.
          //
          // The question is NOT "is the pane gone" — `sv.verdict` already
          // answered that — but "is it coming back", and `sessionLifecycle`
          // draws exactly that line from facts this loop already holds. With
          // `alive: false` (which `gone` IS), a stop stamp reads `stopped`, a
          // fresh supervisor heartbeat reads `restarting`, and an unreadable
          // lifecycle field reads `unmeasurable`. Only the three words
          // `lifecycleIsDead` names never resolve on their own.
          //
          // A dead recipient then takes the REGISTRY-ABSENT rung's terms
          // exactly — back off, count toward the ceiling, park at it — because
          // it is the same kind of fact: a recipient this build can PROVE is
          // gone. Everything else keeps D-309's bare silent wait, including
          // `unmeasurable`: doubt is not evidence, in either direction.
          const lc = sessionLifecycle(lifecycleInputFor(rec, false, now));
          if (!lifecycleIsDead(lc)) { gated(d, 'tmux-gone'); continue; }
          gated(d, 'session-dead');
          // `deliveredAt === null` GATES THE PARK, and this guard is not
          // belt-and-braces — `MAIL_MAX_ATTEMPTS`'s own docstring states the
          // contract it keeps: the budget "applies ONLY while a delivery's own
          // `deliveredAt` is still null … The instant `deliveredAt` is set,
          // this budget stops applying: the row's own history already disproves
          // 'undeliverable'". The send-failure park 160 lines below takes the
          // same guard for the same reason, in the same words.
          //
          // Two things go wrong without it, both measured in review:
          //   (a) a message that DEMONSTRABLY reached the recipient is recorded
          //       `undeliverable`, and `markAcked` refuses every rejected row
          //       but the replay-ceiling one — so a session brought back by
          //       `ccd start` or `ws-restore` (both `rm -f $REG/<id>.stopped`)
          //       could never ack it;
          //   (b) `attempts` is ONE CUMULATIVE COLUMN and a delivered row's is
          //       deliberately uncapped, so a row already at 5 from earlier
          //       replay backoffs would park on the FIRST session-dead
          //       observation, with no backoff at all — terminally discarding a
          //       message on one sweep that happened to land inside a transient
          //       post-reboot `orphan` window.
          //
          // A DELIVERED row still records the gate above (the console must say
          // what is holding it) and still backs off — on the ORDINARY ratcheting
          // terms, identical to the registry-absent rung's own `else` arm.
          //
          // D-1068 CORRECTS D-1066 here. This arm first shipped with
          // `countsAsAttempt: false`, reasoning that a delivered row must not
          // ratchet toward a park it does not own. That was right about the park
          // and wrong about the clock: `attempts` is also what `step` is
          // computed FROM, so freezing it pinned every step at
          // MAIL_BACKOFF_BASE_MS and `Math.min` never bound. Measured on the
          // shipped build: 40 re-examinations in 30 minutes, for ever, against a
          // recipient the registry proves is never coming back — no ceiling of
          // any kind, because `MAIL_REPLAY_MAX_ATTEMPTS` counts SUCCESSFUL
          // replays and a row gated HERE never gets one. That is the same
          // every-tick-for-ever shape D-1066 was written to end, wearing a gate
          // label. `MAIL_MAX_ATTEMPTS`'s own docstring had already said what to
          // do instead — "`attempts` keeps counting on a delivered row too …
          // just without a ceiling that turns a failing SEND into a park" — and
          // that an uncapped counter is exactly what makes MAIL_BACKOFF_MAX_MS
          // reachable rather than decorative.
          const attempts = d.attempts + 1;
          const step = Math.min(MAIL_BACKOFF_BASE_MS * 2 ** (attempts - 1), MAIL_BACKOFF_MAX_MS);
          if (d.deliveredAt === null && attempts >= MAIL_MAX_ATTEMPTS) {
            store.rejectDelivery(d.id, 'undeliverable', `recipient session is ${lc}`);
          } else {
            store.backOff(d.id, `recipient session is ${lc}`, now + step, true);
          }
          continue;
        }
        if (sv.verdict === 'unknown') {
          gated(d, 'tmux-unknown');
          const step = Math.min(MAIL_BACKOFF_BASE_MS * 2 ** d.attempts, MAIL_BACKOFF_MAX_MS);
          store.backOff(d.id, `tmux did not answer (substrate-unknown): ${sv.detail}`, now + step, false);
          continue;
        }
        const hs = await hookStateFor(d.toId);
        // Pending-question guard ONLY (robust-mail-delivery spec §2.1 / F6b
        // fix). A null/stale `hs` must NOT block delivery: a resumed
        // long-idle worker, or one whose `/clear` emitted no registered hook,
        // has no fresh hookstate but is plainly deliverable — the live
        // status file, read unconditionally four lines below, is the sole
        // idle authority now (it already ran on this path before this fix;
        // this is not a new read). Block only when a FRESH hs affirmatively
        // carries an unanswered question — `hs.state` is no longer read here
        // at all.
        if (hs !== null && hs.ask !== null) { gated(d, 'pending-ask'); continue; }
        const pid = await this.deps.tmux.panePid(d.toId);
        // SPLIT, not one `continue` for both (D-792). "tmux reports no pane pid
        // for this session" and "this session's wrapper resolves to no config
        // dir" are conditions an operator acts on completely differently — the
        // first is a session that is gone or starting, the second is a ROSTER
        // problem that will hold this delivery for ever and that no amount of
        // waiting fixes. Folding them into one silent exit is the
        // overloaded-collapse this tree bans by name.
        if (!pid) { gated(d, 'no-pane'); continue; }
        const cfgDir = configDirFor(this.deps.cfg, identity.wrapper);
        if (!cfgDir) { gated(d, 'no-config-dir'); continue; }
        const live = await readLiveState(this.deps.io, cfgDir, pid);
        // ONE decision for both gates (worker stall watch §4.1, §5.1, `turnidle.ts`).
        // `idle` delivers as before. So does `shell`, an idle main loop over
        // background shell work, unless `$REG/mail-gate-strict` is listed. A
        // null read is `not-idle`, as `!live` was.
        //
        // The turn marker (§5.1) is read here, once per due row that passed
        // every gate above, and ONLY under the hand-armed `busy-shadow` and
        // `busy` (shell-mode-ignores-the-marker (D-3674)). Which modes those are is
        // `mailTurnReadsMark`'s decision (L1), the same rule `mailTurnIdle`
        // uses to consult `mark`; this line asks it. Wave 2 ships dark: under the
        // default `shell`, and under `strict`, no agent read is added and
        // `mailTurnIdle` answers as wave 1 did, whatever the marker says. It is
        // never read without a live file either: that row is `not-idle`
        // already, and the reader needs the live `startedAt` to call a marker
        // stale. `identity` is non-null here, because the registry rung above
        // `continue`s on null. An `absent`, `foreign` or `stale` read takes
        // wave 1's path inside `mailTurnIdle`.
        const mark = mailTurnReadsMark(mode) && live !== null
          ? await readTurnMarkMeasured(this.deps.io, this.deps.cfg.registryDir, d.toId, identity.uuid, live)
          : null;
        const turn = mailTurnIdle(live, mark, now, isCoordinator ? COORD_QUIET_MS : MAIL_QUIET_MS, mode);
        // THE QUIET THRESHOLD DOES NOT FORK `not-quiet`, deliberately (D-1167). `MailGate`'s own
        // docstring sets the rule — one member per CONDITION, not per `continue`
        // — and `no-pane`/`no-config-dir` were split because an operator acts on
        // them differently. A coordinator's longer quiet time is the same condition ("this session
        // has not been quiet long enough") and the same act (wait). The union is
        // also explicitly NOT a scheduling input: it exists so a human can tell
        // waiting from wedged, and both thresholds are waiting. A
        // `coord-not-quiet` member would cost a union entry, a total-map entry in
        // `shared/api.ts` and a phrase in `MailStrip.tsx` to record a distinction
        // nobody acts on. Three tokens follow: `turn-mark-unreadable`, then `not-idle` or `not-quiet`.
        //
        // Every token is spelled as a LITERAL at its call on purpose (`not-idle` and `not-quiet` in
        // one ternary). The D-792 structure scan (`mail-sweep.test.ts`) counts a gate only where its
        // name is written at the call, so `gated(d, turn.gate)` would leave them with
        // no call site it can see.
        if (!turn.deliver) {
          // A THIRD token, and a different condition: the turn marker could not
          // be read under `mail-gate-busy`. That is a fleet fault, not a busy
          // session, so it gets its OWN literal call site. A nested ternary is
          // invisible to the D-792 scan (`mail-sweep.test.ts`).
          if (turn.gate === 'turn-mark-unreadable') { gated(d, 'turn-mark-unreadable'); continue; }
          // `mail-gate-busy-shadow`: the row WOULD deliver on `busy`. It is held,
          // and it is said once per delivery, for the operator's 48 h check.
          if ('wouldDeliver' in turn && !this.busyShadowLogged.has(d.id)) {
            this.busyShadowLogged.add(d.id);
            console.warn(`ccrc-server: mail-gate busy-shadow would deliver delivery ${d.id} to ${d.toId} (quiet since ${new Date(turn.since).toISOString()})`);
          }
          const notIdle = turn.gate === 'not-idle'; gated(d, notIdle ? 'not-idle' : 'not-quiet'); continue;
        }

        // `seen` is added only HERE, once every gate above has passed and the
        // send is actually about to be attempted — it means "one message per
        // session per sweep", not "one row considered per sweep", and moving
        // the claim earlier must not change that.
        seen.add(d.toId);
        // The REFERENCE NUDGE (robust-mail-delivery spec §1), not `d.envelope`
        // — the lane no longer types the whole stored envelope into the pane.
        // `renderMailNudge` is a pure, ID-AGNOSTIC function of `d.toId` alone
        // (never called with the delivery id): a single-line, ~40-byte
        // reference that cannot wrap, cannot verify-fail on size and cannot
        // collapse to a paste chip. The body/ack instructions still live in
        // the stored envelope, unrendered here, served verbatim over
        // `GET /api/mail/:id` for the worker to fetch.
        //
        // `resumeIfOwn: true` (F3 / bug #21): if a PRIOR sweep's Enter for
        // this session's nudge was lost, the box now holds our own
        // un-submitted text — `sendPrompt` recognizes it (see its own
        // docstring) and presses Enter rather than reading it as
        // `draft-present` and backing off forever. Because the nudge carries
        // no per-delivery identity, resuming it is always correct regardless
        // of which due row this sweep is actually attempting.
        //
        // `clearMailResidue: prior` (spec §2.2): safe to clear ONLY when this
        // delivery has provably been attempted before (a failed send on
        // record, or a prior successful delivery now replaying) — the new
        // lane never types a multi-line payload, so a paste-chip or
        // ```ccrc-mail fence in the box of a delivery that has NEVER been
        // attempted is far likelier a human's own paste than our residue, and
        // is left untouched. `isMailResidue` itself also never matches human
        // text (send.ts's own docstring) — this is belt AND suspenders, not
        // either alone.
        const prior = d.attempts > 0 || d.deliveredAt !== null;
        // `ownStrandedClear` (Task 407, operator ruling): the ONE dirty-box
        // case this lane may clear on PROOF rather than on shape.
        // `dispatch.ts` types a literal `/clear` into a resumed worker before
        // its wave brief and, on `enter-ignored`, records that refusal on the
        // run — the only durable evidence anywhere that this system typed
        // those four characters into that box and never had them taken. Read
        // here, at the send site, for exactly the row about to be typed —
        // and spent by it: `markDelivered` below is what retires the proof,
        // so the licence covers the delivery that inherits the wedge and
        // nothing after it (review, W4c finding 1).
        //
        // NOT an `isMailResidue` rung, and the difference is the whole gate:
        // `/clear` is four characters an operator plausibly types and leaves
        // sitting, so the TEXT proves nothing and a text-only recogniser
        // would have put this lane's C-u onto a human's own slash command.
        // With no run event to read, nothing is passed and `sendPrompt`
        // refuses `draft-present` exactly as it does today.
        const ownStrandedClear = store.strandedClear(d.toId);
        // `refuseIfTurnRunning` only when the live word that delivered is not
        // `idle` (worker stall watch §4.1). It is a tripwire for a build where
        // `shell` stopped meaning idle: the last 8 captured rows showing
        // `esc to interrupt`. It is best-effort: blind below `READER_MIN_COLS`,
        // where the line wraps, and on a `--remote-control` pane, which never
        // renders it.
        const res = await sendPrompt({ tmux: this.deps.tmux, queue: this.deps.queue }, d.toId, renderMailNudge(d.toId),
          { resumeIfOwn: true, clearMailResidue: prior, ownStrandedClear, holdIfAutoContinueArmed: true,
            refuseIfTurnRunning: turn.via !== 'idle' });
        if (res.ok) {
          this.mailCooldown.set(d.toId, now);
          store.markDelivered(d.id, now);
          // A REPLAY — this row was already `delivered` before this send —
          // counts against its own ceiling, independent of `attempts` (fix,
          // review finding 20: see `MAIL_REPLAY_MAX_ATTEMPTS`'s own
          // docstring for why `attempts` cannot serve this role). The FIRST
          // delivery (`d.deliveredAt === null`) never counts here.
          if (d.deliveredAt !== null) {
            // `{state:'terminal'}` — an ack or a park landed on this row from
            // a separate code path while this send was in flight (D10). The
            // row is decided; there is no count to weigh against the ceiling,
            // and re-parking a terminal row is exactly what rejectDelivery's
            // own guard exists to refuse.
            const bumped = store.bumpReplayCount(d.id);
            if (bumped.state === 'counted' && bumped.replayCount >= MAIL_REPLAY_MAX_ATTEMPTS) {
              store.rejectDelivery(d.id, 'undeliverable', MAIL_REPLAY_CEILING_ERROR);
            }
          }
          continue;
        }
        const attempts = d.attempts + 1;
        /**
         * TELL THE SENDER, ONCE (Task 409). Every operator-visible signal this
         * lane had was recipient-side and arrived only AFTER the park — and
         * coordinator<->worker mail is the only channel Build 7 has, so one
         * dirty input box silences a whole wave with nothing anywhere saying
         * why, on the screen of the session that actually needed to know.
         *
         * `recordAlways: true` for the same reason `pushNewMail` sets it: an
         * undeliverable message is a fact that happened whether or not the
         * operator is looking at the sender's pane. The PUSH stays
         * presence-gated, exactly as it is for every kind.
         *
         * THE EXISTING `'mail'` KIND, deliberately. `KIND_WORD`/`KIND_GLYPH`
         * in `MailScreen` are TOTAL maps, so a seventh kind means editing both
         * plus `NOTIFY_KINDS`, and every older client renders `undefined`.
         *
         * AND A DURABLE FEED ROW, NOT A `run_events` ROW (operator-accepted
         * deviation from §4.5). `advanceInner` is the only TRANSITION writer
         * of `run_events`: every insert there is paired with a transition
         * validated against `RUN_TRANSITIONS`, which has no self-transition
         * for any state. The other writers (`recordRunEvent`, the stall
         * watch's `insertStallObservation`) write `fromState === toState`
         * observation rows, which `pushNewRuns` skips, so they push nothing.
         * A park is not a run transition, so a transition row would lie about
         * the run's state and an observation row would never reach the
         * sender. `pushOne` mirrors into
         * `CoordStore.recordFeedEvent` — the durable archive behind the feed —
         * at exactly this point, which is the durability that was wanted.
         */
        const tellSender = (why: string, tag: string): void => {
          const origin = store.mailOrigin(d.mailId);
          if (!origin) return;
          // A ROLE is not a session id, and until wave 4 this knew that about
          // exactly one role (D-1040). `'coordinator'` is the only role that can
          // ever be resolved to a session, and only through the RUN it names:
          // the run's `claimedBy` is the fact, and a mail that names no run
          // carries no such fact. `resolveCoordinator(null)`'s answer — whichever
          // program happens to be the single active one — is exactly right on the
          // ADDRESSING side, where `toId:'coordinator'` with no run is the
          // documented recovery for a retired program, and is a guess here: a
          // message that belongs to no run cannot be inferred to belong to the one
          // program that happens to be open. Every other role (`'operator'`, wave
          // 4's program kickoff) has no session behind it at all — the operator
          // taps a button in a browser.
          //
          // Degrade, never guess, on all three arms: inventing a session id would
          // tag and presence-gate against an id no registry row carries, and
          // naming the wrong live one is worse — it tells a coordinator running an
          // unrelated program about a message it never sent and cannot act on.
          const senderId = !MAIL_ROLE_IDS.has(origin.fromId)
            ? origin.fromId
            : origin.fromId === 'coordinator' && origin.runId !== null
              ? store.resolveCoordinator(origin.runId)
              : null;
          if (senderId === null) return;
          this.pushOne({
            kind: 'mail', sessionId: senderId,
            project: sessionProjects.get(senderId) ?? '',
            title: `✉ blocked › ${d.toId}`,
            body: `${origin.subject}: ${why}`,
            runId: origin.runId,
            tag,
            recordAlways: true,
          }, projects);
        };

        if (res.error === 'auto-continue-armed') {
          // D-2369. Before the attempts ceiling on purpose: a held delivery is
          // not a failed one. Told once per hold, like draft-present.
          if (d.lastError !== 'auto-continue-armed') {
            tellSender('the recipient is waiting out a usage limit on its own; the nudge is held until it resumes',
              `mail-blocked-${d.id}`);
          }
          store.backOff(d.id, res.error, now + MAIL_ARMED_HOLD_MS, false);
          continue;
        }

        if (res.error === 'turn-running') {
          // Worker stall watch §4.1. The pane guard saw `esc to interrupt` and
          // refused before any keystroke. This arm sits before the attempts
          // ceiling, as the hold above does, because a running turn is not a
          // failed send. There is NO `tellSender`: a running turn is not a
          // blocked recipient, and the first sweep after the hold reads the
          // live word again.
          store.backOff(d.id, res.error, now + MAIL_TURN_HOLD_MS, false);
          continue;
        }

        // The park below applies ONLY to a row that has NEVER been delivered
        // (review finding 4): `d.deliveredAt === null` is the row's own,
        // durable proof of that. Rejecting a row that HAS been delivered
        // would write a false 'undeliverable' record over a message that
        // demonstrably reached the recipient, and would silently end
        // replay-until-ack (spec:174-177) — see `MAIL_MAX_ATTEMPTS`'s own
        // docstring for the full reasoning, including why this is also what
        // makes `MAIL_BACKOFF_MAX_MS` reachable (review finding 9).
        if (d.deliveredAt === null) {
          // `enter-ignored` is terminal HERE and nowhere else, and only for a
          // row that has never been delivered: the text is sitting in a
          // FRESH box, `submitEnter`'s doctrine forbids a blind third Enter,
          // and the rescue is a human looking at the pane. Re-injecting would
          // type the whole envelope a second time UNDER the first one.
          if (res.error === 'enter-ignored') {
            tellSender('the recipient never took the message — it is sitting in their input box',
              `mail-parked-${d.id}`);
            store.rejectDelivery(d.id, 'undeliverable', res.error);
            continue;
          }
          if (attempts >= MAIL_MAX_ATTEMPTS) {
            // PARKING IS KEPT: a message that can never land should not retry
            // forever. What was wrong was parking SILENTLY.
            tellSender(`the lane gave up after ${attempts} attempts (${res.error})`,
              `mail-parked-${d.id}`);
            store.rejectDelivery(d.id, 'undeliverable', res.error);
            continue;
          }
        }
        // THE FIRST failure of this kind, and only the first. `d.lastError` is
        // what the row already carried coming IN (`dueDeliveries` selects it),
        // so a repeat of the same refusal does not re-raise — the tray is not
        // a ticker. What stays live across every back-off tick is the strip,
        // via `attempts` on the wire (Task 408).
        if (res.error === 'draft-present' && d.lastError !== 'draft-present') {
          tellSender("the recipient's input box has unsent text in it", `mail-blocked-${d.id}`);
        }
        const step = Math.min(MAIL_BACKOFF_BASE_MS * 2 ** (attempts - 1), MAIL_BACKOFF_MAX_MS);
        store.backOff(d.id, res.error, now + step);
      } finally {
        this.mailInFlight.delete(d.toId);
      }
    }
  }

  /**
   * One `ccd pr-state --project <p>` per project with at least one workspace,
   * then `sweepMerged` over the same snapshot.
   *
   * The PHASE is still evaluated as a LEVEL: there is no prevPhase file and no
   * "did we see the transition" flag, because the producer and the consumer
   * are different processes on different boxes with no acknowledgement, and a
   * partial sweep killed at the outer timeout, an agent disconnect or a
   * skipped row would destroy an edge permanently. Re-reading the level every
   * 120 s is free.
   *
   * What CONSUMES that level is now edge-shaped on purpose, and the two do not
   * contradict each other. `sweepMerged` announces a merge once per
   * (workspace, PR) through the in-memory `mergedNotified` latch — an edge —
   * because a sentence repeated every 120 s for the life of a workspace is
   * noise, and losing that edge to a restart costs one silently-replaced
   * notification (see the field's own docstring). The old consumer was
   * `ws-archive`, which is idempotent and destructive, so it wanted the
   * opposite: no latch at all, and a retry every sweep. It is gone (operator
   * ruling, 2026-09-10 — see `sweepMerged`).
   */
  private async sweepPr(): Promise<void> {
    const now = Date.now();
    // Single-flight, but never permanently. A sweep still running after
    // PR_SWEEP_STUCK_MS is abandoned — not cancelled, there is nothing to
    // cancel; it is simply no longer allowed to hold the lane shut.
    if (this.prSweepStartedAt !== 0 && now - this.prSweepStartedAt < PR_SWEEP_STUCK_MS) return;
    // The same guard tick() already applies before saveSnapshot: with the
    // agent down there is nothing to read and every state keeps its checkedAt.
    if (this.deps.cfg.fleetMode === 'remote' && !this.deps.fleetState?.connected) return;
    const anyPending = [...this.prStates.values()].some((s) => s.phase === 'open' && s.checks === 'pending');
    const due = anyPending ? PR_SWEEP_ACTIVE_MS : PR_SWEEP_MS;
    if (this.lastPrSweep !== 0 && now - this.lastPrSweep < due) return;
    this.lastPrSweep = now;
    const mySweep = now;
    this.prSweepStartedAt = mySweep;
    try {
      const records = await readRegistry(this.deps.io, this.deps.cfg);
      const projects = [...new Set(records.filter((r) => r.workspace !== null).map((r) => r.project))];
      for (const project of projects) {
        const back = this.prBackoff.get(project);
        if (back && now < back.until) continue;
        const argv = CCD_ARGV.prStateProject(project);
        if (!verbSupported(this.deps.fleetState, argv)) {
          for (const r of records.filter((x) => x.project === project && x.workspace !== null)) {
            // retryAt: null — an unsupported verb is not a scheduled retry, and a
            // stale `until` from an earlier backoff must not survive as a promise.
            this.prStates.set(r.id, { ...(this.prStates.get(r.id) ?? UNCHECKED_PR), phase: 'unknown', reason: 'unsupported', retryAt: null });
          }
          continue;
        }
        const res = await this.deps.runCcd(argv);
        if (!res.ok) { this.backoffPr(project, now, 'agent-down', records); continue; }
        const lines = parsePrLines(res.stdout);
        // A WHOLE-REPO failure — the id-less shape, emitted by `_gh_repo_slug`,
        // `_gh_pr_list`, and `_pr_py` for an unparseable rc-0 body — really
        // does mean every session of this repo is unreadable (each is one gh
        // answer for the whole repo), so it backs the project off. Note the
        // unparseable-body case emits one id-less object PER SESSION in a
        // --project sweep; `find` taking the first is correct because they all
        // describe the same repo-wide fact. A PER-SESSION failure
        // carries an `id` and must not: one workspace whose registry lost its
        // `branch` is one broken session, and §6's "Partial sweep" row promises
        // its seven siblings keep their own answers.
        const failure = lines.find((l) => !('id' in l)) as CcdPrFailure | undefined;
        if (failure !== undefined) {
          // D-2883: the plan's own snippet here read `failure.project`, which
          // does not exist on `CcdPrFailure` (`{ phase: 'unknown'; reason }` —
          // no `project` field; it speaks for the whole repo precisely because
          // it carries none). The project this failure is ABOUT is the loop's
          // own `project`, already in scope.
          //
          // Coordinator ruling, fix round 1 (Important 1): a failed read never
          // overwrites a GOOD measurement — the same principle `backoffPr`'s
          // own docstring states two methods below for `prStates`
          // ("A failed read never overwrites a good phase — only greys it").
          // `no-remote` is still a real measurement (`repoCellFor`'s one proof
          // of `absent`) and is written regardless of what is already there —
          // a project's remote can genuinely be removed between sweeps. Every
          // OTHER reason resolves to `unmeasured`, which teaches nothing about
          // the repo itself, so it is dropped whenever a real cell (`named` or
          // `absent`) already exists: a repo slug is effectively immutable,
          // and a `gh` timeout says nothing about it either way.
          this.retainRepo(project, repoCellFor({ reason: failure.reason }));
          this.backoffPr(project, now, failure.reason, records);
          continue;
        }
        this.prBackoff.delete(project);
        for (const line of lines) {
          if (!isFullLine(line)) {
            // Greyed alone, and NEVER passed to phaseFor: it has no `rows`, so
            // `boundRow(undefined, …)` would throw inside this void-dispatched
            // sweep and lose every project after this one.
            //
            // The id-LESS shape already backed the project off and `continue`d
            // above, so anything reaching here carries an id — but the union
            // still admits CcdPrFailure, so NARROW rather than assert: a cast
            // here would be the same "trust the shape" move that made
            // discriminating on `id` wrong in the first place.
            if (!('id' in line)) continue;
            this.prStates.set(line.id, { ...(this.prStates.get(line.id) ?? UNCHECKED_PR), phase: 'unknown', reason: line.reason, retryAt: null });
            continue;
          }
          this.prStates.set(line.id, phaseFor(line));
          this.prQueues.set(line.id, queueFor(line));
          // RETAINED, not derived: `line.repo` is `_gh_repo_slug` of this
          // project's main checkout, already measured by this same sweep and
          // until now dropped here — `phaseFor` returns a `PrState`, which has
          // no repo field. This is the seam; `prstate.ts`'s `prView` KEEPS the
          // repo for the PR sheet and is NOT where retention belongs.
          //
          // D-2922: keyed on the LOOP's `project`, never `line.project`.
          // `parsePrLines` casts a full line straight through
          // (`v as unknown as CcdPrLine`, `prstate.ts`), so `line.project` is
          // whatever ccd wrote and had exactly one reader in the tree — this
          // statement. The loop's own `project` is what `ccd pr-state
          // --project` was CALLED with, which is the same argument the failure
          // arm above already uses for the same reason.
          this.retainRepo(project, repoCellFor({ slug: line.repo }));
        }
      }
      this.sweepMerged(records);
      this.sweepLanding(records);
    } finally {
      // Only the CURRENT sweep may clear the stamp. An abandoned sweep that
      // finally returns half an hour later must not unlatch the one that
      // replaced it — `lastPrSweep` gating makes two starts in the same
      // millisecond impossible, so the timestamp is a sufficient identity.
      if (this.prSweepStartedAt === mySweep) this.prSweepStartedAt = 0;
    }
  }

  /**
   * The ONE keep-last rule both writing arms of `sweepPr` obey (D-2884, made
   * structural by D-2922): `unmeasured` says "no measurement happened", which
   * is false once one has, so it is written only when the project has no cell
   * yet. `named` and `absent` are measurements and always land — a repo slug
   * can change and a remote can genuinely be removed between sweeps.
   *
   * A METHOD, not a convention repeated at two call sites: "all three arms
   * agree" was true only as long as both spellings happened to match, and the
   * full-line arm's spelling did not. The third arm (`!res.ok`, the agent
   * being down) deliberately writes nothing at all, which is this same rule's
   * conclusion for a read that never reached the repo.
   */
  private retainRepo(project: string, cell: ProjectRepoWire): void {
    if (cell.state !== 'unmeasured' || !this.projectRepos.has(project)) {
      this.projectRepos.set(project, cell);
    }
  }

  /** A failed read never overwrites a good phase — only greys it — and an
   *  unauthenticated lane jumps straight to the ceiling, because retrying a
   *  revoked token every two minutes buys nothing. */
  private backoffPr(project: string, now: number, reason: PrState['reason'], records: SessionRecord[]): void {
    const prev = this.prBackoff.get(project);
    const step = reason === 'unauthenticated' || reason === 'rate-limit'
      ? PR_BACKOFF_MAX_MS
      : Math.min((prev?.step ?? PR_SWEEP_MS) * 2, PR_BACKOFF_MAX_MS);
    this.prBackoff.set(project, { until: now + step, step });
    for (const r of records.filter((x) => x.project === project && x.workspace !== null)) {
      const keep = this.prStates.get(r.id) ?? UNCHECKED_PR;
      // `retryAt` is `until` on the wire. §6's rate-limit row promises reason AND
      // retry time, and a 15-minute flat backoff with neither is indistinguishable
      // from a cap that has simply stopped working.
      this.prStates.set(r.id, { ...keep, phase: 'unknown', reason, retryAt: now + step });
    }
  }

  /** The merged push: once per (workspace, PR). `reason` names the thing a
   *  human would have to release before they could archive this workspace by
   *  hand — a hold, an open run — and is null in the ordinary case, where
   *  nothing is in the way and the workspace is simply still here. The two
   *  sentences differ by that clause alone, so the held wording is unchanged
   *  from when it was the only one. */
  private announceMerged(key: string, r: SessionRecord, number: number | null, reason: string | null): void {
    if (this.mergedNotified.has(key)) return;
    this.mergedNotified.add(key);
    this.pushOne({
      kind: 'merged', sessionId: r.id, project: r.project,
      title: `✓ merged › ${r.workspace}`,
      body: reason === null
        ? `PR #${number ?? '?'} merged; nothing archived.`
        : `PR #${number ?? '?'} merged — ${reason}; nothing archived.`,
      // EXPLICIT, because `pushOne`'s default (`${kind}-${sessionId}`) is one
      // key short of this lane's own. The latch is per (workspace, PR) so a
      // second PR from the same workspace is announced — and an id-only
      // collapse tag would then let that second announcement REPLACE the
      // first in the tray, so an operator who looked once, late, would learn
      // that #43 landed and never that #42 did. Same shape and the same
      // reason as the mail lane's `mail-<toId>-<mailId>` just above.
      //
      // It still collapses where it should: a restart forgets the latch and
      // may repeat ONE PR's push, and that repeat carries this same tag, so
      // it replaces rather than stacks.
      tag: `merged-${key}`,
    }, this.activeProjects);
  }

  /**
   * The merged lane: it ANNOUNCES, and it never acts.
   *
   * WHAT IT USED TO DO, and why that ended (operator ruling, 2026-09-10). This
   * loop ran `ccd ws-archive` on a merged workspace the moment it measured
   * idle and unwatched — the only destructive ccd call in this server that
   * NOBODY ASKED FOR. The other two `wsArchive` call sites both answer a
   * request: `server.ts`'s `/archive` route is the operator's own button, and
   * `coord/close.ts`'s is a run close carrying `{state:'failed', archive:true}`.
   * Both wear `sweepDec`'s unattended-server provenance, because that is who
   * runs the verb; neither fires on a timer. `ws-archive` deletes nothing on
   * disk, which is the sentence the original ruling rested on, but it
   * unsupervises the unit and kills the tmux pane, so it ends the session, its
   * scrollback and whatever turn was in flight.
   *
   * MEASURED on the live fleet the day this changed: 7 of the box's 13 archive
   * markers read `merged:#N`, five of them from the preceding 48 hours — and
   * every one of those five sat on a session that was ALIVE AGAIN, revived by
   * hand after this sweep had killed it. That is not tidying finished work; it
   * is interrupting work in progress, and then doing it again, because the
   * trigger is a LEVEL and `ws-restore` clears the very marker that suppressed
   * it. (The same population is what `divergence`'s archived-but-live census
   * and `sessionBucket`'s D-74 conjunct were both built to survive.)
   *
   * The safety ladder could not see that harm and never could. `archiveSafety`
   * measured an INSTANTANEOUS `idle` — and a session parked at the prompt
   * while its operator reads the last answer measures exactly that. A `tmux
   * attach` on the fleet box was invisible to it; only an open PWA websocket
   * counted. Deferring on `busy`/`attached`/`unknown` narrowed the window; it
   * could not close it, because the thing being measured is not the thing that
   * matters (whether a human is coming back).
   *
   * A merged PR is also not the end of a workspace. It survives its own merge
   * now, so it can land a second PR — `boundRow` binds the newest one — which
   * is why the latch key carries the number.
   *
   * WHAT REMAINS. The rungs above the act stay, because they now choose the
   * SENTENCE rather than gate a destruction: a hold and an open run each name
   * why a human would have to release something first. What is gone with the
   * act is every MEASUREMENT it needed — `archiveSafety`'s tmux verdict, pane
   * pid and `<pid>.json` read, each an agent round trip per merged row per
   * sweep in remote mode, on a population that now accumulates instead of
   * retiring itself.
   *
   * ARCHIVING IS UNCHANGED AS A HUMAN ACT: `POST /api/sessions/:id/archive`
   * from the PWA, `ccd ws-archive` at a terminal, and the coordinator's own
   * lane (`coord/close.ts`'s `{state:'failed', archive:true}`) all still do
   * exactly what they did. Nothing here removed a door; it removed the actor
   * that walked through one unasked.
   */
  private sweepMerged(records: SessionRecord[]): void {
    for (const r of records) {
      // SKIP a degraded row before anything else. It no longer guards an act —
      // there is none — but it still guards the SENTENCE. Not because `held`
      // would read wrong: a listed-but-unreadable `.hold` answers
      // `HOLD_UNREADABLE`, never null (`registry.ts` argues that polarity at
      // length, and `hold-gate.test.ts` pins the resulting body verbatim).
      // Because the row's own IDENTITY is what this box could not read — the
      // uuid, workdir or wrapper naming which session this is — and a
      // notification is a statement about a specific workspace, addressed to
      // it (`sessionId` deep-links the phone to `/s/<id>`). Announcing off a
      // row that could not be identified is a claim about something unproven,
      // and the same silence the previously-dropped row used to get.
      if (measuredIdentity(r) === null) continue;
      const pr = this.prStates.get(r.id);
      if (r.workspace === null || r.archivedAt !== null) continue;
      if (pr?.phase !== 'merged') continue;                 // unknown NEVER announces
      // THE LATCH FIRST, and that ordering is the point of hoisting the key out
      // of `announceMerged`. Everything below this line is work done only to
      // WORD a sentence, and the deleted code paid for its own `coord.db` read
      // exactly once per workspace because the rungs above it (a hold, then an
      // affirmative-idle measurement) turned most rows away first — its
      // comment recorded "Measured N reaching this query on the live fleet: 0
      // rows per sweep". Those rungs are gone and merged rows now ACCUMULATE
      // by design, so without this check every merged workspace would pay a
      // query every 120 s, for the life of the server, to re-derive a sentence
      // that was already said and will be thrown away.
      const key = mergedKey(r.id, pr.number);
      if (this.mergedNotified.has(key)) continue;
      // The reason is DISPLAY ONLY now, so it is taken from what is already in
      // hand: the snapshot's `held`, and one synchronous `coord.db` read. The
      // fresh registry re-read this used to take at the decision point existed
      // because the decision was destructive and the snapshot predates a
      // gh-bound round trip per project; the cost of a stale read here is a
      // notification that does not name the hold placed thirty seconds ago,
      // and the next PR's announcement gets it right.
      //
      // `?.` on `coord` is load-bearing: `test/helpers.ts`'s `testDeps` supplies
      // none, and every test that reaches this lane would TypeError without it.
      // `?? []` is not an overloaded null — a server with coordination switched
      // off has no runs to be claimed by, so "no coord" and "no open run" are
      // the same fact here rather than two a caller would treat differently.
      //
      // D-2545: THE SUCCESS PATH IS BYTE-IDENTICAL — the specific reason below
      // is still built exactly as it was, and the wave-1 ruling's "generic
      // open-run reason" describes only the refusal arm. On a refusal the
      // sentence falls back to a GENERIC one naming no row detail: the reason
      // is display-only here, and a notification must not assert a run number,
      // a programme or a wave off a read that did not happen.
      const sib = this.deps.coord?.openRunsForSession(r.id);
      const unreadable = sib !== undefined && !sib.ok;
      const openRuns = sib?.ok ? sib.siblings : [];
      const run = openRuns[openRuns.length - 1];
      const reason = r.held !== null
        ? r.held
        : run !== undefined
          ? `run ${run.id} is still open — ${run.program} wave ${run.wave}${run.waveOf === null ? '' : `/${run.waveOf}`}`
          : unreadable
            ? 'a run may still be open — the run rows could not be read'
            : null;
      this.announceMerged(key, r, pr.number, reason);
    }
  }

  /**
   * The landing lane (landing-order wave 2, spec §5.2): the coordinator's two
   * notices about a PR it is landing through the merge queue. It ANNOUNCES; it
   * never enqueues, merges, re-runs or re-enqueues anything (R5).
   *
   *  - DEQUEUED (`queueFor` reads `dequeued`). GitHub does NOT re-enqueue a PR
   *    its queue removed, so a removal nobody hears about is a landing that
   *    silently stops. Once per (workspace, PR, removal): a `status` mail
   *    (`dequeuedSubject`) to the coordinator of the open run that names the
   *    workspace — who re-enqueues or sends a fix round — and a `queue` FEED
   *    record, always (`recordAlways`: a removal is a fact about the
   *    programme whether or not anyone is watching this pane). With no open
   *    run there is nobody to tell without guessing (`resolveCoordinator(null)`
   *    answers whichever programme is the single active one, `tellSender`'s
   *    reason), so the record is the whole notice. A NEW kind rather than
   *    `merged` or `mail`: a dequeue is the one PR outcome that is not a
   *    merge; `MailScreen`'s two total maps name it, and an older client
   *    degrades it to `unknown` through `reviveNotifyEvent`.
   *  - MERGED (the phase `sweepPr` derived reads `merged`) while that run
   *    waits at `merging`: a `status` mail (`mergedSubject`) to its
   *    coordinator, once per (workspace, PR). `merging` is the coordinator's
   *    own declaration that it is landing this PR; on a native-queue project
   *    it enqueued and ended its turn (clause 15; `wave-lifecycle.md` §5), and
   *    this mail is what wakes it to prove the merge and close the run — it
   *    never polls (clause 7). The run's state is all this reads, not whether
   *    the project has a queue: a synchronous merge elsewhere that a sweep
   *    reads before the close is mailed too, and the skill says to prove and
   *    close as usual. No feed record: `sweepMerged` writes the `merged` one.
   *    A merged PR whose run is elsewhere — a hand merge, a close that came
   *    first — asked for nothing, and the first sweep that reads the merge
   *    decides so.
   *
   * WHY THE OPEN RUN IS THE KEY. Under "One PR per child" a producer that
   * closed before its PR landed would be reclaimed (child-reclamation wave 3:
   * registry row, worktree and pane gone), and a reclaimed workspace has no
   * pr-state line to carry a queue word — nor a worker to take a fix round.
   * On a native-queue project the coordinator therefore lands BEFORE it
   * closes (clause 15): the run waits at `merging` holding the child, so the
   * row, the line and the worker all outlive the queue. The run is the one
   * `survivorOf` picks — the close's and dispatch's own rule.
   *
   * ONCE ACROSS RESTARTS TOO. Before telling, the lane asks coord.db whether
   * this notice was ALREADY told: a mail through `hasMailWithSubject` — every
   * delivery state, because `queueSystemMail`'s own dedupe sees OUTSTANDING
   * rows only and an acked notice would otherwise be mailed again after every
   * rollout — and the feed-only dequeue through `hasFeedEvent` on the exact
   * body, which carries the removal time. A hit latches and says nothing.
   *
   * THREE OUTCOMES, KEPT APART. Run rows that cannot be read are NOT "no open
   * run" (the overloaded null `sweepMerged` also refuses): the lane defers,
   * says nothing and latches nothing, and the next sweep re-reads. A mail
   * that throws (`node:sqlite`, synchronously) is caught with nothing recorded
   * and nothing latched, so the next sweep tries again — the mail is queued
   * BEFORE the feed record for exactly that reason, so a retry leaves one
   * record. Only a notice that landed, one a durable read found, or a
   * decision that there is nobody to tell, is latched.
   *
   * `unmeasured` and `absent` NEVER announce a dequeue, and neither do
   * `queued`, `landed` or `none`: the lane fires on the one word that asks
   * for an act. A PR the coordinator's enqueue only ARMED reads `none` too
   * (gh 2.45 arms auto-merge, rather than queueing, a PR whose required
   * checks have not passed, and prints the same line either way): the lane
   * cannot tell that from "not enqueued yet", so the coordinator reads the
   * queue entry back before it ends its turn (`wave-lifecycle.md` §5).
   */
  private sweepLanding(records: SessionRecord[]): void {
    const coord = this.deps.coord;
    if (coord === undefined) return;
    for (const r of records) {
      if (measuredIdentity(r) === null) continue;
      if (r.workspace === null || r.archivedAt !== null) continue;
      // EVERY DECISION is `coord/landing.ts`'s (D-3883, pure L1): `landingAsk` says what this line asks for and
      // whether it is already latched, and `landingVerdict` says the next step given the facts read so far. This
      // loop is the READS and the DELIVERIES, nothing else.
      const ask = landingAsk({
        sessionId: r.id, workspace: r.workspace, number: this.prStates.get(r.id)?.number ?? null,
        phase: this.prStates.get(r.id)?.phase, queue: this.prQueues.get(r.id),
      }, this.landingNotified);
      if (ask === null) continue;
      // ONE BAD ROW MAY NOT COST THE REST OF THE SWEEP: `node:sqlite` throws
      // synchronously, and this runs inside the void-dispatched `sweepPr`.
      try {
        const facts: LandingFacts = {};
        let run: OpenSibling | null = null;
        // ENDS: every step that is not an end records one fact (`runs`, `coordinator`, `runState`, `told`) that
        // `landingVerdict` then reads as made, and the facts have those four keys (`told` once: the mail proof or
        // the feed proof, never both), so at most four reads precede an end. The switch is exhaustive: a new step
        // kind is a compile error here, never a silent delivery.
        steps: for (;;) {
          const s = landingVerdict(ask, facts);
          switch (s.step) {
            case 'runs': {
              const sib = coord.openRunsForSession(r.id);
              run = sib.ok ? survivorOf(sib.siblings) : null;
              facts.runs = sib.ok ? { ok: true, run } : { ok: false, detail: sib.detail };
              break;
            }
            case 'coordinator':
              facts.coordinator = coord.resolveCoordinator(s.runId);
              break;
            case 'runState': {
              const read = coord.run(s.runId);
              facts.runState = read.ok ? { ok: true, state: read.run?.state ?? null } : { ok: false, detail: read.detail };
              break;
            }
            case 'toldMail':
              facts.told = coord.hasMailWithSubject('operator', s.runId, s.toId, s.subject);
              break;
            case 'toldFeed':
              facts.told = coord.hasFeedEvent('queue', r.id, s.body);
              break;
            case 'defer':
              console.warn(`ccrc-server: landing notice for ${r.id} deferred (run rows unreadable: ${s.detail})`);
              break steps;
            case 'latch':
              this.landingNotified.add(ask.key);
              break steps;
            case 'deliver':
              if (s.mail !== null) queueSystemMail(coord, run, s.mail);
              if (s.record !== null) this.pushOne({ kind: 'queue', sessionId: r.id, project: r.project, ...s.record }, this.activeProjects);
              this.landingNotified.add(ask.key);
              break steps;
            default: {
              const unhandled: never = s;
              throw new Error(`landing: unhandled step ${JSON.stringify(unhandled)}`);
            }
          }
        }
      } catch (err) {
        console.warn(`ccrc-server: landing notice for ${r.id} failed (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }

  /**
   * Capture each registered session's pane (dead panes capture as null); a menu
   * pane parses to a dialog. Emit `dialog` when the id changed since last tick,
   * `dialog_cleared` when a previously-reported dialog vanished. Returns the
   * set of session ids with a dialog pending, for the fleet assembly.
   *
   * The id alone is the right gate HERE, unlike the per-session stream's
   * (`nextDialogFrame`): this sweep only ever sees the bare pane parse, and its
   * `dialog` emission is consumed for the push notification and the fleet's
   * dialogPending flag — the open session's own stream owns the frame the client
   * renders, and drops these (`sessionws.ts` onSessionMsg). Enrich the parse here
   * and this gate needs the same upgrade path.
   *
   * `records` is `tick()`'s own registry read, passed in rather than fetched
   * again here (optional, defaulting to its own read, so this stays
   * independently callable) — same sharing as `sweepHookStates` above.
   *
   * THE ASYMMETRY (Task 2): `sweepHookStates`/`sweepTasks` above now RETAIN a
   * degraded row's last-known entry rather than erase it, because both read
   * something keyed off the identity triple (`r.uuid`, `r.wrapper`) that
   * reads `''` on a degraded row and would otherwise blank a value that may
   * still be true. This sweep has no such hazard to guard against: it keys
   * every read off `r.id` alone (`tmux.capture(r.id)`), which the registry
   * ladder never degrades — an id this loop iterates is, by construction,
   * listed. So a degraded row's dialog/statusline detection here is
   * UNCHANGED and fails stale BY DESIGN by simply running exactly as it
   * always has, needing no retain-don't-erase logic of its own — the code
   * makes that visible by NOT mentioning `measuredIdentity` anywhere below.
   */
  private async detectDialogs(notify: boolean, records?: SessionRecord[]): Promise<Set<string>> {
    const pending = new Set<string>();
    const recs = records ?? await readRegistry(this.deps.io, this.deps.cfg);
    for (const r of recs) {
      const pane = await this.deps.tmux.capture(r.id);
      // Same capture feeds the statusline read — no extra tmux call. FOUR
      // conditions, four outcomes (D-2012, corrected by Finding 3 of the
      // fix round below — the three-outcome version this replaced treated
      // "measured identity OR measured ctx" as one outcome, a whole-object
      // replace, which is right when identity is present and WRONG when
      // only ctx is: it blanked the last-known model/branch/effort on any
      // tick that read the ctx segment alone):
      //
      //  1. dead pane (`pane === null`) — delete the whole entry. Unchanged.
      //  2. a tick that measured IDENTITY (model/branch/effort — one
      //     statusline row paints all three together, or none) — the whole
      //     entry becomes this tick's fresh parse. A ctxPct this tick did
      //     not find (the ▓ segment scrolled off, or a permission prompt
      //     covers just that cell) is simply absent from `sl`, so it is
      //     dropped by the same replace that lands everything else — no
      //     separate carry needed.
      //  3. a tick that measured ctxPct ALONE — no model/branch/effort at
      //     all. The 🤖/⎇ segments are independently conditional
      //     (ccd/statusline-command.sh:134-149: model on
      //     `.model.display_name`, branch on being inside a repo), so a
      //     ctx-only tick is a real, distinct shape, not a "nothing
      //     measured" tick wearing a stray ctxPct. MERGE the fresh ctxPct
      //     onto whatever identity was last known, rather than either
      //     replacing the whole entry with `sl` (which would blank
      //     model/branch/effort to `undefined` — the exact regression a
      //     naive `sl.model || sl.branch || sl.effort` guard alone would
      //     reintroduce, MEASURED: reverting to that guard with this merge
      //     branch removed left all three touched suites green) or
      //     dropping the fresh reading on the floor.
      //  4. a tick that measured NOTHING AT ALL (a dialog/permission overlay
      //     covers the whole statusline row, or the session is mid-render) —
      //     keep the row rather than blank it, same as before, EXCEPT for
      //     ctxPct: a stale high reading surviving a tick where the console
      //     could not even see the statusline is worse than showing no
      //     reading, so it is explicitly cleared while model/branch/effort
      //     ride through untouched. On either retaining branch (3 or 4)
      //     `boxCols` is never kept — THIS tick's reading or none — and
      //     `workflowActive` is THIS tick's reading wherever the tick saw the
      //     statusline row, the last one kept where it did not, as the notes
      //     beside the code below say.
      if (pane === null) {
        this.statuslines.delete(r.id);
      } else {
        const sl = parseStatusline(pane);
        // NOT named `measuredIdentity`: that is a module-level import from
        // ./registry.js meaning something else entirely (a registry record
        // whose identity triple is measurable), used at nine other sites in
        // this file. A local of that name shadows it inside this block.
        const sawStatuslineIdentity = sl.model || sl.branch || sl.effort;
        // `retained` marks identity this tick did NOT measure, so the fleet can
        // rank a kept branch below the worktree's measured HEAD (fleet.ts) —
        // the map itself still keeps it, exactly as D-2012 argues below.
        if (sawStatuslineIdentity) {
          this.statuslines.set(r.id, sl);
        } else if (sl.ctxPct !== undefined) {
          const prev = this.statuslines.get(r.id);
          // ctx is read off the statusline row, so this tick saw it and its
          // `workflowActive` is defined: the `??` below never falls through
          // here. Written as on branch 4 so the one rule reads the same on both.
          this.statuslines.set(r.id, prev ? { ...prev, ctxPct: sl.ctxPct, boxCols: sl.boxCols, workflowActive: sl.workflowActive ?? prev.workflowActive, retained: true } : sl);
        } else {
          // `boxCols` rides with ctxPct, never with identity: it is THIS
          // tick's width or nothing. A kept width would read an overlay tick
          // on a pane just narrowed by an attach as still wide — the one
          // direction the fleet's `narrow` chip must not err in.
          // `workflowActive` reads the rows BELOW the statusline row. A tick
          // that saw that row measured them — a `👤`-only row lands on this
          // branch with no identity and no ctx, and its reading is this
          // tick's, `true` or `false`. A tick that did not (an overlay, a
          // pane mid-render) gets `undefined` from `parseStatusline`, and the
          // LAST measurement rides through, like identity: a stored `false`
          // there dropped a running Workflow's card to idle, and fired
          // "✓ Finished", for as long as the overlay stayed up, wherever
          // fleet.ts reads the row (no live file, or a pre-2.1.277 build).
          const prev = this.statuslines.get(r.id);
          if (prev) this.statuslines.set(r.id, { ...prev, ctxPct: undefined, boxCols: sl.boxCols, workflowActive: sl.workflowActive ?? prev.workflowActive, retained: true });
        }
      }
      // hasMenu, not paneState() === 'menu': paneState tests BUSY_RE across the
      // WHOLE pane, and an RC-off pane renders the busy marker WHILE a dialog is
      // painted below it (fleet.ts's liveStatus doc) — so paneState would answer
      // 'busy' here and this sweep would suppress the parse forever. hasMenu is
      // deliberately independent of the busy check for exactly that reason
      // (pane/dialog.ts:42-54); it's the same idiom send.ts:320 uses to decide
      // whether a menu owns the keyboard. SGR strip mirrors that idiom, though
      // tmux.capture() (-p, no -e) carries no escape codes to strip today, unlike
      // captureAnsi().
      const dialog = pane !== null && hasMenu(pane.replace(SGR, '')) ? parseDialog(pane) : null;
      const last = this.dialogIds.get(r.id);
      if (dialog) {
        pending.add(r.id);
        // The pane is what raises this push (`kind: 'ask'` has exactly one
        // producer, and it is this scrape), but the ANSWERABLE part comes from
        // the hook envelope: only it carries the option labels and the content
        // key `answerAsk` gates on. `askActions` returns null wherever that
        // route would refuse, so a notification never offers a button the
        // server has already decided it will not honour. `this.hookStates` is
        // this tick's — see the ordering note in `tick()`.
        const actions = askActions(this.hookStates.get(r.id) ?? null);
        const raise = (): void => {
          // `this.activeProjects` — this sweep runs BEFORE this tick's own
          // `assembleFleet` (see `tick()`), so the current fleet's project
          // set isn't computed yet; it reads last tick's, same reasoning as
          // `sweepMerged` above.
          this.pushOne({
            kind: 'ask', sessionId: r.id, project: r.project,
            title: '❓ Question', body: askPushBody(this.hookStates.get(r.id) ?? null, dialog),
            ...(actions ? { actions } : {}),
          }, this.activeProjects);
          // Latched whenever this raise had no actions, cleared the moment one
          // has them — so the amendment below fires at most once per question.
          //
          // `notify` gates the CALL, not delivery: `pushOne` returns before
          // `push.notify` whenever presence says the operator is looking at
          // this session. So the latch can be set for a question whose push was
          // suppressed, and the amendment can then "replace" a notification
          // that was never shown. Harmless in both directions — a suppressed
          // amendment is suppressed too (same presence check), and a claim that
          // lapses in between produces one answerable notification, which is
          // the outcome we wanted anyway. What it must NOT be called is proof
          // that a push went out.
          if (actions) this.actionlessAsks.delete(r.id);
          else this.actionlessAsks.set(r.id, dialog.id);
        };
        if (last !== dialog.id) {
          // Fix round 1, item 4 (Important): a new dialog can replace the old
          // one with NO intervening `dialog_cleared` tick — `parseDialog`'s id
          // hashes the menu's title+labels, so two single-question dialogs
          // back to back both take THIS branch, never the `else if (last !==
          // undefined)` clear branch below. Left alone, `heldAsks.set` a few
          // lines down would silently overwrite an OLD held row, orphaning it
          // forever: Task 7's sweep is keyed by session id (the entry is
          // gone, so it never fires `releaseAsk`) and Task 8's clear-branch
          // `staleAsk` is CAS'd on `(dialogId, childId)` for the CURRENT
          // dialog only, so it can never reach a row minted against a dialog
          // that left `dialogIds` without a clear edge. Settling it here,
          // against `last` (the id it was actually minted under, still in
          // scope), is the only place left that can still name it — done
          // unconditionally, before eligibility is even asked for the NEW
          // dialog, because the OLD one is gone from the pane either way.
          // D-5289: a lapsed question this child replaced is no longer one a
          // late parent answer could land in, so its notification is final.
          this.lapsedAsks.delete(r.id);
          const orphaned = this.heldAsks.get(r.id);
          if (orphaned !== undefined && last !== undefined) {
            // The map entry is dropped unconditionally, BEFORE the guarded
            // write below — fix round 2, item 1: a failing `staleAsk` must
            // not leave the entry to be retried (and re-warned about) forever
            // on every subsequent tick; the in-memory hold is over either
            // way, since the dialog it was minted under is already gone.
            this.heldAsks.delete(r.id);
            // Guarded (fix round 2, item 1): this is a synchronous
            // `node:sqlite` UPDATE sitting directly on the 2 s poll, run
            // BEFORE the `notify` gate below — i.e. on every tick shape, not
            // just the mint edge — so an unguarded throw here would kill the
            // whole process exactly as the neighbouring `hold()` guard a few
            // lines down exists to prevent, and this write sat outside that
            // guard's reach.
            try {
              this.deps.coord?.staleAsk(last, r.id, Date.now());
            } catch (err) {
              console.warn(`ccrc-server: settling an orphaned ask hold failed for ${r.id} (${err instanceof Error ? err.message : String(err)}) — a held row may remain orphaned in coord.db`);
            }
          }
          this.dialogIds.set(r.id, dialog.id);
          this.bus.emit(`session:${r.id}`, { type: 'dialog', dialog });
          this.settlingAsks.delete(r.id);
          if (notify) {
            // D-5290: the FIRST raise waits while the child's hookstate is not
            // yet `waiting` and nothing made the dialog answerable — the menu
            // painted after this tick's hookstate read (`tick()`'s ordering
            // note), and one or two ticks later the envelope is there to hold.
            // Bounded by `ASK_SETTLE_TICKS`, in the arm below.
            if (actions === null && this.hookStates.get(r.id)?.state !== 'waiting') {
              this.settlingAsks.set(r.id, { dialogId: dialog.id, ticks: 1 });
            } else if ((await this.tryHold(r, dialog, actions, recs)).kind === 'none') {
              raise();
            }
          }
        } else {
          // SAME DIALOG, STILL PAINTED (D-2403). The continuity observation
          // the instance guard needs and never had: `last === dialog.id` means
          // this tick re-scraped the very menu the row was minted against, so
          // any movement in the child's hookstate `updatedAt` since the mint
          // was a write that did NOT change the question on screen. Advance
          // `askAt` to match, or the next parent answer refuses `ask-moved`
          // over a bump nobody made — see `restampAsk`'s own docstring for
          // the writers that still do this (since D-4041 a subagent event over
          // a MAIN-thread wait keeps `updatedAt`; one over a wait a subagent
          // raised, and any other bump, still moves it) and for why
          // re-stamping is not a weakening. Runs BEFORE the amendment gate, and
          // independent of it, whether or not the notification is replaced.
          this.restampHeldAsk(r.id, dialog.id);
          const settling = this.settlingAsks.get(r.id);
          if (settling !== undefined && settling.dialogId === dialog.id) {
            // D-5290, the deferred first raise: still nothing to hold and
            // hookstate still not `waiting` — wait, at most `ASK_SETTLE_TICKS`
            // ticks in all; otherwise this IS the first raise, through the one
            // `tryHold` the first sighting uses.
            if (actions === null && this.hookStates.get(r.id)?.state !== 'waiting' && settling.ticks < ASK_SETTLE_TICKS) {
              settling.ticks += 1;
            } else {
              this.settlingAsks.delete(r.id);
              if (notify && (await this.tryHold(r, dialog, actions, recs)).kind === 'none') raise();
            }
          } else if (notify && actions && this.actionlessAsks.get(r.id) === dialog.id) {
            // The amendment. Same question, same tag — `push-sw.js` sets
            // `renotify` from the tag, so a raise here REPLACES the
            // un-answerable notification in its slot rather than stacking a
            // second one under it. It is a second raise, so `pushOne` records
            // a second event in the catch-up ring: the ring is a record of
            // what was raised, and two really were, which is the honest cost
            // of not leaving the question un-answerable.
            //
            // D-5290: the envelope that arrived a tick after the menu is the
            // hold's first chance, so the amendment asks `tryHold` first. Held,
            // the actionless notification is replaced, same tag, by the quiet
            // "with coordinator" body and no buttons, and nothing is raised;
            // released at once (a parent not live, or of another project),
            // `tryHold` has already pushed the answerable payload.
            const outcome = await this.tryHold(r, dialog, actions, recs);
            if (outcome.kind === 'none') {
              raise();
            } else {
              this.actionlessAsks.delete(r.id);
              if (outcome.kind === 'held') {
                this.pushOne({
                  kind: 'ask', sessionId: r.id, project: r.project,
                  title: '❓ Question', body: withCoordinatorBody(outcome.parent),
                }, this.activeProjects);
              }
            }
          }
        }
      } else if (last !== undefined) {
        this.dialogIds.delete(r.id);
        this.actionlessAsks.delete(r.id);
        this.settlingAsks.delete(r.id);
        // Task 8: the dialog went away with nothing to replace it — the
        // operator hit escape at the terminal, or the session was
        // interrupted, cleared, swapped, or died. The pane is the only
        // signal that cannot lie here: `cmd_swap` does not rotate the
        // session uuid, so hookstate's identity gate is blind to a swap and
        // the file still reads `waiting` behind a pane that is gone.
        // `detectDialogs` reads only what is painted, which is why
        // staleness rides THIS branch and not the hookstate.
        //
        // Also closes the clear-then-remint gap: the orphan-settle above
        // (`last !== dialog.id`) only fires when a NEW dialog silently
        // replaces a live one — it is gated on `last !== undefined` at
        // REMINT time, so a dialog that clears first (dropping `last` from
        // `dialogIds`, right here) leaves that guard unable to see a
        // different dialog minted later on the same session. Settling the
        // held ask on the way out, in THIS branch, means there is nothing
        // left for that guard to miss.
        // D-5289: a lapsed question whose dialog cleared was acted on (or went
        // away); no late parent answer can land in it, so its notification is final.
        this.lapsedAsks.delete(r.id);
        const held = this.heldAsks.get(r.id);
        if (held !== undefined) {
          // Dropped unconditionally, BEFORE the guarded write below — same
          // shape as the orphan-settle above: a failing `staleAsk` must not
          // leave the entry to be retried (and re-warned about) forever: the
          // in-memory hold is over either way, since the dialog it was
          // minted under is already gone from the pane.
          this.heldAsks.delete(r.id);
          // Guarded: a synchronous `node:sqlite` UPDATE sitting directly on
          // the 2 s poll, and `detectDialogs` is AWAITED by `tick()`, which
          // has no `catch` of its own (`void this.tick()` in the timer) —
          // an unguarded throw here would kill the whole process. Never
          // pushes: a cleared dialog is a question that no longer exists,
          // so there is nothing to notify the operator about.
          try {
            this.deps.coord?.staleAsk(last, r.id, Date.now());
          } catch (err) {
            console.warn(`ccrc-server: settling a cleared ask hold failed for ${r.id} (${err instanceof Error ? err.message : String(err)}) — a held row may remain orphaned in coord.db`);
          }
        }
        this.bus.emit(`session:${r.id}`, { type: 'dialog_cleared' });
      }
    }
    return pending;
  }

  /** Advance a held ask's `askAt` to the child's CURRENT hookstate, but only
   *  where this tick has just proved the menu on screen is unchanged.
   *
   *  Called from the `last === dialog.id` arm of `detectDialogs`, so the
   *  pane witness is already established by the caller; this adds the second
   *  one, `askKey`, from the same tick's hookstate (`this.hookStates` is
   *  rebuilt by `sweepHookStates` immediately before `detectDialogs` — see
   *  the ordering note in `tick()`). Both are handed to `restampAsk`'s CAS
   *  rather than trusted here, so a row that has moved on for any reason
   *  changes zero rows and keeps the `askAt` it had.
   *
   *  Every early return is a REFUSAL TO ADVANCE, which is the fail-shut
   *  direction: no held row, an unreadable or stale hookstate, an ask that
   *  has gone from the envelope, or an envelope `askKey` will not hash — each
   *  leaves the stored `askAt` exactly where it was, so the guard stays as
   *  strict as it was before this method existed.
   *
   *  Guarded, for the same reason its two neighbours in `detectDialogs` are:
   *  a synchronous `node:sqlite` UPDATE sitting directly on the 2 s poll, on
   *  every tick shape rather than a mint edge, where an unguarded throw would
   *  take the whole process down. */
  private restampHeldAsk(id: string, dialogId: string): void {
    const held = this.heldAsks.get(id);
    if (held === undefined) return;
    const hs = this.hookStates.get(id) ?? null;
    if (hs === null || hs.ask === null) return;
    const key = askKey(hs.ask);
    if (key === null) return;
    try {
      this.deps.coord?.restampAsk({
        id: held.askId, dialogId, askKey: key, askAt: hs.updatedAt,
      });
    } catch (err) {
      console.warn(`ccrc-server: re-stamping the ask hold failed for ${id} (${err instanceof Error ? err.message : String(err)}) — a parent answer may refuse ask-moved until the next tick`);
    }
  }

  /** Fire every held ask whose grace window has lapsed. The payload pushed is
   *  the one `hold` snapshotted at mint time, pushed VERBATIM — `detectDialogs`'s
   *  two triggers (`last !== dialog.id`, the amendment branch) are one-shot
   *  edges: `dialogIds`/`actionlessAsks` are stamped on first sighting
   *  regardless of whether a push was actually raised, so there is no second
   *  chance to re-derive the same object later; re-deriving it here would find
   *  nothing to re-raise.
   *
   *  `store.releaseAsk` is the CAS gate: it fires the push only when THIS call
   *  is the one that moved the row `held -> released`. A `false` return means
   *  something else moved the row first, and RULING F9 (task-7-brief) is the
   *  reason this branches on the row's actual state instead of dropping the
   *  `heldAsks` entry unconditionally the moment the CAS fails — the naive
   *  "delete, then consult the result" order (the brief's own Step 3, before
   *  the ruling) drops the deferred push forever whenever a parent is mid-
   *  answer, which is the exact failure this lane exists to prevent:
   *   - `'answering'` — a principal has taken the row and may still submit an
   *     answer. KEEP the map entry so a later sweep can retry once that
   *     resolves; pushing now would buzz the operator over a question someone
   *     is actively answering. BOUNDED (fix round 1, item 1): `sweepAsks` is
   *     the ONLY collector `heldAsks` has (`detectDialogs`'s orphan-settle
   *     fires only on a NEW dialog id, and a session blocked on
   *     `AskUserQuestion` does not repaint), so an unbounded keep here would
   *     let a principal that took the row and never came back — the press
   *     refused, `answerAsk` threw, the request abandoned, a restart
   *     mid-call — strand the question forever, silently. Past
   *     `ASK_ANSWERING_MAX_MS` since first observed `'answering'`, this
   *     degrades exactly like the missing-row arm below: push, drop.
   *   - `'answered'` | `'released'` | `'declined'` | `'stale'` — somebody
   *     already resolved it (an answer landed, an explicit `POST
   *     /api/asks/:id/release`, which is `'declined'` since D-5289, or
   *     `detectDialogs`'s own orphan-settle). Drop the entry, no push — the
   *     question is already closed.
   *   - `'held'` — the CAS above just failed against this exact state, so
   *     under ordinary single-threaded execution this is unreachable; the
   *     only way to see it is a genuine race with another writer between
   *     the `releaseAsk` attempt and this read. KEEP (fix round 1, item 2):
   *     the row is demonstrably still open and unclaimed, so the NEXT
   *     sweep's `releaseAsk` simply succeeds and pushes on its own — dropping
   *     here would both lose the question AND orphan the row, since Task 8's
   *     `staleAsk` (guarded on `heldAsks.get(r.id)`) could then never reach
   *     it either. Warned, not silent — an unreachable branch that fires is
   *     worth knowing about even though it is handled safely.
   *   - `'unknown'` — an out-of-vocabulary state token read back off disk
   *     (`hydrateAsk`'s own degrade). This IS the "cannot tell" case F9's
   *     missing-row arm already rules on: push and drop, warned.
   *   - the row itself is gone (`askById` returns `null`, e.g. a lost
   *     coord.db) — its loss is free BY DESIGN (`heldAsks`'s own docstring):
   *     drop the entry and push, degrading to exactly today's ordinary
   *     immediate-notification behaviour rather than swallowing the question.
   *
   *  PUBLIC so a test can await it directly — `sweepMail`'s own reason:
   *  `tick()` void-dispatches this (it can sit behind whatever `sweepMail`
   *  and every other lane are doing), so a test that only awaits `tick()` has
   *  NOT awaited this sweep. */
  async sweepAsks(): Promise<void> {
    if (!this.primed) return;
    const store = this.deps.coord;
    if (!store) return;
    const now = Date.now();
    if (this.lastAskSweep !== 0 && now - this.lastAskSweep < ASK_SWEEP_MS) return;
    this.lastAskSweep = now;

    // Fail-shut, same discipline as `sweepMail`'s own `MAIL_DISABLED_MARKER`
    // read a few hundred lines up: a registry we cannot list is a kill-switch
    // we cannot read, so `listing === null` ("can't tell") reads as disabled
    // rather than as license to keep holding new asks.
    const listing = await this.deps.io.readdir(this.deps.cfg.registryDir);
    this.asksDisabled = listing === null || listing.includes(ASKS_DISABLED_MARKER);

    if (this.heldAsks.size === 0) return;
    for (const [id, held] of [...this.heldAsks]) {
      if (held.until > now) continue;

      let released: boolean;
      try {
        released = store.releaseAsk(held.askId, now);
      } catch (err) {
        console.warn(`ccrc-server: releaseAsk failed for ask ${held.askId} (session ${id}) (${err instanceof Error ? err.message : String(err)}) — leaving the hold in place to retry next sweep`);
        continue;
      }
      if (released) {
        this.heldAsks.delete(id);
        this.lapsedAsks.set(id, { askId: held.askId, ev: held.ev });
        this.pushOne(held.ev, this.activeProjects);
        continue;
      }

      // Beaten: the CAS did not move the row. Re-check its actual state
      // before touching the map entry — see this method's own docstring and
      // RULING F9.
      let row: AskRow | null;
      try {
        const read = store.askById(held.askId);
        // D-2545: the SAME degrade as the throw arm below — leave the hold in
        // place and retry next sweep. A row this box could not read is not a
        // row that is gone, and `row === null` below fires the push.
        if (!read.ok) {
          console.warn(`ccrc-server: askById refused for ask ${held.askId} (session ${id}) (${read.detail}) — leaving the hold in place to retry next sweep`);
          continue;
        }
        row = read.ask;
      } catch (err) {
        console.warn(`ccrc-server: askById failed for ask ${held.askId} (session ${id}) (${err instanceof Error ? err.message : String(err)}) — leaving the hold in place to retry next sweep`);
        continue;
      }
      if (row === null) {
        this.heldAsks.delete(id);
        this.pushOne(held.ev, this.activeProjects);
        continue;
      }
      switch (row.state) {
        case 'answering': {
          // Bounded (fix round 1, item 1) — see `ASK_ANSWERING_MAX_MS`'s own
          // docstring and this method's own. `answeringSince` is set on the
          // sweep that FIRST observes this row `'answering'`, never
          // re-derived, so the bound is measured from the first sighting,
          // not from whenever `takeAskForAnswer` actually ran.
          if (held.answeringSince === null) held.answeringSince = now;
          if (now - held.answeringSince >= ASK_ANSWERING_MAX_MS) {
            this.heldAsks.delete(id);
            this.pushOne(held.ev, this.activeProjects);
          }
          continue;                    // still under the bound — retry next sweep, no push
        }
        case 'answered':
        case 'released':
        case 'declined':
        case 'stale':
          this.heldAsks.delete(id);    // settled by someone else — no push
          continue;
        case 'held':
          // Unreachable under ordinary single-threaded execution (see this
          // method's own docstring) — a genuine race with another writer,
          // not a defect this sweep can fix. KEEP: the row is demonstrably
          // still open, so the next sweep's `releaseAsk` simply succeeds and
          // pushes on its own; dropping here would orphan the row instead.
          // Reset the answering timer too — a LATER `'answering'` sighting
          // for this same entry is a fresh episode, not a continuation of
          // whatever earlier one (if any) left a stale timestamp behind.
          console.warn(`ccrc-server: sweepAsks saw ask ${held.askId} (session ${id}) unexpectedly still 'held' after a failed release — keeping the hold for the next sweep to resolve`);
          held.answeringSince = null;
          continue;
        case 'unknown':
          // An out-of-vocabulary state token read back off disk
          // (`hydrateAsk`'s own degrade) — the "cannot tell" case F9's
          // missing-row arm already rules on: degrade to notifying the
          // operator rather than swallowing the question.
          console.warn(`ccrc-server: sweepAsks saw ask ${held.askId} (session ${id}) in an unrecognised state after a failed release — pushing and dropping the hold`);
          this.heldAsks.delete(id);
          this.pushOne(held.ev, this.activeProjects);
          continue;
        default: {
          const _exhaustive: never = row.state;
          console.warn(`ccrc-server: sweepAsks saw ask ${held.askId} (session ${id}) in an unrecognised state '${String(_exhaustive)}' after a failed release — pushing and dropping the hold`);
          this.heldAsks.delete(id);
          this.pushOne(held.ev, this.activeProjects);
        }
      }
    }
  }

  /**
   * `POST /api/asks/:id/release` (Task 10, the decline route): a parent has
   * DECLINED to rule on its child's question, so the grace window ends NOW
   * rather than at `held.until` — the verb that makes the window a CEILING
   * rather than a flat tax on every ask the parent cannot rule on. The route
   * has already CAS'd the store row (`store.releaseAsk`) before calling this
   * — this method's whole job is the in-memory half `sweepAsks` above would
   * otherwise wait up to `ASK_SWEEP_MS` to notice on its own: drop the hold
   * and fire the SNAPSHOTTED push immediately, exactly `sweepAsks`'s own
   * `released` branch.
   *
   * PUBLIC, and the ONLY way a route may touch `heldAsks` — the map is
   * watcher-private state (see its own docstring above), so a route has no
   * business reaching into its shape or deleting from it directly. A
   * `childId` with no entry (the grace window already lapsed and `sweepAsks`
   * beat this call to it, a server restart forgot the hold, or this ask was
   * never held by THIS watcher instance) is a no-op: the store row is
   * released either way, and there is no snapshotted `ev` left to push.
   */
  releaseHeldAsk(childId: string): void {
    const held = this.heldAsks.get(childId);
    if (held === undefined) return;
    this.heldAsks.delete(childId);
    this.pushOne(held.ev, this.activeProjects);
  }

  /**
   * D-5289, late answer wins: `POST /api/asks/:id/answer` settled a row it
   * took from `'released'`, so the lapse already notified the operator. Replace
   * that notification under the same tag (`pushOne`'s default
   * `${kind}-${sessionId}`, the lapse's own) with `answeredByBody(parent)`, and
   * no actions: the question is answered, so the lock-screen buttons must go.
   * Only for the lapse this watcher snapshotted for THIS row (`askId`), and
   * once: a restart, a cleared dialog or another row's answer replaces nothing.
   * PUBLIC for the same reason `releaseHeldAsk` is: the route's only door in.
   *
   * A known race, benign: a tick that captures the pane while the route is
   * still awaiting `sendKey` can see the dialog already cleared and drop the
   * `lapsedAsks` entry before this runs, so the operator keeps the lapse's
   * original notification (today's behaviour). Open follow-up, not this
   * method's: a `'released'` row whose dialog clears with nobody answering
   * never moves to `'stale'` (`staleAsk` takes `held`/`answering` only).
   */
  answeredLate(childId: string, askId: number, parent: string): void {
    const lapsed = this.lapsedAsks.get(childId);
    if (lapsed === undefined || lapsed.askId !== askId) return;
    this.lapsedAsks.delete(childId);
    this.pushOne({ ...lapsed.ev, body: answeredByBody(parent), actions: undefined }, this.activeProjects);
  }

  /**
   * D-5290 (coordinator-first routing spec §5.2): THE ONE DECISION every hold
   * goes through — `detectDialogs`' first sighting, its deferred first raise
   * and its amendment branch alike, so the envelope that arrives a tick after
   * the menu is held exactly as one that arrived with it. Answers `none` (raise
   * to the operator as today), `held` (minted `held`, the parent mailed, the
   * operator's push deferred and recorded) or `released` (minted `released`
   * with its reason and the operator pushed on this tick).
   *
   * The checks, in order, each `none` when it fails:
   *  - D-2173: ELIGIBILITY IS `askActions`, and nothing else. Its own contract
   *    is "offer an action only where `answerAsk` would accept it", so every
   *    ask it refuses — an approval, a multi-question envelope, a
   *    multi-select, a free-text ask, a blank label — is one no principal
   *    could answer through this lane. `'questions' in ask` is redundant with
   *    `actions !== null` at runtime; it exists so the compiler knows
   *    `ask.questions[0]` is safe to read inside `hold`.
   *  - the kill switch (`$REG/asks-disabled`, `sweepAsks`).
   *  - THE CHILD MARK (spec §4): the registry row's `ChildMark` is
   *    `{kind: 'child'}`. `none` and `unreadable` never hold: a run can name
   *    any session (`POST /api/runs`, until Task 11b), so `parentOfSession`
   *    alone does not make an operator-created session a child.
   *  - `parentOfSession` answers, the self-claim guard (`parent !== r.id`),
   *    and the parent it answers is the claimant of the run the mark names —
   *    the minting run. Compared by claimant, not by run id: a wave N >= 2 run
   *    resumes the SAME workspace (`dispatch.ts`'s resume arm), whose marker
   *    still names wave 1, and `reclaimProgram` moves every run of a programme
   *    to its heir together, so the claimant is the one fact the binding run
   *    and the minting run share.
   *  Then, past those, the row is minted either way:
   *  - the parent's registry row exists (else `parent-not-live`), is of the
   *    child's project (else `parent-project-mismatch`), is neither archived
   *    nor stopped, and is not measured dead by `claimantMeasuredDead`, the
   *    predicate `sweepDeadCoordinators` reads (else `parent-not-live`).
   *
   * Fix round 1, item 2 (Important): `parentOfSession` and everything `hold`
   * does (`openRunsForSession`, the WRITE `insertAsk`, `queueSystemMail`'s own
   * `tx()`/`BEGIN IMMEDIATE`, plus `hold`'s own throw on a key-derivation
   * drift) reach `node:sqlite` directly, unguarded — and `tick()` is fired as
   * `void this.tick()` with no `unhandledRejection` handler anywhere in this
   * tree, so an unguarded throw here would kill the whole process. ANY FAILURE
   * ANSWERS `none`, so the caller falls back to `raise()`: the lane degrades to
   * today's ordinary immediate push rather than losing the question or the
   * process.
   */
  private async tryHold(
    r: SessionRecord, dialog: Dialog, actions: PushPayload['actions'] | null, recs: readonly SessionRecord[],
  ): Promise<{ kind: 'none' } | { kind: 'held'; parent: string } | { kind: 'released' }> {
    const none = { kind: 'none' } as const;
    const hs = this.hookStates.get(r.id) ?? null;
    const ask = hs?.ask ?? null;
    if (actions === null || hs === null || ask === null || !('questions' in ask)) return none;
    const coord = this.deps.coord;
    if (!coord || this.asksDisabled) return none;
    const mark = r.child;
    if (mark.kind !== 'child') return none;
    try {
      const parent = coord.parentOfSession(r.id);
      if (parent === null || parent === r.id) return none;
      // D-5362: the binding is "the parent is the claimant of the run the
      // mark names", not "the mark names the newest open run": a wave N>=2
      // run resumes the same workspace, whose `.child` still names wave 1.
      const minting = coord.run(mark.runId);
      if (!minting.ok || minting.run === null || minting.run.claimedBy !== parent) return none;
      const row = recs.find((x) => x.id === parent) ?? null;
      let reason: 'parent-not-live' | 'parent-project-mismatch' | null = null;
      if (row === null) reason = 'parent-not-live';
      else if (row.project !== r.project) reason = 'parent-project-mismatch';
      else if (row.archivedAt !== null || row.stopped !== null) reason = 'parent-not-live';
      else if (claimantMeasuredDead(await measureClaimant(
        { coord, io: this.deps.io, cfg: this.deps.cfg, tmux: this.deps.tmux }, parent, Date.now()))) {
        reason = 'parent-not-live';
      }
      const mint = this.hold(r, dialog, actions, hs, ask, parent, reason);
      if (reason !== null) {
        // Released at once: the operator's answerable push fires on THIS
        // tick, never after the window, and no hold is kept for the sweep.
        this.pushOne(mint.ev, this.activeProjects);
        return { kind: 'released' };
      }
      // D-2172: the RECORD is minted now, not at release. `pushOne` returns
      // before `notifyLog.record` when the operator is looking, so suppressing
      // the raise without recording would delete the operator's only durable
      // trace of a question their parent then answered in their name.
      this.pushOne({ ...mint.ev, recordAlways: true, recordOnly: true }, this.activeProjects);
      this.heldAsks.set(r.id, mint);
      return { kind: 'held', parent };
    } catch (err) {
      console.warn(`ccrc-server: ask hold failed for ${r.id} (${err instanceof Error ? err.message : String(err)}) — falling back to an immediate push`);
      // Fix round 2, item 2: `insertAsk` and `queueSystemMail` are SEPARATE
      // transactions inside `hold()` — a throw after the first commits (inside
      // `queueSystemMail`'s own `tx()`, or in `pushOne`/`heldAsks.set` after
      // it) would otherwise leave an ask row `held` with NO `heldAsks` entry:
      // unreachable by Task 7's map-keyed sweep and Task 8's dialog-keyed
      // `staleAsk`, while the fallback `raise()` means the operator gets the
      // push AND a nudged parent may still act on the very question that push
      // just escalated. Settle whatever may have committed — a no-op (0 rows
      // changed) in the common case where nothing did — wrapped so the
      // compensation itself cannot throw OUT of this catch.
      try {
        coord.staleAsk(dialog.id, r.id, Date.now());
      } catch (compErr) {
        console.warn(`ccrc-server: ask hold compensation failed for ${r.id} (${compErr instanceof Error ? compErr.message : String(compErr)}) — a held row may remain orphaned`);
      }
      return none;
    }
  }

  /**
   * Mint the ask row, snapshot the push `raise()` would have sent, and queue
   * the mail that wakes the parent. Called ONLY from `tryHold`, which has
   * already proven `actions !== null` (so `ask` is a single-question envelope
   * with readable labels), the child mark and `parent !== null && parent !==
   * r.id`. With a `releaseReason` (D-5290) the row is minted `released` and no
   * mail is queued; the caller pushes `ev` at once.
   *
   * `ev` is snapshotted here, not re-derived at release (Task 7's
   * `sweepAsks`) or at answer time — nothing persists a tick-local closure
   * past its tick, and `detectDialogs`'s two triggers (`last !== dialog.id`
   * here, the amendment branch above it) are one-shot edges: `dialogIds` is
   * stamped on first sighting whether or not a push was raised, so there is
   * no second chance to re-build the same object later.
   */
  private hold(
    r: SessionRecord, dialog: Dialog, actions: PushPayload['actions'],
    hs: HookState, ask: Extract<HookAsk, { questions: HookAskQuestion[] }>, parent: string,
    releaseReason: 'parent-not-live' | 'parent-project-mismatch' | null,
  ): { until: number; askId: number; ev: Parameters<FleetWatcher['pushOne']>[0]; answeringSince: number | null } {
    const q = ask.questions[0]!;
    const key = askKey(ask);
    // `actions !== null` (askActions) already proved a key exists — this
    // throw is unreachable by construction and exists only so a future
    // drift between `askActions` and `askKey` fails loudly instead of
    // minting a row with a null key.
    if (key === null) throw new Error(`hold: eligible ask on ${r.id} produced no askKey`);
    const options = q.options.map((o) => o.label);
    const now = Date.now();
    // D-5294: the one deadline, read by the sweep (`until`) and stated in the brief.
    const until = askNotifyAt(now);
    // Same run `parentOfSession` derived the parent from — `openRunsForSession`
    // mirrors its `ORDER BY id DESC LIMIT 1` pick via "last of the ASC list",
    // the same idiom `sweepMerged` above already uses. Recorded on the ask
    // row for provenance; the OPERATOR MAIL below deliberately does NOT carry
    // it (see that call's own comment).
    // D-2545. ABORT THE MINT rather than hold a question against a run this
    // box could not read: `hold` is called inside `detectDialogs`' try/catch,
    // which falls back to the EXISTING immediate-operator-push `raise()` —
    // minting no ask row and no parent mail, which is exactly the ruled
    // behaviour. Reached by a typed result rather than by `node:sqlite`'s bare
    // `RangeError`, but landing in the same place on purpose, and it throws
    // BEFORE `insertAsk` so there is nothing to compensate.
    const sib = this.deps.coord!.openRunsForSession(r.id);
    if (!sib.ok) throw new Error(`hold: ${sib.detail}`);
    const openRuns = sib.siblings;
    const runId = openRuns.length > 0 ? openRuns[openRuns.length - 1]!.id : null;
    const askId = this.deps.coord!.insertAsk({
      childId: r.id, parentId: parent, runId, askKey: key, askAt: hs.updatedAt,
      dialogId: dialog.id, question: q.question, options, now,
      ...(releaseReason === null ? {} : { releaseReason }),
    });
    const ev: Parameters<FleetWatcher['pushOne']>[0] = {
      kind: 'ask', sessionId: r.id, project: r.project,
      title: '❓ Question', body: askPushBody(hs, dialog),
      actions,
    };
    // The parent is asleep and nothing else will wake it. Ordinary mail, so
    // the existing idle gating applies unchanged — and the latency does not
    // gate the operator, because the operator's own push is racing this hold
    // on its own clock. The subject is unique BY CONSTRUCTION: mail dedupe is
    // subject-keyed, so a fixed subject would refuse the second ask of the
    // day as a restatement of the first. `runId: null` and `run: null`,
    // deliberately, mirroring `queueProgramKickoff`'s own reasoning: this
    // message is not a wave artifact — it rides the run-less peer-mail lane
    // (bounded by its own quota) rather than a run's lifecycle, and
    // `renderEnvelope` skips the program/wave/waveOf fields whenever `runId`
    // is null, so nothing is lost by not attaching the run we just derived.
    // `askNudgeSubject` (fix round 2, item 3), not a hand-spelled `` `ask:` ``
    // literal: `isAskNudgeMail` in the same module must recognise exactly
    // this shape, and a queue/reader pair spelling one convention twice is
    // the kind of thing that drifts.
    // D-5290: a row minted released mails nobody — its parent is not live, or
    // is not this child's project's, and the operator already has the push.
    if (releaseReason === null) {
      queueSystemMail(this.deps.coord!, null, {
        fromId: 'operator', toId: parent, runId: null, kind: 'question',
        subject: askNudgeSubject(askId), body: renderAskBrief(askId, r.id, q.question, options, until),
      });
    }
    return { until, askId, ev, answeringSince: null };
  }
}

/**
 * The parent's ENTIRE evidentiary surface (design spec §6.1) is this ask row
 * plus its own artifacts — no route, ws feed, or ccd verb lets one session
 * read another's transcript. So this states the child's id, the moment the
 * operator is notified (D-5294), the question and its options in order, the
 * ready-to-run commands a parent may act through, and the lazy role invocation
 * (design spec §4) — this session is that child's parent, and
 * `ccrc-coordinator` is the skill for the job. That sentence is why nothing has
 * to happen at session creation: the role arrives with its first duty.
 *
 * D-5294 (coordinator-first spec §5.4, §6.7):
 * - the deadline is `notifyAt` (`askNotifyAt`, the one computation the sweep
 *   also acts on), printed in UTC, with the late-answer sentence D-5289 makes
 *   true; it counts from the mint (the row's `at`), not the row's `askAt`
 *   (D-5364);
 * - the question and the option labels are the child's text, so they ride
 *   inside `untrustedBlock` and nowhere else; outside it the brief names
 *   options only by index;
 * - the commands (D-5365) are the coordinator skill's own client form
 *   (`wave-lifecycle.md`'s ask lane): `"$API"`, `$id` and `$uuid` are the
 *   names the skill's preamble sets, so the heredoc is UNQUOTED and the shell
 *   expands them into the attribution the route requires. Nothing the child
 *   wrote is inside a heredoc: the ask id and the index are integers this
 *   server minted;
 * - the question is fenced but not yet redacted (D-5366): `redactCommand`
 *   comes from Task 12, and plan Task 16 applies it to the question before
 *   the row stores it and before this brief carries it.
 */
function renderAskBrief(
  askId: number, childId: string, question: string, options: string[], notifyAt: number,
): string {
  const asked = `${question}\n${options.map((label, i) => `  ${i}. ${label}`).join('\n')}`;
  const deadline = new Date(notifyAt).toISOString().slice(11, 19);
  const who = '"fromId":"$id","fromUuid":"$uuid"';
  const answers = options.map((_label, i) =>
    `Option ${i}:\n"$API" asks answer ${askId} --json - <<JSON\n{${who},"optionIndexes":[${i}]}\nJSON\n`).join('');
  return `You are the parent of session \`${childId}\`, which is waiting on a question it cannot answer itself.\n` +
    `The operator is notified at ${deadline} UTC unless you answer or hand over; ` +
    `a later answer still counts until the operator acts.\n\n` +
    `${untrustedBlock(asked, UNTRUSTED_CAP_BYTES, 'on the ask row (`"$API" asks list` shows it while the row is held, not after the lapse)')}\n\n` +
    `Rule from your own artifacts — spec, plan, ledger, branch, your prior rulings — never from the child's ` +
    `reasoning, which you cannot see.\n\n` +
    `Answer with the index of the option you rule for ("$API", $id and $uuid are the ccrc-coordinator skill's):\n` +
    answers +
    `\nDecline (not yours to rule — fires the operator's own notification at once, and is final):\n` +
    `"$API" asks release ${askId} --json - <<JSON\n{${who}}\nJSON\n\n` +
    `Run the ccrc-coordinator skill.`;
}

// ── THE DELEGATION LANE (delegation broker wave 3, Task 13; spec §5.5, §5.12) ──────────────────────────────────────────────────
//
// A SIBLING of `sweepDivergences`, never a branch of it, and never awaited by `tick()`: it reads each live owner's hourly spool
// buckets, ingests them durably (Task 9 into Task 8), correlates the census this watcher ALREADY takes once a minute against the
// retained evidence (Task 11), plans report-only effects (Task 12), applies the durable ones and repairs the SQLite projection
// (Task 7). It keeps the seven-day observation intervals the health is computed from. WAVE 3 IS OBSERVATION ONLY: this lane writes no
// carrier, starts no cleanup clock, mints no token and takes no filesystem action; its only durable writes go through
// `DelegationDurability`, and the policy it applies is closed and non-executable.
//
// L4: it GATHERS (the owner's directory listing and a bounded byte range through `FleetIO`) and it APPLIES; every decision is a
// pure module's (`ingestDelegationBucket`, `correlateDelegation`, `planDelegationReconciliation`, the health arithmetic).
//
//   ONE PASS AT A TIME (M5/M6). `sweeping` is the single-flight latch; a pass that finds another running returns at once, which also
//   keeps two census passes from being reconciled side by side (the newer `measuredAt` only). A pass has a BUDGET enforced by a
//   deadline the work cannot veto: a read that never answers ends the pass, its late answer is discarded (`signal.aborted` is checked
//   after every await before anything is applied), and the next pass is not blocked by it.
//   A DOCUMENTED RELAXATION (M2): a budget cut releases the latch while the cut pass's work may still be unwinding, so "a pass never
//   starts while the previous one runs" holds for a pass that ends and is relaxed for one that is cut. That is deliberate: holding the
//   latch until a hung read answered would wedge the lane for good. The late work is inert because an abort check follows every
//   await before anything is applied, and what it could still have in flight (a durable application already queued) is idempotent:
//   attempts dedupe by ID, events dedupe by `eventId`, and an append-only bucket cannot move a cursor backwards. The stat fallback after a
//   failed range read (`readDelegationBucket`) cannot carry the tick's signal, because `FleetIO.statMeasured` takes no signal and no
//   timeout; the pass deadline race bounds it instead.
//
//   EVERY INGESTION READS THE DURABLE STATE AT THE MOMENT IT INGESTS, after the range read and never from a copy taken before it: a row
//   that moved during the read is a disagreement ingestion reports, not a coordinate this lane overwrites. Cursors move ONLY through
//   ingestion (`applyAccepted`): nothing here rewrites `bucketCursors` through a checkpoint-only change.
//
//   WHAT THE LANE DROPPED (R57, R65, D-4653). The slice of the journal the lane keeps for correlation is bounded, and an eviction is
//   never allowed to decide a link (spec §5.3: a lost event delays or prevents a link, never creates one). Rung 4 reads the HORIZON,
//   the latest `observedAt` among the events the lane evicted, which bounds a listing window. Rungs 2 and 3 cannot be bounded by an
//   instant: an event that is gone is invisible, and the lane's one-event-per-tuple rule hides a tuple's LATER events once its first is
//   evicted. So the lane REMEMBERS what it dropped: at every eviction (the cap, and a reload that truncates the whole journal) it keeps
//   the minimal keys correlation reads (the parent, the agent and run ids the event named, its directory, whether it was a
//   SubagentStart or SubagentStop), de-duplicated, never the event. A tuple's held event stands for the later events of its tuple that
//   the rule hid (their keys are the tuple's own), so recording the holder's eviction records them. Correlation asks the index, by
//   membership, whether a link rests on an event the lane no longer holds (`delegation-correlation.ts`, clauses (a) and (b)).
//   WHERE IT LIVES: LANE MEMORY ONLY: a Map of distinct keys on this class. It adds no file, no
//   SQLite-only state, and writes nothing to the journal; `loadEvidence` rebuilds it from nothing at every reload, exactly as it
//   recomputes the horizon. A LOST INDEX IS NOT AN EMPTY ONE: the index is measured only once `loadEvidence` has streamed the whole
//   retained journal and indexed every event it dropped while doing so; until then (a restart, a recovery, a visit that failed
//   midway) it is UNMEASURED (`DELEGATION_DROPPED_UNMEASURED`), the lane reconciles nothing, and correlation answers
//   `unmeasured('evidence-horizon')` for every link against it (D-4008: unknown is never empty). BOUNDED, AND FORGETFUL ONLY
//   FOR A TREE A MEASURED CENSUS SHOWS GONE (R69 to R71). The lane keeps the last measured canonical path of every tree the census lists
//   (lane memory; after a restart it is seeded from the checkpoint's leases and attempts). A dropped key is forgotten only when no
//   protected path and no asked-about name needs it (`planDelegationDroppedPrune`, which argues why that is sound): a path protects its
//   keys while a census record lists it and while it is the remembered path of a tree that no census of ITS OWN project, measured in
//   this pass, shows gone, so a record whose `gitdir` read failed (a null path), a project with no view this pass and a project missing
//   from the census each keep what they had. The restart is per project: a project not yet measured since the lane started keeps ITS OWN
//   keys (its sessions' and the paths it remembers) while the others prune. A key is stamped with the time of the latest event dropped
//   under it and is forgotten only if that predates the census that prunes it (less the clock skew allowance). A standing refusal
//   holds no tree and counts as measured with none (R70): a refused project name always (the census returns before it reads anything,
//   so no path in it can be a rung-2 or rung-3 candidate, which is always a census record); `not-a-checkout` only after it has recurred
//   on three consecutive census passes spanning ten minutes (R71), because `gitref.ts` names a residual in which one dropped round trip
//   reads as that answer. The keys are pruned as the journal streams (every 4,096 new ones) and at a reconcile after a batch.
//
//   A FORGOTTEN VETO IS PROVED GONE OR MARKED (R73, D-4653). A key is forgotten only if a census of its project, measured in this pass,
//   shows every tree it could veto gone, or it is replaced by a COARSER mark that still moves every link it could have vetoed to
//   `unmeasured('evidence-horizon')`: so a tree the lane does not know (an unseeded tree after a restart, a project with no live session)
//   loses nothing to a prune. A project that lists a TRANSIENT null-path record it has no path for holds its own keys back, per project,
//   for a streak of three censuses over ten minutes (`LANE_NULL_PATH` decides transient from standing; a standing null path never holds
//   anything back). A held-back project over `DELEGATION_PROJECT_HOLD_CAP` keys is lost. Lane memory only, like the index: no file, no
//   SQLite-only state, the journal untouched. What sets and what clears each mark (R73, R74, R75):
//     - PATH MARKS (64-bit hashes of directories, `DELEGATION_MARK_CAP` across all of them). Set by a prune that forgets a key at a
//       directory no tree shown gone by THAT census, and no lost project's remembered tree, had (a SubagentStart or SubagentStop leaves
//       none). Kept per project they are attributed to (`delegationMarkProjectOf`: the nearest listed or remembered tree, else the
//       project's own checkout under the projects root), and apart for none. Cleared ONLY by a restart (or a recovery): its
//       `loadEvidence` re-indexes the complete journal (wave 3 never compacts it) against what the census then lists, so a tree listed
//       with its path keeps its keys and its path is not marked again. A census alone never clears one: it cannot show what the forgotten
//       events said. Dropped, with the rest of its project's, when that project is lost (its prefixes, below, keep what it guarded).
//       The projects root the attribution reads is RESOLVED (N20), through `FleetIO.realpath` on the box that holds it, at every pass;
//       a root that does not resolve attributes nothing by the root (the nearest-tree rule still applies) until a later pass resolves
//       it, so no mark is attributed by a spelling git does not report (coordinator 5439: unmeasured, never a guess).
//     - LOST-PROJECT PREFIXES (R77, N19; the directories that attributed path marks to a project: the nearest tree's path, or the
//       project's checkout under the resolved projects root). Recorded with each mark the project is given, set as a COVER when that
//       project is lost (by rule 3 or at a cap): every tree at or under one answers `unmeasured('evidence-horizon')` at rungs 2 and 3,
//       whatever repository it belongs to, so a mark that guarded another repository's tree nested inside the lost project's checkout or
//       tree keeps its veto. Cleared only by a restart's load. Bounded by the trees and checkouts that attributed a mark since the load
//       (`DELEGATION_MARK_CAP` of them in all; past it the global flag rises).
//     - UNKNOWN-REPOSITORY WINDOWS (I-1; not marks in the index, but counted beside them). A rung-4 listing window of a session whose
//       project this process cannot name (no registry row and no live session has named it since the lane started: a reclaimed child,
//       a forgotten session, after a restart) is kept with a null repository, and rung 4 treats it as on every repository: a
//       candidate it overlaps is `unresolved`, and an open-ended or early one keeps the horizon test from linking. Set at every
//       reconcile from the slice; cleared when a registry row or a live session names the session's project again, or when the window's
//       events leave the slice (the evidence horizon then bounds it, the natural bound). Lane memory: the slice and the session map.
//     - ID MARKS (64-bit hashes of agent and run ids; attributed to no project, since an id names none). Set by a prune that forgets a
//       key naming an id nobody asks about yet (a name made redundant by its own parent's activity row is exact and leaves none). Cleared
//       only by a restart: by then the id is asked about, so the load keeps the key itself.
//     - LOST PROJECTS (at most one per project). Set when a held-back project holds more than its cap of keys (R73 rule 3), or when a mark
//       set reaches its cap and the project holds the most path marks (R75): its marks are dropped, its project mark covers every
//       tree of it, and its prefixes cover every tree under them. Cleared only by a restart whose load measures the project.
//     - THE GLOBAL LOSSY FLAG. Set only when the marks attributed to no project fill a set by themselves (R75: every attributed project is
//       lost first, biggest first, until the set is under its cap). Cleared only by a restart whose re-index fits under the cap. In wave 3
//       the journal never shrinks, so once it holds more unattributed forgettable directories (or row-less ids) than the cap, every
//       restart raises the flag again and no rung-2 or rung-3 link is made: wave 4's journal compaction is what makes marks finite.
//   THE LIVENESS ANSWER (R74), stated: a mark set for a tree that stays alive keeps that tree's rung-2 and rung-3 links
//   `unmeasured('evidence-horizon')` until the next restart (no re-read: re-reading the journal holds the applier queue for longer than
//   a pass at 30 days). A tree that stays alive and invisible past every restart is never decided, which is the intended answer. So
//   every verdict a mark changed is COUNTED, by kind (`delegationMarkForced`; a verdict two marks cover goes to the first of flag, project,
//   prefix, path, id; then an unknown-repository window, `delegationUnknownWindowForced`), apart from every other `unmeasured` reason:
//   per tree and kind, cumulatively since the last hourly warn line, which prints and resets them and also names the held-back projects
//   (with their key counts), the lost projects and the flag, and never a path.
//
//   THE READ HORIZON AND CURSOR RETENTION (R58, D-4654). The lane reads no bucket older than the spool lookback, and decides that in
//   ONE place (`delegationBucketReadable`), for a live owner's listing and for a dead owner's unclosed hour alike. Bucket cursors retire
//   behind that horizon through `DelegationDurability.pruneBucketCursors` (under the applier's lock, on its own rows, never on this
//   lane's copy), at most once per UTC hour and only when the planner has something to drop; that is safe only because nothing past the
//   read horizon is ever read again.
//
//   ONE DURABLE APPLICATION PER PASS (D-4658, ruling R79). Every application rewrites the whole checkpoint and re-projects it, which is
//   linear in all-time activities, so the bucket results of a pass are STAGED and applied together (`stage`, `flushPass`): one journal
//   append run, one checkpoint replacement, one projection, in O5's order. Lane memory only (the pass's own list); no file. ONE REFUSED
//   BUCKET NEVER STOPS THE PASS (R82): a refusal before the first byte is isolated by bisection and costs that bucket alone, exactly as
//   unbatched; a failure after the first byte still fails the applier closed and stops the pass (`flushPass`).
//
//   NO-OP SKIP (hand-off 2). A bucket result that accepts nothing, leaves the cursor row as it was and would not change the hour's
//   interval stages NOTHING, and a pass that staged nothing makes no durable call. The one exception is the CLOSE WRITE: once an hour
//   has ended (plus the hook's margin) it is written one more time, so that its record postdates its close and the lane can tell, after
//   a restart, an hour it saw whole from one it only saw begin.
//
//   THE INTERVALS. Each observed (session, incarnation, UTC hour) has one checkpoint-owned `measured` or `unmeasured` row; unmeasured
//   is sticky. A session whose spool directory does not exist (a pane older than the spool code, D-4651), a capability the fleet does
//   not offer, an unreadable directory or range, malformed evidence and a parent whose incarnation is unmeasured are each an
//   UNMEASURED hour, never a measured-empty one. Only a listing that SUCCEEDED and does not name the bucket is an empty hour. Between
//   two unmeasured words in one hour a LOSS word displaces a CARVE-OUT word (`directory-absent`, `capability-absent`), and a carve-out
//   word never displaces a loss word (R90): the checkpoint's merge holds that, and the no-op skip re-stages a loss over a carve-out.
//
//   THE LANE NEVER LINKS ACROSS A STRETCH IT KNOWS IT DID NOT READ (W1, coordinator 5512; R88, R89). Lane memory only, both:
//     - THE LATEST READY INSTANT (R88, `readyAt`). Set by the first pass of a process that reaches the owners, and again by the first
//       pass to reach them after the lane was found NOT READY (no census, no applier, or an applier not `ready` or failed; and R103, a
//       registry `tick()` could not list, which stops the tick before the census and this lane; R109, a pass cut before the owners,
//       which listed no one; and R116, a recovery the lane started that has not SETTLED, returned or thrown: while it runs, its
//       projection repair after `recover()` already reports `ready` included, a pass reads no owner, reconciles nothing and sets no
//       instant): to the settle of the last recovery the lane started (`recoveredAt`, the in-process one, R112, R116), whichever pass
//       started it, or else to the instant the pass's applier answered (`appliedAt`, R113), which covers the BOOT recovery `open()`
//       makes, for the pass that started the open and for a later one awaiting the cached applier alike (R117); and never earlier than
//       the setting pass's own clock, whatever the wall clock does (one clamp for both arms: R115 for the appliedAt arm, R120 for the
//       recoveredAt arm). (Measuring after the await carries the clock-skew allowance from the settle: that covers a call made during
//       the recovery by a hook clock running ahead of the server's. When the clocks agree, the pass budget (45 s) keeps a recovery
//       whose pass is not cut inside the skew (60 s), unless a starved event loop fires the budget timer late; a recovery whose pass
//       was cut runs on past the budget, and its settle covers that too.) (No census and no applier can only be found before a
//       process's first ready pass: the census is never unset and the applier is cached once opened; they stay as defence.) Correlation
//       gets one lost window from the epoch to it plus the clock skew on every repository (`delegationNotReadyWindowOf`, R104): a
//       stretch's start cannot be measured, so every rung-4 candidate whose creator began at or before it is held, and through X1 so is
//       a rung-3 link whose creator bracket reaches back to it. Cleared by nothing; only a later ready instant moves it, and a restart
//       starts again from none.
//     - THE OWNERS A PASS LISTED (R89, `pendingOwners`). Every owner a census lists is remembered, with the hours it was listed in, until
//       one observation of it COMPLETES in a pass that was not cut AND what it read is DURABLE (R101: after the pass's flush, which did
//       not fail past its first byte and refused none of its buckets): so a pass cut before it reaches an owner, or whose read is lost
//       at the flush, leaves that owner to a later pass, live or not, whatever the next census says. An owner the last pass listed and
//       this one does not is pending again (R102), so its last lines are read once more after it ends. A pass forgets nothing of an owner a
//       NEWER pass has listed or re-pended (R107, the `listedBy` stamp): a cut pass's late flush can land after it. Until it is read its listed hours,
//       and its measured hours not yet closed (R106), are lost windows. An hour that leaves the read horizon before the owner is read is
//       STAGED as a gap with a LOSS word (`hour-never-closed`, never a carve-out word) for the pass's flush, and leaves the memory as it is staged;
//       the owner is forgotten once it has no listed hour left: so the memory is bounded by the read horizon (and `lastListed` by the live
//       sessions). A failed flush is covered by the next recovery's not-ready window; an R82 pre-write refusal of that gap's own bucket
//       would drop it unrecorded, and nothing known produces one.
//
//   REPORT-ONLY EFFECTS. Attempts are made durable through one checkpoint-only change BEFORE any lease is journaled (so the next pass
//   sees them), then each lease request goes through `createLease` (which deduplicates on the identity key, so a request re-emitted
//   after a crash is a no-op), then the projection is repaired. Measured absence has no durable field in wave 3 (a checkpoint-only
//   change cannot alter a lease, and wave 3 never releases one): it is remembered in memory, once per tree.

/** The census's own cadence, derived and not respelled: the lane adds no faster read of anything. */
export const DELEGATION_SWEEP_MS = DIVERGENCE_SWEEP_MS;
/** What a pass may spend: under the cadence, so a stuck pass ends before the next is due. */
export const DELEGATION_PASS_BUDGET_MS = 45_000;
/** What one read of the lane may take (the stat fallback after a failed range read included: it is bounded by the pass signal). */
const DELEGATION_READ_TIMEOUT_MS = 10_000;
/** A recovery that failed is tried again no more often than this: it reads the whole journal. */
const DELEGATION_RECOVERY_RETRY_MS = 5 * 60_000;
/** M-1: a reconcile older than three census cadences no longer vouches for its counts (the breaker reads unmeasured). */
const DELEGATION_STALE_RECONCILE_MS = 3 * DELEGATION_SWEEP_MS;
/** The evidence the lane keeps for correlation, newest. Evicting the oldest makes a verdict less decided (`evidence-horizon`), never
 *  more: the horizon of what was evicted is handed to correlation, which will not link on evidence an eviction could have emptied. */
const DELEGATION_EVIDENCE_CAP = 20_000;
/** The dropped-evidence keys are pruned each time this many new ones have been collected, while `loadEvidence` streams the journal and at
 *  a reconcile, so a long journal cannot hold every key it ever dropped at once and a busy fleet does not pay a prune every pass (R65: the
 *  peak is this many plus what survives). */
const DELEGATION_DROPPED_PRUNE_EVERY = 4096;
/** R71: a project's `not-a-checkout` answer is trusted as a STANDING fact only after it has recurred on this many consecutive census
 *  passes spanning at least this long; any other answer for the project resets the streak. `gitref.ts` names the residual: one dropped
 *  round trip that lands on one stat and not its neighbour reads as that answer. The streak counts only the censuses the lane NOTES (at a
 *  load and at a reconcile): a good answer in a census the lane never reconciled (a pass cut before its reconcile) does not reset it. The
 *  ten-minute span still holds, so that costs at most a streak that ends one census early, never one pass that forgets a path.
 *  R73 rule 1 bounds the transient null-path hold with the same streak. */
const DELEGATION_STANDING_PASSES = 3;
const DELEGATION_STANDING_SPAN_MS = 10 * 60_000;
/**
 * R73 rule 3: the most dropped keys a held-back project (not measured since the start, or listing a transient null-path record it has no
 * path for) may keep. Past it the project is LOST: its keys go through the prune with their marks, and every tree of it answers
 * `unmeasured('evidence-horizon')` at rungs 2 and 3 until a restart. It equals the evidence slice's own cap, so a held-back project
 * never holds more than the slice itself does; at the 30-day fixture's traffic a project carrying a tenth of it holds 18,710 keys at 30
 * days and reaches the cap at about 32, which is where the round-3 hold (rising without a ceiling) is now cut.
 */
const DELEGATION_PROJECT_HOLD_CAP = DELEGATION_EVIDENCE_CAP;
/**
 * R73 rule 2, R75: the most 64-bit hashes the path marks (all projects' together) and the id marks each hold: 3/4 of 2^20 slot pairs, so
 * a set never exceeds 8 MB (`delegationHashSetAdd` grows it by doubling, from 16 KB). THE BOUND IS A COUNT OF DISTINCT DIRECTORIES, NOT
 * A CALENDAR: a restart re-indexes the journal, and wave 3 never compacts it, so the path marks hold the distinct directories the whole
 * journal ever forgot without a census showing their tree gone. Measured at a restart's load over the 30-day fixture (20 sessions; each a
 * day 60 subagents, each in its own tree and two directories under it, and 40 fresh directories of its own): 121,199 path marks a month
 * (about 4,040 a day), every one under a project's checkout, so attributed. At the cap the project holding the most marks is lost (its
 * trees answer `unmeasured` until a restart) and its marks are dropped, again until the set is under the cap: at the fixture's rate the
 * first project goes in about 195 days, at ten times that rate in about 20. The GLOBAL flag rises only when unattributed marks alone
 * fill the set: never, at the fixture; were each session's 40 own directories a day outside every checkout and tree (measured: 747
 * unattributed marks a day), in about 1,050 days at its rate and 105 at ten times it. The flag is on the warn line and in the report.
 */
const DELEGATION_MARK_CAP = 786_432;
/**
 * R73 rule 1: what a census record whose canonical path is null says about that path, by its diagnostic words, as a TOTAL table over
 * them (a new word is a compile error until it is placed). `standing` names a path that will not read differently next time (a
 * relative or malformed `gitdir`, a name the census refuses): such a record never holds anything back, because a null path is never a
 * rung-2 or rung-3 candidate, and if it is ever repaired the path marks of the keys forgotten meanwhile catch it. `transient` names a read
 * that may do better (a failed `gitdir` read, a record being born). `other` is about something else than the path. A null path with no
 * `standing` word is transient, whatever else it carries: unknown resolves toward holding, never toward forgetting.
 */
const LANE_NULL_PATH: Readonly<Record<DelegationCensusDiagnostic, 'standing' | 'transient' | 'other'>> = {
  'gitdir-absent': 'transient', 'gitdir-unreadable': 'transient', 'gitdir-malformed': 'standing', 'gitdir-relative': 'standing',
  'head-absent': 'other', 'head-unreadable': 'other', 'head-malformed': 'other',
  'first-log-unreadable': 'other', 'first-log-malformed': 'other',
  'claude-base-malformed': 'other', 'claude-base-unreadable': 'other',
  'lock-unreadable': 'other', 'name-refused': 'standing', 'record-initializing': 'transient',
};
const laneNullPathStanding = (diagnostic: string | null): boolean =>
  (diagnostic ?? '').split(',').some((w) => Object.prototype.hasOwnProperty.call(LANE_NULL_PATH, w) && LANE_NULL_PATH[w as DelegationCensusDiagnostic] === 'standing');
/** What a failed census read means for pruning, as a TOTAL table over the read's reasons (a new reason is a compile error until it is
 *  placed): `always` is a project that can never be censused (the name is refused before anything is read), `streak` is a standing
 *  fact only once it has recurred (R71), `never` is a read that may do better next time. */
const LANE_READ_REFUSAL: Readonly<Record<Extract<WorktreeRead, { ok: false }>['reason'], 'always' | 'streak' | 'never'>> = {
  'refused-project': 'always', 'not-a-checkout': 'streak', unlistable: 'never', unreachable: 'never',
};
/** A tree seen for the first time may be a ccd workspace being BORN: two reconciliation passes of waiting (spec §5.4, rung 1). */
const DELEGATION_BIRTH_PASSES = 2;
/** How long a first-measured-dead instant is remembered: far past the breaker's ten-minute window. */
const DELEGATION_DEAD_MEMORY_MS = 60 * 60_000;
/** Rung 2's point lookups (spec §5.4: "a point lookup, never a search ... back-filled at a bounded rate"): at most this many meta
 *  files are read in a pass, and a tree that gave no meta is not asked again for this long. */
const DELEGATION_META_READS_PER_PASS = 8;
const DELEGATION_META_RETRY_MS = 5 * 60_000;
/** A workflow's meta directory is read for at most this many entries, and a meta file for at most this many characters. */
const DELEGATION_META_DIR_ENTRIES = 64;
const DELEGATION_META_MAX_CHARS = 65_536;

/** Test seams of the lane: production passes none. `evidenceCap` scales the evidence slice so an eviction can be provoked with a handful
 *  of events; `readEveryListedBucket` bypasses the read horizon and the settled/closed filters, so the second line of defence
 *  (eventId idempotence against the retained journal) can be pinned; `reconcileBeforeLoad` lets a pass reconcile although the evidence
 *  load did not complete, so the second layer of the lost-index condition (the index handed to correlation is unmeasured) can be pinned.
 *  `projectHoldCap` and `markCap` scale R73's two bounds down to a handful of keys. */
export interface DelegationLaneSeams {
  evidenceCap?: number; readEveryListedBucket?: boolean; droppedPruneEvery?: number; reconcileBeforeLoad?: boolean;
  projectHoldCap?: number; markCap?: number;
  /** D-4658: apply each bucket result at once, as before the batching (the reference an "equal to an unbatched run" row compares with). */
  unbatched?: boolean;
}

type LaneSession = Pick<FleetSession, 'id' | 'project' | 'status'>;
type LaneRecord = Pick<SessionRecord, 'id' | 'project' | 'child'>;
type DelegationVerdictCounts = { unresolved: number; conflicting: number; unmeasured: number };

type LanePointMeta = DelegationCorrelationInput['pointMetas'][number];
/** What a rung-2 lookup for one tree came to: a meta was found; it was asked and gave nothing; or the pass's budget ran out first. */
type LaneMetaOutcome = 'found' | 'missed' | 'unasked';
/** The retained evidence indexed ONCE per reconcile (M5), so a tree's lookup is a map read and not a scan of the slice. */
interface LaneEvidenceIndex {
  /** agent ID -> the first event of each parent that names it and carries its transcript path. */
  claimants: Map<string, Map<string, { event: DelegationEventEnvelopeV1; journalId: string }>>;
  /** run ID -> its first Workflow launch response, with the transcript directory it names. */
  launches: Map<string, { event: DelegationEventEnvelopeV1; journalId: string; dir: string }>;
}
/** One owner to observe in a pass. `incarnation: null` is a parent whose incarnation could not be measured (`reason` says why).
 *  `listedHours` are the hours (ms) a pass listed it in and no completed observation has covered yet, inside the read horizon (R89). */
interface LaneOwner { id: string; incarnation: string | null; reason: string; live: boolean; listedHours: readonly number[] }
/** R89: an owner a pass LISTED from the census, and the hours (ms) it was listed in, until one observation of it completes. */
interface LanePendingOwner {
  id: string; incarnation: string | null; reason: string; hours: Set<number>;
  /** R107 (re-review N1): the sequence of the last pass that LISTED it alive or re-pended it (R102). A pass forgets only an owner no
   *  newer pass has listed: a cut pass's late flush must not erase a later pass's listing of the same hour (the hours are one set). */
  listedBy: number;
}
/** An owner's identity in a pass and in the pending memory: (id, incarnation or null). */
const laneOwnerKey = (id: string, incarnation: string | null): string => JSON.stringify([id, incarnation]);
/** The detail of an hour whose parent's incarnation could not be measured. */
const laneIncarnationGap = (reason: string): string => `incarnation-unmeasured: the parent's registry incarnation is ${reason}`;
/** R90: whether an UNMEASURED result with `next` as its detail changes a stored UNMEASURED row with `prior`: only a loss word arriving over
 *  a carve-out word does (the checkpoint's merge keeps the loss either way). */
const laneLossOverCarveOut = (prior: string | null, next: string | null): boolean => isDelegationHourCarveOut(prior) && !isDelegationHourCarveOut(next);
/** One staged bucket result (D-4658, R82). */
interface LaneStaged { batch: DelegationDurableBatch; key: string; label: string }
interface LanePass {
  now: number;
  signal: AbortSignal;
  census: DelegationCensusPass;
  sessions: readonly LaneSession[];
  records: readonly LaneRecord[];
  capability: DelegationHealthInput['capabilityState'];
  /** D-4658: every bucket's durable batch this pass staged, applied together by `flushPass`, each with its hour's settle key (the
   *  bucket's identity for R82's isolation) and a label for its warn line. */
  pending: LaneStaged[];
  /** Hours to remember as settled once the pass's application is durable (never before: a failed one leaves them to be read again). */
  settle: string[];
  /** R101: the owners whose observation COMPLETED in this pass before any cut. Each leaves the pending memory only once what it staged
   *  is durable (`forgetRead`, after the flush), never when the observation merely returns. */
  completed: LaneOwner[];
  /** R107: this pass's sequence (the lane counts the passes it starts), stamped on every owner it lists or re-pends. */
  seq: number;
  /** R109 (re-review N3): set, synchronously, once the pass is past its last check before the owners; a pass cut before it listed nothing. */
  reachedOwners: boolean;
}

const laneTreeKey = delegationTreeKey;
/** `YYYYMMDDHH`, the bucket name of an hour. */
const laneBucketOf = (hourMs: number): string => formatDelegationInstant(hourMs).replace(/[-:T]/g, '').slice(0, 10);
const laneHourOf = (ms: number): number => Math.floor(ms / DELEGATION_HOUR_MS) * DELEGATION_HOUR_MS;
const laneCloseAt = (hourMs: number): number => hourMs + DELEGATION_HOUR_MS + DELEGATION_HOUR_CLOSE_MARGIN_MS;
const laneInstantMs = (iso: string): number | null => {
  try { return parseDelegationInstant(iso); } catch (err) { if (err instanceof DelegationModelError) return null; throw err; }
};

/** The census, flat: every project whose delegation census was a MEASURED success contributes its records, each (project, adminRecord)
 *  once. A project whose view was null is left OUT of `censused` and contributes nothing: an empty list would read as "every tree is gone"
 *  (hand-off 12), so a caller that prunes by project name does so only when `allMeasured`: every project is censused or a standing refusal. */
function laneFlatCensus(census: DelegationCensusPass, standing: ReadonlySet<string>): { censused: string[]; flat: DelegationCensusRecord[]; held: Set<string>; allMeasured: boolean } {
  const censused: string[] = [];
  const flat: DelegationCensusRecord[] = [];
  const held = new Set<string>();
  for (const [project, view] of census.projects) {
    if (view.delegation === null) continue;
    censused.push(project);
    for (const r of view.delegation) {
      const k = laneTreeKey(r.project, r.adminRecord);
      if (held.has(k)) continue;
      held.add(k);
      flat.push(r);
    }
  }
  // A standing refusal holds no tree: it counts as measured (R70), or one `not-a-checkout` project would stop every prune for ever.
  return { censused, flat, held, allMeasured: [...census.projects.keys()].every((p) => censused.includes(p) || standing.has(p)) };
}

/** The per-kind sets of trees a mark held back, empty: every kind of `DelegationMarkKind`, spelt once. */
const laneNoForced = (): Record<DelegationMarkKind, Set<string>> =>
  ({ path: new Set(), id: new Set(), project: new Set(), lossy: new Set(), prefix: new Set(), window: new Set() });

/** X1: a tree's first sighting as correlation reads it (canonical instants; `after` null when unknown). */
const laneSightingOf = (s: { after: number | null; at: number }): DelegationCorrelationInput['firstSighting'] =>
  ({ after: s.after === null ? null : formatDelegationInstant(s.after), at: formatDelegationInstant(s.at) });

/** A cursor row nobody needs to store: the state of a bucket with nothing read from it. */
const laneFreshCursor = (c: DelegationBucketCursor): boolean =>
  c.cursor === 0 && c.lastSize === 0 && c.anchor === null && !c.replaced && c.lastCompleteAt === null;

/**
 * The listing windows (rung 4) the retained evidence holds: a Bash call whose PreToolUse carries a `listing` (the admin records
 * before) paired by `toolUseId` with its PostToolUse listing (after). The window's `repository` is the census's own project key, taken
 * from the REGISTRY row of the session that ran the call: rung 4 compares it with the census record's `project` verbatim, so both
 * sides are built from the one key (hand-off 7).
 *
 * A SESSION NO REGISTRY ROW HAS NAMED KEEPS ITS WINDOWS, with an UNKNOWN repository (`null`; final review I-1). Dropping them would drop
 * negative evidence: after a restart the lane knows a session's project only from what this process has seen, so a session whose row is
 * gone (a reclaimed child, a forgotten session) would lose its overlap veto and rung 4 would link the other session. A null-repository
 * window is never a candidate, and rung 4 treats it as on every repository (`delegation-correlation.ts`), so it can only move a verdict
 * toward unresolved or unmeasured. It is rebuilt at every reconcile from the evidence slice and the session map, both lane memory (the
 * slice itself is rebuilt from the journal at a load): no file, no SQLite-only state.
 *
 * A SHED LISTING IS A LOST WINDOW (2c, R84). The hook spells a listing it dropped to fit the line as `truncated: true` with no `listing`
 * (and a line already truncated for another field never attempts one), so a Bash PreToolUse or PostToolUse that is truncated and carries
 * no listing may have lost one. A shed PreToolUse makes a window from its own instant to its PostToolUse's (whatever that carries), or
 * open-ended; a shed PostToolUse makes its PreToolUse's window LOST and ENDS it at its own instant (an unbounded window would veto every
 * later call). A lost window's listings mean nothing. A PostToolUse with neither a listing nor `truncated` cannot say whether it lost one
 * (a command without the token, or a listing the hook could not read), so it leaves its window open-ended, as before, and a call with
 * neither on both ends makes no window at all.
 *
 * THE LISTED REPOSITORY (2c d, R84). `listedOf`, when handed over, attributes a working directory to the repository whose admin records
 * the hook listed there (the lane: the nearest tree it lists or remembers, else its RESOLVED projects root). A window whose two ends'
 * directories are attributed alike carries that repository; one whose directory is absent, unattributed or disagrees between its ends
 * carries null: every repository. Without `listedOf` the field is absent, and only `repository` is read.
 */
export function delegationListingWindowsOf(
  evidence: Iterable<DelegationEventEnvelopeV1>, projectOf: (sessionId: string) => string | undefined,
  listedOf?: (cwd: string) => string | null,
): DelegationListingWindow[] {
  type BashPre = DelegationEventEnvelopeV1 & { eventKind: 'PreToolUse'; toolName: 'Bash' };
  type BashPost = DelegationEventEnvelopeV1 & { eventKind: 'PostToolUse'; toolName: 'Bash' };
  const pre = new Map<string, BashPre>();
  const post = new Map<string, BashPost>();
  const keyOf = (e: DelegationEventEnvelopeV1 & { toolUseId: string }): string => JSON.stringify([e.sessionId, e.parentIncarnation, e.toolUseId]);
  /** A listing, or a line that may have shed one. */
  const listingOrShed = (e: { listing?: readonly string[]; truncated?: true }): boolean => e.listing !== undefined || e.truncated === true;
  for (const e of evidence) {
    if (e.eventKind === 'PreToolUse' && e.toolName === 'Bash' && listingOrShed(e)) pre.set(keyOf(e), e);
    else if (e.eventKind === 'PostToolUse' && e.toolName === 'Bash' && listingOrShed(e)) post.set(keyOf(e), e);
  }
  const listedAt = (cwd: string | undefined): string | null => (listedOf === undefined || cwd === undefined || cwd === '' ? null : listedOf(cwd));
  const out: DelegationListingWindow[] = [];
  for (const [key, start] of pre) {
    const repository = projectOf(start.sessionId) ?? null;
    const end = post.get(key);
    const lost = start.listing === undefined || (end !== undefined && end.listing === undefined);
    let listedRepository: string | null | undefined;
    if (listedOf !== undefined) {
      const first = listedAt(start.cwd);
      listedRepository = end === undefined || (first !== null && listedAt(end.cwd) === first) ? first : null;
    }
    out.push({
      sessionId: start.sessionId, parentIncarnation: start.parentIncarnation, toolUseId: start.toolUseId, repository,
      ...(listedRepository === undefined ? {} : { listedRepository }), ...(lost ? { lost: true as const } : {}),
      startedAt: start.observedAt, endedAt: end === undefined ? null : end.observedAt, before: start.listing ?? [],
      after: lost || end === undefined || end.listing === undefined ? null : end.listing,
    });
  }
  return out;
}

// The two unmeasured-hour words that do NOT veto a link (R84, the carve-out) are `DELEGATION_HOUR_NO_SPOOL` and
// `DELEGATION_HOUR_NO_CAPABILITY`, defined once in the model (R90), which the reader's own vocabulary is built from, and imported.
/** The detail head ingestion gives a bucket whose last bytes are a line that may still complete (`delegation-ingest.ts`, step 9). */
const LANE_TORN_TAIL = 'torn-tail:';

/** One LOST hour of one owner as a listing window (2c, R84): on every repository, naming no call, from the hour's start to one hour and
 *  one margin later (a call that began in the hour may have ended up to the margin after it). An hour that cannot be placed (null) is a
 *  window over all of time: it fails SAFE. Pure. */
function delegationLostHourWindow(sessionId: string, parentIncarnation: string, hourMs: number | null): DelegationListingWindow {
  return {
    sessionId, parentIncarnation, toolUseId: '', repository: null, lost: true,
    startedAt: formatDelegationInstant(hourMs ?? 0),
    endedAt: hourMs === null ? null : formatDelegationInstant(hourMs + DELEGATION_HOUR_MS + DELEGATION_EVIDENCE_MARGIN_MS), before: [], after: null,
  };
}

/**
 * R88 (W1 a; coordinator 5512): the stretch the lane was NOT READY for, as ONE lost window on every repository, from the epoch to the
 * lane's LATEST READY INSTANT. While the lane is down, in recovery, without a census or without an applier, it lists no owner, so a
 * session born and gone in that stretch is never read; and the start of such a stretch cannot be measured (a restart remembers
 * nothing of the process before it). So every candidate whose creator began at or before the ready instant is held, on every
 * repository, and an in-process recovery moves the instant (the lane's own memory, `DelegationLane.readyAt`: no durable fact bounds the
 * window). R104 (review F4): the ready instant is the SERVER's clock and a call's start is the FLEET's (`observedAt`), so the window
 * ends `DELEGATION_CLOCK_SKEW_MS` after it, as X1 widens the same comparison: a fleet clock AHEAD of the server's stamps a call made
 * before the ready instant up to the skew after it. A null instant (no ready pass yet) is an OPEN-ENDED window from the epoch, which
 * vetoes everything: it fails safe, and it is never reached, since the lane reconciles only after a pass has set the instant. Pure.
 */
export function delegationNotReadyWindowOf(readyAtMs: number | null): DelegationListingWindow {
  return {
    sessionId: '', parentIncarnation: '', toolUseId: '', repository: null, lost: true,
    startedAt: formatDelegationInstant(0), endedAt: readyAtMs === null ? null : formatDelegationInstant(readyAtMs + DELEGATION_CLOCK_SKEW_MS), before: [], after: null,
  };
}

/**
 * The windows the CHECKPOINT says the lane lost (2c, R84; coordinator 5477, 5484): every one is lost (`lost: true`), names no call (an
 * empty `toolUseId`), and is on EVERY repository (`repository: null`), because what an unread hour held cannot be told. Pure.
 *   - AN UNMEASURED HOUR of a session (a vanished bucket, an unreadable range, a refused or over-long line, an unmeasured incarnation, an
 *     hour that never closed): a window from the hour's start to one hour and one margin later, since a call that began in the hour may
 *     have ended up to the margin after it. THE CARVE-OUT (R84, ruled narrowly): an hour whose detail begins `capability-absent` never
 *     vetoes (fleet-wide, it captured nothing, and rung 4 then has no window either); one whose detail begins `directory-absent` vetoes
 *     only for an owner that HAD a spool: a cursor row (the lane read a bucket of it), or a measured hour (the lane listed its
 *     directory). An owner with neither never had a spool, by construction: the no-spool class carried to the operator, across which
 *     rung 4 links. (The measured-hour arm outlives the cursor rows, which retire at 48 hours: a spool that existed and vanished is
 *     still seen for the interval rows' 192.)
 *   - A TORN TAIL: a bucket whose last bytes are a line that may never complete. Its hour is MEASURED, so it is read from the cursor row's
 *     detail while the cursor lives, and from the measured hour's detail (written by the same application) after it retires.
 *   - THE RETENTION FLOOR: one window from the epoch to the oldest hour the checkpoint still keeps, plus a margin, so a candidate a lost
 *     hour vetoed does not link once that hour's row is pruned (192 hours), and a tree whose first sighting is unknown (a restart) meets
 *     lost evidence by construction.
 * An hour or a bucket name that cannot be placed fails SAFE: a window over all of time.
 */
export function delegationLostWindowsOf(
  intervals: readonly DeepReadonly<DelegationObservationInterval>[], cursors: readonly DeepReadonly<DelegationBucketCursor>[], nowMs: number,
): DelegationListingWindow[] {
  const hadSpool = new Set<string>();
  for (const c of cursors) hadSpool.add(c.sessionId);
  for (const r of intervals) if (r.state === 'measured') hadSpool.add(r.sessionId);
  const out: DelegationListingWindow[] = [];
  const seen = new Set<string>();
  const add = (sessionId: string, parentIncarnation: string, hourMs: number | null): void => {
    const id = JSON.stringify([sessionId, parentIncarnation, hourMs]);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(delegationLostHourWindow(sessionId, parentIncarnation, hourMs));
  };
  for (const r of intervals) {
    const detail = r.detail ?? '';
    const lost = r.state === 'unmeasured'
      ? !detail.startsWith(DELEGATION_HOUR_NO_CAPABILITY) && (!detail.startsWith(DELEGATION_HOUR_NO_SPOOL) || hadSpool.has(r.sessionId))
      : detail.startsWith(LANE_TORN_TAIL);
    if (lost) add(r.sessionId, r.parentIncarnation, laneInstantMs(r.utcHour));
  }
  for (const c of cursors) if ((c.detail ?? '').startsWith(LANE_TORN_TAIL)) add(c.sessionId, c.parentIncarnation, delegationBucketHourMs(c.bucket));
  const keepFrom = laneHourOf(nowMs) - DELEGATION_INTERVAL_RETENTION_HOURS * DELEGATION_HOUR_MS;
  out.push({
    sessionId: '', parentIncarnation: '', toolUseId: '', repository: null, lost: true,
    startedAt: formatDelegationInstant(0), endedAt: formatDelegationInstant(keepFrom + DELEGATION_EVIDENCE_MARGIN_MS), before: [], after: null,
  });
  return out;
}

class DelegationLane {
  private durable: DelegationDurability | null = null;
  private opening: Promise<DelegationDurability | null> | null = null;
  /** The lane has tried to open the applier: from then on a health is reported (absence before that reads as unknown). */
  private attempted = false;
  private sweeping = false;
  private lastSweepAt = 0;
  private lastRecoverAt = 0;
  private registryListed = true;
  /** Hours already read after they closed, this process: not read again. Memory only; a restart reads each once more. */
  private readonly settled = new Set<string>();
  /** R82: the buckets (by settle key) whose result the applier refused before writing anything: applied alone on later passes, so a
   *  standing refusal costs one small application a pass. Lane memory, this process only (no file, no SQLite); a bucket leaves it when
   *  its result applies, or when its hour passes the read horizon (R85, A-F4: it is never staged again), so it is bounded by the buckets
   *  the lane can still read. */
  private readonly refusedBuckets = new Set<string>();
  private passes = 0;
  /** R107: the sequence of the last pass this lane started (each pass takes the next one). */
  private passSeq = 0;
  private skipped = 0;
  /** R88 (W1 a): the LATEST READY INSTANT (epoch ms), or null before the first pass of this process reached the owners. Lane memory
   *  only: no durable fact bounds it, and a restart starts from none. */
  private readyAt: number | null = null;
  /** R88: a pass found the lane not ready since `readyAt` was set (a fresh process starts so): the next pass to reach the owners sets it. */
  private notReady = true;
  /** R116 (review 556 W1): a recovery this lane started (`run()`'s `await durable.recover()`, its one caller) has not settled. Set just
   *  before that await and cleared in its `finally`, so it clears whether the recovery returned or threw. While it is set the lane is NOT
   *  READY: a pass reads no owner, reconciles nothing and sets no instant, even once `recover()` already reports `ready` and only its
   *  projection repair (`repairLocked`) is still running. Lane memory only. */
  private recovering = false;
  /** R112, R116: the instant (epoch ms) the last recovery this lane started SETTLED (returned or threw), measured in that await's
   *  `finally`; null once an instant has consumed it. A LANE field, not the recovering pass's own: in W1's order the pass that recovered
   *  is cut, and the pass that sets the instant is a later one. Measured after the await, so the clock-skew allowance runs from the
   *  settle, which covers a call made during the recovery by a hook clock running ahead of the server's. When the clocks agree, the pass
   *  budget (45 s) keeps a recovery whose pass is not cut inside the skew (60 s), unless a starved event loop fires the budget timer
   *  late; a recovery whose pass was cut runs on past the budget, and its settle covers that too. Overwritten by each settle, so it is
   *  the LAST recovery's. Lane memory only. */
  private recoveredAt: number | null = null;
  /** R89 (W1 b): the owners a pass LISTED and no completed observation has read since, by `laneOwnerKey`. Lane memory only; bounded by the
   *  read horizon (an hour past it is recorded as a gap and leaves, and an owner with no hour left leaves with it). */
  private readonly pendingOwners = new Map<string, LanePendingOwner>();
  /** R102: the owners the last pass to reach the owners LISTED alive, with the hour it listed them in. One the next pass does not list is
   *  pending again, so it is read once more after it goes. Lane memory only; bounded by the live sessions. */
  private lastListed = new Map<string, { id: string; incarnation: string | null; reason: string; hourMs: number }>();
  // evidence for correlation
  private readonly evidence = new Map<string, { event: DelegationEventEnvelopeV1; key: string | null }>();
  private readonly evidenceKeys = new Map<string, string>();
  /** R57: the latest `observedAt` (epoch ms) among events evicted from `evidence`; null while none was. Only ever rises, and is
   *  recomputed from nothing at every reload from the journal. */
  private evidenceHorizonMs: number | null = null;
  /** R65: the DISTINCT keys of every event this lane no longer holds, by key id. Lane memory only: no file, no SQLite state, no journal
   *  write. Rebuilt from nothing by `loadEvidence`; measured only while `evidenceLoaded` (see `droppedIndex`). */
  private readonly dropped = new Map<string, { key: DelegationDroppedKey; at: number }>();
  /** The latest observed time (ms) of any event of a held tuple, the hidden tuple-mates included, so a key's stamp is not earlier than a
   *  hidden mate. Deleted with the tuple's held event. */
  private readonly tupleLatest = new Map<string, number>();
  /** R69: the last MEASURED canonical path of each tree the census listed, by tree key. Lane memory, lost at a restart and then seeded
   *  from the checkpoint's leases and attempts. A tree leaves it only when a measured census of its own project shows it gone. */
  private readonly knownPaths = new Map<string, string>();
  /** Projects whose delegation census has been MEASURED since this lane started. */
  private readonly measuredProjects = new Set<string>();
  /** R71: the current run of consecutive `not-a-checkout` answers, per project. */
  private readonly notCheckout = new Map<string, { firstAt: number; lastAt: number; passes: number }>();
  /** R73 rule 1: the current run of consecutive censuses in which a project listed a transient null-path record it has no path for. */
  private readonly unplaced = new Map<string, { firstAt: number; lastAt: number; passes: number }>();
  /** The paths of the trees the census measured at `measuredAt` showed gone (forgotten from `knownPaths` already): a key at one of them is
   *  forgotten against THAT census with no path mark. */
  private gone: { measuredAt: number; paths: Set<string> } = { measuredAt: Number.NaN, paths: new Set() };
  /** R73: the lossy marks (lane memory, like the index; see the lane's docstring for what sets and clears each). The path marks are kept
   *  per project they are attributed to (R75), and apart for none. */
  private pathsByProject = new Map<string, DelegationHashSet>();
  private unattributedPaths: DelegationHashSet = emptyDelegationHashSet();
  private markIds: DelegationHashSet = emptyDelegationHashSet();
  private readonly lostProjects = new Set<string>();
  /** R77: per project, the directories that attributed a path mark to it since the last load; a COVER only once the project is lost. */
  private prefixesByProject = new Map<string, Set<string>>();
  private prefixCount = 0;
  private lossy = false;
  /** N20: the projects root as RESOLVED this pass (`FleetIO.realpath`), or `DELEGATION_ROOT_UNMEASURED` until a pass resolves it. */
  private projectsRoot: DelegationProjectsRoot = DELEGATION_ROOT_UNMEASURED;
  /** The projects the last prune held back, and how many keys each holds. */
  private heldBack: ReadonlyMap<string, number> = new Map();
  /** How many verdicts of the last reconcile each kind of mark changed (a gauge, for the report). */
  private markForced: Record<DelegationMarkKind, number> = { path: 0, id: 0, project: 0, lossy: 0, prefix: 0, window: 0 };
  /** N16: the trees (by tree key) each kind of mark held back, cumulatively since the last hourly warn line, which prints and resets them. */
  private forcedSinceLine: Record<DelegationMarkKind, Set<string>> = laneNoForced();
  /** 2c (R84): how many verdicts of the last reconcile LOST evidence held back from a link (a shed listing, an unmeasured hour, a lost
   *  creator; `delegationLostEvidenceForced`), a gauge, and the trees it held since the last hourly line, which prints and resets them.
   *  Counted apart from every mark kind. Lane memory only. */
  private lostForced = 0;
  private lostSinceLine = new Set<string>();
  private lastMarkWarnHour = -1;
  private droppedIndexCache: DelegationDroppedEvidence | null = null;
  /** New keys since the last prune, and the most keys held at once since the last load began (a report figure: the bound is real). */
  private droppedAdded = 0;
  private droppedPeak = 0;
  private seams: DelegationLaneSeams = {};
  private lastPruneHour = -1;
  private cursorsPruned = 0;
  private warnedUnparseableCursors = false;
  private evidenceLoaded = false;
  private evidenceLoading: Promise<void> | null = null;
  private readonly sessionProject = new Map<string, string>();
  // reconciliation memory
  private reconciledAt = 0;
  private reconciliations = 0;
  private firstSeen = new Map<string, number>();
  /** X1 (R84; coordinator 5484, condition 3): per tree, the census instant (ms) that first listed it (`at`) and the latest earlier census of
   *  its project, which did not (`after`; null when this process measured none: a restart lost it, and a lost first-sighting instant is not
   *  an empty one). Kept like `knownPaths`: a tree leaves it only when a census of its own project, measured in a reconcile, does not list
   *  it; a project whose view was null keeps its trees' sightings. Lane memory only: no file, no SQLite-only state. A tree first listed
   *  before a restart therefore reads `after: null` for as long as it stays listed; its instant is measured again only if it leaves a
   *  measured census and is listed anew. */
  private sighted = new Map<string, { after: number | null; at: number }>();
  /** The census instant (ms) of the last reconcile that MEASURED each project, for the next new tree's `after`. Bounded by the projects. */
  private censusedAt = new Map<string, number>();
  private previous: { flat: readonly DelegationCensusRecord[]; projects: readonly string[] } | null = null;
  private verdicts: DelegationVerdictCounts = { unresolved: 0, conflicting: 0, unmeasured: 0 };
  private reconciled = false;
  /** When (the pass's clock) the last reconcile completed: the breaker vouches for the counts only while it is recent (M-1). */
  private reconciledWallMs = 0;
  private readonly absences = new Map<string, { project: string; adminRecord: string; observedAt: string }>();
  private lastAlive = new Set<string>();
  private aliveSeen = false;
  private readonly firstDead = new Map<string, number>();
  /** Rung 2's positive meta reads (a point lookup in the parent's own transcript tree), kept for the process: a meta is read evidence,
   *  not journal evidence, so it is never durable and is read again after a restart. */
  private readonly pointMetas = new Map<string, LanePointMeta>();
  private readonly metaMiss = new Map<string, number>();

  constructor(private readonly deps: Deps, private readonly census: () => DelegationCensusPass | null) {}

  /** R103 (review F3): an unlistable registry stops `tick()` before the census and before this lane's pass (its fail-shut return), so
   *  nothing is listed while it lasts: it is "no census", and marks the lane NOT READY. The first pass after it sets the ready instant. */
  noteRegistry(listed: boolean): void {
    this.registryListed = listed;
    if (!listed) this.notReady = true;
  }

  setSeams(seams: DelegationLaneSeams): void { this.seams = seams; }

  /** Closes the applier's journal descriptor, if it was ever opened (tests, and a clean shutdown). */
  async close(): Promise<void> {
    await this.opening?.catch(() => undefined);
    await this.durable?.close();
  }

  private evidenceHorizon(): string | null {
    return this.evidenceHorizonMs === null ? null : formatDelegationInstant(this.evidenceHorizonMs);
  }

  /** What correlation is handed about the events this lane dropped. UNMEASURED until `loadEvidence` has read the whole retained journal
   *  (`evidenceLoaded` IS the measured state): an index that was lost, or never built, is not an empty one. */
  private droppedIndex(): DelegationDroppedEvidence {
    if (!this.evidenceLoaded) return DELEGATION_DROPPED_UNMEASURED;
    this.droppedIndexCache ??= indexDelegationDropped([...this.dropped.values()].map((e) => e.key), {
      lossy: this.lossy, projects: new Set(this.lostProjects), prefixes: this.lostPrefixes(),
      paths: [this.unattributedPaths, ...this.pathsByProject.values()], ids: this.markIds,
    });
    return this.droppedIndexCache;
  }

  /** R77: the cover of the lost projects: every prefix that attributed a mark to one of them. */
  private lostPrefixes(): Set<string> {
    const out = new Set<string>();
    for (const project of this.lostProjects) for (const p of this.prefixesByProject.get(project) ?? []) out.add(p);
    return out;
  }

  /** R73: forgets every mark, because the load that follows rebuilds them from the complete journal (a restart, a recovery). */
  private resetMarks(): void {
    this.pathsByProject = new Map();
    this.unattributedPaths = emptyDelegationHashSet();
    this.markIds = emptyDelegationHashSet();
    this.lostProjects.clear();
    this.prefixesByProject = new Map();
    this.prefixCount = 0;
    this.lossy = false;
    this.heldBack = new Map();
    this.droppedIndexCache = null;
  }

  private pathMarkCount(): number {
    let n = this.unattributedPaths.size;
    for (const s of this.pathsByProject.values()) n += s.size;
    return n;
  }

  /** A project is lost: its project mark covers every tree of it, so its path marks are dropped (R73 rule 3, R75). */
  private loseProject(project: string): void {
    this.lostProjects.add(project);
    this.pathsByProject.delete(project);
  }

  /**
   * R75: records one path mark. Under a lost project, or with the global flag up, it is covered already. At the cap the project holding
   * the most path marks is lost first (biggest first, again until there is room), and the ONE global flag rises only when the marks
   * attributed to no project fill the cap by themselves. R77: the prefix that attributed the mark is recorded FIRST, whatever happens to
   * the mark, so a project lost now or later covers it (a mark skipped because its project is already lost is covered by that prefix).
   */
  private markPath(path: string, project: string | null, prefix: string | null, cap: number): void {
    if (project !== null && prefix !== null) this.notePrefix(project, prefix, cap);
    if (this.lossy || (project !== null && this.lostProjects.has(project))) return;
    const set = project === null ? this.unattributedPaths : this.pathsByProject.get(project) ?? emptyDelegationHashSet();
    if (delegationHashSetHas(set, path)) return;
    while (this.pathMarkCount() >= cap) {
      let biggest: string | null = null;
      for (const [p, s] of this.pathsByProject) if (s.size > 0 && (biggest === null || s.size > this.pathsByProject.get(biggest)!.size)) biggest = p;
      if (biggest === null) { this.lossy = true; return; }
      this.loseProject(biggest);
      if (biggest === project) return;
    }
    delegationHashSetAdd(set, path, Number.POSITIVE_INFINITY);
    if (project !== null) this.pathsByProject.set(project, set);
  }

  /** R77: one more directory that attributed a mark to `project`. Bounded with the marks: past `cap` of them the global flag rises. */
  private notePrefix(project: string, prefix: string, cap: number): void {
    const set = this.prefixesByProject.get(project) ?? new Set<string>();
    if (set.has(prefix)) return;
    if (this.prefixCount >= cap) { this.lossy = true; return; }
    set.add(prefix);
    this.prefixesByProject.set(project, set);
    this.prefixCount += 1;
    if (this.lostProjects.has(project)) this.droppedIndexCache = null;
  }

  /** A record whose path is null for a transient reason, and which has no remembered path (R73 rule 1). */
  private unplacedRecord(r: DelegationCensusRecord): boolean {
    return r.state !== 'absent' && r.canonicalPath === null && !laneNullPathStanding(r.diagnostic) && !this.knownPaths.has(laneTreeKey(r.project, r.adminRecord));
  }

  /** The lane no longer holds this event: keep the keys correlation reads of it, stamped with the time of the latest event dropped
   *  under them (outside their identity). */
  private noteDropped(event: DelegationEventEnvelopeV1, at: number): void {
    const key = delegationDroppedKeyOf(event);
    const id = delegationDroppedKeyId(key);
    const have = this.dropped.get(id);
    if (have !== undefined) { have.at = Math.max(have.at, at); return; }
    this.dropped.set(id, { key, at });
    this.droppedIndexCache = null;
    this.droppedAdded += 1;
    this.droppedPeak = Math.max(this.droppedPeak, this.dropped.size);
  }

  /** What this census says, remembered: the `not-a-checkout` streak (R71), the projects measured since this lane started, and the last
   *  measured path of every tree it lists. Idempotent for one census (a streak counts a census once). */
  private noteCensus(census: DelegationCensusPass): void {
    for (const [project, view] of census.projects) {
      const notCheckout = view.delegation === null && !view.read.ok && view.read.reason === 'not-a-checkout';
      const run = this.notCheckout.get(project);
      if (!notCheckout) this.notCheckout.delete(project);
      else if (run === undefined) this.notCheckout.set(project, { firstAt: census.measuredAt, lastAt: census.measuredAt, passes: 1 });
      else if (census.measuredAt > run.lastAt) { run.lastAt = census.measuredAt; run.passes += 1; }
      if (view.delegation !== null) {
        this.measuredProjects.add(project);
        for (const r of view.delegation) if (r.state !== 'absent' && r.canonicalPath !== null) this.knownPaths.set(laneTreeKey(r.project, r.adminRecord), r.canonicalPath);
      }
      // R73 rule 1: the run of censuses listing a transient null-path record with no remembered path. Anything else resets it.
      const unplaced = view.delegation !== null && view.delegation.some((r) => this.unplacedRecord(r));
      const held = this.unplaced.get(project);
      if (!unplaced) this.unplaced.delete(project);
      else if (held === undefined) this.unplaced.set(project, { firstAt: census.measuredAt, lastAt: census.measuredAt, passes: 1 });
      else if (census.measuredAt > held.lastAt) { held.lastAt = census.measuredAt; held.passes += 1; }
    }
    for (const project of [...this.notCheckout.keys()]) if (!census.projects.has(project)) this.notCheckout.delete(project);
    for (const project of [...this.unplaced.keys()]) if (!census.projects.has(project)) this.unplaced.delete(project);
  }

  /** The projects that hold no tree the lane could decide, for pruning (R70): a refused name; and `not-a-checkout` once it has recurred
   *  on enough consecutive passes (R71). A transient null (`unlistable`, `unreachable`) is not one. */
  private standingProjects(census: DelegationCensusPass): Set<string> {
    const out = new Set<string>();
    for (const [project, view] of census.projects) {
      if (view.delegation !== null || view.read.ok) continue;
      const how = LANE_READ_REFUSAL[view.read.reason];
      const run = this.notCheckout.get(project);
      if (how === 'always') out.add(project);
      else if (how === 'streak' && run !== undefined && run.passes >= DELEGATION_STANDING_PASSES && run.lastAt - run.firstAt >= DELEGATION_STANDING_SPAN_MS) out.add(project);
    }
    return out;
  }

  private pruneProjects(census: DelegationCensusPass): Map<string, DelegationPruneProject> {
    const standing = this.standingProjects(census);
    return new Map([...census.projects].map(([project, view]) => {
      // R73 rule 1: held back while the streak has not run its course (no run on file for a census that lists one: held, the safe side).
      const run = this.unplaced.get(project);
      const settled = run !== undefined && run.passes >= DELEGATION_STANDING_PASSES && run.lastAt - run.firstAt >= DELEGATION_STANDING_SPAN_MS;
      const unplacedHold = view.delegation !== null && view.delegation.some((r) => this.unplacedRecord(r)) && !settled;
      return [project, {
        records: view.delegation, standing: standing.has(project), measuredSinceStart: this.measuredProjects.has(project), unplacedHold,
      }] as const;
    }));
  }

  /** Forgets the remembered path of every tree a measured census of its own project shows gone, keeping the paths for the prunes against
   *  that same census (a key at one of them is forgotten with no path mark). */
  private forgetGoneTrees(census: DelegationCensusPass): void {
    if (this.gone.measuredAt !== census.measuredAt) this.gone = { measuredAt: census.measuredAt, paths: new Set() };
    for (const k of delegationGoneTrees(this.knownPaths, this.pruneProjects(census))) {
      const path = this.knownPaths.get(k);
      if (path !== undefined) this.gone.paths.add(path);
      this.knownPaths.delete(k);
    }
  }

  /** Forgets the dropped-evidence keys `planDelegationDroppedPrune` lets go, after recording the marks that stand for them (R73: both in
   *  this one synchronous step, so no index is ever built between them). At a set's cap the biggest project is lost first (R75); the global
   *  flag rises only for marks no project can carry (path marks attributed to none, and id marks, since an id names no project). */
  private pruneDropped(census: DelegationCensusPass, activities: DelegationCheckpointV1['activities']): void {
    const plan = planDelegationDroppedPrune({
      keys: [...this.dropped].map(([id, e]) => [id, e.key, e.at] as const), projects: this.pruneProjects(census), known: this.knownPaths,
      gonePaths: this.gone.measuredAt === census.measuredAt ? this.gone.paths : new Set(),
      projectOfParent: (parentId) => this.sessionProject.get(parentId), activities, measuredAtMs: census.measuredAt,
      lost: this.lostProjects, holdCap: this.seams.projectHoldCap ?? DELEGATION_PROJECT_HOLD_CAP, projectsRoot: this.projectsRoot,
    });
    this.droppedAdded = 0;
    this.heldBack = plan.held;
    const cap = this.seams.markCap ?? DELEGATION_MARK_CAP;
    for (const project of plan.lose) this.loseProject(project);
    for (const m of plan.markPaths) this.markPath(m.path, m.project, m.prefix, cap);
    for (const id of plan.markIds) if (!this.lossy && !delegationHashSetAdd(this.markIds, id, cap)) this.lossy = true;
    for (const id of plan.forget) this.dropped.delete(id);
    if (plan.forget.length > 0 || plan.lose.length > 0 || plan.markPaths.length > 0 || plan.markIds.length > 0) this.droppedIndexCache = null;
  }

  report() {
    return {
      passes: this.passes, reconciliations: this.reconciliations, skippedApplications: this.skipped,
      verdicts: { ...this.verdicts }, absences: [...this.absences.values()], breaker: this.breakerNow(Date.now()),
      evidenceEvents: this.evidence.size, evidenceHorizon: this.evidenceHorizon(), cursorsPruned: this.cursorsPruned,
      metaMisses: this.metaMiss.size, pointMetas: this.pointMetas.size,
      droppedEvidence: { measured: this.evidenceLoaded, keys: this.dropped.size, peak: this.droppedPeak }, knownTrees: this.knownPaths.size,
      marks: {
        paths: this.pathMarkCount(), unattributedPaths: this.unattributedPaths.size, ids: this.markIds.size,
        lostProjects: [...this.lostProjects].sort(), lostPrefixes: this.lostPrefixes().size, lossy: this.lossy, heldBack: Object.fromEntries(this.heldBack),
        forced: { ...this.markForced },
        forcedSinceLine: Object.fromEntries(Object.entries(this.forcedSinceLine).map(([k, v]) => [k, v.size])) as Record<DelegationMarkKind, number>,
      },
      projectsRoot: this.projectsRoot === null ? 'none' : typeof this.projectsRoot === 'string' ? 'resolved' : 'unmeasured',
      lostEvidence: { forced: this.lostForced, sinceLine: this.lostSinceLine.size }, refusedBuckets: this.refusedBuckets.size,
    };
  }

  /** The applier, opened once. A recovery that FAILED is still an applier (it reports `failure()` and refuses to apply); only an IO
   *  error that stopped the open itself leaves none, and the next pass tries again. */
  applier(): Promise<DelegationDurability | null> {
    if (this.opening === null) {
      const coord = this.deps.coord;
      this.opening = (async (): Promise<DelegationDurability | null> => {
        try {
          const d = await DelegationDurability.open({
            dir: this.deps.cfg.ccrcDir,
            projection: coord === undefined ? null : {
              project: (cp) => coord.projectDelegationCheckpoint(cp),
              insertEvents: (rows) => coord.insertDelegationEvents(rows),
              eventStats: () => coord.delegationEventStats(),
            },
            now: () => Date.now(), randomUUID: () => randomUUID(), warn: (m) => console.warn(m),
          });
          this.durable = d;
          this.lastRecoverAt = Date.now();                                // open() has just recovered: a retry waits its interval
          return d;
        } catch (err) {
          console.warn(`ccrc-server: the delegation applier could not be opened: ${err instanceof Error ? err.message : String(err)}`);
          this.opening = null;
          return null;
        } finally {
          this.attempted = true;
        }
      })();
    }
    return this.opening;
  }

  // ── the health, as of the request ──────────────────────────────────────────────────────────────────────────────────────

  private firstDeadParents(): { parentId: string; firstMeasuredDeadAt: string }[] {
    return [...this.firstDead].map(([parentId, ms]) => ({ parentId, firstMeasuredDeadAt: formatDelegationInstant(ms) }));
  }

  /**
   * The breaker, which is what vouches for the verdict counts (M3). UNMEASURED until a census has been reconciled, and again from the
   * moment the applier is found not ready or failed (final review M-1: the counts of an earlier pass are not this state's). That also
   * covers a failed evidence load: a load runs after a reconcile only through a recovery, which has already unreconciled, and the lane
   * reconciles nothing until a load completes. And once the last reconcile is older than `DELEGATION_STALE_RECONCILE_MS` (a lane that
   * stopped reconciling, for any reason, no longer vouches for what it last counted).
   */
  private breakerNow(nowMs: number): DelegationHealthInput['circuitBreaker'] {
    if (!this.reconciled || nowMs - this.reconciledWallMs > DELEGATION_STALE_RECONCILE_MS) return 'unmeasured';
    return delegationCircuitBreaker({ now: formatDelegationInstant(nowMs), registryReadable: this.registryListed, firstDeadParents: this.firstDeadParents() });
  }

  /**
   * THE VERDICT COUNTS ARE UNKNOWN WHILE THE BREAKER IS UNMEASURED (M3). `unresolved`, `conflicting` and `unmeasured` are plain numbers
   * on the wire, so "not measured yet" cannot be said by them; it is said by `circuitBreaker`. Until the lane has reconciled a census
   * (a fresh start, an evidence read that keeps failing, a recovery that has not finished), from the moment the applier is found failed,
   * and once its last reconcile is three cadences old (M-1), the breaker reads `unmeasured` and the counts read 0, and a reader must
   * treat them as UNKNOWN, never as "no unowned work". Only a measured breaker vouches for the counts.
   *
   * From the checkpoint's own intervals and the measurements the server holds NOW (the fleet's capability, the registry, the breaker);
   *  never from SQLite. Absent until the lane has tried to open its applier. */
  health(): DelegationObservationHealth | undefined {
    if (!this.attempted) return undefined;
    const now = Date.now();
    const breaker = this.breakerNow(now);
    const health = delegationObservationHealthOf(delegationHealthInputOf({
      nowMs: now, state: this.durable === null ? null : this.durable.state(),
      capabilityState: delegationCapabilityState(this.deps.fleetState?.ccdVerbs), registryReadable: this.registryListed,
      // M3, M-1: while the breaker is unmeasured the counts are unknown, and read 0 (never an earlier pass's numbers).
      circuitBreaker: breaker, verdictCounts: breaker === 'unmeasured' ? { unresolved: 0, conflicting: 0, unmeasured: 0 } : this.verdicts,
    }));
    // A torn journal tail this process healed (D-4655) rides on the member as a plain fact. It is not an input to any gate: a heal is
    // never a failure, never makes the health unhealthy, and never makes it unmeasured by itself.
    const healed = this.durable === null ? null : this.durable.lastTailHeal();
    // MUST 1: a quarantine that could not be listed is said, never read as "no heal".
    const unlisted = this.durable !== null && this.durable.tailQuarantineUnmeasured();
    return { ...health, ...(healed === null ? {} : { lastTailHeal: healed }), ...(unlisted ? { tailQuarantineUnmeasured: true as const } : {}) };
  }

  // ── a pass ────────────────────────────────────────────────────────────────────────────────────────────────────────────

  async sweep(sessions: readonly LaneSession[], records: readonly LaneRecord[]): Promise<void> {
    if (this.deps.coord === undefined) return;                           // no coordination database, no lane
    if (this.sweeping) return;                                           // SINGLE FLIGHT (M5/M6)
    const now = Date.now();
    if (this.lastSweepAt !== 0 && now - this.lastSweepAt < DELEGATION_SWEEP_MS) return;
    const census = this.census();
    if (census === null) {                                               // no census yet: wait, and keep the cadence unspent
      this.notReady = true;                                              // R88: nothing is listed, so nothing is read
      return;
    }
    this.sweeping = true;
    this.lastSweepAt = now;
    const ac = new AbortController();
    const cut = new Promise<'cut'>((resolve) => { ac.signal.addEventListener('abort', () => resolve('cut'), { once: true }); });
    const timer = setTimeout(() => ac.abort(), DELEGATION_PASS_BUDGET_MS);
    timer.unref();
    const pass: LanePass = {
      now, signal: ac.signal, census, sessions, records, capability: delegationCapabilityState(this.deps.fleetState?.ccdVerbs), pending: [], settle: [], completed: [],
      seq: ++this.passSeq, reachedOwners: false,
    };
    const work = this.run(pass).then(() => 'done' as const);
    work.catch(() => undefined);                                         // a late rejection of a cut pass is not an unhandled one
    try {
      const outcome = await Promise.race([work, cut]);
      if (outcome === 'cut') {
        console.warn(`ccrc-server: a delegation pass outran its ${DELEGATION_PASS_BUDGET_MS} ms budget and was cut; its late answers are discarded`);
        // R109 (re-review N3): cut before the owners (in the projects-root resolution or the evidence load), it listed no one: the lane is
        // NOT READY, at once, so the next pass to reach the owners moves the ready instant past a session only this pass's census named.
        if (!pass.reachedOwners) this.notReady = true;
      }
    } catch (err) {
      console.warn(`ccrc-server: a delegation pass failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
      ac.abort();                                                        // whatever outlives the pass finds its signal aborted
      this.sweeping = false;
    }
  }

  private async run(pass: LanePass): Promise<void> {
    this.noteSessions(pass);
    const durable = await this.applier();
    /** R113 (review 544 P2): when the applier answered, so the boot recovery `open()` makes is covered like an in-process one (R112): for
     *  the pass that started the open, and for a later pass awaiting the cached applier after the first was cut (R117), because the
     *  cached promise resolves only after `open()` recovered. Measured after the await for the reason on `recoveredAt`. The wall clock
     *  can step back during the await, so this can be earlier than `pass.now`: the instant below clamps it (R115). */
    const appliedAt = Date.now();
    if (durable === null) {
      this.notReady = true;                                            // R88: no applier, nothing is read
      return;
    }
    if (this.recovering) { this.notReady = true; return; }             // R116 (W1): a recovery the lane started has not settled: not ready
    if (pass.signal.aborted) return;
    if (durable.state().phase !== 'ready' || durable.failure() !== null) {
      this.notReady = true;                                            // R88: in recovery, or failed: what happens now is not read
      this.unreconcile();                                              // M-1: what was counted is not this state's
      // A recovery that failed applies NOTHING and reads nothing: the files are left exactly as they are. It is tried again, rarely.
      if (pass.now - this.lastRecoverAt < DELEGATION_RECOVERY_RETRY_MS) return;
      this.lastRecoverAt = pass.now;
      this.recovering = true;                                          // R116: until it settles, every pass is not ready
      try {
        await durable.recover();
      } finally {
        this.recovering = false;                                       // R116: settled, returned or thrown
        this.recoveredAt = Date.now();                                 // R112, R116: the settle, for whichever pass sets the next instant
      }
      // On a return these run in the same synchronous continuation as the `finally`, so no pass sees the recovery settled with the old
      // slice still marked loaded. (A throw skips them, as before: `recover()` throws only before it clears its failure, since its
      // projection repair never throws, so the next pass finds the applier failed and is not ready, by R88's arm above.)
      this.evidenceLoaded = false;                                     // the slice and the dropped-evidence index are measured again by the next load
      this.dropped.clear();
      this.tupleLatest.clear();
      this.droppedIndexCache = null;
      if (durable.state().phase !== 'ready' || durable.failure() !== null || pass.signal.aborted) return;
    }
    await this.resolveProjectsRoot(pass);
    if (pass.signal.aborted) { this.notReady = true; return; }        // R109: cut before the owners, so nothing was listed
    this.passes += 1;
    await this.loadEvidence(durable, pass);
    if (pass.signal.aborted) { this.notReady = true; return; }        // R109: the same
    pass.reachedOwners = true;                                         // R109: synchronously after the last check, before any await

    // R88: the first pass to reach the owners after a not-ready mark (and the first of a process) is the latest ready instant: the
    // settle of the last recovery the lane started (`recoveredAt`, R112, R116), whichever pass started it, else the instant this pass's
    // applier answered, after the boot recovery `open()` makes (R113, R117); and never earlier than this pass's own clock, whatever the
    // wall clock did during the awaits (one clamp for both arms: R115 for the appliedAt arm, R120 for the recoveredAt arm). Measured
    // after the awaits, so the skew allowance runs from the settle (the reason on `recoveredAt`). The settle is consumed here. Everything
    // at or before the instant may hold a session nothing listed.
    if (this.notReady) {
      this.readyAt = Math.max(pass.now, this.recoveredAt ?? appliedAt);
      this.recoveredAt = null;
      this.notReady = false;
    }
    await this.expirePendingOwners(pass, durable);
    for (const owner of this.ownersOf(pass, durable.state())) {
      if (pass.signal.aborted) break;
      try {
        await this.observeOwner(pass, durable, owner);
        // R89: one observation COMPLETED, in a pass that was not cut. R101: it is forgotten only once what it staged is durable.
        if (!pass.signal.aborted) pass.completed.push(owner);
      } catch (err) { console.warn(`ccrc-server: delegation owner ${owner.id} could not be observed: ${err instanceof Error ? err.message : String(err)}`); }
    }
    // D-4658: what the owners staged, as ONE durable application. Also after a cut: everything staged came from a read that answered
    // before the cut (an abort check follows every read), and a fleet whose passes are always cut must still make progress. Its FIRST
    // application is enqueued at once; its standing refusals go one by one, and a bisection's halves only after the attempt before them
    // settles, so after a cut a later pass's flush CAN land between them (R85, A-F5), and apply a bucket from a newer cursor before this
    // pass applies it from an older one. Nothing applies twice (events dedupe by `eventId`), intervals never regress (their merge is
    // order-independent and `unmeasured` is sticky), `replaced` stays sticky, and a cursor that steps back once is re-read and deduped by
    // the next pass.
    // R101: the owners this pass read are forgotten only now, and only for what the flush made durable (a cut pass's late flush too).
    this.forgetRead(pass, await this.flushPass(pass, durable));
    if (pass.signal.aborted) return;

    // The upkeep: retention, and the hour that was never closed. One checkpoint-only change over the INTERVALS, and only when there is
    // something to do (the same array comes back otherwise). Cursors are never in it.
    if (upkeepDelegationIntervals(durable.state().checkpoint.observationIntervals, pass.now).changed) {
      try {
        await durable.applyCheckpointChange((cp) => ({ ...cp, observationIntervals: upkeepDelegationIntervals(cp.observationIntervals, pass.now).intervals }));
      } catch (err) { console.warn(`ccrc-server: delegation interval upkeep failed: ${err instanceof Error ? err.message : String(err)}`); }
    }
    if (pass.signal.aborted) return;
    await this.pruneCursors(pass, durable);
    if (pass.signal.aborted) return;

    // A census this lane has not reconciled yet; an older or equal one is left alone.
    if (pass.census.measuredAt > this.reconciledAt && (this.evidenceLoaded || this.seams.reconcileBeforeLoad === true)) await this.reconcile(pass, durable);
  }

  /** M-1: the lane no longer vouches for its last counts: the breaker reads unmeasured and the counts read 0 until a reconcile. */
  private unreconcile(): void {
    this.reconciled = false;
    this.verdicts = { unresolved: 0, conflicting: 0, unmeasured: 0 };
  }

  /**
   * N20 (coordinator 5439): the projects root the attribution reads, RESOLVED at every pass through `FleetIO.realpath`, so on the box that
   * holds it (in remote mode the root is a fleet-box path, and the server's own filesystem would answer about the wrong disk). A root that
   * does not resolve is `DELEGATION_ROOT_UNMEASURED` for this pass: attribution by the root answers nothing (never the configured
   * spelling, which git's canonical paths may not start with), and the next pass tries again.
   */
  private async resolveProjectsRoot(pass: LanePass): Promise<void> {
    const configured = this.deps.cfg.projectsRoot;
    let resolved: string | null = null;
    try { resolved = await this.deps.io.realpath(configured); } catch { resolved = null; }
    if (pass.signal.aborted) return;
    this.projectsRoot = resolved === null || resolved === '' ? DELEGATION_ROOT_UNMEASURED : resolved;
  }

  /**
   * Cursor retention (R58, D-4654): at most once per UTC hour, and only when the planner finds something to drop, ask the applier to
   * retire the cursors past the retention. The plan made HERE is only the decision to ask; the applier decides again, under its lock, on
   * its own rows, and a cursor whose hour is not on file is kept. Cursors are never touched through a checkpoint-only change.
   */
  private async pruneCursors(pass: LanePass, durable: DelegationDurability): Promise<void> {
    const hour = laneHourOf(pass.now);
    if (hour === this.lastPruneHour) return;
    const cp = durable.state().checkpoint;
    const plan = planDelegationCursorRetention(cp.bucketCursors, cp.observationIntervals, pass.now);
    if (plan.unparseable.length > 0 && !this.warnedUnparseableCursors) {
      this.warnedUnparseableCursors = true;
      console.warn(`ccrc-server: ${plan.unparseable.length} delegation bucket cursor(s) name no hour and are kept: ${plan.unparseable.slice(0, 3).map((c) => JSON.stringify(c.bucket)).join(', ')}`);
    }
    // The hour is spent BEFORE the attempt (N6): a prune that failed is retried at most once per UTC hour, like one that succeeded, and
    // not on every pass (each attempt is a planner run, a commit attempt and a warning line).
    this.lastPruneHour = hour;
    if (plan.drop.length > 0) {
      try { this.cursorsPruned += (await durable.pruneBucketCursors(pass.now)).dropped; }
      catch (err) { console.warn(`ccrc-server: the delegation cursor retention failed: ${err instanceof Error ? err.message : String(err)}`); }
    }
  }

  /** Who died since the last pass, by what this process watched: a parent first seen DEAD is not a fresh death (a restart is not a
   *  mass-death event), one seen alive and then dead is, and one seen alive again is not dead. */
  private noteSessions(pass: LanePass): void {
    for (const r of pass.records) this.sessionProject.set(r.id, r.project);
    for (const s of pass.sessions) this.sessionProject.set(s.id, s.project);
    const alive = new Set(pass.sessions.filter((s) => s.status !== 'dead').map((s) => s.id));
    if (this.aliveSeen) {
      for (const s of pass.sessions) {
        if (s.status === 'dead' && this.lastAlive.has(s.id) && !this.firstDead.has(s.id)) this.firstDead.set(s.id, pass.now);
      }
    }
    for (const id of alive) this.firstDead.delete(id);
    for (const [id, at] of this.firstDead) if (pass.now - at > DELEGATION_DEAD_MEMORY_MS) this.firstDead.delete(id);
    this.lastAlive = alive;
    this.aliveSeen = true;
  }

  /** The live sessions the census took an incarnation of, the owners a pass listed and no observation has read since (R89), and the
   *  owners with an hour still to close, in a stable order. Every owner the census lists is remembered as listed in this hour. */
  private ownersOf(pass: LanePass, state: DeepReadonly<DelegationRecoveryState>): LaneOwner[] {
    const out = new Map<string, LaneOwner>();
    const nowHour = laneHourOf(pass.now);
    const listed = new Map<string, { id: string; incarnation: string | null; reason: string; hourMs: number }>();
    for (const s of pass.sessions) {
      if (s.status === 'dead') continue;
      const inc = pass.census.incarnations.get(s.id);
      if (inc === undefined) continue;                                   // born after the census: the next census names it
      const incarnation = inc.kind === 'measured' ? inc.incarnation : null;
      const reason = inc.kind === 'measured' ? '' : inc.reason;
      const k = laneOwnerKey(s.id, incarnation);
      // R89: LISTED, so it stays an owner, live or not, until one observation of it completes (the loop in `run` forgets it then).
      const pending = this.pendingOwners.get(k) ?? { id: s.id, incarnation, reason, hours: new Set<number>(), listedBy: pass.seq };
      pending.reason = reason;
      pending.hours.add(nowHour);
      pending.listedBy = pass.seq;                                       // R107
      this.pendingOwners.set(k, pending);
      out.set(k, { id: s.id, incarnation, reason, live: true, listedHours: [] });
      listed.set(k, { id: s.id, incarnation, reason, hourMs: nowHour });
    }
    // R102 (review F2): an owner the last pass listed and this one does not (it ended, or died, since) may have written after its last
    // read: it is pending again, not live, with the hour it was last listed in, so it is read once more before it leaves.
    for (const [k, gone] of this.lastListed) {
      if (listed.has(k)) continue;
      const pending = this.pendingOwners.get(k) ?? { id: gone.id, incarnation: gone.incarnation, reason: gone.reason, hours: new Set<number>(), listedBy: pass.seq };
      pending.hours.add(gone.hourMs);
      pending.listedBy = pass.seq;                                       // R107
      this.pendingOwners.set(k, pending);
    }
    this.lastListed = listed;
    // R89: an owner a pass listed whose observation never completed (a cut pass, an observation that threw), which the census no longer
    // names alive: it is read anyway, once, as an owner that is not live.
    for (const [k, p] of this.pendingOwners) if (!out.has(k)) out.set(k, { id: p.id, incarnation: p.incarnation, reason: p.reason, live: false, listedHours: [] });
    // An owner that is no longer live still has its last hour to close (a session that ended mid-hour).
    for (const r of state.checkpoint.observationIntervals) {
      if (r.state !== 'measured' || r.parentIncarnation === DELEGATION_UNMEASURED_INCARNATION) continue;
      const at = laneInstantMs(r.utcHour);
      const recorded = laneInstantMs(r.recordedAt);
      if (at === null || recorded === null || at % DELEGATION_HOUR_MS !== 0) continue;
      if (pass.now < laneCloseAt(at) || recorded >= laneCloseAt(at)) continue;
      if (!this.readable(at, pass.now)) continue;             // past the read horizon: nothing of it is read, and upkeep turns the hour into a gap
      const k = laneOwnerKey(r.sessionId, r.parentIncarnation);
      if (!out.has(k)) out.set(k, { id: r.sessionId, incarnation: r.parentIncarnation, reason: '', live: false, listedHours: [] });
    }
    return [...out].map(([k, o]): LaneOwner => {
      const hours = [...(this.pendingOwners.get(k)?.hours ?? [])].filter((h) => this.readable(h, pass.now)).sort((a, b) => a - b);
      return { ...o, listedHours: hours };
    }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * R89: a listed hour of a pending owner that has LEFT THE READ HORIZON before any observation of it completed can never be read: it is
   * STAGED as a gap with a LOSS word for the pass's flush, never `directory-absent` or `capability-absent` (nothing measured either),
   * under the owner's incarnation (the stand-in for an unmeasured one, whose own word it keeps), and leaves the memory as it is staged; an owner
   * with no listed hour left is forgotten. So the memory is bounded by the read horizon. The two edges: a flush that fails is covered by
   * the next recovery's not-ready window, and an R82 pre-write refusal of that gap's own bucket would drop it unrecorded (nothing known
   * produces one).
   */
  private async expirePendingOwners(pass: LanePass, durable: DelegationDurability): Promise<void> {
    for (const [k, p] of [...this.pendingOwners]) {
      for (const hourMs of [...p.hours].sort((a, b) => a - b)) {
        if (this.readable(hourMs, pass.now)) continue;
        if (pass.signal.aborted) return;
        const detail = p.incarnation === null
          ? laneIncarnationGap(p.reason)
          : `${DELEGATION_HOUR_NEVER_CLOSED}: listed in this hour, and never read before the hour left the read horizon`;
        await this.noteGap(pass, durable, p.id, p.incarnation ?? DELEGATION_UNMEASURED_INCARNATION, hourMs, detail);
        p.hours.delete(hourMs);
      }
      if (p.hours.size === 0) this.pendingOwners.delete(k);
    }
  }

  /** R89: the hours of every owner a pass listed and no completed observation has read, as lost windows (on every repository). R106
   *  (review F6): and every hour of it the checkpoint holds MEASURED and not yet closed (recorded before its close): lines may have
   *  landed there after its last read (an owner read at 10:59:30 whose read throws at 11:00:30 is listed in hour 11 only). */
  private pendingWindows(state: DeepReadonly<DelegationRecoveryState>): DelegationListingWindow[] {
    const out: DelegationListingWindow[] = [];
    for (const p of this.pendingOwners.values()) {
      const hours = new Set(p.hours);
      if (p.incarnation !== null) {
        for (const r of state.checkpoint.observationIntervals) {
          if (r.sessionId !== p.id || r.parentIncarnation !== p.incarnation || r.state !== 'measured') continue;
          const at = laneInstantMs(r.utcHour);
          const recorded = laneInstantMs(r.recordedAt);
          if (at !== null && (recorded === null || recorded < laneCloseAt(at))) hours.add(at);
        }
      }
      for (const hourMs of hours) out.push(delegationLostHourWindow(p.id, p.incarnation ?? DELEGATION_UNMEASURED_INCARNATION, hourMs));
    }
    return out;
  }

  // ── one owner, one hour ───────────────────────────────────────────────────────────────────────────────────────────────

  private async observeOwner(pass: LanePass, durable: DelegationDurability, owner: LaneOwner): Promise<void> {
    if (owner.incarnation === null) {
      // The parent's incarnation could not be measured (absent, unreadable, changing): nothing can be bound to it, so nothing is read,
      // and the hour is a gap under a stand-in incarnation so that it counts. R89: every hour a pass LISTED it in and no completed
      // observation covered, live or not (a live owner's open hour is one: it was listed in this pass).
      for (const hourMs of owner.listedHours) {
        await this.noteGap(pass, durable, owner.id, DELEGATION_UNMEASURED_INCARNATION, hourMs, laneIncarnationGap(owner.reason));
      }
      return;
    }
    const inc = owner.incarnation;
    const capabilityPresent = pass.capability === 'present' ? true : pass.capability === 'absent' ? false : null;
    let listing: MeasuredDirectoryRead = { ok: false, reason: 'unreadable' };
    if (capabilityPresent === true) {
      try { listing = await this.deps.io.readdirMeasured(this.ownerDir(owner.id), DELEGATION_READ_TIMEOUT_MS, pass.signal); }
      catch { /* a dropped agent round trip is an unreadable listing */ }
      if (pass.signal.aborted) return;
    }
    for (const hourMs of this.hoursOf(pass, durable.state(), owner, inc, listing)) {
      if (pass.signal.aborted) return;
      await this.observeHour(pass, durable, owner.id, inc, hourMs, listing, capabilityPresent);
    }
  }

  private ownerDir(id: string): string { return `${this.deps.cfg.registryDir}/delegation/spool/${id}`; }

  private settledKey(id: string, inc: string, hourMs: number): string { return JSON.stringify([id, inc, hourMs]); }

  /** The hours to look at for one owner: the open hour (a live owner), every bucket the listing names within the spool's retention,
   *  and every hour this owner recorded before it ended and has not closed since; minus the hours already settled. */
  private hoursOf(pass: LanePass, state: DeepReadonly<DelegationRecoveryState>, owner: LaneOwner, inc: string, listing: MeasuredDirectoryRead): number[] {
    const nowHour = laneHourOf(pass.now);
    const hours = new Set<number>();
    if (owner.live) hours.add(nowHour);
    for (const hourMs of owner.listedHours) hours.add(hourMs);           // R89: every hour a pass listed it in and nothing has read since
    if (listing.ok) {
      for (const name of listing.entries) {
        const m = /^(\d{10})\.spool$/.exec(name);
        if (m === null) continue;
        let at: number;
        try { at = parseDelegationInstant(delegationBucketUtcHour(m[1]!)); } catch { continue; }
        if (this.readable(at, pass.now)) hours.add(at);
      }
    }
    for (const r of state.checkpoint.observationIntervals) {
      if (r.sessionId !== owner.id || r.parentIncarnation !== inc || r.state !== 'measured') continue;
      const at = laneInstantMs(r.utcHour);
      const recorded = laneInstantMs(r.recordedAt);
      if (at === null || !this.readable(at, pass.now)) continue;
      if (recorded === null || recorded < laneCloseAt(at)) hours.add(at);
    }
    const closed = (at: number): boolean => {
      if (pass.now < laneCloseAt(at)) return false;
      const row = state.checkpoint.observationIntervals.find((r) => r.sessionId === owner.id && r.parentIncarnation === inc && r.utcHour === formatDelegationInstant(at));
      const recorded = row === undefined ? null : laneInstantMs(row.recordedAt);
      return (row !== undefined && row.state === 'measured' && recorded !== null && recorded >= laneCloseAt(at)) || this.settled.has(this.settledKey(owner.id, inc, at));
    };
    return [...hours].filter((at) => this.seams.readEveryListedBucket === true || !closed(at)).sort((a, b) => a - b);
  }

  /** THE read horizon, in one place (R58): whether an hour's bucket may be read at all. Everything the lane reads, for a live owner or
   *  a dead one, passes through here. (The test seam reads every listed bucket not in the future, to pin the second line of defence.) */
  private readable(hourMs: number, nowMs: number): boolean {
    return this.seams.readEveryListedBucket === true ? hourMs <= laneHourOf(nowMs) : delegationBucketReadable(hourMs, nowMs);
  }

  /**
   * D-4658 (ruling R79, `one-durable-application-per-pass`): a bucket's durable batch is STAGED here and applied with every other one
   * of the pass by `flushPass`, in ONE `applyAcceptedBatch`: one journal append run (each record fsynced before the next), ONE
   * checkpoint replacement, ONE projection, where the lane used to make one application per busy owner (each a whole-checkpoint
   * rewrite and a whole projection, linear in all-time activities). Every bucket of a pass is ingested against the same durable state
   * (the buckets are distinct rows, and the journal dedupes events by `eventId`), so nothing a bucket decides reads another's staged
   * batch. Nothing staged is visible, or noted as evidence, before the application is durable (O1).
   */
  private async stage(
    pass: LanePass, durable: DelegationDurability, batch: DelegationDurableBatch, key: string, label: string,
  ): Promise<DeepReadonly<DelegationRecoveryState>> {
    if (this.seams.unbatched === true) {
      const out = await durable.applyAccepted(batch);
      for (const r of out.appended) if (r.entry.kind === 'evidence-accepted') this.noteEvidence(r.journalId, r.entry.event);
      return out.state;
    }
    pass.pending.push({ batch, key, label });
    return durable.state();
  }

  /**
   * The pass's durable application (D-4658), with ONE REFUSED BUCKET NEVER STOPPING THE PASS (R82). Two failures are told apart by the
   * applier's own state, never by the error's words:
   *   - a PRE-WRITE REFUSAL: the application threw and the applier is NOT failed (`failure()` null). Nothing was written: `acceptLocked`
   *     and `commitLocked` validate, plan, fold and build everything before the first byte. The staged list is then BISECTED, so every
   *     other result becomes durable in this same pass, and each refusing result is refused exactly as an unbatched application would
   *     refuse it: its own warn line, no cursor or interval, no settle key. A bucket refused once is remembered in lane memory
   *     (`refusedBuckets`, this process only: no file, no SQLite) and is applied ALONE, first, on later passes, so a standing refusal
   *     costs one small failed application a pass, never a bisection, and the rest go as one batch. It is forgotten when it applies.
   *   - a FAILURE AFTER THE FIRST BYTE (or the applier's own state disagreeing with its journal): `commitLocked` has failed the applier
   *     closed. Unchanged: the whole pass stops, nothing is settled, and the recovery that follows replays what the journal holds.
   * WHAT CAN PRODUCE A PRE-WRITE REFUSAL TODAY: (1) the checkpoint's own readers, `readCursor` and `readInterval`, re-checking the shape
   * of a result's cursor and interval (strings, integers, an anchor that starts at or before the cursor, instants, the interval-state
   * words), which ingestion builds from the owner id, the bucket name, the offsets and anchor it measured and its detail text; (2) the
   * journal's `validateEntry` over each accepted event's envelope, separate code from ingestion's line parser; (3) the fold
   * (`foldRecord`'s chain and identity-mapping refusals), `mergeInterval` and `build()`'s checkpoint invariants and encoding. Ingestion
   * builds every result inside those shapes, so no spool content is known to reach one; the isolation exists because the applier
   * re-validates independently, and a disagreement (a future change on either side) must cost one bucket, not the fleet's evidence.
   */
  private async flushPass(pass: LanePass, durable: DelegationDurability): Promise<{ failed: boolean; refused: ReadonlySet<string> }> {
    const staged = pass.pending.splice(0);
    const refused = new Set<string>();
    // R85 (A-F4): a refusal whose bucket is past the read horizon is never staged again, so remembering it would only grow the set.
    for (const k of [...this.refusedBuckets]) {
      const hourMs = (JSON.parse(k) as [string, string, number])[2];
      if (!this.readable(hourMs, pass.now)) this.refusedBuckets.delete(k);
    }
    try {
      // a standing refusal goes first, alone (it may apply now, and then leaves the set); every other result goes as one application
      const standing = new Set(staged.filter((x) => this.refusedBuckets.has(x.key)).map((x) => x.key));
      for (const e of staged.filter((x) => standing.has(x.key))) await this.applyIsolating(durable, [e], refused);
      await this.applyIsolating(durable, staged.filter((x) => !standing.has(x.key)), refused);
    } catch (err) {
      console.warn(`ccrc-server: the delegation pass's durable application of ${staged.length} bucket result(s) failed after it began writing; the applier recovers and the next pass reads them again: ${err instanceof Error ? err.message : String(err)}`);
      pass.settle.length = 0;
      return { failed: true, refused };
    }
    for (const k of pass.settle.splice(0)) if (!refused.has(k)) this.settled.add(k);
    return { failed: false, refused };
  }

  /**
   * R101 (review F1): an owner whose observation completed leaves the pending memory only once what it read is DURABLE. After a failure
   * past the first byte nothing of the pass is durable, so every owner it read stays pending (and is read again once the applier
   * recovers, whether or not a census still names it); an owner one of whose buckets the applier REFUSED before writing (R82) stays
   * pending too, so its refused bucket is staged again. Otherwise the hours the observation covered (its listed hours) leave the owner's
   * memory, and an owner with none left is forgotten. R107 (re-review N1): a cut pass's late flush can land after a LATER pass has listed
   * or re-pended the same owner in the same hour, and the hours are one set, so a pass forgets nothing of an owner whose stamp
   * (`listedBy`) is newer than its own: that later pass forgets it, once its own read is durable.
   */
  private forgetRead(pass: LanePass, flushed: { failed: boolean; refused: ReadonlySet<string> }): void {
    const done = pass.completed.splice(0);
    if (flushed.failed) return;
    const refusedOwners = new Set([...flushed.refused].map((k) => { const [id, inc] = JSON.parse(k) as [string, string, number]; return JSON.stringify([id, inc]); }));
    for (const owner of done) {
      if (refusedOwners.has(JSON.stringify([owner.id, owner.incarnation ?? DELEGATION_UNMEASURED_INCARNATION]))) continue;
      const k = laneOwnerKey(owner.id, owner.incarnation);
      const pending = this.pendingOwners.get(k);
      if (pending === undefined) continue;
      if (pending.listedBy > pass.seq) continue;                         // R107: a newer pass listed it; that pass decides
      for (const hourMs of owner.listedHours) pending.hours.delete(hourMs);
      if (pending.hours.size === 0) this.pendingOwners.delete(k);
    }
  }

  /** R82: applies `entries` as one application; on a PRE-WRITE refusal, bisects until each refusing result stands alone, and refuses it
   *  (its warn line, remembered in `refusedBuckets`); a failure after the first byte (the applier failed) is rethrown, whole. */
  private async applyIsolating(durable: DelegationDurability, entries: readonly LaneStaged[], refused: Set<string>): Promise<void> {
    if (entries.length === 0) return;
    let out: Awaited<ReturnType<DelegationDurability['applyAcceptedBatch']>>;
    try {
      out = await durable.applyAcceptedBatch(entries.map((e) => e.batch));
    } catch (err) {
      if (durable.failure() !== null) throw err;                         // after the first byte: fail closed, the whole pass stops
      if (entries.length === 1) {
        const [only] = entries;
        refused.add(only!.key);
        this.refusedBuckets.add(only!.key);
        console.warn(`ccrc-server: delegation bucket ${only!.label} was refused before anything was written: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      const mid = entries.length >> 1;
      await this.applyIsolating(durable, entries.slice(0, mid), refused);
      await this.applyIsolating(durable, entries.slice(mid), refused);
      return;
    }
    // R85 (A-F6): the bookkeeping after a DURABLE application stays outside the try that reads every throw as a pre-write refusal: a
    // throw here must never re-apply what was written, nor leave its records out of the evidence slice unnoticed.
    for (const r of out.appended) if (r.entry.kind === 'evidence-accepted') this.noteEvidence(r.journalId, r.entry.event);
    for (const e of entries) this.refusedBuckets.delete(e.key);
  }

  /** An hour recorded as a gap without a bucket to read: written once. */
  private async noteGap(pass: LanePass, durable: DelegationDurability, id: string, inc: string, hourMs: number, detail: string): Promise<void> {
    const hour = formatDelegationInstant(hourMs);
    const prior = durable.state().checkpoint.observationIntervals.find((r) => r.sessionId === id && r.parentIncarnation === inc && r.utcHour === hour);
    // R90: an unmeasured hour is written once, unless this is a loss word over a carve-out word
    if (prior !== undefined && prior.state === 'unmeasured' && !laneLossOverCarveOut(prior.detail, detail)) { this.skipped += 1; return; }
    if (pass.signal.aborted) return;
    await this.stage(pass, durable, {
      accepted: [], cursor: null,
      interval: { sessionId: id, parentIncarnation: inc, utcHour: hour, state: 'unmeasured', detail, recordedAt: formatDelegationInstant(Date.now()) },
    }, this.settledKey(id, inc, hourMs), `${id}/${laneBucketOf(hourMs)}`);
  }

  private async observeHour(
    pass: LanePass, durable: DelegationDurability, id: string, inc: string, hourMs: number, listing: MeasuredDirectoryRead, capabilityPresent: boolean | null,
  ): Promise<void> {
    const bucket = laneBucketOf(hourMs);
    const closing = pass.now >= laneCloseAt(hourMs);
    const row = durable.state().checkpoint.bucketCursors.find((r) => r.sessionId === id && r.parentIncarnation === inc && r.bucket === bucket);
    const read = await readDelegationBucket(this.deps.io, {
      ownerDir: this.ownerDir(id), sessionId: id, parentIncarnation: inc, bucket, cursor: row?.cursor ?? 0, lastSize: row?.lastSize ?? 0,
      anchorStart: row?.anchor?.start ?? null, capabilityPresent, listing, timeoutMs: DELEGATION_READ_TIMEOUT_MS, signal: pass.signal,
    });
    if (pass.signal.aborted) return;                                     // a late answer of a cut pass applies nothing
    const state = durable.state();                                       // AT THIS MOMENT, never a copy taken before the read (M5/M6)
    const seen = { accepted: 0 };
    const gate = this.gateOf(pass, durable, state, id, inc, hourMs, bucket, seen);
    try {
      if (read.ok) await ingestAndApplyDelegationBucket(read.input, state, gate);
      else await gate.applyBucketResult(unreadableDelegationBucketResult({ sessionId: id, parentIncarnation: inc, bucket }, state, { reason: read.reason, detail: read.detail }));
    } catch (err) {
      if (err instanceof DelegationIngestError) { console.warn(`ccrc-server: delegation bucket ${id}/${bucket} was refused: ${err.message}`); return; }
      throw err;
    }
    // An hour read AFTER it closed, with nothing new in it, is not read again by this process (once the pass's application is durable).
    if (closing && read.ok && seen.accepted === 0) pass.settle.push(this.settledKey(id, inc, hourMs));
  }

  /** The durable door for one bucket result: the no-op skip, then Task 8's own adapter (taking note of what it journaled). */
  private gateOf(
    pass: LanePass, durable: DelegationDurability, state: DeepReadonly<DelegationRecoveryState>, id: string, inc: string, hourMs: number, bucket: string,
    seen: { accepted: number },
  ): DelegationBucketDurability {
    const hour = formatDelegationInstant(hourMs);
    // Task 8's own adapter maps the result to its batch (and refuses an inapplicable one); the batch is STAGED for the pass (D-4658).
    const key = this.settledKey(id, inc, hourMs);
    const label = `${id}/${bucket}`;
    const adapter = delegationBucketDurabilityOf({ applyAccepted: async (batch) => ({ state: await this.stage(pass, durable, batch, key, label) }) }, () => Date.now());
    return {
      applyBucketResult: async (result: DelegationBucketResult) => {
        if (!result.applicable) return adapter.applyBucketResult(result);   // refused by name: a result that is not for a bucket applies nothing
        seen.accepted = result.accepted.length;
        const cp = state.checkpoint;
        const row = cp.bucketCursors.find((r) => r.sessionId === id && r.parentIncarnation === inc && r.bucket === bucket);
        const prior = cp.observationIntervals.find((r) => r.sessionId === id && r.parentIncarnation === inc && r.utcHour === hour);
        const cursorSame = row === undefined ? laneFreshCursor(result.cursor) : canonicalDelegationJson(row) === canonicalDelegationJson(result.cursor);
        const recorded = prior === undefined ? null : laneInstantMs(prior.recordedAt);
        const needsClose = pass.now >= laneCloseAt(hourMs) && prior !== undefined && prior.state === 'measured' && (recorded === null || recorded < laneCloseAt(hourMs));
        // R90: a loss word arriving over a carve-out word in the same hour moves the interval too (the merge keeps the loss)
        const intervalMoves = prior === undefined || (prior.state === 'measured' && result.interval === 'unmeasured')
          || (prior.state === 'unmeasured' && result.interval === 'unmeasured' && laneLossOverCarveOut(prior.detail, result.detail));
        if (result.accepted.length === 0 && cursorSame && !needsClose && !intervalMoves) {
          this.skipped += 1;
          return state;
        }
        if (row === undefined && result.accepted.length === 0 && laneFreshCursor(result.cursor)) {
          // Nothing was read from this bucket, so there is no cursor to keep: the interval alone is the record.
          return this.stage(pass, durable, {
            accepted: [], cursor: null,
            interval: { sessionId: id, parentIncarnation: inc, utcHour: hour, state: result.interval, detail: result.detail, recordedAt: formatDelegationInstant(Date.now()) },
          }, key, label);
        }
        return adapter.applyBucketResult(result);
      },
    };
  }

  // ── the evidence correlation reads ────────────────────────────────────────────────────────────────────────────────────

  /**
   * What the lane keeps of the journal for correlation, which is a thin slice: the join events (a subagent's start and stop, a
   * launch response), every Bash call that carries a worktree listing or may have SHED one (2c: `truncated`, no listing; the
   * one-event-per-tuple rule would otherwise hide it behind an earlier event of its tuple), and ONE event per (session, incarnation, agent, working
   * directory) for anything else that names a directory (rung 3 compares only `cwd`). Bounded by `DELEGATION_EVIDENCE_CAP`, oldest
   * first out. An eviction makes a verdict LESS decided, never more (R57, D-4653): the latest `observedAt` among the events evicted
   * is kept as the evidence horizon and handed to correlation, which refuses a link that rests on evidence reaching back to it. (The
   * one-event-per-tuple rule above is not an eviction: a later event of a tuple adds nothing correlation reads.)
   */
  private noteEvidence(journalId: string, event: DelegationEventEnvelopeV1): void {
    if (this.evidence.has(journalId)) return;
    // The time of this event, for the stamp of any key dropped under it; an instant nobody can read is never old enough to forget.
    const observed = laneInstantMs(event.observedAt) ?? Number.POSITIVE_INFINITY;
    let key: string | null = null;
    const tupleKey = (): string | null => (typeof event.cwd === 'string' ? JSON.stringify([event.sessionId, event.parentIncarnation, event.agentId ?? '', event.cwd]) : null);
    if (event.eventKind === 'SubagentStart' || event.eventKind === 'SubagentStop') key = null;
    else if (event.eventKind === 'PostToolUse' && 'launch' in event && event.launch !== null) key = null;
    else if ((event.eventKind === 'PreToolUse' || event.eventKind === 'PostToolUse') && event.toolName === 'Bash'
      && (('listing' in event && event.listing !== undefined) || event.truncated === true)) key = null;   // 2c: a shed listing is a (lost) window too
    else {
      const t = tupleKey();
      if (t === null) return;
      if (this.evidenceKeys.has(t)) {                                  // a hidden tuple-mate: it adds nothing correlation reads, but its time counts
        this.tupleLatest.set(t, Math.max(this.tupleLatest.get(t) ?? 0, observed));
        return;
      }
      key = t;
    }
    this.evidence.set(journalId, { event, key });
    if (key !== null) { this.evidenceKeys.set(key, journalId); this.tupleLatest.set(key, observed); }
    const cap = this.seams.evidenceCap ?? DELEGATION_EVIDENCE_CAP;
    while (this.evidence.size > cap) {
      const [oldest] = this.evidence.keys();
      if (oldest === undefined) break;
      const gone = this.evidence.get(oldest);
      this.evidence.delete(oldest);
      if (gone === undefined) continue;
      const goneAt = Math.max(laneInstantMs(gone.event.observedAt) ?? Number.POSITIVE_INFINITY, gone.key === null ? 0 : this.tupleLatest.get(gone.key) ?? 0);
      if (gone.key !== null) { this.evidenceKeys.delete(gone.key); this.tupleLatest.delete(gone.key); }
      // R65: remember what was lost. A tuple's held event stands for the later events of its tuple that the one-event-per-tuple rule
      // hid, and their keys are the tuple's own, so this records them too (stamped with the latest of them, the hidden ones included).
      this.noteDropped(gone.event, goneAt);
      // The horizon only rises. An `observedAt` that cannot be read (accepted events always carry a canonical one) is treated as now.
      this.evidenceHorizonMs = Math.max(this.evidenceHorizonMs ?? 0, laneInstantMs(gone.event.observedAt) ?? Date.now());
    }
  }

  /** Streams the retained journal once, through the applier (which alone names the file), after it is ready; from then on every
   *  application adds what it journals. */
  private async loadEvidence(durable: DelegationDurability, pass: LanePass): Promise<void> {
    if (this.evidenceLoaded) return;
    this.evidenceLoading ??= (async () => {
      try {
        // Every attempt starts from nothing and reads the whole journal: a failed attempt leaves no partial slice behind, and the
        // horizon is recomputed from this load's own evictions. A slice that is not whole is never handed to correlation (D-4008).
        this.evidence.clear();
        this.evidenceKeys.clear();
        this.tupleLatest.clear();
        this.evidenceHorizonMs = null;
        this.dropped.clear();
        this.droppedIndexCache = null;
        this.droppedAdded = 0;
        this.droppedPeak = 0;
        this.resetMarks();                                             // R73: rebuilt from the complete journal as it streams
        // R69: a restart lost the remembered paths. Seed them from what the checkpoint durably holds (a lease and an attempt both carry
        // their tree's canonical path), then add what this pass's census lists, and let a measured census of a tree's own project retire it.
        const checkpoint = durable.state().checkpoint;
        for (const r of [...checkpoint.leases, ...checkpoint.attempts]) {
          if (r.canonicalPath !== null && !this.knownPaths.has(laneTreeKey(r.project, r.adminRecord))) this.knownPaths.set(laneTreeKey(r.project, r.adminRecord), r.canonicalPath);
        }
        this.noteCensus(pass.census);
        this.forgetGoneTrees(pass.census);
        // A long journal drops far more keys than any census can still ask about, so while it streams the keys are pruned every
        // `DELEGATION_DROPPED_PRUNE_EVERY` new ones, against the census this pass holds and the checkpoint's activities (the visit folds
        // nothing, so they are already whole). The plan forgets nothing for a project this lane has not measured since it started.
        const every = this.seams.droppedPruneEvery ?? DELEGATION_DROPPED_PRUNE_EVERY;
        const activities = checkpoint.activities;
        await durable.visitRetainedRecords((r) => {
          if (r.entry.kind !== 'evidence-accepted') return;
          this.noteEvidence(r.journalId, r.entry.event);
          if (this.droppedAdded >= every) this.pruneDropped(pass.census, activities);
        });
        this.evidenceLoaded = true;
      } catch (err) {
        console.warn(`ccrc-server: the delegation evidence could not be read from the journal: ${err instanceof Error ? err.message : String(err)}`);
        this.evidence.clear();
        this.evidenceKeys.clear();
        this.dropped.clear();                                          // a partial index is not a measured one
        this.tupleLatest.clear();
        this.resetMarks();                                             // nor are partial marks
        this.droppedIndexCache = null;
      } finally {
        this.evidenceLoading = null;
      }
    })();
    await this.evidenceLoading;
  }

  // ── reconciliation ────────────────────────────────────────────────────────────────────────────────────────────────────

  private async reconcile(pass: LanePass, durable: DelegationDurability): Promise<void> {
    this.reconciledAt = pass.census.measuredAt;
    if (durable.state().phase !== 'ready') return;
    const now = formatDelegationInstant(pass.now);

    // The census, flat (hand-off 12): a project whose view was null contributes nothing and is not in `censused`.
    this.noteCensus(pass.census);
    this.forgetGoneTrees(pass.census);
    const { censused, flat, held, allMeasured } = laneFlatCensus(pass.census, this.standingProjects(pass.census));
    this.reconciliations += 1;
    const nextFirstSeen = new Map(flat.map((r) => [laneTreeKey(r.project, r.adminRecord), this.firstSeen.get(laneTreeKey(r.project, r.adminRecord)) ?? this.reconciliations] as const));
    // X1: a tree new to this census was born after the last census that measured its project, if this process took one.
    const nextSighted = new Map<string, { after: number | null; at: number }>();
    for (const r of flat) {
      const k = laneTreeKey(r.project, r.adminRecord);
      nextSighted.set(k, this.sighted.get(k) ?? { after: this.censusedAt.get(r.project) ?? null, at: pass.census.measuredAt });
    }
    const measuredNow = new Set(censused);
    for (const [k, v] of this.sighted) if (!nextSighted.has(k) && !measuredNow.has((JSON.parse(k) as [string, string])[0])) nextSighted.set(k, v);
    const recordsById = new Map(pass.records.map((r) => [r.id, r] as const));
    const registryRowOf = (record: DelegationCensusRecord): LaneRecord | undefined => {
      const ccdId = record.canonicalPath === null ? null : ccdIdForWorktree(record.project, record.canonicalPath);
      return ccdId === null ? undefined : recordsById.get(ccdId);
    };
    const waitRemaining = (record: DelegationCensusRecord): number =>
      DELEGATION_BIRTH_PASSES - (this.reconciliations - (nextFirstSeen.get(laneTreeKey(record.project, record.adminRecord)) ?? this.reconciliations));

    // M6: the lane's memory is bounded by the census. A miss and a positive meta leave with their tree; a measured absence leaves when
    // its tree is back in the census. N4: only against projects that were CENSUSED in this pass. A project whose view was null
    // contributes no trees, which is not the same as having none, so its cached reads stay (a positive meta carries no project, so
    // those are pruned only when every project was measured).
    const censusedProjects = new Set(censused);
    const names = new Set(flat.map((r) => r.adminRecord));
    for (const k of [...this.metaMiss.keys()]) if (!held.has(k) && censusedProjects.has((JSON.parse(k) as [string, string])[0])) this.metaMiss.delete(k);
    if (allMeasured) for (const [k, m] of [...this.pointMetas]) if (!names.has(m.sourceKind === 'agent' ? `agent-${m.upstreamId}` : m.upstreamId)) this.pointMetas.delete(k);
    for (const k of [...this.absences.keys()]) if (held.has(k)) this.absences.delete(k);

    // The evidence, indexed once (M5), for the rung-2 lookups.
    const index: LaneEvidenceIndex = { claimants: new Map(), launches: new Map() };
    for (const [journalId, { event }] of this.evidence) {
      if (typeof event.transcriptPath === 'string') {
        const ids = [event.agentId];
        if (event.eventKind === 'PostToolUse' && 'launch' in event && event.launch !== null && typeof event.launch === 'object' && 'agentId' in event.launch) ids.push(event.launch.agentId);
        for (const agentId of ids) {
          if (typeof agentId !== 'string') continue;
          const byParent = index.claimants.get(agentId) ?? new Map();
          const pk = JSON.stringify([event.sessionId, event.parentIncarnation]);
          if (!byParent.has(pk)) byParent.set(pk, { event, journalId });
          index.claimants.set(agentId, byParent);
        }
      }
      if (event.eventKind === 'PostToolUse' && event.toolName === 'Workflow' && event.launch !== null && !index.launches.has(event.launch.runId)) {
        index.launches.set(event.launch.runId, { event, journalId, dir: event.launch.transcriptDir });
      }
    }

    // Rung 2's point lookups come BEFORE the snapshot: a meta that opens an activity changes the checkpoint, and correlation and policy
    // must both read the one state that includes it.
    await this.readMetas(pass, durable, flat, index, (r) => registryRowOf(r) === undefined && waitRemaining(r) <= 0);
    if (pass.signal.aborted) return;
    const state = durable.state();                                       // ONE snapshot: correlation and policy both read it
    if (state.phase !== 'ready') return;
    // M6: a measured absence is kept only for a tree the checkpoint still holds (a lease or an attempt names it).
    const heldByCheckpoint = new Set([...state.checkpoint.leases, ...state.checkpoint.attempts].map((r) => laneTreeKey(r.project, r.adminRecord)));
    for (const k of [...this.absences.keys()]) if (!heldByCheckpoint.has(k)) this.absences.delete(k);
    const evidenceHorizon = this.evidenceHorizon();
    // R65: forget the dropped-evidence keys no present tree and no activity row can still ask about, but only against a census in which
    // every project was measured (a project with no view contributes no paths, and would read as "nothing needs this").
    if (this.droppedAdded >= (this.seams.droppedPruneEvery ?? DELEGATION_DROPPED_PRUNE_EVERY)) this.pruneDropped(pass.census, state.checkpoint.activities);
    const droppedEvidence = this.droppedIndex();

    const evidence = [...this.evidence].map(([journalId, v]) => ({ journalId, event: v.event }));
    // 2c d (R84): a call's listing is the repository its cwd is attributed to, by the TREES (every census path and every remembered one; the
    // nearest wins, so a nested worktree is its own repository's), and by the projects root only when it is RESOLVED. Unattributed: null.
    const trees = new Map<string, string>();
    for (const [k, p] of this.knownPaths) trees.set(p, (JSON.parse(k) as [string, string])[0]);
    for (const r of flat) if (r.canonicalPath !== null) trees.set(r.canonicalPath, r.project);
    const root = this.projectsRoot;
    const listedOf = (cwd: string): string | null => delegationMarkAttributionOf(cwd, root, trees)?.project ?? null;
    // 2c (R84): the windows the slice holds, the shed ones lost, and the windows the checkpoint says were lost (hours, torn tails, the floor).
    // W1 (R88, R89): and the stretches the lane's own memory knows it did not read: everything up to the latest ready instant, and every
    // listed hour of an owner no completed observation has read.
    const windows = [
      ...delegationListingWindowsOf([...this.evidence.values()].map((v) => v.event), (sessionId) => this.sessionProject.get(sessionId), listedOf),
      ...delegationLostWindowsOf(state.checkpoint.observationIntervals, state.checkpoint.bucketCursors, pass.now),
      delegationNotReadyWindowOf(this.readyAt),
      ...this.pendingWindows(state),
    ];
    const pointMetas = [...this.pointMetas.values()];
    const inputFor = (record: DelegationCensusRecord): DelegationCorrelationInput => {
      const row = registryRowOf(record);
      return {
        record,
        // No wave-3 datum names a checkpoint activity for a run's child (lineage rows owned by a run have no writer), so rung 1 has
        // nothing to agree with: a ccd workspace is `unresolved` as a workspace, never claimed as a lease and never run-child-owned.
        runChildAgreement: null,
        activities: state.checkpoint.activities, acceptedEvidence: evidence, pointMetas, listingWindows: windows,
        birthPassesRemaining: Math.max(0, Math.min(DELEGATION_BIRTH_PASSES, waitRemaining(record))) as 0 | 1 | 2,
        hasRegistryRow: row !== undefined, hasChildMarker: row !== undefined && row.child.kind !== 'none',
        evidenceHorizon, droppedEvidence,
        firstSighting: laneSightingOf(nextSighted.get(laneTreeKey(record.project, record.adminRecord)) ?? { after: null, at: pass.census.measuredAt }),
      };
    };
    // ONE expression: each pair is a census record and the verdict about it, never sorted or filtered apart.
    const pairs = flat.map((record) => ({ record, verdict: correlateDelegation(inputFor(record)) }));
    // R73, N16: which verdicts each kind of mark changed (a verdict two marks cover goes to the first of flag, project, path, id), counted
    // apart from every other `unmeasured` reason: a gauge of this reconcile, and the trees, cumulatively until the next hourly line.
    const forced: Record<DelegationMarkKind, number> = { path: 0, id: 0, project: 0, lossy: 0, prefix: 0, window: 0 };
    // I-1: a verdict an unknown-repository listing window changed is counted as `window`, after every mark (it is not one of the index's).
    const unknownWindows = windows.some((w) => w.repository === null && w.lost !== true);
    if (droppedEvidence.measured || unknownWindows) {
      for (const { record, verdict } of pairs) {
        const input = inputFor(record);
        const kind = (droppedEvidence.measured ? delegationMarkForced(input, verdict) : null)
          ?? (unknownWindows && delegationUnknownWindowForced(input, verdict) ? 'window' : null);
        if (kind === null) continue;
        forced[kind] += 1;
        this.forcedSinceLine[kind].add(laneTreeKey(record.project, record.adminRecord));
      }
    }
    this.markForced = forced;
    // 2c (R84): the links lost evidence held back, counted apart from the marks. A tree an unreleased lease holds is owned already (N5).
    const leasedNow = new Set(state.checkpoint.leases.filter((l) => l.releasedAt === null).map((l) => laneTreeKey(l.project, l.adminRecord)));
    let lostForced = 0;
    for (const { record, verdict } of pairs) {
      if (verdict.kind !== 'unmeasured' || leasedNow.has(laneTreeKey(record.project, record.adminRecord))) continue;   // the reason is correlation's to read
      if (!delegationLostEvidenceForced(inputFor(record), verdict)) continue;
      lostForced += 1;
      this.lostSinceLine.add(laneTreeKey(record.project, record.adminRecord));
    }
    this.lostForced = lostForced;

    const deaths = this.firstDeadParents();
    const effects = planDelegationReconciliation({
      now, recovery: state, census: flat, correlations: pairs, registryReadable: this.registryListed, firstDeadParents: deaths,
      previousSuccessfulCensus: this.previous === null ? null : this.previous.flat,
      censusedProjects: censused, previousCensusedProjects: this.previous === null ? null : this.previous.projects,
    });

    // The counts are the pass's VERDICTS, one per census record that is a tree or could not be read; an `absent` record is a tree
    // being removed. Never attempt rows: policy files none for work no parent is named for.
    const counts: DelegationVerdictCounts = { unresolved: 0, conflicting: 0, unmeasured: 0 };
    // N5: a tree that holds an UNRELEASED lease is owned work, whatever its evidence has since become (the creating window leaves the
    // slice, or rung 4's horizon test refuses to repeat the link): it is counted in none of the three.
    const leased = leasedNow;
    for (const { record, verdict } of pairs) {
      if (record.state === 'absent') continue;
      if (leased.has(laneTreeKey(record.project, record.adminRecord))) continue;
      // `unresolved` and `conflicting` count UNOWNED WORK only (R59), by the one classifier policy files its reports with: a ccd
      // workspace and a tree being born are not work. An `unmeasured` verdict (an eviction among them) is always counted.
      if (verdict.kind === 'unmeasured') counts.unmeasured += 1;
      else if ((verdict.kind === 'unresolved' || verdict.kind === 'conflicting') && isUnownedWorkReason(verdict.reason)) counts[verdict.kind] += 1;
    }
    this.verdicts = counts;
    this.firstSeen = nextFirstSeen;
    this.sighted = nextSighted;
    for (const p of censused) this.censusedAt.set(p, pass.census.measuredAt);
    this.previous = { flat, projects: censused };
    this.reconciled = true;
    this.reconciledWallMs = pass.now;
    this.warnMarks(pass.now);
    if (pass.signal.aborted) return;
    await this.applyEffects(pass, durable, effects);
  }

  /**
   * R73 rule 4, N16: once per UTC hour while any project is held back or lost, the global flag is up, or a mark held a verdict back since
   * the last line, ONE line names them (project names and counts only, never a path or a payload) and gives, per kind of mark, how many
   * trees it held at `unmeasured` since the last line; the counts are then reset.
   */
  private warnMarks(nowMs: number): void {
    const f = this.forcedSinceLine;
    const present = this.heldBack.size > 0 || this.lostProjects.size > 0 || this.lossy || Object.values(f).some((set) => set.size > 0) || this.lostSinceLine.size > 0;
    const hour = laneHourOf(nowMs);
    if (!present || hour === this.lastMarkWarnHour) return;
    this.lastMarkWarnHour = hour;
    const held = [...this.heldBack].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, n]) => `${p} (${n} keys)`).join(', ') || 'none';
    const lost = [...this.lostProjects].sort().join(', ') || 'none';
    console.warn(`ccrc-server: delegation dropped-evidence marks (R73): projects held back: ${held}; lost projects: ${lost}; global lossy flag: ${this.lossy ? 'up' : 'down'}; `
      + `marks held: ${this.pathMarkCount()} paths (${this.unattributedPaths.size} in no project), ${this.markIds.size} ids, ${this.lostPrefixes().size} lost-project prefixes; `
      + `trees held unmeasured by a mark since the last line: path ${f.path.size}, id ${f.id.size}, project ${f.project.size}, lossy ${f.lossy.size}, `
      + `prefix ${f.prefix.size}, unknown-repository window ${f.window.size}; `
      + `trees held unmeasured by lost evidence (a shed listing, an unmeasured hour, a lost creator) since the last line: ${this.lostSinceLine.size}`);
    this.forcedSinceLine = laneNoForced();
    this.lostSinceLine = new Set();
  }

  // ── rung 2: the positive meta reads ───────────────────────────────────────────────────────────────────────────────────

  /**
   * Rung 2 decides a tree named `agent-<id>` or `wf_<run>-<n>` here or not at all, and it needs a point lookup: the parent's own
   * transcript tree holds a `*.meta.json` whose `worktreePath` must equal the tree's canonical path. The directory comes from the
   * parent's OWN spool history (an event's `transcriptPath` and Claude session id, or a Workflow launch's `transcriptDir`), never a
   * search. At most `DELEGATION_META_READS_PER_PASS` files are read in a pass, a tree that gave nothing is not asked again for
   * `DELEGATION_META_RETRY_MS`, and a tree still inside its birth wait or held by the registry is not asked at all. A positive meta
   * opens the activity it names through the applier's own door (`applyPositiveAgentMeta` / `applyPositiveWorkflowMeta`), whose ID
   * exists only after the checkpoint replacement (O1); the meta itself is read evidence and is never journaled.
   */
  private async readMetas(
    pass: LanePass, durable: DelegationDurability, flat: readonly DelegationCensusRecord[], index: LaneEvidenceIndex, askable: (r: DelegationCensusRecord) => boolean,
  ): Promise<void> {
    const budget = { left: DELEGATION_META_READS_PER_PASS };
    for (const record of flat) {
      if (budget.left <= 0 || pass.signal.aborted) return;
      if (record.state !== 'present' || record.canonicalPath === null || !askable(record)) continue;
      const key = laneTreeKey(record.project, record.adminRecord);
      if ((this.metaMiss.get(key) ?? 0) > pass.now) continue;
      const wf = /^(wf_.+)-(\d+)$/.exec(record.adminRecord);
      let outcome: LaneMetaOutcome = 'missed';
      try {
        if (record.adminRecord.startsWith('agent-')) outcome = await this.readAgentMeta(pass, durable, record.adminRecord.slice('agent-'.length), index, budget);
        else if (wf !== null) outcome = await this.readWorkflowMeta(pass, durable, record, wf[1]!, index, budget);
        else continue;
      } catch (err) {
        console.warn(`ccrc-server: a delegation meta read for ${record.adminRecord} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Only a tree that was really ASKED and gave nothing is remembered as a miss; one the budget ran out on is asked next pass.
      if (outcome === 'missed' && !pass.signal.aborted) this.metaMiss.set(key, pass.now + DELEGATION_META_RETRY_MS);
    }
  }

  private async readMetaFile(pass: LanePass, file: string, budget: { left: number }): Promise<{ worktreePath: string } | null> {
    budget.left -= 1;
    const read = await this.deps.io.readFileMeasured(file, DELEGATION_READ_TIMEOUT_MS, pass.signal);
    if (!read.ok || read.content.length > DELEGATION_META_MAX_CHARS || pass.signal.aborted) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(read.content); } catch { return null; }
    const wt = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['worktreePath'] : undefined;
    return typeof wt === 'string' && wt !== '' ? { worktreePath: wt } : null;
  }

  private async readAgentMeta(pass: LanePass, durable: DelegationDurability, agentId: string, index: LaneEvidenceIndex, budget: { left: number }): Promise<LaneMetaOutcome> {
    let found = false;
    let unasked = false;
    for (const { event, journalId } of index.claimants.get(agentId)?.values() ?? []) {
      if (pass.signal.aborted) break;
      if (budget.left <= 0) { unasked = true; break; }
      const transcript = event.transcriptPath!;
      const file = `${transcript.slice(0, transcript.lastIndexOf('/'))}/${event.claudeSessionId}/subagents/agent-${agentId}.meta.json`;
      const meta = await this.readMetaFile(pass, file, budget);
      if (meta === null || pass.signal.aborted) continue;
      this.pointMetas.set(JSON.stringify([event.sessionId, event.parentIncarnation, 'agent', agentId]), {
        parentId: event.sessionId, parentIncarnation: event.parentIncarnation, sourceKind: 'agent', upstreamId: agentId,
        worktreePath: meta.worktreePath, evidenceJournalId: journalId,
      });
      found = true;
      // The meta is a qualifying join, but opening waits for at least one retained event naming the agent (a candidate): there is one.
      const cp = durable.state().checkpoint;
      if (!cp.activities.some((a) => a.sourceKind === 'agent' && a.upstreamId === agentId && a.parentId === event.sessionId && a.parentIncarnation === event.parentIncarnation)) {
        await durable.applyPositiveAgentMeta({ parentId: event.sessionId, parentIncarnation: event.parentIncarnation, agentId });
      }
    }
    return found ? 'found' : unasked ? 'unasked' : 'missed';
  }

  private async readWorkflowMeta(
    pass: LanePass, durable: DelegationDurability, record: DelegationCensusRecord, runId: string, index: LaneEvidenceIndex, budget: { left: number },
  ): Promise<LaneMetaOutcome> {
    // The run's launch response names its transcript directory; its workers' metas are the files directly inside it.
    const launch = index.launches.get(runId);
    if (launch === undefined) return 'missed';
    if (budget.left <= 0) return 'unasked';
    budget.left -= 1;                                                    // the directory listing is a read of the pass, charged like a file read (M5)
    let listing: MeasuredDirectoryRead;
    try { listing = await this.deps.io.readdirMeasured(launch.dir, DELEGATION_READ_TIMEOUT_MS, pass.signal); } catch { return 'missed'; }
    if (!listing.ok || pass.signal.aborted) return 'missed';
    for (const name of listing.entries.filter((n) => /^agent-[A-Za-z0-9_-]+\.meta\.json$/.test(n)).slice(0, DELEGATION_META_DIR_ENTRIES)) {
      if (pass.signal.aborted) return 'missed';
      if (budget.left <= 0) return 'unasked';
      const meta = await this.readMetaFile(pass, `${launch.dir}/${name}`, budget);
      if (meta === null || meta.worktreePath !== record.canonicalPath) continue;
      // The worker's index is the meta's own: the last component of the worktree path it names is `<runId>-<index>`.
      const m = /^(.+)-(\d+)$/.exec(meta.worktreePath.slice(meta.worktreePath.lastIndexOf('/') + 1));
      const workerIndex = m === null ? Number.NaN : Number(m[2]);
      if (m === null || m[1] !== runId || !Number.isSafeInteger(workerIndex)) continue;
      this.pointMetas.set(JSON.stringify([launch.event.sessionId, launch.event.parentIncarnation, 'workflow', record.adminRecord]), {
        parentId: launch.event.sessionId, parentIncarnation: launch.event.parentIncarnation, sourceKind: 'workflow', upstreamId: record.adminRecord,
        worktreePath: meta.worktreePath, evidenceJournalId: launch.journalId,
      });
      await durable.applyPositiveWorkflowMeta({ parentId: launch.event.sessionId, parentIncarnation: launch.event.parentIncarnation, runId, workerIndex });
      return 'found';
    }
    return 'missed';
  }

  private async applyEffects(pass: LanePass, durable: DelegationDurability, effects: readonly DelegationReportEffect[]): Promise<void> {
    const attempts: DelegationAttemptRow[] = [];
    for (const e of effects) {
      if (e.kind === 'request-linked-lease-identity' || e.kind === 'record-run-child-owned' || e.kind === 'record-unowned-worktree') attempts.push(e.attempt);
    }
    const filed = attempts.length === 0 ? new Set<string>() : await this.fileAttempts(durable, attempts);
    let repair = false;
    for (const e of effects) {
      if (pass.signal.aborted) return;
      switch (e.kind) {
        case 'request-linked-lease-identity':
          // The attempt is on file before the lease is journaled; `createLease` deduplicates on the identity key, so a request re-emitted
          // after a crash between the two is a no-op.
          if (!filed.has(e.attempt.attemptId)) break;
          try { await durable.createLease(e.request); }
          catch (err) { console.warn(`ccrc-server: a delegation lease identity could not be journaled: ${err instanceof Error ? err.message : String(err)}`); }
          break;
        case 'record-run-child-owned':
        case 'record-unowned-worktree':
          break;                                                         // the attempt row is the whole record
        case 'record-measured-absence': {
          const k = laneTreeKey(e.project, e.adminRecord);
          if (!this.absences.has(k)) this.absences.set(k, { project: e.project, adminRecord: e.adminRecord, observedAt: e.observedAt });
          break;
        }
        case 'repair-report-projection':
          repair = true;
          break;
        case 'record-observation-interval':
          try { await durable.applyAccepted({ accepted: [], cursor: null, interval: e.interval }); }
          catch (err) { console.warn(`ccrc-server: a delegation interval could not be recorded: ${err instanceof Error ? err.message : String(err)}`); }
          break;
        default:
          e satisfies never;
      }
    }
    if (repair && !pass.signal.aborted) {
      try { await durable.repairProjection(); }
      catch (err) { console.warn(`ccrc-server: the delegation projection could not be repaired: ${err instanceof Error ? err.message : String(err)}`); }
    }
  }

  /** Makes the pass's attempts durable through a checkpoint-only change (an attempt already on file is skipped, so an upsert is a no-op),
   *  one change for the lot and, if the lot is refused, each alone. Answers the IDs now on file. */
  private async fileAttempts(durable: DelegationDurability, attempts: readonly DelegationAttemptRow[]): Promise<Set<string>> {
    const add = (list: readonly DelegationAttemptRow[]) => (cp: DelegationCheckpointV1): DelegationCheckpointV1 => {
      const have = new Set(cp.attempts.map((a) => a.attemptId));
      const fresh = list.filter((a, i) => !have.has(a.attemptId) && list.findIndex((b) => b.attemptId === a.attemptId) === i);
      return fresh.length === 0 ? cp : { ...cp, attempts: [...cp.attempts, ...fresh] };
    };
    try {
      await durable.applyCheckpointChange(add(attempts));
    } catch (err) {
      console.warn(`ccrc-server: the delegation attempts could not be filed together (${err instanceof Error ? err.message : String(err)}); filing each alone`);
      for (const a of attempts) {
        try { await durable.applyCheckpointChange(add([a])); }
        catch (e2) { console.warn(`ccrc-server: a delegation attempt could not be filed: ${e2 instanceof Error ? e2.message : String(e2)}`); }
      }
    }
    return new Set(durable.state().checkpoint.attempts.map((a) => a.attemptId));
  }
}
