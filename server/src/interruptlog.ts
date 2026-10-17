// D-5237's first half (plan docs/superpowers/plans/2026-10-16-working-state-and-interruptions.md, Task 7; spec §5.5):
// every Escape or Ctrl-C the console sends is recorded with its source and outcome, as a feed event of kind
// `interrupt`. RECORDED, NEVER PUSHED: the record goes to the notify ring and the durable feed archive the way
// `pushOne`'s `recordOnly` rows do (the update dispatcher's `update` kind), and nothing here can reach `deps.push`.
//
// Two doors record: the interrupt route (`POST /api/sessions/:id/interrupt`, its source from the request body through
// `interruptRouteSource`) and the drawer's pty relay (`/ws/pty/:id`, a raw input frame that is EXACTLY ESC or EXACTLY
// Ctrl-C, at most one per session every `DRAWER_INTERRUPT_EVERY_MS`). The relay's bytes pass through unchanged; this
// module only observes them.
import {
  interruptEventBody, type InterruptOutcome, type InterruptSource,
} from '../../shared/api.js';
import type { NotifyLog } from './notifylog.js';
import type { CoordStore } from './coord/store.js';

/** The drawer records at most one interrupt per session in this window, so a held key or a burst of presses is one row. */
export const DRAWER_INTERRUPT_EVERY_MS = 2000;

/** A drawer input frame's interrupt source: exactly ESC or exactly Ctrl-C, nothing else. A frame that merely STARTS
 *  with ESC is a key sequence (an arrow key is `ESC [ A`), not an Escape. */
export function drawerInterruptSource(data: string): Extract<InterruptSource, 'drawer-escape' | 'drawer-ctrl-c'> | null {
  if (data === '\x1b') return 'drawer-escape';
  if (data === '\x03') return 'drawer-ctrl-c';
  return null;
}

/** The drawer's per-session throttle: `admit` answers true at most once per session every `everyMs`. One instance per
 *  server; its map holds one number per session that ever sent one, bounded by the fleet. */
export class DrawerInterruptThrottle {
  private readonly last = new Map<string, number>();
  constructor(private readonly everyMs = DRAWER_INTERRUPT_EVERY_MS) {}
  admit(id: string, now: number): boolean {
    const prev = this.last.get(id);
    if (prev !== undefined && now - prev < this.everyMs) return false;
    this.last.set(id, now);
    return true;
  }
}

/** Record one interrupt: a `console.warn` line always, and a feed event when a notify log is configured. GUARDED: a
 *  failed archive write never fails the interrupt it records (the key, if any, is already pressed), the same degrade
 *  `pushOne` and the ask-answer route take. Never a push. */
export function recordInterrupt(
  deps: { notifyLog?: NotifyLog; coord?: Pick<CoordStore, 'recordFeedEvent'> },
  id: string, source: InterruptSource, outcome: InterruptOutcome,
): void {
  const body = interruptEventBody(source, outcome);
  console.warn(`ccrc-server: interrupt ${id} ${body}`);
  const log = deps.notifyLog;
  if (log === undefined) return;
  try {
    const ev = log.record({ kind: 'interrupt', sessionId: id, title: `interrupt · ${source}`, body, runId: null });
    deps.coord?.recordFeedEvent(log.epoch, ev);
  } catch (err) {
    console.warn('ccrc-server: recordFeedEvent failed ' +
      `(${err instanceof Error ? err.message : String(err)}) — interrupt answered, feed archive degraded`);
  } finally {
    void log.flush();
  }
}
