// Delegation broker wave 3, Task 8A: the atomic checkpoint, recovery, and the serialized durable applier.
//
// The journal (`delegation-journal.ts`) says what was accepted; the checkpoint (`~/.ccrc/delegation-checkpoint.json`) says
// what the server concluded from it: the sessions, the activities and their IMMUTABLE IDs, the leases, the lineage, the
// bucket cursors, the observation intervals and the pruning holds. Both are authority. `coord.db` is repairable output.
//
// WHAT IS HERE
//   PURE (above the banner; no fs, no clock, no randomness, no SQLite):
//     - the canonical checkpoint codec and its closed shape;
//     - `assertDelegationCheckpointProjectable`: the SQLite constraints a checkpoint must satisfy, stated in code, so a
//       checkpoint that no projection could ever accept is refused BEFORE it is durable;
//     - `DelegationCheckpointBuilder`: the fold of journal records into checkpoint rows, the journal-derived indexes (identity
//       candidates, Bash-call facts, the Workflow launch index), and the pruning holds. It is the ONE place a journal record becomes state, used by the live path and by replay alike, so
//       replay cannot differ from the live path (W3-M18);
//     - `DelegationRecovery` / `recoverDelegation` / `recoverDelegationState`: the reconstruction phases (O2).
//   IMPURE SHELL (below the banner): reading the files, the atomic checkpoint replacement, the SERIALIZED DURABLE APPLIER
//   (O5's eight steps in order), the lease adapter that alone mints a lease UUID, and the SQLite projection and its repair.
//
// THE ENTRY POINT Task 9 calls: `DelegationDurability.applyAccepted(batch)`. Positive meta, intent and every other
// checkpoint-only change go through `applyPositiveAgentMeta` / `applyCheckpointChange`; a lease goes through `createLease`.
// Time and randomness are INJECTED (`now`, `randomUUID`); no pure code reads either.
import {
  DELEGATION_ATTEMPT_VERDICTS,
  DELEGATION_CLEANUP_POPULATIONS,
  DELEGATION_CLEANUP_STATES,
  DELEGATION_DISPOSITIONS,
  DELEGATION_LEASE_RELEASE_REASONS,
  DELEGATION_EXECUTION_STATES,
  DELEGATION_INTENT_SOURCES,
  DELEGATION_LEASE_SOURCE_KINDS,
  DELEGATION_ACTIVITY_SOURCE_KINDS,
  DELEGATION_PARENTAGE_STATES,
  DELEGATION_WORKSPACE_STATES,
  type DelegationActivityNaturalKey,
  type DelegationActivitySourceKind,
  type DelegationEventEnvelopeV1,
} from '../../../shared/api.js';
import {
  DelegationJsonError,
  DelegationModelError,
  DELEGATION_PRUNING_HOLD_REASONS,
  allocateDelegationActivityIdInto,
  assertDelegationCheckpointIdentity,
  assertLeases,
  canonicalDelegationJson,
  DELEGATION_BASH_PENDING_MS,
  DELEGATION_STOP_CANDIDATE_HORIZON_MS,
  delegationListingsEqual,
  deriveDelegationLineageId,
  deriveDelegationRunLineageId,
  emptyDelegationCheckpoint,
  encodeDelegationNaturalKey,
  isDelegationHourCarveOut,
  isDelegationWorkerIndex,
  isLowerHex64,
  parseDelegationInstant,
  planDelegationCursorRetention,
  sortedProjectionRows,
  upkeepDelegationIntervals,
  withDelegationIntentSource,
  type DelegationActivityRow,
  type DelegationAttemptRow,
  type DelegationBucketCursor,
  type DelegationCheckpointV1,
  type DelegationEventRow,
  type DelegationInsertEventsResult,
  type DelegationProjectChangesResult,
  type DelegationIntervalState,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
  type DelegationAttemptMark,
  type DelegationLeaseCarrierRow,
  type DelegationLeaseRow,
  type DelegationLineageRow,
  type DelegationObservationInterval,
  type DelegationPruningHold,
  type DelegationRecoveryState,
  type DelegationSessionRow,
} from './delegation-model.js';
import {
  DelegationJournalChain,
  DelegationJournalError,
  delegationEventRowOfRecord,
  delegationLeaseIdentityKey,
  findDelegationJsonDefect,
  readDelegationJournalRecords,
  type DelegationJournalCoverage,
  type DelegationJournalPosition,
  type DelegationLeaseView,
  type DelegationTailHealPlan,
} from './delegation-journal.js';
import {
  type DelegationRecordNaming,
} from './delegation-compaction.js';
import {
  foldLeaseCarrierSeen,
  foldLeaseRelease,
  foldLeaseTransition,
  type DelegationLeaseTransitionReason,
} from './delegation-lease-state.js';

/** The checkpoint's file name under the coordination directory (`~/.ccrc`). */
export const DELEGATION_CHECKPOINT_FILE = 'delegation-checkpoint.json';

/**
 * The marker a coordination restore publishes in the coordination directory while it replaces the live set
 * (`deploy/coordination-snapshot.mjs`, which spells this name itself because it imports nothing; a test pins the two together).
 * While it exists the files on disk may be a half-replaced mix, so recovery REFUSES to read them: the closed failure
 * `restore-in-progress`, phase `reconstructing`, pruning disabled. `ccrc coordination-snapshot recover` finishes the restore and
 * removes the marker; nothing here ever deletes it.
 */
export const COORDINATION_RESTORE_MARKER_FILE = 'coordination-restore.json';
/** The recovery failure code for an active restore marker. */
export const DELEGATION_RESTORE_IN_PROGRESS = 'restore-in-progress';

// ── Errors ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DelegationCheckpointErrorCode =
  | 'bom' | 'invalid-utf8' | 'missing-final-lf' | 'crlf' | 'malformed-json' | 'duplicate-key' | 'noncanonical'
  | 'bad-shape'          // a key, type, word or instant the closed checkpoint shape does not allow
  | 'bad-version'
  | 'bad-anchor'         // the applied position and its journalId / digest disagree
  | 'unprojectable'      // a checkpoint no projection could accept: SQLite would refuse it, forever
  | 'lease-proof'        // a lease whose creating journal entry is missing or unequal, or a journal lease with no row
  | 'fold-refused'       // a journal record the fold will not apply (and so recovery will not either)
  | 'change-refused'     // a checkpoint-only change that tried to do what only the journal may do
  | 'not-ready';         // the applier is reconstructing or failed: nothing is applied until it re-recovers

export class DelegationCheckpointError extends Error {
  constructor(readonly code: DelegationCheckpointErrorCode, detail: string) {
    super(`delegation checkpoint ${code}: ${detail}`);
    this.name = 'DelegationCheckpointError';
  }
}

export function refuse(code: DelegationCheckpointErrorCode, detail: string): never {
  throw new DelegationCheckpointError(code, detail);
}

// ── The canonical checkpoint codec and its closed shape ───────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isMember = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** A closed reader over one object: exactly its keys, each read with a typed accessor that never casts. */
class Fields {
  private constructor(private readonly o: Record<string, unknown>, private readonly what: string) {}
  static of(v: unknown, what: string, keys: readonly string[], optional: readonly string[] = []): Fields {
    if (!isRecord(v)) return refuse('bad-shape', `${what} is not an object`);
    for (const k of Object.keys(v)) if (!keys.includes(k) && !optional.includes(k)) refuse('bad-shape', `${what} has the unknown key ${JSON.stringify(k)}`);
    for (const k of keys) if (!Object.hasOwn(v, k)) refuse('bad-shape', `${what} is missing ${JSON.stringify(k)}`);
    return new Fields(v, what);
  }
  private bad(k: string, why: string): never { return refuse('bad-shape', `${this.what}.${k} ${why}`); }
  str(k: string): string { const v = this.o[k]; return typeof v === 'string' ? v : this.bad(k, 'is not a string'); }
  strN(k: string): string | null { return this.o[k] === null ? null : this.str(k); }
  int(k: string, min = 0): number {
    const v = this.o[k];
    return typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : this.bad(k, `is not a safe integer >= ${min}`);
  }
  intN(k: string, min = 0): number | null { return this.o[k] === null ? null : this.int(k, min); }
  bool(k: string): boolean { const v = this.o[k]; return typeof v === 'boolean' ? v : this.bad(k, 'is not a boolean'); }
  inst(k: string): string {
    const v = this.str(k);
    try { parseDelegationInstant(v); } catch { return this.bad(k, 'is not a canonical UTC millisecond instant'); }
    return v;
  }
  instN(k: string): string | null { return this.o[k] === null ? null : this.inst(k); }
  hex(k: string): string { const v = this.o[k]; return isLowerHex64(v) ? v : this.bad(k, 'is not a lowercase 64-hex SHA-256'); }
  hexN(k: string): string | null { return this.o[k] === null ? null : this.hex(k); }
  /** A nested closed object, or null: exactly its keys, read with the same typed accessors. */
  objectN(k: string, keys: readonly string[]): Fields | null {
    const v = this.o[k];
    return v === null ? null : Fields.of(v, `${this.what}.${k}`, keys);
  }
  member<T extends string>(k: string, list: readonly T[]): T {
    const v = this.o[k];
    return isMember(list, v) ? v : this.bad(k, `is not one of ${list.join(', ')}`);
  }
  memberN<T extends string>(k: string, list: readonly T[]): T | null { return this.o[k] === null ? null : this.member(k, list); }
  /** Whether an OPTIONAL key is present (`Fields.of` was given it in its `optional` list). */
  has(k: string): boolean { return Object.hasOwn(this.o, k); }
  strList(k: string): readonly string[] {
    const v = this.o[k];
    if (!Array.isArray(v)) return this.bad(k, 'is not a list');
    const out = v.filter((x): x is string => typeof x === 'string');
    return out.length === v.length ? out : this.bad(k, 'is not a list of strings');
  }
  list(k: string): readonly unknown[] {
    const v = this.o[k];
    return Array.isArray(v) ? v : this.bad(k, 'is not a list');
  }
  stringMap(k: string, valueOk: (v: string) => boolean): Readonly<Record<string, string>> {
    const v = this.o[k];
    if (!isRecord(v)) return this.bad(k, 'is not an object');
    const entries: Array<[string, string]> = [];
    for (const [key, val] of Object.entries(v)) {
      if (typeof val !== 'string' || !valueOk(val)) return this.bad(k, `maps ${JSON.stringify(key)} to an invalid value`);
      entries.push([key, val]);
    }
    return Object.fromEntries(entries);       // defines each key as data, so even a key named __proto__ stays a key
  }
}

const INTERVAL_STATES = ['measured', 'unmeasured'] as const satisfies readonly DelegationIntervalState[];
/** Derived from the model's TOTAL table (chore K review, minor 2): a new hold reason is a compile error there, and is then read here. */
const HOLD_REASONS = Object.keys(DELEGATION_PRUNING_HOLD_REASONS) as DelegationPruningHold['reason'][];

const readSession = (v: unknown): DelegationSessionRow => {
  const f = Fields.of(v, 'session', ['sessionId', 'parentIncarnation', 'explicitIntentAt', 'effective', 'effectiveBasis', 'claudeSessionIds', 'firstObservedAt', 'lastObservedAt']);
  const basis = f.list('effectiveBasis').filter((x): x is (typeof DELEGATION_INTENT_SOURCES)[number] => isMember(DELEGATION_INTENT_SOURCES, x));
  if (basis.length !== f.list('effectiveBasis').length) refuse('bad-shape', 'session.effectiveBasis is not a list of intent sources');
  return {
    sessionId: f.str('sessionId'), parentIncarnation: f.str('parentIncarnation'), explicitIntentAt: f.instN('explicitIntentAt'),
    effective: f.bool('effective'), effectiveBasis: basis, claudeSessionIds: f.strList('claudeSessionIds'),
    firstObservedAt: f.inst('firstObservedAt'), lastObservedAt: f.inst('lastObservedAt'),
  };
};

const readAttempt = (v: unknown): DelegationAttemptRow => {
  const f = Fields.of(v, 'attempt', ['attemptId', 'parentId', 'parentIncarnation', 'project', 'adminRecord', 'canonicalPath', 'attemptedAt', 'rung', 'verdict', 'evidenceJournalIds', 'detail']);
  const rungRaw = f.intN('rung', 1);
  const rung = rungRaw === null ? null : rungRaw === 1 || rungRaw === 2 || rungRaw === 3 || rungRaw === 4 ? rungRaw : refuse('bad-shape', 'attempt.rung is not 1 to 4');
  return {
    attemptId: f.str('attemptId'), parentId: f.str('parentId'), parentIncarnation: f.str('parentIncarnation'), project: f.str('project'),
    adminRecord: f.str('adminRecord'), canonicalPath: f.strN('canonicalPath'), attemptedAt: f.inst('attemptedAt'), rung,
    verdict: f.member('verdict', DELEGATION_ATTEMPT_VERDICTS), evidenceJournalIds: f.strList('evidenceJournalIds'), detail: f.strN('detail'),
  };
};

const readActivity = (v: unknown): DelegationActivityRow => {
  const f = Fields.of(v, 'activity', ['activityId', 'parentId', 'parentIncarnation', 'sourceKind', 'upstreamId', 'identityJournalId', 'displayName', 'executionState', 'openedAt', 'endedAt', 'lastEventAt']);
  return {
    activityId: f.hex('activityId'), parentId: f.str('parentId'), parentIncarnation: f.str('parentIncarnation'),
    sourceKind: f.member('sourceKind', DELEGATION_ACTIVITY_SOURCE_KINDS), upstreamId: f.str('upstreamId'),
    identityJournalId: f.hex('identityJournalId'), displayName: f.strN('displayName'),
    executionState: f.member('executionState', DELEGATION_EXECUTION_STATES), openedAt: f.inst('openedAt'), endedAt: f.instN('endedAt'),
    lastEventAt: f.inst('lastEventAt'),
  };
};

const readLease = (v: unknown): DelegationLeaseRow => {
  const f = Fields.of(v, 'lease', [
    'leaseId', 'generation', 'creatingJournalSequence', 'currentJournalSequence', 'activityId', 'parentId', 'parentIncarnation', 'project',
    'adminRecord', 'canonicalPath', 'creationBase', 'sourceKind', 'parentageState', 'workspaceState', 'disposition', 'cleanupState',
    'cleanupPopulation', 'firstObservedAt', 'lastObservedAt', 'terminalEvidenceAt', 'adoptedAt', 'retainedAt', 'promotedAt',
    'cleanupDueAt', 'cleanupStartedAt', 'cleanupFinishedAt', 'cleanupEvidenceJson', 'carrierGenerationSeen', 'releasedAt',
  ]);
  return {
    leaseId: f.str('leaseId'), generation: f.int('generation'), creatingJournalSequence: f.int('creatingJournalSequence', 1),
    currentJournalSequence: f.int('currentJournalSequence', 1), activityId: f.hex('activityId'), parentId: f.str('parentId'),
    parentIncarnation: f.str('parentIncarnation'), project: f.str('project'), adminRecord: f.str('adminRecord'),
    canonicalPath: f.str('canonicalPath'), creationBase: f.strN('creationBase'), sourceKind: f.member('sourceKind', DELEGATION_LEASE_SOURCE_KINDS),
    parentageState: f.member('parentageState', DELEGATION_PARENTAGE_STATES), workspaceState: f.member('workspaceState', DELEGATION_WORKSPACE_STATES),
    disposition: f.member('disposition', DELEGATION_DISPOSITIONS), cleanupState: f.member('cleanupState', DELEGATION_CLEANUP_STATES),
    cleanupPopulation: f.member('cleanupPopulation', DELEGATION_CLEANUP_POPULATIONS), firstObservedAt: f.inst('firstObservedAt'),
    lastObservedAt: f.inst('lastObservedAt'), terminalEvidenceAt: f.instN('terminalEvidenceAt'), adoptedAt: f.instN('adoptedAt'),
    retainedAt: f.instN('retainedAt'), promotedAt: f.instN('promotedAt'), cleanupDueAt: f.instN('cleanupDueAt'),
    cleanupStartedAt: f.instN('cleanupStartedAt'), cleanupFinishedAt: f.instN('cleanupFinishedAt'),
    cleanupEvidenceJson: f.strN('cleanupEvidenceJson'), carrierGenerationSeen: f.intN('carrierGenerationSeen', 1), releasedAt: f.instN('releasedAt'),
  };
};

const readLineage = (v: unknown): DelegationLineageRow => {
  const f = Fields.of(v, 'lineage', ['lineageId', 'parentId', 'parentIncarnation', 'activityId', 'leaseId', 'runId', 'openedAt', 'closedAt', 'closeReason']);
  return {
    lineageId: f.str('lineageId'), parentId: f.str('parentId'), parentIncarnation: f.str('parentIncarnation'), activityId: f.strN('activityId'),
    leaseId: f.strN('leaseId'), runId: f.intN('runId', 1), openedAt: f.inst('openedAt'), closedAt: f.instN('closedAt'), closeReason: f.strN('closeReason'),
  };
};

export const readCursor = (v: unknown): DelegationBucketCursor => {
  const f = Fields.of(v, 'bucketCursor', ['sessionId', 'parentIncarnation', 'bucket', 'cursor', 'lastSize', 'lastCompleteAt', 'intervalState', 'detail', 'anchor', 'replaced']);
  const cursor = f.int('cursor');
  // D-4647: the anchor is a line that ends at the cursor, so it cannot start after it.
  const a = f.objectN('anchor', ['start', 'sha256']);
  const anchor = a === null ? null : { start: a.int('start'), sha256: a.hex('sha256') };
  if (anchor !== null && anchor.start > cursor) refuse('bad-shape', `bucketCursor.anchor starts at ${anchor.start}, after the cursor ${cursor}`);
  return {
    sessionId: f.str('sessionId'), parentIncarnation: f.str('parentIncarnation'), bucket: f.str('bucket'), cursor,
    lastSize: f.int('lastSize'), lastCompleteAt: f.instN('lastCompleteAt'), intervalState: f.member('intervalState', INTERVAL_STATES), detail: f.strN('detail'),
    anchor, replaced: f.bool('replaced'),
  };
};

export const readInterval = (v: unknown): DelegationObservationInterval => {
  const f = Fields.of(v, 'observationInterval', ['sessionId', 'parentIncarnation', 'utcHour', 'state', 'detail', 'recordedAt']);
  return {
    sessionId: f.str('sessionId'), parentIncarnation: f.str('parentIncarnation'), utcHour: f.str('utcHour'),
    state: f.member('state', INTERVAL_STATES), detail: f.strN('detail'), recordedAt: f.inst('recordedAt'),
  };
};

const readAttemptMark = (f: Fields, k: string): DelegationAttemptMark | null => {
  const m = f.objectN(k, ['attemptedAt', 'attemptId']);
  return m === null ? null : { attemptedAt: m.inst('attemptedAt'), attemptId: m.str('attemptId') };
};

const readLeaseCarrier = (v: unknown): DelegationLeaseCarrierRow => {
  const f = Fields.of(v, 'leaseCarrier', ['leaseId', 'transferringSince', 'transferRun', 'promotedRun', 'promotedSession', 'releaseReason', 'resolvedThrough']);
  return {
    leaseId: f.str('leaseId'), transferringSince: f.instN('transferringSince'), transferRun: f.intN('transferRun', 1),
    promotedRun: f.intN('promotedRun', 1), promotedSession: f.strN('promotedSession'),
    releaseReason: f.memberN('releaseReason', DELEGATION_LEASE_RELEASE_REASONS), resolvedThrough: readAttemptMark(f, 'resolvedThrough'),
  };
};

const readHold = (v: unknown): DelegationPruningHold => {
  const f = Fields.of(v, 'pruningHold', ['journalId', 'reason', 'ownerId']);
  return { journalId: f.hex('journalId'), reason: f.member('reason', HOLD_REASONS), ownerId: f.str('ownerId') };
};

const CHECKPOINT_KEYS = [
  'v', 'revision', 'appliedJournalSequence', 'appliedJournalId', 'appliedJournalDigest', 'activityIdsByNaturalKey', 'coordinatorIntentByParent',
  'sessions', 'attempts', 'activities', 'leases', 'lineage', 'bucketCursors', 'observationIntervals', 'pruningHolds',
] as const;

const instantOk = (s: string): boolean => { try { parseDelegationInstant(s); return true; } catch { return false; } };

/** A checkpoint as the closed shape reads it: every key, every type, every word, every instant. Builds a NEW value. */
function readCheckpoint(v: unknown): DelegationCheckpointV1 {
  const f = Fields.of(v, 'checkpoint', CHECKPOINT_KEYS, ['leaseCarriers']);
  if (f.int('v') !== 1) refuse('bad-version', 'checkpoint v is not 1');
  const appliedJournalSequence = f.int('appliedJournalSequence');
  const appliedJournalId = f.hexN('appliedJournalId');
  const appliedJournalDigest = f.hexN('appliedJournalDigest');
  if ((appliedJournalSequence === 0) !== (appliedJournalId === null) || (appliedJournalId === null) !== (appliedJournalDigest === null)) {
    refuse('bad-anchor', 'the applied position, journalId and digest are all zero/null or all set');
  }
  return {
    v: 1, revision: f.int('revision'), appliedJournalSequence, appliedJournalId, appliedJournalDigest,
    activityIdsByNaturalKey: f.stringMap('activityIdsByNaturalKey', isLowerHex64),
    coordinatorIntentByParent: f.stringMap('coordinatorIntentByParent', instantOk),
    sessions: f.list('sessions').map(readSession), attempts: f.list('attempts').map(readAttempt),
    activities: f.list('activities').map(readActivity), leases: f.list('leases').map(readLease), lineage: f.list('lineage').map(readLineage),
    bucketCursors: f.list('bucketCursors').map(readCursor), observationIntervals: f.list('observationIntervals').map(readInterval),
    pruningHolds: f.list('pruningHolds').map(readHold),
    // Wave 5 (PR5a): present only when it holds a row; an empty list is refused later, by `assertLeases`, as noncanonical.
    ...(f.has('leaseCarriers') ? { leaseCarriers: f.list('leaseCarriers').map(readLeaseCarrier) } : {}),
  };
}

const UTF8 = new TextEncoder();

/** The checkpoint file's bytes: its canonical JSON (the journal's one encoder), then LF. */
export function encodeDelegationCheckpoint(checkpoint: DelegationCheckpointV1): Uint8Array {
  return UTF8.encode(`${canonicalDelegationJson(checkpoint)}\n`);
}

/** The checkpoint file's bytes back into a checkpoint, strictly: no BOM, valid UTF-8, one final LF and no CR, no duplicate
 *  key, the closed shape, and exactly the canonical encoding of its own value. Semantic validation is `validateDelegationCheckpoint`. */
export function decodeDelegationCheckpoint(bytes: Uint8Array): DelegationCheckpointV1 {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) refuse('bom', 'a byte-order mark');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return refuse('invalid-utf8', 'not valid UTF-8'); }
  if (!text.endsWith('\n')) refuse('missing-final-lf', 'the checkpoint does not end in LF');
  const body = text.slice(0, -1);
  if (body.endsWith('\r') || body.includes('\n')) refuse('crlf', 'the checkpoint is one line with one LF');
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return refuse('malformed-json', 'not JSON'); }
  const checkpoint = readCheckpoint(parsed);
  let canonical: string;
  try { canonical = canonicalDelegationJson(checkpoint); } catch (err) {
    if (err instanceof DelegationJsonError) return refuse('noncanonical', err.message);
    throw err;
  }
  if (canonical !== body) {
    // `JSON.parse` keeps the last of two equal keys, so a repeated key arrives as text that is not its own canonical encoding;
    // the scanner runs only now, to name the defect. A canonical file never pays for it.
    if (findDelegationJsonDefect(body) === 'duplicate-key') refuse('duplicate-key', 'an object repeats a key');
    refuse('noncanonical', 'the checkpoint is not the canonical encoding of its own value');
  }
  return checkpoint;
}

// ── Projectability: the SQLite constraints, stated in code ────────────────────────────────────────────────────────────

function unprojectable(detail: string): never { return refuse('unprojectable', detail); }

/** The lease clocks the DDL holds at or after `firstObservedAt`, less the two `assertLease` already holds there (`terminalEvidenceAt` and
 *  `releasedAt`, review 1451 F8): this check's one caller runs `assertLeases` first, so each bound is stated once. */
const LEASE_CLOCKS = ['adoptedAt', 'retainedAt', 'promotedAt', 'cleanupDueAt', 'cleanupStartedAt', 'cleanupFinishedAt'] as const satisfies
  readonly (keyof DelegationLeaseRow)[];

/**
 * Refuses a checkpoint that `projectDelegationCheckpoint` could never accept: a duplicate key, a dangling reference, a CHECK
 * that would fail, two unreleased leases on one identity or one canonical path. A checkpoint is AUTHORITY once durable, so a
 * bad one is refused here, before the journal is touched, rather than becoming a repair that fails forever. Mirrors the DDL;
 * the recovery tests hold it to the real store.
 */
export function assertDelegationCheckpointProjectable(cp: DelegationCheckpointV1): void {
  const sessionKey = (id: string, inc: string): string => JSON.stringify([id, inc]);
  const sessions = new Set<string>();
  for (const s of cp.sessions) {
    const k = sessionKey(s.sessionId, s.parentIncarnation);
    if (sessions.has(k)) unprojectable(`two session rows share the key ${k}`);
    sessions.add(k);
    if (s.lastObservedAt < s.firstObservedAt) unprojectable(`session ${k} was last observed before it was first`);
  }
  const needSession = (id: string, inc: string, who: string): void => {
    if (!sessions.has(sessionKey(id, inc))) unprojectable(`${who} names the session (${id}, ${inc}), which has no row`);
  };
  const activities = new Map<string, DelegationActivityRow>();
  const naturalKeys = new Set<string>();
  for (const a of cp.activities) {
    if (activities.has(a.activityId)) unprojectable(`two activity rows share the ID ${a.activityId}`);
    activities.set(a.activityId, a);
    const nk = encodeDelegationNaturalKey(a);
    if (naturalKeys.has(nk)) unprojectable(`two activities share the natural key ${nk}`);
    naturalKeys.add(nk);
    needSession(a.parentId, a.parentIncarnation, `activity ${a.activityId}`);
    if (a.endedAt !== null && a.endedAt < a.openedAt) unprojectable(`activity ${a.activityId} ended before it opened`);
    if (a.lastEventAt < a.openedAt) unprojectable(`activity ${a.activityId} had its last event before it opened`);
  }
  const attempts = new Set<string>();
  for (const t of cp.attempts) {
    if (attempts.has(t.attemptId)) unprojectable(`two attempt rows share the ID ${t.attemptId}`);
    attempts.add(t.attemptId);
    needSession(t.parentId, t.parentIncarnation, `attempt ${t.attemptId}`);
    if (t.verdict === 'linked' && t.canonicalPath === null) unprojectable(`attempt ${t.attemptId} is linked with no canonical path`);
  }
  const leases = new Map<string, DelegationLeaseRow>();
  const creating = new Set<number>();
  const identityKeys = new Set<string>();
  const paths = new Set<string>();
  for (const l of cp.leases) {
    if (leases.has(l.leaseId)) unprojectable(`two lease rows share the ID ${l.leaseId}`);
    leases.set(l.leaseId, l);
    if (creating.has(l.creatingJournalSequence)) unprojectable(`two leases share creatingJournalSequence ${l.creatingJournalSequence}`);
    creating.add(l.creatingJournalSequence);
    if (!activities.has(l.activityId)) unprojectable(`lease ${l.leaseId} names the activity ${l.activityId}, which has no row`);
    needSession(l.parentId, l.parentIncarnation, `lease ${l.leaseId}`);
    if (l.lastObservedAt < l.firstObservedAt) unprojectable(`lease ${l.leaseId} was last observed before it was first`);
    for (const k of LEASE_CLOCKS) {
      const at = l[k];
      if (at !== null && at < l.firstObservedAt) unprojectable(`lease ${l.leaseId}'s ${k} ${at} is before its firstObservedAt ${l.firstObservedAt}`);
    }
    if (l.releasedAt === null) {
      const ik = delegationLeaseIdentityKey(l);
      if (identityKeys.has(ik)) unprojectable(`two unreleased leases share the identity ${ik}`);
      identityKeys.add(ik);
      if (paths.has(l.canonicalPath)) unprojectable(`two unreleased leases hold the canonical path ${l.canonicalPath}`);
      paths.add(l.canonicalPath);
    }
  }
  const lineage = new Set<string>();
  for (const n of cp.lineage) {
    if (lineage.has(n.lineageId)) unprojectable(`two lineage rows share the ID ${n.lineageId}`);
    lineage.add(n.lineageId);
    needSession(n.parentId, n.parentIncarnation, `lineage ${n.lineageId}`);
    const owners = (n.activityId !== null ? 1 : 0) + (n.leaseId !== null ? 1 : 0) + (n.runId !== null ? 1 : 0);
    if (owners !== 1) unprojectable(`lineage ${n.lineageId} must be owned by exactly one of an activity, a lease or a run`);
    if (n.activityId !== null && !activities.has(n.activityId)) unprojectable(`lineage ${n.lineageId} names an activity with no row`);
    if (n.leaseId !== null && !leases.has(n.leaseId)) unprojectable(`lineage ${n.lineageId} names a lease with no row`);
    // A run-owned row is a promotion's (wave 5, PR5a folds it; PR9 writes it). Its run is `runs`'s to prove, not this checkpoint's.
    if ((n.closedAt === null) !== (n.closeReason === null)) unprojectable(`lineage ${n.lineageId} has a closedAt and closeReason that do not come together`);
    if (n.closedAt !== null && n.closedAt < n.openedAt) unprojectable(`lineage ${n.lineageId} closed before it opened`);
  }
}

// ── The journal proof of a lease ──────────────────────────────────────────────────────────────────────────────────────

/** What the fold remembers about a retained `lease-created` record. */
export interface DelegationLeaseEntryFact {
  sequence: number;
  journalId: string;
  entry: Extract<DelegationJournalEntryV1, { kind: 'lease-created' }>;
}

/** What the fold remembers about a retained record of a wave-5 lease kind: its place, and whether it wrote a generation
 *  (`lease-transition` and `lease-released` do; `lease-carrier-seen` does not, D-7851). */
export interface DelegationLeaseRecordFact {
  sequence: number;
  journalId: string;
  writesGeneration: boolean;
  /** PR5b: what the record did, so a door can tell its own replay (`unchanged`): a transition's reason, `released`, or `seen`. */
  act: DelegationLeaseTransitionReason | 'released' | 'seen';
}

/**
 * The full event-less-lease proof, both ways. Every lease in the checkpoint names, by `creatingJournalSequence`, a RETAINED
 * `lease-created` record whose fields equal the lease's identity columns (and whose lineage ID is the one derived), and its
 * generation and `currentJournalSequence` are what its retained generation-writing records say: one generation each, the current
 * sequence the last one's (wave 5, PR5a). Every retained `lease-created` record the checkpoint has applied has its lease row, and
 * so does every retained record of a lease kind. A RELEASED lease is the one exception: it holds nothing (`computeHolds`), so a
 * compaction may cut its records, and its row then stands on the proof it had while it was held. A lease without its entry has no
 * authority: "the journal alone creates leases".
 */
export function assertLeaseJournalProof(cp: DelegationCheckpointV1, facts: ReadonlyMap<string, DelegationLeaseEntryFact>,
  records: ReadonlyMap<string, readonly DelegationLeaseRecordFact[]> = new Map()): void {
  for (const lease of cp.leases) {
    const fact = facts.get(lease.leaseId);
    if (fact === undefined) {
      if (lease.releasedAt !== null) continue;
      refuse('lease-proof', `lease ${lease.leaseId} has no retained lease-created journal entry`);
    }
    const e = fact.entry;
    const writes = (records.get(lease.leaseId) ?? []).filter((r) => r.sequence <= cp.appliedJournalSequence && r.writesGeneration);
    const current = writes.length === 0 ? fact.sequence : writes[writes.length - 1]!.sequence;
    const same = fact.sequence === lease.creatingJournalSequence && current === lease.currentJournalSequence
      && writes.length === lease.generation && e.activityId === lease.activityId && e.parentId === lease.parentId
      && e.parentIncarnation === lease.parentIncarnation && e.project === lease.project && e.adminRecord === lease.adminRecord
      && e.canonicalPath === lease.canonicalPath && e.creationBase === lease.creationBase && e.sourceKind === lease.sourceKind
      && e.firstObservedAt === lease.firstObservedAt && e.lineageId === deriveDelegationLineageId(lease);
    if (!same) refuse('lease-proof', `lease ${lease.leaseId} does not equal its lease-created entry at sequence ${fact.sequence} and its ${writes.length} transition(s)`);
  }
  const have = new Set(cp.leases.map((l) => l.leaseId));
  for (const [leaseId, fact] of facts) {
    if (fact.sequence <= cp.appliedJournalSequence && !have.has(leaseId)) {
      refuse('lease-proof', `the lease-created entry at sequence ${fact.sequence} has no lease row in the checkpoint`);
    }
  }
  for (const [leaseId, list] of records) {
    const first = list.find((r) => r.sequence <= cp.appliedJournalSequence);
    if (first !== undefined && !have.has(leaseId)) refuse('lease-proof', `the lease record at sequence ${first.sequence} names lease ${leaseId}, which has no row`);
  }
}

/**
 * Everything a checkpoint must satisfy, in one place: the anchor, the lease guard (`assertLeases`), the identity invariants
 * (activity IDs, the natural-key map, the intent map, each lease's opening lineage), projectability, and (when the journal's lease
 * entries are known) the journal proof. Runs at checkpoint BUILD and at RECOVERY; a violation at recovery keeps the phase
 * `reconstructing` and pruning disabled.
 */
export function validateDelegationCheckpoint(cp: DelegationCheckpointV1, leaseFacts: ReadonlyMap<string, DelegationLeaseEntryFact> | null,
  leaseRecords?: ReadonlyMap<string, readonly DelegationLeaseRecordFact[]>): void {
  if (cp.v !== 1) refuse('bad-version', 'not a version-1 checkpoint');
  if ((cp.appliedJournalSequence === 0) !== (cp.appliedJournalId === null) || (cp.appliedJournalId === null) !== (cp.appliedJournalDigest === null)) {
    refuse('bad-anchor', 'the applied position, journalId and digest are all zero/null or all set');
  }
  assertLeases(cp);
  assertDelegationCheckpointIdentity(cp);
  assertDelegationCheckpointProjectable(cp);
  if (leaseFacts !== null) assertLeaseJournalProof(cp, leaseFacts, leaseRecords);
}

// ── Naming: which upstream activities an evidence event speaks of ───────────────────────────────────────────────────

/** An upstream thing an event names, and what the event means for it. */
export interface DelegationNamedUpstream {
  sourceKind: DelegationActivitySourceKind;
  /**
   * `agent`: the agent ID. `workflow`: the RUN id (a worker's own upstream ID is `<runId>-<index>`, and the index comes only from the
   * worker's meta, so the run's record opens the RUN and no worker). `bash-worktree`: the Bash call's `tool_use_id`.
   */
  upstreamId: string;
  /**
   * A QUALIFYING JOIN (spec §5.2): an Agent launch response or a SubagentStart naming an agent, a Workflow launch response naming its
   * run (ruling R44: the run's identity is checkpoint data from then on, so it never holds the journal). A bare `agent_id` is not one.
   * A Bash PreToolUse or PostToolUse is never a join on its own: whether its call opens is decided across its two records by the
   * builder (`foldBashCall`, D-6267).
   */
  join: boolean;
  /** The event ends it: a SubagentStop naming an agent, a launch response that reports `completed`, or a Bash PostToolUse. A Workflow RUN is
   *  also ended by its task notification, which names no upstream id and is folded by the builder (`foldNotification`, D-6269), never here. */
  ends: boolean;
}

/** D-6269: the run id a Workflow launch response names, or null when the event is not one. The ONE test of a qualifying Workflow launch,
 *  shared by `namedAgentsOf` (which opens the run from it) and the builder's launch index, so an indexed launch is always a launch
 *  whose join the naming loop accepted. */
export function workflowLaunchRunId(event: DelegationEventEnvelopeV1): string | null {
  if (event.eventKind !== 'PostToolUse' || event.toolName !== 'Workflow') return null;
  const launch = event.launch;
  if (typeof launch !== 'object' || launch === null || typeof launch.runId !== 'string' || launch.runId === '') return null;
  return launch.runId;
}

/**
 * The upstream IDs an evidence event names. For agents, the common `agentId` field names the emitter (a tool event inside a subagent,
 * a SubagentStart, a SubagentStop) and `launch.agentId` on an Agent/Task PostToolUse names the agent that call launched; only
 * SubagentStart and a launch response QUALIFY, a bare occurrence is evidence that attaches once a join is known, and an unpaired stop
 * opens nothing. A Workflow PostToolUse launch response names its RUN and IS that run's join (the worker index is the meta's, so it
 * opens the run, never a worker). A Bash PreToolUse or
 * PostToolUse names its tool call, and is never a join: a listing-carrying PreToolUse makes the call pending, and the builder opens it
 * at its PostToolUse only on a changed listing or a listing on one side only (D-6267; the hook writes a listing only for a command
 * that mentions a worktree). Nothing else names anything: a ToolSearch, a parent Stop and a SessionEnd open no activity, whatever order
 * they arrive in. A UserPromptSubmit task notification names nothing here; the builder folds it (D-6269).
 */
export function namedAgentsOf(event: DelegationEventEnvelopeV1): DelegationNamedUpstream[] {
  const found = new Map<string, DelegationNamedUpstream>();
  const note = (sourceKind: DelegationActivitySourceKind, upstreamId: unknown, join: boolean, ends: boolean): void => {
    if (typeof upstreamId !== 'string' || upstreamId === '') return;
    const id = JSON.stringify([sourceKind, upstreamId]);
    const prior = found.get(id);
    found.set(id, { sourceKind, upstreamId, join: join || (prior?.join ?? false), ends: ends || (prior?.ends ?? false) });
  };
  note('agent', event.agentId, event.eventKind === 'SubagentStart', event.eventKind === 'SubagentStop');
  if (event.eventKind === 'PostToolUse' && (event.toolName === 'Agent' || event.toolName === 'Task')) {
    const launch = event.launch;
    if (typeof launch === 'object' && launch !== null) note('agent', launch.agentId, true, launch.status === 'completed');
  }
  const runId = workflowLaunchRunId(event);
  if (runId !== null && event.eventKind === 'PostToolUse' && event.toolName === 'Workflow') note('workflow', runId, true, event.launch?.status === 'completed');
  if ((event.eventKind === 'PreToolUse' || event.eventKind === 'PostToolUse') && event.toolName === 'Bash') {
    note('bash-worktree', event.toolUseId, false, event.eventKind === 'PostToolUse');
  }
  return [...found.values()];
}

/** An upstream thing no qualifying join has yet opened: the earliest retained record naming it is its identity record (spec §5.2). A
 *  Workflow RUN is never one (R44: its launch response is its qualifying join, so it is opened at once), and its workers are opened
 *  from the run's row, not from a candidate. */
export interface DelegationActivityCandidate {
  key: DelegationActivityNaturalKey;
  /** The accepted `journalId` of the earliest retained record that named it (NEVER the envelope's `eventId`). */
  journalId: string;
  sequence: number;
  /** That record's event time. */
  observedAt: string;
  /** The latest event time that named it so far. */
  lastObservedAt: string;
  /** The event time of a stop or completed launch that named it before it opened, else null. */
  endedAt: string | null;
  /** True while every record that named it is a SubagentStop: a start-less stop ages out after DELEGATION_STOP_CANDIDATE_HORIZON_MS (D-6270). */
  stopOnly: boolean;
  /** The `acceptedAt` of the latest naming record: journal data, never a clock read. */
  lastAcceptedAt: string;
}

/** D-6267: one Bash call's state in the builder. Never encoded: recovery rebuilds it from the retained journal, like `candidates`.
 *  'pre': a measured PreToolUse with no decision yet. On an UNMAPPED key it is rule A's pending call: held, and aged. On a MAPPED key it
 *  is an old-rule row's identity Pre: aged, never held. Same shape, same ageing.
 *  'equal': that Pre, then a PostToolUse naming the same records. Kept on MAPPED keys only, until the retirement door takes it.
 *  Anything else ("spoiled") is the entry DELETED. */
export type DelegationBashCallFact =
  | { kind: 'pre'; journalId: string; sequence: number; observedAt: string; lastObservedAt: string; listing: readonly string[]; acceptedAtMs: number }
  | { kind: 'equal'; preJournalId: string };

const maxInstant = (a: string, b: string): string => (a >= b ? a : b);
const minInstant = (a: string, b: string): string => (a <= b ? a : b);

/** D-6267: a due heap over journal-time deadlines (a cache only: every decision re-reads the map entry the heap names). */
type DueEntry = readonly [dueMs: number, encoded: string];
const dueLess = (a: DueEntry, b: DueEntry): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
function duePush(h: DueEntry[], e: DueEntry): void {
  h.push(e);
  for (let i = h.length - 1; i > 0;) {
    const p = (i - 1) >> 1;
    if (!dueLess(h[i]!, h[p]!)) break;
    [h[i], h[p]] = [h[p]!, h[i]!];
    i = p;
  }
}
function duePop(h: DueEntry[]): DueEntry | undefined {
  const top = h[0];
  const last = h.pop();
  if (top === undefined || last === undefined || h.length === 0) return top;
  h[0] = last;
  for (let i = 0; ;) {
    const l = 2 * i + 1, r = l + 1;
    let m = i;
    if (l < h.length && dueLess(h[l]!, h[m]!)) m = l;
    if (r < h.length && dueLess(h[r]!, h[m]!)) m = r;
    if (m === i) break;
    [h[i], h[m]] = [h[m]!, h[i]!];
    i = m;
  }
  return top;
}

/** The listing a Bash PreToolUse or PostToolUse carries; undefined when it was unmeasured, shed, or not triggered. */
export const bashListingOf = (e: DelegationEventEnvelopeV1): readonly string[] | undefined =>
  (e.eventKind === 'PreToolUse' || e.eventKind === 'PostToolUse') && e.toolName === 'Bash' && Array.isArray(e.listing) ? e.listing : undefined;

/** What a record names, as the fold reads it: the compaction planner's port (`delegation-compaction.ts`), built from the fold's own naming
 *  code, so the planner never names a key differently from the fold. */
export const delegationRecordNaming: DelegationRecordNaming = {
  naturalKeysOf: (e) => namedAgentsOf(e).map((na) => ({
    encoded: encodeDelegationNaturalKey({ parentId: e.sessionId, parentIncarnation: e.parentIncarnation, sourceKind: na.sourceKind, upstreamId: na.upstreamId }),
    sourceKind: na.sourceKind,
  })),
  bashListingOf,
  workflowLaunchRunId,
};

// ── The builder: the one fold from journal records to checkpoint rows ───────────────────────────────────────────────

export const sessionKeyOf = (id: string, inc: string): string => JSON.stringify([id, inc]);
const cursorKeyOf = (c: { sessionId: string; parentIncarnation: string; bucket: string }): string => JSON.stringify([c.sessionId, c.parentIncarnation, c.bucket]);
const intervalKeyOf = (c: { sessionId: string; parentIncarnation: string; utcHour: string }): string => JSON.stringify([c.sessionId, c.parentIncarnation, c.utcHour]);

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedBy = <T>(rows: Iterable<T>, key: (r: T) => string): T[] => [...rows].sort((a, b) => byCodeUnits(key(a), key(b)));
const sortedMap = (m: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).sort(([a], [b]) => byCodeUnits(a, b)));

/**
 * Merges one hour's observation interval. An hour with a gap stays a gap: `unmeasured` is sticky, so a later measured read
 * of the same hour cannot erase a measured loss. R90: between two UNMEASURED rows, a LOSS word displaces a CARVE-OUT word
 * (`directory-absent`, `capability-absent`, `isDelegationHourCarveOut`) and a carve-out word never displaces a loss word, whichever
 * `recordedAt` is later: a carve-out lets rung 4 link across the hour, so a later carve-out must never mask an earlier loss in it.
 * Otherwise the later `recordedAt` wins, and an equal one keeps the stored row. Deterministic and order-independent for the sticky
 * rule and for R90's; Task 13 owns retention.
 */
export function mergeDelegationObservationInterval(prior: DelegationObservationInterval | undefined, next: DelegationObservationInterval): DelegationObservationInterval {
  if (prior === undefined) return next;
  if (prior.state === 'unmeasured' && next.state === 'measured') return prior;
  if (prior.state === 'measured' && next.state === 'unmeasured') return next;
  if (prior.state === 'unmeasured' && next.state === 'unmeasured') {
    const priorCarve = isDelegationHourCarveOut(prior.detail);
    const nextCarve = isDelegationHourCarveOut(next.detail);
    if (priorCarve && !nextCarve) return next;
    if (!priorCarve && nextCarve) return prior;
  }
  return next.recordedAt > prior.recordedAt ? next : prior;
}

/** The wave-3 constants of a lease replayed from its `lease-created` entry. The entry carries identity and an opening instant,
 *  never a state: parentage is `linked` (a request exists only for a linked verdict), the workspace is `unmeasured` (no carrier
 *  has corroborated it), and every future-facing field is inert. */
function leaseRowOfEntry(sequence: number, e: Extract<DelegationJournalEntryV1, { kind: 'lease-created' }>): DelegationLeaseRow {
  return {
    leaseId: e.leaseId, generation: 0, creatingJournalSequence: sequence, currentJournalSequence: sequence, activityId: e.activityId,
    parentId: e.parentId, parentIncarnation: e.parentIncarnation, project: e.project, adminRecord: e.adminRecord, canonicalPath: e.canonicalPath,
    creationBase: e.creationBase, sourceKind: e.sourceKind, parentageState: 'linked', workspaceState: 'unmeasured', disposition: 'ephemeral',
    cleanupState: 'not-due', cleanupPopulation: 'ephemeral-lease',
    // Replay sets first AND last observation, and the lineage opening, to the entry's own instant: never to replay time and
    // never to `acceptedAt`.
    firstObservedAt: e.firstObservedAt, lastObservedAt: e.firstObservedAt,
    terminalEvidenceAt: null, adoptedAt: null, retainedAt: null, promotedAt: null, cleanupDueAt: null, cleanupStartedAt: null,
    cleanupFinishedAt: null, cleanupEvidenceJson: null, carrierGenerationSeen: null, releasedAt: null,
  };
}

export type DelegationMetaOpenResult =
  | { kind: 'opened'; activityId: string }
  | { kind: 'already-open'; activityId: string }
  /** Opening waits for at least one retained event naming the agent: a meta read alone chooses no identity record. */
  | { kind: 'waiting-for-evidence' };

/** D-6269: what a retained Workflow launch response says of its run, keyed by the launch's (session, incarnation, tool-use id). Builder
 *  state only: never persisted, never a row, rebuilt from the retained records like the candidates. */
interface DelegationWorkflowLaunchFact {
  runEncoded: string;
  runId: string;
  taskId: string;
  /** The launch record's position, so a compaction that cuts it drops the entry with it (D-7021). */
  sequence: number;
  journalId: string;
}

const sameActivity = (a: DelegationActivityRow, b: DelegationActivityRow): boolean =>
  a.executionState === b.executionState && a.endedAt === b.endedAt && a.lastEventAt === b.lastEventAt;

/**
 * The working form of a checkpoint. Rows are held in maps and treated as immutable values (an update REPLACES a row), so
 * `clone()` is shallow and cheap. The journal's records go in through `foldRecord` (a record past the applied position) or
 * `observeRecord` (a record the checkpoint already covers, read for the journal-derived indexes, the lease proof and a covered task
 * notification, D-6269),
 * and `build()` comes out the other end sorted, hold-complete and validated. NOTHING here reads a clock or mints an ID that
 * the journal did not already name.
 */
export class DelegationCheckpointBuilder {
  private sessions = new Map<string, DelegationSessionRow>();
  private attempts = new Map<string, DelegationAttemptRow>();
  private activities = new Map<string, DelegationActivityRow>();
  private mapping: Record<string, string> = {};
  private intent: Record<string, string> = {};
  private leases = new Map<string, DelegationLeaseRow>();
  private lineage = new Map<string, DelegationLineageRow>();
  private cursors = new Map<string, DelegationBucketCursor>();
  private intervals = new Map<string, DelegationObservationInterval>();
  private candidates = new Map<string, DelegationActivityCandidate>();
  private leaseFacts = new Map<string, DelegationLeaseEntryFact>();
  /** Wave 5 (PR5a): the retained records of the three lease kinds, per lease, in sequence order (the proof and `computeHolds`). */
  private leaseRecords = new Map<string, readonly DelegationLeaseRecordFact[]>();
  /** Wave 5 (PR5a): the checkpoint-only carrier rows, by lease. */
  private carriers = new Map<string, DelegationLeaseCarrierRow>();
  private leaseByIdentity = new Map<string, string>();
  private leaseByPath = new Map<string, string>();
  private bashCalls = new Map<string, DelegationBashCallFact>();   // D-6267
  private bashDue: DueEntry[] = [];                                 // D-6267: a due heap over the 'pre' entries
  private stopDue: DueEntry[] = [];                                 // D-6270: a due heap over the stop-only candidates
  private workflowLaunches = new Map<string, DelegationWorkflowLaunchFact>();   // D-6269: first launch per (session, incarnation, tool-use id) wins
  /** D-7021: the sequence of the PreToolUse behind each 'equal' Bash-call fact, so a compaction that cuts that record drops the fact. */
  private equalPreSequence = new Map<string, number>();
  private coveredEnds = 0;                                          // D-6269: rows a covered task notification changed in this builder's life
  private appliedSequence = 0;
  private appliedJournalId: string | null = null;
  private appliedDigest: string | null = null;
  private revisionNo = 0;

  static from(cp: DelegationCheckpointV1): DelegationCheckpointBuilder {
    const b = new DelegationCheckpointBuilder();
    b.adoptRows(cp);
    b.appliedSequence = cp.appliedJournalSequence;
    b.appliedJournalId = cp.appliedJournalId;
    b.appliedDigest = cp.appliedJournalDigest;
    b.revisionNo = cp.revision;
    return b;
  }

  private adoptRows(cp: DelegationCheckpointV1): void {
    this.sessions = new Map(cp.sessions.map((r) => [sessionKeyOf(r.sessionId, r.parentIncarnation), r] as const));
    this.attempts = new Map(cp.attempts.map((r) => [r.attemptId, r] as const));
    this.activities = new Map(cp.activities.map((r) => [r.activityId, r] as const));
    this.mapping = { ...cp.activityIdsByNaturalKey };
    this.intent = { ...cp.coordinatorIntentByParent };
    this.leases = new Map(cp.leases.map((r) => [r.leaseId, r] as const));
    this.lineage = new Map(cp.lineage.map((r) => [r.lineageId, r] as const));
    this.carriers = new Map((cp.leaseCarriers ?? []).map((r) => [r.leaseId, r] as const));
    this.cursors = new Map(cp.bucketCursors.map((r) => [cursorKeyOf(r), r] as const));
    this.intervals = new Map(cp.observationIntervals.map((r) => [intervalKeyOf(r), r] as const));
    this.leaseByIdentity = new Map();
    this.leaseByPath = new Map();
    for (const l of cp.leases) this.indexLease(l);
  }

  private indexLease(l: DelegationLeaseRow): void {
    if (l.releasedAt !== null) return;
    this.leaseByIdentity.set(delegationLeaseIdentityKey(l), l.leaseId);
    this.leaseByPath.set(l.canonicalPath, l.leaseId);
  }

  clone(): DelegationCheckpointBuilder {
    const b = new DelegationCheckpointBuilder();
    b.sessions = new Map(this.sessions); b.attempts = new Map(this.attempts); b.activities = new Map(this.activities);
    b.mapping = { ...this.mapping }; b.intent = { ...this.intent }; b.leases = new Map(this.leases); b.lineage = new Map(this.lineage);
    b.cursors = new Map(this.cursors); b.intervals = new Map(this.intervals); b.candidates = new Map(this.candidates);
    b.leaseFacts = new Map(this.leaseFacts); b.leaseByIdentity = new Map(this.leaseByIdentity); b.leaseByPath = new Map(this.leaseByPath);
    b.leaseRecords = new Map(this.leaseRecords); b.carriers = new Map(this.carriers);
    b.bashCalls = new Map(this.bashCalls); b.bashDue = [...this.bashDue]; b.stopDue = [...this.stopDue];
    b.workflowLaunches = new Map(this.workflowLaunches); b.equalPreSequence = new Map(this.equalPreSequence); b.coveredEnds = this.coveredEnds;
    b.appliedSequence = this.appliedSequence; b.appliedJournalId = this.appliedJournalId; b.appliedDigest = this.appliedDigest;
    b.revisionNo = this.revisionNo;
    return b;
  }

  /** The leases as the journal adapter's deduplication sees them. */
  leaseView(): DelegationLeaseView {
    return { byIdentity: (k) => this.leaseByIdentity.get(k), byPath: (p) => this.leaseByPath.get(p) };
  }

  /** D-6269: how many activity rows covered task notifications changed (ended, or only `lastEventAt` moved) since this builder was made. */
  coveredEndsCount(): number { return this.coveredEnds; }

  activityOf(activityId: string): DelegationActivityRow | undefined { return this.activities.get(activityId); }
  /** PR5b: what a lease door decides from: the lease row, its carrier row, and what the record that wrote its current generation did
   *  (`undefined` when no such record is retained). */
  leaseActView(leaseId: string): { lease: DelegationLeaseRow | undefined; carrier: DelegationLeaseCarrierRow | undefined; lastAct: DelegationLeaseRecordFact['act'] | undefined } {
    const lease = this.leases.get(leaseId);
    const last = lease === undefined ? undefined : this.leaseRecords.get(leaseId)?.find((r) => r.writesGeneration && r.sequence === lease.currentJournalSequence);
    return { lease, carrier: this.carriers.get(leaseId), lastAct: last?.act };
  }
  appliedPosition(): { sequence: number; journalId: string | null; digest: string | null } {
    return { sequence: this.appliedSequence, journalId: this.appliedJournalId, digest: this.appliedDigest };
  }
  set revision(n: number) { this.revisionNo = n; }

  // ── the fold ───────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Applies a record the checkpoint has NOT yet covered: it must be the very next one in the chain. */
  foldRecord(record: DelegationJournalRecordV1): void {
    if (record.sequence !== this.appliedSequence + 1) refuse('fold-refused', `record ${record.sequence} does not follow the applied sequence ${this.appliedSequence}`);
    if (record.previousDigest !== this.appliedDigest) refuse('fold-refused', `record ${record.sequence} does not chain from the applied digest`);
    const entry = record.entry;
    switch (entry.kind) {
      case 'evidence-accepted': this.foldEvidence(record, entry.event, true); break;
      case 'lease-created': this.foldLease(record, entry); break;
      case 'lease-transition': case 'lease-released': case 'lease-carrier-seen': this.foldLeaseKind(record, entry); break;
    }
    this.appliedSequence = record.sequence;
    this.appliedJournalId = record.journalId;
    this.appliedDigest = record.digest;
  }

  /** Reads a record the checkpoint ALREADY covers: for the journal-derived indexes (identity candidates, Bash-call facts, the Workflow
   *  launch index) and the lease proof. It edits no row, with ONE exception: a covered task notification ends its run and that run's
   *  workers, a no-op on a checkpoint built since the rule existed and a backfill on one built before it (D-6269). An unmapped agent with
   *  a qualifying join in covered territory is a checkpoint that lost an activity. */
  observeRecord(record: DelegationJournalRecordV1): void {
    const entry = record.entry;
    if (entry.kind === 'evidence-accepted') this.foldEvidence(record, entry.event, false);
    else if (entry.kind === 'lease-created') this.leaseFacts.set(entry.leaseId, { sequence: record.sequence, journalId: record.journalId, entry });
    else this.noteLeaseRecord(record, entry);
  }

  private noteLeaseRecord(record: DelegationJournalRecordV1, entry: Exclude<DelegationJournalEntryV1, { kind: 'evidence-accepted' | 'lease-created' }>): void {
    const prior = this.leaseRecords.get(entry.leaseId) ?? [];
    const act = entry.kind === 'lease-transition' ? entry.reason : entry.kind === 'lease-released' ? 'released' : 'seen';
    this.leaseRecords.set(entry.leaseId, [...prior, { sequence: record.sequence, journalId: record.journalId, writesGeneration: act !== 'seen', act }]);
  }

  private touchSession(e: DelegationEventEnvelopeV1): void {
    const k = sessionKeyOf(e.sessionId, e.parentIncarnation);
    const s = this.sessions.get(k);
    if (s === undefined) {
      // A new session row carries no intent and no effective identity: those are the intent door's and the policy's, written
      // through a checkpoint-only change, never inferred by the fold.
      this.sessions.set(k, {
        sessionId: e.sessionId, parentIncarnation: e.parentIncarnation, explicitIntentAt: null, effective: false, effectiveBasis: [],
        claudeSessionIds: [e.claudeSessionId], firstObservedAt: e.observedAt, lastObservedAt: e.observedAt,
      });
      return;
    }
    this.sessions.set(k, {
      ...s,
      claudeSessionIds: s.claudeSessionIds.includes(e.claudeSessionId) ? s.claudeSessionIds : [...s.claudeSessionIds, e.claudeSessionId],
      firstObservedAt: minInstant(s.firstObservedAt, e.observedAt), lastObservedAt: maxInstant(s.lastObservedAt, e.observedAt),
    });
  }

  private foldEvidence(record: DelegationJournalRecordV1, e: DelegationEventEnvelopeV1, replay: boolean): void {
    const at = parseDelegationInstant(record.acceptedAt);
    this.ageStopCandidates(at);             // D-6270: BEFORE naming, so a join accepted at exactly the horizon opens from its own record (D-SC4)
    if (replay) this.touchSession(e);
    this.indexWorkflowLaunch(record, e);    // D-6269: before the naming loop, so a launch is indexed whether or not its join opens or refuses
    this.foldNotification(e, replay);       // D-6269
    for (const na of namedAgentsOf(e)) {
      const key: DelegationActivityNaturalKey = { parentId: e.sessionId, parentIncarnation: e.parentIncarnation, sourceKind: na.sourceKind, upstreamId: na.upstreamId };
      const encoded = encodeDelegationNaturalKey(key);
      // THE MAPPING IS READ FIRST (O4). A key the checkpoint holds keeps its ID whatever the journal still retains.
      const mapped = Object.hasOwn(this.mapping, encoded) ? this.mapping[encoded] : undefined;
      if (mapped !== undefined) {
        if (replay) this.touchActivity(mapped, e, na);
        if (na.sourceKind === 'bash-worktree') this.stepMappedBashFact(record, e, encoded, mapped, at);
        continue;
      }
      // A Bash call is decided across its two records (D-6267): see `foldBashCall` for an unmapped key and `stepMappedBashFact` for a
      // mapped one. DEVIATION D-4649 survives as rule A's no-entry arm: a PreToolUse with no listing (shed or unmeasured) pends nothing,
      // so a PostToolUse that carries one is the identity record. Every Bash record steps the call's fact on the observe path as on the
      // replay path, so recovery learns from the covered journal which mapped calls were zero-delta; a fact survives only while it is
      // pending or its key is mapped (D-6268).
      if (na.sourceKind === 'bash-worktree') { this.foldBashCall(record, e, key, encoded, replay, at); continue; }
      const prior = this.candidates.get(encoded);
      const stop = e.eventKind === 'SubagentStop';
      const candidate: DelegationActivityCandidate = prior === undefined
        ? { key, journalId: record.journalId, sequence: record.sequence, observedAt: e.observedAt, lastObservedAt: e.observedAt, endedAt: na.ends ? e.observedAt : null,
            stopOnly: stop, lastAcceptedAt: record.acceptedAt }
        : { ...prior, lastObservedAt: maxInstant(prior.lastObservedAt, e.observedAt), endedAt: prior.endedAt ?? (na.ends ? e.observedAt : null),
            stopOnly: prior.stopOnly && stop, lastAcceptedAt: maxInstant(prior.lastAcceptedAt, record.acceptedAt) };
      if (!na.join) {
        this.candidates.set(encoded, candidate);
        if (prior === undefined && candidate.stopOnly) duePush(this.stopDue, [at + DELEGATION_STOP_CANDIDATE_HORIZON_MS, encoded]);
        continue;
      }
      if (!replay) {
        refuse('fold-refused', `${na.sourceKind} ${na.upstreamId} of (${e.sessionId}, ${e.parentIncarnation}) has a qualifying join at sequence ${record.sequence}, inside the applied journal, but the checkpoint holds no activity for it`);
      }
      this.openFromCandidate(candidate, encoded);
    }
    this.ageBashCalls(at);   // AFTER naming: a Post accepted at exactly the bound still consumes its own Pre (A11c)
  }

  /** D-6269: indexes a Workflow launch response by its tool-use id. The first launch under a key wins. The guard is `namedAgentsOf`'s own
   *  (`workflowLaunchRunId`), so an indexed launch is always a qualifying join: it opened its run in replay, or refused in observe. */
  private indexWorkflowLaunch(record: DelegationJournalRecordV1, e: DelegationEventEnvelopeV1): void {
    const runId = workflowLaunchRunId(e);
    if (runId === null || e.eventKind !== 'PostToolUse' || e.toolName !== 'Workflow' || e.launch === null) return;
    const k = JSON.stringify([e.sessionId, e.parentIncarnation, e.toolUseId]);
    if (this.workflowLaunches.has(k)) return;
    this.workflowLaunches.set(k, {
      runEncoded: encodeDelegationNaturalKey({ parentId: e.sessionId, parentIncarnation: e.parentIncarnation, sourceKind: 'workflow', upstreamId: runId }),
      runId, taskId: e.launch.taskId, sequence: record.sequence, journalId: record.journalId,
    });
  }

  /** D-6269: a task notification whose tool-use id and task id are a Workflow launch's. A terminal status (`completed`, `failed`,
   *  `cancelled`) ends the run and its `<runId>-<n>` workers; `unknown` only touches `lastEventAt` (a paused workflow is not ended). An
   *  Agent's notification is never touched (the index holds Workflow launches only), and one journaled before its launch is ignored. In
   *  observe mode it is the one place a covered record edits a row. */
  private foldNotification(e: DelegationEventEnvelopeV1, replay: boolean): void {
    if (e.eventKind !== 'UserPromptSubmit') return;
    const n = e.notification;
    const L = this.workflowLaunches.get(JSON.stringify([e.sessionId, e.parentIncarnation, n.toolUseId]));
    if (L === undefined || L.taskId !== n.taskId) return;
    const runId = Object.hasOwn(this.mapping, L.runEncoded) ? this.mapping[L.runEncoded] : undefined;
    const run = runId === undefined ? undefined : this.activities.get(runId);
    if (run === undefined) return refuse('fold-refused', `the task notification of workflow run ${L.runId} of (${e.sessionId}, ${e.parentIncarnation}) finds no run row, although its launch was folded`);
    const terminal = n.status !== 'unknown';
    const changed: DelegationActivityRow[] = [];
    const nextRun: DelegationActivityRow = terminal && run.executionState !== 'ended'
      ? { ...run, executionState: 'ended', endedAt: maxInstant(e.observedAt, run.openedAt), lastEventAt: maxInstant(run.lastEventAt, e.observedAt) }
      : { ...run, lastEventAt: maxInstant(run.lastEventAt, e.observedAt) };
    if (!sameActivity(nextRun, run)) changed.push(nextRun);
    if (terminal) {
      // A worker of the run is exactly `<run id>-<canonical decimal>` under the same parent and incarnation: never a `-<digits>` suffix
      // test, since live run ids themselves end in `-<digits>`. A RUN whose own id is another run's id plus `-<decimal>` would be read as
      // that run's worker here; the observed run ids (`wf_<8 hex>-<suffix>`) never nest that way.
      const prefix = `${run.upstreamId}-`;
      for (const w of this.activities.values()) {
        if (w.sourceKind !== 'workflow' || w.parentId !== run.parentId || w.parentIncarnation !== run.parentIncarnation || w.executionState === 'ended') continue;
        if (!w.upstreamId.startsWith(prefix) || !isDelegationWorkerIndex(w.upstreamId.slice(prefix.length))) continue;
        changed.push({ ...w, executionState: 'ended', endedAt: maxInstant(e.observedAt, w.openedAt), lastEventAt: maxInstant(w.lastEventAt, e.observedAt) });
      }
    }
    for (const a of changed) this.activities.set(a.activityId, a);
    if (!replay) this.coveredEnds += changed.length;
  }

  /** D-6267: rule A, for a bash-worktree key the checkpoint does NOT map. `at` is the record's parsed acceptedAt. */
  private foldBashCall(record: DelegationJournalRecordV1, e: DelegationEventEnvelopeV1, key: DelegationActivityNaturalKey, encoded: string, replay: boolean, at: number): void {
    const listing = bashListingOf(e);              // undefined: unmeasured, shed, or not triggered
    const f = this.bashCalls.get(encoded);         // on an unmapped key only ever 'pre': 'equal' lives on mapped keys alone
    if (e.eventKind === 'PreToolUse') {
      if (listing === undefined) return;
      if (f === undefined) {
        this.bashCalls.set(encoded, { kind: 'pre', journalId: record.journalId, sequence: record.sequence, observedAt: e.observedAt,
          lastObservedAt: e.observedAt, listing, acceptedAtMs: at });
        duePush(this.bashDue, [at + DELEGATION_BASH_PENDING_MS, encoded]);
      } else if (f.kind === 'pre') {
        // a second listing-carrying Pre: identity and ageing origin stay the FIRST's (§5.2 "first event naming"); the compared listing
        // becomes the LATEST's, as the window builder's pre.set keeps the last
        this.bashCalls.set(encoded, { ...f, listing, lastObservedAt: maxInstant(f.lastObservedAt, e.observedAt) });
      }
      return;
    }
    let c: Omit<DelegationActivityCandidate, 'sequence' | 'stopOnly' | 'lastAcceptedAt'>;
    if (f !== undefined && f.kind === 'pre') {
      this.bashCalls.delete(encoded);
      if (listing !== undefined && delegationListingsEqual(f.listing, listing)) return;          // EQUAL: nothing opens
      c = { key, journalId: f.journalId, observedAt: f.observedAt, lastObservedAt: maxInstant(f.lastObservedAt, e.observedAt), endedAt: e.observedAt };
    } else {
      if (listing === undefined) return;                                                           // nothing known on either side
      c = { key, journalId: record.journalId, observedAt: e.observedAt, lastObservedAt: e.observedAt, endedAt: e.observedAt };   // D-4649, Post-only
    }
    if (!replay) refuse('fold-refused', `bash-worktree ${key.upstreamId} of (${key.parentId}, ${key.parentIncarnation}) opens at sequence ${record.sequence}, inside the applied journal, but the checkpoint holds no activity for it`);
    this.openFromCandidate(c, encoded);
  }

  /** D-6267: a Bash record on a MAPPED key, after the mapping-first branch. Learns, from the journal alone, which old-rule rows were
   *  zero-delta calls (D-6268 retires them). Never opens, never refuses, never touches a row. */
  private stepMappedBashFact(record: DelegationJournalRecordV1, e: DelegationEventEnvelopeV1, encoded: string, activityId: string, at: number): void {
    const listing = bashListingOf(e);
    const f = this.bashCalls.get(encoded);
    if (f === undefined) {
      if (e.eventKind !== 'PreToolUse' || listing === undefined) return;
      if (this.activities.get(activityId)?.identityJournalId !== record.journalId) return;   // only the row's own identity Pre
      this.bashCalls.set(encoded, { kind: 'pre', journalId: record.journalId, sequence: record.sequence, observedAt: e.observedAt,
        lastObservedAt: e.observedAt, listing, acceptedAtMs: at });
      duePush(this.bashDue, [at + DELEGATION_BASH_PENDING_MS, encoded]);
      return;
    }
    if (f.kind === 'pre' && e.eventKind === 'PostToolUse' && listing !== undefined && delegationListingsEqual(f.listing, listing)) {
      this.bashCalls.set(encoded, { kind: 'equal', preJournalId: f.journalId });
      this.equalPreSequence.set(encoded, f.sequence);
      return;
    }
    this.bashCalls.delete(encoded);      // spoiled: a second Pre, an unmeasured or differing Post, any record after the decision
    this.equalPreSequence.delete(encoded);
  }

  /** D-6270: forgets every stop-only candidate named last at least DELEGATION_STOP_CANDIDATE_HORIZON_MS before this record's acceptance.
   *  BEFORE naming, so a join accepted at exactly the horizon opens from its own record (D-SC4). Lazy re-check: a popped entry whose
   *  candidate is gone or no longer stop-only is dropped; one whose last naming moved is re-filed at its new due time. Bare occurrences
   *  never age (the meta door needs them), and any owner's record ages any owner's candidate. */
  private ageStopCandidates(at: number): void {
    for (let top = this.stopDue[0]; top !== undefined && top[0] <= at; top = this.stopDue[0]) {
      duePop(this.stopDue);
      const c = this.candidates.get(top[1]);
      if (c === undefined || !c.stopOnly) continue;
      const due = parseDelegationInstant(c.lastAcceptedAt) + DELEGATION_STOP_CANDIDATE_HORIZON_MS;
      if (due <= at) this.candidates.delete(top[1]);
      else duePush(this.stopDue, [due, top[1]]);
    }
  }

  /** D-6267: forgets every 'pre' entry whose Pre was accepted DELEGATION_BASH_PENDING_MS or more before this record. AFTER naming, so a
   *  Post accepted at exactly the bound still consumes its own Pre (A11c). Pops due entries; re-reads each; never scans the map. */
  private ageBashCalls(at: number): void {
    for (let top = this.bashDue[0]; top !== undefined && top[0] <= at; top = this.bashDue[0]) {
      duePop(this.bashDue);
      const f = this.bashCalls.get(top[1]);
      if (f !== undefined && f.kind === 'pre' && at - f.acceptedAtMs >= DELEGATION_BASH_PENDING_MS) this.bashCalls.delete(top[1]);
    }
  }

  /** The Bash-call fact for an encoded natural key, if the builder holds one (read only; tests and the retirement door). */
  bashCallFactOf(encoded: string): DelegationBashCallFact | undefined { return this.bashCalls.get(encoded); }
  bashCallFactCount(): number { return this.bashCalls.size; }
  /** The count of PENDING Bash calls: 'pre' entries on a key the checkpoint does not map (the ones `computeHolds` holds). */
  pendingBashCallCount(): number {
    let n = 0;
    for (const [encoded, f] of this.bashCalls) if (f.kind === 'pre' && !Object.hasOwn(this.mapping, encoded)) n++;
    return n;
  }

  private touchActivity(activityId: string, e: DelegationEventEnvelopeV1, na: DelegationNamedUpstream): void {
    const a = this.activities.get(activityId);
    if (a === undefined) return refuse('fold-refused', `the mapping names activity ${activityId}, which has no row`);
    const ends = na.ends && a.executionState !== 'ended';
    this.activities.set(activityId, {
      ...a,
      lastEventAt: maxInstant(a.lastEventAt, e.observedAt),
      executionState: ends ? 'ended' : a.executionState,
      endedAt: ends ? maxInstant(e.observedAt, a.openedAt) : a.endedAt,
    });
  }

  /** `c` carries no `sequence`, `stopOnly` or `lastAcceptedAt`: opening never reads them, and a worker opened from its run's row (or a Bash call
   *  opened from its Pre) has no candidate record to take them from. */
  private openFromCandidate(c: Omit<DelegationActivityCandidate, 'sequence' | 'stopOnly' | 'lastAcceptedAt'>, encoded: string): string {
    // The ID is derived from the IDENTITY RECORD's accepted journalId, through the model's mapping-first function, written
    // INTO this builder's own mapping (D-5833): the mapping is private to the builder, so there is no wrapper and no copy.
    const activityId = allocateDelegationActivityIdInto(this.mapping, c.key, c.journalId);
    const ended = c.endedAt !== null;
    this.activities.set(activityId, {
      activityId, parentId: c.key.parentId, parentIncarnation: c.key.parentIncarnation, sourceKind: c.key.sourceKind,
      upstreamId: c.key.upstreamId, identityJournalId: c.journalId, displayName: null, executionState: ended ? 'ended' : 'active',
      openedAt: c.observedAt, endedAt: ended && c.endedAt !== null ? maxInstant(c.endedAt, c.observedAt) : null, lastEventAt: c.lastObservedAt,
    });
    this.candidates.delete(encoded);
    return activityId;
  }

  /**
   * Opens an agent's activity on a POSITIVE META READ: a join that is not a journal event. It needs at least one retained
   * event naming the agent (the candidate) to choose the identity record, and it hashes nothing of the meta itself or of the
   * time it was read. The new ID exists only in this builder: it is the caller's duty (the applier's) not to let it escape
   * until a checkpoint holding it has been atomically replaced (O1).
   */
  openFromMeta(parentId: string, parentIncarnation: string, agentId: string): DelegationMetaOpenResult {
    const key: DelegationActivityNaturalKey = { parentId, parentIncarnation, sourceKind: 'agent', upstreamId: agentId };
    const encoded = encodeDelegationNaturalKey(key);
    const mapped = Object.hasOwn(this.mapping, encoded) ? this.mapping[encoded] : undefined;
    if (mapped !== undefined) return { kind: 'already-open', activityId: mapped };
    const candidate = this.candidates.get(encoded);
    if (candidate === undefined) return { kind: 'waiting-for-evidence' };
    return { kind: 'opened', activityId: this.openFromCandidate(candidate, encoded) };
  }

  /**
   * Opens a Workflow WORKER's activity on a POSITIVE WORKFLOW META read, the sibling of `openFromMeta`. The worker's upstream ID is
   * `<runId>-<workerIndex>`: the run comes from the launch response, the index only from the meta. The launch response is the RUN's
   * qualifying join (ruling R44): it opened the run's own activity row and mapping, so the run's identity journalId is CHECKPOINT
   * data (O4) and pruning is never held for it. Every worker takes that identity (and the run's ended state) from the run's row; a meta
   * alone, with no run open, chooses no identity and waits. A worker the checkpoint already holds keeps its ID. The index comes from a
   * meta file, which is untrusted content, so anything but a non-negative safe integer is refused. A parent `Stop` is not an input
   * (amendment `parent-stop-does-not-bound-workflow-start`). Like `openFromMeta` this is a NON-DURABLE builder door: the new ID
   * exists only in this builder and must not escape until a checkpoint holding it has been atomically replaced (O1).
   */
  openWorkflowWorkerFromMeta(parentId: string, parentIncarnation: string, runId: string, workerIndex: number): DelegationMetaOpenResult {
    if (typeof workerIndex !== 'number' || !isDelegationWorkerIndex(workerIndex)) {
      refuse('bad-shape', `a workflow worker index is a non-negative safe integer, not ${String(workerIndex)}`);
    }
    const worker: DelegationActivityNaturalKey = { parentId, parentIncarnation, sourceKind: 'workflow', upstreamId: `${runId}-${workerIndex}` };
    const encoded = encodeDelegationNaturalKey(worker);
    const mapped = Object.hasOwn(this.mapping, encoded) ? this.mapping[encoded] : undefined;
    if (mapped !== undefined) return { kind: 'already-open', activityId: mapped };
    const runKey = encodeDelegationNaturalKey({ parentId, parentIncarnation, sourceKind: 'workflow', upstreamId: runId });
    const runMapped = Object.hasOwn(this.mapping, runKey) ? this.mapping[runKey] : undefined;
    const run = runMapped === undefined ? undefined : this.activities.get(runMapped);
    if (run === undefined) return { kind: 'waiting-for-evidence' };
    return {
      kind: 'opened',
      activityId: this.openFromCandidate(
        { key: worker, journalId: run.identityJournalId, observedAt: run.openedAt, lastObservedAt: run.lastEventAt, endedAt: run.endedAt }, encoded),
    };
  }

  private foldLease(record: DelegationJournalRecordV1, e: Extract<DelegationJournalEntryV1, { kind: 'lease-created' }>): void {
    const activity = this.activities.get(e.activityId);
    if (activity === undefined) refuse('fold-refused', `lease ${e.leaseId} names the activity ${e.activityId}, which the checkpoint does not hold`);
    if (activity.parentId !== e.parentId || activity.parentIncarnation !== e.parentIncarnation) {
      refuse('fold-refused', `lease ${e.leaseId} names a parent other than its activity's`);
    }
    if (this.leases.has(e.leaseId)) refuse('fold-refused', `lease ${e.leaseId} already exists`);
    const identity = delegationLeaseIdentityKey(e);
    if (this.leaseByIdentity.has(identity)) refuse('fold-refused', `lease ${e.leaseId} repeats an unreleased lease identity`);
    if (this.leaseByPath.has(e.canonicalPath)) refuse('fold-refused', `lease ${e.leaseId}'s canonical path is held by an unreleased lease`);
    if (e.lineageId !== deriveDelegationLineageId(e)) refuse('fold-refused', `lease ${e.leaseId}'s lineageId is not the derivation from its tuple`);
    const row = leaseRowOfEntry(record.sequence, e);
    this.leases.set(row.leaseId, row);
    this.indexLease(row);
    this.lineage.set(e.lineageId, {
      lineageId: e.lineageId, parentId: e.parentId, parentIncarnation: e.parentIncarnation, activityId: null, leaseId: e.leaseId, runId: null,
      openedAt: e.firstObservedAt, closedAt: null, closeReason: null,
    });
    this.leaseFacts.set(e.leaseId, { sequence: record.sequence, journalId: record.journalId, entry: e });
  }

  /**
   * Wave 5 (PR5a): one record of the three lease kinds, folded through the ONE decision (`delegation-lease-state.ts`, the replay
   * passing `carrierRequired: false`). A refusal (an unknown lease, a skipped or repeated generation, a state the table does not
   * allow, fields that contradict the decision) is `fold-refused`, so recovery stays `reconstructing` rather than fold it. A release
   * frees the lease's identity and canonical path for a later lease.
   */
  private foldLeaseKind(record: DelegationJournalRecordV1, e: Exclude<DelegationJournalEntryV1, { kind: 'evidence-accepted' | 'lease-created' }>): void {
    const lease = this.leases.get(e.leaseId);
    if (e.kind === 'lease-carrier-seen') {
      const seen = foldLeaseCarrierSeen(lease, e);
      if (!seen.ok) refuse('fold-refused', `record ${record.sequence}: ${seen.refusal}: ${seen.detail}`);
      this.leases.set(e.leaseId, seen.lease);
      this.noteLeaseRecord(record, e);
      return;
    }
    const carrier = this.carriers.get(e.leaseId);
    const lineage = [...this.lineage.values()];
    const out = e.kind === 'lease-transition'
      ? foldLeaseTransition({ lease, carrier, lineage, entry: e, sequence: record.sequence,
        runLineageId: (runId) => deriveDelegationRunLineageId({ leaseId: e.leaseId, parentId: lease?.parentId ?? '', parentIncarnation: lease?.parentIncarnation ?? '', runId }) })
      : foldLeaseRelease({ lease, carrier, lineage, entry: e, sequence: record.sequence });
    if (!out.ok) refuse('fold-refused', `record ${record.sequence}: ${out.refusal}: ${out.detail}`);
    const { fold } = out;
    for (const n of fold.lineage) {
      const prior = this.lineage.get(n.lineageId);
      if (prior !== undefined && prior.closedAt === null && n.closedAt === null) refuse('fold-refused', `record ${record.sequence} reopens lineage ${n.lineageId}`);
      if (prior !== undefined && n.closedAt === null) refuse('fold-refused', `record ${record.sequence} opens lineage ${n.lineageId}, which exists`);
      this.lineage.set(n.lineageId, n);
    }
    if (fold.lease.releasedAt !== null && lease?.releasedAt === null) {
      const ik = delegationLeaseIdentityKey(fold.lease);
      if (this.leaseByIdentity.get(ik) === e.leaseId) this.leaseByIdentity.delete(ik);
      if (this.leaseByPath.get(fold.lease.canonicalPath) === e.leaseId) this.leaseByPath.delete(fold.lease.canonicalPath);
    }
    // D-7973 (review 1451 F13): the floor folds every effect a later writer's entry has, so `adopt` keeps the parent's identity
    // alive here, not in PR7: `retained-lineage` joins the effective basis of the lease's parent row (spec §5.1), and nothing removes it.
    if (e.kind === 'lease-transition' && e.reason === 'adopt') {
      const k = sessionKeyOf(fold.lease.parentId, fold.lease.parentIncarnation);
      const parent = this.sessions.get(k);
      if (parent === undefined) refuse('fold-refused', `record ${record.sequence} adopts lease ${e.leaseId}, whose parent (${fold.lease.parentId}, ${fold.lease.parentIncarnation}) has no session row`);
      this.sessions.set(k, withDelegationIntentSource(parent, 'retained-lineage'));
    }
    this.leases.set(e.leaseId, fold.lease);
    if (fold.carrier === null) this.carriers.delete(e.leaseId); else this.carriers.set(e.leaseId, fold.carrier);
    this.noteLeaseRecord(record, e);
  }

  // ── checkpoint-only state ──────────────────────────────────────────────────────────────────────────────────────────

  /** Sets a bucket's cursor row. `replaced` is MONOTONIC (R36): a result computed from a stale state can never write `false` over a
   *  durable `true`, so a replaced bucket cannot be un-replaced by an overlapping tick. When it ORs the flag it also keeps the durable
   *  row's DETAIL and `intervalState: 'unmeasured'` (Task 9 re-review 2, minor 1): a stale result's words (`torn-tail: ...`, or none)
   *  would otherwise sit on a replaced row, and every later tick answers the row's detail. Where the cursor itself moves is Task 13's. */
  setCursor(cursor: DelegationBucketCursor): void {
    const key = cursorKeyOf(cursor);
    const prior = this.cursors.get(key);
    this.cursors.set(key, prior !== undefined && prior.replaced && !cursor.replaced
      ? { ...cursor, replaced: true, intervalState: 'unmeasured', detail: prior.detail }
      : cursor);
  }
  mergeInterval(interval: DelegationObservationInterval): void {
    const k = intervalKeyOf(interval);
    this.intervals.set(k, mergeDelegationObservationInterval(this.intervals.get(k), interval));
  }

  /** The interval upkeep (retention, and the hour that was never closed), decided on THIS builder's own rows: the ONE place interval rows are
   *  replaced (wave 4, Task 3.1). True iff a row left or changed. */
  upkeepIntervals(nowMs: number): boolean {
    const up = upkeepDelegationIntervals([...this.intervals.values()], nowMs);
    if (!up.changed) return false;
    this.intervals = new Map(up.intervals.map((r) => [intervalKeyOf(r), r] as const));
    return true;
  }

  /**
   * Retires the cursor rows `planDelegationCursorRetention` drops (R58, D-4654), decided on THIS builder's own rows: its cursors and
   * its intervals, as they stand under the applier's lock. It is the only place a cursor row is removed, and it never edits one.
   */
  dropBucketCursors(nowMs: number): { dropped: number; unparseable: number } {
    const plan = planDelegationCursorRetention([...this.cursors.values()], [...this.intervals.values()], nowMs);
    for (const c of plan.drop) this.cursors.delete(cursorKeyOf(c));
    return { dropped: plan.drop.length, unparseable: plan.unparseable.length };
  }

  /** D-6268: [encoded key, activityId] for every mapped Bash call the door may retire, sorted by activityId. Read only. */
  private retirableZeroDeltaEntries(): (readonly [string, string])[] {
    const named = new Set<string>();
    for (const l of this.leases.values()) named.add(l.activityId);                                  // released or not (a released lease still names it)
    for (const n of this.lineage.values()) if (n.activityId !== null) named.add(n.activityId);      // open or closed
    const out: (readonly [string, string])[] = [];
    for (const [encoded, f] of this.bashCalls) {
      if (f.kind !== 'equal' || !Object.hasOwn(this.mapping, encoded)) continue;
      const id = this.mapping[encoded]!;
      const a = this.activities.get(id);
      if (a === undefined) continue;
      if (a.sourceKind !== 'bash-worktree') continue;                 // declared equivalent (MB8), kept
      if (a.executionState !== 'ended') continue;                     // equivalent while 'unknown' has no writer (MB5), kept, pinned by RB6
      if (a.identityJournalId !== f.preJournalId) continue;           // equivalent under the start rule (MB7), kept, RB9
      if (named.has(id)) continue;                                    // no lease row, no lineage row names it
      out.push([encoded, id] as const);
    }
    return out.sort(([, x], [, y]) => (x < y ? -1 : x > y ? 1 : 0));
  }

  /** D-6268: the activity IDs of the mapped Bash calls the door would retire now (read only). */
  retirableZeroDeltaBash(): string[] { return this.retirableZeroDeltaEntries().map(([, id]) => id); }

  /** D-6268: the first builder code that deletes from the mapping or the activities. Row, map entry and fact leave together. */
  retireZeroDeltaBash(): number {
    const list = this.retirableZeroDeltaEntries();
    for (const [encoded, id] of list) {
      delete this.mapping[encoded]; this.activities.delete(id); this.bashCalls.delete(encoded); this.equalPreSequence.delete(encoded);
    }
    return list.length;
  }

  /**
   * C1 (D-7001, D-7024): the second builder code that deletes from the mapping or the activities. It retires the activities the compaction
   * planner found retirable behind the cut (`DelegationCompactionPlan.retirable`): row, natural-key mapping, Bash-call fact and every Workflow
   * launch-index entry whose run it names leave together, so a late task notification of a retired run finds no launch and is ignored. The
   * planner decided on the durable checkpoint under the same lock; a row that has since become active, or that a lease or lineage row names,
   * is refused (`change-refused`) and nothing is retired.
   */
  retireBehindCut(activityIds: readonly string[]): number {
    const ids = new Set(activityIds);
    const named = new Set<string>();
    for (const l of this.leases.values()) named.add(l.activityId);
    for (const n of this.lineage.values()) if (n.activityId !== null) named.add(n.activityId);
    for (const id of ids) {
      const a = this.activities.get(id);
      if (a === undefined) continue;
      if (a.executionState !== 'ended' || named.has(id)) refuse('change-refused', `activity ${id} is not retirable behind the cut: it has not ended, or a lease or lineage row names it`);
    }
    const runs = new Set<string>();
    for (const [encoded, id] of Object.entries(this.mapping)) {
      if (!ids.has(id)) continue;
      if (this.activities.get(id)?.sourceKind === 'workflow') runs.add(encoded);
      delete this.mapping[encoded]; this.bashCalls.delete(encoded); this.equalPreSequence.delete(encoded);
    }
    let n = 0;
    for (const id of ids) if (this.activities.delete(id)) n++;
    for (const [k, L] of this.workflowLaunches) if (runs.has(L.runEncoded)) this.workflowLaunches.delete(k);
    return n;
  }

  /**
   * D-7021, the compaction's `memory-prune`: drops every journal-derived fact whose source record the cut removed (at or below `cutThrough`
   * and not carried), so this builder equals what a recovery over the compacted set rebuilds: a Bash-call fact (its PreToolUse), a Workflow
   * launch-index entry (its launch). A candidate needs no rule: every record naming a held key is carried (K2), and every candidate is held.
   * Lease facts need none either: every lease is unreleased, so its creating record is carried (K1).
   */
  dropCutFacts(cutThrough: number, carriedJournalIds: ReadonlySet<string>): void {
    const cut = (sequence: number | undefined, journalId: string): boolean => sequence !== undefined && sequence <= cutThrough && !carriedJournalIds.has(journalId);
    for (const [encoded, f] of [...this.bashCalls]) {
      const gone = f.kind === 'pre' ? cut(f.sequence, f.journalId) : cut(this.equalPreSequence.get(encoded), f.preJournalId);
      if (gone) { this.bashCalls.delete(encoded); this.equalPreSequence.delete(encoded); }
    }
    for (const [k, L] of [...this.workflowLaunches]) if (cut(L.sequence, L.journalId)) this.workflowLaunches.delete(k);
  }

  /** D-6268: whether this row's call is a zero-delta Bash call (its fact is 'equal'): such a call created no worktree and is never a lease activity. */
  isZeroDeltaBashCall(a: DelegationActivityRow): boolean {
    if (a.sourceKind !== 'bash-worktree') return false;
    const encoded = encodeDelegationNaturalKey({ parentId: a.parentId, parentIncarnation: a.parentIncarnation, sourceKind: a.sourceKind, upstreamId: a.upstreamId });
    return this.bashCalls.get(encoded)?.kind === 'equal';
  }

  /** Replaces the ROWS from a checkpoint a checkpoint-only change produced, keeping the applied position and the journal-derived
   *  indexes (identity candidates, lease facts, Bash-call facts, the Workflow launch index and the due heaps; a change cannot move any of them). A candidate whose key the change mapped is no longer one. */
  replaceRows(cp: DelegationCheckpointV1): void {
    // A COPY: the change that produced `cp` may still hold an alias to it, and an edit through that alias must not reach the rows
    // the applier now owns (R27).
    this.adoptRows(structuredClone(cp));
    for (const encoded of [...this.candidates.keys()]) if (Object.hasOwn(this.mapping, encoded)) this.candidates.delete(encoded);
  }

  // ── holds and build ────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Every pruning hold the state implies, recomputed from the rows and the complete journal's facts (never carried over):
   *   - `checkpoint-anchor`: the applied record, so the anchor can always be verified;
   *   - `open-lease`: each unreleased lease's creating record, its correlation evidence and every record of its lease kinds;
   *   - `open-lineage`: each open lineage edge's references (its lease's creating record and evidence, or its activity's identity record);
   *   - `identity-candidate`: the earliest retained record naming each AGENT no qualifying join has opened (a bare occurrence, or a
   *     start-less stop until `DELEGATION_STOP_CANDIDATE_HORIZON_MS` passes, D-6270), and the first listing-carrying PreToolUse of each
   *     PENDING Bash call on an unmapped key (D-6267; spec §5.12: its identity event precedes its opening). POSITION IS NOT COVERAGE
   *     (W3-M17). A Workflow run is never a candidate: its launch response is its join (R44).
   * An activity that IS mapped needs no hold: its ID survives pruning in the checkpoint (O4). A retired zero-delta Bash call needs none
   * either, but only while both of its records are retained: then neither is a qualifying join, so nothing it named can open again (D-6268).
   * The same premise covers every consumed rule-A pair, which holds nothing here once its PostToolUse has consumed its PreToolUse: a
   * PostToolUse kept without its PreToolUse takes the Post-only arm and refuses `fold-refused` on a covered record. So wave 4's compaction
   * must keep a listing-carrying Bash call's PreToolUse and PostToolUse together (D-6267, D-6268).
   */
  computeHolds(): DelegationPruningHold[] {
    const holds = new Map<string, DelegationPruningHold>();
    const add = (h: DelegationPruningHold): void => { holds.set(JSON.stringify([h.reason, h.journalId, h.ownerId]), h); };
    if (this.appliedJournalId !== null) add({ journalId: this.appliedJournalId, reason: 'checkpoint-anchor', ownerId: 'checkpoint' });
    // A lease's records: its creating record, its correlation evidence, and (wave 5) every retained record of its lease kinds, so a
    // compaction carries a transition while its lease is open (K1) and recovery can prove the lease's generation from the journal.
    const leaseEvidence = (leaseId: string): string[] => {
      const f = this.leaseFacts.get(leaseId);
      const own = (this.leaseRecords.get(leaseId) ?? []).map((r) => r.journalId);
      return f === undefined ? own : [f.journalId, ...f.entry.correlationJournalIds, ...own];
    };
    for (const l of this.leases.values()) {
      if (l.releasedAt !== null) continue;
      for (const id of leaseEvidence(l.leaseId)) add({ journalId: id, reason: 'open-lease', ownerId: l.leaseId });
    }
    for (const n of this.lineage.values()) {
      if (n.closedAt !== null) continue;
      if (n.leaseId !== null) for (const id of leaseEvidence(n.leaseId)) add({ journalId: id, reason: 'open-lineage', ownerId: n.lineageId });
      if (n.activityId !== null) {
        const a = this.activities.get(n.activityId);
        if (a !== undefined) add({ journalId: a.identityJournalId, reason: 'open-lineage', ownerId: n.lineageId });
      }
    }
    for (const [encoded, c] of this.candidates) add({ journalId: c.journalId, reason: 'identity-candidate', ownerId: encoded });
    for (const [encoded, f] of this.bashCalls) {
      if (f.kind === 'pre' && !Object.hasOwn(this.mapping, encoded)) add({ journalId: f.journalId, reason: 'identity-candidate', ownerId: encoded });
    }
    return sortedBy(holds.values(), (h) => `${h.reason}\u0000${h.journalId}\u0000${h.ownerId}`);
  }

  /** The checkpoint this state stands for, with every row sorted, the holds recomputed, and every invariant checked. Throws
   *  (a `DelegationCheckpointError` or `DelegationModelError`) rather than return a checkpoint the journal or SQLite would refuse. */
  build(revision: number): DelegationCheckpointV1 {
    const rows = sortedProjectionRows({
      sessions: [...this.sessions.values()], attempts: [...this.attempts.values()], activities: [...this.activities.values()],
      leases: [...this.leases.values()], lineage: [...this.lineage.values()],
    });
    const cp: DelegationCheckpointV1 = {
      v: 1, revision, appliedJournalSequence: this.appliedSequence, appliedJournalId: this.appliedJournalId, appliedJournalDigest: this.appliedDigest,
      activityIdsByNaturalKey: sortedMap(this.mapping), coordinatorIntentByParent: sortedMap(this.intent),
      sessions: rows.sessions, attempts: rows.attempts, activities: rows.activities, leases: rows.leases, lineage: rows.lineage,
      bucketCursors: sortedBy(this.cursors.values(), cursorKeyOf), observationIntervals: sortedBy(this.intervals.values(), intervalKeyOf),
      pruningHolds: this.computeHolds(),
      // Absent when empty, so a checkpoint with no lease transition is byte-identical to wave 4's.
      ...(this.carriers.size === 0 ? {} : { leaseCarriers: sortedBy(this.carriers.values(), (c) => c.leaseId) }),
    };
    validateDelegationCheckpoint(cp, this.leaseFacts, this.leaseRecords);
    return cp;
  }
}

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

// ── The SQLite projection port and its repair (ruling R20) ───────────────────────────────────────────────────────────

/**
 * What the applier needs of `coord.db`, as a port. Every call is the synchronous store; nothing is awaited inside one.
 *
 * The PRODUCTION port is six `CoordStore` methods, one per member (this module may not reach around the store for its handle:
 * the coord ring, pinned by `single-definition.test.ts`, so the store is the only thing that holds it):
 *   - `project(cp)`        is `store.projectDelegationCheckpoint(cp)` (the five non-event tables, one transaction);
 *   - `projectChanged(prior, next)` is `store.projectDelegationCheckpointChanges(prior, next)`: the rows that changed between the two
 *                           checkpoints, written by compare-and-swap in one transaction, or the FULL projection inside the same call
 *                           when the pure diff does not apply (it answers which, as `{ mode: 'delta', rows }` or `{ mode: 'full' }`).
 *                           The applier calls it only while its witness holds (see `projectLocked`); every repair keeps `project`;
 *   - `insertEvents(rows)` is `store.insertDelegationEvents(rows)` (ONE transaction; a conflict is reported, never thrown, and
 *                           does not stop the rows after it);
 *   - `eventStats()`       is `store.delegationEventStats()` (`COUNT(*)` and `MAX(journalSequence)` of `delegation_events`);
 *   - `countEventsAtOrBelow` and `deleteEventsBetween` delegate to the store's indexed retention methods below.
 * The wiring is six one-line adapters, which `delegation-recovery.test.ts` builds and runs against the real store.
 */
export interface DelegationProjectionPort {
  project(checkpoint: DelegationCheckpointV1): void;
  /** The rows of `next` that differ from `prior`, written in one transaction (or the full projection, answered as `mode: 'full'`). A refusal
   *  throws, as `project` does; the applier then marks the projection stale and the next application repairs it in full. REQUIRED, so a
   *  port that forgets it is a compile error rather than a silent fall back to the full write. */
  projectChanged(prior: DelegationCheckpointV1, next: DelegationCheckpointV1): DelegationProjectChangesResult;
  /** ONE transaction for the whole list. A conflict is reported, not thrown, and does not abort the others. */
  insertEvents(rows: readonly DelegationEventRow[]): DelegationInsertEventsResult;
  eventStats(): { count: number; maxSequence: number | null };
  /** D-7021: `delegation_events` rows at or below a journal sequence (`CoordStore.countDelegationEventsAtOrBelow`). Throws on a failed read. */
  countEventsAtOrBelow(sequence: number): number;
  /** D-7021: deletes at most `limit` rows with `afterExclusive < journalSequence <= throughInclusive`, in one statement and one transaction,
   *  and answers how many it deleted (`CoordStore.deleteDelegationEventsBetween`). Throws on failure; that statement is rolled back. */
  deleteEventsBetween(afterExclusive: number, throughInclusive: number, limit: number): number;
}

export interface DelegationProjectionRepairReport {
  /** The highest journalSequence SQLite held when the replay began. */
  resumedAfter: number;
  inserted: number;
  duplicate: number;
  /** Sessions whose SQLite events disagreed with the journal and were deleted and replayed from it. */
  healedSessions: number;
  /** True when SQLite's event count disagreed with the journal's below the resume point, so every event was replayed. */
  fullReplay: boolean;
  /** True when SQLite held events the journal does not (stray rows), or a conflict was still outstanding after the sessions that
   *  held one were healed: every session's events were deleted and replayed. The last resort, and the only repair that costs
   *  O(all events); it is drift, never a normal path. */
  wipedAll: boolean;
  /** How many times the repair read the journal from its start. 0 when SQLite's (count, max) already matched recovery's counts. */
  journalPasses: number;
  /** D-5836: true only for the lane's per-pass repair that found the projection known current and did nothing (no `project()`, no replay;
   *  every count is then 0, and `resumedAfter` is SQLite's max). Every full repair carries false: a reader tells the two apart by this,
   *  never by the zeros. */
  skipped: boolean;
  /** D-7021: the rows step 0 deleted below the journal's first retained sequence (a compaction that died between its journal rename and its
   *  SQLite delete, or whose delete failed): deleted in the gaps between the carried evidence, never a wipe. */
  prunedBelow: number;
}

/** D-5836: a full repair runs at least this often (one hour) even when the per-pass repair finds the projection known current, so
 *  out-of-band damage to the five non-event tables heals within about an hour. Measured on `monotonicMs`, else on `now`. */
export const DELEGATION_REPAIR_FULL_MS = 60 * 60_000;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

/** D-7021: how many `delegation_events` rows one delete statement takes; the loop gets a turn between two. */
export const DELEGATION_EVENTS_DELETE_CHUNK = 5000;

/**
 * D-7021: deletes SQLite's evidence rows at or below `through` in the gaps between the carried evidence sequences (which are kept), in chunks of
 * `chunk` rows with the loop yielded after each. The ONE walk, used by the compaction's `events-delete` and the repair's step 0. Answers how
 * many rows it deleted. A store failure throws; the caller decides what it means.
 */
export async function deleteEventsInGaps(projection: DelegationProjectionPort, through: number, carried: readonly number[], chunk: number): Promise<number> {
  const remove = projection.deleteEventsBetween;
  let deleted = 0;
  let after = 0;
  for (const bound of [...carried.filter((c) => c <= through), through + 1]) {
    if (bound - 1 > after) {
      for (;;) {
        const n = remove.call(projection, after, bound - 1, chunk);
        deleted += n;
        await yieldToEventLoop();
        if (n < chunk) break;
      }
    }
    after = Math.max(after, bound);
  }
  return deleted;
}

/** The checkpoint without some sessions and everything that names them: projecting it deletes those sessions' events (the
 *  projection deletes the events of a LEAVING session), and projecting the whole checkpoint again re-adds the sessions. */
function checkpointWithoutSessions(cp: DelegationCheckpointV1, drifted: readonly { sessionId: string; incarnation: string }[]): DelegationCheckpointV1 {
  const gone = new Set(drifted.map((k) => sessionKeyOf(k.sessionId, k.incarnation)));
  const keep = (r: { parentId: string; parentIncarnation: string }): boolean => !gone.has(sessionKeyOf(r.parentId, r.parentIncarnation));
  const leases = cp.leases.filter(keep);
  const kept = new Set(leases.map((l) => l.leaseId));
  const carriers = (cp.leaseCarriers ?? []).filter((c) => kept.has(c.leaseId));
  const { leaseCarriers: _dropped, ...rest } = cp;
  return {
    ...rest,
    sessions: cp.sessions.filter((s) => !gone.has(sessionKeyOf(s.sessionId, s.parentIncarnation))),
    attempts: cp.attempts.filter(keep), activities: cp.activities.filter(keep), leases, lineage: cp.lineage.filter(keep),
    // A carrier row leaves with its lease (wave 5): one left behind would be a row with no lease, which `assertLeases` refuses.
    ...(carriers.length === 0 ? {} : { leaseCarriers: carriers }),
  };
}

/**
 * Makes SQLite say what the checkpoint and the journal say (ruling R20):
 *   1. project the checkpoint (the five non-event tables);
 *   2. replay the retained journal's evidence through `insertEvents`, in bounded chunks that YIELD THE EVENT LOOP, resuming from
 *      SQLite's `MAX(journalSequence)`; when SQLite's count disagrees with the journal's below that point, replay everything;
 *   3. a conflict is SQLite drift and SQLite loses: delete those sessions' events (by projecting the checkpoint without a session and
 *      then with it, ONE session at a time with the loop yielded between them) and replay their events from the journal, ALL of them
 *      in ONE pass. A conflict still outstanding after that, or
 *      rows SQLite holds that the journal does not, are cleared by deleting every session's events and replaying (the last resort):
 *      the repair never reports success with a conflict outstanding. The cost of deleting is the sessions' events (about 70 to 85 µs
 *      each), paid only on drift.
 * With `evidence` (recovery's per-sequence count) the repair knows BEFORE reading whether the journal has anything to tell SQLite: a
 * matching `(count, max)` and nothing past it skips the read entirely, and a count that disagrees, or a max the journal holds no evidence
 * at (D-5836, review 705 F1), goes straight to the one full pass instead of a counting pass followed by a full one. Without it, the
 * repair counts as it reads (two passes when the counts disagree, or when the counting pass meets no evidence record at SQLite's max).
 * The journal is read as a stream through `journal()`, a fresh async iterable per pass.
 */
export async function repairDelegationProjection(input: {
  projection: DelegationProjectionPort;
  checkpoint: DelegationCheckpointV1;
  journal: () => AsyncIterable<DelegationJournalRecordV1>;
  chunkSize?: number;
  /** Sessions already known to have drifted (an application met a conflicting row): healed whatever the counts say. */
  heal?: readonly { sessionId: string; incarnation: string }[];
  /** Recovery's count of the journal's evidence records, to skip or shorten the passes. */
  evidence?: DelegationEvidenceCounts;
  /** D-7021: the journal's first sequence (null: no journal). Rows below it that are not carried evidence are deleted first (step 0). */
  retainedFrom?: number | null;
  /** D-7021: the rows one step-0 delete statement takes (`DELEGATION_EVENTS_DELETE_CHUNK`). */
  deleteChunk?: number;
}): Promise<DelegationProjectionRepairReport> {
  const { projection, checkpoint } = input;
  const chunkSize = input.chunkSize ?? 500;
  // STEP 0 (D-7021): SQLite's rows below the journal's first retained sequence that are not carried evidence are what a compaction cut and did
  // not get to delete (it died between its journal rename and its delete, or the delete failed). They are deleted in the gaps between the
  // carried evidence, as the compaction would have; today's steps then run unchanged, and the wipe stays the last resort for a real conflict.
  let prunedBelow = 0;
  const retainedFrom = input.retainedFrom ?? null;
  if (retainedFrom !== null && input.evidence !== undefined
    && projection.countEventsAtOrBelow(retainedFrom - 1) !== input.evidence.countAtOrBelow(retainedFrom - 1)) {
    prunedBelow = await deleteEventsInGaps(projection, retainedFrom - 1, input.evidence.sequencesAtOrBelow(retainedFrom - 1), input.deleteChunk ?? DELEGATION_EVENTS_DELETE_CHUNK);
  }
  projection.project(checkpoint);
  const stats = projection.eventStats();
  const resume = stats.maxSequence ?? 0;
  const report: DelegationProjectionRepairReport = {
    resumedAfter: resume, inserted: 0, duplicate: 0, healedSessions: 0, fullReplay: false, wipedAll: false, journalPasses: 0, skipped: false, prunedBelow,
  };
  const conflicted = new Map<string, { sessionId: string; incarnation: string }>();
  for (const k of input.heal ?? []) conflicted.set(sessionKeyOf(k.sessionId, k.incarnation), k);

  /** One pass over the journal. `from`: rows at or below it are only counted. `only`: just these sessions' events. */
  const replay = async (from: number, only: ReadonlySet<string> | null): Promise<{ evidenceBelow: number; total: number; heldAt: boolean }> => {
    report.journalPasses++;
    let chunk: DelegationEventRow[] = [];
    let evidenceBelow = 0;
    let total = 0;
    let heldAt = false;
    const flush = async (): Promise<void> => {
      if (chunk.length === 0) return;
      const r = projection.insertEvents(chunk);
      report.inserted += r.inserted;
      report.duplicate += r.duplicate;
      for (const c of r.conflicts) conflicted.set(sessionKeyOf(c.sessionId, c.parentIncarnation), { sessionId: c.sessionId, incarnation: c.parentIncarnation });
      chunk = [];
      await yieldToEventLoop();
    };
    for await (const record of input.journal()) {
      if (record.entry.kind !== 'evidence-accepted') continue;
      const e = record.entry.event;
      if (only !== null && !only.has(sessionKeyOf(e.sessionId, e.parentIncarnation))) continue;
      total++;
      if (record.sequence <= from) { evidenceBelow++; if (only === null && record.sequence === from) heldAt = true; continue; }
      chunk.push(delegationEventRowOfRecord(record));
      if (chunk.length >= chunkSize) await flush();
    }
    await flush();
    return { evidenceBelow, total, heldAt };
  };

  let total: number;
  const known = input.evidence;
  if (known !== undefined) {
    total = known.total;
    const below = known.countAtOrBelow(resume);
    // sequences are integers that only increase, so equal counts up to `max - 1` and up to `max` mean no evidence AT `max` (D-5836, review 705 F1)
    const foreign = stats.maxSequence !== null && known.countAtOrBelow(stats.maxSequence - 1) === below;
    const behind = below !== stats.count || foreign;
    if (behind) report.fullReplay = true;
    if (behind || total > below) await replay(behind ? 0 : resume, null);
  } else {
    const first = await replay(resume, null);
    total = first.total;
    if (first.evidenceBelow !== stats.count || (stats.maxSequence !== null && !first.heldAt)) {     // the max is a sequence the journal holds no evidence at (D-5836)
      report.fullReplay = true;
      await replay(0, null);
    }
  }

  if (conflicted.size > 0) {
    const drifted = [...conflicted.values()];
    conflicted.clear();
    // Each drifted session leaves for a moment, which deletes its SQLite events on the loop (about 70 to 85 µs each): ONE session at
    // a time, the loop yielded between them, so no stall is longer than one session's events. The journal is then read ONCE for all.
    for (const k of drifted) {
      projection.project(checkpointWithoutSessions(checkpoint, [k]));
      projection.project(checkpoint);
      await yieldToEventLoop();
    }
    report.healedSessions += drifted.length;
    await replay(0, new Set(drifted.map((k) => sessionKeyOf(k.sessionId, k.incarnation))));
  }
  if (conflicted.size > 0 || projection.eventStats().count !== total) {
    report.wipedAll = true;
    conflicted.clear();
    projection.project(emptyDelegationCheckpoint());
    projection.project(checkpoint);
    await yieldToEventLoop();
    await replay(0, null);
    if (conflicted.size > 0) throw new Error('SQLite still conflicts with the journal after every session\'s events were deleted and replayed');
  }
  return report;
}
