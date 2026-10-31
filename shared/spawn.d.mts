import type { AccountOpOutcome, UpdateSpawnResult } from './agent-protocol.js';

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

/** The child `StdinSpawnHost.spawn` hands back: `SpawnedChild`'s pipes plus a stdin, written structurally, bytes as
 *  `Uint8Array` (a `Buffer` is one), so this file names no `node:` type (D-7057). */
export interface SpawnedStdinChild {
  readonly pid?: number | undefined;
  readonly stdin: { on(event: 'error', listener: (...args: any[]) => void): unknown; end(chunk: Uint8Array): unknown } | null;
  readonly stdout: { on(event: 'data', listener: (b: Uint8Array) => void): unknown } | null;
  readonly stderr: { on(event: 'data', listener: (b: Uint8Array) => void): unknown } | null;
  on(event: 'error', listener: (e: unknown) => void): unknown;
  on(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal: 'SIGTERM' | 'SIGKILL'): unknown;
}

/** What each account-op wrapper injects: the same `spawn` and signal table as `SpawnHost`, spawning three pipes. */
export interface StdinSpawnHost {
  spawn(
    file: string,
    args: string[],
    options: { detached: true; stdio: ['pipe', 'pipe', 'pipe']; env: Readonly<Record<string, string | undefined>> },
  ): SpawnedStdinChild;
  /** As `SpawnHost.signals`: read as `signals[signal]`. */
  readonly signals: object;
}

/** Every option is required, each passed by the wrapper from its one definition (D-7057): the kernel defines none. */
export interface BoundedStdinSpawnOptions {
  /** The child's WHOLE environment, as the wrapper built it (`{HOME, PATH, LANG}`, D-5513). */
  env: Readonly<Record<string, string | undefined>>;
  /** The sub's bound (`ACCOUNT_SUB_TIMEOUT_MS[sub]`): at it the group gets SIGTERM. */
  timeoutMs: number;
  /** SIGTERM to SIGKILL (`ACCOUNT_OP_KILL_GRACE_MS`). */
  killGraceMs: number;
  /** The stdout cap (`ACCOUNT_OP_OUTPUT_MAX_BYTES`); one byte more answers `too-large`. */
  maxOutputBytes: number;
  /** The drain deadline after the SIGKILL (`ACCOUNT_OP_DRAIN_MS`). */
  drainMs: number;
}

/** Every account-op outcome but `refused`, which the builder answers before any spawn. */
export type BoundedStdinSpawnOutcome = Exclude<AccountOpOutcome, { kind: 'refused' }>;

/**
 * Run `file argv` as its own process group with `stdin` written exactly then EOF, TERM then KILL to the group at the
 * bound, stdout capped. See `shared/spawn.mjs` for the rule.
 */
export function boundedStdinSpawn(
  host: StdinSpawnHost, file: string, argv: readonly string[], stdin: Uint8Array | null, opts: BoundedStdinSpawnOptions,
): Promise<BoundedStdinSpawnOutcome>;
