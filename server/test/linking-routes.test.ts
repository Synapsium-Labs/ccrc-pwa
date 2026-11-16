// D-8147: `POST /api/projects/:project/linking`, `POST /api/projects/:project/pr-template` and the `linking` cell on `GET /api/projects`.
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
      ok: true, linking: {
        teamKey: 'KEY', override: 'private', measured: { state: 'unmeasured' }, mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false,
        // D-8405: a key the operator typed is theirs, stamped when.
        teamLink: { source: 'manual', at: expect.any(Number) }, teamCandidates: [],
      },
    });
    expect(coord!.linkingOf('project-a').teamKey).toBe('KEY');
  });

  it('with teamKey null clears it', async () => {
    app = await open({ coord });
    await post(app, 'project-a', { teamKey: 'KEY', override: null });
    const res = await post(app, 'project-a', { teamKey: null, override: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().linking).toMatchObject({ teamKey: null, override: null, mode: 'unknown', initiatives: 'on', linearOwner: null, ownsTeam: false });
  });

  it('refuses override private while the last reading is public, and still saves a key under a stored private', async () => {
    app = await open({ coord });
    coord!.setLinking('project-a', { teamKey: 'KEY', override: null }, 'd', 1);
    coord!.recordLinkingReading('project-a', { state: 'measured', visibility: 'public', slug: 'owner/repo', template: 'absent', at: 5 });
    const res = await post(app, 'project-a', { teamKey: 'KEY', override: 'private' });
    expect([res.statusCode, res.json().error]).toEqual([409, 'override-private-public']);
    expect(coord!.linkingOf('project-a').override).toBeNull();
    expect((await post(app, 'project-a', { teamKey: 'KEY', override: 'public' })).statusCode).toBe(200);
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
    expect(byName['project-a']).toEqual({
      teamKey: 'KEY', override: 'public', measured: { state: 'unmeasured' }, mode: 'public', initiatives: 'on', linearOwner: null, ownsTeam: false,
      teamLink: { source: 'manual', at: 1 }, teamCandidates: [],
    });
    expect(byName['project-b']).toEqual({
      teamKey: null, override: null, measured: { state: 'unmeasured' }, mode: 'unknown', initiatives: 'on', linearOwner: null, ownsTeam: false,
      teamLink: null, teamCandidates: [],
    });
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
      ok: true, project: 'project-a', teamKey: 'KEY', override: 'private', measured: { state: 'unmeasured' }, mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false,
      teamLink: { source: 'manual', at: 1 }, teamCandidates: [],
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
      ok: true, project: 'project-a', teamKey: null, override: null, measured: { state: 'unmeasured' }, mode: 'unknown', initiatives: 'on', linearOwner: null, ownsTeam: false,
      teamLink: null, teamCandidates: [],
    });
    await app.close();
    seedRow(home, 'bare-session', { project: '' });
    app = await open({ coord, mailToken: ID_GATE_TOKEN });
    const none = await get(app, '?byId=bare-session&byUuid=u-bare-session');
    expect([none.statusCode, none.json().error]).toEqual([404, 'no-project']);
  });
});

describe('POST /api/projects/:project/pr-template', () => {
  const OPEN_ROW = [{ number: 9, state: 'OPEN', url: 'https://github.com/owner/repo/pull/9' }];
  const measure = (visibility: 'private' | 'public', template: 'absent' | 'present' = 'absent'): void => {
    coord!.recordLinkingReading('project-a', { state: 'measured', visibility, slug: 'owner/repo', template, at: 5 });
  };
  const tmpl = (a: FastifyInstance) => a.inject({ method: 'POST', url: '/api/projects/project-a/pr-template' });
  /** A runCcd that records its argv and answers `res`. */
  const ccd = (res: { ok: boolean; stdout?: string; stderr?: string }) => {
    const calls: string[][] = [];
    const runCcd = (async (argv: readonly string[]) => {
      calls.push([...argv]);
      return { ok: res.ok, code: res.ok ? 0 : 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
    }) as unknown as Deps['runCcd'];
    return { calls, runCcd };
  };

  it('refuses no-team-key before any ccd call; an unmeasured project goes on to ccd, which reads the visibility itself', async () => {
    const { calls, runCcd } = ccd({ ok: true });
    app = await open({ coord, runCcd });
    measure('private');
    const noKey = await tmpl(app);
    expect([noKey.statusCode, noKey.json().error]).toEqual([409, 'no-team-key']);
    coord!.setLinking('project-a', { teamKey: 'KEY', override: null }, 'd', 1);
    coord!.recordLinkingReading('project-a', { state: 'unmeasured' });
    const unmeasured = await tmpl(app);
    // ccd answers (here: a failure); the route did not stop at 'repo-unmeasured'
    expect(unmeasured.json().error).not.toBe('repo-unmeasured');
    expect(calls.length).toBe(1);
  });

  it('refuses repo-public on an override to public', async () => {
    const { calls, runCcd } = ccd({ ok: true });
    app = await open({ coord, runCcd });
    measure('private');
    coord!.setLinking('project-a', { teamKey: 'KEY', override: 'public' }, 'd', 1);
    const res = await tmpl(app);
    expect([res.statusCode, res.json().error]).toEqual([409, 'repo-public']);
    expect(calls).toEqual([]);
  });

  it('answers the PR url and records the template present', async () => {
    const { calls, runCcd } = ccd({ ok: true, stdout: `${JSON.stringify(OPEN_ROW)}\n` });
    app = await open({ coord, runCcd });
    measure('private');
    coord!.setLinking('project-a', { teamKey: 'KEY', override: null }, 'd', 1);
    const res = await tmpl(app);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, url: 'https://github.com/owner/repo/pull/9' });
    expect(calls).toEqual([['pr-template', '--project', 'project-a', '--team', 'KEY']]);
    expect(coord!.linkingOf('project-a').measured).toMatchObject({ state: 'measured', template: 'present', visibility: 'private' });
  });

  it('maps ccd\'s own refusals (repo-public, template-exists) and answers its other failures as 502', async () => {
    coord!.setLinking('project-a', { teamKey: 'KEY', override: null }, 'd', 1);
    measure('private');
    for (const reason of ['repo-public', 'template-exists']) {
      const { runCcd } = ccd({ ok: false, stdout: `{"reason":"${reason}"}\n` });
      app = await open({ coord, runCcd });
      const res = await tmpl(app);
      expect([res.statusCode, res.json().error], reason).toEqual([409, reason]);
      await app.close();
    }
    const { runCcd } = ccd({ ok: false, stderr: 'ccd: push failed' });
    app = await open({ coord, runCcd });
    const res = await tmpl(app);
    expect([res.statusCode, res.json().error]).toEqual([502, 'template-failed']);
  });

  it('answers unsupported on a ccd without the verb', async () => {
    const { calls, runCcd } = ccd({ ok: true });
    app = await open({ coord, runCcd, fleetState: { ccdVerbs: ['repo-visibility'] } as never });
    measure('private');
    coord!.setLinking('project-a', { teamKey: 'KEY', override: null }, 'd', 1);
    const res = await tmpl(app);
    expect([res.statusCode, res.json().error]).toEqual([501, 'unsupported']);
    expect(calls).toEqual([]);
  });

  it('is session-gated when armed', async () => {
    const line = `${await hashLine('open sesame', { n: 1024, r: 8, p: 1, keylen: 32 }, 1)}\n`;
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), line, { mode: 0o600 });
    const { calls, runCcd } = ccd({ ok: true });
    app = await open({ coord, runCcd }, true);
    expect((await tmpl(app)).statusCode).toBe(401);
    expect(calls).toEqual([]);
  });
});
