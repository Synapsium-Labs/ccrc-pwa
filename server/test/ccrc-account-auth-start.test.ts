// `ccrc account auth-start`, `auth-code` and `auth-cancel` (accounts plan Task A20; spec §3.5, §3.7, §3.10; D-5514,
// D-5515, D-7750). The sign-in runs DETACHED, as a transient user service: `auth-start` returns as soon as the helper's
// status file names the server's attempt, the helper outlives the caller's process group, the one-time code is relayed
// once and never onto an argv, and a macOS node refuses before anything is spawned. The fixture is
// `authAttemptFixture.ts`: every manager, tmux server, pty vehicle and `claude` is a recording stand-in.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ACCOUNT_OP, BASH, HAVE_FLOCK } from './laneStateFixture.js';
import {
  ATTEMPT, CODE, GOOD_SIGN_IN, GOOD_TOKEN, OLD_SIGN_IN, answerOf, authBox, authEnv, ccrcAuth, ccrcAuthSpawn,
  HOST_OSTYPE, credFile, logLines, reapAll, rosterOf, scratchOf, statusOf, tokenFile, waitQuiet, waitState,
} from './authAttemptFixture.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const homes: string[] = [];
const box = (prefix: string, opts: Parameters<typeof authBox>[1] = {}): string => {
  const h = authBox(prefix, opts);
  homes.push(h);
  return h;
};
afterEach(() => { for (const h of homes.splice(0)) reapAll(h); });

const start = (home: string, id: string, method: string, extra: NodeJS.ProcessEnv = {}) =>
  ccrcAuth(home, ['account', 'auth-start', '--id', id, '--method', method, '--attempt', ATTEMPT], '', extra);
const code = (home: string, id: string, value: string, extra: NodeJS.ProcessEnv = {}) =>
  ccrcAuth(home, ['account', 'auth-code', '--id', id, '--attempt', ATTEMPT], `${value}\n`, extra);
const cancel = (home: string, id: string) =>
  ccrcAuth(home, ['account', 'auth-cancel', '--id', id, '--attempt', ATTEMPT]);

describe('auth-start launches a detached attempt (spec §3.5)', () => {
  it('auth-start returns in under 5 s while the helper keeps running', async () => {
    const home = box('ccrc-auth-start-fast-');
    // The sign-in's own prompt comes six seconds in: a verb that waited for `waiting-code` (rather than for `starting`
    // with its attempt) could not return inside the bound.
    writeFileSync(join(home, 'slow-prompt'), '6\n');
    const r = start(home, 'lane-b', 'setup-token');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.ms, 'auth-start took longer than the spec\'s 5 s').toBeLessThan(5000);
    const a = answerOf(r);
    expect(a).toMatchObject({ ok: true, id: 'lane-b', attemptId: ATTEMPT, method: 'setup-token', unit: 'ccrc-auth-lane-b-01234567' });
    expect(['starting', 'url']).toContain(a['state']);
    // A transient SERVICE, never a scope, bounded as the spec bounds it, running the helper with the attempt.
    const run = logLines(home, 'systemd-run-calls');
    expect(run).toHaveLength(1);
    expect(run[0]).toContain('--user --unit=ccrc-auth-lane-b-01234567 --collect -p RuntimeMaxSec=660 -p MemoryMax=512M');
    expect(run[0]).not.toContain('--scope');
    expect(run[0]).toMatch(new RegExp(`/\\.local/bin/ccd-account-auth lane-b setup-token --attempt ${ATTEMPT}$`));
    // The helper is still running after the verb answered, and gets to the code step on its own.
    expect(await waitState(home, 'lane-b', ['waiting-code'], 30_000)).toBe('waiting-code');
    expect(cancel(home, 'lane-b').code).toBe(0);
    expect(await waitState(home, 'lane-b', ['cancelled'], 20_000)).toBe('cancelled');
    await waitQuiet(home);
  }, 60_000);

  it('the helper survives the caller\'s process-group kill', async () => {
    const home = box('ccrc-auth-start-group-');
    // `login` is one process in its unit: no pane would carry it on past a kill of the group it was started in.
    const child = ccrcAuthSpawn(home, ['account', 'auth-start', '--id', 'lane-s', '--method', 'login', '--attempt', ATTEMPT]);
    const until = Date.now() + 20_000;
    while (Date.now() < until && statusOf(home, 'lane-s')?.['attemptId'] !== ATTEMPT) {
      await new Promise((res) => { setTimeout(res, 50); });
    }
    expect(statusOf(home, 'lane-s')?.['attemptId']).toBe(ATTEMPT);
    // What the agent's sub timeout does to the verb's whole process group.
    try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* the verb had already answered and gone */ }
    expect(await waitState(home, 'lane-s', ['waiting-code'], 30_000), 'the helper died with its caller').toBe('waiting-code');
    expect(cancel(home, 'lane-s').code).toBe(0);
    expect(await waitState(home, 'lane-s', ['cancelled'], 20_000)).toBe('cancelled');
  }, 60_000);

  it('the status file echoes the attemptId, from the first state to the last', async () => {
    const home = box('ccrc-auth-start-echo-');
    expect(start(home, 'lane-s', 'login').code).toBe(0);
    expect(statusOf(home, 'lane-s')?.['attemptId']).toBe(ATTEMPT);
    expect(await waitState(home, 'lane-s', ['waiting-code'])).toBe('waiting-code');
    expect(statusOf(home, 'lane-s')?.['attemptId']).toBe(ATTEMPT);
    expect(code(home, 'lane-s', CODE).code).toBe(0);
    expect(await waitState(home, 'lane-s', ['done', 'failed'])).toBe('done');
    expect(statusOf(home, 'lane-s')).toMatchObject({ state: 'done', attemptId: ATTEMPT });
    // A fresh sign-in lane signs in where it lives (the path OA1a measured), and its scratch is gone.
    expect(readFileSync(credFile(home, '.claude-lane-s'), 'utf8')).toBe(`${GOOD_SIGN_IN}\n`);
    expect(existsSync(scratchOf(home, 'lane-s'))).toBe(false);
  }, 60_000);

  it('refuses a second attempt on a lane while one is live, and starts nothing', async () => {
    const home = box('ccrc-auth-start-busy-');
    expect(start(home, 'lane-s', 'login').code).toBe(0);
    expect(await waitState(home, 'lane-s', ['waiting-code'])).toBe('waiting-code');
    const again = ccrcAuth(home, ['account', 'auth-start', '--id', 'lane-s', '--method', 'login', '--attempt', 'f'.repeat(32)]);
    expect(again.code).toBe(1);
    expect(answerOf(again)['error']).toBe('auth-in-progress');
    expect(logLines(home, 'systemd-run-calls')).toHaveLength(1);
    expect(cancel(home, 'lane-s').code).toBe(0);
    await waitState(home, 'lane-s', ['cancelled']);
  }, 60_000);

  it('auth-cancel stops the attempt\'s unit, the pipe arm included, and is a no-op once it has ended', async () => {
    const home = box('ccrc-auth-cancel-');
    expect(start(home, 'lane-s', 'login').code).toBe(0);
    expect(await waitState(home, 'lane-s', ['waiting-code'])).toBe('waiting-code');
    const c = cancel(home, 'lane-s');
    expect(c.code, c.stdout + c.stderr).toBe(0);
    expect(answerOf(c)).toMatchObject({ ok: true, attemptId: ATTEMPT, unit: 'ccrc-auth-lane-s-01234567', stopped: true });
    expect(logLines(home, 'systemctl-calls')).toContain('--user stop ccrc-auth-lane-s-01234567.service');
    expect(await waitState(home, 'lane-s', ['cancelled'])).toBe('cancelled');
    expect(existsSync(credFile(home, '.claude-lane-s'))).toBe(false);
    const again = cancel(home, 'lane-s');
    expect(again.code).toBe(0);
    expect(answerOf(again)['stopped']).toBe(false);
  }, 60_000);
});

describe('the code relay (spec §3.7; D-5514)', () => {
  it('a second code refuses `code-already-sent`', async () => {
    const home = box('ccrc-auth-code-once-');
    expect(start(home, 'lane-s', 'login').code).toBe(0);
    expect(await waitState(home, 'lane-s', ['waiting-code'])).toBe('waiting-code');
    const first = code(home, 'lane-s', CODE);
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(answerOf(first)).toMatchObject({ ok: true, id: 'lane-s', attemptId: ATTEMPT, sent: true });
    const second = code(home, 'lane-s', CODE);
    expect(second.code).toBe(1);
    expect(answerOf(second)['error']).toBe('code-already-sent');
    expect(second.stdout + second.stderr).not.toContain(CODE);
    expect(await waitState(home, 'lane-s', ['done', 'failed'])).toBe('done');
  }, 60_000);

  it('refuses a code with a control byte, and a code for an attempt the lane is not running', async () => {
    const home = box('ccrc-auth-code-bytes-');
    for (const bad of ['', 'abc\u0001def', 'abc\u007f', 'x'.repeat(8193)]) {
      const r = ccrcAuth(home, ['account', 'auth-code', '--id', 'lane-s', '--attempt', ATTEMPT], bad);
      expect(r.code, JSON.stringify(bad.slice(0, 10))).toBe(2);
      expect(answerOf(r)['error']).toBe('bad-code');
    }
    const none = code(home, 'lane-s', CODE);
    expect(none.code).toBe(1);
    expect(answerOf(none)['error']).toBe('no-auth-attempt');
  }, 60_000);

  it('the code never appears on any argv during the run', async () => {
    const home = box('ccrc-auth-code-argv-');
    // PATH shims that append every argv they are run with, then run the real tool. `ps` sampling would miss an argv
    // that lives a millisecond; a shim cannot.
    const shims = join(home, 'argv-shims');
    mkdirSync(shims, { recursive: true });
    const shimmed: string[] = [];
    for (const name of ['jq', 'curl', 'printf', 'mv', 'install', 'cat', 'tee']) {
      // The FILE on PATH, never `command -v`, which answers a shell builtin's bare name (`printf` is one).
      const real = String(process.env['PATH'] ?? '').split(':').filter((d) => d.startsWith('/'))
        .map((d) => join(d, name)).find((f) => { try { accessSync(f, constants.X_OK); return statSync(f).isFile(); } catch { return false; } });
      if (real === undefined) continue;
      shimmed.push(name);
      writeFileSync(join(shims, name),
        `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> "$HOME/argv-log"\nexec '${real}' "$@"\n`, { mode: 0o755 });
    }
    const base = authEnv(home);
    const bin = join(home, '.local', 'bin');
    const path = `${bin}:${shims}:${String(base['PATH']).split(':').filter((d) => d !== bin).join(':')}`;
    expect(start(home, 'lane-b', 'setup-token', { PATH: path }).code).toBe(0);
    expect(await waitState(home, 'lane-b', ['waiting-code'])).toBe('waiting-code');
    expect(code(home, 'lane-b', CODE, { PATH: path }).code).toBe(0);
    expect(await waitState(home, 'lane-b', ['done', 'failed'])).toBe('done');
    await waitQuiet(home);
    const log = logLines(home, 'argv-log');
    expect(shimmed, 'a tool the run uses has no shim').toEqual(expect.arrayContaining(['jq', 'printf', 'mv', 'cat']));
    expect(log.length, 'no shim ran, so nothing was measured').toBeGreaterThan(0);
    expect(log.filter((l) => l.includes(CODE)), 'the code reached an argv').toEqual([]);
    expect(log.filter((l) => l.includes(GOOD_TOKEN)), 'the minted token reached an argv').toEqual([]);
    expect(readFileSync(tokenFile(home, 'lane-b'), 'utf8')).toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${GOOD_TOKEN}\n`);
  }, 90_000);
});

describe('a darwin node before its arm (spec §3.10; D-5557)', () => {
  it.each(['login', 'setup-token', 'openai-login'])('on CCD_OS=darwin, auth-start for %s refuses `auth-unsupported-here` and spawns nothing', (method) => {
    const home = box('ccrc-auth-darwin-');
    const r = start(home, 'lane-b', method, { OSTYPE: 'darwin23' });
    expect(r.code).toBe(1);
    expect(answerOf(r)).toMatchObject({ ok: false, error: 'auth-unsupported-here', reason: 'darwin-arm-absent' });
    expect(logLines(home, 'systemd-run-calls'), 'a unit was started').toEqual([]);
    expect(logLines(home, 'tmux-calls-log'), 'tmux was asked').toEqual([]);
    expect(statusOf(home, 'lane-b'), 'a status file was written').toBeNull();
  }, 60_000);
});

describe('the scratch and the default method', () => {
  it('every scratch config dir is under `~/.ccrc/auth-scratch/<id>/config`', async () => {
    const home = box('ccrc-auth-scratch-dir-');
    // A mint, and a sign-in on a lane that already holds one (Sign in again).
    writeFileSync(credFile(home, '.claude-lane-s'), `${OLD_SIGN_IN}\n`, { mode: 0o600 });
    for (const [id, method] of [['lane-b', 'setup-token'], ['lane-s', 'login']] as const) {
      expect(start(home, id, method).code).toBe(0);
      expect(await waitState(home, id, ['waiting-code'])).toBe('waiting-code');
      expect(code(home, id, CODE).code).toBe(0);
      expect(await waitState(home, id, ['done', 'failed'])).toBe('done');
    }
    await waitQuiet(home);
    const dirs = logLines(home, 'upstream-calls')
      .filter((l) => l.startsWith('setup-token ') || l.startsWith('auth login'))
      .map((l) => l.split('|')[1]);
    expect(dirs).toEqual([join(scratchOf(home, 'lane-b'), 'config'), join(scratchOf(home, 'lane-s'), 'config')]);
    expect(readFileSync(credFile(home, '.claude-lane-s'), 'utf8')).toBe(`${GOOD_SIGN_IN}\n`);
    expect(existsSync(scratchOf(home, 'lane-b'))).toBe(false);
    expect(existsSync(scratchOf(home, 'lane-s'))).toBe(false);
  }, 90_000);

  it('`check-add` with no `--method` for anthropic picks `setup-token`, the table\'s first', () => {
    const home = box('ccrc-auth-default-method-');
    const r = spawnSync(BASH, ['-c', 'exec node "$@"', '_', ACCOUNT_OP, 'check-add', '--file', join(home, '.ccrc', 'accounts.json'),
      '--id', 'lane-n', '--provider', 'anthropic', '--label', 'lane·n', '--hue', 'blue'], { env: authEnv(home), encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const plan = (JSON.parse(r.stdout) as { plan: Record<string, unknown> }).plan;
    expect(plan['method']).toBe('setup-token');
    expect(plan['secretsFile']).toBe('.cc-secrets/lane-n-oauth.env');
    // And the CLI: a bare `add --provider anthropic` makes a token lane with no key yet, off, for the mint to fill.
    const add = ccrcAuth(home, ['account', 'add', '--id', 'lane-n', '--provider', 'anthropic', '--label', 'lane·n', '--hue', 'blue'],
      '', { OSTYPE: HOST_OSTYPE });
    expect(add.code, add.stdout + add.stderr).toBe(0);
    expect(rosterOf(home).accounts.find((x) => x.id === 'lane-n')?.exec['secretsFile']).toBe('.cc-secrets/lane-n-oauth.env');
    expect(existsSync(tokenFile(home, 'lane-n'))).toBe(false);
    expect(existsSync(join(home, '.cc-sessions', 'lane-n-disabled'))).toBe(true);
  }, 60_000);
});
