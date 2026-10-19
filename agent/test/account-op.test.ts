// Accounts plan Task A8 (spec §13.2, D-5513): the agent's typed `account` op, answered by a REAL agent over a real
// loopback WS against a fixture HOME whose `.local/bin/ccrc` is a stub that records its argv, stdin, environment and
// signals. No case touches a real `~/.local/bin/ccrc` or the live `$HOME`: the process's PATH and HOME are contained
// for every case, and restored after.
//
// What is pinned:
//  - The stub sees the ABSOLUTE launcher, the built argv and the stdin bytes; the secret is on no argv.
//  - A sub past its bound gets SIGTERM, then SIGKILL 5 s later, and the answer says `timeout`.
//  - The agent's own stdout and stderr never carry the canary from `stdinB64`, in either spelling.
//  - The child's environment holds no `CCRC_*` variable at all (`CCRC_AGENT_TOKEN`, `CCRC_HETZNER_TOKEN`,
//    `CCRC_VAPID_PRIVATE` or any other): exactly {HOME, PATH, LANG}.
//  - Output past 8 MiB is cut and answered as a refusal (`too-large`).
//  - The sub union has no install, replace or ceiling-raise member, and no `seed`.
//  - A refusal spawns nothing and still carries `fleetIdentity`; the ready frame names the op; the op reaches no
//    exec path (a SOURCE scan).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunningAgent } from '../src/server.js';
import { ACCOUNT_SUB_ARGV, accountSpawnBounds, makeAccountOpSpawn } from '../src/accountop.js';
import { tokenSyncEnv } from '../src/tokensync.js';
import { ACCOUNT_OP_KILL_GRACE_MS, ACCOUNT_OP_OUTPUT_MAX_BYTES, ACCOUNT_SUBS } from '../../shared/api.js';
import type { AgentReady } from '../../shared/agent-protocol.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_TS = path.resolve(here, '..', 'src', 'server.ts');
const ACCOUNTOP_TS = path.resolve(here, '..', 'src', 'accountop.ts');

interface Res {
  t: 'res'; id: number; ok: boolean; err?: string; kind?: string; why?: string; code?: number; stdout?: string;
  fleetIdentity?: string | null;
}

/** A fixed non-secret canary, assembled at run time (no secret-shaped literal in a tracked file). */
const CANARY = ['CANARY', 'a8', String(process.pid)].join('-');
const CANARY_B64 = Buffer.from(CANARY).toString('base64');
const NODE_ID = '0123abcd-4567-89ab-cdef-0123456789ab';
const ATTEMPT = '0123456789abcdef'.repeat(2);

const PLANTED = {
  CCRC_AGENT_TOKEN: ['planted', 'agent', 'bearer'].join('-'),
  CCRC_HETZNER_TOKEN: ['planted', 'cloud', 'token'].join('-'),
  CCRC_VAPID_PRIVATE: ['planted', 'vapid', 'key'].join('-'),
  CCRC_SOMETHING_ELSE: 'planted-other',
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

describe('the account op', () => {
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

  /** A fixture HOME, the process's PATH and HOME contained to it, the planted names in the agent's environment. */
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
  function plantNodeId(home: string, text = `${NODE_ID}\n`): void {
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'node-id'), text);
  }
  /** The recording stub: argv one per line ($0 first), stdin to EOF, its environ, then one JSON document. */
  const RECORDER = (h: string): string => [
    `printf '%s\\n' "$0" "$@" > '${h}/argv'`,
    `cat > '${h}/stdin'`,
    `/usr/bin/env > '${h}/env'`,
    `echo '{"ok":true}'`,
  ].join('\n');
  async function up(): Promise<TestClient> {
    agent = await boot(fixture!);   // NO spawnAccount: startAgent's default port is the thing under test
    const c = new TestClient(agent.port);
    clients.push(c);
    await c.hello();
    return c;
  }

  it('the stub sees the absolute path, the built argv and the stdin bytes; the secret is on no argv', async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    plantNodeId(h);
    const c = await up();
    const res = await c.req<Res>(1, {
      op: 'account', sub: 'add', laneId: 'lane-a',
      fields: { provider: 'anthropic', method: 'paste', label: 'Lane A', hue: 'cyan' }, stdinB64: CANARY_B64,
    });
    expect(res).toEqual({ t: 'res', id: 1, ok: true, kind: 'exited', code: 0, stdout: '{"ok":true}\n', fleetIdentity: NODE_ID });
    expect(readFileSync(path.join(h, 'argv'), 'utf8')).toBe([
      path.join(h, '.local', 'bin', 'ccrc'),
      'account', 'add', '--id=lane-a', '--provider=anthropic', '--method=paste', '--label=Lane A', '--hue=cyan', '',
    ].join('\n'));
    expect(readFileSync(path.join(h, 'argv'), 'utf8'), 'the secret reached argv').not.toContain(CANARY);
    expect(readFileSync(path.join(h, 'stdin'), 'utf8')).toBe(CANARY);
  });

  it('a sub with no stdin gets an empty stdin, then EOF', async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    const c = await up();
    const res = await c.req<Res>(1, { op: 'account', sub: 'check', laneId: 'lane-a', fields: {} });
    expect(res).toMatchObject({ ok: true, kind: 'exited', code: 0, fleetIdentity: null });
    expect(readFileSync(path.join(h, 'stdin'), 'utf8')).toBe('');
  });

  it('a sub past its timeout gets TERM, then KILL 5 s later, and the answer says timeout', async () => {
    const h = contained();
    // Traps TERM and keeps running, so only the SIGKILL ends it: the trap's record proves TERM came first.
    const file = plantLauncher(h, [
      `touch '${h}/temp'`,
      `trap "echo TERM >> '${h}/sig'; rm -f '${h}/temp'" TERM`,
      'while :; do sleep 0.05; done',
    ].join('\n'));
    const spawn = makeAccountOpSpawn(tokenSyncEnv(h));
    const t0 = Date.now();
    const r = await spawn(file, ['account', 'check', '--id=lane-a'], null, { ...accountSpawnBounds('check'), timeoutMs: 300 });
    const took = Date.now() - t0;
    expect(r).toEqual({ kind: 'timeout' });
    expect(existsSync(path.join(h, 'sig')), 'no SIGTERM before the SIGKILL: the trap never ran').toBe(true);
    expect(readFileSync(path.join(h, 'sig'), 'utf8')).toBe('TERM\n');
    expect(existsSync(path.join(h, 'temp')), 'the trap did not remove its temp').toBe(false);
    expect(took, 'SIGKILL came before the grace').toBeGreaterThanOrEqual(300 + ACCOUNT_OP_KILL_GRACE_MS - 100);
    expect(took).toBeLessThan(300 + ACCOUNT_OP_KILL_GRACE_MS + 2_500);
  }, 15_000);

  it('each sub carries its own bound: check 90 s, add 180 s, the rest 120 s, 5 s grace, 8 MiB cap', () => {
    expect(accountSpawnBounds('check')).toEqual({ timeoutMs: 90_000, killGraceMs: 5_000, maxOutputBytes: 8 * 1024 * 1024 });
    expect(accountSpawnBounds('add').timeoutMs).toBe(180_000);
    for (const sub of ACCOUNT_SUBS.filter((s) => s !== 'check' && s !== 'add')) expect(accountSpawnBounds(sub).timeoutMs, sub).toBe(120_000);
  });

  it("the agent's stdout and stderr never contain the canary from stdinB64", async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    const seen: string[] = [];
    const tap = (chunk: unknown): boolean => { seen.push(String(chunk)); return true; };
    vi.spyOn(process.stdout, 'write').mockImplementation(tap as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(tap as never);
    // vitest routes `console.*` around the two streams, so the console is tapped as well.
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { seen.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); });
    }
    const c = await up();
    expect(await c.req<Res>(1, { op: 'account', sub: 'auth-code', laneId: 'lane-a', fields: { attemptId: ATTEMPT }, stdinB64: CANARY_B64 }))
      .toMatchObject({ ok: true, kind: 'exited' });
    expect(await c.req<Res>(2, { op: 'account', sub: 'check', laneId: 'lane-a', fields: {}, stdinB64: CANARY_B64 }))
      .toMatchObject({ ok: true, kind: 'refused', why: 'bad-field' });
    expect(await c.req<Res>(3, { op: 'account', sub: 'credential', laneId: 'lane-a', fields: { bogus: CANARY }, stdinB64: CANARY_B64 }))
      .toMatchObject({ ok: true, kind: 'refused', why: 'bad-field' });
    vi.restoreAllMocks();
    const all = seen.join('');
    // The control: the op IS logged, by op, sub and id — so a silent agent cannot pass this case by saying nothing.
    expect(all).toMatch(/account auth-code lane-a/);
    expect(all, 'the canary reached the agent log').not.toContain(CANARY);
    expect(all, 'the canary reached the agent log as base64').not.toContain(CANARY_B64);
  });

  it('the stub ccrc records its environ; it holds no CCRC_AGENT_TOKEN, CCRC_HETZNER_TOKEN, CCRC_VAPID_PRIVATE or any other CCRC_* variable', async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    const c = await up();
    expect(await c.req<Res>(1, { op: 'account', sub: 'roster', laneId: null, fields: {} })).toMatchObject({ ok: true, kind: 'exited', code: 0 });
    const env = readFileSync(path.join(h, 'env'), 'utf8');
    // Asserted on names and booleans, never on the environ's text: a failure must not print an environment.
    const names = env.split('\n').filter((l) => l.includes('=')).map((l) => l.slice(0, l.indexOf('=')));
    expect(names.filter((n) => n.startsWith('CCRC_')), 'a CCRC_ variable reached the child').toEqual([]);
    for (const [k, v] of Object.entries(PLANTED)) expect(env.includes(v), `${k}'s planted value reached the child`).toBe(false);
    // The shell may add its own bookkeeping names (PWD, OLDPWD, SHLVL, _); nothing else of the agent's.
    expect(names.filter((n) => !['PWD', 'OLDPWD', 'SHLVL', '_'].includes(n)).sort()).toEqual(['HOME', 'LANG', 'PATH']);
    expect(env.includes(`HOME=${h}\n`), 'HOME is the fixture home').toBe(true);
  });

  it('output past 8 MiB is cut and answered as a refusal', async () => {
    const h = contained();
    plantLauncher(h, `head -c ${ACCOUNT_OP_OUTPUT_MAX_BYTES + 4096} /dev/zero | tr '\\000' a`);
    const c = await up();
    c.send({ t: 'req', id: 2, op: 'account', sub: 'roster', laneId: null, fields: {} });
    expect(await c.waitFor<Res>((m) => (m as Res).id === 2, 15_000))
      .toEqual({ t: 'res', id: 2, ok: true, kind: 'too-large', fleetIdentity: null });
    // Exactly at the cap is still an answer.
    plantLauncher(h, `head -c ${ACCOUNT_OP_OUTPUT_MAX_BYTES} /dev/zero | tr '\\000' a`);
    const at = await c.req<Res>(3, { op: 'account', sub: 'roster', laneId: null, fields: {} });
    expect(at.kind).toBe('exited');
    expect(at.stdout?.length).toBe(ACCOUNT_OP_OUTPUT_MAX_BYTES);
  }, 30_000);

  it('the sub union has no install, replace or ceiling-raise member', () => {
    for (const sub of ACCOUNT_SUBS) {
      expect(sub, 'a sub that installs, replaces, raises or seeds').not.toMatch(/install|replace|raise|seed|force/);
      const spec = ACCOUNT_SUB_ARGV[sub];
      expect(spec, `${sub} has no argv row`).toBeDefined();
      expect(spec.cli.join(' '), `${sub}'s CLI spelling`).not.toMatch(/install|replace|seed/);
      for (const f of Object.values(spec.fields)) expect(f.flag, `${sub}'s ${f.flag}`).not.toMatch(/force|replace|install|raise/);
      // The one sub that writes the ceiling can only lower it.
      if (spec.cli.includes('ceiling')) expect(spec.fixed, sub).toEqual(['--lower-only']);
    }
    expect([...ACCOUNT_SUBS].sort()).toEqual([
      'add', 'auth-cancel', 'auth-code', 'auth-start', 'check', 'credential', 'disable', 'enable', 'or-management-lower',
      'or-management-remove', 'remove', 'roster', 'set',
    ]);
  });

  it('a refusal spawns nothing, is never bad-request, and still carries fleetIdentity', async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    plantNodeId(h);
    const c = await up();
    const frames: Array<[Record<string, unknown>, string]> = [
      [{ sub: 'seed', laneId: 'lane-a', fields: {} }, 'bad-sub'],
      [{ sub: 'enable', laneId: 'lane-a', fields: { force: 'true' } }, 'bad-field'],
      [{ sub: 'enable', laneId: '--force', fields: {} }, 'bad-id'],
      [{ sub: 'add', laneId: 'lane-a', fields: { provider: 'anthropic', label: 'x'.repeat(65) } }, 'bad-field'],
      [{ sub: 'auth-code', laneId: 'lane-a', fields: { attemptId: ATTEMPT }, stdinB64: Buffer.from('a\nb').toString('base64') }, 'key-charset'],
      [{ sub: 'auth-code', laneId: 'lane-a', fields: { attemptId: ATTEMPT }, stdinB64: 'not base64!' }, 'key-charset'],
      [{ sub: 'auth-code', laneId: 'lane-a', fields: { attemptId: ATTEMPT }, stdinB64: Buffer.alloc(8193, 0x41).toString('base64') }, 'key-charset'],
      [{ laneId: 'lane-a', fields: {} }, 'bad-sub'],
      [{ sub: 'check', laneId: 7, fields: {} }, 'bad-id'],
      [{ sub: 'check', laneId: 'lane-a', fields: 'x' }, 'bad-field'],
      [{ sub: 'check', laneId: 'lane-a', fields: {}, stdinB64: 7 }, 'key-charset'],
    ];
    for (const [i, [frame, why]] of frames.entries()) {
      expect(await c.req<Res>(i + 1, { op: 'account', ...frame }), JSON.stringify(frame))
        .toEqual({ t: 'res', id: i + 1, ok: true, kind: 'refused', why, fleetIdentity: NODE_ID });
    }
    expect(existsSync(path.join(h, 'argv')), 'a refused frame reached the spawn').toBe(false);
  });

  it('a node-id off its grammar is fleetIdentity null, never the text', async () => {
    const h = contained();
    plantLauncher(h, RECORDER(h));
    plantNodeId(h, `${NODE_ID.toUpperCase()}\n`);
    const c = await up();
    expect(await c.req<Res>(1, { op: 'account', sub: 'roster', laneId: null, fields: {} })).toMatchObject({ fleetIdentity: null });
  });

  it('a launcher that is not there is not-started', async () => {
    contained();
    const c = await up();
    expect(await c.req<Res>(1, { op: 'account', sub: 'roster', laneId: null, fields: {} }))
      .toEqual({ t: 'res', id: 1, ok: true, kind: 'not-started', fleetIdentity: null });
  });

  it("the ready frame names the op ('account', after 'update' and 'token-sync')", async () => {
    contained();
    agent = await boot(fixture!);
    const c = new TestClient(agent.port);
    clients.push(c);
    expect((await c.hello() as AgentReady).ops).toEqual(['update', 'token-sync', 'account']);
  });

  it("the op reaches no exec path: case 'account' and the port name no exec-surface symbol, and spawn the absolute launcher", () => {
    const src = readFileSync(SERVER_TS, 'utf8');
    const port = readFileSync(ACCOUNTOP_TS, 'utf8');
    const handle = slice(src, 'async function handleReq(', /\n}\n/);
    const body = slice(handle, "case 'account': {", CASE_END);
    expect(body).not.toMatch(EXEC_PATH);
    expect(body).toMatch(/updateLauncherPath\(ctx\.cfg\.home\)/);
    expect(body).toMatch(/\bctx\.spawnAccount\(/);
    expect(port).not.toMatch(EXEC_PATH);
    expect(port, 'the port reads the agent environment itself').not.toMatch(/env:\s*process\.env|\.\.\.process\.env/);
    expect(port).toMatch(/detached: true/);
  });
});
