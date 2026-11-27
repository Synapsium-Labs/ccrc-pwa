// `readLiveStateFor` (src/livestate.ts) — the live file addressed by the fact
// both sides write, with the pane pid as the fast path.
//
// The pid alone is a key only where tmux and Claude Code share a pid namespace.
// On Windows they do not: tmux is an MSYS2 program and reports the pid the MSYS
// runtime assigned; Claude Code is native and names its file by the Windows pid
// it sees for itself. Measured on this box — tmux said 7956, the file was
// `56116.json`. Every server-side read missed, and since each caller reads a
// null as "nothing to report" rather than as a failure, none of them said so:
// the board showed every session idle and unnamed, mail's idle gate never
// opened, and `archiveSafety` refused a plainly idle session as `unknown`.
//
// `ccd`'s half is `_hook_pid`, which reads MSYS's `/proc/<pid>/winpid`. Native
// Node cannot — that path is synthesized in-process and is ENOENT on disk — so
// this side resolves by identity. Both halves are needed: the archive path is
// gated twice, once in `ccd` and once here.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readLiveStateFor } from '../src/livestate.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';

const UUID = '7'.repeat(36);
const OTHER = 'a'.repeat(36);

/** A wrapper HOME holding several session files, as a real one does — the
 *  fixture box had sixteen, only one of them the live pane's. */
function seed(files: Record<number, unknown>): string {
  const configDir = path.join(mkTmp('ccrc-liveuuid-'), '.claude');
  mkdirSync(path.join(configDir, 'sessions'), { recursive: true });
  for (const [pid, raw] of Object.entries(files)) {
    writeFileSync(path.join(configDir, 'sessions', `${pid}.json`), JSON.stringify(raw));
  }
  return configDir;
}

const file = (sessionId: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ sessionId, status, cwd: '/w', name: 'n', statusUpdatedAt: 1, version: '2', ...extra });

// The uuid scan is the Windows rung: off Windows a pane pid is the whole key, as it was before the Windows port (a
// stale file of an earlier pid naming the same uuid must not answer for a pane that has published nothing yet), so
// the cases that need the scan to FIND a file run on Windows only; `livestate-pid-collision.test.ts` pins POSIX.
const offWindows = process.platform !== 'win32';

describe('readLiveStateFor', () => {
  it('takes the pid when the pid is the key — one read, no scan', async () => {
    const cfg = seed({ 111: file(UUID, 'busy'), 222: file(OTHER, 'idle') });
    const live = await readLiveStateFor(localIO, cfg, 111, UUID);
    expect(live?.status).toBe('busy');
    expect(live?.pid).toBe(111);
  });

  it.skipIf(offWindows)('finds the file by uuid when the pane pid names no file — the Windows case', async () => {
    // tmux says 7956; the file is 56116.json. Nothing on disk is called 7956.
    const cfg = seed({ 56116: file(UUID, 'busy'), 5828: file(OTHER, 'idle') });
    const live = await readLiveStateFor(localIO, cfg, 7956, UUID);
    expect(live?.status).toBe('busy');
    expect(live?.pid).toBe(56116);
  });

  it.skipIf(!offWindows)('off Windows a pane pid that names no file answers null, never another pid\'s file with the uuid', async () => {
    // The negative control for the gate: a scan run on POSIX would hand a pane that has published nothing yet the
    // state of a stale file an earlier process left under the same uuid, which the pid read before the port never did.
    const cfg = seed({ 56116: file(UUID, 'busy') });
    expect(await readLiveStateFor(localIO, cfg, 7956, UUID)).toBeNull();
  });

  it.skipIf(offWindows)('picks the file whose uuid MATCHES, never merely the first one there', async () => {
    // The negative control for a scan that "works" by accident: with a single
    // file present, any scan at all looks correct.
    const cfg = seed({ 100: file(OTHER, 'idle'), 200: file('b'.repeat(36), 'idle'), 300: file(UUID, 'busy') });
    expect((await readLiveStateFor(localIO, cfg, 7956, UUID))?.pid).toBe(300);
  });

  it('answers null when no file carries that uuid — it does not fall back to a guess', async () => {
    // The direction matters: a scan that returned "the newest file" would hand
    // `archiveSafety` another session's status for a session it never found.
    const cfg = seed({ 100: file(OTHER, 'idle') });
    expect(await readLiveStateFor(localIO, cfg, 7956, UUID)).toBeNull();
  });

  it('answers null for an EMPTY uuid rather than scanning', async () => {
    // A degraded registry record's uuid is `''` (see `measuredIdentity`). It
    // must not match a file, and it must not become "read whatever is there".
    const cfg = seed({ 100: file('', 'busy') });
    expect(await readLiveStateFor(localIO, cfg, null, '')).toBeNull();
  });

  it('survives an unlistable sessions directory, and a pid of null', async () => {
    const cfg = path.join(mkTmp('ccrc-liveuuid-'), '.claude');
    expect(await readLiveStateFor(localIO, cfg, null, UUID)).toBeNull();
  });

  it.skipIf(offWindows)('ignores names that are not `<digits>.json`', async () => {
    // `sessions/` also carries lock and temp files on a live box; parsing one
    // as a pid would put NaN in `LiveState.pid`, which the PWA renders.
    const cfg = seed({ 300: file(UUID, 'busy') });
    writeFileSync(path.join(cfg, 'sessions', 'notes.json'), JSON.stringify(file(UUID, 'idle')));
    writeFileSync(path.join(cfg, 'sessions', '300.json.tmp'), JSON.stringify(file(UUID, 'idle')));
    const live = await readLiveStateFor(localIO, cfg, 7956, UUID);
    expect(live?.pid).toBe(300);
    expect(Number.isInteger(live?.pid)).toBe(true);
  });
});
