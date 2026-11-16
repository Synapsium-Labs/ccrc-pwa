// A fixture box for the cases that run the REAL `ccd/ccrc` as the `--detach` parent (D-3411): the real launcher at
// `<home>/.local/bin/ccrc` (its bytes are `_inst_shim`'s own heredoc, read out of the script), a symlink
// `<home>/ccrc/ccd` to the checkout's `ccd/` (the launcher `exec`s `$HOME/ccrc/ccd/ccrc`), and a terminal
// `update.json` so byte-identity means something.
//
// CONTAINMENT, structural — the env the caller hands the spawner is built FROM SCRATCH, never spread from
// `process.env`, and `plantRealBox` hands back the SPAWNER built over it (`RealBox.spawn`): `spawn.ts` falls back to
// `process.env` when no env is passed, so a test that planted the real launcher and built its own
// `localUpdateSpawnFor(home)` would run it under the live HOME. No real-box spawn is built without this env: HOME is the fixture and PATH is `<home>/bin:/usr/local/bin:/usr/bin:/bin`, never the operator's
// `~/.local/bin`. A poisoned, RECORDING `systemd-run` and `systemctl` sit first on that PATH: each appends its argv to
// `<home>/<name>-argv` and exits 97 (`systemd-run` may instead HANG after recording, and `curl` may instead SLEEP: see
// `RealBoxOpts`, D-3413's arms B and A), so a lock the harness failed to hold reaches `systemd-run` and the case that
// asserts the file's absence reds instead of starting a real transient unit. `curl` is a stub that answers 200 and
// records its argv to `<home>/curl-argv` (the `rollback` kind asks the release host before its lock probe), so
// nothing here reaches the network.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localUpdateSpawnFor, type LocalUpdateSpawn } from '../src/update/converge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CCD_DIR = path.resolve(here, '..', '..', 'ccd');
export const CCRC_SRC = path.join(CCD_DIR, 'ccrc');

/** A TERMINAL report: a refused op that leaves it byte-identical proves it wrote nothing. */
export const TERMINAL_REPORT = '{"target":"v0.0.5","phase":"done","startedAt":1790000000,"updatedAt":1790000100,"detail":null,"from":"cli","pid":1}\n';

/** The launcher's bytes, out of `_inst_shim`'s own heredoc — the file `ccrc install` places at `~/.local/bin/ccrc`. */
export function shimBytes(): string {
  const src = readFileSync(CCRC_SRC, 'utf8');
  const m = /^_inst_shim\(\) \{[^\n]*\n {2}cat <<'CCRC_SHIM'\n([\s\S]*?)\nCCRC_SHIM\n/m.exec(src);
  if (m === null) throw new Error("_inst_shim's heredoc not found in ccd/ccrc");
  return `${m[1]}\n`;
}

function plant(file: string, body: string): void {
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}

/** How the two stubs behave (D-3400 amended, D-3413). `systemdRun: 'hang'` RECORDS its argv and its own pid
 *  (`<home>/systemd-run-pid`) and then blocks in `sleep` — the real parent has written `queued` and waits in it, the
 *  state the bound kills; it still never starts a unit. `curl: 'sleep'` records and sleeps past any bound, so a
 *  `rollback` parent is stopped BEFORE its `queued` write. Neither ever touches the network or a unit manager. */
export interface RealBoxOpts { systemdRun?: 'poison' | 'hang'; curl?: 'ok' | 'sleep' }

/** The planted box: the from-scratch `env`, and `spawn`, the REAL bounded `localUpdateSpawnFor` already bound to `home`
 *  and to that env (`timeoutMs` shrinks the bound). The one way to spawn against the box; a caller that runs the script
 *  itself (the watchdog's cases) takes `env` alone. */
export interface RealBox { env: NodeJS.ProcessEnv; spawn: (timeoutMs?: number) => LocalUpdateSpawn }

/** Plants the box under `home`. */
export function plantRealBox(home: string, opts: RealBoxOpts = {}): RealBox {
  const bin = path.join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  mkdirSync(path.join(home, 'ccrc'), { recursive: true });
  symlinkSync(CCD_DIR, path.join(home, 'ccrc', 'ccd'));
  plant(path.join(home, '.local', 'bin', 'ccrc'), shimBytes());
  for (const name of ['systemd-run', 'systemctl']) {
    const hang = name === 'systemd-run' && opts.systemdRun === 'hang';
    plant(path.join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-argv"\n${
      hang ? 'echo $$ > "$HOME/systemd-run-pid"\nexec sleep 300' : 'exit 97'}\n`);
  }
  plant(path.join(bin, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/curl-argv"\n${
    opts.curl === 'sleep' ? 'echo $$ > "$HOME/curl-pid"\nexec sleep 300' : 'printf 200\nexit 0'}\n`);
  writeFileSync(path.join(home, '.ccrc', 'update.json'), TERMINAL_REPORT);
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: `${bin}:/usr/local/bin:/usr/bin:/bin` };
  return { env, spawn: (timeoutMs) => localUpdateSpawnFor(home, timeoutMs === undefined ? { env } : { env, timeoutMs }) };
}

const lockPath = (home: string): string => path.join(home, '.ccrc', 'update.lock');
export const lockFree = (home: string): boolean =>
  spawnSync('bash', ['-c', 'exec 9>>"$1" && flock -n 9', '_', lockPath(home)]).status === 0;

/** A real holder: ONE process takes `flock` on the lock file and then becomes `sleep` (exec keeps the pid and the
 *  descriptor), so the recorded pid is the pid holding it and killing it releases the lock. Returns once a fresh probe
 *  fails. The caller kills `child.pid` in its `afterEach`. */
export function holdLock(home: string): ChildProcess {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  const child = spawn('bash', ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 60', '_', lockPath(home)], { stdio: 'ignore' });
  for (let i = 0; i < 400 && lockFree(home); i++) spawnSync('sleep', ['0.025']);
  if (lockFree(home)) {
    // Kill the blocking holder before throwing: a throw here means the caller never gets the child to kill.
    if (child.pid !== undefined) { try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ } }
    throw new Error('the fixture holder never took the lock');
  }
  return child;
}

/** A pid that was real and is gone: a short child, waited for. */
export async function deadPid(): Promise<number> {
  const child = spawn('true', [], { stdio: 'ignore' });
  const pid = child.pid!;
  await new Promise<void>((resolve) => { child.once('exit', () => resolve()); });
  return pid;
}
