// Session helpers H2 (D-8872; spec 2026-11-19-session-helpers-design §4.1 Table 4, §4.3, §4.4): the Helpers section's
// head and its two lists, decided once in `pwa/src/session/helpersWords.ts` (L1) from the frame the store holds. The head
// says each count once and carries every "not known" sentence, once, and only while a helper it concerns is drawn; rows
// never repeat it. Running rows come first; a final helper or workflow goes into the finished fold; `no longer listed` and
// `session ended` claim no end and stay in the main list. An absent `agents` member reads the same from an older server
// and from one with no helpers (review 3014 F13): with nothing to draw, the view is null, never a "none".
//
// RED FIRST: committed before the code, against origin/main, where the module does not exist.
import { describe, expect, it } from 'vitest';
import * as words from '../src/session/helpersWords';
import type { AgentHelperView, HelpersUnmeasured, WorkflowView } from '../../shared/workflows';

interface Item { kind: 'agent' | 'workflow'; id: string }
interface View { count: string | null; notes: string[]; main: Item[]; finished: Item[] }
interface Input {
  workflows: WorkflowView[]; workflowsUnreadable: boolean; agents: AgentHelperView[];
  agentsUnmeasured: HelpersUnmeasured | null; readEvery: { refreshed: number; of: number } | null;
}
const helpersView = (i: Partial<Input>): View | null => (words as unknown as { helpersView(i: Input): View | null }).helpersView({
  workflows: [], workflowsUnreadable: false, agents: [], agentsUnmeasured: null, readEvery: null, ...i,
});
const ids = (xs: Item[]): string[] => xs.map((x) => `${x.kind}:${x.id}`);

const T0 = 1_795_200_000_000;
const agent = (id: string, o: Partial<AgentHelperView> = {}): AgentHelperView => ({
  id, description: `do ${id}`, agentType: 'Explore', model: 'Sonnet', effort: 'high', state: 'running',
  startedAt: T0, endedAt: null, lastActivityAt: T0 + 1_000, tokens: 41_000, summary: null, hasReport: false, ...o,
});
const wf = (id: string, o: Partial<WorkflowView> = {}): WorkflowView => ({
  id, name: `flow-${id}`, state: 'running', done: 7, failed: 0, total: 12, phase: 'Verify', phases: ['Build', 'Verify'],
  startedAt: T0, endedAt: null, tokens: 2_500_000, tokensUnmeasured: 0, agents: [], agentsOmitted: 0, lastActivityAt: T0 + 4_000, ...o,
});

describe('Table 4: the head\'s counts', () => {
  it('helpers running: "N running", plus "M finished" when the fold is not empty', () => {
    const v = helpersView({
      agents: [agent('a1'), agent('a2'), agent('a3', { state: 'done', endedAt: T0 + 5_000 }), agent('a4', { state: 'failed', endedAt: T0 + 6_000 })],
      workflows: [wf('w1')],
    })!;
    expect(v.count).toBe('3 running · 2 finished');
  });

  it('running only: no finished clause', () => {
    expect(helpersView({ agents: [agent('a1')] })!.count).toBe('1 running');
  });

  it('only finished helpers in the last ten minutes: "N finished"', () => {
    expect(helpersView({ agents: [agent('a1', { state: 'done', endedAt: T0 })], workflows: [wf('w1', { state: 'completed', endedAt: T0 })] })!.count)
      .toBe('2 finished');
  });

  it('a roster that cannot be used: the main rows are counted as helpers, not as running', () => {
    const v = helpersView({
      agents: [agent('a1', { state: 'unmeasured' }), agent('a2', { state: 'unmeasured' })],
      agentsUnmeasured: { why: 'stale', hookAgeMs: 41 * 60_000 },
    })!;
    expect(v.count).toBe('2 helpers');
    expect(v.notes).toEqual(['live state not known: no news from the session for 41m']);
  });

  it('one helper not running and nothing running: "1 helper", singular', () => {
    expect(helpersView({ agents: [agent('a1', { state: 'launched' })] })!.count).toBe('1 helper');
  });

  it('a no-longer-listed row beside a running one is not counted as running (the row says its own state)', () => {
    const v = helpersView({ agents: [agent('a1'), agent('a2', { state: 'unlisted' })] })!;
    expect(v.count).toBe('1 running');
  });
});

describe('Table 4: every "not known" line, said once', () => {
  const left = [agent('a1', { state: 'unmeasured' })];
  const cases: Array<[HelpersUnmeasured, string]> = [
    [{ why: 'stale', hookAgeMs: 41 * 60_000 }, 'live state not known: no news from the session for 41m'],
    [{ why: 'absent' }, 'live state not known: this session reports nothing yet'],
    [{ why: 'unreadable' }, 'live state not known: the session\'s report could not be read'],
    [{ why: 'foreign' }, 'live state not known: the session\'s report is from an earlier run'],
    [{ why: 'unregistered' }, 'live state not known: the session\'s report is from an earlier run'],
    [{ why: 'unseen', helpers: 1 }, 'live state not known for 1 helper'],
    [{ why: 'unseen', helpers: 3 }, 'live state not known for 3 helpers'],
  ];
  for (const [why, line] of cases) {
    it(`${why.why}: "${line}"`, () => { expect(helpersView({ agents: left, agentsUnmeasured: why })!.notes).toEqual([line]); });
  }

  it('said only when a helper it concerns is drawn: every helper final, no live-state line', () => {
    const v = helpersView({ agents: [agent('a1', { state: 'done', endedAt: T0 })], agentsUnmeasured: { why: 'stale', hookAgeMs: 41 * 60_000 } })!;
    expect(v.notes).toEqual([]);
  });

  it('a workflow\'s tokens not measured: "tokens not known for 1 workflow"; two: plural', () => {
    expect(helpersView({ workflows: [wf('w1', { tokens: null })] })!.notes).toEqual(['tokens not known for 1 workflow']);
    expect(helpersView({ workflows: [wf('w1', { tokens: null }), wf('w2', { tokens: null })] })!.notes).toEqual(['tokens not known for 2 workflows']);
  });

  it('a workflow\'s progress unreadable: "progress not known for 1 workflow"', () => {
    expect(helpersView({ workflows: [wf('w1', { done: null, failed: null, total: null })] })!.notes).toEqual(['progress not known for 1 workflow']);
  });

  it('the read budget leaves helpers unread: "9 helpers: the busiest 6 refresh every few seconds, the rest more slowly"', () => {
    expect(helpersView({ agents: [agent('a1')], readEvery: { refreshed: 6, of: 9 } })!.notes)
      .toEqual(['9 helpers: the busiest 6 refresh every few seconds, the rest more slowly']);
  });

  it('the workflow state could not be re-read: said in the head, with the last rows standing', () => {
    expect(helpersView({ workflows: [wf('w1')], workflowsUnreadable: true })!.notes).toEqual(['workflow state not re-read: showing the last read']);
  });

  it('the workflow state could not be read at all, and no row: the section still says so (a measured fact, not absence)', () => {
    const v = helpersView({ workflowsUnreadable: true })!;
    expect(v.count).toBeNull();
    expect(v.notes).toEqual(['workflow state could not be read']);
  });

  it('several lines: each once, in Table 4\'s order', () => {
    const v = helpersView({
      agents: [agent('a1', { state: 'unmeasured' })], agentsUnmeasured: { why: 'unseen', helpers: 1 },
      workflows: [wf('w1', { tokens: null, done: null, failed: null, total: null })], readEvery: { refreshed: 6, of: 9 },
    })!;
    expect(v.notes).toEqual([
      'live state not known for 1 helper', 'tokens not known for 1 workflow', 'progress not known for 1 workflow',
      '9 helpers: the busiest 6 refresh every few seconds, the rest more slowly',
    ]);
  });
});

describe('the two lists: running first, the finished fold apart', () => {
  it('running rows first (by start), then the main list\'s other rows; the final ones in the fold, newest end first', () => {
    const v = helpersView({
      agents: [
        agent('a1', { startedAt: T0 + 30 }), agent('a2', { state: 'unlisted', startedAt: T0 }), agent('a3', { state: 'gone', startedAt: T0 + 1 }),
        agent('a4', { state: 'done', endedAt: T0 + 100 }), agent('a5', { state: 'finished', endedAt: T0 + 300 }),
      ],
      workflows: [wf('w1', { startedAt: T0 + 10 }), wf('w2', { state: 'killed', endedAt: T0 + 200 })],
    })!;
    expect(ids(v.main)).toEqual(['workflow:w1', 'agent:a1', 'agent:a2', 'agent:a3']);
    expect(ids(v.finished)).toEqual(['agent:a5', 'workflow:w2', 'agent:a4']);
  });

  it('no longer listed and session ended never enter the fold', () => {
    const v = helpersView({ agents: [agent('a1', { state: 'unlisted' }), agent('a2', { state: 'gone' })] })!;
    expect(ids(v.finished)).toEqual([]);
    expect(ids(v.main)).toEqual(['agent:a1', 'agent:a2']);
  });

  it('every final state is in the fold: done, failed, stopped, finished, and a workflow\'s completed, failed and killed', () => {
    const v = helpersView({
      agents: (['done', 'failed', 'stopped', 'finished'] as const).map((state, i) => agent(`a${i}`, { state, endedAt: T0 + i })),
      workflows: (['completed', 'failed', 'killed'] as const).map((state, i) => wf(`w${i}`, { state, endedAt: T0 + 10 + i })),
    })!;
    expect(v.main).toEqual([]);
    expect(v.finished).toHaveLength(7);
  });
});

describe('review 3014 F13: absence draws nothing, never a "none"', () => {
  it('a frame with no rows and nothing unreadable (an older server, or no helpers: the two read the same) is null', () => {
    expect(helpersView({})).toBeNull();
  });
  it('an agentsUnmeasured with no row it concerns draws nothing either', () => {
    expect(helpersView({ agentsUnmeasured: { why: 'absent' } })).toBeNull();
  });
  it('no head word anywhere says none, no helpers or 0', () => {
    const all = [
      helpersView({ agents: [agent('a1')] }), helpersView({ workflows: [wf('w1', { state: 'completed', endedAt: T0 })] }),
      helpersView({ workflowsUnreadable: true }),
    ];
    for (const v of all) {
      const text = [v!.count ?? '', ...v!.notes].join(' ');
      expect(text).not.toMatch(/\bnone\b|no helpers|\b0 /);
    }
  });
});
