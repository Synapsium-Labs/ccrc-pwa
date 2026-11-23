// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.1). The stand-in model
// over real HTTP on loopback: each scripted reply of `capture.ts#standInReply` through it, streamed and whole, the error
// step, the token count, the routes it does not script, and a body that is not JSON.
import { afterEach, describe, expect, it } from 'vitest';
import { CAPTURE_WRITE_COMMAND } from '../../shared/claudeBuildCapture.js';
import { CAPTURE_CD_COMMAND, CAPTURE_MARK } from '../src/testbox/capture.js';
import { startStandIn, type StandIn } from '../src/testbox/captureStub.js';

let live: StandIn | null = null;
afterEach(async () => { await live?.close(); live = null; });

const open = async (): Promise<StandIn> => (live = await startStandIn());
const url = (s: StandIn, p = '/v1/messages'): string => `http://127.0.0.1:${s.port}${p}`;
const post = (s: StandIn, body: unknown, p = '/v1/messages'): Promise<Response> =>
  fetch(url(s, p), { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'ccrc-capture-stand-in' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const TOOLS = [{ name: 'Bash' }, { name: 'Agent' }];
const user = (text: string, stream: boolean): Record<string, unknown> => ({ model: 'm-1', stream, tools: TOOLS, messages: [{ role: 'user', content: text }] });
const afterCall = (command: string): Record<string, unknown> => ({
  model: 'm-1', tools: TOOLS,
  messages: [
    { role: 'user', content: CAPTURE_MARK.one },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_x', name: 'Bash', input: { command } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: '' }] },
  ],
});

/** The SSE body as its events, each `{event, data}`. */
function events(text: string): { event: string; data: Record<string, any> }[] {
  return text.trim().split('\n\n').map((blk) => {
    const lines = blk.split('\n');
    return { event: lines[0]!.replace('event: ', ''), data: JSON.parse(lines[1]!.replace('data: ', '')) as Record<string, any> };
  });
}

describe('the stand-in model answers the Messages API (spec §2.1)', () => {
  it('a whole tool reply: a Bash call to move the shell, with a fresh tool id and the request\'s model', async () => {
    const s = await open();
    const r = await post(s, user(CAPTURE_MARK.one, false));
    expect(r.status).toBe(200);
    const m = (await r.json()) as Record<string, any>;
    expect(m).toMatchObject({ type: 'message', role: 'assistant', model: 'm-1', stop_reason: 'tool_use' });
    expect(m.content).toHaveLength(1);
    expect(m.content[0]).toMatchObject({ type: 'tool_use', name: 'Bash', input: { command: CAPTURE_CD_COMMAND } });
    expect(m.content[0].id).toMatch(/^toolu_/);
    const second = (await (await post(s, user(CAPTURE_MARK.one, false))).json()) as Record<string, any>;
    expect(second.content[0].id).not.toBe(m.content[0].id);
  });

  it('after the cd, the write; after the write, a closing text', async () => {
    const s = await open();
    const w = (await (await post(s, afterCall(CAPTURE_CD_COMMAND))).json()) as Record<string, any>;
    expect(w.content[0]).toMatchObject({ type: 'tool_use', name: 'Bash', input: { command: CAPTURE_WRITE_COMMAND } });
    const t = (await (await post(s, afterCall(CAPTURE_WRITE_COMMAND))).json()) as Record<string, any>;
    expect(t).toMatchObject({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ccrc capture: done' }] });
  });

  it('step two answers an Agent call; a side request with no such tool gets text, never a call', async () => {
    const s = await open();
    const a = (await (await post(s, user(CAPTURE_MARK.two, false))).json()) as Record<string, any>;
    expect(a.content[0]).toMatchObject({ type: 'tool_use', name: 'Agent', input: { prompt: CAPTURE_MARK.subagent } });
    const side = (await (await post(s, { model: 'm', tools: [], messages: [{ role: 'user', content: CAPTURE_MARK.two }] })).json()) as Record<string, any>;
    expect(side.content[0].type).toBe('text');
  });

  it('a streamed tool reply: message_start, one tool block filled by input_json_delta, message_delta tool_use, message_stop', async () => {
    const s = await open();
    const r = await post(s, user(CAPTURE_MARK.one, true));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    const ev = events(await r.text());
    expect(ev.map((e) => e.event)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    expect(ev[0]!.data.message).toMatchObject({ id: expect.stringMatching(/^msg_/), type: 'message', role: 'assistant', model: 'm-1', content: [], usage: { input_tokens: expect.any(Number), output_tokens: expect.any(Number) } });
    expect(ev[1]!.data.content_block).toMatchObject({ type: 'tool_use', name: 'Bash', input: {} });
    expect(ev[1]!.data.content_block.id).toMatch(/^toolu_/);
    expect(ev[2]!.data.delta.type).toBe('input_json_delta');
    expect(JSON.parse(ev[2]!.data.delta.partial_json)).toMatchObject({ command: CAPTURE_CD_COMMAND });
    expect(ev[4]!.data).toMatchObject({ delta: { stop_reason: 'tool_use' }, usage: { output_tokens: expect.any(Number) } });
  });

  it('a streamed text reply: a text_delta and end_turn', async () => {
    const s = await open();
    const ev = events(await (await post(s, { model: 'm', stream: true, tools: [], messages: [{ role: 'user', content: 'a title please' }] })).text());
    expect(ev[1]!.data.content_block).toMatchObject({ type: 'text', text: '' });
    expect(ev[2]!.data.delta).toEqual({ type: 'text_delta', text: 'ccrc capture summary' });
    expect(ev[4]!.data.delta.stop_reason).toBe('end_turn');
  });

  it('step three answers HTTP 400 as an error body, even when it asks to stream', async () => {
    const s = await open();
    for (const stream of [false, true]) {
      const r = await post(s, user(CAPTURE_MARK.three, stream));
      expect(r.status).toBe(400);
      expect(r.headers.get('content-type')).toContain('application/json');
      expect(await r.json()).toEqual({ type: 'error', error: { type: 'invalid_request_error', message: expect.any(String) } });
    }
  });

  it('count_tokens answers one input token; a query string is ignored', async () => {
    const s = await open();
    expect(await (await post(s, { messages: [] }, '/v1/messages/count_tokens?beta=true')).json()).toEqual({ input_tokens: 1 });
    expect((await post(s, user(CAPTURE_MARK.one, false), '/v1/messages?beta=true')).status).toBe(200);
  });

  it('a body that is not JSON is 400 invalid_request_error; any other path or method is a 404 JSON error', async () => {
    const s = await open();
    const bad = await post(s, '{not json');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ type: 'error', error: { type: 'invalid_request_error' } });
    for (const [method, p] of [['GET', '/v1/messages'], ['POST', '/v1/other'], ['DELETE', '/']] as const) {
      const r = await fetch(url(s, p), { method });
      expect(r.status, `${method} ${p}`).toBe(404);
      expect(await r.json()).toMatchObject({ type: 'error' });
    }
  });

  it('keeps each parsed body for the tests, and listens on loopback', async () => {
    const s = await open();
    await post(s, user(CAPTURE_MARK.one, false));
    await post(s, '{nope');
    expect(s.requests).toHaveLength(1);
    expect((s.requests[0] as { model: string }).model).toBe('m-1');
    expect(s.port).toBeGreaterThan(0);
  });
});
