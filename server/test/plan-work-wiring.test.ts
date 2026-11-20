// Programme work map WM2 (review 2815 M7): `server.ts` hands the plan routes the watcher's run verdicts. The option is optional
// (`PlanRouteOpts.runVerdicts`), so deleting the line still compiles and `plan-routes.test.ts` (which builds the routes itself)
// stays green. This builds the REAL server over a real store and a real watcher, and reads the work map's `verdicts` word
// through the plan route: `read` only when the watcher's verdicts reach it, `not-read` when nothing does. Neutral names.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { planStorePort } from '../src/coord/planStore.js';
import type { WorkAnswer } from '../../shared/plan.js';
import { ID_GATE_TOKEN, recorder } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

let app: FastifyInstance | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = null;
  removeTmpFixtures();
});

describe('the plan read through the real server carries the watcher\'s run verdicts (review 2815 M7)', () => {
  it('the work map reads verdicts `read` once the watcher holds one, so the server handed the routes its run verdicts', async () => {
    const home = mkTmp('ccrc-plan-work-wiring-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps = { ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN, coord, plan: planStorePort(coord.db) };
    const bus = new Bus();
    const watcher = quietAtTestEnd(new FleetWatcher(deps, bus, 10_000));
    app = await buildServer(deps, bus, watcher);
    const opened = coord.openRun({ program: 'prog-a', title: 'Prog A', project: 'project-a', wave: 1, waveOf: 1, claimedBy: 'lane-a', homeProject: 'project-a' });
    if (!('id' in opened)) throw new Error('open refused');
    watcher.runVerdicts.replace(new Map([[opened.id, { stuck: null, blockedBy: null, coordinatorGone: false }]]), new Map());
    const res = await app.inject({ method: 'GET', url: '/api/programmes/prog-a/plan' });
    expect(res.statusCode, res.body).toBe(200);
    const work = (res.json() as { work: WorkAnswer }).work;
    if ('unreadable' in work) throw new Error(`work unreadable: ${work.unreadable}`);
    expect(work.verdicts).toBe('read');
  });
});
