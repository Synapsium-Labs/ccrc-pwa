// Add a project from the console (spec 2026-11-04 §4, Server): `POST /api/projects` through the real server builder.
// Every refusal the SERVER decides is asserted with `calls` EMPTY: a refused request must never have an argv to send.
// ccd is a Runner stub that answers with its real sentences, and on success makes the directory ccd would, so the next
// `GET /api/projects` is measured against a projects root that changed. The runner crosses the agent's real whitelist
// (`testDeps`'s `guardRunner`), so the agent's grant is exercised by every success case. FIXTURE HOMES ONLY.
import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Runner } from '../src/exec.js';
import { buildServer } from '../src/server.js';
import { ProjectWalkCache } from '../src/lifecycle.js';
import { testDeps } from './helpers.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

let open: FastifyInstance | null = null;
afterEach(async () => { await open?.close(); open = null; });

const OK = { ran: true, code: 0, stdout: '', stderr: '' } as const;

interface Opts { verbs?: string[] | null; run?: (args: string[], root: string) => Awaited<ReturnType<Runner>> }
interface Booted { app: FastifyInstance; calls: string[][] }

async function boot(o: Opts = {}): Promise<Booted> {
  const home = mkTmp('ccrc-project-add-');
  const calls: string[][] = [];
  const root = path.join(home, 'projects');
  mkdirSync(path.join(root, 'project-old', '.git'), { recursive: true });
  const run = o.run ?? (() => OK);
  const deps = testDeps(home, async (_cmd, args) => {
    if (args[0] !== 'project-add') return { ran: true, code: 1, stdout: '', stderr: '' };
    calls.push([...args]);
    return run(args, root);
  });
  const verbs = o.verbs === undefined ? ['project-add', 'caps'] : o.verbs;
  const app = await buildServer({
    ...deps,
    ...(verbs === null ? {} : { fleetState: { connected: true, downSince: null, ccdVerbs: verbs, rosterFp: null, build: null } }),
  });
  open = app;
  return { app, calls };
}

/** What ccd's success does on disk: the named project, a main checkout. */
const makes = (args: string[], root: string): Awaited<ReturnType<Runner>> => {
  mkdirSync(path.join(root, args[args.indexOf('--name') + 1]!, '.git'), { recursive: true });
  return { ...OK, stdout: `added ${args[args.indexOf('--name') + 1]}\n` };
};

const post = (app: FastifyInstance, body: unknown): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url: '/api/projects', payload: body as object });

const names = async (app: FastifyInstance): Promise<string[]> => {
  const res = await app.inject({ method: 'GET', url: '/api/projects' });
  expect(res.statusCode).toBe(200);
  return (res.json() as { projects: { name: string }[] }).projects.map((p) => p.name);
};

describe('POST /api/projects: a project ccd made', () => {
  it('a clone: sends the clone argv, answers the name and source', async () => {
    const { app, calls } = await boot({ run: makes });
    const res = await post(app, { source: 'github', repo: 'https://github.com/example/repo.git' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, name: 'repo', source: 'github' });
    expect(calls).toEqual([['project-add', '--name', 'repo', '--url', 'https://github.com/example/repo.git']]);
  });

  it('an empty project: sends the empty argv', async () => {
    const { app, calls } = await boot({ run: makes });
    const res = await post(app, { source: 'empty', name: 'project-a' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, name: 'project-a', source: 'empty' });
    expect(calls).toEqual([['project-add', '--name', 'project-a', '--empty']]);
  });

  it('the new project is listed by the very next GET: the walk cache is dropped', async () => {
    const { app } = await boot({ run: makes });
    expect(await names(app)).toEqual(['project-old']);
    expect((await post(app, { source: 'empty', name: 'project-a' })).statusCode).toBe(200);
    expect((await names(app)).sort()).toEqual(['project-a', 'project-old']);
  });

  it('a box with no caps list (no evidence) permits the verb, as every verbRow does', async () => {
    const { app, calls } = await boot({ verbs: null, run: makes });
    expect((await post(app, { source: 'empty', name: 'project-a' })).statusCode).toBe(200);
    expect(calls).toHaveLength(1);
  });
});

describe("POST /api/projects: the server's refusals send nothing", () => {
  it.each([
    ['no body', undefined, 'bad-request'],
    ['an unknown source', { source: 'gitlab', repo: 'example/repo' }, 'bad-request'],
    ['a non-string repo', { source: 'github', repo: 3 }, 'bad-request'],
    ['an empty body without a name', { source: 'empty' }, 'bad-request'],
  ])('%s is 400 %s', async (_what, body, error) => {
    const { app, calls } = await boot();
    const res = await post(app, body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error });
    expect(calls).toEqual([]);
  });

  it('a repo that is not on GitHub is 400 bad-source', async () => {
    const { app, calls } = await boot();
    const res = await post(app, { source: 'github', repo: 'https://gitlab.com/example/repo' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-source' });
    expect(calls).toEqual([]);
  });

  it('a name outside the grammar is 400 bad-project', async () => {
    const { app, calls } = await boot();
    for (const body of [{ source: 'empty', name: '-rf' }, { source: 'github', repo: 'example/repo', name: '../x' }]) {
      const res = await post(app, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-project' });
    }
    expect(calls).toEqual([]);
  });

  it('a box whose measured caps lack project-add is 501 unsupported, for both entries', async () => {
    const { app, calls } = await boot({ verbs: ['caps', 'ws-add'] });
    for (const body of [{ source: 'empty', name: 'project-a' }, { source: 'github', repo: 'example/repo' }]) {
      const res = await post(app, body);
      expect(res.statusCode).toBe(501);
      expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    }
    expect(calls).toEqual([]);
  });
});

describe("POST /api/projects: ccd's refusals", () => {
  it("ccd's `project exists: <name>` is 409 project-exists", async () => {
    const { app } = await boot({ run: () => ({ ran: true, code: 1, stdout: '', stderr: 'ccd: project exists: project-old\n' }) });
    const res = await post(app, { source: 'empty', name: 'project-old' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'project-exists' });
  });

  it("any other failure is 502 with ccd's stderr, so a failed clone's own words reach the operator", async () => {
    const stderr = "fatal: repository 'https://github.com/example/repo.git/' not found\n";
    const { app } = await boot({ run: () => ({ ran: true, code: 128, stdout: '', stderr }) });
    const res = await post(app, { source: 'github', repo: 'example/repo' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr });
  });
});

describe('POST /api/projects: an outcome the server could not learn', () => {
  /** A runner's not-ran answer, as `remote/runner.ts` forges it: `code: 1`, the detail as stderr. */
  const notRan = (reason: 'transport' | 'timeout' | 'spawn', detail: string) =>
    (): Awaited<ReturnType<Runner>> => ({ code: 1, stdout: '', stderr: detail, ran: false, reason, detail });

  /** ccd made the project on the box, and then the answer was lost on its way back. */
  const madeThenLost = (reason: 'transport' | 'timeout') => (args: string[], root: string): Awaited<ReturnType<Runner>> => {
    makes(args, root);
    return notRan(reason, reason === 'timeout' ? 'timeout' : 'agent link closed')();
  };

  it.each(['timeout', 'transport'] as const)(
    "a %s is outcome-unknown, never a 502 that says the add failed; the walk cache is dropped, so a re-read shows what the box holds",
    async (reason) => {
      const { app } = await boot({ run: madeThenLost(reason) });
      expect(await names(app)).toEqual(['project-old']);
      const res = await post(app, { source: 'github', repo: 'example/repo' });
      expect(res.statusCode).toBe(REFUSAL_STATUS['outcome-unknown']);
      expect(res.json()).toEqual({ ok: false, error: 'outcome-unknown' });
      expect((await names(app)).sort()).toEqual(['project-old', 'repo']);
    },
  );

  it('a spawn failure is known not to have run: 502 with the runner\'s words, as any other failure', async () => {
    const { app } = await boot({ run: notRan('spawn', 'spawn ccd ENOENT') });
    const res = await post(app, { source: 'empty', name: 'project-a' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'spawn ccd ENOENT' });
  });
});

describe('ProjectWalkCache.drop', () => {
  it('forgets the kept walk at once', () => {
    let now = 1000;
    const c = new ProjectWalkCache(() => now);
    c.keepWalk([], c.stamp());
    expect(c.keptWalk()).toEqual([]);
    c.drop();
    expect(c.keptWalk()).toBeNull();
    now += 1;
    c.keepWalk([], c.stamp());
    expect(c.keptWalk(), 'a walk that starts after the drop is kept').toEqual([]);
  });

  it('a walk that STARTED before the drop and finishes after it is not kept: it may not see the new project', () => {
    let now = 1000;
    const c = new ProjectWalkCache(() => now);
    const before = c.stamp();
    now += 5;
    c.drop();
    now += 5;
    c.keepWalk([], before);
    expect(c.keptWalk()).toBeNull();
  });

  it('after the clock steps back past a drop, a measured walk is kept again (the cache heals, as it does for a walk)', () => {
    let now = 1000;
    const c = new ProjectWalkCache(() => now);
    c.drop();
    now = 500;
    c.keepWalk([], c.stamp());
    expect(c.keptWalk()).toEqual([]);
  });
});
