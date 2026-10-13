// The collector switch's generation journal, ring L3 (path-identity spec 2026-10-12 §5.2, §5.3): the ONE adapter that
// reads and appends `~/.ccrc/collect-lane-generation.log` on the SERVER box. It implements the port its consumers
// declare, `CollectLaneJournal` (`collectLane.ts`, L1), and decides nothing: every byte it reads goes to L1's
// `parseCollectLaneJournal`, the journal's one strict parser.
//
// NOT the update-intent and pool-edge journals' twin in how it reads. Those parse leniently, count a torn tail and tell
// the operator to rebuild them from `coord.db`. This file is the proof that `coord.db` did NOT move backward, so a
// torn, truncated, blank or non-increasing file is `malformed`, and nothing in the tree rebuilds it from the row it
// exists to distrust (spec §5.2, §5.3).
//
// - `read()` never throws. ENOENT is the ONLY `missing` (the bootstrap, beside the exact seed). The open never follows a
//   link (`O_NOFOLLOW`: a symlink, a dangling one included, is `not-regular`, never missing) and never waits
//   (`O_NONBLOCK`: a FIFO swapped in answers at once). `fstat` on the open descriptor decides the kind, with no
//   lstat-then-open race. The read is bounded at COLLECT_LANE_JOURNAL_MAX_BYTES, and past it the answer is
//   `unreadable` `EFBIG`, so a hostile or runaway file cannot stall the store's `BEGIN IMMEDIATE`.
// - `appendGeneration()` writes exactly `{"generation":g}\n` in ONE write, led by `\n` when the file lacks its final
//   newline (so a torn tail never fuses with the next record). It fsyncs the file, and fsyncs the directory when it
//   created the file. It throws on every failure, its `code` an errno word, and a throw first returns the file to its
//   bytes before the call (or removes a file the call created), best effort: on a file it created, any failure after
//   that create unlinks it and fsyncs the directory; on a file that stood, any failure after the fstat that measured
//   its length truncates it back to that length and fsyncs it. The undo runs before the close, and neither its own
//   error nor a close error ever replaces the original. It never retries, and the reader stays strict: a process killed
//   mid-write, or an undo that itself fails, can still leave a tail that reads malformed (spec §5.2). A close that
//   throws after a successful fsync is not undone: the record is durable. `CoordStore.setCollectLane` is its one
//   caller, inside its transaction, BEFORE the row changes.
// - No answer and no thrown code carries the path. A Node fs error's `message` names it, so only its `code` is read
//   (spec §5.6: responses never expose the journal path).
// - Synchronous on purpose: the store calls it inside `tx()`, and `DatabaseSync`'s no-async rule is the argument.
import {
  closeSync, constants as FS, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readSync, unlinkSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import { isPositiveDecimalSafeInteger } from '../../../shared/api.js';
import { parseCollectLaneJournal, type CollectLaneJournal, type CollectLaneJournalRead } from '../collectLane.js';

/** The journal's basename, spelled once in code; every other code reference names it through this constant. */
export const COLLECT_LANE_JOURNAL_BASENAME = 'collect-lane-generation.log';
/** The read cap: one record per operator transition is about twenty bytes, so 1 MiB is never a real journal. */
export const COLLECT_LANE_JOURNAL_MAX_BYTES = 1048576;

/** `~/.ccrc/collect-lane-generation.log`, resolved through `cfg.ccrcDir`, never through the home directory: the
 *  `update-intent.log` precedent. `index.ts` calls it once. */
export function defaultCollectLaneJournalPath(ccrcDir: string): string {
  return path.join(ccrcDir, COLLECT_LANE_JOURNAL_BASENAME);
}

/** The errno word of a thrown error (`ENOENT`, `ELOOP`, `EACCES`), never its message, which names the path. An error
 *  with no errno word answers `UNKNOWN`. */
const errnoOf = (err: unknown): string => {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^E[A-Z0-9]+$/.test(code) ? code : 'UNKNOWN';
};
/** An error this adapter raises itself: a fixed message with no path, and its errno word. */
const fault = (message: string, code: string): Error => Object.assign(new Error(message), { code });

/** The journal at `logPath`. Tests build one under a fixture HOME; production builds exactly one, in `index.ts`. */
export function collectLaneJournalAt(logPath: string): CollectLaneJournal & { readonly logPath: string } {
  return {
    logPath,
    read(): CollectLaneJournalRead {
      let fd: number;
      try {
        fd = openSync(logPath, FS.O_RDONLY | FS.O_NOFOLLOW | FS.O_NONBLOCK);
      } catch (err) {
        const code = errnoOf(err);
        if (code === 'ENOENT') return { kind: 'missing' };
        if (code === 'ELOOP') return { kind: 'not-regular', fileKind: 'symlink' };
        return { kind: 'unreadable', code };
      }
      try {
        const st = fstatSync(fd);
        if (!st.isFile()) return { kind: 'not-regular', fileKind: st.isDirectory() ? 'directory' : 'other' };
        const buf = Buffer.allocUnsafe(COLLECT_LANE_JOURNAL_MAX_BYTES + 1);
        let n = 0;
        while (n < buf.length) {
          const got = readSync(fd, buf, n, buf.length - n, null);
          if (got === 0) break;
          n += got;
        }
        if (n > COLLECT_LANE_JOURNAL_MAX_BYTES) return { kind: 'unreadable', code: 'EFBIG' };
        return parseCollectLaneJournal(buf.toString('utf8', 0, n));
      } catch (err) {
        return { kind: 'unreadable', code: errnoOf(err) };
      } finally {
        try { closeSync(fd); } catch { /* the answer above stands */ }
      }
    },
    appendGeneration(generation: number): void {
      if (!isPositiveDecimalSafeInteger(generation)) {
        throw Object.assign(new RangeError('a journal generation is a positive safe integer'), { code: 'ERANGE' });
      }
      const dir = path.dirname(logPath);
      mkdirSync(dir, { recursive: true });
      let fd: number;
      let created = false;
      try {
        fd = openSync(logPath, FS.O_RDWR | FS.O_APPEND | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, 0o600);
        created = true;
      } catch (err) {
        if (errnoOf(err) !== 'EEXIST') throw err;
        // It exists: open it as it stands. Never re-created here, so a file removed between the two opens fails ENOENT.
        fd = openSync(logPath, FS.O_RDWR | FS.O_APPEND | FS.O_NOFOLLOW);
      }
      // The file's length before this call, once the fstat has measured it: what a failure on a file that stood is cut
      // back to. Unmeasured (-1) until then, and a failure before it has written nothing.
      let sizeBefore = -1;
      try {
        const st = fstatSync(fd);
        sizeBefore = st.size;
        if (!st.isFile()) throw fault('the generation journal is not a regular file', 'EFTYPE');
        let lead = '';
        if (st.size > 0) {
          const last = Buffer.alloc(1);
          if (readSync(fd, last, 0, 1, st.size - 1) !== 1) throw fault('the last byte of the generation journal did not read', 'EIO');
          if (last[0] !== 0x0a) lead = '\n';
        }
        const bytes = Buffer.from(`${lead}{"generation":${generation}}\n`, 'utf8');
        if (writeSync(fd, bytes) !== bytes.length) throw fault('a short write to the generation journal', 'EIO');
        fsyncSync(fd);
        if (created) {
          const dfd = openSync(dir, FS.O_RDONLY);
          try { fsyncSync(dfd); } finally { closeSync(dfd); }
        }
      } catch (err) {
        // The self-undo (spec §5.2): return the file to its bytes before this call, BEFORE the close, best effort. A file
        // this call created is removed (an empty file is unmeasurable, a missing one beside the seed is the bootstrap);
        // a file that stood is cut back to its measured length, which removes the lead newline and the record together.
        // The undo's own error, and the close's, are dropped: the error rethrown is always the original.
        try {
          if (created) {
            unlinkSync(logPath);
            const ufd = openSync(dir, FS.O_RDONLY);
            try { fsyncSync(ufd); } finally { closeSync(ufd); }
          } else if (sizeBefore >= 0) {
            ftruncateSync(fd, sizeBefore);
            fsyncSync(fd);
          }
        } catch { /* best effort: the original error stands */ }
        try { closeSync(fd); } catch { /* the original error stands */ }
        throw err;
      }
      // Success: the record is durable. A close that throws here is not undone (the journal stays one generation ahead).
      closeSync(fd);
    },
  };
}
