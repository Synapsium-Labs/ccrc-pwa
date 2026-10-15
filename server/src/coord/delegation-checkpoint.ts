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
//     - `DelegationCheckpointBuilder`: the fold of journal records into checkpoint rows, the identity-candidate index, and the
//       pruning holds. It is the ONE place a journal record becomes state, used by the live path and by replay alike, so
//       replay cannot differ from the live path (W3-M18);
//     - `DelegationRecovery` / `recoverDelegation` / `recoverDelegationState`: the reconstruction phases (O2).
//   IMPURE SHELL (below the banner): reading the files, the atomic checkpoint replacement, the SERIALIZED DURABLE APPLIER
//   (O5's eight steps in order), the lease adapter that alone mints a lease UUID, and the SQLite projection and its repair.
//
// THE ENTRY POINT Task 9 calls: `DelegationDurability.applyAccepted(batch)`. Positive meta, intent and every other
// checkpoint-only change go through `applyPositiveAgentMeta` / `applyCheckpointChange`; a lease goes through `createLease`.
// Time and randomness are INJECTED (`now`, `randomUUID`); no pure code reads either.
import path from 'node:path';
import {
  DELEGATION_ATTEMPT_VERDICTS,
  DELEGATION_CLEANUP_POPULATIONS,
  DELEGATION_CLEANUP_STATES,
  DELEGATION_DISPOSITIONS,
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
  DELEGATION_JOURNAL_ENTRY_KINDS,
  DELEGATION_PRUNING_HOLD_REASONS,
  assertDelegationCheckpointIdentity,
  assertWave3Leases,
  canonicalDelegationJson,
  deriveDelegationLineageId,
  emptyDelegationCheckpoint,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  isLowerHex64,
  leaseSourceKindOfActivity,
  parseDelegationInstant,
  restoreOrAllocateActivityId,
  sortedProjectionRows,
  WAVE3_LEASE_SOURCE_KINDS,
  type DeepReadonly,
  type DelegationActivityRow,
  type DelegationAttemptRow,
  type DelegationBucketCursor,
  type DelegationCheckpointV1,
  type DelegationEventRow,
  type DelegationInsertEventsResult,
  type DelegationIntervalState,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
  type DelegationLeaseCreationRequest,
  type DelegationLeaseRow,
  type DelegationLineageRow,
  type DelegationObservationInterval,
  type DelegationPruningHold,
  type DelegationRecoveryState,
  type DelegationSessionRow,
} from './delegation-model.js';
import {
  DELEGATION_JOURNAL_ERROR_CODES,
  DELEGATION_JOURNAL_FILE,
  DelegationJournalChain,
  DelegationJournalError,
  DelegationJournalWriter,
  DelegationRetentionCollector,
  delegationEventRowOfRecord,
  delegationLeaseIdentityKey,
  findDelegationJsonDefect,
  planDelegationJournalAppend,
  planDelegationPruning,
  readDelegationJournalRecords,
  nodeDelegationFilePort,
  type DelegationAppendItem,
  type DelegationAppendPlan,
  type DelegationFilePort,
  type DelegationJournalCoverage,
  type DelegationFileHandle,
  type DelegationJournalPosition,
  type DelegationLeaseView,
  type DelegationPruningPlan,
} from './delegation-journal.js';

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

function refuse(code: DelegationCheckpointErrorCode, detail: string): never {
  throw new DelegationCheckpointError(code, detail);
}

// ── The canonical checkpoint codec and its closed shape ───────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMember = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** A closed reader over one object: exactly its keys, each read with a typed accessor that never casts. */
class Fields {
  private constructor(private readonly o: Record<string, unknown>, private readonly what: string) {}
  static of(v: unknown, what: string, keys: readonly string[]): Fields {
    if (!isRecord(v)) return refuse('bad-shape', `${what} is not an object`);
    for (const k of Object.keys(v)) if (!keys.includes(k)) refuse('bad-shape', `${what} has the unknown key ${JSON.stringify(k)}`);
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
const HOLD_REASONS = ['checkpoint-anchor', 'open-lease', 'open-lineage', 'identity-candidate'] as const satisfies readonly DelegationPruningHold['reason'][];

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

const readCursor = (v: unknown): DelegationBucketCursor => {
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

const readInterval = (v: unknown): DelegationObservationInterval => {
  const f = Fields.of(v, 'observationInterval', ['sessionId', 'parentIncarnation', 'utcHour', 'state', 'detail', 'recordedAt']);
  return {
    sessionId: f.str('sessionId'), parentIncarnation: f.str('parentIncarnation'), utcHour: f.str('utcHour'),
    state: f.member('state', INTERVAL_STATES), detail: f.strN('detail'), recordedAt: f.inst('recordedAt'),
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
  const f = Fields.of(v, 'checkpoint', CHECKPOINT_KEYS);
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
    if (n.runId !== null) unprojectable(`lineage ${n.lineageId} is run-owned, which has no wave-3 writer (and a run is not this checkpoint's to prove)`);
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

/**
 * The full event-less-lease proof, both ways. Every lease in the checkpoint names, by `creatingJournalSequence`, a RETAINED
 * `lease-created` record whose fields equal the lease's identity columns (and whose lineage ID is the one derived); and every
 * retained `lease-created` record the checkpoint has applied has its lease row. A lease without its entry has no authority:
 * "the journal alone creates leases".
 */
export function assertLeaseJournalProof(cp: DelegationCheckpointV1, facts: ReadonlyMap<string, DelegationLeaseEntryFact>): void {
  for (const lease of cp.leases) {
    const fact = facts.get(lease.leaseId);
    if (fact === undefined) refuse('lease-proof', `lease ${lease.leaseId} has no retained lease-created journal entry`);
    const e = fact.entry;
    const same = fact.sequence === lease.creatingJournalSequence && fact.sequence === lease.currentJournalSequence
      && e.generation === lease.generation && e.activityId === lease.activityId && e.parentId === lease.parentId
      && e.parentIncarnation === lease.parentIncarnation && e.project === lease.project && e.adminRecord === lease.adminRecord
      && e.canonicalPath === lease.canonicalPath && e.creationBase === lease.creationBase && e.sourceKind === lease.sourceKind
      && e.firstObservedAt === lease.firstObservedAt && e.lineageId === deriveDelegationLineageId(lease);
    if (!same) refuse('lease-proof', `lease ${lease.leaseId} does not equal its lease-created entry at sequence ${fact.sequence}`);
  }
  const have = new Set(cp.leases.map((l) => l.leaseId));
  for (const [leaseId, fact] of facts) {
    if (fact.sequence <= cp.appliedJournalSequence && !have.has(leaseId)) {
      refuse('lease-proof', `the lease-created entry at sequence ${fact.sequence} has no lease row in the checkpoint`);
    }
  }
}

/**
 * Everything a checkpoint must satisfy, in one place: the anchor, the wave-3 lease guard, the identity invariants (activity IDs,
 * the natural-key map, the intent map, each lease's opening lineage), projectability, and (when the journal's lease entries
 * are known) the journal proof. Runs at checkpoint BUILD and at RECOVERY; a violation at recovery keeps the phase
 * `reconstructing` and pruning disabled.
 */
export function validateDelegationCheckpoint(cp: DelegationCheckpointV1, leaseFacts: ReadonlyMap<string, DelegationLeaseEntryFact> | null): void {
  if (cp.v !== 1) refuse('bad-version', 'not a version-1 checkpoint');
  if ((cp.appliedJournalSequence === 0) !== (cp.appliedJournalId === null) || (cp.appliedJournalId === null) !== (cp.appliedJournalDigest === null)) {
    refuse('bad-anchor', 'the applied position, journalId and digest are all zero/null or all set');
  }
  assertWave3Leases(cp);
  assertDelegationCheckpointIdentity(cp);
  assertDelegationCheckpointProjectable(cp);
  if (leaseFacts !== null) assertLeaseJournalProof(cp, leaseFacts);
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
   * run (ruling R44: the run's identity is checkpoint data from then on, so it never holds the journal), or a Bash call that carries a
   * worktree listing. A bare `agent_id` is not one.
   */
  join: boolean;
  /** The event ends it: a SubagentStop naming an agent, a launch response that reports `completed`, or a Bash PostToolUse. */
  ends: boolean;
}

/**
 * The upstream IDs an evidence event names. For agents, the common `agentId` field names the emitter (a tool event inside a subagent,
 * a SubagentStart, a SubagentStop) and `launch.agentId` on an Agent/Task PostToolUse names the agent that call launched; only
 * SubagentStart and a launch response QUALIFY, a bare occurrence is evidence that attaches once a join is known, and an unpaired stop
 * opens nothing. A Workflow PostToolUse launch response names its RUN and IS that run's join (the worker index is the meta's, so it
 * opens the run, never a worker). A Bash PreToolUse or
 * PostToolUse names its tool call, and is a join only when it carries a `listing` (the hook writes one only for a command that
 * mentions a worktree). Nothing else names anything: a ToolSearch, a parent Stop and a SessionEnd open no activity, whatever order
 * they arrive in.
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
  if (event.eventKind === 'PostToolUse' && event.toolName === 'Workflow') {
    const launch = event.launch;
    if (typeof launch === 'object' && launch !== null) note('workflow', launch.runId, true, launch.status === 'completed');
  }
  if ((event.eventKind === 'PreToolUse' || event.eventKind === 'PostToolUse') && event.toolName === 'Bash') {
    note('bash-worktree', event.toolUseId, Array.isArray(event.listing), event.eventKind === 'PostToolUse');
  }
  return [...found.values()];
}

/** An upstream thing no qualifying join has yet opened (a Workflow RUN never is opened itself; its workers are): the earliest retained record naming it is its identity record (spec §5.2). */
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
}

const maxInstant = (a: string, b: string): string => (a >= b ? a : b);
const minInstant = (a: string, b: string): string => (a <= b ? a : b);

// ── The builder: the one fold from journal records to checkpoint rows ───────────────────────────────────────────────

const sessionKeyOf = (id: string, inc: string): string => JSON.stringify([id, inc]);
const cursorKeyOf = (c: { sessionId: string; parentIncarnation: string; bucket: string }): string => JSON.stringify([c.sessionId, c.parentIncarnation, c.bucket]);
const intervalKeyOf = (c: { sessionId: string; parentIncarnation: string; utcHour: string }): string => JSON.stringify([c.sessionId, c.parentIncarnation, c.utcHour]);

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedBy = <T>(rows: Iterable<T>, key: (r: T) => string): T[] => [...rows].sort((a, b) => byCodeUnits(key(a), key(b)));
const sortedMap = (m: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).sort(([a], [b]) => byCodeUnits(a, b)));

/**
 * Merges one hour's observation interval. An hour with a gap stays a gap: `unmeasured` is sticky, so a later measured read
 * of the same hour cannot erase a measured loss. Otherwise the later `recordedAt` wins, and an equal one keeps the stored row.
 * Deterministic and order-independent for the sticky rule; Task 13 owns retention.
 */
export function mergeDelegationObservationInterval(prior: DelegationObservationInterval | undefined, next: DelegationObservationInterval): DelegationObservationInterval {
  if (prior === undefined) return next;
  if (prior.state === 'unmeasured' && next.state === 'measured') return prior;
  if (prior.state === 'measured' && next.state === 'unmeasured') return next;
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

/**
 * The working form of a checkpoint. Rows are held in maps and treated as immutable values (an update REPLACES a row), so
 * `clone()` is shallow and cheap. The journal's records go in through `foldRecord` (a record past the applied position) or
 * `observeRecord` (a record the checkpoint already covers, read only for the identity-candidate index and the lease proof),
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
  private leaseByIdentity = new Map<string, string>();
  private leaseByPath = new Map<string, string>();
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
    b.appliedSequence = this.appliedSequence; b.appliedJournalId = this.appliedJournalId; b.appliedDigest = this.appliedDigest;
    b.revisionNo = this.revisionNo;
    return b;
  }

  /** The leases as the journal adapter's deduplication sees them. */
  leaseView(): DelegationLeaseView {
    return { byIdentity: (k) => this.leaseByIdentity.get(k), byPath: (p) => this.leaseByPath.get(p) };
  }

  activityOf(activityId: string): DelegationActivityRow | undefined { return this.activities.get(activityId); }
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
    if (entry.kind === 'evidence-accepted') this.foldEvidence(record, entry.event, true);
    else this.foldLease(record, entry);
    this.appliedSequence = record.sequence;
    this.appliedJournalId = record.journalId;
    this.appliedDigest = record.digest;
  }

  /** Reads a record the checkpoint ALREADY covers: only for the identity-candidate index and the lease proof. It changes no
   *  row. An unmapped agent with a qualifying join in covered territory is a checkpoint that lost an activity. */
  observeRecord(record: DelegationJournalRecordV1): void {
    const entry = record.entry;
    if (entry.kind === 'evidence-accepted') this.foldEvidence(record, entry.event, false);
    else this.leaseFacts.set(entry.leaseId, { sequence: record.sequence, journalId: record.journalId, entry });
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
    if (replay) this.touchSession(e);
    for (const na of namedAgentsOf(e)) {
      const key: DelegationActivityNaturalKey = { parentId: e.sessionId, parentIncarnation: e.parentIncarnation, sourceKind: na.sourceKind, upstreamId: na.upstreamId };
      const encoded = encodeDelegationNaturalKey(key);
      // THE MAPPING IS READ FIRST (O4). A key the checkpoint holds keeps its ID whatever the journal still retains.
      const mapped = Object.hasOwn(this.mapping, encoded) ? this.mapping[encoded] : undefined;
      if (mapped !== undefined) {
        if (replay) this.touchActivity(mapped, e, na);
        continue;
      }
      // A Bash call with no listing mentions no worktree: it is not evidence of anything and must not hold the journal (every Bash call
      // has a tool_use_id). It still ENDS the activity its listing-carrying twin opened, which the mapping branch above handles.
      // DEVIATION D-4649 (spec §5.2 says a tool_use_id's identity is "the first event naming it"): a PreToolUse whose listing the hook
      // dropped (`truncated`) is skipped here, so when its PostToolUse carries the listing the POST record is the identity.
      if (na.sourceKind === 'bash-worktree' && !na.join) continue;
      const prior = this.candidates.get(encoded);
      const candidate: DelegationActivityCandidate = prior === undefined
        ? { key, journalId: record.journalId, sequence: record.sequence, observedAt: e.observedAt, lastObservedAt: e.observedAt, endedAt: na.ends ? e.observedAt : null }
        : { ...prior, lastObservedAt: maxInstant(prior.lastObservedAt, e.observedAt), endedAt: prior.endedAt ?? (na.ends ? e.observedAt : null) };
      if (!na.join) { this.candidates.set(encoded, candidate); continue; }
      if (!replay) {
        refuse('fold-refused', `${na.sourceKind} ${na.upstreamId} of (${e.sessionId}, ${e.parentIncarnation}) has a qualifying join at sequence ${record.sequence}, inside the applied journal, but the checkpoint holds no activity for it`);
      }
      this.openFromCandidate(candidate, encoded);
    }
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

  private openFromCandidate(c: DelegationActivityCandidate, encoded: string): string {
    // The ID is derived from the IDENTITY RECORD's accepted journalId, through the model's mapping-first function.
    const allocated = restoreOrAllocateActivityId(c.key, c.journalId, { ...emptyDelegationCheckpoint(), activityIdsByNaturalKey: this.mapping });
    this.mapping = { ...allocated.checkpoint.activityIdsByNaturalKey };
    const ended = c.endedAt !== null;
    this.activities.set(allocated.activityId, {
      activityId: allocated.activityId, parentId: c.key.parentId, parentIncarnation: c.key.parentIncarnation, sourceKind: c.key.sourceKind,
      upstreamId: c.key.upstreamId, identityJournalId: c.journalId, displayName: null, executionState: ended ? 'ended' : 'active',
      openedAt: c.observedAt, endedAt: ended && c.endedAt !== null ? maxInstant(c.endedAt, c.observedAt) : null, lastEventAt: c.lastObservedAt,
    });
    this.candidates.delete(encoded);
    return allocated.activityId;
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
    if (typeof workerIndex !== 'number' || !Number.isSafeInteger(workerIndex) || workerIndex < 0) {
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
        { key: worker, journalId: run.identityJournalId, sequence: 0, observedAt: run.openedAt, lastObservedAt: run.lastEventAt, endedAt: run.endedAt }, encoded),
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

  // ── checkpoint-only state ──────────────────────────────────────────────────────────────────────────────────────────

  /** Sets a bucket's cursor row. `replaced` is MONOTONIC (R36): a result computed from a stale state can never write `false` over a
   *  durable `true`, so a replaced bucket cannot be un-replaced by an overlapping tick. Where the cursor itself moves is Task 13's (M6). */
  setCursor(cursor: DelegationBucketCursor): void {
    const key = cursorKeyOf(cursor);
    const wasReplaced = this.cursors.get(key)?.replaced === true;
    this.cursors.set(key, wasReplaced && !cursor.replaced ? { ...cursor, replaced: true } : cursor);
  }
  mergeInterval(interval: DelegationObservationInterval): void {
    const k = intervalKeyOf(interval);
    this.intervals.set(k, mergeDelegationObservationInterval(this.intervals.get(k), interval));
  }

  /** Replaces the ROWS from a checkpoint a checkpoint-only change produced, keeping the applied position, the identity candidates
   *  and the lease facts (a change cannot move any of them). A candidate whose key the change mapped is no longer one. */
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
   *   - `open-lease`: each unreleased lease's creating record and its correlation evidence;
   *   - `open-lineage`: each open lineage edge's references (its lease's creating record and evidence, or its activity's identity record);
   *   - `identity-candidate`: the earliest retained record naming each AGENT no qualifying join has opened (a bare occurrence or an
   *     unpaired stop). POSITION IS NOT COVERAGE (W3-M17): such a record stays held although the checkpoint has applied a later
   *     sequence, until a checkpoint holds the ID. A Workflow run is never a candidate: its launch response is its join (R44).
   * An activity that IS mapped needs no hold: its ID survives pruning in the checkpoint (O4).
   */
  computeHolds(): DelegationPruningHold[] {
    const holds = new Map<string, DelegationPruningHold>();
    const add = (h: DelegationPruningHold): void => { holds.set(JSON.stringify([h.reason, h.journalId, h.ownerId]), h); };
    if (this.appliedJournalId !== null) add({ journalId: this.appliedJournalId, reason: 'checkpoint-anchor', ownerId: 'checkpoint' });
    const leaseEvidence = (leaseId: string): string[] => {
      const f = this.leaseFacts.get(leaseId);
      return f === undefined ? [] : [f.journalId, ...f.entry.correlationJournalIds];
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
    };
    validateDelegationCheckpoint(cp, this.leaseFacts);
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
  'identity-evidence',      // ALL retained evidence for agents the checkpoint does not hold, including records before the applied position
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
 *  checkpoint or model refusal), and `DELEGATION_RESTORE_IN_PROGRESS` is the restore marker's. */
export type DelegationOwnFailureCode = 'not-recovered' | 'recovering' | 'no-facts' | 'application-failed';

/** How many evidence records the retained journal holds, in all and up to a sequence. Recovery counts them while it reads, so the
 *  projection repair can tell from SQLite's `(COUNT, MAX(journalSequence))` alone whether it has anything to read the journal for. */
export interface DelegationEvidenceCounts {
  readonly total: number;
  countAtOrBelow(sequence: number): number;
}

/** The evidence records' sequences, in order (8 bytes each). A lease-created record is not evidence and is not counted. */
export class DelegationEvidenceIndex implements DelegationEvidenceCounts {
  private readonly sequences: number[] = [];
  get total(): number { return this.sequences.length; }
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
  journal: DelegationJournalCoverage | null;
  facts: DelegationRecoveryFacts | null;
}

/**
 * Incremental recovery: construct with the checkpoint's bytes (or null for none), `accept` the retained journal's records in
 * file order, then `finish`. Holds only the indexes (event IDs, identity candidates, lease facts), never the records, so a journal
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
      this.failureNow ??= { phase: this.phase, code: 'code' in err && typeof err.code === 'string' ? err.code : 'invalid', detail: err.message };
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
      replayed: this.replayed, scanned: this.scanned, journal, facts,
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// IMPURE SHELL: from here down the module reads and writes files (through the injected port), calls the injected clock and
// randomness, and drives SQLite through the synchronous store. Nothing above does any of it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
/** Reads both files and recovers (an active restore marker refuses first). A journal read that fails (a torn tail, an unreadable chunk) is a recovery failure. */
export async function recoverDelegationFromFiles(port: DelegationFilePort, dir: string): Promise<DelegationRecoveryReport> {
  // An active restore marker comes FIRST: the files below may be half replaced, so none of them is read (a refusal, not a repair).
  if (await port.readFile(path.join(dir, COORDINATION_RESTORE_MARKER_FILE)) !== null) {
    const refused = new DelegationRecovery(null);
    refused.fail('checkpoint-decode', DELEGATION_RESTORE_IN_PROGRESS, 'a coordination restore is in progress or did not finish; run `ccrc coordination-snapshot recover`');
    return refused.finish();
  }
  const checkpointBytes = await port.readFile(path.join(dir, DELEGATION_CHECKPOINT_FILE));
  const recovery = new DelegationRecovery(checkpointBytes);
  try {
    for await (const record of readDelegationJournalRecords(port, path.join(dir, DELEGATION_JOURNAL_FILE))) recovery.accept(record);
  } catch (err) {
    if (err instanceof DelegationJournalError) recovery.fail('journal-validate', err.code, err.message);
    else throw err;
  }
  return recovery.finish();
}

// ── The SQLite projection port and its repair (ruling R20) ───────────────────────────────────────────────────────────

/**
 * What the applier needs of `coord.db`, as a port. Every call is the synchronous store; nothing is awaited inside one.
 *
 * The PRODUCTION port is three `CoordStore` methods, one per member (this module may not reach around the store for its handle:
 * the coord ring, pinned by `single-definition.test.ts`, so the store is the only thing that holds it):
 *   - `project(cp)`        is `store.projectDelegationCheckpoint(cp)` (the five non-event tables, one transaction);
 *   - `insertEvents(rows)` is `store.insertDelegationEvents(rows)` (ONE transaction; a conflict is reported, never thrown, and
 *                           does not stop the rows after it);
 *   - `eventStats()`       is `store.delegationEventStats()` (`COUNT(*)` and `MAX(journalSequence)` of `delegation_events`).
 * The wiring is three one-line adapters, which `delegation-recovery.test.ts` builds and runs against the real store.
 */
export interface DelegationProjectionPort {
  project(checkpoint: DelegationCheckpointV1): void;
  /** ONE transaction for the whole list. A conflict is reported, not thrown, and does not abort the others. */
  insertEvents(rows: readonly DelegationEventRow[]): DelegationInsertEventsResult;
  eventStats(): { count: number; maxSequence: number | null };
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
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

/** The checkpoint without some sessions and everything that names them: projecting it deletes those sessions' events (the
 *  projection deletes the events of a LEAVING session), and projecting the whole checkpoint again re-adds the sessions. */
function checkpointWithoutSessions(cp: DelegationCheckpointV1, drifted: readonly { sessionId: string; incarnation: string }[]): DelegationCheckpointV1 {
  const gone = new Set(drifted.map((k) => sessionKeyOf(k.sessionId, k.incarnation)));
  const keep = (r: { parentId: string; parentIncarnation: string }): boolean => !gone.has(sessionKeyOf(r.parentId, r.parentIncarnation));
  return {
    ...cp,
    sessions: cp.sessions.filter((s) => !gone.has(sessionKeyOf(s.sessionId, s.parentIncarnation))),
    attempts: cp.attempts.filter(keep), activities: cp.activities.filter(keep), leases: cp.leases.filter(keep), lineage: cp.lineage.filter(keep),
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
 * matching `(count, max)` and nothing past it skips the read entirely, and a count that disagrees goes straight to the one full pass
 * instead of a counting pass followed by a full one. Without it, the repair counts as it reads (two passes when counts disagree).
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
}): Promise<DelegationProjectionRepairReport> {
  const { projection, checkpoint } = input;
  const chunkSize = input.chunkSize ?? 500;
  projection.project(checkpoint);
  const stats = projection.eventStats();
  const resume = stats.maxSequence ?? 0;
  const report: DelegationProjectionRepairReport = {
    resumedAfter: resume, inserted: 0, duplicate: 0, healedSessions: 0, fullReplay: false, wipedAll: false, journalPasses: 0,
  };
  const conflicted = new Map<string, { sessionId: string; incarnation: string }>();
  for (const k of input.heal ?? []) conflicted.set(sessionKeyOf(k.sessionId, k.incarnation), k);

  /** One pass over the journal. `from`: rows at or below it are only counted. `only`: just these sessions' events. */
  const replay = async (from: number, only: ReadonlySet<string> | null): Promise<{ evidenceBelow: number; total: number }> => {
    report.journalPasses++;
    let chunk: DelegationEventRow[] = [];
    let evidenceBelow = 0;
    let total = 0;
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
      if (record.sequence <= from) { evidenceBelow++; continue; }
      chunk.push(delegationEventRowOfRecord(record));
      if (chunk.length >= chunkSize) await flush();
    }
    await flush();
    return { evidenceBelow, total };
  };

  let total: number;
  const known = input.evidence;
  if (known !== undefined) {
    total = known.total;
    const below = known.countAtOrBelow(resume);
    const behind = below !== stats.count;
    if (behind) report.fullReplay = true;
    if (behind || total > below) await replay(behind ? 0 : resume, null);
  } else {
    const first = await replay(resume, null);
    total = first.total;
    if (first.evidenceBelow !== stats.count) {
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

// ── The serialized durable applier ────────────────────────────────────────────────────────────────────────────────────

/** O5's edges, in order. `onEdge` is a fault-injection seam: production passes none. */
export const DELEGATION_DURABILITY_EDGES = [
  'journal-write', 'journal-fsync', 'build', 'checkpoint-write', 'checkpoint-fsync', 'checkpoint-rename', 'directory-fsync', 'project',
] as const;
export type DelegationDurabilityEdge = (typeof DELEGATION_DURABILITY_EDGES)[number];

export interface DelegationDurabilityDeps {
  /** The coordination directory (`~/.ccrc`; a fixture directory in a test). */
  dir: string;
  /** SQLite, or null when only the authoritative files are wanted. */
  projection: DelegationProjectionPort | null;
  /** INJECTED clock: epoch milliseconds. Only `acceptedAt` of a record without one is read from it. */
  now: () => number;
  /** INJECTED randomness: called ONLY by `createLease`, exactly once, after deduplication. */
  randomUUID: () => string;
  port?: DelegationFilePort;
  onEdge?: (edge: DelegationDurabilityEdge, when: 'before' | 'after') => void | Promise<void>;
  /** Server log line sink (`console.warn('ccrc-server: …')` in production). */
  warn?: (message: string) => void;
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

/** Why `createLease` declined to create a lease. */
export type DelegationLeaseRefusalReason = 'canonical-path-held' | 'unmeasured-request' | 'unmeasured-activity' | 'source-kind-mismatch';

export type DelegationLeaseOutcome =
  | { kind: 'created'; leaseId: string; lineageId: string; sequence: number; applied: DelegationApplyOutcome }
  | { kind: 'duplicate'; leaseId: string }
  | { kind: 'refused'; reason: DelegationLeaseRefusalReason; detail: string; heldBy?: string };

export type DelegationMetaOutcome =
  | { kind: 'opened'; activityId: string; applied: DelegationApplyOutcome }
  | { kind: 'already-open'; activityId: string }
  | { kind: 'waiting-for-evidence' };

/** A change only the checkpoint may make: intent, attempts, positive meta, interval upkeep. It may not move the applied position,
 *  remove a session, or add or alter a lease or a lease's lineage (only the journal creates leases). */
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
  private readonly checkpointPath: string;
  private readonly tempPath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private writer: DelegationJournalWriter;
  private builder = DelegationCheckpointBuilder.from(emptyDelegationCheckpoint());
  private eventIds = new Set<string>();
  private evidence = new DelegationEvidenceIndex();
  private head: DelegationJournalPosition | null = null;
  private current: DelegationRecoveryState = { checkpoint: emptyDelegationCheckpoint(), phase: 'reconstructing' };
  private failureNow: DelegationDurabilityFailure | null = { phase: 'checkpoint-decode', code: 'not-recovered' satisfies DelegationOwnFailureCode, detail: 'recovery has not run' };
  private projectionStale = false;
  /** Sessions whose SQLite events an application found in conflict with the journal's: healed by the next repair. */
  private drifted = new Map<string, { sessionId: string; incarnation: string }>();

  private constructor(private readonly deps: DelegationDurabilityDeps) {
    this.port = deps.port ?? nodeDelegationFilePort;
    this.journalPath = path.join(deps.dir, DELEGATION_JOURNAL_FILE);
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
  failure(): DelegationDurabilityFailure | null { return this.failureNow; }
  /** True only while the state is `ready` and nothing has failed (O2): never during reconstruction, never after a failure. */
  pruningEnabled(): boolean { return this.current.phase === 'ready' && this.failureNow === null; }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
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
      await this.writer.close().catch(() => undefined);
      this.writer = new DelegationJournalWriter(this.port, this.journalPath, this.deps.dir);
      const report = await recoverDelegationFromFiles(this.port, this.deps.dir);
      if (report.failure !== null || report.facts === null) {
        this.current = report.state;
        this.failureNow = report.failure ?? { phase: 'final-validate', code: 'no-facts' satisfies DelegationOwnFailureCode, detail: 'recovery produced no state' };
        this.deps.warn?.(`ccrc-server: delegation recovery failed at ${this.failureNow.phase}: ${this.failureNow.code}`);
        return report;
      }
      this.builder = report.facts.builder;
      this.eventIds = report.facts.eventIds;
      this.head = report.facts.head;
      this.current = report.state;
      this.evidence = report.facts.evidence;
      // Recovery is the one moment the in-memory state may be ahead of the file: persist it through the same replacement. A
      // checkpoint of revision 0 with a journal behind it was never persisted (every persisted checkpoint has revision >= 1).
      // The applier stays NOT ready (`failureNow` still set, so pruning stays off) until the save has succeeded.
      const needsSave = report.replayed > 0 || (report.state.checkpoint.revision === 0 && this.head !== null);
      if (needsSave) {
        try {
          await this.commitLocked({ items: [], mutate: null, force: true, project: false });
        } catch (err) {
          // A failure inside steps 1 to 7 has already been marked by `commitLocked`; one BEFORE step 1 (the build, the encoding) has
          // not, and the replayed suffix is then unsaved: mark it here, so a recovery that could not save is never reported ready.
          if (this.failureNow === null || this.failureNow.code === ('recovering' satisfies DelegationOwnFailureCode)) this.fail(err);
          return { ...report, state: this.current, failure: this.failureNow };
        }
      }
      this.failureNow = null;
      await this.repairLocked();
      return { ...report, state: this.current };
    });
  }

  /** Repairs `coord.db` from the checkpoint and the journal now (a lost or rolled-back file, or after a failed projection). */
  repairProjection(): Promise<DelegationProjectionRepairReport | null> {
    return this.enqueue(async () => { this.requireReady(); return this.repairLocked(); });
  }

  private async repairLocked(): Promise<DelegationProjectionRepairReport | null> {
    const projection = this.deps.projection;
    if (projection === null) return null;
    try {
      const report = await repairDelegationProjection({
        projection, checkpoint: this.current.checkpoint, journal: () => readDelegationJournalRecords(this.port, this.journalPath), heal: [...this.drifted.values()], evidence: this.evidence,
      });
      this.projectionStale = false;
      this.drifted.clear();
      return report;
    } catch (err) {
      this.projectionStale = true;
      this.deps.warn?.(`ccrc-server: delegation projection repair failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Visits every record the retained journal holds, in order, READ-ONLY, through the applier's own port and its own journal path, on
   * the applier's queue (so no application is half-written while it reads). It is how the watcher lane (Task 13) learns the evidence
   * correlation reads without NAMING the journal file: this module and the journal module stay the only sources that do (a guard in
   * `delegation-recovery.test.ts` pins that). A decode or IO failure rejects and changes nothing; the applier stays as it was.
   */
  visitRetainedRecords(visit: (record: DelegationJournalRecordV1) => void): Promise<void> {
    return this.enqueue(async () => {
      for await (const record of readDelegationJournalRecords(this.port, this.journalPath)) visit(record);
    });
  }

  /** The pruning plan right now. Streams the journal once for the held records' positions; deletes and rewrites nothing. */
  async planPruning(nowMs: number, retentionMs: number): Promise<DelegationPruningPlan> {
    return this.enqueue(async () => {
      const collector = new DelegationRetentionCollector(new Set(this.current.checkpoint.pruningHolds.map((h) => h.journalId)), nowMs - retentionMs);
      if (this.pruningEnabled()) for await (const r of readDelegationJournalRecords(this.port, this.journalPath)) collector.add(r);
      return planDelegationPruning({ state: this.current, view: collector.view() });
    });
  }

  // ── the entry points ───────────────────────────────────────────────────────────────────────────────────────────────

  /** THE ENTRY POINT Task 9 calls (through its `DelegationBucketDurability`). Journals, checkpoints and projects one bucket's
   *  accepted evidence, its cursor and its interval, as ONE durable application. Nothing it returns existed before the
   *  checkpoint replacement completed. */
  applyAccepted(batch: DelegationDurableBatch): Promise<DelegationApplyOutcome> {
    return this.enqueue(async () => {
      this.requireReady();
      // The checkpoint-owned members are checked with the checkpoint's own readers BEFORE anything is written: a cursor or an interval
      // recovery could not read would otherwise be made durable by an application that is otherwise perfectly valid.
      if (batch.cursor !== null) readCursor(batch.cursor);
      if (batch.interval !== null) readInterval(batch.interval);
      const at = nowInstant(this.deps.now());
      const items: DelegationAppendItem[] = batch.accepted.map((a) => ({ entry: { kind: 'evidence-accepted', event: a.event }, acceptedAt: a.acceptedAt ?? at }));
      return this.commitLocked({
        items,
        mutate: (b) => {
          if (batch.cursor !== null) b.setCursor(batch.cursor);
          if (batch.interval !== null) b.mergeInterval(batch.interval);
        },
        force: false,
      });
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
          // O4, the immutable mapping: only the fold and the meta door open an activity, and nothing drops or re-derives one. A change
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
          const leaseState = (cp: DelegationCheckpointV1): string => canonicalDelegationJson([cp.leases, cp.lineage.filter((n) => n.leaseId !== null)]);
          if (leaseState(after) !== leaseState(before)) {
            refuse('change-refused', 'a checkpoint-only change cannot add or alter a lease or a lease\'s lineage: the journal alone creates leases');
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
  }): Promise<DelegationApplyOutcome> {
    const plan = planDelegationJournalAppend({ head: this.head, eventIds: this.eventIds, leases: this.builder.leaseView(), items: args.items });
    // What `evidence` MEANS: the count of evidence records the retained JOURNAL holds, so the repair can set SQLite's (count, max)
    // against it. It therefore changes when the journal does, with `eventIds` and `head`, after the durable point, and never before
    // (a count of records not yet written would be a count of nothing). Its one invariant (strictly increasing) is proved HERE, before
    // step 1, where a refusal costs nothing, so that adopting it afterwards cannot throw out of an application that is already durable.
    const evidenceSequences = plan.records.filter((r) => r.entry.kind === 'evidence-accepted').map((r) => r.sequence);
    this.evidence.assertExtendedBy(evidenceSequences);
    const next = this.builder.clone();
    for (const record of plan.records) next.foldRecord(record);
    args.mutate?.(next);
    const prior = this.current.checkpoint;
    const checkpoint = next.build(prior.revision + 1);
    const sameAsPrior = canonicalDelegationJson({ ...checkpoint, revision: 0 }) === canonicalDelegationJson({ ...prior, revision: 0 });
    if (plan.records.length === 0 && sameAsPrior && !args.force) {
      return { state: this.current, appended: [], skipped: plan.skipped, openedActivities: [], durable: false, projection: { status: 'unprojected' } };
    }
    const bytes = encodeDelegationCheckpoint(checkpoint);
    if (args.verifyDecodable === true) decodeDelegationCheckpoint(bytes);
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
    for (const r of plan.records) if (r.entry.kind === 'evidence-accepted') this.eventIds.add(r.entry.event.eventId);
    this.evidence.extend(evidenceSequences);
    const rows = plan.records.filter((r) => r.entry.kind === 'evidence-accepted').map(delegationEventRowOfRecord);
    const projection: DelegationApplyOutcome['projection'] = args.project === false ? { status: 'unprojected' } : await this.projectLocked(checkpoint, rows);
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

  /** O5 step 8. Never throws: SQLite is repairable output, so a failure here marks it stale and the next application repairs it. */
  private async projectLocked(checkpoint: DelegationCheckpointV1, rows: readonly DelegationEventRow[]): Promise<DelegationApplyOutcome['projection']> {
    const projection = this.deps.projection;
    if (projection === null) return { status: 'unprojected' };
    try {
      await this.edge('project', async () => {
        if (this.projectionStale) {
          await this.repairLocked();
          if (this.projectionStale) throw new Error('the projection repair did not complete');
          return;
        }
        projection.project(checkpoint);
        const r = projection.insertEvents(rows);
        if (r.conflicts.length > 0) {
          for (const c of r.conflicts) this.drifted.set(JSON.stringify([c.sessionId, c.parentIncarnation]), { sessionId: c.sessionId, incarnation: c.parentIncarnation });
          this.projectionStale = true;
          throw new Error(`${r.conflicts.length} event(s) conflict with SQLite's rows`);
        }
      });
      return { status: 'projected' };
    } catch (err) {
      this.projectionStale = true;
      const error = err instanceof Error ? err.message : String(err);
      this.deps.warn?.(`ccrc-server: delegation projection stale: ${error}`);
      return { status: 'failed', error };
    }
  }

  async close(): Promise<void> {
    await this.enqueue(async () => { await this.writer.close(); });
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
  'not-recovered': true, recovering: true, 'no-facts': true, 'application-failed': true,
};

/** Why `createLease` declined, as a TOTAL table over `DelegationLeaseRefusalReason`. */
const DELEGATION_LEASE_REFUSAL_REASONS: Readonly<Record<DelegationLeaseRefusalReason, true>> = {
  'canonical-path-held': true, 'unmeasured-request': true, 'unmeasured-activity': true, 'source-kind-mismatch': true,
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
    || v === DELEGATION_RESTORE_IN_PROGRESS || listed(DELEGATION_DURABILITY_EDGES)
    || listed(DELEGATION_ACTIVITY_SOURCE_KINDS) || listed(DELEGATION_CLEANUP_STATES) || listed(DELEGATION_CLEANUP_POPULATIONS);
}
