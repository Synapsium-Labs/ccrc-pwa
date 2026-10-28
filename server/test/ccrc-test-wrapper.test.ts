// `ccrc test` (ccd/ccrc-test, D-TBD-test-containment): one test or typecheck command, run inside
// `ccrctests.slice` with the session's environment, behind the fleet-wide admission queue for heavy runs.
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
import { itDarwin, itLinux, IS_DARWIN, platformContrast } from './platformFixtures.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = path.join(REPO, 'ccd', 'ccrc-test');
const SLICE_FILE = path.join(REPO, 'deploy', 'systemd', 'ccrctests.slice');
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
if [ "$1" = --user ] && [ "$2" = stop ]; then
  # A scope's stop ends every process in it: the stub ends every pid its systemd-run stub filed for that unit.
  u="\${3%.scope}"; [ -f "$HOME/$u.pids" ] && while read -r p; do kill -KILL "$p" 2>/dev/null; done < "$HOME/$u.pids"; exit 0
fi
if [ "$1" = --user ] && [ "$2" = set-property ]; then
  [ -f "$HOME/fixture-setprop-rc" ] && exit "$(cat "$HOME/fixture-setprop-rc")"; exit 0
fi
exit 0
`;
const SYSTEMD_RUN = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/systemd-run.log"
for a in "$@"; do case "$a" in --unit=*) echo $$ >> "$HOME/\${a#--unit=}.pids" ;; --) break ;; esac; done
while [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done
shift
exec "$@"
`;

interface Box { home: string; env: NodeJS.ProcessEnv }
/** A fixture box. `settings` is the box's ~/.ccrc/ccrc.env, one `KEY=value` line each: the slot count and the five
 *  slice limits hold for the whole box, so they are read from that file alone, never from a caller's environment. */
function box(extra: NodeJS.ProcessEnv = {}, settings: Record<string, string> = {}): Box {
  const home = mkTmp('ccrc-test-wrapper-');
  if (Object.keys(settings).length > 0) {
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), Object.entries(settings).map(([k, v]) => `${k}=${v}\n`).join(''));
  }
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
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pidsOf = (b: Box, file: string): number[] => log(b, file).split('\n').filter(Boolean).map(Number);
const started = (b: Box, tag: string) => existsSync(path.join(b.home, `started-${tag}`));
const release = (b: Box, tag: string) => writeFileSync(path.join(b.home, `release-${tag}`), '');

describe('ccrc test: the slice (D-TBD-test-containment)', () => {
  // Nothing is added to the run's environment: `already inside` is read from the cgroup, never from a variable.
  itLinux('runs the command as a scope in ccrctests.slice, with the session environment, cwd and exit code', () => {
    const b = box();
    const r = run(b, ['--light', '--', 'sh', '-c', 'echo "$MARK:${CCRC_TEST_INSIDE-unset}:$(pwd -P)"; exit 7'], { MARK: 'session-env' });
    expect(r.stdout.trim()).toBe(`session-env:unset:${b.home}`);
    expect(r.status).toBe(7);
    expect(log(b, 'systemd-run.log')).toMatch(/^--user --scope --quiet --collect --slice=ccrctests\.slice --unit=ccrc-test-\d+ --description=ccrc test: sh -c .* -- sh -c /m);
  });

  itLinux('applies the five limits at their defaults before the run', () => {
    const b = box();
    expect(run(b, ['--light', '--', 'true']).status).toBe(0);
    expect(setProps(b)).toBe('--user set-property --runtime ccrctests.slice MemoryMax=6G MemorySwapMax=1G CPUWeight=20 CPUQuota=400% IOWeight=20');
  });

  // The slice is one for the whole box: a caller whose environment set a limit would change it, through
  // set-property, for every run on the box. So each limit is read from ~/.ccrc/ccrc.env alone, else the default.
  itLinux('takes each limit from ~/.ccrc/ccrc.env, else the default, never from the caller\'s environment', () => {
    const b = box({}, { CCRC_TEST_SLICE_CPU_QUOTA: '200%', CCRC_TEST_SLICE_MEMORY_MAX: '3G' });
    const r = run(b, ['--light', '--', 'true'], { CCRC_TEST_SLICE_MEMORY_MAX: '100%', CCRC_TEST_SLICE_IO_WEIGHT: '5' });
    expect(r.status).toBe(0);
    expect(setProps(b)).toBe('--user set-property --runtime ccrctests.slice MemoryMax=3G MemorySwapMax=1G CPUWeight=20 CPUQuota=200% IOWeight=20');
    expect(r.stderr).toContain('ccrc test: WARN: CCRC_TEST_SLICE_MEMORY_MAX=100% in the environment is ignored: it holds for the whole box, so only ~/.ccrc/ccrc.env sets it (in use: 3G)');
    expect(r.stderr).toContain('ccrc test: WARN: CCRC_TEST_SLICE_IO_WEIGHT=5 in the environment is ignored: it holds for the whole box, so only ~/.ccrc/ccrc.env sets it (in use: 20)');
  });

  itLinux('an environment value equal to the file\'s says nothing', () => {
    const b = box({}, { CCRC_TEST_SLICE_MEMORY_MAX: '3G' });
    const r = run(b, ['--light', '--', 'true'], { CCRC_TEST_SLICE_MEMORY_MAX: '3G' });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('WARN');
  });

  it.each([
    ['CCRC_TEST_SLICE_MEMORY_MAX', '6'], ['CCRC_TEST_SLICE_MEMORY_MAX', '0G'], ['CCRC_TEST_SLICE_MEMORY_MAX', 'infinity'],
    ['CCRC_TEST_SLICE_MEMORY_MAX', '101%'], ['CCRC_TEST_SLICE_SWAP_MAX', '1'], ['CCRC_TEST_SLICE_CPU_WEIGHT', '0'],
    ['CCRC_TEST_SLICE_CPU_WEIGHT', '10001'], ['CCRC_TEST_SLICE_CPU_QUOTA', '4'], ['CCRC_TEST_SLICE_IO_WEIGHT', 'x'],
    ['CCRC_TEST_HEAVY_SLOTS', '0'], ['CCRC_TEST_WIDE_FILES', '-1'],
  ])('%s=%s is not its shape: it keeps the default and warns, naming the key, value and file', (key, value) => {
    const b = box({}, { [key]: value });
    const r = run(b, ['--classify', '--', 'true']);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(`ccrc test: WARN: ${key}=${value} (from the ~/.ccrc/ccrc.env) is not `);
    expect(r.stderr).toMatch(/; using its default \S+\n/);
  });
  it.each([
    ['CCRC_TEST_PRESSURE_MAX', '100'],
  ])('%s=%s is not its shape: it keeps the default and warns, naming the key, value and source', (key, value) => {
    const b = box();
    const r = run(b, ['--classify', '--', 'true'], { [key]: value });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(`ccrc test: WARN: ${key}=${value} (from the environment) is not `);
    expect(r.stderr).toMatch(/; using its default \S+\n/);
  });

  itLinux('a bad limit never removes a cap: the default is applied in its place', () => {
    const b = box();
    mkdirSync(path.join(b.home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(b.home, '.ccrc', 'ccrc.env'), 'CCRC_TEST_SLICE_MEMORY_MAX=infinity\n');
    expect(run(b, ['--light', '--', 'true']).status).toBe(0);
    expect(setProps(b)).toContain('MemoryMax=6G');
  });

  // NO RATCHET WITHOUT AN ESCAPE. The session hook denies a bare heavy run and a systemd-run of one's own, and sends
  // the call here; so `ccrc test` must run what it is given on every box, never refuse it. Where the slice cannot be
  // used (a deploy window before daemon-reload, a missing unit file) it degrades: the run is uncontained, says so
  // once, and still takes its turn in the queue. `--slice=` of a slice the manager has not loaded is never asked for,
  // since that makes a transient slice with no limits at all.
  itLinux('a slice the user manager has not loaded: the run degrades, uncontained but queued, and says so', () => {
    const b = box({}, { CCRC_TEST_HEAVY_SLOTS: '1' });
    writeFileSync(path.join(b.home, 'fixture-loadstate'), 'not-found\n');
    const r = run(b, ['--heavy', '--', 'sh', '-c', `ls "$HOME/.cc-sessions/test-slots" > "$HOME/slots"; exit 4`]);
    expect(r.status, 'the command ran, and its exit code is the run\'s').toBe(4);
    expect(r.stderr).toMatch(/^ccrc test: WARN: the run is NOT contained: ccrctests\.slice is not loaded by the user manager \(LoadState=not-found\).*; it still takes its turn in the queue$/m);
    expect(readFileSync(path.join(b.home, 'slots'), 'utf8'), 'the heavy run held a slot').toMatch(/^slot-0$/m);
    expect(log(b, 'systemd-run.log'), 'no transient slice is made').toBe('');
  });

  itLinux('no service manager tools on PATH: the run degrades the same way', () => {
    const b = box();
    const r = run(b, ['--light', '--', 'sh', '-c', 'echo ran'], { PATH: `/usr/bin:/bin` });
    expect(r.stdout.trim()).toBe('ran');
    expect(r.stderr).toContain('ccrc test: WARN: the run is NOT contained: systemctl or systemd-run is not on PATH');
  });

  itLinux('limits that cannot be applied: the run is still in the slice, under its unit file\'s own limits, and says so', () => {
    const b = box();
    writeFileSync(path.join(b.home, 'fixture-setprop-rc'), '1');
    const r = run(b, ['--light', '--', 'sh', '-c', 'echo ran']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('ran');
    expect(r.stderr).toContain("ccrc test: WARN: systemctl --user set-property ccrctests.slice MemoryMax=6G MemorySwapMax=1G CPUWeight=20 CPUQuota=400% IOWeight=20 failed, so the run is in ccrctests.slice under its unit file's own limits");
    expect(log(b, 'systemd-run.log')).toMatch(/--slice=ccrctests\.slice/);
  });

  itLinux('a run that the slice cap kills is said so, with the cap and the setting that sets it', () => {
    const b = box({}, { CCRC_TEST_SLICE_MEMORY_MAX: '64M' });
    const cgroot = path.join(b.home, 'cgroot');
    mkdirSync(path.join(cgroot, 'user.slice', 'ccrctests.slice'), { recursive: true });
    const events = path.join(cgroot, 'user.slice', 'ccrctests.slice', 'memory.events');
    writeFileSync(events, 'low 0\nhigh 0\nmax 3\noom 2\noom_kill 2\n');
    writeFileSync(path.join(b.home, 'fixture-cg'), '/user.slice/ccrctests.slice\n');
    // The command stands in for the kernel: it raises the slice's count and dies by SIGKILL, as an OOM victim does.
    const r = run(b, ['--light', '--', 'sh', '-c', `printf 'oom_kill 3\\n' > '${events}'; kill -9 $$`], { CCRC_CGROUP_ROOT: cgroot });
    expect(r.status).toBe(137);
    expect(r.stderr).toContain("ccrc test: the test slice's memory cap killed a process during this run (MemoryMax=64M, CCRC_TEST_SLICE_MEMORY_MAX; 1 OOM kill(s) in ccrctests.slice); exit 137");
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

  // A dash in a slice name is nesting in systemd: `a-b.slice` sits inside `a.slice`, which systemd makes implicitly at
  // the default weight 100. The weights only compete among siblings, so the slice must be top-level, beside app.slice
  // (where every session, its pane scopes and ccrc-agent live), for CPUWeight and IOWeight to hold tests below them.
  it('the slice is top-level: its name has no dash, so its CPU and IO weights compete with app.slice itself', () => {
    const name = readFileSync(WRAPPER, 'utf8').match(/^SLICE=(\S+)$/m)?.[1] ?? '';
    expect(name).toMatch(/^[a-z0-9]+\.slice$/);
    expect(path.basename(SLICE_FILE)).toBe(name);
    expect(existsSync(SLICE_FILE), 'the unit file ships under the name the wrapper runs in').toBe(true);
    expect(readFileSync(path.join(REPO, 'ccd', 'ccrc'), 'utf8'), 'install places the same name').toContain(`deploy/systemd/${name}"`);
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
    // A flag's value is not a test file, and only a named test file counts toward the wide line: a directory, a glob
    // or a name filter is wide.
    ['npx vitest run --config vitest.config.ts', 'heavy'],
    ['npx vitest run -c vitest.config.mts', 'heavy'],
    ['npx vitest run --config vitest.config.ts test/foo.test.ts', 'light'],
    ['npx vitest run --project server -t name test/foo.test.ts', 'light'],
    ['npx vitest run server/test', 'heavy'],
    ['npx vitest run test/', 'heavy'],
    ['npx vitest run test/*.test.ts', 'heavy'],
    ['npx vitest run foo', 'heavy'],
    ['npx vitest run test/foo.spec.ts', 'light'],
    ['npx vitest run --browser test/foo.test.ts', 'heavy'],
    ['node node_modules/vitest/vitest.mjs run', 'heavy'],
    ['node node_modules/jest/bin/jest.js', 'heavy'],
    ['npm t', 'heavy'],
    ['npm run t', 'heavy'],
    ['npm --prefix server test', 'heavy'],
    ['yarn test:unit', 'heavy'],
    ['pnpm t', 'heavy'],
    ['npm install -D vitest', 'light'],
    ['npx playwright install chromium', 'light'],
    ['env -u GIT_DIR npx vitest run', 'heavy'],
    ['timeout 600 npx tsc --noEmit', 'heavy'],
    // A prefix that runs the rest as its command is dropped, as `env` is: systemd-run (its value flags skipped), setsid,
    // flock <file>, sudo -u <user>, xargs; and `make` runs the suite by its test or check target.
    ['systemd-run --user --scope -p MemoryMax=8G --unit t1 -- npx vitest run', 'heavy'],
    ['setsid npx tsc --noEmit', 'heavy'],
    ['flock /tmp/l npx vitest run', 'heavy'],
    ['sudo -u ci npx vitest run', 'heavy'],
    ['make test', 'heavy'],
    ['make -C server check', 'heavy'],
    ['make build', 'light'],
  ])('%s is %s', (cmd, want) => {
    expect(run(box(), ['--classify', '--', ...cmd.split(' ')]).stdout.trim()).toBe(want);
  });
  // A shell's -c string is read as a script: each simple command in it, in command position.
  it.each([
    [['sh', '-c', 'npx vitest run'], 'heavy'],
    [['bash', '-c', 'cd server && npx tsc --noEmit -p test/tsconfig.tests.json'], 'heavy'],
    [['bash', '-lc', 'env -u GIT_DIR npx vitest run --maxWorkers=2 test/'], 'heavy'],
    [['sh', '-c', 'npx vitest run test/foo.test.ts; echo done'], 'light'],
    [['sh', '-c', 'echo "npx vitest run" > notes.txt'], 'light'],
    [['sh', '-c', "git commit -m 'typecheck the tests'"], 'light'],
  ])('%j is %s', (argv, want) => {
    expect(run(box(), ['--classify', '--', ...argv]).stdout.trim()).toBe(want);
  });
  // --classify-shell reads a whole Bash command line, as the session hook hands it over: heavy when a simple command in
  // it starts a heavy test or typecheck in command position outside `ccrc test`.
  it.each([
    ['npx vitest run', 'heavy'],
    ['cd server && npx tsc --noEmit -p test/tsconfig.tests.json', 'heavy'],
    ['npm test 2>&1 | tail -5', 'heavy'],
    ['env -u GIT_DIR -u GIT_WORK_TREE npx vitest run --maxWorkers=2', 'heavy'],
    ["tmux new-window 'npx vitest run'", 'heavy'],
    ['(cd server; npm run typecheck)', 'heavy'],
    ['echo $(npx tsc --noEmit)', 'heavy'],
    ['ccrc test -- npx vitest run', 'light'],
    ['cd server && ccrc test -- npx tsc --noEmit -p test/tsconfig.tests.json', 'light'],
    ['npx vitest run --maxWorkers=2 test/foo.test.ts', 'light'],
    ['grep -rn vitest server/test', 'light'],
    ["git commit -m 'npx vitest run; npm test'", 'light'],
    ['cat README.md # npx tsc', 'light'],
    ['npm run build > build.log 2>&1', 'light'],
    // Prefixes and shell strings that run the rest as a command are read through, so none of them hides a heavy run.
    ['setsid npx vitest run', 'heavy'],
    ['ls | xargs -I {} npx vitest run {}', 'heavy'],
    ['find test -name "*.test.ts" | xargs -n 50 npx vitest run', 'heavy'],
    ['flock /tmp/l npx vitest run', 'heavy'],
    ["flock -w 5 /tmp/l -c 'npm test'", 'heavy'],
    ['watch -n 5 npm test', 'heavy'],
    ['sudo -u ci npx tsc --noEmit', 'heavy'],
    ["script -qc 'npx vitest run' /dev/null", 'heavy'],
    ['eval "npx vitest run"', 'heavy'],
    ['nice -n 5 setsid timeout 600 npx tsc', 'heavy'],
    ['make test', 'heavy'],
    ['make -j4 -C server typecheck', 'heavy'],
    ['flock /tmp/l npx vitest run test/foo.test.ts', 'light'],
    ['sudo -u ci ls', 'light'],
    ['watch -n 5 git status', 'light'],
    ['ls | xargs echo', 'light'],
    ['make build', 'light'],
    // WRAPPED: a systemd-run of one's own around ANY test or typecheck, light or heavy, escapes the slice's caps and the
    // queue, so the hook denies it on every session. A quoted command word is the same word, and a systemd-run around
    // `ccrc test` or around no test at all is not wrapped.
    ['"systemd-run" --user --scope npx vitest run', 'wrapped'],
    ['systemd-run --user --scope bun test', 'wrapped'],
    ['systemd-run --user --scope npm t', 'wrapped'],
    ['systemd-run --user --scope npm --prefix server test', 'wrapped'],
    ['systemd-run --user --scope pnpm -r test', 'wrapped'],
    ['systemd-run --user --scope tsgo -p .', 'wrapped'],
    ['systemd-run --user --scope make test', 'wrapped'],
    ['systemd-run --user --scope npx vitest run test/foo.test.ts', 'wrapped'],
    ['systemd-run --user --scope --unit t1 -p MemoryMax=8G -E A=1 --description x --slice app.slice npx vitest run test/foo.test.ts', 'wrapped'],
    ['/usr/bin/systemd-run --user --scope -- ./node_modules/.bin/vitest run test/foo.test.ts', 'wrapped'],
    ["sh -c 'systemd-run --user --scope npx tsc'", 'wrapped'],
    ['npx tsc --noEmit; systemd-run --user --scope npx vitest run test/foo.test.ts', 'wrapped'],
    ['S=systemd-run; $S --user --scope npx vitest run', 'wrapped'],
    ['S=systemd-run; $S --user --scope npx vitest run test/foo.test.ts', 'wrapped'],
    ['systemd-run --user --scope sleep 1', 'light'],
    ['systemd-run --user --scope ccrc test -- npx vitest run', 'light'],
    // `ccrc test` around a systemd-run of one's own is the same escape: the inner systemd-run moves the run out of the
    // slice the wrapper put it in. Its inner command is read through the same wrapped check.
    ['ccrc test -- systemd-run --user --scope npx vitest run', 'wrapped'],
    ['ccrc test --heavy -- systemd-run --user --scope -- npx tsc --noEmit', 'wrapped'],
    ['cd server && ccrc test -- /usr/bin/systemd-run --user --scope npx vitest run test/foo.test.ts', 'wrapped'],
    ['ccrc test -- env -u GIT_DIR systemd-run --user --scope npm test', 'wrapped'],
    ["ccrc test -- sh -c 'systemd-run --user --scope npx tsc'", 'wrapped'],
    ['ccrc-test -- systemd-run --user --scope npx vitest run', 'wrapped'],
    ['ccrc test -- systemd-run --user --scope sleep 1', 'light'],
    ["ccrc test -- sh -c 'npx vitest run'", 'light'],
  ])('--classify-shell %s is %s', (line, want) => {
    expect(run(box(), ['--classify-shell', '--', line]).stdout.trim()).toBe(want);
  });
  it('--classify-shell takes exactly one string', () => {
    expect(run(box(), ['--classify-shell', '--', 'npx', 'tsc']).status).toBe(2);
  });
  // The wide line decides which runs queue for the whole box, so it is the box's, as the slot count is: read from
  // ~/.ccrc/ccrc.env alone. A session whose environment set it would read its own wide runs as light.
  it('CCRC_TEST_WIDE_FILES in ~/.ccrc/ccrc.env moves the wide line', () => {
    expect(run(box({}, { CCRC_TEST_WIDE_FILES: '1' }), ['--classify', '--', 'vitest', 'run', 'a.test.ts', 'b.test.ts']).stdout.trim()).toBe('heavy');
  });
  it('CCRC_TEST_WIDE_FILES in the caller\'s environment is ignored, with a warning', () => {
    const r = run(box(), ['--classify', '--', 'vitest', 'run', 'a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'], { CCRC_TEST_WIDE_FILES: '10' });
    expect(r.stdout.trim()).toBe('heavy');
    expect(r.stderr).toContain('ccrc test: WARN: CCRC_TEST_WIDE_FILES=10 in the environment is ignored: it holds for the whole box, so only ~/.ccrc/ccrc.env sets it (in use: 3)');
  });
  it('--heavy overrides the reading', () => {
    expect(run(box(), ['--heavy', '--classify', '--', 'git', 'status']).stdout.trim()).toBe('heavy');
  });
  // --light can only confirm a light reading: a heavy command run with it still queues, so a session that reached for
  // --light by habit never runs a whole suite beside the box's heavy runs. It says so in one line and runs.
  it('--light is honoured when the reading is light, and says nothing', () => {
    const r = run(box(), ['--light', '--classify', '--', 'npx', 'vitest', 'run', 'test/foo.test.ts']);
    expect(r.stdout.trim()).toBe('light');
    expect(r.stderr).toBe('');
  });
  it.each([[['npx', 'tsc']], [['npx', 'vitest', 'run']], [['npm', 'test']]])('--light on %j, which reads heavy, is ignored with a one-line note', (argv) => {
    const r = run(box(), ['--light', '--classify', '--', ...argv]);
    expect(r.stdout.trim()).toBe('heavy');
    expect(r.stderr).toBe('ccrc test: --light is ignored: this command reads as heavy, so it takes its turn in the heavy queue\n');
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

  platformContrast('a holder killed by SIGKILL', {
    // No cgroup holds an uncontained run's tree, so its slot can only follow the wrapper.
    darwin: ['uncontained, its slot follows the wrapper and frees at once', async () => {
      if (!HAS_FLOCK) return;
      const b = box({}, { CCRC_TEST_HEAVY_SLOTS: '1' });
      const a = hold(b, 'a');
      await until('the holder to start', () => started(b, 'a'));
      const w = hold(b, 'w');
      await until('the second to queue', () => w.stderr().includes('queued'));
      a.proc.kill('SIGKILL');
      await a.exit;
      await until('the waiter to take the freed slot', () => started(b, 'w'));
      release(b, 'a'); release(b, 'w');
      expect(await w.exit).toBe(0);
    }],
    // The slot is the run's: the command holds the lock, so a killed wrapper's run is still counted, and the next
    // waiter stops that orphaned run's scope before it takes the slot. Two heavy runs are never live under one slot.
    linux: ['its run keeps the slot until a waiter stops the orphaned scope', async () => {
      if (!HAS_FLOCK) return;
      const b = box({}, { CCRC_TEST_HEAVY_SLOTS: '1' });
      slice(b);
      const a = hold(b, 'a');
      await until('the holder to start', () => started(b, 'a'));
      const apid = a.proc.pid!;
      const [cmd] = pidsOf(b, `ccrc-test-${apid}.pids`);
      expect(cmd, 'the run\'s command pid').toBeGreaterThan(0);
      a.proc.kill('SIGKILL');
      await a.exit;
      const w = hold(b, 'w');
      await until('the waiter to take the slot', () => started(b, 'w'));
      expect(alive(cmd!), 'the orphaned run is gone before the waiter starts').toBe(false);
      expect(log(b, 'systemctl.log')).toContain(`--user stop ccrc-test-${apid}.scope`);
      expect(w.stderr()).toContain(`ccrc test: slot-0's holder (pid ${apid}) is gone; stopping its run ccrc-test-${apid}.scope`);
      release(b, 'w');
      expect(await w.exit).toBe(0);
    }],
  });

  // The slot count bounds the whole box only when every caller counts the same number: it is read from the box's
  // ccrc.env alone, so a session whose environment says 10 still waits behind the box's one slot.
  itQueue('two callers whose environments set different slot counts both count the box\'s', async () => {
    const b = box({}, { CCRC_TEST_HEAVY_SLOTS: '1' });
    slice(b);
    const a = hold(b, 'a', ['--heavy'], { CCRC_TEST_HEAVY_SLOTS: '1' });
    await until('the holder to start', () => started(b, 'a'));
    const w = hold(b, 'w', ['--heavy'], { CCRC_TEST_HEAVY_SLOTS: '10' });
    await until('the second to queue', () => w.stderr().includes('ccrc test: queued: all 1 heavy test slots are held'));
    expect(w.stderr()).toContain('CCRC_TEST_HEAVY_SLOTS=10 in the environment is ignored');
    await new Promise((r) => setTimeout(r, 400));
    expect(started(b, 'w'), 'the second waits behind the box\'s one slot').toBe(false);
    release(b, 'a');
    await until('the second to start', () => started(b, 'w'));
    release(b, 'w');
    expect(await w.exit).toBe(0);
  });

  // A slot above the count (held from before the count was lowered) is still a heavy run on the box.
  itQueue('a held slot above the slot count is counted: a lowered count never admits one run too many', async () => {
    const b = box({}, { CCRC_TEST_HEAVY_SLOTS: '1' });
    slice(b);
    const dir = path.join(b.home, '.cc-sessions', 'test-slots');
    mkdirSync(dir, { recursive: true });
    const holder = spawn('flock', [path.join(dir, 'slot-3'), 'sh', '-c', `touch "${b.home}/held-3"; while [ ! -f "${b.home}/release-3" ]; do sleep 0.05; done`], { env: b.env });
    const done = new Promise((res) => holder.on('exit', res));
    await until('slot-3 to be held', () => existsSync(path.join(b.home, 'held-3')));
    const w = hold(b, 'w');
    await until('the run to queue behind slot-3', () => w.stderr().includes('ccrc test: queued: all 1 heavy test slots are held (slot-3: unknown)'));
    await new Promise((r) => setTimeout(r, 400));
    expect(started(b, 'w'), 'slot-0 is free, but the box already runs its one heavy run').toBe(false);
    writeFileSync(path.join(b.home, 'release-3'), '');
    await done;
    await until('the run to start once slot-3 frees', () => started(b, 'w'));
    release(b, 'w');
    expect(await w.exit).toBe(0);
  });

  itQueue('a queued run that is signalled leaves the queue and never runs its command', async () => {
    for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]] as const) {
      const b = box({}, { CCRC_TEST_HEAVY_SLOTS: '1' });
      slice(b);
      const a = hold(b, 'a');
      await until('the holder to start', () => started(b, 'a'));
      const w = hold(b, 'w');
      await until('the second to queue', () => w.stderr().includes('queued'));
      w.proc.kill(sig);
      expect(await w.exit, `${sig} ends the queued run`).toBe(code);
      expect(run(b, ['--status']).stdout).toContain('0 waiting');
      release(b, 'a');
      expect(await a.exit).toBe(0);
      await new Promise((r) => setTimeout(r, 400));
      expect(started(b, 'w'), `${sig}: the cancelled run never started`).toBe(false);
    }
  });

  itQueue('a light run takes no slot', async () => {
    const b = box({}, { CCRC_TEST_HEAVY_SLOTS: '1' });
    slice(b);
    const a = hold(b, 'a');
    await until('the holder to start', () => started(b, 'a'));
    const l = hold(b, 'l', ['--light']);
    await until('the light run to start beside it', () => started(b, 'l'));
    expect(l.stderr()).not.toContain('queued');
    release(b, 'a'); release(b, 'l');
    await Promise.all([a.exit, l.exit]);
  });

  // ALREADY INSIDE is read from the process's own cgroup, never from the environment: a variable any caller can set
  // would let a whole suite skip the queue and the slice.
  const inSlice = (): string => {
    const proc = mkTmp('ccrc-test-proc-');
    mkdirSync(path.join(proc, 'self'), { recursive: true });
    writeFileSync(path.join(proc, 'self', 'cgroup'), '0::/user.slice/user-1000.slice/user@1000.service/ccrctests.slice/ccrc-test-41.scope\n');
    return proc;
  };
  itQueue('a run whose cgroup is under ccrctests.slice is already contained: it neither queues nor opens a scope', async () => {
    const b = box({}, { CCRC_TEST_HEAVY_SLOTS: '1' });
    slice(b);
    const a = hold(b, 'a');
    await until('the holder to start', () => started(b, 'a'));
    try {
      const before = log(b, 'systemd-run.log');
      const r = spawnSync('bash', [WRAPPER, '--heavy', '--', 'sh', '-c', 'echo nested'], { env: { ...b.env, CCRC_PROC_ROOT: inSlice() }, encoding: 'utf8', cwd: b.home, timeout: 10000 });
      expect(r.stdout.trim()).toBe('nested');
      expect(r.status).toBe(0);
      expect(log(b, 'systemd-run.log')).toBe(before);
    } finally {
      release(b, 'a');
      await a.exit;
    }
  });

  itQueue('CCRC_TEST_INSIDE in the environment is not trusted: a heavy run still queues behind the held slot', async () => {
    const b = box({}, { CCRC_TEST_HEAVY_SLOTS: '1' });
    slice(b);
    const a = hold(b, 'a');
    await until('the holder to start', () => started(b, 'a'));
    const w = hold(b, 'w', ['--heavy'], { CCRC_TEST_INSIDE: '1' });
    try {
      await until('the second to queue', () => w.stderr().includes('ccrc test: queued: all 1 heavy test slots are held'));
      await new Promise((r) => setTimeout(r, 400));
      expect(started(b, 'w'), 'the variable did not let it skip the queue').toBe(false);
      release(b, 'a');
      await until('the second to start', () => started(b, 'w'));
    } finally {
      release(b, 'a'); release(b, 'w');
    }
    expect(await w.exit).toBe(0);
    expect(await a.exit).toBe(0);
  });

  // Uncontained (macOS, or a slice the manager has not loaded) there is no cgroup to read, so a nested run knows it is
  // inside when the holder of a held slot is one of its own ancestors: it never waits on its parent's slot.
  itQueue('a heavy run inside a heavy run never waits on its own parent\'s slot', () => {
    const b = box({}, { CCRC_TEST_HEAVY_SLOTS: '1' });
    slice(b);
    const r = spawnSync('bash', [WRAPPER, '--heavy', '--', 'bash', WRAPPER, '--heavy', '--', 'sh', '-c', 'echo nested'], { env: b.env, encoding: 'utf8', cwd: b.home, timeout: 15000 });
    expect(r.stdout.trim()).toBe('nested');
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('queued');
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

describe('ccrc test: a run ends with its whole tree (D-TBD-test-containment)', () => {
  itLinux('the run\'s scope is stopped when its command ends, so a process it left behind ends too', async () => {
    const b = box();
    const r = run(b, ['--light', '--', 'sh', '-c', 'sleep 300 & for f in "$HOME"/ccrc-test-*.pids; do echo $! >> "$f"; done; echo $! > "$HOME/leftover"']);
    expect(r.status).toBe(0);
    const left = Number(log(b, 'leftover').trim());
    expect(left).toBeGreaterThan(0);
    await until('the leftover to end', () => !alive(left), 5000);
    expect(log(b, 'systemctl.log')).toMatch(/^--user stop ccrc-test-\d+\.scope$/m);
  });

  itLinux('a run signalled while it runs stops its scope and exits non-zero', async () => {
    const b = box();
    const h = hold(b, 'r', ['--light']);
    await until('the run to start', () => started(b, 'r'));
    const [cmd] = pidsOf(b, `ccrc-test-${h.proc.pid!}.pids`);
    h.proc.kill('SIGTERM');
    const code = await h.exit;
    expect(code).not.toBe(0);
    expect(alive(cmd!), 'the run\'s command is gone').toBe(false);
    expect(log(b, 'systemctl.log')).toContain(`--user stop ccrc-test-${h.proc.pid!}.scope`);
  });
});

describe('ccrc test --status (D-TBD-test-containment)', () => {
  itLinux('names the live memory against the live cap, the other limits and the queue', () => {
    const b = box();
    writeFileSync(path.join(b.home, 'fixture-slice-show'),
      'LoadState=loaded\nMemoryCurrent=1610612736\nMemoryMax=6442450944\nMemorySwapMax=1073741824\nCPUWeight=20\nCPUQuotaPerSecUSec=4s\nIOWeight=20\n');
    const r = run(b, ['--status']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('ccrctests.slice holds 1.5G of its 6.0G memory cap, swap cap 1.0G, CPU weight 20, CPU quota 4s per second, IO weight 20; heavy slots 0 of 2 held, 0 waiting');
  });
  itLinux('a slice with no memory cap answers 2', () => {
    const b = box();
    writeFileSync(path.join(b.home, 'fixture-slice-show'), 'LoadState=loaded\nMemoryCurrent=0\nMemoryMax=infinity\n');
    const r = run(b, ['--status']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('ccrctests.slice holds 0B with no memory cap (MemoryMax=infinity)');
  });
  itLinux('a slice that is not loaded answers 2', () => {
    const b = box();
    writeFileSync(path.join(b.home, 'fixture-slice-show'), 'LoadState=not-found\n');
    const r = run(b, ['--status']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('ccrctests.slice is not loaded (LoadState=not-found), so ccrc test runs every run uncontained');
  });
  it.skipIf(!IS_DARWIN)('on macOS it says runs are not contained', () => {
    expect(run(box(), ['--status']).stdout.trim()).toBe('no user manager here, so runs are not contained; heavy slots 0 of 2 held, 0 waiting');
  });
});

// The on-box proof (deploy/verify-test-slice.sh) is the operator's, run on a box with a real user manager; CI has none.
// Here only its refusal is held: where it cannot measure, it changes nothing and says so.
describe('deploy/verify-test-slice.sh (D-TBD-test-containment)', () => {
  const VERIFY = path.join(REPO, 'deploy', 'verify-test-slice.sh');
  it('refuses, changing nothing, where there is no user manager to measure', () => {
    const b = box();
    const r = spawnSync('bash', [VERIFY], { env: { ...b.env, PATH: '/usr/bin:/bin' }, encoding: 'utf8', cwd: b.home, timeout: 60000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^verify-test-slice: refused, nothing changed: (this is not Linux|systemctl, systemd-run and flock must all be on PATH)/);
    expect(existsSync(path.join(b.home, '.cc-sessions')), 'no slot was touched').toBe(false);
  });
});
