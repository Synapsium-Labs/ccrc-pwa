import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';

describe('health', () => {
  it('GET /health returns ok and the build stamp (null when unstamped)', async () => {
    const app = await buildServer(testDeps());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    // testDeps() carries no stamp: null is the honest answer for a dev boot,
    // and the deploy's sha assertion greps for the REAL stamp in production.
    expect(res.json()).toEqual({ ok: true, build: null });
    await app.close();
  });

  it('GET /health carries the stamp when the box was deployed', async () => {
    const app = await buildServer({
      ...testDeps(),
      build: { sha: 'b'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({
      ok: true,
      build: { sha: 'b'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false },
    });
    await app.close();
  });
});
