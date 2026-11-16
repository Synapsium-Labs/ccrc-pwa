// D-7406, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4). L3: the test service's one way to run
// a process, a thin wrapper over the bounded spawner, `shared/spawn.mjs#boundedSpawn` (D-7055): its own process group,
// no shell, a fixed argv, an environment built by the caller, the whole group killed at the bound. The service adds
// no spawner of its own (`server/test/single-definition/kernel-tail-spawn.test.ts` audits every one). Two bounds: the
// short one, `UPDATE_SPAWN_TIMEOUT_MS`, the bound the agent gives its own launcher calls (the settings printer, the
// system manager's `show` and `stop`, the reflink probe); and `CCRC_TESTBOX_UNIT_MAX`, the longest a unit may run
// (D-7501), for `systemctl start --wait` and the mirror's git.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { UPDATE_SPAWN_DRAIN_MS, UPDATE_SPAWN_TIMEOUT_MS } from '../../../shared/agent-protocol.js';
import { boundedSpawn } from '../../../shared/spawn.mjs';

export interface ExecResult {
  /** The exit status; a signal is 128 plus its number; a launcher that could not start is 1. */
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The bound ended it. */
  readonly killed: boolean;
}
export type Exec = (file: string, args: readonly string[]) => Promise<ExecResult>;

/** The bound the short calls get. */
export const SHORT_BOUND_MS = UPDATE_SPAWN_TIMEOUT_MS;

/** An exec with the child's WHOLE environment `env` and the bound `timeoutMs`. */
export function boundedExec(env: Readonly<Record<string, string>>, timeoutMs: number): Exec {
  return async (file, args) => {
    const r = await boundedSpawn({ spawn, signals: os.constants.signals }, file, [...args], { env: { ...env }, timeoutMs, drainMs: UPDATE_SPAWN_DRAIN_MS });
    return { status: r.code, stdout: r.stdout ?? '', stderr: r.stderr, killed: r.killed };
  };
}

/** The system directories every child of the service gets on `PATH`, besides the service's own. */
export const SERVICE_PATH = '/usr/local/bin:/usr/bin:/bin';
