// The delegation durability's node file port (D-7509; ARCH-05): the real filesystem behind the `DelegationFilePort` the
// journal (`delegation-journal.ts`) declares. It was the one part of the journal that touched `node:fs`, below its `IMPURE SHELL`
// banner; it lives here so the journal and the checkpoint stay free of the filesystem and only the composition root (the delegation
// applier in `watch.ts`) loads it. Absence is `null` from `readFile`, `openRead`, `listDir` and `statFile`, and only for ENOENT: any
// other failure throws, so an unreadable file is never mistaken for an absent one. Files are created 0600, directories 0700.
import { constants as fsConstants } from 'node:fs';
import fsp from 'node:fs/promises';
import type { DelegationFileHandle, DelegationFilePort } from './delegation-journal.js';

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
  truncate: (p, length) => fsp.truncate(p, length),
  fsyncFile: async (p) => {
    const fh = await fsp.open(p, fsConstants.O_RDONLY);
    try { await fh.sync(); } finally { await fh.close(); }
  },
  listDir: async (dir) => {
    try { return await fsp.readdir(dir); } catch (err) { if (isEnoent(err)) return null; throw err; }
  },
  statFile: async (p) => {
    try { const st = await fsp.stat(p); return { size: st.size, mtimeMs: st.mtimeMs }; } catch (err) { if (isEnoent(err)) return null; throw err; }
  },
};
