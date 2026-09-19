// Routing slice 6, Task 1: the routing door's ladder history (`lastDemotion`,
// the same-kind count that gates `max`) is a property of the SESSION, not of
// one run row. This file measures that: the door now walks the UNION of
// `runEvents(r.id)` over `coord.runsTouching(sid)` — every run where `sid` is
// the worker OR the coordinator — so a demotion taken on one wave's run is
// visible (and reversible) from the very next wave's run on the same
// session, and `priorSameKind` carries forward with it.
//
// Reuses `run-route-route.test.ts`'s own harness (`seed`/`openApp`/
// `postOpen`/`postRoute`/`dispatchedRun`, the `ROUTE_READY_FLEET` fixture) —
// copied rather than imported (that file has no exports) — with one addition
// this file's own cross-run cases need and that file's single-dispatch cases
// never did: `makeRunner`'s `wsAddSequence`, letting ONE app dispatch two
// worker sessions in turn (dispatch's own before/after diff needs each
// `ws-add` call to mint a genuinely NEW workspace id, so two dispatches in
// one test cannot share one `wsAddCreates` list).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { ACTOR_FLAGS_CAP, ROUTE_CAP } from '../src/ccdargv.js';

const PROJECT = 'demo';
const CLAIMED_BY = 'ccrc-pwa-coordinator';
const TOKEN = 'f'.repeat(64);
const OPEN_BODY = { program: 'build4', title: 'Routing door', project: PROJECT,
  wave: 1, waveOf: 3, claimedBy: CLAIMED_BY, homeProject: PROJECT };

/** `run-route-route.test.ts`'s own registry-seed helper, copied verbatim. */
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
  /** A single dispatch's worker-id set — `run-route-route.test.ts`'s own
   *  shape, kept for the cases here that only ever dispatch once. */
  wsAddCreates?: string[];
  /** ONE id-set per `ws-add` CALL, consumed in order — this file's own
   *  addition, for the cross-run cases that dispatch two worker sessions on
   *  one app. Falls back to the last set once exhausted. */
  wsAddSequence?: string[][];
  fail?: ReadonlySet<string>;
  routeStderr?: string;
}

function makeRunner(home: string, cfg: RunnerConfig = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  let wsAddCalls = 0;
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (verb === 'route' && cfg.fail?.has('route')) {
      return { code: 1, stdout: '', stderr: cfg.routeStderr ?? 'route failed' };
    }
    if (cfg.fail?.has(verb)) return { code: 1, stdout: '', stderr: `${verb} failed` };
    if (verb === 'ws-add') {
      const sequence = cfg.wsAddSequence ?? [cfg.wsAddCreates ?? [`${PROJECT}-fresh`]];
      const ids = sequence[Math.min(wsAddCalls, sequence.length - 1)]!;
      wsAddCalls++;
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
 *  id, which is whatever id `makeRunner`'s CURRENT `ws-add` call seeds —
 *  the caller names it only so assertions read clearly, never to steer it. */
async function dispatchedRun(app: FastifyInstance, sid: string, body: unknown = OPEN_BODY): Promise<{ id: number; sid: string }> {
  const opened = (await postOpen(app, body)).json() as { id: number };
  const res = await postDispatch(app, opened.id);
  expect(res.statusCode, 'setup: dispatch must succeed').toBe(200);
  return { id: opened.id, sid };
}

/** Opens wave 2 bound to the SAME worker session as wave 1 — `run-route-
 *  route.test.ts`'s own cross-wave setup (CLAUDE.md: "wave N+1 is a NEW
 *  POST /api/runs, not a reopen"), copied because every case here needs it. */
async function openNextWave(app: FastifyInstance, sid: string, wave = 2): Promise<number> {
  const opened = await postOpen(app, { ...OPEN_BODY, wave, sessionId: sid });
  expect(opened.statusCode, `setup: wave ${wave} must open`).toBe(200);
  return (opened.json() as { id: number }).id;
}

describe('POST /api/runs/:id/route — the trail follows the SESSION across runs (routing slice 6, Task 1)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it("a demotion on run A (wave 1) is reversed by a failed check on run B (wave 2, same worker session) — the union, not one run's rows", async () => {
    const home = mkTmp('ccrc-trail-');
    const { run } = makeRunner(home, { wsAddCreates: ['trail-w1'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id: runA, sid } = await dispatchedRun(w.app, 'trail-w1');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const demoted = await postRoute(w.app, runA, { target: 'worker', why: 'slow down', demote: 'effort' });
    expect(demoted.statusCode, 'setup: the wave-1 demotion must land').toBe(200);
    // Stands in for ccd's own write on the demote call (S5-R17's control:
    // matches `lastDemotion.to`, so this is THIS door's own write, not an
    // out-of-band supersession).
    seed(home, sid, { class: 'opus', effort: 'medium' });

    const runB = await openNextWave(w.app, sid);
    const res = await postRoute(w.app, runB, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    // Wave 1's demotion IS visible here — the whole point of routing slice
    // 6 over slice 5's run-scoped bookkeeping (D-2957, closed by this file).
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'reverse-demotion', field: 'effort', from: 'medium', to: 'high', kind: 'shallow', effortReset: null },
    });
    expect(w.coord.runEvents(runB).map((e) => e.detail)).toContain(`route:reverse-demotion:effort:medium->high:shallow:${sid}`);
    // Mutation check: dropping the union (walking `runA`'s own trail only,
    // or `runB`'s own trail only) sees no demotion at all here and answers
    // a plain escalate instead — this assertion is what reds under that
    // mutation.
  });

  it("a demotion targeting the COORDINATOR on run A is not reversed by the WORKER's failure on run B — the session segment, not just the run, decides", async () => {
    const home = mkTmp('ccrc-trail-');
    const { run } = makeRunner(home, { wsAddCreates: ['trail-w2'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id: runA, sid } = await dispatchedRun(w.app, 'trail-w2');
    seed(home, sid, { class: 'opus', effort: 'high' });
    seed(home, CLAIMED_BY, { class: 'opus', effort: 'high' });

    const demoted = await postRoute(w.app, runA, { target: 'coordinator', why: 'slow down', demote: 'effort' });
    expect(demoted.statusCode, 'setup: the coordinator demotion must land').toBe(200);
    expect(w.coord.runEvents(runA).map((e) => e.detail)).toContain(`route:demote:effort:high->medium:manual:${CLAIMED_BY}`);
    // ccd's own write, on the COORDINATOR's registry only. The WORKER's own
    // `.effort` also happens to read 'medium' here — a coincidence, staged
    // on purpose: it is what stops S5-R17 (the measured-value guard)
    // rescuing this case if the SESSION SEGMENT were ignored. Under that
    // mutation the coordinator's demote event would misattribute to `sid`
    // (`runA.sessionId === sid`) with `lastDemotion.to === 'medium'`, which
    // would then MATCH the worker's own measured effort and sail straight
    // through as a `reverse-demotion` — so this case needs that coincidence
    // to actually distinguish the mutation, not just the field values below.
    seed(home, CLAIMED_BY, { class: 'opus', effort: 'medium' });
    seed(home, sid, { class: 'opus', effort: 'medium' });

    const runB = await openNextWave(w.app, sid);
    const res = await postRoute(w.app, runB, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    // A plain escalate off the WORKER's own measured effort — NOT a reversal
    // of the coordinator's demotion, which named a different session
    // (`CLAIMED_BY`) on the six-segment event. Ignoring the session segment
    // would answer `reverse-demotion` here instead — the mutation this case
    // reds under.
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'escalate', field: 'effort', from: 'medium', to: 'high', kind: 'shallow', effortReset: null },
    });
  });

  it("a pre-slice-6 five-segment demotion on run A is reversed on run B when run A's sessionId IS the target", async () => {
    const home = mkTmp('ccrc-trail-');
    const { run } = makeRunner(home, { wsAddCreates: ['trail-w3'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id: runA, sid } = await dispatchedRun(w.app, 'trail-w3');
    seed(home, sid, { class: 'opus', effort: 'medium' });

    // A hand-planted FIVE-segment event — stands in for a demotion this door
    // wrote before routing slice 6, when `route:` details named no session.
    w.coord.recordRunEvent(runA, 'coordinator', 'route:demote:effort:high->medium:manual');

    const runB = await openNextWave(w.app, sid);
    const res = await postRoute(w.app, runB, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'reverse-demotion', field: 'effort', from: 'medium', to: 'high', kind: 'shallow', effortReset: null },
    });
  });

  it("the same five-segment demotion is NOT attributed to a session that is only run A's COORDINATOR, never its worker", async () => {
    const home = mkTmp('ccrc-trail-');
    const { run } = makeRunner(home, { wsAddSequence: [['trail-w4a'], ['trail-w4b']] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;

    // `coordSid` is a real worker session of its OWN run (`runOwn`) — a
    // session id must come from somewhere real to be routable — and it is
    // ALSO the run A `claimedBy` name below, i.e. run A's COORDINATOR, never
    // its worker.
    const { id: runOwnId, sid: coordSid } = await dispatchedRun(w.app, 'trail-w4a');
    // The door (spec §12, D-3012): `coordSid` is still a LIVE worker of its
    // own run at this point, so opening run A with `claimedBy: coordSid`
    // below would be refused (`claimant-is-a-worker`). Terminalize `runOwn`
    // so `coordSid` reads as a FINISHED worker — `parentOfSession` then
    // answers null and the open below succeeds, while the subject this case
    // tests (attribution to a session that is only run A's coordinator, and
    // was once a worker of a DIFFERENT, now-closed run) survives untouched.
    tx(w.coord.db, () => { w.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(runOwnId); });
    // A DIFFERENT `program` than `OPEN_BODY`'s default (`build4`): the
    // one-coordinator-per-program guard refuses a second open naming a
    // different `claimedBy` on the SAME program, and this run's
    // `claimedBy` (`coordSid`) deliberately differs from the first run's.
    const { id: runA, sid: workerSid } = await dispatchedRun(
      w.app, 'trail-w4b', { ...OPEN_BODY, program: 'build4-trail-w4', claimedBy: coordSid },
    );
    seed(home, coordSid, { class: 'opus', effort: 'medium' });
    seed(home, workerSid, { class: 'opus', effort: 'high' });

    // Planted on run A, where `coordSid` is the COORDINATOR — a five-segment
    // event here names no session, and the fallback attributes it to run
    // A's own WORKER (`workerSid`), never to `coordSid`.
    w.coord.recordRunEvent(runA, 'coordinator', 'route:demote:effort:high->medium:manual');

    const runB = await openNextWave(w.app, coordSid);
    const res = await postRoute(w.app, runB, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    // A plain escalate off `coordSid`'s own measured effort ('medium',
    // never touched by the plant above) — the five-segment demotion planted
    // on run A belongs to `workerSid`, not to `coordSid`.
    expect(res.json()).toEqual({
      ok: true, applied: { session: coordSid, mode: 'escalate', field: 'effort', from: 'medium', to: 'high', kind: 'shallow', effortReset: null },
    });
  });

  it("priorSameKind counts a shallow escalate on run A toward run B's max rule — the same-kind count carries across runs", async () => {
    const home = mkTmp('ccrc-trail-');
    const { run } = makeRunner(home, { wsAddCreates: ['trail-w5'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id: runA, sid } = await dispatchedRun(w.app, 'trail-w5');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const first = await postRoute(w.app, runA, { target: 'worker', why: 'checks failed', kind: 'shallow' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ applied: { mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh' } });
    // ccd's own write, matching the escalate above.
    seed(home, sid, { class: 'opus', effort: 'xhigh' });

    const runB = await openNextWave(w.app, sid);
    // A SECOND shallow failure, on a DIFFERENT run: `max` needs a second
    // failed check of the same kind (`escalate()`'s own rule) — reachable
    // ONLY if `priorSameKind` carries the first one forward from run A. A
    // run-scoped count would restart at zero here and answer `ceiling`
    // instead — the mutation this case reds under.
    const res = await postRoute(w.app, runB, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'escalate', field: 'effort', from: 'xhigh', to: 'max', kind: 'shallow', effortReset: null },
    });
  });

  it('S5-R5 still holds across runs: a manual write on the demoted field, on a LATER run, clears lastDemotion for a failure reported after it', async () => {
    const home = mkTmp('ccrc-trail-');
    const { run } = makeRunner(home, { wsAddCreates: ['trail-w6'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id: runA, sid } = await dispatchedRun(w.app, 'trail-w6');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const demoted = await postRoute(w.app, runA, { target: 'worker', why: 'slow down', demote: 'effort' });
    expect(demoted.statusCode).toBe(200);

    const runB = await openNextWave(w.app, sid);
    const manual = await postRoute(w.app, runB, { target: 'worker', why: 'operator judgement', field: 'effort', value: 'high' });
    expect(manual.statusCode).toBe(200);

    // The stubbed ccd never rewrites the registry, so `.effort` still reads
    // its original 'high' — this reaches the PLAIN escalate arm (reading
    // `.effort` fresh), not the reversal arm, which would answer off the
    // now-superseded `lastDemotion` bookkeeping regardless of what `.effort`
    // says. The manual write is on run B, the ORIGINAL demotion on run A —
    // the cross-run carry is what this case measures.
    const res = await postRoute(w.app, runB, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh', kind: 'shallow', effortReset: null },
    });
  });

  it('S5-R17 still holds across runs: an out-of-band write after a demotion on an EARLIER run supersedes the reversal on a LATER one', async () => {
    const home = mkTmp('ccrc-trail-');
    const { run } = makeRunner(home, { wsAddCreates: ['trail-w7'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id: runA, sid } = await dispatchedRun(w.app, 'trail-w7');
    seed(home, sid, { class: 'opus', effort: 'high' });

    const demoted = await postRoute(w.app, runA, { target: 'worker', why: 'slow down', demote: 'effort' });
    expect(demoted.statusCode).toBe(200);
    expect(w.coord.runEvents(runA).map((e) => e.detail)).toContain(`route:demote:effort:high->medium:manual:${sid}`);

    // Out of band: something other than this door (the PWA picker, ccd
    // itself) wrote `.effort` directly — no run event records it, so
    // `lastDemotion` (carried from run A) still names `medium` as `to`.
    seed(home, sid, { class: 'opus', effort: 'low' });

    const runB = await openNextWave(w.app, sid);
    const res = await postRoute(w.app, runB, { target: 'worker', why: 'failed again', kind: 'shallow' });
    expect(res.statusCode).toBe(200);
    // The measured value ('low') disagrees with `lastDemotion.to`
    // ('medium'), so S5-R17 clears the (cross-run) demotion and applies the
    // plain ladder to what is really on the record.
    expect(res.json()).toEqual({
      ok: true, applied: { session: sid, mode: 'escalate', field: 'effort', from: 'low', to: 'medium', kind: 'shallow', effortReset: null },
    });
    const details = w.coord.runEvents(runB).map((e) => e.detail);
    expect(details.some((d) => d?.startsWith('route:reverse-demotion:'))).toBe(false);
  });
});
