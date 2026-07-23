import type { Deps } from './server.js';
import type { Bus } from './bus.js';
import { assembleFleet } from './fleet.js';
import { readRegistry } from './registry.js';
import { paneState, parseDialog } from './pane/dialog.js';
import { parseStatusline, type Statusline } from './pane/statusline.js';
import { defaultCachePath, saveSnapshot } from './fleetstate.js';
import type { SessionStatus } from '../../shared/api.js';

/**
 * Polls the fleet: captures every registered pane to detect menu dialogs
 * (emitting `session:<id>` dialog / dialog_cleared messages on change), then
 * emits 'fleet' on the bus only when the assembled JSON changed.
 *
 * In remote mode, every poll taken while actually connected also persists a
 * snapshot to the degraded-mode cache (fleetstate.ts) — skipped while
 * disconnected so a stretch of empty/partial reads never clobbers the last
 * known good snapshot `/api/fleet` falls back to.
 */
export class FleetWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastJson: string | null = null;
  /** Last-reported dialog id per session id. */
  private dialogIds = new Map<string, string>();
  /** Last-seen model/effort/ultracode/branch per live session (from the pane). */
  private statuslines = new Map<string, Statusline>();
  /** Prior status per session — drives the busy→idle push. */
  private prevStatus = new Map<string, SessionStatus>();
  /** The first tick primes dialog/status state WITHOUT firing pushes, so a ccrc
   *  restart doesn't notify for every already-pending dialog / idle session. */
  private primed = false;
  private readonly cachePath: string;

  constructor(private deps: Deps, private bus: Bus, private intervalMs = 2000, cachePath?: string) {
    this.cachePath = cachePath ?? deps.stateCachePath ?? defaultCachePath();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * The set of session ids that currently have a pending menu dialog. Exposed
   * so a one-shot fleet assembly (the /api/fleet REST + the initial /ws/fleet
   * push on connect) can reflect an ALREADY-pending dialog. Without this, a
   * dialog that appeared before a client connected shows no "needs you" marker
   * on the fleet overview: the initial push omits it and the watcher only
   * re-emits 'fleet' when the JSON *changes*, so an unchanged pending state is
   * never resent to the newcomer.
   */
  currentPending(): Set<string> {
    return new Set(this.dialogIds.keys());
  }

  /** Last-seen statuslines — passed into a one-shot fleet assembly (REST +
   *  initial /ws/fleet push) so model/effort/ultracode/branch show immediately,
   *  same reasoning as currentPending(). */
  currentStatuslines(): Map<string, Statusline> {
    return new Map(this.statuslines);
  }

  async tick(): Promise<void> {
    const pending = await this.detectDialogs(this.primed);
    const sessions = await assembleFleet(this.deps.io, this.deps.cfg, this.deps.tmux, undefined, pending, this.statuslines);
    // Push on a busy→idle finish (a session completed a turn). Skip the priming
    // tick — otherwise a restart notifies for every currently-idle session.
    if (this.primed && this.deps.push) {
      for (const s of sessions) {
        if (this.prevStatus.get(s.id) === 'busy' && s.status === 'idle') {
          void this.deps.push.notify({ title: `✓ ${s.project}`, body: 'Finished — back to idle', sessionId: s.id, tag: `idle-${s.id}` });
        }
      }
    }
    for (const s of sessions) this.prevStatus.set(s.id, s.status);
    this.primed = true;
    if (this.deps.cfg.fleetMode === 'remote' && this.deps.fleetState?.connected) {
      try { await saveSnapshot(sessions, this.cachePath); } catch { /* best-effort cache — never blocks the poll */ }
    }
    const json = JSON.stringify(sessions);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.bus.emit('fleet', sessions);
  }

  /**
   * Capture each registered session's pane (dead panes capture as null); a menu
   * pane parses to a dialog. Emit `dialog` when the id changed since last tick,
   * `dialog_cleared` when a previously-reported dialog vanished. Returns the
   * set of session ids with a dialog pending, for the fleet assembly.
   */
  private async detectDialogs(notify: boolean): Promise<Set<string>> {
    const pending = new Set<string>();
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    for (const r of records) {
      const pane = await this.deps.tmux.capture(r.id);
      // Same capture feeds the statusline read — no extra tmux call. A tick
      // whose pane has no statusline (a dialog/permission overlay covers it, or
      // the session is mid-render) must NOT blank the last-known model/branch —
      // only update when we actually parsed something; drop only on a dead pane.
      if (pane === null) this.statuslines.delete(r.id);
      else {
        const sl = parseStatusline(pane);
        if (sl.model || sl.branch || sl.effort) this.statuslines.set(r.id, sl);
      }
      const dialog = pane !== null && paneState(pane) === 'menu' ? parseDialog(pane) : null;
      const last = this.dialogIds.get(r.id);
      if (dialog) {
        pending.add(r.id);
        if (last !== dialog.id) {
          this.dialogIds.set(r.id, dialog.id);
          this.bus.emit(`session:${r.id}`, { type: 'dialog', dialog });
          if (notify && this.deps.push) {
            void this.deps.push.notify({
              title: `❓ ${r.project}`, body: dialog.title || 'Claude has a question',
              sessionId: r.id, tag: `dialog-${r.id}`,
            });
          }
        }
      } else if (last !== undefined) {
        this.dialogIds.delete(r.id);
        this.bus.emit(`session:${r.id}`, { type: 'dialog_cleared' });
      }
    }
    return pending;
  }
}
