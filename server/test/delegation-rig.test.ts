// The delegation broker's capture rig (wave 1, spec 2026-10-04 §8.1-§8.2): the mock Anthropic
// API, the driver's guards and setup, the sanitiser and the matrix builder. Hermetic: no row
// starts Claude Code, names the real HOME, or touches any tmux server.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const RIG = path.resolve(__dirname, 'delegation-rig');
const MOCK = path.join(RIG, 'mockapi.mjs');

const children: ChildProcess[] = [];
afterEach(() => { for (const c of children.splice(0)) c.kill('SIGKILL'); });

/** Start the mock on an ephemeral port with `script` as its MOCK_SCRIPT; resolves to its base URL. */
async function startMock(script: object): Promise<string> {
  const dir = mkTmp('ccrc-dlg-mock-');
  const file = path.join(dir, 'script.json');
  fs.writeFileSync(file, JSON.stringify(script));
  const child = spawn(process.execPath, [MOCK], { env: { ...process.env, MOCK_PORT: '0', MOCK_SCRIPT: file }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const port = await new Promise<string>((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`mock did not start: ${out}`)), 10_000);
    child.stdout!.on('data', (b: Buffer) => {
      out += b.toString();
      const m = /^mock listening 127\.0\.0\.1:(\d+)$/m.exec(out);
      if (m) { clearTimeout(t); resolve(m[1] as string); }
    });
  });
  return `http://127.0.0.1:${port}`;
}

const MAIN_SYSTEM = [{ type: 'text', text: 'You are an interactive agent that helps users.' }];
const SUB_SYSTEM = [{ type: 'text', text: 'x-anthropic-billing-header: cc_is_subagent=true;' }];
const messages = (base: string, body: object): Promise<Response> =>
  fetch(`${base}/v1/messages?beta=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** The SSE stream as its parsed `data:` objects, in order. */
const events = async (r: Response): Promise<Array<Record<string, any>>> =>
  (await r.text()).split('\n\n').filter((b) => b.includes('data: ')).map((b) => JSON.parse(b.slice(b.indexOf('data: ') + 6)));

describe('mockapi.mjs (the rig\'s mock Anthropic API)', () => {
  it('answers the connectivity probe, and 404s an unknown route', async () => {
    const base = await startMock({ entries: [] });
    expect((await fetch(`${base}/api/hello`, { method: 'HEAD' })).status).toBe(200);
    expect((await fetch(`${base}/v1/nope`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('streams a scripted tool_use as message_start … input_json_delta … message_stop, stop_reason tool_use', async () => {
    const input = { description: 'dlg', prompt: 'dlg-sub', isolation: 'worktree' };
    const base = await startMock({ entries: [{ label: 'call', match: { kind: 'tools', lastUser: '^dlg go$' }, tool_use: { name: 'Agent', input } }] });
    const r = await messages(base, { model: 'm', stream: true, system: MAIN_SYSTEM, tools: [{ name: 'Agent' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'dlg go' }] }] });
    const ev = await events(r);
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(['message_start', 'content_block_start', 'content_block_stop', 'message_delta', 'message_stop']));
    const start = ev.find((e) => e.type === 'content_block_start');
    expect(start?.content_block).toMatchObject({ type: 'tool_use', name: 'Agent' });
    const json = ev.filter((e) => e.delta?.type === 'input_json_delta').map((e) => e.delta.partial_json).join('');
    expect(JSON.parse(json)).toEqual(input);
    expect(ev.find((e) => e.type === 'message_delta')?.delta.stop_reason).toBe('tool_use');
  });

  it('nameAny picks the first name the request offers', async () => {
    const base = await startMock({ entries: [{ match: { kind: 'tools' }, tool_use: { nameAny: ['Agent', 'Task'], input: {} }, repeat: true }] });
    const ask = async (tools: string[]): Promise<string> => {
      const ev = await events(await messages(base, { model: 'm', stream: true, system: MAIN_SYSTEM,
        tools: tools.map((name) => ({ name })), messages: [{ role: 'user', content: 'x' }] }));
      return ev.find((e) => e.type === 'content_block_start')?.content_block.name;
    };
    expect(await ask(['Bash', 'Task'])).toBe('Task');
    expect(await ask(['Agent', 'Task'])).toBe('Agent');
  });

  it('matches a subagent request by its billing-header marker, and a tool_result by its text', async () => {
    const base = await startMock({ entries: [
      { label: 'sub', match: { kind: 'sub', lastUser: 'DLG-ACK-1' }, text: 'DLG-SUB-DONE' },
    ] });
    const ev = await events(await messages(base, { model: 'm', stream: true, system: SUB_SYSTEM, tools: [{ name: 'Bash' }],
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'DLG-ACK-1\n' }] }] }));
    expect(ev.filter((e) => e.delta?.type === 'text_delta').map((e) => e.delta.text).join('')).toBe('DLG-SUB-DONE');
  });

  it('reports consumed labels, and never consumes a repeat entry', async () => {
    const base = await startMock({ entries: [
      { label: 'once', match: { kind: 'tools', lastUser: '^a$' }, text: 'A' },
      { label: 'always', match: { kind: 'tools', lastUser: '^b$' }, text: 'B', repeat: true },
    ] });
    const ask = (t: string): Promise<Response> => messages(base, { model: 'm', stream: false, system: MAIN_SYSTEM, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: t }] });
    await (await ask('a')).text();
    await (await ask('b')).text();
    await (await ask('b')).text();
    const state = await (await fetch(`${base}/__rig/state`)).json() as { consumedLabels: string[]; requests: number };
    expect(state.consumedLabels).toEqual(['once']);
  });

  it('synthesises a side request\'s JSON from its schema', async () => {
    const base = await startMock({ entries: [] });
    const r = await messages(base, { model: 'm', stream: false, system: 'title', messages: [{ role: 'user', content: 'x' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { title: { type: 'string' } } } } } });
    const body = await r.json() as { content: Array<{ text: string }> };
    expect(JSON.parse(body.content[0]!.text)).toEqual({ title: 'Rig session' });
  });

  it('replaces a $NOW+<s> header value with an epoch second', async () => {
    const base = await startMock({ entries: [{ match: { kind: 'tools' }, status: 429, headers: { 'anthropic-ratelimit-unified-reset': '$NOW+60' } }] });
    const before = Math.floor(Date.now() / 1000);
    const r = await messages(base, { model: 'm', stream: true, system: MAIN_SYSTEM, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'x' }] });
    expect(r.status).toBe(429);
    const reset = Number(r.headers.get('anthropic-ratelimit-unified-reset'));
    expect(reset).toBeGreaterThanOrEqual(before + 59);
    expect(reset).toBeLessThanOrEqual(before + 62);
  });

  it('refuses to start without MOCK_SCRIPT, and writes no file when MOCK_LOG and MOCK_REQDIR are unset', () => {
    const r = spawnSync(process.execPath, [MOCK], { env: { ...process.env, MOCK_SCRIPT: '', MOCK_PORT: '0' }, encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(2);
    expect(fs.readdirSync(RIG).filter((n) => /\.log$|^reqs/.test(n))).toEqual([]);
  });
});
