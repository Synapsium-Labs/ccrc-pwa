// `startable` and `winKillTree`: how this platform starts a file and ends a tree. Its own module because the spawn kernel (`shared/spawn.mjs`) imports
// nothing (D-7055) and this rule needs `existsSync`; the `.mjs` carve-out allows `node:fs` here. Every wrapper hands
// it to the kernel in its host, and the agent's `runExec`, token-sync port and test box op call it directly.
import { existsSync } from 'node:fs';

/** `[file, args]` as this platform can start them: unchanged off Windows; on Windows through the MSYS shell, because
 *  what the agent starts (the ccrc launcher, the ccd launcher, the manager's `systemctl`) is a script CreateProcess
 *  cannot run (the Windows port; CCRC_BASH is the shell its manager names, else PATH's bash, which the manager puts
 *  MSYS's ahead of). The agent's one owner of this rule: its spawners, `runExec` and the test box op all call it.
 *  A Windows executable (`.exe`, `.cmd`, …) is started as itself; a bare name too, unless `bare` (the test box op's
 *  `systemctl`, `npm`: scripts found on a PATH). The file reaches the shell in MSYS form (`/c/…`): MSYS2's python
 *  reads `C:/…` as a relative path, so the ccd launcher could not find itself (`server/src/exec.ts#shellArgv`). */
export function startable(file, args, { platform = process.platform, bash = process.env.CCRC_BASH || 'bash', bare = false } = {}) {
  if (platform !== 'win32' || /\.(exe|cmd|bat|com)$/i.test(file)) return [file, [...args]];
  const isPath = /[\\/]/.test(file);
  // An ABSENT file is spawned as itself, so spawn's own ENOENT still answers `not-started`, as everywhere: through the
  // shell it would come back as an exit 127, two conditions folded into one.
  if (isPath ? !existsSync(file.replace(/^\/([A-Za-z])(?=\/)/, '$1:')) : !bare) return [file, [...args]];
  const posix = file.replace(/\\/g, '/').replace(/^([A-Za-z]):(?=\/|$)/, (_m, d) => `/${d.toLowerCase()}`);
  return [bash, ['-c', 'exec "$0" "$@"', posix, ...args]];
}

/** End the child's whole tree on Windows, where a negative pid is no process group (`process.kill(-pid)` throws
 *  ESRCH whatever the child's state, so reading ESRCH as "already gone" left a hung child alive past its bound).
 *  `taskkill /T /F` runs through the injected `spawn` (this file may not import `node:child_process`), and the child
 *  alone after it, so a taskkill that cannot run still ends the parent. The one Windows tree kill: the server's local
 *  caps probe (`server/src/localcaps.ts`) calls it too. */
export function winKillTree(spawn, child, signal) {
  const alone = () => { try { child.kill(signal); } catch { /* gone */ } };
  try {
    const tk = spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
    tk.on('error', alone);
    tk.on('exit', alone);
  } catch { alone(); }
}
