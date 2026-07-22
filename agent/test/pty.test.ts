import { describe, it, expect, afterEach, vi } from 'vitest';
import { rmSync } from 'node:fs';
import type { RunningAgent } from '../src/server.js';
import type { PtyProcess, PtySpawn } from '../src/pty.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

interface Res { ok: boolean; err?: string; ptyId?: number; [k: string]: unknown }
interface PtyMsg { t: 'pty'; ptyId: number; ev: 'data' | 'exit'; dataB64?: string }

const wait = { timeout: 3000 };

/** A fake `PtySpawn` that never touches node-pty/tmux — records writes and
 *  resizes, and lets tests drive `onData`/`onExit` directly to simulate
 *  the underlying process producing output or dying on its own. */
function makeFakeSpawn(): {
  spawn: PtySpawn;
  calls: Array<{ sessionId: string; cols: number; rows: number }>;
  instances: Array<{
    written: string[];
    resized: Array<{ cols: number; rows: number }>;
    killed: boolean;
    emitData(s: string): void;
    emitExit(): void;
  }>;
} {
  const calls: Array<{ sessionId: string; cols: number; rows: number }> = [];
  const instances: Array<{
    written: string[];
    resized: Array<{ cols: number; rows: number }>;
    killed: boolean;
    emitData(s: string): void;
    emitExit(): void;
  }> = [];

  const spawn: PtySpawn = (sessionId, cols, rows) => {
    calls.push({ sessionId, cols, rows });
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<() => void>();
    const written: string[] = [];
    const resized: Array<{ cols: number; rows: number }> = [];
    let killed = false;

    const proc: PtyProcess = {
      onData: (listener) => { dataListeners.add(listener); return { dispose: () => dataListeners.delete(listener) }; },
      onExit: (listener) => { exitListeners.add(listener); return { dispose: () => exitListeners.delete(listener) }; },
      write: (data) => written.push(data),
      resize: (c, r) => resized.push({ cols: c, rows: r }),
      kill: () => { killed = true; },
    };
    instances.push({
      written,
      resized,
      get killed() { return killed; },
      emitData: (s) => { for (const l of dataListeners) l(s); },
      emitExit: () => { for (const l of exitListeners) l(); },
    });
    return proc;
  };

  return { calls, instances, spawn };
}

describe('ccrc-agent ptyOpen/pty control frames', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;

  afterEach(async () => {
    client?.ws.close();
    client = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  async function open(spawn: PtySpawn): Promise<void> {
    fixture = makeFixture();
    agent = await boot(fixture, { spawnPty: spawn });
    client = new TestClient(agent.port);
    await client.hello();
  }

  it('spawns with the sanitized sessionId/cols/rows and returns a ptyId', async () => {
    const fake = makeFakeSpawn();
    await open(fake.spawn);

    const res = await client!.req<Res>(1, { op: 'ptyOpen', sessionId: 'claude2-MekWarLive', cols: 120, rows: 40 });
    expect(res.ok).toBe(true);
    expect(typeof res.ptyId).toBe('number');
    expect(fake.calls).toEqual([{ sessionId: 'claude2-MekWarLive', cols: 120, rows: 40 }]);
  });

  it('rejects a sessionId with disallowed characters', async () => {
    const fake = makeFakeSpawn();
    await open(fake.spawn);

    const res = await client!.req<Res>(1, { op: 'ptyOpen', sessionId: '../etc/passwd', cols: 80, rows: 24 });
    expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'forbidden' });
    expect(fake.calls).toEqual([]);
  });

  it('streams process output as base64 PtyData frames', async () => {
    const fake = makeFakeSpawn();
    await open(fake.spawn);

    const openRes = await client!.req<Res>(1, { op: 'ptyOpen', sessionId: 'sess1', cols: 80, rows: 24 });
    const ptyId = openRes.ptyId!;
    fake.instances[0]!.emitData('hello from tmux');

    const frame = await client!.waitFor<PtyMsg>(
      (m) => (m as { t?: unknown }).t === 'pty' && (m as { ptyId?: unknown }).ptyId === ptyId && (m as { ev?: unknown }).ev === 'data',
      wait.timeout,
    );
    expect(Buffer.from(frame.dataB64!, 'base64').toString('utf8')).toBe('hello from tmux');
  });

  it('input frames write decoded utf8 to the underlying process', async () => {
    const fake = makeFakeSpawn();
    await open(fake.spawn);

    const openRes = await client!.req<Res>(1, { op: 'ptyOpen', sessionId: 'sess1', cols: 80, rows: 24 });
    const ptyId = openRes.ptyId!;
    client!.send({ t: 'pty', ptyId, ev: 'input', dataB64: Buffer.from('ls\r', 'utf8').toString('base64') });

    await vi.waitFor(() => expect(fake.instances[0]!.written).toContain('ls\r'), wait);
  });

  it('resize frames call resize on the underlying process', async () => {
    const fake = makeFakeSpawn();
    await open(fake.spawn);

    const openRes = await client!.req<Res>(1, { op: 'ptyOpen', sessionId: 'sess1', cols: 80, rows: 24 });
    const ptyId = openRes.ptyId!;
    client!.send({ t: 'pty', ptyId, ev: 'resize', cols: 100, rows: 30 });

    await vi.waitFor(() => expect(fake.instances[0]!.resized).toContainEqual({ cols: 100, rows: 30 }), wait);
  });

  it('close frames kill the process and stop further data frames', async () => {
    const fake = makeFakeSpawn();
    await open(fake.spawn);

    const openRes = await client!.req<Res>(1, { op: 'ptyOpen', sessionId: 'sess1', cols: 80, rows: 24 });
    const ptyId = openRes.ptyId!;
    client!.send({ t: 'pty', ptyId, ev: 'close' });

    await vi.waitFor(() => expect(fake.instances[0]!.killed).toBe(true), wait);

    fake.instances[0]!.emitData('should not arrive');
    let sawFrame = false;
    try {
      await client!.waitFor((m) => (m as { t?: unknown; ptyId?: unknown }).t === 'pty' && (m as { ptyId?: unknown }).ptyId === ptyId, 200);
      sawFrame = true;
    } catch {
      sawFrame = false;
    }
    expect(sawFrame).toBe(false);
  });

  it('sends a PtyExit frame when the underlying process exits on its own', async () => {
    const fake = makeFakeSpawn();
    await open(fake.spawn);

    const openRes = await client!.req<Res>(1, { op: 'ptyOpen', sessionId: 'sess1', cols: 80, rows: 24 });
    const ptyId = openRes.ptyId!;
    fake.instances[0]!.emitExit();

    const frame = await client!.waitFor<PtyMsg>(
      (m) => (m as { t?: unknown }).t === 'pty' && (m as { ptyId?: unknown }).ptyId === ptyId && (m as { ev?: unknown }).ev === 'exit',
      wait.timeout,
    );
    expect(frame).toEqual({ t: 'pty', ptyId, ev: 'exit' });
  });

  it('kills every open pty when the connection disconnects', async () => {
    const fake = makeFakeSpawn();
    await open(fake.spawn);

    await client!.req<Res>(1, { op: 'ptyOpen', sessionId: 'sess1', cols: 80, rows: 24 });
    client!.ws.close();

    await vi.waitFor(() => expect(fake.instances[0]!.killed).toBe(true), wait);
  });
});
