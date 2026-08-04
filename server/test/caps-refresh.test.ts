import { describe, it, expect, vi, afterEach } from 'vitest';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { RunningAgent } from '../../agent/src/server.js';
import { connectFleet, type ConnectedFleet } from '../src/remote/client.js';
import { bootAgent, connectToAgent, makeFixture, TOKEN, type RemoteFixture } from './remoteHelpers.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';

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

describe('the caps lane', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('asks once a minute, not once a tick', async () => {
    let calls = 0;
    const deps = { ...testDeps(), refreshCaps: async () => { calls += 1; } };
    const w = new FleetWatcher(deps, new Bus(), 2000);

    vi.useFakeTimers();
    await w.tick(); await w.tick(); await w.tick();
    expect(calls).toBe(1);

    // Less than the interval: must NOT fire yet. This is the assertion a
    // mutant that shrinks CAPS_REFRESH_MS (e.g. to 1ms) cannot survive — at
    // 30s elapsed a 1ms interval would already have fired.
    await vi.advanceTimersByTimeAsync(30_000);
    await w.tick();
    expect(calls).toBe(1);

    // Past the interval (61s total since the first call): must fire.
    await vi.advanceTimersByTimeAsync(31_000);
    await w.tick();
    expect(calls).toBe(2);
  });

  it('local mode has nothing to refresh and does not throw', async () => {
    const w = new FleetWatcher(testDeps(), new Bus(), 2000);
    await expect(w.tick()).resolves.not.toThrow();
  });

  it('fires exactly at the interval boundary, not only after it', async () => {
    let calls = 0;
    const deps = { ...testDeps(), refreshCaps: async () => { calls += 1; } };
    const w = new FleetWatcher(deps, new Bus(), 2000);

    vi.useFakeTimers();
    await w.tick();
    expect(calls).toBe(1);

    // Exactly the interval, not one tick past it. The gate is `>=`, so this
    // must fire; a boundary mutant that narrows it to `>` would not.
    await vi.advanceTimersByTimeAsync(60_000);
    await w.tick();
    expect(calls).toBe(2);
  });
});

/** A hand-rolled minimal agent: speaks hello/ready, then answers ANY `caps`
 *  request with a fixed, deliberately malformed `verbs` payload — something
 *  the real ccrc-agent, whose `caps` handler always sends a validated
 *  `string[]`, can never produce. Isolates `FleetClient.caps()`'s payload
 *  validation from the real agent's own guarantees (mirrors `fakeReadyAgent`
 *  in `remote-connect.test.ts`, but answers a `req` rather than just `hello`). */
function fakeCapsAgent(verbs: unknown): Promise<{ port: number; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
      const address = wss.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => res());
          }),
      });
    });
    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg: unknown = JSON.parse(raw.toString());
        if (typeof msg !== 'object' || msg === null) return;
        const m = msg as { t?: unknown; id?: unknown };
        if (m.t === 'hello') { ws.send(JSON.stringify({ t: 'ready', v: 1, ccdVerbs: [] })); return; }
        if (m.t === 'req' && typeof m.id === 'number') {
          ws.send(JSON.stringify({ t: 'res', id: m.id, ok: true, verbs }));
        }
      });
    });
  });
}

// The distinction the whole design rests on: `null` = no evidence, permit
// (keep whatever list already worked); `[]` = the fleet said it has no
// verbs, refuse everything. A malformed-but-well-formed-shaped `res` (agent
// answered, but `verbs` isn't a string array) must land on the `null` side,
// same as a transport failure — never on the `[]` side, which is reserved
// for an agent that genuinely replied with an empty list.
describe('caps() — a well-formed res with a malformed verbs field', () => {
  let server: { port: number; close(): Promise<void> } | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (server) await server.close();
    server = undefined;
  });

  it('verbs is not an array at all — resolves null, never []', async () => {
    server = await fakeCapsAgent('nope');
    fleet = connectFleet({ url: `ws://127.0.0.1:${server.port}`, token: TOKEN, heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const result = await fleet.client.caps();
    expect(result).toBeNull();
  });

  it('verbs is an array with non-string elements — resolves null, never []', async () => {
    server = await fakeCapsAgent([1, 2]);
    fleet = connectFleet({ url: `ws://127.0.0.1:${server.port}`, token: TOKEN, heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const result = await fleet.client.caps();
    expect(result).toBeNull();
  });
});
