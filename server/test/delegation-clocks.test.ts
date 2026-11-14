// D-8614 (ARCH-68's follow-up): the delegation lane's three hand-made clocks, pinned as they fire today. The lane's own
// cadence is the `delegation` row of `LANE_SCHEDULE` (D-5862); these three are not cadences, and this suite is the evidence:
//   - `lastUpkeepHour` spends a UTC HOUR (a calendar boundary on the wall clock), so two passes a minute apart across an
//     hour both enter the upkeep door and two passes 58 minutes apart inside one hour enter it once;
//   - `lastCompactDay` spends a UTC DAY the same way, and only once the applier allows pruning;
//   - `lastRecoverAt` is the recovery backoff (`DELEGATION_RECOVERY_RETRY_MS`, a safety interval), stamped by the applier's
//     open and by each recovery, and read only while the applier is failed.
// A row of the schedule is a cadence on the monotonic clock (OA-C4), so none of the three can become one with the gating
// pinned here; `consolidationCensus.ts`' `LANE_SCHEDULE_EXCEPTIONS` records each. Literals on purpose, never the lane's
// constants: a pin that read them would move with a mutation of them. Every home and database is a fixture.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import type { DelegationDurability } from '../src/coord/delegation-checkpoint.js';
import { DELEGATION_EVENTS_CAP } from '../src/coord/delegation-model.js';
import { seedRoster, testDeps } from './helpers.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { mkTmp } from './tmpHelpers.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** 10:00 UTC, a fixed wall instant. */
const AT = Date.UTC(2026, 9, 15, 10);
/** The next UTC midnight after `AT`. */
const MIDNIGHT = Date.UTC(2026, 9, 16);
/** The recovery backoff the lane waits between two recoveries of a failed applier (`DELEGATION_RECOVERY_RETRY_MS`). */
const RETRY = 5 * MIN;
const FAILURE = { code: 'journal-unreadable', detail: 'a fixture failure' };

const worlds: Array<{ watcher: FleetWatcher; coord: CoordStore }> = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) { await w.watcher.closeDelegation(); w.coord.db.close(); }
  vi.restoreAllMocks();
});

function world() {
  const home = mkTmp('ccrc-delegation-clocks-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-delegation-clocks-projects-') } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const clock = { ms: 0 };
  const watcher = quietAtTestEnd(new FleetWatcher({ ...testDeps(home), cfg, coord, io: localIO, monotonicMs: () => clock.ms,
    fleetState: { connected: true, downSince: null, ccdVerbs: ['caps', DELEGATION_EVENTS_CAP] },
  } as never, new Bus(), 10_000));
  watcher.setDelegationSeams({ loopTurn: async () => {} });
  worlds.push({ watcher, coord });
  return { watcher, clock };
}
type World = ReturnType<typeof world>;

/** Opens the applier with the wall clock at `now` (the open stamps the recovery clock). */
async function open(w: World, now: number): Promise<DelegationDurability> {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  return (await w.watcher.delegationApplier())!;
}

/** One pass with the wall clock at `now`. The monotonic clock moves a full cadence first, so the `delegation` row never
 *  throttles a pass this suite asks for: every count below is the hand-made clock's alone. */
async function pass(w: World, now: number): Promise<void> {
  w.clock.ms += MIN;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  (w.watcher as unknown as { delegationCensus: unknown }).delegationCensus = { measuredAt: now, projects: new Map(), incarnations: new Map() };
  await w.watcher.sweepDelegation([], []);
}

describe('D-8614: the hourly upkeep latch (DelegationLane#lastUpkeepHour) spends a UTC hour, not a cadence', () => {
  it('the first pass of an hour enters the upkeep door with the hourly work on; a later pass of that hour does not enter it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = await open(w, AT);
    const upkeep = vi.spyOn(d, 'upkeep');
    await pass(w, AT + MIN);
    expect(upkeep).toHaveBeenCalledExactlyOnceWith({ nowMs: AT + MIN, intervals: false, cursors: true, zeroDelta: true });
    await pass(w, AT + 59 * MIN);
    expect(upkeep, '58 minutes later, inside the same UTC hour').toHaveBeenCalledTimes(1);
    await pass(w, AT + HOUR);
    expect(upkeep, 'the next UTC hour').toHaveBeenCalledTimes(2);
    expect(upkeep).toHaveBeenLastCalledWith({ nowMs: AT + HOUR, intervals: false, cursors: true, zeroDelta: true });
  });

  it('two passes a minute apart across an hour boundary both enter: a calendar boundary, which no cadence row keeps', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = await open(w, AT);
    const upkeep = vi.spyOn(d, 'upkeep');
    await pass(w, AT + 59 * MIN);
    await pass(w, AT + HOUR);
    expect(upkeep.mock.calls.map(([r]) => r.cursors)).toEqual([true, true]);
  });

  it('a wall clock stepped back into an earlier hour enters the door again (any change of hour does)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = await open(w, AT);
    const upkeep = vi.spyOn(d, 'upkeep');
    await pass(w, AT + HOUR + MIN);
    await pass(w, AT + MIN);
    expect(upkeep.mock.calls.map(([r]) => r.nowMs)).toEqual([AT + HOUR + MIN, AT + MIN]);
  });
});

describe('D-8614: the daily compaction latch (DelegationLane#lastCompactDay) spends a UTC day, gated on pruning', () => {
  it('two passes a minute apart across midnight both compact; a later pass of the new day does not', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = await open(w, AT);
    const compact = vi.spyOn(d, 'compactJournal');
    await pass(w, MIDNIGHT - MIN);
    await pass(w, MIDNIGHT);
    await pass(w, MIDNIGHT + 23 * HOUR);
    expect(compact.mock.calls.map(([now]) => now)).toEqual([MIDNIGHT - MIN, MIDNIGHT]);
  });

  it('a pass while the applier refuses pruning does not spend the day: the next pass that day compacts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = await open(w, AT);
    const compact = vi.spyOn(d, 'compactJournal');
    const pruning = vi.spyOn(d, 'pruningEnabled').mockReturnValue(false);
    await pass(w, AT + MIN);
    expect(compact, 'no attempt while pruning is refused').not.toHaveBeenCalled();
    pruning.mockRestore();
    await pass(w, AT + 2 * MIN);
    expect(compact).toHaveBeenCalledExactlyOnceWith(AT + 2 * MIN, expect.any(Number));
  });

  it('a wall clock stepped back into the previous day compacts again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = await open(w, AT);
    const compact = vi.spyOn(d, 'compactJournal');
    await pass(w, AT + MIN);
    await pass(w, AT + MIN - DAY);
    expect(compact.mock.calls.map(([now]) => now)).toEqual([AT + MIN, AT + MIN - DAY]);
  });
});

describe('D-8614: the recovery backoff (DelegationLane#lastRecoverAt) is a safety interval, read only while the applier is failed', () => {
  it('the open stamps it: a failure found at once waits five minutes from the open, then one recovery per five minutes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = await open(w, AT);
    vi.spyOn(d, 'failure').mockReturnValue(FAILURE as never);
    const recover = vi.spyOn(d, 'recover').mockResolvedValue(undefined as never);
    await pass(w, AT + RETRY - 1);
    expect(recover, 'inside the interval from the open').not.toHaveBeenCalled();
    await pass(w, AT + RETRY);
    expect(recover, 'at the interval').toHaveBeenCalledTimes(1);
    await pass(w, AT + 2 * RETRY - 1);
    expect(recover, 'inside the interval from the recovery').toHaveBeenCalledTimes(1);
    await pass(w, AT + 2 * RETRY);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it('ready passes never stamp it: a failure that appears ten minutes after the open is recovered on its first pass', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = await open(w, AT);
    const recover = vi.spyOn(d, 'recover').mockResolvedValue(undefined as never);
    await pass(w, AT + MIN);
    await pass(w, AT + 9 * MIN);
    expect(recover).not.toHaveBeenCalled();
    vi.spyOn(d, 'failure').mockReturnValue(FAILURE as never);
    await pass(w, AT + 10 * MIN);
    expect(recover, 'the clock is the open\'s, ten minutes old').toHaveBeenCalledTimes(1);
  });

  it('it reads the wall clock: a step back holds the next recovery until the wall passes the interval again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = await open(w, AT);
    vi.spyOn(d, 'failure').mockReturnValue(FAILURE as never);
    const recover = vi.spyOn(d, 'recover').mockResolvedValue(undefined as never);
    await pass(w, AT + RETRY);
    expect(recover).toHaveBeenCalledTimes(1);
    await pass(w, AT + RETRY - HOUR);
    expect(recover, 'an hour stepped back').toHaveBeenCalledTimes(1);
    await pass(w, AT + 2 * RETRY);
    expect(recover).toHaveBeenCalledTimes(2);
  });
});
