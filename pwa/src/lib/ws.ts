// Resilient WebSocket client for the two ccrc-server streams. Reconnects with
// exponential backoff (+jitter), recomputes the URL on every attempt so a
// fresh `?since=<uuid>:<offset>` rides along, and exposes `nudge()` for
// callers to wire to `visibilitychange`→visible / `online` events.

export type SocketState = 'connecting' | 'open' | 'down';

export interface ReconnectingSocketOpts {
  url: () => string; // recomputed each (re)connect — carries fresh ?since=
  onMessage: (msg: unknown) => void; // parsed JSON
  onState: (s: SocketState) => void;
  makeSocket?: (url: string) => WebSocket; // injectable for tests
  baseDelayMs?: number; // default 500, doubles to max 10s, ±30% jitter
}

const MAX_DELAY_MS = 10_000;
const JITTER = 0.3;

export class ReconnectingSocket {
  private readonly opts: ReconnectingSocketOpts;
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private state: SocketState | null = null;

  constructor(o: ReconnectingSocketOpts) {
    this.opts = o;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
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

  /** Immediate reconnect if down (skips any pending backoff wait). */
  nudge(): void {
    if (this.stopped || this.ws) return; // inert unless started and down
    this.clearTimer();
    this.attempt = 0; // fresh network conditions — restart the backoff ladder
    this.connect();
  }

  private connect(): void {
    this.setState('connecting');
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
      this.setState('open');
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
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer !== null) return;
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
