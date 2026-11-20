// Flows wave 1 (spec 2026-11-19 §7, §8): the store and the operator's doors, end to end through `buildServer`. Fixture
// homes only.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { skeletonFlowDoc, type FlowAnswer, type FlowDoc, type FlowsListAnswer } from '../../shared/flows.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const open = async (authEnabled = false): Promise<{ app: FastifyInstance; coord: CoordStore }> => {
  const home = mkTmp('ccrc-flows-');
  const base = testDeps(home);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled }, coord };
  const app = await buildServer(deps);
  await app.ready();
  return { app, coord };
};

const create = async (app: FastifyInstance, payload: object): Promise<number> => {
  const res = await app.inject({ method: 'POST', url: '/api/flows', payload });
  expect(res.statusCode).toBe(200);
  return (res.json() as { id: number }).id;
};
const read = async (app: FastifyInstance, id: number): Promise<FlowAnswer> =>
  (await app.inject({ method: 'GET', url: `/api/flows/${id}` })).json() as FlowAnswer;

describe('the Flows doors', () => {
  it('lists the shipped templates and no flow on a new database', async () => {
    const { app } = await open();
    const res = await app.inject({ method: 'GET', url: '/api/flows' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as FlowsListAnswer;
    expect(body.flows).toEqual([]);
    expect(body.templates.map((t) => `${t.id}@${t.version}`)).toContain('ccrc@1');
    await app.close();
  });

  it('copies a template, and the fresh copy publishes as version 1, then 2', async () => {
    const { app } = await open();
    const id = await create(app, { template: 'ccrc' });
    const got = await read(app, id);
    expect(got.flow.source).toEqual({ template: 'ccrc', version: 1 });
    expect(got.flow.title).toBe('ccrc (my copy)');
    expect(got.draft.ok).toBe(true);
    expect(got.problems).toEqual([]);
    const p1 = await app.inject({ method: 'POST', url: `/api/flows/${id}/publish` });
    expect(p1.json()).toEqual({ ok: true, version: 1 });
    const p2 = await app.inject({ method: 'POST', url: `/api/flows/${id}/publish` });
    expect(p2.json()).toEqual({ ok: true, version: 2 });
    expect((await read(app, id)).versions.map((v) => v.version)).toEqual([1, 2]);
    const v1 = await app.inject({ method: 'GET', url: `/api/flows/${id}/versions/1` });
    expect((v1.json() as { doc: { ok: boolean } }).doc.ok).toBe(true);
    await app.close();
  });

  it('saves a draft that breaks the rules, answers its problems, and refuses to publish it', async () => {
    const { app } = await open();
    const id = await create(app, { title: 'Mine' });
    const doc = (await read(app, id)).draft as { ok: true; doc: FlowDoc };
    const broken: FlowDoc = { ...doc.doc, edges: doc.doc.edges.slice(1) };
    const put = await app.inject({ method: 'PUT', url: `/api/flows/${id}/draft`, payload: { doc: broken } });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { problems: unknown[] }).problems.length).toBeGreaterThan(0);
    const pub = await app.inject({ method: 'POST', url: `/api/flows/${id}/publish` });
    expect(pub.statusCode).toBe(409);
    expect(pub.json()).toMatchObject({ ok: false, error: 'conflict' });
    expect((pub.json() as { problems: unknown[] }).problems.length).toBeGreaterThan(0);
    expect((await read(app, id)).versions).toEqual([]);
    await app.close();
  });

  it('refuses a draft of the wrong shape and keeps the old one', async () => {
    const { app } = await open();
    const id = await create(app, {});
    const before = await read(app, id);
    const put = await app.inject({ method: 'PUT', url: `/api/flows/${id}/draft`, payload: { doc: { schema: 1, title: 'x' } } });
    expect(put.statusCode).toBe(400);
    expect((await read(app, id)).draft).toEqual(before.draft);
    await app.close();
  });

  it('answers a stored draft it cannot read as unreadable, never as absent', async () => {
    const { app, coord } = await open();
    const id = await create(app, {});
    coord.db.prepare('UPDATE flows SET draft = ? WHERE id = ?').run('{"schema": 9}', id);
    const got = await read(app, id);
    expect(got.draft).toEqual({ ok: false, reason: 'unknown schema 9' });
    expect(got.problems).toEqual([]);
    const pub = await app.inject({ method: 'POST', url: `/api/flows/${id}/publish` });
    expect(pub.statusCode).toBe(409);
    await app.close();
  });

  it('a published version is never rewritten by a later draft', async () => {
    const { app } = await open();
    const id = await create(app, { template: 'ccrc' });
    await app.inject({ method: 'POST', url: `/api/flows/${id}/publish` });
    const before = (await app.inject({ method: 'GET', url: `/api/flows/${id}/versions/1` })).json();
    const draft = ((await read(app, id)).draft as { ok: true; doc: FlowDoc }).doc;
    await app.inject({ method: 'PUT', url: `/api/flows/${id}/draft`, payload: { doc: { ...draft, title: 'Renamed' } } });
    expect((await app.inject({ method: 'GET', url: `/api/flows/${id}/versions/1` })).json()).toEqual(before);
    expect((await read(app, id)).flow.title).toBe('Renamed');
    await app.close();
  });

  it('refuses what it does not know', async () => {
    const { app } = await open();
    expect((await app.inject({ method: 'GET', url: '/api/flows/99' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/flows/abc' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/flows', payload: { template: 'nope' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/flows', payload: { title: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/flows/99' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/flows/99/publish' })).statusCode).toBe(404);
    await app.close();
  });

  it('deletes a flow with its versions', async () => {
    const { app } = await open();
    const id = await create(app, { template: 'ccrc' });
    await app.inject({ method: 'POST', url: `/api/flows/${id}/publish` });
    expect((await app.inject({ method: 'DELETE', url: `/api/flows/${id}` })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: `/api/flows/${id}/versions/1` })).statusCode).toBe(404);
    await app.close();
  });

  it('imports a file into a new flow\'s draft, never a version, and refuses one that breaks the rules', async () => {
    const { app } = await open();
    const doc = skeletonFlowDoc('Shared');
    const id = await create(app, { import: { ...doc, exportedFrom: { title: 'Shared', version: 2 } } });
    const got = await read(app, id);
    expect(got.draft).toEqual({ ok: true, doc });
    expect(got.versions).toEqual([]);
    expect(got.flow.source).toBeNull();
    const broken = { ...doc, edges: doc.edges.filter((e) => e.from !== 'verify') };
    const res = await app.inject({ method: 'POST', url: '/api/flows', payload: { import: broken } });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { problems: unknown[] }).problems.length).toBeGreaterThan(0);
    const bad = await app.inject({ method: 'POST', url: '/api/flows', payload: { import: { ...doc, schema: 9 } } });
    expect(bad.statusCode).toBe(400);
    const both = await app.inject({ method: 'POST', url: '/api/flows', payload: { import: doc, template: 'ccrc' } });
    expect(both.statusCode).toBe(400);
    await app.close();
  });

  it('is session-gated when the gate is armed', async () => {
    const { app } = await open(true);
    for (const [method, url] of [['GET', '/api/flows'], ['POST', '/api/flows'], ['PUT', '/api/flows/1/draft']] as const) {
      expect((await app.inject({ method, url, payload: method === 'GET' ? undefined : {} })).statusCode).toBe(401);
    }
    await app.close();
  });
});
