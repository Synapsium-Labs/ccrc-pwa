// Task 2 (routing slice 5): `POST /api/runs/:id/route` — the coordinator's
// door onto `shared/routing-ladder.ts`'s `escalate()`/`demote()`. Reuses
// `run-routes.test.ts`'s own harness (`makeRunner`/`openApp`/`seed`) rather
// than re-deriving it — see that file for what each helper actually does.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const OPEN_BODY = { program: 'build4', title: 'Routing door', project: PROJECT,
  wave: 1, waveOf: 3, claimedBy: CLAIMED_BY };

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

const postOpen = (app: FastifyInstance, body: unknown = OPEN_BODY, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: '/api/runs', headers: tokenHeaders(token),
    payload: body as Record<string, unknown> });
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

describe('POST /api/runs/:id/route', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('401s without the box token', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-fresh');
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' }, null);
    expect(res.statusCode).toBe(401);
  });

  it('400s when the body names two of kind/demote/field', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-fresh');
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow', demote: 'effort' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('400s when the body names none of kind/demote/field', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-fresh');
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('400s on a why with a newline', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-fresh');
    const res = await postRoute(w.app, id, { target: 'worker', why: 'line1\nline2', kind: 'shallow' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('404s on an unknown run', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const res = await postRoute(w.app, 999999, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-run' });
  });

  it('409s run-closed on a done run', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-fresh');
    w.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id);
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'run-closed' });
  });

  it('409s no-session on a dispatched run with no sessionId for target worker', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const opened = (await postOpen(w.app)).json() as { id: number };
    // Never dispatched — sessionId stays null; force the state directly
    // rather than through the dispatch route, which requires a session.
    w.coord.db.prepare("UPDATE runs SET state = 'dispatched' WHERE id = ?").run(opened.id);
    const res = await postRoute(w.app, opened.id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'no-session' });
  });

  it('501s without the route-v1 capability', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home);
    // No fleetState override: testDeps() leaves it absent, so capSupported
    // answers false for every token — the no-evidence default.
    const w = await openApp(home, run); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-fresh');
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
  });

  it('kind: shallow on a worker at opus·high escalates effort to xhigh, one run event', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w1'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w1');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'checks failed', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh', kind: 'shallow' },
    });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([
      ['route', '--session', sid, '--set', 'effort=xhigh', '--actor', `run:${id} coordinator`,
        '--reason', 'escalate shallow: checks failed'],
    ]);
    const events = w.coord.runEvents(id);
    expect(events.map((e) => e.detail)).toContain('route:escalate:effort:high->xhigh:shallow');
  });

  it('kind: ceiling on a degraded session answers 409 ceiling — the record already intends the served class', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w2'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w2');
    seed(home, sid, { class: 'fable', effort: 'high', degraded: 'opus' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'ceiling reached', kind: 'ceiling' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      ok: false, error: 'ceiling',
      detail: 'the record already intends fable; the lane serves opus (degraded)',
    });
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('route:'))).toBe(false);
  });

  it('demote: effort on opus·high demotes to medium, one run event', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w3'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w3');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'slow down', demote: 'effort' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'demote', field: 'effort', from: 'high', to: 'medium', kind: null },
    });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([
      ['route', '--session', sid, '--set', 'effort=medium', '--actor', `run:${id} coordinator`,
        '--reason', 'demote: slow down'],
    ]);
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain('route:demote:effort:high->medium:manual');
  });

  it('a second kind: shallow after a demotion reverses it first — reverse-demotion, no ladder move', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w4'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w4');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const demoted = await postRoute(w.app, id, { target: 'worker', why: 'slow down', demote: 'effort' });
    expect(demoted.statusCode).toBe(200);

    // The stubbed ccd never rewrites the registry file, so `.effort` still
    // reads 'high' — proving `lastDemotion` is read from the run's OWN event
    // trail, never from a re-read of the record.
    const res = await postRoute(w.app, id, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'reverse-demotion', field: 'effort', from: 'medium', to: 'high', kind: 'shallow' },
    });
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain('route:reverse-demotion:effort:medium->high:shallow');
  });

  it('manual field/value writes the argv as given and records mode manual with from "?"', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w5'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w5');

    const res = await postRoute(w.app, id, { target: 'worker', why: 'operator judgement', field: 'subagent', value: 'opus' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'manual', field: 'subagent', from: '?', to: 'opus', kind: null },
    });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([
      ['route', '--session', sid, '--set', 'subagent=opus', '--actor', `run:${id} coordinator`,
        '--reason', 'manual: operator judgement'],
    ]);
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain('route:manual:subagent:?->opus:manual');
  });

  it('a ccd refusal on a manual write answers 502 fleetFailed and records NO run event', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w6'], fail: new Set(['route']), routeStderr: 'bad value for subagent' });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-w6');

    const res = await postRoute(w.app, id, { target: 'worker', why: 'operator judgement', field: 'subagent', value: 'bogus' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, error: 'fleetFailed', stderr: 'bad value for subagent' });
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('route:'))).toBe(false);
  });

  it('503s registry-unreadable on an unreadable .effort file', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w7'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET, io: unreadableField('demo-w7', 'effort') });
    app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w7');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'registry-unreadable', file: 'effort' });
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('route:'))).toBe(false);
  });
});
