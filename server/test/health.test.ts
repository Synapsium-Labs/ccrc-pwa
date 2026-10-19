import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { SERVER_CAPS } from '../../shared/api.js';

describe('health', () => {
  it('GET /health returns ok and the build stamp (null when unstamped)', async () => {
    const app = await buildServer(testDeps());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    // testDeps() carries no stamp: null is the honest answer for a dev boot,
    // and the deploy's sha assertion greps for the REAL stamp in production.
    expect(res.json()).toEqual({ ok: true, build: null, caps: SERVER_CAPS });
    await app.close();
  });

  it('GET /health carries the stamp when the box was deployed', async () => {
    const app = await buildServer({
      ...testDeps(),
      build: { sha: 'b'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    // `toEqual` is strict about extra keys: this also pins that NO sibling
    // `version` appears when the stamp carries none — additive absence.
    expect(res.json()).toEqual({
      ok: true,
      build: { sha: 'b'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false },
      caps: SERVER_CAPS,
    });
    await app.close();
  });

  it('GET /health emits the release version beside the build — only when the stamp carries one', async () => {
    // Stage 4, Task 1: the tag rides in build.json additively, and /health
    // surfaces it as a SIBLING of `build` (spec §3 :87) without changing the
    // existing shape — an unversioned box's body is byte-identical to before.
    const stamp = {
      sha: 'c'.repeat(40), ref: 'main', builtAt: '2026-08-21T00:00:00Z', dirty: false,
      version: 'v1.2.3',
    };
    const app = await buildServer({ ...testDeps(), build: stamp });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ ok: true, build: stamp, version: 'v1.2.3', caps: SERVER_CAPS });
    await app.close();
  });

  // D-5232's mechanism (plan 2026-10-16, Task 9b; spec §6.1): the server's capability words ride additively, on the
  // auth-exempt route the fleet box's `ccd-update-sync` asks with no token. `ok`, `build` and `version` are unchanged:
  // deploy.sh's gate greps the build's `"sha"` and the update health gate reads `.version`, so neither sees `caps`.
  it('GET /health carries `caps`, the server\'s capability words, beside an unchanged ok/build/version', async () => {
    const stamp = { sha: 'd'.repeat(40), ref: 'main', builtAt: '2026-10-16T00:00:00Z', dirty: false, version: 'v9.9.9' };
    const app = await buildServer({ ...testDeps(), build: stamp });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['caps']).toEqual([...SERVER_CAPS]);
    expect(body['caps']).toContain('dispatch-live-gate-v1');
    expect(body['ok']).toBe(true);
    expect(body['version']).toBe('v9.9.9');
    expect(body['build']).toEqual(stamp);
    await app.close();
  });
});
