// codex-bridge-server.test.ts — the direct-mode server, `ccd/codexbridge/server.py` and `stream.py` (codex-bridge
// Stage 2 plan 2026-10-22, Task 8, and its Review Focus 1, 3 and 4; spec 2026-10-15 §2.4 "Zeros in `message_start`",
// "A `ping` after 15 s of upstream silence", "An upstream idle timeout of 300 s", "On restart the bridge stops taking
// requests and finishes the streams in flight", D-6410, D-6415, D-6429).
//
// Every case plants a lane under a mkTmp HOME (`plantBridgeLane`) and runs a real bridge process through the driver's
// `serve` op (`spawnBridge`), with the shim's own request hooks. The upstream is `fakeResponses` and the token endpoint
// Stage 1's `fakeAuthServer`, both in-process on 127.0.0.1, reached through CCGPT_BRIDGE_UPSTREAM_BASE and
// CCRC_CODEX_AUTH_BASE; a case that needs neither leaves both at CLOSED_AUTH_BASE. Every timer a case exercises is
// lowered through the driver's `consts`, never waited out. Tokens are synthetic JWTs built at runtime.
import { afterEach, describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import path, { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { pythonOrSkip } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
import {
  ACCOUNT_CLAIM, CLOSED_AUTH_BASE, FIXTURE_ACCOUNT_ID, fakeAuthServer, runAuthDriver, syntheticJwt, type AuthScript,
} from './codexAuthFixture.js';
import {
  BRIDGE_MODELS, fakeResponses, killBridges, plantBridgeLane, spawnBridge, writeBridgeCatalogue,
  type BridgeLane, type ResponsesAnswer, type SpawnedBridge,
} from './codexBridgeFixture.js';

const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

afterEach(async () => { await killBridges(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const LANE = 'lane-a';
const MODEL = BRIDGE_MODELS[0];
/** Every case flushes the stats file at each request, so a case reads what the bridge counted. */
const BASE_CONSTS = { 'stats.FLUSH_S': 0 };

// ── the upstream's events ─────────────────────────────────────────────────────────────────────────────────────────
const ev = (type: string, o: Json = {}): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
const created = (n = 1): string => ev('response.created', { response: { id: `resp_fx${n}` } });
const msgItem = (id: string, text: string): Json => ({
  type: 'message', id, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }],
});
const added = (oi: number, id: string): string => ev('response.output_item.added', {
  output_index: oi, item: { type: 'message', id, role: 'assistant', status: 'in_progress', content: [] },
});
const delta = (oi: number, id: string, text: string): string => ev('response.output_text.delta', {
  output_index: oi, item_id: id, content_index: 0, delta: text,
});
const done = (oi: number, item: Json): string => ev('response.output_item.done', { output_index: oi, item });
type U = { input?: number; cached?: number; cacheWrite?: number; output?: number };
const usage = (u: U = {}): Json => ({
  input_tokens: u.input ?? 100, output_tokens: u.output ?? 5,
  input_tokens_details: { cached_tokens: u.cached ?? 0, ...(u.cacheWrite === undefined ? {} : { cache_write_tokens: u.cacheWrite }) },
});
const completed = (u: U = {}, extra: Json = {}): string => ev('response.completed', {
  response: { id: 'resp_fx1', status: 'completed', usage: usage(u), ...extra },
});
const failed = (code: string): string => ev('response.failed', {
  response: { id: 'resp_fx1', status: 'failed', error: { code, message: 'the upstream says no' } },
});
/** A whole text reply. */
const textReply = (text: string, u: U = {}): string => created() + done(0, msgItem('msg_fx1', text)) + completed(u);

// ── the client side ──────────────────────────────────────────────────────────────────────────────────────────────
type Frame = { event: string; data: Json; at: number };
type Answer = { status: number; headers: IncomingHttpHeaders; text: string; frames: Frame[]; json: Json | null; headAt: number; endAt: number };

function parseFrames(text: string, at: number[]): Frame[] {
  const out: Frame[] = [];
  let i = 0;
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n');
    const name = lines.find((l) => l.startsWith('event: '))?.slice(7);
    const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
    if (name !== undefined && data !== undefined) out.push({ event: name, data: JSON.parse(data), at: at[i] ?? 0 });
    i += 1;
  }
  return out;
}

/** One request to the bridge; resolves when the bridge closes the answer. `key: null` sends none; `bearer` sends it
 *  as `Authorization: Bearer`; `raw` is sent as the body, byte for byte, in place of `body`'s JSON. Each SSE frame
 *  carries the time (ms from the request) its bytes arrived. */
function call(
  b: SpawnedBridge, route: string,
  o: { method?: string; body?: Json; raw?: Buffer; key?: string | null; bearer?: boolean; headers?: Record<string, string>; onHead?: () => void } = {},
): Promise<Answer> {
  const t0 = Date.now();
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(o.headers ?? {}) };
  const key = o.key === undefined ? b.key : o.key;
  if (key !== null) {
    if (o.bearer) headers.authorization = `Bearer ${key}`;
    else headers['x-api-key'] = key;
  }
  const payload = o.raw ?? (o.body === undefined ? undefined : Buffer.from(JSON.stringify(o.body)));
  if (payload) headers['content-length'] = String(payload.length);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: b.port, path: route, method: o.method ?? 'POST', headers, agent: false }, (res) => {
      const headAt = Date.now() - t0;
      o.onHead?.();
      let text = '';
      const ends: number[] = [];
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        text += c;
        const n = (c.match(/\n\n/g) ?? []).length;
        for (let k = 0; k < n; k += 1) ends.push(Date.now() - t0);
      });
      res.once('end', () => {
        const ct = String(res.headers['content-type'] ?? '');
        let json: Json | null = null;
        if (ct.startsWith('application/json')) {
          try { json = JSON.parse(text) as Json; } catch { json = null; }
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, frames: parseFrames(text, ends), json, headAt, endAt: Date.now() - t0 });
      });
      res.once('error', reject);
    });
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** A request written to the bridge's socket as it is (`head`, CRLF line ends added, then `body`), for framing that
 *  node's client will not send; resolves with the status and the JSON body once the bridge closes the connection. */
function rawCall(b: SpawnedBridge, head: string[], body: string): Promise<{ status: number; json: Json | null }> {
  return new Promise((resolve, reject) => {
    const s = connect(b.port, '127.0.0.1');
    let text = '';
    s.setEncoding('utf8');
    s.on('data', (c: string) => { text += c; });
    s.once('error', reject);
    s.once('close', () => {
      const status = Number(/^HTTP\/1\.1 (\d{3}) /.exec(text)?.[1] ?? 0);
      const at = text.indexOf('\r\n\r\n');
      let json: Json | null = null;
      try { json = JSON.parse(text.slice(at + 4)) as Json; } catch { json = null; }
      resolve({ status, json });
    });
    s.once('connect', () => { s.write(head.join('\r\n') + '\r\n\r\n' + body); });
  });
}

function messages(o: { text?: string; model?: string; stream?: boolean; session?: string } = {}): Json {
  return {
    model: o.model ?? MODEL, max_tokens: 32000, stream: o.stream ?? true,
    system: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.308.a1b;' }, { type: 'text', text: 'You are a helper.' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: o.text ?? 'hello there' }] }],
  };
}

const READ_TOOL = { name: 'Read', description: 'read a file', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } };

function readStats(lane: BridgeLane): Json {
  return JSON.parse(readFileSync(lane.stats, 'utf8')) as Json;
}

/** The stats file once `ready` holds of it: the bridge flushes after the answer's last byte, so a case polls (at most
 *  3 s) rather than racing the flush. */
async function statsWhen(lane: BridgeLane, ready: (s: Json) => boolean): Promise<Json> {
  const t0 = Date.now();
  for (;;) {
    let doc: Json | null = null;
    try { doc = readStats(lane); } catch { doc = null; }
    if (doc !== null && ready(doc)) return doc;
    if (Date.now() - t0 > 3000) return doc ?? readStats(lane);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A token endpoint's answer. `iatAgo` back-dates the new access token's `iat`, so a 401 on it is not one on a token
 *  issued within FRESH_TOKEN_S. */
function issuedAnswer(o: { iatAgo?: number } = {}): Json {
  const now = Math.floor(Date.now() / 1000);
  const claim = { [ACCOUNT_CLAIM]: { chatgpt_account_id: FIXTURE_ACCOUNT_ID } };
  return {
    access_token: syntheticJwt({ exp: now + 3600, iat: now - (o.iatAgo ?? 0), jti: randomBytes(8).toString('hex'), ...claim }),
    refresh_token: `rtok-fixture-issued-${randomBytes(16).toString('hex')}`,
    id_token: syntheticJwt({ exp: now + 3600, iat: now, ...claim }),
    token_type: 'Bearer', expires_in: 3600,
  };
}

type Ctx = {
  home: string; lane: BridgeLane; bridge: SpawnedBridge;
  up: Awaited<ReturnType<typeof fakeResponses>>; auth: Awaited<ReturnType<typeof fakeAuthServer>> | null;
};

/** A planted lane, a fake upstream answering `answers`, an optional fake token endpoint, and a running bridge. */
async function withBridge(
  answers: ResponsesAnswer[],
  fn: (c: Ctx) => Promise<void>,
  o: {
    consts?: Record<string, unknown>; auth?: AuthScript; plant?: Parameters<typeof plantBridgeLane>[2];
    env?: Record<string, string>; serve?: Record<string, unknown>; beforeSpawn?: (home: string, lane: BridgeLane) => void;
  } = {},
): Promise<void> {
  const home = mkTmp('cb-server-');
  const lane = plantBridgeLane(home, LANE, o.plant);
  const up = await fakeResponses(answers);
  const auth = o.auth ? await fakeAuthServer(o.auth) : null;
  let bridge: SpawnedBridge | null = null;
  try {
    o.beforeSpawn?.(home, lane);
    bridge = await spawnBridge(home, LANE, {
      consts: { ...BASE_CONSTS, ...(o.consts ?? {}) }, serve: o.serve,
      env: { CCGPT_BRIDGE_UPSTREAM_BASE: up.base, ...(auth ? { CCRC_CODEX_AUTH_BASE: auth.base } : {}), ...(o.env ?? {}) },
    });
    await fn({ home, lane, bridge, up, auth });
  } finally {
    if (bridge) await bridge.stop('SIGKILL');
    await up.close();
    if (auth) await auth.close();
  }
}

/** A process's CPU time so far, user and system, in seconds (`/proc/<pid>/stat` fields 14 and 15; Linux only). */
const HAS_PROC = existsSync('/proc/self/stat');
const CLK_TCK = HAS_PROC ? Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()) || 100 : 100;
function cpuSeconds(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return (Number(fields[11]) + Number(fields[12])) / CLK_TCK;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const events = (a: Answer): string[] => a.frames.map((f) => f.event);
const textOf = (a: Answer): string => a.frames
  .filter((f) => f.event === 'content_block_delta' && f.data.delta.type === 'text_delta').map((f) => f.data.delta.text).join('');

describe.skipIf(!PY)('the direct-mode server: one streamed reply (codex-bridge spec §2.4)', () => {
  it('a text reply streams as an Anthropic message, usage in message_delta only', async () => {
    const sse = created() + added(0, 'msg_fx1') + delta(0, 'msg_fx1', 'Hel') + delta(0, 'msg_fx1', 'lo')
      + done(0, msgItem('msg_fx1', 'Hello')) + completed({ input: 120, cached: 20, output: 7 });
    await withBridge([{ status: 200, sse }], async ({ bridge, up }) => {
      const a = await call(bridge, '/v1/messages?beta=true', { body: messages() });
      expect(a.status, a.text).toBe(200);
      expect(String(a.headers['content-type'])).toMatch(/^text\/event-stream/);
      expect(a.frames[0].event).toBe('message_start');
      const start = a.frames[0].data.message;
      expect(start.model).toBe(MODEL);
      expect(Object.values(start.usage)).toEqual([0, 0, 0, 0]);
      expect(textOf(a)).toBe('Hello');
      const md = a.frames.find((f) => f.event === 'message_delta')!.data;
      expect(md.delta.stop_reason).toBe('end_turn');
      expect(md.usage).toEqual({ input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 0, output_tokens: 7 });
      expect(events(a).at(-1)).toBe('message_stop');
      expect(up.requests).toHaveLength(1);
      expect(up.requests[0].values.originator).toBe('ccrc');
      expect(up.requests[0].body).not.toHaveProperty('instructions');
    });
  });

  it('a tool round trip: two parallel calls with full inputs, then their results replayed with the reasoning', async () => {
    const first = created()
      + done(0, { type: 'reasoning', id: 'rs_fx1', summary: [], encrypted_content: 'ENC-1' })
      + done(1, { type: 'function_call', id: 'fc_fx1', call_id: 'call_fx1', name: 'Read', arguments: '{"file_path":"a.txt"}' })
      + done(2, { type: 'function_call', id: 'fc_fx2', call_id: 'call_fx2', name: 'Read', arguments: '{"file_path":"b.txt"}' })
      + completed();
    await withBridge([{ status: 200, sse: first }, { status: 200, sse: textReply('both read') }], async ({ bridge, up, lane }) => {
      const session = { 'x-claude-code-session-id': 'sess-fx1' };
      const body1: Json = { ...messages(), tools: [READ_TOOL] };
      const a = await call(bridge, '/v1/messages', { body: body1, headers: session });
      expect(a.status, a.text).toBe(200);
      const starts = a.frames.filter((f) => f.event === 'content_block_start').map((f) => f.data.content_block);
      expect(starts.map((s) => [s.type, s.id, s.name])).toEqual([['tool_use', 'call_fx1', 'Read'], ['tool_use', 'call_fx2', 'Read']]);
      const inputs = a.frames.filter((f) => f.event === 'content_block_delta').map((f) => JSON.parse(f.data.delta.partial_json));
      expect(inputs).toEqual([{ file_path: 'a.txt' }, { file_path: 'b.txt' }]);
      expect(a.frames.find((f) => f.event === 'message_delta')!.data.delta.stop_reason).toBe('tool_use');
      const body2 = {
        ...body1,
        messages: [
          ...body1.messages,
          { role: 'assistant', content: [
            { type: 'tool_use', id: 'call_fx1', name: 'Read', input: { file_path: 'a.txt' } },
            { type: 'tool_use', id: 'call_fx2', name: 'Read', input: { file_path: 'b.txt' } },
          ] },
          { role: 'user', content: [
            { type: 'tool_result', tool_use_id: 'call_fx1', content: 'A' },
            { type: 'tool_result', tool_use_id: 'call_fx2', content: 'B' },
          ] },
        ],
      };
      const b2 = await call(bridge, '/v1/messages', { body: body2, headers: session });
      expect(b2.status, b2.text).toBe(200);
      expect(up.requests).toHaveLength(2);
      const input = up.requests[1].body!.input as Json[];
      const rs = input.findIndex((i) => i.type === 'reasoning' && i.encrypted_content === 'ENC-1');
      const fc = input.findIndex((i) => i.type === 'function_call' && i.call_id === 'call_fx1');
      expect(rs).toBeGreaterThanOrEqual(0);
      expect(rs).toBeLessThan(fc);
      expect(up.requests[0].values['chatgpt-account-id']).toBe(FIXTURE_ACCOUNT_ID);
      expect(up.requests[0].values['chatgpt-account-id']).not.toBe(LANE);
      const stats = await statsWhen(lane, (d) => d.outcomes['2xx'] === 2);
      expect(stats.outcomes['2xx']).toBe(2);
      expect(Object.keys(stats.outcomes).filter((k) => k.startsWith('store:'))).toEqual([]);
    });
  });

  it('a failure before the first block is a real HTTP status', async () => {
    await withBridge([{ status: 200, sse: created() + failed('server_is_overloaded') }], async ({ bridge }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(529);
      expect(a.json?.error.type).toBe('overloaded_error');
    });
  });

  it('a failure after a block is an error event with no message_stop', async () => {
    const sse = created() + done(0, msgItem('msg_fx1', 'partial')) + failed('server_is_overloaded');
    await withBridge([{ status: 200, sse }], async ({ bridge }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(200);
      expect(textOf(a)).toBe('partial');
      expect(events(a).at(-1)).toBe('error');
      expect(a.frames.at(-1)!.data.error.type).toBe('overloaded_error');
      expect(events(a)).not.toContain('message_stop');
    });
  });
});

describe.skipIf(!PY)('the overflow and the usage that compaction reads (D-6415, D-6416)', () => {
  const big = 'word '.repeat(4000);
  const checkOverflow = async (a: Answer, lane: BridgeLane): Promise<Json> => {
    expect(a.status, a.text).toBe(400);
    expect(a.json?.error.type).toBe('invalid_request_error');
    const m = /^prompt is too long: (\d+) tokens > (\d+) maximum$/.exec(a.json?.error.message);
    expect(m, a.json?.error.message).not.toBeNull();
    const [n, max] = [Number(m![1]), Number(m![2])];
    expect(n).toBeGreaterThan(max);
    expect(max).toBe(Math.min(400000, Math.floor((n * 0.9) / 1000) * 1000));
    expect(max).toBeGreaterThan(0);
    expect(a.headers['x-should-retry']).toBeUndefined();
    const stats = await statsWhen(lane, (d) => d.refusals[`backend/${MODEL}`] !== undefined && d.outcomes['4xx'] === 1);
    expect(stats.refusals[`backend/${MODEL}`]).toMatchObject({ tokens: n, window: 400000, estimated: true });
    return stats;
  };

  it('an overflow before the stream is 400 with the prompt-too-long text, N above M, and the refusal is in the stats file', async () => {
    // the upstream body carries a sentinel no answer may forward (the error table formats no upstream body)
    const sentinel = `SENTINEL-UP-${randomBytes(6).toString('hex')}`;
    const body = { error: { code: 'context_length_exceeded', message: `Your input exceeds the context window of this model. ${sentinel}`, param: sentinel } };
    await withBridge([{ status: 400, body, headers: { 'x-request-id': 'req-fx-overflow' } }], async ({ bridge, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages({ text: big }) });
      expect((await checkOverflow(a, lane)).lastUpstreamRequestId).toBe('req-fx-overflow');
      expect(a.text).not.toContain(sentinel);
      expect(readFileSync(lane.stats, 'utf8')).not.toContain(sentinel);
    });
  });

  it('an overflow arriving as response.failed after 200 OK upstream is still a real 400', async () => {
    await withBridge([{ status: 200, sse: created() + failed('context_length_exceeded') }], async ({ bridge, lane }) => {
      await checkOverflow(await call(bridge, '/v1/messages', { body: messages({ text: big }) }), lane);
    });
  });

  it('response.failed then a held-open connection is answered at once', async () => {
    const answer: ResponsesAnswer = { status: 200, sse: { chunks: [created() + failed('context_length_exceeded')], holdOpenMs: 2000 } };
    await withBridge([answer], async ({ bridge, lane, up }) => {
      const t0 = Date.now();
      const a = await call(bridge, '/v1/messages', { body: messages({ text: big }) });
      await checkOverflow(a, lane);
      expect(a.endAt).toBeLessThan(1200);
      // the bridge drops the held connection itself, long before the upstream's 2 s hold ends: no reader is left on it
      while (!up.requests[0].dropped && Date.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 25));
      expect(up.requests[0].dropped).toBe(true);
    });
  });

  it('the usage that reaches Claude Code makes compaction fire at window − 33k', async () => {
    const sse = textReply('ok', { input: 367000, cached: 300000, cacheWrite: 10000, output: 10 });
    await withBridge([{ status: 200, sse }], async ({ bridge }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      const u = a.frames.find((f) => f.event === 'message_delta')!.data.usage;
      expect(u).toEqual({ input_tokens: 57000, cache_read_input_tokens: 300000, cache_creation_input_tokens: 10000, output_tokens: 10 });
      expect(u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens).toBe(400000 - 33000);
    }, { plant: { window: 400000 } });
  });
});

describe.skipIf(!PY)('the timers: ping, the commit point and the idle bound (Review Focus 1)', () => {
  it('pings through a silence, then the live text', async () => {
    const answer: ResponsesAnswer = { status: 200, sse: { delayMs: 1200, chunks: [
      created(), added(0, 'msg_fx1') + delta(0, 'msg_fx1', 'hel'), delta(0, 'msg_fx1', 'lo') + done(0, msgItem('msg_fx1', 'hello')) + completed(),
    ] } };
    await withBridge([answer], async ({ bridge }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(200);
      const ev = events(a);
      const deltas = ev.map((e, i) => [e, i] as const).filter(([e]) => e === 'content_block_delta').map(([, i]) => i);
      expect(deltas).toHaveLength(2);
      expect(ev.slice(0, deltas[0]).filter((e) => e === 'ping').length).toBeGreaterThanOrEqual(3);
      // the first text arrived live: pings follow it before the second text and the done event
      expect(ev.slice(deltas[0], deltas[1]).filter((e) => e === 'ping').length).toBeGreaterThanOrEqual(3);
      expect(textOf(a)).toBe('hello');
      expect(ev.at(-1)).toBe('message_stop');
    }, { consts: { 'server.PING_S': 0.2, 'server.HOLD_S': 0.3 } });
  });

  it('the head is committed after HOLD_S with no event', async () => {
    const answer: ResponsesAnswer = { status: 200, sse: { chunks: [created()], holdOpenMs: 1500 } };
    await withBridge([answer], async ({ bridge }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(200);
      expect(a.headAt).toBeLessThan(1000);
      expect(a.frames[0].event).toBe('message_start');
      expect(a.frames[0].at).toBeLessThan(1000);
      expect(events(a).slice(1).filter((e) => e === 'ping').length).toBeGreaterThanOrEqual(2);
    }, { consts: { 'server.PING_S': 0.2, 'server.HOLD_S': 0.3 } });
  });

  it('the upstream idle bound ends the stream with api_error', async () => {
    const answer: ResponsesAnswer = { status: 200, sse: { chunks: [created() + added(0, 'msg_fx1') + delta(0, 'msg_fx1', 'x')], holdOpenMs: 3000 } };
    await withBridge([answer], async ({ bridge, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(200);
      const ev = events(a);
      expect(ev.slice(-2)).toEqual(['content_block_stop', 'error']);
      expect(a.frames.at(-1)!.data.error.type).toBe('api_error');
      expect(ev).not.toContain('message_stop');
      expect(a.endAt).toBeLessThan(2000);
      // the contract: every error keeps its code in the status file, the bridge's own idle bound included
      expect((JSON.parse(readFileSync(lane.status, 'utf8')) as Json).lastErrorCode).toBe('idle-timeout');
    }, { consts: { 'backend.IDLE_TIMEOUT_S': 0.5 } });
  });

  it('the socket\'s own idle bound is the idle bound too, never a truncation', async () => {
    // the driver's fault turns the body's end into the socket's UpstreamTimeout, with the parsed-event bound at its
    // 300 s default: only the socket's bound can end this stream, whatever the scheduling
    const answer: ResponsesAnswer = { status: 200, sse: created() + added(0, 'msg_fx1') + delta(0, 'msg_fx1', 'x') };
    await withBridge([answer], async ({ bridge, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(200);
      expect(events(a).slice(-2)).toEqual(['content_block_stop', 'error']);
      expect(a.frames.at(-1)!.data.error.type).toBe('api_error');
      expect((JSON.parse(readFileSync(lane.status, 'utf8')) as Json).lastErrorCode).toBe('idle-timeout');
    }, { serve: { fault: 'eof-is-timeout' } });
  });

  it('an upstream that cannot be reached is 503 api_error, its code in the status file', async () => {
    await withBridge([], async ({ bridge, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(503);
      expect(a.json?.error.type).toBe('api_error');
      expect((JSON.parse(readFileSync(lane.status, 'utf8')) as Json).lastErrorCode).toBe('transport');
    }, { env: { CCGPT_BRIDGE_UPSTREAM_BASE: CLOSED_AUTH_BASE } });
  });

  it('keepalive comments do not reset the idle bound', async () => {
    const answer: ResponsesAnswer = { status: 200, sse: { delayMs: 100, chunks: [created(), ...Array.from({ length: 30 }, () => ':\n\n')] } };
    await withBridge([answer], async ({ bridge }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(503);
      expect(a.json?.error.type).toBe('api_error');
      expect(a.endAt).toBeLessThan(2000);
    }, { consts: { 'backend.IDLE_TIMEOUT_S': 0.5 } });
  });
});

describe.skipIf(!PY)('the drain (Review Focus 3, D-6429)', () => {
  it('SIGTERM: a short stream finishes, a long one gets api_error at DRAIN_S, a new connection is refused', async () => {
    const short: ResponsesAnswer = { status: 200, sse: { delayMs: 200, chunks: [
      created() + added(0, 'msg_fx1') + delta(0, 'msg_fx1', 'short'), done(0, msgItem('msg_fx1', 'short')) + completed(),
    ] } };
    const long: ResponsesAnswer = { status: 200, sse: { chunks: [created() + added(0, 'msg_fx2') + delta(0, 'msg_fx2', 'long')], holdOpenMs: 3000 } };
    await withBridge([short, long], async ({ bridge, lane }) => {
      // each head is awaited before the next step, so the short stream is the first upstream answer and both streams
      // are committed when the signal lands
      let aHead!: () => void;
      let bHead!: () => void;
      const aHeadP = new Promise<void>((r) => { aHead = r; });
      const bHeadP = new Promise<void>((r) => { bHead = r; });
      const aP = call(bridge, '/v1/messages', { body: messages(), onHead: () => aHead() });
      await aHeadP;
      const bP = call(bridge, '/v1/messages', { body: messages(), onHead: () => bHead() });
      await bHeadP;
      const t0 = Date.now();
      bridge.proc.kill('SIGTERM');
      let refusedAt: number | null = null;
      while (refusedAt === null && Date.now() - t0 < 3000) {
        const ok = await new Promise<boolean>((resolve) => {
          const s = connect(bridge.port, '127.0.0.1');
          s.once('connect', () => { s.destroy(); resolve(true); });
          s.once('error', () => resolve(false));
        });
        if (!ok) refusedAt = Date.now() - t0;
        else await new Promise((r) => setTimeout(r, 50));
      }
      const [a, b] = await Promise.all([aP, bP]);
      const exit = await bridge.wait();
      const exitAt = Date.now() - t0;
      expect(refusedAt).not.toBeNull();
      expect(refusedAt!).toBeLessThan(1000);
      expect(events(a).at(-1)).toBe('message_stop');
      expect(textOf(a)).toBe('short');
      expect(events(b)).not.toContain('message_stop');
      expect(b.frames.filter((f) => f.event === 'error').map((f) => f.data.error.type)).toEqual(['api_error']);
      expect(exit).toEqual({ code: 0, signal: null });
      expect(exitAt).toBeLessThan(500 + 1500);
      expect(readStats(lane).outcomes['drain-cut']).toBe(1);
    }, { consts: { 'server.DRAIN_S': 0.5 } });
  });

  it('SIGTERM during a refresh waits for it: the rotated credential is on disk at exit 0', async () => {
    const now = Math.floor(Date.now() / 1000);
    const issued = issuedAnswer();
    await withBridge([], async ({ bridge, auth, lane }) => {
      const t0 = Date.now();
      while (auth!.requests.length === 0 && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 25));
      expect(auth!.requests).toHaveLength(1);
      const t1 = Date.now();
      bridge.proc.kill('SIGTERM');
      const exit = await bridge.wait();
      expect(exit).toEqual({ code: 0, signal: null });
      expect(Date.now() - t1).toBeLessThan(4000);
      expect(readFileSync(join(lane.authDir, 'auth.json'), 'utf8')).toContain(issued.refresh_token as string);
    }, {
      // the token endpoint holds its answer 1.5 s, past the drain's DRAIN_S, inside its credential wait. DRAIN_WRITE_S
      // is large and never spent (no stream is cut): the wait is what is left of the stop bound since the signal
      // (0.2 + 5 - 1 s), never a fixed share of STOP_MARGIN_S that would leave 0.1 s here
      auth: { token: [{ status: 200, body: issued, delayMs: 1500 }] },
      consts: { 'server.REFRESH_TICK_S': 0.2, 'server.DRAIN_S': 0.2, 'server.DRAIN_WRITE_S': 3.9 },
      plant: { credential: { expiresIn: 1000, accessClaims: { iat: now - 3000 } } },
    });
  });

  it('SIGTERM during a request\'s refresh waits for it, and the cut request is never posted', async () => {
    const issued = issuedAnswer();
    await withBridge([{ status: 200, sse: textReply('too late') }], async ({ bridge, auth, up, lane }) => {
      const aP = call(bridge, '/v1/messages', { body: messages() });
      const t0 = Date.now();
      while (auth!.requests.length === 0 && Date.now() - t0 < 4000) await sleep(25);
      expect(auth!.requests).toHaveLength(1);
      bridge.proc.kill('SIGTERM');
      const a = await aP;
      const exit = await bridge.wait();
      expect(a.status).toBe(503);
      expect(a.json?.error.type).toBe('api_error');
      expect(exit).toEqual({ code: 0, signal: null });
      expect(readFileSync(join(lane.authDir, 'auth.json'), 'utf8')).toContain(issued.refresh_token as string);
      expect(up.requests).toHaveLength(0);
    }, {
      // an expired credential: the request's ensure_fresh holds the token endpoint 1.5 s, past DRAIN_S and the cut
      // stream's DRAIN_WRITE_S, so only the credential wait keeps the process alive until the rotation is on disk
      auth: { token: [{ status: 200, body: issued, delayMs: 1500 }] },
      consts: { 'server.DRAIN_S': 0.2, 'server.DRAIN_WRITE_S': 0.1 },
      plant: { credential: { expiresIn: -120 } },
    });
  });

  it('a request cut by the drain whose upstream then answers 401 starts no refresh', async () => {
    const now = Math.floor(Date.now() / 1000);
    const no: ResponsesAnswer = { status: 401, body: { error: { code: 'token_expired', message: 'expired' } }, holdHeadMs: 1500 };
    await withBridge([no], async ({ bridge, auth, up }) => {
      const aP = call(bridge, '/v1/messages', { body: messages() });
      const t0 = Date.now();
      while (up.requests.length === 0 && Date.now() - t0 < 4000) await sleep(25);
      expect(up.requests).toHaveLength(1);
      bridge.proc.kill('SIGTERM');
      const a = await aP;
      const exit = await bridge.wait();
      expect(a.status).toBe(503);
      expect(a.json?.error.type).toBe('api_error');
      expect(exit).toEqual({ code: 0, signal: null });
      expect(up.requests).toHaveLength(1);
      expect(auth!.requests).toHaveLength(0);
    }, {
      // the 401 lands about 1.5 s after the signal: after the cut (at most 0.5 + 0.2 s), inside the cut stream's
      // DRAIN_WRITE_S (2.5 s), so the credential flight is already closed when the request would refresh
      auth: { token: [{ status: 200, body: issuedAnswer({ iatAgo: 600 }) }] },
      consts: { 'server.DRAIN_S': 0.2, 'server.DRAIN_WRITE_S': 2.5 },
      plant: { credential: { accessClaims: { iat: now - 600 } } },
    });
  });
});

describe.skipIf(!PY)('the continuation and the fold (D-6410, D-6431, Review Focus 4)', () => {
  it('end_turn false with no call is continued upstream, at most CONTINUE_MAX times', async () => {
    const part = (n: number): ResponsesAnswer => ({
      status: 200, sse: created(n) + done(0, msgItem(`msg_fx${n}`, `part ${n}`)) + completed({ input: 1000 + n, output: 2 }, { end_turn: false }),
    });
    await withBridge([part(1), part(2), part(3), part(4)], async ({ bridge, up, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status, a.text).toBe(200);
      expect(up.requests).toHaveLength(4);
      const in1 = up.requests[0].body!.input as Json[];
      expect(up.requests[1].body!.input).toEqual([...in1, msgItem('msg_fx1', 'part 1')]);
      const starts = a.frames.filter((f) => f.event === 'content_block_start').map((f) => f.data.index);
      expect(starts).toEqual([0, 1, 2, 3]);
      expect(textOf(a)).toBe('part 1part 2part 3part 4');
      const md = a.frames.find((f) => f.event === 'message_delta')!.data;
      expect(md.delta.stop_reason).toBe('end_turn');
      expect(md.usage.output_tokens).toBe(8);
      expect(md.usage.input_tokens).toBe(1004);
      const stats = await statsWhen(lane, (d) => d.outcomes['2xx'] === 1);
      expect(stats.outcomes['continuation-cap']).toBe(1);
      expect(stats.outcomes.continuations).toBe(3);
      // a continued message never trains the ratio (D24, D-6427): its last input (1004) is past CALIBRATE_MIN_TOKENS,
      // so only `continued` keeps the route at its seed
      expect(stats.routes[`backend/${MODEL}`].bytesPerToken).toBe(3.5);
    });
  });

  it('a continued message pings while it waits for the next head', async () => {
    const first: ResponsesAnswer = { status: 200, sse: created(1) + done(0, msgItem('msg_fx1', 'part 1')) + completed({}, { end_turn: false }) };
    const second: ResponsesAnswer = { status: 200, sse: textReply('part 2'), holdHeadMs: 1000 };
    await withBridge([first, second], async ({ bridge, up }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status, a.text).toBe(200);
      expect(up.requests).toHaveLength(2);
      const ev = events(a);
      const starts = ev.map((e, i) => [e, i] as const).filter(([e]) => e === 'content_block_start').map(([, i]) => i);
      expect(starts).toHaveLength(2);
      expect(ev.slice(starts[0], starts[1]).filter((e) => e === 'ping').length).toBeGreaterThanOrEqual(3);
      expect(textOf(a)).toBe('part 1part 2');
      expect(ev.at(-1)).toBe('message_stop');
    }, { consts: { 'server.PING_S': 0.2 } });
  });

  it.skipIf(!HAS_PROC)('a continued message whose client goes away stops waiting, and spins no CPU on the held head', async () => {
    const first: ResponsesAnswer = { status: 200, sse: created(1) + done(0, msgItem('msg_fx1', 'part 1')) + completed({}, { end_turn: false }) };
    const second: ResponsesAnswer = { status: 200, sse: textReply('part 2'), holdHeadMs: 2000 };
    await withBridge([first, second], async ({ bridge, up }) => {
      const pid = bridge.proc.pid!;
      const body = Buffer.from(JSON.stringify(messages()));
      // the client reads the first response's block, then goes away while the second head is held
      await new Promise<void>((resolve) => {
        const req = httpRequest({
          host: '127.0.0.1', port: bridge.port, path: '/v1/messages', method: 'POST', agent: false,
          headers: { 'content-type': 'application/json', 'x-api-key': bridge.key, 'content-length': String(body.length) },
        }, (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => {
            text += c;
            if (text.includes('content_block_stop')) { req.destroy(); resolve(); }
          });
        });
        req.once('error', () => undefined);
        req.write(body);
        req.end();
      });
      const cpu0 = cpuSeconds(pid);
      await sleep(1800);
      const spent = cpuSeconds(pid) - cpu0;
      expect(up.requests).toHaveLength(2);
      // a ping finds the client gone within a few PING_S; a loop that kept joining the helper with no ping due would
      // spin a whole core until the held head (about 1.5 s of this window)
      expect(spent).toBeLessThan(0.4);
    }, { consts: { 'server.PING_S': 0.2 } });
  });

  it('a reply to a request with an image never trains the ratio (D-6427)', async () => {
    const body = messages();
    body.messages[0].content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } });
    await withBridge([{ status: 200, sse: textReply('a picture', { input: 2000 }) }], async ({ bridge, up, lane }) => {
      const a = await call(bridge, '/v1/messages', { body });
      expect(a.status, a.text).toBe(200);
      expect(JSON.stringify(up.requests[0].body!.input)).toContain('input_image');
      const stats = await statsWhen(lane, (d) => d.outcomes['2xx'] === 1);
      // its input (2000) is past CALIBRATE_MIN_TOKENS and the message was not continued: only the image keeps the
      // route at its seed
      expect(stats.routes[`backend/${MODEL}`].promptTokensLast).toBe(2000);
      expect(stats.routes[`backend/${MODEL}`].bytesPerToken).toBe(3.5);
    });
  });

  it('a compaction request is counted only when it succeeds', async () => {
    const compact = 'CRITICAL: Respond with TEXT ONLY. Summarise the conversation.';
    await withBridge([{ status: 200, sse: created() + failed('server_is_overloaded') }, { status: 200, sse: textReply('summary') }], async ({ bridge, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages({ text: compact }) });
      expect(a.status).toBe(529);
      expect((await statsWhen(lane, (d) => d.outcomes['5xx'] === 1)).outcomes.compactionRequests).toBeUndefined();
      const b = await call(bridge, '/v1/messages', { body: messages({ text: compact }) });
      expect(b.status, b.text).toBe(200);
      expect((await statsWhen(lane, (d) => d.outcomes['2xx'] === 1)).outcomes.compactionRequests).toBe(1);
    });
  });

  it('the stream:false re-send after a mid-stream error is served', async () => {
    const dropped: ResponsesAnswer = { status: 200, sse: created() + added(0, 'msg_fx1') + delta(0, 'msg_fx1', 'hal') };
    await withBridge([dropped, { status: 200, sse: textReply('hello', { input: 50, output: 3 }) }], async ({ bridge, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(200);
      expect(events(a).slice(-2)).toEqual(['content_block_stop', 'error']);
      expect(a.frames.at(-1)!.data.error.type).toBe('api_error');
      expect(events(a)).not.toContain('message_stop');
      const b = await call(bridge, '/v1/messages', { body: messages({ stream: false }) });
      expect(b.status, b.text).toBe(200);
      expect(b.json).toMatchObject({
        type: 'message', role: 'assistant', model: MODEL, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 3 },
      });
      expect((await statsWhen(lane, (d) => d.outcomes['2xx'] === 1)).outcomes.streamFalse).toBe(1);
    });
  });
});

describe.skipIf(!PY)('the local routes', () => {
  it('count_tokens is answered locally and never reaches upstream', async () => {
    await withBridge([], async ({ bridge, up, lane }) => {
      const a = await call(bridge, '/v1/messages/count_tokens?beta=true', { body: messages({ text: 'a'.repeat(7000) }) });
      expect(a.status, a.text).toBe(200);
      expect(a.json!.input_tokens).toBeGreaterThan(2000);
      expect(up.requests).toHaveLength(0);
      expect((await statsWhen(lane, (d) => d.outcomes.countTokens !== undefined)).outcomes.countTokens).toBe(1);
    });
  });

  it('/v1/models lists the catalogue', async () => {
    await withBridge([], async ({ bridge }) => {
      const a = await call(bridge, '/v1/models', { method: 'GET' });
      expect(a.status).toBe(200);
      expect((a.json!.data as Json[]).map((m) => m.id)).toEqual([...BRIDGE_MODELS]);
      expect(a.json!.has_more).toBe(false);
    });
  });

  it('a wrong key is 401 and reaches nothing', async () => {
    await withBridge([{ status: 200, sse: textReply('no') }], async ({ bridge, up, auth }) => {
      for (const key of [null, 'sk-' + '0'.repeat(48)]) {
        const a = await call(bridge, '/v1/messages', { body: messages(), key });
        expect(a.status).toBe(401);
        expect(a.json?.error.type).toBe('authentication_error');
        expect(a.headers['x-should-retry']).toBe('false');
      }
      const ok = await call(bridge, '/v1/messages', { body: messages(), bearer: true });
      expect(ok.status).toBe(200);
      expect(up.requests).toHaveLength(1);
      expect(auth!.requests).toHaveLength(0);
    }, { auth: {} });
  });

  it('GET /ccgpt/lane answers without a key, in the direct shape', async () => {
    await withBridge([], async ({ bridge }) => {
      const a = await call(bridge, '/ccgpt/lane', { method: 'GET', key: null });
      expect(a.status).toBe(200);
      expect(a.json).toEqual({ lane: LANE, mode: 'direct' });
    });
  });

  it('a model outside the catalogue is 404 and never reaches upstream', async () => {
    await withBridge([], async ({ bridge, up, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages({ model: 'claude-fallback-x' }) });
      expect(a.status).toBe(404);
      expect(a.json?.error.type).toBe('not_found_error');
      expect(a.headers['x-should-retry']).toBe('false');
      expect(up.requests).toHaveLength(0);
      expect((await statsWhen(lane, (d) => d.outcomes['4xx'] === 1)).names.modelSubstitution).toEqual({ 'claude-fallback-x': 1 });
    });
  });

  it('a model added to the catalogue after start is served without a restart', async () => {
    await withBridge([{ status: 200, sse: textReply('new model') }], async ({ bridge, up, lane }) => {
      const before = await call(bridge, '/v1/messages', { body: messages({ model: 'model-7-gamma' }) });
      expect(before.status).toBe(404);
      writeBridgeCatalogue(lane.catalogue, [...BRIDGE_MODELS, 'model-7-gamma']);
      const after = await call(bridge, '/v1/messages', { body: messages({ model: 'model-7-gamma' }) });
      expect(after.status, after.text).toBe(200);
      expect(up.requests).toHaveLength(1);
      expect(up.requests[0].body!.model).toBe('model-7-gamma');
    });
  });

  it('a 200 with no content type is reduced, and the media type counted as a name', async () => {
    const answers: ResponsesAnswer[] = [
      { status: 200, sse: textReply('bare'), headers: { 'content-type': null } },
      { status: 200, sse: textReply('typed'), headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    ];
    await withBridge(answers, async ({ bridge, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(textOf(a)).toBe('bare');
      expect((await statsWhen(lane, (d) => d.outcomes['2xx'] === 1)).names.responseHeader).toHaveProperty(['content-type:absent']);
      const b = await call(bridge, '/v1/messages', { body: messages() });
      expect(textOf(b)).toBe('typed');
      expect((await statsWhen(lane, (d) => d.outcomes['2xx'] === 2)).names.responseHeader).toHaveProperty(['content-type:text/event-stream']);
    });
  });
});

describe.skipIf(!PY)('an undecidable catalogue is the bridge\'s fault, not the client\'s model', () => {
  for (const [what, spoil] of [
    ['absent', (file: string) => rmSync(file)],
    ['not in its shape', (file: string) => writeFileSync(file, JSON.stringify({ models: 5 }))],
    ['a list of rows that are not objects', (file: string) => writeFileSync(file, JSON.stringify({ models: [5] }))],
    ['a list of rows with no id', (file: string) => writeFileSync(file, JSON.stringify({ models: [{ name: 'x' }] }))],
    ['a list with one row out of shape', (file: string) => writeFileSync(file, JSON.stringify({ models: [{ id: BRIDGE_MODELS[0] }, { id: '' }] }))],
  ] as const) {
    it(`a catalogue that is ${what} is 503 api_error, retryable, and never a substitution`, async () => {
      await withBridge([], async ({ bridge, up, lane }) => {
        spoil(lane.catalogue);
        const a = await call(bridge, '/v1/messages', { body: messages() });
        expect(a.status).toBe(503);
        expect(a.json?.error.type).toBe('api_error');
        expect(a.headers['x-should-retry']).toBeUndefined();
        const stats = await statsWhen(lane, (d) => d.outcomes['catalogue-unreadable'] === 1);
        expect(stats.outcomes['catalogue-unreadable']).toBe(1);
        expect(stats.names.modelSubstitution).toBeUndefined();
        const m = await call(bridge, '/v1/models', { method: 'GET' });
        expect(m.status).toBe(503);
        expect(m.json?.error.type).toBe('api_error');
        expect(up.requests).toHaveLength(0);
      });
    });
  }
});

describe.skipIf(!PY)('the request body, through the shim\'s hooks', () => {
  const json = (): Buffer => Buffer.from(JSON.stringify(messages()));

  it('an encoding the shim does not implement is 415 and reaches nothing', async () => {
    await withBridge([{ status: 200, sse: textReply('no') }], async ({ bridge, up }) => {
      const a = await call(bridge, '/v1/messages', { raw: json(), headers: { 'content-encoding': 'br' } });
      expect(a.status, a.text).toBe(415);
      expect(a.json?.error.type).toBe('invalid_request_error');
      expect(up.requests).toHaveLength(0);
    });
  });

  it('a gzip body is decoded and served; one that does not decode is 400', async () => {
    await withBridge([{ status: 200, sse: textReply('unzipped') }], async ({ bridge, up }) => {
      const ok = await call(bridge, '/v1/messages', { raw: gzipSync(json()), headers: { 'content-encoding': 'gzip' } });
      expect(ok.status, ok.text).toBe(200);
      expect(textOf(ok)).toBe('unzipped');
      const bad = await call(bridge, '/v1/messages', { raw: Buffer.from('not gzip at all'), headers: { 'content-encoding': 'gzip' } });
      expect(bad.status, bad.text).toBe(400);
      expect(bad.json?.error.type).toBe('invalid_request_error');
      expect(up.requests).toHaveLength(1);
    });
  });

  it('a body that is not JSON, or not a JSON object, is 400 and reaches nothing', async () => {
    await withBridge([], async ({ bridge, up }) => {
      for (const raw of ['not json', '[1, 2]']) {
        const a = await call(bridge, '/v1/messages', { raw: Buffer.from(raw) });
        expect(a.status, raw).toBe(400);
        expect(a.json?.error.type).toBe('invalid_request_error');
      }
      expect(up.requests).toHaveLength(0);
    });
  });

  it('malformed body framing is 400 and reaches nothing', async () => {
    await withBridge([], async ({ bridge, up }) => {
      const a = await rawCall(bridge, [
        'POST /v1/messages HTTP/1.1', `Host: 127.0.0.1:${bridge.port}`, `x-api-key: ${bridge.key}`,
        'Content-Type: application/json', 'Transfer-Encoding: chunked',
      ], 'zz\r\n{}\r\n0\r\n\r\n');
      expect(a.status).toBe(400);
      expect(a.json?.error.type).toBe('invalid_request_error');
      expect(up.requests).toHaveLength(0);
    });
  });
});

describe.skipIf(!PY)('the credential (spec §2.4, §2.6; the plan contract\'s error table)', () => {
  it('a 401 upstream refreshes once and retries once; a second 401 is 401 with x-should-retry false', async () => {
    const now = Math.floor(Date.now() / 1000);
    const no = { status: 401, body: { error: { code: 'token_expired', message: 'expired' } } };
    await withBridge([no, no], async ({ bridge, up, auth, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(401);
      expect(a.json?.error.type).toBe('authentication_error');
      expect(a.headers['x-should-retry']).toBe('false');
      expect(up.requests).toHaveLength(2);
      expect(up.requests[1].authorizationSha256).not.toBe(up.requests[0].authorizationSha256);
      expect(auth!.requests).toHaveLength(1);
      const stats = await statsWhen(lane, (d) => d.outcomes['4xx'] === 1);
      expect(stats.outcomes['refresh-after-401']).toBe(1);
      expect(stats.outcomes['refresh-skipped-fresh-token']).toBeUndefined();
      // the refreshed token is not a fresh one either, so only the one-retry rule stops a second refresh
    }, { auth: { token: [{ status: 200, body: issuedAnswer({ iatAgo: 600 }) }] }, plant: { credential: { accessClaims: { iat: now - 600 } } } });
  });

  it('a 401 on a token issued within FRESH_TOKEN_S is not refreshed', async () => {
    const no = { status: 401, body: { error: { code: 'originator_refused' } } };
    await withBridge([no, no], async ({ bridge, up, auth, lane }) => {
      for (let i = 0; i < 2; i += 1) {
        const a = await call(bridge, '/v1/messages', { body: messages() });
        expect(a.status).toBe(401);
        expect(a.headers['x-should-retry']).toBe('false');
      }
      expect(up.requests).toHaveLength(2);
      expect(auth!.requests).toHaveLength(0);
      expect((await statsWhen(lane, (d) => d.outcomes['4xx'] === 2)).outcomes['refresh-skipped-fresh-token']).toBe(2);
    }, { auth: { token: [{ status: 200, body: issuedAnswer() }] } });
  });

  it('a needs-signin credential is 401 at once with no upstream request', async () => {
    await withBridge([], async ({ bridge, up }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(401);
      expect(a.json?.error.type).toBe('authentication_error');
      expect(a.json?.error.message).toMatch(/^needs-signin: /);
      expect(a.headers['x-should-retry']).toBe('false');
      expect(up.requests).toHaveLength(0);
    }, { auth: { token: [{ status: 400, body: { error: 'invalid_grant' } }] }, plant: { credential: { expiresIn: -120 } } });
  });

  it('an absent library is 401 auth-library-absent', async () => {
    await withBridge([], async ({ bridge, up }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(401);
      expect(a.json?.error.message).toMatch(/^auth-library-absent: /);
      expect(a.headers['x-should-retry']).toBe('false');
      expect(up.requests).toHaveLength(0);
    }, { env: { CCRC_CODEX_AUTH_LIB: path.join(mkTmp('cb-nolib-'), 'no-such-lib.py') } });
  });

  it('a refresh that fails transiently is 503 api_error, retryable', async () => {
    await withBridge([], async ({ bridge, up, auth }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(503);
      expect(a.json?.error.type).toBe('api_error');
      expect(a.json?.error.message).toMatch(/^refresh-failed: /);
      expect(a.headers['x-should-retry']).toBeUndefined();
      expect(up.requests).toHaveLength(0);
      expect(auth!.requests).toHaveLength(1);
    }, { auth: { token: [{ status: 500, body: { error: 'server_error' } }] }, plant: { credential: { expiresIn: -120 } } });
  });

  it('a held credential lock is 503 api_error', async () => {
    let holder: ReturnType<typeof runAuthDriver> | null = null;
    await withBridge([], async ({ bridge, up, lane, home }) => {
      const ready = join(home, 'held.ready');
      holder = runAuthDriver(home, { authDir: lane.authDir, ops: [{ op: 'hold', ms: 3000, touch: ready }] });
      const t0 = Date.now();
      while (!existsSync(ready) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
      expect(existsSync(ready)).toBe(true);
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(503);
      expect(a.json?.error.message).toMatch(/^auth-lock-busy: /);
      expect(a.headers['x-should-retry']).toBeUndefined();
      expect(up.requests).toHaveLength(0);
      expect(a.endAt).toBeLessThan(2500);
    }, { auth: {}, consts: { 'ccgpt_auth.LOCK_WAIT_S': 0.3 }, plant: { credential: { expiresIn: -120 } } });
    if (holder) await holder;
  });

  it('usage_limit_reached is 429 billing_error and the status file reads limit-paused; the next success clears it', async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 120;
    const sentinel = `SENTINEL-UP-${randomBytes(6).toString('hex')}`;
    const limit = {
      status: 429, body: { error: { type: 'usage_limit_reached', resets_at: resetsAt, message: sentinel } }, headers: { 'x-request-id': 'req-fx-limit' },
    };
    await withBridge([limit, { status: 200, sse: textReply('back') }], async ({ bridge, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages() });
      expect(a.status).toBe(429);
      expect(a.json?.error.type).toBe('billing_error');
      expect(a.headers['x-should-retry']).toBe('false');
      expect(Number(a.headers['retry-after'])).toBeGreaterThanOrEqual(110);
      expect(a.text).not.toContain(sentinel);
      const paused = JSON.parse(readFileSync(lane.status, 'utf8')) as Json;
      expect(paused.state).toBe('limit-paused');
      expect(paused.lastRequestId).toBe('req-fx-limit');
      const b = await call(bridge, '/v1/messages', { body: messages() });
      expect(b.status).toBe(200);
      expect((JSON.parse(readFileSync(lane.status, 'utf8')) as Json).state).toBe('ok');
    });
  });

  it('the refresher thread refreshes an idle lane at half its token lifetime', async () => {
    const now = Math.floor(Date.now() / 1000);
    await withBridge([], async ({ auth, up }) => {
      const t0 = Date.now();
      while (auth!.requests.length === 0 && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50));
      expect(auth!.requests).toHaveLength(1);
      await new Promise((r) => setTimeout(r, 600));
      expect(auth!.requests).toHaveLength(1);
      expect(up.requests).toHaveLength(0);
    }, {
      auth: { token: [{ status: 200, body: issuedAnswer() }] }, consts: { 'server.REFRESH_TICK_S': 0.2 },
      // a 4000 s token issued 3000 s ago: 1000 s left is inside its 2000 s half life, outside EXPIRY_SKEW_S
      plant: { credential: { expiresIn: 1000, accessClaims: { iat: now - 3000 } } },
    });
  });
});

describe.skipIf(!PY)('the handler never leaks (the plan\'s Global Constraints)', () => {
  it('an internal error logs its class only', async () => {
    const sentinel = `SENTINEL-${randomBytes(6).toString('hex')}`;
    await withBridge([], async ({ bridge, lane }) => {
      const a = await call(bridge, '/v1/messages', { body: messages({ text: sentinel }) });
      expect(a.status).toBe(503);
      expect(a.json?.error.type).toBe('api_error');
      const token = lane.cred!.access;
      await statsWhen(lane, (d) => d.outcomes['5xx'] === 1);
      expect(bridge.stderr()).toMatch(/ccgpt-proxy: direct: RuntimeError [a-z0-9_.-]+\n/);
      for (const secret of [sentinel, token]) {
        expect(bridge.stderr()).not.toContain(secret);
        expect(a.text).not.toContain(secret);
        expect(readFileSync(lane.stats, 'utf8')).not.toContain(secret);
      }
    }, { serve: { fault: 'post-raises' } });
  });
});
