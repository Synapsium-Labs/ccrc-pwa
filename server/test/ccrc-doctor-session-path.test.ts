// D-8047: what doctor's `path` and `graphify-path` measure, and the `playwright` check.
//
// A session does not run on the PATH of whoever ran doctor. `ccrc update` adds `$HOME/.local/bin` to its own PATH, so
// both checks passed on a box where a session's bare `ccrc` and `graphify` answered "command not found". These rows
// give the fixture a session PATH that differs from doctor's own, the one shape that tells the two measurements apart,
// and run each printed remedy for real: a remedy that does not clear its own verdict is the defect these rows exist for.
//
// `playwright` launches stub builds: the check's contract is what it does with a build that starts, one the loader
// refuses and one that stays up, not any browser's own behaviour.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { BASH, CCRC_SRC, CHECKS_SRC, REPO, doctorEnv, healthy, installDoctorHooks, lineFor, realPath, runDoctor, shq, stub } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();
installDoctorHooks();

const localBin = (home: string): string => join(home, '.local', 'bin');

/** Live panes, each with its own PATH in a fixture proc tree: `[session name, PATH]` rows. */
function plantPanes(home: string, panes: Array<[string, string]>): void {
  panes.forEach(([, path], i) => {
    const dir = join(home, 'fixture-proc', String(4000 + i));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'environ'), `HOME=${home}\0PATH=${path}\0COLORTERM=truecolor\0`);
  });
  writeFileSync(join(home, 'fixture-tmux-panes'), panes.map(([name], i) => `${name} ${4000 + i}\n`).join(''));
}

/** A directory OUTSIDE the fixture home, as a system directory is, and already on the session PATH. */
const systemBin = (): string => {
  const dir = join(mkTmp('ccrc-doctor-sysroot-'), 'usr', 'bin');
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** The three commands a session calls bare, installed where the deploy puts them. */
function installCommands(home: string): void {
  for (const c of ['ccrc', 'ccd', 'ccrc-api']) {
    writeFileSync(join(localBin(home), c), `#!/bin/sh\necho "${c} ran: $*"\n`, { mode: 0o755 });
  }
}

/** The pinned engine and its link, which is all `graphify-path` reads. */
function plantEngine(home: string): string {
  const engine = join(home, '.ccrc', 'graphify-venv', 'bin', 'graphify');
  mkdirSync(join(home, '.ccrc', 'graphify-venv', 'bin'), { recursive: true });
  writeFileSync(engine, '#!/bin/sh\necho "graphify ran"\n', { mode: 0o755 });
  rmSync(join(localBin(home), 'graphify'), { force: true });
  symlinkSync(engine, join(localBin(home), 'graphify'));
  return engine;
}

/** One check alone, sourced, with its verdict line, its remedy and the full output. */
function check(home: string, name: string, env: NodeJS.ProcessEnv = {}, os = 'linux'): { line: string; remedy: string; code: number; out: string } {
  const r = spawnSync(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\nCCD_OS=${os}; _check_${name}`],
    { env: { ...doctorEnv(home), ...env }, encoding: 'utf8', timeout: 60_000 });
  const out = r.stdout ?? '';
  const lines = out.split('\n');
  const i = lines.findIndex((l) => new RegExp(`^(PASS|WARN|FAIL|SKIP) ${name}: `).test(l));
  expect(i, `a ${name} line: ${out}${r.stderr}`).toBeGreaterThanOrEqual(0);
  return { line: lines[i] ?? '', remedy: lines[i + 1] ?? '', code: r.status ?? -1, out };
}

/** Runs what a remedy says to do, as the operator would paste it. */
function runRemedy(remedy: string): void {
  const cmd = /as root: (.*?) — /.exec(remedy)?.[1];
  expect(cmd, `a paste-able command in: ${remedy}`).toBeTruthy();
  const r = spawnSync(BASH, ['-c', cmd ?? ''], { encoding: 'utf8', env: { PATH: `/usr/bin:/bin` } });
  expect(r.status, `${cmd}\n${r.stderr}`).toBe(0);
}

describe('ccrc doctor: path measures the PATH a session gets', () => {
  it('warns on a session PATH without $HOME/.local/bin, though doctor\'s own PATH has it', () => {
    const home = healthy('ccrc-doctor-spath-warn-'); installCommands(home);
    const sys = systemBin();
    plantPanes(home, [['cc-lane-a', `${sys}:/usr/bin`], ['cc-lane-b', `${sys}:/usr/bin`]]);
    const { line, remedy, code } = check(home, 'path');
    expect(line).toMatch(/^WARN path: 2 of 2 live sessions run without \$HOME\/\.local\/bin on PATH/);
    expect(line).toContain('ccrc, ccd, ccrc-api');
    expect(code).toBe(2);
    expect(remedy, 'a remedy that cannot reach a session').not.toMatch(/export PATH|\.profile.*then log in/);
    expect(remedy).toContain(sys);
  });

  it('counts only the sessions that lack it, and never a pane that is not a session', () => {
    const home = healthy('ccrc-doctor-spath-mixed-'); installCommands(home);
    plantPanes(home, [
      ['cc-lane-a', `${localBin(home)}:/usr/bin`],
      ['cc-lane-b', '/usr/bin'],
      ['operator-shell', '/usr/bin'],
    ]);
    expect(check(home, 'path').line).toMatch(/^WARN path: 1 of 2 live sessions run without/);
  });

  it('passes when every session has the directory, and says what it measured', () => {
    const home = healthy('ccrc-doctor-spath-ok-'); installCommands(home);
    plantPanes(home, [['cc-lane-a', `/usr/bin:${localBin(home)}`]]);
    const { line, code } = check(home, 'path', { PATH: join(home, 'stub-bin') });
    expect(line).toMatch(/^PASS path: /);
    expect(line).toContain('1 live session');
    expect(code).toBe(0);
  });

  it('the printed remedy clears the verdict: bare commands then run under the session PATH', () => {
    const home = healthy('ccrc-doctor-spath-cure-'); installCommands(home);
    const sys = systemBin();
    plantPanes(home, [['cc-lane-a', sys]]);
    runRemedy(check(home, 'path').remedy);
    const r = spawnSync(BASH, ['-c', 'ccd ws-list one'], { env: { PATH: `${sys}:/usr/bin:/bin` }, encoding: 'utf8' });
    expect(r.stdout, r.stderr).toBe('ccd ran: ws-list one\n');
    expect(check(home, 'path').line).toMatch(/^PASS path: /);
  });

  it('names only the commands that are missing, and only those this box installed', () => {
    const home = healthy('ccrc-doctor-spath-partial-'); installCommands(home);
    rmSync(join(localBin(home), 'ccrc-api'));
    const sys = systemBin();
    writeFileSync(join(sys, 'ccrc'), '#!/bin/sh\n', { mode: 0o755 });
    plantPanes(home, [['cc-lane-a', sys]]);
    const { line, remedy } = check(home, 'path');
    expect(line).toContain('ccd does not resolve');
    expect(remedy).toContain('in ccd; do');
  });

  it('a session PATH on a box with no ccrc command installed yet sends the operator to the install, not to a root step', () => {
    const home = healthy('ccrc-doctor-spath-uninstalled-');
    for (const c of ['ccrc', 'ccd', 'ccrc-api']) rmSync(join(localBin(home), c), { force: true });
    plantPanes(home, [['cc-lane-a', '/usr/bin']]);
    const { line, remedy } = check(home, 'path');
    expect(line).toMatch(/^WARN path: 1 of 1 live sessions run without .*no ccrc command is installed there yet/);
    expect(remedy).toMatch(/^ {2}remedy: run: ccrc install/);
  });

  it('with no live session, reads the user manager\'s PATH, which a supervised session inherits', () => {
    const home = healthy('ccrc-doctor-spath-manager-'); installCommands(home);
    const sys = systemBin();
    writeFileSync(join(home, 'fixture-manager-env'), `HOME=${home}\nLANG=C\nPATH=${sys}:/usr/bin\n`);
    const { line, remedy } = check(home, 'path');
    expect(line).toMatch(/^WARN path: a session started now would run without \$HOME\/\.local\/bin on PATH/);
    expect(remedy).toContain(sys);
  });

  it('a pane whose environment cannot be read is not a measurement: the manager answers instead', () => {
    const home = healthy('ccrc-doctor-spath-gone-'); installCommands(home);
    writeFileSync(join(home, 'fixture-tmux-panes'), 'cc-lane-a 4999\n');
    writeFileSync(join(home, 'fixture-manager-env'), `PATH=${localBin(home)}:/usr/bin\n`);
    const { line } = check(home, 'path');
    expect(line).toMatch(/^PASS path: /);
    expect(line).toContain('user manager');
  });

  it('with neither to read, this is the PATH doctor ran with, as it always was', () => {
    const home = healthy('ccrc-doctor-spath-none-');
    expect(check(home, 'path').line).toBe('PASS path: $HOME/.local/bin is in $PATH (position 1)');
  });

  it('on a server box no session runs, so the panes are not asked', () => {
    const home = healthy('ccrc-doctor-spath-server-');
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    plantPanes(home, [['cc-lane-a', '/usr/bin']]);
    expect(check(home, 'path').line).toBe('PASS path: $HOME/.local/bin is in $PATH (position 1)');
  });
});

describe('ccrc doctor: graphify-path measures the PATH a session gets', () => {
  it('FAILs a session PATH with no graphify, though doctor\'s own PATH resolves it', () => {
    const home = healthy('ccrc-doctor-sgfx-none-'); const engine = plantEngine(home);
    const sys = systemBin();
    plantPanes(home, [['cc-lane-a', sys]]);
    const { line, remedy, code } = check(home, 'graphify-path');
    expect(line).toMatch(/^FAIL graphify-path: 1 of 1 live sessions? run/);
    expect(code).toBe(1);
    expect(remedy).toContain(`ln -s '${engine}' '${sys}/graphify'`);
    expect(remedy, 'ccrc install cannot reach a session PATH').not.toMatch(/^ {2}remedy: run: ccrc install/);
  });

  it('the printed remedy clears the verdict', () => {
    const home = healthy('ccrc-doctor-sgfx-cure-'); plantEngine(home);
    const sys = systemBin();
    plantPanes(home, [['cc-lane-a', sys]]);
    runRemedy(check(home, 'graphify-path').remedy);
    expect(check(home, 'graphify-path').line).toMatch(/^PASS graphify-path: .*the PATH sessions get/);
  });

  it('with the engine missing too, the remedy builds it first', () => {
    const home = healthy('ccrc-doctor-sgfx-noengine-'); plantEngine(home);
    rmSync(join(home, '.ccrc', 'graphify-venv'), { recursive: true });
    rmSync(join(localBin(home), 'graphify'));
    const sys = systemBin();
    plantPanes(home, [['cc-lane-a', sys]]);
    const { line, remedy } = check(home, 'graphify-path');
    expect(line).toMatch(/^FAIL graphify-path: /);
    expect(remedy).toMatch(/^ {2}remedy: run: ccrc install .*then, as root: ln -s /);
  });

  it('FAILs the wrong build on any one session\'s PATH, and the remedy repoints that file', () => {
    const home = healthy('ccrc-doctor-sgfx-shadow-'); const engine = plantEngine(home);
    const sys = systemBin();
    writeFileSync(join(sys, 'graphify'), '#!/bin/sh\necho shadow\n', { mode: 0o755 });
    plantPanes(home, [['cc-lane-a', localBin(home)], ['cc-lane-b', sys]]);
    const { line, remedy } = check(home, 'graphify-path');
    expect(line).toMatch(/^FAIL graphify-path: /);
    expect(line).toContain(`${sys}/graphify`);
    expect(remedy).toContain(`ln -sfn '${engine}' '${sys}/graphify'`);
    expect(remedy, 'a session PATH cannot be reordered from here').not.toContain('ahead of it');
  });

  it('PASSes a session PATH that resolves the engine through a link in a system directory', () => {
    const home = healthy('ccrc-doctor-sgfx-link-'); const engine = plantEngine(home);
    const sys = systemBin();
    symlinkSync(engine, join(sys, 'graphify'));
    plantPanes(home, [['cc-lane-a', sys]]);
    expect(check(home, 'graphify-path').line).toMatch(/^PASS graphify-path: /);
  });
});

/** A cached build: `<root>/<name>/<rel>`, with Playwright's completion marker. */
function plantBuild(root: string, name: string, rel: string, body: string, complete = true): void {
  const exe = join(root, name, rel);
  mkdirSync(join(exe, '..'), { recursive: true });
  writeFileSync(exe, `#!/bin/sh\n${body}\n`);
  chmodSync(exe, 0o755);
  if (complete) writeFileSync(join(root, name, 'INSTALLATION_COMPLETE'), '');
}
const recordArgv = (log: string): string => `echo "$0 $*" >> '${log}'`;
const LOADER = 'echo "/cache/MiniBrowser: error while loading shared libraries: libicudata.so.74: cannot open shared object file: No such file or directory" >&2; exit 127';

describe('ccrc doctor: playwright', () => {
  const browserEnv = (home: string): NodeJS.ProcessEnv => ({
    PATH: `${join(home, 'stub-bin')}:/usr/bin:/bin`,
    PLAYWRIGHT_BROWSERS_PATH: join(home, 'pw'),
    CCRC_DOCTOR_BROWSER_TIMEOUT: '2',
  });

  it('SKIPs a box with no cached build', () => {
    const home = healthy('ccrc-doctor-pw-none-');
    const { line, code } = check(home, 'playwright', browserEnv(home));
    expect(line).toMatch(/^SKIP playwright: no Playwright browser build is cached at /);
    expect(code).toBe(3);
  });

  it('launches every build of every browser, and names each one it started', () => {
    const home = healthy('ccrc-doctor-pw-ok-'); const root = join(home, 'pw'); const log = join(home, 'argv.log');
    plantBuild(root, 'chromium-1217', 'chrome-linux/chrome', `${recordArgv(log)}; exit 0`);
    plantBuild(root, 'chromium-1200', 'chrome-linux64/chrome', `${recordArgv(log)}; exit 0`);
    plantBuild(root, 'chromium_headless_shell-1217', 'chrome-linux/headless_shell', `${recordArgv(log)}; exit 0`);
    plantBuild(root, 'firefox-1500', 'firefox/firefox', `${recordArgv(log)}; exit 0`);
    plantBuild(root, 'webkit-2215', 'pw_run.sh', `${recordArgv(log)}; exit 0`);
    const { line, code } = check(home, 'playwright', browserEnv(home));
    expect(line).toMatch(/^PASS playwright: /);
    for (const b of ['chromium-1200', 'chromium-1217', 'chromium_headless_shell-1217', 'firefox-1500', 'webkit-2215']) expect(line).toContain(b);
    expect(code).toBe(0);
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(5);
  });

  it('asks for no network: every browser opens about:blank, and the two that would call out point at a dead proxy', () => {
    const home = healthy('ccrc-doctor-pw-net-'); const root = join(home, 'pw'); const log = join(home, 'argv.log');
    plantBuild(root, 'chromium-1', 'chrome-linux/chrome', `${recordArgv(log)}; exit 0`);
    plantBuild(root, 'firefox-1', 'firefox/firefox', `${recordArgv(log)}; cp "$HOME/user.js" '${home}/user.js'; exit 0`);
    plantBuild(root, 'webkit-1', 'pw_run.sh', `${recordArgv(log)}; exit 0`);
    check(home, 'playwright', browserEnv(home));
    const argv = readFileSync(log, 'utf8');
    for (const l of argv.trim().split('\n')) {
      expect(l).toContain('--headless');
      expect(l).toContain('about:blank');
      expect(l).not.toMatch(/https?:/);
    }
    expect(argv).toContain('--proxy-server=127.0.0.1:9');
    expect(readFileSync(join(home, 'user.js'), 'utf8')).toContain('"network.proxy.type", 1');
  });

  it('a build the loader refuses is a WARN naming the library, and the box still passes', () => {
    const home = healthy('ccrc-doctor-pw-lib-'); const root = join(home, 'pw');
    plantBuild(root, 'webkit-2215', 'pw_run.sh', LOADER);
    plantBuild(root, 'chromium-1217', 'chrome-linux/chrome', 'exit 0');
    const { line, remedy, code } = check(home, 'playwright', browserEnv(home));
    expect(line).toMatch(/^WARN playwright: 1 of 2 cached browser builds cannot start: webkit-2215: libicudata\.so\.74/);
    expect(line).toContain('chromium-1217');
    expect(remedy).toContain('playwright install');
    expect(code).toBe(2);
  });

  it('a loader failure in a child is still a failure, though the browser itself stayed up', () => {
    const home = healthy('ccrc-doctor-pw-child-'); const root = join(home, 'pw');
    plantBuild(root, 'webkit-2215', 'pw_run.sh', `${LOADER.replace('; exit 127', '')}; exec /bin/sleep 30`);
    expect(check(home, 'playwright', browserEnv(home)).line).toMatch(/^WARN playwright: .*libicudata\.so\.74/);
  });

  it('any other failed start is a WARN quoting the browser\'s own last line', () => {
    const home = healthy('ccrc-doctor-pw-exit-'); const root = join(home, 'pw');
    plantBuild(root, 'firefox-1500', 'firefox/firefox', 'echo noise >&2; echo "Error: no display" >&2; exit 3');
    expect(check(home, 'playwright', browserEnv(home)).line).toMatch(/^WARN playwright: .*firefox-1500: exited 3: Error: no display/);
  });

  it('a browser that stays up has started, and is stopped at the bound', () => {
    const home = healthy('ccrc-doctor-pw-up-'); const root = join(home, 'pw');
    plantBuild(root, 'webkit-2215', 'pw_run.sh', 'exec /bin/sleep 30');
    const t0 = Date.now();
    expect(check(home, 'playwright', { ...browserEnv(home), CCRC_DOCTOR_BROWSER_TIMEOUT: '1' }).line).toMatch(/^PASS playwright: .*webkit-2215/);
    expect(Date.now() - t0).toBeLessThan(15_000);
  });

  it('a build with no launcher, or no completion marker, is a build failure and says so', () => {
    const home = healthy('ccrc-doctor-pw-build-'); const root = join(home, 'pw');
    mkdirSync(join(root, 'chromium-1217'), { recursive: true });
    writeFileSync(join(root, 'chromium-1217', 'INSTALLATION_COMPLETE'), '');
    plantBuild(root, 'firefox-1500', 'firefox/firefox', 'exit 0', false);
    const { line } = check(home, 'playwright', browserEnv(home));
    expect(line).toMatch(/^WARN playwright: 2 of 2 /);
    expect(line).toContain('chromium-1217: no launcher in the build');
    expect(line).toContain('firefox-1500: its download never finished');
  });

  it('reads only browser builds: ffmpeg, profiles and stray files are not launched', () => {
    const home = healthy('ccrc-doctor-pw-other-'); const root = join(home, 'pw');
    plantBuild(root, 'ffmpeg-1011', 'ffmpeg-linux', 'exit 1');
    mkdirSync(join(root, 'mcp-chrome-0b4186e'), { recursive: true });
    writeFileSync(join(root, '.links'), '');
    expect(check(home, 'playwright', browserEnv(home)).line).toMatch(/^SKIP playwright: /);
  });

  it('finds the default cache on each OS', () => {
    const home = healthy('ccrc-doctor-pw-root-');
    plantBuild(join(home, '.cache', 'ms-playwright'), 'chromium-1', 'chrome-linux/chrome', 'exit 0');
    plantBuild(join(home, 'Library', 'Caches', 'ms-playwright'), 'chromium-2', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'exit 0');
    const env = { ...browserEnv(home), PLAYWRIGHT_BROWSERS_PATH: '' };
    expect(check(home, 'playwright', env, 'linux').line).toMatch(/^PASS playwright: .*chromium-1\b/);
    expect(check(home, 'playwright', env, 'darwin').line).toMatch(/^PASS playwright: .*chromium-2\b/);
  });

  it('leaves no temp directory behind, and writes nothing into the cache or the home', () => {
    const home = healthy('ccrc-doctor-pw-clean-'); const root = join(home, 'pw');
    const tmp = mkTmp('ccrc-doctor-pw-tmp-');
    plantBuild(root, 'chromium-1', 'chrome-linux/chrome', 'touch "$HOME/made-by-browser"; exit 0');
    check(home, 'playwright', { ...browserEnv(home), TMPDIR: tmp });
    expect(readdirSync(tmp)).toEqual([]);
    expect(existsSync(join(home, 'made-by-browser'))).toBe(false);
  });

  it('a server box SKIPs: no session runs a browser there', () => {
    const home = healthy('ccrc-doctor-pw-server-'); const root = join(home, 'pw');
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    plantBuild(root, 'chromium-1', 'chrome-linux/chrome', 'exit 1');
    expect(check(home, 'playwright', browserEnv(home)).line).toMatch(/^SKIP playwright: /);
  });

  it('never fails the update path: a broken build leaves doctor\'s exit code at 0', () => {
    const home = healthy('ccrc-doctor-pw-exit0-'); const root = join(home, 'pw');
    plantBuild(root, 'webkit-2215', 'pw_run.sh', LOADER);
    // The whole run keeps the contained PATH, so the two tools the launch needs are stubbed onto it.
    for (const t of ['mktemp', 'rm']) stub(home, t, `exec '${realPath(t)}' "$@"`);
    const r = runDoctor(home, ['doctor'], { PLAYWRIGHT_BROWSERS_PATH: root, CCRC_DOCTOR_BROWSER_TIMEOUT: '2' });
    expect(lineFor(r.stdout, 'playwright')).toMatch(/^WARN playwright: /);
    expect(r.stdout).not.toMatch(/^FAIL playwright/m);
    expect(r.code, r.stdout).toBe(0);
  });

  it('holds no FAIL arm at all: the source has no way to print one', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    const body = /\n_check_playwright\(\) \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
    expect(body).toContain('_dr_warn playwright');
    expect(body).not.toContain('_dr_fail');
  });
});

describe('the box-move note', () => {
  it('tells the operator to try the bare commands under a session PATH', () => {
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
    const start = readme.indexOf('**After a box move.**');
    expect(start).toBeGreaterThan(-1);
    const note = readme.slice(start, readme.indexOf('**The temp-root collector', start));
    expect(note).toContain('command -v');
    expect(note).toContain('/proc/');
    expect(note).toContain('ccrc-api');
    expect(note).toContain('graphify');
  });
});
