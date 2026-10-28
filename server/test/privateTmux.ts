// The private tmux server a real-tmux suite runs against: its reset, its socket file, and a watchdog for the one leak
// a killed run leaves (desktop polish Task C12, item 11). `ccd-tmux-anchor`, `session-hook` and
// `drawer-window-sized-client` each build their own `T` (the binary, `-L <sock>`, their own `-f` and environment), so
// these take that `T` or the parts of it they need, and the shared halves are written once. Not a test file.
//
// NOTHING here names a live server: every call is on the `-L <sock>` the suite made, a name that is the run's alone.
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** A suite's own tmux call on its private socket. */
export type TmuxCall = (...args: string[]) => SpawnSyncReturns<string>;

/** No server on the private socket, MEASURED rather than assumed: `kill-server` returns before the server has gone,
 *  and a test that killed a server's last session leaves it exiting on its own, so a `new-session` that lands in that
 *  window answers `server exited unexpectedly` (measured, ccd-tmux-anchor.test.ts). So poll until tmux itself says
 *  there is nothing to connect to. */
export function resetPrivateServer(T: TmuxCall, sock: string): void {
  T('kill-server');
  for (let i = 0; i < 200; i++) {
    const r = T('list-sessions');
    if (r.status !== 0 && /no server running|error connecting/.test(r.stderr)) return;
    spawnSync('sleep', ['0.05']);
  }
  throw new Error(`the private tmux server on ${sock} would not go away`);
}

/** Where tmux puts `-L <sock>`'s socket with `TMUX_TMPDIR` unset (every suite unsets it): `/tmp/tmux-<uid>/<sock>`.
 *  Null where there is no uid (not a POSIX box). */
export function privateSocketPath(sock: string): string | null {
  return typeof process.getuid === 'function' ? path.join('/tmp', `tmux-${process.getuid()}`, sock) : null;
}

/** tmux leaves the socket FILE behind after `kill-server` (measured, 3.4); the name is this run's alone. */
export function removePrivateSocket(sock: string): void {
  const p = privateSocketPath(sock);
  if (p !== null) fs.rmSync(p, { force: true });
}

/** A server started with `exit-empty off` outlives every session, so a worker killed between `beforeAll` and
 *  `afterAll` (a SIGKILL, an OOM, a cancelled run) leaves it running, and its socket sits outside the per-run temp
 *  parent the global setup sweeps (review 1113, A1). The watchdog is a detached shell that waits for `owner` (the
 *  vitest worker by default) to die and then kills the server on `sock` and removes its socket. It names only that
 *  socket. `afterAll` calls the returned stop, so an ordinary run leaves no watchdog behind either. */
export function watchPrivateServer(tmux: string, sock: string, conf: string, owner: number = process.pid): () => void {
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
  const socket = privateSocketPath(sock);
  const script = `while kill -0 ${owner} 2>/dev/null; do sleep 0.2; done; `
    + `${q(tmux)} -L ${q(sock)} -f ${q(conf)} kill-server 2>/dev/null; `
    + (socket === null ? 'true' : `rm -f ${q(socket)}`);
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.TMUX;
  delete env.TMUX_PANE;
  delete env.TMUX_TMPDIR;
  const child = spawn('sh', ['-c', script], { detached: true, stdio: 'ignore', env });
  child.unref();
  return () => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  };
}
