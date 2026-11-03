// N2 `auth-url-allowlist` (D-7792; spec §3.8; accounts plan Task A21): what the operator is asked to open is validated
// by the server. The status file is writable by any fleet-user process, so `GET /api/accounts/:id/auth` answers it only
// when it echoes the server's attempt, its URL is https on a host and path in the method's EXACT lists (OA1b's record:
// `login` and `setup-token` at `claude.com/cai/oauth/authorize`; the Codex host unmeasured, so none), and, for a method
// that shows a device code, that code matches its shape. The answer is then masked, and one the mask changed is refused.
// Anything else ends the attempt with `auth-url-untrusted`, an audit row and no URL. The host label is the server's
// parse of the URL, never the file's text.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTH_URL_HOSTS, authCodeShapeOk, authUrlVerdict,
} from '../../shared/accounts.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { authAnswerMasked, authStatusVerdictOf } from '../src/accounts/attempts.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import {
  CODE, LANE, LOGIN_URL, LOGIN_URL_B64, fresh, get, iso, openAuthApp, startAttempt, type AuthRig,
} from './authRouteRig.js';

let rig: AuthRig | undefined;
afterEach(async () => { if (rig) await rig.app.close(); rig = undefined; });

const ATTEMPT = 'a21'.repeat(10) + 'ab';
const A = { attemptId: ATTEMPT, method: 'login' as const, expiresAt: 1_000 };
/** An Anthropic-shaped token, assembled so no fixture spells one (the egress suite's rule). */
const PLANTED = ['sk', 'ant', 'oat01', 'A21x'.repeat(24)].join('-');
const mask = <T>(v: T): T => SHAPE_ONLY_MASKER.maskDeep(v);
const FILE = (over: Record<string, unknown> = {}) => ({ state: 'waiting-code', updatedAt: '2026-11-01T21:00:00Z', attemptId: ATTEMPT, url: LOGIN_URL, ...over });

describe('the URL check (pure)', () => {
  it('accepts the measured login URL, and answers the host the parser read', () => {
    expect(authUrlVerdict(LOGIN_URL, 'login')).toEqual({ href: new URL(LOGIN_URL).href, host: 'claude.com' });
    expect(authUrlVerdict(LOGIN_URL, 'setup-token')?.host).toBe('claude.com');
  });

  it('matches the host exactly, never by suffix or prefix', () => {
    for (const host of ['evilclaude.com', 'claude.com.example.invalid', 'sub.claude.com', 'claude.co', 'claude.ai', 'xn--claude-0ta.com', 'claude.com.']) {
      expect(authUrlVerdict(`https://${host}/cai/oauth/authorize`, 'login'), host).toBeNull();
    }
  });

  it('refuses http, another scheme, credentials in the URL, an explicit port, spaces and controls, and an over-long URL', () => {
    for (const bad of [
      'http://claude.com/cai/oauth/authorize', 'javascript:alert(1)//claude.com', `https://user:pw${'@'}claude.com/x`,
      `https://evil.example.invalid${'@'}claude.com/x`, 'https://claude.com:8443/x', 'https://claude.com/a b', 'https://claude.com/\nx',
      `https://claude.com/${'x'.repeat(4096)}`, '', 'not a url', 42, null,
    ]) {
      expect(authUrlVerdict(bad, 'login'), JSON.stringify(bad).slice(0, 60)).toBeNull();
    }
  });

  it('matches the measured path exactly, and refuses a fragment', () => {
    for (const bad of [
      'https://claude.com/anything?leak=x', 'https://claude.com/', 'https://claude.com/cai/oauth/authorize/',
      'https://claude.com/cai/oauth/authorize/../x', 'https://claude.com/cai/oauth/authorize#x', 'https://claude.com/cai/oauth/authorize#',
      `${LOGIN_URL}#frag`,
    ]) {
      expect(authUrlVerdict(bad, 'login'), bad).toBeNull();
    }
    expect(authUrlVerdict(LOGIN_URL_B64, 'login')?.host).toBe('claude.com');
  });

  it('the Codex host is unmeasured (OA1b), so no URL is accepted for it, and PKCE never reads one from the file', () => {
    expect(AUTH_URL_HOSTS['openai-login']).toEqual([]);
    expect(authUrlVerdict('https://auth.openai.com/codex/device', 'openai-login')).toBeNull();
    expect(authUrlVerdict('https://openrouter.ai/auth?code_challenge=x', 'openrouter-pkce')).toBeNull();
  });

  it('the code shapes: login as measured, setup-token on the spec\'s provisional shape, and none for a device sign-in', () => {
    expect(authCodeShapeOk(CODE, 'login')).toBe(true);
    expect(authCodeShapeOk(CODE.slice(1), 'login')).toBe(false);
    expect(authCodeShapeOk(CODE.replace('#', '$'), 'login')).toBe(false);
    expect(authCodeShapeOk(`${CODE}\n`, 'login')).toBe(false);
    expect(authCodeShapeOk(CODE, 'setup-token')).toBe(true);
    expect(authCodeShapeOk('short', 'setup-token')).toBe(false);
    expect(authCodeShapeOk(CODE, 'openai-login')).toBe(false);
  });
});

describe('the status file verdict (pure)', () => {
  it('answers a trusted file with the parsed URL and host, and the server\'s deadline', () => {
    expect(authStatusVerdictOf(FILE(), A)).toEqual({
      kind: 'ok', answer: { ok: true, state: 'waiting-code', url: new URL(LOGIN_URL).href, host: 'claude.com', updatedAt: Date.parse('2026-11-01T21:00:00Z'), expiresAt: 1_000 },
    });
  });

  it('refuses a file that names another attempt, or none', () => {
    expect(authStatusVerdictOf(FILE({ attemptId: 'f'.repeat(32) }), A)).toEqual({ kind: 'untrusted', why: 'attempt' });
    const { attemptId: _, ...none } = FILE();
    expect(authStatusVerdictOf(none, A)).toEqual({ kind: 'untrusted', why: 'attempt' });
  });

  it('refuses a state off the helper\'s vocabulary, a bad updatedAt, and a foreign URL even beside a terminal state', () => {
    expect(authStatusVerdictOf(FILE({ state: 'open-this' }), A)).toEqual({ kind: 'untrusted', why: 'state' });
    expect(authStatusVerdictOf(FILE({ updatedAt: 'soon' }), A)).toEqual({ kind: 'untrusted', why: 'updated-at' });
    expect(authStatusVerdictOf(FILE({ state: 'done', url: 'https://evilclaude.com/x' }), A)).toEqual({ kind: 'untrusted', why: 'url' });
  });

  it('drops a userCode unread for a method with no device code, refuses one off its shape for a device sign-in, and keeps the URL out of a state the operator does not act on', () => {
    // The helper's device-code scan reads every line, so a run of the authorize URL's own parameters can reach the
    // file as `userCode`: for `login` and `setup-token` it is never read and never answered.
    for (const method of ['login', 'setup-token'] as const) {
      const v = authStatusVerdictOf(FILE({ url: LOGIN_URL_B64, userCode: 'Q7ZK-W3XA' }), { ...A, method });
      expect(v.kind === 'ok' && v.answer, method).toMatchObject({ ok: true, state: 'waiting-code', host: 'claude.com' });
      expect(v.kind === 'ok' && 'userCode' in v.answer, method).toBe(false);
    }
    // The Codex device code is unmeasured, so a device sign-in's `userCode` has no shape it can match.
    const { url: _u, ...noUrl } = FILE({ userCode: 'ABCD-1234' });
    expect(authStatusVerdictOf(noUrl, { ...A, method: 'openai-login' })).toEqual({ kind: 'untrusted', why: 'user-code' });
    const done = authStatusVerdictOf(FILE({ state: 'done' }), A);
    expect(done.kind === 'ok' && done.answer).toEqual({ ok: true, state: 'done', updatedAt: Date.parse('2026-11-01T21:00:00Z'), expiresAt: 1_000 });
  });

  it('a failure crosses as its code word only, never a sentence', () => {
    const word = authStatusVerdictOf(FILE({ state: 'failed', error: 'token-unverified' }), A);
    expect(word.kind === 'ok' && word.answer.failure).toBe('token-unverified');
    const sentence = authStatusVerdictOf(FILE({ state: 'failed', error: 'claude auth login exited 1 at /home/x' }), A);
    expect(sentence.kind === 'ok' && 'failure' in sentence.answer).toBe(false);
  });
});

describe('the answer mask (pure; D-5513, D-5995)', () => {
  it('passes a genuine authorize URL as it is, base64url challenge and state included', () => {
    const v = authStatusVerdictOf(FILE({ url: LOGIN_URL_B64 }), A);
    expect(v.kind).toBe('ok');
    if (v.kind === 'ok') expect(authAnswerMasked(v.answer, mask)).toEqual(v.answer);
  });

  it('refuses an answer the mask changed: a token planted in the query, which N2 does not read', () => {
    const url = `https://claude.com/cai/oauth/authorize?code=true&leak=${PLANTED}`;
    const v = authStatusVerdictOf(FILE({ url }), A);
    expect(v.kind).toBe('ok');
    if (v.kind === 'ok') expect(authAnswerMasked(v.answer, mask)).toBeNull();
  });
});

describe('GET /api/accounts/:id/auth validates before it answers (N2)', () => {
  const open = async () => {
    rig = await openAuthApp();
    const cookie = await fresh(rig.app);
    const a = await startAttempt(rig, cookie);
    return { r: rig, cookie, a };
  };
  const expectEnded = (r: AuthRig, attemptId: string, before: number): void => {
    expect(r.calls.slice(before)).toEqual(['auth-cancel']);
    expect(r.argv().at(-1)).toBe(`account auth-cancel --id=${LANE} --attempt=${attemptId}`);
    expect(r.rows.map((x) => [x.act, x.outcome, x.code])).toContainEqual(['auth-url-untrusted', 'refused', 'auth-url-untrusted']);
  };

  it('a status file rewritten mid-attempt to a foreign host refuses auth-url-untrusted with no URL in the answer', async () => {
    const { r, cookie, a } = await open();
    r.status({ state: 'waiting-code', updatedAt: iso(Date.now()), attemptId: a.attemptId, url: LOGIN_URL });
    const ok = await get(r, `/api/accounts/${LANE}/auth`, cookie);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, state: 'waiting-code', host: 'claude.com', url: new URL(LOGIN_URL).href, expiresAt: a.expiresAt });
    const before = r.calls.length;
    const phish = LOGIN_URL.replace('https://claude.com/', 'https://evilclaude.com/');
    r.status({ state: 'waiting-code', updatedAt: iso(Date.now()), attemptId: a.attemptId, url: phish });
    const res = await get(r, `/api/accounts/${LANE}/auth`, cookie);
    expect(res.statusCode).toBe(REFUSAL_STATUS['auth-url-untrusted']);
    expect(res.json()).toEqual({ ok: false, error: 'auth-url-untrusted' });
    expect(res.body.includes('evilclaude')).toBe(false);
    expectEnded(r, a.attemptId, before);
    // The attempt is over: the next poll finds none, and a code for it is refused.
    expect((await get(r, `/api/accounts/${LANE}/auth`, cookie)).json()).toEqual({ ok: false, error: 'no-auth-attempt' });
  });

  it('a different attemptId refuses the same way', async () => {
    const { r, cookie, a } = await open();
    const before = r.calls.length;
    r.status({ state: 'waiting-code', updatedAt: iso(Date.now()), attemptId: 'e'.repeat(32), url: LOGIN_URL });
    const res = await get(r, `/api/accounts/${LANE}/auth`, cookie);
    expect(res.json()).toEqual({ ok: false, error: 'auth-url-untrusted' });
    expect(res.json()).not.toHaveProperty('url');
    expect(res.json()).not.toHaveProperty('host');
    expectEnded(r, a.attemptId, before);
  });

  it('an `http://` URL on an allowed host is refused', async () => {
    const { r, cookie, a } = await open();
    const before = r.calls.length;
    r.status({ state: 'url', updatedAt: iso(Date.now()), attemptId: a.attemptId, url: LOGIN_URL.replace('https:', 'http:') });
    const res = await get(r, `/api/accounts/${LANE}/auth`, cookie);
    expect(res.json()).toEqual({ ok: false, error: 'auth-url-untrusted' });
    expectEnded(r, a.attemptId, before);
  });

  it('a sign-in by code whose file carries a `userCode` the helper caught in the URL goes on, and the code is not answered', async () => {
    const { r, cookie, a } = await open();
    // The helper's scan publishes the first `XXXX-XXXX` run of any line, the authorize URL's line included.
    r.status({ state: 'waiting-code', updatedAt: iso(Date.now()), attemptId: a.attemptId, url: LOGIN_URL_B64, userCode: 'Q7ZK-W3XA' });
    const res = await get(r, `/api/accounts/${LANE}/auth`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, state: 'waiting-code', host: 'claude.com', url: new URL(LOGIN_URL_B64).href });
    expect(res.json()).not.toHaveProperty('userCode');
    expect(r.calls).toEqual(['auth-start']);
    expect(r.rows.map((x) => x.act)).not.toContain('auth-url-untrusted');
  });

  it('a credential planted in the URL\'s query refuses auth-url-untrusted, and never crosses', async () => {
    const { r, cookie, a } = await open();
    const before = r.calls.length;
    r.status({ state: 'waiting-code', updatedAt: iso(Date.now()), attemptId: a.attemptId, url: `${LOGIN_URL}&leak=${PLANTED}` });
    const res = await get(r, `/api/accounts/${LANE}/auth`, cookie);
    expect(res.statusCode).toBe(REFUSAL_STATUS['auth-url-untrusted']);
    expect(res.json()).toEqual({ ok: false, error: 'auth-url-untrusted' });
    expect(res.body.includes('A21xA21x')).toBe(false);
    expectEnded(r, a.attemptId, before);
  });

  it('the review\'s measured URL (another path, the token in the query and the fragment) is refused', async () => {
    const { r, cookie, a } = await open();
    const before = r.calls.length;
    r.status({ state: 'url', updatedAt: iso(Date.now()), attemptId: a.attemptId, url: `https://claude.com/anything?leak=${PLANTED}#${PLANTED}` });
    const res = await get(r, `/api/accounts/${LANE}/auth`, cookie);
    expect(res.json()).toEqual({ ok: false, error: 'auth-url-untrusted' });
    expect(res.body.includes('A21xA21x')).toBe(false);
    expectEnded(r, a.attemptId, before);
  });

  it('the host label comes from the parsed URL', async () => {
    const { r, cookie, a } = await open();
    // The file spells the host in capitals with the default port: the parser's host is `claude.com`, and that is the
    // label, never the file's `CLAUDE.com:443`.
    r.status({ state: 'waiting-code', updatedAt: iso(Date.now()), attemptId: a.attemptId, url: LOGIN_URL.replace('https://claude.com/', 'https://CLAUDE.com:443/') });
    const res = await get(r, `/api/accounts/${LANE}/auth`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()['host']).toBe('claude.com');
    expect((res.json()['url'] as string).startsWith('https://claude.com/cai/oauth/authorize?')).toBe(true);
  });

  it('a status file the server cannot read is not a rewrite: the attempt stands and the next poll reads again', async () => {
    const { r, cookie, a } = await open();
    const res = await get(r, `/api/accounts/${LANE}/auth`, cookie);
    expect(res.json()).toEqual({ ok: false, error: 'unmeasured' });
    r.status({ state: 'starting', updatedAt: iso(Date.now()), attemptId: a.attemptId });
    expect((await get(r, `/api/accounts/${LANE}/auth`, cookie)).json()).toMatchObject({ ok: true, state: 'starting' });
    expect(r.calls).toEqual(['auth-start']);
  });

  it('the Codex sign-in, whose host is unmeasured, refuses method-unmeasured and starts nothing', async () => {
    rig = await openAuthApp();
    const cookie = await fresh(rig.app);
    const res = await rig.app.inject({ method: 'POST', url: `/api/accounts/${LANE}/auth/start`, headers: { cookie }, payload: { method: 'openai-login' } });
    expect(res.statusCode).toBe(REFUSAL_STATUS['method-unmeasured']);
    expect(res.json()).toEqual({ ok: false, error: 'method-unmeasured' });
    expect(rig.calls).toEqual([]);
    expect(rig.rows.map((x) => [x.act, x.outcome, x.code, x.method])).toEqual([['auth-start', 'refused', 'method-unmeasured', 'openai-login']]);
  });
});
