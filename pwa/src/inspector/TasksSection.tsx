// The inspector's Tasks (W2 Task S8, D-5474): the session's plan, EVERY task, always expanded. The strip above the
// composer folds the plan to one line because it spends chat height; the inspector is a column of its own, so the plan
// is open there: each task's glyph, subject and description, in the terminal's order (`orderTasks`, the strip's own).
//
// At >=1600 the rail REPLACES the strip, so it carries what the strip carries (the header-superset rule): the running
// task's activeForm as the plan's head and, when nothing has written the list for longer than TASKS_STALE_MS
// (`staleFor`, the one reader of the threshold), D-5372's plan left open — "Plan · untouched 7h", its in_progress rows
// "open", no running mark, no activeForm.
//
// A session with no plan renders nothing: an empty heading over "No plan" tells the operator nothing the missing
// section does not (desktop polish T3d, D-6334).
import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { elapsedShort, orderTasks, useNow } from '@ccrc/ui';
import type { TaskItem } from '../../../shared/api';
import { staleFor } from '../session/taskStaleness';
import type { SessionStore } from '../stores/session';
import { InspectorSection } from './InspectorSection';
import { useInspectorSession } from './useInspectorSession';

const GLYPH: Record<TaskItem['status'], string> = { in_progress: '■', pending: '☐', completed: '✓' };
const WORD: Record<TaskItem['status'], string> = { in_progress: 'running', pending: 'left', completed: 'done' };

function TasksBody({ store }: { store: SessionStore }): ReactNode {
  // Through the store's own subscribe (D-5560's pattern): the reducer replaces the array on every tasks frame.
  const tasks = useSyncExternalStore(store.subscribe, () => store.getState().tasks);
  const touchedAt = useSyncExternalStore(store.subscribe, () => store.getState().tasksTouchedAt);
  const now = useNow(30_000, touchedAt !== undefined);
  const untouchedFor = staleFor(touchedAt, now);
  const stale = untouchedFor !== undefined;
  if (tasks.length === 0) return null;
  const ordered = orderTasks(tasks);
  const running = stale ? null : ordered.find((t) => t.status === 'in_progress') ?? null;
  const head = stale
    ? `Plan · untouched ${elapsedShort(untouchedFor) ?? ''}`
    : running === null ? null : running.activeForm || running.subject;
  return (
    <InspectorSection id="tasks" title="Tasks">
      {head !== null && <p className="insp-tasks-head">{head}</p>}
      <ol className="insp-tasks" data-stale={stale ? 'true' : undefined}>
        {ordered.map((t) => (
          <li key={t.id} className="insp-task" data-status={t.status}>
            <span className="insp-task-glyph" aria-hidden="true">{GLYPH[t.status]}</span>
            <span className="insp-task-text">
              <span className="insp-task-subject">{t.subject}</span>
              <span className="sr-only">{` (${stale && t.status === 'in_progress' ? 'open' : WORD[t.status]})`}</span>
              {t.description.trim() !== '' && <span className="insp-task-detail">{t.description}</span>}
            </span>
          </li>
        ))}
      </ol>
    </InspectorSection>
  );
}

export function TasksSection(): ReactNode {
  const session = useInspectorSession();
  return session === null ? null : <TasksBody store={session.store} />;
}
