// D-8955: THE DISK-LANE STALL ALERT'S PASS. Ring L4, context C6 (Attention and Notification). It reads the facts — the disk
// alarm's block, the cleanup lanes' journal rows (`CoordStore.lifecycleLaneRowsSince`) and the holding rows the last coord
// frame carried — and acts on `diskLaneStall.ts`'s answers only: it settles the open items L1 names, raises the items L1
// says are missing, and sends ONE push for each raise through the notice funnel (`notify`, the push outbox's path).
//
// ONCE ONLY, ACROSS A RESTART: the item is durable, so a stall whose item is open raises nothing; and the push's key
// (`diskLaneStallKey`: lane, reason, and the last done it waits behind) is read before the write (`hasNotice`), so a raise
// after a lost item still pushes once. A store that cannot answer the dedupe read costs the dedupe only: a repeat beats
// silence (the disk alarm's rule). A journal that cannot be read raises and settles nothing; nor does a lane before the first
// coord frame or registry listing (passed as null, never as empty: review 2 and 5). The holder words this process has seen
// (`seen`, memory only) are what lets `diskLaneStallMoves` tell a holder that went from one not yet re-read since start.
//
// `watch.ts` owns one of these and runs `pass()` on the `diskLaneStall` row, above the registry read's fail-shut return,
// beside the disk alarm: a full disk is exactly when that read fails.
import type { DiskHealth } from '../../shared/disk.js';
import type { CoordStatus, FleetSession } from '../../shared/api.js';
import type { WatcherCoordPort } from './coord/ports.js';
import {
  DISK_LANE_STALL_ITEM_PROGRAMME, DISK_LANE_STALL_READ_MS, DISK_LANE_STALL_ROWS_MAX, DISK_STALL_ACTS, diskLaneStallItemOf,
  diskLaneHoldersSeen, diskLaneStallMoves, diskLaneVerdicts, openDiskLaneStallItems, type DiskLaneRow,
} from './diskLaneStall.js';
import { notify, type NoticeDeps } from './notice.js';

export interface DiskLaneStallDeps extends NoticeDeps {
  readonly coord?: Pick<WatcherCoordPort, 'lifecycleLaneRowsSince' | 'itemsFor' | 'moveItem' | 'raiseItem' | 'hasNotice'
    | 'recordFeedEvent'> | undefined;
}

export class DiskLaneStallLane {
  /** `<lane>:<word>` of every holder a stuck lane was named under since this process started. */
  private readonly seen = new Set<string>();
  constructor(private readonly deps: () => DiskLaneStallDeps, private readonly now: () => number = Date.now) {}

  /** One pass over the disk block, the last coord frame and the last registry listing (each null before the first). Never
   *  throws: `tick()` dispatches it through its row, and a failure is logged and the next pass retries. */
  pass(disk: DiskHealth | null, frame: CoordStatus | null, fleet: readonly Pick<FleetSession, 'id'>[] | null): void {
    const d = this.deps();
    const coord = d.coord;
    if (coord === undefined) return;
    const at = this.now();
    try {
      let rows: DiskLaneRow[] | null;
      try { rows = coord.lifecycleLaneRowsSince(at - DISK_LANE_STALL_READ_MS, DISK_STALL_ACTS, DISK_LANE_STALL_ROWS_MAX); } catch { rows = null; }
      // A frame's absent `cleanupHeldBy` is "no row holds" (its one reader's rule); no frame at all is unmeasured.
      const heldBy = frame === null ? null : frame.cleanupHeldBy ?? [];
      const live = fleet === null ? null : new Set(fleet.map((f) => f.id));
      const verdicts = diskLaneVerdicts({ disk, rows, heldBy, live, now: at });
      for (const k of diskLaneHoldersSeen(verdicts)) this.seen.add(k);
      const open = openDiskLaneStallItems(coord.itemsFor(DISK_LANE_STALL_ITEM_PROGRAMME, at).open);
      const moves = diskLaneStallMoves(verdicts, open, this.seen);
      for (const s of moves.settle) coord.moveItem(s.id, 'settle', 'ccrc', { note: s.note }, at, { programmeHasOpenRun: false });
      for (const stall of moves.raise) {
        const { item, push } = diskLaneStallItemOf(stall, disk, at);
        coord.raiseItem(item, at, 'ccrc');
        let told = false;
        try { told = coord.hasNotice('coord', '', push.dedupeKey); } catch { /* send it: a repeat beats silence */ }
        if (told) continue;
        console.warn(`ccrc-server: disk-lane stall: ${stall.lane} has stalled (${stall.reason}, ${stall.progress.waiting} waiting; D-8955)`);
        notify(d, { kind: 'coord', sessionId: '', runId: null, title: push.title, body: push.body }, 'push',
          { tag: 'disk-lane-stall', dedupeKey: push.dedupeKey, url: push.url, lane: 'disk-lane stall', degraded: 'item raised, feed archive degraded' });
      }
    } catch (err) {
      console.warn(`ccrc-server: disk-lane stall: pass failed (${err instanceof Error ? err.message : String(err)}) — the next pass retries`);
    }
  }
}
