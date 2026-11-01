// `ccrc account enable` refuses `not-ready` (accounts plan Task A13; spec §10, G19; D-5518, D-7731) unless the lane
// state records a credential, a seed verified strictly after the last run, and a last check of `ok`. `--force` is the
// CLI's alone: the agent's argv builder has no field that becomes it. The fixture is `laneStateFixture.ts`.
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASH, HAVE_FLOCK, answer, boxEnv, ccrcIn, ccrcRun, laneBox, writeLaneState,
} from './laneStateFixture.js';
import { ACCOUNT_SUB_ARGV, buildAccountArgv } from '../../shared/account-argv.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

/** One sign-in lane (no secrets file) and one token lane, beside the upstream lane. */
const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'team·max', configDirSuffix: '.claude', exec: { kind: 'upstream' },
      homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-a', label: 'lane·a', configDirSuffix: '.claude-lane-a', exec: { kind: 'generated' },
      homeAble: true, hue: 'green', telemetry: 'anthropic' },
    { id: 'lane-b', label: 'lane·b', configDirSuffix: '.claude-lane-b',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/lane-b-oauth.env' },
      homeAble: true, hue: 'violet', telemetry: 'anthropic' },
  ],
};

const RUN = '2026-11-01T12:00:00.000Z';
const AFTER = '2026-11-01T12:00:00.001Z';
const BEFORE = '2026-11-01T11:59:59.999Z';

/** A box whose two lanes are switched off, and whose token lane holds a credential file. */
function offBox(prefix: string): string {
  const home = laneBox(prefix, ROSTER);
  for (const id of ['lane-a', 'lane-b']) writeFileSync(join(home, '.cc-sessions', `${id}-disabled`), '');
  mkdirSync(join(home, '.cc-secrets'), { recursive: true });
  writeFileSync(join(home, '.cc-secrets', 'lane-b-oauth.env'), 'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-token\n',
    { mode: 0o600 });
  return home;
}

/** The lane state, written fresh through the one writer. */
function state(home: string, id: string, args: string[]): void {
  const w = writeLaneState(home, ['--id', id, '--mode', 'fresh', ...args]);
  expect(w.code, `${w.stdout}${w.stderr}`).toBe(0);
}
const okCheck = ['--check-verdict', 'ok', '--check-at', '2026-11-01T12:00:00Z'];
const signedIn = ['--identity', 'someone@example.invalid', '--identity-source', 'measured'];

/** `enable` refused not-ready for `reason`, and the lane is still switched off. */
function expectNotReady(home: string, id: string, reason: string): Record<string, unknown> {
  const r = ccrcRun(home, ['account', 'enable', '--id', id]);
  expect(r.code, r.stderr).toBe(1);
  const a = answer(r);
  expect(a).toMatchObject({ ok: false, error: 'not-ready', reason });
  expect(existsSync(join(home, '.cc-sessions', `${id}-disabled`)), `${id} is still off`).toBe(true);
  return a;
}

function expectEnabled(home: string, id: string, extra: string[] = []): void {
  const r = ccrcRun(home, ['account', 'enable', '--id', id, ...extra]);
  expect(r.code, `${r.stdout}${r.stderr}`).toBe(0);
  expect(answer(r)).toMatchObject({ ok: true, disabled: false });
  expect(existsSync(join(home, '.cc-sessions', `${id}-disabled`)), `${id} is on`).toBe(false);
}

describe('enable needs a ready lane (G19)', () => {
  it('enable refuses `not-ready` with no credential, with no seed, with a seed older than the last run, and with a failing last check', () => {
    const home = offBox('ccrc-enable-ready-');

    // No credential: a token lane whose credential file is gone, and a sign-in lane no check has read signed in.
    rmSync(join(home, '.cc-secrets', 'lane-b-oauth.env'));
    state(home, 'lane-b', [...okCheck, '--last-run-at', RUN, '--seed-verified-at', AFTER]);
    expectNotReady(home, 'lane-b', 'no-credential');
    state(home, 'lane-a', [...okCheck, '--last-run-at', RUN, '--seed-verified-at', AFTER]);
    expectNotReady(home, 'lane-a', 'no-credential');

    // No seed.
    state(home, 'lane-a', [...okCheck, ...signedIn, '--last-run-at', RUN]);
    expectNotReady(home, 'lane-a', 'seed-unverified');

    // A seed older than the last run, and one in the same instant as it, which is not after it either.
    state(home, 'lane-a', [...okCheck, ...signedIn, '--last-run-at', RUN, '--seed-verified-at', BEFORE]);
    expectNotReady(home, 'lane-a', 'seed-unverified');
    state(home, 'lane-a', [...okCheck, ...signedIn, '--last-run-at', RUN, '--seed-verified-at', RUN]);
    expectNotReady(home, 'lane-a', 'seed-unverified');

    // A failing last check.
    state(home, 'lane-a', ['--check-verdict', 'auth-dead', '--check-at', '2026-11-01T12:00:00Z', ...signedIn,
      '--last-run-at', RUN, '--seed-verified-at', AFTER]);
    const failed = expectNotReady(home, 'lane-a', 'check-failed');
    expect(String(failed['detail'])).toContain('didn\'t pass (auth-dead). Check it first');

    // All three: each lane turns on.
    state(home, 'lane-a', [...okCheck, ...signedIn, '--last-run-at', RUN, '--seed-verified-at', AFTER]);
    expectEnabled(home, 'lane-a');
    writeFileSync(join(home, '.cc-secrets', 'lane-b-oauth.env'), 'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-token\n',
      { mode: 0o600 });
    expectEnabled(home, 'lane-b');
  });

  it('a backfilled legacy lane reads "Check it once to turn it on" and enables after one passing check', () => {
    const home = offBox('ccrc-enable-ready-legacy-');
    // The backfill `ccrc install` and `ccrc update` run (`_inst_lane_state`), sourced, as its own suite drives it.
    const b = spawnSync(BASH, ['-c', 'umask 022; . "$1"; INST_ROLE=both; _inst_lane_state', '_', ccrcIn(home)],
      { env: boxEnv(home), encoding: 'utf8' });
    expect(b.status, b.stderr).toBe(0);
    const refused = expectNotReady(home, 'lane-b', 'not-checked');
    expect(String(refused['detail'])).toContain('Check it once to turn it on');

    mkdirSync(join(home, '.claude-lane-b'), { recursive: true });
    writeFileSync(join(home, '.local', 'bin', 'lane-b'), [
      '#!/bin/sh',
      'if [ "$1" = auth ]; then echo \'{"loggedIn":true,"authMethod":"oauth_token"}\'; exit 0; fi',
      'echo \'{"type":"result","subtype":"success","is_error":false,"result":"ok","total_cost_usd":0}\'',
      'exit 0',
    ].join('\n') + '\n', { mode: 0o755 });
    const check = ccrcRun(home, ['account', 'check', '--id', 'lane-b']);
    expect(check.code, check.stderr).toBe(0);
    expectEnabled(home, 'lane-b');
  });

  it('a lane with no lane-state file at all is not ready, for the same reason in other words', () => {
    const home = offBox('ccrc-enable-ready-nofile-');
    const a = expectNotReady(home, 'lane-b', 'no-lane-state');
    expect(String(a['detail'])).toContain('Check it once to turn it on');
  });

  it('`--force` enables, and no agent sub can send it', () => {
    const home = offBox('ccrc-enable-ready-force-');
    expectNotReady(home, 'lane-a', 'no-lane-state');
    expectEnabled(home, 'lane-a', ['--force']);

    // The argv builder (accounts plan Task A8) is the only way an agent op or a route reaches the verb.
    expect(Object.keys(ACCOUNT_SUB_ARGV.enable.fields)).toEqual([]);
    for (const fields of [{ force: 'true' }, { force: true }, { '--force': 'true' }]) {
      expect(buildAccountArgv('enable', 'lane-a', fields, false)).toEqual({ ok: false, why: 'bad-field' });
    }
    expect(buildAccountArgv('enable', '--force', {}, false)).toEqual({ ok: false, why: 'bad-id' });
    const built = buildAccountArgv('enable', 'lane-a', {}, false);
    expect(built).toEqual({ ok: true, argv: ['account', 'enable', '--id=lane-a'] });
  });
});
