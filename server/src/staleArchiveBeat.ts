// D-6643 (fleet disk retention spec §2.7.5); moved out of `watch.ts` by the consolidation (GitHub #1279). L4: the stale-archive
// arm's beat. `staleArchivePass` (`coord/staleArchive.ts`) holds the decisions and the act; this builds its ports from the
// watcher's, keeps the arm's memory, and holds one pass at a time on the arm's own clock. SHADOW until `$REG/stale-archive-live`.
// Its clock is the WALL clock, as it was in the watcher: making it a `LANE_SCHEDULE` row (monotonic, `skip`) changes the clock,
// so it stays a follow-up.
import type { Deps } from './deps.js';
import type { FleetWatcherView } from './coord/ports.js';
import { notify } from './notice.js';
import { readSessionRecord, type SessionRecord } from './registry.js';
import { liveWordFor, turnReadDeps } from './turnverdict.js';
import {
  STALE_ARCHIVE_SWEEP_MS, paneFromLiveWord, staleArchivePass, transcriptMtimeVia, wokeAtVia, type StaleArchiveMemory,
} from './coord/staleArchive.js';

type ResolveTranscript = Parameters<typeof transcriptMtimeVia>[3];

export class StaleArchiveBeat {
  private last = 0;
  private sweeping = false;
  private readonly memory: StaleArchiveMemory = { sightings: new Map(), would: new Set(), failed: new Map() };

  constructor(private readonly deps: () => Deps, private readonly view: FleetWatcherView, private readonly resolve: ResolveTranscript) {}

  /** Hourly, one pass at a time, on the tick's rows and listing. Never rejects: a throw is warned and costs the pass. */
  async sweep(records: readonly SessionRecord[], names: readonly string[]): Promise<void> {
    const now = Date.now();
    if (this.sweeping || (this.last !== 0 && now - this.last < STALE_ARCHIVE_SWEEP_MS)) return;
    this.last = now;
    this.sweeping = true;
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
    } finally {
      this.sweeping = false;
    }
  }
}
