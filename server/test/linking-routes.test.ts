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
import { putLinearSlot, readLinearStore } from '../src/linear/store.js';
import { VisibilityLane } from '../src/linking/visibilityLane.js';
import { keyTailOf } from '../src/linear/connection.js';
import { valueDigestHex } from '../src/token/files.js';
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
        teamLink: { source: 'manual', at: expect.any(Number) }, teamCandidates: [], teamWorkspace: null,
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
      teamLink: { source: 'manual', at: 1 }, teamCandidates: [], teamWorkspace: null,
    });
    expect(byName['project-b']).toEqual({
      teamKey: null, override: null, measured: { state: 'unmeasured' }, mode: 'unknown', initiatives: 'on', linearOwner: null, ownsTeam: false,
      teamLink: null, teamCandidates: [], teamWorkspace: null,
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
      teamLink: { source: 'manual', at: 1 }, teamCandidates: [], teamWorkspace: null,
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
      teamLink: null, teamCandidates: [], teamWorkspace: null,
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

// Linear hierarchy wave 8, D-8808: the write may name the workspace the key lives in.
describe('POST /api/projects/:project/linking: the workspace', () => {
  const WS_A = '00000000-0000-4000-8000-0000000000a1';
  const WS_B = '00000000-0000-4000-8000-0000000000b2';
  /** Two connected workspaces: both have team AAA, only ws-b has BBB. Keys are built at run time (fixtures, not keys). */
  const seedWorkspaces = async (): Promise<void> => {
    for (const [id, urlKey, keys, fill] of [[WS_A, 'ws-a', ['AAA'], 'a'], [WS_B, 'ws-b', ['AAA', 'BBB'], 'b']] as const) {
      const key = `lin_api_${fill.repeat(40)}`;
      await putLinearSlot(path.join(home, '.ccrc'), key, {
        workspaceId: id, name: `Workspace ${urlKey}`, urlKey, user: 'User A',
        teams: keys.map((k, i) => ({ id: `00000000-0000-4000-8000-${String(fill.charCodeAt(0) * 10 + i).padStart(12, '0')}`, key: k, name: `Team ${k}` })),
        teamsAt: 1, keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: 1, outcome: 'ok',
      }, { replace: true });
    }
  };

  it('a held pair is stored together and answered', async () => {
    await seedWorkspaces();
    app = await open({ coord });
    const res = await post(app, 'project-a', { teamKey: 'AAA', override: null, workspace: WS_B });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().linking).toMatchObject({ teamKey: 'AAA', teamWorkspace: WS_B });
  });

  it('a write naming a pair no workspace has is refused team-unknown and writes nothing', async () => {
    await seedWorkspaces();
    app = await open({ coord });
    const res = await post(app, 'project-a', { teamKey: 'BBB', override: null, workspace: WS_A });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'team-unknown' });
    expect(coord!.linkingOf('project-a')).toMatchObject({ teamKey: null, teamWorkspace: null });
  });

  it('a named workspace with an unreadable Linear store is unavailable (503), not team-unknown', async () => {
    app = await open({ coord }, false);
    const store = path.join(home, '.ccrc', 'linear');
    rmSync(store, { recursive: true, force: true });
    writeFileSync(store, 'not a directory');
    const res = await post(app, 'project-a', { teamKey: 'AAA', override: null, workspace: WS_A });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'unavailable' });
    expect(coord!.linkingOf('project-a').teamKey).toBeNull();
  });

  it('a key change clears a workspace that does not hold the new key, and keeps one that does', async () => {
    await seedWorkspaces();
    app = await open({ coord });
    await post(app, 'project-a', { teamKey: 'AAA', override: null, workspace: WS_B });
    const kept = await post(app, 'project-a', { teamKey: 'BBB', override: null });
    expect(kept.json().linking).toMatchObject({ teamKey: 'BBB', teamWorkspace: WS_B });
    await post(app, 'project-a', { teamKey: 'AAA', override: null, workspace: WS_A });
    const cleared = await post(app, 'project-a', { teamKey: 'BBB', override: null });
    expect(cleared.json().linking).toMatchObject({ teamKey: 'BBB', teamWorkspace: null });
  });

  it('a write with no workspace and the key unchanged keeps the stored workspace', async () => {
    await seedWorkspaces();
    app = await open({ coord });
    await post(app, 'project-a', { teamKey: 'AAA', override: null, workspace: WS_A });
    const res = await post(app, 'project-a', { teamKey: 'AAA', override: 'private' });
    expect(res.json().linking).toMatchObject({ override: 'private', teamWorkspace: WS_A });
  });
});

// Linear hierarchy wave 8, D-8808 (Task 8.4): a coordinator's suggestion of a team for a project with no key.
describe('POST /api/linking/suggest', () => {
  const WS_A = '00000000-0000-4000-8000-0000000000a1';
  const WS_B = '00000000-0000-4000-8000-0000000000b2';
  const ME = { byId: 'project-a-calm-mesa', byUuid: 'u-project-a-calm-mesa' };
  const OTHER = { byId: 'project-a-quiet-fern', byUuid: 'u-project-a-quiet-fern' };
  const seedWorkspaces = async (): Promise<void> => {
    for (const [id, urlKey, keys, fill] of [[WS_A, 'ws-a', ['AAA'], 'a'], [WS_B, 'ws-b', ['AAA', 'BBB'], 'b']] as const) {
      const key = `lin_api_${fill.repeat(40)}`;
      await putLinearSlot(path.join(home, '.ccrc'), key, {
        workspaceId: id, name: `Workspace ${urlKey}`, urlKey, user: 'User A',
        teams: keys.map((k, i) => ({ id: `00000000-0000-4000-8000-${String(fill.charCodeAt(0) * 10 + i).padStart(12, '0')}`, key: k, name: `Team ${k}` })),
        teamsAt: 1, keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: 1, outcome: 'ok',
      }, { replace: true });
    }
  };
  const suggest = (a: FastifyInstance, body: Record<string, unknown>, token: string | null = ID_GATE_TOKEN) =>
    a.inject({ method: 'POST', url: '/api/linking/suggest', payload: body as never, headers: token === null ? {} : { 'x-ccrc-mail-token': token } });
  const ok = (over: Record<string, unknown> = {}): Record<string, unknown> =>
    ({ ...ME, project: 'project-a', team: 'BBB', workspace: WS_B, why: 'the branches name this team', ...over });
  const boot = async (): Promise<FastifyInstance> => {
    seedRow(home, ME.byId, { project: 'project-a' });
    seedRow(home, OTHER.byId, { project: 'project-a' });
    await seedWorkspaces();
    // Every listed project has a row from the visibility lane's reading; the door writes to an existing row only.
    coord!.recordLinkingReading('project-a', { state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'present', at: 1 });
    return open({ coord, mailToken: ID_GATE_TOKEN });
  };

  it('a suggestion is a candidate and never links', async () => {
    app = await boot();
    const res = await suggest(app, ok());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().ok).toBe(true);
    const row = coord!.linkingOf('project-a');
    expect(row.teamKey).toBeNull();
    expect(row.teamLink).toBeNull();
    expect(row.teamCandidates).toEqual([{
      key: 'BBB', name: 'Team BBB', evidence: { kind: 'suggested', by: ME.byId, why: 'the branches name this team' },
      workspaceId: WS_B, workspaceName: 'Workspace ws-b',
    }]);
    expect(res.json().linking).toEqual(row);
    // The real team-link pass over this project, with no decisive evidence, leaves the key null and the suggestion in place.
    const store = await readLinearStore(path.join(home, '.ccrc'));
    const lane = new VisibilityLane(() => ({ coord: coord!, runCcd: async () => { throw new Error('no ccd'); }, fleetState: undefined, cfg: { ccrcDir: path.join(home, '.ccrc') } }), async () => store);
    await lane.linkTeams(['project-a'], 1000, { tally: () => new Map(), slug: () => null });
    const after = coord!.linkingOf('project-a');
    expect(after.teamKey).toBeNull();
    expect(after.teamLink).toBeNull();
    expect(after.teamCandidates!.map((c) => c.evidence.kind)).toContain('suggested');
  });

  it('a resend replaces it, and two sessions\' suggestions both show', async () => {
    app = await boot();
    await suggest(app, ok());
    await suggest(app, ok({ why: 'second thoughts', team: 'AAA', workspace: WS_A }));
    await suggest(app, ok({ ...OTHER, why: 'another view' }));
    const c = coord!.linkingOf('project-a').teamCandidates;
    expect(c!.map((x) => [x.key, x.evidence])).toEqual([
      ['AAA', { kind: 'suggested', by: ME.byId, why: 'second thoughts' }],
      ['BBB', { kind: 'suggested', by: OTHER.byId, why: 'another view' }],
    ]);
  });

  it('without a workspace the key must be held by some workspace, and none is recorded', async () => {
    app = await boot();
    const res = await suggest(app, (() => { const b = ok({ team: 'bbb' }); delete b['workspace']; return b; })());
    expect(res.statusCode, res.body).toBe(200);
    const c = coord!.linkingOf('project-a').teamCandidates;
    expect(c).toEqual([{ key: 'BBB', name: 'Team BBB', evidence: { kind: 'suggested', by: ME.byId, why: 'the branches name this team' } }]);
  });

  it('a project with a key refuses it team-set and writes nothing', async () => {
    app = await boot();
    coord!.setLinking('project-a', { teamKey: 'AAA', override: null }, 'd', 1);
    const res = await suggest(app, ok());
    expect([res.statusCode, res.json().error]).toEqual([409, 'team-set']);
    expect(coord!.linkingOf('project-a').teamCandidates).toEqual([]);
  });

  it('a pair no workspace has is team-unknown and writes nothing', async () => {
    app = await boot();
    for (const b of [ok({ team: 'BBB', workspace: WS_A }), ok({ team: 'ZZZ', workspace: WS_B })]) {
      const res = await suggest(app, b);
      expect([res.statusCode, res.json().error]).toEqual([404, 'team-unknown']);
    }
    const none = ok({ team: 'ZZZ' }); delete none['workspace'];
    expect((await suggest(app, none)).json().error).toBe('team-unknown');
    expect(coord!.linkingOf('project-a').teamCandidates).toEqual([]);
  });

  it('an unreadable Linear store is unavailable (503), never team-unknown', async () => {
    seedRow(home, ME.byId, { project: 'project-a' });
    app = await open({ coord, mailToken: ID_GATE_TOKEN });
    const store = path.join(home, '.ccrc', 'linear');
    rmSync(store, { recursive: true, force: true });
    writeFileSync(store, 'not a directory');
    const res = await suggest(app, ok());
    expect([res.statusCode, res.json().error]).toEqual([503, 'unavailable']);
    const none = ok(); delete none['workspace'];
    expect((await suggest(app, none)).json().error).toBe('unavailable');
    expect(coord!.linkingOf('project-a').teamCandidates).toEqual([]);
  });

  it('a reason with a tracker id of the team or a private-name class is refused linear-text-public, and the text is never echoed', async () => {
    app = await boot();
    const ticket = await suggest(app, ok({ why: 'see BBB-12 for the history' }));
    expect([ticket.statusCode, ticket.json().error]).toEqual([409, 'linear-text-public']);
    expect(ticket.body).not.toContain('BBB-12');
    const host = await suggest(app, ok({ why: `the box is reachable at ${['100', '64', '1', '2'].join('.')}` }));
    expect([host.statusCode, host.json().error]).toEqual([409, 'linear-text-public']);
    expect(coord!.linkingOf('project-a').teamCandidates).toEqual([]);
  });

  it('a reason naming another connected team\'s ticket id is refused and writes nothing', async () => {
    app = await boot();
    const res = await suggest(app, ok({ why: 'see AAA-12 for the history' }));
    expect([res.statusCode, res.json().error]).toEqual([409, 'linear-text-public']);
    expect(res.body).not.toContain('AAA-12');
    expect(coord!.linkingOf('project-a').teamCandidates).toEqual([]);
  });

  it('an unknown project writes no row and answers no-project', async () => {
    seedRow(home, ME.byId, { project: 'project-typo' });
    await seedWorkspaces();
    app = await open({ coord, mailToken: ID_GATE_TOKEN });
    const res = await suggest(app, ok({ project: 'project-typo' }));
    expect([res.statusCode, res.json().error]).toEqual([404, 'no-project']);
    expect(coord!.linkingAll().size).toBe(0);
  });

  it('refuses a missing or wrong token, a bad pair, and a bad body naming the field', async () => {
    app = await boot();
    for (const t of [null, 'e'.repeat(64)]) {
      const res = await suggest(app, ok(), t);
      expect([res.statusCode, res.json().error]).toEqual([401, 'unauthenticated']);
    }
    const stale = await suggest(app, ok({ byUuid: 'u-other' }));
    expect([stale.statusCode, stale.json().error]).toEqual([403, 'stale-uuid']);
    const unknown = await suggest(app, ok({ byId: 'project-a-no-such' }));
    expect([unknown.statusCode, unknown.json().error]).toEqual([403, 'unknown-sender']);
    const cases: Array<[Record<string, unknown>, string]> = [
      [ok({ project: 'bad/name' }), 'project'], [ok({ team: 'not a key' }), 'team'], [ok({ workspace: 'ws-a' }), 'workspace'],
      [ok({ why: '' }), 'why'], [ok({ why: 'a\u2028b' }), 'why'], [ok({ why: 'a\u2029b' }), 'why'], [ok({ why: 'a\u202eb' }), 'why'], [ok({ why: 'a\u2066b' }), 'why'], [ok({ why: 'x'.repeat(281) }), 'why'], [ok({ why: 'two\nlines' }), 'why'],
      [ok({ byId: 7 }), 'byId'], [ok({ extra: 1 }), 'body'],
    ];
    for (const [b, field] of cases) {
      const res = await suggest(app, b);
      expect([res.statusCode, res.json().error, res.json().detail], field).toEqual([400, 'bad-request', field]);
    }
    expect(coord!.linkingOf('project-a').teamCandidates).toEqual([]);
  });

  it('a server with no coordination store answers unavailable', async () => {
    seedRow(home, ME.byId, { project: 'project-a' });
    app = await open({ mailToken: ID_GATE_TOKEN });
    expect((await suggest(app, ok())).statusCode).toBe(503);
  });

  it('an operator\'s key and an automatic link clear the suggestions', async () => {
    app = await boot();
    await suggest(app, ok());
    coord!.linkTeamAuto('project-a', { key: 'AAA', name: 'Team AAA', evidence: { kind: 'name-match', matched: 'project', on: 'name' } }, 2);
    expect(coord!.linkingOf('project-a').teamCandidates).toEqual([]);
    coord!.setLinking('project-a', { teamKey: null, override: null }, 'd', 3);
    await suggest(app, ok());
    expect(coord!.linkingOf('project-a').teamCandidates).toHaveLength(1);
    coord!.setLinking('project-a', { teamKey: 'AAA', override: null }, 'd', 4);
    expect(coord!.linkingOf('project-a').teamCandidates).toEqual([]);
  });
});
