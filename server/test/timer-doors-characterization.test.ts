// The timer doors' answers before the Overlord's timers change them (Overlord W1, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-overlord-timers.md` Task 3 Step 1; Review Focus 3). The five doors are
// driven through the REAL server (`buildServer`, so the real gate wiring once the timer doors call it) as a coordinator, a
// worker and the operator drive them, over a fixture HOME's registry, and the status and the body of each refusal and each
// success are pinned here. Written and green on the base before any door changed: for every caller that is not the
// designated session, each door answers byte for byte what it answered before. Fixture HOMEs only, neutral names.
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CoordStore } from '../src/coord/store.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const COORD = 'lane-a-project-a';
const WORKER = 'lane-b-project-a';
const STRANGER = 'lane-c-project-a';
const INC = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const HOUR = 3_600_000;
const uuidOf = (id: string): string => `u-${id}`;
/** The fixture clock's wall time (`testDeps`' fake time), read off the first set's `dueAt`. */
const NOW = 1786000000000;

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  removeTmpFixtures();
});

interface World { readonly app: FastifyInstance; readonly coord: CoordStore; readonly runId: number }

async function world(): Promise<World> {
  const home = mkTmp('ccrc-timer-doors-char-');
  for (const id of [COORD, WORKER, STRANGER]) seedRow(home, id, { uuid: uuidOf(id), project: 'project-a', generation: INC });
  const built = await appFor(home, recorder().run);
  app = built.app;
  await built.app.ready();
  const run = built.coord.openRun({ program: 'prog-a', title: 'prog-a', project: 'project-a', wave: 1, waveOf: 2, claimedBy: COORD }) as { id: number };
  return { app: built.app, coord: built.coord, runId: run.id };
}

type Answer = { status: number; body: unknown };
const answer = (res: { statusCode: number; body: string }): Answer => ({ status: res.statusCode, body: JSON.parse(res.body) as unknown });
const H = (token: string | null = ID_GATE_TOKEN) => (token === null ? {} : { 'x-ccrc-mail-token': token });

const set = async (w: World, from: string, body: Record<string, unknown> = {}, token: string | null = ID_GATE_TOKEN): Promise<Answer> =>
  answer(await w.app.inject({ method: 'POST', url: '/api/timers', headers: H(token),
    payload: { fromId: from, fromUuid: uuidOf(from), durationMs: 2 * HOUR, note: 'check the PR checks', ...body } }));
const list = async (w: World, by: string, q: Record<string, string> = {}, token: string | null = ID_GATE_TOKEN): Promise<Answer> =>
  answer(await w.app.inject({ method: 'GET', url: `/api/timers?${new URLSearchParams({ byId: by, byUuid: uuidOf(by), ...q })}`, headers: H(token) }));
const cancel = async (w: World, from: string, id: number | string, body: Record<string, unknown> = {}, token: string | null = ID_GATE_TOKEN): Promise<Answer> =>
  answer(await w.app.inject({ method: 'POST', url: `/api/timers/${id}/cancel`, headers: H(token), payload: { fromId: from, fromUuid: uuidOf(from), ...body } }));
const opRead = async (w: World, session: string): Promise<Answer> =>
  answer(await w.app.inject({ method: 'GET', url: `/api/sessions/${session}/timers` }));
const opCancel = async (w: World, session: string, id: number | string): Promise<Answer> =>
  answer(await w.app.inject({ method: 'POST', url: `/api/sessions/${session}/timers/${id}/cancel`, payload: {} }));
/** A timer planted through the store, as the set door writes one, set two hours before `at` (outside the hourly rate). */
const plant = (w: World, setter: string, at: number, over: { setAt?: number; runId?: number | null } = {}): number => {
  const setAt = over.setAt ?? at - 2 * HOUR;
  const r = w.coord.insertTimer({ setter, setterIncarnation: INC, setById: setter, setByUuid: uuidOf(setter), role: 'worker',
    note: `planted for ${setter}`, runId: over.runId ?? null, programme: null, setAt, dueAt: setAt + 6 * HOUR, setRestoreGeneration: null });
  if (!r.ok) throw new Error('plant failed');
  return r.id;
};
/** The operator's read on the base, before the Overlord's timers added `owner` to each row and `overlordTimers` (additive). */
const BASE_OP_READ: Answer = {"status": 200, "body": {"ok": true, "timers": [{"id": 34, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true}, {"id": 35, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true}, {"id": 36, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true}, {"id": 37, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true}, {"id": 38, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true}, {"id": 39, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true}, {"id": 41, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true}]}};
/** Every answer, as the base answered it, but for the operator's read, which carries the two additive fields (the scenario below makes them in this order, so the ids are its own). */
const PINNED: Record<string, Answer> = {
  "set ok": {"status": 201, "body": {"ok": true, "id": 1, "dueAt": 1786007200000}},
  "set no token": {"status": 401, "body": {"ok": false, "error": "unauthenticated", "detail": "no box token presented: this lane takes the box token (x-ccrc-mail-token) and nothing else"}},
  "set bad token": {"status": 401, "body": {"ok": false, "error": "unauthenticated", "detail": "wrong box token"}},
  "set no fromId": {"status": 400, "body": {"ok": false, "error": "bad-request", "detail": "fromId and fromUuid"}},
  "set run and programme": {"status": 400, "body": {"ok": false, "error": "bad-request", "detail": "a timer binds a run or a programme, not both"}},
  "set too long": {"status": 400, "body": {"ok": false, "error": "timer-too-long"}},
  "set too soon": {"status": 400, "body": {"ok": false, "error": "timer-too-soon"}},
  "set wrong uuid": {"status": 403, "body": {"ok": false, "error": "stale-uuid", "detail": "fromUuid does not match the registry — stale sender; re-read your own .uuid"}},
  "set unknown id": {"status": 403, "body": {"ok": false, "error": "unknown-sender", "detail": "no registry row for lane-z-project-a"}},
  "set worker on run not own": {"status": 403, "body": {"ok": false, "error": "timer-key-unknown"}},
  "set coord on own run": {"status": 201, "body": {"ok": true, "id": 2, "dueAt": 1786007200000}},
  "set coord on own programme": {"status": 201, "body": {"ok": true, "id": 3, "dueAt": 1786007200000}},
  "set worker run 999": {"status": 403, "body": {"ok": false, "error": "timer-key-unknown"}},
  "set rate": {"status": 429, "body": {"ok": false, "error": "timer-rate"}},
  "set cap": {"status": 409, "body": {"ok": false, "error": "timer-cap"}},
  "list coord": {"status": 200, "body": {"ok": true, "timers": [{"id": 1, "setAt": 1786000000000, "dueAt": 1786007200000, "note": "check the PR checks", "runId": null, "programme": null, "untrusted": true}, {"id": 2, "setAt": 1786000000000, "dueAt": 1786007200000, "note": "check the PR checks", "runId": 1, "programme": null, "untrusted": true}, {"id": 3, "setAt": 1786000000000, "dueAt": 1786007200000, "note": "check the PR checks", "runId": null, "programme": "prog-a", "untrusted": true}]}},
  "list no token": {"status": 401, "body": {"ok": false, "error": "unauthenticated", "detail": "no box token presented: this lane takes the box token (x-ccrc-mail-token) and nothing else"}},
  "list bad query": {"status": 400, "body": {"ok": false, "error": "bad-request", "detail": "byId and byUuid"}},
  "list wrong uuid": {"status": 403, "body": {"ok": false, "error": "stale-uuid", "detail": "byUuid does not match the registry — stale sender; re-read your own .uuid"}},
  "cancel bad id": {"status": 400, "body": {"ok": false, "error": "bad-request", "detail": "the path names a timer id"}},
  "cancel no token": {"status": 401, "body": {"ok": false, "error": "unauthenticated", "detail": "no box token presented: this lane takes the box token (x-ccrc-mail-token) and nothing else"}},
  "cancel absent": {"status": 403, "body": {"ok": false, "error": "timer-not-yours"}},
  "cancel theirs": {"status": 403, "body": {"ok": false, "error": "timer-not-yours"}},
  "cancel wrong uuid": {"status": 403, "body": {"ok": false, "error": "stale-uuid", "detail": "fromUuid does not match the registry — stale sender; re-read your own .uuid"}},
  "cancel mine": {"status": 200, "body": {"ok": true, "id": 40}},
  "cancel again": {"status": 409, "body": {"ok": false, "error": "timer-not-pending"}},
  "op read worker": {"status": 200, "body": {"ok": true, "timers": [{"id": 34, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true, "owner": "session"}, {"id": 35, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true, "owner": "session"}, {"id": 36, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true, "owner": "session"}, {"id": 37, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true, "owner": "session"}, {"id": 38, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true, "owner": "session"}, {"id": 39, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true, "owner": "session"}, {"id": 41, "setAt": 1785992800000, "dueAt": 1786014400000, "note": "planted for lane-b-project-a", "runId": null, "programme": null, "untrusted": true, "owner": "session"}], "overlordTimers": "not-this-session"}},
  "op read bad": {"status": 400, "body": {"ok": false, "error": "bad-request", "detail": "the path names a session id"}},
  "op cancel theirs via coord": {"status": 403, "body": {"ok": false, "error": "timer-not-yours"}},
  "op cancel absent": {"status": 404, "body": {"ok": false, "error": "timer-not-found"}},
  "op cancel ok": {"status": 200, "body": {"ok": true, "id": 41}},
  "op cancel again": {"status": 409, "body": {"ok": false, "error": "timer-not-pending"}},
  "op cancel bad": {"status": 400, "body": {"ok": false, "error": "bad-request", "detail": "the path names a session and a timer id"}},
};

describe('the five timer doors, as a coordinator, a worker and the operator drive them (pinned before the gate)', () => {
  it('each refusal and each success answers its pinned status and body, byte for byte', async () => {
    const w = await world();
    const got: Record<string, Answer> = {};
    got['set ok'] = await set(w, COORD);
    const now = (got['set ok'].body as { dueAt: number }).dueAt - 2 * HOUR;
    expect(now, 'the fixture clock').toBe(NOW);
    got['set no token'] = await set(w, COORD, {}, null);
    got['set bad token'] = await set(w, COORD, {}, 'nope');
    got['set no fromId'] = await set(w, COORD, { fromId: 7 });
    got['set run and programme'] = await set(w, COORD, { runId: w.runId, programme: 'prog-a' });
    got['set too long'] = await set(w, COORD, { note: 'x'.repeat(501) });
    got['set too soon'] = await set(w, COORD, { durationMs: 1 });
    got['set wrong uuid'] = await set(w, COORD, { fromUuid: 'u-wrong' });
    got['set unknown id'] = await set(w, 'lane-z-project-a', { fromUuid: 'u-lane-z-project-a' });
    got['set worker on run not own'] = await set(w, WORKER, { runId: w.runId });
    got['set coord on own run'] = await set(w, COORD, { runId: w.runId });
    got['set coord on own programme'] = await set(w, COORD, { programme: 'prog-a' });
    got['set worker run 999'] = await set(w, WORKER, { runId: 999 });
    for (let i = 0; i < 30; i++) plant(w, STRANGER, now, { setAt: now - 1 });
    got['set rate'] = await set(w, STRANGER);
    for (let i = 0; i < 6; i++) plant(w, WORKER, now);
    got['set cap'] = await set(w, WORKER);
    got['list coord'] = await list(w, COORD);
    got['list no token'] = await list(w, COORD, {}, null);
    got['list bad query'] = await list(w, COORD, { byUuid: '' });
    got['list wrong uuid'] = await list(w, COORD, { byUuid: 'u-wrong' });
    const mine = plant(w, COORD, now);
    const theirs = plant(w, WORKER, now);
    got['cancel bad id'] = await cancel(w, COORD, '0');
    got['cancel no token'] = await cancel(w, COORD, mine, {}, null);
    got['cancel absent'] = await cancel(w, COORD, 999_999);
    got['cancel theirs'] = await cancel(w, COORD, theirs);
    got['cancel wrong uuid'] = await cancel(w, COORD, mine, { fromUuid: 'u-wrong' });
    got['cancel mine'] = await cancel(w, COORD, mine);
    got['cancel again'] = await cancel(w, COORD, mine);
    got['op read worker'] = await opRead(w, WORKER);
    got['op read bad'] = await opRead(w, 'a b');
    got['op cancel theirs via coord'] = await opCancel(w, COORD, theirs);
    got['op cancel absent'] = await opCancel(w, WORKER, 999_999);
    got['op cancel ok'] = await opCancel(w, WORKER, theirs);
    got['op cancel again'] = await opCancel(w, WORKER, theirs);
    got['op cancel bad'] = await opCancel(w, WORKER, 'x');
    for (const [k, v] of Object.entries(PINNED)) expect(got[k], k).toStrictEqual(v);
    // The operator's read differs from the base by the two additive fields alone, and nothing else (wire discipline).
    const stripped = structuredClone(got['op read worker']!) as { status: number; body: { timers: Record<string, unknown>[]; overlordTimers?: unknown } };
    delete stripped.body.overlordTimers;
    for (const t of stripped.body.timers) delete t['owner'];
    expect(stripped).toStrictEqual(BASE_OP_READ);
    expect(Object.keys(got)).toStrictEqual(Object.keys(PINNED));
  });

  it('a stored set carries the caller as setter and its registry stamp, as before', async () => {
    const w = await world();
    const ok = await set(w, COORD, { runId: w.runId });
    expect(ok.status).toBe(201);
    const row = { ...(w.coord.db.prepare('SELECT setter, setterIncarnation, setById, setByUuid, runId FROM continuity_timers').get() as object) };
    expect(row).toStrictEqual({ setter: COORD, setterIncarnation: INC, setById: COORD, setByUuid: uuidOf(COORD), runId: w.runId });
  });
});
