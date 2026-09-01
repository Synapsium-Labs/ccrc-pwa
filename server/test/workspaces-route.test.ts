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

// ── argv smuggling through the PROJECT segment ──────────────────────────────
// Found by adversarial review of this branch, and it was REAL: the project is
// an argv positional, `cmd_ws_add`'s strip loop eats flags from any position,
// and the slug token arriving is what made it reachable.
describe('POST /api/projects/:project/workspaces — the project segment', () => {
  it('refuses a flag-shaped project BEFORE any argv exists', async () => {
    // MEASURED before the guard: this built
    // `['ws-add','--no-rc','eng-1','--title','ENG-1']`, ccd stripped the flag,
    // bound `project` to `eng-1` — the operator's SLUG — drew a random slug of
    // its own, and exited 0. A workspace in the wrong project, reported as
    // success.
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({
      method: 'POST', url: '/api/projects/--no-rc/workspaces', payload: { name: 'ENG-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-project' });
    expect(calls, 'no argv may be built for a project we already know is illegal').toEqual([]);
    await app.close();
  });

  it('refuses every shape ccd’s own _ws_project_valid refuses', async () => {
    const { app, calls } = await appWithCcdSpy();
    for (const p of ['--title', '-x', '.hidden', 'has space', 'semi;colon', 'sla/sh']) {
      const res = await app.inject({
        method: 'POST', url: `/api/projects/${encodeURIComponent(p)}/workspaces`, payload: { name: 'ENG-1' },
      });
      expect(res.statusCode, p).toBe(400);
    }
    expect(calls).toEqual([]);
    await app.close();
  });

  it('still accepts an ordinary project name', async () => {
    // The guard must not be a wall: dots, dashes and underscores are legal to
    // ccd and real projects use them.
    const { app, calls } = await appWithCcdSpy();
    for (const p of ['demo', 'demo-app.ts', 'my_project', 'a.b-c_d']) {
      const res = await app.inject({
        method: 'POST', url: `/api/projects/${encodeURIComponent(p)}/workspaces`, payload: { name: 'ENG-1' },
      });
      expect(res.statusCode, p).toBe(200);
    }
    expect(calls).toHaveLength(4);
    await app.close();
  });

  it('a title past ccd’s byte budget is a 400, not a 502', async () => {
    // ccd refuses `--title` past `_LC_DEC_MAX` (512 BYTES). Left to ccd that
    // refusal arrives as a Bad Gateway, which reads like the fleet is broken
    // for what is ordinary input.
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { name: 'x'.repeat(600) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'title-too-long' });
    expect(calls).toEqual([]);
    await app.close();
  });

  it('measures the title budget in BYTES, as ccd does', async () => {
    // `_lc_dec_ok` measures under LC_ALL=C, so an emoji spends four bytes per
    // glyph. A `.length` check would accept 512 emoji — 2048 bytes — and ccd
    // would refuse them.
    const { app } = await appWithCcdSpy();
    const res = await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { name: 'ENG-1 ' + '🙂'.repeat(200) },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /api/projects/:project/workspaces — the title fallback', () => {
  it('keeps the operator’s own words when a "ticket" turns out not to be one', async () => {
    // `deriveWorkspaceSlug`'s identifier bound is deliberately generous, so an
    // ordinary name like `demo-2` parses as a ticket. With no Linear key the
    // lookup gives nothing, and uppercasing to `DEMO-2` would rewrite what the
    // operator typed for a ticket that does not exist. Found by review.
    const { app, calls } = await appWithCcdSpy();
    await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { name: 'demo-2' },
    });
    expect(calls).toContainEqual(['ws-add', 'demo', 'demo-2', '--title', 'demo-2']);
    await app.close();
  });

  it('falls back to the identifier for a pasted URL, which has no words worth keeping', async () => {
    const { app, calls } = await appWithCcdSpy();
    await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces',
      payload: { name: 'https://linear.app/acme/issue/ENG-9/fix-it' },
    });
    expect(calls).toContainEqual(['ws-add', 'demo', 'eng-9-fix-it', '--title', 'ENG-9']);
    await app.close();
  });
});
