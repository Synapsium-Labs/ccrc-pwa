// D-8181: the plan verbs' routes (`coord/planRoutes.ts`) over a real coord.db, on a bare Fastify instance: the box token, the
// identity pair, attribution, the caller check, the plan's own refusals and the shared mutex.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { planStorePort, type PlanStorePort } from '../src/coord/planStore.js';
import { registerPlanRoutes, type PlanRouteOpts } from '../src/coord/planRoutes.js';
import { answerMasked } from '../src/server.js';
import type { GateDecision } from '../src/auth/gate.js';
import type { PlanView } from '../../shared/plan.js';
import { setLinking } from '../src/coord/linkingStore.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'k'.repeat(64);
let dir: string;
let coord: CoordStore;
let plan: PlanStorePort;
let app: FastifyInstance;
/** The runs a session holds, for the follow-up verb's own-epic check. */
let runs: Record<string, { program: string; epicId: number | null }>;
let lock: Promise<unknown>;
let session: GateDecision;
let authEnabled: boolean;

const NO: GateDecision = { allow: false, verdict: 'no-session', reason: 'refused', device: null };
const serial: PlanRouteOpts['serial'] = (fn) => { const next = lock.then(fn, fn); lock = next.catch(() => undefined); return next; };

const build = async (): Promise<FastifyInstance> => {
  const a = Fastify();
  registerPlanRoutes(a, {
    coord, plan, serial, mailToken: () => TOKEN, attribute: async () => ({ ok: true }),
    sessionAuth: () => session, authEnabled, readLinearStore: async () => ({ kind: 'unreadable', code: 'ENOENT' }),
    runOfSession: (id) => runs[id] ?? null, now: () => 1_000,
  });
  await a.ready();
  return a;
};

beforeEach(async () => {
  dir = mkTmp('ccrc-plan-routes-');
  coord = new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
  plan = planStorePort(coord.db);
  runs = {}; lock = Promise.resolve(); session = NO; authEnabled = false;
  app = await build();
});
afterEach(async () => { await app.close(); coord.db.close(); rmSync(dir, { recursive: true, force: true }); });

const epic = (key: string, waves: number[], over: Record<string, unknown> = {}) => ({
  key, title: `Epic ${key}`, summary: 's', waves, checkpoints: [{ key: `${key}-c1`, title: 'c', kind: 'acceptance' }], ...over,
});
const send = (url: string, body: unknown, who = 'coord-a', token: string | null = TOKEN) =>
  app.inject({
    method: 'POST', url: `${url}?byId=${who}&byUuid=u-${who}`, payload: body as never,
    headers: token === null ? {} : { 'x-ccrc-mail-token': token },
  });
const put = (body: unknown, who = 'coord-a', slug = 'prog-a') => send(`/api/programmes/${slug}/plan`, body, who);
const view = (res: { json: () => unknown }): PlanView => (res.json() as { plan: PlanView }).plan;
const errorOf = (res: { json: () => unknown }): string => (res.json() as { error?: string }).error ?? '';
const FIRST = { home: 'project-a', epics: [epic('e1', [1]), epic('e2', [2])] };

describe('plan put', () => {
  it('a put by the claimant stores the plan and answers PlanView', async () => {
    const res = await put(FIRST);
    expect(res.statusCode).toBe(200);
    expect(view(res).epics.map((e) => [e.key, e.state, e.checkpoints.length])).toEqual([['e1', 'planned', 1], ['e2', 'planned', 1]]);
    expect(view(res).planned).toBe(true);
  });

  it('a programme with no run accepts its first put and records planBy', async () => {
    await put(FIRST);
    expect(plan.planOf('prog-a').planBy).toBe('coord-a');
    expect(plan.planOwnerOf('prog-a')).toBe('coord-a');
  });

  it('a put by another session is not-plan-owner', async () => {
    await put(FIRST);
    const res = await put({ ...FIRST, epics: [epic('e1', [1])] }, 'coord-b');
    expect([res.statusCode, errorOf(res)]).toEqual([403, 'not-plan-owner']);
    expect(plan.planOf('prog-a').epics).toHaveLength(2);
  });

  it('a put on a new slug with home inserts the programme row (active, that home, planRequired 1), and a later runs open keeps it', async () => {
    await put(FIRST);
    expect(coord.db.prepare("SELECT state, homeProject, planRequired FROM programs WHERE slug = 'prog-a'").get())
      .toEqual({ state: 'active', homeProject: 'project-a', planRequired: 1 });
    const r = coord.openRun({ program: 'prog-a', title: 'w', project: 'project-a', wave: 1, waveOf: 2, claimedBy: 'coord-a', homeProject: 'project-a' });
    expect('id' in r).toBe(true);
    expect(coord.db.prepare("SELECT homeProject, planRequired FROM programs WHERE slug = 'prog-a'").get()).toEqual({ homeProject: 'project-a', planRequired: 1 });
  });

  it('a put on a new slug with no home is plan-bad-body and stores nothing', async () => {
    const res = await put({ epics: [epic('e1', [1])] });
    expect([res.statusCode, errorOf(res)]).toEqual([400, 'plan-bad-body']);
    expect(coord.db.prepare("SELECT count(*) AS n FROM programs WHERE slug = 'prog-a'").get()).toEqual({ n: 0 });
  });

  it('a put on linear-sync is reserved-programme', async () => {
    const res = await put(FIRST, 'coord-a', 'linear-sync');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'reserved-programme' });
  });

  it('a put after close is plan-closed', async () => {
    await put(FIRST);
    expect((await send('/api/programmes/prog-a/plan/close', { outcome: 'done' })).statusCode).toBe(200);
    const res = await put(FIRST);
    expect([res.statusCode, errorOf(res)]).toEqual([409, 'plan-closed']);
  });

  it('a tokenless call is 401 before anything is read', async () => {
    const res = await send('/api/programmes/prog-a/plan', FIRST, 'coord-a', null);
    expect(res.statusCode).toBe(401);
    expect(plan.planOf('prog-a').epics).toEqual([]);
  });

  it('a call with no identity pair in the query is bad-request', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/programmes/prog-a/plan', payload: FIRST, headers: { 'x-ccrc-mail-token': TOKEN } });
    expect([res.statusCode, errorOf(res)]).toEqual([400, 'bad-request']);
  });
});

describe('plan close', () => {
  it('close abandoned with no why is dropped-needs-reason', async () => {
    await put(FIRST);
    const res = await send('/api/programmes/prog-a/plan/close', { outcome: 'abandoned' });
    expect([res.statusCode, errorOf(res)]).toEqual([400, 'dropped-needs-reason']);
  });

  it('close with a run working is plan-runs-open', async () => {
    await put(FIRST);
    coord.openRun({ program: 'prog-a', title: 'w', project: 'project-a', wave: 1, waveOf: 2, claimedBy: 'coord-a', homeProject: 'project-a' });
    const res = await send('/api/programmes/prog-a/plan/close', { outcome: 'done' });
    expect([res.statusCode, errorOf(res)]).toEqual([409, 'plan-runs-open']);
  });

  it('a plan close sent while a runs open waits on its child gate lands after the open, then answers plan-runs-open', async () => {
    await put(FIRST);
    let release!: () => void;
    const held = serial(() => new Promise<void>((r) => { release = r; }).then(() => {
      coord.openRun({ program: 'prog-a', title: 'w', project: 'project-a', wave: 1, waveOf: 2, claimedBy: 'coord-a', homeProject: 'project-a' });
    }));
    const closing = send('/api/programmes/prog-a/plan/close', { outcome: 'done' });
    await new Promise((r) => setTimeout(r, 30));
    expect(plan.planEndOf('prog-a')).toBeNull();
    release();
    await held;
    const res = await closing;
    expect([res.statusCode, errorOf(res)]).toEqual([409, 'plan-runs-open']);
    expect(plan.planEndOf('prog-a')).toBeNull();
  });

  it('close records the end and the why', async () => {
    await put(FIRST);
    const res = await send('/api/programmes/prog-a/plan/close', { outcome: 'abandoned', why: 'superseded' });
    expect(res.statusCode).toBe(200);
    expect(plan.planEndOf('prog-a')).toMatchObject({ outcome: 'abandoned', why: 'superseded' });
    expect(errorOf(await send('/api/programmes/prog-a/plan/close', { outcome: 'done' }))).toBe('plan-closed');
  });
});

describe('plan met', () => {
  it('met with evidence {pr: 12} marks the checkpoint', async () => {
    await put(FIRST);
    const res = await send('/api/programmes/prog-a/plan/met', { checkpoint: 'e1-c1', evidence: { pr: 12 } });
    expect(res.statusCode).toBe(200);
    const cp = view(res).epics[0]!.checkpoints[0]!;
    expect([cp.state, cp.evidence]).toEqual(['met', { pr: 12 }]);
  });

  it('plan met on the last checkpoint after the last ticket is done closes the epic', async () => {
    await put({ home: 'project-a', epics: [epic('e1', [1], { tickets: [{ key: 't1', kind: 'work', title: 't', checkpoint: 'e1-c1' }] })] });
    const id = plan.planOf('prog-a').epics[0]!.tickets[0]!.id;
    plan.updateTicket(id, { state: 'done' }, 5);
    expect(view(await send('/api/programmes/prog-a/plan/met', { checkpoint: 'e1-c1', evidence: { path: 'docs/x.md' } })).epics[0]!.state).toBe('done');
  });

  it('an unknown checkpoint is 404 and evidence of two kinds is plan-bad-body', async () => {
    await put(FIRST);
    expect(errorOf(await send('/api/programmes/prog-a/plan/met', { checkpoint: 'nope', evidence: { pr: 1 } }))).toBe('unknown-checkpoint');
    expect(errorOf(await send('/api/programmes/prog-a/plan/met', { checkpoint: 'e1-c1', evidence: { pr: 1, itemId: 2 } }))).toBe('plan-bad-body');
  });
});

describe('plan tickets and epics', () => {
  it('a ticket-add by the coordinator joins the epic', async () => {
    await put(FIRST);
    const res = await send('/api/programmes/prog-a/plan/tickets', { epic: 'e1', key: 't1', kind: 'task', title: 'Do it', checkpoint: 'e1-c1' });
    expect(res.statusCode).toBe(200);
    expect(view(res).epics[0]!.tickets.map((t) => [t.key, t.state, t.checkpoint, t.source])).toEqual([['t1', 'open', 'e1-c1', 'plan']]);
  });

  it('ticket-add by a worker into another epic is not-plan-owner; a follow-up into its own epic is filed', async () => {
    await put(FIRST);
    const e1 = plan.planOf('prog-a').epics[0]!.id;
    runs['worker-1'] = { program: 'prog-a', epicId: e1 };
    const other = await send('/api/programmes/prog-a/plan/tickets', { epic: 'e2', key: 'f1', kind: 'follow-up', title: 'later' }, 'worker-1');
    expect([other.statusCode, errorOf(other)]).toEqual([403, 'not-plan-owner']);
    const notFollowUp = await send('/api/programmes/prog-a/plan/tickets', { epic: 'e1', key: 'f1', kind: 'work', title: 'later' }, 'worker-1');
    expect(errorOf(notFollowUp)).toBe('not-plan-owner');
    const own = await send('/api/programmes/prog-a/plan/tickets', { epic: 'e1', key: 'f1', kind: 'follow-up', title: 'later' }, 'worker-1');
    expect(own.statusCode).toBe(200);
    expect(view(own).epics[0]!.tickets[0]).toMatchObject({ key: 'f1', source: 'worker' });
  });

  it('ticket-move moves an open ticket to another epic, and with drop and no why is dropped-needs-reason', async () => {
    await put({ home: 'project-a', epics: [epic('e1', [1], { tickets: [{ key: 't1', kind: 'work', title: 't' }] }), epic('e2', [2])] });
    const none = await send('/api/programmes/prog-a/plan/tickets/move', { ticket: 't1', drop: {} });
    expect([none.statusCode, errorOf(none)]).toEqual([400, 'dropped-needs-reason']);
    const moved = await send('/api/programmes/prog-a/plan/tickets/move', { ticket: 't1', epic: 'e2' });
    expect(view(moved).epics.map((e) => e.tickets.length)).toEqual([0, 1]);
    const dropped = await send('/api/programmes/prog-a/plan/tickets/move', { ticket: 't1', drop: { why: 'not needed' } });
    expect(view(dropped).epics[1]!.tickets[0]!.state).toBe('dropped');
    expect(errorOf(await send('/api/programmes/prog-a/plan/tickets/move', { ticket: 'zz', epic: 'e1' }))).toBe('unknown-ticket');
  });

  it('epic-drop needs a why, drops the epic with its open checkpoints and tickets', async () => {
    await put({ home: 'project-a', epics: [epic('e1', [1], { tickets: [{ key: 't1', kind: 'work', title: 't' }] }), epic('e2', [2])] });
    expect(errorOf(await send('/api/programmes/prog-a/plan/epics/drop', { epic: 'e1' }))).toBe('dropped-needs-reason');
    const res = await send('/api/programmes/prog-a/plan/epics/drop', { epic: 'e1', why: 'out of scope' });
    const e1 = view(res).epics[0]!;
    expect([e1.state, e1.checkpoints[0]!.state, e1.tickets[0]!.state]).toEqual(['dropped', 'dropped', 'dropped']);
    expect(errorOf(await send('/api/programmes/prog-a/plan/epics/drop', { epic: 'nope', why: 'x' }))).toBe('unknown-epic');
  });

  it('text that leaves for Linear is masked where it is stored', async () => {
    const secret = `sk-${'a'.repeat(40)}`;
    await put({ home: 'project-a', epics: [epic('e1', [1], { title: `has ${secret}` })] });
    expect(plan.planOf('prog-a').epics[0]!.title).not.toContain(secret);
  });
});

describe('plan verbs judge a ticket by its own project', () => {
  const T = 'KEY-9 leak';
  const modes = () => {
    setLinking(coord.db, 'project-a', { teamKey: 'KEY', override: 'private' }, 'x', 1);
    setLinking(coord.db, 'project-b', { teamKey: 'KEY', override: 'public' }, 'x', 1);
  };
  const withTicket = (over: Record<string, unknown>) => ({ home: 'project-a', epics: [epic('e1', [1], { tickets: [{ key: 't1', kind: 'work', title: 'clean', ...over }] })] });

  it('a put that leaves project out on an existing public-project ticket still judges the text by that project', async () => {
    modes();
    expect((await put(withTicket({ project: 'project-b' }))).statusCode).toBe(200);
    const res = await put(withTicket({ title: T }));
    expect([res.statusCode, errorOf(res)]).toEqual([409, 'linear-text-public']);
    expect(plan.planOf('prog-a').epics[0]!.tickets[0]!.title).toBe('clean');
  });

  it('ticket-move to a public project re-judges the stored title and body', async () => {
    modes();
    expect((await put(withTicket({ title: T }))).statusCode).toBe(200);
    const res = await send('/api/programmes/prog-a/plan/tickets/move', { ticket: 't1', project: 'project-b' });
    expect([res.statusCode, errorOf(res)]).toEqual([409, 'linear-text-public']);
    expect(plan.planOf('prog-a').epics[0]!.tickets[0]!.project).toBe('project-a');
  });

  it('close on a programme with no home judges the why by the plan\'s projects', async () => {
    modes();
    await put(withTicket({ project: 'project-b' }));
    coord.db.prepare('UPDATE programs SET homeProject = NULL WHERE slug = ?').run('prog-a');
    const res = await send('/api/programmes/prog-a/plan/close', { outcome: 'done', why: T });
    expect([res.statusCode, errorOf(res)]).toEqual([409, 'linear-text-public']);
  });
});

describe('plan show', () => {
  it('answers a cookie and a token alike, 401 for neither, and is a masked route', async () => {
    authEnabled = true;
    await app.close();
    app = await build();
    await put(FIRST);
    const url = '/api/programmes/prog-a/plan';
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url, headers: { 'x-ccrc-mail-token': TOKEN } })).statusCode).toBe(200);
    session = { allow: true, verdict: 'ok', reason: 'session', device: 'dev' };
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(view(res).epics).toHaveLength(2);
    expect(answerMasked('GET', '/api/programmes/:slug/plan')).toBe(true);
  });

  it('an unplanned programme answers planned false', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/programmes/prog-z/plan' });
    expect(view(res)).toMatchObject({ program: 'prog-z', planned: false, epics: [] });
  });
});
