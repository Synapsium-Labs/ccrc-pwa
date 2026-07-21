import type { Deps } from './server.js';
import type { Bus } from './bus.js';
import { assembleFleet } from './fleet.js';
import { readRegistry } from './registry.js';
import { paneState, parseDialog } from './pane/dialog.js';

/**
 * Polls the fleet: captures every registered pane to detect menu dialogs
 * (emitting `session:<id>` dialog / dialog_cleared messages on change), then
 * emits 'fleet' on the bus only when the assembled JSON changed.
 */
export class FleetWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastJson: string | null = null;
  /** Last-reported dialog id per session id. */
  private dialogIds = new Map<string, string>();

  constructor(private deps: Deps, private bus: Bus, private intervalMs = 2000) {}

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

  async tick(): Promise<void> {
    const pending = await this.detectDialogs();
    const sessions = await assembleFleet(this.deps.io, this.deps.cfg, this.deps.tmux, undefined, pending);
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
  private async detectDialogs(): Promise<Set<string>> {
    const pending = new Set<string>();
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    for (const r of records) {
      const pane = await this.deps.tmux.capture(r.id);
      const dialog = pane !== null && paneState(pane) === 'menu' ? parseDialog(pane) : null;
      const last = this.dialogIds.get(r.id);
      if (dialog) {
        pending.add(r.id);
        if (last !== dialog.id) {
          this.dialogIds.set(r.id, dialog.id);
          this.bus.emit(`session:${r.id}`, { type: 'dialog', dialog });
        }
      } else if (last !== undefined) {
        this.dialogIds.delete(r.id);
        this.bus.emit(`session:${r.id}`, { type: 'dialog_cleared' });
      }
    }
    return pending;
  }
}
