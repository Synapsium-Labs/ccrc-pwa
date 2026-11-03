// Paste validates first (accounts plan Task A16; spec §3.3, §6.3; D-5513, D-7735). An Anthropic token is checked
// for its bytes and then probed, with the candidate in the probe's environment, BEFORE anything is written: a 401
// writes nothing, an unreachable provider writes nothing, and `credential` (Replace token) keeps the old file until
// the new token passes. Every secret-writing answer carries the lane-secret fingerprints (D-5996), never the secret.
// The fixture is `laneStateFixture.ts`: every launcher is a stub, and nothing reaches a real `claude`.
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HAVE_FLOCK, answer, ccrcRun, laneBox, laneState, markReady, secretTemps,
} from './laneStateFixture.js';
import { fingerprintGeneration, fingerprintRow } from '../src/accounts/mask.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

/** Tokens the stub tells apart by their first word. None is real-shaped, and each is over 20 bytes. */
const GOOD = 'GOOD-a16-paste-not-a-real-token';
const GOOD_NEW = 'GOOD-a16-rotated-not-a-real-token';
const REFUSED = 'NOPE-a16-paste-not-a-real-token';
const DOWN = 'DOWN-a16-paste-not-a-real-token';
/** The box token the fingerprints are keyed with: a fixture value, never a real one. */
const BOX_TOKEN = 'box-token-a16-fixture-0123456789abcdef';

/**
 * The upstream launcher as a stub that answers by the token in its environment: `GOOD-` is one good turn, `DOWN-`
 * an unreachable provider, anything else a 401. It records the config directory it ran in, never the token.
 */
function plantUpstreamProbe(home: string): void {
  writeFileSync(join(home, '.local', 'bin', 'claude'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$CLAUDE_CONFIG_DIR" >> "$HOME/probe-dirs"',
    'case "$CLAUDE_CODE_OAUTH_TOKEN" in',
    '  GOOD-*) echo \'{"type":"result","subtype":"success","is_error":false,"result":"ok"}\'; exit 0 ;;',
    '  DOWN-*) echo \'{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error","api_error_status":null,"result":"API Error: Connection refused"}\'; exit 1 ;;',
    '  *) echo \'{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error","api_error_status":401,"result":"Invalid bearer token"}\'; exit 1 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
}

const addArgs = (id: string): string[] => ['account', 'add', '--id', id, '--provider', 'anthropic', '--method', 'paste',
  '--label', `${id}·p`, '--hue', 'amber', '--credential', '-'];

/** Everything a refused add must not have left: the key file, a temp, the roster entry, the config dir, the off
 *  marker, the lane state and the probe's own directory. */
function expectNothingWritten(home: string, id: string): void {
  expect(existsSync(join(home, '.cc-secrets', `${id}-oauth.env`)), 'the key file').toBe(false);
  expect(secretTemps(home, id), 'a secret temp').toEqual([]);
  const roster = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')) as { accounts: { id: string }[] };
  expect(roster.accounts.map((a) => a.id)).not.toContain(id);
  expect(existsSync(join(home, `.claude-${id}`)), 'the config dir').toBe(false);
  expect(existsSync(join(home, '.cc-sessions', `${id}-disabled`)), 'the off marker').toBe(false);
  expect(laneState(home, id), 'the lane state').toBeNull();
  const scratch = join(home, '.ccrc', 'auth-scratch');
  expect(existsSync(scratch) ? readdirSync(scratch) : [], 'the probe directory').toEqual([]);
}

describe('Anthropic paste validates first (spec §6.3)', () => {
  it('a refused token writes no file and leaves no temp', () => {
    const home = laneBox('ccrc-paste-refused-');
    plantUpstreamProbe(home);
    // A probe directory a SIGKILL left behind is swept, under the lane's lock.
    mkdirSync(join(home, '.ccrc', 'auth-scratch', '.lane-p-probe.Stale1'), { recursive: true });
    const r = ccrcRun(home, addArgs('lane-p'), `${REFUSED}\n`);
    expect(r.code, r.stderr).toBe(1);
    expect(answer(r)['error']).toBe('key-rejected');
    expect(r.stdout + r.stderr).not.toContain(REFUSED);
    expectNothingWritten(home, 'lane-p');
    // The probe ran once, in a directory of its own, never the lane's config dir.
    const dirs = readFileSync(join(home, 'probe-dirs'), 'utf8').trim().split('\n');
    expect(dirs).toHaveLength(1);
    expect(dirs[0]!.startsWith(join(home, '.ccrc', 'auth-scratch', '.lane-p-probe.'))).toBe(true);
  });

  it('an unreachable provider refuses `token-unverified` and writes nothing', () => {
    const home = laneBox('ccrc-paste-down-');
    plantUpstreamProbe(home);
    const r = ccrcRun(home, addArgs('lane-p'), `${DOWN}\n`);
    expect(r.code, r.stderr).toBe(1);
    expect(answer(r)['error']).toBe('token-unverified');
    expectNothingWritten(home, 'lane-p');
  });

  it('a hostile value (`"\\noutput = <tmp>/pwned`) refuses `key-charset` and creates no file', () => {
    const home = laneBox('ccrc-paste-hostile-');
    plantUpstreamProbe(home);
    const pwned = join(home, 'pwned');
    for (const hostile of [`"\noutput = ${pwned}`, `${GOOD}\u0000x`, `${GOOD}\r`, `${GOOD}\u007f`, 'x'.repeat(8193)]) {
      const r = ccrcRun(home, addArgs('lane-p'), hostile);
      expect(r.code, `${JSON.stringify(hostile.slice(0, 40))}: ${r.stderr}`).toBe(2);
      expect(answer(r)['error']).toBe('key-charset');
      expect(existsSync(pwned)).toBe(false);
      expectNothingWritten(home, 'lane-p');
    }
    expect(existsSync(join(home, 'probe-dirs')), 'the probe never ran').toBe(false);
  });

  it('a good token is saved, and the answer carries the fingerprint and no byte of the secret', () => {
    const home = laneBox('ccrc-paste-good-');
    plantUpstreamProbe(home);
    mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, '.cc-secrets', 'ccrc-mail.token'), `# the box token\n${BOX_TOKEN}\n`, { mode: 0o600 });
    const r = ccrcRun(home, addArgs('lane-p'), `${GOOD}\n`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(GOOD);
    expect(readFileSync(join(home, '.cc-secrets', 'lane-p-oauth.env'), 'utf8')).toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${GOOD}\n`);
    const a = answer(r);
    // The server's own half computes the same row: the two sides agree on the HMAC, the stripping and the length.
    expect(a['fingerprints']).toEqual({ gen: fingerprintGeneration(BOX_TOKEN), rows: [fingerprintRow(BOX_TOKEN, 'lane-p', GOOD)] });
    expect(a['fleetIdentity']).toBe(laneState(home, 'lane-p')!['fleetIdentity']);
    expect(typeof laneState(home, 'lane-p')!['addedAt']).toBe('string');

    // `roster` carries every lane's fingerprint too (D-6057 (9)).
    const roster = ccrcRun(home, ['account', 'roster']);
    expect(roster.code, roster.stderr).toBe(0);
    expect(answer(roster)['fingerprints']).toEqual({ gen: fingerprintGeneration(BOX_TOKEN), rows: [fingerprintRow(BOX_TOKEN, 'lane-p', GOOD)] });
  });

  it('a box with no token answers no fingerprints, rather than rows keyed with nothing', () => {
    const home = laneBox('ccrc-paste-notoken-');
    plantUpstreamProbe(home);
    const r = ccrcRun(home, addArgs('lane-p'), `${GOOD}\n`);
    expect(r.code, r.stderr).toBe(0);
    expect(answer(r)).not.toHaveProperty('fingerprints');
  });
});

describe('Replace token validates first (`credential`, spec §9)', () => {
  it('`credential` keeps the old file until the new token passes', () => {
    const home = laneBox('ccrc-paste-credential-');
    plantUpstreamProbe(home);
    mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, '.cc-secrets', 'ccrc-mail.token'), `${BOX_TOKEN}\n`, { mode: 0o600 });
    const file = join(home, '.cc-secrets', 'lane-b-oauth.env');
    writeFileSync(file, `export CLAUDE_CODE_OAUTH_TOKEN=${GOOD}\n`, { mode: 0o600 });
    markReady(home, 'lane-b');
    const before = readFileSync(file, 'utf8');

    for (const [token, code] of [[REFUSED, 'key-rejected'], [DOWN, 'token-unverified']] as const) {
      const r = ccrcRun(home, ['account', 'credential', '--id', 'lane-b', '--credential', '-'], `${token}\n`);
      expect(r.code, r.stderr).toBe(1);
      expect(answer(r)['error']).toBe(code);
      expect(readFileSync(file, 'utf8'), 'the old token stands').toBe(before);
      // Its check stands too: nothing measured the old token wrong.
      expect((laneState(home, 'lane-b')!['check'] as { verdict: string }).verdict).toBe('ok');
      expect(secretTemps(home, 'lane-b')).toEqual([]);
    }

    const ok = ccrcRun(home, ['account', 'credential', '--id', 'lane-b', '--credential', '-'], `${GOOD_NEW}\n`);
    expect(ok.code, ok.stderr).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${GOOD_NEW}\n`);
    expect(ok.stdout + ok.stderr).not.toContain(GOOD_NEW);
    const a = answer(ok);
    expect(a['fingerprints']).toEqual({ gen: fingerprintGeneration(BOX_TOKEN), rows: [fingerprintRow(BOX_TOKEN, 'lane-b', GOOD_NEW)] });
    expect(a).toHaveProperty('roster');
    expect(laneState(home, 'lane-b')).not.toHaveProperty('check');
  });
});
