// D-6631 (fleet disk retention spec 2026-10-23 §2.3); moved out of `watch.ts` by the consolidation (GitHub #1279). L4: the
// orphan-worktree lane's wiring. `OrphanTreeSweep` (`orphanTreeSweep.ts`) holds the lane's memory and runs a pass, the
// decisions are `orphanTreeLane.ts`'s and every ccd call is `coord/collectOrphanTree.ts`'s; this builds the sweep from the
// watcher's ports, on first use. The cadence is the `orphanTrees` row of `LANE_SCHEDULE`, run by `FleetWatcher.runLane`.
// Shadow until `orphan-tree-live` stands.
import type { Deps } from './deps.js';
import { NO_FLEET_IDENTITY } from './fleetidentity.js';
import { notify } from './notice.js';
import { orphanCoordinatorSet } from './orphanTreeLane.js';
import { OrphanTreeSweep } from './orphanTreeSweep.js';
import { fieldMeasured, readSessionRecord } from './registry.js';
import { childReclaimEverClaimedIds } from './coord/childReclaim.js';
import type { DiskOrphanTrees } from '../../shared/disk.js';

export class OrphanTreeBeat {
  private sweep: OrphanTreeSweep | null = null;

  /** `mono` is the watcher's monotonic clock reading, the one the lane's rows throttle on. */
  constructor(private readonly deps: () => Deps, private readonly mono: () => number) {}

  /** The `disk` block's `orphanTrees`, or null before the lane's first census. */
  health(): DiskOrphanTrees | null { return this.sweep?.health() ?? null; }

  /** One pass. The caller holds the coord store (a coord-less server has no lane) and the cadence. */
  async pass(): Promise<void> {
    const d = this.deps();
    const coord = d.coord;
    if (!coord) return;
    this.sweep ??= new OrphanTreeSweep({
      io: d.io, registryDir: d.cfg.registryDir, runCcd: d.runCcd, fleetState: d.fleetState,
      queue: d.queue, mono: this.mono,
      epochNow: () => (this.deps().fleetIdentity ?? NO_FLEET_IDENTITY).epochNow(), pressure: () => false,
      coordinators: () => { const c = orphanCoordinatorSet({ everClaimedIds: () => childReclaimEverClaimedIds(coord), openCoordinatorIds: () => coord.openCoordinatorIds() }); if (c === null) throw new Error('coordinator claims unreadable'); return c; },
      // A containing row that is no workspace (a plain session, a main checkout) is no nesting; an unreadable or absent row keeps the tree.
      isWorkspace: async (id) => {
        const r = await readSessionRecord(d.io, d.cfg, id);
        if (r.kind !== 'found' || r.record.unmeasured.length > 0) return null;
        // MEASURED: field() collapses an unreadable marker to null, which would read as 'plain session' and audit a worker's tree.
        const w = await fieldMeasured(d.io, d.cfg.registryDir, id, 'workspace');
        return w.ok ? true : w.reason === 'absent' ? false : null;
      },
      record: (title, body) => notify({ notifyLog: d.notifyLog, coord },
        { kind: 'coord', sessionId: '', runId: null, title, body }, 'record-only', { degraded: `orphan-tree lane ${title}, feed archive degraded` }),
    });
    await this.sweep.pass();
  }
}
