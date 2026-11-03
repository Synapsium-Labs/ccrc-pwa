// D-6916 (box settings view; spec docs/superpowers/specs/2026-10-25-box-settings-view-design.md §2.4). L4 delivery: it READS each
// reached node's `~/.ccrc/box-settings.json` through the inventory's lstat-gated, capped read (`readNodeFile`) and HOLDS the last
// answer per node; every judgement (what a document is, how old it reads) is `boxSettings.ts`'s (L1). FleetWatcher owns one and
// calls `run()` once, inside the `inventory` LANE_SCHEDULE row's run, right after the sweep.
//
// NO CLOCK, FLAG OR THROTTLE OF ITS OWN (spec D4, the plan's coordinator correction 5): the sweep hands it the `InventoryDeps` parts
// it built (its two ios and `ccrcDir`), the nodes the sweep just wrote, the sweep's own outcomes and the sweep's `now`, so the read
// and the caps it checks are the same sweep's; `held()` issues no read, so nothing is read between runs. The only state is the map
// below, on the instance (never module scope), so two servers in one process never share a read.
//
// FAIL TOWARD KEEPING: a node the sweep did not reach (unreachable, refused, a throw) keeps its last read, which the view then ages
// into `stale`; a read that throws changes nothing; an id no longer in the node list (a rekey, a removal) is dropped after the run.
// It never throws into the sweep and it never logs: the card is its only surface.
import path from 'node:path';
import { NODE_FILES } from '../../../shared/agent-protocol.js';
import type { NodeRow } from '../coord/store.js';
import type { FleetIO } from '../io.js';
import { openPoolReadDeadline } from '../pools.js';
import { parseBoxSettings, type BoxSettingsHeld } from './boxSettings.js';
import { FLEET_LABEL, INVENTORY_BUDGET_MS, SERVER_LABEL, readNodeFile, type InventoryDeps, type SweepOutcome } from './inventory.js';

/** The cap word a node's tree advertises when it writes the file (`CCRC_CAP_WORDS_LINUX`, `ccd/ccrc`). */
const SETTINGS_CAP = 'settings';

/** What one node's read comes to. A node whose caps were not measured (`os` unknown) and one whose measured caps lack the word are
 *  told apart, and neither issues a read. Reads through the one io it is given and never rejects on a failed read. */
export async function readBoxSettings(
  io: FleetIO, ccrcDir: string, node: Pick<NodeRow, 'os' | 'caps'>,
): Promise<BoxSettingsHeld['read']> {
  if (node.os === 'unknown') return { state: 'caps-unmeasured' };
  if (!node.caps.includes(SETTINGS_CAP)) return { state: 'not-supported' };
  const deadline = openPoolReadDeadline(INVENTORY_BUDGET_MS);
  try {
    const r = await readNodeFile(io, path.join(ccrcDir, NODE_FILES.boxSettings), deadline);
    if (!r.ok) return { state: r.reason };
    const doc = parseBoxSettings(r.content);
    return doc === null ? { state: 'malformed' } : { state: 'ok', doc };
  } finally {
    deadline?.close();
  }
}

export class BoxSettingsLane {
  private readonly reads = new Map<string, BoxSettingsHeld>();

  /** The last read per node id. Read-only: asking issues no read. */
  held(): ReadonlyMap<string, BoxSettingsHeld> {
    return this.reads;
  }

  /** One pass over the outcomes of the sweep that just ran. `liveNodes` answers the live node list that sweep left in the store; it
   *  is asked inside the guard, because a store that throws (a locked `coord.db`) must not take the sweep's caller with it. */
  async run(
    inv: Pick<InventoryDeps, 'localIo' | 'ccrcDir' | 'fleet'>, liveNodes: () => readonly Pick<NodeRow, 'nodeId' | 'os' | 'caps'>[],
    outcomes: readonly SweepOutcome[], nowMs: number,
  ): Promise<void> {
    try {
      const nodes = liveNodes();
      const readAtS = Math.floor(nowMs / 1000);
      await Promise.all(outcomes.map(async (o) => {
        if (o.result !== 'measured' && o.result !== 'node-id-collision') return;
        const node = nodes.find((n) => n.nodeId === o.nodeId);
        const io = o.label === SERVER_LABEL ? inv.localIo : o.label === FLEET_LABEL ? inv.fleet?.io : undefined;
        if (node === undefined || io === undefined) return;
        try {
          this.reads.set(o.nodeId, { read: await readBoxSettings(io, inv.ccrcDir, node), readAtS });
        } catch {
          // Keep the last held read: a read that could not be made says nothing new.
        }
      }));
      for (const id of [...this.reads.keys()]) if (!nodes.some((n) => n.nodeId === id)) this.reads.delete(id);
    } catch {
      // Never into the sweep (see the header).
    }
  }
}
