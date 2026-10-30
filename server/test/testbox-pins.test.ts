// The test box, Part A, TB0 (D-7402; plan #1874): today's `ccrc test`, pinned before any remote code lands.
//
// THE SWITCH OFF IS TODAY. Every later Part A task keeps these rows green with no switch marker and no test box url
// set: for each pinned command, `ccrc test`'s stdout, stderr, exit status and the processes it forks equal the
// literals below. A task that changes one of them changes what the fleet host does with the switch off, and that is
// the one thing Part A may not do.
//
// Four blocks:
// - wrapperToday(): five calls of ccd/ccrc-test in a fixture HOME, each recorded as a literal.
// - exitContract(): the wrapper never exits 75, and its EXIT paragraph names exit codes 1 and 2 only.
// - testboxReaders(): the tracked files outside docs/ that name a test box setting or the remote-live marker.
// - exit75Heads(): no package script spells `exit 75`.
//
// The fixture is ccrc-test-wrapper.test.ts's (that file exports nothing, so its stubs are copied here, unchanged in
// what they log): `systemctl` logs its argv and answers `show` from fixture files, `systemd-run` logs its argv and
// execs the command after `--`. The pinned commands are stubs too (`./node_modules/.bin/vitest`, `.../tsc` in the
// fixture cwd, `npm` on the fixture PATH), each logging its own argv, so no real test runs. `CCRC_PROC_ROOT` names a
// fixture /proc whose cgroup is outside ccrctests.slice, so the pins hold when this file itself runs under
// `ccrc test` (ALREADY INSIDE, ccd/ccrc-test#_tinside, would otherwise exec the command directly).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { platformContrast } from './platformFixtures.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = path.join(REPO, 'ccd', 'ccrc-test');
const SELF = 'server/test/testbox-pins.test.ts';
const HAS_FLOCK = spawnSync('sh', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
/** macOS: a heavy run's queue needs `flock`, which macOS does not ship; without one the wrapper says so, a line these
 *  literals do not hold. Linux (CI and the fleet host) always has it. */

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
/** A pinned command's stand-in: it logs its own name and argv, says it ran, and exits with a code of its own. */
const commandStub = (name: string, rc: number): string => `#!/bin/sh
printf '%s %s\\n' '${name}' "$*" >> "$HOME/commands.log"
echo '${name} stub ran'
exit ${rc}
`;

const SLICE_SHOW = 'LoadState=loaded\nMemoryCurrent=1610612736\nMemoryMax=6442450944\nMemorySwapMax=1073741824\nCPUWeight=20\nCPUQuotaPerSecUSec=4s\nIOWeight=20\n';

interface Box { home: string; env: NodeJS.ProcessEnv }
function box(): Box {
  const home = mkTmp('testbox-pins-');
  const bin = path.join(home, 'bin');
  const nm = path.join(home, 'node_modules', '.bin');
  const proc = path.join(home, 'proc', 'self');
  for (const d of [bin, nm, proc]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(bin, 'systemctl'), SYSTEMCTL, { mode: 0o755 });
  writeFileSync(path.join(bin, 'systemd-run'), SYSTEMD_RUN, { mode: 0o755 });
  writeFileSync(path.join(bin, 'npm'), commandStub('npm', 0), { mode: 0o755 });
  writeFileSync(path.join(nm, 'vitest'), commandStub('vitest', 0), { mode: 0o755 });
  writeFileSync(path.join(nm, 'tsc'), commandStub('tsc', 1), { mode: 0o755 });
  writeFileSync(path.join(proc, 'cgroup'), '0::/user.slice/user-1000.slice/session-1.scope\n');
  writeFileSync(path.join(home, 'fixture-slice-show'), SLICE_SHOW);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_')) env[k] = v;
  Object.assign(env, {
    HOME: home, PATH: `${bin}:${process.env['PATH'] ?? ''}`, CCRC_TEST_POLL_S: '0.1', CCRC_PROC_ROOT: path.join(home, 'proc'),
  });
  return { home, env };
}

/** One call, as the pins read it: the fixture HOME is spelled `$HOME` and the wrapper's pid (in its scope's unit name)
 *  `<pid>`, so a literal holds from run to run. */
interface Pin { stdout: string; stderr: string; status: number | null; systemctl: string[]; systemdRun: string[]; commands: string[] }
function today(args: string[]): Pin {
  const b = box();
  const r = spawnSync('bash', [WRAPPER, ...args], { env: b.env, encoding: 'utf8', cwd: b.home, timeout: 60000 });
  const norm = (s: string): string => s.split(b.home).join('$HOME').replace(/ccrc-test-\d+/g, 'ccrc-test-<pid>');
  const lines = (name: string): string[] => {
    const f = path.join(b.home, name);
    return existsSync(f) ? norm(readFileSync(f, 'utf8')).split('\n').filter((l) => l !== '') : [];
  };
  return {
    stdout: norm(r.stdout), stderr: norm(r.stderr), status: r.status,
    systemctl: lines('systemctl.log'), systemdRun: lines('systemd-run.log'), commands: lines('commands.log'),
  };
}

const VITEST = ['--', './node_modules/.bin/vitest', 'run', 'test/a.test.ts'];
const TSC = ['--heavy', '--', './node_modules/.bin/tsc', '--noEmit'];
const NPM_TEST = ['--', 'npm', 'test'];
const STATUS = ['--status'];
const USAGE = ['--bogus'];

const SET_PROPERTY = '--user set-property --runtime ccrctests.slice MemoryMax=6G MemorySwapMax=1G CPUWeight=20 CPUQuota=400% IOWeight=20';
const RUN_PREFIX = '--user --scope --quiet --collect --slice=ccrctests.slice --unit=ccrc-test-<pid>';
/** A contained run, in order: the slice is loaded, its five limits applied, the OOM count read, the command run, its
 *  scope stopped, the OOM count read again. */
const RUN_SYSTEMCTL = [
  '--user show ccrctests.slice -p LoadState --value',
  SET_PROPERTY,
  '--user show ccrctests.slice -p ControlGroup --value',
  '--user stop ccrc-test-<pid>.scope',
  '--user show ccrctests.slice -p ControlGroup --value',
];
const USAGE_PIN: Pin = {
  stdout: '',
  stderr: 'ccrc test: unknown argument: --bogus\n'
    + "usage: ccrc test [--heavy|--light] [--] <command> [<arg>...] | --classify [--] <command>... | --classify-shell [--] '<line>' | --status\n",
  status: 2, systemctl: [], systemdRun: [], commands: [],
};

describe('wrapperToday(): the switch off is today (D-7402)', () => {
  // Each pinned command is one claim with two arms. Linux (CI and the fleet host) runs it in the slice; macOS has no
  // user manager, so the run is not contained and says so, and the queue still applies.
  const DARWIN_SAYS = 'ccrc test: this box has no systemd user manager (macOS), so the run is not contained; the queue still applies\n';
  platformContrast('a light vitest run', {
    darwin: ['uncontained, says so, its own exit', () => {
      expect(today(VITEST)).toEqual({
        stdout: 'vitest stub ran\n', stderr: DARWIN_SAYS, status: 0, systemctl: [], systemdRun: [], commands: ['vitest run test/a.test.ts'],
      });
    }],
    linux: ['in the slice, at once, its own exit', () => {
      expect(today(VITEST)).toEqual({
        stdout: 'vitest stub ran\n', stderr: '', status: 0,
        systemctl: RUN_SYSTEMCTL,
        systemdRun: [`${RUN_PREFIX} --description=ccrc test: ./node_modules/.bin/vitest run test/a.test.ts -- ./node_modules/.bin/vitest run test/a.test.ts`],
        commands: ['vitest run test/a.test.ts'],
      });
    }],
  });
  // The heavy rows' darwin arm needs `flock` for the queue (see HAS_FLOCK); a Mac without one has nothing to pin here,
  // the same early return ccrc-test-wrapper.test.ts's queue contrast takes.
  platformContrast('a --heavy tsc run', {
    darwin: ['uncontained, says so, its own exit', () => {
      if (!HAS_FLOCK) return;
      expect(today(TSC)).toEqual({
        stdout: 'tsc stub ran\n', stderr: DARWIN_SAYS, status: 1, systemctl: [], systemdRun: [], commands: ['tsc --noEmit'],
      });
    }],
    linux: ['queued for a slot, in the slice, its own exit', () => {
      expect(today(TSC)).toEqual({
        stdout: 'tsc stub ran\n', stderr: '', status: 1,
        systemctl: RUN_SYSTEMCTL,
        systemdRun: [`${RUN_PREFIX} --description=ccrc test: ./node_modules/.bin/tsc --noEmit -- ./node_modules/.bin/tsc --noEmit`],
        commands: ['tsc --noEmit'],
      });
    }],
  });
  platformContrast('npm test reads heavy', {
    darwin: ['uncontained, says so, its own exit', () => {
      if (!HAS_FLOCK) return;
      expect(today(NPM_TEST)).toEqual({
        stdout: 'npm stub ran\n', stderr: DARWIN_SAYS, status: 0, systemctl: [], systemdRun: [], commands: ['npm test'],
      });
    }],
    linux: ['queued for a slot, in the slice, its own exit', () => {
      expect(today(NPM_TEST)).toEqual({
        stdout: 'npm stub ran\n', stderr: '', status: 0,
        systemctl: RUN_SYSTEMCTL,
        systemdRun: [`${RUN_PREFIX} --description=ccrc test: npm test -- npm test`],
        commands: ['npm test'],
      });
    }],
  });
  platformContrast('--status', {
    darwin: ['says runs are not contained', () => {
      expect(today(STATUS)).toEqual({
        stdout: 'no user manager here, so runs are not contained; heavy slots 0 of 2 held, 0 waiting\n',
        stderr: '', status: 0, systemctl: [], systemdRun: [], commands: [],
      });
    }],
    linux: ['one line, the slice and the queue', () => {
      expect(today(STATUS)).toEqual({
        stdout: 'ccrctests.slice holds 1.5G of its 6.0G memory cap, swap cap 1.0G, CPU weight 20, CPU quota 4s per second, IO weight 20; heavy slots 0 of 2 held, 0 waiting\n',
        stderr: '', status: 0,
        systemctl: ['--user show ccrctests.slice -p LoadState -p MemoryCurrent -p MemoryMax -p MemorySwapMax -p CPUWeight -p CPUQuotaPerSecUSec -p IOWeight'],
        systemdRun: [], commands: [],
      });
    }],
  });
  it('a usage error: exit 2, one line and the usage, nothing forked', () => {
    expect(today(USAGE)).toEqual(USAGE_PIN);
  });
});

/** The wrapper's EXIT paragraph: from the `# EXIT.` comment line to the end of that comment block. */
function exitParagraph(src: string): string {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith('# EXIT.'));
  expect(start, 'ccd/ccrc-test has an EXIT paragraph').toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (const l of lines.slice(start)) { if (!l.startsWith('#')) break; out.push(l); }
  return out.join('\n');
}
/** The lines of a shell file outside comments that spell `exit 75`. */
const exit75Lines = (src: string): string[] =>
  src.split('\n').filter((l) => !/^\s*#/.test(l) && /\bexit 75\b/.test(l));

describe('exitContract(): ccrc test refuses only a usage error and a ccrc it cannot load (D-7402)', () => {
  const src = readFileSync(WRAPPER, 'utf8');
  it('no line of ccd/ccrc-test outside comments exits 75', () => {
    expect(exit75Lines(src)).toEqual([]);
  });
  it('the EXIT paragraph names exit codes 1 and 2 only', () => {
    const codes = [...exitParagraph(src).matchAll(/\bexit (\d+)\b/g)].map((m) => m[1]);
    expect([...new Set(codes)].sort()).toEqual(['1', '2']);
  });
});

/** git with none of the variables that would point it at another repository (a hook's GIT_DIR, a worktree's index). */
function git(args: string[]): { status: number | null; stdout: string } {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  const r = spawnSync('git', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout };
}

describe('testboxReaders(): nothing outside docs/ reads a test box setting or the remote-live marker yet (D-7402)', () => {
  // This file names both in its own pattern, so it is left out by path. Each later TB task raises the list to its own
  // literal list of readers.
  // TB2 (D-7404) adds the switch row: its definer and the two tests that pin it name the marker; none of them reads it
  // (single-definition's switch pin holds that no shell line and no TypeScript writer names it until TB8 and TB9).
  const TB2_HOLDERS = ['server/test/single-definition/switches-history.test.ts', 'server/test/switches.test.ts', 'shared/switches.ts'];
  // TB3 (D-7405) adds the transport: ccd/testbox-snap and the forced command name the settings their caller passes
  // in (neither reads one), and the transport test names them in its fixtures.
  const TB3_HOLDERS = ['ccd/testbox-snap', 'deploy/testbox/git/push-command', 'server/test/testbox-transport.test.ts'];
  // TB4 (D-7406) adds the test service: its settings reader (config.ts) and the files that read the settings it parsed
  // or name a key in a comment, and its tests. The unit scripts under deploy/testbox/bin/ name none (they read only
  // specs/<k>). In `git grep -l` order, which is path order.
  const TB4_HOLDERS = [
    'agent/src/testbox/config.ts', 'agent/src/testbox/exec.ts', 'agent/src/testbox/main.ts', 'agent/src/testbox/queue.ts',
    'agent/src/testbox/runs.ts', 'agent/src/testbox/service.ts', 'agent/src/testbox/spec.ts', 'agent/src/testbox/systemd.ts',
    'agent/test/testbox-live.test.ts', 'agent/test/testbox-service.test.ts',
  ];
  const HOLDERS = [...TB4_HOLDERS, ...TB3_HOLDERS, ...TB2_HOLDERS].sort();
  it('the tracked readers are exactly the literal list (TB2: the switch row and its two pins; TB3: the transport; TB4: the test service)', () => {
    const r = git(['grep', '-l', '-E', 'CCRC_TESTBOX_|testbox-remote-live', '--', '.', ':!docs/', `:!${SELF}`]);
    expect(r.status === 0 || r.status === 1, 'git grep ran (1 is no match)').toBe(true);
    expect(r.stdout.split('\n').filter((l) => l !== '')).toEqual(HOLDERS);
  });
  it('the pattern reaches: without the exclusion, it finds this file', () => {
    const r = git(['grep', '-l', '-E', 'CCRC_TESTBOX_|testbox-remote-live', '--', '.', ':!docs/']);
    expect(r.stdout.split('\n').filter((l) => l !== '')).toEqual([...HOLDERS, SELF].sort());
  });
});

describe('exit75Heads(): no package script exits 75 (D-7402)', () => {
  it.each(['server', 'pwa', 'agent', 'ui'])('%s/package.json: no scripts entry contains exit 75', (pkg) => {
    const manifest = JSON.parse(readFileSync(path.join(REPO, pkg, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const scripts = Object.entries(manifest.scripts ?? {});
    expect(scripts.length, `${pkg} has scripts to read`).toBeGreaterThan(0);
    expect(scripts.filter(([, v]) => /\bexit 75\b/.test(v)).map(([k]) => k)).toEqual([]);
  });
});
