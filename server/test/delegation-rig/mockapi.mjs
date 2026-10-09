#!/usr/bin/env node
// mockapi.mjs — a scriptable mock of the Anthropic Messages API for the delegation broker's
// capture rig (wave 1, spec 2026-10-04 §8.2). No dependencies; 127.0.0.1 only. Ported from the
// scratch rig that drove Claude Code 2.1.280-2.1.283 through real Workflow calls.
//
// Env:
//   MOCK_SCRIPT  REQUIRED: path of the JSON script, re-read on EVERY request
//   MOCK_PORT    listen port; 0 binds an ephemeral one (default 0). Once bound, exactly one stdout
//                line is printed: `mock listening 127.0.0.1:<port>`
//   MOCK_LOG     optional: one line per request is appended here
//   MOCK_REQDIR  optional: each request body is dumped here as NNNN-<kind>.json
//
// Script shape: { "entries": [entry, ...], "default": entry, "sideDefault": entry } (or a bare
// array of entries). Any other top-level key (a scenario's "steps", "covers", ...) is ignored.
// An entry is consumed by the first request it MATCHES, in list order, unless "repeat": true.
// Request kinds: main = the interactive loop (system prompt carries MOCK_MAIN_MARKER, default
//   "You are an interactive agent"); sub = offered tools and stamped `cc_is_subagent=true`, or
//   offered tools without the main marker; side = offered NO tools.
//   "match": "main" | "sub" | "side" | "tools" (main or sub) | "any", or an object
//   { kind, model, system, lastUser, tool, hasToolResult } — regexes for model/system/lastUser;
//   lastUser is the last user message minus <system-reminder> blocks, a tool_result rendered as
//   `[tool_result <content>]`. A missing "match" means "main".
// Response (one of): { "text" } | { "tool_use": { "name" | "nameAny": [...], "input", "id"? } }
//   | { "blocks": [ {thinking}|{text}|{tool_use} ] } | { "status": 4xx|5xx, "headers"?, "body"? }
//   plus optional "label", "hang_ms" (N<0 never answers), "headers", "usage", "stop_reason",
//   "chunk_ms", "stall_ms", "repeat". `nameAny` picks the first name the request offers (else the
//   first listed). A header VALUE of the form `$NOW+<s>` is sent as the epoch second <s> from now.
// Fallbacks: "default" for main and sub (else text "(mock default reply)"); "sideDefault" for side
//   (else JSON synthesised from the request's json_schema, or "Rig session").
// Control: GET /__rig/state -> { script, entries, consumed, consumedLabels, requests };
//   POST /__rig/reset forgets consumption (as does any change to the script's content).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCRIPT = process.env.MOCK_SCRIPT || '';
if (SCRIPT === '') { process.stderr.write('mockapi: MOCK_SCRIPT is required\n'); process.exit(2); }
const PORT = Number(process.env.MOCK_PORT || 0);
const LOG = process.env.MOCK_LOG || '';
const REQDIR = process.env.MOCK_REQDIR || '';
if (REQDIR !== '') fs.mkdirSync(REQDIR, { recursive: true });

let scriptHash = null;
let consumed = new Set();
const consumedLabels = [];
let seq = 0;
let toolSeq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => { if (LOG !== '') fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); };

function loadScript() {
  let raw = '[]';
  try { raw = fs.readFileSync(SCRIPT, 'utf8'); } catch { /* absent = empty */ }
  const h = crypto.createHash('sha1').update(raw).digest('hex');
  if (h !== scriptHash) { scriptHash = h; consumed = new Set(); consumedLabels.length = 0; log(`SCRIPT reloaded sha1=${h.slice(0, 10)}`); }
  let j;
  try { j = JSON.parse(raw); } catch (e) { log(`SCRIPT parse error: ${e.message}`); j = []; }
  if (Array.isArray(j)) j = { entries: j };
  return { entries: j.entries || [], def: j.default, sideDef: j.sideDefault };
}

function systemText(body) {
  const s = body.system;
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.map((b) => (typeof b === 'string' ? b : b.text || '')).join('\n');
}
function lastUser(body) {
  const ms = body.messages || [];
  for (let i = ms.length - 1; i >= 0; i -= 1) if (ms[i].role === 'user') return ms[i];
  return null;
}
function resultText(c) {
  if (typeof c === 'string') return c;
  return (c || []).map((x) => x.text || `[${x.type}]`).join(' ');
}
/** The typed prompt: the last user message's text blocks that are not <system-reminder> injections. */
function userPrompt(body) {
  const lu = lastUser(body);
  if (!lu) return '';
  if (typeof lu.content === 'string') return lu.content;
  const parts = [];
  for (const b of lu.content || []) {
    if (b.type === 'text' && !/^\s*<system-reminder>/.test(b.text)) parts.push(b.text);
    else if (b.type === 'tool_result') parts.push(`[tool_result ${resultText(b.content)}]`);
  }
  return parts.join(' ');
}
const MAIN_MARKER = new RegExp(process.env.MOCK_MAIN_MARKER || 'You are an interactive agent');
function classify(body) {
  const tools = (body.tools || []).map((t) => t.name);
  const sys = systemText(body);
  const kind = tools.length === 0 ? 'side' : /cc_is_subagent=true/.test(sys) ? 'sub' : MAIN_MARKER.test(sys) ? 'main' : 'sub';
  return { kind, tools, sys };
}
function schemaOf(body) {
  const oc = body.output_config?.format || body.output_format;
  return oc && oc.type === 'json_schema' ? oc.schema : null;
}
function synth(schema) {
  if (!schema) return null;
  switch (schema.type) {
    case 'object': { const o = {}; for (const [k, v] of Object.entries(schema.properties || {})) o[k] = synth(v); return o; }
    case 'array': return [];
    case 'number': case 'integer': return 0;
    case 'boolean': return false;
    case 'string': return schema.enum ? schema.enum[0] : 'Rig session';
    default: return schema.enum ? schema.enum[0] : null;
  }
}
function matches(entry, req) {
  let m = entry.match ?? 'main';
  if (typeof m === 'string') m = { kind: m };
  const kind = m.kind ?? 'main';
  if (kind !== 'any' && kind !== req.kind && !(kind === 'tools' && req.kind !== 'side')) return false;
  if (m.model && !new RegExp(m.model).test(req.body.model || '')) return false;
  if (m.system && !new RegExp(m.system).test(req.sys)) return false;
  if (m.lastUser && !new RegExp(m.lastUser).test(userPrompt(req.body))) return false;
  if (m.tool && !req.tools.includes(m.tool)) return false;
  if (m.hasToolResult !== undefined) {
    const lu = lastUser(req.body);
    const has = !!(lu && Array.isArray(lu.content) && lu.content.some((b) => b.type === 'tool_result'));
    if (has !== m.hasToolResult) return false;
  }
  return true;
}
function pick(req) {
  const { entries, def, sideDef } = loadScript();
  for (let i = 0; i < entries.length; i += 1) {
    if (consumed.has(i)) continue;
    if (matches(entries[i], req)) {
      if (!entries[i].repeat) { consumed.add(i); if (typeof entries[i].label === 'string') consumedLabels.push(entries[i].label); }
      return { entry: entries[i], label: `entry#${i}` };
    }
  }
  if (req.kind !== 'side') return { entry: def ?? { text: '(mock default reply)' }, label: 'default' };
  if (sideDef) return { entry: sideDef, label: 'sideDefault' };
  const sch = schemaOf(req.body);
  return { entry: { text: sch ? JSON.stringify(synth(sch)) : 'Rig session' }, label: 'sideDefault(synth)' };
}
function blocksOf(entry) {
  if (entry.blocks) return entry.blocks;
  const b = [];
  if (entry.thinking) b.push({ thinking: entry.thinking });
  if (entry.text !== undefined) b.push({ text: entry.text });
  if (entry.tool_use) b.push({ tool_use: entry.tool_use });
  return b.length ? b : [{ text: '' }];
}
function toolName(tu, offered) {
  if (Array.isArray(tu.nameAny)) return tu.nameAny.find((n) => offered.includes(n)) ?? tu.nameAny[0];
  return tu.name;
}
function contentBlocks(entry, offered) {
  return blocksOf(entry).map((b) => {
    if (b.tool_use) {
      toolSeq += 1;
      return { type: 'tool_use', id: b.tool_use.id || `toolu_rig${String(toolSeq).padStart(6, '0')}`, name: toolName(b.tool_use, offered), input: b.tool_use.input || {} };
    }
    if (b.thinking !== undefined) return { type: 'thinking', thinking: b.thinking, signature: 'rigsig' };
    return { type: 'text', text: b.text ?? '' };
  });
}
/** Headers with `$NOW+<s>` values resolved to epoch seconds. */
function resolveHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    const m = typeof v === 'string' ? /^\$NOW\+(\d+)$/.exec(v) : null;
    out[k] = m ? String(Math.floor(Date.now() / 1000) + Number(m[1])) : v;
  }
  return out;
}
function chunks(s, n = 12) { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out.length ? out : ['']; }

async function answer(res, req, entry) {
  if (entry.hang_ms !== undefined) {
    if (entry.hang_ms < 0) { log(`  #${req.n} hanging forever`); return; }
    await sleep(entry.hang_ms);
  }
  const extra = resolveHeaders(entry.headers);
  if (entry.status && entry.status >= 400) {
    const type = { 401: 'authentication_error', 429: 'rate_limit_error', 529: 'overloaded_error', 500: 'api_error' }[entry.status] || 'api_error';
    res.writeHead(entry.status, { 'content-type': 'application/json', 'request-id': `req_rig${req.n}`, ...extra });
    res.end(JSON.stringify(entry.body ?? { type: 'error', error: { type, message: `mock ${entry.status}` } }));
    return;
  }
  const model = req.body.model || 'claude-mock';
  const blocks = contentBlocks(entry, req.tools);
  const stop = entry.stop_reason || (blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn');
  const usage = { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...(entry.usage || {}) };
  const outTokens = Math.max(1, JSON.stringify(blocks).length >> 2);
  const hdrs = { 'request-id': `req_rig${req.n}`, 'anthropic-organization-id': '00000000-0000-0000-0000-000000000000', ...extra };
  const id = `msg_rig${req.n}`;
  if (!req.body.stream) {
    res.writeHead(200, { 'content-type': 'application/json', ...hdrs });
    res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model, content: blocks, stop_reason: stop, stop_sequence: null, usage: { ...usage, output_tokens: outTokens } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...hdrs });
  const ev = (type, data) => { if (!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`); };
  const gap = entry.chunk_ms ?? 15;
  let first = true;
  const afterDelta = async () => {
    if (first && entry.stall_ms !== undefined) { first = false; if (entry.stall_ms < 0) await new Promise(() => {}); await sleep(entry.stall_ms); }
    first = false;
    if (gap) await sleep(gap);
  };
  ev('message_start', { message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } });
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (b.type === 'text') {
      ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      for (const c of chunks(b.text)) { ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: c } }); await afterDelta(); }
    } else if (b.type === 'thinking') {
      ev('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '', signature: '' } });
      for (const c of chunks(b.thinking)) { ev('content_block_delta', { index: i, delta: { type: 'thinking_delta', thinking: c } }); await afterDelta(); }
      ev('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: 'rigsig' } });
    } else {
      ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      for (const c of chunks(JSON.stringify(b.input), 20)) { ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: c } }); await afterDelta(); }
    }
    ev('content_block_stop', { index: i });
  }
  ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: outTokens } });
  ev('message_stop', {});
  res.end();
}

const server = http.createServer((rq, res) => {
  const chunksIn = [];
  rq.on('data', (c) => chunksIn.push(c));
  rq.on('end', async () => {
    seq += 1;
    const n = seq;
    const raw = Buffer.concat(chunksIn).toString('utf8');
    const url = new URL(rq.url, 'http://x');
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-json */ }
    try {
      if (url.pathname === '/__rig/reset') { consumed = new Set(); consumedLabels.length = 0; res.end('ok\n'); return; }
      if (url.pathname === '/__rig/state') {
        const s = loadScript();
        res.setHeader('content-type', 'application/json');
        res.end(`${JSON.stringify({ script: path.basename(SCRIPT), entries: s.entries.length, consumed: [...consumed], consumedLabels, requests: seq - 1 })}\n`);
        return;
      }
      if (rq.method === 'POST' && url.pathname === '/v1/messages/count_tokens') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: Math.max(1, raw.length >> 2) }));
        return;
      }
      if (rq.method === 'POST' && url.pathname === '/v1/messages') {
        const { kind, tools, sys } = classify(body);
        const req = { n, body, kind, tools, sys };
        const { entry, label } = pick(req);
        log(`#${n} MESSAGES kind=${kind} tools=${tools.length} -> ${label}${entry.label ? ` (${entry.label})` : ''} prompt="${userPrompt(body).replace(/\s+/g, ' ').slice(0, 100)}"`);
        if (REQDIR !== '') fs.writeFileSync(path.join(REQDIR, `${String(n).padStart(4, '0')}-${kind}.json`), JSON.stringify({ n, url: rq.url, kind, picked: label, body }, null, 1));
        await answer(res, req, entry);
        return;
      }
      if (url.pathname === '/api/hello') { res.writeHead(200); res.end(); return; }
      log(`#${n} UNHANDLED ${rq.method} ${rq.url} -> 404`);
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `mock: no route ${rq.method} ${url.pathname}` } }));
    } catch (e) {
      log(`#${n} MOCK ERROR ${e.stack}`);
      try { res.writeHead(500); res.end(); } catch { /* already streaming */ }
    }
  });
});
server.on('error', (e) => { process.stderr.write(`mockapi: ${e.message}\n`); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => { process.stdout.write(`mock listening 127.0.0.1:${server.address().port}\n`); });
