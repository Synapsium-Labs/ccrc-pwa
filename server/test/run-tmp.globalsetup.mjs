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
//   - `sun_path` takes 104 bytes on macOS and 108 on Linux. Past it Node 24+ fails `listen` and `connect` with
//     EINVAL, but Node 22 — the version CI runs — and Node 20 silently TRUNCATE the path and bind or connect at
//     the shorter name (measured on Linux, 22.23.3 and 20.20.2): a socket left at a path nobody named, and a
//     probe through a long spelling answered by whatever sits at the short one. So the byte length is checked
//     HERE, before either call, and is EINVAL on every Node (`RUN_SUN_PATH_MAX`).
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
// THE MAIN PROCESS COLLECTS ITS OWN RUN ON A SIGNAL (D-4498). `globalSetup`'s teardown never runs on a signal:
// under `timeout 4 vitest run` 6 of 6 runs leaked with teardown alone, and 5 of 6 with an `exit` hook added,
// because GNU `timeout` signals its child and then the child's process group, so vitest's main process gets
// SIGTERM TWICE — and vitest's own listener is a `once`, gone by the second delivery, whose default action then
// kills main before vitest's 1 ms exit timer fires. vitest installs no SIGHUP handler at all (2 of 2 leaked). So
// the arm is PERSISTENT listeners for SIGTERM, SIGINT and SIGHUP plus an `exit` listener; with it, 6 of 6 runs
// under `timeout` were clean, and so were double SIGTERM, SIGTERM to main only, and SIGINT and SIGHUP to the
// group, exiting 143, 130 and 129.
//
// A RUN THAT CANNOT HAVE ITS OWN PARENT SAYS SO AND CARRIES ON AS BEFORE (D-4497). When `realpath`, `mkdtemp`,
// `listen` or the `owner.json` write fails — a TMPDIR too long for `sun_path` (a base over about 74 characters
// on macOS, 78 on Linux; the macOS default is 56, CI's is 4) or a sandbox — what was made is removed, TMPDIR is
// left alone, an inherited CCRC_TEST_RUN_DIR is deleted, CCRC_TEST_RUN_REFUSED names the code, and one
// `ccrc-test: per-run temp dir refused (<code>)` line is printed. That is the status quo, made loud; the
// reclamation spec's "a temp root that cannot be made private is not used" is the precedent, and
// `run-tmp.test.ts`'s T1 is red in such a run.
//
// WHAT THIS DOES NOT DO. It never signals another process: its arm exits this one. It does not collect
// vitest's own `TestProject.tmpDir` (a follow-up), loose `ccrc-*` directories from before it existed (proposal
// 3 of #316, a follow-up), or a TMPDIR no later run visits.
//
// WHY A `.mjs` THAT IMPORTS ONLY `node:` BUILTINS. Bare-`node` children import it (`run-tmp.test.ts` spawns
// real owners), and the node floor (22.16) cannot strip types; `shared/base-url.mjs` is the precedent.
import {
  closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, realpathSync, renameSync, rmSync, writeSync,
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
/** The run directory, as the workers see it. Read by `run-tmp.test.ts`'s T1; nothing else should need it. */
export const RUN_DIR_ENV = 'CCRC_TEST_RUN_DIR';
/** Set, to the refusal's code, only when this run could not have its own parent (D-4497). */
export const RUN_REFUSED_ENV = 'CCRC_TEST_RUN_REFUSED';
/** For tests only: the quiet window in whole seconds, in place of `RUN_QUIET_S`. */
export const RUN_QUIET_ENV = 'CCRC_TEST_RUN_QUIET_S';
/** The signals the arm collects on, by number, so an armed exit is 128+n as a default action's would be. */
export const RUN_SIGNALS = Object.freeze({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 });
/** The longest unix socket path, in bytes, the platform's `sockaddr_un.sun_path` takes: 108 on Linux, 104 on
 *  macOS and the BSDs (each measured at the boundary). A longer one is EINVAL here, whatever the Node. */
export const RUN_SUN_PATH_MAX = process.platform === 'linux' ? 108 : 104;
/** How long a dead or unowned run must have been quiet before a later run condemns it (D-4496). */
export const RUN_QUIET_S = 600;
const PROBE_TIMEOUT_MS = 2000;

/** Rename `dir` to `dir.dead`, then remove it. The rename is atomic and only one actor wins it; the loser reads
 *  `gone`, and so does a caller handed a `.dead` name another actor has already removed (`rm`'s `force` would
 *  otherwise read that as `removed`). An `rm` that fails leaves the `.dead` name for a later actor and is
 *  REPORTED, never thrown: a cleanup that throws would fail a green run over a directory a test left at mode 0500.
 *  @param {string} dir
 *  @returns {'removed' | 'gone' | `left:${string}`} */
export function condemn(dir) {
  const dead = dir.endsWith(DEAD_SUFFIX) ? dir : dir + DEAD_SUFFIX;
  if (dead !== dir) {
    try { renameSync(dir, dead); } catch (e) { return e.code === 'ENOENT' ? 'gone' : `left:${e.code ?? 'rename'}`; }
  } else {
    try { lstatSync(dead); } catch (e) { if (e.code === 'ENOENT') return 'gone'; }
  }
  try {
    rmSync(dead, { recursive: true, force: true, maxRetries: 3 });
    return 'removed';
  } catch (e) {
    return `left:${e.code ?? 'rm'}`;
  }
}

/** True when `sock` is too long to bind or connect without truncation. */
const tooLong = (sock) => Buffer.byteLength(sock) > RUN_SUN_PATH_MAX;

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
 *  | too long      | –                  | any          | `unmeasurable:EINVAL`       |
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
  const conn = !isSock ? null : tooLong(sock) ? 'EINVAL' : await tryConnect(sock, timeoutMs);
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

/** Make this run's directory under `base` and start listening on its socket: `mkdtemp`, `mkdir tmp`, the
 *  length check, `listen` (unref'd, so it never holds vitest open), then `owner.json` (`wx`, 0600). Any failure
 *  removes what was made and answers `{ refused: <code> }` — a TMPDIR too long for `sun_path` answers `EINVAL`.
 *  @param {string} base
 *  @returns {Promise<{ run: string, server: import('node:net').Server } | { refused: string }>} */
export function openRun(base) {
  let run;
  try { run = mkdtempSync(path.join(base, RUN_PREFIX)); } catch (e) { return Promise.resolve({ refused: e.code ?? 'mkdtemp' }); }
  /** Every refusal after the `mkdtemp` goes through here, so none of them can leave the directory behind. */
  const refused = (code) => { unmake(run); return { refused: code }; };
  try { mkdirSync(path.join(run, RUN_TMP)); } catch (e) { return Promise.resolve(refused(e.code ?? 'mkdir')); }
  const sock = path.join(run, RUN_SOCKET);
  if (tooLong(sock)) return Promise.resolve(refused('EINVAL'));
  return new Promise((resolve) => {
    const server = net.createServer((c) => { c.on('error', () => {}); c.destroy(); });
    // `listen`'s own failure, and ONLY that: a refusal removes the run, so this handler goes the moment the server
    // listens. A listening server errors later when `accept` fails (EMFILE, ENFILE, ENOMEM, ENOBUFS), and left
    // here this would answer that by deleting a live run's whole TMPDIR mid-run (T2l).
    const onListenError = (e) => { resolve(refused(e.code ?? 'listen')); };
    server.once('error', onListenError);
    server.listen(sock, () => {
      server.off('error', onListenError);
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
        resolve(refused(`owner-${e.code ?? 'write'}`));
        return;
      }
      resolve({ run, server });
    });
  });
}

/** Arm the main process to collect `run` on SIGTERM, SIGINT, SIGHUP and `exit` (D-4498). Persistent `on`, never
 *  `once`: GNU timeout delivers SIGTERM to main twice, and a second delivery after the last listener is gone
 *  takes the default action mid-`rm` (measured). Each signal condemns the run, keeps an exit code already set
 *  (vitest's own listener sets the same one) or sets 128+n, and exits on a 1 ms timer — vitest's own exit,
 *  kept for when its `once` is spent. Returns the disarm, which teardown calls first.
 *  @param {string} run @returns {() => void} */
export function armSignals(run) {
  const collect = () => { condemn(run); };
  const onSignal = (sig) => {
    collect();
    process.exitCode ??= 128 + RUN_SIGNALS[sig];
    setTimeout(() => process.exit(), 1);
  };
  for (const s of Object.keys(RUN_SIGNALS)) process.on(s, onSignal);
  process.on('exit', collect);
  return () => {
    for (const s of Object.keys(RUN_SIGNALS)) process.off(s, onSignal);
    process.off('exit', collect);
  };
}

/** The next run's collector: walk `base` for this suite's run directories and condemn the dead or unowned ones
 *  that have been quiet for `quietS`. Every entry is decided on its own and inside its own `try`, so one entry
 *  that throws is recorded and the walk goes on; the call never rejects.
 *
 *  `removed` holds `[name, '<why>:<removed|gone>']` with why `dead`, `unowned` or `dead-suffix`; `left` holds
 *  `[name, why]` for everything matched that this walk did not condemn — a verdict (`live`, `unmeasurable:*`),
 *  `<verdict>:not-quiet`, `not-a-directory`, `foreign-uid`, a failed removal's `left:<code>`, `gone` for an entry
 *  another actor removed between the listing and its `lstat` (runs overlap under a shared TMPDIR; that is not a
 *  failure), or `error:<code>`. A base that cannot be listed answers `left: [['.', 'unreadable:<code>']]`.
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
      let st;
      try { st = lstatSync(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; left.push([name, 'gone']); continue; }
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

/** One line on stderr. `ccrc-test:` so a reader of a run's output can find every line this file prints. */
function warn(msg) {
  process.stderr.write(`ccrc-test: ${msg}\n`);
}

/** `CCRC_TEST_RUN_QUIET_S` as a whole number of seconds, or the default — with a warning when it was set to
 *  anything else, rather than a silent default the setter would never notice. */
function parseQuiet(raw) {
  if (raw === undefined) return RUN_QUIET_S;
  if (/^\d+$/.test(raw)) return Number(raw);
  warn(`${RUN_QUIET_ENV}=${JSON.stringify(raw)} is not a whole number of seconds; using ${RUN_QUIET_S}`);
  return RUN_QUIET_S;
}

/** Reap `base`, saying so only when something was removed or could not be: a quiet walk prints nothing. */
async function reapAndReport(base, quietS) {
  const t0 = Date.now();
  const r = await reapRuns(base, { quietS });
  const reaped = r.removed.filter(([, why]) => why.endsWith(':removed')).length;   // a `gone` was another actor's
  if (reaped > 0) warn(`reaped ${reaped} dead test-run dir(s) under ${base} in ${Date.now() - t0} ms`);
  for (const [name, why] of r.left) {
    if (/^(left|error|unreadable):/.test(why)) warn(`could not reap ${path.join(base, name)} (${why}); the next run retries`);
  }
}

/** The refusal (D-4497): today's behaviour, said out loud. */
function refuse(code, where) {
  delete process.env[RUN_DIR_ENV];
  process.env[RUN_REFUSED_ENV] = code;
  warn(`per-run temp dir refused (${code}) under ${where}; fixtures go loose in TMPDIR as before`);
  return () => { delete process.env[RUN_REFUSED_ENV]; };
}

/** vitest's `globalSetup`, run in its MAIN process before any worker is forked — so the workers inherit the
 *  TMPDIR set here, and everything they and their children make lands in this run's `tmp/`. Reaps the base,
 *  opens the run, arms; the returned teardown disarms, restores TMPDIR, removes the run, and reaps again, so a
 *  dead run that was too fresh at setup is collected by this run on its way out. */
export default async function setup() {
  let base;
  try { base = realpathSync(os.tmpdir()); } catch (e) { return refuse(`tmpdir-${e.code ?? 'realpath'}`, os.tmpdir()); }
  const quietS = parseQuiet(process.env[RUN_QUIET_ENV]);
  await reapAndReport(base, quietS);
  const opened = await openRun(base);
  if ('refused' in opened) return refuse(opened.refused, base);
  const previous = process.env.TMPDIR;
  delete process.env[RUN_REFUSED_ENV];
  process.env[RUN_DIR_ENV] = opened.run;
  process.env.TMPDIR = path.join(opened.run, RUN_TMP);
  const disarm = armSignals(opened.run);
  return async () => {
    disarm();
    if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
    delete process.env[RUN_DIR_ENV];
    const r = condemn(opened.run);
    if (r.startsWith('left:')) warn(`could not remove ${opened.run} (${r}); the next run under ${base} retries`);
    opened.server.close();
    await reapAndReport(base, quietS);
  };
}
