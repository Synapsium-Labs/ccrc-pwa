// Test box connect plan TC11 (spec §2.1, §2.11, D-8166): the agent's typed `testbox-admin` op, the FIFTH wire-triggered
// spawn, answered by a REAL agent over a real loopback WS against a fixture HOME whose `.local/bin/ccrc` is a stub that
// records its argv, stdin, environment and signals. No case touches a real `~/.local/bin/ccrc` or the live `$HOME`: the
// process's PATH and HOME are contained for every case, and restored after.
//
// What is pinned:
//  - The stub sees the ABSOLUTE launcher and the builder's argv plus the template's own `--from agent`; nothing else.
//  - An unknown sub or a field off the grammar answers the builder's refusal (`ok: true`, `kind: 'refused'`, never
//    `bad-request`) and spawns nothing, and the answer still carries `fleetIdentity`.
//  - The child's environment is exactly {HOME, PATH, LANG}: no `CCRC_*` variable of the agent's reaches it.
//  - The child gets no stdin (empty, then EOF); no frame field can supply one.
//  - Output past 1 MiB is cut and answered `too-large`.
//  - A call past its bound gets SIGTERM to the group, then SIGKILL 5 s later; a short sub 60 s, a long one 30 s.
//  - The ready frame names the op; the log line names the sub only; the op reaches no exec path (a SOURCE scan).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunningAgent } from '../src/server.js';
import { makeTestboxAdminSpawn, testboxAdminSpawnBounds } from '../src/testboxAdminOp.js';
import { tokenSyncEnv } from '../src/tokensync.js';
import {
  TESTBOX_ADMIN_KILL_GRACE_MS, TESTBOX_ADMIN_OP, TESTBOX_ADMIN_OUTPUT_MAX_BYTES, readTestboxAdminOpAnswer, type AgentReady,
} from '../../shared/agent-protocol.js';
import { TESTBOX_ADMIN_SUBS, type TestboxAdminSub } from '../../shared/testbox-admin.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_TS = path.resolve(here, '..', 'src', 'server.ts');
const OP_TS = path.resolve(here, '..', 'src', 'testboxAdminOp.ts');

interface Res {
  t: 'res'; id: number; ok: boolean; err?: string; kind?: string; why?: string; code?: number; stdout?: string;
  fleetIdentity?: string | null;
}

const NODE_ID = '0123abcd-4567-89ab-cdef-0123456789ab';
const FINGERPRINT = `SHA256:${'A'.repeat(43)}`;

const PLANTED = {
  CCRC_AGENT_TOKEN: ['planted', 'agent', 'bearer'].join('-'),
  CCRC_HETZNER_TOKEN: ['planted', 'cloud', 'token'].join('-'),
  CCRC_TESTBOX_TOKEN_FILE: ['planted', 'token', 'file'].join('-'),
} as const;
const SAVED_KEYS = ['PATH', 'HOME', ...Object.keys(PLANTED)] as const;

const slice = (src: string, open: string, close: RegExp): string => {
  const at = src.indexOf(open);
  expect(at, `${open} not found`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(at + open.length);
  const end = close.exec(rest);
  expect(end, `no end after ${open}`).not.toBeNull();
  return rest.slice(0, end!.index);
};
const EXEC_PATH = /\b(?:isExecAllowed|runExec|resolveSpawnCmd|checkPath)\s*\(|\bEXEC_WHITELIST\b/;
const CASE_END = /\n    (?:case '|default:)/;

describe('the testbox-admin op', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  const clients: TestClient[] = [];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of SAVED_KEYS) saved[k] = process.env[k];
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const c of clients.splice(0)) c.ws.close();
    if (agent) await agent.close();
    agent = undefined;
    for (const k of SAVED_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  function contained(): string {
    fixture = makeFixture();
    process.env.PATH = '/usr/bin:/bin';
    process.env.HOME = fixture.home;
    Object.assign(process.env, PLANTED);
    return fixture.home;
  }
  function plantLauncher(home: string, body: string): string {
    const bin = path.join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    const file = path.join(bin, 'ccrc');
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
    return file;
  }
  function plantNodeId(home: string): void {
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'node-id'), `${NODE_ID}\n`);
  }
  /** The recording stub: argv one per line ($0 first), stdin to EOF, its environ, then one JSON document. */
  const RECORDER = (h: string): string => [
    `printf '%s\\n' "$0" "$@" > '${h}/argv'`,
    `cat > '${h}/stdin'`,
    `/usr/bin/env > '${h}/env'`,
    `echo '{"v":1}'`,
  ].join('\n');
  async function up(): Promise<TestClient> {
    agent = await boot(fixture!);   // NO spawnTestboxAdmin: startAgent's default port is the thing under test
    const c = new TestClient(agent.port);
    clients.push(c);
    await c.hello();
    return c;
  }

  it("the op spawns only the absolute launcher with the builder's argv", async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    plantNodeId(h);
    const c = await up();
    const res = await c.req<Res>(1, { op: TESTBOX_ADMIN_OP, sub: 'pin', fields: { fingerprint: FINGERPRINT } });
    expect(res).toEqual({ t: 'res', id: 1, ok: true, kind: 'exited', code: 0, stdout: '{"v":1}\n', fleetIdentity: NODE_ID });
    expect(readFileSync(path.join(h, 'argv'), 'utf8')).toBe([
      path.join(h, '.local', 'bin', 'ccrc'), 'testbox-admin', 'pin', `--fingerprint=${FINGERPRINT}`, '--from', 'agent', '',
    ].join('\n'));
    const status = await c.req<Res>(2, { op: TESTBOX_ADMIN_OP, sub: 'status', fields: {} });
    expect(status).toMatchObject({ ok: true, kind: 'exited', code: 0 });
    expect(readFileSync(path.join(h, 'argv'), 'utf8')).toBe(
      [path.join(h, '.local', 'bin', 'ccrc'), 'testbox-admin', 'status', '--from', 'agent', ''].join('\n'));
    expect(readTestboxAdminOpAnswer(status)).toMatchObject({ kind: 'exited' });
  });

  it('Reset to default rides the settings subs as one --unset=KEY word a key, and an unset the contract refuses spawns nothing (D-8336)', async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    plantNodeId(h);
    const c = await up();
    const res = await c.req<Res>(1, { op: TESTBOX_ADMIN_OP, sub: 'settings-fleet', fields: { unset: ['CCRC_TESTBOX_POLL', 'CCRC_TESTBOX_BUDGET'] } });
    expect(res).toMatchObject({ ok: true, kind: 'exited', code: 0 });
    expect(readFileSync(path.join(h, 'argv'), 'utf8')).toBe([
      path.join(h, '.local', 'bin', 'ccrc'), 'testbox-admin', 'settings-fleet', '--unset=CCRC_TESTBOX_BUDGET', '--unset=CCRC_TESTBOX_POLL',
      '--from', 'agent', '',
    ].join('\n'));
    rmSync(path.join(h, 'argv'));
    const frames: Record<string, unknown>[] = [
      { sub: 'settings-box', fields: { unset: ['CCRC_TESTBOX_LISTEN'] } },
      { sub: 'settings-box', fields: { unset: ['--from=cli'] } },
      { sub: 'settings-box', fields: { unset: [] } },
      { sub: 'settings-fleet', fields: { unset: ['CCRC_TESTBOX_URL'] } },
      { sub: 'connect', fields: { unset: ['CCRC_TESTBOX_RUNS'] } },
    ];
    for (const [i, frame] of frames.entries()) {
      expect(await c.req<Res>(i + 2, { op: TESTBOX_ADMIN_OP, ...frame }), JSON.stringify(frame))
        .toEqual({ t: 'res', id: i + 2, ok: true, kind: 'refused', why: 'bad-field', fleetIdentity: NODE_ID });
    }
    expect(existsSync(path.join(h, 'argv')), 'a refused frame reached the spawn').toBe(false);
  });

  it("an unknown sub or field answers the builder's refusal and spawns nothing", async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    plantNodeId(h);
    const c = await up();
    const frames: Array<[Record<string, unknown>, string]> = [
      [{ sub: 'exec', fields: {} }, 'bad-sub'],
      [{ fields: {} }, 'bad-sub'],
      [{ sub: 'status', fields: { force: 'true' } }, 'bad-field'],
      [{ sub: 'status', fields: { from: 'pwa' } }, 'bad-field'],
      [{ sub: 'pin', fields: {} }, 'bad-field'],
      [{ sub: 'pin', fields: { fingerprint: '--x' } }, 'bad-field'],
      [{ sub: 'key', fields: { address: '-oProxyCommand=x' } }, 'bad-field'],
      [{ sub: 'status', fields: 'x' }, 'bad-field'],
      [{ sub: 'status' }, 'bad-field'],
    ];
    for (const [i, [frame, why]] of frames.entries()) {
      expect(await c.req<Res>(i + 1, { op: TESTBOX_ADMIN_OP, ...frame }), JSON.stringify(frame))
        .toEqual({ t: 'res', id: i + 1, ok: true, kind: 'refused', why, fleetIdentity: NODE_ID });
    }
    expect(existsSync(path.join(h, 'argv')), 'a refused frame reached the spawn').toBe(false);
    // A key beyond the frame's five is a malformed frame, the word an agent that predates the op answers too.
    const extra = await c.req<Res>(50, { op: TESTBOX_ADMIN_OP, sub: 'status', fields: {}, stdinB64: 'QQ==' });
    expect(extra).toEqual({ t: 'res', id: 50, ok: false, err: 'bad-request' });
    expect(existsSync(path.join(h, 'argv'))).toBe(false);
  });

  it('the child\'s environment is HOME, PATH and LANG only', async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    const c = await up();
    expect(await c.req<Res>(1, { op: TESTBOX_ADMIN_OP, sub: 'status', fields: {} })).toMatchObject({ ok: true, kind: 'exited', code: 0 });
    const env = readFileSync(path.join(h, 'env'), 'utf8');
    // Asserted on names and booleans, never on the environ's text: a failure must not print an environment.
    const names = env.split('\n').filter((l) => l.includes('=')).map((l) => l.slice(0, l.indexOf('=')));
    expect(names.filter((n) => n.startsWith('CCRC_')), 'a CCRC_ variable reached the child').toEqual([]);
    for (const [k, v] of Object.entries(PLANTED)) expect(env.includes(v), `${k}'s planted value reached the child`).toBe(false);
    expect(names.filter((n) => !['PWD', 'OLDPWD', 'SHLVL', '_'].includes(n)).sort()).toEqual(['HOME', 'LANG', 'PATH']);
    expect(env.includes(`HOME=${h}\n`), 'HOME is the fixture home').toBe(true);
  });

  it('the child gets no stdin', async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    const c = await up();
    expect(await c.req<Res>(1, { op: TESTBOX_ADMIN_OP, sub: 'probe', fields: {} })).toMatchObject({ ok: true, kind: 'exited' });
    expect(readFileSync(path.join(h, 'stdin'), 'utf8')).toBe('');
  });

  it('stdout over the cap answers too-large', async () => {
    const h = contained();
    plantLauncher(h, `head -c ${TESTBOX_ADMIN_OUTPUT_MAX_BYTES + 4096} /dev/zero | tr '\\000' a`);
    const c = await up();
    c.send({ t: 'req', id: 2, op: TESTBOX_ADMIN_OP, sub: 'read', fields: {} });
    expect(await c.waitFor<Res>((m) => (m as Res).id === 2, 15_000))
      .toEqual({ t: 'res', id: 2, ok: true, kind: 'too-large', fleetIdentity: null });
    plantLauncher(h, `head -c ${TESTBOX_ADMIN_OUTPUT_MAX_BYTES} /dev/zero | tr '\\000' a`);
    const at = await c.req<Res>(3, { op: TESTBOX_ADMIN_OP, sub: 'read', fields: {} });
    expect(at.kind).toBe('exited');
    expect(at.stdout?.length).toBe(TESTBOX_ADMIN_OUTPUT_MAX_BYTES);
  }, 30_000);

  it('the bound sends TERM then KILL to the group', async () => {
    const h = contained();
    const file = plantLauncher(h, [
      `trap "echo TERM >> '${h}/sig'; rm -f '${h}/temp'" TERM`,
      `touch '${h}/temp' '${h}/ready'`,
      'while :; do sleep 0.05; done',
    ].join('\n'));
    const BOUND = 2_000;
    const spawn = makeTestboxAdminSpawn(tokenSyncEnv(h));
    const t0 = Date.now();
    const r = await spawn(file, ['testbox-admin', 'probe', '--from', 'agent'], { ...testboxAdminSpawnBounds('probe', {}), timeoutMs: BOUND });
    const took = Date.now() - t0;
    expect(r).toEqual({ kind: 'timeout' });
    expect(existsSync(path.join(h, 'ready')), 'the stub had not installed its trap when the bound ran out (load)').toBe(true);
    expect(readFileSync(path.join(h, 'sig'), 'utf8')).toBe('TERM\n');
    expect(existsSync(path.join(h, 'temp')), 'the trap did not remove its temp').toBe(false);
    expect(took, 'SIGKILL came before the grace').toBeGreaterThanOrEqual(BOUND + TESTBOX_ADMIN_KILL_GRACE_MS - 100);
    expect(took).toBeLessThan(BOUND + TESTBOX_ADMIN_KILL_GRACE_MS + 2_500);
  }, 20_000);

  it('a short sub is bound at 60 s and a long sub\'s detach at 30 s, with a 5 s grace and a 1 MiB cap', () => {
    expect(testboxAdminSpawnBounds('status', {})).toEqual({ timeoutMs: 60_000, killGraceMs: 5_000, maxOutputBytes: 1024 * 1024 });
    for (const sub of Object.keys(TESTBOX_ADMIN_SUBS) as TestboxAdminSub[]) {
      const long = TESTBOX_ADMIN_SUBS[sub].long;
      expect(testboxAdminSpawnBounds(sub, {}).timeoutMs, sub).toBe(long ? 30_000 : 60_000);
    }
    // settings-box always detaches (its apply outruns a short sub's bound); --when-idle only chooses wait or refuse
    expect(testboxAdminSpawnBounds('settings-box', { whenIdle: true }).timeoutMs).toBe(30_000);
    expect(testboxAdminSpawnBounds('settings-box', {}).timeoutMs).toBe(30_000);
  });

  it('ready.ops offers testbox-admin', async () => {
    contained();
    agent = await boot(fixture!);
    const c = new TestClient(agent.port);
    clients.push(c);
    expect((await c.hello() as AgentReady).ops).toContain('testbox-admin');
  });

  it('the log line names the sub only', async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    const seen: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { seen.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); });
    }
    const c = await up();
    expect(await c.req<Res>(1, { op: TESTBOX_ADMIN_OP, sub: 'pin', fields: { fingerprint: FINGERPRINT } })).toMatchObject({ ok: true });
    expect(await c.req<Res>(2, { op: TESTBOX_ADMIN_OP, sub: 'pin', fields: { fingerprint: 'nope' } })).toMatchObject({ kind: 'refused' });
    vi.restoreAllMocks();
    const all = seen.join('\n');
    expect(all).toMatch(/testbox-admin pin -> exited/);
    expect(all).toMatch(/testbox-admin refused -> bad-field/);
    expect(all, 'a field value reached the agent log').not.toContain(FINGERPRINT);
  });

  it('the source scan finds no exec path in testboxAdminOp.ts', () => {
    const src = readFileSync(SERVER_TS, 'utf8');
    const port = readFileSync(OP_TS, 'utf8');
    const handle = slice(src, 'async function handleReq(', /\n}\n/);
    const body = slice(handle, "case 'testbox-admin': {", CASE_END);
    expect(body).not.toMatch(EXEC_PATH);
    expect(body).toMatch(/updateLauncherPath\(ctx\.cfg\.home\)/);
    expect(body).toMatch(/\bctx\.spawnTestboxAdmin\(/);
    expect(port).not.toMatch(EXEC_PATH);
    expect(port, 'the port reads the agent environment itself').not.toMatch(/env:\s*process\.env|\.\.\.process\.env/);
    expect(port, 'the port spawns through the bounded kernel only').toMatch(/\bboundedStdinSpawn\(/);
    expect(port, 'the port hands the kernel no stdin').toMatch(/argv, null, \{/);
  });
});
