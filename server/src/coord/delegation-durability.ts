// Delegation durability (C5). Ring L3 adapter: the serialized durable applier and the file side of recovery, through the injected
// file port, clock and randomness (large-file pilot, D-8641).
/** Moved out of `server/src/coord/delegation-checkpoint.ts` by `.github/ci/file-split.mjs`: a pure move (D-8636). */

import path from 'node:path';
import {
  DELEGATION_CLEANUP_POPULATIONS,
  DELEGATION_CLEANUP_STATES,
  DELEGATION_ACTIVITY_SOURCE_KINDS,
  type DelegationEventEnvelopeV1,
  type DelegationCarrierState,
  type DelegationLeaseReleaseReason,
  type DelegationTailHeal,
} from '../../../shared/api.js';
import {
  DelegationModelError,
  DELEGATION_JOURNAL_ENTRY_KINDS,
  DELEGATION_PRUNING_HOLD_REASONS,
  canonicalDelegationJson,
  deriveDelegationLineageId,
  emptyDelegationCheckpoint,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  isLowerHex64,
  leaseSourceKindOfActivity,
  parseDelegationInstant,
  planDelegationCursorRetention,
  upkeepDelegationIntervals,
  WAVE3_LEASE_SOURCE_KINDS,
  type DeepReadonly,
  type DelegationActivityRow,
  type DelegationBucketCursor,
  type DelegationCheckpointV1,
  type DelegationEventRow,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
  type DelegationAttemptMark,
  type DelegationLeaseCreationRequest,
  type DelegationObservationInterval,
  type DelegationRecoveryState,
} from './delegation-model.js';
import {
  DELEGATION_CARRIED_FILE,
  DELEGATION_JOURNAL_ERROR_CODES,
  DELEGATION_JOURNAL_FILE,
  DELEGATION_TORN_DIR,
  DelegationJournalError,
  DelegationJournalWriter,
  DelegationRetentionCollector,
  delegationBytesSha256,
  delegationEventRowOfRecord,
  delegationLeaseIdentityKey,
  delegationTailHealPlan,
  delegationTornTailError,
  planDelegationJournalAppend,
  planDelegationPruning,
  readDelegationRetainedRecords,
  type DelegationAppendItem,
  type DelegationAppendPlan,
  type DelegationFilePort,
  type DelegationFileHandle,
  type DelegationReadHandle,
  type DelegationJournalPosition,
  type DelegationJournalTail,
  type DelegationPruningPlan,
  type DelegationTailHealPlan,
} from './delegation-journal.js';
import {
  DelegationCompactionPlanner,
  type DelegationCompactionPlan,
  type DelegationCompactionSkipReason,
} from './delegation-compaction.js';
import {
  decideLeaseRelease,
  decideLeaseTransition,
  delegationCarrierStateOf,
  foldLeaseCarrierSeen,
  promoteRunMismatch,
  type DelegationLeaseActRefusal,
  type DelegationLeaseTransitionReason,
} from './delegation-lease-state.js';
import { COORDINATION_RESTORE_MARKER_FILE, DELEGATION_RESTORE_IN_PROGRESS, DELEGATION_CHECKPOINT_FILE, DelegationCheckpointBuilder, refuse, readCursor, readInterval, sessionKeyOf, type DelegationMetaOpenResult, delegationRecordNaming, isMember, encodeDelegationCheckpoint, decodeDelegationCheckpoint, type DelegationCheckpointErrorCode } from './delegation-checkpoint.js';
import { type DelegationRecoveryReport, DelegationRecovery, type DelegationRecoveryFailure, DelegationEvidenceIndex, type DelegationOwnFailureCode } from './delegation-recovery.js';
import { DELEGATION_BACKFILL_FILE, DELEGATION_BACKFILL_SCAN_MS, decodeBackfillList, encodeBackfillList, planDelegationBackfill, type DelegationBackfillParent } from './delegation-backfill.js';
import { taskReportKey } from './delegation-end-basis.js';
import type { DelegationBackfillReport } from '../../../shared/delegationBackfill.js';
import { type DelegationProjectionPort, type DelegationProjectionRepairReport, DELEGATION_REPAIR_FULL_MS, repairDelegationProjection, deleteEventsInGaps, DELEGATION_EVENTS_DELETE_CHUNK } from './delegation-db-projection.js';

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// IMPURE SHELL: from here down the module reads and writes files (through the injected port), calls the injected clock and
// randomness, and drives SQLite through the synchronous store. Nothing above does any of it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
/** Reads the checkpoint and the retained set (the carried file's lines, then the journal: `readDelegationRetainedRecords`) and recovers (an
 *  active restore marker refuses first). A read that fails (an unreadable chunk, a record that does not validate, a torn tail the checkpoint
 *  names, any torn tail of the carried file, a carried line out of order or not in the journal) is a recovery failure. A torn tail that nothing names is not: it is a successful recovery of
 *  the complete records that carries `tailHeal`, the plan `DelegationDurability` carries out (D-4655). */
export async function recoverDelegationFromFiles(port: DelegationFilePort, dir: string): Promise<DelegationRecoveryReport> {
  // An active restore marker comes FIRST: the files below may be half replaced, so none of them is read (a refusal, not a repair).
  if (await port.readFile(path.join(dir, COORDINATION_RESTORE_MARKER_FILE)) !== null) {
    const refused = new DelegationRecovery(null);
    refused.fail('checkpoint-decode', DELEGATION_RESTORE_IN_PROGRESS, 'a coordination restore is in progress or did not finish; run `ccrc coordination-snapshot recover`');
    return refused.finish();
  }
  const checkpointBytes = await port.readFile(path.join(dir, DELEGATION_CHECKPOINT_FILE));
  const recovery = new DelegationRecovery(checkpointBytes);
  // A tail is NOT failed on the way in (D-4655): the complete records are recovered first, and the tail is judged against the result.
  const found: { tail: DelegationJournalTail | null } = { tail: null };
  try {
    for await (const line of readDelegationRetainedRecords(port, path.join(dir, DELEGATION_CARRIED_FILE), path.join(dir, DELEGATION_JOURNAL_FILE), (t) => { found.tail = t; })) {
      if (line.source === 'carried') recovery.acceptCarried(line.record); else recovery.accept(line.record);
    }
  } catch (err) {
    if (err instanceof DelegationJournalError) recovery.fail('journal-validate', err.code, err.message);
    else throw err;
  }
  const cleanScan = !recovery.failed();
  const report = recovery.finish();
  const plan = delegationTailHealPlan(found.tail, report.failure === null);
  if (plan !== null) return { ...report, tailHeal: plan };
  if (found.tail !== null && cleanScan && report.failure !== null) {
    // The complete records scanned clean but the recovery they feed refused (the checkpoint names the LF-less record, or one past the last
    // complete one, or holds one that is not retained): the tail is NOT left to cut, and it is reported as it always was, with the reason.
    // ANY refusal here, not only the two the snapshot helper converts (`anchor-missing`, `held-evidence-missing`; R76 M4): the helper
    // validates without the fold, so after a clean scan those two are the only refusals it can meet, while this recovery folds and can also
    // refuse at its final validation. Either way the checkpoint does not leave the tail to cut, so the tail's code is
    // reported; for the two refusals both sides can meet, the differential rows in `coordination-snapshot.test.ts` (a checkpoint that
    // names the LF-less record, and one that holds it) hold both sides to the same code.
    const refusal = delegationTornTailError(found.tail.bytes);
    return { ...report, failure: { phase: 'journal-validate', code: refusal.code, detail: `${refusal.message}; the checkpoint does not leave it to cut: ${report.failure.code}: ${report.failure.detail}` } };
  }
  return report;
}

// ── The serialized durable applier ────────────────────────────────────────────────────────────────────────────────────

/** O5's edges, in order. `onEdge` is a fault-injection seam: production passes none. */
export const DELEGATION_DURABILITY_EDGES = [
  'journal-write', 'journal-fsync', 'build', 'checkpoint-write', 'checkpoint-fsync', 'checkpoint-rename', 'directory-fsync', 'project',
] as const;

/** D-7021: the journal compaction's edges, in order (`compactJournal`). Each is made durable before the next. */
export const DELEGATION_COMPACTION_EDGES = ['compact-plan', 'carried-write', 'carried-fsync', 'carried-rename', 'carried-directory-fsync',
  'writer-close', 'journal-copy', 'journal-copy-fsync', 'journal-rename', 'journal-directory-fsync', 'writer-reopen', 'memory-prune',
  'events-delete'] as const;

export type DelegationDurabilityEdge = (typeof DELEGATION_DURABILITY_EDGES)[number] | (typeof DELEGATION_COMPACTION_EDGES)[number];

/** What one compaction did (`DelegationDurability.compactJournal`). */
export type DelegationCompactionOutcome =
  | { kind: 'skipped'; reason: DelegationCompactionSkipReason; plan: DelegationCompactionPlan | null }
  | { kind: 'compacted'; plan: DelegationCompactionPlan; eventsDeleted: number; retired: number; ms: number };

/** Task 3.1: what the lane asks of the upkeep door in one pass. */
export interface DelegationUpkeepRequest { nowMs: number; intervals: boolean; cursors: boolean; zeroDelta: boolean }

export interface DelegationUpkeepOutcome {
  intervalsChanged: boolean;
  cursorsDropped: number;
  /** The kept cursor rows whose bucket names no hour, counted whether or not anything was due (the lane warns once on them). */
  cursorsUnparseable: number;
  retired: number;
  /** Null when no requested part had anything to do: no clone, no build, no encode, no write. */
  applied: DelegationApplyOutcome | null;
}

export interface DelegationDurabilityDeps {
  /** The coordination directory (`~/.ccrc`; a fixture directory in a test). */
  dir: string;
  /** SQLite, or null when only the authoritative files are wanted. */
  projection: DelegationProjectionPort | null;
  /** INJECTED clock: epoch milliseconds. `acceptedAt` of a record without one is read from it, and, when `monotonicMs` is absent, the
   *  forced full repair's interval (`DELEGATION_REPAIR_FULL_MS`, D-5836) is measured on it. */
  now: () => number;
  /** D-5836: the FORCED-FULL clock only (the lane's monotonic clock), so a wall-clock step cannot hold back or hurry the hourly full
   *  repair. Absent: that interval is measured on `now`. This module reads no clock of its own. */
  monotonicMs?: () => number;
  /** INJECTED randomness: called ONLY by `createLease`, exactly once, after deduplication. */
  randomUUID: () => string;
  /** Every filesystem operation, through the injected port: REQUIRED, so this module never loads the node adapter itself. The composition
   *  root (the delegation applier in `watch.ts`) passes the node port; a test passes the node port or a faulting one. */
  port: DelegationFilePort;
  onEdge?: (edge: DelegationDurabilityEdge, when: 'before' | 'after') => void | Promise<void>;
  /** Server log line sink (`console.warn('ccrc-server: …')` in production). */
  warn?: (message: string) => void;
  /** D-7021: the rows one `delegation_events` delete statement takes (`DELEGATION_EVENTS_DELETE_CHUNK`; a test seam). */
  eventsDeleteChunk?: number;
}

/** Why the applier refuses to apply anything until it re-recovers. */
export type DelegationDurabilityFailure = DelegationRecoveryFailure;

export interface DelegationDurableBatch {
  /** Accepted evidence, in order. `acceptedAt` defaults to the injected clock. */
  accepted: readonly { event: DelegationEventEnvelopeV1; acceptedAt?: string }[];
  /** The bucket cursor the ingestion reached, checkpoint-owned. */
  cursor: DelegationBucketCursor | null;
  /** The observation interval this read measured, checkpoint-owned. */
  interval: DelegationObservationInterval | null;
}

export interface DelegationApplyOutcome {
  /** The state AFTER the checkpoint replacement. Nothing in it escapes before then (O1). READ-ONLY (R27): these ARE the applier's live
   *  rows, so a caller that edited one in place would corrupt the applier. */
  state: DeepReadonly<DelegationRecoveryState>;
  appended: readonly DeepReadonly<DelegationJournalRecordV1>[];
  skipped: DeepReadonly<DelegationAppendPlan['skipped']>;
  /** Activities this application opened. Exposed only once the checkpoint holding their mapping is durable. */
  openedActivities: readonly DeepReadonly<DelegationActivityRow>[];
  /** False when nothing changed and nothing was written. */
  durable: boolean;
  projection: DeepReadonly<{ status: 'projected' | 'unprojected' | 'failed'; error?: string }>;
}

/** Session helpers S2 (D-8874): the pass's answer. `ok: false` is the count refusal: the pass was asked to close a count it would not close
 *  now, and wrote nothing. `applied` is null when it closed nothing (a second run, or nothing qualifying), and then nothing was written. */
export type DelegationBackfillPassOutcome =
  | { ok: true; closed: number; report: DelegationBackfillReport; applied: DelegationApplyOutcome | null }
  | { ok: false; report: DelegationBackfillReport };

/** Why `createLease` declined to create a lease. */
export type DelegationLeaseRefusalReason = 'canonical-path-held' | 'unmeasured-request' | 'unmeasured-activity' | 'source-kind-mismatch' | 'zero-delta-call';

export type DelegationLeaseOutcome =
  | { kind: 'created'; leaseId: string; lineageId: string; sequence: number; applied: DelegationApplyOutcome }
  | { kind: 'duplicate'; leaseId: string }
  | { kind: 'refused'; reason: DelegationLeaseRefusalReason; detail: string; heldBy?: string };

/** PR5b: a lease transition, as a door is asked for it (plan "## PR5", Interfaces). The door builds the `lease-transition` entry from
 *  the request and its decision; `lineageClose` and `lineageOpenRun` are derived from the reason (`transfer` and `runId` for `promote`,
 *  null for every other), never carried. */
export interface DelegationLeaseTransitionRequest {
  leaseId: string;
  expectGeneration: number;
  reason: DelegationLeaseTransitionReason;
  at: string;
  expiresAt: string | null;
  /** D-7968: the activity's terminal-evidence instant, which the entry carries on `adopt` only (PR7's caller writes the clamped value). */
  terminalEvidenceAt: string | null;
  runId: number | null;
  promotedSession: string | null;
  auditEvidence: string | null;
  /** The caller measured the carrier-mark capability on the box (`capSupported`); the door passes it into `decideLeaseTransition`. The
   *  durability layer knows no capability, so it never derives this itself; the replay fold passes `false` (D-7806). */
  carrierRequired: boolean;
  /** PR8's resolve of a conflicting tree; null elsewhere. */
  resolvesThrough: DelegationAttemptMark | null;
}

/** PR5b: a lease release, as a door is asked for it. */
export interface DelegationLeaseReleaseRequest {
  leaseId: string;
  expectGeneration: number;
  releaseReason: DelegationLeaseReleaseReason;
  at: string;
  lastHeadSha: string | null;
  resolvesThrough: DelegationAttemptMark | null;
}

/** What a lease door did: appended one record (`applied`), found its own request already applied (`unchanged`, nothing appended), or
 *  declined with the decision's word (`refused`). A request the fold refuses is not an outcome: the door's promise rejects. */
export type DelegationLeaseActOutcome =
  | { kind: 'applied'; leaseId: string; generation: number; state: DelegationCarrierState; sequence: number; applied: DelegationApplyOutcome }
  | { kind: 'unchanged'; leaseId: string; generation: number; state: DelegationCarrierState }
  | { kind: 'refused'; refusal: DelegationLeaseActRefusal; detail: string };

export type DelegationMetaOutcome =
  | { kind: 'opened'; activityId: string; applied: DelegationApplyOutcome }
  | { kind: 'already-open'; activityId: string }
  | { kind: 'waiting-for-evidence' };

/** A change only the checkpoint may make: intent, attempts (filing one, and collapsing rows that repeat one decision, D-6191), positive meta,
 *  interval upkeep. It may not move the applied position, remove a session, or add or alter a lease or a lease's lineage (only the
 *  journal creates leases). */
export type DelegationCheckpointChange = (checkpoint: DelegationCheckpointV1) => DeepReadonly<DelegationCheckpointV1>;

const nowInstant = (ms: number): string => formatDelegationInstant(ms);

/**
 * The serialized durable applier. EVERY mutation goes through one promise-chain queue, so applications never interleave, and
 * each runs O5's eight steps in order:
 *   1 append a complete journal record, 2 fsync the journal, 3 build the next state, 4 write the checkpoint temp file in the
 *   same directory, 5 fsync it, 6 atomically rename it over the checkpoint, 7 fsync the parent directory, and only then
 *   8 project to `coord.db` (the five tables once, then the batch's events in one transaction).
 * Before step 1 it builds and validates the whole next state, so a record the fold would refuse is never journaled, and a
 * checkpoint that could not be decoded, or projected, is never written. After ANY failure at steps 1 to 7 the applier marks itself
 * `reconstructing` (pruning disabled) and refuses everything until `recover()` re-reads the disk: a failed application leaves the
 * journal AHEAD of the checkpoint at worst, never behind, and recovery replays the difference. A failure at step 8 does not
 * undo durability: SQLite is marked stale and repaired from the checkpoint and the journal on the next application.
 */
export class DelegationDurability {
  private readonly port: DelegationFilePort;
  private readonly journalPath: string;
  private readonly carriedPath: string;
  private readonly checkpointPath: string;
  private readonly tempPath: string;
  /** D-7021: the journal's first sequence (what the repair's step 0 deletes below), or null when there is no journal. */
  private retainedFrom: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | null = null;
  private writer: DelegationJournalWriter;
  private builder = DelegationCheckpointBuilder.from(emptyDelegationCheckpoint());
  private eventIds = new Set<string>();
  private evidence = new DelegationEvidenceIndex();
  private head: DelegationJournalPosition | null = null;
  private current: DelegationRecoveryState = { checkpoint: emptyDelegationCheckpoint(), phase: 'reconstructing' };
  private failureNow: DelegationDurabilityFailure | null = { phase: 'checkpoint-decode', code: 'not-recovered' satisfies DelegationOwnFailureCode, detail: 'recovery has not run' };
  private projectionStale = false;
  /** D-5836: the checkpoint revision the projection was last made to say (a successful `projectLocked` or full `repairLocked`), or null
   *  when that is unknown. Cleared wherever `projectionStale` is set and at the start of every `recover()`. */
  private projectedRevision: number | null = null;
  /** Cumulative since construction (never reset, no clock): the whole-checkpoint canonical encodes `commitLocked` made (the no-op compare's
   *  two, `encodeDelegationCheckpoint`'s one, `verifyDecodable`'s re-encode), the checkpoint-file encodes at the write point, and the byte
   *  length of the last of those. Read through `commitMeasures()`; counted where the work happens, so a commit that throws later keeps what it spent. */
  private measuredEncodes = 0;
  private measuredWrites = 0;
  private measuredBytes: number | null = null;
  /** D-5836: true once the lane's per-pass repair has been called since the last `recover()` (`open` included); the first one is always full. It is set before the try, so a failed call sets it too, which is safe because a failure marks the projection stale. */
  private perPassSeen = false;
  /** D-5836: the forced-full clock's reading at the last successful full repair, or at the last `recover()`. */
  private lastFullAt = 0;
  /** Sessions whose SQLite events an application found in conflict with the journal's: healed by the next repair. */
  private drifted = new Map<string, { sessionId: string; incarnation: string }>();
  /** The last torn tail this process cut off and kept (D-4655), or the newest one the quarantine holds that no report of this process
   *  covered (MUST 1): for `/api/fleet/health`. Never cleared by a later recovery. */
  private healed: DelegationTailHeal | null = null;
  /** MUST 1: the quarantined tails this process has reported (on the warn line), by path. Memory only: NO durable "reported" marker, so
   *  a new process reports the newest one again, which the ruling accepts, until an operator removes it. */
  private readonly reportedTails = new Set<string>();
  /** MUST 1: the quarantine could not be listed at the last boot or recovery (unknown, never "no heal"). */
  private quarantineUnmeasured = false;

  private constructor(private readonly deps: DelegationDurabilityDeps) {
    this.port = deps.port;
    this.journalPath = path.join(deps.dir, DELEGATION_JOURNAL_FILE);
    this.carriedPath = path.join(deps.dir, DELEGATION_CARRIED_FILE);
    this.checkpointPath = path.join(deps.dir, DELEGATION_CHECKPOINT_FILE);
    this.tempPath = `${this.checkpointPath}.tmp`;
    this.writer = new DelegationJournalWriter(this.port, this.journalPath, deps.dir);
  }

  /** Opens the files, recovers, persists a recovered-but-unsaved state, and repairs the projection. The result may be
   *  `reconstructing`: check `failure()`. It never throws for a recovery failure, only for a bug or an IO error. */
  static async open(deps: DelegationDurabilityDeps): Promise<DelegationDurability> {
    const d = new DelegationDurability(deps);
    await d.recover();
    return d;
  }

  /** The last DURABLE state (or the best decoded one while `reconstructing`). */
  state(): DeepReadonly<DelegationRecoveryState> { return this.current; }

  /**
   * What the commits so far cost, CUMULATIVE since construction (a pass's figure is the difference of two readings; this reads no clock):
   *   - `encodes`: the whole-checkpoint canonical encodes `commitLocked` made: 2 when the no-op compare ran (only when the application did
   *     not append), 1 for `encodeDelegationCheckpoint` at the write point, 1 when `verifyDecodable` re-encoded inside the strict decoder.
   *     NOT counted: row and codec encodes, journal-record encodes, and `applyCheckpointChange`'s `leaseState` compare;
   *   - `writes`: how many commits reached the write point (`encodeDelegationCheckpoint` calls);
   *   - `cpBytes`: `bytes.length` of the last of those (the canonical JSON plus its final LF: the bytes written), null before any.
   *   - `pendingBash` (D-6271): a READ-TIME value, not cumulative: the builder's pending Bash calls on unmapped keys now.
   * Counted where the work happens, so a commit that throws later (a failed edge, a refused decode) still counted its encodes. A no-op
   * flush (skipped before the write point) therefore advances `encodes` by 2 and `writes` and `cpBytes` not at all.
   */
  commitMeasures(): { encodes: number; writes: number; cpBytes: number | null; pendingBash: number } {
    return { encodes: this.measuredEncodes, writes: this.measuredWrites, cpBytes: this.measuredBytes, pendingBash: this.builder.pendingBashCallCount() };
  }
  failure(): DelegationDurabilityFailure | null { return this.failureNow; }
  /** The last torn journal tail this process healed, or null: when, how many bytes, and where they are kept (D-4655). A heal is a
   *  measurement, never a failure, and never makes the applier unhealthy by itself. */
  lastTailHeal(): DelegationTailHeal | null { return this.healed; }
  /** MUST 1: true when the tail quarantine could not be listed at the last boot or recovery. */
  tailQuarantineUnmeasured(): boolean { return this.quarantineUnmeasured; }
  /** True only while the state is `ready` and nothing has failed (O2): never during reconstruction, never after a failure. */
  pruningEnabled(): boolean { return this.current.phase === 'ready' && this.failureNow === null; }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.closing !== null) return Promise.reject(new Error('the delegation applier is closed'));
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async edge<T>(edge: DelegationDurabilityEdge, fn: () => Promise<T> | T): Promise<T> {
    await this.deps.onEdge?.(edge, 'before');
    const out = await fn();
    await this.deps.onEdge?.(edge, 'after');
    return out;
  }

  private requireReady(): void {
    if (this.current.phase !== 'ready' || this.failureNow !== null) {
      refuse('not-ready', this.failureNow === null ? 'the applier is reconstructing' : `${this.failureNow.phase}: ${this.failureNow.detail}`);
    }
  }

  /** Re-reads the disk and rebuilds every in-memory index. */
  recover(): Promise<DelegationRecoveryReport> {
    return this.enqueue(async () => {
      // Pruning is disabled FROM ENTRY: the state is `reconstructing` before the first byte is read.
      this.current = { checkpoint: this.current.checkpoint, phase: 'reconstructing' };
      this.failureNow = { phase: 'checkpoint-decode', code: 'recovering' satisfies DelegationOwnFailureCode, detail: 'recovery is running' };
      this.projectedRevision = null;                       // D-5836: recovery's own repair is full and sets it again; a failed recovery leaves it unknown
      this.perPassSeen = false;
      this.lastFullAt = this.fullClock();
      await this.writer.close().catch(() => undefined);
      this.writer = new DelegationJournalWriter(this.port, this.journalPath, this.deps.dir);
      const report = await recoverDelegationFromFiles(this.port, this.deps.dir);
      // THE TAIL HEAL (D-4655). `report.tailHeal` exists ONLY for a tail on a sound prefix (the rule, once, in `delegation-journal.ts`), so
      // it is the single gate. It runs first, inside this serialized turn and before anything of the recovery is adopted: the applier stays
      // not ready (and appends nothing) until the tail is kept elsewhere AND the journal is cut and fsynced. A failure is a recovery failure.
      if (report.tailHeal !== null) {
        try {
          await this.healTailLocked(report.tailHeal);
        } catch (err) {
          this.current = { checkpoint: report.state.checkpoint, phase: 'reconstructing' };
          this.failureNow = { phase: 'durable-application', code: 'tail-heal-failed' satisfies DelegationOwnFailureCode, detail: err instanceof Error ? err.message : String(err) };
          this.deps.warn?.(`ccrc-server: delegation journal tail heal failed: ${this.failureNow.detail}`);
          await this.reportQuarantineLocked();
          return { ...report, state: this.current, failure: this.failureNow, facts: null, pruning: 'disabled', coveredEnds: 0 };
        }
      }
      await this.reportQuarantineLocked();
      if (report.failure !== null || report.facts === null) {
        this.current = report.state;
        this.failureNow = report.failure ?? { phase: 'final-validate', code: 'no-facts' satisfies DelegationOwnFailureCode, detail: 'recovery produced no state' };
        this.deps.warn?.(`ccrc-server: delegation recovery failed at ${this.failureNow.phase}: ${this.failureNow.code}`);
        return report;
      }
      this.builder = report.facts.builder;
      this.eventIds = report.facts.eventIds;
      this.head = report.facts.head;
      this.retainedFrom = report.journal?.firstSequence ?? null;
      this.current = report.state;
      this.evidence = report.facts.evidence;
      // Recovery is the one moment the in-memory state may be ahead of the file: persist it through the same replacement. A
      // checkpoint of revision 0 with a journal behind it was never persisted (every persisted checkpoint has revision >= 1).
      // The applier stays NOT ready (`failureNow` still set, so pruning stays off) until the save has succeeded.
      const needsSave = report.replayed > 0 || report.coveredEnds > 0 || (report.state.checkpoint.revision === 0 && this.head !== null);
      if (needsSave) {
        try {
          await this.commitLocked({ items: [], mutate: null, force: true, project: false });
        } catch (err) {
          // A failure inside steps 1 to 7 has already been marked by `commitLocked`; one BEFORE step 1 (the build, the encoding) has
          // not, and the replayed suffix is then unsaved: mark it here, so a recovery that could not save is never reported ready.
          if (this.failureNow === null || this.failureNow.code === ('recovering' satisfies DelegationOwnFailureCode)) this.fail(err);
          return { ...report, state: this.current, failure: this.failureNow, coveredEnds: 0 };   // nothing of the recovered state was saved
        }
      }
      // Told only once the rows it names are durable (D-6269).
      if (report.coveredEnds > 0) this.deps.warn?.(`ccrc-server: delegation recovery changed ${report.coveredEnds} activity row(s) from covered task notifications`);
      this.failureNow = null;
      await this.repairLocked();
      return { ...report, state: this.current };
    });
  }

  /**
   * THE TAIL HEAL (D-4655), the only place the journal is ever cut, and the server stays its only writer. The steps, in this order, each
   * made durable before the next:
   *   0. re-measure: the bytes after the cut point are still exactly the ones recovery classified (same size, same SHA-256);
   *   1. keep them: a content-addressed file under `delegation-events.torn/` (temp, fsync, rename), then the quarantine directory and its
   *      parent are fsynced; a file of that name that already exists must hold the SAME bytes (an earlier heal that died after its rename)
   *      and is reused, so a re-heal makes no duplicate, and a different one fails the heal closed;
   *   2. cut the journal to the end of the last complete validated record (`plan.offset`), the one place anything truncates it;
   *   3. fsync the journal and its directory.
   * A crash or a failure at ANY step leaves the tail in the journal or whole in quarantine, and the next recovery heals it the same way.
   */
  private async healTailLocked(plan: DelegationTailHealPlan): Promise<void> {
    const kept = path.join(this.deps.dir, DELEGATION_TORN_DIR, plan.name);
    const tail = await this.remeasureTail(plan);
    await this.port.mkdirp(path.dirname(kept));
    const existing = await this.port.readFile(kept);
    if (existing === null) {
      const temp = `${kept}.tmp`;
      const handle = await this.port.createTemp(temp);
      try {
        const n = await handle.write(tail);
        if (n !== tail.length) throw new DelegationJournalError('short-write', `wrote ${n} of ${tail.length} quarantine bytes`);
        await handle.sync();
      } finally {
        await handle.close().catch(() => undefined);
      }
      await this.port.rename(temp, kept);
    } else if (existing.length !== tail.length || !existing.every((b, i) => b === tail[i])) {
      throw new DelegationJournalError('torn-tail', `${kept} already exists with other bytes than the tail it is named for; the journal is left as it is`);
    }
    await this.port.fsyncDir(path.dirname(kept));
    await this.port.fsyncDir(this.deps.dir);
    await this.port.truncate(this.journalPath, plan.offset);
    // REPORTED AS SOON AS THE CUT RETURNS (R76 M1): the bytes are already durable in quarantine, so a fsync that fails, or a death, after
    // this point cannot leave the heal untold. A death between the cut and this line is closed by the boot report (`reportQuarantineLocked`).
    this.healed = { at: nowInstant(this.deps.now()), bytes: plan.bytes, quarantinePath: kept };
    this.reportedTails.add(kept);
    this.deps.warn?.(`ccrc-server: delegation journal: healed a torn tail at ${this.healed.at}: ${plan.bytes} byte(s) after offset ${plan.offset} cut off and kept at ${kept}`);
    await this.port.fsyncFile(this.journalPath);
    await this.port.fsyncDir(this.deps.dir);
  }

  /**
   * THE BOOT REPORT (MUST 1, coordinator 5424; R76 M1 narrows the window, this closes it). At every boot and every recovery, after any
   * heal, every quarantined tail in `delegation-events.torn/` that no report of THIS process covers is reported: one warn line each, and
   * the newest of them (by the file's own modification time) on `lastTailHeal`, with the file's own time, size and path, unless this
   * process has reported a later heal itself. The quarantine directory's own contents are the only evidence, and nothing is written:
   * no "reported" marker, so each new process reports the newest one again until an operator removes it. A `*.tail.tmp` is ignored: a heal
   * that died before its rename left the tail in the journal, and the next recovery heals it. A directory that cannot be listed, or a file
   * that cannot be stat'ed, is UNMEASURED (`tailQuarantineUnmeasured`), never "no heal".
   */
  private async reportQuarantineLocked(): Promise<void> {
    const dir = path.join(this.deps.dir, DELEGATION_TORN_DIR);
    let names: string[] | null;
    try { names = await this.port.listDir(dir); } catch (err) {
      this.quarantineUnmeasured = true;
      this.deps.warn?.(`ccrc-server: delegation journal: the tail quarantine ${dir} could not be listed, so whether a heal went unreported is unmeasured: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.quarantineUnmeasured = false;
    let newest: DelegationTailHeal | null = null;
    let newestMs = Number.NEGATIVE_INFINITY;
    for (const name of [...(names ?? [])].sort()) {
      if (!name.endsWith('.tail')) continue;                          // `*.tail.tmp` (a heal that died before its rename) and anything else
      const kept = path.join(dir, name);
      let st: { size: number; mtimeMs: number } | null;
      try { st = await this.port.statFile(kept); } catch (err) {
        this.quarantineUnmeasured = true;
        this.deps.warn?.(`ccrc-server: delegation journal: the quarantined tail ${kept} could not be stat'ed, so its report is unmeasured: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (st === null) continue;                                       // gone between the listing and the stat
      // R85 (A-F1): a time no instant can spell (before 1970, after the year 9999: a `touch -d`, a copy that kept a bogus stamp) is that
      // file's report UNMEASURED, like one that cannot be stat'ed; the boot report only reads, so it must never stop recovery.
      let at: string;
      try { at = nowInstant(Math.trunc(st.mtimeMs)); } catch (err) {
        if (!(err instanceof DelegationModelError)) throw err;
        this.quarantineUnmeasured = true;
        this.deps.warn?.(`ccrc-server: delegation journal: the quarantined tail ${kept} has a time that is no instant, so its report is unmeasured: ${err.message}`);
        continue;
      }
      const found: DelegationTailHeal = { at, bytes: st.size, quarantinePath: kept, foundAtBoot: true };
      if (!this.reportedTails.has(kept)) {
        this.reportedTails.add(kept);
        this.deps.warn?.(`ccrc-server: delegation journal: a quarantined torn tail no report of this process covers: ${st.size} byte(s) kept at ${kept}, cut at ${found.at}`);
      }
      if (st.mtimeMs > newestMs) { newestMs = st.mtimeMs; newest = found; }
    }
    if (newest === null) return;
    const ownMs = this.healed === null ? Number.NEGATIVE_INFINITY : parseDelegationInstant(this.healed.at);
    if (this.healed === null || (this.healed.quarantinePath !== newest.quarantinePath && newestMs > ownMs)) this.healed = newest;
  }

  /** Step 0 of the heal: the tail's bytes, read again, and proved to be the ones the plan names (nothing was appended behind them, nothing changed). */
  private async remeasureTail(plan: DelegationTailHealPlan): Promise<Uint8Array> {
    const handle = await this.port.openRead(this.journalPath);
    if (handle === null) throw new DelegationJournalError('torn-tail', 'the journal vanished between recovery and its heal');
    try {
      const size = await handle.size();
      if (size !== plan.offset + plan.bytes) throw new DelegationJournalError('torn-tail', `the journal is ${size} bytes, not the ${plan.offset + plan.bytes} recovery measured; nothing is cut`);
      const bytes = await handle.read(plan.offset, plan.bytes);
      if (bytes.length !== plan.bytes || await delegationBytesSha256(bytes) !== plan.sha256) throw new DelegationJournalError('torn-tail', 'the tail changed between recovery and its heal; nothing is cut');
      return bytes;
    } finally {
      await handle.close();
    }
  }

  /**
   * Repairs `coord.db` from the checkpoint and the journal now (a lost or rolled-back file, or after a failed projection). A bare call is
   * always the FULL repair. The lane's per-pass call (`perPass: true`, D-5836) is a no-op report (`skipped: true`) when the projection is
   * KNOWN current: the lane has repaired once since the last `recover()`, nothing is stale or drifted, the last projection was of this
   * checkpoint revision, SQLite's `(count, max)` equal the evidence index's, and the hourly forced full (`DELEGATION_REPAIR_FULL_MS`) is
   * not due; any one failing makes it the full repair. The residual, WIDENED by the delta projection: out-of-band VALUE drift on a row no
   * delta touches, with every count equal, survives the applications that follow (each writes only the rows it changed); it heals at the
   * next FULL projection (a fallback application, a repair after stale or drift, the hourly forced full, recovery), no longer at the
   * next application that projects, and never at the next pass. The delta's count check trips at once only on a NET count change
   * (an out-of-band insert or delete: the delta refuses, the projection goes stale, the next repair is full); a balanced delete and
   * insert in one table passes it, and the compare-and-swap catches that only if the delta updates that row.
   */
  repairProjection(opts?: { perPass?: boolean }): Promise<DelegationProjectionRepairReport | null> {
    const perPass = opts?.perPass === true;
    return this.enqueue(async () => { this.requireReady(); return this.repairLocked(perPass); });
  }

  /** The forced-full clock: the lane's monotonic clock when it gave one, else `now`. */
  private fullClock(): number { return this.deps.monotonicMs?.() ?? this.deps.now(); }

  private async repairLocked(perPass = false): Promise<DelegationProjectionRepairReport | null> {
    const projection = this.deps.projection;
    if (projection === null) return null;
    const first = perPass && !this.perPassSeen;
    if (perPass) this.perPassSeen = true;
    try {
      if (perPass && !first && !this.projectionStale && this.drifted.size === 0 && this.projectedRevision === this.current.checkpoint.revision
        && this.fullClock() - this.lastFullAt < DELEGATION_REPAIR_FULL_MS) {
        const stats = projection.eventStats();
        if (stats.count === this.evidence.total && stats.maxSequence === this.evidence.last) {
          return { resumedAfter: stats.maxSequence ?? 0, inserted: 0, duplicate: 0, healedSessions: 0, fullReplay: false, wipedAll: false, journalPasses: 0, skipped: true, prunedBelow: 0 };
        }
      }
      const report = await repairDelegationProjection({
        projection, checkpoint: this.current.checkpoint, journal: () => this.retainedRecords(), heal: [...this.drifted.values()], evidence: this.evidence,
        retainedFrom: this.retainedFrom, deleteChunk: this.deps.eventsDeleteChunk,
      });
      this.projectionStale = false;
      this.drifted.clear();
      this.projectedRevision = this.current.checkpoint.revision;
      this.lastFullAt = this.fullClock();
      return report;
    } catch (err) {
      this.projectionStale = true;
      this.projectedRevision = null;
      this.deps.warn?.(`ccrc-server: delegation projection repair failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Visits every record the retained journal holds, in order, READ-ONLY, through the applier's own port and its own journal path, on
   * the applier's queue (so no application is half-written while it reads). It is how the watcher lane (Task 13) learns the evidence
   * correlation reads without NAMING the journal file: this module and the journal module stay the only sources that do (a guard in
   * `delegation-recovery.test.ts` pins that). A decode or IO failure rejects and changes nothing; the applier stays as it was.
   *
   * D-4652, with the coordinator's bounds: it opens no write, rename or truncate target (it calls the read door and nothing else); it
   * runs only `ready` (`requireReady`), on the queue, so no application is half-written while it reads and an application enqueued
   * during a held visit completes after it; a caller must treat a failure DURING a visit as an unmeasured evidence set, never as the
   * records seen so far (a missing counter-event could link a tree, D-4008); and it re-derives nothing: records the checkpoint already
   * covers are only handed over, and every activity ID the checkpoint maps stays as it is (O4).
   */
  visitRetainedRecords(visit: (record: DelegationJournalRecordV1) => void): Promise<void> {
    return this.enqueue(async () => {
      this.requireReady();                                  // a reconstructing or failed applier streams nothing: its journal is not yet folded
      for await (const record of this.retainedRecords()) visit(record);
    });
  }

  /** The retained set as records, through the one reader (`readDelegationRetainedRecords`): the carried lines, then the journal. */
  private async *retainedRecords(): AsyncGenerator<DelegationJournalRecordV1, void, undefined> {
    for await (const line of readDelegationRetainedRecords(this.port, this.carriedPath, this.journalPath)) yield line.record;
  }

  /** The pruning plan right now. Streams the retained set once for the held records' positions; deletes and rewrites nothing. */
  async planPruning(nowMs: number, retentionMs: number): Promise<DelegationPruningPlan> {
    return this.enqueue(async () => {
      const collector = new DelegationRetentionCollector(new Set(this.current.checkpoint.pruningHolds.map((h) => h.journalId)), nowMs - retentionMs);
      if (this.pruningEnabled()) for await (const r of this.retainedRecords()) collector.add(r);
      return planDelegationPruning({ state: this.current, view: collector.view() });
    });
  }

  // ── the entry points ───────────────────────────────────────────────────────────────────────────────────────────────

  /** THE ENTRY POINT Task 9 calls (through its `DelegationBucketDurability`). Journals, checkpoints and projects one bucket's
   *  accepted evidence, its cursor and its interval, as ONE durable application. Nothing it returns existed before the
   *  checkpoint replacement completed. */
  applyAccepted(batch: DelegationDurableBatch): Promise<DelegationApplyOutcome> {
    return this.enqueue(async () => this.acceptLocked([batch]));
  }

  /**
   * D-4658 (ruling R79, `one-durable-application-per-pass`): several buckets' results as ONE durable application, in the
   * `applyAccepted` shape. The O5 order is unchanged: every accepted record of every batch, in the order given, is appended and fsynced
   * (each record fsynced BEFORE the next is appended, so only the application's LAST record can ever tear, and the heal's "bytes after
   * the last LF" rule still holds), then ONE checkpoint replacement carries every cursor and interval, then ONE projection. Per bucket
   * nothing changes: each cursor goes through `setCursor` (so `replaced` stays sticky) and each interval through `mergeInterval`, in the
   * order given, exactly as one `applyAccepted` per batch would leave them; events dedupe by `eventId` across the whole application, as
   * across applications. Every member is validated BEFORE the first byte, and a failure anywhere fails the WHOLE application: nothing of
   * it is visible. The two failures differ in what they leave (R82): a REFUSAL before the first byte (a member's cursor or interval, an
   * event's envelope, the fold, the build) writes nothing and leaves the applier ready (`failure()` null), so the caller may apply the
   * other members without it; a failure AFTER the first byte fails the applier closed, and the caller re-reads every bucket once it has
   * recovered (the eventIds dedupe what the journal already holds). A crash after k records leaves them past the checkpoint, and
   * recovery replays them all, as it replays one.
   */
  applyAcceptedBatch(batches: readonly DelegationDurableBatch[]): Promise<DelegationApplyOutcome> {
    return this.enqueue(async () => this.acceptLocked(batches));
  }

  /** The one body of `applyAccepted` and `applyAcceptedBatch`, inside the queue. */
  private async acceptLocked(batches: readonly DelegationDurableBatch[]): Promise<DelegationApplyOutcome> {
    this.requireReady();
    // The checkpoint-owned members are checked with the checkpoint's own readers BEFORE anything is written: a cursor or an interval
    // recovery could not read would otherwise be made durable by an application that is otherwise perfectly valid.
    for (const batch of batches) {
      if (batch.cursor !== null) readCursor(batch.cursor);
      if (batch.interval !== null) readInterval(batch.interval);
    }
    const at = nowInstant(this.deps.now());
    const items: DelegationAppendItem[] = batches.flatMap((batch) =>
      batch.accepted.map((a): DelegationAppendItem => ({ entry: { kind: 'evidence-accepted', event: a.event }, acceptedAt: a.acceptedAt ?? at })));
    return this.commitLocked({
      items,
      mutate: (b) => {
        for (const batch of batches) {
          if (batch.cursor !== null) b.setCursor(batch.cursor);
          if (batch.interval !== null) b.mergeInterval(batch.interval);
        }
      },
      force: false,
    });
  }

  /** A change only the checkpoint may make, applied through the same replacement. See `DelegationCheckpointChange`. */
  applyCheckpointChange(change: DelegationCheckpointChange): Promise<DelegationApplyOutcome> {
    return this.enqueue(async () => {
      this.requireReady();
      return this.commitLocked({
        items: [],
        mutate: (b) => {
          const before = b.build(this.current.checkpoint.revision);
          // The change is handed a COPY. `before` is what every guard below compares against, and its rows are the very objects the
          // builder (and the last durable checkpoint) hold: a change that edited its argument in place and returned it would otherwise
          // compare the argument with itself, pass every guard, and, refused or not, have rewritten the applier's own rows.
          const after = change(structuredClone(before));
          const pos = b.appliedPosition();
          if (after.appliedJournalSequence !== pos.sequence || after.appliedJournalId !== pos.journalId || after.appliedJournalDigest !== pos.digest) {
            refuse('change-refused', 'a checkpoint-only change cannot move the applied journal position: only a journal append does');
          }
          const kept = new Set(after.sessions.map((s) => sessionKeyOf(s.sessionId, s.parentIncarnation)));
          for (const s of before.sessions) {
            if (!kept.has(sessionKeyOf(s.sessionId, s.parentIncarnation))) {
              refuse('change-refused', `a change removed the session (${s.sessionId}, ${s.parentIncarnation}): wave 3 never removes a session from the checkpoint (it would delete its SQLite events on the event loop)`);
            }
          }
          // O4, the immutable mapping: only the fold and the meta door open an activity, and nothing re-derives one; the ONE door that drops an
          // activity and its mapping is `retireZeroDeltaBashActivities` (the O4 amendment, D-6268), never a checkpoint-only change. A change
          // that edited the rows AND the map together would stay self-consistent, so `build()` cannot catch it; this does.
          const beforeIds = before.activityIdsByNaturalKey;
          const afterIds = after.activityIdsByNaturalKey;
          for (const [key, id] of Object.entries(beforeIds)) {
            if (!Object.hasOwn(afterIds, key) || afterIds[key] !== id) {
              refuse('change-refused', `a change dropped or re-mapped the activity ID of the natural key ${key}: the mapping is immutable (O4)`);
            }
          }
          for (const key of Object.keys(afterIds)) {
            if (!Object.hasOwn(beforeIds, key)) {
              refuse('change-refused', `a change added the natural key ${key}: only a journal append and the meta door open an activity`);
            }
          }
          const activitiesAfter = new Map(after.activities.map((a) => [a.activityId, a] as const));
          for (const a of before.activities) {
            const b = activitiesAfter.get(a.activityId);
            if (b === undefined || b.parentId !== a.parentId || b.parentIncarnation !== a.parentIncarnation || b.sourceKind !== a.sourceKind
                || b.upstreamId !== a.upstreamId || b.identityJournalId !== a.identityJournalId || b.openedAt !== a.openedAt) {
              refuse('change-refused', `a change dropped or altered the identity of the activity ${a.activityId}: its ID, parent, source, upstream ID, identity journalId and opening instant are immutable (O4)`);
            }
          }
          // Every lease fact stays journal-first (plan, line 7): the leases, their carrier rows (a transfer, a promotion, a release reason,
          // a resolution mark) and the lineage a lease or a promoted run owns. Only the journal writes them (review 1451 F3).
          const leaseState = (cp: DelegationCheckpointV1): string => canonicalDelegationJson([cp.leases, cp.leaseCarriers ?? [],
            cp.lineage.filter((n) => n.leaseId !== null || n.runId !== null)]);
          if (leaseState(after) !== leaseState(before)) {
            refuse('change-refused', 'a checkpoint-only change cannot add or alter a lease, its carrier row or the lineage a lease or a run owns: the journal alone writes them');
          }
          b.replaceRows(after);
        },
        force: false,
        verifyDecodable: true,
      });
    });
  }

  /**
   * Opens an agent's activity on a POSITIVE META READ. The meta has no journal event, so the activity becomes durable only
   * through a checkpoint replacement on its own (the revision advances, no journal sequence is invented), and its ID is
   * returned only after that replacement (O1): a crash at any earlier edge discards it, and the same meta later yields the same ID.
   */
  applyPositiveAgentMeta(meta: { parentId: string; parentIncarnation: string; agentId: string }): Promise<DelegationMetaOutcome> {
    return this.enqueue(async () => {
      this.requireReady();
      const box: { result: DelegationMetaOpenResult } = { result: { kind: 'waiting-for-evidence' } };
      const probe = this.builder.clone().openFromMeta(meta.parentId, meta.parentIncarnation, meta.agentId);
      if (probe.kind !== 'opened') return probe;
      const applied = await this.commitLocked({
        items: [],
        mutate: (b) => { box.result = b.openFromMeta(meta.parentId, meta.parentIncarnation, meta.agentId); },
        force: false,
      });
      const result = box.result;
      return result.kind === 'opened' ? { kind: 'opened', activityId: result.activityId, applied } : result;
    });
  }

  /**
   * Opens a Workflow WORKER's activity on a POSITIVE WORKFLOW META read: `applyPositiveAgentMeta`'s sibling, in the same shape and for
   * the same reason (O1, D-4648). The worker's ID exists only in the builder until a checkpoint holding its natural-key mapping and its
   * row has been atomically replaced, so it is probed on a CLONE first (a wait, an already-open worker and a refused index change
   * nothing and write nothing), committed through the one durable application, and returned only after the replacement. No journal
   * event exists for a meta and none is invented: the revision advances and the applied position does not. A worker index that is
   * not a non-negative safe integer is refused by the builder (`bad-shape`) before anything is written, and leaves the applier ready.
   */
  applyPositiveWorkflowMeta(meta: { parentId: string; parentIncarnation: string; runId: string; workerIndex: number }): Promise<DelegationMetaOutcome> {
    return this.enqueue(async () => {
      this.requireReady();
      const box: { result: DelegationMetaOpenResult } = { result: { kind: 'waiting-for-evidence' } };
      const probe = this.builder.clone().openWorkflowWorkerFromMeta(meta.parentId, meta.parentIncarnation, meta.runId, meta.workerIndex);
      if (probe.kind !== 'opened') return probe;
      const applied = await this.commitLocked({
        items: [],
        mutate: (b) => { box.result = b.openWorkflowWorkerFromMeta(meta.parentId, meta.parentIncarnation, meta.runId, meta.workerIndex); },
        force: false,
      });
      const result = box.result;
      return result.kind === 'opened' ? { kind: 'opened', activityId: result.activityId, applied } : result;
    });
  }

  /**
   * Retires bucket cursors past the retention (R58, D-4654; see `planDelegationCursorRetention` for the rule and its two horizons).
   * It is a checkpoint replacement through the one application path (O5 steps 3 to 8; no journal record, no new file, nothing in
   * SQLite but the usual projection), and the decision is taken on the BUILDER's own rows INSIDE the queue, never on a caller's copy:
   * a plan made from an earlier read could drop a cursor that an ingestion has since changed, or write back a stale `replaced`
   * (hand-off 4, R36). Nothing droppable is a no-op that writes nothing. `unparseable` counts the kept rows whose bucket names no hour.
   */
  pruneBucketCursors(nowMs: number): Promise<{ dropped: number; unparseable: number; applied: DelegationApplyOutcome }> {
    return this.enqueue(async () => {
      this.requireReady();
      const box = { dropped: 0, unparseable: 0 };
      const applied = await this.commitLocked({
        items: [],
        mutate: (b) => { Object.assign(box, b.dropBucketCursors(nowMs)); },
        force: false,
      });
      return { ...box, applied };
    });
  }

  /**
   * Retires, under the applier's lock and on the builder's own rows, every `bash-worktree` activity whose call was zero-delta (one measured
   * PreToolUse, then one measured PostToolUse naming the same records), whose identity record is that PreToolUse, which has ended, and which
   * no lease and no lineage row names: row and natural-key mapping together (the O4 amendment, D-6268). A checkpoint replacement through the
   * one application path, like `pruneBucketCursors`: no journal record, no new edge. Nothing retirable writes nothing and encodes nothing.
   * Sound only beside the fold rule that a zero-delta call is never a qualifying join (D-6267): recovery then meets no unmapped join for a
   * retired key while both of the call's records are retained, so wave 4's compaction must keep a listing-carrying Bash call's PreToolUse and
   * PostToolUse together (D-6267, D-6268). One more `commitLocked` caller beside those the applier's other entries list; it never goes through `applyCheckpointChange`.
   */
  retireZeroDeltaBashActivities(): Promise<{ retired: number; applied: DelegationApplyOutcome | null }> {
    return this.enqueue(async () => {
      this.requireReady();
      if (this.builder.retirableZeroDeltaBash().length === 0) return { retired: 0, applied: null };   // idle: no clone, build, encode or write
      const box = { retired: 0 };
      const applied = await this.commitLocked({ items: [], mutate: (b) => { box.retired = b.retireZeroDeltaBash(); }, force: false });
      return { retired: box.retired, applied };
    });
  }

  // ── Session helpers S2 (D-8874; spec 2026-11-19 §7.2): the one-time pass over the broker's old open records ──────────────────────
  // Three entries, each inside the queue on a ready applier, deciding on the durable checkpoint (`delegation-backfill.ts`, L1) with the
  // registry facts the route measured. The dry run writes nothing. The pass, like D-6268's zero-delta retire, is one `commitLocked` whose
  // `mutate` runs the builder's `closeByBackfill`; the undo runs `reopenBackfill` the same way. Neither appends to the journal, whose
  // grammar does not change, so a rebuild from the journal alone reopens what the pass closed; the pass's list, written before its commit
  // and never removed, then bounds the re-run (review 2900 F2).

  /** The pass's list: the ids the first pass closed, or null before any pass. One that does not read refuses (`change-refused`), never
   *  reads as empty or absent: either would let a re-run choose again. */
  private async readBackfillList(): Promise<ReadonlySet<string> | null> {
    const file = path.join(this.deps.dir, DELEGATION_BACKFILL_FILE);
    const bytes = await this.port.readFile(file);
    if (bytes === null) return null;
    const got = decodeBackfillList(bytes);
    if (!got.ok) refuse('change-refused', `${file} cannot be used (${got.detail}): nothing was closed or reopened; the operator mends or removes it`);
    return got.ids;
  }

  /** The list, written whole and durable BEFORE the pass's commit (temp file, fsync, rename, directory fsync): a death between the two
   *  leaves ids listed and not closed, which the re-run closes; never ids closed and not listed. */
  private async writeBackfillList(at: string, ids: readonly string[]): Promise<void> {
    const file = path.join(this.deps.dir, DELEGATION_BACKFILL_FILE);
    const temp = `${file}.tmp`;
    const bytes = encodeBackfillList(at, ids);
    const handle = await this.port.createTemp(temp);
    try {
      const n = await handle.write(bytes);
      if (n !== bytes.length) throw new DelegationJournalError('short-write', `wrote ${n} of ${bytes.length} bytes of ${file}`);
      await handle.sync();
    } finally {
      await handle.close().catch(() => undefined);
    }
    await this.port.rename(temp, file);
    await this.port.fsyncDir(this.deps.dir);
  }

  /** Review 3026 F4: the natural keys (encoded) of every Agent final task notification the retained set holds, read OUTSIDE the queue (the
   *  coordinator's condition: nothing the watcher applies waits for it) and cut at `DELEGATION_BACKFILL_SCAN_MS` by the injected clock. Read
   *  only, through the applier's one reader of the retained set (`retainedRecords`): the journal is append-only and a compaction replaces it by rename, so the read sees one retained
   *  set or refuses; a read that refuses or is cut answers `complete: false`, and the count is then unmeasured, never partial. */
  private async retainedTaskReportKeys(): Promise<{ keys: Set<string>; complete: boolean }> {
    const keys = new Set<string>();
    const deadline = this.deps.now() + DELEGATION_BACKFILL_SCAN_MS;
    try {
      for await (const record of this.retainedRecords()) {
        if (this.deps.now() > deadline) return { keys, complete: false };
        const entry = record.entry;
        if (entry.kind !== 'evidence-accepted') continue;
        const key = taskReportKey(entry.event);
        if (key !== null) keys.add(encodeDelegationNaturalKey(key));
      }
    } catch { return { keys, complete: false }; }
    return { keys, complete: true };
  }

  /** The dry run (spec §7.2, condition 4): the report the pass would act on now, with the F4 count from the retained journal, read first
   *  and outside the queue. Inside it only the list is read and the plan decided on the checkpoint. Writes nothing. */
  async backfillDryRun(nowMs: number, parents: ReadonlyMap<string, DelegationBackfillParent>): Promise<DelegationBackfillReport> {
    const reported = await this.retainedTaskReportKeys();
    return this.enqueue(async () => {
      this.requireReady();
      const listed = await this.readBackfillList();
      return planDelegationBackfill({ checkpoint: this.current.checkpoint as DelegationCheckpointV1, nowMs, parents, listed, reported }).report;
    });
  }

  /** The pass. It closes only when `closes` is the count it would close now (the dry run's), and records the ids first, on its first run. */
  backfillPass(nowMs: number, parents: ReadonlyMap<string, DelegationBackfillParent>, closes: number): Promise<DelegationBackfillPassOutcome> {
    return this.enqueue(async (): Promise<DelegationBackfillPassOutcome> => {
      this.requireReady();
      const listed = await this.readBackfillList();
      const plan = planDelegationBackfill({ checkpoint: this.current.checkpoint as DelegationCheckpointV1, nowMs, parents, listed, reported: null });
      if (plan.report.closes !== closes) return { ok: false, report: plan.report };
      if (plan.close.length === 0) return { ok: true, closed: 0, report: plan.report, applied: null };   // idempotent: nothing written
      if (listed === null) await this.writeBackfillList(formatDelegationInstant(nowMs), plan.close);
      const box = { closed: 0 };
      const applied = await this.commitLocked({ items: [], mutate: (b) => { box.closed = b.closeByBackfill(plan.close); }, force: false, rowsChanged: true });
      return { ok: true, closed: box.closed, report: plan.report, applied };
    });
  }

  /** The undo: every record the pass closed, open again. The list stays, so the pass stays one-time. Nothing to reopen writes nothing. */
  backfillUndo(): Promise<{ reopened: number; applied: DelegationApplyOutcome | null }> {
    return this.enqueue(async () => {
      this.requireReady();
      if (!this.current.checkpoint.activities.some((a) => a.endBasis === 'backfill-unmeasured')) return { reopened: 0, applied: null };
      const box = { reopened: 0 };
      const applied = await this.commitLocked({ items: [], mutate: (b) => { box.reopened = b.reopenBackfill(); }, force: false, rowsChanged: true });
      return { reopened: box.reopened, applied };
    });
  }

  /**
   * THE UPKEEP DOOR (wave 4, Task 3.1): the interval upkeep, the cursor retention and the zero-delta retirement as ONE commit, instead of the
   * hourly whole-checkpoint replace that `applyCheckpointChange` made for the intervals. It decides read-only on the live builder's own rows,
   * under the lock (as `retireZeroDeltaBashActivities` does): when no requested part has anything to do it answers `applied: null` and makes
   * no clone, build or encode. Otherwise it makes one `commitLocked` whose `mutate` runs `upkeepIntervals`, `dropBucketCursors` and
   * `retireZeroDeltaBash`, in that order, with `rowsChanged`, since a due part always changes a row. No `verifyDecodable` and no
   * `structuredClone`: the rows are the builder's own, as in `pruneBucketCursors`.
   */
  upkeep(req: DelegationUpkeepRequest): Promise<DelegationUpkeepOutcome> {
    return this.enqueue(async () => {
      this.requireReady();
      const cp = this.current.checkpoint;
      const up = req.intervals ? upkeepDelegationIntervals(cp.observationIntervals, req.nowMs) : { intervals: cp.observationIntervals, changed: false };
      const cursorPlan = req.cursors ? planDelegationCursorRetention(cp.bucketCursors, up.intervals, req.nowMs) : null;
      const out: DelegationUpkeepOutcome = { intervalsChanged: false, cursorsDropped: 0, cursorsUnparseable: cursorPlan?.unparseable.length ?? 0, retired: 0, applied: null };
      const zeroDue = req.zeroDelta && this.builder.retirableZeroDeltaBash().length > 0;
      if (!up.changed && (cursorPlan === null || cursorPlan.drop.length === 0) && !zeroDue) return out;   // idle: no clone, build, encode or write
      out.applied = await this.commitLocked({
        items: [],
        mutate: (b) => {
          if (req.intervals) out.intervalsChanged = b.upkeepIntervals(req.nowMs);
          if (req.cursors) { const r = b.dropBucketCursors(req.nowMs); out.cursorsDropped = r.dropped; out.cursorsUnparseable = r.unparseable; }
          if (req.zeroDelta) out.retired = b.retireZeroDeltaBash();
        },
        force: false,
        rowsChanged: true,
      });
      return out;
    });
  }

  /**
   * JOURNAL COMPACTION (wave 4, D-7000, D-7001, D-6999, D-7021; armed on landing, D-7022). Inside the queue, on a ready applier, each step made
   * durable before the next:
   *   1. `compact-plan`: the retained set (carried file, then journal) through `DelegationCompactionPlanner`; stop on `nothing-to-cut` or
   *      `below-share`;
   *   2. `carried-write`, `carried-fsync`: `delegation-carried.log.tmp` holds the plan's carried lines, copied verbatim from their files;
   *   3. `carried-rename`, `carried-directory-fsync`;
   *   4. `writer-close`: nothing can append, the queue is held;
   *   5. `journal-copy`, `journal-copy-fsync`: the journal's bytes from record S+1 to its end into `delegation-events.log.tmp`;
   *   6. `journal-rename`, `journal-directory-fsync`;
   *   7. `memory-prune`: the event IDs, the evidence index and the builder's facts of the cut records leave, so the live state equals what a
   *      recovery over the compacted set rebuilds;
   *   8. `writer-reopen`;
   *   9. `events-delete` (SQLite's cut rows, in the gaps between the carried evidence), then the retirement commit (C1, `retireBehindCut`).
   * The carried file is renamed FIRST: a crash between the two renames leaves it beside the uncut journal, its lines at or above the journal's
   * first sequence copies of journal lines that every reader matches and skips; renamed second, such a crash would lose the carried records.
   * D-7015: a failure before the carried rename removes both temps (best effort), replaces the writer and leaves the applier ready. Once
   * the carried rename is attempted, a failure fails the applier: a later compaction can drop old carried evidence, so the live indexes may
   * be ahead of disk even while the journal is byte-identical. Recovery over the files is the one source of truth. A SQLite failure at
   * `events-delete` fails nothing: it marks the projection stale, and the repair's step 0 finishes the job.
   * D-7022 rollback is conditional, not a grammar refusal: an older reader ignores the carried file. A cut lease-created record can
   * refuse `lease-proof`, or a cut identity-candidate hold's first record can refuse `held-evidence-missing`; otherwise recovery can be
   * ready on the journal alone, and its repair can wipe and replay that journal alone. On return this build reads the carried evidence
   * again and repairs it into SQLite. The pre-compaction snapshot remains the restore point when restored with this build's helper.
   */
  compactJournal(nowMs: number, floorMs: number): Promise<DelegationCompactionOutcome> {
    return this.enqueue(async () => {
      if (!this.pruningEnabled()) return { kind: 'skipped', reason: 'not-ready', plan: null };
      const started = this.fullClock();
      const carriedTemp = `${this.carriedPath}.tmp`;
      const journalTemp = `${this.journalPath}.tmp`;
      let renamed = false;
      try {
        const plan = await this.edge('compact-plan', () => this.planCompactionLocked(nowMs, floorMs));
        if (plan.cutThrough === 0) return { kind: 'skipped', reason: 'nothing-to-cut', plan };
        if (!plan.worthwhile) return { kind: 'skipped', reason: 'below-share', plan };
        await this.writeCarriedLocked(plan, carriedTemp);
        await this.edge('carried-rename', async () => {
          renamed = true;                                   // D-7015: either file may now differ from the live indexes; re-recover on failure
          await this.port.rename(carriedTemp, this.carriedPath);
        });
        await this.edge('carried-directory-fsync', () => this.port.fsyncDir(this.deps.dir));
        await this.edge('writer-close', () => this.writer.close());
        await this.copySuffixLocked(plan.suffixOffset, journalTemp);
        await this.deps.onEdge?.('journal-rename', 'before');
        await this.port.rename(journalTemp, this.journalPath);
        await this.deps.onEdge?.('journal-rename', 'after');
        await this.edge('journal-directory-fsync', () => this.port.fsyncDir(this.deps.dir));
        await this.edge('memory-prune', () => {
          for (const id of plan.cutEvidenceEventIds) this.eventIds.delete(id);
          this.evidence.dropThrough(plan.cutThrough, plan.carriedEvidenceSequences);
          this.builder.dropCutFacts(plan.cutThrough, new Set(plan.carried.map((l) => l.journalId)));
          this.retainedFrom = plan.cutThrough + 1;
        });
        await this.edge('writer-reopen', () => { this.writer = new DelegationJournalWriter(this.port, this.journalPath, this.deps.dir); });
        const eventsDeleted = await this.edge('events-delete', () => this.deleteCutEventsLocked(plan));
        const retired = await this.retireBehindCutLocked(plan);
        return { kind: 'compacted', plan, eventsDeleted, retired, ms: Math.max(0, this.fullClock() - started) };
      } catch (err) {
        if (renamed) { if (this.failureNow === null) this.fail(err); throw err; }
        await this.port.removeTemp(carriedTemp).catch(() => undefined);
        await this.port.removeTemp(journalTemp).catch(() => undefined);
        await this.writer.close().catch(() => undefined);
        this.writer = new DelegationJournalWriter(this.port, this.journalPath, this.deps.dir);
        throw err;
      }
    });
  }

  /** Step 1: the plan, from one stream of the retained set. */
  private async planCompactionLocked(nowMs: number, floorMs: number): Promise<DelegationCompactionPlan> {
    const planner = new DelegationCompactionPlanner({ checkpoint: this.current.checkpoint, ready: this.pruningEnabled(), nowMs, floorMs, naming: delegationRecordNaming });
    let journalBytes = 0;
    let currentCarriedBytes = 0;
    let currentCarriedLines = 0;
    for await (const line of readDelegationRetainedRecords(this.port, this.carriedPath, this.journalPath, undefined, (bytes, lines) => { currentCarriedBytes = bytes; currentCarriedLines = lines; })) {
      if (line.source === 'carried') { planner.addCarried(line.record, line); continue; }
      planner.add(line.record, line);
      journalBytes = line.offset + line.length;
    }
    return planner.finish(journalBytes, { bytes: currentCarriedBytes, lines: currentCarriedLines });
  }

  /** Step 2: the carried lines, copied verbatim from their files by position (adjacent lines of one file in one read), into the temp. */
  private async writeCarriedLocked(plan: DelegationCompactionPlan, temp: string): Promise<void> {
    const held: { out: DelegationFileHandle | null; carried: DelegationReadHandle | null; journal: DelegationReadHandle | null } = { out: null, carried: null, journal: null };
    try {
      await this.edge('carried-write', async () => {
        held.out = await this.port.createTemp(temp);
        let planned = 0;
        let written = 0;
        for (let i = 0; i < plan.carried.length;) {
          const first = plan.carried[i]!;
          let end = first.offset + first.length;
          let j = i + 1;
          while (j < plan.carried.length && plan.carried[j]!.source === first.source && plan.carried[j]!.offset === end) { end += plan.carried[j]!.length; j++; }
          const src = first.source === 'carried'
            ? (held.carried ??= await this.port.openRead(this.carriedPath))
            : (held.journal ??= await this.port.openRead(this.journalPath));
          const bytes = src === null ? new Uint8Array(0) : await src.read(first.offset, end - first.offset);
          planned += end - first.offset;
          if (bytes.length !== end - first.offset || bytes[bytes.length - 1] !== 0x0a) break;
          written += await held.out.write(bytes);
          i = j;
        }
        if (written !== planned || planned !== plan.carriedBytes) throw new DelegationJournalError('short-copy', `the carried file got ${written} of the ${plan.carriedBytes} bytes planned`);
      });
      await this.edge('carried-fsync', async () => { await held.out?.sync(); });
    } finally {
      await held.out?.close().catch(() => undefined);
      await held.carried?.close().catch(() => undefined);
      await held.journal?.close().catch(() => undefined);
    }
  }

  /** Step 5: the journal's bytes from `offset` (record S+1) to its end as measured now, in 256 KiB chunks, into the temp. */
  private async copySuffixLocked(offset: number, temp: string): Promise<void> {
    const held: { out: DelegationFileHandle | null; src: DelegationReadHandle | null } = { out: null, src: null };
    try {
      await this.edge('journal-copy', async () => {
        held.src = await this.port.openRead(this.journalPath);
        if (held.src === null) throw new DelegationJournalError('short-copy', 'the journal vanished before its copy');
        const size = await held.src.size();
        held.out = await this.port.createTemp(temp);
        let written = 0;
        let lastByte = -1;
        for (let at = offset; at < size;) {
          const chunk = await held.src.read(at, Math.min(1 << 18, size - at));
          if (chunk.length === 0) break;
          at += chunk.length;
          lastByte = chunk[chunk.length - 1]!;
          written += await held.out.write(chunk);
        }
        if (written !== size - offset) throw new DelegationJournalError('short-copy', `the journal copy wrote ${written} of ${size - offset} bytes`);
        if (lastByte !== 0x0a) throw new DelegationJournalError('torn-tail', 'the journal copy does not end in LF');
      });
      await this.edge('journal-copy-fsync', async () => { await held.out?.sync(); });
    } finally {
      await held.out?.close().catch(() => undefined);
      await held.src?.close().catch(() => undefined);
    }
  }

  /** Step 9, the first half: SQLite's cut evidence rows. A store failure marks the projection stale and warns; it never fails the applier. */
  private async deleteCutEventsLocked(plan: DelegationCompactionPlan): Promise<number> {
    const projection = this.deps.projection;
    if (projection === null) return 0;
    try {
      return await deleteEventsInGaps(projection, plan.cutThrough, plan.carriedEvidenceSequences, this.deps.eventsDeleteChunk ?? DELEGATION_EVENTS_DELETE_CHUNK);
    } catch (err) {
      this.projectionStale = true;
      this.projectedRevision = null;
      this.deps.warn?.(`ccrc-server: delegation compaction: the delegation_events delete failed, the repair finishes it: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }

  /** Step 9, the second half (Task 3.5): one commit retiring what the plan found retirable, after the cut is durable. A refusal or failure is
   *  warned and counts 0: the cut stands, and the next day's compaction retires them (a row the journal no longer names is valid, O4). */
  private async retireBehindCutLocked(plan: DelegationCompactionPlan): Promise<number> {
    if (plan.retirable.length === 0) return 0;
    const box = { retired: 0 };
    try {
      await this.commitLocked({ items: [], mutate: (b) => { box.retired = b.retireBehindCut(plan.retirable); }, force: false, rowsChanged: true });
      return box.retired;
    } catch (err) {
      this.deps.warn?.(`ccrc-server: delegation compaction: the retirement of ended activities failed: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }

  /**
   * The serialized journal adapter for a lease. It DEDUPLICATES first (an unreleased identity already held answers
   * `duplicate`; a canonical path held by another identity is REFUSED, since nothing releases a lease in wave 3 and the
   * active-path index would otherwise fail every later projection), and only then calls the injected `randomUUID`, exactly once.
   * It derives the lineage ID, constructs the generation-0 `lease-created` entry with the request's `firstObservedAt`, appends and
   * fsyncs it, checkpoints it, and projects it. Pure policy never sees a UUID.
   */
  createLease(request: DelegationLeaseCreationRequest): Promise<DelegationLeaseOutcome> {
    return this.enqueue(async () => {
      this.requireReady();
      const bad = this.validateLeaseRequest(request);
      if (bad !== null) return bad;
      const identity = delegationLeaseIdentityKey(request);
      const same = this.builder.leaseView().byIdentity(identity);
      if (same !== undefined) return { kind: 'duplicate', leaseId: same };
      const holder = this.builder.leaseView().byPath(request.canonicalPath);
      if (holder !== undefined) {
        return { kind: 'refused', reason: 'canonical-path-held', detail: `the canonical path is held by the unreleased lease ${holder}`, heldBy: holder };
      }
      const leaseId = this.deps.randomUUID();                       // exactly once, after deduplication
      const lineageId = deriveDelegationLineageId({ leaseId, parentId: request.parentId, parentIncarnation: request.parentIncarnation, activityId: request.activityId });
      const entry: DelegationJournalEntryV1 = {
        kind: 'lease-created', leaseId, generation: 0, activityId: request.activityId, parentId: request.parentId,
        parentIncarnation: request.parentIncarnation, project: request.project, adminRecord: request.adminRecord, canonicalPath: request.canonicalPath,
        creationBase: request.creationBase, sourceKind: request.sourceKind, correlationJournalIds: [...request.correlationJournalIds],
        firstObservedAt: request.firstObservedAt, lineageId,
      };
      const applied = await this.commitLocked({ items: [{ entry, acceptedAt: nowInstant(this.deps.now()) }], mutate: null, force: false });
      const record = applied.appended.find((r) => r.entry.kind === 'lease-created');
      // Unreachable: the identity and path were checked against the very leases the planner reads. If it ever happens the
      // minted UUID names no lease, and no answer built from it may leave this method.
      if (record === undefined) throw new Error(`the append plan skipped the lease-created entry for the minted lease ${leaseId}`);
      return { kind: 'created', leaseId, lineageId, sequence: record.sequence, applied };
    });
  }

  // ── PR5b: the lease doors, beside createLease ──────────────────────────────────────────────────────────────────────
  //
  // Each runs in `createLease`'s shape: on the queue, ready or refused `not-ready`, decided by the SAME L1 decision the replay fold uses
  // (`delegation-lease-state.ts`), one entry built from that decision, one `commitLocked`, answered with the record's sequence. A request
  // whose act and `expectGeneration + 1` already wrote the lease's current generation, with the same identity (a promote's run, a
  // release's reason: D-8026, live only), is its own replay and answers `unchanged`, appending nothing (spec §5.12); one that differs falls
  // through to the decision, which refuses it (`stale-generation`, or `lease-released` for a release). A request the fold calls bad (an
  // `adopt` with no `terminalEvidenceAt`, a keep with no `expiresAt`, a `transfer` with no run) rejects the promise with `fold-refused`,
  // as `createLease`'s does, and appends nothing: it is never a `refused` answer. None of them calls `randomUUID`.

  /** A lease transition: the table's row for `req.reason`, with the request's own `carrierRequired` (D-7806). */
  transitionLease(req: DelegationLeaseTransitionRequest): Promise<DelegationLeaseActOutcome> {
    return this.enqueue(async () => {
      const unready = this.leaseActUnready();
      if (unready !== null) return unready;
      const { lease, carrier, lastAct } = this.builder.leaseActView(req.leaseId);
      if (lease !== undefined && lease.generation === req.expectGeneration + 1 && lastAct === req.reason
        && (req.reason !== 'promote' || carrier?.promotedRun === req.runId)) {                 // D-8026: the same run's promote, only
        return { kind: 'unchanged', leaseId: req.leaseId, generation: lease.generation, state: delegationCarrierStateOf(lease, carrier) };
      }
      const d = decideLeaseTransition(lease, carrier, { reason: req.reason, expectGeneration: req.expectGeneration, carrierRequired: req.carrierRequired });
      if (!d.ok) return { kind: 'refused', refusal: d.refusal, detail: d.detail };
      const promote = req.reason === 'promote';         // review 1462 M6: the request carries neither lineage field; promote derives both
      const mismatch = promote ? promoteRunMismatch(carrier, req.runId) : null;       // live only, never replay's (D-8024)
      if (mismatch !== null) return { kind: 'refused', refusal: 'wrong-disposition', detail: mismatch };
      const entry: DelegationJournalEntryV1 = {
        kind: 'lease-transition', leaseId: req.leaseId, generation: d.generation, reason: req.reason, to: d.to, at: req.at,
        expiresAt: req.expiresAt, terminalEvidenceAt: req.terminalEvidenceAt, runId: req.runId, promotedSession: req.promotedSession,
        auditEvidence: req.auditEvidence, lineageClose: promote ? 'transfer' : null, lineageOpenRun: promote ? req.runId : null,
        resolvesThrough: req.resolvesThrough,
      };
      return this.commitLeaseAct(entry, d.to);
    });
  }

  /** A lease release (`decideLeaseRelease`): any unreleased state but `transferring`. It frees the lease's identity and canonical path. */
  releaseLease(req: DelegationLeaseReleaseRequest): Promise<DelegationLeaseActOutcome> {
    return this.enqueue(async () => {
      const unready = this.leaseActUnready();
      if (unready !== null) return unready;
      const { lease, carrier } = this.builder.leaseActView(req.leaseId);
      // Nothing follows a release, so a released lease one generation past the request, for the request's reason, is its replay.
      if (lease !== undefined && lease.releasedAt !== null && lease.generation === req.expectGeneration + 1
        && carrier?.releaseReason === req.releaseReason) {                                     // D-8026: the same reason's release, only
        return { kind: 'unchanged', leaseId: req.leaseId, generation: lease.generation, state: 'released' };
      }
      const d = decideLeaseRelease(lease, carrier, { expectGeneration: req.expectGeneration });
      if (!d.ok) return { kind: 'refused', refusal: d.refusal, detail: d.detail };
      return this.commitLeaseAct({
        kind: 'lease-released', leaseId: req.leaseId, generation: d.generation, releaseReason: req.releaseReason, at: req.at,
        lastHeadSha: req.lastHeadSha, resolvesThrough: req.resolvesThrough,
      }, 'released');
    });
  }

  /** The box's carrier was read back at `generation`: decided by `foldLeaseCarrierSeen`, the replay fold's own decision, a released
   *  lease included (review 1451 F9). A generation it already holds (or a lower one) changes nothing and answers `unchanged`. */
  noteCarrierSeen(req: { leaseId: string; generation: number; at: string }): Promise<DelegationLeaseActOutcome> {
    return this.enqueue(async () => {
      const unready = this.leaseActUnready();
      if (unready !== null) return unready;
      const { lease, carrier } = this.builder.leaseActView(req.leaseId);
      const entry = { kind: 'lease-carrier-seen', leaseId: req.leaseId, generation: req.generation, at: req.at } as const;
      const seen = foldLeaseCarrierSeen(lease, entry);
      if (!seen.ok) return { kind: 'refused', refusal: seen.refusal, detail: seen.detail };
      const state = delegationCarrierStateOf(seen.lease, carrier);
      if (seen.lease === lease) return { kind: 'unchanged', leaseId: req.leaseId, generation: seen.lease.generation, state };
      return this.commitLeaseAct(entry, state);
    });
  }

  /** The lease doors' `not-ready`, as an answer rather than `requireReady`'s throw, so a caller reads one outcome union. */
  private leaseActUnready(): DelegationLeaseActOutcome | null {
    if (this.current.phase === 'ready' && this.failureNow === null) return null;
    return { kind: 'refused', refusal: 'not-ready', detail: this.failureNow === null ? 'the applier is reconstructing' : `${this.failureNow.phase}: ${this.failureNow.detail}` };
  }

  /** One lease entry made durable (journal, checkpoint, projection) through `commitLocked`; the fold re-decides it on the clone. */
  private async commitLeaseAct(entry: Exclude<DelegationJournalEntryV1, { kind: 'evidence-accepted' | 'lease-created' }>, state: DelegationCarrierState): Promise<DelegationLeaseActOutcome> {
    const applied = await this.commitLocked({ items: [{ entry, acceptedAt: nowInstant(this.deps.now()) }], mutate: null, force: false });
    const record = applied.appended.find((r) => r.entry.kind === entry.kind);
    // Unreachable: the append planner skips only evidence and creations. If it ever happens nothing was journalled, and no answer may say so.
    if (record === undefined) throw new Error(`the append plan skipped the ${entry.kind} entry for lease ${entry.leaseId}`);
    const lease = this.builder.leaseActView(entry.leaseId).lease;
    return { kind: 'applied', leaseId: entry.leaseId, generation: lease?.generation ?? entry.generation, state, sequence: record.sequence, applied };
  }

  private validateLeaseRequest(r: DelegationLeaseCreationRequest): DelegationLeaseOutcome | null {
    const unmeasured = (detail: string): DelegationLeaseOutcome => ({ kind: 'refused', reason: 'unmeasured-request', detail });
    for (const [name, v] of [['activityId', r.activityId], ['parentId', r.parentId], ['parentIncarnation', r.parentIncarnation], ['project', r.project],
      ['adminRecord', r.adminRecord], ['canonicalPath', r.canonicalPath]] as const) {
      if (typeof v !== 'string' || v === '') return unmeasured(`${name} is not a measured non-empty string`);
    }
    if (r.creationBase !== null && (typeof r.creationBase !== 'string' || r.creationBase === '')) return unmeasured('creationBase is neither null nor a non-empty string');
    if (!isMember(WAVE3_LEASE_SOURCE_KINDS, r.sourceKind)) return unmeasured(`wave 3 writes only ${WAVE3_LEASE_SOURCE_KINDS.join(', ')} leases`);
    if (!isLowerHex64(r.activityId) || !Array.isArray(r.correlationJournalIds) || !r.correlationJournalIds.every((id) => isLowerHex64(id))) {
      return unmeasured('an ID is not a lowercase 64-hex SHA-256');
    }
    try { parseDelegationInstant(r.firstObservedAt); } catch { return unmeasured('firstObservedAt is not a canonical UTC millisecond instant'); }
    const activity = this.builder.activityOf(r.activityId);
    if (activity === undefined || activity.parentId !== r.parentId || activity.parentIncarnation !== r.parentIncarnation) {
      return { kind: 'refused', reason: 'unmeasured-activity', detail: 'the checkpoint holds no such activity for that parent' };
    }
    if (leaseSourceKindOfActivity(activity.sourceKind) !== r.sourceKind) {
      return { kind: 'refused', reason: 'source-kind-mismatch', detail: `an ${activity.sourceKind} activity's lease is ${leaseSourceKindOfActivity(activity.sourceKind)}, not ${r.sourceKind}` };
    }
    if (this.builder.isZeroDeltaBashCall(activity)) {
      return { kind: 'refused', reason: 'zero-delta-call', detail: 'a zero-delta Bash call created no worktree: it is never a lease activity' };
    }
    return null;
  }

  // ── the one durable application ────────────────────────────────────────────────────────────────────────────────────

  private fail(err: unknown): void {
    this.failureNow = { phase: 'durable-application', code: err instanceof DelegationJournalError ? err.code : 'application-failed' satisfies DelegationOwnFailureCode, detail: err instanceof Error ? err.message : String(err) };
    this.current = { checkpoint: this.current.checkpoint, phase: 'reconstructing' };
    void this.writer.close().catch(() => undefined);
    this.deps.warn?.(`ccrc-server: delegation durable application failed: ${this.failureNow.detail}`);
  }

  /** Runs inside the queue. Plans, folds and validates everything BEFORE the first byte is written, then performs O5's steps. */
  private async commitLocked(args: {
    items: readonly DelegationAppendItem[];
    mutate: ((b: DelegationCheckpointBuilder) => void) | null;
    force: boolean;
    /** False only for recovery's own save, which repairs the whole projection afterwards instead. */
    project?: boolean;
    /** True when rows came from a caller (a checkpoint-only change) rather than the fold: the bytes are then read back through the
     *  strict decoder BEFORE anything is written, so a checkpoint recovery could not read is never made durable. */
    verifyDecodable?: boolean;
    /** Task 3.1: the caller's door removed or replaced a row (it decided so on the live builder, under this lock), so the no-op compare is
     *  skipped. Like the `appends` skip it can only cause a write, never suppress one. */
    rowsChanged?: true;
  }): Promise<DelegationApplyOutcome> {
    const plan = planDelegationJournalAppend({ head: this.head, eventIds: this.eventIds, leases: this.builder.leaseView(), items: args.items });
    // What `evidence` MEANS: the count of evidence records the retained JOURNAL holds, so the repair can set SQLite's (count, max)
    // against it. It therefore changes when the journal does, with `eventIds` and `head`, after the durable point, and never before
    // (a count of records not yet written would be a count of nothing). Its one invariant (strictly increasing) is proved HERE, before
    // step 1, where a refusal costs nothing, so that adopting it afterwards cannot throw out of an application that is already durable.
    const evidenceSequences = plan.records.filter((r) => r.entry.kind === 'evidence-accepted').map((r) => r.sequence);
    // A refusal here is the APPLIER's own state disagreeing with its journal (the index ran ahead), not a bad input: so it fails the
    // applier (Task 8A re-review 2), and the recovery that follows rebuilds the index from the journal, instead of refusing every later
    // application that carries evidence for ever. Nothing has been written yet.
    try { this.evidence.assertExtendedBy(evidenceSequences); } catch (err) { this.fail(err); throw err; }
    const next = this.builder.clone();
    for (const record of plan.records) next.foldRecord(record);
    args.mutate?.(next);
    const prior = this.current.checkpoint;
    const checkpoint = next.build(prior.revision + 1);
    // THE NO-OP COMPARE, and when it is skipped (D-4658, coordinator 5443 condition 4). It protects against ONE thing: writing (and
    // projecting, and spending a revision on) an application that changed nothing, such as a re-applied bucket whose events all dedupe.
    // It costs two whole-checkpoint canonical encodings, so it is skipped when its answer is already known: when the APPLIED JOURNAL
    // POSITION of the built state differs from the prior's, the two states differ, so the application is not a no-op whatever else it
    // carries. "Appends" is decided from the two MEASURED states' positions (the fold of the records the planner actually kept), never
    // from the caller's word (the items it handed over may all dedupe away). And a skip can only ever cause a write, never suppress one:
    // a change that replaces or removes rows without appending always runs the compare.
    const appends = checkpoint.appliedJournalSequence !== prior.appliedJournalSequence;
    const known = appends || args.rowsChanged === true;
    if (!known) this.measuredEncodes += 2;
    const sameAsPrior = !known && canonicalDelegationJson({ ...checkpoint, revision: 0 }) === canonicalDelegationJson({ ...prior, revision: 0 });
    if (plan.records.length === 0 && sameAsPrior && !args.force) {
      return { state: this.current, appended: [], skipped: plan.skipped, openedActivities: [], durable: false, projection: { status: 'unprojected' } };
    }
    this.measuredEncodes += 1;
    const bytes = encodeDelegationCheckpoint(checkpoint);
    this.measuredWrites += 1;
    this.measuredBytes = bytes.length;
    if (args.verifyDecodable === true) {
      this.measuredEncodes += 1;                           // the strict decoder re-encodes the checkpoint it read, to prove it canonical
      decodeDelegationCheckpoint(bytes);
    }
    next.revision = checkpoint.revision;

    try {
      for (const record of plan.records) {
        await this.edge('journal-write', () => this.writer.write(record));          // step 1
        await this.edge('journal-fsync', () => this.writer.sync());                // step 2
      }
      await this.edge('build', () => bytes);                                        // step 3
      await this.replaceCheckpoint(bytes);                                          // steps 4 to 7
    } catch (err) {
      this.fail(err);
      throw err;
    }

    // Durable. Only now does anything of this application become visible.
    const before = new Set(prior.activities.map((a) => a.activityId));
    this.builder = next;
    this.current = { checkpoint, phase: 'ready' };
    const last = plan.records[plan.records.length - 1];
    if (last !== undefined) this.head = { sequence: last.sequence, journalId: last.journalId, digest: last.digest };
    this.retainedFrom ??= plan.records[0]?.sequence ?? null;
    for (const r of plan.records) if (r.entry.kind === 'evidence-accepted') this.eventIds.add(r.entry.event.eventId);
    this.evidence.extend(evidenceSequences);
    const rows = plan.records.filter((r) => r.entry.kind === 'evidence-accepted').map(delegationEventRowOfRecord);
    const projection: DelegationApplyOutcome['projection'] = args.project === false ? { status: 'unprojected' } : await this.projectLocked(prior, checkpoint, rows);
    return {
      state: this.current, appended: plan.records, skipped: plan.skipped,
      openedActivities: checkpoint.activities.filter((a) => !before.has(a.activityId)), durable: true, projection,
    };
  }

  /** O5 steps 4 to 7: the temp file in the checkpoint's own directory, its fsync, the atomic rename, the directory fsync. */
  private async replaceCheckpoint(bytes: Uint8Array): Promise<void> {
    await this.port.mkdirp(this.deps.dir);
    const held: { handle: DelegationFileHandle | null } = { handle: null };
    try {
      await this.edge('checkpoint-write', async () => {
        held.handle = await this.port.createTemp(this.tempPath);
        const n = await held.handle.write(bytes);
        if (n !== bytes.length) throw new DelegationJournalError('short-write', `wrote ${n} of ${bytes.length} checkpoint bytes`);
      });
      await this.edge('checkpoint-fsync', async () => { await held.handle?.sync(); });
    } finally {
      await held.handle?.close().catch(() => undefined);
    }
    await this.edge('checkpoint-rename', () => this.port.rename(this.tempPath, this.checkpointPath));
    await this.edge('directory-fsync', () => this.port.fsyncDir(this.deps.dir));
  }

  /**
   * O5 step 8. Never throws: SQLite is repairable output, so a failure here marks it stale and the next application repairs it.
   *
   * THE WITNESS. After the stale branch (kept first, exactly as it was), the projection is written as the ROWS THAT CHANGED
   * (`projectChanged(prior, checkpoint)`) when `projectedRevision === prior.revision`, that is, when the last thing this applier made the
   * projection say was the checkpoint this one replaces; otherwise as the whole checkpoint (`project`). Two facts make the witness
   * enough, so that once the stale branch has passed it always holds and the `project` arm is defensive:
   *   - stale implies a null witness: every site that sets `projectionStale = true` also nulls `projectedRevision` (`repairLocked`'s catch,
   *     the conflict arm and the catch below), and `projectedRevision` is set only after a successful full repair (which clears stale
   *     first) or by the non-stale arm below;
   *   - `recover()` resolves its own clear of the witness: it either reaches `repairLocked()`, which sets the witness or marks the
   *     projection stale, or it returns with `failureNow` set, and then `requireReady` refuses every `commitLocked` caller until a
   *     `recover()` succeeds.
   * The delta runs inside the existing `project` edge (no edge is added), before `insertEvents`; a store refusal inside it lands in the
   * catch below like any other failure: stale, and the next application's full repair heals it. Repairs (`repairDelegationProjection`,
   * the per-session heal, the wipe, recovery's, the bare `repairProjection()`) stay full.
   */
  private async projectLocked(prior: DelegationCheckpointV1, checkpoint: DelegationCheckpointV1, rows: readonly DelegationEventRow[]): Promise<DelegationApplyOutcome['projection']> {
    const projection = this.deps.projection;
    if (projection === null) return { status: 'unprojected' };
    try {
      await this.edge('project', async () => {
        if (this.projectionStale) {
          await this.repairLocked();
          if (this.projectionStale) throw new Error('the projection repair did not complete');
          return;
        }
        if (this.projectedRevision === prior.revision) projection.projectChanged(prior, checkpoint);
        else projection.project(checkpoint);
        const r = projection.insertEvents(rows);
        if (r.conflicts.length > 0) {
          for (const c of r.conflicts) this.drifted.set(JSON.stringify([c.sessionId, c.parentIncarnation]), { sessionId: c.sessionId, incarnation: c.parentIncarnation });
          this.projectionStale = true;
          this.projectedRevision = null;
          throw new Error(`${r.conflicts.length} event(s) conflict with SQLite's rows`);
        }
        this.projectedRevision = checkpoint.revision;
      });
      return { status: 'projected' };
    } catch (err) {
      this.projectionStale = true;
      this.projectedRevision = null;
      const error = err instanceof Error ? err.message : String(err);
      this.deps.warn?.(`ccrc-server: delegation projection stale: ${error}`);
      return { status: 'failed', error };
    }
  }

  /** D-7878: latch before draining the admitted queue; a late producer must not reopen the journal writer.
   *  Production `server.ts` onClose does not await the watcher's closeDelegation today; that integration remains a rider. */
  close(): Promise<void> {
    return this.closing ??= this.queue.then(() => this.writer.close());
  }
}

// ── The words this file spells, for the coordination scanner ─────────────────────────────────────────────────────────

/** The checkpoint codec's, fold's and applier's refusals, as a TOTAL table over `DelegationCheckpointErrorCode`. */
const DELEGATION_CHECKPOINT_ERROR_CODES: Readonly<Record<DelegationCheckpointErrorCode, true>> = {
  bom: true, 'invalid-utf8': true, 'missing-final-lf': true, crlf: true, 'malformed-json': true, 'duplicate-key': true, noncanonical: true,
  'bad-shape': true, 'bad-version': true, 'bad-anchor': true, unprojectable: true, 'lease-proof': true, 'fold-refused': true,
  'change-refused': true, 'not-ready': true,
};

/** The failure codes this file mints for itself, as a TOTAL table over `DelegationOwnFailureCode`. */
const DELEGATION_OWN_FAILURE_CODES: Readonly<Record<DelegationOwnFailureCode, true>> = {
  'not-recovered': true, recovering: true, 'no-facts': true, 'application-failed': true, 'tail-heal-failed': true, invalid: true,
};

/** Why `createLease` declined, as a TOTAL table over `DelegationLeaseRefusalReason`. */
const DELEGATION_LEASE_REFUSAL_REASONS: Readonly<Record<DelegationLeaseRefusalReason, true>> = {
  'canonical-path-held': true, 'unmeasured-request': true, 'unmeasured-activity': true, 'source-kind-mismatch': true,
  'zero-delta-call': true,
};

/** The kinds of a meta-open answer (the builder's and the applier's), as a TOTAL table over both unions' `kind`. */
const DELEGATION_META_OPEN_KINDS: Readonly<Record<DelegationMetaOpenResult['kind'] | DelegationMetaOutcome['kind'], true>> = {
  opened: true, 'already-open': true, 'waiting-for-evidence': true,
};

/** The phase a recovery or an application failure names, as a TOTAL table over `DelegationRecoveryFailure['phase']`. */
const DELEGATION_FAILURE_PHASES: Readonly<Record<DelegationRecoveryFailure['phase'], true>> = {
  'checkpoint-decode': true, 'checkpoint-validate': true, 'journal-validate': true, 'identity-evidence': true, 'suffix-replay': true,
  holds: true, 'final-validate': true, 'durable-application': true,
};

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`: derived from the tables above, from
 *  this file's own `as const` lists (the durability edges, the restore marker's code) and from the vocabularies it only reads: the
 *  journal's refusals and entry kinds, the model's pruning hold reasons, and `shared/api.ts`'s source kinds, cleanup states and
 *  cleanup populations. Never a list, so a word added to a union is admitted and a typo is not. None is a mail rejection or a run
 *  refusal. */
export function isDelegationCheckpointKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  const listed = (l: readonly string[]): boolean => l.includes(v);
  return own(DELEGATION_CHECKPOINT_ERROR_CODES) || own(DELEGATION_OWN_FAILURE_CODES) || own(DELEGATION_LEASE_REFUSAL_REASONS)
    || own(DELEGATION_META_OPEN_KINDS) || own(DELEGATION_FAILURE_PHASES) || own(DELEGATION_JOURNAL_ERROR_CODES)
    || own(DELEGATION_JOURNAL_ENTRY_KINDS) || own(DELEGATION_PRUNING_HOLD_REASONS)
    || v === DELEGATION_RESTORE_IN_PROGRESS || listed(DELEGATION_DURABILITY_EDGES) || listed(DELEGATION_COMPACTION_EDGES)
    || listed(DELEGATION_ACTIVITY_SOURCE_KINDS) || listed(DELEGATION_CLEANUP_STATES) || listed(DELEGATION_CLEANUP_POPULATIONS);
}
