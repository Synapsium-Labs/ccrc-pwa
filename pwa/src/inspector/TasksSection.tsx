// The inspector's Tasks (W2 Task S8, D-5474): the session's plan, EVERY task, always expanded. The strip above the
// composer folds the plan to one line because it spends chat height; the inspector is a column of its own, so the plan
// is open there: each task's glyph, subject and description, in the terminal's order (`orderTasks`, the strip's own).
import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { orderTasks } from '@ccrc/ui';
import type { TaskItem } from '../../../shared/api';
import type { SessionStore } from '../stores/session';
import { InspectorSection } from './InspectorSection';
import { useInspectorSession } from './useInspectorSession';

const GLYPH: Record<TaskItem['status'], string> = { in_progress: '■', pending: '☐', completed: '✓' };
const WORD: Record<TaskItem['status'], string> = { in_progress: 'running', pending: 'left', completed: 'done' };

function TasksBody({ store }: { store: SessionStore }): ReactNode {
  // Through the store's own subscribe (D-5560's pattern): the reducer replaces the array on every tasks frame.
  const tasks = useSyncExternalStore(store.subscribe, () => store.getState().tasks);
  return (
    <InspectorSection id="tasks" title="Tasks">
      {tasks.length === 0 ? (
        <p className="insp-empty">No plan</p>
      ) : (
        <ol className="insp-tasks">
          {orderTasks(tasks).map((t) => (
            <li key={t.id} className="insp-task" data-status={t.status}>
              <span className="insp-task-glyph" aria-hidden="true">{GLYPH[t.status]}</span>
              <span className="insp-task-text">
                <span className="insp-task-subject">{t.subject}</span>
                <span className="sr-only">{` (${WORD[t.status]})`}</span>
                {t.description.trim() !== '' && <span className="insp-task-detail">{t.description}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </InspectorSection>
  );
}

export function TasksSection(): ReactNode {
  const session = useInspectorSession();
  return session === null ? null : <TasksBody store={session.store} />;
}
