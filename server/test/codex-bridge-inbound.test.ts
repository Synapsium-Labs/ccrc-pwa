// codex-bridge-inbound.test.ts — inbound: an Anthropic request becomes a neutral request,
// `ccd/codexbridge/inbound.py` (codex-bridge Stage 2 plan 2026-10-22, Task 2 and "The bridge's contract": the neutral
// request; spec 2026-10-15 §2.3, §2.5; D-6417, D-6425, D-6426, D-6427).
//
// One case per row of the plan's mapping table, then the plan's named cases. Every case runs the package through
// `runBridgeDriver`'s `from-anthropic` op in a mkTmp HOME, with both endpoint variables at a closed loopback URL;
// nothing here makes a request. The reasoning store is a lookup stub the driver keys with the module's own
// `call_key`/`text_key`, so no case spells a key itself. Model ids and tool ids are neutral fixtures.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { pythonOrSkip } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
import { driverLines, runBridgeDriver } from './codexBridgeFixture.js';

const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Line = Record<string, any>;

async function run(ops: object[]): Promise<Line[]> {
  const r = await runBridgeDriver(mkTmp('cb-in-'), { ops });
  expect(r.timedOut, r.stderr).toBe(false);
  const lines = driverLines(r.stdout);
  expect(lines.map((l) => l.op), `${r.stdout}\n${r.stderr}`).toEqual(ops.map((o) => (o as { op: string }).op));
  for (const l of lines) expect(l.raised, JSON.stringify(l)).toBeUndefined();
  return lines;
}

const MODEL = 'model-6.1-alpha';
const SESSION = 'x-claude-code-session-id';
const AGENT = 'x-claude-code-agent-id';
const BILLING = (suffix: string): string => `x-anthropic-billing-header: cc_version=2.1.308.${suffix}; cc_entrypoint=cli;`;
const MARKER = 'CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.';

const body = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  model: MODEL, messages: [{ role: 'user', content: 'hi' }], ...o,
});
const op = (b: Record<string, unknown>, o: Record<string, unknown> = {}): object => ({ op: 'from-anthropic', body: b, ...o });
async function one(b: Record<string, unknown>, o: Record<string, unknown> = {}): Promise<Line> {
  const [line] = await run([op(b, o)]);
  return line;
}

const inText = (text: string): object => ({ type: 'input_text', text });
const dev = (text: string): object => ({ type: 'message', role: 'developer', content: [inText(text)] });
const user = (...parts: object[]): object => ({ type: 'message', role: 'user', content: parts });
const userText = (text: string): object => user(inText(text));
const asst = (text: string, phase?: string): object => ({
  type: 'message', role: 'assistant', content: [{ type: 'output_text', text }], ...(phase ? { phase } : {}),
});
const call = (id: string, name: string, args: string): object => ({ type: 'function_call', call_id: id, name, arguments: args });
const out = (id: string, output: unknown): object => ({ type: 'function_call_output', call_id: id, output });
const rs = (n: number): object => ({ type: 'reasoning', id: `rs_fx${n}`, summary: [], encrypted_content: `ENC-${n}` });
const png = (data: string): object => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
const inImage = (url: string): object => ({ type: 'input_image', image_url: url, detail: 'auto' });

/** The names a case counted under one family, in order. */
const fam = (l: Line, family: string): string[] =>
  (l.names as Array<[string, string]>).filter(([f]) => f === family).map(([, v]) => v);
const has = (l: Line, family: string, value: string): boolean =>
  (l.names as Array<[string, string]>).some(([f, v]) => f === family && v === value);

/** The neutral request's fields, exactly (the plan's "The neutral request"). */
const NEUTRAL_FIELDS = [
  'model', 'developer', 'items', 'tools', 'name_map', 'tool_choice', 'parallel_tool_calls', 'effort', 'output_format',
  'cache_key', 'session_id', 'stream', 'compaction', 'countable_bytes', 'image_count', 'tools_required',
];

const sha8 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8);

describe.skipIf(!PY)('inbound: the mapping table (codex-bridge spec §2.3)', () => {
  it('system blocks or a string become the developer text, items[0], the billing block removed, requestField:system counted', async () => {
    const [blocks, str, none] = await run([
      op(body({
        system: [
          { type: 'text', text: BILLING('a1b') },
          { type: 'text', text: 'You are a helper.', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'Second part.', cache_control: { type: 'ephemeral', ttl: '1h' } },
        ],
      })),
      op(body({ system: 'Plain system.' })),
      op(body()),
    ]);
    expect(blocks.request.developer).toBe('You are a helper.\n\nSecond part.');
    expect(blocks.request.items).toEqual([dev('You are a helper.\n\nSecond part.'), userText('hi')]);
    expect(fam(blocks, 'requestField')).toEqual(['system']);
    expect(JSON.stringify(blocks.request)).not.toContain('cache_control');
    expect(JSON.stringify(blocks.request)).not.toContain('billing');
    expect(str.request.developer).toBe('Plain system.');
    expect(str.request.items[0]).toEqual(dev('Plain system.'));
    expect(none.request.developer).toBeNull();
    expect(none.request.items).toEqual([userText('hi')]);
    expect(fam(none, 'requestField')).toEqual([]);
  });

  it('a mid-conversation system entry is a developer message in place; [] and empty text are no item', async () => {
    const l = await one(body({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'system', content: 'mid string' },
        { role: 'assistant', content: 'ok' },
        { role: 'system', content: [{ type: 'text', text: 'mid blocks' }] },
        { role: 'system', content: [] },
        { role: 'system', content: '' },
        { role: 'system', content: [{ type: 'text', text: '' }] },
        { role: 'user', content: 'b' },
      ],
    }));
    expect(l.request.items).toEqual([userText('a'), dev('mid string'), asst('ok'), dev('mid blocks'), userText('b')]);
  });

  it('user text and images are a user message of input_text and input_image', async () => {
    const l = await one(body({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          png('AAAA'),
          { type: 'image', source: { type: 'url', url: 'https://example.invalid/a.png' } },
        ],
      }],
    }));
    expect(l.request.items).toEqual([
      user(inText('look'), inImage('data:image/png;base64,AAAA'), inImage('https://example.invalid/a.png')),
    ]);
    expect(l.request.image_count).toBe(2);
  });

  it('a user document is capability_rejected: document_block', async () => {
    const l = await one(body({
      messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'doc-body-sentinel' } }] }],
    }));
    expect(l.error.status).toBe(400);
    expect(l.error.etype).toBe('invalid_request_error');
    expect(l.error.message.startsWith('capability_rejected: document_block')).toBe(true);
    expect(JSON.stringify(l)).not.toContain('doc-body-sentinel');
    expect(fam(l, 'unsupportedField')).toEqual(['document']);
  });

  it('assistant text is an output_text message, its phase replayed from the stored turn', async () => {
    const msgs = [{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'text', text: 'Here it is.' }] }, { role: 'user', content: 'thanks' }];
    const [stored, bare] = await run([
      op(body({ messages: msgs }), { headers: { [SESSION]: 's-1' }, stored: [{ session: 's-1', text: 'Here it is.', turn: { items: [], phase: 'final_answer' } }] }),
      op(body({ messages: msgs }), { headers: { [SESSION]: 's-1' } }),
    ]);
    expect(stored.request.items).toEqual([userText('q'), asst('Here it is.', 'final_answer'), userText('thanks')]);
    expect(bare.request.items).toEqual([userText('q'), asst('Here it is.'), userText('thanks')]);
  });

  // The row `assistant thinking, redacted_thinking` is the named case 'a history from a Claude lane translates' below.

  it('assistant tool_use is a function_call, its id unchanged and its input as JSON arguments', async () => {
    const l = await one(body({
      messages: [
        { role: 'user', content: 'read it' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_fx1', name: 'Read', input: { file_path: 'notes.txt', limit: 5 } },
            { type: 'tool_use', id: 'call_fx2', name: 'Noop' },
          ],
        },
      ],
    }));
    expect(l.request.items).toEqual([
      userText('read it'),
      call('call_fx1', 'Read', '{"file_path":"notes.txt","limit":5}'),
      call('call_fx2', 'Noop', '{}'),
    ]);
  });

  // The rows `assistant tool_use … preceded by the stored reasoning items` and `assistant text … preceded by the
  // stored reasoning items` are the named case 'stored reasoning is re-inserted …' below.

  it('a tool_result is a function_call_output: is_error dropped and counted, its text kept, no size cap', async () => {
    const big = 'x'.repeat(700_000);
    const l = await one(body({
      messages: [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_fx3', content: 'boom: exit 1', is_error: true },
          { type: 'tool_result', tool_use_id: 'call_fx4', content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] },
          { type: 'tool_result', tool_use_id: 'call_fx5', content: big },
          { type: 'tool_result', tool_use_id: 'call_fx6' },
          { type: 'text', text: 'and more' },
        ],
      }],
    }));
    expect(l.request.items).toEqual([
      out('call_fx3', 'boom: exit 1'),
      out('call_fx4', [inText('line1'), inText('line2')]),
      out('call_fx5', big),
      out('call_fx6', ''),
      userText('and more'),
    ]);
    expect(fam(l, 'requestField')).toEqual(['is_error']);
    expect(JSON.stringify(l.request.items)).not.toContain('is_error');
  });

  it('tools are top-level functions; DeferredToolPlaceholder and defer_loading dropped; required ones tracked', async () => {
    const readSchema = { type: 'object', properties: { p: { type: 'string' } }, required: ['p'] };
    const l = await one(body({
      tools: [
        { name: 'Read', description: 'Reads a file', input_schema: readSchema, cache_control: { type: 'ephemeral' } },
        { name: 'Glob', description: 'Globs', input_schema: { type: 'object', properties: {} }, defer_loading: true },
        { name: 'DeferredToolPlaceholder', description: 'placeholder', input_schema: { type: 'object' } },
        { type: 'custom', name: 'Opt', description: 'optional args', input_schema: { type: 'object', properties: {}, required: [] } },
      ],
    }));
    expect(l.request.tools).toEqual([
      { type: 'function', name: 'Read', description: 'Reads a file', parameters: readSchema, strict: false },
      { type: 'function', name: 'Glob', description: 'Globs', parameters: { type: 'object', properties: {} }, strict: false },
      { type: 'function', name: 'Opt', description: 'optional args', parameters: { type: 'object', properties: {}, required: [] }, strict: false },
    ]);
    expect(l.request.tools_required).toEqual(['Read']);
    expect(fam(l, 'requestField')).toEqual(['defer_loading']);
  });

  it('a server tool is a plain 400 naming its type, with x-should-retry false', async () => {
    const l = await one(body({ tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] }));
    expect(l.error.status).toBe(400);
    expect(l.error.etype).toBe('invalid_request_error');
    expect(l.error.headers).toEqual({ 'x-should-retry': 'false' });
    expect(l.error.message).toContain('web_search_20250305');
    expect(l.error.message.startsWith('capability_rejected')).toBe(false);
    expect(fam(l, 'unsupportedField')).toEqual(['web_search_20250305']);
  });

  it('tool_choice maps auto, any, tool and none, and is None when absent', async () => {
    const lines = await run([
      op(body({ tool_choice: { type: 'auto' } })),
      op(body({ tool_choice: { type: 'any' } })),
      op(body({ tool_choice: { type: 'tool', name: 'Read' } })),
      op(body({ tool_choice: { type: 'none' } })),
      op(body()),
    ]);
    expect(lines.map((l) => l.request.tool_choice)).toEqual(['auto', 'required', { type: 'function', name: 'Read' }, 'none', null]);
  });

  it('disable_parallel_tool_use sets parallel_tool_calls, which defaults to true', async () => {
    const lines = await run([
      op(body()),
      op(body({ tool_choice: { type: 'auto', disable_parallel_tool_use: true } })),
      op(body({ tool_choice: { type: 'any', disable_parallel_tool_use: false } })),
    ]);
    expect(lines.map((l) => l.request.parallel_tool_calls)).toEqual([true, false, true]);
  });

  it('reasoning.effort, set by the effort hook, is the effort', async () => {
    const [set, unset] = await run([op(body({ reasoning: { effort: 'high' } })), op(body())]);
    expect(set.request.effort).toBe('high');
    expect(unset.request.effort).toBeNull();
    expect(fam(set, 'requestField')).toEqual([]);
  });

  // The rows `output_config.format` json_schema, another type, and every other `output_config` key are the two named
  // output_config cases below.

  it('the session and agent headers give session_id and the cache key', async () => {
    const [both, sessionOnly, cased, none1, none2] = await run([
      op(body(), { headers: { [SESSION]: 'sess-1', [AGENT]: 'agent-2' } }),
      op(body(), { headers: { [SESSION]: 'sess-1' } }),
      op(body(), { headers: { 'X-Claude-Code-Session-Id': 'sess-3' } }),
      op(body(), { headers: { [AGENT]: 'agent-2' } }),
      op(body()),
    ]);
    expect([both.request.session_id, both.request.cache_key]).toEqual(['sess-1', 'ccrc:sess-1:agent-2']);
    expect([sessionOnly.request.session_id, sessionOnly.request.cache_key]).toEqual(['sess-1', 'ccrc:sess-1']);
    expect([cased.request.session_id, cased.request.cache_key]).toEqual(['sess-3', 'ccrc:sess-3']);
    expect(none1.request.session_id).toBeNull();
    expect(none1.request.cache_key).toMatch(/^ccrc:anon-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(none2.request.cache_key).toMatch(/^ccrc:anon-/);
    expect(none2.request.cache_key).not.toBe(none1.request.cache_key);
  });

  it('the sampling fields and the rest are dropped on the backend route too, each counted (D-6426)', async () => {
    const dropped = {
      max_tokens: 32000, temperature: 1, top_p: 0.9, top_k: 5, metadata: { user_id: 'meta-sentinel' },
      stop_sequences: ['stop-sentinel'], service_tier: 'auto', mcp_servers: [], container: 'container-sentinel',
    };
    const l = await one(body(dropped));
    // the driver prints with sorted keys, so the field set is compared, not its order
    expect(Object.keys(l.request).sort()).toEqual([...NEUTRAL_FIELDS].sort());
    expect(fam(l, 'requestField').sort()).toEqual(Object.keys(dropped).sort());
    const text = JSON.stringify(l);
    for (const s of ['max_output_tokens', 'meta-sentinel', 'stop-sentinel', 'container-sentinel', '32000']) expect(text).not.toContain(s);
  });

  it('context_management is dropped and each edit type counted (D-6417)', async () => {
    const [withEdits, without] = await run([
      op(body({
        context_management: { edits: [{ type: 'clear_thinking_20251015', keep: 'all' }, { type: 'clear_tool_uses_20250919' }] },
      })),
      op(body()),
    ]);
    expect(fam(withEdits, 'contextEdit')).toEqual(['clear_thinking_20251015', 'clear_tool_uses_20250919']);
    expect(withEdits.request.items).toEqual(without.request.items);
    expect(fam(withEdits, 'requestField')).toEqual([]);
  });

  it('anthropic-beta values are consumed and counted', async () => {
    const l = await one(body(), { headers: { 'anthropic-beta': 'claude-code-20250219, interleaved-thinking-2025-05-14,' } });
    expect(fam(l, 'betaValue')).toEqual(['claude-code-20250219', 'interleaved-thinking-2025-05-14']);
  });

  // The row `any other top-level key` is the named case 'an unknown top-level key …' below.

  it('stream is carried as sent; absent is false', async () => {
    const lines = await run([op(body({ stream: true })), op(body({ stream: false })), op(body())]);
    expect(lines.map((l) => l.request.stream)).toEqual([true, false, false]);
  });

  // The row `the last user turn holding COMPACTION_MARKER` is the named case 'the compaction request …' below.
});

describe.skipIf(!PY)('inbound: the named cases (codex-bridge plan Task 2)', () => {
  it('the billing line never reaches the developer message, so its varying suffix cannot break the prefix cache', async () => {
    const sys = (suffix: string): object[] => [{ type: 'text', text: BILLING(suffix) }, { type: 'text', text: 'Stable system.' }];
    const [a, b] = await run([op(body({ system: sys('a1b') })), op(body({ system: sys('f00') }))]);
    expect(a.request.developer).toBe('Stable system.');
    expect(JSON.stringify(a.request.developer)).toBe(JSON.stringify(b.request.developer));
    expect(JSON.stringify(a.request.items)).toBe(JSON.stringify(b.request.items));
    expect(JSON.stringify(a.request.items)).not.toContain('x-anthropic-billing-header');
  });

  it('a history from a Claude lane translates', async () => {
    const cc = { type: 'ephemeral' };
    const l = await one(body({
      system: [{ type: 'text', text: 'Sys.', cache_control: cc }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'run it', cache_control: cc }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'thought-sentinel', signature: 'signature-sentinel' },
            { type: 'redacted_thinking', data: 'redacted-sentinel' },
            { type: 'text', text: 'Running.', cache_control: cc },
            { type: 'tool_use', id: 'toolu_fx1', name: 'Bash', input: { command: 'ls' }, cache_control: cc },
          ],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fx1', content: 'a.txt', cache_control: cc }] },
      ],
    }));
    expect(l.error).toBeUndefined();
    expect(l.request.items).toEqual([
      dev('Sys.'), userText('run it'), asst('Running.'), call('toolu_fx1', 'Bash', '{"command":"ls"}'), out('toolu_fx1', 'a.txt'),
    ]);
    expect(fam(l, 'requestField')).toEqual(['system', 'thinking-block', 'thinking-block']);
    const text = JSON.stringify(l.request);
    for (const s of ['thought-sentinel', 'signature-sentinel', 'redacted-sentinel', 'cache_control']) expect(text).not.toContain(s);
  });

  it('a 70-character tool name is cut to 64 and mapped back', async () => {
    const long1 = 'mcp__server__' + 'a'.repeat(52) + 'tool1';
    const long2 = 'mcp__server__' + 'a'.repeat(52) + 'tool2';
    expect(long1.length).toBe(70);
    const schema = { type: 'object', properties: {} };
    const [l, keys] = await run([
      op(body({
        tools: [{ name: long1, description: 'one', input_schema: schema }, { name: long2, description: 'two', input_schema: schema }],
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'call_fx9', name: long1, input: {} }] },
        ],
      })),
      { op: 'inbound-keys', cut: [long1, long2] },
    ]);
    const cut1 = long1.slice(0, 55) + '_' + sha8(long1);
    const cut2 = long2.slice(0, 55) + '_' + sha8(long2);
    expect(cut1).toHaveLength(64);
    expect(cut1).not.toBe(cut2);
    expect(keys.cut).toEqual([cut1, cut2]);
    expect(l.request.tools.map((t: { name: string }) => t.name)).toEqual([cut1, cut2]);
    expect(l.request.name_map[cut1]).toBe(long1);
    expect(l.request.name_map[cut2]).toBe(long2);
    expect(l.request.items[1]).toEqual(call('call_fx9', cut1, '{}'));
  });

  it('a ToolSearch round trip keeps the loaded tool callable', async () => {
    const schema = { type: 'object', properties: { url: { type: 'string' } } };
    const l = await one(body({
      tools: [
        { name: 'ToolSearch', description: 'search tools', input_schema: { type: 'object', properties: {} } },
        { name: 'DeferredToolPlaceholder', description: 'placeholder', input_schema: { type: 'object' }, defer_loading: true },
        { name: 'mcp__srv__fetch', description: 'Fetch', input_schema: schema, defer_loading: true },
      ],
      messages: [
        { role: 'user', content: 'fetch it' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_fx6', name: 'ToolSearch', input: { query: 'select:mcp__srv__fetch' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_fx6', content: [{ type: 'tool_reference', tool_name: 'mcp__srv__fetch' }] }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_fx7', name: 'mcp__srv__fetch', input: { url: 'u' } }] },
      ],
    }));
    expect(l.request.items[2]).toEqual(out('call_fx6', [inText('Tool loaded: mcp__srv__fetch')]));
    expect(l.request.items[3]).toEqual(call('call_fx7', 'mcp__srv__fetch', '{"url":"u"}'));
    expect(l.request.tools).toContainEqual({ type: 'function', name: 'mcp__srv__fetch', description: 'Fetch', parameters: schema, strict: false });
    expect(l.request.tools.map((t: { name: string }) => t.name)).not.toContain('DeferredToolPlaceholder');
    const text = JSON.stringify(l.request);
    expect(text).not.toContain('defer_loading');
    expect(text).not.toContain('tool_reference');
  });

  it('an image in a tool result is an input_image inside function_call_output', async () => {
    const l = await one(body({
      messages: [{
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_fx3', content: [{ type: 'text', text: 'screenshot' }, png('BBBB')] }],
      }],
    }));
    expect(l.request.items).toEqual([out('call_fx3', [inText('screenshot'), inImage('data:image/png;base64,BBBB')])]);
    expect(l.request.image_count).toBe(1);
  });

  it('the compaction request is recognised by its marker', async () => {
    const [last, earlier, plain] = await run([
      op(body({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: [{ type: 'text', text: `${MARKER}\n\nSummarise.` }] }] })),
      op(body({ messages: [{ role: 'user', content: MARKER }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] })),
      op(body()),
    ]);
    expect([last.request.compaction, earlier.request.compaction, plain.request.compaction]).toEqual([true, false, false]);
  });

  it('stored reasoning is re-inserted just before the call it preceded, and before the text it preceded', async () => {
    const l = await one(body({
      messages: [
        { role: 'user', content: 'start' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_fx2', name: 'Bash', input: { command: 'ls' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_fx2', content: 'a.txt' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'All done.' }] },
        { role: 'user', content: 'ok' },
      ],
    }), {
      headers: { [SESSION]: 's-1' },
      stored: [
        { call: 'call_fx2', turn: { items: [rs(1)], phase: null } },
        { session: 's-1', text: 'All done.', turn: { items: [rs(2)], phase: 'final_answer' } },
      ],
    });
    expect(l.request.items).toEqual([
      userText('start'), rs(1), call('call_fx2', 'Bash', '{"command":"ls"}'), out('call_fx2', 'a.txt'),
      rs(2), asst('All done.', 'final_answer'), userText('ok'),
    ]);
  });

  it('a mixed turn replays in upstream order', async () => {
    const l = await one(body({
      messages: [
        { role: 'user', content: 'start' },
        { role: 'assistant', content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 'call_fx8', name: 'Bash', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_fx8', content: 'ok' }] },
      ],
    }), {
      headers: { [SESSION]: 's-1' },
      stored: [
        { session: 's-1', text: 'Let me look.', turn: { items: [rs(1)], phase: 'commentary' } },
        { call: 'call_fx8', turn: { items: [rs(2)] } },
      ],
    });
    expect(l.request.items).toEqual([
      userText('start'), rs(1), asst('Let me look.', 'commentary'), rs(2), call('call_fx8', 'Bash', '{}'), out('call_fx8', 'ok'),
    ]);
  });

  it('a repeated text replays its stored reasoning once, before its latest occurrence', async () => {
    const l = await one(body({
      messages: [
        { role: 'user', content: 'one' }, { role: 'assistant', content: 'Done.' },
        { role: 'user', content: 'two' }, { role: 'assistant', content: 'Done.' },
        { role: 'user', content: 'three' },
      ],
    }), { headers: { [SESSION]: 's-1' }, stored: [{ session: 's-1', text: 'Done.', turn: { items: [rs(3)], phase: 'final_answer' } }] });
    expect(l.request.items).toEqual([
      userText('one'), asst('Done.', 'final_answer'), userText('two'), rs(3), asst('Done.', 'final_answer'), userText('three'),
    ]);
  });

  it('text_key is a session-scoped hash and holds no text', async () => {
    const [k] = await run([{ op: 'inbound-keys', text: [['s', 'hello'], ['t', 'hello'], [null, 'hello']], call: ['call_fx1'] }]);
    const [s, t, anon] = k.text as string[];
    expect(s).toMatch(/^text:[0-9a-f]{64}$/);
    expect(t).toMatch(/^text:[0-9a-f]{64}$/);
    expect(s).not.toBe(t);
    expect(s).toBe('text:' + createHash('sha256').update('s\0hello', 'utf8').digest('hex'));
    expect(anon).toBe('text:' + createHash('sha256').update('\0hello', 'utf8').digest('hex'));
    expect(JSON.stringify(k.text)).not.toContain('hello');
    expect(k.call).toEqual(['call:call_fx1']);
  });

  it('an unknown top-level key is dropped and its name counted, never its value', async () => {
    const l = await one(body({ frobnicate: 'value-sentinel-9', nested_thing: { deep: 'value-sentinel-10' } }));
    expect(fam(l, 'requestField')).toEqual(['frobnicate', 'nested_thing']);
    const text = JSON.stringify(l);
    expect(text).not.toContain('value-sentinel');
  });

  it('output_config.format json_schema becomes output_format; any other key is counted', async () => {
    const S = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
    const [l, none] = await run([
      op(body(), { output_config: { effort: 'high', format: { type: 'json_schema', schema: S }, foo: 1 } }),
      op(body()),
    ]);
    expect(l.request.output_format).toEqual({ type: 'json_schema', strict: true, schema: S, name: 'ccrc_output_schema' });
    expect(has(l, 'requestField', 'output_config.format')).toBe(true);
    expect(has(l, 'requestField', 'output_config.foo')).toBe(true);
    expect(has(l, 'requestField', 'output_config.effort')).toBe(false);
    expect(none.request.output_format).toBeNull();
  });

  it('an output_config.format of another type is capability_rejected: structured_outputs_unsupported', async () => {
    const lines = await run([
      op(body(), { output_config: { format: { type: 'json_object' } } }),
      op(body(), { output_config: { format: { type: 'json_schema', schema: 'not-an-object' } } }),
    ]);
    for (const l of lines) {
      expect(l.error.status).toBe(400);
      expect(l.error.etype).toBe('invalid_request_error');
      expect(l.error.message.startsWith('capability_rejected: structured_outputs_unsupported')).toBe(true);
      expect(fam(l, 'unsupportedField')).toEqual(['output_config.format']);
    }
  });

  it('images and dropped blocks never count as bytes', async () => {
    const msgs = (image: object | null, thinking: boolean): object[] => [
      { role: 'user', content: [{ type: 'text', text: 'see' }, ...(image ? [image] : [])] },
      {
        role: 'assistant',
        content: [...(thinking ? [{ type: 'thinking', thinking: 't'.repeat(5000), signature: 's'.repeat(2000) }] : []), { type: 'text', text: 'ok' }],
      },
      { role: 'user', content: 'next' },
    ];
    const [big, small, bare] = await run([
      op(body({ messages: msgs(png('A'.repeat(200 * 1024)), true) })),
      op(body({ messages: msgs(png('AAAA'), false) })),
      op(body({ messages: msgs(null, false) })),
    ]);
    // a 200 KB base64 image and a signed thinking block count exactly what a 4-byte image with no thinking counts
    expect(big.request.countable_bytes).toBe(small.request.countable_bytes);
    expect([big.request.image_count, small.request.image_count, bare.request.image_count]).toEqual([1, 1, 0]);
    // and the image part itself counts only its emptied shape, never its data
    expect(big.request.countable_bytes - bare.request.countable_bytes)
      .toBe(Buffer.byteLength(',{"type":"input_image","image_url":"","detail":"auto"}'));
  });

  it('countable_bytes is the compact JSON of the developer text, the items and the tools, as sent', async () => {
    const l = await one(body({
      system: 'Sys é.',
      tools: [{ name: 'Read', description: 'R', input_schema: { type: 'object', properties: {} } }],
    }));
    const expected = Buffer.byteLength(JSON.stringify({
      developer: 'Sys é.', items: [userText('hi')], tools: l.request.tools,
    }), 'utf8');
    expect(l.request.countable_bytes).toBe(expected);
  });
});

describe.skipIf(!PY)('inbound: the helpers and refusals (codex-bridge plan Task 2)', () => {
  it('cut_name, call_key, cache_key and the constants', async () => {
    const n64 = 'b'.repeat(64);
    const n65 = 'c'.repeat(65);
    const [k] = await run([{ op: 'inbound-keys', cut: ['Read', n64, n65], cache: [['s', null], ['s', 'a'], [null, 'a']] }]);
    expect(k.cut).toEqual(['Read', n64, n65.slice(0, 55) + '_' + sha8(n65)]);
    expect(k.cache.slice(0, 2)).toEqual(['ccrc:s', 'ccrc:s:a']);
    expect(k.cache[2]).toMatch(/^ccrc:anon-[0-9a-f-]{36}$/);
    expect(k.consts).toEqual({
      BILLING_PREFIX: 'x-anthropic-billing-header:', COMPACTION_MARKER: 'CRITICAL: Respond with TEXT ONLY', IMAGE_TOKENS: 1600,
    });
  });

  it('a content block of an unknown type is a plain 400 naming its type, never its content', async () => {
    const l = await one(body({ messages: [{ role: 'user', content: [{ type: 'search_result', source: 'src-sentinel', content: [] }] }] }));
    expect(l.error.status).toBe(400);
    expect(l.error.etype).toBe('invalid_request_error');
    expect(l.error.headers).toEqual({ 'x-should-retry': 'false' });
    expect(l.error.message).toContain('search_result');
    expect(JSON.stringify(l)).not.toContain('src-sentinel');
    expect(fam(l, 'unsupportedField')).toEqual(['search_result']);
  });

  it('a malformed body is a 400 invalid_request_error, never an exception', async () => {
    const lines = await run([
      op({ model: MODEL, messages: { not: 'a list' } }),
      op({ messages: [] }),
      op(body({ messages: [{ role: 'user', content: 5 }] })),
      op(body({ messages: [{ role: 'tool', content: 'x' }] })),
    ]);
    for (const l of lines) {
      expect(l.error?.status, JSON.stringify(l)).toBe(400);
      expect(l.error.etype).toBe('invalid_request_error');
    }
  });
});
