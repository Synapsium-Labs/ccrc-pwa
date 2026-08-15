import { describe, it, expect, vi, afterEach } from 'vitest';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { RunningAgent } from '../../agent/src/server.js';
import { connectFleet, FleetClient, type ConnectedFleet } from '../src/remote/client.js';
import { TOKEN, bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';

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

    // `rosterFp: null` against a REAL agent, not a fake: the fixture home has
    // no `~/.ccrc/accounts.sh`, so the agent omits the field and the client
    // records no evidence. Absence-permits, proven across the actual wire.
    await vi.waitFor(
      () => expect(fleet!.state).toEqual({ connected: true, downSince: null, ccdVerbs: [], rosterFp: null }),
      { timeout: 3000 });
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

  it('records the agent-advertised ccd verbs on the fleet state', async () => {
    fixture = makeFixture();
    const bin = path.join(fixture.home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'ccd'), '#!/bin/sh\n[ "$1" = caps ] && printf "start\\nws-audit\\n"\n');
    chmodSync(path.join(bin, 'ccd'), 0o755);
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    expect(fleet.state.ccdVerbs).toEqual(['start', 'ws-audit']);
  });

  // `ccdVerbs` is `string[] | null`, and null means "we have no evidence" —
  // NEVER "the agent said there are no verbs". A real ccrc-agent always sends
  // a (possibly empty) array, so the "no evidence" branch only fires before
  // the first handshake, or against an agent old/broken enough to send
  // something else. Both are exercised below without a real agent.
  it('starts with ccdVerbs:null before any handshake — the class default, never []', () => {
    // Constructed but never `.start()`-ed: no socket, no network activity,
    // nothing to close. Isolates the initializer from connection lifecycle.
    const client = new FleetClient({ url: 'ws://127.0.0.1:1', token: 'unused' });
    expect(client.state.ccdVerbs).toBeNull();
  });
});

/** A hand-rolled minimal agent that only speaks the hello/ready handshake, so
 *  a `ready` frame with a missing or malformed `ccdVerbs` — something the
 *  real ccrc-agent, which always sends a validated `string[]`, can never
 *  produce — can still be driven through `FleetClient.onReady`. */
function fakeReadyAgent(readyExtra: Record<string, unknown>): Promise<{ port: number; close(): Promise<void> }> {
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
        if (typeof msg === 'object' && msg !== null && (msg as { t?: unknown }).t === 'hello') {
          ws.send(JSON.stringify({ t: 'ready', v: 1, ...readyExtra }));
        }
      });
    });
  });
}

describe('FleetClient.onReady — ccdVerbs validation distinguishes null from empty/malformed', () => {
  let server: { port: number; close(): Promise<void> } | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (server) await server.close();
    server = undefined;
  });

  it('an absent ccdVerbs field (older agent) is recorded as null, never []', async () => {
    server = await fakeReadyAgent({});
    fleet = connectFleet({ url: `ws://127.0.0.1:${server.port}`, token: TOKEN, heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    expect(fleet.state.ccdVerbs).toBeNull();
  });

  it('a malformed ccdVerbs (non-string elements) is discarded as null, never trusted partially', async () => {
    server = await fakeReadyAgent({ ccdVerbs: [1, 2, 3] });
    fleet = connectFleet({ url: `ws://127.0.0.1:${server.port}`, token: TOKEN, heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    expect(fleet.state.ccdVerbs).toBeNull();
  });

  it('a real empty array is recorded as [], distinct from the null "no evidence" case', async () => {
    server = await fakeReadyAgent({ ccdVerbs: [] });
    fleet = connectFleet({ url: `ws://127.0.0.1:${server.port}`, token: TOKEN, heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    expect(fleet.state.ccdVerbs).toEqual([]);
  });
});

describe('FleetClient.onReady — rosterFp keeps "no evidence" apart from a real digest', () => {
  let server: { port: number; close(): Promise<void> } | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (server) await server.close();
    server = undefined;
  });

  const connect = async (extra: Record<string, unknown>): Promise<ConnectedFleet> => {
    server = await fakeReadyAgent(extra);
    const f = connectFleet({ url: `ws://127.0.0.1:${server.port}`, token: TOKEN, heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(f.state.connected).toBe(true), { timeout: 3000 });
    return f;
  };

  it('records a reported digest verbatim', async () => {
    fleet = await connect({ rosterFp: 'a'.repeat(64) });
    expect(fleet.state.rosterFp).toBe('a'.repeat(64));
  });

  it('an absent rosterFp (older agent) is null — which the route reads as unknown, not divergent', async () => {
    fleet = await connect({});
    expect(fleet.state.rosterFp).toBeNull();
  });

  it.each([
    ['a non-string', { rosterFp: 42 }],
    ['an empty string', { rosterFp: '' }],
  ])('%s is discarded as null rather than compared', async (_label, extra) => {
    // An empty string would compare unequal to every real digest, so trusting
    // it would report DIVERGENT — the one answer an operator acts on — from a
    // frame that carried no information at all.
    fleet = await connect(extra);
    expect(fleet.state.rosterFp).toBeNull();
  });
});
