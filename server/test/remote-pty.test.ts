import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import type { RunningAgent } from '../../agent/src/server.js';
import type { PtyProcess, PtySpawn } from '../../agent/src/pty.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import type { RemotePty } from '../src/remote/pty.js';
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
});
