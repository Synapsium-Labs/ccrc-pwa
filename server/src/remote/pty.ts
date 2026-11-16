import type { PtyData, PtyExit } from '../../../shared/agent-protocol.js';
import type { PtyLike, SpawnPty } from '../pty.js';
import type { FleetClient } from './client.js';

function isPtyExit(msg: PtyData | PtyExit): msg is PtyExit {
  return msg.ev === 'exit';
}

/**
 * `SpawnPty` over the agent's ptyOpen/pty(input|resize|close) ops.
 * `spawnPty` itself must return synchronously — `server.ts`'s `/ws/pty/:id`
 * bridge calls `p.onData(...)` right after spawning — but `ptyOpen` is a
 * request/response round trip over the WS. So `RemotePty` returns
 * immediately and resolves its `ptyId` in the background; any `write`/
 * `resize`/`kill` issued before that resolves is queued and flushed once it
 * does (no data can arrive before then, so `onData`/`onExit` listeners
 * registered early just wait). If `kill()` lands before the ptyId comes
 * back, the pty is closed the moment it's assigned rather than left running
 * on the agent.
 *
 * A closed `RemotePty` writes nothing (D-6368). It closes on `kill()`, on the
 * agent's `exit` frame, on the exit `client.ts` synthesizes for every
 * listener when the link drops, and on a failed open; the last three fire the
 * exit listeners (at most once) so the drawer bridge can end its socket. The
 * agent numbers ptys per connection from 1, so after a reconnect a stale
 * RemotePty's id belongs to a different session's pty, and its keys must die
 * here. No `close` frame goes out for an exited pty: the agent already
 * dropped it, and after a reconnect that id may be someone else's.
 */
export class RemotePty implements PtyLike {
  private ptyId: number | null = null;
  private closed = false;
  private exited = false;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<() => void>();
  private readonly queue: Array<(ptyId: number) => void> = [];

  constructor(
    private readonly client: FleetClient,
    sessionId: string,
    cols: number,
    rows: number,
  ) {
    void this.open(sessionId, cols, rows);
  }

  private async open(sessionId: string, cols: number, rows: number): Promise<void> {
    let ptyId: number;
    try {
      const res = await this.client.request({ t: 'req', op: 'ptyOpen', sessionId, cols, rows });
      const id = (res as { ptyId?: unknown }).ptyId;
      if (typeof id !== 'number') { this.failOpen(); return; }
      ptyId = id;
    } catch {
      // Disconnected or forbidden before we ever got a ptyId — nothing is
      // left on the agent to clean up, but the drawer must hear it is dead.
      this.failOpen();
      return;
    }
    if (this.closed) {
      // kill() already ran before the ptyId came back — close it now rather
      // than leaving it running on the agent forever.
      this.client.sendPty({ t: 'pty', ptyId, ev: 'close' });
      return;
    }
    this.ptyId = ptyId;
    this.client.onPty(ptyId, (msg) => {
      if (isPtyExit(msg)) {
        // Closed first, then the client's listener released (`kill()` returns early once closed, so nothing else
        // would), then the exit fires. No `close` frame: the agent already dropped this pty (D-6368).
        this.closed = true;
        this.client.offPty(ptyId);
        this.fireExit();
        return;
      }
      const text = Buffer.from(msg.dataB64, 'base64').toString('utf8');
      for (const l of this.dataListeners) l(text);
    });
    const pending = this.queue.splice(0);
    for (const send of pending) send(ptyId);
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  /** Part of `PtyLike` since D-6368: the drawer bridge closes its socket on it. Fires at most once, for the agent's
   *  `PtyExit`, the exit the client synthesizes on a link drop, and a failed open; never for a `kill()`. */
  onExit(listener: () => void): { dispose(): void } {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  write(data: string): void {
    if (this.closed) return;
    this.withPtyId((ptyId) =>
      this.client.sendPty({ t: 'pty', ptyId, ev: 'input', dataB64: Buffer.from(data, 'utf8').toString('base64') }),
    );
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;
    this.withPtyId((ptyId) => this.client.sendPty({ t: 'pty', ptyId, ev: 'resize', cols, rows }));
  }

  kill(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ptyId !== null) {
      this.client.sendPty({ t: 'pty', ptyId: this.ptyId, ev: 'close' });
      this.client.offPty(this.ptyId);
    }
    // If the ptyId hasn't come back yet, `open()`'s closed-check above
    // sends the close as soon as it does.
  }

  /** The open never produced a pty: closed, the queued sends dropped, exit fired — unless `kill()` got there first
   *  (a pty the bridge killed needs no exit). */
  private failOpen(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.length = 0;
    this.fireExit();
  }

  private fireExit(): void {
    if (this.exited) return;
    this.exited = true;
    for (const l of this.exitListeners) l();
  }

  private withPtyId(fn: (ptyId: number) => void): void {
    if (this.ptyId !== null) fn(this.ptyId);
    else this.queue.push(fn);
  }
}

export function createSpawnPty(client: FleetClient): SpawnPty {
  return (sessionId, cols, rows) => new RemotePty(client, sessionId, cols, rows);
}
