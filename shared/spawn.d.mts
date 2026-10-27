import type { UpdateSpawnResult } from './agent-protocol.js';

/**
 * The child `SpawnHost.spawn` hands back: the part of `node:child_process`'s `ChildProcess` the body reads, written
 * structurally so this file names no `node:` module (D-7055: the kernel imports nothing, and its types import only
 * `agent-protocol.js`).
 */
export interface SpawnedPipe {
  on(event: string, listener: (...args: any[]) => void): unknown;
  destroy(): unknown;
}
export interface SpawnedChild {
  readonly pid?: number | undefined;
  readonly stdout: SpawnedPipe | null;
  readonly stderr: SpawnedPipe | null;
  on(event: 'error', listener: (e: { code?: unknown }) => void): unknown;
  once(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal: 'SIGKILL'): unknown;
}

/**
 * What each package's L3 wrapper injects: `node:child_process`'s `spawn` and `node:os`'s `constants.signals`, which
 * the `.mjs` carve-out does not let `shared/spawn.mjs` import itself.
 */
export interface SpawnHost {
  spawn(
    file: string,
    args: string[],
    options: { detached: true; stdio: ['ignore', 'pipe', 'pipe']; env: Readonly<Record<string, string | undefined>> },
  ): SpawnedChild;
  /** A table from a signal's name to its number, read as `signals[signal]` (`os.constants.signals`; `object`, because
   *  that table is an interface with no index signature and this file names no `node:` type). */
  readonly signals: object;
}

/** Every option is required: the kernel defines no default and no copy of a wire constant. */
export interface BoundedSpawnOptions {
  /** The parent's whole environment. */
  env: Readonly<Record<string, string | undefined>>;
  /** The bound: at it the whole group gets SIGKILL. */
  timeoutMs: number;
  /** The drain deadline after the parent's exit or the kill (`UPDATE_SPAWN_DRAIN_MS`, passed by each wrapper). */
  drainMs: number;
}

/**
 * Run `file args` as its own process group under `opts.timeoutMs`, the whole group SIGKILLed at the bound, the answer
 * within `timeoutMs + drainMs` of the spawn. See `shared/spawn.mjs` for the rule.
 */
export function boundedSpawn(host: SpawnHost, file: string, args: readonly string[], opts: BoundedSpawnOptions): Promise<UpdateSpawnResult>;
