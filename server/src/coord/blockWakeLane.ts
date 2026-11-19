// D-8126 wave A6 (coordinator-autonomy-default plan, Task A6-5, P7; design 2026-11-09 §8.2): ONE PASS OF THE BLOCK-WAKE
// LANE. A coordinator that parks a thread records a `block` call with a wake (`time:<ms>`, `disk`, `memory`, `update`,
// `account-room` or `capacity`); this pass judges each unwoken one on facts the lanes that already watch its condition
// hold: the disk alarm's block, the memory gate's reading, the running build, and the coordinator's own turn marker.
//
// It is a row of `LANE_SCHEDULE` (`blockWakes`, at the stall sweep's cadence) driven by `FleetWatcher.sweepBlockWakes`, and
// it is its own lane rather than part of the stall watch's coordinator pass: a parked thread must wake while the stall watch
// is switched off, and after its coordinator's last run has closed.
//
// It decides nothing itself: `blockWakeReadings`, `blockConditionNotOk`, `blockWakeDue` and `blockWakeMail` (`coordCalls.ts`,
// L1) do. It measures and applies: `markBlockWoken` is the compare-and-set (THE ONLY WRITER of `wokenAt`, so two passes send
// one mail), and a `wake-mail` queues one system mail from the operator to the coordinator. Every doubt waits: a fact that
// was not measured reads `unknown`, and a block nobody wakes lapses at its expiry, after which `coord-ball`'s mail rung
// may fire for its coordinator again.
import { blockConditionNotOk, blockWakeDue, blockWakeMail, blockWakeReadings, type CallRow } from './coordCalls.js';
import { queueSystemMail } from './rundefsTx.js';
import type { WatcherCoordPort } from './ports.js';
import type { TurnMarkRead } from './stall.js';

/** What one pass reads and where it writes, handed in by the watcher. */
export interface BlockWakeDeps {
  readonly coord: WatcherCoordPort;
  readonly now: number;
  /** The disk alarm's last block level, `unmeasured` when it has none. */
  readonly diskLevel: () => string;
  /** The memory gate's last level, `unmeasured` when it has none. */
  readonly memoryLevel: () => string;
  /** The running server's build stamp, or null. */
  readonly build: string | null;
  /** The coordinator's turn marker, read only when one of its `account-room` blocks waits. */
  readonly readMark: (id: string) => Promise<TurnMarkRead>;
  /** The `disk`/`memory` blocks (`<call id>`) whose condition read not cleared at a sweep after the row was made. The
   *  watcher's memory: a restart forgets it, and the block then waits for its lapse rather than wake on a clearing
   *  nobody saw. The pass adds to it and prunes it to the blocks it still judges. */
  readonly notOkSeen: Set<string>;
  readonly warn: (line: string) => void;
}

/** One pass: every coordinator with an unwoken block, run-holding or not. A read that fails holds that coordinator, or
 *  the whole pass when the claimant list itself cannot be read. */
export async function blockWakesPass(d: BlockWakeDeps): Promise<void> {
  let ids: string[];
  try {
    ids = d.coord.blockClaimants(d.now);
  } catch (err) {
    d.warn(`ccrc-server: block wake claimants unreadable (${err instanceof Error ? err.message : String(err)}) — held this sweep`);
    return;
  }
  const judged = new Set<string>();
  for (const id of ids) {
    try {
      await wakeBlocksOf(d, id, judged);
    } catch (err) {
      d.warn(`ccrc-server: block wake of ${id} failed (${err instanceof Error ? err.message : String(err)}) — the next coordinator still runs`);
    }
  }
  for (const k of d.notOkSeen) if (!judged.has(k)) d.notOkSeen.delete(k);
}

async function wakeBlocksOf(d: BlockWakeDeps, id: string, judged: Set<string>): Promise<void> {
  let rows: CallRow[];
  try {
    rows = d.coord.blocksToWake(id, d.now);
  } catch (err) {
    d.warn(`ccrc-server: block wakes of ${id} unreadable (${err instanceof Error ? err.message : String(err)}) — held this sweep`);
    return;
  }
  if (rows.length === 0) return;
  const readings = blockWakeReadings(d.diskLevel(), d.memoryLevel());
  let lastTurnAt: number | null = null;
  if (rows.some((r) => r.wakeOn === 'account-room')) {
    try {
      const m = await d.readMark(id);
      lastTurnAt = m.ok ? m.turnAt : null;
    } catch { /* unread: no turn is claimed */ }
  }
  for (const row of rows) {
    const key = String(row.id);
    judged.add(key);
    if (blockConditionNotOk(row, readings)) d.notOkSeen.add(key);
    const due = blockWakeDue(row, { now: d.now, ...readings, build: d.build, lastTurnAt, sawNotOk: d.notOkSeen.has(key) });
    if (due === 'none') continue;
    try {
      if (!d.coord.markBlockWoken(row.id, d.now) || due === 'wake-quiet') continue;
      queueSystemMail(d.coord, null, { fromId: 'operator', toId: id, runId: null, kind: 'status', ...blockWakeMail(row) });
    } catch (err) {
      d.warn(`ccrc-server: block wake of call ${row.id} failed (${err instanceof Error ? err.message : String(err)}) — the coord-ball rung covers a lost wake`);
    }
  }
}
