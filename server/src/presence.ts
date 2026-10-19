import { PRESENCE_OPEN_TTL_MS, PRESENCE_TTL_MS } from '../../shared/api.js';

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
 *
 * TWO CLAIMS PER CONNECTION (D-5242, spec §5.11's presence contract):
 *
 *  - the VISIBLE claim (`setVisible`, `isVisible`): a screen on display. It
 *    suppresses pushes, on `PRESENCE_TTL_MS`, exactly as it always has;
 *  - the OPEN claim (`markOpen`, `touch`, `isOpen`): a `/ws/session/:id`
 *    socket that is still there, visible or hidden. Stamped at connect,
 *    re-stamped by EVERY frame the client sends (the heartbeat beats while
 *    hidden too), dropped at close, believed for `PRESENCE_OPEN_TTL_MS` after
 *    its last stamp. It is what keeps a session someone has open from being put
 *    to sleep (hibernation's `viewer` hold, and the stop-done lane's, D-5370).
 *
 * A server that just restarted believes no screen is open either, which is
 * wrong for a hidden tab that has not reconnected yet — so each reader of
 * `isOpen` holds its own act for `PRESENCE_OPEN_TTL_MS` after the server
 * starts.
 */
export class Presence {
  private byToken = new Map<symbol, { id: string; at: number }>();
  /** The open claims (D-5242), one per connection token, beside the visible ones and never mixed with them. */
  private openByToken = new Map<symbol, { id: string; at: number }>();

  /** `now` is injectable so a test can age a claim without spending 45 s. */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = PRESENCE_TTL_MS,
    private readonly openTtlMs = PRESENCE_OPEN_TTL_MS,
  ) {}

  /** A `/ws/session/:id` connection opened: its open claim, stamped now. */
  markOpen(token: symbol, id: string): void {
    this.openByToken.set(token, { id, at: this.now() });
  }

  /** A frame arrived on this connection, whatever it said: re-stamp its open claim (never its visible one — only a
   *  visible frame says the screen is on display). A token never marked open opens nothing. */
  touch(token: symbol): void {
    const claim = this.openByToken.get(token);
    if (claim !== undefined) claim.at = this.now();
  }

  /** Record (or re-state) this connection's claim. Every call re-stamps it —
   *  the client's heartbeat sends the same frame, and it is the STAMP that
   *  keeps the claim alive. */
  setVisible(token: symbol, id: string | null): void {
    if (id === null) this.byToken.delete(token);
    else this.byToken.set(token, { id, at: this.now() });
  }

  /** The connection closed: both of its claims go at once. */
  drop(token: symbol): void {
    this.byToken.delete(token);
    this.openByToken.delete(token);
  }

  /** Has anyone `id` open — on screen or in a hidden tab — with a frame inside `PRESENCE_OPEN_TTL_MS`? Sweeps expired
   *  open claims as it walks, as `isVisible` does its own. */
  isOpen(id: string): boolean {
    const cutoff = this.now() - this.openTtlMs;
    let seen = false;
    for (const [token, claim] of this.openByToken) {
      if (claim.at <= cutoff) { this.openByToken.delete(token); continue; }
      if (claim.id === id) seen = true;
    }
    return seen;
  }

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
