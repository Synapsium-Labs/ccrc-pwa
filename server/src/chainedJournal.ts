// Overlord W1 (spec 2026-11-09 §7.6, H27): the hash-chained journal's kernel — the record envelope and its two preimages,
// the strict line codec, the chain verifier, the torn-tail rule, and the whole-bytes verifier and parser — stated once
// and generic over a journal's record grammar (`ChainedJournalFormat`). It knows no grammar of its own: a journal hands
// in its entry kinds, its entry validator and its error classes, and every refusal is thrown as that journal's class.
// Moved here from `coord/delegation-journal.ts`, which binds it to its grammar under its old names; no byte, hash or
// message changed.
//
// Ring L1, context K: pure, no fs, no clock, no randomness, and `./canonical.js` its only import. The file port, the
// readers, the writer and the act of a heal stay each journal's own.
//
// WHY A SECOND KERNEL BESIDE `journalKernel.ts` (legitimately different, spec 2026-10-19 K17 and §3.19). That file holds
// the LOG-FIRST journals' shared steps: text framed tolerantly (blank lines and a torn tail left to each caller), no
// hashes, an epoch read out of a fragment. A CHAINED journal is the opposite contract: hash-chained over exact bytes and
// decoded strictly, one canonical encoding per record and every defect refused. That property, not "authority against
// projection", divides the two, and it is also why this file has its own byte splitter (a streaming leftover) beside
// `splitJournalRecords` (whole text). Neither file imports the other.
//
// ONE ENVELOPE, NO DOMAIN TAG. Every chained journal uses the same envelope and preimages; a record's kind lives in
// `entry.kind`. A record of one journal would verify in another exactly when the other's grammar accepted its entry, so
// `chained-journal-formats.test.ts` holds every registered format's `kinds` pairwise disjoint and each grammar refusing
// every other format's kinds.
import { isLowerHex64, parseCanonicalInstant, rfc8785Json, sha256HexOfText } from './canonical.js';

// ── Refusals ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Why the codec or the chain verifier refused. Closed, so a caller and a test tell one refusal from another without reading
 *  prose, and a recovery failure names the exact rule that failed. A journal adds its own codes beside these. */
export type ChainedJournalErrorCode =
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
  | 'anchor-missing';        // no retained record at the anchor's sequence

/** Every refusal of the codec and the chain, as a TOTAL table over `ChainedJournalErrorCode`. */
export const CHAINED_JOURNAL_ERROR_CODES: Readonly<Record<ChainedJournalErrorCode, true>> = {
  bom: true, crlf: true, 'blank-line': true, 'torn-tail': true, 'missing-final-lf': true, 'invalid-utf8': true, 'malformed-json': true,
  'duplicate-key': true, 'unknown-key': true, 'bad-field': true, 'invalid-domain': true, noncanonical: true, 'sequence-domain': true,
  'sequence-start': true, 'sequence-duplicate': true, 'sequence-descent': true, 'sequence-gap': true, 'previous-digest': true,
  'journal-id-mismatch': true, 'digest-mismatch': true, 'anchor-sequence': true, 'anchor-journal-id': true, 'anchor-digest': true,
  'anchor-missing': true,
};

/** Where in a journal a refusal was found. */
export interface JournalWhere { line?: number; offset?: number }

/** A journal's refusal class: an `Error` with its `code`. */
export type ChainedRefusal = Error & { readonly code: string };

/** What a journal hands the kernel. `X` is its refusal class, so callers keep reading `.code` and `instanceof`. */
export interface ChainedJournalFormat<E, X extends ChainedRefusal> {
  /** Every `entry.kind` this journal's grammar accepts. The kinds census holds these tables pairwise disjoint. */
  readonly kinds: readonly string[];
  /** The entry rebuilt field by field, or a refusal thrown through `fail`. */
  entry(raw: unknown): E;
  /** Every refusal of the kernel is thrown as this. */
  fail(code: ChainedJournalErrorCode, detail: string, where?: JournalWhere): X;
  /** The canonical writer's refusal, as the journal's own class (`rfc8785Json`'s and `sha256HexOfText`'s `fail`). */
  jsonError(detail: string): Error;
}

type Fmt<E, X extends ChainedRefusal> = ChainedJournalFormat<E, X>;

function refuse<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, code: ChainedJournalErrorCode, detail: string, where?: JournalWhere): never {
  throw fmt.fail(code, detail, where);
}

// ── The record envelope and its two exact, nonrecursive preimages ──────────────────────────────────────────────────────

/** One record of a chained journal. */
export interface ChainedJournalRecord<E> {
  v: 1;
  sequence: number;
  journalId: string;
  acceptedAt: string;
  previousDigest: string | null;
  entry: E;
  digest: string;
}

/** What a record is hashed from, before its `journalId` and `digest` exist. */
export interface ChainedRecordFields<E> {
  sequence: number;
  acceptedAt: string;
  previousDigest: string | null;
  entry: E;
}

/**
 * `journalId = SHA256(rfc8785Json({v, sequence, acceptedAt, previousDigest, entry}))`. NONRECURSIVE: neither
 * `journalId` nor `digest` is in its own preimage, so changing `journalId` cannot change `journalId`.
 */
export function chainedRecordId<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, f: ChainedRecordFields<E>): string {
  const fail = (d: string): Error => fmt.jsonError(d);
  return sha256HexOfText(rfc8785Json({
    v: 1, sequence: f.sequence, acceptedAt: f.acceptedAt, previousDigest: f.previousDigest, entry: f.entry,
  }, fail), fail);
}

/**
 * `digest = SHA256(rfc8785Json({v, sequence, journalId, acceptedAt, previousDigest, entry}))`. It includes
 * `previousDigest`, which is what chains one record to the one before it; it never includes itself.
 */
export function chainedRecordDigest<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, f: ChainedRecordFields<E> & { journalId: string }): string {
  const fail = (d: string): Error => fmt.jsonError(d);
  return sha256HexOfText(rfc8785Json({
    v: 1, sequence: f.sequence, journalId: f.journalId, acceptedAt: f.acceptedAt, previousDigest: f.previousDigest, entry: f.entry,
  }, fail), fail);
}

/** A record with its two hashes computed. Throws the format's `jsonError` for an entry outside the canonical JSON domain, and
 *  refuses anything the decoder would refuse, so a record that exists is a record that decodes. */
export function buildChainedRecord<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, f: ChainedRecordFields<E>): ChainedJournalRecord<E> {
  assertSequence(fmt, f.sequence);
  chainedAssertInstant(fmt, f.acceptedAt, 'acceptedAt');
  if (f.previousDigest !== null && !isLowerHex64(f.previousDigest)) {
    refuse(fmt, 'bad-field', 'previousDigest is neither null nor a lowercase 64-hex SHA-256');
  }
  const entry = fmt.entry(f.entry);
  const journalId = chainedRecordId(fmt, { ...f, entry });
  const digest = chainedRecordDigest(fmt, { ...f, entry, journalId });
  return { v: 1, sequence: f.sequence, journalId, acceptedAt: f.acceptedAt, previousDigest: f.previousDigest, entry, digest };
}

// ── The field checks the envelope and a grammar share ──────────────────────────────────────────────────────────────

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Exactly these keys, no more and no fewer. An extra key is `unknown-key`, a missing one `bad-field`. */
export function chainedExactKeys<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, o: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) refuse(fmt, 'unknown-key', `${what} has the unknown key ${JSON.stringify(k)}`);
  for (const k of keys) if (!Object.hasOwn(o, k)) refuse(fmt, 'bad-field', `${what} is missing ${JSON.stringify(k)}`);
}

function assertSequence<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, v: unknown): asserts v is number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) refuse(fmt, 'sequence-domain', `${String(v)} is not a positive safe integer`);
}

/** A canonical UTC millisecond instant, or `bad-field`. Only the instant parser's own refusal is mapped; anything else is
 *  rethrown unchanged. */
export function chainedAssertInstant<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, v: unknown, what: string): asserts v is string {
  const mine = new WeakSet<Error>();
  try {
    parseCanonicalInstant(v as string, (d) => { const e = new Error(d); mine.add(e); return e; });
  } catch (err) {
    if (mine.has(err as Error)) refuse(fmt, 'bad-field', `${what} is not a canonical UTC millisecond instant`);
    throw err;
  }
}

export function chainedHex64<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, v: unknown, what: string): string {
  return isLowerHex64(v) ? v : refuse(fmt, 'bad-field', `${what} is not a lowercase 64-hex SHA-256`);
}

const RECORD_KEYS = ['v', 'sequence', 'journalId', 'acceptedAt', 'previousDigest', 'entry', 'digest'] as const;

// ── A JSON text scanner that finds what JSON.parse hides ───────────────────────────────────────────────────────────────

/** Whether a JSON text repeats a key in any one object, at any depth. `JSON.parse` silently keeps the last of two equal keys, so
 *  a second parse cannot see it; this scanner can. A syntax error is a distinct answer, not a pass. */
export function findJsonDefect(text: string): 'duplicate-key' | 'malformed-json' | null {
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
export function encodeChainedRecord<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, record: ChainedJournalRecord<E>): Uint8Array {
  return UTF8.encode(`${rfc8785Json(record, (d) => fmt.jsonError(d))}\n`);
}

/**
 * One journal LINE (without its LF) back into a record, strictly. Refused, each with its own code: a BOM, a trailing CR, an
 * empty line, invalid UTF-8, a JSON syntax error, a duplicate key, an unknown or missing key, a field of the wrong shape,
 * a value outside the canonical domain, text that is not byte-for-byte the canonical encoding of its own value, and a
 * `journalId` or `digest` that is not the SHA-256 of its exact preimage. Chain rules (sequence, previousDigest, anchor) belong to
 * `ChainVerifier`, which sees more than one record.
 */
export function decodeChainedLine<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, line: Uint8Array, where?: JournalWhere): ChainedJournalRecord<E> {
  const w = where;
  if (line.length >= 3 && line[0] === 0xef && line[1] === 0xbb && line[2] === 0xbf) refuse(fmt, 'bom', 'a byte-order mark', w);
  if (line.length === 0) refuse(fmt, 'blank-line', 'an empty line', w);
  if (line[line.length - 1] === 0x0d) refuse(fmt, 'crlf', 'a line ends in CR before its LF', w);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(line); } catch { return refuse(fmt, 'invalid-utf8', 'the line is not valid UTF-8', w); }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return refuse(fmt, 'malformed-json', 'the line is not JSON', w); }
  if (!isRecord(parsed)) return refuse(fmt, 'bad-field', 'the line is not a JSON object', w);
  chainedExactKeys(fmt, parsed, RECORD_KEYS, 'a record');
  if (parsed['v'] !== 1) refuse(fmt, 'bad-field', 'v is not 1', w);
  const sequence = parsed['sequence'];
  assertSequence(fmt, sequence);
  const acceptedAt = parsed['acceptedAt'];
  chainedAssertInstant(fmt, acceptedAt, 'acceptedAt');
  const previousDigest = parsed['previousDigest'];
  if (previousDigest !== null && !isLowerHex64(previousDigest)) refuse(fmt, 'bad-field', 'previousDigest is neither null nor a lowercase 64-hex SHA-256', w);
  const journalId = chainedHex64(fmt, parsed['journalId'], 'journalId');
  const digest = chainedHex64(fmt, parsed['digest'], 'digest');
  const entry = fmt.entry(parsed['entry']);
  const record: ChainedJournalRecord<E> = { v: 1, sequence, journalId, acceptedAt, previousDigest, entry, digest };
  // Only the writer's own refusal, made through this call's `fail`, is `invalid-domain`; anything else is rethrown unchanged.
  const mine = new WeakSet<Error>();
  let canonical: string;
  try { canonical = rfc8785Json(record, (d) => { const e = fmt.jsonError(d); mine.add(e); return e; }); } catch (err) {
    if (mine.has(err as Error)) return refuse(fmt, 'invalid-domain', (err as Error).message, w);
    throw err;
  }
  if (canonical !== text) {
    // `JSON.parse` keeps the last of two equal keys, so a repeated key reaches here as a text that is not its own canonical
    // encoding. Only now is the (slower) scanner run, to say WHICH defect it is; a canonical line never needs it.
    if (findJsonDefect(text) === 'duplicate-key') refuse(fmt, 'duplicate-key', 'an object repeats a key', w);
    refuse(fmt, 'noncanonical', 'the line is not the canonical encoding of its own value', w);
  }
  if (chainedRecordId(fmt, record) !== journalId) refuse(fmt, 'journal-id-mismatch', 'journalId is not SHA-256 of its preimage', w);
  if (chainedRecordDigest(fmt, record) !== digest) refuse(fmt, 'digest-mismatch', 'digest is not SHA-256 of its preimage', w);
  return record;
}

/** Splits a stream of bytes into LF-terminated lines without ever holding more than one partial line: `push` returns the
 *  complete lines (LF removed) of what has arrived so far, and `leftover` is whatever follows the last LF. */
export class ChainedLineSplitter {
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
export function chainedTornTailError<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, leftover: Uint8Array, where?: JournalWhere): X {
  try {
    decodeChainedLine(fmt, leftover);
    return fmt.fail('missing-final-lf', 'the last record has no LF after it', where);
  } catch {
    return fmt.fail('torn-tail', `${leftover.length} bytes follow the last LF and are not a complete record`, where);
  }
}

// ── The torn tail: what a crash can leave, and the one thing a journal's heal may cut (D-4655) ─────────────────────────

/** The bytes after a journal's last LF, as the strict reader found them. */
export interface ChainedTail {
  /** The byte offset of the first byte after the last LF: where the last complete record ends. */
  offset: number;
  bytes: Uint8Array;
  /** SHA-256 of `bytes`, lowercase hex. */
  sha256: string;
  /** `missing-final-lf` when the bytes are one complete valid record with no LF after it, `torn-tail` otherwise. */
  code: 'torn-tail' | 'missing-final-lf';
}

/** What the heal will do about one tail: cut the journal back to `offset`, after keeping `bytes` bytes under `name`. */
export interface ChainedTailHealPlan {
  offset: number;
  bytes: number;
  sha256: string;
  code: ChainedTail['code'];
  /** `<offset>-<sha256>.tail`: content-addressed, so a heal that died and runs again finds the identical file and makes no second one. */
  name: string;
}

/**
 * THE HEAL RULE (D-4655), stated once. A tail may be cut off only when ALL of these hold:
 *   1. the journal ends in bytes after its last LF (`tail`);
 *   2. every complete record validates and the hash chain is intact;
 *   3. the checkpoint's applied position names a complete record, or none (and every record it holds is retained).
 * `prefixSound` is 2 and 3 together: recovery over the COMPLETE records, anchor and holds included, found no defect. Anything else is
 * corruption, not a crash artefact, and stays a recovery failure exactly as before. Why a tail that passes is safe to drop: under O5 a
 * record is applied only after the journal fsync, and the checkpoint is replaced only after that, so a crash or a failed write in the
 * middle of an append leaves at most one partial line after the last LF and nothing (no checkpoint row, cursor, ID or interval) refers
 * to it; the bucket cursor still points before its spool line, so the next pass reads that line again and mints the same eventId. A
 * complete record with no LF is still bytes after the last LF, so it is healable too, unless the checkpoint names it: then the append
 * was durable and applied, and a missing LF is corruption (the `anchor-missing` of `prefixSound`).
 */
export function chainedTailHealPlan(tail: ChainedTail | null, prefixSound: boolean): ChainedTailHealPlan | null {
  if (tail === null || !prefixSound) return null;
  return { offset: tail.offset, bytes: tail.bytes.length, sha256: tail.sha256, code: tail.code, name: `${tail.offset}-${tail.sha256}.tail` };
}

// ── The hash chain ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A point in the journal: what a checkpoint's anchor and a snapshot's end-of-file both name. */
export interface ChainedPosition {
  sequence: number;
  journalId: string;
  digest: string;
}

/** The next record's position from a head: sequence 1 and no previous digest before the first record, else the head's
 *  sequence plus one and the head's digest. The one copy of that arithmetic: every writer that appends after a head asks it. */
export function chainNext(head: ChainedPosition | null): { sequence: number; previousDigest: string | null } {
  return head === null ? { sequence: 1, previousDigest: null } : { sequence: head.sequence + 1, previousDigest: head.digest };
}

/** What a validated journal covers, in the shape a snapshot manifest carries it. */
export interface ChainedCoverage {
  firstSequence: number | null;
  lastSequence: number | null;
  recordCount: number;
  firstPreviousDigest: string | null;
  copiedEof: ChainedPosition | null;
}

export interface ChainOptions {
  /** True: the journal must begin at sequence 1 with a null `previousDigest` (a journal that was never compacted). False: it may
   *  begin later, and its first `previousDigest` is reported, not verified. */
  completeFromStart?: boolean;
  /** The checkpoint anchor (or a snapshot's) the record at that sequence must equal in all three parts. */
  anchor?: ChainedPosition | null;
}

/**
 * The incremental chain verifier: positive contiguous safe-integer sequences, each `previousDigest` equal to the prior complete
 * record's `digest`, and the anchor triple. (`journalId` uniqueness needs no set: a `journalId` is SHA-256 of a preimage that
 * includes the strictly increasing `sequence`, and `decodeChainedLine` has already proved each record's own `journalId`, so two
 * records cannot share one without a SHA-256 collision.) Feed records in file order.
 */
export class ChainVerifier<E, X extends ChainedRefusal> {
  private count = 0;
  private first: { sequence: number; previousDigest: string | null } | null = null;
  private last: ChainedPosition | null = null;
  private anchorSeen = false;
  constructor(private readonly fmt: Fmt<E, X>, private readonly opts: ChainOptions = {}) {}

  accept(record: ChainedJournalRecord<E>): void {
    const fmt = this.fmt;
    assertSequence(fmt, record.sequence);
    const anchor = this.opts.anchor ?? null;
    if (this.last === null) {
      if (this.opts.completeFromStart === true) {
        if (record.sequence !== 1) refuse(fmt, 'sequence-start', `a complete journal begins at sequence 1, not ${record.sequence}`);
        if (record.previousDigest !== null) refuse(fmt, 'previous-digest', 'the first record of a complete journal has previousDigest null');
      }
      this.first = { sequence: record.sequence, previousDigest: record.previousDigest };
    } else {
      if (record.sequence === this.last.sequence) refuse(fmt, 'sequence-duplicate', `sequence ${record.sequence} appears twice`);
      if (record.sequence < this.last.sequence) refuse(fmt, 'sequence-descent', `sequence ${record.sequence} follows ${this.last.sequence}`);
      if (record.sequence !== this.last.sequence + 1) refuse(fmt, 'sequence-gap', `sequence ${record.sequence} follows ${this.last.sequence}`);
      if (record.previousDigest !== this.last.digest) refuse(fmt, 'previous-digest', `record ${record.sequence}'s previousDigest is not record ${this.last.sequence}'s digest`);
    }
    if (anchor !== null) {
      if (record.sequence === anchor.sequence) {
        if (record.journalId !== anchor.journalId) refuse(fmt, 'anchor-journal-id', `the record at sequence ${anchor.sequence} has another journalId`);
        if (record.digest !== anchor.digest) refuse(fmt, 'anchor-digest', `the record at sequence ${anchor.sequence} has another digest`);
        this.anchorSeen = true;
      } else if (record.journalId === anchor.journalId) {
        refuse(fmt, 'anchor-sequence', `the anchor's journalId is at sequence ${record.sequence}, not ${anchor.sequence}`);
      }
    }
    this.count++;
    this.last = { sequence: record.sequence, journalId: record.journalId, digest: record.digest };
  }

  /** The head so far: the last accepted record, or null before the first. */
  head(): ChainedPosition | null { return this.last; }
  recordCount(): number { return this.count; }
  firstRecord(): { sequence: number; previousDigest: string | null } | null { return this.first; }
  anchorWasSeen(): boolean { return this.anchorSeen; }

  /** The coverage, once every record is in. An anchor no record satisfied is `anchor-missing`. */
  finish(): ChainedCoverage {
    const anchor = this.opts.anchor ?? null;
    if (anchor !== null && !this.anchorSeen) refuse(this.fmt, 'anchor-missing', `no retained record at the anchor's sequence ${anchor.sequence}`);
    return {
      firstSequence: this.first?.sequence ?? null,
      lastSequence: this.last?.sequence ?? null,
      recordCount: this.count,
      firstPreviousDigest: this.first?.previousDigest ?? null,
      copiedEof: this.last,
    };
  }
}

// ── A whole journal as bytes ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Validates a whole journal as bytes (a copy, a snapshot, a file read at once) and returns its coverage: every complete line
 * decoded and chained in order, each passed to `visit` and none kept. Bytes after the last LF throw (as `chainedTornTailError`),
 * whatever they hold; then `finish()` runs, so an anchor no record satisfied is `anchor-missing`.
 */
export function verifyChainedBytes<E, X extends ChainedRefusal>(
  fmt: Fmt<E, X>, bytes: Uint8Array, opts: ChainOptions = {}, visit?: (r: ChainedJournalRecord<E>) => void,
): ChainedCoverage {
  const chain = new ChainVerifier(fmt, opts);
  const splitter = new ChainedLineSplitter();
  let lineNo = 0;
  for (const line of splitter.push(bytes)) {
    lineNo++;
    const record = decodeChainedLine(fmt, line, { line: lineNo });
    chain.accept(record);
    visit?.(record);
  }
  const tail = splitter.leftover();
  if (tail.length > 0) throw chainedTornTailError(fmt, tail, { line: lineNo + 1 });
  return chain.finish();
}

/** A whole journal as records: `verifyChainedBytes`, keeping every record. */
export function parseChainedBytes<E, X extends ChainedRefusal>(fmt: Fmt<E, X>, bytes: Uint8Array, opts: ChainOptions = {}): ChainedJournalRecord<E>[] {
  const records: ChainedJournalRecord<E>[] = [];
  verifyChainedBytes(fmt, bytes, opts, (r) => { records.push(r); });
  return records;
}
