import { afterEach, describe, it, expect } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { SessionScreen } from '../src/screens/SessionScreen';
import { createSessionStore } from '../src/stores/session';
import { TaskStrip, orderTasks, summarize } from '@ccrc/ui';
import { applySessionMsg } from '../src/stores/session';
import { staleFor } from '../src/session/taskStaleness';
import type { SessionSnapshot } from '../src/stores/session';
import { TASKS_STALE_MS, type TaskItem } from '../../shared/api';

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

// D-5372: a list untouched for longer than TASKS_STALE_MS is a plan the model
// left open, not running work. The measured shape: 22 tasks, 17 completed,
// 4 in_progress, 1 pending, the files last written three days earlier.
describe('TaskStrip — a stale list is a plan, not running work (D-5372)', () => {
  const STALE_PLAN: TaskItem[] = [
    ...Array.from({ length: 17 }, (_, i) => task(String(i + 1), `step ${i + 1}`, 'completed')),
    ...Array.from({ length: 4 }, (_, i) => task(String(i + 18), `step ${i + 18}`, 'in_progress', `Doing step ${i + 18}`)),
    task('22', 'step 22', 'pending'),
  ];
  const HOUR = 60 * 60 * 1000;

  it('three days untouched: "4 open", the headline names the age, no running mark', () => {
    const { container } = render(<TaskStrip tasks={STALE_PLAN} untouchedFor={72 * HOUR} />);
    expect(screen.getByText('4 open \u00b7 1 left \u00b7 17 \u2713')).toBeTruthy();
    expect(screen.getByText('Plan \u00b7 untouched 3d')).toBeTruthy();
    expect(screen.queryByText('Doing step 18')).toBeNull();
    expect(container.querySelector('.task-mark--running')).toBeNull();
    expect(screen.getByText('17/22')).toBeTruthy();
  });
  it('expanded, a stale list\'s in_progress rows drop the busy accent; a live list\'s keep it', () => {
    const stale = render(<TaskStrip tasks={STALE_PLAN} untouchedFor={72 * HOUR} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const staleRows = stale.container.querySelectorAll('.task-row--in_progress');
    expect(staleRows.length).toBeGreaterThan(0);
    staleRows.forEach((r) => expect(r.classList.contains('task-row--stale')).toBe(true));
    cleanup();
    const live = render(<TaskStrip tasks={STALE_PLAN} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(live.container.querySelector('.task-row--stale')).toBeNull();
  });
  it('hours are named in hours below a day', () => {
    render(<TaskStrip tasks={STALE_PLAN} untouchedFor={7 * HOUR + 59 * 60 * 1000} />);
    expect(screen.getByText('Plan \u00b7 untouched 7h')).toBeTruthy();
  });
  it('untouchedFor absent renders as today — the running activeForm, "4 running", the running mark', () => {
    const { container } = render(<TaskStrip tasks={STALE_PLAN} />);
    expect(screen.getByText('Doing step 18')).toBeTruthy();
    expect(screen.getByText('4 running \u00b7 1 left \u00b7 17 \u2713')).toBeTruthy();
    expect(container.querySelector('.task-mark--running')).not.toBeNull();
  });
  it('summarize names in_progress as open when asked to', () => {
    expect(summarize(STALE_PLAN, { stale: true })).toBe('4 open \u00b7 1 left \u00b7 17 \u2713');
    expect(summarize(STALE_PLAN)).toBe('4 running \u00b7 1 left \u00b7 17 \u2713');
  });
});

describe('staleFor — the one reader of TASKS_STALE_MS (D-5372)', () => {
  const NOW = Date.parse('2026-10-17T20:30:00Z');
  it('older than the threshold answers the age; at it, or younger, or absent, undefined', () => {
    expect(staleFor(NOW - 3 * 24 * 60 * 60 * 1000, NOW)).toBe(3 * 24 * 60 * 60 * 1000);
    expect(staleFor(NOW - TASKS_STALE_MS - 1, NOW)).toBe(TASKS_STALE_MS + 1);
    expect(staleFor(NOW - TASKS_STALE_MS, NOW)).toBeUndefined();
    expect(staleFor(NOW - 5 * 60 * 1000, NOW)).toBeUndefined();
    expect(staleFor(undefined, NOW)).toBeUndefined();
  });
  it('the threshold is six hours', () => {
    expect(TASKS_STALE_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe('session reducer — tasks', () => {
  const snap = (): SessionSnapshot => ({
    events: [], offset: 0, uuid: null, status: null, statusUpdatedAt: null,
    dialog: null, ask: null, tasks: [], mail: [], missingFile: null,
    strandedAccount: null, searchComplete: true, fileMeasured: true, file: null,
  });

  it('replaces the list wholesale on a tasks frame', () => {
    const s = applySessionMsg(snap(), { type: 'tasks', tasks: PLAN });
    expect(s.tasks).toHaveLength(5);
    expect(applySessionMsg(s, { type: 'tasks', tasks: [] }).tasks).toEqual([]);
  });

  it('keeps the frame\'s touchedAt (D-5372), and a frame without one clears it', () => {
    const s = applySessionMsg(snap(), { type: 'tasks', tasks: PLAN, touchedAt: 1760000000000 });
    expect(s.tasksTouchedAt).toBe(1760000000000);
    expect(applySessionMsg(s, { type: 'tasks', tasks: PLAN }).tasksTouchedAt).toBeUndefined();
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
  it('a frame whose touchedAt is days old paints the plan headline (D-5372)', () => {
    const store = createSessionStore('claude:demo', {
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close() {} }) as unknown as WebSocket,
      api: { prompt: async () => {} },
    });
    act(() => {
      store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false });
      store.getState().apply({ type: 'tasks', tasks: PLAN, touchedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 });
    });
    render(<SessionScreen id="claude:demo" store={store} />);
    expect(screen.getByText('Plan \u00b7 untouched 3d')).toBeTruthy();
    expect(screen.queryByText('Building claude_spend_reader')).toBeNull();
  });
  it('a frame whose touchedAt is minutes old still reads as running work (D-5372)', () => {
    const store = createSessionStore('claude:demo', {
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close() {} }) as unknown as WebSocket,
      api: { prompt: async () => {} },
    });
    act(() => {
      store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false });
      store.getState().apply({ type: 'tasks', tasks: PLAN, touchedAt: Date.now() - 5 * 60 * 1000 });
    });
    const { container } = render(<SessionScreen id="claude:demo" store={store} />);
    expect(screen.getByText('Building claude_spend_reader')).toBeTruthy();
    expect(screen.getByText('2 running \u00b7 1 left \u00b7 2 \u2713')).toBeTruthy();
    expect(container.querySelector('.task-mark--running')).not.toBeNull();
    expect(screen.queryByText(/Plan \u00b7 untouched/)).toBeNull();
  });
});
