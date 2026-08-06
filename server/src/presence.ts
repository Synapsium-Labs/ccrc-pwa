import { PRESENCE_TTL_MS } from '../../shared/api.js';

/**
 * Which sessions a human is currently LOOKING AT.
 *
 * Two independent properties keep this honest, and they are not the same
 * property:
 *
 *  - **Keyed by a per-connection token**, so one socket's disconnect drops
 *    only its OWN claim: a second tab watching the same session is not
 *    un-notified by the first one's close (`server.ts`'s `/ws/session/:id`).
 *
 *  - **Every claim expires.** Per-connection keying does NOT survive a socket
 *    that dies without a close frame — a phone that loses signal sends no FIN,
 *    'close' never fires, and the claim would sit here suppressing every
 *    notification for that session until the TCP stack gave up retransmitting
 *    the next write, which on a quiet stream is never. So a claim is believed
 *    only while the client keeps re-stating it (`PRESENCE_REFRESH_MS`, see
 *    `shared/api.ts`), and a claim older than `PRESENCE_TTL_MS` is three
 *    refreshes stale and is dropped where it is found.
 *
 * The expiry direction is the fail-shut one: an expired claim means NOTIFY.
 *
 * Nothing here is persisted: presence is true only while someone is connected
 * and saying so, and a server that just restarted correctly believes nobody is
 * watching.
 */
export class Presence {
  private byToken = new Map<symbol, { id: string; at: number }>();

  /** `now` is injectable so a test can age a claim without spending 45 s. */
  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = PRESENCE_TTL_MS) {}

  /** Record (or re-state) this connection's claim. Every call re-stamps it —
   *  the client's heartbeat sends the same frame, and it is the STAMP that
   *  keeps the claim alive. */
  setVisible(token: symbol, id: string | null): void {
    if (id === null) this.byToken.delete(token);
    else this.byToken.set(token, { id, at: this.now() });
  }

  drop(token: symbol): void { this.byToken.delete(token); }

  /** Is anyone looking at `id` right now? Sweeps expired claims as it walks,
   *  so a socket that vanished without a close frame stops costing this map an
   *  entry as well as stops suppressing its session's notifications. */
  isVisible(id: string): boolean {
    const cutoff = this.now() - this.ttlMs;
    let seen = false;
    for (const [token, claim] of this.byToken) {
      if (claim.at <= cutoff) { this.byToken.delete(token); continue; }
      if (claim.id === id) seen = true;
    }
    return seen;
  }
}
