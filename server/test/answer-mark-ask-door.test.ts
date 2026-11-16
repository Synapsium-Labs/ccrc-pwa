// Overlord W1, answer marks B (plan w1-delegation-marks.md Task 5): the door's ask arm and the asks the waiting view carries,
// over `registerLedgerOperatorRoutes` on a bare Fastify with a stub live-ask port, so a test can say what each child's dialog
// waits on. The door's credential, its census rows and its item arm are `answer-mark-routes.test.ts`'s, over `buildServer`.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { registerLedgerOperatorRoutes } from '../src/coord/ledgersRoutes.js';
import type { LiveAskAnswer } from '../src/coord/ports.js';
import type { WaitingView } from '../../shared/ledgers.js';
import type { AnswerMarkView } from '../../shared/answerMarks.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const NOW = 1_790_000_000_000;
const HOUR = 3_600_000;
const WINDOW = 48 * HOUR;
const NEVER: AnswerMarkView = { state: 'never' };

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; removeTmpFixtures(); });

interface Rig { app: FastifyInstance; coord: CoordStore; live: Map<string, LiveAskAnswer>; waiting: () => number; runA: number }
function rig(): Rig {
  const ccrcDir = path.join(mkTmp('ccrc-answer-mark-ask-door-'), '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  const bus = new Bus();
  let waiting = 0;
  bus.on('waiting', () => { waiting += 1; });
  const live = new Map<string, LiveAskAnswer>();
  app = Fastify({ logger: false });
  registerLedgerOperatorRoutes(app, {
    coord, bus, now: () => NOW, presenceOf: () => 'alive', gate: () => ({ pass: true }) as never, ccrcDir,
    registerSecret: () => 'unregistered', retireSecret: () => {},
    withAbandon: (async () => { throw new Error('no abandon hold in this rig'); }) as never, sendClose: ((reply: unknown) => reply) as never,
    authEnabled: false, sessionAuth: () => ({ pass: true }) as never, mailToken: () => null,
    liveAsk: (child) => live.get(child) ?? { kind: 'read', key: null },
  });
  const runA = (coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a' }) as { id: number }).id;
  return { app, coord, live, waiting: () => waiting, runA };
}

const ask = (r: Rig, o: { child?: string; state?: string; key?: string; releasedAt?: number | null; answeredAt?: number | null;
  answeredBy?: string | null; runId?: number; reached?: number }): number => Number(r.coord.db.prepare(
  'INSERT INTO asks (at, childId, parentId, runId, askKey, askAt, dialogId, question, options, state, answeredBy, answeredAt, releasedAt, ' +
  "reachedOperatorAt) VALUES (?, ?, 'lane-a-parent', ?, ?, 1, 'd', 'Which base?', '[]', ?, ?, ?, ?, ?)",
).run(NOW - 3 * WINDOW, o.child ?? 'lane-a-child', o.runId ?? r.runA, o.key ?? 'k1', o.state ?? 'released', o.answeredBy ?? null,
  o.answeredAt ?? null, o.releasedAt === undefined ? NOW - HOUR : o.releasedAt, o.reached ?? null).lastInsertRowid);
const mark = (r: Rig, id: number, m: 'could-answer' | 'unsure' = 'could-answer', value = true) =>
  r.app.inject({ method: 'POST', url: '/api/answer-marks', payload: { kind: 'ask', id, mark: m, value } });
const records = (r: Rig) => r.coord.db.prepare('SELECT kind, rowId, mark, value, actor FROM answer_marks ORDER BY id').all();
const waitingView = async (r: Rig): Promise<WaitingView> => {
  const res = await r.app.inject({ method: 'GET', url: '/api/waiting' });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { waiting: WaitingView }).waiting;
};

describe('POST /api/answer-marks: the ask arm', () => {
  it('a tick of either mark on a live released ask past the window answers marked, stores flag-off and emits a frame', async () => {
    const r = rig();
    const id = ask(r, { key: 'k1', releasedAt: NOW - WINDOW - HOUR });
    r.live.set('lane-a-child', { kind: 'read', key: 'k1' });
    for (const m of ['could-answer', 'unsure'] as const) {
      const res = await mark(r, id, m);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, mark: m, answerMark: { state: 'marked', signedIn: false } });
    }
    expect(records(r)).toEqual([
      { kind: 'ask', rowId: id, mark: 'could-answer', value: 1, actor: 'flag-off' },
      { kind: 'ask', rowId: id, mark: 'unsure', value: 1, actor: 'flag-off' },
    ]);
    expect(r.waiting()).toBe(2);
  });

  it('a declined ask inside the window answers marked; one past it is not-markable past-window', async () => {
    const r = rig();
    const inside = ask(r, { child: 'lane-a-a', state: 'declined', releasedAt: NOW - HOUR });
    const past = ask(r, { child: 'lane-a-b', state: 'declined', releasedAt: NOW - WINDOW - 1 });
    expect((await mark(r, inside)).json()).toMatchObject({ ok: true, answerMark: { state: 'marked' } });
    const res = await mark(r, past);
    expect([res.statusCode, res.json()]).toEqual([409, { ok: false, error: 'not-markable', detail: 'past-window' }]);
  });

  it('the dialog, not the child: an older ask past the window, whose key the port reads, is not live and is past-window', async () => {
    const r = rig();
    const older = ask(r, { key: 'k-old', releasedAt: NOW - WINDOW - 2 * HOUR });
    ask(r, { key: 'k-new', releasedAt: NOW - HOUR });
    r.live.set('lane-a-child', { kind: 'read', key: 'k-old' });
    expect((await mark(r, older)).json()).toEqual({ ok: false, error: 'not-markable', detail: 'past-window' });
  });

  it('a live ask past the window with the port unmeasured is past-window', async () => {
    const r = rig();
    const id = ask(r, { releasedAt: NOW - WINDOW - HOUR });
    r.live.set('lane-a-child', { kind: 'unmeasured' });
    expect((await mark(r, id)).json()).toEqual({ ok: false, error: 'not-markable', detail: 'past-window' });
  });

  it('an absent ask, and a held, answering, stale or parent-answered one that never reached the operator, is 404 unknown-ask', async () => {
    const r = rig();
    const held = ask(r, { child: 'lane-a-a', state: 'held', releasedAt: null });
    const parent = ask(r, { child: 'lane-a-b', state: 'answered', answeredBy: 'lane-a-parent', answeredAt: NOW - HOUR });
    // Review 2217 F3: a held ask taken into answering, or gone stale, never reached the operator either.
    const answering = ask(r, { child: 'lane-a-c', state: 'answering', releasedAt: null });
    const stale = ask(r, { child: 'lane-a-d', state: 'stale' });
    r.live.set('lane-a-c', { kind: 'read', key: 'k1' });
    for (const id of [999, held, parent, answering, stale]) {
      const res = await mark(r, id);
      expect([res.statusCode, res.json()], `ask ${id}`).toEqual([404, { ok: false, error: 'unknown-ask', detail: `no ask ${id}` }]);
    }
  });

  it('an answering, stale or parent-answered ask that reached the operator is markable; past the window it is past-window', async () => {
    const r = rig();
    const reached = NOW - 3 * WINDOW;
    const answering = ask(r, { child: 'lane-a-a', state: 'answering', releasedAt: NOW - WINDOW - HOUR, reached });
    r.live.set('lane-a-a', { kind: 'read', key: 'k1' });
    const stale = ask(r, { child: 'lane-a-b', state: 'stale', releasedAt: NOW - HOUR, reached });
    const parent = ask(r, { child: 'lane-a-c', state: 'answered', answeredBy: 'lane-a-parent', answeredAt: NOW - HOUR, reached });
    for (const id of [answering, stale, parent]) expect((await mark(r, id)).json(), `ask ${id}`).toMatchObject({ ok: true, answerMark: { state: 'marked' } });
    const old = ask(r, { child: 'lane-a-d', state: 'stale', releasedAt: NOW - WINDOW - 1, reached });
    const res = await mark(r, old);
    expect([res.statusCode, res.json()]).toEqual([409, { ok: false, error: 'not-markable', detail: 'past-window' }]);
    for (const state of ['unknown', 'archived']) {
      const odd = await mark(r, ask(r, { child: `lane-a-${state}`, state, reached }));
      expect([odd.statusCode, odd.json()]).toEqual([409, { ok: false, error: 'not-markable', detail: 'not-listed' }]);
    }
  });

  it('an ask the operator answered inside the window is markable', async () => {
    const r = rig();
    const mine = ask(r, { child: 'lane-a-mine', state: 'answered', answeredBy: 'operator', answeredAt: NOW - HOUR });
    expect((await mark(r, mine)).json()).toMatchObject({ ok: true, answerMark: { state: 'marked' } });
  });

  it('an unreadable newest row of the same child does not refuse a readable older ask (review 2217 F4)', async () => {
    const r = rig();
    const older = ask(r, { key: 'k-old', releasedAt: NOW - HOUR });
    const newer = ask(r, { key: 'k-new', releasedAt: NOW - HOUR });
    r.coord.db.prepare("UPDATE asks SET runId = CAST('1152921504606846976' AS INTEGER) WHERE id = ?").run(newer);
    expect((await mark(r, older)).json()).toMatchObject({ ok: true, answerMark: { state: 'marked' } });
    expect((await mark(r, newer)).statusCode).toBe(503);
  });

  it('an ask row this box cannot read is 503 ask-unreadable, never absent, and writes nothing', async () => {
    const r = rig();
    const id = ask(r, {});
    r.coord.db.prepare("UPDATE asks SET runId = CAST('1152921504606846976' AS INTEGER) WHERE id = ?").run(id);
    const res = await mark(r, id);
    expect([res.statusCode, (res.json() as { error: string }).error]).toEqual([503, 'ask-unreadable']);
    expect(records(r)).toEqual([]);
    expect(r.waiting()).toBe(0);
  });
});

describe('the asks the waiting view carries', () => {
  it('live asks in asks, the rest in asksCleared, each with both marks, never before a tick and marked after it', async () => {
    const r = rig();
    const liveId = ask(r, { child: 'lane-a-a', key: 'k1', releasedAt: NOW - WINDOW - HOUR });
    const gone = ask(r, { child: 'lane-a-b', key: 'k2', releasedAt: NOW - HOUR });
    const mine = ask(r, { child: 'lane-a-c', state: 'answered', answeredBy: 'operator', answeredAt: NOW - 2 * HOUR });
    ask(r, { child: 'lane-a-d', state: 'held', releasedAt: null });
    r.live.set('lane-a-a', { kind: 'read', key: 'k1' });
    r.live.set('lane-a-b', { kind: 'read', key: 'k-other' });
    const v = await waitingView(r);
    expect(v.asks?.map((a) => [a.id, a.live, a.how, a.program])).toEqual([[liveId, true, 'lapsed', 'prog-a']]);
    expect(v.asksCleared?.map((a) => [a.id, a.live, a.how])).toEqual([[gone, false, 'lapsed'], [mine, false, 'answered']]);
    for (const a of [...v.asks ?? [], ...v.asksCleared ?? []]) expect(a.answerMarks).toEqual({ couldAnswer: NEVER, unsure: NEVER });
    await mark(r, gone, 'unsure');
    const after = await waitingView(r);
    expect(after.asksCleared?.find((a) => a.id === gone)?.answerMarks).toMatchObject({ couldAnswer: NEVER, unsure: { state: 'marked' } });
  });

  it('a failed mark read gives each listed ask both marks unmeasured; a failed read of the asks leaves both lists absent, items kept', async () => {
    const r = rig();
    ask(r, {});
    r.coord.db.exec('DROP TABLE answer_marks');
    const v = await waitingView(r);
    expect(v.asksCleared?.[0]?.answerMarks.couldAnswer.state).toBe('unmeasured');
    r.coord.db.exec('DROP TABLE asks');
    const gone = await waitingView(r);
    expect(gone).not.toHaveProperty('asks');
    expect(gone).not.toHaveProperty('asksCleared');
    expect(gone.items).toEqual([]);
  });
});
