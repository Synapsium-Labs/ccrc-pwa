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
import v8 from 'node:v8';
import vm from 'node:vm';
import { ACCOUNT_SUBS } from '../../shared/api.js';
import { accountOpsFor, accountSpawnEnv, localAccountOps, remoteAccountOps, type AccountOpsMakers } from '../src/accounts/ops.js';
import { AgentOpError, LinkNotSentError, type FleetClient } from '../src/remote/client.js';
import { accountOpRequestTimeoutMs } from '../../shared/agent-protocol.js';
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

const NODE_ID = '0123abcd-4567-89ab-cdef-0123456789ab';
type FakeClient = Pick<FleetClient, 'request' | 'state'> & { request: ReturnType<typeof vi.fn> };
/** A client whose ready frame named `ops`, answering every request with `answer` (or throwing it). */
const ALL_OPS = ['update', 'token-sync', 'account'];
const fakeClient = (
  ops: string[] | undefined = ALL_OPS,
  answer: Record<string, unknown> | Error = { kind: 'exited', code: 0, stdout: '{"ok":true}\n', fleetIdentity: NODE_ID },
): FakeClient => ({
  state: { agentOps: ops } as unknown as FleetClient['state'],
  request: vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return { t: 'res' as const, id: 1, ok: true as const, ...answer };
  }),
});

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

  it('the remote arm answers unsupported, and sends nothing, to an agent whose ready frame does not name the op', async () => {
    for (const ops of [undefined, [], ['update', 'token-sync']]) {
      const client: FakeClient = { ...fakeClient(), state: { agentOps: ops } as FleetClient['state'] };
      expect(await remoteAccountOps({ client }).run('credential', 'lane-a', {}, Buffer.from('CANARY-remote')), String(ops))
        .toEqual({ kind: 'unsupported' });
      expect(client.request, 'a secret travelled to an agent that cannot spawn it').not.toHaveBeenCalled();
    }
  });
});

describe('the remote arm (A8: the agent\'s typed account op)', () => {
  it('sends ONE typed frame: the sub, the lane as laneId, the typed fields, the secret as stdinB64, under the sub\'s deadline', async () => {
    const client = fakeClient();
    const secret = Buffer.from(`CANARY-${process.pid}`);
    const ans = await remoteAccountOps({ client }).run('add', 'lane-a', { provider: 'anthropic', method: 'paste', label: 'Lane A' }, secret);
    expect(ans).toEqual({ kind: 'exited', code: 0, stdout: '{"ok":true}\n', fleetIdentity: NODE_ID });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request.mock.calls[0]).toEqual([
      { t: 'req', op: 'account', sub: 'add', laneId: 'lane-a', fields: { provider: 'anthropic', method: 'paste', label: 'Lane A' },
        stdinB64: secret.toString('base64') },
      accountOpRequestTimeoutMs('add'),
    ]);
    expect(accountOpRequestTimeoutMs('add')).toBeGreaterThan(180_000 + 5_000);
  });

  it('a sub with no stdin sends no stdinB64 field at all', async () => {
    const client = fakeClient();
    await remoteAccountOps({ client }).run('roster', null, {});
    expect(client.request.mock.calls[0]![0]).toEqual({ t: 'req', op: 'account', sub: 'roster', laneId: null, fields: {} });
  });

  it('refuses with the same builder before the wire: nothing is sent', async () => {
    const client = fakeClient();
    const ops = remoteAccountOps({ client });
    expect(await ops.run('enable', 'lane-a', { force: 'true' })).toEqual({ kind: 'refused', why: 'bad-field' });
    expect(await ops.run('check', '--force', {})).toEqual({ kind: 'refused', why: 'bad-id' });
    expect(await ops.run('auth-code', 'lane-a', { attemptId: 'f'.repeat(32) }, Buffer.from('a\nb'))).toEqual({ kind: 'refused', why: 'key-charset' });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("maps the agent's answers: each outcome, its refusal, and an answer off its grammar as lost", async () => {
    for (const [answer, want] of [
      [{ kind: 'timeout', fleetIdentity: NODE_ID }, { kind: 'timeout', fleetIdentity: NODE_ID }],
      [{ kind: 'too-large', fleetIdentity: null }, { kind: 'too-large', fleetIdentity: null }],
      [{ kind: 'not-started', fleetIdentity: null }, { kind: 'not-started', fleetIdentity: null }],
      [{ kind: 'refused', why: 'bad-field', fleetIdentity: NODE_ID }, { kind: 'refused', why: 'bad-field', fleetIdentity: NODE_ID }],
      [{ kind: 'refused', why: 'made-up', fleetIdentity: NODE_ID }, { kind: 'lost' }],
      [{ kind: 'exited', code: 0, stdout: '{}', fleetIdentity: 'NOT-A-NODE-ID' }, { kind: 'lost' }],
      [{ kind: 'exited', code: 0, stdout: '{}' }, { kind: 'lost' }],
      [{ kind: 'unsupported', fleetIdentity: null }, { kind: 'lost' }],
    ] as const) {
      expect(await remoteAccountOps({ client: fakeClient(ALL_OPS, { ...answer }) }).run('check', 'lane-a', {}), JSON.stringify(answer))
        .toEqual(want);
    }
  });

  it('keeps nothing of the frame alive across the wait: only the client could hold it, and it does not (D-5513, D-5623)', async () => {
    // A client that keeps only a WeakRef to the frame it is handed and answers when told. With the arm's own scope
    // the one other place the frame could live, a collector run while the answer is outstanding decides.
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    let ref: WeakRef<object> | undefined;
    let answer!: () => void;
    const client: Pick<FleetClient, 'request' | 'state'> = {
      state: { agentOps: ALL_OPS } as unknown as FleetClient['state'],
      request: (frame) => {
        ref = new WeakRef(frame);
        return new Promise((resolve) => {
          answer = () => resolve({ t: 'res', id: 1, ok: true, kind: 'not-started', fleetIdentity: null });
        });
      },
    };
    const pending = remoteAccountOps({ client }).run('credential', 'lane-a', {}, Buffer.from(`CANARY-${process.pid}`));
    expect(ref, 'the frame went to the client').toBeDefined();
    for (let i = 0; i < 5 && ref!.deref() !== undefined; i++) {
      await new Promise((r) => setImmediate(r));
      gc();
    }
    expect(ref!.deref(), 'the arm keeps the frame alive across its await').toBeUndefined();
    answer();
    expect(await pending).toEqual({ kind: 'not-started', fleetIdentity: null });
  });

  it("an older agent's bad-request is unsupported; a frame that never left is not-started; a loss after the send is lost", async () => {
    const run = (e: Error) => remoteAccountOps({ client: fakeClient(ALL_OPS, e) }).run('check', 'lane-a', {});
    expect(await run(new AgentOpError('bad-request', null))).toEqual({ kind: 'unsupported' });
    expect(await run(new LinkNotSentError('disconnected'))).toEqual({ kind: 'not-started' });
    expect(await run(new Error('timeout'))).toEqual({ kind: 'lost' });
    expect(await run(new Error('disconnected'))).toEqual({ kind: 'lost' });
    expect(await run(new AgentOpError('some thrown sentence', null))).toEqual({ kind: 'lost' });
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

  it('refuses before any spawn with the one builder (A8): a bad id, a sub outside the union, a field off its bounds', async () => {
    const { home, rec } = fixtureHome();
    const ops = localAccountOps({ home });
    expect(await ops.run('check', '../lane-a', {})).toEqual({ kind: 'refused', why: 'bad-id' });
    expect(await ops.run('check', '--force', {})).toEqual({ kind: 'refused', why: 'bad-id' });
    expect(await ops.run('check', 'lane-a\n--force', {})).toEqual({ kind: 'refused', why: 'bad-id' });
    // @ts-expect-error the sub union is closed
    expect(await ops.run('or-management-install', null, {})).toEqual({ kind: 'refused', why: 'bad-sub' });
    expect(await ops.run('set', 'lane-a', { label: 'Lane A' })).toEqual({ kind: 'refused', why: 'bad-field' });
    expect(await ops.run('enable', 'lane-a', { force: 'true' })).toEqual({ kind: 'refused', why: 'bad-field' });
    expect(await ops.run('credential', 'lane-a', {}, Buffer.from('a\u0000b'))).toEqual({ kind: 'refused', why: 'key-charset' });
    expect(existsSync(path.join(rec, 'argv0'))).toBe(false);
    expect(ACCOUNT_SUBS).not.toContain('or-management-install');
  });

  it('builds typed fields into one argv word each, from the same builder as the agent (A8)', async () => {
    const { home, rec } = fixtureHome();
    expect(await localAccountOps({ home }).run('set', 'lane-a', { placement: 'full', stated: 'Max plan, work' }))
      .toMatchObject({ kind: 'exited', code: 0 });
    expect(readFileSync(path.join(rec, 'argv'), 'utf8')).toBe('account\nset\n--id=lane-a\n--stated=Max plan, work\n--placement=full\n');
  });

  it('a sub past its bound gets TERM, then KILL after the grace, and answers timeout', async () => {
    // The bound is 2 s, far past a loaded shell's start-up, and `ready` says the trap is in place, so a TERM that
    // beats the trap is named as load rather than read as a SIGKILL-first port (D-5623).
    const { home, rec } = fixtureHome([
      'trap \'echo term >> "$rec/signals"\' TERM',
      'touch "$rec/ready"',
      'while :; do sleep 0.05; done',
    ].join('\n'));
    const ops = localAccountOps({ home, timeoutMs: () => 2_000, killGraceMs: 400 });
    const t0 = Date.now();
    expect(await ops.run('check', 'lane-a', {})).toEqual({ kind: 'timeout' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2_300);
    expect(existsSync(path.join(rec, 'ready')), 'the stub had not installed its trap when the bound ran out (load)').toBe(true);
    expect(readFileSync(path.join(rec, 'signals'), 'utf8')).toContain('term');
  }, 20_000);

  it('a group member that ignores TERM after closing its stdio still gets KILL after the grace (D-5621)', async () => {
    // The leader exits on TERM; its backgrounded child traps TERM, closes its stdio and keeps running. The `close`
    // that the leader's exit raises must not cancel the group's KILL.
    const { home, rec } = fixtureHome([
      'export rec',
      '/bin/sh -c \'trap "" TERM; echo $$ > "$rec/grandchild.tmp"; mv "$rec/grandchild.tmp" "$rec/grandchild"; while :; do sleep 0.05; done\' </dev/null >/dev/null 2>&1 &',
      'while [ ! -s "$rec/grandchild" ]; do sleep 0.02; done',
      'while :; do sleep 0.05; done',
    ].join('\n'));
    const ops = localAccountOps({ home, timeoutMs: () => 2_000, killGraceMs: 300 });
    expect(await ops.run('check', 'lane-a', {})).toEqual({ kind: 'timeout' });
    expect(existsSync(path.join(rec, 'grandchild')), 'the member had not started when the bound ran out (load)').toBe(true);
    const pid = Number(readFileSync(path.join(rec, 'grandchild'), 'utf8').trim());
    expect(pid).toBeGreaterThan(1);
    const alive = (): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const until = Date.now() + 3000;
    while (alive() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    const survived = alive();
    if (survived) process.kill(pid, 'SIGKILL');
    expect(survived).toBe(false);
  }, 20_000);

  it('a home the launcher path refuses answers not-started on the call, and never throws when the arm is built (D-5621)', async () => {
    for (const home of ['/fixture/home/', '', 'relative/home']) {
      let ops: ReturnType<typeof localAccountOps> | undefined;
      expect(() => { ops = localAccountOps({ home }); }, home).not.toThrow();
      expect(await ops!.run('roster', null, {}), home).toEqual({ kind: 'not-started' });
    }
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
