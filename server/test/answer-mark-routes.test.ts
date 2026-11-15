// Overlord W1, answer marks (plan w1-delegation-marks.md Task 3): the operator's door, `POST /api/answer-marks`, in
// `registerLedgerOperatorRoutes`, and the marks every operator answer carries on an item, over `buildServer` and a fixture
// coord.db. Armed with a passphrase session, and dark. The coordinator's box-token items read carries none (F13).
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { ItemView, WaitingView } from '../../shared/ledgers.js';
import type { AnswerMarkView } from '../../shared/answerMarks.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const PASS = 'correct horse battery staple';
const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const HOUR = 3_600_000;
const WINDOW = 48 * HOUR;

let app: FastifyInstance | null = null;
afterEach(async () => { vi.restoreAllMocks(); await app?.close(); app = null; removeTmpFixtures(); });

interface Rig { app: FastifyInstance; coord: CoordStore; cookie: string | null; waiting: () => number; runA: number }
async function rig(o: { armed: boolean }): Promise<Rig> {
  const home = mkTmp('ccrc-answer-mark-routes-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  seedRow(home, 'lane-a');
  if (o.armed) writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASS, FAST, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  let waiting = 0;
  bus.on('waiting', () => { waiting += 1; });
  const base = testDeps(home, recorder().run);
  app = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: o.armed }, mailToken: ID_GATE_TOKEN, coord }, bus);
  let cookie: string | null = null;
  if (o.armed) {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASS } });
    expect(login.statusCode, login.body).toBe(204);
    const set = login.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    cookie = line.slice(0, line.indexOf(';'));
  }
  const runA = (coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a' }) as { id: number }).id;
  return { app, coord, cookie, waiting: () => waiting, runA };
}

type Kind = 'decide' | 'do' | 'value' | 'secret';
/** An item of `kind`, then put in `state` with `closedAt` and `heldUntil` by hand (the moves have their own tests). */
const item = (r: Rig, kind: Kind = 'decide', o: { state?: string; closedAt?: number | null; heldUntil?: number | null } = {}): number => {
  const id = r.coord.raiseItem({
    program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind, title: `a ${kind} item`, why: 'w', how: [],
    options: kind === 'decide' ? ['main', 'release'] : null, recommended: kind === 'decide' ? 0 : null,
    recommendedWhy: kind === 'decide' ? 'Main is what ships.' : null, neededBy: 'soon', soonLabel: null,
    secretSlot: kind === 'secret' ? 'slot-a' : null,
  }, Date.now() - 3 * WINDOW);
  r.coord.db.prepare('UPDATE operator_items SET state = ?, closedAt = ?, heldUntil = ? WHERE id = ?')
    .run(o.state ?? 'open', o.closedAt ?? null, o.heldUntil ?? null, id);
  return id;
};
const headers = (r: Rig, h?: Record<string, string>): Record<string, string> => h ?? (r.cookie === null ? {} : { cookie: r.cookie });
const mark = (r: Rig, payload: unknown, h?: Record<string, string>) =>
  r.app.inject({ method: 'POST', url: '/api/answer-marks', headers: headers(r, h), payload: payload as Record<string, unknown> });
const post = (r: Rig, url: string, payload: unknown = {}) => r.app.inject({ method: 'POST', url, headers: headers(r), payload: payload as never });
const waitingView = async (r: Rig): Promise<WaitingView> => {
  const res = await r.app.inject({ method: 'GET', url: '/api/waiting', headers: headers(r) });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { waiting: WaitingView }).waiting;
};
const viewOf = async (r: Rig, id: number): Promise<ItemView | undefined> => {
  const v = await waitingView(r);
  return [...v.items, ...v.cleared].find((i) => i.id === id);
};
const actors = (r: Rig) => r.coord.db.prepare('SELECT actor FROM answer_marks ORDER BY id').all();
const NEVER: AnswerMarkView = { state: 'never' };

describe('POST /api/answer-marks, armed', () => {
  it('a could-answer tick on an open decide item answers marked, stores the device actor and emits one waiting frame', async () => {
    const r = await rig({ armed: true });
    const id = item(r);
    const res = await mark(r, { kind: 'item', id, mark: 'could-answer', value: true });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { ok: true; mark: string; answerMark: AnswerMarkView };
    expect(body).toMatchObject({ ok: true, mark: 'could-answer', answerMark: { state: 'marked', signedIn: true } });
    // The login's user agent (`inject`'s own) through `ccdargv.ts#deviceActor`, as the rank door records it.
    expect(actors(r)).toEqual([{ actor: 'device:lightMyRequest' }]);
    expect(r.waiting()).toBe(1);
  });

  it('the same tick again answers marked, stores nothing more and emits no frame', async () => {
    const r = await rig({ armed: true });
    const id = item(r);
    await mark(r, { kind: 'item', id, mark: 'could-answer', value: true });
    const again = await mark(r, { kind: 'item', id, mark: 'could-answer', value: true });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { answerMark: AnswerMarkView }).answerMark).toMatchObject({ state: 'marked' });
    expect(actors(r)).toHaveLength(1);
    expect(r.waiting()).toBe(1);
  });

  it('an unsure tick on the same item leaves its could-answer mark as it was', async () => {
    const r = await rig({ armed: true });
    const id = item(r);
    await mark(r, { kind: 'item', id, mark: 'could-answer', value: true });
    expect((await mark(r, { kind: 'item', id, mark: 'unsure', value: true })).statusCode).toBe(200);
    expect((await mark(r, { kind: 'item', id, mark: 'unsure', value: false })).statusCode).toBe(200);
    const v = await viewOf(r, id);
    expect(v?.answerMarks?.couldAnswer).toMatchObject({ state: 'marked' });
    expect(v?.answerMarks?.unsure).toMatchObject({ state: 'withdrawn', signedIn: true });
  });

  it('without a session it is 401, and with the box token alone it is still 401', async () => {
    const r = await rig({ armed: true });
    const id = item(r);
    expect((await mark(r, { kind: 'item', id, mark: 'unsure', value: true }, {})).statusCode).toBe(401);
    expect((await mark(r, { kind: 'item', id, mark: 'unsure', value: true }, { 'x-ccrc-mail-token': ID_GATE_TOKEN })).statusCode).toBe(401);
    expect(actors(r)).toEqual([]);
  });
});

describe('POST /api/answer-marks, dark', () => {
  it('accepts the same tick and stores flag-off, and the view reads signedIn false', async () => {
    const r = await rig({ armed: false });
    const id = item(r, 'value');
    const res = await mark(r, { kind: 'item', id, mark: 'unsure', value: true });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { answerMark: AnswerMarkView }).answerMark).toMatchObject({ state: 'marked', signedIn: false });
    expect(actors(r)).toEqual([{ actor: 'flag-off' }]);
    expect((await viewOf(r, id))?.answerMarks?.unsure).toMatchObject({ state: 'marked', signedIn: false });
  });
});

describe('POST /api/answer-marks: refusals write nothing and emit nothing', () => {
  it('an absent item is 404 unknown-item', async () => {
    const r = await rig({ armed: false });
    const res = await mark(r, { kind: 'item', id: 999, mark: 'unsure', value: true });
    expect([res.statusCode, (res.json() as { error: string }).error]).toEqual([404, 'unknown-item']);
  });

  it('a do item, a withdrawn item, a held item and a cleared item past the window are each 409 not-markable, with the reason', async () => {
    const r = await rig({ armed: false });
    const now = Date.now();
    const cases: [number, string][] = [
      [item(r, 'do'), 'no-box'],
      [item(r, 'secret'), 'no-box'],
      [item(r, 'decide', { state: 'withdrawn', closedAt: now - HOUR }), 'not-listed'],
      [item(r, 'decide', { state: 'dismissed', closedAt: now - HOUR }), 'not-listed'],
      [item(r, 'decide', { heldUntil: now + HOUR }), 'not-shown'],
      [item(r, 'value', { state: 'done', closedAt: now - WINDOW - HOUR }), 'past-window'],
    ];
    for (const [id, reason] of cases) {
      const res = await mark(r, { kind: 'item', id, mark: 'could-answer', value: true });
      expect([res.statusCode, res.json()], `item ${id}`).toEqual([409, { ok: false, error: 'not-markable', detail: reason }]);
    }
    expect(actors(r)).toEqual([]);
    expect(r.waiting()).toBe(0);
  });

  it('each shape refusal is bad-request, and so is kind ask until PR B', async () => {
    const r = await rig({ armed: false });
    const id = item(r);
    const good = { kind: 'item', id, mark: 'unsure', value: true };
    for (const body of [{}, { ...good, extra: 1 }, { ...good, kind: 'approval' }, { ...good, mark: 'sure' }, { ...good, id: 0 },
      { ...good, id: 1.5 }, { ...good, id: '3' }, { ...good, value: 1 }, { ...good, value: 'true' }, { ...good, kind: 'ask' }]) {
      const res = await mark(r, body);
      expect([res.statusCode, (res.json() as { error: string }).error], JSON.stringify(body)).toEqual([400, 'bad-request']);
    }
    expect((await mark(r, { ...good, kind: 'ask' })).json()).toMatchObject({ detail: 'ask-marks-not-yet' });
    expect(actors(r)).toEqual([]);
  });
});

describe('the marks on the items each answer carries (F13)', () => {
  it('GET /api/waiting carries both marks, never before a tick, on every open and cleared decide and value item', async () => {
    const r = await rig({ armed: false });
    const open = item(r, 'decide');
    const checking = item(r, 'value', { state: 'checking' });
    const cleared = item(r, 'decide', { state: 'done', closedAt: Date.now() - HOUR });
    const v = await waitingView(r);
    for (const id of [open, checking]) expect(v.items.find((i) => i.id === id)?.answerMarks).toEqual({ couldAnswer: NEVER, unsure: NEVER });
    expect(v.cleared.find((i) => i.id === cleared)?.answerMarks).toEqual({ couldAnswer: NEVER, unsure: NEVER });
    await mark(r, { kind: 'item', id: cleared, mark: 'could-answer', value: true });
    expect((await viewOf(r, cleared))?.answerMarks).toMatchObject({ couldAnswer: { state: 'marked' }, unsure: NEVER });
  });

  it('a do or secret item carries no answerMarks', async () => {
    const r = await rig({ armed: false });
    const ids = [item(r, 'do'), item(r, 'secret')];
    const v = await waitingView(r);
    for (const id of ids) {
      const found = v.items.find((i) => i.id === id);
      expect(found).toBeDefined();
      expect(found).not.toHaveProperty('answerMarks');
    }
  });

  it('GET /api/items/:id carries the marks inside the window and none on an item past it', async () => {
    const r = await rig({ armed: false });
    const inside = item(r, 'decide', { state: 'done', closedAt: Date.now() - HOUR });
    const past = item(r, 'decide', { state: 'done', closedAt: Date.now() - WINDOW - HOUR });
    const one = async (id: number) => (await r.app.inject({ method: 'GET', url: `/api/items/${id}` })).json() as { item: ItemView };
    expect((await one(inside)).item.answerMarks).toEqual({ couldAnswer: NEVER, unsure: NEVER });
    expect((await one(past)).item).not.toHaveProperty('answerMarks');
  });

  it('with the mark read made to throw, GET /api/waiting still answers its items, each with both marks unmeasured', async () => {
    const r = await rig({ armed: false });
    const id = item(r);
    const plain = item(r, 'do');
    r.coord.db.exec('DROP TABLE answer_marks');
    const v = await waitingView(r);
    const marks = v.items.find((i) => i.id === id)?.answerMarks;
    expect(marks?.couldAnswer.state).toBe('unmeasured');
    expect(marks?.unsure.state).toBe('unmeasured');
    expect(v.items.find((i) => i.id === plain)).not.toHaveProperty('answerMarks');
  });

  it('a tick\'s answer carries the item\'s marks, and a dismiss\'s carries none', async () => {
    const r = await rig({ armed: false });
    const ticked = item(r);
    await mark(r, { kind: 'item', id: ticked, mark: 'unsure', value: true });
    const t = await post(r, `/api/items/${ticked}/tick`, { answer: 'main' });
    expect(t.statusCode, t.body).toBe(200);
    expect((t.json() as { item: ItemView }).item.answerMarks).toMatchObject({ couldAnswer: NEVER, unsure: { state: 'marked' } });
    const dismissed = item(r);
    r.coord.db.prepare("UPDATE runs SET state = 'done' WHERE program = 'prog-a'").run();
    const d = await post(r, `/api/items/${dismissed}/dismiss`);
    expect(d.statusCode, d.body).toBe(200);
    expect((d.json() as { item: ItemView }).item).not.toHaveProperty('answerMarks');
  });

  it('the coordinator\'s box-token items read carries no answerMarks, even on a marked item', async () => {
    const r = await rig({ armed: false });
    const id = item(r);
    await mark(r, { kind: 'item', id, mark: 'unsure', value: true });
    const res = await r.app.inject({
      method: 'GET', url: '/api/programmes/prog-a/items?byId=lane-a&byUuid=u-lane-a', headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { items: ItemView[] }).items;
    expect(items.map((i) => i.id)).toContain(id);
    for (const i of items) expect(i).not.toHaveProperty('answerMarks');
  });
});
