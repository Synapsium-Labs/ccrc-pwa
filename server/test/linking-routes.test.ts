// D-8147: `POST /api/projects/:project/linking` and the `linking` cell on `GET /api/projects`.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine } from '../src/auth/secret.js';
import { DEFAULT_TEST_ROSTER, seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { ID_GATE_TOKEN, seedRow } from './idGateFixture.js';

let home: string;
let projectsRoot: string;
let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;

const dead: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });

const open = async (over: Partial<Deps> = {}, authEnabled = false): Promise<FastifyInstance> => {
  const cfg = { ...loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot }), authEnabled };
  const a = await buildServer({
    cfg, runCcd: ccdRunner(dead, cfg), tmux: new Tmux(dead), io: localIO, queue: new KeyedQueue(), ...over,
  } as Deps);
  await a.ready();
  return a;
};

const post = (a: FastifyInstance, project: string, body: unknown) =>
  a.inject({ method: 'POST', url: `/api/projects/${project}/linking`, payload: body as never });

beforeEach(() => {
  home = mkTmp('ccrc-linking-routes-');
  projectsRoot = path.join(home, 'projects');
  mkdirSync(path.join(projectsRoot, 'project-a'), { recursive: true });
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  seedRoster(home, DEFAULT_TEST_ROSTER);
  coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  coord?.db.close();
  coord = undefined;
  rmSync(home, { recursive: true, force: true });
});

describe('POST /api/projects/:project/linking', () => {
  it('stores the key and answers the stored row (measured, not echoed)', async () => {
    app = await open({ coord });
    const res = await post(app, 'project-a', { teamKey: 'key', override: 'private' });
    expect(res.statusCode).toBe(200);
    // Lower case in, upper case stored and answered: the answer is the row read back.
    expect(res.json()).toEqual({
      ok: true, linking: { teamKey: 'KEY', override: 'private', measured: { state: 'unmeasured' }, mode: 'private' },
    });
    expect(coord!.linkingOf('project-a').teamKey).toBe('KEY');
  });

  it('with teamKey null clears it', async () => {
    app = await open({ coord });
    await post(app, 'project-a', { teamKey: 'KEY', override: null });
    const res = await post(app, 'project-a', { teamKey: null, override: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().linking).toMatchObject({ teamKey: null, override: null, mode: 'unknown' });
  });

  it('refuses bad-team-key and bad-override with 400 and writes nothing', async () => {
    app = await open({ coord });
    for (const key of ['', '1K', 'TOO_LONG_KEY_NAME_X', 'KE Y', 'KEY-1', 7]) {
      const res = await post(app, 'project-a', { teamKey: key, override: null });
      expect(res.statusCode, String(key)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-team-key' });
    }
    for (const o of ['internal', 'PRIVATE', 1, true]) {
      const res = await post(app, 'project-a', { teamKey: 'KEY', override: o });
      expect(res.statusCode, String(o)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-override' });
    }
    for (const body of [{}, { teamKey: 'KEY' }, { teamKey: 'KEY', override: null, extra: 1 }, [], null]) {
      const res = await post(app, 'project-a', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect(coord!.linkingAll().size).toBe(0);
  });

  it('answers unavailable (503) on a server with no coordination store', async () => {
    app = await open({});
    const res = await post(app, 'project-a', { teamKey: 'KEY', override: null });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'unavailable' });
  });

  it('is session-gated when armed and open dark', async () => {
    const line = `${await hashLine('open sesame', { n: 1024, r: 8, p: 1, keylen: 32 }, 1)}\n`;
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), line, { mode: 0o600 });
    const armed = await open({ coord }, true);
    try {
      const res = await post(armed, 'project-a', { teamKey: 'KEY', override: null });
      expect(res.statusCode).toBe(401);
      expect(coord!.linkingAll().size).toBe(0);
    } finally { await armed.close(); }
    app = await open({ coord }, false);
    expect((await post(app, 'project-a', { teamKey: 'KEY', override: null })).statusCode).toBe(200);
  });
});

describe('GET /api/projects carries a linking cell', () => {
  it('per project from one read: a stored row and an unset one', async () => {
    mkdirSync(path.join(projectsRoot, 'project-b'), { recursive: true });
    coord!.setLinking('project-a', { teamKey: 'KEY', override: 'public' }, 'device-1', 1);
    app = await open({ coord });
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    const byName = Object.fromEntries((res.json().projects as { name: string; linking?: unknown }[]).map((p) => [p.name, p.linking]));
    expect(byName['project-a']).toEqual({ teamKey: 'KEY', override: 'public', measured: { state: 'unmeasured' }, mode: 'public' });
    expect(byName['project-b']).toEqual({ teamKey: null, override: null, measured: { state: 'unmeasured' }, mode: 'unknown' });
  });

  it('leaves the key off the wire when there is no coordination store (an older server\'s shape)', async () => {
    app = await open({});
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    for (const p of res.json().projects as object[]) expect(p).not.toHaveProperty('linking');
  });
});

describe('GET /api/linking: a session reads its own project\'s row', () => {
  const get = (a: FastifyInstance, q: string, token: string | null = ID_GATE_TOKEN) =>
    a.inject({ method: 'GET', url: `/api/linking${q}`, headers: token === null ? {} : { 'x-ccrc-mail-token': token } });
  const me = '?byId=project-a-calm-mesa&byUuid=u-project-a-calm-mesa';

  it('answers the caller\'s own project\'s row, found through its registry record', async () => {
    seedRow(home, 'project-a-calm-mesa', { project: 'project-a' });
    coord!.setLinking('project-a', { teamKey: 'KEY', override: 'private' }, 'device-1', 1);
    app = await open({ coord, mailToken: ID_GATE_TOKEN });
    const res = await get(app, me);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      ok: true, project: 'project-a', teamKey: 'KEY', override: 'private', measured: { state: 'unmeasured' }, mode: 'private',
    });
  });

  it('refuses a missing or wrong box token', async () => {
    seedRow(home, 'project-a-calm-mesa', { project: 'project-a' });
    app = await open({ coord, mailToken: ID_GATE_TOKEN });
    for (const t of [null, 'e'.repeat(64)]) {
      const res = await get(app, me, t);
      expect([res.statusCode, res.json().error]).toEqual([401, 'unauthenticated']);
    }
  });

  it('refuses an attribution the registry does not hold', async () => {
    seedRow(home, 'project-a-calm-mesa', { project: 'project-a' });
    app = await open({ coord, mailToken: ID_GATE_TOKEN });
    const unknown = await get(app, '?byId=project-a-no-such&byUuid=u-x');
    expect([unknown.statusCode, unknown.json().error]).toEqual([403, 'unknown-sender']);
    const stale = await get(app, '?byId=project-a-calm-mesa&byUuid=u-other');
    expect([stale.statusCode, stale.json().error]).toEqual([403, 'stale-uuid']);
    const bad = await get(app, '');
    expect([bad.statusCode, bad.json().error]).toEqual([400, 'bad-request']);
  });

  it('reads unknown mode for a project never measured, and answers no-project when the record names none', async () => {
    seedRow(home, 'project-a-calm-mesa', { project: 'project-a' });
    app = await open({ coord, mailToken: ID_GATE_TOKEN });
    const res = await get(app, me);
    expect(res.json()).toEqual({
      ok: true, project: 'project-a', teamKey: null, override: null, measured: { state: 'unmeasured' }, mode: 'unknown',
    });
    await app.close();
    seedRow(home, 'bare-session', { project: '' });
    app = await open({ coord, mailToken: ID_GATE_TOKEN });
    const none = await get(app, '?byId=bare-session&byUuid=u-bare-session');
    expect([none.statusCode, none.json().error]).toEqual([404, 'no-project']);
  });
});
