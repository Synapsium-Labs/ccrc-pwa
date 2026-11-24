// The coordinator advisor's count lane through the watcher (plan 2026-11-23-coordinator-advisor PR C; review R2-5): the poll
// dispatches `sweepAdvisorCount`, so a cap that is never counted cannot pass the suite; and the fleet assembly attaches the
// readout. Fixture HOMEs only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { FleetWatcher } from '../src/watch.js';
import { assembleFleet } from '../src/fleet.js';
import { liveStateReaderOver } from '../src/livestate.js';
import { Tmux } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { seedRoster, testDeps } from './helpers.js';
import { quietWatcher } from './laneQuiet.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);
const NOW_S = 1784600000;

describe('the watcher', () => {
  it('tick() dispatches the advisor count lane', async () => {
    const home = mkTmp('ccrc-advisor-tick-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps = { ...testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' })), cfg, coord };
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const spy = vi.spyOn(w, 'sweepAdvisorCount').mockResolvedValue(undefined);
      await w.tick();
      await w.tick();
      expect(spy).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await quietWatcher(w);
      coord.db.close();
    }
  });
});

describe('the fleet assembly carries the readout (review R2-5)', () => {
  it('a session whose spawn applied the advisor has `advisor` on its fleet row; one the advisor never touched has none', async () => {
    const home = mkTmp('ccrc-advisor-fleet-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const seed = (id: string, extra: Record<string, string>): void => {
      const fields = { wrapper: 'claude', project: 'demo', workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1', ...extra };
      for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
    };
    seed('demo-coord', { advisorspawn: `fable ${NOW_S - 600}` });
    seed('demo-plain', {});
    const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));
    const dead = new Tmux(async () => ({ ran: true, code: 1, stdout: '', stderr: '' }));
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), dead, liveStateReaderOver(localIO), NOW_S, { coord });
    expect(fleet.find((s) => s.id === 'demo-coord')?.advisor).toMatchObject({ state: 'requested', model: 'fable', today: 0 });
    expect('advisor' in fleet.find((s) => s.id === 'demo-plain')!).toBe(false);
  });
});
