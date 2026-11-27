// THE HARNESS FENCE ON WINDOWS (Go core wave 2 fix wave, final review critical 2): one owner for what every test harness
// that starts ccd, the core, the entry installer or the session hook hands its child as PATH and as a home. Off Windows
// every function here is the identity, and HOME stays the one isolation boundary (CLAUDE.md, SAFETY).
//
// What reached the operator's real home, measured from the Task 9b run's log and a read-only probe (fix wave report):
// ccd-entry-install's deploy.sh lane put its stand-in directory first as `${stub}:${PATH}`. On Windows that `:` glues the
// stub to MSYS2's `C:\msys64\usr\bin`, and `cygpath -u -p` turns the pair into `/c/…/stubbin:C:/msys64/usr/bin`, which a
// shell splits into `C` and `/msys64/usr/bin`, so MSYS2 fell out of the shell's PATH. The stand-in's `exec bash` then
// found Git for Windows' bash, a SECOND MSYS runtime: an exec across runtimes does not carry HOME, and that runtime takes
// the account's Windows profile instead (`db_home: env windows`, whatever HOME, USERPROFILE, HOMEDRIVE or HOMEPATH say;
// measured). So `~/ccrc/ccd/ccd-entry-install.py install ~/ccrc "$HOME"` ran the operator's live tree's installer against
// the real home, under an operator-installed Python found on the same unfenced PATH; only its layout check refused.
// The launcher itself finds its home from its own place, never from HOME, so a `ccd` resolved on such a PATH reaches the
// real home too. Hence the three rules below: no PATH entry under the operator's home (outside the temporary directory,
// where every fixture lives), no second MSYS runtime on PATH, and every home variable a Windows program reads set to the
// fixture.
import cp from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveBash } from '../src/exec.js';

const WIN = process.platform === 'win32';
/** MSYS2's own `/usr/bin`: the directory of the bash the harness and production run (`resolveBash`). */
export const MSYS_BIN = WIN ? path.win32.dirname(path.win32.normalize(resolveBash('win32'))) : '';
// Captured once, before any fence can change the worker's home variables: the rule is about the operator's real home.
const REAL_HOME = os.homedir();
const REAL_TMP = os.tmpdir();

const norm = (p: string): string => path.win32.resolve(p).toLowerCase().replace(/[\\/]+$/, '') + '\\';

/** Whether a Windows path is the operator's own: under the user's home directory and not under the temporary directory,
 *  where every fixture lives. `~/.local/bin` there holds the box's LIVE `ccd`, `ccrc` and `ccrc-api`. */
export function operatorPathEntry(d: string, home = REAL_HOME, tmp = REAL_TMP): boolean {
  return norm(d).startsWith(norm(home)) && !norm(d).startsWith(norm(tmp));
}

/** Whether a directory holds an MSYS runtime other than MSYS2's own (Git for Windows' `usr\bin`): a shell there takes
 *  the account's Windows profile as its home when a harness shell execs it, so it never belongs on a harness PATH. */
const runtimeMemo = new Map<string, boolean>();
export function foreignMsysRuntime(d: string, msys = MSYS_BIN): boolean {
  if (msys === '' || norm(d) === norm(msys)) return false;
  let hit = runtimeMemo.get(d);
  if (hit === undefined) {
    try { hit = fs.existsSync(path.win32.join(d, 'msys-2.0.dll')); } catch { hit = false; }
    runtimeMemo.set(d, hit);
  }
  return hit;
}

/** One PATH entry in Windows spelling: an MSYS one (`/c/x`, `/tmp/x`, `/usr/bin`) mapped as MSYS2 mounts it. */
export function winSpelling(d: string, msys = MSYS_BIN, tmp = REAL_TMP): string {
  const drive = /^\/([A-Za-z])(\/.*)?$/.exec(d);
  if (drive) return `${drive[1]!.toUpperCase()}:${(drive[2] ?? '/').replace(/\//g, '\\')}`;
  if (/^\/tmp(\/|$)/.test(d)) return path.win32.join(tmp, d.slice(4));
  if (d.startsWith('/') && msys !== '') return path.win32.join(msys, '..', '..', d);
  return d;
}

/** A PATH's entries in either spelling (`;`-separated Windows, `:`-separated MSYS, or the two mixed, as the ccd harness
 *  builds them), each in Windows spelling. A `:` that glues a Windows path onto the one before it is a separator. */
export function pathEntries(p: string, msys = MSYS_BIN): string[] {
  return p.split(/;|:(?=[A-Za-z]:[\\/])/).flatMap((e) => (e.startsWith('/') ? e.split(':') : [e]))
    .filter((e) => e !== '').map((e) => winSpelling(e, msys));
}

/** A Windows PATH with the fence applied: a `:` gluing two Windows paths read as the separator it was meant as, every
 *  operator entry and every foreign MSYS runtime taken out, and MSYS2's `/usr/bin` appended when something was taken
 *  out and it is not already there (it supplies what the removed entries did: jq, flock, python3). Last, not first:
 *  put first, MSYS2's own git and sh answered where Git for Windows' did (the graph card's abbreviated sha went red,
 *  measured in Task 9b). */
export function fencePath(p: string, home = REAL_HOME, tmp = REAL_TMP, msys = MSYS_BIN): string {
  const all = p.split(/;|:(?=[A-Za-z]:[\\/])/).filter((d) => d !== '');
  const out = all.filter((d) => !operatorPathEntry(d, home, tmp) && !foreignMsysRuntime(d, msys));
  if (out.length < all.length && msys !== '' && !out.some((d) => norm(d) === norm(msys))) out.push(msys);
  return out.join(';');
}

/** The home variables a Windows program reads besides HOME (Node's os.homedir, Go, Python, git, cmd), for `home`. */
export function homeVars(home: string): { USERPROFILE: string; HOMEDRIVE: string; HOMEPATH: string } {
  const w = path.win32.resolve(winSpelling(home));
  return { USERPROFILE: w, HOMEDRIVE: w.slice(0, 2), HOMEPATH: w.slice(2) || '\\' };
}

const keyOf = (env: NodeJS.ProcessEnv, name: string): string | undefined =>
  Object.keys(env).find((k) => k.toUpperCase() === name);

/** `env` fenced for a child on Windows: every PATH key fenced (fencePath), and USERPROFILE, HOMEDRIVE and HOMEPATH set
 *  to the env's own HOME (a fixture). An env with no HOME gets `home`, the harness's fixture, when one is given: an MSYS2
 *  program with no HOME takes the account's Windows profile. A copy; the identity off Windows. */
export function fenceEnv(env: NodeJS.ProcessEnv, home?: string): NodeJS.ProcessEnv {
  if (!WIN) return env;
  const out: NodeJS.ProcessEnv = { ...env };
  for (const k of Object.keys(out)) if (k.toUpperCase() === 'PATH' && out[k]) out[k] = fencePath(out[k]!);
  if (home && !out[keyOf(out, 'HOME') ?? 'HOME']) out['HOME'] = home;
  const hk = keyOf(out, 'HOME');
  if (hk && out[hk]) {
    for (const k of Object.keys(out)) if (['USERPROFILE', 'HOMEDRIVE', 'HOMEPATH'].includes(k.toUpperCase())) delete out[k];
    Object.assign(out, homeVars(out[hk]!));
  }
  return out;
}

const SYSTEM_ROOT = process.env['SystemRoot'] ?? process.env['SYSTEMROOT'] ?? 'C:\\Windows';
const hasBashExe = (d: string): boolean => { try { return fs.existsSync(path.win32.join(d, 'bash.exe')); } catch { return false; } };

/** The directory of the first `bash.exe` on a PATH (either spelling), or null: where a bare `bash` lands for an MSYS
 *  shell's lookup. */
export function bashDir(p: string, hasBash = hasBashExe, msys = MSYS_BIN): string | null {
  return pathEntries(p, msys).find(hasBash) ?? null;
}

/** Where a bare `bash` lands for node's own lookup (libuv's): PATH split on `;` alone and each entry read as a Windows
 *  path, so an MSYS-spelled entry (`/usr/bin`, or a `:`-joined list) is one node cannot resolve. The two lookups part
 *  there: `/usr/bin;C:\Windows\System32` is MSYS2's bash to a shell and the WSL launcher to node (fix round 2's
 *  re-review, N1-b). */
export function nodeBashDir(p: string, hasBash = hasBashExe): string | null {
  return p.split(';').find((e) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(e) && hasBash(e)) ?? null;
}

/** Whether a Windows path names the WSL launcher: a `bash.exe` or `wsl.exe` under the Windows directory (System32's runs
 *  Linux as root with HOME=/root, the fixture gone; measured by the fix wave's re-review). */
export function wslLauncher(file: string, root = SYSTEM_ROOT): boolean {
  return /^(bash|wsl)(\.exe)?$/i.test(path.win32.basename(file)) && norm(path.win32.dirname(file)).startsWith(norm(root));
}

/** What is wrong with a child env's PATH on Windows: an entry that is the operator's or a second MSYS runtime, or a bare
 *  `bash` that resolves anywhere but MSYS2's `/usr/bin` (the WSL launcher named as such). */
function pathBad(env: NodeJS.ProcessEnv, home: string, tmp: string, msys: string, hasBash: (d: string) => boolean): string[] {
  const bad: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (k.toUpperCase() !== 'PATH' || !v) continue;
    for (const d of pathEntries(v, msys)) {
      if (operatorPathEntry(d, home, tmp)) bad.push(`PATH ${d}`);
      else if (foreignMsysRuntime(d, msys)) bad.push(`PATH ${d} (a second MSYS runtime)`);
    }
    // an MSYS shell's lookup and node's own, each judged
    const dirs = [bashDir(v, hasBash, msys), nodeBashDir(v, hasBash)].filter((b): b is string => b !== null && norm(b) !== norm(msys));
    for (const b of new Set(dirs.map((d) => path.win32.join(d, 'bash.exe')))) {
      bad.push(wslLauncher(b)
        ? `PATH resolves bash to ${b}, the WSL launcher (Linux as root, HOME=/root)`
        : `PATH resolves bash to ${b}, not MSYS2's`);
    }
  }
  return bad;
}

/** The guard, run on the env a child is about to get: on Windows it throws when a home variable is missing or names the
 *  operator's home, or the PATH breaks a rule of pathBad. Nothing is spawned past a throw. */
export function assertFencedEnv(env: NodeJS.ProcessEnv, home = REAL_HOME, tmp = REAL_TMP, msys = MSYS_BIN, hasBash = hasBashExe): void {
  if (!WIN && home === REAL_HOME) return;
  const bad: string[] = [];
  for (const v of ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH']) if (!env[keyOf(env, v) ?? v]) bad.push(`${v} unset`);
  const hk = keyOf(env, 'HOME');
  const uk = keyOf(env, 'USERPROFILE');
  const dk = keyOf(env, 'HOMEDRIVE');
  const pk = keyOf(env, 'HOMEPATH');
  const homes = [hk && env[hk], uk && env[uk], dk && pk && env[dk] && env[pk] && `${env[dk]}${env[pk]}`]
    .filter((h): h is string => typeof h === 'string' && h !== '');
  for (const h of homes) if (operatorPathEntry(winSpelling(h, msys, tmp), home, tmp)) bad.push(`home ${h}`);
  bad.push(...pathBad(env, home, tmp, msys, hasBash));
  if (bad.length > 0) throw new Error(`a harness env reaches outside its fixture (${bad.join('; ')}): build it through fenceEnv`);
}

// THE SPAWN FENCE (fix round 2, re-review N1): the helpers above guard only the harnesses that call them, and a harness
// that builds its own PATH (`${bin}:${process.env.PATH}`) and spawns a bare `bash` landed on System32's WSL launcher. So
// on Windows every child_process spawner is wrapped once per worker (spawn-fence.setup.mjs): every child env goes
// through fenceEnv, and a spawn whose PATH breaks pathBad's rules, or that names the WSL launcher or a bash other than
// MSYS2's, throws before anything starts. The home variables are not asserted here: a worker's own HOME is the
// operator's (measured), so every env-inheriting `git` would be refused; HOME stays each harness's boundary, as off
// Windows, and the harness helpers keep asserting it (assertFencedEnv).
// shortcut: a grandchild's own spawns (a node child's child_process, a shell's exec) are not wrapped; they inherit the
// fenced PATH, and a shell that rebuilds PATH itself is not seen.
export const SPAWNERS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'] as const;
export const SPAWN_FENCED = Symbol.for('ccrc.test.spawn-fence');

/** A file a spawner is told to start, refused by name: the WSL launcher in any spelling, or a bash that is not MSYS2's. */
function commandBad(f: unknown, msys: string): string | null {
  if (typeof f !== 'string') return null;
  const w = winSpelling(f, msys);
  const b = path.win32.basename(w).toLowerCase();
  if (b === 'wsl' || b === 'wsl.exe' || wslLauncher(w)) return `${f}: the WSL launcher (Linux as root, HOME=/root)`;
  if ((b === 'bash' || b === 'bash.exe') && /[\\/]/.test(w) && norm(path.win32.dirname(w)) !== norm(msys)) return `${f}: a bash that is not MSYS2's`;
  return null;
}

/** One spawner's arguments with the fence applied: its options object found (or put in, before a callback), its env
 *  fenced. Throws, spawning nothing, when the child would still reach outside MSYS2. */
export function fenceSpawnArgs(name: typeof SPAWNERS[number], a: unknown[], msys = MSYS_BIN, hasBash = hasBashExe): unknown[] {
  const args = [...a];
  while (args.length > 1 && args[args.length - 1] === undefined) args.pop();
  let i = args.findIndex((x, k) => k >= 1 && x !== null && typeof x === 'object' && !Array.isArray(x));
  if (i < 0) {
    const cb = args.findIndex((x) => typeof x === 'function');
    i = cb < 0 ? args.length : cb;
    args.splice(i, 0, {});
  }
  const opts = args[i] as { env?: NodeJS.ProcessEnv; shell?: unknown };
  const env = fenceEnv(opts.env ?? process.env);
  // A child env with no PATH key: node looks a bare command up on this process's PATH (measured), so that is the one
  // judged. Judged only: the child gets its env as given.
  const bad = pathBad(keyOf(env, 'PATH') ? env : { ...env, PATH: process.env['PATH'] }, REAL_HOME, REAL_TMP, msys, hasBash);
  for (const f of [name === 'exec' || name === 'execSync' ? undefined : args[0], opts.shell]) {
    const why = commandBad(f, msys);
    if (why !== null) bad.push(why);
  }
  if (bad.length > 0) throw new Error(`ccrc spawn fence: ${name} refused, its child would reach outside MSYS2 (${bad.join('; ')})`);
  args[i] = { ...opts, env };
  return args;
}

/** Wraps child_process's spawners in fenceSpawnArgs, once per process, on Windows only (nothing elsewhere), and syncs
 *  the ESM named imports, so `import { spawnSync } from 'node:child_process'` gets the wrapped one too. */
export function installSpawnFence(): void {
  const mod = cp as unknown as Record<string, ((...a: unknown[]) => unknown) & Record<symbol, unknown>>;
  if (!WIN || mod['spawnSync']![SPAWN_FENCED]) return;
  for (const name of SPAWNERS) {
    const orig = mod[name]!;
    const fenced = function (this: unknown, ...a: unknown[]): unknown { return orig.apply(this, fenceSpawnArgs(name, a)); };
    const custom = orig[promisify.custom] as ((...a: unknown[]) => unknown) | undefined;
    if (custom) Object.defineProperty(fenced, promisify.custom, { value: (...a: unknown[]) => custom(...fenceSpawnArgs(name, a)) });
    Object.defineProperty(fenced, SPAWN_FENCED, { value: true });
    mod[name] = fenced as typeof orig;
  }
  syncBuiltinESMExports();
}

// The worker's own PATH, fenced once at import: suites build a child's PATH from it (`${bin}:${process.env.PATH}`), and
// some start a child with the worker's env as it stands. vitest.config.ts imports this module too, so every worker
// inherits the fenced PATH before any test file loads.
if (WIN && process.env['PATH']) process.env['PATH'] = fencePath(process.env['PATH']);
