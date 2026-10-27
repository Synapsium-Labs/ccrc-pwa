// codex-bridge-errors.test.ts — the bridge's error table, `ccd/codexbridge/errors.py` (codex-bridge Stage 2 plan
// 2026-10-22, Task 1 and "The bridge's contract": the error table; spec 2026-10-15 §2.4; D-6411..D-6415).
//
// Each row is asserted twice: BEFORE the commit point, as the real HTTP answer (`http_answer`: status, headers,
// Anthropic error body), and AFTER it, as the `error` event (`event`), which never carries a `message_stop`. Every
// case runs through `runBridgeDriver` with both endpoint variables at a closed loopback URL; nothing makes a request.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { pythonOrSkip } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
import { CCD_DIR, driverLines, runBridgeDriver } from './codexBridgeFixture.js';

/** Stage 1's credential library in this tree, which the driver's `auth-lib` op loads by path. */
const AUTH_LIB = path.join(CCD_DIR, 'ccgpt-auth.py');

const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

const NOW = 1_800_000_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Line = Record<string, any>;

async function run(ops: object[]): Promise<Line[]> {
  const home = mkTmp('cb-err-');
  const r = await runBridgeDriver(home, { ops });
  expect(r.timedOut, r.stderr).toBe(false);
  const lines = driverLines(r.stdout);
  expect(lines.map((l) => l.op), `${r.stdout}\n${r.stderr}`).toEqual(ops.map((o) => (o as { op: string }).op));
  for (const l of lines) expect(l.raised, JSON.stringify(l)).toBeUndefined();
  return lines;
}

const http = (status: number, body: unknown, headers: Record<string, string> = {}): object => ({
  op: 'classify-http', status, body: typeof body === 'string' ? body : JSON.stringify(body), headers, now: NOW,
});
const failed = (error: unknown): object => ({ op: 'classify-failed', error, now: NOW });

/** One row, before and after commit. `headers` is the exact set the answer adds to its content-type. */
function expectRow(l: Line, want: { status: number; etype: string; headers?: Record<string, string>; state?: string | null }): void {
  const e = l.error;
  expect(e.status, JSON.stringify(l)).toBe(want.status);
  expect(e.etype, JSON.stringify(l)).toBe(want.etype);
  expect(e.state, JSON.stringify(l)).toBe(want.state ?? null);
  expect(e.headers, JSON.stringify(l)).toEqual(want.headers ?? {});
  // before commit: a real status with the Anthropic error body
  expect(l.answer.status).toBe(want.status);
  expect(l.answer.headers).toEqual({ 'content-type': 'application/json', ...(want.headers ?? {}) });
  expect(l.answer.body).toEqual({ type: 'error', error: { type: want.etype, message: e.message } });
  // after commit: an `error` event with the same type and message, and no message_stop
  const ev = l.event as string;
  expect(ev.startsWith('event: error\ndata: ')).toBe(true);
  expect(ev.endsWith('\n\n')).toBe(true);
  expect(JSON.parse(ev.slice('event: error\ndata: '.length).trim())).toEqual({ type: 'error', error: { type: want.etype, message: e.message } });
  expect(ev).not.toContain('message_stop');
}

const OVERFLOW_MSG = 'Your input exceeds the context window of this model. Please adjust your input and try again.';
const QUOTA = [
  'insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
];
const POLICY = ['cyber_policy', 'bio_policy', 'invalid_prompt', 'misalignment_policy_violation'];
const DEAD = ['needs-signin', 'not-logged-in', 'config-error', 'foreign-family', 'credential-unusable', 'auth-endpoint-refused'];
const TRANSIENT = ['refresh-failed', 'auth-lock-busy'];

describe.skipIf(!PY)('the error table (codex-bridge spec §2.4)', () => {
  it('context_length_exceeded is the exact prompt-too-long text', async () => {
    const [ov, fail, http400, http400code] = await run([
      { op: 'overflow', n: 450000, m: 405000 },
      failed({ code: 'context_length_exceeded', message: OVERFLOW_MSG }),
      http(400, { error: { message: OVERFLOW_MSG, type: 'invalid_request_error', param: 'input', code: null } }),
      http(400, { error: { code: 'context_length_exceeded', message: 'x' } }),
    ]);
    expect(ov.error.message).toBe('prompt is too long: 450000 tokens > 405000 maximum');
    expectRow(ov, { status: 400, etype: 'invalid_request_error' });
    expect(ov.error.kind).toBe('overflow');
    for (const l of [fail, http400, http400code]) {
      expectRow(l, { status: 400, etype: 'invalid_request_error' });
      expect(l.error.kind, JSON.stringify(l)).toBe('overflow');
      expect(l.error.code).toBe('context_length_exceeded');
      expect(l.error.message.toLowerCase().startsWith('prompt is too long')).toBe(true);
    }
  });

  it('usage_limit_reached is 429 billing_error with retry-after and x-should-retry false, state limit-paused', async () => {
    const body = (extra: object): object => ({ error: { type: 'usage_limit_reached', message: 'limit', plan_type: 'plus', ...extra } });
    const [withReset, without] = await run([
      http(429, body({ resets_at: NOW + 120 }), { 'x-request-id': 'req_fx1' }),
      http(429, body({})),
    ]);
    expectRow(withReset, { status: 429, etype: 'billing_error', headers: { 'retry-after': '120', 'x-should-retry': 'false' }, state: 'limit-paused' });
    expect(withReset.error.requestId).toBe('req_fx1');
    expect(withReset.error.code).toBe('usage_limit_reached');
    expectRow(without, { status: 429, etype: 'billing_error', headers: { 'x-should-retry': 'false' }, state: 'limit-paused' });
  });

  it('the usage limit\'s retry-after: resets_in_seconds when no resets_at; none when past, not a number or too large', async () => {
    const body = (extra: object): object => ({ error: { type: 'usage_limit_reached', message: 'limit', ...extra } });
    const lines = await run([
      http(429, body({ resets_in_seconds: 300 })),
      http(429, body({ resets_at: NOW - 5 })),
      http(429, body({ resets_in_seconds: true })),
      http(429, '{"error":{"type":"usage_limit_reached","resets_at":NaN}}'),
      http(429, '{"error":{"type":"usage_limit_reached","resets_at":Infinity}}'),
      http(429, `{"error":{"type":"usage_limit_reached","resets_at":1${'0'.repeat(400)}}}`),
    ]);
    const [inSeconds, ...none] = lines;
    expectRow(inSeconds, { status: 429, etype: 'billing_error', headers: { 'retry-after': '300', 'x-should-retry': 'false' }, state: 'limit-paused' });
    for (const l of none) {
      expectRow(l, { status: 429, etype: 'billing_error', headers: { 'x-should-retry': 'false' }, state: 'limit-paused' });
    }
  });

  it('each quota code is limit-paused', async () => {
    const [sets] = await run([{ op: 'sets' }]);
    expect(sets.QUOTA_CODES).toEqual([...QUOTA].sort());
    const lines = await run(QUOTA.flatMap((c) => [http(429, { error: { code: c, message: 'm' } }), failed({ code: c })]));
    for (const l of lines) {
      expectRow(l, { status: 429, etype: 'billing_error', headers: { 'x-should-retry': 'false' }, state: 'limit-paused' });
    }
  });

  it('rate_limit_exceeded and slow_down are 429 rate_limit_error, retry-after passed through, no x-should-retry', async () => {
    const [rate, slow, bare, bogus, rateFailed, slowFailed] = await run([
      http(429, { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached. Please try again in 7s.' } }, { 'retry-after': '7' }),
      http(503, { error: { code: 'slow_down', message: 'slow down' } }),
      http(429, '', { 'retry-after': '3' }),
      http(429, '', { 'retry-after': 'soon; rm -rf' }),
      failed({ code: 'rate_limit_exceeded', message: 'Rate limit reached.' }),
      failed({ code: 'slow_down' }),
    ]);
    expectRow(rate, { status: 429, etype: 'rate_limit_error', headers: { 'retry-after': '7' } });
    expectRow(slow, { status: 429, etype: 'rate_limit_error' });
    expectRow(bare, { status: 429, etype: 'rate_limit_error', headers: { 'retry-after': '3' } });
    expectRow(bogus, { status: 429, etype: 'rate_limit_error' });
    expectRow(rateFailed, { status: 429, etype: 'rate_limit_error' });
    expectRow(slowFailed, { status: 429, etype: 'rate_limit_error' });
  });

  it('usage_not_included is 403 permission_error, state ineligible', async () => {
    const lines = await run([http(403, { error: { code: 'usage_not_included', message: 'm' } }), failed({ code: 'usage_not_included' })]);
    for (const l of lines) expectRow(l, { status: 403, etype: 'permission_error', headers: { 'x-should-retry': 'false' }, state: 'ineligible' });
  });

  it('each policy code is 400 policy_blocked with x-should-retry false', async () => {
    const lines = await run(POLICY.flatMap((c) => [http(400, { error: { code: c, message: 'refused' } }), failed({ code: c })]));
    expect(lines).toHaveLength(8);
    for (const l of lines) expectRow(l, { status: 400, etype: 'policy_blocked', headers: { 'x-should-retry': 'false' } });
  });

  it('server_is_overloaded is 529', async () => {
    const lines = await run([
      http(503, { error: { code: 'server_is_overloaded', message: 'busy' } }),
      failed({ code: 'server_is_overloaded' }),
      http(503, { error: { code: 'flex_unavailable' } }),
      failed({ code: 'flex_unavailable' }),
    ]);
    for (const l of lines) expectRow(l, { status: 529, etype: 'overloaded_error' });
  });

  it('an unknown failed code, a 500 and a Cloudflare 403 are 503 api_error', async () => {
    const lines = await run([
      failed({ code: 'a_code_nobody_mapped', message: 'm' }),
      failed(null),
      { op: 'classify-failed', error: { message: 'no code at all' }, now: NOW },
      http(500, { error: { message: 'internal' } }),
      http(502, 'Bad Gateway'),
      http(403, '<html><head><title>Just a moment...</title></head><body>cloudflare</body></html>', { 'content-type': 'text/html' }),
    ]);
    for (const l of lines) {
      expectRow(l, { status: 503, etype: 'api_error' });
      expect(l.error.kind).toBe('unavailable');
    }
  });

  it('a 403 whose body is the backend\'s JSON, with no code, is the other-4xx row, not the edge\'s page', async () => {
    const lines = await run([http(403, { detail: 'Forbidden' }), http(403, { error: { message: 'm' } })]);
    for (const l of lines) {
      expectRow(l, { status: 403, etype: 'invalid_request_error' });
      expect(l.error.kind).toBe('refused');
    }
  });

  it('any other 4xx keeps its status as invalid_request_error, naming the upstream code only', async () => {
    const [notFound, noBody] = await run([
      http(404, { error: { code: 'model_not_found', message: 'The model does not exist' } }),
      http(422, ''),
    ]);
    expectRow(notFound, { status: 404, etype: 'invalid_request_error' });
    expect(notFound.error.message).toContain('model_not_found');
    expect(notFound.error.message).not.toContain('does not exist');
    expectRow(noBody, { status: 422, etype: 'invalid_request_error' });
  });

  it('an upstream 401 is 401 authentication_error with x-should-retry false', async () => {
    const [l] = await run([http(401, { error: { code: 'token_expired', message: 'm' } })]);
    expectRow(l, { status: 401, etype: 'authentication_error', headers: { 'x-should-retry': 'false' } });
  });

  it('a request feature the bridge does not map is capability_rejected: <class>', async () => {
    const [l] = await run([{ op: 'capability', cls: 'document_block', detail: 'messages[2].content[0]' }]);
    expectRow(l, { status: 400, etype: 'invalid_request_error' });
    expect(l.error.message.startsWith('capability_rejected: document_block')).toBe(true);
    expect(l.error.message).toContain('messages[2].content[0]');
  });

  it('no answer formats the upstream body', async () => {
    const S = 'SENTINEL-body-7f3a';
    const lines = await run([
      http(400, { error: { code: 'bad_thing', message: S, param: S } }),
      http(400, { error: { message: `${S} context window`, extra: S } }),
      http(429, { error: { type: 'usage_limit_reached', message: S, plan_type: S } }),
      http(500, `${S} internal`),
      http(404, { detail: S }),
      http(403, `<html>${S}</html>`),
      failed({ code: 'invalid_prompt', message: S }),
      failed({ code: 'unmapped_x', message: S }),
    ]);
    for (const l of lines) expect(JSON.stringify(l)).not.toContain(S);
  });

  it('event() is an error frame and never a message_stop', async () => {
    const [l] = await run([{ op: 'overflow', n: 10, m: 9 }]);
    expect(l.event).toBe(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 10 tokens > 9 maximum' } })}\n\n`);
  });

  it('a code outside CODE_RE is stored as unrecognised', async () => {
    const [spaced, long, upper] = await run([
      http(400, { error: { code: 'Not A Valid Code!', message: 'm' } }),
      http(400, { error: { code: 'x'.repeat(65) } }),
      failed({ code: 'Not A Valid Code!' }),
    ]);
    for (const l of [spaced, long, upper]) {
      expect(l.error.code).toBe('unrecognised');
      expect(JSON.stringify(l)).not.toContain('Not A Valid');
      expect(JSON.stringify(l)).not.toContain('x'.repeat(65));
    }
  });

  it('the upstream request id is kept from x-request-id, else request-id, and bounded', async () => {
    const [x, plain, bad, none] = await run([
      http(500, '', { 'x-request-id': 'req_fx2', 'request-id': 'req_fx3' }),
      http(500, '', { 'request-id': 'req_fx3' }),
      http(500, '', { 'x-request-id': 'has spaces and; more' }),
      http(500, ''),
    ]);
    expect(x.error.requestId).toBe('req_fx2');
    expect(plain.error.requestId).toBe('req_fx3');
    expect(bad.error.requestId).toBeNull();
    expect(none.error.requestId).toBeNull();
  });

  // The backend sends x-oai-request-id and neither of the other two (runbook step 2, 2026-10-27; D-7084), the name
  // Codex reads after x-request-id (openai/codex codex-rs/codex-api/src/api_bridge.rs at rust-v0.164.0,
  // extract_request_id). The first name present still decides, a malformed value under it included.
  it('the upstream request id falls back to x-oai-request-id when neither x-request-id nor request-id is sent, and x-request-id wins over it', async () => {
    const [oai, both, plainFirst, badFirst, badOai] = await run([
      http(500, '', { 'x-oai-request-id': 'oai-req-fx1' }),
      http(500, '', { 'x-oai-request-id': 'oai-req-fx1', 'x-request-id': 'req_fx2' }),
      http(500, '', { 'x-oai-request-id': 'oai-req-fx1', 'request-id': 'req_fx3' }),
      http(500, '', { 'x-oai-request-id': 'oai-req-fx1', 'x-request-id': 'has spaces and; more' }),
      http(500, '', { 'x-oai-request-id': 'has spaces and; more' }),
    ]);
    expect(oai.error.requestId).toBe('oai-req-fx1');
    expect(both.error.requestId).toBe('req_fx2');
    expect(plainFirst.error.requestId).toBe('req_fx3');
    expect(badFirst.error.requestId).toBeNull();
    expect(badOai.error.requestId).toBeNull();
  });

  it('header names are read case-insensitively from a plain mapping', async () => {
    const [l] = await run([http(429, '', { 'Retry-After': '5', 'X-Request-Id': 'req_fx4' })]);
    expectRow(l, { status: 429, etype: 'rate_limit_error', headers: { 'retry-after': '5' } });
    expect(l.error.requestId).toBe('req_fx4');
  });

  it('a top-level error event\'s type "error" is not read as its code', async () => {
    const [l] = await run([failed({ type: 'error', message: 'm' })]);
    expectRow(l, { status: 503, etype: 'api_error' });
    expect(l.error.code).toBeNull();
    expect(l.error.message).toContain('no code');
  });

  it('ALL_CODES is the union of the seven code sets, and the auth words are Stage 1\'s', async () => {
    const [sets] = await run([{ op: 'sets' }]);
    const seven = ['OVERFLOW_CODES', 'QUOTA_CODES', 'USAGE_LIMIT_TYPES', 'TRANSIENT_RATE_CODES', 'INELIGIBLE_CODES', 'POLICY_CODES', 'OVERLOAD_CODES'];
    const union = [...new Set(seven.flatMap((k) => sets[k] as string[]))].sort();
    expect(sets.ALL_CODES).toEqual(union);
    for (const k of seven) expect((sets[k] as string[]).length, k).toBeGreaterThan(0);
    expect(sets.POLICY_CODES).toEqual([...POLICY].sort());
    expect(sets.AUTH_DEAD_WORDS).toEqual([...DEAD].sort());
    expect(sets.AUTH_TRANSIENT_WORDS).toEqual([...TRANSIENT].sort());
  });

  it('the auth words are every AuthError word of Stage 1\'s library, login-failed the one the 401 row takes unnamed', async () => {
    const [sets, lib] = await run([{ op: 'sets' }, { op: 'auth-lib', lib: AUTH_LIB }]);
    const named = [...(sets.AUTH_DEAD_WORDS as string[]), ...(sets.AUTH_TRANSIENT_WORDS as string[]), 'login-failed'].sort();
    expect(lib.words).toEqual(named);
  });

  it('CODE_RE and REQUEST_ID_RE are Stage 1\'s bounds, copied from its library', async () => {
    const [sets, lib] = await run([{ op: 'sets' }, { op: 'auth-lib', lib: AUTH_LIB }]);
    expect(sets.CODE_RE).toBe(lib.CODE_RE);
    expect(sets.REQUEST_ID_RE).toBe(lib.REQUEST_ID_RE);
  });

  const SENTENCE = 'the lane is not signed in; run ccrc codex signin <id>';
  it.each([...DEAD, 'auth-library-absent', 'login-failed', ...TRANSIENT])('from_auth: %s', async (word) => {
    const [l] = await run([{ op: 'from-auth', word, sentence: SENTENCE }]);
    expect(l.error.message).toBe(`${word}: ${SENTENCE}`);
    if (TRANSIENT.includes(word)) expectRow(l, { status: 503, etype: 'api_error' });
    else expectRow(l, { status: 401, etype: 'authentication_error', headers: { 'x-should-retry': 'false' } });
  });
});
