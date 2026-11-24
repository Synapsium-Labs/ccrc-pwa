// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.1). L3: the stand-in
// model, a Messages API server on the capture's own loopback. It answers each request with what `capture.ts#standInReply`
// decides, in the Messages API's own shapes (a whole message, or Server-Sent Events when the request asks to stream), so a
// build that reads `ANTHROPIC_BASE_URL` takes it for the model. It decides nothing, holds no credential and logs no header:
// the placeholder token arrives in one and is never read. Anything it does not script is a JSON error, never a hang.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { standInReply, type StandInReply } from './capture.js';

/** A running stand-in. `requests` holds each parsed request body, in arrival order, for the tests. */
export interface StandIn {
  readonly port: number;
  readonly requests: readonly unknown[];
  close(): Promise<void>;
}

type Obj = Record<string, unknown>;

/** The Messages API's error body. */
const errorBody = (type: string, message: string): Obj => ({ type: 'error', error: { type, message } });

/** The content blocks one reply carries, with the tool call's id fresh. `streamed`: a tool block starts with an empty
 *  input, which its `input_json_delta` then fills. */
function contentOf(r: Exclude<StandInReply, { kind: 'error' }>, id: string, streamed: boolean): Obj[] {
  if (r.kind === 'text') return [{ type: 'text', text: streamed ? '' : r.text }];
  return [{ type: 'tool_use', id, name: r.name, input: streamed ? {} : r.input }];
}

const sse = (event: string, data: Obj): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function startStandIn(opts: { host?: string; port?: number } = {}): Promise<StandIn> {
  const requests: unknown[] = [];
  let n = 0;

  const json = (res: http.ServerResponse, status: number, body: Obj): void => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };

  const answer = (res: http.ServerResponse, body: unknown): void => {
    requests.push(body);
    const reply = standInReply(body);
    if (reply.kind === 'error') { json(res, reply.status, errorBody('invalid_request_error', reply.message)); return; }
    n += 1;
    const o = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Obj) : {};
    const model = typeof o['model'] === 'string' ? o['model'] : 'ccrc-capture-stand-in';
    const stop = reply.kind === 'tool' ? 'tool_use' : 'end_turn';
    const msg = { id: `msg_ccrc_${n}`, type: 'message', role: 'assistant', model, stop_reason: null as string | null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (o['stream'] !== true) {
      json(res, 200, { ...msg, content: contentOf(reply, `toolu_ccrc_${n}`, false), stop_reason: stop });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(sse('message_start', { type: 'message_start', message: { ...msg, content: [], usage: { input_tokens: 1, output_tokens: 1 } } }));
    const block = contentOf(reply, `toolu_ccrc_${n}`, true)[0]!;
    res.write(sse('content_block_start', { type: 'content_block_start', index: 0, content_block: block }));
    const delta = reply.kind === 'text' ? { type: 'text_delta', text: reply.text } : { type: 'input_json_delta', partial_json: JSON.stringify(reply.input) };
    res.write(sse('content_block_delta', { type: 'content_block_delta', index: 0, delta }));
    res.write(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
    res.write(sse('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } }));
    res.write(sse('message_stop', { type: 'message_stop' }));
    res.end();
  };

  const server = http.createServer((req, res) => {
    const route = (req.url ?? '').split('?')[0];
    const known = req.method === 'POST' && (route === '/v1/messages' || route === '/v1/messages/count_tokens');
    if (!known) { req.resume(); json(res, 404, errorBody('not_found_error', 'not scripted by the capture stand-in')); return; }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json(res, 400, errorBody('invalid_request_error', 'the body is not JSON')); return; }
      if (route === '/v1/messages/count_tokens') { requests.push(body); json(res, 200, { input_tokens: 1 }); return; }
      answer(res, body);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    port, requests,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}
