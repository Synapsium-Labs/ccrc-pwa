import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { connectFleet, type ConnectedFleet } from '../src/remote/client.js';
import { AgentOpError, LinkNotSentError } from '../src/remote/errors.js';
import { UPDATE_OP_DETAIL_MAX } from '../../shared/agent-protocol.js';
import { TOKEN } from './remoteHelpers.js';

// D-7507 (ARCH-05): the agent link's two error classes, `AgentOpError` (D-3373, D-3391) and `LinkNotSentError`
// (D-3555), held by what a caller can see of them, so the move to `remote/errors.ts` is proven not to change one.
// The `update/converge.ts`, `token/link.ts` and `accounts/ops.ts` deciders read both by `instanceof`, so the
// classes a `FleetClient` request rejects with are pinned here too, through a fake agent on a loopback socket.

describe('the agent link error classes, as a caller sees them (D-7507)', () => {
  it('AgentOpError: name, message (the word), code and detail; an Error', () => {
    const e = new AgentOpError('busy', 'update.json says installing');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(AgentOpError);
    expect(e.name).toBe('AgentOpError');
    expect(e.message).toBe('busy');
    expect(e.code).toBe('busy');
    expect(e.detail).toBe('update.json says installing');
  });

  it('AgentOpError: an absent detail reads null', () => {
    const e = new AgentOpError('spawn-failed', null);
    expect(e).toMatchObject({ name: 'AgentOpError', message: 'spawn-failed', code: 'spawn-failed', detail: null });
  });

  it('LinkNotSentError: name and message; an Error, and never an AgentOpError', () => {
    const e = new LinkNotSentError('disconnected');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(LinkNotSentError);
    expect(e).not.toBeInstanceOf(AgentOpError);
    expect(e.name).toBe('LinkNotSentError');
    expect(e.message).toBe('disconnected');
    expect(new AgentOpError('busy', null)).not.toBeInstanceOf(LinkNotSentError);
  });
});

/** A fake agent: answers `hello` with `ready`, and each `req` with `answer(req)` as a `res` frame. */
function fakeAgent(answer: (req: Record<string, unknown>) => Record<string, unknown>): Promise<{ port: number; wss: WebSocketServer }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
      const address = wss.address();
      resolve({ port: typeof address === 'object' && address !== null ? address.port : 0, wss });
    });
    wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.t === 'hello') { ws.send(JSON.stringify({ t: 'ready', v: 1 })); return; }
        if (msg.t === 'req') ws.send(JSON.stringify({ t: 'res', id: msg.id, ...answer(msg) }));
      });
    });
  });
}

/** The rejection itself, as a value: a resolution is a failure of the case. */
const rejection = (p: Promise<unknown>): Promise<unknown> =>
  p.then(() => { throw new Error('the request resolved'); }, (e: unknown) => e);

describe('what a FleetClient request rejects with (D-7507)', () => {
  let wss: WebSocketServer | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (wss) {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss!.close(() => resolve()));
    }
    wss = undefined;
  });

  it('no ready link at the call: a LinkNotSentError whose message is disconnected', async () => {
    fleet = connectFleet({ url: 'ws://127.0.0.1:1', token: TOKEN, heartbeatMs: 60_000, reconnectMinMs: 60_000 });
    const e = await rejection(fleet.client.request({ t: 'req', op: 'caps' }));
    expect(e).toBeInstanceOf(LinkNotSentError);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(AgentOpError);
    expect(e).toMatchObject({ name: 'LinkNotSentError', message: 'disconnected' });
  });

  it("an agent ResErr: an AgentOpError carrying the agent's word and its detail, cut to UPDATE_OP_DETAIL_MAX", async () => {
    const agent = await fakeAgent(() => ({ ok: false, err: 'spawn-failed', detail: 'y'.repeat(UPDATE_OP_DETAIL_MAX + 50) }));
    wss = agent.wss;
    fleet = connectFleet({ url: `ws://127.0.0.1:${agent.port}`, token: TOKEN, heartbeatMs: 60_000, reconnectMinMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    const e = await rejection(fleet.client.request({ t: 'req', op: 'update', tag: 'v0.0.9' }));
    expect(e).toBeInstanceOf(AgentOpError);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(LinkNotSentError);
    expect(e).toMatchObject({ name: 'AgentOpError', message: 'spawn-failed', code: 'spawn-failed', detail: 'y'.repeat(UPDATE_OP_DETAIL_MAX) });
  });

  it('an agent ResErr with no detail: an AgentOpError whose detail is null', async () => {
    const agent = await fakeAgent(() => ({ ok: false, err: 'busy' }));
    wss = agent.wss;
    fleet = connectFleet({ url: `ws://127.0.0.1:${agent.port}`, token: TOKEN, heartbeatMs: 60_000, reconnectMinMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    const e = await rejection(fleet.client.request({ t: 'req', op: 'update', tag: 'v0.0.9' }));
    expect(e).toBeInstanceOf(AgentOpError);
    expect(e).toMatchObject({ code: 'busy', detail: null });
  });
});
