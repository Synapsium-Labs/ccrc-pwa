// POST /api/projects/:project/workspaces shells out to `ccd ws-add` via the
// shared runCcd helper. DELETE /api/sessions/:id/workspace used to do the same
// for `ccd ws-rm` — Task 8 retired that route with nothing to replace it yet
// (Task 17 lands the guarded one) — so its test now pins the 404 instead.
// These tests drive the real Fastify handler through buildServer + app.inject
// and assert the exact argv ccd receives, same pattern as accounts-route.test.ts.
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Runner } from '../src/exec.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';

async function appWithCcdSpy(): Promise<{ app: FastifyInstance; calls: string[][] }> {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const app = await buildServer(testDeps(undefined, run));
  return { app, calls };
}

describe('workspace routes', () => {
  it('POST /api/projects/:project/workspaces runs ccd ws-add', async () => {
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({ method: 'POST', url: '/api/projects/demo/workspaces' });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-add', 'demo']);
    await app.close();
  });

  it('DELETE /api/sessions/:id/workspace no longer exists', async () => {
    // ws-rm's only data guard is `git status --porcelain`, which cannot see
    // gitignored content: a worktree holding SECRET_API_KEY in .env is deleted
    // with the output `removed workspace …` and nothing else. It asks the remote
    // nothing, counts no stashes, and carries no confirmation — so nothing
    // re-proves the world at the instant of deletion. (It no longer orphans the
    // branch in silence; ws-rm-fix made it warn. The three above are what it
    // cannot fix.) The replacement is ws-audit -> confirm -> ws-reap (Task 17).
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({ method: 'DELETE', url: '/api/sessions/demo-quiet-mesa/workspace' });
    expect(res.statusCode).toBe(404);
    expect(calls.flat()).not.toContain('ws-rm');
    await app.close();
  });

  it('passes a URL-encoded project through intact', async () => {
    const { app, calls } = await appWithCcdSpy();
    await app.inject({ method: 'POST', url: '/api/projects/expoAI-assistant/workspaces' });
    expect(calls).toContainEqual(['ws-add', 'expoAI-assistant']);
    await app.close();
  });

  it('a failing ccd ws-add maps to 502 with stderr', async () => {
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: 'boom' });
    const app = await buildServer(testDeps(undefined, run));
    const res = await app.inject({ method: 'POST', url: '/api/projects/demo/workspaces' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'boom' });
    await app.close();
  });
});

// ── the operator's name reaches ccd ─────────────────────────────────────────
describe('POST /api/projects/:project/workspaces — naming', () => {
  it('sends the derived slug as a positional, token for token', async () => {
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { name: 'ENG-1234' },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-add', 'demo', 'eng-1234', '--title', 'ENG-1234']);
    // The id is DERIVED, not parsed out of ccd's prose — `<project>-<slug>` by
    // construction (ccd:3781), which is the whole reason a caller-supplied
    // slug removes the registry-diff dance the dispatch path still needs.
    expect(res.json()).toMatchObject({ ok: true, id: 'demo-eng-1234', slug: 'eng-1234' });
    await app.close();
  });

  it('a blank name is the AUTO path and sends no slug token at all', async () => {
    // `['ws-add','demo','']` reaches ccd, fails `[[ -n "$slug" ]]`, passes
    // `[[ -z "$slug" ]]`, draws a random adjective-noun and exits 0 — a 200
    // for a workspace nobody named. The empty token must never be built.
    const { app, calls } = await appWithCcdSpy();
    for (const payload of [{ name: '' }, { name: '   ' }, { name: 42 }, {}]) {
      await app.inject({ method: 'POST', url: '/api/projects/demo/workspaces', payload });
    }
    expect(calls).toEqual([['ws-add', 'demo'], ['ws-add', 'demo'], ['ws-add', 'demo'], ['ws-add', 'demo']]);
    expect(calls.some((a) => a.includes(''))).toBe(false);
    await app.close();
  });

  it('refuses a bad name with 400 AND builds no argv', async () => {
    // BOTH halves. A mutant that builds the argv anyway and lets ccd refuse
    // would still answer 400 via the stderr arm — only the empty call list
    // catches it.
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { name: '!!!' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-slug', reason: 'no-usable-characters' });
    expect(calls, 'ccd must not be invoked for a name we already know is bad').toEqual([]);
    await app.close();
  });

  it('each refusal reason reaches the client as itself', async () => {
    const { app } = await appWithCcdSpy();
    for (const [name, reason] of [
      ['!!!', 'no-usable-characters'], ['x', 'too-short'],
      ['https://github.com/x/y/issues/3', 'url-not-recognised'],
    ] as const) {
      const res = await app.inject({
        method: 'POST', url: '/api/projects/demo/workspaces', payload: { name },
      });
      expect(res.statusCode, name).toBe(400);
      expect(res.json().reason, name).toBe(reason);
    }
    await app.close();
  });

  it('a slug collision is 409 carrying ccd’s own file-naming sentence, not a 502', async () => {
    // Ordinary user input — one ticket maps to one slug, so a second workspace
    // for the same ticket collides by design. A Bad Gateway would say the
    // fleet is broken when it is working exactly as intended.
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      return { code: 1, stdout: '',
        stderr: 'slug in use: eng-1234 — /h/.cc-sessions/demo-eng-1234.{archived}' };
    };
    const app = await buildServer(testDeps(undefined, run));
    const res = await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { name: 'ENG-1234' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'slug-taken' });
    // Verbatim: the sentence names the exact files to reclaim, which is the
    // operator's next step. Rewording it would throw that away.
    expect(res.json().stderr).toContain('demo-eng-1234.{archived}');
    await app.close();
  });

  it('any other ccd failure is still a 502', async () => {
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: 'only 2G free on /w' });
    const app = await buildServer(testDeps(undefined, run));
    const res = await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { name: 'ENG-1234' },
    });
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  it('a plain name becomes the title verbatim, with no Linear lookup', async () => {
    const { app, calls } = await appWithCcdSpy();
    await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { name: 'Fix the login flow' },
    });
    expect(calls).toContainEqual(
      ['ws-add', 'demo', 'fix-the-login-flow', '--title', 'Fix the login flow']);
    await app.close();
  });

  it('an unconfigured Linear still names the workspace from the ticket', async () => {
    // The degrade that matters: no token on the box (the default) must cost a
    // nicer title, never the workspace. `testDeps` carries no linearToken.
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces',
      payload: { name: 'https://linear.app/acme/issue/ENG-1234/fix-the-login-flow' },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(
      ['ws-add', 'demo', 'eng-1234-fix-the-login-flow', '--title', 'ENG-1234']);
    await app.close();
  });
});
