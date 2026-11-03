// D-7055 (W8 Task C8c; ARCH-73 (#808), its spawn half; spec K17 "Process spawn"): the bounded update spawner is ONE
// body, `shared/spawn.mjs#boundedSpawn`, and the two roles reach it through thin wrappers — the server's
// `boundedUpdateSpawn` (`server/src/update/spawn.ts`) and the agent's `makeUpdateSpawn` (`agent/src/server.ts`).
//
// The kernel imports nothing: the `.mjs` carve-out (`rings/mjs-node.data.ts#MJS_CARVE_OUT`) allows no
// `node:child_process` or `node:os`, so each wrapper INJECTS `spawn` and `signals` as the host, and no `shared/*.mjs`
// imports a `.ts` sibling, so the wire constants the body reads reach it as options: each wrapper passes
// `drainMs: UPDATE_SPAWN_DRAIN_MS` from `shared/agent-protocol.ts`, the one definition, and the kernel defines no copy
// (`single-definition/kernel-tail-spawn.test.ts` holds that half). The kernel's own rows below drive it against a stub
// host under fake timers; the real-process rows over both wrappers are `update-spawn-wrappers.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { boundedSpawn, boundedStdinSpawn } from '../../shared/spawn.mjs';
import { callsIn, parsedFile, sourceOfSymbol, symbolOf } from './scan/symbols.js';
import { codeOf } from './consolidationCensus.js';

const KERNEL = 'shared/spawn.mjs';
/** Each wrapper, by file and the symbol that wraps the kernel. */
const WRAPPERS = [
  ['server/src/update/spawn.ts', 'boundedUpdateSpawn'],
  ['agent/src/server.ts', 'makeUpdateSpawn'],
] as const;
const code = (src: string): string => src.split('\n').map(codeOf).join('\n');

describe('shared/spawn.mjs is the one bounded update spawner, and its wrappers are thin (D-7055)', () => {
  it('shared/spawn.mjs imports nothing: no node: builtin, no .ts sibling, no dynamic import', () => {
    expect(parsedFile(KERNEL).imports).toEqual([]);
    expect(code(parsedFile(KERNEL).text)).not.toMatch(/\brequire\s*\(/);
  });

  it('the kernel holds the body: its own spawn call, with spawn read from the injected host', () => {
    const body = sourceOfSymbol(KERNEL, 'boundedSpawn');
    expect(body).toContain("spawn(file, [...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env })");
    expect(body).toMatch(/const \{ spawn, signals \} = host;/);
    expect(body).toContain("process.kill(-child.pid, 'SIGKILL')");
  });

  for (const [file, symbol] of WRAPPERS) {
    it(`${file}: ${symbol} calls boundedSpawn and carries no spawn(file, [...args] of its own`, () => {
      const calls = callsIn(symbolOf(file, symbol)).filter((c) => c.name === 'boundedSpawn');
      expect(calls, `${symbol} calls boundedSpawn exactly once`).toHaveLength(1);
      expect(code(parsedFile(file).text)).not.toContain('spawn(file, [...args]');
      expect(calls[0]!.args[0]?.text, 'the host injects spawn and the signal table').toMatch(/^\{ spawn, signals: os\.constants\.signals \}$/);
      const imp = parsedFile(file).imports.find((e) => e.names.includes('boundedSpawn'));
      expect(imp?.specifier, `${file} imports boundedSpawn from the kernel`).toMatch(/\/shared\/spawn\.mjs$/);
    });

    it(`${file}: both wrappers pass the protocol constant, drainMs: UPDATE_SPAWN_DRAIN_MS imported from agent-protocol`, () => {
      const call = callsIn(symbolOf(file, symbol)).find((c) => c.name === 'boundedSpawn');
      expect(call, `${symbol} calls boundedSpawn`).toBeDefined();
      expect(call!.args).toHaveLength(4);
      expect(call!.args[3]!.text, 'the options carry drainMs: UPDATE_SPAWN_DRAIN_MS').toMatch(/\bdrainMs: UPDATE_SPAWN_DRAIN_MS\b/);
      const parsed = parsedFile(file);
      const imp = parsed.imports.find((e) => e.names.includes('UPDATE_SPAWN_DRAIN_MS'));
      expect(imp?.specifier, 'UPDATE_SPAWN_DRAIN_MS comes from shared/agent-protocol').toMatch(/\/shared\/agent-protocol\.js$/);
      expect(parsed.bindings.filter((b) => b.name === 'UPDATE_SPAWN_DRAIN_MS'), 'no local copy of the drain').toEqual([]);
    });
  }
});

// The kernel's own rows: a stub host (a recording `spawn` handing back a fake child, a stub signal table), fake
// timers, `process.kill` spied so no real pid is signalled. `drainMs: 50` bounds every drain at its option.
const FAKE_PID = 515151;
class FakeChild extends EventEmitter {
  pid: number | undefined = FAKE_PID;
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
}
describe('shared/spawn.mjs#boundedSpawn against a stub host', () => {
  let child: FakeChild;
  let killSpy: ReturnType<typeof vi.spyOn>;
  let spawnCalls: unknown[][];
  const host = () => ({
    spawn: (...a: unknown[]) => { spawnCalls.push(a); return child as never; },
    signals: { SIGTERM: 15, SIGFAKE: 40 },
  });
  const ENV = { HOME: '/fixture-home' };
  const run = (timeoutMs = 1000, drainMs = 50) => boundedSpawn(host() as never, 'launcher', ['a', 'b'], { env: ENV, timeoutMs, drainMs });
  beforeEach(() => {
    vi.useFakeTimers();
    child = new FakeChild();
    spawnCalls = [];
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });
  afterEach(() => { vi.useRealTimers(); killSpy.mockRestore(); });

  it('spawns through the host: its own process group, no stdin, the env it was given, the argv copied', async () => {
    const p = run();
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toEqual(['launcher', ['a', 'b'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: ENV }]);
    child.stdout.end('out');
    child.stderr.end('err');
    child.emit('exit', 0, null);
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ code: 0, stdout: 'out', stderr: 'err', killed: false, pid: FAKE_PID });
  });

  it('an exit with the pipes still open is answered at exit + drainMs, stdout null — not before', async () => {
    let answered = false;
    const p = run(1000, 50);
    void p.then(() => { answered = true; });
    child.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(49);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toBe(true);
    expect(await p).toMatchObject({ code: 0, stdout: null, killed: false });
  });

  it('a parent that never exits after the kill is answered at timeoutMs + drainMs, code 1, killed, the group signalled', async () => {
    let answered = false;
    const p = run(1000, 50);
    void p.then(() => { answered = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(killSpy).toHaveBeenCalledWith(-FAKE_PID, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(49);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toMatchObject({ code: 1, killed: true, stdout: null });
  });

  it('a signal not ours answers 128 + signo, the signo read from the host\'s table', async () => {
    const p = run();
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', null, 'SIGFAKE');
    await vi.runAllTimersAsync();
    expect(await p).toMatchObject({ code: 168, killed: false });
  });

  it('a spawn that produced no pid answers code 1 with the sentence and pid null', async () => {
    child.pid = undefined;
    const p = run();
    child.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' }));
    expect(await p).toEqual({ code: 1, stdout: '', stderr: 'could not start the launcher (ENOENT)', killed: false, pid: null });
  });

  it('a stdout past 1 MiB reads null', async () => {
    const p = run();
    child.stdout.write(Buffer.alloc(1024 * 1024 + 1, 0x61));
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 0, null);
    await vi.runAllTimersAsync();
    expect(await p).toMatchObject({ code: 0, stdout: null });
  });
});

// D-7057, OA-C8a (a) (D-7060; W8 Task C8e): the account-op spawner is ONE body too, `shared/spawn.mjs#boundedStdinSpawn`,
// which the local arm (`server/src/accounts/ops.ts#localAccountOps`) and the agent's port
// (`agent/src/accountop.ts#makeAccountOpSpawn`) wrap. Its own rows: a stub host whose child has a stdin, fake timers,
// `process.kill` spied. Every bound reaches it as an option (`drainMs: 50`, `killGraceMs: 200` here); the real-process
// rows over both arms are `account-op-twins.test.ts`.
class FakeStdinChild extends EventEmitter {
  pid: number | undefined = FAKE_PID;
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
}
describe('shared/spawn.mjs#boundedStdinSpawn against a stub host (D-7057)', () => {
  let child: FakeStdinChild;
  let killSpy: ReturnType<typeof vi.spyOn>;
  let spawnCalls: unknown[][];
  let spawnThrows = false;
  const host = () => ({
    spawn: (...a: unknown[]) => { spawnCalls.push(a); if (spawnThrows) throw new Error('EAGAIN'); return child as never; },
    signals: { SIGTERM: 15, SIGFAKE: 40 },
  });
  const ENV = { HOME: '/fixture-home', PATH: '/usr/bin:/bin', LANG: 'C' };
  const OPTS = { env: ENV, timeoutMs: 1000, killGraceMs: 200, maxOutputBytes: 16, drainMs: 50 };
  const run = (stdin: Buffer | null = null, opts = OPTS) => boundedStdinSpawn(host() as never, 'launcher', ['account', 'roster'], stdin, opts);
  const stdinBytes = (): Promise<Buffer> => new Promise((r) => { const got: Buffer[] = []; child.stdin.on('data', (b: Buffer) => got.push(b)); child.stdin.on('end', () => r(Buffer.concat(got))); });
  beforeEach(() => {
    vi.useFakeTimers();
    child = new FakeStdinChild();
    spawnCalls = [];
    spawnThrows = false;
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });
  afterEach(() => { vi.useRealTimers(); killSpy.mockRestore(); });

  it('the kernel holds the body: spawn read from the injected host, stdin piped, TERM to the group', () => {
    const body = sourceOfSymbol(KERNEL, 'boundedStdinSpawn');
    expect(body).toMatch(/const \{ spawn, signals \} = host;/);
    expect(body).toContain("spawn(file, [...argv], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env })");
    expect(body).toContain('process.kill(-child.pid, s)');
  });

  it('spawns through the host: its own group, three pipes, the env it was given; stdin is the bytes exactly, then EOF', async () => {
    const got = stdinBytes();
    const p = run(Buffer.from('CANARY-kernel'));
    expect(spawnCalls).toEqual([['launcher', ['account', 'roster'], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: ENV }]]);
    expect(await got).toEqual(Buffer.from('CANARY-kernel'));
    child.stdout.write('{"ok":true}');
    child.emit('close', 0, null);
    expect(await p).toEqual({ kind: 'exited', code: 0, stdout: '{"ok":true}' });
  });

  it('no stdin is an empty stdin, then EOF', async () => {
    const got = stdinBytes();
    const p = run(null);
    expect(await got).toEqual(Buffer.alloc(0));
    child.emit('close', 0, null);
    expect(await p).toMatchObject({ kind: 'exited', code: 0 });
  });

  it('at timeoutMs the group gets SIGTERM, SIGKILL killGraceMs later, and the answer comes drainMs after that', async () => {
    let answered = false;
    const p = run();
    void p.then(() => { answered = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(killSpy.mock.calls).toEqual([[-FAKE_PID, 'SIGTERM']]);
    await vi.advanceTimersByTimeAsync(200);
    expect(killSpy.mock.calls).toEqual([[-FAKE_PID, 'SIGTERM'], [-FAKE_PID, 'SIGKILL']]);
    await vi.advanceTimersByTimeAsync(49);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ kind: 'timeout' });
  });

  it('the KILL is never cancelled: a close after the TERM answers timeout, and the group still gets SIGKILL', async () => {
    const p = run();
    await vi.advanceTimersByTimeAsync(1000);
    child.emit('close', null, 'SIGTERM');
    expect(await p).toEqual({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(200);
    expect(killSpy).toHaveBeenCalledWith(-FAKE_PID, 'SIGKILL');
  });

  it('one byte past maxOutputBytes answers too-large, the group TERMed then KILLed', async () => {
    const p = run();
    child.stdout.write(Buffer.alloc(17, 0x61));
    await vi.advanceTimersByTimeAsync(0);
    expect(killSpy).toHaveBeenCalledWith(-FAKE_PID, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(250);
    expect(killSpy).toHaveBeenCalledWith(-FAKE_PID, 'SIGKILL');
    expect(await p).toEqual({ kind: 'too-large' });
  });

  it('a group kill that throws other than ESRCH falls back to the child alone; ESRCH does not', async () => {
    killSpy.mockImplementation(() => { throw Object.assign(new Error('kill'), { code: 'EPERM' }); });
    const p = run();
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(250);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(await p).toEqual({ kind: 'timeout' });
    const esrch = new FakeStdinChild();
    child = esrch;
    killSpy.mockImplementation(() => { throw Object.assign(new Error('kill'), { code: 'ESRCH' }); });
    const q = run();
    await vi.advanceTimersByTimeAsync(1250);
    expect(esrch.kill).not.toHaveBeenCalled();
    expect(await q).toEqual({ kind: 'timeout' });
  });

  it('a signal not ours answers 128 + signo, the signo read from the host\'s table', async () => {
    const p = run();
    child.emit('close', null, 'SIGFAKE');
    expect(await p).toEqual({ kind: 'exited', code: 168, stdout: '' });
  });

  it('a child that errors, or a spawn that throws, answers not-started', async () => {
    const p = run();
    child.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' }));
    expect(await p).toEqual({ kind: 'not-started' });
    spawnThrows = true;
    expect(await run()).toEqual({ kind: 'not-started' });
  });
});

// D-4390 (box-token lifecycle wave 1): the `token-sync` op's spawn is its OWN bounded body in `agent/src/tokensync.ts`
// (stdin piped, an explicit {HOME, PATH, LANG}, SIGTERM then SIGKILL), not a third twin and not the twin with stdin
// as a parameter. The update spawner is one body, `shared/spawn.mjs`; the third body stays visibly separate, so an
// edit that copies the kernel into it (or folds it into the kernel) is a red here rather than a silent second update
// spawner. (Moved here from `update-spawn-twin-bodies.test.ts`, which D-7055 removes; the tokensync rows are byte-equal.)
const BEGIN = '// ── BEGIN bounded-spawn body';
const END = '// ── END bounded-spawn body';
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
describe('the token-sync spawn is not a third twin (D-4390)', () => {
  const tokensync = read('../../agent/src/tokensync.ts');
  const count = (src: string, sentinel: string): number => src.split('\n').filter((l) => l.trim().startsWith(sentinel)).length;

  it('agent/src/tokensync.ts, agent/src/server.ts, server/src/update/spawn.ts and shared/spawn.mjs carry 0 bounded-spawn sentinels', () => {
    for (const rel of ['../../agent/src/tokensync.ts', '../../agent/src/server.ts', '../src/update/spawn.ts', '../../shared/spawn.mjs']) {
      const src = read(rel);
      expect(count(src, BEGIN), `a bounded-spawn sentinel in ${rel}`).toBe(0);
      expect(count(src, END), `a bounded-spawn sentinel in ${rel}`).toBe(0);
    }
  });

  it('agent/src/tokensync.ts calls no boundedSpawn and imports nothing from the kernel', () => {
    expect(parsedFile('agent/src/tokensync.ts').calls.filter((c) => c.name === 'boundedSpawn')).toEqual([]);
    expect(parsedFile('agent/src/tokensync.ts').imports.filter((e) => /\/spawn\.mjs$/.test(e.specifier))).toEqual([]);
  });

  it('its body is its own: stdin piped, an explicit env, SIGTERM before SIGKILL; the update spawner pipes no stdin', () => {
    expect(tokensync).toContain("stdio: ['pipe', 'pipe', 'pipe'], env: childEnv");
    expect(tokensync).toContain("signalGroup('SIGTERM')");
    expect(tokensync).toContain("signalGroup('SIGKILL')");
    expect(tokensync.indexOf("signalGroup('SIGTERM')")).toBeLessThan(tokensync.indexOf("signalGroup('SIGKILL')"));
    expect(sourceOfSymbol(KERNEL, 'boundedSpawn')).toContain("stdio: ['ignore', 'pipe', 'pipe']");
  });
});
