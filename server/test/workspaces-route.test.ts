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
import { ACTOR_FLAGS_CAP, CCD_ARGV } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';

/** `ccdVerbs`, when given, seeds a real `fleetState` (lifecycle.test.ts's
 *  `makeApp` shape); omitted, the deps carry none — no evidence, as before. */
async function appWithCcdSpy(ccdVerbs?: string[]): Promise<{ app: FastifyInstance; calls: string[][] }> {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const deps = testDeps(undefined, run);
  const app = await buildServer(ccdVerbs === undefined ? deps : {
    ...deps,
    fleetState: { connected: true, downSince: null, ccdVerbs, rosterFp: null, build: null },
  });
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

  // D-5301 (coordinator-first spec §8): the PWA "+" says who made the
  // workspace. It passes `ccd ws-add`'s existing `--surface`/`--actor` pair —
  // `pwaDec`, the dec every other human-driven workspace route declares — and
  // nothing else; only on a box whose ccd advertises the flags, because an old
  // `cmd_ws_add` bound the first flag token as the slug (D-410).
  it('the PWA create declares its surface and actor on a box that takes the flags, and no other new flag (D-5301)', async () => {
    const { app, calls } = await appWithCcdSpy(['ws-add', ACTOR_FLAGS_CAP]);
    const res = await app.inject({ method: 'POST', url: '/api/projects/project-a/workspaces' });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([['ws-add', 'project-a', '--surface', 'pwa', '--actor', 'unmeasured']]);
    await app.close();
  });

  it('the PWA create keeps its route flags leading and its dec trailing (D-5301)', async () => {
    const { app, calls } = await appWithCcdSpy(['ws-add', ACTOR_FLAGS_CAP, 'route-argv-v1']);
    const res = await app.inject({
      method: 'POST', url: '/api/projects/project-a/workspaces', payload: { route: { effort: 'high' } },
    });
    if (res.statusCode !== 200) throw new Error(`route body refused: ${res.body}`);
    const argv = calls[0]!;
    expect(argv[0]).toBe('ws-add');
    expect(argv.slice(-5)).toEqual(['project-a', '--surface', 'pwa', '--actor', 'unmeasured']);
    await app.close();
  });

  it('a box that does not advertise the flags gets the bare create, token for token (D-410, D-5301)', async () => {
    const { app, calls } = await appWithCcdSpy(['ws-add']);
    await app.inject({ method: 'POST', url: '/api/projects/project-a/workspaces' });
    expect(calls).toEqual([['ws-add', 'project-a']]);
    await app.close();
  });

  it("a dispatch's create is byte-identical to today's — it never gains the operator's dec (D-5301)", () => {
    expect(CCD_ARGV.wsAddWorker('project-a', null)).toEqual(['ws-add', '--no-rc', 'project-a']);
    expect(CCD_ARGV.wsAddWorker('project-a', { surface: 'agent', actor: 'run:7 dispatch', reason: null }, null, 7))
      .toEqual(['ws-add', '--no-rc', '--child', '7', 'project-a', '--surface', 'agent', '--actor', 'run:7 dispatch']);
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
