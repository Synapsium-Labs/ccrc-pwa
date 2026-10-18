// The pure workflow model (D-5560, D-5561): Claude Code's measured file shapes
// in, the session page's rows out. Every fixture here is built from the SHAPES
// measured on 2.1.203-2.1.302 (key names, value types, line order) with
// neutral names and values — no measured content.
import { describe, expect, it } from 'vitest';
import {
  decideRun,
  emptyCarry,
  emptyFold,
  firstAgentAfter,
  foldJournal,
  lastUsageTokens,
  parseScriptPhases,
  parseSummary,
  runningView,
  scriptNameFor,
  selectRows,
  splitLines,
  summaryView,
  RUN_ID_RE,
  workflowsFrame,
} from '../src/workflows/model.js';
import { WORKFLOW_AGENTS_MAX, WORKFLOW_EVICT_MS } from '../../shared/workflows.js';

const hex = (c: string): string => c.repeat(64);
const KEY_A = `v2:${hex('a')}`;
const KEY_B = `v2:${hex('b')}`;
const KEY_C = `v2:${hex('c')}`;
const line = (o: unknown): string => JSON.stringify(o);

/** The running fixture of the measured source §7: 2 of 3 done, one retry. */
const RUNNING_2_1_302 = [
  line({ type: 'launched' }),
  line({ type: 'started', key: KEY_A, agentId: 'a0000000000000001', label: 'build', phase: 'Build' }),
  line({ type: 'result', key: KEY_A, agentId: 'a0000000000000001', result: { ok: true } }),
  line({ type: 'started', key: KEY_B, agentId: 'a0000000000000002', label: 'verify-1', phase: 'Verify' }),
  line({ type: 'failed', key: KEY_B, agentId: 'a0000000000000002' }),
  line({ type: 'started', key: KEY_B, agentId: 'a0000000000000003', label: 'verify-1', phase: 'Verify' }),
  line({ type: 'result', key: KEY_B, agentId: 'a0000000000000003', result: 'text' }),
  line({ type: 'started', key: KEY_C, agentId: 'a0000000000000004', label: 'verify-2', phase: 'Verify' }),
];

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('foldJournal — each measured version shape', () => {
  it('2.1.265+: total is distinct keys, done is keys whose last line is a result, a retry is one agent', () => {
    const fold = foldJournal(emptyFold(), RUNNING_2_1_302);
    const v = runningView({ id: 'wf_00000000-aaa', name: 'example-flow', fold, tokens: new Map(), phases: null, startedAt: 1 });
    expect([v.done, v.failed, v.total]).toEqual([2, 0, 3]);
    expect(v.agents).toEqual([
      { label: 'build', phase: 'Build', state: 'done' },
      { label: 'verify-1', phase: 'Verify', state: 'done' },
      { label: 'verify-2', phase: 'Verify', state: 'running' },
    ]);
    expect(v.phase).toBe('Verify');
  });

  it('2.1.251-2.1.263: no launched line and no label — the agent has a null label, never an invented one', () => {
    const fold = foldJournal(emptyFold(), [
      line({ type: 'started', key: KEY_A, agentId: 'a0000000000000005' }),
      line({ type: 'failed', key: KEY_A, agentId: '' }),
    ]);
    const v = runningView({ id: 'wf_00000000-bbb', name: null, fold, tokens: new Map(), phases: null, startedAt: null });
    expect([v.done, v.failed, v.total]).toEqual([0, 1, 1]);
    expect(v.agents).toEqual([{ label: null, phase: null, state: 'failed' }]);
  });

  it('≤2.1.250: started and result only', () => {
    const fold = foldJournal(emptyFold(), [
      line({ type: 'started', key: KEY_A, agentId: 'a1' }),
      line({ type: 'result', key: KEY_A, agentId: 'a1', result: {} }),
      line({ type: 'started', key: KEY_B, agentId: 'a2' }),
    ]);
    const v = runningView({ id: 'wf_00000000-ccc', name: null, fold, tokens: new Map(), phases: null, startedAt: null });
    expect([v.done, v.failed, v.total]).toEqual([1, 0, 2]);
  });

  it('a label the started line lacks is taken from the meta file the reader supplies', () => {
    const fold = foldJournal(emptyFold(), [line({ type: 'started', key: KEY_A, agentId: 'a1' })]);
    const v = runningView({
      id: 'wf_00000000-ddd', name: null, fold, tokens: new Map(), phases: null, startedAt: null,
      meta: new Map([['a1', { label: 'from-meta', phase: 'P' }]]),
    });
    expect(v.agents).toEqual([{ label: 'from-meta', phase: 'P', state: 'running' }]);
  });

  it('a malformed line and an unknown line type change no count', () => {
    const fold = foldJournal(emptyFold(), ['{not json', line({ type: 'restored' }), ...RUNNING_2_1_302]);
    const v = runningView({ id: 'wf_00000000-eee', name: null, fold, tokens: new Map(), phases: null, startedAt: null });
    expect([v.done, v.total]).toEqual([2, 3]);
  });

  it('a result line cut at the carry cap still counts, from its head', () => {
    const big = line({ type: 'result', key: KEY_A, agentId: 'a1', result: 'x'.repeat(300_000) });
    let carry = emptyCarry();
    const lines: string[] = [];
    for (let i = 0; i < big.length; i += 100_000) {
      const r = splitLines(carry, enc(big.slice(i, i + 100_000)));
      carry = r.carry;
      lines.push(...r.lines);
    }
    expect(lines).toEqual([]); // no newline yet: nothing framed
    expect(carry.bytes.length).toBeLessThanOrEqual(65_536); // the carry itself is bounded, not only what it frames
    const end = splitLines(carry, enc('\n'));
    expect(end.lines).toHaveLength(1);
    expect(end.lines[0]!.length).toBeLessThan(70_000); // the carry kept a bounded head, not 300 KB
    const fold = foldJournal(emptyFold(), [line({ type: 'started', key: KEY_A, agentId: 'a1' }), ...end.lines]);
    const v = runningView({ id: 'wf_00000000-fff', name: null, fold, tokens: new Map(), phases: null, startedAt: null });
    expect(v.done).toBe(1);
  });

  it('splitLines keeps a multi-byte character split across two chunks intact', () => {
    const bytes = enc(`${line({ type: 'started', key: KEY_A, agentId: 'a1', label: 'é' })}\n`);
    const cut = bytes.indexOf(0xc3) + 1; // inside the two-byte é
    const a = splitLines(emptyCarry(), bytes.slice(0, cut));
    const b = splitLines(a.carry, bytes.slice(cut));
    expect([...a.lines, ...b.lines].map((l) => JSON.parse(l).label)).toEqual(['é']);
  });
});

describe('runningView — tokens are measured or said to be unmeasured, never zero', () => {
  const fold = (): ReturnType<typeof emptyFold> => foldJournal(emptyFold(), RUNNING_2_1_302);

  it('sums each key\'s LATEST agent; an agent with no reading counts as unmeasured', () => {
    const v = runningView({
      id: 'wf_00000000-aaa', name: null, fold: fold(), phases: null, startedAt: null,
      // a0…2 is the failed attempt of key B: superseded by a0…3, so never summed
      tokens: new Map<string, number | null>([['a0000000000000001', 100], ['a0000000000000002', 9999], ['a0000000000000003', 50], ['a0000000000000004', null]]),
    });
    expect(v.tokens).toBe(150);
    expect(v.tokensUnmeasured).toBe(1);
  });

  it('no agent measured → tokens null, not 0', () => {
    const v = runningView({ id: 'wf_00000000-aaa', name: null, fold: fold(), tokens: new Map(), phases: null, startedAt: null });
    expect(v.tokens).toBeNull();
    expect(v.tokensUnmeasured).toBe(3);
  });
});

describe('lastUsageTokens — the input side of the latest API call', () => {
  const usage = (u: Record<string, number>): string =>
    line({ type: 'assistant', agentId: 'a1', timestamp: '2026-01-01T00:05:00.000Z', message: { id: 'msg_x', usage: u } });

  it('input + cache_read + cache_creation of the last non-zero usage line (the measured fixture: 100502)', () => {
    const text = [
      usage({ input_tokens: 1, cache_read_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 5 }),
      usage({ input_tokens: 2, cache_read_input_tokens: 100000, cache_creation_input_tokens: 500, output_tokens: 40 }),
      usage({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }),
      line({ type: 'user', message: { content: 'x' } }),
    ].join('\n');
    expect(lastUsageTokens(text)).toBe(100502);
  });

  it('a tail that starts mid-line skips that fragment — no suffix of a one-object line parses', () => {
    const full = usage({ input_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 });
    for (let cut = 1; cut < full.length; cut++) expect(lastUsageTokens(full.slice(cut))).toBeNull();
    expect(lastUsageTokens(`${full.slice(5)}\n${full}`)).toBe(7);
  });

  it('no usage line → null', () => {
    expect(lastUsageTokens(line({ type: 'user' }))).toBeNull();
  });
});

describe('decideRun — the measured running/finished rule, no recency timeout', () => {
  const live = { kind: 'live' as const, startedAt: 1000 };
  it('a summary at or after the journal is finished', () => {
    expect(decideRun({ summaryMtime: 5000, journalMtime: 5000, activityMtime: 5000, proc: live })).toBe('finished');
  });
  it('a killed summary the journal grew past is a resume in place: running', () => {
    expect(decideRun({ summaryMtime: 5000, journalMtime: 6000, activityMtime: 6000, proc: live })).toBe('running');
  });
  it('no summary and every write before this process started: interrupted (an orphan)', () => {
    expect(decideRun({ summaryMtime: null, journalMtime: 900, activityMtime: 900, proc: live })).toBe('interrupted');
  });
  it('no summary and the session process gone: interrupted', () => {
    expect(decideRun({ summaryMtime: null, journalMtime: 9000, activityMtime: 9000, proc: { kind: 'gone' } })).toBe('interrupted');
  });
  it('no summary and the process unmeasured: undecided, so the reader holds what it showed', () => {
    expect(decideRun({ summaryMtime: null, journalMtime: 9000, activityMtime: 9000, proc: { kind: 'unmeasured' } })).toBe('undecided');
  });
  it('no summary, a live process, a write after it started: running, however long ago', () => {
    expect(decideRun({ summaryMtime: null, journalMtime: 1001, activityMtime: 1001, proc: live })).toBe('running');
  });
  it('a live process with no startedAt (an older build) cannot be ruled an orphan: running', () => {
    expect(decideRun({ summaryMtime: null, journalMtime: 1, activityMtime: 1, proc: { kind: 'live', startedAt: null } })).toBe('running');
  });
});

/** The summary shape, identical from 2.1.203 to 2.1.302 (subset of keys + the agent entries). */
const SUMMARY = {
  runId: 'wf_00000000-aaa', timestamp: '2026-01-01T01:00:00.000Z', taskId: 'w00000000', workflowName: 'example-flow',
  status: 'completed', startTime: 1767225600000, durationMs: 3600000, agentCount: 3, totalTokens: 300000, totalToolCalls: 90,
  phases: [{ title: 'Build' }, { title: 'Verify' }],
  workflowProgress: [
    { type: 'workflow_phase', index: 1, title: 'Build' },
    { type: 'workflow_agent', index: 0, label: 'build', phaseIndex: 1, phaseTitle: 'Build', agentId: 'a1', model: 'm', state: 'done', startedAt: 1767225600040, lastProgressAt: 1767226000000, tokens: 100000, toolCalls: 30, durationMs: 400000 },
    { type: 'workflow_agent', index: 1, label: 'verify-1', phaseIndex: 2, phaseTitle: 'Verify', agentId: 'a2', model: 'm', state: 'error', startedAt: 1767226000000, lastProgressAt: 1767226100000 },
  ],
  script: '', scriptPath: '', result: null, logs: [], summary: '', defaultModel: 'm',
};

describe('parseSummary / summaryView — a finished workflow', () => {
  it('reads status, name, start, duration, tokens and the agents; total = max(agentCount, entries)', () => {
    const facts = parseSummary(JSON.stringify(SUMMARY));
    expect(facts).not.toBeNull();
    const v = summaryView('wf_00000000-aaa', facts!, 0);
    expect(v).toMatchObject({
      name: 'example-flow', state: 'completed', done: 1, failed: 1, total: 3,
      startedAt: 1767225600000, endedAt: 1767229200000, tokens: 300000, tokensUnmeasured: 0,
      phases: ['Build', 'Verify'],
    });
    expect(v.agents).toEqual([
      { label: 'build', phase: 'Build', state: 'done' },
      { label: 'verify-1', phase: 'Verify', state: 'failed' },
    ]);
  });
  it('failed and killed keep their own word; an agent cut off mid-run stays running inside the stopped row', () => {
    const killed = { ...SUMMARY, status: 'killed', workflowProgress: [{ ...SUMMARY.workflowProgress[1], state: 'progress' }] };
    const v = summaryView('wf_00000000-aaa', parseSummary(JSON.stringify(killed))!, 0);
    expect(v.state).toBe('killed');
    expect(v.agents[0]!.state).toBe('running');
    expect(summaryView('x', parseSummary(JSON.stringify({ ...SUMMARY, status: 'failed' }))!, 0).state).toBe('failed');
  });
  it('a status outside the three words, or bytes that are not a summary, parse to null', () => {
    expect(parseSummary(JSON.stringify({ ...SUMMARY, status: 'paused' }))).toBeNull();
    expect(parseSummary('{"runId":')).toBeNull();
  });
  it('a summary with no startTime/duration ends at the file\'s own mtime', () => {
    const { startTime: _s, durationMs: _d, ...rest } = SUMMARY;
    const v = summaryView('x', parseSummary(JSON.stringify(rest))!, 4242);
    expect([v.startedAt, v.endedAt]).toEqual([null, 4242]);
  });
});

describe('selectRows — finished rows drop off after Claude Code\'s 30 s', () => {
  const base = summaryView('wf_00000000-aaa', parseSummary(JSON.stringify(SUMMARY))!, 0);
  it('a finished row is shown under 30 s from its end and gone at 30 s', () => {
    const end = base.endedAt!;
    expect(selectRows([base], end + WORKFLOW_EVICT_MS - 1)).toHaveLength(1);
    expect(selectRows([base], end + WORKFLOW_EVICT_MS)).toHaveLength(0);
  });
  it('running rows always show, oldest start first, unknown starts last', () => {
    const fold = foldJournal(emptyFold(), RUNNING_2_1_302);
    const r = (id: string, startedAt: number | null) =>
      runningView({ id, name: id, fold, tokens: new Map(), phases: null, startedAt });
    expect(selectRows([r('c', null), r('b', 20), r('a', 10)], 1e15).map((v) => v.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('a huge run is bounded on the wire, and the cut is said', () => {
  it(`more than ${WORKFLOW_AGENTS_MAX} agents: running and failed are kept, the rest counted in agentsOmitted`, () => {
    const lines: string[] = [];
    for (let i = 0; i < 600; i++) {
      const key = `v2:${i.toString(16).padStart(64, '0')}`;
      lines.push(line({ type: 'started', key, agentId: `a${i}`, label: `agent-${i}` }));
      if (i < 590) lines.push(line({ type: i === 3 ? 'failed' : 'result', key, agentId: `a${i}`, result: 'r' }));
    }
    const v = runningView({ id: 'wf_00000000-aaa', name: null, fold: foldJournal(emptyFold(), lines), tokens: new Map(), phases: null, startedAt: null });
    expect(v.total).toBe(600);
    expect(v.agents).toHaveLength(WORKFLOW_AGENTS_MAX);
    expect(v.agentsOmitted).toBe(600 - WORKFLOW_AGENTS_MAX);
    expect(v.agents.filter((a) => a.state === 'running')).toHaveLength(10);
    expect(v.agents.some((a) => a.label === 'agent-3' && a.state === 'failed')).toBe(true);
    // and in schedule order, newest last
    expect(v.agents.at(-1)!.label).toBe('agent-599');
  });
});

describe('names and phases', () => {
  it('scriptNameFor takes the filename prefix before -<runId>.js, the way Claude Code matches it', () => {
    expect(scriptNameFor(['other-wf_00000000-bbb.js', 'example-flow-wf_00000000-aaa.js'], 'wf_00000000-aaa')).toBe('example-flow');
    expect(scriptNameFor(['Bad Name-wf_00000000-aaa.js'], 'wf_00000000-aaa')).toBeNull();
    expect(scriptNameFor([], 'wf_00000000-aaa')).toBeNull();
  });
  it('parseScriptPhases reads meta.phases titles without evaluating anything', () => {
    const src = "export const meta = {\n  name: 'example-flow',\n  phases: [{ title: 'Build' }, { title: \"Verify\", detail: 'x' }, { title: `Ship` }],\n};\nexport default async () => {};";
    expect(parseScriptPhases(src)).toEqual(['Build', 'Verify', 'Ship']);
    expect(parseScriptPhases("export const meta = { name: 'n' };")).toBeNull();
  });
  it('the run id pattern is the measured one', () => {
    expect(RUN_ID_RE.test('wf_0123abcd-9ef')).toBe(true);
    expect(RUN_ID_RE.test('wf_0123abcd-9ef.json')).toBe(false);
    expect(RUN_ID_RE.test('scripts')).toBe(false);
  });
});

describe('firstAgentAfter — where a run (or its resume) started', () => {
  it('the first agent in schedule order whose start is after the floor', () => {
    const fold = foldJournal(emptyFold(), RUNNING_2_1_302);
    // every attempt counts, the failed a0…2 included: it was a start too
    const starts = new Map([['a0000000000000001', 100], ['a0000000000000002', 200], ['a0000000000000003', 300], ['a0000000000000004', 400]]);
    expect(firstAgentAfter(fold, starts, null)).toEqual({ at: 100 });
    // a resume in place: the summary was written at 250, so the resume started with the first agent after it
    expect(firstAgentAfter(fold, starts, 250)).toEqual({ at: 300 });
    // a start not measured yet is said, not skipped past
    expect(firstAgentAfter(fold, new Map(), null)).toEqual({ need: 'a0000000000000001' });
  });
});

describe('workflowsFrame — absent, unreadable and read are three frames', () => {
  const row = summaryView('wf_00000000-aaa', parseSummary(JSON.stringify(SUMMARY))!, 0);
  it('read: the rows', () => {
    expect(workflowsFrame({ kind: 'read', workflows: [row] }, false, [])).toEqual({ workflows: [row], unreadable: false });
  });
  it('absent with no witness: none', () => {
    expect(workflowsFrame({ kind: 'absent' }, false, [row])).toEqual({ workflows: [], unreadable: false });
  });
  it('absent while the hook lists a background workflow: unreadable, never "none"', () => {
    expect(workflowsFrame({ kind: 'absent' }, true, [])).toEqual({ workflows: [], unreadable: true });
  });
  it('unreadable: the last rows read stand, flagged', () => {
    expect(workflowsFrame({ kind: 'unreadable' }, false, [row])).toEqual({ workflows: [row], unreadable: true });
  });
});
