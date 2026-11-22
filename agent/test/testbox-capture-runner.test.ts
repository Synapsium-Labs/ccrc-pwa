// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.1, §2.3, §2.4) against
// a FAKE build (`fixtures/fake-claude-build.mjs`, never a real one), the real stand-in model, and the recorder's own source
// run under Node's type-stripping flag (no compile step). The tests' launcher pipes the build's stdin; the tmux launcher
// is run once, on a test-only socket, when a `tmux` binary is on PATH.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAPTURE_TOKEN, capturePaths, captureBuildsDir, captureEnv } from '../src/testbox/capture.js';
import { recorderPath } from '../src/testbox/captureRecord.js';
import { CaptureRunner, tmuxLauncher, type CaptureLauncher, type CaptureRunnerDeps } from '../src/testbox/captureRunner.js';
import { startStandIn } from '../src/testbox/captureStub.js';
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
      alive: async () => !exited,
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
    root, recorder: RECORDER, toolsPath: NODE_DIR, launcher: pipeLauncher, standIn: () => startStandIn(),
    stepTimeoutMs: 20_000, exitTimeoutMs: 10_000, pollMs: 50, ...over,
  });
}

const freshRoot = (): string => realpathSync(mkTmp('ccrc-caprun-'));
const gone = (root: string, id: string, build: string): boolean => !existsSync(capturePaths(root, id, build).dir);

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
    const reportsExited: CaptureLauncher = { start: async (spec) => ({ ...(await pipeLauncher.start(spec)), alive: async () => false }) };
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
    const env = new Map(captureEnv(capturePaths('/srv/box', 'ab'.repeat(16), GOOD), 4321, null));
    expect(env.get('DISABLE_AUTOUPDATER')).toBe('1');
    expect(env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')).toBe('1');
    expect(CAPTURE_TOKEN).toBe('ccrc-capture-stand-in');
    expect(env.get('ANTHROPIC_AUTH_TOKEN')).toBe(CAPTURE_TOKEN);
    expect(env.get('ANTHROPIC_BASE_URL')).toBe('http://127.0.0.1:4321');
    expect([...env.keys()].filter((k) => /KEY|SECRET|OAUTH|CREDENTIAL/.test(k))).toEqual([]);
  });

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
      standIn: async () => { const s = await startStandIn(); return { port: s.port, requests: s.requests, close: async () => { closed = true; await s.close(); } }; },
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

describe('the tmux launcher', () => {
  it.skipIf(!hasTmux)('runs the good build in its own tmux server on a test-only socket, and the capture passes', async (ctx) => {
    // A unix socket's path is bounded (about 107 bytes), so the tmux server's directory is a SHORT one from the shared temp
    // registry (the launcher is wrapped to name it in the spec's environment). Under a temp root too long for that, the case
    // skips rather than make a directory the registry does not know (`tmpfixtures.test.ts`).
    const root = freshRoot();
    const sockDir = mkTmp('tx-');
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    if (path.join(sockDir, `tmux-${uid}`, 'ccrc-capture').length > 100) ctx.skip();
    const real = tmuxLauncher(REAL_TMUX!);
    const short: CaptureLauncher = {
      start: (spec) => real.start({ ...spec, env: spec.env.map(([k, v]) => (k === 'TMUX_TMPDIR' ? [k, sockDir] as const : [k, v] as const)) }),
    };
    try {
      place(root, GOOD);
      const r = await runner(root, { launcher: short, stepTimeoutMs: 15_000, exitTimeoutMs: 10_000 }).run('tmx', GOOD);
      expect(r.detail).toBeNull();
      expect(r.result).toMatchObject({ pass: true, cwd: true });
      expect(gone(root, 'tmx', GOOD)).toBe(true);
    } finally {
      spawnSync(REAL_TMUX!, ['-L', 'ccrc-capture', 'kill-server'], { timeout: 10_000, env: { TMUX_TMPDIR: sockDir } });
    }
  }, 120_000);
});
