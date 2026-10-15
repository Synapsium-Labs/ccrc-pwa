// Coordination snapshot: capture, classify, restore and recover the authoritative delegation sidecars
// (`~/.ccrc/delegation-events.log`, `~/.ccrc/delegation-checkpoint.json`) beside the SQLite snapshot that
// `backup-coord.mjs` takes (delegation broker wave 3, Task 8B; O3 of the plan's implementation decisions).
//
// SELF-CONTAINED ON PURPOSE. This file imports `node:*` and nothing else: no `server/`, no `shared/`. `ccrc backup`,
// `ccrc update` and `deploy.sh` run it from the INSTALLED tree, where the server's TypeScript is compiled and not importable, and
// a snapshot tool that needs the code it is protecting is a tool that fails with it. The cost is a second implementation of the
// journal's validation rules (canonical JSON, both hash preimages, the chain, the anchor triple, torn tails, coverage); the
// ONE-MEANING guarantee is a differential test (`server/test/coordination-snapshot.test.ts`) that feeds the same corpus to this
// file and to the server's `validateDelegationJournalBytes` and requires the same verdict, the same refusal code and the same
// coverage. It does NOT know the closed event-kind and lease-source vocabularies (those live in `shared/api.ts`, and a copy here
// would be a second spelling of them): it checks the record GRAMMAR and the hashes, which is what makes bytes a faithful copy;
// whether an event is one the server understands is the server's recovery, which runs again when the server starts.
// ONE RULE IS THIS FILE'S ALONE, with no server counterpart and so no row in the differential: `suffixAfter` (the first retained
// journal record must sit at or below the checkpoint's applied sequence plus one). It cannot fire in wave 3, which compacts
// nothing, and it is tested on this side only.
//
// WHAT IT NEVER DOES. It never opens `coord.db` for writing, never follows a symlink for a member or a marker, never writes
// outside the directory it is given (capture) or `~/.ccrc` (restore), and never touches a service: restore asks whether the
// server is running and refuses unless it MEASURES it inactive, and asks again once its marker is durable. While the marker stands,
// delegation recovery (`recoverDelegationFromFiles`) refuses to run; the server's boot is not yet wired to that refusal (Task 13). `backup-coord.mjs` stays the SQLite-only snapshot; this file
// reads the DB snapshot it made and describes it.
//
// VERBS (exit codes). `capture --dir <timestamp dir>`: 0 manifest durable, 1 refused or exhausted (no manifest, no partials).
// `classify --from <dir>` prints `v1`, `legacy`, `none` or `invalid` and exits 0, 0, 1, 2. `validate --from <dir>` is `classify`
// with its reasons: line 1 is `<word>: <reason>`, line 2 is `data: yes|no` (a v1 snapshot with any member present, or a legacy
// one, holds data; the retention keeps the newest such snapshot beside the newest valid one, D-4641). `restore --from <dir>`: 0 done, 1 failed (the live set is the old one, or `recover` finishes it), 2 refused
// before any live mutation. `recover`: finishes an interrupted restore, 0 / 1 / 2 the same way. 70: usage, or the helper itself
// failed (an exception it did not name).
import { createHash } from 'node:crypto';
import nodeFs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ── Names ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const JOURNAL_FILE = 'delegation-events.log';
export const CHECKPOINT_FILE = 'delegation-checkpoint.json';
export const DB_FILE = 'coord.db';
export const MANIFEST_FILE = 'coordination-snapshot.json';
/** Live restore bookkeeping, in the coordination directory itself. Delegation recovery refuses to run while the marker exists (the server's boot is not yet wired to it, Task 13). */
export const RESTORE_MARKER_FILE = 'coordination-restore.json';
export const RESTORE_STAGE_DIR = 'coordination-restore.stage';
/** The five files a restore replaces as one set. WAL and SHM are not manifest members: a restored DB must never meet an old WAL. */
export const RESTORE_SET = Object.freeze([JOURNAL_FILE, CHECKPOINT_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`, DB_FILE]);
/** Exactly five attempts, with these pauses between them. */
export const CAPTURE_RETRY_DELAYS_MS = Object.freeze([10, 25, 50, 100]);
export const SERVICE_UNIT = 'ccrc.service';

const MANIFEST_FORMAT = 'ccrc-coordination-snapshot';
const MARKER_FORMAT = 'ccrc-coordination-restore';

export class SnapError extends Error {
  /** @param {string} code @param {string} detail @param {{retryable?: boolean, exit?: number}} [opts] */
  constructor(code, detail, opts = {}) {
    super(`${code}: ${detail}`);
    this.name = 'SnapError';
    this.code = code;
    this.retryable = opts.retryable === true;
    this.exit = opts.exit ?? 1;
  }
}
const refuse = (code, detail, opts) => { throw new SnapError(code, detail, opts); };

// ── Canonical JSON (RFC 8785 over the closed domain the journal uses) ──────────────────────────────────────────────────

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Canonical text of a value that came out of `JSON.parse` or was built here (so: plain objects, arrays, strings, finite numbers,
 *  booleans, null). Refuses an unsafe integer, a non-finite number and a lone surrogate, in a value or in a key. */
export function canonicalJson(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'string':
      if (LONE_SURROGATE.test(value)) refuse('invalid-domain', 'a string holds a lone surrogate');
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) refuse('invalid-domain', 'a number is not finite');
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) refuse('invalid-domain', 'an integer is outside the safe range');
      return JSON.stringify(value);
    case 'object': break;
    default: refuse('invalid-domain', `a ${typeof value} is outside the JSON domain`);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const names = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${names.map((k) => {
    if (LONE_SURROGATE.test(k)) refuse('invalid-domain', 'a key holds a lone surrogate');
    return `${JSON.stringify(k)}:${canonicalJson(value[k])}`;
  }).join(',')}}`;
}

/** Whether a JSON text repeats a key in any one object, at any depth (`JSON.parse` keeps the last of two equal keys). */
export function findJsonDefect(text) {
  let i = 0;
  let defect = null;
  const ws = () => { while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; };
  const bad = () => { defect ??= 'malformed-json'; throw new Error('stop'); };
  const string = () => {
    const start = i;
    if (text[i] !== '"') bad();
    i++;
    while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i += text[i + 1] === 'u' ? 6 : 2; else i++; }
    if (i >= text.length) bad();
    i++;
    try { return JSON.parse(text.slice(start, i)); } catch { return bad(); }
  };
  const value = (depth) => {
    if (depth > 64) bad();
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const keys = new Set();
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
  try { value(0); ws(); if (i !== text.length) bad(); } catch { return defect ?? 'malformed-json'; }
  return defect;
}

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const isHex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isInstant = (v) => {
  if (typeof v !== 'string' || !CANONICAL_INSTANT.test(v)) return false;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && ms >= 0 && new Date(ms).toISOString() === v;
};
const isSeq = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

// ── The journal record grammar (the same rules, codes and order as the server's decoder; no vocabularies) ────────────────

const RECORD_KEYS = ['v', 'sequence', 'journalId', 'acceptedAt', 'previousDigest', 'entry', 'digest'];
const LEASE_ENTRY_KEYS = [
  'kind', 'leaseId', 'generation', 'activityId', 'parentId', 'parentIncarnation', 'project', 'adminRecord', 'canonicalPath',
  'creationBase', 'sourceKind', 'correlationJournalIds', 'firstObservedAt', 'lineageId',
];

function exactKeys(o, keys, what, codes = ['unknown-key', 'bad-field']) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) refuse(codes[0], `${what} has the unknown key ${JSON.stringify(k)}`);
  for (const k of keys) if (!Object.hasOwn(o, k)) refuse(codes[1], `${what} is missing ${JSON.stringify(k)}`);
}
const nonEmpty = (v, what) => (typeof v === 'string' && v !== '' ? v : refuse('bad-field', `${what} is not a non-empty string`));
const hex64 = (v, what) => (isHex64(v) ? v : refuse('bad-field', `${what} is not a lowercase 64-hex SHA-256`));

function isEventEnvelope(v) {
  if (!isRecord(v) || v.v !== 1 || typeof v.eventKind !== 'string' || v.eventKind === '') return false;
  for (const k of ['sessionId', 'parentIncarnation', 'claudeSessionId', 'eventId', 'bucket']) if (typeof v[k] !== 'string' || v[k] === '') return false;
  const { startOffset, endOffset } = v;
  if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || !Number.isSafeInteger(startOffset)
      || !Number.isSafeInteger(endOffset) || startOffset < 0 || endOffset <= startOffset) return false;
  if (!isInstant(v.observedAt)) return false;
  return v.agentId === undefined || typeof v.agentId === 'string';
}

function validateEntry(entry) {
  if (!isRecord(entry)) return refuse('bad-field', 'entry is not an object');
  if (entry.kind === 'evidence-accepted') {
    exactKeys(entry, ['kind', 'event'], 'an evidence-accepted entry');
    if (!isEventEnvelope(entry.event)) return refuse('bad-field', 'an evidence-accepted entry\'s event is not an envelope with the keys the journal reads');
    return { kind: 'evidence-accepted', event: entry.event };
  }
  if (entry.kind === 'lease-created') {
    exactKeys(entry, LEASE_ENTRY_KEYS, 'a lease-created entry');
    if (entry.generation !== 0) refuse('bad-field', 'a lease-created entry is generation 0');
    nonEmpty(entry.sourceKind, 'sourceKind');
    const ids = entry.correlationJournalIds;
    if (!Array.isArray(ids)) return refuse('bad-field', 'correlationJournalIds is not a list');
    if (!ids.every(isHex64)) refuse('bad-field', 'correlationJournalIds is not a list of lowercase 64-hex SHA-256 values');
    const base = entry.creationBase;
    if (base !== null && (typeof base !== 'string' || base === '')) return refuse('bad-field', 'creationBase is neither null nor a non-empty string');
    if (!isInstant(entry.firstObservedAt)) refuse('bad-field', 'firstObservedAt is not a canonical UTC millisecond instant');
    return {
      kind: 'lease-created', leaseId: nonEmpty(entry.leaseId, 'leaseId'), generation: 0, activityId: hex64(entry.activityId, 'activityId'),
      parentId: nonEmpty(entry.parentId, 'parentId'), parentIncarnation: nonEmpty(entry.parentIncarnation, 'parentIncarnation'),
      project: nonEmpty(entry.project, 'project'), adminRecord: nonEmpty(entry.adminRecord, 'adminRecord'),
      canonicalPath: nonEmpty(entry.canonicalPath, 'canonicalPath'), creationBase: base, sourceKind: entry.sourceKind,
      correlationJournalIds: [...ids], firstObservedAt: entry.firstObservedAt, lineageId: hex64(entry.lineageId, 'lineageId'),
    };
  }
  return refuse('bad-field', `entry kind ${JSON.stringify(entry.kind)} is not in the closed grammar`);
}

/** `journalId = SHA256(canon({v, sequence, acceptedAt, previousDigest, entry}))`: nonrecursive. */
export const journalIdOf = (r) => sha256Hex(canonicalJson({ v: 1, sequence: r.sequence, acceptedAt: r.acceptedAt, previousDigest: r.previousDigest, entry: r.entry }));
/** `digest = SHA256(canon({v, sequence, journalId, acceptedAt, previousDigest, entry}))`: carries `previousDigest`, never itself. */
export const digestOf = (r) => sha256Hex(canonicalJson({ v: 1, sequence: r.sequence, journalId: r.journalId, acceptedAt: r.acceptedAt, previousDigest: r.previousDigest, entry: r.entry }));

/** One journal line (LF removed) into a record, strictly. */
export function decodeJournalLine(line) {
  if (line.length >= 3 && line[0] === 0xef && line[1] === 0xbb && line[2] === 0xbf) refuse('bom', 'a byte-order mark');
  if (line.length === 0) refuse('blank-line', 'an empty line');
  if (line[line.length - 1] === 0x0d) refuse('crlf', 'a line ends in CR before its LF');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(line); } catch { return refuse('invalid-utf8', 'the line is not valid UTF-8'); }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return refuse('malformed-json', 'the line is not JSON'); }
  if (!isRecord(parsed)) return refuse('bad-field', 'the line is not a JSON object');
  exactKeys(parsed, RECORD_KEYS, 'a record');
  if (parsed.v !== 1) refuse('bad-field', 'v is not 1');
  if (!isSeq(parsed.sequence)) refuse('sequence-domain', `${String(parsed.sequence)} is not a positive safe integer`);
  if (!isInstant(parsed.acceptedAt)) refuse('bad-field', 'acceptedAt is not a canonical UTC millisecond instant');
  const previousDigest = parsed.previousDigest;
  if (previousDigest !== null && !isHex64(previousDigest)) refuse('bad-field', 'previousDigest is neither null nor a lowercase 64-hex SHA-256');
  const journalId = hex64(parsed.journalId, 'journalId');
  const digest = hex64(parsed.digest, 'digest');
  const entry = validateEntry(parsed.entry);
  const record = { v: 1, sequence: parsed.sequence, journalId, acceptedAt: parsed.acceptedAt, previousDigest, entry, digest };
  const canonical = canonicalJson(record);
  if (canonical !== text) {
    if (findJsonDefect(text) === 'duplicate-key') refuse('duplicate-key', 'an object repeats a key');
    refuse('noncanonical', 'the line is not the canonical encoding of its own value');
  }
  if (journalIdOf(record) !== journalId) refuse('journal-id-mismatch', 'journalId is not SHA-256 of its preimage');
  if (digestOf(record) !== digest) refuse('digest-mismatch', 'digest is not SHA-256 of its preimage');
  return record;
}

/** The error for bytes after the last LF: `missing-final-lf` when they are one complete valid record, `torn-tail` otherwise. */
function tornTailError(leftover) {
  try {
    decodeJournalLine(leftover);
    return new SnapError('missing-final-lf', 'the last record has no LF after it', { retryable: true });
  } catch {
    return new SnapError('torn-tail', `${leftover.length} bytes follow the last LF and are not a complete record`, { retryable: true });
  }
}

/** The incremental hash-chain verifier: contiguous sequences, `previousDigest` chaining, and the anchor triple. */
export class JournalChain {
  constructor(opts = {}) {
    this.opts = opts;
    this.count = 0;
    this.first = null;
    this.last = null;
    this.anchorSeen = false;
  }

  accept(record) {
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

  finish() {
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

/** A streaming whole-journal validator: `push` chunks in file order, then `finish`. One meaning for a buffer and for a file. */
export class JournalValidator {
  constructor(expect = {}) {
    this.chain = new JournalChain(expect);
    this.held = new Set(expect.heldJournalIds ?? []);
    this.pending = new Uint8Array(0);
    this.line = 0;
    this.bytes = 0;
    this.firstChecked = false;
    this.expect = expect;
  }

  push(chunk) {
    this.bytes += chunk.length;
    const buf = new Uint8Array(this.pending.length + chunk.length);
    buf.set(this.pending, 0);
    buf.set(chunk, this.pending.length);
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 0x0a) continue;
      this.line++;
      const record = decodeJournalLine(buf.subarray(start, i));
      this.chain.accept(record);
      if (!this.firstChecked) {
        this.firstChecked = true;
        const after = this.expect.suffixAfter;
        if (typeof after === 'number' && record.sequence > after + 1) {
          refuse('sequence-gap', `the retained journal begins at ${record.sequence}, past the sequence after the checkpoint's ${after}`);
        }
      }
      this.held.delete(record.journalId);
      start = i + 1;
    }
    this.pending = buf.subarray(start);
  }

  finish() {
    if (this.pending.length > 0) throw tornTailError(this.pending);
    const coverage = this.chain.finish();
    if (this.held.size > 0) refuse('held-evidence-missing', `${this.held.size} held journal ID(s) are not retained, first ${[...this.held][0]}`);
    return coverage;
  }
}

/** Validates a whole journal held as bytes. Same rules, same codes, same coverage as the streaming form. */
export function validateJournalBytes(bytes, expect = {}) {
  const v = new JournalValidator(expect);
  v.push(bytes);
  return v.finish();
}

// ── The checkpoint: canonical shape of what a snapshot must agree with ───────────────────────────────────────────────────

const CHECKPOINT_KEYS = [
  'v', 'revision', 'appliedJournalSequence', 'appliedJournalId', 'appliedJournalDigest', 'activityIdsByNaturalKey', 'coordinatorIntentByParent',
  'sessions', 'attempts', 'activities', 'leases', 'lineage', 'bucketCursors', 'observationIntervals', 'pruningHolds',
];
const CHECKPOINT_LISTS = ['sessions', 'attempts', 'activities', 'leases', 'lineage', 'bucketCursors', 'observationIntervals', 'pruningHolds'];

/**
 * The checkpoint file's bytes, strictly, as far as a snapshot needs: canonical JSON plus one LF, the closed top-level key set, its
 * revision, the applied position and the pruning holds that name journal records. Row-level semantics (identity, projectability,
 * leases) are the server's recovery, which runs again when it starts.
 */
export function readCheckpointHeader(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) refuse('bom', 'a byte-order mark');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return refuse('invalid-utf8', 'not valid UTF-8'); }
  if (!text.endsWith('\n')) refuse('missing-final-lf', 'the checkpoint does not end in LF');
  const body = text.slice(0, -1);
  if (body.endsWith('\r') || body.includes('\n')) refuse('crlf', 'the checkpoint is one line with one LF');
  let parsed;
  try { parsed = JSON.parse(body); } catch { return refuse('malformed-json', 'not JSON'); }
  if (!isRecord(parsed)) return refuse('bad-shape', 'checkpoint is not an object');
  exactKeys(parsed, CHECKPOINT_KEYS, 'checkpoint', ['bad-shape', 'bad-shape']);
  if (parsed.v !== 1) refuse('bad-version', 'checkpoint v is not 1');
  const int0 = (v, what) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : refuse('bad-shape', `${what} is not a safe integer >= 0`));
  const revision = int0(parsed.revision, 'revision');
  const applied = int0(parsed.appliedJournalSequence, 'appliedJournalSequence');
  const id = parsed.appliedJournalId;
  const dg = parsed.appliedJournalDigest;
  if ((id !== null && !isHex64(id)) || (dg !== null && !isHex64(dg))) refuse('bad-shape', 'the applied journalId and digest are null or lowercase 64-hex');
  if ((applied === 0) !== (id === null) || (id === null) !== (dg === null)) refuse('bad-anchor', 'the applied position, journalId and digest are all zero/null or all set');
  for (const k of CHECKPOINT_LISTS) if (!Array.isArray(parsed[k])) refuse('bad-shape', `checkpoint.${k} is not a list`);
  for (const k of ['activityIdsByNaturalKey', 'coordinatorIntentByParent']) if (!isRecord(parsed[k])) refuse('bad-shape', `checkpoint.${k} is not an object`);
  const held = [];
  for (const h of parsed.pruningHolds) {
    if (!isRecord(h) || !isHex64(h.journalId) || typeof h.reason !== 'string') refuse('bad-shape', 'a pruning hold is not {journalId, reason, ownerId}');
    if (h.reason === 'checkpoint-anchor' || h.reason === 'identity-candidate') held.push(h.journalId);
  }
  let canonical;
  try { canonical = canonicalJson(parsed); } catch (err) {
    if (err instanceof SnapError) return refuse('noncanonical', err.message);
    throw err;
  }
  if (canonical !== body) {
    if (findJsonDefect(body) === 'duplicate-key') refuse('duplicate-key', 'an object repeats a key');
    refuse('noncanonical', 'the checkpoint is not the canonical encoding of its own value');
  }
  return {
    revision,
    appliedJournalSequence: applied,
    anchor: applied === 0 ? null : { sequence: applied, journalId: id, digest: dg },
    heldJournalIds: [...new Set(held)],
  };
}

// ── The file port (every operation the helper performs; a test faults any one of them) ───────────────────────────────────

const C = nodeFs.constants;
const isEnoent = (err) => typeof err === 'object' && err !== null && err.code === 'ENOENT';

/** The real filesystem. Absence is `null` from `lstat`, `readFile`, `openRead` and `readdir`, for ENOENT only. */
export const realFs = {
  lstat(p) { try { return nodeFs.lstatSync(p); } catch (err) { if (isEnoent(err)) return null; throw err; } },
  readFile(p) {
    let fd;
    try { fd = nodeFs.openSync(p, C.O_RDONLY | C.O_NOFOLLOW); } catch (err) { if (isEnoent(err)) return null; throw err; }
    try { return new Uint8Array(nodeFs.readFileSync(fd)); } finally { nodeFs.closeSync(fd); }
  },
  openRead(p) {
    let fd;
    try { fd = nodeFs.openSync(p, C.O_RDONLY | C.O_NOFOLLOW); } catch (err) { if (isEnoent(err)) return null; throw err; }
    let size;
    try { size = nodeFs.fstatSync(fd).size; } catch (err) { nodeFs.closeSync(fd); throw err; }
    return {
      size,
      read(position, length) {
        const buf = new Uint8Array(length);
        const n = nodeFs.readSync(fd, buf, 0, length, position);
        return buf.subarray(0, n);
      },
      close() { nodeFs.closeSync(fd); },
    };
  },
  create(p) {
    const fd = nodeFs.openSync(p, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
    return {
      write(bytes) {
        let at = 0;
        while (at < bytes.length) at += nodeFs.writeSync(fd, bytes, at, bytes.length - at);
      },
      fsync() { nodeFs.fsyncSync(fd); },
      close() { nodeFs.closeSync(fd); },
    };
  },
  rename(from, to) { nodeFs.renameSync(from, to); },
  /** Removes a file; false when it was already absent. */
  unlink(p) { try { nodeFs.unlinkSync(p); return true; } catch (err) { if (isEnoent(err)) return false; throw err; } },
  mkdir(p) { nodeFs.mkdirSync(p, { mode: 0o700 }); },
  rmdir(p) { nodeFs.rmdirSync(p); },
  readdir(p) { try { return nodeFs.readdirSync(p); } catch (err) { if (isEnoent(err)) return null; throw err; } },
  fsyncDir(p) {
    const fd = nodeFs.openSync(p, C.O_RDONLY);
    try { nodeFs.fsyncSync(fd); } finally { nodeFs.closeSync(fd); }
  },
  fsyncFile(p) {
    const fd = nodeFs.openSync(p, C.O_RDONLY | C.O_NOFOLLOW);
    try { nodeFs.fsyncSync(fd); } finally { nodeFs.closeSync(fd); }
  },
};

const CHUNK = 1 << 18;

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** Hash and size of a regular file, read in chunks and never followed through a symlink. */
function measureFile(fs, p) {
  const h = fs.openRead(p);
  if (h === null) return null;
  try {
    const hash = createHash('sha256');
    for (let at = 0; at < h.size;) {
      const chunk = h.read(at, Math.min(CHUNK, h.size - at));
      if (chunk.length === 0) refuse('short-read', `${path.basename(p)} ended before its ${h.size} bytes`);
      hash.update(chunk);
      at += chunk.length;
    }
    return { bytes: h.size, sha256: hash.digest('hex') };
  } finally { h.close(); }
}

/** Streams a regular file through a validator. */
function feedFile(fs, p, validator) {
  const h = fs.openRead(p);
  if (h === null) return false;
  try {
    for (let at = 0; at < h.size;) {
      const chunk = h.read(at, Math.min(CHUNK, h.size - at));
      if (chunk.length === 0) refuse('short-read', `${path.basename(p)} ended before its ${h.size} bytes`);
      validator.push(chunk);
      at += chunk.length;
    }
  } finally { h.close(); }
  return true;
}

/** Writes bytes to `final` through a helper-owned `.partial` sibling: create, write, fsync, close, rename, fsync the directory. */
function writeAtomic(fs, final, bytes) {
  const tmp = `${final}.partial`;
  fs.unlink(tmp);
  const h = fs.create(tmp);
  try { h.write(bytes); h.fsync(); } finally { h.close(); }
  fs.rename(tmp, final);
  fs.fsyncDir(path.dirname(final));
}

const asBytes = (text) => new TextEncoder().encode(text);

// ── SQLite: read-only checks of a snapshot ──────────────────────────────────────────────────────────────────────────────

const SQLITE_MAGIC = 'SQLite format 3\u0000';

/**
 * Whether a file is a readable SQLite database, and whether it holds a `delegation_*` table. A header check first (a text
 * placeholder is not a database), then a read-only open, `quick_check`, and the table list. Never writes.
 * @returns {{ok: true, delegationTables: string[]} | {ok: false, why: string}}
 */
export function inspectDb(p) {
  let head;
  try {
    const fd = nodeFs.openSync(p, C.O_RDONLY | C.O_NOFOLLOW);
    try { head = Buffer.alloc(16); nodeFs.readSync(fd, head, 0, 16, 0); } finally { nodeFs.closeSync(fd); }
  } catch (err) { return { ok: false, why: `unreadable (${err.code ?? 'error'})` }; }
  if (head.toString('latin1') !== SQLITE_MAGIC) return { ok: false, why: 'not a SQLite database (bad header)' };
  let db;
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    db = new DatabaseSync(p, { readOnly: true });
    const check = db.prepare('PRAGMA quick_check').all();
    if (check.length !== 1 || check[0].quick_check !== 'ok') return { ok: false, why: 'quick_check failed' };
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    return { ok: true, delegationTables: names.filter((n) => n.startsWith('delegation_')) };
  } catch (err) {
    return { ok: false, why: `cannot be opened read-only (${err.code ?? err.message})` };
  } finally {
    try { db?.close(); } catch { /* the check is over */ }
  }
}

// ── Sidecar validation: one meaning for capture, classify and restore ──────────────────────────────────────────────────

/**
 * Reads and validates a journal/checkpoint pair held at two paths (either may be absent) and returns what a manifest carries.
 * The checkpoint's strict header comes first; its anchor and holds then constrain the whole journal: every record, both hashes,
 * the chain, the anchor triple, every held record retained, a suffix that reaches the checkpoint's position, and a copied EOF with
 * no torn tail.
 */
export function validateSidecars(fs, { checkpointBytes, journalPath }) {
  let header = null;
  if (checkpointBytes !== null) header = readCheckpointHeader(checkpointBytes);
  const applied = header?.appliedJournalSequence ?? 0;
  const validator = new JournalValidator({
    completeFromStart: applied === 0, anchor: header?.anchor ?? null, heldJournalIds: header?.heldJournalIds ?? [], suffixAfter: applied,
  });
  const present = feedFile(fs, journalPath, validator);
  if (!present && header?.anchor != null) refuse('anchor-missing', 'the checkpoint is anchored in a journal that is absent');
  const coverage = present
    ? validator.finish()
    : { firstSequence: null, lastSequence: null, recordCount: 0, firstPreviousDigest: null, copiedEof: null };
  return { revision: header?.revision ?? 0, anchor: header?.anchor ?? null, coverage, journalPresent: present, checkpointPresent: header !== null };
}

function delegationOf(v) {
  if (!v.journalPresent && !v.checkpointPresent) return { state: 'absent', checkpointRevision: null, anchor: null, journal: null };
  return { state: 'initialized', checkpointRevision: v.revision, anchor: v.anchor, journal: v.coverage };
}

// ── Capture ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const memberOf = (filename, m) => (m === null ? { filename, present: false } : { filename, present: true, bytes: m.bytes, sha256: m.sha256 });

/**
 * Takes a coordination snapshot into `dir` (a fresh timestamp directory that already holds the SQLite snapshot
 * `backup-coord.mjs` made, when the live DB exists), and writes the manifest LAST.
 *
 * Up to FIVE attempts, pausing 10, 25, 50 and 100 ms between them. One attempt: read checkpoint A; open the journal WITHOUT
 * following a symlink and copy exactly the byte count `fstat` reports on that opened inode; read checkpoint B and require it
 * byte-equal to A (else the checkpoint moved: retry); validate the checkpoint, the whole copied journal (pre-anchor records,
 * anchor, suffix, copied EOF); validate and hash the expected SQLite snapshot; make every member durable; and only then write
 * the manifest. A torn tail or a moved checkpoint is retryable (a writer was mid-append); a refusal is not. Exhaustion, or any
 * failure, removes the files this run created and writes no manifest.
 *
 * @param {{home: string, dir: string, fs?: typeof realFs, sleep?: (ms: number) => void, now?: () => Date,
 *          hooks?: {afterJournalCopy?: (attempt: number) => void}}} opts
 */
export function capture(opts) {
  const fs = opts.fs ?? realFs;
  const sleep = opts.sleep ?? sleepSync;
  const now = opts.now ?? (() => new Date());
  const ccrcDir = path.join(opts.home, '.ccrc');
  const dir = opts.dir;
  const names = {
    journal: path.join(dir, JOURNAL_FILE), checkpoint: path.join(dir, CHECKPOINT_FILE), db: path.join(dir, DB_FILE), manifest: path.join(dir, MANIFEST_FILE),
  };
  const owned = [];     // files this run created (finals), removed on failure
  const partials = [`${names.journal}.partial`, `${names.checkpoint}.partial`, `${names.manifest}.partial`];
  const cleanup = () => {
    // The manifest first: if the run died after naming it, no member may be removed while it still describes them.
    for (const p of [names.manifest, ...partials, ...owned]) { try { fs.unlink(p); } catch { /* best effort: a dead filesystem cannot be cleaned */ } }
    owned.length = 0;
  };
  if (fs.lstat(dir)?.isDirectory() !== true) refuse('bad-dir', 'the snapshot directory does not exist');
  if (fs.lstat(names.manifest) !== null) refuse('manifest-exists', 'the snapshot directory already holds a manifest');
  const delays = CAPTURE_RETRY_DELAYS_MS;
  const attempts = delays.length + 1;
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const manifest = attemptOnce(attempt);
      return manifest;
    } catch (err) {
      cleanup();
      if (!(err instanceof SnapError) || !err.retryable) throw err;
      last = err;
      if (attempt < attempts) sleep(delays[attempt - 1]);
    }
  }
  throw new SnapError('capture-exhausted', `the sidecars kept moving or tearing for ${attempts} attempts (last: ${last?.message ?? 'unknown'})`);

  function copyJournal() {
    const h = fs.openRead(path.join(ccrcDir, JOURNAL_FILE));
    if (h === null) return null;
    try {
      const out = fs.create(partials[0]);
      try {
        const hash = createHash('sha256');
        for (let at = 0; at < h.size;) {
          const chunk = h.read(at, Math.min(CHUNK, h.size - at));
          if (chunk.length === 0) refuse('journal-shrank', 'the journal ended before the size fstat reported', { retryable: true });
          out.write(chunk);
          hash.update(chunk);
          at += chunk.length;
        }
        out.fsync();
        return { bytes: h.size, sha256: hash.digest('hex') };
      } finally { out.close(); }
    } finally { h.close(); }
  }

  function attemptOnce(attempt) {
    const liveCheckpoint = path.join(ccrcDir, CHECKPOINT_FILE);
    const a = fs.readFile(liveCheckpoint);
    const journal = copyJournal();
    opts.hooks?.afterJournalCopy?.(attempt);
    const b = fs.readFile(liveCheckpoint);
    if ((a === null) !== (b === null) || (a !== null && b !== null && Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0)) {
      refuse('checkpoint-moved', 'the checkpoint changed while the journal was copied', { retryable: true });
    }
    // A checkpoint with no journal is a sound state only at sequence 0; validateSidecars refuses the anchored case.
    const verdict = validateSidecars(fs, { checkpointBytes: a, journalPath: journal === null ? names.journal : partials[0] });
    let checkpoint = null;
    if (a !== null) {
      const out = fs.create(partials[1]);
      try { out.write(a); out.fsync(); } finally { out.close(); }
      checkpoint = { bytes: a.length, sha256: createHash('sha256').update(a).digest('hex') };
    }
    // The SQLite snapshot: expected exactly when the live DB exists.
    const liveDb = fs.lstat(path.join(ccrcDir, DB_FILE));
    const snap = fs.lstat(names.db);
    let db = null;
    if (liveDb !== null) {
      if (snap === null || !snap.isFile()) refuse('db-snapshot-missing', 'coord.db exists but its snapshot was not taken');
      const state = inspectDb(names.db);
      if (!state.ok) refuse('db-snapshot-invalid', `the coord.db snapshot ${state.why}`);
      db = measureFile(fs, names.db);
    } else if (snap !== null) {
      refuse('db-snapshot-unexpected', 'there is a coord.db snapshot but no live coord.db');
    }
    // Make every member durable, THEN name them, THEN write the manifest last.
    if (journal !== null) { fs.rename(partials[0], names.journal); owned.push(names.journal); }
    if (checkpoint !== null) { fs.rename(partials[1], names.checkpoint); owned.push(names.checkpoint); }
    if (db !== null) fs.fsyncFile(names.db);
    fs.fsyncDir(dir);
    fs.fsyncDir(path.dirname(dir));
    const manifest = {
      format: MANIFEST_FORMAT,
      version: 1,
      capturedAt: now().toISOString(),
      members: {
        delegationJournal: memberOf(JOURNAL_FILE, journal),
        delegationCheckpoint: memberOf(CHECKPOINT_FILE, checkpoint),
        coordDb: memberOf(DB_FILE, db),
      },
      delegation: delegationOf(verdict),
    };
    writeAtomic(fs, names.manifest, asBytes(`${canonicalJson(manifest)}\n`));
    owned.length = 0;
    return manifest;
  }
}

// ── Classify ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const MEMBER_KEYS = { delegationJournal: JOURNAL_FILE, delegationCheckpoint: CHECKPOINT_FILE, coordDb: DB_FILE };

function readManifest(fs, p) {
  const bytes = fs.readFile(p);
  if (bytes === null) refuse('manifest-missing', 'no manifest');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return refuse('manifest-invalid', 'the manifest is not UTF-8'); }
  if (!text.endsWith('\n') || text.slice(0, -1).includes('\n')) refuse('manifest-invalid', 'the manifest is not one line and one LF');
  const body = text.slice(0, -1);
  let m;
  try { m = JSON.parse(body); } catch { return refuse('manifest-invalid', 'the manifest is not JSON'); }
  if (!isRecord(m)) refuse('manifest-invalid', 'the manifest is not an object');
  exactKeys2(m, ['format', 'version', 'capturedAt', 'members', 'delegation'], 'the manifest');
  if (m.format !== MANIFEST_FORMAT || m.version !== 1) refuse('manifest-invalid', 'the manifest is not a ccrc-coordination-snapshot version 1');
  if (typeof m.capturedAt !== 'string' || Number.isNaN(Date.parse(m.capturedAt))) refuse('manifest-invalid', 'capturedAt is not an instant');
  if (!isRecord(m.members)) refuse('manifest-invalid', 'members is not an object');
  exactKeys2(m.members, Object.keys(MEMBER_KEYS), 'members');
  for (const [key, filename] of Object.entries(MEMBER_KEYS)) {
    const mem = m.members[key];
    if (!isRecord(mem) || mem.filename !== filename) refuse('manifest-invalid', `members.${key} does not name ${filename}`);
    if (mem.present === false) exactKeys2(mem, ['filename', 'present'], `members.${key}`);
    else if (mem.present === true) {
      exactKeys2(mem, ['filename', 'present', 'bytes', 'sha256'], `members.${key}`);
      if (!Number.isSafeInteger(mem.bytes) || mem.bytes < 0 || !isHex64(mem.sha256)) refuse('manifest-invalid', `members.${key} bytes or sha256 is malformed`);
    } else refuse('manifest-invalid', `members.${key}.present is not a boolean`);
  }
  const d = m.delegation;
  if (!isRecord(d)) refuse('manifest-invalid', 'delegation is not an object');
  exactKeys2(d, ['state', 'checkpointRevision', 'anchor', 'journal'], 'delegation');
  if (d.state === 'absent') {
    if (d.checkpointRevision !== null || d.anchor !== null || d.journal !== null) refuse('manifest-invalid', 'an absent delegation carries no revision, anchor or journal');
  } else if (d.state === 'initialized') {
    if (!Number.isSafeInteger(d.checkpointRevision) || d.checkpointRevision < 0) refuse('manifest-invalid', 'checkpointRevision is not a safe integer');
    if (d.anchor !== null) {
      if (!isRecord(d.anchor)) refuse('manifest-invalid', 'anchor is not a position');
      exactKeys2(d.anchor, ['sequence', 'journalId', 'digest'], 'anchor');
      if (!isSeq(d.anchor.sequence) || !isHex64(d.anchor.journalId) || !isHex64(d.anchor.digest)) refuse('manifest-invalid', 'anchor is malformed');
    }
    if (!isRecord(d.journal)) refuse('manifest-invalid', 'journal coverage is not an object');
    exactKeys2(d.journal, ['firstSequence', 'lastSequence', 'recordCount', 'firstPreviousDigest', 'copiedEof'], 'journal coverage');
  } else refuse('manifest-invalid', 'delegation.state is neither absent nor initialized');
  let canonical;
  try { canonical = canonicalJson(m); } catch { return refuse('manifest-invalid', 'the manifest is outside the canonical domain'); }
  if (canonical !== body) refuse('manifest-invalid', 'the manifest is not the canonical encoding of its own value');
  return m;
}

function exactKeys2(o, keys, what) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) refuse('manifest-invalid', `${what} has the unknown key ${JSON.stringify(k)}`);
  for (const k of keys) if (!Object.hasOwn(o, k)) refuse('manifest-invalid', `${what} is missing ${JSON.stringify(k)}`);
}

/** Checks a v1 snapshot directory against its manifest, member by member and as a delegation pair. Throws a SnapError when it does not agree. */
function verifyV1(fs, from) {
  const manifest = readManifest(fs, path.join(from, MANIFEST_FILE));
  for (const [key, filename] of Object.entries(MEMBER_KEYS)) {
    const mem = manifest.members[key];
    const p = path.join(from, filename);
    const st = fs.lstat(p);
    if (!mem.present) {
      if (st !== null) refuse('member-undeclared', `${filename} is in the directory but the manifest says it is absent`);
      continue;
    }
    if (st === null) refuse('member-missing', `${filename} is in the manifest and not in the directory`);
    if (!st.isFile()) refuse('member-not-file', `${filename} is not a regular file`);
    const got = measureFile(fs, p);
    if (got === null || got.bytes !== mem.bytes) refuse('member-size', `${filename} is ${got?.bytes ?? 'absent'} bytes, the manifest says ${mem.bytes}`);
    if (got.sha256 !== mem.sha256) refuse('member-hash', `${filename} does not match the manifest's SHA-256`);
  }
  if (manifest.members.coordDb.present) {
    const state = inspectDb(path.join(from, DB_FILE));
    if (!state.ok) refuse('db-invalid', `coord.db ${state.why}`);
  }
  const cp = manifest.members.delegationCheckpoint.present ? fs.readFile(path.join(from, CHECKPOINT_FILE)) : null;
  const verdict = validateSidecars(fs, { checkpointBytes: cp, journalPath: path.join(from, JOURNAL_FILE) });
  if (verdict.journalPresent !== manifest.members.delegationJournal.present) refuse('member-undeclared', 'the journal member disagrees with the manifest');
  if (canonicalJson(delegationOf(verdict)) !== canonicalJson(manifest.delegation)) refuse('delegation-mismatch', 'the manifest\'s delegation section does not describe the copied sidecars');
  return manifest;
}

/**
 * Classifies a timestamp directory. `v1`: a valid manifest and everything it names. `legacy`: no manifest and no sidecars, a valid
 * coord.db with no `delegation_*` table. `none`: no coordination snapshot at all. `invalid`: anything else that claims to be
 * one. A PRESENT manifest that is invalid is `invalid` and never falls back to the DB beside it.
 * `data` is true for a v1 snapshot with any member present and for a legacy one (validated, never inferred from file presence).
 * @returns {{kind: 'v1' | 'legacy' | 'none' | 'invalid', reason: string, manifest: object | null, data?: boolean}}
 */
export function classify({ from, fs = realFs }) {
  const st = fs.lstat(from);
  if (st === null || !st.isDirectory()) return { kind: 'invalid', reason: 'the path is not a directory', manifest: null };
  if (fs.lstat(path.join(from, MANIFEST_FILE)) !== null) {
    try {
      const manifest = verifyV1(fs, from);
      const data = Object.values(manifest.members).some((m) => m.present);
      return { kind: 'v1', reason: `a valid manifest, ${manifest.delegation.state} delegation, coord.db ${manifest.members.coordDb.present ? 'present' : 'absent'}`, manifest, data };
    } catch (err) {
      if (err instanceof SnapError) return { kind: 'invalid', reason: err.message, manifest: null };
      // A symlink where a member should be, a directory, a permission error: the snapshot cannot be read as one, which is not "none".
      if (typeof err === 'object' && err !== null && typeof err.code === 'string') return { kind: 'invalid', reason: `unreadable (${err.code})`, manifest: null };
      throw err;
    }
  }
  for (const f of [JOURNAL_FILE, CHECKPOINT_FILE]) {
    if (fs.lstat(path.join(from, f)) !== null) return { kind: 'invalid', reason: `${f} is present without a manifest`, manifest: null };
  }
  const db = fs.lstat(path.join(from, DB_FILE));
  if (db === null) return { kind: 'none', reason: 'no manifest, no sidecars and no coord.db', manifest: null };
  if (!db.isFile()) return { kind: 'invalid', reason: 'coord.db is not a regular file', manifest: null };
  const state = inspectDb(path.join(from, DB_FILE));
  if (!state.ok) return { kind: 'invalid', reason: `coord.db ${state.why}`, manifest: null };
  if (state.delegationTables.length > 0) return { kind: 'invalid', reason: `coord.db holds ${state.delegationTables[0]} and has no manifest`, manifest: null };
  return { kind: 'legacy', reason: 'a valid coord.db from before the coordination sidecars', manifest: null, data: true };
}

// ── The service probe ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `inactive` only when the service manager says so. "Active", "activating", "deactivating", a missing `systemctl`, a timeout and
 * any answer it does not recognise are all NOT inactive: restore refuses on each, because it replaces the files a running
 * server holds open.
 * @returns {'inactive' | 'active' | 'unmeasured'}
 */
export function probeService(env = process.env) {
  const r = spawnSync('systemctl', ['--user', 'is-active', SERVICE_UNIT], { encoding: 'utf8', env, timeout: 10_000 });
  if (r.error || r.status === null) return 'unmeasured';
  const word = (r.stdout ?? '').trim();
  if (word === 'inactive' || word === 'failed') return 'inactive';
  if (['active', 'activating', 'deactivating', 'reloading', 'refreshing'].includes(word)) return 'active';
  return 'unmeasured';
}

// ── Restore and its recovery ──────────────────────────────────────────────────────────────────────────────────────────────

const stageOf = (ccrcDir) => path.join(ccrcDir, RESTORE_STAGE_DIR);
const markerOf = (ccrcDir) => path.join(ccrcDir, RESTORE_MARKER_FILE);

function readMarker(fs, ccrcDir) {
  const bytes = fs.readFile(markerOf(ccrcDir));
  if (bytes === null) return null;
  let m;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.endsWith('\n')) throw new Error('no LF');
    m = JSON.parse(text.slice(0, -1));
    if (canonicalJson(m) !== text.slice(0, -1)) throw new Error('noncanonical');
  } catch { return refuse('marker-invalid', 'the restore marker cannot be read; nothing can say which set is live', { exit: 2 }); }
  if (!isRecord(m) || m.format !== MARKER_FORMAT || m.version !== 1 || (m.state !== 'replacing' && m.state !== 'committed')
      || !isRecord(m.old) || !RESTORE_SET.every((n) => typeof m.old[n] === 'boolean')) {
    refuse('marker-invalid', 'the restore marker is not a version-1 marker', { exit: 2 });
  }
  return m;
}

function writeMarker(fs, ccrcDir, marker) {
  writeAtomic(fs, markerOf(ccrcDir), asBytes(`${canonicalJson(marker)}\n`));
}

/** Removes the stage directory (two levels, files only) and then the marker. Idempotent. */
function finalizeRestore(fs, ccrcDir) {
  const stage = stageOf(ccrcDir);
  for (const sub of ['old', 'new']) {
    const d = path.join(stage, sub);
    for (const f of fs.readdir(d) ?? []) fs.unlink(path.join(d, f));
    if (fs.lstat(d) !== null) fs.rmdir(d);
  }
  for (const f of fs.readdir(stage) ?? []) fs.unlink(path.join(stage, f));
  if (fs.lstat(stage) !== null) fs.rmdir(stage);
  fs.fsyncDir(ccrcDir);
  fs.unlink(markerOf(ccrcDir));
  fs.unlink(`${markerOf(ccrcDir)}.partial`);
  fs.fsyncDir(ccrcDir);
}

/** Puts the OLD set back, member by member, from what the marker recorded. Safe to run again from any point. */
function rollbackRestore(fs, ccrcDir, marker) {
  const stage = stageOf(ccrcDir);
  for (const name of RESTORE_SET) {
    const live = path.join(ccrcDir, name);
    const aside = path.join(stage, 'old', name);
    if (marker.old[name]) {
      if (fs.lstat(aside) !== null) {
        fs.unlink(live);          // the new member, if it was placed
        fs.rename(aside, live);
      }                          // else it was never set aside: the live file IS the old one
    } else {
      fs.unlink(live);            // old absent: whatever is there now is the new member
    }
  }
  fs.fsyncDir(ccrcDir);
}

function requireInactive(probe) {
  const state = probe();
  if (state !== 'inactive') {
    refuse('service-not-inactive', state === 'active'
      ? `${SERVICE_UNIT} is running; stop it first`
      : `${SERVICE_UNIT} could not be measured as inactive; nothing was changed`, { exit: 2 });
  }
}

/**
 * Replaces the live coordination set (journal, checkpoint, coord.db, its WAL and SHM) with a validated snapshot, as one unit.
 * Order: validate the source; require the service measured inactive; stage the new files beside the live ones; publish the
 * restore marker (from here delegation recovery refuses to run), probe the service again; set the old files aside and place the new; verify what was placed;
 * make `committed` durable; clean up and remove the marker. A failure before `committed` puts the old set back; one after
 * it finishes forward. An explicit manifest `coordDb.present:false` is the ONLY thing that removes the DB, WAL and SHM without
 * replacing them.
 * @param {{home: string, from: string, fs?: typeof realFs, probe?: () => string, now?: () => Date}} opts
 */
export function restore(opts) {
  const fs = opts.fs ?? realFs;
  const probe = opts.probe ?? (() => probeService());
  const now = opts.now ?? (() => new Date());
  const ccrcDir = path.join(opts.home, '.ccrc');
  // 1. The source is validated BEFORE anything live is touched, and must be a v1 snapshot.
  const verdict = classify({ from: opts.from, fs });
  if (verdict.kind !== 'v1') refuse('source-invalid', `the snapshot is ${verdict.kind}: ${verdict.reason}`, { exit: 2 });
  const manifest = verdict.manifest;
  // 2. The service must be MEASURED inactive. Active and unmeasurable both refuse.
  requireInactive(probe);
  // 3. An earlier restore that did not finish must be recovered first.
  if (fs.lstat(markerOf(ccrcDir)) !== null || fs.lstat(stageOf(ccrcDir)) !== null) {
    refuse('restore-pending', 'an earlier restore did not finish; run `recover` first', { exit: 2 });
  }
  if (fs.lstat(ccrcDir)?.isDirectory() !== true) refuse('no-ccrc-dir', 'the coordination directory does not exist', { exit: 2 });
  const stage = stageOf(ccrcDir);
  const newDir = path.join(stage, 'new');
  const oldDir = path.join(stage, 'old');
  const wanted = {};          // member filename -> manifest member, for those the snapshot has
  for (const [key, filename] of Object.entries(MEMBER_KEYS)) if (manifest.members[key].present) wanted[filename] = manifest.members[key];
  const old = {};
  for (const name of RESTORE_SET) old[name] = fs.lstat(path.join(ccrcDir, name)) !== null;
  let published = false;
  try {
    // 4. Stage the new files beside the live ones (same filesystem, so placement is a rename), hashing as they are written.
    fs.mkdir(stage);
    fs.mkdir(newDir);
    fs.mkdir(oldDir);
    for (const [filename, mem] of Object.entries(wanted)) {
      const src = fs.openRead(path.join(opts.from, filename));
      if (src === null) refuse('member-missing', `${filename} vanished from the snapshot`);
      try {
        const out = fs.create(path.join(newDir, filename));
        try {
          const hash = createHash('sha256');
          for (let at = 0; at < src.size;) {
            const chunk = src.read(at, Math.min(CHUNK, src.size - at));
            if (chunk.length === 0) refuse('short-read', `${filename} ended early`);
            out.write(chunk);
            hash.update(chunk);
            at += chunk.length;
          }
          out.fsync();
          if (hash.digest('hex') !== mem.sha256 || src.size !== mem.bytes) refuse('member-hash', `${filename} changed while it was staged`);
        } finally { out.close(); }
      } finally { src.close(); }
    }
    fs.fsyncDir(newDir);
    fs.fsyncDir(oldDir);
    fs.fsyncDir(stage);
    fs.fsyncDir(ccrcDir);
    // 5. Publish the active marker. From here on, delegation recovery refuses to run until it is gone.
    const marker = { format: MARKER_FORMAT, version: 1, state: 'replacing', startedAt: now().toISOString(), old };
    published = true;       // set BEFORE the write: a write that fails after its rename has still published the marker
    writeMarker(fs, ccrcDir, marker);
    // 5b. Ask again, now the marker is durable: a unit that started between the first probe and here would keep writing to inodes
    // about to be set aside. Not inactive: the catch below rolls back (nothing has moved yet), clears the marker and re-throws this.
    requireInactive(probe);
    // 6. Set the old files aside, then place the new ones.
    for (const name of RESTORE_SET) {
      if (old[name]) fs.rename(path.join(ccrcDir, name), path.join(oldDir, name));
    }
    fs.fsyncDir(oldDir);
    fs.fsyncDir(ccrcDir);
    for (const name of RESTORE_SET) {
      if (wanted[name] !== undefined) fs.rename(path.join(newDir, name), path.join(ccrcDir, name));
    }
    fs.fsyncDir(ccrcDir);
    // 7. Verify the placed set against the manifest: the five members, and the WAL/SHM absent.
    for (const name of RESTORE_SET) {
      const st = fs.lstat(path.join(ccrcDir, name));
      const mem = wanted[name];
      if (mem === undefined) {
        if (st !== null) refuse('verify-failed', `${name} is present and the snapshot has none`);
        continue;
      }
      const got = st !== null && st.isFile() ? measureFile(fs, path.join(ccrcDir, name)) : null;
      if (got === null || got.bytes !== mem.bytes || got.sha256 !== mem.sha256) refuse('verify-failed', `${name} does not match the snapshot after it was placed`);
    }
    // 8. COMMITTED, durably. After this line recovery goes forward; before it, backward.
    writeMarker(fs, ccrcDir, { ...marker, state: 'committed' });
  } catch (err) {
    if (!published) {
      try { finalizeRestoreStageOnly(fs, ccrcDir); } catch { /* the stage is helper-owned garbage; the live set was never touched */ }
      throw err;
    }
    try {
      const m = readMarker(fs, ccrcDir);
      // A marker already `committed` goes FORWARD, and that is `recover`'s: the new set is whole and in place.
      if (m === null || m.state === 'replacing') { rollbackRestore(fs, ccrcDir, m ?? { old }); finalizeRestore(fs, ccrcDir); }
    } catch { /* the marker stays: delegation recovery refuses to run and `recover` finishes it */ }
    throw err;
  }
  // 9. Clean up. A failure here leaves a committed marker that `recover` finalizes.
  finalizeRestore(fs, ccrcDir);
  return { restored: Object.keys(wanted), removed: RESTORE_SET.filter((n) => old[n] && wanted[n] === undefined) };
}

/** A restore that failed before it published its marker never touched the live set: remove its stage. */
function finalizeRestoreStageOnly(fs, ccrcDir) {
  const stage = stageOf(ccrcDir);
  fs.unlink(`${markerOf(ccrcDir)}.partial`);
  for (const sub of ['old', 'new']) {
    const d = path.join(stage, sub);
    for (const f of fs.readdir(d) ?? []) fs.unlink(path.join(d, f));
    if (fs.lstat(d) !== null) fs.rmdir(d);
  }
  if (fs.lstat(stage) !== null) fs.rmdir(stage);
}

/**
 * Finishes an interrupted restore from its marker: `replacing` goes BACK to the old set, `committed` goes FORWARD (the new set
 * is already in place; only the cleanup is left). No marker and no stage is "nothing to do"; a stage without a marker is a restore
 * that died before it touched anything, and its stage is removed.
 * @returns {'none' | 'rolled-back' | 'finalized' | 'cleaned'}
 */
export function recover(opts) {
  const fs = opts.fs ?? realFs;
  const probe = opts.probe ?? (() => probeService());
  const ccrcDir = path.join(opts.home, '.ccrc');
  const marker = readMarker(fs, ccrcDir);
  const hasStage = fs.lstat(stageOf(ccrcDir)) !== null;
  if (marker === null && !hasStage) return 'none';
  requireInactive(probe);
  if (marker === null) { finalizeRestoreStageOnly(fs, ccrcDir); return 'cleaned'; }
  if (marker.state === 'committed') { finalizeRestore(fs, ccrcDir); return 'finalized'; }
  rollbackRestore(fs, ccrcDir, marker);
  finalizeRestore(fs, ccrcDir);
  return 'rolled-back';
}

// ── The command line ───────────────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = 'usage: node coordination-snapshot.mjs capture --dir <timestamp dir> | classify --from <timestamp-directory> | validate --from <timestamp-directory> | restore --from <timestamp-directory> | recover';

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1 || i + 1 >= argv.length || argv[i + 1] === '' || argv[i + 1].startsWith('--')) return null;
  return argv[i + 1];
}

/** Runs one verb; returns the exit code. `io` is injectable for tests. */
export function main(argv, env = process.env, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  const [verb, ...rest] = argv;
  const home = env.HOME;
  try {
    if (verb === 'classify' || verb === 'validate') {
      const from = argValue(rest, '--from');
      if (from === null || rest.length !== 2) { io.err(`${USAGE}\n`); return 70; }
      const v = classify({ from: path.resolve(from) });
      if (verb === 'classify') io.out(`${v.kind}\n`);
      else io.out(`${v.kind}: ${v.reason}\ndata: ${v.data === true ? 'yes' : 'no'}\n`);
      return v.kind === 'v1' || v.kind === 'legacy' ? 0 : v.kind === 'none' ? 1 : 2;
    }
    if (typeof home !== 'string' || home === '' || !path.isAbsolute(home)) { io.err('coordination snapshot: HOME is not an absolute path\n'); return 70; }
    if (verb === 'capture') {
      const dir = argValue(rest, '--dir');
      if (dir === null || rest.length !== 2) { io.err(`${USAGE}\n`); return 70; }
      const m = capture({ home, dir: path.resolve(dir) });
      io.out(`coordination snapshot: ${m.delegation.state} delegation, coord.db ${m.members.coordDb.present ? 'present' : 'absent'}, manifest written\n`);
      return 0;
    }
    if (verb === 'restore') {
      const from = argValue(rest, '--from');
      if (from === null || rest.length !== 2) { io.err(`${USAGE}\n`); return 70; }
      const r = restore({ home, from: path.resolve(from) });
      io.out(`coordination snapshot restored: ${r.restored.length} member(s) placed, ${r.removed.length} removed\n`);
      return 0;
    }
    if (verb === 'recover') {
      if (rest.length !== 0) { io.err(`${USAGE}\n`); return 70; }
      const r = recover({ home });
      io.out(`coordination restore recovery: ${r}\n`);
      return 0;
    }
    io.err(`${USAGE}\n`);
    return 70;
  } catch (err) {
    if (err instanceof SnapError) { io.err(`coordination snapshot: ${err.message}\n`); return verb === 'classify' || verb === 'validate' ? 70 : err.exit; }
    io.err(`coordination snapshot: helper failure: ${err instanceof Error ? err.message : String(err)}\n`);
    return 70;
  }
}

const invokedDirectly = (() => {
  try { return process.argv[1] !== undefined && nodeFs.realpathSync(process.argv[1]) === nodeFs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
