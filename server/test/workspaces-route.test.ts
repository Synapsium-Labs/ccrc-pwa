// POST /api/projects/:project/workspaces and DELETE /api/sessions/:id/workspace
// just shell out to `ccd ws-add` / `ccd ws-rm` via the shared runCcd helper —
// these tests drive the real Fastify handler through buildServer + app.inject
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

  it('DELETE /api/sessions/:id/workspace runs ccd ws-rm', async () => {
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({ method: 'DELETE', url: '/api/sessions/demo-quiet-mesa/workspace' });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-rm', 'demo-quiet-mesa']);
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
