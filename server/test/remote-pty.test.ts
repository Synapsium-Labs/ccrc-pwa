import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import type { RunningAgent } from '../../agent/src/server.js';
import type { PtyProcess, PtySpawn } from '../../agent/src/pty.js';
import type { ConnectedFleet, FleetClient } from '../src/remote/client.js';
import { RemotePty } from '../src/remote/pty.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';

const wait = { timeout: 3000 };

/** Same fake-spawn shape as `agent/test/pty.test.ts` — no node-pty/tmux
 *  involved, just enough surface to drive data/exit and record writes. */
function makeFakeSpawn(): {
  spawn: PtySpawn;
  instances: Array<{
    written: string[];
    resized: Array<{ cols: number; rows: number }>;
    killed: boolean;
    emitData(s: string): void;
    emitExit(): void;
  }>;
} {
  const instances: Array<{
    written: string[];
    resized: Array<{ cols: number; rows: number }>;
    killed: boolean;
    emitData(s: string): void;
    emitExit(): void;
  }> = [];

  const spawn: PtySpawn = () => {
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

  return { instances, spawn };
}

describe('remote SpawnPty — terminal drawer over the agent WS', () => {
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  async function connected(spawn: PtySpawn): Promise<void> {
    fixture = makeFixture();
    agent = await bootAgent(fixture, { spawnPty: spawn });
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), wait);
  }

  it('streams agent-side data to onData as decoded utf8', async () => {
    const fake = makeFakeSpawn();
    await connected(fake.spawn);

    const received: string[] = [];
    const pty = fleet!.spawnPty('sess1', 80, 24);
    pty.onData((data) => received.push(data));

    await vi.waitFor(() => expect(fake.instances.length).toBe(1), wait);
    fake.instances[0]!.emitData('hello from tmux');

    await vi.waitFor(() => expect(received).toContain('hello from tmux'), wait);
  });

  it('write() sends input through to the agent-side process', async () => {
    const fake = makeFakeSpawn();
    await connected(fake.spawn);

    const pty = fleet!.spawnPty('sess1', 80, 24);
    await vi.waitFor(() => expect(fake.instances.length).toBe(1), wait);
    pty.write('ls\r');

    await vi.waitFor(() => expect(fake.instances[0]!.written).toContain('ls\r'), wait);
  });

  it('resize() call is recorded on the agent-side process', async () => {
    const fake = makeFakeSpawn();
    await connected(fake.spawn);

    const pty = fleet!.spawnPty('sess1', 80, 24);
    await vi.waitFor(() => expect(fake.instances.length).toBe(1), wait);
    pty.resize(100, 30);

    await vi.waitFor(() => expect(fake.instances[0]!.resized).toContainEqual({ cols: 100, rows: 30 }), wait);
  });

  it('kill() sends close and the agent-side process is killed', async () => {
    const fake = makeFakeSpawn();
    await connected(fake.spawn);

    const pty = fleet!.spawnPty('sess1', 80, 24);
    await vi.waitFor(() => expect(fake.instances.length).toBe(1), wait);
    pty.kill();

    await vi.waitFor(() => expect(fake.instances[0]!.killed).toBe(true), wait);
  });

  it('exit propagates from the agent to the RemotePty', async () => {
    const fake = makeFakeSpawn();
    await connected(fake.spawn);

    const pty = (fleet!.spawnPty('sess1', 80, 24) as unknown) as RemotePty;
    await vi.waitFor(() => expect(fake.instances.length).toBe(1), wait);

    let exited = false;
    pty.onExit(() => { exited = true; });
    fake.instances[0]!.emitExit();

    await vi.waitFor(() => expect(exited).toBe(true), wait);
  });

  it('write/resize/kill issued before the ptyId resolves are queued and flushed', async () => {
    const fake = makeFakeSpawn();
    await connected(fake.spawn);

    // Call synchronously, right after spawnPty returns — before the
    // ptyOpen round trip to the agent can possibly have resolved yet.
    const pty = fleet!.spawnPty('sess1', 80, 24);
    pty.write('early\r');
    pty.resize(90, 28);

    await vi.waitFor(() => expect(fake.instances.length).toBe(1), wait);
    await vi.waitFor(() => expect(fake.instances[0]!.written).toContain('early\r'), wait);
    await vi.waitFor(() => expect(fake.instances[0]!.resized).toContainEqual({ cols: 90, rows: 28 }), wait);
  });

  it('after a link drop and a reconnect, a write through the stale RemotePty reaches no pty', async () => {
    // D-6368. The agent numbers ptys per CONNECTION from 1, so after a reconnect a new session's pty is id 1 again —
    // the id the stale RemotePty still holds. Its keys must die at the source, never reach the new pty.
    const fake = makeFakeSpawn();
    await connected(fake.spawn);
    const states: boolean[] = [];
    fleet!.onStateChange((s) => states.push(s.connected));

    const stale = fleet!.spawnPty('sess-a', 80, 24) as unknown as RemotePty;
    await vi.waitFor(() => expect(fake.instances.length).toBe(1), wait);
    let staleExited = 0;
    stale.onExit(() => { staleExited += 1; });
    await vi.waitFor(() => expect((stale as unknown as { ptyId: number | null }).ptyId).toBe(1), wait);

    fleet!.client.ws?.close();   // the link drops; the client synthesizes the exit, then reconnects with backoff
    await vi.waitFor(() => expect(states).toEqual([false, true]), wait);
    expect(staleExited).toBe(1);

    const fresh = fleet!.spawnPty('sess-b', 80, 24) as unknown as RemotePty;
    await vi.waitFor(() => expect(fake.instances.length).toBe(2), wait);
    // PROVE the premise: both hold id 1.
    expect((fresh as unknown as { ptyId: number | null }).ptyId).toBe(1);
    expect((stale as unknown as { ptyId: number | null }).ptyId).toBe(1);

    stale.write('x');
    stale.resize(99, 33);
    fresh.write('y');   // frames ride one socket in order: once 'y' lands, an 'x' sent before it would have too
    await vi.waitFor(() => expect(fake.instances[1]!.written).toContain('y'), wait);
    for (const inst of fake.instances) expect(inst.written).not.toContain('x');
    for (const inst of fake.instances) expect(inst.resized).not.toContainEqual({ cols: 99, rows: 33 });

    const sendPty = vi.spyOn(fleet!.client, 'sendPty');
    stale.kill();
    expect(sendPty).not.toHaveBeenCalledWith(expect.objectContaining({ ev: 'close' }));

    fresh.write('z');
    await vi.waitFor(() => expect(fake.instances[1]!.written).toContain('z'), wait);
    expect(fake.instances[1]!.killed).toBe(false);
    expect((fleet!.client as unknown as { ptyListeners: Map<number, unknown> }).ptyListeners.has(1)).toBe(true);
  });

  it('a rejected open clears queued writes, becomes closed, and fires exit', async () => {
    const fake = makeFakeSpawn();
    await connected(fake.spawn);
    const sendPty = vi.spyOn(fleet!.client, 'sendPty');

    // A session id outside the agent's charset is refused ('forbidden'), deterministically, before any spawn.
    const pty = fleet!.spawnPty('not a session!', 80, 24) as unknown as RemotePty;
    let exits = 0;
    pty.onExit(() => { exits += 1; });
    pty.write('queued-before-open');

    await vi.waitFor(() => expect(exits).toBe(1), wait);
    expect(fake.instances.length).toBe(0);
    expect((pty as unknown as { queue: unknown[] }).queue).toEqual([]);
    expect((pty as unknown as { closed: boolean }).closed).toBe(true);
    pty.write('after');
    expect(sendPty).not.toHaveBeenCalledWith(expect.objectContaining({ ev: 'input' }));
    expect(exits).toBe(1);
  });

  it('a resolved open without a numeric ptyId clears queued writes, becomes closed, and fires exit', async () => {
    const fake = makeFakeSpawn();
    await connected(fake.spawn);
    const sendPty = vi.spyOn(fleet!.client, 'sendPty');
    vi.spyOn(fleet!.client, 'request').mockResolvedValue({ t: 'res', id: 1 });

    const pty = new RemotePty(fleet!.client as FleetClient, 'sess-a', 80, 24);
    let exits = 0;
    pty.onExit(() => { exits += 1; });
    pty.write('queued-before-open');

    await vi.waitFor(() => expect(exits).toBe(1), wait);
    expect(fake.instances.length).toBe(0);
    expect((pty as unknown as { queue: unknown[] }).queue).toEqual([]);
    expect((pty as unknown as { closed: boolean }).closed).toBe(true);
    pty.write('after');
    expect(sendPty).not.toHaveBeenCalledWith(expect.objectContaining({ ev: 'input' }));
    expect(exits).toBe(1);
  });

  it('exit releases the client\'s pty listener', async () => {
    const fake = makeFakeSpawn();
    await connected(fake.spawn);
    const offPty = vi.spyOn(fleet!.client, 'offPty');

    const pty = fleet!.spawnPty('sess-a', 80, 24) as unknown as RemotePty;
    await vi.waitFor(() => expect(fake.instances.length).toBe(1), wait);
    let exits = 0;
    pty.onExit(() => { exits += 1; });
    // wait until the listener is registered on the client
    await vi.waitFor(() => expect((fleet!.client as unknown as { ptyListeners: Map<number, unknown> }).ptyListeners.has(1)).toBe(true), wait);

    fake.instances[0]!.emitExit();
    await vi.waitFor(() => expect(exits).toBe(1), wait);

    expect(offPty).toHaveBeenCalledWith(1);
    expect((fleet!.client as unknown as { ptyListeners: Map<number, unknown> }).ptyListeners.has(1)).toBe(false);
    // and a closed pty does not send `close` for an id the agent already dropped
    pty.kill();
    expect(fake.instances[0]!.killed).toBe(false);
  });
});
