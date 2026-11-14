import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import {
  TESTBOX_ADMIN_DRAIN_MS, TESTBOX_ADMIN_KILL_GRACE_MS, TESTBOX_ADMIN_LONG_TIMEOUT_MS, TESTBOX_ADMIN_OUTPUT_MAX_BYTES,
  TESTBOX_ADMIN_SHORT_TIMEOUT_MS, type TestboxAdminOpOutcome,
} from '../../shared/agent-protocol.js';
import { buildTestboxAdminArgv, testboxAdminIsLong, type TestboxAdminSub } from '../../shared/testbox-admin.js';
import { boundedStdinSpawn } from '../../shared/spawn.mjs';
import type { TokenSyncEnv } from './tokensync.js';

// The builder is `shared/testbox-admin.ts`'s, the ONE both arms of the op call (the server's local arm, TC12, and
// this one); re-exported so this op's callers and tests read it from the op's own module.
export { buildTestboxAdminArgv, testboxAdminIsLong } from '../../shared/testbox-admin.js';

/**
 * The `testbox-admin` op's spawn port (test box connect spec §2.1, §2.11; plan TC11, D-8166). The FIFTH wire-triggered
 * spawn outside the exec whitelist, on `./accountop.ts`'s shape and the same bounded body
 * (`shared/spawn.mjs#boundedStdinSpawn`), with these differences on purpose:
 *  - NO stdin: the stdin is EMPTY, then EOF. The browser holds no secret (§2.3), so none crosses the wire.
 *  - argv is `testbox-admin <sub> [--name=value…]` from `buildTestboxAdminArgv`, then the template's own
 *    `--from agent`; no caller field can name `--from`. The launcher is the absolute `updateLauncherPath(home)`.
 *  - the environment is the explicit `{HOME, PATH, LANG}` the factory is given, never `process.env`.
 *  - stdout is kept up to 1 MiB; one byte more kills the group and answers `too-large`. stderr is drained and dropped.
 *  - a short sub is bound at 60 s; a long sub's bound (30 s) covers its DETACH only, the unit it starts outlives the
 *    call. The bound sends SIGTERM to the child's group, then SIGKILL 5 s later, never cancelled once the TERM went.
 * Production is the port `startAgent` builds from `makeTestboxAdminSpawn(tokenSyncEnv(home))`; tests inject a recorder
 * through `AgentOpts.spawnTestboxAdmin`.
 */
export interface TestboxAdminSpawnBounds { timeoutMs: number; killGraceMs: number; maxOutputBytes: number }

/** Every outcome but `refused`, which the builder answers before any spawn. */
export type TestboxAdminSpawnOutcome = Exclude<TestboxAdminOpOutcome, { kind: 'refused' }>;

export type TestboxAdminSpawn = (
  file: string, argv: readonly string[], bounds: TestboxAdminSpawnBounds,
) => Promise<TestboxAdminSpawnOutcome>;

/** One call's bounds: a short sub 60 s, a long sub's detach 30 s. `fields` are as built. */
export function testboxAdminSpawnBounds(sub: TestboxAdminSub, fields: unknown): TestboxAdminSpawnBounds {
  return {
    timeoutMs: testboxAdminIsLong(sub, fields) ? TESTBOX_ADMIN_LONG_TIMEOUT_MS : TESTBOX_ADMIN_SHORT_TIMEOUT_MS,
    killGraceMs: TESTBOX_ADMIN_KILL_GRACE_MS,
    maxOutputBytes: TESTBOX_ADMIN_OUTPUT_MAX_BYTES,
  };
}

/** The argv after the launcher: the builder's words, then the template's own `--from agent`. */
export function testboxAdminSpawnArgv(sub: unknown, fields: unknown):
  { ok: true; argv: string[] } | { ok: false; why: 'bad-sub' | 'bad-field' } {
  const built = buildTestboxAdminArgv(sub, fields);
  return built.ok ? { ok: true, argv: [...built.argv, '--from', 'agent'] } : built;
}

/** The bounded verb. Answers once: when the child has closed, or at ONE drain deadline after the SIGKILL. */
export function makeTestboxAdminSpawn(env: TokenSyncEnv): TestboxAdminSpawn {
  // Copied name by name, so a caller's object with more fields still hands the child exactly three.
  const childEnv: NodeJS.ProcessEnv = { HOME: env.HOME, PATH: env.PATH, LANG: env.LANG };
  return (file, argv, bounds) => boundedStdinSpawn({ spawn, signals: osConstants.signals }, file, argv, null, {
    env: childEnv, timeoutMs: bounds.timeoutMs, killGraceMs: bounds.killGraceMs, maxOutputBytes: bounds.maxOutputBytes,
    drainMs: TESTBOX_ADMIN_DRAIN_MS,
  });
}
