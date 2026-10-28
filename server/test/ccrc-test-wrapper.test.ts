// `ccrc test` (ccd/ccrc-test, D-TBD-test-containment): one test or typecheck command, run inside
// `ccrc-tests.slice` with the session's environment, behind the fleet-wide admission queue for heavy runs.
//
// Runs the real wrapper in a fixture HOME, never the live one. On Linux the service manager is a pair of stubs:
// `systemctl` logs its argv and answers `show` from fixture files, `systemd-run` logs its argv and execs the command
// after `--`, so a row can read what the wrapper asked for and still see the command run in this process tree. The
// queue rows run on both platforms (macOS runs the command uncontained, as the wrapper says) and need a real `flock`,
// which every Linux box has (util-linux, doctor's `flock` check); a box without one skips them.
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { itDarwin, itLinux, IS_DARWIN } from './platformFixtures.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = path.join(REPO, 'ccd', 'ccrc-test');
const SLICE_FILE = path.join(REPO, 'deploy', 'systemd', 'ccrc-tests.slice');
const HAS_FLOCK = spawnSync('sh', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
const itQueue = it.skipIf(!HAS_FLOCK);

const SYSTEMCTL = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/systemctl.log"
if [ "$1" = --user ] && [ "$2" = show ]; then
  if [ "$4" = -p ] && [ "$5" = LoadState ] && [ "$6" = --value ]; then
    if [ -f "$HOME/fixture-loadstate" ]; then cat "$HOME/fixture-loadstate"; else echo loaded; fi; exit 0
  fi
  if [ "$4" = -p ] && [ "$5" = ControlGroup ] && [ "$6" = --value ]; then
    [ -f "$HOME/fixture-cg" ] && cat "$HOME/fixture-cg"; exit 0
  fi
  [ -f "$HOME/fixture-slice-show" ] && cat "$HOME/fixture-slice-show"; exit 0
fi
if [ "$1" = --user ] && [ "$2" = set-property ]; then
  [ -f "$HOME/fixture-setprop-rc" ] && exit "$(cat "$HOME/fixture-setprop-rc")"; exit 0
fi
exit 0
`;
const SYSTEMD_RUN = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/systemd-run.log"
while [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done
shift
exec "$@"
`;

interface Box { home: string; env: NodeJS.ProcessEnv }
function box(extra: NodeJS.ProcessEnv = {}): Box {
  const home = mkTmp('ccrc-test-wrapper-');
  const bin = path.join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'systemctl'), SYSTEMCTL, { mode: 0o755 });
  writeFileSync(path.join(bin, 'systemd-run'), SYSTEMD_RUN, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_')) env[k] = v;
  Object.assign(env, { HOME: home, PATH: `${bin}:${process.env['PATH'] ?? ''}`, CCRC_TEST_POLL_S: '0.1' }, extra);
  return { home, env };
}
const run = (b: Box, args: string[], extra: NodeJS.ProcessEnv = {}) =>
  spawnSync('bash', [WRAPPER, ...args], { env: { ...b.env, ...extra }, encoding: 'utf8', cwd: b.home, timeout: 60000 });
const log = (b: Box, name: string): string => (existsSync(path.join(b.home, name)) ? readFileSync(path.join(b.home, name), 'utf8') : '');
const setProps = (b: Box): string => log(b, 'systemctl.log').split('\n').find((l) => l.startsWith('--user set-property')) ?? '';

/** A heavy-or-light run that marks `started-<tag>` and holds until `release-<tag>` exists. */
interface Held { proc: ChildProcess; stderr: () => string; exit: Promise<number | null> }
function hold(b: Box, tag: string, flags: string[] = ['--heavy'], extra: NodeJS.ProcessEnv = {}): Held {
  const script = `touch "$HOME/started-${tag}"; while [ ! -f "$HOME/release-${tag}" ]; do sleep 0.05; done`;
  const proc = spawn('bash', [WRAPPER, ...flags, '--', 'sh', '-c', script], { env: { ...b.env, ...extra }, cwd: b.home });
  let err = '';
  proc.stderr!.on('data', (d: Buffer) => { err += d.toString(); });
  const exit = new Promise<number | null>((res) => proc.on('exit', (c) => res(c)));
  return { proc, stderr: () => err, exit };
}
async function until(what: string, p: () => boolean, ms = 15000): Promise<void> {
  const t0 = Date.now();
  while (!p()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
const started = (b: Box, tag: string) => existsSync(path.join(b.home, `started-${tag}`));
const release = (b: Box, tag: string) => writeFileSync(path.join(b.home, `release-${tag}`), '');

describe('ccrc test: the slice (D-TBD-test-containment)', () => {
  itLinux('runs the command as a scope in ccrc-tests.slice, with the session environment, cwd and exit code', () => {
    const b = box();
    const r = run(b, ['--light', '--', 'sh', '-c', 'echo "$MARK:$CCRC_TEST_INSIDE:$(pwd -P)"; exit 7'], { MARK: 'session-env' });
    expect(r.stdout.trim()).toBe(`session-env:1:${b.home}`);
    expect(r.status).toBe(7);
    expect(log(b, 'systemd-run.log')).toMatch(/^--user --scope --quiet --collect --slice=ccrc-tests\.slice --unit=ccrc-test-\d+ --description=ccrc test: sh -c .* -- sh -c /m);
  });

  itLinux('applies the five limits at their defaults before the run', () => {
    const b = box();
    expect(run(b, ['--light', '--', 'true']).status).toBe(0);
    expect(setProps(b)).toBe('--user set-property --runtime ccrc-tests.slice MemoryMax=6G MemorySwapMax=1G CPUWeight=20 CPUQuota=400% IOWeight=20');
  });

  itLinux('takes each limit from the environment, else ~/.ccrc/ccrc.env, else the default', () => {
    const b = box();
    mkdirSync(path.join(b.home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(b.home, '.ccrc', 'ccrc.env'), 'CCRC_TEST_SLICE_CPU_QUOTA=200%\nCCRC_TEST_SLICE_MEMORY_MAX=3G\n');
    expect(run(b, ['--light', '--', 'true'], { CCRC_TEST_SLICE_MEMORY_MAX: '2G', CCRC_TEST_SLICE_IO_WEIGHT: '5' }).status).toBe(0);
    expect(setProps(b)).toBe('--user set-property --runtime ccrc-tests.slice MemoryMax=2G MemorySwapMax=1G CPUWeight=20 CPUQuota=200% IOWeight=5');
  });

  it.each([
    ['CCRC_TEST_SLICE_MEMORY_MAX', '6'], ['CCRC_TEST_SLICE_MEMORY_MAX', '0G'], ['CCRC_TEST_SLICE_MEMORY_MAX', 'infinity'],
    ['CCRC_TEST_SLICE_MEMORY_MAX', '101%'], ['CCRC_TEST_SLICE_SWAP_MAX', '1'], ['CCRC_TEST_SLICE_CPU_WEIGHT', '0'],
    ['CCRC_TEST_SLICE_CPU_WEIGHT', '10001'], ['CCRC_TEST_SLICE_CPU_QUOTA', '4'], ['CCRC_TEST_SLICE_IO_WEIGHT', 'x'],
    ['CCRC_TEST_HEAVY_SLOTS', '0'], ['CCRC_TEST_WIDE_FILES', '-1'], ['CCRC_TEST_PRESSURE_MAX', '100'],
  ])('%s=%s is not its shape: it keeps the default and warns, naming the key, value and source', (key, value) => {
    const b = box();
    const r = run(b, ['--classify', '--', 'true'], { [key]: value });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(`ccrc test: WARN: ${key}=${value} (from the environment) is not `);
    expect(r.stderr).toMatch(/; using its default \S+\n/);
  });

  itLinux('a bad limit never removes a cap: the default is applied in its place', () => {
    const b = box();
    expect(run(b, ['--light', '--', 'true'], { CCRC_TEST_SLICE_MEMORY_MAX: 'infinity' }).status).toBe(0);
    expect(setProps(b)).toContain('MemoryMax=6G');
  });

  itLinux('refuses a slice the user manager has not loaded, and the command never runs', () => {
    const b = box();
    writeFileSync(path.join(b.home, 'fixture-loadstate'), 'not-found\n');
    const r = run(b, ['--light', '--', 'touch', path.join(b.home, 'ran')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^ccrc test: refused, nothing ran: ccrc-tests\.slice is not loaded by the user manager \(LoadState=not-found\)/);
    expect(existsSync(path.join(b.home, 'ran'))).toBe(false);
    expect(log(b, 'systemd-run.log')).toBe('');
  });

  itLinux('refuses when the limits cannot be applied', () => {
    const b = box();
    writeFileSync(path.join(b.home, 'fixture-setprop-rc'), '1');
    const r = run(b, ['--light', '--', 'touch', path.join(b.home, 'ran')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refused, nothing ran: systemctl --user set-property ccrc-tests.slice');
    expect(existsSync(path.join(b.home, 'ran'))).toBe(false);
  });

  itLinux('a run that the slice cap kills is said so, with the cap and the setting that sets it', () => {
    const b = box();
    const cgroot = path.join(b.home, 'cgroot');
    mkdirSync(path.join(cgroot, 'user.slice', 'ccrc-tests.slice'), { recursive: true });
    const events = path.join(cgroot, 'user.slice', 'ccrc-tests.slice', 'memory.events');
    writeFileSync(events, 'low 0\nhigh 0\nmax 3\noom 2\noom_kill 2\n');
    writeFileSync(path.join(b.home, 'fixture-cg'), '/user.slice/ccrc-tests.slice\n');
    // The command stands in for the kernel: it raises the slice's count and dies by SIGKILL, as an OOM victim does.
    const r = run(b, ['--light', '--', 'sh', '-c', `printf 'oom_kill 3\\n' > '${events}'; kill -9 $$`], { CCRC_CGROUP_ROOT: cgroot, CCRC_TEST_SLICE_MEMORY_MAX: '64M' });
    expect(r.status).toBe(137);
    expect(r.stderr).toContain("ccrc test: the test slice's memory cap killed a process during this run (MemoryMax=64M, CCRC_TEST_SLICE_MEMORY_MAX; 1 OOM kill(s) in ccrc-tests.slice); exit 137");
    expect(r.stderr, 'bash\'s own job line is not printed').not.toMatch(/Killed/);
  });

  itLinux('a run that ends without an OOM kill says nothing about the cap', () => {
    const b = box();
    const cgroot = path.join(b.home, 'cgroot');
    mkdirSync(path.join(cgroot, 's'), { recursive: true });
    writeFileSync(path.join(cgroot, 's', 'memory.events'), 'oom_kill 5\n');
    writeFileSync(path.join(b.home, 'fixture-cg'), '/s\n');
    const r = run(b, ['--light', '--', 'sh', '-c', 'exit 3'], { CCRC_CGROUP_ROOT: cgroot });
    expect(r.status).toBe(3);
    expect(r.stderr).not.toContain('memory cap killed');
  });

  itDarwin('on macOS the command runs uncontained, saying so, and no service manager is asked', () => {
    const b = box();
    const r = run(b, ['--light', '--', 'sh', '-c', 'echo ran']);
    expect(r.stdout.trim()).toBe('ran');
    expect(r.stderr).toContain('no systemd user manager (macOS), so the run is not contained');
    expect(log(b, 'systemd-run.log')).toBe('');
  });

  it('the slice file holds the same five defaults the settings reader answers', () => {
    const unit = readFileSync(SLICE_FILE, 'utf8');
    const slice = Object.fromEntries([...unit.matchAll(/^(\w+)=(.*)$/gm)].map((m) => [m[1], m[2]]));
    const b = box();
    const out = spawnSync('bash', ['-c', `. "${path.join(REPO, 'ccd', 'ccrc')}"; _test_knobs`], { env: b.env, encoding: 'utf8' }).stdout;
    const def = Object.fromEntries(out.trim().split('\n').map((l) => l.split('\x1f')).map((f) => [f[0], f[1]]));
    expect(slice).toEqual({
      Description: 'ccrc test runs (ccrc test)',
      MemoryMax: def['CCRC_TEST_SLICE_MEMORY_MAX'], MemorySwapMax: def['CCRC_TEST_SLICE_SWAP_MAX'],
      CPUWeight: def['CCRC_TEST_SLICE_CPU_WEIGHT'], CPUQuota: def['CCRC_TEST_SLICE_CPU_QUOTA'], IOWeight: def['CCRC_TEST_SLICE_IO_WEIGHT'],
    });
    expect(unit, 'no aggregate MemoryHigh, ever (#72, #84)').not.toMatch(/^MemoryHigh=/m);
  });
});

describe('ccrc test: heavy or light (D-TBD-test-containment)', () => {
  it.each([
    ['npx vitest run --maxWorkers=2 test/foo.test.ts', 'light'],
    ['./node_modules/.bin/vitest run test/a.test.ts test/b.test.ts test/c.test.ts', 'light'],
    ['npx vitest run', 'heavy'],
    ['npx vitest run test/a.test.ts test/b.test.ts test/c.test.ts test/d.test.ts', 'heavy'],
    ['npx jest', 'heavy'],
    ['npx tsc --noEmit -p test/tsconfig.tests.json', 'heavy'],
    ['npm run typecheck', 'heavy'],
    ['npm test', 'heavy'],
    ['npm run test:browser', 'heavy'],
    ['npx playwright test', 'heavy'],
    ['npx stryker run', 'heavy'],
    ['npm run build', 'light'],
    ['git status', 'light'],
  ])('%s is %s', (cmd, want) => {
    expect(run(box(), ['--classify', '--', ...cmd.split(' ')]).stdout.trim()).toBe(want);
  });
  it('CCRC_TEST_WIDE_FILES moves the wide line', () => {
    expect(run(box(), ['--classify', '--', 'vitest', 'run', 'a.test.ts', 'b.test.ts'], { CCRC_TEST_WIDE_FILES: '1' }).stdout.trim()).toBe('heavy');
  });
  it('--heavy and --light override the reading', () => {
    expect(run(box(), ['--heavy', '--classify', '--', 'git', 'status']).stdout.trim()).toBe('heavy');
    expect(run(box(), ['--light', '--classify', '--', 'npx', 'tsc']).stdout.trim()).toBe('light');
  });
  it('a missing command is a usage error', () => {
    const r = run(box(), []);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('ccrc test: missing command');
  });
});

describe('ccrc test: the admission queue (D-TBD-test-containment)', () => {
  const slice = (b: Box) => writeFileSync(path.join(b.home, 'fixture-slice-show'),
    'LoadState=loaded\nMemoryCurrent=0\nMemoryMax=6442450944\nMemorySwapMax=1073741824\nCPUWeight=20\nCPUQuotaPerSecUSec=4s\nIOWeight=20\n');

  itQueue('a third heavy run waits while two run, says it is queued, and starts when one finishes', async () => {
    const b = box();
    slice(b);
    const a = hold(b, 'a');
    const c2 = hold(b, 'b');
    await until('two heavy runs to start', () => started(b, 'a') && started(b, 'b'));
    const c3 = hold(b, 'c');
    await until('the third to say it is queued', () => c3.stderr().includes('ccrc test: queued: all 2 heavy test slots are held'));
    expect(c3.stderr()).toMatch(/slot-\d: pid \d+ since \d\d:\d\d:\d\d: sh -c touch/);
    await new Promise((r) => setTimeout(r, 400));
    expect(started(b, 'c'), 'the third has not started').toBe(false);
    const st = run(b, ['--status']);
    expect(st.stdout).toContain('heavy slots 2 of 2 held, 1 waiting');
    release(b, 'a');
    expect(await a.exit).toBe(0);
    await until('the third to start', () => started(b, 'c'));
    expect(c3.stderr()).toMatch(/ccrc test: slot \d is free after \d+s; starting/);
    release(b, 'b'); release(b, 'c');
    expect(await c2.exit).toBe(0);
    expect(await c3.exit).toBe(0);
    expect(run(b, ['--status']).stdout).toContain('heavy slots 0 of 2 held, 0 waiting');
  });

  itQueue('a killed holder frees its slot', async () => {
    const b = box({ CCRC_TEST_HEAVY_SLOTS: '1' });
    slice(b);
    const a = hold(b, 'a');
    await until('the holder to start', () => started(b, 'a'));
    const w = hold(b, 'w');
    await until('the second to queue', () => w.stderr().includes('queued'));
    a.proc.kill('SIGKILL');
    await a.exit;
    await until('the waiter to take the freed slot', () => started(b, 'w'));
    release(b, 'a'); release(b, 'w');
    expect(await w.exit).toBe(0);
  });

  itQueue('a light run takes no slot', async () => {
    const b = box({ CCRC_TEST_HEAVY_SLOTS: '1' });
    slice(b);
    const a = hold(b, 'a');
    await until('the holder to start', () => started(b, 'a'));
    const l = hold(b, 'l', ['--light']);
    await until('the light run to start beside it', () => started(b, 'l'));
    expect(l.stderr()).not.toContain('queued');
    release(b, 'a'); release(b, 'l');
    await Promise.all([a.exit, l.exit]);
  });

  itQueue('a run inside a run is already contained: it neither queues nor opens a scope', async () => {
    const b = box({ CCRC_TEST_HEAVY_SLOTS: '1' });
    slice(b);
    const a = hold(b, 'a');
    await until('the holder to start', () => started(b, 'a'));
    const before = log(b, 'systemd-run.log');
    const r = run(b, ['--heavy', '--', 'sh', '-c', 'echo nested'], { CCRC_TEST_INSIDE: '1' });
    expect(r.stdout.trim()).toBe('nested');
    expect(log(b, 'systemd-run.log')).toBe(before);
    release(b, 'a');
    await a.exit;
  });

  itQueue('with CCRC_TEST_PRESSURE_MAX set, a heavy run waits while pressure is above it', async () => {
    const proc = mkTmp('ccrc-test-proc-');
    mkdirSync(path.join(proc, 'pressure'), { recursive: true });
    const psi = (v: string) => writeFileSync(path.join(proc, 'pressure', 'memory'), `some avg10=${v} avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=1\n`);
    psi('50.00');
    const b = box({ CCRC_TEST_PRESSURE_MAX: '20', CCRC_PROC_ROOT: proc });
    slice(b);
    const h = hold(b, 'p');
    await until('the run to wait on pressure', () => h.stderr().includes('queued: host memory pressure (avg10) is 50.00, above CCRC_TEST_PRESSURE_MAX=20'));
    expect(started(b, 'p')).toBe(false);
    psi('1.00');
    await until('the run to start once pressure falls', () => started(b, 'p'));
    release(b, 'p');
    expect(await h.exit).toBe(0);
  });
});

describe('ccrc test --status (D-TBD-test-containment)', () => {
  itLinux('names the live memory against the live cap, the other limits and the queue', () => {
    const b = box();
    writeFileSync(path.join(b.home, 'fixture-slice-show'),
      'LoadState=loaded\nMemoryCurrent=1610612736\nMemoryMax=6442450944\nMemorySwapMax=1073741824\nCPUWeight=20\nCPUQuotaPerSecUSec=4s\nIOWeight=20\n');
    const r = run(b, ['--status']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('ccrc-tests.slice holds 1.5G of its 6.0G memory cap, swap cap 1.0G, CPU weight 20, CPU quota 4s per second, IO weight 20; heavy slots 0 of 2 held, 0 waiting');
  });
  itLinux('a slice with no memory cap answers 2', () => {
    const b = box();
    writeFileSync(path.join(b.home, 'fixture-slice-show'), 'LoadState=loaded\nMemoryCurrent=0\nMemoryMax=infinity\n');
    const r = run(b, ['--status']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('ccrc-tests.slice holds 0B with no memory cap (MemoryMax=infinity)');
  });
  itLinux('a slice that is not loaded answers 2', () => {
    const b = box();
    writeFileSync(path.join(b.home, 'fixture-slice-show'), 'LoadState=not-found\n');
    const r = run(b, ['--status']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('ccrc-tests.slice is not loaded (LoadState=not-found), so ccrc test refuses every run');
  });
  it.skipIf(!IS_DARWIN)('on macOS it says runs are not contained', () => {
    expect(run(box(), ['--status']).stdout.trim()).toBe('no user manager here, so runs are not contained; heavy slots 0 of 2 held, 0 waiting');
  });
});
