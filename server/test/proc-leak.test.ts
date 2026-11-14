// proc-leak.test.ts — the suite's two leak guards, measured (#172, D-5894, D-5895).
//
//   * `proc-leak.globalsetup.mjs`: a nested real vitest under it, given a fixture test that leaks a child, EXITS 1
//     and names the child with its working directory, and the child is still alive: the check never signals what
//     it observes (D-3533). The same nested run with a fixture that leaks nothing exits 0. The nested run starts
//     in a process group of its own (`detached`), so its check sees only its own group; this test then ends that
//     group through the handle it holds, as `spawnSyncGroup` does.
//   * `spawnGroup.ts`: a timed-out child takes its grandchildren with it; a child that returns on its own but
//     leaves a member in its group makes the helper throw, and the member is dead afterwards; a caller that
//     declares it strands one on purpose (`strays: 'end'`) gets a normal return, and the member is dead too; and an
//     `input` reaches the child as a regular file that is gone from the temp root before the child runs (D-8381).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { groupAlive, killGroup, spawnSyncGroup } from './spawnGroup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VITEST = path.resolve(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
const CHECK = path.join(here, 'proc-leak.globalsetup.mjs');

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** A nested `vitest run` whose only globalSetup is the leak check, over one fixture test body. */
function nestedRun(body: string): { status: number | null; out: string; fx: string; pgid: number } {
  const fx = mkTmp('ccrc-procleak-');
  const config = { test: { globals: true, include: ['*.fx.test.mjs'], testTimeout: 30_000, globalSetup: [CHECK] } };
  writeFileSync(path.join(fx, 'vitest.config.mjs'), `export default ${JSON.stringify(config)};\n`);
  writeFileSync(path.join(fx, 'leak.fx.test.mjs'),
    `import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\n${body}\n`);
  // A plain detached spawnSync, not spawnSyncGroup: a leftover in the nested group is what the first case leaves
  // ON PURPOSE, and the caller ends it through `pgid` once it has looked.
  const opts = { cwd: fx, env: { ...process.env, CI: '1', FX_DIR: fx }, encoding: 'utf8' as const, timeout: 90_000,
    detached: true };
  const r = spawnSync(process.execPath, [VITEST, 'run', '--root', fx], opts);
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') killGroup(r.pid);
  expect(r.error, `the nested run did not finish: ${r.stdout}${r.stderr}`).toBeUndefined();
  return { status: r.status, out: `${r.stdout}${r.stderr}`, fx, pgid: r.pid };
}

describe('the run fails when a process a test started outlives it (proc-leak.globalsetup.mjs)', () => {
  it('a fixture that leaks a child: the run exits 1, names the child and its cwd, and never signals it', () => {
    // The leaked shape the reentrant-lock case produced: a forked child, left running after its parent returned.
    const n = nestedRun([
      "it('leaks', () => {",
      "  const r = spawnSync('sh', ['-c', 'sleep 47 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' });",
      "  writeFileSync(process.env.FX_DIR + '/leaked.pid', r.stdout.trim());",
      '});',
    ].join('\n'));
    try {
      expect(n.status, `a leaked child did not fail the run:\n${n.out}`).toBe(1);
      expect(n.out).toMatch(/1 process\(es\) a test started outlived the run and are still running/);
      expect(n.out).toMatch(/up [0-9:-]+: sleep 47/);
      // The cwd names where the leak came from; macOS spells a /var temp dir through /private.
      expect(n.out).toContain(`cwd ${realpathSync(n.fx)}`);
      const pid = Number(readFileSync(path.join(n.fx, 'leaked.pid'), 'utf8'));
      expect(pid).toBeGreaterThan(0);
      expect(alive(pid), 'the leak check signalled a PID it only observed (D-3533)').toBe(true);
    } finally {
      killGroup(n.pgid);
    }
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
    expect(groupAlive(n.pgid)).toBe(false);
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
    if (!gone) killGroup(r.pid); // through the group this case made, never the PID from the file (D-3533)
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
    // No kill of the PID from the file (D-3533): on a red the member is a bounded sleep.
    expect(gone, 'the helper threw but left the member running').toBe(true);
  });

  it('the stray error carries the child\'s exit status and output, so a nested run\'s own leak report reaches the failure (D-6112)', () => {
    let msg = '';
    try {
      spawnSyncGroup('sh', ['-c', 'sleep 3 >/dev/null 2>&1 & echo nested-out; echo nested-report >&2; exit 4'],
        { encoding: 'utf8', timeout: 10_000 });
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/left processes in its group/);
    expect(msg).toMatch(/status 4/);
    expect(msg).toContain('nested-out');
    expect(msg).toContain('nested-report');
  });

  it('a caller that strands a member ON PURPOSE (strays: end): the helper returns, and the member is dead', () => {
    const dir = mkTmp('ccrc-spawngroup-');
    const pidFile = path.join(dir, 'stranded.pid');
    const r = spawnSyncGroup('sh', ['-c', `sleep 61 >/dev/null 2>&1 & echo $! > "${pidFile}"; echo done`],
      { encoding: 'utf8', timeout: 10_000 }, { strays: 'end' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('done\n');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      gone = !alive(pid);
      if (!gone) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    expect(gone, 'strays: end returned but left the member running').toBe(true);
    expect(groupAlive(r.pid)).toBe(false);
  });

  it('a child that returns cleanly is returned untouched', () => {
    const r = spawnSyncGroup('sh', ['-c', 'echo ok'], { encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('ok\n');
    expect(r.error).toBeUndefined();
  });
});

// D-8381: on macOS a detached `spawnSync` given an `input` now and then delivers every byte and never the end of input,
// so the child waits on its stdin until the timeout. Linux cannot show that hang, so these cases pin the ROUTE that
// cannot lose the end: the child's stdin is a regular file holding every byte, and the file is gone when the call
// returns, on every path. Put the input back through `spawnSync`'s `input` and the first case is red.
describe('spawnSyncGroup: an input reaches the child from a regular file (D-8381)', () => {
  const STDIN_IS_A_FILE = 'test -f /dev/stdin || { echo "stdin is not a regular file" >&2; exit 3; }; wc -c';

  it('the child\'s stdin is a regular file holding every byte, empty, small and past a socket buffer', () => {
    for (const input of ['', 'x', 'y'.repeat(4096), 'z'.repeat(200 * 1024)]) {
      const r = spawnSyncGroup('sh', ['-c', STDIN_IS_A_FILE], { input, encoding: 'utf8', timeout: 30_000 });
      expect(r.error, `${input.length} bytes`).toBeUndefined();
      expect(r.status, `${input.length} bytes: ${r.stderr}`).toBe(0);
      expect(r.stdout.trim()).toBe(String(input.length));
    }
    // Bytes, not text, arrive as given: `od` reads the stdin itself, the one reader of it.
    const bytes = Buffer.from([0, 1, 2, 255, 10, 13]);
    const b = spawnSyncGroup('sh', ['-c', 'test -f /dev/stdin || exit 3; od -An -tu1'], { input: bytes, encoding: 'utf8', timeout: 30_000 });
    expect(b.status, b.stderr).toBe(0);
    expect(b.stdout.trim().split(/\s+/)).toEqual(['0', '1', '2', '255', '10', '13']);
  });

  it('a caller\'s stdout and stderr settings are kept beside the input', () => {
    const r = spawnSyncGroup('sh', ['-c', `${STDIN_IS_A_FILE}; echo to-stderr >&2`],
      { input: 'abc', encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('3');
    expect(r.stderr ?? '').toBe('');
  });

  it('nothing is left under the temp root while the child runs, or when the call returns, times out or throws', () => {
    const root = mkTmp('ccrc-spawngroup-root-');
    const was = process.env['TMPDIR'];
    process.env['TMPDIR'] = root;
    try {
      // The child's own TMPDIR is the same root, so it lists what the input left there while it runs.
      const ok = spawnSyncGroup('sh', ['-c', `${STDIN_IS_A_FILE}; ls -A "$TMPDIR"`], { input: 'q'.repeat(20_000), encoding: 'utf8', timeout: 30_000 });
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout.trim()).toBe('20000');
      expect(readdirSync(root)).toEqual([]);

      const late = spawnSyncGroup('sh', ['-c', 'cat >/dev/null; sleep 30'], { input: 'q', encoding: 'utf8', timeout: 1_000 });
      expect((late.error as NodeJS.ErrnoException | undefined)?.code).toBe('ETIMEDOUT');
      expect(readdirSync(root)).toEqual([]);

      expect(() => spawnSyncGroup('sh', ['-c', 'cat >/dev/null; sleep 37 >/dev/null 2>&1 &'],
        { input: 'q', encoding: 'utf8', timeout: 30_000 })).toThrow(/left processes in its group/);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      if (was === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = was;
    }
  });
});
