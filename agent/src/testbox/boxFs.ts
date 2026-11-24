// D-8907 (spec docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md §2.5, §2.7, §2.12). L3: the one
// adapter that opens the small files the box's updater and the test service exchange (`boxFiles.ts` names them and
// reads their text). It decides nothing and narrows nothing: a read answers the file's text, that the file is proven
// absent, or that it could not be read and why (`boxFiles.ts#SmallRead`).
//
// A file root wrote is read as data: opened without following a link at its last name, without blocking (a FIFO in
// its place cannot hang the service), only when it is a regular file, and only to `BOX_FILE_MAX` bytes. The service's
// own files are written to a temporary name beside them and renamed into place, so a reader never sees half of one.
import { closeSync, constants as fsConstants, fstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BOX_FILE_MAX, type SmallRead } from './boxFiles.js';

const errno = (e: unknown): string => (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : 'unknown');

/** One small file. `absent` only on a proven absence (no such file, or a name on its path that is no directory). */
export function readSmall(file: string, max: number = BOX_FILE_MAX): SmallRead {
  let fd: number | null = null;
  try {
    fd = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) return { t: 'unreadable', why: 'not a regular file' };
    const buf = Buffer.alloc(max + 1);
    const n = readSync(fd, buf, 0, buf.length, 0);
    if (n > max) return { t: 'unreadable', why: `longer than ${max} bytes` };
    return { t: 'text', text: buf.subarray(0, n).toString('utf8') };
  } catch (e) {
    const code = errno(e);
    if (code === 'ENOENT' || code === 'ENOTDIR') return { t: 'absent' };
    return { t: 'unreadable', why: code === 'ELOOP' || code === 'EMLINK' ? 'a symbolic link' : code };
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* closed */ }
  }
}

/** `text` as `<dir>/<name>`, whole or not at all: written beside it, then renamed. Throws when it cannot. */
export function writeSmall(dir: string, name: string, text: string): void {
  const file = path.join(dir, name);
  const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, text, { mode: 0o644 });
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* never written */ }
    throw e;
  }
}

/** The file removed; one that is not there is already removed. */
export function removeSmall(file: string): void {
  try { unlinkSync(file); } catch { /* none */ }
}

/** The adapter as its callers take it (a test may pass another). */
export interface BoxFs {
  read(file: string): SmallRead;
  write(dir: string, name: string, text: string): void;
  remove(file: string): void;
}
export const boxFs: BoxFs = { read: (file) => readSmall(file), write: writeSmall, remove: removeSmall };
