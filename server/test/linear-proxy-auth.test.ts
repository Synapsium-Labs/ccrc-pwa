// The Linear proxy's token and identity checks (#1444, spec §6.2, §14 row 5; plan task LK9; R2): exactly as the
// mail path's, UNCONDITIONAL, in each route's own `onRequest`. Every row runs twice, with `CCRC_AUTH` off (`main`'s
// default) and armed, through `buildServer`, so the gate, the EXEMPT table, the outer limiter and `attributionVerdict`
// over the fixture registry are the real ones. A refusal is answered before any Linear call (the stand-in records
// none) and before any journal row.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { LINEAR_VERBS } from '../src/linear/ops.js';
import { LINEAR_PROXY_ROUTES } from '../src/linear/proxyRoutes.js';
import { callsIn, sourceOfSymbol, symbolOf } from './scan/symbols.js';
import { bodyOf, PROXY_TOKEN, proxyMethod, proxyRig, proxyUrl, seedSlot, who, type ProxyRig } from './linearProxyRig.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';

let rig: ProxyRig | null = null;
afterEach(async () => { await rig?.close(); rig = null; });

/** A rig on a box with the sign-in gate as `armed` says, a passphrase file so an armed box can mint a cookie, and one
 *  learned workspace slot. */
async function open(armed: boolean): Promise<ProxyRig> {
  rig = await proxyRig({ authEnabled: armed });
  await seedSlot(rig.ccrcDir, 'a');
  mkdirSync(rig.ccrcDir, { recursive: true });
  writeFileSync(path.join(rig.ccrcDir, 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  return rig;
}

const expectNothingReached = (r: ProxyRig): void => {
  expect(r.calls, 'a refused call reached Linear').toEqual([]);
  expect(r.rows(), 'a refused call wrote a journal row').toEqual([]);
};

describe.each([false, true])('CCRC_AUTH %s: the box token and the identity, in onRequest, before anything else', (armed) => {
  it.each([...LINEAR_VERBS])('%s refuses no token, a wrong token, an unknown sender and a stale uuid', async (verb) => {
    const r = await open(armed);
    const none = await r.call(verb, { token: null });
    expect([none.statusCode, bodyOf(none)['error']], 'no token').toEqual([401, 'unauthenticated']);
    expect(bodyOf(none), 'the route answered, not the gate').not.toHaveProperty('verdict');
    const wrong = await r.call(verb, { token: 'f'.repeat(64) });
    expect([wrong.statusCode, bodyOf(wrong)['error']], 'wrong token').toEqual([401, 'unauthenticated']);
    const unknown = await r.call(verb, { as: who('project-a-no-such') });
    expect([unknown.statusCode, bodyOf(unknown)['error']], 'unknown sender').toEqual([403, 'unknown-sender']);
    const stale = await r.call(verb, { as: { id: 'project-a-calm-mesa', uuid: 'u-somebody-else' } });
    expect([stale.statusCode, bodyOf(stale)['error']], 'stale uuid').toEqual([403, 'stale-uuid']);
    expectNothingReached(r);
    // …and the same call with the pair the registry vouches for gets past every one of them.
    const ok = await r.call(verb);
    expect(ok.statusCode, `${verb} ${ok.body}`).toBe(200);
  });

  it('a session cookie and no token is refused like no token: the cookie is never the credential', async () => {
    const r = await open(armed);
    let cookie = 'ccrc_session=not-a-session';
    if (armed) {
      const login = await r.app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
      expect(login.statusCode, login.body).toBe(204);
      const set = login.headers['set-cookie'];
      const line = Array.isArray(set) ? set[0]! : String(set);
      cookie = line.slice(0, line.indexOf(';'));
      // The cookie is live: a gated read answers with it.
      expect((await r.app.inject({ method: 'GET', url: '/api/fleet/health', headers: { cookie } })).statusCode).not.toBe(401);
    }
    for (const verb of LINEAR_VERBS) {
      const res = await r.call(verb, { token: null, headers: { cookie } });
      expect([res.statusCode, bodyOf(res)['error']], verb).toEqual([401, 'unauthenticated']);
    }
    expectNothingReached(r);
  });

  it('the identity is read from the query: a POST with none there and a valid-looking byId in its body is bad-request', async () => {
    const r = await open(armed);
    for (const verb of LINEAR_VERBS.filter((v) => proxyMethod(v) === 'POST')) {
      const res = await r.call(verb, { as: null, body: { byId: 'project-a-calm-mesa', byUuid: 'u-project-a-calm-mesa' } });
      expect([res.statusCode, bodyOf(res)['error'], bodyOf(res)['detail']], verb).toEqual([400, 'bad-request', 'byId']);
    }
    for (const verb of LINEAR_VERBS.filter((v) => proxyMethod(v) === 'GET')) {
      const res = await r.call(verb, { as: null });
      expect([res.statusCode, bodyOf(res)['error']], verb).toEqual([400, 'bad-request']);
    }
    expectNothingReached(r);
  });

  it('a repeated byId, a byId outside SAFE_RE and a missing byUuid are each bad-request', async () => {
    const r = await open(armed);
    const qs = (s: string): string => s;
    for (const [rawQuery, field] of [
      [qs('byId=project-a-calm-mesa&byId=project-a-calm-mesa&byUuid=u-project-a-calm-mesa'), 'byId'],
      [qs('byId=project-a%2Fcalm&byUuid=u-project-a-calm-mesa'), 'byId'],
      [qs('byId=project-a-calm-mesa'), 'byUuid'],
      [qs('byId=project-a-calm-mesa&byUuid=u-project-a-calm-mesa&byUuid=u-x'), 'byUuid'],
    ] as const) {
      const res = await r.call('issue', { rawQuery });
      expect([res.statusCode, bodyOf(res)['error'], bodyOf(res)['detail']], rawQuery).toEqual([400, 'bad-request', field]);
    }
    expectNothingReached(r);
  });

  it('the token is checked before the body is parsed: a broken JSON body with no token is unauthenticated', async () => {
    const r = await open(armed);
    const res = await r.app.inject({
      method: 'POST', url: `${proxyUrl('comment')}?byId=project-a-calm-mesa&byUuid=u-project-a-calm-mesa`,
      headers: { 'content-type': 'application/json' }, payload: '{"body": ',
    });
    expect([res.statusCode, bodyOf(res)['error']]).toEqual([401, 'unauthenticated']);
    expectNothingReached(r);
  });

  it('1201 tokenless calls to one route spend nothing of its limiter: a tokened call still succeeds', async () => {
    const r = await open(armed);
    for (let i = 0; i < 1201; i += 1) {
      const res = await r.call('teams', { token: null });
      if (res.statusCode !== 401) throw new Error(`tokenless call ${i} answered ${res.statusCode}`);
    }
    const ok = await r.call('teams');
    expect(ok.statusCode, ok.body).toBe(200);
  }, 120_000);
});

describe('every route\'s onRequest holds the token check, and nothing in the file reads the flag or a cookie', () => {
  // Keyed on the parsed calls and symbols (`scan/symbols.ts`), never on the file's text: the census follows the code.
  const PROXY = 'server/src/linear/proxyRoutes.ts';
  const calls = callsIn(symbolOf(PROXY, 'registerLinearProxyRoutes'));
  const registrations = calls.filter((c) => c.callee === 'app.get' || c.callee === 'app.post');
  const tokenChecks = calls.filter((c) => c.name === 'checkMailToken');

  it('twelve registrations, each passing its own token verdict, for its own lane, to the options that build onRequest', () => {
    expect(registrations.map((r) => `${r.name!.toUpperCase()} ${r.args[0]!.text}`).sort()).toEqual(Object.values(LINEAR_PROXY_ROUTES).sort());
    expect(tokenChecks, 'a token check outside the twelve registrations').toHaveLength(12);
    for (const r of registrations) {
      const key = `${r.name!.toUpperCase()} ${r.args[0]!.text}`;
      const own = tokenChecks.filter((t) => t.start >= r.start && t.end <= r.end);
      expect(own, `${key} has no token check of its own`).toHaveLength(1);
      const lane = own[0]!.args.map((a) => a.text);
      expect(lane.slice(0, 2)).toEqual(['deps.mailToken()', 'req.headers[MAIL_TOKEN_HEADER]']);
      const verb = /^LINEAR_PROXY_ROUTES\.([a-z]+)$/.exec(lane[2] ?? '')?.[1];
      expect(verb === undefined ? null : LINEAR_PROXY_ROUTES[verb as keyof typeof LINEAR_PROXY_ROUTES], `${key} names another route's lane`).toBe(key);
      expect(r.args[1]!.text.startsWith('opts(('), `${key}'s check is not its options' token verdict`).toBe(true);
    }
  });

  it('the options put that verdict, and the identity check, in onRequest, and the limiter in config (it runs on preHandler)', () => {
    const optsCalls = callsIn(symbolOf(PROXY, 'registerLinearProxyRoutes.opts'));
    expect(optsCalls.filter((c) => c.name === 'admit').map((c) => c.args.map((a) => a.text))).toEqual([['reply', 'verdict(req)', 'req.query']]);
    expect(sourceOfSymbol(PROXY, 'registerLinearProxyRoutes.opts')).toMatch(/onRequest: async \(req: FastifyRequest, reply: FastifyReply\) => admit\(/);
    expect(sourceOfSymbol(PROXY, 'registerLinearProxyRoutes.opts')).toMatch(/config: \{ rateLimit: LINEAR_PROXY_RATE_LIMIT \}/);
  });

  it('the routes\' code never reads authEnabled, a session or a cookie (its comments say why not)', () => {
    for (const name of ['registerLinearProxyRoutes', 'identityOf', 'callRefusal', 'slotTeams']) {
      const code = sourceOfSymbol(PROXY, name).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, name).not.toMatch(/authEnabled|sessionAuth|cookie/i);
    }
  });
});

describe('a server never given a box token fails shut', () => {
  it.each([false, true])('CCRC_AUTH %s: every route answers unauthenticated, whatever token is presented', async (armed) => {
    rig = await proxyRig({ authEnabled: armed, mailToken: null });
    await seedSlot(rig.ccrcDir, 'a');
    for (const verb of LINEAR_VERBS) {
      for (const token of [null, PROXY_TOKEN]) {
        const res = await rig.call(verb, { token });
        expect([res.statusCode, bodyOf(res)['error']], `${verb} ${String(token)}`).toEqual([401, 'unauthenticated']);
      }
    }
    expectNothingReached(rig);
  });
});
