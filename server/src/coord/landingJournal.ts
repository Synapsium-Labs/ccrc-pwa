// The landing authority journal's file adapter, ring L3, context C4 (landing order wave 5f, shared contract §2): the ONE
// adapter that reads and appends `landing.log` inside an explicit, already existing directory (`cfg.ccrcDir`; no HOME
// default, no directory creation). It implements the port its consumer declares (`landingJournalPort.ts`, L2) and
// decides nothing: the text it reads goes to L1's `parseLandingJournal`, and what a distinction means is the caller's.
//
// - Absence is exactly ENOENT of the leaf with a measured, existing parent. An existing empty file, a symlink (the open
//   is `O_NOFOLLOW`), a FIFO (the open is `O_NONBLOCK`, so it never waits), a directory, invalid UTF-8, a permission
//   failure and an unmeasurable identity are NEVER absence: the first is `present` with empty text (the parser calls it
//   `empty`), the rest `unreadable`. The descriptor's own `fstat` decides regular-file, with no lstat-then-open race.
// - The snapshot is the adapter's evidence and opaque to its holder: the retained parent descriptor, its identity
//   (dev, ino), the retained leaf descriptor and identity, and the exact bytes. Process-local, single-operation scoped:
//   unusable after `release` or an `append`. A token this adapter did not issue, or one it already released, is refused.
// - `confirmDurable` re-opens the pathname, requires the same parent and leaf identity and the same bytes, then fsyncs
//   the RETAINED descriptors (file, then parent) and re-proves it all; for absence it fsyncs the parent and re-proves the
//   absence, creating nothing. A pathname replacement is `changed`, never confirmation of an unrelated file.
// - `append` re-proves the snapshot, writes exactly one `JSON.stringify(record)` plus LF (a short write continues; a
//   zero-byte write fails), fsyncs the file it wrote through, then the parent, then re-proves identity and the exact
//   complete bytes. It never truncates, unlinks or retries. Every failure once it is entered carries `mayApply: true`.
// - No answer carries a path or an error message; only the closed words of the port.
import {
  closeSync, constants as FS, fstatSync, fsyncSync, openSync, readSync, writeSync, type BigIntStats,
} from 'node:fs';
import path from 'node:path';
import type { LandingJournalRecord } from '../../../shared/landingLine.js';
import type {
  LandingJournalIoFailure, LandingJournalPort, LandingJournalRead, LandingJournalSnapshot,
} from './landingJournalPort.js';

/** The journal's basename, spelled once. */
export const LANDING_JOURNAL_BASENAME = 'landing.log';

/** The low-level operations this adapter performs: `node:fs` by default, replaceable by a test that must fail an fsync,
 *  shorten a write or observe the open flags. Production never passes it. */
export interface LandingJournalFsOps {
  openSync(path: string, flags: number, mode?: number): number;
  fstatSync(fd: number, options: { bigint: true }): BigIntStats;
  readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null): number;
  writeSync(fd: number, buffer: Uint8Array, offset: number, length: number): number;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
}
const NODE_FS: LandingJournalFsOps = {
  openSync: (p, flags, mode) => openSync(p, flags, mode),
  fstatSync: (fd, o) => fstatSync(fd, o),
  readSync: (fd, b, o, l, p) => readSync(fd, b, o, l, p),
  writeSync: (fd, b, o, l) => writeSync(fd, b, o, l),
  fsyncSync: (fd) => fsyncSync(fd),
  closeSync: (fd) => closeSync(fd),
};

const errnoOf = (err: unknown): string => {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'UNKNOWN';
};

interface Ident { readonly dev: bigint; readonly ino: bigint }
const sameIdent = (a: Ident, b: Ident): boolean => a.dev === b.dev && a.ino === b.ino;

const OPEN_LEAF = FS.O_RDONLY | FS.O_NOFOLLOW | FS.O_NONBLOCK;
const OPEN_APPEND = FS.O_RDWR | FS.O_APPEND | FS.O_NOFOLLOW | FS.O_NONBLOCK;
const OPEN_CREATE = FS.O_RDWR | FS.O_APPEND | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW | FS.O_NONBLOCK;
const OPEN_DIR = FS.O_RDONLY | FS.O_DIRECTORY;

/** What one snapshot owns. `leaf` is null for an absence snapshot. */
interface Evidence {
  readonly parentFd: number;
  readonly parent: Ident;
  readonly leaf: { readonly fd: number; readonly id: Ident } | null;
  readonly bytes: Buffer;
  state: 'live' | 'spent';
}

/** A proof failure inside this adapter, by the port word it becomes. */
class Refusal extends Error {
  constructor(readonly word: LandingJournalIoFailure) { super(word); }
}

// `ops` is a TEST SEAM (fault injection and observation of the open flags): production passes only `ccrcDir`.
export function createLandingJournal(ccrcDir: string, ops: LandingJournalFsOps = NODE_FS): LandingJournalPort {
  const leafPath = path.join(ccrcDir, LANDING_JOURNAL_BASENAME);
  const issued = new WeakMap<LandingJournalSnapshot, Evidence>();

  const close = (fd: number): void => { try { ops.closeSync(fd); } catch { /* the answer stands */ } };

  const identOf = (fd: number): { id: Ident; isFile: boolean; isDir: boolean; size: bigint } => {
    const st = ops.fstatSync(fd, { bigint: true });
    return { id: { dev: st.dev, ino: st.ino }, isFile: st.isFile(), isDir: st.isDirectory(), size: st.size };
  };

  /** Every byte behind `fd`, from offset 0. */
  const readAll = (fd: number): Buffer => {
    const chunks: Buffer[] = [];
    let pos = 0;
    for (;;) {
      const buf = Buffer.allocUnsafe(65536);
      const n = ops.readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      chunks.push(buf.subarray(0, n));
      pos += n;
    }
    return Buffer.concat(chunks);
  };

  /** Open the leaf by pathname: `null` on ENOENT, the fd and its regular-file identity otherwise. Throws on anything else. */
  const openLeaf = (flags: number, mode?: number): { fd: number; id: Ident } | null => {
    let fd: number;
    try {
      fd = ops.openSync(leafPath, flags, mode);
    } catch (err) {
      if (errnoOf(err) === 'ENOENT') return null;
      throw err;
    }
    try {
      const st = identOf(fd);
      if (!st.isFile) throw new Refusal('unreadable');
      return { fd, id: st.id };
    } catch (err) {
      close(fd);
      throw err;
    }
  };

  /** The parent path still denotes the retained parent descriptor's directory. */
  const parentUnchanged = (ev: { readonly parent: Ident }): boolean => {
    const fd = ops.openSync(ccrcDir, OPEN_DIR);
    try { return sameIdent(identOf(fd).id, ev.parent); } finally { close(fd); }
  };

  /** Re-prove the snapshot against the pathname: same parent, and absence or the same leaf identity and bytes. */
  const reprove = (ev: Evidence): boolean => {
    if (!parentUnchanged(ev)) return false;
    if (ev.leaf === null) {
      const again = openLeaf(OPEN_LEAF);
      if (again === null) return true;
      close(again.fd);
      return false;
    }
    const again = openLeaf(OPEN_LEAF);
    if (again === null) return false;
    try {
      return sameIdent(again.id, ev.leaf.id) && readAll(again.fd).equals(ev.bytes);
    } finally {
      close(again.fd);
    }
  };

  const spend = (ev: Evidence): void => {
    if (ev.state === 'spent') return;
    ev.state = 'spent';
    if (ev.leaf !== null) close(ev.leaf.fd);
    close(ev.parentFd);
  };

  const evidenceOf = (snapshot: LandingJournalSnapshot): Evidence | null => {
    const ev = issued.get(snapshot);
    return ev !== undefined && ev.state === 'live' ? ev : null;
  };

  return {
    read(): LandingJournalRead {
      let parentFd = -1;
      let leafFd = -1;
      try {
        parentFd = ops.openSync(ccrcDir, OPEN_DIR);
        const parent = identOf(parentFd);
        if (!parent.isDir) throw new Refusal('unreadable');
        const leaf = openLeaf(OPEN_LEAF);
        if (leaf !== null) leafFd = leaf.fd;
        // the pathname still denotes the retained parent, so the leaf's absence or presence was measured in THAT directory
        if (!parentUnchanged({ parent: parent.id })) throw new Refusal('unreadable');
        let ev: Evidence;
        let result: LandingJournalRead;
        if (leaf === null) {
          ev = { parentFd, parent: parent.id, leaf: null, bytes: Buffer.alloc(0), state: 'live' };
          const snapshot: LandingJournalSnapshot = { release: () => spend(ev) };
          issued.set(snapshot, ev);
          result = { ok: true, kind: 'absent', snapshot };
        } else {
          const bytes = readAll(leafFd);
          let body: string;
          try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new Refusal('unreadable'); }
          ev = { parentFd, parent: parent.id, leaf: { fd: leafFd, id: leaf.id }, bytes, state: 'live' };
          const snapshot: LandingJournalSnapshot = { release: () => spend(ev) };
          issued.set(snapshot, ev);
          result = { ok: true, kind: 'present', text: body, snapshot };
        }
        // Ownership of the descriptors passed to the snapshot.
        parentFd = -1;
        leafFd = -1;
        return result;
      } catch {
        return { ok: false, error: 'unreadable' };
      } finally {
        if (leafFd >= 0) close(leafFd);
        if (parentFd >= 0) close(parentFd);
      }
    },

    confirmDurable(snapshot) {
      const ev = evidenceOf(snapshot);
      if (ev === null) return { ok: false, error: 'unreadable' };
      try {
        if (!reprove(ev)) return { ok: false, error: 'changed' };
      } catch {
        return { ok: false, error: 'unreadable' };
      }
      try {
        if (ev.leaf !== null) ops.fsyncSync(ev.leaf.fd);
        ops.fsyncSync(ev.parentFd);
      } catch {
        return { ok: false, error: 'durability' };
      }
      try {
        return reprove(ev) ? { ok: true } : { ok: false, error: 'changed' };
      } catch {
        return { ok: false, error: 'unreadable' };
      }
    },

    append(snapshot, record: LandingJournalRecord) {
      const fail = (error: LandingJournalIoFailure): { ok: false; error: LandingJournalIoFailure; mayApply: true } =>
        ({ ok: false, error, mayApply: true });
      const ev = evidenceOf(snapshot);
      if (ev === null) return fail('unreadable');
      let fd = -1;
      try {
        // 1. re-prove the snapshot before any byte is written
        let proved: boolean;
        try { proved = reprove(ev); } catch { return fail('unreadable'); }
        if (!proved) return fail('changed');
        const line = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
        // 2. open the file to write through: the proven leaf, or an exclusively created one for a proven absence
        try {
          const opened = openLeaf(ev.leaf === null ? OPEN_CREATE : OPEN_APPEND, 0o600);
          if (opened === null) return fail('changed');
          fd = opened.fd;
          if (ev.leaf !== null && !sameIdent(opened.id, ev.leaf.id)) return fail('changed');
          if (ev.leaf !== null && !readAll(fd).equals(ev.bytes)) return fail('changed');
        } catch (err) {
          if (errnoOf(err) === 'EEXIST') return fail('changed');
          const code = errnoOf(err);
          if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return fail('unwritable');
          return fail(err instanceof Refusal ? err.word : 'unreadable');
        }
        // 3. one record, short writes continued
        try {
          let done = 0;
          while (done < line.length) {
            const n = ops.writeSync(fd, line, done, line.length - done);
            if (n <= 0) return fail('unwritable');
            done += n;
          }
        } catch {
          return fail('unwritable');
        }
        // 4. the file, then its parent
        try {
          ops.fsyncSync(fd);
          ops.fsyncSync(ev.parentFd);
        } catch {
          return fail('durability');
        }
        // 5. the pathname still denotes the file we wrote, holding exactly the expected complete bytes
        try {
          const expected = Buffer.concat([ev.bytes, line]);
          if (!parentUnchanged(ev)) return fail('changed');
          const again = openLeaf(OPEN_LEAF);
          if (again === null) return fail('changed');
          try {
            if (!sameIdent(again.id, identOf(fd).id)) return fail('changed');
            if (ev.leaf !== null && !sameIdent(again.id, ev.leaf.id)) return fail('changed');
            if (!readAll(again.fd).equals(expected)) return fail('changed');
          } finally {
            close(again.fd);
          }
        } catch {
          return fail('unreadable');
        }
        return { ok: true };
      } finally {
        if (fd >= 0) close(fd);
        spend(ev);
      }
    },
  };
}
