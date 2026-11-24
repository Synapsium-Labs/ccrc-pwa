// The shared synchronous chained-journal file adapter (Overlord W1, authority journal plan Task 2, PR A0; cross-plan ruling
// X1). Ring L3, context K. Generic over a `ChainedJournalFormat`: it binds the chained kernel (`chainedJournal.ts`, L1) to the
// byte-level append-only port (`appendOnlyFile.ts`), so each W1 chained journal (the Overlord authority journal, the privacy
// journal) binds THIS, with its own format, error class and census row, and none copies the read-verify-append steps.
//
// THE CONTRACT (stated once, in the authority journal plan's question 3; the private store plan cites it):
// - `read` reads and verifies the whole file, holding no snapshot afterwards. A journal here is complete from sequence 1
//   (none of these is ever compacted). It answers `absent`, `records` (with the torn `tail` after the last LF, if any, for
//   the caller's heal), `malformed` (the kernel's refusal code and message, and `lines`, the count of LF bytes, which bounds
//   every acknowledged sequence: a record is acknowledged only once its LF is durable), or `unmeasured` (the port could not
//   read it). Never a null.
// - `appendNext(check)` re-reads the whole file and verifies it on EVERY call, hands `check` what it read (everything but
//   `unmeasured`, which answers `unreadable` before `check` runs), and on `go` appends the next record after the verified
//   head (`chainNext`, `encodeChainedRecord`, `appendLine`) through the snapshot of that same read, which it then spends. A
//   snapshot is single-use and never reused across calls. A file that is `malformed` or ends in a torn tail has no head to
//   append after: on `go` it answers `malformed`, appending nothing. The caller heals or sets the file aside first.
// - `cutAside` is the one cut: the torn-tail heal by the kernel's plan (re-read, and refused `changed` unless the file still
//   ends in exactly that tail after a verified prefix), or the whole file set aside (offset 0) so a new chain can start. It
//   reaches the port's `cutAside`, which keeps the bytes in the quarantine directory before it truncates. Both kept names
//   are content-addressed, so a second cut never replaces the first's bytes: the tail's `<offset>-<sha256>.tail` (the
//   kernel's plan) and the whole file's `<length>-<sha256>.whole` (derived here).
// - `mayApply` is false for every failure before the port's append or cut was entered, and true for every failure after.
// - Each journal's own class decides when it reads and what it checks against its rows, and holds the transaction check:
//   only it knows its database. This adapter knows no row and no transaction.
// - THE VERIFIED-HEAD CACHE (the act journal plan's question 10, ruling F16 of review 2275). Every read, append and cut still
//   reads the whole file through the port, and a snapshot is still single-use: the cache is of a verified head, never of a
//   snapshot. What it saves is the kernel's verify of the bytes before that head (each line's strict decode, canonical
//   re-encode and two SHA-256 preimages). It is a field of this instance, in memory only, so it is never shared across
//   instances or paths, and a restart verifies in full. Its key is the device and inode the port read the bytes from, the
//   length of the verified prefix (every complete record, up to the head's LF) and SHA-256 of exactly those bytes
//   (`verifiedHeadHolds`, the one decision). The digest covers every byte the cache stands for, so a rewrite in place, a
//   truncate and regrow, or any other bytes are a miss; the device and inode make a replaced file a miss even with the same
//   bytes. One SHA-256 pass over the prefix is cheap beside the verify it replaces. On a hit only the bytes after the head
//   are verified, and they must continue the chain from it (`chainNext`). Any refusal there, any defect, or any miss falls
//   back to the whole-file verify, so every answer, its code and its detail are what a cold read answers on the same bytes.
//   The records it hands out are frozen, so no caller can change what the next hit hands back.
import { createHash } from 'node:crypto';
import {
  appendOnlyFileAt, NODE_APPEND_ONLY_FS, type AppendOnlyCut, type AppendOnlyFsOps, type AppendOnlyLeafId,
} from './appendOnlyFile.js';
import {
  buildChainedRecord, chainNext, chainedTornTailError, encodeChainedRecord, parseChainedBytes,
  type ChainedJournalFormat, type ChainedJournalRecord, type ChainedRefusal, type ChainedTail, type ChainedTailHealPlan,
} from './chainedJournal.js';

export type ChainedFileReadError = 'unreadable';
export type ChainedAppendError = 'unreadable' | 'malformed' | 'changed' | 'unwritable' | 'durability';
export type ChainedCutError = 'unreadable' | 'changed' | 'unwritable' | 'durability';
export type ChainedFileRead<E> =
  | { kind: 'absent' }
  | { kind: 'records'; records: readonly ChainedJournalRecord<E>[]; tail: ChainedTail | null }
  | { kind: 'malformed'; code: string; detail: string; lines: number }
  | { kind: 'unmeasured'; why: ChainedFileReadError };
/** The name a whole-file cut keeps the bytes under: content-addressed, so the same bytes are an idempotent retry and other
 *  bytes never replace them. */
export const wholeCutName = (bytes: Uint8Array): string =>
  `${bytes.length}-${createHash('sha256').update(bytes).digest('hex')}.whole`;
/** What `appendNext` hands its check: every read but `unmeasured`. */
export type ChainedFileSeen<E> = Exclude<ChainedFileRead<E>, { kind: 'unmeasured' }>;
/** What the caller's check answers on the verified head: append this entry, or stop with the caller's own answer. */
export type ChainedAppendStep<E, S> = { go: { entry: E; acceptedAt: string } } | { stop: S };
export type ChainedAppendResult<E, S> =
  | { ok: true; record: ChainedJournalRecord<E> }
  | { ok: false; stopped: S }
  | { ok: false; error: ChainedAppendError; mayApply: boolean };
/** Which cut: the torn tail by the kernel's heal plan, or the whole file, kept under `<length>-<sha256>.whole`. */
export type ChainedCutHow = { kind: 'tail'; plan: ChainedTailHealPlan } | { kind: 'whole' };

export interface ChainedJournalFile<E> {
  /** A fresh read and verify; holds no snapshot. `lines` on `malformed` counts LF bytes, bounding every acknowledged
   *  sequence. */
  read(): ChainedFileRead<E>;
  /** Re-reads the whole file and verifies it (on a verified-head hit, only the bytes after that head), asks `check` with
   *  what it read, and on `go` appends the next record
   *  (`chainNext`, `encodeChainedRecord`, `appendLine`) through the same snapshot, which it then spends. Never reuses
   *  a snapshot across calls. */
  appendNext<S>(check: (read: ChainedFileSeen<E>) => ChainedAppendStep<E, S>): ChainedAppendResult<E, S>;
  /** The torn-tail heal by the kernel's plan, or (`whole`) the whole file set aside so a new chain can start. `asideDir`
   *  is the quarantine directory's name inside the journal's own directory (one path component). */
  cutAside(how: ChainedCutHow, asideDir: string): { ok: true } | { ok: false; error: ChainedCutError; mayApply: boolean };
}

/** The verified-head cache's key: the file's device and inode, the verified prefix's length and SHA-256 of its bytes. */
export interface VerifiedHeadKey { readonly dev: bigint; readonly ino: bigint; readonly size: number; readonly sha256: string }
const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** The cache's one decision, pure: the bytes before the cached head are exactly the bytes verified, in the same file. An
 *  empty prefix is never a hit, since it would skip nothing. */
export function verifiedHeadHolds(key: VerifiedHeadKey | null, leaf: AppendOnlyLeafId, bytes: Uint8Array): boolean {
  return key !== null && key.size > 0 && key.dev === leaf.dev && key.ino === leaf.ino && bytes.length >= key.size
    && sha256Hex(bytes.subarray(0, key.size)) === key.sha256;
}
/** A decoded record, frozen through: it may be handed out again by a later hit. */
const frozen = <T>(v: T): T => {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) frozen(x);
  }
  return v;
};

const countLf = (bytes: Uint8Array): number => {
  let n = 0;
  for (const b of bytes) if (b === 0x0a) n++;
  return n;
};

// `ops` is the port's TEST SEAM; production passes the format, the directory and the name.
export function chainedJournalFileAt<E, X extends ChainedRefusal>(
  fmt: ChainedJournalFormat<E, X>, dir: string, basename: string, ops: AppendOnlyFsOps = NODE_APPEND_ONLY_FS,
): ChainedJournalFile<E> {
  const file = appendOnlyFileAt(dir, basename, ops);
  // The format's own refusal class (or a subclass): a refusal of the kernel or the grammar is `malformed`; anything else is a
  // defect and is rethrown, never read as a malformed journal.
  const refusalClass = fmt.fail('bad-field', 'the refusal class').constructor as new (...args: never[]) => X;
  const isRefusal = (err: unknown): err is X => err instanceof refusalClass;

  /** The bytes after the last LF (`cut`), or null when there are none. */
  const tailAt = (bytes: Uint8Array, cut: number): ChainedTail | null => {
    if (cut === bytes.length) return null;
    const leftover = new Uint8Array(bytes.subarray(cut));
    const torn = chainedTornTailError(fmt, leftover);
    return { offset: cut, bytes: leftover, sha256: sha256Hex(leftover), code: torn.code === 'missing-final-lf' ? 'missing-final-lf' : 'torn-tail' };
  };

  /** The whole file's bytes, verified: every complete line decoded and chained from sequence 1, and the bytes after the
   *  last LF kept as the tail. */
  const verifyAll = (bytes: Uint8Array): ChainedFileSeen<E> => {
    const cut = bytes.lastIndexOf(0x0a) + 1;
    let records: ChainedJournalRecord<E>[];
    try {
      records = parseChainedBytes(fmt, bytes.subarray(0, cut), { completeFromStart: true });
    } catch (err) {
      if (!isRefusal(err)) throw err;
      return { kind: 'malformed', code: err.code, detail: err.message, lines: countLf(bytes) };
    }
    return { kind: 'records', records: frozen(records), tail: tailAt(bytes, cut) };
  };

  // The verified-head cache: the records this instance last verified, and the key that shows their bytes unchanged.
  let verified: { key: VerifiedHeadKey; records: readonly ChainedJournalRecord<E>[] } | null = null;

  /** On a hit, only the bytes after the held head, which must continue its chain; null on anything else there, so the
   *  caller verifies in full and answers as a cold read (a defect is rethrown by that verify). The held prefix ends in the
   *  head's LF, so the last LF is at or after it. */
  const verifyAfter = (held: NonNullable<typeof verified>, bytes: Uint8Array): ChainedFileSeen<E> | null => {
    const cut = bytes.lastIndexOf(0x0a) + 1;
    let fresh: ChainedJournalRecord<E>[];
    try {
      fresh = parseChainedBytes(fmt, bytes.subarray(held.key.size, cut));
    } catch {
      return null;
    }
    const next = chainNext(held.records[held.records.length - 1]!);
    const first = fresh[0];
    if (first !== undefined && (first.sequence !== next.sequence || first.previousDigest !== next.previousDigest)) return null;
    return { kind: 'records', records: fresh.length === 0 ? held.records : Object.freeze([...held.records, ...fresh.map(frozen)]), tail: tailAt(bytes, cut) };
  };

  /** What `bytes` hold, through the cache: a hit verifies only what follows the held head, a miss the whole file. */
  const classify = (bytes: Uint8Array, leaf: AppendOnlyLeafId): ChainedFileSeen<E> => {
    const held = verified !== null && verifiedHeadHolds(verified.key, leaf, bytes) ? verified : null;
    verified = null;
    const seen = (held === null ? null : verifyAfter(held, bytes)) ?? verifyAll(bytes);
    if (seen.kind === 'records' && seen.records.length > 0) {
      const size = seen.tail === null ? bytes.length : seen.tail.offset;
      const key = held !== null && held.key.size === size ? held.key : { dev: leaf.dev, ino: leaf.ino, size, sha256: sha256Hex(bytes.subarray(0, size)) };
      verified = { key, records: seen.records };
    }
    return seen;
  };

  return {
    read() {
      const r = file.read();
      if (!r.ok) return { kind: 'unmeasured', why: r.error };
      r.snapshot.release();
      return r.kind === 'absent' ? { kind: 'absent' } : classify(r.bytes, r.leaf);
    },

    appendNext(check) {
      const r = file.read();
      if (!r.ok) return { ok: false, error: r.error, mayApply: false };
      try {
        const seen: ChainedFileSeen<E> = r.kind === 'absent' ? { kind: 'absent' } : classify(r.bytes, r.leaf);
        const step = check(seen);
        if ('stop' in step) return { ok: false, stopped: step.stop };
        if (seen.kind === 'malformed' || (seen.kind === 'records' && seen.tail !== null)) {
          return { ok: false, error: 'malformed', mayApply: false };
        }
        const last = seen.kind === 'records' ? seen.records[seen.records.length - 1] : undefined;
        const head = last === undefined ? null : { sequence: last.sequence, journalId: last.journalId, digest: last.digest };
        const record = buildChainedRecord(fmt, { ...chainNext(head), acceptedAt: step.go.acceptedAt, entry: step.go.entry });
        const wrote = file.appendLine(r.snapshot, encodeChainedRecord(fmt, record));
        return wrote.ok ? { ok: true, record } : { ok: false, error: wrote.error, mayApply: true };
      } finally {
        r.snapshot.release();
      }
    },

    cutAside(how, asideDir) {
      const r = file.read();
      if (!r.ok) return { ok: false, error: r.error, mayApply: false };
      try {
        if (r.kind === 'absent') return { ok: false, error: 'changed', mayApply: false };
        let cut: AppendOnlyCut;
        if (how.kind === 'tail') {
          const p = how.plan;
          const seen = classify(r.bytes, r.leaf);
          const t = seen.kind === 'records' ? seen.tail : null;
          if (t === null || t.offset !== p.offset || t.bytes.length !== p.bytes || t.sha256 !== p.sha256 || t.code !== p.code) {
            return { ok: false, error: 'changed', mayApply: false };
          }
          cut = { offset: p.offset, asideDir, asideName: p.name };
        } else {
          cut = { offset: 0, asideDir, asideName: wholeCutName(r.bytes) };
        }
        const done = file.cutAside(r.snapshot, cut);
        return done.ok ? { ok: true } : { ok: false, error: done.error, mayApply: true };
      } finally {
        r.snapshot.release();
      }
    },
  };
}
