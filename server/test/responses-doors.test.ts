// Overlord W1, the response record, Task 8 (plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md): "I handled
// this elsewhere" (C69), the response read the console's control needs, and the retention pair (§9.4, question 16).
// Lowering retention asks the account gate's step-up; raising it, or setting the stored value, needs the session alone.
// The retention door runs on a bare Fastify instance with the REAL account gate and step-up store (as the Linear routes'
// suite does), so the step-up posture is measured; the whole server's session gate is proven through `buildServer`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest, type LightMyRequestResponse } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { registerResponseRoutes } from '../src/responses/routes.js';
import { createAccountGate } from '../src/accounts/gate.js';
import { measureSecret, sessionVerdict } from '../src/auth/gate.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { SESSION_COOKIE } from '../src/auth/cookie.js';
import { SessionStore, sessionIdHash } from '../src/auth/sessions.js';
import { PasskeyStore } from '../src/auth/credentials.js';
import { createStepUp } from '../src/auth/stepup.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { tx } from '../src/coord/tx.js';
import { insertDigestResponsesInTx, insertPushResponseInTx, insertWaitingResponseInTx, landPushVerdictInTx } from '../src/coord/responsesStore.js';
import { responsesFor } from '../src/responses.js';
import type { NoticeRecord } from '../src/notice.js';
import type { ResponseStamp } from '../../shared/responses.js';
import { fakeTime } from './fakeTime.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const T = 1_800_000_000_000;
const STAMP: ResponseStamp = { boot: { kind: 'measured', epoch: 1 }, restore: { kind: 'unmeasured' } };

let open: FastifyInstance | null = null;
afterEach(async () => { vi.restoreAllMocks(); await open?.close(); open = null; removeTmpFixtures(); });

const coordIn = (home: string): CoordStore => new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));

/** An item with its Waiting on you row and two push rows that carried it, and a digest line. */
function seed(c: CoordStore): { item: number; waiting: number; pushes: number[]; digest: number } {
  const item = c.raiseItem({ program: 'prog-a', runId: null, raisedBy: 'lane-a', kind: 'do', title: 'Do it', why: 'because', how: ['step'],
    options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, T);
  tx(c.db, () => {
    insertWaitingResponseInTx(c.db, { source: 'item', id: item, stamp: STAMP, at: T });
    for (const p of ['1', '2']) {
      insertPushResponseInTx(c.db, { pushId: p.repeat(32), label: 'item', carries: { kind: 'item', id: item }, hasActions: false, tag: `item-${item}`, stamp: STAMP, at: T });
      landPushVerdictInTx(c.db, p.repeat(32), { accepted: ['a'.repeat(64)], terminal: true, answered: true }, T + 1);
    }
    insertPushResponseInTx(c.db, { pushId: '3'.repeat(32), label: 'disk', carries: null, hasActions: false, tag: 'disk', stamp: STAMP, at: T });
    insertDigestResponsesInTx(c.db, { day: '2026-11-16', lines: [{ rowKind: 'ask', id: 4 }], stamp: STAMP, at: T, windowCapAt: T + 99 });
  });
  const ids = (sql: string): number[] => (c.db.prepare(sql).all() as { id: number }[]).map((r) => r.id);
  return { item, waiting: ids("SELECT id FROM operator_responses WHERE kind = 'waiting'")[0]!,
    pushes: ids("SELECT id FROM operator_responses WHERE kind = 'push' AND carriesKind = 'item' ORDER BY id"),
    digest: ids("SELECT id FROM operator_responses WHERE kind = 'digest'")[0]! };
}

async function server(authEnabled = false): Promise<{ app: FastifyInstance; coord: CoordStore; now: () => number }> {
  const home = mkTmp('ccrc-response-doors-');
  const base = testDeps(home);
  const coord = coordIn(home);
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled }, coord };
  const app = await buildServer(deps);
  await app.ready();
  open = app;
  return { app, coord, now: () => deps.time.clock.wall() };
}

describe('POST /api/responses/:id/handled (C69)', () => {
  it('sets handledAt once on a delivered and on a sealed row, writing nothing else', async () => {
    const { app, coord, now } = await server();
    const s = seed(coord);
    coord.db.prepare("UPDATE operator_responses SET state = 'sealed', outcome = 'not-opened', sealedAt = 5 WHERE id = ?").run(s.pushes[0]);
    const before = coord.db.prepare('SELECT * FROM operator_responses ORDER BY id').all() as Record<string, unknown>[];
    for (const id of [s.waiting, s.pushes[0]!]) {
      const res = await app.inject({ method: 'POST', url: `/api/responses/${id}/handled` });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({ ok: true, id, handledAt: now(), changed: true });
    }
    const after = coord.db.prepare('SELECT * FROM operator_responses ORDER BY id').all() as Record<string, unknown>[];
    expect(after.map(({ handledAt: _h, ...rest }) => rest)).toEqual(before.map(({ handledAt: _h, ...rest }) => rest));
    expect(after.find((r) => r.id === s.pushes[0])).toMatchObject({ state: 'sealed', outcome: 'not-opened', sealedAt: 5, handledAt: now() });
    expect(coord.itemById(s.item)).toMatchObject({ state: 'open' });
  });

  it('a repeat answers the first time, changed false; an unknown id is not-found; a bad id is bad-request', async () => {
    const { app, coord } = await server();
    const s = seed(coord);
    coord.db.prepare('UPDATE operator_responses SET handledAt = 77 WHERE id = ?').run(s.waiting);
    expect((await app.inject({ method: 'POST', url: `/api/responses/${s.waiting}/handled` })).json()).toEqual({ ok: true, id: s.waiting, handledAt: 77, changed: false });
    expect((await app.inject({ method: 'POST', url: '/api/responses/9999/handled' })).json()).toMatchObject({ ok: false, error: 'not-found' });
    for (const bad of ['0', 'x1', '-3', '1.5']) {
      expect((await app.inject({ method: 'POST', url: `/api/responses/${bad}/handled` })).json(), bad).toMatchObject({ ok: false, error: 'bad-request' });
    }
  });

  it('armed with no cookie: 401, and nothing written', async () => {
    const { app, coord } = await server(true);
    const s = seed(coord);
    expect((await app.inject({ method: 'POST', url: `/api/responses/${s.waiting}/handled` })).statusCode).toBe(401);
    expect(coord.db.prepare('SELECT COUNT(*) AS n FROM operator_responses WHERE handledAt IS NOT NULL').get()).toEqual({ n: 0 });
  });

  it('a handled row is read by responsesFor as acted, elsewhere, whatever its seal said', async () => {
    const { app, coord } = await server();
    const s = seed(coord);
    coord.db.prepare("UPDATE operator_responses SET state = 'sealed', outcome = 'settled-elsewhere', sealedAt = 5 WHERE id = ?").run(s.pushes[0]);
    await app.inject({ method: 'POST', url: `/api/responses/${s.pushes[0]}/handled` });
    const views = (coord.db.prepare("SELECT kind, label, delivery, outcome, why, admittedAt, deliveredAt, openedAt, actedAt, handledAt FROM operator_responses WHERE id = ?")
      .all(s.pushes[0]) as unknown) as Parameters<typeof responsesFor>[0];
    expect(responsesFor(views, { by: 'label', kind: 'push', label: 'item' }, 0, T + 2)).toMatchObject({ acted: 1, elsewhere: 1, measured: 1 });
  });
});

describe('GET /api/responses?ref=…', () => {
  it('an item: its Waiting on you row and every push that carried it, ids, kinds, labels, states, outcomes and handled times only', async () => {
    const { app, coord } = await server();
    const s = seed(coord);
    const res = await app.inject({ method: 'GET', url: `/api/responses?ref=item:${s.item}` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, rows: [
      { id: s.waiting, kind: 'waiting', label: 'item', state: 'delivered', outcome: null, handledAt: null },
      { id: s.pushes[0], kind: 'push', label: 'item', state: 'delivered', outcome: null, handledAt: null },
      { id: s.pushes[1], kind: 'push', label: 'item', state: 'delivered', outcome: null, handledAt: null },
    ] });
  });
  it('a digest key: its line', async () => {
    const { app, coord } = await server();
    const s = seed(coord);
    expect((await app.inject({ method: 'GET', url: '/api/responses?ref=digest:2026-11-16:ask:4' })).json())
      .toEqual({ ok: true, rows: [{ id: s.digest, kind: 'digest', label: 'ask', state: 'delivered', outcome: null, handledAt: null }] });
  });
  it('a malformed ref is bad-request; a failed read is unavailable, never an empty list', async () => {
    const { app, coord } = await server();
    seed(coord);
    // 9999999999999999 matches the id's sixteen digits but is no safe integer (review 2260 F8).
    for (const ref of ['', 'item:', 'item:x', 'item:9999999999999999', 'ask:3', 'digest:2026-11-16:nope:4', 'push:1']) {
      expect((await app.inject({ method: 'GET', url: `/api/responses?ref=${ref}` })).json(), ref).toMatchObject({ ok: false, error: 'bad-request' });
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    coord.db.prepare("UPDATE operator_responses SET state = 'weighed' WHERE kind = 'digest'").run();
    expect((await app.inject({ method: 'GET', url: '/api/responses?ref=digest:2026-11-16:ask:4' })).json()).toMatchObject({ ok: false, error: 'unavailable' });
  });
});

interface RetentionRig { app: FastifyInstance; coord: CoordStore; cookie: string; stamp: () => Promise<void>; notices: NoticeRecord[] }

/** The retention door on a bare instance with the real account gate and step-up store, armed or dark. */
async function retentionRig(enabled = true): Promise<RetentionRig> {
  const home = mkTmp('ccrc-response-retention-');
  const dir = path.join(home, '.ccrc');
  mkdirSync(dir, { recursive: true });
  const secretPath = path.join(dir, 'auth.scrypt');
  writeFileSync(secretPath, `${await hashLine('a test passphrase', FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const sessions = new SessionStore(path.join(dir, 'sessions.json'));
  const { token } = await sessions.create('a test phone', 1, Date.now());
  const stepUp = createStepUp({
    enabled, store: sessions, passkeys: new PasskeyStore(path.join(dir, 'passkeys.json')),
    secretNow: () => measureSecret(secretPath), rpProblem: () => null, rpId: 'localhost', device: () => null,
  });
  const gate = createAccountGate({
    enabled, origin: 'http://localhost:7788',
    sessionAuth: (req: FastifyRequest) => sessionVerdict(req, { enabled, secret: measureSecret(secretPath), store: sessions }, Date.now()),
    fleetState: () => undefined, stepUp,
  });
  const coord = coordIn(home);
  const notices: NoticeRecord[] = [];
  const app = Fastify({ logger: false });
  registerResponseRoutes(app, { coord, time: fakeTime({ wallMs: T }).ports, gate,
    notice: (ev) => { notices.push(ev); return { recorded: true } as never; }, actorOf: () => 'device:a test phone' });
  await app.ready();
  open = app;
  return { app, coord, notices, cookie: `${SESSION_COOKIE}=${token}`,
    stamp: async () => { expect(await sessions.stampAsserted(sessionIdHash(token), Date.now())).toBe(true); } };
}
const setDays = (r: RetentionRig, days: unknown): Promise<LightMyRequestResponse> => r.app.inject({ method: 'POST', url: '/api/responses/retention',
  headers: { cookie: r.cookie, 'content-type': 'application/json' }, payload: JSON.stringify({ days }) });
const stored = (r: RetentionRig): unknown => (r.coord.db.prepare('SELECT retentionDays FROM response_settings').get() as { retentionDays: unknown } | undefined)?.retentionDays;

describe('GET and POST /api/responses/retention (§9.4, question 16)', () => {
  it('reads the stored days with the default and the bounds', async () => {
    const r = await retentionRig();
    expect((await r.app.inject({ method: 'GET', url: '/api/responses/retention', headers: { cookie: r.cookie } })).json())
      .toEqual({ ok: true, days: 180, default: 180, min: 14, max: 3650 });
  });
  it('an unreadable stored value reads as unreadable, never the default', async () => {
    const r = await retentionRig();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    r.coord.db.prepare('UPDATE response_settings SET retentionDays = 0').run();
    expect((await r.app.inject({ method: 'GET', url: '/api/responses/retention' })).json())
      .toEqual({ ok: true, days: null, unreadable: true, default: 180, min: 14, max: 3650 });
  });
  it('its bounds: 13 and 3,651 refused, 14 and 3,650 taken (with the step-up for the lowering)', async () => {
    const r = await retentionRig();
    for (const bad of [13, 3_651, 30.5, '30', null]) expect((await setDays(r, bad)).json(), String(bad)).toMatchObject({ ok: false, error: 'bad-request' });
    await r.stamp();
    expect((await setDays(r, 14)).json()).toMatchObject({ ok: true, days: 14 });
    expect((await setDays(r, 3_650)).json()).toMatchObject({ ok: true, days: 3_650 });
  });
  it('lowering without a recent step-up answers step-up-required and writes nothing; with one it is written, with a feed row', async () => {
    const r = await retentionRig();
    const res = await setDays(r, 30);
    expect(res.json()).toMatchObject({ ok: false, error: 'step-up-required' });
    expect(stored(r)).toBe(180);
    expect(r.notices).toEqual([]);
    await r.stamp();
    expect((await setDays(r, 30)).json()).toMatchObject({ ok: true, days: 30 });
    expect(stored(r)).toBe(30);
    expect(r.notices).toEqual([expect.objectContaining({ kind: 'coord', title: 'response retention changed',
      body: 'response retention: 180 -> 30 days; by device:a test phone' })]);
  });
  it('lowering while sign-in is dark answers auth-off and writes nothing', async () => {
    const r = await retentionRig(false);
    expect((await setDays(r, 30)).json()).toMatchObject({ ok: false, error: 'auth-off' });
    expect(stored(r)).toBe(180);
  });
  it('raising writes with the session alone; the stored value again writes nothing new and records no feed row', async () => {
    const r = await retentionRig();
    expect((await setDays(r, 365)).json()).toMatchObject({ ok: true, days: 365 });
    expect((await setDays(r, 365)).json()).toMatchObject({ ok: true, days: 365 });
    expect(r.notices).toHaveLength(1);
    const dark = await retentionRig(false);
    expect((await setDays(dark, 180)).json()).toMatchObject({ ok: true, days: 180 });
    expect((await setDays(dark, 400)).json()).toMatchObject({ ok: true, days: 400 });
  });
  it('lowering over an unreadable stored value asks the step-up', async () => {
    const r = await retentionRig();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    r.coord.db.prepare('DELETE FROM response_settings').run();
    expect((await setDays(r, 400)).json()).toMatchObject({ ok: false, error: 'step-up-required' });
    // With the step-up, the missing row is written back, never a 200 that kept nothing (review 2260 F4).
    await r.stamp();
    expect((await setDays(r, 400)).json()).toEqual({ ok: true, days: 400, default: 180, min: 14, max: 3650 });
    expect(stored(r)).toBe(400);
  });
});
