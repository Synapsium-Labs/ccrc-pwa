/**
 * Which sessions a human is currently LOOKING AT.
 *
 * Keyed by a per-connection token rather than by session id, so a socket that
 * dies without a close frame takes its own claim with it and cannot leave a
 * session permanently un-notifiable. Nothing here is persisted: presence is
 * true only while someone is connected and saying so, and a server that just
 * restarted correctly believes nobody is watching.
 */
export class Presence {
  private byToken = new Map<symbol, string>();
  setVisible(token: symbol, id: string | null): void {
    if (id === null) this.byToken.delete(token);
    else this.byToken.set(token, id);
  }
  drop(token: symbol): void { this.byToken.delete(token); }
  isVisible(id: string): boolean {
    for (const v of this.byToken.values()) if (v === id) return true;
    return false;
  }
}
