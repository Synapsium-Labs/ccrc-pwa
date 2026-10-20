// NAMED WORKSPACES S9 (design 2026-10-20 §6): `POST /api/sessions/:id/title`, the workspace rename. Body `{title}` or
// `{clear:true}`. Every refusal the SERVER decides is asserted with `calls` EMPTY: a refused request must never have an
// argv to send. ccd's own refusals are driven through a Runner stub that answers with its real sentences. The runner
// crosses the agent's real whitelist (`testDeps`'s `guardRunner`), so the new grant is exercised by every success case.
// Nothing here reaches the network (`deps.linear.fetch` is the seam) or a real ccd.
import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Runner } from '../src/exec.js';
import { buildServer } from '../src/server.js';
import { WS_TITLE_VERB } from '../src/ccdargv.js';
import { LINEAR_KEY_FILE } from '../src/linear/connection.js';
import type { FetchLike } from '../src/linear/client.js';
import { testDeps } from './helpers.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const ID = 'project-a-quiet-basin';
const KEY = 'lin_api_titlefixture';
const linearOk = (identifier: string, title: string): Awaited<ReturnType<FetchLike>> =>
  ({ ok: true, status: 200, json: async () => ({ data: { issue: { identifier, title } } }) });

let open: FastifyInstance | null = null;
afterEach(async () => { await open?.close(); open = null; });

interface Opts { verbs?: string[] | null; run?: Runner; fetch?: FetchLike; timeoutMs?: number; row?: boolean }
interface Booted { app: FastifyInstance; calls: string[][]; fetched: { n: number }; registryDir: string }

async function boot(o: Opts = {}): Promise<Booted> {
  const calls: string[][] = [];
  const run: Runner = o.run ?? (async () => ({ code: 0, stdout: '', stderr: '' }));
  const deps = testDeps(undefined, async (cmd, args) => { calls.push(args); return run(cmd, args); });
  const fetched = { n: 0 };
  const f = o.fetch;
  mkdirSync(deps.cfg.ccrcDir, { recursive: true });
  writeFileSync(path.join(deps.cfg.ccrcDir, LINEAR_KEY_FILE), `${KEY}\n`, { mode: 0o600 });
  // `knownId` reads the registry listing: a session exists when `<id>.uuid` is listed.
  mkdirSync(deps.cfg.registryDir, { recursive: true });
  if (o.row !== false) writeFileSync(path.join(deps.cfg.registryDir, `${ID}.uuid`), 'a'.repeat(36));
  const verbs = o.verbs === undefined ? ['ws-add', WS_TITLE_VERB] : o.verbs;
  const app = await buildServer({
    ...deps,
    ...(verbs === null ? {} : { fleetState: { connected: true, downSince: null, ccdVerbs: verbs, rosterFp: null, build: null } }),
    linear: {
      fetch: f === undefined ? undefined : async (u, i) => { fetched.n += 1; return f(u, i); },
      timeoutMs: o.timeoutMs,
    },
  });
  open = app;
  return { app, calls, fetched, registryDir: deps.cfg.registryDir };
}

const post = (app: FastifyInstance, body: unknown, id = ID): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url: `/api/sessions/${id}/title`, payload: body as object });

describe('a rename', () => {
  it('sets the title: ws-title --session <id> --title <text>, and answers the title', async () => {
    const { app, calls } = await boot();
    const res = await post(app, { title: 'Login cleanup' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: ID, title: 'Login cleanup' });
    expect(calls).toEqual([['ws-title', '--session', ID, '--title', 'Login cleanup']]);
  });

  it('clears the title: ws-title --session <id> --clear, and answers title null', async () => {
    const { app, calls } = await boot();
    const res = await post(app, { clear: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: ID, title: null });
    expect(calls).toEqual([['ws-title', '--session', ID, '--clear']]);
  });

  it('a title that begins with dashes is one token after --title, never a flag of its own', async () => {
    const { app, calls } = await boot();
    expect((await post(app, { title: '--clear me' })).statusCode).toBe(200);
    expect(calls).toEqual([['ws-title', '--session', ID, '--title', '--clear me']]);
  });

  it("a ticket with Linear answering: the title is Linear's", async () => {
    const { app, calls } = await boot({ fetch: async () => linearOk('ENG-1234', 'Fix the login flow') });
    const res = await post(app, { title: 'ENG-1234' });
    expect(res.json()).toEqual({ ok: true, id: ID, title: 'ENG-1234 - Fix the login flow' });
    expect(calls).toEqual([['ws-title', '--session', ID, '--title', 'ENG-1234 - Fix the login flow']]);
  });

  it('Linear timing out: 200 with the offline title (M5), the rename is still made', async () => {
    const hang: FetchLike = (_u, init) =>
      new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
    const { app, calls } = await boot({ fetch: hang, timeoutMs: 20 });
    const res = await post(app, { title: 'ENG-1234' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: ID, title: 'ENG-1234' });
    expect(calls).toEqual([['ws-title', '--session', ID, '--title', 'ENG-1234']]);
  });

  it('a clear asks Linear nothing', async () => {
    const { app, fetched } = await boot({ fetch: async () => linearOk('ENG-1234', 'never') });
    expect((await post(app, { clear: true })).statusCode).toBe(200);
    expect(fetched.n).toBe(0);
  });

  it('a Linear title with control characters reaches ccd sanitised', async () => {
    const { app, calls } = await boot({ fetch: async () => linearOk('ENG-1234', 'Fix\tthe\n\nlogin flow\u0007') });
    expect((await post(app, { title: 'ENG-1234' })).statusCode).toBe(200);
    expect(calls[0]![4]).toBe('ENG-1234 - Fix the login flow');
  });
});

describe('refusals send no argv', () => {
  it.each([
    [{}], [{ title: 5 }], [{ title: null }], [{ title: ['a'] }], [{ clear: 'yes' }], [{ clear: false }],
    [{ clear: null }], [{ title: 'Login', clear: true }], [{ title: 'Login', clear: false }],
  ])('the body %j is 400 bad-request', async (body) => {
    const { app, calls } = await boot();
    const res = await post(app, body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    expect(calls).toEqual([]);
  });

  it.each(['', '   ', '\t\n'])('a blank title %j is 400 bad-name, never a clear', async (title) => {
    const { app, calls } = await boot();
    const res = await post(app, { title });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-name', reason: 'no-usable-characters' });
    expect(calls).toEqual([]);
  });

  it.each([
    ['!!', 'no-usable-characters'],
    ['a', 'too-short'],
    ['https://example.com/a/b', 'url-not-recognised'],
  ])('a refused title %j is 400 bad-name with reason %s', async (title, reason) => {
    const { app, calls } = await boot();
    const res = await post(app, { title });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-name', reason });
    expect(typeof (res.json() as { detail: unknown }).detail).toBe('string');
    expect(calls).toEqual([]);
  });

  it("a title over the preview read's own bound is 400 name-too-long", async () => {
    const { app, calls } = await boot();
    const res = await post(app, { title: 'a'.repeat(1025) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'name-too-long' });
    expect(calls).toEqual([]);
  });

  it('a flag-shaped session id is 400 bad-session-id', async () => {
    const { app, calls } = await boot();
    const res = await post(app, { title: 'Login cleanup' }, '--actor');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session-id' });
    expect(calls).toEqual([]);
  });

  it('a session the registry does not list is 404 unknown-session', async () => {
    const { app, calls } = await boot({ row: false });
    const res = await post(app, { title: 'Login cleanup' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
    expect(calls).toEqual([]);
  });
});

describe('a box that does not list the verb ws-title (M7)', () => {
  it.each([
    ['a set', { title: 'Login cleanup' }],
    ['a clear', { clear: true }],
  ])('%s is 501 unsupported naming the verb, and nothing is sent', async (_name, body) => {
    const { app, calls } = await boot({ verbs: ['ws-add'] });
    const res = await post(app, body);
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported', needs: 'ws-title' });
    expect(calls).toEqual([]);
  });

  it('the ws-add token ws-title-v1 is NOT the verb: it is advertised before the verb exists', async () => {
    const { app, calls } = await boot({ verbs: ['ws-add', 'ws-title-v1'] });
    const res = await post(app, { title: 'Login cleanup' });
    expect(res.statusCode).toBe(501);
    expect(calls).toEqual([]);
  });

  it('a box that advertised no caps at all refuses: no evidence is no', async () => {
    const { app, calls } = await boot({ verbs: null });
    expect((await post(app, { title: 'Login cleanup' })).statusCode).toBe(501);
    expect((await post(app, { clear: true })).statusCode).toBe(501);
    expect(calls).toEqual([]);
  });

  it('a 501 asks Linear nothing: the cap is checked before the lookup', async () => {
    const { app, fetched } = await boot({ verbs: ['ws-add'], fetch: async () => linearOk('ENG-1234', 'Fix') });
    expect((await post(app, { title: 'ENG-1234' })).statusCode).toBe(501);
    expect(fetched.n).toBe(0);
  });
});

describe("ccd's refusals", () => {
  const failing = (stderr: string, extra: object = {}): Runner => async () => ({ code: 1, stdout: '', stderr, ...extra });

  it('a main checkout is 409 not-a-workspace, with no residue text', async () => {
    const { app } = await boot({ run: failing(`ccd: ${ID} is not a workspace — a main checkout's name is its project, so there is no workspace title to set or clear`) });
    const res = await post(app, { title: 'Login cleanup' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-a-workspace' });
  });

  it('a session ccd has no record of is 404 unknown-session (it went between the listing and the act)', async () => {
    const { app } = await boot({ run: failing(`ccd: no such session: ${ID}`) });
    const res = await post(app, { clear: true });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
  });

  it("ccd's own session-id refusal is 400 bad-session-id", async () => {
    const { app } = await boot({ run: failing('ccd: bad session id') });
    const res = await post(app, { clear: true });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session-id' });
  });

  it.each([
    ['ccd: --title must be non-blank', 'blank'],
    ['ccd: --title must not contain control characters', 'control-characters'],
    ['ccd: --title is longer than 480 bytes', 'too-long'],
  ])('a text refusal %j (an older or newer sanitiser) is 400 bad-title with reason %s', async (stderr, reason) => {
    const { app } = await boot({ run: failing(stderr) });
    const res = await post(app, { title: 'Login cleanup' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-title', reason });
  });

  it.each([
    [{ title: 'Login cleanup' }, 'ccd: warn: could not write /h/.cc-sessions/x.named — x is NOT marked as named\nccd: could not record the title for project-a-quiet-basin — see the warning above; the row may carry only part of it'],
    [{ clear: true }, 'ccd: could not clear the title for project-a-quiet-basin — a title or named field STANDS under /h/.cc-sessions and the ai-title sweep stays off this row'],
  ])('a write ccd could not make (%j) is 502 title-not-saved, with no path or id in the answer', async (body, stderr) => {
    const { app } = await boot({ run: failing(stderr) });
    const res = await post(app, body);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, error: 'title-not-saved' });
  });

  it("anything else is 502 with ccd's stderr, as the other session writes answer", async () => {
    const { app } = await boot({ run: failing('boom') });
    const res = await post(app, { title: 'Login cleanup' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'boom' });
  });

  it("ccd's usage line is 502 too: the server composed the argv, so that is its own fault", async () => {
    const { app } = await boot({ run: failing('ccd: usage: ccd ws-title --session <id> (--title <text> | --clear)') });
    expect((await post(app, { clear: true })).statusCode).toBe(502);
  });

  it('a transport failure whose text looks like a refusal is 502, never a verdict', async () => {
    const { app } = await boot({ run: failing(`ccd: ${ID} is not a workspace — x`, { ran: false, reason: 'spawn', detail: 'x' }) });
    const res = await post(app, { clear: true });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false });
    expect(res.json()).not.toHaveProperty('error');
  });
});

describe('the board shows the new title on the next fleet read', () => {
  it('/api/fleet re-reads the registry: nothing caches the title', async () => {
    const wrote: { reg: string } = { reg: '' };
    // A stand-in for ccd's `ws-title`: it writes the two registry fields the verb writes, into the fixture registry.
    const run: Runner = async (_cmd, args) => {
      if (args[0] !== 'ws-title') return { code: 1, stdout: '', stderr: '' };
      const title = args[3] === '--title' ? args[4]! : null;
      const f = (k: string): string => path.join(wrote.reg, `${ID}.${k}`);
      if (title !== null) { writeFileSync(f('title'), title); writeFileSync(f('named'), '1'); }
      return { code: 0, stdout: `titled ${ID}: ${title}`, stderr: '' };
    };
    const { app, registryDir } = await boot({ run });
    wrote.reg = registryDir;
    const fields: Record<string, string> = {
      wrapper: 'claude', project: 'project-a', workdir: '/w/project-a/quiet-basin', started: '1', workspace: 'quiet-basin',
      branch: 'ws/quiet-basin',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(registryDir, `${ID}.${k}`), v);

    const row = async (): Promise<{ title: string | null } | undefined> => {
      const body = (await app.inject({ method: 'GET', url: '/api/fleet' })).json() as { sessions: { id: string; title: string | null }[] };
      return body.sessions.find((s) => s.id === ID);
    };
    expect((await row())?.title, 'the row is on the board with no title').toBeNull();
    expect((await post(app, { title: 'Login cleanup' })).statusCode).toBe(200);
    expect((await row())?.title).toBe('Login cleanup');
  });
});
