// Task strip — the TUI's plan widget, pinned under the session header. The
// terminal shows it as a live tree under the spinner; here it collapses to one
// line (the running task's activeForm plus a count readout) and expands to the
// rows. Ordering mirrors the terminal exactly: in-progress first, then pending,
// then completed — struck through and folded behind "… +N completed", because
// what's left is the news and what's done is the receipt.
//
// Rows are buttons only to reveal a task's description; nothing here mutates
// the plan (the session owns its own list). No tasks → the strip renders
// nothing at all, so ordinary conversations never pay a row for it.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { TaskItem } from '../../../shared/api';
import './chat.css';

const RANK: Record<TaskItem['status'], number> = { in_progress: 0, pending: 1, completed: 2 };

/** Terminal order — status group first, task number within the group. */
export function orderTasks(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort(
    (a, b) => RANK[a.status] - RANK[b.status] || parseInt(a.id, 10) - parseInt(b.id, 10),
  );
}

/** "2 running · 1 left · 4 ✓" — the counts that matter, in the order you ask
 *  them. Zero-count clauses are dropped rather than shown as "0". */
export function summarize(tasks: TaskItem[]): string {
  const running = tasks.filter((t) => t.status === 'in_progress').length;
  const left = tasks.filter((t) => t.status === 'pending').length;
  const done = tasks.filter((t) => t.status === 'completed').length;
  const parts: string[] = [];
  if (running > 0) parts.push(`${running} running`);
  if (left > 0) parts.push(`${left} left`);
  if (done > 0) parts.push(`${done} ✓`);
  return parts.join(' · ');
}

const GLYPH: Record<TaskItem['status'], string> = {
  in_progress: '■',
  pending: '☐',
  completed: '✓',
};

function TaskRow({ task }: { task: TaskItem }): ReactNode {
  const [open, setOpen] = useState(false);
  const hasDetail = task.description.trim() !== '';
  return (
    <li className={`task-row task-row--${task.status}`}>
      <button
        type="button"
        className="task-line"
        onClick={() => hasDetail && setOpen((o) => !o)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
      >
        <span className="task-glyph" aria-hidden="true">
          {GLYPH[task.status]}
        </span>
        <span className="task-subject">{task.subject}</span>
      </button>
      {open && <p className="task-detail">{task.description}</p>}
    </li>
  );
}

export function TaskStrip({ tasks }: { tasks: TaskItem[] }): ReactNode {
  // Open by default — the terminal shows the ROWS, and a collapsed headline
  // reads as "the task list still isn't here". Outstanding work is short by
  // construction (the completed pile is what grows, and that stays folded), so
  // the rows cost a few lines, not a screen.
  const [open, setOpen] = useState(true);
  const [showDone, setShowDone] = useState(false);
  if (tasks.length === 0) return null;

  const ordered = orderTasks(tasks);
  const done = ordered.filter((t) => t.status === 'completed');
  const outstanding = ordered.filter((t) => t.status !== 'completed');
  const running = ordered.find((t) => t.status === 'in_progress') ?? null;
  // The collapsed headline is the same sentence the spinner wears; with nothing
  // running, the plan itself is the headline.
  const headline = running ? running.activeForm || running.subject : 'Tasks';

  return (
    <section className={open ? 'task-strip task-strip--open' : 'task-strip'} aria-label="Task list">
      <button
        type="button"
        className="task-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={running ? 'task-mark task-mark--running' : 'task-mark'} aria-hidden="true">
          ✳
        </span>
        <span className="task-headline">{headline}</span>
        <span className="task-count">
          {done.length}/{tasks.length}
        </span>
        <span className="task-chevron" aria-hidden="true">
          {open ? '⌃' : '⌄'}
        </span>
      </button>

      <p className="task-summary">{summarize(tasks)}</p>

      {open && (
        <ol className="task-rows">
          {outstanding.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
          {done.length > 0 &&
            (showDone ? (
              done.map((t) => <TaskRow key={t.id} task={t} />)
            ) : (
              <li className="task-row task-row--fold">
                <button type="button" className="task-fold" onClick={() => setShowDone(true)}>
                  … +{done.length} completed
                </button>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
