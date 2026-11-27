// THE SPAWN FENCE (pathFence.ts#fenceSpawnArgs, installed by spawn-fence.setup.mjs; Go core wave 2 fix round 2, the fix
// wave's re-review N1). A harness that builds its own PATH and spawns a bare `bash` landed, on Windows, on System32's WSL
// launcher: Linux as root, HOME=/root, the fixture gone. Every child_process spawner in a worker is wrapped once, so a
// harness cannot skip the fence: a glued PATH is repaired, and a child whose bash would still not be MSYS2's is refused
// before it starts. Off Windows nothing is wrapped.
import { describe, it, expect, vi } from 'vitest';
import cp, { spawnSync, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { MSYS_BIN, SPAWNERS, SPAWN_FENCED, assertFencedEnv, fenceSpawnArgs } from './pathFence.js';
import { mkTmp } from './tmpHelpers.js';

const MSYS = 'C:\\msys64\\usr\\bin';
const SYS32 = 'C:\\Windows\\System32';
const STUB = 'C:\\Users\\op\\AppData\\Local\\Temp\\ccrc-testrun-x\\stub';
const bashIn = (...dirs: string[]) => (d: string): boolean => dirs.some((x) => x.toLowerCase() === d.toLowerCase());
const env = (p: string): NodeJS.ProcessEnv => ({ HOME: 'C:\\Users\\op\\AppData\\Local\\Temp\\ccrc-testrun-x\\home', PATH: p });
const fence = (name: typeof SPAWNERS[number], a: unknown[]): unknown[] => fenceSpawnArgs(name, a, MSYS, bashIn(MSYS, SYS32));

describe('the spawn fence\'s rule (pure, every platform)', () => {
  it('refuses a PATH whose bash is System32\'s WSL launcher, by name, and one whose bash is not MSYS2\'s', () => {
    expect(() => fence('spawnSync', ['bash', ['-c', 'true'], { env: env(`${STUB};${SYS32};${MSYS}`) }])).toThrow(/spawnSync refused.*the WSL launcher/);
    expect(() => fenceSpawnArgs('spawnSync', ['bash', [], { env: env(`C:\\other\\bin;${MSYS}`) }], MSYS, bashIn('C:\\other\\bin', MSYS)))
      .toThrow(/PATH resolves bash to C:\\other\\bin\\bash.exe, not MSYS2's/);
    expect(() => fence('spawnSync', ['bash', [], { env: env(`${STUB};${MSYS};${SYS32}`) }])).not.toThrow();
    expect(() => fence('spawnSync', ['git', [], { env: env(STUB) }]), 'a PATH with no bash on it has nowhere to land').not.toThrow();
  });
  // N1-b (fix round 2's re-review): the two shapes where the fence and node read PATH apart.
  it('judges what node would start: an MSYS-spelled /usr/bin before a `;`-joined System32 is the WSL launcher to node', () => {
    expect(() => fence('spawnSync', ['bash', [], { env: env(`/usr/bin;${SYS32}`) }])).toThrow(/spawnSync refused.*the WSL launcher/);
    expect(() => fence('spawnSync', ['bash', [], { env: env(`/usr/bin;${MSYS};${SYS32}`) }]), 'node reaches MSYS2 first').not.toThrow();
  });
  it('a child env with no PATH key is judged by the PATH node looks it up on, this process\'s', () => {
    const noPath = { HOME: 'C:\\Users\\op\\AppData\\Local\\Temp\\ccrc-testrun-x\\home' };
    vi.stubEnv('PATH', `${SYS32};${MSYS}`);
    try {
      expect(() => fence('spawnSync', ['bash', [], { env: noPath }])).toThrow(/spawnSync refused.*the WSL launcher/);
      // a PATH key whose value is undefined: node leaves it out of the child's block, so it is the same lookup (F7)
      expect(() => fence('spawnSync', ['bash', [], { env: { ...noPath, PATH: undefined } }]), 'PATH: undefined')
        .toThrow(/spawnSync refused.*the WSL launcher/);
    } finally { vi.unstubAllEnvs(); }
    vi.stubEnv('PATH', `${MSYS};${SYS32}`);
    try {
      const [, , o] = fence('spawnSync', ['bash', [], { env: noPath }]) as [string, string[], { env: NodeJS.ProcessEnv }];
      expect(Object.keys(o.env).some((k) => k.toUpperCase() === 'PATH'), 'judged only: no PATH is handed to the child').toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });
  it('the harness guard refuses the same PATH (assertFencedEnv)', () => {
    const e = { ...env(`${STUB};${SYS32}`), USERPROFILE: 'x', HOMEDRIVE: 'C:', HOMEPATH: '\\x' };
    expect(() => assertFencedEnv(e, 'C:\\Users\\op', 'C:\\Users\\op\\AppData\\Local\\Temp', MSYS, bashIn(MSYS, SYS32))).toThrow(/the WSL launcher/);
    expect(() => assertFencedEnv({ ...e, PATH: `${MSYS};${SYS32}` }, 'C:\\Users\\op', 'C:\\Users\\op\\AppData\\Local\\Temp', MSYS, bashIn(MSYS, SYS32))).not.toThrow();
  });
  it('refuses the WSL launcher and a foreign bash named as the file or the shell; MSYS2\'s own bash passes', () => {
    const ok = env(`${MSYS};${SYS32}`);
    for (const f of [`${SYS32}\\bash.exe`, 'c:/windows/system32/BASH.EXE', 'wsl', 'wsl.exe', `${SYS32}\\wsl.exe`, 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']) {
      expect(() => fence('spawn', [f, [], { env: ok }]), f).toThrow(/spawn refused/);
    }
    expect(() => fence('spawn', ['x', [], { env: ok, shell: `${SYS32}\\bash.exe` }])).toThrow(/the WSL launcher/);
    expect(() => fence('spawn', [`${MSYS}\\bash.exe`, [], { env: ok }])).not.toThrow();
    expect(() => fence('spawn', ['/usr/bin/bash', [], { env: ok }]), 'MSYS2\'s bash in MSYS spelling').not.toThrow();
  });
  it('finds the options object in every call shape, or puts one in before the callback, and hands it the fenced env', () => {
    const ok = env(MSYS);
    const cb = (): void => {};
    const shapes: [typeof SPAWNERS[number], unknown[], number][] = [
      ['spawn', ['bash'], 1], ['spawn', ['bash', ['-c', 'x']], 2], ['spawn', ['bash', ['-c', 'x'], undefined], 2], ['spawnSync', ['bash', { cwd: '.' }], 1],
      ['execFile', ['bash', cb], 1], ['execFile', ['bash', ['-c', 'x'], cb], 2], ['execFile', ['bash', null, { cwd: '.' }, cb], 2],
      ['exec', ['bash -c x', cb], 1], ['execSync', ['bash -c x'], 1], ['execFileSync', ['bash', ['x'], { env: ok }], 2], ['fork', ['m.js'], 1],
    ];
    // a call with no env takes the worker's: here one that passes on every platform
    vi.stubEnv('PATH', MSYS);
    try {
      for (const [name, a, at] of shapes) {
        const out = fence(name, a);
        const o = out[at] as { env?: NodeJS.ProcessEnv; cwd?: string };
        expect(o.env, `${name} ${JSON.stringify(a)}`).toBeDefined();
        if (typeof a[a.length - 1] === 'function') expect(out[out.length - 1]).toBe(cb);
      }
    } finally { vi.unstubAllEnvs(); }
  });
});

describe.skipIf(process.platform === 'win32')('off Windows nothing is wrapped', () => {
  it('child_process\'s spawners are node\'s own', () => {
    for (const n of SPAWNERS) expect((cp as unknown as Record<string, Record<symbol, unknown>>)[n]![SPAWN_FENCED], n).toBeUndefined();
  });
});

describe.runIf(process.platform === 'win32')('the spawn fence on this box', () => {
  const launcher = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'bash.exe');

  it('every spawner is wrapped, through the default export and the ESM named imports alike', () => {
    for (const n of SPAWNERS) expect((cp as unknown as Record<string, Record<symbol, unknown>>)[n]![SPAWN_FENCED], n).toBe(true);
    expect((spawnSync as unknown as Record<symbol, unknown>)[SPAWN_FENCED]).toBe(true);
  });

  // The red measurement: with spawn-fence.setup.mjs out of vitest.config.ts, these calls start the WSL launcher.
  it.skipIf(!fs.existsSync(launcher))('a harness that builds its own PATH with System32 ahead of MSYS2 is refused by every spawner, before any start', () => {
    const home = mkTmp('ccrc-spawnfence-');
    try {
      const e = { ...process.env, HOME: home, PATH: `${home};${path.dirname(launcher)};${MSYS_BIN}` };
      const kill = (c: unknown): void => { (c as ChildProcess | undefined)?.kill?.(); };
      const calls: [string, () => unknown][] = [
        ['spawn', () => kill(cp.spawn('bash', ['--version'], { env: e }))],
        ['spawnSync', () => spawnSync('bash', ['--version'], { env: e })],
        ['execFile', () => kill(cp.execFile('bash', ['--version'], { env: e }, () => {}))],
        ['execFileSync', () => cp.execFileSync('bash', ['--version'], { env: e, stdio: 'ignore' })],
        ['exec', () => kill(cp.exec('bash --version', { env: e }, () => {}))],
        ['execSync', () => cp.execSync('bash --version', { env: e, stdio: 'ignore' })],
        ['fork', () => kill(cp.fork(path.join(home, 'none.mjs'), [], { env: e, stdio: 'ignore' }))],
        ['promisify(execFile)', () => { void promisify(execFile)('bash', ['--version'], { env: e }).catch(() => {}); }],
      ];
      for (const [n, call] of calls) expect(call, n).toThrow(/ccrc spawn fence: \w+ refused.*the WSL launcher/);
      expect(() => spawnSync(launcher, ['--version'], { env: { ...process.env } }), 'the launcher named as the file').toThrow(/the WSL launcher/);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('a stand-in directory glued onto MSYS2\'s by `:` is repaired: a bare bash is MSYS2\'s and keeps the fixture HOME (read-only)', () => {
    const home = mkTmp('ccrc-spawnfence-');
    try {
      const r = spawnSync('bash', ['-c', 'cygpath -w "$(command -v bash)"; cygpath -w "$HOME"'],
        { encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${home}:${process.env['PATH'] ?? ''}` } });
      const [bash, h] = r.stdout.split(/\r?\n/);
      expect(path.win32.dirname(bash ?? '').toLowerCase(), r.stderr).toBe(MSYS_BIN.toLowerCase());
      expect(h?.toLowerCase()).toBe(home.toLowerCase());
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});
