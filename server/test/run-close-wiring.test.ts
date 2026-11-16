// D-8077: the run-close lane, wired into the watcher. `run-close-lane` pins the pass over fakes; what is only provable HERE is that
// the watcher drives it (one row of LANE_SCHEDULE, derived from the destructive lanes' shared throttle), that its busy-turn
// reading is `'unread'` until a tick has run, and that a shadow pass anchors a programme and writes nothing else.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { Tmux, type Runner } from '../src/exec.js';
import { CHILD_RECLAIM_SWEEP_MS, LANE_SCHEDULE, RUN_CLOSE_SWEEP_MS, laneRow } from '../src/laneSchedule.js';
import { NotifyLog } from '../src/notifylog.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';

afterEach(() => { vi.restoreAllMocks(); });

const T0 = 1_790_000_000_000;

const fixture = async () => {
  vi.spyOn(Date, 'now').mockImplementation(() => T0);
  const home = mkTmp('ccrc-run-close-wiring-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions', '.lifecycle'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const run: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const base = testDeps(home, run);
  const clock = { mono: T0 };
  const deps = { ...base, monotonicMs: () => clock.mono, cfg, coord, notifyLog, tmux: new Tmux(run), viewers: { isVisible: () => false } };
  const watcher = quietAtTestEnd(new FleetWatcher(deps as never, new Bus(), 10_000));
  return { watcher, coord, clock };
};

describe('the run-close lane in the watcher', () => {
  it('is one row of LANE_SCHEDULE, on the monotonic clock, derived from the destructive lanes\' shared throttle', () => {
    const row = laneRow('runClose');
    expect(LANE_SCHEDULE.filter((r) => r.name === 'runClose')).toHaveLength(1);
    expect(row.clock).toBe('mono');
    expect(row.flight).toBe('skip');
    expect(row.cadenceMs).toBe(CHILD_RECLAIM_SWEEP_MS);
    expect(RUN_CLOSE_SWEEP_MS).toBe(CHILD_RECLAIM_SWEEP_MS);
    expect(row.derivedFrom?.name).toBe('childReclaim');
  });

  it('the busy-turn reading is unread until a tick has run, and a session never seen busy then reads null', async () => {
    const { watcher } = await fixture();
    expect(watcher.claimantBusyAt('demo-coord')).toBe('unread');
    await watcher.tick();
    expect(watcher.claimantBusyAt('demo-coord')).toBeNull();
  });

  it('a shadow pass anchors a planned programme, sends no mail and closes nothing', async () => {
    const { watcher, coord, clock } = await fixture();
    const r = coord.openRun({ program: 'programme-a', title: 'T', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    await watcher.tick();                 // the first tick primes the busy-turn reading, so its own pass has nothing to read yet
    clock.mono += CHILD_RECLAIM_SWEEP_MS + 1;
    await watcher.sweepRunClose();
    expect(coord.runCloseAnchors('never-started').has('programme-a'), 'the pass ran and anchored the programme').toBe(true);
    expect((coord.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n).toBe(0);
    expect((coord.run(r.id) as { run: { state: string } }).run.state).toBe('planned');
  });
});
