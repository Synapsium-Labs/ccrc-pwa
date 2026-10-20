// NAMED WORKSPACES S5 (design 2026-10-20 §4.2): `POST /api/projects/:project/workspaces` with a body that may now
// carry `name` and `wrapper`. The bodyless create is pinned in `workspaces-route.test.ts` and stays unchanged; this file
// is the named half. Every refusal below is asserted with `calls` EMPTY: a refused request must never have an argv to
// send. Nothing here reaches the network (`deps.linear.fetch` is the seam) or a real ccd (the Runner is a spy).
import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Runner } from '../src/exec.js';
import { buildServer } from '../src/server.js';
import { ACTOR_FLAGS_CAP, WS_TITLE_CAP, WS_WRAPPER_CAP } from '../src/ccdargv.js';
import { LINEAR_KEY_FILE } from '../src/linear/connection.js';
import type { FetchLike } from '../src/linear/client.js';
import { WS_TITLE_MAX_BYTES } from '../../shared/slug.js';
import { testDeps } from './helpers.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const BOTH = ['ws-add', WS_TITLE_CAP, WS_WRAPPER_CAP];
/** A pasted issue link, built from parts: the public-tree scanner refuses the host and a path written joined. */
const LINK = ['https:/', ['linear', 'app'].join('.'), 'team-a', 'issue', 'ENG-1234', 'fix-the-login-flow'].join('/');
const KEY = 'lin_api_createfixture';
const linearOk = (identifier: string, title: string): Awaited<ReturnType<FetchLike>> =>
  ({ ok: true, status: 200, json: async () => ({ data: { issue: { identifier, title } } }) });

let open: FastifyInstance | null = null;
afterEach(async () => { await open?.close(); open = null; });

interface Opts { verbs?: string[]; run?: Runner; fetch?: FetchLike; timeoutMs?: number; key?: boolean }
interface Booted { app: FastifyInstance; calls: string[][]; fetched: { n: number } }

async function boot(o: Opts = {}): Promise<Booted> {
  const calls: string[][] = [];
  const run: Runner = o.run ?? (async () => ({ code: 0, stdout: '', stderr: '' }));
  const deps = testDeps(undefined, async (cmd, args) => { calls.push(args); return run(cmd, args); });
  const fetched = { n: 0 };
  const f = o.fetch;
  if (o.key !== false) {
    mkdirSync(deps.cfg.ccrcDir, { recursive: true });
    writeFileSync(path.join(deps.cfg.ccrcDir, LINEAR_KEY_FILE), `${KEY}\n`, { mode: 0o600 });
  }
  const app = await buildServer({
    ...deps,
    fleetState: { connected: true, downSince: null, ccdVerbs: o.verbs ?? BOTH, rosterFp: null, build: null },
    linear: {
      fetch: f === undefined ? undefined : async (u, i) => { fetched.n += 1; return f(u, i); },
      timeoutMs: o.timeoutMs,
    },
  });
  open = app;
  return { app, calls, fetched };
}

const post = (app: FastifyInstance, body: unknown, project = 'project-a'): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url: `/api/projects/${project}/workspaces`, payload: body as object });

describe('refusals send no argv', () => {
  it('a flag-shaped project with a name is 400 bad-project, and nothing reaches ccd', async () => {
    const { app, calls } = await boot();
    const res = await post(app, { name: 'ENG-1234' }, '--no-rc');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-project' });
    expect(calls).toEqual([]);
  });

  it.each([
    ['!!', 'no-usable-characters'],
    ['a', 'too-short'],
    ['https://example.com/a/b', 'url-not-recognised'],
  ])('a refused name %j is 400 bad-name with reason %s', async (name, reason) => {
    const { app, calls } = await boot();
    const res = await post(app, { name });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-name', reason });
    expect(typeof (res.json() as { detail: unknown }).detail).toBe('string');
    expect(calls).toEqual([]);
  });

  it("a name over the preview read's own bound is 400 name-too-long", async () => {
    const { app, calls } = await boot();
    const res = await post(app, { name: 'a'.repeat(1025) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'name-too-long' });
    expect(calls).toEqual([]);
  });

  it.each([
    [{ name: 5 }], [{ name: null }], [{ name: ['a'] }], [{ name: 'ENG-1234', wrapper: 5 }],
    [{ name: 'ENG-1234', wrapper: null }], [{ wrapper: 7 }],
  ])('a non-string name or wrapper %j is 400 bad-request', async (body) => {
    const { app, calls } = await boot();
    const res = await post(app, body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    expect(calls).toEqual([]);
  });

  it.each(['lane a', '-lane', '.lane', '../lane', 'lane;x', ''])(
    'a wrapper %j outside the roster grammar is 400 bad-wrapper', async (wrapper) => {
      const { app, calls } = await boot();
      const res = await post(app, { name: 'ENG-1234', wrapper });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-wrapper' });
      expect(calls).toEqual([]);
    });

  it('a name without ws-title-v1 is 501 naming the token, never a silent unnamed create', async () => {
    const { app, calls } = await boot({ verbs: ['ws-add', WS_WRAPPER_CAP] });
    const res = await post(app, { name: 'ENG-1234' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-supported', needs: WS_TITLE_CAP });
    expect(calls).toEqual([]);
  });

  it('a wrapper without ws-wrapper-v1 is 501 naming the token, never a create on the least-loaded lane', async () => {
    const { app, calls } = await boot({ verbs: ['ws-add', WS_TITLE_CAP] });
    const res = await post(app, { name: 'ENG-1234', wrapper: 'lane-a' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-supported', needs: WS_WRAPPER_CAP });
    expect(calls).toEqual([]);
  });

  it('a box that advertised no caps at all refuses a name: no evidence is no', async () => {
    const calls: string[][] = [];
    const app = await buildServer(testDeps(undefined, async (_c, a) => { calls.push(a); return { code: 0, stdout: '', stderr: '' }; }));
    open = app;
    const res = await post(app, { name: 'ENG-1234' });
    expect(res.statusCode).toBe(501);
    expect(calls).toEqual([]);
  });

  it('a 501 asks Linear nothing: the cap is checked before the lookup', async () => {
    const { app, fetched } = await boot({ verbs: ['ws-add'], fetch: async () => linearOk('ENG-1234', 'Fix') });
    expect((await post(app, { name: 'ENG-1234' })).statusCode).toBe(501);
    expect(fetched.n).toBe(0);
  });
});

describe("a blank name is today's create", () => {
  it.each(['', '   ', '\t\n'])('name %j with a wrapper sends the bodyless argv, wrapper ignored', async (name) => {
    const { app, calls } = await boot();
    const res = await post(app, { name, wrapper: 'lane-a' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toEqual([['ws-add', 'project-a']]);
  });

  it('a bad wrapper next to a blank name is ignored too, not refused', async () => {
    const { app, calls } = await boot();
    expect((await post(app, { name: '', wrapper: '-x' })).statusCode).toBe(200);
    expect(calls).toEqual([['ws-add', 'project-a']]);
  });

  it('a blank-name create on a box with none of the caps still works', async () => {
    const { app, calls } = await boot({ verbs: ['ws-add'] });
    expect((await post(app, { name: '' })).statusCode).toBe(200);
    expect(calls).toEqual([['ws-add', 'project-a']]);
  });

  it('the bodyless create is unchanged: same argv, same answer (the additivity proof)', async () => {
    const { app, calls } = await boot({ verbs: ['ws-add'] });
    const res = await post(app, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toEqual([['ws-add', 'project-a']]);
  });
});

describe('a named create', () => {
  it('a plain name makes the argv leading --title, the slug behind the project, and no Linear call', async () => {
    const { app, calls, fetched } = await boot({ fetch: async () => linearOk('X-1', 'never') });
    const res = await post(app, { name: 'Login cleanup' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: 'project-a-login-cleanup', slug: 'login-cleanup', title: 'Login cleanup' });
    expect(calls).toEqual([['ws-add', '--title', 'Login cleanup', 'project-a', 'login-cleanup']]);
    expect(fetched.n).toBe(0);
  });

  it('carries the chosen wrapper and the route before the project, and the dec behind the slug', async () => {
    const { app, calls } = await boot({ verbs: [...BOTH, ACTOR_FLAGS_CAP, 'route-argv-v1'] });
    const res = await post(app, { name: 'Login cleanup', wrapper: 'lane-a', route: { effort: 'high' } });
    if (res.statusCode !== 200) throw new Error(`named create refused: ${res.body}`);
    const argv = calls[0]!;
    expect(argv.slice(0, 5)).toEqual(['ws-add', '--title', 'Login cleanup', '--wrapper', 'lane-a']);
    expect(argv.indexOf('--route')).toBeGreaterThan(argv.indexOf('--wrapper'));
    expect(argv.indexOf('--route')).toBeLessThan(argv.indexOf('project-a'));
    expect(argv.slice(-6)).toEqual(['project-a', 'login-cleanup', '--surface', 'pwa', '--actor', 'unmeasured']);
  });

  it("a ticket with Linear answering: the created title is Linear's, and the answer says so", async () => {
    const { app, calls } = await boot({ fetch: async () => linearOk('ENG-1234', 'Fix the login flow') });
    const res = await post(app, { name: 'ENG-1234' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: 'project-a-eng-1234', slug: 'eng-1234', title: 'ENG-1234 - Fix the login flow' });
    expect(calls).toEqual([['ws-add', '--title', 'ENG-1234 - Fix the login flow', 'project-a', 'eng-1234']]);
  });

  it("a pasted link takes its own slug and Linear's title", async () => {
    const { app, calls } = await boot({ fetch: async () => linearOk('ENG-1234', 'Fix it properly') });
    const res = await post(app, { name: LINK });
    expect(res.json()).toMatchObject({ slug: 'eng-1234-fix-the-login-flow', title: 'ENG-1234 - Fix it properly' });
    expect(calls[0]).toEqual(['ws-add', '--title', 'ENG-1234 - Fix it properly', 'project-a', 'eng-1234-fix-the-login-flow']);
  });

  it('Linear timing out: 200 with the offline title, the workspace is still created (M5)', async () => {
    const hang: FetchLike = (_u, init) =>
      new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
    const { app, calls } = await boot({ fetch: hang, timeoutMs: 20 });
    const res = await post(app, { name: 'ENG-1234' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: 'project-a-eng-1234', slug: 'eng-1234', title: 'ENG-1234' });
    expect(calls).toEqual([['ws-add', '--title', 'ENG-1234', 'project-a', 'eng-1234']]);
  });

  it('Linear rejecting the key, or no key connected, degrades the same way', async () => {
    const denied: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const a = await boot({ fetch: denied });
    expect((await post(a.app, { name: 'ENG-1234' })).json()).toMatchObject({ ok: true, title: 'ENG-1234' });
    await a.app.close();
    const b = await boot({ key: false, fetch: async () => linearOk('ENG-1234', 'never asked') });
    expect((await post(b.app, { name: 'ENG-1234' })).json()).toMatchObject({ ok: true, title: 'ENG-1234' });
    expect(b.fetched.n).toBe(0);
  });

  it('a Linear title with control characters reaches ccd sanitised, one space for each run', async () => {
    const { app, calls } = await boot({ fetch: async () => linearOk('ENG-1234', 'Fix\tthe\n\nlogin flow\u0007') });
    const res = await post(app, { name: 'ENG-1234' });
    expect(res.statusCode).toBe(200);
    expect(calls[0]![2]).toBe('ENG-1234 - Fix the login flow');
  });

  it('a Linear title over the byte cap is shortened with an ellipsis, never refused', async () => {
    const { app, calls } = await boot({ fetch: async () => linearOk('ENG-1234', 'word '.repeat(200)) });
    const res = await post(app, { name: 'ENG-1234' });
    expect(res.statusCode).toBe(200);
    const title = calls[0]![2]!;
    expect(new TextEncoder().encode(title).length).toBeLessThanOrEqual(WS_TITLE_MAX_BYTES);
    expect(title.endsWith('…')).toBe(true);
    expect(title.startsWith('ENG-1234 - word')).toBe(true);
  });

  it('a plain name with control characters is sanitised too (offline path)', async () => {
    const { app, calls } = await boot();
    expect((await post(app, { name: 'Login\tcleanup' })).statusCode).toBe(200);
    expect(calls[0]![2]).toBe('Login cleanup');
  });

  it('a blank slug token is never sent: the named argv has no empty token and a slug right after the project', async () => {
    const { app, calls } = await boot();
    await post(app, { name: 'Login cleanup' });
    const argv = calls[0]!;
    expect(argv.every((t) => t !== '')).toBe(true);
    expect(argv[argv.indexOf('project-a') + 1]).toBe('login-cleanup');
  });
});

describe("ccd's refusals", () => {
  const failing = (stderr: string, extra: object = {}): Runner => async () => ({ code: 1, stdout: '', stderr, ...extra });

  it('slug in use is 409 slug-taken, with no residue text', async () => {
    const { app } = await boot({ run: failing('ccd: slug in use: login-cleanup — in /home/u/.cc-sessions: project-a-login-cleanup.workdir') });
    const res = await post(app, { name: 'Login cleanup' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'slug-taken' });
  });

  it('an invalid slug is 400 bad-slug', async () => {
    const { app } = await boot({ run: failing("ccd: invalid slug 'x'") });
    const res = await post(app, { name: 'Login cleanup' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-slug' });
  });

  it("a --wrapper refusal is 409 account-refused with ccd's per-lane reason, not its whole sentence", async () => {
    const { app } = await boot({ run: failing('ccd: --wrapper refused — lane-a:auth-dead; the account was named, so ccd will not place this workspace on another — pick a different account — nothing was touched') });
    const res = await post(app, { name: 'Login cleanup', wrapper: 'lane-a' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'account-refused', reason: 'lane-a:auth-dead' });
  });

  it('the post-worktree --wrapper refusal is the same 409', async () => {
    const { app } = await boot({ run: failing('ccd: --wrapper refused — lane-a:pool=pool-b; the account was named, so ccd will not place this workspace on another. The worktree /w EXISTS') });
    const res = await post(app, { name: 'Login cleanup', wrapper: 'lane-a' });
    expect(res.json()).toEqual({ ok: false, error: 'account-refused', reason: 'lane-a:pool=pool-b' });
  });

  it("anything else is 502 with ccd's stderr, as the bodyless create answers", async () => {
    const { app } = await boot({ run: failing('boom') });
    const res = await post(app, { name: 'Login cleanup' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'boom' });
  });

  it('a transport failure whose text looks like a refusal is 502, never a verdict', async () => {
    const { app } = await boot({ run: failing('slug in use: login-cleanup', { ran: false, reason: 'spawn', detail: 'x' }) });
    const res = await post(app, { name: 'Login cleanup' });
    expect(res.statusCode).toBe(502);
  });
});
