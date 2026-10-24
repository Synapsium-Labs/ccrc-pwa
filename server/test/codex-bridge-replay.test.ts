// codex-bridge-replay.test.ts — the reducer against its replay corpus (codex-bridge Stage 2 plan 2026-10-22, Task 3;
// spec 2026-10-15 §2.4 "The reducer builds each Anthropic block only from the upstream's **finished** items", §5).
//
// The corpus is `fixtures/codexbridge/streams/`: one `.sse` file per stream and `expect.json`, all written by
// `fixtures/codexbridge/make_streams.py`, whose hand-written expectations never come from the reducer. Every stream is
// fed whole and in 1- and 13-byte chunks through the driver's `reduce` op (one SseParser, one Reducer, the reducer's
// `release()` drained after every event), folded into blocks and compared to its expectation, and its event sequence
// is checked by a strict checker (R2, R3, `data.type` equal to the event name, no delta outside its block).
// Nothing here makes a request: both endpoint variables point at a loopback URL nothing answers.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pythonOrSkip } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
import { driverLines, runBridgeDriver } from './codexBridgeFixture.js';

const PY = pythonOrSkip();
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures', 'codexbridge');
const STREAMS_DIR = path.join(FIXTURES, 'streams');
const GENERATOR = path.join(FIXTURES, 'make_streams.py');

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; json: string };

interface Expectation {
  setup: { name_map: Record<string, string>; tools_required: string[] };
  blocks: Block[];
  stop: string | null;
  continue: boolean;
  error: { type: string; status: number; message: string } | null;
  usage: Record<string, number>;
  reasoning: Array<[string, string] | null>;
  counted: { names: Array<[string, string]>; counts: Record<string, number> };
  committable: boolean;
  phases: Record<string, string>;
  warnings: string[];
}

const EXPECT = JSON.parse(readFileSync(path.join(STREAMS_DIR, 'expect.json'), 'utf8')) as {
  order: string[]; streams: Record<string, Expectation>;
};
const STREAMS = EXPECT.order;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Line = Record<string, any>;
type Ev = [string, Record<string, unknown>];

async function run(ops: object[], home = mkTmp('cb-replay-')): Promise<Line[]> {
  const r = await runBridgeDriver(home, { ops }, {}, { timeoutMs: 60_000 });
  expect(r.timedOut, r.stderr).toBe(false);
  const lines = driverLines(r.stdout);
  expect(lines.map((l) => l.op), `${r.stdout}\n${r.stderr}`).toEqual(ops.map((o) => (o as { op: string }).op));
  for (const l of lines) expect(l.raised, `${l.op} raised`).toBeUndefined();
  return lines;
}

function reduceOp(name: string, chunk: number | 'whole', extra: object = {}): object {
  const setup = EXPECT.streams[name].setup;
  return {
    op: 'reduce', stream: path.join(STREAMS_DIR, `${name}.sse`), chunk,
    name_map: setup.name_map, tools_required: setup.tools_required, ...extra,
  };
}

/** A reduce op over events written here (for a case the corpus does not carry), one SSE event per object. */
function inline(events: Array<{ type: string } & Record<string, unknown>>): object {
  const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return { op: 'reduce', bytes_b64: Buffer.from(sse, 'utf8').toString('base64'), chunk: 'whole' };
}

/** The strict checker: every event's `data.type` is its name; blocks are numbered 0, 1, 2… and strictly nested
 *  (one open at a time); a delta belongs to the open block and matches its type; every block is closed (R3: an open
 *  block gets its `content_block_stop` even when the stream failed); the canary's reader (R20) finds a non-blank
 *  `text_delta` only inside a text block. */
function check(events: Ev[]): void {
  let open: { index: number; type: string } | null = null;
  let next = 0;
  for (const [name, data] of events) {
    expect(data.type, `event ${name}: data.type`).toBe(name);
    if (name === 'content_block_start') {
      expect(open, 'a block started while another was open').toBeNull();
      expect(data.index).toBe(next);
      const block = data.content_block as { type: string };
      open = { index: next, type: block.type };
      next += 1;
    } else if (name === 'content_block_delta') {
      expect(open, 'a delta outside a block').not.toBeNull();
      expect(data.index).toBe(open!.index);
      const delta = data.delta as { type: string };
      expect(delta.type).toBe(open!.type === 'text' ? 'text_delta' : 'input_json_delta');
    } else if (name === 'content_block_stop') {
      expect(open, 'a stop with no open block').not.toBeNull();
      expect(data.index).toBe(open!.index);
      open = null;
    } else {
      throw new Error(`the reducer released a non-block event: ${name}`);
    }
  }
  expect(open, 'a block left open at the end').toBeNull();
}

function fold(events: Ev[]): Block[] {
  const blocks: Block[] = [];
  for (const [name, data] of events) {
    if (name === 'content_block_start') {
      const b = data.content_block as { type: string; id?: string; name?: string };
      blocks.push(b.type === 'text' ? { type: 'text', text: '' }
        : { type: 'tool_use', id: b.id!, name: b.name!, input: {}, json: '' });
    } else if (name === 'content_block_delta') {
      const d = data.delta as { type: string; text?: string; partial_json?: string };
      const cur = blocks[blocks.length - 1];
      if (cur.type === 'text') cur.text += d.text ?? '';
      else cur.json += d.partial_json ?? '';
    } else if (name === 'content_block_stop') {
      const cur = blocks[blocks.length - 1];
      if (cur.type === 'tool_use') cur.input = cur.json === '' ? {} : JSON.parse(cur.json);
    }
  }
  return blocks;
}

function result(line: Line): Expectation {
  const t = line.terminal;
  return {
    setup: EXPECT.streams[line.name].setup,
    blocks: fold(line.events as Ev[]),
    stop: t.error ? null : t.stop,
    continue: t.error ? false : t.continue,
    error: t.error ? { type: t.error.type, status: t.error.status, message: t.error.message } : null,
    usage: t.anthropicUsage,
    reasoning: (line.reasoning as Array<{ key: [string, string] | null }>).map((r) => r.key),
    counted: line.counted,
    committable: line.committable,
    phases: line.phases,
    warnings: line.warnings,
  };
}

describe.skipIf(!PY)('the reducer, against the replay corpus (codex-bridge spec §2.4)', () => {
  it.each(STREAMS)('%s reduces to its expectation, whole and in 1- and 13-byte chunks', async (name) => {
    const lines = await run([reduceOp(name, 'whole'), reduceOp(name, 1), reduceOp(name, 13)]);
    for (const line of lines) {
      line.name = name;
      check(line.events as Ev[]);
      expect(result(line), `${name} fed in ${String(line.chunk)}-byte chunks`).toEqual(EXPECT.streams[name]);
    }
    // the three feeds release the same events, not just the same fold
    expect(lines[1].events).toEqual(lines[0].events);
    expect(lines[2].events).toEqual(lines[0].events);
  });

  it('the committed corpus is what make_streams.py writes', () => {
    const out = mkTmp('cb-corpus-');
    execFileSync(PY!, ['-I', GENERATOR, out], { stdio: ['ignore', 'pipe', 'pipe'] });
    const committed = readdirSync(STREAMS_DIR).sort();
    expect(readdirSync(out).sort()).toEqual(committed);
    expect(committed).toHaveLength(STREAMS.length + 1);
    for (const f of committed) {
      expect(readFileSync(path.join(out, f)).equals(readFileSync(path.join(STREAMS_DIR, f))), `${f} differs`).toBe(true);
    }
  });

  it('the corpus holds the 32 ported streams, the 16 new ones and the 13 of review rounds 1 to 3', () => {
    expect(STREAMS.filter((s) => !s.startsWith('synth2-') && !s.startsWith('synth3-'))).toHaveLength(32);
    expect(STREAMS.filter((s) => s.startsWith('synth2-'))).toHaveLength(16);
    expect(STREAMS.filter((s) => s.startsWith('synth3-'))).toHaveLength(13);
  });

  it('the usage sum equals the upstream input_tokens', async () => {
    const lines = await run(STREAMS.map((s) => reduceOp(s, 'whole')));
    let checked = 0;
    for (const line of lines) {
      const u = line.terminal.usage as { input: number; cached: number; cacheWrite: number };
      const a = line.terminal.anthropicUsage as Record<string, number>;
      if (u.input === 0 || u.cached + u.cacheWrite > u.input) continue;
      checked += 1;
      expect(a.input_tokens + a.cache_read_input_tokens + a.cache_creation_input_tokens).toBe(u.input);
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  it('a live text block streams before its done event', async () => {
    const [line] = await run([reduceOp('synth2-live-text-prefix-then-suffix', 'whole', { trace: true })]);
    const trace = line.trace as Array<{ type: string; released: string[] }>;
    const firstDelta = trace.findIndex((t) => t.type === 'response.output_text.delta');
    const done = trace.findIndex((t) => t.type === 'response.output_item.done');
    expect(firstDelta).toBeGreaterThanOrEqual(0);
    expect(done).toBeGreaterThan(firstDelta);
    expect(trace[firstDelta].released).toEqual(['content_block_start', 'content_block_delta:text_delta']);
    // at the done event, the missing suffix and the stop
    expect(trace[done].released).toEqual(['content_block_delta:text_delta', 'content_block_stop']);
  });

  it('no reducer output holds encrypted_content', async () => {
    const lines = await run(STREAMS.map((s) => reduceOp(s, 'whole', { trace: true })));
    let withReasoning = 0;
    for (const [i, line] of lines.entries()) {
      const raw = readFileSync(path.join(STREAMS_DIR, `${STREAMS[i]}.sse`), 'utf8');
      if (raw.includes('ENC-')) withReasoning += 1;
      const out = JSON.stringify(line);
      expect(out, STREAMS[i]).not.toContain('ENC-');
      expect(out, STREAMS[i]).not.toContain('encrypted_content');
    }
    expect(withReasoning).toBeGreaterThanOrEqual(8);
  });

  it('with live_text off, nothing is released before the done event, and the fold is the same', async () => {
    const name = 'synth2-live-text-prefix-then-suffix';
    const [line] = await run([reduceOp(name, 'whole', { trace: true, live_text: false })]);
    const trace = line.trace as Array<{ type: string; released: string[] }>;
    const done = trace.findIndex((t) => t.type === 'response.output_item.done');
    expect(done).toBeGreaterThan(0);
    expect(trace.slice(0, done).every((t) => t.released.length === 0)).toBe(true);
    expect(trace[done].released).toEqual(['content_block_start', 'content_block_delta:text_delta', 'content_block_stop']);
    line.name = name;
    check(line.events as Ev[]);
    expect(result(line)).toEqual(EXPECT.streams[name]);
  });

  it('the warnings are capped, the last one saying further warnings were dropped', async () => {
    const call = { type: 'function_call', id: 'fc_fx0', call_id: 'call_fx0', name: 'probe_tool', arguments: '{}' };
    const done = { type: 'response.output_item.done', output_index: 0, item: call };
    const [line] = await run([inline([
      ...Array.from({ length: 70 }, () => done),
      { type: 'response.completed', response: { id: 'resp_fx1', output: [] } },
    ])]);
    expect(line.warnings).toHaveLength(65);
    expect(line.warnings.slice(0, 64)).toEqual(Array.from({ length: 64 }, () => 'a repeated output_index was dropped'));
    expect(line.warnings[64]).toBe('further warnings dropped');
  });

  it('on a live-text mismatch the emitted text is what the reasoning is keyed by', async () => {
    const [line] = await run([reduceOp('synth2-live-text-mismatch', 'whole')]);
    const sent = (line.events as Ev[])
      .filter(([n, d]) => n === 'content_block_delta' && (d.delta as { type: string }).type === 'text_delta')
      .map(([, d]) => (d.delta as { text: string }).text).join('');
    expect(sent).toBe('Hello there');
    expect(line.reasoning[0].key).toEqual(['text', sent]);
    expect(line.emittedText).toEqual({ 1: sent });
    expect(line.counted.counts).toEqual({ liveTextMismatch: 1 });
  });

  it('a live block closed because its index finished as a call keeps its sent text in emitted_text', async () => {
    // emitted_text is keyed by the output_index whose text was SENT: index 0 finished as a function_call, but
    // Claude Code was sent 'Hi' and sends it back, so the entry stays (R14).
    const [line] = await run([reduceOp('synth3-live-index-finishes-as-a-call', 'whole')]);
    expect(line.emittedText).toEqual({ 0: 'Hi', 1: 'x' });
  });

  it('a reasoning item before a message is keyed by that message', async () => {
    const [line] = await run([reduceOp('synth2-reasoning-message-reasoning-call', 'whole')]);
    expect(line.reasoning).toEqual([
      { id: 'rs_fx0', key: ['text', 'First I look.'] },
      { id: 'rs_fx2', key: ['call', 'call_fx3'] },
    ]);
  });

  it('terminal is set when response.failed is fed, before EOF', async () => {
    const [line] = await run([reduceOp('synth-failed-cyber-policy', 'whole', { trace: true })]);
    const trace = line.trace as Array<{ type: string; terminal: boolean; released: string[] }>;
    const at = trace.findIndex((t) => t.terminal);
    expect(trace[at].type).toBe('response.failed');
    expect(at).toBeLessThan(trace.length - 1); // a later event was parsed, and released nothing
    expect(trace.slice(at + 1).every((t) => t.released.length === 0)).toBe(true);
    expect(line.terminalBeforeEof).toBe(true);
    expect(line.terminal.kind).toBe('failed');
  });

  it('a failed first event is not committable', async () => {
    const [line] = await run([reduceOp('synth2-failed-first-event', 'whole', { trace: true })]);
    const trace = line.trace as Array<{ type: string; terminal: boolean; committable: boolean }>;
    expect(trace[0]).toMatchObject({ type: 'response.failed', terminal: true, committable: false });
    expect(line.committable).toBe(false);
    expect(line.terminal.error).toMatchObject({ type: 'invalid_request_error', status: 400 });
  });

  it('a non-failure terminal is committable before any block', async () => {
    const [line] = await run([{
      op: 'reduce', bytes_b64: Buffer.from('event: response.completed\ndata: {"type":"response.completed",'
        + '"response":{"id":"resp_fx1","status":"completed","output":[]}}\n\n').toString('base64'), chunk: 'whole',
      trace: true,
    }]);
    expect(line.trace[0]).toMatchObject({ terminal: true, committable: true });
    expect(line.events).toEqual([]);
  });

  it('a later content part is never forwarded live, so a refusal between two texts stays a block of its own', async () => {
    const msg = (content: object[], status = 'completed') => ({ type: 'message', id: 'msg_fx0', role: 'assistant', status, content });
    const delta = (ci: number, d: string) => ({ type: 'response.output_text.delta', item_id: 'msg_fx0', output_index: 0, content_index: ci, delta: d });
    const [line] = await run([inline([
      { type: 'response.created', response: { id: 'resp_fx1' } },
      { type: 'response.output_item.added', output_index: 0, item: msg([], 'in_progress') },
      delta(0, 'Hi'), delta(2, '!'),
      { type: 'response.output_item.done', output_index: 0, item: msg([
        { type: 'output_text', text: 'Hi' }, { type: 'refusal', refusal: 'no' }, { type: 'output_text', text: '!' }]) },
      { type: 'response.completed', response: { id: 'resp_fx1', output: [] } },
    ])]);
    check(line.events as Ev[]);
    expect(fold(line.events as Ev[])).toEqual([{ type: 'text', text: 'Hi' }, { type: 'text', text: 'no' }, { type: 'text', text: '!' }]);
    expect(line.terminal.stop).toBe('refusal');
    expect(line.counted.counts).toEqual({});
  });

  it('a call with no call_id is skipped, and arguments that are not strict JSON are invalid', async () => {
    const [line] = await run([inline([
      { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc_fx0', name: 'probe_tool', arguments: '{}' } },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: 'fc_fx1', call_id: 'call_fx1', name: 'probe_tool', arguments: '{"a": NaN}' } },
      { type: 'response.completed', response: { id: 'resp_fx1', output: [] } },
    ])]);
    check(line.events as Ev[]);
    expect(fold(line.events as Ev[])).toEqual([{ type: 'tool_use', id: 'call_fx1', name: 'probe_tool', input: {}, json: '{}' }]);
    expect(line.counted.counts).toEqual({ invalidArguments: 1 });
    expect(line.warnings).toEqual(['a tool call with no call_id was skipped']);
  });

  it('an incomplete reason is bounded before it is named or put in a message', async () => {
    const [line] = await run([inline([
      { type: 'response.incomplete', response: { id: 'resp_fx1', incomplete_details: { reason: 'Not A Code! <x>' }, output: [] } },
    ])]);
    expect(line.terminal.error).toMatchObject({
      type: 'api_error', status: 503, message: 'upstream unavailable (an incomplete response: unrecognised)',
    });
    expect(line.counted.names).toEqual([['incompleteReason', 'unrecognised']]);
    expect(JSON.stringify(line)).not.toContain('Not A Code');
  });

  it('stop_reason and needs_continuation follow the contract table', async () => {
    const [table] = await run([{ op: 'stop-reasons' }]);
    expect(table.rows).toEqual([
      // [kind, reason, end_turn, emitted_tool_use, refusal] -> [stop_reason, needs_continuation]
      { in: ['completed', null, null, true, false], stop: 'tool_use', cont: false },
      { in: ['completed', null, null, false, true], stop: 'refusal', cont: false },
      { in: ['completed', null, null, false, false], stop: 'end_turn', cont: false },
      { in: ['completed', null, true, false, false], stop: 'end_turn', cont: false },
      { in: ['completed', null, false, false, false], stop: null, cont: true },
      { in: ['completed', null, false, true, false], stop: 'tool_use', cont: false },
      { in: ['incomplete', 'max_output_tokens', null, false, false], stop: 'max_tokens', cont: false },
      { in: ['incomplete', 'content_filter', null, false, false], stop: 'refusal', cont: false },
      { in: ['incomplete', 'interrupted', null, false, false], stop: null, cont: true },
      { in: ['incomplete', 'interrupted', null, true, false], stop: 'tool_use', cont: false },
      // a refused reply that also says end_turn:false is not continued: the refusal flag wins in both
      { in: ['completed', null, false, false, true], stop: 'refusal', cont: false },
    ]);
    expect(table.failedRaises).toBe('ValueError');
    // the refusal flag is required: the two-argument call raises rather than continuing a refused reply
    expect(table.twoArgContinuationRaises).toBe('TypeError');
  });
});
