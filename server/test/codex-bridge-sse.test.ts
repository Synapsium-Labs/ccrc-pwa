// codex-bridge-sse.test.ts — the `codexbridge` package's shape and its SSE parser and frame writer (codex-bridge
// Stage 2 plan 2026-10-22, Task 1; spec 2026-10-15 §2.1 "Stdlib Python, run by the system `python3`", §2.4).
//
// Every case runs the package through `runBridgeDriver` (codexBridgeFixture.ts) in a mkTmp HOME, with both endpoint
// variables pointed at a loopback URL nothing answers; nothing here makes a request.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path, { join } from 'node:path';
import { pythonOrSkip } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
import { CLOSED_AUTH_BASE } from './codexAuthFixture.js';
import { BRIDGE_DIR, driverLines, runBridgeDriver } from './codexBridgeFixture.js';

const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

/** The standard-library modules the package may import (the plan's Global Constraints: `sys.stdlib_module_names`
 *  exists only from 3.10, so the allowlist is fixed here). A module outside it is a red case, never a silent pass. */
const STDLIB_ALLOWED = [
  'http.client', 'http.server', 'json', 'sqlite3', 'ssl', 'socket', 'threading', 'hashlib', 'hmac', 'os', 'sys',
  'time', 'math', 'uuid', 'base64', 'platform', 'signal', 'importlib.util', 'typing', 're', 'datetime', 'errno',
  'stat',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(ops: object[], env: Record<string, string> = {}, home = mkTmp('cb-sse-')): Promise<Array<Record<string, any>>> {
  const r = await runBridgeDriver(home, { ops }, env);
  expect(r.timedOut, r.stderr).toBe(false);
  const lines = driverLines(r.stdout);
  expect(lines.map((l) => l.op), `${r.stdout}\n${r.stderr}`).toEqual(ops.map((o) => (o as { op: string }).op));
  return lines;
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
/** Text and raw byte runs joined, for a stream that is not all UTF-8. */
const b64Bytes = (...parts: Array<string | number[]>): string =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf8') : Buffer.from(p)))).toString('base64');

/** CRLF and LF lines, a `:` comment, a two-line data field, a malformed `data:` line, an event whose data has no
 *  `type`, a JSON array as data, and the `[DONE]` sentinel. */
const STREAM = [
  'event: response.created\r\n',
  'data: {"type":"response.created","response":{"id":"resp_fx1"}}\r\n',
  '\r\n',
  ': a keep-alive comment\n',
  '\n',
  'event: response.output_text.delta\n',
  'data: {"type":"response.output_text.delta","delta":"hi"}\n',
  '\n',
  'data: {"type":"response.output_text.delta",\r\n',
  'data: "delta":"two lines"}\r\n',
  '\r\n',
  'data: {not json\n',
  '\n',
  'event: custom.name\n',
  'data: {"delta":"no type here"}\n',
  '\n',
  'data: [1,2]\n',
  '\n',
  'data: [DONE]\n',
  '\n',
].join('');

const EXPECTED = [
  { name: 'response.created', data: { type: 'response.created', response: { id: 'resp_fx1' } }, type: 'response.created' },
  { name: 'response.output_text.delta', data: { type: 'response.output_text.delta', delta: 'hi' }, type: 'response.output_text.delta' },
  { name: null, data: { type: 'response.output_text.delta', delta: 'two lines' }, type: 'response.output_text.delta' },
  { name: null, data: null, type: null },
  { name: 'custom.name', data: { delta: 'no type here' }, type: 'custom.name' },
  { name: null, data: null, type: null },
];

describe.skipIf(!PY)('the codexbridge package (codex-bridge spec §2.1)', () => {
  it('every module parses as Python 3.9 and imports only the standard library', async () => {
    const [line] = await run([{ op: 'census' }]);
    const files = line.files as Array<{ file: string; syntaxError?: string; imports: string[]; pep604: number[]; timeoutError: number[] }>;
    expect(files.map((f) => f.file)).toEqual(expect.arrayContaining(['__init__.py', 'sse.py', 'errors.py']));
    for (const f of files) {
      expect(f.syntaxError, `${f.file} does not parse at feature_version (3, 9)`).toBeUndefined();
      expect(f.pep604, `${f.file}: lines with a PEP 604 union evaluated at runtime`).toEqual([]);
      expect(f.timeoutError, `${f.file}: a socket timeout is socket.timeout on 3.9, not TimeoutError`).toEqual([]);
      const outside = f.imports.filter((m) => m !== 'codexbridge' && !m.startsWith('codexbridge.') && !STDLIB_ALLOWED.includes(m));
      expect(outside, `${f.file} imports a module outside the allowlist`).toEqual([]);
    }
  });

  it('importing the package writes no __pycache__', async () => {
    const [line] = await run([{ op: 'modules' }]);
    expect(line.loaded).toContain('codexbridge.sse');
    expect(existsSync(join(BRIDGE_DIR, '__pycache__')), 'a __pycache__ in ccd/codexbridge').toBe(false);
  });

  it('load_all imports every module of the package, and MODULES names every file', async () => {
    const [mods, census] = await run([{ op: 'modules' }, { op: 'census' }]);
    expect(mods.version).toBe('1');
    const files = (census.files as Array<{ file: string }>).map((f) => f.file.replace(/\.py$/, '')).filter((f) => f !== '__init__');
    expect([...mods.modules].sort()).toEqual(files.sort());
    for (const m of mods.modules as string[]) expect(mods.loaded).toContain(`codexbridge.${m}`);
  });
});

describe.skipIf(!PY)('the SSE parser (codex-bridge spec §2.4)', () => {
  it('the parser scans each byte a bounded number of times', async () => {
    const head = 'data: {"type":"x","pad":"';
    const tail = '"}\n\n';
    const stream = head + 'a'.repeat(20000 - head.length - tail.length) + tail;
    expect(stream.length).toBe(20000);
    const [line] = await run([{ op: 'sse-feed', bytes_b64: b64(stream), chunk: 1 }]);
    expect(line.events).toHaveLength(1);
    expect(line.events[0].type).toBe('x');
    expect(line.scanned).toBeLessThanOrEqual(2 * 20000);
  });

  it.each([1, 13, 'whole'] as const)('the parser gives the same events fed in %s-byte chunks', async (chunk) => {
    const [line] = await run([{ op: 'sse-feed', bytes_b64: b64(STREAM), chunk }]);
    expect(line.events).toEqual(EXPECTED);
  });

  it('a malformed data line is a warning, never fatal', async () => {
    const [line] = await run([{ op: 'sse-feed', bytes_b64: b64(STREAM), chunk: 'whole' }]);
    expect(line.warnings).toHaveLength(2);
    for (const w of line.warnings as string[]) expect(w).not.toContain('not json');
    // the events after each malformed line still arrive
    expect(line.events[line.events.length - 2]).toEqual(EXPECTED[EXPECTED.length - 2]);
  });

  it('type falls back to the event: name', async () => {
    const s = 'event: response.in_progress\ndata: {"sequence_number":3}\n\ndata: {"seq":4}\n\n';
    const [line] = await run([{ op: 'sse-feed', bytes_b64: b64(s), chunk: 'whole' }]);
    expect(line.events).toEqual([
      { name: 'response.in_progress', data: { sequence_number: 3 }, type: 'response.in_progress' },
      { name: null, data: { seq: 4 }, type: null },
    ]);
  });

  it('a line that is not UTF-8 makes its event malformed, never dropped and never rebuilt from its other lines', async () => {
    const [single, multi] = await run([
      { op: 'sse-feed', bytes_b64: b64Bytes('event: response.completed\ndata: {"type":"response.completed","x":"', [0xff], '"}\n\n'), chunk: 'whole' },
      { op: 'sse-feed', bytes_b64: b64Bytes('data: {"type":"a"}\ndata: ', [0xff, 0xfe], '\n\ndata: {"type":"b"}\n\n'), chunk: 1 },
    ]);
    expect(single.events).toEqual([{ name: 'response.completed', data: null, type: 'response.completed' }]);
    expect(single.warnings).toEqual(['a line that is not UTF-8']);
    // the next event is whole: the malformed mark ends with its own event
    expect(multi.events).toEqual([{ name: null, data: null, type: null }, { name: null, data: { type: 'b' }, type: 'b' }]);
    expect(multi.warnings).toEqual(['a line that is not UTF-8']);
  });

  it('warnings past WARNINGS_MAX are counted in one last warning, never kept', async () => {
    const [line] = await run([{ op: 'sse-feed', bytes_b64: b64('data: {not json\n\n'.repeat(70)), chunk: 'whole' }]);
    expect(line.events).toHaveLength(70);
    expect(line.warnings).toHaveLength(65);
    expect(line.warnings[64]).toBe('further warnings dropped');
  });

  it('an event still open when the stream closes is parsed at close', async () => {
    const s = 'data: {"type":"response.completed"}';
    const [line] = await run([{ op: 'sse-feed', bytes_b64: b64(s), chunk: 13 }]);
    expect(line.events).toEqual([{ name: null, data: { type: 'response.completed' }, type: 'response.completed' }]);
  });
});

describe.skipIf(!PY)('the frame writer (codex-bridge spec §2.4)', () => {
  it('frame() writes the event name equal to data.type', async () => {
    const [ok, bad] = await run([
      { op: 'frame', type: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      { op: 'frame', type: 'message_stop', data: { type: 'ping' } },
    ]);
    expect(ok.result).toBe('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    expect(bad.raised).toBe('ValueError');
  });

  it('a lone surrogate in a frame is escaped, never written as bytes that are not UTF-8', async () => {
    const [line] = await run([{ op: 'frame', type: 'x', data: { type: 'x', s: '\ud800' } }]);
    expect(line.result).toBe('event: x\ndata: {"type":"x","s":"\\ud800"}\n\n');
  });

  it('PING is event: ping with data {"type":"ping"}', async () => {
    const [line] = await run([{ op: 'ping' }]);
    expect(line.result).toBe('event: ping\ndata: {"type":"ping"}\n\n');
  });
});

describe.skipIf(!PY)('runBridgeDriver (codexBridgeFixture.ts): no test reaches a live endpoint', () => {
  it('both endpoint variables are CLOSED_AUTH_BASE unless env names a non-empty one, and HOME is the fixture', async () => {
    const home = mkTmp('cb-env-');
    const [bare] = await run([{ op: 'endpoints' }], {}, home);
    expect(bare).toEqual({ op: 'endpoints', CCGPT_BRIDGE_UPSTREAM_BASE: CLOSED_AUTH_BASE, CCRC_CODEX_AUTH_BASE: CLOSED_AUTH_BASE, HOME: path.resolve(home) });
    const [empty] = await run([{ op: 'endpoints' }], { CCGPT_BRIDGE_UPSTREAM_BASE: '', CCRC_CODEX_AUTH_BASE: '' });
    expect(empty.CCGPT_BRIDGE_UPSTREAM_BASE).toBe(CLOSED_AUTH_BASE);
    expect(empty.CCRC_CODEX_AUTH_BASE).toBe(CLOSED_AUTH_BASE);
    const [named] = await run([{ op: 'endpoints' }], { CCGPT_BRIDGE_UPSTREAM_BASE: 'http://127.0.0.1:1' });
    expect(named.CCGPT_BRIDGE_UPSTREAM_BASE).toBe('http://127.0.0.1:1');
    expect(named.CCRC_CODEX_AUTH_BASE).toBe(CLOSED_AUTH_BASE);
  });

  it('a HOME outside the temp root, or an env that sets HOME, is refused before anything is spawned', () => {
    expect(() => runBridgeDriver('/', { ops: [] })).toThrow(/home must be a fixture directory/);
    expect(() => runBridgeDriver(mkTmp('cb-env-'), { ops: [] }, { HOME: '/' })).toThrow(/must not set HOME/);
  });
});
