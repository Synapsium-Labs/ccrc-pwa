// Path identity W1a, Task 9 (spec §2.3): `POST /api/runs` asks the ONE registry
// id predicate of every id it stores, and the reclaim door asks it of both the
// heir it is handed and the claimant it would replace.
//
// Every refused id that CAN be a file has its row planted, so only the predicate
// can refuse it; absence never answers. A file name is at most 255 bytes, so the
// 256-character id is the one row these tables cannot plant. It fails the
// predicate on length alone.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';
import { recorder, seedRow, storedRun } from './idGateFixture.js';
import { REFUSED_IDS } from './registryIdCases.js';

const PROJECT = 'demo';
const CLAIMED_BY = 'demo-coordinator';
const TOKEN = 'f'.repeat(64);
/** The claimant a reclaim replaces; never planted, so it measures dead. */
const DEAD = 'demo-coordinator-old';
const HEIR = 'demo-coordinator-new';
/** A run's worker: a valid id, planted. */
const WORKER = 'demo-quiet-mesa';

const OPEN_BODY = { program: 'build4', title: 'Path identity', project: PROJECT,
  wave: 1, waveOf: 3, claimedBy: CLAIMED_BY, homeProject: PROJECT };

/** The longest id this file plants: `seedRow` writes `<id>.<field>`, and a file name is at most 255 bytes. */
const PLANTABLE_MAX = 200;

/** `run-routes.test.ts`'s app, plus an io that counts listings of the registry
 *  directory, so "refused before any read" is a number rather than a reading of
 *  the code. */
const openApp = async (home: string, run: Runner) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  let listings = 0;
  const io: FleetIO = {
    ...localIO,
    readdir: async (p, timeoutMs, signal) => {
      if (p === base.cfg.registryDir) listings += 1;
      return localIO.readdir(p, timeoutMs, signal);
    },
  };
  const app = await buildServer({ ...base, io, mailToken: TOKEN, coord });
  return { app, coord, listings: (): number => listings, resetListings: (): void => { listings = 0; } };
};

const postOpen = (app: FastifyInstance, body: unknown) =>
  app.inject({ method: 'POST', url: '/api/runs', headers: { 'x-ccrc-mail-token': TOKEN },
    payload: body as Record<string, unknown> });
const getRuns = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/runs' });
/** The reclaim door is ungated against the box token (its route docstring), so no header. */
const postReclaim = (app: FastifyInstance, id: number, claimedBy: string) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/reclaim`, payload: { claimedBy } });

describe('POST /api/runs refuses an id that is not a registry id (spec §2.3)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it.each(REFUSED_IDS)('claimedBy %s answers 400 bad-session naming claimedBy', async (id) => {
    const home = mkTmp('ccrc-runopen-id-');
    if (id.length <= PLANTABLE_MAX) seedRow(home, id);
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(w.app, { ...OPEN_BODY, claimedBy: id });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' });
    expect((await getRuns(w.app)).json()).toEqual({ runs: [] });
    expect(calls).toEqual([]);
  });

  it.each(REFUSED_IDS)('sessionId %s, its row planted, answers 400 bad-session naming sessionId', async (id) => {
    const home = mkTmp('ccrc-runopen-id-');
    if (id.length <= PLANTABLE_MAX) seedRow(home, id);
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(w.app, { ...OPEN_BODY, wave: 2, sessionId: id });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session', detail: 'sessionId is not a registry id' });
    expect(calls.filter((c) => c[0] === 'ws-hold')).toEqual([]);
    expect((await getRuns(w.app)).json()).toEqual({ runs: [] });
  });

  it.each(['-x', '--actor', '.', '.hidden'])('a work project beginning - or . answers 400 bad-request naming project: %s', async (project) => {
    const home = mkTmp('ccrc-runopen-id-');
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(w.app, { ...OPEN_BODY, project });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request', detail: 'project must not begin with - or .' });
    expect((await getRuns(w.app)).json()).toEqual({ runs: [] });
    expect(calls).toEqual([]);
  });

  it('controls: claimedBy a--actor, sessionId a.--actor and a project with an inner dash all open', async () => {
    const home = mkTmp('ccrc-runopen-id-');
    seedRow(home, 'a.--actor');
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const claimant = await postOpen(w.app, { ...OPEN_BODY, program: 'ctl-claimant', claimedBy: 'a--actor' });
    expect(claimant.statusCode).toBe(200);
    const session = await postOpen(w.app, { ...OPEN_BODY, program: 'ctl-session', wave: 2, sessionId: 'a.--actor' });
    expect(session.statusCode).toBe(200);
    // `CCD_ARGV.wsHold` is `['ws-hold', '--session', <id>, …]`: the accepted id reaches its argv whole.
    expect(calls.filter((c) => c[0] === 'ws-hold').map((c) => c[2])).toEqual(['a.--actor']);
    const project = await postOpen(w.app, { ...OPEN_BODY, program: 'ctl-project', project: 'demo-inner-dash' });
    expect(project.statusCode).toBe(200);
    expect(((await getRuns(w.app)).json() as { runs: unknown[] }).runs).toHaveLength(3);
  });

  it('a padded claimedBy is checked as given, never trimmed, and answers 400 bad-session', async () => {
    const home = mkTmp('ccrc-runopen-id-');
    const { run } = recorder();
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(w.app, { ...OPEN_BODY, claimedBy: ` ${CLAIMED_BY}` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' });
    expect((await getRuns(w.app)).json()).toEqual({ runs: [] });
  });

  it("a review open with a bad sessionId answers bad-session ahead of the review arm's checks", async () => {
    const home = mkTmp('ccrc-runopen-id-');
    seedRow(home, '--actor');
    const { run } = recorder();
    const w = await openApp(home, run); app = w.app;
    const review = { program: 'build4', title: 'Review', claimedBy: CLAIMED_BY, homeProject: PROJECT,
      kind: 'review', reviews: 9999 };
    const bad = await postOpen(w.app, { ...review, sessionId: '--actor' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ ok: false, error: 'bad-session', detail: 'sessionId is not a registry id' });
    // The ordering, stated: a VALID sessionId still meets the review arm's own refusal.
    const valid = await postOpen(w.app, { ...review, sessionId: 'demo-worker' });
    expect(valid.statusCode).toBe(400);
    expect(valid.json()).toEqual({ ok: false, error: 'bad-request',
      detail: 'sessionId is refused on a review run — it always spawns fresh on its own workspace' });
  });
});

describe('the reclaim door refuses a bad id on either side (spec §2.3)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('a stored claimedBy of --actor answers 409 bad-session whose detail names POST /api/runs/:id/abandon', async () => {
    const home = mkTmp('ccrc-reclaim-id-');
    seedRow(home, '--actor');
    seedRow(home, HEIR);
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const id = storedRun(w.coord, { state: 'planned', sessionId: null, claimedBy: '--actor' });
    w.resetListings();
    const res = await postReclaim(w.app, id, HEIR);
    expect(res.statusCode).toBe(409);
    const body = res.json() as { ok: boolean; error: string; detail: string };
    expect(body).toMatchObject({ ok: false, error: 'bad-session' });
    expect(body.detail).toContain('POST /api/runs/:id/abandon');
    expect(okRun(w.coord.run(id))!.claimedBy).toBe('--actor');
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('reclaim:'))).toBe(false);
    expect(w.listings()).toBe(0);
    expect(calls).toEqual([]);
  });

  it('the abandon door that 409 names closes a run whose stored claimedBy is --actor: 200 failed', async () => {
    // The promise the reclaim door's detail makes: abandon never reads `claimedBy`, so a programme whose claimant
    // fails the predicate still has a door. Its worker is a valid id, released by name; the claimant reaches no argv.
    const home = mkTmp('ccrc-reclaim-id-');
    seedRow(home, '--actor');
    seedRow(home, WORKER);
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const id = storedRun(w.coord, { state: 'working', sessionId: WORKER, claimedBy: '--actor' });
    const res = await w.app.inject({ method: 'POST', url: `/api/runs/${id}/abandon` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, id, state: 'failed', released: true });
    expect(okRun(w.coord.run(id))!.state).toBe('failed');
    expect(calls, 'only the valid worker is named').toEqual([['ws-release', '--session', WORKER]]);
  });

  it('the heir --actor answers 400 bad-session, and the stored claimant is unchanged', async () => {
    const home = mkTmp('ccrc-reclaim-id-');
    seedRow(home, '--actor');
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const id = storedRun(w.coord, { state: 'planned', sessionId: null, claimedBy: DEAD });
    w.resetListings();
    const res = await postReclaim(w.app, id, '--actor');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' });
    expect(okRun(w.coord.run(id))!.claimedBy).toBe(DEAD);
    expect(w.listings()).toBe(0);
    expect(calls).toEqual([]);
  });

  it('control: a stored claimant a--actor, measured dead, is reclaimed by a valid heir', async () => {
    const home = mkTmp('ccrc-reclaim-id-');
    seedRow(home, HEIR);
    const { run } = recorder();
    const w = await openApp(home, run); app = w.app;
    const id = storedRun(w.coord, { state: 'planned', sessionId: null, claimedBy: 'a--actor' });
    const res = await postReclaim(w.app, id, HEIR);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, from: 'a--actor', to: HEIR });
    expect(okRun(w.coord.run(id))!.claimedBy).toBe(HEIR);
  });
});
