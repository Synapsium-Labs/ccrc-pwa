// The server-role update spawner — L3, a thin wrapper over `shared/spawn.mjs#boundedSpawn` (D-7055; ARCH-73), the
// bounded update spawner's one body, which the agent's `makeUpdateSpawn` (`agent/src/server.ts`) wraps too: it injects
// `spawn` and the signal table (the kernel imports nothing) and passes `UPDATE_SPAWN_DRAIN_MS` from
// `shared/agent-protocol.ts`, its one definition.
//
// It is a SEPARATE runner from `exec.ts`'s shared `Runner`/`realRunner`, which tmux and ccd use and which stay as they
// are: this one bounds the `--detach` parent, kills its whole process group at the bound, keeps its stdout, and reports
// its pid. The two roles answer the same shape (`UpdateSpawnResult`, L0) under the same rule, so the dispatcher
// reads one vocabulary whichever box the node is on.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { UPDATE_SPAWN_DRAIN_MS, UPDATE_SPAWN_TIMEOUT_MS, type UpdateSpawnResult } from '../../../shared/agent-protocol.js';
import { boundedSpawn } from '../../../shared/spawn.mjs';

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
  return boundedSpawn({ spawn, signals: os.constants.signals }, file, args, { env, timeoutMs, drainMs: UPDATE_SPAWN_DRAIN_MS });
}
