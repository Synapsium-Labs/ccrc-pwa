import WebSocket from 'ws';
import type {
  AgentReq,
  PtyClose,
  PtyData,
  PtyExit,
  PtyInput,
  PtyResize,
  ResOk,
  TailData,
  TailReset,
} from '../../../shared/agent-protocol.js';
import { parseBuildInfo } from '../../../shared/buildinfo.js';
import type { Runner } from '../exec.js';
import type { FleetState } from '../fleetstate.js';
import type { FleetIO } from '../io.js';
import type { SpawnPty } from '../pty.js';
import { createRunner } from './runner.js';
import { createIo } from './io.js';
import { createSpawnPty } from './pty.js';

/**
 * Single authenticated WS connection to a `ccrc-agent` on a REMOTE fleet
 * host, wrapped in reconnect-with-backoff + heartbeat so the rest of the
 * server (Runner/FleetIO consumers) never has to think about the transport.
 * `connectFleet` is the public entry point — it wires this client into the
 * `Runner`/`FleetIO`/`SpawnPty` seams the rest of the server already speaks.
 */

/** `Omit<AgentReq, 'id'>` distributed per-member — a plain `Omit` over the
 *  union would collapse to only the fields common to every request shape. */
type AgentReqPayload = AgentReq extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export interface RemoteFleetConfig {
  url: string;
  token: string;
  /** ms between heartbeat pings while connected. Default 15000. */
  heartbeatMs?: number;
  /** initial reconnect delay. Default 1000. */
  reconnectMinMs?: number;
  /** reconnect delay ceiling (doubles each failed attempt up to this). Default 30000. */
  reconnectMaxMs?: number;
  /** default per-request local wait timeout when a call site doesn't override it. Default 15000. */
  requestTimeoutMs?: number;
}

type ResolvedConfig = Required<RemoteFleetConfig>;

// Re-exported so every importer of `FleetState` from `remote/client.js` keeps
// working unchanged now that this module no longer declares its own copy.
// Disclosed rather than pinned: as of this change nothing in this tree
// imports `FleetState` from here yet (every current call site — server.ts,
// fleet-health.test.ts — reaches it via `fleetstate.js` directly), so no test
// or tsc error currently distinguishes this line from its own deletion. It
// exists for the callers this split was done for: `ccdargv.ts`'s
// `Pick<FleetState, 'ccdVerbs'>` and the `verbSupported(deps.fleetState, …)`
// call sites landing in later tasks.
export type { FleetState };

interface Pending { resolve: (v: ResOk) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

type TailListener = (msg: TailData | TailReset) => void;
type PtyListener = (msg: PtyData | PtyExit) => void;

const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_RECONNECT_MIN_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const HEARTBEAT_MISS_LIMIT = 2;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Owns exactly one logical connection to the agent — a fresh `WebSocket` per
 * attempt, hello/ready handshake, a request table keyed by numeric id
 * (ids are never reused across reconnects; not required to be — every
 * in-flight request is rejected the moment its socket goes away), a
 * heartbeat that force-closes a silently-dead socket, and exponential
 * reconnect backoff. `state`/`onStateChange` surface connectivity to
 * callers; `onTail`/`offTail`/`onConnected` are the internal seam
 * `remote/io.ts` (and, from T4, `remote/pty.ts`) build on.
 */
export class FleetClient {
  readonly state: FleetState = {
    connected: false, downSince: null, ccdVerbs: null, rosterFp: null, build: null,
  };

  private readonly cfg: ResolvedConfig;
  private socket: WebSocket | null = null;
  private ready = false;
  private everConnected = false;
  private closed = false;
  private nextId = 1;
  private backoffMs: number;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private awaitingPong = false;
  private missedPongs = 0;

  private readonly pending = new Map<number, Pending>();
  private readonly tailListeners = new Map<number, TailListener>();
  private readonly ptyListeners = new Map<number, PtyListener>();
  private readonly stateListeners = new Set<(s: FleetState) => void>();
  private readonly connectListeners = new Set<(isReconnect: boolean) => void>();

  constructor(cfg: RemoteFleetConfig) {
    this.cfg = {
      url: cfg.url,
      token: cfg.token,
      heartbeatMs: cfg.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      reconnectMinMs: cfg.reconnectMinMs ?? DEFAULT_RECONNECT_MIN_MS,
      reconnectMaxMs: cfg.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS,
      requestTimeoutMs: cfg.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    };
    this.backoffMs = this.cfg.reconnectMinMs;
  }

  start(): void {
    if (this.closed) return;
    this.connect();
  }

  onStateChange(cb: (s: FleetState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  /** Exposes the live socket only so a test can kill it out from under the
   *  client to force a reconnect (`fleet.client.ws?.close()`) — everything
   *  else should go through `request`/`sendPty`, not this. */
  get ws(): WebSocket | null {
    return this.socket;
  }

  /**
   * Fires on EVERY successful handshake — including the very first one — so
   * `remote/io.ts` can (re)establish a tail subscription no matter when
   * `tailFile()` was called relative to the connection lifecycle.
   * `isReconnect` is true only from the second handshake onward: the first
   * connect this client instance ever makes is never a "reconnect", so
   * callers shouldn't treat it as a resync point.
   */
  onConnected(cb: (isReconnect: boolean) => void): () => void {
    this.connectListeners.add(cb);
    return () => this.connectListeners.delete(cb);
  }

  onTail(tailId: number, cb: TailListener): void {
    this.tailListeners.set(tailId, cb);
  }

  offTail(tailId: number): void {
    this.tailListeners.delete(tailId);
  }

  onPty(ptyId: number, cb: PtyListener): void {
    this.ptyListeners.set(ptyId, cb);
  }

  offPty(ptyId: number): void {
    this.ptyListeners.delete(ptyId);
  }

  /** Fire-and-forget pty control frames (input/resize/close) — these carry
   *  a `ptyId`, not a request `id`, and expect no `res` reply, so they skip
   *  the request/pending-table machinery entirely. Silently dropped when
   *  disconnected, same stance as `tailClose` on a dead socket. */
  sendPty(msg: PtyInput | PtyResize | PtyClose): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  request(payload: AgentReqPayload, timeoutMs?: number): Promise<ResOk> {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('disconnected'));
    }
    const ws = this.socket;
    const id = this.nextId++;
    const wait = timeoutMs ?? this.cfg.requestTimeoutMs;
    return new Promise<ResOk>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('timeout'));
      }, wait);
      this.pending.set(id, { resolve, reject, timer });
      const req = { ...payload, t: 'req', id } as AgentReq;
      ws.send(JSON.stringify(req));
    });
  }

  /** `null` means "no answer to trust" — an agent that predates the op replies
   *  `bad-request` (its `validateReq` rejects unknown ops before `handleReq`),
   *  and a transport failure looks the same. Neither is evidence the fleet has
   *  no verbs, so neither may overwrite a list that worked. */
  async caps(): Promise<string[] | null> {
    try {
      const res = await this.request({ t: 'req', op: 'caps' });
      const verbs = (res as { verbs?: unknown }).verbs;
      if (!Array.isArray(verbs) || !verbs.every((v) => typeof v === 'string')) return null;
      return verbs as string[];
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.rejectAllPending(new Error('disconnected'));
    this.tailListeners.clear();
    this.ptyListeners.clear();
    const ws = this.socket;
    this.socket = null;
    this.ready = false;
    if (!ws) return;
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.terminate();
    });
  }

  private connect(): void {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.cfg.url);
    } catch {
      this.markDown();
      this.scheduleReconnect();
      return;
    }
    this.socket = ws;
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', token: this.cfg.token }));
    });
    ws.on('message', (raw) => this.onMessage(ws, raw));
    ws.on('close', () => this.onClose(ws));
    ws.on('error', () => {
      // 'close' always follows 'error' for a ws socket — reconnect logic lives there.
    });
  }

  private onMessage(ws: WebSocket, raw: WebSocket.RawData): void {
    if (ws !== this.socket) return; // stale listener from an already-replaced socket
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!isRecord(msg)) return;

    if (msg.t === 'ready') {
      this.onReady(msg);
      return;
    }
    if (msg.t === 'pong') {
      this.awaitingPong = false;
      this.missedPongs = 0;
      return;
    }
    if (msg.t === 'res') {
      const id = msg.id;
      if (typeof id !== 'number') return;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (msg.ok === false) {
        entry.reject(new Error(typeof msg.err === 'string' ? msg.err : 'error'));
      } else {
        entry.resolve(msg as unknown as ResOk);
      }
      return;
    }
    if (msg.t === 'tail') {
      const tailId = msg.tailId;
      if (typeof tailId !== 'number') return;
      this.tailListeners.get(tailId)?.(msg as unknown as TailData | TailReset);
      return;
    }
    if (msg.t === 'pty') {
      const ptyId = msg.ptyId;
      if (typeof ptyId !== 'number') return;
      this.ptyListeners.get(ptyId)?.(msg as unknown as PtyData | PtyExit);
    }
  }

  private onReady(frame: Record<string, unknown>): void {
    this.ready = true;
    // Mutated directly rather than pushed through setState, whose change
    // detection compares only connected/downSince — a reconnect to an upgraded
    // agent must still refresh this.
    this.state.ccdVerbs = Array.isArray(frame.ccdVerbs)
      && frame.ccdVerbs.every((v) => typeof v === 'string')
      ? (frame.ccdVerbs as string[]) : null;
    // Same stance, same reason: a frame without a usable `rosterFp` — an older
    // agent, or a fleet host with no readable projection — leaves us with NO
    // evidence, which must not read as disagreement. Reset on every ready so a
    // reconnect to a redeployed fleet host cannot keep answering with the
    // digest of the roster it used to have.
    this.state.rosterFp = typeof frame.rosterFp === 'string' && frame.rosterFp.length > 0
      ? frame.rosterFp : null;
    // THE SINGLE READER of `frame.build` — the fleet host's own stamp, which
    // `buildAgreement` compares against this box's. Reset on every ready for
    // the same reason as `rosterFp`: a stamp kept from the previous connection
    // would keep reporting skew after the lagging box was deployed, so the
    // operator does the remedy and the banner stays lit.
    //
    // Validated HERE and not trusted because it came from an agent: this is a
    // wire boundary like any other, and the peer may be older, newer, or
    // broken. Validated by re-serialising through `parseBuildInfo` — the ONE
    // definition of a well-formed stamp, which both boxes' disk readers already
    // use — rather than by a field check written a third time here. Two
    // validators that drifted by one field would have this comparison reporting
    // on its own validators (`shared/buildinfo.ts` says why, and
    // `single-definition.test.ts` fails the build over a second copy). The
    // round-trip is exact and cannot throw: `frame` came out of `JSON.parse`,
    // so every value in it is JSON-representable — no cycles, no BigInt, no
    // undefined members.
    this.state.build = frame.build === undefined || frame.build === null
      ? null : parseBuildInfo(JSON.stringify(frame.build));
    // Only the SECOND+ successful handshake is a "reconnect" — `everConnected`
    // (unlike `state.connected`, which starts false) distinguishes "first
    // connect ever" from "came back after a drop".
    const isReconnect = this.everConnected;
    this.everConnected = true;
    this.backoffMs = this.cfg.reconnectMinMs;
    this.setState({ connected: true, downSince: null });
    this.startHeartbeat();
    for (const cb of this.connectListeners) cb(isReconnect);
  }

  private onClose(ws: WebSocket): void {
    if (ws !== this.socket) return; // a stale handler for a socket we already replaced
    this.socket = null;
    this.ready = false;
    this.stopHeartbeat();
    this.rejectAllPending(new Error('disconnected'));
    // The agent kills every open pty on disconnect (per its own connection-
    // close handler) — synthesize the same `exit` locally for anything still
    // registered so a `RemotePty` never hangs waiting for a frame the dead
    // socket can no longer deliver. Any pty a caller re-opens after this
    // reconnects gets a fresh ptyId from the agent, same as tail resubscribe.
    for (const [ptyId, cb] of this.ptyListeners) {
      cb({ t: 'pty', ptyId, ev: 'exit' });
    }
    this.ptyListeners.clear();
    this.markDown();
    if (this.closed) return;
    this.scheduleReconnect();
  }

  private markDown(): void {
    if (this.state.connected || this.state.downSince === null) {
      this.setState({ connected: false, downSince: this.state.downSince ?? Date.now() });
    }
  }

  /** Connectivity only, by design: the handshake fields (`ccdVerbs`,
   *  `rosterFp`, `build`) arrive on the ready frame and are assigned in
   *  `onReady`, not patched through here — this function's change detection
   *  compares connected/downSince and would suppress an update that touched
   *  only one of them. */
  private setState(patch: Pick<FleetState, 'connected' | 'downSince'>): void {
    if (patch.connected === this.state.connected && patch.downSince === this.state.downSince) return;
    this.state.connected = patch.connected;
    this.state.downSince = patch.downSince;
    for (const cb of this.stateListeners) cb(this.state);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.cfg.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private rejectAllPending(err: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.awaitingPong = false;
    this.missedPongs = 0;
    this.heartbeatTimer = setInterval(() => {
      if (this.awaitingPong) {
        this.missedPongs++;
        if (this.missedPongs >= HEARTBEAT_MISS_LIMIT) {
          this.socket?.terminate(); // -> 'close' -> reconnect
          return;
        }
      }
      this.awaitingPong = true;
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ t: 'ping' }));
      }
    }, this.cfg.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

export interface ConnectedFleet {
  /** The underlying client — `caps()` (refresh) and, in tests, `ws` (force a
   *  reconnect) live here rather than being re-exposed one seam up. */
  client: FleetClient;
  runner: Runner;
  io: FleetIO;
  spawnPty: SpawnPty;
  state: FleetState;
  onStateChange(cb: (s: FleetState) => void): () => void;
  close(): Promise<void>;
}

export function connectFleet(cfg: RemoteFleetConfig): ConnectedFleet {
  const client = new FleetClient(cfg);
  client.start();
  return {
    client,
    runner: createRunner(client),
    io: createIo(client),
    spawnPty: createSpawnPty(client),
    state: client.state,
    onStateChange: (cb) => client.onStateChange(cb),
    close: () => client.close(),
  };
}
