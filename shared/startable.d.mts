/** `[file, args]` as this platform can start them: unchanged off Windows; on Windows a script goes through the MSYS
 *  shell (`bash -c 'exec "$0" "$@"' <file in MSYS form> …args`). An absent path, a Windows executable and (unless
 *  `bare`) a bare name are started as themselves. See `shared/startable.mjs`. */
export function startable(
  file: string, args: readonly string[], opts?: { platform?: string; bash?: string; bare?: boolean },
): [string, string[]];

/** End `child`'s whole process tree on Windows: `taskkill /T /F` through the injected `spawn`, then the child alone.
 *  See `shared/spawn.mjs`. */
export function winKillTree(
  spawn: (file: string, args: string[], options: { stdio: 'ignore'; windowsHide: true }) => { on(event: string, listener: (...args: any[]) => void): unknown },
  child: { readonly pid?: number | undefined; kill(signal: 'SIGTERM' | 'SIGKILL'): unknown },
  signal: 'SIGTERM' | 'SIGKILL',
): void;
