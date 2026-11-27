// `shellArgv` (src/exec.ts) — how the local runner spells a spawn on the box
// it is running on. It is the whole reason local mode can drive `ccd` on a
// Windows box at all: `cfg.ccdBin` is `$HOME/.local/bin/ccd`, a bash script
// with no extension, and CreateProcess does not run scripts. `execFile` of
// that path answers `ENOENT` for a file it just found; the server boots, logs
// `local ccd caps probe failed (spawn error: spawn …\.local\bin\ccd ENOENT)`,
// and every verb after that fails the same way.
//
// A pure function of (cmd, args, platform), tested on BOTH platforms from
// whichever one the suite happens to run on — otherwise the Windows arm would
// be exercised only on the machine nobody's CI is.
import { describe, it, expect } from 'vitest';
import { shellArgv, resolveBash } from '../src/exec.js';

describe('shellArgv — POSIX', () => {
  it('leaves the spawn exactly as given', () => {
    expect(shellArgv('/home/u/.local/bin/ccd', ['caps'], 'linux'))
      .toEqual({ cmd: '/home/u/.local/bin/ccd', args: ['caps'] });
    expect(shellArgv('tmux', ['ls'], 'linux')).toEqual({ cmd: 'tmux', args: ['ls'] });
  });
});

describe('shellArgv — Windows', () => {
  it('runs a script path THROUGH bash, with forward slashes bash can do arithmetic on', () => {
    // `${BASH_SOURCE[0]%/*}` finds no `/` in a backslash path and ccd would
    // compute its own location as `.`; the slashes are load-bearing.
    const sp = shellArgv('C:\\Users\\u\\.local\\bin\\ccd', ['caps'], 'win32');
    // NEVER the bare name on Windows: System32\bash.exe is the WSL launcher and
    // wins a PATH lookup, and the ccd tree does not exist inside WSL.
    expect(sp.cmd).toBe(resolveBash('win32'));
    // Through `exec`, so the file's shebang decides: the D-3696 launcher at ~/.local/bin/ccd is Python.
    // In MSYS form: MSYS2's python reads `C:/...` as a relative path, and the launcher could not find itself.
    expect(sp.args).toEqual(['-c', 'exec "$0" "$@"', '/c/Users/u/.local/bin/ccd', 'caps']);
  });

  it('leaves a bare name to PATH — `tmux` resolves to tmux.exe there', () => {
    expect(shellArgv('tmux', ['ls'], 'win32')).toEqual({ cmd: 'tmux', args: ['ls'] });
  });

  it('leaves a Windows executable alone — it is already something CreateProcess runs', () => {
    expect(shellArgv('C:\\tools\\node.exe', ['-v'], 'win32'))
      .toEqual({ cmd: 'C:\\tools\\node.exe', args: ['-v'] });
  });
});

describe('resolveBash — the bare name is a trap on Windows', () => {
  it('honours CCRC_BASH above everything, on every platform', () => {
    const saved = process.env['CCRC_BASH'];
    try {
      process.env['CCRC_BASH'] = '/opt/msys/bash';
      expect(resolveBash('win32')).toBe('/opt/msys/bash');
      expect(resolveBash('linux')).toBe('/opt/msys/bash');
    } finally {
      if (saved === undefined) delete process.env['CCRC_BASH']; else process.env['CCRC_BASH'] = saved;
    }
  });

  it('is the bare name off Windows — PATH there holds no WSL launcher', () => {
    const saved = process.env['CCRC_BASH'];
    try { delete process.env['CCRC_BASH']; expect(resolveBash('linux')).toBe('bash'); }
    finally { if (saved !== undefined) process.env['CCRC_BASH'] = saved; }
  });
});
