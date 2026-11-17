import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import {
  MODELS_KILL_GRACE_MS, MODELS_OP_DRAIN_MS, MODELS_OP_OUTPUT_MAX_BYTES, MODELS_SPAWN_TIMEOUT_MS, buildModelsArgv,
  updateLauncherPath, type ModelsOpOutcome,
} from '../../shared/agent-protocol.js';
import { boundedStdinSpawn } from '../../shared/spawn.mjs';
import { tokenSyncEnv, type TokenSyncEnv } from './tokensync.js';

/**
 * The `models` op's spawn port (auto-advance spec 2026-10-13 §2.7, D14; plan W4 Task 17 as re-planned, D-8687). The
 * SIXTH wire-triggered spawn outside the exec whitelist. It is `./testboxAdminOp.ts`'s shape through the shared
 * bounded body (`shared/spawn.mjs#boundedStdinSpawn`) with NO stdin, the stdin empty and then EOF (D-8692):
 *  - argv is `models <lane> show` or `models <lane> hold|release|revert <class>`, built ONLY by `buildModelsArgv`
 *    (`shared/agent-protocol.ts`), after the absolute launcher `updateLauncherPath(home)`;
 *  - the environment is the explicit `{HOME, PATH, LANG}` the factory is given, never `process.env`, and its PATH
 *    begins with the directory of the `node` running this process (D-5227), so the verb's own `node` is this one;
 *  - stdout is kept up to 256 KiB; one byte more kills the group and answers `too-large`. stderr is drained and dropped;
 *  - the bound is 40 s, then SIGTERM to the child's group and SIGKILL 5 s later, never cancelled once the TERM went.
 * The agent never parses the verb's stdout: the server reads it. Production is the port `startAgent` builds from
 * `makeModelsSpawn(modelsEnv(home))`; tests inject a recorder through `AgentOpts.spawnModels`. The server's local arm
 * (`server/src/io.ts`'s `localModels`) runs this module's `runModelsOp` on its own box.
 */
export interface ModelsSpawnBounds { timeoutMs: number; killGraceMs: number; maxOutputBytes: number }

/** The one call's bounds: the three constants of the protocol, frozen. */
export const MODELS_SPAWN_BOUNDS: Readonly<ModelsSpawnBounds> = Object.freeze({
  timeoutMs: MODELS_SPAWN_TIMEOUT_MS, killGraceMs: MODELS_KILL_GRACE_MS, maxOutputBytes: MODELS_OP_OUTPUT_MAX_BYTES,
});

/** Every outcome but `refused` (the builder answers it before any spawn) and `busy` (the agent's gate answers it). */
export type ModelsSpawnOutcome = Exclude<ModelsOpOutcome, { kind: 'refused' } | { kind: 'busy' }>;

export type ModelsOpSpawn = (file: string, argv: readonly string[], bounds: ModelsSpawnBounds) => Promise<ModelsSpawnOutcome>;

/** tokenSyncEnv's three names, PATH = `${nodeDir}:${base.PATH}` (D-5227). Still exactly HOME, PATH, LANG. */
export function modelsEnv(home: string, from: NodeJS.ProcessEnv = process.env, nodeDir: string = path.dirname(process.execPath)): TokenSyncEnv {
  const base = tokenSyncEnv(home, from);
  return { HOME: base.HOME, PATH: `${nodeDir}:${base.PATH}`, LANG: base.LANG };
}

/** The bounded verb. Answers once: when the child has closed, or at ONE drain deadline after the SIGKILL. */
export function makeModelsSpawn(env: TokenSyncEnv): ModelsOpSpawn {
  // Copied name by name, so a caller's object with more fields still hands the child exactly three.
  const childEnv: NodeJS.ProcessEnv = { HOME: env.HOME, PATH: env.PATH, LANG: env.LANG };
  return (file, argv, bounds) => boundedStdinSpawn({ spawn, signals: osConstants.signals }, file, argv, null, {
    env: childEnv, timeoutMs: bounds.timeoutMs, killGraceMs: bounds.killGraceMs, maxOutputBytes: bounds.maxOutputBytes,
    drainMs: MODELS_OP_DRAIN_MS,
  });
}

/** The one body both the agent's case and the server's local arm run: buildModelsArgv AGAIN (a refusal answers
 *  `refused`, nothing spawned), updateLauncherPath(home) (a throw answers `not-started`), then the port. Never rejects
 *  over the real port, which never rejects (`boundedStdinSpawn` answers `not-started` for a launcher that cannot start);
 *  a port that rejects is passed through, so the agent's gate is freed by its `finally` and the local arm's `catch`
 *  answers `not-started`. */
export async function runModelsOp(spawnModels: ModelsOpSpawn, home: string, lane: unknown, action: unknown, cls: unknown,
  bounds: ModelsSpawnBounds = MODELS_SPAWN_BOUNDS): Promise<Exclude<ModelsOpOutcome, { kind: 'busy' }>> {
  const built = buildModelsArgv(lane, action, cls);
  if (!built.ok) return { kind: 'refused', why: built.why };
  let file: string;
  try { file = updateLauncherPath(home); } catch { return { kind: 'not-started' }; }
  return spawnModels(file, built.argv, bounds);
}
