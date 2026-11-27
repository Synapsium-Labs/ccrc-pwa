// The Windows port, C5: the test box op's local arm asks `systemctl --user show-environment` on Windows too, because the
// port's manager answers it (win/bin/systemctl, GET /environment). Its fixed files (the manager's `systemctl`, the
// `ccrc` launcher, `npm`) are scripts CreateProcess cannot start by name, so the real seams start them through the MSYS
// shell, and the manager's PATH is read under Windows's spelling `Path`. Before this, every tool read null on Windows.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundedExec } from '../src/testbox/exec.js';
import { measureTestbox, pathOf, startableExec, type TestboxOpSeams } from '../src/testboxOp.js';
import { mkTmp } from './tmpHelpers.js';

describe('startableExec and pathOf (the Windows port, C5)', () => {
  it('off Windows the spawner is the one given; on Windows every file goes through the shell, argv intact', async () => {
    const calls: [string, readonly string[]][] = [];
    const exec: TestboxOpSeams['exec'] = () => async (file, args) => { calls.push([file, args]); return { status: 0, stdout: '', stderr: '', killed: false }; };
    expect(startableExec(exec, 'linux')).toBe(exec);
    await startableExec(exec, 'win32', 'B')({}, 1)('systemctl', ['--user', 'show-environment']);
    expect(calls).toEqual([['B', ['-c', 'exec "$0" "$@"', 'systemctl', '--user', 'show-environment']]]);
    // An absolute launcher that is not there keeps its own ENOENT (spawned as itself), never the shell's exit 127.
    const gone = path.join(mkTmp('ccrc-tbwin-gone-'), 'ccrc');
    calls.length = 0;
    await startableExec(exec, 'win32', 'B')({}, 1)(gone, ['test']);
    expect(calls).toEqual([[gone, ['test']]]);
  });

  it('reads PATH, else Windows\'s Path, else nothing', () => {
    expect(pathOf(new Map([['PATH', '/a'], ['Path', 'C:\\b']]))).toBe('/a');
    expect(pathOf(new Map([['Path', 'C:\\b']]))).toBe('C:\\b');
    expect(pathOf(new Map([['HOME', '/h']]))).toBe(null);
  });
});

describe.skipIf(process.platform !== 'win32')('the testbox op on Windows, real spawns (C5)', () => {
  it('asks the manager through the shell and measures every tool on the manager\'s Path', async () => {
    const home = mkTmp('ccrc-tbwin-');
    const agentBin = path.join(home, 'agent-bin');
    const userBin = path.join(home, 'user-bin');
    mkdirSync(agentBin, { recursive: true });
    mkdirSync(userBin, { recursive: true });
    const script = (dir: string, name: string, body: string): void => {
      writeFileSync(path.join(dir, name), `#!/bin/bash\n${body}\n`);
      chmodSync(path.join(dir, name), 0o755);
    };
    const msys = 'C:\\msys64\\usr\\bin';
    script(agentBin, 'systemctl', `printf 'HOME=%s\\nPath=%s\\n' 'C:\\\\h' '${userBin.replaceAll('\\', '\\\\')};${msys.replaceAll('\\', '\\\\')}'`);
    for (const [t, out] of [['node', 'v22.1.0'], ['npm', '10.2.0'], ['tmux', 'tmux 3.5a'], ['git', 'git version 2.47.1'], ['python3', 'Python 3.12.4']]) {
      script(userBin, t, `echo '${out}'`);
    }
    const r = await measureTestbox(home, {
      exec: startableExec(boundedExec, 'win32', 'C:/msys64/usr/bin/bash.exe'),
      agentPath: `${agentBin};${msys}`, userBus: {}, now: () => 0,
    });
    expect(r.host.tools).toMatchObject({ node: '22.1.0', npm: '10.2.0', tmux: '3.5a', git: '2.47.1', python3: '3.12.4', chrome: null });
  }, 60_000);
});
