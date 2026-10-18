// The bounded workflow reader (D-5561) against real files in a fixture dir:
// the measured layout, neutral names and values, and a FleetIO wrapper that
// counts every read so the bounds are measured rather than asserted in prose.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import {
  AGENT_READS_PER_TICK, JOURNAL_CHUNKS_PER_TICK, RESTAT_EVERY, SessionWorkflows, TAIL_BYTES, sessionDirOf,
} from '../src/workflows/read.js';
import type { Proc } from '../src/workflows/model.js';
import { READ_FROM_MAX_BYTES } from '../../shared/agent-protocol.js';
import { mkTmp } from './tmpHelpers.js';

const RUN = 'wf_00000000-aaa';
const RUN_B = 'wf_00000000-bbb';
const key = (i: number): string => `v2:${i.toString(16).padStart(64, '0')}`;
const line = (o: unknown): string => `${JSON.stringify(o)}\n`;
const usageLine = (agentId: string, input: number): string =>
  line({ type: 'assistant', agentId, timestamp: '2026-01-01T00:05:00.000Z', version: '2.1.302',
    message: { id: 'msg_x', usage: { input_tokens: input, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 9 } } });

const T0 = Date.parse('2026-01-01T00:00:00Z');
const at = (f: string, ms: number): void => utimesSync(f, new Date(ms), new Date(ms));
const LIVE: Proc = { kind: 'live', startedAt: T0 - 60_000 };

interface Counted extends FleetIO {
  calls: Array<{ op: string; path: string; offset?: number; max?: number }>;
}
const counted = (inner: FleetIO, fail: (op: string, p: string) => boolean = () => false): Counted => {
  const calls: Counted['calls'] = [];
  return {
    ...inner,
    calls,
    readdirMeasured: async (p, ...rest) => {
      calls.push({ op: 'readdir', path: p });
      return fail('readdir', p) ? { ok: false, reason: 'unreadable' } : inner.readdirMeasured(p, ...rest);
    },
    statMeasured: async (p) => {
      calls.push({ op: 'stat', path: p });
      return fail('stat', p) ? { ok: false, reason: 'unreadable' } : inner.statMeasured(p);
    },
    readFileMeasured: async (p, ...rest) => {
      calls.push({ op: 'read', path: p });
      return fail('read', p) ? { ok: false, reason: 'unreadable' } : inner.readFileMeasured(p, ...rest);
    },
    readFileFromBytesMeasured: async (p, offset, max, ...rest) => {
      calls.push({ op: 'range', path: p, offset, max });
      return fail('range', p) ? { ok: false, reason: 'unreadable' } : inner.readFileFromBytesMeasured(p, offset, max, ...rest);
    },
  };
};

let home: string;
let S: string;
beforeEach(() => {
  home = mkTmp('ccrc-wf-read-');
  S = path.join(home, '.claude-a', 'projects', '-work-project-a', 'session-uuid-a');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** A run dir with a journal of `lines`, meta files stamped at their starts, and agent transcripts. */
const seedRun = (runId: string, lines: string[], opts: { agents?: Record<string, { start: number; input?: number }>; journalAt?: number } = {}): string => {
  const dir = path.join(S, 'subagents', 'workflows', runId);
  mkdirSync(dir, { recursive: true });
  for (const [id, a] of Object.entries(opts.agents ?? {})) {
    const meta = path.join(dir, `agent-${id}.meta.json`);
    writeFileSync(meta, JSON.stringify({ agentType: 'workflow-subagent', description: `meta-${id}`, workflowPhase: 'Meta', spawnDepth: 1, requestShape: 'foreground', requestNonInteractive: false }));
    at(meta, a.start);
    const tr = path.join(dir, `agent-${id}.jsonl`);
    writeFileSync(tr, a.input === undefined ? line({ type: 'user', agentId: id }) : usageLine(id, a.input));
    at(tr, a.start + 1000);
  }
  const j = path.join(dir, 'journal.jsonl');
  writeFileSync(j, lines.join(''));
  at(j, opts.journalAt ?? T0 + 5000);
  return j;
};
const seedScript = (name: string, runId: string, phases: string[]): void => {
  const dir = path.join(S, 'workflows', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}-${runId}.js`),
    `export const meta = { name: '${name}', phases: [${phases.map((p) => `{ title: '${p}' }`).join(', ')}] };\nexport default async () => {};\n`);
};
const seedSummary = (runId: string, body: Record<string, unknown>, mtime: number): string => {
  const dir = path.join(S, 'workflows');
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${runId}.json`);
  writeFileSync(f, JSON.stringify({ runId, taskId: 'w00000000', script: '', scriptPath: '', result: null, logs: [], summary: '', defaultModel: 'm', phases: [], workflowProgress: [], ...body }));
  at(f, mtime);
  return f;
};

const RUNNING = [
  line({ type: 'launched' }),
  line({ type: 'started', key: key(1), agentId: 'a1', label: 'build', phase: 'Build' }),
  line({ type: 'result', key: key(1), agentId: 'a1', result: { ok: true } }),
  line({ type: 'started', key: key(2), agentId: 'a2', label: 'verify-1', phase: 'Verify' }),
  line({ type: 'failed', key: key(2), agentId: 'a2' }),
  line({ type: 'started', key: key(3), agentId: 'a3', label: 'verify-2', phase: 'Verify' }),
];

describe('SessionWorkflows — what the session has, or that it could not be read', () => {
  it('no runs directory: absent (the session never ran a workflow)', async () => {
    expect(await new SessionWorkflows(localIO, S).read(LIVE, T0)).toEqual({ kind: 'absent' });
  });

  it('a runs directory that will not list: unreadable — never an empty list', async () => {
    seedRun(RUN, RUNNING);
    const io = counted(localIO, (op) => op === 'readdir');
    expect(await new SessionWorkflows(io, S).read(LIVE, T0)).toEqual({ kind: 'unreadable' });
  });

  it('a running run: counts, a failed agent, tokens, name and phases from the script, start from the first agent', async () => {
    seedRun(RUN, RUNNING, { agents: { a1: { start: T0 + 40, input: 5 }, a2: { start: T0 + 2000, input: 7 }, a3: { start: T0 + 3000, input: 11 } } });
    seedScript('example-flow', RUN, ['Build', 'Verify', 'Ship']);
    const r = await new SessionWorkflows(localIO, S).read(LIVE, T0 + 9000);
    expect(r.kind).toBe('read');
    const [w] = (r as { workflows: unknown[] }).workflows as Array<Record<string, unknown>>;
    expect(w).toMatchObject({
      id: RUN, name: 'example-flow', state: 'running', done: 1, failed: 1, total: 3,
      phase: 'Verify', phases: ['Build', 'Verify', 'Ship'], startedAt: T0 + 40, endedAt: null,
      tokens: 1005 + 1007 + 1011, tokensUnmeasured: 0,
    });
  });

  it('an agent with no usage line yet is unmeasured, not 0', async () => {
    seedRun(RUN, RUNNING, { agents: { a1: { start: T0, input: 5 }, a3: { start: T0 + 1 } } });
    const r = await new SessionWorkflows(localIO, S).read(LIVE, T0 + 9000);
    const [w] = (r as { workflows: Array<{ tokens: number | null; tokensUnmeasured: number; name: string | null }> }).workflows;
    // a2 has no transcript at all, a3 has one with no usage: both unmeasured
    expect(w!.tokens).toBe(1005);
    expect(w!.tokensUnmeasured).toBe(2);
    expect(w!.name).toBeNull(); // no script file and no summary: never invented
  });

  it('a journal that will not read: the counts are null, not zeros', async () => {
    seedRun(RUN, RUNNING);
    const io = counted(localIO, (op, p) => op === 'range' && p.endsWith('journal.jsonl'));
    const r = await new SessionWorkflows(io, S).read(LIVE, T0 + 9000);
    const [w] = (r as { workflows: Array<Record<string, unknown>> }).workflows;
    expect([w!.done, w!.failed, w!.total]).toEqual([null, null, null]);
  });
});

describe('SessionWorkflows — finished, resumed and orphaned runs', () => {
  const finished = (status: string, mtime: number): void => {
    seedRun(RUN, RUNNING, { journalAt: mtime - 20 });
    seedSummary(RUN, {
      workflowName: 'example-flow', status, startTime: T0, durationMs: mtime - T0, agentCount: 3, totalTokens: 4242,
      workflowProgress: [
        { type: 'workflow_agent', index: 0, label: 'build', phaseTitle: 'Build', agentId: 'a1', state: 'done' },
        { type: 'workflow_agent', index: 1, label: 'verify-1', phaseTitle: 'Verify', agentId: 'a2', state: 'error' },
      ],
    }, mtime);
  };

  it('finished inside 30 s: the summary\'s row; at 30 s it drops off and is never re-read', async () => {
    const end = T0 + 100_000;
    finished('completed', end);
    const io = counted(localIO);
    const wf = new SessionWorkflows(io, S);
    const r1 = await wf.read(LIVE, end + 10_000);
    expect((r1 as { workflows: unknown[] }).workflows).toMatchObject([{ state: 'completed', done: 1, failed: 1, total: 3, tokens: 4242, endedAt: end }]);
    const r2 = await wf.read(LIVE, end + 30_000);
    expect((r2 as { workflows: unknown[] }).workflows).toEqual([]);
    io.calls.length = 0;
    for (let i = 0; i < RESTAT_EVERY - 1; i++) await wf.read(LIVE, end + 40_000);
    // a dropped finished run costs the listing only, until its re-stat tick
    expect(io.calls.filter((c) => c.op !== 'readdir')).toEqual([]);
  });

  it('a run that finished long before the page opened is not read beyond two stats', async () => {
    finished('completed', T0);
    const io = counted(localIO);
    const r = await new SessionWorkflows(io, S).read(LIVE, T0 + 3_600_000);
    expect((r as { workflows: unknown[] }).workflows).toEqual([]);
    expect(io.calls.filter((c) => c.op === 'read' || c.op === 'range')).toEqual([]);
  });

  it('many quiet runs re-stat spread over RESTAT_EVERY ticks, not all on one', async () => {
    for (let f = 0; f < 30; f++) {
      const id = `wf_${f.toString(16).padStart(8, '0')}-000`;
      seedRun(id, [line({ type: 'launched' })], { journalAt: T0 - 100_000 });
      seedSummary(id, { status: 'completed' }, T0 - 90_000);
    }
    const io = counted(localIO);
    const wf = new SessionWorkflows(io, S);
    await wf.read(LIVE, T0 + 9000); // the first read decides every run
    const perTick: number[] = [];
    for (let t = 0; t < RESTAT_EVERY * 2; t++) {
      io.calls.length = 0;
      await wf.read(LIVE, T0 + 11_000 + t * 2000);
      perTick.push(io.calls.filter((c) => c.op === 'stat').length);
    }
    expect(perTick.reduce((a, b) => a + b, 0)).toBe(30 * 2 * 2); // each run twice, two stats each
    expect(Math.max(...perTick)).toBeLessThanOrEqual(2 * Math.ceil(30 / RESTAT_EVERY));
  });

  it('failed and killed keep their own word', async () => {
    finished('failed', T0 + 1000);
    const r = await new SessionWorkflows(localIO, S).read(LIVE, T0 + 2000);
    expect((r as { workflows: Array<{ state: string }> }).workflows[0]!.state).toBe('failed');
  });

  it('a killed summary whose journal grew after it is a resume in place: running, clocked from the resume', async () => {
    const summaryAt = T0 + 10_000;
    seedSummary(RUN, { workflowName: 'example-flow', status: 'killed', startTime: T0, durationMs: 10_000, agentCount: 3 }, summaryAt);
    seedRun(RUN, [...RUNNING, line({ type: 'started', key: key(4), agentId: 'a4', label: 'verify-3', phase: 'Verify' })], {
      agents: { a1: { start: T0 + 40 }, a2: { start: T0 + 100 }, a3: { start: T0 + 200 }, a4: { start: summaryAt + 10_000 } },
      journalAt: summaryAt + 10_000,
    });
    const r = await new SessionWorkflows(localIO, S).read(LIVE, summaryAt + 20_000);
    expect((r as { workflows: unknown[] }).workflows).toMatchObject([{ state: 'running', name: 'example-flow', total: 4, startedAt: summaryAt + 10_000 }]);
  });

  it('no summary and every write before this process started: an orphan, not shown', async () => {
    seedRun(RUN, RUNNING, { journalAt: T0 - 120_000 });
    const r = await new SessionWorkflows(localIO, S).read(LIVE, T0);
    expect((r as { workflows: unknown[] }).workflows).toEqual([]);
  });

  it('the session process gone: nothing is running', async () => {
    seedRun(RUN, RUNNING);
    const r = await new SessionWorkflows(localIO, S).read({ kind: 'gone' }, T0 + 9000);
    expect((r as { workflows: unknown[] }).workflows).toEqual([]);
  });

  it('the process unmeasured this pass: the rows already shown stand', async () => {
    seedRun(RUN, RUNNING);
    const wf = new SessionWorkflows(localIO, S);
    const first = await wf.read(LIVE, T0 + 9000);
    const held = await wf.read({ kind: 'unmeasured' }, T0 + 11_000);
    expect(held).toEqual(first);
    // and one never decided is not shown as running on an unmeasured process
    seedRun(RUN_B, RUNNING);
    const fresh = await new SessionWorkflows(localIO, S).read({ kind: 'unmeasured' }, T0 + 9000);
    expect((fresh as { workflows: unknown[] }).workflows).toEqual([]);
  });

  it('two runs: only the session dir it was given is read (a swap-carried copy elsewhere is not)', async () => {
    seedRun(RUN, RUNNING);
    const other = path.join(home, '.claude-b', 'projects', '-work-project-a', 'session-uuid-a', 'subagents', 'workflows', RUN_B);
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(other, 'journal.jsonl'), RUNNING.join(''));
    const io = counted(localIO);
    const r = await new SessionWorkflows(io, S).read(LIVE, T0 + 9000);
    expect((r as { workflows: Array<{ id: string }> }).workflows.map((w) => w.id)).toEqual([RUN]);
    expect(io.calls.every((c) => c.path.startsWith(S))).toBe(true);
  });
});

describe('SessionWorkflows — bounded reads', () => {
  it('a 2.7 MB journal is read in at most JOURNAL_CHUNKS_PER_TICK capped chunks, then only what is appended', async () => {
    const big = 'x'.repeat(200_000);
    const lines: string[] = [];
    for (let i = 0; i < 14; i++) {
      lines.push(line({ type: 'started', key: key(i), agentId: `a${i}`, label: `agent-${i}` }));
      lines.push(line({ type: 'result', key: key(i), agentId: `a${i}`, result: big }));
    }
    const j = seedRun(RUN, lines);
    const io = counted(localIO);
    const wf = new SessionWorkflows(io, S);
    const r = await wf.read(LIVE, T0 + 9000);
    expect((r as { workflows: Array<{ done: number; total: number }> }).workflows[0]).toMatchObject({ done: 14, total: 14 });
    const chunks = io.calls.filter((c) => c.op === 'range' && c.path === j);
    expect(chunks.length).toBeLessThanOrEqual(JOURNAL_CHUNKS_PER_TICK);
    expect(chunks.every((c) => c.max === READ_FROM_MAX_BYTES)).toBe(true);
    // the next tick: one appended line, read from where the last read ended
    appendFileSync(j, line({ type: 'started', key: key(99), agentId: 'a99', label: 'late' }));
    at(j, T0 + 10_000);
    io.calls.length = 0;
    const r2 = await wf.read(LIVE, T0 + 11_000);
    expect((r2 as { workflows: Array<{ total: number }> }).workflows[0]!.total).toBe(15);
    const next = io.calls.filter((c) => c.op === 'range' && c.path === j);
    expect(next).toHaveLength(1);
    expect(next[0]!.offset).toBe(lines.join('').length);
  });

  it('an agent transcript is read as one TAIL_BYTES tail, and not again while its size stands', async () => {
    seedRun(RUN, [line({ type: 'started', key: key(1), agentId: 'a1', label: 'only' })], { agents: { a1: { start: T0 } } });
    const tr = path.join(S, 'subagents', 'workflows', RUN, 'agent-a1.jsonl');
    writeFileSync(tr, `${line({ type: 'user', message: { content: 'y'.repeat(1_000_000) } })}${usageLine('a1', 3)}`);
    const io = counted(localIO);
    const wf = new SessionWorkflows(io, S);
    const r = await wf.read(LIVE, T0 + 9000);
    expect((r as { workflows: Array<{ tokens: number }> }).workflows[0]!.tokens).toBe(1003);
    const tails = io.calls.filter((c) => c.op === 'range' && c.path === tr);
    expect(tails).toHaveLength(1);
    expect(tails[0]!.max).toBe(TAIL_BYTES);
    io.calls.length = 0;
    await wf.read(LIVE, T0 + 11_000);
    expect(io.calls.filter((c) => c.op === 'range' && c.path === tr)).toEqual([]);
  });

  it('agent reads per tick stop at AGENT_READS_PER_TICK, and the rest are said unmeasured', async () => {
    const lines: string[] = [];
    const agents: Record<string, { start: number; input: number }> = {};
    for (let i = 0; i < 60; i++) {
      lines.push(line({ type: 'started', key: key(i), agentId: `a${i}`, label: `agent-${i}` }));
      agents[`a${i}`] = { start: T0 + i, input: 1 };
    }
    seedRun(RUN, lines, { agents });
    const io = counted(localIO);
    const r = await new SessionWorkflows(io, S).read(LIVE, T0 + 9000);
    const agentOps = io.calls.filter((c) => /agent-a\d+\./.test(c.path));
    expect(agentOps.length).toBeLessThanOrEqual(AGENT_READS_PER_TICK + 1);
    expect((r as { workflows: Array<{ tokensUnmeasured: number }> }).workflows[0]!.tokensUnmeasured).toBeGreaterThan(0);
  });

  it('the budget holds on a later tick too, when every agent read so far is unchanged', async () => {
    const lines: string[] = [];
    const agents: Record<string, { start: number; input: number }> = {};
    for (let i = 0; i < 60; i++) {
      lines.push(line({ type: 'started', key: key(i), agentId: `a${i}`, label: `agent-${i}` }));
      agents[`a${i}`] = { start: T0 + i, input: 1 };
    }
    seedRun(RUN, lines, { agents });
    const io = counted(localIO);
    const wf = new SessionWorkflows(io, S);
    // past the ticks it takes to read every agent once, into the steady state
    // where every agent is held and unchanged
    for (let t = 0; t < 10; t++) {
      io.calls.length = 0;
      await wf.read(LIVE, T0 + 9000 + t * 2000);
      expect(io.calls.filter((c) => /agent-a\d+\./.test(c.path)).length).toBeLessThanOrEqual(AGENT_READS_PER_TICK + 1);
    }
  });

  it('more running agents than one tick\'s budget: every one is measured within a few ticks, none starved', async () => {
    const lines: string[] = [];
    const agents: Record<string, { start: number; input: number }> = {};
    for (let i = 0; i < 40; i++) {
      lines.push(line({ type: 'started', key: key(i), agentId: `a${i}`, label: `agent-${i}` }));
      agents[`a${i}`] = { start: T0 + i, input: 1 };
    }
    seedRun(RUN, lines, { agents });
    const wf = new SessionWorkflows(localIO, S);
    let last: { tokensUnmeasured: number } | undefined;
    for (let t = 0; t < 8; t++) {
      const r = await wf.read(LIVE, T0 + 9000 + t * 2000);
      last = (r as { workflows: Array<{ tokensUnmeasured: number }> }).workflows[0];
    }
    expect(last!.tokensUnmeasured).toBe(0);
  });

  it('a finished agent, once read after it finished, is never stat\'ed again', async () => {
    seedRun(RUN, [
      line({ type: 'started', key: key(1), agentId: 'a1', label: 'done-one' }),
      line({ type: 'result', key: key(1), agentId: 'a1', result: 'r' }),
      line({ type: 'started', key: key(2), agentId: 'a2', label: 'still-going' }),
    ], { agents: { a1: { start: T0, input: 4 }, a2: { start: T0 + 1, input: 5 } } });
    const io = counted(localIO);
    const wf = new SessionWorkflows(io, S);
    await wf.read(LIVE, T0 + 9000);
    io.calls.length = 0;
    await wf.read(LIVE, T0 + 11_000);
    expect(io.calls.filter((c) => c.path.includes('agent-a1.jsonl'))).toEqual([]);
    expect(io.calls.filter((c) => c.path.includes('agent-a2.jsonl')).length).toBeGreaterThan(0); // the running one is
  });

  it('one run with 12 agents writing every tick still gets its start and its done agents measured', async () => {
    const lines = [line({ type: 'launched' })];
    const agents: Record<string, { start: number; input?: number }> = {};
    for (let i = 0; i < 5; i++) {
      lines.push(line({ type: 'started', key: key(100 + i), agentId: `d${i}`, label: `d${i}` }), line({ type: 'result', key: key(100 + i), agentId: `d${i}`, result: 1 }));
      agents[`d${i}`] = { start: T0 + 10 + i, input: 10 };
    }
    for (let i = 0; i < 12; i++) {
      lines.push(line({ type: 'started', key: key(i), agentId: `r${i}`, label: `r${i}` }));
      agents[`r${i}`] = { start: T0 + 100 + i, input: 1 };
    }
    seedRun(RUN, lines, { agents });
    const wf = new SessionWorkflows(localIO, S);
    let w: { startedAt: number | null; tokensUnmeasured: number } | undefined;
    for (let t = 0; t < 4; t++) {
      for (let i = 0; i < 12; i++) appendFileSync(path.join(S, 'subagents', 'workflows', RUN, `agent-r${i}.jsonl`), usageLine(`r${i}`, t + 2));
      const r = await wf.read(LIVE, T0 + 9000 + t * 2000);
      w = (r as { workflows: Array<{ startedAt: number | null; tokensUnmeasured: number }> }).workflows[0];
      expect(w!.startedAt).toBe(T0 + 10); // from the first tick on
    }
    expect(w!.tokensUnmeasured).toBe(0);
  });

  it('a run in a later batch, behind a run with 12 writing agents, is not starved', async () => {
    const A = 'wf_00000000-001', B = 'wf_ffffffff-fff';
    const la = [line({ type: 'launched' })];
    const aa: Record<string, { start: number; input?: number }> = {};
    for (let i = 0; i < 12; i++) {
      la.push(line({ type: 'started', key: key(i), agentId: `r${i}`, label: `r${i}` }));
      aa[`r${i}`] = { start: T0 + 100 + i, input: 1 };
    }
    seedRun(A, la, { agents: aa });
    for (let f = 0; f < 8; f++) {
      const id = `wf_8000000${f}-000`;
      seedRun(id, [line({ type: 'launched' })], { journalAt: T0 - 100_000 });
      seedSummary(id, { status: 'completed' }, T0 - 90_000);
    }
    seedRun(B, [line({ type: 'launched' }), line({ type: 'started', key: key(500), agentId: 'b1', label: 'b1' })], { agents: { b1: { start: T0 + 50, input: 777 } } });
    const wf = new SessionWorkflows(localIO, S);
    let b: { startedAt: number | null; tokens: number | null } | undefined;
    for (let t = 0; t < 3; t++) {
      for (let i = 0; i < 12; i++) appendFileSync(path.join(S, 'subagents', 'workflows', A, `agent-r${i}.jsonl`), usageLine(`r${i}`, t + 2));
      appendFileSync(path.join(S, 'subagents', 'workflows', B, 'agent-b1.jsonl'), usageLine('b1', 777 + t));
      const r = await wf.read(LIVE, T0 + 9000 + t * 2000);
      b = (r as { workflows: Array<{ id: string; startedAt: number | null; tokens: number | null }> }).workflows.find((w) => w.id === B);
      expect(b!.startedAt).toBe(T0 + 50);
      expect(b!.tokens).not.toBeNull();
    }
  });

  it('a journal that shrinks (rewritten) is folded again from byte 0', async () => {
    const j = seedRun(RUN, RUNNING, { agents: { a1: { start: T0, input: 1 }, a2: { start: T0 + 1, input: 1 }, a3: { start: T0 + 2, input: 1 } } });
    const wf = new SessionWorkflows(localIO, S);
    const r1 = await wf.read(LIVE, T0 + 9000);
    expect((r1 as { workflows: Array<{ total: number }> }).workflows[0]!.total).toBe(3);
    writeFileSync(j, [line({ type: 'launched' }), line({ type: 'started', key: key(9), agentId: 'a9', label: 'only' })].join(''));
    at(j, T0 + 10_000);
    const r2 = await wf.read(LIVE, T0 + 11_000);
    const w = (r2 as { workflows: Array<{ total: number; done: number }> }).workflows[0]!;
    expect(w.total).toBe(1);
    expect(w.done).toBe(0);
  });

  it('a summary stat that does not answer holds the row shown — not a false running row', async () => {
    seedRun(RUN, RUNNING, { agents: { a1: { start: T0, input: 1 }, a2: { start: T0 + 1, input: 1 }, a3: { start: T0 + 2, input: 1 } } });
    seedSummary(RUN, { status: 'completed', workflowName: 'neutral-run', agentCount: 3 }, T0 + 6000);
    let failSummary = false;
    const io = counted(localIO, (op, p) => failSummary && op === 'stat' && p.endsWith(`${RUN}.json`));
    const wf = new SessionWorkflows(io, S);
    const r1 = await wf.read(LIVE, T0 + 9000);
    const shown = (r1 as { workflows: Array<{ state: string }> }).workflows[0]!;
    expect(shown.state).toBe('completed');
    failSummary = true;
    const r2 = await wf.read(LIVE, T0 + 11_000);
    expect((r2 as { workflows: Array<{ state: string }> }).workflows[0]).toEqual(shown);
  });

  it('a done agent whose last usage line is further back than the tail is found by walking back', async () => {
    seedRun(RUN, [
      line({ type: 'started', key: key(1), agentId: 'a1', label: 'done-one' }),
      line({ type: 'result', key: key(1), agentId: 'a1', result: 'r' }),
      line({ type: 'started', key: key(2), agentId: 'a2', label: 'still-going' }),
    ], { agents: { a1: { start: T0 }, a2: { start: T0 + 1, input: 5 } } });
    const tr = path.join(S, 'subagents', 'workflows', RUN, 'agent-a1.jsonl');
    writeFileSync(tr, `${usageLine('a1', 41)}${line({ type: 'user', message: { content: 'z'.repeat(TAIL_BYTES + 300_000) } })}`);
    const r = await new SessionWorkflows(localIO, S).read(LIVE, T0 + 9000);
    const w = (r as { workflows: Array<{ tokens: number; tokensUnmeasured: number }> }).workflows[0]!;
    expect(w.tokensUnmeasured).toBe(0);
    expect(w.tokens).toBe(1041 + 1005);
  });

  it('sessionDirOf is the transcript path minus .jsonl', () => {
    expect(sessionDirOf('/x/projects/-p/uuid.jsonl')).toBe('/x/projects/-p/uuid');
  });
});
