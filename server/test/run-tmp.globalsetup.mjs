// The server suite's per-run temp parent (#316): every fixture a run makes lives under ONE directory that the
// run owns, so a run that is killed leaves one thing to collect instead of hundreds.
//
// WHY. Before this file, only hooks inside the WORKER processes removed fixtures (`tmpHelpers.ts`'s `afterAll`),
// and nothing that outlives a killed worker owned them. Measured on a Mac: `timeout 25 vitest run
// test/ccrc-doctor.test.ts` under a scratch TMPDIR left 11 entries and 15 MB behind, vitest's own 5.6 MB
// transform dir among them; #316 counted 1,551 directories and 5.74 GiB from five timed-out shards in one
// morning. Moving cleanup into the main process is not enough on its own either (see `armSignals`).
//
// LAYOUT. `<base>/ccrc-testrun-XXXXXX/{live.sock, owner.json, tmp/}`, where `base` is `realpath(os.tmpdir())`
// read in vitest's MAIN process and the workers' TMPDIR is `…/tmp`, so nothing a test writes lands beside the
// socket. `mkdtemp` names the parent, not a pid: `ccrc-run-` is already a `mkTmp` prefix in this suite
// (`run-signals.test.ts`), which is also why the reaper matches names by an ANCHORED expression, never a prefix.
//
// LIVENESS IS A SOCKET, NOT A PID (D-4499). The owner listens on `live.sock`; a later run CONNECTS to decide
// whether the owner is alive. Measured, each:
//   - a SIGSTOPped owner still connects (the kernel accepts into the backlog), so a paused run is `live`;
//   - a SIGKILLed owner whose forked child is still alive refuses (ECONNREFUSED): libuv opens every fd
//     close-on-exec, so the workers do not inherit the listening socket, and main's death is visible while
//     orphan workers run on;
//   - a connect answers identically through a bind-mount spelling and a whole-volume spelling of one directory
//     (measured in Docker), where a pid answers differently in every pid namespace and is reused;
//   - a regular file at the socket's path gives ECONNREFUSED on Linux and ENOTSOCK on macOS, hence the `lstat`
//     check comes FIRST and a non-socket is `unmeasurable`, never `dead`;
//   - `sun_path` is 104 bytes on macOS and 108 on Linux; past it both `listen` and `connect` fail EINVAL.
// `owner.json` (pid, host, start time) is for a human reading a leftover directory. It decides nothing a socket
// can answer: a socket that connects is `live` whatever else is true.
//
// THE NEXT RUN REAPS ONLY WHAT IS QUIET (D-4496). A dead owner is not enough: orphan workers outlive a killed
// main process and keep writing (measured alive 12 s after main died), so a run is condemned only after
// `RUN_QUIET_S` with no top-level change to the run dir or its `tmp/`. ctime, because nothing can rewind it and
// only top-level entries move it (both measured). The walk also refuses to be steered: an anchored name, an
// `lstat` (never `stat`, so a link named like a run is not followed), this uid, and a direct child of the base
// it was given — through whatever spelling of that base it was given, since a bind mount is one directory with
// two names.
//
// WHY A `.mjs` THAT IMPORTS ONLY `node:` BUILTINS. Bare-`node` children import it (`run-tmp.test.ts` spawns
// real owners), and the node floor (22.16) cannot strip types; `shared/base-url.mjs` is the precedent.
import {
  closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, renameSync, rmSync, writeSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const RUN_PREFIX = 'ccrc-testrun-';
/** A run being removed: renamed to `<run>.dead` first, so an interrupted removal is recognisable and any later
 *  actor finishes it without probing. */
export const DEAD_SUFFIX = '.dead';
export const RUN_SOCKET = 'live.sock';
export const RUN_OWNER = 'owner.json';
export const RUN_TMP = 'tmp';
/** The run's own name, and nothing else: `mkdtemp`'s six characters, optionally mid-removal. Built from the two
 *  names above so it cannot drift from them. */
export const RUN_NAME_RE = new RegExp(`^${RUN_PREFIX}[A-Za-z0-9]{6}(${DEAD_SUFFIX.replace('.', '\\.')})?$`);
/** How long a dead or unowned run must have been quiet before a later run condemns it (D-4496). */
export const RUN_QUIET_S = 600;
const PROBE_TIMEOUT_MS = 2000;

/** Rename `dir` to `dir.dead`, then remove it. The rename is atomic and only one actor wins it; the loser reads
 *  `gone`. An `rm` that fails leaves the `.dead` name for a later actor and is REPORTED, never thrown: a cleanup
 *  that throws would fail a green run over a directory a test left at mode 0500.
 *  @param {string} dir
 *  @returns {'removed' | 'gone' | `left:${string}`} */
export function condemn(dir) {
  const dead = dir.endsWith(DEAD_SUFFIX) ? dir : dir + DEAD_SUFFIX;
  if (dead !== dir) {
    try { renameSync(dir, dead); } catch (e) { return e.code === 'ENOENT' ? 'gone' : `left:${e.code ?? 'rename'}`; }
  }
  try {
    rmSync(dead, { recursive: true, force: true, maxRetries: 3 });
    return 'removed';
  } catch (e) {
    return `left:${e.code ?? 'rm'}`;
  }
}

/** Connect once: `'ok'`, the error's code, or `'timeout'`. Never rejects.
 *  @param {string} sock @param {number} ms @returns {Promise<string>} */
function tryConnect(sock, ms) {
  return new Promise((resolve) => {
    let c;
    try { c = net.connect(sock); } catch (e) { resolve(e.code ?? 'connect'); return; }
    const t = setTimeout(() => { c.destroy(); resolve('timeout'); }, ms);
    c.once('connect', () => { clearTimeout(t); c.destroy(); resolve('ok'); });
    c.once('error', (e) => { clearTimeout(t); c.destroy(); resolve(e.code ?? 'connect'); });
  });
}

/** What a run directory says about its owner. Six answers, kept apart because the reaper acts on two of them:
 *
 *  | `live.sock`   | connect            | `owner.json` | verdict                     |
 *  |---------------|--------------------|--------------|-----------------------------|
 *  | socket        | connects           | any          | `live`                      |
 *  | socket        | ECONNREFUSED       | present      | `dead`                      |
 *  | socket        | ECONNREFUSED       | absent       | `unowned`                   |
 *  | absent        | –                  | absent       | `unowned`                   |
 *  | absent        | –                  | present      | `unmeasurable:ENOENT`       |
 *  | not a socket  | –                  | any          | `unmeasurable:not-a-socket` |
 *  | socket        | other error, 2 s   | any          | `unmeasurable:<code>`       |
 *
 *  `unowned` is a directory nobody finished making, or one an orphan worker re-created; `unmeasurable` is never
 *  acted on.
 *  @param {string} dir @param {number} [timeoutMs]
 *  @returns {Promise<'live' | 'dead' | 'unowned' | `unmeasurable:${string}`>} */
export async function probeRun(dir, timeoutMs = PROBE_TIMEOUT_MS) {
  const sock = path.join(dir, RUN_SOCKET);
  let isSock = false;
  let sockErr = null;
  try { isSock = lstatSync(sock).isSocket(); } catch (e) { sockErr = e.code ?? 'lstat'; }
  const conn = isSock ? await tryConnect(sock, timeoutMs) : null;
  if (conn === 'ok') return 'live';
  let owned;
  try {
    lstatSync(path.join(dir, RUN_OWNER));
    owned = true;
  } catch (e) {
    if (e.code !== 'ENOENT') return `unmeasurable:owner-${e.code ?? 'lstat'}`;
    owned = false;
  }
  if (!owned && (sockErr === 'ENOENT' || conn === 'ECONNREFUSED')) return 'unowned';
  if (owned && conn === 'ECONNREFUSED') return 'dead';
  if (sockErr) return `unmeasurable:${sockErr}`;
  if (!isSock) return 'unmeasurable:not-a-socket';
  return `unmeasurable:${conn}`;
}

/** Remove what a refused `openRun` made. Best effort: the refusal is the news, not this. */
function unmake(run) {
  try { rmSync(run, { recursive: true, force: true }); } catch { /* the reaper's quiet gate collects it */ }
}

/** Make this run's directory under `base` and start listening on its socket: `mkdtemp`, `mkdir tmp`, `listen`
 *  (unref'd, so it never holds vitest open), then `owner.json` (`wx`, 0600). Any failure removes what was made
 *  and answers `{ refused: <code> }` — a TMPDIR too long for `sun_path` answers `EINVAL`.
 *  @param {string} base
 *  @returns {Promise<{ run: string, server: import('node:net').Server } | { refused: string }>} */
export function openRun(base) {
  let run;
  try { run = mkdtempSync(path.join(base, RUN_PREFIX)); } catch (e) { return Promise.resolve({ refused: e.code ?? 'mkdtemp' }); }
  try { mkdirSync(path.join(run, RUN_TMP)); } catch (e) { unmake(run); return Promise.resolve({ refused: e.code ?? 'mkdir' }); }
  return new Promise((resolve) => {
    const server = net.createServer((c) => { c.on('error', () => {}); c.destroy(); });
    server.once('error', (e) => { unmake(run); resolve({ refused: e.code ?? 'listen' }); });
    server.listen(path.join(run, RUN_SOCKET), () => {
      server.unref();
      server.on('error', () => {});       // a listening server that errors later must not crash vitest's main process
      try {
        const fd = openSync(path.join(run, RUN_OWNER), 'wx', 0o600);
        try {
          writeSync(fd, `${JSON.stringify({ pid: process.pid, host: os.hostname(), started: new Date().toISOString() })}\n`);
        } finally {
          closeSync(fd);
        }
      } catch (e) {
        server.close();
        unmake(run);
        resolve({ refused: `owner-${e.code ?? 'write'}` });
        return;
      }
      resolve({ run, server });
    });
  });
}

/** The next run's collector: walk `base` for this suite's run directories and condemn the dead or unowned ones
 *  that have been quiet for `quietS`. Every entry is decided on its own and inside its own `try`, so one entry
 *  that throws is recorded and the walk goes on; the call never rejects.
 *
 *  `removed` holds `[name, '<why>:<removed|gone>']` with why `dead`, `unowned` or `dead-suffix`; `left` holds
 *  `[name, why]` for everything matched and kept — a verdict (`live`, `unmeasurable:*`), `<verdict>:not-quiet`,
 *  `not-a-directory`, `foreign-uid`, a failed removal's `left:<code>`, or `error:<code>`. A base that cannot be
 *  listed answers `left: [['.', 'unreadable:<code>']]`.
 *  @param {string} base
 *  @param {{ now?: number, uid?: number, quietS?: number }} [opts]
 *  @returns {Promise<{ removed: [string, string][], left: [string, string][] }>} */
export async function reapRuns(base, { now = Date.now(), uid = process.getuid?.() ?? -1, quietS = RUN_QUIET_S } = {}) {
  /** @type {[string, string][]} */ const removed = [];
  /** @type {[string, string][]} */ const left = [];
  let names;
  try { names = readdirSync(base).sort(); } catch (e) { return { removed, left: [['.', `unreadable:${e.code ?? 'readdir'}`]] }; }
  const settle = (name, why, r) => {
    if (r.startsWith('left:')) left.push([name, r]); else removed.push([name, `${why}:${r}`]);
  };
  for (const name of names) {
    if (!RUN_NAME_RE.test(name)) continue;
    const dir = path.join(base, name);
    try {
      const st = lstatSync(dir);
      if (!st.isDirectory()) { left.push([name, 'not-a-directory']); continue; }
      if (st.uid !== uid) { left.push([name, 'foreign-uid']); continue; }
      if (name.endsWith(DEAD_SUFFIX)) { settle(name, 'dead-suffix', condemn(dir)); continue; }
      const v = await probeRun(dir);
      if (v !== 'dead' && v !== 'unowned') { left.push([name, v]); continue; }
      let quietSince = st.ctimeMs;
      try { quietSince = Math.max(quietSince, lstatSync(path.join(dir, RUN_TMP)).ctimeMs); } catch { /* no tmp/: the run dir's own ctime is all there is */ }
      if (now - quietSince < quietS * 1000) { left.push([name, `${v}:not-quiet`]); continue; }
      settle(name, v, condemn(dir));
    } catch (e) {
      left.push([name, `error:${e.code ?? 'throw'}`]);
    }
  }
  return { removed, left };
}
