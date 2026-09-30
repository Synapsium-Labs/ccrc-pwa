// deploy/hook-capture-reduce.mjs (worker stall watch wave 2, §5.1's first task):
// the one tool that turns a directory of raw hook payloads into something this
// PUBLIC repository may hold. Every row runs the real CLI as a child process
// over a fixture capture directory written in the hook's own file grammar
// (`<event>-<epochms>-<pid>.cap`, line 1 the meta line, the rest the payload).
// The sentinels are TOKEN-SHAPED on purpose wherever they can be: a value that
// would pass the token test is kept out of the output by the design (keys and
// types, never values), not by the filter, and these rows prove that.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const REDUCER = path.resolve(__dirname, '../../deploy/hook-capture-reduce.mjs');

type Counts3 = Record<string, number>;
interface EventOut {
  count: number;
  keys: Record<string, string[]>;
  agentId: Counts3;
  envSid: Counts3;
  backgroundTasks: { absent: number; notArray: number; array: number; elementKeys: string[][]; types: string[] };
  source?: string[];
  error?: { fields: string[]; values: string[] };
}
interface Out {
  v: number; files: number; unparsed: number;
  events: Record<string, EventOut>;
  sessionStarts: Array<{ source: string; envSidVsPrevious: string }>;
  sequence: Array<{ event: string; agentId: string }>;
}

let dir: string;
beforeEach(() => { dir = mkTmp('ccrc-hookcap-'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** One capture file, exactly as the hook's capture arm writes it. `envSid: null`
 *  writes a meta line naming no id; a string `payload` is written raw. */
const cap = (event: string, ms: number, envSid: string | null, payload: object | string, pid = 100): void => {
  const meta = envSid === null ? '{}' : JSON.stringify({ envSid });
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  fs.writeFileSync(path.join(dir, `${event}-${ms}-${pid}.cap`), `${meta}\n${body}\n`);
};
const reduceRaw = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [REDUCER, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const reduce = (): Out => {
  const r = reduceRaw([dir]);
  expect(r.status, r.stderr).toBe(0);
  expect(r.stderr).toBe('');
  return JSON.parse(r.stdout) as Out;
};
const ev = (out: Out, name: string): EventOut => {
  const e = out.events[name];
  expect(e, `no ${name} in the output`).toBeDefined();
  return e as EventOut;
};

/** A two-letter name for index i ('aa', 'ab', ...): a key with no digit, so a row that
 *  builds a wide object pins the WIDTH bound and is not collapsed by the digit rule. */
const alpha = (i: number): string => String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26));

/** Every string a payload carries that must never reach the output. */
const SENTINELS = [
  'SENTINEL-last-message', '/home/secret-host/x', 'SENTINEL-prompt-text', 'sid-sentinel-0001',
  'sentinel_secret_key', 'SENTINEL-tool-value', 'SENTINEL-response-value', 'SENTINEL-cwd', 'b989ocn62', 'agent-sentinel-7',
] as const;
const leaky = (event: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  hook_event_name: event, session_id: 'sid-sentinel-0001',
  transcript_path: '/home/secret-host/x/transcript.jsonl', cwd: '/home/secret-host/x/SENTINEL-cwd',
  last_assistant_message: 'SENTINEL-last-message', prompt: 'SENTINEL-prompt-text',
  tool_name: 'Bash', tool_input: { sentinel_secret_key: 'SENTINEL-tool-value' },
  tool_response: { sentinel_secret_key: 'SENTINEL-response-value' }, ...extra,
});

describe('hook-capture-reduce (worker stall watch §5.1)', () => {
  it('emits no payload value, no id and nothing below tool_input/tool_response: only key names and types', () => {
    cap('SessionStart', 1, 'sid-sentinel-0001', leaky('SessionStart', { source: 'startup' }));
    cap('UserPromptSubmit', 2, 'sid-sentinel-0001', leaky('UserPromptSubmit'));
    cap('PostToolUse', 3, 'sid-sentinel-0001', leaky('PostToolUse', { agent_id: 'agent-sentinel-7' }));
    cap('Stop', 4, 'sid-sentinel-0001',
      leaky('Stop', { background_tasks: [{ id: 'b989ocn62', type: 'monitor' }] }));
    cap('StopFailure', 5, 'sid-sentinel-0001', leaky('StopFailure', { error: 'server_error' }));
    const out = reduce();
    const text = JSON.stringify(out);
    for (const s of SENTINELS) expect(text.includes(s), s).toBe(false);
    // Control: the walker DID run over these payloads — their key names and
    // types are there, and the two opaque keys are recorded with their own type.
    const post = ev(out, 'PostToolUse');
    expect(post.keys['last_assistant_message']).toEqual(['string']);
    expect(post.keys['transcript_path']).toEqual(['string']);
    expect(post.keys['tool_input']).toEqual(['object']);
    expect(post.keys['tool_response']).toEqual(['object']);
    expect(Object.keys(post.keys).filter((k) => k.startsWith('tool_input.') || k.startsWith('tool_response.'))).toEqual([]);
    // …and the three token kinds that ARE emitted came through.
    expect(ev(out, 'Stop').backgroundTasks.types).toEqual(['monitor']);
    expect(ev(out, 'SessionStart').source).toEqual(['startup']);
    expect(ev(out, 'StopFailure').error).toEqual({ fields: ['error'], values: ['server_error'] });
  });

  it('counts agent_id as absent, empty and non-empty', () => {
    cap('PostToolUse', 1, 's', { hook_event_name: 'PostToolUse' });
    cap('PostToolUse', 2, 's', { hook_event_name: 'PostToolUse', agent_id: '' });
    cap('PostToolUse', 3, 's', { hook_event_name: 'PostToolUse', agent_id: 'a-1' });
    cap('PostToolUse', 4, 's', { hook_event_name: 'PostToolUse', agent_id: null });
    expect(ev(reduce(), 'PostToolUse').agentId).toEqual({ absent: 2, empty: 1, nonEmpty: 1 });
  });

  it('lists every event in time order with its agent_id class, so C1 can see where the non-empty ones fall', () => {
    cap('UserPromptSubmit', 10, 's', { hook_event_name: 'UserPromptSubmit' });
    cap('SubagentStart', 20, 's', { hook_event_name: 'SubagentStart', agent_id: 'a-1' });
    cap('PostToolUse', 30, 's', { hook_event_name: 'PostToolUse', agent_id: 'a-1' });
    cap('SubagentStop', 40, 's', { hook_event_name: 'SubagentStop', agent_id: 'a-1' });
    cap('Stop', 50, 's', 'not json {');
    cap('Stop', 9, 's', { hook_event_name: 'Stop' });
    expect(reduce().sequence).toEqual([
      { event: 'Stop', agentId: 'absent' },
      { event: 'UserPromptSubmit', agentId: 'absent' },
      { event: 'SubagentStart', agentId: 'nonEmpty' },
      { event: 'PostToolUse', agentId: 'nonEmpty' },
      { event: 'SubagentStop', agentId: 'nonEmpty' },
      { event: 'Stop', agentId: 'unparsed' },
    ]);
  });

  it('classifies background_tasks as absent, array or not an array, and never emits an id', () => {
    cap('Stop', 1, 's', { hook_event_name: 'Stop' });
    cap('Stop', 2, 's', {
      hook_event_name: 'Stop',
      background_tasks: [{ id: 'b989ocn62', type: 'monitor' }, { id: 'x', type: 'subagent', extra: 1 }, 'not-an-object'],
    });
    cap('Stop', 3, 's', { hook_event_name: 'Stop', background_tasks: 'x' });
    cap('Stop', 4, 's', { hook_event_name: 'Stop', background_tasks: { b989ocn62: { type: 'subagent', id: 'z' } } });
    const out = reduce();
    const bt = ev(out, 'Stop').backgroundTasks;
    expect(bt).toEqual({
      absent: 1, notArray: 2, array: 1,
      elementKeys: [['extra', 'id', 'type'], ['id', 'type']], types: ['monitor', 'subagent'],
    });
    expect(ev(out, 'Stop').keys['background_tasks.[].id']).toEqual(['string']);
    // The id-keyed object is one (map) segment: its key never prints (a digit in a key collapses it).
    expect(ev(out, 'Stop').keys['background_tasks.(map)']).toEqual(['object']);
    expect(JSON.stringify(out).includes('b989ocn62')).toBe(false);
  });

  it('collapses a background_tasks element with a digit in any key to (map), so elementKeys never prints the key', () => {
    cap('Stop', 1, 's', { hook_event_name: 'Stop', background_tasks: [{ b989ocn62: 1, type: 'x' }] });
    cap('Stop', 2, 's', { hook_event_name: 'Stop', background_tasks: [{ id: 'k', type: 'monitor' }] });
    const out = reduce();
    // Control: a clean element still lists its keys, and the collapsed one is the only (map).
    expect(ev(out, 'Stop').backgroundTasks.elementKeys).toEqual([['(map)'], ['id', 'type']]);
    expect(JSON.stringify(out).includes('b989ocn62')).toBe(false);
  });

  it('collapses a background_tasks element wider than 50 keys to (map) in elementKeys too', () => {
    const wide = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${alpha(i)}`, i]));
    cap('Stop', 1, 's', { hook_event_name: 'Stop', background_tasks: [wide, { id: 'k', type: 'monitor' }] });
    const out = reduce();
    expect(ev(out, 'Stop').backgroundTasks.elementKeys).toEqual([['(map)'], ['id', 'type']]);
    expect(JSON.stringify(out).includes('kaa')).toBe(false);
  });

  it('prints a hostile or over-long type as (unprintable), and keeps a token with a space', () => {
    cap('Stop', 1, 's', {
      hook_event_name: 'Stop',
      background_tasks: [{ id: 'a', type: 'rm -rf /; echo $(x)' }, { id: 'b', type: 'MCP task' }, { id: 'c', type: 'y'.repeat(41) }],
    });
    const out = reduce();
    expect(ev(out, 'Stop').backgroundTasks.types).toEqual(['(unprintable)', 'MCP task']);
    expect(JSON.stringify(out).includes('rm -rf')).toBe(false);
  });

  it('prints a hostile key segment as (unprintable), at the top and below it', () => {
    cap('PostToolUse', 1, 's', { hook_event_name: 'PostToolUse', 'bad key/$(x)': 1, nested: { ok_key: { 'we!rd': true } } });
    const out = reduce();
    const keys = ev(out, 'PostToolUse').keys;
    expect(keys['(unprintable)']).toEqual(['number']);
    expect(keys['nested.ok_key.(unprintable)']).toEqual(['boolean']);
    expect(JSON.stringify(out).includes('bad key')).toBe(false);
    expect(JSON.stringify(out).includes('we!rd')).toBe(false);
  });

  it('collapses an object wider than 50 keys to one (map) segment, and descends one of exactly 50', () => {
    // Letters only (alpha), never a digit: a digit in a key collapses an object to (map)
    // on its own, and these two rows pin the WIDTH bound and nothing else.
    const wide = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${alpha(i)}`, i]));
    const fifty = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`m${alpha(i)}`, 'v']));
    cap('Stop', 1, 's', { hook_event_name: 'Stop', big: wide, mid: fifty });
    const keys = ev(reduce(), 'Stop').keys;
    expect(keys['big']).toEqual(['object']);
    expect(keys['big.(map)']).toEqual(['number']);
    expect(Object.keys(keys).filter((k) => k.startsWith('big.k'))).toEqual([]);
    expect(keys['mid.maa']).toEqual(['string']);
    expect(keys['mid.(map)']).toBeUndefined();
  });

  it('collapses a nested object with a digit in any key to (map), and keeps a payload-root key with a digit', () => {
    cap('Stop', 1, 's', {
      hook_event_name: 'Stop', x2_field: 1,
      by_task: { b989ocn62: { type: 'monitor' } },
      mixed: { plain: 1, id7: 2 },
      clean: { plain: 1, other: 'v' },
      nested: { deeper: { t5: true } },
    });
    const out = reduce();
    const keys = ev(out, 'Stop').keys;
    expect(keys['x2_field']).toEqual(['number']);   // the root is the hook's own schema, never an id map
    expect(keys['by_task']).toEqual(['object']);
    expect(keys['by_task.(map)']).toEqual(['object']);
    expect(keys['mixed.(map)']).toEqual(['number']);
    expect(keys['clean.plain']).toEqual(['number']);
    expect(keys['clean.(map)']).toBeUndefined();
    expect(keys['nested.deeper.(map)']).toEqual(['boolean']);
    for (const leak of ['b989ocn62', 'id7', 't5']) expect(JSON.stringify(out).includes(leak), leak).toBe(false);
  });

  it('walks to depth 4 and no deeper', () => {
    cap('Stop', 1, 's', { hook_event_name: 'Stop', a: { b: { c: { d: { e: 1 } } } } });
    const keys = ev(reduce(), 'Stop').keys;
    expect(keys['a.b.c.d']).toEqual(['object']);
    expect(keys['a.b.c.d.e']).toBeUndefined();
  });

  it('compares the meta line with the payload session_id as counts only', () => {
    cap('PostToolUse', 1, 'sid-1', { hook_event_name: 'PostToolUse', session_id: 'sid-1' });
    cap('PostToolUse', 2, 'sid-1', { hook_event_name: 'PostToolUse', session_id: 'sid-2' });
    cap('PostToolUse', 3, null, { hook_event_name: 'PostToolUse', session_id: 'sid-1' });
    const out = reduce();
    expect(ev(out, 'PostToolUse').envSid).toEqual({ absent: 1, equalsPayload: 1, differsFromPayload: 1, payloadAbsent: 0 });
    expect(JSON.stringify(out).includes('sid-1')).toBe(false);
  });

  it('counts a payload with no string session_id as payloadAbsent, never as differing', () => {
    cap('PostToolUse', 1, 'sid-1', { hook_event_name: 'PostToolUse' });
    cap('PostToolUse', 2, 'sid-1', { hook_event_name: 'PostToolUse', session_id: 5 });
    cap('PostToolUse', 3, 'sid-1', { hook_event_name: 'PostToolUse', session_id: 'sid-1' });
    cap('PostToolUse', 4, null, { hook_event_name: 'PostToolUse' });
    expect(ev(reduce(), 'PostToolUse').envSid).toEqual({ absent: 1, equalsPayload: 1, differsFromPayload: 0, payloadAbsent: 2 });
  });

  it('lists SessionStarts in epoch order (numeric, not by filename) with first, same, changed and unmeasured', () => {
    // Filename order would put 1000 before 900: the numeric sort is what this row pins.
    cap('SessionStart', 900, 's-a', { hook_event_name: 'SessionStart', source: 'startup' });
    cap('Stop', 950, 's-a', { hook_event_name: 'Stop' });
    cap('SessionStart', 1000, 's-a', { hook_event_name: 'SessionStart', source: 'resume' });
    cap('SessionStart', 1100, 's-b', { hook_event_name: 'SessionStart', source: 'clear' });
    cap('SessionStart', 1200, null, { hook_event_name: 'SessionStart' });
    const out = reduce();
    expect(out.sessionStarts).toEqual([
      { source: 'startup', envSidVsPrevious: 'first' },
      { source: 'resume', envSidVsPrevious: 'same' },
      { source: 'clear', envSidVsPrevious: 'changed' },
      { source: '(absent)', envSidVsPrevious: 'unmeasured' },
    ]);
    expect(ev(out, 'SessionStart').source).toEqual(['(absent)', 'clear', 'resume', 'startup']);
    expect(ev(out, 'Stop')).not.toHaveProperty('source');
  });

  it('reports StopFailure error fields by name and their values as tokens, and only for StopFailure', () => {
    cap('StopFailure', 1, 's', { hook_event_name: 'StopFailure', error: 'server_error' });
    cap('StopFailure', 2, 's', { hook_event_name: 'StopFailure', error: 'rate_limit', reason: 'a long text / with a slash', error_detail: 5 });
    cap('Stop', 3, 's', { hook_event_name: 'Stop', error: 'server_error' });
    const out = reduce();
    expect(ev(out, 'StopFailure').error).toEqual({
      fields: ['error', 'reason'], values: ['(unprintable)', 'rate_limit', 'server_error'],
    });
    expect(ev(out, 'Stop')).not.toHaveProperty('error');
  });

  it('prints a StopFailure error-field value as (unprintable) unless it is enum-shaped, and keeps the field name', () => {
    cap('StopFailure', 1, 's', {
      hook_event_name: 'StopFailure', error: 'server_error', error_details: 'SENTINEL host x.example.org',
    });
    const out = reduce();
    const text = JSON.stringify(out);
    expect(text.includes('SENTINEL')).toBe(false);
    expect(text.includes('example.org')).toBe(false);
    // Control: the field was read — its NAME is reported and the enum value came through.
    expect(ev(out, 'StopFailure').error).toEqual({
      fields: ['error', 'error_details'], values: ['(unprintable)', 'server_error'],
    });
  });

  it('counts an unparseable payload, and ignores files outside the capture grammar', () => {
    cap('Stop', 1, 's', 'not json {');
    cap('Stop', 2, 's', '[1,2]');
    cap('Stop', 3, 's', { hook_event_name: 'Stop' });
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, '.Stop.123.capture.tmp'), '{}\n{}\n');
    const out = reduce();
    expect(out).toMatchObject({ v: 1, files: 3, unparsed: 2 });
    expect(ev(out, 'Stop').count).toBe(3);
    expect(ev(out, 'Stop').agentId).toEqual({ absent: 1, empty: 0, nonEmpty: 0 });
  });

  it('refuses a missing directory and a missing argument with exit 2, one stderr line and no stdout', () => {
    for (const args of [[path.join(dir, 'nope')], []]) {
      const r = reduceRaw(args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    }
  });
});
