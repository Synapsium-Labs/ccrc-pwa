// The two method switches and N5's sign-out act (accounts plan Task A20; spec §9's sign-in -> token and token ->
// sign-in rows, §13.3's `set --method`; Q1, N5; D-7749, D-7750). The roster has no method field: a token lane is one
// whose entry names `exec.secretsFile` (A1), so `ccrc account set --method setup-token|login --attempt` is the one writer
// that sets or clears it, rewrites `accounts.sh` and the wrapper, and moves the credential. Each switch installs only
// after the new credential's probe passes; until then, and when it is refused, cancelled or expired, the lane is
// byte-identical. `credential --sign-out` runs `claude auth logout` in that lane's config dir and nowhere else.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ACCOUNT_OP, BASH, HAVE_FLOCK, laneState } from './laneStateFixture.js';
import {
  ATTEMPT, GOOD_OLD_TOKEN, GOOD_SIGN_IN, GOOD_TOKEN, HOST_OSTYPE, OLD_SIGN_IN, REFUSED_SIGN_IN, REFUSED_TOKEN,
  answerOf, authBox, authEnv, ccrcAuth, credFile, logLines, plantAttempt, plantMinted, plantProbeHook,
  plantScratchSignIn, reapAll, rosterOf, scratchOf, tokenFile, waitQuiet, waitState,
} from './authAttemptFixture.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const homes: string[] = [];
afterEach(() => { for (const h of homes.splice(0)) reapAll(h); });
const box = (prefix: string): string => { const h = authBox(prefix); homes.push(h); return h; };

const host = { OSTYPE: HOST_OSTYPE };
const setMethod = (home: string, id: string, method: string) =>
  ccrcAuth(home, ['account', 'set', '--id', id, '--method', method, '--attempt', ATTEMPT], '', host);
const secretsFileOf = (home: string, id: string): unknown => rosterOf(home).accounts.find((a) => a.id === id)?.exec['secretsFile'];

function plantToken(home: string, id: string, token: string): void {
  mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(tokenFile(home, id), `export CLAUDE_CODE_OAUTH_TOKEN=${token}\n`, { mode: 0o600 });
}

function writeLane(home: string, args: string[]): void {
  const r = spawnSync(BASH, ['-c', 'exec node "$@"', '_', ACCOUNT_OP, 'lane-state', ...args], { env: authEnv(home, host), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`lane-state refused: ${r.stdout}${r.stderr}`);
}

/** The lane's credential, its roster entry, accounts.sh and its wrapper, as bytes. */
function snapshot(home: string, id: string, suffix: string): string {
  const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '<absent>');
  return JSON.stringify([
    read(tokenFile(home, id)), read(credFile(home, suffix)), read(join(home, '.ccrc', 'accounts.json')),
    read(join(home, '.ccrc', 'accounts.sh')), read(join(home, '.local', 'bin', id)),
  ]);
}

/** The wrapper `ccrc wrappers` generates for every lane, so a switch's rewrite is measured against a real one. */
function converge(home: string): void {
  const r = ccrcAuth(home, ['wrappers'], '', host);
  if (r.code !== 0) throw new Error(`ccrc wrappers refused: ${r.stdout}${r.stderr}`);
}

describe('token -> sign-in (Switch to sign-in)', () => {
  it('cancelling, expiring or refusing a token -> sign-in switch leaves the token file and the roster method byte-identical', async () => {
    // Refused: the scratch sign-in's probe says 401.
    const refused = box('ccrc-switch-tl-refused-');
    converge(refused);
    plantToken(refused, 'lane-b', GOOD_OLD_TOKEN);
    plantAttempt(refused, 'lane-b', ATTEMPT);
    plantScratchSignIn(refused, 'lane-b', REFUSED_SIGN_IN);
    let before = snapshot(refused, 'lane-b', '.claude-lane-b');
    const r = setMethod(refused, 'lane-b', 'login');
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('key-rejected');
    expect(snapshot(refused, 'lane-b', '.claude-lane-b')).toBe(before);

    // Cancelled and expired: the sign-in into scratch never finishes, so nothing reaches `set`.
    for (const how of ['cancelled', 'expired'] as const) {
      const home = box(`ccrc-switch-tl-${how}-`);
      converge(home);
      plantToken(home, 'lane-b', GOOD_OLD_TOKEN);
      before = snapshot(home, 'lane-b', '.claude-lane-b');
      const extra = how === 'expired' ? { CCRC_AUTH_TIMEOUT: '3', CCRC_AUTH_PUMP_GRACE: '2' } : {};
      const s = ccrcAuth(home, ['account', 'auth-start', '--id', 'lane-b', '--method', 'login', '--attempt', ATTEMPT], '', extra);
      expect(s.code, s.stdout + s.stderr).toBe(0);
      expect(await waitState(home, 'lane-b', ['waiting-code'])).toBe('waiting-code');
      if (how === 'cancelled') expect(ccrcAuth(home, ['account', 'auth-cancel', '--id', 'lane-b', '--attempt', ATTEMPT]).code).toBe(0);
      expect(await waitState(home, 'lane-b', [how, 'failed', 'done'], 40_000)).toBe(how);
      await waitQuiet(home);
      // The sign-in ran into scratch, never into the token lane's own config dir.
      const dirs = logLines(home, 'upstream-calls').filter((l) => l.startsWith('auth login')).map((l) => l.split('|')[1]);
      expect(dirs).toEqual([join(scratchOf(home, 'lane-b'), 'config')]);
      expect(snapshot(home, 'lane-b', '.claude-lane-b'), how).toBe(before);
      expect(existsSync(scratchOf(home, 'lane-b'))).toBe(false);
    }
  }, 120_000);

  it('a token -> sign-in switch clears `exec.secretsFile` only after the scratch check passes', () => {
    const home = box('ccrc-switch-tl-ok-');
    converge(home);
    plantToken(home, 'lane-b', GOOD_OLD_TOKEN);
    writeLane(home, ['--id', 'lane-b', '--minted-at', '2026-10-01T00:00:00Z']);
    plantAttempt(home, 'lane-b', ATTEMPT);
    plantScratchSignIn(home, 'lane-b', GOOD_SIGN_IN);
    plantProbeHook(home, [
      'grep -c secretsFile "$HOME/.ccrc/accounts.json" > "$HOME/seen-secrets-files"',
      '[ -e "$HOME/.cc-secrets/lane-b-oauth.env" ] && echo token > "$HOME/seen-token" || echo none > "$HOME/seen-token"',
    ].join('\n'));
    expect(secretsFileOf(home, 'lane-b')).toBe('.cc-secrets/lane-b-oauth.env');
    const r = setMethod(home, 'lane-b', 'login');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    // At the check, the lane was still a token lane, with its token.
    expect(readFileSync(join(home, 'seen-secrets-files'), 'utf8').trim()).toBe('1');
    expect(readFileSync(join(home, 'seen-token'), 'utf8').trim()).toBe('token');
    // Then: a sign-in lane, its sign-in in place, the token gone, the wrapper sourcing nothing.
    expect(secretsFileOf(home, 'lane-b')).toBeUndefined();
    expect(readFileSync(credFile(home, '.claude-lane-b'), 'utf8')).toBe(`${GOOD_SIGN_IN}\n`);
    expect(existsSync(tokenFile(home, 'lane-b'))).toBe(false);
    expect(readFileSync(join(home, '.local', 'bin', 'lane-b'), 'utf8')).not.toContain('lane-b-oauth.env');
    expect(laneState(home, 'lane-b')!['mintedAt']).toBeUndefined();
    expect(answerOf(r)).toMatchObject({ ok: true, id: 'lane-b' });
  }, 60_000);
});

describe('sign-in -> token (Switch to a long-lived token, Q1)', () => {
  it('a sign-in -> token switch writes the token and `exec.secretsFile` only after the probe passes, and leaves `.credentials.json` in place', () => {
    const home = box('ccrc-switch-st-ok-');
    converge(home);
    writeFileSync(credFile(home, '.claude-lane-s'), `${OLD_SIGN_IN}\n`, { mode: 0o600 });
    plantAttempt(home, 'lane-s', ATTEMPT);
    plantMinted(home, 'lane-s', GOOD_TOKEN);
    plantProbeHook(home, [
      'grep -c secretsFile "$HOME/.ccrc/accounts.json" > "$HOME/seen-secrets-files"',
      '[ -e "$HOME/.cc-secrets/lane-s-oauth.env" ] && echo token > "$HOME/seen-token" || echo none > "$HOME/seen-token"',
    ].join('\n'));
    const r = setMethod(home, 'lane-s', 'setup-token');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(GOOD_TOKEN);
    // At the probe: only lane-b named a secrets file, and lane-s had no token on disk.
    expect(readFileSync(join(home, 'seen-secrets-files'), 'utf8').trim()).toBe('1');
    expect(readFileSync(join(home, 'seen-token'), 'utf8').trim()).toBe('none');
    // Then: a token lane, its wrapper sourcing the token, and the old sign-in still there until it is signed out.
    expect(secretsFileOf(home, 'lane-s')).toBe('.cc-secrets/lane-s-oauth.env');
    expect(readFileSync(tokenFile(home, 'lane-s'), 'utf8')).toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${GOOD_TOKEN}\n`);
    expect(readFileSync(join(home, '.local', 'bin', 'lane-s'), 'utf8')).toContain('.cc-secrets/lane-s-oauth.env');
    expect(readFileSync(credFile(home, '.claude-lane-s'), 'utf8')).toBe(`${OLD_SIGN_IN}\n`);
    expect(typeof laneState(home, 'lane-s')!['mintedAt']).toBe('string');
  }, 60_000);

  it('a refused mint leaves the sign-in lane byte-identical', () => {
    const home = box('ccrc-switch-st-refused-');
    converge(home);
    writeFileSync(credFile(home, '.claude-lane-s'), `${OLD_SIGN_IN}\n`, { mode: 0o600 });
    plantAttempt(home, 'lane-s', ATTEMPT);
    plantMinted(home, 'lane-s', REFUSED_TOKEN);
    const before = snapshot(home, 'lane-s', '.claude-lane-s');
    const r = setMethod(home, 'lane-s', 'setup-token');
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('key-rejected');
    expect(snapshot(home, 'lane-s', '.claude-lane-s')).toBe(before);
  }, 60_000);
});

describe('N5: the sign-out act (D-7749)', () => {
  it('`credential --sign-out` runs logout in that lane\'s config dir only', () => {
    const home = box('ccrc-sign-out-');
    writeFileSync(credFile(home, '.claude-lane-s'), `${GOOD_SIGN_IN}\n`, { mode: 0o600 });
    writeFileSync(credFile(home, '.claude-lane-b'), `${GOOD_SIGN_IN}\n`, { mode: 0o600 });
    const r = ccrcAuth(home, ['account', 'credential', '--id', 'lane-s', '--sign-out'], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(answerOf(r)).toMatchObject({ ok: true, id: 'lane-s', signOut: 'removed' });
    expect(logLines(home, 'logout-dirs')).toEqual([join(home, '.claude-lane-s')]);
    expect(existsSync(credFile(home, '.claude-lane-s'))).toBe(false);
    expect(readFileSync(credFile(home, '.claude-lane-b'), 'utf8')).toBe(`${GOOD_SIGN_IN}\n`);
    // A lane with nothing signed in answers so, and runs no logout.
    const again = ccrcAuth(home, ['account', 'credential', '--id', 'lane-s', '--sign-out'], '', host);
    expect(again.code).toBe(0);
    expect(answerOf(again)['signOut']).toBe('absent');
    expect(logLines(home, 'logout-dirs')).toHaveLength(1);
    // It reads no credential, so it refuses one.
    const both = ccrcAuth(home, ['account', 'credential', '--id', 'lane-s', '--sign-out', '--credential', '-'], 'x\n', host);
    expect(both.code).toBe(2);
  }, 60_000);

  it('refuses a lane that is not a generated Anthropic lane, and signs nothing out', () => {
    const home = box('ccrc-sign-out-upstream-');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(credFile(home, '.claude'), `${GOOD_SIGN_IN}\n`, { mode: 0o600 });
    const r = ccrcAuth(home, ['account', 'credential', '--id', 'claude', '--sign-out'], '', host);
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('not-a-sign-in-lane');
    expect(logLines(home, 'logout-dirs')).toEqual([]);
    expect(existsSync(credFile(home, '.claude'))).toBe(true);
  }, 60_000);
});
