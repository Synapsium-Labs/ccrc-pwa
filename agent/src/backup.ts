// D-7858, D-7859. L3 adapter: the agent's `backup` op reads the backup state files and answers WHAT IT READ. It decides
// nothing: the status is `shared/backup.ts#backupVerdict`'s, on the server.
//
// The op takes no argument, so no path from a caller is ever read: the directory is `CCRC_BACKUP_STATE_DIR` in THIS
// process's environment (the agent's `agent.env` on a fleet box; the server's `ccrc.env` when a local-mode server calls
// the same body, D-7859), and the file names are `BACKUP_FILES`. Unset or empty is `not-configured`, never an alarm.
//
// Every read is bounded: `O_NONBLOCK` (a FIFO at a name returns at once), `O_NOFOLLOW` (a symlink at a name is a fault,
// never its target's bytes), `fstat` must say a regular file, and at most `BACKUP_FILE_MAX_BYTES` are read; only the
// first line is answered. A missing file is absent (a run that never happened); EACCES or EPERM anywhere is `denied`,
// and any other fault on any file is `failed`, so a fault never reads as a file that is not there.
import { closeSync, constants as fsConstants, fstatSync, openSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { BACKUP_FILE_MAX_BYTES, BACKUP_FILES, type BackupFile, type BackupRead, type BackupUnreadableWhy } from '../../shared/backup.js';

/** Every read this op makes, so a test injects the environment. The file reads are real (a fixture directory). */
export interface BackupSeams { env: NodeJS.ProcessEnv }

const realSeams = (): BackupSeams => ({ env: process.env });

const code = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;
const whyOf = (e: unknown): BackupUnreadableWhy => (code(e) === 'EACCES' || code(e) === 'EPERM' ? 'denied' : 'failed');

/** One file's first line, `null` when it is absent, or the fault's word. */
function readFirstLine(p: string): { ok: true; text: string | null } | { ok: false; why: BackupUnreadableWhy } {
  let fd: number | undefined;
  try {
    fd = openSync(p, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
  } catch (e) {
    return code(e) === 'ENOENT' ? { ok: true, text: null } : { ok: false, why: whyOf(e) };
  }
  try {
    if (!fstatSync(fd).isFile()) return { ok: false, why: 'failed' };
    const buf = Buffer.alloc(BACKUP_FILE_MAX_BYTES);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, got);
      if (n === 0) break;
      got += n;
    }
    return { ok: true, text: buf.subarray(0, got).toString('utf8').split('\n', 1)[0]! };
  } catch (e) {
    return { ok: false, why: whyOf(e) };
  } finally {
    try { closeSync(fd); } catch { /* closed */ }
  }
}

/** What the configured directory holds. Never throws: every fault is an `unreadable` answer. */
export function measureBackup(given: Partial<BackupSeams> = {}): BackupRead {
  const { env } = { ...realSeams(), ...given };
  const dir = (env['CCRC_BACKUP_STATE_DIR'] ?? '').trim();
  if (dir === '') return { state: 'not-configured' };
  if (!path.isAbsolute(dir)) return { state: 'unreadable', why: 'not-absolute' };
  try {
    if (!statSync(dir).isDirectory()) return { state: 'unreadable', why: 'failed' };
  } catch (e) {
    return { state: 'unreadable', why: code(e) === 'ENOENT' ? 'no-directory' : whyOf(e) };
  }
  const files: Partial<Record<BackupFile, string>> = {};
  for (const f of BACKUP_FILES) {
    const r = readFirstLine(path.join(dir, f));
    if (!r.ok) return { state: 'unreadable', why: r.why };
    if (r.text !== null) files[f] = r.text;
  }
  return { state: 'read', files };
}
