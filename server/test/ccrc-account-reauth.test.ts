// Re-authenticating an existing lane (accounts plan Task A20; spec §9 rows 1, 2; §4.2, §4.4; D-5514, D-7750): Sign in
// again on a sign-in lane and Mint a new token on a token lane both land the new credential in
// `~/.ccrc/auth-scratch/<id>` first, and `ccrc account set --method … --attempt` installs it under the lane lock only
// once its probe passes. The old credential stands until then, so a refused, cancelled or expired re-auth leaves the
// lane byte-identical. Every setup-token install records `mintedAt`; a paste clears it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ACCOUNT_OP, BASH, HAVE_FLOCK, ccrcIn, laneState } from './laneStateFixture.js';
import {
  ATTEMPT, CODE, GOOD_OLD_TOKEN, GOOD_SIGN_IN, GOOD_TOKEN, HOST_OSTYPE, OLD_SIGN_IN, REFUSED_SIGN_IN, REFUSED_TOKEN,
  answerOf, authBox, authEnv, ccrcAuth, credFile, plantAttempt, plantMinted, plantProbeHook, plantScratchSignIn, reapAll,
  scratchOf, tokenFile, waitQuiet, waitState,
} from './authAttemptFixture.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const homes: string[] = [];
afterEach(() => { for (const h of homes.splice(0)) reapAll(h); });
const box = (prefix: string): string => { const h = authBox(prefix); homes.push(h); return h; };

const host = { OSTYPE: HOST_OSTYPE };
const setMethod = (home: string, id: string, method: string) =>
  ccrcAuth(home, ['account', 'set', '--id', id, '--method', method, '--attempt', ATTEMPT], '', host);

function plantToken(home: string, id: string, token: string): void {
  mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(tokenFile(home, id), `export CLAUDE_CODE_OAUTH_TOKEN=${token}\n`, { mode: 0o600 });
}

/** The lane-state writer called directly, under this fixture's env (`laneStateFixture`'s would re-plant its refusers). */
function writeLane(home: string, args: string[]): void {
  const r = spawnSync(BASH, ['-c', 'exec node "$@"', '_', ACCOUNT_OP, 'lane-state', ...args], { env: authEnv(home, host), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`lane-state refused: ${r.stdout}${r.stderr}`);
}

/** Everything a re-auth must leave as it was when it does not install: the lane's credential, its roster entry and its
 *  lane state, as bytes. */
function snapshot(home: string): string {
  const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '<absent>');
  return JSON.stringify([
    read(tokenFile(home, 'lane-b')), read(credFile(home, '.claude-lane-s')), read(join(home, '.ccrc', 'accounts.json')),
    read(join(home, '.cc-sessions', '.accounts', 'lane-b.json')), read(join(home, '.cc-sessions', '.accounts', 'lane-s.json')),
    read(join(home, '.local', 'bin', 'lane-b')), read(join(home, '.local', 'bin', 'lane-s')),
  ]);
}

describe('Sign in again (spec §9 row 1)', () => {
  it('Sign in again on a login lane leaves `.credentials.json` byte-identical until the scratch credential passes its check, then replaces it', () => {
    const home = box('ccrc-reauth-signin-');
    writeFileSync(credFile(home, '.claude-lane-s'), `${OLD_SIGN_IN}\n`, { mode: 0o600 });
    plantAttempt(home, 'lane-s', ATTEMPT);
    plantScratchSignIn(home, 'lane-s', GOOD_SIGN_IN);
    plantProbeHook(home, 'cp "$HOME/.claude-lane-s/.credentials.json" "$HOME/seen-at-probe"');
    const r = setMethod(home, 'lane-s', 'login');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(join(home, 'seen-at-probe'), 'utf8'), 'the old sign-in was replaced before the check').toBe(`${OLD_SIGN_IN}\n`);
    expect(readFileSync(credFile(home, '.claude-lane-s'), 'utf8')).toBe(`${GOOD_SIGN_IN}\n`);
    expect(existsSync(join(scratchOf(home, 'lane-s'), 'config'))).toBe(false);
  }, 60_000);

  it('a refused scratch sign-in leaves the lane byte-identical', () => {
    const home = box('ccrc-reauth-signin-refused-');
    writeFileSync(credFile(home, '.claude-lane-s'), `${OLD_SIGN_IN}\n`, { mode: 0o600 });
    plantAttempt(home, 'lane-s', ATTEMPT);
    plantScratchSignIn(home, 'lane-s', REFUSED_SIGN_IN);
    const before = snapshot(home);
    const r = setMethod(home, 'lane-s', 'login');
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('key-rejected');
    expect(snapshot(home)).toBe(before);
  }, 60_000);
});

describe('Mint a new token (spec §9 row 2)', () => {
  it('Mint a new token on a token lane mints into `auth-scratch/<id>`, keeps the old `<id>-oauth.env` until the probe passes, then installs through `credential` under the lane lock', () => {
    const home = box('ccrc-reauth-mint-');
    plantToken(home, 'lane-b', GOOD_OLD_TOKEN);
    plantAttempt(home, 'lane-b', ATTEMPT);
    plantMinted(home, 'lane-b', GOOD_TOKEN);
    plantProbeHook(home, 'cp "$HOME/.cc-secrets/lane-b-oauth.env" "$HOME/seen-at-probe"');
    const r = setMethod(home, 'lane-b', 'setup-token');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(GOOD_TOKEN);
    expect(readFileSync(join(home, 'seen-at-probe'), 'utf8')).toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${GOOD_OLD_TOKEN}\n`);
    expect(readFileSync(tokenFile(home, 'lane-b'), 'utf8')).toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${GOOD_TOKEN}\n`);
    expect(existsSync(join(scratchOf(home, 'lane-b'), 'minted.env'))).toBe(false);

    // The same install with the lane's lock held from outside: refused, and the old token stands.
    plantToken(home, 'lane-b', GOOD_OLD_TOKEN);
    plantMinted(home, 'lane-b', GOOD_TOKEN);
    const hold = 'mkdir -p -m 0700 "$HOME/.ccrc/locks"; exec 7>>"$HOME/.ccrc/locks/$2.lock"; flock -n 7 || exit 3; '
      + 'exec "$1" account set --id "$2" --method setup-token --attempt "$3"';
    const busy = spawnSync(BASH, ['-c', hold, '_', ccrcIn(home), 'lane-b', ATTEMPT], { env: authEnv(home, host), encoding: 'utf8' });
    expect(busy.status, busy.stdout + busy.stderr).toBe(1);
    expect(answerOf({ stdout: busy.stdout, stderr: busy.stderr })['error']).toBe('lane-busy');
    expect(readFileSync(tokenFile(home, 'lane-b'), 'utf8')).toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${GOOD_OLD_TOKEN}\n`);
  }, 60_000);

  it('refuses to install what another attempt captured', () => {
    const home = box('ccrc-reauth-other-attempt-');
    plantToken(home, 'lane-b', GOOD_OLD_TOKEN);
    plantAttempt(home, 'lane-b', 'f'.repeat(32));
    plantMinted(home, 'lane-b', GOOD_TOKEN);
    const before = snapshot(home);
    const r = setMethod(home, 'lane-b', 'setup-token');
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('no-auth-attempt');
    expect(snapshot(home)).toBe(before);
  }, 60_000);
});

describe('a re-auth that does not finish', () => {
  it('a refused, cancelled or expired re-auth leaves the lane byte-identical', async () => {
    // Refused: the probe says 401.
    const refused = box('ccrc-reauth-refused-');
    plantToken(refused, 'lane-b', GOOD_OLD_TOKEN);
    plantAttempt(refused, 'lane-b', ATTEMPT);
    plantMinted(refused, 'lane-b', REFUSED_TOKEN);
    let before = snapshot(refused);
    const r = setMethod(refused, 'lane-b', 'setup-token');
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('key-rejected');
    expect(snapshot(refused)).toBe(before);

    // Cancelled and expired: the attempt ends before any code reaches the mint, so nothing reaches `set`.
    for (const how of ['cancelled', 'expired'] as const) {
      const home = box(`ccrc-reauth-${how}-`);
      plantToken(home, 'lane-b', GOOD_OLD_TOKEN);
      writeFileSync(credFile(home, '.claude-lane-s'), `${OLD_SIGN_IN}\n`, { mode: 0o600 });
      before = snapshot(home);
      const extra = how === 'expired' ? { CCRC_AUTH_TIMEOUT: '3', CCRC_AUTH_PUMP_GRACE: '2' } : {};
      for (const [id, method] of [['lane-b', 'setup-token'], ['lane-s', 'login']] as const) {
        const s = ccrcAuth(home, ['account', 'auth-start', '--id', id, '--method', method, '--attempt', ATTEMPT], '', extra);
        expect(s.code, s.stdout + s.stderr).toBe(0);
        expect(await waitState(home, id, ['waiting-code'])).toBe('waiting-code');
        if (how === 'cancelled') {
          expect(ccrcAuth(home, ['account', 'auth-cancel', '--id', id, '--attempt', ATTEMPT]).code).toBe(0);
        }
        expect(await waitState(home, id, [how, 'failed', 'done'], 40_000)).toBe(how);
      }
      await waitQuiet(home);
      expect(snapshot(home), how).toBe(before);
      expect(existsSync(scratchOf(home, 'lane-b'))).toBe(false);
      expect(existsSync(scratchOf(home, 'lane-s'))).toBe(false);
    }
  }, 120_000);
});

describe('mintedAt (spec §4.1 Expiring; A12 reads it)', () => {
  it('every setup-token install writes `mintedAt` and a paste clears it', async () => {
    const home = box('ccrc-reauth-minted-at-');
    plantToken(home, 'lane-b', GOOD_OLD_TOKEN);
    writeLane(home, ['--id', 'lane-b', '--check-verdict', 'ok', '--check-at', '2026-11-01T00:00:00Z']);
    plantAttempt(home, 'lane-b', ATTEMPT);
    plantMinted(home, 'lane-b', GOOD_TOKEN);
    expect(setMethod(home, 'lane-b', 'setup-token').code).toBe(0);
    const minted = laneState(home, 'lane-b')!;
    expect(typeof minted['mintedAt']).toBe('string');
    expect(Date.parse(String(minted['mintedAt']))).toBeGreaterThan(Date.now() - 60_000);
    // The new token has not been checked: the old verdict went with the old token.
    expect(minted['check']).toBeUndefined();

    // Through the whole attempt too: a mint on the lane, start to install.
    plantToken(home, 'lane-b', GOOD_OLD_TOKEN);
    writeLane(home, ['--id', 'lane-b', '--clear', 'mintedAt']);
    plantAttempt(home, 'lane-b', ATTEMPT, 'done');
    expect(ccrcAuth(home, ['account', 'auth-start', '--id', 'lane-b', '--method', 'setup-token', '--attempt', ATTEMPT]).code).toBe(0);
    expect(await waitState(home, 'lane-b', ['waiting-code'])).toBe('waiting-code');
    expect(ccrcAuth(home, ['account', 'auth-code', '--id', 'lane-b', '--attempt', ATTEMPT], `${CODE}\n`).code).toBe(0);
    expect(await waitState(home, 'lane-b', ['done', 'failed'])).toBe('done');
    await waitQuiet(home);
    expect(typeof laneState(home, 'lane-b')!['mintedAt']).toBe('string');

    // A paste over the minted token clears it.
    const paste = ccrcAuth(home, ['account', 'credential', '--id', 'lane-b', '--credential', '-'], `${GOOD_OLD_TOKEN}\n`, host);
    expect(paste.code, paste.stdout + paste.stderr).toBe(0);
    expect(laneState(home, 'lane-b')!['mintedAt']).toBeUndefined();
  }, 90_000);

  it('a sign-in install writes no `mintedAt`', () => {
    const home = box('ccrc-reauth-signin-no-minted-');
    writeFileSync(credFile(home, '.claude-lane-s'), `${OLD_SIGN_IN}\n`, { mode: 0o600 });
    plantAttempt(home, 'lane-s', ATTEMPT);
    plantScratchSignIn(home, 'lane-s', GOOD_SIGN_IN);
    expect(setMethod(home, 'lane-s', 'login').code).toBe(0);
    expect(laneState(home, 'lane-s')?.['mintedAt']).toBeUndefined();
  }, 60_000);
});
