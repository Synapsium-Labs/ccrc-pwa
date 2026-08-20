// Resilient WebSocket client for the two ccrc-server streams. Reconnects with
// exponential backoff (+jitter), recomputes the URL on every attempt so a
// fresh `?since=<uuid>:<offset>` rides along, and exposes `nudge()` for
// callers to wire to `visibilitychange`→visible / `online` events.
import { checkAuth, isAuthLost, onAuthRegained } from './auth';

export type SocketState = 'connecting' | 'open' | 'down';

/**
 * What this socket needs from the session gate. Declared HERE, by the consumer
 * (the L2 rule in `CLAUDE.md`), and satisfied by `lib/auth.ts` — which is also
 * what {@link DEFAULT_AUTH_GATE} binds it to, so no caller has to remember to
 * pass one. Injectable because a socket test must be able to script a closed
 * gate without a server.
 *
 * The problem it exists for: a rejected upgrade is a bare 401 on the wire, and
 * the browser's `WebSocket` surfaces neither status nor body — a refused
 * handshake and a pulled network cable are the same `error` + 1006 close. Left
 * to itself this class would climb its backoff ladder against a door that will
 * never open, forever, which is the failure Task 7 exists to prevent.
 */
export interface AuthGate {
  /** Is a login screen up right now? While it is, the ladder stands still. */
  lost(): boolean;
  /** Fire-and-forget: ask the box whether it is refusing us, and raise
   *  auth-lost if it is. Never throws, never awaited. */
  check(): void;
  /** Subscribe to "auth came back" — the cue to try again at once rather than
   *  waiting out a backoff that was never scheduled. Returns an unsubscribe. */
  onRegained(fn: () => void): () => void;
}

/** The shipped gate: the module-level signal in `lib/auth.ts`. */
const DEFAULT_AUTH_GATE: AuthGate = {
  lost: isAuthLost,
  check: checkAuth,
  onRegained: onAuthRegained,
};

export interface ReconnectingSocketOpts {
  url: () => string; // recomputed each (re)connect — carries fresh ?since=
  onMessage: (msg: unknown) => void; // parsed JSON
  onState: (s: SocketState) => void;
  /** Fired on EVERY successful open, including the automatic reconnects
   *  `onState` also reports. Anything the client told the server about this
   *  connection has to be told again here: the server keys per-connection
   *  state (presence, notably) by the socket itself, so a reconnect starts
   *  with a blank slate and a claim made once would silently lapse. */
  onOpen?: () => void;
  makeSocket?: (url: string) => WebSocket; // injectable for tests
  baseDelayMs?: number; // default 500, doubles to max 10s, ±30% jitter
  /** The session gate. Defaults to the shipped signal; injectable for tests. */
  auth?: AuthGate;
}

const MAX_DELAY_MS = 10_000;
const JITTER = 0.3;

/** Absolute ws(s):// URL for a same-origin path like `/ws/fleet`. */
export function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

export class ReconnectingSocket {
  private readonly opts: ReconnectingSocketOpts;
  private readonly auth: AuthGate;
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private state: SocketState | null = null;
  /** Did THIS attempt ever reach `onopen`? The one signature a refused upgrade
   *  has: the gate runs at upgrade time, so a session that goes stale mid-stream
   *  leaves the open socket alone and is only discovered on the NEXT handshake.
   *  A drop that follows a good open is therefore an ordinary network event and
   *  must not cost a probe. */
  private opened = false;
  private unsubAuth: (() => void) | null = null;

  constructor(o: ReconnectingSocketOpts) {
    this.opts = o;
    this.auth = o.auth ?? DEFAULT_AUTH_GATE;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    // Subscribed for the socket's whole started lifetime, not just while the
    // gate is shut: the parked state has no timer of its own, so this is the
    // ONLY thing that ever restarts it.
    this.unsubAuth = this.auth.onRegained(() => this.nudge());
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.unsubAuth?.();
    this.unsubAuth = null;
    this.clearTimer();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      this.detach(ws);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
  }

  /**
   * Send one JSON frame, if a socket is open right now. Returns whether it
   * went.
   *
   * Deliberately NOT queued. Everything sent over these streams is a statement
   * about the present ("this session is on screen"), and a queued statement
   * delivered after a reconnect would describe a moment that has passed. The
   * caller re-states it on `onOpen` instead, which is both simpler and always
   * current.
   */
  send(data: unknown): boolean {
    const ws = this.ws;
    if (ws === null || ws.readyState !== 1 /* OPEN */) return false;
    try {
      ws.send(JSON.stringify(data));
      return true;
    } catch {
      return false; // a socket that died between the check and the send
    }
  }

  /** Immediate reconnect if down (skips any pending backoff wait). */
  nudge(): void {
    if (this.stopped || this.ws) return; // inert unless started and down
    this.clearTimer();
    this.attempt = 0; // fresh network conditions — restart the backoff ladder
    this.connect();
  }

  private connect(): void {
    // The gate is shut: park, and wait for `onRegained`. Reported as `down`
    // because that is what it is from every reader's point of view — the stream
    // is not delivering — and because the alternative, `connecting`, would have
    // the UI narrate an attempt that is not being made.
    if (this.auth.lost()) {
      this.setState('down');
      return;
    }
    this.setState('connecting');
    this.opened = false;
    let ws: WebSocket;
    try {
      const make = this.opts.makeSocket ?? ((u: string) => new WebSocket(u));
      ws = make(this.opts.url());
    } catch {
      this.setState('down');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.opened = true;
      this.setState('open');
      this.opts.onOpen?.();
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return;
      if (typeof ev.data !== 'string') return; // only JSON text frames expected
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return; // malformed frames dropped silently
      }
      this.opts.onMessage(parsed);
    };
    ws.onclose = () => this.handleDown(ws);
    ws.onerror = () => this.handleDown(ws);
  }

  /** Shared close/error path — idempotent per socket via the identity guard. */
  private handleDown(ws: WebSocket): void {
    if (this.ws !== ws) return; // stale socket (already replaced or stopped)
    this.ws = null;
    this.detach(ws);
    try {
      ws.close(); // error path: make sure the browser tears it down
    } catch {
      /* already closed */
    }
    if (this.stopped) return;
    this.setState('down');
    // An attempt that never opened may have been REFUSED rather than dropped,
    // and the browser cannot tell us which (see {@link AuthGate}). Ask. The
    // answer lands asynchronously, so at most one more rung gets climbed before
    // `scheduleReconnect` starts refusing to climb.
    if (!this.opened) this.auth.check();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer !== null) return;
    // NO auth guard here, deliberately, and the deliberation was measured: a
    // second `if (this.auth.lost()) return;` at this line was mutation-tested
    // and SURVIVED — `connect()`'s guard already makes the pending timer a
    // no-op that schedules nothing further, so the ladder stops either way and
    // no test could tell the two versions apart. A guard no test can kill is
    // decoration, and decoration next to a real guard is worse: it reads like
    // the mechanism, so the next person deletes the real one.
    const base = this.opts.baseDelayMs ?? 500;
    const delay = Math.min(base * 2 ** this.attempt, MAX_DELAY_MS);
    const jittered = delay * (1 + (Math.random() * 2 - 1) * JITTER);
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, jittered);
  }

  private setState(s: SocketState): void {
    if (this.state === s) return;
    this.state = s;
    this.opts.onState(s);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private detach(ws: WebSocket): void {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  }
}
