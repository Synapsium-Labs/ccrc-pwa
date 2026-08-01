import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import type { RunningAgent } from '../../agent/src/server.js';
import type { ConnectedFleet, FleetClient } from '../src/remote/client.js';
import { createRunner } from '../src/remote/runner.js';
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

describe('wireCmd — absolute ccdBin normalization (agent whitelist takes bare names only)', () => {
  it('maps any …/ccd path to bare ccd, leaves everything else alone', async () => {
    const { wireCmd } = await import('../src/remote/runner.js');
    expect(wireCmd('/home/you/.local/bin/ccd')).toBe('ccd');
    expect(wireCmd('ccd')).toBe('ccd');
    expect(wireCmd('tmux')).toBe('tmux');
    expect(wireCmd('/usr/bin/tmux')).toBe('/usr/bin/tmux'); // only ccd is re-homed
  });
});

describe('per-verb timeouts', () => {
  const seen: number[] = [];
  const client = {
    request: async (req: { timeoutMs?: number }) => { seen.push(req.timeoutMs ?? -1); return { code: 0, stdout: '', stderr: '' }; },
  } as unknown as FleetClient;

  it.each([
    [['pr-state', '--session', 'x'], 20_000],
    [['ws-archive', '--session', 'x'], 60_000],
    [['ws-restore', '--session', 'x'], 60_000],
    [['ws-audit', '--session', 'x'], 90_000],
    [['ws-reap', '--expect', 'a'.repeat(64), '--session', 'x'], 240_000],
    [['ensure', 'x'], 90_000],                  // the unchanged ccd default
  ])('sends %j with a %i ms budget', async (args, ms) => {
    seen.length = 0;
    await createRunner(client)('/home/u/.local/bin/ccd', args as string[]);
    expect(seen[0]).toBe(ms);
  });

  it('still gives tmux its own short budget', async () => {
    seen.length = 0;
    await createRunner(client)('tmux', ['has-session', '-t', 'x']);
    expect(seen[0]).toBe(10_000);
  });

  it('falls back to the flat ccd default rather than throwing when args is empty', async () => {
    seen.length = 0;
    await createRunner(client)('/home/u/.local/bin/ccd', []);
    expect(seen[0]).toBe(90_000);
  });
});
