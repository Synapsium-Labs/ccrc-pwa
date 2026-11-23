// Session helpers S2 (D-8874), review 3185 F3: the composition root's half of the pass's sign-in refusal. `delegation-backfill-route`
// pins the route's own check with an injected `signedIn`; this file builds the WHOLE server (`buildServer`, the real registration in
// `server.ts`, which measures `deps.cfg.authEnabled && sessionAuth(req).reason === 'session'`) and pins what that wiring answers with
// sign-in dark: the pass refuses `sign-in-unarmed` and writes nothing, while the undo, which needs no sign-in, gets past that check
// to the applier's own answer (no lane is open here, so `not-ready`). If the wiring answered "signed in" unconditionally, the pass would
// reach the applier too and answer `not-ready`, never `sign-in-unarmed`: so this case is red under that wiring.
// The gate's session verdict does not read the auth flag (`sessionVerdict` verifies a presented cookie either way), so W-2 pins the flag's
// half too: a cookie that verifies, presented while sign-in is dark, is still refused (and, armed, the same cookie gets past sign-in).
// A fixture HOME only (`testDeps` over a fresh temp directory); no watcher, so no delegation lane is opened and nothing live is read.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { SESSION_COOKIE } from '../src/auth/cookie.js';
import { SessionStore } from '../src/auth/sessions.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { DELEGATION_BACKFILL_FILE } from '../src/coord/delegation-backfill.js';
import { DELEGATION_CHECKPOINT_FILE } from '../src/coord/delegation-checkpoint.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const DOOR = '/api/coord/delegation-backfill';
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); });

const listing = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };

/** A fixture HOME with a sign-in secret and one session in its store, as `lane-models-audit` seeds one; the cookie that session verifies. */
async function withSession(): Promise<{ base: ReturnType<typeof testDeps>; cookie: string }> {
  const base = testDeps(mkTmp('ccrc-s2-wiring-session-'));
  const ccrc = base.cfg.ccrcDir;
  mkdirSync(ccrc, { recursive: true });
  writeFileSync(path.join(ccrc, 'auth.scrypt'), `${await hashLine('correct horse battery staple', FAST_PARAMS, 1)}\n`);
  const seeder = new SessionStore(path.join(ccrc, 'sessions.json'));
  await seeder.load();
  const { token } = await seeder.create('wiring phone', 1, Date.now());
  return { base, cookie: `${SESSION_COOKIE}=${token}` };
}

describe('the one-time pass behind the composition root, sign-in dark (review 3185 F3)', () => {
  it('W-1: with auth off, a valid pass body is refused sign-in-unarmed (403) and writes nothing; the undo gets past the sign-in check', async () => {
    const base = testDeps(mkTmp('ccrc-s2-wiring-'));
    const app = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: false } });
    apps.push(app);
    const ccrc = base.cfg.ccrcDir;
    const before = listing(ccrc);

    const pass = await app.inject({ method: 'POST', url: DOOR, payload: { act: 'pass', closes: 1 } });
    expect([pass.statusCode, pass.json().error], 'the real wiring measures sign-in dark: the pass is refused before the applier').toEqual([403, 'sign-in-unarmed']);
    expect(listing(ccrc), 'nothing written in the delegation directory').toEqual(before);
    expect(existsSync(path.join(ccrc, DELEGATION_BACKFILL_FILE)), 'no list').toBe(false);
    expect(existsSync(path.join(ccrc, DELEGATION_CHECKPOINT_FILE)), 'no checkpoint').toBe(false);

    // CONTROL: the same server, the same dark sign-in, the act that needs none. It is not refused by sign-in (nor by the global auth
    // gate, which is off), and answers the applier's own state: no lane open, so not-ready. So the 403 above is the pass's sign-in rule
    // as the composition root wires it, not a door that refuses everything.
    const undo = await app.inject({ method: 'POST', url: DOOR, payload: { act: 'undo' } });
    expect([undo.statusCode, undo.json().error]).toEqual([503, 'not-ready']);
  });

  it('W-2: with auth off, a pass carrying a session cookie that verifies is still refused sign-in-unarmed; armed, the same cookie gets past sign-in', async () => {
    const { base, cookie } = await withSession();
    const ccrc = base.cfg.ccrcDir;
    const dark = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: false } });
    apps.push(dark);
    const before = listing(ccrc);
    const pass = await dark.inject({ method: 'POST', url: DOOR, headers: { cookie }, payload: { act: 'pass', closes: 1 } });
    expect([pass.statusCode, pass.json().error], 'sign-in dark: a verifying cookie does not arm the pass').toEqual([403, 'sign-in-unarmed']);
    expect(listing(ccrc), 'nothing written').toEqual(before);

    // CONTROL: the cookie does verify. Armed, the same request passes the gate and the pass's sign-in check, and answers the applier's
    // own state (no lane open here): so W-2's refusal above is the auth flag's, not a cookie that never verified.
    await dark.close();
    apps.splice(apps.indexOf(dark), 1);
    const armed = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: true, cookieSecure: false } });
    apps.push(armed);
    const armedPass = await armed.inject({ method: 'POST', url: DOOR, headers: { cookie }, payload: { act: 'pass', closes: 1 } });
    expect([armedPass.statusCode, armedPass.json().error]).toEqual([503, 'not-ready']);
  });
});
