// The sign-in routes (spec §3.7, §6.2, §9, §13.1; D-5514, N5; accounts plan Task A21, D-7793): the attempt the server
// generates and keeps in memory, the code relayed once by the session that started it, the cancel, the expiry, the node
// an attempt is bound to, `LaneWire.authAttempt`, and N5's sign-out act. The rig (`authRouteRig.ts`) is the real server
// over a stub `ccrc` launcher; the status file is written by the test, as the helper would.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { AUTH_HELPER_BOUND_MS } from '../../shared/accounts.js';
import type { AccountsResponse } from '../../shared/api.js';
import { MAIL_TOKEN_HEADER } from '../src/coord/token.js';
import {
  BOX_TOKEN, CODE, LANE, LOGIN_URL, NODE, OTHER_NODE, T0, fresh, get, iso, login, openAuthApp, post, startAttempt, type AuthRig,
} from './authRouteRig.js';

let rig: AuthRig | undefined;
afterEach(async () => { vi.restoreAllMocks(); if (rig) await rig.app.close(); rig = undefined; });

const open = async (o: Parameters<typeof openAuthApp>[0] = {}): Promise<AuthRig> => { rig = await openAuthApp(o); return rig; };
const lanesOf = async (r: AuthRig, cookie: string): Promise<NonNullable<AccountsResponse['lanes']>> => {
  const res = await get(r, '/api/accounts', cookie);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as AccountsResponse).lanes!;
};
const sendCode = (r: AuthRig, cookie: string, attemptId: string, code = CODE) =>
  post(r, `/api/accounts/${LANE}/auth/code`, { attemptId, code }, cookie);

/** Every sign-in route, with a body it would act on (the attempt id is filled in where one is running). */
const ROUTES = [
  { name: 'start', method: 'POST', url: `/api/accounts/${LANE}/auth/start`, body: { method: 'login' }, stepUp: true },
  { name: 'status', method: 'GET', url: `/api/accounts/${LANE}/auth`, body: undefined, stepUp: false },
  { name: 'code', method: 'POST', url: `/api/accounts/${LANE}/auth/code`, body: { attemptId: 'a'.repeat(32), code: CODE }, stepUp: false },
  { name: 'cancel', method: 'POST', url: `/api/accounts/${LANE}/auth/cancel`, body: { attemptId: 'a'.repeat(32) }, stepUp: false },
] as const;
const ask = (r: AuthRig, route: (typeof ROUTES)[number], cookie?: string, extra: Record<string, string> = {}) =>
  r.app.inject({ method: route.method, url: route.url, ...(route.body ? { payload: route.body } : {}), headers: { ...(cookie ? { cookie } : {}), ...extra } });

describe('every sign-in route takes the account gate first, on account-auth-v1 (D-5511, N4)', () => {
  it.each(ROUTES)('$name refuses a box token, and runs nothing', async (route) => {
    const r = await open();
    expect((await ask(r, route, undefined, { [MAIL_TOKEN_HEADER]: BOX_TOKEN })).statusCode).toBe(401);
    expect(r.calls).toEqual([]);
  });

  it.each(ROUTES)('$name refuses a dark gate with auth-off and no-store, and runs nothing', async (route) => {
    const r = await open({ enabled: false });
    const res = await ask(r, route);
    expect(res.json()).toMatchObject({ ok: false, error: 'auth-off' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(r.calls).toEqual([]);
  });

  it.each(ROUTES)('$name refuses a fleet that advertises account-v2 and not account-auth-v1, and runs nothing', async (route) => {
    const r = await open({ caps: ['account-v2'] });
    const res = await ask(r, route, await fresh(r.app));
    expect(res.json()).toMatchObject({ ok: false, error: 'unsupported' });
    expect(r.calls).toEqual([]);
  });

  it('start refuses a stale step-up, runs nothing and writes no row; the other three ask none', async () => {
    const r = await open();
    const cookie = await login(r.app);
    const res = await ask(r, ROUTES[0], cookie);
    expect(res.json()).toMatchObject({ ok: false, error: 'step-up-required' });
    expect(r.calls).toEqual([]);
    expect(r.rows).toEqual([]);
    for (const route of ROUTES.slice(1)) {
      const other = await ask(r, route, cookie);
      expect(other.json(), route.name).toMatchObject({ ok: false, error: 'no-auth-attempt' });
    }
  });
});

describe('POST /api/accounts/:id/auth/start (spec §3.5, §3.7)', () => {
  it('generates a 32-hex attempt, passes it on the argv, and answers the helper\'s 600 s bound as the one deadline', async () => {
    const r = await open();
    const a = await startAttempt(r, await fresh(r.app));
    expect(a.attemptId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.expiresAt).toBe(T0 + AUTH_HELPER_BOUND_MS);
    expect(r.argv()).toEqual([`account auth-start --id=${LANE} --method=login --attempt=${a.attemptId}`]);
    expect(r.rows.map((x) => [x.act, x.outcome, x.method])).toEqual([['auth-start', 'ok', 'login']]);
  });

  it('a second start while one is live refuses auth-in-progress and runs nothing', async () => {
    const r = await open();
    const cookie = await fresh(r.app);
    await startAttempt(r, cookie);
    const res = await post(r, `/api/accounts/${LANE}/auth/start`, { method: 'setup-token' }, cookie);
    expect(res.json()).toEqual({ ok: false, error: 'auth-in-progress' });
    expect(r.calls).toEqual(['auth-start']);
  });

  it('refuses a method off the list, an extra key, and openrouter-pkce (its own wave), before any op', async () => {
    const r = await open();
    const cookie = await fresh(r.app);
    for (const body of [{ method: 'paste' }, { method: 'login', id: 'x' }, {}]) {
      expect((await post(r, `/api/accounts/${LANE}/auth/start`, body, cookie)).json(), JSON.stringify(body)).toEqual({ ok: false, error: 'bad-request' });
    }
    expect((await post(r, `/api/accounts/${LANE}/auth/start`, { method: 'openrouter-pkce' }, cookie)).json()).toEqual({ ok: false, error: 'unsupported' });
    expect(r.calls).toEqual([]);
  });

  it('a node that cannot sign in crosses as auth-unsupported-here with its reason, never the sentence', async () => {
    const r = await open();
    r.stub('auth-start', { out: { ok: false, error: 'auth-unsupported-here', reason: 'darwin-arm-absent', detail: 'macOS at /Users/x' }, code: 1 });
    const res = await post(r, `/api/accounts/${LANE}/auth/start`, { method: 'login' }, await fresh(r.app));
    expect(res.statusCode).toBe(REFUSAL_STATUS['auth-unsupported-here']);
    expect(res.json()).toEqual({ ok: false, error: 'auth-unsupported-here', reason: 'darwin-arm-absent' });
  });

  it('an answer that does not name the attempt is outcome-unknown, and the attempt is kept so the sheet can poll it', async () => {
    const r = await open();
    r.stub('auth-start', { out: { ok: true, id: LANE, attemptId: 'b'.repeat(32), state: 'starting', fleetIdentity: NODE } });
    const cookie = await fresh(r.app);
    const res = await post(r, `/api/accounts/${LANE}/auth/start`, { method: 'login' }, cookie);
    expect(res.statusCode).toBe(REFUSAL_STATUS['outcome-unknown']);
    const body = res.json() as { attemptId: string; expiresAt: number };
    expect(body).toMatchObject({ ok: false, error: 'outcome-unknown', expiresAt: T0 + AUTH_HELPER_BOUND_MS });
    r.status({ state: 'starting', updatedAt: iso(T0), attemptId: body.attemptId });
    expect((await get(r, `/api/accounts/${LANE}/auth`, cookie)).json()).toMatchObject({ ok: true, state: 'starting' });
  });
});

describe('POST /api/accounts/:id/auth/code: the same session, once, by shape (spec §3.7, D-5514)', () => {
  it('session B\'s code for session A\'s attempt is refused', async () => {
    const r = await open();
    const a = await startAttempt(r, await fresh(r.app));
    const b = await fresh(r.app);
    const res = await sendCode(r, b, a.attemptId);
    expect(res.statusCode).toBe(REFUSAL_STATUS['not-your-attempt']);
    expect(res.json()).toEqual({ ok: false, error: 'not-your-attempt' });
    expect(r.calls).toEqual(['auth-start']);
    expect(r.rows.at(-1)).toMatchObject({ act: 'auth-code', outcome: 'refused', code: 'not-your-attempt' });
  });

  it('the code is in no log, audit row or answer, and the audit says `auth-code ok`', async () => {
    const r = await open();
    const out: string[] = [];
    const keep = (...x: unknown[]): void => { out.push(x.map(String).join(' ')); };
    for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) vi.spyOn(console, m).mockImplementation(keep);
    const cookie = await fresh(r.app);
    const a = await startAttempt(r, cookie);
    // A refusal whose sentence quotes the code: only the word crosses.
    r.stub('auth-code', { out: { ok: false, error: 'bad-code', detail: `the code ${CODE} was refused` }, code: 2 });
    const no = await sendCode(r, cookie, a.attemptId);
    expect(no.json()).toEqual({ ok: false, error: 'bad-code' });
    r.stub('auth-code', { out: { ok: true, id: LANE, attemptId: '@ATTEMPT@', sent: true, fleetIdentity: NODE }, code: 0 });
    const yes = await sendCode(r, cookie, a.attemptId);
    expect(yes.statusCode, yes.body).toBe(200);
    expect(yes.json()).toEqual({ ok: true });
    for (const text of [no.body, yes.body, JSON.stringify(r.rows), r.argv().join('\n'), out.join('\n')]) {
      expect(text.includes(CODE)).toBe(false);
      expect(text.includes(CODE.slice(0, 20))).toBe(false);
    }
    expect(r.argv().filter((l) => l.startsWith('account auth-code'))).toEqual([
      `account auth-code --id=${LANE} --attempt=${a.attemptId}`, `account auth-code --id=${LANE} --attempt=${a.attemptId}`,
    ]);
    expect(r.rows.filter((x) => x.act === 'auth-code').map((x) => [x.outcome, x.code])).toEqual([['refused', 'bad-code'], ['ok', undefined]]);
  });

  it('one code per attempt: a second is refused code-already-sent, and runs nothing', async () => {
    const r = await open();
    const cookie = await fresh(r.app);
    const a = await startAttempt(r, cookie);
    expect((await sendCode(r, cookie, a.attemptId)).statusCode).toBe(200);
    const again = await sendCode(r, cookie, a.attemptId);
    expect(again.json()).toEqual({ ok: false, error: 'code-already-sent' });
    expect(r.calls.filter((c) => c === 'auth-code')).toHaveLength(1);
  });

  it('a code off its method\'s shape refuses bad-code at the route, runs nothing, and the attempt still takes a good one', async () => {
    const r = await open();
    const cookie = await fresh(r.app);
    const a = await startAttempt(r, cookie);
    for (const bad of [CODE.slice(2), `${CODE}\n`, `${CODE.slice(0, 48)}#${'x'.repeat(42)}\u0000`, '']) {
      expect((await sendCode(r, cookie, a.attemptId, bad)).json()).toEqual({ ok: false, error: 'bad-code' });
    }
    expect(r.calls).toEqual(['auth-start']);
    expect((await sendCode(r, cookie, a.attemptId)).statusCode).toBe(200);
  });

  it('a code for another attempt id, or for none, refuses no-auth-attempt', async () => {
    const r = await open();
    const cookie = await fresh(r.app);
    expect((await sendCode(r, cookie, 'c'.repeat(32))).json()).toEqual({ ok: false, error: 'no-auth-attempt' });
    await startAttempt(r, cookie);
    expect((await sendCode(r, cookie, 'c'.repeat(32))).json()).toEqual({ ok: false, error: 'no-auth-attempt' });
    expect(r.calls).toEqual(['auth-start']);
  });
});

describe('`LaneWire.authAttempt` (spec §6.2\'s resume)', () => {
  it('`mine` is true only for the starting session', async () => {
    const r = await open();
    const starter = await fresh(r.app);
    const other = await fresh(r.app);
    expect((await lanesOf(r, starter))[LANE]?.authAttempt).toBeUndefined();
    const a = await startAttempt(r, starter);
    expect((await lanesOf(r, starter))[LANE]?.authAttempt).toEqual({ state: 'starting', expiresAt: a.expiresAt, mine: true });
    expect((await lanesOf(r, other))[LANE]?.authAttempt).toEqual({ state: 'starting', expiresAt: a.expiresAt, mine: false });
    // The state is the last one the server read.
    r.status({ state: 'waiting-code', updatedAt: iso(T0), attemptId: a.attemptId, url: LOGIN_URL });
    await get(r, `/api/accounts/${LANE}/auth`, starter);
    expect((await lanesOf(r, other))[LANE]?.authAttempt).toEqual({ state: 'waiting-code', expiresAt: a.expiresAt, mine: false });
  });
});

describe('the node an attempt started on (spec §13.2)', () => {
  it('a node change mid-attempt is refused', async () => {
    const r = await open();
    const cookie = await fresh(r.app);
    const a = await startAttempt(r, cookie);
    r.node.id = OTHER_NODE;
    const code = await sendCode(r, cookie, a.attemptId);
    expect(code.statusCode).toBe(REFUSAL_STATUS['node-changed']);
    expect(code.json()).toEqual({ ok: false, error: 'node-changed' });
    // The code never reached the other node.
    expect(r.calls).toEqual(['auth-start']);
    expect((await get(r, `/api/accounts/${LANE}/auth`, cookie)).json()).toEqual({ ok: false, error: 'node-changed' });
  });

  it('a start answered by a node other than the one asked is refused, and the attempt is cancelled', async () => {
    const r = await open();
    r.stub('auth-start', { out: { ok: true, id: LANE, attemptId: '@ATTEMPT@', state: 'starting', fleetIdentity: OTHER_NODE } });
    const res = await post(r, `/api/accounts/${LANE}/auth/start`, { method: 'login' }, await fresh(r.app));
    expect(res.json()).toEqual({ ok: false, error: 'node-changed' });
    expect(r.calls).toEqual(['auth-start', 'auth-cancel']);
  });
});

describe('cancel and expiry (spec §3.7, §6.2)', () => {
  it('cancel stops the attempt at the box, and the next poll finds none', async () => {
    const r = await open();
    const cookie = await fresh(r.app);
    const a = await startAttempt(r, cookie);
    const res = await post(r, `/api/accounts/${LANE}/auth/cancel`, { attemptId: a.attemptId }, cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(r.argv().at(-1)).toBe(`account auth-cancel --id=${LANE} --attempt=${a.attemptId}`);
    expect((await get(r, `/api/accounts/${LANE}/auth`, cookie)).json()).toEqual({ ok: false, error: 'no-auth-attempt' });
  });

  it('a cancel the box could not carry out leaves the attempt standing, so it can be cancelled again', async () => {
    const r = await open();
    const cookie = await fresh(r.app);
    const a = await startAttempt(r, cookie);
    r.stub('auth-cancel', { out: { ok: false, error: 'auth-cancel-failed', detail: 'no manager' }, code: 1 });
    const res = await post(r, `/api/accounts/${LANE}/auth/cancel`, { attemptId: a.attemptId }, cookie);
    expect(res.json()).toEqual({ ok: false, error: 'lane-act-refused', verbCode: 'auth-cancel-failed' });
    expect((await lanesOf(r, cookie))[LANE]?.authAttempt?.mine).toBe(true);
  });

  it('at expiresAt the server issues auth-cancel itself, and forgets the attempt', async () => {
    const r = await open();
    const cookie = await fresh(r.app);
    const a = await startAttempt(r, cookie);
    r.clock.advance(AUTH_HELPER_BOUND_MS - 1);
    expect(r.calls).toEqual(['auth-start']);
    r.clock.advance(1);
    await vi.waitFor(() => expect(r.rows.map((x) => x.act)).toContain('auth-cancel'));
    expect(r.argv().at(-1)).toBe(`account auth-cancel --id=${LANE} --attempt=${a.attemptId}`);
    expect(r.rows.find((x) => x.act === 'auth-cancel')?.actor.toString()).toBe('ccrc server 00000000');
    expect((await get(r, `/api/accounts/${LANE}/auth`, cookie)).json()).toEqual({ ok: false, error: 'no-auth-attempt' });
    expect((await lanesOf(r, cookie))[LANE]?.authAttempt).toBeUndefined();
  });

  it('an attempt the server saw end is not cancelled at its expiry', async () => {
    const r = await open();
    const cookie = await fresh(r.app);
    const a = await startAttempt(r, cookie);
    r.status({ state: 'done', updatedAt: iso(T0), attemptId: a.attemptId });
    expect((await get(r, `/api/accounts/${LANE}/auth`, cookie)).json()).toMatchObject({ ok: true, state: 'done' });
    r.clock.advance(AUTH_HELPER_BOUND_MS);
    expect(r.calls).toEqual(['auth-start']);
  });
});

describe('N5\'s sign-out act: `POST /api/accounts/:id/credential {signOut: true}` (D-7749)', () => {
  it('runs `credential --sign-out` behind a fresh step-up, and answers what the box found', async () => {
    const r = await open();
    r.stub('credential', { out: { ok: true, id: LANE, signOut: 'removed', fleetIdentity: NODE } });
    const stale = await login(r.app);
    expect((await post(r, `/api/accounts/${LANE}/credential`, { signOut: true }, stale)).json()).toMatchObject({ error: 'step-up-required' });
    expect(r.calls).toEqual([]);
    const res = await post(r, `/api/accounts/${LANE}/credential`, { signOut: true }, await fresh(r.app));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, signOut: 'removed' });
    expect(res.json()).toHaveProperty('lane');
    expect(r.argv()).toEqual([`account credential --id=${LANE} --sign-out`]);
    expect(r.rows.map((x) => [x.act, x.outcome])).toEqual([['credential', 'ok']]);
  });

  it('refuses a lane that is not a sign-in lane with its word, and a body that mixes the two forms as a bad request', async () => {
    const r = await open();
    r.stub('credential', { out: { ok: false, error: 'not-a-sign-in-lane', detail: 'x' }, code: 1 });
    const cookie = await fresh(r.app);
    expect((await post(r, `/api/accounts/${LANE}/credential`, { signOut: true }, cookie)).json()).toEqual({ ok: false, error: 'not-a-sign-in-lane' });
    expect((await post(r, `/api/accounts/${LANE}/credential`, { signOut: true, credential: 'x' }, cookie)).json()).toEqual({ ok: false, error: 'bad-request' });
    expect((await post(r, `/api/accounts/${LANE}/credential`, { signOut: 'yes' }, cookie)).json()).toEqual({ ok: false, error: 'bad-request' });
    expect(r.calls).toEqual(['credential']);
  });
});
