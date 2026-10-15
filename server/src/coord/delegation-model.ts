// Delegation broker wave 3, Task 7: the PURE model behind the report-only coordination projection.
//
// This file is L1: no fs, no fastify, no `node:sqlite`, no `CoordStore`. `node:crypto` is allowed because hashing is a
// computation. It holds what Task 8's journal and checkpoint and Task 7's `CoordStore` methods share:
//   - the non-shared journal, checkpoint and row types (the closed lists they use live in `shared/api.ts` and are only
//     IMPORTED here; the types below name them and never re-spell them);
//   - `canonicalDelegationJson`, the one JSON encoder every journal preimage goes through (RFC 8785 over a closed domain);
//   - the activity natural key, the activity ID derived from it, and `restoreOrAllocateActivityId` (O1, O4);
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
  type DelegationLeaseSourceKind,
  type DelegationParentageState,
  type DelegationWorkspaceState,
} from '../../../shared/api.js';

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

export interface DelegationBucketCursor {
  sessionId: string;
  parentIncarnation: string;
  bucket: string;
  cursor: number;
  lastSize: number;
  lastCompleteAt: string | null;
  intervalState: DelegationIntervalState;
  detail: string | null;
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
 * R27: a type that makes every property, array and map reachable from `T` read-only. The durable applier's `state()`, the outcomes
 * it returns and what a checkpoint change returns ARE (or become) its live rows, so a caller that edited one in place would corrupt
 * the applier. They are therefore typed with this, and an in-place edit through any of them is a compile error. (A read-only view
 * stays ASSIGNABLE to the mutable row types, because TypeScript does not compare `readonly` on object properties, so passing a view
 * on to a function that takes the plain type still compiles; what the view forbids is the write.)
 */
export type DeepReadonly<T> =
  T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
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
  | 'lease-lineage';         // a lease's opening lineage row is missing, mis-owned or mis-derived

export class DelegationModelError extends Error {
  constructor(readonly code: DelegationModelRefusal, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'DelegationModelError';
  }
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
 * Reads the immutable mapping first. A natural key with a mapping ALWAYS gets its mapped ID back, whatever journalId the
 * caller now holds: a key never mints a second activity, and an ID is never re-hashed from a later event because the
 * original naming record was pruned (O4). Only a missing mapping allocates, and that needs the `journalId` of an accepted
 * qualifying retained record.
 *
 * The returned checkpoint is a NEW object carrying the mapping; the argument is untouched and its `revision` is left to
 * the serialized checkpoint replacement. THE ID MUST NOT ESCAPE (be returned to a caller, inserted into `coord.db`,
 * logged as an outcome, or put in a report) until a checkpoint holding this mapping and the activity row has been
 * durably replaced (O1): until then it is a candidate, and a crash discards it.
 */
export function restoreOrAllocateActivityId(
  key: DelegationActivityNaturalKey,
  identityJournalId: string | null,
  checkpoint: DelegationCheckpointV1,
): { activityId: string; checkpoint: DelegationCheckpointV1 } {
  const encoded = encodeDelegationNaturalKey(key);
  const mapped = Object.hasOwn(checkpoint.activityIdsByNaturalKey, encoded) ? checkpoint.activityIdsByNaturalKey[encoded] : undefined;
  if (mapped !== undefined) return { activityId: mapped, checkpoint };
  if (identityJournalId === null) {
    throw new DelegationModelError('identity-journal-id-required',
      'a natural key with no mapping needs the journalId of an accepted qualifying record');
  }
  const activityId = deriveDelegationActivityId(key, identityJournalId);
  return {
    activityId,
    checkpoint: { ...checkpoint, activityIdsByNaturalKey: { ...checkpoint.activityIdsByNaturalKey, [encoded]: activityId } },
  };
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
 * The coordinator-intent map the session rows say: per parent session ID, the LATEST `explicitIntentAt` when its incarnations
 * disagree. The one statement of what `coordinatorIntentByParent` must agree with, shared by the drift view above and by
 * `assertDelegationCheckpointIdentity`, so the key spelling is changed in one place if Task 15 changes it.
 */
export function deriveCoordinatorIntentByParent(sessions: readonly DelegationSessionRow[]): Record<string, string> {
  const intent = new Map<string, string>();
  for (const s of sessions) {
    if (s.explicitIntentAt === null) continue;
    const seen = intent.get(s.sessionId);
    if (seen === undefined || s.explicitIntentAt > seen) intent.set(s.sessionId, s.explicitIntentAt);
  }
  return Object.fromEntries(intent);
}

/**
 * Assembles the checkpoint a set of PROJECTED rows stands for. Only what the rows can say is filled in:
 *   - `activityIdsByNaturalKey` is derived from the activity rows (each carries its own natural key);
 *   - `coordinatorIntentByParent` is derived from the session rows' `explicitIntentAt`, the LATEST one per parent when its
 *     incarnations disagree;
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
