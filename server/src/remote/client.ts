import WebSocket from 'ws';
import type { AgentReq, ResOk, TailData, TailReset } from '../../../shared/agent-protocol.js';
import type { Runner } from '../exec.js';
import type { FleetIO } from '../io.js';
import type { SpawnPty } from '../pty.js';
import { createRunner } from './runner.js';
import { createIo } from './io.js';

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

export interface FleetState { connected: boolean; downSince: number | null }

interface Pending { resolve: (v: ResOk) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

type TailListener = (msg: TailData | TailReset) => void;

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
  readonly state: FleetState = { connected: false, downSince: null };

  private readonly cfg: ResolvedConfig;
  private ws: WebSocket | null = null;
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

  request(payload: AgentReqPayload, timeoutMs?: number): Promise<ResOk> {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('disconnected'));
    }
    const ws = this.ws;
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

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.rejectAllPending(new Error('disconnected'));
    this.tailListeners.clear();
    const ws = this.ws;
    this.ws = null;
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
    this.ws = ws;
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
    if (ws !== this.ws) return; // stale listener from an already-replaced socket
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!isRecord(msg)) return;

    if (msg.t === 'ready') {
      this.onReady();
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
    }
    // 'pty' data/exit frames are ignored here until T4 wires pty routing in.
  }

  private onReady(): void {
    this.ready = true;
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
    if (ws !== this.ws) return; // a stale handler for a socket we already replaced
    this.ws = null;
    this.ready = false;
    this.stopHeartbeat();
    this.rejectAllPending(new Error('disconnected'));
    this.markDown();
    if (this.closed) return;
    this.scheduleReconnect();
  }

  private markDown(): void {
    if (this.state.connected || this.state.downSince === null) {
      this.setState({ connected: false, downSince: this.state.downSince ?? Date.now() });
    }
  }

  private setState(patch: FleetState): void {
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
          this.ws?.terminate(); // -> 'close' -> reconnect
          return;
        }
      }
      this.awaitingPong = true;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ t: 'ping' }));
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
  runner: Runner;
  io: FleetIO;
  spawnPty: SpawnPty;
  state: FleetState;
  onStateChange(cb: (s: FleetState) => void): () => void;
  close(): Promise<void>;
}

/** `spawnPty` stub — T4 replaces this with a real `RemotePty` over `ptyOpen`. */
const spawnPtyStub: SpawnPty = () => {
  throw new Error('remote spawnPty is not implemented yet (lands in T4)');
};

export function connectFleet(cfg: RemoteFleetConfig): ConnectedFleet {
  const client = new FleetClient(cfg);
  client.start();
  return {
    runner: createRunner(client),
    io: createIo(client),
    spawnPty: spawnPtyStub,
    state: client.state,
    onStateChange: (cb) => client.onStateChange(cb),
    close: () => client.close(),
  };
}
