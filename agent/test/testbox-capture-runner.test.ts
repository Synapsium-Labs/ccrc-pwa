// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.1, §2.3, §2.4) against
// a FAKE build (`fixtures/fake-claude-build.mjs`, never a real one), the real stand-in model, and the recorder's own source
// run under Node's type-stripping flag (no compile step). The tests' launcher pipes the build's stdin; the tmux launcher
// is run once, on a test-only socket, when a `tmux` binary is on PATH.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAPTURE_STEPS, CAPTURE_TOKEN, capturePaths, captureBuildsDir, captureEnv, captureWrites, staleCaptureDirs } from '../src/testbox/capture.js';
import { recorderPath } from '../src/testbox/captureRecord.js';
import { CAPTURE_SHELL, CAPTURE_START, CaptureRunner, capturePaneCommand, executableFile, groupLife, tmuxLauncher, type BuildLife, type CaptureLauncher, type CaptureRunnerDeps } from '../src/testbox/captureRunner.js';
import { startStandIn } from '../src/testbox/captureStub.js';
import { boundedExec } from '../src/testbox/exec.js';
import { tmuxTarget } from '../../shared/tmux-target.js';
import { mkTmp } from './tmpHelpers.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude-build.mjs');
const RECORDER = [process.execPath, '--experimental-strip-types', '--no-warnings', recorderPath()];
const NODE_DIR = path.dirname(process.execPath);
const GOOD = '2.1.100';
const NO_SUBAGENT_STOP = '2.1.999';
const HANGS = '2.1.998';
const NEVER_EXITS = '2.1.997';
const NO_SECOND_STOP = '2.1.996';
const NO_POST_MODEL_SWITCH = '2.1.995';

/** The test launcher: the build as a child with the spec's env as its WHOLE environment, stdin piped. */
const pipeLauncher: CaptureLauncher = {
  async start(spec) {
    const child: ChildProcess = spawn(process.execPath, [spec.binary], {
      cwd: spec.cwd, env: Object.fromEntries(spec.env), stdio: ['pipe', 'ignore', 'ignore'],
    });
    let exited = false;
    child.on('exit', () => { exited = true; });
    child.on('error', () => { exited = true; });
    return {
      type: async (text) => { child.stdin!.write(`${text}\n`); },
      life: async () => (exited ? 'gone' as const : 'alive' as const),
      stop: async () => { child.kill('SIGKILL'); },
    };
  },
};

function place(root: string, version: string): void {
  mkdirSync(captureBuildsDir(root), { recursive: true });
  const f = path.join(captureBuildsDir(root), version);
  copyFileSync(FIXTURE, f);
  chmodSync(f, 0o755);
}

function runner(root: string, over: Partial<CaptureRunnerDeps> = {}): CaptureRunner {
  return new CaptureRunner({
    root, tmuxBase: root, recorder: RECORDER, toolsPath: () => NODE_DIR, launcher: pipeLauncher, standIn: () => startStandIn(),
    stepTimeoutMs: 20_000, exitTimeoutMs: 10_000, pollMs: 50, stopWaitMs: 5000, standInCloseMs: 2000, ...over,
  });
}

const freshRoot = (): string => realpathSync(mkTmp('ccrc-caprun-'));
const gone = (root: string, id: string, build: string): boolean => !existsSync(capturePaths(root, id, build, root).dir) && !existsSync(capturePaths(root, id, build, root).tmux);

describe('a capture of a good build', () => {
  it('passes, proves the cwd, and removes its scratch directory', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const r = await runner(root).run('good', GOOD);
    expect(r.detail).toBeNull();
    expect(r.result?.output).toContain('verdict: pass');
    expect(r.result).toMatchObject({ build: GOOD, pass: true, cwd: true });
    expect(gone(root, 'good', GOOD)).toBe(true);
  }, 120_000);

  it('through a symlinked root still proves cwd (the runner compares against the work folder\'s real path)', async () => {
    const base = freshRoot();
    const real = path.join(base, 'real');
    mkdirSync(real);
    const link = path.join(base, 'link');
    symlinkSync(real, link);
    place(real, GOOD);
    const r = await runner(link).run('linked', GOOD);
    expect(r.result).toMatchObject({ pass: true, cwd: true });
    expect(gone(link, 'linked', GOOD)).toBe(true);
  }, 120_000);
});

describe('a build that started but stalled FAILS, naming what was never recorded (spec §2.4)', () => {
  it('one that never raises SubagentStop fails, its output naming SubagentStop', async () => {
    const root = freshRoot();
    place(root, NO_SUBAGENT_STOP);
    const r = await runner(root, { stepTimeoutMs: 8000 }).run('nosub', NO_SUBAGENT_STOP);
    expect(r.detail).toBeNull();
    expect(r.result?.pass).toBe(false);
    expect(r.result?.output).toContain('SubagentStop');
    expect(gone(root, 'nosub', NO_SUBAGENT_STOP)).toBe(true);
  }, 120_000);

  it('one that raises PreModelSwitch on the typed /model but never PostModelSwitch fails, naming it (door process B2)', async () => {
    const root = freshRoot();
    place(root, NO_POST_MODEL_SWITCH);
    const r = await runner(root, { stepTimeoutMs: 8000 }).run('nomodel', NO_POST_MODEL_SWITCH);
    expect(r.detail).toBeNull();
    expect(r.result?.pass).toBe(false);
    expect(r.result?.output).toContain('PostModelSwitch');
    expect(r.result?.output).not.toContain('event PreModelSwitch: never recorded');
    expect(gone(root, 'nomodel', NO_POST_MODEL_SWITCH)).toBe(true);
  }, 120_000);

  it('one that hangs at a step fails within the short deadline, the drive not finished', async () => {
    const root = freshRoot();
    place(root, HANGS);
    const t0 = Date.now();
    // The launcher reports the build gone at once, so only the DRIVE's own deadline can fail this capture (the exit wait,
    // which a hung build would also trip, is the next case's).
    const reportsExited: CaptureLauncher = { start: async (spec) => ({ ...(await pipeLauncher.start(spec)), life: async () => 'gone' as const }) };
    const r = await runner(root, { stepTimeoutMs: 8000, launcher: reportsExited }).run('hang', HANGS);
    expect(r.result?.pass).toBe(false);
    expect(r.result?.output).toContain('drive: did not finish every step');
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(gone(root, 'hang', HANGS)).toBe(true);
  }, 120_000);

  it('one whose subagent turn ends with no Stop fails: a step counts only the events recorded after the step before it', async () => {
    // Step two's Stop is on record from step one; were each step to count from the start, step two would look done and
    // the capture would pass (fix round 1, F12).
    const root = freshRoot();
    place(root, NO_SECOND_STOP);
    const r = await runner(root, { stepTimeoutMs: 8000 }).run('nostop', NO_SECOND_STOP);
    expect(r.detail).toBeNull();
    expect(r.result?.pass).toBe(false);
    expect(r.result?.output).toContain('drive: did not finish every step');
    expect(gone(root, 'nostop', NO_SECOND_STOP)).toBe(true);
  }, 120_000);

  it('one that never exits fails, the drive not finished', async () => {
    const root = freshRoot();
    place(root, NEVER_EXITS);
    const r = await runner(root, { exitTimeoutMs: 1500 }).run('noexit', NEVER_EXITS);
    expect(r.result?.pass).toBe(false);
    expect(r.result?.output).toContain('drive: did not finish every step');
    expect(gone(root, 'noexit', NEVER_EXITS)).toBe(true);
  }, 120_000);
});

describe('the capture environment (spec Table 3): no credential, no updater, no traffic beyond the stand-in', () => {
  it('captureEnv turns the updater and nonessential traffic off and gives the stand-in only the placeholder token', () => {
    const env = new Map(captureEnv(capturePaths('/srv/box', 'ab'.repeat(16), GOOD, '/tmp'), 4321, null));
    expect(env.get('DISABLE_AUTOUPDATER')).toBe('1');
    expect(env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')).toBe('1');
    expect(CAPTURE_TOKEN).toBe('ccrc-capture-stand-in');
    expect(env.get('ANTHROPIC_AUTH_TOKEN')).toBe(CAPTURE_TOKEN);
    expect(env.get('ANTHROPIC_BASE_URL')).toBe('http://127.0.0.1:4321');
    expect([...env.keys()].filter((k) => /KEY|SECRET|OAUTH|CREDENTIAL/.test(k))).toEqual([]);
  });

  it('TMPDIR is the capture\'s own tmp directory, inside its scratch directory and in the write guard\'s list', () => {
    const p = capturePaths('/srv/box', 'ab'.repeat(16), GOOD, '/tmp');
    expect(p.tmp).toBe(`${p.dir}/tmp`);
    expect(new Map(captureEnv(p, 4321, null)).get('TMPDIR')).toBe(p.tmp);
    expect(captureWrites(p)).toContain(p.tmp);
  });

  it('the runner makes that directory, mode 0700, before the build starts', async () => {
    const root = freshRoot();
    place(root, GOOD);
    let mode: number | null = null;
    const watching: CaptureLauncher = {
      start: async (spec) => { mode = statSync(new Map(spec.env).get('TMPDIR')!).mode & 0o777; return pipeLauncher.start(spec); },
    };
    await runner(root, { launcher: watching }).run('tmpd', GOOD);
    expect(mode).toBe(0o700);
  }, 120_000);

  it('the runner hands the launcher exactly that environment, as the whole of it', async () => {
    const root = freshRoot();
    place(root, GOOD);
    let seen: ReadonlyMap<string, string> | null = null;
    const watching: CaptureLauncher = { start: async (spec) => { seen = new Map(spec.env); return pipeLauncher.start(spec); } };
    await runner(root, { launcher: watching }).run('env', GOOD);
    const got = seen as ReadonlyMap<string, string> | null;
    expect(got?.get('DISABLE_AUTOUPDATER')).toBe('1');
    expect(got?.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')).toBe('1');
    expect(got?.get('ANTHROPIC_AUTH_TOKEN')).toBe(CAPTURE_TOKEN);
  }, 120_000);
});

describe('a capture that could not START answers no verdict, with why', () => {
  it('the stand-in failing to start', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const r = await runner(root, { standIn: () => Promise.reject(new Error('port in use')) }).run('nostub', GOOD);
    expect(r.result).toBeNull();
    expect(r.detail).toContain('port in use');
    expect(gone(root, 'nostub', GOOD)).toBe(true);
  });

  it('the launcher throwing (and the stand-in is closed)', async () => {
    const root = freshRoot();
    place(root, GOOD);
    let closed = false;
    const r = await runner(root, {
      launcher: { start: () => Promise.reject(new Error('no tmux here')) },
      standIn: async () => { const s = await startStandIn(); return { port: s.port, requests: s.requests, routes: s.routes, close: async () => { closed = true; await s.close(); } }; },
    }).run('nolaunch', GOOD);
    expect(r.result).toBeNull();
    expect(r.detail).toContain('no tmux here');
    expect(closed).toBe(true);
    expect(gone(root, 'nolaunch', GOOD)).toBe(true);
  });
});

// The suite puts a harmless stub `tmux` first on PATH (`contain-path.setup.ts`), so the real binary is looked for by its
// usual absolute places; the launcher is handed that path, and its own tmux server is `-L ccrc-capture` under the temp
// `TMUX_TMPDIR` the capture's environment names, never the fleet's.
const REAL_TMUX = ['/usr/bin/tmux', '/usr/local/bin/tmux', '/bin/tmux', '/opt/homebrew/bin/tmux']
  .find((f) => existsSync(f) && spawnSync(f, ['-V'], { encoding: 'utf8', timeout: 10_000, env: {} }).status === 0) ?? null;
const hasTmux = REAL_TMUX !== null;

/** What tmux's report of how a pane was started (`#{pane_start_command}`) says about the shell (review 3765 F3). tmux runs a
 *  command of two or more words directly, with no shell (its manual), and a command of one word through the pane's default
 *  shell; its report prints each word, quoting one that holds a space. So the report of exactly the start program and the
 *  build's path, as two words, is `no-shell`; one bare word, or one quoted word, is `through-a-shell`; anything else, an
 *  empty report or none, is `cannot-tell`, never a pass. */
type PaneStart = 'no-shell' | 'through-a-shell' | 'cannot-tell';
function paneStartReading(report: string | null, start: string, binary: string): PaneStart {
  if (report === null || report.trim() === '') return 'cannot-tell';
  if (report === `${start} ${binary}`) return 'no-shell';
  if (/^"(?:[^"\\]|\\.)*"$/.test(report) || !/\s/.test(report)) return 'through-a-shell';
  return 'cannot-tell';
}

/** One read of a process: the file its image runs and its environment's entries; null when it cannot be read. */
type ProcRead = () => { readonly exe: string; readonly vars: readonly string[] } | null;
/** The process's environment once its image is no longer `tmuxExe` (the pane's exec has happened) and it lists at least one
 *  variable, asked every `stepMs` until `boundMs` has passed; past the bound, a failure that says what was last seen
 *  (review 3765 F4). The clock and the sleep are the caller's, so a unit case runs it without waiting. */
async function environOnceExecuted(read: ProcRead, tmuxExe: string, o: { boundMs?: number; stepMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ readonly vars: readonly string[] } | { readonly unread: string }> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => { setTimeout(r, ms); }));
  const bound = o.boundMs ?? 10_000;
  const until = now() + bound;
  let last = 'nothing readable';
  for (;;) {
    const r = read();
    if (r !== null && r.exe !== tmuxExe && r.vars.length > 0) return { vars: r.vars };
    if (r !== null) last = r.exe === tmuxExe ? 'still the multiplexer\'s own image' : 'an empty environment';
    if (now() >= until) return { unread: `the pane did not become the build within ${bound} ms (last seen: ${last})` };
    await sleep(o.stepMs ?? 20);
  }
}

/** A process's image and environment from `/proc`, or null while it cannot be read. */
const procOf = (pid: number): ProcRead => () => {
  try {
    return {
      exe: readlinkSync(path.join('/proc', String(pid), 'exe')),
      vars: readFileSync(path.join('/proc', String(pid), 'environ'), 'utf8').split('\0').filter((l) => l !== ''),
    };
  } catch { return null; }
};

// The two helpers the real-tmux case below feeds (review 3765 F3, F4), measured here without tmux. The three reports are the
// shapes tmux 3.6 printed for a pane started from two words, from one word, and from the two joined into one word
// (measured on a private server; the measured path is replaced by a neutral one here).
describe('reading how a pane was started, and waiting for the pane to become the build', () => {
  const START = '/usr/bin/env';
  const BIN = '/srv/box/captures/builds/2.1.100';
  it('two plain words, the start program then the build, read as no shell', () => {
    expect(paneStartReading(`${START} ${BIN}`, START, BIN)).toBe('no-shell');
  });
  it('one word, bare or quoted, reads as through a shell', () => {
    expect(paneStartReading(BIN, START, BIN)).toBe('through-a-shell');
    expect(paneStartReading(`"${START} ${BIN}"`, START, BIN)).toBe('through-a-shell');
  });
  it('an empty, blank or missing report, or another command, cannot tell, and is never no-shell', () => {
    for (const r of ['', '  ', null, `${START} /other/2.1.100`, `/bin/sh -c ${BIN}`]) expect(paneStartReading(r, START, BIN), String(r)).toBe('cannot-tell');
  });

  const clock = () => {
    const c = { t: 0, sleeps: 0 };
    // Each sleep yields to the event loop, so a wait that never ends meets the case's own timeout instead of starving it.
    return { c, now: () => c.t, sleep: async (ms: number) => { c.t += ms; c.sleeps++; await new Promise((r) => { setImmediate(r); }); } };
  };
  it('reads past the multiplexer\'s own image and an empty environment to the build\'s', async () => {
    const seq = [null, { exe: '/usr/bin/tmux', vars: ['SHELL=/x'] }, { exe: '/usr/bin/env', vars: [] }, { exe: '/usr/bin/node', vars: ['SHELL=/bin/bash'] }];
    let i = 0;
    const { now, sleep } = clock();
    expect(await environOnceExecuted(() => seq[Math.min(i++, seq.length - 1)]!, '/usr/bin/tmux', { now, sleep })).toEqual({ vars: ['SHELL=/bin/bash'] });
    expect(i).toBe(4);
  });
  it('a pane that never becomes the build ends at the bound with a failure that says so, without hanging', async () => {
    const { c, now, sleep } = clock();
    const r = await environOnceExecuted(() => ({ exe: '/usr/bin/tmux', vars: ['A=1'] }), '/usr/bin/tmux', { now, sleep, boundMs: 1000, stepMs: 20 });
    expect(r).toEqual({ unread: 'the pane did not become the build within 1000 ms (last seen: still the multiplexer\'s own image)' });
    expect([c.t, c.sleeps]).toEqual([1000, 50]);
  }, 5000);
});

describe('the tmux launcher', () => {
  it.skipIf(!hasTmux)('runs the good build in its own tmux server on a test-only socket, and the capture passes', async (ctx) => {
    // A unix socket's path is bounded (about 107 bytes), so the tmux server's directory is a SHORT one from the shared temp
    // registry (the launcher is wrapped to name it in the spec's environment). Under a temp root too long for that, the case
    // skips rather than make a directory the registry does not know (`tmpfixtures.test.ts`).
    const root = freshRoot();
    const sockDir = mkTmp('tx-');
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    if (path.join(sockDir, 'ccrc-capture-tmx', `tmux-${uid}`, 'ccrc-capture').length > 100) ctx.skip();
    const real = tmuxLauncher(REAL_TMUX!);
    try {
      place(root, GOOD);
      const r = await runner(root, { launcher: real, tmuxBase: sockDir, stepTimeoutMs: 15_000, exitTimeoutMs: 10_000 }).run('tmx', GOOD);
      expect(r.detail).toBeNull();
      expect(r.result).toMatchObject({ pass: true, cwd: true });
      expect(gone(root, 'tmx', GOOD)).toBe(true);
      expect(existsSync(path.join(sockDir, 'ccrc-capture-tmx')), 'the tmux directory is removed too').toBe(false);
    } finally {
      spawnSync(REAL_TMUX!, ['-L', 'ccrc-capture', 'kill-server'], { timeout: 10_000, env: { TMUX_TMPDIR: path.join(sockDir, 'ccrc-capture-tmx') } });
    }
  }, 120_000);

  // Review 3687 F1, review 3765 F3: on the test box the service user's shell refuses logins, and the caller's `SHELL` is
  // such a shell here (a fixture that prints a refusal and exits 1, which the case first shows ends a one-word pane). The
  // launcher sets the capture server's default shell to the fixed one, so a one-word pane would now run and pass too: what
  // tells the cure apart is how tmux reports the pane was started. tmux runs a command of two or more words directly, with
  // no shell (its manual), so the case holds that tmux reports exactly the two words, the fixed start program and the
  // build's path, and that the pane was given the fixed shell as `SHELL`; and that the build starts and the capture passes.
  it.skipIf(!hasTmux)('starts the build from two words tmux runs with no shell, under the fixed shell, when the caller\'s shell refuses logins', async (ctx) => {
    const root = freshRoot();
    const sockDir = mkTmp('tx-');
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    if (path.join(sockDir, 'ccrc-capture-nol', `tmux-${uid}`, 'ccrc-capture').length > 100) ctx.skip();
    const refuser = path.join(mkTmp('nologin-'), 'nologin');
    writeFileSync(refuser, '#!/bin/sh\necho "This account is currently not available."\nexit 1\n', { mode: 0o755 });
    // The fixture shell does refuse: a one-word pane under it is gone at once, its server with it.
    const probeDir = path.join(sockDir, 'p');
    mkdirSync(probeDir, { mode: 0o700 });
    const probeVars = { PATH: '/usr/bin:/bin', TMUX_TMPDIR: probeDir, SHELL: refuser };
    const made = spawnSync(REAL_TMUX!, ['-L', 'nol', '-f', '/dev/null', 'new-session', '-d', '-s', 'p', 'sleep 30'], { timeout: 10_000, env: probeVars, encoding: 'utf8' });
    expect(made.status, made.stderr).toBe(0);
    await new Promise((r) => setTimeout(r, 1000));
    expect(spawnSync(REAL_TMUX!, ['-L', 'nol', 'has-session', '-t', '=p'], { timeout: 10_000, env: probeVars }).status, 'a one-word pane under the refusing shell ended').not.toBe(0);
    // The pane's process is read from the creating call, so the case can read the `SHELL` the pane was given (call 1047).
    let panePid: number | null = null;
    const real = tmuxLauncher(REAL_TMUX!, 15_000, {
      spawner: (vars, boundMs) => {
        const e = boundedExec(vars, boundMs);
        return async (file, args) => {
          const r = await e(file, args);
          if (args.includes('new-session') && /^[0-9]+$/.test(r.stdout.trim())) panePid = Number(r.stdout.trim());
          return r;
        };
      },
    });
    let paneShell: string | null = null;
    let paneStart: PaneStart | null = null;
    const refusing: CaptureLauncher = {
      start: async (spec) => {
        const b = await real.start({ ...spec, env: [...spec.env, ['SHELL', refuser]] });
        // How tmux reports the pane was started, asked of the capture's own server.
        const shown = spawnSync(REAL_TMUX!, ['-L', spec.socket, 'display-message', '-p', '-t', tmuxTarget(spec.session), '#{pane_start_command}'],
          { timeout: 10_000, env: Object.fromEntries(spec.env), encoding: 'utf8' });
        paneStart = paneStartReading(shown.status === 0 ? shown.stdout.replace(/\n$/, '') : null, CAPTURE_START, spec.binary);
        // Review 3765 F4: the pane's environment is read once the pane has become the build, never before its exec.
        if (panePid !== null && existsSync('/proc/self/environ')) {
          const seen = await environOnceExecuted(procOf(panePid), realpathSync(REAL_TMUX!));
          paneShell = 'unread' in seen ? seen.unread : seen.vars.find((l) => l.startsWith('SHELL='))?.slice(6) ?? 'unset';
        }
        return b;
      },
    };
    try {
      place(root, GOOD);
      const r = await runner(root, { launcher: refusing, tmuxBase: sockDir, stepTimeoutMs: 15_000, exitTimeoutMs: 10_000 }).run('nol', GOOD);
      expect(r.detail).toBeNull();
      expect(r.result).toMatchObject({ pass: true, cwd: true });
      // tmux reports the pane started from exactly two words, the fixed start program then the build's path: no shell.
      expect(paneStart, 'how tmux reports the pane was started').toBe('no-shell');
      // Where the kernel lists a process's environment, the pane was given the fixed shell, not the refusing one.
      if (existsSync('/proc/self/environ')) expect(paneShell, 'the pane\'s SHELL').toBe(CAPTURE_SHELL);
    } finally {
      spawnSync(REAL_TMUX!, ['-L', 'ccrc-capture', 'kill-server'], { timeout: 10_000, env: { TMUX_TMPDIR: path.join(sockDir, 'ccrc-capture-nol') } });
      spawnSync(REAL_TMUX!, ['-L', 'nol', 'kill-server'], { timeout: 10_000, env: probeVars });
    }
  }, 120_000);
});

/** A launcher whose build is a stand-in: nothing is run, the answers are the test's. */
const inert = (o: { typeThrows?: boolean; life: BuildLife }): CaptureLauncher => ({
  start: async () => ({
    type: async () => { if (o.typeThrows === true) throw new Error('tmux send-keys exited 1'); },
    life: async () => o.life,
    stop: async () => undefined,
  }),
});

describe('the verdict cut: a box fault is no verdict, a fault of the build is a fail (review 3226 F1, F2)', () => {
  it('a type that throws while the build is gone: the build exited mid-drive, a fail naming the events never recorded', async () => {
    const root = freshRoot();
    place(root, GOOD);
    let typed = 0;
    const exits: CaptureLauncher = {
      start: async (spec) => {
        const b = await pipeLauncher.start(spec);
        return { ...b, type: async (t) => { typed++; throw new Error(`gone: ${t}`); }, life: async () => 'gone' as const };
      },
    };
    const r = await runner(root, { launcher: exits, stepTimeoutMs: 8000 }).run('typegone', GOOD);
    expect(typed).toBe(1);
    expect(r.detail).toBeNull();
    expect(r.result?.pass).toBe(false);
    expect(r.result?.output).toContain('UserPromptSubmit');
    expect(r.result?.output).toContain('drive: did not finish every step');
    expect(gone(root, 'typegone', GOOD)).toBe(true);
  }, 120_000);

  it('a type that throws while the build is alive: the launcher could not type, no verdict', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const broken: CaptureLauncher = {
      start: async (spec) => {
        const b = await pipeLauncher.start(spec);
        return { ...b, type: async () => { throw new Error('tmux send-keys exited 1'); }, life: async () => 'alive' as const };
      },
    };
    const r = await runner(root, { launcher: broken, stepTimeoutMs: 8000 }).run('typelive', GOOD);
    expect(r.result).toBeNull();
    expect(r.detail).toContain('launcher could not type into the build');
    expect(gone(root, 'typelive', GOOD)).toBe(true);
  }, 120_000);

  // Review 3623: a launcher that cannot answer whether the build lives is never read as exited. Each point the verdict turns
  // on the build's life answers no verdict when the life is unknown, never a fail.
  const lives: [string, () => Promise<BuildLife>][] = [
    ['a life() that throws', async (): Promise<BuildLife> => { throw new Error('the probe failed'); }],
    ['a life() that answers unknown', async (): Promise<BuildLife> => 'unknown'],
  ];
  it.each(lives)('%s after a type fails: no verdict, never a fail', async (_n, life) => {
    const root = freshRoot();
    place(root, GOOD);
    const l: CaptureLauncher = {
      start: async (spec) => {
        const b = await pipeLauncher.start(spec);
        return { ...b, type: async () => { throw new Error('x'); }, life };
      },
    };
    const r = await runner(root, { launcher: l, stepTimeoutMs: 8000, stopWaitMs: 200 }).run('lifeunknown', GOOD);
    expect(r.result).toBeNull();
    expect(r.detail).toContain('cannot tell whether the build lives');
  }, 120_000);

  it('an unknown life in the exit wait: no verdict, never a fail', async () => {
    const root = freshRoot();
    place(root, GOOD);
    let typed = 0;
    const l: CaptureLauncher = {
      start: async (spec) => {
        const b = await pipeLauncher.start(spec);
        // Alive through the drive; once /exit is typed, the launcher can no longer tell.
        return { ...b, type: async (t) => { typed++; await b.type(t); }, life: async () => (typed >= CAPTURE_STEPS.filter((x) => x.type !== null).length ? 'unknown' as const : b.life()) };
      },
    };
    const r = await runner(root, { launcher: l, stopWaitMs: 200 }).run('exitunknown', GOOD);
    expect(r.result).toBeNull();
    expect(r.detail).toContain('cannot tell whether the build lives');
  }, 120_000);

  it('an unknown life with nothing recorded by the SessionStart deadline: no verdict, never a fail', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const r = await runner(root, { launcher: inert({ life: 'unknown' }), stepTimeoutMs: 300, stopWaitMs: 200 }).run('deadunknown', GOOD);
    expect(r.result).toBeNull();
    expect(r.detail).toContain('cannot tell whether the build lives');
  });

  it('a build that is never alive and records nothing by the SessionStart deadline: no verdict, a box fault', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const r = await runner(root, { launcher: inert({ life: 'gone' }), stepTimeoutMs: 300 }).run('deadnothing', GOOD);
    expect(r.result).toBeNull();
    expect(r.detail).toContain('exited before it recorded anything');
    expect(gone(root, 'deadnothing', GOOD)).toBe(true);
  });

  it('a build that is alive and records nothing by the deadline: a fail, a live build with its events missing', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const r = await runner(root, { launcher: inert({ life: 'alive' }), stepTimeoutMs: 300, stopWaitMs: 200 }).run('livenothing', GOOD);
    expect(r.detail).toBeNull();
    expect(r.result?.pass).toBe(false);
    expect(r.result?.output).toContain('SessionStart');
  });
});

describe('the cleanup never replaces the answer and never races the build (review 3226 F10)', () => {
  it('a removal that throws still returns the verdict', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const r = await runner(root, { remove: () => { throw new Error('EBUSY'); } }).run('rmthrows', GOOD);
    expect(r.detail).toBeNull();
    expect(r.result?.pass).toBe(true);
  }, 120_000);

  it('the directory is removed only after the build is gone, once stop has been asked', async () => {
    const root = freshRoot();
    place(root, NEVER_EXITS);
    let stopAt = 0;
    let aliveAtRemove: boolean | null = null;
    const slow: CaptureLauncher = {
      start: async (spec) => {
        const b = await pipeLauncher.start(spec);
        return {
          ...b,
          // Gone only 400 ms after stop is asked, and always alive before.
          life: async () => (stopAt === 0 ? await b.life() : Date.now() - stopAt < 400 ? 'alive' as const : 'gone' as const),
          stop: async () => { stopAt = Date.now(); await b.stop(); },
        };
      },
    };
    const r = await runner(root, {
      launcher: slow, exitTimeoutMs: 800,
      // The never-exiting stand-in: the drive ends by its exit deadline, so stop is asked with the build still running.
      remove: () => { aliveAtRemove = Date.now() - stopAt < 400; },
    }).run('stopwait', NEVER_EXITS);
    expect(r.result?.pass).toBe(false);
    expect(stopAt).toBeGreaterThan(0);
    expect(aliveAtRemove).toBe(false);
  }, 120_000);

  it('a failed new-session leaves no tmux server: kill-server follows it on the same socket', () => {
    const dir = mkTmp('ccrc-faketmux-');
    const log = path.join(dir, 'argv.log');
    const bin = path.join(dir, 'tmux');
    writeFileSync(bin, `#!/bin/sh\necho "$*" >> '${log}'\ncase "$*" in *new-session*) echo boom >&2; exit 1;; esac\nexit 0\n`, { mode: 0o755 });
    return tmuxLauncher(bin).start({ binary: '/b', cwd: dir, env: [['PATH', '/usr/bin:/bin']], socket: 'ccrc-capture', session: 'capture' }).then(
      () => { throw new Error('start should have failed'); },
      (e: unknown) => {
        expect(String(e)).toContain('new-session exited 1');
        const lines = readFileSync(log, 'utf8').trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('new-session');
        expect(lines[1]).toBe('-L ccrc-capture kill-server');
      },
    );
  });
});

describe('the sweep of stale capture directories (review 3226 F10)', () => {
  const id = (n: number): string => n.toString(16).padStart(32, '0');
  it('lists capture ids, never the builds store or any other name', () => {
    expect(staleCaptureDirs(['builds', id(1), 'notes.txt', id(2), 'ABCDEF'.padEnd(32, 'A'), `${id(3)}x`, id(4).slice(1)])).toEqual([id(1), id(2)]);
  });
  it('an empty directory has nothing to sweep', () => { expect(staleCaptureDirs([])).toEqual([]); });
});

// Review 3623 and review 3226's F11 nits: the launcher reads the build's life from the build's own process group, never
// from its terminal server; the build's path is a word of its own after the fixed start program, never read by a shell
// (review 3687 F1), and a path tmux could read as anything else is refused (review 3765 F5); and the capture's tmux
// directory is the runner's own, under the service's temporary directory. A fake spawner stands in for tmux and a fake
// signal call for the kernel.
describe('the tmux launcher reads the build, not its terminal server (review 3623)', () => {
  interface Seen { readonly calls: string[][]; readonly signals: [number, NodeJS.Signals | 0][] }
  const fake = (o: { pidOut?: string; newSession?: number; signal?: (pid: number, sig: NodeJS.Signals | 0) => void; shellUsable?: (f: string) => boolean } = {}) => {
    const seen: Seen = { calls: [], signals: [] };
    const asked: string[] = [];
    const launcher = tmuxLauncher('tmux', 5000, {
      spawner: () => async (_file, args) => {
        seen.calls.push([...args]);
        const made = args.includes('new-session');
        return { status: made ? (o.newSession ?? 0) : 0, stdout: made ? (o.pidOut ?? '4242\n') : '', stderr: '', killed: false };
      },
      signal: (pid, sig) => { seen.signals.push([pid, sig]); o.signal?.(pid, sig); },
      shellUsable: (f) => { asked.push(f); return (o.shellUsable ?? (() => true))(f); },
    });
    return { launcher, seen, asked };
  };
  const SPEC = { binary: '/var/lib/ccrc_test-box/captures/builds/2.1.100', cwd: '/w', env: [['PATH', '/usr/bin']] as const, socket: 'ccrc-capture', session: 'capture' };

  it('starts the build with no shell: the fixed start program, then the build\'s path as a word of its own (review 3687 F1), and asks tmux to print the pane\'s process', async () => {
    const { launcher, seen } = fake();
    await launcher.start(SPEC);
    const made = seen.calls[0]!;
    expect(made.slice(made.indexOf('new-session'), made.indexOf('-s'))).toEqual(['new-session', '-d', '-P', '-F', '#{pane_pid}']);
    expect(made.slice(made.indexOf('-c'))).toEqual(['-c', '/w', CAPTURE_START, SPEC.binary]);
    expect(CAPTURE_START).toBe('/usr/bin/env');
    expect(capturePaneCommand(SPEC.binary)).toEqual([CAPTURE_START, SPEC.binary]);
  });

  // Programme call 1047: the build sees one fixed, absolute system shell as `SHELL`, the capture's own tmux server's default
  // shell, set in the creating call before the session; never the service user's, never one from the caller's environment.
  it('sets the capture server\'s default shell to the fixed system shell, in the creating call, before the session', async () => {
    const { launcher, seen, asked } = fake();
    await launcher.start({ ...SPEC, env: [...SPEC.env, ['SHELL', '/caller/shell']] });
    const made = seen.calls[0]!;
    expect(made.slice(made.indexOf('-f'), made.indexOf('new-session'))).toEqual(['-f', '/dev/null', 'set-option', '-g', 'default-shell', CAPTURE_SHELL, ';']);
    expect(CAPTURE_SHELL).toBe('/bin/bash');
    expect(made).not.toContain('/caller/shell');
    expect(asked).toEqual([CAPTURE_SHELL]);
  });

  it('refuses the start before any tmux call when the fixed shell is not an executable file, never as a verdict', async () => {
    const { launcher, seen } = fake({ shellUsable: () => false });
    await expect(launcher.start(SPEC)).rejects.toThrow(/the capture's shell \/bin\/bash is not an executable file/);
    expect(seen.calls).toEqual([]);
  });

  it('reads an executable file as usable, and a missing path, a directory or a file that cannot be run as not', () => {
    const d = mkTmp('ccrc-capshell-');
    const run = path.join(d, 'run'); writeFileSync(run, '#!/bin/sh\n', { mode: 0o755 });
    const plain = path.join(d, 'plain'); writeFileSync(plain, 'x', { mode: 0o644 });
    expect([executableFile(run), executableFile(plain), executableFile(d), executableFile(path.join(d, 'none'))]).toEqual([true, false, false, false]);
  });

  // The coordinator's requirement with the cure (call 1003): a pane can never start the fixed program alone, which would print
  // the pane's whole environment into what the capture records. The one builder of the pane's command refuses, before any
  // tmux call, a path that could leave it alone, and any path holding a character outside the plain set (letters, digits,
  // `.`, `_`, `/`, `-`), so tmux can read none as other than the one path (review 3765 F5).
  it.each([
    ['an empty path', ''],
    ['a missing path', undefined],
    ['a path of spaces only', '   '],
    ['a relative path', 'builds/2.1.100'],
    ['a path holding an =', '/srv/a=b/captures/builds/2.1.100'],
    ['a path ending in a semicolon', '/srv/box/captures/builds/2.1.100;'],
    ['a path ending in a backslash and a semicolon', '/srv/box/captures/builds/2.1.100\\;'],
    ['a path holding a semicolon', '/srv/a;b/captures/builds/2.1.100'],
    ['a path holding a space', '/srv/a b/captures/builds/2.1.100'],
    ['a path holding a quote', "/srv/it's/captures/builds/2.1.100"],
    ['a path holding a line break', '/srv/a\nb/captures/builds/2.1.100'],
    ['a path holding a dollar sign', '/srv/$HOME/captures/builds/2.1.100'],
    ['a path holding a tilde', '/srv/~a/captures/builds/2.1.100'],
    ['a path holding a non-ASCII letter', '/srv/\u00e9/captures/builds/2.1.100'],
  ])('refuses %s before any tmux call', async (_n, binary) => {
    const { launcher, seen } = fake();
    await expect(launcher.start({ ...SPEC, binary: binary as string })).rejects.toThrow(/cannot be started without a shell/);
    expect(seen.calls).toEqual([]);
    expect(() => capturePaneCommand(binary)).toThrow(/cannot be started without a shell/);
  });

  it('accepts every path in the plain set, so every root the fleet\'s copy accepts still reaches its builds', () => {
    for (const b of ['/var/lib/ccrc-testbox/captures/builds/2.1.100', '/srv/T_b.x-1/captures/builds/0.0.0']) {
      expect(capturePaneCommand(b)).toEqual([CAPTURE_START, b]);
    }
  });

  // Review 3765 F5: a refused path is a fault of the box with no verdict, like the builder's other refusals, and no tmux call.
  it('a capture whose build\'s path is refused ends with no verdict, a fault of the box, and no tmux call', async () => {
    const root = path.join(freshRoot(), 'a b');
    mkdirSync(root);
    place(root, GOOD);
    const { launcher, seen } = fake();
    const r = await runner(root, { launcher }).run('spaced', GOOD);
    expect(r.result).toBeNull();
    expect(r.detail).toMatch(/^the capture could not start: .*cannot be started without a shell/);
    expect(seen.calls).toEqual([]);
  });

  it('reads life from the printed process\'s GROUP with signal 0: present is alive, gone is gone', async () => {
    let present = true;
    const { launcher, seen } = fake({ signal: () => { if (!present) throw Object.assign(new Error('no such process'), { code: 'ESRCH' }); } });
    const b = await launcher.start(SPEC);
    expect(await b.life()).toBe('alive');
    present = false;
    expect(await b.life()).toBe('gone');
    expect(seen.signals).toEqual([[-4242, 0], [-4242, 0]]);
    expect(seen.calls, 'no tmux call reads the build\'s life').toHaveLength(1);
  });

  it('groupLife: ESRCH is gone, EPERM is alive (the group exists), any other failure is unknown, never gone', () => {
    const throwing = (code: string | undefined) => () => { throw Object.assign(new Error('x'), { code }); };
    expect(groupLife(() => undefined, 7)).toBe('alive');
    expect(groupLife(throwing('ESRCH'), 7)).toBe('gone');
    expect(groupLife(throwing('EPERM'), 7)).toBe('alive');
    expect(groupLife(throwing('EINVAL'), 7)).toBe('unknown');
    expect(groupLife(throwing(undefined), 7)).toBe('unknown');
  });

  it('stop kills the private server, then tells the build\'s group to end; once only', async () => {
    const { launcher, seen } = fake();
    const b = await launcher.start(SPEC);
    await b.stop();
    await b.stop();
    expect(seen.calls.slice(1)).toEqual([['-L', 'ccrc-capture', 'kill-server']]);
    expect(seen.signals).toEqual([[-4242, 'SIGTERM']]);
  });

  it.each([
    ['prints no process', { pidOut: '' }],
    ['prints a process that is not one', { pidOut: 'pane\n' }],
    ['prints process 1', { pidOut: '1\n' }],
  ])('a new-session that %s: the private server is killed and the start throws', async (_n, o) => {
    const { launcher, seen } = fake(o);
    await expect(launcher.start(SPEC)).rejects.toThrow(/named no process/);
    expect(seen.calls.at(-1)).toEqual(['-L', 'ccrc-capture', 'kill-server']);
  });
});

describe('the capture\'s tmux directory and its stand-in (review 3226 F8, gate G1)', () => {
  it('the tmux directory is the runner\'s own under its tmux base, made 0700 before the build starts and removed at the end', async () => {
    const root = freshRoot();
    const base = path.join(root, 'svc-tmp');
    mkdirSync(base);
    place(root, GOOD);
    let tmuxDir: string | null = null;
    let mode: number | null = null;
    const watching: CaptureLauncher = {
      start: async (spec) => { tmuxDir = new Map(spec.env).get('TMUX_TMPDIR')!; mode = statSync(tmuxDir).mode & 0o777; return pipeLauncher.start(spec); },
    };
    const r = await runner(root, { launcher: watching, tmuxBase: base }).run('tmuxdir', GOOD);
    expect(r.result?.pass).toBe(true);
    expect(tmuxDir).toBe(path.join(base, 'ccrc-capture-tmuxdir'));
    expect(mode).toBe(0o700);
    expect(existsSync(tmuxDir!)).toBe(false);
  }, 120_000);

  it('a stand-in whose close never ends is left behind after its bound: the answer still comes', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const t0 = Date.now();
    const r = await runner(root, {
      launcher: inert({ life: 'gone' }), stepTimeoutMs: 200, standInCloseMs: 300,
      standIn: async () => { const s = await startStandIn(); await s.close(); return { port: s.port, requests: s.requests, routes: s.routes, close: () => new Promise<void>(() => undefined) }; },
    }).run('hungclose', GOOD);
    expect(r.result).toBeNull();
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(gone(root, 'hungclose', GOOD)).toBe(true);
  });

  it('the stop wait polls the build\'s life and ends at its bound while the life stays unknown, never reading it as gone', async () => {
    const root = freshRoot();
    place(root, GOOD);
    let asked = 0;
    const l: CaptureLauncher = { start: async () => ({ type: async () => undefined, life: async () => { asked++; return 'unknown' as const; }, stop: async () => undefined }) };
    const t0 = Date.now();
    await runner(root, { launcher: l, stepTimeoutMs: 100, stopWaitMs: 600, pollMs: 50 }).run('stopunknown', GOOD);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(600);
    expect(asked).toBeGreaterThan(3);
  });
});
