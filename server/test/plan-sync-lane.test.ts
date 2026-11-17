// D-8182: the watcher's tick runs the Linear plan sync lane: `planSync.tick(wall)` once per due beat. A lane starts due, so
// the first tick after a start runs it. Behavioural: a stand-in plan sync records its calls.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { PlanSync } from '../src/linear/planSync.js';
import { FleetWatcher } from '../src/watch.js';
import { seedRoster, testDeps } from './helpers.js';
import { quietWatcher } from './laneQuiet.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { removeTmpFixtures(); });

describe('the watcher\'s plan sync lane', () => {
  it('tick() calls planSync.tick with the wall clock\'s reading', async () => {
    const home = mkTmp('ccrc-plan-lane-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const ticks: number[] = [];
    const planSync = { tick: async (now: number) => { ticks.push(now); } } as unknown as PlanSync;
    const base = testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' }));
    const deps = { ...base, cfg, coord, planSync };
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    try {
      await w.tick();
      await quietWatcher(w);
      expect(ticks).toEqual([base.time.clock.wall()]);
    } finally {
      await quietWatcher(w);
      coord.db.close();
    }
  });
});
