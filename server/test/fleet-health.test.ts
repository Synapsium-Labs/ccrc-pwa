import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { saveSnapshot, type FleetState } from '../src/fleetstate.js';
import { testDeps } from './helpers.js';
import type { FleetSession } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const deadRunner: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

/** Deps in remote mode against a throwaway fixture home. */
function remoteDeps(
  env: Record<string, string> = {},
  fleetState?: FleetState,
  stateCachePath?: string,
): Deps {
  const home = mkTmp('ccrc-');
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote', ...env });
  return { cfg, runCcd: ccdRunner(deadRunner, cfg), tmux: new Tmux(deadRunner), io: localIO, fleetState, stateCachePath };
}

// A COMPLETE FleetSession — the fixture was eight fields short of the type it
// claims (server/tsconfig.json does not include test/, so nothing said so).
const session = (id: string): FleetSession => ({
  id, wrapper: 'claude', home: '/home/rc', project: id, workdir: `/data/projects/${id}`,
  workspace: null, name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null, bucket: 'idle', bucketSince: null,
});

describe('GET /api/fleet/health', () => {
  it('local mode reports connected with no downSince, regardless of fleetState', async () => {
    const app = await buildServer(testDeps());
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'local', connected: true, downSince: null });
    await app.close();
  });

  it('remote mode + connected fleetState reports connected', async () => {
    const app = await buildServer(remoteDeps({}, { connected: true, downSince: null, ccdVerbs: null }));
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
    expect(res.json()).toEqual({ mode: 'remote', connected: true, downSince: null });
    await app.close();
  });

  it('remote mode + disconnected fleetState surfaces connected:false and downSince', async () => {
    const app = await buildServer(remoteDeps({}, { connected: false, downSince: 1700000000000, ccdVerbs: null }));
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
    expect(res.json()).toEqual({ mode: 'remote', connected: false, downSince: 1700000000000 });
    await app.close();
  });
});

describe('GET /api/fleet — degraded mode', () => {
  it('serves the cached snapshot with stale:true + downSince when disconnected', async () => {
    const dir = mkTmp('ccrc-cache-');
    const cachePath = path.join(dir, 'state-cache.json');
    const cachedSessions = [session('claude-Cached')];
    await saveSnapshot(cachedSessions, cachePath);

    const deps = remoteDeps({}, { connected: false, downSince: 1700000000000, ccdVerbs: null }, cachePath);
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessions: cachedSessions, stale: true, downSince: 1700000000000 });
    await app.close();
  });

  it('falls back to a live assemble (no stale flag) when disconnected but no cache exists yet', async () => {
    const dir = mkTmp('ccrc-cache-');
    const cachePath = path.join(dir, 'never-written.json');
    const deps = remoteDeps({}, { connected: false, downSince: Date.now(), ccdVerbs: null }, cachePath);
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.json()).toEqual({ sessions: [] });
    await app.close();
  });

  it('serves a cache written by an OLDER build with pr/archivedAt/tasks as null', async () => {
    // The whole point of the degraded route is that this file survives a server
    // upgrade. What it serves is what the PWA renders, and `archivedAt: undefined`
    // on the wire is `archivedAt !== null` — every workspace reads as archived.
    const dir = mkTmp('ccrc-cache-');
    const cachePath = path.join(dir, 'state-cache.json');
    writeFileSync(cachePath, JSON.stringify({
      savedAt: 1785300000001,
      sessions: [{
        id: 'claude-Cached', wrapper: 'claude', home: '/home/rc', project: 'claude-Cached',
        workdir: '/data/projects/claude-Cached', workspace: null, name: null, status: 'idle',
        statusUpdatedAt: null, limits: null, dialogPending: false, version: null,
        model: null, effort: null, ultracode: false, branch: null,
      }],
    }));

    const deps = remoteDeps({}, { connected: false, downSince: 1700000000000, ccdVerbs: null }, cachePath);
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    const body = res.json() as { sessions: FleetSession[]; stale: boolean; downSince: number };
    // Task 5's own additions predate this cache too — same degrade-to-null as
    // pr/archivedAt/tasks, and `session('claude-Cached')` below already
    // expects them null, so this is the explicit form of that same claim.
    expect(body.sessions[0]?.hookState).toBeNull();
    expect(body.sessions[0]?.askSummary).toBeNull();
    expect(body.sessions[0]?.subagents).toBeNull();
    expect(body).toEqual({
      sessions: [session('claude-Cached')],
      stale: true,
      downSince: 1700000000000,
    });
    await app.close();
  });

  it('ignores the cache and assembles live when connected', async () => {
    const dir = mkTmp('ccrc-cache-');
    const cachePath = path.join(dir, 'state-cache.json');
    await saveSnapshot([session('claude-Stale')], cachePath);

    const deps = remoteDeps({}, { connected: true, downSince: null, ccdVerbs: null }, cachePath);
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.json()).toEqual({ sessions: [] });
    await app.close();
  });
});

describe('POST /api/fleet/reboot', () => {
  it('409s when the fleet is local', async () => {
    const app = await buildServer(testDeps());
    const res = await app.inject({ method: 'POST', url: '/api/fleet/reboot' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-remote' });
    await app.close();
  });

  it('501s in remote mode with no Hetzner token/server id configured', async () => {
    const app = await buildServer(remoteDeps({}, { connected: false, downSince: 1, ccdVerbs: null }));
    const res = await app.inject({ method: 'POST', url: '/api/fleet/reboot' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
    await app.close();
  });

  it('202s and POSTs the Hetzner reboot action when configured and the API accepts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(
      remoteDeps(
        { CCRC_HETZNER_TOKEN: 'hetzner-secret', CCRC_FLEET_SERVER_ID: '12345' },
        { connected: false, downSince: 1, ccdVerbs: null },
      ),
    );
    const res = await app.inject({ method: 'POST', url: '/api/fleet/reboot' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.hetzner.cloud/v1/servers/12345/actions/reboot');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer hetzner-secret');
    await app.close();
  });

  it('502s when the Hetzner API rejects the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(
      remoteDeps(
        { CCRC_HETZNER_TOKEN: 'bad-token', CCRC_FLEET_SERVER_ID: '12345' },
        { connected: false, downSince: 1, ccdVerbs: null },
      ),
    );
    const res = await app.inject({ method: 'POST', url: '/api/fleet/reboot' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, error: 'hetzner-error' });
    await app.close();
  });

  it('502s when the Hetzner fetch itself throws (network error)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(
      remoteDeps(
        { CCRC_HETZNER_TOKEN: 'token', CCRC_FLEET_SERVER_ID: '12345' },
        { connected: false, downSince: 1, ccdVerbs: null },
      ),
    );
    const res = await app.inject({ method: 'POST', url: '/api/fleet/reboot' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, error: 'hetzner-error' });
    await app.close();
  });
});
