#!/usr/bin/env node
// door-stub.mjs — a stand-in for the Overlord's door process (spec 2026-11-09 §3.6, H4), for the W0 rig's ov-door
// scenario: a stdio MCP server speaking newline-delimited JSON-RPC 2.0. Tools `card` (text holding W0-CARD-CANARY),
// `read` (one record as text) and `act` (`ok`). Each request is logged to $DOOR_LOG as
// {"t":<ms>,"method":…,"tool":…,"nonce":"present"|"absent"}: DOOR_NONCE's PRESENCE only, never its value.
import readline from 'node:readline';
import { logLine } from './log.mjs';

const TOOLS = [
  { name: 'card', description: 'The W0 door card.', inputSchema: { type: 'object', properties: {} } },
  { name: 'read', description: 'Read one W0 record.', inputSchema: { type: 'object', properties: {} } },
  { name: 'act', description: 'Do one W0 act.', inputSchema: { type: 'object', properties: {} } },
];
const TEXT = { card: 'W0-CARD-CANARY: the door card.', read: '{"kind":"record","id":"r-1"}', act: 'ok' };
const nonce = process.env.DOOR_NONCE ? 'present' : 'absent';

function reply(id, result, error) {
  process.stdout.write(`${JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result })}\n`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  const tool = m.method === 'tools/call' ? (m.params?.name ?? null) : null;
  logLine('DOOR_LOG', { t: Date.now(), method: m.method ?? null, tool, nonce });
  if (m.id === undefined || m.id === null) return; // a notification: no reply
  switch (m.method) {
    case 'initialize':
      reply(m.id, { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'w0-door', version: '0.0.1' } });
      break;
    case 'tools/list':
      reply(m.id, { tools: TOOLS });
      break;
    case 'tools/call':
      if (tool in TEXT) reply(m.id, { content: [{ type: 'text', text: TEXT[tool] }] });
      else reply(m.id, undefined, { code: -32602, message: `unknown tool ${tool}` });
      break;
    case 'ping':
      reply(m.id, {});
      break;
    default:
      reply(m.id, undefined, { code: -32601, message: `method not found: ${m.method}` });
  }
});
