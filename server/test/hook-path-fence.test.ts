// The Windows harness fence (pathFence.ts; Go core wave 2, Task 9b gate round, then the fix wave's critical 2): a child a
// harness starts never resolves a name in the operator's own directories (`~/.local/bin` holds the box's live `ccd`, `ccrc`
// and `ccrc-api`), never finds a second MSYS runtime (Git for Windows' bash takes the account's profile as its home), and
// never runs without its home variables set to the fixture.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertFencedEnv, fenceEnv, fencePath, homeVars, operatorPathEntry, pathEntries, winSpelling } from './pathFence.js';
import { HARNESS_BASH, ghContainedEnv } from './ccdWsHelpers.js';
import { hookEnv } from './hookTwin.js';
import { mkTmp } from './tmpHelpers.js';

const HOME = 'C:\\Users\\op';
const TMP = 'C:\\Users\\op\\AppData\\Local\\Temp';
const MSYS = 'C:\\msys64\\usr\\bin';
const FIX = `${TMP}\\ccrc-testrun-x\\home`;
const fenced = { HOME: FIX, USERPROFILE: FIX, HOMEDRIVE: 'C:', HOMEPATH: FIX.slice(2), PATH: `${FIX}\\bin;C:\\WINDOWS\\system32` };

describe('the fence\'s rule (pure, every platform)', () => {
  it('an entry under the home directory is the operator\'s, unless it is under the temporary directory', () => {
    expect(operatorPathEntry('C:\\Users\\op\\.local\\bin', HOME, TMP)).toBe(true);
    expect(operatorPathEntry('c:/users/OP/bin/', HOME, TMP)).toBe(true);
    expect(operatorPathEntry('C:\\Users\\op\\AppData\\Local\\Microsoft\\WinGet\\Links', HOME, TMP)).toBe(true);
    expect(operatorPathEntry('C:\\Users\\op\\AppData\\Local\\Temp\\ccrc-testrun-x\\home\\bin', HOME, TMP)).toBe(false);
    expect(operatorPathEntry('C:\\Program Files\\Git\\usr\\bin', HOME, TMP)).toBe(false);
    expect(operatorPathEntry('C:\\Users\\opera\\bin', HOME, TMP), 'a sibling user whose name starts the same').toBe(false);
  });
  it('fencePath takes every operator entry out and appends MSYS2\'s /usr/bin once; a fenced PATH is left alone', () => {
    const fixture = `${TMP}\\ccrc-testrun-x\\home\\bin`;
    const p = [fixture, 'C:\\Users\\op\\bin', 'C:\\Program Files\\Git\\cmd', 'C:\\Users\\op\\.local\\bin', 'C:\\WINDOWS\\system32'].join(';');
    expect(fencePath(p, HOME, TMP, MSYS).split(';')).toEqual([fixture, 'C:\\Program Files\\Git\\cmd', 'C:\\WINDOWS\\system32', MSYS]);
    expect(fencePath(fencePath(p, HOME, TMP, MSYS) + ';C:\\Users\\op\\bin', HOME, TMP, MSYS).split(';').filter((d) => d === MSYS)).toHaveLength(1);
    expect(fencePath(fixture, HOME, TMP, MSYS)).toBe(fixture);
  });
  it('a `:` that glues a stand-in directory onto a Windows path is read as the separator (the deploy.sh lane\'s shape)', () => {
    const p = `${FIX}\\stubbin:${MSYS};C:\\Users\\op\\.local\\bin;C:\\WINDOWS`;
    expect(fencePath(p, HOME, TMP, MSYS).split(';')).toEqual([`${FIX}\\stubbin`, MSYS, 'C:\\WINDOWS']);
  });
  it('a PATH is read in either spelling: Windows, MSYS (`/c/…`, `/tmp/…`, `/usr/bin`) and the two mixed', () => {
    expect(winSpelling('/c/Users/op/.local/bin', MSYS, TMP)).toBe('C:\\Users\\op\\.local\\bin');
    expect(winSpelling('/tmp/x', MSYS, TMP)).toBe(`${TMP}\\x`);
    expect(winSpelling('/usr/bin', MSYS, TMP)).toBe(MSYS);
    expect(pathEntries('/c/a/bin:/c/Users/op/.local/bin;C:\\msys64\\usr\\bin')).toEqual(['C:\\a\\bin', 'C:\\Users\\op\\.local\\bin', MSYS]);
  });
  it('the home variables follow HOME, in Windows spelling', () => {
    expect(homeVars(FIX)).toEqual({ USERPROFILE: FIX, HOMEDRIVE: 'C:', HOMEPATH: FIX.slice(2) });
  });
  it('the guard passes a fenced env and refuses every way out of the fixture, in both PATH spellings', () => {
    // bash.exe only in MSYS2's directory, whatever this box holds (System32's WSL launcher is spawn-fence.test.ts's case)
    const guard = (e: NodeJS.ProcessEnv) => () => assertFencedEnv(e, HOME, TMP, MSYS, (d) => d.toLowerCase() === MSYS.toLowerCase());
    expect(guard(fenced)).not.toThrow();
    expect(guard({ ...fenced, PATH: `C:\\Users\\op\\.local\\bin;${fenced.PATH}` })).toThrow(/PATH C:\\Users\\op\\.local\\bin/);
    expect(guard({ ...fenced, PATH: `/c/x/bin:/c/Users/op/.local/bin;${MSYS}` }), 'the MSYS spelling ghContainedEnv builds').toThrow(/PATH C:\\Users\\op\\.local\\bin/);
    expect(guard({ ...fenced, USERPROFILE: HOME })).toThrow(/home C:\\Users\\op/);
    expect(guard({ ...fenced, HOME: '/c/Users/op' })).toThrow(/home \/c\/Users\/op/);
    const { USERPROFILE: _u, ...noProfile } = fenced;
    expect(guard(noProfile), 'an absent USERPROFILE: a native program falls back to the real profile').toThrow(/USERPROFILE unset/);
    const { HOMEPATH: _p, ...noHomePath } = fenced;
    expect(guard(noHomePath)).toThrow(/HOMEPATH unset/);
  });
});

describe.skipIf(process.platform === 'win32')('off Windows the fence is the identity', () => {
  it('fenceEnv hands back the env it was given, and the guard passes it, HOME the one boundary', () => {
    const env = { HOME: '/tmp/x', PATH: `/tmp/x/bin:${os.homedir()}/.local/bin:/usr/bin` };
    expect(fenceEnv(env)).toBe(env);
    expect(fenceEnv(env, '/tmp/y')).toBe(env);
    expect(() => assertFencedEnv(env)).not.toThrow();
  });
});

describe.runIf(process.platform === 'win32')('the fence on this box', () => {
  it('this worker\'s PATH names no operator directory and no second MSYS runtime, and the guard refuses one that does', () => {
    expect(pathEntries(process.env['PATH'] ?? '').filter((d) => operatorPathEntry(d))).toEqual([]);
    const runtimes = new Set(pathEntries(process.env['PATH'] ?? '').filter((d) => fs.existsSync(path.join(d, 'msys-2.0.dll')))
      .map((d) => path.win32.resolve(d).toLowerCase()));
    expect([...runtimes]).toEqual([path.win32.resolve(path.dirname(HARNESS_BASH)).toLowerCase()]);
    expect(() => assertFencedEnv({ ...fenced, PATH: `${os.homedir()}\\.local\\bin;C:\\WINDOWS` })).toThrow(/reaches outside its fixture/);
  });
  it('neither ccd nor ccrc resolves under the home directory through the fenced PATH (a read-only command -v)', () => {
    const r = spawnSync(HARNESS_BASH, ['-c', 'for n in ccd ccrc ccrc-api systemctl systemd-run; do p=$(command -v "$n") && cygpath -w "$p"; done; true'],
      { encoding: 'utf8', env: { ...process.env } });
    const found = r.stdout.split('\n').filter((l) => l !== '');
    expect(found.filter((l) => operatorPathEntry(l.replace(/[\\/][^\\/]+$/, '')))).toEqual([]);
  });
  // The measured escape (fix wave report): ccd-entry-install's deploy.sh lane, `${stub}:${PATH}` through ghContainedEnv,
  // a `#!/bin/sh` stand-in that execs `bash`. Before the fence that bash was Git for Windows' and its HOME the real one.
  it('a stand-in that execs bash through ghContainedEnv\'s PATH gets MSYS2\'s bash and keeps the fixture HOME (read-only)', () => {
    const home = mkTmp('ccrc-fence-');
    try {
      const stub = path.join(home, 'stubbin');
      fs.mkdirSync(stub, { recursive: true });
      fs.writeFileSync(path.join(stub, 'fake-ssh'), '#!/bin/sh\nshift\nexec bash -c "$1"\n', { mode: 0o755 });
      // The 9b run's order: the stand-in glued to MSYS2's directory, then Git for Windows' runtime where this box has one.
      const git = ['C:\\Program Files\\Git\\usr\\bin'].filter((d) => fs.existsSync(path.join(d, 'msys-2.0.dll')));
      const p = [`${stub}:${path.dirname(HARNESS_BASH)}`, ...git, process.env['PATH'] ?? ''].join(';');
      const env = ghContainedEnv(home, { HOME: home, PATH: p }, { systemd: true, tmux: true });
      const r = spawnSync('bash', ['-c', 'fake-ssh box \'cygpath -w "$(command -v bash)"; cygpath -w "$HOME"\''], { encoding: 'utf8', cwd: home, env });
      const [bash, winHome] = r.stdout.split(/\r?\n/);
      expect(path.win32.dirname(bash ?? '').toLowerCase(), r.stderr).toBe(path.win32.resolve(path.dirname(HARNESS_BASH)).toLowerCase());
      expect(winHome?.toLowerCase()).toBe(home.toLowerCase());
      expect(env['USERPROFILE']).toBe(home);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  it('hookEnv hands the hook the fixture\'s home variables', () => {
    const e = hookEnv({ home: FIX, env: (x = {}) => ({ HOME: FIX, PATH: process.env['PATH'], ...x }) });
    expect([e['USERPROFILE'], e['HOMEDRIVE'], e['HOMEPATH']]).toEqual([FIX, 'C:', FIX.slice(2)]);
    expect(() => assertFencedEnv(e)).not.toThrow();
  });
  it('fenceEnv gives an env with no HOME the harness\'s fixture, never the account\'s profile', () => {
    const e = fenceEnv({ PATH: process.env['PATH'] }, FIX);
    expect([e['HOME'], e['USERPROFILE']]).toEqual([FIX, FIX]);
  });
});
