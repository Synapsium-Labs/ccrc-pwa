// The server-role update spawner — L3, the twin of the agent's `makeUpdateSpawn` (`agent/src/server.ts`). It is a
// SEPARATE runner from `exec.ts`'s shared `Runner`/`realRunner`, which tmux and ccd use and which stay as they are:
// this one bounds the `--detach` parent, kills its whole process group at the bound, keeps its stdout, and reports
// its pid. The two roles answer the same shape (`UpdateSpawnResult`, L0) under the same rule, so the dispatcher
// reads one vocabulary whichever box the node is on.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { UPDATE_SPAWN_DRAIN_MS, UPDATE_SPAWN_TIMEOUT_MS, type UpdateSpawnResult } from '../../../shared/agent-protocol.js';

/** Enough for any sentence a `--detach` parent prints; past it the capture stops and stdout reads as incomplete. */
const UPDATE_SPAWN_MAX_BUFFER = 1024 * 1024;

export interface BoundedSpawnOpts {
  /** The parent's whole environment. Default `process.env`. Injected by a test that hands the child a fixture HOME. */
  env?: NodeJS.ProcessEnv;
  /** The bound. Default `UPDATE_SPAWN_TIMEOUT_MS`; a test injects a small one. */
  timeoutMs?: number;
}

/**
 * Run `file args` as its own PROCESS GROUP (`detached`, pgid = pid; no shell) under a bound. At the bound the WHOLE
 * group gets SIGKILL (ESRCH tolerated), so nothing the parent already forked outlives the answer. The answer comes
 * once the parent has EXITED and then either both pipes reached EOF or `UPDATE_SPAWN_DRAIN_MS` passed: a grandchild
 * that left the group (setsid) and still holds a pipe never stops the answer, it costs `stdout: null`. The drain is ONE
 * deadline, armed by the kill or by the parent's exit, whichever comes first, so the whole answer is within
 * `timeoutMs + UPDATE_SPAWN_DRAIN_MS` of the spawn. A parent that a signal ended answers `128 + signo`. A launcher
 * that cannot start answers code 1 with `could not start the launcher (<code>)` and `pid: null` (D-3393). Nothing
 * resolves twice.
 */
export function boundedUpdateSpawn(file: string, args: readonly string[], opts: BoundedSpawnOpts = {}): Promise<UpdateSpawnResult> {
  const env = opts.env ?? process.env;
  const timeoutMs = opts.timeoutMs ?? UPDATE_SPAWN_TIMEOUT_MS;
  return new Promise((resolve) => {
    // ── BEGIN bounded-spawn body — identical in `agent/src/server.ts` and `server/src/update/spawn.ts`; a test holds the two equal
    let settled = false;
    let exited: { code: number } | null = null;
    let killed = false;
    let killTimer: NodeJS.Timeout | null = null;
    let drainTimer: NodeJS.Timeout | null = null;
    const out = { chunks: [] as Buffer[], bytes: 0, capped: false, broken: false, eof: false };
    const err = { chunks: [] as Buffer[], bytes: 0, capped: false, broken: false, eof: false };
    const child = spawn(file, [...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    const finish = (r: UpdateSpawnResult): void => {
      if (settled) return;
      settled = true;
      if (killTimer !== null) clearTimeout(killTimer);
      if (drainTimer !== null) clearTimeout(drainTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(r);
    };
    const answer = (): void => {
      if (exited === null) return;
      finish({
        code: exited.code,
        stdout: out.eof && !out.capped && !out.broken ? Buffer.concat(out.chunks).toString('utf8') : null,
        stderr: Buffer.concat(err.chunks).toString('utf8'),
        killed,
        pid: child.pid ?? null,
      });
    };
    // ONE absolute drain deadline (I1): the first arm stands. The kill arms it at T; a parent that then exits at
    // T + D - e must not restart it, or the answer would come at T + 2D and the op's budget be TIMEOUT + 2 * DRAIN.
    const armDrain = (): void => {
      if (drainTimer !== null) return;
      drainTimer = setTimeout(() => { exited ??= { code: 1 }; answer(); }, UPDATE_SPAWN_DRAIN_MS);
    };
    const take = (buf: typeof out) => (chunk: Buffer): void => {
      if (buf.capped) return;
      if (buf.bytes + chunk.length > UPDATE_SPAWN_MAX_BUFFER) { buf.capped = true; return; }
      buf.chunks.push(chunk);
      buf.bytes += chunk.length;
    };
    // A pipe that errors (EPIPE, ECONNRESET) never reaches `end`, and an uncaught stream error kills the process:
    // the capture is marked incomplete (stdout reads null) and counts as finished, so the answer is not held for it.
    const broke = (buf: typeof out, other: typeof out) => (): void => {
      buf.broken = true;
      buf.eof = true;
      if (other.eof) answer();
    };
    child.stdout?.on('data', take(out));
    child.stderr?.on('data', take(err));
    child.stdout?.on('end', () => { out.eof = true; if (err.eof) answer(); });
    child.stderr?.on('end', () => { err.eof = true; if (out.eof) answer(); });
    child.stdout?.on('error', broke(out, err));
    child.stderr?.on('error', broke(err, out));
    // `on`, not `once` (M2): `child.kill()` in the kill's fallback can emit `error` a second time, and an `error`
    // event with no listener throws.
    child.on('error', (e: NodeJS.ErrnoException) => {
      // A spawn that never produced a pid (ENOENT, EACCES): the launcher never ran.
      if (child.pid !== undefined) return;
      finish({
        code: 1, stdout: '', killed: false, pid: null,
        stderr: `could not start the launcher (${typeof e.code === 'string' ? e.code : 'unknown'})`,
      });
    });
    child.once('exit', (code, signal) => {
      if (killTimer !== null) { clearTimeout(killTimer); killTimer = null; }
      // A parent that a signal ended (not ours: `killed` says ours) answers the shell's `128 + signo`, so the detail
      // says what happened; a code of its own is kept as it is (M4).
      const signo = signal === null ? undefined : os.constants.signals[signal];
      exited = { code: typeof code === 'number' ? code : signo !== undefined ? 128 + signo : 1 };
      if (out.eof && err.eof) { answer(); return; }
      armDrain();
    });
    killTimer = setTimeout(() => {
      killTimer = null;
      if (exited !== null || child.pid === undefined) return;
      killed = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {
        // ESRCH: the group is already gone. Anything else: fall back to the parent alone rather than to nothing.
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL');
      }
      // A parent that will not die (an uninterruptible wait) must not stop the answer past the drain bound.
      armDrain();
    }, timeoutMs);
    // ── END bounded-spawn body
  });
}
