// Delegation broker wave 3, Task 8A: the canonical, hash-chained journal (`~/.ccrc/delegation-events.log`).
//
// The journal and the checkpoint are the AUTHORITY; `coord.db` is repairable output. This module owns the journal half:
//   - the closed record grammar and its codec (canonical UTF-8 JSON plus LF, strict on the way in);
//   - the two exact, nonrecursive hash preimages (`journalId`, `digest`), built ONLY through `canonicalDelegationJson`
//     from `delegation-model.ts`: there is no second canonical-JSON writer;
//   - the incremental hash-chain verifier and the anchor triple;
//   - deduplication planning (a duplicate evidence `eventId` and a duplicate or path-held lease identity are not appended);
//   - retention PLANNING (`DelegationPruningHold`): computed and tested, and the only thing a caller may do with it is read it.
//     NO production caller rewrites, truncates, renames or deletes `delegation-events.log` (physical compaction is deferred
//     until a separately approved plan specifies a crash-safe rewrite);
//   - the serialized writer: `O_APPEND`, ONE complete write of record plus LF, then `fsync`.
//
// THE SPLIT. Everything above the `IMPURE SHELL` banner is pure: no fs, no clock, no randomness, no SQLite. A test pins that
// the text above the banner never names the filesystem. Everything below it touches the disk and only through the injected
// `DelegationFilePort`, so every durability edge can be faulted in a test and nothing here ever reads the live `~/.ccrc`
// unless a caller hands it that directory.
import {
  DELEGATION_EVENT_KINDS,
  DELEGATION_LEASE_SOURCE_KINDS,
  type DelegationEventEnvelopeV1,
} from '../../../shared/api.js';
import {
  DelegationJsonError,
  DelegationModelError,
  canonicalDelegationJson,
  delegationSha256Hex,
  isLowerHex64,
  parseDelegationInstant,
  type DelegationEventRow,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
  type DelegationPruningHold,
  type DelegationRecoveryState,
} from './delegation-model.js';

/** The journal's file name under the coordination directory (`~/.ccrc`). */
export const DELEGATION_JOURNAL_FILE = 'delegation-events.log';

// ── Refusals ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Why the journal codec or verifier refused. Closed, so a caller and a test tell one refusal from another without reading
 *  prose, and a recovery failure names the exact rule that failed. */
export type DelegationJournalErrorCode =
  | 'bom'                    // a UTF-8 byte-order mark
  | 'crlf'                   // a line ending in CR before its LF
  | 'blank-line'             // an empty line between records
  | 'torn-tail'              // bytes after the last LF that are not one complete record
  | 'missing-final-lf'       // a complete, valid record with no LF after it
  | 'invalid-utf8'
  | 'malformed-json'
  | 'duplicate-key'          // the same key twice in one object, at any depth
  | 'unknown-key'            // a key the closed grammar does not name
  | 'bad-field'              // a missing key, or a value of the wrong type, word or shape
  | 'invalid-domain'         // outside the canonical JSON domain (a lone surrogate, an unsafe integer)
  | 'noncanonical'           // valid JSON that is not exactly the canonical encoding of its own value
  | 'sequence-domain'        // not a positive safe integer
  | 'sequence-start'         // a complete journal that does not begin at sequence 1
  | 'sequence-duplicate'
  | 'sequence-descent'
  | 'sequence-gap'
  | 'previous-digest'        // previousDigest is not the prior complete record's digest
  | 'journal-id-mismatch'    // journalId is not SHA-256 of its exact preimage
  | 'digest-mismatch'        // digest is not SHA-256 of its exact preimage
  | 'anchor-sequence'        // the anchor's journalId sits at another sequence
  | 'anchor-journal-id'      // the record at the anchor's sequence has another journalId
  | 'anchor-digest'          // the record at the anchor's sequence has another digest
  | 'anchor-missing'         // no retained record at the anchor's sequence
  | 'held-evidence-missing'  // a record a pruning hold names is not retained
  | 'short-write'            // a write that wrote fewer bytes than it was given
  | 'writer-unusable';       // an earlier write or fsync failed; the tail of the file is unknown

export class DelegationJournalError extends Error {
  constructor(readonly code: DelegationJournalErrorCode, detail: string, readonly where?: { line?: number; offset?: number }) {
    super(`delegation journal ${code}: ${detail}${where?.line !== undefined ? ` (line ${where.line})` : ''}`);
    this.name = 'DelegationJournalError';
  }
}

function refuse(code: DelegationJournalErrorCode, detail: string, where?: { line?: number; offset?: number }): never {
  throw new DelegationJournalError(code, detail, where);
}

// ── The two exact, nonrecursive preimages ─────────────────────────────────────────────────────────────────────────────

/** What a record is hashed from, before its `journalId` and `digest` exist. */
export interface DelegationJournalRecordFields {
  sequence: number;
  acceptedAt: string;
  previousDigest: string | null;
  entry: DelegationJournalEntryV1;
}

/**
 * `journalId = SHA256(canonicalDelegationJson({v, sequence, acceptedAt, previousDigest, entry}))`. NONRECURSIVE: neither
 * `journalId` nor `digest` is in its own preimage, so changing `journalId` cannot change `journalId`.
 */
export function delegationJournalId(f: DelegationJournalRecordFields): string {
  return delegationSha256Hex(canonicalDelegationJson({
    v: 1, sequence: f.sequence, acceptedAt: f.acceptedAt, previousDigest: f.previousDigest, entry: f.entry,
  }));
}

/**
 * `digest = SHA256(canonicalDelegationJson({v, sequence, journalId, acceptedAt, previousDigest, entry}))`. It includes
 * `previousDigest`, which is what chains one record to the one before it; it never includes itself.
 */
export function delegationJournalDigest(f: DelegationJournalRecordFields & { journalId: string }): string {
  return delegationSha256Hex(canonicalDelegationJson({
    v: 1, sequence: f.sequence, journalId: f.journalId, acceptedAt: f.acceptedAt, previousDigest: f.previousDigest, entry: f.entry,
  }));
}

/** A record with its two hashes computed. Throws `DelegationJsonError` for an entry outside the canonical JSON domain, and
 *  refuses anything the decoder would refuse, so a record that exists is a record that decodes. */
export function buildDelegationJournalRecord(f: DelegationJournalRecordFields): DelegationJournalRecordV1 {
  assertSequence(f.sequence);
  assertInstant(f.acceptedAt, 'acceptedAt');
  if (f.previousDigest !== null && !isLowerHex64(f.previousDigest)) {
    refuse('bad-field', 'previousDigest is neither null nor a lowercase 64-hex SHA-256');
  }
  const entry = validateEntry(f.entry);
  const journalId = delegationJournalId({ ...f, entry });
  const digest = delegationJournalDigest({ ...f, entry, journalId });
  return { v: 1, sequence: f.sequence, journalId, acceptedAt: f.acceptedAt, previousDigest: f.previousDigest, entry, digest };
}

// ── The closed grammar: entry and record validation ────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isMember = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** Exactly these keys, no more and no fewer. An extra key is `unknown-key`, a missing one `bad-field`. */
function exactKeys(o: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) refuse('unknown-key', `${what} has the unknown key ${JSON.stringify(k)}`);
  for (const k of keys) if (!Object.hasOwn(o, k)) refuse('bad-field', `${what} is missing ${JSON.stringify(k)}`);
}

function nonEmptyString(v: unknown, what: string): string {
  return typeof v === 'string' && v !== '' ? v : refuse('bad-field', `${what} is not a non-empty string`);
}

function assertSequence(v: unknown): asserts v is number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) refuse('sequence-domain', `${String(v)} is not a positive safe integer`);
}

function assertInstant(v: unknown, what: string): asserts v is string {
  try { parseDelegationInstant(v as string); } catch (err) {
    if (err instanceof DelegationModelError) refuse('bad-field', `${what} is not a canonical UTC millisecond instant`);
    throw err;
  }
}

function hex64(v: unknown, what: string): string {
  return isLowerHex64(v) ? v : refuse('bad-field', `${what} is not a lowercase 64-hex SHA-256`);
}

const LEASE_ENTRY_KEYS = [
  'kind', 'leaseId', 'generation', 'activityId', 'parentId', 'parentIncarnation', 'project', 'adminRecord', 'canonicalPath',
  'creationBase', 'sourceKind', 'correlationJournalIds', 'firstObservedAt', 'lineageId',
] as const;

/** The keys the DURABILITY layer reads from an evidence envelope. The envelope's variant-specific fields are the ingest
 *  layer's closed union (W3-M69); the journal keeps them verbatim and requires only that they be inside the canonical JSON
 *  domain, which the canonical re-encoding check proves. */
function isEventEnvelope(v: unknown): v is DelegationEventEnvelopeV1 {
  if (!isRecord(v)) return false;
  if (v['v'] !== 1 || !isMember(DELEGATION_EVENT_KINDS, v['eventKind'])) return false;
  for (const k of ['sessionId', 'parentIncarnation', 'claudeSessionId', 'eventId', 'bucket']) {
    if (typeof v[k] !== 'string' || v[k] === '') return false;
  }
  const { startOffset, endOffset } = v;
  if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || !Number.isSafeInteger(startOffset)
      || !Number.isSafeInteger(endOffset) || startOffset < 0 || endOffset <= startOffset) return false;
  try { parseDelegationInstant(v['observedAt'] as string); } catch { return false; }
  return v['agentId'] === undefined || typeof v['agentId'] === 'string';
}

/** The closed entry grammar: `evidence-accepted` and `lease-created`, nothing else. A later wave may ADD a variant; it may not
 *  reinterpret either of these two. Returns a fresh entry object, but an evidence entry keeps the caller's `event` BY REFERENCE (its
 *  variant-specific fields are opaque here), so a caller must not mutate an event it has handed over. A lease-created entry is
 *  rebuilt field by field. */
function validateEntry(entry: unknown): DelegationJournalEntryV1 {
  if (!isRecord(entry)) return refuse('bad-field', 'entry is not an object');
  if (entry['kind'] === 'evidence-accepted') {
    exactKeys(entry, ['kind', 'event'], 'an evidence-accepted entry');
    const event = entry['event'];
    if (!isEventEnvelope(event)) return refuse('bad-field', 'an evidence-accepted entry\'s event is not an envelope with the keys the journal reads');
    return { kind: 'evidence-accepted', event };
  }
  if (entry['kind'] === 'lease-created') {
    exactKeys(entry, LEASE_ENTRY_KEYS, 'a lease-created entry');
    if (entry['generation'] !== 0) refuse('bad-field', 'a lease-created entry is generation 0: the first carrier generation is a later wave\'s');
    const sourceKind = entry['sourceKind'];
    if (!isMember(DELEGATION_LEASE_SOURCE_KINDS, sourceKind)) return refuse('bad-field', 'sourceKind is not a lease source kind');
    const ids = entry['correlationJournalIds'];
    if (!Array.isArray(ids)) return refuse('bad-field', 'correlationJournalIds is not a list');
    const correlationJournalIds = ids.filter(isLowerHex64);
    if (correlationJournalIds.length !== ids.length) refuse('bad-field', 'correlationJournalIds is not a list of lowercase 64-hex SHA-256 values');
    const creationBase = entry['creationBase'];
    if (creationBase !== null && (typeof creationBase !== 'string' || creationBase === '')) return refuse('bad-field', 'creationBase is neither null nor a non-empty string');
    const firstObservedAt = entry['firstObservedAt'];
    assertInstant(firstObservedAt, 'firstObservedAt');
    return {
      kind: 'lease-created',
      leaseId: nonEmptyString(entry['leaseId'], 'leaseId'),
      generation: 0,
      activityId: hex64(entry['activityId'], 'activityId'),
      parentId: nonEmptyString(entry['parentId'], 'parentId'),
      parentIncarnation: nonEmptyString(entry['parentIncarnation'], 'parentIncarnation'),
      project: nonEmptyString(entry['project'], 'project'),
      adminRecord: nonEmptyString(entry['adminRecord'], 'adminRecord'),
      canonicalPath: nonEmptyString(entry['canonicalPath'], 'canonicalPath'),
      creationBase,
      sourceKind,
      correlationJournalIds,
      firstObservedAt,
      lineageId: hex64(entry['lineageId'], 'lineageId'),
    };
  }
  return refuse('bad-field', `entry kind ${JSON.stringify(entry['kind'])} is not in the closed grammar`);
}

const RECORD_KEYS = ['v', 'sequence', 'journalId', 'acceptedAt', 'previousDigest', 'entry', 'digest'] as const;

// ── A JSON text scanner that finds what JSON.parse hides ───────────────────────────────────────────────────────────────

/** Whether a JSON text repeats a key in any one object, at any depth. `JSON.parse` silently keeps the last of two equal keys, so
 *  a second parse cannot see it; this scanner can. A syntax error is a distinct answer, not a pass. */
export function findDelegationJsonDefect(text: string): 'duplicate-key' | 'malformed-json' | null {
  let i = 0;
  let defect: 'duplicate-key' | 'malformed-json' | null = null;
  const MAX_DEPTH = 64;
  const ws = (): void => { while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; };
  const bad = (): never => { defect ??= 'malformed-json'; throw new Error('stop'); };
  const string = (): string => {
    const start = i;
    if (text[i] !== '"') bad();
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') i += text[i + 1] === 'u' ? 6 : 2; else i++;
    }
    if (i >= text.length) bad();
    i++;
    try { return JSON.parse(text.slice(start, i)) as string; } catch { return bad(); }
  };
  const value = (depth: number): void => {
    if (depth > MAX_DEPTH) bad();
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const keys = new Set<string>();
      ws();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws();
        const k = string();
        if (keys.has(k)) { defect ??= 'duplicate-key'; throw new Error('stop'); }
        keys.add(k);
        ws();
        if (text[i] !== ':') bad();
        i++;
        value(depth + 1);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return; }
        bad();
      }
    } else if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') { i++; return; }
      for (;;) {
        value(depth + 1);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return; }
        bad();
      }
    } else if (c === '"') {
      string();
    } else {
      const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
      if (m === null) bad(); else i += m[0].length;
    }
  };
  try {
    value(0);
    ws();
    if (i !== text.length) bad();
  } catch {
    return defect ?? 'malformed-json';
  }
  return defect;
}

// ── The record codec ──────────────────────────────────────────────────────────────────────────────────────────────────

const UTF8 = new TextEncoder();

/** One record as it is written: its canonical JSON, then LF. */
export function encodeDelegationJournalRecord(record: DelegationJournalRecordV1): Uint8Array {
  return UTF8.encode(`${canonicalDelegationJson(record)}\n`);
}

/**
 * One journal LINE (without its LF) back into a record, strictly. Refused, each with its own code: a BOM, a trailing CR, an
 * empty line, invalid UTF-8, a JSON syntax error, a duplicate key, an unknown or missing key, a field of the wrong shape,
 * a value outside the canonical domain, text that is not byte-for-byte the canonical encoding of its own value, and a
 * `journalId` or `digest` that is not the SHA-256 of its exact preimage. Chain rules (sequence, previousDigest, anchor) belong to
 * `DelegationJournalChain`, which sees more than one record.
 */
export function decodeDelegationJournalLine(line: Uint8Array, where?: { line?: number; offset?: number }): DelegationJournalRecordV1 {
  const w = where;
  if (line.length >= 3 && line[0] === 0xef && line[1] === 0xbb && line[2] === 0xbf) refuse('bom', 'a byte-order mark', w);
  if (line.length === 0) refuse('blank-line', 'an empty line', w);
  if (line[line.length - 1] === 0x0d) refuse('crlf', 'a line ends in CR before its LF', w);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(line); } catch { return refuse('invalid-utf8', 'the line is not valid UTF-8', w); }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return refuse('malformed-json', 'the line is not JSON', w); }
  if (!isRecord(parsed)) return refuse('bad-field', 'the line is not a JSON object', w);
  exactKeys(parsed, RECORD_KEYS, 'a record');
  if (parsed['v'] !== 1) refuse('bad-field', 'v is not 1', w);
  const sequence = parsed['sequence'];
  assertSequence(sequence);
  const acceptedAt = parsed['acceptedAt'];
  assertInstant(acceptedAt, 'acceptedAt');
  const previousDigest = parsed['previousDigest'];
  if (previousDigest !== null && !isLowerHex64(previousDigest)) refuse('bad-field', 'previousDigest is neither null nor a lowercase 64-hex SHA-256', w);
  const journalId = hex64(parsed['journalId'], 'journalId');
  const digest = hex64(parsed['digest'], 'digest');
  const entry = validateEntry(parsed['entry']);
  const record: DelegationJournalRecordV1 = { v: 1, sequence, journalId, acceptedAt, previousDigest, entry, digest };
  let canonical: string;
  try { canonical = canonicalDelegationJson(record); } catch (err) {
    if (err instanceof DelegationJsonError) return refuse('invalid-domain', err.message, w);
    throw err;
  }
  if (canonical !== text) {
    // `JSON.parse` keeps the last of two equal keys, so a repeated key reaches here as a text that is not its own canonical
    // encoding. Only now is the (slower) scanner run, to say WHICH defect it is; a canonical line never needs it.
    if (findDelegationJsonDefect(text) === 'duplicate-key') refuse('duplicate-key', 'an object repeats a key', w);
    refuse('noncanonical', 'the line is not the canonical encoding of its own value', w);
  }
  if (delegationJournalId(record) !== journalId) refuse('journal-id-mismatch', 'journalId is not SHA-256 of its preimage', w);
  if (delegationJournalDigest(record) !== digest) refuse('digest-mismatch', 'digest is not SHA-256 of its preimage', w);
  return record;
}

/** Splits a stream of bytes into LF-terminated lines without ever holding more than one partial line: `push` returns the
 *  complete lines (LF removed) of what has arrived so far, and `leftover` is whatever follows the last LF. */
export class DelegationJournalLineSplitter {
  private pending: Uint8Array = new Uint8Array(0);
  push(chunk: Uint8Array): Uint8Array[] {
    const buf = new Uint8Array(this.pending.length + chunk.length);
    buf.set(this.pending, 0);
    buf.set(chunk, this.pending.length);
    const lines: Uint8Array[] = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) { lines.push(buf.subarray(start, i)); start = i + 1; }
    }
    this.pending = buf.subarray(start);
    return lines;
  }
  leftover(): Uint8Array { return this.pending; }
}

/** The error for bytes after the last LF: `missing-final-lf` when they are one complete valid record, `torn-tail` otherwise. */
export function delegationTornTailError(leftover: Uint8Array, where?: { line?: number; offset?: number }): DelegationJournalError {
  try {
    decodeDelegationJournalLine(leftover);
    return new DelegationJournalError('missing-final-lf', 'the last record has no LF after it', where);
  } catch {
    return new DelegationJournalError('torn-tail', `${leftover.length} bytes follow the last LF and are not a complete record`, where);
  }
}

// ── The hash chain ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A point in the journal: what the checkpoint's anchor and a snapshot's end-of-file both name. */
export interface DelegationJournalPosition {
  sequence: number;
  journalId: string;
  digest: string;
}

/** What a validated journal covers, in the shape the snapshot manifest carries it. */
export interface DelegationJournalCoverage {
  firstSequence: number | null;
  lastSequence: number | null;
  recordCount: number;
  firstPreviousDigest: string | null;
  copiedEof: DelegationJournalPosition | null;
}

export interface DelegationJournalChainOptions {
  /** True: the journal must begin at sequence 1 with a null `previousDigest` (wave 3 compacts nothing, so a complete journal is
   *  the only journal there is). False: it may begin later, and its first `previousDigest` is reported, not verified. */
  completeFromStart?: boolean;
  /** The checkpoint anchor (or a snapshot's) the record at that sequence must equal in all three parts. */
  anchor?: DelegationJournalPosition | null;
}

/**
 * The incremental chain verifier: positive contiguous safe-integer sequences, each `previousDigest` equal to the prior complete
 * record's `digest`, and the anchor triple. (`journalId` uniqueness needs no set: a `journalId` is SHA-256 of a preimage that
 * includes the strictly increasing `sequence`, and `decodeDelegationJournalLine` has already proved each record's own
 * `journalId`, so two records cannot share one without a SHA-256 collision.) Feed records in file order.
 */
export class DelegationJournalChain {
  private count = 0;
  private first: { sequence: number; previousDigest: string | null } | null = null;
  private last: DelegationJournalPosition | null = null;
  private anchorSeen = false;
  constructor(private readonly opts: DelegationJournalChainOptions = {}) {}

  accept(record: DelegationJournalRecordV1): void {
    assertSequence(record.sequence);
    const anchor = this.opts.anchor ?? null;
    if (this.last === null) {
      if (this.opts.completeFromStart === true) {
        if (record.sequence !== 1) refuse('sequence-start', `a complete journal begins at sequence 1, not ${record.sequence}`);
        if (record.previousDigest !== null) refuse('previous-digest', 'the first record of a complete journal has previousDigest null');
      }
      this.first = { sequence: record.sequence, previousDigest: record.previousDigest };
    } else {
      if (record.sequence === this.last.sequence) refuse('sequence-duplicate', `sequence ${record.sequence} appears twice`);
      if (record.sequence < this.last.sequence) refuse('sequence-descent', `sequence ${record.sequence} follows ${this.last.sequence}`);
      if (record.sequence !== this.last.sequence + 1) refuse('sequence-gap', `sequence ${record.sequence} follows ${this.last.sequence}`);
      if (record.previousDigest !== this.last.digest) refuse('previous-digest', `record ${record.sequence}'s previousDigest is not record ${this.last.sequence}'s digest`);
    }
    if (anchor !== null) {
      if (record.sequence === anchor.sequence) {
        if (record.journalId !== anchor.journalId) refuse('anchor-journal-id', `the record at sequence ${anchor.sequence} has another journalId`);
        if (record.digest !== anchor.digest) refuse('anchor-digest', `the record at sequence ${anchor.sequence} has another digest`);
        this.anchorSeen = true;
      } else if (record.journalId === anchor.journalId) {
        refuse('anchor-sequence', `the anchor's journalId is at sequence ${record.sequence}, not ${anchor.sequence}`);
      }
    }
    this.count++;
    this.last = { sequence: record.sequence, journalId: record.journalId, digest: record.digest };
  }

  /** The head so far: the last accepted record, or null before the first. */
  head(): DelegationJournalPosition | null { return this.last; }
  recordCount(): number { return this.count; }
  firstRecord(): { sequence: number; previousDigest: string | null } | null { return this.first; }
  anchorWasSeen(): boolean { return this.anchorSeen; }

  /** The coverage, once every record is in. An anchor no record satisfied is `anchor-missing`. */
  finish(): DelegationJournalCoverage {
    const anchor = this.opts.anchor ?? null;
    if (anchor !== null && !this.anchorSeen) refuse('anchor-missing', `no retained record at the anchor's sequence ${anchor.sequence}`);
    return {
      firstSequence: this.first?.sequence ?? null,
      lastSequence: this.last?.sequence ?? null,
      recordCount: this.count,
      firstPreviousDigest: this.first?.previousDigest ?? null,
      copiedEof: this.last,
    };
  }
}

export interface DelegationJournalExpectation extends DelegationJournalChainOptions {
  /** Journal IDs a pruning hold names (the identity evidence a checkpoint still needs). Each must be a retained record. */
  heldJournalIds?: readonly string[];
}

/**
 * Validates a whole journal as bytes (a copy, a snapshot, a file read at once) and returns its coverage. Every rule of the
 * grammar and the chain applies, and so does the anchor: the checkpoint's `(sequence, journalId, digest)` must be the record
 * at that sequence, and every held journal ID must be retained. Bytes after the last LF are a torn tail, whatever they hold.
 */
export function validateDelegationJournalBytes(bytes: Uint8Array, expect: DelegationJournalExpectation = {}): DelegationJournalCoverage {
  const chain = new DelegationJournalChain(expect);
  const held = new Set(expect.heldJournalIds ?? []);
  const splitter = new DelegationJournalLineSplitter();
  let lineNo = 0;
  for (const line of splitter.push(bytes)) {
    lineNo++;
    const record = decodeDelegationJournalLine(line, { line: lineNo });
    chain.accept(record);
    held.delete(record.journalId);
  }
  const tail = splitter.leftover();
  if (tail.length > 0) throw delegationTornTailError(tail, { line: lineNo + 1 });
  const coverage = chain.finish();
  if (held.size > 0) refuse('held-evidence-missing', `${held.size} held journal ID(s) are not retained, first ${[...held][0]}`);
  return coverage;
}

/** A whole journal as records. Same strictness as `validateDelegationJournalBytes`. */
export function parseDelegationJournal(bytes: Uint8Array, opts: DelegationJournalChainOptions = {}): DelegationJournalRecordV1[] {
  const chain = new DelegationJournalChain(opts);
  const splitter = new DelegationJournalLineSplitter();
  const records: DelegationJournalRecordV1[] = [];
  let lineNo = 0;
  for (const line of splitter.push(bytes)) {
    lineNo++;
    const record = decodeDelegationJournalLine(line, { line: lineNo });
    chain.accept(record);
    records.push(record);
  }
  const tail = splitter.leftover();
  if (tail.length > 0) throw delegationTornTailError(tail, { line: lineNo + 1 });
  chain.finish();
  return records;
}

// ── Evidence as an SQLite row ─────────────────────────────────────────────────────────────────────────────────────────

/** The `delegation_events` row an accepted evidence record stands for. `payloadJson` is the envelope's canonical JSON, so the same
 *  record always yields the same row and a replay can tell "already there" from "drifted". */
export function delegationEventRowOfRecord(record: DelegationJournalRecordV1): DelegationEventRow {
  const entry = record.entry;
  if (entry.kind !== 'evidence-accepted') throw new DelegationModelError('bad-event', `record ${record.sequence} is not evidence`);
  const e = entry.event;
  return {
    eventId: e.eventId, journalSequence: record.sequence, journalDigest: record.digest, acceptedAt: record.acceptedAt,
    sessionId: e.sessionId, parentIncarnation: e.parentIncarnation, claudeSessionId: e.claudeSessionId, eventKind: e.eventKind,
    observedAt: e.observedAt, payloadJson: canonicalDelegationJson(e),
  };
}

// ── Deduplication planning ────────────────────────────────────────────────────────────────────────────────────────────

/** The server-side identity of a lease: `(project, adminRecord, creationBase, canonicalPath)`, with a null base kept distinct
 *  from every string (SQLite's UNIQUE treats nulls as distinct, so identity is decided here and by the two partial indexes). */
export function delegationLeaseIdentityKey(t: { project: string; adminRecord: string; creationBase: string | null; canonicalPath: string }): string {
  return canonicalDelegationJson([t.project, t.adminRecord, t.creationBase, t.canonicalPath]);
}

/** What the planner asks about the leases that already exist (unreleased ones: nothing releases a lease in wave 3). */
export interface DelegationLeaseView {
  byIdentity(identityKey: string): string | undefined;
  byPath(canonicalPath: string): string | undefined;
}

export interface DelegationAppendItem {
  entry: DelegationJournalEntryV1;
  /** The canonical UTC millisecond instant the server accepted it. The CALLER supplies it from an injected clock. */
  acceptedAt: string;
}

export type DelegationAppendSkipReason = 'duplicate-event' | 'duplicate-lease' | 'lease-path-held';

export interface DelegationAppendPlan {
  records: DelegationJournalRecordV1[];
  skipped: Array<{ index: number; reason: DelegationAppendSkipReason; leaseId?: string }>;
}

/**
 * Decides, with no side effect, which items become records and in what chain. A duplicate evidence `eventId` (already in the
 * journal OR earlier in this batch), a duplicate unreleased lease identity, and a lease whose canonical path an unreleased
 * lease already holds are SKIPPED, never appended, and never renumbered over: the chain is built from `head` over the items that
 * survive. Nothing here mints an ID or reads a clock.
 */
export function planDelegationJournalAppend(input: {
  head: DelegationJournalPosition | null;
  eventIds: ReadonlySet<string>;
  leases: DelegationLeaseView;
  items: readonly DelegationAppendItem[];
}): DelegationAppendPlan {
  const batchEvents = new Set<string>();
  const batchLeaseByIdentity = new Map<string, string>();
  const batchLeaseByPath = new Map<string, string>();
  const records: DelegationJournalRecordV1[] = [];
  const skipped: DelegationAppendPlan['skipped'] = [];
  let sequence = input.head?.sequence ?? 0;
  let previousDigest = input.head?.digest ?? null;
  input.items.forEach((item, index) => {
    const entry = validateEntry(item.entry);
    if (entry.kind === 'evidence-accepted') {
      const id = entry.event.eventId;
      if (input.eventIds.has(id) || batchEvents.has(id)) { skipped.push({ index, reason: 'duplicate-event' }); return; }
      batchEvents.add(id);
    } else {
      const identityKey = delegationLeaseIdentityKey(entry);
      const sameIdentity = batchLeaseByIdentity.get(identityKey) ?? input.leases.byIdentity(identityKey);
      if (sameIdentity !== undefined) { skipped.push({ index, reason: 'duplicate-lease', leaseId: sameIdentity }); return; }
      const pathHolder = batchLeaseByPath.get(entry.canonicalPath) ?? input.leases.byPath(entry.canonicalPath);
      if (pathHolder !== undefined) { skipped.push({ index, reason: 'lease-path-held', leaseId: pathHolder }); return; }
      batchLeaseByIdentity.set(identityKey, entry.leaseId);
      batchLeaseByPath.set(entry.canonicalPath, entry.leaseId);
    }
    const record = buildDelegationJournalRecord({ sequence: sequence + 1, acceptedAt: item.acceptedAt, previousDigest, entry });
    records.push(record);
    sequence = record.sequence;
    previousDigest = record.digest;
  });
  return { records, skipped };
}

// ── Retention PLANNING (computed and tested; nothing in wave 3 acts on it) ────────────────────────────────────────────

/** The reasons a hold exists, derived from the model's one declaration so a new reason cannot be added in two places. */
export type DelegationPruningHoldReason = DelegationPruningHold['reason'];

/** The wave-3 retention floor the spec proposes: at least 30 days. Wave 3 prunes nothing, so this only bounds the plan. */
export const DELEGATION_RETENTION_FLOOR_MS = 30 * 24 * 60 * 60 * 1000;

/** What a plan needs to know about the retained journal, collected in one pass without keeping the records. */
export interface DelegationRetentionView {
  /** The sequence of each wanted journal ID that is retained. */
  sequenceByJournalId: ReadonlyMap<string, number>;
  /** The first retained sequence whose `acceptedAt` is newer than the cutoff (inside the retention floor), or null. */
  firstSequenceInsideFloor: number | null;
  firstSequence: number | null;
  lastSequence: number | null;
}

/** Collects a `DelegationRetentionView` from records fed one at a time, so a journal of millions is never held. `cutoffMs` is
 *  epoch milliseconds: a record accepted AFTER it is inside the retention floor. */
export class DelegationRetentionCollector {
  private readonly sequences = new Map<string, number>();
  private firstInside: number | null = null;
  private first: number | null = null;
  private last: number | null = null;
  constructor(private readonly wanted: ReadonlySet<string>, private readonly cutoffMs: number) {}
  add(r: DelegationJournalRecordV1): void {
    this.first ??= r.sequence;
    this.last = r.sequence;
    if (this.wanted.has(r.journalId)) this.sequences.set(r.journalId, r.sequence);
    if (this.firstInside === null && parseDelegationInstant(r.acceptedAt) > this.cutoffMs) this.firstInside = r.sequence;
  }
  view(): DelegationRetentionView {
    return { sequenceByJournalId: this.sequences, firstSequenceInsideFloor: this.firstInside, firstSequence: this.first, lastSequence: this.last };
  }
}

/** One pass over retained records in memory. */
export function delegationRetentionViewOf(records: Iterable<DelegationJournalRecordV1>, wanted: ReadonlySet<string>, cutoffMs: number): DelegationRetentionView {
  const c = new DelegationRetentionCollector(wanted, cutoffMs);
  for (const r of records) c.add(r);
  return c.view();
}

export interface DelegationPruningPlan {
  /** False from reconstruction entry through checkpoint validation, and for good after any recovery failure (O2). */
  enabled: boolean;
  disabledReason: string | null;
  holds: readonly DelegationPruningHold[];
  /** The largest sequence S such that records 1..S could be removed as a contiguous prefix: strictly before the checkpoint
   *  anchor, before every held record, and before the retention floor. 0 means nothing. NOTHING ACTS ON THIS IN WAVE 3. */
  prunableThroughSequence: number;
}

/**
 * The retention plan. Pruning is DISABLED unless the recovery state is `ready` (O2): during reconstruction, and after any
 * recovery failure, the answer is `enabled: false` and nothing is prunable. When enabled it reads the holds the checkpoint
 * carries, which the checkpoint builder recomputes on every build from the complete journal's facts. POSITIONAL COVERAGE
 * IS NOT ENOUGH: an identity-candidate hold keeps its record even though the checkpoint has already applied a later sequence
 * (W3-M17), because only a checkpoint that HOLDS the selected activity ID releases it.
 */
export function planDelegationPruning(input: { state: DelegationRecoveryState; view: DelegationRetentionView }): DelegationPruningPlan {
  const { state, view } = input;
  const holds = state.checkpoint.pruningHolds;
  if (state.phase !== 'ready') {
    return { enabled: false, disabledReason: 'recovery has not completed: pruning stays disabled from reconstruction entry through validation', holds, prunableThroughSequence: 0 };
  }
  let bound = state.checkpoint.appliedJournalSequence - 1;
  for (const h of holds) {
    const seq = view.sequenceByJournalId.get(h.journalId);
    if (seq !== undefined) bound = Math.min(bound, seq - 1);
  }
  if (view.firstSequenceInsideFloor !== null) bound = Math.min(bound, view.firstSequenceInsideFloor - 1);
  return { enabled: true, disabledReason: null, holds, prunableThroughSequence: Math.max(0, bound) };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// IMPURE SHELL: from here down the module touches the filesystem, and only through the injected `DelegationFilePort`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// (The shell's imports sit here, below the banner, so the split is literal: nothing above names the filesystem.)
import { constants as fsConstants } from 'node:fs';
import fsp from 'node:fs/promises';

/** An open file for writing. `write` returns the byte count the OS accepted. */
export interface DelegationFileHandle {
  write(bytes: Uint8Array): Promise<number>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** An open file for reading at positions. */
export interface DelegationReadHandle {
  size(): Promise<number>;
  read(position: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/**
 * Every filesystem operation the durability layer performs, as a port. Absence is `null` from `readFile` and `openRead` and only
 * for ENOENT: any other failure throws, so an unreadable file is never mistaken for an absent one.
 */
export interface DelegationFilePort {
  /** `O_WRONLY | O_APPEND | O_CREAT`, mode 0600. */
  openAppend(path: string): Promise<DelegationFileHandle>;
  /** `O_WRONLY | O_CREAT | O_TRUNC`, mode 0600: a checkpoint temp file in the checkpoint's own directory. */
  createTemp(path: string): Promise<DelegationFileHandle>;
  rename(from: string, to: string): Promise<void>;
  fsyncDir(dir: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array | null>;
  openRead(path: string): Promise<DelegationReadHandle | null>;
  mkdirp(dir: string): Promise<void>;
}

const isEnoent = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT';

const wrapHandle = (fh: fsp.FileHandle): DelegationFileHandle => ({
  write: async (bytes) => (await fh.write(bytes, 0, bytes.length, null)).bytesWritten,
  sync: () => fh.sync(),
  close: () => fh.close(),
});

/** The real filesystem. */
export const nodeDelegationFilePort: DelegationFilePort = {
  openAppend: async (p) => wrapHandle(await fsp.open(p, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT, 0o600)),
  createTemp: async (p) => wrapHandle(await fsp.open(p, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC, 0o600)),
  rename: (from, to) => fsp.rename(from, to),
  fsyncDir: async (dir) => {
    const fh = await fsp.open(dir, fsConstants.O_RDONLY);
    try { await fh.sync(); } finally { await fh.close(); }
  },
  readFile: async (p) => {
    try { return new Uint8Array(await fsp.readFile(p)); } catch (err) { if (isEnoent(err)) return null; throw err; }
  },
  openRead: async (p) => {
    let fh: fsp.FileHandle;
    try { fh = await fsp.open(p, fsConstants.O_RDONLY); } catch (err) { if (isEnoent(err)) return null; throw err; }
    return {
      size: async () => (await fh.stat()).size,
      read: async (position, length) => {
        const buf = new Uint8Array(length);
        const { bytesRead } = await fh.read(buf, 0, length, position);
        return buf.subarray(0, bytesRead);
      },
      close: () => fh.close(),
    };
  },
  mkdirp: async (dir) => { await fsp.mkdir(dir, { recursive: true, mode: 0o700 }); },
};

/**
 * Reads a journal file as validated records, a bounded chunk at a time, so recovery over a journal of millions of records holds
 * one chunk and one partial line, never the file. Each record is individually validated (the grammar, both hashes); the chain
 * is the consumer's (`DelegationJournalChain`). An absent file yields nothing. Bytes after the last LF throw
 * `torn-tail` / `missing-final-lf` AFTER every complete record has been yielded.
 */
export async function* readDelegationJournalRecords(port: DelegationFilePort, path: string, chunkBytes = 1 << 18): AsyncGenerator<DelegationJournalRecordV1, void, undefined> {
  const handle = await port.openRead(path);
  if (handle === null) return;
  try {
    const splitter = new DelegationJournalLineSplitter();
    const size = await handle.size();
    let position = 0;
    let lineNo = 0;
    while (position < size) {
      const chunk = await handle.read(position, Math.min(chunkBytes, size - position));
      if (chunk.length === 0) break;
      position += chunk.length;
      for (const line of splitter.push(chunk)) {
        lineNo++;
        yield decodeDelegationJournalLine(line, { line: lineNo });
      }
    }
    const tail = splitter.leftover();
    if (tail.length > 0) throw delegationTornTailError(tail, { line: lineNo + 1 });
  } finally {
    await handle.close();
  }
}

/**
 * The serialized journal writer. It holds ONE `O_APPEND` descriptor. `write(record)` is ONE complete write of the record's
 * canonical JSON plus LF (a short write is `short-write`, not a retry: the tail is then unknown), and `sync()` is the fsync
 * that makes it durable; the caller orders them (O5 steps 1 and 2) and owns the edges between. A failure of either marks the
 * writer unusable for good, because the tail of the file is no longer known: the owner re-recovers from disk with a fresh
 * writer. It refuses to append behind a torn tail (a file whose last byte is not LF), so a record is never glued onto a
 * fragment. It never truncates, renames or rewrites the file, and it has no method that could.
 */
export class DelegationJournalWriter {
  private handle: DelegationFileHandle | null = null;
  private unusable = false;
  private creating = false;
  constructor(private readonly port: DelegationFilePort, private readonly path: string, private readonly dir: string) {}

  private async open(): Promise<DelegationFileHandle> {
    if (this.unusable) return refuse('writer-unusable', 'an earlier write or fsync failed');
    if (this.handle !== null) return this.handle;
    await this.port.mkdirp(this.dir);
    const existing = await this.port.openRead(this.path);
    if (existing === null) {
      this.creating = true;
    } else {
      try {
        const size = await existing.size();
        if (size > 0) {
          const last = await existing.read(size - 1, 1);
          if (last[0] !== 0x0a) refuse('torn-tail', 'the journal does not end in LF; nothing is appended behind a fragment');
        }
      } finally {
        await existing.close();
      }
    }
    this.handle = await this.port.openAppend(this.path);
    return this.handle;
  }

  async write(record: DelegationJournalRecordV1): Promise<void> {
    const bytes = encodeDelegationJournalRecord(record);
    const handle = await this.open();
    try {
      const n = await handle.write(bytes);
      if (n !== bytes.length) {
        this.unusable = true;
        refuse('short-write', `wrote ${n} of ${bytes.length} bytes`);
      }
    } catch (err) {
      this.unusable = true;
      throw err;
    }
  }

  async sync(): Promise<void> {
    if (this.unusable) return refuse('writer-unusable', 'an earlier write or fsync failed');
    const handle = await this.open();
    try {
      await handle.sync();
      // A journal this call has just CREATED is not durable until its directory entry is: one directory fsync, once.
      if (this.creating) { await this.port.fsyncDir(this.dir); this.creating = false; }
    } catch (err) {
      this.unusable = true;
      throw err;
    }
  }

  async close(): Promise<void> {
    const h = this.handle;
    this.handle = null;
    if (h !== null) await h.close();
  }
}
