// Right is 200; wrong, absent and unconfigured are 401. Absent used to be
// ACCEPTED and LOGGED for a one-deploy-generation rollout window (a fleet host
// still running yesterday's notify.sh); the box-token lifecycle removed that
// tolerance and the unconfigured pass-through with it (spec 4.3), so this
// route fails shut like every other box-token lane.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { BoxTokenHolder } from '../src/coord/token.js';
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: TOKEN });
    const res = await post(app, { 'x-ccrc-mail-token': 'nope' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, error: 'unauthenticated' });
    // Fix-round finding: `Fastify({ logger: false })` plus a bare 401 left
    // ZERO server-side signal that a refusal ever happened — the only arm of
    // the gate that logged anything was `legacy`, the benign one. This is the
    // arm an operator actually needs to see.
    expect(warn.mock.calls.flat().join(' ')).toMatch(/refused|401|WRONG/i);
  });

  it('a REJECTED notify never reaches the bus or the session stream — the negative half of the ' +
     'property this task exists to establish', async () => {
    // The task's whole point (server.ts's own comment on this route: "an
    // unauthenticated caller's body is not worth parsing") is that a forged
    // body must not get regex-routed into a session's chat stream. The
    // positive direction ("still fans the notice out … when it accepts",
    // above) was pinned; nothing pinned that a WRONG token gets NONE of that
    // fan-out. A future refactor that hoists `bus.emit` above the token check
    // — e.g. to record every inbound notice before authenticating — would
    // leave every case above green while an unauthenticated tailnet caller's
    // forged `cc swap:` line surfaced inside a real session's chat.
    const bus = new Bus();
    const noticed: string[] = [];
    const sessionMsgs: unknown[] = [];
    bus.on('notice', (n) => noticed.push(n.message));
    bus.on('session:x', (m) => sessionMsgs.push(m));
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: TOKEN }, bus);
    const res = await post(app, { 'x-ccrc-mail-token': 'nope' });
    expect(res.statusCode).toBe(401);
    expect(noticed).toEqual([]);
    expect(sessionMsgs).toEqual([]);
  });

  it('refuses an ABSENT token — the rollout tolerance is gone (box-token lifecycle, spec 4.3)', async () => {
    // It used to be accepted and logged as `legacy`. The server now mints its own
    // token at boot and the fleet file is written for it, so the state the
    // tolerance bridged no longer exists, and a tokenless notify is a caller
    // with no credential at all.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bus = new Bus();
    const noticed: string[] = [];
    bus.on('notice', (n) => noticed.push(n.message));
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: TOKEN }, bus);
    const res = await post(app);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, error: 'unauthenticated' });
    expect(noticed).toEqual([]);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/NO box token \(401\)/);
  });

  it('still fans the notice out on the bus when it accepts', async () => {
    const bus = new Bus();
    const seen: string[] = [];
    bus.on('notice', (n) => seen.push(n.message));
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: TOKEN }, bus);
    await post(app, { 'x-ccrc-mail-token': TOKEN });
    expect(seen).toEqual(['cc swap: x moved a -> b']);
  });

  it('refuses every caller when no token is configured — unconfigured fails shut like every lane', async () => {
    // It used to accept everything here. A server with no current value is now
    // one whose boot mint failed, and every box-token lane answers 401 there.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await buildServer(testDeps(mkTmp('ccrc-')));
    expect((await post(app)).statusCode).toBe(401);
    expect((await post(app, { 'x-ccrc-mail-token': TOKEN })).statusCode).toBe(401);
  });

  it('a holder with no current value refuses the same way as no token', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: new BoxTokenHolder() });
    expect((await post(app, { 'x-ccrc-mail-token': TOKEN })).statusCode).toBe(401);
  });
});
