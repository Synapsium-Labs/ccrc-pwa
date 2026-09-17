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

  it('409s run-closed on a failed run', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-fresh');
    w.coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(id);
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'run-closed' });
  });

  // Review finding #6, controller ruling S5-R4: the routable set is DERIVED
  // as "every RunState NOT in TERMINAL_RUN_STATES", not a hand-typed
  // three-state list — `unknown` (an ACTIVE state that holds a dispatch
  // slot, `shared/api.ts`'s `ACTIVE_RUN_STATES`) and `merging` (an IDLE
  // state) both PASS this gate, unlike the old inline
  // `['dispatched','working','awaiting-review']`, which would have refused
  // both as `run-closed`.

  it('a run in state unknown passes the state gate (proceeds to the next gate, here a successful escalation)', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w15'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w15');
    seed(home, sid, { class: 'opus', effort: 'high' });
    w.coord.db.prepare("UPDATE runs SET state = 'unknown' WHERE id = ?").run(id);

    const res = await postRoute(w.app, id, { target: 'worker', why: 'checks failed', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, applied: { mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh' } });
  });

  it('a run in state merging passes the state gate (proceeds to the next gate, here a successful escalation)', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w16'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w16');
    seed(home, sid, { class: 'opus', effort: 'high' });
    w.coord.db.prepare("UPDATE runs SET state = 'merging' WHERE id = ?").run(id);

    const res = await postRoute(w.app, id, { target: 'worker', why: 'checks failed', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, applied: { mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh' } });
  });

  it('a planned run (never dispatched) passes the state gate and refuses no-session, not run-closed', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const opened = (await postOpen(w.app)).json() as { id: number };
    const res = await postRoute(w.app, opened.id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'no-session' });
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

  // Review finding #7: four declared refusal codes had no test — the whole
  // generic ladder-refusal arm (`floor`/`no-effort-rungs`) and both
  // `no-record` absent arms. Each asserts the WHOLE body (the mutation this
  // finding names is `error: target.kind` -> `'ceiling'`, or dropping
  // `detail: target.why`, either of which only a whole-body assertion catches).

  it('409s floor when demoting effort already at the mechanical floor (low)', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w17'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w17');
    seed(home, sid, { class: 'opus', effort: 'low' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'too slow already', demote: 'effort' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'floor', detail: 'low is the mechanical floor for effort' });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([]);
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('route:'))).toBe(false);
  });

  it('409s no-effort-rungs on a kind escalation for a session at ultracode', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w18'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w18');
    seed(home, sid, { class: 'opus', effort: 'ultracode' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'checks failed', kind: 'shallow' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      ok: false, error: 'no-effort-rungs',
      detail: 'ultracode has no effort rungs; its next rung is a class rung the caller decides',
    });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([]);
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('route:'))).toBe(false);
  });

  it('409s no-record naming class when the session has no .class file at all', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w19'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    // dispatchedRun's own `seed` (in makeRunner's `ws-add` stub) writes no
    // `class`/`effort` file — this is that absent-record state as-is.
    const { id } = await dispatchedRun(w.app, 'demo-w19');

    const res = await postRoute(w.app, id, { target: 'worker', why: 'checks failed', kind: 'shallow' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'no-record', field: 'class' });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([]);
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('route:'))).toBe(false);
  });

  // Ruling S5-R18 (final review, finding #5): `.class` present with
  // `.effort` ABSENT is `effort: 'auto'` — the record's own vocabulary for
  // "no override, the model's default" — never `no-record`; `no-record` is
  // reserved for an absent `.class` (the test above). A session with a
  // class but no effort override is reachable without corruption — ccd
  // route and the PWA class picker each write ONE field.
  it('escalates from auto when .class exists but .effort does not (S5-R18) — auto counts as high, shallow -> xhigh, one run event', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w20'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w20');
    seed(home, sid, { class: 'opus' }); // no `effort` override — no `.effort` file at all

    const res = await postRoute(w.app, id, { target: 'worker', why: 'checks failed', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'escalate', field: 'effort', from: 'auto', to: 'xhigh', kind: 'shallow', effortReset: null },
    });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([
      ['route', '--session', sid, '--set', 'effort=xhigh', '--actor', `run:${id} coordinator`,
        '--reason', 'escalate shallow: checks failed'],
    ]);
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain(`route:escalate:effort:auto->xhigh:shallow:${sid}`);
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
      ok: true, applied: { session: sid, mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh', kind: 'shallow', effortReset: null },
    });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([
      ['route', '--session', sid, '--set', 'effort=xhigh', '--actor', `run:${id} coordinator`,
        '--reason', 'escalate shallow: checks failed'],
    ]);
    const events = w.coord.runEvents(id);
    expect(events.map((e) => e.detail)).toContain(`route:escalate:effort:high->xhigh:shallow:${sid}`);
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
      ok: true, applied: { session: sid, mode: 'demote', field: 'effort', from: 'high', to: 'medium', kind: null, effortReset: null },
    });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([
      ['route', '--session', sid, '--set', 'effort=medium', '--actor', `run:${id} coordinator`,
        '--reason', 'demote: slow down'],
    ]);
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain(`route:demote:effort:high->medium:manual:${sid}`);
  });

  // Final review, finding #1: A CLASS RUNG IS TWO `--set` PAIRS IN ONE ARGV.
  // Spec §3 — "A class rung resets effort to the new class's matrix row,
  // never carries the old level across" — and both ladder arms SAY so in
  // their `why`. Until this pair of cases the class rung was pinned by
  // nothing at the door (the only `kind: 'ceiling'` case above is the
  // DEGRADED 409), and the door sent one `--set`: a silently wrong effort on
  // every class escalation, and on `demote: class` off sonnet a guaranteed
  // 502 — `cmd_route` dies on `class haiku` beside a level, "whether it
  // arrives in one call or across two".

  it('kind: ceiling on a worker at sonnet·xhigh escalates class to opus AND resets effort to high in ONE argv', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w21'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w21');
    seed(home, sid, { class: 'sonnet', effort: 'xhigh' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'a design flaw it could not see', kind: 'ceiling' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      applied: { session: sid, mode: 'escalate', field: 'class', from: 'sonnet', to: 'opus',
        kind: 'ceiling', effortReset: 'high' },
    });
    // ONE argv, both pairs — `CCD_ARGV.routeSet`, never two `route` calls
    // (S4-R5): `cmd_route` validates every pair before its write loop, so one
    // argv is all-or-nothing. `xhigh` does NOT travel across the class rung.
    expect(calls.filter((c) => c[0] === 'route')).toEqual([
      ['route', '--session', sid, '--set', 'class=opus', '--set', 'effort=high',
        '--actor', `run:${id} coordinator`, '--reason', 'escalate ceiling: a design flaw it could not see'],
    ]);
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain(`route:escalate:class:sonnet->opus:ceiling:${sid}`);
  });

  it('demote: class off sonnet lands on haiku with effort=auto in the same argv — the pair ccd refuses when it arrives without one', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w22'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w22');
    seed(home, sid, { class: 'sonnet', effort: 'high' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'three clean waves', demote: 'class' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      applied: { session: sid, mode: 'demote', field: 'class', from: 'sonnet', to: 'haiku',
        kind: null, effortReset: 'auto' },
    });
    // `auto`, not `high`: haiku takes no effort LEVEL, and `auto` is the
    // absent-equivalent (spec §5.1) — ccd's own remedy sentence ("set
    // effort=auto or pick another class"). A bare `--set class=haiku` here is
    // the 502 this case exists to keep out of the fleet.
    expect(calls.filter((c) => c[0] === 'route')).toEqual([
      ['route', '--session', sid, '--set', 'class=haiku', '--set', 'effort=auto',
        '--actor', `run:${id} coordinator`, '--reason', 'demote: three clean waves'],
    ]);
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain(`route:demote:class:sonnet->haiku:manual:${sid}`);
  });

  it('a second kind: shallow after a demotion reverses it first — reverse-demotion, no ladder move', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w4'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w4');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const demoted = await postRoute(w.app, id, { target: 'worker', why: 'slow down', demote: 'effort' });
    expect(demoted.statusCode).toBe(200);

    // The stub doesn't run real ccd, so this seed stands in for the write
    // ccd's own `route` verb makes to the registry on every call regardless
    // of `--apply` (spec: `--apply` gates only whether ccd also types the
    // change into the live pane, never whether the record itself is
    // written) — `.effort` now reads 'medium', matching `lastDemotion.to`,
    // so this is THIS door's own write, not an out-of-band supersession
    // (S5-R17), and the reversal below fires normally: `lastDemotion` is
    // read from the run's OWN event trail, never from a re-read of the
    // record — this case's `.effort` measurement below is the CONTROL for
    // the out-of-band case (S5-R17's own test), agreeing with it rather than
    // disagreeing.
    seed(home, sid, { class: 'opus', effort: 'medium' });
    const res = await postRoute(w.app, id, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'reverse-demotion', field: 'effort', from: 'medium', to: 'high', kind: 'shallow', effortReset: null },
    });
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain(`route:reverse-demotion:effort:medium->high:shallow:${sid}`);
  });

  // Final review, finding #3, controller ruling S5-R17: a `reverse-demotion`
  // whose `from` (`lastDemotion.to`) differs from the field's MEASURED live
  // value is a demotion superseded OUT OF BAND — by the PWA picker's `POST
  // /api/sessions/:id/route`, or by ccd directly — neither of which writes a
  // run event this door's trail could see. The door must not name a rung the
  // session was never actually on: it clears `lastDemotion` and applies the
  // plain ladder from what is really on the record. This case writes
  // `.effort` directly (bypassing this door entirely, the way that
  // out-of-band write would) between the demotion and the failure; the test
  // above (no out-of-band write) is this case's own control and still
  // reverses.
  it('an out-of-band write after a demotion supersedes the reversal — a plain escalate from the measured value, never a stale reverse-demotion (S5-R17)', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w24'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w24');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const demoted = await postRoute(w.app, id, { target: 'worker', why: 'slow down', demote: 'effort' });
    expect(demoted.statusCode).toBe(200);
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain(`route:demote:effort:high->medium:manual:${sid}`);

    // Out of band: something other than this door (the PWA class picker,
    // ccd itself) wrote `.effort` directly — no run event records it, so
    // `lastDemotion` still reads the demotion above.
    seed(home, sid, { class: 'opus', effort: 'low' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'escalate', field: 'effort', from: 'low', to: 'medium', kind: 'shallow', effortReset: null },
    });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([
      ['route', '--session', sid, '--set', 'effort=medium', '--actor', `run:${id} coordinator`,
        '--reason', 'demote: slow down'],
      ['route', '--session', sid, '--set', 'effort=medium', '--actor', `run:${id} coordinator`,
        '--reason', 'escalate shallow: failed again'],
    ]);
    const details = w.coord.runEvents(id).map((e) => e.detail);
    expect(details).toContain(`route:escalate:effort:low->medium:shallow:${sid}`);
    expect(details.some((d) => d?.startsWith('route:reverse-demotion:'))).toBe(false);
  });

  // Review finding #8, controller ruling S5-R5: a `route:manual:<field>:`
  // event on the DEMOTED field clears `lastDemotion` — the manual write
  // superseded the demotion, so the next failure must not "reverse" a rung
  // that is gone. A manual write on some OTHER field leaves a standing
  // demotion untouched.

  it('a manual write on the demoted field clears lastDemotion — the next failure is a plain ladder escalation, not a reversal of a superseded demotion', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w13'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w13');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const demoted = await postRoute(w.app, id, { target: 'worker', why: 'slow down', demote: 'effort' });
    expect(demoted.statusCode).toBe(200);

    const manual = await postRoute(w.app, id, { target: 'worker', why: 'operator judgement', field: 'effort', value: 'high' });
    expect(manual.statusCode).toBe(200);

    // The stubbed ccd never rewrites the registry, so `.effort` still reads
    // its original 'high' — the point of this test is that the manual event
    // clears `lastDemotion`, so this call reaches the PLAIN escalate arm
    // (which reads `.effort` fresh) instead of the reversal arm (which
    // would answer purely off the now-superseded `lastDemotion` bookkeeping
    // regardless of what `.effort` says).
    const res = await postRoute(w.app, id, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh', kind: 'shallow', effortReset: null },
    });
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain(`route:escalate:effort:high->xhigh:shallow:${sid}`);
  });

  it('a manual write on a different field leaves a standing demotion in place — it still reverses on the next failure', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w14'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w14');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const demoted = await postRoute(w.app, id, { target: 'worker', why: 'slow down', demote: 'effort' });
    expect(demoted.statusCode).toBe(200);
    // Stands in for ccd's own write on the demote call (S5-R17's control:
    // agreeing with `lastDemotion.to` is what makes this THIS door's own
    // write, not a superseding out-of-band one).
    seed(home, sid, { class: 'opus', effort: 'medium' });

    const manual = await postRoute(w.app, id, { target: 'worker', why: 'operator judgement', field: 'class', value: 'sonnet' });
    expect(manual.statusCode).toBe(200);
    // The manual write names `class`, so it stands in for ccd's own write to
    // THAT field only — `.effort` is untouched by it and keeps reading
    // 'medium'.
    seed(home, sid, { class: 'sonnet', effort: 'medium' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'reverse-demotion', field: 'effort', from: 'medium', to: 'high', kind: 'shallow', effortReset: null },
    });
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain(`route:reverse-demotion:effort:medium->high:shallow:${sid}`);
  });

  // Final review, finding #2: THE LADDER'S HISTORY IS THIS RUN'S, AND A WAVE
  // IS ONE RUN ROW. `lastDemotion` and `priorSameKind` are derived from
  // `coord.runEvents(id)` — one run's rows — while the rung they walk belongs
  // to the SESSION, which is resumed wave after wave. So the spec's
  // cross-history rules ("any failed check reverses the last demotion";
  // "`max` … after a second failed check of the same kind on the same
  // session") hold inside a wave and not across one. This case MEASURES that
  // scope rather than leaving it to be rediscovered, and
  // `ccd/coordinator-skill/references/wave-lifecycle.md` §4 now states it to
  // the coordinator in the wave they act in, with the by-hand carry. If the
  // scope is ever widened to the session, this case is the one that must
  // change with it — deliberately, not silently.
  it("a demotion on wave N's run is NOT reversed by a failure on wave N+1's run — the bookkeeping is run-scoped", async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w23'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id: waveOne, sid } = await dispatchedRun(w.app, 'demo-w23');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const demoted = await postRoute(w.app, waveOne, { target: 'worker', why: 'three clean waves', demote: 'effort' });
    expect(demoted.statusCode, 'setup: the wave-1 demotion must land').toBe(200);

    // Wave 2 is a NEW run row on the SAME session (CLAUDE.md: "wave N+1 is a
    // NEW POST /api/runs, not a reopen"), bound by `sessionId` at open the
    // way a resumed worker's wave is.
    const openedTwo = await postOpen(w.app, { ...OPEN_BODY, wave: 2, sessionId: sid });
    expect(openedTwo.statusCode, 'setup: wave 2 must open').toBe(200);
    const waveTwo = (openedTwo.json() as { id: number }).id;
    expect(waveTwo).not.toBe(waveOne);

    const res = await postRoute(w.app, waveTwo, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    // Wave 1's demotion is invisible here, so this is a plain ladder
    // escalation off the record (`.effort` still reads `high` — the stubbed
    // ccd never rewrote it), not the `reverse-demotion` the same two calls
    // inside ONE run produce (the case above).
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh',
        kind: 'shallow', effortReset: null },
    });
    expect(w.coord.runEvents(waveTwo).map((e) => e.detail)).toEqual([`route:escalate:effort:high->xhigh:shallow:${sid}`]);
    // …and wave 1's own trail is untouched by wave 2's call.
    expect(w.coord.runEvents(waveOne).map((e) => e.detail)).toContain(`route:demote:effort:high->medium:manual:${sid}`);
  });

  it('manual field/value writes the argv as given and records mode manual with from "?"', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w5'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w5');

    const res = await postRoute(w.app, id, { target: 'worker', why: 'operator judgement', field: 'subagent', value: 'opus' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'manual', field: 'subagent', from: '?', to: 'opus', kind: null, effortReset: null },
    });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([
      ['route', '--session', sid, '--set', 'subagent=opus', '--actor', `run:${id} coordinator`,
        '--reason', 'manual: operator judgement'],
    ]);
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain(`route:manual:subagent:?->opus:manual:${sid}`);
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

  // Fix round 1, finding #1: a registry field can be PRESENT and READABLE
  // and still not be a legal rung — `classIndex`/`effortIndex` resolve by
  // `indexOf`, so an unvalidated cast into `ModelClass`/`RungCurrent['effort']`
  // lets an out-of-vocabulary value silently resolve to -1+1 (the FLOOR)
  // instead of being refused. `.class = 'default'` is not corruption: ccd's
  // own `ROUTE_CLASSES` legally accepts `default` as "no override" and
  // stores it verbatim (`ccd/ccd:1207`, `:13834`), so it is a real, reachable
  // registry state this door must refuse rather than silently demote.

  it('409s unrouteable-record on a .class of "default" (a legal ccd value outside CLASSES) rather than escalating to the floor', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w8'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w8');
    seed(home, sid, { class: 'default', effort: 'high' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'checks failed', kind: 'ceiling' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      ok: false, error: 'unrouteable-record', field: 'class', detail: '"default" is not a rung of the ladder (a record, not a rung)',
    });
    // Critically: no --set class=haiku (the bug this finding named — an
    // out-of-vocabulary class resolving to the bottom rung).
    expect(calls.filter((c) => c[0] === 'route')).toEqual([]);
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('route:'))).toBe(false);
  });

  it('409s unrouteable-record on an empty (torn/never-written) .effort file rather than treating it as a legal rung', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w9'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w9');
    seed(home, sid, { class: 'opus', effort: '' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'checks failed', kind: 'shallow' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      ok: false, error: 'unrouteable-record', field: 'effort', detail: '"" is not a rung of the ladder (a record, not a rung)',
    });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([]);
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('route:'))).toBe(false);
  });

  it('an empty (torn/never-written) .degraded file is treated as no degrade, not as a garbage served class', async () => {
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w10'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'demo-w10');
    seed(home, sid, { class: 'opus', effort: 'high', degraded: '' });

    const res = await postRoute(w.app, id, { target: 'worker', why: 'checks failed', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh', kind: 'shallow', effortReset: null },
    });
  });

  // Fix round 1, finding #3: the manual `field`+`value` write now goes
  // through `parseRouteFields`, the same shape guard the sibling
  // `POST /api/sessions/:id/route` (server.ts:1722) already reuses — a
  // control character or an over-32-byte value is `bad-request`, not
  // forwarded unbounded to `CCD_ARGV.route`.

  it('400s a manual value carrying a control character rather than forwarding it to ccd', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w11'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-w11');

    const res = await postRoute(w.app, id, { target: 'worker', why: 'operator judgement', field: 'compact', value: 'bad\nvalue' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([]);
  });

  it('400s a manual value over the 32-byte shape cap rather than forwarding it to ccd', async () => {
    const home = mkTmp('ccrc-route-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w12'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id } = await dispatchedRun(w.app, 'demo-w12');

    const res = await postRoute(w.app, id, { target: 'worker', why: 'operator judgement', field: 'compact', value: 'x'.repeat(40) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([]);
  });
});
