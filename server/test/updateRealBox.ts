// A fixture box for the cases that run the REAL `ccd/ccrc` as the `--detach` parent (D-3411): the real launcher at
// `<home>/.local/bin/ccrc` (its bytes are `_inst_shim`'s own heredoc, read out of the script), a symlink
// `<home>/ccrc/ccd` to the checkout's `ccd/` (the launcher `exec`s `$HOME/ccrc/ccd/ccrc`), and a terminal
// `update.json` so byte-identity means something.
//
// CONTAINMENT, structural — the env the caller hands the spawner is built FROM SCRATCH, never spread from
// `process.env`: HOME is the fixture and PATH is `<home>/bin:/usr/local/bin:/usr/bin:/bin`, never the operator's
// `~/.local/bin`. A poisoned, RECORDING `systemd-run` and `systemctl` sit first on that PATH: each appends its argv to
// `<home>/<name>-argv` and exits 97, so a lock the harness failed to hold reaches `systemd-run` and the case that
// asserts the file's absence reds instead of starting a real transient unit. `curl` is a stub that answers 200 and
// records its argv to `<home>/curl-argv` (the `rollback` kind asks the release host before its lock probe), so
// nothing here reaches the network.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Plants the box under `home` and returns the from-scratch env for the spawner. */
export function plantRealBox(home: string): NodeJS.ProcessEnv {
  const bin = path.join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  mkdirSync(path.join(home, 'ccrc'), { recursive: true });
  symlinkSync(CCD_DIR, path.join(home, 'ccrc', 'ccd'));
  plant(path.join(home, '.local', 'bin', 'ccrc'), shimBytes());
  for (const name of ['systemd-run', 'systemctl']) {
    plant(path.join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-argv"\nexit 97\n`);
  }
  plant(path.join(bin, 'curl'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/curl-argv"\nprintf 200\nexit 0\n');
  writeFileSync(path.join(home, '.ccrc', 'update.json'), TERMINAL_REPORT);
  return { HOME: home, PATH: `${bin}:/usr/local/bin:/usr/bin:/bin` };
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
  if (lockFree(home)) throw new Error('the fixture holder never took the lock');
  return child;
}

/** A pid that was real and is gone: a short child, waited for. */
export async function deadPid(): Promise<number> {
  const child = spawn('true', [], { stdio: 'ignore' });
  const pid = child.pid!;
  await new Promise<void>((resolve) => { child.once('exit', () => resolve()); });
  return pid;
}
