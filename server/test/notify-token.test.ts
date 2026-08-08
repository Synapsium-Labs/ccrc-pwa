// Three states, and the middle one is the whole operator ruling: a fleet host
// still running yesterday's notify.sh must not go dark the moment the server
// deploys. Absent is ACCEPTED and LOGGED; wrong is 401; right is 200.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const post = (app: FastifyInstance, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/notify', headers,
               payload: { message: 'cc swap: x moved a -> b' } });

describe('POST /api/notify with a box token', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; vi.restoreAllMocks(); });

  it('accepts the right token', async () => {
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: TOKEN });
    expect((await post(app, { 'x-ccrc-mail-token': TOKEN })).statusCode).toBe(200);
  });

  it('refuses a WRONG token — a caller that presents one has no rollout excuse', async () => {
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: TOKEN });
    const res = await post(app, { 'x-ccrc-mail-token': 'nope' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('accepts an ABSENT token for one deploy generation, and says so in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: TOKEN });
    expect((await post(app)).statusCode).toBe(200);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/legacy/);
  });

  it('still fans the notice out on the bus when it accepts', async () => {
    const bus = new Bus();
    const seen: string[] = [];
    bus.on('notice', (n) => seen.push(n.message));
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: TOKEN }, bus);
    await post(app, { 'x-ccrc-mail-token': TOKEN });
    expect(seen).toEqual(['cc swap: x moved a -> b']);
  });

  it('accepts everything, unauthenticated, when no token is configured', async () => {
    // A box that has never been given a token must not lose its swap notices.
    app = await buildServer(testDeps(mkTmp('ccrc-')));
    expect((await post(app)).statusCode).toBe(200);
  });
});
