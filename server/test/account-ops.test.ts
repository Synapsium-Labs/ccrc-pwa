/**
 * The `AccountOps` port (spec §13.2, G13; plan Task A7): which arm runs `ccrc account <sub>`, and what the local
 * arm's child is given.
 *
 *  - The arm is chosen by `cfg.fleetMode` ONLY. In remote mode the local spawner is never constructed: the
 *    controller holds only its own roster mirror, and `ccrc account add` run there would make a lane on the wrong box.
 *  - The local arm spawns `$HOME/.local/bin/ccrc` by absolute path, with the secret on stdin and on no argv, and
 *    the child's WHOLE environment is `{HOME, PATH, LANG}` (`tokenSyncEnv`'s precedent): the server unit's own
 *    environment carries `CCRC_AGENT_TOKEN`, `CCRC_VAPID_PRIVATE` and `CCRC_HETZNER_TOKEN`.
 *
 * Every spawn is a stub `ccrc` inside a fixture HOME; nothing here runs a real verb.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ACCOUNT_SUBS } from '../../shared/api.js';
import { accountOpsFor, accountSpawnEnv, localAccountOps, remoteAccountOps, type AccountOpsMakers } from '../src/accounts/ops.js';
import type { FleetClient } from '../src/remote/client.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const SECRET_VARS = ['CCRC_AGENT_TOKEN', 'CCRC_HETZNER_TOKEN', 'CCRC_VAPID_PRIVATE'] as const;

/** A fixture HOME whose `ccrc` records its argv[0], its argv, its stdin and its environment, then answers. */
const fixtureHome = (body = 'printf \'{"ok":true}\\n\''): { home: string; rec: string } => {
  const home = mkTmp('ccrc-account-ops-');
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  const rec = path.join(home, 'rec');
  mkdirSync(rec, { recursive: true });
  writeFileSync(path.join(bin, 'ccrc'), [
    '#!/bin/bash',
    `rec=${JSON.stringify(rec)}`,
    'printf \'%s\' "$0" > "$rec/argv0"',
    'printf \'%s\\n\' "$@" > "$rec/argv"',
    '/usr/bin/env > "$rec/environ"',
    'cat > "$rec/stdin"',
    body,
    '',
  ].join('\n'));
  chmodSync(path.join(bin, 'ccrc'), 0o755);
  return { home, rec };
};

const fakeClient = (): Pick<FleetClient, 'request'> => ({ request: vi.fn(async () => ({ t: 'res' as const, id: 1, ok: true as const })) });

describe('the AccountOps arm (G13)', () => {
  it('remote mode constructs the agent arm and never the local spawner', () => {
    const home = mkTmp('ccrc-account-ops-arm-');
    // The whole config, loopback host included: the arm must not be read from anything but `fleetMode`.
    const cfg = { ...testDeps(home).cfg, fleetMode: 'remote' as const, host: '127.0.0.1' };
    const makers: AccountOpsMakers = { local: vi.fn(localAccountOps), remote: vi.fn(remoteAccountOps) };
    const ops = accountOpsFor(cfg, { client: fakeClient() }, makers);
    expect(ops.arm).toBe('remote');
    expect(makers.remote).toHaveBeenCalledTimes(1);
    expect(makers.local).not.toHaveBeenCalled();
  });

  it('local mode constructs the local spawner and never the agent arm', () => {
    const home = mkTmp('ccrc-account-ops-arm-');
    for (const host of ['127.0.0.1', '0.0.0.0', '203.0.113.7']) {
      const cfg = { ...testDeps(home).cfg, fleetMode: 'local' as const, host };
      const makers: AccountOpsMakers = { local: vi.fn(localAccountOps), remote: vi.fn(remoteAccountOps) };
      const ops = accountOpsFor(cfg, { client: null }, makers);
      expect(ops.arm, host).toBe('local');
      expect(makers.local).toHaveBeenCalledTimes(1);
      expect(makers.remote).not.toHaveBeenCalled();
    }
  });

  it('remote mode with no agent connection is a composition error, never a fall back to the local spawner', () => {
    const home = mkTmp('ccrc-account-ops-arm-');
    const cfg = { ...testDeps(home).cfg, fleetMode: 'remote' as const };
    const makers: AccountOpsMakers = { local: vi.fn(localAccountOps), remote: vi.fn(remoteAccountOps) };
    expect(() => accountOpsFor(cfg, { client: null }, makers)).toThrow(/remote/);
    expect(makers.local).not.toHaveBeenCalled();
  });

  it('the remote arm answers unsupported until the agent carries the account op, and sends nothing', async () => {
    const client = fakeClient();
    const ops = remoteAccountOps({ client });
    expect(await ops.run('check', 'lane-a', {})).toEqual({ kind: 'unsupported' });
    expect(client.request).not.toHaveBeenCalled();
  });
});

describe('the local arm (D-5513: the account spawn\'s environment is explicit)', () => {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const v of [...SECRET_VARS, 'CCRC_ROLE']) { saved.set(v, process.env[v]); process.env[v] = `planted-${v}-value`; }
  });
  afterEach(() => {
    for (const [v, was] of saved) { if (was === undefined) delete process.env[v]; else process.env[v] = was; }
    saved.clear();
  });

  it('local mode spawns the absolute ccrc path with the secret only on stdin', async () => {
    const { home, rec } = fixtureHome();
    const secret = Buffer.from(`CANARY-${process.pid} ${'sk-'}${'ant-oat01-'}${'y'.repeat(40)}`);
    const ops = localAccountOps({ home });
    const ans = await ops.run('credential', 'lane-a', {}, secret);
    expect(ans).toEqual({ kind: 'exited', code: 0, stdout: '{"ok":true}\n' });
    expect(readFileSync(path.join(rec, 'argv0'), 'utf8')).toBe(path.join(home, '.local', 'bin', 'ccrc'));
    const argv = readFileSync(path.join(rec, 'argv'), 'utf8');
    expect(argv).toBe('account\ncredential\n--id=lane-a\n');
    expect(argv).not.toContain('CANARY-');
    expect(readFileSync(path.join(rec, 'stdin'))).toEqual(secret);
    expect(readFileSync(path.join(rec, 'environ'), 'utf8')).not.toContain('CANARY-');
  });

  it("the stub ccrc's environ holds no CCRC_AGENT_TOKEN, CCRC_HETZNER_TOKEN, CCRC_VAPID_PRIVATE or any other CCRC_* variable", async () => {
    for (const v of SECRET_VARS) expect(process.env[v]).toBe(`planted-${v}-value`);
    const { home, rec } = fixtureHome();
    const ans = await localAccountOps({ home }).run('roster', null, {});
    expect(ans).toMatchObject({ kind: 'exited', code: 0 });
    expect(readFileSync(path.join(rec, 'argv'), 'utf8')).toBe('account\nroster\n');
    const environ = readFileSync(path.join(rec, 'environ'), 'utf8');
    expect(environ).not.toMatch(/^CCRC_/m);
    expect(environ).not.toContain('planted-');
    const names = environ.split('\n').filter((l) => l !== '').map((l) => l.slice(0, l.indexOf('='))).filter((n) => n !== '_' && n !== 'PWD' && n !== 'SHLVL').sort();
    expect(names).toEqual(['HOME', 'LANG', 'PATH']);
    expect(environ).toContain(`HOME=${home}\n`);
    expect(readFileSync(path.join(rec, 'stdin'), 'utf8')).toBe('');
  });

  it('the environment is built from the home and two names only', () => {
    expect(accountSpawnEnv('/fixture/home', { PATH: '/a:/b', LANG: 'en_GB.UTF-8', CCRC_AGENT_TOKEN: 'x', HOME: '/elsewhere' }))
      .toEqual({ HOME: '/fixture/home', PATH: '/a:/b', LANG: 'en_GB.UTF-8' });
    expect(accountSpawnEnv('/fixture/home', {})).toEqual({ HOME: '/fixture/home', PATH: '/usr/bin:/bin', LANG: 'C' });
  });

  it('refuses before any spawn: a bad id, a sub outside the union, or fields before the argv builder exists', async () => {
    const { home, rec } = fixtureHome();
    const ops = localAccountOps({ home });
    expect(await ops.run('check', '../lane-a', {})).toEqual({ kind: 'refused', why: 'bad-id' });
    expect(await ops.run('check', '--force', {})).toEqual({ kind: 'refused', why: 'bad-id' });
    expect(await ops.run('check', 'lane-a\n--force', {})).toEqual({ kind: 'refused', why: 'bad-id' });
    // @ts-expect-error the sub union is closed
    expect(await ops.run('or-management-install', null, {})).toEqual({ kind: 'refused', why: 'bad-sub' });
    expect(await ops.run('set', 'lane-a', { label: 'Lane A' })).toEqual({ kind: 'refused', why: 'fields-unbuilt' });
    expect(existsSync(path.join(rec, 'argv0'))).toBe(false);
    expect(ACCOUNT_SUBS).not.toContain('or-management-install');
  });

  it('a sub past its bound gets TERM, then KILL after the grace, and answers timeout', async () => {
    const { home, rec } = fixtureHome([
      'trap \'echo term >> "$rec/signals"\' TERM',
      'while :; do sleep 0.05; done',
    ].join('\n'));
    const ops = localAccountOps({ home, timeoutMs: () => 400, killGraceMs: 400 });
    const t0 = Date.now();
    expect(await ops.run('check', 'lane-a', {})).toEqual({ kind: 'timeout' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(700);
    expect(readFileSync(path.join(rec, 'signals'), 'utf8')).toContain('term');
  });

  it('a launcher that is not there answers not-started', async () => {
    const home = mkTmp('ccrc-account-ops-none-');
    expect(await localAccountOps({ home }).run('roster', null, {})).toEqual({ kind: 'not-started' });
  });

  it('output past the cap is cut and answered too-large', async () => {
    const { home } = fixtureHome('head -c 4096 /dev/zero');
    expect(await localAccountOps({ home, maxOutputBytes: 1024 }).run('roster', null, {})).toEqual({ kind: 'too-large' });
  });
});
