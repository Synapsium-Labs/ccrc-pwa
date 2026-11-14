// Overlord W1a, the timers piece, PR B (plan `w1a-timers.md` Tasks 5 and 6): the session doors `POST /api/timers`,
// `GET /api/timers` and `POST /api/timers/:id/cancel`, and the operator's `GET /api/sessions/:id/timers` and
// `POST /api/sessions/:id/timers/:timerId/cancel`. A session serves its own identity only: the box token, the body's shape,
// the note's bounds, the registry's attribution, then the facts (the setter's stamp, the bound run or programme, the role's
// cap, the pending count and the hourly rate), each read once, and a fact that could not be read answers
// `timer-unmeasured`, never "not yours". The operator's doors are session-gated. Fixture HOMEs and stub reads only.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { buildServer, MASKED_GET_ROUTES } from '../src/server.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import { registerContinuityRoutes, type ContinuityRouteDeps } from '../src/continuity/routes.js';
import { CARD_REGISTRY_UNREAD } from '../src/continuity/card.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { AttributionRead } from '../src/coord/openRun.js';
import type { ChildMark } from '../../shared/api.js';
import { FLEET_ROLES, LEAST_TIMER_CAP, timerCapOf } from '../../shared/fleetRoles.js';
import { TIMER_DUE_MAX_MS, TIMER_DUE_MIN_MS, TIMER_NOTE_MAX_CHARS, TIMER_SETS_PER_HOUR, type TimerView } from '../../shared/continuity-timers.js';
import { REFUSAL_STATUS, TIMER_REFUSALS } from '../../shared/refusal.js';
import { testDeps } from './helpers.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ME = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';
const INC = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const TOKEN = ID_GATE_TOKEN;
/** A secret's shape, assembled so no literal key sits in the tree (push protection reads literals). */
const SECRET = ['sk', 'ant', 'oat01', 'Q'.repeat(64)].join('-');

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  removeTmpFixtures();
});

type Stamp = Awaited<ReturnType<ContinuityRouteDeps['setterStamp']>>;
interface Rig {
  readonly app: FastifyInstance;
  readonly coord: CoordStore;
  /** How often each registry read was asked: the shape-first order keeps them at 0 for a malformed body. */
  readonly reads: { stamp: number; attribute: number; role: number };
  now: number;
  stamp: Stamp | (() => never);
  child: ChildMark | typeof CARD_REGISTRY_UNREAD;
  attribution: AttributionRead;
}

/** The continuity routes alone, on a real store, with every registry read a counted stub. */
async function rig(over: Partial<ContinuityRouteDeps> = {}): Promise<Rig> {
  const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-timers-route-'), '.ccrc', 'coord.db')));
  const a = Fastify({ logger: false });
  const r: Rig = {
    app: a, coord, reads: { stamp: 0, attribute: 0, role: 0 }, now: NOW,
    stamp: { kind: 'measured', incarnation: INC }, child: { kind: 'none' }, attribution: { ok: true },
  };
  const attribute = async (): Promise<AttributionRead> => { r.reads.attribute += 1; return r.attribution; };
  registerContinuityRoutes(a, {
    coord, mailToken: () => TOKEN, wall: () => r.now, attribute, attributeReader: attribute,
    setterStamp: async () => { r.reads.stamp += 1; return typeof r.stamp === 'function' ? r.stamp() : r.stamp; },
    cardRegistry: {
      childMark: async () => { r.reads.role += 1; return r.child; },
      incarnation: async () => ({ kind: 'value', v: INC }), declaredIntent: () => false,
    },
    masker: SHAPE_ONLY_MASKER,
    ...over,
  });
  await a.ready();
  app = a;
  return r;
}

const set = (r: Rig, body: Record<string, unknown> = {}, token: string | null = TOKEN) => r.app.inject({
  method: 'POST', url: '/api/timers', headers: token === null ? {} : { 'x-ccrc-mail-token': token },
  payload: { fromId: ME, fromUuid: UUID, durationMs: 2 * HOUR, note: 'check the PR checks', ...body },
});
const list = (r: Rig, q: Record<string, string> = {}, token: string | null = TOKEN) => r.app.inject({
  method: 'GET', url: `/api/timers?${new URLSearchParams({ byId: ME, byUuid: UUID, ...q })}`,
  headers: token === null ? {} : { 'x-ccrc-mail-token': token },
});
const cancel = (r: Rig, id: number | string, body: Record<string, unknown> = {}, token: string | null = TOKEN) => r.app.inject({
  method: 'POST', url: `/api/timers/${id}/cancel`, headers: token === null ? {} : { 'x-ccrc-mail-token': token },
  payload: { fromId: ME, fromUuid: UUID, ...body },
});
const refused = (res: { statusCode: number; json: () => unknown }): [number, unknown] =>
  [res.statusCode, (res.json() as { error?: unknown }).error];
const rows = (r: Rig) => r.coord.db.prepare('SELECT id, setter, setterIncarnation, setById, setByUuid, role, note, runId, programme, setAt, dueAt, state, cancelReason FROM continuity_timers ORDER BY id').all() as Record<string, unknown>[];
/** A timer of `setter`, written through the store as the set door would. */
const plant = (r: Rig, setter: string, over: { runId?: number | null; programme?: string | null; setAt?: number } = {}): number => {
  const setAt = over.setAt ?? r.now - 1_000;
  const ins = r.coord.insertTimer({ setter, setterIncarnation: INC, setById: setter, setByUuid: UUID, role: 'plain', note: `n-${setter}`,
    runId: over.runId ?? null, programme: over.programme ?? null, setAt, dueAt: setAt + HOUR });
  if (!ins.ok) throw new Error('plant: write failed');
  return ins.id;
};
const openRun = (c: CoordStore, program: string, claimedBy: string): number =>
  (c.openRun({ program, title: program, project: 'project-a', wave: 1, waveOf: 2, claimedBy }) as { id: number }).id;

describe('the vocabulary the doors read', () => {
  it('every timer refusal has its declared status, and the least cap is the cap of an undecided role', () => {
    for (const [word, status] of Object.entries(TIMER_REFUSALS)) expect(REFUSAL_STATUS[word as keyof typeof REFUSAL_STATUS], word).toBe(status);
    expect(LEAST_TIMER_CAP).toBe(5);
    expect(timerCapOf('undecided')).toBe(LEAST_TIMER_CAP);
    expect(timerCapOf('coordinator')).toBe(FLEET_ROLES.coordinator.timerCap);
    expect(timerCapOf('worker')).toBe(5);
  });
});

describe('POST /api/timers: who may set one', () => {
  it('refuses without the box token (401), a wrong one too, and stores nothing', async () => {
    const r = await rig();
    expect(refused(await set(r, {}, null))).toEqual([401, 'unauthenticated']);
    expect(refused(await set(r, {}, 'e'.repeat(64)))).toEqual([401, 'unauthenticated']);
    expect(rows(r)).toEqual([]);
  });

  it('a stale uuid is 403 stale-uuid, an unmeasurable registry 502, and nothing is stored', async () => {
    const r = await rig();
    r.attribution = { ok: false, error: 'stale-uuid', detail: 'x' };
    expect(refused(await set(r))).toEqual([403, 'stale-uuid']);
    r.attribution = { ok: false, error: 'registry-unmeasurable', detail: 'x' };
    expect(refused(await set(r))).toEqual([502, 'registry-unmeasurable']);
    expect(rows(r)).toEqual([]);
  });

  it('a malformed body is refused before any registry read (the read counts stay 0)', async () => {
    const r = await rig();
    const bad: Record<string, unknown>[] = [
      { fromId: 'not an id' }, { fromId: 'x'.repeat(129) }, { fromUuid: 7 }, { fromUuid: '' },
      { runId: 0 }, { runId: -1 }, { runId: 1.5 }, { runId: '3' },
      { programme: 'not a slug!' }, { programme: ' prog-a' }, { programme: 'x'.repeat(200) }, { programme: 7 },
      { runId: 3, programme: 'prog-a' },
    ];
    for (const b of bad) expect(refused(await set(r, b)), JSON.stringify(b)).toEqual([400, 'bad-request']);
    // The note's and the duration's bounds are body refusals too, decided before any read.
    expect(refused(await set(r, { note: 'é'.repeat(TIMER_NOTE_MAX_CHARS + 1) }))).toEqual([400, 'timer-too-long']);
    expect(refused(await set(r, { note: 7 }))).toEqual([400, 'timer-too-long']);
    expect(refused(await set(r, { note: `key ${SECRET}` }))).toEqual([400, 'timer-masked']);
    expect(r.reads).toEqual({ stamp: 0, attribute: 0, role: 0 });
    expect(rows(r)).toEqual([]);
  });

  it('the duration: too soon below five minutes and for anything not a safe integer; too late past 30 days, +Infinity included (2038 F3)', async () => {
    const r = await rig();
    for (const d of [TIMER_DUE_MIN_MS - 1, 0, -HOUR, 1.5 * HOUR + 0.5, '2h', null]) {
      expect(refused(await set(r, { durationMs: d })), String(d)).toEqual([400, 'timer-too-soon']);
    }
    for (const d of [TIMER_DUE_MAX_MS + 1, Number.MAX_SAFE_INTEGER + 2, 1e300]) {
      expect(refused(await set(r, { durationMs: d })), String(d)).toEqual([400, 'timer-too-late']);
    }
    expect(r.reads.stamp).toBe(0);
    // The bounds themselves are accepted.
    expect((await set(r, { durationMs: TIMER_DUE_MIN_MS })).statusCode).toBe(201);
    expect((await set(r, { durationMs: TIMER_DUE_MAX_MS })).statusCode).toBe(201);
  });

  it('a note carrying a secret is refused 400 timer-masked and no row is stored', async () => {
    const r = await rig();
    expect(SHAPE_ONLY_MASKER.maskText(SECRET)).not.toBe(SECRET);
    expect(refused(await set(r, { note: `the key is ${SECRET} remember` }))).toEqual([400, 'timer-masked']);
    expect(rows(r)).toEqual([]);
  });
});

describe('POST /api/timers: a good set', () => {
  it('201 with the id and a dueAt from the server clock, stamped with the setter incarnation, the caller, and the role', async () => {
    const r = await rig();
    const res = await set(r, { durationMs: 2 * HOUR, note: 'check the PR checks' });
    expect(res.statusCode, res.body).toBe(201);
    const b = res.json() as { ok: boolean; id: number; dueAt: number };
    expect(b).toEqual({ ok: true, id: expect.any(Number), dueAt: NOW + 2 * HOUR });
    expect(rows(r)).toEqual([{
      id: b.id, setter: ME, setterIncarnation: INC, setById: ME, setByUuid: UUID, role: 'plain', note: 'check the PR checks',
      runId: null, programme: null, setAt: NOW, dueAt: NOW + 2 * HOUR, state: 'pending', cancelReason: null,
    }]);
    expect(r.reads).toEqual({ stamp: 1, attribute: 1, role: 1 });
  });

  it('a timer bound to a run the caller claims, and to one it works; a programme it coordinates that is live', async () => {
    const r = await rig();
    const claimed = openRun(r.coord, 'prog-a', ME);
    expect((await set(r, { runId: claimed })).statusCode).toBe(201);
    const worked = openRun(r.coord, 'prog-b', OTHER);
    r.coord.markDispatched(worked, ME, ME, `ws/${ME}`, false);
    expect((await set(r, { runId: worked })).statusCode).toBe(201);
    expect((await set(r, { programme: 'prog-a' })).statusCode).toBe(201);
    expect(rows(r).map((t) => [t.runId, t.programme])).toEqual([[claimed, null], [worked, null], [null, 'prog-a']]);
  });

  it('the role read is the card\'s: a coordinator is stamped coordinator, an unreadable registry undecided', async () => {
    const r = await rig();
    openRun(r.coord, 'prog-a', ME);
    expect((await set(r)).statusCode).toBe(201);
    r.child = CARD_REGISTRY_UNREAD;
    expect((await set(r)).statusCode).toBe(201);
    expect(rows(r).map((t) => t.role)).toEqual(['coordinator', 'undecided']);
  });
});

describe('POST /api/timers: the facts, each refusal through the door', () => {
  it('timer-unmeasured (503) when the stamp is changing, unreadable, or its read throws; nothing stored', async () => {
    const r = await rig();
    for (const reason of ['changing', 'unreadable', 'absent']) {
      r.stamp = { kind: 'unmeasured', reason };
      expect(refused(await set(r)), reason).toEqual([503, 'timer-unmeasured']);
    }
    r.stamp = () => { throw new Error('io'); };
    expect(refused(await set(r))).toEqual([503, 'timer-unmeasured']);
    expect(rows(r)).toEqual([]);
  });

  it('timer-unmeasured (503), never timer-key-unknown, when bindingsOf answers ok: false or throws', async () => {
    const r = await rig();
    const run = openRun(r.coord, 'prog-a', ME);
    const real = r.coord.bindingsOf.bind(r.coord);
    const failed = { ok: false as const, kind: 'run-unreadable' as const, detail: 'unreadable row' };
    r.coord.bindingsOf = (id: string) => ({ ...real(id), claimant: () => failed });
    expect(refused(await set(r, { runId: run }))).toEqual([503, 'timer-unmeasured']);
    r.coord.bindingsOf = (id: string) => ({ ...real(id), worker: () => failed });
    expect(refused(await set(r, { runId: run }))).toEqual([503, 'timer-unmeasured']);
    r.coord.bindingsOf = () => { throw new Error('db'); };
    expect(refused(await set(r, { runId: run }))).toEqual([503, 'timer-unmeasured']);
    expect(rows(r)).toEqual([]);
  });

  it('timer-unmeasured (503) when claimsProgramme or programmeLive throws', async () => {
    const r = await rig();
    openRun(r.coord, 'prog-a', ME);
    const claims = r.coord.claimsProgramme.bind(r.coord);
    r.coord.claimsProgramme = () => { throw new Error('claimsProgramme: unreadable'); };
    expect(refused(await set(r, { programme: 'prog-a' }))).toEqual([503, 'timer-unmeasured']);
    r.coord.claimsProgramme = claims;
    r.coord.programmeLive = () => { throw new Error('db'); };
    expect(refused(await set(r, { programme: 'prog-a' }))).toEqual([503, 'timer-unmeasured']);
    expect(rows(r)).toEqual([]);
  });

  it("another session's run is 403 timer-key-unknown, and so is a closed run of the caller's own", async () => {
    const r = await rig();
    const theirs = openRun(r.coord, 'prog-b', OTHER);
    expect(refused(await set(r, { runId: theirs }))).toEqual([403, 'timer-key-unknown']);
    const mine = openRun(r.coord, 'prog-a', ME);
    r.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(mine);
    expect(refused(await set(r, { runId: mine }))).toEqual([403, 'timer-key-unknown']);
    expect(refused(await set(r, { runId: 99_999 }))).toEqual([403, 'timer-key-unknown']);
    expect(rows(r)).toEqual([]);
  });

  it("another coordinator's programme is 403, and so is the caller's own programme once its plan has ended", async () => {
    const r = await rig();
    openRun(r.coord, 'prog-b', OTHER);
    expect(refused(await set(r, { programme: 'prog-b' }))).toEqual([403, 'timer-key-unknown']);
    openRun(r.coord, 'prog-a', ME);
    r.coord.db.prepare("UPDATE programs SET planEnd = 'met' WHERE slug = 'prog-a'").run();
    expect(refused(await set(r, { programme: 'prog-a' }))).toEqual([403, 'timer-key-unknown']);
    expect(rows(r)).toEqual([]);
  });

  it("a worker's sixth pending timer is 409 timer-cap, and a coordinator's twenty-first", async () => {
    const r = await rig();
    const run = openRun(r.coord, 'prog-c', OTHER);
    r.child = { kind: 'child', runId: run };
    for (let i = 0; i < FLEET_ROLES.worker.timerCap; i += 1) expect((await set(r)).statusCode).toBe(201);
    expect(refused(await set(r))).toEqual([409, 'timer-cap']);

    const c = await rig();
    openRun(c.coord, 'prog-a', ME);
    for (let i = 0; i < FLEET_ROLES.coordinator.timerCap; i += 1) expect((await set(c)).statusCode).toBe(201);
    expect(refused(await set(c))).toEqual([409, 'timer-cap']);
    expect(rows(c)).toHaveLength(20);
  });

  it('an undecided role is held to the least cap', async () => {
    const r = await rig();
    openRun(r.coord, 'prog-a', ME);
    r.child = CARD_REGISTRY_UNREAD;
    for (let i = 0; i < LEAST_TIMER_CAP; i += 1) expect((await set(r)).statusCode).toBe(201);
    expect(refused(await set(r))).toEqual([409, 'timer-cap']);
  });

  it('the 31st set in an hour is 429 timer-rate, cancelled ones counted; an hour later it is open again', async () => {
    const r = await rig();
    openRun(r.coord, 'prog-a', ME);
    for (let i = 0; i < TIMER_SETS_PER_HOUR; i += 1) {
      const res = await set(r);
      expect(res.statusCode).toBe(201);
      expect((await cancel(r, (res.json() as { id: number }).id)).statusCode).toBe(200);
    }
    expect(refused(await set(r))).toEqual([429, 'timer-rate']);
    r.now += HOUR + 1;
    expect((await set(r)).statusCode).toBe(201);
  });

  it('a setsSince that throws is timer-unmeasured (503), never "no sets this hour" (2038 F6)', async () => {
    const r = await rig();
    r.coord.setsSince = () => { throw new Error('db'); };
    expect(refused(await set(r))).toEqual([503, 'timer-unmeasured']);
    expect(rows(r)).toEqual([]);
  });

  it('a pending read that fails is timer-unmeasured (503)', async () => {
    const r = await rig();
    r.coord.pendingTimersOf = () => ({ ok: false, detail: 'unreadable' });
    expect(refused(await set(r))).toEqual([503, 'timer-unmeasured']);
  });

  it('a write that fails answers 503 write-failed', async () => {
    const r = await rig();
    r.coord.insertTimer = () => ({ ok: false, kind: 'write-failed' });
    expect(refused(await set(r))).toEqual([503, 'write-failed']);
  });

  it('no coordination store answers 503 unavailable after the attribution', async () => {
    const r = await rig({ coord: undefined });
    expect(refused(await set(r))).toEqual([503, 'unavailable']);
  });
});

describe('GET /api/timers: the caller\'s own pending timers', () => {
  it('the token, the query\'s shape, the attribution; then only the caller\'s pending timers, masked, marked untrusted', async () => {
    const r = await rig();
    expect(refused(await list(r, {}, null))).toEqual([401, 'unauthenticated']);
    expect(refused(await list(r, { byUuid: '' }))).toEqual([400, 'bad-request']);
    r.attribution = { ok: false, error: 'stale-uuid', detail: 'x' };
    expect(refused(await list(r))).toEqual([403, 'stale-uuid']);
    r.attribution = { ok: true };
    const mine = plant(r, ME);
    plant(r, OTHER);
    const gone = plant(r, ME);
    r.coord.cancelTimer(gone, 'setter-cancel', 'setter', NOW);
    const res = await list(r);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, timers: [{
      id: mine, setAt: NOW - 1_000, dueAt: NOW - 1_000 + HOUR, note: `n-${ME}`, runId: null, programme: null, untrusted: true,
    } satisfies TimerView] });
  });

  it('a pending read that fails is 503 timer-unmeasured, never an empty list', async () => {
    const r = await rig();
    r.coord.pendingTimersOf = () => ({ ok: false, detail: 'unreadable' });
    expect(refused(await list(r))).toEqual([503, 'timer-unmeasured']);
  });
});

describe('POST /api/timers/:id/cancel: one of the caller\'s own', () => {
  it('cancels its own pending timer once, with reason setter', async () => {
    const r = await rig();
    const id = plant(r, ME);
    const res = await cancel(r, id);
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, id }]);
    expect(rows(r)[0]).toMatchObject({ state: 'cancelled', cancelReason: 'setter' });
    expect(refused(await cancel(r, id))).toEqual([409, 'timer-not-pending']);
  });

  it("another's timer is 403 timer-not-yours, and so is an id that names no row (no oracle)", async () => {
    const r = await rig();
    const theirs = plant(r, OTHER);
    expect(refused(await cancel(r, theirs))).toEqual([403, 'timer-not-yours']);
    expect(refused(await cancel(r, 99_999))).toEqual([403, 'timer-not-yours']);
    expect(rows(r)[0]).toMatchObject({ state: 'pending' });
  });

  it('a fired one is 409 timer-not-pending', async () => {
    const r = await rig();
    const id = plant(r, ME);
    r.coord.db.prepare("UPDATE continuity_timers SET state = 'fired', firedAt = ?, mailId = 1 WHERE id = ?").run(NOW, id);
    expect(refused(await cancel(r, id))).toEqual([409, 'timer-not-pending']);
  });

  it('a timer the lane moved between the read and the write answers timer-not-pending', async () => {
    const r = await rig();
    const id = plant(r, ME);
    r.coord.cancelTimer = () => ({ changed: false });
    expect(refused(await cancel(r, id))).toEqual([409, 'timer-not-pending']);
  });

  it('the token, the id\'s and the body\'s shape, the attribution, and an unreadable row (503)', async () => {
    const r = await rig();
    const id = plant(r, ME);
    expect(refused(await cancel(r, id, {}, null))).toEqual([401, 'unauthenticated']);
    for (const bad of ['0', 'x', '-1', '01']) expect(refused(await cancel(r, bad)), bad).toEqual([400, 'bad-request']);
    expect(refused(await cancel(r, id, { fromId: 'not an id' }))).toEqual([400, 'bad-request']);
    expect(r.reads.attribute).toBe(0);
    r.attribution = { ok: false, error: 'stale-uuid', detail: 'x' };
    expect(refused(await cancel(r, id))).toEqual([403, 'stale-uuid']);
    r.attribution = { ok: true };
    r.coord.timerById = () => ({ ok: false, detail: 'unreadable' });
    expect(refused(await cancel(r, id))).toEqual([503, 'timer-unmeasured']);
  });
});

// ── The operator's doors (Task 6), on the real server: session-gated, armed or not ────────────────────────────────────

const PASS = 'correct horse battery staple';
const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };

async function server(armed: boolean): Promise<{ app: FastifyInstance; coord: CoordStore; home: string }> {
  const home = mkTmp('ccrc-timers-operator-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  if (armed) writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASS, FAST, 1)}\n`, { mode: 0o600 });
  seedRow(home, ME, { uuid: UUID, project: 'project-a', generation: INC });
  seedRow(home, OTHER, { uuid: 'u-other', project: 'project-a', generation: INC });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, recorder().run);
  const a = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: armed }, mailToken: TOKEN, coord });
  await a.ready();
  app = a;
  return { app: a, coord, home };
}
const cookieOf = async (a: FastifyInstance): Promise<string> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASS } });
  expect(res.statusCode, res.body).toBe(204);
  const setCookie = res.headers['set-cookie'];
  const line = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
  return line.slice(0, line.indexOf(';'));
};
const plantOn = (coord: CoordStore, setter: string): number => {
  const ins = coord.insertTimer({ setter, setterIncarnation: INC, setById: setter, setByUuid: UUID, role: 'plain', note: `n-${setter}`,
    runId: null, programme: null, setAt: NOW, dueAt: NOW + HOUR });
  if (!ins.ok) throw new Error('plant: write failed');
  return ins.id;
};

describe("the operator's doors: GET /api/sessions/:id/timers and POST /api/sessions/:id/timers/:timerId/cancel", () => {
  it('with sign-in armed, no cookie is 401 at both, and the box token is no key to them', async () => {
    const { app: a, coord } = await server(true);
    const id = plantOn(coord, ME);
    const read = await a.inject({ method: 'GET', url: `/api/sessions/${ME}/timers` });
    expect(refused(read)).toEqual([401, 'unauthenticated']);
    const cut = await a.inject({ method: 'POST', url: `/api/sessions/${ME}/timers/${id}/cancel`, payload: {} });
    expect(refused(cut)).toEqual([401, 'unauthenticated']);
    const tokened = await a.inject({ method: 'GET', url: `/api/sessions/${ME}/timers`, headers: { 'x-ccrc-mail-token': TOKEN } });
    expect(tokened.statusCode).toBe(401);
    expect(coord.pendingTimersOf(ME)).toMatchObject({ ok: true, rows: [{ id }] });
  });

  it("with a session, the read answers that session's timers only, and the cancel moves one with reason operator", async () => {
    const { app: a, coord } = await server(true);
    const cookie = await cookieOf(a);
    const mine = plantOn(coord, ME);
    const theirs = plantOn(coord, OTHER);
    const read = await a.inject({ method: 'GET', url: `/api/sessions/${ME}/timers`, headers: { cookie } });
    expect(read.statusCode, read.body).toBe(200);
    expect((read.json() as { timers: TimerView[] }).timers.map((t) => [t.id, t.untrusted])).toEqual([[mine, true]]);
    // Another session's timer, through this session's path: not that session's.
    const wrong = await a.inject({ method: 'POST', url: `/api/sessions/${ME}/timers/${theirs}/cancel`, headers: { cookie }, payload: {} });
    expect(refused(wrong)).toEqual([403, 'timer-not-yours']);
    const res = await a.inject({ method: 'POST', url: `/api/sessions/${ME}/timers/${mine}/cancel`, headers: { cookie }, payload: {} });
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, id: mine }]);
    expect(coord.db.prepare('SELECT state, cancelReason FROM continuity_timers WHERE id = ?').get(mine)).toEqual({ state: 'cancelled', cancelReason: 'operator' });
    const again = await a.inject({ method: 'POST', url: `/api/sessions/${ME}/timers/${mine}/cancel`, headers: { cookie }, payload: {} });
    expect(refused(again)).toEqual([409, 'timer-not-pending']);
  });

  it('with sign-in off (the shipped default), both answer with no credential at all, and a malformed path is 400', async () => {
    const { app: a, coord } = await server(false);
    const id = plantOn(coord, ME);
    expect((await a.inject({ method: 'GET', url: `/api/sessions/${ME}/timers` })).statusCode).toBe(200);
    expect(refused(await a.inject({ method: 'POST', url: `/api/sessions/${ME}/timers/0/cancel`, payload: {} }))).toEqual([400, 'bad-request']);
    expect((await a.inject({ method: 'POST', url: `/api/sessions/${ME}/timers/${id}/cancel`, payload: {} })).statusCode).toBe(200);
  });

  it('both GETs are masked by the one answer hook: a note written before the masker learned its shape goes out masked', async () => {
    expect(MASKED_GET_ROUTES.has('/api/timers')).toBe(true);
    expect(MASKED_GET_ROUTES.has('/api/sessions/:id/timers')).toBe(true);
    const { app: a, coord } = await server(false);
    const ins = coord.insertTimer({ setter: ME, setterIncarnation: INC, setById: ME, setByUuid: UUID, role: 'plain', note: `old ${SECRET}`,
      runId: null, programme: null, setAt: NOW, dueAt: NOW + HOUR });
    expect(ins.ok).toBe(true);
    const own = await a.inject({ method: 'GET', url: `/api/timers?byId=${ME}&byUuid=${UUID}`, headers: { 'x-ccrc-mail-token': TOKEN } });
    const operator = await a.inject({ method: 'GET', url: `/api/sessions/${ME}/timers` });
    for (const res of [own, operator]) {
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).not.toContain(SECRET);
      expect((res.json() as { timers: TimerView[] }).timers).toHaveLength(1);
    }
  });
});

describe('the session doors on the real server: the setter stamp is the double read of `.generation`', () => {
  it('a set through the wired server is stamped with the row\'s .generation, and the list answers it', async () => {
    const { app: a, coord } = await server(false);
    const res = await a.inject({ method: 'POST', url: '/api/timers', headers: { 'x-ccrc-mail-token': TOKEN },
      payload: { fromId: ME, fromUuid: UUID, durationMs: 2 * HOUR, note: 'n' } });
    expect(res.statusCode, res.body).toBe(201);
    expect(coord.db.prepare('SELECT setter, setterIncarnation FROM continuity_timers').all()).toEqual([{ setter: ME, setterIncarnation: INC }]);
    const read = await a.inject({ method: 'GET', url: `/api/timers?byId=${ME}&byUuid=${UUID}`, headers: { 'x-ccrc-mail-token': TOKEN } });
    expect((read.json() as { timers: TimerView[] }).timers).toHaveLength(1);
  });

  it('a row with no .generation file is timer-unmeasured, never a timer stamped with nothing', async () => {
    const { app: a, home } = await server(false);
    seedRow(home, 'lane-c-project-a', { uuid: 'u-c', project: 'project-a' });
    const res = await a.inject({ method: 'POST', url: '/api/timers', headers: { 'x-ccrc-mail-token': TOKEN },
      payload: { fromId: 'lane-c-project-a', fromUuid: 'u-c', durationMs: 2 * HOUR, note: 'n' } });
    expect(refused(res)).toEqual([503, 'timer-unmeasured']);
  });
});
