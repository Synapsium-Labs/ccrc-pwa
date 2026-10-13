// Real processes standing for a killed pane's stragglers (child reclamation
// wave 6, spec §5.6): a process of this uid with a given TMPDIR, working
// directory, or a file held open. Spawned by vitest, NEVER by ccd, so ccd's
// "my own children are not users" rule cannot hide them — the pane's real
// stragglers are not ccd's children either.
// The environment is BUILT, never spread from `process.env`: PATH and the
// TMPDIR a case names, nothing else, so no git variable of the runner can
// reach a process a test starts. ALWAYS `stop()` it (an afterEach, or a finally).
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

export interface Held { pid: number; stop: () => void; exited: Promise<void> }

const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** Whether `/proc/<pid>/fd` holds `file` (its resolved path) open. Linux only. */
export function holdsOpen(pid: number, file: string): boolean {
  const want = fs.realpathSync(file);
  let fds: string[];
  try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { return false; }
  return fds.some((n) => { try { return fs.readlinkSync(`/proc/${pid}/fd/${n}`) === want; } catch { return false; } });
}

/** Gone or a zombie: what the probe must read as "nobody". Linux only; elsewhere, true. */
function settled(pid: number): boolean {
  if (process.platform !== 'linux') return true;
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return raw.slice(raw.lastIndexOf(')') + 2).startsWith('Z');
  } catch { return true; }
}

/** `bash -c <script>` (default: `exec sleep 60`, after `exec 3<"$1"` when `holdOpen` names a file) with
 *  its cwd at `cwd` and, when given, `TMPDIR=<tmpdir>`. `spawn` returns once bash has exec'd, so its
 *  environment and cwd are already in /proc; an fd it opens is waited for (at most 10 s). `stop()` sends
 *  SIGKILL and returns once the process is gone or a zombie, so the next probe cannot race its death. */
export function holdProc(o: { cwd: string; tmpdir?: string; holdOpen?: string; script?: string; args?: readonly string[] }): Held {
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'] ?? '/usr/bin:/bin' };
  if (o.tmpdir !== undefined) env['TMPDIR'] = o.tmpdir;
  const body = o.script ?? (o.holdOpen !== undefined ? 'exec 3<"$1"; exec sleep 60' : 'exec sleep 60');
  const argv = o.script !== undefined ? [...(o.args ?? [])] : [o.holdOpen ?? ''];
  const p: ChildProcess = spawn('bash', ['-c', body, 'held', ...argv], { cwd: o.cwd, env, stdio: 'ignore' });
  if (p.pid === undefined) throw new Error(`could not start a process in ${o.cwd}`);
  const pid = p.pid;
  const exited = new Promise<void>((resolve) => { p.once('exit', () => resolve()); });
  if (o.holdOpen !== undefined) {
    const until = Date.now() + 10_000;
    while (!holdsOpen(pid, o.holdOpen)) {
      if (Date.now() > until) { p.kill('SIGKILL'); throw new Error(`process ${pid} never opened ${o.holdOpen}`); }
      pause(20);
    }
  }
  const stop = (): void => {
    p.kill('SIGKILL');
    const until = Date.now() + 5_000;
    while (!settled(pid) && Date.now() < until) pause(20);
  };
  return { pid, stop, exited };
}
