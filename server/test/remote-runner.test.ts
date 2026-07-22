import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import type { RunningAgent } from '../../agent/src/server.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';

describe('remote Runner — exec over the agent WS', () => {
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

  it('runs a whitelisted tmux subcommand through the client and returns a real exit code', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const res = await fleet.runner('tmux', ['has-session', '-t', 'cc-nope']);
    expect(typeof res.code).toBe('number');
    expect(typeof res.stdout).toBe('string');
    expect(typeof res.stderr).toBe('string');
  });

  it('a non-whitelisted command comes back as a non-zero result, never throws', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const res = await fleet.runner('rm', ['-rf', '/']);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('forbidden');
  });

  it('never throws when the fleet is disconnected — returns a failing ExecResult', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    await agent.close(); // yank the transport out from under the client
    agent = undefined; // already closed — afterEach shouldn't double-close
    const res = await fleet.runner('tmux', ['has-session', '-t', 'cc-nope']);
    expect(res).toMatchObject({ code: 1, stdout: '' });
    expect(res.stderr.length).toBeGreaterThan(0);
  });
});
