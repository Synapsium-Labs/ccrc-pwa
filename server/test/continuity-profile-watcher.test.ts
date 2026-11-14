// server/test/continuity-profile-watcher.test.ts
//
// The launch-profile lane through the watcher (Overlord W1a launch profiles PR B; review 2024 F1): `sweepLaunchProfile`
// drives the real steer-marker read, so the path it asks the fleet io for, and how that answer maps, are measured here,
// not stubbed. A session whose marker stands is skipped; one whose marker could not be read is skipped; only a proven
// absence lets the pass count a write. In remote mode the agent admits a `stat` of that one path (`checkSteerOnStat`,
// pinned in the agent's suites), so the read is measured there too, never `forbidden`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HISTORY_STEER_ON_DIR } from '../../shared/agent-protocol.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { FleetIO, MeasuredStat } from '../src/io.js';
import { FleetWatcher } from '../src/watch.js';
import { seedRoster, testDeps } from './helpers.js';
import { quietWatcher } from './laneQuiet.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ID = 'lane-a-project-a';

afterEach(removeTmpFixtures);

/** One shadow pass over one never-routed plain session, with the fleet io's `stat` answered by `answer` (or the real
 *  file system when it is null); returns the paths `stat` was asked and the lane's line. */
async function pass(answer: MeasuredStat | 'throw' | null, plant = false): Promise<{ asked: string[]; line: string; ccrcDir: string }> {
  const home = mkTmp('ccrc-profile-watch-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  if (plant) {
    mkdirSync(path.join(cfg.ccrcDir, HISTORY_STEER_ON_DIR), { recursive: true });
    writeFileSync(path.join(cfg.ccrcDir, HISTORY_STEER_ON_DIR, ID), '');
  }
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home);
  const asked: string[] = [];
  const io = new Proxy(base.io, {
    get(t, k) {
      if (k === 'statMeasured') {
        return async (p: string): Promise<MeasuredStat> => {
          asked.push(p);
          if (answer === 'throw') throw new Error('link dropped');
          return answer ?? t.statMeasured(p);
        };
      }
      const v = Reflect.get(t, k) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  }) as FleetIO;
  const w = new FleetWatcher({ ...base, cfg, coord, io } as never, new Bus(), 10_000);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await w.sweepLaunchProfile([{ id: ID, child: { kind: 'none' }, route: null } as never]);
    const line = warn.mock.calls.flat().map(String).find((l) => l.startsWith('ccrc-server: launch-profile')) ?? '';
    return { asked, line, ccrcDir: cfg.ccrcDir };
  } finally {
    warn.mockRestore();
    await quietWatcher(w);
    coord.db.close();
  }
}

describe('the watcher\'s steer-marker read (review 2024 F1)', () => {
  it('asks the fleet io for <ccrcDir>/history/steer-on/<id>, and a proven absence lets the pass count its write', async () => {
    const r = await pass(null);
    expect(r.asked).toEqual([`${r.ccrcDir}/${HISTORY_STEER_ON_DIR}/${ID}`]);
    expect(r.line).toBe('ccrc-server: launch-profile (shadow): 1 session(s) would get a route write (profile 1, automem 1)');
  });

  it('a marker that stands on disk skips the session whole', async () => {
    const r = await pass(null, true);
    expect(r.asked).toHaveLength(1);
    expect(r.line).toContain('every route already names its launch profile; skipped 1 carrying the history W3 steer marker');
  });

  it('an unreadable answer (the agent\'s refusal reads so), or a read that throws, skips it as unread', async () => {
    for (const answer of [{ ok: false, reason: 'unreadable' } as MeasuredStat, 'throw' as const]) {
      const r = await pass(answer);
      expect(r.asked, String(answer)).toHaveLength(1);
      expect(r.line, String(answer)).toContain('skipped 1 whose steer marker could not be read');
    }
  });
});
