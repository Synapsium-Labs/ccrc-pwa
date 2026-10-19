// proc-leak.test.ts — the suite's two leak guards, measured (#172, D-5894, D-5895).
//
//   * `proc-leak.globalsetup.mjs`: a nested real vitest under it, given a fixture test that leaks a child, EXITS 1,
//     names the child, and leaves it dead; the same nested run with a fixture that leaks nothing exits 0. The
//     nested run starts in a process group of its own (through `spawnSyncGroup`), so its check sees only its own
//     group and cannot touch this run's processes.
//   * `spawnGroup.ts`: a timed-out child takes its grandchildren with it; a child that returns on its own but
//     leaves a member in its group makes the helper throw, and the member is dead afterwards.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { groupAlive, spawnSyncGroup } from './spawnGroup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VITEST = path.resolve(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
const CHECK = path.join(here, 'proc-leak.globalsetup.mjs');

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** A nested `vitest run` whose only globalSetup is the leak check, over one fixture test body. */
function nestedRun(body: string): { status: number | null; out: string; fx: string } {
  const fx = mkTmp('ccrc-procleak-');
  const config = { test: { globals: true, include: ['*.fx.test.mjs'], testTimeout: 30_000, globalSetup: [CHECK] } };
  writeFileSync(path.join(fx, 'vitest.config.mjs'), `export default ${JSON.stringify(config)};\n`);
  writeFileSync(path.join(fx, 'leak.fx.test.mjs'),
    `import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\n${body}\n`);
  const r = spawnSyncGroup(process.execPath, [VITEST, 'run', '--root', fx],
    { cwd: fx, env: { ...process.env, CI: '1', FX_DIR: fx }, encoding: 'utf8', timeout: 90_000 });
  expect(r.error, `the nested run did not finish: ${r.stdout}${r.stderr}`).toBeUndefined();
  return { status: r.status, out: `${r.stdout}${r.stderr}`, fx };
}

describe('the run fails when a process a test started outlives it (proc-leak.globalsetup.mjs)', () => {
  it('a fixture that leaks a child: the run exits 1, names the child, and the child is dead', () => {
    // The leaked shape the reentrant-lock case produced: a forked child, left running after its parent returned.
    const n = nestedRun([
      "it('leaks', () => {",
      "  const r = spawnSync('sh', ['-c', 'sleep 47 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' });",
      "  writeFileSync(process.env.FX_DIR + '/leaked.pid', r.stdout.trim());",
      '});',
    ].join('\n'));
    expect(n.status, `a leaked child did not fail the run:\n${n.out}`).toBe(1);
    expect(n.out).toMatch(/1 process\(es\) a test started outlived the run, now killed:/);
    expect(n.out).toMatch(/sleep 47/);
    const pid = Number(readFileSync(path.join(n.fx, 'leaked.pid'), 'utf8'));
    expect(pid).toBeGreaterThan(0);
    expect(alive(pid), 'the leak check named the child but left it running').toBe(false);
  });

  it('a fixture that leaks nothing: the run exits 0 and reports nothing', () => {
    const n = nestedRun([
      "it('clean', () => {",
      "  const r = spawnSync('sh', ['-c', 'sleep 0.1 & wait'], { encoding: 'utf8' });",
      '  if (r.status !== 0) throw new Error(String(r.status));',
      '});',
    ].join('\n'));
    expect(n.status, n.out).toBe(0);
    expect(n.out).not.toMatch(/outlived the run/);
  });
});

describe('spawnSyncGroup: a child that can fork runs in its own process group (spawnGroup.ts)', () => {
  it('a timed-out child takes its grandchild with it', () => {
    const dir = mkTmp('ccrc-spawngroup-');
    const pidFile = path.join(dir, 'grandchild.pid');
    const r = spawnSyncGroup('sh', ['-c', `sleep 53 & echo $! > "${pidFile}"; wait`],
      { encoding: 'utf8', timeout: 1_000 });
    expect((r.error as NodeJS.ErrnoException | undefined)?.code).toBe('ETIMEDOUT');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      gone = !alive(pid);
      if (!gone) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    if (!gone) process.kill(pid, 'SIGKILL');
    expect(gone, 'the grandchild outlived the timeout').toBe(true);
    expect(groupAlive(r.pid)).toBe(false);
  });

  it('a child that returns but leaves a member in its group: the helper throws and the member is dead', () => {
    const dir = mkTmp('ccrc-spawngroup-');
    const pidFile = path.join(dir, 'left.pid');
    expect(() => spawnSyncGroup('sh', ['-c', `sleep 59 >/dev/null 2>&1 & echo $! > "${pidFile}"`],
      { encoding: 'utf8', timeout: 10_000 })).toThrow(/left processes in its group/);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      gone = !alive(pid);
      if (!gone) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    if (!gone) process.kill(pid, 'SIGKILL');
    expect(gone, 'the helper threw but left the member running').toBe(true);
  });

  it('a child that returns cleanly is returned untouched', () => {
    const r = spawnSyncGroup('sh', ['-c', 'echo ok'], { encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('ok\n');
    expect(r.error).toBeUndefined();
  });
});
