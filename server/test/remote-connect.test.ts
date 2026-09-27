import { describe, it, expect, vi, afterEach } from 'vitest';
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { RunningAgent } from '../../agent/src/server.js';
import { connectFleet, FleetClient, readReadyOps, type ConnectedFleet } from '../src/remote/client.js';
import { MAX_CAP_WORDS } from '../../shared/api.js';
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

    // `rosterFp: null` and `build: null` against a REAL agent, not a fake: the
    // fixture home has neither `~/.ccrc/accounts.sh` nor `~/.ccrc/build.json`,
    // so the agent omits both fields and the client records no evidence for
    // either. Absence-permits, proven across the actual wire. WHOLE-OBJECT
    // equality on purpose — a field added to `FleetState` and never populated
    // by `onReady` fails here, which is the only check that does not depend on
    // someone remembering to assert the new field.
    //
    // `observedEpoch: null`, not omitted and not `undefined`: unlike
    // `rosterFp`/`build`, a real agent NEVER omits this field — the fixture
    // home has no `~/.cc-sessions/pool-epoch`, so `readObservedEpoch` answers
    // "never synced" (`null`), sent on the wire explicitly, not "no evidence".
    // `agentOps: []`, not absent: a REAL W2 agent sends no `ops` (the field is
    // W4's), and the client records "ready arrived, no op named" — `[]` — which
    // is not local mode's `undefined`. When W4's agent starts advertising
    // `['update']`, this literal is the line that must move with it.
    await vi.waitFor(
      () => expect(fleet!.state).toEqual({
        connected: true, downSince: null, ccdVerbs: [], rosterFp: null, build: null, observedEpoch: null,
        agentOps: [],
      }),
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

  it('starts with observedEpoch:undefined before any handshake — never null', () => {
    // The pre-handshake state is "no evidence at all", which is the ABSENT
    // condition (`undefined`), not "this node has synced never" (`null`) — a
    // fact only a real `ready` frame can assert. Getting this default wrong
    // in either direction is exactly the fold the whole field exists to
    // prevent: `null` here would read as a measured fact before any peer was
    // ever asked.
    const client = new FleetClient({ url: 'ws://127.0.0.1:1', token: 'unused' });
    expect(client.state.observedEpoch).toBeUndefined();
  });

  it('starts with agentOps:undefined before any handshake — "no evidence", not "no ops"', () => {
    // `[]` would claim a ready frame arrived and named nothing; before any
    // handshake nothing arrived at all (design 2026-09-20 §8, decision 11).
    const client = new FleetClient({ url: 'ws://127.0.0.1:1', token: 'unused' });
    expect(client.state.agentOps).toBeUndefined();
  });
});

/** A hand-rolled minimal agent that only speaks the hello/ready handshake, so
 *  a `ready` frame with a missing or malformed `ccdVerbs` — something the
 *  real ccrc-agent, which always sends a validated `string[]`, can never
 *  produce — can still be driven through `FleetClient.onReady`.
 *
 *  A FUNCTION may be passed instead of a literal, evaluated per handshake, so a
 *  test can make the SECOND connection answer differently from the first. That
 *  is the only way to reach a transition — a peer whose stamp becomes malformed
 *  between two `ready` frames — and a fresh-connection fixture cannot: it starts
 *  from a null state, so a reader that fails to reset has nothing stale to keep. */
function fakeReadyAgent(
  readyExtra: Record<string, unknown> | (() => Record<string, unknown>),
): Promise<{ port: number; close(): Promise<void> }> {
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
          const extra = typeof readyExtra === 'function' ? readyExtra() : readyExtra;
          ws.send(JSON.stringify({ t: 'ready', v: 1, ...extra }));
        }
      });
    });
  });
}

describe('FleetClient.request — every settlement releases its pending resources', () => {
  let wss: WebSocketServer | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await fleet?.close();
    fleet = undefined;
    if (wss) {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss!.close(() => resolve()));
    }
    wss = undefined;
  });

  it('aborts the request, clears its timer, and ignores a late response', async () => {
    let replyLate!: () => void;
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    wss = server;
    let requestSeen = false;
    server.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { t?: unknown; id?: unknown };
        if (msg.t === 'hello') {
          ws.send(JSON.stringify({ t: 'ready', v: 1 }));
        } else if (msg.t === 'req' && typeof msg.id === 'number') {
          replyLate = () => ws.send(JSON.stringify({ t: 'res', id: msg.id, ok: true, entries: [] }));
          requestSeen = true;
        }
      });
    });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    fleet = connectFleet({ url: `ws://127.0.0.1:${port}`, token: TOKEN, heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    vi.useFakeTimers();
    const request = fleet.client.request(
      { t: 'req', op: 'readdir', path: '/fleet/.cc-sessions/pools' },
      60_000,
      controller.signal,
    );
    void request.catch(() => {});
    const reachable = fleet.client as unknown as { pending: Map<number, unknown> };
    expect(reachable.pending.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(add, 'abort settlement relies on one-shot listener removal')
      .toHaveBeenCalledWith('abort', expect.any(Function), { once: true });

    controller.abort();
    await expect(request).rejects.toThrow('aborted');
    expect(reachable.pending.size).toBe(0);
    expect(vi.getTimerCount(), 'the aborted request must not retain its timeout').toBe(0);

    vi.useRealTimers();
    await vi.waitFor(() => expect(requestSeen).toBe(true), { timeout: 3000 });
    replyLate();
    await new Promise((resolve) => setImmediate(resolve));
    expect(reachable.pending.size).toBe(0);
  });

  it('detaches the abort listener when the request times out', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    wss = server;
    let noteRequestSeen!: () => void;
    const requestSeen = new Promise<void>((resolve) => { noteRequestSeen = resolve; });
    server.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { t?: unknown };
        if (msg.t === 'hello') ws.send(JSON.stringify({ t: 'ready', v: 1 }));
        else if (msg.t === 'req') noteRequestSeen();
      });
    });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    fleet = connectFleet({ url: `ws://127.0.0.1:${port}`, token: TOKEN, heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const request = fleet.client.request(
      { t: 'req', op: 'readdir', path: '/fleet/.cc-sessions/pools' },
      25,
      controller.signal,
    );
    await requestSeen;

    await expect(request).rejects.toThrow('timeout');
    expect(remove, 'timeout settlement must detach the caller-held abort listener')
      .toHaveBeenCalledTimes(1);
  });

  it('detaches the abort listener when a response settles the request', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    wss = server;
    server.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { t?: unknown; id?: unknown };
        if (msg.t === 'hello') {
          ws.send(JSON.stringify({ t: 'ready', v: 1 }));
        } else if (msg.t === 'req' && typeof msg.id === 'number') {
          ws.send(JSON.stringify({ t: 'res', id: msg.id, ok: true, entries: [] }));
        }
      });
    });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    fleet = connectFleet({ url: `ws://127.0.0.1:${port}`, token: TOKEN, heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await expect(fleet.client.request(
      { t: 'req', op: 'readdir', path: '/fleet/.cc-sessions/pools' },
      60_000,
      controller.signal,
    )).resolves.toMatchObject({ ok: true, entries: [] });
    expect(remove, 'response settlement must detach the caller-held abort listener')
      .toHaveBeenCalled();
  });

  it('detaches the abort listener when the socket disconnects', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    wss = server;
    let requestSocket: WebSocket | undefined;
    let noteRequestSeen!: () => void;
    const requestSeen = new Promise<void>((resolve) => { noteRequestSeen = resolve; });
    server.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { t?: unknown };
        if (msg.t === 'hello') {
          ws.send(JSON.stringify({ t: 'ready', v: 1 }));
        } else if (msg.t === 'req') {
          requestSocket = ws;
          noteRequestSeen();
        }
      });
    });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    fleet = connectFleet({
      url: `ws://127.0.0.1:${port}`,
      token: TOKEN,
      heartbeatMs: 60_000,
      reconnectMinMs: 60_000,
    });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const request = fleet.client.request(
      { t: 'req', op: 'readdir', path: '/fleet/.cc-sessions/pools' },
      60_000,
      controller.signal,
    );
    await requestSeen;
    requestSocket!.terminate();

    await expect(request).rejects.toThrow('disconnected');
    expect(remove, 'disconnect settlement must detach the caller-held abort listener')
      .toHaveBeenCalledTimes(1);
  });

  it('rejects a pre-aborted signal before registering a request, timer, or listener', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    wss = server;
    const requestFrames: unknown[] = [];
    server.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { t?: unknown };
        if (msg.t === 'hello') ws.send(JSON.stringify({ t: 'ready', v: 1 }));
        else if (msg.t === 'req') requestFrames.push(msg);
      });
    });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    fleet = connectFleet({ url: `ws://127.0.0.1:${port}`, token: TOKEN, heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const controller = new AbortController();
    controller.abort();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    vi.useFakeTimers();
    const timersBefore = vi.getTimerCount();
    const reachable = fleet.client as unknown as { pending: Map<number, unknown> };

    const request = fleet.client.request(
      { t: 'req', op: 'readdir', path: '/fleet/.cc-sessions/pools' },
      60_000,
      controller.signal,
    );
    void request.catch(() => {});

    expect(reachable.pending.size).toBe(0);
    expect(requestFrames).toEqual([]);
    expect(vi.getTimerCount()).toBe(timersBefore);
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    await expect(request).rejects.toThrow('aborted');
    vi.useRealTimers();
  });
});

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

describe('FleetClient.onReady — build is re-validated at the wire, never trusted', () => {
  // The peer is an agent on another box, deployed on its own lane and possibly
  // older, newer, or broken — so a stamp arriving on a frame is a claim, not a
  // fact. `onReady` re-validates it through `parseBuildInfo`, the SAME
  // definition of a well-formed stamp both boxes' disk readers use, rather than
  // casting the frame field. A real `ccrc-agent` sends only stamps that already
  // passed that check (`agent/test/build-fp.test.ts`), so a fake agent is the
  // only way to reach these branches at all — and without them, replacing the
  // parse with `frame.build as BuildInfo` would leave every suite green while
  // putting a half-stamp into the skew comparison.
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

  const STAMP = { sha: 'abc1234', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false };

  it('records a well-formed stamp verbatim, dirty flag and all', async () => {
    fleet = await connect({ build: { ...STAMP, dirty: true } });
    expect(fleet.state.build).toEqual({ ...STAMP, dirty: true });
  });

  it('an absent build (older agent) is null — which the route reads as unknown, not skewed', async () => {
    fleet = await connect({});
    expect(fleet.state.build).toBeNull();
  });

  it.each([
    ['a half-stamp missing sha', { build: { ref: 'main', builtAt: 'x', dirty: false } }],
    ['a stamp with a numeric sha', { build: { ...STAMP, sha: 42 } }],
    ['a stamp with an EMPTY sha', { build: { ...STAMP, sha: '' } }],
    ['a non-object', { build: 42 }],
    ['an explicit null', { build: null }],
  ])('%s is discarded as null rather than compared', async (_label, extra) => {
    // The empty sha is the one that fails safe-looking: two boxes both
    // reporting `sha: ''` compare EQUAL, so a trusted one would report
    // "the builds agree" from two files neither box could read — silence
    // exactly where this field exists to end silence.
    fleet = await connect(extra);
    expect(fleet.state.build).toBeNull();
  });

  it('a peer that starts sending a MALFORMED stamp on RECONNECT drops the one it had', async () => {
    // The reset-on-every-ready guard, on the transition the fresh-connection
    // cases above structurally cannot reach. Each of them starts from a client
    // whose `state.build` is already null, so a reader that kept its previous
    // value on a failed parse — `parseBuildInfo(…) ?? this.state.build`, one
    // character of defensiveness away from what is written — behaves
    // identically to the correct one and every test stays green.
    //
    // Nor can the end-to-end suite reach it (`fleet-build-skew.test.ts`): a real
    // agent OMITS the key when its own stamp will not parse, so the malformed
    // value never crosses the wire from a real peer at all. Only a fake agent
    // that answers the second handshake differently from the first gets there,
    // and the condition is real — an agent redeployed onto a box whose
    // `build.json` write was torn, or rolled forward to a build that writes the
    // file differently. A client that kept the old stamp would keep answering
    // with the sha of a build nobody is running, indistinguishable from a live
    // measurement, which is exactly what this guard exists to prevent.
    //
    // `state.build` can only become null again through a fresh `onReady` —
    // `onClose` does not touch it — so waiting on null is waiting on the
    // handshake, never on the disconnect.
    let extra: Record<string, unknown> = { build: { ...STAMP } };
    server = await fakeReadyAgent(() => extra);
    fleet = connectFleet({
      url: `ws://127.0.0.1:${server.port}`, token: TOKEN, heartbeatMs: 60_000,
      reconnectMinMs: 30, reconnectMaxMs: 100,
    });
    await vi.waitFor(() => expect(fleet!.state.build).toEqual(STAMP), { timeout: 3000 });

    extra = { build: { ...STAMP, sha: '' } };
    fleet.client.ws?.close();
    await vi.waitFor(() => expect(fleet!.state.build).toBeNull(), { timeout: 3000 });
  });
});

describe('FleetClient.onReady — observedEpoch keeps THREE answers apart, never two', () => {
  // A real `ccrc-agent` never omits this field (`agent/test/observed-epoch.test.ts`
  // pins that) — it always answers a number or `null`. Only a fake agent old
  // enough to skip the field at all reaches the "absent" branch, exactly the
  // way `rosterFp`/`build`'s fake-agent describe blocks above reach theirs.
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

  it('records a reported number verbatim', async () => {
    fleet = await connect({ observedEpoch: 43 });
    expect(fleet.state.observedEpoch).toBe(43);
  });

  it('records epoch 0 as 0 — a real, measured epoch, not "no evidence"', async () => {
    fleet = await connect({ observedEpoch: 0 });
    expect(fleet.state.observedEpoch).toBe(0);
  });

  it('records an explicit null as null — "this node has synced never", a fact, not an absence', async () => {
    fleet = await connect({ observedEpoch: null });
    expect(fleet.state.observedEpoch).toBeNull();
  });

  // THE MUTATION THIS TASK NAMES: an absent field (an older agent) and an
  // explicit `null` (a real "never synced" report) MUST read as two different
  // values on `fleetState`. A reader using `== null` to test absence would
  // pass every other test in this file (both branches assign a nullish-ish
  // value) and fail only here, where the two conditions are asserted apart in
  // the SAME test.
  it('an absent field and an explicit null are NOT the same value', async () => {
    const absent = await connect({});
    expect(absent.state.observedEpoch).toBeUndefined();
    await absent.close();

    const neverSynced = await connect({ observedEpoch: null });
    expect(neverSynced.state.observedEpoch).toBeNull();

    expect(absent.state.observedEpoch).not.toBe(neverSynced.state.observedEpoch);
  });

  it.each([
    ['a string', { observedEpoch: '43' }],
    ['a boolean', { observedEpoch: true }],
    ['an array', { observedEpoch: [43] }],
    ['an object', { observedEpoch: { epoch: 43 } }],
    // Review T8-R1, F4: a JSON *number* is not automatically a well-formed
    // one — `build`'s own comment three lines below states the doctrine this
    // reader must also follow: "the peer may be older, newer, or broken."
    // `ccd-pool-sync`'s own writer rejects both of these before ever
    // rendering a document (`ccd-pool-sync:163`, `:186`).
    ['a negative number', { observedEpoch: -1 }],
    ['a non-integer number', { observedEpoch: 4.5 }],
  ])('%s off the wire contract is discarded as undefined, not fabricated into a number', async (_label, extra) => {
    fleet = await connect(extra);
    expect(fleet.state.observedEpoch).toBeUndefined();
  });

  it('a peer that stops reporting on RECONNECT drops the epoch it had, not keeps it', async () => {
    // Same reset-on-every-ready guard as `build`'s reconnect test above,
    // proven on the branch a fresh connection cannot reach: a client whose
    // `state.observedEpoch` already holds a real number, reconnecting to a
    // peer that now omits the field entirely (a downgrade). A reader that
    // kept the stale number would report a fleet host as caught up to an
    // epoch it can no longer even claim.
    let extra: Record<string, unknown> = { observedEpoch: 43 };
    server = await fakeReadyAgent(() => extra);
    fleet = connectFleet({
      url: `ws://127.0.0.1:${server.port}`, token: TOKEN, heartbeatMs: 60_000,
      reconnectMinMs: 30, reconnectMaxMs: 100,
    });
    await vi.waitFor(() => expect(fleet!.state.observedEpoch).toBe(43), { timeout: 3000 });

    extra = {};
    fleet.client.ws?.close();
    await vi.waitFor(() => expect(fleet!.state.observedEpoch).toBeUndefined(), { timeout: 3000 });
  });
});

describe('readReadyOps — the ONE validator of AgentReady.ops (design 2026-09-20 §8)', () => {
  // §8: "`caps` and `agentOps` words must match `CAP_WORD` with at most 32
  // words, and one bad word drops the whole file to ''". The inventory stores
  // `[]` as `''`; the server row's NULL is the sweep's, never this reader's.
  it.each<[string, unknown, string[]]>([
    ['absent (every agent before W4)', undefined, []],
    ['null', null, []],
    ['a bare string', 'update', []],
    ['an object', { update: true }, []],
    ['an empty list', [], []],
    ['one valid word', ['update'], ['update']],
    ['two valid words', ['update', 'rollback'], ['update', 'rollback']],
    ['one word off CAP_WORD drops the whole list', ['update', 'Update'], []],
    ['a word with a space', ['update now'], []],
    ['a non-string element', ['update', 1], []],
    ['a 33-character word', ['a'.repeat(33)], []],
  ])('%s', (_label, raw, want) => {
    expect(readReadyOps(raw)).toEqual(want);
  });

  it('exactly MAX_CAP_WORDS words pass; one more drops them all', () => {
    const words = (n: number): string[] => Array.from({ length: n }, (_, i) => `op-${i}`);
    expect(readReadyOps(words(MAX_CAP_WORDS))).toEqual(words(MAX_CAP_WORDS));
    expect(readReadyOps(words(MAX_CAP_WORDS + 1))).toEqual([]);
  });
});

describe('FleetClient.onReady — ops is read through readReadyOps, on every ready', () => {
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

  it('an absent ops (every agent before W4) is [] — connected, no op named', async () => {
    fleet = await connect({});
    expect(fleet.state.agentOps).toEqual([]);
  });

  it('a valid list is recorded verbatim', async () => {
    fleet = await connect({ ops: ['update'] });
    expect(fleet.state.agentOps).toEqual(['update']);
  });

  it('one bad word off the wire drops the whole list — never a partial', async () => {
    fleet = await connect({ ops: ['update', 'RM -RF'] });
    expect(fleet.state.agentOps).toEqual([]);
  });

  it('a peer that stops sending ops on RECONNECT drops what it had, not keeps it', async () => {
    // The reset-on-every-ready guard, on the branch a fresh connection cannot
    // reach: a W4 agent downgraded to a W2 one must not keep being sent an op
    // it no longer answers.
    let extra: Record<string, unknown> = { ops: ['update'] };
    server = await fakeReadyAgent(() => extra);
    fleet = connectFleet({
      url: `ws://127.0.0.1:${server.port}`, token: TOKEN, heartbeatMs: 60_000,
      reconnectMinMs: 30, reconnectMaxMs: 100,
    });
    await vi.waitFor(() => expect(fleet!.state.agentOps).toEqual(['update']), { timeout: 3000 });
    extra = {};
    fleet.client.ws?.close();
    await vi.waitFor(() => expect(fleet!.state.agentOps).toEqual([]), { timeout: 3000 });
  });
});

describe('the ~/.ccrc node files over a REAL agent — what the inventory sweep reads (design 2026-09-20 §8)', () => {
  // The server's remote FleetIO against the real agent's checkPath, over a real
  // loopback WS: the path Task 11's sweep takes for the fleet node. Fixture
  // HOMEs only.
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

  const open = async (): Promise<string> => {
    fixture = makeFixture();
    const ccrc = path.join(fixture.home, '.ccrc');
    mkdirSync(ccrc, { recursive: true });
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port, { heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    return ccrc;
  };

  it('a node file reads, stats and lstats; an unwritten one is ABSENT; the secret beside them is refused', async () => {
    const ccrc = await open();
    writeFileSync(path.join(ccrc, 'build.json'), '{"sha":"abc"}\n');
    writeFileSync(path.join(ccrc, 'agent.env'), 'CCRC_AGENT_TOKEN=not-for-the-wire\n');
    const stamp = path.join(ccrc, 'build.json');
    expect(await fleet!.io.readFileMeasured(stamp)).toEqual({ ok: true, content: '{"sha":"abc"}\n' });
    expect(await fleet!.io.statMeasured(stamp)).toMatchObject({ ok: true, size: 14 });
    expect(await fleet!.io.lstatMeasured(stamp)).toEqual({ ok: true, kind: 'regular' });
    expect(await fleet!.io.readFileMeasured(path.join(ccrc, 'node-id'))).toEqual({ ok: false, reason: 'absent' });
    expect(await fleet!.io.readFileMeasured(path.join(ccrc, 'agent.env'))).toEqual({ ok: false, reason: 'unreadable' });
    expect(await fleet!.io.readdir(ccrc)).toBeNull();
  });

  it('a live symlink carrying a node-file name is never followed — refused over read and lstat alike', async () => {
    const ccrc = await open();
    writeFileSync(path.join(ccrc, 'agent.env'), 'CCRC_AGENT_TOKEN=not-for-the-wire\n');
    writeFileSync(path.join(ccrc, 'installed'), 'abc\n');
    symlinkSync(path.join(ccrc, 'agent.env'), path.join(ccrc, 'build.json'));
    symlinkSync(path.join(ccrc, 'installed'), path.join(ccrc, 'floor'));
    for (const name of ['build.json', 'floor']) {
      const p = path.join(ccrc, name);
      expect(await fleet!.io.readFileMeasured(p), name).toEqual({ ok: false, reason: 'unreadable' });
      // `unmeasured`, never `regular`: the agent refuses the lstat outright
      // (`forbidden`) and the remote io reports a refused lstat as `unmeasured`
      // (`remote/io.ts`'s `lstatMeasured`), which the sweep folds to
      // `unreadable` (D-3178). `regular` for `floor` is the
      // regression the literal-basename rule exists to stop.
      expect(await fleet!.io.lstatMeasured(p), name).toEqual({ ok: false, reason: 'unmeasured' });
    }
  });

  it('a DANGLING symlink carrying a node-file name lstats as `symlink` — the kind the sweep refuses', async () => {
    const ccrc = await open();
    symlinkSync(path.join(ccrc, 'no-such-target'), path.join(ccrc, 'update.json'));
    expect(await fleet!.io.lstatMeasured(path.join(ccrc, 'update.json'))).toEqual({ ok: true, kind: 'symlink' });
  });
});
