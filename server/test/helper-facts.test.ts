// Session helpers H1a (D-8829): `helperFactsOf`, the pure parser of an Agent launch result and of a task
// notification, one raw transcript line in, `HelperFact[]` out. Every fixture is built from the SHAPES measured on
// 2.1.280 to 2.1.319 (key names, value types), with neutral names and values: no measured content.
import { describe, expect, it } from 'vitest';
import { helperFactsOf } from '../src/transcript/parse.js';
import { HELPER_REPORT_MAX_BYTES, HELPER_SUMMARY_MAX_BYTES } from '../../shared/workflows.js';

const TS = '2026-11-20T09:32:17.244Z';
const AT = Date.parse(TS);
const line = (o: unknown): string => JSON.stringify(o);

/** A user record carrying one tool result, its `toolUseResult` beside the message (the measured shape). */
const toolResult = (toolUseResult: unknown, extra: object = {}): string =>
  line({ type: 'user', timestamp: TS, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'x' }] }, toolUseResult, ...extra });

const ASYNC = { isAsync: true, status: 'async_launched', agentId: 'a516cb53d83b231c7', description: 'd', resolvedModel: 'claude-opus-5-5', prompt: 'p', outputFile: '/o', canReadOutputFile: true, canContinueAgent: true };

/** A task notification record: the harness writes it as a user record whose content is the envelope. */
const notification = (o: { id?: string; status?: string; summary?: string; result?: string | null; ts?: string } = {}): string =>
  line({
    type: 'user',
    timestamp: o.ts ?? TS,
    origin: { kind: 'task-notification' },
    message: {
      role: 'user',
      content: `<task-notification>\n<task-id>${o.id ?? 'a516cb53d83b231c7'}</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n<output-file>/o</output-file>\n`
        + `<status>${o.status ?? 'completed'}</status>\n<summary>${o.summary ?? 'Agent "x" completed'}</summary>\n`
        + `${o.result === null ? '' : `<result>${o.result ?? 'the report'}</result>\n`}</task-notification>`,
    },
  });

describe('helperFactsOf: an Agent launch result', () => {
  it('a background launch (async_launched): the agent id, the resolved model and the record\'s own time', () => {
    expect(helperFactsOf(toolResult(ASYNC))).toEqual([
      { source: 'launch', id: 'a516cb53d83b231c7', status: 'async_launched', at: AT, model: 'claude-opus-5-5', durationMs: null, summary: null, report: null, reportCut: false },
    ]);
  });

  it('a foreground launch (completed): the report, the duration, and the resolved model when it names one', () => {
    const f = helperFactsOf(toolResult({ status: 'completed', agentId: 'a1', content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }], totalDurationMs: 4200 }));
    expect(f).toEqual([
      { source: 'launch', id: 'a1', status: 'completed', at: AT, model: null, durationMs: 4200, summary: null, report: 'first\nsecond', reportCut: false },
    ]);
  });

  it('a foreground launch that names a resolved model carries it', () => {
    expect(helperFactsOf(toolResult({ status: 'completed', agentId: 'a1', content: 'r', resolvedModel: 'claude-sonnet-5-5' }))[0]!.model).toBe('claude-sonnet-5-5');
  });

  it('a foreground report of whitespace only is no report', () => {
    expect(helperFactsOf(toolResult({ status: 'completed', agentId: 'a1', content: '  \n ' }))[0]).toMatchObject({ report: null, reportCut: false });
  });

  it('a foreground report over the cap is cut, and says so', () => {
    const f = helperFactsOf(toolResult({ status: 'completed', agentId: 'a1', content: [{ type: 'text', text: 'word '.repeat(10_000) }] }))[0]!;
    expect(Buffer.byteLength(f.report!, 'utf8')).toBeLessThanOrEqual(HELPER_REPORT_MAX_BYTES);
    expect(f.reportCut).toBe(true);
  });

  it('a record that is not a user record yields none, whatever it carries', () => {
    expect(helperFactsOf(toolResult(ASYNC, { type: 'assistant' }))).toEqual([]);
    expect(helperFactsOf(notification().replace('"type":"user"', '"type":"assistant"'))).toEqual([]);
  });

  it('a record that carries both reads as the launch result (one record is one fact)', () => {
    const both = line({ type: 'user', timestamp: TS, toolUseResult: ASYNC, message: { role: 'user', content: '<task-notification><task-id>other</task-id><status>completed</status></task-notification>' } });
    expect(helperFactsOf(both).map((f) => [f.source, f.id])).toEqual([['launch', 'a516cb53d83b231c7']]);
  });

  it('a notification whose tag never closes yields none, and never throws', () => {
    const open = line({ type: 'user', timestamp: TS, message: { role: 'user', content: '<task-notification><task-id>a1</task-id>' } });
    expect(helperFactsOf(open)).toEqual([]);
  });

  it('a numeric timestamp is no time (a number reads as a date by coercion, never as one here)', () => {
    expect(helperFactsOf(toolResult(ASYNC, { timestamp: 123 }))[0]!.at).toBeNull();
  });

  it('a foreground duration too big to be a number is null: the JSON 1e999 parses to Infinity', () => {
    const raw = toolResult({ status: 'completed', agentId: 'a1', content: 'r' }).replace('"status":"completed"', '"totalDurationMs":1e999,"status":"completed"');
    expect(helperFactsOf(raw)[0]!.durationMs).toBeNull();
  });

  it('a foreground report given as a plain string content reads too', () => {
    const f = helperFactsOf(toolResult({ status: 'completed', agentId: 'a1', content: 'plain report' }));
    expect(f[0]).toMatchObject({ report: 'plain report', durationMs: null });
  });

  it.each([
    ['a Workflow launch (no agent id)', { status: 'async_launched', taskId: 'wabc', taskType: 'local_workflow', runId: 'wf_1-aa' }],
    ['an agent id outside [A-Za-z0-9_-]{1,64}', { ...ASYNC, agentId: 'bad id;' }],
    ['an agent id of 65 characters', { ...ASYNC, agentId: 'a'.repeat(65) }],
    ['an agent id with a space', { ...ASYNC, agentId: 'a b' }],
    ['an empty agent id', { ...ASYNC, agentId: '' }],
    ['an agent id that is a number', { ...ASYNC, agentId: 7 }],
    ['a status that is neither launched nor completed', { ...ASYNC, status: 'weird' }],
    ['a non-object result', 'async_launched'],
    ['a null result', null],
  ])('%s yields no fact', (_n, r) => {
    expect(helperFactsOf(toolResult(r))).toEqual([]);
  });

  it('a malformed line, a non-object line and a sidechain record yield none, and never throw', () => {
    expect(helperFactsOf('{not json')).toEqual([]);
    expect(helperFactsOf('"a string"')).toEqual([]);
    expect(helperFactsOf('null')).toEqual([]);
    expect(helperFactsOf(toolResult(ASYNC, { isSidechain: true }))).toEqual([]);
  });

  it('a missing or unparsable timestamp reads as null, never as zero or now', () => {
    expect(helperFactsOf(toolResult(ASYNC, { timestamp: undefined }))[0]!.at).toBeNull();
    expect(helperFactsOf(toolResult(ASYNC, { timestamp: 'not a time' }))[0]!.at).toBeNull();
  });

  it('a foreground duration that is not a finite number is null', () => {
    expect(helperFactsOf(toolResult({ status: 'completed', agentId: 'a1', content: 'r', totalDurationMs: 'soon' }))[0]!.durationMs).toBeNull();
  });
});

describe('helperFactsOf: a task notification', () => {
  it.each([
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['killed', 'killed'],
    ['stopped', 'stopped'],
  ])('status %s: the task id, the summary, the report and the notification\'s time', (status, want) => {
    const f = helperFactsOf(notification({ status, summary: 'one line', result: 'body' }));
    expect(f).toEqual([
      { source: 'notification', id: 'a516cb53d83b231c7', status: want, at: AT, model: null, durationMs: null, summary: 'one line', report: 'body', reportCut: false },
    ]);
  });

  it('a notification with no result member has no report (never an empty string)', () => {
    expect(helperFactsOf(notification({ result: null }))[0]).toMatchObject({ report: null, reportCut: false });
  });

  it('a status outside the four final words (a task still running, or one this reader has not seen) yields no fact', () => {
    expect(helperFactsOf(notification({ status: 'running' }))).toEqual([]);
    expect(helperFactsOf(notification({ status: 'cancelled' }))).toEqual([]);
  });

  it('a record that merely mentions the tag, or has prose around it, is no notification (a human keeps every word)', () => {
    const human = line({ type: 'user', timestamp: TS, message: { role: 'user', content: 'what is this? <task-notification><task-id>a1</task-id><status>completed</status></task-notification>' } });
    expect(helperFactsOf(human)).toEqual([]);
  });

  it('a notification with no task id yields none', () => {
    const noId = line({ type: 'user', timestamp: TS, message: { role: 'user', content: '<task-notification><status>completed</status><summary>s</summary></task-notification>' } });
    expect(helperFactsOf(noId)).toEqual([]);
  });

  it('a task id outside the id grammar yields none', () => {
    expect(helperFactsOf(notification({ id: 'bad id;' }))).toEqual([]);
    expect(helperFactsOf(notification({ id: 'a b' }))).toEqual([]);
    expect(helperFactsOf(notification({ id: 'a'.repeat(65) }))).toEqual([]);
    expect(helperFactsOf(notification({ id: 'a'.repeat(64) }))).toHaveLength(1);
  });

  it('the summary is one line of at most HELPER_SUMMARY_MAX_BYTES bytes, cut on a character boundary', () => {
    const f = helperFactsOf(notification({ summary: `first line\nsecond line` }))[0]!;
    expect(f.summary).toBe('first line');
    const long = helperFactsOf(notification({ summary: 'é'.repeat(300) }))[0]!;
    expect(Buffer.byteLength(long.summary!, 'utf8')).toBeLessThanOrEqual(HELPER_SUMMARY_MAX_BYTES);
    expect(long.summary).toBe('é'.repeat(HELPER_SUMMARY_MAX_BYTES / 2));
    expect(long.summary).not.toContain('�');
  });
});

describe('helperFactsOf: the bounds are the spec\'s numbers', () => {
  it('a report is at most 16 KiB and a summary at most 200 bytes', () => {
    expect([HELPER_REPORT_MAX_BYTES, HELPER_SUMMARY_MAX_BYTES]).toEqual([16_384, 200]);
  });
});

describe('helperFactsOf: the report is masked, then cut (review 2900 F15)', () => {
  const KEY = 'sk-ant-api03-' + 'A'.repeat(40);

  it('a credential shape in a notification\'s result never leaves the parser', () => {
    const f = helperFactsOf(notification({ result: `token ${KEY} end` }))[0]!;
    expect(f.report).not.toContain('sk-ant-api03');
    expect(f.report).toContain('token ');
  });

  it('a credential shape in a foreground launch report never leaves the parser', () => {
    const f = helperFactsOf(toolResult({ status: 'completed', agentId: 'a1', content: [{ type: 'text', text: `k=${KEY}` }] }))[0]!;
    expect(f.report).not.toContain('sk-ant-api03');
  });

  it('a credential shape in the summary never leaves the parser', () => {
    const f = helperFactsOf(notification({ summary: `leaked ${KEY}` }))[0]!;
    expect(f.summary).not.toContain('sk-ant-api03');
  });

  it('masked before cut: a key that STRADDLES the cap is gone whole, not left as a readable prefix', () => {
    // The key's first 20 bytes sit inside the cap and its tail outside it: a cut-then-mask order would leave
    // `sk-ant-api03-AAAA…` readable (a prefix too short for the shape to match).
    const pad = 'x '.repeat((HELPER_REPORT_MAX_BYTES - 20) / 2);
    const f = helperFactsOf(notification({ result: `${pad}${KEY} ${'tail '.repeat(1000)}` }))[0]!;
    expect(f.report).not.toMatch(/sk-ant/);
    expect(f.reportCut).toBe(true);
  });

  it('a report over HELPER_REPORT_MAX_BYTES is cut to at most that many bytes and says so', () => {
    const f = helperFactsOf(notification({ result: 'word '.repeat(10_000) }))[0]!;
    expect(Buffer.byteLength(f.report!, 'utf8')).toBeLessThanOrEqual(HELPER_REPORT_MAX_BYTES);
    expect(f.reportCut).toBe(true);
  });

  it('a multi-byte report is cut in bytes, not characters, and never mid-character', () => {
    const f = helperFactsOf(notification({ result: '€'.repeat(10_000) }))[0]!;
    expect(Buffer.byteLength(f.report!, 'utf8')).toBeLessThanOrEqual(HELPER_REPORT_MAX_BYTES);
    expect(f.report).not.toContain('�');
    expect(f.reportCut).toBe(true);
  });

  it('a report exactly at the cap is whole and not cut', () => {
    const f = helperFactsOf(notification({ result: 'a'.repeat(HELPER_REPORT_MAX_BYTES) }))[0]!;
    expect(Buffer.byteLength(f.report!, 'utf8')).toBe(HELPER_REPORT_MAX_BYTES);
    expect(f.reportCut).toBe(false);
  });

  it('the cut backs off to a delimiter, so it never splits a run that could be a key (cutAt, D-5995)', () => {
    const run = 'k'.repeat(100);
    const f = helperFactsOf(notification({ result: `${'a '.repeat(HELPER_REPORT_MAX_BYTES / 2 - 50)}${run}${run}` }))[0]!;
    expect(f.report!.endsWith('k')).toBe(false);
  });
});
