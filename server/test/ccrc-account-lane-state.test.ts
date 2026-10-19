// The lane-state file (accounts plan Task A11; spec §3.4, G16; D-5517, D-5518, D-5755): `~/.cc-sessions/.accounts/
// <id>.json`, 0600 in a 0700 directory, written by every `ccrc account` verb and by `ccd-account-health` through one
// writer (`deploy/account-op.mjs`'s `lane-state`), read-merge-write, never holding a secret. A12 is the first screen
// that reads it. The fixture is `laneStateFixture.ts`.
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCOUNT_OP, CANARY, HAVE_FLOCK, HEALTH_SRC, NODE_ID, addLane, answer, boxEnv, ccrcRun, laneBox, laneState,
  laneStateDir, laneStatePath, modeOf, plantProbe, writeLaneState,
} from './laneStateFixture.js';
import { NODE_ID_RE } from '../../shared/agent-protocol.js';
import { readRegistryMeasured } from '../src/registry.js';
import { testDeps } from './helpers.js';
import { makeCcdHarness } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

/** The two facts every write must leave: the file is 0600 in a 0700 directory, and no byte of the canary is in it. */
function expectPrivateAndClean(home: string, id: string, secret = CANARY): void {
  expect(modeOf(laneStateDir(home)), 'the lane-state directory').toBe('700');
  expect(modeOf(laneStatePath(home, id)), 'the lane-state file').toBe('600');
  expect(readFileSync(laneStatePath(home, id), 'utf8').includes(secret), 'a secret byte in the lane state').toBe(false);
}

/** `ccd-account-health` against the box, with a `curl` that answers 401 for every lane. */
function health401(home: string): ReturnType<typeof spawnSync> {
  // The env FIRST: building it re-plants the curl poison, and this case's curl must stand in its place.
  const env = { ...boxEnv(home), CCRC_HEALTH_URL: 'https://fixture.invalid/api/oauth/usage' };
  writeFileSync(join(home, '.local', 'bin', 'curl'),
    '#!/bin/sh\ncat >/dev/null\nprintf \'%s\\n%s\' \'{"type":"error"}\' 401\nexit 0\n', { mode: 0o755 });
  return spawnSync(BASH_OF(), [HEALTH_SRC], { encoding: 'utf8', env });
}
const BASH_OF = (): string => spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

/** lane-b's OAuth token file, which `ccd-account-health` reads; a fixed non-secret value. */
function plantToken(home: string): void {
  mkdirSync(join(home, '.cc-secrets'), { recursive: true });
  writeFileSync(join(home, '.cc-secrets', 'lane-b-oauth.env'), `export CLAUDE_CODE_OAUTH_TOKEN=${CANARY}-b\n`,
    { mode: 0o600 });
}

describe('every verb writes the lane-state file (G16)', () => {
  it('every verb writes the file 0600 in a 0700 directory, and it holds no secret byte', () => {
    const home = laneBox('ccrc-lane-state-every-');
    const add = addLane(home, 'lane-c');
    expect(add.code, add.stderr).toBe(0);
    expectPrivateAndClean(home, 'lane-c');
    expect(laneState(home, 'lane-c')).toEqual({ fleetIdentity: NODE_ID });

    const second = `${CANARY}-rotated`;
    const cred = ccrcRun(home, ['account', 'credential', '--id', 'lane-c', '--credential', '-'], `${second}\n`);
    expect(cred.code, cred.stderr).toBe(0);
    expectPrivateAndClean(home, 'lane-c');
    expectPrivateAndClean(home, 'lane-c', second);

    for (const verb of ['disable', 'enable']) {
      const r = ccrcRun(home, ['account', verb, '--id', 'lane-c']);
      expect(r.code, `${verb}: ${r.stderr}`).toBe(0);
      expectPrivateAndClean(home, 'lane-c');
    }

    plantProbe(home, 'lane-c');
    const check = ccrcRun(home, ['account', 'check', '--id', 'lane-c']);
    expect(check.code, check.stderr).toBe(0);
    expectPrivateAndClean(home, 'lane-c');
    const s = laneState(home, 'lane-c')!;
    expect((s['check'] as { verdict: string }).verdict).toBe('ok');
    expect((s['check'] as { at: string }).at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(s['fleetIdentity']).toBe(NODE_ID);
  });

  it('remove takes the file with the lane, and reports it', () => {
    const home = laneBox('ccrc-lane-state-remove-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    const p = laneStatePath(home, 'lane-c');
    const r = ccrcRun(home, ['account', 'remove', '--id', 'lane-c']);
    expect(r.code, r.stderr).toBe(0);
    expect(laneState(home, 'lane-c')).toBeNull();
    expect(answer(r)['removed']).toContain(p);
  });

  it('a stale file under a re-used id is replaced by add, never merged into', () => {
    const home = laneBox('ccrc-lane-state-fresh-');
    mkdirSync(laneStateDir(home), { recursive: true, mode: 0o700 });
    writeFileSync(laneStatePath(home, 'lane-c'), JSON.stringify({ identity: 'someone@example.invalid', keyHash: 'h1' }));
    expect(addLane(home, 'lane-c').code).toBe(0);
    expect(laneState(home, 'lane-c')).toEqual({ fleetIdentity: NODE_ID });
  });

  it('a directory that exists wider than 0700 is tightened', () => {
    const home = laneBox('ccrc-lane-state-tighten-');
    mkdirSync(laneStateDir(home), { recursive: true, mode: 0o755 });
    expect(addLane(home, 'lane-c').code).toBe(0);
    expect(modeOf(laneStateDir(home))).toBe('700');
  });
});

describe('ccd-account-health writes the lane state (G16)', () => {
  it('`ccd-account-health` writes `check` on a 401', () => {
    const home = laneBox('ccrc-lane-state-health-');
    plantToken(home);
    const r = health401(home);
    expect(r.status, String(r.stderr)).toBe(0);
    const s = laneState(home, 'lane-b')!;
    expect((s['check'] as { verdict: string }).verdict).toBe('auth-dead');
    expect(s['fleetIdentity']).toBe(NODE_ID);
    expectPrivateAndClean(home, 'lane-b', `${CANARY}-b`);
  });
});

describe('the writer keeps what it was not asked to set (spec §3.4)', () => {
  it('`keyHash` is in the lane state and not in accounts.json', () => {
    const home = laneBox('ccrc-lane-state-keyhash-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    const w = writeLaneState(home, ['--id', 'lane-c', '--key-hash', 'kh0a11', '--retired-key-hash', 'kh0a10']);
    expect(w.code, w.stderr).toBe(0);
    for (const verb of ['disable', 'enable']) expect(ccrcRun(home, ['account', verb, '--id', 'lane-c']).code).toBe(0);
    const roster = ccrcRun(home, ['account', 'roster']);
    expect(roster.code, roster.stderr).toBe(0);
    expect(roster.stdout).not.toContain('kh0a11');
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).not.toContain('kh0a1');
    expect(laneState(home, 'lane-c')).toMatchObject({ keyHash: 'kh0a11', retiredKeyHash: 'kh0a10' });
  });

  it('after `ccd-account-health` and `check` rewrite a minted lane\'s state, `keyHash` and `retiredKeyHash` are unchanged', () => {
    const home = laneBox('ccrc-lane-state-merge-');
    plantToken(home);
    expect(writeLaneState(home, ['--id', 'lane-b', '--key-hash', 'kh0b11', '--retired-key-hash', 'kh0b10']).code).toBe(0);

    plantProbe(home, 'lane-b');
    const check = ccrcRun(home, ['account', 'check', '--id', 'lane-b']);
    expect(check.code, check.stderr).toBe(0);
    expect(laneState(home, 'lane-b')).toMatchObject({ keyHash: 'kh0b11', retiredKeyHash: 'kh0b10', check: { verdict: 'ok' } });

    expect(health401(home).status).toBe(0);
    expect(laneState(home, 'lane-b')).toMatchObject({
      keyHash: 'kh0b11', retiredKeyHash: 'kh0b10', check: { verdict: 'auth-dead' }, fleetIdentity: NODE_ID,
    });
  });

  it('a file that is not a JSON object is refused, never overwritten', () => {
    const home = laneBox('ccrc-lane-state-corrupt-');
    mkdirSync(laneStateDir(home), { recursive: true, mode: 0o700 });
    writeFileSync(laneStatePath(home, 'lane-b'), 'not json');
    const w = writeLaneState(home, ['--id', 'lane-b', '--check-verdict', 'ok', '--check-at', '2026-10-19T00:00:00Z']);
    expect(w.code).toBe(1);
    expect(answer(w)['error']).toBe('lane-state-unreadable');
    expect(readFileSync(laneStatePath(home, 'lane-b'), 'utf8')).toBe('not json');
  });
});

describe('fleetIdentity (spec §13.3; D-5518)', () => {
  it('`roster --json` carries the node\'s fleetIdentity, and null when the node-id is not known', () => {
    const home = laneBox('ccrc-lane-state-fid-');
    expect(answer(ccrcRun(home, ['account', 'roster']))['fleetIdentity']).toBe(NODE_ID);
    writeFileSync(join(home, '.ccrc', 'node-id'), 'not-a-uuid\n');
    expect(answer(ccrcRun(home, ['account', 'roster']))['fleetIdentity']).toBeNull();
  });

  it('the verb reads the node-id through the same grammar the agent does', () => {
    const src = readFileSync(ACCOUNT_OP, 'utf8');
    const m = /^const NODE_ID_LINE_RE = \/(.*)\/;$/m.exec(src);
    expect(m, 'deploy/account-op.mjs has no NODE_ID_LINE_RE').toBeTruthy();
    expect(m![1]).toBe(NODE_ID_RE.source);
  });
});

describe('no existing reader of ~/.cc-sessions descends into a dot-directory (spec §3.4)', () => {
  it('no existing reader of `~/.cc-sessions` descends into a dot-directory', async () => {
    // A session-shaped name INSIDE `.accounts/` is the plant: a reader that descended would list it.
    const plant = (reg: string): void => {
      mkdirSync(join(reg, '.accounts'), { recursive: true, mode: 0o700 });
      writeFileSync(join(reg, '.accounts', 'x.json'), '{"fleetIdentity":null}\n');
      writeFileSync(join(reg, '.accounts', 'lane-z-demo.uuid'), '00000000-0000-4000-8000-000000000000\n');
      writeFileSync(join(reg, '.accounts', 'lane-z-demo.wrapper'), 'claude\n');
      writeFileSync(join(reg, '.accounts', 'lane-z-demo.workdir'), '/nonexistent\n');
    };

    // The server's registry listing.
    const deps = testDeps(mkTmp('ccrc-lane-state-server-reg-'));
    const cfg = deps.cfg;
    mkdirSync(cfg.registryDir, { recursive: true });
    const ids = async (): Promise<string[]> => {
      const r = await readRegistryMeasured(deps.io, cfg);
      return r.listed ? r.records.map((x) => x.id) : ['<unlisted>'];
    };
    const before = await ids();
    plant(cfg.registryDir);
    expect(await ids()).toEqual(before);

    // ccd's registry listing.
    const h = makeCcdHarness('ccrc-lane-state-ccd-reg-');
    const ls = (): string => h.sh('cmd_ls');
    const ccdBefore = ls();
    plant(join(h.home, '.cc-sessions'));
    expect(ls()).toBe(ccdBefore);
    expect(readdirSync(join(h.home, '.cc-sessions', '.accounts'))).toContain('lane-z-demo.uuid');
  });
});
