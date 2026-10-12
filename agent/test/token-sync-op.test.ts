// Box-token lifecycle spec 2026-10-07 §4.4: the `token-sync` op, answered by a REAL agent over a real loopback WS
// against a fixture HOME (`update-op.test.ts`'s idiom). Every spawn is the injected `AgentOpts.spawnTokenSync`
// recorder, except the describe at the end, which runs the real port over a fixture launcher UNDER the fixture HOME
// with the process's PATH and HOME contained. No case touches a real `~/.local/bin/ccrc` or the live `$HOME`.
//
// What is pinned (spec §10 "The op's validation and spawn", "Transport field"):
//  - The code is gated in `validateReq` by `isClaimCode`, before any case body: a malformed code answers `bad-code`
//    and spawns nothing. Never `bad-request`, which from this op means "the agent predates it".
//  - The spawn is the absolute launcher with exactly the frozen template; the code reaches stdin, never argv.
//  - The child's environment is exactly {HOME, PATH, LANG}: no CCRC_AGENT_TOKEN, nothing else of the agent's.
//  - At the bound the group gets SIGTERM (the verb's trap runs) before SIGKILL.
//  - The child's answer maps to one closed word, by exit code AND first stderr line; success carries `transport`.
//  - One gate per agent PROCESS: a second op while one runs is `busy`, on any connection.
//  - The ready frame advertises ['update', 'token-sync'].
//  - The op reaches no exec path (a SOURCE scan: no behavioural case sees an extra call whose answer is the same).
import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunningAgent } from '../src/server.js';
import {
  makeTokenSyncSpawn, tokenSyncAnswer, tokenSyncEnv, type TokenSyncSpawn, type TokenSyncSpawnResult,
} from '../src/tokensync.js';
import { EXEC_COMMANDS, isExecAllowed } from '../src/whitelist.js';
import {
  TOKEN_SYNC_EXIT, TOKEN_SYNC_KILL_GRACE_MS, TOKEN_SYNC_SPAWN_TIMEOUT_MS, isTokenVerbMissing, tokenSyncSpawnArgv,
  updateLauncherPath, type AgentReady,
} from '../../shared/agent-protocol.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_TS = path.resolve(here, '..', 'src', 'server.ts');
const TOKENSYNC_TS = path.resolve(here, '..', 'src', 'tokensync.ts');

interface Res { t: 'res'; id: number; ok: boolean; err?: string; detail?: string; synced?: string; transport?: string }
interface SpawnCall { file: string; args: string[]; code: string; timeoutMs: number }

/** A 43-character base64url code, built at runtime (never a literal a scan could match). */
const CODE = `${'Ab0_-'.repeat(8)}xyz`;
const TEMPLATE = ['token', 'sync', '--from', 'agent'];
const SYNCED: TokenSyncSpawnResult = { code: 0, stdout: 'synced 0123456789abcdef https\n', stderr: '', killed: false, pid: 4242 };

/** A recording `spawnTokenSync`. After `park()`, every call waits until `release()`. */
function recorder(answer: TokenSyncSpawnResult = SYNCED) {
  const calls: SpawnCall[] = [];
  let gate: Promise<void> | null = null;
  let open: () => void = () => {};
  const spawn: TokenSyncSpawn = async (file, args, code, timeoutMs) => {
    calls.push({ file, args: [...args], code, timeoutMs });
    if (gate !== null) await gate;
    return answer;
  };
  return {
    calls,
    spawn,
    park(): void { gate = new Promise<void>((r) => { open = r; }); },
    release(): void { gate = null; open(); },
  };
}

/** The text between `open` and the first `close` match after it, from the real source. */
function slice(src: string, open: string, close: RegExp): string {
  const at = src.indexOf(open);
  expect(at, `${open} not found`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(at + open.length);
  const end = close.exec(rest);
  expect(end, `no end after ${open}`).not.toBeNull();
  return rest.slice(0, end!.index);
}
const EXEC_PATH = /\b(?:isExecAllowed|runExec|resolveSpawnCmd|checkPath)\s*\(|\bEXEC_WHITELIST\b/;
const CASE_END = /\n    (?:case '|default:)/;

describe('the token-sync op', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  const clients: TestClient[] = [];
  const open = async (port: number): Promise<TestClient> => {
    const c = new TestClient(port);
    clients.push(c);
    await c.hello();
    return c;
  };

  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  async function up(rec = recorder()): Promise<{ c: TestClient; rec: ReturnType<typeof recorder>; home: string }> {
    fixture = makeFixture();
    agent = await boot(fixture, { spawnTokenSync: rec.spawn });
    return { c: await open(agent.port), rec, home: fixture.home };
  }

  describe('validateReq gates the code before any case body runs', () => {
    it('a malformed code is bad-code, never bad-request, and spawns nothing', async () => {
      const { c, rec } = await up();
      const frames: Record<string, unknown>[] = [
        { op: 'token-sync', code: CODE.slice(1) }, { op: 'token-sync', code: `${CODE}x` },
        { op: 'token-sync', code: `${CODE.slice(1)}=` }, { op: 'token-sync', code: `${CODE.slice(1)}+` },
        { op: 'token-sync', code: `${CODE}\n` }, { op: 'token-sync', code: '; rm -rf ~' },
        { op: 'token-sync', code: 43 }, { op: 'token-sync', code: null }, { op: 'token-sync' },
        { op: 'token-sync', code: [CODE] },
      ];
      for (const [i, frame] of frames.entries()) {
        expect(await c.req<Res>(i + 1, frame), JSON.stringify(frame)).toEqual({ t: 'res', id: i + 1, ok: false, err: 'bad-code' });
      }
      // Asserted after every frame was answered: with the guard removed the recorder would hold the spawns.
      expect(rec.calls, 'a malformed code reached the spawn').toEqual([]);
    });

    it('no id is no reply (the envelope rule, unchanged) and the connection keeps serving', async () => {
      const { c, rec } = await up();
      c.send({ t: 'req', op: 'token-sync', code: CODE });
      expect(await c.req<Res>(2, { op: 'token-sync', code: CODE })).toMatchObject({ id: 2, ok: true });
      await expect(c.waitFor((m) => (m as Res).t === 'res' && (m as Res).id === undefined, 300)).rejects.toThrow('timed out');
      expect(rec.calls).toHaveLength(1);
    });
  });

  describe('the spawn — the absolute launcher, one frozen template, the code on stdin', () => {
    it('spawns <home>/.local/bin/ccrc with exactly the template, the code as stdin, at the 40 s bound', async () => {
      const { c, rec, home } = await up();
      const res = await c.req<Res>(1, { op: 'token-sync', code: CODE });
      expect(rec.calls).toEqual([{ file: updateLauncherPath(home), args: TEMPLATE, code: CODE, timeoutMs: TOKEN_SYNC_SPAWN_TIMEOUT_MS }]);
      expect(rec.calls[0]!.args.join(' '), 'the code reached argv').not.toContain(CODE);
      expect(res).toEqual({ t: 'res', id: 1, ok: true, synced: '0123456789abcdef', transport: 'https' });
      expect(JSON.stringify(res), 'the code came back in the result').not.toContain(CODE);
    });

    it('carries the transport the child used: http rotates too (R2), and the field is always sent', async () => {
      const { c } = await up(recorder({ ...SYNCED, stdout: 'synced fedcba9876543210 http\n' }));
      expect(await c.req<Res>(1, { op: 'token-sync', code: CODE }))
        .toEqual({ t: 'res', id: 1, ok: true, synced: 'fedcba9876543210', transport: 'http' });
    });
  });

  describe("the child's answer, mapped by exit code AND first stderr line", () => {
    const base = { stdout: '', killed: false, pid: 4242 };
    it('each verb word, at its own exit code with its own prefix, is that word with its line as detail', async () => {
      for (const [word, code] of Object.entries(TOKEN_SYNC_EXIT)) {
        const line = `ccrc: token sync: ${word}: a sentence`;
        expect(tokenSyncAnswer({ ...base, code, stderr: `${line}\nsecond\n` }), word).toEqual({ ok: false, err: word, detail: line });
      }
    });

    it('an exit code and a line that disagree, or a bare code, are spawn-failed carrying the line', () => {
      expect(tokenSyncAnswer({ ...base, code: TOKEN_SYNC_EXIT['claim-refused'], stderr: 'ccrc: token sync: code-used: x\n' }))
        .toEqual({ ok: false, err: 'spawn-failed', detail: 'ccrc: token sync: code-used: x' });
      expect(tokenSyncAnswer({ ...base, code: TOKEN_SYNC_EXIT['code-used'], stderr: 'Traceback (most recent call last):\n' }))
        .toEqual({ ok: false, err: 'spawn-failed', detail: 'Traceback (most recent call last):' });
      expect(tokenSyncAnswer({ ...base, code: 1, stderr: '' })).toEqual({ ok: false, err: 'spawn-failed', detail: 'no message' });
    });

    it("an older ccrc's usage line is spawn-failed, and the server reads it as verb-missing (D-4395)", () => {
      const a = tokenSyncAnswer({ ...base, code: 2, stderr: 'ccrc: unknown argument: token\nusage: ccrc ...\n' });
      expect(a).toEqual({ ok: false, err: 'spawn-failed', detail: 'ccrc: unknown argument: token' });
      expect(isTokenVerbMissing(a.ok ? null : a.detail)).toBe(true);
    });

    it('exit 0 without exactly the synced line, or with stdout unmeasured, is spawn-failed', () => {
      for (const stdout of ['', 'synced 0123456789abcdef\n', 'synced 0123456789abcdef https\nmore\n', 'ok\n', null]) {
        expect(tokenSyncAnswer({ ...base, code: 0, stdout, stderr: '' }), JSON.stringify(stdout))
          .toMatchObject({ ok: false, err: 'spawn-failed' });
      }
    });

    it('a child stopped at the bound is spawn-failed naming the bound, whatever it printed', () => {
      expect(tokenSyncAnswer({ code: 143, stdout: 'synced 0123456789abcdef https\n', stderr: 'ccrc: token sync: write-failed: x', killed: true, pid: 1 }))
        .toEqual({ ok: false, err: 'spawn-failed', detail: 'stopped at the 40000 ms bound' });
    });

    it('the answers travel: a refusal frame carries the word and the detail', async () => {
      const { c } = await up(recorder({ ...base, code: 21, stderr: 'ccrc: token sync: claim-refused: the server answered 404\n' }));
      expect(await c.req<Res>(1, { op: 'token-sync', code: CODE }))
        .toEqual({ t: 'res', id: 1, ok: false, err: 'claim-refused', detail: 'ccrc: token sync: claim-refused: the server answered 404' });
    });
  });

  describe('one gate per agent process', () => {
    it('a second op while one is spawning is busy, on the same connection and on another, and spawns nothing', async () => {
      const { c, rec } = await up();
      rec.park();
      const DETAIL = 'a token-sync op is already running on this agent';
      // No await between the sends: the gate must be checked and taken in one synchronous stretch.
      c.send({ t: 'req', id: 1, op: 'token-sync', code: CODE });
      c.send({ t: 'req', id: 2, op: 'token-sync', code: CODE });
      expect(await c.waitFor<Res>((m) => (m as Res).t === 'res' && (m as Res).id === 2))
        .toEqual({ t: 'res', id: 2, ok: false, err: 'busy', detail: DETAIL });
      const other = await open(agent!.port);
      expect(await other.req<Res>(3, { op: 'token-sync', code: CODE })).toEqual({ t: 'res', id: 3, ok: false, err: 'busy', detail: DETAIL });
      expect(rec.calls).toHaveLength(1);
      rec.release();
      expect(await c.waitFor<Res>((m) => (m as Res).t === 'res' && (m as Res).id === 1)).toMatchObject({ id: 1, ok: true });
      expect(await c.req<Res>(4, { op: 'token-sync', code: CODE }), 'the gate was not released').toMatchObject({ id: 4, ok: true });
    });
  });

  it("the ready frame advertises exactly ['update', 'token-sync']", async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { spawnTokenSync: recorder().spawn });
    const c = new TestClient(agent.port);
    clients.push(c);
    expect((await c.hello() as AgentReady).ops).toEqual(['update', 'token-sync']);
  });

  describe('the op reaches no exec path — read from the source', () => {
    const src = readFileSync(SERVER_TS, 'utf8');
    const port = readFileSync(TOKENSYNC_TS, 'utf8');

    it("handleReq's token-sync case names no exec-surface call, and spawns only through the port", () => {
      const handle = slice(src, 'async function handleReq(', /\n\}\n/);
      const body = slice(handle, "case 'token-sync': {", CASE_END);
      expect(body).not.toMatch(EXEC_PATH);
      expect(body).toMatch(/const file = updateLauncherPath\(ctx\.cfg\.home\);/);
      expect(body).toMatch(/const argv = tokenSyncSpawnArgv\(\);/);
      expect(body).toMatch(/ctx\.spawnTokenSync\(file, argv, req\.code, TOKEN_SYNC_SPAWN_TIMEOUT_MS\)/);
    });

    it("validateReq's token-sync case calls the one code guard and restates no shape", () => {
      const validate = slice(src, 'function validateReq(', /\n\}\n/);
      const body = slice(validate, "case 'token-sync': {", CASE_END);
      expect(body).toMatch(/isClaimCode\(msg\.code\)/);
      expect(body).toMatch(/refuse: 'bad-code'/);
      expect(body, 'the code shape is restated here').not.toMatch(/\{43\}|A-Za-z0-9_-|CLAIM_CODE_RE/);
    });

    it('the port names no exec path, pipes stdin, and hands the child only its explicit env', () => {
      expect(port).not.toMatch(EXEC_PATH);
      expect(port).toMatch(/spawn\(file, \[\.\.\.args\], \{ detached: true, stdio: \['pipe', 'pipe', 'pipe'\], env: childEnv \}\)/);
      expect(port, 'the port reads the agent environment itself').not.toMatch(/env:\s*process\.env|\.\.\.process\.env/);
      expect(port).toMatch(/child\.stdin\?\.end\(`\$\{code\}\\n`\)/);
      const factory = slice(port, 'export function makeTokenSyncSpawn(', /\n\}\n/);
      expect(factory, 'the factory reads process.env').not.toMatch(/process\.env/);
    });

    it('ccrc stays off the exec surface: the exec op refuses the template', () => {
      expect([...EXEC_COMMANDS]).toEqual(['tmux', 'ccd']);
      expect(isExecAllowed('ccrc', [...tokenSyncSpawnArgv()])).toBe(false);
      expect(isExecAllowed(updateLauncherPath('/h'), [...tokenSyncSpawnArgv()])).toBe(false);
    });
  });

  it('tokenSyncEnv is exactly HOME, PATH and LANG: no CCRC_AGENT_TOKEN, nothing else of the agent', () => {
    expect(tokenSyncEnv('/h', { PATH: '/p', LANG: 'en_US.UTF-8', CCRC_AGENT_TOKEN: 'x', OTHER: 'y', HOME: '/elsewhere' }))
      .toEqual({ HOME: '/h', PATH: '/p', LANG: 'en_US.UTF-8' });
    expect(tokenSyncEnv('/h', {})).toEqual({ HOME: '/h', PATH: '/usr/bin:/bin', LANG: 'C' });
  });

  describe('the real port — one real child, under the fixture HOME', () => {
    // CONTAINMENT: every launcher is the fixture's absolute path, and PATH and HOME are cut to the fixture and the
    // system directories for these cases, restored whether the case passed or threw.
    const saved = { PATH: process.env.PATH, HOME: process.env.HOME, CCRC_AGENT_TOKEN: process.env.CCRC_AGENT_TOKEN };
    function contain(home: string): void {
      process.env.PATH = '/usr/bin:/bin';
      process.env.HOME = home;
      // Planted in the agent's own environment, built from pieces: the child must never see it.
      process.env.CCRC_AGENT_TOKEN = ['planted', 'agent', 'bearer'].join('-');
    }
    afterEach(() => {
      for (const k of ['PATH', 'HOME', 'CCRC_AGENT_TOKEN'] as const) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    });
    function plantLauncher(home: string, body: string): string {
      const bin = path.join(home, '.local', 'bin');
      mkdirSync(bin, { recursive: true });
      const file = path.join(bin, 'ccrc');
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
      return file;
    }

    it("is the agent's default: exact argv, the code on stdin then EOF, and an environment of exactly three names", async () => {
      fixture = makeFixture();
      contain(fixture.home);
      const h = fixture.home;
      plantLauncher(h, [
        `printf '%s\\n' "$0" "$@" > '${h}/argv'`,
        `IFS= read -r line; printf '%s' "$line" > '${h}/stdin'`,
        `if IFS= read -r more; then echo more > '${h}/stdin-more'; fi`,
        `/usr/bin/env > '${h}/env'`,
        `echo 'synced 0123456789abcdef https'`,
      ].join('\n'));
      agent = await boot(fixture);   // NO spawnTokenSync: startAgent's default is the thing under test
      const c = await open(agent.port);
      expect(await c.req<Res>(1, { op: 'token-sync', code: CODE }))
        .toEqual({ t: 'res', id: 1, ok: true, synced: '0123456789abcdef', transport: 'https' });
      expect(readFileSync(path.join(h, 'argv'), 'utf8')).toBe([path.join(h, '.local', 'bin', 'ccrc'), ...TEMPLATE, ''].join('\n'));
      expect(readFileSync(path.join(h, 'argv'), 'utf8'), 'the code reached argv').not.toContain(CODE);
      expect(readFileSync(path.join(h, 'stdin'), 'utf8')).toBe(CODE);
      expect(existsSync(path.join(h, 'stdin-more')), 'stdin carried more than the code line').toBe(false);
      const env = readFileSync(path.join(h, 'env'), 'utf8');
      expect(env, 'the agent bearer reached the child').not.toContain('CCRC_AGENT_TOKEN');
      expect(env).not.toContain(['planted', 'agent', 'bearer'].join('-'));
      const names = env.split('\n').filter((l) => l.includes('=')).map((l) => l.slice(0, l.indexOf('=')));
      // The shell may add its own bookkeeping names (PWD, OLDPWD, SHLVL, _); nothing else of the agent's.
      expect(names.filter((n) => !['PWD', 'OLDPWD', 'SHLVL', '_'].includes(n)).sort()).toEqual(['HOME', 'LANG', 'PATH']);
      expect(env).toContain(`HOME=${h}\n`);
    });

    it('a launcher that is not there is spawn-failed naming why, which the server reads as verb-missing (D-4395)', async () => {
      fixture = makeFixture();
      contain(fixture.home);
      agent = await boot(fixture);
      const c = await open(agent.port);
      const res = await c.req<Res>(1, { op: 'token-sync', code: CODE });
      expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'spawn-failed', detail: 'could not start the launcher (ENOENT)' });
      expect(isTokenVerbMissing(res.detail)).toBe(true);
    });

    it('at the bound the group gets SIGTERM first (the trap runs), then SIGKILL after the grace', async () => {
      fixture = makeFixture();
      contain(fixture.home);
      const h = fixture.home;
      // Traps TERM and keeps running, so only the SIGKILL ends it: the trap's record proves TERM came first.
      const file = plantLauncher(h, [
        `touch '${h}/temp'`,
        `trap "echo TERM >> '${h}/sig'; rm -f '${h}/temp'" TERM`,
        'while :; do sleep 0.05; done',
      ].join('\n'));
      const spawnReal = makeTokenSyncSpawn(tokenSyncEnv(h));
      const t0 = Date.now();
      const r = await spawnReal(file, tokenSyncSpawnArgv(), CODE, 300);
      const took = Date.now() - t0;
      expect(r.killed).toBe(true);
      expect(readFileSync(path.join(h, 'sig'), 'utf8')).toBe('TERM\n');
      expect(existsSync(path.join(h, 'temp')), 'the trap did not remove its temp').toBe(false);
      expect(took, 'SIGKILL came before the grace').toBeGreaterThanOrEqual(300 + TOKEN_SYNC_KILL_GRACE_MS - 100);
      expect(took).toBeLessThan(300 + TOKEN_SYNC_KILL_GRACE_MS + 2_500);
      expect(tokenSyncAnswer(r)).toEqual({ ok: false, err: 'spawn-failed', detail: 'stopped at the 40000 ms bound' });
    });

    it('a child whose trap exits on SIGTERM answers at once, without waiting out the grace', async () => {
      fixture = makeFixture();
      contain(fixture.home);
      const h = fixture.home;
      const file = plantLauncher(h, [
        `touch '${h}/temp'`,
        `trap "rm -f '${h}/temp'; exit 143" TERM`,
        'while :; do sleep 0.05; done',
      ].join('\n'));
      const t0 = Date.now();
      const r = await makeTokenSyncSpawn(tokenSyncEnv(h))(file, tokenSyncSpawnArgv(), CODE, 300);
      expect(r.killed).toBe(true);
      expect(existsSync(path.join(h, 'temp'))).toBe(false);
      expect(Date.now() - t0).toBeLessThan(300 + TOKEN_SYNC_KILL_GRACE_MS);
    });
  });
});
