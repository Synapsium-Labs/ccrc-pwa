import { afterEach, describe, it, expect } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { SessionScreen } from '../src/screens/SessionScreen';
import { createSessionStore } from '../src/stores/session';
import { TaskStrip, orderTasks, summarize } from '../src/session/TaskStrip';
import { applySessionMsg } from '../src/stores/session';
import type { SessionSnapshot } from '../src/stores/session';
import type { TaskItem } from '../../shared/api';

afterEach(() => {
  cleanup();
});

const task = (id: string, subject: string, status: TaskItem['status'], activeForm = ''): TaskItem => ({
  id, subject, description: `why ${id}`, activeForm, status,
});

const PLAN: TaskItem[] = [
  task('29', 'Present design', 'completed'),
  task('30', 'Write spec doc', 'completed'),
  task('32', 'Task 1: least-priv CH user', 'in_progress', 'Building claude_spend_reader'),
  task('34', 'Task 3: seed model_rates', 'in_progress', 'Seeding model_rates'),
  task('35', 'Task 4: restart poller', 'pending'),
];

describe('orderTasks', () => {
  it('groups in-progress, then pending, then completed — task number within each', () => {
    expect(orderTasks(PLAN).map((t) => t.id)).toEqual(['32', '34', '35', '29', '30']);
  });
});

describe('summarize', () => {
  it('names only the non-zero counts', () => {
    expect(summarize(PLAN)).toBe('2 running · 1 left · 2 ✓');
    expect(summarize([task('1', 'a', 'completed')])).toBe('1 ✓');
  });
});

describe('TaskStrip', () => {
  it('renders nothing when the session keeps no task list', () => {
    const { container } = render(<TaskStrip tasks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('rests as one live line: what is running, the tally, and the counts', () => {
    render(<TaskStrip tasks={PLAN} />);
    expect(screen.getByText('Building claude_spend_reader')).toBeTruthy();
    expect(screen.getByText('2/5')).toBeTruthy();
    expect(screen.getByText('2 running \u00b7 1 left \u00b7 2 \u2713')).toBeTruthy();
    // It sits above the composer, so the rows stay out of the way until asked for.
    expect(screen.queryByText('Task 4: restart poller')).toBeNull();
  });

  it('expands to the rows, completed folded behind a count', () => {
    render(<TaskStrip tasks={PLAN} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Task 1: least-priv CH user')).toBeTruthy();
    expect(screen.getByText('Task 4: restart poller')).toBeTruthy();
    expect(screen.getByText('\u2026 +2 completed')).toBeTruthy();
    expect(screen.queryByText('Present design')).toBeNull();
    fireEvent.click(screen.getByText('\u2026 +2 completed'));
    expect(screen.getByText('Present design')).toBeTruthy();
  });

  it('reveals a task\'s description on tap', () => {
    render(<TaskStrip tasks={PLAN} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByText('why 35')).toBeNull();
    fireEvent.click(screen.getByText('Task 4: restart poller'));
    expect(screen.getByText('why 35')).toBeTruthy();
  });

  it('falls back to the plan itself as headline when nothing is running', () => {
    render(<TaskStrip tasks={[task('1', 'a', 'pending')]} />);
    expect(screen.getByText('Tasks')).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy();
  });
});

describe('session reducer — tasks', () => {
  const snap = (): SessionSnapshot => ({
    events: [], offset: 0, uuid: null, status: null, statusUpdatedAt: null,
    dialog: null, ask: null, tasks: [], mail: [], missingFile: null,
    strandedAccount: null, searchComplete: true,
  });

  it('replaces the list wholesale on a tasks frame', () => {
    const s = applySessionMsg(snap(), { type: 'tasks', tasks: PLAN });
    expect(s.tasks).toHaveLength(5);
    expect(applySessionMsg(s, { type: 'tasks', tasks: [] }).tasks).toEqual([]);
  });

  it('keeps the plan across a transcript rotation — a compaction does not clear it', () => {
    const s = applySessionMsg(snap(), { type: 'tasks', tasks: PLAN });
    expect(applySessionMsg(s, { type: 'rotated', uuid: 'new' }).tasks).toHaveLength(5);
  });
});

// End-to-end through the screen, not just the component: a `tasks` frame off the
// session stream must actually paint rows in the conversation pane. Reported
// twice as "I still can't see the task list", so it gets a test that fails if
// the wiring (stream → store → SessionScreen) breaks anywhere along the way.
describe('SessionScreen shows the plan', () => {
  it('paints the rows in the conversation pane when the stream sends tasks', () => {
    const store = createSessionStore('claude:demo', {
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close() {} }) as unknown as WebSocket,
      api: { prompt: async () => {} },
    });
    act(() => {
      store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false });
      store.getState().apply({ type: 'tasks', tasks: PLAN });
    });
    render(<SessionScreen id="claude:demo" store={store} />);
    expect(screen.getByText('Building claude_spend_reader')).toBeTruthy();
    expect(screen.getByText('2/5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Task 1: least-priv CH user')).toBeTruthy();
  });
});
