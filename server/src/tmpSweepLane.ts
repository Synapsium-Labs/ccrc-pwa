// D-6624 (plan Task DR-12): the census lane's I/O. L4 delivery: it READS the tmp sweep's census through the fleet io and
// QUEUES the system mail; every decision (the parse, which rows are receipts, which sessions are owed a notice, the
// words) is `tmpSweep.ts`'s (L1). `TmpCensusBeat` owns the clock, the state and the holders it last named (moved out of
// `watch.ts` by the consolidation, GitHub #1279); the watcher owns one and calls `sweep()` from its tick.
//
// FAIL TOWARD KEEPING: a census that cannot be read or parsed mails nothing and names no holders; a mail that throws
// latches nothing, so the next pass tries again; the coord store's own subject check (`hasMailWithSubject`, every
// delivery state) is what makes a restart re-send nothing.
import path from 'node:path';
import type { DiskHolder } from '../../shared/disk.js';
import type { Deps } from './deps.js';
import { NODE_FILES } from '../../shared/agent-protocol.js';
import type { CoordStore } from './coord/store.js';
import { queueSystemMail } from './coord/rundefsTx.js';
import { survivorOf } from './coord/rundefs.js';
import { coordinatorOfRun } from './coord/bindingReads.js';
import type { FleetIO } from './io.js';
import { openPoolReadDeadline } from './pools.js';
import { INVENTORY_BUDGET_MS, readNodeFile } from './update/inventory.js';
import {
  TMP_SWEEP_CENSUS_CAP_BYTES, parseTmpSweepCensus, tmpSweepBudget, tmpSweepHolders, tmpSweepInodeBudget, tmpSweepReceipts,
} from './tmpSweep.js';

export interface TmpSweepLaneDeps {
  readonly io: FleetIO;
  readonly ccrcDir: string;
  /** Absent in a coord-less server: the holders are still read, nothing is mailed. */
  readonly coord: CoordStore | undefined;
}

/** What the lane remembers between passes. Nothing here is the proof a mail was sent (the coord store is). */
export interface TmpSweepLaneState {
  /** The highest census `seq` already handled. */
  mailed: number;
  /** Over-budget episode keys already told (or decided not to be told). */
  readonly noticed: Set<string>;
  /** Ids already logged as having no registry row, and whether a malformed census was already logged. */
  readonly logged: Set<string>;
}

export const newTmpSweepLaneState = (): TmpSweepLaneState => ({ mailed: 0, noticed: new Set(), logged: new Set() });

const warnOnce = (state: TmpSweepLaneState, key: string, msg: string): void => {
  if (state.logged.has(key)) return;
  state.logged.add(key);
  console.warn(`ccrc-server: tmp-sweep census: ${msg}`);
};

/** Queue one mail unless this exact (sender, recipient, subject) was ever queued. Throws what the store throws. */
function mailOnce(coord: CoordStore, toId: string, subject: string, body: string): void {
  if (coord.hasMailWithSubject('operator', null, toId, subject)) return;
  queueSystemMail(coord, null, { fromId: 'operator', toId, runId: null, kind: 'status', subject, body });
}

/** The coordinator of the run a session is the worker of, or `null` (a coordinating session has no run of its own). */
function coordinatorOf(coord: CoordStore, sessionId: string): string | null {
  const open = coord.openRunsForSession(sessionId);
  if (!open.ok) return null;
  const run = survivorOf(open.siblings);
  if (run === null) return null;
  const claimant = coordinatorOfRun(coord, run.id);
  return claimant !== null && claimant !== sessionId ? claimant : null;
}

/**
 * One pass. `known` is the registry's session ids from this tick, or `null` when the registry could not be read: with
 * `null` nothing is mailed and nothing is latched (the holders are still answered, because a full disk is exactly when
 * the registry read fails). Answers the holders the health block carries; never rejects.
 */
export async function runTmpSweepCensusLane(
  deps: TmpSweepLaneDeps, state: TmpSweepLaneState, known: ReadonlySet<string> | null,
): Promise<{ holders: DiskHolder[] }> {
  const deadline = openPoolReadDeadline(INVENTORY_BUDGET_MS);
  let census;
  try {
    const read = await readNodeFile(deps.io, path.join(deps.ccrcDir, NODE_FILES.tmpSweep), deadline, TMP_SWEEP_CENSUS_CAP_BYTES);
    if (!read.ok) {
      if (read.reason !== 'absent') warnOnce(state, `read:${read.reason}`, `the census could not be read (${read.reason})`);
      return { holders: [] };
    }
    census = parseTmpSweepCensus(read.content);
  } catch {
    return { holders: [] };
  } finally {
    deadline?.close();
  }
  if (census === null) {
    warnOnce(state, 'malformed', 'the census file is malformed; it is read as unmeasured');
    return { holders: [] };
  }
  const holders = tmpSweepHolders(census);
  const coord = deps.coord;
  if (coord === undefined || known === null) return { holders };
  try {
    const receipts = tmpSweepReceipts(census, state.mailed);
    for (const m of receipts.mails) {
      if (!known.has(m.toId)) { warnOnce(state, `unknown:${m.toId}`, `${m.toId} has no registry row; its receipts are not mailed`); continue; }
      mailOnce(coord, m.toId, m.subject, m.body);
    }
    state.mailed = receipts.mailed;
    for (const n of [...tmpSweepBudget(census, state.noticed), ...tmpSweepInodeBudget(census, state.noticed)]) {
      if (!known.has(n.sessionId)) {
        warnOnce(state, `unknown:${n.sessionId}`, `${n.sessionId} has no registry row; its budget notice is not mailed`);
        continue;
      }
      mailOnce(coord, n.sessionId, n.subject, n.body);
      const claimant = coordinatorOf(coord, n.sessionId);
      if (claimant !== null && known.has(claimant)) mailOnce(coord, claimant, n.subject, n.coordinatorBody);
      state.noticed.add(n.key);
    }
  } catch (err) {
    console.warn(`ccrc-server: tmp-sweep census: mail failed (${err instanceof Error ? err.message : String(err)}); the next pass retries`);
  }
  return { holders };
}

/** The census lane's clock (D-6624, spec §2.1): the census is read and its mail queued every 5 minutes. */
export const TMP_SWEEP_CENSUS_MS = 5 * 60_000;

/** The census lane's beat: its own wall clock (the first pass is at once), its memory, and the holders it last named. */
export class TmpCensusBeat {
  private last = 0;
  private readonly state = newTmpSweepLaneState();
  private named: DiskHolder[] = [];

  constructor(private readonly deps: () => Pick<Deps, 'io' | 'cfg' | 'coord'>) {}

  /** The five largest sessions as the last pass named them: `disk.holders`. Empty until a census reads. */
  holders(): readonly DiskHolder[] { return this.named; }

  /** One pass, throttled. `known` is the registry ids of the last good listing, `null` until one lands. PUBLIC through the
   *  watcher for the reason `sweepReadiness` is: `tick()` dispatches it with `void`. */
  async sweep(known: ReadonlySet<string> | null): Promise<void> {
    const now = Date.now();
    if (this.last !== 0 && now - this.last < TMP_SWEEP_CENSUS_MS) return;
    this.last = now;
    const { io, cfg, coord } = this.deps();
    this.named = (await runTmpSweepCensusLane({ io, ccrcDir: cfg.ccrcDir, coord }, this.state, known)).holders;
  }
}
