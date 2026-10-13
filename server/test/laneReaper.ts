// laneReaper.ts — narrow process observation helper for lane fixtures.
//
// Fixture cleanup never signals a persisted numeric PID. Current-run cleanup
// owns direct ChildProcess handles and product-stop callbacks in
// codexLaneFixture.ts. A SIGKILLed Vitest may leave an orphan rather than give
// a later run authority over a reused PID.
import { spawnSync } from 'node:child_process';

/** `ps -ww -o args=` for `pid`, or '' when it is gone. `-ww` avoids truncating
 *  argv under a narrow terminal width. */
export function psArgs(pid: number): string {
  const result = spawnSync('ps', ['-ww', '-o', 'args=', '-p', String(pid)], {
    encoding: 'utf8', timeout: 5_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.error || result.signal) return '';
  return result.stdout ?? '';
}
