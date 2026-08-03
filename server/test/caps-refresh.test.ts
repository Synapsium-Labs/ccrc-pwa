import { describe, it, expect, vi, afterEach } from 'vitest';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../../agent/src/server.js';
import { type ConnectedFleet } from '../src/remote/client.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';

function writeCcd(home: string, body: string): void {
  const dir = path.join(home, '.local', 'bin');
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ccd');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

describe('caps refresh', () => {
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close(); fleet = undefined;
    if (agent) await agent.close(); agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('caps() returns what ccd prints now, not what it printed at agent boot', async () => {
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start');
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.ccdVerbs).toEqual(['start']), { timeout: 3000 });

    writeCcd(fixture.home, 'echo start\necho ws-rename');
    expect(await fleet.client.caps()).toEqual(['start', 'ws-rename']);
  });

  it('answers null — not [] — when there is no answer to trust', async () => {
    // No ccd in the fixture home at all: the agent's boot read failed, so its
    // ready frame carried []. A caps() that cannot be trusted must be null, or
    // the seam in index.ts would overwrite a good list with an empty one.
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const { client } = fleet;
    await fleet.close(); fleet = undefined;
    // With the transport gone, caps() must resolve null rather than throw.
    expect(await client.caps()).toBeNull();
  });

  it('a reconnect after a refresh does not regress to the agent boot list', async () => {
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start');
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.ccdVerbs).toEqual(['start']), { timeout: 3000 });

    writeCcd(fixture.home, 'echo start\necho ws-rename');
    expect(await fleet.client.caps()).toEqual(['start', 'ws-rename']);

    // Force a reconnect. onReady reassigns state.ccdVerbs from the ready frame,
    // so this fails unless the agent's ready frame serves the refreshed holder.
    fleet.client.ws?.close();
    await vi.waitFor(
      () => expect(fleet!.state.ccdVerbs).toEqual(['start', 'ws-rename']),
      { timeout: 5000 },
    );
  });
});
