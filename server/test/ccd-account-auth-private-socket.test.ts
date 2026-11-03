// `ccd-account-auth`'s pane in an attempt (accounts plan Task A20; spec §3.5, §3.9; D-5515, D-7750): a pane method's
// pane is on the lane's OWN tmux server, `-L ccrc-auth-<id>`, started by the unit's copy of the helper and never on the
// fleet's shared server, and every terminal state kills that server by name and deletes `auth-scratch/<id>`. The
// fixture is `authAttemptFixture.ts`, whose tmux stand-in keeps a scrollback file per socket.
//
// The filename starts with `ccd`, so `ccd-workspaces.test.ts`'s scan owns every bash spawn below: each carries
// ghContainedEnv + systemd + tmux, inside the twelve-line lookback that scan reads.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { BASH, HAVE_FLOCK } from './laneStateFixture.js';
import {
  ATTEMPT, CODE, GOOD_TOKEN, authBox, authEnv, ccrcAuth, logLines, plantProbeHook, reapAll, scratchOf, scrollbacks,
  statusOf, tokenFile, waitQuiet, waitState,
} from './authAttemptFixture.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const homes: string[] = [];
afterEach(() => { for (const h of homes.splice(0)) reapAll(h); });
const box = (prefix: string): string => { const h = authBox(prefix); homes.push(h); return h; };

/** The unit's copy of the helper, run as the unit runs it, in a process group of its own. */
function outer(home: string, id: string, method: string, extra: NodeJS.ProcessEnv = {}): ChildProcess {
  const helper = join(home, '.local', 'bin', 'ccd-account-auth');
  const env = ghContainedEnv(home, authEnv(home, extra), { systemd: true, tmux: true });
  return spawn(BASH, [helper, id, method, '--attempt', ATTEMPT], { env, detached: true, stdio: 'ignore' });
}

const exited = (c: ChildProcess): Promise<number> => new Promise((res) => {
  if (c.exitCode !== null) { res(c.exitCode); return; }
  c.on('exit', (code, sig) => res(code ?? (sig === 'SIGTERM' ? 143 : -1)));
});

const sendCode = (home: string, id: string, value: string) =>
  ccrcAuth(home, ['account', 'auth-code', '--id', id, '--attempt', ATTEMPT], `${value}\n`);

const killServers = (home: string): string[] => logLines(home, 'tmux-calls-log').filter((l) => / kill-server$/.test(l));

describe('the pane is on the lane\'s private server (D-5515)', () => {
  it('the pane is on `-L ccrc-auth-<id>`, never the default socket', async () => {
    const home = box('ccd-auth-sock-');
    const c = outer(home, 'lane-b', 'setup-token');
    expect(await waitState(home, 'lane-b', ['waiting-code'])).toBe('waiting-code');
    const calls = logLines(home, 'tmux-calls-log');
    expect(calls.some((l) => l.startsWith('-L ccrc-auth-lane-b -f /dev/null new-session -d -s cc-auth-lane-b -x 120 -y 40 '))).toBe(true);
    expect(calls.filter((l) => !l.startsWith('-L ccrc-auth-lane-b ')), 'a tmux call off the private socket').toEqual([]);
    expect(Object.keys(scrollbacks(home))).toEqual(['ccrc-auth-lane-b']);
    expect(sendCode(home, 'lane-b', CODE).code).toBe(0);
    expect(await waitState(home, 'lane-b', ['done', 'failed'])).toBe('done');
    expect(await exited(c)).toBe(0);
    expect(logLines(home, 'tmux-calls-log').filter((l) => !l.startsWith('-L ccrc-auth-lane-b '))).toEqual([]);
  }, 60_000);

  describe('every terminal state (done, failed, expired, cancelled) runs `kill-server` and deletes `auth-scratch/<id>`', () => {
    const ends: Record<string, (home: string, c: ChildProcess) => Promise<void>> = {
      done: async (home) => {
        expect(await waitState(home, 'lane-b', ['waiting-code'])).toBe('waiting-code');
        expect(sendCode(home, 'lane-b', CODE).code).toBe(0);
      },
      failed: async (home) => {
        expect(await waitState(home, 'lane-b', ['waiting-code'])).toBe('waiting-code');
        expect(sendCode(home, 'lane-b', 'BAD-a20-code-1234567890').code).toBe(0);
      },
      // No code arrives: the helper's own deadline ends the attempt.
      expired: async () => { /* the deadline is the terminator */ },
      // What `auth-cancel`'s `systemctl --user stop` does to the unit.
      cancelled: async (home, c) => {
        expect(await waitState(home, 'lane-b', ['waiting-code'])).toBe('waiting-code');
        process.kill(-c.pid!, 'SIGTERM');
      },
    };
    it.each(Object.keys(ends))('%s', async (want) => {
      const home = box(`ccd-auth-end-${want}-`);
      const c = outer(home, 'lane-b', 'setup-token', want === 'expired' ? { CCRC_AUTH_TIMEOUT: '3', CCRC_AUTH_PUMP_GRACE: '2' } : {});
      await ends[want]!(home, c);
      expect(await waitState(home, 'lane-b', ['done', 'failed', 'expired', 'cancelled'], 40_000)).toBe(want);
      await exited(c);
      await waitQuiet(home);
      expect(statusOf(home, 'lane-b')?.['attemptId']).toBe(ATTEMPT);
      expect(killServers(home), 'the private server was not killed by name').toContain('-L ccrc-auth-lane-b kill-server');
      expect(existsSync(scratchOf(home, 'lane-b')), 'auth-scratch/<id> outlived the attempt').toBe(false);
      // Only `done` installs: every other end leaves the lane's token file as it was (none, in this box).
      expect(existsSync(tokenFile(home, 'lane-b'))).toBe(want === 'done');
    }, 60_000);
  });

  it('the setup-token line is captured into the 0600 file and blanked', async () => {
    const home = box('ccd-auth-capture-');
    // What scratch holds when the install's probe runs: a copy that keeps the file's mode.
    plantProbeHook(home, 'cp -p "$HOME/.ccrc/auth-scratch/lane-b/minted.env" "$HOME/seen-minted" 2>/dev/null || true');
    const c = outer(home, 'lane-b', 'setup-token');
    expect(await waitState(home, 'lane-b', ['waiting-code'])).toBe('waiting-code');
    expect(sendCode(home, 'lane-b', CODE).code).toBe(0);
    expect(await waitState(home, 'lane-b', ['done', 'failed'])).toBe('done');
    await exited(c);
    const seen = join(home, 'seen-minted');
    expect(statSync(seen).mode & 0o777).toBe(0o600);
    expect(readFileSync(seen, 'utf8')).toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${GOOD_TOKEN}\n`);
    const pane = scrollbacks(home)['ccrc-auth-lane-b'] ?? '';
    expect(pane).toContain('[token captured; ccrc checks it before it is installed]');
    expect(pane).toContain('[code written to stdin by ccrc');
    expect(pane, 'the token reached the pane').not.toContain(GOOD_TOKEN);
    expect(pane, 'the code reached the pane').not.toContain(CODE);
    expect(JSON.stringify(statusOf(home, 'lane-b'))).not.toContain(GOOD_TOKEN);
  }, 60_000);
});
