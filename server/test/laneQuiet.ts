// Test-infra guard (CI teardown flake): a watcher a case built must be QUIET when its test ends.
//
// `FleetWatcher.tick()` fires writers it never awaits, and a lane pass can outlive the `await` that started it. One
// still running when a file finishes writes into a temp tree the run's teardown has already removed and `console.warn`s
// about it, and vitest reports that late log as `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was
// pending` on a shard whose every test passed.
//
// WHAT THIS MODULE SEES, and nothing more:
//   - every `LANE_SCHEDULE` row (`../src/laneSchedule.ts`), through `FleetWatcher.inFlight(name)`. A row's slot holds
//     the run started last, so on a `none` row (runs may overlap) an earlier pass still running beside it is not seen;
//   - what `FleetWatcher.settled()` awaits: the `serverCaps` and `inventory` rows, and the dispatch run the inventory
//     run ends in (`dispatchRun`). The dispatch run has no accessor, so only `drainWatcher` (through `settled()`)
//     waits for it; `guardQuietAtTestEnd` checks the rows alone.
// It CANNOT see a sweep `tick()` fires that is not a row: today the host-pressure beat (`sweepPressure`), the
// backup-health beat (`sweepBackup`) and the test box poll (`testboxLane.sweep`), each throttled and single-flighted by
// its own class. All three only read through the fleet io (the test box poll: the testbox op, a registry listing and
// the runs-log day files) and keep the answer in memory: none writes a log (nor a file) today, so none can cause the
// teardown flake. Nor does it see the synchronous tail a sweep runs after its row's run settles (the delegation frame's
// emit, a few microtasks after the slot clears). A tick-fired writer that logs must run through a row (or be awaited by
// `settled()`) before this guard can see it.
//
// `guardQuietAtTestEnd` registers, for the test running now, a check that NO row has a run in flight when it ends. It
// does not wait for them: a case that ticks drains the watcher itself (`drainTick`), and a case that forgot goes red
// here, naming the lane, instead of flaking on whichever later shard the warn lands in.
import { onTestFinished } from 'vitest';
import type { FleetWatcher } from '../src/watch.js';
import { LANE_SCHEDULE, type LaneName } from '../src/laneSchedule.js';

/** A row's name as the watcher's lane accessors take it. `LaneRow.name` is typed `LaneName | (string & {})`, so the
 *  schedule's names are `LaneName`s the compiler cannot prove; the runner throws on a name with no row. */
const laneNames = (): LaneName[] => LANE_SCHEDULE.map((r) => r.name as LaneName);

/** The names of every `LANE_SCHEDULE` row with a run in flight on `w` (see the header for what that leaves out). */
export const lanesInFlight = (w: FleetWatcher): string[] =>
  laneNames().filter((name) => w.inFlight(name) !== null);

/** Call from inside a test (a rig builder does): the test fails if a `LANE_SCHEDULE` row still has a run in flight
 *  when it ends. It checks the rows alone: not the dispatch run `settled()` awaits, and not a tick-fired sweep that is
 *  not a row (today `sweepPressure`, `sweepBackup` and `testboxLane.sweep`, which write no log, so they cannot cause
 *  the teardown flake). */
export const guardQuietAtTestEnd = (w: FleetWatcher): void => {
  onTestFinished(() => {
    const running = lanesInFlight(w);
    if (running.length > 0) throw new Error(`lane run still in flight when the test ended: ${running.join(', ')}`);
  });
};

/** Resolves once nothing `settled()` awaits (the `serverCaps` and `inventory` rows, the dispatch run) and no
 *  `LANE_SCHEDULE` row has a run in flight on `w`. Loops: a run that settles can start the next (the dispatch run's
 *  follow-up). It does not wait for a tick-fired sweep that is not a row (today `sweepPressure`, `sweepBackup` and
 *  `testboxLane.sweep`, which write no log, so they cannot cause the teardown flake). Never rejects: each lane warns
 *  or hands its rejection to its own caller. */
export const drainWatcher = async (w: FleetWatcher): Promise<void> => {
  for (;;) {
    await w.settled();
    const running = laneNames().map((name) => w.inFlight(name)).filter((p) => p !== null);
    if (running.length === 0) return;
    await Promise.allSettled(running);
  }
};

/** `tick()`, then everything `drainWatcher` covers settled. */
export const drainTick = async (w: FleetWatcher): Promise<void> => { await w.tick(); await drainWatcher(w); };
