import { describe, it, expect, vi, afterEach } from 'vitest';
import { appendFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../../agent/src/server.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';

describe('remote FleetIO.tailFile — tailing over the agent WS', () => {
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  let fleet: ConnectedFleet | undefined;
  let close: (() => void) | null = null;

  afterEach(async () => {
    close?.();
    close = null;
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

  it('emits appended bytes as they land', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const file = path.join(fixture.home, '.cc-sessions', 't.log');
    writeFileSync(file, 'one\n');
    const chunks: Buffer[] = [];
    const resets: number[] = [];
    close = await fleet.io.tailFile(
      file,
      statSync(file).size,
      (c) => chunks.push(c),
      (size) => resets.push(size),
    );

    appendFileSync(file, 'two\n');
    await vi.waitFor(() => expect(chunks.map((c) => c.toString('utf8')).join('')).toBe('two\n'), { timeout: 3000 });
    expect(resets).toEqual([]);
  });

  it('does not emit a spurious reset when a tail is opened before the first handshake completes', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    // Deliberately NOT awaiting connected first — exercises the "opened
    // during the initial connect race" path, which must not be treated as
    // a reconnect (the very first handshake is not a resync point).
    const file = path.join(fixture.home, '.cc-sessions', 'first.log');
    writeFileSync(file, 'one\n');
    const chunks: Buffer[] = [];
    const resets: number[] = [];
    close = await fleet.io.tailFile(
      file,
      statSync(file).size,
      (c) => chunks.push(c),
      (size) => resets.push(size),
    );

    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    appendFileSync(file, 'two\n');
    await vi.waitFor(() => expect(chunks.map((c) => c.toString('utf8')).join('')).toBe('two\n'), { timeout: 3000 });
    expect(resets).toEqual([]);
  });

  it('resumes tailing after the underlying connection drops and reconnects', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    const port = agent.port;
    fleet = connectToAgent(port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const file = path.join(fixture.home, '.cc-sessions', 't2.log');
    writeFileSync(file, 'one\n');
    const chunks: Buffer[] = [];
    const resets: number[] = [];
    close = await fleet.io.tailFile(
      file,
      statSync(file).size,
      (c) => chunks.push(c),
      (size) => resets.push(size),
    );

    appendFileSync(file, 'two\n');
    await vi.waitFor(() => expect(chunks.map((c) => c.toString('utf8')).join('')).toBe('two\n'), { timeout: 3000 });

    // Bounce the agent: close it, then bring a fresh instance back up on the
    // exact same port — simulates "the fleet host's agent connection drops".
    await agent.close();
    agent = await bootAgent(fixture, { port });

    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 5000 });
    // Reconnect must resync the tail — a reset event, since the new agent
    // connection has no memory of the old tailOpen subscription.
    await vi.waitFor(() => expect(resets.length).toBeGreaterThan(0), { timeout: 3000 });

    // Tailing must keep working after the resync — new appends still flow.
    appendFileSync(file, 'three\n');
    await vi.waitFor(
      () => expect(chunks.map((c) => c.toString('utf8')).join('')).toContain('three\n'),
      { timeout: 3000 },
    );
  });

  it('close() stops further callbacks', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const file = path.join(fixture.home, '.cc-sessions', 't3.log');
    writeFileSync(file, 'one\n');
    const chunks: Buffer[] = [];
    const closeFn = await fleet.io.tailFile(file, statSync(file).size, (c) => chunks.push(c), () => {});
    closeFn();
    close = null;

    appendFileSync(file, 'two\n');
    await new Promise((r) => setTimeout(r, 500));
    expect(chunks).toEqual([]);
  });
});
