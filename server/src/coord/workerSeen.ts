// D-8285 (#119): THE WORKER HEARTBEAT, and the one in-memory reader of it. L1: no I/O, no clock.
//
// WHAT IT IS. A run's `workerLastSeen` is the `at` of the newest main-thread event its worker's turn marker
// (`$REG/<id>.turn.json`, worker stall watch §5.1) records, and `workerLastTurn` is that marker's turn: its state and its
// start and end. The hook rewrites the marker on every prompt, Stop, StopFailure and restart, so it is the one file a
// worker writes every turn whose shape the server already parses and judges (`readTurnMarkMeasured`, `turnmark.ts`).
//
// NO NEW READ, NO NEW LOOP. The stall watch reads every open run's worker marker once a sweep already (`judgeStall`,
// `watch.ts`). That read is this heartbeat's only source: the sweep hands each marker to `workerSeenOf` and swaps the whole
// answer in with `replace` once the workers are judged. A second poller of the same file would be the parallel mechanism the
// consolidation rule forbids.
//
// WHAT IT DOES NOT SAY. A marker that did not read (`absent`, `unmeasured`, `malformed`, `foreign`, `stale`) is no entry:
// the run carries no field, which reads "not measured", never "dead". A tool call inside a turn moves no marker, so a long
// turn's heartbeat is its start; the turn's state says which. Liveness of the pane is the stuck verdict's (`runStuck.ts`).
//
// LAG. One sweep (`STALL_SWEEP_MS`). Empty before the first sweep, after a restart, and while the stall watch is disabled
// (the sweep clears it then, so a frozen value never ages into a false "quiet").
import type { RunWorkerTurn } from '../../../shared/api.js';
import type { TurnMarkRead } from './stall.js';

/** One worker's heartbeat, as every open run on that worker carries it. */
export interface WorkerSeen {
  readonly lastSeen: number;
  readonly turn: RunWorkerTurn;
}

/** The heartbeat a marker read gives, or null when the read gave no marker. */
export function workerSeenOf(mark: TurnMarkRead): WorkerSeen | null {
  if (!mark.ok) return null;
  return { lastSeen: mark.at, turn: { state: mark.state, startedAt: mark.turnAt, endedAt: mark.stopAt } };
}

/** The reader the run answers stamp from (`withWorkerSeen`, `runWire.ts`). */
export interface WorkerSeenReader {
  of(runId: number): WorkerSeen | null;
}

/** The board the stall sweep writes: `replace` swaps the whole answer, keyed by run id. */
export interface WorkerSeenBoard extends WorkerSeenReader {
  replace(seen: ReadonlyMap<number, WorkerSeen>): void;
}

export function createWorkerSeen(): WorkerSeenBoard {
  let seen: ReadonlyMap<number, WorkerSeen> = new Map();
  return {
    replace(next) { seen = new Map(next); },
    of(runId) { return seen.get(runId) ?? null; },
  };
}
