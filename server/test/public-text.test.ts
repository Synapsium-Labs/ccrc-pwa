// D-8181: the public-text check. `publicTextVerdict` (linking/policy.ts, L1) over the classes in
// `linking/publicTextClasses.ts`, and the plan verbs' routes answering `linear-text-public` before anything is stored.
// The fixtures are constructed here (this file is excluded from topology-clean's walk only by the file named there, so
// nothing below is spelled as the token a class forbids).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { planStorePort, type PlanStorePort } from '../src/coord/planStore.js';
import { registerPlanRoutes, type PlanRouteOpts } from '../src/coord/planRoutes.js';
import { publicTextVerdict } from '../src/linking/policy.js';
import * as publicTextClasses from '../src/linking/publicTextClasses.js';
import { PUBLIC_TEXT_CLASSES } from '../src/linking/publicTextClasses.js';
import { CANARY } from './private-names.mjs';
import type { GateDecision } from '../src/auth/gate.js';
import { mkTmp } from './tmpHelpers.js';

const EMAIL = ['person', '@', 'acme', '.', 'pro'].join('');

describe('publicTextVerdict', () => {
  it('a public project\'s ticket title naming KEY-123 is refused with ids', () => {
    expect(publicTextVerdict('Fix login (KEY-123) and KEY-7', 'KEY', 'public'))
      .toEqual({ ok: false, word: 'linear-text-public', class: 'tracker id', ids: ['KEY-123', 'KEY-7'] });
  });

  it('an email in a public summary is refused with its class', () => {
    expect(publicTextVerdict(`ask ${EMAIL} about it`, 'KEY', 'public'))
      .toEqual({ ok: false, word: 'linear-text-public', class: 'email address' });
  });

  it('a hashed hit names its class and its h8, never the text', () => {
    const v = publicTextVerdict(`a line carrying ${CANARY} in prose`, null, 'public');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.class).toMatch(/^private name \(hashed\) #[0-9a-f]{8}$/);
    expect(JSON.stringify(v)).not.toContain(CANARY);
  });

  it('a private project passes both', () => {
    expect(publicTextVerdict('Fix login (KEY-123)', 'KEY', 'private')).toEqual({ ok: true });
    expect(publicTextVerdict(`ask ${EMAIL}`, 'KEY', 'private')).toEqual({ ok: true });
  });

  it('an unknown project is treated as public', () => {
    expect(publicTextVerdict('Fix KEY-123', 'KEY', 'unknown').ok).toBe(false);
    expect(publicTextVerdict(`ask ${EMAIL}`, null, 'unknown').ok).toBe(false);
  });

  it('plain text passes a public project', () => {
    expect(publicTextVerdict('Make the login page faster\nand quieter', 'KEY', 'public')).toEqual({ ok: true });
  });

  it('reads a phrase of the hashed class across a line break', () => {
    // the pair path is the class's own: a one-line text has none, so only a text with a break exercises it
    expect(publicTextVerdict(`before\n${CANARY}\nafter`, null, 'public').ok).toBe(false);
  });

  it('the runtime check carries no installer\'s own tracker key: a project\'s team key is the only tracker id it refuses', () => {
    // this tree's private key, assembled so the topology walk does not read it here
    const key = ['CC', 'RCP'].join('');
    expect(Object.keys(publicTextClasses)).not.toContain('PRIVATE_TRACKER_KEYS');
    expect(publicTextVerdict(`see ${key}-12`, null, 'public')).toEqual({ ok: true });
    expect(publicTextVerdict(`see ${key}-12`, key, 'public')).toMatchObject({ ok: false, class: 'tracker id' });
    // a link into a tracker's workspace is still refused, whoever's it is
    expect(publicTextVerdict(`see ${['linear.app', 'some-workspace'].join('/')}`, null, 'public')).toMatchObject({ ok: false, class: 'private tracker id' });
  });

  it('publicTextClasses.ts holds no catches list', () => {
    for (const cls of PUBLIC_TEXT_CLASSES) expect(Object.keys(cls)).not.toContain('catches');
  });
});

// ── the routes ───────────────────────────────────────────────────────────────────────────────────────────────────────

const TOKEN = 'k'.repeat(64);
let dir: string;
let coord: CoordStore;
let plan: PlanStorePort;
let app: FastifyInstance;
let lock: Promise<unknown>;
const NO: GateDecision = { allow: false, verdict: 'no-session', reason: 'refused', device: null };
const serial: PlanRouteOpts['serial'] = (fn) => { const next = lock.then(fn, fn); lock = next.catch(() => undefined); return next; };

beforeEach(async () => {
  dir = mkTmp('ccrc-public-text-');
  coord = new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
  plan = planStorePort(coord.db);
  lock = Promise.resolve();
  app = Fastify();
  registerPlanRoutes(app, {
    coord, plan, serial, mailToken: () => TOKEN, attribute: async () => ({ ok: true }),
    sessionAuth: () => NO, authEnabled: false, readLinearStore: async () => ({ kind: 'unreadable', code: 'ENOENT' }),
    runOfSession: () => null, now: () => 1_000,
  });
  await app.ready();
});
afterEach(async () => { await app.close(); coord.db.close(); rmSync(dir, { recursive: true, force: true }); });

const send = (url: string, body: unknown, who = 'coord-a') => app.inject({
  method: 'POST', url: `${url}?byId=${who}&byUuid=u-${who}`, payload: body as never, headers: { 'x-ccrc-mail-token': TOKEN },
});
const put = (body: unknown) => send('/api/programmes/prog-a/plan', body);
const errorOf = (res: { json: () => unknown }): string => (res.json() as { error?: string }).error ?? '';
const epic = (key: string, waves: number[], over: Record<string, unknown> = {}) => ({
  key, title: `Epic ${key}`, summary: 's', waves, checkpoints: [{ key: `${key}-c1`, title: 'c', kind: 'acceptance' }], ...over,
});
const setTeam = (project: string, teamKey: string | null, override: 'private' | 'public' | null) =>
  coord.setLinking(project, { teamKey, override }, 'test', 1);

describe('the plan verbs check public text', () => {
  it('plan put answers linear-text-public at once and stores nothing', async () => {
    setTeam('project-a', 'KEY', 'public');
    const res = await put({ home: 'project-a', epics: [epic('e1', [1], { summary: 'see KEY-123' })] });
    expect([res.statusCode, errorOf(res)]).toEqual([409, 'linear-text-public']);
    expect(plan.planOf('prog-a').epics).toEqual([]);
    expect(coord.programs().some((p) => p.slug === 'prog-a')).toBe(false);
  });

  it('plan put checks a checkpoint title and a ticket body too', async () => {
    setTeam('project-a', 'KEY', 'public');
    const cp = await put({ home: 'project-a', epics: [epic('e1', [1], { checkpoints: [{ key: 'c1', title: `mail ${EMAIL}`, kind: 'acceptance' }] })] });
    expect(errorOf(cp)).toBe('linear-text-public');
    const tk = await put({ home: 'project-a', epics: [epic('e1', [1], { tickets: [{ key: 't1', kind: 'task', title: 't', body: 'KEY-9' }] })] });
    expect(errorOf(tk)).toBe('linear-text-public');
  });

  it('a private project stores the same text', async () => {
    setTeam('project-a', 'KEY', 'private');
    const res = await put({ home: 'project-a', epics: [epic('e1', [1], { summary: 'see KEY-123' })] });
    expect(res.statusCode).toBe(200);
  });

  it('the refusal names the class, never the text', async () => {
    setTeam('project-a', 'KEY', 'public');
    const res = await put({ home: 'project-a', epics: [epic('e1', [1], { summary: `mail ${EMAIL}` })] });
    expect(res.body).toContain('email address');
    expect(res.body).not.toContain(EMAIL);
  });

  it('ticket-add, ticket-move drop, epic-drop, close and met evidence are checked too', async () => {
    setTeam('project-a', 'KEY', 'public');
    expect((await put({ home: 'project-a', epics: [epic('e1', [1])] })).statusCode).toBe(200);
    const add = await send('/api/programmes/prog-a/plan/tickets', { epic: 'e1', key: 't1', kind: 'task', title: 'Fix KEY-5' });
    expect([add.statusCode, errorOf(add)]).toEqual([409, 'linear-text-public']);
    expect((await send('/api/programmes/prog-a/plan/tickets', { epic: 'e1', key: 't1', kind: 'task', title: 'Fix it' })).statusCode).toBe(200);
    const drop = await send('/api/programmes/prog-a/plan/tickets/move', { ticket: 't1', drop: { why: 'dup of KEY-5' } });
    expect(errorOf(drop)).toBe('linear-text-public');
    expect(plan.planOf('prog-a').epics[0]!.tickets[0]!.state).toBe('open');
    const ed = await send('/api/programmes/prog-a/plan/epics/drop', { epic: 'e1', why: 'see KEY-5' });
    expect(errorOf(ed)).toBe('linear-text-public');
    expect(plan.planOf('prog-a').epics[0]!.state).not.toBe('dropped');
    const met = await send('/api/programmes/prog-a/plan/met', { checkpoint: 'e1-c1', evidence: { path: 'notes/KEY-5.md' } });
    expect(errorOf(met)).toBe('linear-text-public');
    const close = await send('/api/programmes/prog-a/plan/close', { outcome: 'done', why: 'KEY-5 shipped' });
    expect(errorOf(close)).toBe('linear-text-public');
    expect(plan.planEndOf('prog-a')).toBeNull();
  });

  it('a ticket is judged by its own project, not the epic\'s', async () => {
    setTeam('project-a', 'KEY', 'private');
    setTeam('project-b', 'KEY', 'public');
    const res = await put({ home: 'project-a', epics: [epic('e1', [1], { tickets: [{ key: 't1', kind: 'task', title: 'KEY-9', project: 'project-b' }] })] });
    expect(errorOf(res)).toBe('linear-text-public');
  });
});
