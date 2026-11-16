/** Moved out of `server/src/coord/delegation-checkpoint.ts` by `.github/ci/file-split.mjs`: a pure move (D-8636). */

import {
  DelegationJsonError,
  DelegationModelError,
  emptyDelegationCheckpoint,
  type DelegationCheckpointV1,
  type DelegationJournalRecordV1,
  type DelegationRecoveryState,
} from './delegation-model.js';
import {
  DelegationJournalChain,
  DelegationJournalError,
  type DelegationJournalCoverage,
  type DelegationJournalPosition,
  type DelegationTailHealPlan,
} from './delegation-journal.js';
import { refuse, DelegationCheckpointBuilder, decodeDelegationCheckpoint, validateDelegationCheckpoint, DelegationCheckpointError } from './delegation-checkpoint.js';

// ── Recovery (O2) ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The reconstruction phases, in order. Pruning is disabled from the first through the last; a failure in any one leaves the
 *  phase `reconstructing` and pruning disabled. */
export const DELEGATION_RECOVERY_PHASES = [
  'checkpoint-decode',      // the bytes, strictly, into a checkpoint (absent bytes are the empty checkpoint)
  'checkpoint-validate',    // identity invariants, the wave-3 lease guard, projectability
  'journal-validate',       // the grammar, both hashes, the chain, and the anchor triple
  'identity-evidence',      // ALL retained evidence for agents the checkpoint does not hold, including records before the applied position, and the covered task notifications, which may end a workflow run the checkpoint left active
  'suffix-replay',          // the retained records after the applied position, folded by the builder
  'holds',                  // natural-key mappings restored verbatim and every pruning hold recomputed
  'final-validate',         // the checkpoint rebuilt and validated against the journal's lease entries and held evidence
] as const;

export type DelegationRecoveryPhaseName = (typeof DELEGATION_RECOVERY_PHASES)[number];

export interface DelegationRecoveryFailure {
  phase: DelegationRecoveryPhaseName | 'durable-application';
  code: string;
  detail: string;
}

/** The failure codes this file mints for itself, closed. Every other `code` a failure carries is a thrown error's own (a journal,
 *  checkpoint or model refusal), and `DELEGATION_RESTORE_IN_PROGRESS` is the restore marker's. `invalid` is a JSON refusal's, which
 *  carries no code of its own (chore K review, minor 1). */
export type DelegationOwnFailureCode = 'not-recovered' | 'recovering' | 'no-facts' | 'application-failed' | 'tail-heal-failed' | 'invalid';

/** How many evidence records the retained journal holds, in all and up to a sequence. Recovery counts them while it reads, so the
 *  projection repair can tell from SQLite's `(COUNT, MAX(journalSequence))` alone whether it has anything to read the journal for. */
export interface DelegationEvidenceCounts {
  readonly total: number;
  countAtOrBelow(sequence: number): number;
  /** The evidence sequences at or below one, in order: below the journal's first sequence, the carried ones (few), which bound the gaps the
   *  repair's step 0 deletes in (D-7021). */
  sequencesAtOrBelow(sequence: number): readonly number[];
}

/** The evidence records' sequences, in order (8 bytes each). A lease-created record is not evidence and is not counted. */
export class DelegationEvidenceIndex implements DelegationEvidenceCounts {
  private readonly sequences: number[] = [];
  get total(): number { return this.sequences.length; }
  /** The highest sequence held, or null when none: what SQLite's `MAX(journalSequence)` must equal for the two to agree (D-5836). */
  get last(): number | null { return this.sequences[this.sequences.length - 1] ?? null; }
  /** Sequences arrive strictly increasing (the chain has already proved it); anything else is a bug and is refused. */
  add(sequence: number): void {
    this.assertExtendedBy([sequence]);
    this.sequences.push(sequence);
  }
  /**
   * Refuses (`fold-refused`) a batch that does not extend the index strictly upward, and changes nothing. The applier calls it BEFORE
   * step 1, so the one thing that can go wrong with its live count goes wrong while nothing has been written; `extend` then adopts the
   * same batch after the durable point and cannot throw.
   */
  assertExtendedBy(sequences: readonly number[]): void {
    let last = this.sequences[this.sequences.length - 1];
    for (const sequence of sequences) {
      if (last !== undefined && sequence <= last) refuse('fold-refused', `evidence sequence ${sequence} does not follow ${last}`);
      last = sequence;
    }
  }
  /** Adopts a batch `assertExtendedBy` has accepted. It cannot throw: it is called after the application is durable. */
  extend(sequences: readonly number[]): void {
    for (const sequence of sequences) this.sequences.push(sequence);
  }
  countAtOrBelow(sequence: number): number {
    let lo = 0;
    let hi = this.sequences.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.sequences[mid] ?? Number.POSITIVE_INFINITY) <= sequence) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  sequencesAtOrBelow(sequence: number): readonly number[] { return this.sequences.slice(0, this.countAtOrBelow(sequence)); }
  /** D-7021, the compaction's `memory-prune`: forgets every sequence at or below `cutThrough` except the carried ones. */
  dropThrough(cutThrough: number, carried: readonly number[]): void {
    const keep = new Set(carried);
    const kept = this.sequences.filter((s) => s > cutThrough || keep.has(s));
    this.sequences.length = 0;
    for (const s of kept) this.sequences.push(s);
  }
}

/** What a successful recovery hands to the live path. */
export interface DelegationRecoveryFacts {
  builder: DelegationCheckpointBuilder;
  /** Every accepted evidence `eventId` in the retained journal (the deduplication index). */
  eventIds: Set<string>;
  head: DelegationJournalPosition | null;
  /** The per-sequence evidence count, for the projection repair. */
  evidence: DelegationEvidenceIndex;
}

export interface DelegationRecoveryReport {
  state: DelegationRecoveryState;
  failure: DelegationRecoveryFailure | null;
  completedPhases: readonly DelegationRecoveryPhaseName[];
  /** `disabled` from entry through the last phase and for good after any failure; `enabled` only on a complete recovery. */
  pruning: 'enabled' | 'disabled';
  /** Records after the applied position that replay folded. */
  replayed: number;
  /** Records read. */
  scanned: number;
  /** D-6269: the activity rows covered task notifications changed (ended, or only `lastEventAt` moved for an `unknown` status): a backfill
   *  on a checkpoint built before the rule. A row changed twice counts twice. */
  coveredEnds: number;
  journal: DelegationJournalCoverage | null;
  facts: DelegationRecoveryFacts | null;
  /**
   * The torn tail recovery found AND the heal rule allows cutting (D-4655): a tail on a journal whose complete records and checkpoint are
   * sound. Null when there is no tail, and null when there is one that must not be cut (that one is a `failure`, as before). Recovery
   * itself writes nothing; `DelegationDurability` carries the plan out before it reports ready.
   */
  tailHeal: DelegationTailHealPlan | null;
}

/**
 * Incremental recovery: construct with the checkpoint's bytes (or null for none), `accept` the retained journal's records in
 * file order, then `finish`. Holds only the indexes (event IDs, identity candidates, lease facts, the Bash-call facts, the Workflow launch index), never the records, so a journal
 * of millions of records recovers in bounded memory. `fail` records a failure the caller found while reading (a torn tail).
 */
export class DelegationRecovery {
  private failureNow: DelegationRecoveryFailure | null = null;
  private phase: DelegationRecoveryPhaseName = 'checkpoint-decode';
  private done: DelegationRecoveryPhaseName[] = [];
  private decoded: DelegationCheckpointV1 | null = null;
  private builder: DelegationCheckpointBuilder | null = null;
  private chain: DelegationJournalChain | null = null;
  private readonly eventIds = new Set<string>();
  private readonly evidenceIndex = new DelegationEvidenceIndex();
  private held = new Set<string>();
  private replayed = 0;
  private scanned = 0;
  private applied = 0;
  /** D-7021: the last carried line accepted, or null before the first. */
  private lastCarried: number | null = null;

  constructor(checkpointBytes: Uint8Array | null) {
    try {
      this.decoded = checkpointBytes === null ? emptyDelegationCheckpoint() : decodeDelegationCheckpoint(checkpointBytes);
      this.done.push('checkpoint-decode');
      this.phase = 'checkpoint-validate';
      validateDelegationCheckpoint(this.decoded, null);
      this.done.push('checkpoint-validate');
      this.phase = 'journal-validate';
      this.applied = this.decoded.appliedJournalSequence;
      this.builder = DelegationCheckpointBuilder.from(this.decoded);
      const anchor = this.applied === 0 || this.decoded.appliedJournalId === null || this.decoded.appliedJournalDigest === null
        ? null : { sequence: this.applied, journalId: this.decoded.appliedJournalId, digest: this.decoded.appliedJournalDigest };
      this.chain = new DelegationJournalChain({ completeFromStart: this.applied === 0, anchor });
      // Hold evidence the journal MUST still retain: the anchor, and the identity candidates (spec §5.12).
      for (const h of this.decoded.pruningHolds) if (h.reason === 'checkpoint-anchor' || h.reason === 'identity-candidate') this.held.add(h.journalId);
    } catch (err) {
      this.record(err);
    }
  }

  private record(err: unknown): void {
    if (err instanceof DelegationCheckpointError || err instanceof DelegationModelError || err instanceof DelegationJournalError || err instanceof DelegationJsonError) {
      this.failureNow ??= { phase: this.phase, code: 'code' in err && typeof err.code === 'string' ? err.code : 'invalid' satisfies DelegationOwnFailureCode, detail: err.message };
      return;
    }
    throw err;
  }

  /** The caller found a failure while READING the journal (a torn tail, an unreadable file). */
  fail(phase: DelegationRecoveryPhaseName, code: string, detail: string): void { this.failureNow ??= { phase, code, detail }; }

  failed(): boolean { return this.failureNow !== null; }

  accept(record: DelegationJournalRecordV1): void {
    if (this.failureNow !== null || this.chain === null || this.builder === null) return;
    this.scanned++;
    try {
      this.phase = 'journal-validate';
      const firstRecord = this.chain.firstRecord() === null;
      if (firstRecord && this.lastCarried !== null && record.sequence <= this.lastCarried) {
        throw new DelegationJournalError('carried-past-journal', `the journal begins at ${record.sequence}, not past the carried line at ${this.lastCarried}`);
      }
      this.chain.accept(record);
      if (firstRecord && record.sequence > this.applied + 1) {
        throw new DelegationJournalError('sequence-gap', `the retained journal begins at ${record.sequence}, past the sequence after the checkpoint's ${this.applied}`);
      }
      this.held.delete(record.journalId);
      if (record.entry.kind === 'evidence-accepted') {
        this.eventIds.add(record.entry.event.eventId);
        this.evidenceIndex.add(record.sequence);
      }
      if (record.sequence <= this.applied) {
        this.phase = 'identity-evidence';
        this.builder.observeRecord(record);
      } else {
        this.phase = 'suffix-replay';
        this.builder.foldRecord(record);
        this.replayed++;
      }
    } catch (err) {
      this.record(err);
    }
  }

  /**
   * D-7021: a line of the carried file, which the retained reader hands over BEFORE the journal and only below the journal's first sequence.
   * It must increase (`carried-order`), lie below the journal (`carried-past-journal`, checked again when the journal's first record arrives)
   * and lie at or below the applied position (`carried-past-applied`): every carried record is one the checkpoint already covers, so it is
   * OBSERVED, never folded, exactly like a covered journal record, and it releases a hold and counts in the event IDs and the evidence index.
   * It is not on the chain (the carried file has none) and is not `scanned` (journal records only).
   */
  acceptCarried(record: DelegationJournalRecordV1): void {
    if (this.failureNow !== null || this.chain === null || this.builder === null) return;
    try {
      this.phase = 'journal-validate';
      if (this.lastCarried !== null && record.sequence <= this.lastCarried) {
        throw new DelegationJournalError('carried-order', `carried sequence ${record.sequence} follows ${this.lastCarried}`);
      }
      if (this.chain.firstRecord() !== null) throw new DelegationJournalError('carried-past-journal', `carried sequence ${record.sequence} arrived after the journal began`);
      if (record.sequence > this.applied) {
        throw new DelegationJournalError('carried-past-applied', `carried sequence ${record.sequence} is past the checkpoint's applied ${this.applied}`);
      }
      this.lastCarried = record.sequence;
      this.held.delete(record.journalId);
      if (record.entry.kind === 'evidence-accepted') {
        this.eventIds.add(record.entry.event.eventId);
        this.evidenceIndex.add(record.sequence);
      }
      this.phase = 'identity-evidence';
      this.builder.observeRecord(record);
    } catch (err) {
      this.record(err);
    }
  }

  finish(): DelegationRecoveryReport {
    let journal: DelegationJournalCoverage | null = null;
    let state: DelegationRecoveryState | null = null;
    let facts: DelegationRecoveryFacts | null = null;
    if (this.failureNow === null && this.chain !== null && this.builder !== null && this.decoded !== null) {
      try {
        this.phase = 'journal-validate';
        journal = this.chain.finish();
        this.done.push('journal-validate');
        this.done.push('identity-evidence');
        this.done.push('suffix-replay');
        this.phase = 'holds';
        if (this.held.size > 0) {
          throw new DelegationJournalError('held-evidence-missing', `${this.held.size} journal record(s) the checkpoint holds are not retained, first ${[...this.held][0]}`);
        }
        this.done.push('holds');
        this.phase = 'final-validate';
        const checkpoint = this.builder.build(this.decoded.revision);
        this.done.push('final-validate');
        state = { checkpoint, phase: 'ready' };
        facts = { builder: this.builder, eventIds: this.eventIds, head: this.chain.head(), evidence: this.evidenceIndex };
      } catch (err) {
        this.record(err);
        journal = null;
      }
    }
    if (state === null || this.failureNow !== null) {
      // A failed reconstruction keeps the best checkpoint it decoded and the phase `reconstructing`; pruning stays disabled.
      state = { checkpoint: this.decoded ?? emptyDelegationCheckpoint(), phase: 'reconstructing' };
      facts = null;
    }
    return {
      state, failure: this.failureNow, completedPhases: this.done, pruning: state.phase === 'ready' ? 'enabled' : 'disabled',
      replayed: this.replayed, scanned: this.scanned, coveredEnds: facts === null ? 0 : facts.builder.coveredEndsCount(),
      journal, facts, tailHeal: null,
    };
  }
}

/** Recovery over records already in memory. */
export function recoverDelegation(checkpointBytes: Uint8Array | null, retainedJournal: Iterable<DelegationJournalRecordV1>): DelegationRecoveryReport {
  const recovery = new DelegationRecovery(checkpointBytes);
  for (const record of retainedJournal) recovery.accept(record);
  return recovery.finish();
}

/**
 * The plan's entry point: the checkpoint file's bytes (null when there is none) and the retained journal in, the recovery state
 * out. Success is `ready`; ANY failure is `reconstructing` with pruning disabled (see `recoverDelegation` for the reason).
 */
export function recoverDelegationState(checkpointBytes: Uint8Array | null, retainedJournal: Iterable<DelegationJournalRecordV1>): DelegationRecoveryState {
  return recoverDelegation(checkpointBytes, retainedJournal).state;
}
