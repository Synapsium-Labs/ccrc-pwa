// D-8147: the visibility lane is fed EVERY listed project, not only those with a workspace session, so a project just
// added (no registry row yet) still gets its reading.
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

describe('the watcher feeds the visibility lane the walked project list', () => {
  it('a project under the projects root with no workspace session is measured', async () => {
    const home = mkTmp('ccrc-vis-watch-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    mkdirSync(path.join(home, 'projects', 'project-new'), { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const calls: string[][] = [];
    const run: Runner = async (_c, args) => {
      calls.push(args);
      if (args[0] === 'repo-visibility') {
        return { ran: true, code: 0, stdout: '{"slug":"owner/repo","visibility":"public","defaultBranch":"main","template":"absent"}\n', stderr: '' };
      }
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const base = testDeps(home, run);
    const deps = withFakeClock({ ...base, cfg: { ...base.cfg, projectsRoot: path.join(home, 'projects') }, coord });
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'repo-visibility')).toEqual([['repo-visibility', '--project', 'project-new']]));
    await vi.waitFor(() => expect(coord.linkingOf('project-new').mode).toBe('public'));
    w.stop();
    coord.db.close();
  });
});
