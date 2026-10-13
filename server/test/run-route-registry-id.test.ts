// Path identity W1a, Task 10 (spec §2.3): the routing door re-checks the id it
// READS OFF A STORED RUN ROW with THE registry-id predicate, `isRegistryId`,
// before it reads a routing field, composes a `route` argv or writes a `route:`
// event. The check it replaces, `isSessionIdShape`, admits `--actor`.
//
// The door reads `.class`/`.effort`/`.degraded` through `fieldMeasured` on
// `$REG/<sid>.<field>` directly, never through `readRegistry`, so a refused
// registry row is NOT omitted in front of it. A manual-field write reads no
// field at all. So every `--actor` case below plants `--actor`'s row (and the
// two fields the ladder reads) and advertises `ROUTE_CAP`: with the gate
// gone, each case composes `route --session --actor` and answers 200. Only
// the predicate can refuse.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ACTOR_FLAGS_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import type { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { appFor, recorder, seedRow, storedRun } from './idGateFixture.js';
import { REFUSED_IDS } from './registryIdCases.js';

const TOKEN = 'f'.repeat(64);
const COORDINATOR = 'demo-coordinator';

/** `capSupported(ROUTE_CAP)` passes, so the door's 501 cannot answer first, and
 *  `sweepDec` composes `--actor run:<id> coordinator`: the argv shape
 *  `run-route-route.test.ts` pins. */
const ROUTE_READY_FLEET = {
  connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: [ROUTE_CAP, ACTOR_FLAGS_CAP] as string[],
};

const ESCALATE = { why: 'checks failed', kind: 'shallow' } as const;
const MANUAL = { why: 'operator judgement', field: 'subagent', value: 'opus' } as const;

interface Rig {
  app: FastifyInstance;
  coord: CoordStore;
  home: string;
  registryDir: string;
  calls: string[][];
}

async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-route-id-');
  const { run, calls } = recorder();
  const { app, coord, cfg } = await appFor(home, run, { mailToken: TOKEN, fleetState: ROUTE_READY_FLEET });
  return { app, coord, home, registryDir: cfg.registryDir, calls };
}

/** Plants `id`'s registry row and the two fields the ladder reads (opus·high),
 *  so the door would route it if nothing but the predicate stood in the way. */
function plantRoutable(w: Rig, id: string): void {
  seedRow(w.home, id);
  writeFileSync(path.join(w.registryDir, `${id}.class`), 'opus');
  writeFileSync(path.join(w.registryDir, `${id}.effort`), 'high');
  expect(existsSync(path.join(w.registryDir, `${id}.uuid`)), `setup: ${id}'s row is planted where the server reads`)
    .toBe(true);
}

const postRoute = (app: FastifyInstance, id: number, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST', url: `/api/runs/${id}/route`,
    headers: { 'x-ccrc-mail-token': TOKEN }, payload: body,
  });

const routeCalls = (calls: string[][]): string[][] => calls.filter((c) => c[0] === 'route');

const routeEvents = (coord: CoordStore, id: number): string[] =>
  coord.runEvents(id).map((e) => e.detail ?? '').filter((d) => d.startsWith('route:'));

describe('the routing door refuses a stored id that is not a registry id (spec §2.3)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('the coordinator target with a stored claimedBy of --actor answers 409 bad-session', async () => {
    const w = await rig(); app = w.app;
    plantRoutable(w, '--actor');
    const id = storedRun(w.coord, { state: 'working', sessionId: null, claimedBy: '--actor' });

    const res = await postRoute(w.app, id, { target: 'coordinator', ...ESCALATE });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(routeCalls(w.calls), 'no route argv is composed').toEqual([]);
    expect(routeEvents(w.coord, id), 'no route: event is written').toEqual([]);
  });

  it('the worker target with a stored sessionId of --actor answers 409 bad-session', async () => {
    const w = await rig(); app = w.app;
    plantRoutable(w, '--actor');
    const id = storedRun(w.coord, { state: 'working', sessionId: '--actor', claimedBy: COORDINATOR });

    const res = await postRoute(w.app, id, { target: 'worker', ...ESCALATE });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(routeCalls(w.calls), 'no route argv is composed').toEqual([]);
    expect(routeEvents(w.coord, id), 'no route: event is written').toEqual([]);
  });

  it('a manual-field write to a stored --actor answers 409 bad-session', async () => {
    const w = await rig(); app = w.app;
    plantRoutable(w, '--actor');
    const id = storedRun(w.coord, { state: 'working', sessionId: '--actor', claimedBy: COORDINATOR });

    const res = await postRoute(w.app, id, { target: 'worker', ...MANUAL });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(routeCalls(w.calls), 'no route argv is composed').toEqual([]);
    expect(routeEvents(w.coord, id), 'no route: event is written').toEqual([]);
  });

  // Every refused id, as a stored worker id, on the one path that reads no
  // registry field: a manual write. No row is planted, because `'x'.repeat(256)`
  // plus `.uuid` is longer than a file name may be, and a manual write would not
  // read one anyway.
  it.each(REFUSED_IDS)('a manual-field write to a stored sessionId of %j answers 409 bad-session', async (bad) => {
    const w = await rig(); app = w.app;
    const id = storedRun(w.coord, { state: 'working', sessionId: bad, claimedBy: COORDINATOR });

    const res = await postRoute(w.app, id, { target: 'worker', ...MANUAL });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(routeCalls(w.calls), 'no route argv is composed').toEqual([]);
    expect(routeEvents(w.coord, id), 'no route: event is written').toEqual([]);
  });

  it('control: a stored a--actor routes', async () => {
    const w = await rig(); app = w.app;
    plantRoutable(w, 'a--actor');
    const id = storedRun(w.coord, { state: 'working', sessionId: 'a--actor', claimedBy: COORDINATOR });

    const res = await postRoute(w.app, id, { target: 'worker', ...ESCALATE });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      applied: { session: 'a--actor', mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh', kind: 'shallow', effortReset: null },
    });
    expect(routeCalls(w.calls)).toEqual([
      ['route', '--session', 'a--actor', '--set', 'effort=xhigh', '--actor', `run:${id} coordinator`,
        '--reason', 'escalate shallow: checks failed'],
    ]);
    expect(routeEvents(w.coord, id)).toEqual(['route:escalate:effort:high->xhigh:shallow:a--actor']);
  });

  it('control: a stored coordinator a.--actor routes', async () => {
    const w = await rig(); app = w.app;
    plantRoutable(w, 'a.--actor');
    const id = storedRun(w.coord, { state: 'working', sessionId: null, claimedBy: 'a.--actor' });

    const res = await postRoute(w.app, id, { target: 'coordinator', ...ESCALATE });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      applied: { session: 'a.--actor', mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh', kind: 'shallow', effortReset: null },
    });
    expect(routeCalls(w.calls)).toEqual([
      ['route', '--session', 'a.--actor', '--set', 'effort=xhigh', '--actor', `run:${id} coordinator`,
        '--reason', 'escalate shallow: checks failed'],
    ]);
    expect(routeEvents(w.coord, id)).toEqual(['route:escalate:effort:high->xhigh:shallow:a.--actor']);
  });
});
