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

/** The name a by-reference addition of a tool nothing offers is counted under (D-7143). */
const UNKNOWN_REF = 'tool_addition-block.unknown-reference';

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

  // D-7094: the non-text blocks of a system entry are counted by type, names only (`inbound._count_dropped`).
  // Claude Code's two tool-change betas (D-7093) send `tool_addition`/`tool_removal` blocks here; a `tool_addition`
  // also counts its `tool`'s type, so the by-value case (a `tool_definition`, a tool absent from `tools`) reads apart
  // from the by-reference one. Since D-7143 the blocks are also honoured (the D-7143 describe below): those counts are
  // unchanged, the honoured names are explained, and a by-reference addition of a name nothing offers is counted
  // `tool_addition-block.unknown-reference` after them.
  const TOOL = { name: 'ToolFx0', description: 'd0', input_schema: { type: 'object', properties: {} } };
  const removal = { type: 'tool_removal', tool: { type: 'tool_reference', name: 'ToolFx1' } };
  const byValue = {
    type: 'tool_addition',
    tool: { type: 'tool_definition', definition: { name: 'ToolFx2', description: 'desc-sentinel', input_schema: { type: 'object', properties: { argSentinel: { type: 'string' } } } } },
  };
  const byReference = { type: 'tool_addition', tool: { type: 'tool_reference', name: 'ToolFx3' }, cache_control: { type: 'ephemeral' } };
  const DROPPED_NAMES = [
    'tool_removal-block', 'tool_addition-block', 'tool_addition-block.tool_definition', 'tool_addition-block',
    'tool_addition-block.tool_reference',
  ];
  const withEntry = (content: unknown): Record<string, unknown> => body({
    tools: [TOOL],
    messages: [{ role: 'user', content: 'a' }, { role: 'system', content }, { role: 'user', content: 'b' }],
  });

  it('a system entry counts each non-text block by type, and a tool_addition its tool type; its text item is unchanged (D-7094)', async () => {
    const [mixed, control, known] = await run([
      op(withEntry([{ type: 'text', text: 'mid text' }, removal, byValue, byReference])),
      op(withEntry([{ type: 'text', text: 'mid text' }])),
      { op: 'known' },
    ]);
    // D-7094's counts, unchanged; the by-reference ToolFx3 is in neither `tools` nor an earlier addition (D-7143).
    expect(fam(mixed, 'requestField')).toEqual([...DROPPED_NAMES, UNKNOWN_REF]);
    expect(fam(control, 'requestField')).toEqual([]);
    // The entry's text is its developer item, exactly as the text alone gives it.
    expect(mixed.request.items).toEqual([userText('a'), dev('mid text'), userText('b')]);
    expect(mixed.request.items).toEqual(control.request.items);
    expect(Object.keys(mixed.request).sort()).toEqual([...NEUTRAL_FIELDS].sort());
    // D-7143: the by-value ToolFx2 is offered; the removed ToolFx1 and the unknown ToolFx3 were never offered.
    expect(mixed.request.tools.map((t: Line) => t.name)).toEqual(['ToolFx0', 'ToolFx2']);
    expect(control.request.tools.map((t: Line) => t.name)).toEqual(['ToolFx0']);
    // Names only: no tool name, description, schema key or cache marker of a block is counted; no cache marker is sent.
    const counted = JSON.stringify(mixed.names);
    for (const s of ['ToolFx1', 'ToolFx2', 'ToolFx3', 'desc-sentinel', 'argSentinel', 'cache_control']) expect(counted).not.toContain(s);
    expect(JSON.stringify(mixed.request)).not.toContain('cache_control');
    // Explained since D-7143, which honours them; the unknown reference stays unexplained, so the doctor names it.
    for (const n of DROPPED_NAMES) expect(known.known.requestField, n).toContain(n);
    expect(known.known.requestField).not.toContain(UNKNOWN_REF);
    expect(known.prefixes.requestField).toBeUndefined();
  });

  it('a system entry with no text counts its blocks, an unknown one by its type, and still gives no item (D-7094)', async () => {
    const [l] = await run([op(withEntry([removal, byReference, { type: 'future_fx' }, 'not-a-block', { type: 'tool_addition' }]))]);
    expect(fam(l, 'requestField')).toEqual([
      'tool_removal-block', 'tool_addition-block', 'tool_addition-block.tool_reference', 'future_fx-block',
      'unrecognised-block', 'tool_addition-block', 'tool_addition-block.unrecognised', UNKNOWN_REF,
    ]);
    expect(l.request.items).toEqual([userText('a'), userText('b')]);
    expect(l.request.tools.map((t: Line) => t.name)).toEqual(['ToolFx0']);
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
      op(body({ tool_choice: { type: 'auto' } })),
    ]);
    expect(lines.map((l) => l.request.parallel_tool_calls)).toEqual([true, false, true, true]);
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

// D-7143: the tool-change blocks of a system entry are honoured. Claude Code 2.1.310 folds them into the set of tools
// it holds BY NAME, IN ORDER (a removal deletes the name, an addition adds it), so the request sent upstream offers the
// request's `tools`, then each system entry's blocks folded in message order
// (ccd/codexbridge/inbound.py#_fold_tool_changes). Every request is built in Claude Code's shape (its system-entry
// builder: text, then removals by reference, then additions by reference or by value); the tool names are synthetic.
describe.skipIf(!PY)('inbound: the tool-change blocks of a system entry (D-7143)', () => {
  const schemaOf = (name: string, required?: string[]): Record<string, unknown> => ({
    type: 'object', properties: { [`${name}_arg`]: { type: 'string' } }, ...(required ? { required } : {}),
  });
  const def = (name: string, o: { description?: string; required?: string[]; extra?: Record<string, unknown> } = {}): Record<string, unknown> => ({
    name, description: o.description ?? `desc ${name}`, input_schema: schemaOf(name, o.required), ...(o.extra ?? {}),
  });
  const fn = (name: string, o: { description?: string; required?: string[]; cut?: string } = {}): Record<string, unknown> => ({
    type: 'function', name: o.cut ?? name, description: o.description ?? `desc ${name}`, parameters: schemaOf(name, o.required), strict: false,
  });
  const addValue = (definition: unknown): object => ({ type: 'tool_addition', tool: { type: 'tool_definition', definition } });
  const addRef = (name: string): object => ({ type: 'tool_addition', tool: { type: 'tool_reference', name } });
  const remove = (name: string): object => ({ type: 'tool_removal', tool: { type: 'tool_reference', name } });
  /** A conversation: a user turn, then each system entry in order, then a closing user turn. */
  const conv = (tools: unknown[], ...entries: unknown[][]): Record<string, unknown> => body({
    tools,
    messages: [
      { role: 'user', content: 'a' },
      ...entries.map((content) => ({ role: 'system', content })),
      { role: 'user', content: 'b' },
    ],
  });
  const names = (l: Line): string[] => l.request.tools.map((t: Line) => t.name);
  // (`cache_key` is a fresh `ccrc:anon-<uuid4>` per request when no session header is sent, so it is set aside.)
  const sent = (l: Line): Line => ({ ...l.request, cache_key: undefined });
  const countable = (l: Line): number => Buffer.byteLength(JSON.stringify({
    developer: l.request.developer, items: l.request.items, tools: l.request.tools,
  }), 'utf8');

  it('a by-value addition is offered upstream with its schema, its cut name and its name-map entry', async () => {
    const long = 'mcp__fx_server__' + 'b'.repeat(50) + '_fx_tool_long';
    expect(long.length).toBeGreaterThan(64);
    const [l, keys] = await run([
      op(conv([def('fx_tool_a')], [{ type: 'text', text: 'loaded' }, addValue(def('fx_tool_b', { required: ['fx_tool_b_arg'] })), addValue(def(long))])),
      { op: 'inbound-keys', cut: [long] },
    ]);
    const cut = keys.cut[0];
    expect(cut).not.toBe(long);
    expect(l.request.tools).toEqual([fn('fx_tool_a'), fn('fx_tool_b', { required: ['fx_tool_b_arg'] }), fn(long, { cut })]);
    expect(l.request.name_map).toEqual({ fx_tool_a: 'fx_tool_a', fx_tool_b: 'fx_tool_b', [cut]: long });
    expect(l.request.tools_required).toEqual(['fx_tool_b']);
    // The entry's text is still its developer item, in place.
    expect(l.request.items).toEqual([userText('a'), dev('loaded'), userText('b')]);
    // What is counted as sent is the folded list.
    expect(l.request.countable_bytes).toBe(countable(l));
    expect(fam(l, 'requestField')).toEqual([
      'tool_addition-block', 'tool_addition-block.tool_definition', 'tool_addition-block', 'tool_addition-block.tool_definition',
    ]);
  });

  it('a by-value addition replaces a same-named tools entry in place', async () => {
    const l = await one(conv(
      [def('fx_tool_a'), def('fx_tool_b'), def('fx_tool_c', { required: ['fx_tool_c_arg'] })],
      [addValue(def('fx_tool_b', { description: 'redefined', required: ['fx_tool_b_arg'] }))],
    ));
    expect(l.request.tools).toEqual([
      fn('fx_tool_a'), fn('fx_tool_b', { description: 'redefined', required: ['fx_tool_b_arg'] }),
      fn('fx_tool_c', { required: ['fx_tool_c_arg'] }),
    ]);
    expect(l.request.tools_required).toEqual(['fx_tool_b', 'fx_tool_c']);
  });

  it('a by-reference addition of an offered tool, deferred or not, changes nothing', async () => {
    const tools = [def('fx_tool_a'), def('fx_tool_b', { extra: { defer_loading: true } })];
    const [ref, control] = await run([
      op(conv(tools, [addRef('fx_tool_b'), addRef('fx_tool_a')])),
      op(conv(tools)),
    ]);
    expect(names(ref)).toEqual(['fx_tool_a', 'fx_tool_b']);
    expect(sent(ref)).toEqual(sent(control));
    expect(fam(ref, 'requestField')).not.toContain(UNKNOWN_REF);
  });

  it('a by-reference addition of a name nothing offers is counted, and changes nothing', async () => {
    const [ref, control] = await run([
      op(conv([def('fx_tool_a')], [addRef('fx_tool_z')])),
      op(conv([def('fx_tool_a')])),
    ]);
    expect(names(ref)).toEqual(['fx_tool_a']);
    expect(sent(ref)).toEqual(sent(control));
    expect(fam(ref, 'requestField')).toEqual(['tool_addition-block', 'tool_addition-block.tool_reference', UNKNOWN_REF]);
    // Names only: the unknown tool's name is never counted.
    expect(JSON.stringify(ref.names)).not.toContain('fx_tool_z');
  });

  it('a removal drops the tool and its required entry; history that called it still replays, and maps back', async () => {
    const l = await one(body({
      tools: [def('fx_tool_a', { required: ['fx_tool_a_arg'] }), def('fx_tool_b')],
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_fx1', name: 'fx_tool_a', input: { fx_tool_a_arg: 'v' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_fx1', content: 'done' }] },
        { role: 'system', content: [remove('fx_tool_a')] },
        { role: 'user', content: 'b' },
      ],
    }));
    expect(l.request.tools).toEqual([fn('fx_tool_b')]);
    expect(l.request.tools_required).toEqual([]);
    expect(l.request.items).toEqual([
      userText('a'), call('call_fx1', 'fx_tool_a', '{"fx_tool_a_arg":"v"}'), out('call_fx1', 'done'), userText('b'),
    ]);
    expect(l.request.name_map).toEqual({ fx_tool_a: 'fx_tool_a', fx_tool_b: 'fx_tool_b' });
    expect(l.request.countable_bytes).toBe(countable(l));
  });

  it('a removal then a later re-addition brings the tool back, by reference or by value', async () => {
    const [byRef, byVal, toolName] = await run([
      op(conv([def('fx_tool_a', { required: ['fx_tool_a_arg'] }), def('fx_tool_b')], [remove('fx_tool_a')], [addRef('fx_tool_a')])),
      op(conv([def('fx_tool_a'), def('fx_tool_b')], [remove('fx_tool_a')], [addValue(def('fx_tool_a', { description: 'again' }))])),
      // A reference may carry `tool_name` in place of `name` (Claude Code's name normaliser reads both).
      op(conv([def('fx_tool_a'), def('fx_tool_b')], [remove('fx_tool_a')], [{ type: 'tool_addition', tool: { type: 'tool_reference', tool_name: 'fx_tool_a' } }])),
    ]);
    expect(byRef.request.tools).toEqual([fn('fx_tool_b'), fn('fx_tool_a', { required: ['fx_tool_a_arg'] })]);
    expect(byRef.request.tools_required).toEqual(['fx_tool_a']);
    expect(fam(byRef, 'requestField')).not.toContain(UNKNOWN_REF);
    expect(byVal.request.tools).toEqual([fn('fx_tool_b'), fn('fx_tool_a', { description: 'again' })]);
    expect(names(toolName)).toEqual(['fx_tool_b', 'fx_tool_a']);
  });

  it('an addition then a removal leaves the tool gone, its name still mapped', async () => {
    const [same, later] = await run([
      op(conv([def('fx_tool_a')], [addValue(def('fx_tool_b', { required: ['fx_tool_b_arg'] })), remove('fx_tool_b')])),
      op(conv([def('fx_tool_a')], [addValue(def('fx_tool_b'))], [{ type: 'text', text: 'gone' }, remove('fx_tool_b')])),
    ]);
    expect(same.request.tools).toEqual([fn('fx_tool_a')]);
    expect(same.request.tools_required).toEqual([]);
    expect(same.request.name_map).toEqual({ fx_tool_a: 'fx_tool_a', fx_tool_b: 'fx_tool_b' });
    expect(later.request.tools).toEqual([fn('fx_tool_a')]);
    expect(later.request.items).toEqual([userText('a'), dev('gone'), userText('b')]);
  });

  // The malformed-block rule: a tool-change block the bridge cannot read is refused as a malformed tool in `tools` is
  // (a 400), EXCEPT where `_count_dropped` already names it `unrecognised` (a block that is not an object or has no
  // type, a `tool_addition` whose `tool` is not an object or has no type): that one is passed over, its count left
  // unexplained so the doctor names it. A by-value definition goes through the same checks as a `tools` entry.
  it('a malformed block is a 400, except one already counted unrecognised, which changes nothing', async () => {
    const [noTool, untypedTool, unknownKind, refNoName, removalNoTool, removalByValue, defNoName, defServer, defNotObject] = await run([
      op(conv([def('fx_tool_a')], [{ type: 'tool_addition' }, 'not-a-block', { type: 'future_fx' }])),
      op(conv([def('fx_tool_a')], [{ type: 'tool_addition', tool: { name: 'fx_tool_b' } }])),
      op(conv([def('fx_tool_a')], [{ type: 'tool_addition', tool: { type: 'future_kind', name: 'fx_tool_b' } }])),
      op(conv([def('fx_tool_a')], [{ type: 'tool_addition', tool: { type: 'tool_reference' } }])),
      op(conv([def('fx_tool_a')], [{ type: 'tool_removal' }])),
      op(conv([def('fx_tool_a')], [{ type: 'tool_removal', tool: { type: 'tool_definition', definition: def('fx_tool_a') } }])),
      op(conv([def('fx_tool_a')], [addValue({ description: 'nameless', input_schema: schemaOf('x') })])),
      op(conv([def('fx_tool_a')], [addValue({ type: 'web_search_20250305', name: 'web_search' })])),
      op(conv([def('fx_tool_a')], [addValue('not-an-object')])),
    ]);
    for (const ok of [noTool, untypedTool]) {
      expect(ok.error, JSON.stringify(ok)).toBeUndefined();
      expect(names(ok)).toEqual(['fx_tool_a']);
    }
    expect(fam(noTool, 'requestField')).toContain('tool_addition-block.unrecognised');
    expect(fam(untypedTool, 'requestField')).toContain('tool_addition-block.unrecognised');
    const malformed = (l: Line, what: string): void => {
      expect(l.error?.status, JSON.stringify(l)).toBe(400);
      expect(l.error.etype).toBe('invalid_request_error');
      expect(l.error.message).toBe('malformed request: ' + what);
    };
    malformed(unknownKind, 'a tool_addition block has a tool that is not a tool_reference or a tool_definition');
    malformed(refNoName, 'a tool_reference block has no tool name');
    malformed(removalNoTool, 'a tool_removal block has a tool that is not a tool_reference');
    malformed(removalByValue, 'a tool_removal block has a tool that is not a tool_reference');
    malformed(defNoName, 'a tool has no name');
    malformed(defNotObject, 'a tool is not an object');
    expect(defServer.error.status).toBe(400);
    expect(defServer.error.headers).toEqual({ 'x-should-retry': 'false' });
    expect(defServer.error.message).toBe('unsupported server tool: web_search_20250305');
    // Names only: no refusal carries a tool name.
    for (const l of [unknownKind, refNoName, removalByValue, defServer]) expect(JSON.stringify(l.error)).not.toContain('fx_tool');
  });

  it('the control: a request with no tool-change block is what it was before D-7143', async () => {
    const l = await one(body({
      tools: [
        def('fx_tool_a', { required: ['fx_tool_a_arg'] }), def('fx_tool_b', { extra: { defer_loading: true } }),
        { name: 'DeferredToolPlaceholder', description: 'placeholder', input_schema: { type: 'object' } },
      ],
      messages: [
        { role: 'user', content: 'a' },
        { role: 'system', content: [{ type: 'text', text: 'mid' }] },
        { role: 'user', content: 'b' },
      ],
    }));
    expect(l.request.tools).toEqual([fn('fx_tool_a', { required: ['fx_tool_a_arg'] }), fn('fx_tool_b')]);
    expect(l.request.name_map).toEqual({ fx_tool_a: 'fx_tool_a', fx_tool_b: 'fx_tool_b' });
    expect(l.request.tools_required).toEqual(['fx_tool_a']);
    expect(l.request.items).toEqual([userText('a'), dev('mid'), userText('b')]);
    expect(l.request.countable_bytes).toBe(countable(l));
    expect(l.names).toEqual([['requestField', 'defer_loading']]);
  });
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

describe.skipIf(!PY)('inbound: the arms no earlier case pinned (codex-bridge plan Task 2)', () => {
  it('a block that starts with the billing line loses that line only, and keeps the rest of its text', async () => {
    const [blocks, str] = await run([
      op(body({ system: [{ type: 'text', text: `${BILLING('a1b')}\nRest.` }, { type: 'text', text: 'Next.' }] })),
      op(body({ system: `${BILLING('f00')}\n\nRest of the string.` })),
    ]);
    expect(blocks.request.developer).toBe('Rest.\n\nNext.');
    expect(str.request.developer).toBe('Rest of the string.');
    expect(JSON.stringify([blocks.request, str.request])).not.toContain('x-anthropic-billing-header');
  });

  it('a tool_choice of another shape is dropped and counted; a tool choice is cut; a tool with no object schema gets an empty one', async () => {
    const long = 'mcp__server__' + 'd'.repeat(52) + 'tool1';
    expect(long.length).toBe(70);
    const [str, weird, named, schemas] = await run([
      op(body({ tool_choice: 'auto' })),
      op(body({ tool_choice: { type: 'weird' } })),
      op(body({ tool_choice: { type: 'tool', name: long } })),
      op(body({ tools: [{ name: 'NoSchema', description: 'd' }, { name: 'BadSchema', description: 'e', input_schema: 'not-an-object' }] })),
    ]);
    expect([str.request.tool_choice, str.request.parallel_tool_calls]).toEqual([null, true]);
    expect(fam(str, 'requestField')).toEqual(['tool_choice']);
    expect(weird.request.tool_choice).toBeNull();
    expect(fam(weird, 'requestField')).toEqual(['tool_choice']);
    expect(named.request.tool_choice).toEqual({ type: 'function', name: long.slice(0, 55) + '_' + sha8(long) });
    expect(fam(named, 'requestField')).toEqual([]);
    const empty = { type: 'object', properties: {} };
    expect(schemas.request.tools).toEqual([
      { type: 'function', name: 'NoSchema', description: 'd', parameters: empty, strict: false },
      { type: 'function', name: 'BadSchema', description: 'e', parameters: empty, strict: false },
    ]);
    expect(schemas.request.tools_required).toEqual([]);
  });

  it('a type that fails CODE_RE is named unrecognised in the refusal, never shown', async () => {
    const odd = 'Has Space sentinel-q7';
    const wide = 'w'.repeat(70);
    const [block, tool] = await run([
      op(body({ messages: [{ role: 'user', content: [{ type: odd, text: 'x' }] }] })),
      op(body({ tools: [{ type: wide, name: 'srv' }] })),
    ]);
    expect(block.error.status).toBe(400);
    expect(block.error.message).toBe('unsupported content block: unrecognised');
    expect(tool.error.message).toBe('unsupported server tool: unrecognised');
    for (const l of [block, tool]) {
      const shown = JSON.stringify([l.error.message, l.answer, l.event]);
      expect(shown).not.toContain('sentinel-q7');
      expect(shown).not.toContain(wide);
    }
  });

  it('an incomplete image source is a malformed 400; an unknown source type is unsupported', async () => {
    const img = (source: object): Record<string, unknown> => body({ messages: [{ role: 'user', content: [{ type: 'image', source }] }] });
    const [noData, noMedia, noUrl, file] = await run([
      op(img({ type: 'base64', media_type: 'image/png' })),
      op(img({ type: 'base64', data: 'AAAA' })),
      op(img({ type: 'url' })),
      op(img({ type: 'file', file_id: 'file-sentinel' })),
    ]);
    for (const l of [noData, noMedia, noUrl]) {
      expect(l.error.status).toBe(400);
      expect(l.error.etype).toBe('invalid_request_error');
      expect(l.error.message.startsWith('malformed request: ')).toBe(true);
      expect(fam(l, 'unsupportedField')).toEqual([]);
    }
    expect(file.error.message).toBe('unsupported image source: image.file');
    expect(fam(file, 'unsupportedField')).toEqual(['image.file']);
    expect(JSON.stringify(file)).not.toContain('file-sentinel');
  });

  it('an http.client message carries the session, agent and every anthropic-beta line', async () => {
    const l = await one(body(), {
      headerLines: [
        ['X-Claude-Code-Session-Id', 'sess-m'], ['x-claude-code-agent-id', 'agent-m'],
        ['anthropic-beta', 'beta-one, beta-two'], ['Anthropic-Beta', 'beta-three'],
      ],
    });
    expect([l.request.session_id, l.request.cache_key]).toEqual(['sess-m', 'ccrc:sess-m:agent-m']);
    expect(fam(l, 'betaValue')).toEqual(['beta-one', 'beta-two', 'beta-three']);
  });

  it('an action under 64 Ki characters but past 128 KiB in UTF-8 bytes still reaches the driver', async () => {
    const wide = '€'.repeat(50_000); // 50,000 characters, 150,000 UTF-8 bytes: past one argv string's limit
    const l = await one(body({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_fx1', content: wide }] }] }));
    expect(l.request.items).toEqual([out('call_fx1', wide)]);
  });
});
