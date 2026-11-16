// D-8147: the visibility lane is fed EVERY listed project, not only those with a workspace session, so a project just
// added (no registry row yet) still gets its reading.
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { putLinearSlot } from '../src/linear/store.js';
import { keyTailOf } from '../src/linear/connection.js';
import { valueDigestHex } from '../src/token/files.js';
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
    const w = quietAtTestEnd(new FleetWatcher(deps, new Bus(), 10_000));
    await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'repo-visibility')).toEqual([['repo-visibility', '--project', 'project-new']]));
    await vi.waitFor(() => expect(coord.linkingOf('project-new').mode).toBe('public'));
    w.stop();
    coord.db.close();
  });
});

describe('D-8405: the team link runs on the same cadence, after the visibility step', () => {
  it('a project whose name is a team\'s name, in a workspace the box holds a key for, is linked automatically', async () => {
    const home = mkTmp('ccrc-team-watch-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    mkdirSync(path.join(home, 'projects', 'project-new'), { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    // A workspace key the box holds, built at run time (a fixture, not a key), whose record learned two teams.
    const key = `lin_api_${'f'.repeat(40)}`;
    await putLinearSlot(path.join(home, '.ccrc'), key, {
      workspaceId: '00000000-0000-4000-8000-0000000000a1', name: 'Workspace A', urlKey: 'ws-a', user: 'User A',
      teams: [{ id: '00000000-0000-4000-8000-0000000000b1', key: 'AAA', name: 'Alpha' },
        { id: '00000000-0000-4000-8000-0000000000b2', key: 'NEW', name: 'project-new' }],
      teamsAt: 1, keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: 1, outcome: 'ok',
    }, { replace: true });
    const run: Runner = async (_c, args) => {
      if (args[0] === 'repo-visibility') {
        return { ran: true, code: 0, stdout: '{"slug":"owner/repo","visibility":"public","defaultBranch":"main","template":"absent"}\n', stderr: '' };
      }
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const base = testDeps(home, run);
    const deps = withFakeClock({ ...base, cfg: { ...base.cfg, projectsRoot: path.join(home, 'projects') }, coord });
    const w = quietAtTestEnd(new FleetWatcher(deps, new Bus(), 10_000));
    await w.tick();
    await vi.waitFor(() => expect(coord.linkingOf('project-new')).toMatchObject({
      teamKey: 'NEW', teamLink: { source: 'auto', teamName: 'project-new', evidence: { kind: 'name-match', matched: 'project', on: 'name' } },
    }));
    w.stop();
    coord.db.close();
  });
});
