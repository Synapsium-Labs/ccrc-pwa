// The shared synchronous chained-journal file adapter (Overlord W1, authority journal plan Task 2, PR A0; cross-plan ruling
// X1). Ring L3, context K. Generic over a `ChainedJournalFormat`: it binds the chained kernel (`chainedJournal.ts`, L1) to the
// byte-level append-only port (`appendOnlyFile.ts`), so each W1 chained journal (the Overlord authority journal, the privacy
// journal) binds THIS, with its own format, error class and census row, and none copies the read-verify-append steps.
//
// THE CONTRACT (stated once, in the authority journal plan's question 3; the private store plan cites it):
// - `read` reads and verifies the whole file, holding no snapshot afterwards. A journal here is complete from sequence 1
//   (none of these is ever compacted). It answers `absent`, `records` (with the torn `tail` after the last LF, if any, for
//   the caller's heal), `malformed` (the kernel's refusal code and message, and `lines`, the count of LF bytes, which bounds
//   every sequence the file could hold), or `unmeasured` (the port could not read it). Never a null.
// - `appendNext(check)` re-reads and verifies the whole file on EVERY call, hands `check` what it read (everything but
//   `unmeasured`, which answers `unreadable` before `check` runs), and on `go` appends the next record after the verified
//   head (`chainNext`, `encodeChainedRecord`, `appendLine`) through the snapshot of that same read, which it then spends. A
//   snapshot is single-use and never reused across calls. A file that is `malformed` or ends in a torn tail has no head to
//   append after: on `go` it answers `malformed`, appending nothing. The caller heals or sets the file aside first.
// - `cutAside` is the one cut: the torn-tail heal by the kernel's plan (re-read, and refused `changed` unless the file still
//   ends in exactly that tail after a verified prefix), or the whole file set aside (offset 0) so a new chain can start. It
//   reaches the port's `cutAside`, which keeps the bytes in the quarantine directory before it truncates.
// - `mayApply` is false for every failure before the port's append or cut was entered, and true for every failure after.
// - Each journal's own class decides when it reads and what it checks against its rows, and holds the transaction check:
//   only it knows its database. This adapter knows no row and no transaction.
import { createHash } from 'node:crypto';
import { appendOnlyFileAt, NODE_APPEND_ONLY_FS, type AppendOnlyCut, type AppendOnlyFsOps } from './appendOnlyFile.js';
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
/** What `appendNext` hands its check: every read but `unmeasured`. */
export type ChainedFileSeen<E> = Exclude<ChainedFileRead<E>, { kind: 'unmeasured' }>;
/** What the caller's check answers on the verified head: append this entry, or stop with the caller's own answer. */
export type ChainedAppendStep<E, S> = { go: { entry: E; acceptedAt: string } } | { stop: S };
export type ChainedAppendResult<E, S> =
  | { ok: true; record: ChainedJournalRecord<E> }
  | { ok: false; stopped: S }
  | { ok: false; error: ChainedAppendError; mayApply: boolean };
/** Which cut: the torn tail by the kernel's heal plan, or the whole file under the caller's name. */
export type ChainedCutHow = { kind: 'tail'; plan: ChainedTailHealPlan } | { kind: 'whole'; asideName: string };

export interface ChainedJournalFile<E> {
  /** A fresh read and verify; holds no snapshot. `lines` on `malformed` counts LF bytes, bounding every sequence. */
  read(): ChainedFileRead<E>;
  /** Re-reads and verifies the whole file, asks `check` with what it read, and on `go` appends the next record
   *  (`chainNext`, `encodeChainedRecord`, `appendLine`) through the same snapshot, which it then spends. Never reuses
   *  a snapshot across calls. */
  appendNext<S>(check: (read: ChainedFileSeen<E>) => ChainedAppendStep<E, S>): ChainedAppendResult<E, S>;
  /** The torn-tail heal by the kernel's plan, or (`whole`) the whole file set aside so a new chain can start. `asideDir`
   *  is the quarantine directory's name inside the journal's own directory (one path component). */
  cutAside(how: ChainedCutHow, asideDir: string): { ok: true } | { ok: false; error: ChainedCutError; mayApply: boolean };
}

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
  // The format's own refusal class: a refusal of the kernel or the grammar is `malformed`; anything else is a defect and is
  // rethrown, never read as a malformed journal.
  const refusalClass = fmt.fail('bad-field', 'the refusal class').constructor;
  const isRefusal = (err: unknown): err is X => err instanceof Error && err.constructor === refusalClass;

  /** The whole file's bytes, verified: every complete line decoded and chained from sequence 1, and the bytes after the
   *  last LF kept as the tail. */
  const classify = (bytes: Uint8Array): ChainedFileSeen<E> => {
    const cut = bytes.lastIndexOf(0x0a) + 1;
    let records: ChainedJournalRecord<E>[];
    try {
      records = parseChainedBytes(fmt, bytes.subarray(0, cut), { completeFromStart: true });
    } catch (err) {
      if (!isRefusal(err)) throw err;
      return { kind: 'malformed', code: err.code, detail: err.message, lines: countLf(bytes) };
    }
    if (cut === bytes.length) return { kind: 'records', records, tail: null };
    const leftover = new Uint8Array(bytes.subarray(cut));
    const torn = chainedTornTailError(fmt, leftover);
    return {
      kind: 'records', records, tail: {
        offset: cut, bytes: leftover, sha256: createHash('sha256').update(leftover).digest('hex'),
        code: torn.code === 'missing-final-lf' ? 'missing-final-lf' : 'torn-tail',
      },
    };
  };

  return {
    read() {
      const r = file.read();
      if (!r.ok) return { kind: 'unmeasured', why: r.error };
      r.snapshot.release();
      return r.kind === 'absent' ? { kind: 'absent' } : classify(r.bytes);
    },

    appendNext(check) {
      const r = file.read();
      if (!r.ok) return { ok: false, error: r.error, mayApply: false };
      try {
        const seen: ChainedFileSeen<E> = r.kind === 'absent' ? { kind: 'absent' } : classify(r.bytes);
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
          const seen = classify(r.bytes);
          const t = seen.kind === 'records' ? seen.tail : null;
          if (t === null || t.offset !== p.offset || t.bytes.length !== p.bytes || t.sha256 !== p.sha256 || t.code !== p.code) {
            return { ok: false, error: 'changed', mayApply: false };
          }
          cut = { offset: p.offset, asideDir, asideName: p.name };
        } else {
          cut = { offset: 0, asideDir, asideName: how.asideName };
        }
        const done = file.cutAside(r.snapshot, cut);
        return done.ok ? { ok: true } : { ok: false, error: done.error, mayApply: true };
      } finally {
        r.snapshot.release();
      }
    },
  };
}
