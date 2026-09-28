// A test double for `LocalUpdateSpawn`: a recording `Runner` behind the capability's own argv builder, so a case
// asserts the argv the capability builds without starting a process. Cases that need the REAL spawner import
// `localUpdateSpawnFor` and hand it a fixture HOME and a small bound instead.
import type { ExecResult, Runner } from '../src/exec.js';
import { updateLauncherPath, updateSpawnArgv, type UpdateSpawnResult } from '../../shared/agent-protocol.js';
import type { LocalUpdateSpawn } from '../src/update/converge.js';

/** A plausible pid: the real runner answers a non-null pid for every process that started (`null` only when the spawn
 *  itself failed), so the double does too — a case that needs `pid: null` says so. */
export const FAKE_SPAWN_PID = 4242;

/** What a case may say about the double's answer. `pid` rides BOTH paths (default `FAKE_SPAWN_PID`); `stdout` is the
 *  KILLED path's only (default `''`: after a group kill with no escapee the real runner reaches EOF with nothing, or
 *  with what the parent printed first; `null` models an escapee that held the pipe). The code is 137, `128 + SIGKILL`,
 *  what the real runner reports for the parent the group kill ended. The non-killed path's stdout is
 *  the run's own. */
export interface SpawnFakeAnswer { stdout?: string | null; pid?: number | null }

const shaped = (r: ExecResult, pid: number | null): UpdateSpawnResult => ({
  code: r.code, stdout: r.stdout, stderr: r.stderr, killed: r.killed === true, pid,
});

/** `boundMs` models the REAL runner's own bound: a run still parked at it resolves `killed: true`, as the bounded
 *  runner does after killing the group, with `answer`'s (or the real runner's default) stdout and pid. Without it the
 *  run's own promise is the answer. A non-tag or non-kind throws synchronously, as `localUpdateSpawnFor` does. */
export function spawnFromRunner(run: Runner, home: string, boundMs?: number, answer: SpawnFakeAnswer = {}): LocalUpdateSpawn {
  const pid = answer.pid === undefined ? FAKE_SPAWN_PID : answer.pid;
  return (kind, tag) => {
    const argv = [...updateSpawnArgv(kind, tag)];
    const ran = run(updateLauncherPath(home), argv).then((r) => shaped(r, pid));
    if (boundMs === undefined) return ran;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ code: 137, stdout: answer.stdout === undefined ? '' : answer.stdout, stderr: '', killed: true, pid }), boundMs);
      ran.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
    });
  };
}
