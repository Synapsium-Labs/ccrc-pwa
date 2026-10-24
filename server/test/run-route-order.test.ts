// ARCH-20 (GitHub #546): the characterization of `POST /api/runs/:id/route`'s
// gate ORDER, written green on the inline handler BEFORE its decision moved to
// `coord/route.ts`'s `decideRoute`, and unchanged after. The behaviours
// themselves (the fold, S5-R17, the ceiling) are pinned by
// `run-route-route.test.ts`; this file pins what that suite leaves open, which
// refusal wins when one request trips two. Each row seeds a request that trips
// BOTH named gates and asserts the earlier gate's whole answer, so swapping any
// two gates in the decider turns a row red (the PR's reorder mutants).
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';
import { ACTOR_FLAGS_CAP, ROUTE_CAP } from '../src/ccdargv.js';

const PROJECT = 'demo';
const CLAIMED_BY = 'ccrc-pwa-coordinator';
const TOKEN = 'f'.repeat(64);
// `homeProject` carried on every open (merge of origin/main f27c8a86): the
// legacy generation that accepted an open without one ended 2026-09-16
// (`HOME_PROJECT_LEGACY_ACCEPTED === false`, D-2867), so a bare body is now
// refused `400 bad-request`. This file's opens are SETUP for the routing door,
// never a claim about the home-project rule — it is `run-routes.test.ts`'s own
// `OPEN_BODY`, which main amended the same way.
const OPEN_BODY = { program: 'build4', title: 'Routing door', project: PROJECT,
  wave: 1, waveOf: 3, claimedBy: CLAIMED_BY, homeProject: PROJECT };

/** The same registry seed `run-routes.test.ts` uses for a `ws-add`-created
 *  session — copied rather than imported (that file's `seed` is not
 *  exported, and this is its whole body). */
const seed = (home: string, id: string, over: Partial<Record<string, string>> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

interface RunnerConfig {
  wsAddCreates?: string[];
  fail?: ReadonlySet<string>;
  routeStderr?: string;
}

/** A minimal runner covering `ws-add` (to give a dispatched run a real
 *  session id) and `route` (the verb this door calls) — everything else
 *  (`ensure`/`ws-hold`/`ws-release`) is a bare success, the dispatch route's
 *  own needs, not this door's. */
function makeRunner(home: string, cfg: RunnerConfig = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (verb === 'route' && cfg.fail?.has('route')) {
      return { code: 1, stdout: '', stderr: cfg.routeStderr ?? 'route failed' };
    }
    if (cfg.fail?.has(verb)) return { code: 1, stdout: '', stderr: `${verb} failed` };
    if (verb === 'ws-add') {
      const ids = cfg.wsAddCreates ?? [`${PROJECT}-fresh`];
      for (const id of ids) seed(home, id);
      return { code: 0, stdout: 'workspace demo-decoy on claude — /w/x (branch ws/decoy)', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

const openApp = async (
  home: string, run: Runner, over: Partial<Omit<Deps, 'cfg'>> & { cfg?: Partial<Deps['cfg']> } = {},
) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  // D-5298: the claimant the opens name is a registry row of the run's
  // project — unless the case already seeded it its own way.
  if (!existsSync(path.join(home, '.cc-sessions', `${CLAIMED_BY}.uuid`))) seed(home, CLAIMED_BY);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const app = await buildServer({ ...base, mailToken: TOKEN, coord, ...over, cfg: { ...base.cfg, ...(over.cfg ?? {}) } });
  return { app, coord, home };
};

/** `ccdVerbs` naming both the `route-v1` and `actor-flags-v1` capability
 *  tokens ccd's own `ccd caps` echoes — the shape `capSupported`/`sweepDec`
 *  both read (see `ccdargv.ts`: the same array carries verb names AND
 *  capability tokens). */
const ROUTE_READY_FLEET = {
  connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-add', 'ensure', 'ws-hold', ROUTE_CAP, ACTOR_FLAGS_CAP] as string[],
};

const tokenHeaders = (token: string | null): Record<string, string> =>
  token === null ? {} : { 'x-ccrc-mail-token': token };

/** D-5298 (coordinator-first Task 11b): an open is attributed against the
 *  claimant's own registry row — `seed`'s `u-<id>` uuid, sent unless the body
 *  names `claimedByUuid` itself. */
const attributed = (body: unknown): Record<string, unknown> => {
  const b = body as Record<string, unknown>;
  return typeof b?.claimedBy === 'string' && !('claimedByUuid' in b) ? { ...b, claimedByUuid: `u-${b.claimedBy}` } : b;
};
const postOpen = (app: FastifyInstance, body: unknown = OPEN_BODY, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: '/api/runs', headers: tokenHeaders(token),
    payload: attributed(body) });
const postDispatch = (app: FastifyInstance, id: number | string, body: unknown = { brief: 'do it' }, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, headers: tokenHeaders(token),
    payload: body as Record<string, unknown> });
const postRoute = (app: FastifyInstance, id: number | string, body: unknown, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/route`, headers: tokenHeaders(token),
    payload: body as Record<string, unknown> });

/** Opens + dispatches a run, returning its id and the ws-add-created session
 *  id. `sid` MUST be the same id the fixture's own `makeRunner` was built
 *  with (`wsAddCreates[0]`) — this helper does not re-derive it, so the two
 *  are read off one literal at each call site rather than risking drift. */
async function dispatchedRun(app: FastifyInstance, sid: string): Promise<{ id: number; sid: string }> {
  const opened = (await postOpen(app)).json() as { id: number };
  const res = await postDispatch(app, opened.id);
  expect(res.statusCode, 'setup: dispatch must succeed').toBe(200);
  return { id: opened.id, sid };
}


const BAD_BODY = { target: 'worker', why: 'x', kind: 'nonsense' };

describe('POST /api/runs/:id/route gate order (ARCH-20 characterization)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('the box token is checked before the id and the body', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const res = await postRoute(w.app, 'not-a-number', BAD_BODY, null);
    expect(res.statusCode).toBe(401);
  });

  it('a bad id is refused before the body is read', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const res = await postRoute(w.app, '007', BAD_BODY);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request', detail: 'id must be a positive safe integer' });
  });

  it('a malformed body is refused before the run is looked up', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const res = await postRoute(w.app, 9999, BAD_BODY);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('target and why are checked before the how (kind/demote/field)', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const res = await postRoute(w.app, 1, { target: 'nobody', why: 5, kind: 'a', demote: 'b' });
    expect(res.json()).toEqual({ ok: false, error: 'bad-request', detail: 'target must be "worker" or "coordinator"' });
    const res2 = await postRoute(w.app, 1, { target: 'worker', why: 5, kind: 'a', demote: 'b' });
    expect(res2.json()).toEqual({ ok: false, error: 'bad-request', detail: 'why must be a string' });
  });

  it('run-closed beats unsupported (a closed run on a box without route-v1)', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-fresh');
    w.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id);
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'run-closed', detail: 'run is done' });
  });

  it('run-closed beats no-session (a closed run that never had a session)', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const opened = (await postOpen(w.app)).json() as { id: number };
    w.coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(opened.id);
    const res = await postRoute(w.app, opened.id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.json()).toEqual({ ok: false, error: 'run-closed', detail: 'run is failed' });
  });

  it('no-session beats unsupported', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(w.app)).json() as { id: number };
    const res = await postRoute(w.app, opened.id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'no-session' });
  });

  it('bad-session beats unsupported', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home);
    seed(home, 'bad claimant');
    const w = await openApp(home, run); app = w.app;
    const seeded = w.coord.openRun({ program: 'build4', title: 'Routing door', project: PROJECT,
      wave: 1, waveOf: 3, claimedBy: 'bad claimant', homeProject: PROJECT });
    if (!('id' in seeded)) throw new Error(`fixture openRun refused: ${JSON.stringify(seeded)}`);
    const res = await postRoute(w.app, seeded.id, { target: 'coordinator', why: 'x', kind: 'shallow' });
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
  });

  it('unsupported beats no-record (no route-v1 and no .class)', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-o1'] });
    const w = await openApp(home, run); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-o1');
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
  });

  it('unsupported refuses a manual write too (the capability gate is before the manual arm)', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-o2'] });
    const w = await openApp(home, run); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-o2');
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', field: 'effort', value: 'low' });
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([]);
  });

  it('no-record (.class absent) beats an unreadable .effort', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-o3'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET, io: unreadableField('demo-o3', 'effort') }); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-o3');
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'no-record', field: 'class' });
  });

  it('an unreadable .class answers registry-unreadable naming class, before .effort is read', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-o4'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET, io: unreadableField('demo-o4', 'class') }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-o4');
    seed(home, sid, { class: 'opus', effort: 'high' });
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'registry-unreadable', file: 'class' });
  });

  it('an unreadable .effort beats an unrouteable .class', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-o5'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET, io: unreadableField('demo-o5', 'effort') }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-o5');
    seed(home, sid, { class: 'default', effort: 'high' });
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.json()).toEqual({ ok: false, error: 'registry-unreadable', file: 'effort' });
  });

  it('an unreadable .degraded beats an unrouteable .class', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-o6'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET, io: unreadableField('demo-o6', 'degraded') }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-o6');
    seed(home, sid, { class: 'default', effort: 'high', degraded: 'sonnet' });
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.json()).toEqual({ ok: false, error: 'registry-unreadable', file: 'degraded' });
  });

  it('an unrouteable .class beats an unrouteable .effort, which beats an unrouteable .degraded', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-o7'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-o7');
    seed(home, sid, { class: 'default', effort: 'bogus', degraded: 'nonsense' });
    const first = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(first.json()).toMatchObject({ ok: false, error: 'unrouteable-record', field: 'class' });
    seed(home, sid, { class: 'opus', effort: 'bogus', degraded: 'nonsense' });
    const second = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(second.json()).toMatchObject({ ok: false, error: 'unrouteable-record', field: 'effort' });
    seed(home, sid, { class: 'opus', effort: 'high', degraded: 'nonsense' });
    const third = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(third.json()).toMatchObject({ ok: false, error: 'unrouteable-record', field: 'degraded' });
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('route:'))).toBe(false);
  });

  it('a ladder refusal (floor) beats the degraded-record ceiling guard', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-o8'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-o8');
    seed(home, sid, { class: 'opus', effort: 'low', degraded: 'sonnet' });
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', demote: 'effort' });
    expect(res.json()).toEqual({ ok: false, error: 'floor', detail: 'low is the mechanical floor for effort' });
  });

  it('a ccd refusal on a ladder move answers fleetFailed with the stderr and records no event', async () => {
    const home = mkTmp('ccrc-route-order-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-o9'], fail: new Set(['route']), routeStderr: 'no' });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-o9');
    seed(home, sid, { class: 'opus', effort: 'high' });
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, error: 'fleetFailed', stderr: 'no' });
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('route:'))).toBe(false);
  });
});
