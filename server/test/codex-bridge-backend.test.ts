// codex-bridge-backend.test.ts — the backend adapter, `ccd/codexbridge/backend.py` (codex-bridge Stage 2 plan
// 2026-10-22, Task 7; spec 2026-10-15 §2.2 "the backend adapter targets today's route", §2.3 "No top-level
// `instructions`, so nothing outranks it", §2.4 "An upstream idle timeout of 300 s, as in Codex", D27 "Send
// `originator: ccrc`").
//
// Every case runs the package through `runBridgeDriver` in a mkTmp HOME. A request is built from an Anthropic body by
// the package's own `inbound.from_anthropic`, so no case spells a neutral request. The upstream is `fakeResponses`, an
// in-process server on 127.0.0.1, reached through CCGPT_BRIDGE_UPSTREAM_BASE; a case that needs no answer leaves that
// variable at CLOSED_AUTH_BASE. The bearer token is a synthetic JWT or a fixture string, and the fake records it only
// as a sha256.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { pythonOrSkip, runPy, runPyAsync } from './ccgptHarness.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';
import { AUTH_LIB, CLOSED_AUTH_BASE, FIXTURE_ACCOUNT_ID, plantBackendCredential } from './codexAuthFixture.js';
import { driverLines, fakeResponses, runBridgeDriver, type ResponsesAnswer } from './codexBridgeFixture.js';

const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Line = Record<string, any>;

/** Run `ops` in one driver process; every op must print its line, and none may raise unless `allowRaise`. */
async function run(
  ops: object[],
  o: { env?: Record<string, string>; home?: string; timeoutMs?: number; allowRaise?: boolean } = {},
): Promise<Line[]> {
  const r = await runBridgeDriver(o.home ?? mkTmp('cb-backend-'), { ops }, o.env ?? {}, { timeoutMs: o.timeoutMs ?? 10_000 });
  expect(r.timedOut, `${r.stdout}\n${r.stderr}`).toBe(false);
  const lines = driverLines(r.stdout);
  expect(lines.map((l) => l.op), `${r.stdout}\n${r.stderr}`).toEqual(ops.map((x) => (x as { op: string }).op));
  if (!o.allowRaise) for (const l of lines) expect(l.raised, JSON.stringify(l)).toBeUndefined();
  return lines;
}

/** One backend-post against a fake that answers `answers`; the op's line and what the fake recorded. */
async function post(
  answers: ResponsesAnswer[], op: Record<string, unknown>,
  o: { env?: Record<string, string>; home?: string; timeoutMs?: number } = {},
): Promise<{ line: Line; requests: Awaited<ReturnType<typeof fakeResponses>>['requests'] }> {
  const fake = await fakeResponses(answers);
  try {
    const [line] = await run([{ op: 'backend-post', token: 'tok-fixture-1', ...op }],
      { ...o, env: { ...(o.env ?? {}), CCGPT_BRIDGE_UPSTREAM_BASE: fake.base } });
    return { line, requests: fake.requests };
  } finally {
    await fake.close();
  }
}

const SYSTEM = 'You are the fixture system prompt.';
const USER = 'hello from the fixture';

/** A small Anthropic body: the billing line Claude Code prepends, the system text, one user turn. */
function anthropic(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: 'model-6.1-alpha',
    system: [
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=0.0.0; cc_entrypoint=cli' },
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: [{ type: 'text', text: USER }] }],
    stream: true,
    ...extra,
  };
}

const DEVELOPER_ITEM = { type: 'message', role: 'developer', content: [{ type: 'input_text', text: SYSTEM }] };

/** A short stream that ends in `response.completed`. */
const COMPLETED = [
  'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_fx1","output":[]}}\n\n',
  'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_fx1","output":[],'
    + '"usage":{"input_tokens":5,"output_tokens":1}}}\n\n',
].join('');

/** The body's keys in the order Codex writes them (upstream openai/codex @ 092d3ac,
 *  codex-rs/codex-api/src/common.rs:278-304), with `stream` moved up to second; `text` comes last when present. */
const ORDER = ['model', 'stream', 'input', 'tools', 'tool_choice', 'parallel_tool_calls', 'reasoning', 'store', 'include',
  'prompt_cache_key'];

/** Never sent on the backend route by this bridge (plan Task 7, `build_body`). */
const FORBIDDEN = ['instructions', 'max_output_tokens', 'temperature', 'top_p', 'user', 'metadata', 'previous_response_id',
  'truncation', 'text'];

describe.skipIf(!PY)('the backend adapter: the body (codex-bridge spec §2.2, §2.3)', () => {
  it('the body carries no instructions, and the developer message is input[0]', async () => {
    const { line, requests } = await post([{ status: 200, sse: COMPLETED }], { body: anthropic() });
    expect(line.status).toBe(200);
    expect(line.error).toBeNull();
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/responses');
    const body = req.body!;
    expect(Object.keys(body)).not.toContain('instructions');
    expect(body.input[0]).toEqual(DEVELOPER_ITEM);
    expect(body.input[1]).toEqual({ type: 'message', role: 'user', content: [{ type: 'input_text', text: USER }] });
    // ruling 2: Claude Code's text alone. No base prompt of the bridge's own (LiteLLM's is 7,572 characters), no lead
    // sentence telling the model to follow the developer message, and the billing line is gone.
    const wire = JSON.stringify(body);
    expect(wire.length).toBeLessThan(1000);
    expect(wire).not.toMatch(/follow/i);
    expect(wire).not.toContain('x-anthropic-billing-header');
    expect(body.input.filter((i: Line) => i.role === 'developer')).toHaveLength(1);
  });

  it('with the bridge-instructions marker, the system is instructions alone', async () => {
    const home = mkTmp('cb-backend-marker-');
    const laneDir = join(home, 'lane');
    mkdirSync(laneDir, { mode: 0o700 });
    const [consts, without] = await run([{ op: 'backend-consts' }, { op: 'backend-body', body: anthropic(), laneDir }],
      { home });
    expect(consts.INSTRUCTIONS_MARKER).toBe('bridge-instructions');
    expect(Object.keys(without.body)).not.toContain('instructions');
    expect(without.body.input[0]).toEqual(DEVELOPER_ITEM);

    writeFileSync(join(laneDir, 'bridge-instructions'), '');
    const [marked] = await run([{ op: 'backend-body', body: anthropic(), laneDir }], { home });
    expect(marked.body.instructions).toBe(SYSTEM);
    expect(marked.keys.slice(0, 3)).toEqual(['model', 'stream', 'instructions']);
    expect(marked.body.input).toEqual([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: USER }] }]);
    expect(marked.body.input.filter((i: Line) => i.role === 'developer')).toEqual([]);

    // with the marker and no system text there is nothing to send as instructions
    const [bare] = await run([{ op: 'backend-body', body: anthropic({ system: undefined }), laneDir }], { home });
    expect(Object.keys(bare.body)).not.toContain('instructions');
  });

  it('the forbidden keys are never sent', async () => {
    const body = anthropic({
      max_tokens: 32000, temperature: 0.5, top_p: 0.9, top_k: 5, metadata: { user_id: 'lane-a-user' },
      stop_sequences: ['STOP'], thinking: { type: 'enabled', budget_tokens: 1024 }, reasoning: { effort: 'high' },
    });
    const { requests } = await post([{ status: 200, sse: COMPLETED }], { body });
    const sent = requests[0].body!;
    for (const k of FORBIDDEN) expect(Object.keys(sent), k).not.toContain(k);
    expect(sent.reasoning).toEqual({ effort: 'high' });
    expect(JSON.stringify(sent)).not.toContain('32000');
  });

  it('the key order puts model and stream first', async () => {
    const { requests } = await post([{ status: 200, sse: COMPLETED }], { body: anthropic({ reasoning: { effort: 'high' } }) });
    const sent = requests[0].body!;
    const keys = Object.keys(sent);
    expect(keys.slice(0, 2)).toEqual(['model', 'stream']);
    expect(keys.filter((k) => ORDER.includes(k))).toEqual(ORDER);
    expect(sent.model).toBe('model-6.1-alpha');
    expect(sent.stream).toBe(true);
    expect(sent.store).toBe(false);
    expect(sent.include).toEqual(['reasoning.encrypted_content']);
    expect(sent.tool_choice).toBe('auto');
    expect(sent.parallel_tool_calls).toBe(true);
    expect(sent.tools).toEqual([]);
    // no effort: no reasoning key at all, and the rest keep their order
    const [plain] = await run([{ op: 'backend-body', body: anthropic() }]);
    expect(plain.keys).toEqual(ORDER.filter((k) => k !== 'reasoning'));
    expect(plain.wire.startsWith('{"model":"model-6.1-alpha","stream":true,')).toBe(true);
  });

  it('an output format is sent as text.format after prompt_cache_key, and no text key without one', async () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
    const outputConfig = { format: { type: 'json_schema', schema } };
    const [withFormat, translated, without] = await run([
      { op: 'backend-body', body: anthropic(), output_config: outputConfig },
      { op: 'from-anthropic', body: anthropic(), output_config: outputConfig },
      { op: 'backend-body', body: anthropic() },
    ]);
    expect(translated.request.output_format).toBeTruthy();
    expect(withFormat.body.text).toEqual({ format: translated.request.output_format });
    expect(Object.keys(withFormat.body.text)).toEqual(['format']);
    expect(withFormat.keys.slice(-2)).toEqual(['prompt_cache_key', 'text']);
    expect(without.keys).not.toContain('text');
  });
});

describe.skipIf(!PY)('the backend adapter: the headers (codex-bridge spec §2.2, D27)', () => {
  it('originator is ccrc and the user agent names ccrc', async () => {
    const [ua] = await run([{ op: 'backend-ua', version: '0.0.700' }]);
    const [system, release, machine] = ua.platform as string[];
    const clean = (s: string): string => s.replace(/[^\x20-\x7e]/g, '_');
    expect(ua.ua).toBe(clean(`ccrc/0.0.700 (codex-bridge; ${system} ${release}; ${machine})`));
    const [odd] = await run([{ op: 'backend-ua', version: 'v1\né\u0007' }]);
    expect(odd.ua.startsWith('ccrc/v1___ (codex-bridge; ')).toBe(true);
    expect(odd.ua).toMatch(/^[\x20-\x7e]+$/);

    const { requests } = await post([{ status: 200, sse: COMPLETED }], { body: anthropic(), version: '0.0.700' });
    const [req] = requests;
    expect(req.values.originator).toBe('ccrc');
    expect(req.values['user-agent']).toBe(ua.ua);
    expect(req.values['content-type']).toBe('application/json');
    expect(req.values.accept).toBe('text/event-stream');
    expect(req.values['accept-encoding']).toBe('identity');
    expect(req.headers).toContain('authorization');
    expect(req.authorizationSha256).toBe(createHash('sha256').update('Bearer tok-fixture-1').digest('hex'));
  });

  it('session-id carries the Claude Code session id and prompt_cache_key the cache key', async () => {
    const headers = { 'x-claude-code-session-id': 'sess-fx1', 'x-claude-code-agent-id': 'agent-fx1' };
    const [keys] = await run([{ op: 'inbound-keys', cache: [['sess-fx1', 'agent-fx1']] }]);
    const withSession = await post([{ status: 200, sse: COMPLETED }], { body: anthropic(), headers });
    const [req] = withSession.requests;
    expect(req.values['session-id']).toBe('sess-fx1');
    expect(req.headers.filter((h) => h === 'session-id')).toHaveLength(1);
    expect(req.body!.prompt_cache_key).toBe(keys.cache[0]);

    const none = await post([{ status: 200, sse: COMPLETED }], { body: anthropic() });
    expect(none.requests[0].headers).not.toContain('session-id');
    // with no session id the cache key is a fresh anonymous one (inbound.cache_key), never another session's
    expect(none.requests[0].body!.prompt_cache_key).toMatch(/^ccrc:anon-[0-9a-f-]{36}$/);
  });

  it("the account header is the credential's account id, never the lane id", async () => {
    const home = mkTmp('cb-backend-acct-');
    const authDir = join(home, 'auth');
    const planted = plantBackendCredential(authDir);
    const env = { CCGPT_ACCOUNT_ID: 'lane-a' };
    const { line, requests } = await post([{ status: 200, sse: COMPLETED }],
      { body: anthropic(), authDir, lib: AUTH_LIB }, { home, env });
    expect(line.error).toBeNull();
    const [req] = requests;
    expect(req.values['chatgpt-account-id']).toBe(FIXTURE_ACCOUNT_ID);
    expect(req.values['chatgpt-account-id']).not.toBe('lane-a');
    expect(req.authorizationSha256).toBe(createHash('sha256').update(`Bearer ${planted.access}`).digest('hex'));

    // a credential that names no account: the header is left out, never filled with the lane id
    const home2 = mkTmp('cb-backend-noacct-');
    const authDir2 = join(home2, 'auth');
    plantBackendCredential(authDir2, { accountId: null, claimAccountId: null });
    const second = await post([{ status: 200, sse: COMPLETED }],
      { body: anthropic(), authDir: authDir2, lib: AUTH_LIB }, { home: home2, env });
    expect(second.line.error).toBeNull();
    expect(second.requests[0].headers).not.toContain('chatgpt-account-id');
  });
});

describe.skipIf(!PY)('the backend adapter: the endpoint and the transport (codex-bridge spec §2.4)', () => {
  it('a non-loopback upstream base refuses at start', async () => {
    const [consts] = await run([{ op: 'backend-consts' }]);
    expect(consts.DEFAULT_BASE).toBe('https://chatgpt.com/backend-api/codex');
    expect(consts.RESPONSES_PATH).toBe('/responses');
    const accepted: Array<[Record<string, string>, string]> = [
      [{}, consts.DEFAULT_BASE],
      [{ CCGPT_BRIDGE_UPSTREAM_BASE: '' }, consts.DEFAULT_BASE],
      [{ CCGPT_BRIDGE_UPSTREAM_BASE: 'http://127.0.0.1:8080' }, 'http://127.0.0.1:8080'],
      [{ CCGPT_BRIDGE_UPSTREAM_BASE: 'http://localhost:9/base/' }, 'http://localhost:9/base'],
      [{ CCGPT_BRIDGE_UPSTREAM_BASE: 'http://[::1]:7' }, 'http://[::1]:7'],
    ];
    const refused = [
      'http://example.invalid', 'http://example.invalid:8080/x', 'https://127.0.0.1:8080', 'https://chatgpt.com/backend-api/codex',
      'http://127.0.0.1.example.invalid:9', 'http://user@127.0.0.1:9', 'http://127.0.0.1:99999', 'ftp://127.0.0.1:9',
      'http://127.0.0.1:9\n', 'http://localhost@example.invalid/', 'http://127.0.0.1:9?x=1',
    ];
    const lines = await run([
      ...accepted.map(([environ]) => ({ op: 'backend-base', environ })),
      ...refused.map((v) => ({ op: 'backend-base', environ: { CCGPT_BRIDGE_UPSTREAM_BASE: v } })),
    ], { allowRaise: true });
    accepted.forEach(([environ, want], i) => expect(lines[i], JSON.stringify(environ)).toEqual({ op: 'backend-base', base: want }));
    refused.forEach((v, i) => expect(lines[accepted.length + i], JSON.stringify(v)).toEqual({ op: 'backend-base', raised: 'ValueError' }));

    // at start: the process's own environment, as the server reads it
    const [atStart] = await run([{ op: 'backend-base' }], { env: { CCGPT_BRIDGE_UPSTREAM_BASE: 'http://example.invalid:9' }, allowRaise: true });
    expect(atStart.raised).toBe('ValueError');
  });

  it('an HTTP 429 usage_limit_reached body maps through the error table', async () => {
    const now = 1_900_000_000;
    const answer: ResponsesAnswer = {
      status: 429,
      headers: { 'x-request-id': 'req_fx1' },
      body: { error: { type: 'usage_limit_reached', message: 'fixture upstream words never shown', resets_at: now + 120 } },
    };
    const { line } = await post([answer], { body: anthropic(), now });
    expect(line.status).toBe(429);
    expect(line.timeout).toBeNull();
    const e = line.error;
    expect(e.error).toMatchObject({ status: 429, etype: 'billing_error', state: 'limit-paused', requestId: 'req_fx1',
      code: 'usage_limit_reached', kind: 'billing' });
    expect(e.answer.status).toBe(429);
    expect(e.answer.headers).toMatchObject({ 'retry-after': '120', 'x-should-retry': 'false' });
    expect(e.answer.body.type).toBe('error');
    expect(e.answer.body.error.type).toBe('billing_error');
    expect(JSON.stringify(e)).not.toContain('fixture upstream words');
  });

  it('a 300 s silence is the idle timeout', async () => {
    const [consts] = await run([{ op: 'backend-consts' }]);
    expect(consts.IDLE_TIMEOUT_S).toBe(300);
    const created = 'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_fx1","output":[]}}\n\n';
    const { line } = await post([{ status: 200, sse: { chunks: [created], holdOpenMs: 2000 } }],
      { body: anthropic(), idle_s: 0.3 });
    expect(line.status).toBe(200);
    expect(line.types).toEqual(['response.created']);
    expect(line.timeout).toBe('read');
    expect(line.elapsed).toBeLessThan(1.5);
  });

  it('a response head that never comes is the idle timeout', async () => {
    const [consts] = await run([{ op: 'backend-consts' }]);
    expect(consts.CONNECT_TIMEOUT_S).toBe(30);
    const { line } = await post([{ status: 200, sse: COMPLETED, holdHeadMs: 5000 }], { body: anthropic(), idle_s: 0.3 });
    expect(line.status).toBeNull();
    expect(line.timeout).toBe('head');
    expect(line.elapsed).toBeLessThan(2);
  });
});

describe.skipIf(!PY)('the contained environments name the bridge upstream (codex-bridge Stage 2, Task 7)', () => {
  // Unset or EMPTY, the adapter reads the live endpoint, so every contained env names a loopback one unless the
  // caller's own env names one (Stage 1's CCRC_CODEX_AUTH_BASE rule, `ccgpt-harness.test.ts`).
  it('every contained env names a loopback CCGPT_BRIDGE_UPSTREAM_BASE', async () => {
    const home = mkTmp('cb-backend-contained-');
    const mine = 'http://127.0.0.1:4243';
    const base = (e: NodeJS.ProcessEnv): string | undefined => e['CCGPT_BRIDGE_UPSTREAM_BASE'];
    for (const opts of [{}, { systemd: true }, { tmux: true, net: true }]) {
      expect(base(ghContainedEnv(home, {}, opts)), JSON.stringify(opts)).toBe(CLOSED_AUTH_BASE);
      expect(base(ghContainedEnv(home, { CCGPT_BRIDGE_UPSTREAM_BASE: '' }, opts)), JSON.stringify(opts)).toBe(CLOSED_AUTH_BASE);
      expect(base(ghContainedEnv(home, { CCGPT_BRIDGE_UPSTREAM_BASE: mine }, opts)), JSON.stringify(opts)).toBe(mine);
      // the two endpoints are independent: naming one leaves the other at its default
      expect(ghContainedEnv(home, { CCGPT_BRIDGE_UPSTREAM_BASE: mine }, opts)['CCRC_CODEX_AUTH_BASE']).toBe(CLOSED_AUTH_BASE);
    }
    const f = path.join(home, 'base.py');
    writeFileSync(f, 'import os\nprint(os.environ.get("CCGPT_BRIDGE_UPSTREAM_BASE"))\n');
    expect(runPy(f, { home }).stdout.trim()).toBe(CLOSED_AUTH_BASE);
    expect(runPy(f, { home, env: { CCGPT_BRIDGE_UPSTREAM_BASE: '' } }).stdout.trim()).toBe(CLOSED_AUTH_BASE);
    expect(runPy(f, { home, env: { CCGPT_BRIDGE_UPSTREAM_BASE: mine } }).stdout.trim()).toBe(mine);
    expect((await runPyAsync(f, { home })).stdout.trim()).toBe(CLOSED_AUTH_BASE);
  });
});
