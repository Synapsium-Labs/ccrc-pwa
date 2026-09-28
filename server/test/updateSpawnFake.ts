// A test double for `LocalUpdateSpawn`: a recording `Runner` behind the capability's own argv builder, so a case
// asserts the argv the capability builds without starting a process. Cases that need the REAL spawner import
// `localUpdateSpawnFor` and hand it a fixture HOME and a small bound instead.
import type { ExecResult, Runner } from '../src/exec.js';
import { updateLauncherPath, updateSpawnArgv, type UpdateSpawnResult } from '../../shared/agent-protocol.js';
import type { LocalUpdateSpawn } from '../src/update/converge.js';

const shaped = (r: ExecResult): UpdateSpawnResult => ({
  code: r.code, stdout: r.stdout, stderr: r.stderr, killed: r.killed === true, pid: null,
});

/** `boundMs` models the REAL runner's own bound: a run still parked at it resolves `killed: true`, as the bounded
 *  runner does after killing the group. Without it the run's own promise is the answer. A non-tag or non-kind throws
 *  synchronously, as `localUpdateSpawnFor` does. */
export function spawnFromRunner(run: Runner, home: string, boundMs?: number): LocalUpdateSpawn {
  return (kind, tag) => {
    const argv = [...updateSpawnArgv(kind, tag)];
    const ran = run(updateLauncherPath(home), argv).then(shaped);
    if (boundMs === undefined) return ran;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ code: 1, stdout: null, stderr: '', killed: true, pid: null }), boundMs);
      ran.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
    });
  };
}
