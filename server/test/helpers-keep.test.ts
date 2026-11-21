// Session helpers H2 (D-8872; spec 2026-11-19-session-helpers-design §4.3, Table 6 and Table 13's H2 row): the workflow
// keep moves from Claude Code's 30 s to the helpers' ten minutes, by ONE owner. `model.ts#keepWorkflows` decides which
// workflow rows a reading sends, and asks `isFinishedKept` (the keep's one clock, review 2900 F5); `read.ts`'s
// `finishedView` asks the same function before it reads a summary. A finished workflow with no readable end time is drawn
// once and leaves with the next reading (§4.3, H1a's ruling on review 2961 F8). At most `HELPER_KEPT_MAX` finished
// workflows are kept, the newest, each carrying at most `WORKFLOW_KEPT_AGENTS_MAX` agents. A kept finished run is read
// once, then left quiet: no stat per reading (review 2900 F5).
//
// RED FIRST: committed before the code, against origin/main, where `keepWorkflows` does not exist, a finished workflow
// leaves at 30 s, and a kept finished run is re-stat'ed on every reading.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { RESTAT_EVERY, SessionWorkflows } from '../src/workflows/read.js';
import * as model from '../src/workflows/model.js';
import { foldJournal, emptyFold, parseSummary, runningView, summaryView, type Proc } from '../src/workflows/model.js';
import * as shared from '../../shared/workflows.js';
import { HELPER_FINISHED_KEEP_MS, HELPER_KEPT_MAX, WORKFLOW_KEPT_AGENTS_MAX, type WorkflowView } from '../../shared/workflows.js';
import { mkTmp } from './tmpHelpers.js';

type Keep = (views: readonly WorkflowView[], now: number, noEndShown: ReadonlySet<string>) =>
  { rows: WorkflowView[]; noEndShown: ReadonlySet<string> };
const keepWorkflows = (...a: Parameters<Keep>): ReturnType<Keep> => (model as unknown as { keepWorkflows: Keep }).keepWorkflows(...a);

const T0 = Date.parse('2026-01-01T00:00:00Z');
const line = (o: unknown): string => `${JSON.stringify(o)}\n`;
const key = (i: number): string => `v2:${i.toString(16).padStart(64, '0')}`;

const finishedView = (id: string, end: number | null, o: Partial<WorkflowView> = {}): WorkflowView => ({
  id, name: id, state: 'completed', done: 2, failed: 0, total: 2, phase: null, phases: null, startedAt: end === null ? null : end - 5_000,
  endedAt: end, tokens: 10, tokensUnmeasured: 0, agents: [], agentsOmitted: 0, ...o,
});
const running = (id: string, startedAt: number | null): WorkflowView =>
  runningView({ id, name: id, fold: foldJournal(emptyFold(), [line({ type: 'started', key: key(1), agentId: 'a1' })]), tokens: new Map(), phases: null, startedAt });

describe('keepWorkflows: the workflow keep is the helpers\' ten minutes, by its end time', () => {
  it('a finished workflow is kept until ten minutes after its end, and gone at ten minutes', () => {
    const end = T0;
    const v = finishedView('wf_00000000-aaa', end);
    expect(keepWorkflows([v], end + 31_000, new Set()).rows, 'past the old 30 s: still kept').toHaveLength(1);
    expect(keepWorkflows([v], end + HELPER_FINISHED_KEEP_MS - 1, new Set()).rows).toHaveLength(1);
    expect(keepWorkflows([v], end + HELPER_FINISHED_KEEP_MS, new Set()).rows).toHaveLength(0);
  });

  it('the keep has one clock: it agrees with isFinishedKept on every end and now', () => {
    for (const age of [0, 1, 30_000, HELPER_FINISHED_KEEP_MS - 1, HELPER_FINISHED_KEEP_MS, HELPER_FINISHED_KEEP_MS + 1]) {
      const v = finishedView('wf_00000000-aaa', T0);
      expect(keepWorkflows([v], T0 + age, new Set()).rows.length === 1, `age ${age}`).toBe(model.isFinishedKept(T0, T0 + age));
    }
  });

  it('a running workflow is always kept, whatever its age, oldest start first and an unknown start last', () => {
    const rows = keepWorkflows([running('c', null), running('b', 20), running('a', 10)], T0 + 1e9, new Set()).rows;
    expect(rows.map((v) => v.id)).toEqual(['a', 'b', 'c']);
  });

  it('a finished workflow with no readable end time is drawn once, then leaves with the next reading (review 2961 F8)', () => {
    const v = finishedView('wf_00000000-aaa', null);
    const first = keepWorkflows([v], T0, new Set());
    expect(first.rows.map((r) => r.id)).toEqual(['wf_00000000-aaa']);
    expect([...first.noEndShown]).toEqual(['wf_00000000-aaa']);
    const second = keepWorkflows([v], T0 + 2_000, first.noEndShown);
    expect(second.rows).toEqual([]);
  });

  it('the draw-once memory forgets a run that is no longer among the views', () => {
    const first = keepWorkflows([finishedView('wf_00000000-aaa', null)], T0, new Set());
    const later = keepWorkflows([], T0 + 2_000, first.noEndShown);
    expect([...later.noEndShown]).toEqual([]);
  });

  it(`at most HELPER_KEPT_MAX (${HELPER_KEPT_MAX}) finished workflows are kept, the newest by end time`, () => {
    const views = Array.from({ length: HELPER_KEPT_MAX + 3 }, (_, i) => finishedView(`wf_${i.toString(16).padStart(8, '0')}-aaa`, T0 + i * 1_000));
    const rows = keepWorkflows(views, T0 + 60_000, new Set()).rows;
    expect(rows).toHaveLength(HELPER_KEPT_MAX);
    expect(rows.map((r) => r.endedAt).sort((a, b) => a! - b!)[0]).toBe(T0 + 3_000);
  });

  it('the cap is on finished rows only: running rows are never evicted by it', () => {
    const views = [
      ...Array.from({ length: HELPER_KEPT_MAX + 2 }, (_, i) => finishedView(`wf_${i.toString(16).padStart(8, '0')}-aaa`, T0 + i)),
      running('wf_ffffffff-fff', T0),
    ];
    const rows = keepWorkflows(views, T0 + 60_000, new Set()).rows;
    expect(rows.filter((r) => r.state === 'running')).toHaveLength(1);
    expect(rows.filter((r) => r.state !== 'running')).toHaveLength(HELPER_KEPT_MAX);
  });

  it(`a kept finished workflow carries at most WORKFLOW_KEPT_AGENTS_MAX (${WORKFLOW_KEPT_AGENTS_MAX}) agents, and says how many it left out`, () => {
    const agents = Array.from({ length: WORKFLOW_KEPT_AGENTS_MAX + 5 }, (_, i) => ({ label: `a${i}`, phase: null, state: 'done' as const }));
    const [row] = keepWorkflows([finishedView('wf_00000000-aaa', T0, { agents })], T0 + 1_000, new Set()).rows;
    expect(row!.agents).toHaveLength(WORKFLOW_KEPT_AGENTS_MAX);
    expect(row!.agentsOmitted).toBe(5);
  });

  it('the old 30 s constant retires with its pins (spec §4.3): shared/workflows.ts no longer exports it', () => {
    expect('WORKFLOW_EVICT_MS' in shared).toBe(false);
    expect('selectRows' in model, 'selectRows is replaced by keepWorkflows').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The reader: finishedView asks the same keep, and a kept finished run is read once, then left quiet.

interface Counted extends FleetIO { calls: Array<{ op: string; path: string }> }
const counted = (inner: FleetIO): Counted => {
  const calls: Counted['calls'] = [];
  return {
    ...inner,
    calls,
    readdirMeasured: async (p, ...rest) => { calls.push({ op: 'readdir', path: p }); return inner.readdirMeasured(p, ...rest); },
    statMeasured: async (p) => { calls.push({ op: 'stat', path: p }); return inner.statMeasured(p); },
    readFileMeasured: async (p, ...rest) => { calls.push({ op: 'read', path: p }); return inner.readFileMeasured(p, ...rest); },
    readFileFromBytesMeasured: async (p, o, m, ...rest) => { calls.push({ op: 'range', path: p }); return inner.readFileFromBytesMeasured(p, o, m, ...rest); },
  };
};

const RUN = 'wf_00000000-aaa';
const LIVE: Proc = { kind: 'live', startedAt: T0 - 60_000 };
const at = (f: string, ms: number): void => utimesSync(f, new Date(ms), new Date(ms));
let home: string;
let S: string;
beforeEach(() => {
  home = mkTmp('ccrc-h2-keep-');
  S = path.join(home, '.claude-a', 'projects', '-work-project-a', 'session-uuid-a');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const seedFinished = (end: number): void => {
  const dir = path.join(S, 'subagents', 'workflows', RUN);
  mkdirSync(dir, { recursive: true });
  const j = path.join(dir, 'journal.jsonl');
  writeFileSync(j, [line({ type: 'started', key: key(1), agentId: 'a1', label: 'build' }), line({ type: 'result', key: key(1), agentId: 'a1' })].join(''));
  at(j, end - 20);
  const sdir = path.join(S, 'workflows');
  mkdirSync(sdir, { recursive: true });
  const s = path.join(sdir, `${RUN}.json`);
  writeFileSync(s, JSON.stringify({ workflowName: 'example-flow', status: 'completed', startTime: T0, durationMs: end - T0, agentCount: 1, totalTokens: 7 }));
  at(s, end);
};
const rows = (r: unknown): WorkflowView[] => (r as { workflows: WorkflowView[] }).workflows;

describe('SessionWorkflows: a finished run is kept ten minutes, read once, then left quiet', () => {
  it('a run that finished a minute ago is drawn (past the old 30 s), and leaves at ten minutes', async () => {
    const end = T0 + 100_000;
    seedFinished(end);
    const wf = new SessionWorkflows(localIO, S);
    expect(rows(await wf.read(LIVE, end + 60_000))).toMatchObject([{ id: RUN, state: 'completed', endedAt: end }]);
    expect(rows(await wf.read(LIVE, end + HELPER_FINISHED_KEEP_MS - 1))).toHaveLength(1);
    expect(rows(await wf.read(LIVE, end + HELPER_FINISHED_KEEP_MS))).toEqual([]);
  });

  it('a kept finished run costs no stat per reading: after its first read, only the listing until its re-stat tick (review 2900 F5)', async () => {
    const end = T0 + 100_000;
    seedFinished(end);
    const io = counted(localIO);
    const wf = new SessionWorkflows(io, S);
    expect(rows(await wf.read(LIVE, end + 1_000))).toHaveLength(1);
    io.calls.length = 0;
    for (let i = 1; i < RESTAT_EVERY; i++) {
      expect(rows(await wf.read(LIVE, end + 1_000 + i * 2_000)), `reading ${i}: still drawn`).toHaveLength(1);
    }
    expect(io.calls.filter((c) => c.op !== 'readdir'), 'no stat or read of the kept run').toEqual([]);
  });

  it('a run that finished more than ten minutes before the page opened is never read: two stats only (a characterization pin: main does this at 30 s)', async () => {
    seedFinished(T0);
    const io = counted(localIO);
    expect(rows(await new SessionWorkflows(io, S).read(LIVE, T0 + HELPER_FINISHED_KEEP_MS + 1))).toEqual([]);
    expect(io.calls.filter((c) => c.op === 'read' || c.op === 'range')).toEqual([]);
  });
});

describe('summaryView keeps its end: every finished row the reader builds has a readable end time (the draw-once rule is for the type\'s null)', () => {
  it('a summary with no start or duration ends at its file time (a characterization pin)', () => {
    const v = summaryView(RUN, parseSummary(JSON.stringify({ status: 'completed' }))!, 4242);
    expect(v.endedAt).toBe(4242);
  });
});
