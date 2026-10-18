// Path-identity spec 2026-10-12 §5.2: "Every accepted ready and every close invalidates it synchronously." The
// client is where a ready is accepted, and its listeners run synchronously inside `onReady` (`setState`'s state
// listeners, then the connect listeners, index.ts's inventory trigger among them) and inside `onClose`
// (`markDown`'s state listeners). So the invalidation comes FIRST in each, or a listener reads the previous
// connection's node as known. `close()` never reaches `onClose`, so it invalidates on its own path. The agent is
// hand-rolled (`remote-connect.test.ts`'s `fakeReadyAgent`, reduced to its handshake), and no HOME is read.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { CurrentFleetIdentity } from '../src/fleetidentity.js';
import { connectFleet, FleetClient, type ConnectedFleet } from '../src/remote/client.js';

const U1 = '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
/** Fast reconnects, and no heartbeat inside a case. */
const FAST = { token: 'unused', reconnectMinMs: 30, reconnectMaxMs: 100, heartbeatMs: 60_000, requestTimeoutMs: 2_000 };
const AWAITING_1: CurrentFleetIdentity = { kind: 'unmeasured', connectionEpoch: 1, why: 'awaiting-inventory' };

/** Answers every hello with a bare ready, on every connection. */
function fakeReadyAgent(): Promise<{ port: number; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
      const address = wss.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        close: () => new Promise<void>((res) => {
          for (const c of wss.clients) c.terminate();
          wss.close(() => res());
        }),
      });
    });
    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg: unknown = JSON.parse(raw.toString());
        if (typeof msg === 'object' && msg !== null && (msg as { t?: unknown }).t === 'hello') {
          ws.send(JSON.stringify({ t: 'ready', v: 1 }));
        }
      });
    });
  });
}

describe('ready and close invalidate before any listener runs (§5.2)', () => {
  let agent: { port: number; close(): Promise<void> } | undefined;
  let client: FleetClient | undefined;
  let fleet: ConnectedFleet | undefined;
  afterEach(async () => {
    await client?.close();
    client = undefined;
    await fleet?.close();
    fleet = undefined;
    await agent?.close();
    agent = undefined;
  });

  /** A client to a fresh fake agent, NOT started, so a case registers its listeners before the first ready. */
  async function unstarted(): Promise<FleetClient> {
    agent = await fakeReadyAgent();
    client = new FleetClient({ url: `ws://127.0.0.1:${agent.port}`, ...FAST });
    return client;
  }

  it('a fresh client reads epoch 0', () => {
    // Constructed and never started: no socket, nothing to close.
    const c = new FleetClient({ url: 'ws://127.0.0.1:1', token: 'unused' });
    expect(c.identity.epochNow()).toBe(0);
    expect(c.identity.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 0, why: 'no-ready' });
  });

  it('after the handshake the identity is awaiting-inventory on a larger epoch', async () => {
    agent = await fakeReadyAgent();
    fleet = connectFleet({ url: `ws://127.0.0.1:${agent.port}`, ...FAST });
    expect(fleet.identity, "connectFleet hands out the client's own cell").toBe(fleet.client.identity);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    expect(fleet.identity.current()).toEqual(AWAITING_1);
  });

  it('a connect listener and a state listener both see the post-ready epoch', async () => {
    const c = await unstarted();
    const atState: CurrentFleetIdentity[] = [];
    const atConnect: CurrentFleetIdentity[] = [];
    c.onStateChange((s) => { if (s.connected) atState.push(c.identity.current()); });
    c.onConnected(() => { atConnect.push(c.identity.current()); });
    c.start();
    await vi.waitFor(() => expect(atConnect).toHaveLength(1), { timeout: 3000 });
    expect(atState, 'the state listener ran inside onReady before the invalidation').toEqual([AWAITING_1]);
    expect(atConnect, "the connect listener (index.ts's inventory trigger) ran before the invalidation").toEqual([AWAITING_1]);
  });

  it('a socket close invalidates before the connected:false notification', async () => {
    const c = await unstarted();
    const atDown: CurrentFleetIdentity[] = [];
    c.onStateChange((s) => { if (!s.connected) atDown.push(c.identity.current()); });
    c.start();
    await vi.waitFor(() => expect(c.state.connected).toBe(true), { timeout: 3000 });
    expect(c.identity.publish(c.identity.epochNow(), { kind: 'known', nodeId: U1, measuredAt: 5 })).toEqual({ kind: 'published' });
    c.ws?.close();
    await vi.waitFor(() => expect(atDown).toHaveLength(1), { timeout: 3000 });
    expect(atDown[0]).toEqual({ kind: 'unmeasured', connectionEpoch: 2, why: 'link-down' });
    // The reconnect's ready invalidates again: a node measured on the closed connection never comes back by itself.
    await vi.waitFor(() => expect(c.state.connected).toBe(true), { timeout: 3000 });
    expect(c.identity.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 3, why: 'awaiting-inventory' });
  });

  it('explicit close() invalidates', async () => {
    const c = await unstarted();
    c.start();
    await vi.waitFor(() => expect(c.state.connected).toBe(true), { timeout: 3000 });
    c.identity.publish(c.identity.epochNow(), { kind: 'known', nodeId: U1, measuredAt: 5 });
    await c.close();
    expect(c.identity.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 2, why: 'link-down' });
  });

  it("FleetState's whole-object shape is unchanged", async () => {
    const c = await unstarted();
    c.start();
    await vi.waitFor(() => expect(c.state.connected).toBe(true), { timeout: 3000 });
    // The epoch is the cell's, never a FleetState field: remote-connect.test.ts pins that object whole.
    expect(Object.keys(c.state).sort())
      .toEqual(['agentOps', 'build', 'ccdVerbs', 'connected', 'downSince', 'observedEpoch', 'rosterFp']);
  });
});
