import { spawn } from 'node:child_process';
import os from 'node:os';
import {
  TOKEN_SYNC_DRAIN_MS, TOKEN_SYNC_EXIT, TOKEN_SYNC_KILL_GRACE_MS, TOKEN_SYNC_SPAWN_TIMEOUT_MS, TOKEN_SYNC_STDERR_PREFIX,
  TOKEN_SYNC_SYNCED_RE, firstStderrLine, type TokenSyncOpError, type TokenTransport,
} from '../../shared/agent-protocol.js';

/**
 * The `token-sync` op's spawn port (box-token lifecycle spec 2026-10-07 §4.4). It is the second wire-triggered spawn
 * outside the exec whitelist, beside the `update` op's, and like that one it is NOT `runExec`: `ccrc` is on neither
 * exec list, and the argv is one frozen template with no variable token (`tokenSyncSpawnArgv`).
 *
 * D-4390: this is its OWN bounded body, not a third copy of the update op's pinned twin
 * (`agent/src/server.ts`'s `makeUpdateSpawn`, `server/src/update/spawn.ts`) and not that body with stdin as a
 * parameter. Three things differ, each on purpose:
 *  - stdin is a PIPE carrying the claim code and one newline, then EOF. The code never reaches argv, where any
 *    process on the box could read it from `/proc/<pid>/cmdline`.
 *  - the environment is the explicit `{HOME, PATH, LANG}` the factory is given, never `process.env`, which carries
 *    `CCRC_AGENT_TOKEN` into the environ of the verb and of its `curl`.
 *  - the bound sends SIGTERM to the child's process group first and SIGKILL `TOKEN_SYNC_KILL_GRACE_MS` later, so the
 *    verb's trap can remove its temps; SIGKILL runs no trap.
 * `server/test/update-spawn-twin-bodies.test.ts` holds that this file carries no twin sentinel.
 *
 * Production is the port `startAgent` builds from `makeTokenSyncSpawn(tokenSyncEnv(home))`; tests inject a recorder
 * through `AgentOpts.spawnTokenSync`.
 */
export type TokenSyncSpawn = (file: string, args: readonly string[], code: string, timeoutMs: number) => Promise<TokenSyncSpawnResult>;

/** What the bounded token-sync spawner answers. `stdout` is the child's whole stdout read to EOF, or `null` when EOF
 *  was not reached within the drain or the capture cap was hit: `null` is "not measured", never "empty". `killed` is
 *  true when the bound fired (SIGTERM to the group, then SIGKILL if it was still running after the grace). */
export interface TokenSyncSpawnResult { code: number; stdout: string | null; stderr: string; killed: boolean; pid: number | null }

/** The child's whole environment. Nothing else from the agent's own environment reaches it. */
export interface TokenSyncEnv { HOME: string; PATH: string; LANG: string }

/** The explicit environment, from the agent's configured home and two names of its own environment. A PATH the
 *  agent lacks is the system directories (the verb needs `curl` and `python3`; the launcher itself is absolute). */
export function tokenSyncEnv(home: string, from: NodeJS.ProcessEnv = process.env): TokenSyncEnv {
  return { HOME: home, PATH: from.PATH ?? '/usr/bin:/bin', LANG: from.LANG ?? 'C' };
}

/** The verb prints one short line on each stream; past this the capture stops and stdout reads as not measured. */
const TOKEN_SYNC_MAX_BUFFER = 64 * 1024;

/**
 * The verb under a bound. The child is its own PROCESS GROUP (`detached`, pgid = pid), so the bound reaches the
 * `curl` it may be running too. Answers, kept apart:
 *  - `killed` — the child was still running at `timeoutMs`: the group got SIGTERM, and SIGKILL
 *    `TOKEN_SYNC_KILL_GRACE_MS` later unless the child had exited by then.
 *  - A spawn error (`ENOENT`/`EACCES`): code 1, `pid: null`, and the sentence `could not start the launcher (<code>)`,
 *    the update port's own words (D-3393), which `isTokenVerbMissing` reads as the `verb-missing` hold (D-4395).
 *  - Every other exit — the child's code (`128 + signo` for a signal that was not ours), stderr and stdout.
 * The answer comes once the child has exited and both pipes reached EOF, or at ONE drain deadline armed by the exit
 * or by the SIGKILL, whichever comes first, never restarted. So the whole answer arrives within
 * `timeoutMs + TOKEN_SYNC_KILL_GRACE_MS + TOKEN_SYNC_DRAIN_MS` of the spawn. Nothing resolves twice.
 */
export function makeTokenSyncSpawn(env: TokenSyncEnv): TokenSyncSpawn {
  // Copied name by name, so a caller's object with more fields still hands the child exactly three.
  const childEnv: NodeJS.ProcessEnv = { HOME: env.HOME, PATH: env.PATH, LANG: env.LANG };
  return (file, args, code, timeoutMs) => new Promise((resolve) => {
    let settled = false;
    let exited: { code: number } | null = null;
    let killed = false;
    let termTimer: NodeJS.Timeout | null = null;
    let killTimer: NodeJS.Timeout | null = null;
    let drainTimer: NodeJS.Timeout | null = null;
    const out = { chunks: [] as Buffer[], bytes: 0, capped: false, broken: false, eof: false };
    const err = { chunks: [] as Buffer[], bytes: 0, capped: false, broken: false, eof: false };
    const child = spawn(file, [...args], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });
    const clear = (): void => {
      for (const t of [termTimer, killTimer, drainTimer]) if (t !== null) clearTimeout(t);
      termTimer = killTimer = drainTimer = null;
    };
    const finish = (r: TokenSyncSpawnResult): void => {
      if (settled) return;
      settled = true;
      clear();
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(r);
    };
    const answer = (): void => {
      if (exited === null) return;
      finish({
        code: exited.code,
        stdout: out.eof && !out.capped && !out.broken ? Buffer.concat(out.chunks).toString('utf8') : null,
        stderr: Buffer.concat(err.chunks).toString('utf8'),
        killed,
        pid: child.pid ?? null,
      });
    };
    const armDrain = (): void => {
      if (drainTimer !== null) return;
      drainTimer = setTimeout(() => { exited ??= { code: 1 }; answer(); }, TOKEN_SYNC_DRAIN_MS);
    };
    const signalGroup = (signal: 'SIGTERM' | 'SIGKILL'): void => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, signal); } catch (e) {
        // ESRCH: the group is already gone. Anything else: fall back to the child alone rather than to nothing.
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal);
      }
    };
    const take = (buf: typeof out) => (chunk: Buffer): void => {
      if (buf.capped) return;
      if (buf.bytes + chunk.length > TOKEN_SYNC_MAX_BUFFER) { buf.capped = true; return; }
      buf.chunks.push(chunk);
      buf.bytes += chunk.length;
    };
    const broke = (buf: typeof out, other: typeof out) => (): void => {
      buf.broken = true;
      buf.eof = true;
      if (other.eof) answer();
    };
    // A child that exits before reading its stdin makes the write fail with EPIPE; an unhandled stream error would
    // kill the agent, and the exit is what answers.
    child.stdin?.on('error', () => {});
    child.stdin?.end(`${code}\n`);
    child.stdout?.on('data', take(out));
    child.stderr?.on('data', take(err));
    child.stdout?.on('end', () => { out.eof = true; if (err.eof) answer(); });
    child.stderr?.on('end', () => { err.eof = true; if (out.eof) answer(); });
    child.stdout?.on('error', broke(out, err));
    child.stderr?.on('error', broke(err, out));
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (child.pid !== undefined) return;
      finish({
        code: 1, stdout: '', killed: false, pid: null,
        stderr: `could not start the launcher (${typeof e.code === 'string' ? e.code : 'unknown'})`,
      });
    });
    child.once('exit', (exitCode, signal) => {
      if (termTimer !== null) { clearTimeout(termTimer); termTimer = null; }
      if (killTimer !== null) { clearTimeout(killTimer); killTimer = null; }
      const signo = signal === null ? undefined : os.constants.signals[signal];
      exited = { code: typeof exitCode === 'number' ? exitCode : signo !== undefined ? 128 + signo : 1 };
      if (out.eof && err.eof) { answer(); return; }
      armDrain();
    });
    termTimer = setTimeout(() => {
      termTimer = null;
      if (exited !== null || child.pid === undefined) return;
      killed = true;
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => {
        killTimer = null;
        if (exited !== null) return;
        signalGroup('SIGKILL');
        // A child that will not die (an uninterruptible wait) must not stop the answer past the drain bound.
        armDrain();
      }, TOKEN_SYNC_KILL_GRACE_MS);
    }, timeoutMs);
  });
}

/** The op's answer, mapped from the child (spec §4.4). No branch carries the code or a value: the verb prints neither,
 *  and the detail is the first stderr line cleaned to printable ASCII and cut to 200 (`firstStderrLine`). */
export type TokenSyncAnswer =
  | { ok: true; synced: string; transport: TokenTransport }
  | { ok: false; err: TokenSyncOpError; detail: string };

/** The ONE mapping. Killed at the bound -> `spawn-failed`, naming the bound. Exit 0 with exactly the synced line ->
 *  success. An exit code equal to `TOKEN_SYNC_EXIT[w]` AND a first stderr line starting `ccrc: token sync: <w>:` ->
 *  `w`; both must agree, so a crash that happens to exit 21 is not read as the server's refusal. Anything else ->
 *  `spawn-failed` with the first stderr line (an older `ccrc`'s `unknown argument: token` included, which the server
 *  reads as the `verb-missing` hold, D-4395). */
export function tokenSyncAnswer(r: TokenSyncSpawnResult): TokenSyncAnswer {
  if (r.killed) return { ok: false, err: 'spawn-failed', detail: `stopped at the ${TOKEN_SYNC_SPAWN_TIMEOUT_MS} ms bound` };
  if (r.code === 0 && r.stdout !== null) {
    const line = r.stdout.endsWith('\n') ? r.stdout.slice(0, -1) : r.stdout;
    const m = TOKEN_SYNC_SYNCED_RE.exec(line);
    if (m !== null) return { ok: true, synced: m[1]!, transport: m[2] as TokenTransport };
  }
  const first = firstStderrLine(r.stderr);
  for (const [word, exit] of Object.entries(TOKEN_SYNC_EXIT) as [keyof typeof TOKEN_SYNC_EXIT, number][]) {
    if (r.code === exit && first.startsWith(`${TOKEN_SYNC_STDERR_PREFIX}${word}:`)) return { ok: false, err: word, detail: first };
  }
  return { ok: false, err: 'spawn-failed', detail: first };
}
