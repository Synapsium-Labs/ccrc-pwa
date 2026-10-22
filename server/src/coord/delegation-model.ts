// Delegation broker wave 3, Task 7: the PURE model behind the report-only coordination projection.
//
// This file is L1: no fs, no fastify, no `node:sqlite`, no `CoordStore`. `node:crypto` is allowed because hashing is a
// computation. It holds what Task 8's journal and checkpoint and Task 7's `CoordStore` methods share:
//   - the non-shared journal, checkpoint and row types (the closed lists they use live in `shared/api.ts` and are only
//     IMPORTED here; the types below name them and never re-spell them);
//   - `canonicalDelegationJson`, the one JSON encoder every journal preimage goes through (RFC 8785 over a closed domain);
//   - the activity natural key, the activity ID derived from it, and `allocateDelegationActivityIdInto` with its pure form
//     `restoreOrAllocateActivityId` (O1, O4, D-5833);
//   - `assertWave3Lease`, the one statement of what wave 3 may write to `delegation_leases`;
//   - the codecs between a checkpoint's row shapes and the six tables' columns, with typed readers that never cast text.
//
// THE PROJECTION IS REPAIRABLE OUTPUT. The journal and the checkpoint are authority; nothing here reads SQLite back as one.
// `projectionViewOfDelegationCheckpoint` is how a drift check says what a checkpoint SHOULD look like once projected.
import { createHash } from 'node:crypto';
import {
  DELEGATION_ACTIVITY_SOURCE_KINDS,
  DELEGATION_ATTEMPT_VERDICTS,
  DELEGATION_CLEANUP_POPULATIONS,
  DELEGATION_CLEANUP_STATES,
  DELEGATION_DISPOSITIONS,
  DELEGATION_EVENT_KINDS,
  DELEGATION_EXECUTION_STATES,
  DELEGATION_INTENT_SOURCES,
  DELEGATION_LEASE_SOURCE_KINDS,
  DELEGATION_PARENTAGE_STATES,
  DELEGATION_WORKSPACE_STATES,
  type DelegationActivityNaturalKey,
  type DelegationActivitySourceKind,
  type DelegationAttemptVerdict,
  type DelegationCleanupPopulation,
  type DelegationCleanupState,
  type DelegationDisposition,
  type DelegationEventEnvelopeV1,
  type DelegationEventKind,
  type DelegationExecutionState,
  type DelegationHealthInput,
  type DelegationIntentSource,
  type DelegationObservationHealth,
  type DelegationLeaseSourceKind,
  type DelegationParentageState,
  type DelegationWorkspaceState,
} from '../../../shared/api.js';
import type { ReadFailure } from '../../../shared/agent-protocol.js';

// ── Durable journal and checkpoint types (the plan's vocabulary, names and shapes exact) ────────────────────────────

export type DelegationJournalEntryV1 =
  | { kind: 'evidence-accepted'; event: DelegationEventEnvelopeV1 }
  | {
      kind: 'lease-created';
      leaseId: string;
      generation: 0;
      activityId: string;
      parentId: string;
      parentIncarnation: string;
      project: string;
      adminRecord: string;
      canonicalPath: string;
      creationBase: string | null;
      sourceKind: DelegationLeaseSourceKind;
      correlationJournalIds: readonly string[];
      firstObservedAt: string;
      lineageId: string;
    };

export interface DelegationJournalRecordV1 {
  v: 1;
  sequence: number;
  journalId: string;
  acceptedAt: string;
  previousDigest: string | null;
  entry: DelegationJournalEntryV1;
  digest: string;
}

export interface DelegationSessionRow {
  sessionId: string;
  parentIncarnation: string;
  explicitIntentAt: string | null;
  effective: boolean;
  effectiveBasis: readonly DelegationIntentSource[];
  claudeSessionIds: readonly string[];
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface DelegationAttemptRow {
  attemptId: string;
  parentId: string;
  parentIncarnation: string;
  project: string;
  adminRecord: string;
  canonicalPath: string | null;
  attemptedAt: string;
  rung: 1 | 2 | 3 | 4 | null;
  verdict: DelegationAttemptVerdict;
  evidenceJournalIds: readonly string[];
  detail: string | null;
}

export interface DelegationActivityRow {
  activityId: string;
  parentId: string;
  parentIncarnation: string;
  sourceKind: DelegationActivitySourceKind;
  upstreamId: string;
  identityJournalId: string;
  displayName: string | null;
  executionState: DelegationExecutionState;
  openedAt: string;
  endedAt: string | null;
  lastEventAt: string;
}

export interface DelegationLeaseRow {
  leaseId: string;
  generation: number;
  creatingJournalSequence: number;
  currentJournalSequence: number;
  activityId: string;
  parentId: string;
  parentIncarnation: string;
  project: string;
  adminRecord: string;
  canonicalPath: string;
  creationBase: string | null;
  sourceKind: DelegationLeaseSourceKind;
  parentageState: DelegationParentageState;
  workspaceState: DelegationWorkspaceState;
  disposition: DelegationDisposition;
  cleanupState: DelegationCleanupState;
  cleanupPopulation: DelegationCleanupPopulation;
  firstObservedAt: string;
  lastObservedAt: string;
  terminalEvidenceAt: string | null;
  adoptedAt: string | null;
  retainedAt: string | null;
  promotedAt: string | null;
  cleanupDueAt: string | null;
  cleanupStartedAt: string | null;
  cleanupFinishedAt: string | null;
  cleanupEvidenceJson: string | null;
  carrierGenerationSeen: number | null;
  releasedAt: string | null;
}

export interface DelegationLineageRow {
  lineageId: string;
  parentId: string;
  parentIncarnation: string;
  activityId: string | null;
  leaseId: string | null;
  runId: number | null;
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
}

export interface DelegationEventRow {
  eventId: string;
  journalSequence: number;
  journalDigest: string;
  acceptedAt: string;
  sessionId: string;
  parentIncarnation: string;
  claudeSessionId: string;
  eventKind: DelegationEventKind;
  observedAt: string;
  payloadJson: string;
}

/** Whether an hour or a bucket was observed. There is no shared measured/unmeasured type to import (the shared health
 *  type spells `'reconstructing' | 'ready'`, which is the recovery phase and a different pair), so it is named once here
 *  for the two checkpoint-only members that carry it. */
export type DelegationIntervalState = 'measured' | 'unmeasured';

/**
 * The last complete line a bucket's cursor stepped over (accepted or refused), so the next read can prove the bytes BEFORE the
 * cursor are the bytes already read (D-4647). `start` is that line's first byte offset, so the line ends, LF included, exactly at
 * the cursor; `sha256` is the lowercase hex SHA-256 of the line WITHOUT its LF (the same bytes the event ID hashes).
 */
export interface DelegationBucketAnchor {
  start: number;
  sha256: string;
}

export interface DelegationBucketCursor {
  sessionId: string;
  parentIncarnation: string;
  bucket: string;
  cursor: number;
  lastSize: number;
  lastCompleteAt: string | null;
  intervalState: DelegationIntervalState;
  detail: string | null;
  /** D-4647: null until the bucket's first complete line. Every later read starts here (not at `cursor`) and must find this line
   *  unchanged, or the bucket is replaced. */
  anchor: DelegationBucketAnchor | null;
  /** D-4647 (R33): once true it never returns to false for this bucket coordinate. A replaced bucket accepts nothing again, however
   *  it regrows: its bytes can no longer be told from bytes already read. */
  replaced: boolean;
}

export interface DelegationObservationInterval {
  sessionId: string;
  parentIncarnation: string;
  utcHour: string;
  state: DelegationIntervalState;
  detail: string | null;
  recordedAt: string;
}

export interface DelegationPruningHold {
  journalId: string;
  reason: 'checkpoint-anchor' | 'open-lease' | 'open-lineage' | 'identity-candidate';
  ownerId: string;
}

export interface DelegationCheckpointV1 {
  v: 1;
  revision: number;
  appliedJournalSequence: number;
  appliedJournalId: string | null;
  appliedJournalDigest: string | null;
  activityIdsByNaturalKey: Readonly<Record<string, string>>;
  coordinatorIntentByParent: Readonly<Record<string, string>>;
  sessions: readonly DelegationSessionRow[];
  attempts: readonly DelegationAttemptRow[];
  activities: readonly DelegationActivityRow[];
  leases: readonly DelegationLeaseRow[];
  lineage: readonly DelegationLineageRow[];
  bucketCursors: readonly DelegationBucketCursor[];
  observationIntervals: readonly DelegationObservationInterval[];
  pruningHolds: readonly DelegationPruningHold[];
}

/**
 * What `CoordStore.insertDelegationEvents` answers: how many rows of the batch were new, how many were already there
 * identically, and the rows SQLite holds DIFFERENTLY. A conflict is the same `eventId` with another row, or another event on
 * the same `journalSequence`; it is reported and never thrown, and it does not stop the rows after it. Declared here (L1) so the
 * store and the applier's port both name it without either importing the other.
 */
export interface DelegationInsertEventsResult {
  inserted: number;
  duplicate: number;
  conflicts: readonly DelegationEventRow[];
}

/**
 * What `CoordStore.projectDelegationCheckpointChanges` answers: `delta` when it wrote only the rows that changed (`rows` = the
 * UPDATEs plus the INSERTs it ran, zero for an application that changed no projected row), `full` when the change was not one a
 * delta may carry and it ran the full projection instead. A refused delta throws; it never answers `full` for a failure. Declared
 * here (L1) so the store and the applier's port both name it without either importing the other.
 */
export type DelegationProjectChangesResult = { mode: 'delta'; rows: number } | { mode: 'full' };

/** One table row as its codec encodes it: every column of the codec, named. */
export type DelegationProjectionValues = Readonly<Record<string, DelegationSqlValue>>;

/** A row both checkpoints hold under one key and whose encoded columns differ. `table` is the codec's; `keyColumns` name the
 *  primary key among the columns; `prior` and `next` hold EVERY column's encoded value, so a store can swap on all of them. */
export interface DelegationProjectionUpdate {
  table: string;
  keyColumns: readonly string[];
  prior: DelegationProjectionValues;
  next: DelegationProjectionValues;
}

/** A row only the later checkpoint holds, encoded. `table` is the codec's. */
export interface DelegationProjectionInsert {
  table: string;
  values: DelegationProjectionValues;
}

/**
 * `diffDelegationProjection`'s answer. `applicable: false` carries a short `reason` and means "this is not an addition or an
 * update of the kind a delta may carry": the caller projects in full. `applicable: true` lists the rows to update, the rows to
 * insert (parents first: sessions, activities, attempts, lineage) and the later checkpoint's length for each of the five tables
 * (`counts`, each with its codec's `table`), the numbers a drift check holds the stored tables to.
 */
export type DelegationProjectionDiff =
  | { applicable: false; reason: string }
  | {
    applicable: true;
    updates: readonly DelegationProjectionUpdate[];
    inserts: readonly DelegationProjectionInsert[];
    counts: readonly { table: string; count: number }[];
  };

/**
 * R27: a type that makes every property, array and map reachable from `T` read-only. The durable applier's `state()`, the outcomes
 * it returns and what a checkpoint change returns ARE (or become) its live rows, so a caller that edited one in place would corrupt
 * the applier. They are therefore typed with this, and an in-place edit through any of them is a compile error. (A read-only view
 * stays ASSIGNABLE to the mutable row types, because TypeScript does not compare `readonly` on object properties, so passing a view
 * on to a function that takes the plain type still compiles; what the view forbids is the write.)
 */
export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T                                           // a function keeps its call signature
  : T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends ReadonlySet<infer U> ? ReadonlySet<DeepReadonly<U>>
  : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

export interface DelegationRecoveryState {
  checkpoint: DelegationCheckpointV1;
  /** The shared health type owns this pair; read from it, never re-spelled. */
  phase: DelegationHealthInput['recoveryPhase'];
}

/**
 * What pure policy asks the serialized journal adapter for (the plan's fixed vocabulary; Task 12 produces it, Task 8's
 * adapter consumes it). It carries MEASURED identity and nothing else: no UUID, no generation, no journal sequence, no
 * clock but the canonical `firstObservedAt`, no transition state, no token and no executable action. The adapter, not
 * policy, mints the lease ID, and only after deduplication.
 */
export interface DelegationLeaseCreationRequest {
  activityId: string;
  parentId: string;
  parentIncarnation: string;
  project: string;
  adminRecord: string;
  canonicalPath: string;
  creationBase: string | null;
  sourceKind: DelegationLeaseSourceKind;
  correlationJournalIds: readonly string[];
  firstObservedAt: string;
}

/**
 * One admin record of the worktree census (spec §5.5), as correlation reads it: the plan's fixed shape, declared here beside the other
 * pure delegation types because the census ADAPTER (`gitref.ts`) is IO and a pure module must not import it. Task 10 builds these from
 * the real census. Three fields are pinned FOLDS of a failed read (wave 1, D-4008): `locked` is `false` when its stat failed,
 * `baseAgreesFirstLog` is `null` when `logs/HEAD` could not be read, and a `canonicalPath` of `null` is an unreadable `gitdir`
 * read as an absent one. None of them is positive evidence of anything, and correlation treats each so.
 */
export interface DelegationCensusRecord {
  project: string;
  adminRecord: string;
  canonicalPath: string | null;
  headBranch: string | null;
  headSha: string | null;
  claudeBase: string | null;
  locked: boolean;
  baseAgreesFirstLog: boolean | null;
  /** The plan's three words: the admin record read fine, or it did not (`ReadFailure`: measured absent, or unreadable). */
  state: 'present' | ReadFailure;
  diagnostic: string | null;
}

/** A checkpoint with nothing in it: no anchor, no row, no mapping. */
export function emptyDelegationCheckpoint(): DelegationCheckpointV1 {
  return {
    v: 1, revision: 0, appliedJournalSequence: 0, appliedJournalId: null, appliedJournalDigest: null,
    activityIdsByNaturalKey: {}, coordinatorIntentByParent: {}, sessions: [], attempts: [], activities: [], leases: [],
    lineage: [], bucketCursors: [], observationIntervals: [], pruningHolds: [],
  };
}

// ── Errors ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `canonicalDelegationJson` refused its input: the value is outside the closed JSON domain. */
export class DelegationJsonError extends Error {
  constructor(detail: string) {
    super(`delegation canonical JSON: ${detail}`);
    this.name = 'DelegationJsonError';
  }
}

/** Why the model refused something. Closed, so a caller and a test can tell one refusal from another without reading
 *  prose, and an SQLite error (a constraint, a foreign key) is never mistaken for one of these. */
export type DelegationModelRefusal =
  | 'bad-instant'            // not a canonical UTC millisecond string, or not an instant a table can hold
  | 'unreadable-row'         // a table row the typed reader will not turn into a model row (never cast, never defaulted)
  | 'bad-event'              // an evidence event row that cannot be a `delegation_events` row
  | 'event-conflict'         // the same evidence event ID, a different row
  | 'bad-checkpoint'         // a checkpoint that is not a version-1 checkpoint with a sound applied position
  | 'bad-row'                // a row the codec refuses to WRITE because its own reader would refuse it on read
  | 'foreign-keys-off'       // the handle does not enforce foreign keys, which the projection's order relies on
  | 'bad-natural-key'        // an activity natural key that is not four strings and a known source kind
  | 'bad-identity-journal-id'
  | 'identity-journal-id-required'
  | 'lease-generation'       // the five wave-3 lease invariants, then the one about the journal
  | 'lease-sequences'
  | 'lease-disposition'
  | 'lease-cleanup-state'
  | 'lease-transition-field'
  | 'lease-last-observed'    // wave 3 replays firstObservedAt into lastObservedAt: they are one instant
  | 'lease-opening-lineage'  // replay also opens the lease's own lineage row, at that same instant
  | 'lease-without-journal-entry'
  | 'activity-id-mismatch'   // an activity row whose ID is not the derivation from its natural key and identity journalId
  | 'natural-key-map'        // activityIdsByNaturalKey and the activity rows disagree, in either direction
  | 'intent-map'             // coordinatorIntentByParent and the session rows' explicitIntentAt disagree
  | 'lease-lineage'          // a lease's opening lineage row is missing, mis-owned or mis-derived
  | 'projection-delta-mismatch'; // a delta projection's compare-and-swap or row-count check found SQLite other than the prior checkpoint

export class DelegationModelError extends Error {
  constructor(readonly code: DelegationModelRefusal, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'DelegationModelError';
  }
}

// ── The words this file spells, for the coordination scanner ─────────────────────────────────────────────────────────

/** The two journal entry kinds, as a TOTAL table over `DelegationJournalEntryV1['kind']`: a kind added to the union is a compile
 *  error here until it is named, and the journal and the checkpoint read the table rather than spell the words again. */
export const DELEGATION_JOURNAL_ENTRY_KINDS: Readonly<Record<DelegationJournalEntryV1['kind'], true>> = {
  'evidence-accepted': true, 'lease-created': true,
};

/** The reasons a pruning hold can carry, as a TOTAL table over `DelegationPruningHold['reason']`. */
export const DELEGATION_PRUNING_HOLD_REASONS: Readonly<Record<DelegationPruningHold['reason'], true>> = {
  'checkpoint-anchor': true, 'open-lease': true, 'open-lineage': true, 'identity-candidate': true,
};

/** Every refusal the model throws, as a TOTAL table over `DelegationModelRefusal`. The journal and the correlation, which throw
 *  a few of them themselves, read this table and do not spell them again. */
export const DELEGATION_MODEL_REFUSALS: Readonly<Record<DelegationModelRefusal, true>> = {
  'bad-instant': true, 'unreadable-row': true, 'bad-event': true, 'event-conflict': true, 'bad-checkpoint': true, 'bad-row': true,
  'foreign-keys-off': true, 'bad-natural-key': true, 'bad-identity-journal-id': true, 'identity-journal-id-required': true,
  'lease-generation': true, 'lease-sequences': true, 'lease-disposition': true, 'lease-cleanup-state': true,
  'lease-transition-field': true, 'lease-last-observed': true, 'lease-opening-lineage': true, 'lease-without-journal-entry': true,
  'activity-id-mismatch': true, 'natural-key-map': true, 'intent-map': true, 'lease-lineage': true, 'projection-delta-mismatch': true,
};

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`: the model's refusals, the journal
 *  entry kinds, the pruning hold reasons, the intent route's one answer of its own, and two words that belong to `shared/api.ts` (`bash-worktree`, a source kind, and
 *  `not-due`, a cleanup state), read from there and never re-spelled. Derived from tables, never a list, so a word added to a
 *  union is admitted and a typo is not. None is a mail rejection or a run refusal. */
export function isDelegationModelKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return own(DELEGATION_MODEL_REFUSALS) || own(DELEGATION_JOURNAL_ENTRY_KINDS) || own(DELEGATION_PRUNING_HOLD_REASONS) || own(COORDINATOR_INTENT_REFUSALS)
    || (DELEGATION_ACTIVITY_SOURCE_KINDS as readonly string[]).includes(v) || (DELEGATION_CLEANUP_STATES as readonly string[]).includes(v)
    || isDelegationHealthKebab(v);
}

// ── Canonical JSON (RFC 8785 over the plan's closed domain) ──────────────────────────────────────────────────────────

/** A high surrogate not followed by a low one, or a low one not preceded by a high one. UTF-8 cannot carry either, and
 *  `Buffer` would hash both as U+FFFD, so two different strings would share a hash. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const wellFormed = (s: string, where: string): string => {
  if (LONE_SURROGATE.test(s)) throw new DelegationJsonError(`${where} holds a lone surrogate`);
  return s;
};

/** Own keys of an object, with an engine refusal (a Proxy whose `ownKeys` repeats a key throws a TypeError itself)
 *  surfaced as OUR refusal: a repeated input key is rejected before any encoding. */
const ownKeysOf = (o: object, where: string): Array<string | symbol> => {
  try { return Reflect.ownKeys(o); } catch (err) {
    throw new DelegationJsonError(`${where} cannot enumerate its keys (${err instanceof Error ? err.message : String(err)})`);
  }
};

/** UTF-16 code unit order, the order RFC 8785 sorts properties in (the default `<` on strings, not a locale compare). */
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function canon(value: unknown, where: string, ancestors: readonly object[]): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'string': return JSON.stringify(wellFormed(value, where));
    case 'number':
      if (!Number.isFinite(value)) throw new DelegationJsonError(`${where} is not a finite number`);
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new DelegationJsonError(`${where} is an integer outside the JavaScript safe range`);
      }
      return JSON.stringify(value);                       // ECMAScript Number-to-String; -0 is "0"
    case 'object': break;
    default: throw new DelegationJsonError(`${where} is ${typeof value}, which is outside the JSON domain`);
  }
  const obj: object = value;
  if (ancestors.includes(obj)) throw new DelegationJsonError(`${where} is a cycle`);
  const chain = [...ancestors, obj];
  if (Array.isArray(obj)) {
    if (Object.getPrototypeOf(obj) !== Array.prototype) throw new DelegationJsonError(`${where} is not a plain array`);
    if (Object.getOwnPropertySymbols(obj).length > 0) throw new DelegationJsonError(`${where} has a symbol key`);
    if (Object.keys(obj).length !== obj.length) throw new DelegationJsonError(`${where} is a sparse array or has extra properties`);
    const items: string[] = [];
    for (let i = 0; i < obj.length; i++) {
      const d = Object.getOwnPropertyDescriptor(obj, i);
      if (d === undefined || !('value' in d)) throw new DelegationJsonError(`${where}[${i}] is not a data element`);
      items.push(canon(d.value, `${where}[${i}]`, chain));
    }
    return `[${items.join(',')}]`;
  }
  const proto = Object.getPrototypeOf(obj) as unknown;
  if (proto !== Object.prototype && proto !== null) throw new DelegationJsonError(`${where} is not a plain object`);
  const keys = ownKeysOf(obj, where);
  const names: string[] = [];
  for (const k of keys) {
    if (typeof k === 'symbol') throw new DelegationJsonError(`${where} has a symbol key`);
    names.push(k);
  }
  names.sort(byCodeUnits);
  const members: string[] = [];
  for (const k of names) {
    const d = Object.getOwnPropertyDescriptor(obj, k);
    if (d === undefined || !('value' in d) || d.enumerable !== true) {
      throw new DelegationJsonError(`${where}.${k} is not an enumerable data property`);
    }
    members.push(`${JSON.stringify(wellFormed(k, `${where} key`))}:${canon(d.value, `${where}.${k}`, chain)}`);
  }
  return `{${members.join(',')}}`;
}

/**
 * RFC 8785 (JSON Canonicalization Scheme) over the plan's closed JSON domain: UTF-8 text without a BOM (the result is a
 * JS string; encode it as UTF-8 to hash or write it), properties sorted by UTF-16 code units at every depth, ECMAScript
 * string escaping and number serialisation, no optional whitespace, lowercase `true`/`false`/`null`.
 *
 * REJECTED before encoding, with a `DelegationJsonError`: an integer outside the safe range, NaN and the infinities,
 * a lone surrogate (in a value or a key), a sparse array or one with extra properties, `undefined`, a bigint, a symbol,
 * a function, any object that is not plain (a class instance, a Date, a Map, an accessor, a symbol key, a non-enumerable
 * property), a cycle, and a Proxy whose keys repeat. No generic JSON writer may stand in for this one: a journal
 * preimage hashed from anything else is a different record.
 */
export function canonicalDelegationJson(value: unknown): string {
  return canon(value, '$', []);
}

/** Lowercase SHA-256 of the string's UTF-8 bytes. */
export function delegationSha256Hex(text: string): string {
  return createHash('sha256').update(wellFormed(text, 'the hashed text'), 'utf8').digest('hex');
}

/** A lowercase 64-hex SHA-256. */
export const isLowerHex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

// ── Activity natural key and activity ID (O1, O4) ────────────────────────────────────────────────────────────────────

/** A length prefix and the string: the string's UTF-8 BYTE length, a colon, then the string itself. A fixed number of
 *  these concatenated is unambiguous whatever the strings hold, which delimiter joining is not. */
const lengthPrefixed = (s: string): string => `${Buffer.byteLength(s, 'utf8')}:${s}`;

/** Narrowing a value to a closed list without casting it: the guard IS the check. */
const isMember = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * The canonical encoding of an activity's natural key: `parentId`, `parentIncarnation`, `sourceKind`, `upstreamId`, each
 * length-prefixed (see `lengthPrefixed`), in that order. It is the key of `activityIdsByNaturalKey` and the first part of
 * the activity ID's preimage.
 */
export function encodeDelegationNaturalKey(key: DelegationActivityNaturalKey): string {
  const { parentId, parentIncarnation, sourceKind, upstreamId } = key;
  const fields: Array<[string, unknown]> = [
    ['parentId', parentId], ['parentIncarnation', parentIncarnation], ['sourceKind', sourceKind], ['upstreamId', upstreamId],
  ];
  for (const [name, v] of fields) {
    if (typeof v !== 'string') throw new DelegationModelError('bad-natural-key', `${name} is not a string`);
    if (LONE_SURROGATE.test(v)) throw new DelegationModelError('bad-natural-key', `${name} holds a lone surrogate`);
  }
  if (!isMember(DELEGATION_ACTIVITY_SOURCE_KINDS, sourceKind)) {
    throw new DelegationModelError('bad-natural-key', 'sourceKind is not an activity source kind');
  }
  return lengthPrefixed(parentId) + lengthPrefixed(parentIncarnation) + lengthPrefixed(sourceKind) + lengthPrefixed(upstreamId);
}

/**
 * The activity ID: lowercase SHA-256 of the natural-key encoding EXTENDED by the selected `identityJournalId`, which is the
 * `journalId` of the accepted journal record that named the activity. It is never the envelope's `eventId`: that is a
 * different hash over different bytes, and an ID made from it is a different, wrong ID (W3-M59).
 */
export function deriveDelegationActivityId(key: DelegationActivityNaturalKey, identityJournalId: string): string {
  if (!isLowerHex64(identityJournalId)) {
    throw new DelegationModelError('bad-identity-journal-id', 'an identity journalId is a lowercase 64-hex SHA-256');
  }
  return delegationSha256Hex(encodeDelegationNaturalKey(key) + lengthPrefixed(identityJournalId));
}

/** The domain tag of a lease's opening lineage ID. A different tag gives a different hash for the same four strings, so a
 *  lineage ID can never be mistaken for any other hash this module derives. */
const LINEAGE_ID_DOMAIN = 'ccrc-delegation-lineage-v1';

/** What a lease's opening lineage ID is derived from. */
export interface DelegationLineageIdParts {
  leaseId: string;
  parentId: string;
  parentIncarnation: string;
  activityId: string;
}

/**
 * The lease's opening lineage ID: lowercase SHA-256 of the domain tag and `(leaseId, parentId, parentIncarnation,
 * activityId)`, each length-prefixed exactly as the natural key is (the UTF-8 byte length, a colon, the string). It is
 * deterministic, so replay of a `lease-created` entry opens the same lineage row the live path did.
 */
export function deriveDelegationLineageId(parts: DelegationLineageIdParts): string {
  const { leaseId, parentId, parentIncarnation, activityId } = parts;
  for (const [name, v] of [['leaseId', leaseId], ['parentId', parentId], ['parentIncarnation', parentIncarnation], ['activityId', activityId]]) {
    if (typeof v !== 'string' || v === '' || LONE_SURROGATE.test(v)) {
      throw new DelegationModelError('bad-row', `lineage ${name} is not a non-empty string`);
    }
  }
  return delegationSha256Hex(lengthPrefixed(LINEAGE_ID_DOMAIN) + lengthPrefixed(leaseId) + lengthPrefixed(parentId)
    + lengthPrefixed(parentIncarnation) + lengthPrefixed(activityId));
}

/**
 * The mapping-first rule, written INTO the caller's own mapping (D-5833). It reads the mapping first by an OWN property
 * only: a natural key with a mapping ALWAYS gets its mapped ID back, whatever journalId the caller now holds, and the
 * mapping is left as it was (a key never mints a second activity, and an ID is never re-hashed from a later event because
 * the original naming record was pruned: O4; a zero-delta Bash call's key, retired under the O4 amendment, has no mapping, and while both of its
 * records are retained neither is a qualifying join, so nothing allocates it again; wave 4's compaction must keep a listing-carrying Bash
 * call's PreToolUse and PostToolUse together, D-6267, D-6268). Only a missing mapping allocates, and that needs the `identityJournalId` of
 * an accepted qualifying retained record: it throws `identity-journal-id-required` without one and
 * `bad-identity-journal-id` for a malformed one, and a refusal writes nothing. An allocation sets `mapping[encoded]` and
 * returns the ID. The encoded key is length-prefixed, so it can never be an inherited name and the assignment is an own
 * write.
 *
 * `mapping` is MUTATED, so the caller must own it: the checkpoint builder's fold does (its mapping is private to the
 * builder, copied by `adoptRows` and `clone` and re-materialised by `build`), and `restoreOrAllocateActivityId` passes a
 * copy. THE ID MUST NOT ESCAPE (be returned to a caller, inserted into `coord.db`, logged as an outcome, or put in a
 * report) until a checkpoint holding this mapping and the activity row has been durably replaced (O1): until then it is a
 * candidate, and a crash discards it.
 */
export function allocateDelegationActivityIdInto(
  mapping: Record<string, string>,
  key: DelegationActivityNaturalKey,
  identityJournalId: string | null,
): string {
  const encoded = encodeDelegationNaturalKey(key);
  const mapped = Object.hasOwn(mapping, encoded) ? mapping[encoded] : undefined;
  if (mapped !== undefined) return mapped;
  if (identityJournalId === null) {
    throw new DelegationModelError('identity-journal-id-required',
      'a natural key with no mapping needs the journalId of an accepted qualifying record');
  }
  const activityId = deriveDelegationActivityId(key, identityJournalId);
  mapping[encoded] = activityId;
  return activityId;
}

/**
 * The pure form of `allocateDelegationActivityIdInto`: the same mapping-first rule over a checkpoint it does not touch
 * (O4). A hit returns the SAME checkpoint object, a miss a NEW one carrying the mapping with the key added, whose
 * `revision` is left to the serialized checkpoint replacement. After D-5833 the checkpoint builder's fold allocates in
 * place and no longer calls this, so its only callers are the O4 rows in `delegation-model.test.ts`.
 *
 * How a hit is told WITHOUT a second mapping-first read: the in-place function writes the copy only on a miss, so the
 * copy's own-key count is unchanged by a hit and one greater after a miss (a miss always adds exactly the one new key).
 * The count is a measure of the write, not a second read of the key. It tells a hit because an encoded key never names an
 * inherited property, so a miss always adds one own key, and because a decoded mapping holds no `undefined` value (a hand-built
 * mapping with an own `undefined` value would read as a miss, be overwritten in the copy, and then count as a hit).
 * THE ID MUST NOT ESCAPE until durably replaced (O1).
 */
export function restoreOrAllocateActivityId(
  key: DelegationActivityNaturalKey,
  identityJournalId: string | null,
  checkpoint: DelegationCheckpointV1,
): { activityId: string; checkpoint: DelegationCheckpointV1 } {
  const copy = { ...checkpoint.activityIdsByNaturalKey };
  const before = Object.keys(copy).length;
  const activityId = allocateDelegationActivityIdInto(copy, key, identityJournalId);
  if (Object.keys(copy).length === before) return { activityId, checkpoint };
  return { activityId, checkpoint: { ...checkpoint, activityIdsByNaturalKey: copy } };
}

/** An activity's source as the lease provenance it implies: `bash-worktree` is raw use of a worktree, `raw` on a lease.
 *  The two vocabularies are different on purpose (`attached` exists only on the lease side). */
export function leaseSourceKindOfActivity(kind: DelegationActivitySourceKind): DelegationLeaseSourceKind {
  switch (kind) {
    case 'agent': return 'agent';
    case 'workflow': return 'workflow';
    case 'bash-worktree': return 'raw';
  }
}

/**
 * The lease provenances wave 3 may WRITE: the shared lease vocabulary minus `attached`, which the complete migration can represent
 * and no wave-3 writer produces. Derived once, here, from the one declaration, so a new provenance is a decision and not a second
 * hand-kept list.
 */
export const WAVE3_LEASE_SOURCE_KINDS: readonly Exclude<DelegationLeaseSourceKind, 'attached'>[] =
  DELEGATION_LEASE_SOURCE_KINDS.filter((k): k is Exclude<DelegationLeaseSourceKind, 'attached'> => k !== 'attached');

// ── Instants ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A canonical UTC millisecond string (`2026-10-14T00:15:00.000Z`) as epoch milliseconds, between 1970 and year 9999.
 *  Anything else — no milliseconds, an offset, a date that rolls over (Feb 30), hour 24 — is refused, not normalised. */
export function parseDelegationInstant(iso: string): number {
  if (typeof iso !== 'string' || !CANONICAL_INSTANT.test(iso)) {
    throw new DelegationModelError('bad-instant', `${JSON.stringify(iso)} is not a canonical UTC millisecond instant`);
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0 || new Date(ms).toISOString() !== iso) {
    throw new DelegationModelError('bad-instant', `${iso} is not an instant a table can hold`);
  }
  return ms;
}

/** Epoch milliseconds as the canonical UTC millisecond string; the inverse of `parseDelegationInstant`. */
export function formatDelegationInstant(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new DelegationModelError('bad-instant', `${String(ms)} is not epoch milliseconds`);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new DelegationModelError('bad-instant', `${ms} is past the last representable instant`);
  const iso = d.toISOString();
  if (!CANONICAL_INSTANT.test(iso)) throw new DelegationModelError('bad-instant', `${ms} is past year 9999`);
  return iso;
}

// ── The wave-3 lease guard ────────────────────────────────────────────────────────────────────────────────────────────

/** Every lease column that a LATER wave's transition fills in. Wave 3 has no transition entry kind, so all are null. */
const LEASE_TRANSITION_FIELDS = [
  'terminalEvidenceAt', 'adoptedAt', 'retainedAt', 'promotedAt', 'cleanupDueAt', 'cleanupStartedAt', 'cleanupFinishedAt',
  'cleanupEvidenceJson', 'carrierGenerationSeen', 'releasedAt',
] as const satisfies readonly (keyof DelegationLeaseRow)[];

/**
 * What wave 3 may write to `delegation_leases`. The DDL is the complete future-facing shape and allows far more, so the
 * schema never has to change to loosen this; the guard is here, in one place, and `projectDelegationCheckpoint` runs it
 * over every lease BEFORE it opens a transaction.
 *
 * A wave-3 lease exists only by replaying its durable `lease-created` entry, so it is generation 0, its creating and
 * current journal sequences are equal, it is `ephemeral`, its cleanup is `not-due`, and every transition clock, evidence
 * and carrier field is null. And that entry must exist in the journal the checkpoint has applied: a lease whose creating
 * sequence is past `appliedJournalSequence` has no journal entry behind it (an "event-less" lease), and so no authority.
 * Replay sets `lastObservedAt` to the entry's `firstObservedAt` too (so the two are equal). That the entry's sequence names
 * a retained `lease-created` record whose fields equal the lease is the journal's to prove (Task 8), not this guard's.
 */
export function assertWave3Lease(lease: DelegationLeaseRow, appliedJournalSequence: number): void {
  const id = lease.leaseId;
  if (lease.generation !== 0) {
    throw new DelegationModelError('lease-generation', `lease ${id} is generation ${lease.generation}; wave 3 writes only generation 0`);
  }
  if (lease.creatingJournalSequence !== lease.currentJournalSequence
      || !Number.isSafeInteger(lease.creatingJournalSequence) || lease.creatingJournalSequence < 1) {
    throw new DelegationModelError('lease-sequences',
      `lease ${id} has creating sequence ${lease.creatingJournalSequence} and current ${lease.currentJournalSequence}; at generation 0 they are one positive integer`);
  }
  if (lease.disposition !== 'ephemeral') {
    throw new DelegationModelError('lease-disposition', `lease ${id} is ${lease.disposition}; wave 3 writes only ephemeral leases`);
  }
  if (lease.cleanupState !== 'not-due') {
    throw new DelegationModelError('lease-cleanup-state', `lease ${id} has cleanup ${lease.cleanupState}; wave 3 writes only not-due`);
  }
  for (const field of LEASE_TRANSITION_FIELDS) {
    if (lease[field] !== null) {
      throw new DelegationModelError('lease-transition-field', `lease ${id}: ${field} must be null in wave 3`);
    }
  }
  if (lease.lastObservedAt !== lease.firstObservedAt) {
    throw new DelegationModelError('lease-last-observed',
      `lease ${id} was last observed at ${lease.lastObservedAt} but first at ${lease.firstObservedAt}; wave 3 replay sets both to the entry's instant`);
  }
  if (lease.creatingJournalSequence > appliedJournalSequence) {
    throw new DelegationModelError('lease-without-journal-entry',
      `lease ${id} was created at journal sequence ${lease.creatingJournalSequence}, past the applied sequence ${appliedJournalSequence}`);
  }
}

/**
 * Every lease of a checkpoint through `assertWave3Lease`, and then the one invariant that needs the checkpoint's lineage:
 * replay opens a lease-OWNED lineage row (`leaseId` set, so neither an activity's nor a run's) whose `openedAt` is the
 * lease's `firstObservedAt`. A lease without one is a lease whose history the journal entry would have opened and the
 * checkpoint lost. Run before any transaction opens, so a refusal writes nothing.
 */
export function assertWave3Leases(checkpoint: DelegationCheckpointV1): void {
  for (const lease of checkpoint.leases) assertWave3Lease(lease, checkpoint.appliedJournalSequence);
  const openedAt = new Map<string, Set<string>>();
  for (const n of checkpoint.lineage) {
    if (n.leaseId === null) continue;
    const at = openedAt.get(n.leaseId) ?? new Set<string>();
    at.add(n.openedAt);
    openedAt.set(n.leaseId, at);
  }
  for (const lease of checkpoint.leases) {
    if (openedAt.get(lease.leaseId)?.has(lease.firstObservedAt) !== true) {
      throw new DelegationModelError('lease-opening-lineage',
        `lease ${lease.leaseId} has no lease-owned lineage row opened at its firstObservedAt ${lease.firstObservedAt}`);
    }
  }
}

// ── The checkpoint's identity invariants ──────────────────────────────────────────────────────────────────────────────

/**
 * The invariants that make a checkpoint's IDENTITY data trustworthy, in ONE pure helper that runs at checkpoint build and at
 * recovery. A violation is a recovery failure (the phase stays `reconstructing`, pruning stays disabled), never a repair that
 * fails forever after a bad authority is durable:
 *   - each `activityId` equals `deriveDelegationActivityId(naturalKey, identityJournalId)` (O1, O4);
 *   - `activityIdsByNaturalKey` agrees with the activity rows BOTH ways: every activity is mapped to its own ID, and the map holds
 *     nothing else (two activities on one natural key, or an orphan mapping, are both refused);
 *   - `coordinatorIntentByParent` equals what the session rows' `explicitIntentAt` say (`deriveCoordinatorIntentByParent`);
 *   - each lease's opening lineage row (the lease-OWNED row `deriveDelegationLineageId` names) exists, belongs to the lease's
 *     own `(parentId, parentIncarnation)`, owns nothing but the lease, and opens at the lease's `firstObservedAt`.
 * The lease checks that need the journal (that the creating entry exists and equals the lease) are the journal proof's,
 * made at recovery and at build by the checkpoint module.
 */
export function assertDelegationCheckpointIdentity(checkpoint: DelegationCheckpointV1): void {
  const seen = new Set<string>();
  for (const a of checkpoint.activities) {
    const expected = deriveDelegationActivityId(a, a.identityJournalId);
    if (a.activityId !== expected) {
      throw new DelegationModelError('activity-id-mismatch',
        `activity ${a.activityId} is not the derivation (${expected}) from its natural key and identity journalId ${a.identityJournalId}`);
    }
    const encoded = encodeDelegationNaturalKey(a);
    if (seen.has(encoded)) throw new DelegationModelError('natural-key-map', `two activities share the natural key ${encoded}`);
    seen.add(encoded);
    const mapped = Object.hasOwn(checkpoint.activityIdsByNaturalKey, encoded) ? checkpoint.activityIdsByNaturalKey[encoded] : undefined;
    if (mapped !== a.activityId) {
      throw new DelegationModelError('natural-key-map',
        `activity ${a.activityId} is not mapped from its natural key ${encoded} (the map says ${String(mapped)})`);
    }
  }
  for (const [encoded, id] of Object.entries(checkpoint.activityIdsByNaturalKey)) {
    if (!seen.has(encoded)) {
      throw new DelegationModelError('natural-key-map', `the mapping ${encoded} -> ${id} has no activity row behind it`);
    }
  }
  if (canonicalDelegationJson(checkpoint.coordinatorIntentByParent)
      !== canonicalDelegationJson(deriveCoordinatorIntentByParent(checkpoint.sessions))) {
    throw new DelegationModelError('intent-map', 'coordinatorIntentByParent disagrees with the session rows\' explicitIntentAt');
  }
  const lineageById = new Map(checkpoint.lineage.map((n) => [n.lineageId, n] as const));
  for (const lease of checkpoint.leases) {
    const lineageId = deriveDelegationLineageId(lease);
    const opening = lineageById.get(lineageId);
    if (opening === undefined) {
      throw new DelegationModelError('lease-lineage', `lease ${lease.leaseId} has no opening lineage row ${lineageId}`);
    }
    if (opening.leaseId !== lease.leaseId || opening.activityId !== null || opening.runId !== null) {
      throw new DelegationModelError('lease-lineage', `lineage ${lineageId} is not owned by lease ${lease.leaseId} alone`);
    }
    if (opening.openedAt !== lease.firstObservedAt) {
      throw new DelegationModelError('lease-lineage', `lineage ${lineageId} opens at ${opening.openedAt}, not at the lease's firstObservedAt ${lease.firstObservedAt}`);
    }
  }
  // EVERY lease-owned lineage row (the opening row included) names its lease's own parent: a lineage edge is the parent's.
  const leaseById = new Map(checkpoint.leases.map((l) => [l.leaseId, l] as const));
  for (const n of checkpoint.lineage) {
    if (n.leaseId === null) continue;
    const lease = leaseById.get(n.leaseId);
    if (lease === undefined) throw new DelegationModelError('lease-lineage', `lineage ${n.lineageId} names lease ${n.leaseId}, which has no row`);
    if (n.parentId !== lease.parentId || n.parentIncarnation !== lease.parentIncarnation) {
      throw new DelegationModelError('lease-lineage',
        `lineage ${n.lineageId} names parent (${n.parentId}, ${n.parentIncarnation}), not its lease's (${lease.parentId}, ${lease.parentIncarnation})`);
    }
  }
}

// ── Row codecs: checkpoint shapes to table columns and back ───────────────────────────────────────────────────────────

/** What a prepared statement binds: text, an integer, or NULL. */
export type DelegationSqlValue = string | number | null;

type RawRow = Readonly<Record<string, unknown>>;

/** One table's codec. `columns` is the DDL's column list in the DDL's order (an autoincrement `id` is never one);
 *  `toDb` names every column, so a statement binds `columns.map((c) => record[c])` and no position is hand-kept;
 *  `fromDb` is the typed reader. */
export interface DelegationRowCodec<Row, Col extends string> {
  readonly table: string;
  readonly columns: readonly Col[];
  toDb(row: Row): Readonly<Record<Col, DelegationSqlValue>>;
  fromDb(raw: RawRow): Row;
}

const unreadable = (table: string, column: string, why: string): never => {
  throw new DelegationModelError('unreadable-row', `${table}.${column}: ${why}`);
};

/** Typed readers over one raw row. A missing column, a wrong storage class or an out-of-list word is an unreadable row. */
const readers = (table: string, raw: RawRow) => {
  const text = (c: string): string => {
    const v = raw[c];
    return typeof v === 'string' ? v : unreadable(table, c, 'expected text');
  };
  const textOrNull = (c: string): string | null => (raw[c] === null ? null : text(c));
  const int = (c: string): number => {
    const v = raw[c];
    return typeof v === 'number' && Number.isSafeInteger(v) ? v : unreadable(table, c, 'expected an integer');
  };
  const intOrNull = (c: string): number | null => (raw[c] === null ? null : int(c));
  const instant = (c: string): string => {
    const ms = int(c);
    try { return formatDelegationInstant(ms); } catch { return unreadable(table, c, `${ms} is not an instant`); }
  };
  const instantOrNull = (c: string): string | null => (raw[c] === null ? null : instant(c));
  const flag = (c: string): boolean => {
    const v = int(c);
    return v === 0 || v === 1 ? v === 1 : unreadable(table, c, 'expected 0 or 1');
  };
  const member = <T extends string>(c: string, list: readonly T[]): T => {
    const v = text(c);
    return isMember(list, v) ? v : unreadable(table, c, `${JSON.stringify(v)} is not one of ${list.join(', ')}`);
  };
  const jsonList = <T extends string>(c: string, accept: (v: unknown) => v is T, what: string): readonly T[] => {
    const body = text(c);
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return unreadable(table, c, 'not JSON'); }
    if (!Array.isArray(parsed) || !parsed.every(accept)) return unreadable(table, c, `not a list of ${what}`);
    return parsed;
  };
  const isString = (v: unknown): v is string => typeof v === 'string';
  return { text, textOrNull, int, intOrNull, instant, instantOrNull, flag, member, isString,
    stringList: (c: string) => jsonList(c, isString, 'strings'),
    sourceList: (c: string) => jsonList(c, (v): v is DelegationIntentSource => isMember(DELEGATION_INTENT_SOURCES, v), 'intent sources') };
};

/** The write side of a typed reader: a list column a projection writes must be one `readers()` would read back. */
const stringListOf = (v: unknown, where: string): readonly string[] => {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new DelegationModelError('bad-row', `${where} is not a list of strings`);
  }
  return v;
};
const intentSourcesOf = (v: unknown, where: string): readonly DelegationIntentSource[] => {
  if (!Array.isArray(v) || !v.every((x): x is DelegationIntentSource => isMember(DELEGATION_INTENT_SOURCES, x))) {
    throw new DelegationModelError('bad-row', `${where} is not a list of intent sources (${DELEGATION_INTENT_SOURCES.join(', ')})`);
  }
  return v;
};

const instantMs = (iso: string): number => parseDelegationInstant(iso);
const instantMsOrNull = (iso: string | null): number | null => (iso === null ? null : parseDelegationInstant(iso));

const SESSION_COLUMNS = [
  'sessionId', 'parentIncarnation', 'explicitIntentAt', 'effective', 'effectiveBasisJson', 'claudeSessionIdsJson',
  'firstObservedAt', 'lastObservedAt',
] as const;
export const delegationSessionCodec: DelegationRowCodec<DelegationSessionRow, (typeof SESSION_COLUMNS)[number]> = {
  table: 'delegation_sessions',
  columns: SESSION_COLUMNS,
  toDb: (r) => ({
    sessionId: r.sessionId, parentIncarnation: r.parentIncarnation, explicitIntentAt: instantMsOrNull(r.explicitIntentAt),
    effective: r.effective ? 1 : 0,
    effectiveBasisJson: canonicalDelegationJson(intentSourcesOf(r.effectiveBasis, `session ${r.sessionId} effectiveBasis`)),
    claudeSessionIdsJson: canonicalDelegationJson(stringListOf(r.claudeSessionIds, `session ${r.sessionId} claudeSessionIds`)),
    firstObservedAt: instantMs(r.firstObservedAt),
    lastObservedAt: instantMs(r.lastObservedAt),
  }),
  fromDb: (raw) => {
    const r = readers('delegation_sessions', raw);
    return {
      sessionId: r.text('sessionId'), parentIncarnation: r.text('parentIncarnation'),
      explicitIntentAt: r.instantOrNull('explicitIntentAt'), effective: r.flag('effective'),
      effectiveBasis: r.sourceList('effectiveBasisJson'), claudeSessionIds: r.stringList('claudeSessionIdsJson'),
      firstObservedAt: r.instant('firstObservedAt'), lastObservedAt: r.instant('lastObservedAt'),
    };
  },
};

const ATTEMPT_COLUMNS = [
  'attemptId', 'parentId', 'parentIncarnation', 'project', 'adminRecord', 'canonicalPath', 'attemptedAt', 'rung', 'verdict',
  'evidenceJournalIdsJson', 'detail',
] as const;
export const delegationAttemptCodec: DelegationRowCodec<DelegationAttemptRow, (typeof ATTEMPT_COLUMNS)[number]> = {
  table: 'delegation_attempts',
  columns: ATTEMPT_COLUMNS,
  toDb: (r) => ({
    attemptId: r.attemptId, parentId: r.parentId, parentIncarnation: r.parentIncarnation, project: r.project,
    adminRecord: r.adminRecord, canonicalPath: r.canonicalPath, attemptedAt: instantMs(r.attemptedAt), rung: r.rung,
    verdict: r.verdict,
    evidenceJournalIdsJson: canonicalDelegationJson(stringListOf(r.evidenceJournalIds, `attempt ${r.attemptId} evidenceJournalIds`)),
    detail: r.detail,
  }),
  fromDb: (raw) => {
    const r = readers('delegation_attempts', raw);
    const rungRaw = r.intOrNull('rung');
    const rung = rungRaw === null ? null : rungRaw === 1 || rungRaw === 2 || rungRaw === 3 || rungRaw === 4 ? rungRaw
      : unreadable('delegation_attempts', 'rung', 'expected 1 to 4');
    return {
      attemptId: r.text('attemptId'), parentId: r.text('parentId'), parentIncarnation: r.text('parentIncarnation'),
      project: r.text('project'), adminRecord: r.text('adminRecord'), canonicalPath: r.textOrNull('canonicalPath'),
      attemptedAt: r.instant('attemptedAt'), rung, verdict: r.member('verdict', DELEGATION_ATTEMPT_VERDICTS),
      evidenceJournalIds: r.stringList('evidenceJournalIdsJson'), detail: r.textOrNull('detail'),
    };
  },
};

const ACTIVITY_COLUMNS = [
  'activityId', 'parentId', 'parentIncarnation', 'sourceKind', 'upstreamId', 'identityJournalId', 'displayName',
  'executionState', 'openedAt', 'endedAt', 'lastEventAt',
] as const;
export const delegationActivityCodec: DelegationRowCodec<DelegationActivityRow, (typeof ACTIVITY_COLUMNS)[number]> = {
  table: 'delegation_activities',
  columns: ACTIVITY_COLUMNS,
  toDb: (r) => ({
    activityId: r.activityId, parentId: r.parentId, parentIncarnation: r.parentIncarnation, sourceKind: r.sourceKind,
    upstreamId: r.upstreamId, identityJournalId: r.identityJournalId, displayName: r.displayName,
    executionState: r.executionState, openedAt: instantMs(r.openedAt), endedAt: instantMsOrNull(r.endedAt),
    lastEventAt: instantMs(r.lastEventAt),
  }),
  fromDb: (raw) => {
    const r = readers('delegation_activities', raw);
    return {
      activityId: r.text('activityId'), parentId: r.text('parentId'), parentIncarnation: r.text('parentIncarnation'),
      sourceKind: r.member('sourceKind', DELEGATION_ACTIVITY_SOURCE_KINDS), upstreamId: r.text('upstreamId'),
      identityJournalId: r.text('identityJournalId'), displayName: r.textOrNull('displayName'),
      executionState: r.member('executionState', DELEGATION_EXECUTION_STATES), openedAt: r.instant('openedAt'),
      endedAt: r.instantOrNull('endedAt'), lastEventAt: r.instant('lastEventAt'),
    };
  },
};

const LEASE_COLUMNS = [
  'leaseId', 'generation', 'creatingJournalSequence', 'currentJournalSequence', 'activityId', 'parentId', 'parentIncarnation',
  'project', 'adminRecord', 'canonicalPath', 'creationBase', 'sourceKind', 'parentageState', 'workspaceState', 'disposition',
  'cleanupState', 'cleanupPopulation', 'firstObservedAt', 'lastObservedAt', 'terminalEvidenceAt', 'adoptedAt', 'retainedAt',
  'promotedAt', 'cleanupDueAt', 'cleanupStartedAt', 'cleanupFinishedAt', 'cleanupEvidenceJson', 'carrierGenerationSeen',
  'releasedAt',
] as const;
export const delegationLeaseCodec: DelegationRowCodec<DelegationLeaseRow, (typeof LEASE_COLUMNS)[number]> = {
  table: 'delegation_leases',
  columns: LEASE_COLUMNS,
  toDb: (r) => ({
    leaseId: r.leaseId, generation: r.generation, creatingJournalSequence: r.creatingJournalSequence,
    currentJournalSequence: r.currentJournalSequence, activityId: r.activityId, parentId: r.parentId,
    parentIncarnation: r.parentIncarnation, project: r.project, adminRecord: r.adminRecord, canonicalPath: r.canonicalPath,
    creationBase: r.creationBase, sourceKind: r.sourceKind, parentageState: r.parentageState,
    workspaceState: r.workspaceState, disposition: r.disposition, cleanupState: r.cleanupState,
    cleanupPopulation: r.cleanupPopulation, firstObservedAt: instantMs(r.firstObservedAt),
    lastObservedAt: instantMs(r.lastObservedAt), terminalEvidenceAt: instantMsOrNull(r.terminalEvidenceAt),
    adoptedAt: instantMsOrNull(r.adoptedAt), retainedAt: instantMsOrNull(r.retainedAt),
    promotedAt: instantMsOrNull(r.promotedAt), cleanupDueAt: instantMsOrNull(r.cleanupDueAt),
    cleanupStartedAt: instantMsOrNull(r.cleanupStartedAt), cleanupFinishedAt: instantMsOrNull(r.cleanupFinishedAt),
    cleanupEvidenceJson: r.cleanupEvidenceJson, carrierGenerationSeen: r.carrierGenerationSeen,
    releasedAt: instantMsOrNull(r.releasedAt),
  }),
  fromDb: (raw) => {
    const r = readers('delegation_leases', raw);
    return {
      leaseId: r.text('leaseId'), generation: r.int('generation'), creatingJournalSequence: r.int('creatingJournalSequence'),
      currentJournalSequence: r.int('currentJournalSequence'), activityId: r.text('activityId'), parentId: r.text('parentId'),
      parentIncarnation: r.text('parentIncarnation'), project: r.text('project'), adminRecord: r.text('adminRecord'),
      canonicalPath: r.text('canonicalPath'), creationBase: r.textOrNull('creationBase'),
      sourceKind: r.member('sourceKind', DELEGATION_LEASE_SOURCE_KINDS),
      parentageState: r.member('parentageState', DELEGATION_PARENTAGE_STATES),
      workspaceState: r.member('workspaceState', DELEGATION_WORKSPACE_STATES),
      disposition: r.member('disposition', DELEGATION_DISPOSITIONS),
      cleanupState: r.member('cleanupState', DELEGATION_CLEANUP_STATES),
      cleanupPopulation: r.member('cleanupPopulation', DELEGATION_CLEANUP_POPULATIONS),
      firstObservedAt: r.instant('firstObservedAt'), lastObservedAt: r.instant('lastObservedAt'),
      terminalEvidenceAt: r.instantOrNull('terminalEvidenceAt'), adoptedAt: r.instantOrNull('adoptedAt'),
      retainedAt: r.instantOrNull('retainedAt'), promotedAt: r.instantOrNull('promotedAt'),
      cleanupDueAt: r.instantOrNull('cleanupDueAt'), cleanupStartedAt: r.instantOrNull('cleanupStartedAt'),
      cleanupFinishedAt: r.instantOrNull('cleanupFinishedAt'), cleanupEvidenceJson: r.textOrNull('cleanupEvidenceJson'),
      carrierGenerationSeen: r.intOrNull('carrierGenerationSeen'), releasedAt: r.instantOrNull('releasedAt'),
    };
  },
};

const LINEAGE_COLUMNS = [
  'lineageId', 'parentId', 'parentIncarnation', 'activityId', 'leaseId', 'runId', 'openedAt', 'closedAt', 'closeReason',
] as const;
export const delegationLineageCodec: DelegationRowCodec<DelegationLineageRow, (typeof LINEAGE_COLUMNS)[number]> = {
  table: 'delegation_lineage',
  columns: LINEAGE_COLUMNS,
  toDb: (r) => ({
    lineageId: r.lineageId, parentId: r.parentId, parentIncarnation: r.parentIncarnation, activityId: r.activityId,
    leaseId: r.leaseId, runId: r.runId, openedAt: instantMs(r.openedAt), closedAt: instantMsOrNull(r.closedAt),
    closeReason: r.closeReason,
  }),
  fromDb: (raw) => {
    const r = readers('delegation_lineage', raw);
    return {
      lineageId: r.text('lineageId'), parentId: r.text('parentId'), parentIncarnation: r.text('parentIncarnation'),
      activityId: r.textOrNull('activityId'), leaseId: r.textOrNull('leaseId'), runId: r.intOrNull('runId'),
      openedAt: r.instant('openedAt'), closedAt: r.instantOrNull('closedAt'), closeReason: r.textOrNull('closeReason'),
    };
  },
};

const EVENT_COLUMNS = [
  'eventId', 'journalSequence', 'journalDigest', 'acceptedAt', 'sessionId', 'parentIncarnation', 'claudeSessionId',
  'eventKind', 'observedAt', 'payloadJson',
] as const;
const badEvent = (why: string): never => { throw new DelegationModelError('bad-event', why); };
export const delegationEventCodec: DelegationRowCodec<DelegationEventRow, (typeof EVENT_COLUMNS)[number]> = {
  table: 'delegation_events',
  columns: EVENT_COLUMNS,
  // The one codec whose WRITE side validates: `insertDelegationEvent` is called once per accepted event with a row the
  // caller built, not with a checkpoint that was validated as a whole.
  toDb: (r) => {
    if (typeof r.eventId !== 'string' || r.eventId === '') badEvent('eventId is empty');
    if (!Number.isSafeInteger(r.journalSequence) || r.journalSequence < 1) badEvent('journalSequence is not a positive integer');
    if (!isLowerHex64(r.journalDigest)) badEvent('journalDigest is not a lowercase 64-hex SHA-256');
    if (!isMember(DELEGATION_EVENT_KINDS, r.eventKind)) badEvent('eventKind is not a delegation event kind');
    let payload: unknown;
    try { payload = JSON.parse(r.payloadJson); } catch { return badEvent('payloadJson is not JSON'); }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) badEvent('payloadJson is not a JSON object');
    return {
      eventId: r.eventId, journalSequence: r.journalSequence, journalDigest: r.journalDigest,
      acceptedAt: instantMs(r.acceptedAt), sessionId: r.sessionId, parentIncarnation: r.parentIncarnation,
      claudeSessionId: r.claudeSessionId, eventKind: r.eventKind, observedAt: instantMs(r.observedAt),
      payloadJson: r.payloadJson,
    };
  },
  fromDb: (raw) => {
    const r = readers('delegation_events', raw);
    return {
      eventId: r.text('eventId'), journalSequence: r.int('journalSequence'), journalDigest: r.text('journalDigest'),
      acceptedAt: r.instant('acceptedAt'), sessionId: r.text('sessionId'), parentIncarnation: r.text('parentIncarnation'),
      claudeSessionId: r.text('claudeSessionId'), eventKind: r.member('eventKind', DELEGATION_EVENT_KINDS),
      observedAt: r.instant('observedAt'), payloadJson: r.text('payloadJson'),
    };
  },
};

// ── The projection view ───────────────────────────────────────────────────────────────────────────────────────────────

/** SQLite's BINARY collation, in JS: memcmp over the UTF-8 bytes. (UTF-16 order differs for characters above the BMP.) */
const utf8Compare = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

/** The five projected row sets, each in the order the store reads them: by primary key, in UTF-8 byte order. */
export interface DelegationProjectionRows {
  sessions: readonly DelegationSessionRow[];
  attempts: readonly DelegationAttemptRow[];
  activities: readonly DelegationActivityRow[];
  leases: readonly DelegationLeaseRow[];
  lineage: readonly DelegationLineageRow[];
}

const sorted = <T>(rows: readonly T[], compare: (a: T, b: T) => number): T[] => [...rows].sort(compare);

/** The rows of a checkpoint in the order `readDelegationProjection` reads each table. */
export function sortedProjectionRows(rows: DelegationProjectionRows): DelegationProjectionRows {
  return {
    sessions: sorted(rows.sessions, (a, b) => utf8Compare(a.sessionId, b.sessionId) || utf8Compare(a.parentIncarnation, b.parentIncarnation)),
    attempts: sorted(rows.attempts, (a, b) => utf8Compare(a.attemptId, b.attemptId)),
    activities: sorted(rows.activities, (a, b) => utf8Compare(a.activityId, b.activityId)),
    leases: sorted(rows.leases, (a, b) => utf8Compare(a.leaseId, b.leaseId)),
    lineage: sorted(rows.lineage, (a, b) => utf8Compare(a.lineageId, b.lineageId)),
  };
}

/**
 * THE KEY OF `coordinatorIntentByParent`, spelled once: a parent is (ccd session id, registry incarnation) (spec §5.1), so the
 * map holds one entry per PAIR, never one per session id. The encoding is `lengthPrefixed(sessionId) + lengthPrefixed(incarnation)`,
 * the spelling `encodeDelegationNaturalKey` already gives the persisted `activityIdsByNaturalKey`: each part is its UTF-8 byte
 * count, a colon, then the part, so the concatenation parses back into exactly one pair whatever either string holds. A delimiter
 * join cannot say that (ids may hold `-`, `_`, `.`, and a recreated id's incarnation is a free string), and a JSON array would
 * spell the same facts with escapes. The key is never a bare session id (it starts with a digit and a colon, and ids are not that
 * shape), so a map written under the old session-id-only spelling is refused by the validator rather than half-read.
 *
 * Every writer and reader of the map goes through this function: `deriveCoordinatorIntentByParent`, the validator behind it, the
 * intent route's `declareCoordinatorIntent`, and the tests. Nothing else spells a key.
 */
export function delegationIntentKey(sessionId: string, parentIncarnation: string): string {
  return lengthPrefixed(sessionId) + lengthPrefixed(parentIncarnation);
}

/**
 * The coordinator-intent map the session rows say: one entry per (session id, incarnation) whose row carries an
 * `explicitIntentAt`, keyed by `delegationIntentKey`. A declaration belongs to the incarnation that made it: a later incarnation
 * of the same id inherits none (its own entry is its own), and clearing one incarnation removes only its key. The rows are unique
 * by that pair, so there is nothing to fold. This is the one statement of what `coordinatorIntentByParent` must agree with, shared
 * by the drift view above and by `assertDelegationCheckpointIdentity`.
 */
export function deriveCoordinatorIntentByParent(sessions: readonly DelegationSessionRow[]): Record<string, string> {
  return Object.fromEntries(sessions.flatMap((s): Array<[string, string]> =>
    (s.explicitIntentAt === null ? [] : [[delegationIntentKey(s.sessionId, s.parentIncarnation), s.explicitIntentAt]])));
}

/** What a session can say about its own coordinator intent. Declared once: the intent route reads it, and so does its test. */
export const COORDINATOR_INTENT_ACTIONS = ['set', 'clear'] as const;
export type CoordinatorIntentAction = (typeof COORDINATOR_INTENT_ACTIONS)[number];

/** The one answer of the intent route that no vocabulary already admitted spells: the session's incarnation moved while the
 *  declaration was queued, so it landed on the previous one. A TOTAL table (read by `isDelegationModelKebab`, so the route's literal
 *  is admitted and a typo is not). A refusal of the request, never of the checkpoint: nothing is undone. */
export const COORDINATOR_INTENT_REFUSALS: Readonly<Record<'incarnation-changed', true>> = { 'incarnation-changed': true };

export interface CoordinatorIntentRequest {
  action: CoordinatorIntentAction;
  sessionId: string;
  /** The session's CURRENT registry incarnation, measured by the caller. The only row the declaration may touch. */
  parentIncarnation: string;
  /** A canonical instant. `set` stamps it only on a row that carries no declaration yet; `clear` ignores it. */
  declaredAt: string;
}

/**
 * The checkpoint a coordinator-intent declaration (Task 15) stands for. PURE: the input is never edited, the next checkpoint is
 * built beside it, and the route hands this to the lane's own `applyCheckpointChange`, so the declaration becomes visible only
 * once that replacement is durable.
 *
 * ONE ROW, THE CURRENT INCARNATION'S. A different incarnation of the same session, and every other session, come back untouched:
 * an earlier incarnation's declaration is history that a later one neither mutates nor erases.
 *
 *   `set`    stamps `explicitIntentAt` with `declaredAt` unless the row already carries one (so a repeat is a no-op, not a new
 *            instant), adds `explicit` to the effective basis in the vocabulary's own order, and makes the row effective. A
 *            session that has not been observed yet gets a row of its own, observed (first and last) at the declaration, because
 *            a coordinator declares before it delegates, which is before any spool event could have made one.
 *   `clear`  removes the declaration and the `explicit` basis and NOTHING ELSE: `run-owner`, `delegation-inferred` and
 *            `retained-lineage` stay, and so does the effective identity they give. The row stays, because wave 3 never removes a
 *            session from the checkpoint. A clear for a session with no row creates none.
 *
 * `coordinatorIntentByParent` is rebuilt from the rows by `deriveCoordinatorIntentByParent`, the one statement of its key
 * (`delegationIntentKey`, one entry per (session, incarnation)) and its value, in the same checkpoint; the validator refuses a map
 * that disagrees with the rows. So `set` adds only the current incarnation's key, `clear` removes only that key, and a
 * historical incarnation's entry stays exactly as it was.
 */
export function declareCoordinatorIntent(
  checkpoint: DeepReadonly<DelegationCheckpointV1>, request: CoordinatorIntentRequest,
): DelegationCheckpointV1 {
  parseDelegationInstant(request.declaredAt);
  const at = checkpoint.sessions.findIndex((s) => s.sessionId === request.sessionId && s.parentIncarnation === request.parentIncarnation);
  const found: DelegationSessionRow | null = at === -1 ? null : checkpoint.sessions[at]!;
  const basisWith = (explicit: boolean): DelegationIntentSource[] =>
    DELEGATION_INTENT_SOURCES.filter((source) => (source === 'explicit' ? explicit : found !== null && found.effectiveBasis.includes(source)));
  let next: DelegationSessionRow | null;
  if (request.action === 'set') {
    next = found === null
      ? {
          sessionId: request.sessionId, parentIncarnation: request.parentIncarnation, explicitIntentAt: request.declaredAt, effective: true,
          effectiveBasis: basisWith(true), claudeSessionIds: [], firstObservedAt: request.declaredAt, lastObservedAt: request.declaredAt,
        }
      : { ...found, explicitIntentAt: found.explicitIntentAt ?? request.declaredAt, effective: true, effectiveBasis: basisWith(true) };
  } else {
    const remaining = basisWith(false);
    next = found === null ? null : { ...found, explicitIntentAt: null, effective: remaining.length > 0, effectiveBasis: remaining };
  }
  const sessions: DelegationSessionRow[] = checkpoint.sessions.map((s, i) => (i === at && next !== null ? next : s));
  if (at === -1 && next !== null) sessions.push(next);
  return { ...checkpoint, sessions, coordinatorIntentByParent: deriveCoordinatorIntentByParent(sessions) };
}

/**
 * Assembles the checkpoint a set of PROJECTED rows stands for. Only what the rows can say is filled in:
 *   - `activityIdsByNaturalKey` is derived from the activity rows (each carries its own natural key);
 *   - `coordinatorIntentByParent` is derived from the session rows' `explicitIntentAt`, one entry per (session, incarnation);
 *   - everything the checkpoint alone holds — the revision and the applied-journal anchor, the bucket cursors, the
 *     observation intervals, the pruning holds — comes back empty, zero or null. NONE OF THAT IS EVER READ BACK AS
 *     AUTHORITY: the round trip through SQLite is a drift check, not a read path.
 */
export function delegationCheckpointOfProjection(rows: DelegationProjectionRows): DelegationCheckpointV1 {
  return {
    ...emptyDelegationCheckpoint(),
    activityIdsByNaturalKey: Object.fromEntries(rows.activities.map((a) => [encodeDelegationNaturalKey(a), a.activityId])),
    coordinatorIntentByParent: deriveCoordinatorIntentByParent(rows.sessions),
    sessions: rows.sessions, attempts: rows.attempts, activities: rows.activities, leases: rows.leases, lineage: rows.lineage,
  };
}

/** What a checkpoint looks like once it has been projected and read back: `delegationCheckpointOfProjection` over its
 *  rows in read order. A drift check compares this, canonically, with `readDelegationProjection()`. */
export function projectionViewOfDelegationCheckpoint(checkpoint: DelegationCheckpointV1): DelegationCheckpointV1 {
  return delegationCheckpointOfProjection(sortedProjectionRows(checkpoint));
}

/**
 * One table's part of `diffDelegationProjection`. Rows are matched by key; a key held twice in either checkpoint, or held by
 * `prior` and not by `next`, is not a delta (`reason`). A row that is the same object in both is unchanged (a fast path only);
 * otherwise both are encoded by the codec and compared column by column, over the codec's own column list, so an encode refusal
 * (`bad-row`, `bad-instant`) fires here exactly as it does in the full projection. `frozen` names the rows this table may not
 * change or add in a delta at all. A row's key is spelled once, by `keyColumns` (the column's own name is the row's property):
 * a single column is its text, several are the JSON list of their values.
 */
function diffProjectionTable<Row, Col extends string>(
  codec: DelegationRowCodec<Row, Col>, keyColumns: readonly (Col & keyof Row)[],
  frozen: (prior: Row | undefined, next: Row) => boolean, prior: readonly Row[], next: readonly Row[],
): { reason: string } | { updates: DelegationProjectionUpdate[]; inserts: DelegationProjectionInsert[] } {
  const keyOf = (row: Row): string => {
    const parts = keyColumns.map((c) => row[c]);
    return parts.length === 1 ? String(parts[0]) : JSON.stringify(parts);
  };
  const priorByKey = new Map<string, Row>();
  for (const r of prior) {
    const k = keyOf(r);
    if (priorByKey.has(k)) return { reason: `${codec.table}: the prior checkpoint holds the key ${k} twice` };
    priorByKey.set(k, r);
  }
  const nextKeys = new Set<string>();
  for (const r of next) {
    const k = keyOf(r);
    if (nextKeys.has(k)) return { reason: `${codec.table}: the checkpoint holds the key ${k} twice` };
    nextKeys.add(k);
  }
  for (const k of priorByKey.keys()) if (!nextKeys.has(k)) return { reason: `${codec.table}: the row ${k} leaves` };
  const updates: DelegationProjectionUpdate[] = [];
  const inserts: DelegationProjectionInsert[] = [];
  for (const r of next) {
    const p = priorByKey.get(keyOf(r));
    if (p === r) continue;
    if (p === undefined) {
      if (frozen(undefined, r)) return { reason: `${codec.table}: a new row is not a delta here` };
      inserts.push({ table: codec.table, values: codec.toDb(r) });
      continue;
    }
    const after = codec.toDb(r);
    const before = codec.toDb(p);
    if (codec.columns.every((c) => before[c] === after[c])) continue;
    if (frozen(p, r)) return { reason: `${codec.table}: a changed row is not a delta here` };
    updates.push({ table: codec.table, keyColumns, prior: before, next: after });
  }
  return { updates, inserts };
}

/**
 * What a store must write to move a projection of `prior` to a projection of `next`, when that is only additions and updates:
 * a row both hold under one key whose encoded columns differ is an UPDATE, a row only `next` holds is an INSERT (parents first),
 * and `counts` is `next`'s length for each of the five tables. Pure: it reads nothing but its two arguments.
 *
 * NOT APPLICABLE (the caller projects in full) when any key `prior` holds is missing from `next`, in any table; when any lease row
 * differs or is new; when a lineage row owned by a lease, in `prior` or in `next`, differs, is new or leaves (a lease and its
 * lineage move together); or when a key repeats inside either checkpoint (so the full path gives its own answer for a corrupt
 * checkpoint). Keys: sessions (`sessionId`, `parentIncarnation`), activities `activityId`, attempts `attemptId`, leases `leaseId`,
 * lineage `lineageId`. Throws `bad-row` or `bad-instant` from the codec for a changed or new row it cannot encode. The tables are
 * diffed in that order and the first to decline ends the diff, so a table after it is never encoded.
 */
export function diffDelegationProjection(prior: DelegationCheckpointV1, next: DelegationCheckpointV1): DelegationProjectionDiff {
  const updates: DelegationProjectionUpdate[] = [];
  const inserts: DelegationProjectionInsert[] = [];
  // Lazy and in checkpoint order, as the full path encodes: the first table that declines ends the diff, so the rows of the tables
  // after it are never encoded and a doubly-corrupt checkpoint is answered by the full path, not by this one.
  const tables: ReadonlyArray<() => ReturnType<typeof diffProjectionTable>> = [
    () => diffProjectionTable(delegationSessionCodec, ['sessionId', 'parentIncarnation'], () => false, prior.sessions, next.sessions),
    () => diffProjectionTable(delegationActivityCodec, ['activityId'], () => false, prior.activities, next.activities),
    () => diffProjectionTable(delegationAttemptCodec, ['attemptId'], () => false, prior.attempts, next.attempts),
    () => diffProjectionTable(delegationLeaseCodec, ['leaseId'], () => true, prior.leases, next.leases),
    () => diffProjectionTable(delegationLineageCodec, ['lineageId'],
      (p, n) => (p !== undefined && p.leaseId !== null) || n.leaseId !== null, prior.lineage, next.lineage),
  ];
  for (const table of tables) {
    const part = table();
    if ('reason' in part) return { applicable: false, reason: part.reason };
    updates.push(...part.updates);
    inserts.push(...part.inserts);
  }
  const counts = [
    { table: delegationSessionCodec.table, count: next.sessions.length },
    { table: delegationActivityCodec.table, count: next.activities.length },
    { table: delegationAttemptCodec.table, count: next.attempts.length },
    { table: delegationLeaseCodec.table, count: next.leases.length },
    { table: delegationLineageCodec.table, count: next.lineage.length },
  ];
  return { applicable: true, updates, inserts, counts };
}

/**
 * Everything the store's delta method refuses BEFORE its transaction, in the full projection's own order and with its own codes and
 * messages (the full projection's twin checks, so the two refuse a bad checkpoint the same way): the version, the applied position,
 * the wave-3 lease invariants, then `diffDelegationProjection(prior, next)` (which throws `bad-row` or `bad-instant` for a changed or
 * new row it cannot encode). A diff that is not applicable is returned at once: a session key repeated inside `next` is such a diff,
 * so the full path, which the store then runs, gives its own answer for it. Pure; returns the diff the store then writes or, when it is
 * not applicable, replaces by the full projection.
 */
export function prepareDelegationProjectionChanges(prior: DelegationCheckpointV1, next: DelegationCheckpointV1): DelegationProjectionDiff {
  if (next.v !== 1) throw new DelegationModelError('bad-checkpoint', `version ${String(next.v)} is not a version-1 checkpoint`);
  const applied = next.appliedJournalSequence;
  if (!Number.isSafeInteger(applied) || applied < 0) throw new DelegationModelError('bad-checkpoint', `appliedJournalSequence ${String(applied)} is not a non-negative integer`);
  assertWave3Leases(next);
  return diffDelegationProjection(prior, next);
}

/** D-6190: an attempt's DECISION key: every column except its clock (`attemptedAt`) and its witnesses (`evidenceJournalIds`). */
export function delegationAttemptKeyOf(a: Pick<DelegationAttemptRow, 'parentId' | 'parentIncarnation' | 'project' | 'adminRecord' | 'canonicalPath' | 'rung' | 'verdict' | 'detail'>): string {
  return canonicalDelegationJson([a.parentId, a.parentIncarnation, a.project, a.adminRecord, a.canonicalPath, a.rung, a.verdict, a.detail]);
}
const earlierAttempt = (x: DelegationAttemptRow, y: DelegationAttemptRow): boolean => {
  const tx = parseDelegationInstant(x.attemptedAt), ty = parseDelegationInstant(y.attemptedAt);
  return tx !== ty ? tx < ty : utf8Compare(x.attemptId, y.attemptId) < 0;
};
/** D-6190: the attempts on file by decision key, keeping the EARLIEST row of each key (the smallest attemptedAt; a tie goes to the
 *  smaller attemptId under utf8Compare): the row the fixed keying would have filed, with its first filing's evidence. */
export function delegationAttemptsByKey(attempts: readonly DelegationAttemptRow[]): Map<string, DelegationAttemptRow> {
  const out = new Map<string, DelegationAttemptRow>();
  for (const a of attempts) {
    const k = delegationAttemptKeyOf(a);
    const kept = out.get(k);
    if (kept === undefined || earlierAttempt(a, kept)) out.set(k, a);
  }
  return out;
}
/** D-6191: one row per decision key, the earliest kept, the rest removed, relative order kept. The SAME array, and removed 0, when no key
 *  repeats (as `upkeepDelegationIntervals` does), so a caller can tell there is nothing to do without a change. */
export function collapseDelegationAttempts(attempts: readonly DelegationAttemptRow[]): { attempts: readonly DelegationAttemptRow[]; removed: number } {
  const kept = delegationAttemptsByKey(attempts);
  if (kept.size === attempts.length) return { attempts, removed: 0 };
  const keep = new Set([...kept.values()].map((a) => a.attemptId));
  return { attempts: attempts.filter((a) => keep.has(a.attemptId)), removed: attempts.length - kept.size };
}

/** D-6267: whether two Bash worktree listings name the same admin records. SET semantics: order and duplicates are ignored. This is
 *  exactly correlation's zero delta (`listingDeltaOf`, delegation-correlation.ts), so every window rung 4 can call `mine`
 *  is an unequal one. The ONE definition: rule A's decision and the retirement fact both call it. */
export function delegationListingsEqual(before: readonly string[], after: readonly string[]): boolean {
  const b = new Set(before);
  const a = new Set(after);
  if (a.size !== b.size) return false;
  for (const n of a) if (!b.has(n)) return false;
  return true;
}

// ── THE OBSERVATION HEALTH (wave 3, Task 13; spec §7 stage 2) ─────────────────────────────────────────────────────────
//
// Pure arithmetic from the CHECKPOINT's `observationIntervals` and nothing else. The interval rows are checkpoint-owned: SQLite carries
// none (`readDelegationProjection` returns them empty), so a health built from SQLite would lose every session-hour a lost `coord.db`
// loses, and one built from a clock here would drift against the rows it counts. Time comes in as `nowMs`.
//
//   THE WINDOW. The 168 complete UTC hours that end at the start of the current hour. A session-hour is a row keyed
//   (session, incarnation, hour); a row is `measured` when the lane read the hour's bucket (or proved it empty) and `unmeasured` when
//   it could not, and `unmeasured` is sticky (`mergeDelegationObservationInterval`). The window is COMPLETE only when every one of its
//   168 hours has at least one row: an hour with none is an hour the lane did not run, and the gate must not read it as a quiet fleet.
//
//   THE GATE. `eligible` only for a complete window, a measured capability, a readable registry, a ready recovery and a non-zero
//   denominator, with strictly fewer than 1% of the session-hours unmeasured: `unmeasured * 100 < total`, in integers, so 0.99% is in
//   and exactly 1.00% is out whatever a float would say. Every other basis is `unmeasured`, with a null rate: unavailable is not zero
//   and not healthy (W3-M57). Eligibility activates nothing; waves 4 to 7 are gated separately.

/** The `ccd caps` token that says a fleet writes the delegation spool: the grammar and the ccd-made owner directories. Spelled ONCE in
 *  `server/src`; ccd's `echo delegation-events-v1` and `delegation-spool.test.ts` are the other spellings. The hook's registration is
 *  the doctor's to measure, not this token's. */
export const DELEGATION_EVENTS_CAP = 'delegation-events-v1';

/** Whether the fleet offers the capability, read the way the docs reader reads its own: a list that is a `ccd caps` answer (it names
 *  `caps` itself) and lacks the token is `absent` (an old fleet); no list, or a list that is not such an answer (an agent whose boot
 *  read failed seeds `[]`), is `unmeasured`. The token alone is evidence it is offered. */
export function delegationCapabilityState(ccdVerbs: readonly string[] | null | undefined): DelegationHealthInput['capabilityState'] {
  if (ccdVerbs === null || ccdVerbs === undefined) return 'unmeasured';
  if (ccdVerbs.includes(DELEGATION_EVENTS_CAP)) return 'present';
  return ccdVerbs.includes('caps') ? 'absent' : 'unmeasured';
}

export const DELEGATION_HOUR_MS = 3_600_000;
/** Seven days of whole UTC hours. */
export const DELEGATION_HEALTH_WINDOW_HOURS = 7 * 24;
/** The same window in milliseconds: spec §5.3's seven-day observation window, which the soak gate reads. A quantity of its own (R81), not
 *  the box-token rotation interval, so it never imports that. */
export const DELEGATION_HEALTH_WINDOW_MS = DELEGATION_HEALTH_WINDOW_HOURS * DELEGATION_HOUR_MS;
/** What the checkpoint keeps: the window and one more day, so the window never rolls onto a row that was just pruned. */
export const DELEGATION_INTERVAL_RETENTION_HOURS = DELEGATION_HEALTH_WINDOW_HOURS + 24;
/** How long after an hour ends a hook may still append to its bucket (it names the bucket when it starts, and writes a moment later). */
export const DELEGATION_HOUR_CLOSE_MARGIN_MS = 120_000;
/** How long the hook keeps a bucket (it prunes at 24 to 25 hours): the lookback the lane reads, and the age past which an unclosed hour
 *  can never be closed. */
export const DELEGATION_SPOOL_LOOKBACK_HOURS = 24;
/** The incarnation a session-hour is keyed under when the parent's incarnation could not be measured (absent, unreadable, changing):
 *  there is no real one to name, and the row must exist so the hour counts. */
export const DELEGATION_UNMEASURED_INCARNATION = 'unmeasured';

const HEALTH_MODE = 'report-only' as const satisfies DelegationObservationHealth['mode'];
/** The detail of an interval upkeep turned into a gap: an hour recorded before it ended, whose bucket is gone before it was closed. */
export const DELEGATION_HOUR_NEVER_CLOSED = 'hour-never-closed';
/** The two unmeasured-hour words that are CARVE-OUTS and not losses (R84, R90), defined once HERE and imported by the lane, by the
 *  checkpoint's interval merge and by the bucket reader, whose unreadable vocabulary (`DELEGATION_BUCKET_UNREADABLE_REASONS`) is built from
 *  them. `directory-absent` names an owner whose spool directory does not exist (it vetoes only for an owner that had a spool);
 *  `capability-absent` names a fleet that offers no delegation events (it never vetoes). Every other unmeasured word is a LOSS word. */
export const DELEGATION_HOUR_NO_SPOOL = 'directory-absent';
export const DELEGATION_HOUR_NO_CAPABILITY = 'capability-absent';
/** Whether an unmeasured hour's detail begins with a carve-out word (a null detail is not one). */
export function isDelegationHourCarveOut(detail: string | null): boolean {
  return detail !== null && (detail.startsWith(DELEGATION_HOUR_NO_SPOOL) || detail.startsWith(DELEGATION_HOUR_NO_CAPABILITY));
}

/** The words this section spells, as a TOTAL table, for the coordination scanner's guard. */
const DELEGATION_HEALTH_WORDS: Readonly<Record<typeof HEALTH_MODE | typeof DELEGATION_HOUR_NEVER_CLOSED, true>> = {
  [HEALTH_MODE]: true, [DELEGATION_HOUR_NEVER_CLOSED]: true,
};

const hourFloor = (ms: number): number => Math.floor(ms / DELEGATION_HOUR_MS) * DELEGATION_HOUR_MS;

/** An interval's hour as epoch milliseconds, or null when it is not a canonical instant on an hour boundary (it cannot be placed). */
function intervalHourMs(utcHour: string): number | null {
  try {
    const at = parseDelegationInstant(utcHour);
    return at % DELEGATION_HOUR_MS === 0 ? at : null;
  } catch (err) {
    if (err instanceof DelegationModelError) return null;
    throw err;
  }
}

export interface DelegationHealthWindow {
  windowStartedAt: string;
  windowEndedAt: string;
  measuredSessionHours: number;
  unmeasuredSessionHours: number;
  complete: boolean;
}

/** The rolling window over a set of interval rows. A row that cannot be placed makes the window incomplete, not smaller. */
export function delegationHealthWindowOf(intervals: readonly DelegationObservationInterval[], nowMs: number): DelegationHealthWindow {
  const endMs = hourFloor(nowMs);
  const startMs = endMs - DELEGATION_HEALTH_WINDOW_MS;
  const covered = new Set<number>();
  // A session-hour is a (session, UTC hour), whatever incarnations or reasons recorded it (R60; spec §7: "session-hours with an
  // `unmeasured` interval"): any unmeasured row makes it unmeasured, so a second row for one session-hour never inflates the
  // denominator and never turns a gap into a measurement.
  const sessionHours = new Map<string, boolean>();
  let placeable = true;
  for (const r of intervals) {
    const at = intervalHourMs(r.utcHour);
    if (at === null) { placeable = false; continue; }
    if (at < startMs || at >= endMs) continue;
    covered.add(at);
    const key = JSON.stringify([r.sessionId, at]);
    sessionHours.set(key, (sessionHours.get(key) ?? false) || r.state !== 'measured');
  }
  let measuredHours = 0;
  let unmeasuredHours = 0;
  for (const unmeasured of sessionHours.values()) { if (unmeasured) unmeasuredHours += 1; else measuredHours += 1; }
  return {
    windowStartedAt: formatDelegationInstant(startMs), windowEndedAt: formatDelegationInstant(endMs),
    measuredSessionHours: measuredHours, unmeasuredSessionHours: unmeasuredHours,
    complete: placeable && covered.size === DELEGATION_HEALTH_WINDOW_HOURS,
  };
}

/**
 * What the health is computed from, assembled from the applier's state and the measurements the server holds. A state that is not
 * `ready` (or none at all, when the applier never opened) is not trusted for a single row: its counts are zero, its window is
 * incomplete and its anchors are null. `verdictCounts` are the last reconciliation pass's VERDICTS, never attempt rows.
 */
export function delegationHealthInputOf(src: {
  nowMs: number;
  state: DeepReadonly<DelegationRecoveryState> | null;
  capabilityState: DelegationHealthInput['capabilityState'];
  registryReadable: boolean;
  circuitBreaker: DelegationHealthInput['circuitBreaker'];
  verdictCounts: { unresolved: number; conflicting: number; unmeasured: number };
}): DelegationHealthInput {
  const cp = src.state !== null && src.state.phase === 'ready' ? src.state.checkpoint : null;
  const window = cp === null ? null : delegationHealthWindowOf(cp.observationIntervals, src.nowMs);
  let lastIngestedAt: string | null = null;
  if (cp !== null) for (const r of cp.observationIntervals) if (lastIngestedAt === null || r.recordedAt > lastIngestedAt) lastIngestedAt = r.recordedAt;
  return {
    windowStartedAt: window === null ? null : window.windowStartedAt,
    windowEndedAt: window === null ? null : window.windowEndedAt,
    windowComplete: window !== null && window.complete,
    measuredSessionHours: window === null ? 0 : window.measuredSessionHours,
    unmeasuredSessionHours: window === null ? 0 : window.unmeasuredSessionHours,
    capabilityState: src.capabilityState,
    registryReadable: src.registryReadable,
    recoveryPhase: cp === null ? 'reconstructing' : 'ready',
    circuitBreaker: src.circuitBreaker,
    unresolved: src.verdictCounts.unresolved, conflicting: src.verdictCounts.conflicting, unmeasured: src.verdictCounts.unmeasured,
    lastJournalSequence: cp === null || cp.appliedJournalSequence === 0 ? null : cp.appliedJournalSequence,
    lastCheckpointRevision: cp === null || cp.revision === 0 ? null : cp.revision,
    lastIngestedAt,
  };
}

/** The published health. Every basis that is not measured is `unmeasured` with a null rate; the rate is a number only for a gate that
 *  has an answer. A recovery that is not ready cannot have measured the breaker either. */
export function delegationObservationHealthOf(input: DelegationHealthInput): DelegationObservationHealth {
  const total = input.measuredSessionHours + input.unmeasuredSessionHours;
  const measuredBasis = input.windowComplete && input.capabilityState === 'present' && input.registryReadable
    && input.recoveryPhase === 'ready' && total > 0;
  const stageGate: DelegationObservationHealth['stageGate'] = !measuredBasis ? 'unmeasured'
    : input.unmeasuredSessionHours * 100 < total ? 'eligible' : 'ineligible';
  return {
    mode: HEALTH_MODE,
    windowStartedAt: input.windowStartedAt, windowEndedAt: input.windowEndedAt,
    measuredSessionHours: input.measuredSessionHours, unmeasuredSessionHours: input.unmeasuredSessionHours,
    unmeasuredRate: measuredBasis ? input.unmeasuredSessionHours / total : null,
    stageGate,
    circuitBreaker: input.recoveryPhase === 'ready' ? input.circuitBreaker : 'unmeasured',
    unresolved: input.unresolved, conflicting: input.conflicting, unmeasured: input.unmeasured,
    lastJournalSequence: input.lastJournalSequence, lastCheckpointRevision: input.lastCheckpointRevision,
    lastIngestedAt: input.lastIngestedAt,
  };
}

/**
 * The checkpoint's interval upkeep, deterministic and order-independent. It keeps every row of the window and one more day, and it
 * drops what is older. And it turns an hour into a GAP when the lane recorded it before it ended, never recorded it again after it
 * closed, and the hook has since pruned its bucket: nothing can prove that hour whole any more. An unmeasured hour is final and is
 * never touched. When nothing changes the SAME array comes back, so the caller makes no checkpoint replacement for it.
 */
export function upkeepDelegationIntervals(
  intervals: readonly DelegationObservationInterval[], nowMs: number,
): { intervals: readonly DelegationObservationInterval[]; changed: boolean } {
  const keepFrom = hourFloor(nowMs) - DELEGATION_INTERVAL_RETENTION_HOURS * DELEGATION_HOUR_MS;
  const pruned = nowMs - DELEGATION_SPOOL_LOOKBACK_HOURS * DELEGATION_HOUR_MS;
  const out: DelegationObservationInterval[] = [];
  let changed = false;
  for (const r of intervals) {
    const at = intervalHourMs(r.utcHour);
    if (at === null) { out.push(r); continue; }                       // an unplaceable row is kept, and keeps the window incomplete
    if (at < keepFrom) { changed = true; continue; }
    if (r.state === 'measured') {
      const closeAt = at + DELEGATION_HOUR_MS + DELEGATION_HOUR_CLOSE_MARGIN_MS;
      let recorded: number | null = null;
      try { recorded = parseDelegationInstant(r.recordedAt); } catch (err) { if (!(err instanceof DelegationModelError)) throw err; }
      if ((recorded === null || recorded < closeAt) && closeAt <= pruned) {
        out.push({ ...r, state: 'unmeasured', detail: `${DELEGATION_HOUR_NEVER_CLOSED}: recorded before the hour ended and never read again before the spool dropped it`, recordedAt: formatDelegationInstant(nowMs) });
        changed = true;
        continue;
      }
    }
    out.push(r);
  }
  return changed ? { intervals: out, changed: true } : { intervals, changed: false };
}

/** Every kebab word this section spells, for `isDelegationModelKebab`. */
export function isDelegationHealthKebab(v: string): boolean {
  return Object.prototype.hasOwnProperty.call(DELEGATION_HEALTH_WORDS, v);
}

// ── Cursor retention (R58, D-4654) ────────────────────────────────────────────────────────────────────────────────────
//
// A bucket cursor is checkpoint-owned state the lane needs for as long as the bucket can still be READ, and not a moment longer; kept
// for ever it would be one more unbounded member of a checkpoint that every application rewrites whole. It is not the only one: the
// activities and their natural-key map, the sessions, the attempts (bounded per decision since run 740's D-6190, not in decisions), the leases
// and the lineage are kept for ever too (O4; D-6268 retires one class of activity, and wave 4 owns the general bound; D-6272). Two
// horizons, one derivation:
//   * THE READ HORIZON is `DELEGATION_SPOOL_LOOKBACK_HOURS` (24 h, the hook's own retention): the lane reads no bucket older than that,
//     whoever it belongs to, through `delegationBucketReadable` and nothing else.
//   * THE RETENTION is the read horizon plus a day: a cursor older than `DELEGATION_CURSOR_RETENTION_HOURS` (48 h) is retired, and only
//     if the checkpoint ALREADY holds an observation interval row for that cursor's (session, incarnation, hour), measured or not. A cursor
//     whose hour is not on file is KEPT, however old: retiring it would lose the only record that bucket was ever read. The day of margin
//     covers the hook's 24-to-25-hour pruning, a closing hour, fleet and server clock skew, and a lane outage of up to a day.
// Retiring a cursor changes no interval and no journal record, so the seven-day arithmetic is untouched. It is safe ONLY because of the
// read horizon: a bucket listed again after its cursor went would be read from offset 0 with no anchor and no sticky `replaced`.

/** The cursor retention: the read horizon plus 24 hours. */
export const DELEGATION_CURSOR_RETENTION_HOURS = DELEGATION_SPOOL_LOOKBACK_HOURS + 24;
/** D-6270: how long a start-less stop stays identity evidence: the cursor retention, i.e. the read horizon plus a day, so no line
 *  written before the stop can still be accepted after it. Measured on journal `acceptedAt`, never a clock read. */
export const DELEGATION_STOP_CANDIDATE_HORIZON_MS = DELEGATION_CURSOR_RETENTION_HOURS * DELEGATION_HOUR_MS;
/** D-6267: how long a listing-carrying Bash PreToolUse waits for its PostToolUse before it is forgotten. Measured on journal
 *  `acceptedAt`, never a clock read. */
export const DELEGATION_BASH_PENDING_MS = 3_600_000;

/** Whether a bucket's hour (epoch milliseconds, on an hour boundary) may be READ at `nowMs`: from the spool lookback up to the open
 *  hour. An hour older than that, a future hour and an instant that is not an hour boundary are never read. */
export function delegationBucketReadable(bucketHourMs: number, nowMs: number): boolean {
  if (!Number.isSafeInteger(bucketHourMs) || bucketHourMs % DELEGATION_HOUR_MS !== 0) return false;
  const openHour = hourFloor(nowMs);
  return bucketHourMs >= openHour - DELEGATION_SPOOL_LOOKBACK_HOURS * DELEGATION_HOUR_MS && bucketHourMs <= openHour;
}

const BUCKET_HOUR = /^(\d{4})(\d{2})(\d{2})(\d{2})$/;
/** A bucket name (`YYYYMMDDHH`) as the epoch milliseconds of its hour, or null when it names no hour. */
export function delegationBucketHourMs(bucket: string): number | null {
  const m = BUCKET_HOUR.exec(bucket);
  if (m === null) return null;
  try { return parseDelegationInstant(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:00:00.000Z`); } catch (err) { if (err instanceof DelegationModelError) return null; throw err; }
}

export interface DelegationCursorRetentionPlan {
  keep: DelegationBucketCursor[];
  drop: DelegationBucketCursor[];
  /** The kept rows whose bucket names no hour: kept because nothing can be said of their age, and reported. A subset of `keep`. */
  unparseable: DelegationBucketCursor[];
}

/** Which cursors to retire at `nowMs` (see above): pure, a partition of its input, the very rows and in input order, no row edited. */
export function planDelegationCursorRetention(
  cursors: readonly DelegationBucketCursor[], intervals: readonly DelegationObservationInterval[], nowMs: number,
): DelegationCursorRetentionPlan {
  const onFile = new Set(intervals.map((r) => JSON.stringify([r.sessionId, r.parentIncarnation, r.utcHour])));
  const cutoff = hourFloor(nowMs) - DELEGATION_CURSOR_RETENTION_HOURS * DELEGATION_HOUR_MS;
  const plan: DelegationCursorRetentionPlan = { keep: [], drop: [], unparseable: [] };
  for (const c of cursors) {
    const at = delegationBucketHourMs(c.bucket);
    if (at === null) { plan.keep.push(c); plan.unparseable.push(c); continue; }
    if (at < cutoff && onFile.has(JSON.stringify([c.sessionId, c.parentIncarnation, formatDelegationInstant(at)]))) plan.drop.push(c);
    else plan.keep.push(c);
  }
  return plan;
}
