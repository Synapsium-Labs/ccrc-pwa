// The session page's workflow rows (D-5560), drawn since H2 (D-8872) by the Helpers section that replaced the workflow strip
// in place (`ui/src/components/workflow-strip.tsx`): Claude Code's own facts — name, bar, `7/12 agents`, `↓ 2.5m tokens`
// — and, opened, the phases and each agent's label and state. The head's words and the 30 s keep moved: the head is
// `helpersWords.ts`'s (helpers-words.test.ts), the keep the server's ten minutes (helpers-keep.test.ts), and a row says
// no unmeasured fact (helpers-section.test.tsx's census). Neutral fixtures.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HelpersStrip, finishedFacts, formatElapsed, formatTokens, mainFacts, type HelperItem } from '@ccrc/ui';
import { SessionScreen } from '../src/screens/SessionScreen';
import { helpersView } from '../src/session/helpersWords';
import { applySessionMsg, createSessionStore, type SessionSnapshot } from '../src/stores/session';
import type { WorkflowView } from '../../shared/workflows';

afterEach(cleanup);

const T0 = 1_767_225_600_000;
const wf = (o: Partial<WorkflowView> = {}): WorkflowView => ({
  id: 'wf_00000000-aaa', name: 'example-flow', state: 'running', done: 19, failed: 0, total: 20,
  phase: 'Verify', phases: ['Build', 'Verify'], startedAt: T0, endedAt: null, tokens: 2_500_000, tokensUnmeasured: 0,
  agents: [
    { label: 'build', phase: 'Build', state: 'done' },
    { label: 'verify-1', phase: 'Verify', state: 'failed' },
    { label: 'verify-2', phase: 'Verify', state: 'running' },
  ],
  agentsOmitted: 0,
  ...o,
});
const item = (w: WorkflowView): HelperItem => ({ kind: 'workflow', id: w.id, workflow: w });
const strip = (workflows: WorkflowView[]) => render(
  <HelpersStrip view={helpersView({ workflows, workflowsUnreadable: false, agents: [], agentsUnmeasured: null, readEvery: null })!} reports={{}} onReport={() => undefined} />,
);
/** Open the strip, then a workflow row's phases. */
const openRow = (name = 'example-flow'): void => {
  fireEvent.click(screen.getByRole('button', { name: /^Helpers/ }));
  fireEvent.click(screen.getByRole('button', { name }));
};

describe('the facts, written the way Claude Code writes them', () => {
  it('tokens: 980, 12.4k, 2.5m', () => {
    expect([formatTokens(980), formatTokens(12_400), formatTokens(2_500_000), formatTokens(3_000), formatTokens(150_000)])
      .toEqual(['980', '12.4k', '2.5m', '3k', '150k']);
  });
  it('elapsed: 42s, 12m5s, 3h15m, 2d4h', () => {
    expect([formatElapsed(42_000), formatElapsed(725_000), formatElapsed(11_700_000), formatElapsed(187_200_000)])
      .toEqual(['42s', '12m5s', '3h15m', '2d4h']);
  });
  it('a running workflow row: mainFacts is the kind alone; the state, phase, progress and failures are the state group (review 3099 F3)', () => {
    expect(mainFacts(item(wf()))).toEqual(['workflow']);
    expect(mainFacts(item(wf({ failed: 2 })))).toEqual(['workflow']);
    strip([wf({ failed: 2 })]);
    fireEvent.click(screen.getByRole('button', { name: /^Helpers/ }));
    const row = document.querySelector('[data-helper-row="wf_00000000-aaa"]')!;
    expect([...row.querySelectorAll('.helper-state .helper-word')].map((w) => w.textContent))
      .toEqual(['running', 'phase Verify', '19/20 agents', '2 failed']);
    expect([...row.querySelectorAll('.helper-fact')].map((g) => g.textContent!.replace(/\u00A0/g, ' ')).slice(0, 2))
      .toEqual(['workflow', 'running · phase Verify · 19/20 agents · 2 failed']);
  });
  it('an unread journal leaves the progress out of the row, never 0/0', () => {
    expect(mainFacts(item(wf({ done: null, failed: null, total: null })))).toEqual(['workflow']);
    strip([wf({ done: null, failed: null, total: null })]);
    fireEvent.click(screen.getByRole('button', { name: /^Helpers/ }));
    const row = document.querySelector('[data-helper-row="wf_00000000-aaa"]')!;
    expect([...row.querySelectorAll('.helper-state .helper-word')].map((w) => w.textContent)).toEqual(['running', 'phase Verify']);
  });
});

describe('finished rows keep Claude Code\'s last word', () => {
  it('completed → done, failed → failed, killed → stopped, clocked to the end, not to now', () => {
    const end = { endedAt: T0 + 60_000 };
    // The outcome, the agents and the duration are one group, which never breaks across lines (review 3072 F7).
    expect(finishedFacts(item(wf({ state: 'completed', ...end })))).toEqual({ state: ['done', '19/20 agents', '1m0s'], facts: [], prose: null });
    expect(finishedFacts(item(wf({ state: 'failed', ...end }))).state[0]).toBe('failed');
    expect(finishedFacts(item(wf({ state: 'killed', ...end }))).state[0]).toBe('stopped');
  });
});

describe('a workflow row: the bar and the detail', () => {
  it('the bar is the done fraction; an unread journal draws no fill', () => {
    const { container } = strip([wf(), wf({ id: 'wf_00000000-bbb', name: 'second-flow', done: null, failed: null, total: null })]);
    fireEvent.click(screen.getByRole('button', { name: /^Helpers/ }));
    const fills = [...container.querySelectorAll('.meter-fill')] as HTMLElement[];
    expect(fills[0]!.style.width).toBe('95%');
    expect(container.querySelectorAll('.meter').length).toBe(2);
    expect(fills).toHaveLength(1); // the unread row's meter carries no fill at all
  });
  it('open: phases in script order, the current one marked, each agent with its state; done agents fold', () => {
    strip([wf()]);
    openRow();
    expect(screen.getByText('Build')).toBeTruthy();
    expect(screen.getByText('Verify')).toBeTruthy();
    expect(screen.getByText(/^0\/2 · now$/)).toBeTruthy(); // Verify: a failed and a running agent, none done
    expect(screen.getByText('verify-2')).toBeTruthy();
    expect(screen.getByText('verify-1')).toBeTruthy();
    expect(screen.queryByText('build')).toBeNull();
    fireEvent.click(screen.getByText('… +1 done'));
    expect(screen.getByText('build')).toBeTruthy();
  });
  it('a stopped workflow\'s cut-off agent reads stopped, not running', () => {
    strip([wf({ state: 'killed', endedAt: T0 + 1000 })]);
    fireEvent.click(screen.getByRole('button', { name: /^Helpers/ }));
    fireEvent.click(screen.getByRole('button', { name: /Finished · last 10 min/ }));
    fireEvent.click(screen.getByRole('button', { name: 'example-flow' }));
    expect(screen.getAllByText('stopped').length).toBeGreaterThan(0);
    expect(document.querySelector('.helper-phase-agent[data-state="stopped"]')).not.toBeNull();
  });
  it('agents left off the wire are counted, never silently missing', () => {
    strip([wf({ agentsOmitted: 480 })]);
    openRow();
    expect(screen.getByText('… +480 more agents not listed')).toBeTruthy();
  });
  it('a run whose phases ahead are unreadable says so while running', () => {
    strip([wf({ phases: null })]);
    openRow();
    expect(screen.getByText('Phases still to come are not readable for this run.')).toBeTruthy();
  });
  it('the done fold toggles in place: it says open, keeps focus, and folds again', () => {
    strip([wf()]);
    openRow();
    const fold = screen.getByText('… +1 done').closest('button')!;
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fold.focus();
    fireEvent.click(fold);
    expect(screen.getByText('build')).toBeTruthy();
    expect(fold.isConnected).toBe(true);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(fold);
    fireEvent.click(fold);
    expect(screen.queryByText('build')).toBeNull();
  });
});

describe('workflow-strip.css — the cap and the scroll', () => {
  const css = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'workflow-strip.css'), 'utf8');
  const rule = (sel: string): string => {
    const i = css.indexOf(`${sel} {`);
    expect(i, sel).toBeGreaterThanOrEqual(0);
    return css.slice(i, css.indexOf('}', i));
  };
  it('collapsed, capped like the mail and task strips; open, at most half the viewport (§10)', () => {
    expect(rule('  .helpers-strip')).toContain('max-height: min(40vh, 320px)');
    expect(rule('.helpers-strip--open')).toContain('max-height: 50vh');
  });
  it('open, the summary steps aside and the rows are the one scroll body, able to shrink', () => {
    expect(rule('.helpers-strip--open .helpers-summary')).toContain('display: none');
    const rows = rule('.helpers-rows');
    expect(rows).toContain('overflow-y: auto');
    expect(rows).toContain('min-height: 0');
  });
  it('the done fold clears the tap floor', () => {
    expect(rule('.helpers-strip .helper-phase-fold')).toContain('min-height: var(--tap-min)');
  });
});

const snap = (): SessionSnapshot => ({
  events: [], offset: 0, uuid: null, status: null, statusUpdatedAt: null, dialog: null, ask: null, tasks: [], mail: [],
  missingFile: null, strandedAccount: null, searchComplete: true, fileMeasured: true, file: null,
  workflows: [], workflowsUnreadable: false,
});

describe('the store', () => {
  it('a workflows frame replaces the rows wholesale and carries the unreadable flag', () => {
    const s = applySessionMsg(snap(), { type: 'workflows', workflows: [wf()], unreadable: true });
    expect(s.workflows).toHaveLength(1);
    expect(s.workflowsUnreadable).toBe(true);
    const t = applySessionMsg(s, { type: 'workflows', workflows: [] });
    expect([t.workflows, t.workflowsUnreadable]).toEqual([[], false]);
  });
  it('a backlog onto another transcript drops the rows — another session dir, and the server states the next read', () => {
    const s = applySessionMsg({ ...snap(), file: '/t1.jsonl' }, { type: 'workflows', workflows: [wf()] });
    const t = applySessionMsg(s, { type: 'backlog', uuid: 'u2', events: [], offset: 0, file: '/t2.jsonl', missing: false });
    expect(t.workflows).toEqual([]);
  });
  it('a reconnect onto the same transcript keeps the rows until the restated frame replaces them', () => {
    const s0 = applySessionMsg(snap(), { type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t1.jsonl', missing: false });
    const s = applySessionMsg(s0, { type: 'workflows', workflows: [wf()] });
    const t = applySessionMsg(s, { type: 'backlog', uuid: 'u1', events: [], offset: 10, file: '/t1.jsonl', missing: false });
    expect(t.workflows).toEqual([wf()]);
  });
});

describe('SessionScreen shows the workflows', () => {
  it('a workflows frame off the stream paints the strip in the conversation pane', () => {
    const store = createSessionStore('claude:demo', {
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close() {} }) as unknown as WebSocket,
      api: { prompt: async () => {} },
    });
    act(() => {
      store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false });
      store.getState().apply({ type: 'workflows', workflows: [wf()] });
    });
    render(<SessionScreen id="claude:demo" store={store} />);
    expect(screen.getByText(/1 running/)).toBeTruthy();
    expect(screen.getByText('example-flow')).toBeTruthy();
  });
  it('a frame that arrives after the page painted repaints the strip (the subscription is live)', () => {
    const store = createSessionStore('claude:demo2', {
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close() {} }) as unknown as WebSocket,
      api: { prompt: async () => {} },
    });
    act(() => store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false }));
    render(<SessionScreen id="claude:demo2" store={store} />);
    expect(screen.queryByText('example-flow')).toBeNull();
    act(() => store.getState().apply({ type: 'workflows', workflows: [wf()] }));
    expect(screen.getByText('example-flow')).toBeTruthy();
    act(() => store.getState().apply({ type: 'workflows', workflows: [] }));
    expect(screen.queryByText('example-flow')).toBeNull();
  });
});
