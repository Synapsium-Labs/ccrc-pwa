// The session page's workflow strip (D-5560): Claude Code's own row — name,
// bar, done/total, elapsed, `↓ N tokens` — one line per workflow, the detail
// (phases, each agent's label and state) behind the head. Neutral fixtures.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkflowStrip, formatElapsed, formatTokens, workflowFacts, workflowHeadline } from '@ccrc/ui';
import { SessionScreen } from '../src/screens/SessionScreen';
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

describe('the facts, written the way Claude Code writes them', () => {
  it('tokens: 980, 12.4k, 2.5m', () => {
    expect([formatTokens(980), formatTokens(12_400), formatTokens(2_500_000), formatTokens(3_000), formatTokens(150_000)])
      .toEqual(['980', '12.4k', '2.5m', '3k', '150k']);
  });
  it('elapsed: 42s, 12m5s, 3h15m, 2d4h', () => {
    expect([formatElapsed(42_000), formatElapsed(725_000), formatElapsed(11_700_000), formatElapsed(187_200_000)])
      .toEqual(['42s', '12m5s', '3h15m', '2d4h']);
  });
  it('the row: done/total · elapsed · ↓ tokens', () => {
    expect(workflowFacts(wf(), T0 + 11_700_000)).toBe('19/20 · 3h15m · ↓ 2.5m tokens');
  });
});

describe('an unmeasured fact says so — never a zero', () => {
  it('an unread journal is "progress unreadable", not 0/0', () => {
    expect(workflowFacts(wf({ done: null, failed: null, total: null }), T0)).toMatch(/^progress unreadable/);
  });
  it('no agent measured is "tokens unmeasured"; a floor carries a +', () => {
    expect(workflowFacts(wf({ tokens: null }), T0)).toContain('tokens unmeasured');
    expect(workflowFacts(wf({ tokensUnmeasured: 2 }), T0)).toContain('↓ 2.5m+ tokens');
  });
  it('no start measured: no elapsed clause at all, rather than 0s', () => {
    expect(workflowFacts(wf({ startedAt: null }), T0)).toBe('19/20 · ↓ 2.5m tokens');
  });
  it('the source unreadable with nothing read: the strip says so', () => {
    render(<WorkflowStrip workflows={[]} unreadable />);
    expect(screen.getByText('Workflow state unreadable')).toBeTruthy();
  });
  it('unreadable with rows: the rows stand and the strip says they were not re-read', () => {
    render(<WorkflowStrip workflows={[wf()]} unreadable />);
    expect(screen.getByText(/Could not re-read workflow state/)).toBeTruthy();
    expect(screen.getByText('example-flow')).toBeTruthy();
  });
});

describe('finished rows keep Claude Code\'s last word for their 30 s', () => {
  it('completed → done, failed → failed, killed → stopped', () => {
    const end = { endedAt: T0 + 60_000 };
    expect(workflowFacts(wf({ state: 'completed', ...end }), T0)).toMatch(/· done$/);
    expect(workflowFacts(wf({ state: 'failed', ...end }), T0)).toMatch(/· failed$/);
    expect(workflowFacts(wf({ state: 'killed', ...end }), T0)).toMatch(/· stopped$/);
  });
  it('a finished row is clocked to its end, not to now', () => {
    expect(workflowFacts(wf({ state: 'completed', endedAt: T0 + 60_000 }), T0 + 999_999_999)).toContain(' 1m0s ');
  });
  it('the head counts running and finished apart', () => {
    expect(workflowHeadline([wf(), wf({ id: 'b' })], false)).toBe('2 workflows running');
    expect(workflowHeadline([wf(), wf({ id: 'b', state: 'completed', endedAt: T0 })], false)).toBe('1 running · 1 finished');
    expect(workflowHeadline([wf({ state: 'completed', endedAt: T0 })], false)).toBe('1 workflow finished');
  });
});

describe('WorkflowStrip — the glance and the detail', () => {
  it('nothing to show renders nothing', () => {
    const { container } = render(<WorkflowStrip workflows={[]} />);
    expect(container.innerHTML).toBe('');
  });
  it('collapsed: one line per workflow with every fact; no agent rows', () => {
    render(<WorkflowStrip workflows={[wf(), wf({ id: 'wf_00000000-bbb', name: 'second-flow', done: 1, total: 4 })]} />);
    expect(screen.getByText('2 workflows running')).toBeTruthy();
    expect(screen.getByText('example-flow')).toBeTruthy();
    expect(screen.getByText('second-flow')).toBeTruthy();
    expect(screen.getByText(/^19\/20 · /)).toBeTruthy();
    expect(screen.queryByText('verify-2')).toBeNull();
  });
  it('the bar is the done fraction; an unread journal draws no fill', () => {
    const { container } = render(<WorkflowStrip workflows={[wf(), wf({ id: 'x', done: null, failed: null, total: null })]} />);
    const fills = [...container.querySelectorAll('.meter-fill')] as HTMLElement[];
    expect(fills[0]!.style.width).toBe('95%');
    expect(container.querySelectorAll('.meter').length).toBe(2);
    expect(fills).toHaveLength(1); // the unread row's meter carries no fill at all
  });
  it('open: phases in script order, the current one marked, each agent with its state; done agents fold', () => {
    render(<WorkflowStrip workflows={[wf()]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
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
    render(<WorkflowStrip workflows={[wf({ state: 'killed', endedAt: T0 + 1000 })]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('stopped')).toBeTruthy();
  });
  it('agents left off the wire are counted, never silently missing', () => {
    render(<WorkflowStrip workflows={[wf({ agentsOmitted: 480 })]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('… +480 more agents not listed')).toBeTruthy();
  });
  it('a run whose phases ahead are unreadable says so while running', () => {
    render(<WorkflowStrip workflows={[wf({ phases: null })]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Phases still to come are not readable for this run.')).toBeTruthy();
  });
  it('read-only: the only controls are the head and the folds', () => {
    render(<WorkflowStrip workflows={[wf()]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names).toHaveLength(2);
    expect(names[1]).toBe('… +1 done');
  });
});

describe('WorkflowStrip — compact on a phone, every fact reachable', () => {
  const many = (n: number): WorkflowView[] =>
    Array.from({ length: n }, (_, i) => wf({ id: `wf_0000000${i}-aaa`, name: `flow-${i}`, done: i, total: 9 }));
  it('collapsed: at most three lines, then "+N more" — the head already counts them all', () => {
    const { container } = render(<WorkflowStrip workflows={many(6)} />);
    expect(screen.getByText('6 workflows running')).toBeTruthy();
    expect(container.querySelectorAll('.workflow-summary .workflow-line')).toHaveLength(3);
    expect(screen.getByText('+3 more — open for all')).toBeTruthy();
    expect(screen.queryByText('flow-5')).toBeNull();
  });
  it('collapsed: running rows come first, so a finished one never hides a running one', () => {
    const done = (i: number): WorkflowView => wf({ id: `wf_1000000${i}-aaa`, name: `done-${i}`, state: 'completed', startedAt: T0 - 10_000 + i, endedAt: T0 });
    render(<WorkflowStrip workflows={[done(0), done(1), done(2), wf({ name: 'still-running' })]} />);
    expect(screen.getByText('still-running')).toBeTruthy();
    expect(screen.getByText('+1 more — open for all')).toBeTruthy();
  });
  it('open: every workflow\'s own facts line heads its detail, so the summary can step aside', () => {
    const { container } = render(<WorkflowStrip workflows={many(6)} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const details = [...container.querySelectorAll('.workflow-detail')];
    expect(details).toHaveLength(6);
    for (const [i, d] of details.entries()) {
      expect(d.querySelector('.workflow-name')!.textContent).toBe(`flow-${i}`);
      expect(d.querySelector('.workflow-facts')!.textContent).toMatch(new RegExp(`^${i}/9 · `));
    }
  });
  it('the summary is a list, one item per workflow, and a running one says running', () => {
    render(<WorkflowStrip workflows={[wf(), wf({ id: 'wf_00000000-bbb', name: 'second-flow', state: 'completed', endedAt: T0 + 5 })]} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toMatch(/running$/);
    expect(items[1]!.textContent).toMatch(/done$/);
  });
  it('the done fold toggles in place: it says open, keeps focus, and folds again', () => {
    render(<WorkflowStrip workflows={[wf()]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
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
  it('capped like the mail and task strips', () => {
    expect(rule('  .workflow-strip')).toContain('max-height: min(40vh, 320px)');
  });
  it('open, the summary steps aside and the rows are the one scroll body, able to shrink', () => {
    expect(rule('.workflow-strip--open .workflow-summary')).toContain('display: none');
    const rows = rule('.workflow-rows');
    expect(rows).toContain('overflow-y: auto');
    expect(rows).toContain('min-height: 0');
  });
  it('the done fold clears the tap floor', () => {
    expect(rule('.workflow-strip .workflow-fold')).toContain('min-height: var(--tap-min)');
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
    expect(screen.getByText('1 workflow running')).toBeTruthy();
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
