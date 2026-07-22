import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import type { RunningAgent } from '../../agent/src/server.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';

describe('connectFleet — connection lifecycle', () => {
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

  it('reaches connected:true with downSince:null after a good handshake', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);

    await vi.waitFor(() => expect(fleet!.state).toEqual({ connected: true, downSince: null }), { timeout: 3000 });
  });

  it('notifies onStateChange listeners as connectivity flips', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);

    const seen: Array<{ connected: boolean; downSince: number | null }> = [];
    const unsub = fleet.onStateChange((s) => seen.push({ ...s }));
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    unsub();

    expect(seen.some((s) => s.connected === true)).toBe(true);
  });

  it('a bad token surfaces as a fatal (never-connects, permanently down) state', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port, { token: 'totally-wrong-token' });

    await vi.waitFor(
      () => expect(fleet!.state.connected).toBe(false),
      { timeout: 3000 },
    );
    // Give it a couple of retry cycles — it must keep failing, never flip true.
    await new Promise((r) => setTimeout(r, 250));
    expect(fleet.state.connected).toBe(false);
    expect(fleet.state.downSince).not.toBeNull();
  });

  it('close() stops reconnect attempts and settles cleanly', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    await fleet.close();
    // A request issued after close() must reject rather than hang or resurrect the socket.
    await expect(fleet.runner('tmux', ['has-session', '-t', 'cc-nope'])).resolves.toMatchObject({ code: 1 });
    fleet = undefined; // already closed — afterEach shouldn't double-close
  });
});
