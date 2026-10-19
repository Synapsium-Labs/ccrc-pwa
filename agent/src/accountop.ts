import { spawn } from 'node:child_process';
import { closeSync, constants as fsConstants, fstatSync, openSync, readSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import {
  ACCOUNT_OP_KILL_GRACE_MS, ACCOUNT_OP_OUTPUT_MAX_BYTES, ACCOUNT_SUB_TIMEOUT_MS, type AccountSub,
} from '../../shared/api.js';
import {
  ACCOUNT_OP_DRAIN_MS, CCRC_DIR_NAME, NODE_FILES, NODE_ID_RE, type AccountOpOutcome,
} from '../../shared/agent-protocol.js';
import { isAccountStdin } from '../../shared/account-argv.js';
import type { TokenSyncEnv } from './tokensync.js';

// The builder is `shared/account-argv.ts`'s, the ONE both `AccountOps` arms call (D-5620 (4), D-5622); re-exported
// so this op's callers and tests read it from the op's own module.
export {
  ACCOUNT_STDIN_MAX_BYTES, ACCOUNT_SUB_ARGV, buildAccountArgv, isAccountStdin,
} from '../../shared/account-argv.js';

/**
 * The `account` op's spawn port (accounts spec §13.2, D-5513; plan Task A8). The THIRD wire-triggered spawn outside
 * the exec whitelist, beside the `update` op's and `token-sync`'s, modelled on `./tokensync.ts`'s typed port and,
 * like it, its own bounded body (D-4390's reason: each differs on purpose):
 *  - argv is built from typed fields by `buildAccountArgv`, with spec §13.2's bounds and no free argv; the launcher
 *    is the absolute `updateLauncherPath(home)` (the unit's PATH lacks `~/.local/bin`).
 *  - stdin is a PIPE carrying the decoded `stdinB64` exactly (no newline added), then EOF: a secret or a code never
 *    reaches argv, where any process on the box could read it from `/proc/<pid>/cmdline`.
 *  - the environment is the explicit `{HOME, PATH, LANG}` the factory is given, never `process.env`, which carries
 *    `CCRC_AGENT_TOKEN` into the environ of the verb and of every `claude`, `codex`, `curl` and `jq` it runs.
 *  - stdout is kept up to `maxOutputBytes` (8 MiB); one byte more kills the group and answers `too-large`. stderr is
 *    drained and dropped: no child program's output reaches the browser, and nothing here logs it.
 *  - each sub's bound sends SIGTERM to the child's process group, so the verb's trap removes its temps, then SIGKILL
 *    `killGraceMs` (5 s) later. The KILL is never cancelled once the TERM went: a group member that ignores TERM
 *    and closed its stdio is still running (D-5621's lesson, A7's local arm).
 * Production is the port `startAgent` builds from `makeAccountOpSpawn(tokenSyncEnv(home))`; tests inject a recorder
 * through `AgentOpts.spawnAccount`.
 */
export interface AccountSpawnBounds { timeoutMs: number; killGraceMs: number; maxOutputBytes: number }

/** Every outcome but `refused`, which the builder answers before any spawn. */
export type AccountSpawnOutcome = Exclude<AccountOpOutcome, { kind: 'refused' }>;

export type AccountOpSpawn = (
  file: string, argv: readonly string[], stdin: Buffer | null, bounds: AccountSpawnBounds,
) => Promise<AccountSpawnOutcome>;

/** One sub's bounds, from the ONE table both arms read (`shared/api.ts`). */
export function accountSpawnBounds(sub: AccountSub): AccountSpawnBounds {
  return { timeoutMs: ACCOUNT_SUB_TIMEOUT_MS[sub], killGraceMs: ACCOUNT_OP_KILL_GRACE_MS, maxOutputBytes: ACCOUNT_OP_OUTPUT_MAX_BYTES };
}

/** The bounded verb. Answers once: when the child has closed, or at ONE drain deadline after the SIGKILL. */
export function makeAccountOpSpawn(env: TokenSyncEnv): AccountOpSpawn {
  // Copied name by name, so a caller's object with more fields still hands the child exactly three.
  const childEnv: NodeJS.ProcessEnv = { HOME: env.HOME, PATH: env.PATH, LANG: env.LANG };
  return (file, argv, stdin, bounds) => new Promise<AccountSpawnOutcome>((resolve) => {
    let settled = false;
    let stopped: AccountSpawnOutcome | null = null;
    const chunks: Buffer[] = [];
    let bytes = 0;
    let child: ReturnType<typeof spawn>;
    const settle = (r: AccountSpawnOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(bound);
      resolve(r);
    };
    const signalGroup = (s: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, s); } catch (e) {
        // ESRCH: the group is already gone. Anything else: the child alone rather than nothing.
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') { try { child.kill(s); } catch { /* gone */ } }
      }
    };
    /** SIGTERM to the whole group, SIGKILL after the grace, then one drain deadline: the answer is `why`. */
    const stop = (why: AccountSpawnOutcome): void => {
      if (stopped !== null) return;
      stopped = why;
      signalGroup('SIGTERM');
      setTimeout(() => {
        signalGroup('SIGKILL');
        setTimeout(() => settle(why), ACCOUNT_OP_DRAIN_MS).unref();
      }, bounds.killGraceMs).unref();
    };
    try {
      child = spawn(file, [...argv], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });
    } catch {
      resolve({ kind: 'not-started' });
      return;
    }
    const bound = setTimeout(() => stop({ kind: 'timeout' }), bounds.timeoutMs);
    child.on('error', () => settle({ kind: 'not-started' }));
    child.stdout!.on('data', (b: Buffer) => {
      if (stopped !== null) return;
      bytes += b.length;
      if (bytes > bounds.maxOutputBytes) { chunks.length = 0; stop({ kind: 'too-large' }); return; }
      chunks.push(b);
    });
    // Drained so a chatty verb cannot block on a full pipe; never kept, never logged.
    child.stderr!.on('data', () => {});
    // A child that exits before reading its stdin makes the write fail with EPIPE; the exit is what answers.
    child.stdin!.on('error', () => {});
    child.on('close', (code, signal) => {
      if (stopped !== null) { settle(stopped); return; }
      // A signal that was not ours reads as the shell's `128 + signo`, as the token-sync port does.
      const exit = code ?? (signal === null ? 1 : 128 + (osConstants.signals[signal] ?? 0));
      settle({ kind: 'exited', code: exit, stdout: Buffer.concat(chunks).toString('utf8') });
    });
    child.stdin!.end(stdin ?? Buffer.alloc(0));
  });
}

/** `stdinB64` as bytes: absent is `null` (no stdin); present, it must be CANONICAL base64 of bytes that pass
 *  `isAccountStdin`, or it is refused (`key-charset`). Never logs, never echoes. */
export function decodeAccountStdin(b64: unknown): { ok: true; bytes: Buffer | null } | { ok: false } {
  if (b64 === undefined) return { ok: true, bytes: null };
  if (typeof b64 !== 'string' || b64.length === 0) return { ok: false };
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.toString('base64') !== b64) return { ok: false };
  return isAccountStdin(bytes) ? { ok: true, bytes } : { ok: false };
}

/** The most `~/.ccrc/node-id` may be: one uuid and a newline, with room to spare. */
const NODE_ID_MAX_BYTES = 128;

/** This node's `fleetIdentity`: `~/.ccrc/node-id`'s first line through `NODE_ID_RE`, or `null` when the file is
 *  absent, unreadable, not a regular file, too large or malformed. Bounded, `O_NONBLOCK` and `O_NOFOLLOW`, as the
 *  agent's other node-file reads are; read per answer, so an answer names the node that built it. */
export function readFleetIdentity(home: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path.join(home, CCRC_DIR_NAME, NODE_FILES.nodeId),
      fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > NODE_ID_MAX_BYTES) return null;
    const buf = Buffer.alloc(NODE_ID_MAX_BYTES + 1);
    const n = readSync(fd, buf, 0, buf.length, 0);
    if (n > NODE_ID_MAX_BYTES) return null;
    const line = buf.subarray(0, n).toString('utf8').split('\n')[0]!;
    return NODE_ID_RE.test(line) ? line : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* closed */ } }
  }
}
