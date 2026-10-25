// Test-infra guard (CI teardown flake): a watcher a case built must be QUIET when its test ends.
//
// `FleetWatcher.tick()` fires writers it never awaits (the server-caps beat, the inventory run, the dispatch run), and
// a lane pass can outlive the `await` that started it. One still running when a file finishes writes into a temp tree
// the run's teardown has already removed and `console.warn`s about it, and vitest reports that late log as
// `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` on a shard whose every test passed.
//
// `guardQuietAtTestEnd` registers, for the test running now, a check that NO lane is in flight when it ends. It does
// not wait for them: a case that ticks drains the watcher itself (`drainTick`), and a case that forgot goes red here,
// naming the lane, instead of flaking on whichever later shard the warn lands in.
import { onTestFinished } from 'vitest';
import type { FleetWatcher } from '../src/watch.js';
import { LANE_SCHEDULE } from '../src/laneSchedule.js';

/** The names of every lane with a run in flight on `w`. */
export const lanesInFlight = (w: FleetWatcher): string[] =>
  LANE_SCHEDULE.map((r) => r.name).filter((name) => w.inFlight(name as never) !== null);

/** Call from inside a test (a rig builder does): the test fails if a lane is still in flight when it ends. */
export const guardQuietAtTestEnd = (w: FleetWatcher): void => {
  onTestFinished(() => {
    const running = lanesInFlight(w);
    if (running.length > 0) throw new Error(`lane run still in flight when the test ended: ${running.join(', ')}`);
  });
};

/** Resolves once no lane run and no tick-fired writer is in flight on `w`. Loops: a run that settles can start the next
 *  (the dispatch run's follow-up). Never rejects: each lane warns or hands its rejection to its own caller. */
export const drainWatcher = async (w: FleetWatcher): Promise<void> => {
  for (;;) {
    await w.settled();
    const running = LANE_SCHEDULE.map((r) => w.inFlight(r.name as never)).filter((p) => p !== null);
    if (running.length === 0) return;
    await Promise.allSettled(running);
  }
};

/** `tick()`, then everything it fired without awaiting settled (`drainWatcher`). */
export const drainTick = async (w: FleetWatcher): Promise<void> => { await w.tick(); await drainWatcher(w); };
