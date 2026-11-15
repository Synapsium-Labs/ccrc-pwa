// L4 delivery, context C3 (Session Conversation): the renewal act's wiring for the watcher (W1a renewal act Task 4). It
// composes, for one generations pass, the box's renew capability (`hibernate-fresh`), the gather's drain read (a session's
// row and live reads asked of the hold table, `drainVerdict`), and the acts' runner over the ccd adapter of `SessionHost`
// (`ccdSessionHost`) with its send, usage and receipt reads, so `watch.ts` hands the pass three values and the runner its
// plan. It decides nothing: every decision is in `renewalFeed.ts`, `renewalDrain.ts` and the machine.
import type { SessionRecord } from '../registry.js';
import type { FleetSession } from '../../../shared/api.js';
import { HIBERNATE_FRESH_CAP, capSupported } from '../ccdargv.js';
import type { WatcherDeps } from '../deps.js';
import type { WatcherCoordPort } from '../coord/ports.js';
import { queueSystemMail } from '../coord/rundefsTx.js';
import { sendPrompt } from '../inject/send.js';
import { INJECTED_PROMPTS } from '../../../shared/injected-prompts.mjs';
import { liveWordFor, turnMarkFor, type TurnReadDeps } from '../turnverdict.js';
import { readUsageMeasured } from '../usage.js';
import { ccdSessionHost } from './ccdSessionHost.js';
import type { PlannedAct } from './generationsLane.js';
import { runRenewalActs, type ActsResult } from './renewalActs.js';
import { drainVerdict, type DrainRead } from './renewalDrain.js';

export interface RenewalWiring {
  readonly canRenew: boolean;
  readonly drainOf: (id: string) => Promise<DrainRead>;
  readonly run: (planned: readonly PlannedAct[]) => Promise<ActsResult>;
}

/** The pass's renewal pieces. `serial` is the stop-and-done serialiser (null before the sleep lanes start), which the
 *  renewal's ccd call runs inside, around the per-session queue, as the automatic roll's act does. */
export function renewalActsOf(
  deps: Pick<WatcherDeps, 'io' | 'cfg' | 'runCcd' | 'fleetState' | 'tmux' | 'queue' | 'time'>,
  coord: WatcherCoordPort, records: readonly SessionRecord[], reads: TurnReadDeps,
  rowAtAct: (rec: SessionRecord) => Promise<{ ok: true; row: FleetSession } | { ok: false }>,
  serial: (<T>(fn: () => Promise<T>) => Promise<T>) | null,
): RenewalWiring {
  const now = (): number => deps.time.clock.wall();
  const unmeasured: DrainRead = { held: true, reason: 'unmeasured' };
  const host = ccdSessionHost({
    runCcd: deps.runCcd, fleetState: deps.fleetState,
    // One `sendPrompt` per row the port can name (`RenewalPrompt` has one), each typed by reference to the list.
    send: (id) => sendPrompt({ tmux: deps.tmux, queue: deps.queue }, id, INJECTED_PROMPTS['renewal-first-prompt'].text,
      { onDraft: 'stash', holdIfAutoContinueArmed: true, refuseIfTurnRunning: true }),
    usage: (id) => readUsageMeasured(deps.io, deps.cfg.registryDir, id, Math.floor(now() / 1000)),
    startsOf: (id, limit) => coord.startsOf(id, limit),
    log: (line) => console.warn(line),
    around: (id, fn) => (serial === null ? deps.queue.run(id, fn) : serial(() => deps.queue.run(id, fn))),
  });
  return {
    canRenew: capSupported(deps.fleetState, HIBERNATE_FRESH_CAP),
    drainOf: async (id) => {
      const rec = records.find((r) => r.id === id);
      if (rec === undefined) return unmeasured;
      const row = await rowAtAct(rec);
      if (!row.ok) return unmeasured;
      const w = await liveWordFor(reads, rec);
      const mark = await turnMarkFor(reads, rec);
      return drainVerdict(row.row, { kind: 'read', word: w.ok ? { ok: true, word: w.word } : { ok: false, reason: w.reason }, mark }, now());
    },
    run: (planned) => runRenewalActs({
      coord, host, now, log: (line) => console.warn(line),
      mail: (toId, subject, body) => queueSystemMail(coord, null, { fromId: 'operator', toId, runId: null, kind: 'status', subject, body }).queued,
    }, planned),
  };
}
