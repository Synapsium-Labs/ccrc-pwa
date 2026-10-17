// Task strip — the TUI's plan widget, pinned directly above the composer, which
// is where the terminal puts it: between the conversation and the prompt you are
// about to type into. Collapsed to one live line by default — the running task's
// activeForm plus a count readout — and the header expands it to the rows.
// Ordering mirrors the terminal exactly: in-progress first, then pending,
// then completed — struck through and folded behind "… +N completed", because
// what's left is the news and what's done is the receipt.
//
// Rows are buttons only to reveal a task's description; nothing here mutates
// the plan (the session owns its own list). No tasks → the strip renders
// nothing at all, so ordinary conversations never pay a row for it.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { FOCUS_RING } from '../lib/focus';
import { CollapsibleStrip } from '../primitives/collapsible-strip';
import type { TaskItem } from '../../../shared/api';
import './task-strip.css';

const RANK: Record<TaskItem['status'], number> = { in_progress: 0, pending: 1, completed: 2 };

/** Terminal order — status group first, task number within the group. */
export function orderTasks(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort(
    (a, b) => RANK[a.status] - RANK[b.status] || parseInt(a.id, 10) - parseInt(b.id, 10),
  );
}

/** "2 running · 1 left · 4 ✓" — the counts that matter, in the order you ask
 *  them. Zero-count clauses are dropped rather than shown as "0". A STALE list
 *  (D-5372) names its in_progress items "open": the files say in_progress, but
 *  nothing has written them for longer than `TASKS_STALE_MS`. */
export function summarize(tasks: TaskItem[], opts: { stale?: boolean } = {}): string {
  const running = tasks.filter((t) => t.status === 'in_progress').length;
  const left = tasks.filter((t) => t.status === 'pending').length;
  const done = tasks.filter((t) => t.status === 'completed').length;
  const parts: string[] = [];
  if (running > 0) parts.push(`${running} ${opts.stale ? 'open' : 'running'}`);
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
        className={`task-line ${FOCUS_RING}`}
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

/** "7h" below a day, "3d" from a day — the age a stale headline names. */
function untouchedAge(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export function TaskStrip({
  tasks,
  untouchedFor,
}: {
  tasks: TaskItem[];
  /** D-5372: present ONLY when the list is stale — nothing has written its
   *  files for longer than `TASKS_STALE_MS` — and then the ms since. The app
   *  decides (`staleFor` in pwa), because this package takes no value from
   *  shared/. Absent renders the strip as it always did. */
  untouchedFor?: number;
}): ReactNode {
  // Collapsed by default: sitting above the composer, an open list spends chat
  // height on every screen. One live line (what's running + the tally) is the
  // glance; the rows are one tap away.
  const [showDone, setShowDone] = useState(false);
  if (tasks.length === 0) return null;

  const ordered = orderTasks(tasks);
  const done = ordered.filter((t) => t.status === 'completed');
  const outstanding = ordered.filter((t) => t.status !== 'completed');
  // D-5372: a list nothing has written for longer than TASKS_STALE_MS is a
  // plan left open, not work in flight — no activeForm, no running mark.
  const stale = untouchedFor !== undefined;
  const running = stale ? null : ordered.find((t) => t.status === 'in_progress') ?? null;
  // The collapsed headline is the same sentence the spinner wears; with nothing
  // running, the plan itself is the headline.
  const headline = stale
    ? `Plan · untouched ${untouchedAge(untouchedFor)}`
    : running ? running.activeForm || running.subject : 'Tasks';

  return (
    <CollapsibleStrip
      root="task-strip"
      part="task"
      // 32px, the height `.task-head` had on main (see `headFloor` on CollapsibleStrip).
      headFloor="compact"
      label="Task list"
      mark="✳"
      markClass={running ? 'task-mark--running' : undefined}
      headline={headline}
      count={`${done.length}/${tasks.length}`}
      summary={summarize(tasks, { stale })}
    >
      {outstanding.map((t) => (
        <TaskRow key={t.id} task={t} />
      ))}
      {done.length > 0 &&
        (showDone ? (
          done.map((t) => <TaskRow key={t.id} task={t} />)
        ) : (
          <li className="task-row task-row--fold">
            <button type="button" className={`task-fold ${FOCUS_RING}`} onClick={() => setShowDone(true)}>
              … +{done.length} completed
            </button>
          </li>
        ))}
    </CollapsibleStrip>
  );
}
