// shared/fsync-open.mjs -- how a path is opened when it is opened to be fsynced, said once for every writer that
// makes a write, a rename, a create or a cut durable (the coordination snapshot, the history store, the server's
// journals and the delegation port).
//
// POSIX syncs a read-only descriptor, and refuses a read-write one on a directory (EISDIR). Windows is the
// opposite: FlushFileBuffers needs write access, so a file or a directory opened read-only answers EPERM and one
// opened read-write flushes. Measured on Windows 11 / NTFS, Node 22: O_RDONLY -> EPERM, O_RDWR -> ok, for both.
// Before this every such fsync on a Windows box failed: `ccrc backup` (and so `ccrc update`) refused, and every
// append-only journal append answered `durability`.
import { constants } from 'node:fs';

/** The open flags for a file or directory that is about to be fsynced (or held to be fsynced later). */
export const FSYNC_OPEN = process.platform === 'win32' ? constants.O_RDWR : constants.O_RDONLY;
