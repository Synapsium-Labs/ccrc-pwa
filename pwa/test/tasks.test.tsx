import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
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

  it('collapses to the running task\'s activeForm plus a done/total tally', () => {
    render(<TaskStrip tasks={PLAN} />);
    expect(screen.getByText('Building claude_spend_reader')).toBeTruthy();
    expect(screen.getByText('2/5')).toBeTruthy();
    expect(screen.getByText('2 running · 1 left · 2 ✓')).toBeTruthy();
    // Rows stay closed until asked for.
    expect(screen.queryByText('Task 4: restart poller')).toBeNull();
  });

  it('expands to outstanding rows with completed folded behind a count', () => {
    render(<TaskStrip tasks={PLAN} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Task 1: least-priv CH user')).toBeTruthy();
    expect(screen.getByText('Task 4: restart poller')).toBeTruthy();
    expect(screen.getByText('… +2 completed')).toBeTruthy();
    expect(screen.queryByText('Present design')).toBeNull();

    fireEvent.click(screen.getByText('… +2 completed'));
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
    dialog: null, tasks: [], missingFile: null,
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
