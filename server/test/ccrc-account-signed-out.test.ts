// A lane the box signed out, and whether a lane holds a credential at all, in the lane-state file (D-7992). N5's sign-out
// used to clear the lane's check and nothing else, so a signed-out lane read exactly like one never checked. The box now
// records `signedOutAt` beside it, and every lane-state write carries `credential`, measured on the box: `held` or
// `none`, or nothing where it cannot say. The next credential install or passing check ends the sign-out. The server's
// reader takes both as they are written here; the wire's own case is `accounts-route-lanes.test.ts`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { laneStateOf } from '../../shared/accounts.js';
import { ACCOUNT_OP, BASH, HAVE_FLOCK, laneState, laneStatePath, seedRoster } from './laneStateFixture.js';
import {
  AUTH_ROSTER, ATTEMPT, GOOD_SIGN_IN, GOOD_TOKEN, HOST_OSTYPE, answerOf, authBox, authEnv, ccrcAuth, credFile, plantAttempt,
  plantMinted, plantScratchSignIn, reapAll, tokenFile,
} from './authAttemptFixture.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const homes: string[] = [];
afterEach(() => { for (const h of homes.splice(0)) reapAll(h); });
const box = (prefix: string): string => { const h = authBox(prefix); homes.push(h); return h; };

const host = { OSTYPE: HOST_OSTYPE };
/** `ccrc` runs on this host's own arm, so on a Mac a missing `.credentials.json` is no measure (`laneCredentialOf`). */
const ON_A_MAC = HOST_OSTYPE.startsWith('darwin');
const NO_FILE_WORD = ON_A_MAC ? undefined : 'none';
const rosterFile = (home: string): string => join(home, '.ccrc', 'accounts.json');
const signOut = (home: string, id: string) => ccrcAuth(home, ['account', 'credential', '--id', id, '--sign-out'], '', host);
const setMethod = (home: string, id: string, method: string) =>
  ccrcAuth(home, ['account', 'set', '--id', id, '--method', method, '--attempt', ATTEMPT], '', host);
const plantSignIn = (home: string, suffix: string): void => writeFileSync(credFile(home, suffix), `${GOOD_SIGN_IN}\n`, { mode: 0o600 });
/** A sign-in lane the box signed out: with a sign-in to remove, so the sign-out is recorded on every platform. */
const signedOut = (home: string): void => { plantSignIn(home, '.claude-lane-s'); signOut(home, 'lane-s'); };

function plantToken(home: string, id: string, body: string): void {
  mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(tokenFile(home, id), body, { mode: 0o600 });
}

/** The op alone stats and writes, with no platform's tools, so each case names the arm it means: Linux unless it says. */
function laneOp(home: string, args: string[], OSTYPE = 'linux-gnu'): { code: number; out: string } {
  const r = spawnSync(BASH, ['-c', 'exec node "$@"', '_', ACCOUNT_OP, 'lane-state', ...args], { env: authEnv(home, { OSTYPE }), encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
function mustLaneOp(home: string, args: string[], OSTYPE?: string): void {
  const r = laneOp(home, args, OSTYPE);
  if (r.code !== 0) throw new Error(`lane-state refused: ${r.out}`);
}

/** The roster's lanes whose credential ccrc does not read: `claude`, its upstream lane, and two declared launchers, one
 *  naming no provider and one naming Anthropic. */
const launcherLane = (id: string, exec: Record<string, unknown>) => ({ id, label: 'lane·x', configDirSuffix: `.claude-${id}`, exec, homeAble: false, hue: 'green', telemetry: 'none' });
const ELSEWHERE_ROSTER = {
  ...AUTH_ROSTER,
  accounts: [...AUTH_ROSTER.accounts, launcherLane('lane-x', { kind: 'external', launcher: '/bin/true' }),
    launcherLane('lane-p', { kind: 'external', provider: 'anthropic', launcher: '/bin/true' })],
};

describe('the sign-out, recorded (D-7992)', () => {
  it('`credential --sign-out` records when a sign-in lane was signed out, and that it holds no credential', () => {
    const home = box('ccrc-signed-out-');
    plantSignIn(home, '.claude-lane-s');
    mustLaneOp(home, ['--id', 'lane-s', '--check-verdict', 'ok', '--check-at', '2026-11-01T00:00:00Z']);
    const before = Date.now();
    const r = signOut(home, 'lane-s');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const st = laneState(home, 'lane-s')!;
    expect(st['check']).toBeUndefined();
    expect(st['credential']).toBe(NO_FILE_WORD);
    expect(Date.parse(st['signedOutAt'] as string)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(st['signedOutAt'] as string)).toBeLessThanOrEqual(Date.now());
  }, 60_000);

  it.skipIf(ON_A_MAC)('a sign-in lane with nothing signed in is signed out too: the answer says `absent`, and the lane says so', () => {
    const home = box('ccrc-signed-out-absent-');
    const r = signOut(home, 'lane-s');
    expect(answerOf(r)['signOut']).toBe('absent');
    expect(typeof laneState(home, 'lane-s')!['signedOutAt']).toBe('string');
  }, 60_000);

  it.runIf(ON_A_MAC)('on a Mac `absent` proves nothing, since a sign-in may stand in the keychain: no sign-out is recorded', () => {
    const home = box('ccrc-signed-out-absent-mac-');
    mustLaneOp(home, ['--id', 'lane-s', '--check-verdict', 'ok', '--check-at', '2026-11-01T00:00:00Z']);
    const r = signOut(home, 'lane-s');
    expect(answerOf(r)['signOut']).toBe('absent');
    const st = laneState(home, 'lane-s')!;
    expect(st['signedOutAt']).toBeUndefined();
    expect(st['check']).toBeUndefined();
    expect(st).not.toHaveProperty('credential');
  }, 60_000);

  it('a token lane keeps its token through "Sign the old sign-in out": it records no sign-out and keeps its check', () => {
    const home = box('ccrc-signed-out-token-');
    plantSignIn(home, '.claude-lane-b');
    plantToken(home, 'lane-b', 'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-token\n');
    mustLaneOp(home, ['--id', 'lane-b', '--check-verdict', 'ok', '--check-at', '2026-11-01T00:00:00Z']);
    const r = signOut(home, 'lane-b');
    expect(answerOf(r)['signOut']).toBe('removed');
    const st = laneState(home, 'lane-b')!;
    expect(st['signedOutAt']).toBeUndefined();
    expect(st['check']).toBeDefined();
  }, 60_000);

  it('the server reads what the box wrote, field for field', () => {
    const home = box('ccrc-signed-out-read-');
    signedOut(home);
    const raw = JSON.parse(readFileSync(laneStatePath(home, 'lane-s'), 'utf8')) as Record<string, unknown>;
    const read = laneStateOf(raw)!;
    expect(read.credential).toBe(NO_FILE_WORD);
    expect(read.signedOutAt).toBe(Date.parse(raw['signedOutAt'] as string));
  }, 60_000);
});

describe('what ends a sign-out (D-7992)', () => {
  it('Sign in again ends it: the sign-in is installed, and the lane holds a credential', () => {
    const home = box('ccrc-signed-out-install-');
    plantSignIn(home, '.claude-lane-s');
    signOut(home, 'lane-s');
    plantAttempt(home, 'lane-s', ATTEMPT);
    plantScratchSignIn(home, 'lane-s', GOOD_SIGN_IN);
    const r = setMethod(home, 'lane-s', 'login');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const st = laneState(home, 'lane-s')!;
    expect(st['signedOutAt']).toBeUndefined();
    expect(st['credential']).toBe('held');
  }, 60_000);

  it('a switch to the long-lived token ends it', () => {
    const home = box('ccrc-signed-out-mint-');
    signedOut(home);
    plantAttempt(home, 'lane-s', ATTEMPT);
    plantMinted(home, 'lane-s', GOOD_TOKEN);
    const r = setMethod(home, 'lane-s', 'setup-token');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const st = laneState(home, 'lane-s')!;
    expect(st['signedOutAt']).toBeUndefined();
    expect(st['credential']).toBe('held');
  }, 60_000);

  it('a refused install does not: the lane stays signed out', () => {
    const home = box('ccrc-signed-out-refused-');
    signedOut(home);
    const at = laneState(home, 'lane-s')!['signedOutAt'];
    plantAttempt(home, 'lane-s', ATTEMPT);
    plantMinted(home, 'lane-s', 'NOPE-a20-minted-not-a-real-token');
    expect(setMethod(home, 'lane-s', 'setup-token').code).toBe(1);
    expect(laneState(home, 'lane-s')!['signedOutAt']).toBe(at);
  }, 60_000);

  it('a passing check ends it, with or without the roster at hand; any other verdict does not', () => {
    const home = box('ccrc-signed-out-check-');
    signedOut(home);
    mustLaneOp(home, ['--id', 'lane-s', '--check-verdict', 'auth-dead', '--check-at', '2026-11-01T00:00:00Z']);
    expect(typeof laneState(home, 'lane-s')!['signedOutAt']).toBe('string');
    mustLaneOp(home, ['--id', 'lane-s', '--check-verdict', 'ok', '--check-at', '2026-11-01T00:00:01Z']);
    expect(laneState(home, 'lane-s')!['signedOutAt']).toBeUndefined();
  }, 60_000);

  it('a credential put back by hand ends it at the next write that measures the lane', () => {
    const home = box('ccrc-signed-out-hand-');
    signedOut(home);
    plantSignIn(home, '.claude-lane-s');
    mustLaneOp(home, ['--id', 'lane-s', '--file', rosterFile(home)]);
    expect(laneState(home, 'lane-s')!['signedOutAt']).toBeUndefined();
    expect(laneState(home, 'lane-s')!['credential']).toBe('held');
  }, 60_000);
});

describe('`credential`: measured on the box, on every write that names the roster (D-7992)', () => {
  const stamp = (home: string, id: string): void => mustLaneOp(home, ['--id', id, '--file', rosterFile(home)]);

  it('a token lane holds what its secrets file holds: a file with bytes in it is `held`, an empty or missing one `none`', () => {
    const home = box('ccrc-credential-token-');
    stamp(home, 'lane-b');
    expect(laneState(home, 'lane-b')!['credential']).toBe('none');
    plantToken(home, 'lane-b', '');
    stamp(home, 'lane-b');
    expect(laneState(home, 'lane-b')!['credential']).toBe('none');
    plantToken(home, 'lane-b', 'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-token\n');
    stamp(home, 'lane-b');
    expect(laneState(home, 'lane-b')!['credential']).toBe('held');
  }, 60_000);

  it('a sign-in lane holds its `.credentials.json`, and a passing check is no measure of the file', () => {
    const home = box('ccrc-credential-sign-in-');
    stamp(home, 'lane-s');
    expect(laneState(home, 'lane-s')!['credential']).toBe('none');
    mustLaneOp(home, ['--id', 'lane-s', '--check-verdict', 'ok', '--check-at', '2026-11-01T00:00:00Z', '--file', rosterFile(home)]);
    expect(laneState(home, 'lane-s')!['credential']).toBe('none');
    plantSignIn(home, '.claude-lane-s');
    stamp(home, 'lane-s');
    expect(laneState(home, 'lane-s')!['credential']).toBe('held');
  }, 60_000);

  it('a logout outside ccrc, behind a passing check: the next write that measures the lane reads the file as it is', () => {
    const home = box('ccrc-credential-logout-');
    plantSignIn(home, '.claude-lane-s');
    mustLaneOp(home, ['--id', 'lane-s', '--check-verdict', 'ok', '--check-at', '2026-11-01T00:00:00Z', '--file', rosterFile(home)]);
    expect(laneState(home, 'lane-s')!['credential']).toBe('held');
    rmSync(credFile(home, '.claude-lane-s'));
    stamp(home, 'lane-s');
    expect(laneState(home, 'lane-s')!['credential']).toBe('none');
    expect(laneState(home, 'lane-s')!['check']).toEqual({ verdict: 'ok', at: '2026-11-01T00:00:00Z' });
  }, 60_000);

  it('on a Mac, where a sign-in lives in the keychain: a file says `held`, no file says nothing, and no word is left behind', () => {
    const home = box('ccrc-credential-mac-');
    const mac = (args: string[]): void => mustLaneOp(home, ['--id', 'lane-s', ...args, '--file', rosterFile(home)], 'darwin23');
    mac([]);
    expect(laneState(home, 'lane-s')).not.toHaveProperty('credential');
    mac(['--check-verdict', 'inconclusive', '--check-at', '2026-11-01T00:00:00Z']);
    expect(laneState(home, 'lane-s')).not.toHaveProperty('credential');
    plantSignIn(home, '.claude-lane-s');
    mac([]);
    expect(laneState(home, 'lane-s')!['credential']).toBe('held');
    rmSync(credFile(home, '.claude-lane-s'));
    mac([]);
    expect(laneState(home, 'lane-s')).not.toHaveProperty('credential');
    // A token lane's secrets file is ccrc's own, on every platform.
    mustLaneOp(home, ['--id', 'lane-b', '--file', rosterFile(home)], 'darwin23');
    expect(laneState(home, 'lane-b')!['credential']).toBe('none');
  }, 60_000);

  it('a lane whose credential ccrc does not read, a lane off the roster and a roster it cannot read record no word', () => {
    const home = box('ccrc-credential-elsewhere-');
    seedRoster(home, ELSEWHERE_ROSTER);
    stamp(home, 'lane-x');
    expect(laneState(home, 'lane-x')).not.toHaveProperty('credential');
    stamp(home, 'lane-gone');
    expect(laneState(home, 'lane-gone')).not.toHaveProperty('credential');
    writeFileSync(rosterFile(home), 'not json');
    stamp(home, 'lane-s');
    expect(laneState(home, 'lane-s')).not.toHaveProperty('credential');
  }, 60_000);

  // Only a sign-in lane's credential is its `.credentials.json`. An upstream lane can run on the token its launcher
  // sources (`_ah_subjects`), and a declared launcher keeps its credential in a config directory of its own, whatever
  // provider it names. No file on either says nothing, so neither reads as signed out behind a check that passed.
  it.each(['claude', 'lane-p'])('%s, working behind a passing check with no `.credentials.json`, records no word', (id) => {
    const home = box('ccrc-credential-launcher-');
    seedRoster(home, ELSEWHERE_ROSTER);
    plantToken(home, 'claude', 'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-token\n');
    mustLaneOp(home, ['--id', id, '--check-verdict', 'ok', '--check-at', '2026-11-01T00:00:00Z', '--file', rosterFile(home)]);
    const st = laneState(home, id)!;
    expect(st['check']).toEqual({ verdict: 'ok', at: '2026-11-01T00:00:00Z' });
    expect(st).not.toHaveProperty('credential');
    stamp(home, id);
    expect(laneState(home, id)).not.toHaveProperty('credential');
  }, 60_000);

  it('a lane of either shape that names a secrets file holds what the file holds, as any token lane does', () => {
    const home = box('ccrc-credential-launcher-file-');
    seedRoster(home, { ...AUTH_ROSTER, accounts: [
      ...AUTH_ROSTER.accounts.map((a) => (a.id === 'claude' ? { ...a, exec: { kind: 'upstream', secretsFile: '.cc-secrets/claude-oauth.env' } } : a)),
      launcherLane('lane-e', { kind: 'external', provider: 'anthropic', launcher: '/bin/true', secretsFile: '.cc-secrets/lane-e-oauth.env' })] });
    for (const id of ['claude', 'lane-e']) {
      stamp(home, id);
      expect(laneState(home, id)!['credential']).toBe('none');
      plantToken(home, id, 'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-token\n');
      stamp(home, id);
      expect(laneState(home, id)!['credential']).toBe('held');
    }
  }, 60_000);

  it('a write that names no roster keeps the word it found', () => {
    const home = box('ccrc-credential-kept-');
    stamp(home, 'lane-s');
    mustLaneOp(home, ['--id', 'lane-s', '--last-run-at', 'now']);
    expect(laneState(home, 'lane-s')!['credential']).toBe('none');
  }, 60_000);

  it('`--mode delete` takes the roster too, since every verb names it', () => {
    const home = box('ccrc-credential-delete-');
    stamp(home, 'lane-s');
    mustLaneOp(home, ['--id', 'lane-s', '--mode', 'delete', '--file', rosterFile(home)]);
    expect(laneState(home, 'lane-s')).toBeNull();
  }, 60_000);

  it('every account verb names the roster: a paste measures the new token', () => {
    const home = box('ccrc-credential-paste-');
    plantToken(home, 'lane-b', 'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-token\n');
    const r = ccrcAuth(home, ['account', 'disable', '--id', 'lane-b'], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(laneState(home, 'lane-b')!['credential']).toBe('held');
  }, 60_000);
});

describe('`--mode credential`, the update\'s sweep (D-7992)', () => {
  const sweep = (home: string, id: string) => laneOp(home, ['--id', id, '--mode', 'credential', '--file', rosterFile(home)]);

  it('adds the word to a file from before it, and keeps every field the file holds', () => {
    const home = box('ccrc-credential-sweep-');
    mustLaneOp(home, ['--id', 'lane-s', '--check-verdict', 'auth-dead', '--check-at', '2026-11-01T00:00:00Z']);
    const was = laneState(home, 'lane-s')!;
    expect(sweep(home, 'lane-s').code).toBe(0);
    expect(laneState(home, 'lane-s')).toEqual({ ...was, credential: 'none' });
  }, 60_000);

  it('rewrites nothing when the word stands', () => {
    const home = box('ccrc-credential-sweep-same-');
    sweep(home, 'lane-s');
    mustLaneOp(home, ['--id', 'lane-s', '--file', rosterFile(home)]);
    const path = laneStatePath(home, 'lane-s');
    const ino = statSync(path).ino;
    expect(sweep(home, 'lane-s').code).toBe(0);
    expect(statSync(path).ino).toBe(ino);
  }, 60_000);

  it('corrects a word the file no longer bears out, behind a passing check too', () => {
    const home = box('ccrc-credential-sweep-logout-');
    plantSignIn(home, '.claude-lane-s');
    mustLaneOp(home, ['--id', 'lane-s', '--check-verdict', 'ok', '--check-at', '2026-11-01T00:00:00Z', '--file', rosterFile(home)]);
    rmSync(credFile(home, '.claude-lane-s'));
    expect(sweep(home, 'lane-s').code).toBe(0);
    expect(laneState(home, 'lane-s')!['credential']).toBe('none');
  }, 60_000);

  it('drops a word the box can no longer measure: a Mac whose file went, with every other field kept', () => {
    const home = box('ccrc-credential-sweep-mac-');
    plantSignIn(home, '.claude-lane-s');
    mustLaneOp(home, ['--id', 'lane-s', '--check-verdict', 'ok', '--check-at', '2026-11-01T00:00:00Z', '--file', rosterFile(home)], 'darwin23');
    rmSync(credFile(home, '.claude-lane-s'));
    expect(laneOp(home, ['--id', 'lane-s', '--mode', 'credential', '--file', rosterFile(home)], 'darwin23').code).toBe(0);
    const st = laneState(home, 'lane-s')!;
    expect(st).not.toHaveProperty('credential');
    expect(st['check']).toEqual({ verdict: 'ok', at: '2026-11-01T00:00:00Z' });
  }, 60_000);

  it('`declare` and the sweep give a declared Anthropic launcher no word, and the sweep takes back a word it should not hold', () => {
    const home = box('ccrc-credential-sweep-declare-');
    writeFileSync(join(home, '.local', 'bin', 'lane-d'), 'exit 0\n', { mode: 0o755 });
    const r = ccrcAuth(home, ['account', 'declare', '--id', 'lane-d', '--provider', 'anthropic', '--label', 'lane·d', '--hue', 'violet'], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(laneState(home, 'lane-d')).not.toBeNull();
    expect(laneState(home, 'lane-d')).not.toHaveProperty('credential');
    expect(sweep(home, 'lane-d').code).toBe(0);
    expect(laneState(home, 'lane-d')).not.toHaveProperty('credential');

    const path = laneStatePath(home, 'lane-d');
    writeFileSync(path, JSON.stringify({ ...laneState(home, 'lane-d'), check: { verdict: 'ok', at: '2026-11-01T00:00:00Z' }, credential: 'none' }));
    expect(sweep(home, 'lane-d').code).toBe(0);
    expect(laneState(home, 'lane-d')).not.toHaveProperty('credential');
    expect(laneState(home, 'lane-d')!['check']).toEqual({ verdict: 'ok', at: '2026-11-01T00:00:00Z' });
  }, 60_000);

  it('makes no file for a lane with none, and leaves a file it cannot read as it found it, answering 0', () => {
    const home = box('ccrc-credential-sweep-none-');
    expect(sweep(home, 'lane-s').code).toBe(0);
    expect(laneState(home, 'lane-s')).toBeNull();
    mustLaneOp(home, ['--id', 'lane-b']);
    const path = laneStatePath(home, 'lane-b');
    writeFileSync(path, '[1,2]');
    expect(sweep(home, 'lane-b').code).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe('[1,2]');
    rmSync(path);
  }, 60_000);

  it('takes no other field', () => {
    const home = box('ccrc-credential-sweep-field-');
    expect(laneOp(home, ['--id', 'lane-s', '--mode', 'credential', '--file', rosterFile(home), '--last-run-at', 'now']).code).toBe(2);
    expect(laneOp(home, ['--id', 'lane-s', '--mode', 'credential']).code).toBe(2);
  }, 60_000);
});
