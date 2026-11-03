// The bounded spawners — each ONE body. `boundedSpawn` is the update spawner (D-7055; ARCH-73 (#808), its spawn half;
// spec K17 "Process spawn"); `boundedStdinSpawn` below is the account-op spawner (D-7057, OA-C8a (a) / D-7060). The
// server role's `boundedUpdateSpawn` (`server/src/update/spawn.ts`) and the agent's `makeUpdateSpawn`
// (`agent/src/server.ts`) are thin wrappers over it, so the two roles answer the same shape (`UpdateSpawnResult`,
// `shared/agent-protocol.ts`) under one rule, and a fix lands once.
//
// It imports NOTHING. The `.mjs` carve-out (`server/test/rings/mjs-node.data.ts#MJS_CARVE_OUT`) allows no
// `node:child_process` or `node:os`, so `spawn` and the signal table reach it as an injected HOST from each package's
// own wrapper; and no `shared/*.mjs` imports a `.ts` sibling, so the wire constants it reads (the drain deadline, the
// bound) reach it as OPTIONS each wrapper passes from `shared/agent-protocol.ts`, their one definition. This file
// defines neither. `process.kill`, `setTimeout`, `clearTimeout` and `Buffer` are globals, as in `shared/mark.mjs`.
// Types live alongside in the hand-written `shared/spawn.d.mts`.

/** Enough for any sentence a `--detach` parent prints; past it the capture stops and stdout reads as incomplete. A
 *  local capture cap, not a wire constant, so it is defined here, once. */
const UPDATE_SPAWN_MAX_BUFFER = 1024 * 1024;

/**
 * Run `file args` as its own PROCESS GROUP (`detached`, pgid = pid; no shell) under a bound. At the bound the WHOLE
 * group gets SIGKILL (ESRCH tolerated), so nothing the parent already forked outlives the answer. The answer comes
 * once the parent has EXITED and then either both pipes reached EOF or `drainMs` passed: a grandchild that left the
 * group (setsid) and still holds a pipe never stops the answer, it costs `stdout: null`. The drain is ONE deadline,
 * armed by the kill or by the parent's exit, whichever comes first, so the whole answer is within
 * `timeoutMs + drainMs` of the spawn. A parent that a signal ended answers `128 + signo`. A launcher that cannot start
 * answers code 1 with `could not start the launcher (<code>)` and `pid: null` (D-3393). Nothing resolves twice.
 *
 * `host` is `{ spawn, signals }`: `node:child_process`'s `spawn` and `node:os`'s `constants.signals`. Every option is
 * required: `env` the parent's whole environment, `timeoutMs` the bound, `drainMs` the drain deadline.
 */
export function boundedSpawn(host, file, args, opts) {
  const { spawn, signals } = host;
  const { env, timeoutMs, drainMs } = opts;
  return new Promise((resolve) => {
    let settled = false;
    let exited = null;
    let killed = false;
    let killTimer = null;
    let drainTimer = null;
    const out = { chunks: [], bytes: 0, capped: false, broken: false, eof: false };
    const err = { chunks: [], bytes: 0, capped: false, broken: false, eof: false };
    const child = spawn(file, [...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (killTimer !== null) clearTimeout(killTimer);
      if (drainTimer !== null) clearTimeout(drainTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(r);
    };
    const answer = () => {
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
    const armDrain = () => {
      if (drainTimer !== null) return;
      drainTimer = setTimeout(() => { exited ??= { code: 1 }; answer(); }, drainMs);
    };
    const take = (buf) => (chunk) => {
      if (buf.capped) return;
      if (buf.bytes + chunk.length > UPDATE_SPAWN_MAX_BUFFER) { buf.capped = true; return; }
      buf.chunks.push(chunk);
      buf.bytes += chunk.length;
    };
    // A pipe that errors (EPIPE, ECONNRESET) never reaches `end`, and an uncaught stream error kills the process:
    // the capture is marked incomplete (stdout reads null) and counts as finished, so the answer is not held for it.
    const broke = (buf, other) => () => {
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
    child.on('error', (e) => {
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
      const signo = signal === null ? undefined : signals[signal];
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
        if (e.code !== 'ESRCH') child.kill('SIGKILL');
      }
      // A parent that will not die (an uninterruptible wait) must not stop the answer past the drain bound.
      armDrain();
    }, timeoutMs);
  });
}

/**
 * The account-op spawner — ONE body (D-7057; OA-C8a (a), D-7060). The server's local arm
 * (`server/src/accounts/ops.ts#localAccountOps`) and the agent's port (`agent/src/accountop.ts#makeAccountOpSpawn`)
 * are thin wrappers over it. Its own body, never `boundedSpawn`'s: stdin, the env, the TERM grace and the output cap
 * differ (D-4390's reason; `agent/src/tokensync.ts` keeps its own body by that same reason).
 *
 * Run `file argv` as its own PROCESS GROUP (`detached`, no shell) with `stdin` (a secret or a code, D-5513: never
 * argv) written exactly, no newline added, then EOF (`null` is an empty stdin). `env` is the child's WHOLE environment,
 * as the wrapper built it. stdout is kept up to `maxOutputBytes`; one byte more answers `too-large`. stderr is drained
 * and dropped. At `timeoutMs` the whole group gets SIGTERM, then SIGKILL `killGraceMs` later, then one `drainMs`
 * deadline: the KILL is never cancelled once the TERM went (a member that ignores TERM and closed its stdio is still
 * running, D-5621). A group kill that throws ESRCH is a group already gone; anything else falls back to the child
 * alone. A child a signal not ours ended answers `128 + signo`; a launcher that cannot start answers `not-started`.
 * Answers once.
 *
 * `host` is `{ spawn, signals }`, as `boundedSpawn`'s. Every option is required: the wrappers pass
 * `ACCOUNT_OP_DRAIN_MS` (`shared/agent-protocol.ts`), `ACCOUNT_OP_KILL_GRACE_MS` and `ACCOUNT_OP_OUTPUT_MAX_BYTES`
 * (`shared/api.ts`) and the sub's `ACCOUNT_SUB_TIMEOUT_MS` bound from their one definitions; this file defines none.
 */
export function boundedStdinSpawn(host, file, argv, stdin, opts) {
  const { spawn, signals } = host;
  const { env, timeoutMs, killGraceMs, maxOutputBytes, drainMs } = opts;
  return new Promise((resolve) => {
    let settled = false;
    let stopped = null;
    const chunks = [];
    let bytes = 0;
    let child;
    const settle = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(bound);
      resolve(r);
    };
    const signalGroup = (s) => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, s); } catch (e) {
        // ESRCH: the group is already gone. Anything else: the child alone rather than nothing.
        if (e.code !== 'ESRCH') { try { child.kill(s); } catch { /* gone */ } }
      }
    };
    /** SIGTERM to the whole group, SIGKILL after the grace, then one drain deadline: the answer is `why`. */
    const stop = (why) => {
      if (stopped !== null) return;
      stopped = why;
      signalGroup('SIGTERM');
      setTimeout(() => {
        signalGroup('SIGKILL');
        setTimeout(() => settle(why), drainMs).unref();
      }, killGraceMs).unref();
    };
    try {
      child = spawn(file, [...argv], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    } catch {
      resolve({ kind: 'not-started' });
      return;
    }
    const bound = setTimeout(() => stop({ kind: 'timeout' }), timeoutMs);
    child.on('error', () => settle({ kind: 'not-started' }));
    child.stdout.on('data', (b) => {
      if (stopped !== null) return;
      bytes += b.length;
      if (bytes > maxOutputBytes) { chunks.length = 0; stop({ kind: 'too-large' }); return; }
      chunks.push(b);
    });
    // Drained so a chatty verb cannot block on a full pipe; never kept, never logged.
    child.stderr.on('data', () => {});
    // A child that exits before reading its stdin makes the write fail with EPIPE; the exit is what answers.
    child.stdin.on('error', () => {});
    child.on('close', (code, signal) => {
      if (stopped !== null) { settle(stopped); return; }
      // A signal that was not ours reads as the shell's `128 + signo`, as the token-sync port does.
      const exit = code ?? (signal === null ? 1 : 128 + (signals[signal] ?? 0));
      settle({ kind: 'exited', code: exit, stdout: Buffer.concat(chunks).toString('utf8') });
    });
    child.stdin.end(stdin ?? Buffer.alloc(0));
  });
}
