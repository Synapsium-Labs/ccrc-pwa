// D-6643 (fleet disk retention spec §2.7.5); moved out of `watch.ts` by the consolidation (GitHub #1279). L4: the stale-archive
// arm's beat. `staleArchivePass` (`coord/staleArchive.ts`) holds the decisions and the act; this builds its ports from the
// watcher's and keeps the arm's memory. SHADOW until `$REG/stale-archive-live`. Its cadence and its one pass at a time are the
// `staleArchive` row of `LANE_SCHEDULE` (`skip`), run by `FleetWatcher.runLane` on the monotonic clock (D-7895). Until then the
// throttle read the wall clock, in the watcher and in this class; the pass's verdicts still do (`now: Date.now`).
import type { WatcherDeps } from './deps.js';
import type { FleetWatcherView } from './coord/ports.js';
import { notify } from './notice.js';
import { readSessionRecord, type SessionRecord } from './registry.js';
import { liveWordFor, turnReadDeps } from './turnverdict.js';
import {
  paneFromLiveWord, staleArchivePass, transcriptMtimeVia, wokeAtVia, type StaleArchiveMemory,
} from './coord/staleArchive.js';

type ResolveTranscript = Parameters<typeof transcriptMtimeVia>[3];

export class StaleArchiveBeat {
  private readonly memory: StaleArchiveMemory = { sightings: new Map(), would: new Set(), failed: new Map() };

  constructor(private readonly deps: () => Pick<WatcherDeps, 'io' | 'cfg' | 'tmux' | 'coord' | 'notifyLog' | 'viewers' | 'runCcd' | 'fleetState' | 'queue'>, private readonly view: FleetWatcherView, private readonly resolve: ResolveTranscript) {}

  /** One pass, on the tick's rows and listing; the caller holds the cadence and the single flight (the `staleArchive` row).
   *  Never rejects: a throw is warned and costs the pass. */
  async pass(records: readonly SessionRecord[], names: readonly string[]): Promise<void> {
    try {
      const d = this.deps();
      const reads = turnReadDeps(d, this.view);
      const { io, cfg, coord, notifyLog } = d;
      await staleArchivePass({
        coord, viewers: d.viewers, runCcd: d.runCcd, fleetState: d.fleetState,
        notice: (e) => { notify({ notifyLog, coord }, e, 'record-only', { degraded: 'stale archive, feed archive degraded' }); },
        pane: async (rec) => paneFromLiveWord(await liveWordFor(reads, rec)),
        transcriptMtimeMs: (rec) => transcriptMtimeVia(io, cfg, rec, this.resolve),
        wokeAtMs: (rec) => wokeAtVia(io, cfg, rec),
        listRegistry: () => io.readdirMeasured(cfg.registryDir),
        rowNow: async (rec) => { const a = await readSessionRecord(io, cfg, rec.id); return a.kind === 'found' ? a.record : null; },
        queueRun: (id, fn) => d.queue.run(id, fn), log: (line) => console.warn(line), now: Date.now,
      }, this.memory, records, names);
    } catch (err) {
      console.warn(`ccrc-server: sweepStaleArchive failed (${err instanceof Error ? err.message : String(err)}) — no archives this pass`);
    }
  }
}
