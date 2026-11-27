// The Windows port's replacement for `systemd --user`, pinned against the ONE
// consumer whose answers the whole fleet view rests on: `_ws_unit_state`
// (`ccd/ccd:10615`). That function is not a wrapper around systemctl — it is a
// four-answer measurement, and the fourth answer is the empty string:
//
//   enabled — a `default.target.wants/` entry exists: it comes back at boot
//   loaded  — the manager knows the unit, nothing promises a next boot
//   absent  — `list-units` ANSWERED and does not name it
//   ""      — there is no manager, or the probe REFUSED
//
// The empty answer is the reason this file exists at all. `ccd`'s own comment
// spells out what collapsing it costs: "a down or unreachable `--user` manager
// produces no rows, grep fails, and every workspace on the box would report
// `absent` — 'nothing is watching this session', which is the precise F8 orphan
// signature this field exists to make visible." A shim that exits 0 while its
// supervisor is down reports every session on the box as unwatched. So the
// tests below drive the REAL `_ws_unit_state` through bash rather than
// asserting on our own output shape: the contract is not "print rows like
// systemd", it is "make that function answer what it would have answered".
//
// Cross-platform on purpose. The shim is bash, the supervisor is dependency-
// free Node, and neither needs Windows — so CI on ubuntu measures the same
// mechanism the Windows box runs, instead of skipping it and shipping a guard
// nobody exercises.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { resolveBash } from '../src/exec.js';
// The path to the ccd script is spelled in ONE file, and this is not it —
// `single-definition.test.ts` scans for a second copy and fails the build on
// one. It caught this file joining the two path segments by hand, and then
// caught the comment that said so QUOTING them, which is a second copy as far
// as a text scanner is concerned. Hence this paragraph names neither.
import { CCD, ghContainedEnv } from './ccdWsHelpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHIM_BIN = path.join(root, 'win', 'bin');
const SUPERVISOR = path.join(root, 'win', 'ccrc-supervisor.mjs');
const UNIT = 'claude-session@demo.service';

/** `_ws_unit_state <id>` as ccd itself computes it, with our shim on PATH.
 *  Sourcing the real script is the point: a shim that satisfies a paraphrase of
 *  the contract but not the function is not a shim. */
function wsUnitState(home: string, id: string): string {
  return execFileSync('bash', ['-c', `source "${CCD}"; _ws_unit_state "${id}"`], {
    encoding: 'utf8',
    // Contained (the gh poison, a fixture user bus), not the parent's env: ccd is sourced here. No systemd poison --
    // the shim IS the systemctl under test, so it is the one the PATH must find first after the poisons' directory.
    env: ghContainedEnv(home, { ...process.env, HOME: home, PATH: `${SHIM_BIN}${path.delimiter}${process.env['PATH']}` }),
  }).trim();
}

function systemctl(home: string, args: string[]): void {
  execFileSync('bash', [path.join(SHIM_BIN, 'systemctl'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

/** A path bash can take verbatim. `path.join` yields backslashes on Windows,
 *  and a backslash inside a double-quoted bash word is an escape, not a
 *  separator — the fixture would silently write somewhere else. */
const posix = (p: string): string => p.split(path.sep).join('/');

function wantsPath(home: string): string {
  return path.join(home, '.config', 'systemd', 'user', 'default.target.wants', UNIT);
}

function seedHome(): string {
  const home = mkTmp('ccrc-win-sup-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  const accountsSh = execFileSync(
    process.execPath,
    [path.join(root, 'deploy', 'gen-accounts.mjs'), path.join(root, 'deploy', 'accounts.default.json')],
    { encoding: 'utf8' },
  );
  writeFileSync(path.join(home, '.ccrc', 'accounts.sh'), accountsSh);
  return home;
}

/** A supervisor over a STUB ExecStart. `CCRC_SUPERVISOR_EXEC` is the declared
 *  test seam — the same idiom `CCRC_ACCOUNTS` uses in `server/src/config.ts`:
 *  a fixture must not need a real `ccd supervise` to be true. */
/** The manager and every unit it started. On Windows `kill()` is TerminateProcess of the manager alone, and its units
 *  run detached, so a test's stand-in server outlived the test (measured: an orphan from a fixture HOME holding on). */
function stopSupervisor(c: ChildProcess | undefined): void {
  if (!c?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(c.pid)], { windowsHide: true });
  else c.kill();
}

async function startSupervisor(home: string, env: Record<string, string> = {}): Promise<ChildProcess> {
  const child = spawn(process.execPath, [SUPERVISOR], {
    env: { ...process.env, CCRC_HOME: home, HOME: home, CCRC_SUPERVISOR_EXEC: 'sleep 300', ...env },
    stdio: 'ignore',
  });
  await waitFor(() => existsSync(path.join(home, '.ccrc', 'supervisor', 'endpoint.json')));
  return child;
}

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (pred()) return;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('systemctl shim: the four answers of _ws_unit_state', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;

  afterAll(() => stopSupervisor(sup));

  it('answers EMPTY — not "absent" — while the manager is not answering', () => {
    // The F8 signature, and the one mutation that matters: make the shim exit 0
    // on an unreachable supervisor and this assertion flips to 'absent', which
    // is the whole box reporting "nothing is watching this session".
    expect(wsUnitState(home, 'demo')).toBe('');
  });

  it('answers "absent" once the manager answers and does not know the unit', async () => {
    sup = await startSupervisor(home);
    expect(wsUnitState(home, 'demo')).toBe('absent');
  });

  it('answers "enabled" after `enable --now`, by the wants entry ccd actually stats', () => {
    systemctl(home, ['--user', 'enable', '--now', UNIT]);
    expect(existsSync(wantsPath(home))).toBe(true);
    expect(wsUnitState(home, 'demo')).toBe('enabled');
  });

  it('answers "loaded" after `disable` — the unit still runs, nothing promises a next boot', () => {
    systemctl(home, ['--user', 'disable', UNIT]);
    expect(existsSync(wantsPath(home))).toBe(false);
    expect(wsUnitState(home, 'demo')).toBe('loaded');
  });
});

describe('the start limiter — StartLimitBurst=5 / StartLimitIntervalSec=120', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;

  afterAll(() => stopSupervisor(sup));

  it('stops restarting and leaves the unit `failed`, instead of looping invisibly', async () => {
    // The unit file's §3.3: "A session whose pane dies instantly must become a
    // FAILED unit rather than an invisible restart loop." Burst is squeezed to
    // 2 and RestartSec to 0 so the fixture spends milliseconds, not 15 seconds.
    sup = await startSupervisor(home, {
      CCRC_SUPERVISOR_EXEC: 'exit 1',
      CCRC_SUPERVISOR_LIMIT_BURST: '2',
      CCRC_SUPERVISOR_RESTART_SEC: '0',
    });
    systemctl(home, ['--user', 'start', UNIT]);
    await waitFor(() => listUnits(home).includes('failed'), 8000);
    expect(listUnits(home)).toMatch(/claude-session@demo\.service loaded failed failed/);
  });

  it('`reset-failed` clears it, which is what makes `ccd start` revive a failed row', async () => {
    systemctl(home, ['--user', 'reset-failed', UNIT]);
    expect(listUnits(home)).not.toContain('failed');
  });
});

function listUnits(home: string): string {
  return execFileSync(
    'bash',
    [path.join(SHIM_BIN, 'systemctl'), '--user', 'list-units', 'claude-session@*',
      '--all', '--plain', '--no-legend'],
    { encoding: 'utf8', env: { ...process.env, HOME: home } },
  );
}

describe('systemd-run shim: the swap dispatch must outlive its caller', () => {
  const home = seedHome();

  it('returns immediately and finishes the work afterwards (`--collect`, no --scope)', async () => {
    // `ccd:9694` runs the swap through a transient unit precisely so dispatch
    // stays non-blocking. A shim that waits would hold up the supervise tick;
    // one that drops the work would log "dispatch FAILED" on every limit hit.
    const mark = path.join(home, 'dispatched');
    const t0 = Date.now();
    execFileSync('bash', [path.join(SHIM_BIN, 'systemd-run'), '--user', '--collect', '--quiet',
      'bash', '-c', `sleep 1; : > "${posix(mark)}"`],
      { encoding: 'utf8', env: { ...process.env, HOME: home } });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(900);          // it did NOT wait for the sleep
    expect(existsSync(mark)).toBe(false);
    await waitFor(() => existsSync(mark), 8000); // ...and the work still happened
  });

  it('runs `--scope` in the foreground, which is what the tmux-server election needs', () => {
    const mark = path.join(home, 'scoped');
    execFileSync('bash', [path.join(SHIM_BIN, 'systemd-run'), '--user', '--scope', '--collect',
      '--unit=ccrc-tmux-server', 'bash', '-c', `: > "${posix(mark)}"`],
      { encoding: 'utf8', env: { ...process.env, HOME: home } });
    expect(existsSync(mark)).toBe(true);        // already done when it returned
  });
});

describe('loginctl shim: linger says yes only when something really was registered', () => {
  const home = seedHome();

  const linger = (): string => execFileSync(
    'bash', [path.join(SHIM_BIN, 'loginctl'), 'show-user', '1000', '--property=Linger'],
    { encoding: 'utf8', env: { ...process.env, HOME: home } },
  ).trim();

  it('answers Linger=no before anything is registered', () => {
    expect(linger()).toBe('Linger=no');
  });

  it('answers Linger=yes only once the marker registration wrote', () => {
    // The marker is what `enable-linger` writes AFTER schtasks returns 0. Doctor
    // prints a green line off this answer; a shim that says yes unconditionally
    // would report a fleet as surviving logout when nothing brings it back.
    mkdirSync(path.join(home, '.ccrc', 'supervisor'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'supervisor', 'linger'), 'ccrc-supervisor\n');
    expect(linger()).toBe('Linger=yes');
  });
});

describe('at start the manager brings back what was enabled — default.target', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;

  afterAll(() => stopSupervisor(sup));

  it('starts every unit that has a wants entry, without anyone calling `start`', async () => {
    // systemd's `default.target` behaviour, and the whole point of `enable`:
    // a logon (or a supervisor restart) must not leave the operator typing
    // `ccd start` per session. The wants entry is written BEFORE the manager
    // exists — exactly the state a fresh logon finds on disk.
    mkdirSync(path.dirname(wantsPath(home)), { recursive: true });
    writeFileSync(wantsPath(home), `${UNIT}\n`);
    sup = await startSupervisor(home);
    await waitFor(() => listUnits(home).includes('active running'), 8000);
    expect(listUnits(home)).toMatch(/claude-session@demo\.service loaded active running/);
    // And ccd's own reading of it agrees: enabled, because the entry is there.
    expect(wsUnitState(home, 'demo')).toBe('enabled');
  });
});

describe('nothing about the launcher reaches a session — CLAUDE* is scrubbed', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;

  afterAll(() => stopSupervisor(sup));

  it('a unit sees no CLAUDE* variable even when the manager was started inside a Claude Code session', async () => {
    // Measured: a pane spawned by a manager that itself ran under a Claude
    // Code session answered "Transcript saving is off — inherited
    // CLAUDE_CODE_CHILD_SESSION marker" and stopped persisting the
    // conversation. The variables describe the LAUNCHER, not the session.
    const dump = path.join(home, 'childenv.txt');
    sup = await startSupervisor(home, {
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'parent-session',
      CCRC_SUPERVISOR_EXEC: `env > "${posix(dump)}"; sleep 300`,
    });
    systemctl(home, ['--user', 'start', UNIT]);
    await waitFor(() => existsSync(dump) && readFileSync(dump, 'utf8').includes('HOME='), 8000);
    const seen = readFileSync(dump, 'utf8').split('\n').filter((l) => /^CLAUDE/i.test(l));
    expect(seen, `leaked into the unit: ${seen.join(', ')}`).toEqual([]);
  });
});

describe('one manager per HOME — endpoint.json has a single writer', () => {
  // The file is the shim's only way to find whoever is in charge, so a second
  // start does not merely duplicate a process: it overwrites the port and token
  // of the manager that owns the RUNNING units. Every `systemctl` after that
  // reaches the newcomer, which supervises nothing, and the incumbent — still
  // holding the server as its child — becomes unaddressable.
  //
  // Measured by doing it on this box: a stray start moved the endpoint from
  // 57952 to 62490, and when that instance exited the live manager was left
  // with no way in and its units killable only by pid.
  let home = '', first: ChildProcess | null = null;

  beforeAll(async () => { home = seedHome(); first = await startSupervisor(home); });
  afterAll(() => { first?.kill(); });

  it('the second start REFUSES, and leaves the incumbent\'s endpoint untouched', async () => {
    const ep = path.join(home, '.ccrc', 'supervisor', 'endpoint.json');
    const before = readFileSync(ep, 'utf8');
    const second = spawn(process.execPath, [SUPERVISOR], {
      env: { ...process.env, CCRC_HOME: home, HOME: home, CCRC_SUPERVISOR_EXEC: 'sleep 300' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    second.stderr?.on('data', (b) => { stderr += String(b); });
    const code = await new Promise<number | null>((r) => second.on('exit', r));

    expect(code).toBe(3);
    expect(stderr).toMatch(/already running/);
    // The whole point: not merely that it exited, but that the incumbent is
    // still the one the shim will find.
    expect(readFileSync(ep, 'utf8')).toBe(before);
  });

  it('a STALE endpoint does not block the next start — the probe is live, not the file', async () => {
    // A manager that died without cleaning up must not wedge the box forever.
    // This is why the guard asks the port rather than trusting the file.
    const stale = mkTmp('ccrc-win-sup-stale-');
    mkdirSync(path.join(stale, '.ccrc', 'supervisor'), { recursive: true });
    writeFileSync(path.join(stale, '.ccrc', 'accounts.sh'),
      readFileSync(path.join(home, '.ccrc', 'accounts.sh'), 'utf8'));
    // Port 1 is bindable by nobody here, so the probe fails exactly as it does
    // against a dead manager's port.
    writeFileSync(path.join(stale, '.ccrc', 'supervisor', 'endpoint.json'),
      JSON.stringify({ port: 1, token: 'stale' }) + '\n');

    // NOT `startSupervisor`: its wait is for the file to EXIST, and the stale
    // file already does — it would return before the manager had done anything.
    const epFile = path.join(stale, '.ccrc', 'supervisor', 'endpoint.json');
    const child = spawn(process.execPath, [SUPERVISOR], {
      env: { ...process.env, CCRC_HOME: stale, HOME: stale, CCRC_SUPERVISOR_EXEC: 'sleep 300' },
      stdio: 'ignore',
    });
    try {
      await waitFor(() => JSON.parse(readFileSync(epFile, 'utf8')).port !== 1, 10_000);
      const ep = JSON.parse(readFileSync(epFile, 'utf8'));
      expect(ep.port).not.toBe(1);
      expect(ep.token).not.toBe('stale');
    } finally { child.kill(); }
  });
});

describe('timers from the installed unit files — every sweep, not only the one the static table names', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  const unitDir = path.join(home, '.config', 'systemd', 'user');
  const ticks = path.join(home, 'ticks');

  beforeAll(async () => {
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(path.join(unitDir, 'probe-sweep.timer'),
      '[Unit]\nDescription=Run the probe sweep\n\n[Timer]\nOnActiveSec=1s\nOnUnitActiveSec=1s\n\n[Install]\nWantedBy=timers.target\n');
    // `%h` and a `$$` (a literal `$`) as the real ccrc-settings.service writes them.
    writeFileSync(path.join(unitDir, 'probe-sweep.service'),
      "[Unit]\nDescription=Probe sweep\n\n[Service]\nType=oneshot\nExecStart=/bin/sh -c 'echo \"$$HOME\" >> %h/ticks'\n");
    // The graph sweep's shape: OnBootSec + OnUnitInactiveSec (counted from each start here, see `timerFor`).
    writeFileSync(path.join(unitDir, 'idle-sweep.timer'), '[Timer]\nOnBootSec=1s\nOnUnitInactiveSec=1s\n');
    writeFileSync(path.join(unitDir, 'idle-sweep.service'),
      "[Service]\nType=oneshot\nExecStart=/bin/sh -c 'echo x >> %h/idle-ticks'\n");
    // `*:0/5` is modelled now (the OnCalendar block below); a weekday calendar is not.
    writeFileSync(path.join(unitDir, 'cal-sweep.timer'), '[Timer]\nOnCalendar=Mon *-*-* 03:00:00\n');
    writeFileSync(path.join(unitDir, 'cal-sweep.service'), '[Service]\nType=oneshot\nExecStart=/bin/true\n');
    sup = await startSupervisor(home);
  });
  afterAll(() => stopSupervisor(sup));

  it('`enable --now` of a unit-file timer runs its oneshot on the file\'s schedule, again and again', async () => {
    systemctl(home, ['--user', 'enable', '--now', 'probe-sweep.timer']);
    await waitFor(() => existsSync(ticks) && readFileSync(ticks, 'utf8').trim().split('\n').length >= 2, 15_000);
    const first = readFileSync(ticks, 'utf8').trim().split('\n')[0]!;
    expect(first, '`$$` is a literal `$` to systemd, so the shell expanded $HOME').not.toMatch(/^\$|^$/);
  });

  it('an OnUnitInactiveSec timer (the graph sweep\'s) runs its oneshot too, rather than being refused', async () => {
    systemctl(home, ['--user', 'enable', '--now', 'idle-sweep.timer']);
    const idle = path.join(home, 'idle-ticks');
    await waitFor(() => existsSync(idle) && readFileSync(idle, 'utf8').trim().split('\n').length >= 2, 15_000);
  });

  it('a timer this manager cannot model (OnCalendar) is still refused, not faked', () => {
    expect(() => systemctl(home, ['--user', 'enable', '--now', 'cal-sweep.timer'])).toThrow();
  });
});

describe('`show -p ExecStart`: what `ccrc versions` reads to know which kept tree a running unit uses', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  beforeAll(async () => { sup = await startSupervisor(home); });
  afterAll(() => stopSupervisor(sup));

  it('answers systemd\'s struct form, with the server\'s path under $HOME/ccrc in MSYS form', () => {
    const line = execFileSync('bash', [path.join(SHIM_BIN, 'systemctl'), '--user', 'show', '-p', 'ExecStart', 'ccrc.service'], {
      encoding: 'utf8', env: { ...process.env, HOME: home },
    }).trim();
    // `_ver_running_names`' own pattern (ccd/ccrc).
    const m = /^ExecStart=\{ path=([^ ]*) ; argv\[\]=(.*) ; ignore_errors=/.exec(line);
    expect(m, line).not.toBeNull();
    const msysHome = home.replace(/\\/g, '/').replace(/^([A-Za-z]):(?=\/|$)/, (_x, d: string) => `/${d.toLowerCase()}`);
    expect(m![2]!.split(' ')).toContain(`${msysHome}/ccrc/server/dist/server/src/index.js`);
  });
});

describe('`ccrc test --status` asks the manager whether it has slices (Windows: the stand-in has none)', () => {
  const TEST_WRAPPER = path.join(root, 'ccd', 'ccrc-test');
  const status = (home: string, binFirst: string): { rc: number; out: string } => {
    try {
      const out = execFileSync('bash', [posix(TEST_WRAPPER), '--status'], {
        encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${binFirst}${path.delimiter}${process.env['PATH']}` },
      });
      return { rc: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { rc: err.status, out: err.stdout };
    }
  };

  it.skipIf(process.platform !== 'win32')('the stand-in answering: rc 0, uncontained, never the unloaded-slice line that refuses a graph build', () => {
    const r = status(seedHome(), SHIM_BIN);
    expect(r.out).toMatch(/^no cgroups on Windows, so runs are not contained; heavy slots \d+ of \d+ held/);
    expect(r.rc).toBe(0);
  });

  it.skipIf(process.platform !== 'win32')('a systemd answering on the same host is still read as one (rc 2 for its unloaded slice)', () => {
    const home = seedHome();
    const bin = path.join(home, 'fake-systemd');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'systemctl'),
      '#!/bin/sh\ncase "$*" in *--version*) echo "systemd 255 (255.4)";; *show*) echo LoadState=not-found;; esac\n', { mode: 0o755 });
    const r = status(home, bin);
    expect(r.out).toMatch(/ccrctests\.slice is not loaded \(LoadState=not-found\)/);
    expect(r.rc).toBe(2);
  });
});

/** `list-units` rows of a fixture manager, through the shim. */
function rows(home: string): string {
  return execFileSync('bash', [path.join(SHIM_BIN, 'systemctl'), '--user', 'list-units'], {
    encoding: 'utf8', env: { ...process.env, HOME: home },
  });
}
const unitDirOf = (home: string): string => path.join(home, '.config', 'systemd', 'user');

describe('what systemd gives a unit: its environment files, a failed state, a start timeout', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  beforeAll(async () => {
    const dir = unitDirOf(home);
    mkdirSync(path.join(dir, 'envprobe.service.d'), { recursive: true });
    writeFileSync(path.join(home, 'a.env'), '# a comment\nA=1\nB="two"\n\n');
    writeFileSync(path.join(dir, 'envprobe.service'),
      '[Service]\nType=oneshot\nEnvironmentFile=-%h/missing.env\nEnvironmentFile=%h/a.env\n'
      + 'Environment="C=three four" D=5\n'
      + `ExecStart=/bin/sh -c 'echo "$$A|$$B|$$C|$$D" > %h/envout'\n`);
    writeFileSync(path.join(dir, 'envprobe.service.d', '10-over.conf'), '[Service]\nEnvironment=B=override\n');
    writeFileSync(path.join(dir, 'fails.service'), "[Service]\nType=oneshot\nExecStart=/bin/sh -c 'exit 3'\n");
    writeFileSync(path.join(dir, 'hangs.service'), "[Service]\nType=oneshot\nTimeoutStartSec=2s\nExecStart=/bin/sh -c 'sleep 60'\n");
    sup = await startSupervisor(home);
  });
  afterAll(() => stopSupervisor(sup));

  it('EnvironmentFile= (an optional missing one skipped), Environment= and a drop-in reach the unit, later wins', async () => {
    systemctl(home, ['--user', 'start', 'envprobe.service']);
    const out = path.join(home, 'envout');
    await waitFor(() => existsSync(out) && readFileSync(out, 'utf8').trim() !== '', 15_000);
    expect(readFileSync(out, 'utf8').trim()).toBe('1|override|three four|5');
  });

  it('a oneshot that exits non-zero is `failed`, not `inactive (dead)`', async () => {
    systemctl(home, ['--user', 'start', 'fails.service']);
    await waitFor(() => /^fails\.service \S+ failed/m.test(rows(home)), 15_000);
  });

  it('TimeoutStartSec= stops a hung oneshot and marks it failed', async () => {
    systemctl(home, ['--user', 'start', 'hangs.service']);
    await waitFor(() => /^hangs\.service \S+ failed/m.test(rows(home)), 20_000);
  });
});

describe.skipIf(process.platform !== 'win32')('the first start after a boot: a runtime directory, and no dead tmux socket', () => {
  const home = seedHome();
  const run = path.join(home, 'run');
  const tmuxTmp = path.join(home, 'tmux-tmp');
  let sup: ChildProcess | undefined;
  let dead = '';
  let fresh = '';
  beforeAll(async () => {
    const sh = resolveBash();
    const uid = execFileSync(sh, ['-c', 'id -u'], { encoding: 'utf8' }).trim();
    const sockDir = path.join(tmuxTmp, `tmux-${uid}`);
    mkdirSync(sockDir, { recursive: true });
    mkdirSync(run, { recursive: true });
    fresh = path.join(run, 'left-from-last-boot');
    writeFileSync(fresh, 'x');
    dead = path.join(sockDir, 'default');
    // A socket whose server is gone, as a reboot leaves one: bound by an MSYS process that then exits.
    execFileSync(sh, ['-c', `python3 -c 'import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' "$(cygpath -u '${dead}')"`]);
    expect(existsSync(dead)).toBe(true);
    sup = await startSupervisor(home, { CCRC_SUPERVISOR_SHELL: sh, XDG_RUNTIME_DIR: run, TMUX_TMPDIR: tmuxTmp });
  });
  afterAll(() => stopSupervisor(sup));

  it('removes the socket no server answers and empties the runtime directory, once per boot', async () => {
    await waitFor(() => !existsSync(dead) && !existsSync(fresh), 30_000);
    expect(readFileSync(path.join(home, '.ccrc', 'supervisor', 'boot'), 'utf8').trim()).toMatch(/^\d+$/);
  });
});

/** The shim, its stdout and exit status, against a fixture manager. */
function shim(home: string, tool: string, args: string[]): { rc: number; out: string } {
  try {
    return { rc: 0, out: execFileSync('bash', [path.join(SHIM_BIN, tool), ...args], { encoding: 'utf8', env: { ...process.env, HOME: home } }) };
  } catch (e) {
    const err = e as { status: number; stdout: string };
    return { rc: err.status, out: err.stdout };
  }
}

describe('transient units and the systemctl verbs ccd asks of them (account sign-in, supervised runs)', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  beforeAll(async () => {
    mkdirSync(unitDirOf(home), { recursive: true });
    writeFileSync(path.join(unitDirOf(home), 'boom.service'), "[Service]\nType=oneshot\nExecStart=/bin/sh -c 'exit 4'\n");
    sup = await startSupervisor(home);
  });
  afterAll(() => stopSupervisor(sup));

  it('systemd-run --unit= starts a unit the manager answers for: -p K=V is a property, never the command', async () => {
    const r = shim(home, 'systemd-run', ['--user', '--unit=signin-probe', '--collect', '-p', 'RuntimeMaxSec=60',
      '-p', 'MemoryMax=512M', '-p', 'StandardOutput=null', '--setenv=PROBE_X=hello',
      '/bin/sh', '-c', 'echo "$PROBE_X" > "$HOME/tr-out"; exec sleep 30']);
    expect(r.rc).toBe(0);
    await waitFor(() => existsSync(path.join(home, 'tr-out')), 15_000);
    expect(readFileSync(path.join(home, 'tr-out'), 'utf8').trim()).toBe('hello');
    expect(shim(home, 'systemctl', ['--user', 'is-active', 'signin-probe.service']).out.trim()).toBe('active');
    shim(home, 'systemctl', ['--user', 'stop', 'signin-probe.service']);
    await waitFor(() => shim(home, 'systemctl', ['--user', 'is-active', 'signin-probe.service']).out.trim() === 'inactive', 15_000);
  });

  it('RuntimeMaxSec= ends a transient unit that outlives it', async () => {
    shim(home, 'systemd-run', ['--user', '--unit=short-probe', '--collect', '-p', 'RuntimeMaxSec=2', '/bin/sh', '-c', 'exec sleep 60']);
    await waitFor(() => shim(home, 'systemctl', ['--user', 'is-active', 'short-probe.service']).out.trim() === 'active', 10_000);
    await waitFor(() => shim(home, 'systemctl', ['--user', 'is-active', 'short-probe.service']).out.trim() !== 'active', 20_000);
  });

  it('show-environment answers (a user manager is there), with the environment units get', () => {
    const r = shim(home, 'systemctl', ['--user', 'show-environment']);
    expect(r.rc).toBe(0);
    expect(r.out).toMatch(/^HOME=/m);
  });

  it('list-units --state=failed lists only failed units; show takes several -p, unit first or last', async () => {
    shim(home, 'systemctl', ['--user', 'start', 'boom.service']);
    await waitFor(() => /^boom\.service \S+ failed/m.test(rows(home)), 15_000);
    const failed = shim(home, 'systemctl', ['--user', 'list-units', '--state=failed', '--plain', '--no-legend']).out;
    expect(failed.trim().split('\n').map((l) => l.split(' ')[0])).toEqual(['boom.service']);
    const a = shim(home, 'systemctl', ['--user', 'show', '-p', 'ActiveState', '-p', 'NRestarts', 'boom.service']).out;
    expect(a.trim().split('\n')).toEqual(['ActiveState=failed', 'NRestarts=0']);
    const b = shim(home, 'systemctl', ['--user', 'show', 'boom.service', '-p', 'LoadState', '--value']).out;
    expect(b.trim()).toBe('loaded');
  });
});

/** One `show -p <prop> --value` answer of a fixture manager. */
const prop = (home: string, unitName: string, p: string): string =>
  shim(home, 'systemctl', ['--user', 'show', '-p', p, '--value', unitName]).out.trim();

describe('ExecCondition=: 1-254 skips the run and stays inactive, 255 fails the unit, 0 runs ExecStart', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  const ran = (n: string): string => path.join(home, `ran-${n}`);
  beforeAll(async () => {
    const dir = unitDirOf(home);
    mkdirSync(dir, { recursive: true });
    // ccrc-settings.service's shape: a oneshot whose condition reads the tree before the verb runs.
    const unitText = (cond: string, n: string): string =>
      `[Service]\nType=oneshot\nExecCondition=/bin/sh -c '${cond}'\nExecStart=/bin/sh -c ': > %h/ran-${n}'\n`;
    writeFileSync(path.join(dir, 'cond-skip.service'), unitText('exit 1', 'skip'));
    writeFileSync(path.join(dir, 'cond-fail.service'), unitText('exit 255', 'fail'));
    writeFileSync(path.join(dir, 'cond-pass.service'), unitText('exit 0', 'pass'));
    sup = await startSupervisor(home);
  });
  afterAll(() => stopSupervisor(sup));

  it('a condition that exits 1 skips ExecStart and leaves the unit inactive, not failed', async () => {
    systemctl(home, ['--user', 'start', 'cond-skip.service']);
    await waitFor(() => /^cond-skip\.service \S+ inactive dead/m.test(rows(home)), 15_000);
    expect(existsSync(ran('skip'))).toBe(false);
  });

  it('a condition that exits 255 fails the unit, and ExecStart never runs', async () => {
    systemctl(home, ['--user', 'start', 'cond-fail.service']);
    await waitFor(() => /^cond-fail\.service \S+ failed/m.test(rows(home)), 15_000);
    expect(existsSync(ran('fail'))).toBe(false);
  });

  it('a condition that exits 0 runs ExecStart', async () => {
    systemctl(home, ['--user', 'start', 'cond-pass.service']);
    await waitFor(() => existsSync(ran('pass')), 15_000);
    await waitFor(() => /^cond-pass\.service \S+ inactive dead/m.test(rows(home)), 15_000);
  });
});

describe('OnCalendar= in the shipped shapes (ccrc-ddns.timer\'s `*:0/5`, hourly, daily) is scheduled, not refused', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  beforeAll(async () => {
    const dir = unitDirOf(home);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'ddns-like.timer'), '[Timer]\nOnCalendar=*:0/5\nPersistent=true\n');
    writeFileSync(path.join(dir, 'ddns-like.service'), '[Service]\nType=oneshot\nExecStart=/bin/true\n');
    writeFileSync(path.join(dir, 'hourly-like.timer'), '[Timer]\nOnCalendar=hourly\n');
    writeFileSync(path.join(dir, 'hourly-like.service'), '[Service]\nType=oneshot\nExecStart=/bin/true\n');
    sup = await startSupervisor(home);
  });
  afterAll(() => stopSupervisor(sup));

  it('`enable --now` answers 0 and the timer waits, as systemd\'s would', () => {
    systemctl(home, ['--user', 'enable', '--now', 'ddns-like.timer']);
    systemctl(home, ['--user', 'enable', '--now', 'hourly-like.timer']);
    expect(rows(home)).toMatch(/^ddns-like\.timer loaded active waiting/m);
    expect(rows(home)).toMatch(/^hourly-like\.timer loaded active waiting/m);
  });
});

describe('a template timer instance (ccrc-codex-usage@<lane>.timer) runs from its installed template, %i its instance', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  const ticks = path.join(home, 'tpl-ticks');
  beforeAll(async () => {
    const dir = unitDirOf(home);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'tpl-poll@.timer'), '[Timer]\nOnActiveSec=1s\nOnUnitActiveSec=1s\n');
    writeFileSync(path.join(dir, 'tpl-poll@.service'),
      "[Service]\nType=oneshot\nEnvironment=LANE=%i\nExecStart=/bin/sh -c 'echo \"%i $$LANE\" >> %h/tpl-ticks'\n");
    sup = await startSupervisor(home);
  });
  afterAll(() => stopSupervisor(sup));

  it('`enable --now tpl-poll@lane-a.timer` runs tpl-poll@lane-a.service with %i in ExecStart and Environment', async () => {
    systemctl(home, ['--user', 'enable', '--now', 'tpl-poll@lane-a.timer']);
    await waitFor(() => existsSync(ticks) && readFileSync(ticks, 'utf8').trim() !== '', 15_000);
    expect(readFileSync(ticks, 'utf8').trim().split('\n')[0]).toBe('lane-a lane-a');
  });
});

describe('StartLimitIntervalSec=/StartLimitBurst=: the unit file\'s own, else systemd\'s 10 s and 5', () => {
  let sup: ChildProcess | undefined;
  afterAll(() => stopSupervisor(sup));

  it('claude-session@.service\'s declared burst is read from its file (8 here, not a fixed 5)', async () => {
    const home = seedHome();
    mkdirSync(unitDirOf(home), { recursive: true });
    writeFileSync(path.join(unitDirOf(home), 'claude-session@.service'),
      '[Unit]\nStartLimitIntervalSec=120\nStartLimitBurst=8\n\n[Service]\nType=simple\nRestart=always\n');
    sup = await startSupervisor(home, { CCRC_SUPERVISOR_EXEC: 'exit 1', CCRC_SUPERVISOR_RESTART_SEC: '0' });
    systemctl(home, ['--user', 'start', UNIT]);
    await waitFor(() => /claude-session@demo\.service loaded failed/.test(listUnits(home)), 15_000);
    expect(prop(home, UNIT, 'NRestarts')).toBe('8');
    sup.kill();
  });

  it('ccrc.service, which declares none, keeps restarting past five crashes spaced over 10 s', async () => {
    // Under the old fixed 120 s/5 the sixth start (~12.5 s in) left it failed; systemd's 10 s window never fills.
    const home = seedHome();
    const entry = path.join(home, 'ccrc', 'server', 'dist', 'server', 'src', 'index.js');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, 'process.exit(1);\n');
    sup = await startSupervisor(home, { CCRC_SUPERVISOR_RESTART_SEC: '2.5' });
    systemctl(home, ['--user', 'start', 'ccrc.service']);
    await waitFor(() => Number(prop(home, 'ccrc.service', 'NRestarts')) >= 6, 40_000);
    expect(prop(home, 'ccrc.service', 'ActiveState')).not.toBe('failed');
  }, 60_000);
});

describe('journalctl shim: --since, -g/--grep and -f', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  const journal = path.join(home, '.ccrc', 'supervisor', 'journal', 'fake.service.log');
  beforeAll(async () => {
    sup = await startSupervisor(home);
    mkdirSync(path.dirname(journal), { recursive: true });
    writeFileSync(journal, '--- 2020-01-01T00:00:00.000Z start #1: x\nold-line\n'
      + '--- 2020-06-01T00:00:00.000Z start #2: x\nmid-line killed by the OOM killer\n'
      + '--- 2030-01-01T00:00:00.000Z start #3: x\nnew-line\n');
  });
  afterAll(() => stopSupervisor(sup));
  const jc = (args: string[]): string => shim(home, 'journalctl', ['--user', '-u', 'fake.service', '-n', '50', ...args]).out;

  it('--since @<epoch> drops the runs that ended before it (the run going at that time is kept whole)', () => {
    const out = jc(['--since', `@${Date.parse('2020-07-01T00:00:00Z') / 1000}`]);
    expect(out).toContain('mid-line');
    expect(out).toContain('new-line');
    expect(out).not.toContain('old-line');
  });

  it('--since "<date>" reads a date as well', () => {
    expect(jc(['--since', '2020-07-01 00:00:00'])).not.toContain('old-line');
  });

  it('-g keeps only matching lines, smart case as journalctl (ccd\'s OOM check)', () => {
    expect(jc(['-q', '-g', 'killed by the oom killer']).trim()).toBe('mid-line killed by the OOM killer');
    expect(jc(['-g', 'OOM']).trim()).toBe('mid-line killed by the OOM killer');
    expect(jc(['-g', 'Oom']).trim()).toBe('');
  });

  it('-f follows the journal: a line appended afterwards is printed', async () => {
    let out = '';
    const f = spawn('bash', ['-c', `timeout 15 bash "${posix(path.join(SHIM_BIN, 'journalctl'))}" --user -u fake.service -n 0 -f`],
      { env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'ignore'] });
    f.stdout?.on('data', (b) => { out += String(b); });
    try {
      // Appended until seen: under MSYS `tail -F` can take longer than a fixed sleep to start, and a line written before
      // it opens the file is behind its `-n 0` (measured: one run in two missed it).
      const deadline = Date.now() + 12_000;
      while (!out.includes('followed-line') && Date.now() < deadline) {
        appendFileSync(journal, 'followed-line\n');
        await new Promise((r) => setTimeout(r, 750));
      }
      expect(out).toContain('followed-line');
      expect(out).not.toContain('old-line');
    } finally { f.kill(); }
  });
});

describe('a clean stop of ccrc.service runs the server\'s shutdown handler (the breaker seal), on Windows too', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  const up = path.join(home, 'server-up');
  const sealed = path.join(home, 'server-sealed');
  beforeAll(async () => {
    // A stand-in server: the REAL installShutdownSeal (type-stripped), whose seal writes a file.
    const entry = path.join(home, 'ccrc', 'server', 'dist', 'server', 'src', 'index.js');
    mkdirSync(path.dirname(entry), { recursive: true });
    const seal = pathToFileURL(path.join(root, 'server', 'src', 'shutdownseal.ts')).href;
    writeFileSync(entry, [
      "import { writeFileSync } from 'node:fs';",
      `const { installShutdownSeal } = await import(${JSON.stringify(seal)});`,
      'installShutdownSeal({ stop() {}, async sealDeadCoordinatorBreaker() {',
      `  writeFileSync(${JSON.stringify(sealed)}, 'x'); return { sealed: true, generation: 1 }; } });`,
      `writeFileSync(${JSON.stringify(up)}, 'x');`,
      'setInterval(() => {}, 1000);',
    ].join('\n') + '\n');
    sup = await startSupervisor(home, { NODE_OPTIONS: '--experimental-strip-types --no-warnings' });
  });
  afterAll(() => stopSupervisor(sup));

  it('`systemctl stop ccrc.service` lets the handler seal before the process ends', async () => {
    systemctl(home, ['--user', 'start', 'ccrc.service']);
    await waitFor(() => existsSync(up), 15_000);
    systemctl(home, ['--user', 'stop', 'ccrc.service']);
    await waitFor(() => existsSync(sealed), 8000);
    await waitFor(() => prop(home, 'ccrc.service', 'MainPID') === '0', 8000);
  });
});

describe('a restart whose old server ignores the shutdown message keeps ONE new server (no stale-exit restart loop)', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  const starts = path.join(home, 'starts');
  beforeAll(async () => {
    // An OLD server: it has no shutdown handler, so it ignores the message and lives until the bound kills it.
    const entry = path.join(home, 'ccrc', 'server', 'dist', 'server', 'src', 'index.js');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, [
      "import { appendFileSync } from 'node:fs';",
      `appendFileSync(${JSON.stringify(starts)}, process.pid + '\\n');`,
      "process.on('message', () => {});",
      'setInterval(() => {}, 1000);',
    ].join('\n') + '\n');
    sup = await startSupervisor(home);
  });
  afterAll(() => stopSupervisor(sup));

  it('the old child\'s late exit after the restart does not schedule another start', async () => {
    systemctl(home, ['--user', 'start', 'ccrc.service']);
    await waitFor(() => existsSync(starts), 15_000);
    systemctl(home, ['--user', 'restart', 'ccrc.service']);
    await waitFor(() => readFileSync(starts, 'utf8').trim().split('\n').length >= 2, 30_000);
    await new Promise((r) => setTimeout(r, 8000));   // past the old child's kill and exit
    expect(readFileSync(starts, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(prop(home, 'ccrc.service', 'NRestarts')).toBe('0');
    expect(prop(home, 'ccrc.service', 'ActiveState')).toBe('active');
  }, 60_000);
});

describe.skipIf(process.platform !== 'win32')('a unit\'s POSIX PATH= on Windows (ccrc-models.service)', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  beforeAll(async () => {
    mkdirSync(path.join(home, 'bin'), { recursive: true });
    mkdirSync(unitDirOf(home), { recursive: true });
    writeFileSync(path.join(unitDirOf(home), 'pathprobe.service'),
      '[Service]\nType=oneshot\nEnvironment=PATH=%h/bin:/usr/local/bin:/usr/bin:/bin\n'
      + 'ExecStart=/bin/sh -c \'echo "$$(command -v node)|$$(echo "$$PATH" | cut -d: -f1)" > %h/pathout\'\n');
    sup = await startSupervisor(home, { CCRC_SUPERVISOR_SHELL: resolveBash(), XDG_RUNTIME_DIR: path.join(home, 'run'), TMUX_TMPDIR: path.join(home, 'tt') });
  });
  afterAll(() => stopSupervisor(sup));

  it('puts the unit\'s directories first in Windows spelling, and keeps the box\'s own (node stays reachable)', async () => {
    systemctl(home, ['--user', 'start', 'pathprobe.service']);
    const out = path.join(home, 'pathout');
    await waitFor(() => existsSync(out) && readFileSync(out, 'utf8').trim() !== '', 15_000);
    const [node, first] = readFileSync(out, 'utf8').trim().split('|');
    expect(node, 'node is still on PATH').not.toBe('');
    expect(first!.toLowerCase()).toContain('/bin');
    expect(first!.toLowerCase()).toContain(path.basename(home).toLowerCase());
  });
});

describe('Persistent=true (ccrc-ddns.timer): a calendar run missed while the manager was down runs once at its start', () => {
  // `daily` so no boundary falls inside the test's few seconds: any tick here is the catch-up, or the bug.
  const home = seedHome();
  let sup: ChildProcess | undefined;
  const dayAgo2 = Date.now() - 2 * 86_400_000;
  const stamps = path.join(home, '.ccrc', 'supervisor', 'timer-stamps.json');
  const ticks = (n: string): string => path.join(home, `${n}-ticks`);
  beforeAll(async () => {
    const dir = unitDirOf(home);
    const wants = path.join(dir, 'default.target.wants');
    mkdirSync(wants, { recursive: true });
    // missed: persistent, last ran two days ago. never: persistent, no stamp, enabled two days ago.
    // plain: no Persistent=, last ran two days ago. fresh: persistent, ran just now.
    const timers: Record<string, string> = {
      missed: 'Persistent=true\n', never: 'Persistent=true\n', plain: '', fresh: 'Persistent=true\n',
    };
    for (const [n, extra] of Object.entries(timers)) {
      writeFileSync(path.join(dir, `p-${n}.timer`), `[Timer]\nOnCalendar=daily\n${extra}`);
      writeFileSync(path.join(dir, `p-${n}.service`), `[Service]\nType=oneshot\nExecStart=/bin/sh -c 'echo x >> %h/${n}-ticks'\n`);
      writeFileSync(path.join(wants, `p-${n}.timer`), `p-${n}.timer\n`);
      execFileSync('bash', ['-c', `touch -d '2 days ago' "${posix(path.join(wants, `p-${n}.timer`))}"`]);
    }
    mkdirSync(path.dirname(stamps), { recursive: true });
    writeFileSync(stamps, JSON.stringify({ 'p-missed.timer': dayAgo2, 'p-plain.timer': dayAgo2, 'p-fresh.timer': Date.now() }));
    sup = await startSupervisor(home);
  });
  afterAll(() => stopSupervisor(sup));

  it('fires the missed and the enabled-but-never-run persistent timers once, records the trigger, and leaves the rest waiting', async () => {
    await waitFor(() => existsSync(ticks('missed')) && existsSync(ticks('never')), 15_000);
    const recorded = JSON.parse(readFileSync(stamps, 'utf8')) as Record<string, number>;
    expect(recorded['p-missed.timer']).toBeGreaterThan(dayAgo2);
    expect(typeof recorded['p-never.timer']).toBe('number');
    await new Promise((r) => setTimeout(r, 2000));
    expect(readFileSync(ticks('missed'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(existsSync(ticks('plain')), 'no Persistent=: nothing is caught up').toBe(false);
    expect(existsSync(ticks('fresh')), 'nothing was missed since its last run').toBe(false);
    expect(rows(home)).toMatch(/^p-missed\.timer loaded active waiting/m);
  });
});

describe('ccrc-agent.service (the fleet role) runs from its installed unit file: node itself, its EnvironmentFile, Restart=always', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  const out = path.join(home, 'agent-runs');
  const AGENT = 'ccrc-agent.service';
  beforeAll(async () => {
    mkdirSync(unitDirOf(home), { recursive: true });
    // The SHIPPED unit, byte for byte: `ccrc install --role fleet` places it so (`_inst_units`).
    writeFileSync(path.join(unitDirOf(home), AGENT), readFileSync(path.join(root, 'deploy', AGENT), 'utf8'));
    writeFileSync(path.join(home, '.ccrc', 'agent.env'), 'AGENT_PROBE=from-env-file\n');
    const entry = path.join(home, 'ccrc', 'agent', 'dist', 'agent', 'src', 'index.js');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, [
      "import { appendFileSync } from 'node:fs';",
      `appendFileSync(${JSON.stringify(out)}, process.pid + ' ' + process.env.AGENT_PROBE + '\\n');`,
      'setInterval(() => {}, 1000);',
    ].join('\n') + '\n');
    sup = await startSupervisor(home, { CCRC_SUPERVISOR_RESTART_SEC: '0' });
  });
  afterAll(() => {
    try { systemctl(home, ['--user', 'stop', AGENT]); } catch { /* the manager is gone */ }
    sup?.kill();
  });

  it('starts it (no 409), as the process the manager holds, with agent.env in its environment', async () => {
    systemctl(home, ['--user', 'start', AGENT]);
    await waitFor(() => existsSync(out), 15_000);
    const [pid, probe] = readFileSync(out, 'utf8').trim().split(' ');
    expect(probe).toBe('from-env-file');
    expect(prop(home, AGENT, 'MainPID'), 'node is the direct child, no shell stub in front').toBe(pid);
  });

  it('a died agent comes back (Restart=always)', async () => {
    const pid = Number(readFileSync(out, 'utf8').trim().split(' ')[0]);
    process.kill(pid);
    await waitFor(() => readFileSync(out, 'utf8').trim().split('\n').length >= 2, 15_000);
    await waitFor(() => prop(home, AGENT, 'ActiveState') === 'active', 5000);
    expect(prop(home, AGENT, 'NRestarts')).toBe('1');
  });
});

describe.skipIf(process.platform !== 'win32')('MemoryMax= on Windows: a Job Object caps the unit\'s whole process tree', () => {
  const home = seedHome();
  let sup: ChildProcess | undefined;
  const ran = (n: string): string => path.join(home, `alloc-ran-${n}`);
  beforeAll(async () => {
    const dir = unitDirOf(home);
    mkdirSync(path.join(dir, 'alloc-capped.service.d'), { recursive: true });
    // Allocates (and touches) 512 MiB AFTER writing its marker, so a failure is the allocation's, not a start's.
    const unitText = (n: string, extra: string): string => '[Service]\nType=oneshot\n' + extra
      + `ExecStart='${posix(process.execPath)}' -e "require('fs').writeFileSync(process.argv[1], '1'); Buffer.alloc(512 * 2 ** 20, 1)" %h/alloc-ran-${n}\n`;
    // The file says no cap and a drop-in sets one (claude-session@'s shape): the last assignment wins, as in systemd.
    writeFileSync(path.join(dir, 'alloc-capped.service'), unitText('capped', 'MemoryMax=infinity\n'));
    writeFileSync(path.join(dir, 'alloc-capped.service.d', 'limits.conf'), '[Service]\nMemoryMax=128M\n');
    writeFileSync(path.join(dir, 'alloc-free.service'), unitText('free', ''));
    sup = await startSupervisor(home, { CCRC_SUPERVISOR_SHELL: resolveBash() });
  });
  afterAll(() => stopSupervisor(sup));

  it('a unit capped at 128M that allocates 512M fails', async () => {
    systemctl(home, ['--user', 'start', 'alloc-capped.service']);
    await waitFor(() => /^alloc-capped\.service \S+ (failed|inactive)/m.test(rows(home)), 60_000);
    expect(existsSync(ran('capped')), 'it ran, so the failure is the allocation').toBe(true);
    expect(rows(home)).toMatch(/^alloc-capped\.service \S+ failed/m);
    expect(readFileSync(path.join(home, '.ccrc', 'supervisor', 'supervisor.log'), 'utf8'))
      .toMatch(/memory cap alloc-capped\.service pid=\d+ MemoryMax=134217728$/m);
  }, 90_000);

  it('the same unit with no MemoryMax= succeeds', async () => {
    systemctl(home, ['--user', 'start', 'alloc-free.service']);
    await waitFor(() => /^alloc-free\.service \S+ (failed|inactive)/m.test(rows(home)), 60_000);
    expect(existsSync(ran('free'))).toBe(true);
    expect(rows(home)).toMatch(/^alloc-free\.service \S+ inactive dead/m);
  }, 90_000);
});

describe.skipIf(process.platform !== 'win32')('systemd-run --scope --unit=ccrc-tmux-server: the fleet\'s tmux server is the MANAGER\'s child, never a capped caller\'s', () => {
  const home = seedHome();
  const sh = resolveBash();
  let sup: ChildProcess | undefined;
  // A stand-in for tmux (never the real one): writes its own Windows ancestry (its pid, its parent, ...) and one
  // exported variable of its caller, then exits with the code it is given.
  const probe = path.join(home, 'ancestry.cjs');
  writeFileSync(probe, [
    "const { execFileSync } = require('child_process');",
    "const rows = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',",
    "  'Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }'], { encoding: 'utf8' });",
    "const parent = new Map(rows.split(/\\r?\\n/).map((l) => l.trim().split(' ').map(Number)).filter((a) => a.length === 2));",
    'const chain = [];',
    'for (let p = process.pid; p && !chain.includes(p) && chain.length < 64; p = parent.get(p)) chain.push(p);',
    "require('fs').writeFileSync(process.argv[2], JSON.stringify({ chain, mark: process.env.CCRC_SCOPE_MARK ?? null }));",
    'process.exit(Number(process.argv[3]));',
  ].join('\n') + '\n');

  /** The shim as ccd runs it, from a caller of our own: the caller's pid, its exit code, what the stand-in wrote. */
  async function scope(n: string): Promise<{ caller: number; rc: number | null; chain: number[]; mark: string | null }> {
    const out = path.join(home, `scope-${n}.json`);
    const c = spawn(sh, [posix(path.join(SHIM_BIN, 'systemd-run')), '--user', '--scope', '--quiet', '--collect',
      '--unit=ccrc-tmux-server', '--slice=app-claude\\x2dsession.slice', posix(process.execPath), posix(probe), posix(out), '7'], {
      env: { ...process.env, HOME: home, CCRC_SCOPE_MARK: `from-the-caller-${n}`, PATH: `${path.dirname(sh)}${path.delimiter}${process.env['PATH']}` },
      stdio: 'ignore',
    });
    const rc = await new Promise<number | null>((r) => c.on('exit', (code) => r(code)));
    const got = JSON.parse(readFileSync(out, 'utf8')) as { chain: number[]; mark: string | null };
    return { caller: c.pid!, rc, ...got };
  }

  beforeAll(async () => { sup = await startSupervisor(home, { CCRC_SUPERVISOR_SHELL: sh }); });
  afterAll(() => stopSupervisor(sup));

  it('runs the command under the manager, not under its caller, with the caller\'s environment, and returns its exit code', async () => {
    const r = await scope('up');
    expect(r.rc).toBe(7);
    expect(r.chain, 'the manager is an ancestor').toContain(sup!.pid);
    expect(r.chain, 'the caller (a capped unit, in production) is not').not.toContain(r.caller);
    expect(r.mark).toBe('from-the-caller-up');
  }, 90_000);

  it('with the manager down (its endpoint stale), still runs the command, as the caller\'s child', async () => {
    stopSupervisor(sup);
    await waitFor(() => !spawnSync('tasklist', ['/FI', `PID eq ${sup!.pid}`, '/NH'], { encoding: 'utf8' }).stdout.includes(String(sup!.pid)), 15_000);
    expect(existsSync(path.join(home, '.ccrc', 'supervisor', 'endpoint.json'))).toBe(true);
    const r = await scope('down');
    expect(r.rc).toBe(7);
    expect(r.chain).toContain(r.caller);
    expect(r.mark).toBe('from-the-caller-down');
  }, 90_000);
});

/** A fixture manager's PATH: node's and bash's own directories and the OS's, never `~/.local/bin` (on a dev box the LIVE
 *  ccd, ccrc and systemctl) or anything else the parent carries. */
function containedPath(): string {
  const bash = resolveBash();
  const own = [path.dirname(process.execPath), ...(path.isAbsolute(bash) ? [path.dirname(bash)] : [])];
  const sysRoot = (process.env['SystemRoot'] ?? 'C:\\Windows').toLowerCase();
  const system = (d: string): boolean => (process.platform === 'win32'
    ? d.toLowerCase().startsWith(sysRoot) : ['/usr/local/bin', '/usr/bin', '/bin'].includes(d));
  return [...own, ...(process.env['PATH'] ?? '').split(path.delimiter).filter((d) => d && !own.includes(d) && system(d))]
    .join(path.delimiter);
}

describe('a start behind a stopping process waits for its end, as systemd queues the start job behind the stop job', () => {
  // One copy of a unit, ever: a `ccd supervise` stopped by a swap or revive and started again at once ran twice. Each copy
  // appends `start <pid> alive=<pids of earlier copies still running>` to its log and takes 2 s to end once asked or
  // TERMed (`slow`: 6 s, past the 3 s bound). On Windows TERM is TerminateProcess, so a copy there is the grandchild
  // MSYS's exec stub keeps, which lives until the stop's descendant kill; the asked ccrc.service is slow on both.
  const home = seedHome();
  let sup: ChildProcess | undefined;
  const copy = path.join(home, 'copy.cjs');
  const log = (n: string): string => path.join(home, `copies-${n}`);
  const fwd = (p: string): string => p.replace(/\\/g, '/');
  const copySource = (logFile: string | null): string => [
    "const fs = require('fs');",
    `const log = ${logFile === null ? 'process.argv[2]' : JSON.stringify(logFile)};`,
    `const ms = ${logFile === null ? "process.argv[3] === 'slow' ? 6000 : 2000" : '2000'};`,
    "const prev = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').filter(Boolean).map((l) => Number(l.split(' ')[1])) : [];",
    'const alive = prev.filter((p) => { try { process.kill(p, 0); return true; } catch { return false; } });',
    "fs.appendFileSync(log, `start ${process.pid} alive=${alive.join(',')}\\n`);",
    'const end = () => setTimeout(() => process.exit(0), ms);',
    "process.on('SIGTERM', end);",
    "process.on('message', (m) => { if (m && m.type === 'shutdown') end(); });",
    'setInterval(() => {}, 1000);',
  ].join('\n') + '\n';
  const copies = (n: string): string[] => (existsSync(log(n)) ? readFileSync(log(n), 'utf8').trim().split('\n').filter(Boolean) : []);

  async function call(p: string, body?: unknown): Promise<{ status: number; text: string }> {
    const ep = JSON.parse(readFileSync(path.join(home, '.ccrc', 'supervisor', 'endpoint.json'), 'utf8')) as { port: number; token: string };
    const r = await fetch(`http://127.0.0.1:${ep.port}${p}`, {
      method: 'POST', headers: { 'x-ccrc-sup-token': ep.token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, text: await r.text() };
  }
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    writeFileSync(copy, copySource(null));
    const entry = path.join(home, 'ccrc', 'server', 'dist', 'server', 'src', 'index.js');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, copySource(log('server')));
    const PATH = containedPath();
    sup = await startSupervisor(home, {
      // Both spellings: Windows' inherited key is `Path`, and a second key beside it would leave which one wins open. The
      // shell stays bare: MSYS's bash is first on that PATH, ahead of System32's WSL launcher.
      PATH, ...(process.platform === 'win32' ? { Path: PATH } : {}),
      CCRC_SUPERVISOR_EXEC: `"${fwd(process.execPath)}" "${fwd(copy)}" "${fwd(home)}/copies-%i" %i`,
    });
  });
  afterAll(() => {
    // The manager does not hold a copy it gave up on (past the bound): end every one the logs name.
    for (const n of ['quick', 'slow', 'tr', 'server']) for (const l of copies(n)) { try { process.kill(Number(l.split(' ')[1]), 'SIGKILL'); } catch { /* gone */ } }
    stopSupervisor(sup);
  });

  it.each([['claude-session@quick.service', 'quick'], ['ccrc.service', 'server']])(
    'stop then start at once (%s): one copy at a time, the second only after the first ended, two starts one spawn',
    async (name, n) => {
      const U = `/units/${name}`;
      try {
        expect((await call(`${U}/start`)).status).toBe(200);
        await waitFor(() => copies(n).length === 1, 15_000);
        await call(`${U}/stop`);
        const [a, b] = await Promise.all([call(`${U}/start`), call(`${U}/start`)]);
        expect([a.status, b.status]).toEqual([200, 200]);
        await waitFor(() => copies(n).length >= 2, 15_000);
        await sleep(3000);
        expect(copies(n)).toHaveLength(2);
        expect(copies(n)[1], 'the first copy had ended when the second started').toMatch(/alive=$/);
      } finally {
        // No copy left for the next case, whatever this one measured.
        await call(`${U}/stop`);
        for (const l of copies(n)) { try { process.kill(Number(l.split(' ')[1]), 'SIGKILL'); } catch { /* gone */ } }
        await sleep(2000);
      }
    }, 60_000);

  it('the same for a transient started again under the name of one still stopping', async () => {
    const spec = { unit: 'tr-quick.service', argv: [fwd(process.execPath), fwd(copy), fwd(log('tr')), 'quick'] };
    expect((await call('/transient', spec)).status).toBe(200);
    await waitFor(() => copies('tr').length === 1, 15_000);
    await call('/units/tr-quick.service/stop');
    expect((await call('/transient', spec)).status).toBe(200);
    await waitFor(() => copies('tr').length >= 2, 15_000);
    await sleep(1000);
    expect(copies('tr')).toHaveLength(2);
    expect(copies('tr')[1], 'the first copy had ended when the second started').toMatch(/alive=$/);
  }, 60_000);

  // Past the bound needs a process that outlives its TERM, which Windows' TerminateProcess never leaves.
  it.skipIf(process.platform === 'win32')('a start still waiting at the stop\'s bound is refused, and its reply is answered', async () => {
    const U = '/units/claude-session@slow.service';
    await call(`${U}/start`);
    await waitFor(() => copies('slow').length === 1, 15_000);
    await call(`${U}/stop`);
    const t0 = Date.now();
    const r = await call(`${U}/start`);
    expect(r.status).toBe(409);
    expect(r.text).toMatch(/refused, its pid=\d+ still runs past its stop's bound; never started beside it/);
    expect(Date.now() - t0, 'held until the bound, not refused at once').toBeGreaterThan(2000);
    expect((await call(`${U}/start`)).status, 'and refused at once while it still runs').toBe(409);
    expect(copies('slow')).toHaveLength(1);
    await sleep(4500);   // the slow copy has ended: a start runs again
    await call(`${U}/reset-failed`);
    expect((await call(`${U}/start`)).status).toBe(200);
    await waitFor(() => copies('slow').length === 2, 15_000);
    expect(copies('slow')[1]).toMatch(/alive=$/);
  }, 60_000);

  it('a stop during the wait cancels the queued start, and answers it', async () => {
    const U = '/units/ccrc.service';
    const before = copies('server').length;
    expect((await call(`${U}/start`)).status).toBe(200);
    await waitFor(() => copies('server').length === before + 1, 15_000);
    await call(`${U}/stop`);
    const held = call(`${U}/start`);
    await sleep(300);
    await call(`${U}/stop`);
    const r = await held;
    expect(r.status).toBe(409);
    expect(r.text).toMatch(/cancelled by a stop/);
    await sleep(4000);
    expect(copies('server')).toHaveLength(before + 1);
  }, 60_000);
});
